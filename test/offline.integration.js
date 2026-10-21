// LAN-final day without Internet, with a real sandbox. Run inside a network namespace that has no Internet, e.g. in the ott-grader distro:
//   bwrap --unshare-net --dev-bind / / --proc /proc env SANDBOX_BACKEND=bwrap node --test test/offline.integration.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { importFolder } = require('../src/intake/folder');

const online = () => new Promise(resolve => { const s = net.connect({ host: '1.1.1.1', port: 443, timeout: 2000 }, () => { s.destroy(); resolve(true); }); s.on('timeout', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(false)); });

test('portal login, sandbox checks, USB intake, snapshot and results site all work with no Internet', { timeout: 600000 }, async t => {
  if (await online()) { t.skip('Máy đang có Internet; chạy lệnh trong chú thích đầu file để cắt mạng.'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-lan-')), db = openDatabase(path.join(root, 'arena.sqlite'));
  const app = await createApp({ db, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(root, 'subs') },
    publicationOptions: { siteDir: path.join(root, 'site'), log: () => {} }, snapshotOptions: { dir: path.join(root, 'snapshots') } });
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`, { tournaments, submissions, publications, snapshots, ruleSets } = app.locals;
  try {
    const hash = await bcrypt.hash('password-12345', 4);
    db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin',?,'admin',0)").run(hash);
    for (const [id, name] of [[2, 'lan-a'], [3, 'lan-b']]) db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,?,'contestant',0)").run(id, name, hash);
    const law = ruleSets.get('ottv2-powerups');
    let tournament = tournaments.create(1, { name: 'Chung kết LAN', ruleSetId: law.id, ruleSetVersion: law.version, config: { swissRounds: 1, topN: 2 } });
    tournament = tournaments.replaceEntrants(tournament.id, 1, { expectedRevision: tournament.revision, userIds: [2, 3] });
    tournament = tournaments.stages.open(tournament.id, 1, { expectedRevision: tournament.revision, closesAt: Date.now() + 3600000 });
    const stageId = tournament.stages[0].id;
    submissions.start();
    // Team A logs in on the LAN portal and uploads its bot.
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'lan-a', password: 'password-12345' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0], { csrfToken } = await login.json();
    const form = new FormData(); form.append('bot', new Blob([await fs.readFile(path.join(__dirname, '../bots/python-greedy/main.py'))]), 'main.py');
    const uploaded = await fetch(`${base}/api/portal/stages/${stageId}/submissions`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken, 'Idempotency-Key': 'lan-final-upload-0001' }, body: form });
    assert.equal(uploaded.status, 202);
    // Team B's network failed: the organizer imports its C++ bot from a USB stick.
    const usb = path.join(root, 'usb'); await fs.mkdir(path.join(usb, 'lan-b', 'bot'), { recursive: true });
    await fs.writeFile(path.join(usb, 'lan-b', 'ott.json'), JSON.stringify({ language: 'cpp', entry: 'main.cpp' }));
    await fs.copyFile(path.join(__dirname, '../bots/cpp-greedy/main.cpp'), path.join(usb, 'lan-b', 'bot', 'main.cpp'));
    const { report } = await importFolder({ db, submissions, tournaments, stageId, dir: usb, actorId: 1, reason: 'Mạng đội B hỏng' });
    assert.equal(report[0].status, 'queued');
    await submissions.idle(300000);
    assert.deepEqual(db.prepare('SELECT origin,status FROM bot_submissions ORDER BY user_id').all().map(r => [r.origin, r.status]), [[null, 'Accepted'], ['usb', 'Accepted']]);
    const snapshot = await snapshots.snapshot();
    assert.equal(snapshot.submissions, 2);
    publications.publish(tournament.id, 1, { reason: 'Danh sách bot chung kết' }); await publications.building;
    assert.equal((await fetch(`${base}/site/manifest.json`)).status, 200);
    const check = await new Promise(resolve => execFile(process.execPath, [path.join(__dirname, '../scripts/offline-check.js')], { env: { ...process.env, HOST: '0.0.0.0', SNAPSHOT_DIR: snapshots.dir } }, (error, stdout) => resolve({ code: error?.code ?? 0, stdout })));
    assert.equal(check.code, 0, check.stdout); assert.match(check.stdout, /Không có Internet/); assert.doesNotMatch(check.stdout, /\[LỖI\]/);
    console.log(check.stdout.split('\n').filter(line => line.startsWith('[OK]')).join('\n'));
  } finally { server.closeAllConnections(); server.close(); await submissions.close(); await publications.close(); db.close(); await fs.rm(root, { recursive: true, force: true }); }
});
