const crypto = require('node:crypto');
const { SandboxManager } = require('./docker');
const { SAMPLES, sampleSource } = require('./samples');
const { DEFAULT_RULES } = require('../game/engine');
const { runMatch, verifyReplay } = require('../game/match');
const { BotFault, LIMITS } = require('../game/protocol');
const { RuleSetService } = require('../rule-sets');

class MatchService {
  constructor(db, { manager = new SandboxManager(), retryDelayMs = 500, submissions, ruleSets } = {}) {
    this.db = db; this.manager = manager; this.retryDelayMs = retryDelayMs; this.active = null;
    this.submissions = submissions; this.ruleSets = ruleSets || new RuleSetService(db);
    db.prepare("UPDATE practice_matches SET status='infrastructure_error',error_json=?,updated_at=? WHERE status='running'")
      .run(JSON.stringify({ code: 'server_restarted', message: 'Server restarted during a practice match; no bot forfeit.' }), Date.now());
  }
  list() {
    return this.db.prepare('SELECT id,created_at,status,seed,bots_json,attempts,error_json,rule_set_id,rule_set_version FROM practice_matches ORDER BY created_at DESC LIMIT 30').all()
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
  botChoices() {
    return [...Object.keys(SAMPLES).map(id => ({ id, label: `Bot mẫu · ${id}` })),
      ...this.db.prepare("SELECT s.id,s.version,s.filename,u.username FROM bot_submissions s JOIN users u ON u.id=s.user_id WHERE s.status='Accepted' ORDER BY u.username,s.version DESC").all()
        .map(s => ({ id: `submission:${s.id}`, label: `${s.username} · v${s.version} · ${s.filename}` }))];
  }
  resolveBot(id) {
    if (typeof id !== 'string') throw Object.assign(new Error('Chọn bot từ danh sách.'), { status: 400 });
    if (Object.hasOwn(SAMPLES, id)) return { kind: 'sample', id };
    const match = /^submission:([0-9a-f-]{36})$/.exec(id);
    const row = match && this.db.prepare("SELECT s.*,u.username FROM bot_submissions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.status='Accepted'").get(match[1]);
    if (!row || !this.submissions) throw Object.assign(new Error('Bot không tồn tại hoặc chưa vượt qua kiểm tra.'), { status: 400 });
    return { kind: 'submission', id: row.id, label: `${row.username} · v${row.version}`, version:row.version, language:row.language,entry:row.entry,image:row.image,source_hash:row.source_hash };
  }
  create({ userId, botA, botB, seed, ruleSetId, ruleSetVersion }) {
    if (this.active) { const error = new Error('Đang có trận thử chạy. Vui lòng chờ hoàn tất.'); error.status = 409; throw error; }
    if (typeof seed !== 'string' || !seed.length || seed.length > 128) { const error = new Error('Seed cần 1–128 ký tự.'); error.status = 400; throw error; }
    const bots = [this.resolveBot(botA), this.resolveBot(botB)];
    const selected = this.ruleSets.get(ruleSetId || DEFAULT_RULES.id, ruleSetVersion === undefined ? (ruleSetId ? undefined : DEFAULT_RULES.version) : ruleSetVersion);
    if (!selected) throw Object.assign(new Error('Không tìm thấy phiên bản bộ luật.'), { status: 400 });
    const rules = selected.rules;
    const id = crypto.randomUUID(), time = Date.now();
    this.db.prepare(`INSERT INTO practice_matches(id,created_by,created_at,updated_at,status,seed,rules_json,bots_json,rule_set_id,rule_set_version,bot_snapshots_json)
      VALUES (?,?,?,?,'running',?,?,?,?,?,?)`).run(id, userId, time, time, seed, JSON.stringify(rules), JSON.stringify(bots.map(b=>b.label||b.id)), rules.id, rules.version, JSON.stringify(bots));
    this.active = this.execute(id, bots, seed, rules).finally(() => { this.active = null; });
    return id;
  }
  async execute(id, botIds, seed, rules = DEFAULT_RULES) {
    const attemptLog = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      this.db.prepare('UPDATE practice_matches SET attempts=?,updated_at=? WHERE id=?').run(attempt, Date.now(), id);
      try {
        const replay = await this.play(botIds, seed, progress => this.db.prepare("INSERT INTO live_matches VALUES (?,'practice',?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,replay_json=excluded.replay_json").run(id, id, Date.now(), JSON.stringify(progress)), rules);
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
  async play(botIds, seed, onTurn, rules = DEFAULT_RULES) {
    const artifacts = [], sessions = [];
    let failure;
    try {
      await this.manager.check();
      for (const bot of botIds) {
        if (bot.kind === 'sample') artifacts.push(await this.manager.prepare(sampleSource(bot.id)));
        else artifacts.push({ directory:this.submissions.folder(bot.id,'artifact'),language:bot.language,entry:bot.entry,image:bot.image,hash:bot.source_hash,persistent:true });
      }
      for (const artifact of artifacts) sessions.push(await this.manager.start(artifact, LIMITS));
      return await runMatch({ seed, rules, onTurn, bots: botIds.map((bot, p) => ({ id:bot.label||bot.id, submission_id:bot.kind==='submission'?bot.id:undefined,version:bot.version,source_hash: artifacts[p].hash, image: artifacts[p].image, compile_cpu_ms: artifacts[p].compile_cpu_ms })),
        choose: (player, request) => sessions[player].move(request) });
    } finally {
      for (const session of sessions) { try { await session.close(); } catch (error) { failure ||= error; } }
      for (const artifact of artifacts.filter(a=>!a.persistent)) { try { await this.manager.dispose(artifact); } catch (error) { failure ||= error; } }
      if (failure) throw failure;
    }
  }
}
module.exports = { MatchService };
