const crypto = require('node:crypto');
const { hashPassword } = require('./passwords');
const bad = message => Object.assign(new Error(message), { status: 400 });

// RFC 4180 fields, including quoted commas, escaped quotes and CRLF.
function csvRows(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 200000) throw bad('CSV tối đa 200 KB.');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === undefined) throw bad('CSV thiếu dấu đóng ngoặc kép.');
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',' || c === '\n' || c === '\r' || c === undefined) {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (row.some(v => v !== '')) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else if (c === '"' && !field && !closed) quoted = true;
    else { if (closed || c === '"') throw bad('CSV sai định dạng ngoặc kép.'); field += c; }
  }
  return rows;
}
async function importUsers(db, text) {
  const rows = csvRows(text), header = rows.shift();
  const columns = header?.join(',');
  const teams = ['team_id,password_temp,team_name,leader_email', 'team_id,team_name,leader_email'].includes(columns);
  if (!teams && !['username','username,password'].includes(columns)) throw bad('Dòng đầu CSV phải là username hoặc team_id,password_temp,team_name,leader_email.');
  if (!rows.length || rows.length > 1000) throw bad('Mỗi lần import từ 1 đến 1000 tài khoản.');
  const seen = new Set(), records = [];
  for (const row of rows) {
    const field = name => (row[header.indexOf(name)] || '').trim();
    const username = teams ? field('team_id') : row[0];
    let password = username, profile = null;
    if (row.length !== header.length || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) throw bad('Tên tài khoản 3–40 ký tự chữ/số/_.-. Mỗi dòng phải đúng số cột trong tiêu đề.');
    if (teams) {
      password = field('password_temp') || crypto.randomBytes(12).toString('base64url');
      if (password.length < 8 || Buffer.byteLength(password) > 72) throw bad(`Mật khẩu tạm của ${username} cần 8–72 byte.`);
      profile = { teamName: field('team_name'), email: field('leader_email') };
      if (!profile.teamName || profile.teamName.length > 120 || profile.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw bad(`Tên đội (tối đa 120 ký tự) hoặc email trưởng nhóm không hợp lệ: ${username}`);
    }
    if (seen.has(username.toLowerCase()) || db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw bad(`Tài khoản trùng: ${username}`);
    seen.add(username.toLowerCase()); records.push({ username, password, profile });
  }
  await Promise.all(records.map(async record => { record.hash = await hashPassword(record.password); }));  // parallel in the thread pool
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const record of records) {
      const user = db.prepare("INSERT INTO users(username,password_hash,role,created_at,must_change_password) VALUES (?,?,'contestant',?,1)").run(record.username, record.hash, Date.now());
      if (record.profile) db.prepare('INSERT INTO team_profiles(user_id,team_name,leader_email,updated_at) VALUES (?,?,?,?)').run(user.lastInsertRowid, record.profile.teamName, record.profile.email, Date.now());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); if (error.code?.startsWith('ERR_SQLITE')) throw bad('Tài khoản đã tồn tại; không import dòng nào.'); throw error; }
  return records.map(({ username, password }) => ({ username, password }));
}
function registerAdmin(app, { db, submissions, requireRole, csrf }) {
  app.get('/api/admin/users', requireRole('admin'), (req, res) => res.json({ users: db.prepare(`SELECT u.id,u.username,u.locked,u.created_at,s.version,
    (SELECT COUNT(*) FROM bot_submissions b WHERE b.user_id=u.id) submissions,
    (SELECT COUNT(*) FROM bot_submissions b WHERE b.user_id=u.id AND b.status='Accepted') accepted
    FROM users u LEFT JOIN active_bots a ON a.user_id=u.id LEFT JOIN bot_submissions s ON s.id=a.submission_id
    WHERE u.role='contestant' AND u.deleted_at IS NULL ORDER BY u.username`).all() }));
  app.delete('/api/admin/users/:id', requireRole('admin'), csrf, (req, res) => {
    const user = db.prepare("SELECT id,username FROM users WHERE id=? AND role='contestant' AND deleted_at IS NULL").get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy thí sinh.' });
    if (req.body?.username !== user.username) throw bad('Nhập đúng tên tài khoản để xác nhận xóa.');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare("SELECT 1 FROM bot_submissions WHERE user_id=? AND job_status='running'").get(user.id)) {
        throw Object.assign(new Error('Bot của thí sinh đang được kiểm tra. Chờ kiểm tra xong rồi xóa.'), { status: 409 });
      }
      db.prepare('UPDATE users SET deleted_at=?,locked=1 WHERE id=?').run(Date.now(), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM active_bots WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM login_limits WHERE key IN (?,?)').run(`user:${user.username.toLowerCase()}`, `password:${user.id}`);
      db.prepare(`UPDATE bot_submissions SET status='Rejected',job_status='done',reason_code='account_deleted',
        reason='Tài khoản đã bị xóa khỏi giải.',error_type=NULL,updated_at=? WHERE user_id=? AND job_status IN ('queued','blocked')`).run(Date.now(), user.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ ok: true });
  });
  let importing = false;
  app.post('/api/admin/users/import', requireRole('admin'), csrf, async (req, res) => {
    if (importing) return res.status(429).json({ error: 'Đang import tài khoản khác.' });
    importing = true;
    try { res.json({ credentials: await importUsers(db, req.body?.csv) }); } finally { importing = false; }
  });
  for (const action of ['lock', 'reset']) app.post(`/api/admin/users/:id/${action}`, requireRole('admin'), csrf, async (req, res) => {
    const user = db.prepare("SELECT id,username FROM users WHERE id=? AND role='contestant' AND deleted_at IS NULL").get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy thí sinh.' });
    let password, hash;
    if (action === 'reset') { password = crypto.randomBytes(18).toString('base64url'); hash = await hashPassword(password); }
    else if (typeof req.body?.locked !== 'boolean') throw bad('locked phải là boolean.');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (action === 'reset') db.prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?').run(hash, user.id);
      else db.prepare('UPDATE users SET locked=? WHERE id=?').run(Number(req.body.locked), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM login_limits WHERE key IN (?,?)').run(`user:${user.username.toLowerCase()}`, `password:${user.id}`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ ok: true, username: user.username, ...(password ? { password } : {}) });
  });
  app.get('/api/admin/monitor', requireRole('admin'), (req, res, next) => {
    req.monitorPage = Number(req.query.page || 0);
    if (!Number.isInteger(req.monitorPage) || req.monitorPage < 0 || req.monitorPage > 100000) throw bad('Trang không hợp lệ.');
    next();
  }, (req, res) => res.json({
    worker: { id: submissions.workerId, started: submissions.started, capacity: submissions.workers, active: [...submissions.active.keys()] },
    scoringWorker: { id: app.locals.scoring.workerId, started: app.locals.scoring.started, capacity: 1, active: Number(!!app.locals.scoring.active) },
    scoringQueue: db.prepare('SELECT status,COUNT(*) count FROM score_matches GROUP BY status').all(),
    queue: db.prepare('SELECT job_status,error_type,COUNT(*) count FROM bot_submissions GROUP BY job_status,error_type').all(),
    page: req.monitorPage, total: db.prepare('SELECT COUNT(*) n FROM bot_submissions').get().n,
    jobs: db.prepare('SELECT s.id,s.user_id,u.username,s.version,s.status,s.job_status,s.attempts,s.worker_id,s.lease_until,s.error_type,s.reason,s.updated_at FROM bot_submissions s JOIN users u ON u.id=s.user_id ORDER BY s.updated_at DESC,s.id LIMIT 100 OFFSET ?').all(req.monitorPage * 100)
  }));
  app.get('/api/admin/submissions/:id', requireRole('admin'), (req, res) => {
    const row = db.prepare('SELECT user_id FROM bot_submissions WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy bài.' });
    res.json(submissions.detail(req.params.id, row.user_id));
  });
  app.get('/api/admin/submissions/:id/tests/:testId', requireRole('admin'), (req, res) => {
    const row = db.prepare('SELECT user_id FROM bot_submissions WHERE id=?').get(req.params.id);
    const match = row && submissions.test(req.params.id, req.params.testId, row.user_id);
    if (!match) return res.status(404).json({ error: 'Không tìm thấy trận.' });
    res.json(match);
  });
  app.post('/api/admin/submissions/:id/retry', requireRole('admin'), csrf, (req, res) => {
    const row = db.prepare('SELECT user_id FROM bot_submissions WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy bài.' });
    submissions.retry(req.params.id, row.user_id); res.json({ ok: true });
  });
}
module.exports = { csvRows, importUsers, registerAdmin };
