const crypto = require('node:crypto');
const { DEFAULT_RULES } = require('./game/engine');
const { validateEngineRules, engineIds, createEngine } = require('./game/registry');
const bad = message => Object.assign(new Error(message), { status: 400 });
// Sample rule sets shipped in rules/; seeded once so admins can pick them, never overwritten.
const SAMPLES = [DEFAULT_RULES, require('../rules/obstacles.json'), require('../rules/powerups.json')];
class RuleSetService {
  constructor(db) {
    this.db = db;
    for (const rules of SAMPLES) {
      validateEngineRules(rules);
      db.prepare('INSERT OR IGNORE INTO rule_sets VALUES (?,?,?)').run(rules.id, rules.name, Date.now());
      db.prepare('INSERT OR IGNORE INTO rule_versions VALUES (?,?,?,NULL,?)').run(rules.id, rules.version, JSON.stringify(rules), Date.now());
    }
  }
  list() { return this.db.prepare('SELECT s.id,s.name,MAX(v.version) version,COUNT(*) versions FROM rule_sets s JOIN rule_versions v ON v.rule_set_id=s.id GROUP BY s.id ORDER BY s.created_at,s.id').all(); }
  get(id, version) {
    if (typeof id !== 'string' || (version !== undefined && (!Number.isInteger(version) || version < 1))) return null;
    const row = version === undefined ? this.db.prepare('SELECT * FROM rule_versions WHERE rule_set_id=? ORDER BY version DESC LIMIT 1').get(id) : this.db.prepare('SELECT * FROM rule_versions WHERE rule_set_id=? AND version=?').get(id, version);
    return row ? { id, version: row.version, rules: JSON.parse(row.rules_json), created_at: row.created_at,
      versions: this.db.prepare('SELECT version,created_at FROM rule_versions WHERE rule_set_id=? ORDER BY version DESC').all(id) } : null;
  }
  save({ id, name, rules, userId, expectedVersion }) {
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || !rules || typeof rules !== 'object' || Array.isArray(rules)) throw bad('Tên bộ luật cần 1–80 ký tự và cấu hình phải là đối tượng JSON.');
    const existing = id ? this.get(id) : null;
    if (id && !existing) throw bad('Không tìm thấy bộ luật cần sửa.');
    if (existing && expectedVersion !== existing.version) throw Object.assign(new Error('Bộ luật đã có phiên bản mới. Tải lại trước khi lưu.'), { status: 409 });
    id ||= crypto.randomUUID(); const version = existing ? existing.version + 1 : 1;
    let checked;
    try { checked = validateEngineRules({ ...structuredClone(rules), id, version, name: name.trim() }); }
    catch (error) { throw bad(`Cấu hình luật không hợp lệ: ${error.message}. Kiểm tra kích thước bàn, nhà, loại quân, vị trí xuất phát và giới hạn nước đi.`); }
    if (Buffer.byteLength(JSON.stringify(checked)) > 200000) throw bad('Cấu hình luật vượt 200 KB.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!existing) this.db.prepare('INSERT INTO rule_sets VALUES (?,?,?)').run(id, name.trim(), Date.now());
      else this.db.prepare('UPDATE rule_sets SET name=? WHERE id=?').run(name.trim(), id);
      this.db.prepare('INSERT INTO rule_versions VALUES (?,?,?,?,?)').run(id, version, JSON.stringify(checked), userId, Date.now());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.get(id, version);
  }
}
function registerRuleSets(app, { ruleSets, requireRole, csrf }) {
  app.post('/api/admin/rule-sets/preview', requireRole('admin'), csrf, (req,res) => {
    try {
      const engine = createEngine({ seed:'editor-preview', rules:{ ...req.body?.rules, id:'editor-preview',version:1 } });
      res.json({ state:engine.snapshot(), legalMoves:engine.legalMoves().length });
    } catch (error) { throw bad(error.message); }
  });
  app.get('/api/admin/rule-sets', requireRole('admin'), (req,res) => res.json({ ruleSets: ruleSets.list(), engines: engineIds() }));
  app.get('/api/admin/rule-sets/:id', requireRole('admin'), (req,res) => {
    const row = ruleSets.get(req.params.id, req.query.version === undefined ? undefined : Number(req.query.version));
    if (!row) return res.status(404).json({ error: 'Không tìm thấy phiên bản bộ luật.' }); res.json(row);
  });
  app.post('/api/admin/rule-sets', requireRole('admin'), csrf, (req,res) => res.status(201).json(ruleSets.save({ name:req.body?.name,rules:req.body?.rules,userId:req.auth.id })));
  app.post('/api/admin/rule-sets/:id/versions', requireRole('admin'), csrf, (req,res) => res.status(201).json(ruleSets.save({ id:req.params.id,name:req.body?.name,rules:req.body?.rules,expectedVersion:req.body?.expectedVersion,userId:req.auth.id })));
}
module.exports = { RuleSetService, registerRuleSets };
