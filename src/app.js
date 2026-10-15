const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { MatchService } = require('./sandbox/match-service');
const { SAMPLES } = require('./sandbox/samples');
const multer = require('multer');
const { SubmissionService } = require('./submissions/service');
const { UPLOAD_LIMIT } = require('./submissions/source');
const { registerAdmin } = require('./admin');
const { ScoringService, registerScoring } = require('./scoring');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
const TTL = 8 * 60 * 60 * 1000;

async function createApp({ db, secureCookies = false, now = Date.now, loginMax = 10, matchService, submissionService, submissionOptions } = {}) {
  const app = express();
  const matches = matchService || new MatchService(db);
  app.locals.matches = matches;
  const submissions = submissionService || new SubmissionService(db, submissionOptions);
  app.locals.submissions = submissions;
  const scoring = new ScoringService(db, submissions);
  app.locals.scoring = scoring;
  const upload = multer({ storage: multer.memoryStorage(), preservePath: true, limits: { fileSize: UPLOAD_LIMIT, files: 1, fields: 1, fieldSize: 180, parts: 2 } });
  let uploadsInFlight = 0;
  const uploadingUsers = new Set();
  const limitUploads = (req, res, next) => {
    if (uploadsInFlight >= 4 || uploadingUsers.has(req.auth.id)) return res.status(429).json({ error: 'Đang nhận bài nộp khác. Vui lòng thử lại sau.' });
    uploadsInFlight++; uploadingUsers.add(req.auth.id); let released = false;
    const release = () => { if (released) return; released = true; uploadsInFlight--; uploadingUsers.delete(req.auth.id); };
    res.once('finish', release); res.once('close', release); next();
  };
  app.disable('x-powered-by');
  const dummyHash = await bcrypt.hash(random(), 12);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY' });
    if (!req.path.startsWith('/legacy')) res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'");
    next();
  });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '256kb' }));
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };
  app.use((req, res, next) => {
    const raw = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('ott_session='));
    if (raw) {
      req.sessionHash = digest(raw.slice('ott_session='.length));
      req.auth = db.prepare(`SELECT u.id,u.username,u.role,u.must_change_password,s.csrf_token FROM sessions s
        JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.locked=0`)
        .get(req.sessionHash, now());
    }
    next();
  });
  const requireRole = role => (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Cần đăng nhập.' });
    if (role && req.auth.role !== role) return res.status(403).json({ error: 'Không có quyền truy cập.' });
    if (req.auth.must_change_password && !['/api/auth/me','/api/auth/logout','/api/auth/password'].includes(req.path)) return res.status(403).json({ error: 'Vui lòng đổi mật khẩu được cấp trước khi sử dụng.', code: 'password_change_required' });
    next();
  };
  const csrf = (req, res, next) => {
    if (req.get('X-CSRF-Token') !== req.auth.csrf_token) return res.status(403).json({ error: 'Yêu cầu không có mã bảo mật hợp lệ. Tải lại trang rồi thử lại.' });
    next();
  };
  app.post('/api/auth/login', async (req, res) => {
    if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'Yêu cầu khác nguồn.' });
    if (req.get('Origin')) {
      const expected = `${req.protocol}://${req.get('host')}`;
      if (req.get('Origin') !== expected) return res.status(403).json({ error: 'Yêu cầu khác nguồn.' });
    }
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || username.length > 40 || typeof password !== 'string' || Buffer.byteLength(password) > 72)
      return res.status(400).json({ error: 'Thông tin đăng nhập không hợp lệ.' });
    const time = now();
    db.prepare('DELETE FROM login_limits WHERE expires_at<=?').run(time);
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(time);
    const keys = [`ip:${req.socket.remoteAddress}`, `user:${username.toLowerCase()}`];
    for (const key of keys) {
      const entry = db.prepare('SELECT attempts FROM login_limits WHERE key=?').get(key);
      if (entry && entry.attempts >= loginMax) {
        res.set('Retry-After', '900');
        return res.status(429).json({ error: 'Quá nhiều lần đăng nhập. Thử lại sau 15 phút.' });
      }
    }
    for (const key of keys) db.prepare(`INSERT INTO login_limits VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET attempts=attempts+1`).run(key, time + 900000);
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    const valid = await bcrypt.compare(password, user ? user.password_hash : dummyHash);
    if (!valid || !user || user.locked || !db.prepare('SELECT 1 FROM users WHERE id=? AND password_hash=? AND locked=0').get(user.id, user.password_hash)) return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng.' });
    const token = random();
    const csrfToken = random();
    db.exec('BEGIN');
    try {
      if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.sessionHash);
      db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(token), user.id, csrfToken, time + TTL);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.cookie('ott_session', token, { ...cookieOptions, maxAge: TTL });
    res.json({ user: { id: user.id, username: user.username, role: user.role, mustChangePassword: !!user.must_change_password }, csrfToken });
  });
  app.get('/api/auth/me', requireRole(), (req, res) => {
    const { id, username, role, csrf_token } = req.auth;
    res.json({ user: { id, username, role, mustChangePassword: !!req.auth.must_change_password }, csrfToken: csrf_token });
  });
  const changingPasswords = new Set();
  app.post('/api/auth/password', requireRole('contestant'), csrf, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword) > 72 || typeof newPassword !== 'string' || newPassword.length < 12 || Buffer.byteLength(newPassword) > 72 || newPassword !== confirmPassword || currentPassword === newPassword) return res.status(400).json({ error: 'Mật khẩu mới cần khác mật khẩu cũ, ít nhất 12 ký tự, tối đa 72 byte và hai lần nhập phải khớp.' });
    if (changingPasswords.has(req.auth.id)) return res.status(429).json({ error: 'Đang đổi mật khẩu, vui lòng chờ.' });
    changingPasswords.add(req.auth.id);
    try {
      const key = `password:${req.auth.id}`, time = now();
      db.prepare('DELETE FROM login_limits WHERE expires_at<=?').run(time);
      if ((db.prepare('SELECT attempts FROM login_limits WHERE key=?').get(key)?.attempts || 0) >= 5) return res.status(429).json({ error: 'Quá nhiều lần thử. Đợi 15 phút hoặc nhờ admin reset mật khẩu.' });
      db.prepare('INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(key, time + 900000);
      const user = db.prepare('SELECT password_hash FROM users WHERE id=? AND locked=0').get(req.auth.id);
      if (!user || !await bcrypt.compare(currentPassword, user.password_hash)) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.' });
      const hash = await bcrypt.hash(newPassword, 12), token = random(), csrfToken = random();
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?').get(req.sessionHash, req.auth.id, now())) { db.exec('ROLLBACK'); return res.status(401).json({ error: 'Phiên đăng nhập hết hiệu lực. Hãy đăng nhập lại.' }); }
        const updated = db.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=? AND password_hash=? AND locked=0').run(hash, req.auth.id, user.password_hash);
        if (!updated.changes) { db.exec('ROLLBACK'); return res.status(409).json({ error: 'Tài khoản đã thay đổi. Hãy đăng nhập lại.' }); }
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.auth.id);
        db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(token), req.auth.id, csrfToken, now() + TTL);
        db.prepare('DELETE FROM login_limits WHERE key IN (?,?)').run(key, `user:${req.auth.username.toLowerCase()}`);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      res.cookie('ott_session', token, { ...cookieOptions, maxAge: TTL });
      res.json({ user: { id: req.auth.id, username: req.auth.username, role: 'contestant', mustChangePassword: false }, csrfToken });
    } finally { changingPasswords.delete(req.auth.id); }
  });
  app.post('/api/auth/logout', requireRole(), csrf, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.sessionHash);
    res.clearCookie('ott_session', cookieOptions).json({ ok: true });
  });
  app.get('/api/portal/overview', requireRole('contestant'), (req, res) => {
    res.json({ username: req.auth.username, phase: 4 });
  });
  app.get('/api/portal/submissions', requireRole('contestant'), (req, res) => res.json({ submissions: submissions.list(req.auth.id) }));
  app.post('/api/portal/submissions', requireRole('contestant'), csrf, limitUploads, upload.single('bot'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Hãy chọn một file .py, .cpp hoặc .zip.' });
    if (Object.keys(req.body || {}).some(key => key !== 'entry')) return res.status(400).json({ error: 'Trường upload không hợp lệ.' });
    const submission = await submissions.submit({ userId: req.auth.id, filename: req.file.originalname, buffer: req.file.buffer, entry: req.body.entry || '' });
    res.status(202).json(submission);
  });
  app.get('/api/portal/submissions/:id', requireRole('contestant'), (req, res) => {
    const submission = submissions.detail(req.params.id, req.auth.id);
    if (!submission) return res.status(404).json({ error: 'Không tìm thấy bài nộp.' });
    res.json(submission);
  });
  app.get('/api/portal/submissions/:id/tests/:testId', requireRole('contestant'), (req, res) => {
    const match = submissions.test(req.params.id, req.params.testId, req.auth.id);
    if (!match) return res.status(404).json({ error: 'Không tìm thấy trận thử.' });
    res.json(match);
  });
  for (const action of ['activate', 'retry']) app.post(`/api/portal/submissions/:id/${action}`, requireRole('contestant'), csrf, (req, res) => {
    if (!submissions[action](req.params.id, req.auth.id)) return res.status(404).json({ error: 'Không tìm thấy bài nộp.' });
    res.json({ ok: true });
  });
  app.get('/api/admin/overview', requireRole('admin'), (req, res) => {
    res.json({ contestants: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='contestant'").get().n,
      locked: db.prepare('SELECT COUNT(*) AS n FROM users WHERE locked=1').get().n, phase: 4 });
  });
  app.get('/api/admin/sandbox', requireRole('admin'), async (req, res) => {
    try { res.json({ ...await matches.manager.check(), samples: Object.keys(SAMPLES) }); }
    catch (error) { res.status(503).json({ available: false, error: error.message, code: error.code || 'sandbox_unavailable' }); }
  });
  app.get('/api/admin/matches', requireRole('admin'), (req, res) => res.json({ matches: matches.list(), samples: Object.keys(SAMPLES) }));
  app.get('/api/admin/matches/:id', requireRole('admin'), (req, res) => {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ error: 'Không tìm thấy trận.' });
    res.json(match);
  });
  app.post('/api/admin/matches', requireRole('admin'), csrf, (req, res) => {
    const { botA, botB, seed } = req.body || {};
    const id = matches.create({ userId: req.auth.id, botA, botB, seed });
    res.status(202).json({ id });
  });
  registerAdmin(app, { db, submissions, requireRole, csrf });
  registerScoring(app, { db, scoring, requireRole, csrf });
  const web = path.join(__dirname, '../web');
  app.get('/', (req, res) => res.redirect('/portal'));
  for (const role of ['portal', 'admin']) app.get(`/${role}`, (req, res) => {
    if (req.auth && req.auth.role !== (role === 'admin' ? 'admin' : 'contestant')) return res.status(403).send('Không có quyền truy cập.');
    res.set('Cache-Control', 'no-store').sendFile(path.join(web, 'index.html'));
  });
  app.use('/assets', express.static(web));
  app.get(['/docs/PROTOCOL.md', '/docs/protocol'], (req, res) => res.sendFile(path.join(web, 'protocol.html')));
  app.get('/docs/PROTOCOL.raw.md', (req, res) => res.type('text/plain').sendFile(path.join(__dirname, '../docs/PROTOCOL.md')));
  app.get('/templates/python.py', (req, res) => res.download(path.join(__dirname, '../bots/templates/python/main.py'), 'main.py'));
  app.get('/templates/cpp.cpp', (req, res) => res.download(path.join(__dirname, '../bots/templates/cpp/main.cpp'), 'main.cpp'));
  app.use('/legacy', express.static(path.join(__dirname, '../public')));
  app.use('/img', express.static(path.join(__dirname, '../public/img')));
  app.get('/api/health', (req, res) => res.json({ status: 'ok', phase: 4 }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'File vượt giới hạn 5 MiB.' : 'Mỗi lần nộp chỉ nhận một file và một đường dẫn file chính (entry).' });
    const status = [400, 409, 413, 429].includes(error.status) ? error.status : 500;
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'Lỗi hệ thống.' : error.type === 'entity.parse.failed' ? 'Dữ liệu yêu cầu không hợp lệ.' : error.message || 'Dữ liệu yêu cầu không hợp lệ.' });
  });
  return app;
}
module.exports = { createApp };
