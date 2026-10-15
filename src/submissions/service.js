const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { SandboxManager } = require('../sandbox/docker');
const { sampleSource } = require('../sandbox/samples');
const { runMatch, verifyReplay } = require('../game/match');
const { DEFAULT_RULES } = require('../game/engine');
const { BotFault, InfrastructureError, LIMITS } = require('../game/protocol');
const { UPLOAD_LIMIT, FILE_LIMIT, safeName, extractSource, scanSource } = require('./source');

class SubmissionService {
  constructor(db, { storageRoot = process.env.SUBMISSIONS_PATH || path.resolve(__dirname, '../../data/submissions'), workers = Number(process.env.BOT_WORKERS || 2), managerFactory = () => new SandboxManager(), extraScanner, retryDelayMs = 3000, now = Date.now } = {}) {
    if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error('BOT_WORKERS must be 1–4');
    this.db = db; this.root = path.resolve(storageRoot); this.workers = workers; this.managerFactory = managerFactory;
    this.extraScanner = extraScanner; this.retryDelayMs = retryDelayMs; this.now = now;
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
  list(userId) {
    return this.db.prepare(`SELECT s.id,s.version,s.filename,s.entry,s.language,s.status,s.job_status,s.attempts,s.created_at,
      s.error_type,s.reason_code,s.reason,CASE WHEN a.submission_id=s.id THEN 1 ELSE 0 END AS active
      FROM bot_submissions s LEFT JOIN active_bots a ON a.user_id=s.user_id WHERE s.user_id=? ORDER BY s.version DESC LIMIT 100`).all(userId);
  }
  detail(id, userId) {
    const row = this.owned(id, userId); if (!row) return null;
    const active = this.db.prepare('SELECT 1 FROM active_bots WHERE user_id=? AND submission_id=?').get(userId, id);
    return { id: row.id, version: row.version, filename: row.filename, entry: row.entry, language: row.language,
      status: row.status, job_status: row.job_status, attempts: row.attempts, active: !!active, created_at: row.created_at,
      error_type: row.error_type, reason_code: row.reason_code, reason: row.reason, source_hash: row.source_hash, image: row.image,
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
  async submit({ userId, filename, buffer, entry = '' }) {
    let safe;
    try { safe = safeName(filename); } catch (error) { error.status = 400; throw error; }
    if (safe.includes('/') || !/\.(py|cpp|zip)$/.test(safe) || typeof entry !== 'string' || entry.length > 180) throw Object.assign(new Error('Chỉ nhận .py, .cpp hoặc .zip; file chạy chính tối đa 180 ký tự.'), { status: 400 });
    if (!Buffer.isBuffer(buffer) || buffer.length > UPLOAD_LIMIT || (!safe.endsWith('.zip') && buffer.length > FILE_LIMIT)) throw Object.assign(new Error('Một file mã nguồn tối đa 1 MiB; file ZIP tối đa 5 MiB.'), { status: 413 });
    const id = crypto.randomUUID(); await fs.mkdir(this.folder(id), { recursive: true, mode: 0o755 });
    let inserted = false;
    try {
      await fs.writeFile(path.join(this.folder(id), 'upload.bin'), buffer, { flag: 'wx', mode: 0o600 });
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (this.db.prepare("SELECT COUNT(*) n FROM bot_submissions WHERE user_id=? AND job_status IN ('queued','running')").get(userId).n >= 3) throw Object.assign(new Error('Tối đa 3 bài đang chờ kiểm tra. Vui lòng chờ bài hiện tại hoàn tất.'), { status: 429 });
        const version = this.db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM bot_submissions WHERE user_id=?').get(userId).n;
        const time = this.now();
        this.db.prepare('INSERT INTO bot_submissions(id,user_id,version,filename,entry,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, userId, version, safe, entry || null, time, time);
        this.event(id, 'Queued', 'Đã nhận bài, đang chờ bộ xử lý.');
        this.db.exec('COMMIT'); inserted = true;
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      this.pump(); return this.detail(id, userId);
    } finally { if (!inserted) await this.clean(id); }
  }
  activate(id, userId) {
    const row = this.owned(id, userId);
    if (!row) return false;
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
  start() {
    if (this.started) return; this.started = true;
    this.timer = setInterval(() => this.pump(), 500); this.timer.unref(); this.pump();
  }
  recover() {
    const expired = this.db.prepare("SELECT id,attempts FROM bot_submissions WHERE job_status='running' AND lease_until<?").all(this.now());
    for (const row of expired) {
      this.db.prepare("UPDATE bot_submissions SET job_status=?,status='Queued',worker_id=NULL,lease_until=NULL,error_type='system',reason_code='worker_interrupted',reason=?,updated_at=? WHERE id=? AND lease_until<?")
        .run(row.attempts >= 3 ? 'blocked' : 'queued', 'Worker bị ngắt; giữ nguyên phiên bản và không xử lỗi bot.', this.now(), row.id, this.now());
      this.event(row.id, 'Queued', 'Đưa bài trở lại hàng đợi vì bộ xử lý trước đã ngừng phản hồi.');
    }
  }
  claim() {
    this.recover();
    return this.db.prepare(`UPDATE bot_submissions SET job_status='running',worker_id=?,lease_until=?,attempts=attempts+1,updated_at=?
      WHERE id=(SELECT id FROM bot_submissions WHERE job_status='queued' AND available_at<=? ORDER BY created_at,version LIMIT 1)
      RETURNING *`).get(this.workerId, this.now() + 30000, this.now(), this.now());
  }
  pump() {
    if (!this.started || this.closing) return;
    while (this.active.size < this.workers) {
      const row = this.claim(); if (!row) break;
      const task = this.process(row).catch(error => console.error('Submission worker:', error)).finally(() => { this.active.delete(row.id); this.pump(); });
      this.active.set(row.id, task);
    }
  }
  stage(row, status, message, details) {
    const updated = this.db.prepare("UPDATE bot_submissions SET status=?,updated_at=? WHERE id=? AND worker_id=? AND job_status='running'").run(status, this.now(), row.id, this.workerId);
    if (!updated.changes) throw new InfrastructureError('lease_lost');
    this.event(row.id, status, message, details);
  }
  async process(row) {
    const manager = this.managerFactory(), artifacts = [], sessions = [];
    const heartbeat = setInterval(() => this.db.prepare("UPDATE bot_submissions SET lease_until=? WHERE id=? AND worker_id=? AND job_status='running'").run(this.now() + 30000, row.id, this.workerId), 5000);
    heartbeat.unref(); let problem;
    try {
      this.stage(row, 'Scanning', 'Đang giải nén, kiểm tra mã nguồn và các thao tác bị cấm.');
      await this.clean(row.id, 'source'); await this.clean(row.id, 'artifact');
      const buffer = await fs.readFile(path.join(this.folder(row.id), 'upload.bin'));
      const source = await extractSource({ buffer, filename: row.filename, entry: row.entry || '', directory: this.folder(row.id, 'source') });
      this.db.prepare('UPDATE bot_submissions SET language=?,entry=? WHERE id=? AND worker_id=?').run(source.language, source.entry, row.id, this.workerId);
      await scanSource(source, this.extraScanner);
      this.stage(row, 'Compiling', `Đang kiểm tra cú pháp hoặc biên dịch ${source.language === 'cpp' ? 'C++17' : 'Python'} trong Docker.`);
      if (row.image) manager.imageId = row.image;
      await manager.check();
      if (manager.imageId) this.db.prepare('UPDATE bot_submissions SET image=? WHERE id=? AND worker_id=?').run(manager.imageId, row.id, this.workerId);
      const candidate = await manager.prepare({ ...source, id: row.id }); artifacts.push(candidate);
      this.db.prepare('UPDATE bot_submissions SET source_hash=?,image=?,compile_cpu_ms=? WHERE id=? AND worker_id=?').run(candidate.hash, candidate.image, candidate.compile_cpu_ms, row.id, this.workerId);
      this.event(row.id, 'Compiling', 'Chuẩn bị chương trình thành công.', { cpu_ms: candidate.compile_cpu_ms, stderr: candidate.compile_stderr || '' });
      let reference;
      try { reference = await manager.prepare(sampleSource('python-greedy')); }
      catch (error) { if (error instanceof BotFault) throw new InfrastructureError('reference_compile_error', 'Không chuẩn bị được bot mẫu; không quy lỗi cho bài nộp.'); throw error; }
      artifacts.push(reference);
      this.stage(row, 'Test match', 'Đấu thử hai ván đổi bên với bot mẫu Python Greedy.');
      for (const candidatePlayer of [0, 1]) {
        const ordered = candidatePlayer === 0 ? [candidate, reference] : [reference, candidate];
        let replay;
        try {
          for (const artifact of ordered) sessions.push(await manager.start(artifact, LIMITS));
          const seed = `submission-${row.id}-side-${candidatePlayer}`;
          replay = await runMatch({ seed, onTurn: progress => this.db.prepare("INSERT INTO live_matches VALUES (?,'submission',?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,replay_json=excluded.replay_json").run(row.id, row.id, this.now(), JSON.stringify(progress)), bots: ordered.map((artifact, p) => ({ id: p === candidatePlayer ? `submission-v${row.version}` : 'python-greedy', submission_id: p === candidatePlayer ? row.id : undefined, source_hash: artifact.hash, image: artifact.image })), choose: (player, request) => sessions[player].move(request) });
          verifyReplay(replay);
          this.db.prepare('INSERT INTO submission_tests VALUES (?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), row.id, this.now(), row.attempts, candidatePlayer, seed, DEFAULT_RULES.id, DEFAULT_RULES.version, JSON.stringify(replay));
        } finally {
          this.db.prepare('DELETE FROM live_matches WHERE id=?').run(row.id);
          const results = await Promise.allSettled(sessions.splice(0).map(session => session.close()));
          const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
        }
        if (replay.fault?.player === candidatePlayer) throw new BotFault(replay.fault.code, replay.fault.message);
        if (replay.fault) throw new InfrastructureError('reference_bot_fault', 'Bot mẫu gặp lỗi; không quy lỗi cho bài nộp.');
      }
      await fs.cp(candidate.directory, this.folder(row.id, 'artifact'), { recursive: true, errorOnExist: true, force: false });
    } catch (error) { problem = error; }
    finally {
      for (const session of sessions) { try { await session.close(); } catch (error) { problem = error; } }
      for (const artifact of artifacts) { try { await manager.dispose(artifact); } catch (error) { problem = error; } }
      clearInterval(heartbeat);
    }
    const ownsLease = this.db.prepare("SELECT 1 FROM bot_submissions WHERE id=? AND worker_id=? AND job_status='running'").get(row.id, this.workerId);
    if (!ownsLease) return;
    if (problem) {
      const botError = problem instanceof BotFault, blocked = !botError && row.attempts >= 3;
      this.db.prepare(`UPDATE bot_submissions SET status=?,job_status=?,worker_id=NULL,lease_until=NULL,available_at=?,
        error_type=?,reason_code=?,reason=?,updated_at=? WHERE id=?`).run(botError ? 'Rejected' : 'Queued', botError ? 'done' : blocked ? 'blocked' : 'queued', this.now() + this.retryDelayMs, botError ? 'bot' : 'system', problem.code || 'system_error', problem.message.slice(0,65536), this.now(), row.id);
      this.event(row.id, botError ? 'Rejected' : 'Queued', botError ? `Bài bị từ chối: ${problem.message}` : `${blocked ? 'Tạm dừng sau tổng cộng 3 lần chạy gặp lỗi máy chủ' : 'Lỗi máy chủ; hệ thống sẽ tự chạy lại'}: ${problem.message}`, { type: botError ? 'bot' : 'system', code: problem.code, attempt: row.attempts });
      return;
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE bot_submissions SET status='Accepted',job_status='done',worker_id=NULL,lease_until=NULL,error_type=NULL,reason_code=NULL,reason=NULL,updated_at=? WHERE id=?").run(this.now(), row.id);
      this.db.prepare(`INSERT INTO active_bots(user_id,submission_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET submission_id=excluded.submission_id
        WHERE (SELECT version FROM bot_submissions WHERE id=excluded.submission_id) > (SELECT version FROM bot_submissions WHERE id=active_bots.submission_id)`).run(row.user_id, row.id);
      this.event(row.id, 'Accepted', 'Bài nộp đã vượt qua kiểm tra mã nguồn, chuẩn bị chương trình và hai trận thử đổi bên.'); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
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
