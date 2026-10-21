const crypto = require('node:crypto');
const { BotFault, InfrastructureError } = require('../game/protocol');
const { GitHubError } = require('./client');
const { REPO_ARCHIVE_LIMIT } = require('../submissions/source');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const REPO_SIZE_KB = 50 * 1024;
const SHA = /^[0-9a-f]{40}$/;

function parseRepo(input) {
  const value = typeof input === 'string' ? input.trim().replace(/\.git$/i, '').replace(/\/+$/, '') : '';
  const match = value.match(/^(?:https:\/\/github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100})$/i);
  if (!match || /\/\.+$/.test(match[1])) fail(400, 'Nhập repo dạng https://github.com/ten-tai-khoan/ten-repo.');
  return match[1];
}
function cleanMembers(members) {
  const text = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : fail(400, 'Thông tin thành viên quá dài hoặc sai kiểu.');
  if (!Array.isArray(members) || members.length < 1 || members.length > 4) fail(400, 'Đội có từ 1 đến 4 thành viên.');
  return members.map(member => {
    if (!member || typeof member !== 'object') fail(400, 'Thông tin thành viên không hợp lệ.');
    const row = { name: text(member.name, 100), studentId: text(member.studentId, 30), email: text(member.email, 254), phone: text(member.phone, 20) };
    if (!row.name) fail(400, 'Mỗi thành viên cần họ tên.');
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) fail(400, `Email không hợp lệ: ${row.email}`);
    if (row.phone && !/^\+?[0-9 .-]{6,20}$/.test(row.phone)) fail(400, `Số điện thoại không hợp lệ: ${row.phone}`);
    return row;
  });
}

