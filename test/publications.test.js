const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { PublicationService } = require('../src/publish/publications');
const { buildSite } = require('../src/publish/site');
const { DEFAULT_RULES } = require('../src/game/engine');
const { RuleSetService } = require('../src/rule-sets');
const { runMatch } = require('../src/game/match');
const { BotFault } = require('../src/game/protocol');

// The lower user ID always wins, so standings and the bracket are predictable without a sandbox.
const play = async (game, { rules, onTurn }) => runMatch({ seed: game.seed, rules, bots: [{ id: 'a', submission_id: 'x', source_hash: 'secret-hash' }, { id: 'b' }], onTurn, choose: async (player, request) => {
  if ([game.player0, game.player1][player] > Math.min(game.player0, game.player1)) throw new BotFault('bot_crash');
  return { cpu_ms: 1, stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[0] }), stderr: 'BOT-STDERR' };
} });
async function idle(db, table, runner) {
  const end = Date.now() + 15000;
  while (runner.active || db.prepare(`SELECT 1 FROM ${table} WHERE status IN ('queued','running') LIMIT 1`).get()) {
    if (Date.now() > end) throw new Error(`${table} timed out`);
    runner.pump(); await new Promise(resolve => setTimeout(resolve, 2));
  }
}
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-publish-'));
  const db = openDatabase(':memory:'); let clock = 1000;
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin','unused','admin',0)").run();
  for (let id = 2; id <= 6; id++) {
    db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'unused','contestant',0)").run(id, `team${id}`);
    db.prepare('INSERT INTO team_profiles VALUES (?,?,?,?,?)').run(id, `Đội số ${id}`, `leader${id}@private.example`, JSON.stringify([{ name: `Nguyễn Bí Mật ${id}`, studentId: `SV-SECRET-${id}`, email: `m${id}@private.example`, phone: '0900000000' }]), 0);
  }
  const sheetCalls = []; let sheetFailures = 0;
  const sheets = { async write(tabs) { if (sheetFailures > 0) { sheetFailures--; throw new Error('429 quota'); } sheetCalls.push(tabs); } };
  const deploys = [];
  const app = await createApp({ db, now: () => clock, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(root, 'subs') },
    swissOptions: { play, retryDelayMs: 0 }, bracketOptions: { play, retryDelayMs: 0 },
    publicationOptions: { siteDir: path.join(root, 'site'), sheets, deploy: null, deployRunner: async dir => { deploys.push(dir); return { ok: true, output: 'deployed' }; }, log: () => {} } });
  const { tournaments, swiss, publications } = app.locals;
  try {
    await run({ db, app, tournaments, swiss, publications, root, sheetCalls, deploys, failSheets: n => { sheetFailures = n; }, clock: value => { clock = value; }, now: () => clock });
  } finally { await publications.close(); await swiss.close(); await app.locals.bracketRunner.close(); await app.locals.submissions.close(); db.close(); await fs.rm(root, { recursive: true, force: true }); }
}
// Swiss (2 rounds) → approve top 4 → bracket, all with the predictable fake games.
async function runTournament(f) {
  const law = f.app.locals.ruleSets.save({ userId: 1, name: 'Nhanh', rules: { ...DEFAULT_RULES, maxMoves: 8 } });
  let t = f.tournaments.create(1, { name: 'Giải công bố', ruleSetId: law.id, ruleSetVersion: law.version, config: { swissRounds: 2, topN: 4, bestOf: 1, extraPairs: 1 } });
  t = f.tournaments.replaceEntrants(t.id, 1, { expectedRevision: t.revision, userIds: [2, 3, 4, 5, 6] });
  t = f.tournaments.stages.open(t.id, 1, { expectedRevision: t.revision, closesAt: 2000 });
  for (let userId = 2; userId <= 6; userId++) f.db.prepare(`INSERT INTO bot_submissions(id,user_id,version,filename,entry,language,status,job_status,created_at,updated_at,stage_id,source_hash,image)
    VALUES (?,?,1,'main.py','main.py','python','Accepted','done',1000,1000,?,'secret-hash','fake-image')`).run(crypto.randomUUID(), userId, t.stages[0].id);
  f.clock(2001);
  t = f.tournaments.stages.lock(t.id, 1, { expectedRevision: t.revision, reason: 'hết hạn' });
  f.swiss.create(t.id, 1, { expectedRevision: t.revision, seed: 'publish' }); f.swiss.start(); await idle(f.db, 'swiss_games', f.swiss);
  return t.id;
}

