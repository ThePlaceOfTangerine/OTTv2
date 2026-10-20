const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Fingerprint of the code that decides results; coordinator and graders must match or games would be judged by different rules.
const root = path.resolve(__dirname, '..');
const files = [...fs.readdirSync(path.join(root, 'game')).filter(name => name.endsWith('.js')).map(name => `game/${name}`),
  'grader/play.js', 'submissions/check.js', 'submissions/source.js'].sort();
const hash = crypto.createHash('sha256');
// Line endings differ between Windows checkouts and the Linux rootfs; normalise them.
for (const file of files) hash.update(file + '\0').update(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'));
module.exports = { ENGINE_HASH: hash.digest('hex').slice(0, 16) };
