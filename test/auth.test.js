const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { createUser } = require('../src/users');
const { attachLegacy } = require('../src/legacy');
const { seed } = require('../scripts/seed');

let db, server, base, detach, app, uploadRoot, time = Date.now();
const password = 'TestPassword-2026!';
before(async () => {
  db = openDatabase(':memory:');
  await createUser(db, { username: 'player', password, mustChangePassword: false });
  await createUser(db, { username: 'admin', password, role: 'admin' });
  uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-http-'));
  app = await createApp({ db, now: () => time, loginMax: 100, submissionOptions: { storageRoot: uploadRoot } });
  server = http.createServer(app);
  detach = attachLegacy(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  detach(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); await app.locals.submissions.close(); db.close();
  assert.equal(path.dirname(path.resolve(uploadRoot)), path.resolve(os.tmpdir())); assert.ok(path.basename(uploadRoot).startsWith('ott-http-'));
  fs.rmSync(uploadRoot, { recursive: true, force: true });
});
async function request(url, { cookie, csrf, body, ...options } = {}) {
  return fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...options.headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function login(username = 'player') {
  const response = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie').split(';')[0], data: await response.json(), header: response.headers.get('set-cookie') };
}

test('migrations are repeatable and data persists after reopening SQLite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-db-'));
  const file = path.join(dir, 'test.sqlite');
  let persisted = openDatabase(file);
  persisted.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES (?,?,?,?)').run('persisted', 'hash', 'contestant', 1);
  persisted.close(); persisted = openDatabase(file);
  assert.equal(persisted.prepare('SELECT COUNT(*) n FROM migrations').get().n, 5);
  assert.equal(persisted.prepare('SELECT username FROM users').get().username, 'persisted');
  persisted.close();
  for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
  fs.rmdirSync(dir);
});
test('passwords use bcrypt and enforce byte length', async () => {
  assert.match(db.prepare("SELECT password_hash FROM users WHERE username='player'").get().password_hash, /^\$2[aby]\$12\$/);
  await assert.rejects(createUser(db, { username: 'short', password: '123' }));
  await assert.rejects(createUser(db, { username: 'long', password: 'é'.repeat(37) }));
});
test('seed creates an admin and 20 contestants, then preserves existing passwords', async () => {
  const seeded = openDatabase(':memory:');
  try {
    const credentials = await seed(seeded);
    assert.equal(credentials.length, 21);
    assert.equal(seeded.prepare("SELECT COUNT(*) n FROM users WHERE role='contestant'").get().n, 20);
    assert.equal(seeded.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n, 1);
    assert.equal(new Set(credentials.map(row => row.password)).size, 21);
    const previous = seeded.prepare("SELECT password_hash FROM users WHERE username='admin'").get().password_hash;
    assert.deepEqual(await seed(seeded), []);
    assert.equal(seeded.prepare("SELECT password_hash FROM users WHERE username='admin'").get().password_hash, previous);
    assert.ok(await require('bcryptjs').compare(credentials[0].password, previous));
  } finally { seeded.close(); }
});
test('unauthenticated users cannot access either protected API', async () => {
  for (const url of ['/api/auth/me', '/api/portal/overview', '/api/admin/overview']) assert.equal((await request(url)).status, 401);
});
test('invalid password, unknown user and locked user return the same error', async () => {
  let expected;
  for (const [username, pass] of [['player', 'wrong'], ['unknown', password], ['admin', password]]) {
    if (username === 'admin') db.prepare("UPDATE users SET locked=1 WHERE username='admin'").run();
    const result = await request('/api/auth/login', { method: 'POST', body: { username, password: pass } });
    assert.equal(result.status, 401);
    const body = await result.json(); expected ||= body; assert.deepEqual(body, expected);
  }
  db.prepare("UPDATE users SET locked=0 WHERE username='admin'").run();
});
test('sessions have safe cookies, role isolation and no password leakage', async () => {
  const player = await login(); const admin = await login('admin');
  assert.match(player.header, /HttpOnly/); assert.match(player.header, /SameSite=Strict/);
  assert.ok(!JSON.stringify(player.data).includes('password'));
  assert.equal((await request('/api/admin/overview', player)).status, 403);
  assert.equal((await request('/api/portal/overview', admin)).status, 403);
  assert.equal((await request('/admin', player)).status, 403);
  assert.equal((await request('/portal', admin)).status, 403);
  const overview = await request('/api/admin/overview', admin);
  assert.equal((await overview.json()).contestants, 1);
  assert.equal((await request('/api/portal/overview', player)).status, 200);
  assert.ok(!db.prepare('SELECT token_hash FROM sessions').all().some(row => player.cookie.includes(row.token_hash)));
});
test('login rotates session; logout requires CSRF and revokes session', async () => {
  const initial = await login();
  const rotated = await request('/api/auth/login', { ...initial, method: 'POST', body: { username: 'player', password } });
  assert.equal(rotated.status, 200);
  assert.equal((await request('/api/auth/me', initial)).status, 401);
  const cookie = rotated.headers.get('set-cookie').split(';')[0]; const data = await rotated.json();
  assert.equal((await request('/api/auth/logout', { cookie, method: 'POST' })).status, 403);
  assert.equal((await request('/api/auth/logout', { cookie, csrf: data.csrfToken, method: 'POST' })).status, 200);
  assert.equal((await request('/api/auth/me', { cookie })).status, 401);
});
test('locking an account or expiring a session immediately removes access', async () => {
  const session = await login();
  db.prepare("UPDATE users SET locked=1 WHERE username='player'").run();
  assert.equal((await request('/api/auth/me', session)).status, 401);
  db.prepare("UPDATE users SET locked=0 WHERE username='player'").run();
  time += 8 * 60 * 60 * 1000 + 1;
  assert.equal((await request('/api/auth/me', session)).status, 401);
});
test('cross origin login and malformed JSON are rejected', async () => {
  assert.equal((await request('/api/auth/login', { method: 'POST', headers: { Origin: 'https://example.invalid' }, body: { username: 'player', password } })).status, 403);
  assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { username: {}, password } })).status, 400);
});
test('match APIs enforce admin role, CSRF and fixed sample bot selection', async () => {
  const player = await login(), admin = await login('admin');
  for (const url of ['/api/admin/matches', '/api/admin/matches/unknown', '/api/admin/sandbox']) {
    assert.equal((await request(url)).status, 401);
    assert.equal((await request(url, player)).status, 403);
  }
  assert.equal((await request('/api/admin/matches', admin)).status, 200);
  assert.equal((await request('/api/admin/matches/missing', admin)).status, 404);
  assert.equal((await request('/api/admin/matches', { ...admin, method: 'POST', body: { botA: 'python-greedy', botB: 'cpp-greedy', seed: 'test' } })).status, 403);
  assert.equal((await request('/api/admin/matches', { ...admin, csrf: admin.data.csrfToken, method: 'POST', body: { botA: '../../bad', botB: 'cpp-greedy', seed: 'test' } })).status, 400);
});
test('rate limit is shared across app instances and resets after the window', async () => {
  const limited = http.createServer(await createApp({ db, now: () => time, loginMax: 2 }));
  limited.listen(0, '127.0.0.1'); await once(limited, 'listening');
  const url = `http://127.0.0.1:${limited.address().port}/api/auth/login`;
  db.prepare('DELETE FROM login_limits').run();
  try {
    for (const expected of [401, 401, 429]) {
      assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'player', password: 'wrong' }) })).status, expected);
    }
    assert.equal(db.prepare("SELECT attempts FROM login_limits WHERE key='user:player'").get().attempts, 2);
    time += 900001;
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'player', password }) })).status, 200);
  } finally { limited.closeIdleConnections(); await new Promise(resolve => limited.close(resolve)); }
});
test('HTTPS configuration sets Secure cookies', async () => {
  const secure = http.createServer(await createApp({ db, secureCookies: true }));
  secure.listen(0, '127.0.0.1'); await once(secure, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${secure.address().port}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password })
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /; Secure/);
  } finally { secure.closeIdleConnections(); await new Promise(resolve => secure.close(resolve)); }
});
test('portal, admin, legacy pages and assets are available', async () => {
  for (const url of ['/portal', '/admin', '/assets/app.js', '/assets/style.css', '/legacy/', '/legacy/game.html', '/legacy/spectator.html', '/img/rock.png']) assert.equal((await request(url)).status, 200, url);
  assert.equal((await request('/api/health')).status, 200);
});
test('legacy WebSocket still starts a match and accepts a legal move', async () => {
  const url = base.replace('http:', 'ws:') + '/legacy/ws';
  const a = new WebSocket(url), b = new WebSocket(url);
  const receive = (ws, type) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', handler); reject(new Error(`Missing ${type}`)); }, 3000);
    const handler = data => { const message = JSON.parse(data); if (message.type === type) { clearTimeout(timer); ws.off('message', handler); resolve(message); } };
    ws.on('message', handler);
  });
  try {
    await Promise.all([once(a, 'open'), once(b, 'open')]);
    a.send('null'); a.send('[]'); a.send('{');
    const created = receive(a, 'room_created'); a.send(JSON.stringify({ type: 'create_room', playerName: 'A' }));
    const { roomId } = await created;
    const started = receive(a, 'game_start'); b.send(JSON.stringify({ type: 'join_room', roomId, playerName: 'B' }));
    const { game } = await started; assert.equal(game.currentTurn, 0);
    const invalid = receive(a, 'move_invalid');
    a.send(JSON.stringify({ type: 'move', fromRow: null, fromCol: 6, toRow: 0, toCol: 7 }));
    assert.match((await invalid).reason, /số nguyên/);
    const updated = receive(a, 'game_update');
    a.send(JSON.stringify({ type: 'move', fromRow: 0, fromCol: 6, toRow: 0, toCol: 7 }));
    assert.equal((await updated).game.moveCount, 1);
  } finally { a.terminate(); b.terminate(); }
});
test('multipart uploads enforce roles, CSRF, size/type limits and submission ownership', async () => {
  const player = await login(), admin = await login('admin');
  await createUser(db, { username: 'player2', password, mustChangePassword: false }); const other = await login('player2');
  const form = (filename='main.py', size=10, entry) => { const body = new FormData(); body.append('bot',new Blob([Buffer.alloc(size,32)]),filename); if (entry) body.append('entry',entry); return body; };
  const upload = (session, body, withCsrf=true) => fetch(base+'/api/portal/submissions',{method:'POST',headers:{...(session?{Cookie:session.cookie}:{}),...(session&&withCsrf?{'X-CSRF-Token':session.data.csrfToken}:{})},body});
  assert.equal((await upload(null,form())).status,401);
  assert.equal((await upload(admin,form())).status,403);
  assert.equal((await upload(player,form(),false)).status,403);
  assert.equal((await upload(player,form('bot.exe'))).status,400);
  assert.equal((await upload(player,form('main.py',1024*1024+1))).status,413);
  assert.equal((await upload(player,form('bot.zip',5*1024*1024+1))).status,413);
  const response=await upload(player,form('main.py',20,'main.py')); assert.equal(response.status,202);
  const submission=await response.json(); assert.equal(submission.status,'Queued');
  assert.equal((await request(`/api/portal/submissions/${submission.id}`,player)).status,200);
  assert.equal((await request(`/api/portal/submissions/${submission.id}`,other)).status,404);
  assert.equal((await request(`/api/portal/submissions/${submission.id}/tests/missing`,other)).status,404);
  assert.equal((await request(`/api/portal/submissions/${submission.id}/activate`,{...other,csrf:other.data.csrfToken,method:'POST'})).status,404);
  assert.equal((await request(`/api/portal/submissions/${submission.id}/activate`,{...player,csrf:player.data.csrfToken,method:'POST'})).status,409);
  assert.equal((await request('/api/portal/submissions',admin)).status,403);
  assert.equal((await request(`/data/submissions/${submission.id}/upload.bin`,player)).status,404);
});


