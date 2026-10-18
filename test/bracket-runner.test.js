const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { RuleSetService } = require('../src/rule-sets');
const { TournamentService } = require('../src/tournaments');
const { BracketService } = require('../src/brackets');
const { BracketRunner } = require('../src/bracket-runner');
const { DEFAULT_RULES } = require('../src/game/engine');
const { runMatch } = require('../src/game/match');
const { InfrastructureError, BotFault } = require('../src/game/protocol');
const status = n => e => e.status === n;
function fixture(n = 6, options = {}, config = { bestOf: 1, extraPairs: 1 }) {
  const db = openDatabase(':memory:');
  for (let id = 1; id <= n + 1; id++) db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'unused',?,0)").run(id, `team${id}`, id === 1 ? 'admin' : 'contestant');
  const ruleSets = new RuleSetService(db);
  const law = ruleSets.save({ userId: 1, name: 'Luật thử máy chấm', rules: { ...DEFAULT_RULES, maxMoves: 8 } });
  const tournaments = new TournamentService(db, { ruleSets });
  const t = tournaments.create(1, { name: 'Runner', ruleSetId: law.id, ruleSetVersion: law.version, config: { bestOf: 1, extraPairs: 1 } });
  db.prepare("UPDATE tournaments SET status='provisional' WHERE id=?").run(t.id);
  db.prepare("INSERT INTO tournament_stages VALUES ('stage',?,'qualifier','locked',0,1,1,'{}','{}')").run(t.id);
  const source = { seed: 'knockout', config, rules: law.rules,
    teams: Array.from({ length: n }, (_, i) => ({ rank: i + 1, userId: i + 2, username: `team${i + 2}`, version: 1, bot: { submissionId: `bot${i}`, image: 'fake' } })) };
  db.prepare("INSERT INTO tournament_qualifications VALUES (?,'stage',1,1,?,1,'checked',?)").run(t.id, n, JSON.stringify(source));
  const brackets = new BracketService(db, { tournaments });
  const play = (game, { rules }) => runMatch({ seed: game.seed, rules, bots: [], choose: async (player, req) => ({ cpu_ms: 1, stdout: JSON.stringify({ request_id: req.request_id, move: req.legal_moves[0] }) }) });
  const runner = new BracketRunner(db, { tournaments, brackets, submissions: {}, retryDelayMs: 0, play, ...options }); brackets.runner = runner;
  brackets.create(t.id, 1, { expectedRevision: t.revision, reason: 'Fixture' });
  const body = () => ({ expectedRevision: tournaments.get(t.id).revision, reason: 'Fixture', rulesPolicy: 'keep_qualifier' });
  return { db, tournaments, brackets, runner, id: t.id, body };
}
async function idle(f) {
  const end = Date.now() + 10000;
  while (f.runner.active || f.db.prepare("SELECT 1 FROM bracket_games WHERE status IN ('queued','running')").get()) {
    if (Date.now() > end) throw new Error('Runner timeout');
    f.runner.pump(); await new Promise(r => setTimeout(r, 2));
  }
}
test('final rules pin an exact historical version without changing qualifier records or following newer versions', async () => {
  const f = fixture(2);
  try {
    const tournament = f.tournaments.get(f.id), ruleSets = f.tournaments.ruleSets;
    const original = ruleSets.get(tournament.ruleSetId, tournament.ruleSetVersion);
    ruleSets.save({ id: original.id, expectedVersion: original.version, name: 'Luật mới hơn', userId: 1, rules: { ...original.rules, maxMoves: 16 } });
    const body = { expectedRevision: tournament.revision, ruleSetId: original.id, ruleSetVersion: original.version, reason: 'Giữ đúng phiên bản đã công bố' };
    assert.throws(() => f.brackets.pinRule(f.id, 2, body), status(400));
    assert.throws(() => f.brackets.pinRule(f.id, 1, { ...body, expectedRevision: -1 }), status(409));
    assert.throws(() => f.brackets.pinRule(f.id, 1, { ...body, ruleSetVersion: 999 }), status(400));
    assert.equal(f.brackets.finalRule(f.id), null);
    const pinned = f.brackets.pinRule(f.id, 1, body);
    assert.equal(pinned.rules.maxMoves, 8); assert.equal(pinned.requiresResubmission, false);
    assert.equal(f.tournaments.get(f.id).revision, body.expectedRevision + 1);
    assert.throws(() => f.brackets.pinRule(f.id, 1, { ...body, expectedRevision: body.expectedRevision + 1 }), status(409));
    assert.throws(() => f.db.exec('DELETE FROM tournament_final_rules'), /immutable/);
    assert.throws(() => f.db.exec('UPDATE tournament_final_rules SET rule_set_version=2'), /immutable/);
    f.runner.create(f.id, 1, f.body());
    assert.equal(JSON.parse(f.runner.row(f.id).source_json).rules.maxMoves, 8);
    const before = JSON.parse(f.db.prepare('SELECT snapshot_json FROM tournament_qualifications').get().snapshot_json);
    assert.equal(before.rules.maxMoves, 8);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind='final_rules_pinned'").get().n, 1);
  } finally { await f.runner.close(); f.db.close(); }
});
test('a different pinned rule blocks old-bot execution until resubmission exists; running matches cannot change rules', async () => {
  const f = fixture(2), other = fixture(2);
  try {
    const tournament = f.tournaments.get(f.id), ruleSets = f.tournaments.ruleSets;
    const original = ruleSets.get(tournament.ruleSetId, tournament.ruleSetVersion);
    const changed = ruleSets.save({ userId: 1, name: 'Luật vòng chính thức', rules: { ...original.rules, maxMoves: 16 } });
    const body = { expectedRevision: tournament.revision, ruleSetId: changed.id, ruleSetVersion: changed.version, reason: 'Chuẩn bị đổi luật' };
    assert.throws(() => f.brackets.pinRule(f.id, 1, { ...body, reason: '' }), status(400));
    assert.equal(f.brackets.pinRule(f.id, 1, body).requiresResubmission, true);
    for (const mode of ['auto', 'manual']) assert.throws(() => f.runner.create(f.id, 1, { ...f.body(), mode }), status(409));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bracket_runs').get().n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bracket_games').get().n, 0);
    other.runner.create(other.id, 1, other.body());
    const originalOther = other.tournaments.get(other.id);
    assert.throws(() => other.brackets.pinRule(other.id, 1, { expectedRevision: originalOther.revision, ruleSetId: originalOther.ruleSetId, ruleSetVersion: originalOther.ruleSetVersion, reason: 'Too late' }), status(409));
  } finally { await f.runner.close(); f.db.close(); await other.runner.close(); other.db.close(); }
});
test('manual control runs only authorized pairs or rounds, preserves waiting state after restart and prevents duplicate jobs', async () => {
  const f = fixture();
  try {
    const start = f.runner.create(f.id, 1, { ...f.body(), mode: 'manual' });
    assert.equal(start.controlMode, 'manual'); assert.equal(start.games.length, 0);
    f.runner.start(); await idle(f); assert.equal(f.runner.view(f.id).games.length, 0);
    const body = scope => ({ ...scope, expectedRevision: f.runner.view(f.id).revision, reason: 'Run selected only' });
    assert.throws(() => f.runner.schedule(f.id, 1, body({ round: 2 })), status(409));
    assert.throws(() => f.runner.schedule(f.id, 1, body({ round: 1, matchId: 'r1-m2' })), status(400));
    assert.throws(() => f.runner.schedule(f.id, 1, { ...body({ round: 1 }), reason: '' }), status(400));
    const stale = body({ matchId: 'r1-m2' });
    f.runner.schedule(f.id, 1, stale);
    assert.throws(() => f.runner.schedule(f.id, 1, stale), status(409));
    assert.throws(() => f.runner.schedule(f.id, 1, body({ round: 1 })), status(409));
    await idle(f);
    let result = f.runner.view(f.id);
    assert.equal(result.games.length, 3);
    assert.equal(result.rounds[0].matches.find(m => m.id === 'r1-m2').status, 'finished');
    assert.equal(result.rounds[0].matches.find(m => m.id === 'r1-m4').status, 'ready');
    assert.throws(() => f.runner.schedule(f.id, 1, body({ matchId: 'r1-m2' })), status(409));
    const play = f.runner.playOverride; await f.runner.close();
    f.runner = new BracketRunner(f.db, { tournaments: f.tournaments, brackets: f.brackets, submissions: {}, play, retryDelayMs: 0 }); f.brackets.runner = f.runner;
    f.runner.start(); await idle(f); assert.equal(f.runner.view(f.id).games.length, 3);
    f.runner.schedule(f.id, 1, body({ round: 1 })); await idle(f);
    result = f.runner.view(f.id); assert.equal(result.games.length, 6);
    assert.ok(result.rounds[1].matches.every(m => m.status === 'ready'));
    f.runner.schedule(f.id, 1, body({ round: 2 })); await idle(f);
    result = f.runner.view(f.id); assert.equal(result.games.length, 12);
    assert.equal(result.rounds[2].matches[0].status, 'ready'); assert.equal(result.champion, null);
    f.runner.schedule(f.id, 1, body({ round: 3 })); await idle(f);
    result = f.runner.view(f.id); assert.equal(result.status, 'finished'); assert.equal(result.champion.seed, 1); assert.equal(result.games.length, 15);
    assert.throws(() => f.runner.schedule(f.id, 1, body({ round: 3 })), status(409));
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind='bracket_scheduled'").get().n, 4);
  } finally { await f.runner.close(); f.db.close(); }
});

