// Organizer controls for public result snapshots: publish now, schedule, pause automatic publishing, Sheets/Cloudflare status.
(() => {
  if (!admin) return;
  const status = el('publication-status');
  const vn = value => value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' }) : '—';
  const fromLocal = value => value ? Date.parse(`${value}:00+07:00`) : null;
  const tournamentId = () => el('tournament-select').value;
  const reason = () => el('publication-reason').value.trim();
  const sheetLabels = { queued: 'Đang chờ / thử lại', done: 'Đã đồng bộ', failed: 'Thất bại' };
  const scheduleLabels = { pending: 'Đang chờ', done: 'Đã công bố', skipped: 'Bỏ qua (đang tạm hoãn)', cancelled: 'Đã hủy', failed: 'Lỗi' };
  let data = null;
  function render() {
    const paused = !!data.control.autoPaused, site = data.site, lastDeploy = site.deploys[0];
    status.textContent = [
      data.publications.length ? `Bản mới nhất v${data.publications[0].version} lúc ${vn(data.publications[0].createdAt)}.` : 'Chưa công bố bản nào.',
      paused ? `Công bố tự động đang TẠM HOÃN: ${data.control.reason}.` : 'Công bố tự động đang bật.',
      site.lastBuild ? (site.lastBuild.error ? `Dựng trang lỗi: ${site.lastBuild.error}` : `Đã dựng trang lúc ${vn(site.lastBuild.at)} (${site.lastBuild.files} file).`) : '',
      lastDeploy ? `Cloudflare: ${{ running: 'đang đẩy', done: 'đã đẩy', failed: 'lỗi', blocked: 'chưa cấu hình' }[lastDeploy.status]} (${vn(lastDeploy.createdAt)}).` : site.deployConfigured ? '' : 'Cloudflare Pages chưa cấu hình.',
      data.sheetsConfigured ? '' : 'Google Sheets chưa cấu hình.',
    ].filter(Boolean).join(' ');
    el('publication-pause').textContent = paused ? 'Tiếp tục công bố tự động' : 'Tạm hoãn công bố tự động';
    el('publication-preview').href = site.publicUrl + (tournamentId() ? `#${tournamentId()}` : '');
    table(el('publication-list'), ['Bản', 'Lúc', 'Cách', 'Lý do', 'Google Sheets', 'Thao tác'], data.publications.map(p => [`v${p.version}`, vn(p.createdAt), p.trigger === 'schedule' ? 'Theo lịch' : 'Thủ công', p.reason,
      p.sheetStatus ? `${sheetLabels[p.sheetStatus]}${p.sheetError ? ` · ${p.sheetError.slice(0, 120)}` : ''}` : '—',
      p.sheetStatus === 'failed' ? action('Đồng bộ lại', () => send(`/api/admin/publications/${p.id}/sheet-retry`, {}, false)) : '—']));
    table(el('publication-schedules'), ['Lịch công bố', 'Lý do', 'Trạng thái', 'Thao tác'], data.schedules.map(s => [vn(s.publishAt), s.reason, `${scheduleLabels[s.status]}${s.note ? ` · ${s.note}` : ''}`,
      s.status === 'pending' ? action('Hủy lịch', () => send(`/api/admin/publication-schedules/${s.id}/cancel`, {})) : '—']));
  }
  async function load() {
    const id = tournamentId(); if (!id) { el('publication-panel').hidden = true; return; }
    el('publication-panel').hidden = false;
    data = await api(`/api/admin/tournaments/${encodeURIComponent(id)}/publications`); render();
  }
  async function send(url, body, replace = true) {
    try { const result = await postAdmin(url, body); if (replace && result?.publications) { data = result; render(); } else await load(); }
    catch (error) { status.textContent = error.message; }
  }
  const base = () => `/api/admin/tournaments/${encodeURIComponent(tournamentId())}`;
  el('publication-now').addEventListener('click', () => send(`${base()}/publications`, { reason: reason() }));
  el('publication-schedule').addEventListener('click', () => send(`${base()}/publication-schedules`, { reason: reason(), publishAt: fromLocal(el('publication-at').value) }));
  el('publication-pause').addEventListener('click', () => send(`${base()}/publication-control`, { reason: reason(), paused: !data?.control.autoPaused }));
  el('publication-deploy').addEventListener('click', () => send('/api/admin/site/deploy', { tournamentId: tournamentId() }, false));
  el('tournament-select').addEventListener('change', () => load().catch(error => { status.textContent = error.message; }));
  document.addEventListener('admin-ready', () => load().catch(error => { status.textContent = error.message; }));
})();