test('publications are immutable snapshots without private data; the site, team files and Sheets copy follow them', () => fixture(async f => {
  const id = await runTournament(f);
  assert.throws(() => f.publications.publish(id, 1, { reason: '' }), error => error.status === 400);
  const v1 = f.publications.publish(id, 1, { reason: 'Sau lượt 1' });
  assert.equal(v1.version, 1);
  f.swiss.next(id, 1, { expectedRevision: f.swiss.get(id).revision }); await idle(f.db, 'swiss_games', f.swiss);
  const swiss = f.swiss.get(id);
  f.swiss.approve(id, 1, { expectedRevision: f.tournaments.get(id).revision, swissRevision: swiss.revision, topN: 4, reason: 'Đã kiểm tra' });
  const bracket = f.app.locals.brackets.create(id, 1, { expectedRevision: f.tournaments.get(id).revision, reason: 'Sơ đồ' });
  assert.ok(bracket);
  f.app.locals.bracketRunner.create(id, 1, { expectedRevision: f.tournaments.get(id).revision, reason: 'Chạy', rulesPolicy: 'keep_qualifier' });
  f.app.locals.bracketRunner.start(); await idle(f.db, 'bracket_games', f.app.locals.bracketRunner);
  const v2 = f.publications.publish(id, 1, { reason: 'Chung kết' });
  assert.equal(v2.version, 2);
  assert.throws(() => f.db.prepare('UPDATE publications SET reason=? WHERE id=?').run('x', v1.id), /immutable/);
  assert.throws(() => f.db.prepare('DELETE FROM publications WHERE id=?').run(v1.id), /immutable/);
  await f.publications.building;

  const site = path.join(f.root, 'site'), read = async file => JSON.parse(await fs.readFile(path.join(site, ...file.split('/')), 'utf8'));
  const manifest = await read('manifest.json');
  assert.deepEqual(manifest.tournaments.map(t => [t.id, t.version]), [[id, 2]]);
  const latest = await read(`t/${id}/latest.json`);
  assert.equal(latest.version, 2); assert.deepEqual(latest.files.bracketRounds, []);
  const first = await read(`t/${id}/v1/summary.json`), summary = await read(latest.files.summary), knockout = await read(latest.files.bracket);
  assert.equal(first.swiss.provisional, true); assert.equal(first.swiss.roundsFinished, 1); assert.equal(first.qualification, null);
  assert.equal(summary.swiss.provisional, false); assert.deepEqual(summary.qualification.teams.map(t => t.team), summary.swiss.standings.slice(0, 4).map(t => t.team));
  assert.equal(summary.swiss.standings[0].teamName, 'Đội số 2');
  assert.equal(knockout.champion.team, 'team2'); assert.ok(knockout.games.length > 0 && knockout.games.every(g => g.replay && Array.isArray(g.replay.turns) && g.replay.result));
  // Private and internal fields never reach public files.
  const everything = (await fs.readdir(site, { recursive: true })).filter(name => name.endsWith('.json'));
  for (const file of everything) {
    const text = await fs.readFile(path.join(site, file), 'utf8');
    for (const secret of ['private.example', 'Nguyễn Bí Mật', 'SV-SECRET', '0900000000', 'secret-hash', 'BOT-STDERR', 'fake-image', 'submissionId', 'submission_id'])
      assert.ok(!text.includes(secret), `${file} leaks ${secret}`);
  }
  assert.match(await fs.readFile(path.join(site, '_headers'), 'utf8'), /immutable/);
  for (const asset of ['index.html', 'assets/public.js', 'assets/tiles.js', 'assets/tiles.css', 'assets/pieces/rock.svg']) await fs.access(path.join(site, asset));

  const code = f.publications.lookupCode(2);
  assert.match(code, /^[0-9a-f]{20}$/); assert.notEqual(code, f.publications.lookupCode(3)); assert.ok(!code.includes('team2'));
  assert.equal(new PublicationService(f.db, { tournaments: f.tournaments, swiss: f.swiss, brackets: f.app.locals.brackets }).lookupCode(2), code, 'key is stored in the database');
  const team = await read(`team/${code}.json`);
  assert.equal(team.team, 'team2'); assert.equal(team.tournaments[0].bracket, 'Vô địch'); assert.equal(team.tournaments[0].bot.lockedVersion, 1);
  const out = summary.swiss.standings.at(-1);
  assert.equal((await read(`team/${f.publications.lookupCode(out.userId)}.json`)).tournaments[0].qualified, false);

  // Sheets: quota errors back off and retry; the database copy is unaffected.
  f.failSheets(1);
  await f.publications.runSheets();
  let sync = f.db.prepare('SELECT * FROM sheet_syncs WHERE publication_id=?').get(v1.id);
  assert.equal(sync.status, 'queued'); assert.equal(sync.attempts, 1); assert.ok(sync.available_at > f.now()); assert.match(sync.error, /429/);
  f.clock(f.now() + 3600000);
  await f.publications.runSheets(); await f.publications.runSheets();
  assert.deepEqual(f.db.prepare('SELECT status FROM sheet_syncs ORDER BY publication_id').all().map(r => r.status), ['done', 'done']);
  const tabs = f.sheetCalls.at(-1);
  assert.deepEqual(tabs.map(t => t.title), ['Giải công bố · Xếp hạng', 'Giải công bố · Loại trực tiếp', 'Giải công bố · Đội']);
  assert.equal(tabs[0].rows[2][1], 'team2'); assert.ok(!JSON.stringify(tabs).includes('private.example'));
}));

