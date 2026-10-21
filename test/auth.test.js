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
async function login(username = 'player', loginPassword = password) {
  const response = await request('/api/auth/login', { method: 'POST', body: { username, password: loginPassword } });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie').split(';')[0], data: await response.json(), header: response.headers.get('set-cookie') };
}
test('admin deletion revokes access, removes choices, cancels pending jobs and preserves history',async()=>{
 const user=await createUser(db,{username:'delete-me',password,mustChangePassword:false});
 const uid=db.prepare("SELECT id FROM users WHERE username='delete-me'").get().id;
 const owner=await login('delete-me'),administrator=await login('admin'),player=await login();
 const options={method:'DELETE',cookie:administrator.cookie,csrf:administrator.data.csrfToken,body:{username:'delete-me'}};
 const url=`/api/admin/users/${uid}`;
 assert.equal((await request(url,{...options,cookie:player.cookie,csrf:player.data.csrfToken})).status,403);
 assert.equal((await request(url,{...options,csrf:null})).status,403);
 assert.equal((await request(url,{...options,body:{username:'wrong'}})).status,400);
 const accepted='33333333-3333-3333-3333-333333333333',pending='44444444-4444-4444-4444-444444444444';
 for(const [id,version,status,job]of [[accepted,1,'Accepted','done'],[pending,2,'Queued','running']])db.prepare("INSERT INTO bot_submissions(id,user_id,version,filename,entry,language,status,job_status,created_at,updated_at) VALUES (?,?,?,'main.py','main.py','python',?,?,0,0)").run(id,uid,version,status,job);
 db.prepare('INSERT INTO active_bots VALUES (?,?)').run(uid,accepted);
 assert.equal((await request(url,options)).status,409);assert.equal(db.prepare('SELECT deleted_at FROM users WHERE id=?').get(uid).deleted_at,null);
 db.prepare("UPDATE bot_submissions SET job_status='queued' WHERE id=?").run(pending);
 assert.equal((await request(url,options)).status,200);
 assert.equal((await request('/api/auth/me',{cookie:owner.cookie})).status,401);
 assert.equal((await request('/api/auth/login',{method:'POST',body:{username:'delete-me',password}})).status,401);
 const listed=await (await request('/api/admin/users',{cookie:administrator.cookie})).json();assert.ok(!listed.users.some(u=>u.id===uid));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM bot_submissions WHERE user_id=?').get(uid).n,2);
 assert.equal(db.prepare('SELECT status FROM bot_submissions WHERE id=?').get(accepted).status,'Accepted');
 assert.equal(db.prepare('SELECT reason_code FROM bot_submissions WHERE id=?').get(pending).reason_code,'account_deleted');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM active_bots WHERE user_id=?').get(uid).n,0);
 assert.ok(!app.locals.matches.botChoices().some(b=>b.userId===uid));
 assert.throws(()=>app.locals.matches.resolveBot('submission:'+accepted));
 assert.throws(()=>app.locals.submissions.activate(accepted,uid),e=>e.status===403);
 await assert.rejects(app.locals.submissions.submit({userId:uid,filename:'main.py',buffer:Buffer.from('print(1)')}),e=>e.status===403);
 assert.equal((await request(url,options)).status,404);
 assert.equal((await request(url+'/lock',{...options,method:'POST',body:{locked:false}})).status,404);
 assert.equal((await request(`/api/admin/users/${administrator.data.user.id}`,{...options,body:{username:'admin'}})).status,404);
});
test('map preview validates rules without creating a stored version',async()=>{
 const administrator=await login('admin'),player=await login();const options={method:'POST',cookie:administrator.cookie,csrf:administrator.data.csrfToken,body:{rules:require('../rules/default.json')}};
 const count=db.prepare('SELECT COUNT(*) n FROM rule_versions').get().n;
 assert.equal((await request('/api/admin/rule-sets/preview',{...options,cookie:player.cookie,csrf:player.data.csrfToken})).status,403);
 assert.equal((await request('/api/admin/rule-sets/preview',{...options,csrf:null})).status,403);
 const response=await request('/api/admin/rule-sets/preview',options);assert.equal(response.status,200);assert.equal((await response.json()).state.board.length,9);
 assert.equal((await request('/api/admin/rule-sets/preview',{...options,body:{rules:{...options.body.rules,blockedCells:[[0,8]]}}})).status,400);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM rule_versions').get().n,count);
});

