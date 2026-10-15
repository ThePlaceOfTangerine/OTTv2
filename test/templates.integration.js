const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SandboxManager } = require('../src/sandbox/docker');
const { scanSource } = require('../src/submissions/source');
const { GameEngine } = require('../src/game/engine');
const { LIMITS, makeRequest, parseResponse } = require('../src/game/protocol');

test('downloadable annotated Python/C++ templates pass scanning and choose legal moves in Docker', { timeout: 90000 }, async () => {
  const manager = new SandboxManager(); await manager.check();
  for (const [language, folder, entry] of [['python','python','main.py'],['cpp','cpp','main.cpp']]) {
    const source = { id: 'template-' + language, directory: path.resolve(__dirname, '../bots/templates', folder), entry, language, names: [entry] };
    await scanSource(source);
    const artifact = await manager.prepare(source); let session;
    try {
      session = await manager.start(artifact, LIMITS);
      const engine = new GameEngine({ seed: 'contestant-template' });
      for (let i = 0; i < 2; i++) {
        const request = makeRequest(engine, LIMITS), response = await session.move(request), parsed = parseResponse(response.stdout, request);
        assert.ok(request.legal_moves.some(move => ['fromRow','fromCol','toRow','toCol'].every(key => move[key] === parsed.move[key])));
        assert.ok(response.cpu_ms >= 0 && response.cpu_ms <= LIMITS.moveCpuMs);
        engine.apply(parsed.move);
      }
      console.log(language, 'template: scanning, compile and two legal moves passed');
    } finally { try { await session?.close(); } finally { await manager.dispose(artifact); } }
  }
});
