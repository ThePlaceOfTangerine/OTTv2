class BotFault extends Error { constructor(code, message = code) { super(message); this.name = 'BotFault'; this.code = code; } }
class InfrastructureError extends Error { constructor(code, message = code) { super(message); this.name = 'InfrastructureError'; this.code = code; } }
const LIMITS = Object.freeze({ moveCpuMs: 500, totalCpuMs: 30000, moveWallMs: 3000, matchWallMs: 180000, memoryMb: 256, outputBytes: 65536, userdataBytes: 16384 });
function parseResponse(raw, request, limits = LIMITS) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > limits.outputBytes) throw new BotFault('output_limit');
  // Exactly one line; an optional final newline is allowed.
  const line = raw.endsWith('\n') ? raw.slice(0, -1).replace(/\r$/, '') : raw;
  if (line.includes('\n')) throw new BotFault('invalid_output', 'Expected exactly one JSON line');
  let result; try { result = JSON.parse(line); } catch { throw new BotFault('invalid_output', 'Invalid JSON'); }
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.request_id !== request.request_id || !result.move || ['fromRow','fromCol','toRow','toCol'].some(k => !Number.isInteger(result.move[k]))) throw new BotFault('invalid_output', 'Invalid request_id or move');
  if (Buffer.byteLength(JSON.stringify(result.userdata ?? null)) > limits.userdataBytes) throw new BotFault('userdata_limit');
  return result;
}
function makeRequest(engine, limits, userdata = null) {
  const state = engine.snapshot();
  return { protocol_version: 1, request_id: `turn-${state.moveCount}`, player_index: state.currentTurn,
    seed: engine.seed, rules: engine.rules, state, legal_moves: engine.legalMoves(), limits, userdata };
}
module.exports = { BotFault, InfrastructureError, LIMITS, parseResponse, makeRequest };
