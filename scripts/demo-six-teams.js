// Explicit end-to-end demo. Uses isolated new demo accounts/tournament in the selected database.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createUser } = require('../src/users');
const { RuleSetService } = require('../src/rule-sets');
const { TournamentService } = require('../src/tournaments');
const { TournamentStages } = require('../src/tournament-stages');
const { SubmissionService } = require('../src/submissions/service');
const { SwissService } = require('../src/swiss');
const { BracketService } = require('../src/brackets');
const { BracketRunner } = require('../src/bracket-runner');
const { DEFAULT_RULES } = require('../src/game/engine');
const { verifyReplay } = require('../src/game/match');

async function demo() {
  if (!process.argv.includes('--run')) throw new Error('Cần --run để tạo và chạy giải thử. Dừng server và sao lưu trước khi chạy.');
  const db = openDatabase(process.env.DB_PATH || path.join(__dirname, '../data/arena.sqlite'));
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' AND locked=0 AND deleted_at IS NULL ORDER BY id LIMIT 1").get();
  if (!admin) { db.close(); throw new Error('Cần tài khoản quản trị đang hoạt động.'); }
  const actor = admin.id, ruleSets = new RuleSetService(db), tournaments = new TournamentService(db, { ruleSets });
  const stages = new TournamentStages(db, { tournaments }); tournaments.stages = stages;
  const submissions = new SubmissionService(db, { stages, workers: 1 });
  const swiss = new SwissService(db, { tournaments, submissions });
  const brackets = new BracketService(db, { tournaments });
  const runner = new BracketRunner(db, { tournaments, brackets, submissions }); brackets.runner = runner;
  let id;
  const until = async (predicate, label, timeout = 240000) => {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Quá thời gian: ' + label);
      const blocked = db.prepare("SELECT COUNT(*) n FROM swiss_games g JOIN swiss_pairs p ON p.id=g.pair_id JOIN swiss_rounds r ON r.id=p.round_id JOIN tournament_stages s ON s.id=r.stage_id WHERE s.tournament_id=? AND g.status='blocked'").get(id).n
        + db.prepare("SELECT COUNT(*) n FROM bracket_games WHERE tournament_id=? AND status='blocked'").get(id).n;
      if (blocked) throw new Error(`${blocked} ván lỗi hạ tầng; giải giữ nguyên để kiểm tra/chạy lại.`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  };
  try {
    const tag = new Date().toISOString().replace(/\D/g, '').slice(0, 14), userIds = [], receipts = [];
    for (let i = 1; i <= 6; i++) {
      const username = `demo6_${tag}_${i}`;
      await createUser(db, { username, password: crypto.randomBytes(24).toString('hex'), mustChangePassword: true });
      userIds.push(db.prepare('SELECT id FROM users WHERE username=?').get(username).id);
    }
    const rule = ruleSets.save({ userId: actor, name: `Luật thử 6 đội ${tag} (8 nước)`, rules: { ...DEFAULT_RULES, maxMoves: 8 } });
    let t = tournaments.create(actor, { name: `Giải thử 6 đội ${tag} · luật rút gọn`, ruleSetId: rule.id, ruleSetVersion: rule.version,
      config: { maxTeams: 6, swissRounds: 2, gamesPerPair: 2, topN: 6, bestOf: 1, extraPairs: 1 } });
    id = t.id; console.log(`DEMO_TOURNAMENT_ID=${id}`);
    t = tournaments.replaceEntrants(id, actor, { expectedRevision: t.revision, userIds });
    t = stages.open(id, actor, { expectedRevision: t.revision, closesAt: Date.now() + 600000 });
    const stageId = t.stages[0].id;
    for (let i = 0; i < 6; i++) {
      const language = i % 2 ? 'cpp' : 'python', entry = language === 'cpp' ? 'main.cpp' : 'main.py';
      const buffer = await fs.readFile(path.join(__dirname, '../bots/templates', language, entry));
      const receipt = await submissions.submit({ stageId, userId: userIds[i], filename: entry, buffer, idempotencyKey: `demo-six-${tag}-${i}` }); receipts.push(receipt);
    }
    t = stages.close(id, actor, { expectedRevision: t.revision, reason: 'Giải thử: đã nhận đủ 6 bài' });
    console.log('Đã nhận 6 bài Python/C++; bắt đầu kiểm tra Docker.');
    submissions.start(); await submissions.idle(240000);
    assert.ok(receipts.every(r => db.prepare('SELECT status FROM bot_submissions WHERE id=?').get(r.id).status === 'Accepted'), 'Cần đủ 6 bot hợp lệ');
    t = stages.lock(id, actor, { expectedRevision: tournaments.get(id).revision, reason: 'Giải thử: đủ 6 bot qua kiểm tra Docker' });
    console.log('Đã chốt 6 bot; chạy 2 lượt vòng loại.');
    swiss.create(id, actor, { expectedRevision: t.revision, seed: `demo-six-${tag}` }); swiss.start();
    await until(() => swiss.get(id).rounds[0]?.status === 'finished', 'lượt vòng loại 1');
    swiss.next(id, actor, { expectedRevision: swiss.get(id).revision });
    await until(() => swiss.get(id).status === 'finished', 'lượt vòng loại 2');
    const qualifiers = swiss.get(id);
    swiss.approve(id, actor, { expectedRevision: tournaments.get(id).revision, swissRevision: qualifiers.revision, topN: 6, reason: 'Giải thử: đối chiếu đủ 12 ván vòng loại, lấy cả 6 đội để kiểm tra miễn đấu' });
    brackets.create(id, actor, { expectedRevision: tournaments.get(id).revision, reason: 'Giải thử sơ đồ 8 vị trí, 6 đội và 2 suất miễn đấu' });
    runner.create(id, actor, { expectedRevision: tournaments.get(id).revision, reason: 'Giải thử giữ nguyên bot và luật 8 nước', rulesPolicy: 'keep_qualifier' });
    console.log('Đã duyệt 6 đội; chạy loại trực tiếp đến chung kết.'); runner.start();
    await until(() => runner.view(id).status === 'finished', 'vòng loại trực tiếp');
    const final = runner.view(id), games = final.games;
    for (const pair of qualifiers.pairs) for (const game of pair.games) assert.ok(verifyReplay(swiss.match(game.id).replay));
    for (const game of games) assert.ok(verifyReplay(runner.match(game.id).replay));
    assert.equal(final.rounds.flatMap(r => r.matches).filter(m => m.status === 'finished').length, 5);
    assert.equal(final.rounds.flatMap(r => r.matches).filter(m => m.status === 'bye').length, 2);
    runner.publish(id, actor, { expectedRevision: tournaments.get(id).revision, reason: 'Giải thử: đã kiểm chứng toàn bộ bản xem lại, duyệt đội vô địch' });
    assert.equal(tournaments.get(id).status, 'finished');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const report = { tournamentId: id, name: tournaments.get(id).name, champion: final.champion, standings: qualifiers.standings,
      qualifierGames: qualifiers.pairs.reduce((sum, p) => sum + p.games.length, 0), bracketGames: games.length,
      rounds: final.rounds, accepted: 6, byes: 2, publishedAt: runner.view(id).publishedAt };
    await fs.writeFile(path.join(__dirname, '../data/demo-six-teams-result.json'), JSON.stringify(report, null, 2));
    const rows = report.standings.map(e => `| ${e.rank} | ${e.username} | ${e.points} | ${e.buchholz} |`).join('\n');
    const matches = final.rounds.flatMap(r => r.matches).map(m => `| ${m.id} | ${m.slots.filter(Boolean).map(e => e.username).join(' gặp ')} | ${m.winner.username} | ${m.status === 'bye' ? 'Miễn đấu' : m.decidedBy === 'seed' ? 'Hòa sau đấu thêm, xét hạt giống' : 'Điểm ván'} |`).join('\n');
    await fs.writeFile(path.join(__dirname, '../docs/DEMO-6-TEAMS.md'), `# Kết quả giải thử 6 đội\n\n- Giải: ${report.name}\n- Mã: ${id}\n- Trạng thái: đã duyệt kết quả và kết thúc\n- Vô địch: **${final.champion.username}** (hạt giống ${final.champion.seed})\n- 6 bài hợp lệ: 3 Python, 3 C++; chạy Docker thật.\n- Vòng loại: 2 lượt × 3 cặp × 2 ván = ${report.qualifierGames} ván.\n- Loại trực tiếp: 6 đội/8 vị trí, 2 suất miễn đấu, 5 cặp thực, ${games.length} ván.\n- Mỗi cặp có 1 ván chính; hòa thì thêm 2 ván đổi bên/cùng mã khởi tạo; vẫn hòa xét hạt giống.\n- Luật rút gọn 8 nước để thử luồng nhanh, giữ cùng bot/luật giữa hai giai đoạn. Không phải đánh giá chất lượng chiến thuật hay khả năng chịu tải.\n- Đã kiểm chứng toàn bộ ${report.qualifierGames + games.length} bản xem lại thi đấu.\n- Tài khoản mẫu dùng mật khẩu ngẫu nhiên không công bố; quản trị viên có thể cấp lại khi cần đăng nhập thử. Không đổi tài khoản/giải khác.\n\n## Bảng điểm vòng loại\n\n| Hạng | Đội | Điểm | Tổng điểm đối thủ |\n| --- | --- | --- | --- |\n${rows}\n\n## Các cặp loại trực tiếp\n\n| Cặp | Đội | Đội đi tiếp | Cách quyết định |\n| --- | --- | --- | --- |\n${matches}\n`);
    console.log(JSON.stringify({ tournamentId: id, champion: final.champion.username, qualifierGames: report.qualifierGames, bracketGames: games.length, status: tournaments.get(id).status }));
    return { id, champion: final.champion.userId, publishedAt: report.publishedAt };
  } finally { await runner.close(); await swiss.close(); await submissions.close(); db.close(); }
}
if (require.main === module) demo().then(async saved => {
  const db = openDatabase(process.env.DB_PATH || path.join(__dirname, '../data/arena.sqlite'));
  try { const row = db.prepare('SELECT state_json,published_at FROM bracket_runs WHERE tournament_id=?').get(saved.id); assert.equal(JSON.parse(row.state_json).champion.userId, saved.champion); assert.equal(row.published_at, saved.publishedAt); console.log('Đã mở lại database: kết quả và người vô địch giữ nguyên.'); }
  finally { db.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
