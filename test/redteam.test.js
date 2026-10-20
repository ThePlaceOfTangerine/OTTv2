// Phase 8 red team, web part (docs/RED-TEAM.md): access control, cross-team reads, CSRF, cookies and headers, traversal, body size, XSS sinks.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { createUser } = require('../src/users');

let db, app, server, base, root, teamA, teamB, admin, subB;
const PASSWORD = 'red-team-password-2026';
async function login(username) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  assert.equal(response.status, 200, username);
  return { cookie: response.headers.get('set-cookie').split(';')[0], setCookie: response.headers.get('set-cookie'), csrf: (await response.json()).csrfToken };
}
const call = (session, method, route, { body, headers = {} } = {}) => fetch(base + route, { method, redirect: 'manual',
  headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-redteam-'));
  db = openDatabase(':memory:');
  for (const [username, role] of [['btc', 'admin'], ['doi-a', 'contestant'], ['doi-b', 'contestant']]) await createUser(db, { username, password: PASSWORD, role, mustChangePassword: false });
  app = await createApp({ db, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(root, 'subs') }, publicationOptions: { siteDir: path.join(root, 'site'), log: () => {} } });
  server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  [admin, teamA, teamB] = [await login('btc'), await login('doi-a'), await login('doi-b')];
  subB = await app.locals.submissions.submit({ userId: 3, filename: 'main.py', buffer: Buffer.from('print(1)\n') });
});
after(async () => { server.closeAllConnections(); server.close(); await app.locals.submissions.close(); await app.locals.publications.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });

// Every route under /api/admin, read from Express itself, so a route added later is covered automatically.
function adminRoutes() {
  const routes = [];
  for (const layer of app.router.stack) {
    const route = layer.route; if (!route || typeof route.path !== 'string' || !route.path.startsWith('/api/admin')) continue;
    for (const method of Object.keys(route.methods)) routes.push({ method: method.toUpperCase(), path: route.path.replace(/:[A-Za-z]+/g, 'khong-ton-tai') });
  }
  return routes;
}
test('every admin API refuses anonymous callers (401) and contestants (403)', async () => {
  const routes = adminRoutes();
  assert.ok(routes.length >= 60, `chỉ tìm thấy ${routes.length} route admin`);
  for (const { method, path: route } of routes) {
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? {} : undefined;
    assert.equal((await call(null, method, route, { body })).status, 401, `${method} ${route} không đăng nhập`);
    assert.equal((await call(teamA, method, route, { body })).status, 403, `${method} ${route} bằng tài khoản thí sinh`);
  }
});

test('a team cannot read, retry or activate another team\'s submission, nor see a tournament it is not in', async () => {
  for (const route of [`/api/portal/submissions/${subB.id}`, `/api/portal/submissions/${subB.id}/tests/0`, `/api/portal/submissions/${subB.id}/tests/1`])
    assert.equal((await call(teamA, 'GET', route)).status, 404, route);
  for (const action of ['retry', 'activate']) assert.equal((await call(teamA, 'POST', `/api/portal/submissions/${subB.id}/${action}`, { body: {} })).status, 404, action);
  assert.ok(!(await (await call(teamA, 'GET', '/api/portal/submissions')).json()).submissions.some(s => s.id === subB.id));
  assert.equal((await call(teamB, 'GET', `/api/portal/submissions/${subB.id}`)).status, 200, 'chủ bài vẫn xem được');
  const t = app.locals.tournaments.create(1, { name: 'Chỉ đội B' });
  app.locals.tournaments.replaceEntrants(t.id, 1, { expectedRevision: t.revision, userIds: [3] });
  for (const route of [`/api/portal/tournaments/${t.id}/swiss`, `/api/portal/tournaments/${t.id}/bracket`]) assert.equal((await call(teamA, 'GET', route)).status, 404, route);
});

test('state-changing requests need the session\'s own CSRF token; cross-site login is refused', async () => {
  const noToken = await fetch(`${base}/api/portal/submissions/${subB.id}/retry`, { method: 'POST', headers: { Cookie: teamB.cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noToken.status, 403);
  assert.equal((await call({ cookie: teamB.cookie, csrf: teamA.csrf }, 'POST', `/api/portal/submissions/${subB.id}/retry`, { body: {} })).status, 403, 'token của phiên khác');
  assert.equal((await call(null, 'POST', '/api/auth/login', { body: { username: 'doi-a', password: PASSWORD }, headers: { Origin: 'https://ke-xau.example' } })).status, 403);
  assert.equal((await call(null, 'POST', '/api/auth/login', { body: { username: 'doi-a', password: PASSWORD }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.match(teamA.setCookie, /HttpOnly/i); assert.match(teamA.setCookie, /SameSite=Strict/i);
});

test('pages and the public site send CSP, frame and sniffing protection', async () => {
  await app.locals.publications.rebuild(false);  // the site must exist, otherwise /site/ is a 404 page
  for (const route of ['/portal', '/admin', '/setup', '/assets/app.js', '/site/', '/api/health']) {
    const response = await fetch(base + route, { redirect: 'manual' });
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', route);
    assert.equal(response.headers.get('x-frame-options'), 'DENY', route);
    if (!route.startsWith('/api')) assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'.*frame-ancestors 'none'/, route);
  }
  assert.equal((await fetch(`${base}/api/portal/submissions`, { headers: { Cookie: teamA.cookie } })).headers.get('cache-control'), 'no-store');
});

test('no path reaches files outside the served folders; oversized JSON is refused', async () => {
  fs.writeFileSync(path.join(root, 'secret.txt'), 'BI-MAT');
  for (const route of ['/assets/..%2f..%2fpackage.json', '/assets/%2e%2e/%2e%2e/package.json', '/site/..%2f..%2f..%2fsecret.txt', '/assets/....//....//package.json', '/img/..%2f..%2fpackage.json', '/legacy/..%2f..%2fpackage.json']) {
    const response = await fetch(base + route), text = await response.text();
    assert.ok(!/"dependencies"|BI-MAT/.test(text), `${route} lộ file (${response.status})`);
  }
  assert.equal((await call(teamA, 'PUT', '/api/portal/team/members', { body: { members: 'x'.repeat(300 * 1024) } })).status, 413);
});

test('pages never insert data as HTML: no innerHTML/outerHTML/insertAdjacentHTML/document.write in the portal, admin or public site code', () => {
  const sinks = /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
  for (const dir of ['web', 'web-public']) for (const file of fs.readdirSync(path.join(__dirname, '..', dir)).filter(f => /\.(js|html)$/.test(f))) {
    const text = fs.readFileSync(path.join(__dirname, '..', dir, file), 'utf8');
    assert.ok(!sinks.test(text), `${dir}/${file} dùng ${text.match(sinks)?.[0]}`);
  }
});
