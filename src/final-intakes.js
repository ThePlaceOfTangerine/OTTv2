const crypto = require('node:crypto');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
class FinalIntakes {
  constructor(db, { tournaments, stages, now = Date.now }) { Object.assign(this, { db, tournaments, stages, now }); }
  get(id) {
    const row = this.db.prepare('SELECT * FROM tournament_final_intakes WHERE tournament_id=?').get(id);
    return row ? { stage: this.stages.adminStages(id).find(s => s.id === row.stage_id), announcement: row.announcement,
      announcedAt: row.announced_at, announcedBy: row.announced_by, fallbackPolicy: row.fallback_policy } : null;
  }
  open(id, actorId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['expectedRevision', 'opensAt', 'closesAt', 'announcement', 'fallbackPolicy'].includes(k))
      || !Number.isInteger(body.expectedRevision) || typeof body.announcement !== 'string' || !body.announcement.trim() || body.announcement.length > 3000
      || body.fallbackPolicy !== 'require_valid_final_submission') fail(400, 'Cần thông báo luật, thời gian, phiên bản dữ liệu và chính sách bắt buộc có bài hợp lệ theo luật chính thức.');
    return this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const tournament = this.tournaments.row(id); if (!tournament) return null;
      if (tournament.revision !== body.expectedRevision || tournament.status !== 'provisional'
        || this.db.prepare('SELECT 1 FROM bracket_runs WHERE tournament_id=?').get(id)) fail(409, 'Dữ liệu đã thay đổi hoặc giải đã bắt đầu loại trực tiếp.');
      const pinned = this.db.prepare('SELECT * FROM tournament_final_rules WHERE tournament_id=?').get(id);
      const qualification = this.db.prepare('SELECT * FROM tournament_qualifications WHERE tournament_id=?').get(id);
      if (!pinned || !qualification) fail(409, 'Cần duyệt đội đi tiếp và chốt luật chính thức trước khi mở nộp lại.');
      if (this.get(id)) fail(409, 'Đợt nộp lại đã được mở, không thể mở lại hoặc đổi thời gian/luật.');
      const time = this.now(), opens = body.opensAt ?? time, closes = body.closesAt;
      if (![opens, closes].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000) || opens >= closes || closes <= time) fail(400, 'Cần hạn đóng trong tương lai và sau thời điểm mở.');
      const source = JSON.parse(qualification.snapshot_json), teams = source.teams;
      if (teams.length < 2 || teams.some(e => !this.db.prepare("SELECT 1 FROM users WHERE id=? AND role='contestant' AND locked=0 AND deleted_at IS NULL").get(e.userId))) fail(409, 'Danh sách đi tiếp có đội không còn hoạt động. Không tự thay đội khác.');
      const stageId = crypto.randomUUID();
      this.db.prepare("INSERT INTO tournament_stages(id,tournament_id,kind,status,opens_at,closes_at,rules_json,config_json) VALUES (?,?,'final','open',?,?,?,?)")
        .run(stageId, id, opens, closes, pinned.rules_json, JSON.stringify(source.config));
      for (const team of teams) this.db.prepare('INSERT INTO tournament_stage_entrants(stage_id,user_id,username) VALUES (?,?,?)').run(stageId, team.userId, team.username);
      this.db.prepare('INSERT INTO tournament_final_intakes VALUES (?,?,?,?,?,?)').run(id, stageId, actorId, time, body.announcement.trim(), body.fallbackPolicy);
      this.db.prepare('UPDATE tournaments SET revision=revision+1,updated_at=? WHERE id=?').run(time, id);
      this.tournaments.event(id, actorId, 'final_intake_opened', { stageId, opensAt: opens, closesAt: closes, ruleSetId: pinned.rule_set_id,
        ruleSetVersion: pinned.rule_set_version, userIds: teams.map(e => e.userId), announcement: body.announcement.trim(), fallbackPolicy: body.fallbackPolicy });
      return this.get(id);
    });
  }
  lock(id, actorId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['expectedRevision', 'reason'].includes(k))
      || !Number.isInteger(body.expectedRevision) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) fail(400, 'Cần phiên bản dữ liệu và lý do chốt bot (1–1000 ký tự).');
    return this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const tournament = this.tournaments.row(id); if (!tournament) return null;
      if (tournament.revision !== body.expectedRevision || tournament.status !== 'provisional' || this.db.prepare('SELECT 1 FROM bracket_runs WHERE tournament_id=?').get(id)) fail(409, 'Dữ liệu đã thay đổi hoặc đã chạy loại trực tiếp.');
      const intake = this.get(id), stage = intake && this.stages.row(intake.stage.id);
      if (!stage || this.stages.status(stage) !== 'closing') fail(409, 'Phải kết thúc nhận bài trước khi chốt bot nộp lại.');
      if (this.db.prepare("SELECT 1 FROM bot_submissions WHERE stage_id=? AND job_status IN ('queued','running','blocked') LIMIT 1").get(stage.id)) fail(409, 'Còn bài đang chờ, đang kiểm tra hoặc lỗi hạ tầng. Xử lý hết trước khi chốt.');
      const entrants = intake.stage.entrants;
      for (const entrant of entrants) {
        const submissionId = this.stages.selectedId(stage.id, entrant.userId);
        const bot = submissionId && this.db.prepare("SELECT * FROM bot_submissions WHERE id=? AND user_id=? AND stage_id=? AND status='Accepted' AND job_status='done'").get(submissionId, entrant.userId, stage.id);
        const eligible = this.db.prepare("SELECT 1 FROM users WHERE id=? AND role='contestant' AND locked=0 AND deleted_at IS NULL").get(entrant.userId);
        if (!bot || !eligible) fail(409, 'Chưa thể chốt: ' + entrant.username + ' thiếu bài hợp lệ trong đợt mới hoặc tài khoản không hoạt động. Không tự lấy bot vòng loại hay thay đội.');
        const snapshot = { submissionId: bot.id, version: bot.version, sourceHash: bot.source_hash, image: bot.image, language: bot.language, entry: bot.entry, rules: JSON.parse(stage.rules_json) };
        this.db.prepare('UPDATE tournament_stage_entrants SET locked_submission_id=?,snapshot_json=?,exclusion_reason=NULL WHERE stage_id=? AND user_id=?').run(bot.id, JSON.stringify(snapshot), stage.id, entrant.userId);
      }
      if (entrants.length < 2) fail(409, 'Cần ít nhất hai đội đã duyệt.');
      this.db.prepare("UPDATE tournament_stages SET status='locked',locked_at=? WHERE id=?").run(this.now(), stage.id);
      this.db.prepare('UPDATE tournaments SET revision=revision+1,updated_at=? WHERE id=?').run(this.now(), id);
      this.tournaments.event(id, actorId, 'final_bots_locked', { stageId: stage.id, accepted: entrants.length, fallbackPolicy: intake.fallbackPolicy, reason: body.reason.trim() });
      return this.get(id);
    });
  }
  close(id, actorId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['expectedRevision', 'reason'].includes(k))
      || !Number.isInteger(body.expectedRevision) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) fail(400, 'Cần phiên bản dữ liệu và lý do đóng nhận bài.');
    return this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const tournament = this.tournaments.row(id); if (!tournament) return null;
      if (tournament.revision !== body.expectedRevision || this.db.prepare('SELECT 1 FROM bracket_runs WHERE tournament_id=?').get(id)) fail(409, 'Dữ liệu đã thay đổi hoặc đã chạy loại trực tiếp.');
      const intake = this.get(id), stage = intake && this.stages.row(intake.stage.id);
      if (!stage || stage.status !== 'open') fail(409, 'Đợt nộp lại chưa mở hoặc đã đóng.');
      const cutoff = Math.min(this.now(), stage.closes_at);
      if (cutoff <= stage.opens_at) fail(409, 'Chưa đến giờ nhận bài; chưa hỗ trợ hủy lịch.');
      this.db.prepare("UPDATE tournament_stages SET status='closing',closes_at=? WHERE id=?").run(cutoff, stage.id);
      this.db.prepare('UPDATE tournaments SET revision=revision+1,updated_at=? WHERE id=?').run(this.now(), id);
      this.tournaments.event(id, actorId, 'final_intake_closed', { stageId: stage.id, closesAt: cutoff, reason: body.reason.trim() });
      return this.get(id);
    });
  }
}
function registerFinalIntakes(app, { finalIntakes, requireRole, csrf }) {
  app.get('/api/admin/tournaments/:id/final-intake', requireRole('admin'), (req, res) => {
    if (!finalIntakes.tournaments.row(req.params.id)) return res.status(404).json({ error: 'Không tìm thấy giải.' }); res.json({ intake: finalIntakes.get(req.params.id) });
  });
  for (const operation of ['open', 'close', 'lock']) app.post(`/api/admin/tournaments/:id/final-intake/${operation}`, requireRole('admin'), csrf, (req, res) => {
    const intake = finalIntakes[operation](req.params.id, req.auth.id, req.body);
    if (!intake) return res.status(404).json({ error: 'Không tìm thấy giải.' }); res.json({ intake });
  });
}
module.exports = { FinalIntakes, registerFinalIntakes };
