# Nộp bài bằng GitHub

Cập nhật: 21/10/2026. Áp dụng cho bản có migration 17. Nộp file .py/.cpp/.zip vẫn giữ làm phương án dự phòng.

App thật của BTC: **ott-btc-nop-bai** (ID 5399450), thuộc Organization `ott-btc`, tạo ngày 21/10/2026. Quyền đã kiểm qua API: chỉ `contents: read` + `metadata: read`, sự kiện `push`. **Webhook đang tắt**, vì server chưa có địa chỉ công khai.

## Cách hoạt động

- Mỗi đội có một tài khoản do BTC nhập CSV, khai báo một repo GitHub **Private** và cài GitHub App của BTC vào repo đó (quyền chỉ đọc).
- Đội chứng minh sở hữu repo bằng file `ott-verify.txt` chứa mã portal cấp, commit ở nhánh mặc định. Một repo chỉ thuộc một đội đã xác minh; đăng ký repo của đội khác sẽ không qua bước kiểm tra mã.
- Nộp bài = bấm **Nộp commit mới nhất** ở mục Bot của tôi, hoặc push tag bắt đầu bằng `ott-submit` (cần webhook). Server ghi lại SHA; mỗi cặp (đội, giai đoạn, SHA) là một phiên bản bất biến. Nộp lại cùng SHA trả về cùng phiên bản.
- Khi hết hạn, server tự lấy commit cuối của nhánh mặc định **theo thời điểm server nhận webhook push**, không dựa vào timestamp của commit. Nếu commit đó lỗi, hệ thống dùng bản hợp lệ gần nhất của đội trong giai đoạn (cùng quy tắc chốt bot hiện có; bản đội đã chọn riêng vẫn được ưu tiên). Admin không chốt được bot cho đến khi lấy xong commit hạn nộp của mọi đội.
- Mã được tải dưới dạng zipball theo SHA từ máy chủ, ngoài sandbox, không chạy git. Vì vậy không có git hook, submodule hay LFS. Chỉ `ott.json` và file mã nguồn trong `bot/` được giải nén; các file khác bị bỏ qua. Biên dịch và chạy bot vẫn diễn ra trong sandbox như bài nộp file.

## Cấu trúc repo của đội

```text
ott.json            {"language": "python", "entry": "main.py"}
ott-verify.txt      mã OTT-... do portal cấp
bot/main.py         mã bot; có thể thêm file .py khác
```

Với C++: `{"language": "cpp", "entry": "main.cpp"}`, các file `.cpp/.h/.hpp` trong `bot/`. `entry` tính từ thư mục `bot/`.

Giới hạn: repo tối đa 50 MB (theo GitHub, tính cả lịch sử) và bản nén tải về tối đa 50 MB; tối đa 20.000 mục trong bản nén; trong `bot/` tối đa 64 file mã nguồn, mỗi file 1 MiB, tổng 5 MiB. Symlink trong `bot/` làm bài bị từ chối. Repo chuyển sang Public, commit bị xóa khỏi lịch sử hoặc App bị gỡ thì bài bị từ chối với lý do cụ thể, không tính là lỗi máy chủ.

## Thí sinh

1. Đăng nhập, đổi mật khẩu tạm, mở mục **Đội & GitHub**, điền 1–4 thành viên.
2. Tạo repo Private theo cấu trúc trên, nhập địa chỉ repo, bấm **Lưu repo** để nhận mã xác thực.
3. Bấm liên kết cài GitHub App, chọn *Only select repositories* và đúng repo.
4. Commit `ott-verify.txt` chứa mã, push lên nhánh mặc định, bấm **Xác minh repo**.
5. Ở mục **Bot của tôi**, chọn nơi nộp bài rồi bấm **Nộp commit mới nhất**; theo dõi kết quả như bài nộp file.

## Ban tổ chức: tạo GitHub App

