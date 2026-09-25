const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = 3000;
const BOARD_SIZE = 9;
const PIECES_PER_PLAYER = 10;
const HOMES = { 0: { row: 0, col: 8 }, 1: { row: 8, col: 0 } };
// RPS: what each type beats
const BEATS = { R: 'S', S: 'P', P: 'R' };

// ─── State ─────────────────────────────────────────────────────────────────
const rooms = new Map();      // roomId -> room
const players = new Map();    // ws -> { roomId, playerIndex, name }
const spectators = new Set(); // ws

// ─── HTTP Server (static file serving) ────────────────────────────────────
const mimeTypes = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json',
};

const httpServer = http.createServer((req, res) => {
  // Strip query string so "game.html?room=XYZ" resolves to "game.html"
  const urlPath = req.url.split('?')[0];
  let filePath = path.join(__dirname, 'public', urlPath === '/' ? 'index.html' : urlPath);
  // Prevent directory traversal
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end(); return;
  }
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });

    res.end(data);
  });
});

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
  const types = shuffleArray(['R','R','R','P','P','P','S','S','S','S']);

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
  // Bounds
  if (fromRow < 0 || fromRow >= BOARD_SIZE || fromCol < 0 || fromCol >= BOARD_SIZE) return { valid: false, reason: 'Out of bounds' };
  if (toRow   < 0 || toRow   >= BOARD_SIZE || toCol   < 0 || toCol   >= BOARD_SIZE) return { valid: false, reason: 'Out of bounds' };
  // Must move exactly 1 step (8 directions)
  const dr = Math.abs(toRow - fromRow), dc = Math.abs(toCol - fromCol);
  if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) return { valid: false, reason: 'Invalid move distance' };
  // Source must have the player's piece
  const src = game.board[fromRow][fromCol];
  if (!src || src.player !== playerIndex) return { valid: false, reason: 'No your piece there' };
  // Target checks
  const tgt = game.board[toRow][toCol];
  if (tgt) {
    if (tgt.player === playerIndex) return { valid: false, reason: 'Cannot capture own piece' };
    // Only winning captures allowed (no suicide, no draws)
    if (BEATS[src.type] !== tgt.type) return { valid: false, reason: 'Cannot capture stronger or equal piece' };
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
  const home0 = HOMES[0]; // Player 0 wins by reaching row8 col0 (player1 home)
  const home1 = HOMES[1]; // Player 1 wins by reaching row0 col8 (player0 home)
  const atHome0 = game.board[home1.row][home1.col];
  const atHome1 = game.board[home0.row][home0.col];
  if (atHome0 && atHome0.player === 1) {
    game.status = 'finished'; game.winner = 1; game.winReason = 'reached_home'; return true;
  }
  if (atHome1 && atHome1.player === 0) {
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

  const room = { players: [{ ws, name: playerName, index: 0 }], game: null };
  rooms.set(roomId, room);
  players.set(ws, { roomId, playerIndex: 0, name: playerName });

  send(ws, { type: 'room_created', roomId, playerIndex: 0, playerName });
  broadcastLobbyState();
  return room;
}

function joinRoom(ws, roomId, playerName) {
  const room = rooms.get(roomId);
  if (!room) { send(ws, { type: 'error', message: 'Room not found' }); return; }
  if (room.players.length >= 2) { send(ws, { type: 'error', message: 'Room is full' }); return; }
  if (room.game) { send(ws, { type: 'error', message: 'Game already started' }); return; }

  room.players.push({ ws, name: playerName, index: 1 });
  players.set(ws, { roomId, playerIndex: 1, name: playerName });

  room.game = createGame(roomId, room.players[0].name, room.players[1].name);

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
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  console.log('Client connected. Total:', wss.clients.size);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create_room':
        createRoom(ws, msg.playerName || 'Player');
        break;

      case 'join_room':
        joinRoom(ws, msg.roomId, msg.playerName || 'Player');
        break;

      case 'rejoin_game': {
        const room = rooms.get(msg.roomId);
        if (!room || !room.game) { send(ws, { type: 'error', message: 'Room or game not found' }); break; }
        const pi = msg.playerIndex;
        if (pi !== 0 && pi !== 1) { send(ws, { type: 'error', message: 'Invalid player index' }); break; }
        // Re-associate ws with player slot
        if (room.players[pi]) room.players[pi].ws = ws;
        else room.players[pi] = { ws, name: `Player${pi}`, index: pi };
        players.set(ws, { roomId: msg.roomId, playerIndex: pi, name: room.players[pi].name });
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
        if (!pInfo) { send(ws, { type: 'error', message: 'Not in a game' }); break; }
        const room = rooms.get(pInfo.roomId);
        if (!room || !room.game) { send(ws, { type: 'error', message: 'Game not found' }); break; }
        const game = room.game;
        if (game.status !== 'playing') { send(ws, { type: 'move_invalid', reason: 'Game is over' }); break; }
        if (game.currentTurn !== pInfo.playerIndex) { send(ws, { type: 'move_invalid', reason: 'Not your turn' }); break; }

        const { fromRow, fromCol, toRow, toCol } = msg;
        const check = isValidMove(game, pInfo.playerIndex, fromRow, fromCol, toRow, toCol);
        if (!check.valid) { send(ws, { type: 'move_invalid', reason: check.reason }); break; }

        applyMove(game, pInfo.playerIndex, fromRow, fromCol, toRow, toCol);
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

// ─── Start ─────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`🎮 RPS Board Game Server running at http://localhost:${PORT}`);
  console.log(`   Spectator view: http://localhost:${PORT}/spectator.html`);
  console.log(`   Game view:      http://localhost:${PORT}/game.html`);
});
