// Needs a real sandbox: Docker + image (npm run sandbox:build), or SANDBOX_BACKEND=bwrap inside the ott-grader WSL2 distro.
// Coordinator with LOCAL_GRADING off + two real grader agents.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { GraderAgent } = require('../src/grader/agent');
const { DEFAULT_RULES } = require('../src/game/engine');

// The static scan stops plain "import socket"; these hide the call so the runtime sandbox must stop them.
const hidden = call => `import json\nimport sys\nm=__builtins__.__dict__['__imp'+'ort__']\n${call}\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({"request_id":r["request_id"],"move":r["legal_moves"][0]}))\n`;
const attacks = {
  network: hidden("m('soc'+'ket').create_connection(('1.1.1.1', 80), 2)"),
  passwd: hidden("print(getattr(__builtins__, 'op'+'en')('/etc/passwd').read(), file=sys.stderr)"),
  fork: hidden("while True: m('o'+'s').fork()"),
  memory: 'chunks = []\nwhile True:\n    chunks.append(bytearray(1024 * 1024))\n',
  loop: 'while True:\n    pass\n',
};

test('two real graders check bots in the sandbox, block runtime attacks and play a Swiss round with transferred artifacts', { timeout: 900000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-grader-docker-'));
  const db = openDatabase(':memory:'), logs = [];
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin','unused','admin',0)").run();
  for (let id = 2; id <= 8; id++) db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'unused','contestant',0)").run(id, `team${id}`);
  const app = await createApp({ db, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(root, 'subs') } });
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { graders, submissions, swiss, tournaments, ruleSets } = app.locals;
  submissions.start({ local: false }); swiss.start({ local: false });
  const agents = ['Máy A', 'Máy B'].map((name, i) => new GraderAgent({ url: `http://127.0.0.1:${server.address().port}`, ...graders.create(name), workDir: path.join(root, `agent-${i}`), pollMs: 200, log: (...args) => logs.push(args.join(' ')) }));
  const until = async (condition, label) => {
    const end = Date.now() + 600000;
    while (!condition()) { if (Date.now() > end) throw new Error(`Timed out: ${label}; ${logs.slice(-5).join(' | ')}`); await new Promise(resolve => setTimeout(resolve, 250)); }
  };
  try {
    await Promise.all(agents.map(agent => agent.start()));
    const law = ruleSets.save({ userId: 1, name: 'Nhanh', rules: { ...DEFAULT_RULES, maxMoves: 8 } });
    let tournament = tournaments.create(1, { name: 'Docker phân tán', ruleSetId: law.id, ruleSetVersion: law.version, config: { swissRounds: 1, topN: 2 } });
    tournament = tournaments.replaceEntrants(tournament.id, 1, { expectedRevision: tournament.revision, userIds: [2, 3] });
    tournament = tournaments.stages.open(tournament.id, 1, { expectedRevision: tournament.revision, closesAt: Date.now() + 5000 });
    const stageId = tournament.stages[0].id;
    const read = file => fs.readFile(path.join(__dirname, '..', file));
    const good = [await submissions.submit({ userId: 2, stageId, filename: 'main.py', buffer: await read('bots/python-greedy/main.py') }),
      await submissions.submit({ userId: 3, stageId, filename: 'main.cpp', buffer: await read('bots/cpp-greedy/main.cpp') })];
    const bad = {};
    for (const [i, [name, source]] of Object.entries(attacks).entries()) bad[name] = await submissions.submit({ userId: 4 + i, filename: 'main.py', buffer: Buffer.from(source) });
    await until(() => !db.prepare("SELECT 1 FROM bot_submissions WHERE job_status IN ('queued','running')").get(), 'all checks finished');
    for (const submission of good) assert.equal(db.prepare('SELECT status FROM bot_submissions WHERE id=?').get(submission.id).status, 'Accepted', submission.id);
    for (const [name, submission] of Object.entries(bad)) {
      const row = db.prepare('SELECT status,error_type,reason_code,reason FROM bot_submissions WHERE id=?').get(submission.id);
      console.log(name, row.status, row.reason_code);
      assert.equal(row.status, 'Rejected', name); assert.equal(row.error_type, 'bot', name); assert.notEqual(row.reason_code, 'static_scan', name);
      assert.doesNotMatch(row.reason || '', /root:x:0/, name);
    }
    await until(() => Date.now() > tournament.stages[0].closesAt, 'deadline passed');
    tournament = tournaments.stages.lock(tournament.id, 1, { expectedRevision: tournaments.get(tournament.id).revision, reason: 'integration' });
    swiss.create(tournament.id, 1, { expectedRevision: tournament.revision, seed: 'docker-distributed' });
    await until(() => !db.prepare("SELECT 1 FROM swiss_games WHERE status<>'finished'").get(), 'swiss games finished');
    const games = db.prepare('SELECT replay_json FROM swiss_games').all().map(row => JSON.parse(row.replay_json));
    assert.equal(games.length, 2);
    for (const replay of games) { assert.ok(!replay.fault, JSON.stringify(replay.fault)); assert.ok(replay.turns.length > 0); }
    const cached = await Promise.all(agents.map(agent => fs.readdir(path.join(agent.workDir, 'artifacts')).catch(() => [])));
    assert.ok(cached.flat().filter(name => name.endsWith('.ok')).length >= 2);
  } finally {
    await Promise.all(agents.map(agent => agent.stop()));
    server.closeAllConnections(); server.close(); await submissions.close(); await swiss.close(); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