class RepoService {
  constructor(db, { client = null, appSlug = null, webhookSecret = null, submissions, stages, now = Date.now, snapshotBatch = 20, intervalMs = 10000 } = {}) {
    Object.assign(this, { db, client, appSlug, webhookSecret, submissions, stages, now, snapshotBatch, intervalMs });
    this.busy = new Set();
  }
  configured() { return !!this.client; }
  repoRow(userId) { return this.db.prepare('SELECT * FROM team_repos WHERE user_id=?').get(userId); }
  team(userId) {
    const profile = this.db.prepare('SELECT team_name,leader_email,members_json FROM team_profiles WHERE user_id=?').get(userId);
    const repo = this.repoRow(userId);
    return { configured: this.configured(), installUrl: this.appSlug ? `https://github.com/apps/${this.appSlug}/installations/new` : null,
      profile: profile ? { teamName: profile.team_name, leaderEmail: profile.leader_email, members: JSON.parse(profile.members_json) } : null,
      repo: repo ? { fullName: repo.full_name, status: repo.status, verifyCode: repo.verify_code, defaultBranch: repo.default_branch, verifiedAt: repo.verified_at } : null };
  }
  saveMembers(userId, members) {
    const rows = cleanMembers(members);
    const updated = this.db.prepare('UPDATE team_profiles SET members_json=?,updated_at=? WHERE user_id=?').run(JSON.stringify(rows), this.now(), userId);
    if (!updated.changes) fail(409, 'Tài khoản chưa có hồ sơ đội. Liên hệ ban tổ chức để được nhập danh sách đội.');
    return this.team(userId);
  }
  register(userId, input) {
    if (!this.configured()) fail(503, 'Hệ thống chưa cấu hình GitHub App; hãy nộp bằng file.');
    const fullName = parseRepo(input), code = this.repoRow(userId)?.verify_code || `OTT-${crypto.randomBytes(12).toString('hex')}`;
    this.db.prepare(`INSERT INTO team_repos(user_id,full_name,verify_code,status,updated_at) VALUES (?,?,?,'pending',?)
      ON CONFLICT(user_id) DO UPDATE SET full_name=excluded.full_name,status='pending',repo_id=NULL,installation_id=NULL,default_branch=NULL,verified_at=NULL,updated_at=excluded.updated_at`)
      .run(userId, fullName, code, this.now());
    return this.team(userId);
  }
  async exclusive(userId, action) {
    if (this.busy.has(userId)) fail(429, 'Đang xử lý yêu cầu GitHub trước đó, vui lòng chờ.');
    this.busy.add(userId);
    try { return await action(); } finally { this.busy.delete(userId); }
  }
  verify(userId) {
    return this.exclusive(userId, async () => {
      const row = this.repoRow(userId);
      if (!this.configured()) fail(503, 'Hệ thống chưa cấu hình GitHub App.');
      if (!row) fail(409, 'Chưa khai báo repo GitHub.');
      const installation = await this.client.installation(row.full_name);
      if (!installation) fail(409, 'Chưa cài GitHub App của ban tổ chức vào repo này. Mở liên kết cài đặt và chọn đúng repo.');
      const token = await this.client.token(installation), repo = await this.client.repo(row.full_name, token);
      if (!repo) fail(409, 'GitHub App chưa được cấp quyền đọc repo này.');
      if (!repo.private) fail(409, 'Repo phải ở chế độ Private để đội khác không xem được mã.');
      if (repo.size > REPO_SIZE_KB) fail(409, 'Repo vượt 50 MB (tính cả lịch sử). Hãy tạo repo mới chỉ chứa bot.');
      const code = await this.client.file(repo.full_name, 'ott-verify.txt', repo.default_branch, token);
      if (code?.trim() !== row.verify_code) fail(409, `File ott-verify.txt trên nhánh ${repo.default_branch} chưa chứa đúng mã xác thực của đội.`);
      if (this.db.prepare("SELECT 1 FROM team_repos WHERE repo_id=? AND status='verified' AND user_id<>?").get(repo.id, userId)) fail(409, 'Repo này đã được một đội khác xác minh.');
      try {
        const updated = this.db.prepare(`UPDATE team_repos SET status='verified',full_name=?,repo_id=?,installation_id=?,default_branch=?,verified_at=?,updated_at=?
          WHERE user_id=? AND full_name=? AND verify_code=?`).run(repo.full_name, repo.id, installation, repo.default_branch, this.now(), this.now(), userId, row.full_name, row.verify_code);
        if (!updated.changes) fail(409, 'Thông tin repo vừa thay đổi. Tải lại trang rồi xác minh lại.');
      } catch (error) { if (error.code?.startsWith('ERR_SQLITE')) fail(409, 'Repo này đã được một đội khác xác minh.'); throw error; }
      return this.team(userId);
    });
  }
  submitHead(userId, stageId) {
    return this.exclusive(userId, async () => {
      const row = this.repoRow(userId);
      if (!this.configured()) fail(503, 'Hệ thống chưa cấu hình GitHub App.');
      if (row?.status !== 'verified') fail(409, 'Cần xác minh repo GitHub trước khi nộp bằng commit.');
      if (stageId) this.stages.checkSubmission(stageId, userId);
      const sha = await this.headOf(row);
      return this.submissions.submitCommit({ userId, stageId: stageId || null, repo: row.full_name, sha, origin: 'button' });
    });
  }
  async headOf(row) {
    try { return await this.client.head(row.full_name, row.default_branch, await this.client.token(row.installation_id)); }
    catch (error) { if (error instanceof GitHubError) fail(409, `Không đọc được nhánh ${row.default_branch} của repo; kiểm tra GitHub App còn được cài.`); throw error; }
  }
  // Called by the submission worker, outside the bot sandbox; nothing from the repo is executed here.
  async download(submission) {
    if (!this.configured()) throw new InfrastructureError('github_not_configured', 'Máy chủ chưa cấu hình GitHub App.');
    const unavailable = () => new BotFault('repo_unavailable', 'Không truy cập được repo: GitHub App đã bị gỡ, repo bị xóa hoặc đổi tên.');
    const installation = await this.client.installation(submission.repo_full_name);
    if (!installation) throw unavailable();
    const token = await this.client.token(installation), repo = await this.client.repo(submission.repo_full_name, token);
    if (!repo) throw unavailable();
    if (!repo.private) throw new BotFault('repo_public', 'Repo đang ở chế độ Public nên bài không được chấm. Đặt lại Private rồi nộp lại.');
    if (repo.size > REPO_SIZE_KB) throw new BotFault('repo_too_large', 'Repo vượt 50 MB (tính cả lịch sử).');
    try { return await this.client.zipball(submission.repo_full_name, submission.commit_sha, token, REPO_ARCHIVE_LIMIT); }
    catch (error) {
      if (error instanceof GitHubError && error.status === 404) throw new BotFault('commit_not_found', 'Không tìm thấy commit trong repo (có thể đã bị xóa khỏi lịch sử).');
      if (error instanceof GitHubError && error.status === 413) throw new BotFault('repo_too_large', 'Bản nén repo vượt 50 MB.');
      if (error instanceof GitHubError) throw new InfrastructureError('github_error', error.message);
      throw error;
    }
  }
  async webhook(raw, headers) {
    if (!this.webhookSecret) fail(503, 'Webhook GitHub chưa được cấu hình.');
    if (!Buffer.isBuffer(raw)) fail(400, 'Thiếu nội dung webhook.');
    const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', this.webhookSecret).update(raw).digest('hex')}`), given = Buffer.from(String(headers['x-hub-signature-256'] || ''));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) fail(401, 'Chữ ký webhook không hợp lệ.');
    const event = headers['x-github-event'], delivery = String(headers['x-github-delivery'] || '');
    if (event === 'ping') return { ok: true };
    if (event !== 'push') return { ignored: event };
    if (!/^[A-Za-z0-9-]{1,100}$/.test(delivery)) fail(400, 'Thiếu mã delivery.');
    let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'Webhook không phải JSON.'); }
    const repoId = payload?.repository?.id, ref = payload?.ref, sha = payload?.after;
    if (!Number.isSafeInteger(repoId) || typeof ref !== 'string' || ref.length > 255 || payload.deleted || !SHA.test(sha)) return { ignored: 'push' };
    // The receive time, not the commit timestamp, decides whether a push beat the deadline.
    if (!this.db.prepare('INSERT OR IGNORE INTO repo_pushes VALUES (?,?,?,?,?)').run(delivery, repoId, ref, sha, this.now()).changes) return { duplicate: true };
    if (!ref.startsWith('refs/tags/ott-submit')) return { recorded: true };
    const team = this.db.prepare("SELECT * FROM team_repos WHERE repo_id=? AND status='verified'").get(repoId);
    if (!team) return { recorded: true, ignored: 'unverified_repo' };
    const commit = SHA.test(payload.head_commit?.id) ? payload.head_commit.id : sha;
    const open = this.stages.listForUser(team.user_id).filter(stage => stage.canSubmit);
    if (open.length > 1) return { recorded: true, ignored: 'multiple_open_stages' };
    try {
      const submission = await this.submissions.submitCommit({ userId: team.user_id, stageId: open[0]?.id || null, repo: team.full_name, sha: commit, origin: 'tag' });
      return { recorded: true, submission: submission.id };
    } catch (error) { if (error.status) return { recorded: true, error: error.message }; throw error; }
  }
  dueTeams(stageId) {
    return this.db.prepare(`SELECT r.* FROM tournament_stage_entrants e JOIN tournament_stages s ON s.id=e.stage_id
      JOIN team_repos r ON r.user_id=e.user_id AND r.status='verified' AND r.verified_at<s.closes_at
      LEFT JOIN repo_snapshots p ON p.stage_id=e.stage_id AND p.user_id=e.user_id
      WHERE e.stage_id=? AND p.user_id IS NULL ORDER BY e.user_id`).all(stageId);
  }
  pending(stageId) {
    const stage = this.stages.row(stageId);
    return !!stage && stage.closes_at <= this.now() && this.dueTeams(stageId).length > 0;
  }
  async snapshotTeam(stage, team) {
    const record = (sha, source, submissionId, error) => this.db.prepare('INSERT OR IGNORE INTO repo_snapshots VALUES (?,?,?,?,?,?,?)').run(stage.id, team.user_id, sha, source, submissionId, error, this.now());
    const push = this.db.prepare('SELECT sha,received_at FROM repo_pushes WHERE repo_id=? AND ref=? AND received_at<? ORDER BY received_at DESC,rowid DESC LIMIT 1')
      .get(team.repo_id, `refs/heads/${team.default_branch}`, stage.closes_at);
    let sha = push?.sha, source = 'webhook', receivedAt = push?.received_at;
    if (!push) {
      // shortcut: without a webhook record the poll may run minutes after the deadline; a SHA first seen after it is refused.
      source = 'poll'; receivedAt = stage.closes_at - 1;
      try { sha = await this.headOf(team); } catch (error) { if (error.status) return record(null, source, null, 'repo_unavailable'); throw error; }
      if (this.db.prepare('SELECT 1 FROM repo_pushes WHERE repo_id=? AND sha=? AND received_at>=?').get(team.repo_id, sha, stage.closes_at)) return record(null, source, null, 'pushed_after_deadline');
    }
    try {
      const submission = await this.submissions.submitCommit({ userId: team.user_id, stageId: stage.id, repo: team.full_name, sha, origin: 'deadline', receivedAt });
      record(sha, source, submission.id, null);
    } catch (error) { if (error.status) return record(sha, source, null, error.message.slice(0, 500)); throw error; }
  }
  async snapshotDue() {
    if (!this.configured() || this.snapshotting) return;
    this.snapshotting = true;
    try {
      const stages = this.db.prepare(`SELECT s.* FROM tournament_stages s JOIN tournaments t ON t.id=s.tournament_id
        WHERE s.status IN ('open','closing') AND s.closes_at<=? AND t.status<>'cancelled'`).all(this.now());
      let budget = this.snapshotBatch;
      for (const stage of stages) for (const team of this.dueTeams(stage.id)) {
        if (budget-- <= 0) return;
        try { await this.snapshotTeam(stage, team); }
        catch (error) { console.error('GitHub deadline snapshot:', error.message); }
      }
    } finally { this.snapshotting = false; }
  }
  adminOverview() {
    return {
      configured: this.configured(), webhook: !!this.webhookSecret,
      teams: this.db.prepare(`SELECT u.username,p.team_name teamName,r.full_name repo,r.status,r.verified_at verifiedAt FROM users u
        LEFT JOIN team_profiles p ON p.user_id=u.id LEFT JOIN team_repos r ON r.user_id=u.id
        WHERE u.role='contestant' AND u.deleted_at IS NULL ORDER BY u.username LIMIT 5000`).all(),
      duplicates: this.db.prepare(`SELECT s.commit_sha sha,GROUP_CONCAT(DISTINCT u.username) teams FROM bot_submissions s JOIN users u ON u.id=s.user_id
        WHERE s.commit_sha IS NOT NULL GROUP BY s.commit_sha HAVING COUNT(DISTINCT s.user_id)>1 ORDER BY s.commit_sha LIMIT 500`).all()
    };
  }
  start() {
    if (this.timer || !this.configured()) return;
    this.timer = setInterval(() => this.snapshotDue().catch(error => console.error('GitHub snapshot:', error)), this.intervalMs); this.timer.unref();
  }
  close() { clearInterval(this.timer); this.timer = null; }
}
module.exports = { RepoService, parseRepo };
