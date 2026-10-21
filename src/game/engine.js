const crypto = require('node:crypto');
const DEFAULT_RULES = require('../../rules/default.json');
const Movement = require('./movement');
const Tiles = require('./tiles');
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
  if(r.symmetricArmies!==undefined&&typeof r.symmetricArmies!=='boolean')fail();
  if(r.symmetricArmies&&r.playerPieceTypes){
    const counts=pool=>JSON.stringify([...new Set(allTypes)].sort().map(t=>pool.filter(p=>p===t).length));
    if(counts(r.playerPieceTypes[0])!==counts(r.playerPieceTypes[1]))fail('Hai bên phải có cùng số lượng từng loại quân.');
  }
  if(r.movementByType!==undefined){
    if(!r.movementByType||typeof r.movementByType!=='object'||Array.isArray(r.movementByType))fail('Cấu hình di chuyển không hợp lệ.');
    for(const [type,config]of Object.entries(r.movementByType)){if(!allTypes.includes(type))fail('Loại quân di chuyển không có trong bộ luật.');Movement.validate(config);}
  }
  if(r.powerUps!==undefined&&typeof r.powerUps!=='boolean')fail('Tùy chọn power-up phải là có/không.');
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
  if(r.powerUps&&rows*cols-unavailable.size-occupied.size-2<1)fail('Cần ít nhất một ô trống để đặt power-up.');
  Tiles.validateTiles(r, { rows, cols, inside, unavailable, homes: r.homes, starts: occupied });
  return freeze(r);
}
function seededRandom(seed) {
  let value = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => { value = (value + 0x6D2B79F5) >>> 0; let t = Math.imul(value ^ value >>> 15, 1 | value); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(values, random) { const out = clone(values); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }

class GameEngine {
  constructor({ seed = '0', rules = DEFAULT_RULES, legacyMovement = false } = {}) {
    if (typeof seed !== 'string' || seed.length > 128) throw new Error('Seed must be a string of at most 128 characters');
    this.rules = validateRules(rules); this.seed = seed; this.legacyMovement=legacyMovement;
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
    if(this.rules.powerUps){
      const free=[];
      for(let row=0;row<board.length;row++)for(let col=0;col<board[0].length;col++)if(!board[row][col]&&!this.unavailable.has(`${row},${col}`)&&!this.rules.homes.some(h=>h.row===row&&h.col===col))free.push([row,col]);
      const count=1+Math.floor(random()*Math.min(3,free.length));
      this._state.powerUps=shuffle(free,random).slice(0,count);
    }
    // Only RuleSets with tileTypes get state.tiles, so older rules keep identical snapshots and replays.
    if (this.rules.tileTypes) {
      this._state.tiles = Tiles.placeTiles(this.rules, board.length, board[0].length, random, shuffle);
      for (const tile of this._state.tiles) if (!Tiles.tileType(this.rules, tile.type).passable) this.unavailable.add(`${tile.row},${tile.col}`);
    }
    this.lastChanges = [];
    this.seen = new Map([[this.positionKey(), 1]]);
    this.checkTerminal();
  }
  snapshot() { return clone(this._state); }
  positionKey() {
    const key = this._state.powerUps ? [this._state.board, this._state.currentTurn, this._state.powerUps] : [this._state.board, this._state.currentTurn];
    if (this._state.tiles) key.push(this._state.tiles);
    return JSON.stringify(key);
  }
  legalMoves(player = this._state.currentTurn) {
    const { board } = this._state, moves = [], rows = board.length, cols = board[0].length;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const piece = board[row][col]; if (!piece || piece.player !== player) continue;
      const config=this.rules.movementByType?.[piece.type],movement=Movement.resolve(config,this.rules.directions);
      for (const [vr, vc] of movement.directions) {
        const dr=movement.relative&&player===1?-vr:vr,dc=movement.relative&&player===1?-vc:vc;
        for(let step=1;step<=movement.maxSteps;step++){
          const nr=row+dr*step,nc=col+dc*step;
          if(nr<0||nc<0||nr>=rows||nc>=cols||this.unavailable.has(`${nr},${nc}`))break;
          if(!this.legacyMovement){
            const steps=Math.max(Math.abs(dr),Math.abs(dc));let obstructed=false;
            for(let k=1;k<steps;k++){
              const rr=row+dr*(step-1)+Math.trunc(dr*k/steps),cc=col+dc*(step-1)+Math.trunc(dc*k/steps);
              if(board[rr][cc]||this.unavailable.has(`${rr},${cc}`)){obstructed=true;break;}
            }
            if(obstructed)break;
          }else if(!movement.jump){
            const gcd=(a,b)=>b?gcd(b,a%b):a,segments=gcd(Math.abs(dr),Math.abs(dc));let obstructed=false;
            for(let k=1;k<segments;k++){const rr=row+dr*(step-1)+dr*k/segments,cc=col+dc*(step-1)+dc*k/segments;if(board[rr][cc]||this.unavailable.has(`${rr},${cc}`)){obstructed=true;break;}}
            if(obstructed)break;
          }
          const target=board[nr][nc],pawn=config?.kind==='pawn';
          if(!target){if(!pawn||dc===0)moves.push({fromRow:row,fromCol:col,toRow:nr,toCol:nc});}
          else{
            if(target.player!==player&&(!pawn||dc!==0)&&(this.rules.beats[piece.type]===target.type||(piece.powered&&piece.type===target.type)||Tiles.effect(piece.effect)?.canCapture?.(piece,target)))moves.push({fromRow:row,fromCol:col,toRow:nr,toCol:nc});
            break;
          }
        }
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
    if (this._state.moveCount >= this.rules.maxMoves) {
      if (this.rules.onMoveLimit !== 'material') { this.finish(null, 'move_limit'); return; }
      this.finish(counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1, 'material');
    }
  }
  // Entering a tile: legacy powerUps set powered; an effect tile gives its effect (replacing any other) and disappears.
  pickUp(row, col, set, changes) {
    const board = this._state.board;
    if (this._state.powerUps?.some(p => p[0] === row && p[1] === col)) {
      set(row, col, { ...board[row][col], powered: true });
      this._state.powerUps = this._state.powerUps.filter(p => p[0] !== row || p[1] !== col);
      changes.push({ row, col, tile: null });
    }
    const index = this._state.tiles?.findIndex(t => t.row === row && t.col === col) ?? -1;
    const effect = index >= 0 && Tiles.tileType(this.rules, this._state.tiles[index].type).effect;
    if (effect) {
      set(row, col, { ...board[row][col], effect });
      this._state.tiles.splice(index, 1);
      changes.push({ row, col, tile: null });
    }
  }
  // Dash: after a capture, one more step in the unit direction of the move (sign of each axis). The step may capture only by normal RPS rules
  // and never enters a home, a wall or the board edge; a shielded target breaks the shield and the dasher stays.
  dash(fr, fc, tr, tc, set, changes, shieldBreaks) {
    const board = this._state.board, nr = tr + Math.sign(tr - fr), nc = tc + Math.sign(tc - fc), piece = board[tr][tc];
    if (nr < 0 || nc < 0 || nr >= board.length || nc >= board[0].length || this.unavailable.has(`${nr},${nc}`) || this.rules.homes.some(h => h.row === nr && h.col === nc)) return null;
    const occupant = board[nr][nc];
    if (occupant && (occupant.player === piece.player || this.rules.beats[piece.type] !== occupant.type)) return null;
    if (occupant && shieldBreaks(nr, nc)) return { toRow: tr, toCol: tc, blocked: true };
    set(tr, tc, null); set(nr, nc, piece); this.pickUp(nr, nc, set, changes);
    return { toRow: nr, toCol: nc, captured: !!occupant };
  }
  apply(move) {
    if (this._state.status !== 'playing') throw new Error('Game is finished');
    const fields = ['fromRow','fromCol','toRow','toCol'];
    if (!move || fields.some(k => !Number.isInteger(move[k])) || !this.legalMoves().some(m => fields.every(k => m[k] === move[k]))) throw new Error('Illegal move');
    const { fromRow: fr, fromCol: fc, toRow: tr, toCol: tc } = move;
    const board = this._state.board, playerIndex = this._state.currentTurn, mover = board[fr][fc];
    // Every cell write is recorded so replays (and the UI) can apply moves without knowing the rules.
    const changes = this.lastChanges = [];
    const set = (row, col, piece) => { board[row][col] = piece; changes.push({ row, col, piece: piece && clone(piece) }); };
    const shieldBreaks = (row, col) => {
      if (!Tiles.effect(board[row][col]?.effect)?.blocksCapture) return false;
      const { effect, ...broken } = board[row][col]; set(row, col, broken); return true;
    };
    let captured = !!board[tr][tc], blocked = false, bonus = null;
    if (captured && shieldBreaks(tr, tc)) { captured = false; blocked = true; }
    else {
      set(fr, fc, null); set(tr, tc, mover); this.pickUp(tr, tc, set, changes);
      if (captured && Tiles.effect(mover.effect)?.dash) bonus = this.dash(fr, fc, tr, tc, set, changes, shieldBreaks);
    }
    this._state.currentTurn = 1 - playerIndex; this._state.moveCount++;
    this._state.lastMove = { playerIndex, fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, captured, ...(blocked ? { blocked: true } : {}), ...(bonus ? { bonus_step: bonus } : {}) };
    const key = this.positionKey(); this.seen.set(key, (this.seen.get(key) || 0) + 1);
    this.checkTerminal(); return this.snapshot();
  }
}
module.exports = { GameEngine, DEFAULT_RULES, validateRules };
