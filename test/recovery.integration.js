// Run explicitly: npm run test:recovery. Kills the coordinator process abruptly (like a power cut) in the middle of Swiss rounds,
// restarts it on the same SQLite file and checks the final result equals an uninterrupted run, with every game scored once.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const child = path.join(__dirname, 'fixtures', 'recovery-child.js');
function start(dbFile, work) {
  const proc = spawn(process.execPath, ['--no-warnings', child, dbFile, work, '15'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  proc.stdout.on('data', chunk => { output += chunk; }); proc.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => proc.on('exit', code => resolve(code)));
  return { proc, exited, output: () => output };
}
// The child may not have created the file yet, and it may be mid-write; a failed read just counts as 0.
const count = (dbFile, status) => { let db; try { db = new DatabaseSync(dbFile, { readOnly: true }); return db.prepare('SELECT COUNT(*) n FROM swiss_games WHERE status=?').get(status).n; } catch { return 0; } finally { db?.close(); } };
const finished = dbFile => count(dbFile, 'finished'), running = dbFile => count(dbFile, 'running');
const result = output => JSON.parse(output.split('\n').find(line => line.startsWith('DONE ')).slice(5));
async function waitFor(condition, label, ms = 120000) { const end = Date.now() + ms; while (!condition()) { if (Date.now() > end) throw new Error(`Timed out: ${label}`); await new Promise(r => setTimeout(r, 25)); } }

test('a coordinator killed mid-round resumes on restart with the same results and no double scoring', { timeout: 600000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-recovery-'));
  try {
    // Reference: same tournament, never interrupted.
    const reference = start(path.join(root, 'reference.sqlite'), path.join(root, 'ref'));
    assert.equal(await reference.exited, 0, reference.output());
    const expected = result(reference.output());
    assert.equal(expected.games.length, 36); assert.ok(expected.games.every(g => g[1] === 'finished'));

    const dbFile = path.join(root, 'crash.sqlite'), kills = [];
    let run = start(dbFile, path.join(root, 'crash'));
    // Kill twice: during round 1 and again in a later round, each time while a game is being played.
    for (const target of [3, 16]) {
      await waitFor(() => finished(dbFile) >= target && running(dbFile) > 0, `game ${target} running`);
      const at = finished(dbFile);
      run.proc.kill('SIGKILL'); await run.exited;
      kills.push({ finished: at, running: running(dbFile) });
      run = start(dbFile, path.join(root, 'crash'));
    }
    assert.equal(await run.exited, 0, run.output());
    const actual = result(run.output());
    assert.ok(kills.every(k => k.running === 1), `each kill left exactly one game marked running: ${JSON.stringify(kills)}`);
    assert.deepEqual(actual.standings, expected.standings);
    assert.deepEqual(actual.games, expected.games);
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const pairs = db.prepare("SELECT COUNT(*) n FROM swiss_pairs WHERE status='finished'").get().n;
      assert.equal(pairs, db.prepare('SELECT COUNT(*) n FROM swiss_pairs').get().n, 'every pair settled once');
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally { db.close(); }
    console.log(`Kill tại ${kills.map(k => k.finished).join(' và ')} ván đã xong; kết quả 36 ván và bảng điểm trùng khớp lần chạy không gián đoạn.`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
