// Phase 8 load test (D01: 1.000 đội × 3 lần nộp, 4 người/đội xem). Run on Linux/WSL (ott-build), not Windows (accept backlog ~230):
//   node scripts/load-test.js [--teams 1000] [--submits 3] [--viewers 4] [--window 180] [--rounds 8] [--agents 8] [--only login] [--out output/load]
// The real server.js runs as its own process (CPU/RAM measured from /proc); this process plays the browsers and the graders.
// Graders are fake (first legal move, no sandbox) but speak the real HMAC protocol, so the coordinator does all of its real work:
// leases, heartbeats, replay verification, artifacts, Swiss pairing and standings. Real sandbox speed: scripts/load-real-games.js.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { hashPassword } = require('../src/passwords');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { GraderAgent } = require('../src/grader/agent');

const argv = process.argv.slice(2), arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const TEAMS = Number(arg('teams', 1000)), SUBMITS = Number(arg('submits', 3)), VIEWERS = Number(arg('viewers', 4)), WINDOW = Number(arg('window', 180)) * 1000;
const ROUNDS = Number(arg('rounds', 8)), AGENTS = Number(arg('agents', 8)), ONLY = arg('only', null), OUT = path.resolve(arg('out', path.join(__dirname, '../output/load')));
const WORK = path.join(os.tmpdir(), 'ott-load'), PASSWORD = 'mat-khau-tai-thu-2026';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);

// --- measurements -------------------------------------------------------------------------------------------------------------
const samples = new Map();
const record = (name, ms, status) => { const s = samples.get(name) || samples.set(name, { ms: [], status: {} }).get(name); s.ms.push(ms); s.status[status] = (s.status[status] || 0) + 1; };
const pct = (sorted, p) => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length))]) : null;
const summary = () => Object.fromEntries([...samples].map(([name, s]) => { const sorted = [...s.ms].sort((a, b) => a - b);
  return [name, { n: sorted.length, p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99), max: Math.round(sorted.at(-1) ?? 0), status: s.status }]; }));
async function timed(name, url, options = {}) {
  const start = performance.now();
  try { const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) }); const body = await response.arrayBuffer(); record(name, performance.now() - start, response.status); return { response, body }; }
  catch (error) { record(name, performance.now() - start, error.name === 'TimeoutError' ? 'timeout' : `network:${error.cause?.code || error.cause?.message || error.message}`.slice(0, 60)); return { response: null, error }; }
}
const json = body => JSON.parse(Buffer.from(body).toString('utf8'));
// Server process CPU and memory from /proc, sampled every second.
function monitor(pid, files) {
  const tick = os.constants?.CLK_TCK || 100, rows = []; let last = null;
  const timer = setInterval(() => {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '), cpu = (Number(stat[11]) + Number(stat[12])) / tick, now = performance.now();
      const rss = Number(stat[21]) * 4096 / 1048576, db = files.reduce((sum, file) => sum + (fs.existsSync(file) ? fs.statSync(file).size : 0), 0) / 1048576;
      if (last) rows.push({ t: Math.round(now / 1000), cpu: Math.round((cpu - last.cpu) / ((now - last.now) / 1000) * 100), rss: Math.round(rss), db: Math.round(db) });
      last = { cpu, now };
    } catch { /* process gone */ }
  }, 1000);
  return { stop: () => clearInterval(timer), rows };
}
// Event-loop health of the server as users feel it: a cheap request every 500 ms.
const stalls = []; let currentPhase = null;
function healthProbe(base) {
  let running = true;
  (async () => { while (running) { const at = performance.now(); await timed('health', `${base}/api/health`); const ms = performance.now() - at; if (ms > 2000) stalls.push({ startedAtSecond: Math.round(at / 1000), ms: Math.round(ms), phase: currentPhase }); await sleep(500); } })();
  return () => { running = false; };
}

