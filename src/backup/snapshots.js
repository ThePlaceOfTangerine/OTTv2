const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const sha256File = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const stamp = time => new Date(time).toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

// Consistent copies of the database plus submission files to an external drive (SNAPSHOT_DIR), safe to take while the server runs.
// Layout: <dir>/<name>/{arena.sqlite, manifest.json} and a shared <dir>/files/<submissionId>/ store for finished (immutable) submissions.
class SnapshotService {
  constructor(db, { dir = process.env.SNAPSHOT_DIR || null, submissionsRoot, now = Date.now, keep = Number(process.env.SNAPSHOT_KEEP || 24),
    intervalMs = Number(process.env.SNAPSHOT_INTERVAL_MINUTES || 15) * 60000, log = console.error } = {}) {
    Object.assign(this, { db, dir: dir && path.resolve(dir), submissionsRoot, now, keep, intervalMs, log });
    this.last = null; this.running = null;
  }
  configured() { return !!this.dir; }
  snapshot() {
    if (!this.dir) throw Object.assign(new Error('Chưa đặt SNAPSHOT_DIR (thư mục trên ổ ngoài).'), { status: 409 });
    // One snapshot at a time; a manual request during a scheduled one waits for it.
    this.running ||= this.take().finally(() => { this.running = null; });
    return this.running;
  }
  async take() {
    const started = this.now(), name = `ott-${stamp(started)}-${crypto.randomBytes(3).toString('hex')}`;
    const partial = path.join(this.dir, `${name}.partial`), final = path.join(this.dir, name), store = path.join(this.dir, 'files');
    await fs.mkdir(partial, { recursive: true }); await fs.mkdir(store, { recursive: true });
    try {
      // Leftovers from a crash during an earlier snapshot are never valid snapshots.
      for (const entry of await fs.readdir(this.dir)) if (entry.endsWith('.partial') && entry !== `${name}.partial`) await fs.rm(path.join(this.dir, entry), { recursive: true, force: true });
      const dbFile = path.join(partial, 'arena.sqlite');
      this.db.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
      // Only finished submissions are immutable; queued/running ones are re-checked after a restore anyway.
      const rows = this.db.prepare("SELECT id FROM bot_submissions WHERE job_status='done' ORDER BY id").all();
      let copied = 0;
      for (const { id } of rows) {
        const source = path.join(this.submissionsRoot, id), target = path.join(store, id);
        if (!fsSync.existsSync(source) || fsSync.existsSync(path.join(target, '.complete'))) continue;
        await fs.rm(target, { recursive: true, force: true });
        await fs.cp(source, target, { recursive: true, errorOnExist: false });
        await fs.writeFile(path.join(target, '.complete'), '');
        copied++;
      }
      // Unfinished submissions keep only their original upload (written once on receipt); they are checked again after a restore.
      const pending = [];
      for (const { id } of this.db.prepare("SELECT id FROM bot_submissions WHERE job_status<>'done' AND commit_sha IS NULL ORDER BY id").all()) {
        const upload = path.join(this.submissionsRoot, id, 'upload.bin');
        if (!fsSync.existsSync(upload)) continue;
        await fs.mkdir(path.join(partial, 'pending', id), { recursive: true }); await fs.copyFile(upload, path.join(partial, 'pending', id, 'upload.bin')); pending.push(id);
      }
      const manifest = { format: 1, name, createdAt: started, finishedAt: this.now(), db: { file: 'arena.sqlite', sha256: await sha256File(dbFile) },
        schema: this.db.prepare('SELECT MAX(version) v FROM migrations').get().v, software: { version: require('../../package.json').version, engine: require('../grader/version').ENGINE_HASH }, submissions: rows.map(r => r.id).filter(id => fsSync.existsSync(path.join(store, id, '.complete'))), pending };
      await fs.writeFile(path.join(partial, 'manifest.json'), JSON.stringify(manifest, null, 2));
      await fs.rename(partial, final);
      await this.prune();
      this.last = { name, at: started, ms: this.now() - started, copied, submissions: manifest.submissions.length };
      return this.last;
    } catch (error) { await fs.rm(partial, { recursive: true, force: true }); this.last = { at: started, error: error.message }; throw error; }
  }
  async list() {
    if (!this.dir || !fsSync.existsSync(this.dir)) return [];
    const names = (await fs.readdir(this.dir)).filter(name => name.startsWith('ott-') && !name.endsWith('.partial')).sort().reverse();
    return names.filter(name => fsSync.existsSync(path.join(this.dir, name, 'manifest.json')));
  }
  // Keeps the newest N snapshots and drops store entries no kept snapshot refers to.
  async prune() {
    const names = await this.list();
    for (const name of names.slice(this.keep)) await fs.rm(path.join(this.dir, name), { recursive: true, force: true });
    const referenced = new Set();
    for (const name of names.slice(0, this.keep)) for (const id of JSON.parse(await fs.readFile(path.join(this.dir, name, 'manifest.json'), 'utf8')).submissions) referenced.add(id);
    for (const id of await fs.readdir(path.join(this.dir, 'files'))) if (!referenced.has(id)) await fs.rm(path.join(this.dir, 'files', id), { recursive: true, force: true });
  }
  async status() { return { configured: this.configured(), dir: this.dir, intervalMinutes: this.intervalMs / 60000, keep: this.keep, last: this.last, snapshots: (await this.list()).slice(0, 10) }; }
  start() {
    if (!this.dir || this.timer) return;
    this.timer = setInterval(() => this.snapshot().catch(error => this.log('Snapshot:', error.message)), this.intervalMs); this.timer.unref();
  }
  async close() { clearInterval(this.timer); this.timer = null; await this.running?.catch(() => {}); }
}

