const el = id => document.getElementById(id);
const textNode = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
function action(text, callback) { const button = textNode('button', text); button.type = 'button'; button.addEventListener('click', async () => { button.disabled = true; try { await callback(); } catch (error) { message.textContent = error.message; } finally { button.disabled = false; } }); return button; }
const postAdmin = (url, body = {}) => api(url, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) });
function table(target, headers, rows) {
  const t = document.createElement('table'), thead = document.createElement('thead'), head = document.createElement('tr'), body = document.createElement('tbody');
  headers.forEach(h => { const th = textNode('th', h); th.scope = 'col'; head.append(th); });
  thead.append(head); t.append(thead, body);
  rows.forEach(values => {
    const row = document.createElement('tr');
    values.forEach(value => { const td = document.createElement('td'); td.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—'))); row.append(td); });
    body.append(row);
  });
  target.setAttribute('role', 'region');
  target.setAttribute('aria-label', headers.join(', '));
  target.replaceChildren(t);
  const updateOverflow = () => {
    const overflow = target.scrollWidth > target.clientWidth;
    target.dataset.overflow = String(overflow);
    if (overflow) target.tabIndex = 0; else target.removeAttribute('tabindex');
  };
  if (!target.tableObserver) { target.tableObserver = new ResizeObserver(updateOverflow); target.tableObserver.observe(target); }
  requestAnimationFrame(updateOverflow);
}
function credentials(data) { el('credentials').hidden = el('clear-credentials').hidden = false; el('credentials').textContent = ['username,password', ...data.map(u => `${u.username},${u.password}`)].join('\n'); }
el('clear-credentials').onclick = () => { el('credentials').textContent = ''; el('credentials').hidden = el('clear-credentials').hidden = true; };
el('import-users').onsubmit = async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { credentials((await postAdmin('/api/admin/users/import', { csv: el('users-csv').value })).credentials); el('users-csv').value = ''; await loadUsers(); } catch (error) { message.textContent = error.message; } finally { button.disabled = false; } };
async function loadUsers() {
  const { users } = await api('/api/admin/users');
  adminUsers = users;
  el('overview').textContent=`${users.length} thí sinh · ${users.filter(u=>u.locked).length} tài khoản bị khóa`;
  const eligible = users.filter(u => !u.locked && u.version).length;
  el('score-eligibility').textContent = `Hiện có ${eligible} bot đủ điều kiện.${eligible < 2 ? ' Cần thêm một tài khoản không bị khóa có bot đã vượt qua kiểm tra và đang được chọn.' : ''}`;
  renderUsers();
  await loadScorePlan();
}
let scorePlanBusy=false,scoreManualInitialized=false;
async function loadScorePlan(){
  const plan=await api('/api/admin/score-plan'),target=el('score-plan');
  el('score-eligibility').textContent=`Hiện có ${plan.eligible} bot đủ điều kiện.`;
  const text=plan.total?`${plan.eligible} bot · ${plan.total} ván tổng cộng · ${plan.gamesPerBot} ván mỗi bot`:plan.message;
  if(target.dataset.summary!==text){
    target.dataset.summary=text;
    target.replaceChildren(...(plan.total?[[plan.eligible,'Bot tham gia'],[plan.total,'Ván trong vòng'],[plan.gamesPerBot,'Ván mỗi bot']].map(([number,label])=>{const card=document.createElement('div');card.append(textNode('strong',number),textNode('span',label));return card;}):[textNode('p',text)]));
  }
  el('score-plan-note').textContent=plan.message||`Mỗi bot gặp ${plan.opponents} đối thủ. Mỗi cặp đấu 6 ván: mỗi bên đi trước 3 ván. Luật Classic; không tự đấu thêm khi bằng điểm.`;
  el('create-score-round').disabled=scorePlanBusy||!plan.canStart;
  if(!scoreManualInitialized&&plan.gamesPerBot){el('score-games').value=plan.gamesPerBot;scoreManualInitialized=true;}
}
el('score-advanced').addEventListener('toggle',()=>{
  const manual=el('score-advanced').open;
  for(const id of ['score-seed','score-games','score-pair'])el(id).disabled=!manual;
  el('score-mode-note').textContent=manual?'Dùng thiết lập nâng cao bạn đã nhập':'Dùng lịch tự động · 6 ván mỗi cặp';
});
el('refresh-score-plan').onclick=()=>loadUsers().catch(e=>{el('score-message').textContent=e.message;});
let adminUsers = [], userPage = 0, deletingUser = null;
function userIdentity(user) {
  const box = document.createElement('div'); box.className = 'user-identity';
  const avatar = textNode('span', String(user.id).padStart(2,'0')); avatar.className = 'user-avatar'; avatar.setAttribute('aria-hidden','true');
  const info = document.createElement('div'); info.append(textNode('strong', user.username), textNode('small', `Thí sinh #${String(user.id).padStart(4,'0')}`)); box.append(avatar,info); return box;
}
function pagination(target, page, total, size, change) {
  target.replaceChildren(); if(total<=size)return;
  const prev=action('Trang trước',()=>change(page-1)), next=action('Trang sau',()=>change(page+1)); prev.disabled=page===0;next.disabled=(page+1)*size>=total;
  target.append(prev,textNode('span',`${page+1} / ${Math.ceil(total/size)}`),next);
}
function renderUsers() {
  const search=el('user-search').value.trim().toLowerCase(), filter=el('user-filter').value;
  const users=adminUsers.filter(u=>(u.username.toLowerCase().includes(search)||`#${String(u.id).padStart(4,'0')}`.includes(search)) && (filter==='all'||filter==='ready'&&!u.locked&&u.version||filter==='empty'&&!u.accepted||filter==='locked'&&u.locked));
  userPage=Math.min(userPage,Math.max(0,Math.ceil(users.length/25)-1));
  el('user-count').textContent=`${users.length} / ${adminUsers.length} thí sinh`;
  table(el('users-list'), ['Thí sinh', 'Bot', 'Trạng thái', 'Thao tác'], users.slice(userPage*25,(userPage+1)*25).map(u => {
    const buttons = document.createElement('div'); buttons.className = 'admin-actions';
    const remove=action('Xóa',()=>{deletingUser=u;el('delete-user-description').textContent=`Xóa thí sinh ${u.username} (#${u.id}). Nhập tên tài khoản để xác nhận.`;el('delete-user-name').value='';el('delete-user-error').textContent='';el('delete-user-dialog').showModal();el('delete-user-name').focus();});remove.className='danger';
    buttons.append(action(u.locked ? 'Mở khóa' : 'Khóa', async () => { await postAdmin(`/api/admin/users/${u.id}/lock`, { locked: !u.locked }); await loadUsers(); await loadMatches(); }), action('Cấp lại mật khẩu', async () => { credentials([await postAdmin(`/api/admin/users/${u.id}/reset`)]); }),remove);
    return [userIdentity(u), u.version ? `Đang dùng v${u.version} · ${u.accepted} bản hợp lệ` : 'Chưa chọn bot', u.locked ? 'Đã khóa' : 'Đang mở', buttons];
  }));
  if(!users.length)el('users-list').replaceChildren(textNode('p','Không có thí sinh phù hợp.'));
  pagination(el('user-pagination'),userPage,users.length,25,page=>{userPage=page;renderUsers();});
}
for(const id of ['user-search','user-filter'])el(id).addEventListener('input',()=>{userPage=0;renderUsers();});
el('delete-user-cancel').onclick=()=>el('delete-user-dialog').close();
el('delete-user-form').onsubmit=async event=>{
  event.preventDefault();const button=el('delete-user-confirm');button.disabled=true;
  try {await api(`/api/admin/users/${deletingUser.id}`,{method:'DELETE',headers:{'X-CSRF-Token':csrfToken},body:JSON.stringify({username:el('delete-user-name').value})});el('delete-user-dialog').close();await loadUsers();await loadMatches();message.textContent='Đã xóa tài khoản thí sinh.';}
  catch(error){el('delete-user-error').textContent=error.message;}finally{button.disabled=false;}
};
let liveTimer;
async function watchLive(url) {
  clearTimeout(liveTimer); const match = await api(url); showReplay(match);
  if (match.status === 'running' && match.replay) { replaySlider.value = match.replay.turns.length; renderReplay(); }
  if (!match.replay?.result && match.status === 'running') liveTimer = setTimeout(() => watchLive(url).catch(e => { message.textContent = e.message; }), 1500);
}
let jobPage = 0;
async function loadMonitor() {
  const [data, live] = await Promise.all([api(`/api/admin/monitor?page=${jobPage}`), api('/api/admin/live')]);
  const jobs=status=>data.queue.filter(q=>q.job_status===status).reduce((n,q)=>n+q.count,0);
  el('monitor-summary').replaceChildren(...[[jobs('running'),'Đang kiểm tra'],[jobs('queued'),'Đang chờ'],[jobs('blocked'),'Cần xử lý'],[data.scoringWorker.active,'Trận điểm đang chạy']].map(([count,label])=>{const card=document.createElement('div');card.className='monitor-metric';card.append(textNode('strong',count),textNode('span',label));return card;}));
  el('worker-status').textContent = `Bài nộp: ${jobs('running')} đang kiểm tra · ${jobs('queued')} đang chờ · ${jobs('blocked')} cần xử lý lỗi. Trận tính điểm: ${data.scoringWorker.active} đang chạy.${data.worker.started?'':' Bộ kiểm tra bài chưa khởi động.'}`;
  table(el('jobs-list'), ['Thí sinh / bản', 'Bước kiểm tra', 'Tiến trình / lần chạy', 'Lỗi', 'Chi tiết'], data.jobs.map(j => [j.username + ' / v' + j.version, submissionLabels[j.status] || j.status, (jobLabels[j.job_status] || j.job_status) + ' / ' + j.attempts, j.error_type === 'system' ? 'Máy chủ: ' + j.reason : j.error_type === 'bot' ? 'Bot: ' + j.reason : '—', action('Xem nhật ký', async () => {
    const detail = await api(`/api/admin/submissions/${j.id}`); el('admin-job-detail').textContent = JSON.stringify(detail, null, 2); el('admin-job-detail').parentElement.open = true; el('admin-job-tests').replaceChildren();
    detail.tests.forEach(t => el('admin-job-tests').append(action(`Xem trận thử bên ${t.candidate_player}`, async () => { clearTimeout(liveTimer); showReplay(await api(`/api/admin/submissions/${j.id}/tests/${t.id}`)); })));
    if (j.job_status === 'blocked') el('admin-job-tests').append(action('Chạy lại sau lỗi máy chủ', async () => { await postAdmin(`/api/admin/submissions/${j.id}/retry`); await loadMonitor(); }));
  })]));
  if (jobPage > 0) el('jobs-list').append(action('Bài nộp trước', async () => { jobPage--; await loadMonitor(); }));
  if ((jobPage + 1) * 100 < data.total) el('jobs-list').append(action('Bài nộp tiếp theo', async () => { jobPage++; await loadMonitor(); }));
  el('live-list').replaceChildren();
  for (const m of live.matches) el('live-list').append(action(`Xem trực tiếp · ${{submission:'Kiểm tra bài nộp',practice:'Đấu thử theo luật'}[m.kind] || m.kind} · ${m.id.slice(0, 8)}`, () => watchLive(`/api/admin/live/${m.id}`)));
  for (const m of live.scoring) el('live-list').append(action(`Xem trận tính điểm · ván ${m.sequence + 1}`, () => watchLive(`/api/admin/score-matches/${m.id}`)));
}
let matchPage = 0;
async function loadScores() {
  const { rounds } = await api('/api/scores'), selected = el('score-round').value;
  el('score-round').replaceChildren(...rounds.map(r => { const option = textNode('option', `${r.config?.mode==='auto'?'Vòng tự động':r.seed} · ${new Date(r.created_at).toLocaleString('vi-VN')} · ${statusLabels[r.status] || r.status}`); option.value = r.id; return option; }));
  if (rounds.some(r => r.id === selected)) el('score-round').value = selected;
  if (!rounds.length) { el('score-status').textContent = 'Chưa có vòng tính điểm. Ban tổ chức cần ít nhất hai tài khoản không bị khóa có bot đã vượt qua kiểm tra và đang được chọn để tạo vòng.'; return; }
  await loadScoreDetail();
}
async function loadScoreDetail() {
  if(window.refreshAdminChoices)window.refreshAdminChoices();
  const id = el('score-round').value; if (!id) return;
  const round = await api(`/api/scores/${id}?page=${matchPage}`);
  el('score-status').textContent = `${round.status === 'finished' ? 'Hoàn tất' : 'Đang chạy'} · ` + round.counts.map(c => `${statusLabels[c.status] || c.status}: ${c.count}`).join(' · ');
  table(el('standings'), ['Hạng', 'Thí sinh', 'Bản bot', 'Điểm xếp hạng (Elo)', 'Điểm thắng/hòa', 'Số ván', 'Thắng / Hòa / Thua'], round.standings.map((e, i) => [i + 1, e.username, 'v' + e.version, e.rating.toFixed(2), e.points, e.played, `${e.wins} / ${e.draws} / ${e.losses}`]));
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
el('score-form').onsubmit = async event => {
  event.preventDefault();el('score-message').textContent='';scorePlanBusy=true;el('create-score-round').disabled=true;
  try {
    const config=el('score-advanced').open?{seed:el('score-seed').value.trim()||`vong-${Date.now()}`,gamesPerBot:Number(el('score-games').value),gamesPerPair:Number(el('score-pair').value)}:{mode:'auto'};
    const {id}=await postAdmin('/api/admin/scores',config);matchPage=0;await loadScores();el('score-round').value=id;await loadScoreDetail();
    el('score-message').textContent='Đã tạo vòng. Hệ thống đang chạy các trận và cập nhật bảng điểm.';
  }catch(error){el('score-message').textContent=error.message;}
  finally{scorePlanBusy=false;await loadScorePlan().catch(error=>{el('score-message').textContent=error.message;});}
};
el('score-round').onchange = () => { matchPage = 0; loadScoreDetail().catch(e => { message.textContent = e.message; }); };
el('refresh-scores').onclick = () => loadScores().catch(e => { message.textContent = e.message; });
el('refresh-monitor').onclick = () => loadMonitor().catch(e => { message.textContent = e.message; });
async function startAdminTools() {
  if (admin) document.dispatchEvent(new Event('admin-ready'));
  el('scores-panel').hidden = false;
  if (admin) { el('admin-tools').hidden = false; await Promise.all([loadUsers(), loadMonitor()]); }
  await loadScores();
  setInterval(() => { if (document.hidden) return; Promise.all([loadScoreDetail(), ...(admin ? [loadMonitor(),loadScorePlan()] : [])]).catch(e => { message.textContent = e.message; }); }, 5000);
}
