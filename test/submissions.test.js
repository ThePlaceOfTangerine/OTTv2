const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { openDatabase } = require('../src/db');
const { SubmissionService } = require('../src/submissions/service');
const { extractSource, scanSource } = require('../src/submissions/source');
const { BotFault, InfrastructureError } = require('../src/game/protocol');
const { zip } = require('./zip-helper');

async function temporary(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'ott-sub-test-'));
  try { return await callback(root); }
  finally {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('ott-sub-test-'));
    await fs.rm(resolved,{ recursive:true,force:true });
  }
}
function fakeManager({ check = async () => {}, fault, delay = 0 } = {}) {
  return {
    check,
    async prepare(source) {
      if (source.entry.includes('slow')) await new Promise(resolve => setTimeout(resolve,delay || 200));
      return { ...source, hash:'fake-source-hash', image:'fake-image', compile_cpu_ms:1, compile_stderr:'' };
    },
    async start(artifact) {
      return { close:async()=>{}, move:async request => {
        if (fault && artifact.id !== 'python-greedy') throw new BotFault(fault);
        return { stdout:JSON.stringify({request_id:request.request_id,move:request.legal_moves[0]}),cpu_ms:1,stderr:'' };
      } };
    },
    async dispose() {}
  };
}
async function withService(options, callback) {
  return temporary(async root => {
    const db = openDatabase(':memory:');
    for (const id of [1,2]) db.prepare('INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,?,?,0)').run(id,`user${id}`,'test','contestant');
    const service = new SubmissionService(db,{storageRoot:root,retryDelayMs:0,managerFactory:()=>fakeManager(),...options});
    try { return await callback(service,db); } finally { await service.close(); db.close(); }
  });
}
const good = 'import json\nimport sys\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({"request_id":r["request_id"],"move":r["legal_moves"][0]}))\n';
async function submit(service,filename='main.py',buffer=Buffer.from(good),extra={}) { return service.submit({userId:1,filename,buffer,...extra}); }

