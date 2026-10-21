const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { RuleSetService } = require('../src/rule-sets');
const { TournamentService } = require('../src/tournaments');
const { TournamentStages } = require('../src/tournament-stages');
const { SubmissionService } = require('../src/submissions/service');
const { extractRepo } = require('../src/submissions/source');
const { GitHubClient } = require('../src/github/client');
const { RepoService } = require('../src/github/repos');
const { importUsers } = require('../src/admin');
const { DEFAULT_RULES, } = require('../src/game/engine');
const { fakeGitHub, bot, manifest, sha, SYMLINK, repoZip } = require('./github-fake');
const { zip } = require('./zip-helper');

const status = n => error => error.status === n;

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-github-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const github = await fakeGitHub(publicKey);
  const db = openDatabase(':memory:'); let time = 1000; const sleeps = [];
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin','unused','admin',0)").run();
  await importUsers(db, 'team_id,password_temp,team_name,leader_email\nteam-a,password-a1,Đội A,a@example.com\nteam-b,,Đội B,b@example.com\nteam-c,password-c1,Đội C,c@example.com');
  const id = name => db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const ruleSets = new RuleSetService(db), now = () => time;
  const tournaments = new TournamentService(db, { ruleSets, now });
  const stages = new TournamentStages(db, { tournaments, now }); tournaments.stages = stages;
  const law = ruleSets.save({ userId: 1, name: 'Luật nhanh', rules: { ...DEFAULT_RULES, maxMoves: 8 } });
  const submissions = new SubmissionService(db, { storageRoot: root, stages, now, retryDelayMs: 0, managerFactory: () => ({
    async check() {}, async prepare(source) { return { ...source, image: 'fake-image', hash: 'test-hash', compile_cpu_ms: 1 }; },
    async start() { return { async close() {}, async move(request) { return { cpu_ms: 1, stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[0] }) }; } }; },
    async dispose() {},
  }) });
  const client = new GitHubClient({ appId: 42, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), apiUrl: github.url, sleep: async ms => { sleeps.push(ms); }, now: () => Date.now() });
  const repos = new RepoService(db, { client, appSlug: 'ott-grader', webhookSecret: 'hook-secret', submissions, stages, now });
  submissions.repos = repos; stages.repos = repos;
  const open = (closesAt = 2000) => {
    let tournament = tournaments.create(1, { name: 'GitHub test', ruleSetId: law.id, ruleSetVersion: law.version });
    tournament = tournaments.replaceEntrants(tournament.id, 1, { expectedRevision: tournament.revision, userIds: [id('team-a'), id('team-b')] });
    return stages.open(tournament.id, 1, { expectedRevision: tournament.revision, closesAt });
  };
  const verified = async (user, name, options) => {
    const team = repos.register(id(user), `https://github.com/${name}.git`);
    github.repo(name, options); github.state.files.set(name, `${team.repo.verifyCode}\n`);
    return repos.verify(id(user));
  };
  const hook = (event, payload, delivery = crypto.randomUUID(), secret = 'hook-secret') => {
    const raw = Buffer.from(JSON.stringify(payload));
    return repos.webhook(raw, { 'x-github-event': event, 'x-github-delivery': delivery, 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}` });
  };
  try { await run({ db, github, repos, submissions, stages, tournaments, id, open, verified, hook, sleeps, root, clock: value => { time = value; } }); }
  finally { repos.close(); await submissions.close(); db.close(); await github.close(); await fs.rm(root, { recursive: true, force: true }); }
}

test('team CSV import creates profiles, temporary passwords and validates members', () => fixture(async f => {
  const b = f.repos.team(f.id('team-b'));
  assert.equal(b.profile.teamName, 'Đội B'); assert.equal(b.profile.leaderEmail, 'b@example.com'); assert.deepEqual(b.profile.members, []);
  assert.equal(f.db.prepare("SELECT must_change_password m FROM users WHERE username='team-b'").get().m, 1);
  await assert.rejects(importUsers(f.db, 'team_id,password_temp,team_name,leader_email\nteam-x,password-x,Đội X,not-an-email'), status(400));
  await assert.rejects(importUsers(f.db, 'team_id,password_temp,team_name,leader_email\nteam-y,short,Đội Y,y@example.com'), status(400));
  const members = [{ name: 'Nguyễn Văn A', studentId: 'SV001', email: 'a1@example.com', phone: '0901 234 567' }, { name: 'Trần B', studentId: '', email: '', phone: '' }];
  assert.deepEqual(f.repos.saveMembers(f.id('team-a'), members).profile.members, members);
  assert.throws(() => f.repos.saveMembers(f.id('team-a'), Array(5).fill(members[0])), status(400));
  assert.throws(() => f.repos.saveMembers(f.id('team-a'), [{ ...members[0], email: 'x@' }]), status(400));
}));

test('verification requires the installed App, a private repo and the team code; forged claims are refused', () => fixture(async f => {
  const a = f.id('team-a'), b = f.id('team-b');
  assert.throws(() => f.repos.register(a, 'https://gitlab.com/x/y'), status(400));
  const pending = f.repos.register(a, 'https://github.com/team-a/bot.git');
  assert.equal(pending.repo.status, 'pending'); assert.match(pending.repo.verifyCode, /^OTT-[0-9a-f]{24}$/);
  f.github.repo('team-a/bot', { id: 101 });
  await assert.rejects(f.repos.verify(a), /Chưa cài GitHub App/);
  f.github.state.installations.set('team-a/bot', 7);
  await assert.rejects(f.repos.verify(a), /ott-verify.txt/);
  f.github.state.files.set('team-a/bot', pending.repo.verifyCode);
  f.github.state.repos.get('team-a/bot').private = false;
  await assert.rejects(f.repos.verify(a), /Private/);
  f.github.state.repos.get('team-a/bot').private = true; f.github.state.repos.get('team-a/bot').size = 60 * 1024;
  await assert.rejects(f.repos.verify(a), /50 MB/);
  f.github.state.repos.get('team-a/bot').size = 10;
  assert.equal((await f.repos.verify(a)).repo.status, 'verified');
  // Team B claims A's repo: A's file holds A's code, and even a colluding file cannot take a verified repo.
  f.repos.register(b, 'team-a/bot');
  await assert.rejects(f.repos.verify(b), /ott-verify.txt/);
  f.github.state.files.set('team-a/bot', f.repos.team(b).repo.verifyCode);
  await assert.rejects(f.repos.verify(b), /đội khác/);
  assert.equal(f.repos.team(a).repo.status, 'verified');
}));

test('repo archive extraction keeps only bot/ sources and ott.json; rejects symlinks, traversal and bad manifests', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-repo-'));
  const extract = async (files, name = 'x') => extractRepo({ buffer: repoZip(files), directory: path.join(dir, name) });
  try {
    const source = await extract([['ott.json', manifest], ['bot/main.py', bot], ['bot/util.py', 'X=1\n'], ['bot/README.md', 'hi'], ['.git/hooks/post-checkout', '#!/bin/sh\nrm -rf /'], ['.gitmodules', '[submodule "x"]'], ['tools/run.py', 'print(1)'], ['big.bin', 'x'.repeat(5000)]], 'ok');
    assert.deepEqual(source.names, ['main.py', 'util.py']); assert.equal(source.entry, 'main.py'); assert.equal(source.language, 'python');
    assert.deepEqual((await fs.readdir(path.join(dir, 'ok'))).sort(), ['main.py', 'util.py']);
    await assert.rejects(extract([['ott.json', manifest], ['bot/main.py', '/etc/passwd', SYMLINK]], 'link'), { code: 'zip_special_file' });
    // yauzl's strictFileNames refuses '..' before our own path check runs.
    await assert.rejects(extract([['ott.json', manifest], ['bot/../escape.py', bot]], 'dots'), { code: 'invalid_zip' });
    await assert.rejects(extract([['ott.json', manifest], ['bot/.hidden/x.py', bot]], 'hidden'), { code: 'unsafe_path' });
    await assert.rejects(extract([['bot/main.py', bot]], 'nomanifest'), { code: 'manifest_missing' });
    await assert.rejects(extract([['ott.json', '{"language":"cpp","entry":"main.cpp"}'], ['bot/main.py', bot]], 'mismatch'), { code: 'manifest_invalid' });
    await assert.rejects(extract([['ott.json', 'not json'], ['bot/main.py', bot]], 'badjson'), { code: 'manifest_invalid' });
    await assert.rejects(extract([['ott.json', manifest], ['bot/notes.txt', 'x']], 'empty'), { code: 'empty_source' });
    await assert.rejects(extractRepo({ buffer: zip([{ name: 'a/ott.json', data: manifest }, { name: 'b/bot/main.py', data: bot }]), directory: path.join(dir, 'prefix') }), { code: 'invalid_zip' });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('submit button records the HEAD SHA once per team; another team with the same SHA gets its own version', () => fixture(async f => {
  const a = f.id('team-a'), b = f.id('team-b'), stage = f.open().stages[0];
  await f.verified('team-a', 'team-a/bot', { id: 101, installation: 7, head: sha('a') });
  await f.verified('team-b', 'team-b/fork', { id: 202, installation: 8, head: sha('a') });
  const first = await f.repos.submitHead(a, stage.id), again = await f.repos.submitHead(a, stage.id);
  assert.equal(first.id, again.id); assert.equal(first.commit_sha, sha('a')); assert.equal(first.origin, 'button');
  const other = await f.repos.submitHead(b, stage.id);
  assert.notEqual(other.id, first.id);
  assert.deepEqual(f.repos.adminOverview().duplicates.map(row => ({ ...row })), [{ sha: sha('a'), teams: 'team-a,team-b' }]);
  f.submissions.start(); await f.submissions.idle();
  assert.equal(f.submissions.detail(first.id, a).status, 'Accepted'); assert.equal(f.submissions.detail(other.id, b).status, 'Accepted');
  assert.ok(f.github.state.seen.some(line => line.startsWith('GET /codeload/team-a/bot/')));
  f.clock(2000);
  await assert.rejects(f.repos.submitHead(a, stage.id), status(409));
  await assert.rejects(f.repos.submitHead(f.id('team-c'), null), /xác minh repo/);
}));

test('worker rejects a repo turned public, a removed commit and a symlink without blaming infrastructure', () => fixture(async f => {
  const a = f.id('team-a');
  await f.verified('team-a', 'team-a/bot', { id: 101, installation: 7, head: sha('b') });
  const publicRepo = await f.repos.submitHead(a, null);
  f.github.state.repos.get('team-a/bot').private = false;
  f.submissions.start(); await f.submissions.idle();
  assert.equal(f.submissions.detail(publicRepo.id, a).reason_code, 'repo_public');
  f.github.state.repos.get('team-a/bot').private = true;
  f.github.state.heads.set('team-a/bot', sha('c'));
  const missing = await f.repos.submitHead(a, null); await f.submissions.idle();
  assert.equal(f.submissions.detail(missing.id, a).reason_code, 'commit_not_found');
  f.github.state.heads.set('team-a/bot', sha('d')); f.github.state.zips.set(`team-a/bot@${sha('d')}`, repoZip([['ott.json', manifest], ['bot/main.py', 'x', SYMLINK]]));
  const linked = await f.repos.submitHead(a, null); await f.submissions.idle();
  const detail = f.submissions.detail(linked.id, a);
  assert.equal(detail.status, 'Rejected'); assert.equal(detail.error_type, 'bot'); assert.equal(detail.reason_code, 'zip_special_file');
}));

test('rate limits back off and retry; exhausted retries are infrastructure errors', () => fixture(async f => {
  await f.verified('team-a', 'team-a/bot', { id: 101, installation: 7 });
  f.github.state.limited = 2;
  const submission = await f.repos.submitHead(f.id('team-a'), null);
  assert.equal(submission.commit_sha, sha('a')); assert.equal(f.sleeps.length, 2); assert.ok(f.sleeps.every(ms => ms > 0 && ms <= 60000));
  f.github.state.limited = 10;
  await assert.rejects(f.repos.client.head('team-a/bot', 'main', 'tok-7'), { code: 'github_rate_limited' });
}));

test('webhook checks HMAC, ignores duplicate deliveries and submits ott-submit tags', () => fixture(async f => {
  const stage = f.open().stages[0];
  await f.verified('team-a', 'team-a/bot', { id: 101, installation: 7 });
  await assert.rejects(f.hook('push', { ref: 'refs/heads/main', after: sha('1'), repository: { id: 101 } }, 'd1', 'wrong-secret'), status(401));
  assert.deepEqual(await f.hook('push', { ref: 'refs/heads/main', after: sha('1'), repository: { id: 101 } }, 'd1'), { recorded: true });
  assert.deepEqual(await f.hook('push', { ref: 'refs/heads/main', after: sha('1'), repository: { id: 101 } }, 'd1'), { duplicate: true });
  const tagged = await f.hook('push', { ref: 'refs/tags/ott-submit-1', after: sha('9'), head_commit: { id: sha('2') }, repository: { id: 101 } }, 'd2');
  const row = f.db.prepare('SELECT stage_id,commit_sha,origin FROM bot_submissions WHERE id=?').get(tagged.submission);
  assert.deepEqual({ ...row }, { stage_id: stage.id, commit_sha: sha('2'), origin: 'tag' });
  assert.deepEqual(await f.hook('push', { ref: 'refs/tags/ott-submit-2', after: sha('3'), repository: { id: 999 } }, 'd3'), { recorded: true, ignored: 'unverified_repo' });
}));

test('deadline snapshot uses the last push received before the deadline and blocks locking until done', () => fixture(async f => {
  const a = f.id('team-a'), b = f.id('team-b'), opened = f.open(2000), stage = opened.stages[0];
  await f.verified('team-a', 'team-a/bot', { id: 101, installation: 7, head: sha('e') });
  await f.verified('team-b', 'team-b/bot', { id: 202, installation: 8, head: sha('f') });
  f.clock(1500); await f.hook('push', { ref: 'refs/heads/main', after: sha('1'), repository: { id: 101 } });
  f.clock(2100); await f.hook('push', { ref: 'refs/heads/main', after: sha('e'), repository: { id: 101 } });
  // Team B has no webhook record before the deadline, but its polled HEAD was first seen after it.
  await f.hook('push', { ref: 'refs/heads/main', after: sha('f'), repository: { id: 202 } });
  assert.equal(f.repos.pending(stage.id), true);
  const tournament = f.tournaments.get(opened.id);
  assert.throws(() => f.stages.lock(opened.id, 1, { expectedRevision: tournament.revision, reason: 'hết giờ' }), /GitHub/);
  await f.repos.snapshotDue();
  assert.equal(f.repos.pending(stage.id), false);
  const snapA = f.db.prepare('SELECT * FROM repo_snapshots WHERE user_id=?').get(a), snapB = f.db.prepare('SELECT * FROM repo_snapshots WHERE user_id=?').get(b);
  assert.equal(snapA.sha, sha('1')); assert.equal(snapA.source, 'webhook');
  assert.equal(snapB.sha, null); assert.equal(snapB.error, 'pushed_after_deadline');
  const deadline = f.db.prepare('SELECT * FROM bot_submissions WHERE id=?').get(snapA.submission_id);
  assert.equal(deadline.origin, 'deadline'); assert.equal(deadline.created_at, 1500); assert.equal(deadline.stage_id, stage.id);
  await f.repos.snapshotDue();
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bot_submissions WHERE origin=?').get('deadline').n, 1);
}));

test('deadline snapshot polls HEAD when no webhook was recorded and reuses an earlier submission of that SHA', () => fixture(async f => {
  const a = f.id('team-a'), opened = f.open(2000), stage = opened.stages[0];
  await f.verified('team-a', 'team-a/bot', { id: 101, installation: 7, head: sha('7') });
  const early = await f.repos.submitHead(a, stage.id);
  f.clock(2500); await f.repos.snapshotDue();
  const snapshot = f.db.prepare('SELECT * FROM repo_snapshots WHERE user_id=?').get(a);
  assert.equal(snapshot.source, 'poll'); assert.equal(snapshot.submission_id, early.id);
}));
