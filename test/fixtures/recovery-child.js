// Coordinator process for test/recovery.integration.js: node recovery-child.js <dbFile> <workDir> <moveDelayMs>
// Runs a 12-team, 3-round Swiss with deterministic slow fake games, resuming whatever the database already holds; prints DONE <json> at the end.
const crypto = require('node:crypto');
const path = require('node:path');
const { openDatabase } = require('../../src/db');
const { createApp } = require('../../src/app');
const { DEFAULT_RULES } = require('../../src/game/engine');
const { runMatch } = require('../../src/game/match');
const { BotFault } = require('../../src/game/protocol');

const [dbFile, work, delay] = [process.argv[2], process.argv[3], Number(process.argv[4] || 20)];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// The loser depends only on the game seed, so results do not depend on timing or on which process played the game.
const play = async (game, { rules, onTurn }) => runMatch({ seed: game.seed, rules, bots: [{ id: 'a' }, { id: 'b' }], onTurn, choose: async (player, request) => {
  await sleep(delay);
  const loser = crypto.createHash('sha256').update(game.seed).digest()[0] % 2;
  if (player === loser && request.state.moveCount >= 4) throw new BotFault('bot_crash');
  return { cpu_ms: 1, stdout: JSON.stringify({ request_id: request.request_id, move: request.legal_moves[0] }) };
} });

(async () => {
  const db = openDatabase(dbFile);
  const app = await createApp({ db, github: null, turnstile: null, swissOptions: { play, retryDelayMs: 0 },
    submissionOptions: { storageRoot: path.join(work, 'subs') }, publicationOptions: { siteDir: path.join(work, 'site'), log: () => {} } });
  const { tournaments, swiss, ruleSets } = app.locals;
  let id = db.prepare('SELECT id FROM tournaments LIMIT 1').get()?.id;
  if (!id) {
    db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (1,'admin','unused','admin',0)").run();
    for (let u = 2; u <= 13; u++) db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'unused','contestant',0)").run(u, `team${u}`);
    const law = ruleSets.save({ userId: 1, name: 'Hồi phục', rules: { ...DEFAULT_RULES, maxMoves: 12 } });
    let t = tournaments.create(1, { name: 'Mất điện', ruleSetId: law.id, ruleSetVersion: law.version, config: { swissRounds: 3, topN: 4 } });
    t = tournaments.replaceEntrants(t.id, 1, { expectedRevision: t.revision, userIds: Array.from({ length: 12 }, (_, i) => i + 2) });
    t = tournaments.stages.open(t.id, 1, { expectedRevision: t.revision, closesAt: Date.now() + 300 });
    for (let u = 2; u <= 13; u++) db.prepare(`INSERT INTO bot_submissions(id,user_id,version,filename,entry,language,status,job_status,created_at,updated_at,stage_id,source_hash,image) VALUES (?,?,1,'main.py','main.py','python','Accepted','done',1,1,?,'h','i')`).run(crypto.randomUUID(), u, t.stages[0].id);
    await sleep(400);
    t = tournaments.stages.lock(t.id, 1, { expectedRevision: t.revision, reason: 'test' });
    swiss.create(t.id, 1, { expectedRevision: t.revision, seed: 'power-loss' });
    id = t.id;
    console.log('READY');
  }
  swiss.start();
  for (;;) {
    const state = swiss.get(id);
    if (state.rounds.length && state.rounds.every(round => round.status === 'finished')) {
      if (state.rounds.length < 3) swiss.next(id, 1, { expectedRevision: state.revision });
      else break;
    }
    await sleep(50);
  }
  const standings = swiss.get(id).standings.map(e => [e.userId, e.points, e.buchholz, e.gamePoints, e.wins, e.draws, e.losses]);
  const games = db.prepare("SELECT g.seed,g.status,json_extract(g.replay_json,'$.result.winner') winner FROM swiss_games g ORDER BY g.seed").all().map(g => [g.seed, g.status, g.winner]);
  console.log('DONE ' + JSON.stringify({ standings, games }));
  await swiss.close(); db.close();
})().catch(error => { console.error(error); process.exit(1); });
