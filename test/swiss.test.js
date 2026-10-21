const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { openDatabase } = require('../src/db');
const { RuleSetService } = require('../src/rule-sets');
const { TournamentService } = require('../src/tournaments');
const { TournamentStages } = require('../src/tournament-stages');
const { SwissService } = require('../src/swiss');
const { standings, pairRound } = require('../src/swiss-pairing');
const { DEFAULT_RULES } = require('../src/game/engine');
const { runMatch } = require('../src/game/match');
const { BotFault, InfrastructureError } = require('../src/game/protocol');
const status = code => error => error.status === code;
const entrants = n => Array.from({ length: n }, (_, i) => ({ userId: i + 1, username: `team${i + 1}`, version: 1 }));

test('Swiss points and real-opponent Buchholz/Sonneborn-Berger use exact units, with no virtual opponent for bye', () => {
  const pairs = [
    { status: 'finished', user0: 1, user1: 2, result0_units: 2, result1_units: 0, game0_units: 4, game1_units: 0 },
    { status: 'finished', user0: 3, user1: null, result0_units: 2, result1_units: 0, game0_units: 0, game1_units: 0 },
    { status: 'finished', user0: 1, user1: 3, result0_units: 1, result1_units: 1, game0_units: 2, game1_units: 2 },
    { status: 'finished', user0: 2, user1: null, result0_units: 2, result1_units: 0, game0_units: 0, game1_units: 0 },
  ];
  const ranking = standings(entrants(3), pairs, 'fixed');
  assert.deepEqual(ranking.map(e => e.userId), [1, 3, 2]);
  assert.equal(ranking[0].points, 1.5); assert.equal(ranking[0].buchholz, 2.5);
  assert.equal(ranking[0].sonnebornBerger, 1.75); assert.equal(ranking[0].gamePoints, 3);
  assert.equal(ranking[1].sonnebornBerger, 0.75); assert.equal(ranking[1].byes, 1);
  assert.equal(ranking[2].points, 1); assert.equal(ranking[2].gamePoints, 0);
  assert.deepEqual(standings(entrants(3).reverse(), pairs, 'fixed'), ranking);
});

test('Swiss planner handles 3/5/16/149/150 teams without rematches or repeated byes across multiple rounds', () => {
  const started = performance.now();
  for (const n of [3, 5, 16, 149, 150]) {
    const players = entrants(n), history = [], used = new Set(), byes = new Set();
    for (let round = 1; round <= Math.min(8, n - 1); round++) {
      const ranking = standings(players, history, 'pairing-seed');
      const plan = pairRound(ranking, history);
      assert.deepEqual(pairRound(ranking, history), plan);
      const playing = plan.pairs.flat();
      if (plan.bye !== null) { assert.ok(!byes.has(plan.bye)); byes.add(plan.bye); playing.push(plan.bye); }
      assert.equal(new Set(playing).size, n); assert.equal(playing.length, n);
      plan.pairs.forEach(([a, b], i) => {
        const key = [a, b].sort((x, y) => x - y).join(':'); assert.ok(!used.has(key)); used.add(key);
        const score = (round + i) % 3;
        history.push({ status: 'finished', user0: a, user1: b, result0_units: score, result1_units: 2 - score, game0_units: score * 2, game1_units: (2 - score) * 2 });
      });
      if (plan.bye !== null) history.push({ status: 'finished', user0: plan.bye, user1: null, result0_units: 2, result1_units: 0, game0_units: 0, game1_units: 0 });
    }
  }
  assert.ok(performance.now() - started < 10000, 'Pairing-only smoke benchmark exceeded 10 seconds');
});

test('Swiss matching backtracks from a greedy dead end and reports impossible or bounded searches', () => {
  const rows = standings(entrants(6), [], 'backtrack');
  const allowed = new Set([[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5]].map(([a, b]) => [rows[a].userId, rows[b].userId].sort((x, y) => x - y).join(':')));
  const history = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (!allowed.has([rows[i].userId, rows[j].userId].sort((a, b) => a - b).join(':'))) history.push({ user0: rows[i].userId, user1: rows[j].userId });
  }
  assert.equal(pairRound(rows, history).pairs.length, 3);
  assert.throws(() => pairRound(rows, history, { nodeLimit: 1 }), status(409));
  assert.throws(() => pairRound(standings(entrants(2), [], 'x'), [{ user0: 1, user1: 2 }]), status(409));
});

