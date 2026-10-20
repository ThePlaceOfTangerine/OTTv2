// Team profile, GitHub repo verification and commit submission; admin sees repo status and duplicate commits.
(() => {
  const $ = id => document.getElementById(id);
  const vn = time => new Date(time).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' });
  const send = (url, body, method = 'POST') => api(url, { method, headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) });
  if (admin) {
    const status = $('admin-github-status');
    const load = async () => {
      const data = await api('/api/admin/github');
      const verified = data.teams.filter(row => row.status === 'verified').length;
      status.textContent = data.configured ? `${verified}/${data.teams.length} đội đã xác minh repo. Webhook: ${data.webhook ? 'đã cấu hình' : 'chưa cấu hình, khi hết hạn chỉ đọc được commit mới nhất qua API'}.`
        : 'Chưa cấu hình GitHub App (biến môi trường GITHUB_APP_ID). Thí sinh chỉ nộp được bằng file.';
      const warning = $('admin-github-duplicates'); warning.replaceChildren();
      if (data.duplicates.length) {
        const note = document.createElement('p'); note.className = 'stage-note';
        note.textContent = 'Trùng commit giữa các đội, cần xem xét: ' + data.duplicates.map(row => `${row.sha.slice(0, 7)} → ${row.teams}`).join('; ');
        warning.append(note);
      }
      const labels = { verified: 'Đã xác minh', pending: 'Chờ xác minh' };
      table($('admin-github-teams'), ['Tài khoản', 'Tên đội', 'Repo', 'Trạng thái', 'Xác minh lúc'],
        data.teams.map(row => [row.username, row.teamName || '—', row.repo || '—', labels[row.status] || 'Chưa khai báo', row.verifiedAt ? vn(row.verifiedAt) : '—']));
    };
    const refresh = () => load().catch(error => { status.textContent = error.message; });
    document.addEventListener('admin-ready', () => { $('admin-github-panel').hidden = false; refresh(); });
    $('admin-github-refresh').addEventListener('click', refresh);
    return;
  }

  const fields = [['name', 'Họ tên', 'text', 100], ['studentId', 'MSSV', 'text', 30], ['email', 'Email', 'email', 254], ['phone', 'Số điện thoại', 'tel', 20]];
  let team = null;
  const memberRow = (member = {}, index) => {
    const row = document.createElement('div'); row.className = 'submission-fields'; row.dataset.member = index;
    for (const [key, label, type, max] of fields) {
      const wrap = document.createElement('div'), input = document.createElement('input'), caption = document.createElement('label');
      input.id = `member-${index}-${key}`; input.type = type; input.maxLength = max; input.dataset.key = key; input.value = member[key] || '';
      caption.htmlFor = input.id; caption.textContent = `${label} · thành viên ${index + 1}`;
      wrap.append(caption, input); row.append(wrap);
    }
    return row;
  };
  const render = data => {
    team = data;
    const repo = data.repo, verified = repo?.status === 'verified';
    $('team-summary').textContent = data.profile ? `${data.profile.teamName} · Email trưởng nhóm: ${data.profile.leaderEmail}` : 'Tài khoản chưa có hồ sơ đội do ban tổ chức nhập. Liên hệ ban tổ chức nếu cần.';
    $('team-members-form').hidden = !data.profile;
    // The lookup code opens this team's status on the public results site (updated at each official publication).
    const lookup = $('team-lookup'); lookup.replaceChildren();
    if (data.lookupCode) {
      const link = document.createElement('a'); link.href = data.publicSiteUrl; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'trang kết quả công khai';
      const code = document.createElement('code'); code.textContent = data.lookupCode;
      lookup.append('Mã tra cứu của đội: ', code, ' — nhập tại ', link, '. Trang cập nhật theo từng lần ban tổ chức công bố.');
    }
    if (!$('team-members-form').contains(document.activeElement)) $('team-members').replaceChildren(...[0, 1, 2, 3].map(i => memberRow(data.profile?.members[i], i)));
    $('github-disabled').hidden = data.configured; $('github-setup').hidden = !data.configured;
    if (data.installUrl) $('github-install').href = data.installUrl; else $('github-install').removeAttribute('href');
    $('github-code').textContent = repo?.verifyCode || '(lưu repo để nhận mã)';
    if (repo && document.activeElement !== $('github-url')) $('github-url').value = `https://github.com/${repo.fullName}`;
    $('github-status').textContent = !repo ? 'Chưa khai báo repo.' : verified ? `Đã xác minh ${repo.fullName} lúc ${vn(repo.verifiedAt)} · nhánh ${repo.defaultBranch}.` : `Chờ xác minh ${repo.fullName}. Làm bước 3–4 rồi bấm Xác minh repo.`;
    $('github-verify').disabled = !repo || verified;
    $('github-submit-fields').hidden = !data.configured;
    $('github-submit-info').textContent = verified ? `Lấy commit mới nhất trên nhánh ${repo.defaultBranch} của ${repo.fullName} và nộp vào nơi nộp bài đang chọn ở trên.` : 'Xác minh repo trong mục Đội & GitHub để nộp bằng commit.';
    $('github-submit').disabled = !verified;
  };
  const busy = async (button, output, action) => {
    button.disabled = true; output.textContent = ''; let failure = '';
    try { await action(); } catch (error) { failure = error.message; }
    // render() rewrites the status line, so the error is shown after it.
    finally { button.disabled = false; if (team) render(team); if (failure) output.textContent = failure; }
  };
  const load = () => api('/api/portal/team').then(render);

  $('team-members-form').addEventListener('submit', event => {
    event.preventDefault();
    busy(event.submitter, $('team-members-message'), async () => {
      const members = [...$('team-members').children].map(row => Object.fromEntries([...row.querySelectorAll('input')].map(input => [input.dataset.key, input.value.trim()])))
        .filter(member => Object.values(member).some(Boolean));
      document.activeElement.blur(); render(await send('/api/portal/team/members', { members }, 'PUT'));
      $('team-members-message').textContent = 'Đã lưu thông tin thành viên.';
    });
  });
  $('github-repo-form').addEventListener('submit', event => {
    event.preventDefault();
    busy(event.submitter, $('github-status'), async () => { document.activeElement.blur(); render(await send('/api/portal/team/repo', { url: $('github-url').value })); });
  });
  $('github-verify').addEventListener('click', event => busy(event.target, $('github-status'), async () => render(await send('/api/portal/team/repo/verify', {}))));
  $('github-submit').addEventListener('click', event => busy(event.target, $('github-submit-message'), async () => {
    const result = await send('/api/portal/github-submit', { stageId: submissionStageId || null });
    selectedSubmission = result.id;
    $('github-submit-message').textContent = `Đã nhận commit ${result.commit_sha.slice(0, 7)} thành phiên bản v${result.version} lúc ${vn(result.received_at)} (giờ Việt Nam). Theo dõi kết quả bên dưới.`;
    await loadSubmissions();
  }));
  document.addEventListener('portal-ready', () => { $('team-panel').hidden = false; load().catch(error => { $('github-status').textContent = error.message; }); });
})();
