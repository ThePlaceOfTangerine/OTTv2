const crypto = require('node:crypto');
const { SandboxManager } = require('./sandbox/docker');
const { runMatch, verifyReplay } = require('./game/match');
const { LIMITS } = require('./game/protocol');
const { csvCell } = require('./scoring');
const { standings, pairRound, digest } = require('./swiss-pairing');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

class SwissService {
  constructor(db, { tournaments, submissions, now = Date.now, managerFactory = () => new SandboxManager(), play, retryDelayMs = 3000 }) {
    Object.assign(this, { db, tournaments, submissions, now, managerFactory, playOverride: play, retryDelayMs });
    this.workerId = crypto.randomUUID(); this.active = null; this.started = false; this.closing = false;
  }
  stage(id) { return this.db.prepare("SELECT * FROM tournament_stages WHERE tournament_id=? AND kind='qualifier'").get(id); }
  controlRow(stageId) { return this.db.prepare('SELECT * FROM swiss_controls WHERE stage_id=?').get(stageId); }
  entrants(stageId) {
    return this.db.prepare('SELECT user_id,username,snapshot_json FROM tournament_stage_entrants WHERE stage_id=? AND locked_submission_id IS NOT NULL ORDER BY user_id').all(stageId)
      .map(row => ({ userId: row.user_id, username: row.username, ...JSON.parse(row.snapshot_json) }));
  }
  pairs(stageId) { return this.db.prepare('SELECT p.* FROM swiss_pairs p JOIN swiss_rounds r ON r.id=p.round_id WHERE r.stage_id=? ORDER BY r.number,p.rowid').all(stageId); }
  ranking(stageId) {
    const session = this.db.prepare('SELECT * FROM swiss_sessions WHERE stage_id=?').get(stageId);
    return session ? standings(this.entrants(stageId), this.pairs(stageId), session.seed) : [];
  }
  qualification(id) {
    const row = this.db.prepare('SELECT * FROM tournament_qualifications WHERE tournament_id=?').get(id);
    if (!row) return null;
    const snapshot = JSON.parse(row.snapshot_json);
    return { topN: row.top_n, approvedAt: row.approved_at, approvedBy: row.approved_by,
      teams: snapshot.teams.map(e => ({ seed: e.rank, userId: e.userId, username: e.username, version: e.version,
        points: e.points, buchholz: e.buchholz, sonnebornBerger: e.sonnebornBerger, gamePoints: e.gamePoints })) };
  }
  approve(id, actorId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['expectedRevision', 'swissRevision', 'topN', 'reason'].includes(k))
      || !Number.isInteger(body.expectedRevision) || !Number.isInteger(body.swissRevision)
      || !Number.isInteger(body.topN) || body.topN < 2 || body.topN > 256
      || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 1000) fail(400, 'Cần số đội đi tiếp từ 2 đến 256, lý do duyệt và phiên bản dữ liệu hợp lệ.');
    return this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const tournament = this.tournaments.row(id); if (!tournament) return null;
      const stage = this.stage(id), session = stage && this.db.prepare('SELECT * FROM swiss_sessions WHERE stage_id=?').get(stage.id);
      if (tournament.revision !== body.expectedRevision || session?.revision !== body.swissRevision) fail(409, 'Dữ liệu giải hoặc bảng điểm đã thay đổi. Tải lại trước khi duyệt.');
      if (tournament.status !== 'provisional' || session.status !== 'finished'
        || this.db.prepare("SELECT 1 FROM swiss_rounds WHERE stage_id=? AND status<>'finished'").get(stage.id)
        || this.db.prepare('SELECT COUNT(*) n FROM swiss_rounds WHERE stage_id=?').get(stage.id).n !== session.rounds) fail(409, 'Chỉ duyệt đội đi tiếp sau khi hoàn tất toàn bộ vòng loại.');
      if (this.qualification(id)) fail(409, 'Danh sách đội đi tiếp đã chốt, không thể duyệt lại.');
      const ranking = this.ranking(stage.id);
      if (body.topN > ranking.length) fail(400, 'Số đội đi tiếp vượt số đội đã thi đấu vòng loại.');
      const teams = ranking.slice(0, body.topN);
      if (teams.some(e => !this.db.prepare('SELECT 1 FROM users WHERE id=? AND locked=0 AND deleted_at IS NULL').get(e.userId))) fail(409, 'Có đội đi tiếp bị khóa hoặc đã xóa. Cần xử lý tài khoản trước khi duyệt; hệ thống không tự bỏ qua thứ hạng.');
      const bots = new Map(this.entrants(stage.id).map(e => [e.userId, e]));
      const time = this.now(), snapshot = { ranking, teams: teams.map(e => ({ ...e, bot: bots.get(e.userId) })), rules: JSON.parse(stage.rules_json), config: JSON.parse(stage.config_json), seed: session.seed };
      this.db.prepare('INSERT INTO tournament_qualifications VALUES (?,?,?,?,?,?,?,?)').run(id, stage.id, actorId, time, body.topN, session.revision, body.reason.trim(), JSON.stringify(snapshot));
      this.db.prepare('UPDATE tournaments SET revision=revision+1,updated_at=? WHERE id=?').run(time, id);
      this.tournaments.event(id, actorId, 'qualification_approved', { topN: body.topN, swissRevision: session.revision, userIds: teams.map(e => e.userId), reason: body.reason.trim() });
      return this.get(id);
    });
  }
  get(id, admin = true) {
    const stage = this.stage(id); if (!stage) return null;
    const session = this.db.prepare('SELECT * FROM swiss_sessions WHERE stage_id=?').get(stage.id);
    const count = this.entrants(stage.id).length, config = JSON.parse(stage.config_json);
    const preview = { eligible: count, rounds: config.swissRounds, gamesPerPair: config.gamesPerPair,
      totalGames: Math.floor(count / 2) * config.swissRounds * config.gamesPerPair };
    if (!session) return { stageId: stage.id, status: 'not_started', preview, standings: [], rounds: [] };
    const rounds = this.db.prepare('SELECT id,number,status FROM swiss_rounds WHERE stage_id=? ORDER BY number').all(stage.id);
    const result = { stageId: stage.id, status: this.controlRow(stage.id)?.status || session.status, controlReason: this.controlRow(stage.id)?.reason || null, revision: session.revision, seed: session.seed,
      preview, standings: this.ranking(stage.id), rounds, qualification: this.qualification(id) };
    if (admin) result.pairs = this.pairs(stage.id).map(pair => ({ ...pair,
      games: this.db.prepare('SELECT id,number,player0,player1,seed,status,attempts,error FROM swiss_games WHERE pair_id=? ORDER BY number').all(pair.id) }));
    return result;
  }
  input(body, seedAllowed = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['expectedRevision', ...(seedAllowed ? ['seed'] : [])].includes(key))) fail(400, 'Thông tin thao tác vòng loại không hợp lệ.');
    if (!Number.isInteger(body.expectedRevision)) fail(409, 'Cần expectedRevision. Tải lại dữ liệu trước khi thao tác.');
  }
  create(id, actorId, body) {
    this.input(body, true);
    if (body.seed !== undefined && (typeof body.seed !== 'string' || !body.seed.trim() || body.seed.length > 100)) fail(400, 'Mã ghép lịch cần từ 1 đến 100 ký tự.');
    const result = this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const tournament = this.tournaments.row(id); if (!tournament) return null;
      if (tournament.status !== 'locked' || tournament.revision !== body.expectedRevision) fail(409, 'Giải chưa chốt bot hoặc dữ liệu đã thay đổi.');
      const stage = this.stage(id), entrants = stage && this.entrants(stage.id);
      if (!stage || stage.status !== 'locked' || entrants.length < 2 || entrants.length > 256) fail(409, 'Vòng loại cần từ 2 đến 256 bot đã chốt.');
      const config = JSON.parse(stage.config_json);
      if (config.swissRounds >= entrants.length) fail(409, 'Số lượt đấu vòng loại phải nhỏ hơn số đội có bot đã chốt. Cần cấu hình phù hợp trước khi mở giải.');
      if (this.db.prepare('SELECT 1 FROM swiss_sessions WHERE stage_id=?').get(stage.id)) fail(409, 'Giải đã có vòng loại tính điểm.');
      const seed = body.seed || crypto.randomBytes(24).toString('hex');
      this.db.prepare("INSERT INTO swiss_sessions(stage_id,seed,rounds,games_per_pair,status,created_at) VALUES (?,?,?,?,'running',?)").run(stage.id, seed, config.swissRounds, config.gamesPerPair, this.now());
      this.plan(stage.id);
      this.db.prepare("UPDATE tournaments SET status='running',revision=revision+1,updated_at=? WHERE id=?").run(this.now(), id);
      this.tournaments.event(id, actorId, 'swiss_started', { stageId: stage.id, seed, rounds: config.swissRounds });
      return this.get(id);
    });
    this.pump(); return result;
  }
  plan(stageId) {
    const session = this.db.prepare('SELECT * FROM swiss_sessions WHERE stage_id=?').get(stageId);
    const last = this.db.prepare('SELECT * FROM swiss_rounds WHERE stage_id=? ORDER BY number DESC LIMIT 1').get(stageId);
    if (session.status !== 'running' || this.controlRow(stageId) || last?.status === 'running' || (last?.number || 0) >= session.rounds) fail(409, 'Không thể tạo vòng tiếp theo khi vòng hiện tại chưa xong hoặc giải đã đủ vòng.');
    const number = (last?.number || 0) + 1;
    const plan = pairRound(this.ranking(stageId), this.pairs(stageId));
    const roundId = crypto.randomUUID();
    this.db.prepare("INSERT INTO swiss_rounds VALUES (?,?,?,'running')").run(roundId, stageId, number);
    if (plan.bye !== null) this.db.prepare("INSERT INTO swiss_pairs VALUES (?,?,?,NULL,'finished',2,0,0,0)").run(crypto.randomUUID(), roundId, plan.bye);
    plan.pairs.forEach(([user0, user1], index) => {
      const pairId = crypto.randomUUID(), flip = parseInt(digest([session.seed, number, index, 'side']).slice(0, 2), 16) % 2;
      this.db.prepare("INSERT INTO swiss_pairs(id,round_id,user0,user1,status) VALUES (?,?,?,?,'queued')").run(pairId, roundId, user0, user1);
      for (let game = 0; game < session.games_per_pair; game++) {
        const players = (game + flip) % 2 ? [user1, user0] : [user0, user1];
        this.db.prepare('INSERT INTO swiss_games(id,pair_id,number,player0,player1,seed) VALUES (?,?,?,?,?,?)')
          .run(crypto.randomUUID(), pairId, game + 1, ...players, digest([session.seed, number, user0, user1, Math.floor(game / 2)]));
      }
    });
    this.db.prepare('UPDATE swiss_sessions SET revision=revision+1 WHERE stage_id=?').run(stageId);
    return roundId;
  }
  next(id, actorId, body) {
    this.input(body);
    const result = this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const stage = this.stage(id); if (!stage) return null;
      const session = this.db.prepare('SELECT * FROM swiss_sessions WHERE stage_id=?').get(stage.id);
      if (!session || session.revision !== body.expectedRevision) fail(409, 'Swiss đã thay đổi hoặc chưa bắt đầu. Tải lại dữ liệu.');
      const roundId = this.plan(stage.id);
      this.tournaments.event(id, actorId, 'swiss_round_created', { roundId });
      return this.get(id);
    });
    this.pump(); return result;
  }
  settle(stageId, nested = false) {
    const apply = () => {
      if (this.controlRow(stageId)) return;
      const queued = this.db.prepare("SELECT p.* FROM swiss_pairs p JOIN swiss_rounds r ON r.id=p.round_id WHERE r.stage_id=? AND p.status='queued'").all(stageId);
      for (const pair of queued) {
        const games = this.db.prepare('SELECT * FROM swiss_games WHERE pair_id=? ORDER BY number').all(pair.id);
        if (!games.length || games.some(game => game.status !== 'finished')) continue;
        let a = 0, b = 0;
        for (const game of games) {
          const replay = JSON.parse(game.replay_json), winner = replay.result.winner;
          if (winner === null) { a++; b++; }
          else if ([game.player0, game.player1][winner] === pair.user0) a += 2; else b += 2;
        }
        this.db.prepare("UPDATE swiss_pairs SET status='finished',result0_units=?,result1_units=?,game0_units=?,game1_units=? WHERE id=?")
          .run(a === b ? 1 : a > b ? 2 : 0, a === b ? 1 : b > a ? 2 : 0, a, b, pair.id);
      }
      const rounds = this.db.prepare("SELECT * FROM swiss_rounds WHERE stage_id=? AND status='running'").all(stageId);
      for (const round of rounds) {
        if (this.db.prepare("SELECT 1 FROM swiss_pairs WHERE round_id=? AND status<>'finished' LIMIT 1").get(round.id)) continue;
        this.db.prepare("UPDATE swiss_rounds SET status='finished' WHERE id=?").run(round.id);
        this.db.prepare('UPDATE swiss_sessions SET revision=revision+1 WHERE stage_id=?').run(stageId);
        const stage = this.db.prepare('SELECT tournament_id FROM tournament_stages WHERE id=?').get(stageId);
        const tournament = this.tournaments.row(stage.tournament_id);
        this.tournaments.event(tournament.id, tournament.created_by, 'swiss_round_finished', { round: round.number, automatic: true });
        const session = this.db.prepare('SELECT rounds FROM swiss_sessions WHERE stage_id=?').get(stageId);
        if (round.number === session.rounds) {
          this.db.prepare("UPDATE swiss_sessions SET status='finished' WHERE stage_id=?").run(stageId);
          this.db.prepare("UPDATE tournaments SET status='provisional',revision=revision+1,updated_at=? WHERE id=?").run(this.now(), tournament.id);
        }
      }
    };
    if (nested) apply(); else this.tournaments.transaction(apply);
  }
  start() {
    if (this.started) return; this.started = true;
    for (const session of this.db.prepare("SELECT stage_id FROM swiss_sessions WHERE status='running'").all()) this.settle(session.stage_id);
    this.timer = setInterval(() => this.pump(), 500); this.timer.unref(); this.pump();
  }
  control(id, actorId, body, operation) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['expectedRevision','reason'].includes(k)) || !Number.isInteger(body.expectedRevision) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) fail(400, 'Cần phiên bản vòng loại và lý do thao tác (1–1000 ký tự).');
    const result = this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const stage = this.stage(id); if (!stage) return null;
      const session = this.db.prepare('SELECT * FROM swiss_sessions WHERE stage_id=?').get(stage.id), control = this.controlRow(stage.id);
      if (!session || session.status !== 'running' || session.revision !== body.expectedRevision || control?.status === 'cancelled') fail(409, 'Vòng loại đã thay đổi, chưa bắt đầu hoặc đã kết thúc.');
      if (operation === 'pause' && control || operation === 'resume' && control?.status !== 'paused') fail(409, 'Trạng thái không phù hợp với thao tác.');
      if (operation === 'cancel' && (control?.status !== 'paused' || this.db.prepare("SELECT 1 FROM swiss_games g JOIN swiss_pairs p ON p.id=g.pair_id JOIN swiss_rounds r ON r.id=p.round_id WHERE r.stage_id=? AND g.status='running'").get(stage.id))) fail(409, 'Cần tạm dừng và chờ ván đang chạy hoàn tất trước khi hủy.');
      if (operation === 'resume') this.db.prepare('DELETE FROM swiss_controls WHERE stage_id=?').run(stage.id);
      else this.db.prepare('INSERT INTO swiss_controls VALUES (?,?,?,?) ON CONFLICT(stage_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,changed_at=excluded.changed_at').run(stage.id, operation === 'pause' ? 'paused' : 'cancelled', body.reason.trim(), this.now());
      this.db.prepare('UPDATE swiss_sessions SET revision=revision+1 WHERE stage_id=?').run(stage.id);
      this.db.prepare("UPDATE tournaments SET status=CASE WHEN ?='cancel' THEN 'cancelled' ELSE status END,revision=revision+1,updated_at=? WHERE id=?").run(operation, this.now(), id);
      this.tournaments.event(id, actorId, 'swiss_' + operation, { reason: body.reason.trim() });
      if (operation === 'resume') this.settle(stage.id, true);
      return this.get(id);
    }); this.pump(); return result;
  }
  pause(id, actorId, body) { return this.control(id, actorId, body, 'pause'); }
  resume(id, actorId, body) { return this.control(id, actorId, body, 'resume'); }
  cancel(id, actorId, body) { return this.control(id, actorId, body, 'cancel'); }
  pump() {
    if (!this.started || this.closing || this.active) return;
    this.db.prepare("UPDATE swiss_games SET status=CASE WHEN attempts>=3 THEN 'blocked' ELSE 'queued' END,worker_id=NULL,lease_until=NULL,live_json=NULL,error='Worker gián đoạn; không xử thua bot' WHERE status='running' AND lease_until<?").run(this.now());
    const row = this.db.prepare(`UPDATE swiss_games SET status='running',worker_id=?,lease_until=?,attempts=attempts+1
      WHERE id=(SELECT g.id FROM swiss_games g JOIN swiss_pairs p ON p.id=g.pair_id JOIN swiss_rounds r ON r.id=p.round_id
        JOIN swiss_sessions s ON s.stage_id=r.stage_id WHERE g.status='queued' AND g.available_at<=? AND r.status='running' AND s.status='running' AND NOT EXISTS (SELECT 1 FROM swiss_controls c WHERE c.stage_id=s.stage_id) ORDER BY g.rowid LIMIT 1) RETURNING *`)
      .get(this.workerId, this.now() + 30000, this.now());
    if (!row) return;
    this.active = this.execute(row).catch(error => console.error('Swiss worker:', error)).finally(() => { this.active = null; this.pump(); });
  }
  async play(row) {
    const stage = this.db.prepare('SELECT s.* FROM tournament_stages s JOIN swiss_rounds r ON r.stage_id=s.id JOIN swiss_pairs p ON p.round_id=r.id WHERE p.id=?').get(row.pair_id);
    const entrants = [row.player0, row.player1].map(userId => this.db.prepare('SELECT username,snapshot_json FROM tournament_stage_entrants WHERE stage_id=? AND user_id=?').get(stage.id, userId))
      .map(e => ({ username: e.username, ...JSON.parse(e.snapshot_json) }));
    const rules = JSON.parse(stage.rules_json);
    const onTurn = replay => this.db.prepare("UPDATE swiss_games SET live_json=? WHERE id=? AND worker_id=? AND status='running'").run(JSON.stringify(replay), row.id, this.workerId);
    if (this.playOverride) return this.playOverride(row, { entrants, rules, onTurn });
    const manager = this.managerFactory(), sessions = [];
    try {
      manager.imageId = entrants[0].image; await manager.check();
      for (const e of entrants) sessions.push(await manager.start({ directory: this.submissions.folder(e.submissionId, 'artifact'), language: e.language, entry: e.entry, image: e.image }, LIMITS));
      return await runMatch({ seed: row.seed, rules, onTurn, bots: entrants.map(e => ({ id: e.username, submission_id: e.submissionId, version: e.version, source_hash: e.sourceHash, image: e.image })),
        choose: (player, request) => sessions[player].move(request) });
    } finally {
      const results = await Promise.allSettled(sessions.map(session => session.close()));
      const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
    }
  }
  async execute(row) {
    const heartbeat = setInterval(() => this.db.prepare("UPDATE swiss_games SET lease_until=? WHERE id=? AND worker_id=? AND status='running'").run(this.now() + 30000, row.id, this.workerId), 5000); heartbeat.unref();
    try {
      const replay = await this.play(row); verifyReplay(replay);
      const saved = this.db.prepare("UPDATE swiss_games SET status='finished',replay_json=?,live_json=NULL,error=NULL,worker_id=NULL,lease_until=NULL WHERE id=? AND worker_id=? AND status='running'").run(JSON.stringify(replay), row.id, this.workerId);
      if (saved.changes) {
        const stage = this.db.prepare('SELECT r.stage_id FROM swiss_rounds r JOIN swiss_pairs p ON p.round_id=r.id WHERE p.id=?').get(row.pair_id);
        this.settle(stage.stage_id);
      }
    } catch (error) {
      this.db.prepare("UPDATE swiss_games SET status=?,worker_id=NULL,lease_until=NULL,live_json=NULL,error=?,available_at=? WHERE id=? AND worker_id=? AND status='running'")
        .run(row.attempts >= 3 ? 'blocked' : 'queued', String(error.message).slice(0, 65536), this.now() + this.retryDelayMs, row.id, this.workerId);
    } finally { clearInterval(heartbeat); }
  }
  retry(gameId, actorId, body) {
    if (!body || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) fail(400, 'Cần lý do chạy lại tối đa 500 ký tự.');
    const result = this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const row = this.db.prepare('SELECT g.status,s.tournament_id FROM swiss_games g JOIN swiss_pairs p ON p.id=g.pair_id JOIN swiss_rounds r ON r.id=p.round_id JOIN tournament_stages s ON s.id=r.stage_id WHERE g.id=?').get(gameId);
      if (!row) return null;
      if (row.status !== 'blocked' || this.get(row.tournament_id).status !== 'running') fail(409, 'Chỉ chạy lại ván bị dừng do lỗi hạ tầng.');
      this.db.prepare("UPDATE swiss_games SET status='queued',attempts=0,available_at=0,error=NULL WHERE id=?").run(gameId);
      this.tournaments.event(row.tournament_id, actorId, 'swiss_game_retried', { gameId, reason: body.reason });
      return { ok: true };
    });
    this.pump(); return result;
  }
  match(gameId) {
    const game = this.db.prepare('SELECT * FROM swiss_games WHERE id=?').get(gameId); if (!game) return null;
    return { id: game.id, status: game.status, seed: game.seed, error: game.error ? { message: game.error } : null,
      replay: JSON.parse(game.replay_json || game.live_json || 'null') };
  }
  export(id) {
    const result = this.get(id, false); if (!result) return null;
    return '\uFEFF' + [['rank', 'username', 'version', 'swiss_points', 'buchholz', 'sonneborn_berger', 'game_points', 'wins', 'draws', 'losses', 'byes'],
      ...result.standings.map(e => [e.rank, e.username, e.version, e.points, e.buchholz, e.sonnebornBerger, e.gamePoints, e.wins, e.draws, e.losses, e.byes])]
      .map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  async close() { this.closing = true; clearInterval(this.timer); await this.active; }
}
function registerSwiss(app, { swiss, stages, requireRole, csrf }) {
  const send = (res, value) => value ? res.json(value) : res.status(404).json({ error: 'Không tìm thấy vòng loại tính điểm.' });
  app.get('/api/admin/tournaments/:id/swiss', requireRole('admin'), (req, res) => send(res, swiss.get(req.params.id)));
  app.post('/api/admin/tournaments/:id/swiss/approve', requireRole('admin'), csrf, (req, res) => send(res, swiss.approve(req.params.id, req.auth.id, req.body)));
  for (const action of ['start', 'next', 'pause', 'resume', 'cancel']) app.post(`/api/admin/tournaments/:id/swiss/${action}`, requireRole('admin'), csrf,
    (req, res) => send(res, swiss[action === 'start' ? 'create' : action](req.params.id, req.auth.id, req.body)));
  app.get('/api/admin/tournaments/:id/swiss/export', requireRole('admin'), (req, res) => {
    const csv = swiss.export(req.params.id); if (csv === null) return res.sendStatus(404); res.attachment('swiss-standings.csv').type('text/csv').send(csv);
  });
  app.get('/api/admin/swiss-games/:id', requireRole('admin'), (req, res) => send(res, swiss.match(req.params.id)));
  app.post('/api/admin/swiss-games/:id/retry', requireRole('admin'), csrf, (req, res) => send(res, swiss.retry(req.params.id, req.auth.id, req.body)));
  app.get('/api/portal/tournaments/:id/swiss', requireRole('contestant'), (req, res) => {
    const stage = swiss.stage(req.params.id);
    if (!stage || !stages.forUser(stage.id, req.auth.id)) return res.status(404).json({ error: 'Không tìm thấy giải của bạn.' });
    send(res, swiss.get(req.params.id, false));
  });
}
module.exports = { SwissService, registerSwiss };
