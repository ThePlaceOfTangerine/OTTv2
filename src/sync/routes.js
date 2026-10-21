const crypto = require('node:crypto');
const { exportBundle, importBundle } = require('./bundle');
const { READ_ONLY } = require('./authority');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const fingerprint = pem => crypto.createHash('sha256').update(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32).match(/.{4}/g).join(' ');
// One copy-paste string carries a machine's id, name and Ed25519 public key for pairing out of band.
const connectionString = identity => Buffer.from(JSON.stringify({ nodeId: identity.nodeId, name: identity.name, publicKey: identity.publicKey })).toString('base64url');
function parseConnection(text) {
  let value;
  try { value = JSON.parse(Buffer.from(String(text).trim(), 'base64url').toString('utf8')); } catch { fail(400, 'Chuỗi kết nối không hợp lệ.'); }
  if (!/^n-[0-9a-f]{16}$/.test(value?.nodeId) || typeof value.name !== 'string' || typeof value.publicKey !== 'string') fail(400, 'Chuỗi kết nối thiếu thông tin máy.');
  try { if (crypto.createPublicKey(value.publicKey).asymmetricKeyType !== 'ed25519') throw new Error(); } catch { fail(400, 'Public key không phải Ed25519.'); }
  return value;
}
function addPeer(db, authority, text, actorId, now = Date.now) {
  const peer = parseConnection(text);
  if (peer.nodeId === authority.nodeId()) fail(400, 'Đây là chuỗi kết nối của chính máy này.');
  const existing = db.prepare('SELECT public_key FROM sync_peers WHERE node_id=?').get(peer.nodeId);
  if (existing && existing.public_key.trim() !== peer.publicKey.trim()) fail(409, 'Máy này đã được thêm với public key khác; kiểm tra lại, không tự thay khóa.');
  db.prepare('INSERT OR IGNORE INTO sync_peers VALUES (?,?,?,?,?)').run(peer.nodeId, peer.name.slice(0, 60), peer.publicKey, actorId, now());
  return { nodeId: peer.nodeId, name: peer.name, fingerprint: fingerprint(peer.publicKey) };
}

