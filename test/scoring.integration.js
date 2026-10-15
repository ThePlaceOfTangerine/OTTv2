// Explicit integration test: real accepted artifacts, real Docker runtime, no live data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { openDatabase } = require('../src/db');
const { SubmissionService } = require('../src/submissions/service');
const { ScoringService } = require('../src/scoring');
const { verifyReplay } = require('../src/game/match');
const { dockerCommand } = require('../src/sandbox/docker');
test('Docker scoring uses pinned accepted Python/C++ artifacts and swapped-side ranked matches', { timeout: 180000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-score-')), db = openDatabase(path.join(root, 'arena.sqlite'));
  const submissions = new SubmissionService(db, { storageRoot: path.join(root, 'submissions'), workers: 2 });
  const scoring = new ScoringService(db, submissions);
  try {
    db.prepare("INSERT INTO users(id,username,password_hash,role,locked,created_at) VALUES(1,'admin','unused','admin',0,0)").run();
    for (const [id, file] of [[2,'python-greedy/main.py'],[3,'cpp-greedy/main.cpp']]) {
      db.prepare("INSERT INTO users(id,username,password_hash,role,locked,created_at) VALUES(?,?,'unused','contestant',0,0)").run(id, 'team' + id);
      await submissions.submit({ userId:id, filename:path.basename(file), buffer:await fs.readFile(path.join(__dirname,'../bots',file)) });
    }
    submissions.start(); await submissions.idle(120000);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bot_submissions WHERE status='Accepted'").get().n,2);
    const id = scoring.create(1, { seed:'docker-ranking',gamesPerBot:2,gamesPerPair:2 }); scoring.start();
    const deadline=Date.now()+90000;
    while(scoring.detail(id).status!=='finished') {
      assert.ok(Date.now()<deadline, JSON.stringify(scoring.detail(id)));
      assert.ok(!scoring.detail(id).counts.some(c=>c.status==='blocked'), JSON.stringify(scoring.detail(id)));
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    const round=scoring.detail(id);assert.equal(round.matches.length,2);assert.ok(round.standings.every(e=>e.played===2));
    for(const match of round.matches) {const replay=scoring.match(match.id).replay;assert.ok(verifyReplay(replay));assert.ok(!replay.fault);assert.ok(replay.bots.every(b=>b.image.startsWith('sha256:')));}
    console.log('Ranked Docker matches:',round.matches.map(m=>({sequence:m.sequence,status:m.status})),round.standings.map(e=>({username:e.username,elo:e.rating,played:e.played})));
  } finally {
    await scoring.close();await submissions.close();db.close();
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('ott-score-'));await fs.rm(root,{recursive:true,force:true});
  }
  assert.equal(await dockerCommand(['ps','-a','--filter','name=ottv2-','--format','{{.Names}}']),'');
});
