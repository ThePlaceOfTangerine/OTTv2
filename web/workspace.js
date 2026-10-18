// Small hash-based navigation, shared by the contestant and organizer workspace.
// The server continues to authorize every API request independently.
const workspaceAdmin = location.pathname.startsWith('/admin');
document.querySelector('.workspace-sidebar .brand').href = workspaceAdmin ? '/admin' : '/portal';
const workspaceViews = workspaceAdmin ? {
  tournaments: ['Giải đấu', 'Quản lý vòng loại tính điểm, loại trực tiếp và kết quả giải.'],
  monitor: ['Giám sát', 'Theo dõi bài nộp và các trận đang diễn ra.'],
  users: ['Thí sinh', 'Cấp tài khoản và quản lý quyền tham gia.'],
  scores: ['Vòng điểm', 'Tổ chức vòng đấu và theo dõi bảng xếp hạng.'],
  rules: ['Bộ luật', 'Lưu từng phiên bản để mọi trận đấu có thể xem lại.'],
  practice: ['Đấu thử', 'Chọn hai bot và một bộ luật. Kết quả không tính điểm.'],
  help: ['Hướng dẫn', 'Các bước chuẩn bị và điều hành giải.']
} : {
  bots: ['Bot của tôi', 'Nộp file code, xem kết quả kiểm tra và chọn bản để thi đấu.'],
  scores: ['Bảng xếp hạng', 'Kết quả thi đấu theo từng vòng do ban tổ chức tạo.'],
  help: ['Hướng dẫn', 'Tải mã mẫu, nộp thử và học cách chọn nước đi.']
};
let workspaceReady = false;
let workspaceView = '';
const workspaceAliases = {
  'admin-users': 'users', 'admin-monitor': 'monitor', 'admin-create-round': 'scores',
  'scores-panel': 'scores', 'rule-panel': 'rules', 'match-panel': 'practice'
};
function openWorkspaceView(requested, { focus = true } = {}) {
  if (!workspaceReady) return;
  const key = Object.hasOwn(workspaceViews, requested) ? requested : Object.keys(workspaceViews)[0];
  if (workspaceView !== key) {
    document.getElementById('replay-panel').hidden = true;
    // Playback and live polling must stop when leaving the view that opened them.
    if (typeof pauseReplay === 'function') pauseReplay();
    if (typeof liveTimer !== 'undefined') clearTimeout(liveTimer);
  }
  workspaceView = key;
  document.querySelectorAll('[data-view]').forEach(node => node.classList.toggle('view-hidden', node.dataset.view !== key));
  document.querySelectorAll('#workspace-nav a').forEach(link => {
    if (link.hash === '#' + key) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.getElementById('heading').textContent = workspaceViews[key][0];
  document.getElementById('page-description').textContent = workspaceViews[key][1];
  document.getElementById('message').textContent = '';
  if (focus) { document.getElementById('heading').focus({ preventScroll: true }); window.scrollTo(0, 0); }
}
function configureWorkspace(user) {
  document.body.dataset.session = user.mustChangePassword ? 'password' : 'active';
  document.getElementById('welcome').textContent = user.username;
  if (user.mustChangePassword) {
    document.getElementById('heading').textContent = 'Đặt mật khẩu riêng';
    document.getElementById('page-description').textContent = 'Đổi mật khẩu được cấp để bắt đầu tham gia.';
    return;
  }
  workspaceReady = true;
  const nav = document.getElementById('workspace-nav');
  nav.hidden = false;
  nav.replaceChildren(...Object.entries(workspaceViews).map(([key, [label]], index) => {
    const link = document.createElement('a'); link.href = '#' + key;
    const number = document.createElement('span'); number.className = 'nav-number'; number.textContent = String(index + 1).padStart(2, '0'); number.setAttribute('aria-hidden', 'true');
    link.append(number, document.createTextNode(label)); return link;
  }));
  if (!workspaceAdmin) document.getElementById('resources-panel').hidden = false;
  for (const id of ['admin-monitor-panel', 'admin-round-panel']) document.getElementById(id).hidden = !workspaceAdmin;
  const hash = location.hash.slice(1);
  openWorkspaceView(workspaceAliases[hash] || hash, { focus: false });
}
window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(1);
  openWorkspaceView(workspaceAliases[hash] || hash);
});
document.getElementById('close-password').addEventListener('click', () => {
  document.getElementById('password-panel').hidden = true;
  document.getElementById('open-password').focus();
});
document.getElementById('close-replay').addEventListener('click', () => {
  document.getElementById('replay-panel').hidden = true;
  if (typeof pauseReplay === 'function') pauseReplay();
  if (typeof liveTimer !== 'undefined') clearTimeout(liveTimer);
});