// Maps a mutating request to the data scope it writes; requests for machine-local things (graders, snapshots, sync) return null.
function scopeOf(db, authority, method, url) {
  if (method === 'GET' || method === 'HEAD') return null;
  let m;
  if ((m = url.match(/^\/api\/admin\/tournaments\/([^/]+)\//)) || (m = url.match(/^\/api\/admin\/tournaments\/([^/]+)$/))) return `tournament:${decodeURIComponent(m[1])}`;
  if ((m = url.match(/^\/api\/admin\/stages\/([^/]+)\//))) return authority.stageScope(decodeURIComponent(m[1]));
  if ((m = url.match(/^\/api\/admin\/swiss-games\/([^/]+)\//))) {
    const row = db.prepare('SELECT s.tournament_id FROM swiss_games g JOIN swiss_pairs p ON p.id=g.pair_id JOIN swiss_rounds r ON r.id=p.round_id JOIN tournament_stages s ON s.id=r.stage_id WHERE g.id=?').get(decodeURIComponent(m[1]));
    return row ? `tournament:${row.tournament_id}` : null;
  }
  if ((m = url.match(/^\/api\/admin\/bracket-games\/([^/]+)\//))) { const row = db.prepare('SELECT tournament_id FROM bracket_games WHERE id=?').get(decodeURIComponent(m[1])); return row ? `tournament:${row.tournament_id}` : null; }
  if (/^\/api\/admin\/(users|rule-sets|scores)/.test(url) || /^\/api\/(auth\/password|portal\/team)/.test(url)) return 'system';
  if ((m = url.match(/^\/api\/portal\/submissions\/([^/]+)\//))) { const row = db.prepare('SELECT stage_id FROM bot_submissions WHERE id=?').get(decodeURIComponent(m[1])); return row?.stage_id ? authority.stageScope(row.stage_id) : 'system'; }
  return null;
}
function readOnlyGuard({ db, authority }) {
  return (req, res, next) => {
    const scope = scopeOf(db, authority, req.method, req.path);
    if (scope && !authority.owns(scope)) return res.status(409).json({ error: READ_ONLY, code: 'read_only', scope });
    next();
  };
}

function registerSync(app, { db, authority, submissionsRoot, tournaments, requireRole, csrf }) {
  const view = () => {
    const identity = authority.identity(), names = new Map(db.prepare('SELECT id,name FROM tournaments').all().map(t => [`tournament:${t.id}`, t.name]));
    const peers = db.prepare('SELECT node_id nodeId,name,public_key publicKey,added_at addedAt FROM sync_peers ORDER BY added_at').all();
    const nameOf = nodeId => nodeId === identity.nodeId ? `${identity.name} (máy này)` : peers.find(p => p.nodeId === nodeId)?.name || nodeId;
    return { identity: { nodeId: identity.nodeId, name: identity.name, fingerprint: fingerprint(identity.publicKey), connection: connectionString(identity) },
      peers: peers.map(({ publicKey, ...peer }) => ({ ...peer, fingerprint: fingerprint(publicKey) })),
      authority: authority.scopes().map(({ scope, nodeId }) => ({ scope, label: scope === 'system' ? 'Hệ thống (tài khoản, hồ sơ đội, bộ luật)' : `Giải: ${names.get(scope) || scope}`, owner: nameOf(nodeId), local: nodeId === identity.nodeId })),
      bundles: db.prepare('SELECT bundle_id bundleId,direction,peer,kind,created_at createdAt,records,report_json FROM sync_bundles ORDER BY created_at DESC LIMIT 20').all()
        .map(({ report_json, ...row }) => ({ ...row, peerName: nameOf(row.peer), report: report_json ? JSON.parse(report_json) : null })) };
  };
  app.get('/api/admin/sync', requireRole('admin'), (req, res) => res.json(view()));
  app.post('/api/admin/sync/peers', requireRole('admin'), csrf, (req, res) => { addPeer(db, authority, req.body?.connection, req.auth.id); res.status(201).json(view()); });
  app.post('/api/admin/sync/export', requireRole('admin'), csrf, async (req, res) => {
    const body = req.body || {};
    res.status(201).json({ result: await exportBundle({ db, authority, submissionsRoot, peerId: body.peerId, dir: body.dir, passphrase: body.passphrase, kind: body.kind, handovers: body.handovers || [], actorId: req.auth.id }), ...view() });
  });
  app.post('/api/admin/sync/import', requireRole('admin'), csrf, async (req, res) => res.json({ result: await importBundle({ db, authority, submissionsRoot, dir: req.body?.dir, passphrase: req.body?.passphrase, actorId: req.auth.id }), ...view() }));
  // Emergency only: take a scope back when the bundle carrying it was lost before the other machine imported it.
  app.post('/api/admin/sync/reclaim', requireRole('admin'), csrf, (req, res) => {
    const { scope, reason, confirm } = req.body || {};
    if (typeof scope !== 'string' || !authority.scopes().some(s => s.scope === scope)) fail(400, 'Phạm vi không hợp lệ.');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500 || confirm !== 'LẤY LẠI QUYỀN') fail(400, 'Cần lý do và gõ đúng "LẤY LẠI QUYỀN" để xác nhận.');
    authority.set(scope, authority.nodeId(), `Lấy lại khẩn cấp bởi admin ${req.auth.id}: ${reason.trim()}`);
    if (scope.startsWith('tournament:')) tournaments.event(scope.slice(11), req.auth.id, 'authority_reclaimed', { reason: reason.trim() });
    res.json(view());
  });
}
module.exports = { registerSync, readOnlyGuard, addPeer, connectionString, fingerprint, scopeOf };
