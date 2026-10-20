const admin = location.pathname.startsWith('/admin');
document.getElementById('area').textContent = admin ? 'BAN TỔ CHỨC' : 'DÀNH CHO THÍ SINH';
if (admin) document.getElementById('page-description').textContent = 'Đăng nhập bằng tài khoản quản trị để điều hành giải.';
const panel = document.getElementById('login-panel');
const dashboard = document.getElementById('dashboard');
const message = document.getElementById('message');
let csrfToken;

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error); error.status = response.status; throw error; }
  return data;
}
async function showSession(data) {
  if (data.user.role !== (admin ? 'admin' : 'contestant')) {
    location.replace(data.user.role === 'admin' ? '/admin' : '/portal'); return;
  }
  csrfToken = data.csrfToken;
  panel.hidden = true; dashboard.hidden = false;
  document.getElementById('heading').textContent = admin ? 'Quản lý giải đấu' : 'Khu vực thí sinh';
  document.getElementById('welcome').textContent = `Tài khoản: ${data.user.username}`;
  document.getElementById('dashboard-help').textContent = admin ? 'Quản lý tài khoản, theo dõi bài nộp và tổ chức các vòng tính điểm. Khu đấu thử cho phép chọn luật và bot để kiểm tra, không tính điểm xếp hạng.' : 'Nộp mã nguồn bot, theo dõi kết quả kiểm tra và xem lại trận thử. Kết quả thi đấu chính thức xuất hiện sau khi ban tổ chức tạo vòng tính điểm.';
  document.getElementById('open-password').hidden = admin || data.user.mustChangePassword;
  if (data.user.mustChangePassword) {
    document.getElementById('heading').textContent = 'Đặt mật khẩu riêng.';
    document.getElementById('overview').textContent = 'Cần đổi mật khẩu được cấp trước khi sử dụng tài khoản.';
    document.getElementById('password-panel').hidden = false;
    configureWorkspace(data.user);
    return;
  }
  configureWorkspace(data.user);
  const overview = await api(`/api/${admin ? 'admin' : 'portal'}/overview`);
  document.getElementById('overview').textContent = admin ? `${overview.contestants} thí sinh · ${overview.locked} tài khoản bị khóa${overview.trust === 'classroom' ? ' · Chế độ lớp học: kết quả không chính thức' : ''}` : overview.readOnly || 'Tài khoản thí sinh đang hoạt động.';
  if (admin) { document.getElementById('admin-guide').hidden = false; document.getElementById('match-panel').hidden = false; await loadMatches(); }
  else { document.getElementById('submission-panel').hidden = false; setupTurnstile(overview.turnstileSiteKey); await loadSubmissionStages(); await loadSubmissions(); }
  await startAdminTools();
  if (!admin) document.dispatchEvent(new Event('portal-ready'));
}
document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault(); message.textContent = '';
  const submit = document.getElementById('submit'); submit.disabled = true;
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: document.getElementById('username').value.trim(), password: document.getElementById('password').value }) });
    document.getElementById('password').value = '';
    await showSession(data);
  } catch (error) { message.textContent = error.message; }
  finally { submit.disabled = false; }
});
document.getElementById('logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } }); location.reload(); }
  catch (error) { message.textContent = error.message; }
});
document.getElementById('open-password').addEventListener('click', () => {
  document.getElementById('password-panel').hidden = false;
  document.getElementById('password-panel').scrollIntoView({ block: 'start' });
  document.getElementById('password-explanation').textContent = 'Nhập mật khẩu hiện tại và mật khẩu mới của bạn.';
  document.getElementById('current-password').focus();
});
document.getElementById('password-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter, status = document.getElementById('password-message'); status.textContent = ''; button.disabled = true;
  try {
    await api('/api/auth/password', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ currentPassword: document.getElementById('current-password').value, newPassword: document.getElementById('new-password').value, confirmPassword: document.getElementById('confirm-password').value }) });
    document.getElementById('password-form').reset(); location.reload();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
api('/api/auth/me').then(showSession).catch(error => { if (error.status !== 401) message.textContent = error.message; });