// --- setup ----------------------------------------------------------------------------------------------------------------------
async function seed(dbFile, storage, siteDir) {
  const db = openDatabase(dbFile), hash = await hashPassword(PASSWORD);  // production hashing (scrypt); one hash shared by every team
  db.exec('BEGIN');
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at,must_change_password) VALUES (1,'btc',?,'admin',0,0)").run(hash);
  const insert = db.prepare("INSERT INTO users(id,username,password_hash,role,created_at,must_change_password) VALUES (?,?,?,'contestant',0,0)");
  for (let i = 1; i <= TEAMS; i++) insert.run(i + 1, `doi${String(i).padStart(4, '0')}`, hash);
  db.exec('COMMIT');
  const app = await createApp({ db, github: null, turnstile: null, submissionOptions: { storageRoot: storage }, publicationOptions: { siteDir, log: () => {} } });
  const { tournaments } = app.locals;
  let t = tournaments.create(1, { name: `Tải thử ${TEAMS} đội`, config: { maxTeams: TEAMS, swissRounds: ROUNDS, topN: 16 } });
  t = tournaments.replaceEntrants(t.id, 1, { expectedRevision: t.revision, userIds: Array.from({ length: TEAMS }, (_, i) => i + 2) });
  t = tournaments.stages.open(t.id, 1, { expectedRevision: t.revision, closesAt: Date.now() + 6 * 3600000 });
  await app.locals.publications.close(); await app.locals.submissions.close(); db.close();
  return { tournamentId: t.id, stageId: t.stages[0].id };
}
function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', ...(process.env.LOAD_SERVER_FLAGS ? process.env.LOAD_SERVER_FLAGS.split(' ') : []), path.join(__dirname, '../server.js')], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/portal/); if (match) resolve({ child, base: `http://127.0.0.1:${match[1]}` }); });
    child.stderr.on('data', chunk => { process.stderr.write(`[server] ${chunk}`); });
    child.once('exit', code => reject(new Error(`server.js thoát (${code}): ${output}`)));
  });
}
async function login(base, username) {
  const { response, body } = await timed('login', `${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  if (response?.status !== 200) return null;
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: json(body).csrfToken };
}
const fakeManager = () => ({ async check() { return { image: 'fake-image' }; }, async prepare(source) { return { ...source, image: 'fake-image', hash: 'h', compile_cpu_ms: 1 }; },
  async start() { return { async close() {}, async move(request) { return { cpu_ms: 1, stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[request.legal_moves.length > 1 ? 1 : 0] }) }; } }; },
  async dispose() {} });

// --- scenarios ------------------------------------------------------------------------------------------------------------------
async function main() {
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  const dbFile = path.join(WORK, 'arena.sqlite'), storage = path.join(WORK, 'subs'), siteDir = path.join(WORK, 'site');
  log(`Chuẩn bị ${TEAMS} đội, giải ${ROUNDS} lượt...`);
  const { tournamentId, stageId } = await seed(dbFile, storage, siteDir);
  const { child, base } = await startServer({ DB_PATH: dbFile, SUBMISSIONS_PATH: storage, PUBLIC_SITE_DIR: siteDir, PORT: '0', HOST: '127.0.0.1', LOCAL_GRADING: '0', SANDBOX_BACKEND: 'docker' });
  const usage = monitor(child.pid, [dbFile, `${dbFile}-wal`]), stopHealth = healthProbe(base), phases = {}, began = performance.now();
  const phase = async (name, fn) => { const start = performance.now(); currentPhase = name; log(`== ${name}`); const result = await fn(); phases[name] = { seconds: Math.round((performance.now() - start) / 100) / 10, ...result }; log(`   xong sau ${phases[name].seconds} s`); return result; };
  let viewers = [], stopViewers = () => {};
  try {
    // 1. Every member signs in (one account per team, D09): TEAMS × VIEWERS logins, 64 browsers at a time.
    const sessions = await phase('đăng nhập', async () => {
      const queue = Array.from({ length: TEAMS * VIEWERS }, (_, i) => `doi${String(i % TEAMS + 1).padStart(4, '0')}`), result = [];
      await Promise.all(Array.from({ length: 64 }, async () => { while (queue.length) { const user = queue.shift(), session = await login(base, user); if (session) result.push({ user, ...session }); } }));
      return { attempted: TEAMS * VIEWERS, ok: result.length, sessions: result };
    });
    const ok = sessions.sessions; delete phases['đăng nhập'].sessions;
    if (ONLY === 'login' || !ok.length) return finish();
    const byTeam = new Map(); for (const s of ok) if (!byTeam.has(s.user)) byTeam.set(s.user, s);
    const admin = await login(base, 'btc'), adminCall = async (method, route, body) => {
      const { response, body: raw } = await timed(`admin ${route.replace(/[0-9a-f-]{36}/g, ':id')}`, base + route, { method, headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = raw?.byteLength ? json(raw) : null; if (!response?.ok) throw new Error(`${method} ${route}: ${response?.status} ${JSON.stringify(data)}`); return data;
    };
    // 2. Viewers: every session polls its submissions and the standings every 5–10 s until the end.
    let polling = true;
    viewers = ok.map(async (session, index) => {
      await sleep(index % 7500);
      while (polling) {
        const headers = { Cookie: session.cookie };
        await timed('xem bài nộp', `${base}/api/portal/submissions`, { headers });
        await timed('xem bảng vòng loại', `${base}/api/portal/tournaments/${tournamentId}/swiss`, { headers });
        await sleep(5000 + Math.random() * 5000);
      }
    });
    stopViewers = () => { polling = false; };
    // 3. Fake graders over the real protocol.
    const agents = [];
    for (let i = 0; i < AGENTS; i++) {
      const created = await adminCall('POST', '/api/admin/graders', { name: `tai-${i + 1}` });
      const agent = new GraderAgent({ url: base, id: created.id, secret: created.secret, slots: 2, managerFactory: fakeManager, workDir: path.join(WORK, `agent-${i}`), pollMs: 250, heartbeatMs: 5000, log: () => {} });
      await agent.start(); agents.push(agent);
    }
    // 4. Deadline burst: SUBMITS per team, denser towards the end of the window (t = W·√u), 10% of files close to 1 MiB.
    const template = fs.readFileSync(path.join(__dirname, '../bots/templates/python/main.py'));
    const big = Buffer.concat([template, Buffer.from(`\n# ${'x'.repeat(1000)}\n`.repeat(1000))]).subarray(0, 1000000);
    await phase('nộp bài sát hạn', async () => {
      const jobs = [], receipts = [], errors = {}; let retries = 0, failed = 0;
      for (const [user, session] of byTeam) for (let k = 0; k < SUBMITS; k++) jobs.push({ user, session, k, at: WINDOW * Math.sqrt(Math.random()), file: Math.random() < 0.1 ? big : template });
      const start = performance.now();
      await Promise.all(jobs.map(async job => {
        await sleep(job.at); const first = performance.now();
        for (let attempt = 0; attempt < 120; attempt++) {
          const form = new FormData(); form.append('bot', new Blob([job.file]), 'main.py');
          const { response, body } = await timed(job.file === big ? 'nộp bài 1 MB' : 'nộp bài', `${base}/api/portal/stages/${stageId}/submissions`,
            { method: 'POST', body: form, headers: { Cookie: job.session.cookie, 'X-CSRF-Token': job.session.csrf, 'Idempotency-Key': `tai-thu-${job.user}-lan-${job.k}` } });
          if (response?.status === 202) { const ms = performance.now() - first; receipts.push(ms); record('biên nhận (kể cả thử lại)', ms, 202); return; }
          // Like a browser user: try again on "busy" (429) or server/network trouble; any other refusal is final.
          if (response && response.status !== 429 && response.status < 500) { failed++; errors[response.status] = Buffer.from(body).toString('utf8').slice(0, 200); return; }
          retries++; await sleep(1000 + Math.random() * 2000);
        }
        failed++;
      }));
      return { submissions: jobs.length, receipted: receipts.length, failed, retries, errors, spreadSeconds: Math.round((performance.now() - start) / 1000) };
    });
    // 5. Checks drain (fake sandbox, 2 test games each, all through the coordinator).
    await phase('kiểm tra bài (máy chấm giả)', async () => {
      let queue;
      for (;;) {
        queue = (await adminCall('GET', '/api/admin/monitor')).queue;
        if (!queue.some(row => ['queued', 'running'].includes(row.job_status))) break;
        await sleep(3000);
      }
      return { queue };
    });
    let t = await adminCall('GET', `/api/admin/tournaments/${tournamentId}`);
    t = await adminCall('POST', `/api/admin/tournaments/${tournamentId}/close`, { expectedRevision: t.revision, reason: "Hết hạn nộp (tải thử)" });
    t = await adminCall('POST', `/api/admin/tournaments/${tournamentId}/lock`, { expectedRevision: t.revision, reason: 'Tải thử' });
    // 6. Qualifier: ROUNDS Swiss rounds through the fake graders.
    await phase(`vòng loại ${TEAMS} đội × ${ROUNDS} lượt`, async () => {
      let swiss = await adminCall('POST', `/api/admin/tournaments/${tournamentId}/swiss/start`, { expectedRevision: t.revision, seed: 'tai-thu' });
      const rounds = [];
      for (let round = 1; round <= ROUNDS; round++) {
        const start = performance.now();
        for (;;) { swiss = await adminCall('GET', `/api/admin/tournaments/${tournamentId}/swiss`); if (swiss.rounds.at(-1)?.status === 'finished') break; if (swiss.status === 'paused') throw new Error(`Vòng loại tạm dừng: ${swiss.controlReason}`); await sleep(2000); }
        const games = swiss.pairs.filter(p => p.round_id === swiss.rounds.at(-1).id).reduce((n, p) => n + p.games.length, 0);
        rounds.push({ round, seconds: Math.round((performance.now() - start) / 1000), games });
        log(`   lượt ${round}: ${rounds.at(-1).seconds} s, ${games} ván`);
        if (round < ROUNDS) { const nextStart = performance.now(); swiss = await adminCall('POST', `/api/admin/tournaments/${tournamentId}/swiss/next`, { expectedRevision: swiss.revision }); rounds.at(-1).pairingMs = Math.round(performance.now() - nextStart); }
      }
      return { rounds, games: rounds.reduce((n, r) => n + r.games, 0) };
    });
    for (const agent of agents) await agent.stop();
    // 7. Publish, then 4,000 simultaneous reads of the public site.
    await phase('công bố + 4.000 lượt đọc site', async () => {
      await adminCall('POST', `/api/admin/tournaments/${tournamentId}/publications`, { reason: 'Tải thử' });
      let latest;
      for (let i = 0; i < 120 && !latest; i++) { const { response, body } = await timed('site latest', `${base}/site/t/${tournamentId}/latest.json`); if (response?.ok) latest = json(body); else await sleep(1000); }
      await Promise.all(Array.from({ length: 4000 }, (_, i) => timed('site công khai', `${base}/site/${i % 2 ? `t/${tournamentId}/latest.json` : latest.files.summary}`)));
      return { publishedVersion: latest.version };
    });
  } catch (error) { phases.error = error.message; console.error(error); } finally {
    stopViewers(); await Promise.allSettled(viewers); stopHealth();
  }
  return finish();

  function finish() {
    usage.stop(); child.kill('SIGTERM');
    const peak = key => Math.max(0, ...usage.rows.map(r => r[key])), mean = key => Math.round(usage.rows.reduce((s, r) => s + r[key], 0) / Math.max(1, usage.rows.length));
    const report = { date: new Date().toISOString(), machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1073741824), kernel: os.release(), node: process.version },
      params: { teams: TEAMS, submitsPerTeam: SUBMITS, viewersPerTeam: VIEWERS, windowSeconds: WINDOW / 1000, rounds: ROUNDS, agents: AGENTS, only: ONLY },
      totalSeconds: Math.round((performance.now() - began) / 1000), phases, stalls, latencyMs: summary(),
      server: { cpuPercentMean: mean('cpu'), cpuPercentPeak: peak('cpu'), rssMbPeak: peak('rss'), dbMbFinal: usage.rows.at(-1)?.db }, timeline: usage.rows };
    const file = path.join(OUT, `${new Date().toISOString().replace(/[:.]/g, '-')}${ONLY ? `-${ONLY}` : ''}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, timeline: `${usage.rows.length} mẫu → ${file}` }, null, 2));
  }
}
// Exit even if fake graders or keep-alive sockets are still open (e.g. after an error mid-run): the report is already written.
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 2000));
