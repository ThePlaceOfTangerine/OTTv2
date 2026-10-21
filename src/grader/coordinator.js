const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { BotFault, InfrastructureError } = require('../game/protocol');
const { verifyReplay } = require('../game/match');
const { createEngine } = require('../game/registry');
const { checkReplay } = require('./play');
const { readTree, writeTree } = require('./files');
const { ENGINE_HASH } = require('./version');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const SKEW_MS = 5 * 60 * 1000;
const KINDS = ['submission', 'bracket', 'swiss'];
const STATUSES = ['Scanning', 'Compiling', 'Test match'];
const TABLES = { swiss: 'swiss_games', bracket: 'bracket_games' };
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
function signature(secret, { method, path: route, timestamp, nonce, body }) {
  return crypto.createHmac('sha256', secret).update(`${method}\n${route}\n${timestamp}\n${nonce}\n${sha256(body)}`).digest('hex');
}

class GraderService {
  constructor(db, { submissions, swiss, bracket, now = Date.now, image = process.env.GRADER_IMAGE || null }) {
    Object.assign(this, { db, submissions, swiss, bracket, now, image });
  }
  create(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 60) fail(400, 'Tên máy chấm từ 1 đến 60 ký tự.');
    const id = `g-${crypto.randomBytes(6).toString('hex')}`, secret = crypto.randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO graders(id,name,secret,created_at) VALUES (?,?,?,?)').run(id, name.trim(), secret, this.now());
    return { id, name: name.trim(), secret };
  }
  list() {
    const running = id => KINDS.reduce((sum, kind) => sum + this.db.prepare(kind === 'submission'
      ? "SELECT COUNT(*) n FROM bot_submissions WHERE job_status='running' AND worker_id LIKE ?" : `SELECT COUNT(*) n FROM ${TABLES[kind]} WHERE status='running' AND worker_id LIKE ?`).get(`${id}:%`).n, 0);
    return this.db.prepare('SELECT id,name,created_at createdAt,revoked_at revokedAt,last_seen_at lastSeenAt,image,slots FROM graders ORDER BY created_at').all()
      .map(row => ({ ...row, running: running(row.id) }));
  }
  revoke(id) { return this.db.prepare('UPDATE graders SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(this.now(), id).changes > 0; }
  // Enrollment window (USB graders, D15): the admin opens it while the room is being set up and closes it when every USB has joined.
  // Only one window is open at a time; the code is shown once and stored as a hash.
  openEnrollment(actorId, { namePrefix = 'usb', maxUses = 50, minutes = 15 } = {}) {
    if (typeof namePrefix !== 'string' || !/^[a-z0-9-]{1,20}$/.test(namePrefix)) fail(400, 'Tiền tố tên máy: 1–20 ký tự a-z, 0-9, dấu gạch ngang.');
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 500) fail(400, 'Số máy tối đa từ 1 đến 500.');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) fail(400, 'Thời gian mở từ 1 đến 240 phút.');
    if (this.openWindow()) fail(409, 'Đang có một đợt đăng ký mở. Đóng đợt đó trước.');
    const id = `e-${crypto.randomBytes(6).toString('hex')}`, code = `ott-${crypto.randomBytes(24).toString('base64url')}`, now = this.now();
    this.db.prepare('INSERT INTO grader_enrollments(id,code_hash,name_prefix,max_uses,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(id, sha256(code), namePrefix, maxUses, now + minutes * 60000, actorId, now);
    return { ...this.enrollment(id), code };
  }
  openWindow() { return this.db.prepare('SELECT id FROM grader_enrollments WHERE closed_at IS NULL AND expires_at>? AND uses<max_uses ORDER BY created_at DESC LIMIT 1').get(this.now())?.id || null; }
  enrollment(id) {
    const row = this.db.prepare('SELECT id,name_prefix namePrefix,max_uses maxUses,uses,expires_at expiresAt,closed_at closedAt,created_at createdAt FROM grader_enrollments WHERE id=?').get(id);
    return row && { ...row, open: !row.closedAt && row.expiresAt > this.now() && row.uses < row.maxUses };
  }
  enrollments() { return this.db.prepare('SELECT id FROM grader_enrollments ORDER BY created_at DESC LIMIT 20').all().map(row => this.enrollment(row.id)); }
  closeEnrollment(id) { return this.db.prepare('UPDATE grader_enrollments SET closed_at=? WHERE id=? AND closed_at IS NULL').run(this.now(), id).changes > 0; }
  // Unauthenticated by design (the code is the credential): 192 random bits, compared by hash, counted and bounded atomically.
  enroll({ code, machine } = {}) {
    if (typeof code !== 'string' || code.length > 100 || (machine !== undefined && (typeof machine !== 'string' || machine.length > 40))) fail(400, 'Mã đăng ký không hợp lệ.');
    const label = String(machine || '').replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 30);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM grader_enrollments WHERE code_hash=?').get(sha256(code));
      if (!row || row.closed_at || row.expires_at <= this.now()) fail(403, 'Mã đăng ký sai, đã hết hạn hoặc đợt đăng ký đã đóng. Nhờ ban tổ chức mở đợt mới.');
      if (row.uses >= row.max_uses) fail(403, 'Đợt đăng ký đã đủ số máy.');
      this.db.prepare('UPDATE grader_enrollments SET uses=uses+1 WHERE id=?').run(row.id);
      const id = `g-${crypto.randomBytes(6).toString('hex')}`, secret = crypto.randomBytes(32).toString('base64url'), name = `${row.name_prefix}-${row.uses + 1}${label ? ` (${label})` : ''}`;
      this.db.prepare('INSERT INTO graders(id,name,secret,created_at,enrollment_id) VALUES (?,?,?,?,?)').run(id, name, secret, this.now(), row.id);
      return { id, name, secret };
    });
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  authenticate({ method, route, headers, body }) {
    const id = headers['x-ott-grader'], timestamp = Number(headers['x-ott-timestamp']), nonce = headers['x-ott-nonce'], given = headers['x-ott-signature'];
    if (typeof id !== 'string' || typeof given !== 'string' || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !Number.isSafeInteger(timestamp)) fail(401, 'Thiếu chữ ký máy chấm.');
    const grader = this.db.prepare('SELECT * FROM graders WHERE id=? AND revoked_at IS NULL').get(id);
    if (!grader) fail(401, 'Máy chấm không tồn tại hoặc đã bị thu hồi.');
    if (Math.abs(this.now() - timestamp) > SKEW_MS) fail(401, 'Đồng hồ máy chấm lệch quá 5 phút so với coordinator.');
    const expected = Buffer.from(signature(grader.secret, { method, path: route, timestamp, nonce, body })), actual = Buffer.from(given);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) fail(401, 'Chữ ký máy chấm không hợp lệ.');
    // Checked after the signature so unauthenticated traffic cannot fill the nonce table.
    this.db.prepare('DELETE FROM grader_nonces WHERE expires_at<?').run(this.now());
    if (!this.db.prepare('INSERT OR IGNORE INTO grader_nonces VALUES (?,?,?)').run(id, nonce, timestamp + SKEW_MS).changes) fail(401, 'Yêu cầu bị gửi lại (trùng nonce).');
    this.db.prepare('UPDATE graders SET last_seen_at=? WHERE id=?').run(this.now(), id);
    return grader;
  }
  own(grader, token) { if (typeof token !== 'string' || !token.startsWith(`${grader.id}:`)) fail(403, 'Việc này không được giao cho máy chấm này.'); }
  queue(kind) { if (!TABLES[kind]) fail(400, 'Loại việc không hợp lệ.'); return this[kind]; }
  claim(grader, { image = null, slots = null, kinds = KINDS, engine = null } = {}) {
    if (engine !== ENGINE_HASH) fail(409, `Máy chấm chạy engine ${engine || '(không rõ)'}, coordinator dùng ${ENGINE_HASH}. Cập nhật mã nguồn hoặc dựng lại rootfs máy chấm.`);
    if (this.image && image !== this.image) fail(409, `Máy chấm dùng image ${image || '(không rõ)'}, coordinator yêu cầu ${this.image}.`);
    this.db.prepare('UPDATE graders SET image=?,slots=? WHERE id=?').run(typeof image === 'string' ? image.slice(0, 200) : null, Number.isInteger(slots) ? slots : null, grader.id);
    for (const kind of KINDS.filter(kind => Array.isArray(kinds) && kinds.includes(kind))) {
      const token = `${grader.id}:${crypto.randomUUID()}`;
      if (kind === 'submission') { const row = this.submissions.claim(token); if (row) return { token, job: this.submissions.checkJob(row) }; }
      else { const row = this[kind].claimGame(token); if (row) return { token, job: this[kind].gameJob(row) }; }
    }
    return null;
  }
  heartbeat(grader, { token, kind, id, live, events = [] }) {
    this.own(grader, token);
    if (kind === 'submission') {
      if (!this.submissions.heartbeatCheck(id, token)) return { leased: false };
      if (!Array.isArray(events) || events.length > 20) fail(400, 'Sự kiện không hợp lệ.');
      try {
        for (const event of events) {
          if (!STATUSES.includes(event?.status) || typeof event.message !== 'string') fail(400, 'Sự kiện không hợp lệ.');
          this.submissions.stage(id, token, event.status, event.message.slice(0, 2000), event.details && typeof event.details === 'object' ? event.details : null);
        }
      } catch (error) { if (error.code === 'lease_lost') return { leased: false }; throw error; }
      if (live !== undefined) this.submissions.checkLive(id, live);
      return { leased: true };
    }
    const queue = this.queue(kind);
    const leased = queue.heartbeatGame(id, token);
    if (leased && live) queue.liveGame(id, token, live);
    return { leased };
  }
  async result(grader, body) {
    const { token, kind, id } = body;
    this.own(grader, token);
    if (kind === 'submission') return { applied: await this.finishCheck(grader, body) };
    const queue = this.queue(kind), row = this.db.prepare(`SELECT * FROM ${TABLES[kind]} WHERE id=? AND worker_id=? AND status='running'`).get(id, token);
    if (!row) return { applied: false };
    if (body.error) return { applied: queue.failGame(id, token, `Máy chấm ${grader.name}: ${String(body.error.message).slice(0, 2000)}`) };
    try { checkReplay(queue.gameJob(row), body.replay); return { applied: queue.finishGame(id, token, body.replay) }; }
    catch (problem) { queue.failGame(id, token, `Kết quả từ máy chấm ${grader.name} không hợp lệ: ${problem.message}`); return { applied: false, rejected: problem.message }; }
  }
  async finishCheck(grader, { token, id, meta, tests = [], artifact, error }) {
    const row = this.db.prepare("SELECT * FROM bot_submissions WHERE id=? AND worker_id=? AND job_status='running'").get(id, token);
    if (!row) return false;
    if (meta && typeof meta === 'object') this.submissions.checkMeta(id, token, Object.fromEntries(Object.entries(meta).filter(([, value]) => ['string', 'number'].includes(typeof value))));
    const job = this.submissions.checkJob(row), rules = JSON.stringify(createEngine({ seed: 'x', rules: job.rules }).rules);
    let problem = null;
    try {
      if (!Array.isArray(tests) || tests.length > 2) throw new Error('Danh sách trận thử không hợp lệ.');
      for (const test of tests) {
        if (![0, 1].includes(test?.candidatePlayer) || test.seed !== `submission-${id}-side-${test.candidatePlayer}` || test.replay?.seed !== test.seed || JSON.stringify(test.replay.rules) !== rules) throw new Error('Trận thử không khớp việc được giao.');
        verifyReplay(test.replay);
      }
    } catch (invalid) { problem = new InfrastructureError('grader_invalid_result', `Kết quả từ máy chấm ${grader.name} không hợp lệ: ${invalid.message}`); }
    if (!problem) for (const test of tests) this.submissions.checkTest(id, token, test);
    if (!problem && error) problem = error.bot ? new BotFault(String(error.code).slice(0, 100), String(error.message).slice(0, 65536)) : new InfrastructureError(String(error.code || 'grader_error').slice(0, 100), `Máy chấm ${grader.name}: ${String(error.message).slice(0, 2000)}`);
    if (!problem) {
      try {
        if (tests.length !== 2) throw new Error('Thiếu trận thử.');
        await this.submissions.clean(id, 'artifact');
        await writeTree(this.submissions.folder(id, 'artifact'), artifact);
      } catch (invalid) { await this.submissions.clean(id, 'artifact'); problem = new InfrastructureError('grader_invalid_result', `Kết quả từ máy chấm ${grader.name} không hợp lệ: ${invalid.message}`); }
    }
    return this.submissions.completeCheck(id, token, problem);
  }
  // The raw upload or GitHub zipball; repo faults (public repo, deleted commit) are the team's and reach the grader as 422.
  async source(grader, { token, id }) {
    this.own(grader, token);
    const row = this.db.prepare("SELECT * FROM bot_submissions WHERE id=? AND worker_id=? AND job_status='running'").get(id, token);
    if (!row) fail(409, 'Việc kiểm tra bài không còn thuộc máy chấm này.');
    return row.commit_sha ? this.submissions.repoSource(row) : fs.readFile(path.join(this.submissions.folder(id), 'upload.bin'));
  }
  async artifact(grader, { submissionId }) {
    if (typeof submissionId !== 'string' || !/^[0-9a-f-]{36}$/.test(submissionId) || !this.db.prepare("SELECT 1 FROM bot_submissions WHERE id=? AND status='Accepted'").get(submissionId)) fail(404, 'Không tìm thấy artifact.');
    return readTree(this.submissions.folder(submissionId, 'artifact'));
  }
}

