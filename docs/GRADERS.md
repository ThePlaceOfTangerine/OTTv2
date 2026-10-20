# Máy chấm phân tán

Cập nhật: 19/10/2026. Áp dụng cho bản có migration 18 (Phase 2a) và backend sandbox của Phase 2b.

## Mô hình

- **Coordinator** là server `npm start`: giữ SQLite, hàng đợi, kết quả và artifact. Thí sinh và admin chỉ làm việc với coordinator.
- **Máy chấm (grader agent)** chạy `npm run grader` trên máy khác, tự lấy việc qua HTTP(S) nên chạy được sau NAT/LAN; nó không đọc DB. Hiện máy chấm xử lý ba loại việc: kiểm tra bài nộp (tải mã → quét → biên dịch → 2 trận thử), ván vòng loại và ván loại trực tiếp. Đấu thử của admin và vòng điểm/Elo cũ vẫn chạy trên coordinator.
- Mặc định coordinator cũng tự chấm (phù hợp một laptop). Đặt `LOCAL_GRADING=0` để chỉ máy chấm từ xa nhận việc. Thêm máy thứ 2 đến 6+ chỉ cần tạo khóa và chạy `npm run grader`; không đổi code.

## Thêm một máy chấm

1. Admin → **Giám sát** → **Máy chấm**: nhập tên, bấm **Tạo máy chấm**. Khóa bí mật chỉ hiện một lần cùng lệnh chạy.
2. Trên máy chấm: cài Node.js, Docker và **cùng image sandbox** với coordinator (xem dưới), sao chép thư mục dự án, `npm ci`.
3. Chạy lệnh đã hiện (PowerShell):

```powershell
$env:COORDINATOR_URL = 'http://IP-COORDINATOR:3000'
$env:GRADER_ID = 'g-...'
$env:GRADER_SECRET = '...'
$env:GRADER_SLOTS = '1'
npm run grader
```

`GRADER_SLOTS` là số việc chạy song song (1–16), mỗi việc dùng tối đa 2 container. Chọn theo số nhân CPU sau khi đo; chưa có số đo khuyến nghị. `GRADER_WORKDIR` đổi thư mục tạm (mặc định thư mục tạm của hệ điều hành). Ctrl+C dừng sau khi việc đang chạy gửi kết quả.

4. Bảng Máy chấm hiện trạng thái kết nối, lần liên lạc cuối, số việc đang chạy và image. **Thu hồi** khi máy bị mất; việc đang giữ được giao lại sau khi hết hạn giữ việc.

### Đăng ký hàng loạt bằng mã (USB máy chấm)

Admin → **Giám sát** → **Đăng ký máy chấm USB** → **Mở đợt đăng ký máy chấm**. Admin chọn tiền tố tên, số máy tối đa (1–500) và thời gian tự đóng (1–240 phút, mặc định 15).

Cách hoạt động:
- **Mã:** dạng `ott-…`, 192 bit ngẫu nhiên, chỉ hiện một lần. Coordinator chỉ lưu bản băm. Tại mỗi thời điểm chỉ một đợt được mở.
- **Đăng ký:** mỗi máy gọi `POST /api/graders/enroll` (không cần đăng nhập; mã chính là quyền) và nhận mã máy cùng khóa HMAC riêng, như khi tạo bằng tay. Số lượt dùng được đếm nguyên tử.
- **Hết hiệu lực:** mã trả 403 khi đợt đã đóng, hết giờ hoặc đủ số máy.

Agent đọc cấu hình đăng ký qua hai biến:
- `GRADER_CONFIG_FILE=<file grader.env>` chứa `COORDINATOR_URL`, `GRADER_ENROLL_CODE`, `GRADER_SLOTS`.
- `GRADER_CREDENTIALS_FILE` là nơi giữ khóa đã nhận, để dịch vụ khởi động lại không tốn lượt. Trên USB file này nằm trong RAM.

Xem [USB-BOOT.md](USB-BOOT.md).

## Backend sandbox (`SANDBOX_BACKEND`)

| Backend | Dùng khi | Cô lập |
| --- | --- | --- |
| `docker` (mặc định) | Coordinator/máy chấm có Docker | Container: tắt mạng, file system chỉ đọc, user 65534, cgroup RAM/CPU/PID; bên trong là Landlock + seccomp + rlimit của supervisor.py |
| `bwrap` | Máy chấm Windows qua distro WSL2 `ott-grader`, hoặc Linux | Chính supervisor.py trong bubblewrap: namespace riêng (không mạng), user 65534, không capability, /usr chỉ đọc, /tmp và /work riêng. Cùng mã lỗi với Docker (test:bwrap). Chưa có giới hạn cgroup tổng RAM/PID và dung lượng tmpfs như Docker; bot vẫn bị rlimit RAM và seccomp chặn fork |
| `windows-job` (EXPERIMENTAL) | Chỉ chế độ lớp học có giám sát | Job Object: giới hạn RAM, CPU (đo mỗi 10 ms), output, chặn tiến trình con. **Không chặn mạng và file system.** Python: `OTT_PYTHON`, nếu không đặt thì dùng `python\python.exe` trong gói lớp học, cuối cùng là `python` trong PATH. C++ (Phase 6): g++ từ `OTT_GXX`, `cpp\mingw64` trong gói, PATH hoặc Dev-C++/Code::Blocks; biên dịch `-O2 -std=c++17 -static` trong Job Object cho phép 8 tiến trình, chạy `bot.exe` mỗi nước; thư mục cài có dấu tiếng Việt thì báo không có C++. Image báo là `windows-job:python-x.y.z[+g++-a.b.c]` nên không nhận ván đã ghim image Docker. Xem [LOP-HOC.md](LOP-HOC.md) |

