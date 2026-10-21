// Phase 8: real sandbox speed (CAPACITY.md). Run as root on Linux/WSL with bubblewrap and the grader rootfs (/opt/arena), e.g. in ott-build:
//   node scripts/load-real-games.js [--teams 40] [--rounds 5] [--slots 4] [--cpp 10] [--out output/load]
// One real grader process (scripts/grader.js, SANDBOX_BACKEND=bwrap) checks every submission (compile + 2 test games) and plays the
// qualifier; teams × rounds = 200 real games by default. Bots: sample Python and C++ bots with a seeded twist so games differ.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/passwords');

const argv = process.argv.slice(2), arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const TEAMS = Number(arg('teams', 40)), ROUNDS = Number(arg('rounds', 5)), SLOTS = Number(arg('slots', 4)), CPP = Number(arg('cpp', 10));
const OUT = path.resolve(arg('out', path.join(__dirname, '../output/load'))), WORK = path.join(os.tmpdir(), 'ott-real'), PASSWORD = 'mat-khau-tai-thu-2026';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  const dbFile = path.join(WORK, 'arena.sqlite'), storage = path.join(WORK, 'subs');
  const db = openDatabase(dbFile), hash = await hashPassword(PASSWORD);
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at,must_change_password) VALUES (1,'btc',?,'admin',0,0)").run(hash);
  for (let i = 1; i <= TEAMS; i++) db.prepare("INSERT INTO users(id,username,password_hash,role,created_at,must_change_password) VALUES (?,?,?,'contestant',0,0)").run(i + 1, `doi${i}`, hash);
  const seedApp = await createApp({ db, github: null, turnstile: null, submissionOptions: { storageRoot: storage }, publicationOptions: { siteDir: path.join(WORK, 'site'), log: () => {} } });
  let t = seedApp.locals.tournaments.create(1, { name: 'Ván thật', config: { maxTeams: TEAMS, swissRounds: ROUNDS, topN: 4 } });
  t = seedApp.locals.tournaments.replaceEntrants(t.id, 1, { expectedRevision: t.revision, userIds: Array.from({ length: TEAMS }, (_, i) => i + 2) });
  t = seedApp.locals.tournaments.stages.open(t.id, 1, { expectedRevision: t.revision, closesAt: Date.now() + 3600000 });
  const stageId = t.stages[0].id; await seedApp.locals.publications.close(); await seedApp.locals.submissions.close(); db.close();

  const server = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '../server.js')], { env: { ...process.env, DB_PATH: dbFile, SUBMISSIONS_PATH: storage, PORT: '0', HOST: '127.0.0.1', LOCAL_GRADING: '0', PUBLIC_SITE_DIR: path.join(WORK, 'site') }, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((resolve, reject) => { let out = ''; server.stdout.on('data', c => { out += c; const m = out.match(/127\.0\.0\.1:(\d+)\/portal/); if (m) resolve(`http://127.0.0.1:${m[1]}`); }); server.once('exit', () => reject(new Error(out))); });
  const loginAs = async username => { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) }); return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: (await r.json()).csrfToken }; };
  const admin = await loginAs('btc');
  const call = async (method, route, body) => { const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await r.json(); if (!r.ok) throw new Error(`${route}: ${JSON.stringify(data)}`); return data; };
  const grader = await call('POST', '/api/admin/graders', { name: 'bwrap-thu' });
  const agent = spawn(process.execPath, ['--no-warnings', path.join(__dirname, 'grader.js')], { env: { ...process.env, COORDINATOR_URL: base, GRADER_ID: grader.id, GRADER_SECRET: grader.secret, GRADER_SLOTS: String(SLOTS), SANDBOX_BACKEND: 'bwrap', GRADER_WORKDIR: path.join(WORK, 'grader') }, stdio: ['ignore', 'inherit', 'inherit'] });
  const report = { date: new Date().toISOString(), machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1073741824), kernel: os.release() }, params: { teams: TEAMS, rounds: ROUNDS, slots: SLOTS, cpp: CPP } };
  try {
    // Each team's bot: a sample with a different "score" tie-break, so games are not all identical.
    const py = fs.readFileSync(path.join(__dirname, '../bots/python-greedy/main.py'), 'utf8'), cpp = fs.readFileSync(path.join(__dirname, '../bots/cpp-greedy/main.cpp'), 'utf8');
    const submitted = performance.now(), ids = [];
    for (let i = 1; i <= TEAMS; i++) {
      const session = await loginAs(`doi${i}`), isCpp = i <= CPP, form = new FormData();
      form.append('bot', new Blob([isCpp ? `${cpp}\n// doi ${i}\n` : `${py}\n# doi ${i}\n`]), isCpp ? 'main.cpp' : 'main.py');
      const r = await fetch(`${base}/api/portal/stages/${stageId}/submissions`, { method: 'POST', body: form, headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } });
      if (r.status !== 202) throw new Error(`nộp bài đội ${i}: ${r.status} ${await r.text()}`); ids.push({ id: (await r.json()).id, cpp: isCpp });
    }
    log(`Đã nộp ${TEAMS} bài (${CPP} C++). Chờ máy chấm bwrap kiểm tra...`);
    let monitor;
    for (;;) { monitor = await call('GET', '/api/admin/monitor'); if (!monitor.queue.some(q => ['queued', 'running'].includes(q.job_status))) break; await sleep(2000); }
    const checkSeconds = (performance.now() - submitted) / 1000;
    const rows = (await call('GET', '/api/admin/monitor')).jobs;
    report.checks = { seconds: Math.round(checkSeconds), perSubmissionSlotSeconds: Math.round(checkSeconds * SLOTS / TEAMS * 10) / 10, statuses: rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {}) };
    log(`Kiểm tra xong sau ${report.checks.seconds} s:`, report.checks.statuses);
    t = await call('GET', `/api/admin/tournaments/${t.id}`);
    t = await call('POST', `/api/admin/tournaments/${t.id}/close`, { expectedRevision: t.revision, reason: 'Hết hạn nộp (đo ván thật)' });
    t = await call('POST', `/api/admin/tournaments/${t.id}/lock`, { expectedRevision: t.revision, reason: 'Đo ván thật' });
    let swiss = await call('POST', `/api/admin/tournaments/${t.id}/swiss/start`, { expectedRevision: t.revision, seed: 'van-that' });
    const rounds = [], started = performance.now();
    for (let round = 1; round <= ROUNDS; round++) {
      const start = performance.now();
      for (;;) { swiss = await call('GET', `/api/admin/tournaments/${t.id}/swiss`); if (swiss.rounds.at(-1).status === 'finished') break; if (swiss.status === 'paused') throw new Error(swiss.controlReason); await sleep(1000); }
      const games = swiss.pairs.filter(p => p.round_id === swiss.rounds.at(-1).id).flatMap(p => p.games);
      rounds.push({ round, seconds: Math.round((performance.now() - start) / 100) / 10, games: games.length });
      log(`Lượt ${round}: ${rounds.at(-1).seconds} s, ${games.length} ván`);
      if (round < ROUNDS) swiss = await call('POST', `/api/admin/tournaments/${t.id}/swiss/next`, { expectedRevision: swiss.revision });
    }
    // Moves and CPU per game from the stored replays (the coordinator's database).
    const stats = openDatabase(dbFile).prepare("SELECT json_array_length(replay_json,'$.turns') moves, json_extract(replay_json,'$.cpu_ms[0]')+json_extract(replay_json,'$.cpu_ms[1]') cpu, json_extract(replay_json,'$.result.winReason') reason FROM swiss_games WHERE status='finished'").all();
    const games = rounds.reduce((n, r) => n + r.games, 0), seconds = (performance.now() - started) / 1000;
    report.qualifier = { rounds, games, seconds: Math.round(seconds), gamesPerHourAllSlots: Math.round(games / seconds * 3600), gamesPerHourPerSlot: Math.round(games / seconds * 3600 / SLOTS),
      slotSecondsPerGame: Math.round(seconds * SLOTS / games * 10) / 10, movesMean: Math.round(stats.reduce((s, g) => s + g.moves, 0) / stats.length),
      botCpuMsPerGameMean: Math.round(stats.reduce((s, g) => s + g.cpu, 0) / stats.length), endings: stats.reduce((m, g) => ({ ...m, [g.reason]: (m[g.reason] || 0) + 1 }), {}) };
  } finally { agent.kill('SIGTERM'); server.kill('SIGTERM'); }
  const file = path.join(OUT, `${new Date().toISOString().replace(/[:.]/g, '-')}-real-games.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); console.log(`→ ${file}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
