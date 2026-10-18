const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

function planBracket(teams) {
  if (!Array.isArray(teams) || teams.length < 2 || teams.length > 256
    || teams.some((team, i) => !team || typeof team !== 'object' || !Number.isSafeInteger(team.userId) || team.userId < 1 || team.seed !== i + 1)
    || new Set(teams.map(team => team.userId)).size !== teams.length) fail(400, 'Danh sách hạt giống phải liên tục từ 1 và có 2–256 đội khác nhau.');
  let size = 2, order = [1, 2];
  while (size < teams.length) {
    size *= 2; order = order.flatMap(seed => [seed, size + 1 - seed]);
  }
  const bySeed = new Map(teams.map(team => [team.seed, { seed: team.seed, userId: team.userId, username: team.username, version: team.version }]));
  const rounds = [];
  for (let number = 1, count = size / 2; count >= 1; number++, count /= 2) {
    const matches = [];
    for (let index = 0; index < count; index++) {
      const previous = rounds.at(-1)?.matches;
      const sources = previous ? [previous[index * 2].id, previous[index * 2 + 1].id] : null;
      const slots = previous ? [previous[index * 2].winner, previous[index * 2 + 1].winner]
        : [bySeed.get(order[index * 2]) || null, bySeed.get(order[index * 2 + 1]) || null];
      const bye = !previous && slots.filter(Boolean).length === 1;
      matches.push({ id: `r${number}-m${index + 1}`, number: index + 1, sources, slots,
        status: bye ? 'bye' : slots.every(Boolean) ? 'ready' : 'waiting', winner: bye ? slots.find(Boolean) : null });
    }
    rounds.push({ number, matches });
  }
  return { teamCount: teams.length, size, rounds };
}

class BracketService {
  constructor(db, { tournaments, now = Date.now }) { Object.assign(this, { db, tournaments, now }); }
  finalRule(id) {
    const row = this.db.prepare('SELECT * FROM tournament_final_rules WHERE tournament_id=?').get(id);
    return row ? { ruleSetId: row.rule_set_id, ruleSetVersion: row.rule_set_version, rules: JSON.parse(row.rules_json),
      requiresResubmission: !!row.requires_resubmission, pinnedBy: row.pinned_by, pinnedAt: row.pinned_at } : null;
  }
  pinRule(id, actorId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['expectedRevision', 'ruleSetId', 'ruleSetVersion', 'reason'].includes(k))
      || !Number.isInteger(body.expectedRevision) || typeof body.ruleSetId !== 'string' || !Number.isInteger(body.ruleSetVersion)
      || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) fail(400, 'Cần chọn phiên bản luật, lý do và phiên bản dữ liệu hợp lệ.');
    return this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const tournament = this.tournaments.row(id); if (!tournament) return null;
      if (tournament.revision !== body.expectedRevision || tournament.status !== 'provisional'
        || this.db.prepare('SELECT 1 FROM bracket_runs WHERE tournament_id=?').get(id)) fail(409, 'Chỉ chốt luật sau khi duyệt đội đi tiếp và trước khi chạy loại trực tiếp. Dữ liệu có thể đã thay đổi.');
      const qualification = this.db.prepare('SELECT snapshot_json FROM tournament_qualifications WHERE tournament_id=?').get(id);
      if (!qualification) fail(409, 'Cần duyệt danh sách đội đi tiếp trước khi chốt luật chính thức.');
      if (this.finalRule(id)) fail(409, 'Luật chính thức đã được chốt, không thể thay đổi.');
      const selected = this.tournaments.ruleSets.get(body.ruleSetId, body.ruleSetVersion);
      if (!selected) fail(400, 'Không tìm thấy phiên bản bộ luật.');
      const original = JSON.parse(qualification.snapshot_json).rules;
      const changed = original.id !== selected.id || original.version !== selected.version;
      this.db.prepare('INSERT INTO tournament_final_rules VALUES (?,?,?,?,?,?,?,?)').run(id, selected.id, selected.version, JSON.stringify(selected.rules), Number(changed), actorId, this.now(), body.reason.trim());
      this.db.prepare('UPDATE tournaments SET revision=revision+1,updated_at=? WHERE id=?').run(this.now(), id);
      this.tournaments.event(id, actorId, 'final_rules_pinned', { ruleSetId: selected.id, ruleSetVersion: selected.version, requiresResubmission: changed, reason: body.reason.trim() });
      return this.finalRule(id);
    });
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM tournament_brackets WHERE tournament_id=?').get(id);
    if (!row) return null;
    return { createdAt: row.created_at, createdBy: row.created_by, status: 'planned', ...JSON.parse(row.plan_json), ...(this.runner?.view(id) || {}) };
  }
  create(id, actorId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['expectedRevision', 'reason'].includes(key))
      || !Number.isInteger(body.expectedRevision) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 1000) fail(400, 'Cần phiên bản dữ liệu và lý do tạo sơ đồ (1–1000 ký tự).');
    return this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const tournament = this.tournaments.row(id); if (!tournament) return null;
      if (tournament.revision !== body.expectedRevision) fail(409, 'Giải đã thay đổi. Tải lại dữ liệu trước khi tạo sơ đồ.');
      if (tournament.status !== 'provisional') fail(409, 'Chỉ tạo sơ đồ sau khi hoàn tất vòng loại.');
      if (this.get(id)) fail(409, 'Sơ đồ đã được tạo và không thể tạo lại.');
      const qualification = this.db.prepare('SELECT * FROM tournament_qualifications WHERE tournament_id=?').get(id);
      if (!qualification) fail(409, 'Cần chốt danh sách đội đi tiếp trước khi tạo sơ đồ.');
      const approved = JSON.parse(qualification.snapshot_json);
      const plan = planBracket(approved.teams.map(team => ({ ...team, seed: team.rank })));
      this.db.prepare('INSERT INTO tournament_brackets VALUES (?,?,?,?,?)').run(id, actorId, this.now(), body.reason.trim(), JSON.stringify(plan));
      this.db.prepare('UPDATE tournaments SET revision=revision+1,updated_at=? WHERE id=?').run(this.now(), id);
      this.tournaments.event(id, actorId, 'bracket_created', { teamCount: plan.teamCount, size: plan.size, reason: body.reason.trim() });
      return this.get(id);
    });
  }
}

