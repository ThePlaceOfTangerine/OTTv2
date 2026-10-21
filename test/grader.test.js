const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { GraderAgent } = require('../src/grader/agent');
const { signature } = require('../src/grader/coordinator');
const { DEFAULT_RULES } = require('../src/game/engine');
const { ENGINE_HASH } = require('../src/grader/version');

const bot = Buffer.from('import json\nimport sys\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({"request_id":r["request_id"],"move":r["legal_moves"][0]}))\n');
// Stands in for Docker: "compiles" by returning the staged source and always plays the first legal move.
const fakeManager = () => ({ async check() { return { image: 'fake-image' }; }, async prepare(source) { return { ...source, image: 'fake-image', hash: 'h', compile_cpu_ms: 1 }; },
  async start() { return { async close() {}, async move(request) { return { cpu_ms: 1, stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[0] }) }; } }; },
  async dispose() {} });

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-grader-'));
  const db = openDatabase(':memory:'); let offset = 0; const now = () => Date.now() + offset;
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin','unused','admin',0)").run();
  for (let id = 2; id <= 5; id++) db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'unused','contestant',0)").run(id, `team${id}`);
  const app = await createApp({ db, now, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(root, 'subs'), retryDelayMs: 0 }, swissOptions: { retryDelayMs: 0 }, bracketOptions: { retryDelayMs: 0 } });
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`, { graders, submissions, swiss, tournaments } = app.locals;
  submissions.start({ local: false }); swiss.start({ local: false }); app.locals.bracketRunner.start({ local: false });
  const agents = [], logs = [];
  const agent = (credentials, options = {}) => {
    const created = new GraderAgent({ url, ...credentials, managerFactory: fakeManager, workDir: path.join(root, `agent-${agents.length}`), pollMs: 10, heartbeatMs: 50, log: (...args) => logs.push(args.join(' ')), ...options });
    agents.push(created); return created;
  };
  const until = async (condition, label, ms = 15000) => {
    const end = Date.now() + ms;
    while (!condition()) { if (Date.now() > end) throw new Error(`Timed out: ${label}; logs: ${logs.slice(-5).join(' | ')}`); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  const upload = (userId, buffer = bot, extra = {}) => submissions.submit({ userId, filename: 'main.py', buffer, ...extra });
  try { await run({ db, app, url, graders, submissions, swiss, tournaments, agent, until, upload, logs, advance: ms => { offset += ms; } }); }
  finally {
    await Promise.all(agents.map(a => a.stop()));
    server.closeAllConnections(); server.close(); await submissions.close(); await swiss.close(); await app.locals.bracketRunner.close(); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
const raw = (url, route, body, { id, secret, timestamp = Date.now(), nonce = crypto.randomBytes(16).toString('hex'), sign = secret } = {}) => {
  const payload = Buffer.from(JSON.stringify(body));
  return fetch(url + route, { method: 'POST', body: payload, headers: { 'X-OTT-Grader': id, 'X-OTT-Timestamp': String(timestamp), 'X-OTT-Nonce': nonce,
    'X-OTT-Signature': signature(sign, { method: 'POST', path: route, timestamp, nonce, body: payload }) } });
};

test('grader requests need a valid HMAC, a fresh timestamp, an unused nonce and an active grader', () => fixture(async f => {
  const grader = f.graders.create('Máy 1');
  assert.equal(f.db.prepare('SELECT secret FROM graders WHERE id=?').get(grader.id).secret, grader.secret);
  const mismatch = await raw(f.url, '/api/grader/claim', { engine: 'old-engine' }, grader);
  assert.equal(mismatch.status, 409); assert.match((await mismatch.json()).error, /engine/);
  assert.equal((await raw(f.url, '/api/grader/claim', { engine: ENGINE_HASH }, grader)).status, 204);
  assert.equal((await raw(f.url, '/api/grader/claim', {}, { ...grader, sign: 'wrong-secret' })).status, 401);
  assert.equal((await raw(f.url, '/api/grader/claim', {}, { ...grader, timestamp: Date.now() - 6 * 60000 })).status, 401);
  const nonce = crypto.randomBytes(16).toString('hex');
  assert.equal((await raw(f.url, '/api/grader/claim', { engine: ENGINE_HASH }, { ...grader, nonce })).status, 204);
  const replayed = await raw(f.url, '/api/grader/claim', {}, { ...grader, nonce });
  assert.equal(replayed.status, 401); assert.match((await replayed.json()).error, /nonce/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM grader_nonces').get().n, 3);
  f.graders.revoke(grader.id);
  assert.equal((await raw(f.url, '/api/grader/claim', {}, grader)).status, 401);
}));

test('two agents share the submission queue; each job is checked exactly once and artifacts reach the coordinator', () => fixture(async f => {
  const first = f.agent(f.graders.create('A')), second = f.agent(f.graders.create('B'));
  const ids = [];
  for (const userId of [2, 3, 4, 5]) for (let i = 0; i < 2; i++) ids.push((await f.upload(userId)).id);
  ids.push((await f.upload(2, Buffer.from('import os\nprint(1)\n'))).id);
  await Promise.all([first.start(), second.start()]);
  await f.until(() => !f.db.prepare("SELECT 1 FROM bot_submissions WHERE job_status IN ('queued','running')").get(), 'queue drained');
  const rows = ids.map(id => f.db.prepare('SELECT * FROM bot_submissions WHERE id=?').get(id));
  assert.deepEqual(rows.map(row => row.status), [...Array(8).fill('Accepted'), 'Rejected']);
  assert.ok(rows.every(row => row.attempts === 1));
  assert.equal(rows[8].reason_code, 'static_scan'); assert.equal(rows[8].error_type, 'bot'); assert.equal(rows[8].language, 'python');
  for (const id of ids.slice(0, 8)) {
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submission_tests WHERE submission_id=?').get(id).n, 2);
    assert.deepEqual(await fs.readdir(f.submissions.folder(id, 'artifact')), ['main.py']);
  }
  assert.ok(f.graders.list().every(grader => grader.running === 0 && grader.image === 'fake-image'));
}));

test('a grader that dies mid-job loses its lease; another grader finishes it and the late result is ignored', () => fixture(async f => {
  const dead = f.graders.create('Chết giữa chừng'), live = f.graders.create('Còn sống');
  const submission = await f.upload(2);
  const lease = await (await raw(f.url, '/api/grader/claim', { kinds: ['submission'], engine: ENGINE_HASH }, dead)).json();
  assert.equal(lease.job.id, submission.id);
  assert.equal((await raw(f.url, '/api/grader/heartbeat', { token: lease.token, kind: 'submission', id: submission.id }, live)).status, 403);
  f.advance(31000);
  const survivor = f.agent(live); await survivor.start();
  await f.until(() => f.db.prepare('SELECT status FROM bot_submissions WHERE id=?').get(submission.id).status === 'Accepted', 'reassigned job accepted');
  const late = await (await raw(f.url, '/api/grader/result', { token: lease.token, kind: 'submission', id: submission.id, tests: [], error: { bot: true, code: 'bot_crash', message: 'late' } }, dead)).json();
  assert.deepEqual(late, { applied: false });
  const row = f.db.prepare('SELECT * FROM bot_submissions WHERE id=?').get(submission.id);
  assert.equal(row.status, 'Accepted'); assert.equal(row.attempts, 2); assert.equal(row.error_type, null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submission_tests WHERE submission_id=?').get(submission.id).n, 2);
}));

test('remote graders play a Swiss round; a tampered replay is refused and the game is requeued', () => fixture(async f => {
  const law = f.app.locals.ruleSets.save({ userId: 1, name: 'Nhanh', rules: { ...DEFAULT_RULES, maxMoves: 8 } });
  let tournament = f.tournaments.create(1, { name: 'Phân tán', ruleSetId: law.id, ruleSetVersion: law.version, config: { swissRounds: 1, topN: 2 } });
  tournament = f.tournaments.replaceEntrants(tournament.id, 1, { expectedRevision: tournament.revision, userIds: [2, 3, 4, 5] });
  tournament = f.tournaments.stages.open(tournament.id, 1, { expectedRevision: tournament.revision, closesAt: Date.now() + 60000 });
  const stageId = tournament.stages[0].id;
  const workers = [f.agent(f.graders.create('A')), f.agent(f.graders.create('B'), { slots: 2 })];
  await Promise.all(workers.map(w => w.start()));
  for (const userId of [2, 3, 4, 5]) await f.upload(userId, bot, { stageId });
  await f.until(() => f.db.prepare("SELECT COUNT(*) n FROM bot_submissions WHERE stage_id=? AND status='Accepted'").get(stageId).n === 4, 'stage bots accepted');
  await Promise.all(workers.map(w => w.stop()));
  f.advance(61000);
  tournament = f.tournaments.stages.lock(tournament.id, 1, { expectedRevision: f.tournaments.get(tournament.id).revision, reason: 'hết hạn' });
  f.swiss.create(tournament.id, 1, { expectedRevision: tournament.revision, seed: 'distributed' });
  const cheat = f.graders.create('Gian lận');
  const lease = await (await raw(f.url, '/api/grader/claim', { kinds: ['swiss'], engine: ENGINE_HASH }, cheat)).json();
  const forged = { seed: 'other-seed', rules: lease.job.rules, bots: [], turns: [] };
  const refused = await (await raw(f.url, '/api/grader/result', { token: lease.token, kind: 'swiss', id: lease.job.id, replay: forged }, cheat)).json();
  assert.equal(refused.applied, false); assert.match(refused.rejected, /seed/);
  assert.equal(f.db.prepare('SELECT status FROM swiss_games WHERE id=?').get(lease.job.id).status, 'queued');
  await Promise.all(workers.map(w => w.start()));
  await f.until(() => !f.db.prepare("SELECT 1 FROM swiss_games WHERE status<>'finished'").get(), 'swiss games finished');
  const games = f.db.prepare('SELECT * FROM swiss_games').all();
  assert.equal(games.length, 4);
  for (const game of games) {
    const replay = JSON.parse(game.replay_json);
    assert.equal(replay.seed, game.seed); assert.ok(replay.bots.every(b => b.submission_id));
  }
  assert.equal(f.swiss.get(tournament.id).rounds[0].status, 'finished');
}));
