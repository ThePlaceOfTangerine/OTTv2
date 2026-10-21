const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { GitHubClient } = require('../src/github/client');

test('portal GitHub routes need CSRF, uploads need Turnstile when configured, webhook verifies raw-body HMAC', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-github-api-'));
  const db = openDatabase(':memory:');
  const hash = await bcrypt.hash('password-12345', 4);
  for (const [name, role] of [['team-api', 'contestant'], ['boss', 'admin']]) db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES (?,?,?,0)').run(name, hash, role);
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const client = new GitHubClient({ appId: 1, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), apiUrl: 'http://127.0.0.1:9' });
  const tokens = [];
  const app = await createApp({ db, submissionOptions: { storageRoot: root }, github: { client, appSlug: 'ott-grader', webhookSecret: 'secret' },
    turnstile: { siteKey: 'site-key', verify: async token => { tokens.push(token); return token === 'good'; } } });
  const server = require('node:http').createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async username => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'password-12345' }) });
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: (await response.json()).csrfToken };
  };
  const call = (url, { session, csrf = true, body, ...options } = {}) => fetch(base + url, { ...options, headers: { Cookie: session.cookie, ...(csrf ? { 'X-CSRF-Token': session.csrf } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body && JSON.stringify(body) });
  try {
    const team = await login('team-api'), admin = await login('boss');
    const overview = await call('/api/portal/overview', { session: team });
    assert.match(overview.headers.get('content-security-policy'), /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
    assert.deepEqual(await overview.json(), { username: 'team-api', phase: 5, github: true, turnstileSiteKey: 'site-key', readOnly: null });
    assert.equal((await call('/api/portal/team/repo', { session: team, csrf: false, method: 'POST', body: { url: 'team/bot' } })).status, 403);
    const registered = await call('/api/portal/team/repo', { session: team, method: 'POST', body: { url: 'https://github.com/team/bot' } });
    assert.equal(registered.status, 200);
    const teamView = await registered.json();
    assert.equal(teamView.repo.status, 'pending'); assert.equal(teamView.installUrl, 'https://github.com/apps/ott-grader/installations/new');
    assert.equal((await call('/api/admin/github', { session: team })).status, 403);
    assert.equal((await (await call('/api/admin/github', { session: admin })).json()).teams.find(row => row.username === 'team-api').status, 'pending');
    const upload = token => { const form = new FormData(); form.append('bot', new Blob(['print(1)\n']), 'main.py'); if (token) form.append('cf-turnstile-response', token); return call('/api/portal/submissions', { session: team, method: 'POST', body: form }); };
    assert.equal((await upload()).status, 403);
    assert.equal((await upload('bad')).status, 403);
    assert.equal((await upload('good')).status, 202);
    assert.deepEqual(tokens, ['bad', 'good']);
    const raw = JSON.stringify({ zen: 'hi' }), signature = `sha256=${crypto.createHmac('sha256', 'secret').update(raw).digest('hex')}`;
    const hook = sig => fetch(base + '/api/github/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'ping', 'X-GitHub-Delivery': 'abc', 'X-Hub-Signature-256': sig }, body: raw });
    assert.equal((await hook('sha256=00')).status, 401);
    const ping = await hook(signature); assert.equal(ping.status, 202); assert.deepEqual(await ping.json(), { ok: true });
  } finally {
    server.closeAllConnections(); server.close(); await app.locals.submissions.close(); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