let replay = null, pollTimer = null, replayTimer = null;
const replayPlay = document.getElementById('replay-play');
const replayRestart = document.getElementById('replay-restart');
const replaySlider = document.getElementById('replay-turn');
const replaySpeed = document.getElementById('replay-speed');
const statusLabels = { queued: 'Đang chờ', running: 'Đang thi đấu', finished: 'Đã hoàn tất', blocked: 'Tạm dừng do lỗi máy chủ', bot_error: 'Lỗi chuẩn bị bot', infrastructure_error: 'Lỗi máy chủ · không tính thua' };
const jobLabels = { queued: 'Chờ xử lý', running: 'Đang xử lý', done: 'Đã xử lý', blocked: 'Tạm dừng sau lỗi máy chủ' };
const matchReasonLabels = { reached_home: 'Chiếm nhà đối thủ', eliminated: 'Ăn hết quân đối thủ', no_legal_moves: 'Đối thủ không còn nước đi hợp lệ', repetition: 'Lặp thế cờ đến giới hạn của bộ luật', move_limit: 'Đạt giới hạn số nước đi', material: 'Hết số nước: so số quân còn lại (bằng nhau thì hòa)', bot_crash: 'Chương trình bot gặp lỗi khi chạy', cpu_timeout: 'Bot vượt thời gian CPU cho một nước', total_cpu_timeout: 'Bot vượt tổng thời gian CPU của trận', wall_timeout: 'Bot không phản hồi trong thời gian cho phép', illegal_move: 'Bot trả nước đi không hợp lệ', invalid_output: 'Bot trả dữ liệu không đúng định dạng', output_limit: 'Bot xuất quá nhiều dữ liệu', userdata_limit: 'Dữ liệu ghi nhớ vượt giới hạn', sandbox_violation: 'Bot thực hiện thao tác bị cấm' };
document.getElementById('check-sandbox').addEventListener('click', async event => {
  const status = document.getElementById('sandbox-status'); event.target.disabled = true; status.textContent = 'Đang kiểm tra khả năng chạy bot và các cơ chế cách ly…';
  try { const data = await api('/api/admin/sandbox'); status.textContent = data.backend === 'windows-job' ? `Máy chủ sẵn sàng chạy bot (${data.image}${data.cpp ? '' : `; ${data.cppError || 'chưa có g++, chỉ chấm Python'}`}). ${data.warning}` : `Máy chủ sẵn sàng chạy bot. Đã kiểm tra cơ chế chặn thao tác hệ thống và đọc file ngoài phạm vi cho phép (Landlock ABI ${data.landlock_abi}, seccomp).`; }
  catch (error) { status.textContent = `Môi trường chạy bot chưa sẵn sàng: ${error.message}`; }
  finally { event.target.disabled = false; }
});
document.getElementById('match-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = document.getElementById('run-match'); button.disabled = true; message.textContent = '';
  try {
    await api('/api/admin/matches', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ botA: document.getElementById('bot-a').value, botB: document.getElementById('bot-b').value, seed: document.getElementById('match-seed').value, ruleSetId: JSON.parse(document.getElementById('practice-rule').value)[0], ruleSetVersion: JSON.parse(document.getElementById('practice-rule').value)[1] }) });
    await loadMatches();
  } catch (error) { message.textContent = error.message; button.disabled = false; }
});
async function loadMatches() {
  clearTimeout(pollTimer);
  const data = await api('/api/admin/matches');
  for (const id of ['bot-a','bot-b']) { const select=document.getElementById(id), selected=select.value; select.replaceChildren(...(data.bots || data.samples.map(id=>({id,label:id}))).map(bot=>{const option=document.createElement('option');option.value=bot.id;option.textContent=bot.label;return option;})); if ([...select.options].some(o=>o.value===selected)) select.value=selected; }
  if (typeof updateBotCatalog === 'function') updateBotCatalog(data.bots || []);
  const list = document.getElementById('match-list'); list.replaceChildren();
  document.getElementById('run-match').disabled = data.matches.some(match => match.status === 'running');
  if (!data.matches.length) list.textContent = 'Chưa có trận thử.';
  for (const match of data.matches) {
    const row = document.createElement('div'); row.className = 'match-row';
    const info = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('p');
    title.textContent = `${match.bots.join(' gặp ')} · ${statusLabels[match.status]}`;
    detail.textContent = `Luật: ${match.rule_set_name || "Classic"} · bản ${match.rule_set_version || 1} · Mã trận: ${match.seed}${match.error ? ' · ' + match.error.message : ''}`;
    info.append(title, detail); const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Xem trận';
    button.addEventListener('click', () => openMatch(match.id).catch(error => { message.textContent = error.message; }));
    row.append(info, button); list.append(row);
  }
  if (data.matches.some(match => match.status === 'running')) pollTimer = setTimeout(() => loadMatches().catch(error => { message.textContent = error.message; }), 2000);
}
async function openMatch(id) {
  pauseReplay();
  const match = await api(`/api/admin/matches/${encodeURIComponent(id)}`);
  showReplay(match);
}
function showReplay(match) {
  const opening = document.getElementById('replay-panel').hidden;
  pauseReplay();
  document.getElementById('replay-panel').hidden = false;
  document.getElementById('replay-title').textContent = `Xem trận đấu · ${match.seed}`;
  document.getElementById('replay-log').textContent = JSON.stringify(match, null, 2);
  replay = match.replay;
  document.getElementById('replay-stage').hidden = !replay;
  const slider = document.getElementById('replay-turn'); slider.max = replay ? replay.turns.length : 0; slider.value = 0;
  replayPlay.disabled = replayRestart.disabled = !replay?.turns.length;
  slider.disabled = !replay?.turns.length;
  updatePlaybackLabel();
  if (!replay) {
    document.getElementById('replay-result').textContent = match.error?.message || 'Trận chưa có dữ liệu nước đi. Chờ trận bắt đầu hoặc kiểm tra trạng thái xử lý.';
    document.getElementById('replay-board').replaceChildren(); return;
  }
  document.getElementById('replay-result').textContent = !replay.result ? `Đang thi đấu · ${replay.turns.length} nước` : `${replay.result.winner === null ? 'Hòa' : `Bên ${replay.result.winner} thắng`} · ${matchReasonLabels[replay.result.winReason] || replay.result.winReason} · ${replay.turns.length} nước · Thời gian tính bên 0 / bên 1: ${replay.cpu_ms.map(n => Math.round(n) + ' ms').join(' / ')}`;
  renderReplay();
  if (opening) document.getElementById('replay-panel').scrollIntoView({ block: 'start' });
}
function updatePlaybackLabel() {
  replayPlay.textContent = replayTimer !== null ? 'Tạm dừng' : replay && Number(replaySlider.value) >= replay.turns.length && replay.turns.length ? 'Phát lại' : 'Tự động chạy';
  replayPlay.setAttribute('aria-pressed', String(replayTimer !== null));
}
function pauseReplay() {
  clearTimeout(replayTimer); replayTimer = null; updatePlaybackLabel();
}
function scheduleReplayStep() {
  replayTimer = setTimeout(() => {
    if (!replay) { pauseReplay(); return; }
    replaySlider.value = Math.min(Number(replaySlider.value) + 1, replay.turns.length);
    renderReplay();
    if (Number(replaySlider.value) >= replay.turns.length) pauseReplay();
    else scheduleReplayStep();
  }, Number(replaySpeed.value));
  updatePlaybackLabel();
}
replayPlay.addEventListener('click', () => {
  if (replayTimer !== null) { pauseReplay(); return; }
  if (!replay?.turns.length) return;
  if (Number(replaySlider.value) >= replay.turns.length) { replaySlider.value = 0; renderReplay(); }
  scheduleReplayStep();
});
replayRestart.addEventListener('click', () => { pauseReplay(); replaySlider.value = 0; renderReplay(); updatePlaybackLabel(); });
replaySpeed.addEventListener('change', () => {
  if (replayTimer !== null) { pauseReplay(); scheduleReplayStep(); }
});
replaySlider.addEventListener('input', () => { pauseReplay(); renderReplay(); updatePlaybackLabel(); });
window.addEventListener('pagehide', pauseReplay);
// Captures and pickups, recomputed only when a live replay grows.
let replayEventCache = { replay: null, length: -1, events: [] };
function replayEventList() {
  if (replayEventCache.replay !== replay || replayEventCache.length !== replay?.turns.length) replayEventCache = { replay, length: replay?.turns.length ?? -1, events: replay ? OTT.replayEvents(replay) : [] };
  return replayEventCache.events;
}
function setReplayTurn(turn) { pauseReplay(); replaySlider.value = turn; renderReplay(); updatePlaybackLabel(); }
for (const [id, direction] of [['replay-prev-event', -1], ['replay-next-event', 1]]) document.getElementById(id).addEventListener('click', () => {
  const target = OTT.nextEvent(replayEventList(), Number(replaySlider.value), direction); if (target !== null) setReplayTurn(target);
});
OTT.bindReplayKeys({ active: () => !document.getElementById('replay-panel').hidden && !!replay?.turns.length, get: () => Number(replaySlider.value), set: setReplayTurn,
  max: () => replay.turns.length, toggle: () => replayPlay.click(), events: replayEventList });