function registerBrackets(app, { brackets, stages, requireRole, csrf }) {
  app.get('/api/admin/tournaments/:id/final-rule', requireRole('admin'), (req, res) => {
    if (!brackets.tournaments.row(req.params.id)) return res.status(404).json({ error: 'Không tìm thấy giải.' });
    res.json({ finalRule: brackets.finalRule(req.params.id) });
  });
  app.post('/api/admin/tournaments/:id/final-rule', requireRole('admin'), csrf, (req, res) => {
    const result = brackets.pinRule(req.params.id, req.auth.id, req.body);
    if (!result) return res.status(404).json({ error: 'Không tìm thấy giải.' }); res.status(201).json({ finalRule: result });
  });
  for (const operation of ['start', 'publish', 'schedule', 'pause', 'resume', 'cancel']) app.post(`/api/admin/tournaments/:id/bracket/${operation}`, requireRole('admin'), csrf, (req, res) => {
    const result = brackets.runner[operation === 'start' ? 'create' : operation](req.params.id, req.auth.id, req.body);
    if (!result) return res.status(404).json({ error: 'Không tìm thấy giải.' }); res.json({ bracket: brackets.get(req.params.id) });
  });
  app.get('/api/admin/bracket-games/:id', requireRole('admin'), (req, res) => {
    const result = brackets.runner.match(req.params.id); if (!result) return res.status(404).json({ error: 'Không tìm thấy ván.' }); res.json(result);
  });
  app.post('/api/admin/bracket-games/:id/retry', requireRole('admin'), csrf, (req, res) => {
    const result = brackets.runner.retry(req.params.id, req.auth.id, req.body); if (!result) return res.status(404).json({ error: 'Không tìm thấy ván.' }); res.json(result);
  });
  app.get('/api/admin/tournaments/:id/bracket', requireRole('admin'), (req, res) => {
    if (!brackets.tournaments.row(req.params.id)) return res.status(404).json({ error: 'Không tìm thấy giải.' });
    res.json({ bracket: brackets.get(req.params.id) });
  });
  app.post('/api/admin/tournaments/:id/bracket', requireRole('admin'), csrf, (req, res) => {
    const bracket = brackets.create(req.params.id, req.auth.id, req.body);
    if (!bracket) return res.status(404).json({ error: 'Không tìm thấy giải.' });
    res.status(201).json({ bracket });
  });
  app.get('/api/portal/tournaments/:id/bracket', requireRole('contestant'), (req, res) => {
    const stage = brackets.db.prepare("SELECT id FROM tournament_stages WHERE tournament_id=? AND kind='qualifier'").get(req.params.id);
    if (!stage || !stages.forUser(stage.id, req.auth.id)) return res.status(404).json({ error: 'Không tìm thấy giải của bạn.' });
    res.json({ bracket: brackets.get(req.params.id) });
  });
}
module.exports = { planBracket, BracketService, registerBrackets };
