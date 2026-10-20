const crypto = require('node:crypto');
const { promisify } = require('node:util');
const bcrypt = require('bcryptjs');

// scrypt (node:crypto) runs natively in libuv's thread pool: logins use several cores and never stall the server.
// bcryptjs is pure JavaScript on the main thread (~250 ms per check): the Phase 8 load test needed > 10 minutes for 4,000 logins.
// Parameters from the OWASP Password Storage Cheat Sheet (N=2^15, r=8, p=3: 32 MiB per hash).
const scrypt = promisify(crypto.scrypt);
const N = 2 ** 15, R = 8, P = 3, KEY = 32, MAXMEM = 64 * 1024 * 1024;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16), key = await scrypt(password, salt, KEY, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
// Accepts both formats: accounts created before Phase 8 keep their bcrypt hash until their next successful login.
async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  if (!stored.startsWith('scrypt$')) return bcrypt.compare(password, stored);
  const [, n, r, p, salt, expected] = stored.split('$'), want = Buffer.from(expected, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return crypto.timingSafeEqual(key, want);
}
const needsRehash = stored => !String(stored).startsWith(`scrypt$${N}$${R}$${P}$`);
module.exports = { hashPassword, verifyPassword, needsRehash };
