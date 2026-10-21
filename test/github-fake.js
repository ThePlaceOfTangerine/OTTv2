const crypto = require('node:crypto');
const http = require('node:http');
const { zip } = require('./zip-helper');

const bot = 'import json\nimport sys\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({"request_id":r["request_id"],"move":r["legal_moves"][0]}))\n';
const manifest = JSON.stringify({ language: 'python', entry: 'main.py' });
const sha = n => n.repeat(40).slice(0, 40);
const SYMLINK = (0xa1ff << 16) >>> 0;
const repoZip = (files, prefix = 'team-bot-abc1234/') => zip([{ name: prefix }, ...files.map(([name, data, attributes]) => ({ name: prefix + name, data, attributes }))]);

// Minimal GitHub REST stand-in: checks the App JWT signature and per-installation tokens like the real API.
async function fakeGitHub(publicKey) {
  const state = { installations: new Map(), repos: new Map(), files: new Map(), heads: new Map(), zips: new Map(), limited: 0, seen: [] };
  const verifyJwt = header => {
    const [head, body, signature] = (header || '').replace(/^Bearer /, '').split('.');
    return !!signature && crypto.verify('sha256', Buffer.from(`${head}.${body}`), publicKey, Buffer.from(signature, 'base64url'));
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); state.seen.push(`${req.method} ${url.pathname}`);
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    if (state.limited > 0) { state.limited--; res.writeHead(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' }); return res.end('{}'); }
    let match;
    if ((match = url.pathname.match(/^\/app\/installations\/(\d+)\/access_tokens$/)) && req.method === 'POST')
      return verifyJwt(req.headers.authorization) ? send(201, { token: `tok-${match[1]}`, expires_at: new Date(Date.now() + 3600000).toISOString() }) : send(401, {});
    if ((match = url.pathname.match(/^\/codeload\/(.+)\/([0-9a-f]{40})$/))) {
      const body = state.zips.get(`${match[1]}@${match[2]}`); return body ? send(200, body, 'application/zip') : send(404, {});
    }
    match = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    if (!match) return send(404, {});
    const [, name, rest = ''] = match, installation = state.installations.get(name);
    if (rest === '/installation') return !verifyJwt(req.headers.authorization) ? send(401, {}) : installation ? send(200, { id: installation }) : send(404, {});
    if (!installation || req.headers.authorization !== `Bearer tok-${installation}`) return send(404, {});
    if (!rest) return send(200, state.repos.get(name));
    if (rest === '/contents/ott-verify.txt') return state.files.has(name) ? send(200, state.files.get(name), 'text/plain') : send(404, {});
    if (rest.startsWith('/commits/')) return send(200, state.heads.get(name), 'text/plain');
    if ((match = rest.match(/^\/zipball\/([0-9a-f]{40})$/))) { res.writeHead(302, { location: `/codeload/${name}/${match[1]}` }); return res.end(); }
    send(404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const repo = (name, { id, installation, privateRepo = true, size = 10, head = sha('a'), files = [['ott.json', manifest], ['bot/main.py', bot]] } = {}) => {
    state.repos.set(name, { id, full_name: name, private: privateRepo, size, default_branch: 'main' });
    if (installation) state.installations.set(name, installation);
    state.heads.set(name, head); state.zips.set(`${name}@${head}`, repoZip(files));
  };
  return { state, repo, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { fakeGitHub, bot, manifest, sha, SYMLINK, repoZip };