document.getElementById('replay-move-log').addEventListener('click', event => { const entry = event.target.closest('[data-turn]'); if (entry) setReplayTurn(Number(entry.dataset.turn)); });
function renderReplay() {
  if (!replay) return;
  const turn = Number(document.getElementById('replay-turn').value);
  document.getElementById('replay-turn-label').textContent = `${turn}/${replay.turns.length}`;
  const events = replayEventList();
  document.getElementById('replay-prev-event').disabled = OTT.nextEvent(events, turn, -1) === null;
  document.getElementById('replay-next-event').disabled = OTT.nextEvent(events, turn, 1) === null;
  const board = structuredClone(replay.initial.board);
  let powerUps=structuredClone(replay.initial.powerUps||[]), tiles=structuredClone(replay.initial.tiles||[]);
  const notes = [];
  replay.turns.slice(0, turn).forEach((entry, i) => {
    const m = entry.move, note = notes[i] = [];
    // New replays carry the engine's own board diffs, so drawing needs no knowledge of the rules.
    if (Array.isArray(entry.changes)) {
      const target = board[m.toRow][m.toCol];
      for (const change of entry.changes) {
        if ('piece' in change) board[change.row][change.col] = change.piece && structuredClone(change.piece);
        if ('tile' in change) {
          const tile = tiles.find(t => t.row === change.row && t.col === change.col);
          note.push(tile ? `Nhặt ${tileLabel(replay.rules, tile.type)}` : 'Nhặt power-up (+)');
          tiles = tiles.filter(t => t.row !== change.row || t.col !== change.col); powerUps = powerUps.filter(p => p[0] !== change.row || p[1] !== change.col);
        }
      }
      const moved = entry.changes.some(c => c.row === m.fromRow && c.col === m.fromCol && 'piece' in c && c.piece === null);
      if (target && target.player !== entry.player) note.unshift(moved ? 'Ăn quân' : 'Đánh vỡ khiên, quân đứng yên');
      if (entry.changes.some(c => c.piece?.player === entry.player && !(c.row === m.toRow && c.col === m.toCol) && !(c.row === m.fromRow && c.col === m.fromCol))) note.push('Lướt thêm 1 ô');
      return;
    }
    if (board[m.toRow][m.toCol]) note.push('Ăn quân');
    board[m.toRow][m.toCol] = board[m.fromRow][m.fromCol]; board[m.fromRow][m.fromCol] = null;
    if(powerUps.some(p=>p[0]===m.toRow&&p[1]===m.toCol)){board[m.toRow][m.toCol].powered=true;powerUps=powerUps.filter(p=>p[0]!==m.toRow||p[1]!==m.toCol);note.push('Nhặt power-up (+)');}
  });
  const tileAt = new Map(tiles.map(t => [`${t.row},${t.col}`, t.type]));
  const rows = board.length, cols = board[0].length;
  const last = turn ? replay.turns[turn - 1] : null;
  const element = document.getElementById('replay-board'); element.replaceChildren();
  const wrap = document.getElementById('replay-chess-wrap');
  wrap.style.setProperty('--board-cols', cols); wrap.style.setProperty('--board-rows', rows);
  document.getElementById('replay-stage').dataset.theme = replay.rules.boardTheme || 'classic';
  const columnName = index => { let label = ''; for (let v = index + 1; v; v = Math.floor((v - 1) / 26)) label = String.fromCharCode(65 + (v - 1) % 26) + label; return label; };
  for (const id of ['replay-col-top', 'replay-col-bottom', 'replay-row-left', 'replay-row-right']) {
    const strip = document.getElementById(id); strip.replaceChildren();
    for (let i = 0; i < (id.includes('col-') ? cols : rows); i++) { const label = document.createElement('span'); label.className = 'clabel'; label.textContent = id.includes('col-') ? columnName(i) : rows - i; strip.append(label); }
  }
  const images = { R: '/assets/pieces/rock.svg', P: '/assets/pieces/paper.svg', S: '/assets/pieces/scissor.svg' };
  const labels = { R: 'Búa', P: 'Bao', S: 'Kéo' };
  const counts = [{}, {}];
  // Rules with tileTypes list blocked/void cells in state.tiles; older rules keep them only in the RuleSet.
  const blocked = replay.initial.tiles ? new Set() : new Set((replay.rules.blockedCells || []).map(p => p.join(',')));
  const voids = replay.initial.tiles ? new Set() : new Set((replay.rules.voidCells || []).map(p => p.join(',')));
  board.forEach((row, r) => row.forEach((piece, c) => {
    const cell = document.createElement('div'); cell.className = `cell ${(r + c) % 2 === 0 ? 'light-sq' : 'dark-sq'}`;
    cell.title = `${columnName(c)}${rows - r}${piece ? ` · Bên ${piece.player} · ${labels[piece.type] || piece.type}` : ''}`;
    if (blocked.has(`${r},${c}`)) { cell.classList.add('terrain-blocked'); cell.title += ' · Chướng ngại vật'; }
    if (voids.has(`${r},${c}`)) { cell.classList.add('terrain-void'); cell.title += ' · Ngoài bản đồ'; }
    if (tileAt.has(`${r},${c}`)) cell.title += ` · ${paintTile(cell, replay.rules, tileAt.get(`${r},${c}`))}`;
    if(powerUps.some(p=>p[0]===r&&p[1]===c)){const badge=document.createElement('span');badge.className='power-up';badge.textContent='+';badge.title='Power-up: đi vào ô này để nâng cấp quân';cell.append(badge);cell.title+=' · Power-up';}
    if (piece) {
      counts[piece.player][piece.type] = (counts[piece.player][piece.type] || 0) + 1;
      const token = document.createElement('div'); token.className = `piece p${piece.player}`;
      if (images[piece.type]) { const img = document.createElement('img'); img.src = images[piece.type]; img.alt = labels[piece.type]; token.append(img); }
      else token.textContent = piece.type;
      token.dataset.player = piece.player; token.dataset.type = piece.type;
      if (piece.effect) cell.title += ` · ${paintEffect(token, replay.rules, piece.effect)}`;
      if(piece.powered){token.classList.add('powered');const badge=document.createElement('span');badge.className='powered-badge';badge.textContent='+';token.append(badge);cell.title+=' · Đã nâng cấp: ăn được quân cùng loại';}
      cell.append(token);
    }
    replay.rules.homes.forEach((h, p) => { if (h.row === r && h.col === c) { cell.classList.add(`home-p${p}`); const star = document.createElement('span'); star.className = 'home-icon'; star.textContent = '★'; cell.append(star); } });
    if (last?.move.fromRow === r && last.move.fromCol === c) cell.classList.add('last-from');
    if (last?.move.toRow === r && last.move.toCol === c) cell.classList.add('last-to');
    element.append(cell);
  }));
  const finished = !!replay.result && turn === replay.turns.length;
  const currentPlayer = last ? 1 - last.player : replay.initial.currentTurn;
  const botName = player => { const bot = replay.bots?.[player]; return typeof bot === 'string' ? bot : bot?.id || `Bot ${player}`; };
  const types = [...new Set(['R', 'P', 'S', ...replay.rules.pieceTypes])];
  for (const player of [0, 1]) {
    document.getElementById(`replay-name-${player}`).textContent = `Bên ${player} · ${botName(player)}`;
    document.getElementById(`replay-banner-${player}`).classList.toggle('active', !finished && currentPlayer === player);
    document.getElementById(`replay-turn-${player}`).hidden = finished || currentPlayer !== player;
    document.getElementById(`replay-stat-${player}`).textContent = Object.values(counts[player]).reduce((sum, value) => sum + value, 0);
    const badges = document.getElementById(`replay-pieces-${player}`); badges.replaceChildren();
    for (const type of types) {
      const badge = document.createElement('span'); badge.className = 'pc'; badge.title = labels[type] || type;
      if (images[type]) { const img = document.createElement('img'); img.src = images[type]; img.alt = labels[type]; badge.append(img); }
      else badge.append(document.createTextNode(type));
      badge.append(document.createTextNode(String(counts[player][type] || 0))); badges.append(badge);
    }
  }
  document.getElementById('replay-stat-moves').textContent = turn;
  const reasons = matchReasonLabels;
  document.getElementById('replay-status').textContent = finished
    ? `${replay.result.winner === null ? 'Hòa' : `Bên ${replay.result.winner} thắng`} · ${reasons[replay.result.winReason] || replay.result.winReason}`
    : `Lượt bên ${currentPlayer} · ${botName(currentPlayer)}`;
  const log = document.getElementById('replay-move-log'); log.replaceChildren();
  if (!turn) { const empty = document.createElement('p'); empty.className = 'log-empty'; empty.textContent = 'Chưa có nước đi.'; log.append(empty); }
  replay.turns.slice(0, turn).map((entry, i) => ({ entry, i, m: entry.move })).reverse().forEach(({ entry, i, m }) => {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'log-entry'; item.dataset.turn = i + 1; item.title = 'Quay lại nước này';
    const player = document.createElement('span'); player.className = `pt p${entry.player}`; player.textContent = `Bên ${entry.player}`;
    item.append(document.createTextNode(`${i + 1}. `), player, document.createTextNode(` ${columnName(m.fromCol)}${rows - m.fromRow} → ${columnName(m.toCol)}${rows - m.toRow}`));
    for (const note of notes[i]) item.append(document.createTextNode(` · ${note}`));
    log.append(item);
  });
}

