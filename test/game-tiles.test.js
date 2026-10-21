const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine, validateRules } = require('../src/game/engine');
const { runMatch, verifyReplay } = require('../src/game/match');
const { makeRequest } = require('../src/game/protocol');
const { openDatabase } = require('../src/db');
const { RuleSetService } = require('../src/rule-sets');
const POWERUPS = require('../rules/powerups.json');

const effectTypes = {
  wildcard: { passable: true, tags: ['effect'], effect: 'wildcard', render: { color: '#7c3aed', symbol: 'W', label: 'Wildcard' } },
  shield: { passable: true, tags: ['effect'], effect: 'shield', render: { color: '#0e7490', symbol: 'S', label: 'Khiên' } },
  dash: { passable: true, tags: ['effect'], effect: 'dash', render: { color: '#c2410c', symbol: 'D', label: 'Lướt' } },
};
// 5x5, one piece per side by default; homes in opposite corners.
const rules = extra => ({ id: 't', version: 1, engine: 'rps-grid-v1', boardSize: 5, homes: [{ row: 0, col: 4 }, { row: 4, col: 0 }], pieceTypes: ['R'],
  playerPieceTypes: [['R'], ['S']], beats: { R: 'S', S: 'P', P: 'R' }, directions: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
  startingPositions: [[[2, 0]], [[2, 4]]], maxMoves: 50, repetitionLimit: 3, noLegalMoves: 'loss', randomExtraPiece: false, tileTypes: effectTypes, ...extra });
// Places pieces directly to test one mechanic at a time: [[row, col, player, type, effect?], ...].
function position(extra, pieces, turn = 0) {
  const engine = new GameEngine({ seed: 'x', rules: rules(extra) });
  engine._state.board = engine._state.board.map(row => row.map(() => null));
  for (const [row, col, player, type, effect] of pieces) engine._state.board[row][col] = { player, type, ...(effect ? { effect } : {}) };
  engine._state.currentTurn = turn; engine.seen = new Map();
  return engine;
}
const move = (fromRow, fromCol, toRow, toCol) => ({ fromRow, fromCol, toRow, toCol });
const legal = (engine, m) => engine.legalMoves().some(x => Object.keys(m).every(k => x[k] === m[k]));

test('tile validation rejects homes, starting squares, unknown types/effects and impassable effect tiles', () => {
  assert.throws(() => validateRules(rules({ tiles: [{ at: [0, 4], type: 'shield' }] })), /nhà|xuất phát/);
  assert.throws(() => validateRules(rules({ tiles: [{ at: [2, 0], type: 'shield' }] })), /nhà|xuất phát/);
  assert.throws(() => validateRules(rules({ tiles: [{ at: [1, 1], type: 'lava' }] })), /type/);
  assert.throws(() => validateRules(rules({ tileTypes: { x: { passable: true, effect: 'teleport', render: { color: '#000000', symbol: 'X', label: 'X' } } } })), /chưa được cài/);
  assert.throws(() => validateRules(rules({ tileTypes: { x: { passable: false, effect: 'shield', render: { color: '#000000', symbol: 'X', label: 'X' } } } })), /đi vào được/);
  assert.throws(() => validateRules(rules({ tileTypes: { blocked: effectTypes.shield } })), /trùng loại có sẵn/);
  assert.throws(() => validateRules(rules({ tileSpawns: [{ types: ['shield'], count: [1, 1], region: { rowFrom: 2, rowTo: 2, colFrom: 0, colTo: 0 }, symmetry: 'point' }] })), /không đủ chỗ/);
  assert.throws(() => validateRules(rules({ powerUps: true })), /powerUps cũ/);
  assert.throws(() => validateRules(rules({ onMoveLimit: 'score' })), /onMoveLimit/);
  assert.throws(() => validateRules({ ...rules(), tileTypes: undefined, tiles: [] }), /tileTypes/);
});

