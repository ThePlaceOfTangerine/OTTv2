const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { RuleSetService } = require('../src/rule-sets');
const { MatchService } = require('../src/sandbox/match-service');
const { DEFAULT_RULES, GameEngine, validateRules } = require('../src/game/engine');
const { registerEngine } = require('../src/game/registry');
const { runMatch, verifyReplay } = require('../src/game/match');
function setup() {
  const db=openDatabase(':memory:');db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(1,'admin','unused','admin',0)").run();
  const rules=new RuleSetService(db);return{db,rules};
}

test('deleting a custom rule hides it persistently while preserving immutable historical versions and defaults', () => {
 const {db,rules}=setup();try{
  const custom=rules.save({name:'Rule to delete',rules:DEFAULT_RULES,userId:1});
  assert.throws(()=>rules.remove(custom.id,custom.version,999),e=>e.status===403);
  assert.throws(()=>rules.remove(custom.id,0,1),e=>e.status===409);
  for(const id of ['ottv2-classic','ottv2-obstacles','ottv2-powerups'])assert.throws(()=>rules.remove(id,rules.get(id).version,1),e=>e.status===400);
  assert.equal(rules.remove(custom.id,custom.version,1).deleted,true);
  assert.ok(!rules.list().some(r=>r.id===custom.id));
  assert.deepEqual(rules.get(custom.id,1).rules,custom.rules);
  assert.equal(rules.get(custom.id,1).archived,true);
  assert.throws(()=>rules.save({id:custom.id,expectedVersion:1,name:'revive',rules:custom.rules,userId:1}),e=>e.status===400);
  const restarted=new RuleSetService(db);
  assert.ok(!restarted.list().some(r=>r.id===custom.id));
  assert.equal(restarted.list().filter(r=>r.isDefault).length,3);
 }finally{db.close();}
});
function manager() { return { disposed:0, async check(){},async prepare(source){return{hash:source.id,image:'test',compile_cpu_ms:1};},async start(){return{move:async r=>({stdout:JSON.stringify({request_id:r.request_id,move:r.legal_moves[0]}),cpu_ms:1}),async close(){}};},async dispose(){this.disposed++;} }; }
function terrainRules(){return {...DEFAULT_RULES,boardSize:6,boardRows:4,boardCols:6,homes:[{row:0,col:5},{row:3,col:0}],randomExtraPiece:false,pieceTypes:['R'],playerPieceTypes:[['R'],['S','P']],startingPositions:[[[1,1]],[[2,4],[3,4]]],blockedCells:[[1,2]],voidCells:[[0,0]],maxMoves:8};}
test('rectangular terrain and different armies enforce movement, preserve core captures and replay',async()=>{
 const rules=terrainRules(),engine=new GameEngine({rules,seed:'terrain'}),state=engine.snapshot();
 assert.equal(state.board.length,4);assert.equal(state.board[0].length,6);
 assert.deepEqual(state.board.flat().filter(Boolean).map(p=>p.player).sort(),[0,1,1]);
 assert.ok(engine.legalMoves().every(m=>!(m.toRow===1&&m.toCol===2)&&!(m.toRow===0&&m.toCol===0)));
 assert.throws(()=>engine.apply({fromRow:1,fromCol:1,toRow:1,toCol:2}),/Illegal/);
 const replay=await runMatch({rules,seed:'terrain',bots:['a','b'],choose:async(p,r)=>({cpu_ms:1,stdout:JSON.stringify({request_id:r.request_id,move:r.legal_moves[0]})})});
 assert.ok(verifyReplay(replay));assert.ok(replay.turns.length<=8);
 const capture=new GameEngine({rules:{...rules,playerPieceTypes:[['R'],['S']],startingPositions:[[[1,1]],[[2,1]]]},seed:'capture'});
 assert.equal(capture.apply({fromRow:1,fromCol:1,toRow:2,toCol:1}).winner,0);
 for(const invalid of [{boardRows:1},{boardCols:3},{blockedCells:[[0,5]]},{blockedCells:[[1,1]]},{voidCells:[[0,0],[0,0]]},{blockedCells:[[0,0]]},{playerPieceTypes:[[],['R']]},{randomExtraPiece:true}])assert.throws(()=>validateRules({...rules,...invalid}));
});
test('rule sets create, rename by new version and keep old versions immutable',()=>{
 const {db,rules}=setup();try{
  const a=rules.save({name:'Luật nhanh',rules:{...DEFAULT_RULES,maxMoves:12},userId:1});assert.equal(a.version,1);
  const b=rules.save({id:a.id,expectedVersion:1,name:'Luật nhanh sửa',rules:{...a.rules,maxMoves:20},userId:1});assert.equal(b.version,2);assert.equal(rules.get(a.id,1).rules.maxMoves,12);assert.equal(rules.get(a.id,1).rules.name,'Luật nhanh');
  assert.throws(()=>rules.save({id:a.id,expectedVersion:1,name:'stale',rules:a.rules,userId:1}),e=>e.status===409);
  assert.throws(()=>db.prepare('UPDATE rule_versions SET rules_json=? WHERE rule_set_id=?').run('{}',a.id),/immutable/);assert.throws(()=>db.prepare('DELETE FROM rule_versions WHERE rule_set_id=?').run(a.id),/immutable/);
  for(const config of [{...DEFAULT_RULES,boardSize:2},{...DEFAULT_RULES,engine:'../../evil'},{...DEFAULT_RULES,maxMoves:0},{...DEFAULT_RULES,startingPositions:[[],[]]}])assert.throws(()=>rules.save({name:'bad',rules:config,userId:1}),e=>e.status===400);
 }finally{db.close();}
});
test('custom-law practice snapshots versions and has no effect on active bot or Elo',async()=>{
 const {db,rules}=setup(),runner=manager();
 db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(2,'player','unused','contestant',0)").run();
 const bot='11111111-1111-1111-1111-111111111111';db.prepare("INSERT INTO bot_submissions(id,user_id,version,filename,entry,language,status,job_status,created_at,updated_at,image) VALUES (?,2,1,'main.py','main.py','python','Accepted','done',0,0,'pinned')").run(bot);db.prepare('INSERT INTO active_bots VALUES(2,?)').run(bot);
 const service=new MatchService(db,{manager:runner,ruleSets:rules,submissions:{folder:()=>'/trusted/artifact'}});
 try{
  const law=rules.save({name:'6 nước',rules:{...DEFAULT_RULES,maxMoves:6},userId:1});const id=service.create({userId:1,botA:'submission:'+bot,botB:'cpp-greedy',seed:'custom',ruleSetId:law.id,ruleSetVersion:1});
  rules.save({id:law.id,expectedVersion:1,name:'Luật khác',rules:{...law.rules,maxMoves:40},userId:1});await service.active;
  const match=service.get(id);assert.equal(match.status,'finished');assert.equal(match.rules.version,1);assert.equal(match.rules.maxMoves,6);assert.ok(verifyReplay(match.replay));assert.equal(match.replay.rule_set_id,law.id);assert.equal(match.replay.bots[0].submission_id,bot);
  assert.equal(runner.disposed,1);assert.equal(db.prepare('SELECT submission_id FROM active_bots WHERE user_id=2').get().submission_id,bot);assert.equal(db.prepare('SELECT COUNT(*) n FROM score_rounds').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM score_entrants').get().n,0);
  assert.ok(service.botChoices().some(b=>b.id==='submission:'+bot));
  const bad='22222222-2222-2222-2222-222222222222';assert.throws(()=>service.create({userId:1,botA:'submission:'+bad,botB:'cpp-greedy',seed:'x'}),e=>e.status===400);
 }finally{db.close();}
});
test('trusted engine module extends state without changing bot protocol or match loop',async()=>{
 const engineId='test-grid-extra';registerEngine(engineId,{
  validate:r=>{validateRules({...r,engine:'rps-grid-v1'});return structuredClone(r);},
  create:({rules,seed})=>{const engine=new GameEngine({rules:{...rules,engine:'rps-grid-v1'},seed});engine.rules=rules;const base=engine.snapshot.bind(engine);engine.snapshot=()=>({...base(),customPhase:'test-module'});return engine;}
 });
 let observed=false;const replay=await runMatch({seed:'module',rules:{...DEFAULT_RULES,engine:engineId,maxMoves:4},bots:['a','b'],choose:async(p,r)=>{assert.equal(r.protocol_version,1);assert.equal(r.state.customPhase,'test-module');observed=true;return{cpu_ms:1,stdout:JSON.stringify({request_id:r.request_id,move:r.legal_moves[0]})};}});
 assert.ok(observed);assert.ok(verifyReplay(replay));assert.throws(()=>registerEngine(engineId,{}),/duplicate/);
});
