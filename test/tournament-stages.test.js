const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { RuleSetService } = require('../src/rule-sets');
const { TournamentService } = require('../src/tournaments');
const { TournamentStages } = require('../src/tournament-stages');
const { SubmissionService } = require('../src/submissions/service');
const { DEFAULT_RULES } = require('../src/game/engine');
const { InfrastructureError } = require('../src/game/protocol');

const code = Buffer.from('import json\nimport sys\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({"request_id":r["request_id"],"move":r["legal_moves"][0]}))\n');
const status = n => error => error.status === n;
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-stage-'));
  const db = openDatabase(':memory:'); let time = 1000, infrastructureFailure = false;
  for (const [id, role] of [[1, 'admin'], [2, 'contestant'], [3, 'contestant'], [4, 'contestant']]) db.prepare('INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,?,?,0)').run(id, `user${id}`, 'unused', role);
  const ruleSets = new RuleSetService(db), now = () => time;
  const tournaments = new TournamentService(db, { ruleSets, now });
  const stages = new TournamentStages(db, { tournaments, now }); tournaments.stages = stages;
  const law = ruleSets.save({ userId: 1, name: 'Luật nhanh', rules: { ...DEFAULT_RULES, maxMoves: 8, powerUps: true } });
  const seenRules = [];
  const submissions = new SubmissionService(db, { storageRoot: root, stages, now, retryDelayMs: 0, managerFactory: () => ({
    async check() { if (infrastructureFailure) throw new InfrastructureError('test_infrastructure'); },
    async prepare(source) { return { ...source, image: 'fake-image', hash: 'test-hash', compile_cpu_ms: 1 }; },
    async start() { return { async close() {}, async move(request) { seenRules.push(request.rules); return { cpu_ms: 1, stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[0] }) }; } }; },
    async dispose() {},
  }) });
  const make = (options = {}) => {
    let tournament = tournaments.create(1, { name: 'Stage test', ruleSetId: law.id, ruleSetVersion: law.version, ...options });
    tournament = tournaments.replaceEntrants(tournament.id, 1, { expectedRevision: tournament.revision, userIds: [2, 3] });
    return stages.open(tournament.id, 1, { expectedRevision: tournament.revision, closesAt: 2000 });
  };
  const submit = (stageId, userId = 2, extra = {}) => submissions.submit({ stageId, userId, filename: 'main.py', buffer: code, ...extra });
  try { await run({ db, tournaments, stages, submissions, law, seenRules, make, submit, clock: value => { time = value; }, failInfra: value => { infrastructureFailure = value; } }); }
  finally {
    await submissions.close(); db.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('ott-stage-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('stage opens only eligible roster, pins rules and keeps tournament submissions out of legacy lists', () => fixture(async f => {
  const opened = f.make(), stage = opened.stages[0];
  assert.equal(opened.status, 'submissions_open'); assert.equal(stage.rules.id, f.law.id);
  assert.equal(f.stages.listForUser(4).length, 0); assert.equal(f.stages.forUser(stage.id, 4), null);
  await assert.rejects(f.submit(stage.id, 4), status(403));
  assert.throws(() => f.tournaments.replaceEntrants(opened.id, 1, { expectedRevision: opened.revision, userIds: [] }), status(409));
  const bot = await f.submit(stage.id);
  assert.equal(bot.stage_id, stage.id); assert.equal(bot.received_at, 1000);
  assert.equal(f.submissions.list(2).length, 0); assert.equal(f.submissions.list(2, stage.id).length, 1);
  const second = f.make(); assert.equal(f.submissions.list(2, second.stages[0].id).length, 0);
  assert.throws(() => f.db.prepare('UPDATE tournament_stages SET rules_json=? WHERE id=?').run('{}', stage.id), /immutable/);
}));

test('deadline is enforced after file persistence; retries return same receipt even after closing', () => fixture(async f => {
  const opened = f.make(), id = opened.stages[0].id;
  f.clock(1999);
  const first = await f.submit(id, 2, { idempotencyKey: 'receipt-key-000001' });
  f.clock(2000);
  assert.equal(f.stages.forUser(id, 2).canSubmit, false);
  assert.equal(f.tournaments.get(opened.id).status, 'closing');
  await assert.rejects(f.submit(id, 3), status(409));
  const retry = await f.submit(id, 2, { idempotencyKey: 'receipt-key-000001' });
  assert.equal(retry.id, first.id);
  await assert.rejects(f.submit(id, 2, { idempotencyKey: 'receipt-key-000001', buffer: Buffer.from('different') }), status(409));
  assert.equal(f.submissions.list(2, id).length, 1);
  // Force the deadline to pass between the early gate and the gate after asynchronous file writes.
  f.clock(1500);
  const original = f.stages.checkSubmission.bind(f.stages); let gates = 0;
  f.stages.checkSubmission = (...args) => { const value = original(...args); if (++gates === 1) f.clock(2000); return value; };
  await assert.rejects(f.submit(id, 3), status(409));
  assert.equal(f.submissions.list(3, id).length, 0);
  assert.equal((await fs.readdir(f.submissions.root)).length, 1);
}));

