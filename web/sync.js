// Organizer view for online ↔ LAN bundles: identity, pairing, write authority, export with handover, import, history.
(() => {
  if (!admin) return;
  const vn = value => value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' }) : '—';
  const status = el('sync-status');
  let data = null;
  function render() {
    el('sync-identity').textContent = `Máy này: ${data.identity.name} · mã ${data.identity.nodeId} · dấu khóa ${data.identity.fingerprint}`;
    el('sync-connection-own').value = data.identity.connection;
    table(el('sync-peers'), ['Máy đối tác', 'Mã', 'Dấu khóa (đối chiếu với màn hình máy kia)', 'Thêm lúc'], data.peers.map(p => [p.name, p.nodeId, p.fingerprint, vn(p.addedAt)]));
    table(el('sync-authority'), ['Phạm vi', 'Máy đang được ghi'], data.authority.map(a => [a.label, a.local ? `${a.owner}` : `${a.owner} — máy này chỉ đọc`]));
    el('sync-export-peer').replaceChildren(...data.peers.map(p => { const option = textNode('option', `${p.name} (${p.nodeId})`); option.value = p.nodeId; return option; }));
    el('sync-handovers').replaceChildren(...data.authority.filter(a => a.local).map(a => {
      const label = textNode('label', ` ${a.label}`), box = document.createElement('input'); box.type = 'checkbox'; box.value = a.scope; label.className = 'check-label'; label.prepend(box); return label;
    }));
    el('sync-export-run').disabled = !data.peers.length;
    table(el('sync-history'), ['Lúc', 'Chiều', 'Máy', 'Loại', 'Bản ghi', 'Kết quả'], data.bundles.map(b => [vn(b.createdAt), b.direction === 'export' ? 'Xuất' : 'Nhập', b.peerName, b.kind === 'full' ? 'Đầy đủ' : 'Thay đổi', b.records,
      b.direction === 'import' && b.report ? `+${b.report.inserted} · sửa ${b.report.updated} · xóa ${b.report.deleted} · xung đột ${b.report.conflicts.length}` : b.report?.handovers?.length ? `Bàn giao ${b.report.handovers.length} phạm vi` : '']));
  }
  const load = async () => { data = await api('/api/admin/sync'); render(); };
  async function run(button, work) {
    button.disabled = true; status.textContent = 'Đang xử lý…';
    try { await work(); } catch (error) { status.textContent = error.message; } finally { button.disabled = false; if (data) render(); }
  }
  el('sync-peer-form').addEventListener('submit', event => { event.preventDefault(); run(event.submitter, async () => { data = await postAdmin('/api/admin/sync/peers', { connection: el('sync-peer').value }); el('sync-peer').value = ''; status.textContent = 'Đã thêm máy đối tác. Đối chiếu dấu khóa với màn hình máy kia.'; }); });
  el('sync-export-run').addEventListener('click', () => run(el('sync-export-run'), async () => {
    if (el('sync-export-pass').value !== el('sync-export-pass2').value) throw new Error('Hai lần nhập passphrase không khớp.');
    const handovers = [...el('sync-handovers').querySelectorAll('input:checked')].map(box => box.value);
    const response = await postAdmin('/api/admin/sync/export', { peerId: el('sync-export-peer').value, kind: el('sync-export-kind').value, dir: el('sync-export-dir').value.trim(), passphrase: el('sync-export-pass').value, handovers });
    el('sync-export-pass').value = el('sync-export-pass2').value = ''; data = response;
    status.textContent = `Đã xuất ${response.result.records} bản ghi, ${response.result.blobs} file vào ${response.result.path}.${handovers.length ? ` Đã bàn giao ${handovers.length} phạm vi; máy này chỉ đọc phần đó.` : ''}`;
  }));
  el('sync-import-run').addEventListener('click', () => run(el('sync-import-run'), async () => {
    const response = await postAdmin('/api/admin/sync/import', { dir: el('sync-import-dir').value.trim(), passphrase: el('sync-import-pass').value });
    el('sync-import-pass').value = ''; data = response; const r = response.result;
    status.textContent = r.duplicate ? 'Bundle này đã được nhập trước đó; không thay đổi gì.' : `Đã nhập${r.bootstrap ? ' (khởi tạo)' : ''}: thêm ${r.inserted}, sửa ${r.updated}, xóa ${r.deleted}, ${r.files} file. Xung đột: ${r.conflicts.length}${r.conflicts.length ? ` — ví dụ ${r.conflicts[0].table || r.conflicts[0].scope}: ${r.conflicts[0].reason}` : ''}.`;
  }));
  document.addEventListener('admin-ready', () => { el('admin-sync-panel').hidden = false; load().catch(error => { status.textContent = error.message; }); });
})();
