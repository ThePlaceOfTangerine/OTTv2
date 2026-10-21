# Hướng dẫn tải, cài đặt và sử dụng OTTv2

Cập nhật: 20/10/2026. Tài liệu dành cho người tải dự án lần đầu và ban tổ chức. Giáo viên dùng gói lớp học (không cần Git, npm, Docker hay quyền quản trị) xem [LOP-HOC.md](LOP-HOC.md). Đây là hướng dẫn chạy bản hiện tại; các chức năng chưa hoàn thành được theo dõi trong [TODO](../TODO.md).

## 1. Chuẩn bị

- Node.js từ 24.16 trở lên và npm. Dự án dùng SQLite tích hợp của Node.
- Git nếu tải bằng lệnh clone; hoặc tải ZIP mã nguồn và giải nén.
- Windows: Docker Desktop chạy Linux containers với WSL2; Linux: Docker Engine.
- Sandbox cần Landlock ABI từ 3, seccomp và cgroup v2. Phải kiểm tra trên chính máy sẽ chấm bot.
- Internet để tải dependencies và dựng image lần đầu. Python, g++ và thư viện biên dịch nằm trong image; không cần cài riêng trên host để chấm bot bằng runner hiện tại.

Kiểm tra trong terminal:

```text
node --version
npm --version
git --version
```

## 2. Tải và cài lần đầu

```text
git clone https://github.com/ThePlaceOfTangerine/OTTv2.git
cd OTTv2
npm ci
```

Nếu tải ZIP, mở terminal tại thư mục có package.json rồi chạy npm ci; không cần clone lại. Đường dẫn mã nguồn dùng cho Docker không được chứa dấu phẩy.

Mở Docker Desktop và chờ Engine sẵn sàng (Linux cần dịch vụ Docker hoạt động), rồi chạy lần lượt:

```text
npm run seed
npm run sandbox:build
npm run sandbox:check
npm start
```

Chỉ tiếp tục thử bot khi sandbox:check báo môi trường khả dụng. Không chạy mã bot trực tiếp trên host để thay cho sandbox bị lỗi. Lần build đầu có thể mất thời gian để tải image và compiler.

## 3. Đăng nhập và mở ứng dụng

Giữ terminal npm start đang chạy. Trình duyệt mở:

| Địa chỉ | Người sử dụng |
| --- | --- |
| http://127.0.0.1:3000/admin | Ban tổ chức |
| http://127.0.0.1:3000/portal | Thí sinh |
| http://127.0.0.1:3000/legacy/ | Khu chơi trực tiếp cũ |

Seed tạo admin với mật khẩu ban đầu admin và 20 tài khoản contestant01 đến contestant20, mật khẩu ban đầu trùng tên. Thí sinh phải đổi mật khẩu ở lần đăng nhập đầu. Chạy seed lại không đặt lại mật khẩu tài khoản đã có. Đây là thông tin mặc định của bản local; không mở dịch vụ với thông tin mặc định cho giải thật. Đổi mật khẩu admin và chuẩn bị cấu hình mạng an toàn vẫn có các việc chưa hoàn thành trong TODO.

Tắt server bằng Ctrl+C. Những lần sau chỉ cần mở Docker và chạy npm start từ thư mục dự án; không cần seed hay build mỗi lần.

## 4. Ban tổ chức chạy một giải