test('power-ups spawn reproducibly across the whole board, excluding homes and starting squares', () => {
  const layouts = new Set();
  const forbidden = new Set([...POWERUPS.homes.map(h => `${h.row},${h.col}`), ...POWERUPS.startingPositions.flat().map(p => p.join(','))]);
  let outsideCentre = false, atCentre = false;
  for (let i = 0; i < 30; i++) {
    const tiles = new GameEngine({ seed: `seed-${i}`, rules: POWERUPS }).snapshot().tiles;
    assert.deepEqual(new GameEngine({ seed: `seed-${i}`, rules: POWERUPS }).snapshot().tiles, tiles);
    assert.ok(tiles.length >= 2 && tiles.length <= 4, JSON.stringify(tiles));
    for (const tile of tiles) {
      assert.ok(tile.row >= 0 && tile.row < 9 && tile.col >= 0 && tile.col < 9);
      assert.ok(!forbidden.has(`${tile.row},${tile.col}`));
      if (tile.row < 3 || tile.row > 5 || tile.col < 3 || tile.col > 5) outsideCentre = true;
      if (tile.row === 4 && tile.col === 4) atCentre = true;
      assert.deepEqual(tile.tags, ['effect']);
    }
    layouts.add(JSON.stringify(tiles));
  }
  assert.ok(layouts.size > 3);
  assert.ok(outsideCentre, 'random power-ups must reach beyond the old central region');
  assert.ok(atCentre, 'the central square is also eligible');
});

test('manual power-ups stay at admin-selected squares without random additions', () => {
  const custom = { ...POWERUPS, tileSpawns: [], tiles: [{ at: [0, 0], type: 'shield' }, { at: [4, 4], type: 'dash' }] };
  for (const seed of ['manual-a', 'manual-b']) {
    const tiles = new GameEngine({ seed, rules: custom }).snapshot().tiles;
    assert.deepEqual(tiles.map(t => [t.row, t.col, t.type]), [[0, 0, 'shield'], [4, 4, 'dash']]);
  }
});

test('entering an effect tile gives its effect, removes the tile, and a new pickup replaces the old effect', () => {
  const engine = new GameEngine({ seed: 'x', rules: rules({ tiles: [{ at: [2, 1], type: 'wildcard' }, { at: [2, 2], type: 'dash' }] }) });
  engine.apply(move(2, 0, 2, 1));
  assert.equal(engine.snapshot().board[2][1].effect, 'wildcard');
  assert.deepEqual(engine.lastChanges, [{ row: 2, col: 0, piece: null }, { row: 2, col: 1, piece: { player: 0, type: 'R' } }, { row: 2, col: 1, piece: { player: 0, type: 'R', effect: 'wildcard' } }, { row: 2, col: 1, tile: null }]);
  engine.apply(move(2, 4, 3, 4)); engine.apply(move(2, 1, 2, 2));
  assert.equal(engine.snapshot().board[2][2].effect, 'dash');
  assert.deepEqual(engine.snapshot().tiles, []);
});

test('wildcard captures any opponent piece, including the same type', () => {
  assert.equal(legal(position({}, [[2, 1, 0, 'R'], [2, 2, 1, 'R']]), move(2, 1, 2, 2)), false);
  const engine = position({}, [[2, 1, 0, 'R', 'wildcard'], [2, 2, 1, 'R'], [4, 4, 1, 'P']]);
  assert.ok(legal(engine, move(2, 1, 2, 2)));
  engine.apply(move(2, 1, 2, 2));
  assert.deepEqual(engine.snapshot().board[2][2], { player: 0, type: 'R', effect: 'wildcard' });
});