test('automatic mode cannot receive manual scheduling commands', async () => {
  const f = fixture(2);
  try {
    assert.throws(() => f.runner.create(f.id, 1, { ...f.body(), mode: 'unknown' }), status(400));
    const result = f.runner.create(f.id, 1, f.body());
    assert.equal(result.controlMode, 'auto');
    assert.throws(() => f.runner.schedule(f.id, 1, { expectedRevision: result.revision, reason: 'wrong mode', round: 1 }), status(409));
  } finally { await f.runner.close(); f.db.close(); }
});
test('six teams play through byes, paired overtime, seed tie-break and explicit result approval', async () => {
  const f = fixture();
  try {
    assert.throws(() => f.runner.create(f.id, 1, { ...f.body(), rulesPolicy: 'other' }), status(400));
    const started = f.runner.create(f.id, 1, f.body());
    assert.throws(() => f.runner.publish(f.id, 1, { expectedRevision: f.tournaments.get(f.id).revision, reason: 'early' }), status(409));
    assert.throws(() => f.runner.create(f.id, 1, f.body()), status(409));
    f.runner.start(); await idle(f);
    const result = f.runner.view(f.id);
    assert.equal(result.status, 'finished'); assert.equal(result.champion.seed, 1); assert.equal(result.publishedAt, null);
    const matches = result.rounds.flatMap(r => r.matches);
    assert.equal(matches.filter(m => m.status === 'bye').length, 2);
    assert.equal(matches.filter(m => m.status === 'finished').length, 5);
    assert.ok(matches.filter(m => m.status === 'finished').every(m => m.decidedBy === 'seed'));
    assert.equal(result.games.length, 15);
    for (const match of matches.filter(m => m.status === 'finished')) {
      const games = f.db.prepare('SELECT * FROM bracket_games WHERE match_id=? ORDER BY number').all(match.id);
      assert.equal(games[1].seed, games[2].seed); assert.equal(games[1].player0, games[2].player1);
    }
    const before = f.db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind='bracket_match_finished'").get().n;
    f.runner.settle(f.id); assert.equal(before, 5);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind='bracket_match_finished'").get().n, 5);
    const published = f.runner.publish(f.id, 1, { expectedRevision: f.tournaments.get(f.id).revision, reason: 'Checked all replays' });
    assert.ok(published.publishedAt); assert.equal(f.tournaments.get(f.id).status, 'finished');
    assert.throws(() => f.runner.publish(f.id, 1, { expectedRevision: f.tournaments.get(f.id).revision, reason: 'again' }), status(409));
    assert.equal(started.teamCount, 6);
  } finally { await f.runner.close(); f.db.close(); }
});
test('infrastructure blocks without advancing, retry and late worker output cannot change saved results', async () => {
  let broken = true;
  const f = fixture(2, { play: (game, { rules }) => {
    if (broken) throw new InfrastructureError('offline');
    return runMatch({ seed: game.seed, rules, bots: [], choose: async () => { throw new BotFault('bot_crash'); } });
  } });
  try {
    f.runner.create(f.id, 1, f.body()); f.runner.start(); await idle(f);
    let result = f.runner.view(f.id); assert.equal(result.champion, null); assert.equal(result.games[0].status, 'blocked');
    const game = f.db.prepare('SELECT * FROM bracket_games').get();
    assert.throws(() => f.runner.retry(game.id, 1, { reason: '' }), status(400));
    broken = false; f.runner.retry(game.id, 1, { reason: 'restored' }); await idle(f);
    result = f.runner.view(f.id); assert.equal(result.status, 'finished');
    assert.equal(result.rounds[0].matches[0].decidedBy, 'games');
    const saved = f.runner.match(game.id).replay;
    await f.runner.execute(game); assert.deepEqual(f.runner.match(game.id).replay, saved);
    assert.throws(() => f.runner.retry(game.id, 1, { reason: 'again' }), status(409));
  } finally { await f.runner.close(); f.db.close(); }
});
test('expired leases and persisted results recover after restarting the bracket service', async () => {
  const f = fixture(2);
  try {
    f.runner.create(f.id, 1, f.body());
    const game = f.db.prepare('SELECT id FROM bracket_games').get();
    f.db.prepare("UPDATE bracket_games SET status='running',worker_id='dead',lease_until=0,attempts=1 WHERE id=?").run(game.id);
    f.runner.start(); await idle(f); assert.equal(f.runner.view(f.id).status, 'finished');
    assert.equal(f.db.prepare('SELECT attempts FROM bracket_games WHERE id=?').get(game.id).attempts, 2);
  } finally { await f.runner.close(); f.db.close(); }
});

