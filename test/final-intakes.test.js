const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase } = require('../src/db');
const { RuleSetService } = require('../src/rule-sets');
const { TournamentService } = require('../src/tournaments');
const { TournamentStages } = require('../src/tournament-stages');
const { SubmissionService } = require('../src/submissions/service');
const { FinalIntakes } = require('../src/final-intakes');
const { BracketService } = require('../src/brackets');
const { BracketRunner } = require('../src/bracket-runner');
const { DEFAULT_RULES } = require('../src/game/engine');
const status = n => e => e.status === n;
const code = Buffer.from('import json\nimport sys\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({"request_id":r["request_id"],"move":r["legal_moves"][0]}))\n');
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-final-intake-')), file = path.join(root, 'test.sqlite');
  const db = openDatabase(file); let time = 1000;
  for (let id = 1; id <= 5; id++) db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'unused',?,0)").run(id, `team${id}`, id === 1 ? 'admin' : 'contestant');
  const now = () => time, ruleSets = new RuleSetService(db), tournaments = new TournamentService(db, { ruleSets, now });
  const stages = new TournamentStages(db, { tournaments, now }); tournaments.stages = stages;
  const old = ruleSets.save({ userId: 1, name: 'Luật vòng loại', rules: { ...DEFAULT_RULES, maxMoves: 8 } });
  const official = ruleSets.save({ userId: 1, name: 'Luật chính thức', rules: { ...DEFAULT_RULES, maxMoves: 16 } });
  let t = tournaments.create(1, { name: 'Nộp lại', ruleSetId: old.id, ruleSetVersion: old.version });
  t = tournaments.replaceEntrants(t.id, 1, { expectedRevision: t.revision, userIds: [2, 3, 4, 5] });
  t = stages.open(t.id, 1, { expectedRevision: t.revision, closesAt: 2000 });
  const qualifier = t.stages[0].id;
  for (const id of [2, 3, 4, 5]) db.prepare("INSERT INTO bot_submissions(id,user_id,version,filename,entry,language,status,job_status,created_at,updated_at,stage_id,source_hash,image) VALUES (?,?,1,'main.py','main.py','python','Accepted','done',1000,1000,?,'hash','image')").run(crypto.randomUUID(), id, qualifier);
  time = 2000; t = stages.lock(t.id, 1, { expectedRevision: t.revision, reason: 'fixture' });
  db.prepare("UPDATE tournaments SET status='provisional' WHERE id=?").run(t.id);
  const source = { rules: old.rules, config: t.config, seed: 'fixed', teams: t.stages[0].entrants.slice(0, 2).map((e, i) => ({ userId: e.userId, username: e.username, rank: i + 1, version: 1, bot: e.snapshot })) };
  db.prepare('INSERT INTO tournament_qualifications VALUES (?,?,?,?,?,?,?,?)').run(t.id, qualifier, 1, time, 2, 1, 'fixture', JSON.stringify(source));
  const brackets = new BracketService(db, { tournaments, now });
  brackets.pinRule(t.id, 1, { expectedRevision: tournaments.get(t.id).revision, ruleSetId: official.id, ruleSetVersion: official.version, reason: 'Thông báo luật mới' });
  const final = new FinalIntakes(db, { tournaments, stages, now });
  const submissions = new SubmissionService(db, { storageRoot: path.join(root, 'submissions'), stages, now, retryDelayMs: 0, managerFactory: () => ({
    async check() {}, async prepare(source) { return { ...source, image: 'fake', hash: 'final-hash', compile_cpu_ms: 1 }; },
    async start() { return { async close() {}, async move(req) { return { cpu_ms: 1, stdout: JSON.stringify({ request_id: req.request_id, move: req.legal_moves[0] }) }; } }; }, async dispose() {},
  }) });
  const f = { db, root, file, tournaments, stages, brackets, final, submissions, id: t.id, qualifier, official,
    clock: n => { time = n; }, body: (extra = {}) => ({ expectedRevision: tournaments.get(t.id).revision, opensAt: 2100, closesAt: 3000,
      announcement: 'Luật mới: giới hạn 16 nước, chỉ đội đi tiếp nộp lại.', fallbackPolicy: 'require_valid_final_submission', ...extra }) };
  try { await run(f); } finally { await submissions.close(); f.db.close(); assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('ott-final-intake-')); await fs.rm(root, { recursive: true, force: true }); }
}
test('official intake exposes pinned rules/announcement only to approved teams and keeps qualifier snapshots intact', () => fixture(async f => {
  const before = f.stages.forUser(f.qualifier, 2).snapshot;
  const intake = f.final.open(f.id, 1, f.body()); const id = intake.stage.id;
  assert.equal(intake.stage.kind, 'final'); assert.equal(intake.stage.rules.maxMoves, 16);
  assert.equal(intake.stage.entrants.length, 2); assert.equal(f.stages.forUser(id, 4), null);
  assert.equal(f.stages.forUser(id, 2).canSubmit, false);
  assert.match(f.stages.forUser(id, 2).announcement, /16/);
  assert.equal(f.stages.listForUser(2).length, 2); assert.equal(f.stages.listForUser(4).length, 1);
  assert.equal(f.tournaments.get(f.id).stages[0].kind, 'qualifier');
  assert.deepEqual(f.stages.forUser(f.qualifier, 2).snapshot, before);
  assert.equal(f.stages.selectedId(id, 2), null);
  assert.throws(() => f.final.open(f.id, 1, f.body()), status(409));
  f.clock(2100); assert.equal(f.stages.forUser(id, 2).canSubmit, true);
  assert.throws(() => f.stages.checkSubmission(id, 4), status(403));
  assert.throws(() => f.stages.select(id, 2, before.submissionId), status(409));
  f.clock(3000); assert.equal(f.stages.forUser(id, 2).canSubmit, false);
  assert.equal(f.final.get(f.id).stage.status, 'closing');
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
}));
test('official submissions finish after deadline under new law; retries and closing never import old bots', () => fixture(async f => {
  const intake = f.final.open(f.id, 1, f.body()), stageId = intake.stage.id;
  f.clock(2100);
  const submit = extra => f.submissions.submit({ userId: 2, stageId, filename: 'main.py', buffer: code, ...extra });
  const first = await submit({ idempotencyKey: 'official-receipt-0001' });
  await submit({ buffer: Buffer.from('import os\n') });
  f.clock(2500); f.final.close(f.id, 1, { expectedRevision: f.tournaments.get(f.id).revision, reason: 'Đã nhận đủ bài thử' });
  await assert.rejects(submit(), status(409));
  assert.equal((await submit({ idempotencyKey: 'official-receipt-0001' })).id, first.id);
  f.clock(4000); f.submissions.start(); await f.submissions.idle();
  assert.equal(f.submissions.detail(first.id, 2).status, 'Accepted');
  assert.equal(f.stages.selectedId(stageId, 2), first.id); assert.equal(f.stages.selectedId(stageId, 3), null);
  assert.equal(f.submissions.list(2, stageId).length, 2); assert.equal(f.submissions.list(2, f.qualifier).length, 1);
  for (const row of f.db.prepare('SELECT replay_json FROM submission_tests WHERE submission_id=?').all(first.id)) {
    const replay = JSON.parse(row.replay_json); assert.equal(replay.rules.maxMoves, 16); assert.equal(replay.rule_set_id, f.official.id);
  }
  assert.equal(f.stages.forUser(f.qualifier, 2).snapshot.rules.maxMoves, 8);
  assert.throws(() => f.final.close(f.id, 1, { expectedRevision: f.tournaments.get(f.id).revision, reason: 'again' }), status(409));
}));
test('intake validation rolls back invalid windows, stale revisions, inactive teams and wrong policy', () => fixture(async f => {
  assert.throws(() => f.final.open(f.id, 2, f.body()), status(400));
  assert.throws(() => f.final.open(f.id, 1, f.body({ expectedRevision: -1 })), status(409));
  assert.throws(() => f.final.open(f.id, 1, f.body({ closesAt: 2000 })), status(400));
  assert.throws(() => f.final.open(f.id, 1, f.body({ announcement: '' })), status(400));
  assert.throws(() => f.final.open(f.id, 1, f.body({ fallbackPolicy: 'use_qualifier' })), status(400));
  f.db.prepare('UPDATE users SET locked=1 WHERE id=2').run();
  assert.throws(() => f.final.open(f.id, 1, f.body()), status(409));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tournament_stages WHERE kind='final'").get().n, 0);
  f.db.prepare('UPDATE users SET locked=0 WHERE id=2').run();
  const intake = f.final.open(f.id, 1, f.body());
  assert.throws(() => f.final.close(f.id, 1, { expectedRevision: f.tournaments.get(f.id).revision, reason: 'too early' }), status(409));
  f.brackets.create(f.id, 1, { expectedRevision: f.tournaments.get(f.id).revision, reason: 'test' });
  const runner = new BracketRunner(f.db, { tournaments: f.tournaments, brackets: f.brackets, submissions: f.submissions });
  for (const mode of ['auto', 'manual']) assert.throws(() => runner.create(f.id, 1, { expectedRevision: f.tournaments.get(f.id).revision, reason: 'cannot skip', rulesPolicy: 'keep_qualifier', mode }), status(409));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bracket_games').get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind='final_intake_opened'").get().n, 1);
  assert.equal(intake.stage.entrants.length, 2);
}));
test('migration from the actual qualifier-only stage constraint preserves locked bots and all references', () => fixture(async f => {
  const original = f.stages.forUser(f.qualifier, 2).snapshot;
  const sql = f.db.prepare("SELECT sql FROM sqlite_master WHERE name='tournament_stages'").get().sql
    .replace(/^CREATE TABLE "?tournament_stages"?/, 'CREATE TABLE stage_schema14').replace("CHECK(kind IN ('qualifier','final'))", "CHECK(kind='qualifier')");
  const triggers = f.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('stage_rules_immutable','locked_stage_entrants_update','locked_stage_entrants_delete','locked_stage_entrants_insert')").all();
  // Reverse only this migration in the disposable fixture to reproduce real schema 14.
  f.db.exec('PRAGMA foreign_keys=OFF; BEGIN;');
  for (const trigger of triggers) f.db.exec(`DROP TRIGGER ${trigger.name}`);
  f.db.exec(`${sql}; INSERT INTO stage_schema14 SELECT * FROM tournament_stages; DROP TABLE tournament_stages; ALTER TABLE stage_schema14 RENAME TO tournament_stages;`);
  for (const trigger of triggers) f.db.exec(trigger.sql);
  f.db.exec('DROP TABLE swiss_controls; DELETE FROM migrations WHERE version=16; DROP TABLE tournament_final_intakes; DELETE FROM migrations WHERE version=15; COMMIT; PRAGMA foreign_keys=ON;');
  assert.match(f.db.prepare("SELECT sql FROM sqlite_master WHERE name='tournament_stages'").get().sql, /kind='qualifier'/);
  f.db.close(); f.db = openDatabase(f.file);
  const tournaments = new TournamentService(f.db, { ruleSets: new RuleSetService(f.db) });
  const stages = new TournamentStages(f.db, { tournaments });
  assert.deepEqual(stages.forUser(f.qualifier, 2).snapshot, original);
  assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => f.db.prepare('UPDATE tournament_stage_entrants SET snapshot_json=? WHERE stage_id=?').run('{}', f.qualifier), /immutable/);
  assert.equal(f.db.prepare('SELECT MAX(version) n FROM migrations').get().n, 16);
}));