1. Vào admin, kiểm tra Docker và chạy đấu thử bằng bot mẫu.
2. Tạo/cấp tài khoản đội bằng CSV `team_id,password_temp,team_name,leader_email` (để trống password_temp thì hệ thống tự tạo); định dạng cũ chỉ có cột username vẫn dùng được. Thông tin đăng nhập cần gửi riêng cho từng đội. Muốn đội nộp bằng GitHub, cấu hình GitHub App theo [hướng dẫn GitHub](GITHUB.md).
3. Vào **Giải đấu**, tạo giải, chọn đúng phiên bản luật và cấu hình số lượt/số đội đi tiếp/số ván. Số lượt vòng loại phải nhỏ hơn số bot thực tế.
4. Chọn đội rồi bấm **Lưu danh sách đội**. Tick đội chưa đồng nghĩa đã lưu.
5. Mở nhận bài theo lịch, yêu cầu thí sinh chọn đúng nơi nộp. Đóng nhận bài hoặc chờ hết hạn; chờ hàng đợi kiểm tra xong rồi chốt bot vòng loại.
6. Bắt đầu vòng loại tính điểm; chỉ tạo lượt tiếp theo sau khi lượt hiện tại hoàn tất.
7. Kiểm tra bảng điểm và duyệt số đội đi tiếp. Danh sách/hạt giống sau duyệt được giữ cố định.
8. Nếu đổi luật, chốt phiên bản chính thức, công bố thông báo và mở đợt nộp lại. Đóng nhận bài, chờ kiểm tra xong rồi chốt bot chính thức. Mọi đội đi tiếp cần bài hợp lệ trong đợt mới; không tự lấy bot cũ để thay thế.
9. Tạo sơ đồ loại trực tiếp; chọn chạy toàn bộ hoặc điều khiển từng cặp/vòng. Xem kết quả và bản xem lại.
10. Kiểm tra chung kết rồi duyệt kết quả và kết thúc giải.

**Vòng điểm/Elo cũ là luồng riêng**, không quyết định hạt giống hoặc vô địch của mục Giải đấu.

Vòng loại và loại trực tiếp có tạm dừng/tiếp tục/hủy kèm lý do. Tạm dừng để ván đã nhận chạy xong; hủy chỉ sau khi hết ván đang chạy và không thể tiếp tục. Giải đang chuẩn bị/nhận bài có nút hủy riêng. Đọc [quy tắc và thao tác chi tiết](QUY-TAC-GIAI-DAU.md) trước các bước chốt/hủy.

## 5. Thí sinh nộp bot

1. Đăng nhập portal, đổi mật khẩu tạm khi được yêu cầu.
2. Mở hướng dẫn và tải bot mẫu Python hoặc C++.
3. Chọn **Nơi nộp bài** đúng giải/giai đoạn; đọc mô tả luật, thông báo và hạn nộp theo giờ Việt Nam. Luyện tập ngoài giải không tự trở thành bài thi.
4. Nộp file .py, .cpp hoặc ZIP; khai báo file chạy nếu cần. Một file mã nguồn tối đa 1 MiB, ZIP tối đa 5 MiB. Nếu BTC bật GitHub: điền thành viên và xác minh repo ở mục **Đội & GitHub**, rồi bấm **Nộp commit mới nhất**; khi hết hạn hệ thống tự lấy commit cuối đã push trước hạn. Xem [nộp bằng GitHub](GITHUB.md).
5. Giữ mã biên nhận, theo dõi kết quả kiểm tra, xem chi tiết lỗi và bản xem lại. Chỉ bài hợp lệ mới được chọn để thi đấu.
6. Có thể chọn riêng bài hợp lệ trong giai đoạn trước hạn. Nếu chưa chọn, hệ thống dùng bản hợp lệ mới nhất trong chính giai đoạn đó. Sau chốt, bot không thay đổi theo lần nộp tiếp theo.
7. Khi có đợt nộp lại chính thức, chọn đúng đợt mới và nộp lại; bài vòng loại không tự chuyển sang.

Bot cần đọc luật, trạng thái và danh sách nước hợp lệ từ máy chủ, tránh cố định bàn cờ trong mã. Xem [giao thức](PROTOCOL.md) và [hướng dẫn bot](HUONG-DAN.md).

## 6. Dữ liệu và cập nhật dự án

Dữ liệu mặc định ở data/arena.sqlite và data/submissions. Git không chứa DB, tài khoản, bài nộp, node_modules hoặc bản sao lưu; người tải dự án cần seed để có tài khoản ban đầu.

Trước cập nhật: dừng server, sao lưu toàn bộ data/ cùng phiên bản mã nguồn và thông tin image đang dùng. Sao lưu DB đơn lẻ không đủ khôi phục artifact bot. Không xóa data/ để sửa lỗi vì sẽ mất dữ liệu. Quy trình khôi phục sang máy khác còn cần nghiệm thu riêng.

Nếu cài bằng Git và không có thay đổi local cần giữ:

```text
git pull --ff-only
npm ci
npm run sandbox:build
npm run sandbox:check
npm start
```

