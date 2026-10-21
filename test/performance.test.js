// Phase 8 fixes found by the load test: gzip for large JSON, ranking cache that follows every result.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { once } = require('node:events');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { createUser } = require('../src/users');

test('large API responses are gzipped for clients that accept it; small ones and other clients get plain JSON', async () => {
  const db = openDatabase(':memory:');
  await createUser(db, { username: 'btc', password: 'btc-password-2026', role: 'admin' });
  for (let i = 0; i < 300; i++) db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES (?,'x','contestant',0)").run(`doi-co-ten-kha-dai-${i}`);
  const app = await createApp({ db, github: null, turnstile: null }), server = http.createServer(app);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  // Raw http.get so the response is not decompressed for us.
  const get = (route, headers) => new Promise((resolve, reject) => http.get(base + route, { headers }, response => {
    const chunks = []; response.on('data', c => chunks.push(c)); response.on('end', () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject));
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'btc', password: 'btc-password-2026' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const gz = await get('/api/admin/users', { Cookie: cookie, 'Accept-Encoding': 'gzip' }), plain = await get('/api/admin/users', { Cookie: cookie });
    assert.equal(gz.headers['content-encoding'], 'gzip'); assert.equal(gz.headers.vary, 'Accept-Encoding');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.deepEqual(JSON.parse(zlib.gunzipSync(gz.body)), JSON.parse(plain.body));
    assert.ok(gz.body.length * 4 < plain.body.length, `${gz.body.length} vs ${plain.body.length} byte`);
    const small = await get('/api/health', { 'Accept-Encoding': 'gzip' });
    assert.equal(small.headers['content-encoding'], undefined); assert.equal(JSON.parse(small.body).status, 'ok');
  } finally { server.closeAllConnections(); server.close(); await app.locals.submissions.close(); db.close(); }
});
