const http = require('node:http');
const path = require('node:path');
const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');
const { attachLegacy } = require('./src/legacy');
const { httpConfig } = require('./src/http-config');

async function start({ dbPath = process.env.DB_PATH || path.join(__dirname, 'data/arena.sqlite'), port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1' } = {}) {
  const webOptions = { secureCookies: process.env.COOKIE_SECURE === 'true', trustedProxies: process.env.TRUSTED_PROXIES || '', publicOrigin: process.env.PUBLIC_ORIGIN || '' };
  httpConfig(webOptions);
  const db = openDatabase(dbPath);
  const app = await createApp({ db, ...webOptions });
  const server = http.createServer(app);
  const detachLegacy = attachLegacy(server);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  } catch (error) { detachLegacy(); db.close(); throw error; }
  app.locals.submissions.start();
  app.locals.scoring.start();
  app.locals.swiss.start();
  app.locals.bracketRunner.start();
  const close = () => new Promise(resolve => {
    detachLegacy();
    const stopSubmissions = app.locals.submissions.close();
    const stopScoring = app.locals.scoring.close();
    const stopSwiss = app.locals.swiss.close();
    const stopBracket = app.locals.bracketRunner.close();
    server.close(async () => { await Promise.all([app.locals.matches.active, stopSubmissions, stopScoring, stopSwiss, stopBracket]); db.close(); resolve(); });
    server.closeIdleConnections();
  });
  return { server, db, close };
}
if (require.main === module) start().then(instance => {
  console.log(`OTTv2 Arena: http://127.0.0.1:${instance.server.address().port}/portal`);
  console.log('Admin: /admin | Game trực tiếp: /legacy/');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => instance.close().then(() => process.exit(0)));
}).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { start };
