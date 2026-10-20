const crypto = require('node:crypto');
const os = require('node:os');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const READ_ONLY = 'Hệ thống đang phục vụ chung kết trực tiếp tại hội trường; dữ liệu này tạm thời ở chế độ chỉ đọc trên máy này.';

// Single writer per scope ('system' = accounts, team data, rule sets; 'tournament:<id>' = everything of one tournament).
class Authority {
  constructor(db, { now = Date.now } = {}) {
    this.db = db; this.now = now;
    if (!db.prepare('SELECT 1 FROM sync_identity WHERE id=1').get()) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      db.prepare('INSERT OR IGNORE INTO sync_identity VALUES (1,?,?,?,?,?)').run(`n-${crypto.randomBytes(8).toString('hex')}`, os.hostname().slice(0, 60),
        publicKey.export({ type: 'spki', format: 'pem' }), privateKey.export({ type: 'pkcs8', format: 'pem' }), now());
    }
  }
  identity() { return this.db.prepare('SELECT node_id nodeId,name,public_key publicKey,created_at createdAt FROM sync_identity WHERE id=1').get(); }
  nodeId() { return this.db.prepare('SELECT node_id FROM sync_identity WHERE id=1').get().node_id; }
  owner(scope) { return this.db.prepare('SELECT node_id FROM sync_authority WHERE scope=?').get(scope)?.node_id || this.nodeId(); }
  owns(scope) { return this.owner(scope) === this.nodeId(); }
  stageScope(stageId) {
    const stage = this.db.prepare('SELECT tournament_id FROM tournament_stages WHERE id=?').get(stageId);
    return stage ? `tournament:${stage.tournament_id}` : 'system';
  }
  assert(scope) { if (!this.owns(scope)) fail(409, READ_ONLY); }
  set(scope, nodeId, note) {
    this.db.prepare('INSERT INTO sync_authority VALUES (?,?,?,?) ON CONFLICT(scope) DO UPDATE SET node_id=excluded.node_id,changed_at=excluded.changed_at,note=excluded.note').run(scope, nodeId, this.now(), note || null);
  }
  scopes() {
    const tournaments = this.db.prepare('SELECT id FROM tournaments ORDER BY created_at,id').all().map(row => `tournament:${row.id}`);
    return ['system', ...tournaments].map(scope => ({ scope, nodeId: this.owner(scope) }));
  }
}
// SQL condition: the tournament (given as an SQL expression) is not handed to another machine. Used by job claims so a read-only copy never plays games.
const ownedTournament = expression => `NOT EXISTS (SELECT 1 FROM sync_authority sa WHERE sa.scope='tournament:'||${expression} AND sa.node_id<>(SELECT node_id FROM sync_identity WHERE id=1))`;
const ownedSystem = `NOT EXISTS (SELECT 1 FROM sync_authority sa WHERE sa.scope='system' AND sa.node_id<>(SELECT node_id FROM sync_identity WHERE id=1))`;
module.exports = { Authority, ownedTournament, ownedSystem, READ_ONLY };