test('shield blocks one capture: the attacker stays, the shield breaks and the turn passes', () => {
  const engine = position({}, [[2, 1, 0, 'R'], [2, 2, 1, 'S', 'shield'], [4, 4, 1, 'S']]);
  assert.ok(legal(engine, move(2, 1, 2, 2)), 'shielded piece is still listed as a capture');
  engine.apply(move(2, 1, 2, 2));
  const state = engine.snapshot();
  assert.deepEqual(state.board[2][1], { player: 0, type: 'R' }); assert.deepEqual(state.board[2][2], { player: 1, type: 'S' });
  assert.equal(state.currentTurn, 1); assert.equal(state.lastMove.blocked, true); assert.equal(state.lastMove.captured, false);
  assert.deepEqual(engine.lastChanges, [{ row: 2, col: 2, piece: { player: 1, type: 'S' } }]);
  engine.apply(move(4, 4, 3, 4)); engine.apply(move(2, 1, 2, 2));
  assert.deepEqual(engine.snapshot().board[2][2], { player: 0, type: 'R' });
});

test('dash steps once more after a capture, capturing only by normal RPS and never into a home or wall', () => {
  const run = (pieces, m, extra = {}) => { const engine = position(extra, pieces); engine.apply(m); return engine.snapshot(); };
  let state = run([[2, 0, 0, 'R', 'dash'], [2, 1, 1, 'S'], [4, 4, 1, 'S']], move(2, 0, 2, 1));
  assert.equal(state.board[2][2]?.type, 'R'); assert.equal(state.board[2][1], null); assert.deepEqual(state.lastMove.bonus_step, { toRow: 2, toCol: 2, captured: false });
  state = run([[2, 0, 0, 'R', 'dash'], [2, 1, 1, 'S'], [2, 2, 1, 'P'], [4, 4, 1, 'S']], move(2, 0, 2, 1));
  assert.equal(state.board[2][1]?.type, 'R'); assert.equal(state.board[2][2]?.type, 'P'); assert.equal(state.lastMove.bonus_step, undefined);
  state = run([[2, 0, 0, 'R', 'dash'], [2, 1, 1, 'S'], [2, 2, 1, 'S'], [4, 4, 1, 'S']], move(2, 0, 2, 1));
  assert.equal(state.board[2][2]?.player, 0); assert.equal(state.lastMove.bonus_step.captured, true);
  state = run([[2, 0, 0, 'R', 'dash'], [2, 1, 1, 'S'], [2, 2, 1, 'S', 'shield'], [4, 4, 1, 'S']], move(2, 0, 2, 1));
  assert.equal(state.board[2][1]?.player, 0); assert.deepEqual(state.board[2][2], { player: 1, type: 'S' }); assert.equal(state.lastMove.bonus_step.blocked, true);
  state = run([[2, 2, 0, 'R', 'dash'], [1, 3, 1, 'S'], [4, 4, 1, 'S']], move(2, 2, 1, 3));
  assert.equal(state.board[1][3]?.player, 0, 'next square (0,4) is a home: no dash');
  state = run([[2, 0, 0, 'R', 'dash'], [2, 1, 1, 'S'], [4, 4, 1, 'S']], move(2, 0, 2, 1), { tiles: [{ at: [2, 2], type: 'shield' }], tileTypes: { ...effectTypes } });
  assert.equal(state.board[2][2]?.effect, 'shield', 'the dash landing picks up the tile and replaces dash');
});

test('move limit with onMoveLimit=material: more pieces wins, equal is a draw; default stays a draw', () => {
  const finish = (extra, pieces) => { const engine = position({ maxMoves: 1, ...extra }, pieces); engine.apply(move(0, 0, 0, 1)); return engine.snapshot(); };
  let state = finish({ onMoveLimit: 'material' }, [[0, 0, 0, 'R'], [3, 3, 0, 'R'], [4, 4, 1, 'R']]);
  assert.equal(state.winner, 0); assert.equal(state.winReason, 'material');
  state = finish({ onMoveLimit: 'material' }, [[0, 0, 0, 'R'], [4, 4, 1, 'R']]);
  assert.equal(state.winner, null); assert.equal(state.winReason, 'material');
  state = finish({}, [[0, 0, 0, 'R'], [3, 3, 0, 'R'], [4, 4, 1, 'R']]);
  assert.equal(state.winner, null); assert.equal(state.winReason, 'move_limit');
});

