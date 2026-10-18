const {test}=require('node:test');
const assert=require('node:assert/strict');
const {GameEngine,DEFAULT_RULES,validateRules}=require('../src/game/engine');
const {runMatch,verifyReplay}=require('../src/game/match');
const move=(r,c,tr,tc)=>({fromRow:r,fromCol:c,toRow:tr,toCol:tc});
function fixture(extra={},pieces=[[4,4,0,'R'],[7,7,1,'P']]){
  const game=new GameEngine({rules:{...structuredClone(DEFAULT_RULES),...extra}});
  game._state.board=Array.from({length:9},()=>Array(9).fill(null));
  for(const [r,c,player,type]of pieces)game._state.board[r][c]={player,type};
  return game;
}
const has=(g,r,c,tr,tc,p=0)=>g.legalMoves(p).some(m=>JSON.stringify(m)===JSON.stringify(move(r,c,tr,tc)));
test('power-ups are deterministic, 1–3, and only on free playable non-home cells',()=>{
  const rules={...DEFAULT_RULES,powerUps:true,blockedCells:[[4,4]],voidCells:[[4,5]]};
  const counts=new Set();
  for(let i=0;i<40;i++){
    const g=new GameEngine({rules,seed:String(i)}),s=g.snapshot();counts.add(s.powerUps.length);
    assert.deepEqual(s,new GameEngine({rules,seed:String(i)}).snapshot());
    for(const [r,c]of s.powerUps){assert.equal(s.board[r][c],null);assert(!g.unavailable.has(`${r},${c}`));assert(!rules.homes.some(h=>h.row===r&&h.col===c));}
  }
  assert.deepEqual([...counts].sort(),[1,2,3]);
  assert(!Object.hasOwn(new GameEngine().snapshot(),'powerUps'));
});
test('pickup persists, enables equal-type capture, and still loses to stronger type',()=>{
  const g=fixture({powerUps:true},[[4,3,0,'R'],[4,5,1,'R'],[3,4,1,'P'],[7,7,1,'S']]);
  g._state.powerUps=[[4,4]];g.apply(move(4,3,4,4));
  assert.equal(g.snapshot().board[4][4].powered,true);assert.deepEqual(g.snapshot().powerUps,[]);
  assert(has(g,4,4,4,5));assert(!has(g,4,4,3,4));assert(has(g,3,4,4,4,1));
  g.apply(move(7,7,7,6));g.apply(move(4,4,4,5));assert.equal(g.snapshot().board[4][5].powered,true);
  const normal=fixture({},[[4,4,0,'R'],[4,5,1,'R']]);assert(!has(normal,4,4,4,5));
});
test('sliding presets stop at terrain and pieces; knights are blocked; pawns use relative capture directions',()=>{
  const rook=fixture({movementByType:{R:{kind:'rook'}}},[[4,4,0,'R'],[4,6,1,'S'],[2,4,0,'P'],[7,7,1,'P']]);
  assert(has(rook,4,4,4,6));assert(!has(rook,4,4,4,7));assert(!has(rook,4,4,1,4));assert(!has(rook,4,4,5,5));
  rook.unavailable.add('5,4');assert(!has(rook,4,4,6,4));
  const knight=fixture({movementByType:{R:{kind:'knight'}}});assert(has(knight,4,4,6,5));knight.unavailable.add('5,4');assert(!has(knight,4,4,6,5));knight.unavailable.add('6,5');assert(!has(knight,4,4,6,5));
  const pawn=fixture({movementByType:{R:{kind:'pawn'}}},[[4,4,0,'R'],[5,5,1,'S'],[6,6,1,'R'],[5,7,0,'S']]);
  assert(has(pawn,4,4,5,4));assert(has(pawn,4,4,5,5));assert(!has(pawn,4,4,3,4));assert(!has(pawn,4,4,5,3));assert(has(pawn,6,6,5,7,1));
});
test('custom vectors validate and respect jump and symmetric army enforcement',()=>{
  const config={kind:'custom',directions:[[0,2]],maxSteps:2,jump:false};
  const g=fixture({movementByType:{R:config}},[[4,1,0,'R'],[4,2,0,'P'],[7,7,1,'S']]);assert(!has(g,4,1,4,3));
  const jump=fixture({movementByType:{R:{...config,jump:true}}},[[4,1,0,'R'],[4,2,0,'P'],[7,7,1,'S']]);assert(!has(jump,4,1,4,5));
  for(const directions of [[[0,0]],[[9,0]],[[1,0],[1,0]]])assert.throws(()=>validateRules({...DEFAULT_RULES,movementByType:{R:{...config,directions}}}));
  assert.throws(()=>validateRules({...DEFAULT_RULES,symmetricArmies:true,randomExtraPiece:false,playerPieceTypes:[DEFAULT_RULES.pieceTypes,Array(10).fill('R')]}));
});
test('extended movement and power-ups replay deterministically and detect tampering',async()=>{
  const replay=await runMatch({seed:'power-replay',rules:{...DEFAULT_RULES,powerUps:true,maxMoves:20,movementByType:{R:{kind:'rook'},P:{kind:'knight'},S:{kind:'bishop'}}},bots:['a','b'],choose:async(player,request)=>({response:{request_id:request.request_id,move:request.legal_moves[0],userdata:null},cpu_ms:0})});
  assert.equal(verifyReplay(replay),true);
  replay.initial.powerUps=[];assert.throws(()=>verifyReplay(replay),/Initial/);
});

test('friendly and enemy pieces block all knight leg directions',()=>{
 for(const player of [0,1])for(const [dr,dc]of [[2,1],[-2,-1],[1,-2],[-1,2]]){
  const g=fixture({movementByType:{R:{kind:'knight'}}});assert(has(g,4,4,4+dr,4+dc));
  g._state.board[4+Math.trunc(dr/2)][4+Math.trunc(dc/2)]={player,type:'S'};
  assert(!has(g,4,4,4+dr,4+dc));
 }
});
