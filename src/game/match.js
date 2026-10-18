const { DEFAULT_RULES } = require('./engine');
const { createEngine } = require('./registry');
const { BotFault, InfrastructureError, LIMITS, parseResponse, makeRequest } = require('./protocol');
const { performance } = require('node:perf_hooks');

async function runMatch({ seed, rules = DEFAULT_RULES, bots, choose, limits = LIMITS, onTurn }) {
  const engine = createEngine({ seed, rules });
  const replay = { protocol_version: 1, engine_version: 2, seed, rule_set_id: engine.rules.id, rule_set_version: engine.rules.version,
    rules: engine.rules, bots, limits, initial: engine.snapshot(), turns: [], cpu_ms: [0, 0], result: null };
  const userdata = [null, null], start = performance.now();
  if (onTurn) await onTurn(replay);
  while (engine.snapshot().status === 'playing') {
    if (performance.now() - start > limits.matchWallMs) throw new InfrastructureError('match_wall_limit', 'Match wall deadline reached; no bot forfeit');
    const player = engine.snapshot().currentTurn;
    const request = makeRequest(engine, limits, userdata[player]);
    try {
      let deadlineTimer;
      let response;
      try {
        response = await Promise.race([choose(player, request), new Promise((resolve, reject) => {
          deadlineTimer = setTimeout(() => reject(new InfrastructureError('match_wall_limit', 'Match wall deadline reached; no bot forfeit')), Math.max(1, limits.matchWallMs - (performance.now() - start)));
        })]);
      } finally { clearTimeout(deadlineTimer); }
      if (!response || !Number.isFinite(response.cpu_ms) || response.cpu_ms < 0) throw new InfrastructureError('invalid_metrics');
      replay.cpu_ms[player] += response.cpu_ms;
      if (response.cpu_ms > limits.moveCpuMs) throw new BotFault('cpu_timeout');
      if (replay.cpu_ms[player] > limits.totalCpuMs) throw new BotFault('total_cpu_timeout');
      const output = parseResponse(response.stdout, request, limits);
      const move = Object.fromEntries(['fromRow','fromCol','toRow','toCol'].map(k => [k, output.move[k]]));
      if (!request.legal_moves.some(m => Object.keys(move).every(k => m[k] === move[k]))) throw new BotFault('illegal_move');
      engine.apply(move); userdata[player] = output.userdata ?? null;
      replay.turns.push({ request_id: request.request_id, player, move, userdata: userdata[player], cpu_ms: response.cpu_ms, stderr: response.stderr || '' });
    } catch (error) {
      if (!(error instanceof BotFault)) throw error;
      if (error.metrics && Number.isFinite(error.metrics.cpu_ms)) replay.cpu_ms[player] += error.metrics.cpu_ms;
      engine.finish(1 - player, error.code);
      replay.fault = { player, code: error.code, message: error.message, ...(error.metrics ? { cpu_ms: error.metrics.cpu_ms, stderr: error.metrics.stderr, exit_code: error.metrics.exit_code } : {}) };
    }
    if (onTurn) await onTurn(replay);
  }
  replay.result = engine.snapshot(); if (onTurn) await onTurn(replay); return replay;
}
function verifyReplay(replay) {
  const engine = createEngine({ seed: replay.seed, rules: replay.rules, legacyMovement: (replay.engine_version || 1) < 2 });
  if (JSON.stringify(engine.snapshot()) !== JSON.stringify(replay.initial)) throw new Error('Initial state mismatch');
  for (const turn of replay.turns) {
    if (turn.player !== engine.snapshot().currentTurn || turn.request_id !== `turn-${engine.snapshot().moveCount}`) throw new Error('Replay turn mismatch');
    engine.apply(turn.move);
  }
  if (replay.fault) {
    if (engine.snapshot().status !== 'playing' || replay.fault.player !== engine.snapshot().currentTurn) throw new Error('Replay fault mismatch');
    engine.finish(1 - replay.fault.player, replay.fault.code);
  }
  if (JSON.stringify(engine.snapshot()) !== JSON.stringify(replay.result)) throw new Error('Final state mismatch');
  return true;
}
module.exports = { runMatch, verifyReplay };