test('scheduled publishing runs on time, is skipped while paused, and pausing needs no config change', () => fixture(async f => {
  const id = await runTournament(f), start = f.now();
  assert.throws(() => f.publications.schedule(id, 1, { publishAt: start - 1, reason: 'Quá khứ' }), error => error.status === 400);
  f.publications.schedule(id, 1, { publishAt: start + 1000, reason: 'Lịch 1' });
  f.publications.control(id, 1, { paused: true, reason: 'Hoãn giải vì mất điện' });
  f.clock(start + 2000); f.publications.runSchedules();
  let list = f.publications.list(id);
  assert.equal(list.schedules[0].status, 'skipped'); assert.equal(list.publications.length, 0); assert.equal(list.control.autoPaused, 1);
  f.publications.control(id, 1, { paused: false, reason: 'Giải tiếp tục' });
  f.publications.schedule(id, 1, { publishAt: start + 3000, reason: 'Lịch 2' });
  const cancelled = f.publications.schedule(id, 1, { publishAt: start + 9000, reason: 'Lịch 3' }).schedules[0];
  f.publications.cancelSchedule(cancelled.id, 1);
  f.clock(start + 10000); f.publications.runSchedules();
  list = f.publications.list(id);
  assert.deepEqual(list.schedules.map(s => s.status), ['cancelled', 'done', 'skipped']);
  assert.equal(list.publications.length, 1); assert.equal(list.publications[0].trigger, 'schedule'); assert.match(list.publications[0].reason, /Lịch 2/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind IN ('auto_publish_paused','auto_publish_resumed')").get().n, 2);
}));

test('deploy is reported as blocked without Cloudflare credentials and runs the deployer when configured', () => fixture(async f => {
  await f.publications.rebuild(true);
  assert.equal(f.db.prepare('SELECT status FROM site_deploys').get().status, 'blocked');
  f.publications.deploy = { token: 't', account: 'a', project: 'p', wrangler: '3.80.0' };
  await f.publications.rebuild(true);
  assert.deepEqual(f.db.prepare('SELECT status,output FROM site_deploys ORDER BY id').all().map(r => ({ ...r })), [{ status: 'blocked', output: 'Bị chặn: cần CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID và CLOUDFLARE_PAGES_PROJECT.' }, { status: 'done', output: 'deployed' }]);
  assert.equal(f.deploys.length, 1);
}));

test('oversized brackets are split into one replay file per round', async () => {
  const db = openDatabase(':memory:'), dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ott-split-')), 'site');
  try {
    db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin','unused','admin',0)").run();
    new RuleSetService(db);
    db.prepare("INSERT INTO tournaments(id,name,status,revision,created_by,created_at,updated_at,config_json,rule_set_id,rule_set_version) VALUES ('t1','Lớn','finished',1,1,0,0,'{}','ottv2-classic',2)").run();
    const replay = { seed: 's', turns: [{ move: {}, changes: ['x'.repeat(3000)] }] };
    const bracket = { rounds: [{ number: 1, matches: [{ id: 'r1-m1' }, { id: 'r1-m2' }] }, { number: 2, matches: [{ id: 'r2-m1' }] }],
      games: [{ id: 'g1', matchId: 'r1-m1', replay }, { id: 'g2', matchId: 'r1-m2', replay }, { id: 'g3', matchId: 'r2-m1', replay }] };
    db.prepare("INSERT INTO publications(tournament_id,version,created_at,created_by,trigger,reason,snapshot_json) VALUES ('t1',1,5,1,'manual','x',?)")
      .run(JSON.stringify({ tournament: { id: 't1', name: 'Lớn', status: 'finished' }, swiss: null, qualification: null, bracket, teams: [] }));
    await buildSite({ db, dir, lookupCode: () => 'x', fileLimit: 7000 });
    const latest = JSON.parse(await fs.readFile(path.join(dir, 't', 't1', 'latest.json'), 'utf8'));
    assert.deepEqual(latest.files.bracketRounds, ['t/t1/v1/bracket-r1.json', 't/t1/v1/bracket-r2.json']);
    const tree = JSON.parse(await fs.readFile(path.join(dir, 't', 't1', 'v1', 'bracket.json'), 'utf8'));
    assert.ok(tree.games.every(game => !game.replay));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 't', 't1', 'v1', 'bracket-r1.json'), 'utf8')).games.map(g => g.id), ['g1', 'g2']);
  } finally { db.close(); await fs.rm(path.dirname(dir), { recursive: true, force: true }); }
});
