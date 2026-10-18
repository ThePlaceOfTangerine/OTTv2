const crypto = require('node:crypto');
const { SandboxManager } = require('./sandbox/docker');
const { runMatch, verifyReplay } = require('./game/match');
const { LIMITS } = require('./game/protocol');
const { digest } = require('./swiss-pairing');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

class BracketRunner {
  constructor(db, { tournaments, brackets, submissions, now = Date.now, play, managerFactory = () => new SandboxManager(), retryDelayMs = 3000 }) {
    Object.assign(this, { db, tournaments, brackets, submissions, now, playOverride: play, managerFactory, retryDelayMs });
    this.workerId = crypto.randomUUID(); this.active = null; this.started = false; this.closing = false;
  }
  row(id) { return this.db.prepare('SELECT * FROM bracket_runs WHERE tournament_id=?').get(id); }
  view(id) {
    const row = this.row(id); if (!row) return null;
    const state = JSON.parse(row.state_json);
    return { ...state, status: state.controlStatus || row.status, revision: row.revision, publishedAt: row.published_at,
      games: this.db.prepare('SELECT id,match_id,number,player0,player1,status,error FROM bracket_games WHERE tournament_id=? ORDER BY rowid').all(id) };
  }
  input(body, start = false) {
    const fields = ['expectedRevision', 'reason', ...(start ? ['rulesPolicy', 'mode'] : [])];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !fields.includes(k))
      || !Number.isInteger(body.expectedRevision) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) fail(400, 'Cần phiên bản dữ liệu và lý do thao tác (1–1000 ký tự).');
  }
  create(id, actorId, body) {
    this.input(body, true);
    if (!['keep_qualifier', 'use_final_intake'].includes(body.rulesPolicy)) fail(400, 'Cần xác nhận nguồn bot và luật dùng thi đấu.');
    if (body.mode !== undefined && !['auto', 'manual'].includes(body.mode)) fail(400, 'Chế độ điều khiển không hợp lệ.');
    const result = this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const tournament = this.tournaments.row(id); if (!tournament) return null;
      if (tournament.revision !== body.expectedRevision || tournament.status !== 'provisional' || this.row(id)) fail(409, 'Giải đã thay đổi hoặc vòng loại trực tiếp đã bắt đầu.');
      const plan = this.brackets.get(id); if (!plan) fail(409, 'Cần tạo sơ đồ trước khi chạy trận.');
      const qualified = this.db.prepare('SELECT snapshot_json FROM tournament_qualifications WHERE tournament_id=?').get(id);
      const source = JSON.parse(qualified.snapshot_json);
      const finalRule = this.brackets.finalRule(id);
      const intake = this.db.prepare('SELECT i.stage_id,s.status,s.rules_json FROM tournament_final_intakes i JOIN tournament_stages s ON s.id=i.stage_id WHERE i.tournament_id=?').get(id);
      if (intake) {
        if (intake.status !== 'locked' || body.rulesPolicy !== 'use_final_intake') fail(409, 'Phải chốt bot nộp lại và xác nhận dùng bot của đợt này, không được bỏ qua bằng bot cũ.');
        const entrants = this.db.prepare('SELECT user_id,snapshot_json FROM tournament_stage_entrants WHERE stage_id=?').all(intake.stage_id);
        if (entrants.length !== source.teams.length || source.teams.some(team => !entrants.some(e => e.user_id === team.userId && e.snapshot_json))) fail(409, 'Danh sách bot chính thức không khớp đội đã duyệt.');
        source.teams = source.teams.map(team => { const bot = JSON.parse(entrants.find(e => e.user_id === team.userId).snapshot_json); return { ...team, version: bot.version, bot }; });
        source.rules = JSON.parse(intake.rules_json); source.finalStageId = intake.stage_id;
      } else {
        if (body.rulesPolicy !== 'keep_qualifier' || finalRule?.requiresResubmission) fail(409, 'Luật chính thức khác vòng loại. Cần mở đợt nộp lại, kiểm tra và chốt bot theo luật mới.');
      }
      if (finalRule) { source.rules = finalRule.rules; source.finalRulePinnedAt = finalRule.pinnedAt; }
      if (source.teams.some(e => !e.bot?.submissionId || !this.db.prepare('SELECT 1 FROM users WHERE id=? AND locked=0 AND deleted_at IS NULL').get(e.userId))) fail(409, 'Có đội bị khóa, đã xóa hoặc thiếu bot đã chốt.');
      const state = { ...plan, champion: null, controlMode: body.mode || 'auto', authorizedMatches: [], rulesName: source.rules.name || 'Bộ luật vòng loại', rulesVersion: source.rules.version };
      this.db.prepare("INSERT INTO bracket_runs(tournament_id,status,revision,state_json,source_json,created_at) VALUES (?,'running',1,?,?,?)")
        .run(id, JSON.stringify(state), JSON.stringify(source), this.now());
      this.db.prepare("UPDATE tournaments SET status='running',revision=revision+1,updated_at=? WHERE id=?").run(this.now(), id);
      this.tournaments.event(id, actorId, 'bracket_started', { rulesPolicy: body.rulesPolicy, mode: state.controlMode, reason: body.reason.trim() });
      this.settle(id, true); return this.view(id);
    });
    this.pump(); return result;
  }
  enqueue(id, match, source, start, count) {
    const bestOf = source.config.bestOf, flip = parseInt(digest([source.seed, match.id, 'side']).slice(0, 2), 16) % 2;
    for (let number = start; number < start + count; number++) {
      const swapped = (number - 1 + flip) % 2;
      const players = swapped ? [...match.slots].reverse() : match.slots;
      const extra = number > bestOf;
      const pair = Math.floor((number - (extra ? bestOf : 0) - 1) / 2);
      this.db.prepare('INSERT OR IGNORE INTO bracket_games(id,tournament_id,match_id,number,player0,player1,seed) VALUES (?,?,?,?,?,?,?)')
        .run(crypto.randomUUID(), id, match.id, number, players[0].userId, players[1].userId, digest([source.seed, match.id, extra ? 'extra' : 'base', pair]));
    }
  }
  settle(id, nested = false) {
    // May be called inside the start transaction; caller owns transactions for this case.
    const apply = () => {
      const row = this.row(id); if (!row || row.status !== 'running' || JSON.parse(row.state_json).controlStatus) return;
      const state = JSON.parse(row.state_json), source = JSON.parse(row.source_json), winners = new Map();
      for (const round of state.rounds) for (const match of round.matches) {
        if (match.sources) match.slots = match.sources.map(key => winners.get(key) || null);
        if (match.status === 'waiting' && match.slots.every(Boolean)) match.status = 'ready';
        if (match.status === 'ready' && (state.controlMode !== 'manual' || state.authorizedMatches.includes(match.id))) { match.status = 'queued'; this.enqueue(id, match, source, 1, source.config.bestOf); }
        if (match.status === 'queued') {
          const games = this.db.prepare('SELECT * FROM bracket_games WHERE tournament_id=? AND match_id=? ORDER BY number').all(id, match.id);
          if (games.length && games.every(game => game.status === 'finished')) {
            const points = [0, 0];
            for (const game of games) {
              const winner = JSON.parse(game.replay_json).result.winner;
              if (winner === null) { points[0]++; points[1]++; }
              else points[match.slots[0].userId === [game.player0, game.player1][winner] ? 0 : 1] += 2;
            }
            if (points[0] === points[1] && games.length < source.config.bestOf + 2 * source.config.extraPairs) {
              this.enqueue(id, match, source, games.length + 1, 2);
            } else {
              const tied = points[0] === points[1], index = tied ? (match.slots[0].seed < match.slots[1].seed ? 0 : 1) : points[0] > points[1] ? 0 : 1;
              match.winner = match.slots[index]; match.status = 'finished'; match.points = points.map(p => p / 2);
              match.decidedBy = tied ? 'seed' : games.length > source.config.bestOf ? 'extra_games' : 'games';
              this.tournaments.event(id, this.tournaments.row(id).created_by, 'bracket_match_finished', { matchId: match.id, winner: match.winner.userId, decidedBy: match.decidedBy, automatic: true });
            }
          }
        }
        if (match.winner) winners.set(match.id, match.winner);
      }
      const champion = state.rounds.at(-1).matches[0].winner;
      if (champion) {
        state.champion = champion;
        this.db.prepare("UPDATE tournaments SET status='provisional',revision=revision+1,updated_at=? WHERE id=?").run(this.now(), id);
        this.tournaments.event(id, this.tournaments.row(id).created_by, 'bracket_finished', { champion: champion.userId, automatic: true });
      }
      this.db.prepare('UPDATE bracket_runs SET state_json=?,status=?,revision=revision+1 WHERE tournament_id=?').run(JSON.stringify(state), champion ? 'finished' : 'running', id);
    };
    if (nested) apply(); else this.tournaments.transaction(apply);
  }
  start() {
    if (this.started) return; this.started = true;
    for (const row of this.db.prepare("SELECT tournament_id FROM bracket_runs WHERE status='running'").all()) this.settle(row.tournament_id);
    this.timer = setInterval(() => this.pump(), 500); this.timer.unref(); this.pump();
  }
  schedule(id, actorId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['expectedRevision', 'reason', 'matchId', 'round'].includes(k))
      || !Number.isInteger(body.expectedRevision) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000
      || (Object.hasOwn(body, 'matchId') === Object.hasOwn(body, 'round'))
      || (Object.hasOwn(body, 'matchId') && typeof body.matchId !== 'string') || (Object.hasOwn(body, 'round') && !Number.isInteger(body.round))) fail(400, 'Cần chọn đúng một cặp hoặc vòng, phiên bản dữ liệu và lý do thao tác.');
    const result = this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const row = this.row(id); if (!row) return null;
      const state = JSON.parse(row.state_json);
      if (row.status !== 'running' || state.controlStatus || state.controlMode !== 'manual' || row.revision !== body.expectedRevision) fail(409, 'Chế độ không phù hợp, giải đã xong hoặc dữ liệu đã thay đổi. Tải lại dữ liệu.');
      let matches;
      if (Object.hasOwn(body, 'round')) {
        const round = state.rounds.find(r => r.number === body.round);
        if (!round || state.rounds.filter(r => r.number < body.round).some(r => r.matches.some(m => !['finished', 'bye'].includes(m.status)))) fail(409, 'Vòng trước chưa hoàn tất hoặc vòng được chọn không tồn tại.');
        if (round.matches.some(m => m.status === 'queued')) fail(409, 'Vòng này đang có cặp thi đấu. Chờ hoàn tất trước khi chạy các cặp còn lại.');
        matches = round.matches.filter(m => m.status === 'ready');
      } else matches = state.rounds.flatMap(r => r.matches).filter(m => m.id === body.matchId && m.status === 'ready');
      if (!matches.length) fail(409, 'Không có cặp sẵn sàng; có thể cặp đã chạy hoặc chưa đủ đội.');
      state.authorizedMatches = [...new Set([...state.authorizedMatches, ...matches.map(m => m.id)])];
      this.db.prepare('UPDATE bracket_runs SET state_json=? WHERE tournament_id=?').run(JSON.stringify(state), id);
      this.tournaments.event(id, actorId, 'bracket_scheduled', { matchIds: matches.map(m => m.id), round: body.round ?? null, reason: body.reason.trim() });
      this.settle(id, true); return this.view(id);
    });
    this.pump(); return result;
  }
  control(id, actorId, body, operation) {
    this.input(body);
    const result = this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const row = this.row(id); if (!row) return null;
      const state = JSON.parse(row.state_json);
      if (row.revision !== body.expectedRevision || row.status !== 'running' || state.controlStatus === 'cancelled') fail(409, 'Dữ liệu đã thay đổi hoặc phiên thi đấu đã kết thúc.');
      if (operation === 'pause' && state.controlStatus || operation === 'resume' && state.controlStatus !== 'paused') fail(409, 'Trạng thái không phù hợp với thao tác.');
      if (operation === 'cancel' && (state.controlStatus !== 'paused' || this.db.prepare("SELECT 1 FROM bracket_games WHERE tournament_id=? AND status='running'").get(id))) fail(409, 'Cần tạm dừng và chờ ván đang chạy hoàn tất trước khi hủy.');
      if (operation === 'resume') delete state.controlStatus;
      else state.controlStatus = operation === 'pause' ? 'paused' : 'cancelled';
      state.controlReason = body.reason.trim(); state.controlChangedAt = this.now();
      this.db.prepare('UPDATE bracket_runs SET state_json=?,revision=revision+1 WHERE tournament_id=?').run(JSON.stringify(state), id);
      this.db.prepare("UPDATE tournaments SET status=CASE WHEN ?='cancel' THEN 'cancelled' ELSE status END,revision=revision+1,updated_at=? WHERE id=?").run(operation, this.now(), id);
      this.tournaments.event(id, actorId, 'bracket_' + operation, { reason: body.reason.trim() });
      if (operation === 'resume') this.settle(id, true);
      return this.view(id);
    }); this.pump(); return result;
  }
  pause(id, actorId, body) { return this.control(id, actorId, body, 'pause'); }
  resume(id, actorId, body) { return this.control(id, actorId, body, 'resume'); }
  cancel(id, actorId, body) { return this.control(id, actorId, body, 'cancel'); }
  pump() {
    if (!this.started || this.closing || this.active) return;
    this.db.prepare("UPDATE bracket_games SET status=CASE WHEN attempts>=3 THEN 'blocked' ELSE 'queued' END,worker_id=NULL,lease_until=NULL,live_json=NULL,error='Máy chấm gián đoạn; không xử thua bot' WHERE status='running' AND lease_until<?").run(this.now());
    const game = this.db.prepare(`UPDATE bracket_games SET status='running',attempts=attempts+1,worker_id=?,lease_until=?
      WHERE id=(SELECT g.id FROM bracket_games g JOIN bracket_runs r ON r.tournament_id=g.tournament_id WHERE g.status='queued' AND g.available_at<=? AND r.status='running' AND json_extract(r.state_json,'$.controlStatus') IS NULL ORDER BY g.rowid LIMIT 1) RETURNING *`)
      .get(this.workerId, this.now() + 30000, this.now());
    if (!game) return;
    this.active = this.execute(game).catch(error => console.error('Bracket worker:', error)).finally(() => { this.active = null; this.pump(); });
  }
  async play(game) {
    const source = JSON.parse(this.row(game.tournament_id).source_json), rules = source.rules;
    const entrants = [game.player0, game.player1].map(id => { const team = source.teams.find(e => e.userId === id); return { username: team.username, ...team.bot }; });
    const onTurn = replay => this.db.prepare("UPDATE bracket_games SET live_json=? WHERE id=? AND worker_id=? AND status='running'").run(JSON.stringify(replay), game.id, this.workerId);
    if (this.playOverride) return this.playOverride(game, { rules, entrants, onTurn });
    const manager = this.managerFactory(), sessions = [];
    try {
      manager.imageId = entrants[0].image; await manager.check();
      for (const e of entrants) sessions.push(await manager.start({ directory: this.submissions.folder(e.submissionId, 'artifact'), language: e.language, entry: e.entry, image: e.image }, LIMITS));
      return await runMatch({ seed: game.seed, rules, onTurn, bots: entrants.map(e => ({ id: e.username, submission_id: e.submissionId, version: e.version, source_hash: e.sourceHash, image: e.image })), choose: (player, request) => sessions[player].move(request) });
    } finally {
      const closed = await Promise.allSettled(sessions.map(session => session.close()));
      const failed = closed.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
    }
  }
  async execute(game) {
    const heartbeat = setInterval(() => this.db.prepare("UPDATE bracket_games SET lease_until=? WHERE id=? AND worker_id=? AND status='running'").run(this.now() + 30000, game.id, this.workerId), 5000); heartbeat.unref();
    try {
      const replay = await this.play(game); verifyReplay(replay);
      const saved = this.db.prepare("UPDATE bracket_games SET status='finished',replay_json=?,live_json=NULL,error=NULL,worker_id=NULL,lease_until=NULL WHERE id=? AND worker_id=? AND status='running'").run(JSON.stringify(replay), game.id, this.workerId);
      if (saved.changes) this.settle(game.tournament_id);
    } catch (error) {
      this.db.prepare("UPDATE bracket_games SET status=?,available_at=?,worker_id=NULL,lease_until=NULL,live_json=NULL,error=? WHERE id=? AND worker_id=? AND status='running'")
        .run(game.attempts >= 3 ? 'blocked' : 'queued', this.now() + this.retryDelayMs, String(error.message).slice(0, 65536), game.id, this.workerId);
    } finally { clearInterval(heartbeat); }
  }
  retry(gameId, actorId, body) {
    if (!body || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) fail(400, 'Cần lý do chạy lại.');
    const result = this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const game = this.db.prepare('SELECT * FROM bracket_games WHERE id=?').get(gameId); if (!game) return null;
      if (game.status !== 'blocked' || this.view(game.tournament_id).status !== 'running') fail(409, 'Chỉ chạy lại ván đang cần xử lý hạ tầng.');
      this.db.prepare("UPDATE bracket_games SET status='queued',attempts=0,available_at=0,error=NULL WHERE id=?").run(gameId);
      this.tournaments.event(game.tournament_id, actorId, 'bracket_game_retry', { gameId, reason: body.reason.trim() });
      return { id: gameId };
    }); this.pump(); return result;
  }
  match(id) {
    const row = this.db.prepare('SELECT * FROM bracket_games WHERE id=?').get(id); if (!row) return null;
    return { id: row.id, status: row.status, seed: row.seed, error: row.error ? { message: row.error } : null, replay: row.replay_json || row.live_json ? JSON.parse(row.replay_json || row.live_json) : null };
  }
  publish(id, actorId, body) {
    this.input(body);
    return this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const row = this.row(id), tournament = this.tournaments.row(id); if (!tournament) return null;
      if (!row || row.status !== 'finished' || row.published_at || tournament.revision !== body.expectedRevision || tournament.status !== 'provisional') fail(409, 'Kết quả chưa hoàn tất, đã công bố hoặc dữ liệu đã thay đổi.');
      this.db.prepare('UPDATE bracket_runs SET published_at=?,published_by=?,revision=revision+1 WHERE tournament_id=?').run(this.now(), actorId, id);
      this.db.prepare("UPDATE tournaments SET status='finished',revision=revision+1,updated_at=? WHERE id=?").run(this.now(), id);
      this.tournaments.event(id, actorId, 'results_published', { reason: body.reason.trim() }); return this.view(id);
    });
  }
  async close() { this.closing = true; clearInterval(this.timer); await this.active; }
}
module.exports = { BracketRunner };
