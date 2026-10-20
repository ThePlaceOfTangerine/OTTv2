const crypto = require('node:crypto');
const path = require('node:path');
const { buildSite } = require('./site');
const { deployConfig, deploySite } = require('./deploy');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const reasonOf = body => {
  const reason = body?.reason;
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) fail(400, 'Cần lý do từ 1 đến 500 ký tự.');
  return reason.trim();
};
// Public copy of a replay: moves, board changes and result only (no bot stderr, userdata or artifact hashes).
const publicReplay = replay => ({ seed: replay.seed, engine_version: replay.engine_version, rules: replay.rules, initial: replay.initial, result: replay.result,
  fault: replay.fault ? { player: replay.fault.player, code: replay.fault.code } : undefined,
  bots: (replay.bots || []).map(bot => ({ id: typeof bot === 'string' ? bot : bot?.id })),
  turns: replay.turns.map(turn => ({ request_id: turn.request_id, player: turn.player, move: turn.move, ...(turn.changes ? { changes: turn.changes } : {}) })) });

class PublicationService {
  constructor(db, { tournaments, swiss, brackets, now = Date.now, siteDir = process.env.PUBLIC_SITE_DIR || path.resolve(__dirname, '../../data/public-site'),
    sheets = null, deploy = deployConfig(), deployRunner = deploySite, autoDeploy = process.env.SITE_AUTO_DEPLOY === '1', publicUrl = process.env.PUBLIC_SITE_URL || '/site/', intervalMs = 10000, log = console.error }) {
    Object.assign(this, { db, tournaments, swiss, brackets, now, siteDir, sheets, deploy, deployRunner, autoDeploy, publicUrl, intervalMs, log });
    this.building = Promise.resolve(); this.lastBuild = null;
    // Created eagerly so the key exists before any bundle is exported (lookup codes must match on every machine).
    this.secret();
  }
  // HMAC key created once and stored in the database, so lookup codes survive restarts and moving to another machine.
  secret() {
    this.db.prepare('INSERT OR IGNORE INTO app_secrets VALUES (?,?,?)').run('team_lookup', crypto.randomBytes(32).toString('hex'), this.now());
    return this.db.prepare("SELECT value FROM app_secrets WHERE name='team_lookup'").get().value;
  }
  // Lowercase hex: file names must not collide on case-insensitive file systems.
  lookupCode(userId) { return crypto.createHmac('sha256', this.secret()).update(`team:${userId}`).digest('hex').slice(0, 20); }
  snapshot(id) {
    const tournament = this.tournaments.row(id);
    const teamName = new Map(this.db.prepare('SELECT user_id,team_name FROM team_profiles').all().map(row => [row.user_id, row.team_name]));
    const team = (userId, username) => ({ userId, team: username, teamName: teamName.get(userId) || null });
    const swiss = this.swiss.get(id, false);
    const finishedRounds = swiss?.rounds?.filter(round => round.status === 'finished').length || 0;
    const standings = (swiss?.standings || []).map(e => ({ rank: e.rank, ...team(e.userId, e.username), points: e.points, buchholz: e.buchholz, sonnebornBerger: e.sonnebornBerger,
      gamePoints: e.gamePoints, wins: e.wins, draws: e.draws, losses: e.losses, byes: e.byes, rankChange: e.rankChange ?? null, badges: e.badges || [] }));
    const qualification = swiss?.qualification ? { topN: swiss.qualification.topN, approvedAt: swiss.qualification.approvedAt, teams: swiss.qualification.teams.map(e => ({ seed: e.seed, ...team(e.userId, e.username) })) } : null;
    const plan = this.brackets.get(id);
    const slot = s => s && { seed: s.seed, ...team(s.userId, s.username) };
    const bracket = plan ? { status: plan.status, teamCount: plan.teamCount, size: plan.size, publishedAt: plan.publishedAt || null, controlReason: plan.controlReason || null,
      champion: slot(plan.champion), rounds: plan.rounds.map(round => ({ number: round.number, matches: round.matches.map(m => ({ id: m.id, number: m.number, status: m.status,
        slots: m.slots.map(slot), winner: slot(m.winner), points: m.points || null, decidedBy: m.decidedBy || null })) })),
      games: this.db.prepare('SELECT id,match_id,number,player0,player1,status,replay_json FROM bracket_games WHERE tournament_id=? ORDER BY rowid').all(id)
        .map(g => ({ id: g.id, matchId: g.match_id, number: g.number, player0: g.player0, player1: g.player1, status: g.status, replay: g.status === 'finished' && g.replay_json ? publicReplay(JSON.parse(g.replay_json)) : null })) } : null;
    const teams = this.db.prepare('SELECT e.user_id userId,e.username FROM tournament_entrants e WHERE e.tournament_id=? ORDER BY e.username').all(id).map(entrant => {
      const rank = standings.find(row => row.userId === entrant.userId), seed = qualification?.teams.find(row => row.userId === entrant.userId)?.seed ?? null;
      const latest = this.db.prepare(`SELECT s.version,s.status FROM bot_submissions s JOIN tournament_stages st ON st.id=s.stage_id
        WHERE st.tournament_id=? AND s.user_id=? ORDER BY s.created_at DESC,s.version DESC LIMIT 1`).get(id, entrant.userId);
      const locked = this.db.prepare(`SELECT e.snapshot_json FROM tournament_stage_entrants e JOIN tournament_stages st ON st.id=e.stage_id
        WHERE st.tournament_id=? AND e.user_id=? AND e.snapshot_json IS NOT NULL ORDER BY CASE st.kind WHEN 'final' THEN 0 ELSE 1 END LIMIT 1`).get(id, entrant.userId);
      let progress = null;
      if (bracket && seed !== null) {
        const matches = bracket.rounds.flatMap(round => round.matches.map(match => ({ round: round.number, match }))).filter(({ match }) => match.slots.some(s => s?.userId === entrant.userId));
        const last = matches.at(-1);
        progress = bracket.champion?.userId === entrant.userId ? 'Vô địch' : last?.match.status === 'finished' && last.match.winner?.userId !== entrant.userId ? `Dừng ở lượt ${last.round} loại trực tiếp` : 'Đang thi đấu loại trực tiếp';
      }
      return { ...team(entrant.userId, entrant.username), rank: rank?.rank ?? null, points: rank?.points ?? null, qualified: seed !== null, seed, bracket: progress,
        bot: { latestVersion: latest?.version ?? null, latestStatus: latest?.status ?? null, lockedVersion: locked ? JSON.parse(locked.snapshot_json).version : null } };
    });
    return { schema: 1, tournament: { id, name: tournament.name, status: tournament.status },
      swiss: swiss && swiss.status !== 'not_started' ? { status: swiss.status, provisional: !qualification, roundsFinished: finishedRounds, roundsTotal: swiss.preview.rounds, standings } : null,
      qualification, bracket, teams };
  }
  publish(id, actorId, body, trigger = 'manual') {
    const reason = reasonOf(body);
    const publication = this.tournaments.transaction(() => {
      if (actorId !== null) this.tournaments.actor(actorId);
      if (!this.tournaments.row(id)) return null;
      const version = this.db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM publications WHERE tournament_id=?').get(id).n, time = this.now();
      const snapshot = { ...this.snapshot(id), version, publishedAt: time, trigger, reason };
      const row = this.db.prepare('INSERT INTO publications(tournament_id,version,created_at,created_by,trigger,reason,snapshot_json) VALUES (?,?,?,?,?,?,?) RETURNING id')
        .get(id, version, time, actorId, trigger, reason, JSON.stringify(snapshot));
      if (this.sheets) this.db.prepare("INSERT INTO sheet_syncs(publication_id,status,updated_at) VALUES (?,'queued',?)").run(row.id, time);
      this.tournaments.event(id, actorId ?? this.tournaments.row(id).created_by, 'results_snapshot_published', { version, trigger, reason });
      return { id: row.id, version, publishedAt: time };
    });
    if (publication) this.rebuild(this.autoDeploy);
    return publication;
  }
  schedule(id, actorId, body) {
    const reason = reasonOf(body), at = body?.publishAt;
    if (!Number.isSafeInteger(at) || at <= this.now()) fail(400, 'Thời điểm công bố phải ở tương lai (timestamp mili giây).');
    if (!this.tournaments.row(id)) return null;
    this.tournaments.actor(actorId);
    this.db.prepare('INSERT INTO publication_schedules(tournament_id,publish_at,reason,created_by,created_at) VALUES (?,?,?,?,?)').run(id, at, reason, actorId, this.now());
    return this.list(id);
  }
  cancelSchedule(scheduleId, actorId) {
    this.tournaments.actor(actorId);
    const row = this.db.prepare("SELECT tournament_id FROM publication_schedules WHERE id=? AND status='pending'").get(scheduleId);
    if (!row) fail(409, 'Chỉ hủy được lịch đang chờ.');
    this.db.prepare("UPDATE publication_schedules SET status='cancelled',finished_at=?,note=? WHERE id=?").run(this.now(), `Hủy bởi admin ${actorId}`, scheduleId);
    return this.list(row.tournament_id);
  }
  // Pausing stops scheduled publications without editing server config; schedules that fall due while paused are skipped, not delayed.
  control(id, actorId, body) {
    const reason = reasonOf(body);
    if (typeof body.paused !== 'boolean') fail(400, 'Cần chọn tạm hoãn hoặc tiếp tục công bố tự động.');
    if (!this.tournaments.row(id)) return null;
    this.tournaments.actor(actorId);
    this.db.prepare('INSERT INTO publication_controls VALUES (?,?,?,?,?) ON CONFLICT(tournament_id) DO UPDATE SET auto_paused=excluded.auto_paused,reason=excluded.reason,changed_by=excluded.changed_by,changed_at=excluded.changed_at')
      .run(id, body.paused ? 1 : 0, reason, actorId, this.now());
    this.tournaments.event(id, actorId, body.paused ? 'auto_publish_paused' : 'auto_publish_resumed', { reason });
    return this.list(id);
  }
  runSchedules() {
    for (const row of this.db.prepare("SELECT * FROM publication_schedules WHERE status='pending' AND publish_at<=? ORDER BY publish_at").all(this.now())) {
      // Schedules wait while another machine holds the tournament (e.g. during the LAN final) and run once authority returns.
      if (this.authority && !this.authority.owns(`tournament:${row.tournament_id}`)) continue;
      const paused = this.db.prepare('SELECT auto_paused FROM publication_controls WHERE tournament_id=?').get(row.tournament_id)?.auto_paused;
      if (paused) { this.db.prepare("UPDATE publication_schedules SET status='skipped',finished_at=?,note=? WHERE id=?").run(this.now(), 'Bỏ qua vì công bố tự động đang tạm hoãn.', row.id); continue; }
      try {
        const publication = this.publish(row.tournament_id, null, { reason: `Theo lịch: ${row.reason}` }, 'schedule');
        this.db.prepare("UPDATE publication_schedules SET status='done',finished_at=?,publication_id=? WHERE id=?").run(this.now(), publication.id, row.id);
      } catch (error) { this.db.prepare("UPDATE publication_schedules SET status='failed',finished_at=?,note=? WHERE id=?").run(this.now(), String(error.message).slice(0, 500), row.id); }
    }
  }
  sheetTabs(snapshot) {
    const name = snapshot.tournament.name.replace(/[[\]:*?/\\']/g, ' ').slice(0, 60).trim();
    const label = t => t.teamName ? `${t.team} (${t.teamName})` : t.team;
    return [
      { title: `${name} · Xếp hạng`, rows: [[`Bản công bố v${snapshot.version}`, new Date(snapshot.publishedAt).toISOString(), snapshot.swiss?.provisional ? 'Tạm tính' : 'Đã duyệt'],
        ['Hạng', 'Đội', 'Tên đội', 'Điểm', 'Buchholz', 'Sonneborn-Berger', 'Điểm ván', 'Thắng', 'Hòa', 'Thua', 'Miễn đấu'],
        ...(snapshot.swiss?.standings || []).map(e => [e.rank, e.team, e.teamName || '', e.points, e.buchholz, e.sonnebornBerger, e.gamePoints, e.wins, e.draws, e.losses, e.byes])] },
      { title: `${name} · Loại trực tiếp`, rows: [['Lượt', 'Cặp', 'Đội A', 'Đội B', 'Điểm', 'Đi tiếp', 'Trạng thái'],
        ...(snapshot.bracket?.rounds || []).flatMap(round => round.matches.map(m => [round.number, m.number, m.slots[0] ? label(m.slots[0]) : '—', m.slots[1] ? label(m.slots[1]) : '—',
          m.points ? m.points.join(' - ') : '', m.winner ? label(m.winner) : '', m.status]))] },
      { title: `${name} · Đội`, rows: [['Đội', 'Tên đội', 'Hạng', 'Điểm', 'Đi tiếp', 'Hạt giống', 'Loại trực tiếp', 'Bot đã chốt'],
        ...snapshot.teams.map(t => [t.team, t.teamName || '', t.rank ?? '', t.points ?? '', t.qualified ? 'Có' : 'Không', t.seed ?? '', t.bracket || '', t.bot.lockedVersion ? `v${t.bot.lockedVersion}` : ''])] },
    ];
  }
  async runSheets() {
    if (!this.sheets || this.syncing) return;
    this.syncing = true;
    try {
      const job = this.db.prepare("SELECT s.*,p.snapshot_json FROM sheet_syncs s JOIN publications p ON p.id=s.publication_id WHERE s.status='queued' AND s.available_at<=? ORDER BY s.publication_id LIMIT 1").get(this.now());
      if (!job) return;
      try {
        await this.sheets.write(this.sheetTabs(JSON.parse(job.snapshot_json)));
        this.db.prepare("UPDATE sheet_syncs SET status='done',attempts=attempts+1,error=NULL,updated_at=? WHERE publication_id=?").run(this.now(), job.publication_id);
      } catch (error) {
        const attempts = job.attempts + 1;
        this.db.prepare('UPDATE sheet_syncs SET status=?,attempts=?,available_at=?,error=?,updated_at=? WHERE publication_id=?')
          .run(attempts >= 5 ? 'failed' : 'queued', attempts, this.now() + 30000 * 2 ** attempts, String(error.message).slice(0, 1000), this.now(), job.publication_id);
      }
    } finally { this.syncing = false; }
  }
  retrySheet(publicationId, actorId) {
    this.tournaments.actor(actorId);
    if (!this.db.prepare("UPDATE sheet_syncs SET status='queued',attempts=0,available_at=0,updated_at=? WHERE publication_id=? AND status='failed'").run(this.now(), publicationId).changes) fail(409, 'Chỉ chạy lại bản đồng bộ đã thất bại.');
    return true;
  }
  // Builds are serialised; the site always reflects every publication, so a failed build is fixed by the next one.
  rebuild(deploy = false) {
    this.building = this.building.then(async () => {
      try { this.lastBuild = { at: this.now(), ...(await buildSite({ db: this.db, dir: this.siteDir, lookupCode: userId => this.lookupCode(userId) })) }; }
      catch (error) { this.lastBuild = { at: this.now(), error: error.message }; this.log('Site build:', error.message); return; }
      if (deploy) await this.deploySite();
    });
    return this.building;
  }
  async deploySite() {
    const id = this.db.prepare("INSERT INTO site_deploys(created_at,status) VALUES (?,'running') RETURNING id").get(this.now()).id;
    if (!this.deploy) { this.db.prepare("UPDATE site_deploys SET status='blocked',finished_at=?,output=? WHERE id=?").run(this.now(), 'Bị chặn: cần CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID và CLOUDFLARE_PAGES_PROJECT.', id); return; }
    const result = await this.deployRunner(this.siteDir, this.deploy);
    this.db.prepare('UPDATE site_deploys SET status=?,finished_at=?,output=? WHERE id=?').run(result.ok ? 'done' : 'failed', this.now(), result.output.slice(-4000), id);
  }
  list(id) {
    return {
      publications: this.db.prepare(`SELECT p.id,p.version,p.created_at createdAt,p.trigger,p.reason,s.status sheetStatus,s.error sheetError,s.attempts sheetAttempts
        FROM publications p LEFT JOIN sheet_syncs s ON s.publication_id=p.id WHERE p.tournament_id=? ORDER BY p.version DESC LIMIT 50`).all(id),
      schedules: this.db.prepare('SELECT id,publish_at publishAt,reason,status,note,publication_id publicationId FROM publication_schedules WHERE tournament_id=? ORDER BY publish_at DESC LIMIT 50').all(id),
      control: this.db.prepare('SELECT auto_paused autoPaused,reason,changed_at changedAt FROM publication_controls WHERE tournament_id=?').get(id) || { autoPaused: 0 },
      site: { publicUrl: this.publicUrl, lastBuild: this.lastBuild, deployConfigured: !!this.deploy, autoDeploy: this.autoDeploy,
        deploys: this.db.prepare('SELECT id,created_at createdAt,finished_at finishedAt,status,output FROM site_deploys ORDER BY id DESC LIMIT 5').all() },
      sheetsConfigured: !!this.sheets,
    };
  }
  start() {
    if (this.timer) return;
    this.rebuild();
    this.timer = setInterval(() => { try { this.runSchedules(); } catch (error) { this.log('Publication schedule:', error); } this.runSheets().catch(error => this.log('Sheets:', error)); }, this.intervalMs);
    this.timer.unref();
  }
  async close() { clearInterval(this.timer); this.timer = null; await this.building; }
}

function registerPublications(app, { publications, requireRole, csrf }) {
  const send = (res, value) => value ? res.json(value) : res.status(404).json({ error: 'Không tìm thấy giải.' });
  app.get('/api/admin/tournaments/:id/publications', requireRole('admin'), (req, res) => send(res, publications.tournaments.row(req.params.id) && publications.list(req.params.id)));
  app.post('/api/admin/tournaments/:id/publications', requireRole('admin'), csrf, (req, res) => { const row = publications.publish(req.params.id, req.auth.id, req.body); row ? res.status(201).json(publications.list(req.params.id)) : send(res, null); });
  app.post('/api/admin/tournaments/:id/publication-schedules', requireRole('admin'), csrf, (req, res) => send(res, publications.schedule(req.params.id, req.auth.id, req.body)));
  app.post('/api/admin/publication-schedules/:sid/cancel', requireRole('admin'), csrf, (req, res) => res.json(publications.cancelSchedule(Number(req.params.sid), req.auth.id)));
  app.post('/api/admin/tournaments/:id/publication-control', requireRole('admin'), csrf, (req, res) => send(res, publications.control(req.params.id, req.auth.id, req.body)));
  app.post('/api/admin/publications/:pid/sheet-retry', requireRole('admin'), csrf, (req, res) => res.json({ ok: publications.retrySheet(Number(req.params.pid), req.auth.id) }));
  app.post('/api/admin/site/deploy', requireRole('admin'), csrf, async (req, res) => { await publications.rebuild(true); res.json(publications.list(req.body?.tournamentId || '')); });
}
module.exports = { PublicationService, registerPublications, publicReplay };
