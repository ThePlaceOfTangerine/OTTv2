// Phase 6b without running bots: shared hints, static-scan line numbers, rank change and badges, replay navigation, offline replay.html.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HINTS, explain, badgeText, rankChangeText } = require('../web/hints');
const { replayEvents, nextEvent } = require('../web/replay-nav');
const { standings, progress } = require('../src/swiss-pairing');
const { extractSource, scanSource } = require('../src/submissions/source');
const { createEngine } = require('../src/game/registry');
const { replayHtml } = require('../src/replay-html');
const { parseArgs } = require('../scripts/ott-run');

test('every error code the code base can raise has a Vietnamese hint', () => {
  const codes = new Set(['bot_crash', 'wall_timeout', 'sandbox_violation', 'artifact_limit', 'compiler_missing']);
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);
  for (const file of walk(path.join(__dirname, '../src'))) for (const match of fs.readFileSync(file, 'utf8').matchAll(/(?:BotFault|fail)\('([a-z_]+)'/g)) codes.add(match[1]);
  for (const code of codes) assert.ok(HINTS[code], `thiếu gợi ý cho ${code}`);
  assert.equal(explain('bot_crash', 'Traceback (most recent call last):\n  File "main.py", line 3\nIndexError: list index out of range\n').detail, 'IndexError: list index out of range');
  assert.match(explain('compile_error', 'main.cpp: In function int main():\nmain.cpp:1:11: error: expected primary-expression\n').detail, /^main\.cpp:1:11: error/);
  assert.equal(explain('ma_la', 'x').title, 'Bài chưa vượt qua kiểm tra.');
  assert.deepEqual([rankChangeText(3), rankChangeText(-2), rankChangeText(0), rankChangeText(null)], ['↑3', '↓2', '=', '–']);
  assert.match(badgeText({ code: 'streak', value: 4 }).title, /4 trận/);
});