for (const bestOf of [1, 3]) test(`decisive ${bestOf === 1 ? 'overtime' : 'three-game series'} awards the winner from saved game results`, async () => {
  const f = fixture(2, { play: (game, { rules }) => runMatch({ seed: game.seed, rules, bots: [], choose: async (player, req) => {
    const drawBase = bestOf === 1 && game.number === 1;
    if (!drawBase && [game.player0, game.player1][player] > Math.min(game.player0, game.player1)) throw new BotFault('bot_crash');
    return { cpu_ms: 1, stdout: JSON.stringify({ request_id: req.request_id, move: req.legal_moves[0] }) };
  } }) }, { bestOf, extraPairs: 1 });
  try {
    f.runner.create(f.id, 1, f.body()); f.runner.start(); await idle(f);
    const final = f.runner.view(f.id); assert.equal(final.champion.userId, 2);
    assert.equal(final.games.length, 3); assert.equal(final.rounds[0].matches[0].decidedBy, bestOf === 1 ? 'extra_games' : 'games');
    assert.throws(() => f.db.exec("UPDATE bracket_runs SET source_json='{}'"), /immutable/);
  } finally { await f.runner.close(); f.db.close(); }
});

test('pause drains current game, survives runner restart, resumes or cancels without new games', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(2, { play: async (game, { rules }) => {
    await gate;
    return runMatch({ seed: game.seed, rules, bots: [], choose: async (player, req) => ({ cpu_ms: 1, stdout: JSON.stringify({ request_id: req.request_id, move: req.legal_moves[0] }) }) });
  } });
  const body = () => ({ expectedRevision: f.runner.view(f.id).revision, reason: 'Bảo trì máy chấm' });
  try {
    f.runner.create(f.id, 1, f.body()); f.runner.start();
    assert.ok(f.runner.active);
    assert.throws(() => f.runner.pause(f.id, 2, body()), status(400));
    assert.throws(() => f.runner.pause(f.id, 1, { ...body(), reason: '' }), status(400));
    const old = body(); assert.equal(f.runner.pause(f.id, 1, body()).status, 'paused');
    assert.throws(() => f.runner.resume(f.id, 1, old), status(409));
    assert.throws(() => f.runner.cancel(f.id, 1, body()), status(409));
    release(); await f.runner.active;
    assert.equal(f.runner.view(f.id).games.filter(g => g.status === 'finished').length, 1);
    assert.equal(f.runner.view(f.id).status, 'paused');
    assert.throws(() => f.runner.schedule(f.id, 1, { ...body(), round: 1 }), status(409));
    await f.runner.close();
    const play = f.runner.playOverride;
    f.runner = new BracketRunner(f.db, { tournaments: f.tournaments, brackets: f.brackets, submissions: {}, play });
    f.runner.start(); assert.equal(f.runner.view(f.id).status, 'paused'); assert.equal(f.runner.active, null);
    f.runner.resume(f.id, 1, body()); await idle(f);
    assert.equal(f.runner.view(f.id).status, 'finished');
    assert.throws(() => f.runner.pause(f.id, 1, body()), status(409));
  } finally { release(); await f.runner.close(); f.db.close(); }
  const c = fixture(2);
  try {
    c.runner.create(c.id, 1, c.body());
    const b = () => ({ expectedRevision: c.runner.view(c.id).revision, reason: 'Hủy buổi thi thử' });
    assert.throws(() => c.runner.cancel(c.id, 1, b()), status(409));
    c.runner.pause(c.id, 1, b()); c.runner.cancel(c.id, 1, b()); c.runner.start();
    assert.equal(c.runner.view(c.id).status, 'cancelled'); assert.equal(c.runner.active, null);
    assert.equal(c.tournaments.get(c.id).status, 'cancelled');
    assert.throws(() => c.runner.resume(c.id, 1, b()), status(409));
    assert.throws(() => c.runner.publish(c.id, 1, { expectedRevision: c.tournaments.get(c.id).revision, reason: 'Không được' }), status(409));
    assert.equal(c.db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind IN ('bracket_pause','bracket_cancel')").get().n, 2);
  } finally { await c.runner.close(); c.db.close(); }
});
