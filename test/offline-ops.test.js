const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { importFolder } = require('../src/intake/folder');
const { restoreSnapshot } = require('../src/backup/snapshots');
const { DEFAULT_RULES } = require('../src/game/engine');
const { zip } = require('./zip-helper');

const bot = 'import json\nimport sys\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({"request_id":r["request_id"],"move":r["legal_moves"][0]}))\n';
const fakeManager = () => ({ async check() { return { image: 'fake' }; }, async prepare(source) { return { ...source, image: 'fake', hash: 'h', compile_cpu_ms: 1 }; },
  async start() { return { async close() {}, async move(r) { return { cpu_ms: 1, stdout: JSON.stringify({ request_id: r.request_id, move: r.legal_moves[0] }) }; } }; }, async dispose() {} });
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-offline-')); let clock = Date.now();
  const db = openDatabase(path.join(root, 'arena.sqlite'));
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin','unused','admin',0)").run();
  for (const [id, name] of [[2, 'team-a'], [3, 'team-b'], [4, 'team-c'], [5, 'team-d']]) db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'unused','contestant',0)").run(id, name);
  const app = await createApp({ db, now: () => clock, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(root, 'subs'), managerFactory: fakeManager, retryDelayMs: 0 },
    publicationOptions: { siteDir: path.join(root, 'site'), log: () => {} }, snapshotOptions: { dir: path.join(root, 'snapshots'), keep: 2 } });
  const { tournaments, submissions } = app.locals;
  const law = app.locals.ruleSets.save({ userId: 1, name: 'Nhanh', rules: { ...DEFAULT_RULES, maxMoves: 8 } });
  let t = tournaments.create(1, { name: 'Chung kết LAN', ruleSetId: law.id, ruleSetVersion: law.version, config: { swissRounds: 1, topN: 2 } });
  t = tournaments.replaceEntrants(t.id, 1, { expectedRevision: t.revision, userIds: [2, 3, 4] });
  t = tournaments.stages.open(t.id, 1, { expectedRevision: t.revision, closesAt: clock + 60000 });
  try { await run({ db, app, root, submissions, tournaments, stageId: t.stages[0].id, closesAt: clock + 60000, clock: v => { clock = v; }, now: () => clock }); }
  finally { await app.locals.snapshots.close(); await submissions.close(); db.close(); await fs.rm(root, { recursive: true, force: true }); }
}

test('USB/folder intake creates normal submissions per team, is idempotent and honours the desk receipt time', () => fixture(async f => {
  const usb = path.join(f.root, 'usb');
  await fs.mkdir(path.join(usb, 'team-a', 'bot', 'lib'), { recursive: true });
  await fs.writeFile(path.join(usb, 'team-a', 'ott.json'), JSON.stringify({ language: 'python', entry: 'main.py' }));
  await fs.writeFile(path.join(usb, 'team-a', 'bot', 'main.py'), bot); await fs.writeFile(path.join(usb, 'team-a', 'bot', 'lib', 'util.py'), 'X = 1\n');
  await fs.writeFile(path.join(usb, 'team-a', 'bot', 'notes.txt'), 'ignored');
  await fs.writeFile(path.join(usb, 'TEAM-B.zip'), zip([{ name: 'main.py', data: bot }]));
  await fs.writeFile(path.join(usb, 'team-c.py'), bot);
  await fs.mkdir(path.join(usb, 'team-d')); await fs.writeFile(path.join(usb, 'team-d', 'ott.json'), '{}');
  await fs.mkdir(path.join(usb, 'stranger', 'bot'), { recursive: true }); await fs.writeFile(path.join(usb, 'stranger', 'ott.json'), JSON.stringify({ language: 'python', entry: 'main.py' })); await fs.writeFile(path.join(usb, 'stranger', 'bot', 'main.py'), bot);
  await fs.writeFile(path.join(usb, 'readme.txt'), 'not a bot');
  const run = extra => importFolder({ db: f.db, submissions: f.submissions, tournaments: f.tournaments, stageId: f.stageId, dir: usb, actorId: 1, reason: 'Mạng phòng thi chập chờn', ...extra });
  await assert.rejects(run({ dir: 'relative/path' }), error => error.status === 400);
  await assert.rejects(run({ reason: '' }), error => error.status === 400);
  const first = (await run()).report;
  const byName = Object.fromEntries(first.map(row => [row.name, row]));
  assert.equal(byName['team-a'].status, 'queued'); assert.equal(byName['TEAM-B.zip'].status, 'queued'); assert.equal(byName['team-c.py'].status, 'queued');
  assert.match(byName['team-d'].message, /entry/); assert.match(byName.stranger.message, /Không có đội stranger/); assert.equal(byName['readme.txt'], undefined);
  f.submissions.start(); await f.submissions.idle();
  for (const name of ['team-a', 'TEAM-B.zip', 'team-c.py']) {
    const row = f.db.prepare('SELECT status,origin,entry FROM bot_submissions WHERE id=?').get(byName[name].submissionId);
    assert.equal(row.status, 'Accepted', name); assert.equal(row.origin, 'usb');
  }
  assert.ok(fsSync.existsSync(path.join(f.submissions.folder(byName['team-a'].submissionId, 'artifact'), 'lib', 'util.py')));
  const again = (await run()).report;
  assert.deepEqual(again.filter(r => r.status === 'duplicate').map(r => r.name).sort(), ['TEAM-B.zip', 'team-a', 'team-c.py']);
  // Handed in at the desk before the deadline, typed in after it.
  await fs.writeFile(path.join(usb, 'team-c.py'), bot + '# v2\n');
  f.clock(f.closesAt + 5000);
  assert.equal((await run()).report.find(r => r.name === 'team-c.py').status, 'error');
  const late = (await run({ receivedAt: f.closesAt - 1000 })).report.find(r => r.name === 'team-c.py');
  assert.equal(late.status, 'queued');
  assert.equal(f.db.prepare('SELECT created_at FROM bot_submissions WHERE id=?').get(late.submissionId).created_at, f.closesAt - 1000);
  assert.equal((await run({ receivedAt: f.closesAt + 1 })).report.find(r => r.name === 'team-c.py').status, 'duplicate');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tournament_events WHERE kind='folder_intake'").get().n, 5);
}));

