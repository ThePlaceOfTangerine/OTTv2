// Phase 7a: OTTCONF files (grader.env / portal.env), contestant firewall rules, grader enrollment windows and the USB agent's enrollment.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { GraderAgent } = require('../src/grader/agent');
const { parseEnv, graderConfig, portalConfig, contestantFirewall, renderGrader, renderPortal } = require('../src/usb/config');
const { credentials } = require('../scripts/grader');

const CODE = 'ott-' + 'a'.repeat(32);
test('OTTCONF files survive Notepad (BOM, CRLF, quotes) and reject anything unsafe', () => {
  assert.deepEqual(parseEnv('﻿# ghi chú\r\nCOORDINATOR_URL = "http://10.0.0.5:3000"\r\n\r\nGRADER_SLOTS=2\r\n'), { COORDINATOR_URL: 'http://10.0.0.5:3000', GRADER_SLOTS: '2' });
  assert.throws(() => parseEnv('rm -rf /\n'), /Dòng 1/);
  assert.deepEqual(graderConfig({ COORDINATOR_URL: 'http://10.0.0.5:3000/', GRADER_ENROLL_CODE: CODE }), { url: 'http://10.0.0.5:3000', code: CODE, slots: 1 });
  for (const values of [{ COORDINATOR_URL: 'ftp://x', GRADER_ENROLL_CODE: CODE }, { COORDINATOR_URL: 'http://10.0.0.5/api', GRADER_ENROLL_CODE: CODE }, { COORDINATOR_URL: 'http://u:p@10.0.0.5', GRADER_ENROLL_CODE: CODE },
    { COORDINATOR_URL: 'http://10.0.0.5', GRADER_ENROLL_CODE: 'abc' }, { COORDINATOR_URL: 'http://10.0.0.5', GRADER_ENROLL_CODE: CODE, GRADER_SLOTS: '99' }]) assert.throws(() => graderConfig(values));
  assert.deepEqual(portalConfig({ PORTAL_URL: 'http://192.168.1.10:3000' }), { url: 'http://192.168.1.10:3000', ip: '192.168.1.10', port: 3000 });
  assert.equal(portalConfig({ PORTAL_URL: 'https://192.168.1.10' }).port, 443);
  for (const portal of ['http://thi.local:3000', 'http://[::1]:3000', 'http://192.168.1.10:3000/portal', 'http://1.2.3.4;flush ruleset']) assert.throws(() => portalConfig({ PORTAL_URL: portal }), portal);
  const rules = contestantFirewall({ ip: '192.168.1.10', port: 3000 });
  assert.match(rules, /policy drop;[\s\S]*ip daddr 192\.168\.1\.10 tcp dport 3000 accept/);
  assert.equal((rules.match(/accept/g) || []).length, 8, 'chỉ loopback, kết nối đã mở, DHCP và đúng coordinator');
  assert.throws(() => contestantFirewall({ ip: '1.2.3.4 accept', port: 3000 }));
  // Firefox match patterns have no port: "http://ip:3000/*" would block the portal itself (seen on the QEMU screenshot).
  const policy = JSON.parse(require('../src/usb/config').firefoxPolicies({ url: 'http://192.168.1.10:3000' })).policies;
  assert.deepEqual(policy.WebsiteFilter.Exceptions, ['http://192.168.1.10/*', 'file:///home/thisinh/*']);
  assert.equal(policy.Homepage.URL, 'http://192.168.1.10:3000/portal');
  // Rendered files parse back to the same configuration and use CRLF for Notepad.
  const grader = renderGrader({ url: 'http://10.0.0.5:3000', code: CODE, slots: 3 });
  assert.ok(grader.includes('\r\n')); assert.deepEqual(graderConfig(parseEnv(grader)), { url: 'http://10.0.0.5:3000', code: CODE, slots: 3 });
  assert.equal(portalConfig(parseEnv(renderPortal({ portal: 'http://10.0.0.5:3000' }))).ip, '10.0.0.5');
});

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-usb-')), db = openDatabase(':memory:');
  let offset = 0; const now = () => Date.now() + offset, hash = await bcrypt.hash('admin-password-1', 4);
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at,must_change_password) VALUES (1,'boss',?,'admin',0,0)").run(hash);
  const app = await createApp({ db, now, github: null, turnstile: null, submissionOptions: { storageRoot: path.join(root, 'subs') } });
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: 'admin-password-1' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0], csrf = (await login.json()).csrfToken;
  const admin = (route, body) => fetch(url + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const enroll = body => fetch(`${url}/api/graders/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try { await run({ db, url, admin, enroll, root, app, travel: ms => { offset += ms; } }); }
  finally { server.closeAllConnections(); server.close(); await app.locals.submissions.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

test('enrollment window: one open at a time, each USB gets its own key, bounded by uses, time and closing', () => fixture(async ({ db, url, admin, enroll, travel }) => {
  assert.equal((await fetch(`${url}/api/admin/grader-enrollments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  for (const bad of [{ namePrefix: 'Phòng A' }, { maxUses: 0 }, { minutes: 999 }]) assert.equal((await admin('/api/admin/grader-enrollments', bad)).status, 400);
  const opened = await (await admin('/api/admin/grader-enrollments', { namePrefix: 'lab', maxUses: 2, minutes: 15 })).json();
  assert.match(opened.code, /^ott-/); assert.equal(opened.open, true);
  assert.equal((await admin('/api/admin/grader-enrollments', {})).status, 409, 'chỉ một đợt mở');
  assert.ok(!db.prepare('SELECT 1 FROM grader_enrollments WHERE code_hash=?').get(opened.code), 'chỉ lưu hash của mã');
  assert.equal((await enroll({ code: 'ott-' + 'b'.repeat(32) })).status, 403);
  const first = await (await enroll({ code: opened.code, machine: 'MAY-01; DROP' })).json(), second = await (await enroll({ code: opened.code })).json();
  assert.notEqual(first.id, second.id); assert.notEqual(first.secret, second.secret);
  assert.deepEqual([first.name, second.name], ['lab-1 (MAY-01 DROP)', 'lab-2']);
  assert.equal((await enroll({ code: opened.code })).status, 403, 'đủ số máy');
  // The issued key works with the existing HMAC protocol (claim returns 204 = no job yet).
  const agent = new GraderAgent({ url, id: first.id, secret: first.secret, log: () => {} });
  assert.equal(await agent.call('/api/grader/claim', { kinds: ['submission'], engine: require('../src/grader/version').ENGINE_HASH }), null);
  const listed = await (await admin('/api/admin/grader-enrollments')).json();
  assert.equal(listed.enrollments[0].uses, 2); assert.equal(listed.enrollments[0].open, false);

  const again = await (await admin('/api/admin/grader-enrollments', { maxUses: 10, minutes: 15 })).json();
  assert.equal((await admin(`/api/admin/grader-enrollments/${again.id}/close`, {})).status, 200);
  assert.equal((await enroll({ code: again.code })).status, 403, 'đã đóng');
  const timed = await (await admin('/api/admin/grader-enrollments', { maxUses: 10, minutes: 1 })).json();
  travel(61000);
  assert.equal((await enroll({ code: timed.code })).status, 403, 'hết giờ');
  assert.equal((await admin(`/api/admin/graders/${first.id}/revoke`, {})).status, 200);
  await assert.rejects(agent.call('/api/grader/claim', {}), /thu hồi/);
}));