Nếu Git báo có thay đổi local hoặc xung đột, giữ/sao lưu công việc đó trước khi cập nhật; không reset cưỡng bức. SQLite tự chạy migration khi khởi động nên phải backup trước. Sau sửa backend cần khởi động lại server; sau sửa giao diện dùng Ctrl+F5.

## 7. Chạy qua mạng và cấu hình

Mặc định HOST=127.0.0.1, PORT=3000; địa chỉ này chỉ dùng trên máy chạy server. Ví dụ mở cho LAN trong PowerShell:

```powershell
$env:HOST = '0.0.0.0'
$env:PORT = '3000'
npm start
```

Linux:

```sh
HOST=0.0.0.0 PORT=3000 npm start
```

Thí sinh truy cập http://IP-LAN-CUA-SERVER:3000/portal; thay IP bằng địa chỉ thực, kiểm tra firewall và cùng mạng. Chỉ dùng trong LAN thử nghiệm tin cậy khi các mục bảo vệ mạng chưa hoàn tất. Không dùng 0.0.0.0 làm địa chỉ truy cập.

Các biến môi trường khác: DB_PATH (file SQLite), SUBMISSIONS_PATH (thư mục bài/artifact), SANDBOX_IMAGE (image chấm), DOCKER_BIN (đường dẫn Docker), BOT_WORKERS (số việc kiểm tra bài đồng thời), COOKIE_SECURE=true khi dùng HTTPS. Nộp bằng GitHub: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PATH (hoặc GITHUB_APP_PRIVATE_KEY), GITHUB_APP_SLUG, GITHUB_WEBHOOK_SECRET; chống bot cho form upload: TURNSTILE_SITE_KEY, TURNSTILE_SECRET (không đặt khi chạy offline). Chi tiết trong [GITHUB.md](GITHUB.md). Máy chấm phân tán: LOCAL_GRADING=0 để coordinator không tự chấm, GRADER_IMAGE để bắt buộc image; trên máy chấm chạy `npm run grader` với COORDINATOR_URL, GRADER_ID, GRADER_SECRET, GRADER_SLOTS (tạo khóa ở admin → Giám sát). Chọn sandbox bằng SANDBOX_BACKEND=docker (mặc định), bwrap (WSL2/Linux) hoặc windows-job (lớp học, thử nghiệm, chưa chặn mạng/file; Python qua OTT_PYTHON hoặc python\ trong gói, C++ qua OTT_GXX/cpp\/Dev-C++, header thêm qua OTT_CPP_INCLUDE). File data/settings.json (do trang /setup ghi, đổi chỗ bằng OTT_SETTINGS) bổ sung SANDBOX_BACKEND, HOST, PORT khi các biến này chưa được đặt. Khi chưa có tài khoản admin, mở /admin trên chính máy chủ sẽ chuyển sang trang cài đặt lần đầu. Xem [GRADERS.md](GRADERS.md). Công bố kết quả: PUBLIC_SITE_DIR (thư mục site tĩnh, mặc định data/public-site, xem tại /site/), PUBLIC_SITE_URL, SITE_AUTO_DEPLOY=1, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_PAGES_PROJECT, WRANGLER_VERSION, GOOGLE_SERVICE_ACCOUNT_FILE, GOOGLE_SHEET_ID; lệnh npm run site:build / site:deploy. Xem [PUBLISHING.md](PUBLISHING.md). Trên Windows có thể chạy `powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 [-AutoDeploy]`: script đọc khóa Cloudflare/Google trong thư mục secrets ngoài repo (mặc định `E:\OTTv2-local\secrets`: `cloudflare-token.txt`, `cloudflare-account.txt`, `google-sa.json`, `google-sheet-id.txt`), đặt biến rồi `npm start`. Thi LAN và sự cố: SNAPSHOT_DIR (ổ ngoài, bắt buộc tự đặt), SNAPSHOT_INTERVAL_MINUTES (mặc định 15), SNAPSHOT_KEEP (mặc định 24); lệnh npm run offline:check (kiểm tra máy trước ngày thi) và npm run restore -- <snapshot> (khôi phục khi server đã dừng). Nhập bài từ thư mục/USB ở mục Giải đấu. Thử tải và đo (Phase 8, chạy trên Linux/WSL): node scripts/load-test.js, node scripts/load-real-games.js, node scripts/bench-standings.js <db> (xem CAPACITY.md). Mật khẩu được băm bằng scrypt; tài khoản cũ dùng bcrypt tự chuyển ở lần đăng nhập đầu. USB boot (phòng thi): OTT_GRUB_PASSWORD đặt mật khẩu khóa menu GRUB khi dựng ảnh; npm run usb:build -- grader|thisinh [--with-wifi], npm run usb:test -- grader|thisinh [--bios], npm run usb:config -- grader|thisinh|check (cần distro WSL ott-build, xem USB-BOOT.md); máy chấm đăng ký bằng mã dùng GRADER_CONFIG_FILE và GRADER_CREDENTIALS_FILE. Chạy thử bot cục bộ: npm run ott-run -- <main.py|main.cpp|bot.zip> (xem LOP-HOC.md). Đồng bộ máy online ↔ LAN: npm run sync (identity, add-peer, export, import), passphrase qua OTT_SYNC_PASSPHRASE hoặc gõ khi được hỏi. Xem [RUNBOOK.md](RUNBOOK.md). DB_PATH và SUBMISSIONS_PATH cần được cấu hình nhất quán để không trộn dữ liệu giữa môi trường. Server hiện đọc biến môi trường của tiến trình, không tự nạp file .env. File tạm khi chấm (thư mục ott-source-*, helper windows-job, thư mục làm việc của máy chấm) nằm trong thư mục tạm của hệ điều hành; muốn giữ chúng ngoài ổ C, đặt `$env:TEMP` và `$env:TMP` (ví dụ E:OTTv2-local	mp) trước khi chạy npm start hoặc npm run grader.

