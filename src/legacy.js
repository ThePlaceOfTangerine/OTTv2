const { WebSocketServer, WebSocket } = require('ws');

// ─── Config ────────────────────────────────────────────────────────────────

const BOARD_SIZE = 9;
const PIECES_PER_PLAYER = 10;
const HOMES = { 0: { row: 0, col: 8 }, 1: { row: 8, col: 0 } };
// RPS: what each type beats
const BEATS = { R: 'S', S: 'P', P: 'R' };


function attachLegacy(httpServer) {
// ─── State ─────────────────────────────────────────────────────────────────
const rooms = new Map();      // roomId -> room
const players = new Map();    // ws -> { roomId, playerIndex, name }
const spectators = new Set(); // ws

// ─── Game Logic ────────────────────────────────────────────────────────────
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getStartingPositions(playerIndex) {
  if (playerIndex === 1) {
    // Player 1 = đỏ, home góc dưới-trái (row8, col0)
    // Dải 1 (3 quân): 1C, 2B, 3A  →  (8,2),(7,1),(6,0)
    // Dải 2 (4 quân): 1D, 2C, 3B, 4A  →  (8,3),(7,2),(6,1),(5,0)
    // Dải 3 (3 quân): 2D, 3C, 4B  →  (7,3),(6,2),(5,1)
    const fixed = [
      {row:8,col:2},{row:7,col:1},{row:6,col:0},
      {row:8,col:3},{row:7,col:2},{row:6,col:1},{row:5,col:0},
      {row:7,col:3},{row:6,col:2},{row:5,col:1},
    ];
    return shuffleArray(fixed);
  } else {
    // Player 0 = xanh, home góc trên-phải (row0, col8)
    // Đối xứng với quân đỏ (lật 180°)
    // Dải 1 (3 quân): 9G, 8H, 7I  →  (0,6),(1,7),(2,8)
    // Dải 2 (4 quân): 9F, 8G, 7H, 6I  →  (0,5),(1,6),(2,7),(3,8)
    // Dải 3 (3 quân): 8F, 7G, 6H  →  (1,5),(2,6),(3,7)
    const fixed = [
      {row:0,col:6},{row:1,col:7},{row:2,col:8},
      {row:0,col:5},{row:1,col:6},{row:2,col:7},{row:3,col:8},
      {row:1,col:5},{row:2,col:6},{row:3,col:7},
    ];
    return shuffleArray(fixed);
  }
}

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function createGame(roomId, name0, name1) {
  const board = createBoard();
  // Piece types: distribute 3 R, 3 P, 4 S per player
  const types = shuffleArray(['R','R','R','P','P','P','S','S','S', ['R','P','S'][Math.floor(Math.random() * 3)]]);

  [0, 1].forEach(pi => {
    const positions = getStartingPositions(pi);
    positions.forEach((pos, i) => {
      board[pos.row][pos.col] = { player: pi, type: types[i] };
    });
  });

  return {
    roomId,
    board,
    currentTurn: 0,
    players: [
      { name: name0, piecesLeft: PIECES_PER_PLAYER },
      { name: name1, piecesLeft: PIECES_PER_PLAYER },
    ],
    status: 'playing',
    winner: null,
    winReason: null,
    moveCount: 0,
    lastMove: null,
  };
}

function isValidMove(game, playerIndex, fromRow, fromCol, toRow, toCol) {
  if (![fromRow, fromCol, toRow, toCol].every(Number.isInteger)) return { valid: false, reason: 'Tọa độ nước đi phải là số nguyên.' };
  // Bounds
  if (fromRow < 0 || fromRow >= BOARD_SIZE || fromCol < 0 || fromCol >= BOARD_SIZE) return { valid: false, reason: 'Ô được chọn nằm ngoài bàn cờ.' };
  if (toRow   < 0 || toRow   >= BOARD_SIZE || toCol   < 0 || toCol   >= BOARD_SIZE) return { valid: false, reason: 'Ô được chọn nằm ngoài bàn cờ.' };
  // Must move exactly 1 step (8 directions)
  const dr = Math.abs(toRow - fromRow), dc = Math.abs(toCol - fromCol);
  if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) return { valid: false, reason: 'Mỗi nước phải di chuyển đúng một ô theo chiều ngang, dọc hoặc chéo.' };
  // Source must have the player's piece
  const src = game.board[fromRow][fromCol];
  if (!src || src.player !== playerIndex) return { valid: false, reason: 'Ô xuất phát không có quân của bạn.' };
  // Target checks
  const tgt = game.board[toRow][toCol];
  if (tgt) {
    if (tgt.player === playerIndex) return { valid: false, reason: 'Không thể đi vào ô có quân cùng bên.' };
    // Only winning captures allowed (no suicide, no draws)
    if (BEATS[src.type] !== tgt.type) return { valid: false, reason: 'Quân đang đi không ăn được quân ở ô đích.' };
  }
  return { valid: true };
}

