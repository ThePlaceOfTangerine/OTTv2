const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { RuleSetService } = require('../src/rule-sets');
const { TournamentService } = require('../src/tournaments');
const { DEFAULT_RULES } = require('../src/game/engine');

function setup(filename = ':memory:') {
  const db = openDatabase(filename);
  for (const [id, username, role, locked] of [[1, 'admin', 'admin', 0], [2, 'team-a', 'contestant', 0], [3, 'team-b', 'contestant', 0], [4, 'locked', 'contestant', 1], [5, 'deleted', 'contestant', 0]]) {
    db.prepare('INSERT OR IGNORE INTO users(id,username,password_hash,role,locked,created_at) VALUES (?,?,?, ?,?,0)').run(id, username, 'not-a-real-password-hash', role, locked);
  }
  db.prepare('UPDATE users SET deleted_at=1 WHERE id=5').run();
  const ruleSets = new RuleSetService(db);
  let clock = 1000;
  const service = new TournamentService(db, { ruleSets, now: () => ++clock });
  return { db, ruleSets, service };
}
const status = code => error => error.status === code;

test('new tournaments use configurable 150-team Swiss defaults and pin their rule version', () => {
  const { db, service, ruleSets } = setup();
  try {
    const tournament = service.create(1, { name: ' Giải LAN ' });
    assert.equal(tournament.name, 'Giải LAN'); assert.equal(tournament.status, 'draft');
    assert.equal(tournament.config.format, 'swiss'); assert.equal(tournament.config.maxTeams, 150);
    assert.equal(tournament.config.swissRounds, 8); assert.equal(tournament.config.extraPairs, 3);
    assert.equal(tournament.revision, 1); assert.equal(tournament.events[0].actorId, 1);
    const rule = ruleSets.save({ name: 'Luật mới', rules: DEFAULT_RULES, userId: 1 });
    const selected = service.update(tournament.id, 1, { expectedRevision: 1, ruleSetId: rule.id, ruleSetVersion: 1 });
    ruleSets.save({ id: rule.id, expectedVersion: 1, name: 'Luật sửa', rules: { ...rule.rules, maxMoves: 12 }, userId: 1 });
    assert.equal(service.get(tournament.id).ruleSetVersion, 1);
    assert.equal(selected.events.at(-1).kind, 'updated');
    assert.equal(service.list().tournaments[0].entrantCount, 0);
    const small = service.create(1, { name: 'Thử 16 đội', config: { maxTeams: 16, swissRounds: 4 } });
    assert.equal(small.config.swissRounds, 4);
    assert.equal(service.get('missing'), null);
  } finally { db.close(); }
});

