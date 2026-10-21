// Organizer view of remote graders: create (secret shown once), status and revoke.
(() => {
  if (!admin) return;
  const status = el('grader-status');
  const vn = time => time ? new Date(time).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' }) : '—';
  async function load() {
    const data = await api('/api/admin/graders');
    const active = data.graders.filter(g => !g.revokedAt), online = active.filter(g => g.lastSeenAt && Date.now() - g.lastSeenAt < 30000);
    const classroom = active.some(g => g.image?.startsWith('windows-job:'));
    status.textContent = `${online.length}/${active.length} máy chấm đang kết nối.${data.image ? ' Image bắt buộc: ' + data.image : ''}${classroom ? ' Cảnh báo: có máy chấm chế độ lớp học (windows-job) — chưa chặn mạng và hệ thống file, chỉ dùng khi được giám sát.' : ''}`;
    table(el('grader-list'), ['Tên', 'Mã', 'Trạng thái', 'Liên lạc cuối', 'Việc đang chạy', 'Image', 'Thao tác'], data.graders.map(g => [g.name, g.id,
      g.revokedAt ? 'Đã thu hồi' : online.includes(g) ? 'Đang kết nối' : 'Chưa kết nối', vn(g.lastSeenAt), g.running, g.image ? g.image.slice(0, 19) : '—',
      g.revokedAt ? '—' : action('Thu hồi', async () => { await postAdmin(`/api/admin/graders/${encodeURIComponent(g.id)}/revoke`); await load(); })]));
  }
  let openId = null;
  async function loadEnrollment() {
    const open = (await api('/api/admin/grader-enrollments')).enrollments.find(e => e.open);
    openId = open?.id || null; el('enroll-close').hidden = !open; el('enroll-form').hidden = !!open;
    el('enroll-status').textContent = open ? `Đang mở đợt đăng ký: ${open.uses}/${open.maxUses} máy đã nhận khóa · tự đóng lúc ${vn(open.expiresAt)}.` : 'Không có đợt đăng ký nào đang mở: USB máy chấm mới sẽ không vào được.';
  }
  const refresh = () => Promise.all([load(), loadEnrollment()]).catch(error => { status.textContent = error.message; });
  el('enroll-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      const opened = await api('/api/admin/grader-enrollments', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ namePrefix: el('enroll-prefix').value, maxUses: Number(el('enroll-max').value), minutes: Number(el('enroll-minutes').value) }) });
      el('enroll-env').textContent = [`COORDINATOR_URL=${location.origin}`, `GRADER_ENROLL_CODE=${opened.code}`, 'GRADER_SLOTS=1'].join('\n');
      el('enroll-env-box').hidden = false; await refresh();
    } catch (error) { el('enroll-status').textContent = error.message; } finally { button.disabled = false; }
  });
  el('enroll-close').addEventListener('click', async () => {
    if (!openId) return;
    try { await postAdmin(`/api/admin/grader-enrollments/${encodeURIComponent(openId)}/close`); el('enroll-env').textContent = ''; el('enroll-env-box').hidden = true; await refresh(); }
    catch (error) { el('enroll-status').textContent = error.message; }
  });
  el('grader-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      const created = await api('/api/admin/graders', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ name: el('grader-name').value }) });
      el('grader-command').textContent = [`$env:COORDINATOR_URL = '${location.origin}'`, `$env:GRADER_ID = '${created.id}'`, `$env:GRADER_SECRET = '${created.secret}'`, `$env:GRADER_SLOTS = '1'`, 'npm run grader'].join('\n');
      el('grader-secret').hidden = false; el('grader-name').value = ''; await load();
    } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
  });
  el('grader-secret-hide').addEventListener('click', () => { el('grader-command').textContent = ''; el('grader-secret').hidden = true; });
  el('grader-refresh').addEventListener('click', refresh);
  document.addEventListener('admin-ready', () => { el('admin-graders-panel').hidden = false; refresh(); });
})();
