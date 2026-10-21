const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { exportBundle, importBundle, TABLES } = require('../src/sync/bundle');
const { addPeer, connectionString } = require('../src/sync/routes');
const { DEFAULT_RULES } = require('../src/game/engine');
const { runMatch } = require('../src/game/match');
const { BotFault } = require('../src/game/protocol');

const bot = Buffer.from('import json\nimport sys\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({"request_id":r["request_id"],"move":r["legal_moves"][0]}))\n');
const fakeManager = () => ({ async check() { return { image: 'fake' }; }, async prepare(s) { return { ...s, image: 'fake', hash: 'h', compile_cpu_ms: 1 }; },
  async start() { return { async close() {}, async move(r) { return { cpu_ms: 1, stdout: JSON.stringify({ request_id: r.request_id, move: r.legal_moves[0] }) }; } }; }, async dispose() {} });
const play = async (game, { rules, onTurn }) => runMatch({ seed: game.seed, rules, bots: [{ id: 'a' }, { id: 'b' }], onTurn, choose: async (player, request) => {
  if ([game.player0, game.player1][player] > Math.min(game.player0, game.player1) && request.state.moveCount > 2) throw new BotFault('bot_crash');
  return { cpu_ms: 1, stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[0] }) };
} });
const PASS = 'mật khẩu chung kết 2026';
// Reports the first table and row that differ instead of dumping every table.
function same(a, b, label) {
  for (const name of Object.keys(a)) {
    const left = a[name], right = b[name], only = left.filter(row => !right.includes(row)), extra = right.filter(row => !left.includes(row));
    assert.ok(!only.length && !extra.length, `${label}: bảng ${name} khác (${left.length} vs ${right.length}); chỉ bên trái: ${only[0]?.slice(0, 400)}; chỉ bên phải: ${extra[0]?.slice(0, 400)}`);
  }
}
async function machine(root, name) {
  const db = openDatabase(path.join(root, `${name}.sqlite`));
  const app = await createApp({ db, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(root, `${name}-subs`), managerFactory: fakeManager, retryDelayMs: 0 },
    swissOptions: { play, retryDelayMs: 0 }, publicationOptions: { siteDir: path.join(root, `${name}-site`), log: () => {} } });
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (username, password = 'password-12345') => {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!response.ok) return null;
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: (await response.json()).csrfToken };
  };
  const post = (session, url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: session.cookie, 'X-CSRF-Token': session.csrf }, body: JSON.stringify(body) });
  const close = async () => { server.closeAllConnections(); server.close(); await app.locals.submissions.close(); await app.locals.swiss.close(); await app.locals.publications.close(); db.close(); };
  return { db, app, login, post, close, root: path.join(root, `${name}-subs`), authority: app.locals.authority };
}
const drain = async (db, table, runner) => { const end = Date.now() + 15000; while (runner.active || db.prepare(`SELECT 1 FROM ${table} WHERE status IN ('queued','running') LIMIT 1`).get()) { if (Date.now() > end) throw new Error(table); runner.pump(); await new Promise(r => setTimeout(r, 2)); } };
// Content of every synced table, without machine-local ids of log/publication rows.
const content = db => Object.fromEntries(TABLES.map(t => [t.name, db.prepare(`SELECT * FROM ${t.name}`).all().map(r => { const row = { ...r }; if (t.natural) delete row.id; for (const c of t.ignore || []) delete row[c]; return JSON.stringify(row, Object.keys(row).sort()); }).sort()]));

