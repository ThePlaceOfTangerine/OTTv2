// Run explicitly: npm run test:sandbox. These tests require REAL Docker and fail
// (never silently skip) if isolation or its image is unavailable.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SandboxManager, dockerCommand } = require('../src/sandbox/docker');
const { sampleSource } = require('../src/sandbox/samples');
const { GameEngine, DEFAULT_RULES } = require('../src/game/engine');
const { LIMITS, makeRequest, parseResponse, BotFault } = require('../src/game/protocol');
const { runMatch, verifyReplay } = require('../src/game/match');
const manager = new SandboxManager();
const artifacts = [];
before(async () => { console.log('Sandbox:', await manager.check()); });
after(async () => { for (const artifact of artifacts) await manager.dispose(artifact); });
async function prepare(source) { const artifact = await manager.prepare(source); artifacts.push(artifact); return artifact; }
async function withSession(artifact, callback, limits = LIMITS) {
  const session = await manager.start(artifact, limits);
  try { return await callback(session); } finally { await session.close(); }
}

test('Python and C++ compile in containers and return a legal move with CPU metrics', async () => {
  for (const id of ['python-greedy', 'cpp-greedy']) {
    const artifact = await prepare(sampleSource(id));
    assert.ok(artifact.compile_cpu_ms > 0);
    await withSession(artifact, async session => {
      const request = makeRequest(new GameEngine({ seed: 'sandbox' }), LIMITS);
      const result = await session.move(request);
      const parsed = parseResponse(result.stdout, request);
      assert.ok(request.legal_moves.some(m => Object.keys(m).every(key => m[key] === parsed.move[key])));
      assert.ok(result.cpu_ms > 0); assert.ok(result.wall_ms > 0);
    });
  }
});
test('crash, CPU loop, wall sleep, network, passwd, fork, memory and output are contained', async () => {
  const cases = [
    ['crash', 'bot_crash'], ['loop', 'cpu_timeout'], ['sleep', 'wall_timeout'],
    ['network', 'sandbox_violation'], ['passwd', 'bot_crash', 'PASSWD_DENIED'],
    ['fork', 'sandbox_violation'], ['memory', 'bot_crash', 'MEMORY_DENIED'], ['output', 'output_limit']
  ];
  for (const [name, code, marker] of cases) {
    const artifact = await prepare({ language: 'python', entry: 'main.py', directory: path.resolve(__dirname, '../bots/fixtures', name) });
    await withSession(artifact, async session => {
      await assert.rejects(session.move(makeRequest(new GameEngine(), LIMITS)), error => {
        assert.ok(error instanceof BotFault, `${name}: ${error}`); assert.equal(error.code, code, name);
        if (marker) assert.ok(error.metrics.stderr.includes(marker));
        assert.ok(!error.metrics.stderr.includes('UNEXPECTED_FILE_ACCESS'));
        console.log(`${name}: ${error.code}, CPU ${error.metrics.cpu_ms}ms`);
        return true;
      });
    });
  }
});
test('full Python vs C++ match repeats its moves from the same seed and verifies replay', async () => {
  const prepared = [await prepare(sampleSource('python-greedy')), await prepare(sampleSource('cpp-greedy'))];
  const play = async () => {
    const sessions = [];
    try {
      for (const artifact of prepared) sessions.push(await manager.start(artifact));
      return await runMatch({ seed: 'docker-match', bots: prepared.map(a => ({ hash: a.hash, image: a.image })),
        rules: { ...DEFAULT_RULES, maxMoves: 30 }, choose: (player, request) => sessions[player].move(request) });
    } finally { for (const session of sessions) await session.close(); }
  };
  const first = await play(), second = await play();
  assert.ok(!first.fault, JSON.stringify(first.fault)); assert.ok(verifyReplay(first));
  assert.deepEqual(first.turns.map(t => t.move), second.turns.map(t => t.move));
  assert.deepEqual(first.result, second.result);
});
test('C++ cannot read passwd or use network, including during compilation', async () => {
  await assert.rejects(prepare({ language: 'cpp', entry: 'main.cpp', directory: path.resolve(__dirname, '../bots/fixtures/cpp-include') }), error => {
    assert.equal(error.code, 'compile_error'); assert.match(error.message, /Permission denied/); return true;
  });
  const artifact = await prepare({ language: 'cpp', entry: 'main.cpp', directory: path.resolve(__dirname, '../bots/fixtures/cpp-security') });
  await withSession(artifact, async session => {
    await assert.rejects(session.move(makeRequest(new GameEngine(), LIMITS)), error => {
      assert.equal(error.code, 'sandbox_violation'); assert.match(error.metrics.stderr, /CPP_PASSWD_DENIED/);
      assert.ok(!error.metrics.stderr.includes('UNEXPECTED_FILE_ACCESS')); return true;
    });
  });
});
test('all containers from the tests have been removed', async () => {
  const containers = await dockerCommand(['ps', '-a', '--filter', 'name=ottv2-', '--format', '{{.Names}}']);
  assert.equal(containers, '');
});
