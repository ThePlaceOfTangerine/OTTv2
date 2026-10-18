const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createUser } = require('../src/users');

async function seed(db) {
  const credentials = [];
  for (const [username, role] of [['admin', 'admin'], ...Array.from({ length: 20 }, (_, i) => [`contestant${String(i + 1).padStart(2, '0')}`, 'contestant'])]) {
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) continue;
    const password = username;
    await createUser(db, { username, password, role });
    credentials.push({ username, password, role });
  }
  return credentials;
}
if (require.main === module) {
  const db = openDatabase(process.env.DB_PATH || path.join(__dirname, '../data/arena.sqlite'));
  seed(db).then(rows => {
    console.log('Lưu mật khẩu này ở nơi riêng tư. Chỉ hiển thị cho tài khoản vừa tạo.');
    console.table(rows);
  }).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.close());
}
module.exports = { seed };
