const crypto = require('node:crypto');
const { SandboxManager } = require('./docker');
const { SAMPLES, sampleSource } = require('./samples');
const { DEFAULT_RULES } = require('../game/engine');
const { runMatch, verifyReplay } = require('../game/match');
const { BotFault, LIMITS } = require('../game/protocol');

class MatchService {
  constructor(db, { manager = new SandboxManager(), retryDelayMs = 500 } = {}) {
    this.db = db; this.manager = manager; this.retryDelayMs = retryDelayMs; this.active = null;
    db.prepare("UPDATE practice_matches SET status='infrastructure_error',error_json=?,updated_at=? WHERE status='running'")
      .run(JSON.stringify({ code: 'server_restarted', message: 'Server restarted during a practice match; no bot forfeit.' }), Date.now());
  }
  list() {
    return this.db.prepare('SELECT id,created_at,status,seed,bots_json,attempts,error_json FROM practice_matches ORDER BY created_at DESC LIMIT 30').all()
      .map(row => ({ ...row, bots: JSON.parse(row.bots_json), error: row.error_json ? JSON.parse(row.error_json) : null, bots_json: undefined, error_json: undefined }));
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM practice_matches WHERE id=?').get(id);
    if (!row) return null;
    return { id: row.id, status: row.status, attempts: row.attempts, seed: row.seed, created_at: row.created_at,
      rules: JSON.parse(row.rules_json), bots: JSON.parse(row.bots_json), replay: row.replay_json ? JSON.parse(row.replay_json) : null,
      attempt_log: JSON.parse(row.attempt_log_json),
      error: row.error_json ? JSON.parse(row.error_json) : null };
  }
  create({ userId, botA, botB, seed }) {
    if (this.active) { const error = new Error('Đang có trận thử chạy. Vui lòng chờ hoàn tất.'); error.status = 409; throw error; }
    if (!Object.hasOwn(SAMPLES, botA) || !Object.hasOwn(SAMPLES, botB) || typeof seed !== 'string' || seed.length > 128) { const error = new Error('Bot mẫu hoặc seed không hợp lệ.'); error.status = 400; throw error; }
    const id = crypto.randomUUID(), time = Date.now();
    this.db.prepare(`INSERT INTO practice_matches(id,created_by,created_at,updated_at,status,seed,rules_json,bots_json)
      VALUES (?,?,?,?,'running',?,?,?)`).run(id, userId, time, time, seed, JSON.stringify(DEFAULT_RULES), JSON.stringify([botA, botB]));
    this.active = this.execute(id, [botA, botB], seed).finally(() => { this.active = null; });
    return id;
  }
  async execute(id, botIds, seed) {
    const attemptLog = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      this.db.prepare('UPDATE practice_matches SET attempts=?,updated_at=? WHERE id=?').run(attempt, Date.now(), id);
      try {
        const replay = await this.play(botIds, seed, progress => this.db.prepare("INSERT INTO live_matches VALUES (?,'practice',?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,replay_json=excluded.replay_json").run(id, id, Date.now(), JSON.stringify(progress)));
        verifyReplay(replay);
        this.db.prepare("UPDATE practice_matches SET status='finished',replay_json=?,error_json=NULL,updated_at=? WHERE id=?")
          .run(JSON.stringify(replay), Date.now(), id);
        return;
      } catch (error) {
        attemptLog.push({ attempt, code: error.code || 'system_error', message: error.message });
        this.db.prepare('UPDATE practice_matches SET attempt_log_json=? WHERE id=?').run(JSON.stringify(attemptLog), id);
        if (!(error instanceof BotFault) && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelayMs)); continue;
        }
        this.db.prepare('UPDATE practice_matches SET status=?,error_json=?,updated_at=? WHERE id=?')
          .run(error instanceof BotFault ? 'bot_error' : 'infrastructure_error', JSON.stringify({ code: error.code || 'system_error', message: error.message }), Date.now(), id);
        return;
      } finally { this.db.prepare('DELETE FROM live_matches WHERE id=?').run(id); }
    }
  }
  async play(botIds, seed, onTurn) {
    const artifacts = [], sessions = [];
    let failure;
    try {
      await this.manager.check();
      for (let player = 0; player < 2; player++) artifacts.push(await this.manager.prepare(sampleSource(botIds[player])));
      for (const artifact of artifacts) sessions.push(await this.manager.start(artifact, LIMITS));
      return await runMatch({ seed, onTurn, bots: botIds.map((id, p) => ({ id, source_hash: artifacts[p].hash, image: artifacts[p].image, compile_cpu_ms: artifacts[p].compile_cpu_ms })),
        choose: (player, request) => sessions[player].move(request) });
    } finally {
      for (const session of sessions) { try { await session.close(); } catch (error) { failure ||= error; } }
      for (const artifact of artifacts) { try { await this.manager.dispose(artifact); } catch (error) { failure ||= error; } }
      if (failure) throw failure;
    }
  }
}
module.exports = { MatchService };