**Cách nhanh (khuyên dùng):** tạo App dưới một Organization của BTC bằng một cú bấm.
1. Chạy `node scripts/github-app-manifest.js <organization> [--secrets <thư mục ngoài repo>]`.
2. Mở `http://127.0.0.1:47000` trên trình duyệt đang đăng nhập GitHub bằng tài khoản chủ tổ chức, bấm nút, rồi bấm **Create GitHub App for …** trên GitHub.
3. Script lưu `github-app-id.txt`, `github-app-slug.txt`, `github-app.pem`, `github-webhook-secret.txt` vào thư mục secrets (không in ra). `scripts/start-server.ps1` tự nạp các file này.
4. Quyền được đặt sẵn: chỉ đọc Contents, sự kiện Push, cài được trên mọi tài khoản. Webhook tắt cho tới khi server có địa chỉ công khai: khi đó vào trang App → **General** → bật Webhook *Active*, URL `https://<địa-chỉ>/api/github/webhook`, giữ nguyên secret.

Nên tạo dưới **Organization** của BTC (nhiều người cùng quản lý, không phụ thuộc tài khoản cá nhân). App tạo dưới tài khoản cá nhân vẫn chuyển sang Organization được (Advanced → Transfer ownership).

**Cách làm tay:**

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**. Tên App quyết định đường dẫn `https://github.com/apps/<slug>`.
2. Repository permissions: **Contents: Read-only**; Metadata: Read-only (bắt buộc). Không cấp quyền khác.
3. Webhook: bật Active, URL `https://<địa-chỉ-công-khai>/api/github/webhook`, đặt Secret ngẫu nhiên dài; Subscribe to events: **Push**. Nếu server không có địa chỉ công khai, tắt webhook. Khi đó hạn nộp chỉ đọc được HEAD qua API (xem rủi ro bên dưới) và tag `ott-submit` không hoạt động.
4. Cho phép cài trên mọi tài khoản (Any account) để đội cài vào repo cá nhân.
5. Tạo App, ghi App ID; **Generate a private key** và lưu file .pem ngoài thư mục dự án.
6. Khởi động server với biến môi trường (PowerShell):

```powershell
$env:GITHUB_APP_ID = '123456'
$env:GITHUB_APP_PRIVATE_KEY_PATH = 'D:\secrets\ott-app.pem'
$env:GITHUB_APP_SLUG = 'ten-app'
$env:GITHUB_WEBHOOK_SECRET = '<secret đã đặt ở bước 3>'
npm start
```

Không có `GITHUB_APP_ID` thì tính năng GitHub tắt; portal báo đội nộp bằng file. Mục **Thí sinh** của admin có bảng repo từng đội và cảnh báo khi hai đội nộp cùng SHA (cần xem xét đạo văn, hệ thống không tự chặn).

Với laptop làm server, có thể nhận webhook qua Cloudflare Tunnel. Quick tunnel đổi địa chỉ mỗi lần chạy, nên phải sửa lại Webhook URL của App; nên dùng named tunnel nếu có domain. Hãy kiểm tra lại hướng dẫn hiện hành của Cloudflare trước khi dùng.

## Form upload dự phòng và Cloudflare Turnstile

Đặt `TURNSTILE_SITE_KEY` và `TURNSTILE_SECRET` (tạo widget trong Cloudflare dashboard, đúng hostname của portal) thì form nộp file yêu cầu bước xác minh chống bot. Khi chạy LAN/offline, không đặt hai biến này: trình duyệt cần tải script từ challenges.cloudflare.com, và máy chủ cần gọi API xác minh.

## Rủi ro và giới hạn hiện tại

- Không có webhook: server đọc HEAD sau hạn và có thể mất vài phút cho nhiều đội. Commit đã được webhook ghi nhận sau hạn sẽ bị từ chối, nhưng nếu không có bản ghi webhook nào thì không phân biệt được push trong khoảng đó. Nên bật webhook cho giải thật.
- Laptop mất mạng lúc hết hạn: GitHub không tự gửi lại webhook thất bại. Có thể gửi lại thủ công trong trang Advanced của App; nếu không, hệ thống dùng HEAD đọc sau hạn với rủi ro như trên.
- Giới hạn tốc độ GitHub: client chờ theo `Retry-After`/`X-RateLimit-Reset` (tối đa 60 giây mỗi lần, 3 lần), sau đó tính là lỗi máy chủ và tự thử lại; lấy commit hạn nộp mỗi lượt 20 đội, 10 giây một lượt. Chưa đo với 1.000 repo thật.
- Chưa có kết nối Gitea/Git LAN cho chung kết offline (Phase 5).