let submissionPoll = null, selectedSubmission = null, turnstileWidget = null;
// Cloudflare Turnstile guards the file-upload fallback only when the server provides a site key.
function setupTurnstile(siteKey) {
  if (!siteKey || turnstileWidget !== null) return;
  const box = document.getElementById('turnstile-box'), script = document.createElement('script');
  box.hidden = false; turnstileWidget = undefined;
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
  script.onload = () => { turnstileWidget = turnstile.render(box, { sitekey: siteKey, 'response-field': false }); };
  script.onerror = () => { box.textContent = 'Không tải được bước xác minh chống bot. Kiểm tra mạng rồi tải lại trang.'; };
  document.head.append(script);
}
let submissionStageId = '', submissionStage = null, submissionSequence = 0, retryUpload = null, uploadBusy = false;
async function loadSubmissionStages() {
  const data = await api('/api/portal/tournaments');
  const select = document.getElementById('submission-stage'); select.replaceChildren();
  const practice = document.createElement('option'); practice.value = ''; practice.textContent = 'Luyện tập ngoài giải (luật cơ bản)'; select.append(practice);
  for (const stage of data.stages) { const option = document.createElement('option'); option.value = stage.id; option.textContent = `${stage.name} · ${stage.kind === 'final' ? 'Nộp lại vòng chính thức' : 'Vòng loại'}`; select.append(option); }
  if (!data.stages.some(stage => stage.id === submissionStageId)) submissionStageId = '';
  select.value = submissionStageId;
}
document.getElementById('submission-stage').addEventListener('change', async event => {
  submissionStageId = event.target.value; selectedSubmission = null; retryUpload = null;
  document.getElementById('submission-detail').hidden = true;
  try { await loadSubmissions(); } catch (error) { submissionMessage.textContent = error.message; }
});
document.getElementById('submission-stage-refresh').addEventListener('click', async () => {
  try { await loadSubmissionStages(); await loadSubmissions(); } catch (error) { submissionMessage.textContent = error.message; }
});
document.addEventListener('visibilitychange', () => { if (!admin && !document.hidden && submissionStageId) loadSubmissions().catch(error => { submissionMessage.textContent = error.message; }); });
const submissionLabels = { Queued: 'Đang chờ', Scanning: 'Đang kiểm tra bài', Compiling: 'Đang chuẩn bị chạy', 'Test match': 'Đang đấu thử', Accepted: 'Sẵn sàng thi đấu', Rejected: 'Cần sửa bài' };
const submissionMessage = document.getElementById('submission-message');
document.getElementById('submission-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = document.getElementById('submit-bot'); button.disabled = true; submissionMessage.textContent = '';
  if (uploadBusy) return;
  uploadBusy = true;
  document.getElementById('submission-stage').disabled = document.getElementById('submission-stage-refresh').disabled = true;
  try {
    const file = document.getElementById('bot-file').files[0];
    if (!file) throw new Error('Hãy chọn file bot.');
    if (file.size > (file.name.endsWith('.zip') ? 5 : 1) * 1024 * 1024) throw new Error('Một file mã nguồn tối đa 1 MiB; file ZIP tối đa 5 MiB.');
    const form = new FormData(); form.append('bot', file);
    const entry = document.getElementById('bot-entry').value.trim(); if (entry) form.append('entry', entry);
    if (turnstileWidget !== null) {
      const token = turnstileWidget === undefined ? '' : turnstile.getResponse(turnstileWidget);
      if (!token) throw new Error('Hãy hoàn tất bước xác minh chống bot bên dưới trước khi nộp.');
      form.append('cf-turnstile-response', token);
    }
    const stageId = submissionStageId;
    if (!retryUpload || retryUpload.file !== file || retryUpload.entry !== entry || retryUpload.stageId !== stageId) retryUpload = { file, entry, stageId, key: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') };
    const result = await api(stageId ? `/api/portal/stages/${encodeURIComponent(stageId)}/submissions` : '/api/portal/submissions', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken, ...(stageId ? { 'Idempotency-Key': retryUpload.key } : {}) }, body: form });
    retryUpload = null;
    selectedSubmission = result.id; document.getElementById('bot-file').value = '';
    submissionMessage.textContent = `Đã nhận phiên bản v${result.version} · Mã bài: ${result.id} · ${new Date(result.received_at).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' })} (giờ Việt Nam). Theo dõi kết quả bên dưới.`;
    await loadSubmissions();
  } catch (error) { submissionMessage.textContent = error.message; }
  finally { if (turnstileWidget) turnstile.reset(turnstileWidget); uploadBusy = false; button.disabled = false; document.getElementById('submission-stage').disabled = document.getElementById('submission-stage-refresh').disabled = false; document.getElementById('submission-upload-fields').disabled = !!submissionStage && !submissionStage.canSubmit; }
});
async function submissionAction(id, action) {
  try {
    await api(`/api/portal/submissions/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
    submissionMessage.textContent = action === 'activate' ? 'Đã chọn phiên bản bot cho các vòng mới. Vòng đang thi đấu vẫn dùng phiên bản đã chốt.' : 'Đã đưa bài trở lại hàng đợi.';
    await loadSubmissions();
  } catch (error) { submissionMessage.textContent = error.message; }
}
function renderSubmissionStage(stage) {
  const host = document.getElementById('submission-stage-info');
  host.replaceChildren();
  host.dataset.state = 'practice';
  if (!stage) { host.textContent = 'Luyện tập ngoài giải · Bài luyện tập không tự trở thành bài thi. Chọn đúng giải trước khi nộp.'; return; }
  const upcoming = stage.status === 'open' && stage.serverNow < stage.opensAt;
  const remaining = stage.closesAt - stage.serverNow;
  const state = stage.status === 'locked' ? 'locked' : upcoming ? 'upcoming' : stage.canSubmit ? remaining <= 86400000 ? 'urgent' : 'open' : 'closed';
  host.dataset.state = state;
  const badge = textNode('span', stage.cancelled ? 'Giải đã hủy' : ({ locked: 'Đã chốt bot', upcoming: 'Chưa đến giờ nhận bài', urgent: 'Sắp hết hạn nộp', open: 'Đang nhận bài', closed: 'Đã đóng nhận bài' })[state]);
  badge.className = 'stage-state'; host.append(badge);
  if (stage.kind === 'final') {
    const notice = textNode('p', `Nộp lại vòng chính thức · ${stage.rules.name} · bản ${stage.rules.version}. ${stage.announcement || ''}`); notice.className = 'stage-note'; host.append(notice);
    host.append(textNode('p', 'Bắt buộc có bài hợp lệ trong đợt này. Không tự dùng bot vòng loại nếu chưa kiểm tra theo luật chính thức.'));

  }
  const deadline = document.createElement('div'); deadline.className = 'stage-deadline';
  deadline.append(textNode('span', 'Hạn nộp bài · giờ Việt Nam'));
  const time = textNode('time', new Date(stage.closesAt).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' }));
  time.dateTime = new Date(stage.closesAt).toISOString(); deadline.append(time); host.append(deadline);
  const formatDuration = ms => {
    const minutes = Math.ceil(ms / 60000), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
    return [days ? `${days} ngày` : '', hours ? `${hours} giờ` : '', `${minutes % 60} phút`].filter(Boolean).join(' ');
  };
  const summary = upcoming ? `Mở nhận bài lúc ${new Date(stage.opensAt).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' })}`
    : stage.canSubmit ? `Còn ${formatDuration(Math.max(0, remaining))} để nộp bài`
    : stage.status === 'locked' ? 'Danh sách bot đã được chốt cho vòng thi.' : 'Không thể nộp thêm bài cho giai đoạn này.';
  const countdown = textNode('p', summary); countdown.className = 'stage-remaining'; host.append(countdown);
  const clock = textNode('p', `Theo giờ máy chủ khi cập nhật: ${new Date(stage.serverNow).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' })}.`); clock.className = 'stage-clock'; host.append(clock);
  const rules = stage.rules;
  const rulePanel = document.createElement('section'); rulePanel.className = 'stage-rule-description';
  rulePanel.append(textNode('h3', 'Quy tắc của vòng đang chọn'));
  if (rules) {
    rulePanel.append(textNode('p', rules.name + ' · phiên bản ' + rules.version + ' · ' + (stage.kind === 'final' ? 'Vòng chính thức' : 'Vòng loại')));
    const list = document.createElement('ul');
    const item = value => list.append(textNode('li', value));
    if (rules.engine === 'rps-grid-v1') {
      const pieceName = type => ({ R: 'Búa', P: 'Bao', S: 'Kéo' })[type] || type;
      item('Bàn cờ: ' + (rules.boardRows ?? rules.boardSize) + ' hàng × ' + (rules.boardCols ?? rules.boardSize) + ' cột; ' + (rules.blockedCells || []).length + ' ô chặn, ' + (rules.voidCells || []).length + ' ô ngoài bản đồ.');
      const army = pool => Object.entries(pool.reduce((counts, type) => { counts[type] = (counts[type] || 0) + 1; return counts; }, {})).map(([type, count]) => count + ' ' + pieceName(type)).join(', ');
      item(rules.randomExtraPiece ? 'Mỗi bên có 10 quân Búa/Bao/Kéo theo tỷ lệ 3–3–4; loại có 4 quân được chọn theo mã khởi tạo, giống nhau cho hai bên.' : rules.playerPieceTypes ? 'Quân bên A: ' + army(rules.playerPieceTypes[0]) + '. Quân bên B: ' + army(rules.playerPieceTypes[1]) + '.' : 'Quân mỗi bên: ' + army(rules.pieceTypes) + '.');
      const movementNames = { king: 'một ô theo tám hướng', rook: 'theo hàng hoặc cột', bishop: 'theo đường chéo', queen: 'theo hàng, cột hoặc đường chéo', knight: 'theo chữ L (bị cản nếu ô sát theo chiều dài chữ L có vật cản)', pawn: 'tiến thẳng một ô trống, ăn chéo một ô; bên A tiến xuống, bên B tiến lên' };
      const directions = (rules.directions || []).map(d => '[' + d.join(', ') + ']').join(', ');
      item('Di chuyển mặc định: mỗi lượt đi một quân, một bước theo độ lệch [hàng, cột]: ' + directions + '.');
      for (const [type, move] of Object.entries(rules.movementByType || {})) item(pieceName(type) + ': ' + (movementNames[move.kind] || 'hướng tùy chỉnh ' + JSON.stringify(move.directions) + ', tối đa ' + move.maxSteps + ' bước' + (move.relative ? ', đảo hướng cho bên B' : '')) + '.');
      item('Không được đi xuyên qua quân, ô chặn hoặc ô ngoài bản đồ. Ăn quân: ' + Object.entries(rules.beats).map(([a, b]) => pieceName(a) + ' ăn ' + pieceName(b)).join('; ') + '.');
      item('Thắng khi chiếm nhà đối phương, ăn hết quân đối phương hoặc đối phương không còn nước hợp lệ. Điều kiện thắng được xét trước điều kiện hòa.');
      item(rules.onMoveLimit === 'material'
        ? 'Đạt ' + rules.maxMoves + ' nước tổng cộng: bên còn nhiều quân hơn thắng (mỗi quân 1 điểm), bằng nhau thì hòa. Cùng thế cờ và bên đến lượt lặp lại ' + rules.repetitionLimit + ' lần luôn là hòa.'
        : 'Hòa khi đạt ' + rules.maxMoves + ' nước tổng cộng hoặc cùng thế cờ và bên đến lượt lặp lại ' + rules.repetitionLimit + ' lần.');
      if (rules.tileTypes) {
        // Described from the RuleSet itself, so a new tile type needs no portal change.
        for (const [type, definition] of Object.entries(rules.tileTypes)) item('Ô ' + definition.render.symbol + ' · ' + definition.render.label + (definition.passable ? '' : ' (không đi vào được)') + (definition.effect ? ' — đi vào thì quân nhận hiệu ứng và ô biến mất; mỗi quân giữ một hiệu ứng, nhặt ô mới thì thay.' : '.') + ' Mã loại: ' + type + '.');
        if (rules.tiles?.length) item('Bàn có ' + rules.tiles.length + ' ô đặt sẵn; xem vị trí trong cấu hình đầy đủ (trường tiles).');
        for (const spawn of rules.tileSpawns || []) {
          const region = spawn.region ? ' trong vùng hàng ' + (spawn.region.rowFrom + 1) + '–' + (spawn.region.rowTo + 1) + ', cột ' + (spawn.region.colFrom + 1) + '–' + (spawn.region.colTo + 1) : '';
          item('Mỗi trận rải ngẫu nhiên theo mã khởi tạo ' + spawn.count[0] + '–' + spawn.count[1] + (spawn.symmetry === 'point' ? ' cặp ô đối xứng qua tâm bàn' : ' ô') + region + ': ' + spawn.types.map(type => rules.tileTypes[type].render.label).join('; ') + '. Vị trí thật nằm trong state.tiles mỗi lượt.');
        }
        item('Nước ăn quân đang có khiên vẫn nằm trong legal_moves, nhưng chỉ làm vỡ khiên và quân của bạn đứng yên. Đọc piece.effect để biết.');
      } else item(rules.powerUps ? 'Có vật phẩm tăng sức mạnh: sinh ngẫu nhiên tối đa 3 ở ô trống; quân nhặt được có thể ăn cả quân cùng loại. Vật phẩm không sinh lại.' : 'Không có vật phẩm tăng sức mạnh.');
      item('Tọa độ bắt đầu từ 0. Vị trí nhà và vị trí xuất phát nằm trong cấu hình đầy đủ bên dưới; quân được xáo trộn theo mã khởi tạo. Bot nên đọc luật, trạng thái và danh sách nước hợp lệ máy chủ gửi, không cố định bàn cờ trong mã.');
    } else item('Vòng này dùng bộ máy luật riêng. Hãy xem cấu hình đầy đủ và thông báo của ban tổ chức trước khi nộp.');
    rulePanel.append(list);
    const details = document.createElement('details'); details.append(textNode('summary', 'Xem cấu hình luật đầy đủ và tọa độ xuất phát'));
    const config = textNode('pre', JSON.stringify(rules, null, 2)); config.className = 'stage-rules-json'; details.append(config); rulePanel.append(details);
  } else rulePanel.append(textNode('p', 'Chưa tải được luật của vòng. Hãy cập nhật giải và trạng thái trước khi nộp.'));
  host.append(rulePanel);
  const note = textNode('p', stage.snapshot ? 'Bot đã chốt: v' + stage.snapshot.version : 'Bài nhận đúng hạn tiếp tục được kiểm tra. Nếu chưa chọn riêng, hệ thống dùng bản hợp lệ mới nhất.'); note.className = 'stage-note'; host.append(note);
}
async function loadSubmissions() {
  clearTimeout(submissionPoll);
  const request = ++submissionSequence, context = submissionStageId;
  const data = await api(context ? `/api/portal/stages/${encodeURIComponent(context)}/submissions` : '/api/portal/submissions');
  if (request !== submissionSequence || context !== submissionStageId) return;
  submissionStage = data.stage || null;
  document.getElementById('submission-upload-fields').disabled = uploadBusy || !!submissionStage && !submissionStage.canSubmit;
  renderSubmissionStage(submissionStage);
  const list = document.getElementById('submission-list'); list.replaceChildren();
  if (!data.submissions.length) list.textContent = 'Chưa có phiên bản nào. Tải mã mẫu trong mục Hướng dẫn hoặc chọn file để nộp bot đầu tiên.';
  for (const submission of data.submissions) {
    const row = document.createElement('div'); row.className = 'submission-row';
    const info = document.createElement('div'), title = document.createElement('strong'); title.textContent = `v${submission.version} · ${submission.commit_sha ? `commit ${submission.commit_sha.slice(0, 7)}${submission.origin === 'deadline' ? ' (lấy lúc hết hạn)' : ''}` : submission.filename}`;
    const badge = document.createElement('span'); badge.className = `status-badge ${submission.status.toLowerCase().replace(' ', '-')}`; badge.textContent = submissionLabels[submission.status] || submission.status;
    info.append(title, badge);
    if (submission.active) { const active = document.createElement('span'); active.className = 'status-badge active'; active.textContent = 'DÙNG THI ĐẤU'; info.append(active); }
    const language = submission.language || (submission.filename.endsWith('.py') ? 'python' : submission.filename.endsWith('.cpp') ? 'cpp' : submission.status === 'Rejected' ? 'Không xác định' : 'Đang nhận dạng');
    const detail = document.createElement('p'); detail.textContent = `${language} · Lần kiểm tra: ${submission.attempts}${submission.error_type === 'system' ? ' · Lỗi máy chủ, không quy thành lỗi bot' : ''}${submission.status === 'Rejected' ? ' · Mở chi tiết để xem cách sửa.' : ''}`; info.append(detail);
    const actions = document.createElement('div'); actions.className = 'submission-actions';
    const view = document.createElement('button'); view.type = 'button'; view.textContent = 'Chi tiết & trận thử';
    view.addEventListener('click', () => { selectedSubmission = submission.id; loadSubmissionDetail().catch(error => { submissionMessage.textContent = error.message; }); }); actions.append(view);
    if (submission.status === 'Accepted' && !submission.active && (!submissionStage || submissionStage.canSubmit)) { const activate = document.createElement('button'); activate.type = 'button'; activate.textContent = 'Chọn bản này thi đấu'; activate.addEventListener('click', () => submissionAction(submission.id, 'activate')); actions.append(activate); }
    if (submission.job_status === 'blocked' && submission.error_type === 'system') { const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Thử lại'; retry.addEventListener('click', () => submissionAction(submission.id, 'retry')); actions.append(retry); }
    row.append(info, actions); list.append(row);
  }
  if (selectedSubmission) await loadSubmissionDetail();
  if (data.submissions.some(submission => ['queued','running'].includes(submission.job_status)) || submissionStage && submissionStage.status !== 'locked') submissionPoll = setTimeout(() => { if (!document.hidden) loadSubmissions().catch(error => { submissionMessage.textContent = error.message; }); }, 3000);
}
async function loadSubmissionDetail() {
  if (!selectedSubmission) return;
  const id = selectedSubmission;
  const submission = await api(`/api/portal/submissions/${encodeURIComponent(id)}`);
  if (selectedSubmission !== id) return;
  document.getElementById('submission-detail').hidden = false;
  document.getElementById('submission-title').textContent = `Phiên bản v${submission.version} · ${submissionLabels[submission.status] || submission.status}${submission.active ? ' · ĐANG CHỌN' : ''}`;
  const reason = document.getElementById('submission-reason');
  if (submission.error_type === 'system') {
    reason.textContent = submission.job_status === 'blocked'
      ? 'Máy chủ đang gặp sự cố và đã tạm dừng kiểm tra. Bấm “Thử lại” hoặc báo ban tổ chức. Bạn chưa cần sửa code vì thông báo này.'
      : 'Máy chủ gặp sự cố và sẽ tự thử lại. Bạn chưa cần sửa code hoặc nộp lại bài.';
  } else if (submission.status === 'Rejected') {
    const hint = OTT.explain(submission.reason_code, submission.reason); reason.textContent = `${hint.title} ${hint.fix}${hint.detail ? ` Chi tiết: ${hint.detail}` : ''}`;
  } else {
    reason.textContent = 'Bot được kiểm tra bằng hai ván thử. Chỉ cần chạy đúng luật và trong thời gian cho phép, không bắt buộc thắng. Hai ván này không tính điểm.';
  }
  const technicalError = document.getElementById('submission-error');
  technicalError.hidden = !submission.reason;
  technicalError.textContent = submission.reason ? `${submission.reason_code || ''}: ${submission.reason}` : '';
  const stages = ['Queued','Scanning','Compiling','Test match', submission.status === 'Rejected' ? 'Rejected' : 'Accepted'];
  const current = stages.indexOf(submission.status), pipeline = document.getElementById('submission-pipeline'); pipeline.replaceChildren();
  const lastScan = submission.events.findLastIndex(event => event.stage === 'Scanning');
  const reached = Math.max(0, ...submission.events.slice(Math.max(0, lastScan)).map(event => stages.slice(0, 4).indexOf(event.stage)));
  stages.forEach((stage, i) => {
    const item = document.createElement('li'); item.textContent = submissionLabels[stage] || stage;
    item.className = submission.status === 'Rejected' ? (i === reached || stage === 'Rejected' ? 'failed' : i < reached ? 'done' : '')
      : i < current || submission.status === 'Accepted' ? 'done' : i === current ? 'current' : '';
    pipeline.append(item);
  });
  const tests = document.getElementById('submission-tests'); tests.replaceChildren();
  for (const [i, match] of submission.tests.entries()) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `Xem trận thử ${i + 1} · Bạn ở bên ${match.candidate_player}`;
    button.addEventListener('click', async () => {
      try { showReplay(await api(`/api/portal/submissions/${encodeURIComponent(id)}/tests/${encodeURIComponent(match.id)}`)); }
      catch (error) { submissionMessage.textContent = error.message; }
    }); tests.append(button);
  }
  document.getElementById('submission-events').textContent = submission.events.map(event => `${new Date(event.created_at).toLocaleTimeString('vi-VN')} [${submissionLabels[event.stage] || event.stage}] ${event.message}${event.details ? '\n' + JSON.stringify(event.details, null, 2) : ''}`).join('\n\n');
}
