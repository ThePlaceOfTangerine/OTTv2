const { hashPassword } = require('./passwords');

async function createUser(db, { username, password, role = 'contestant', mustChangePassword = role === 'contestant' }) {
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username || '')) throw new Error('Tên tài khoản phải có 3–40 ký tự chữ, số, _, . hoặc -.');
  const defaultAdmin = role === 'admin' && username === 'admin' && password === 'admin';
  if (typeof password !== 'string' || (password.length < 12 && !defaultAdmin && !(role === 'contestant' && mustChangePassword && password === username)) || Buffer.byteLength(password) > 72) throw new Error('Mật khẩu cần ít nhất 12 ký tự, tối đa 72 byte.');
  if (!['admin', 'contestant'].includes(role)) throw new Error('Vai trò không hợp lệ.');
  const hash = await hashPassword(password);
  return db.prepare('INSERT INTO users(username,password_hash,role,created_at,must_change_password) VALUES (?,?,?,?,?)')
    .run(username, hash, role, Date.now(), Number(mustChangePassword)).lastInsertRowid;
}
module.exports = { createUser };
