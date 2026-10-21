const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { once } = require('node:events');
const { SheetsClient } = require('../src/publish/sheets');

test('Sheets client signs a service-account JWT, backs off on 429, creates missing tabs and rewrites values', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls = []; let limited = 2;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://x'); calls.push(`${req.method} ${url.pathname}`);
    const json = (code, value, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/token') {
      const assertion = new URLSearchParams(body).get('assertion'), [head, claims, signature] = assertion.split('.');
      const valid = crypto.verify('sha256', Buffer.from(`${head}.${claims}`), publicKey, Buffer.from(signature, 'base64url'));
      const payload = JSON.parse(Buffer.from(claims, 'base64url'));
      return valid && payload.scope === 'https://www.googleapis.com/auth/spreadsheets' && payload.iss === 'bot@project.iam' ? json(200, { access_token: 'tok', expires_in: 3600 }) : json(401, {});
    }
    if (req.headers.authorization !== 'Bearer tok') return json(401, {});
    if (limited > 0 && url.pathname.endsWith(':batchUpdate') && url.pathname.includes('/values')) { limited--; return json(429, { error: 'quota' }, { 'retry-after': '1' }); }
    if (req.method === 'GET') return json(200, { sheets: [{ properties: { title: 'Có sẵn' } }] });
    json(200, { ok: true, received: JSON.parse(body) });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`, sleeps = [];
  try {
    const client = new SheetsClient({ credentials: { client_email: 'bot@project.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${url}/token` },
      spreadsheetId: 'sheet-1', apiUrl: url, sleep: async ms => { sleeps.push(ms); } });
    await client.write([{ title: 'Có sẵn', rows: [['a']] }, { title: 'Mới', rows: [['b']] }]);
    assert.deepEqual(calls, ['POST /token', 'GET /v4/spreadsheets/sheet-1', 'POST /v4/spreadsheets/sheet-1:batchUpdate', 'POST /v4/spreadsheets/sheet-1/values:batchClear',
      'POST /v4/spreadsheets/sheet-1/values:batchUpdate', 'POST /v4/spreadsheets/sheet-1/values:batchUpdate', 'POST /v4/spreadsheets/sheet-1/values:batchUpdate']);
    assert.deepEqual(sleeps, [1000, 1000], 'Retry-After respected');
    limited = 10;
    await assert.rejects(client.write([{ title: 'Có sẵn', rows: [] }]), /429/);
  } finally { server.close(); }
});
