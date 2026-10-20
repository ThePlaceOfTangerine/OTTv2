const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { loadSettings, saveSettings, trustLevel } = require('../src/settings');
const { isLocal } = require('../src/setup');

let db, server, base, app, dir, restarts = 0;
const previous = process.env.OTT_SETTINGS;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-setup-'));
  process.env.OTT_SETTINGS = path.join(dir, 'settings.json');
  db = openDatabase(':memory:');
  app = await createApp({ db, submissionOptions: { storageRoot: path.join(dir, 'subs') }, onRestart: () => { restarts++; },
    setupProbe: async () => ({ 'windows-job': { available: true, image: 'windows-job:python-3.11.9', cpp: null }, docker: { available: false, error: 'không chạy' } }) });
  server = http.createServer(app);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); await app.locals.submissions.close(); db.close();
  if (previous === undefined) delete process.env.OTT_SETTINGS; else process.env.OTT_SETTINGS = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});
const post = (body, headers = {}) => fetch(`${base}/api/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
// fetch cannot change Host; a raw request can (DNS rebinding: a remote page reaching 127.0.0.1 under its own name).
const rawPost = (body, host) => new Promise((resolve, reject) => {
  const request = http.request(`${base}/api/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Host: host } }, response => { response.resume(); resolve(response.statusCode); });
  request.on('error', reject); request.end(JSON.stringify(body));
});
const good = { username: 'giaovien', password: 'mat-khau-giao-vien-2026', trust: 'classroom', lan: true, csv: 'username\nhs01\nhs02\n' };

test('settings.json fills unset variables only; trust follows the sandbox backend', () => {
  const file = path.join(dir, 'other.json'), env = { HOST: '10.0.0.1' };
  saveSettings({ SANDBOX_BACKEND: 'windows-job', HOST: '0.0.0.0', SECRET: 'ignored' }, file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).env, { SANDBOX_BACKEND: 'windows-job', HOST: '0.0.0.0' });
  loadSettings(file, env);
  assert.deepEqual(env, { HOST: '10.0.0.1', SANDBOX_BACKEND: 'windows-job' });
  assert.equal(trustLevel(env), 'classroom'); assert.equal(trustLevel({}), 'official');
  assert.deepEqual(loadSettings(path.join(dir, 'missing.json'), {}), {});
});

test('only loopback connections addressed to a local host name count as local', () => {
  const req = (address, host) => ({ socket: { remoteAddress: address }, get: () => host });
  assert.ok(isLocal(req('127.0.0.1', '127.0.0.1:3000'))); assert.ok(isLocal(req('::1', 'localhost:3000')));
  assert.ok(!isLocal(req('192.168.1.20', '127.0.0.1:3000'))); assert.ok(!isLocal(req('127.0.0.1', 'evil.example:3000')));
});

test('wizard: first visit redirects to /setup, refuses cross-site and bad input, then creates admin, class, practice tournament and locks', async () => {
  const first = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(first.status, 302); assert.equal(first.headers.get('location'), '/setup');
  const state = await (await fetch(`${base}/api/setup`)).json();
  assert.equal(state.checks['windows-job'].available, true);

  assert.equal((await post(good, { Origin: 'http://evil.example' })).status, 403);
  assert.equal((await post(good, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(await rawPost(good, 'evil.example'), 403);
  assert.equal((await post({ ...good, password: 'ngan' })).status, 400);
  assert.equal((await post({ ...good, trust: 'tuy-y' })).status, 400);
  assert.equal((await post({ ...good, csv: 'username\ngiaovien\n' })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0, 'rejected attempts leave no accounts');

  const response = await post(good);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.deepEqual(result.credentials.map(c => c.username), ['hs01', 'hs02']);
  assert.equal(result.trust, 'classroom'); assert.equal(result.restart, true); assert.equal(result.autoRestart, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(process.env.OTT_SETTINGS, 'utf8')).env, { SANDBOX_BACKEND: 'windows-job', HOST: '0.0.0.0' });
  const tournament = app.locals.tournaments.get(result.tournament.id);
  assert.equal(tournament.name, 'Giải luyện tập');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tournament_entrants WHERE tournament_id=?').get(tournament.id).n, 2);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(restarts, 1);

  assert.equal((await post({ ...good, username: 'khac' })).status, 409);
  assert.equal((await fetch(`${base}/setup`, { redirect: 'manual' })).headers.get('location'), '/admin');
  assert.equal((await fetch(`${base}/admin`, { redirect: 'manual' })).status, 200);
  const signedIn = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'giaovien', password: good.password }) });
  assert.equal(signedIn.status, 200);
});
