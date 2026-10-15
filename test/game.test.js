const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine, DEFAULT_RULES, validateRules } = require('../src/game/engine');
const { LIMITS, parseResponse, makeRequest, BotFault, InfrastructureError } = require('../src/game/protocol');
const { runMatch, verifyReplay } = require('../src/game/match');

function position(pieces, currentTurn = 0, rules = DEFAULT_RULES) {
  const engine = new GameEngine({ seed: 'fixture', rules });
  engine._state.board = Array.from({ length: rules.boardSize }, () => Array(rules.boardSize).fill(null));
  for (const [r, c, player, type] of pieces) engine._state.board[r][c] = { player, type };
  engine._state.currentTurn = currentTurn;
  engine.seen = new Map([[engine.positionKey(), 1]]);
  return engine;
}
const move = (fr, fc, tr, tc) => ({ fromRow: fr, fromCol: fc, toRow: tr, toCol: tc });

test('seed reproduces starting board and each side gets a random 3/3/4 composition', () => {
  const a = new GameEngine({ seed: 'arena-123' });
  assert.deepEqual(a.snapshot(), new GameEngine({ seed: 'arena-123' }).snapshot());
  assert.notDeepEqual(a.snapshot(), new GameEngine({ seed: 'other' }).snapshot());
  for (const player of [0, 1]) {
    const pieces = a.snapshot().board.flat().filter(p => p?.player === player);
    assert.equal(pieces.length, 10);
    assert.deepEqual(['R', 'P', 'S'].map(t => pieces.filter(p => p.type === t).length).sort(), [3, 3, 4]);
  }
  const copy = a.snapshot(); copy.board[0][0] = 'tampered';
  assert.equal(a.snapshot().board[0][0], null);
});
test('movement validates integer coordinates, distance, ownership and RPS captures', () => {
  const engine = position([[4,4,0,'R'], [4,5,1,'S'], [3,4,1,'P'], [5,4,1,'R'], [5,5,0,'P']]);
  const legal = engine.legalMoves();
  assert.ok(legal.some(m => JSON.stringify(m) === JSON.stringify(move(4,4,4,5))));
  for (const invalid of [move(4,4,3,4), move(4,4,5,4), move(4,4,5,5), move(4,4,6,4), move(4,4,4,4), move(4,4,-1,4), move(4,5,4,6), move(4,4,4.1,4)]) assert.throws(() => engine.apply(invalid), /Illegal/);
  engine.apply(move(4,4,4,5)); assert.equal(engine.snapshot().lastMove.captured, true);
});
test('home and elimination win before move limit draw', () => {
  const rules = { ...structuredClone(DEFAULT_RULES), maxMoves: 1 };
  const home = position([[7,0,0,'R'], [4,4,1,'P']], 0, rules);
  home.apply(move(7,0,8,0)); assert.equal(home.snapshot().winReason, 'reached_home');
  const elimination = position([[4,4,0,'R'], [4,5,1,'S']], 0, rules);
  elimination.apply(move(4,4,4,5)); assert.equal(elimination.snapshot().winReason, 'eliminated');
});
test('no legal move loses; threefold repetition and 500-move limit draw', () => {
  const stuck = position([[0,0,0,'R'], [0,1,1,'P'], [1,0,1,'P'], [1,1,1,'P']]);
  stuck.checkTerminal(); assert.equal(stuck.snapshot().winReason, 'no_legal_moves'); assert.equal(stuck.snapshot().winner, 1);
  const loop = position([[4,1,0,'R'], [4,7,1,'P']]);
  for (let i = 0; i < 2; i++) for (const m of [move(4,1,4,2), move(4,7,4,6), move(4,2,4,1), move(4,6,4,7)]) loop.apply(m);
  assert.equal(loop.snapshot().winReason, 'repetition'); assert.equal(loop.snapshot().winner, null);
  const limit = position([[4,1,0,'R'], [4,7,1,'P']]);
  limit._state.moveCount = 499; limit.apply(move(4,1,4,2));
  assert.equal(limit.snapshot().winReason, 'move_limit');
});
test('rule validation rejects malformed configuration and permits configured directions', () => {
  assert.throws(() => validateRules({ ...DEFAULT_RULES, maxMoves: 0 }));
  assert.throws(() => validateRules({ ...DEFAULT_RULES, startingPositions: [[], []] }));
  assert.throws(() => new GameEngine({ seed: 12 }));
  const engine = position([[4,4,0,'R'], [7,7,1,'P']], 0, { ...DEFAULT_RULES, directions: [[0,1]] });
  assert.deepEqual(engine.legalMoves(), [move(4,4,4,5)]);
  assert.ok(Object.isFrozen(engine.rules.homes));
});
test('protocol rejects stale IDs, extra lines, wrong types and oversized userdata', () => {
  const request = makeRequest(new GameEngine(), LIMITS);
  const valid = { request_id: request.request_id, move: request.legal_moves[0], userdata: { next: 1 } };
  assert.deepEqual(parseResponse(JSON.stringify(valid) + '\n', request), valid);
  for (const raw of ['null', '{}', JSON.stringify({ ...valid, request_id: 'old' }), JSON.stringify(valid) + '\n{}', JSON.stringify({ ...valid, move: { ...valid.move, toRow: '0' } }), JSON.stringify({ ...valid, userdata: 'x'.repeat(17000) })]) assert.throws(() => parseResponse(raw, request), BotFault);
});
test('deterministic matches replay exactly, carry userdata, and detect tampering', async () => {
  const choose = async (player, request) => ({ stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[0], userdata: (request.userdata || 0) + 1 }), cpu_ms: 1 });
  const options = { seed: 'replay-test', rules: { ...DEFAULT_RULES, maxMoves: 20 }, bots: ['a', 'b'], choose };
  const first = await runMatch(options), second = await runMatch(options);
  assert.deepEqual(first, second); assert.ok(verifyReplay(first));
  assert.equal(first.turns[2].userdata, 2);
  first.turns[0].move.toRow = -1; assert.throws(() => verifyReplay(first));
});
test('bot faults forfeit; infrastructure errors do not produce a winner', async () => {
  for (const [choose, reason] of [
    [async () => { throw new BotFault('bot_crash'); }, 'bot_crash'],
    [async () => ({ stdout: '{}', cpu_ms: 1 }), 'invalid_output'],
    [async (p, r) => ({ stdout: JSON.stringify({ request_id: r.request_id, move: move(0,0,0,1) }), cpu_ms: 1 }), 'illegal_move'],
    [async () => ({ stdout: '{}', cpu_ms: 501 }), 'cpu_timeout']
  ]) {
    const replay = await runMatch({ seed: 'fault', bots: ['a','b'], choose });
    assert.equal(replay.result.winner, 1); assert.equal(replay.fault.code, reason); assert.ok(verifyReplay(replay));
  }
  await assert.rejects(runMatch({ seed: 'infra', choose: async () => { throw new InfrastructureError('docker_stopped'); } }), InfrastructureError);
});
test('a stalled move cannot bypass the total match deadline', async () => {
  await assert.rejects(runMatch({ seed: 'deadline', limits: { ...LIMITS, matchWallMs: 20 },
    choose: async () => new Promise(() => {}) }), error => error instanceof InfrastructureError && error.code === 'match_wall_limit');
});


test('Classic v2 varies the fourth piece by seed, shares counts and preserves v1 replays', async () => {
 const seen=new Set();
 for(let i=0;i<90;i++) {
  const engine=new GameEngine({seed:'composition-'+i});
  const counts=[0,1].map(player=>['R','P','S'].map(type=>engine.snapshot().board.flat().filter(p=>p?.player===player&&p.type===type).length));
  assert.deepEqual([...counts[0]].sort(),[3,3,4]);assert.deepEqual(counts[0],counts[1]);seen.add(counts[0].indexOf(4));
 }
 assert.equal(seen.size,3);
 const oldRules={...structuredClone(DEFAULT_RULES),version:1};delete oldRules.randomExtraPiece;
 const game=new GameEngine({seed:'historical',rules:oldRules});
 assert.deepEqual(['R','P','S'].map(type=>game.snapshot().board.flat().filter(p=>p?.player===0&&p.type===type).length),[3,3,4]);
 const replay=await runMatch({seed:'old-replay',rules:oldRules,bots:['a','b'],choose:async(p,r)=>({stdout:JSON.stringify({request_id:r.request_id,move:r.legal_moves[0]}),cpu_ms:1})});assert.ok(verifyReplay(replay));
});