Triển khai Internet cần cấu hình HTTPS/proxy, tài khoản và đánh giá tải trước; xem [phương án triển khai](DEPLOYMENT.md). Dự án chưa được chứng nhận chịu tải 150 đội đồng thời.

## 8. Lỗi thường gặp

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| Không mở được trang | Terminal npm start còn chạy? Đúng máy, IP và cổng? |
| Cổng 3000 đã được dùng | Dừng đúng server cũ hoặc chọn PORT khác. |
| Docker không khả dụng | Mở Engine, kiểm tra Linux containers/WSL2 và chạy sandbox:check. |
| Thiếu image sau cập nhật | Chạy sandbox:build rồi sandbox:check. |
| API mới báo không tìm thấy | Khởi động lại backend sau cập nhật; Ctrl+F5 trình duyệt. |
| Không nộp được | Kiểm tra đúng giai đoạn, quyền đội, hạn nộp, trạng thái hủy/chốt và kích thước file. |
| Không chốt bot được | Chờ hết hàng đợi, xử lý lỗi hạ tầng, kiểm tra đủ bài hợp lệ. |
| Chọn đội nhưng không mở được giải | Bấm Lưu danh sách đội, kiểm tra ít nhất hai tài khoản hoạt động. |
| Mọi ván đều hòa ở demo | Demo 6 đội dùng luật rút gọn 8 nước; không dùng để đánh giá sức mạnh bot. |

## 9. Kiểm thử và bảo trì tài liệu

npm test chạy bộ kiểm thử unit/API. npm run test:stages kiểm tra luồng giai đoạn/giải bằng Docker; các test Docker cần Engine/image hoạt động, có thể mất thời gian. Không cần Docker nhưng cần Python: npm run test:ott-run (chạy thử bot cục bộ) và npm run test:windows-job (Windows). Xem các lệnh test:* trong package.json. Không chạy script demo-six-teams.js trên DB thật nếu chưa chủ động sao lưu và chấp nhận tạo dữ liệu mẫu.

Người sửa dự án phải cập nhật tài liệu này cùng README khi đổi yêu cầu môi trường, lệnh cài/chạy, tài khoản ban đầu, biến môi trường, luồng sử dụng hoặc giới hạn tính năng. Cập nhật ngày và TODO kèm bằng chứng thực tế. Nếu sửa quy tắc giải, cập nhật QUY-TAC-GIAI-DAU.md rồi chạy node scripts/build-tournament-guide.js để trang hướng dẫn admin đồng bộ. Không đánh dấu thử tải/khôi phục/triển khai là hoàn thành chỉ vì đã có mã.