test('USB agent enrolls from grader.env once and reuses the key kept in RAM after a service restart', () => fixture(async ({ db, url, admin, root }) => {
  const opened = await (await admin('/api/admin/grader-enrollments', { maxUses: 5, minutes: 15 })).json();
  const config = path.join(root, 'grader.env'), cache = path.join(root, 'creds.json'), saved = { ...process.env };
  fs.writeFileSync(config, '﻿' + renderGrader({ url, code: opened.code, slots: 2 }));
  Object.assign(process.env, { GRADER_CONFIG_FILE: config, GRADER_CREDENTIALS_FILE: cache });
  try {
    const log = console.log; console.log = () => {};
    let first, second;
    try { first = await credentials(); second = await credentials(); } finally { console.log = log; }
    assert.equal(first.slots, 2); assert.equal(first.id, second.id); assert.equal(first.secret, second.secret);
    assert.equal(db.prepare('SELECT uses FROM grader_enrollments').get().uses, 1, 'khởi động lại dịch vụ không tốn thêm lượt');
    if (process.platform !== 'win32') assert.equal(fs.statSync(cache).mode & 0o777, 0o600);
    await admin(`/api/admin/grader-enrollments/${opened.id}/close`, {});
    fs.rmSync(cache);
    await assert.rejects(credentials(), /đợt đăng ký đã đóng/, 'khởi động lại máy sau khi đóng đợt thì không vào được');
  } finally { for (const key of ['GRADER_CONFIG_FILE', 'GRADER_CREDENTIALS_FILE']) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
}));
