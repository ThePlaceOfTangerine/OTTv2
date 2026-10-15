const admin = location.pathname.startsWith('/admin');
document.getElementById('resources-panel').hidden = admin;
const panel = document.getElementById('login-panel');
const dashboard = document.getElementById('dashboard');
const message = document.getElementById('message');
let csrfToken;
document.getElementById('area').textContent = admin ? 'KHU VỰC QUẢN TRỊ' : 'KHU VỰC THÍ SINH';
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
  document.getElementById('dashboard-help').textContent = admin ? 'Quản lý tài khoản, theo dõi bài nộp và tổ chức các vòng tính điểm. Khu chạy thử bot mẫu dùng để kiểm tra máy chủ, không tính điểm xếp hạng.' : 'Nộp mã nguồn bot, theo dõi kết quả kiểm tra và xem lại trận thử. Kết quả thi đấu chính thức xuất hiện sau khi ban tổ chức tạo vòng tính điểm.';
  document.getElementById('open-password').hidden = admin || data.user.mustChangePassword;
  if (data.user.mustChangePassword) {
    document.getElementById('heading').textContent = 'Đặt mật khẩu riêng.';
    document.getElementById('overview').textContent = 'Cần đổi mật khẩu được cấp trước khi sử dụng tài khoản.';
    document.getElementById('password-panel').hidden = false;
    return;
  }
  const overview = await api(`/api/${admin ? 'admin' : 'portal'}/overview`);
  document.getElementById('overview').textContent = admin ? `${overview.contestants} thí sinh · ${overview.locked} tài khoản bị khóa` : 'Tài khoản thí sinh đang hoạt động.';
  if (admin) { document.getElementById('admin-guide').hidden = false; document.getElementById('match-panel').hidden = false; await loadMatches(); }
  else { document.getElementById('submission-panel').hidden = false; await loadSubmissions(); }
  await startAdminTools();
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
const matchReasonLabels = { reached_home: 'Chiếm nhà đối thủ', eliminated: 'Ăn hết quân đối thủ', no_legal_moves: 'Đối thủ không còn nước đi hợp lệ', repetition: 'Lặp cùng thế cờ và bên đến lượt ba lần', move_limit: 'Đạt giới hạn số nước đi', bot_crash: 'Chương trình bot gặp lỗi khi chạy', cpu_timeout: 'Bot vượt thời gian CPU cho một nước', total_cpu_timeout: 'Bot vượt tổng thời gian CPU của trận', wall_timeout: 'Bot không phản hồi trong thời gian cho phép', illegal_move: 'Bot trả nước đi không hợp lệ', invalid_output: 'Bot trả dữ liệu không đúng định dạng', output_limit: 'Bot xuất quá nhiều dữ liệu', userdata_limit: 'Dữ liệu ghi nhớ vượt giới hạn', sandbox_violation: 'Bot thực hiện thao tác bị cấm' };
document.getElementById('check-sandbox').addEventListener('click', async event => {
  const status = document.getElementById('sandbox-status'); event.target.disabled = true; status.textContent = 'Đang kiểm tra khả năng chạy bot và các cơ chế cách ly…';
  try { const data = await api('/api/admin/sandbox'); status.textContent = `Máy chủ sẵn sàng chạy bot. Đã kiểm tra cơ chế chặn thao tác hệ thống và đọc file ngoài phạm vi cho phép (Landlock ABI ${data.landlock_abi}, seccomp).`; }
  catch (error) { status.textContent = `Môi trường chạy bot chưa sẵn sàng: ${error.message}`; }
  finally { event.target.disabled = false; }
});
document.getElementById('match-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = document.getElementById('run-match'); button.disabled = true; message.textContent = '';
  try {
    await api('/api/admin/matches', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ botA: document.getElementById('bot-a').value, botB: document.getElementById('bot-b').value, seed: document.getElementById('match-seed').value }) });
    await loadMatches();
  } catch (error) { message.textContent = error.message; button.disabled = false; }
});
async function loadMatches() {
  clearTimeout(pollTimer);
  const data = await api('/api/admin/matches');
  const list = document.getElementById('match-list'); list.replaceChildren();
  document.getElementById('run-match').disabled = data.matches.some(match => match.status === 'running');
  if (!data.matches.length) list.textContent = 'Chưa có trận thử.';
  for (const match of data.matches) {
    const row = document.createElement('div'); row.className = 'match-row';
    const info = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('p');
    title.textContent = `${match.bots.join(' gặp ')} · ${statusLabels[match.status]}`;
    detail.textContent = `Chuỗi khởi tạo: ${match.seed} · Lần chạy: ${match.attempts}${match.error ? ' · ' + match.error.message : ''}`;
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
  document.getElementById('replay-result').textContent = !replay.result ? `Đang thi đấu · ${replay.turns.length} nước` : `${replay.result.winner === null ? 'Hòa' : `Bên ${replay.result.winner} thắng`} · ${matchReasonLabels[replay.result.winReason] || replay.result.winReason} · ${replay.turns.length} nước · CPU bên 0 / bên 1: ${replay.cpu_ms.map(n => Math.round(n) + ' ms').join(' / ')}`;
  renderReplay();
}
function updatePlaybackLabel() {
  replayPlay.textContent = replayTimer !== null ? '❚❚ Tạm dừng' : replay && Number(replaySlider.value) >= replay.turns.length && replay.turns.length ? '▶ Phát lại' : '▶ Tự động chạy';
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
function renderReplay() {
  if (!replay) return;
  const turn = Number(document.getElementById('replay-turn').value);
  document.getElementById('replay-turn-label').textContent = `${turn}/${replay.turns.length}`;
  const board = structuredClone(replay.initial.board);
  const captures = new Set();
  replay.turns.slice(0, turn).forEach(({ move: m }, i) => {
    if (board[m.toRow][m.toCol]) captures.add(i);
    board[m.toRow][m.toCol] = board[m.fromRow][m.fromCol]; board[m.fromRow][m.fromCol] = null;
  });
  const n = replay.rules.boardSize;
  const last = turn ? replay.turns[turn - 1] : null;
  const element = document.getElementById('replay-board'); element.replaceChildren();
  document.getElementById('replay-chess-wrap').style.setProperty('--board-size', n);
  const columnName = index => { let label = ''; for (let v = index + 1; v; v = Math.floor((v - 1) / 26)) label = String.fromCharCode(65 + (v - 1) % 26) + label; return label; };
  for (const id of ['replay-col-top', 'replay-col-bottom', 'replay-row-left', 'replay-row-right']) {
    const strip = document.getElementById(id); strip.replaceChildren();
    for (let i = 0; i < n; i++) { const label = document.createElement('span'); label.className = 'clabel'; label.textContent = id.includes('col-') ? columnName(i) : n - i; strip.append(label); }
  }
  const images = { R: '/img/rock.png', P: '/img/paper.png', S: '/img/scissor.png' };
  const labels = { R: 'Búa', P: 'Bao', S: 'Kéo' };
  const counts = [{}, {}];
  board.forEach((row, r) => row.forEach((piece, c) => {
    const cell = document.createElement('div'); cell.className = `cell ${(r + c) % 2 === 0 ? 'light-sq' : 'dark-sq'}`;
    cell.title = `${columnName(c)}${n - r}${piece ? ` · Bên ${piece.player} · ${labels[piece.type] || piece.type}` : ''}`;
    if (piece) {
      counts[piece.player][piece.type] = (counts[piece.player][piece.type] || 0) + 1;
      const token = document.createElement('div'); token.className = `piece p${piece.player}`;
      if (images[piece.type]) { const img = document.createElement('img'); img.src = images[piece.type]; img.alt = labels[piece.type]; token.append(img); }
      else token.textContent = piece.type;
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
    ? `🏆 ${replay.result.winner === null ? 'Hòa' : `Bên ${replay.result.winner} thắng`} · ${reasons[replay.result.winReason] || replay.result.winReason}`
    : `▶ Lượt bên ${currentPlayer} · ${botName(currentPlayer)}`;
  const log = document.getElementById('replay-move-log'); log.replaceChildren();
  if (!turn) { const empty = document.createElement('p'); empty.className = 'log-empty'; empty.textContent = 'Chưa có nước đi.'; log.append(empty); }
  replay.turns.slice(0, turn).map((entry, i) => ({ entry, i, m: entry.move })).reverse().forEach(({ entry, i, m }) => {
    const item = document.createElement('div'); item.className = 'log-entry';
    const player = document.createElement('span'); player.className = `pt p${entry.player}`; player.textContent = `Bên ${entry.player}`;
    item.append(document.createTextNode(`${i + 1}. `), player, document.createTextNode(` ${columnName(m.fromCol)}${n - m.fromRow} → ${columnName(m.toCol)}${n - m.toRow}`));
    if (captures.has(i)) item.append(document.createTextNode(' 💥'));
    log.append(item);
  });
}

let submissionPoll = null, selectedSubmission = null;
const submissionLabels = { Queued: 'Chờ kiểm tra (Queued)', Scanning: 'Kiểm tra mã (Scanning)', Compiling: 'Chuẩn bị chương trình (Compiling)', 'Test match': 'Đấu thử (Test match)', Accepted: 'Hợp lệ (Accepted)', Rejected: 'Cần sửa (Rejected)' };
const submissionHints = {
 static_scan: 'Bỏ các import/include hoặc thao tác bị cấm được nêu trong lý do.',
 compile_error: 'Kiểm tra cú pháp và tên file. Với C++, dùng chuẩn C++17; mở nhật ký để xem lỗi biên dịch cụ thể.',
 bot_crash: 'Bot bị dừng khi chạy. Kiểm tra dữ liệu đầu vào, chỉ số mảng và lỗi ngoại lệ; xem stderr (nhật ký của chương trình) trong thông tin trận.',
 cpu_timeout: 'Bot tính quá lâu trong một nước. Giảm số nhánh tìm kiếm hoặc độ sâu.',
 total_cpu_timeout: 'Bot dùng hết tổng thời gian CPU cho cả trận. Giảm thời gian tính ở mỗi lượt.',
 wall_timeout: 'Bot phản hồi quá chậm. Chỉ đọc một dòng đầu vào, trả một dòng JSON và kết thúc; không chờ thêm dữ liệu.',
 invalid_output: 'Đầu ra cần đúng một dòng JSON theo mẫu. Không in lời chào hoặc thông tin gỡ lỗi ra stdout (đầu ra chuẩn); giữ nguyên request_id.',
 output_limit: 'Bot in quá nhiều dữ liệu. Giảm nội dung stdout và stderr.',
 illegal_move: 'Chọn trực tiếp một phần tử trong legal_moves và giữ đúng bốn tọa độ.',
 userdata_limit: 'Giảm dữ liệu ghi nhớ userdata xuống tối đa 16 KiB.'
};
const submissionMessage = document.getElementById('submission-message');
document.getElementById('submission-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = document.getElementById('submit-bot'); button.disabled = true; submissionMessage.textContent = '';
  try {
    const file = document.getElementById('bot-file').files[0];
    if (!file) throw new Error('Hãy chọn file bot.');
    if (file.size > (file.name.endsWith('.zip') ? 5 : 1) * 1024 * 1024) throw new Error('Một file mã nguồn tối đa 1 MiB; file ZIP tối đa 5 MiB.');
    const form = new FormData(); form.append('bot', file);
    const entry = document.getElementById('bot-entry').value.trim(); if (entry) form.append('entry', entry);
    const result = await api('/api/portal/submissions', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: form });
    selectedSubmission = result.id; document.getElementById('bot-file').value = '';
    submissionMessage.textContent = `Đã nhận phiên bản v${result.version}. Theo dõi kết quả trong lịch sử phiên bản; trang sẽ tự cập nhật.`;
    await loadSubmissions();
  } catch (error) { submissionMessage.textContent = error.message; }
  finally { button.disabled = false; }
});
async function submissionAction(id, action) {
  try {
    await api(`/api/portal/submissions/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
    submissionMessage.textContent = action === 'activate' ? 'Đã chọn phiên bản bot cho các vòng mới. Vòng đang thi đấu vẫn dùng phiên bản đã chốt.' : 'Đã đưa bài trở lại hàng đợi.';
    await loadSubmissions();
  } catch (error) { submissionMessage.textContent = error.message; }
}
async function loadSubmissions() {
  clearTimeout(submissionPoll);
  const data = await api('/api/portal/submissions');
  const list = document.getElementById('submission-list'); list.replaceChildren();
  if (!data.submissions.length) list.textContent = 'Bạn chưa nộp bot. Tải mã mẫu Python hoặc C++ phía trên để bắt đầu.';
  for (const submission of data.submissions) {
    const row = document.createElement('div'); row.className = 'submission-row';
    const info = document.createElement('div'), title = document.createElement('strong'); title.textContent = `v${submission.version} · ${submission.filename}`;
    const badge = document.createElement('span'); badge.className = `status-badge ${submission.status.toLowerCase().replace(' ', '-')}`; badge.textContent = submissionLabels[submission.status] || submission.status;
    info.append(title, badge);
    if (submission.active) { const active = document.createElement('span'); active.className = 'status-badge active'; active.textContent = 'ĐANG CHỌN · ACTIVE'; info.append(active); }
    const language = submission.language || (submission.filename.endsWith('.py') ? 'python' : submission.filename.endsWith('.cpp') ? 'cpp' : submission.status === 'Rejected' ? 'Không xác định' : 'Đang nhận dạng');
    const detail = document.createElement('p'); detail.textContent = `${language} · Lần kiểm tra: ${submission.attempts}${submission.error_type === 'system' ? ' · Lỗi máy chủ, không quy thành lỗi bot' : ''}${submission.reason ? ' · ' + submission.reason : ''}`; info.append(detail);
    const actions = document.createElement('div'); actions.className = 'submission-actions';
    const view = document.createElement('button'); view.type = 'button'; view.textContent = 'Chi tiết & trận thử';
    view.addEventListener('click', () => { selectedSubmission = submission.id; loadSubmissionDetail().catch(error => { submissionMessage.textContent = error.message; }); }); actions.append(view);
    if (submission.status === 'Accepted' && !submission.active) { const activate = document.createElement('button'); activate.type = 'button'; activate.textContent = 'Dùng bản này cho vòng mới'; activate.addEventListener('click', () => submissionAction(submission.id, 'activate')); actions.append(activate); }
    if (submission.job_status === 'blocked' && submission.error_type === 'system') { const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Thử lại'; retry.addEventListener('click', () => submissionAction(submission.id, 'retry')); actions.append(retry); }
    row.append(info, actions); list.append(row);
  }
  if (selectedSubmission) await loadSubmissionDetail();
  if (data.submissions.some(submission => ['queued','running'].includes(submission.job_status))) submissionPoll = setTimeout(() => loadSubmissions().catch(error => { submissionMessage.textContent = error.message; }), 1000);
}
async function loadSubmissionDetail() {
  if (!selectedSubmission) return;
  const id = selectedSubmission;
  const submission = await api(`/api/portal/submissions/${encodeURIComponent(id)}`);
  if (selectedSubmission !== id) return;
  document.getElementById('submission-detail').hidden = false;
  document.getElementById('submission-title').textContent = `Phiên bản v${submission.version} · ${submissionLabels[submission.status] || submission.status}${submission.active ? ' · ĐANG CHỌN' : ''}`;
  document.getElementById('submission-reason').textContent = submission.reason ? `${submission.error_type === 'system' ? 'Lỗi máy chủ: ' : 'Lý do: '}${submission.reason}` : 'Hai ván kiểm tra không tính điểm xếp hạng. Bot cần chạy đúng giao thức, đi đúng luật và đáp ứng giới hạn chạy; không cần thắng bot mẫu.';
  if (submission.error_type === 'system') document.getElementById('submission-reason').textContent += submission.job_status === 'blocked' ? '\nMáy chủ đã chạy thử tổng cộng 3 lần nhưng chưa hoàn tất. Bấm “Thử lại” hoặc báo ban tổ chức; thông báo này không yêu cầu sửa mã nguồn.' : '\nHệ thống sẽ tự thử lại. Không cần nộp thêm cùng một bài.';
  else if (submission.status === 'Rejected') document.getElementById('submission-reason').textContent += '\nGợi ý: ' + (submissionHints[submission.reason_code] || 'Đọc lý do và nhật ký, sửa file rồi nộp phiên bản mới.');
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
  document.getElementById('submission-events').textContent = submission.events.map(event => `${new Date(event.created_at).toLocaleTimeString('vi-VN')} [${event.stage}] ${event.message}${event.details ? '\n' + JSON.stringify(event.details, null, 2) : ''}`).join('\n\n');
}
