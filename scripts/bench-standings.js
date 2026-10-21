// Times the Swiss views on an existing database (e.g. the load test's): node scripts/bench-standings.js <arena.sqlite>
// Read-only use: opens the database, never starts runners.
const { performance } = require('node:perf_hooks');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

(async () => {
  const db = openDatabase(process.argv[2]);
  const app = await createApp({ db, github: null, turnstile: null, publicationOptions: { siteDir: '/tmp/bench-site', log: () => {} } });
  const { swiss } = app.locals, tournament = db.prepare('SELECT t.id FROM tournaments t JOIN swiss_sessions s ON 1 ORDER BY t.created_at DESC LIMIT 1').get();
  const stage = swiss.stage(tournament.id);
  const time = (label, fn, n = 20) => { fn(); const start = performance.now(); let size = 0; for (let i = 0; i < n; i++) size = JSON.stringify(fn()).length; console.log(label.padEnd(28), `${((performance.now() - start) / n).toFixed(1)} ms`, `${Math.round(size / 1024)} KB`); };
  console.log('entrants', swiss.entrants(stage.id).length, 'pairs', swiss.pairs(stage.id).length);
  time('ranking (bảng điểm)', () => swiss.ranking(stage.id));
  time('get thí sinh', () => swiss.get(tournament.id, false));
  time('get admin (có pairs+games)', () => swiss.get(tournament.id, true), 5);
  await app.locals.publications.close(); await app.locals.submissions.close(); db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