function applyMove(game, playerIndex, fromRow, fromCol, toRow, toCol) {
  const src = game.board[fromRow][fromCol];
  const tgt = game.board[toRow][toCol];

  let captured = false;
  if (tgt) {
    // winning capture (isValidMove already ensures this)
    game.players[1 - playerIndex].piecesLeft--;
    captured = true;
  }

  game.board[toRow][toCol] = src;
  game.board[fromRow][fromCol] = null;
  game.currentTurn = 1 - playerIndex;
  game.moveCount++;
  game.lastMove = { playerIndex, fromRow, fromCol, toRow, toCol, captured };
}

function checkWin(game) {
  // Check elimination
  for (const pi of [0, 1]) {
    if (game.players[pi].piecesLeft === 0) {
      game.status = 'finished';
      game.winner = 1 - pi;
      game.winReason = 'eliminated';
      return true;
    }
  }
  // Check reach home
  const home0 = HOMES[0]; // Player 0's home (row0, col8)
  const home1 = HOMES[1]; // Player 1's home (row8, col0)

  const pieceAtHome0 = game.board[home0.row][home0.col];
  const pieceAtHome1 = game.board[home1.row][home1.col];

  // Player 1 wins by reaching Player 0's home
  if (pieceAtHome0 && pieceAtHome0.player === 1) {
    game.status = 'finished'; game.winner = 1; game.winReason = 'reached_home'; return true;
  }
  // Player 0 wins by reaching Player 1's home
  if (pieceAtHome1 && pieceAtHome1.player === 0) {
    game.status = 'finished'; game.winner = 0; game.winReason = 'reached_home'; return true;
  }
  return false;
}

// ─── Broadcast helpers ─────────────────────────────────────────────────────
function sanitizeGameState(game) {
  return {
    roomId: game.roomId,
    board: game.board,
    currentTurn: game.currentTurn,
    players: game.players.map(p => ({ name: p.name, piecesLeft: p.piecesLeft })),
    status: game.status,
    winner: game.winner,
    winReason: game.winReason,
    moveCount: game.moveCount,
    lastMove: game.lastMove,
  };
}

function getActiveRooms() {
  const active = [];
  for (const [roomId, room] of rooms) {
    if (room.players.length === 1 && !room.game) {
      active.push({ roomId, creatorName: room.players[0].name, status: 'waiting' });
    }
  }
  return active;
}

function getSpectatorGames() {
  const games = [];
  for (const [, room] of rooms) {
    if (room.game) games.push(sanitizeGameState(room.game));
  }
  return games.slice(0, 4);
}

function broadcastLobbyState() {
  const rooms_list = getActiveRooms();
  const games = getSpectatorGames();
  const activeCount  = games.filter(g => g.status === 'playing').length;
  const waitingCount = rooms_list.length;
  // Send to all spectators
  for (const ws of spectators) {
    send(ws, { type: 'lobby_update', rooms: rooms_list, activeCount, waitingCount });
  }
}

function broadcastSpectatorUpdate() {
  const games = getSpectatorGames();
  const activeCount  = games.filter(g => g.status === 'playing').length;
  const waitingCount = getActiveRooms().length;
  const msg = { type: 'spectator_update', games, activeCount, waitingCount };
  for (const ws of spectators) send(ws, msg);
}

