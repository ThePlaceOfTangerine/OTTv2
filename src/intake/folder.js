const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const SOURCE = /\.(py|cpp|h|hpp)$/, NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const FILE_LIMIT = 1024 * 1024, TOTAL_LIMIT = 5 * 1024 * 1024;

// Minimal ZIP writer (deflate) so a folder becomes the same .zip the portal accepts; no dependency.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = data => { let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = [], directory = []; let offset = 0;
  for (const { name, data } of files) {
    const fileName = Buffer.from(name), packed = zlib.deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    parts.push(local, fileName, packed); directory.push(central, fileName); offset += local.length + fileName.length + packed.length;
  }
  const listing = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(listing.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, listing, end]);
}

// <team>/ with ott.json + bot/ (same layout as a GitHub repo), <team>.zip as uploaded on the portal, or a single <team>.py / <team>.cpp.
async function readEntry(dir, name) {
  const full = path.join(dir, name), stat = await fs.lstat(full);
  if (stat.isSymbolicLink()) fail(400, 'Không nhận symlink.');
  if (stat.isFile()) {
    const match = name.match(/^(.+)\.(zip|py|cpp)$/i);
    if (!match) return null;
    if (stat.size > (match[2].toLowerCase() === 'zip' ? TOTAL_LIMIT : FILE_LIMIT)) fail(400, 'File vượt giới hạn (1 MiB mã nguồn, 5 MiB ZIP).');
    return { team: match[1], filename: `${match[2].toLowerCase() === 'zip' ? 'bot' : 'main'}.${match[2].toLowerCase()}`, buffer: await fs.readFile(full), entry: '' };
  }
  if (!stat.isDirectory()) return null;
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(full, 'ott.json'), 'utf8')); } catch { fail(400, 'Thư mục đội cần ott.json hợp lệ ở gốc.'); }
  if (typeof manifest?.entry !== 'string' || !manifest.entry) fail(400, 'ott.json cần entry (tính từ thư mục bot/).');
  const files = []; let total = 0;
  async function walk(current, relative) {
    for (const item of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relative ? `${relative}/${item.name}` : item.name;
      if (item.isSymbolicLink()) fail(400, `Không nhận symlink: bot/${rel}`);
      if (!NAME.test(item.name)) fail(400, `Tên file không hợp lệ: bot/${rel}`);
      if (item.isDirectory()) { await walk(path.join(current, item.name), rel); continue; }
      if (!item.isFile() || !SOURCE.test(item.name)) continue;
      const data = await fs.readFile(path.join(current, item.name)); total += data.length;
      if (data.length > FILE_LIMIT || total > TOTAL_LIMIT || files.length >= 64) fail(400, 'Thư mục bot/ vượt giới hạn (64 file, 1 MiB/file, 5 MiB).');
      files.push({ name: rel, data });
    }
  }
  try { await walk(path.join(full, 'bot'), ''); } catch (error) { if (error.code === 'ENOENT') fail(400, 'Thiếu thư mục bot/.'); throw error; }
  if (!files.length) fail(400, 'Thư mục bot/ không có file mã nguồn.');
  return { team: name, filename: 'bot.zip', buffer: zip(files), entry: manifest.entry };
}

// Organizer fallback at the desk: imports every team found in a folder (USB stick, LAN share) through the normal submission pipeline.
async function importFolder({ db, submissions, tournaments, stageId, dir, receivedAt = null, actorId, reason }) {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) fail(400, 'Cần lý do nhập bài từ 1 đến 500 ký tự.');
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) fail(400, 'Cần đường dẫn tuyệt đối tới thư mục trên máy chủ.');
  const stage = db.prepare('SELECT * FROM tournament_stages WHERE id=?').get(stageId);
  if (!stage) fail(404, 'Không tìm thấy giai đoạn nhận bài.');
  tournaments.actor(actorId);
  let names;
  try { if (!(await fs.stat(dir)).isDirectory()) throw new Error(); names = (await fs.readdir(dir)).sort(); } catch { fail(400, 'Không mở được thư mục trên máy chủ.'); }
  const report = [];
  for (const name of names.filter(n => !n.startsWith('.'))) {
    let item;
    try { item = await readEntry(dir, name); } catch (error) { report.push({ name, status: 'error', message: error.message }); continue; }
    if (!item) continue;
    const user = db.prepare("SELECT u.id,u.username FROM users u JOIN tournament_stage_entrants e ON e.user_id=u.id WHERE e.stage_id=? AND u.username=? COLLATE NOCASE").get(stageId, item.team);
    if (!user) { report.push({ name, status: 'error', message: `Không có đội ${item.team} trong giai đoạn này.` }); continue; }
    // Same content for the same team and stage maps to the same key, so re-importing a USB stick does not create new versions.
    const key = 'usb-' + crypto.createHash('sha256').update(`${stageId}\0${user.id}\0${item.entry}\0`).update(item.buffer).digest('hex').slice(0, 40);
    const existing = db.prepare('SELECT id,version FROM bot_submissions WHERE stage_id=? AND user_id=? AND idempotency_key=?').get(stageId, user.id, key);
    if (existing) { report.push({ name, team: user.username, status: 'duplicate', submissionId: existing.id, version: existing.version }); continue; }
    try {
      const submission = await submissions.submit({ userId: user.id, stageId, filename: item.filename, buffer: item.buffer, entry: item.entry, idempotencyKey: key, receivedAt, origin: 'usb' });
      report.push({ name, team: user.username, status: 'queued', submissionId: submission.id, version: submission.version });
    } catch (error) { report.push({ name, team: user.username, status: 'error', message: error.message }); }
  }
  tournaments.event(stage.tournament_id, actorId, 'folder_intake', { stageId, folder: path.basename(dir), receivedAt, reason: reason.trim(),
    queued: report.filter(r => r.status === 'queued').length, duplicates: report.filter(r => r.status === 'duplicate').length, errors: report.filter(r => r.status === 'error').length });
  return { report };
}
module.exports = { importFolder, zip };
