const crypto = require('node:crypto');
const { DEFAULT_RULES } = require('./game/engine');

const bad = message => Object.assign(new Error(message), { status: 400 });
const conflict = message => Object.assign(new Error(message), { status: 409 });
const DEFAULT_CONFIG = Object.freeze({
  format: 'swiss', maxTeams: 150, swissRounds: 8, gamesPerPair: 2,
  topN: 16, bestOf: 5, extraPairs: 3,
});
const FIELDS = new Set(['name', 'ruleSetId', 'ruleSetVersion', 'config', 'opensAt', 'closesAt', 'expectedRevision']);
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validateConfig(input, base = DEFAULT_CONFIG) {
  if (!object(input) || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_CONFIG, key))) throw bad('Cấu hình giải có trường không hợp lệ.');
  const config = { ...base, ...input };
  if (config.format !== 'swiss') throw bad('Giải mới sử dụng vòng loại tính điểm.');
  for (const [key, min, max] of [['maxTeams', 2, 4000], ['swissRounds', 1, 20], ['gamesPerPair', 2, 20], ['topN', 2, 4000], ['bestOf', 1, 19], ['extraPairs', 1, 10]]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw bad(`${key} phải là số nguyên từ ${min} đến ${max}.`);
  }
  if (config.gamesPerPair % 2) throw bad('Số ván mỗi cặp vòng loại phải chẵn để đổi bên.');
  if (!(config.bestOf % 2)) throw bad('bestOf phải là số lẻ.');
  if (config.topN > config.maxTeams) throw bad('Top N không được vượt sức chứa của giải.');
  if (config.swissRounds >= config.maxTeams) throw bad('Số lượt đấu vòng loại phải nhỏ hơn sức chứa khi không tái đấu.');
  return config;
}
function timeValue(value, label) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) throw bad(`${label} phải là Unix timestamp mili giây hoặc null.`);
  return value;
}