test('migrations are repeatable and data persists after reopening SQLite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-db-'));
  const file = path.join(dir, 'test.sqlite');
  let persisted = openDatabase(file);
  persisted.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES (?,?,?,?)').run('persisted', 'hash', 'contestant', 1);
  persisted.close(); persisted = openDatabase(file);
  assert.equal(persisted.prepare('SELECT COUNT(*) n FROM migrations').get().n, 22);
  assert.equal(persisted.prepare('SELECT username FROM users').get().username, 'persisted');
  persisted.close();
  for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
  fs.rmdirSync(dir);
});
test('passwords use scrypt and enforce byte length', async () => {
  assert.match(db.prepare("SELECT password_hash FROM users WHERE username='player'").get().password_hash, /^scrypt\$32768\$8\$3\$/);
  await assert.rejects(createUser(db, { username: 'short', password: '123' }));
  await assert.rejects(createUser(db, { username: 'long', password: 'é'.repeat(37) }));
  await assert.rejects(createUser(db, { username: 'other-admin', password: 'admin', role: 'admin' }));
  await assert.rejects(createUser(db, { username: 'admin', password: 'short', role: 'admin' }));
});
test('seed creates an admin and 20 contestants, then preserves existing passwords', async () => {
  const seeded = openDatabase(':memory:');
  try {
    const credentials = await seed(seeded);
    assert.equal(credentials.length, 21);
    assert.deepEqual(credentials.find(row => row.role === 'admin'), { username: 'admin', password: 'admin', role: 'admin' });
    assert.equal(seeded.prepare("SELECT COUNT(*) n FROM users WHERE role='contestant'").get().n, 20);
    assert.equal(seeded.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n, 1);
    assert.equal(new Set(credentials.map(row => row.password)).size, 21);
    const previous = seeded.prepare("SELECT password_hash FROM users WHERE username='admin'").get().password_hash;
    assert.deepEqual(await seed(seeded), []);
    assert.equal(seeded.prepare("SELECT password_hash FROM users WHERE username='admin'").get().password_hash, previous);
    assert.ok(await require('../src/passwords').verifyPassword(credentials[0].password, previous));
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
test('login behind a local HTTPS proxy accepts its https Origin', async () => {
  const origin = base.replace('http://', 'https://');
  assert.equal((await request('/api/auth/login', { method: 'POST', headers: { Origin: origin, 'X-Forwarded-Proto': 'https' }, body: { username: 'player', password } })).status, 200);
  assert.equal((await request('/api/auth/login', { method: 'POST', headers: { Origin: origin }, body: { username: 'player', password } })).status, 403);
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
    // Many teams behind one IP (computer room, Cloudflare Tunnel): successful logins never use up the IP's allowance.
    db.prepare('DELETE FROM login_limits').run();
    for (let i = 0; i < 30; i++) assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: i % 2 ? 'player' : 'admin', password }) })).status, 200, `lần ${i + 1}`);
    assert.equal(db.prepare("SELECT COALESCE(SUM(attempts),0) n FROM login_limits").get().n, 0);
    // Failures still count: per account at loginMax, per IP at 10× loginMax.
    for (let i = 0; i < 20; i++) await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `khong-co-${i}`, password: 'wrong' }) });
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'player', password }) })).status, 429);
  } finally { limited.closeIdleConnections(); await new Promise(resolve => limited.close(resolve)); }
});
test('successful logins on a shared LAN do not consume failure limits or erase other failures', async () => {
  const limited = http.createServer(await createApp({ db, now: () => time, loginMax: 2, loginIpMax: 4 }));
  limited.listen(0, '127.0.0.1'); await once(limited, 'listening');
  const url = `http://127.0.0.1:${limited.address().port}/api/auth/login`;
  const attempt = (username, value = password) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: value }) });
  db.prepare('DELETE FROM login_limits').run();
  try {
    assert.equal((await attempt('player', 'wrong')).status, 401);
    for (let i = 0; i < 8; i++) assert.equal((await attempt(i % 2 ? 'player' : 'admin')).status, 200);
    assert.equal(db.prepare("SELECT attempts FROM login_limits WHERE key='user:player'").get().attempts, 1);
    assert.equal(db.prepare("SELECT attempts FROM login_limits WHERE key LIKE 'ip:%'").get().attempts, 1);
    assert.equal((await attempt('player', 'wrong')).status, 401);
    assert.equal((await attempt('player')).status, 429);
    assert.equal((await attempt('admin')).status, 200);
  } finally { db.prepare('DELETE FROM login_limits').run(); limited.closeIdleConnections(); await new Promise(resolve => limited.close(resolve)); }
});