test('static scan names the file, line and banned word; comments do not shift line numbers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-scan-'));
  try {
    const cases = [['main.py', 'import sys\n# import os\n\nx = 1; import socket\n', /main\.py dòng 4: .*"socket"/], ['main.py', 'def f():\n    return eval("1")\n', /dòng 2: .*"eval"/],
      ['main.cpp', '#include <iostream>\n/* system(\n */\nint main(){\n  system("x");\n}\n', /main\.cpp dòng 5: .*"system"/], ['main.cpp', '// fine\n#include <windows.h>\n', /dòng 2: .*"windows\.h"/]];
    for (const [i, [name, code, expected]] of cases.entries()) {
      const source = await extractSource({ directory: path.join(root, String(i)), filename: name, buffer: Buffer.from(code) });
      await assert.rejects(scanSource(source), error => error.code === 'static_scan' && expected.test(error.message));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// 8 teams × 3 rounds with deterministic pseudo-random results; checked against the definitions in D17 rather than hand-picked numbers.
function season(seed) {
  let x = seed; const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const entrants = Array.from({ length: 8 }, (_, i) => ({ userId: i + 1, username: `doi${i + 1}`, version: 1 })), pairs = [];
  for (let round = 1; round <= 3; round++) {
    const order = entrants.map(e => e.userId).sort(() => random() - 0.5);
    for (let i = 0; i < 8; i += 2) { const r = Math.floor(random() * 3); pairs.push({ round_number: round, user0: order[i], user1: order[i + 1], status: 'finished', result0_units: r, result1_units: 2 - r, game0_units: r, game1_units: 2 - r }); }
  }
  return { entrants, pairs };
}
test('rank change compares with the last complete round before; badges follow their definitions', () => {
  let comeback = 0, streaks = 0, undefeated = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { entrants, pairs } = season(seed), faulted = new Set([3]);
    const rows = progress(standings(entrants, pairs, 's'), entrants, pairs, 's', faulted);
    const before = new Map(standings(entrants, pairs.filter(p => p.round_number <= 2), 's').map(r => [r.userId, r.rank]));
    for (const row of rows) {
      assert.equal(row.rankChange, before.get(row.userId) - row.rank);
      const codes = row.badges.map(b => b.code), history = pairs.filter(p => p.user0 === row.userId || p.user1 === row.userId).map(p => p.user0 === row.userId ? p.result0_units : p.result1_units);
      assert.equal(codes.includes('undefeated'), history.length >= 3 && !history.includes(0));
      assert.equal(codes.includes('streak'), history.slice(-3).every(r => r === 2) && history.length >= 3);
      assert.equal(codes.includes('clean'), row.userId !== 3);
      assert.equal(codes.includes('comeback'), row.rankChange >= 5);
      comeback += codes.includes('comeback'); streaks += codes.includes('streak'); undefeated += codes.includes('undefeated');
    }
  }
  assert.ok(comeback && streaks && undefeated, 'mẫu thử phải có đủ các loại huy hiệu');
  // Round 3 half played: the baseline is round 2. Only round 1 complete: no baseline yet.
  const { entrants, pairs } = season(7);
  const partial = pairs.map((p, i) => i >= 10 ? { ...p, status: 'queued', result0_units: null, result1_units: null } : p);
  const base = new Map(standings(entrants, partial.filter(p => p.round_number <= 2), 's').map(r => [r.userId, r.rank]));
  for (const row of progress(standings(entrants, partial, 's'), entrants, partial, 's')) assert.equal(row.rankChange, base.get(row.userId) - row.rank);
  const first = pairs.filter(p => p.round_number === 1);
  assert.ok(progress(standings(entrants, first, 's'), entrants, first, 's').every(row => row.rankChange === null && !row.badges.some(b => b.code === 'streak')));
});

function sampleReplay() {
  const engine = createEngine({ seed: 'nav', rules: require('../rules/powerups.json') }), initial = engine.snapshot(), turns = [];
  // Greedy-ish: prefer moves that land on an occupied or tile square so the replay has captures and pickups.
  while (engine.snapshot().status === 'playing' && turns.length < 200) {
    const state = engine.snapshot(), moves = engine.legalMoves();
    const move = moves.find(m => state.board[m.toRow][m.toCol] || (state.tiles || []).some(t => t.row === m.toRow && t.col === m.toCol)) || moves[turns.length % moves.length];
    engine.apply(move); turns.push({ player: state.currentTurn, move, changes: engine.lastChanges });
  }
  return { rules: engine.rules, initial, turns, bots: [{ id: 'a' }, { id: 'b' }], result: engine.snapshot(), limits: {} };
}
test('replay navigation finds captures and pickups; replay.html is offline and cannot be broken out of', () => {
  const replay = sampleReplay(), events = replayEvents(replay);
  assert.ok(events.length > 0 && events.every(e => e.turn >= 1 && e.turn <= replay.turns.length && e.kinds.length));
  for (const event of events.filter(e => e.kinds.includes('capture'))) {
    const before = replayEvents({ ...replay, turns: replay.turns.slice(0, event.turn) }).at(-1);
    assert.equal(before.turn, event.turn);
  }
  assert.equal(nextEvent(events, 0), events[0].turn); assert.equal(nextEvent(events, events[0].turn, -1), null);
  assert.equal(nextEvent(events, replay.turns.length), null);
  replay.turns[0].stderr = '</script><script>alert(1)</script>';
  const html = replayHtml({ title: 'Thử <b>', games: [{ title: 'Ván 1', summary: 'x', replay }] });
  assert.ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html) && !/url\(\s*["']?https?:/i.test(html) && !/\bfetch\(/.test(html), 'không tải gì từ mạng');
  assert.ok(!html.includes('</script><script>alert(1)'), 'dữ liệu không đóng được thẻ script');
  assert.ok(html.includes('<title>Thử &lt;b&gt;</title>'));
  const data = JSON.parse(html.match(/<script type="application\/json" id="ott-games">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data[0].replay.turns.length, replay.turns.length); assert.equal(data[0].replay.turns[0].stderr, replay.turns[0].stderr);
});

test('ott-run arguments', () => {
  assert.deepEqual(parseArgs(['bot.py']), { vs: 'python-greedy', rules: 'classic', games: 2, seed: null, out: null, open: true, file: 'bot.py' });
  assert.equal(parseArgs(['bot.cpp', '--vs', 'cpp-greedy', '--games', '4', '--no-open']).games, 4);
  for (const bad of [[], ['a.py', 'b.py'], ['a.py', '--games', '0'], ['a.py', '--bogus'], ['a.py', '--vs']]) assert.throws(() => parseArgs(bad));
});