function setup(count = 4, rounds = 2, overrides = {}) {
  const db = openDatabase(':memory:'); let clock = 1000;
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin','unused','admin',0)").run();
  const ruleSets = new RuleSetService(db), now = () => clock;
  const tournaments = new TournamentService(db, { ruleSets, now });
  const stages = new TournamentStages(db, { tournaments, now }); tournaments.stages = stages;
  const law = ruleSets.save({ userId: 1, name: 'Swiss test', rules: { ...DEFAULT_RULES, maxMoves: 8 } });
  let tournament = tournaments.create(1, { name: 'Swiss', ruleSetId: law.id, ruleSetVersion: law.version, config: { swissRounds: rounds, topN: 2 } });
  for (let id = 2; id < count + 2; id++) db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'unused','contestant',0)").run(id, `team${id}`);
  tournament = tournaments.replaceEntrants(tournament.id, 1, { expectedRevision: 1, userIds: Array.from({ length: count }, (_, i) => i + 2) });
  tournament = stages.open(tournament.id, 1, { expectedRevision: tournament.revision, closesAt: 2000 });
  const stageId = tournament.stages[0].id;
  for (let userId = 2; userId < count + 2; userId++) db.prepare(`INSERT INTO bot_submissions(id,user_id,version,filename,entry,language,status,job_status,created_at,updated_at,stage_id,source_hash,image)
    VALUES (?,?,1,'main.py','main.py','python','Accepted','done',1000,1000,?,'hash','fake-image')`).run(crypto.randomUUID(), userId, stageId);
  clock = 2000; tournament = stages.lock(tournament.id, 1, { expectedRevision: tournament.revision, reason: 'fixture' });
  const play = async (game, { rules, onTurn }) => runMatch({ seed: game.seed, rules, bots: [], onTurn, choose: async (player, request) => {
    // The lowest user ID wins, independent of swapped sides or completion order.
    if ([game.player0, game.player1][player] > Math.min(game.player0, game.player1)) throw new BotFault('bot_crash');
    return { cpu_ms: 1, stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[0] }) };
  } });
  const swiss = new SwissService(db, { tournaments, submissions: {}, now, play, retryDelayMs: 0, ...overrides });
  return { db, tournaments, stages, tournament, swiss, clock: value => { clock = value; } };
}
test('qualification approval freezes exact ranked teams, pinned bots and audit, with atomic validation', async () => {
  const f = setup(5, 2);
  try {
    f.swiss.create(f.tournament.id, 1, { expectedRevision: f.tournament.revision, seed: 'approval' });
    const body = () => ({ expectedRevision: f.tournaments.get(f.tournament.id).revision, swissRevision: f.swiss.get(f.tournament.id).revision, topN: 3, reason: 'Results checked' });
    assert.throws(() => f.swiss.approve(f.tournament.id, 1, body()), status(409));
    f.swiss.start(); await idle(f.swiss);
    f.swiss.next(f.tournament.id, 1, { expectedRevision: f.swiss.get(f.tournament.id).revision }); await idle(f.swiss);
    assert.throws(() => f.swiss.approve(f.tournament.id, 2, body()), status(400));
    assert.throws(() => f.swiss.approve(f.tournament.id, 1, { ...body(), topN: 6 }), status(400));
    assert.throws(() => f.swiss.approve(f.tournament.id, 1, { ...body(), reason: '' }), status(400));
    assert.throws(() => f.swiss.approve(f.tournament.id, 1, { ...body(), expectedRevision: 1 }), status(409));
    assert.throws(() => f.swiss.approve(f.tournament.id, 1, { ...body(), swissRevision: -1 }), status(409));
    const rank = f.swiss.get(f.tournament.id).standings;
    f.db.prepare('UPDATE users SET locked=1 WHERE id=?').run(rank[0].userId);
    assert.throws(() => f.swiss.approve(f.tournament.id, 1, body()), status(409));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tournament_qualifications').get().n, 0);
    f.db.prepare('UPDATE users SET locked=0 WHERE id=?').run(rank[0].userId);
    const approved = f.swiss.approve(f.tournament.id, 1, body()).qualification;
    assert.equal(approved.topN, 3); assert.equal(approved.approvedBy, 1);
    assert.deepEqual(approved.teams.map(e => e.userId), rank.slice(0, 3).map(e => e.userId));
    assert.deepEqual(approved.teams.map(e => e.seed), [1, 2, 3]);
    const saved = JSON.parse(f.db.prepare('SELECT snapshot_json FROM tournament_qualifications').get().snapshot_json);
    assert.ok(saved.teams.every(e => e.bot.submissionId && e.bot.sourceHash));
    assert.equal(saved.ranking.length, 5); assert.equal(saved.rules.maxMoves, 8);
    assert.equal(JSON.stringify(f.swiss.get(f.tournament.id, false).qualification).includes('sourceHash'), false);
    assert.throws(() => f.swiss.approve(f.tournament.id, 1, body()), status(409));
    assert.throws(() => f.db.exec('DELETE FROM tournament_qualifications'), /immutable/);
    assert.throws(() => f.db.exec('UPDATE tournament_qualifications SET top_n=2'), /immutable/);
    f.db.prepare('UPDATE users SET username=? WHERE id=?').run('renamed', rank[0].userId);
    assert.deepEqual(f.swiss.qualification(f.tournament.id), approved);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind='qualification_approved'").get().n, 1);
  } finally { await f.swiss.close(); f.db.close(); }
});