test('a new tile type added only in JSON reaches the bot state; impassable custom tiles block movement', () => {
  const tileTypes = { ...effectTypes, mud: { passable: true, tags: ['slow', 'terrain'], render: { color: '#8b5e34', symbol: '~', label: 'Bùn' } },
    water: { passable: false, tags: ['impassable', 'water'], render: { color: '#2563eb', symbol: '≈', label: 'Nước' } } };
  const engine = new GameEngine({ seed: 'x', rules: rules({ tileTypes, tiles: [{ at: [2, 1], type: 'mud' }, { at: [1, 0], type: 'water' }] }) });
  const request = makeRequest(engine, { moveCpuMs: 1 });
  assert.deepEqual(request.state.tiles, [{ row: 1, col: 0, type: 'water', tags: ['impassable', 'water'] }, { row: 2, col: 1, type: 'mud', tags: ['slow', 'terrain'] }]);
  assert.equal(request.rules.tileTypes.mud.render.label, 'Bùn');
  assert.ok(legal(engine, move(2, 0, 2, 1))); assert.equal(legal(engine, move(2, 0, 1, 0)), false);
  engine.apply(move(2, 0, 2, 1));
  assert.equal(engine.snapshot().tiles.length, 2, 'non-effect tiles stay on the board');
});

test('replays record board changes; same seed gives the same game, and tampered changes fail verification', async () => {
  const play = () => runMatch({ seed: 'tiles-match', rules: { ...POWERUPS, maxMoves: 60 }, bots: [], choose: async (player, request) => ({ cpu_ms: 1, stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[request.legal_moves.length - 1] }) }) });
  const first = await play(), second = await play();
  assert.ok(verifyReplay(first)); assert.deepEqual(first.turns, second.turns); assert.deepEqual(first.result, second.result);
  assert.ok(first.turns.every(turn => Array.isArray(turn.changes) && turn.changes.length));
  assert.ok(first.initial.tiles.length);
  const tampered = structuredClone(first); tampered.turns[0].changes[0].piece = { player: 1, type: 'R' };
  assert.throws(() => verifyReplay(tampered), /changes mismatch/);
  const legacy = structuredClone(first); for (const turn of legacy.turns) delete turn.changes;
  assert.ok(verifyReplay(legacy), 'older replays without changes still verify');
});

test('sample rule sets classic, obstacles and powerups are seeded and valid', () => {
  const db = openDatabase(':memory:');
  try {
    const ids = new RuleSetService(db).list().map(row => row.id);
    for (const id of ['ottv2-classic', 'ottv2-obstacles', 'ottv2-powerups']) assert.ok(ids.includes(id), id);
    new RuleSetService(db);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM rule_versions WHERE rule_set_id='ottv2-powerups'").get().n, 1);
  } finally { db.close(); }
});

test('seeding whole-board power-ups adds version 2 without changing the historical central-region version', () => {
  const db = openDatabase(':memory:');
  const historical = { ...structuredClone(POWERUPS), version: 1, tileSpawns: [{ types: ['wildcard', 'shield', 'dash'], count: [1, 2], symmetry: 'point', region: { rowFrom: 3, rowTo: 5, colFrom: 3, colTo: 5 } }] };
  try {
    db.prepare('INSERT OR IGNORE INTO rule_sets VALUES (?,?,?)').run(historical.id, historical.name, 0);
    db.prepare('INSERT INTO rule_versions VALUES (?,?,?,NULL,?)').run(historical.id, 1, JSON.stringify(historical), 0);
    const service = new RuleSetService(db);
    assert.deepEqual(service.get(historical.id, 1).rules, historical);
    assert.equal(service.get(historical.id).version, 2);
    assert.equal(service.get(historical.id).rules.tileSpawns[0].region, undefined);
    const oldTiles = new GameEngine({ seed: 'historical', rules: service.get(historical.id, 1).rules }).snapshot().tiles;
    assert.ok(oldTiles.every(tile => tile.row >= 3 && tile.row <= 5 && tile.col >= 3 && tile.col <= 5));
  } finally { db.close(); }
});
