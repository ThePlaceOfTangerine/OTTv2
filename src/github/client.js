const crypto = require('node:crypto');
const fs = require('node:fs');
const { InfrastructureError } = require('../game/protocol');

// A definite answer from GitHub (404, 413...). Rate limits and outages become InfrastructureError instead.
class GitHubError extends Error { constructor(status, message) { super(message); this.name = 'GitHubError'; this.status = status; } }

class GitHubClient {
  constructor({ appId, privateKey, apiUrl = 'https://api.github.com', fetch = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, maxWaitMs = 60000, retries = 3 }) {
    if (!appId || !privateKey) throw new Error('GitHub App cần appId và privateKey');
    this.appId = String(appId); this.privateKey = crypto.createPrivateKey(privateKey); this.apiUrl = apiUrl.replace(/\/$/, '');
    this.fetch = fetch; this.sleep = sleep; this.now = now; this.maxWaitMs = maxWaitMs; this.retries = retries; this.tokens = new Map();
  }
  jwt() {
    const time = Math.floor(this.now() / 1000), encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: time - 60, exp: time + 540, iss: this.appId })}`;
    return `${body}.${crypto.sign('sha256', Buffer.from(body), this.privateKey).toString('base64url')}`;
  }
  async request(route, { auth, method = 'GET', accept = 'application/vnd.github+json', maxBytes = 1024 * 1024, notFound = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.fetch(this.apiUrl + route, { method, redirect: 'follow', signal: AbortSignal.timeout(120000),
          headers: { Accept: accept, Authorization: `Bearer ${auth}`, 'User-Agent': 'OTTv2-grader', 'X-GitHub-Api-Version': '2022-11-28' } });
      } catch {
        if (attempt < this.retries) { await this.sleep(Math.min(this.maxWaitMs, 1000 * 2 ** attempt)); continue; }
        throw new InfrastructureError('github_unavailable', 'Không kết nối được GitHub.');
      }
      if (response.status === 404 && notFound) { await response.body?.cancel(); return null; }
      const limited = response.status === 429 || response.status === 403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0');
      if (limited || response.status >= 500) {
        await response.body?.cancel();
        if (attempt >= this.retries) throw new InfrastructureError(limited ? 'github_rate_limited' : 'github_unavailable', `GitHub tạm thời từ chối (${response.status}).`);
        const retryAfter = Number(response.headers.get('retry-after')) * 1000, reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - this.now();
        await this.sleep(Math.min(this.maxWaitMs, retryAfter > 0 ? retryAfter : limited && reset > 0 ? reset : 1000 * 2 ** attempt));
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new GitHubError(response.status, `GitHub trả lỗi ${response.status}.`); }
      if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new GitHubError(413, 'Dữ liệu GitHub vượt giới hạn.'); }
      const chunks = []; let length = 0;
      for await (const chunk of response.body || []) {
        length += chunk.length;
        if (length > maxBytes) throw new GitHubError(413, 'Dữ liệu GitHub vượt giới hạn.');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }
  }
  async json(route, options) { const body = await this.request(route, options); return body && JSON.parse(body.toString('utf8')); }
  async token(installationId) {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - 5 * 60000 > this.now()) return cached.token;
    const data = await this.json(`/app/installations/${Number(installationId)}/access_tokens`, { method: 'POST', auth: this.jwt() });
    this.tokens.set(installationId, { token: data.token, expiresAt: Date.parse(data.expires_at) });
    return data.token;
  }
  async installation(fullName) { return (await this.json(`/repos/${fullName}/installation`, { auth: this.jwt(), notFound: true }))?.id ?? null; }
  repo(fullName, token) { return this.json(`/repos/${fullName}`, { auth: token, notFound: true }); }
  async file(fullName, file, ref, token) {
    const body = await this.request(`/repos/${fullName}/contents/${file}?ref=${encodeURIComponent(ref)}`, { auth: token, accept: 'application/vnd.github.raw', maxBytes: 4096, notFound: true });
    return body && body.toString('utf8');
  }
  async head(fullName, branch, token) {
    const sha = (await this.request(`/repos/${fullName}/commits/${encodeURIComponent(branch)}`, { auth: token, accept: 'application/vnd.github.sha', maxBytes: 100 })).toString('utf8').trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new InfrastructureError('github_invalid_response', 'GitHub trả mã commit không hợp lệ.');
    return sha;
  }
  zipball(fullName, sha, token, maxBytes) { return this.request(`/repos/${fullName}/zipball/${sha}`, { auth: token, accept: 'application/vnd.github+json', maxBytes }); }
}

function githubFromEnv(env = process.env) {
  if (!env.GITHUB_APP_ID) return null;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY_PATH ? fs.readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8') : env.GITHUB_APP_PRIVATE_KEY;
  return { client: new GitHubClient({ appId: env.GITHUB_APP_ID, privateKey, apiUrl: env.GITHUB_API_URL }), appSlug: env.GITHUB_APP_SLUG || null, webhookSecret: env.GITHUB_WEBHOOK_SECRET || null };
}
module.exports = { GitHubClient, GitHubError, githubFromEnv };