`npm run sandbox:check` kiểm tra backend đang chọn.

## Máy chấm Windows không cài Docker (WSL2)

1. Trên máy BTC có Docker: `npm run sandbox:build` rồi `powershell -ExecutionPolicy Bypass -File scripts/wsl/build-rootfs.ps1`. Kết quả `ott-grader.tar` dựng từ đúng image sandbox (cùng g++/Python) cộng bubblewrap, Node.js và mã dự án; ID image gốc được ghi vào `/opt/arena/IMAGE_ID`.
2. Trên từng máy chấm (bật WSL2): tạo khóa ở admin rồi chạy

```powershell
powershell -ExecutionPolicy Bypass -File scripts/wsl/setup-grader.ps1 -Rootfs D:ott-grader.tar -CoordinatorUrl http://IP-COORDINATOR:3000 -GraderId g-... -GraderSecret ... -Slots 1
wsl -d ott-grader -- /opt/ott/scripts/wsl/run-grader.sh
```

Script tạo distro riêng tên `ott-grader` (không đụng distro khác) tại thư mục `OTTv2-localwsl` cạnh dự án, cùng ổ với dự án (đổi bằng `-InstallDir`), lưu khóa trong `/etc/ott-grader.env` (chỉ user grader đọc được) và chạy kiểm tra sandbox. Gỡ bằng `wsl --unregister ott-grader`. Khi coordinator chạy trên cùng máy Windows, WSL2 không gọi được `127.0.0.1` của Windows ở chế độ mạng mặc định: dùng IP LAN của máy hoặc bật networkingMode=mirrored. Rootfs này sẽ dùng lại cho USB boot (Phase 7).

## Image giống nhau trên mọi máy

Mỗi bài được chốt theo **image ID** (SHA-256). Build lại image trên máy khác cho ID khác, khi đó ván sẽ lỗi hạ tầng và bị chặn sau 3 lần. Build một lần rồi sao chép:

```powershell
docker save ottv2-sandbox:phase3 -o ottv2-sandbox.tar   # trên coordinator
docker load -i ottv2-sandbox.tar                          # trên từng máy chấm
```

Đặt `GRADER_IMAGE=sha256:...` trên coordinator để từ chối máy chấm dùng image khác ngay khi nhận việc.

## Bảo mật và chịu lỗi

- Mỗi yêu cầu được ký HMAC-SHA256 trên phương thức, đường dẫn, thời điểm, nonce và băm nội dung; khóa không gửi qua mạng. Coordinator từ chối chữ ký sai, đồng hồ lệch quá 5 phút, nonce dùng lại (lưu trong bảng `grader_nonces`, còn hiệu lực sau khi khởi động lại) và máy đã thu hồi.
- Mỗi lần nhận việc có mã giữ việc riêng (lease 30 giây, gia hạn mỗi 5 giây). Máy chết thì việc tự về hàng đợi; kết quả đến muộn hoặc gửi lại bị bỏ qua, không cộng điểm trùng. Lỗi hạ tầng được thử lại tối đa 3 lần rồi chờ admin, không xử thua bot.
- Máy chấm gửi dấu phiên bản engine (băm src/game, mã kiểm tra bài và chạy ván). Lệch với coordinator thì không được nhận việc, để không chấm cùng giải bằng hai phiên bản luật; sau khi cập nhật mã phải dựng lại rootfs WSL (build-rootfs.ps1) và cài lại máy chấm. Admin → Máy chấm hiện dấu của coordinator.
- Coordinator kiểm tra replay khớp seed, luật và bot của việc được giao, rồi tự dựng lại ván bằng engine (`verifyReplay`); kết quả thắng/thua lấy từ replay đó.
- **Rủi ro còn lại (đã chấp nhận):** máy chấm có khóa hợp lệ vẫn có thể gửi một ván với nước đi hợp lệ nhưng không phải do bot thí sinh chọn. Chỉ cấp khóa cho máy do BTC quản lý; thu hồi ngay khi nghi ngờ.
- HMAC bảo vệ tính toàn vẹn, **không mã hóa**. Qua HTTP thường, mã nguồn và artifact đi dạng rõ; chỉ dùng HTTP trong LAN tin cậy, còn qua Internet dùng HTTPS (reverse proxy hoặc Cloudflare Tunnel).
- Khóa máy chấm nằm trong SQLite của coordinator. Ai đọc được file DB cũng sửa được điểm, nên phải bảo vệ chính file DB (quyền truy cập, sao lưu có mã hóa).

## Kiểm thử

- `npm test` gồm test/grader.test.js: HMAC/nonce/thu hồi, hai máy tranh cùng hàng đợi (mỗi bài chấm đúng một lần), máy chết giữa việc và kết quả muộn, replay giả bị từ chối, vòng loại do máy từ xa chơi.
- `npm run test:grader` (Docker, hoặc `SANDBOX_BACKEND=bwrap` trong distro): hai máy chấm thật kiểm tra bot Python/C++, chặn mạng, đọc /etc/passwd, fork bomb, ăn RAM, vòng lặp vô hạn được giấu khỏi bộ quét tĩnh, rồi chơi vòng loại bằng artifact đã truyền.
- `npm run test:bwrap-boot` và `npm run test:bwrap` (trong distro `ott-grader`): probe Landlock/seccomp và cùng bộ kiểm tra của test:sandbox.
- `npm run test:windows-job` (Windows): Python hợp lệ, crash, CPU, sleep, RAM, output, tiến trình con. C++ khi có g++ (đặt `OTT_GXX`/`OTT_CPP_INCLUDE` hoặc chạy trong gói): biên dịch, nước hợp lệ, lỗi biên dịch, crash, CPU, `system()`. Không có g++ thì báo `compiler_missing`. Chặn mạng/file là `todo`.