test('IP failure budget blocks username spraying with remaining Retry-After and ignores forwarded headers', async () => {
  const limited = http.createServer(await createApp({ db, now: () => time, loginMax: 2, loginIpMax: 3 }));
  limited.listen(0, '127.0.0.1'); await once(limited, 'listening');
  const url = `http://127.0.0.1:${limited.address().port}/api/auth/login`;
  const attempt = username => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${username.length}` }, body: JSON.stringify({ username, password: 'wrong' }) });
  db.prepare('DELETE FROM login_limits').run();
  try {
    for (const name of ['missing-a', 'missing-bb', 'missing-ccc']) assert.equal((await attempt(name)).status, 401);
    time += 120000;
    const blocked = await attempt('missing-dddd');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('Retry-After'), '780');
    assert.equal((await blocked.json()).retryAfter, 780);
    time += 780001;
    assert.equal((await attempt('missing-eeeee')).status, 401);
  } finally { db.prepare('DELETE FROM login_limits').run(); limited.closeIdleConnections(); await new Promise(resolve => limited.close(resolve)); }
});

test('concurrent failed logins across app instances cannot exceed the reserved account budget', async () => {
  const servers = [];
  db.prepare('DELETE FROM login_limits').run();
  try {
    for (let i = 0; i < 2; i++) {
      const instance = http.createServer(await createApp({ db, now: () => time, loginMax: 2 }));
      instance.listen(0, '127.0.0.1'); await once(instance, 'listening'); servers.push(instance);
    }
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => fetch(`http://127.0.0.1:${servers[i % 2].address().port}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'player', password: 'wrong' })
    })));
    assert.equal(responses.filter(r => r.status === 401).length, 2);
    assert.equal(responses.filter(r => r.status === 429).length, 4);
    assert.equal(db.prepare("SELECT attempts FROM login_limits WHERE key='user:player'").get().attempts, 2);
  } finally { db.prepare('DELETE FROM login_limits').run(); for (const instance of servers) { instance.closeIdleConnections(); await new Promise(resolve => instance.close(resolve)); } }
});