test('tournament validation rejects invalid formats, schedules and unsupported fields without partial writes', () => {
  const { db, service } = setup();
  try {
    for (const input of [null, [], {}, { name: '  ' }, { name: 'x'.repeat(121) },
      { name: 'x', status: 'running' }, { name: 'x', expectedRevision: 1 },
      { name: 'x', config: null }, { name: 'x', config: { format: 'elo' } },
      { name: 'x', config: { maxTeams: 1 } }, { name: 'x', config: { maxTeams: 4001 } },
      { name: 'x', config: { swissRounds: 1.5 } }, { name: 'x', config: { swissRounds: 150 } },
      { name: 'x', config: { gamesPerPair: 3 } }, { name: 'x', config: { bestOf: 4 } },
      { name: 'x', config: { extraPairs: 0 } }, { name: 'x', config: { topN: 151 } },
      { name: 'x', config: { unsafe: true } }, { name: 'x', opensAt: 'tomorrow' },
      { name: 'x', opensAt: 100, closesAt: 100 }, { name: 'x', closesAt: -1 },
      { name: 'x', ruleSetId: 'missing', ruleSetVersion: 1 }]) {
      assert.throws(() => service.create(1, input), status(400), JSON.stringify(input));
    }
    assert.throws(() => service.create(2, { name: 'x' }), status(400));
    assert.equal(service.list().total, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tournament_events').get().n, 0);
    const valid = service.create(1, { name: 'valid', opensAt: 0, closesAt: 100 });
    assert.equal(valid.opensAt, 0);
    assert.equal(service.update(valid.id, 1, { expectedRevision: 1, opensAt: null }).opensAt, null);
  } finally { db.close(); }
});

test('entrant replacement is atomic, isolated per tournament and rejects ineligible users', () => {
  const { db, service } = setup();
  try {
    const a = service.create(1, { name: 'A' }), b = service.create(1, { name: 'B' });
    const enrolled = service.replaceEntrants(a.id, 1, { expectedRevision: 1, userIds: [2, 3] });
    const joinedAt = enrolled.entrants[0].joinedAt;
    service.replaceEntrants(b.id, 1, { expectedRevision: 1, userIds: [2] });
    for (const userIds of [[2, 2], [2, 999], [2, 1], [2, 4], [2, 5], ['2']]) {
      assert.throws(() => service.replaceEntrants(a.id, 1, { expectedRevision: 2, userIds }), status(400));
    }
    assert.equal(service.get(a.id).revision, 2);
    assert.equal(service.get(a.id).events.length, 2);
    assert.deepEqual(service.get(a.id).entrants.map(e => e.userId), [2, 3]);
    const retained = service.replaceEntrants(a.id, 1, { expectedRevision: 2, userIds: [2] });
    assert.equal(retained.entrants[0].joinedAt, joinedAt);
    assert.equal(service.get(b.id).entrants.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE id IN (2,3)').get().n, 2);
    assert.equal(service.replaceEntrants(a.id, 1, { expectedRevision: 3, userIds: [] }).entrants.length, 0);
    assert.equal(service.get(b.id).entrants.length, 1);
  } finally { db.close(); }
});

test('capacity changes and stale edits cannot overwrite roster or audit history', () => {
  const { db, service } = setup();
  try {
    db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (6,'team-c','unused','contestant',0)").run();
    const tournament = service.create(1, { name: 'Small', config: { maxTeams: 3, swissRounds: 2, topN: 2 } });
    const body = { expectedRevision: 1, userIds: [2, 3, 6] };
    service.replaceEntrants(tournament.id, 1, body);
    assert.throws(() => service.replaceEntrants(tournament.id, 1, body), status(409));
    assert.throws(() => service.update(tournament.id, 1, { expectedRevision: 2, config: { maxTeams: 2, swissRounds: 1 } }), status(409));
    assert.throws(() => service.update(tournament.id, 1, { name: 'stale' }), status(409));
    assert.throws(() => service.replaceEntrants(tournament.id, 1, { expectedRevision: 2, userIds: [2, 3, 6, 4] }), status(400));
    assert.equal(service.get(tournament.id).revision, 2);
    assert.equal(service.get(tournament.id).config.maxTeams, 3);
    assert.equal(service.get(tournament.id).events.length, 2);
    // A later phase changing status must also freeze draft-only APIs.
    db.prepare("UPDATE tournaments SET status='locked' WHERE id=?").run(tournament.id);
    assert.throws(() => service.update(tournament.id, 1, { expectedRevision: 2, name: 'late' }), status(409));
    assert.throws(() => service.replaceEntrants(tournament.id, 1, { expectedRevision: 2, userIds: [] }), status(409));
  } finally { db.close(); }
});

test('configured larger capacity and paginated tournament lists remain supported', () => {
  const { db, service } = setup();
  try {
    for (let i = 0; i < 51; i++) service.create(1, { name: `Giải ${i}` });
    assert.equal(service.list().total, 51); assert.equal(service.list().tournaments.length, 50);
    assert.equal(service.list(1).tournaments.length, 1);
    for (const page of [-1, 0.5, NaN]) assert.throws(() => service.list(page), status(400));
    const tournament = service.create(1, { name: 'Stress config', config: { maxTeams: 4000 } });
    assert.equal(tournament.config.maxTeams, 4000); // Configuration support is not a performance claim.
  } finally { db.close(); }
});

test('migration from schema 7 preserves old data; tournaments persist after reopening', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-tournament-'));
  const file = path.join(dir, 'test.sqlite');
  let db;
  try {
    db = openDatabase(file);
    db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (10,'historical','unused','contestant',0)").run();
    // Build the previous schema in this dedicated temporary fixture only.
    db.exec(`DROP TABLE swiss_controls; DELETE FROM migrations WHERE version=16; DROP TABLE tournament_final_intakes; DELETE FROM migrations WHERE version=15;
      DROP TABLE tournament_final_rules; DELETE FROM migrations WHERE version=14;
      DROP TABLE bracket_games; DROP TABLE bracket_runs; DELETE FROM migrations WHERE version=13;
      DROP TABLE tournament_brackets; DELETE FROM migrations WHERE version=12;
      DROP TABLE tournament_qualifications; DELETE FROM migrations WHERE version=11;
      DROP TABLE swiss_games; DROP TABLE swiss_pairs; DROP TABLE swiss_rounds; DROP TABLE swiss_sessions; DELETE FROM migrations WHERE version=10;
      DROP TABLE tournament_stage_entrants; DROP INDEX stage_receipt_key; DROP INDEX stage_submission_queue;
      ALTER TABLE bot_submissions DROP COLUMN stage_id; ALTER TABLE bot_submissions DROP COLUMN idempotency_key; ALTER TABLE bot_submissions DROP COLUMN upload_hash;
      DROP TABLE tournament_stages; DELETE FROM migrations WHERE version=9;
      DROP TABLE tournament_events; DROP TABLE tournament_entrants; DROP TABLE tournaments; DELETE FROM migrations WHERE version=8;`);
    db.close(); db = null;
    const fixture = setup(file); db = fixture.db;
    assert.equal(db.prepare('SELECT username FROM users WHERE id=10').get().username, 'historical');
    const tournament = fixture.service.create(1, { name: 'Persisted' });
    fixture.service.replaceEntrants(tournament.id, 1, { expectedRevision: 1, userIds: [2, 3] });
    db.close(); db = openDatabase(file);
    const loaded = new TournamentService(db, { ruleSets: new RuleSetService(db) }).get(tournament.id);
    assert.equal(loaded.revision, 2); assert.equal(loaded.entrants.length, 2); assert.equal(loaded.events.length, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM migrations WHERE version=8').get().n, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db?.close();
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
    fs.rmdirSync(dir);
  }
});

test('cancel before competition keeps history, stops intake and forbids reopening or locking', () => {
  const { db, service } = setup();
  const { TournamentStages } = require('../src/tournament-stages');
  const stages = new TournamentStages(db, { tournaments: service, now: () => 1500 }); service.stages = stages;
  try {
    let t = service.create(1, { name: 'Hủy thử' });
    const b = () => ({ expectedRevision: t.revision, reason: 'Hủy buổi diễn tập' });
    assert.throws(() => service.cancel(t.id, 2, b()), status(400));
    assert.throws(() => service.cancel(t.id, 1, { ...b(), reason: '' }), status(400));
    assert.throws(() => service.cancel(t.id, 1, { ...b(), expectedRevision: -1 }), status(409));
    t = service.cancel(t.id, 1, b()); assert.equal(t.status, 'cancelled');
    assert.throws(() => stages.open(t.id, 1, { expectedRevision: t.revision, closesAt: 2000 }), status(409));
    assert.throws(() => service.cancel(t.id, 1, b()), status(409));
    t = service.create(1, { name: 'Nhận bài rồi hủy' });
    t = service.replaceEntrants(t.id, 1, { expectedRevision: t.revision, userIds: [2,3] });
    t = stages.open(t.id, 1, { expectedRevision: t.revision, closesAt: 2000 });
    const stageId = t.stages[0].id; assert.equal(stages.forUser(stageId, 2).canSubmit, true);
    t = service.cancel(t.id, 1, b()); assert.equal(t.entrants.length, 2);
    assert.equal(stages.forUser(stageId, 2).canSubmit, false); assert.equal(stages.forUser(stageId, 2).cancelled, true);
    assert.throws(() => stages.checkSubmission(stageId, 2), status(409));
    assert.throws(() => stages.lock(t.id, 1, b()), status(409));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind='cancelled'").get().n, 2);
  } finally { db.close(); }
});
