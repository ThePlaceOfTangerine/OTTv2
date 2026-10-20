const crypto = require('node:crypto');
const fs = require('node:fs');

// Mirrors a publication into a Google Sheet with a service account. The database stays the source of truth; failures only delay the copy.
class SheetsClient {
  constructor({ credentials, spreadsheetId, apiUrl = 'https://sheets.googleapis.com', fetch = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, retries = 4 }) {
    if (!credentials?.client_email || !credentials?.private_key || !spreadsheetId) throw new Error('Google Sheets cần service account (client_email, private_key) và spreadsheetId.');
    Object.assign(this, { credentials, spreadsheetId, apiUrl: apiUrl.replace(/\/$/, ''), fetch, sleep, now, retries });
  }
  async token() {
    if (this.cached && this.cached.expiresAt - 60000 > this.now()) return this.cached.token;
    const time = Math.floor(this.now() / 1000), audience = this.credentials.token_uri || 'https://oauth2.googleapis.com/token';
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: this.credentials.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: audience, iat: time, exp: time + 3600 })}`;
    const assertion = `${body}.${crypto.sign('sha256', Buffer.from(body), this.credentials.private_key).toString('base64url')}`;
    const data = await this.call(audience, { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) }, false);
    this.cached = { token: data.access_token, expiresAt: this.now() + (data.expires_in || 3600) * 1000 };
    return this.cached.token;
  }
  // Retries 429/5xx with Retry-After or exponential backoff; quota errors are expected around bursts of publications.
  async call(url, options, auth = true) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.fetch(url, { ...options, signal: AbortSignal.timeout(30000), headers: { ...(auth ? { Authorization: `Bearer ${await this.token()}` } : {}), ...(options.json ? { 'Content-Type': 'application/json' } : {}) }, body: options.json ? JSON.stringify(options.json) : options.body });
      } catch (error) { if (attempt >= this.retries) throw new Error(`Không kết nối được Google: ${error.message}`); await this.sleep(1000 * 2 ** attempt); continue; }
      if ((response.status === 429 || response.status >= 500) && attempt < this.retries) {
        await response.body?.cancel();
        const retryAfter = Number(response.headers.get('retry-after')) * 1000;
        await this.sleep(Math.min(60000, retryAfter > 0 ? retryAfter : 1000 * 2 ** attempt)); continue;
      }
      const text = await response.text();
      if (!response.ok) throw Object.assign(new Error(`Google trả lỗi ${response.status}: ${text.slice(0, 300)}`), { status: response.status });
      return text ? JSON.parse(text) : {};
    }
  }
  sheet(path) { return `${this.apiUrl}/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}${path}`; }
  // tabs: [{ title, rows: [[...], ...] }]; missing tabs are created, then each tab is cleared and rewritten in one batch.
  async write(tabs) {
    const meta = await this.call(this.sheet('?fields=sheets.properties.title'), { method: 'GET' });
    const existing = new Set((meta.sheets || []).map(sheet => sheet.properties.title));
    const missing = tabs.filter(tab => !existing.has(tab.title));
    if (missing.length) await this.call(this.sheet(':batchUpdate'), { method: 'POST', json: { requests: missing.map(tab => ({ addSheet: { properties: { title: tab.title } } })) } });
    await this.call(this.sheet('/values:batchClear'), { method: 'POST', json: { ranges: tabs.map(tab => `'${tab.title}'`) } });
    await this.call(this.sheet('/values:batchUpdate'), { method: 'POST', json: { valueInputOption: 'RAW', data: tabs.map(tab => ({ range: `'${tab.title}'!A1`, values: tab.rows })) } });
  }
}
function sheetsFromEnv(env = process.env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_FILE || !env.GOOGLE_SHEET_ID) return null;
  return new SheetsClient({ credentials: JSON.parse(fs.readFileSync(env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8')), spreadsheetId: env.GOOGLE_SHEET_ID, apiUrl: env.GOOGLE_SHEETS_API_URL });
}
module.exports = { SheetsClient, sheetsFromEnv };
