const fs = require('node:fs/promises');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { SubmissionService } = require('../src/submissions/service');
const { SandboxManager } = require('../src/sandbox/docker');

async function main() {
  await new SandboxManager().check();
  const db = openDatabase(process.env.DB_PATH || path.resolve(__dirname,'../data/arena.sqlite'));
  const service = new SubmissionService(db);
  try {
    const fixtures = [
      ['python-greedy/main.py','good-python.py'],['cpp-greedy/main.cpp','good-cpp.cpp'],
      ['fixtures/crash/main.py','crash.py'],['fixtures/loop/main.py','loop.py'],
      ['fixtures/network/main.py','network.py'],['fixtures/passwd/main.py','passwd.py'],
      ['fixtures/fork/main.py','fork.py'],['fixtures/memory/main.py','memory.py']
    ];
    service.start();
    for (const [i,[source,filename]] of fixtures.entries()) {
      const username=`contestant${String(i+1).padStart(2,'0')}`;
      const user=db.prepare('SELECT id FROM users WHERE username=?').get(username);
      if (!user) throw new Error('Chạy npm run seed để tạo các tài khoản demo trước.');
      if (db.prepare('SELECT 1 FROM bot_submissions WHERE user_id=? AND filename=?').get(user.id,`seed-${filename}`)) continue;
      await service.submit({userId:user.id,filename:`seed-${filename}`,buffer:await fs.readFile(path.resolve(__dirname,'../bots',source))});
    }
    await service.idle(240000);
    console.table(db.prepare("SELECT u.username,s.version,s.filename,s.status,s.reason_code FROM bot_submissions s JOIN users u ON u.id=s.user_id WHERE s.filename LIKE 'seed-%' ORDER BY u.username,s.version").all());
  } finally { await service.close(); db.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
