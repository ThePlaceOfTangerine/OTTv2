// npm run import:folder -- --stage <stageId> --dir <folder> --reason "<lý do>" [--received-at 2026-11-01T09:58+07:00]
// Records the submissions in the database (DB_PATH, SUBMISSIONS_PATH); the running server checks them in the sandbox as usual.
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { RuleSetService } = require('../src/rule-sets');
const { TournamentService } = require('../src/tournaments');
const { TournamentStages } = require('../src/tournament-stages');
const { SubmissionService } = require('../src/submissions/service');
const { importFolder } = require('../src/intake/folder');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
(async () => {
  if (!arg('stage') || !arg('dir') || !arg('reason')) throw new Error('Cách dùng: npm run import:folder -- --stage <id> --dir <thư mục> --reason "<lý do>" [--received-at <ISO>]');
  const receivedAt = arg('received-at') ? Date.parse(arg('received-at')) : null;
  if (Number.isNaN(receivedAt)) throw new Error('--received-at không phải thời điểm hợp lệ (ví dụ 2026-11-01T09:58+07:00).');
  const db = openDatabase(process.env.DB_PATH || path.join(__dirname, '../data/arena.sqlite'));
  try {
    const ruleSets = new RuleSetService(db), tournaments = new TournamentService(db, { ruleSets });
    const stages = new TournamentStages(db, { tournaments }); tournaments.stages = stages;
    const submissions = new SubmissionService(db, { stages });
    const admin = db.prepare("SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL ORDER BY id LIMIT 1").get();
    const { report } = await importFolder({ db, submissions, tournaments, stageId: arg('stage'), dir: path.resolve(arg('dir')), receivedAt, actorId: admin.id, reason: arg('reason') });
    for (const row of report) console.log(`${row.status.padEnd(9)} ${row.name}${row.team ? ` → ${row.team}` : ''}${row.version ? ` v${row.version}` : ''}${row.message ? ` · ${row.message}` : ''}`);
    if (report.some(row => row.status === 'error')) process.exitCode = 1;
  } finally { db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
