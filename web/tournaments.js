// Tournament setup, intake and execution controls.
(() => {
  if (!admin) return;
  let selected = null, users = [], rules = [], page = 0, busy = false, sequence = 0;
  let teamIds = new Set();
  let swissData = null, swissTimer = null, swissRequest = 0;
  let bracketData = null;
  let finalRuleData = null, ruleVersions = [];
  let finalIntakeData = null;
  const fieldIds = { maxTeams: 'capacity', swissRounds: 'rounds', gamesPerPair: 'games', topN: 'top', bestOf: 'bestof', extraPairs: 'extra' };
  const defaults = { maxTeams: 150, swissRounds: 8, gamesPerPair: 2, topN: 16, bestOf: 5, extraPairs: 3 };
  const notice = (text, error = false) => {
    const target = el('tournament-message'); target.textContent = text;
    target.dataset.error = String(error);
    if (error) target.focus();
  };
  const date = value => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' });
  const toLocal = value => value === null || value === undefined ? '' : new Date(value + 7 * 3600000).toISOString().slice(0, 16);
  const fromLocal = value => value ? Date.parse(`${value}:00+07:00`) : null;
  const rosterChanged = () => {
    const saved = selected?.entrants || [];
    return saved.length !== teamIds.size || saved.some(entrant => !teamIds.has(entrant.userId));
  };
  function controls() {
    const progress = tournamentProgress({ tournament: selected, swiss: swissData, bracket: bracketData, finalRule: finalRuleData, intake: finalIntakeData, dirtyRoster: rosterChanged() });
    el('tournament-progress-step').textContent = `Bước ${progress.step}/6 · Việc cần làm tiếp theo`;
    el('tournament-progress-title').textContent = progress.title;
    el('tournament-progress-text').textContent = progress.text;
    const jump = el('tournament-progress-jump');
    jump.disabled = busy;
    jump.onclick = () => {
      const target = el(progress.target);
      for (let node = target.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
      if (!target.matches('button,input,select,textarea,a')) target.setAttribute('tabindex', '-1');
      target.scrollIntoView({ block: 'center' });
      target.focus({ preventScroll: true });
    };
    for (const id of ['tournament-new', 'tournament-refresh', 'tournament-select', 'tournament-prev', 'tournament-next']) el(id).disabled = busy;
    const locked = !!selected && selected.status !== 'draft';
    el('tournament-fields').disabled = busy || locked;
    el('tournament-roster-fields').disabled = busy || locked;
    const stage = selected?.stages?.[0];
    el('tournament-open').disabled = busy || !selected || selected.status !== 'draft' || rosterChanged() || selected.entrants.length < 2;
    el('tournament-open').title = rosterChanged() ? 'Bấm Lưu danh sách đội trước khi mở nhận bài.' : selected && selected.entrants.length < 2 ? 'Cần lưu ít nhất hai đội trước khi mở nhận bài.' : '';
    el('tournament-close').disabled = busy || !stage || stage.status !== 'open' || stage.serverNow < stage.opensAt;
    el('tournament-cancel').disabled = busy || !selected || !['draft', 'submissions_open', 'closing'].includes(selected.status);
    el('tournament-lock').disabled = busy || selected?.status === 'cancelled' || !stage || stage.status !== 'closing';
    el('swiss-start').disabled = busy || !swissData || swissData.status !== 'not_started' || selected?.status !== 'locked';
    el('swiss-next').disabled = busy || !swissData || swissData.status !== 'running' || swissData.rounds.at(-1)?.status !== 'finished';
    el('swiss-pause').disabled = busy || swissData?.status !== 'running';
    el('swiss-resume').disabled = busy || swissData?.status !== 'paused';
    el('swiss-cancel').disabled = busy || swissData?.status !== 'paused' || swissData.pairs.some(p => p.games.some(g => g.status === 'running'));
    el('swiss-refresh').disabled = busy;
    el('swiss-seed').disabled = busy || !swissData || swissData.status !== 'not_started';
    el('qualification-fields').disabled = busy || !swissData || swissData.status !== 'finished' || !!swissData.qualification;
    el('bracket-create').disabled = busy || !swissData?.qualification || !!bracketData;
    el('bracket-reason').disabled = busy || !swissData?.qualification || !!bracketData?.publishedAt;
    el('bracket-start').disabled = busy || bracketData?.status !== 'planned' || (finalIntakeData ? finalIntakeData.stage.status !== 'locked' : !!finalRuleData?.requiresResubmission);
    el('bracket-start-manual').disabled = busy || bracketData?.status !== 'planned' || (finalIntakeData ? finalIntakeData.stage.status !== 'locked' : !!finalRuleData?.requiresResubmission);
    el('final-intake-fields').disabled = busy || !finalRuleData || !!finalIntakeData || (!!bracketData && bracketData.status !== 'planned');
    const finalStage = finalIntakeData?.stage;
    el('final-intake-close').disabled = busy || !finalStage || finalStage.status !== 'open' || finalStage.serverNow <= finalStage.opensAt;
    el('final-intake-lock').disabled = busy || !finalStage || finalStage.status !== 'closing';
    el('final-intake-close-reason').disabled = busy || !finalStage || !['open', 'closing'].includes(finalStage.status);
    el('final-rule-fields').disabled = busy || !swissData?.qualification || !!finalRuleData || (!!bracketData && bracketData.status !== 'planned');
    el('bracket-pause').disabled = busy || bracketData?.status !== 'running';
    el('bracket-resume').disabled = busy || bracketData?.status !== 'paused';
    el('bracket-cancel').disabled = busy || bracketData?.status !== 'paused' || bracketData.games.some(g => g.status === 'running');
    el('bracket-publish').disabled = busy || bracketData?.status !== 'finished' || !!bracketData?.publishedAt;
    el('tournament-panel').setAttribute('aria-busy', String(busy));
  }
  async function work(task) {
    if (busy) return;
    busy = true; controls();
    try { await task(); } catch (error) { notice(`${error.message} Nếu dữ liệu đã thay đổi, bấm Tải lại dữ liệu trước khi lưu lại.`, true); }
    finally { busy = false; controls(); }
  }
  function renderTeams() {
    const query = el('tournament-team-search').value.trim().toLowerCase();
    const catalog = new Map(users.map(user => [user.id, user]));
    for (const entrant of selected?.entrants || []) if (!catalog.has(entrant.userId)) catalog.set(entrant.userId, { id: entrant.userId, username: entrant.username, locked: true, deleted: true });
    const matches = [...catalog.values()].filter(user => user.username.toLowerCase().includes(query) || String(user.id) === query);
    const selectable = matches.filter(user => !user.locked || teamIds.has(user.id));
    const all = el('tournament-team-all');
    const checked = selectable.filter(user => teamIds.has(user.id)).length;
    all.checked = selectable.length > 0 && checked === selectable.length;
    all.indeterminate = checked > 0 && checked < selectable.length;
    all.disabled = selectable.length === 0;
    all.onchange = () => {
      if (all.checked) {
        const additions = selectable.filter(user => !teamIds.has(user.id));
        const capacity = selected?.config.maxTeams ?? defaults.maxTeams;
        if (teamIds.size + additions.length > capacity) {
          notice(`Không thể chọn tất cả: vượt giới hạn ${capacity} đội. Hãy thu hẹp bộ lọc hoặc tăng sức chứa và lưu cấu hình trước.`, true);
          renderTeams(); return;
        }
        for (const user of additions) teamIds.add(user.id);
      } else {
        for (const user of matches) teamIds.delete(user.id);
      }
      renderTeams();
    };
    el('tournament-team-count').textContent = `Đã chọn ${teamIds.size} / ${selected?.config.maxTeams ?? defaults.maxTeams} đội · Đã lưu ${selected?.entrants.length ?? 0} đội · ${matches.length} tài khoản khớp bộ lọc${rosterChanged() ? ' · Có thay đổi chưa lưu: bấm Lưu danh sách đội trước khi mở nhận bài.' : ''}`;
    const host = el('tournament-team-list'); host.replaceChildren();
    for (const user of matches) {
      const label = document.createElement('label'); label.className = 'tournament-team';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = user.id; input.checked = teamIds.has(user.id);
      // Existing ineligible members remain removable, while adding new ones is disabled.
      input.disabled = !!user.locked && !input.checked;
      input.addEventListener('change', () => {
        if (input.checked) teamIds.add(user.id); else teamIds.delete(user.id);
        renderTeams();
        const replacement = [...host.querySelectorAll('input')].find(node => Number(node.value) === user.id);
        if (replacement && !replacement.disabled) replacement.focus();
      });
      const suffix = user.deleted ? ' · đã xóa, cần bỏ khỏi danh sách' : user.locked ? ' · bị khóa' : '';
      label.append(input, document.createTextNode(user.username + suffix)); host.append(label);
    }
    if (!matches.length) host.append(textNode('p', users.length ? 'Không tìm thấy tài khoản phù hợp.' : 'Chưa có thí sinh. Cấp tài khoản trong mục Thí sinh trước.'));
    controls();
  }
  function render() {
    if (selected?.stages?.[0]?.status !== 'locked') {
      swissData = null; bracketData = null; finalRuleData = null; finalIntakeData = null;
    }
    const config = selected?.config || defaults;
    el('tournament-name').value = selected?.name || '';
    el('tournament-opens').value = toLocal(selected?.opensAt);
    el('tournament-closes').value = toLocal(selected?.closesAt);
    for (const [key, suffix] of Object.entries(fieldIds)) el(`tournament-${suffix}`).value = config[key];
    updateConfigSummary();
    el('tournament-rule').replaceChildren();
    const choices = rules.map(rule => ({ id: rule.id, version: rule.version, name: rule.name }));
    if (selected && !choices.some(rule => rule.id === selected.ruleSetId && rule.version === selected.ruleSetVersion)) choices.unshift({ id: selected.ruleSetId, version: selected.ruleSetVersion, name: 'Luật đã chọn của giải' });
    for (const rule of choices) {
      const option = textNode('option', `${rule.name} · bản ${rule.version}`); option.value = JSON.stringify([rule.id, rule.version]); el('tournament-rule').append(option);
    }
    if (selected) el('tournament-rule').value = JSON.stringify([selected.ruleSetId, selected.ruleSetVersion]);
    const finalChoices = new Map();
    if (selected) finalChoices.set(JSON.stringify([selected.ruleSetId, selected.ruleSetVersion]), { name: 'Luật vòng loại đã chốt', version: selected.ruleSetVersion });
    for (const rule of ruleVersions) {
      const key = JSON.stringify([rule.id, rule.version]); if (!finalChoices.has(key)) finalChoices.set(key, rule);
    }
    el('final-rule-select').replaceChildren(...[...finalChoices].map(([key, rule]) => { const option = textNode('option', `${rule.name} · bản ${rule.version}`); option.value = key; return option; }));
    el('tournament-form-title').textContent = selected ? 'Cấu hình giải' : 'Tạo giải mới';
    el('tournament-save').textContent = selected ? 'Lưu cấu hình' : 'Tạo giải';
    const stateNames = { draft: 'Đang chuẩn bị', submissions_open: 'Đang nhận bài', closing: 'Đang chốt bài', locked: 'Đã chốt bot', running: 'Đang thi đấu', provisional: 'Chờ duyệt kết quả', finished: 'Đã kết thúc giải', cancelled: 'Đã hủy' };
    el('tournament-meta').textContent = selected ? `${stateNames[selected.status] || 'Đã khóa chỉnh sửa'} · ${selected.entrants.length} đội · cập nhật ${date(selected.updatedAt)}` : 'Điền tên và cấu hình để tạo một giải độc lập.';
    el('tournament-roster').hidden = !selected;
    teamIds = new Set((selected?.entrants || []).map(e => e.userId));
    el('tournament-events').replaceChildren();
    const kinds = { created: 'Tạo giải', cancelled: 'Hủy giải trước thi đấu', updated: 'Sửa cấu hình', entrants_replaced: 'Lưu danh sách đội', submissions_opened: 'Mở nhận bài', submissions_closed: 'Đóng nhận bài', bots_locked: 'Chốt bot', qualification_approved: 'Chốt đội đi tiếp', final_rules_pinned: 'Chốt luật chính thức', final_intake_opened: 'Công bố luật và mở nộp lại', final_intake_closed: 'Đóng nộp lại', final_bots_locked: 'Chốt bot chính thức', bracket_created: 'Tạo sơ đồ loại trực tiếp', bracket_started: 'Bắt đầu loại trực tiếp', bracket_pause: 'Tạm dừng loại trực tiếp', bracket_resume: 'Tiếp tục loại trực tiếp', bracket_cancel: 'Hủy loại trực tiếp', bracket_scheduled: 'Chọn cặp/vòng để chấm', bracket_match_finished: 'Hoàn thành cặp loại trực tiếp', bracket_finished: 'Hoàn thành chung kết', bracket_game_retry: 'Chạy lại ván lỗi hạ tầng', results_published: 'Duyệt kết quả và kết thúc giải', swiss_started: 'Bắt đầu vòng loại', swiss_pause: 'Tạm dừng vòng loại', swiss_resume: 'Tiếp tục vòng loại', swiss_cancel: 'Hủy vòng loại', swiss_round_created: 'Tạo lượt đấu vòng loại', swiss_round_finished: 'Hoàn thành lượt đấu vòng loại' };
    for (const event of [...(selected?.events || [])].reverse()) el('tournament-events').append(textNode('li', `${date(event.createdAt)} · ${kinds[event.kind] || event.kind} · admin #${event.actorId}`));
    const stage = selected?.stages?.[0];
    el('tournament-stage-info').textContent = stage ? `${stage.status === 'locked' ? 'Đã chốt bot' : stage.status === 'closing' ? 'Đã hết nhận bài; chờ xử lý hết bài đúng hạn' : 'Cửa sổ nhận bài'} · ${date(stage.opensAt)} đến ${date(stage.closesAt)} · Giờ máy chủ: ${date(stage.serverNow)}. ${stage.counts.map(row => `${row.status}/${row.job_status}: ${row.count}`).join(' · ')}` : 'Lưu cấu hình thời gian và danh sách ít nhất hai đội trước khi mở. Sau khi mở, luật và danh sách đội được giữ cố định.';
    el('tournament-locked-bots').replaceChildren();
    if (stage?.status === 'locked') for (const entrant of stage.entrants) el('tournament-locked-bots').append(textNode('li', `${entrant.username}: ${entrant.snapshot ? 'v' + entrant.snapshot.version + ' · ' + entrant.snapshot.submissionId : 'không đủ điều kiện (' + entrant.exclusionReason + ')'}`));
    renderTeams(); controls();
    document.dispatchEvent(new CustomEvent('tournament-updated', { detail: { id: selected?.id || '' } }));
  }
  function updateConfigSummary() {
    el('tournament-config-summary').textContent = `Cấu hình: tối đa ${el('tournament-capacity').value} đội · ${el('tournament-rounds').value} lượt vòng loại · ${el('tournament-games').value} ván/cặp vòng loại · ${el('tournament-top').value} đội đi tiếp · ${el('tournament-bestof').value} ván/cặp loại trực tiếp · tối đa ${el('tournament-extra').value} cặp phụ khi hòa. Mở phần điều chỉnh nếu tổ chức giải ít đội; số lượt vòng loại phải nhỏ hơn số bot thực tế.`;
  }
  for (const suffix of Object.values(fieldIds)) el(`tournament-${suffix}`).addEventListener('input', updateConfigSummary);
  el('tournament-form').addEventListener('invalid', event => {
    if (el('tournament-advanced').contains(event.target)) el('tournament-advanced').open = true;
  }, true);
  async function loadList(preferredId) {
    const data = await api(`/api/admin/tournaments?page=${page}`);
    const select = el('tournament-select'); select.replaceChildren(textNode('option', 'Chọn một giải đã tạo'));
    select.firstChild.value = '';
    for (const tournament of data.tournaments) {
      const option = textNode('option', `${tournament.name} · ${tournament.entrantCount} đội`); option.value = tournament.id; select.append(option);
    }
    select.value = preferredId || '';
    el('tournament-page').textContent = `${data.total} giải · Trang ${page + 1} / ${Math.max(1, Math.ceil(data.total / 50))}`;
    el('tournament-prev').hidden = page === 0; el('tournament-next').hidden = (page + 1) * 50 >= data.total;
  }
  async function refresh() {
    const [userData, ruleData] = await Promise.all([api('/api/admin/users'), api('/api/admin/rule-sets')]);
    users = userData.users; rules = ruleData.ruleSets;
    const versions = await Promise.all(rules.map(rule => api(`/api/admin/rule-sets/${encodeURIComponent(rule.id)}`)));
    ruleVersions = versions.flatMap(rule => rule.versions.map(version => ({ id: rule.id, name: rule.rules.name, version: version.version })));
    if (selected) selected = await api(`/api/admin/tournaments/${selected.id}`);
    await loadList(selected?.id); render(); await loadSwiss();
  }
  function renderSwiss() {
    const panel = el('tournament-swiss'); panel.hidden = !swissData;
    if (!swissData) { controls(); return; }
    const data = swissData, last = data.rounds.at(-1);
    el('swiss-status').textContent = data.status === 'not_started'
      ? `${data.preview.eligible} bot đã chốt · ${data.preview.rounds} vòng · tối đa ${data.preview.totalGames} ván. Số vòng phải nhỏ hơn số bot thực tế.`
      : `${data.status === 'paused' ? 'Đã tạm dừng vòng loại' : data.status === 'cancelled' ? 'Đã hủy vòng loại, không duyệt đội đi tiếp' : data.status === 'finished' ? 'Hoàn tất vòng loại, kết quả tạm thời' : 'Đang thi đấu vòng loại'} · Vòng ${last?.number || 0}/${data.preview.rounds} · ${last?.status === 'finished' ? 'vòng hiện tại đã xong' : 'chờ hoàn thành các ván'} · Mã ghép lịch: ${data.seed}`;
    const columns = ['Hạng', '±', 'Đội', 'Huy hiệu', 'Bản bot', 'Điểm vòng loại', 'Tổng điểm đối thủ', 'Điểm đối thủ có trọng số', 'Điểm ván', 'Lượt miễn đấu'];
    table(el('swiss-standings'), columns, data.standings.map(e => [e.rank, OTT.rankChangeText(e.rankChange), e.username, OTT.badgeCell(e.badges), 'v' + e.version, e.points, e.buchholz, e.sonnebornBerger, e.gamePoints, e.byes]));
    if (data.standings.length) el('swiss-standings').append(OTT.badgeLegend());
    if (el('qualification-count').dataset.tournament !== selected.id) {
      el('qualification-count').value = selected.config.topN;
      el('qualification-count').dataset.tournament = selected.id;
      el('qualification-reason').value = '';
    }
    const qualification = data.qualification;
    if (el('final-intake-fields').dataset.tournament !== selected.id) {
      for (const key of ['final-intake-announcement', 'final-intake-opens', 'final-intake-closes', 'final-intake-close-reason']) el(key).value = '';
      el('final-intake-policy').checked = false; el('final-intake-fields').dataset.tournament = selected.id;
    }
    if (finalIntakeData) {
      el('final-intake-announcement').value = finalIntakeData.announcement;
      el('final-intake-opens').value = toLocal(finalIntakeData.stage.opensAt); el('final-intake-closes').value = toLocal(finalIntakeData.stage.closesAt);
      el('final-intake-policy').checked = true;
    }
    const intakeLabels = { Accepted: 'Hợp lệ', Rejected: 'Bị từ chối', Queued: 'Đang chờ', Scanning: 'Đang kiểm tra', Compiling: 'Đang biên dịch', 'Test match': 'Đang đấu thử' };
    el('final-intake-status').textContent = finalIntakeData ? `${finalIntakeData.stage.status === 'locked' ? 'Đã chốt bot chính thức' : finalIntakeData.stage.status === 'open' ? 'Đợt nộp lại đã công bố' : 'Đã đóng nhận bài nộp lại'} · ${finalIntakeData.stage.entrants.length} đội đủ điều kiện · ${date(finalIntakeData.stage.opensAt)} đến ${date(finalIntakeData.stage.closesAt)}. ${finalIntakeData.stage.counts.map(c => `${intakeLabels[c.status] || c.status}: ${c.count}`).join(' · ')}. Chỉ chốt khi tất cả đội đi tiếp có bài hợp lệ và không còn việc kiểm tra chưa xong.` : 'Chưa mở đợt nộp lại. Chốt luật chính thức trước khi công bố.';
    if (finalRuleData) el('final-rule-select').value = JSON.stringify([finalRuleData.ruleSetId, finalRuleData.ruleSetVersion]);
    el('final-rule-status').textContent = finalRuleData ? `Đã chốt ${finalRuleData.rules.name} · bản ${finalRuleData.ruleSetVersion} · ${date(finalRuleData.pinnedAt)}. ${finalRuleData.requiresResubmission ? 'Luật khác vòng loại: mở đợt nộp lại để nhận/kiểm tra bot mới; sau khi đóng nhận bài và chốt đủ bot mới có thể chạy loại trực tiếp.' : 'Giữ nguyên luật vòng loại; dùng được bot đã chốt.'}`
      : 'Chưa chốt riêng luật chính thức. Luồng giữ bot/luật vòng loại hiện tại vẫn dùng luật đã ghim của vòng loại.';
    el('qualification-status').textContent = qualification ? `Đã chốt ${qualification.topN} đội lúc ${date(qualification.approvedAt)} · Người duyệt: quản trị viên #${qualification.approvedBy}.`
      : data.status === 'finished' ? 'Chưa duyệt đội đi tiếp. Kiểm tra bảng điểm và số đội trước khi chốt.' : 'Cần hoàn tất vòng loại trước khi duyệt đội đi tiếp.';
    table(el('qualification-teams'), ['Hạt giống', 'Đội đi tiếp', 'Bản bot', 'Điểm vòng loại'], (qualification?.teams || []).map(e => [e.seed, e.username, 'v' + e.version, e.points]));
    renderBracket(el('tournament-bracket'), bracketData, { match: id => scheduleBracket({ matchId: id }), round: number => scheduleBracket({ round: number }), watch: id => watchLive(`/api/admin/bracket-games/${id}`), retry: async id => {
      await postAdmin(`/api/admin/bracket-games/${id}/retry`, { reason: el('bracket-reason').value.trim() }); await loadSwiss();
    } });
    const selector = el('swiss-round-select'), previous = selector.value;
    selector.replaceChildren(...data.rounds.map(round => { const option = textNode('option', `Vòng ${round.number} · ${round.status === 'finished' ? 'Hoàn tất' : 'Đang chạy'}`); option.value = round.id; return option; }));
    selector.value = data.rounds.some(r => r.id === previous) ? previous : last?.id || '';
    renderSwissGames();
    el('swiss-export').href = `/api/admin/tournaments/${selected.id}/swiss/export`; el('swiss-export').hidden = data.status === 'not_started';
    controls();
  }
  function renderSwissGames() {
    const pairs = (swissData?.pairs || []).filter(p => p.round_id === el('swiss-round-select').value);
    const names = new Map((swissData?.standings || []).map(e => [e.userId, e.username]));
    el('swiss-byes').textContent = pairs.filter(p => p.user1 === null).map(p => `${names.get(p.user0)} được miễn đấu, +1 điểm vòng loại.`).join(' ');
    table(el('swiss-games'), ['Cặp', 'Ván', 'Trạng thái', 'Lỗi hạ tầng', 'Thao tác'], pairs.flatMap(pair => pair.games.map(game => {
      const buttons = document.createElement('div');
      if (game.status === 'running' || game.status === 'finished') buttons.append(action('Xem trận', () => watchLive(`/api/admin/swiss-games/${game.id}`)));
      if (game.status === 'blocked') buttons.append(action('Chạy lại', async () => {
        const reason = el('tournament-stage-reason').value.trim();
        await postAdmin(`/api/admin/swiss-games/${game.id}/retry`, { reason }); await loadSwiss();
      }));
      return [`${names.get(game.player0)} gặp ${names.get(game.player1)}`, game.number, statusLabels[game.status] || game.status, game.error || '—', buttons];
    })));
  }
  async function loadSwiss() {
    clearTimeout(swissTimer);
    const id = selected?.id, request = ++swissRequest;
    if (!selected?.stages?.length || selected.stages[0].status !== 'locked') { swissData = null; renderSwiss(); return; }
    const [data, bracketResult, currentTournament, finalRuleResult, finalIntakeResult] = await Promise.all([api(`/api/admin/tournaments/${id}/swiss`), api(`/api/admin/tournaments/${id}/bracket`), api(`/api/admin/tournaments/${id}`), api(`/api/admin/tournaments/${id}/final-rule`), api(`/api/admin/tournaments/${id}/final-intake`)]);
    if (request !== swissRequest || id !== selected?.id) return;
    selected = currentTournament; swissData = data; bracketData = bracketResult.bracket; finalRuleData = finalRuleResult.finalRule; finalIntakeData = finalIntakeResult.intake; renderSwiss();
    if (data.status === 'running' || bracketData?.status === 'running') swissTimer = setTimeout(() => {
      if (document.hidden || busy || workspaceView !== 'tournaments') return;
      loadSwiss().catch(error => notice(error.message, true));
    }, 3000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && selected?.stages?.[0]?.status === 'locked') loadSwiss().catch(error => notice(error.message, true)); });
  window.addEventListener('hashchange', () => { if (workspaceView === 'tournaments' && selected?.stages?.[0]?.status === 'locked') loadSwiss().catch(error => notice(error.message, true)); });
  window.addEventListener('pagehide', () => clearTimeout(swissTimer));
  el('swiss-round-select').addEventListener('change', renderSwissGames);
  el('swiss-refresh').addEventListener('click', () => work(loadSwiss));
  el('final-intake-lock').addEventListener('click', () => work(async () => {
    await postAdmin('/api/admin/tournaments/' + selected.id + '/final-intake/lock', { expectedRevision: selected.revision, reason: el('final-intake-close-reason').value.trim() });
    await loadSwiss(); notice('Đã chốt bot chính thức. Vòng loại trực tiếp sẽ dùng đúng các bản này.');
  }));
  el('final-intake-refresh').addEventListener('click', () => work(loadSwiss));
  el('final-intake-open').addEventListener('click', () => work(async () => {
    if (!el('final-intake-policy').checked) throw new Error('Cần xác nhận chính sách bài hợp lệ của đợt nộp lại.');
    await postAdmin(`/api/admin/tournaments/${selected.id}/final-intake/open`, { expectedRevision: selected.revision,
      opensAt: fromLocal(el('final-intake-opens').value), closesAt: fromLocal(el('final-intake-closes').value),
      announcement: el('final-intake-announcement').value.trim(), fallbackPolicy: 'require_valid_final_submission' });
    await loadSwiss(); notice('Đã công bố luật và cửa sổ nộp lại cho các đội đi tiếp.');
  }));
  el('final-intake-close').addEventListener('click', () => work(async () => {
    await postAdmin(`/api/admin/tournaments/${selected.id}/final-intake/close`, { expectedRevision: selected.revision, reason: el('final-intake-close-reason').value.trim() });
    await loadSwiss(); notice('Đã đóng nộp lại; bài nhận đúng hạn tiếp tục được kiểm tra.');
  }));
  el('final-rule-pin').addEventListener('click', () => work(async () => {
    const [ruleSetId, ruleSetVersion] = JSON.parse(el('final-rule-select').value);
    await postAdmin(`/api/admin/tournaments/${selected.id}/final-rule`, { expectedRevision: selected.revision, ruleSetId, ruleSetVersion, reason: el('final-rule-reason').value.trim() });
    selected = await api(`/api/admin/tournaments/${selected.id}`); render(); await loadSwiss(); notice('Đã chốt phiên bản luật chính thức và lưu nhật ký.');
  }));
  for (const operation of ['pause', 'resume', 'cancel']) el('bracket-' + operation).addEventListener('click', () => work(async () => {
    await postAdmin('/api/admin/tournaments/' + selected.id + '/bracket/' + operation, { expectedRevision: bracketData.revision, reason: el('bracket-reason').value.trim() });
    await loadSwiss(); notice('Đã cập nhật trạng thái thi đấu và lưu lý do.');
  }));
  function scheduleBracket(scope) {
    return work(async () => {
      await postAdmin(`/api/admin/tournaments/${selected.id}/bracket/schedule`, { ...scope, expectedRevision: bracketData.revision, reason: el('bracket-reason').value.trim() });
      await loadSwiss(); notice('Đã xếp các cặp được chọn vào hàng đợi. Các cặp khác tiếp tục chờ lệnh.');
    });
  }
  for (const operation of ['start', 'start-manual', 'publish']) el(`bracket-${operation}`).addEventListener('click', () => work(async () => {
    const starting = operation !== 'publish';
    await postAdmin(`/api/admin/tournaments/${selected.id}/bracket/${starting ? 'start' : 'publish'}`, { expectedRevision: selected.revision, reason: el('bracket-reason').value.trim(), ...(starting ? { rulesPolicy: finalIntakeData ? 'use_final_intake' : 'keep_qualifier', mode: operation === 'start-manual' ? 'manual' : 'auto' } : {}) });
    selected = await api(`/api/admin/tournaments/${selected.id}`); render(); await loadSwiss();
    notice(operation === 'start-manual' ? 'Đã khởi tạo chế độ từng cặp/vòng. Chọn cặp hoặc vòng trên sơ đồ để bắt đầu chấm.' : operation === 'start' ? 'Đã bắt đầu chấm loại trực tiếp.' : 'Đã duyệt kết quả và kết thúc giải.');
  }));
  el('bracket-create').addEventListener('click', () => work(async () => {
    await postAdmin(`/api/admin/tournaments/${selected.id}/bracket`, { expectedRevision: selected.revision, reason: el('bracket-reason').value.trim() });
    selected = await api(`/api/admin/tournaments/${selected.id}`);
    render(); await loadSwiss(); notice('Đã lưu sơ đồ vòng loại trực tiếp. Chưa chạy trận đấu.');
  }));
  el('qualification-approve').addEventListener('click', () => work(async () => {
    swissData = await postAdmin(`/api/admin/tournaments/${selected.id}/swiss/approve`, {
      expectedRevision: selected.revision, swissRevision: swissData.revision,
      topN: Number(el('qualification-count').value), reason: el('qualification-reason').value.trim()
    });
    selected = await api(`/api/admin/tournaments/${selected.id}`);
    render(); await loadSwiss(); notice('Đã chốt danh sách và thứ tự hạt giống đội đi tiếp.');
  }));
  for (const operation of ['pause', 'resume', 'cancel']) el('swiss-' + operation).addEventListener('click', () => work(async () => {
    await postAdmin('/api/admin/tournaments/' + selected.id + '/swiss/' + operation, { expectedRevision: swissData.revision, reason: el('swiss-control-reason').value.trim() });
    await loadSwiss(); notice('Đã cập nhật trạng thái vòng loại và lưu lý do.');
  }));
  for (const operation of ['start', 'next']) el(`swiss-${operation}`).addEventListener('click', () => work(async () => {
    const body = { expectedRevision: operation === 'start' ? selected.revision : swissData.revision };
    if (operation === 'start' && el('swiss-seed').value.trim()) body.seed = el('swiss-seed').value.trim();
    await postAdmin(`/api/admin/tournaments/${selected.id}/swiss/${operation}`, body);
    selected = await api(`/api/admin/tournaments/${selected.id}`); render(); el('swiss-round-select').value = ''; await loadSwiss();
  }));
  el('tournament-form').addEventListener('submit', event => {
    event.preventDefault();
    work(async () => {
      notice('Đang lưu cấu hình giải…');
      const config = Object.fromEntries(Object.entries(fieldIds).map(([key, suffix]) => [key, Number(el(`tournament-${suffix}`).value)]));
      const [ruleSetId, ruleSetVersion] = JSON.parse(el('tournament-rule').value);
      const body = { name: el('tournament-name').value.trim(), config, ruleSetId, ruleSetVersion, opensAt: fromLocal(el('tournament-opens').value), closesAt: fromLocal(el('tournament-closes').value), ...(selected ? { expectedRevision: selected.revision } : {}) };
      selected = await api('/api/admin/tournaments' + (selected ? `/${selected.id}` : ''), { method: selected ? 'PATCH' : 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) });
      page = 0; await loadList(selected.id); render(); notice('Đã lưu cấu hình giải. Bạn có thể chọn danh sách đội bên dưới.');
    });
  });
  el('tournament-roster-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!selected) return;
    work(async () => {
      notice('Đang lưu danh sách đội…');
      selected = await api(`/api/admin/tournaments/${selected.id}/entrants`, { method: 'PUT', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ expectedRevision: selected.revision, userIds: [...teamIds] }) });
      await loadList(selected.id); render(); notice('Đã lưu danh sách đội cho giải này.');
    });
  });
  el('tournament-team-search').addEventListener('input', renderTeams);
  el('tournament-cancel').addEventListener('click', () => work(async () => {
    selected = await postAdmin('/api/admin/tournaments/' + selected.id + '/cancel', { expectedRevision: selected.revision, reason: el('tournament-stage-reason').value.trim() });
    await loadList(selected.id); render(); await loadSwiss(); notice('Đã hủy giải và giữ lịch sử. Không thể mở lại hoặc chốt bot.');
  }));
  for (const operation of ['open', 'close', 'lock']) el(`tournament-${operation}`).addEventListener('click', () => work(async () => {
    if (operation === 'open' && rosterChanged()) {
      notice('Danh sách đội có thay đổi chưa lưu. Bấm Lưu danh sách đội, sau đó mở nhận bài.', true);
      return;
    }
    const body = { expectedRevision: selected.revision };
    if (operation !== 'open') body.reason = el('tournament-stage-reason').value.trim();
    selected = await api(`/api/admin/tournaments/${selected.id}/${operation}`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) });
    await loadList(selected.id); render(); await loadSwiss(); notice(operation === 'open' ? 'Đã mở cửa sổ theo lịch. Thí sinh trong danh sách có thể chọn giải ở trang nộp bài.' : operation === 'close' ? 'Đã đóng nhận bài; bài đã nhận vẫn tiếp tục được kiểm tra.' : 'Đã chốt bot và lưu bản thông tin cố định cho vòng loại.');
  }));
  el('tournament-select').addEventListener('change', () => {
    const id = el('tournament-select').value;
    work(async () => { const next = id ? await api(`/api/admin/tournaments/${id}`) : null; selected = next; swissData = null; bracketData = null; finalRuleData = null; finalIntakeData = null; clearTimeout(swissTimer); render(); await loadSwiss(); notice('Đã tải dữ liệu. Lưu thay đổi trước khi chuyển sang giải khác.'); });
  });
  el('tournament-new').addEventListener('click', () => { if (busy) return; selected = null; swissData = null; clearTimeout(swissTimer); renderSwiss(); el('tournament-select').value = ''; render(); notice('Đang tạo giải mới.'); el('tournament-name').focus(); });
  el('tournament-refresh').addEventListener('click', () => work(async () => { await refresh(); notice('Đã tải lại dữ liệu từ máy chủ.'); }));
  for (const [id, delta] of [['tournament-prev', -1], ['tournament-next', 1]]) el(id).addEventListener('click', () => work(async () => { page = Math.max(0, page + delta); await loadList(selected?.id); }));
  document.addEventListener('admin-ready', () => {
    el('tournament-panel').hidden = false;
    const request = ++sequence;
    work(async () => { await refresh(); if (request === sequence) notice('Cấu hình giải mới dùng vòng loại tính điểm.'); });
  });
})();