// Restores a snapshot into an empty location (or moves the existing database aside with force); the server must be stopped.
async function restoreSnapshot({ snapshot, dbPath, submissionsRoot, force = false }) {
  const manifest = JSON.parse(await fs.readFile(path.join(snapshot, 'manifest.json'), 'utf8'));
  const source = path.join(snapshot, manifest.db.file), store = path.join(path.dirname(snapshot), 'files');
  if (await sha256File(source) !== manifest.db.sha256) throw new Error('File DB trong snapshot không khớp mã băm (hỏng hoặc bị sửa).');
  // Read-only: opening through openDatabase would run migrations and change the snapshot itself.
  const check = new DatabaseSync(source, { readOnly: true });
  try {
    const integrity = check.prepare('PRAGMA integrity_check').get();
    if (Object.values(integrity)[0] !== 'ok') throw new Error('integrity_check không đạt.');
    if (check.prepare('PRAGMA foreign_key_check').all().length) throw new Error('foreign_key_check còn tham chiếu hỏng.');
  } finally { check.close(); }
  const missing = manifest.submissions.filter(id => !fsSync.existsSync(path.join(store, id, '.complete')));
  if (missing.length) throw new Error(`Thiếu ${missing.length} bài nộp trong kho snapshot.`);
  if (fsSync.existsSync(dbPath)) {
    if (!force) throw new Error(`Đã có ${dbPath}. Dừng server, kiểm tra lại rồi chạy với --force (DB cũ được giữ lại, không bị xóa).`);
    const aside = `${dbPath}.before-restore-${stamp(Date.now())}`;
    for (const suffix of ['', '-wal', '-shm']) if (fsSync.existsSync(dbPath + suffix)) await fs.rename(dbPath + suffix, aside + suffix);
  }
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.copyFile(source, dbPath);
  for (const id of manifest.submissions) {
    const target = path.join(submissionsRoot, id);
    if (fsSync.existsSync(target)) continue;
    await fs.cp(path.join(store, id), target, { recursive: true });
    await fs.rm(path.join(target, '.complete'), { force: true });
  }
  for (const id of manifest.pending || []) {
    await fs.mkdir(path.join(submissionsRoot, id), { recursive: true });
    await fs.copyFile(path.join(snapshot, 'pending', id, 'upload.bin'), path.join(submissionsRoot, id, 'upload.bin'));
  }
  return { name: manifest.name, createdAt: manifest.createdAt, submissions: manifest.submissions.length, pending: (manifest.pending || []).length, schema: manifest.schema };
}
module.exports = { SnapshotService, restoreSnapshot };
