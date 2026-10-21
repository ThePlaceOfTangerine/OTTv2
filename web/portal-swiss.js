(() => {
  if (admin) return;
  let ready = false, timer = null, sequence = 0;
  const select = document.getElementById('portal-swiss-select');
  const status = document.getElementById('portal-swiss-status');
  async function read() {
    clearTimeout(timer);
    const id = select.value, request = ++sequence;
    if (!id) { status.textContent = 'Bạn chưa có giải đã mở nhận bài. Bảng điểm vòng loại sẽ xuất hiện khi ban tổ chức chạy vòng loại.'; return; }
    const [data, bracketResult] = await Promise.all([api(`/api/portal/tournaments/${encodeURIComponent(id)}/swiss`), api(`/api/portal/tournaments/${encodeURIComponent(id)}/bracket`)]);
    if (request !== sequence || select.value !== id) return;
    status.textContent = data.status === 'not_started' ? 'Ban tổ chức chưa bắt đầu vòng loại.'
      : `${data.status === 'paused' ? 'Vòng loại đang tạm dừng' : data.status === 'cancelled' ? 'Vòng loại đã hủy; không duyệt đội đi tiếp' : data.status === 'finished' ? 'Đã hoàn tất vòng loại; chờ ban tổ chức duyệt kết quả' : 'Điểm tạm tính trong khi thi đấu'} · ${data.rounds.filter(r => r.status === 'finished').length}/${data.preview.rounds} vòng hoàn tất. Thứ tự xét khi bằng điểm: tổng điểm đối thủ → điểm đối thủ có trọng số → điểm ván → bốc thăm.`;
    table(document.getElementById('portal-swiss-standings'), ['Hạng', '±', 'Đội', 'Huy hiệu', 'Bản bot', 'Điểm vòng loại', 'Tổng điểm đối thủ', 'Điểm đối thủ có trọng số', 'Điểm ván', 'Lượt miễn đấu'],
      data.standings.map(e => [e.rank, OTT.rankChangeText(e.rankChange), e.username, OTT.badgeCell(e.badges), 'v' + e.version, e.points, e.buchholz, e.sonnebornBerger, e.gamePoints, e.byes]));
    if (data.standings.length) document.getElementById('portal-swiss-standings').append(OTT.badgeLegend());
    if (data.controlReason) status.textContent += ' Lý do: ' + data.controlReason;
    if (data.qualification) status.textContent = `Đã duyệt ${data.qualification.topN} đội đi tiếp: ${data.qualification.teams.map(e => `${e.username} (hạt giống ${e.seed})`).join(', ')}. Vòng loại trực tiếp chưa bắt đầu.`;
    renderBracket(document.getElementById('portal-bracket'), bracketResult.bracket);
    if (bracketResult.bracket?.status === 'running') status.textContent = 'Đang thi đấu vòng loại trực tiếp. Theo dõi các cặp và kết quả bên dưới.';
    if (bracketResult.bracket?.champion) status.textContent = `${bracketResult.bracket.publishedAt ? 'Đã công bố kết quả' : 'Kết quả tạm thời, chờ duyệt'} · Đội vô địch: ${bracketResult.bracket.champion.username}.`;
    if (data.status === 'running' || bracketResult.bracket?.status === 'running') timer = setTimeout(() => { if (!document.hidden && workspaceView === 'scores') read().catch(error => { status.textContent = error.message; }); }, 5000);
  }
  async function refresh() {
    const data = await api('/api/portal/tournaments'), previous = select.value;
    const choices = new Map(data.stages.map(stage => [stage.tournamentId, stage.name]));
    select.replaceChildren(...[...choices].map(([id, name]) => { const option = textNode('option', name); option.value = id; return option; }));
    if (choices.has(previous)) select.value = previous;
    await read();
  }
  select.addEventListener('change', () => read().catch(error => { status.textContent = error.message; }));
  document.getElementById('portal-swiss-refresh').addEventListener('click', async event => {
    event.target.disabled = true;
    try { await refresh(); } catch (error) { status.textContent = error.message; }
    finally { event.target.disabled = false; }
  });
  const resume = () => { if (ready && !document.hidden && workspaceView === 'scores') read().catch(error => { status.textContent = error.message; }); };
  document.addEventListener('visibilitychange', resume); window.addEventListener('hashchange', resume);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  document.addEventListener('portal-ready', () => {
    ready = true; document.getElementById('portal-swiss-panel').hidden = false;
    refresh().catch(error => { status.textContent = error.message; });
  });
})();
