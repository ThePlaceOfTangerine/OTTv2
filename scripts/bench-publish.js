// Synthetic large tournament to size the public site: node scripts/bench-publish.js [teams=1000] [workDir=../OTTv2-local/bench]
// Games are fake (lower user id wins, ≤ 8 moves) so only publishing, site size and static reads are measured — not grading speed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { DEFAULT_RULES } = require('../src/game/engine');
const { runMatch } = require('../src/game/match');
const { BotFault } = require('../src/game/protocol');
const { loadTest } = require('./load-static');

const teams = Number(process.argv[2] || 1000), played = teams, work = path.resolve(process.argv[3] || path.join(__dirname, '../../OTTv2-local/bench'));
const play = async (game, { rules }) => runMatch({ seed: game.seed, rules, bots: [{ id: 'a' }, { id: 'b' }], choose: async (player, request) => {
  if ([game.player0, game.player1][player] > Math.min(game.player0, game.player1) && request.state.moveCount > 2) throw new BotFault('bot_crash');
  return { cpu_ms: 1, stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[0] }) };
} });
const time = async (label, work) => { const started = Date.now(); const result = await work(); console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(1)} s`); return result; };
async function drain(db, table, runner) { while (runner.active || db.prepare(`SELECT 1 FROM ${table} WHERE status IN ('queued','running') LIMIT 1`).get()) { runner.pump(); await new Promise(r => setImmediate(r)); } }

(async () => {
  fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const db = openDatabase(path.join(work, 'bench.sqlite')); let clock = Date.now();
  const app = await createApp({ db, now: () => clock, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(work, 'subs') },
    swissOptions: { play, retryDelayMs: 0 }, bracketOptions: { play, retryDelayMs: 0 }, publicationOptions: { siteDir: path.join(work, 'site'), log: console.error } });
  const { tournaments, swiss, publications, brackets, bracketRunner, ruleSets } = app.locals;
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin','unused','admin',0)").run();
  const insert = db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'unused','contestant',0)"), profile = db.prepare('INSERT INTO team_profiles VALUES (?,?,?,?,?)');
  db.exec('BEGIN'); for (let i = 0; i < played; i++) { insert.run(i + 2, `team${String(i + 1).padStart(4, '0')}`); profile.run(i + 2, `Đội ${i + 1}`, 'x@example.com', '[]', 0); } db.exec('COMMIT');
  const law = ruleSets.save({ userId: 1, name: 'Bench', rules: { ...DEFAULT_RULES, maxMoves: 8 } });
  let t = tournaments.create(1, { name: `Giả lập ${played} đội`, ruleSetId: law.id, ruleSetVersion: law.version, config: { maxTeams: played, swissRounds: 8, topN: 16, bestOf: 3, extraPairs: 1 } });
  t = tournaments.replaceEntrants(t.id, 1, { expectedRevision: t.revision, userIds: Array.from({ length: played }, (_, i) => i + 2) });
  t = tournaments.stages.open(t.id, 1, { expectedRevision: t.revision, closesAt: clock + 1000 });
  const sub = db.prepare(`INSERT INTO bot_submissions(id,user_id,version,filename,entry,language,status,job_status,created_at,updated_at,stage_id,source_hash,image) VALUES (?,?,1,'main.py','main.py','python','Accepted','done',?,?,?,'h','fake')`);
  db.exec('BEGIN'); for (let i = 0; i < played; i++) sub.run(crypto.randomUUID(), i + 2, clock, clock, t.stages[0].id); db.exec('COMMIT');
  clock += 2000; t = tournaments.stages.lock(t.id, 1, { expectedRevision: t.revision, reason: 'bench' });
  await time('Vòng loại 8 lượt (ván giả)', async () => {
    swiss.create(t.id, 1, { expectedRevision: t.revision, seed: 'bench' }); swiss.started = true;
    for (let round = 1; round <= 8; round++) { await drain(db, 'swiss_games', swiss); if (round < 8) swiss.next(t.id, 1, { expectedRevision: swiss.get(t.id).revision }); }
  });
  const v1 = await time(`Công bố bảng điểm ${played} đội`, async () => publications.publish(t.id, 1, { reason: 'Bench vòng loại' }));
  swiss.approve(t.id, 1, { expectedRevision: tournaments.get(t.id).revision, swissRevision: swiss.get(t.id).revision, topN: 16, reason: 'bench' });
  brackets.create(t.id, 1, { expectedRevision: tournaments.get(t.id).revision, reason: 'bench' });
  bracketRunner.create(t.id, 1, { expectedRevision: tournaments.get(t.id).revision, reason: 'bench', rulesPolicy: 'keep_qualifier' }); bracketRunner.started = true;
  await time('Loại trực tiếp top 16 (ván giả)', () => drain(db, 'bracket_games', bracketRunner));
  await time('Công bố bản có loại trực tiếp', async () => publications.publish(t.id, 1, { reason: 'Bench chung kết' }));
  await time('Dựng site', () => publications.building);
  const site = path.join(work, 'site'), sizeOf = file => fs.statSync(path.join(site, file)).size;
  const latest = JSON.parse(fs.readFileSync(path.join(site, 't', t.id, 'latest.json'), 'utf8'));
  const all = fs.readdirSync(site, { recursive: true }).filter(name => fs.statSync(path.join(site, name)).isFile());
  console.log(JSON.stringify({ teams, files: all.length, siteMegabytes: (all.reduce((sum, file) => sum + sizeOf(file), 0) / 1048576).toFixed(2),
    summaryKB: (sizeOf(latest.files.summary) / 1024).toFixed(0), bracketKB: (sizeOf(latest.files.bracket) / 1024).toFixed(0), teamFiles: fs.readdirSync(path.join(site, 'team')).length,
    firstPublication: v1.version, lastBuild: publications.lastBuild }, null, 2));
  // Windows refuses more than ~230 pending connects from one process, so use a 200-connection pool there (see docs/PUBLISHING.md).
  console.log('Tải tĩnh 4000 lượt đồng thời:', JSON.stringify(await loadTest(site, 4000, process.platform === 'win32' ? 200 : Infinity), null, 2));
  await publications.close(); db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
