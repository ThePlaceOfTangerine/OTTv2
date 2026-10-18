const crypto = require('node:crypto');
const DEFAULT_RULES = require('../../rules/default.json');
const clone = value => structuredClone(value);
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function validateRules(input) {
  const r = clone(input);
  const fail = (message = 'Invalid RuleSet') => { throw new Error(message); };
  if (!r || r.engine !== 'rps-grid-v1' || typeof r.id !== 'string' || !r.id || !Number.isInteger(r.version) || r.version < 1) fail();
  if (!Number.isInteger(r.boardSize) || r.boardSize < 2 || r.boardSize > 32) fail();
  const rows = r.boardRows ?? r.boardSize, cols = r.boardCols ?? r.boardSize;
  if (![rows,cols].every(n => Number.isInteger(n) && n >= 2 && n <= 32)) fail('Số hàng/cột phải từ 2 đến 32.');
  const inside = (row, col) => Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < rows && col < cols;
  const unavailable = new Set();
  for (const key of ['blockedCells','voidCells']) {
    if (r[key] !== undefined && (!Array.isArray(r[key]) || r[key].length > rows * cols)) fail('Danh sách ô chặn/ô bỏ không hợp lệ.');
    for (const p of r[key] || []) {
      if (!Array.isArray(p) || p.length !== 2 || !inside(...p) || unavailable.has(p.join(','))) fail('Ô chặn/ô bỏ nằm ngoài bàn hoặc bị trùng.');
      unavailable.add(p.join(','));
    }
  }
  if (!Array.isArray(r.homes) || r.homes.length !== 2 || r.homes.some(p => !p || !inside(p.row, p.col)) || (r.homes[0].row === r.homes[1].row && r.homes[0].col === r.homes[1].col)) fail();
  if (r.homes.some(h => unavailable.has(`${h.row},${h.col}`))) fail('Nhà không được đặt trên ô chặn hoặc ô bỏ.');
  const validPool = pool => Array.isArray(pool) && pool.length > 0 && pool.length <= 128 && pool.every(t => typeof t === 'string' && /^[A-Z0-9]{1,8}$/.test(t));
  if (!validPool(r.pieceTypes)) fail();
  if (r.playerPieceTypes !== undefined && (!Array.isArray(r.playerPieceTypes) || r.playerPieceTypes.length !== 2 || !r.playerPieceTypes.every(validPool))) fail('Mỗi bên cần từ 1 đến 128 quân.');
  const allTypes = r.playerPieceTypes ? r.playerPieceTypes.flat() : r.pieceTypes;
  if (!r.beats || typeof r.beats !== 'object' || allTypes.some(t => typeof r.beats[t] !== 'string')) fail();
  if (r.randomExtraPiece !== undefined && typeof r.randomExtraPiece !== 'boolean') fail();
  if (r.randomExtraPiece && (r.pieceTypes.length !== 10 || ['R','P','S'].some(t => !r.pieceTypes.includes(t)) || r.pieceTypes.some(t => !['R','P','S'].includes(t)))) fail();
  if (r.randomExtraPiece && r.playerPieceTypes) fail('Tắt chia quân ngẫu nhiên khi đặt số quân riêng cho từng bên.');
  if (!Array.isArray(r.directions) || !r.directions.length || r.directions.length > 8 || r.directions.some(d => !Array.isArray(d) || d.length !== 2 || !d.every(n => Number.isInteger(n) && Math.abs(n) <= 1) || !d.some(Boolean))) fail();
  if (!Array.isArray(r.startingPositions) || r.startingPositions.length !== 2) fail();
  const occupied = new Set();
  for (const [player, positions] of r.startingPositions.entries()) {
    if (!Array.isArray(positions) || positions.length !== (r.playerPieceTypes?.[player] || r.pieceTypes).length) fail(`Số vị trí xuất phát bên ${player} phải bằng số quân của bên đó.`);
    for (const p of positions) {
      if (!Array.isArray(p) || p.length !== 2 || !inside(...p) || occupied.has(p.join(',')) || unavailable.has(p.join(',')) || r.homes.some(h => h.row === p[0] && h.col === p[1])) fail('Quân phải nằm trong bàn, không trùng quân khác, nhà hoặc ô chặn/ô bỏ.');
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
    const board = Array.from({ length: this.rules.boardRows ?? this.rules.boardSize }, () => Array(this.rules.boardCols ?? this.rules.boardSize).fill(null));
    for (const player of [0, 1]) {
      const playerTypes = this.rules.playerPieceTypes ? shuffle(this.rules.playerPieceTypes[player], random) : types;
      shuffle(this.rules.startingPositions[player], random).forEach(([row, col], i) => { board[row][col] = { player, type: playerTypes[i] }; });
    }
    this.unavailable = new Set([...(this.rules.blockedCells || []), ...(this.rules.voidCells || [])].map(p => p.join(',')));
    this._state = { board, currentTurn: 0, moveCount: 0, status: 'playing', winner: null, winReason: null, lastMove: null };
    this.seen = new Map([[this.positionKey(), 1]]);
    this.checkTerminal();
  }
  snapshot() { return clone(this._state); }
  positionKey() { return JSON.stringify([this._state.board, this._state.currentTurn]); }
  legalMoves(player = this._state.currentTurn) {
    const { board } = this._state, moves = [], rows = board.length, cols = board[0].length;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const piece = board[row][col]; if (!piece || piece.player !== player) continue;
      for (const [dr, dc] of this.rules.directions) {
        const nr = row + dr, nc = col + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || this.unavailable.has(`${nr},${nc}`)) continue;
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
