// Password hashing (scrypt) runs in libuv's thread pool; the default 4 threads would cap logins on many-core servers.
process.env.UV_THREADPOOL_SIZE ||= String(Math.min(16, Math.max(4, require('node:os').availableParallelism())));
const http = require('node:http');
const path = require('node:path');
const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');
const { attachLegacy } = require('./src/legacy');
const { httpConfig } = require('./src/http-config');
const { loadSettings } = require('./src/settings');

// Exit code 75 asks start.bat (classroom package) to start the server again, e.g. after the first-run wizard.
const RESTART = 75;

async function start({ onRestart, dbPath = process.env.DB_PATH || path.join(__dirname, 'data/arena.sqlite'), port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1' } = {}) {
  const webOptions = { secureCookies: process.env.COOKIE_SECURE === 'true', trustedProxies: process.env.TRUSTED_PROXIES || '', publicOrigin: process.env.PUBLIC_ORIGIN || '' };
  httpConfig(webOptions);
  const db = openDatabase(dbPath);
  const app = await createApp({ db, ...webOptions, onRestart });
  const server = http.createServer(app);
  // Pages poll every 5–10 s; Node's default 5 s keep-alive closes sockets just as browsers reuse them (resets seen in the Phase 8 load test).
  server.keepAliveTimeout = 65000; server.headersTimeout = 66000;
  const detachLegacy = attachLegacy(server);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  } catch (error) { detachLegacy(); db.close(); throw error; }
  // LOCAL_GRADING=0 leaves submission checks and tournament games to remote graders (npm run grader).
  const local = process.env.LOCAL_GRADING !== '0';
  app.locals.submissions.start({ local });
  app.locals.scoring.start();
  app.locals.swiss.start({ local });
  app.locals.bracketRunner.start({ local });
  app.locals.repos.start();
  app.locals.publications.start();
  app.locals.snapshots.start();
  const close = () => new Promise(resolve => {
    detachLegacy();
    app.locals.repos.close();
    const stopPublications = app.locals.publications.close();
    const stopSnapshots = app.locals.snapshots.close();
    const stopSubmissions = app.locals.submissions.close();
    const stopScoring = app.locals.scoring.close();
    const stopSwiss = app.locals.swiss.close();
    const stopBracket = app.locals.bracketRunner.close();
    server.close(async () => { await Promise.all([app.locals.matches.active, stopSubmissions, stopScoring, stopSwiss, stopBracket, stopPublications, stopSnapshots]); db.close(); resolve(); });
    server.closeIdleConnections();
  });
  return { server, db, close };
}
if (require.main === module) {
  loadSettings();
  let instance;
  start({ onRestart: () => instance.close().then(() => process.exit(RESTART)) }).then(started => {
    instance = started;
    const url = `http://127.0.0.1:${instance.server.address().port}`;
    console.log(`OTTv2 Arena: ${url}/portal`);
    console.log('Admin: /admin | Game trực tiếp: /legacy/');
    if (process.env.OTT_OPEN_BROWSER === '1' && process.platform === 'win32') require('node:child_process').spawn('cmd', ['/c', 'start', '', `${url}/admin`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    // SIGHUP: the console window of start.bat was closed.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => instance.close().then(() => process.exit(0)));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { start };
