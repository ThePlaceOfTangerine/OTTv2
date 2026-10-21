// Vietnamese explanations of submission/game error codes and the badge legend, shared by the portal, the public site and ott-run.
// Browser: <script src="/assets/hints.js"> defines window.OTT. Node: require('../web/hints').
(function (root) {
  const HINTS = {
    static_scan: ['Bài dùng thư viện hoặc lệnh không được phép.', 'Xem dòng được chỉ ra bên dưới, bỏ lệnh đó hoặc thay bằng cách khác. Bot chỉ cần đọc dữ liệu vào và in ra một nước đi.'],
    compile_error: ['Code chưa chạy được (lỗi cú pháp hoặc biên dịch).', 'Kiểm tra dấu ngoặc, dấu nháy, thụt dòng (Python) hoặc dấu chấm phẩy (C++) ở dòng được báo.'],
    bot_crash: ['Chương trình bị dừng giữa trận.', 'Thường do đọc dữ liệu sai, lấy phần tử ngoài danh sách, chia cho 0 hoặc dùng quá nhiều bộ nhớ. Dòng lỗi cuối cùng của chương trình ở bên dưới.'],
    cpu_timeout: ['Bot tính quá lâu cho một nước.', 'Kiểm tra vòng lặp có điểm dừng không; giảm độ sâu tìm kiếm hoặc chọn nước đơn giản hơn.'],
    total_cpu_timeout: ['Bot dùng hết thời gian tính của cả trận.', 'Mỗi nước cần nhanh hơn; đừng tính lại từ đầu mọi thứ ở mỗi lượt.'],
    wall_timeout: ['Bot không trả lời kịp.', 'Giữ phần nhận/gửi dữ liệu như mã mẫu: đọc đúng một dòng, in đúng một dòng. Đừng chờ người dùng gõ thêm (input() lần hai).'],
    invalid_output: ['Hệ thống không đọc được câu trả lời của bot.', 'Bot phải in đúng một dòng JSON như mã mẫu. Không in thêm lời chào hay dữ liệu gỡ lỗi ra màn hình; muốn in gỡ lỗi thì in ra stderr.'],
    output_limit: ['Bot in quá nhiều chữ.', 'Bỏ các lệnh in không cần thiết; chỉ in câu trả lời như mã mẫu.'],
    illegal_move: ['Bot chọn nước không được phép.', 'Luôn chọn một nước trong legal_moves (danh sách nước được đi) mà hệ thống gửi cho bot.'],
    userdata_limit: ['Bot ghi nhớ quá nhiều dữ liệu (userdata).', 'Giảm nội dung userdata hoặc để trống như mã mẫu.'],
    sandbox_violation: ['Bot làm thao tác bị cấm khi chạy.', 'Bot không được mở file, mạng hay chạy chương trình khác.'],
    artifact_limit: ['Chương trình sau khi biên dịch quá lớn.', 'Bỏ bảng dữ liệu khổng lồ trong code.'],
    compiler_missing: ['Máy chấm chưa có trình biên dịch C++.', 'Không phải lỗi của bạn. Báo giáo viên/ban tổ chức (cần g++ hoặc gói add-cpp), hoặc nộp bằng Python.'],
    empty_source: ['Bài nộp không có file code.', 'Nộp file main.py hoặc main.cpp (hoặc file ZIP chứa chúng).'],
    unsupported_source: ['Loại file không được nhận.', 'Chỉ nộp Python (.py) hoặc C++ (.cpp, .h, .hpp), không trộn hai ngôn ngữ.'],
    entry_required: ['Không biết file nào là file chính.', 'Đặt tên file chính là main.py hoặc main.cpp, hoặc ghi tên file chính khi nộp ZIP.'],
    invalid_entry: ['File chính không có trong bài hoặc sai ngôn ngữ.', 'Kiểm tra lại tên file chính.'],
    unsafe_path: ['Tên file không hợp lệ.', 'Chỉ dùng chữ không dấu, số, dấu _ - . trong tên file và thư mục.'],
    binary_source: ['File code chứa ký tự lạ.', 'Lưu lại file dạng văn bản UTF-8 (đừng nộp file .exe hay file đã biên dịch).'],
    upload_limit: ['File quá lớn.', 'Một file tối đa 1 MiB; ZIP tối đa 5 MiB.'],
    source_file_limit: ['File code quá lớn.', 'Một file tối đa 1 MiB.'],
    invalid_zip: ['File ZIP hỏng hoặc không đọc được.', 'Nén lại bằng chức năng "Send to → Compressed (zipped) folder" của Windows.'],
    encrypted_zip: ['ZIP có đặt mật khẩu.', 'Nén lại không đặt mật khẩu.'],
    zip_bomb: ['ZIP giải nén ra quá lớn.', 'Chỉ nén các file code.'],
    zip_entry_limit: ['ZIP có quá nhiều file.', 'Tối đa 64 file code.'],
    zip_duplicate: ['ZIP có hai file trùng tên.', 'Đổi tên để không trùng.'],
    zip_special_file: ['ZIP chứa liên kết hoặc file đặc biệt.', 'Chỉ nén file code thông thường.'],
    zip_compression: ['ZIP dùng kiểu nén không hỗ trợ.', 'Nén lại bằng chức năng nén có sẵn của Windows.'],
    manifest_missing: ['Repo thiếu file ott.json.', 'Thêm ott.json ở thư mục gốc repo, ví dụ {"language": "python", "entry": "main.py"}.'],
    manifest_invalid: ['ott.json chưa đúng.', 'Dạng đúng: {"language": "python" hoặc "cpp", "entry": "main.py"}; entry tính từ thư mục bot/.'],
    repo_too_large: ['Repo quá lớn.', 'Repo tối đa 50 MB; bỏ file dữ liệu lớn khỏi repo.'],
    repo_unavailable: ['Không tải được repo.', 'Kiểm tra GitHub App còn được cài cho repo và repo chưa bị xóa/đổi tên.'],
    repo_public: ['Repo đang để công khai.', 'Chuyển repo sang Private để người khác không chép bài.'],
    commit_not_found: ['Không tìm thấy commit đã chọn.', 'Đẩy (push) commit lên GitHub rồi nộp lại.']
  };
  const BADGES = {
    undefeated: ['🏆', 'Bất bại', () => 'Chưa thua trận nào sau ít nhất 3 trận'],
    streak: ['🔥', 'Chuỗi thắng', value => `Đang có chuỗi ${value} trận toàn thắng liên tiếp`],
    clean: ['🛡️', 'Bot mẫu mực', () => 'Không ván nào bị xử thua vì lỗi bot (crash, quá giờ, nước sai)'],
    comeback: ['🚀', 'Ngược dòng', value => `Lên ${value} hạng sau lượt vừa rồi`]
  };
  const lastLine = text => String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) || '';
  // { title, fix, detail }: detail is the one line of the raw message most worth showing (traceback tail, compiler error, scan location).
  function explain(code, message) {
    const [title, fix] = HINTS[code] || ['Bài chưa vượt qua kiểm tra.', 'Xem chi tiết kỹ thuật; nếu chưa hiểu, gửi thông báo đó cho giáo viên hoặc ban tổ chức.'];
    const text = String(message || '');
    let detail = '';
    if (code === 'compile_error') detail = text.split(/\r?\n/).find(line => /error|Error|lỗi/.test(line))?.trim() || lastLine(text);
    else if (['bot_crash', 'static_scan', 'invalid_output'].includes(code) || HINTS[code] === undefined) detail = lastLine(text);
    if (detail === code) detail = '';
    return { title, fix, detail: detail.slice(0, 300) };
  }
  const badgeText = badge => { const [icon, name, describe] = BADGES[badge.code] || ['', badge.code, () => '']; return { icon, name, title: describe(badge.value) }; };
  const rankChangeText = change => change === null || change === undefined ? '–' : change > 0 ? `↑${change}` : change < 0 ? `↓${-change}` : '=';
  // Browser only: a cell with one icon per badge; the name and reason are in title + aria-label (hover on desktop, screen readers).
  function badgeCell(badges) {
    const cell = document.createElement('span'); cell.className = 'badges';
    for (const badge of badges || []) {
      const { icon, name, title } = badgeText(badge), item = document.createElement('span');
      item.className = `badge badge-${badge.code}`; item.textContent = icon; item.title = `${name}: ${title}`; item.setAttribute('aria-label', item.title); item.setAttribute('role', 'img');
      cell.append(item);
    }
    if (!cell.childElementCount) cell.textContent = '—';
    return cell;
  }
  // Touch screens have no hover, so every standings table also gets this legend.
  function badgeLegend() {
    const legend = document.createElement('p'); legend.className = 'badge-legend';
    legend.textContent = '± so với lượt trước. 🏆 Bất bại: chưa thua sau ít nhất 3 trận · 🔥 Chuỗi thắng: đang thắng từ 3 trận liên tiếp · 🛡️ Bot mẫu mực: không ván nào thua vì lỗi bot · 🚀 Ngược dòng: lên từ 5 hạng trở lên sau một lượt.';
    return legend;
  }
  const api = { HINTS, BADGES, explain, badgeText, rankChangeText, badgeCell, badgeLegend };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.OTT = Object.assign(root.OTT || {}, api);
})(this);
