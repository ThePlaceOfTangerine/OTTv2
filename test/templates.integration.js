const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SandboxManager } = require('../src/sandbox/docker');
const { scanSource } = require('../src/submissions/source');
const { GameEngine, DEFAULT_RULES } = require('../src/game/engine');
const { LIMITS, makeRequest, parseResponse } = require('../src/game/protocol');

test('downloadable annotated Python/C++ templates pass scanning and choose legal moves in Docker', { timeout: 90000 }, async () => {
  const manager = new SandboxManager(); await manager.check();
  for (const [language, folder, entry] of [['python','templates/python','main.py'],['cpp','templates/cpp','main.cpp'],['python','python-greedy','main.py'],['cpp','cpp-greedy','main.cpp']]) {
    const source = { id: 'template-' + folder.replace('/','-'), directory: path.resolve(__dirname, '../bots', folder), entry, language, names: [entry] };
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
      const rules={...DEFAULT_RULES,boardSize:10,boardRows:10,boardCols:12,powerUps:true,movementByType:{R:{kind:'knight'},P:{kind:'rook'},S:{kind:'custom',directions:[[0,1]],maxSteps:3,jump:false}},blockedCells:[[5,3]],voidCells:[[0,0]]};
      async function chooseFixture(pieces,powerUps,expected){
        const game=new GameEngine({rules,seed:'new-rules-template'});
        game._state.board=Array.from({length:10},()=>Array(12).fill(null));
        for(const [r,c,player,type,powered]of pieces)game._state.board[r][c]={player,type,...(powered?{powered:true}:{})};
        game._state.powerUps=powerUps;
        const request=makeRequest(game,LIMITS),response=await session.move(request),parsed=parseResponse(response.stdout,request);
        assert.ok(request.legal_moves.some(move=>['fromRow','fromCol','toRow','toCol'].every(key=>move[key]===parsed.move[key])));
        assert.deepEqual([parsed.move.toRow,parsed.move.toCol],expected,folder);
      }
      // A knight with a clear leg moves and collects a power-up beyond one square.
      await chooseFixture([[4,4,0,'R'],[9,11,1,'P']],[[6,5]],[6,5]);
      // A powered scissor can capture another scissor using its custom long move.
      await chooseFixture([[4,4,0,'S',true],[4,7,1,'S'],[9,11,1,'P']],[],[4,7]);
      // A powered piece should not spend its turn collecting another item.
      await chooseFixture([[4,4,0,'P',true],[9,11,1,'R']],[[4,10]],[4,3]);
      // Reaching the enemy home takes priority over a capture or power-up.
      await chooseFixture([[8,3,0,'P'],[8,5,1,'R'],[9,11,1,'S']],[[8,4]],[8,0]);
      console.log(folder, 'Classic, custom movement, pickup, powered capture and home priority passed');
    } finally { try { await session?.close(); } finally { await manager.dispose(artifact); } }
  }
});
