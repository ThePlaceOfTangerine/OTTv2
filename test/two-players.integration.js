// Full HTTP workflow with separate sessions, real multipart uploads and Docker.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { createUser } = require('../src/users');
const { verifyReplay } = require('../src/game/match');

test('two contestants log in, change temporary passwords, upload Python/C++ and play a ranked round over HTTP', { timeout: 180000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-two-players-'));
  const db = openDatabase(path.join(root, 'arena.sqlite'));
  const temporaryPassword = crypto.randomBytes(18).toString('base64url');
  await createUser(db, { username: 'organizer', password: temporaryPassword, role: 'admin' });
  const app = await createApp({ db, submissionOptions: { storageRoot: path.join(root, 'submissions') } });
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  app.locals.submissions.start(); app.locals.scoring.start();
  async function request(url, session, { method = 'GET', body } = {}) {
    const form = body instanceof FormData;
    const response = await fetch(base + url, { method, headers: { ...(session ? { Cookie: session.cookie } : {}), ...(session && method !== 'GET' ? { 'X-CSRF-Token': session.csrf } : {}), ...(body && !form ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: form ? body : JSON.stringify(body) } : {}) });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function login(username, password) {
    const result = await request('/api/auth/login', null, { method: 'POST', body: { username, password } });
    assert.equal(result.status, 200); return { cookie: result.cookie, csrf: result.data.csrfToken, user: result.data.user };
  }
  async function until(read, ready, timeout = 100000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await read(); if (ready(value)) return value; await new Promise(resolve => setTimeout(resolve, 250)); }
    throw new Error('HTTP workflow deadline exceeded');
  }
  const report = { checkedAt: new Date().toISOString(), transport: 'HTTP multipart + separate session cookies', execution: 'Docker', isolatedDatabase: true, players: [], matches: [] };
  try {
    const admin = await login('organizer', temporaryPassword);
    const imported = await request('/api/admin/users/import', admin, { method: 'POST', body: { csv: 'username,password\nstudent_python,\nstudent_cpp,' } });
    assert.equal(imported.status, 200); assert.equal(imported.data.credentials.length, 2);
    const players = [];
    for (const credential of imported.data.credentials) {
      let player = await login(credential.username, credential.password);
      assert.equal(player.user.mustChangePassword, true);
      assert.equal((await request('/api/portal/submissions', player)).status, 403);
      const ownPassword = crypto.randomBytes(18).toString('base64url');
      const changed = await request('/api/auth/password', player, { method: 'POST', body: { currentPassword: credential.password, newPassword: ownPassword, confirmPassword: ownPassword } });
      assert.equal(changed.status, 200);
      assert.equal((await request('/api/auth/me', player)).status, 401);
      player = { cookie: changed.cookie, csrf: changed.data.csrfToken, user: changed.data.user };
      assert.equal(player.user.mustChangePassword, false);
      players.push(player);
    }
    const sources = ['python-greedy/main.py', 'cpp-greedy/main.cpp'];
    const uploads = await Promise.all(players.map(async (player, i) => {
      const filename = path.basename(sources[i]), buffer = await fs.readFile(path.join(__dirname, '../bots', sources[i]));
      const form = new FormData(); form.append('bot', new Blob([buffer]), filename);
      const result = await request('/api/portal/submissions', player, { method: 'POST', body: form });
      assert.equal(result.status, 202, JSON.stringify(result.data)); return result.data;
    }));
    console.log('Both contestants independently uploaded via multipart HTTP.');
    for (const [i, player] of players.entries()) {
      const id = uploads[i].id;
      const submission = await until(async () => (await request(`/api/portal/submissions/${id}`, player)).data, row => ['Accepted','Rejected'].includes(row.status) || row.job_status === 'blocked');
      assert.equal(submission.status, 'Accepted', JSON.stringify(submission)); assert.equal(submission.active, true); assert.equal(submission.tests.length, 2);
      assert.equal((await request(`/api/portal/submissions/${id}`, players[1-i])).status, 404);
      for (const game of submission.tests) {
        const replay = await request(`/api/portal/submissions/${id}/tests/${game.id}`, player);
        assert.equal(replay.status, 200); assert.ok(verifyReplay(replay.data.replay)); assert.ok(!replay.data.replay.fault);
      }
      report.players.push({ username: player.user.username, filename: uploads[i].filename, version: submission.version, status: submission.status, active: submission.active, testReplays: submission.tests.length });
      console.log(player.user.username, submission.status, 'two verified test matches');
    }
    assert.equal((await request('/api/admin/scores', players[0], { method:'POST', body:{} })).status,403);
    const created = await request('/api/admin/scores', admin, { method: 'POST', body: { seed:'two-students-e2e',gamesPerBot:2,gamesPerPair:2 } });
    assert.equal(created.status, 202, JSON.stringify(created.data));
    const roundId = created.data.id;
    const round = await until(async () => (await request(`/api/scores/${roundId}`, admin)).data, row => row.status === 'finished' || row.counts.some(c => c.status === 'blocked'), 80000);
    assert.equal(round.status, 'finished', JSON.stringify(round)); assert.equal(round.matches.length,2); assert.equal(round.standings.length,2);
    const ordered = [...round.matches].sort((a,b)=>a.sequence-b.sequence);
    assert.equal(ordered[0].player0, ordered[1].player1); assert.equal(ordered[0].player1, ordered[1].player0); assert.equal(ordered[0].seed, ordered[1].seed);
    for (const match of ordered) {
      const result = await request(`/api/admin/score-matches/${match.id}`, admin); const replay = result.data.replay;
      assert.equal(result.status,200); assert.ok(verifyReplay(replay)); assert.ok(!replay.fault); assert.equal(replay.rule_set_version,2);
      assert.ok(replay.bots.every(bot => bot.image.startsWith('sha256:')));
      report.matches.push({ sequence:match.sequence+1, sides:replay.bots.map(b=>b.id), winner:replay.result.winner === null ? 'draw' : replay.bots[replay.result.winner].id, reason:replay.result.winReason, moves:replay.turns.length, cpuMs:replay.cpu_ms, ruleVersion:replay.rule_set_version, replayVerified:true });
    }
    for (const player of players) {
      const ownView = await request(`/api/scores/${roundId}`,player);assert.equal(ownView.status,200);assert.equal(ownView.data.matches,undefined);assert.deepEqual(ownView.data.standings,round.standings);
    }
    assert.ok(round.standings.every(e=>e.played===2 && e.wins+e.draws+e.losses===2));
    assert.ok(Math.abs(round.standings.reduce((sum,e)=>sum+e.rating,0)-3000)<1e-8);
    const exported = await request(`/api/admin/scores/${roundId}/export`,admin);assert.equal(exported.status,200);assert.ok(exported.data.includes('student_python')&&exported.data.includes('student_cpp'));
    report.standings = round.standings.map(e=>({ username:e.username,elo:e.rating,played:e.played,wins:e.wins,draws:e.draws,losses:e.losses,points:e.points }));
    report.csvExportVerified = true; report.result = 'PASS';
    await fs.mkdir(path.join(__dirname,'../data'),{recursive:true});
    await fs.writeFile(path.join(__dirname,'../data/two-players-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally {
    await Promise.all([app.locals.submissions.close(), app.locals.scoring.close()]);
    server.closeIdleConnections(); await new Promise(resolve=>server.close(resolve)); db.close();
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('ott-two-players-'));
    await fs.rm(root,{recursive:true,force:true});
  }
});