test('snapshots are consistent while running, skip half-written ones, copy finished files once, and restore into a new location', () => fixture(async f => {
  const done = (await f.submissions.submit({ userId: 2, stageId: f.stageId, filename: 'main.py', buffer: Buffer.from(bot) })).id;
  f.submissions.start(); await f.submissions.idle(); await f.submissions.close();
  const pending = (await f.submissions.submit({ userId: 3, stageId: f.stageId, filename: 'main.py', buffer: Buffer.from(bot) })).id;
  const snapshots = f.app.locals.snapshots;
  await fs.mkdir(path.join(snapshots.dir, 'ott-crashed.partial', 'x'), { recursive: true });
  const first = await snapshots.snapshot();
  assert.equal(first.copied, 1); assert.equal(first.submissions, 1);
  assert.ok(!fsSync.existsSync(path.join(snapshots.dir, 'ott-crashed.partial')), 'leftover from a crash is removed');
  f.clock(f.now() + 1000);
  assert.equal((await snapshots.snapshot()).copied, 0, 'finished submissions are copied only once');
  f.clock(f.now() + 1000); await snapshots.snapshot();
  const names = await snapshots.list();
  assert.equal(names.length, 2, 'keeps the newest N');
  // Restore the newest snapshot elsewhere and run the app on it.
  const target = path.join(f.root, 'restored'), snapshot = path.join(snapshots.dir, names[0]);
  const result = await restoreSnapshot({ snapshot, dbPath: path.join(target, 'arena.sqlite'), submissionsRoot: path.join(target, 'subs') });
  assert.equal(result.submissions, 1); assert.equal(result.pending, 1);
  const restored = openDatabase(path.join(target, 'arena.sqlite'));
  try {
    assert.equal(restored.prepare('SELECT COUNT(*) n FROM bot_submissions').get().n, 2);
    assert.ok(fsSync.existsSync(path.join(target, 'subs', done, 'artifact', 'main.py')));
    assert.ok(fsSync.existsSync(path.join(target, 'subs', pending, 'upload.bin')));
    const app = await createApp({ db: restored, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(target, 'subs'), managerFactory: fakeManager, retryDelayMs: 0 },
      publicationOptions: { siteDir: path.join(target, 'site'), log: () => {} } });
    app.locals.submissions.start(); await app.locals.submissions.idle(); await app.locals.submissions.close();
    assert.equal(restored.prepare('SELECT status FROM bot_submissions WHERE id=?').get(pending).status, 'Accepted', 'pending upload is checked after restore');
  } finally { restored.close(); }
  await assert.rejects(restoreSnapshot({ snapshot, dbPath: path.join(target, 'arena.sqlite'), submissionsRoot: path.join(target, 'subs') }), /--force/);
  const moved = await restoreSnapshot({ snapshot, dbPath: path.join(target, 'arena.sqlite'), submissionsRoot: path.join(target, 'subs'), force: true });
  assert.equal(moved.name, names[0]);
  assert.ok((await fs.readdir(target)).some(name => name.startsWith('arena.sqlite.before-restore-')), 'existing DB is kept aside');
  await fs.appendFile(path.join(snapshot, 'arena.sqlite'), Buffer.from('tamper'));
  await assert.rejects(restoreSnapshot({ snapshot, dbPath: path.join(f.root, 'other.sqlite'), submissionsRoot: path.join(f.root, 'other') }), /mã băm/);
}));
