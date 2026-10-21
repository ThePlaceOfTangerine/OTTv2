const express = require('express');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const path = require('node:path');
const { httpConfig } = require('./http-config');
const { hashPassword, verifyPassword, needsRehash } = require('./passwords');
const { MatchService } = require('./sandbox/match-service');
const { SAMPLES } = require('./sandbox/samples');
const multer = require('multer');
const { SubmissionService } = require('./submissions/service');
const { UPLOAD_LIMIT } = require('./submissions/source');
const { registerAdmin } = require('./admin');
const { ScoringService, registerScoring } = require('./scoring');
const { RuleSetService, registerRuleSets } = require('./rule-sets');
const { TournamentService, registerTournaments } = require('./tournaments');
const { TournamentStages } = require('./tournament-stages');
const { FinalIntakes, registerFinalIntakes } = require('./final-intakes');
const { SwissService, registerSwiss } = require('./swiss');
const { BracketService, registerBrackets } = require('./brackets');
const { BracketRunner } = require('./bracket-runner');
const { githubFromEnv } = require('./github/client');
const { RepoService } = require('./github/repos');
const { GraderService, registerGraders, registerGraderAdmin } = require('./grader/coordinator');
const { PublicationService, registerPublications } = require('./publish/publications');
const { sheetsFromEnv } = require('./publish/sheets');
const { SnapshotService } = require('./backup/snapshots');
const { importFolder } = require('./intake/folder');
const { Authority, READ_ONLY } = require('./sync/authority');
const { registerSync, readOnlyGuard } = require('./sync/routes');
const { registerSetup } = require('./setup');
const { trustLevel } = require('./settings');

function turnstileFromEnv(env = process.env) {
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET) return null;
  return { siteKey: env.TURNSTILE_SITE_KEY, verify: async (token, ip) => {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip || '' }) });
    return (await response.json()).success === true;
  } };
}

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
const TTL = 8 * 60 * 60 * 1000;

