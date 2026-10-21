const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const CHUNK_BYTES = 50 * 1024 * 1024;
const KDF = { N: 32768, r: 8, p: 1 };
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const canonical = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);

// Synced tables in foreign-key order. scope(row, db) names the single writer; logs and publications are matched by natural keys
// (their integer ids are local to each machine). Machine-local tables (sessions, graders, schedules, deploys...) are never synced.
const viaStage = (db, stageId) => { const s = db.prepare('SELECT tournament_id FROM tournament_stages WHERE id=?').get(stageId); return s ? `tournament:${s.tournament_id}` : 'system'; };
const viaSubmission = (db, id) => { const s = db.prepare('SELECT stage_id FROM bot_submissions WHERE id=?').get(id); return s?.stage_id ? viaStage(db, s.stage_id) : 'system'; };
const TABLES = [
  { name: 'users', key: ['id'], scope: () => 'system' },
  { name: 'app_secrets', key: ['name'], scope: () => 'system' },
  // Sample rule sets are seeded on every machine at start-up; only their content has to match, not the seeding time.
  { name: 'rule_sets', key: ['id'], ignore: ['created_at'], scope: () => 'system' },
  { name: 'rule_versions', key: ['rule_set_id', 'version'], ignore: ['created_at'], scope: () => 'system' },
  { name: 'team_profiles', key: ['user_id'], scope: () => 'system' },
  { name: 'team_repos', key: ['user_id'], scope: () => 'system' },
  { name: 'tournaments', key: ['id'], scope: r => `tournament:${r.id}` },
  { name: 'tournament_entrants', key: ['tournament_id', 'user_id'], scope: r => `tournament:${r.tournament_id}` },
  { name: 'tournament_events', natural: ['tournament_id', 'actor_id', 'created_at', 'kind', 'details_json'], scope: r => `tournament:${r.tournament_id}` },
  // Before their stage: a trigger refuses entrant rows once the stage is locked, so they must land while it is still absent or open
  // (foreign keys are deferred during import).
  { name: 'tournament_stage_entrants', key: ['stage_id', 'user_id'], scope: (r, db) => viaStage(db, r.stage_id) },
  { name: 'tournament_stages', key: ['id'], scope: r => `tournament:${r.tournament_id}` },
  { name: 'bot_submissions', key: ['id'], scope: (r, db) => r.stage_id ? viaStage(db, r.stage_id) : 'system', files: true },
  { name: 'submission_events', natural: ['submission_id', 'created_at', 'stage', 'message', 'details_json'], scope: (r, db) => viaSubmission(db, r.submission_id) },
  { name: 'submission_tests', key: ['id'], scope: (r, db) => viaSubmission(db, r.submission_id) },
  { name: 'active_bots', key: ['user_id'], scope: () => 'system' },
  { name: 'repo_snapshots', key: ['stage_id', 'user_id'], scope: (r, db) => viaStage(db, r.stage_id) },
  { name: 'swiss_sessions', key: ['stage_id'], scope: (r, db) => viaStage(db, r.stage_id) },
  { name: 'swiss_controls', key: ['stage_id'], scope: (r, db) => viaStage(db, r.stage_id) },
  { name: 'swiss_rounds', key: ['id'], scope: (r, db) => viaStage(db, r.stage_id) },
  { name: 'swiss_pairs', key: ['id'], scope: (r, db) => viaStage(db, db.prepare('SELECT stage_id FROM swiss_rounds WHERE id=?').get(r.round_id)?.stage_id) },
  { name: 'swiss_games', key: ['id'], scope: (r, db) => viaStage(db, db.prepare('SELECT r.stage_id FROM swiss_pairs p JOIN swiss_rounds r ON r.id=p.round_id WHERE p.id=?').get(r.pair_id)?.stage_id) },
  { name: 'tournament_qualifications', key: ['tournament_id'], scope: r => `tournament:${r.tournament_id}` },
  { name: 'tournament_final_rules', key: ['tournament_id'], scope: r => `tournament:${r.tournament_id}` },
  { name: 'tournament_final_intakes', key: ['tournament_id'], scope: r => `tournament:${r.tournament_id}` },
  { name: 'tournament_brackets', key: ['tournament_id'], scope: r => `tournament:${r.tournament_id}` },
  { name: 'bracket_runs', key: ['tournament_id'], scope: r => `tournament:${r.tournament_id}` },
  { name: 'bracket_games', key: ['id'], scope: r => `tournament:${r.tournament_id}` },
  { name: 'publications', natural: ['tournament_id', 'version'], scope: r => `tournament:${r.tournament_id}` },
  { name: 'score_rounds', key: ['id'], scope: () => 'system' },
  { name: 'score_entrants', key: ['round_id', 'user_id'], scope: () => 'system' },
  { name: 'score_matches', key: ['id'], scope: () => 'system' },
];
const keyColumns = table => table.key || table.natural;
const rowOf = (table, row) => { if (table.natural) delete row.id; return row; };
// Columns left out of the comparison hash (and never overwritten on import).
const hashOf = (table, row) => sha256(canonical(Object.fromEntries(Object.entries(row).filter(([column]) => !table.ignore?.includes(column)))));
const keyOf = (table, row) => JSON.stringify(keyColumns(table).map(column => row[column] ?? null));

function deriveKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || [...passphrase].length < 12) fail(400, 'Passphrase cần ít nhất 12 ký tự.');
  return crypto.scryptSync(passphrase.normalize('NFC'), salt, 32, { ...KDF, maxmem: 128 * 1024 * 1024 });
}
const seal = (key, aad, data) => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(aad)); const body = Buffer.concat([cipher.update(data), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); };
function open(key, aad, blob) {
  try { const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12)); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(blob.subarray(12, 28)); return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]); }
  catch { fail(400, 'Sai passphrase hoặc bundle đã bị sửa.'); }
}
async function walk(root) {
  const files = [];
  async function visit(dir, rel) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path.join(dir, entry.name), next); else if (entry.isFile()) files.push(next);
    }
  }
  if (fsSync.existsSync(root)) await visit(root, '');
  return files.sort();
}

// Writes <dir>/<bundleId>/{manifest.json, chunks/*.enc, files/*.enc}. kind 'full' carries every row; 'incremental' only rows changed since the last bundle for this peer.
async function exportBundle({ db, authority, submissionsRoot, peerId, dir, passphrase, kind = 'full', handovers = [], actorId = null, now = Date.now }) {
  const identity = db.prepare('SELECT * FROM sync_identity WHERE id=1').get(), peer = db.prepare('SELECT * FROM sync_peers WHERE node_id=?').get(peerId);
  if (!peer) fail(400, 'Chưa thêm máy đối tác này (dán public key trước).');
  if (!['full', 'incremental'].includes(kind)) fail(400, 'Loại bundle không hợp lệ.');
  if (!Array.isArray(handovers) || handovers.some(scope => typeof scope !== 'string')) fail(400, 'Danh sách bàn giao không hợp lệ.');
  for (const scope of handovers) if (!authority.owns(scope)) fail(409, `Máy này không giữ quyền ${scope}, không thể bàn giao.`);
  if (!path.isAbsolute(dir || '')) fail(400, 'Cần đường dẫn tuyệt đối tới thư mục xuất (ví dụ ổ USB).');
  const salt = crypto.randomBytes(16), key = deriveKey(passphrase, salt), bundleId = `${identity.node_id}-${now()}-${crypto.randomBytes(4).toString('hex')}`;
  const target = path.join(dir, `${bundleId}.ottbundle`), records = [], state = [];
  for (const table of TABLES) {
    const seen = new Set();
    for (const raw of db.prepare(`SELECT * FROM ${table.name}`).all()) {
      const row = rowOf(table, { ...raw }), rowKey = keyOf(table, row), hash = hashOf(table, row), scope = table.scope(row, db);
      seen.add(rowKey); state.push([table.name, rowKey, scope, hash]);
      const last = db.prepare('SELECT hash FROM sync_state WHERE peer=? AND table_name=? AND row_key=?').get(peerId, table.name, rowKey);
      if (kind === 'full' || last?.hash !== hash) records.push({ op: 'upsert', table: table.name, key: rowKey, scope, hash, row });
    }
    for (const last of db.prepare('SELECT row_key,scope FROM sync_state WHERE peer=? AND table_name=?').all(peerId, table.name))
      if (!seen.has(last.row_key)) records.push({ op: 'delete', table: table.name, key: last.row_key, scope: last.scope });
  }
  await fs.mkdir(path.join(target, 'chunks'), { recursive: true }); await fs.mkdir(path.join(target, 'files'), { recursive: true });
  // Submission files (upload, source, compiled artifact) go as encrypted blobs, one per distinct content.
  const blobs = new Map();
  for (const record of records.filter(r => r.op === 'upsert' && r.table === 'bot_submissions')) {
    for (const rel of await walk(path.join(submissionsRoot, record.row.id))) {
      const data = await fs.readFile(path.join(submissionsRoot, record.row.id, ...rel.split('/'))), hash = sha256(data);
      if (!blobs.has(hash)) { const name = crypto.randomUUID(); blobs.set(hash, name); await fs.writeFile(path.join(target, 'files', `${name}.enc`), seal(key, `${bundleId}:file:${name}`, data)); }
      records.push({ op: 'file', submission: record.row.id, path: rel, sha256: hash, blob: blobs.get(hash), scope: record.scope });
    }
  }
  const chunks = []; let lines = [], size = 0;
  const flush = async () => {
    if (!lines.length) return;
    const name = `data-${String(chunks.length + 1).padStart(3, '0')}.enc`, sealed = seal(key, `${bundleId}:chunk:${name}`, Buffer.from(lines.join('\n')));
    await fs.writeFile(path.join(target, 'chunks', name), sealed); chunks.push({ file: name, sha256: sha256(sealed), records: lines.length }); lines = []; size = 0;
  };
  for (const record of records) { const line = JSON.stringify(record); if (size + line.length > CHUNK_BYTES) await flush(); lines.push(line); size += line.length + 1; }
  await flush();
  const manifest = { format: 1, bundleId, kind, createdAt: now(), schema: db.prepare('SELECT MAX(version) v FROM migrations').get().v,
    from: { nodeId: identity.node_id, name: identity.name, publicKey: identity.public_key }, to: peerId, kdf: { ...KDF, salt: salt.toString('base64') },
    authority: authority.scopes(), handovers: handovers.map(scope => ({ scope, to: peerId })), chunks, blobs: blobs.size };
  manifest.signature = crypto.sign(null, Buffer.from(canonical(manifest)), identity.private_key).toString('base64');
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // Only after the bundle is fully written: hand over (this machine becomes read-only for those scopes) and remember what the peer now has.
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const scope of handovers) authority.set(scope, peerId, `Bàn giao trong ${bundleId}`);
    const upsert = db.prepare('INSERT INTO sync_state VALUES (?,?,?,?,?) ON CONFLICT(peer,table_name,row_key) DO UPDATE SET scope=excluded.scope,hash=excluded.hash');
    db.prepare('DELETE FROM sync_state WHERE peer=?').run(peerId);
    for (const [table, rowKey, scope, hash] of state) upsert.run(peerId, table, rowKey, scope, hash);
    db.prepare('INSERT INTO sync_bundles VALUES (?,?,?,?,?,?,?,?)').run(bundleId, 'export', peerId, kind, now(), actorId, records.length, JSON.stringify({ handovers, chunks: chunks.length, blobs: blobs.size }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { bundleId, path: target, records: records.length, chunks: chunks.length, blobs: blobs.size, handovers };
}

// Applies a bundle from a trusted peer. Rows of a scope are accepted only from that scope's current writer (or into an empty database
// when bootstrapping); anything else is reported as a conflict and left untouched. Re-importing the same bundle does nothing.
async function importBundle({ db, authority, submissionsRoot, dir, passphrase, actorId = null, now = Date.now }) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')); } catch { fail(400, 'Không đọc được manifest.json của bundle.'); }
  const peer = db.prepare('SELECT * FROM sync_peers WHERE node_id=?').get(manifest.from?.nodeId);
  if (!peer || peer.public_key.trim() !== String(manifest.from.publicKey).trim()) fail(403, 'Bundle đến từ máy chưa được tin cậy (chưa dán public key của máy này).');
  const { signature, ...signed } = manifest;
  let valid = false;
  try { valid = crypto.verify(null, Buffer.from(canonical(signed)), peer.public_key, Buffer.from(signature, 'base64')); } catch {}
  if (!valid) fail(400, 'Chữ ký bundle không hợp lệ (bundle đã bị sửa).');
  if (manifest.to !== authority.nodeId()) fail(400, 'Bundle này được xuất cho máy khác.');
  if (manifest.schema !== db.prepare('SELECT MAX(version) v FROM migrations').get().v) fail(409, 'Hai máy đang chạy phiên bản dữ liệu khác nhau; cập nhật mã nguồn cho giống nhau trước.');
  if (db.prepare('SELECT 1 FROM sync_bundles WHERE bundle_id=?').get(manifest.bundleId)) return { bundleId: manifest.bundleId, duplicate: true };
  const key = deriveKey(passphrase, Buffer.from(manifest.kdf.salt, 'base64')), records = [];
  for (const chunk of manifest.chunks) {
    const blob = await fs.readFile(path.join(dir, 'chunks', chunk.file));
    if (sha256(blob) !== chunk.sha256) fail(400, `Mảnh ${chunk.file} không khớp mã băm (hỏng hoặc bị sửa).`);
    for (const line of open(key, `${manifest.bundleId}:chunk:${chunk.file}`, blob).toString('utf8').split('\n')) records.push(JSON.parse(line));
  }
  const signer = manifest.from.nodeId;
  // An empty database (no accounts) is being seeded: take the sender's data and authority map as they are.
  const bootstrap = manifest.kind === 'full' && !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  const writer = scope => bootstrap ? signer : authority.owner(scope);
  const report = { inserted: 0, updated: 0, deleted: 0, unchanged: 0, files: 0, conflicts: [] }, accepted = new Set(), state = [];
  const tables = new Map(TABLES.map(t => [t.name, t]));
  db.exec('BEGIN IMMEDIATE'); db.exec('PRAGMA defer_foreign_keys = ON');
  try {
    for (const record of records) {
      if (record.op === 'file') continue;
      const table = tables.get(record.table); if (!table) { report.conflicts.push({ table: record.table, key: record.key, reason: 'Bảng không được đồng bộ' }); continue; }
      const columns = keyColumns(table), values = JSON.parse(record.key), where = columns.map(c => `${c} IS ?`).join(' AND ');
      const existing = db.prepare(`SELECT * FROM ${table.name} WHERE ${where}`).get(...values);
      const allowed = writer(record.scope) === signer, conflict = reason => report.conflicts.push({ table: table.name, key: record.key, scope: record.scope, reason });
      try {
        if (record.op === 'delete') {
          if (!existing) continue;
          if (!allowed) { conflict('Máy gửi không giữ quyền ghi'); continue; }
          db.prepare(`DELETE FROM ${table.name} WHERE ${where}`).run(...values); report.deleted++; continue;
        }
        if (existing && hashOf(table, rowOf(table, { ...existing })) === record.hash) { report.unchanged++; state.push([table.name, record.key, record.scope, record.hash]); if (table.files) accepted.add(record.row.id); continue; }
        if (!allowed) { conflict(existing ? 'Khác dữ liệu trên máy này và máy gửi không giữ quyền ghi' : 'Máy gửi không giữ quyền ghi'); continue; }
        const names = Object.keys(record.row);
        if (!existing) db.prepare(`INSERT INTO ${table.name}(${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map(n => record.row[n]));
        else if (table.natural) { conflict('Bản ghi nhật ký/công bố không được sửa'); continue; }
        else { const sets = names.filter(n => !columns.includes(n) && !table.ignore?.includes(n)); db.prepare(`UPDATE ${table.name} SET ${sets.map(n => `${n}=?`).join(',')} WHERE ${where}`).run(...sets.map(n => record.row[n]), ...values); }
        report[existing ? 'updated' : 'inserted']++; state.push([table.name, record.key, record.scope, record.hash]);
        if (table.files) accepted.add(record.row.id);
      } catch (error) { conflict(`Không áp dụng được: ${error.message}`); }
    }
    if (bootstrap) for (const { scope, nodeId } of manifest.authority) authority.set(scope, nodeId, `Khởi tạo từ ${manifest.bundleId}`);
    for (const { scope, to } of manifest.handovers) {
      if (to !== authority.nodeId()) continue;
      if (writer(scope) !== signer) { report.conflicts.push({ scope, reason: 'Bàn giao từ máy không giữ quyền' }); continue; }
      authority.set(scope, to, `Nhận bàn giao trong ${manifest.bundleId}`);
    }
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length) fail(409, `Bundle thiếu dữ liệu liên quan (${broken.length} tham chiếu hỏng, ví dụ bảng ${broken[0].table}); không nhập gì. Hãy xuất bundle đầy đủ.`);
    // Submission files: written only for submissions whose rows were accepted; same content already present is skipped.
    for (const record of records.filter(r => r.op === 'file' && accepted.has(r.submission))) {
      const parts = record.path.split('/');
      if (!/^[0-9a-f-]{36}$/.test(record.submission) || parts.some(part => !part || part === '.' || part === '..')) fail(400, 'Đường dẫn file trong bundle không hợp lệ.');
      const target = path.join(submissionsRoot, record.submission, ...parts);
      if (fsSync.existsSync(target) && sha256(await fs.readFile(target)) === record.sha256) continue;
      const data = open(key, `${manifest.bundleId}:file:${record.blob}`, await fs.readFile(path.join(dir, 'files', `${record.blob}.enc`)));
      if (sha256(data) !== record.sha256) fail(400, 'File bài nộp trong bundle không khớp mã băm.');
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(`${target}.sync-tmp`, data); await fs.rename(`${target}.sync-tmp`, target);
      report.files++;
    }
    // Rows now known to the sender need not be sent back to it.
    const upsert = db.prepare('INSERT INTO sync_state VALUES (?,?,?,?,?) ON CONFLICT(peer,table_name,row_key) DO UPDATE SET scope=excluded.scope,hash=excluded.hash');
    for (const [table, rowKey, scope, hash] of state) upsert.run(signer, table, rowKey, scope, hash);
    db.prepare('INSERT INTO sync_bundles VALUES (?,?,?,?,?,?,?,?)').run(manifest.bundleId, 'import', signer, manifest.kind, now(), actorId, records.length, JSON.stringify(report));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { bundleId: manifest.bundleId, bootstrap, ...report };
}
module.exports = { exportBundle, importBundle, TABLES };