test('ZIP extracts multiple source files and resolves an explicit or default entry', async () => temporary(async root => {
  const source = await extractSource({directory:path.join(root,'one'),filename:'bot.zip',buffer:zip([{name:'src/main.py',data:'import helper\n'},{name:'src/helper.py',data:'value=1\n'}])});
  assert.equal(source.language,'python'); assert.equal(source.entry,'src/main.py'); assert.equal(source.names.length,2);
  assert.equal(await fs.readFile(path.join(root,'one/src/helper.py'),'utf8'),'value=1\n');
  const cpp = await extractSource({directory:path.join(root,'two'),filename:'bot.zip',entry:'src/play.cpp',buffer:zip([{name:'src/play.cpp',data:'#include "strategy.h"\nint main(){}'},{name:'src/strategy.h',data:'#pragma once\n'}])});
  assert.equal(cpp.language,'cpp'); assert.equal(cpp.entry,'src/play.cpp');
}));
test('ZIP rejects traversal, absolute/Windows paths, symlinks, duplicates and unsupported content', async () => temporary(async root => {
  const cases = [
    [{name:'../escape.py',data:'x=1'}], [{name:'/escape.py',data:'x=1'}], [{name:'C:/escape.py',data:'x=1'}],
    [{name:'folder\\main.py',data:'x=1'}], [{name:'NUL.py',data:'x=1'}],
    [{name:'main.py',data:'x=1',attributes:(0xa1ff<<16)>>>0}],
    [{name:'main.py',data:'a=1'},{name:'MAIN.py',data:'b=1'}],
    [{name:'main.py',data:'x=1'},{name:'tool.exe',data:'binary'}],
    [{name:'main.py',data:'x=1'},{name:'main.cpp',data:'int main(){}'}],
    [{name:'main.py',data:'x=1',flags:1}]
  ];
  for (const [i,entries] of cases.entries()) await assert.rejects(extractSource({directory:path.join(root,String(i)),filename:'bot.zip',buffer:zip(entries)}),BotFault);
  await assert.rejects(fs.stat(path.join(root,'escape.py')));
}));
test('ZIP rejects bombs, forged sizes, too many entries, truncated archives and nested ZIPs', async () => temporary(async root => {
  const buffers = [zip([{name:'main.py',data:'a'.repeat(200000)}]),zip([{name:'main.py',data:'x=1',declaredSize:6*1024*1024}]),
    zip(Array.from({length:65},(_,i)=>({name:`file${i}.py`,data:'x=1'}))),Buffer.from('not a zip'),zip([{name:'nested.zip',data:'PK'}])];
  for (const [i,buffer] of buffers.entries()) await assert.rejects(extractSource({directory:path.join(root,String(i)),filename:'bot.zip',buffer}),BotFault);
}));
test('static scan blocks dangerous imports/functions and supports an optional extra scanner', async () => temporary(async root => {
  let hooked=false;
  const valid=await extractSource({directory:path.join(root,'good'),filename:'main.py',buffer:Buffer.from(good)});
  await scanSource(valid,async()=>{hooked=true;}); assert.equal(hooked,true);
  for (const [i,code] of ['import os\n','import sys, socket\n','from subprocess import run\n','__import__("os")\n','open("/etc/passwd")\n'].entries()) {
    const source=await extractSource({directory:path.join(root,`bad${i}`),filename:'main.py',buffer:Buffer.from(code)});
    await assert.rejects(scanSource(source),error=>error.code==='static_scan');
  }
  const cpp=await extractSource({directory:path.join(root,'cpp'),filename:'main.cpp',buffer:Buffer.from('#include <iostream>\nint main(){system("whoami");}')});
  await assert.rejects(scanSource(cpp),error=>error.code==='static_scan');
}));
test('accepted pipeline records every stage, two tests, artifact and activates newest version', async () => withService({},async(service,db)=>{
  const first=await submit(service); service.start(); await service.idle();
  const detail=service.detail(first.id,1); assert.equal(detail.status,'Accepted'); assert.equal(detail.tests.length,2); assert.equal(detail.active,true);
  assert.deepEqual([...new Set(detail.events.map(e=>e.stage))],['Queued','Scanning','Compiling','Test match','Accepted']);
  await fs.stat(path.join(service.folder(first.id,'artifact'),'main.py'));
  const second=await submit(service,'second.py'); await service.idle();
  assert.equal(service.detail(second.id,1).version,2); assert.equal(service.detail(second.id,1).active,true); assert.equal(service.detail(first.id,1).active,false);
  assert.ok(service.activate(first.id,1)); assert.equal(service.detail(first.id,1).active,true);
  assert.equal(service.detail(first.id,2),null); assert.equal(service.test(first.id,detail.tests[0].id,2),null); assert.equal(service.activate(first.id,2),false);
  assert.ok(service.test(first.id,detail.tests[0].id,1).replay);
}));
test('out-of-order workers cannot replace a newer accepted active bot with an older version', async () => withService({workers:2},async service=>{
  const older=await submit(service,'slow.py'),newer=await submit(service,'fast.py'); service.start(); await service.idle();
  assert.equal(service.detail(older.id,1).status,'Accepted'); assert.equal(service.detail(newer.id,1).active,true);
}));
test('malicious source and crashing/timing out bots are Rejected with reasons', async () => {
  await withService({},async service=>{
    const bad=await submit(service,'bad.py',Buffer.from('import socket\n')); service.start(); await service.idle();
    assert.equal(service.detail(bad.id,1).status,'Rejected'); assert.equal(service.detail(bad.id,1).reason_code,'static_scan');
    assert.equal(service.detail(bad.id,1).language,'python');
    assert.throws(()=>service.activate(bad.id,1),error=>error.status===409);
  });
  for(const fault of ['bot_crash','cpu_timeout','invalid_output']) await withService({managerFactory:()=>fakeManager({fault})},async service=>{
    const bad=await submit(service); service.start(); await service.idle();
    const detail=service.detail(bad.id,1); assert.equal(detail.status,'Rejected'); assert.equal(detail.reason_code,fault); assert.equal(detail.tests.length,1); assert.equal(detail.active,false);
  });
});
test('infrastructure errors retry without rejecting the bot, then allow a manual retry', async () => withService({managerFactory:()=>fakeManager({check:async()=>{throw new InfrastructureError('docker_stopped');}})},async service=>{
  const row=await submit(service); service.start(); await service.idle();
  let detail=service.detail(row.id,1); assert.equal(detail.status,'Queued'); assert.equal(detail.job_status,'blocked'); assert.equal(detail.attempts,3); assert.equal(detail.error_type,'system');
  service.managerFactory=()=>fakeManager(); assert.ok(service.retry(row.id,1)); await service.idle();
  detail=service.detail(row.id,1); assert.equal(detail.status,'Accepted'); assert.equal(detail.version,1);
}));
test('expired leases are recovered after restart, and upload queue limits are enforced', async () => withService({},async(service,db)=>{
  const first=await submit(service); await submit(service,'two.py'); await submit(service,'three.py');
  await assert.rejects(submit(service,'four.py'),error=>error.status===429);
  db.prepare("UPDATE bot_submissions SET job_status='running',worker_id='old-worker',lease_until=0,attempts=1 WHERE id=?").run(first.id);
  service.start(); await service.idle();
  assert.equal(service.detail(first.id,1).status,'Accepted'); assert.equal(service.detail(first.id,1).attempts,2);
  assert.ok(service.detail(first.id,1).events.some(event=>event.message.includes('ngừng phản hồi')));
}));