test('online → LAN (bootstrap + handover) → online round trip keeps data identical, enforces one writer and rejects bad bundles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-sync-')), usb = path.join(root, 'usb');
  const A = await machine(root, 'online'), B = await machine(root, 'lan');
  try {
    const hash = await bcrypt.hash('password-12345', 4);
    A.db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin',?,'admin',0)").run(hash);
    for (let id = 2; id <= 7; id++) { A.db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,?,'contestant',0)").run(id, `team${id}`, hash); A.db.prepare('INSERT INTO team_profiles VALUES (?,?,?,?,?)').run(id, `Đội ${id}`, 'x@example.com', '[]', 0); }
    A.db.prepare("INSERT INTO team_repos(user_id,full_name,verify_code,status,updated_at) VALUES (2,'team2/bot','OTT-x','pending',0)").run();
    const { tournaments, swiss, submissions } = A.app.locals;
    const law = A.app.locals.ruleSets.save({ userId: 1, name: 'Nhanh', rules: { ...DEFAULT_RULES, maxMoves: 8 } });
    const archived = A.app.locals.ruleSets.save({ userId: 1, name: 'Đã xóa trước đồng bộ', rules: DEFAULT_RULES });
    A.app.locals.ruleSets.remove(archived.id, archived.version, 1);
    let t = tournaments.create(1, { name: 'Giải đồng bộ', ruleSetId: law.id, ruleSetVersion: law.version, config: { swissRounds: 2, topN: 4 } });
    t = tournaments.replaceEntrants(t.id, 1, { expectedRevision: t.revision, userIds: [2, 3, 4, 5, 6, 7] });
    t = tournaments.stages.open(t.id, 1, { expectedRevision: t.revision, closesAt: Date.now() + 1500 });
    submissions.start();
    for (let id = 2; id <= 7; id++) await submissions.submit({ userId: id, stageId: t.stages[0].id, filename: 'main.py', buffer: bot });
    await submissions.idle(); await submissions.close();
    const practice = await submissions.submit({ userId: 2, filename: 'main.py', buffer: bot });
    await new Promise(r => setTimeout(r, 1600));
    t = tournaments.stages.lock(t.id, 1, { expectedRevision: t.revision, reason: 'hết hạn' });
    swiss.create(t.id, 1, { expectedRevision: t.revision, seed: 'sync' }); swiss.start(); await drain(A.db, 'swiss_games', swiss);
    A.app.locals.publications.publish(t.id, 1, { reason: 'Sau lượt 1' });
    const scope = `tournament:${t.id}`;

    // Pairing by pasting each other's connection string; passphrase and target checks.
    addPeer(A.db, A.authority, connectionString(B.authority.identity()), 1); addPeer(B.db, B.authority, connectionString(A.authority.identity()), null);
    assert.throws(() => addPeer(A.db, A.authority, connectionString(A.authority.identity()), 1), /chính máy này/);
    const lanId = B.authority.nodeId(), onlineId = A.authority.nodeId();
    await assert.rejects(exportBundle({ db: A.db, authority: A.authority, submissionsRoot: A.root, peerId: lanId, dir: usb, passphrase: 'ngắn' }), /12 ký tự/);
    const out = await exportBundle({ db: A.db, authority: A.authority, submissionsRoot: A.root, peerId: lanId, dir: usb, passphrase: PASS, kind: 'full', handovers: ['system', scope], actorId: 1 });
    assert.ok(out.blobs > 0 && out.records > 50);

    // The online machine is now read-only for the handed-over data.
    assert.equal(A.authority.owns(scope), false); assert.equal(A.authority.owns('system'), false);
    await assert.rejects(A.app.locals.submissions.submit({ userId: 3, filename: 'main.py', buffer: bot }), error => error.status === 409);
    assert.equal(A.app.locals.submissions.claim(), undefined, 'queued practice submission is not checked on the read-only copy');
    const adminA = await A.login('admin');
    const blocked = await A.post(adminA, `/api/admin/tournaments/${t.id}/swiss/next`, { expectedRevision: 1 });
    assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'read_only');
    assert.equal((await A.post(await A.login('team3'), '/api/auth/password', { currentPassword: 'password-12345', newPassword: 'abcdefghijkl1', confirmPassword: 'abcdefghijkl1' })).status, 409);

    // LAN machine starts from an empty database and is seeded by the full bundle.
    const seeded = await importBundle({ db: B.db, authority: B.authority, submissionsRoot: B.root, dir: out.path, passphrase: PASS });
    assert.equal(seeded.bootstrap, true); assert.deepEqual(seeded.conflicts, []);
    same(content(A.db), content(B.db), 'LAN copy identical to online');
    assert.ok(B.authority.owns(scope) && B.authority.owns('system'));
    assert.ok(fsSync.existsSync(path.join(B.root, practice.id, 'upload.bin')));
    const sub = A.db.prepare('SELECT id FROM bot_submissions WHERE stage_id=? LIMIT 1').get(t.stages[0].id).id;
    assert.ok(fsSync.existsSync(path.join(B.root, sub, 'artifact', 'main.py')));
    assert.ok(await B.login('team2'), 'contestants log in on the LAN with their existing password');
    assert.equal((await importBundle({ db: B.db, authority: B.authority, submissionsRoot: B.root, dir: out.path, passphrase: PASS })).duplicate, true);

    // Final day on the LAN: finish the Swiss stage, check the queued practice bot, change a password, delete a repo claim, publish.
    B.app.locals.submissions.start(); await B.app.locals.submissions.idle(); await B.app.locals.submissions.close();
    assert.equal(B.db.prepare('SELECT status FROM bot_submissions WHERE id=?').get(practice.id).status, 'Accepted');
    const swissB = B.app.locals.swiss; swissB.start();
    swissB.next(t.id, 1, { expectedRevision: swissB.get(t.id).revision }); await drain(B.db, 'swiss_games', swissB);
    assert.equal((await B.post(await B.login('team3'), '/api/auth/password', { currentPassword: 'password-12345', newPassword: 'abcdefghijkl1', confirmPassword: 'abcdefghijkl1' })).status, 200);
    B.db.prepare('DELETE FROM team_repos WHERE user_id=2').run();
    B.app.locals.publications.publish(t.id, 1, { reason: 'Chung kết LAN' });
    const back = await exportBundle({ db: B.db, authority: B.authority, submissionsRoot: B.root, peerId: onlineId, dir: usb, passphrase: PASS, kind: 'incremental', handovers: ['system', scope] });
    assert.ok(back.records < out.records, 'incremental bundle carries only changes');

    // Tampering, wrong passphrase, unknown sender and wrong target are refused before anything is written.
    const copy = path.join(root, 'tampered'); await fs.cp(back.path, copy, { recursive: true });
    const chunk = path.join(copy, 'chunks', 'data-001.enc'), bytes = await fs.readFile(chunk); bytes[bytes.length - 1] ^= 1; await fs.writeFile(chunk, bytes);
    await assert.rejects(importBundle({ db: A.db, authority: A.authority, submissionsRoot: A.root, dir: copy, passphrase: PASS }), /mã băm/);
    const manifest = JSON.parse(await fs.readFile(path.join(back.path, 'manifest.json'))); await fs.cp(back.path, path.join(root, 'forged'), { recursive: true });
    await fs.writeFile(path.join(root, 'forged', 'manifest.json'), JSON.stringify({ ...manifest, handovers: [] }));
    await assert.rejects(importBundle({ db: A.db, authority: A.authority, submissionsRoot: A.root, dir: path.join(root, 'forged'), passphrase: PASS }), /Chữ ký/);
    await assert.rejects(importBundle({ db: A.db, authority: A.authority, submissionsRoot: A.root, dir: back.path, passphrase: 'sai passphrase rồi nhé' }), /Sai passphrase/);
    const C = await machine(root, 'stranger');
    try { await assert.rejects(importBundle({ db: C.db, authority: C.authority, submissionsRoot: C.root, dir: back.path, passphrase: PASS }), /chưa được tin cậy/); } finally { await C.close(); }
    assert.equal(A.db.prepare("SELECT COUNT(*) n FROM sync_bundles WHERE direction='import'").get().n, 0);

    // Back online: results, password change and deletion arrive; authority returns; same bundle twice changes nothing.
    const applied = await importBundle({ db: A.db, authority: A.authority, submissionsRoot: A.root, dir: back.path, passphrase: PASS });
    assert.equal(applied.bootstrap, false); assert.deepEqual(applied.conflicts, []); assert.ok(applied.updated > 0 && applied.deleted === 1);
    same(content(A.db), content(B.db), 'online equals LAN after the final');
    assert.ok(A.authority.owns(scope) && A.authority.owns('system') && !B.authority.owns(scope));
    assert.ok(await A.login('team3', 'abcdefghijkl1'));
    assert.equal(A.db.prepare('SELECT COUNT(*) n FROM publications WHERE tournament_id=?').get(t.id).n, 2);
    assert.equal((await importBundle({ db: A.db, authority: A.authority, submissionsRoot: A.root, dir: back.path, passphrase: PASS })).duplicate, true);
    same(content(A.db), content(B.db), 'after duplicate import');

    // A machine that no longer holds authority cannot push changes: they are reported, not applied.
    B.db.prepare("UPDATE users SET locked=1 WHERE username='team4'").run();
    const stale = await exportBundle({ db: B.db, authority: B.authority, submissionsRoot: B.root, peerId: onlineId, dir: usb, passphrase: PASS, kind: 'incremental' });
    const refused = await importBundle({ db: A.db, authority: A.authority, submissionsRoot: A.root, dir: stale.path, passphrase: PASS });
    assert.equal(refused.updated, 0); assert.equal(refused.conflicts[0].table, 'users');
    assert.equal(A.db.prepare("SELECT locked FROM users WHERE username='team4'").get().locked, 0);
  } finally { await A.close(); await B.close(); await fs.rm(root, { recursive: true, force: true }); }
});
