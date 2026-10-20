// Fires N concurrent GETs at a built results site served by a plain static server: node scripts/load-static.js <siteDir> [concurrency]
// Measures our file sizes and request mix on this machine only; it is not a measurement of Cloudflare's capacity.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

async function serve(dir) {
  const server = http.createServer(async (req, res) => {
    const file = path.join(dir, ...decodeURIComponent(new URL(req.url, 'http://x').pathname).split('/').filter(Boolean));
    if (!file.startsWith(path.resolve(dir))) { res.writeHead(403); return res.end(); }
    try { const data = await fs.readFile(file); res.writeHead(200, { 'content-type': 'application/json' }); res.end(data); }
    catch { res.writeHead(404); res.end(); }
  });
  // A large accept backlog: 4000 simultaneous connects from one process otherwise overflow it (ECONNREFUSED) on Windows.
  await new Promise(resolve => server.listen({ port: 0, host: '127.0.0.1', backlog: 65535 }, resolve));
  return server;
}
async function loadTest(dir, concurrency = 4000, maxSockets = Infinity) {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const tournament = manifest.tournaments[0];
  const latest = JSON.parse(await fs.readFile(path.join(dir, 't', tournament.id, 'latest.json'), 'utf8'));
  const teams = (await fs.readdir(path.join(dir, 'team'))).map(name => `/team/${name}`);
  // What a visitor loads: manifest + latest + summary (+ bracket for some), and team lookups.
  const mix = ['/manifest.json', `/t/${tournament.id}/latest.json`, `/${latest.files.summary}`, `/${latest.files.bracket}`];
  const server = await serve(dir), agent = new http.Agent({ keepAlive: true, maxSockets });
  const { port } = server.address(), latencies = [], sizes = [], kinds = {}; let errors = 0;
  const count = kind => { errors++; kinds[kind] = (kinds[kind] || 0) + 1; };
  const one = (url) => new Promise(resolve => {
    const started = process.hrtime.bigint();
    http.get({ host: '127.0.0.1', port, path: url, agent }, res => {
      let size = 0; res.on('data', chunk => { size += chunk.length; });
      res.on('end', () => { latencies.push(Number(process.hrtime.bigint() - started) / 1e6); sizes.push(size); if (res.statusCode !== 200) count(`HTTP ${res.statusCode}`); resolve(); });
    }).on('error', error => { count(error.code || error.message); resolve(); });
  });
  const started = Date.now();
  await Promise.all(Array.from({ length: concurrency }, (_, i) => one(i % 2 ? teams[i % teams.length] : mix[i % mix.length])));
  const seconds = (Date.now() - started) / 1000;
  agent.destroy(); server.close();
  latencies.sort((a, b) => a - b);
  const pick = q => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))].toFixed(1);
  return { concurrency, connections: maxSockets === Infinity ? concurrency : maxSockets, errors, errorKinds: kinds, seconds: seconds.toFixed(2), requestsPerSecond: Math.round(concurrency / seconds), p50: pick(0.5), p95: pick(0.95), p99: pick(0.99),
    maxMs: latencies.at(-1).toFixed(1), megabytes: (sizes.reduce((a, b) => a + b, 0) / 1048576).toFixed(1) };
}
if (require.main === module) loadTest(path.resolve(process.argv[2] || 'data/public-site'), Number(process.argv[3] || 4000), process.argv[4] ? Number(process.argv[4]) : Infinity)
  .then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { loadTest };