async function idle(swiss) {
  const end = Date.now() + 10000;
  while (swiss.active || swiss.db.prepare("SELECT 1 FROM swiss_games WHERE status IN ('queued','running') LIMIT 1").get()) {
    if (Date.now() > end) throw new Error('Swiss fixture timed out');
    swiss.pump(); await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('Swiss worker runs pinned bots, swapped seeds, awards pairs once, then completes a second round', async () => {
  const f = setup(5, 2);
  try {
    let result = f.swiss.create(f.tournament.id, 1, { expectedRevision: f.tournament.revision, seed: 'test-seed' });
    assert.equal(result.pairs.filter(p => p.user1 === null).length, 1);
    assert.throws(() => f.swiss.next(f.tournament.id, 1, { expectedRevision: result.revision }), status(409));
    for (const pair of result.pairs.filter(p => p.user1 !== null)) {
      assert.equal(pair.games[0].seed, pair.games[1].seed);
      assert.equal(pair.games[0].player0, pair.games[1].player1);
    }
    f.swiss.start(); await idle(f.swiss);
    result = f.swiss.get(f.tournament.id); assert.equal(result.rounds[0].status, 'finished');
    const before = result.standings; f.swiss.settle(result.stageId); assert.deepEqual(f.swiss.get(f.tournament.id).standings, before);
    assert.equal(result.standings.reduce((total, e) => total + e.points, 0), 3);
    f.db.prepare('UPDATE users SET locked=1 WHERE id=2').run(); // Does not replace already pinned bots.
    result = f.swiss.next(f.tournament.id, 1, { expectedRevision: result.revision }); await idle(f.swiss);
    result = f.swiss.get(f.tournament.id); assert.equal(result.status, 'finished');
    assert.equal(f.tournaments.get(f.tournament.id).status, 'provisional');
    // The fixture's losers crash: their games record fault_user, and only teams without such a game keep "Bot mẫu mực".
    const faulted = new Set(f.db.prepare('SELECT fault_user FROM swiss_games WHERE fault_user IS NOT NULL').all().map(row => row.fault_user));
    assert.ok(faulted.size > 0 && !faulted.has(2));
    for (const row of result.standings) assert.equal(row.badges.some(b => b.code === 'clean'), row.played > 0 && !faulted.has(row.userId), row.username);
    assert.ok(result.standings.every(row => typeof row.rankChange === 'number'));
    assert.equal(result.rounds.length, 2); assert.equal(result.standings.find(e => e.userId === 2).points, 2);
    assert.equal(new Set(result.pairs.filter(p => p.user1 === null).map(p => p.user0)).size, 2);
    assert.ok(f.swiss.export(f.tournament.id).includes('swiss_points')); assert.ok(!f.swiss.get(f.tournament.id, false).pairs);
    assert.throws(() => f.swiss.next(f.tournament.id, 1, { expectedRevision: result.revision }), status(409));
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { await f.swiss.close(); f.db.close(); }
});

test('Swiss infrastructure failures block without points, manual retry finishes, and stale leases do not overwrite results', async () => {
  let failed = true;
  const f = setup(2, 1, { play: async (game, { rules }) => { if (failed) throw new InfrastructureError('offline');
    return runMatch({ seed: game.seed, rules, bots: [], choose: async () => { throw new BotFault('bot_crash'); } }); } });
  try {
    f.swiss.create(f.tournament.id, 1, { expectedRevision: f.tournament.revision });
    f.swiss.start(); await idle(f.swiss);
    let result = f.swiss.get(f.tournament.id);
    assert.ok(result.pairs[0].games.every(g => g.status === 'blocked'));
    assert.ok(result.standings.every(e => e.points === 0));
    const first = result.pairs[0].games[0]; failed = false;
    for (const game of result.pairs[0].games) f.swiss.retry(game.id, 1, { reason: 'Restored' });
    await idle(f.swiss); result = f.swiss.get(f.tournament.id);
    assert.equal(result.status, 'finished'); assert.ok(result.standings.every(e => e.points === 0.5));
    assert.throws(() => f.swiss.retry(first.id, 1, { reason: 'Again' }), status(409));
    const saved = f.swiss.match(first.id).replay;
    await f.swiss.execute({ id: first.id, pair_id: result.pairs[0].id, attempts: 1, player0: first.player0, player1: first.player1, seed: first.seed });
    assert.deepEqual(f.swiss.match(first.id).replay, saved);
  } finally { await f.swiss.close(); f.db.close(); }
});

test('Swiss validates actual entrant count, revision and seed before changing the tournament', async () => {
  const f = setup(2, 8);
  try {
    assert.throws(() => f.swiss.create(f.tournament.id, 1, { expectedRevision: f.tournament.revision, seed: 'x' }), status(409));
    assert.equal(f.tournaments.get(f.tournament.id).status, 'locked');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM swiss_sessions').get().n, 0);
    assert.throws(() => f.swiss.create(f.tournament.id, 1, { expectedRevision: f.tournament.revision, seed: '' }), status(400));
  } finally { await f.swiss.close(); f.db.close(); }
});

test('Swiss recovers an expired worker lease and finalizes persisted results on service restart', async () => {
  const f = setup(2, 1);
  try {
    const created = f.swiss.create(f.tournament.id, 1, { expectedRevision: f.tournament.revision, seed: 'lease' });
    const game = created.pairs[0].games[0];
    f.db.prepare("UPDATE swiss_games SET status='running',worker_id='dead-worker',attempts=1,lease_until=1999 WHERE id=?").run(game.id);
    f.swiss.start(); await idle(f.swiss);
    assert.equal(f.swiss.get(f.tournament.id).status, 'finished');
    assert.equal(f.db.prepare('SELECT attempts FROM swiss_games WHERE id=?').get(game.id).attempts, 2);
    await f.swiss.close();
    // Simulate a process dying after game results persisted but before the aggregation transaction.
    f.db.prepare("UPDATE swiss_sessions SET status='running' WHERE stage_id=?").run(created.stageId);
    f.db.prepare("UPDATE swiss_rounds SET status='running' WHERE stage_id=?").run(created.stageId);
    f.db.prepare("UPDATE swiss_pairs SET status='queued',result0_units=NULL,result1_units=NULL,game0_units=NULL,game1_units=NULL WHERE round_id=?").run(created.rounds[0].id);
    const restarted = new SwissService(f.db, { tournaments: f.tournaments, submissions: {} });
    restarted.start();
    assert.equal(restarted.get(f.tournament.id).status, 'finished');
    assert.equal(restarted.get(f.tournament.id).standings.reduce((n, e) => n + e.points, 0), 1);
    await restarted.close();
  } finally { await f.swiss.close(); f.db.close(); }
});

test('Swiss pause drains current game, persists control across worker restart and cancels without qualification', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = setup(2, 1, { play: async (game, { rules }) => { await gate; return runMatch({ seed: game.seed, rules, bots: [], choose: async (p, req) => ({ cpu_ms: 1, stdout: JSON.stringify({ request_id: req.request_id, move: req.legal_moves[0] }) }) }); } });
  const id = f.tournament.id, b = () => ({ expectedRevision: f.swiss.get(id).revision, reason: 'Bảo trì' });
  try {
    f.swiss.create(id, 1, { expectedRevision: f.tournament.revision }); f.swiss.start();
    assert.throws(() => f.swiss.pause(id, 2, b()), status(400));
    assert.throws(() => f.swiss.pause(id, 1, { ...b(), reason: '' }), status(400));
    const old = b(); f.swiss.pause(id, 1, b());
    assert.throws(() => f.swiss.resume(id, 1, old), status(409));
    assert.throws(() => f.swiss.cancel(id, 1, b()), status(409));
    release(); await f.swiss.active;
    assert.equal(f.swiss.get(id).status, 'paused');
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM swiss_games WHERE status='finished'").get().n, 1);
    assert.throws(() => f.swiss.next(id, 1, { expectedRevision: b().expectedRevision }), status(409));
    const play = f.swiss.playOverride; await f.swiss.close();
    f.swiss = new SwissService(f.db, { tournaments: f.tournaments, submissions: {}, play }); f.swiss.start();
    assert.equal(f.swiss.active, null); assert.equal(f.swiss.get(id).status, 'paused');
    f.swiss.resume(id, 1, b()); await idle(f.swiss); assert.equal(f.swiss.get(id).status, 'finished');
    assert.throws(() => f.swiss.pause(id, 1, b()), status(409));
  } finally { release(); await f.swiss.close(); f.db.close(); }
  const c = setup(2, 1), cid = c.tournament.id;
  try {
    c.swiss.create(cid, 1, { expectedRevision: c.tournament.revision });
    const body = () => ({ expectedRevision: c.swiss.get(cid).revision, reason: 'Hủy buổi thử' });
    assert.throws(() => c.swiss.cancel(cid, 1, body()), status(409));
    c.swiss.pause(cid, 1, body()); c.swiss.cancel(cid, 1, body()); c.swiss.start();
    assert.equal(c.swiss.active, null); assert.equal(c.swiss.get(cid).status, 'cancelled');
    assert.equal(c.tournaments.get(cid).status, 'cancelled');
    assert.throws(() => c.swiss.resume(cid, 1, body()), status(409));
    assert.throws(() => c.swiss.approve(cid, 1, { expectedRevision: c.tournaments.get(cid).revision, swissRevision: body().expectedRevision, topN: 2, reason: 'Không được' }), status(409));
  } finally { await c.swiss.close(); c.db.close(); }
});

test('Swiss pairing scales to 1000 teams in blocks: no rematch, no repeated bye, close ranks, deterministic', () => {
  const n = 1000, players = entrants(n), history = [], used = new Set(), byes = new Set();
  const started = performance.now();
  for (let round = 1; round <= 8; round++) {
    const ranking = standings(players, history, 'thousand'), rank = new Map(ranking.map(row => [row.userId, row.rank]));
    const plan = pairRound(ranking, history);
    if (round === 1) assert.deepEqual(pairRound(ranking, history), plan);
    const playing = plan.pairs.flat();
    assert.equal(plan.bye, null); assert.equal(new Set(playing).size, n);
    plan.pairs.forEach(([a, b], i) => {
      const key = [a, b].sort((x, y) => x - y).join(':'); assert.ok(!used.has(key), `rematch ${key}`); used.add(key);
      assert.ok(Math.abs(rank.get(a) - rank.get(b)) < 384, 'pairs stay inside their block of nearby ranks');
      const score = (round + i) % 3;
      history.push({ status: 'finished', user0: a, user1: b, result0_units: score, result1_units: 2 - score, game0_units: score * 2, game1_units: (2 - score) * 2 });
    });
  }
  const odd = entrants(999), first = pairRound(standings(odd, [], 'odd'), []);
  assert.ok(first.bye !== null && first.pairs.length === 499 && !first.pairs.flat().includes(first.bye));
  assert.ok(performance.now() - started < 30000, 'Pairing 1000 teams over 8 rounds took longer than 30 seconds');
});

test('up to 256 teams the block search is the same single exact search; a blocked block absorbs the next one', () => {
  const players = entrants(150), history = [];
  for (let round = 1; round <= 4; round++) {
    const ranking = standings(players, history, 'same'), plan = pairRound(ranking, history);
    assert.deepEqual(plan.pairs, pairRound(ranking, history, { chunk: Infinity }).pairs);
    plan.pairs.forEach(([a, b]) => history.push({ status: 'finished', user0: a, user1: b, result0_units: 1, result1_units: 1, game0_units: 2, game1_units: 2 }));
  }
  // Teams ranked 1–4 have all met each other, so a 4-team block cannot be paired alone and must take the next block.
  const rows = standings(entrants(8), [], 'merge'), top = rows.slice(0, 4).map(r => r.userId);
  const met = []; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) met.push({ user0: top[i], user1: top[j] });
  const plan = pairRound(rows, met, { chunk: 4 });
  assert.equal(plan.pairs.length, 4);
  for (const [a, b] of plan.pairs) assert.ok(!(top.includes(a) && top.includes(b)), 'no rematch inside the merged block');
});