test('final lock is atomic, requires every approved team, freezes new bots and runner uses final source', () => fixture(async f => {
  const intake = f.final.open(f.id, 1, f.body()), stageId = intake.stage.id;
  const body = () => ({ expectedRevision: f.tournaments.get(f.id).revision, reason: 'Chốt chính thức' });
  assert.throws(() => f.final.lock(f.id, 1, body()), status(409));
  f.clock(2100);
  const first = await f.submissions.submit({ userId: 2, stageId, filename: 'main.py', buffer: code });
  f.clock(3000);
  assert.throws(() => f.final.lock(f.id, 1, body()), status(409));
  f.submissions.start(); await f.submissions.idle();
  assert.throws(() => f.final.lock(f.id, 1, body()), status(409));
  assert.equal(f.stages.forUser(stageId, 2).snapshot, null);
  f.clock(2200);
  const second = await f.submissions.submit({ userId: 3, stageId, filename: 'main.py', buffer: code });
  await f.submissions.idle(); f.clock(3000);
  assert.throws(() => f.final.lock(f.id, 2, body()), status(400));
  assert.throws(() => f.final.lock(f.id, 1, { ...body(), expectedRevision: -1 }), status(409));
  f.db.prepare('UPDATE users SET locked=1 WHERE id=3').run();
  assert.throws(() => f.final.lock(f.id, 1, body()), status(409));
  assert.equal(f.stages.forUser(stageId, 2).snapshot, null);
  f.db.prepare('UPDATE users SET locked=0 WHERE id=3').run();
  const locked = f.final.lock(f.id, 1, body());
  assert.equal(locked.stage.status, 'locked');
  assert.deepEqual(locked.stage.entrants.map(e => e.snapshot.submissionId).sort(), [first.id,second.id].sort());
  assert.equal(locked.stage.entrants[0].snapshot.rules.maxMoves, 16);
  assert.throws(() => f.final.lock(f.id, 1, body()), status(409));
  assert.throws(() => f.db.prepare('UPDATE tournament_stage_entrants SET snapshot_json=NULL WHERE stage_id=?').run(stageId));
  f.brackets.create(f.id, 1, body());
  const runner = new BracketRunner(f.db, { tournaments: f.tournaments, brackets: f.brackets, submissions: f.submissions });
  assert.throws(() => runner.create(f.id, 1, { ...body(), rulesPolicy: 'keep_qualifier', mode: 'manual' }), status(409));
  f.db.prepare("UPDATE bot_submissions SET entry='changed.py' WHERE stage_id=?").run(stageId);
  const run = runner.create(f.id, 1, { ...body(), rulesPolicy: 'use_final_intake', mode: 'manual' });
  const source = JSON.parse(f.db.prepare('SELECT source_json FROM bracket_runs WHERE tournament_id=?').get(f.id).source_json);
  assert.equal(source.rules.maxMoves, 16); assert.equal(source.finalStageId, stageId);
  assert.ok(source.teams.every(t => t.bot.entry === 'main.py'));
  assert.equal(run.controlMode, 'manual');
  assert.equal(f.stages.forUser(f.qualifier, 2).snapshot.rules.maxMoves, 8);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind='final_bots_locked'").get().n, 1);
  await runner.close();
}));
