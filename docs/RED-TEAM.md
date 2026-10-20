# Red team OTTv2 (Phase 8)

Cập nhật: 20/10/2026. Dành cho ban tổ chức và người bảo trì.

Cách làm: thử tấn công từng bề mặt và giữ lại phép thử dưới dạng test tự động. Mỗi phát hiện đều ghi lại:
- mức độ, cách tái hiện, cách sửa;
- test chứng minh đã chặn;
- số đo trước/sau, nếu có.

Thang mức độ:
- **Nghiêm trọng:** mất dữ liệu hoặc chiếm quyền.
- **Cao:** dừng giải, hoặc vượt sandbox / tường lửa.
- **Trung bình:** cần điều kiện đặc biệt.
- **Thấp:** chỉ là khuyến nghị.

Theo quyết định Phase 8: mức Cao và Nghiêm trọng sửa ngay kèm test; mức Trung bình sửa nếu nhỏ; mức Thấp ghi vào [RUNBOOK.md](RUNBOOK.md).

Chạy lại:
- `npm test`: gồm `test/redteam.test.js` và các test bảo mật kể ở bảng dưới.
- `npm run test:bwrap`: trên Linux/WSL có máy chấm.
- `npm run usb:test -- thisinh --grub-lock`.

## Phát hiện và đã sửa

| # | Mức | Bề mặt | Phát hiện | Cách sửa | Bằng chứng |
|---|---|---|---|---|---|
| F1 | Cao | Đăng nhập | Mỗi lần đăng nhập, **kể cả đúng mật khẩu**, đều bị tính vào giới hạn 10 lần / 15 phút của mỗi IP. Sau Cloudflare Tunnel hoặc NAT phòng máy, mọi người chung một IP. Thử tải: 4.000 lượt đăng nhập thì **3.990 lượt bị 429**. | Đăng nhập đúng trả lại lượt đã tính; ngưỡng theo IP là 10× ngưỡng tài khoản (100 lần **sai** / 15 phút); vẫn tính trước khi kiểm mật khẩu để chặn dò song song. | `test/auth.test.js` (30 lần đăng nhập đúng cùng IP; 20 lần sai thì khóa); thử tải sau khi sửa 4.000/4.000. |
| F2 | Cao | Đăng nhập | Băm mật khẩu bằng `bcryptjs` (JavaScript thuần, chạy trên luồng chính). 4.000 lượt mất **950 giây**, 605 lượt quá 60 giây; máy chủ không phản hồi (health p95 60 giây). Kẻ xấu gửi nhiều lượt đăng nhập là làm treo được cả giải. | `scrypt` của `node:crypto` (N=2^15, r=8, p=3 theo OWASP) chạy native trên thread pool; `UV_THREADPOOL_SIZE` theo số nhân. Hash bcrypt cũ vẫn dùng được và được băm lại khi đăng nhập (chỉ trên máy giữ quyền hệ thống). | `test/passwords.test.js`; thử tải: 4.000 lượt trong **105 giây**, health p95 114 ms ([CAPACITY.md](CAPACITY.md)). |
| F3 | Cao | Sandbox bwrap (USB/WSL máy chấm) | `/tmp` và `/work` là tmpfs không giới hạn. `RLIMIT_FSIZE` chỉ chặn từng file 8 MB, nên bot ghi **616 MB RAM chỉ trong một nước 0,5 giây**; cả ván làm cạn RAM máy chấm (USB máy chấm chạy hoàn toàn trong RAM). Docker đã giới hạn 16/64 MB. | `bwrap --size`: `/tmp` 16 MB, `/work` 64 MB, giống Docker. | Fixture `bots/fixtures/disk` trong `test/sandbox.integration.js`: trước khi sửa `cpu_timeout` sau 616 MB; sau khi sửa `bot_crash` "DISK_FULL 16MB" sau 33 ms (`test:bwrap` đạt 4/4). Chưa chạy fixture này với backend Docker (image sandbox Docker không có sẵn trên máy đo); Docker vốn đã có giới hạn này. |
| F4 | Cao | USB thí sinh/máy chấm | Menu GRUB sửa được: bấm `e`, thêm `init=/bin/sh` là có **shell root**, tắt được tường lửa. | `password_pbkdf2` (100.000 vòng) cho người dùng `btc`; mục khởi động `--unrestricted` nên máy vẫn tự khởi động; mật khẩu đặt bằng `OTT_GRUB_PASSWORD` lúc dựng, chỉ lưu bản băm. Menu GRUB hiện cả trên màn hình và cổng serial. | `npm run usb:test -- thisinh|grader --grub-lock [--bios]`: bấm `e` thì GRUB hỏi tài khoản, không mở trình sửa; đạt trên **cả hai ảnh**, UEFI Secure Boot và BIOS; máy vẫn tự khởi động (test khởi động đầy đủ đạt sau khi khóa). |
| F5 | Cao | Máy chủ (khả dụng) | Bảng vòng loại 1.000 đội được tính lại và serialize ở mỗi lượt xem (15 ms, 349 KB); `settle()` đọc lại mọi ván kèm replay sau mỗi kết quả. Với 4.000 người xem, máy chủ quá tải trong vòng loại: đứng 48–55 s, client lỗi kết nối. Một nhóm người cũng có thể cố ý gây tình trạng này. | Bảng xếp hạng lưu đệm theo dữ liệu đầu vào; trang thí sinh dựng lại tối đa 2 s/lần, đã serialize + gzip; `settle()` chỉ xét cặp vừa có kết quả; gzip cho JSON lớn; keep-alive 65 s. | Thử tải 1.000 đội × 8 lượt: 0 lỗi, xem bảng p95 0,29 s, health max 1,3 s ([CAPACITY.md](CAPACITY.md)); `test/performance.test.js`. |

