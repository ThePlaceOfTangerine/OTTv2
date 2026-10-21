// npm run site:build  → rebuild the static results site from stored publications (PUBLIC_SITE_DIR, default data/public-site)
// npm run site:deploy → rebuild, then upload to Cloudflare Pages (needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_PAGES_PROJECT)
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { PublicationService } = require('../src/publish/publications');

(async () => {
  const db = openDatabase(process.env.DB_PATH || path.join(__dirname, '../data/arena.sqlite'));
  try {
    const publications = new PublicationService(db, { tournaments: null, swiss: null, brackets: null });
    const deploy = process.argv[2] === 'deploy';
    await publications.rebuild(deploy);
    if (publications.lastBuild?.error) throw new Error(publications.lastBuild.error);
    console.log(`Đã dựng ${publications.lastBuild.files} file vào ${publications.siteDir}`);
    if (deploy) {
      const last = db.prepare('SELECT status,output FROM site_deploys ORDER BY id DESC LIMIT 1').get();
      console.log(`Cloudflare Pages: ${last.status}\n${last.output || ''}`);
      if (last.status !== 'done') process.exitCode = 1;
    }
  } finally { db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