test('admin account import, locking/reset revoke sessions and contestant cannot administer', async () => {
  const a = await login('admin'), p = await login();
  const adminOptions = { cookie:a.cookie, csrf:a.data.csrfToken, method:'POST' };
  assert.equal((await request('/api/admin/users', {cookie:p.cookie})).status,403);
  assert.equal((await request('/api/admin/monitor', {cookie:p.cookie})).status,403);
  assert.equal((await request('/api/admin/users/import',{...adminOptions,csrf:undefined,body:{csv:'username,password\nnewteam,'}})).status,403);
  let r=await request('/api/admin/users/import',{...adminOptions,body:{csv:'username,password\nnewteam,TestPassword-2026!'}});assert.equal(r.status,200);
  const u=db.prepare("SELECT id FROM users WHERE username='newteam'").get(), session=await login('newteam');
  r=await request('/api/admin/users/'+u.id+'/lock',{...adminOptions,body:{locked:true}});assert.equal(r.status,200);
  assert.equal((await request('/api/auth/me',{cookie:session.cookie})).status,401);
  await request('/api/admin/users/'+u.id+'/lock',{...adminOptions,body:{locked:false}});
  const old=await login('newteam');r=await request('/api/admin/users/'+u.id+'/reset',adminOptions);assert.equal(r.status,200);const fresh=await r.json();assert.ok(fresh.password.length>=12);
  assert.equal((await request('/api/auth/me',{cookie:old.cookie})).status,401);
  assert.equal((await request('/api/auth/login',{method:'POST',body:{username:'newteam',password}})).status,401);
  assert.equal((await request('/api/auth/login',{method:'POST',body:{username:'newteam',password:fresh.password}})).status,200);
  assert.equal((await request('/api/admin/users/'+a.data.user.id+'/reset',adminOptions)).status,404);
  const monitor=await (await request('/api/admin/monitor',{cookie:a.cookie})).json();assert.equal(monitor.worker.capacity,2);assert.ok(Array.isArray(monitor.jobs));
  assert.equal((await request('/api/admin/users/import',{...adminOptions,body:{csv:'username,password\nnewteam,'}})).status,400);
});
test('score and live APIs enforce admin role and require CSRF for mutations', async () => {
 const a=await login('admin'),p=await login();
 assert.equal((await request('/api/scores')).status,401);
 assert.equal((await request('/api/scores',{cookie:p.cookie})).status,200);
 for(const route of ['/api/admin/live','/api/admin/score-matches/missing','/api/admin/scores/missing/export','/api/admin/submissions/missing'])assert.equal((await request(route,{cookie:p.cookie})).status,403);
 assert.equal((await request('/api/admin/scores',{cookie:a.cookie,method:'POST',body:{}})).status,403);
 assert.equal((await request('/api/admin/scores',{cookie:p.cookie,csrf:p.data.csrfToken,method:'POST',body:{}})).status,403);
 assert.equal((await request('/api/admin/scores',{cookie:a.cookie,csrf:a.data.csrfToken,method:'POST',body:{seed:'s',gamesPerBot:2,gamesPerPair:2}})).status,400);
 assert.equal((await request('/api/admin/live',{cookie:a.cookie})).status,200);
});


