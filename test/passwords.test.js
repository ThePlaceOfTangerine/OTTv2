const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword, verifyPassword, needsRehash } = require('../src/passwords');

test('scrypt hashes verify, reject wrong passwords and keep accepting older bcrypt hashes', async () => {
  const hash = await hashPassword('mat-khau-rat-dai-2026');
  assert.match(hash, /^scrypt\$32768\$8\$3\$/); assert.notEqual(hash, await hashPassword('mat-khau-rat-dai-2026'), 'salted');
  assert.equal(await verifyPassword('mat-khau-rat-dai-2026', hash), true);
  assert.equal(await verifyPassword('mat-khau-rat-dai-2025', hash), false);
  const legacy = await bcrypt.hash('mat-khau-cu-2025', 4);
  assert.equal(await verifyPassword('mat-khau-cu-2025', legacy), true); assert.equal(await verifyPassword('sai', legacy), false);
  assert.equal(needsRehash(legacy), true); assert.equal(needsRehash(hash), false);
  assert.equal(await verifyPassword('x', null), false);
});

test('first successful login moves a bcrypt account to scrypt; a wrong password changes nothing', async () => {
  const db = openDatabase(':memory:'), legacy = await bcrypt.hash('mat-khau-cu-2025', 4);
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at,must_change_password) VALUES (2,'doi-cu',?,'contestant',0,0)").run(legacy);
  const app = await createApp({ db, github: null, turnstile: null }), server = http.createServer(app);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const login = password => fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'doi-cu', password }) });
  try {
    assert.equal((await login('sai-mat-khau')).status, 401);
    assert.equal(db.prepare('SELECT password_hash h FROM users WHERE id=2').get().h, legacy);
    assert.equal((await login('mat-khau-cu-2025')).status, 200);
    assert.match(db.prepare('SELECT password_hash h FROM users WHERE id=2').get().h, /^scrypt\$/, 'rehashed before the login answer');
    assert.equal((await login('mat-khau-cu-2025')).status, 200, 'same password still works after the rehash');
  } finally { server.closeAllConnections(); server.close(); await app.locals.submissions.close(); db.close(); }
});
