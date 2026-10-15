const crypto = require('node:crypto');
const DEFAULT_RULES = require('../../rules/default.json');
const clone = value => structuredClone(value);
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function validateRules(input) {
  const r = clone(input);
  const fail = () => { throw new Error('Invalid RuleSet'); };
  if (!r || r.engine !== 'rps-grid-v1' || typeof r.id !== 'string' || !r.id || !Number.isInteger(r.version) || r.version < 1) fail();
  if (!Number.isInteger(r.boardSize) || r.boardSize < 2 || r.boardSize > 32) fail();
  const inside = (row, col) => Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < r.boardSize && col < r.boardSize;
  if (!Array.isArray(r.homes) || r.homes.length !== 2 || r.homes.some(p => !p || !inside(p.row, p.col)) || (r.homes[0].row === r.homes[1].row && r.homes[0].col === r.homes[1].col)) fail();
  if (!Array.isArray(r.pieceTypes) || !r.pieceTypes.length || r.pieceTypes.length > 128 || r.pieceTypes.some(t => typeof t !== 'string' || !/^[A-Z0-9]{1,8}$/.test(t))) fail();
  if (!r.beats || typeof r.beats !== 'object' || r.pieceTypes.some(t => typeof r.beats[t] !== 'string')) fail();
  if (r.randomExtraPiece !== undefined && typeof r.randomExtraPiece !== 'boolean') fail();
  if (r.randomExtraPiece && (r.pieceTypes.length !== 10 || ['R','P','S'].some(t => !r.pieceTypes.includes(t)) || r.pieceTypes.some(t => !['R','P','S'].includes(t)))) fail();
  if (!Array.isArray(r.directions) || !r.directions.length || r.directions.length > 8 || r.directions.some(d => !Array.isArray(d) || d.length !== 2 || !d.every(n => Number.isInteger(n) && Math.abs(n) <= 1) || !d.some(Boolean))) fail();
  if (!Array.isArray(r.startingPositions) || r.startingPositions.length !== 2) fail();
  const occupied = new Set();
  for (const positions of r.startingPositions) {
    if (!Array.isArray(positions) || positions.length !== r.pieceTypes.length) fail();
    for (const p of positions) {
      if (!Array.isArray(p) || p.length !== 2 || !inside(...p) || occupied.has(p.join(',')) || r.homes.some(h => h.row === p[0] && h.col === p[1])) fail();
      occupied.add(p.join(','));
    }
  }
  if (!Number.isInteger(r.maxMoves) || r.maxMoves < 1 || r.maxMoves > 5000 || !Number.isInteger(r.repetitionLimit) || r.repetitionLimit < 2 || r.repetitionLimit > 10 || r.noLegalMoves !== 'loss') fail();
  return freeze(r);
}
function seededRandom(seed) {
  let value = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => { value = (value + 0x6D2B79F5) >>> 0; let t = Math.imul(value ^ value >>> 15, 1 | value); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(values, random) { const out = clone(values); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }

class GameEngine {
  constructor({ seed = '0', rules = DEFAULT_RULES } = {}) {
    if (typeof seed !== 'string' || seed.length > 128) throw new Error('Seed must be a string of at most 128 characters');
    this.rules = validateRules(rules); this.seed = seed;
    const random = seededRandom(seed);
    const pool = this.rules.randomExtraPiece ? ['R','R','R','P','P','P','S','S','S', ['R','P','S'][Math.floor(random() * 3)]] : this.rules.pieceTypes;
    const types = shuffle(pool, random);
    const board = Array.from({ length: this.rules.boardSize }, () => Array(this.rules.boardSize).fill(null));
    for (const player of [0, 1]) shuffle(this.rules.startingPositions[player], random).forEach(([row, col], i) => { board[row][col] = { player, type: types[i] }; });
    this._state = { board, currentTurn: 0, moveCount: 0, status: 'playing', winner: null, winReason: null, lastMove: null };
    this.seen = new Map([[this.positionKey(), 1]]);
    this.checkTerminal();
  }
  snapshot() { return clone(this._state); }
  positionKey() { return JSON.stringify([this._state.board, this._state.currentTurn]); }
  legalMoves(player = this._state.currentTurn) {
    const { board } = this._state, moves = [], n = this.rules.boardSize;
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      const piece = board[row][col]; if (!piece || piece.player !== player) continue;
      for (const [dr, dc] of this.rules.directions) {
        const nr = row + dr, nc = col + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
        const target = board[nr][nc];
        if (!target || (target.player !== player && this.rules.beats[piece.type] === target.type)) moves.push({ fromRow: row, fromCol: col, toRow: nr, toCol: nc });
      }
    }
    return moves;
  }
  finish(winner, reason) { this._state.status = 'finished'; this._state.winner = winner; this._state.winReason = reason; }
  checkTerminal() {
    const counts = [0, 0];
    for (const row of this._state.board) for (const piece of row) if (piece) counts[piece.player]++;
    for (const p of [0, 1]) if (!counts[p]) { this.finish(1 - p, 'eliminated'); return; }
    for (const p of [0, 1]) { const h = this.rules.homes[1 - p]; if (this._state.board[h.row][h.col]?.player === p) { this.finish(p, 'reached_home'); return; } }
    if (!this.legalMoves().length) { this.finish(1 - this._state.currentTurn, 'no_legal_moves'); return; }
    if ((this.seen.get(this.positionKey()) || 0) >= this.rules.repetitionLimit) { this.finish(null, 'repetition'); return; }
    if (this._state.moveCount >= this.rules.maxMoves) this.finish(null, 'move_limit');
  }
  apply(move) {
    if (this._state.status !== 'playing') throw new Error('Game is finished');
    const fields = ['fromRow','fromCol','toRow','toCol'];
    if (!move || fields.some(k => !Number.isInteger(move[k])) || !this.legalMoves().some(m => fields.every(k => m[k] === move[k]))) throw new Error('Illegal move');
    const { fromRow: fr, fromCol: fc, toRow: tr, toCol: tc } = move;
    const captured = !!this._state.board[tr][tc], playerIndex = this._state.currentTurn;
    this._state.board[tr][tc] = this._state.board[fr][fc]; this._state.board[fr][fc] = null;
    this._state.currentTurn = 1 - playerIndex; this._state.moveCount++;
    this._state.lastMove = { playerIndex, fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, captured };
    const key = this.positionKey(); this.seen.set(key, (this.seen.get(key) || 0) + 1);
    this.checkTerminal(); return this.snapshot();
  }
}
module.exports = { GameEngine, DEFAULT_RULES, validateRules };
