const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pairings, elo, ScoringService, csvCell } = require('../src/scoring');
const { csvRows, importUsers } = require('../src/admin');
const { openDatabase } = require('../src/db');
const { runMatch, verifyReplay } = require('../src/game/match');
const { InfrastructureError, BotFault } = require('../src/game/protocol');
const config = { seed: 'rank-test', gamesPerBot: 2, gamesPerPair: 2 };
function setup(options = {}) {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO users(id,username,password_hash,role,locked,created_at) VALUES(1,'admin','unused','admin',0,0)").run();
  for (const id of [2, 3, 4]) {
    db.prepare("INSERT INTO users(id,username,password_hash,role,locked,created_at) VALUES(?,?,'unused','contestant',0,0)").run(id, 'team' + id);
    db.prepare("INSERT INTO bot_submissions(id,user_id,version,filename,entry,language,status,job_status,created_at,updated_at,image) VALUES (?,?,1,'main.py','main.py','python','Accepted','done',0,0,'image')").run('bot' + id, id);
    db.prepare('INSERT INTO active_bots VALUES(?,?)').run(id, 'bot' + id);
  }
  db.prepare('UPDATE users SET locked=1 WHERE id=4').run();
  return { db, service: new ScoringService(db, { folder: () => 'unused' }, options) };
}
const legalGame = row => runMatch({ seed: row.seed, bots: ['a', 'b'], choose: async (p, r) => ({ cpu_ms: 1, stdout: JSON.stringify({ request_id: r.request_id, move: r.legal_moves[0] }) }) });
async function drain(service) { const end = Date.now() + 10000; while (service.active || service.db.prepare("SELECT 1 FROM score_matches WHERE status='queued'").get()) { if (Date.now() > end) throw new Error('Queue timeout'); service.pump(); await new Promise(resolve => setTimeout(resolve, 10)); } }
test('seeded sparse pairing gives exact games per bot, no duplicate opponents and swapped sides', () => {
  for (const [n, opponents] of [[2,1],[5,2],[6,5],[1000,10]]) {
    const ids = Array.from({ length: n }, (_, i) => i), cfg = { seed: 'seed', gamesPerBot: opponents * 2, gamesPerPair: 2 }, plan = pairings(ids, cfg);
    assert.equal(plan.length, n * opponents); assert.deepEqual(plan, pairings(ids, cfg));
    const counts = new Map(), edges = new Set();
    for (let i = 0; i < plan.length; i += 2) { const a = plan[i], b = plan[i + 1]; assert.deepEqual(a.players, [...b.players].reverse()); assert.equal(a.seed, b.seed); assert.notEqual(...a.players); const edge = [...a.players].sort((x,y)=>x-y).join(':'); assert.ok(!edges.has(edge)); edges.add(edge); for (const id of a.players) counts.set(id, (counts.get(id) || 0) + 2); }
    assert.ok([...counts.values()].every(v => v === opponents * 2));
  }
  assert.notDeepEqual(pairings([1,2,3,4,5,6], config), pairings([1,2,3,4,5,6], { ...config, seed:'other' }));
  assert.throws(() => pairings([1,2,3], config), /chẵn/);
  assert.throws(() => pairings([1,2], { ...config, gamesPerPair: 3 }));
});
test('CSV parses quotes/BOM/CRLF and imports atomically without overwriting accounts', async () => {
  assert.deepEqual(csvRows('\uFEFFusername,password\r\n"team001","a,b""c"\r\n'), [['username','password'],['team001','a,b"c']]);
  assert.throws(() => csvRows('"unclosed')); assert.throws(() => csvRows('"a"oops,b'));
  const db = openDatabase(':memory:');
  try {
    await assert.rejects(importUsers(db, 'username,password\nvalid1,\ninvalid name,')); assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
    const imported = await importUsers(db, 'username,password\nteam001,\nteam002,MyPassword-2026'); assert.equal(imported.length, 2); assert.ok(imported[0].password.length >= 12);
    const user = db.prepare("SELECT * FROM users WHERE username='team001'").get(); assert.ok(await require('bcryptjs').compare(imported[0].password, user.password_hash)); assert.equal(user.role, 'contestant');
    await assert.rejects(importUsers(db, 'username,password\nteam003,\nTEAM001,')); assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
    assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  } finally { db.close(); }
});
test('Elo is zero-sum with expected equal-rating win and draw', () => { assert.deepEqual(elo(1500,1500,1),[1516,1484]); assert.deepEqual(elo(1500,1500,0.5),[1500,1500]); const [a,b] = elo(1800,1300,0); assert.ok(Math.abs(a+b-3100)<1e-9); });
test('round snapshots eligible bot versions, retries infrastructure, stores replay and scores exactly once', async () => {
  let calls = 0;
  const { db, service } = setup({ retryDelayMs: 0, play: async (row, entrants, onTurn) => { assert.equal(entrants[0].version, 1); if (++calls === 1) throw new InfrastructureError('docker_unavailable'); const replay = await legalGame(row); onTurn(replay); return replay; } });
  try {
    const id = service.create(1, config); assert.equal(service.detail(id).standings.length, 2);
    db.prepare("INSERT INTO bot_submissions(id,user_id,version,filename,status,job_status,created_at,updated_at) VALUES ('new',2,2,'main.py','Accepted','done',0,0)").run(); db.prepare("UPDATE active_bots SET submission_id='new' WHERE user_id=2").run();
    assert.throws(() => service.create(1,config), e=>e.status===409);
    service.start(); await drain(service);
    const round = service.detail(id); assert.equal(round.status, 'finished'); assert.ok(round.standings.every(e=>e.played===2 && e.version===1)); assert.equal(calls,3);
    for (const match of round.matches) assert.ok(verifyReplay(service.match(match.id).replay));
    service.score(id); assert.deepEqual(service.detail(id), round); assert.match(service.export(id), /username/);
  } finally { await service.close(); db.close(); }
});
test('three infrastructure failures block without points; explicit retry can finish', async () => {
  let failed = true; const { db, service } = setup({ retryDelayMs: 0, play: row => { if (failed) throw new InfrastructureError('docker_error'); return legalGame(row); } });
  try { const id=service.create(1,config); service.start(); await drain(service); let round=service.detail(id); assert.ok(round.counts.some(c=>c.status==='blocked' && c.count===2)); assert.ok(round.standings.every(e=>e.played===0 && e.rating===1500)); failed=false;service.retry(id);await drain(service);assert.equal(service.detail(id).status,'finished'); }
  finally { await service.close(); db.close(); }
});
test('bot runtime fault is a scored loss, expired worker lease recovers, live callback precedes result', async () => {
  let liveUpdates=0;
  const { db, service } = setup({ retryDelayMs: 0, play: row => runMatch({ seed: row.seed, bots:['a','b'], choose: async () => { throw new BotFault('illegal_move'); }, onTurn: replay => { liveUpdates++; if (liveUpdates===1) assert.equal(replay.result,null); } }) });
  try { const id=service.create(1,config);db.prepare("UPDATE score_matches SET status='running',worker_id='dead',lease_until=0,attempts=1 WHERE sequence=0").run();service.start();await drain(service);const round=service.detail(id);assert.equal(round.status,'finished');assert.ok(round.standings.every(e=>e.wins===1&&e.losses===1));assert.equal(round.matches.find(m=>m.sequence===0).attempts,2); }
  finally { await service.close();db.close(); }
});