Đã tìm và sửa ở Phase 7 (kiểm thử USB trong QEMU), ghi lại để đủ hồ sơ:

| # | Mức | Phát hiện | Cách sửa |
|---|---|---|---|
| P7-1 | Cao | live-boot mount mọi ổ của máy (kể cả ổ cứng) để tìm file persistence; số lần mount của ổ thay đổi. | `persistence-storage=filesystem`; test khởi động kiểm byte ổ INTERNAL không đổi. |
| P7-2 | Trung bình | Bài vừa lưu bị mất nếu tắt máy ngay. | `vm.dirty_expire_centisecs=200` trên USB thí sinh. |
| P7-3 | Trung bình | File chép từ ổ Windows mang quyền 777 trong ảnh USB. | rsync với quyền cố định, chủ sở hữu root. |

## Đã thử và không tìm thấy lỗ hổng

| Bề mặt | Phép thử | Test |
|---|---|---|
| Quyền admin | Gọi **mọi** route `/api/admin/*` (lấy từ router Express) khi chưa đăng nhập (phải 401) và bằng tài khoản thí sinh (phải 403) | `test/redteam.test.js` |
| Truy cập chéo đội | Đọc, xem trận thử, chạy lại, chọn bài của đội khác; xem bảng vòng loại/loại trực tiếp của giải mình không tham gia | `test/redteam.test.js` |
| CSRF và cookie | Thiếu token, token của phiên khác, đăng nhập từ trang khác (`Origin`, `Sec-Fetch-Site`); cookie HttpOnly + SameSite=Strict | `test/redteam.test.js` |
| Header | CSP `default-src 'self'` + `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` ở portal/admin/setup/site; API `no-store` | `test/redteam.test.js` |
| Đọc file ngoài thư mục | `%2e%2e`, `..%2f`, `....//` qua `/assets`, `/site`, `/img`, `/legacy` | `test/redteam.test.js` |
| Body quá lớn | JSON > 256 KB → 413 | `test/redteam.test.js` |
| XSS | Không có `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` trong `web/`, `web-public/`; `replay.html` thoát được thẻ script | `test/redteam.test.js`, `test/classroom-ux.test.js` |
| Bài nộp độc | ZIP traversal/symlink/bomb/lồng nhau, file nhị phân, import/hàm cấm (báo đúng dòng) | `test/submissions.test.js`, `test/classroom-ux.test.js` |
| Sandbox | crash, vòng lặp, sleep, mạng, đọc `/etc/passwd`, fork, bộ nhớ, in quá nhiều, ghi đầy đĩa | `test/sandbox.integration.js` (Docker và bwrap), `test/windows-job.integration.js` |
| Máy chấm giả mạo | Sai HMAC, timestamp cũ, nonce dùng lại, máy đã thu hồi, replay bị sửa | `test/grader.test.js` |
| Đăng ký máy chấm | Mã sai/hết hạn/đã đóng/đủ số máy; chỉ lưu bản băm mã | `test/usb.test.js` |
| Webhook GitHub | Sai HMAC, gửi lại delivery cũ | `test/github.test.js` |
| Trang cài đặt `/setup` | Gọi từ máy khác, sai `Host` (DNS rebinding), từ trang web khác; sau khi có admin | `test/setup.test.js` |
| Đồng bộ bundle | Sửa một byte, giả manifest, sai passphrase, máy lạ, máy không giữ quyền | `test/sync.test.js` |
| Site công khai | Không lộ email, tên thành viên, mã nguồn | `test/publications.test.js` |
| Tường lửa USB thí sinh | Internet, cổng khác trên máy chủ, DNS, ổ của máy | `npm run usb:test -- thisinh` |

## Còn lại (chấp nhận hoặc theo dõi)

| Mức | Nội dung | Xử lý |
|---|---|---|
| Thấp | `/legacy` (game trực tiếp cũ) không có CSP và dùng `innerHTML`; tên người chơi đã được server escape | Không dùng `/legacy` trong giải chính thức. Ghi trong RUNBOOK. |
| Trung bình | Máy thí sinh: ai có quyền vào BIOS/chọn ổ khởi động có thể chạy hệ điều hành khác | Giám thị, mật khẩu BIOS ([RISKS.md](RISKS.md) R13). |
| Trung bình | `windows-job` (lớp học) không chặn mạng/file | Chỉ dùng có giám sát, kết quả không chính thức (D13). |
| Thấp | Bot có thể tiêu thụ hết 30 giây CPU mỗi ván để làm chậm giải | Tính trong [CAPACITY.md](CAPACITY.md) theo trường hợp xấu nhất. |
| Thấp | Mật khẩu GRUB chung cho mọi USB của một lần dựng | Đổi khi dựng ảnh cho giải mới. |
