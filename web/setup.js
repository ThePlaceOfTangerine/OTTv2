const $ = id => document.getElementById(id);
const json = async (url, options) => {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Lỗi ${response.status}`);
  return data;
};

(async () => {
  try {
    const { checks } = await json('/api/setup');
    const job = checks['windows-job'], docker = checks.docker;
    $('classroom-detail').textContent = job.available ? ` Máy này: sẵn sàng (${job.image}${job.cpp ? '' : `; ${job.cppError || 'chưa có g++ nên chỉ chấm Python, thêm gói add-cpp nếu lớp học C++'}`}).` : ` Máy này: chưa dùng được (${job.error}).`;
    $('official-detail').textContent = docker.available ? ' Máy này: Docker sẵn sàng.' : ' Máy này: chưa có Docker đang chạy.';
    for (const [value, check] of [['classroom', job], ['official', docker]]) {
      const input = document.querySelector(`input[name=trust][value=${value}]`);
      input.closest('label').classList.toggle('unavailable', !check.available);
    }
    document.querySelector(`input[name=trust][value=${docker.available && !job.available ? 'official' : 'classroom'}]`).checked = true;
    $('checks-status').textContent = 'Đã kiểm tra máy. Chọn một mức:';
  } catch (error) {
    $('checks-status').textContent = error.message;
    if (/đã được cài đặt/.test(error.message)) location.replace('/admin');
  }
})();

$('class-file').addEventListener('change', async event => { const file = event.target.files[0]; if (file) $('class-csv').value = await file.text(); });
$('print-credentials').addEventListener('click', () => print());

// After a restart (new sandbox level or LAN setting) the server is down for a moment; wait for it before linking on.
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try { if ((await fetch('/api/health', { cache: 'no-store' })).ok) return true; } catch { /* still restarting */ }
  }
  return false;
}

$('setup-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('setup-message'); message.textContent = '';
  if ($('admin-password').value !== $('admin-confirm').value) { message.textContent = 'Hai lần nhập mật khẩu chưa khớp.'; return; }
  const button = $('setup-submit'); button.disabled = true; button.textContent = 'Đang cài đặt…';
  try {
    const result = await json('/api/setup', { method: 'POST', body: JSON.stringify({
      username: $('admin-username').value.trim(), password: $('admin-password').value,
      trust: document.querySelector('input[name=trust]:checked')?.value, lan: $('lan').checked, csv: $('class-csv').value }) });
    $('setup-form').hidden = true; $('setup-done').hidden = false; $('done-heading').focus();
    if (result.credentials.length) {
      $('done-credentials').hidden = false;
      $('credentials-body').replaceChildren(...result.credentials.map(c => { const row = document.createElement('tr'); for (const value of [c.username, c.password]) row.insertCell().textContent = value; return row; }));
    }
    const notes = [result.trust === 'classroom' ? 'Chế độ lớp học: kết quả chỉ để luyện tập, không chính thức.' : 'Chế độ giải chính thức (Docker).'];
    if (result.tournament) notes.push(`Đã tạo “${result.tournament.name}” với ${result.credentials.length} học sinh.`);
    if (result.tournamentError) notes.push(result.tournamentError);
    const status = $('done-status'), link = $('done-link');
    if (result.autoRestart) {
      status.textContent = `${notes.join(' ')} Đang khởi động lại để áp dụng cài đặt…`; link.hidden = true;
      const back = await waitForServer();
      status.textContent = `${notes.join(' ')} ${back ? 'Đã sẵn sàng.' : 'Chưa thấy máy chủ chạy lại: đóng cửa sổ đen rồi bấm đúp start.bat.'}`; link.hidden = !back;
    } else status.textContent = `${notes.join(' ')}${result.restart ? ' Hãy tắt rồi chạy lại máy chủ để áp dụng mức tin cậy mới.' : ''}`;
  } catch (error) {
    message.textContent = error.message; button.disabled = false; button.textContent = 'Hoàn tất cài đặt';
  }
});
