// Run explicitly: npm run test:rulesets (Docker by default; SANDBOX_BACKEND=bwrap inside the ott-grader distro).
// The shipped sample bots must play every sample rule set without faults, and replays must verify with board changes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandboxManager } = require('../src/sandbox');
const { sampleSource } = require('../src/sandbox/samples');
const { runMatch, verifyReplay } = require('../src/game/match');
const { LIMITS } = require('../src/game/protocol');

test('Python and C++ sample bots play classic, obstacles and power-ups rule sets in the sandbox', { timeout: 600000 }, async () => {
  const manager = createSandboxManager(), artifacts = [];
  try {
    console.log('Sandbox:', (await manager.check()).image);
    for (const id of ['python-greedy', 'cpp-greedy']) artifacts.push(await manager.prepare(sampleSource(id)));
    for (const file of ['default', 'obstacles', 'powerups']) {
      const rules = { ...require(`../rules/${file}.json`), maxMoves: 80 };
      for (const seed of ['a', 'b']) {
        const sessions = [];
        try {
          for (const artifact of artifacts) sessions.push(await manager.start(artifact, LIMITS));
          const replay = await runMatch({ seed: `${file}-${seed}`, rules, bots: artifacts.map(a => ({ hash: a.hash, image: a.image })), choose: (player, request) => sessions[player].move(request) });
          assert.ok(!replay.fault, `${file}: ${JSON.stringify(replay.fault)}`); assert.ok(verifyReplay(replay));
          assert.ok(replay.turns.every(turn => turn.changes?.length));
          const effects = replay.turns.filter(turn => turn.changes.some(change => change.tile === null)).length;
          console.log(`${file}/${seed}: ${replay.turns.length} nước · ${replay.result.winReason} · nhặt ô ${effects}`);
        } finally { for (const session of sessions) await session.close(); }
      }
    }
  } finally { for (const artifact of artifacts) await manager.dispose(artifact); }
});
