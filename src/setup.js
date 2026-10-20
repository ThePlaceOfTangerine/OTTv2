const path = require('node:path');
const { createUser } = require('./users');
const { csvRows, importUsers } = require('./admin');
const { createSandboxManager } = require('./sandbox');
const { saveSettings, trustLevel } = require('./settings');

// First-run wizard (/setup): open only while no admin exists, and only from the machine running the server.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const isLocal = req => LOOPBACK.has(req.socket.remoteAddress) && LOCAL_HOSTS.has(String(req.get('host') || '').replace(/:\d+$/, '').toLowerCase());
const BACKENDS = { classroom: 'windows-job', official: 'docker' };
// What this machine can run; shown in the wizard so the teacher picks a level that works here.
async function probeBackends() {
  const check = async backend => {
    try { return { available: true, ...await Promise.race([createSandboxManager(backend).check(), new Promise((_, reject) => setTimeout(() => reject(new Error('Kiểm tra quá lâu.')), 20000))]) }; }
    catch (error) { return { available: false, error: error.message }; }
  };
  return { 'windows-job': process.platform === 'win32' ? await check('windows-job') : { available: false, error: 'Chỉ có trên Windows.' }, docker: await check('docker') };
}

function registerSetup(app, { db, tournaments, web, onRestart, probe = probeBackends }) {
  const needed = () => !db.prepare("SELECT 1 FROM users WHERE role='admin' AND deleted_at IS NULL").get();
  const guard = (req, res, next) => {
    if (!needed()) return res.status(409).json({ error: 'Máy này đã được cài đặt. Đăng nhập trang quản trị để thay đổi.' });
    // Same rules as login, plus Host: a web page in the teacher's browser must not create the first admin (CSRF/DNS rebinding).
    if (!isLocal(req) || req.get('Sec-Fetch-Site') === 'cross-site' || (req.get('Origin') && req.get('Origin') !== `${req.protocol}://${req.get('host')}`))
      return res.status(403).json({ error: 'Chỉ cài đặt được bằng trình duyệt trên chính máy chạy OTTv2 (http://127.0.0.1).' });
    next();
  };
  app.get('/setup', (req, res) => needed() ? res.set('Cache-Control', 'no-store').sendFile(path.join(web, 'setup.html')) : res.redirect('/admin'));
  app.get('/api/setup', guard, async (req, res) => res.json({ backend: process.env.SANDBOX_BACKEND || 'docker', host: process.env.HOST || '127.0.0.1', checks: await probe() }));
  let busy = false;
  app.post('/api/setup', guard, async (req, res) => {
    const { username, password, trust, lan, csv } = req.body || {};
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) return res.status(400).json({ error: 'Tên đăng nhập 3–40 ký tự: chữ không dấu, số, dấu _ . -' });
    if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) return res.status(400).json({ error: 'Mật khẩu quản trị cần ít nhất 12 ký tự (tối đa 72 byte).' });
    if (!BACKENDS[trust]) return res.status(400).json({ error: 'Chọn mức tin cậy: lớp học hoặc giải chính thức.' });
    if (csv !== undefined && csv !== null && typeof csv !== 'string') return res.status(400).json({ error: 'Danh sách lớp phải là văn bản CSV.' });
    if (busy) return res.status(429).json({ error: 'Đang cài đặt, vui lòng đợi.' });
    busy = true;
    try {
      if (!needed()) return res.status(409).json({ error: 'Máy này đã được cài đặt.' });
      const lower = username.toLowerCase(), listed = csv?.trim() ? csvRows(csv).slice(1).map(row => String(row[0]).trim().toLowerCase()) : [];
      if (listed.includes(lower) || db.prepare('SELECT 1 FROM users WHERE lower(username)=?').get(lower)) return res.status(400).json({ error: 'Tên quản trị trùng với một tài khoản học sinh; chọn tên khác.' });
      // Settings first: once the admin exists the wizard is closed for good.
      const env = { SANDBOX_BACKEND: BACKENDS[trust], HOST: lan ? '0.0.0.0' : '127.0.0.1' };
      saveSettings(env);
      const credentials = csv?.trim() ? await importUsers(db, csv) : [];
      await createUser(db, { username, password, role: 'admin' });
      const admin = db.prepare('SELECT id FROM users WHERE username=?').get(username);
      let tournament = null, tournamentError = null;
      if (credentials.length) try {
        const ids = credentials.map(c => db.prepare('SELECT id FROM users WHERE username=?').get(c.username).id);
        tournament = tournaments.create(admin.id, { name: 'Giải luyện tập', ...(ids.length > 150 ? { config: { maxTeams: ids.length } } : {}) }); // default capacity is 150
        tournament = tournaments.replaceEntrants(tournament.id, admin.id, { expectedRevision: tournament.revision, userIds: ids });
      } catch (error) { tournamentError = `Chưa tạo được giải luyện tập (${error.message}); tạo ở mục Giải đấu.`; }
      const restart = env.SANDBOX_BACKEND !== (process.env.SANDBOX_BACKEND || 'docker') || env.HOST !== (process.env.HOST || '127.0.0.1');
      res.status(201).json({ credentials, tournament: tournament && { id: tournament.id, name: tournament.name }, tournamentError, trust: trustLevel(env), restart, autoRestart: Boolean(restart && onRestart) });
      if (restart && onRestart) setTimeout(onRestart, 300);
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    } finally { busy = false; }
  });
  return { needed, isLocal };
}
module.exports = { registerSetup, isLocal };
