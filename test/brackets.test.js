const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { TournamentService } = require('../src/tournaments');
const { RuleSetService } = require('../src/rule-sets');
const { planBracket, BracketService } = require('../src/brackets');
const teams = n => Array.from({ length: n }, (_, i) => ({ userId: i + 2, seed: i + 1, username: `team${i + 1}`, version: 1 }));
const status = code => error => error.status === code;

test('seeded knockout plans 3/5/8/16/150 teams with high-seed byes and fixed complete paths', () => {
  for (const n of [2, 3, 5, 8, 16, 150, 256]) {
    const plan = planBracket(teams(n)), first = plan.rounds[0].matches;
    assert.equal(plan.rounds.length, Math.log2(plan.size));
    assert.equal(plan.rounds.reduce((sum, r) => sum + r.matches.length, 0), plan.size - 1);
    assert.deepEqual(first.flatMap(m => m.slots.filter(Boolean)).map(t => t.seed).sort((a, b) => a - b), teams(n).map(t => t.seed));
    const byes = first.filter(m => m.status === 'bye');
    assert.equal(byes.length, plan.size - n);
    assert.deepEqual(byes.map(m => m.winner.seed).sort((a, b) => a - b), Array.from({ length: plan.size - n }, (_, i) => i + 1));
    assert.ok(first.every(m => m.slots.some(Boolean)));
    // Simulate higher seeds winning to prove every real team has one path and seeds 1/2 meet only in the final.
    const winners = new Map();
    for (const round of plan.rounds) for (const match of round.matches) {
      const slots = match.sources ? match.sources.map(source => winners.get(source)) : match.slots.filter(Boolean);
      assert.ok(slots.every(Boolean));
      const winner = slots.reduce((a, b) => a.seed < b.seed ? a : b);
      if (round.number === plan.rounds.length) assert.deepEqual(slots.map(t => t.seed).sort((a, b) => a - b), [1, 2]);
      winners.set(match.id, winner);
    }
    assert.equal(winners.get(plan.rounds.at(-1).matches[0].id).seed, 1);
    assert.deepEqual(planBracket(teams(n)), plan);
  }
});

test('bracket rejects missing, duplicated, invalid and non-contiguous seeds', () => {
  for (const input of [null, [], teams(1), teams(257), [null, teams(2)[1]], [{ ...teams(2)[0], seed: 2 }, teams(2)[1]], [teams(2)[0], { ...teams(2)[1], userId: 2 }]]) {
    assert.throws(() => planBracket(input), status(400));
  }
});

test('bracket creation is atomic, audited, immutable and survives schema reopen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-bracket-')), file = path.join(root, 'arena.sqlite');
  let db = openDatabase(file);
  try {
    for (let id = 1; id <= 6; id++) db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'unused',?,0)").run(id, `user${id}`, id === 1 ? 'admin' : 'contestant');
    const tournaments = new TournamentService(db, { ruleSets: new RuleSetService(db) });
    const tournament = tournaments.create(1, { name: 'Knockout fixture' });
    const service = new BracketService(db, { tournaments, now: () => 12345 });
    const body = { expectedRevision: tournament.revision, reason: 'Verified seeds' };
    assert.equal(service.get(tournament.id), null);
    assert.equal(service.create('missing', 1, body), null);
    assert.throws(() => service.create(tournament.id, 2, body), status(400));
    assert.throws(() => service.create(tournament.id, 1, body), status(409));
    db.prepare("UPDATE tournaments SET status='provisional' WHERE id=?").run(tournament.id);
    assert.throws(() => service.create(tournament.id, 1, body), status(409));
    db.prepare("INSERT INTO tournament_stages VALUES ('stage',?,'qualifier','locked',0,1,1,'{}','{}')").run(tournament.id);
    const approved = { rules: tournaments.ruleSets.get(tournament.ruleSetId, tournament.ruleSetVersion).rules, teams: teams(5).map(e => ({ ...e, rank: e.seed, bot: { secret: 'not exposed' } })) };
    db.prepare("INSERT INTO tournament_qualifications VALUES (?,'stage',1,1,5,1,'checked',?)").run(tournament.id, JSON.stringify(approved));
    assert.throws(() => service.create(tournament.id, 1, { ...body, expectedRevision: -1 }), status(409));
    assert.throws(() => service.create(tournament.id, 1, { ...body, reason: '' }), status(400));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tournament_brackets').get().n, 0);
    const plan = service.create(tournament.id, 1, body);
    assert.equal(plan.teamCount, 5); assert.equal(plan.createdAt, 12345);
    assert.equal(plan.rounds[0].matches.filter(m => m.status === 'bye').length, 3);
    assert.equal(JSON.stringify(plan).includes('not exposed'), false);
    assert.equal(tournaments.get(tournament.id).revision, body.expectedRevision + 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind='bracket_created'").get().n, 1);
    assert.throws(() => service.create(tournament.id, 1, { ...body, expectedRevision: body.expectedRevision + 1 }), status(409));
    assert.throws(() => db.exec('DELETE FROM tournament_brackets'), /immutable/);
    assert.throws(() => db.exec("UPDATE tournament_brackets SET reason='changed'"), /immutable/);
    const pinned = service.pinRule(tournament.id, 1, { expectedRevision: tournaments.get(tournament.id).revision,
      ruleSetId: tournament.ruleSetId, ruleSetVersion: tournament.ruleSetVersion, reason: 'Giữ luật' });
    db.close(); db = openDatabase(file);
    const restored = new BracketService(db, { tournaments: new TournamentService(db, { ruleSets: new RuleSetService(db) }) });
    assert.deepEqual(restored.get(tournament.id), plan);
    assert.deepEqual(restored.finalRule(tournament.id), pinned);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