class TournamentService {
  constructor(db, { ruleSets, now = Date.now } = {}) { this.db = db; this.ruleSets = ruleSets; this.now = now; }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  actor(id) {
    if (!this.db.prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND locked=0 AND deleted_at IS NULL").get(id)) throw bad('Người thao tác phải là admin đang hoạt động.');
  }
  event(id, actorId, kind, details) {
    this.db.prepare('INSERT INTO tournament_events(tournament_id,actor_id,created_at,kind,details_json) VALUES (?,?,?,?,?)')
      .run(id, actorId, this.now(), kind, JSON.stringify(details));
  }
  row(id) { return typeof id === 'string' ? this.db.prepare('SELECT * FROM tournaments WHERE id=?').get(id) : undefined; }
  view(row) {
    return { id: row.id, name: row.name, status: row.status === 'submissions_open' && row.closes_at !== null && this.now() >= row.closes_at ? 'closing' : row.status, revision: row.revision,
      createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
      ruleSetId: row.rule_set_id, ruleSetVersion: row.rule_set_version, serverNow: this.now(),
      opensAt: row.opens_at, closesAt: row.closes_at, config: JSON.parse(row.config_json) };
  }
  list(page = 0) {
    if (!Number.isInteger(page) || page < 0 || page > 100000) throw bad('Trang không hợp lệ.');
    return { page, total: this.db.prepare('SELECT COUNT(*) n FROM tournaments').get().n,
      tournaments: this.db.prepare(`SELECT t.*,(SELECT COUNT(*) FROM tournament_entrants e WHERE e.tournament_id=t.id) entrant_count
        FROM tournaments t ORDER BY t.created_at DESC,t.id LIMIT 50 OFFSET ?`).all(page * 50)
        .map(row => ({ ...this.view(row), entrantCount: row.entrant_count })) };
  }
  get(id) {
    const row = this.row(id); if (!row) return null;
    const stages = this.stages ? this.stages.adminStages(id) : [];
    return { ...this.view(row), stages, status: row.status === 'submissions_open' && stages[0]?.status === 'closing' ? 'closing' : row.status,
      entrants: this.db.prepare(`SELECT e.user_id userId,e.username,e.joined_at joinedAt,u.locked,u.deleted_at deletedAt
        FROM tournament_entrants e JOIN users u ON u.id=e.user_id WHERE e.tournament_id=? ORDER BY e.username,e.user_id`).all(id),
      events: this.db.prepare('SELECT id,actor_id actorId,created_at createdAt,kind,details_json FROM tournament_events WHERE tournament_id=? ORDER BY id').all(id)
        .map(({ details_json, ...event }) => ({ ...event, details: JSON.parse(details_json) })) };
  }
  values(input, current) {
    if (!object(input) || Object.keys(input).some(key => !FIELDS.has(key))) throw bad('Thông tin giải có trường không hợp lệ.');
    const name = input.name === undefined ? current?.name : input.name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw bad('Tên giải cần từ 1 đến 120 ký tự.');
    const config = validateConfig(input.config === undefined ? {} : input.config, current ? JSON.parse(current.config_json) : DEFAULT_CONFIG);
    const ruleSetId = input.ruleSetId === undefined ? (current?.rule_set_id || DEFAULT_RULES.id) : input.ruleSetId;
    const ruleSetVersion = input.ruleSetVersion === undefined ? (current?.rule_set_version || DEFAULT_RULES.version) : input.ruleSetVersion;
    if (current && ruleSetId !== current.rule_set_id && input.ruleSetVersion === undefined) throw bad('Đổi bộ luật phải chọn phiên bản cụ thể.');
    const selected = this.ruleSets.get(ruleSetId, ruleSetVersion);
    if (!selected) throw bad('Không tìm thấy phiên bản bộ luật.');
    if (selected.archived && (!current || current.rule_set_id !== ruleSetId || current.rule_set_version !== ruleSetVersion)) throw bad('Bộ luật đã xóa khỏi danh sách, hãy chọn bộ luật khác.');
    const opensAt = input.opensAt === undefined ? (current?.opens_at ?? null) : timeValue(input.opensAt, 'opensAt');
    const closesAt = input.closesAt === undefined ? (current?.closes_at ?? null) : timeValue(input.closesAt, 'closesAt');
    if (opensAt !== null && closesAt !== null && opensAt >= closesAt) throw bad('Thời điểm đóng phải sau thời điểm mở.');
    return { name: name.trim(), config, ruleSetId, ruleSetVersion, opensAt, closesAt };
  }
  editable(id, revision) {
    const row = this.row(id); if (!row) return null;
    if (row.status !== 'draft') throw conflict('Chỉ sửa cấu hình hoặc danh sách đội khi giải đang chuẩn bị.');
    if (!Number.isInteger(revision) || row.revision !== revision) throw conflict('Giải đã thay đổi hoặc thiếu expectedRevision. Tải lại trước khi lưu.');
    return row;
  }
  create(actorId, input) {
    if (object(input) && Object.hasOwn(input, 'expectedRevision')) throw bad('Tạo giải mới không dùng expectedRevision.');
    return this.transaction(() => {
      this.actor(actorId);
      const value = this.values(input), id = crypto.randomUUID(), time = this.now();
      this.db.prepare(`INSERT INTO tournaments(id,name,created_by,created_at,updated_at,rule_set_id,rule_set_version,config_json,opens_at,closes_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, value.name, actorId, time, time, value.ruleSetId, value.ruleSetVersion, JSON.stringify(value.config), value.opensAt, value.closesAt);
      this.event(id, actorId, 'created', value);
      return this.get(id);
    });
  }
  cancel(id, actorId, input) {
    if (!object(input) || Object.keys(input).some(k => !['expectedRevision','reason'].includes(k)) || !Number.isInteger(input.expectedRevision) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) throw bad('Cần phiên bản dữ liệu và lý do hủy (1–500 ký tự).');
    return this.transaction(() => {
      this.actor(actorId); const row = this.row(id); if (!row) return null;
      if (row.revision !== input.expectedRevision || !['draft','submissions_open','closing'].includes(row.status)) throw conflict('Chỉ hủy giải đang chuẩn bị hoặc nhận bài; dữ liệu có thể đã thay đổi.');
      this.db.prepare("UPDATE tournament_stages SET status='closing' WHERE tournament_id=? AND status='open'").run(id);
      this.db.prepare("UPDATE tournaments SET status='cancelled',revision=revision+1,updated_at=? WHERE id=?").run(this.now(), id);
      this.event(id, actorId, 'cancelled', { reason: input.reason.trim(), previousStatus: row.status });
      return this.get(id);
    });
  }
  update(id, actorId, input) {
    if (!object(input)) throw bad('Thông tin giải phải là đối tượng.');
    return this.transaction(() => {
      this.actor(actorId);
      const row = this.editable(id, input.expectedRevision); if (!row) return null;
      const value = this.values(input, row);
      const count = this.db.prepare('SELECT COUNT(*) n FROM tournament_entrants WHERE tournament_id=?').get(id).n;
      if (count > value.config.maxTeams) throw conflict('Sức chứa mới nhỏ hơn số đội đã đăng ký.');
      this.db.prepare(`UPDATE tournaments SET name=?,rule_set_id=?,rule_set_version=?,config_json=?,opens_at=?,closes_at=?,revision=revision+1,updated_at=? WHERE id=?`)
        .run(value.name, value.ruleSetId, value.ruleSetVersion, JSON.stringify(value.config), value.opensAt, value.closesAt, this.now(), id);
      this.event(id, actorId, 'updated', { previousRevision: row.revision, ...value });
      return this.get(id);
    });
  }
  replaceEntrants(id, actorId, input) {
    if (!object(input) || Object.keys(input).some(key => !['userIds', 'expectedRevision'].includes(key)) || !Array.isArray(input.userIds)
      || input.userIds.length > 4000 || input.userIds.some(id => !Number.isSafeInteger(id) || id < 1)
      || new Set(input.userIds).size !== input.userIds.length) throw bad('userIds phải là danh sách ID đội khác nhau, tối đa 4.000.');
    return this.transaction(() => {
      this.actor(actorId);
      const row = this.editable(id, input.expectedRevision); if (!row) return null;
      if (input.userIds.length > JSON.parse(row.config_json).maxTeams) throw bad('Danh sách vượt sức chứa của giải.');
      const users = input.userIds.map(userId => this.db.prepare("SELECT id,username FROM users WHERE id=? AND role='contestant' AND locked=0 AND deleted_at IS NULL").get(userId));
      if (users.some(user => !user)) throw bad('Danh sách có đội không tồn tại, bị khóa, đã xóa hoặc là admin.');
      const previousUserIds = this.db.prepare('SELECT user_id FROM tournament_entrants WHERE tournament_id=? ORDER BY user_id').all(id).map(e => e.user_id);
      // Retain joined_at for unchanged members; removing a team here never deletes its global account.
      const selected = new Set(input.userIds);
      for (const userId of previousUserIds) if (!selected.has(userId)) this.db.prepare('DELETE FROM tournament_entrants WHERE tournament_id=? AND user_id=?').run(id, userId);
      for (const user of users) this.db.prepare('INSERT OR IGNORE INTO tournament_entrants VALUES (?,?,?,?)').run(id, user.id, user.username, this.now());
      this.db.prepare('UPDATE tournaments SET revision=revision+1,updated_at=? WHERE id=?').run(this.now(), id);
      this.event(id, actorId, 'entrants_replaced', { previousUserIds, userIds: [...input.userIds].sort((a, b) => a - b) });
      return this.get(id);
    });
  }
}

function registerTournaments(app, { tournaments, requireRole, csrf }) {
  const send = (res, value) => value ? res.json(value) : res.status(404).json({ error: 'Không tìm thấy giải.' });
  app.get('/api/admin/tournaments', requireRole('admin'), (req, res) => res.json(tournaments.list(Number(req.query.page || 0))));
  app.post('/api/admin/tournaments', requireRole('admin'), csrf, (req, res) => res.status(201).json(tournaments.create(req.auth.id, req.body)));
  app.get('/api/admin/tournaments/:id', requireRole('admin'), (req, res) => send(res, tournaments.get(req.params.id)));
  app.post('/api/admin/tournaments/:id/cancel', requireRole('admin'), csrf, (req, res) => send(res, tournaments.cancel(req.params.id, req.auth.id, req.body)));
  app.patch('/api/admin/tournaments/:id', requireRole('admin'), csrf, (req, res) => send(res, tournaments.update(req.params.id, req.auth.id, req.body)));
  app.put('/api/admin/tournaments/:id/entrants', requireRole('admin'), csrf, (req, res) => send(res, tournaments.replaceEntrants(req.params.id, req.auth.id, req.body)));
  for (const operation of ['open', 'close', 'lock']) app.post(`/api/admin/tournaments/:id/${operation}`, requireRole('admin'), csrf,
    (req, res) => send(res, tournaments.stages[operation](req.params.id, req.auth.id, req.body)));
}
module.exports = { DEFAULT_CONFIG, validateConfig, TournamentService, registerTournaments };
