const { BracketRunner } = require('../src/bracket-runner');
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
const { SwissService } = require('../src/swiss');
const { BracketService } = require('../src/brackets');
const { FinalIntakes } = require('../src/final-intakes');
const { DEFAULT_RULES } = require('../src/game/engine');
const { verifyReplay } = require('../src/game/match');

test('Docker intake and Swiss use pinned Python/C++ artifacts and persist standings after reopening', { timeout: 180000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-stage-docker-'));
  let db = openDatabase(path.join(root, 'arena.sqlite'));
  for (const [id, role] of [[1, 'admin'], [2, 'contestant'], [3, 'contestant']]) db.prepare('INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,?,?,0)').run(id, `test${id}`, 'unused', role);
  const ruleSets = new RuleSetService(db), tournaments = new TournamentService(db, { ruleSets });
  const stages = new TournamentStages(db, { tournaments }); tournaments.stages = stages;
  const submissions = new SubmissionService(db, { stages, storageRoot: path.join(root, 'submissions'), workers: 1 });
  const swiss = new SwissService(db, { tournaments, submissions });
  try {
    const rule = ruleSets.save({ name: 'Vòng loại thử', rules: { ...DEFAULT_RULES, maxMoves: 8, powerUps: true }, userId: 1 });
    let tournament = tournaments.create(1, { name: 'Docker intake', ruleSetId: rule.id, ruleSetVersion: rule.version, config: { swissRounds: 1, topN: 2 } });
    tournament = tournaments.replaceEntrants(tournament.id, 1, { expectedRevision: tournament.revision, userIds: [2, 3] });
    tournament = stages.open(tournament.id, 1, { expectedRevision: tournament.revision, closesAt: Date.now() + 120000 });
    const stageId = tournament.stages[0].id, receipts = [];
    for (const [userId, language, entry] of [[2, 'python', 'main.py'], [3, 'cpp', 'main.cpp']]) {
      const buffer = await fs.readFile(path.join(__dirname, '../bots/templates', language, entry));
      receipts.push(await submissions.submit({ stageId, userId, filename: entry, buffer, idempotencyKey: `docker-receipt-key-${userId}` }));
    }
    // Close while jobs are queued; they must still finish and remain eligible.
    tournament = stages.close(tournament.id, 1, { expectedRevision: tournament.revision, reason: 'Đóng trước khi xử lý hàng đợi thử' });
    submissions.start(); await submissions.idle(150000);
    for (const receipt of receipts) {
      const userId = receipt.id === receipts[0].id ? 2 : 3;
      const detail = submissions.detail(receipt.id, userId);
      assert.equal(detail.status, 'Accepted', JSON.stringify(detail)); assert.equal(detail.tests.length, 2);
      for (const match of detail.tests) {
        const replay = submissions.test(receipt.id, match.id, userId).replay;
        assert.equal(replay.rules.id, rule.id); assert.equal(replay.rules.maxMoves, 8);
        assert.equal(replay.rules.powerUps, true); assert.ok(verifyReplay(replay));
      }
    }
    const locked = stages.lock(tournament.id, 1, { expectedRevision: tournament.revision, reason: 'Đã kiểm tra bằng Docker' });
    assert.equal(locked.status, 'locked');
    assert.ok(locked.stages[0].entrants.every(e => e.snapshot?.image.startsWith('sha256:') && e.snapshot.sourceHash));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM active_bots').get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    // Prove the runner uses the frozen stage snapshot rather than mutable submission metadata.
    db.prepare("UPDATE bot_submissions SET entry='not-the-locked-entry.py' WHERE stage_id=?").run(stageId);
    swiss.create(tournament.id, 1, { expectedRevision: locked.revision, seed: 'docker-swiss' });
    swiss.start();
    const deadline = Date.now() + 60000;
    while (swiss.get(tournament.id).status !== 'finished') {
      if (Date.now() > deadline) throw new Error(JSON.stringify(swiss.get(tournament.id)));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const finalSwiss = swiss.get(tournament.id);
    assert.equal(finalSwiss.standings.length, 2);
    for (const game of finalSwiss.pairs[0].games) {
      const replay = swiss.match(game.id).replay;
      assert.ok(verifyReplay(replay)); assert.equal(replay.rules.id, rule.id);
      assert.ok(replay.bots.every(bot => receipts.some(receipt => receipt.id === bot.submission_id)));
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM score_rounds').get().n, 0);
    const qualification = swiss.approve(tournament.id, 1, { expectedRevision: tournaments.get(tournament.id).revision,
      swissRevision: finalSwiss.revision, topN: 2, reason: 'Đối chiếu kết quả Docker' }).qualification;
    assert.equal(qualification.teams.length, 2);
    const official = ruleSets.save({ name: 'Luật nộp lại Docker', rules: { ...DEFAULT_RULES, maxMoves: 12 }, userId: 1 });
    const brackets = new BracketService(db, { tournaments });
    brackets.pinRule(tournament.id, 1, { expectedRevision: tournaments.get(tournament.id).revision, ruleSetId: official.id, ruleSetVersion: official.version, reason: 'Đợt nộp lại Docker' });
    const final = new FinalIntakes(db, { tournaments, stages });
    const intake = final.open(tournament.id, 1, { expectedRevision: tournaments.get(tournament.id).revision, opensAt: Date.now() - 1000,
      closesAt: Date.now() + 120000, announcement: 'Nộp lại theo luật 12 nước', fallbackPolicy: 'require_valid_final_submission' });
    const finals = [];
    for (const [userId, language, entry] of [[2, 'python', 'main.py'], [3, 'cpp', 'main.cpp']]) {
      finals.push(await submissions.submit({ stageId: intake.stage.id, userId, filename: entry, buffer: await fs.readFile(path.join(__dirname, '../bots/templates', language, entry)) }));
    }
    final.close(tournament.id, 1, { expectedRevision: tournaments.get(tournament.id).revision, reason: 'Đóng khi còn kiểm tra' });
    await submissions.idle(150000);
    for (const receipt of finals) {
      assert.equal(db.prepare('SELECT status FROM bot_submissions WHERE id=?').get(receipt.id).status, 'Accepted');
      for (const row of db.prepare('SELECT replay_json FROM submission_tests WHERE submission_id=?').all(receipt.id)) {
        const replay = JSON.parse(row.replay_json); assert.ok(verifyReplay(replay)); assert.equal(replay.rules.id, official.id); assert.equal(replay.rules.maxMoves, 12);
      }
    }
    const lockedFinal = final.lock(tournament.id, 1, { expectedRevision: tournaments.get(tournament.id).revision, reason: 'Chốt Docker thật' });
    assert.equal(lockedFinal.stage.status, 'locked');
    brackets.create(tournament.id, 1, { expectedRevision: tournaments.get(tournament.id).revision, reason: 'Sơ đồ chính thức' });
    const runner = new BracketRunner(db, { tournaments, brackets, submissions });
    try {
      runner.create(tournament.id, 1, { expectedRevision: tournaments.get(tournament.id).revision, reason: 'Chạy luật mới', rulesPolicy: 'use_final_intake' });
      runner.start(); const end = Date.now() + 120000;
      while (runner.view(tournament.id).status !== 'finished') {
        if (Date.now() > end) throw Error('Final runner timeout');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      for (const game of db.prepare('SELECT replay_json FROM bracket_games WHERE tournament_id=?').all(tournament.id)) {
        const replay = JSON.parse(game.replay_json); assert.ok(verifyReplay(replay)); assert.equal(replay.rules.maxMoves, 12);
        assert.ok(replay.bots.every(bot => finals.some(receipt => receipt.id === bot.submission_id)));
      }
    } finally { await runner.close(); }
    assert.deepEqual(swiss.get(tournament.id).standings, finalSwiss.standings);
    await swiss.close(); await submissions.close(); db.close();
    db = openDatabase(path.join(root, 'arena.sqlite'));
    const restoredTournaments = new TournamentService(db, { ruleSets: new RuleSetService(db) });
    const restored = new TournamentStages(db, { tournaments: restoredTournaments });
    assert.deepEqual(restored.forUser(stageId, 2).snapshot, locked.stages[0].entrants.find(e => e.userId === 2).snapshot);
    const reopenedSwiss = new SwissService(db, { tournaments: restoredTournaments, submissions });
    assert.deepEqual(reopenedSwiss.get(tournament.id).standings, finalSwiss.standings);
    assert.deepEqual(reopenedSwiss.qualification(tournament.id), qualification);
    const restoredFinal = new FinalIntakes(db, { tournaments: restoredTournaments, stages: restored });
    assert.equal(restoredFinal.get(tournament.id).stage.kind, 'final');
    assert.equal(restoredFinal.get(tournament.id).stage.rules.maxMoves, 12);
    assert.equal(restoredFinal.get(tournament.id).stage.counts.find(c => c.status === 'Accepted').count, 2);
  } finally {
    await swiss.close(); await submissions.close(); db.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('ott-stage-docker-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
