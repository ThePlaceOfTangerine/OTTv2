const el = id => document.getElementById(id);
const textNode = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
function action(text, callback) { const button = textNode('button', text); button.type = 'button'; button.addEventListener('click', async () => { button.disabled = true; try { await callback(); } catch (error) { message.textContent = error.message; } finally { button.disabled = false; } }); return button; }
const postAdmin = (url, body = {}) => api(url, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) });
function table(target, headers, rows) { const t = document.createElement('table'), head = document.createElement('tr'); headers.forEach(h => head.append(textNode('th', h))); t.append(head); rows.forEach(values => { const row = document.createElement('tr'); values.forEach(value => { const td = document.createElement('td'); td.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—'))); row.append(td); }); t.append(row); }); target.replaceChildren(t); }
function credentials(data) { el('credentials').hidden = el('clear-credentials').hidden = false; el('credentials').textContent = ['username,password', ...data.map(u => `${u.username},${u.password}`)].join('\n'); }
el('clear-credentials').onclick = () => { el('credentials').textContent = ''; el('credentials').hidden = el('clear-credentials').hidden = true; };
el('import-users').onsubmit = async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { credentials((await postAdmin('/api/admin/users/import', { csv: el('users-csv').value })).credentials); el('users-csv').value = ''; await loadUsers(); } catch (error) { message.textContent = error.message; } finally { button.disabled = false; } };
async function loadUsers() {
  const { users } = await api('/api/admin/users');
  const eligible = users.filter(u => !u.locked && u.version).length;
  el('score-eligibility').textContent = `Hiện có ${eligible} bot đủ điều kiện.${eligible < 2 ? ' Cần thêm một tài khoản không bị khóa có bot đã vượt qua kiểm tra và đang được chọn.' : ''}`;
  table(el('users-list'), ['Tài khoản', 'Phiên bản đang chọn', 'Trạng thái', 'Thao tác'], users.map(u => {
    const buttons = document.createElement('div'); buttons.className = 'admin-actions';
    buttons.append(action(u.locked ? 'Mở khóa' : 'Khóa', async () => { await postAdmin(`/api/admin/users/${u.id}/lock`, { locked: !u.locked }); await loadUsers(); }), action('Cấp lại mật khẩu', async () => { credentials([await postAdmin(`/api/admin/users/${u.id}/reset`)]); }));
    return [u.username, u.version ? `v${u.version}` : 'Chưa có', u.locked ? 'Đã khóa' : 'Đang mở', buttons];
  }));
}
let liveTimer;
async function watchLive(url) {
  clearTimeout(liveTimer); const match = await api(url); showReplay(match);
  if (match.status === 'running' && match.replay) { replaySlider.value = match.replay.turns.length; renderReplay(); }
  if (!match.replay?.result && match.status === 'running') liveTimer = setTimeout(() => watchLive(url).catch(e => { message.textContent = e.message; }), 1500);
}
let jobPage = 0;
async function loadMonitor() {
  const [data, live] = await Promise.all([api(`/api/admin/monitor?page=${jobPage}`), api('/api/admin/live')]);
  el('worker-status').textContent = `Bộ xử lý bài nộp: ${data.worker.started ? 'đang hoạt động' : 'chưa khởi động'} · ${data.worker.active.length}/${data.worker.capacity} vị trí xử lý · ` + data.queue.map(q => `${jobLabels[q.job_status] || q.job_status}${q.error_type ? (q.error_type === 'system' ? ' / lỗi máy chủ' : ' / lỗi bot') : ''}: ${q.count}`).join(' · ') + ` | Bộ xử lý trận tính điểm: ${data.scoringWorker.active}/${data.scoringWorker.capacity} vị trí xử lý · ` + data.scoringQueue.map(q => `${statusLabels[q.status] || q.status}: ${q.count}`).join(' · ');
  table(el('jobs-list'), ['Thí sinh / bản', 'Bước kiểm tra', 'Tiến trình / lần chạy', 'Lỗi', 'Chi tiết'], data.jobs.map(j => [j.username + ' / v' + j.version, submissionLabels[j.status] || j.status, (jobLabels[j.job_status] || j.job_status) + ' / ' + j.attempts, j.error_type === 'system' ? 'Máy chủ: ' + j.reason : j.error_type === 'bot' ? 'Bot: ' + j.reason : '—', action('Xem nhật ký', async () => {
    const detail = await api(`/api/admin/submissions/${j.id}`); el('admin-job-detail').textContent = JSON.stringify(detail, null, 2); el('admin-job-detail').parentElement.open = true; el('admin-job-tests').replaceChildren();
    detail.tests.forEach(t => el('admin-job-tests').append(action(`Xem trận thử bên ${t.candidate_player}`, async () => { clearTimeout(liveTimer); showReplay(await api(`/api/admin/submissions/${j.id}/tests/${t.id}`)); })));
    if (j.job_status === 'blocked') el('admin-job-tests').append(action('Chạy lại sau lỗi máy chủ', async () => { await postAdmin(`/api/admin/submissions/${j.id}/retry`); await loadMonitor(); }));
  })]));
  if (jobPage > 0) el('jobs-list').append(action('Bài nộp trước', async () => { jobPage--; await loadMonitor(); }));
  if ((jobPage + 1) * 100 < data.total) el('jobs-list').append(action('Bài nộp tiếp theo', async () => { jobPage++; await loadMonitor(); }));
  el('live-list').replaceChildren();
  for (const m of live.matches) el('live-list').append(action(`Xem trực tiếp · ${{submission:'Kiểm tra bài nộp',practice:'Trận bot mẫu'}[m.kind] || m.kind} · ${m.id.slice(0, 8)}`, () => watchLive(`/api/admin/live/${m.id}`)));
  for (const m of live.scoring) el('live-list').append(action(`Xem trận tính điểm · ván ${m.sequence + 1}`, () => watchLive(`/api/admin/score-matches/${m.id}`)));
}
let matchPage = 0;
async function loadScores() {
  const { rounds } = await api('/api/scores'), selected = el('score-round').value;
  el('score-round').replaceChildren(...rounds.map(r => { const option = textNode('option', `${r.seed} · ${new Date(r.created_at).toLocaleString('vi-VN')} · ${statusLabels[r.status] || r.status}`); option.value = r.id; return option; }));
  if (rounds.some(r => r.id === selected)) el('score-round').value = selected;
  if (!rounds.length) { el('score-status').textContent = 'Chưa có vòng tính điểm. Ban tổ chức cần ít nhất hai tài khoản không bị khóa có bot đã vượt qua kiểm tra và đang được chọn để tạo vòng.'; return; }
  await loadScoreDetail();
}
async function loadScoreDetail() {
  const id = el('score-round').value; if (!id) return;
  const round = await api(`/api/scores/${id}?page=${matchPage}`);
  el('score-status').textContent = `${round.status === 'finished' ? 'Hoàn tất' : 'Đang chạy'} · ` + round.counts.map(c => `${statusLabels[c.status] || c.status}: ${c.count}`).join(' · ');
  table(el('standings'), ['Hạng', 'Thí sinh', 'Phiên bản bot', 'Elo', 'Điểm', 'Số ván', 'Thắng / Hòa / Thua'], round.standings.map((e, i) => [i + 1, e.username, 'v' + e.version, e.rating.toFixed(2), e.points, e.played, `${e.wins} / ${e.draws} / ${e.losses}`]));
  el('score-actions').replaceChildren();
  if (admin) {
    const link = textNode('a', 'Tải bảng điểm CSV'); link.href = `/api/admin/scores/${id}/export`; el('score-actions').append(link);
    el('score-actions').append(textNode('span', `Trang trận ${matchPage + 1} / ${Math.max(1, Math.ceil(round.total / 200))}`));
    if (matchPage > 0) el('score-actions').append(action('Trang trước', async () => { matchPage--; await loadScoreDetail(); }));
    if ((matchPage + 1) * 200 < round.total) el('score-actions').append(action('Trang sau', async () => { matchPage++; await loadScoreDetail(); }));
    if (round.counts.some(c => c.status === 'blocked')) el('score-actions').append(action('Chạy lại sau lỗi máy chủ', async () => { await postAdmin(`/api/admin/scores/${id}/retry`); await loadScoreDetail(); }));
    const names = new Map(round.standings.map(e => [e.user_id, e.username]));
    table(el('score-matches'), ['Ván', 'Cặp đấu', 'Trạng thái', 'Lỗi máy chủ', 'Xem'], round.matches.map(m => [m.sequence + 1, `${names.get(m.player0)} gặp ${names.get(m.player1)}`, `${statusLabels[m.status] || m.status}${m.scored ? ' · đã tính điểm' : ''}`, m.error || '—', action('Xem trận', () => watchLive(`/api/admin/score-matches/${m.id}`))]));
  }
}
el('score-form').onsubmit = async event => { event.preventDefault(); el('score-message').textContent = '';  event.submitter.disabled = true; try { const { id } = await postAdmin('/api/admin/scores', { seed: el('score-seed').value, gamesPerBot: Number(el('score-games').value), gamesPerPair: Number(el('score-pair').value) }); matchPage = 0; await loadScores(); el('score-round').value = id; await loadScoreDetail(); } catch (error) { el('score-message').textContent = error.message; } finally { event.submitter.disabled = false; } };
el('score-round').onchange = () => { matchPage = 0; loadScoreDetail().catch(e => { message.textContent = e.message; }); };
el('refresh-scores').onclick = () => loadScores().catch(e => { message.textContent = e.message; });
el('refresh-monitor').onclick = () => loadMonitor().catch(e => { message.textContent = e.message; });
async function startAdminTools() {
  el('scores-panel').hidden = false;
  if (admin) { el('admin-tools').hidden = false; await Promise.all([loadUsers(), loadMonitor()]); }
  await loadScores();
  setInterval(() => { if (document.hidden) return; Promise.all([loadScoreDetail(), ...(admin ? [loadMonitor()] : [])]).catch(e => { message.textContent = e.message; }); }, 5000);
}