test('first-login password change is enforced by API, rotates sessions and is required again after reset', async () => {
 const id=await createUser(db,{username:'firstlogin',password});
 const first=await login('firstlogin'),second=await login('firstlogin');
 assert.equal(first.data.user.mustChangePassword,true);
 for(const url of ['/api/portal/overview','/api/portal/submissions','/api/scores'])assert.equal((await request(url,{cookie:first.cookie})).status,403);
 const options={method:'POST',cookie:first.cookie,csrf:first.data.csrfToken},nextPassword='PersonalPassword-2026!';
 assert.equal((await request('/api/auth/password',{...options,csrf:undefined,body:{currentPassword:password,newPassword:nextPassword,confirmPassword:nextPassword}})).status,403);
 for(const body of [{currentPassword:password,newPassword:'short',confirmPassword:'short'},{currentPassword:password,newPassword:nextPassword,confirmPassword:'mismatch'},{currentPassword:password,newPassword:password,confirmPassword:password},{currentPassword:'wrong',newPassword:nextPassword,confirmPassword:nextPassword}])assert.equal((await request('/api/auth/password',{...options,body})).status,400);
 const changed=await request('/api/auth/password',{...options,body:{currentPassword:password,newPassword:nextPassword,confirmPassword:nextPassword}});assert.equal(changed.status,200);
 const cookie=changed.headers.get('set-cookie').split(';')[0],data=await changed.json();assert.equal(data.user.mustChangePassword,false);assert.notEqual(data.csrfToken,first.data.csrfToken);
 assert.equal((await request('/api/auth/me',{cookie:second.cookie})).status,401);assert.equal((await request('/api/auth/me',{cookie:first.cookie})).status,401);
 assert.equal((await request('/api/portal/overview',{cookie})).status,200);
 assert.equal((await request('/api/auth/login',{method:'POST',body:{username:'firstlogin',password}})).status,401);
 const relogin=await request('/api/auth/login',{method:'POST',body:{username:'firstlogin',password:nextPassword}});assert.equal(relogin.status,200);assert.equal((await relogin.json()).user.mustChangePassword,false);
 const admin=await login('admin');await request('/api/admin/users/'+id+'/reset',{method:'POST',cookie:admin.cookie,csrf:admin.data.csrfToken});
 assert.equal((await request('/api/auth/me',{cookie})).status,401);assert.equal(db.prepare('SELECT must_change_password FROM users WHERE id=?').get(id).must_change_password,1);
});
