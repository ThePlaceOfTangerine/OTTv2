// Organizer tools for LAN finals: USB/folder intake per stage and snapshot status.
(() => {
  if (!admin) return;
  const vn = value => value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' }) : '—';
  const fromLocal = value => value ? Date.parse(`${value}:00+07:00`) : null;
  const statusLabels = { queued: 'Đã nhận, đang kiểm tra', duplicate: 'Đã có (cùng nội dung)', error: 'Lỗi' };
  let stageSequence = 0;

  async function loadStages() {
    const request = ++stageSequence;
    const id = el('tournament-select').value, select = el('intake-stage');
    el('intake-panel').hidden = !id; if (!id) return;
    const tournament = await api(`/api/admin/tournaments/${encodeURIComponent(id)}`);
    if (request !== stageSequence || id !== el('tournament-select').value) return;
    select.replaceChildren(...tournament.stages.map(stage => { const option = textNode('option', `${stage.kind === 'final' ? 'Nộp lại vòng chính thức' : 'Vòng loại'} · ${stage.status}`); option.value = stage.id; return option; }));
    el('intake-run').disabled = !tournament.stages.length;
    el('intake-status').textContent = tournament.stages.length ? '' : 'Giải chưa mở nhận bài.';
  }
  el('intake-run').addEventListener('click', async () => {
    const button = el('intake-run'); button.disabled = true; el('intake-status').textContent = 'Đang đọc thư mục…';
    try {
      const { report } = await postAdmin(`/api/admin/stages/${encodeURIComponent(el('intake-stage').value)}/folder-intake`, { dir: el('intake-dir').value.trim(), reason: el('intake-reason').value.trim(), receivedAt: fromLocal(el('intake-received').value) });
      const count = status => report.filter(row => row.status === status).length;
      el('intake-status').textContent = `${count('queued')} bài mới, ${count('duplicate')} bài đã có, ${count('error')} lỗi. Theo dõi kết quả kiểm tra ở mục Giám sát.`;
      table(el('intake-report'), ['Mục trong thư mục', 'Đội', 'Kết quả', 'Chi tiết'], report.map(row => [row.name, row.team || '—', statusLabels[row.status], row.message || (row.version ? `Phiên bản v${row.version}` : '')]));
    } catch (error) { el('intake-status').textContent = error.message; }
    finally { button.disabled = false; }
  });

  async function loadSnapshots() {
    const data = await api('/api/admin/snapshots');
    el('snapshot-now').disabled = !data.configured;
    el('snapshot-status').textContent = !data.configured ? 'Chưa đặt SNAPSHOT_DIR: chưa có sao lưu định kỳ ra ổ ngoài.'
      : data.last?.error ? `Lần chụp gần nhất lỗi: ${data.last.error}` : `Chụp mỗi ${data.intervalMinutes} phút vào ${data.dir}, giữ ${data.keep} bản.${data.last ? ` Gần nhất ${vn(data.last.at)} (${data.last.ms} ms, ${data.last.submissions} bài).` : ''}`;
    table(el('snapshot-list'), ['Snapshot'], data.snapshots.map(name => [name]));
  }
  el('snapshot-now').addEventListener('click', async () => {
    el('snapshot-now').disabled = true;
    try { await postAdmin('/api/admin/snapshots'); await loadSnapshots(); } catch (error) { el('snapshot-status').textContent = error.message; }
    finally { el('snapshot-now').disabled = false; }
  });
  document.addEventListener('tournament-updated', () => loadStages().catch(error => { el('intake-status').textContent = error.message; }));
  document.addEventListener('admin-ready', () => {
    el('admin-snapshot-panel').hidden = false;
    loadSnapshots().catch(error => { el('snapshot-status').textContent = error.message; });
  });
})();
