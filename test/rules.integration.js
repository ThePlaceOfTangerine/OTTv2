const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { openDatabase } = require('../src/db');
const { SubmissionService } = require('../src/submissions/service');
const { MatchService } = require('../src/sandbox/match-service');
const { RuleSetService } = require('../src/rule-sets');
const { DEFAULT_RULES } = require('../src/game/engine');
const { verifyReplay } = require('../src/game/match');
test('Docker custom-law sandbox supports sample/sample, student/sample and student/student without scoring', {timeout:180000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ott-rules-')),db=openDatabase(path.join(root,'arena.sqlite'));
 db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(1,'admin','unused','admin',0)").run();
 for(const id of [2,3])db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,'unused','contestant',0)").run(id,'player'+id);
 const submissions=new SubmissionService(db,{storageRoot:path.join(root,'submissions')});const ruleSets=new RuleSetService(db);const matches=new MatchService(db,{submissions,ruleSets});
 try{
  for(const [userId,source]of [[2,'python-greedy/main.py'],[3,'cpp-greedy/main.cpp']])await submissions.submit({userId,filename:path.basename(source),buffer:await fs.readFile(path.join(__dirname,'../bots',source))});
  submissions.start();await submissions.idle();const bots=db.prepare("SELECT id FROM bot_submissions WHERE status='Accepted' ORDER BY user_id").all();assert.equal(bots.length,2,JSON.stringify(db.prepare('SELECT status,job_status,reason_code,reason FROM bot_submissions').all()));
  const before=db.prepare('SELECT * FROM active_bots ORDER BY user_id').all();
  const law=ruleSets.save({name:'Sandbox bản đồ chữ nhật có ô chặn',rules:{...DEFAULT_RULES,boardSize:8,boardRows:6,boardCols:8,maxMoves:8,randomExtraPiece:false,pieceTypes:['R','P','S'],playerPieceTypes:[['R','P','S'],['R','R','P','S']],homes:[{row:0,col:7},{row:5,col:0}],startingPositions:[[[0,5],[1,6],[1,7]],[[4,0],[4,1],[5,1],[5,2]]],blockedCells:[[2,3],[3,4]],voidCells:[[0,0],[5,7]],boardTheme:'forest'},userId:1});
  for(const [botA,botB]of [['python-greedy','cpp-greedy'],['submission:'+bots[0].id,'cpp-greedy'],['submission:'+bots[0].id,'submission:'+bots[1].id]]){
    const id=matches.create({userId:1,botA,botB,seed:'rules-docker',ruleSetId:law.id,ruleSetVersion:1});await matches.active;const result=matches.get(id);
    assert.equal(result.status,'finished',JSON.stringify(result));assert.equal(result.replay.rule_set_id,law.id);assert.equal(result.replay.rule_set_version,1);assert.ok(result.replay.turns.length<=8);assert.ok(verifyReplay(result.replay));console.log(botA.startsWith('submission')?'student':'sample','vs',botB.startsWith('submission')?'student':'sample',result.replay.result.winReason,result.replay.turns.length);
    assert.equal(result.replay.initial.board.length,6);assert.equal(result.replay.initial.board[0].length,8);
  }
  assert.deepEqual(db.prepare('SELECT * FROM active_bots ORDER BY user_id').all(),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM score_matches').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM score_entrants').get().n,0);
  const extended=ruleSets.save({name:'Power-up và hướng đi từng loại',rules:{...DEFAULT_RULES,maxMoves:12,powerUps:true,symmetricArmies:true,movementByType:{R:{kind:'rook'},P:{kind:'knight'},S:{kind:'bishop'}}},userId:1});
  const extendedId=matches.create({userId:1,botA:'submission:'+bots[0].id,botB:'submission:'+bots[1].id,seed:'extended-docker',ruleSetId:extended.id,ruleSetVersion:1});await matches.active;
  const extendedResult=matches.get(extendedId);assert.equal(extendedResult.status,'finished',JSON.stringify(extendedResult));assert.ok(!extendedResult.replay.fault);assert.ok(verifyReplay(extendedResult.replay));assert.ok(extendedResult.replay.initial.powerUps.length>=1);
 }finally{await matches.active;await submissions.close();db.close();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('ott-rules-'));await fs.rm(root,{recursive:true,force:true});}
});
