const { runMatch } = require('../game/match');
const { createEngine } = require('../game/registry');
const { LIMITS } = require('../game/protocol');

// One pinned game between two locked bots; used by the local runners and by remote grader agents.
async function playGame(job, { manager, artifactDir, onTurn }) {
  const sessions = [];
  try {
    manager.imageId = job.entrants[0].image; await manager.check();
    for (const e of job.entrants) sessions.push(await manager.start({ directory: await artifactDir(e), language: e.language, entry: e.entry, image: e.image }, LIMITS));
    return await runMatch({ seed: job.seed, rules: job.rules, onTurn, bots: job.entrants.map(e => ({ id: e.username, submission_id: e.submissionId, version: e.version, source_hash: e.sourceHash, image: e.image })),
      choose: (player, request) => sessions[player].move(request) });
  } finally {
    const closed = await Promise.allSettled(sessions.map(session => session.close()));
    const failed = closed.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
  }
}

// A remote replay must be for exactly the job that was leased: same seed, rules and bots.
function checkReplay(job, replay) {
  if (!replay || typeof replay !== 'object' || replay.seed !== job.seed) throw new Error('Replay không khớp seed của việc được giao.');
  if (JSON.stringify(replay.rules) !== JSON.stringify(createEngine({ seed: job.seed, rules: job.rules }).rules)) throw new Error('Replay không khớp bộ luật của việc được giao.');
  if (!Array.isArray(replay.bots) || job.entrants.some((e, p) => replay.bots[p]?.submission_id !== e.submissionId)) throw new Error('Replay không khớp bot của việc được giao.');
}
module.exports = { playGame, checkReplay };