async function createApp({ db, secureCookies = false, trustedProxies = '', publicOrigin = '', now = Date.now, loginMax = 10, loginIpMax = Math.max(100, loginMax * 10), matchService, submissionService, submissionOptions, swissOptions, bracketOptions, publicationOptions, snapshotOptions, onRestart, setupProbe, github = githubFromEnv(), turnstile = turnstileFromEnv() } = {}) {
  const config = httpConfig({ trustedProxies, publicOrigin, secureCookies });
  const app = express();
  // HTTPS proxies on the same machine (Tailscale Funnel, Caddy, cloudflared) talk plain HTTP; X-Forwarded-Proto keeps the Origin check right.
  app.set('trust proxy', config.trustProxy);
  const authority = new Authority(db, { now });
  app.locals.authority = authority;
  const matches = matchService || new MatchService(db);
  app.locals.matches = matches;
  const ruleSets = matches.ruleSets || new RuleSetService(db);
  app.locals.ruleSets = ruleSets;
  const tournaments = new TournamentService(db, { ruleSets, now });
  app.locals.tournaments = tournaments;
  const stages = new TournamentStages(db, { tournaments, now });
  tournaments.stages = stages;
  const finalIntakes = new FinalIntakes(db, { tournaments, stages, now });
  app.locals.finalIntakes = finalIntakes;
  const submissions = submissionService || new SubmissionService(db, { now, ...submissionOptions, stages });
  app.locals.submissions = submissions;
  const repos = new RepoService(db, { ...github, submissions, stages, now });
  app.locals.repos = repos; submissions.repos = repos; stages.repos = repos;
  matches.submissions = submissions;
  const scoring = new ScoringService(db, submissions);
  app.locals.scoring = scoring;
  const swiss = new SwissService(db, { tournaments, submissions, now, ...swissOptions });
  app.locals.swiss = swiss;
  const brackets = new BracketService(db, { tournaments, now });
  app.locals.brackets = brackets;
  const bracketRunner = new BracketRunner(db, { tournaments, brackets, submissions, now, ...bracketOptions });
  app.locals.bracketRunner = bracketRunner;
  brackets.runner = bracketRunner;
  const graders = new GraderService(db, { submissions, swiss, bracket: bracketRunner, now });
  app.locals.graders = graders;
  const publications = new PublicationService(db, { tournaments, swiss, brackets, now, sheets: sheetsFromEnv(), ...publicationOptions });
  app.locals.publications = publications;
  const snapshots = new SnapshotService(db, { submissionsRoot: submissions.root, now, ...snapshotOptions });
  app.locals.snapshots = snapshots;
  submissions.authority = authority; swiss.authority = authority; bracketRunner.authority = authority; publications.authority = authority;
  const upload = multer({ storage: multer.memoryStorage(), preservePath: true, limits: { fileSize: UPLOAD_LIMIT, files: 1, fields: 2, fieldSize: 2048, parts: 3 } });
  const uploadFields = req => Object.keys(req.body || {}).every(key => ['entry', 'cf-turnstile-response'].includes(key));
  const human = async (req, res, next) => {
    if (!turnstile) return next();
    const token = req.body?.['cf-turnstile-response'];
    if (typeof token !== 'string' || !token) return res.status(403).json({ error: 'Cần hoàn tất bước xác minh chống bot trước khi nộp file.' });
    let passed;
    try { passed = await turnstile.verify(token, req.ip); } catch { return res.status(503).json({ error: 'Chưa kiểm tra được bước xác minh chống bot. Thử lại sau ít phút.' }); }
    if (!passed) return res.status(403).json({ error: 'Xác minh chống bot không hợp lệ hoặc đã hết hạn. Hãy xác minh lại.' });
    next();
  };
  let uploadsInFlight = 0;
  const uploadingUsers = new Set();
  const limitUploads = (req, res, next) => {
    // 32 uploads in memory at most (≤ 5 MB each, ~160 MB). With 4, a 1,000-team deadline burst got p95 111 s to a receipt (Phase 8).
    if (uploadsInFlight >= 32 || uploadingUsers.has(req.auth.id)) return res.status(429).set('Retry-After', '2').json({ error: 'Đang nhận bài nộp khác. Vui lòng thử lại sau.' });
    uploadsInFlight++; uploadingUsers.add(req.auth.id); let released = false;
    const release = () => { if (released) return; released = true; uploadsInFlight--; uploadingUsers.delete(req.auth.id); };
    res.once('finish', release); res.once('close', release); next();
  };
  app.disable('x-powered-by');
  const dummyHash = await hashPassword(random());  // unknown usernames take as long as wrong passwords
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY' });
    const challenge = turnstile ? ' https://challenges.cloudflare.com' : '';
    if (!req.path.startsWith('/legacy')) res.set('Content-Security-Policy', `default-src 'self'; script-src 'self'${challenge}; frame-src 'self'${challenge}; style-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'`);
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Large JSON (a 1,000-team standings table is ~150 KB) is gzipped in the thread pool: ~10× less bandwidth for thousands of viewers.
    if (/\bgzip\b/.test(req.get('accept-encoding') || '')) {
      const json = res.json.bind(res);
      res.json = body => {
        const text = JSON.stringify(body);
        if (text === undefined || Buffer.byteLength(text) < 16384) return json(body);
        zlib.gzip(text, (error, compressed) => {
          if (error) return json(body);
          res.set({ 'Content-Encoding': 'gzip', 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' }).send(compressed);
        });
        return res;
      };
    }
    next();
  });
  // Registered before the JSON parser: the HMAC signature covers the exact raw bytes.
  app.post('/api/github/webhook', express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => res.status(202).json(await repos.webhook(req.body, req.headers)));
  registerGraders(app, { graders });
  app.use(express.json({ limit: '256kb' }));
  const setup = registerSetup(app, { db, tournaments, web: path.join(__dirname, '../web'), onRestart, probe: setupProbe });
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };
  app.use((req, res, next) => {
    const raw = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('ott_session='));
    if (raw) {
      req.sessionHash = digest(raw.slice('ott_session='.length));
      req.auth = db.prepare(`SELECT u.id,u.username,u.role,u.must_change_password,s.csrf_token FROM sessions s
        JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.locked=0 AND u.deleted_at IS NULL`)
        .get(req.sessionHash, now());
    }
    next();
  });
  // Writes to data handed to another machine (LAN final) are refused here; reads keep working.
  app.use(readOnlyGuard({ db, authority }));
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
    if (config.origin && req.protocol !== new URL(config.origin).protocol.slice(0, -1)) return res.status(400).json({ error: 'Giao thức truy cập không khớp cấu hình website.' });
    if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'Yêu cầu khác nguồn.' });
    if (req.get('Origin')) {
      const expected = config.origin || `${req.protocol}://${req.get('host')}`;
      if (req.get('Origin') !== expected) return res.status(403).json({ error: 'Yêu cầu khác nguồn.' });
    }
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || username.length > 40 || typeof password !== 'string' || Buffer.byteLength(password) > 72)
      return res.status(400).json({ error: 'Thông tin đăng nhập không hợp lệ.' });
    const time = now();
    db.prepare('DELETE FROM login_limits WHERE expires_at<=?').run(time);
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(time);
    const limits = [[`ip:${req.ip}`, loginIpMax], [`user:${username.toLowerCase()}`, loginMax]];
    const blocked = limits.map(([key, max]) => ({ entry: db.prepare('SELECT attempts,expires_at FROM login_limits WHERE key=?').get(key), max }))
      .filter(({ entry, max }) => entry && entry.attempts >= max);
    if (blocked.length) {
      const retryAfter = Math.max(1, ...blocked.map(({ entry }) => Math.ceil((entry.expires_at - time) / 1000)));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `Quá nhiều lần đăng nhập. Thử lại sau ${retryAfter} giây.`, retryAfter });
    }
    // Reserve before password verification yields, so concurrent requests cannot bypass the limit.
    const reservations = limits.map(([key]) => {
      db.prepare(`INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1`).run(key, time + 900000);
      return { key, expiresAt: db.prepare('SELECT expires_at FROM login_limits WHERE key=?').get(key).expires_at };
    });
    const user = db.prepare('SELECT * FROM users WHERE username=? AND deleted_at IS NULL').get(username);
    const valid = await verifyPassword(password, user ? user.password_hash : dummyHash);
    if (!valid || !user || user.locked || !db.prepare('SELECT 1 FROM users WHERE id=? AND password_hash=? AND locked=0').get(user.id, user.password_hash)) return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng.' });
    // Old bcrypt hashes move to scrypt on the first successful login, before answering, so an immediate password change cannot race it.
    // Only on the machine that owns the system data (D16): a read-only LAN copy must not change account rows.
    if (needsRehash(user.password_hash) && authority.owns('system')) {
      const rehashed = await hashPassword(password);
      if (db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(rehashed, user.id, user.password_hash).changes) user.password_hash = rehashed;
    }
    // Refund only this request, never other failures or a newer limit window.
    for (const { key, expiresAt } of reservations) db.prepare('UPDATE login_limits SET attempts=MAX(0,attempts-1) WHERE key=? AND expires_at=?').run(key, expiresAt);
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
      if (!user || !await verifyPassword(currentPassword, user.password_hash)) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.' });
      const hash = await hashPassword(newPassword), token = random(), csrfToken = random();
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
    res.json({ username: req.auth.username, phase: 5, github: repos.configured(), turnstileSiteKey: turnstile?.siteKey || null, readOnly: authority.owns('system') ? null : READ_ONLY });
  });
  app.get('/api/portal/team', requireRole('contestant'), (req, res) => res.json({ ...repos.team(req.auth.id), lookupCode: publications.lookupCode(req.auth.id), publicSiteUrl: publications.publicUrl }));
  app.put('/api/portal/team/members', requireRole('contestant'), csrf, (req, res) => res.json(repos.saveMembers(req.auth.id, req.body?.members)));
  app.post('/api/portal/team/repo', requireRole('contestant'), csrf, (req, res) => res.json(repos.register(req.auth.id, req.body?.url)));
  app.post('/api/portal/team/repo/verify', requireRole('contestant'), csrf, async (req, res) => res.json(await repos.verify(req.auth.id)));
  app.post('/api/portal/github-submit', requireRole('contestant'), csrf, async (req, res) => {
    const stageId = req.body?.stageId ?? null;
    if (stageId !== null && typeof stageId !== 'string') return res.status(400).json({ error: 'Giai đoạn không hợp lệ.' });
    res.status(202).json(await repos.submitHead(req.auth.id, stageId || null));
  });
  app.get('/api/admin/github', requireRole('admin'), (req, res) => res.json(repos.adminOverview()));
  app.get('/api/portal/submissions', requireRole('contestant'), (req, res) => res.json({ submissions: submissions.list(req.auth.id) }));
  app.get('/api/portal/tournaments', requireRole('contestant'), (req, res) => res.json({ stages: stages.listForUser(req.auth.id), serverNow: now() }));
  app.get('/api/portal/stages/:stageId/submissions', requireRole('contestant'), (req, res) => {
    const stage = stages.forUser(req.params.stageId, req.auth.id);
    if (!stage) return res.status(404).json({ error: 'Không tìm thấy giai đoạn của bạn.' });
    res.json({ stage, submissions: submissions.list(req.auth.id, req.params.stageId) });
  });
  app.post('/api/portal/stages/:stageId/submissions', requireRole('contestant'), csrf, limitUploads, upload.single('bot'), human, async (req, res) => {
    if (!req.file || !uploadFields(req)) return res.status(400).json({ error: 'Nộp một file bot và trường entry nếu cần.' });
    const submission = await submissions.submit({ userId: req.auth.id, stageId: req.params.stageId, filename: req.file.originalname,
      buffer: req.file.buffer, entry: req.body.entry || '', idempotencyKey: req.get('Idempotency-Key') || null });
    res.status(202).json(submission);
  });
  app.post('/api/portal/submissions', requireRole('contestant'), csrf, limitUploads, upload.single('bot'), human, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Hãy chọn một file .py, .cpp hoặc .zip.' });
    if (!uploadFields(req)) return res.status(400).json({ error: 'Trường upload không hợp lệ.' });
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
    res.json({ contestants: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='contestant' AND deleted_at IS NULL").get().n,
      locked: db.prepare('SELECT COUNT(*) AS n FROM users WHERE locked=1 AND deleted_at IS NULL').get().n, phase: 5, trust: trustLevel() });
  });
  app.get('/api/admin/sandbox', requireRole('admin'), async (req, res) => {
    try { res.json({ ...await matches.manager.check(), samples: Object.keys(SAMPLES) }); }
    catch (error) { res.status(503).json({ available: false, error: error.message, code: error.code || 'sandbox_unavailable' }); }
  });
  app.get('/api/admin/matches', requireRole('admin'), (req, res) => res.json({ matches: matches.list(), samples: Object.keys(SAMPLES), bots: matches.botChoices() }));
  app.get('/api/admin/matches/:id', requireRole('admin'), (req, res) => {
    const match = matches.get(req.params.id);
    if (!match) return res.status(404).json({ error: 'Không tìm thấy trận.' });
    res.json(match);
  });
  app.post('/api/admin/matches', requireRole('admin'), csrf, (req, res) => {
    const { botA, botB, seed, ruleSetId, ruleSetVersion } = req.body || {};
    const id = matches.create({ userId: req.auth.id, botA, botB, seed, ruleSetId, ruleSetVersion });
    res.status(202).json({ id });
  });
  registerAdmin(app, { db, submissions, requireRole, csrf });
  registerRuleSets(app, { ruleSets, requireRole, csrf });
  registerScoring(app, { db, scoring, requireRole, csrf });
  registerTournaments(app, { tournaments, requireRole, csrf });
  registerSwiss(app, { swiss, stages, requireRole, csrf });
  registerBrackets(app, { brackets, stages, requireRole, csrf });
  registerFinalIntakes(app, { finalIntakes, requireRole, csrf });
  registerGraderAdmin(app, { graders, requireRole, csrf });
  registerPublications(app, { publications, requireRole, csrf });
  registerSync(app, { db, authority, submissionsRoot: submissions.root, tournaments, requireRole, csrf });
  app.get('/api/admin/snapshots', requireRole('admin'), async (req, res) => res.json(await snapshots.status()));
  app.post('/api/admin/snapshots', requireRole('admin'), csrf, async (req, res) => { await snapshots.snapshot(); res.status(201).json(await snapshots.status()); });
  app.post('/api/admin/stages/:stageId/folder-intake', requireRole('admin'), csrf, async (req, res) => res.json(await importFolder({ db, submissions, tournaments, stageId: req.params.stageId,
    dir: req.body?.dir, receivedAt: req.body?.receivedAt ?? null, actorId: req.auth.id, reason: req.body?.reason })));
  // Local copy of the static results site (LAN finals, preview before deploying to Cloudflare Pages).
  app.use('/site', express.static(publications.siteDir, { index: 'index.html' }));
  const web = path.join(__dirname, '../web');
  app.get('/', (req, res) => res.redirect('/portal'));
  for (const role of ['portal', 'admin']) app.get(`/${role}`, (req, res) => {
    if (setup.needed() && setup.isLocal(req)) return res.redirect('/setup');
    if (req.auth && req.auth.role !== (role === 'admin' ? 'admin' : 'contestant')) return res.status(403).send('Không có quyền truy cập.');
    res.set('Cache-Control', 'no-store').sendFile(path.join(web, 'index.html'));
  });
  app.get('/assets/movement.js',(req,res)=>res.sendFile(path.join(__dirname,'game/movement.js')));
  app.use('/assets', express.static(web));
  app.get(['/docs/PROTOCOL.md', '/docs/protocol'], (req, res) => res.sendFile(path.join(web, 'protocol.html')));
  app.get('/docs/PROTOCOL.raw.md', (req, res) => res.type('text/plain').sendFile(path.join(__dirname, '../docs/PROTOCOL.md')));
  app.get('/templates/python.py', (req, res) => res.download(path.join(__dirname, '../bots/templates/python/main.py'), 'main.py'));
  app.get('/templates/cpp.cpp', (req, res) => res.download(path.join(__dirname, '../bots/templates/cpp/main.cpp'), 'main.cpp'));
  app.use('/legacy', express.static(path.join(__dirname, '../public')));
  app.use('/img', express.static(path.join(__dirname, '../public/img')));
  app.get('/api/health', (req, res) => res.json({ status: 'ok', phase: 5 }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'File vượt giới hạn 5 MiB.' : 'Mỗi lần nộp chỉ nhận một file và một đường dẫn file chính (entry).' });
    const status = [400, 401, 403, 404, 409, 413, 429, 503].includes(error.status) ? error.status : 500;
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'Lỗi hệ thống.' : error.type === 'entity.parse.failed' ? 'Dữ liệu yêu cầu không hợp lệ.' : error.message || 'Dữ liệu yêu cầu không hợp lệ.' });
  });
  return app;
}
module.exports = { createApp };
