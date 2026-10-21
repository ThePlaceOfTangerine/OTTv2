const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSandboxManager } = require('../sandbox');
const { DEFAULT_RULES } = require('../game/engine');
const { BotFault, InfrastructureError } = require('../game/protocol');
const { UPLOAD_LIMIT, FILE_LIMIT, safeName } = require('./source');
const { runCheck } = require('./check');
const { ownedTournament, ownedSystem } = require('../sync/authority');

class SubmissionService {
  constructor(db, { storageRoot = process.env.SUBMISSIONS_PATH || path.resolve(__dirname, '../../data/submissions'), workers = Number(process.env.BOT_WORKERS || 2), managerFactory = () => createSandboxManager(), extraScanner, retryDelayMs = 3000, now = Date.now, stages } = {}) {
    if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error('BOT_WORKERS must be 1–4');
    this.db = db; this.root = path.resolve(storageRoot); this.workers = workers; this.managerFactory = managerFactory;
    this.extraScanner = extraScanner; this.retryDelayMs = retryDelayMs; this.now = now;
    this.stages = stages;
    this.workerId = crypto.randomUUID(); this.active = new Map(); this.started = false; this.closing = false;
  }
  folder(id, part = '') {
    if (!/^[0-9a-f-]{36}$/.test(id) || !['', 'source', 'artifact'].includes(part)) throw new Error('Invalid storage identifier');
    const destination = path.resolve(this.root, id, part);
    if (!destination.startsWith(this.root + path.sep)) throw new Error('Unsafe storage path');
    return destination;
  }
  async clean(id, part = '') {
    const destination = this.folder(id, part);
    // Verify the final absolute target before recursive Windows deletion.
    if (!destination.startsWith(this.root + path.sep)) throw new Error('Unsafe cleanup path');
    await fs.rm(destination, { recursive: true, force: true });
  }
  event(id, stage, message, details = null) {
    this.db.prepare('INSERT INTO submission_events(submission_id,created_at,stage,message,details_json) VALUES (?,?,?,?,?)')
      .run(id, this.now(), stage, message.slice(0, 65536), details ? JSON.stringify(details) : null);
  }
  owned(id, userId) { return this.db.prepare('SELECT * FROM bot_submissions WHERE id=? AND user_id=?').get(id, userId); }
  list(userId, stageId = null) {
    const rows = this.db.prepare(`SELECT s.id,s.stage_id,s.version,s.filename,s.entry,s.language,s.status,s.job_status,s.attempts,s.created_at,s.commit_sha,s.repo_full_name,s.origin,
      s.error_type,s.reason_code,s.reason,CASE WHEN a.submission_id=s.id THEN 1 ELSE 0 END AS active
      FROM bot_submissions s LEFT JOIN active_bots a ON a.user_id=s.user_id WHERE s.user_id=? AND s.stage_id IS ? ORDER BY s.version DESC LIMIT 100`).all(userId, stageId);
    if (stageId) for (const row of rows) row.active = Number(this.stages.selectedId(stageId, userId) === row.id);
    return rows;
  }
  detail(id, userId) {
    const row = this.owned(id, userId); if (!row) return null;
    const active = row.stage_id ? this.stages?.selectedId(row.stage_id, userId) === id : this.db.prepare('SELECT 1 FROM active_bots WHERE user_id=? AND submission_id=?').get(userId, id);
    return { id: row.id, stage_id: row.stage_id, received_at: row.created_at, version: row.version, filename: row.filename, entry: row.entry, language: row.language,
      status: row.status, job_status: row.job_status, attempts: row.attempts, active: !!active, created_at: row.created_at,
      error_type: row.error_type, reason_code: row.reason_code, reason: row.reason, source_hash: row.source_hash, image: row.image,
      commit_sha: row.commit_sha, repo_full_name: row.repo_full_name, origin: row.origin,
      events: this.db.prepare('SELECT created_at,stage,message,details_json FROM submission_events WHERE submission_id=? ORDER BY id').all(id)
        .map(event => ({ ...event, details: event.details_json ? JSON.parse(event.details_json) : null, details_json: undefined })),
      tests: this.db.prepare('SELECT id,created_at,attempt,candidate_player,seed,rule_set_id,rule_set_version FROM submission_tests WHERE submission_id=? ORDER BY created_at,id').all(id) };
  }
  test(id, testId, userId) {
    if (!this.owned(id, userId)) return null;
    const row = this.db.prepare('SELECT * FROM submission_tests WHERE id=? AND submission_id=?').get(testId, id);
    if (!row) return null;
    const replay = JSON.parse(row.replay_json);
    return { id: row.id, seed: row.seed, status: 'finished', replay, bots: replay.bots, rules: replay.rules };
  }
  // receivedAt/origin are only set by the organizer's USB/folder intake (time the team handed it in at the desk); the portal uses server time.
  async submit({ userId, filename, buffer, entry = '', stageId = null, idempotencyKey = null, receivedAt = null, origin = null }) {
    let safe;
    try { safe = safeName(filename); } catch (error) { error.status = 400; throw error; }
    if (safe.includes('/') || !/\.(py|cpp|zip)$/.test(safe) || typeof entry !== 'string' || entry.length > 180) throw Object.assign(new Error('Chỉ nhận .py, .cpp hoặc .zip; file chạy chính tối đa 180 ký tự.'), { status: 400 });
    if (!Buffer.isBuffer(buffer) || buffer.length > UPLOAD_LIMIT || (!safe.endsWith('.zip') && buffer.length > FILE_LIMIT)) throw Object.assign(new Error('Một file mã nguồn tối đa 1 MiB; file ZIP tối đa 5 MiB.'), { status: 413 });
    if (stageId !== null && (typeof stageId !== 'string' || !this.stages)) throw Object.assign(new Error('Giai đoạn không hợp lệ.'), { status: 400 });
    if (idempotencyKey !== null && (!stageId || typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey))) throw Object.assign(new Error('Idempotency-Key cần 16–100 ký tự chữ, số, _ hoặc - và chỉ dùng khi nộp theo giải.'), { status: 400 });
    const uploadHash = crypto.createHash('sha256').update(JSON.stringify([safe, entry])).update(buffer).digest('hex');
    const previous = () => {
      if (!idempotencyKey) return null;
      const receipt = this.db.prepare('SELECT id,upload_hash FROM bot_submissions WHERE stage_id=? AND user_id=? AND idempotency_key=?').get(stageId, userId, idempotencyKey);
      if (receipt && receipt.upload_hash !== uploadHash) throw Object.assign(new Error('Khóa yêu cầu đã dùng cho bài khác.'), { status: 409 });
      return receipt;
    };
    const receipt = previous(); if (receipt) return this.detail(receipt.id, userId);
    this.authority?.assert(stageId ? this.authority.stageScope(stageId) : 'system');
    if (receivedAt !== null && (!Number.isSafeInteger(receivedAt) || receivedAt > this.now())) throw Object.assign(new Error('Thời điểm nhận bài không hợp lệ.'), { status: 400 });
    if (stageId) this.stages.checkSubmission(stageId, userId, receivedAt ?? this.now());
    const id = crypto.randomUUID(); await fs.mkdir(this.folder(id), { recursive: true, mode: 0o755 });
    let inserted = false;
    try {
      const file = await fs.open(path.join(this.folder(id), 'upload.bin'), 'wx', 0o600);
      try { await file.writeFile(buffer); await file.sync(); } finally { await file.close(); }
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (!this.db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL AND locked=0").get(userId)) throw Object.assign(new Error('Tài khoản không còn quyền nộp bài.'), { status: 403 });
        const duplicate = previous();
        if (duplicate) { this.db.exec('COMMIT'); return this.detail(duplicate.id, userId); }
        const time = this.now();
        if (stageId) this.stages.checkSubmission(stageId, userId, receivedAt ?? time);
        if (this.db.prepare("SELECT COUNT(*) n FROM bot_submissions WHERE user_id=? AND job_status IN ('queued','running')").get(userId).n >= 3) throw Object.assign(new Error('Tối đa 3 bài đang chờ kiểm tra. Vui lòng chờ bài hiện tại hoàn tất.'), { status: 429 });
        const version = this.db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM bot_submissions WHERE user_id=?').get(userId).n;
        this.db.prepare('INSERT INTO bot_submissions(id,user_id,version,filename,entry,created_at,updated_at,stage_id,idempotency_key,upload_hash,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, userId, version, safe, entry || null, receivedAt ?? time, time, stageId, idempotencyKey, uploadHash, origin);
        this.event(id, 'Queued', 'Đã nhận bài, đang chờ bộ xử lý.');
        this.db.exec('COMMIT'); inserted = true;
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      this.pump(); return this.detail(id, userId);
    } finally { if (!inserted) await this.clean(id); }
  }
  // One version per (team, stage, commit): a second team pushing the same SHA still gets its own row and artifact.
  async submitCommit({ userId, stageId = null, repo, sha, origin, receivedAt = null }) {
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha) || !['button', 'tag', 'deadline'].includes(origin) || typeof repo !== 'string') throw Object.assign(new Error('Commit không hợp lệ.'), { status: 400 });
    if (stageId !== null && (typeof stageId !== 'string' || !this.stages)) throw Object.assign(new Error('Giai đoạn không hợp lệ.'), { status: 400 });
    const existing = () => this.db.prepare('SELECT id FROM bot_submissions WHERE user_id=? AND stage_id IS ? AND commit_sha=?').get(userId, stageId, sha);
    const found = existing(); if (found) return this.detail(found.id, userId);
    this.authority?.assert(stageId ? this.authority.stageScope(stageId) : 'system');
    // The deadline snapshot runs after closing, so it skips the window and queue checks that apply to teams.
    const deadline = origin === 'deadline';
    if (stageId && !deadline) this.stages.checkSubmission(stageId, userId);
    const id = crypto.randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL AND locked=0").get(userId)) throw Object.assign(new Error('Tài khoản không còn quyền nộp bài.'), { status: 403 });
      const duplicate = existing();
      if (duplicate) { this.db.exec('COMMIT'); return this.detail(duplicate.id, userId); }
      const time = this.now();
      if (stageId && !deadline) this.stages.checkSubmission(stageId, userId, time);
      if (!deadline && this.db.prepare("SELECT COUNT(*) n FROM bot_submissions WHERE user_id=? AND job_status IN ('queued','running')").get(userId).n >= 3) throw Object.assign(new Error('Tối đa 3 bài đang chờ kiểm tra. Vui lòng chờ bài hiện tại hoàn tất.'), { status: 429 });
      const version = this.db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM bot_submissions WHERE user_id=?').get(userId).n;
      this.db.prepare("INSERT INTO bot_submissions(id,user_id,version,filename,created_at,updated_at,stage_id,repo_full_name,commit_sha,origin) VALUES (?,?,?,'github.zip',?,?,?,?,?,?)")
        .run(id, userId, version, receivedAt ?? time, time, stageId, repo, sha, origin);
      this.event(id, 'Queued', `Đã nhận commit ${sha.slice(0, 7)} từ ${repo}${deadline ? ' (chụp tại hạn nộp)' : ''}, đang chờ bộ xử lý.`);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.pump(); return this.detail(id, userId);
  }
  activate(id, userId) {
    if (!this.db.prepare('SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL AND locked=0').get(userId)) throw Object.assign(new Error('Tài khoản không còn quyền chọn bot.'), { status: 403 });
    const row = this.owned(id, userId);
    if (!row) return false;
    if (row.stage_id) return this.stages.select(row.stage_id, userId, id);
    if (row.status !== 'Accepted') throw Object.assign(new Error('Chỉ có thể chọn phiên bản đã vượt qua kiểm tra (Accepted).'), { status: 409 });
    this.db.prepare('INSERT INTO active_bots VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET submission_id=excluded.submission_id').run(userId, id);
    return true;
  }
  retry(id, userId) {
    const row = this.owned(id, userId); if (!row) return false;
    if (row.job_status !== 'blocked' || row.error_type !== 'system') throw Object.assign(new Error('Chỉ có thể chạy lại bài đang tạm dừng do lỗi máy chủ.'), { status: 409 });
    this.db.prepare("UPDATE bot_submissions SET job_status='queued',status='Queued',attempts=0,available_at=0,reason=NULL,reason_code=NULL,error_type=NULL,updated_at=? WHERE id=?").run(this.now(), id);
    this.event(id, 'Queued', 'Thí sinh yêu cầu chạy lại bài sau lỗi máy chủ.'); this.pump(); return true;
  }
  start({ local = true } = {}) {
    if (this.started) return; this.started = true; this.local = local;
    // Checks held by this coordinator's previous process died with it; remote graders ("id:token") keep their lease.
    for (const row of this.db.prepare("SELECT id,attempts FROM bot_submissions WHERE job_status='running' AND worker_id NOT LIKE '%:%'").all()) {
      this.db.prepare("UPDATE bot_submissions SET job_status=?,status='Queued',worker_id=NULL,lease_until=NULL,error_type='system',reason_code='server_restarted',reason=?,updated_at=? WHERE id=?")
        .run(row.attempts >= 3 ? 'blocked' : 'queued', 'Máy chủ khởi động lại khi đang kiểm tra; giữ nguyên phiên bản và không xử lỗi bot.', this.now(), row.id);
      this.event(row.id, 'Queued', 'Máy chủ khởi động lại; đưa bài trở lại hàng đợi.');
    }
    if (local) { this.timer = setInterval(() => this.pump(), 500); this.timer.unref(); this.pump(); }
  }
  recover() {
    const expired = this.db.prepare("SELECT id,attempts FROM bot_submissions WHERE job_status='running' AND lease_until<?").all(this.now());
    for (const row of expired) {
      this.db.prepare("UPDATE bot_submissions SET job_status=?,status='Queued',worker_id=NULL,lease_until=NULL,error_type='system',reason_code='worker_interrupted',reason=?,updated_at=? WHERE id=? AND lease_until<?")
        .run(row.attempts >= 3 ? 'blocked' : 'queued', 'Worker bị ngắt; giữ nguyên phiên bản và không xử lỗi bot.', this.now(), row.id, this.now());
      this.event(row.id, 'Queued', 'Đưa bài trở lại hàng đợi vì bộ xử lý trước đã ngừng phản hồi.');
    }
  }
  claim(workerId = this.workerId) {
    this.recover();
    return this.db.prepare(`UPDATE bot_submissions SET job_status='running',worker_id=?,lease_until=?,attempts=attempts+1,updated_at=?
      WHERE id=(SELECT id FROM bot_submissions WHERE job_status='queued' AND available_at<=?
        AND CASE WHEN stage_id IS NULL THEN ${ownedSystem} ELSE ${ownedTournament('(SELECT tournament_id FROM tournament_stages WHERE id=bot_submissions.stage_id)')} END ORDER BY created_at,version LIMIT 1)
      RETURNING *`).get(workerId, this.now() + 30000, this.now(), this.now());
  }
  pump() {
    if (!this.started || this.closing || this.local === false) return;
    while (this.active.size < this.workers) {
      const row = this.claim(); if (!row) break;
      const task = this.process(row).catch(error => console.error('Submission worker:', error)).finally(() => { this.active.delete(row.id); this.pump(); });
      this.active.set(row.id, task);
    }
  }
  // Lease-checked writes; worker_id is the lease token for local and remote graders alike.
  stage(id, workerId, status, message, details) {
    const updated = this.db.prepare("UPDATE bot_submissions SET status=?,updated_at=? WHERE id=? AND worker_id=? AND job_status='running'").run(status, this.now(), id, workerId);
    if (!updated.changes) throw new InfrastructureError('lease_lost');
    this.event(id, status, message, details);
  }
  heartbeatCheck(id, workerId) { return this.db.prepare("UPDATE bot_submissions SET lease_until=? WHERE id=? AND worker_id=? AND job_status='running'").run(this.now() + 30000, id, workerId).changes > 0; }
  checkMeta(id, workerId, fields) {
    for (const key of ['language', 'entry', 'image', 'source_hash', 'compile_cpu_ms']) if (fields[key] !== undefined)
      this.db.prepare(`UPDATE bot_submissions SET ${key}=? WHERE id=? AND worker_id=?`).run(fields[key], id, workerId);
  }
  checkLive(id, replay) {
    if (replay) this.db.prepare("INSERT INTO live_matches VALUES (?,'submission',?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,replay_json=excluded.replay_json").run(id, id, this.now(), JSON.stringify(replay));
    else this.db.prepare('DELETE FROM live_matches WHERE id=?').run(id);
  }
  checkTest(id, workerId, { candidatePlayer, seed, replay }) {
    const row = this.db.prepare("SELECT attempts FROM bot_submissions WHERE id=? AND worker_id=? AND job_status='running'").get(id, workerId); if (!row) return;
    this.db.prepare('INSERT INTO submission_tests VALUES (?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), id, this.now(), row.attempts, candidatePlayer, seed, replay.rule_set_id, replay.rule_set_version, JSON.stringify(replay));
  }
  checkJob(row) {
    const stage = row.stage_id ? this.stages?.row(row.stage_id) : null;
    return { kind: 'submission', id: row.id, version: row.version, filename: row.filename, entry: row.entry || '', commit: row.commit_sha || null, image: row.image || null,
      rules: stage ? JSON.parse(stage.rules_json) : DEFAULT_RULES };
  }
  runCheck(job, hooks) { return runCheck(job, hooks, { extraScanner: this.extraScanner }); }
  async process(row) {
    const id = row.id, workerId = this.workerId;
    const heartbeat = setInterval(() => this.heartbeatCheck(id, workerId), 5000); heartbeat.unref();
    let problem;
    try {
      await this.clean(id, 'source'); await this.clean(id, 'artifact');
      await this.runCheck(this.checkJob(row), { manager: this.managerFactory(), directory: this.folder(id, 'source'),
        source: () => row.commit_sha ? this.repoSource(row) : fs.readFile(path.join(this.folder(id), 'upload.bin')),
        progress: (status, message, details) => this.stage(id, workerId, status, message, details),
        meta: fields => this.checkMeta(id, workerId, fields), live: replay => this.checkLive(id, replay), test: record => this.checkTest(id, workerId, record),
        keep: directory => fs.cp(directory, this.folder(id, 'artifact'), { recursive: true, errorOnExist: true, force: false }) });
    } catch (error) { problem = error; }
    finally { clearInterval(heartbeat); }
    this.completeCheck(id, workerId, problem);
  }
  repoSource(row) {
    if (!this.repos) throw new InfrastructureError('github_not_configured', 'Máy chủ chưa cấu hình GitHub App.');
    return this.repos.download(row);
  }
  // Returns false when the lease was lost, so a late or duplicate report changes nothing.
  completeCheck(id, workerId, problem) {
    const row = this.db.prepare("SELECT * FROM bot_submissions WHERE id=? AND worker_id=? AND job_status='running'").get(id, workerId);
    if (!row) return false;
    if (problem) {
      const botError = problem instanceof BotFault, blocked = !botError && row.attempts >= 3;
      this.db.prepare(`UPDATE bot_submissions SET status=?,job_status=?,worker_id=NULL,lease_until=NULL,available_at=?,
        error_type=?,reason_code=?,reason=?,updated_at=? WHERE id=?`).run(botError ? 'Rejected' : 'Queued', botError ? 'done' : blocked ? 'blocked' : 'queued', this.now() + this.retryDelayMs, botError ? 'bot' : 'system', problem.code || 'system_error', String(problem.message).slice(0, 65536), this.now(), id);
      this.event(id, botError ? 'Rejected' : 'Queued', botError ? `Bài bị từ chối: ${problem.message}` : `${blocked ? 'Tạm dừng sau tổng cộng 3 lần chạy gặp lỗi máy chủ' : 'Lỗi máy chủ; hệ thống sẽ tự chạy lại'}: ${problem.message}`, { type: botError ? 'bot' : 'system', code: problem.code, attempt: row.attempts });
      return true;
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE bot_submissions SET status='Accepted',job_status='done',worker_id=NULL,lease_until=NULL,error_type=NULL,reason_code=NULL,reason=NULL,updated_at=? WHERE id=?").run(this.now(), id);
      if (!row.stage_id) this.db.prepare(`INSERT INTO active_bots(user_id,submission_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET submission_id=excluded.submission_id
        WHERE (SELECT version FROM bot_submissions WHERE id=excluded.submission_id) > (SELECT version FROM bot_submissions WHERE id=active_bots.submission_id)`).run(row.user_id, id);
      this.event(id, 'Accepted', 'Bài nộp đã vượt qua kiểm tra mã nguồn, chuẩn bị chương trình và hai trận thử đổi bên.'); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return true;
  }
  async close() { this.closing = true; clearInterval(this.timer); await Promise.allSettled(this.active.values()); }
  async idle(timeoutMs = 120000) {
    const end = Date.now() + timeoutMs;
    while (this.active.size || this.db.prepare("SELECT 1 FROM bot_submissions WHERE job_status='queued' LIMIT 1").get()) {
      if (Date.now() > end) throw new Error('Queue idle timeout');
      this.pump(); await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}
module.exports = { SubmissionService };
