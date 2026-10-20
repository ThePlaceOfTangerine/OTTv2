// Replay viewer of the public site, also embedded in ott-run's offline replay.html. Needs tiles.js, hints.js and replay-nav.js.
// Markup: #viewer, #viewer-title, #viewer-status, #viewer-play, #viewer-prev, #viewer-next, #viewer-turn, #viewer-label, #viewer-board, #viewer-log.
(function (root) {
  const $ = id => document.getElementById(id);
  const node = (tag, value, className) => { const element = document.createElement(tag); if (value !== undefined) element.textContent = value; if (className) element.className = className; return element; };
  // replay.html replaces the image paths with data: URLs so it works from a USB stick without network.
  const images = root.OTT_PIECES || { R: 'assets/pieces/rock.svg', P: 'assets/pieces/paper.svg', S: 'assets/pieces/scissor.svg' }, names = { R: 'Búa', P: 'Bao', S: 'Kéo' };
  const reasons = { reached_home: 'chiếm nhà đối thủ', eliminated: 'ăn hết quân đối thủ', no_legal_moves: 'đối thủ hết nước đi', repetition: 'lặp thế cờ', move_limit: 'hết số nước', material: 'hết số nước, so số quân' };
  let viewer = null, timer = null, events = [];
  // Applies the engine's recorded board changes; replays from before Phase 3a fall back to moving the piece.
  function stateAt(replay, turn) {
    const board = structuredClone(replay.initial.board);
    let tiles = structuredClone(replay.initial.tiles || []), powerUps = structuredClone(replay.initial.powerUps || []);
    for (const entry of replay.turns.slice(0, turn)) {
      const m = entry.move;
      if (entry.changes) for (const change of entry.changes) {
        if ('piece' in change) board[change.row][change.col] = change.piece;
        if ('tile' in change) { tiles = tiles.filter(t => t.row !== change.row || t.col !== change.col); powerUps = powerUps.filter(p => p[0] !== change.row || p[1] !== change.col); }
      } else {
        board[m.toRow][m.toCol] = board[m.fromRow][m.fromCol]; board[m.fromRow][m.fromCol] = null;
        if (powerUps.some(p => p[0] === m.toRow && p[1] === m.toCol)) { board[m.toRow][m.toCol] = { ...board[m.toRow][m.toCol], powered: true }; powerUps = powerUps.filter(p => p[0] !== m.toRow || p[1] !== m.toCol); }
      }
    }
    return { board, tiles, powerUps };
  }
  function render() {
    const replay = viewer, turn = Number($('viewer-turn').value), { board, tiles, powerUps } = stateAt(replay, turn), rules = replay.rules;
    $('viewer-label').textContent = `${turn}/${replay.turns.length}`;
    $('viewer-prev').disabled = OTT.nextEvent(events, turn, -1) === null; $('viewer-next').disabled = OTT.nextEvent(events, turn, 1) === null;
    const host = $('viewer-board'); host.replaceChildren(); host.style.setProperty('--cols', board[0].length);
    const legacy = { blocked: new Set((rules.blockedCells || []).map(p => p.join(','))), void: new Set((rules.voidCells || []).map(p => p.join(','))) };
    const last = turn ? replay.turns[turn - 1].move : null;
    board.forEach((row, r) => row.forEach((piece, c) => {
      const cell = node('div', undefined, `cell ${(r + c) % 2 ? 'dark' : 'light'}`), key = `${r},${c}`, tile = tiles.find(t => t.row === r && t.col === c);
      if (tile) cell.title = paintTile(cell, rules, tile.type);
      else if (!replay.initial.tiles) for (const type of ['blocked', 'void']) if (legacy[type].has(key)) cell.title = paintTile(cell, rules, type);
      if (powerUps.some(p => p[0] === r && p[1] === c)) cell.append(node('span', '+', 'powerup'));
      if (rules.homes.some(h => h.row === r && h.col === c)) { cell.classList.add('home'); cell.append(node('span', '★', 'star')); }
      if (last && ((last.fromRow === r && last.fromCol === c) || (last.toRow === r && last.toCol === c))) cell.classList.add('last');
      if (piece) {
        const token = node('div', undefined, `piece p${piece.player}`);
        if (images[piece.type]) { const img = node('img'); img.src = images[piece.type]; img.alt = names[piece.type]; token.append(img); } else token.textContent = piece.type;
        if (piece.effect) paintEffect(token, rules, piece.effect);
        if (piece.powered) token.append(node('span', '+', 'effect-badge'));
        cell.append(token);
      }
      host.append(cell);
    }));
    const result = replay.result, done = turn === replay.turns.length;
    // Any other reason is a bot fault code (crash, timeout, illegal move...).
    const ending = !result ? '' : reasons[result.winReason] || `bot bên ${replay.fault?.player ?? '?'} lỗi: ${OTT.explain ? OTT.explain(result.winReason).title : result.winReason}`;
    $('viewer-status').textContent = `${replay.bots.map((bot, i) => `Bên ${i}: ${bot.id || '—'}`).join(' · ')}${done && result ? ` · ${result.winner === null ? 'Hòa' : `Bên ${result.winner} thắng`} (${ending})` : ''}`;
    const kinds = new Map(events.map(e => [e.turn, e.kinds]));
    $('viewer-log').replaceChildren(...replay.turns.slice(Math.max(0, turn - 8), turn).map((entry, i, shown) => {
      const number = turn - shown.length + i + 1, item = node('li'), button = node('button', `${number}. Bên ${entry.player}: (${entry.move.fromRow + 1},${entry.move.fromCol + 1}) → (${entry.move.toRow + 1},${entry.move.toCol + 1})${(kinds.get(number) || []).map(k => k === 'capture' ? ' · ăn quân' : ' · nhặt ô').join('')}`, 'log-move');
      button.type = 'button'; button.dataset.turn = number; button.title = 'Quay lại nước này'; item.append(button); return item;
    }));
  }
  const stop = () => { clearInterval(timer); timer = null; $('viewer-play').textContent = 'Tự chạy'; };
  const set = turn => { stop(); $('viewer-turn').value = turn; render(); };
  function play() {
    if (timer) { stop(); return; }
    const slider = $('viewer-turn'); if (Number(slider.value) >= Number(slider.max)) slider.value = 0;
    $('viewer-play').textContent = 'Tạm dừng';
    timer = setInterval(() => { if (Number(slider.value) >= Number(slider.max)) { stop(); return; } slider.value = Number(slider.value) + 1; render(); }, 400);
  }
  function openViewer(replay, title, { atEnd = true } = {}) {
    stop(); viewer = replay; events = OTT.replayEvents(replay); $('viewer').hidden = false;
    const slider = $('viewer-turn'); slider.max = replay.turns.length; slider.value = atEnd ? replay.turns.length : 0;
    $('viewer-title').textContent = title; render();
  }
  $('viewer-turn').addEventListener('input', () => { stop(); render(); });
  $('viewer-play').onclick = play;
  $('viewer-prev').onclick = () => { const target = OTT.nextEvent(events, Number($('viewer-turn').value), -1); if (target !== null) set(target); };
  $('viewer-next').onclick = () => { const target = OTT.nextEvent(events, Number($('viewer-turn').value), 1); if (target !== null) set(target); };
  $('viewer-log').addEventListener('click', event => { const entry = event.target.closest('[data-turn]'); if (entry) set(Number(entry.dataset.turn)); });
  if ($('viewer-close')) $('viewer-close').onclick = () => { $('viewer').hidden = true; stop(); };
  OTT.bindReplayKeys({ active: () => !!viewer && !$('viewer').hidden, get: () => Number($('viewer-turn').value), set, max: () => viewer.turns.length, toggle: play, events: () => events });
  root.OTT = Object.assign(root.OTT || {}, { openViewer });
})(this);