test('trusted proxy uses client IP boundaries, configured Origin and Secure cookies', async () => {
  const proxied = http.createServer(await createApp({ db, now: () => time, trustedProxies: '127.0.0.1', publicOrigin: 'https://arena.example', secureCookies: true, loginMax: 20, loginIpMax: 1 }));
  proxied.listen(0, '127.0.0.1'); await once(proxied, 'listening');
  const url = `http://127.0.0.1:${proxied.address().port}/api/auth/login`;
  const attempt = (headers = {}, value = 'wrong') => fetch(url, { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: 'https://arena.example', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.10', ...headers
  }, body: JSON.stringify({ username: 'player', password: value }) });
  db.prepare('DELETE FROM login_limits').run();
  try {
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
    // The first untrusted address from the right is the client, not attacker-supplied left entries.
    assert.equal((await attempt({ 'X-Forwarded-For': '203.0.113.99, 192.0.2.11' })).status, 401);
    assert.ok(db.prepare("SELECT 1 FROM login_limits WHERE key='ip:192.0.2.11'").get());
    assert.equal(db.prepare("SELECT 1 FROM login_limits WHERE key='ip:203.0.113.99'").get(), undefined);
    const valid = await attempt({ 'X-Forwarded-For': '192.0.2.12' }, password);
    assert.equal(valid.status, 200);
    assert.match(valid.headers.get('set-cookie'), /; Secure/);
    assert.match(valid.headers.get('set-cookie'), /; HttpOnly/);
    assert.match(valid.headers.get('set-cookie'), /; SameSite=Strict/);
    for (const Origin of ['https://evil.example', 'null', 'http://arena.example']) assert.equal((await attempt({ Origin })).status, 403);
    assert.equal((await attempt({ Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example', Host: 'evil.example' })).status, 403);
    assert.equal((await attempt({ 'X-Forwarded-Proto': 'http' })).status, 400);
    assert.equal((await attempt({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  } finally { db.prepare('DELETE FROM login_limits').run(); proxied.closeIdleConnections(); await new Promise(resolve => proxied.close(resolve)); }
});

test('untrusted socket cannot spoof HTTPS or client IP through forwarded headers', async () => {
  const untrusted = http.createServer(await createApp({ db, trustedProxies: '192.0.2.1', publicOrigin: 'https://arena.example', secureCookies: true }));
  untrusted.listen(0, '127.0.0.1'); await once(untrusted, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${untrusted.address().port}/api/auth/login`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: 'https://arena.example', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.20'
    }, body: JSON.stringify({ username: 'player', password }) });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(db.prepare("SELECT 1 FROM login_limits WHERE key='ip:192.0.2.20'").get(), undefined);
  } finally { untrusted.closeIdleConnections(); await new Promise(resolve => untrusted.close(resolve)); }
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
  const u=db.prepare("SELECT id FROM users WHERE username='newteam'").get(), session=await login('newteam','newteam');
  assert.equal(session.data.user.mustChangePassword,true);
  assert.equal((await request('/api/portal/overview',{cookie:session.cookie})).status,403);
  r=await request('/api/admin/users/'+u.id+'/lock',{...adminOptions,body:{locked:true}});assert.equal(r.status,200);
  assert.equal((await request('/api/auth/me',{cookie:session.cookie})).status,401);
  await request('/api/admin/users/'+u.id+'/lock',{...adminOptions,body:{locked:false}});
  const old=await login('newteam','newteam');r=await request('/api/admin/users/'+u.id+'/reset',adminOptions);assert.equal(r.status,200);const fresh=await r.json();assert.ok(fresh.password.length>=12);
  assert.equal((await request('/api/auth/me',{cookie:old.cookie})).status,401);
  assert.equal((await request('/api/auth/login',{method:'POST',body:{username:'newteam',password}})).status,401);
  assert.equal((await request('/api/auth/login',{method:'POST',body:{username:'newteam',password:fresh.password}})).status,200);
  assert.equal((await request('/api/admin/users/'+a.data.user.id+'/reset',adminOptions)).status,404);
  const monitor=await (await request('/api/admin/monitor',{cookie:a.cookie})).json();assert.equal(monitor.worker.capacity,2);assert.ok(Array.isArray(monitor.jobs));
  assert.equal((await request('/api/admin/users/import',{...adminOptions,body:{csv:'username,password\nnewteam,'}})).status,400);
});
test('score and live APIs enforce admin role and require CSRF for mutations', async () => {
 const a=await login('admin'),p=await login();
 assert.equal((await request('/api/admin/score-plan')).status,401);
 assert.equal((await request('/api/admin/score-plan',{cookie:p.cookie})).status,403);
 const plan=await request('/api/admin/score-plan',{cookie:a.cookie});assert.equal(plan.status,200);assert.equal(typeof (await plan.json()).canStart,'boolean');
 assert.equal((await request('/api/admin/score-plan?gamesPerPair=5',{cookie:a.cookie})).status,200);
 for(const games of ['0','21','1.5','nope'])assert.equal((await request('/api/admin/score-plan?gamesPerPair='+games,{cookie:a.cookie})).status,400);
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


test('rule-set APIs isolate admin permissions, enforce CSRF and versioning',async()=>{
 const a=await login('admin'),p=await login(),opts={cookie:a.cookie,csrf:a.data.csrfToken,method:'POST'};
 assert.equal((await request('/api/admin/rule-sets')).status,401);assert.equal((await request('/api/admin/rule-sets',{cookie:p.cookie})).status,403);
 const base=require('../rules/default.json');
 assert.equal((await request('/api/admin/rule-sets',{...opts,csrf:undefined,body:{name:'test',rules:base}})).status,403);
 let response=await request('/api/admin/rule-sets',{...opts,body:{name:'HTTP law',rules:{...base,maxMoves:8}}});assert.equal(response.status,201);const first=await response.json();
 response=await request('/api/admin/rule-sets/'+first.id+'/versions',{...opts,body:{name:'HTTP renamed',rules:{...base,maxMoves:16},expectedVersion:1}});assert.equal(response.status,201);
 const historical=await (await request('/api/admin/rule-sets/'+first.id+'?version=1',{cookie:a.cookie})).json();assert.equal(historical.rules.maxMoves,8);
 response=await request('/api/admin/rule-sets/'+first.id+'/clone',{...opts,body:{name:'copy',version:1}});assert.equal(response.status,404);
 assert.equal((await request('/api/admin/rule-sets/'+first.id+'/versions',{...opts,body:{name:'stale',rules:base,expectedVersion:1}})).status,409);
 assert.equal((await request('/api/admin/rule-sets',{...opts,body:{name:'bad',rules:{...base,engine:'unknown'}}})).status,400);
});

test('tournament APIs enforce admin role, CSRF, revision checks and isolated rosters', async () => {
  const administrator = await login('admin'), player = await login();
  const root = '/api/admin/tournaments';
  const options = { cookie: administrator.cookie, csrf: administrator.data.csrfToken };
  assert.equal((await request(root)).status, 401);
  assert.equal((await request(root, { cookie: player.cookie })).status, 403);
  assert.equal((await request(root, { method: 'POST', cookie: administrator.cookie, body: { name: 'Denied' } })).status, 403);
  assert.equal((await request(root, { method: 'POST', cookie: player.cookie, csrf: player.data.csrfToken, body: { name: 'Denied' } })).status, 403);
  const created = await request(root, { ...options, method: 'POST', body: { name: 'HTTP Swiss' } });
  assert.equal(created.status, 201);
  const tournament = await created.json(), url = `${root}/${tournament.id}`;
  assert.equal(tournament.config.format, 'swiss');
  for (const method of ['GET', 'PATCH', 'PUT']) {
    const target = method === 'PUT' ? url + '/entrants' : url;
    assert.equal((await request(target, { method, cookie: player.cookie, csrf: player.data.csrfToken, ...(method === 'GET' ? {} : { body: {} }) })).status, 403);
  }
  assert.equal((await request(url, { ...options, csrf: undefined, method: 'PATCH', body: { name: 'Denied' } })).status, 403);
  assert.equal((await request(url + '/entrants', { ...options, csrf: undefined, method: 'PUT', body: { userIds: [] } })).status, 403);
  assert.equal((await request(url, { ...options, method: 'PATCH', body: { expectedRevision: 1, config: { maxTeams: 16, swissRounds: 4 } } })).status, 200);
  assert.equal((await request(url, { ...options, method: 'PATCH', body: { expectedRevision: 1, name: 'stale' } })).status, 409);
  const roster = await request(url + '/entrants', { ...options, method: 'PUT', body: { expectedRevision: 2, userIds: [player.data.user.id] } });
  assert.equal(roster.status, 200); assert.equal((await roster.json()).entrants.length, 1);
  assert.equal((await request(url, { cookie: administrator.cookie })).status, 200);
  assert.equal((await request(root + '?page=-1', options)).status, 400);
  assert.equal((await request(root + '/missing', options)).status, 404);
  assert.equal((await request(root + '/missing', { ...options, method: 'PATCH', body: { expectedRevision: 1 } })).status, 404);
  assert.equal((await request(root + '/missing/entrants', { ...options, method: 'PUT', body: { expectedRevision: 1, userIds: [] } })).status, 404);
  assert.equal((await request(root, { ...options, method: 'POST', body: { name: 'bad', config: { format: 'elo' } } })).status, 400);
});

test('stage intake APIs enforce membership, deadlines, CSRF and receipt idempotency', async () => {
  const administrator = await login('admin'), player = await login(), other = await login('player2');
  const opts = { cookie: administrator.cookie, csrf: administrator.data.csrfToken, method: 'POST' };
  let response = await request('/api/admin/tournaments', { ...opts, body: { name: 'HTTP intake' } });
  const created = await response.json();
  response = await request(`/api/admin/tournaments/${created.id}/entrants`, { ...opts, method: 'PUT', body: { expectedRevision: 1, userIds: [player.data.user.id, other.data.user.id] } });
  assert.equal(response.status, 200);
  const root = `/api/admin/tournaments/${created.id}`;
  const bracketBody = { expectedRevision: created.revision, reason: 'Checked' };
  assert.equal((await request(root + '/final-rule')).status, 401);
  assert.equal((await request(root + '/final-rule', { cookie: player.cookie })).status, 403);
  assert.equal((await request(root + '/final-rule', { ...opts, csrf: null, body: bracketBody })).status, 403);
  assert.equal((await request(root + '/final-rule', { method: 'POST', cookie: player.cookie, csrf: player.data.csrfToken, body: bracketBody })).status, 403);
  assert.equal((await request(root + '/cancel', { ...opts, csrf: null, body: bracketBody })).status, 403);
  assert.equal((await request(root + '/cancel', { method: 'POST', cookie: player.cookie, csrf: player.data.csrfToken, body: bracketBody })).status, 403);
  assert.equal((await request(root + '/final-intake')).status, 401);
  assert.equal((await request(root + '/final-intake', { cookie: player.cookie })).status, 403);
  for (const operation of ['open', 'close', 'lock']) {
    assert.equal((await request(root + '/final-intake/' + operation, { ...opts, csrf: null, body: bracketBody })).status, 403);
    assert.equal((await request(root + '/final-intake/' + operation, { method: 'POST', cookie: player.cookie, csrf: player.data.csrfToken, body: bracketBody })).status, 403);
  }
  assert.equal((await request(root + '/bracket')).status, 401);
  assert.equal((await request(root + '/bracket', { cookie: player.cookie })).status, 403);
  assert.equal((await request(root + '/bracket', { ...opts, csrf: null, body: bracketBody })).status, 403);
  assert.equal((await request(root + '/bracket', { method: 'POST', cookie: player.cookie, csrf: player.data.csrfToken, body: bracketBody })).status, 403);
  assert.equal((await request(root + '/bracket', { ...opts, body: bracketBody })).status, 409);
  for (const operation of ['start', 'publish', 'schedule', 'pause', 'resume', 'cancel']) {
    assert.equal((await request(root + '/bracket/' + operation, { ...opts, csrf: null, body: bracketBody })).status, 403);
    assert.equal((await request(root + '/bracket/' + operation, { method: 'POST', cookie: player.cookie, csrf: player.data.csrfToken, body: bracketBody })).status, 403);
  }
  assert.equal((await request('/api/admin/bracket-games/missing', { cookie: player.cookie })).status, 403);
  assert.equal((await request('/api/admin/bracket-games/missing/retry', { ...opts, csrf: null, body: { reason: 'test' } })).status, 403);
  const openBody = { expectedRevision: 2, opensAt: time - 1000, closesAt: time + 10000 };
  assert.equal((await request(root + '/open', { ...opts, csrf: null, body: openBody })).status, 403);
  assert.equal((await request(root + '/open', { method: 'POST', cookie: player.cookie, csrf: player.data.csrfToken, body: openBody })).status, 403);
  response = await request(root + '/open', { ...opts, body: openBody }); assert.equal(response.status, 200);
  const opened = await response.json(), stageId = opened.stages[0].id;
  const url = `/api/portal/stages/${stageId}/submissions`;
  assert.equal((await request('/api/portal/tournaments')).status, 401);
  assert.equal((await request('/api/portal/tournaments', { cookie: administrator.cookie })).status, 403);
  assert.equal((await request('/api/portal/stages/missing/submissions', { cookie: player.cookie })).status, 404);
  assert.ok((await (await request('/api/portal/tournaments', { cookie: player.cookie })).json()).stages.some(s => s.id === stageId));
  const form = () => { const body = new FormData(); body.append('bot', new Blob(['print(1)']), 'main.py'); return body; };
  const upload = (key, csrf = player.data.csrfToken) => fetch(base + url, { method: 'POST', headers: { Cookie: player.cookie, ...(csrf ? { 'X-CSRF-Token': csrf } : {}), 'Idempotency-Key': key }, body: form() });
  assert.equal((await upload('http-receipt-000001', null)).status, 403);
  response = await upload('http-receipt-000001'); assert.equal(response.status, 202); const first = await response.json();
  assert.equal(first.stage_id, stageId);
  const closed = await request(root + '/close', { ...opts, body: { expectedRevision: opened.revision, reason: 'Đóng cửa sổ thử' } });
  assert.equal(closed.status, 200); const state = await closed.json();
  response = await upload('http-receipt-000001'); assert.equal(response.status, 202); assert.equal((await response.json()).id, first.id);
  assert.equal((await upload('http-receipt-000002')).status, 409);
  assert.equal((await request(root + '/lock', { ...opts, body: { expectedRevision: state.revision, reason: 'Còn hàng đợi' } })).status, 409);
  const legacy = await (await request('/api/portal/submissions', { cookie: player.cookie })).json();
  assert.ok(legacy.submissions.every(s => s.id !== first.id));
});

test('Swiss APIs enforce organizer permissions and expose only participant standings', async () => {
  const administrator = await login('admin'), player = await login(), other = await login('player2');
  const options = { cookie: administrator.cookie, csrf: administrator.data.csrfToken, method: 'POST' };
  const created = await (await request('/api/admin/tournaments', { ...options, body: { name: 'HTTP Swiss', config: { swissRounds: 1, maxTeams: 2, topN: 2 } } })).json();
  const root = `/api/admin/tournaments/${created.id}`;
  await request(root + '/entrants', { ...options, method: 'PUT', body: { expectedRevision: 1, userIds: [player.data.user.id, other.data.user.id] } });
  let tournament = await (await request(root + '/open', { ...options, body: { expectedRevision: 2, opensAt: time - 1000, closesAt: time + 10000 } })).json();
  for (const userId of [player.data.user.id, other.data.user.id]) {
    const version = db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM bot_submissions WHERE user_id=?').get(userId).n;
    db.prepare(`INSERT INTO bot_submissions(id,user_id,version,filename,entry,language,status,job_status,created_at,updated_at,stage_id,source_hash,image)
      VALUES (?,?,?,'main.py','main.py','python','Accepted','done',?,?,?,'test-hash','test-image')`).run(require('node:crypto').randomUUID(), userId, version, time, time, tournament.stages[0].id);
  }
  tournament = await (await request(root + '/close', { ...options, body: { expectedRevision: tournament.revision, reason: 'Fixture' } })).json();
  tournament = await (await request(root + '/lock', { ...options, body: { expectedRevision: tournament.revision, reason: 'Fixture' } })).json();
  const body = { expectedRevision: tournament.revision, seed: 'http-swiss' };
  const approval = { expectedRevision: tournament.revision, swissRevision: 1, topN: 2, reason: 'Checked' };
  assert.equal((await request(root + '/swiss/approve', { method: 'POST', body: approval })).status, 401);
  assert.equal((await request(root + '/swiss/approve', { ...options, csrf: null, body: approval })).status, 403);
  assert.equal((await request(root + '/swiss/approve', { method: 'POST', cookie: player.cookie, csrf: player.data.csrfToken, body: approval })).status, 403);
  assert.equal((await request(root + '/swiss/approve', { ...options, body: approval })).status, 409);
  assert.equal((await request(root + '/swiss')).status, 401);
  assert.equal((await request(root + '/swiss', { cookie: player.cookie })).status, 403);
  assert.equal((await request(root + '/swiss/start', { ...options, csrf: null, body })).status, 403);
  assert.equal((await request(root + '/swiss/start', { method: 'POST', cookie: player.cookie, csrf: player.data.csrfToken, body })).status, 403);
  for (const action of ['pause','resume','cancel']) {
    assert.equal((await request(root + '/swiss/' + action, { ...options, csrf: null, body })).status, 403);
    assert.equal((await request(root + '/swiss/' + action, { method: 'POST', cookie: player.cookie, csrf: player.data.csrfToken, body })).status, 403);
  }
  const started = await request(root + '/swiss/start', { ...options, body }); assert.equal(started.status, 200);
  const swiss = await started.json(); assert.equal(swiss.rounds.length, 1);
  assert.equal((await request(root + '/swiss/start', { ...options, body })).status, 409);
  assert.equal((await request(root + '/swiss/next', { ...options, body: { expectedRevision: swiss.revision } })).status, 409);
  const view = await request(`/api/portal/tournaments/${created.id}/swiss`, { cookie: player.cookie });
  assert.equal((await request(`/api/portal/tournaments/${created.id}/bracket`, { cookie: player.cookie })).status, 200);
  assert.equal(view.status, 200); assert.equal((await view.json()).pairs, undefined);
  await createUser(db, { username: 'swiss-outsider', password, mustChangePassword: false });
  const outsider = await login('swiss-outsider');
  assert.equal((await request(`/api/portal/tournaments/${created.id}/swiss`, { cookie: outsider.cookie })).status, 404);
  assert.equal((await request(`/api/portal/tournaments/${created.id}/bracket`, { cookie: outsider.cookie })).status, 404);
  const gameId = swiss.pairs[0].games[0].id;
  assert.equal((await request(`/api/admin/swiss-games/${gameId}`, { cookie: player.cookie })).status, 403);
  assert.equal((await request(`/api/admin/swiss-games/${gameId}`, { cookie: administrator.cookie })).status, 200);
  assert.equal((await request(`/api/admin/swiss-games/${gameId}/retry`, { ...options, csrf: null, body: { reason: 'x' } })).status, 403);
  assert.equal((await request(`/api/admin/swiss-games/${gameId}/retry`, { ...options, body: { reason: 'x' } })).status, 409);
  assert.equal((await request(root + '/swiss/export', { cookie: administrator.cookie })).status, 200);
});

test('new contestant uses username as initial password and must change it before using portal',async()=>{
 const admin=await login('admin');
 const result=await request('/api/admin/users/import',{method:'POST',cookie:admin.cookie,csrf:admin.data.csrfToken,body:{csv:'username\nsv01'}});
 assert.equal(result.status,200);assert.deepEqual((await result.json()).credentials,[{username:'sv01',password:'sv01'}]);
 const first=await login('sv01','sv01');assert.equal(first.data.user.mustChangePassword,true);
 assert.equal((await request('/api/portal/submissions',{cookie:first.cookie})).status,403);
 const opts={method:'POST',cookie:first.cookie,csrf:first.data.csrfToken};
 assert.equal((await request('/api/auth/password',{...opts,body:{currentPassword:'sv01',newPassword:'sv01',confirmPassword:'sv01'}})).status,400);
 const next='StudentPersonal-2026!';
 assert.equal((await request('/api/auth/password',{...opts,body:{currentPassword:'sv01',newPassword:next,confirmPassword:next}})).status,200);
 assert.equal((await request('/api/auth/login',{method:'POST',body:{username:'sv01',password:'sv01'}})).status,401);
 const changed=await login('sv01',next);assert.equal(changed.data.user.mustChangePassword,false);
 assert.equal((await request('/api/portal/overview',{cookie:changed.cookie})).status,200);
});