// Grader endpoints read the raw body because the HMAC covers the exact bytes; register before express.json().
function registerGraders(app, { graders }) {
  const raw = express.raw({ type: () => true, limit: '64mb' });
  const signed = action => [raw, async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const grader = graders.authenticate({ method: req.method, route: req.originalUrl, headers: req.headers, body });
    let input; try { input = body.length ? JSON.parse(body.toString('utf8')) : {}; } catch { fail(400, 'Nội dung không phải JSON.'); }
    try { await action(req, res, grader, input); }
    catch (error) {
      if (error instanceof BotFault) return res.status(422).json({ bot: true, code: error.code, message: error.message });
      if (error instanceof InfrastructureError) return res.status(503).json({ error: error.message, code: error.code });
      throw error;
    }
  }];
  app.post('/api/grader/claim', ...signed(async (req, res, grader, input) => { const lease = graders.claim(grader, input); lease ? res.json(lease) : res.status(204).end(); }));
  app.post('/api/grader/heartbeat', ...signed(async (req, res, grader, input) => res.json(graders.heartbeat(grader, input))));
  app.post('/api/grader/result', ...signed(async (req, res, grader, input) => res.json(await graders.result(grader, input))));
  app.post('/api/grader/source', ...signed(async (req, res, grader, input) => res.type('application/octet-stream').send(await graders.source(grader, input))));
  app.post('/api/grader/artifact', ...signed(async (req, res, grader, input) => res.json(await graders.artifact(grader, input))));
}
function registerGraderAdmin(app, { graders, requireRole, csrf }) {
  app.get('/api/admin/graders', requireRole('admin'), (req, res) => res.json({ graders: graders.list(), image: graders.image, engine: ENGINE_HASH }));
  app.post('/api/admin/graders', requireRole('admin'), csrf, (req, res) => res.status(201).json(graders.create(req.body?.name)));
  app.post('/api/admin/graders/:id/revoke', requireRole('admin'), csrf, (req, res) => graders.revoke(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'Không tìm thấy máy chấm đang hoạt động.' }));
  app.get('/api/admin/grader-enrollments', requireRole('admin'), (req, res) => res.json({ enrollments: graders.enrollments() }));
  app.post('/api/admin/grader-enrollments', requireRole('admin'), csrf, (req, res) => res.status(201).json(graders.openEnrollment(req.auth.id, req.body || {})));
  app.post('/api/admin/grader-enrollments/:id/close', requireRole('admin'), csrf, (req, res) => graders.closeEnrollment(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'Đợt đăng ký không tồn tại hoặc đã đóng.' }));
  app.post('/api/graders/enroll', (req, res) => res.status(201).json(graders.enroll(req.body || {})));
}
module.exports = { GraderService, registerGraders, registerGraderAdmin, signature };
