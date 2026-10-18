const crypto = require('node:crypto');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);

class TournamentStages {
  constructor(db, { tournaments, now = Date.now }) { this.db = db; this.tournaments = tournaments; this.now = now; }
  row(id) { return typeof id === 'string' ? this.db.prepare('SELECT * FROM tournament_stages WHERE id=?').get(id) : undefined; }
  status(row, time = this.now()) { return row.status === 'open' && time >= row.closes_at ? 'closing' : row.status; }
  view(row) {
    const announcement = row.kind === 'final' ? this.db.prepare('SELECT announcement,announced_at,fallback_policy FROM tournament_final_intakes WHERE stage_id=?').get(row.id) : null;
    return { id: row.id, tournamentId: row.tournament_id, kind: row.kind, status: this.status(row), opensAt: row.opens_at,
      closesAt: row.closes_at, lockedAt: row.locked_at, serverNow: this.now(), rules: JSON.parse(row.rules_json),
      config: JSON.parse(row.config_json), announcement: announcement?.announcement || null, announcedAt: announcement?.announced_at || null,
      fallbackPolicy: announcement?.fallback_policy || null, cancelled: this.tournaments.row(row.tournament_id)?.status === 'cancelled', canSubmit: this.tournaments.row(row.tournament_id)?.status !== 'cancelled' && row.status === 'open' && this.now() >= row.opens_at && this.now() < row.closes_at };
  }
  selectedId(stageId, userId) {
    const entrant = this.db.prepare('SELECT * FROM tournament_stage_entrants WHERE stage_id=? AND user_id=?').get(stageId, userId);
    if (!entrant) return null;
    const stage = this.row(stageId);
    if (stage.status === 'locked') return entrant.locked_submission_id;
    if (entrant.preferred_submission_id) return entrant.preferred_submission_id;
    return this.db.prepare("SELECT id FROM bot_submissions WHERE stage_id=? AND user_id=? AND status='Accepted' ORDER BY version DESC LIMIT 1").get(stageId, userId)?.id || null;
  }
  checkSubmission(stageId, userId, time = this.now()) {
    const row = this.row(stageId);
    if (!row || !this.db.prepare('SELECT 1 FROM tournament_stage_entrants WHERE stage_id=? AND user_id=?').get(stageId, userId)) fail(403, 'Bạn không thuộc giai đoạn nhận bài này.');
    if (this.tournaments.row(row.tournament_id)?.status === 'cancelled' || row.status !== 'open' || time < row.opens_at || time >= row.closes_at) fail(409, 'Giai đoạn chưa mở hoặc đã hết hạn nhận bài.');
    return row;
  }
  open(id, actorId, body) {
    if (!object(body) || Object.keys(body).some(key => !['expectedRevision', 'opensAt', 'closesAt'].includes(key))) fail(400, 'Thông tin mở nhận bài không hợp lệ.');
    return this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const tournament = this.tournaments.editable(id, body.expectedRevision); if (!tournament) return null;
      const time = this.now(), opens = body.opensAt ?? tournament.opens_at ?? time, closes = body.closesAt ?? tournament.closes_at;
      if (![opens, closes].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000) || opens >= closes || closes <= time) fail(400, 'Cần thời điểm đóng trong tương lai và sau thời điểm mở (timestamp mili giây).');
      const entrants = this.db.prepare(`SELECT e.*,u.locked,u.deleted_at FROM tournament_entrants e JOIN users u ON u.id=e.user_id WHERE tournament_id=?`).all(id);
      if (entrants.length < 2 || entrants.some(e => e.locked || e.deleted_at !== null)) fail(409, 'Cần ít nhất hai đội đang hoạt động trong danh sách trước khi mở nhận bài.');
      const rules = this.tournaments.ruleSets.get(tournament.rule_set_id, tournament.rule_set_version).rules;
      const stageId = crypto.randomUUID();
      this.db.prepare("INSERT INTO tournament_stages(id,tournament_id,kind,status,opens_at,closes_at,rules_json,config_json) VALUES (?,?,'qualifier','open',?,?,?,?)")
        .run(stageId, id, opens, closes, JSON.stringify(rules), tournament.config_json);
      for (const entrant of entrants) this.db.prepare('INSERT INTO tournament_stage_entrants(stage_id,user_id,username) VALUES (?,?,?)').run(stageId, entrant.user_id, entrant.username);
      this.db.prepare("UPDATE tournaments SET status='submissions_open',opens_at=?,closes_at=?,revision=revision+1,updated_at=? WHERE id=?").run(opens, closes, time, id);
      this.tournaments.event(id, actorId, 'submissions_opened', { stageId, opensAt: opens, closesAt: closes });
      return this.tournaments.get(id);
    });
  }
  close(id, actorId, body) {
    return this.change(id, actorId, body, (tournament, stage) => {
      if (stage.status !== 'open') fail(409, 'Giai đoạn không còn ở trạng thái nhận bài.');
      const cutoff = Math.min(stage.closes_at, this.now());
      if (cutoff <= stage.opens_at) fail(409, 'Không thể đóng sớm trước khi cửa sổ bắt đầu; chưa hỗ trợ hủy lịch.');
      this.db.prepare("UPDATE tournament_stages SET status='closing',closes_at=? WHERE id=?").run(cutoff, stage.id);
      this.db.prepare("UPDATE tournaments SET status='closing',closes_at=?,revision=revision+1,updated_at=? WHERE id=?").run(cutoff, this.now(), id);
      this.tournaments.event(id, actorId, 'submissions_closed', { stageId: stage.id, closesAt: cutoff, reason: body.reason });
    });
  }
  change(id, actorId, body, action) {
    if (!object(body) || Object.keys(body).some(key => !['expectedRevision', 'reason'].includes(key)) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) fail(400, 'Cần lý do thao tác từ 1 đến 500 ký tự.');
    return this.tournaments.transaction(() => {
      this.tournaments.actor(actorId);
      const tournament = this.tournaments.row(id); if (!tournament) return null;
      if (!Number.isInteger(body.expectedRevision) || body.expectedRevision !== tournament.revision) fail(409, 'Giải đã thay đổi. Tải lại dữ liệu trước khi thao tác.');
      const stage = this.db.prepare("SELECT * FROM tournament_stages WHERE tournament_id=? AND kind='qualifier'").get(id);
      if (!stage) fail(409, 'Giải chưa mở giai đoạn nhận bài.');
      if (tournament.status === 'cancelled') fail(409, 'Giải đã hủy, không thể đóng hoặc chốt bot.');
      action(tournament, stage);
      return this.tournaments.get(id);
    });
  }
  lock(id, actorId, body) {
    return this.change(id, actorId, body, (tournament, stage) => {
      if (this.status(stage) !== 'closing') fail(409, 'Phải kết thúc nhận bài trước khi chốt bot.');
      if (this.db.prepare("SELECT 1 FROM bot_submissions WHERE stage_id=? AND job_status IN ('queued','running','blocked') LIMIT 1").get(stage.id)) fail(409, 'Còn bài đang chờ hoặc lỗi hạ tầng. Xử lý hết trước khi chốt bot.');
      const entrants = this.db.prepare('SELECT * FROM tournament_stage_entrants WHERE stage_id=? ORDER BY user_id').all(stage.id);
      let accepted = 0;
      for (const entrant of entrants) {
        const submissionId = this.selectedId(stage.id, entrant.user_id);
        const submission = submissionId && this.db.prepare("SELECT * FROM bot_submissions WHERE id=? AND user_id=? AND stage_id=? AND status='Accepted' AND job_status='done'").get(submissionId, entrant.user_id, stage.id);
        const eligible = this.db.prepare('SELECT 1 FROM users WHERE id=? AND locked=0 AND deleted_at IS NULL').get(entrant.user_id);
        const snapshot = submission && eligible ? { submissionId: submission.id, version: submission.version, sourceHash: submission.source_hash,
          image: submission.image, language: submission.language, entry: submission.entry, rules: JSON.parse(stage.rules_json) } : null;
        if (snapshot) accepted++;
        this.db.prepare('UPDATE tournament_stage_entrants SET locked_submission_id=?,snapshot_json=?,exclusion_reason=? WHERE stage_id=? AND user_id=?')
          .run(snapshot ? submission.id : null, snapshot ? JSON.stringify(snapshot) : null, !eligible ? 'account_ineligible' : !snapshot ? 'no_accepted_submission' : null, stage.id, entrant.user_id);
      }
      if (accepted < 2) fail(409, 'Cần ít nhất hai đội có bot hợp lệ để chốt giai đoạn.');
      this.db.prepare("UPDATE tournament_stages SET status='locked',locked_at=? WHERE id=?").run(this.now(), stage.id);
      this.db.prepare("UPDATE tournaments SET status='locked',revision=revision+1,updated_at=? WHERE id=?").run(this.now(), id);
      this.tournaments.event(id, actorId, 'bots_locked', { stageId: stage.id, accepted, excluded: entrants.length - accepted, reason: body.reason });
    });
  }
  select(stageId, userId, submissionId) {
    return this.tournaments.transaction(() => {
      this.checkSubmission(stageId, userId);
      const bot = this.db.prepare("SELECT 1 FROM bot_submissions WHERE id=? AND stage_id=? AND user_id=? AND status='Accepted' AND job_status='done'").get(submissionId, stageId, userId);
      if (!bot) fail(409, 'Chỉ chọn bài hợp lệ của chính bạn trong giai đoạn này.');
      this.db.prepare('UPDATE tournament_stage_entrants SET preferred_submission_id=? WHERE stage_id=? AND user_id=?').run(submissionId, stageId, userId);
      return true;
    });
  }
  adminStages(tournamentId) {
    return this.db.prepare("SELECT * FROM tournament_stages WHERE tournament_id=? ORDER BY CASE kind WHEN 'qualifier' THEN 0 ELSE 1 END").all(tournamentId).map(row => ({ ...this.view(row),
      counts: this.db.prepare('SELECT status,job_status,COUNT(*) count FROM bot_submissions WHERE stage_id=? GROUP BY status,job_status').all(row.id),
      entrants: this.db.prepare('SELECT user_id userId,username,locked_submission_id submissionId,snapshot_json,exclusion_reason exclusionReason FROM tournament_stage_entrants WHERE stage_id=? ORDER BY username').all(row.id)
        .map(({ snapshot_json, ...entrant }) => ({ ...entrant, snapshot: snapshot_json ? JSON.parse(snapshot_json) : null })) }));
  }
  forUser(stageId, userId) {
    const row = this.row(stageId);
    const entrant = row && this.db.prepare('SELECT * FROM tournament_stage_entrants WHERE stage_id=? AND user_id=?').get(stageId, userId);
    if (!entrant) return null;
    return { ...this.view(row), selectedSubmissionId: this.selectedId(stageId, userId), snapshot: entrant.snapshot_json ? JSON.parse(entrant.snapshot_json) : null,
      exclusionReason: entrant.exclusion_reason };
  }
  listForUser(userId) {
    return this.db.prepare(`SELECT s.id,t.name FROM tournament_stages s JOIN tournaments t ON t.id=s.tournament_id
      JOIN tournament_stage_entrants e ON e.stage_id=s.id WHERE e.user_id=? ORDER BY t.created_at DESC,t.id,s.opens_at,s.id`).all(userId)
      .map(row => ({ name: row.name, ...this.forUser(row.id, userId) }));
  }
}
module.exports = { TournamentStages };
