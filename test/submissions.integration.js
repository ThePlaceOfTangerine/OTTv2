// Explicit Docker tests for the complete submission pipeline.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { openDatabase } = require('../src/db');
const { SubmissionService } = require('../src/submissions/service');
const { SandboxManager, dockerCommand } = require('../src/sandbox/docker');
const { zip } = require('./zip-helper');
const { verifyReplay } = require('../src/game/match');

test('Docker pipeline accepts C++/Python/ZIP and rejects crash, timeout, syntax, output and malicious bots', {timeout:240000}, async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ott-pipeline-'));
  const db=openDatabase(path.join(root,'test.sqlite'));
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'player','test','contestant',0)").run();
  const service=new SubmissionService(db,{storageRoot:path.join(root,'submissions'),workers:2,retryDelayMs:10});
  try {
    console.log('Docker pipeline:',await new SandboxManager().check());
    service.start();
    const py=await fs.readFile(path.resolve(__dirname,'../bots/python-greedy/main.py'));
    const cpp=await fs.readFile(path.resolve(__dirname,'../bots/cpp-greedy/main.cpp'));
    const multiple=zip([{name:'src/main.py',data:'import helper\nhelper.play()\n'},{name:'src/helper.py',data:'import json,sys\ndef play():\n r=json.loads(sys.stdin.readline())\n print(json.dumps({"request_id":r["request_id"],"move":r["legal_moves"][0]}))\n'}]);
    const cppMultiple=zip([
      {name:'src/main.cpp',data:'#include <iostream>\n#include <string>\n#include "strategy.h"\nint main(){std::string s;std::getline(std::cin,s);auto r=nlohmann::json::parse(s);std::cout<<nlohmann::json{{"request_id",r["request_id"]},{"move",choose(r)}}.dump()<<"\\n";}\n'},
      {name:'src/strategy.h',data:'#pragma once\n#include <nlohmann/json.hpp>\nnlohmann::json choose(const nlohmann::json&);\n'},
      {name:'src/strategy.cpp',data:'#include "strategy.h"\nnlohmann::json choose(const nlohmann::json& r){return r.at("legal_moves").at(0);}\n'}
    ]);
    const accepted=[];
    for(const [filename,buffer] of [['main.py',py],['main.cpp',cpp],['python.zip',multiple],['cpp.zip',cppMultiple]]) {
      const row=await service.submit({userId:1,filename,buffer}); await service.idle(120000);
      const detail=service.detail(row.id,1); console.log(filename,detail.status,detail.reason||'');
      assert.equal(detail.status,'Accepted',JSON.stringify(detail)); assert.equal(detail.tests.length,2); assert.equal(detail.active,true);
      for(const match of detail.tests) assert.ok(verifyReplay(service.test(row.id,match.id,1).replay));
      accepted.push(row.id);
    }
    for(const [filename,source,reason] of [
      ['crash.py','raise RuntimeError("intentional crash")\n','bot_crash'],
      ['loop.py','while True:\n pass\n','cpu_timeout'],
      ['syntax.py','def invalid(\n','compile_error'],
      ['output.py','print("not JSON")\n','invalid_output'],
      ['malicious.py','import os\nos.fork()\n','static_scan']
    ]) {
      const row=await service.submit({userId:1,filename,buffer:Buffer.from(source)}); await service.idle(120000);
      const detail=service.detail(row.id,1); console.log(filename,detail.status,detail.reason_code);
      assert.equal(detail.status,'Rejected'); assert.equal(detail.reason_code,reason); assert.equal(detail.active,false);
      assert.equal(service.detail(accepted.at(-1),1).active,true);
      if(detail.tests.length) assert.ok(verifyReplay(service.test(row.id,detail.tests[0].id,1).replay));
    }
    const escaped=await service.submit({userId:1,filename:'bad.zip',buffer:zip([{name:'../escape.py',data:'print(1)'}])}); await service.idle();
    assert.equal(service.detail(escaped.id,1).status,'Rejected');
  } finally {
    await service.close(); db.close();
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('ott-pipeline-'));
    await fs.rm(root,{recursive:true,force:true});
  }
  assert.equal(await dockerCommand(['ps','-a','--filter','name=ottv2-','--format','{{.Names}}']),'');
});
