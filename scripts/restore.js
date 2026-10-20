// Stop the server first. npm run restore -- <snapshot folder> [--force]
// Uses DB_PATH and SUBMISSIONS_PATH (defaults data/arena.sqlite, data/submissions). An existing database is moved aside, never deleted.
const path = require('node:path');
const { restoreSnapshot } = require('../src/backup/snapshots');

const args = process.argv.slice(2), snapshot = args.find(a => !a.startsWith('--'));
if (!snapshot) { console.error('Cách dùng: npm run restore -- <thư mục snapshot> [--force]'); process.exit(2); }
restoreSnapshot({ snapshot: path.resolve(snapshot), force: args.includes('--force'),
  dbPath: path.resolve(process.env.DB_PATH || path.join(__dirname, '../data/arena.sqlite')),
  submissionsRoot: path.resolve(process.env.SUBMISSIONS_PATH || path.join(__dirname, '../data/submissions')) })
  .then(result => console.log(`Đã khôi phục ${result.name} (${new Date(result.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' })}), ${result.submissions} bài nộp, schema ${result.schema}. Khởi động lại server để chạy migration nếu cần.`))
  .catch(error => { console.error(`Không khôi phục: ${error.message}`); process.exitCode = 1; });
