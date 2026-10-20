// Online ↔ LAN bundles from the command line (needed on a fresh LAN machine, which has no admin account yet):
//   npm run sync -- identity                         → this machine's connection string
//   npm run sync -- add-peer <connection string>     → trust the other machine (once)
//   npm run sync -- export --peer <nodeId> --dir <folder> [--kind full|incremental] [--handover system,tournament:<id>]
//   npm run sync -- import --dir <folder>/<id>.ottbundle
// Passphrase: environment variable OTT_SYNC_PASSPHRASE, otherwise typed on stdin. Uses DB_PATH and SUBMISSIONS_PATH.
const path = require('node:path');
const readline = require('node:readline');
const { openDatabase } = require('../src/db');
const { Authority } = require('../src/sync/authority');
const { exportBundle, importBundle } = require('../src/sync/bundle');
const { addPeer, connectionString, fingerprint } = require('../src/sync/routes');

const [command, ...rest] = process.argv.slice(2);
const arg = name => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const passphrase = () => process.env.OTT_SYNC_PASSPHRASE || new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  rl.question('Passphrase: ', answer => { rl.close(); resolve(answer); });
});
(async () => {
  const db = openDatabase(process.env.DB_PATH || path.join(__dirname, '../data/arena.sqlite'));
  const submissionsRoot = path.resolve(process.env.SUBMISSIONS_PATH || path.join(__dirname, '../data/submissions'));
  try {
    const authority = new Authority(db), identity = authority.identity();
    if (command === 'identity') console.log(`Máy: ${identity.name} · ${identity.nodeId}\nDấu khóa: ${fingerprint(identity.publicKey)}\nChuỗi kết nối:\n${connectionString(identity)}`);
    else if (command === 'add-peer') { const peer = addPeer(db, authority, rest[0], null); console.log(`Đã thêm ${peer.name} (${peer.nodeId}) · dấu khóa ${peer.fingerprint}. Đối chiếu với màn hình máy kia.`); }
    else if (command === 'export') {
      const handovers = arg('handover') ? arg('handover').split(',').filter(Boolean) : [];
      const result = await exportBundle({ db, authority, submissionsRoot, peerId: arg('peer'), dir: path.resolve(arg('dir') || ''), passphrase: await passphrase(), kind: arg('kind') || 'full', handovers });
      console.log(`Đã xuất ${result.records} bản ghi, ${result.blobs} file → ${result.path}${handovers.length ? `\nĐã bàn giao: ${handovers.join(', ')} (máy này chỉ đọc phần đó).` : ''}`);
    } else if (command === 'import') {
      const r = await importBundle({ db, authority, submissionsRoot, dir: path.resolve(arg('dir') || ''), passphrase: await passphrase() });
      if (r.duplicate) console.log('Bundle đã nhập trước đó; không thay đổi gì.');
      else console.log(`Đã nhập${r.bootstrap ? ' (khởi tạo)' : ''}: thêm ${r.inserted}, sửa ${r.updated}, xóa ${r.deleted}, ${r.files} file, xung đột ${r.conflicts.length}.${r.conflicts.map(c => `\n  ${c.table || c.scope} ${c.key || ''}: ${c.reason}`).join('')}`);
      if (r.conflicts?.length) process.exitCode = 1;
    } else { console.error('Lệnh: identity | add-peer <chuỗi> | export --peer <mã> --dir <thư mục> [--kind full|incremental] [--handover system,tournament:<id>] | import --dir <bundle>'); process.exitCode = 2; }
  } finally { db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