function broadcastToRoom(room, msg) {
  for (const p of room.players) send(p.ws, msg);
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ─── Room management ───────────────────────────────────────────────────────
function createRoom(ws, playerName) {
  let roomId;
  do { roomId = generateRoomId(); } while (rooms.has(roomId));

  const room = { players: [{ ws, name: playerName, index: 0 }], game: null, lastActivity: Date.now() };
  rooms.set(roomId, room);
  players.set(ws, { roomId, playerIndex: 0, name: playerName });

  send(ws, { type: 'room_created', roomId, playerIndex: 0, playerName });
  broadcastLobbyState();
  return room;
}

function joinRoom(ws, roomId, playerName) {
  const room = rooms.get(roomId);
  if (!room) { send(ws, { type: 'error', message: 'Không tìm thấy phòng. Kiểm tra lại mã phòng.' }); return; }
  if (room.players.length >= 2) { send(ws, { type: 'error', message: 'Phòng đã đủ hai người chơi.' }); return; }
  if (room.game) { send(ws, { type: 'error', message: 'Trận đã bắt đầu; không thể tham gia thêm.' }); return; }

  room.players.push({ ws, name: playerName, index: 1 });
  players.set(ws, { roomId, playerIndex: 1, name: playerName });

  room.game = createGame(roomId, room.players[0].name, room.players[1].name);
  room.lastActivity = Date.now();

  send(ws, { type: 'room_joined', roomId, playerIndex: 1, playerName });

  // Notify both players with game start
  broadcastToRoom(room, {
    type: 'game_start',
    game: sanitizeGameState(room.game),
    playerNames: room.players.map(p => p.name),
  });

  broadcastLobbyState();
  broadcastSpectatorUpdate();
}

// ─── WebSocket Handler ─────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, path: '/legacy/ws', maxPayload: 8192 });

wss.on('connection', (ws) => {
  console.log('Client connected. Total:', wss.clients.size);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.playerName !== undefined) {
      msg.playerName = String(msg.playerName).slice(0, 40).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }

    switch (msg.type) {
      case 'create_room':
        createRoom(ws, msg.playerName || 'Player');
        break;

      case 'join_room':
        joinRoom(ws, msg.roomId, msg.playerName || 'Player');
        break;

      case 'rejoin_game': {
        const room = rooms.get(msg.roomId);
        if (!room || !room.game) { send(ws, { type: 'error', message: 'Phòng hoặc trận đấu không còn tồn tại.' }); break; }
        const pi = msg.playerIndex;
        if (pi !== 0 && pi !== 1) { send(ws, { type: 'error', message: 'Không xác định được bên chơi. Hãy vào lại phòng.' }); break; }
        // Re-associate ws with player slot
        if (room.players[pi]) room.players[pi].ws = ws;
        else room.players[pi] = { ws, name: `Player${pi}`, index: pi };
        players.set(ws, { roomId: msg.roomId, playerIndex: pi, name: room.players[pi].name });
        room.lastActivity = Date.now();
        console.log(`Player ${pi} (${room.players[pi].name}) rejoined room ${msg.roomId}`);
        send(ws, {
          type: 'rejoin_ack',
          game: sanitizeGameState(room.game),
          playerNames: room.players.map(p => p.name),
        });
        break;
      }

      case 'move': {
        const pInfo = players.get(ws);
        if (!pInfo) { send(ws, { type: 'error', message: 'Bạn chưa tham gia trận đấu.' }); break; }
        const room = rooms.get(pInfo.roomId);
        if (!room || !room.game) { send(ws, { type: 'error', message: 'Không tìm thấy trận đấu.' }); break; }
        const game = room.game;
        if (game.status !== 'playing') { send(ws, { type: 'move_invalid', reason: 'Trận đã kết thúc.' }); break; }
        if (game.currentTurn !== pInfo.playerIndex) { send(ws, { type: 'move_invalid', reason: 'Chưa đến lượt của bạn.' }); break; }

        const { fromRow, fromCol, toRow, toCol } = msg;
        const check = isValidMove(game, pInfo.playerIndex, fromRow, fromCol, toRow, toCol);
        if (!check.valid) { send(ws, { type: 'move_invalid', reason: check.reason }); break; }

        applyMove(game, pInfo.playerIndex, fromRow, fromCol, toRow, toCol);
        room.lastActivity = Date.now();
        const won = checkWin(game);

        if (won) {
          broadcastToRoom(room, {
            type: 'game_over',
            winner: game.winner,
            winnerName: room.players[game.winner].name,
            winReason: game.winReason,
          });
          broadcastSpectatorUpdate();
        } else {
          broadcastToRoom(room, {
            type: 'game_update',
            game: sanitizeGameState(game),
          });
          broadcastSpectatorUpdate();
        }
        break;
      }

      case 'spectate':
        spectators.add(ws);
        send(ws, {
          type: 'spectator_init',
          games: getSpectatorGames(),
          activeCount: getSpectatorGames().filter(g => g.status === 'playing').length,
          waitingCount: getActiveRooms().length,
        });
        break;

      case 'get_rooms':
      case 'get_lobby':  // alias used by index.html
        send(ws, { type: 'lobby_update', rooms: getActiveRooms(), activeGames: getSpectatorGames().filter(g=>g.status==='playing').length });
        break;

      case 'ping':
        send(ws, { type: 'pong' });
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected. Total:', Math.max(0, wss.clients.size - 1));
    spectators.delete(ws);
    const pInfo = players.get(ws);
    if (pInfo) {
      players.delete(ws);
      // Optionally handle disconnect (forfeit after timeout, etc.)
    }
  });

  ws.on('error', () => {});
});

// ─── Cleanup Inactive Rooms ────────────────────────────────────────────────
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.lastActivity > INACTIVITY_TIMEOUT) {
      broadcastToRoom(room, { type: 'error', message: 'Trận đấu đã bị hủy do không có tương tác trong 5 phút.' });
      for (const p of room.players) {
        if (p.ws) players.delete(p.ws);
      }
      rooms.delete(roomId);
      console.log(`Room ${roomId} removed due to inactivity.`);
      broadcastLobbyState();
      broadcastSpectatorUpdate();
    }
  }
}, 60 * 1000); // Check every minute


return () => { clearInterval(cleanupTimer); for (const ws of wss.clients) ws.terminate(); wss.close(); };
}
module.exports = { attachLegacy };
