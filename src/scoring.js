const crypto = require('node:crypto');
const { createSandboxManager } = require('./sandbox');
const { runMatch, verifyReplay } = require('./game/match');
const { DEFAULT_RULES } = require('./game/engine');
const { LIMITS } = require('./game/protocol');
const bad = message => Object.assign(new Error(message), { status: 400 });
function validateGamesPerPair(value) {
  if (!Number.isInteger(value) || value < 1 || value > 20) throw bad('Số trận mỗi cặp phải là số nguyên từ 1 đến 20.');
}
function pairings(ids, { seed, gamesPerBot, gamesPerPair }) {
  if (typeof seed !== 'string' || !seed.length || seed.length > 100) throw bad('Chuỗi ghép cặp (seed) cần từ 1 đến 100 ký tự.');
  validateGamesPerPair(gamesPerPair);
  if (!Number.isInteger(gamesPerBot) || gamesPerBot < gamesPerPair || gamesPerBot % gamesPerPair) throw bad('Số ván mỗi bot phải chia hết cho số ván mỗi cặp.');
  const n = ids.length, degree = gamesPerBot / gamesPerPair;
  if (n < 2 || degree >= n || n * degree % 2 || n * gamesPerBot / 2 > 100000) throw bad('Cần ít nhất 2 bot đủ điều kiện. Số đối thủ của mỗi bot phải nhỏ hơn số bot; tổng số cặp phải là số nguyên và vòng đấu không vượt 100.000 ván. Với số bot lẻ, chọn số đối thủ chẵn.');
  // Hash-sort gives a stable seeded permutation independent of runtime RNG.
  const order = [...ids].sort((a, b) => {
    const hash = id => crypto.createHash('sha256').update(JSON.stringify([seed, id])).digest('hex');
    return hash(a).localeCompare(hash(b)) || a - b;
  });
  const pairs = [];
  for (let offset = 1; offset <= Math.floor(degree / 2); offset++) for (let i = 0; i < n; i++) pairs.push([order[i], order[(i + offset) % n]]);
  if (degree % 2) for (let i = 0; i < n / 2; i++) pairs.push([order[i], order[i + n / 2]]);
  return pairs.flatMap(([a, b], pair) => Array.from({ length: gamesPerPair }, (_, game) => ({
    players: game % 2 ? [b, a] : [a, b], seed: crypto.createHash('sha256').update(JSON.stringify([seed, pair, Math.floor(game / 2)])).digest('hex')
  })));
}
function elo(a, b, score) { const delta = 32 * (score - 1 / (1 + 10 ** ((b - a) / 400))); return [a + delta, b - delta]; }
function csvCell(value) { return '"' + String(value).replace(/^[=+@\-]/, "'$&").replaceAll('"', '""') + '"'; }
function automaticConfig(count, seed, gamesPerPair = 3) {
  if(!Number.isInteger(count)||count<2)throw bad('Cần ít nhất 2 thí sinh có bot sẵn sàng để tạo vòng.');
  validateGamesPerPair(gamesPerPair);
  if(count*(count-1)/2*gamesPerPair>100000)throw bad('Vòng tròn quá lớn: tối đa 100.000 trận. Giảm số trận mỗi cặp hoặc số bot tham gia.');
  return {mode:'round-robin',seed:seed||`vong-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,gamesPerPair,gamesPerBot:(count-1)*gamesPerPair};
}
class ScoringService {
  constructor(db, submissions, { managerFactory = () => createSandboxManager(), retryDelayMs = 3000, play } = {}) {
    this.db = db; this.submissions = submissions; this.managerFactory = managerFactory; this.retryDelayMs = retryDelayMs; this.playOverride = play;
    this.workerId = crypto.randomUUID(); this.active = null; this.started = false;
  }
  entrants() {
    return this.db.prepare("SELECT u.id,u.username,s.id submission_id,s.version FROM users u JOIN active_bots a ON a.user_id=u.id JOIN bot_submissions s ON s.id=a.submission_id WHERE u.role='contestant' AND u.locked=0 AND u.deleted_at IS NULL AND s.status='Accepted' ORDER BY u.id").all();
  }
  preview(gamesPerPair = 3) {
    validateGamesPerPair(gamesPerPair);
    const count=this.entrants().length,running=this.db.prepare("SELECT id FROM score_rounds WHERE status='running'").get();
    if(count<2)return {eligible:count,canStart:false,message:'Cần ít nhất 2 thí sinh có bot sẵn sàng. Hiện chưa đủ bot để tạo vòng.'};
    let config;
    try { config=automaticConfig(count,undefined,gamesPerPair); }
    catch(error){if(error.status!==400)throw error;return {eligible:count,canStart:false,message:error.message};}
    return {eligible:count,gamesPerPair:config.gamesPerPair,gamesPerBot:config.gamesPerBot,opponents:config.gamesPerBot/config.gamesPerPair,total:count*config.gamesPerBot/2,canStart:!running,message:running?'Vòng trước chưa hoàn tất. Chờ thi đấu xong hoặc xử lý các trận bị tạm dừng.':null};
  }
  create(userId, config = {}) {
    if (this.db.prepare("SELECT 1 FROM score_rounds WHERE status='running'").get()) throw Object.assign(new Error('Vòng tính điểm trước chưa hoàn tất. Chờ các trận kết thúc hoặc xử lý các trận đang tạm dừng.'), { status: 409 });
    const entrants = this.entrants();
    if(config.mode==='auto'||config.mode==='round-robin')config=automaticConfig(entrants.length,config.seed,config.gamesPerPair);
    const plan = pairings(entrants.map(e => e.id), config), id = crypto.randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO score_rounds(id,created_by,created_at,seed,config_json,rules_json) VALUES (?,?,?,?,?,?)').run(id, userId, Date.now(), config.seed, JSON.stringify({ mode:config.mode==='round-robin'?'round-robin':'manual',gamesPerBot: config.gamesPerBot, gamesPerPair: config.gamesPerPair, ratingStart: 1500, eloK: 32 }), JSON.stringify(DEFAULT_RULES));
      for (const e of entrants) this.db.prepare('INSERT INTO score_entrants(round_id,user_id,username,submission_id,version) VALUES (?,?,?,?,?)').run(id, e.id, e.username, e.submission_id, e.version);
      plan.forEach((m, sequence) => this.db.prepare('INSERT INTO score_matches(id,round_id,sequence,player0,player1,seed) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), id, sequence, ...m.players, m.seed));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.pump(); return id;
  }
  list() { return this.db.prepare('SELECT id,created_at,seed,status,config_json FROM score_rounds ORDER BY created_at DESC LIMIT 30').all().map(r => ({ ...r, config: JSON.parse(r.config_json), config_json: undefined })); }
  detail(id, page = 0) {
    const round = this.db.prepare('SELECT * FROM score_rounds WHERE id=?').get(id); if (!round) return null;
    return { ...round, config: JSON.parse(round.config_json), rules: JSON.parse(round.rules_json), config_json: undefined, rules_json: undefined,
      standings: this.db.prepare('SELECT * FROM score_entrants WHERE round_id=? ORDER BY rating DESC,points DESC,user_id').all(id),
      counts: this.db.prepare('SELECT status,COUNT(*) count FROM score_matches WHERE round_id=? GROUP BY status').all(id),
      page, total: this.db.prepare('SELECT COUNT(*) n FROM score_matches WHERE round_id=?').get(id).n,
      matches: this.db.prepare('SELECT id,sequence,player0,player1,seed,status,attempts,error,scored FROM score_matches WHERE round_id=? ORDER BY sequence DESC LIMIT 200 OFFSET ?').all(id, page * 200) };
  }
  match(id) {
    const row = this.db.prepare('SELECT * FROM score_matches WHERE id=?').get(id); if (!row) return null;
    return { id, seed: row.seed, status: row.status, error: row.error ? { message: row.error } : null, replay: JSON.parse(row.replay_json || row.live_json || 'null') };
  }
  export(id) {
    const round = this.detail(id); if (!round) return null;
    return '\uFEFF' + [['rank','username','version','elo','points','played','wins','draws','losses'], ...round.standings.map((e, i) => [i + 1, e.username, e.version, e.rating.toFixed(2), e.points, e.played, e.wins, e.draws, e.losses])].map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  start() { if (this.started) return; this.started = true; for (const round of this.db.prepare("SELECT id FROM score_rounds WHERE status='running'").all()) this.score(round.id); this.timer = setInterval(() => this.pump(), 500); this.timer.unref(); this.pump(); }
  pump() {
    if (!this.started || this.closing || this.active) return;
    this.db.prepare("UPDATE score_matches SET status=CASE WHEN attempts>=3 THEN 'blocked' ELSE 'queued' END,worker_id=NULL,error='Worker gián đoạn; không xử thua bot',live_json=NULL WHERE status='running' AND lease_until<?").run(Date.now());
    const row = this.db.prepare("UPDATE score_matches SET status='running',worker_id=?,lease_until=?,attempts=attempts+1,live_json=NULL WHERE id=(SELECT id FROM score_matches WHERE status='queued' AND available_at<=? ORDER BY rowid LIMIT 1) RETURNING *").get(this.workerId, Date.now() + 30000, Date.now());
    if (!row) return;
    this.active = this.execute(row).catch(error => console.error('Score worker:', error)).finally(() => { this.active = null; this.pump(); });
  }
  async play(row) {
    const manager = this.managerFactory(), sessions = [], entrants = [row.player0, row.player1].map(userId => this.db.prepare('SELECT s.*,e.username FROM score_entrants e JOIN bot_submissions s ON s.id=e.submission_id WHERE e.round_id=? AND e.user_id=?').get(row.round_id, userId));
    const rules = JSON.parse(this.db.prepare('SELECT rules_json FROM score_rounds WHERE id=?').get(row.round_id).rules_json);
    const onTurn = replay => this.db.prepare("UPDATE score_matches SET live_json=? WHERE id=? AND worker_id=? AND status='running'").run(JSON.stringify(replay), row.id, this.workerId);
    try {
      if (this.playOverride) return await this.playOverride(row, entrants, onTurn);
      manager.imageId = entrants[0].image; await manager.check();
      for (const e of entrants) sessions.push(await manager.start({ directory: this.submissions.folder(e.id, 'artifact'), language: e.language, entry: e.entry, image: e.image }, LIMITS));
      return await runMatch({ seed: row.seed, rules, bots: entrants.map(e => ({ id: e.username, submission_id: e.id, version: e.version, source_hash: e.source_hash, image: e.image })), choose: (player, request) => sessions[player].move(request), onTurn });
    } finally {
      const results = await Promise.allSettled(sessions.map(session => session.close()));
      const failure = results.find(r => r.status === 'rejected'); if (failure) throw failure.reason;
    }
  }
  async execute(row) {
    const heartbeat = setInterval(() => this.db.prepare("UPDATE score_matches SET lease_until=? WHERE id=? AND worker_id=? AND status='running'").run(Date.now() + 30000, row.id, this.workerId), 5000); heartbeat.unref();
    try {
      const replay = await this.play(row); verifyReplay(replay);
      this.db.prepare("UPDATE score_matches SET status='finished',replay_json=?,live_json=NULL,error=NULL,worker_id=NULL,lease_until=NULL WHERE id=? AND worker_id=? AND status='running'").run(JSON.stringify(replay), row.id, this.workerId);
      this.score(row.round_id);
    } catch (error) {
      this.db.prepare("UPDATE score_matches SET status=?,error=?,live_json=NULL,worker_id=NULL,lease_until=NULL,available_at=? WHERE id=? AND worker_id=? AND status='running'").run(row.attempts >= 3 ? 'blocked' : 'queued', `${error.code || 'system_error'}: ${error.message}`.slice(0, 65536), Date.now() + this.retryDelayMs, row.id, this.workerId);
    } finally { clearInterval(heartbeat); }
  }
  score(roundId) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Apply in scheduled order so retries and worker timing cannot change Elo.
      const rows = this.db.prepare('SELECT * FROM score_matches WHERE round_id=? AND scored=0 ORDER BY sequence').all(roundId);
      for (const row of rows) {
        if (row.status !== 'finished') break;
        const replay = JSON.parse(row.replay_json), winner = replay.result.winner;
        const players = [row.player0, row.player1].map(id => this.db.prepare('SELECT * FROM score_entrants WHERE round_id=? AND user_id=?').get(roundId, id));
        const scores = winner === null ? [0.5, 0.5] : winner === 0 ? [1, 0] : [0, 1], ratings = elo(players[0].rating, players[1].rating, scores[0]);
        players.forEach((e, p) => this.db.prepare('UPDATE score_entrants SET rating=?,played=played+1,points=points+?,wins=wins+?,draws=draws+?,losses=losses+? WHERE round_id=? AND user_id=?').run(ratings[p], scores[p], +(scores[p] === 1), +(scores[p] === 0.5), +(scores[p] === 0), roundId, e.user_id));
        this.db.prepare('UPDATE score_matches SET scored=1 WHERE id=?').run(row.id);
      }
      if (!this.db.prepare('SELECT 1 FROM score_matches WHERE round_id=? AND scored=0 LIMIT 1').get(roundId)) this.db.prepare("UPDATE score_rounds SET status='finished' WHERE id=?").run(roundId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  retry(id) { this.db.prepare("UPDATE score_matches SET status='queued',attempts=0,available_at=0 WHERE round_id=? AND status='blocked'").run(id); this.score(id); this.pump(); }
  async close() { this.closing = true; clearInterval(this.timer); await this.active; }
}
function registerScoring(app, { db, scoring, requireRole, csrf }) {
  app.get('/api/admin/score-plan', requireRole('admin'), (req,res)=>res.json(scoring.preview(req.query.gamesPerPair===undefined?undefined:Number(req.query.gamesPerPair))));
  app.get('/api/scores', requireRole(), (req, res) => res.json({ rounds: scoring.list() }));
  app.get('/api/scores/:id', requireRole(), (req, res) => { const page = Number(req.query.page || 0); if (!Number.isInteger(page) || page < 0 || page > 500) throw bad('Trang không hợp lệ.'); const round = scoring.detail(req.params.id, page); if (!round) return res.status(404).json({ error: 'Không tìm thấy vòng tính điểm.' }); if (req.auth.role !== 'admin') delete round.matches; res.json(round); });
  app.get('/api/admin/scores/:id/export', requireRole('admin'), (req, res) => { const csv = scoring.export(req.params.id); if (!csv) return res.sendStatus(404); res.attachment('standings.csv').type('text/csv').send(csv); });
  app.post('/api/admin/scores', requireRole('admin'), csrf, (req, res) => res.status(202).json({ id: scoring.create(req.auth.id, req.body || {}) }));
  app.post('/api/admin/scores/:id/retry', requireRole('admin'), csrf, (req, res) => { scoring.retry(req.params.id); res.json({ ok: true }); });
  app.get('/api/admin/score-matches/:id', requireRole('admin'), (req, res) => { const match = scoring.match(req.params.id); if (!match) return res.sendStatus(404); res.json(match); });
  app.get('/api/admin/live', requireRole('admin'), (req, res) => res.json({ matches: db.prepare('SELECT id,kind,owner_id,updated_at FROM live_matches WHERE updated_at>? ORDER BY updated_at DESC').all(Date.now()-30000), scoring: db.prepare("SELECT id,round_id,sequence,player0,player1 FROM score_matches WHERE status='running'").all() }));
  app.get('/api/admin/live/:id', requireRole('admin'), (req, res) => {
    const live = db.prepare('SELECT replay_json FROM live_matches WHERE id=? AND updated_at>?').get(req.params.id, Date.now()-30000);
    const row = live || db.prepare('SELECT replay_json FROM practice_matches WHERE id=? AND replay_json IS NOT NULL').get(req.params.id) || db.prepare('SELECT replay_json FROM submission_tests WHERE submission_id=? ORDER BY created_at DESC LIMIT 1').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Trận đang chuyển giai đoạn hoặc bị lỗi hạ tầng; xem hàng đợi để biết chi tiết.' });
    const replay = JSON.parse(row.replay_json); res.json({ replay, seed: replay.seed, status: live && !replay.result ? 'running' : 'finished' });
  });
}
module.exports = { pairings, elo, csvCell, automaticConfig, ScoringService, registerScoring };