test('correct-law pipeline finishes after deadline, falls back to accepted bot and locks immutable snapshots', () => fixture(async f => {
  const opened = f.make(), id = opened.stages[0].id;
  const first = await f.submit(id), second = await f.submit(id, 3);
  const rejected = await f.submit(id, 2, { buffer: Buffer.from('import os\n') });
  // Already-received submissions remain eligible when their tests finish after the deadline.
  f.clock(2100); f.submissions.start(); await f.submissions.idle();
  assert.equal(f.submissions.detail(first.id, 2).status, 'Accepted');
  assert.ok(f.seenRules.length); assert.ok(f.seenRules.every(rule => rule.id === f.law.id && rule.maxMoves === 8));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM active_bots').get().n, 0);
  assert.equal(f.submissions.detail(rejected.id, 2).status, 'Rejected');
  f.clock(2200);
  const locked = f.stages.lock(opened.id, 1, { expectedRevision: opened.revision, reason: 'Đã xử lý hết bài' });
  assert.equal(locked.status, 'locked');
  assert.deepEqual(locked.stages[0].entrants.map(e => e.submissionId), [first.id, second.id]);
  assert.equal(locked.stages[0].entrants[0].snapshot.rules.id, f.law.id);
  assert.throws(() => f.submissions.activate(first.id, 2), status(409));
  f.db.prepare('UPDATE users SET locked=1 WHERE id=2').run();
  assert.equal(f.stages.forUser(id, 2).snapshot.submissionId, first.id);
  assert.throws(() => f.db.prepare('UPDATE tournament_stage_entrants SET locked_submission_id=NULL WHERE stage_id=?').run(id), /immutable/);
}));

test('blocked infrastructure prevents locking; retry remains possible after deadline', () => fixture(async f => {
  const opened = f.make(), id = opened.stages[0].id;
  const first = await f.submit(id), second = await f.submit(id, 3);
  f.failInfra(true); f.submissions.start(); await f.submissions.idle();
  assert.equal(f.submissions.detail(first.id, 2).job_status, 'blocked');
  f.clock(2100);
  assert.throws(() => f.stages.lock(opened.id, 1, { expectedRevision: opened.revision, reason: 'Thử chốt' }), status(409));
  assert.equal(f.stages.row(id).status, 'open');
  f.failInfra(false); f.submissions.retry(first.id, 2); f.submissions.retry(second.id, 3); await f.submissions.idle();
  assert.equal(f.stages.lock(opened.id, 1, { expectedRevision: opened.revision, reason: 'Đã phục hồi' }).status, 'locked');
}));

test('manual choice is stage-local and survives newer accepted submissions; close/lock checks revisions and readiness', () => fixture(async f => {
  const opened = f.make(), id = opened.stages[0].id, other = f.make().stages[0].id;
  assert.throws(() => f.stages.lock(opened.id, 1, { expectedRevision: opened.revision, reason: 'Sớm' }), status(409));
  const first = await f.submit(id), second = await f.submit(id, 3), foreign = await f.submit(other);
  f.submissions.start(); await f.submissions.idle();
  f.submissions.activate(first.id, 2);
  const newer = await f.submit(id); await f.submissions.idle();
  assert.equal(f.stages.selectedId(id, 2), first.id); assert.notEqual(newer.id, first.id);
  assert.throws(() => f.stages.select(id, 2, foreign.id), status(409));
  f.clock(1200);
  assert.throws(() => f.stages.close(opened.id, 1, { expectedRevision: 1, reason: 'Cũ' }), status(409));
  const closed = f.stages.close(opened.id, 1, { expectedRevision: opened.revision, reason: 'Kết thúc nhận bài' });
  assert.equal(closed.status, 'closing'); assert.equal(closed.stages[0].closesAt, 1200);
  await assert.rejects(f.submit(id), status(409));
  const locked = f.stages.lock(opened.id, 1, { expectedRevision: closed.revision, reason: 'Chốt đội' });
  assert.equal(locked.stages[0].entrants.find(e => e.userId === 3).submissionId, second.id);
}));

test('scheduled windows reject early submissions and concurrent retry requests produce one receipt', () => fixture(async f => {
  const opened = f.make({ opensAt: 1500 }), id = opened.stages[0].id;
  await assert.rejects(f.submit(id), status(409));
  assert.throws(() => f.stages.close(opened.id, 1, { expectedRevision: opened.revision, reason: 'Chưa đến lịch' }), status(409));
  f.clock(1500);
  const [first, second] = await Promise.all([f.submit(id, 2, { idempotencyKey: 'concurrent-request-01' }), f.submit(id, 2, { idempotencyKey: 'concurrent-request-01' })]);
  assert.equal(first.id, second.id); assert.equal(f.submissions.list(2, id).length, 1);
  assert.equal((await fs.readdir(f.submissions.root)).length, 1);
  f.clock(2000);
  // Deadline status remains correct when services are reconstructed without a browser or timer.
  const restored = new TournamentStages(f.db, { tournaments: f.tournaments, now: () => 2000 });
  assert.equal(restored.forUser(id, 2).status, 'closing');
  assert.equal(restored.forUser(id, 2).canSubmit, false);
}));

test('locking with too few accepted bots rolls back all partial snapshots', () => fixture(async f => {
  const opened = f.make(), id = opened.stages[0].id;
  await f.submit(id, 2, { buffer: Buffer.from('import os\n') });
  f.submissions.start(); await f.submissions.idle(); f.clock(2100);
  assert.throws(() => f.stages.lock(opened.id, 1, { expectedRevision: opened.revision, reason: 'Không đủ bot' }), status(409));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tournament_stage_entrants WHERE snapshot_json IS NOT NULL OR exclusion_reason IS NOT NULL').get().n, 0);
  assert.equal(f.tournaments.get(opened.id).revision, opened.revision);
}));
