# OTTv2 — Nền tảng thi đấu bot

Ứng dụng Node.js chạy trên localhost cho trò chơi Búa · Bao · Kéo trên bàn 9 × 9. Thí sinh nộp bot Python/C++; máy chủ kiểm tra và chạy bot trong Docker. Ban tổ chức quản lý tài khoản, chạy vòng tính điểm, xem replay và xuất bảng xếp hạng Elo.

## 1. Yêu cầu trước khi chạy

- **Node.js 24.16 trở lên**, có npm và SQLite tích hợp. Kiểm tra: `node --version` và `npm --version`.
- **Git** để lấy mã nguồn.
- **Docker Desktop trên Windows**, dùng WSL2 và Linux containers; hoặc Docker Engine Linux.
- Kernel cần **Landlock ABI ≥ 3, seccomp và cgroup v2**. Lệnh `npm run sandbox:check` kiểm tra môi trường thực tế. Nếu kiểm tra thất bại, không chạy bot ngoài Docker để thay thế.
- Cần Internet khi cài npm dependencies và build Docker image lần đầu. Mạng của container biên dịch/chạy bot luôn bị tắt.

## 2. Lấy code và cài đặt lần đầu

Mở terminal tại nơi muốn lưu dự án:

```powershell
git clone https://github.com/ThePlaceOfTangerine/OTTv2.git
cd OTTv2
npm ci
```

Mở Docker Desktop, chờ Docker Engine sẵn sàng, rồi chạy:

```powershell
npm run seed
npm run sandbox:build
npm run sandbox:check
npm start
```

**Lưu mật khẩu do `npm run seed` in ra.** Lệnh này tạo `admin` và `contestant01` đến `contestant20`, mỗi tài khoản có mật khẩu ngẫu nhiên. Mật khẩu chỉ hiển thị khi tài khoản được tạo; chạy lại seed không đổi mật khẩu đã tồn tại. Không có tài khoản/mật khẩu dùng chung được đóng gói trong repo.

Giữ terminal `npm start` hoạt động. Mở:

| Đường dẫn | Mục đích |
| --- | --- |
| http://127.0.0.1:3000/portal | Thí sinh: đọc hướng dẫn, tải mẫu, nộp bot, xem bảng điểm |
| http://127.0.0.1:3000/admin | Ban tổ chức: hướng dẫn điều hành, tài khoản, hàng đợi, vòng điểm |
| http://127.0.0.1:3000/docs/PROTOCOL.md | Tài liệu giao thức có giao diện |
| http://127.0.0.1:3000/legacy/ | Hai người chơi tự điều khiển quân |
| http://127.0.0.1:3000/legacy/spectator.html | Xem các trận chơi trực tiếp |

Mặc định chỉ lắng nghe `127.0.0.1`: máy khác không truy cập qua địa chỉ localhost này. Dừng server bằng **Ctrl+C**. Nếu đổi mã backend, dừng rồi chạy lại `npm start`; sau khi đổi giao diện, tải lại trang.

### Chạy lại vào những lần sau

```powershell
cd OTTv2
npm start
```

Docker cần đang hoạt động để xử lý bot. Không cần seed/build lại mỗi lần. Sau khi kéo code có thay đổi dependencies, chạy `npm ci`; nếu Dockerfile hoặc supervisor thay đổi, build/check image lại và khởi động lại server. Migration SQLite được áp dụng tự động khi mở DB; sao lưu dữ liệu trước khi cập nhật hệ thống đang dùng.

## 3. Quy trình cho ban tổ chức

Trang `/admin` có khung **Khởi động, chạy thử và điều hành giải** cùng các liên kết đến từng thao tác.

1. Đăng nhập bằng tài khoản `admin` đã tạo. Bấm **Kiểm tra Docker**, có thể chạy một trận giữa hai bot mẫu để xác minh môi trường. Trận mẫu không tính Elo.
2. Cấp tài khoản thí sinh qua CSV. Dòng đầu bắt buộc là `username,password`. Để trống mật khẩu để hệ thống tạo mật khẩu tạm:

   ```csv
   username,password
   team001,
   team002,
   ```

   Tối đa 1000 tài khoản/lần; nếu có dòng sai hoặc trùng tên, toàn bộ danh sách bị từ chối. Lưu mật khẩu trả về rồi chọn **Ẩn mật khẩu**. Gửi riêng thông tin cho từng thí sinh.
3. Thí sinh đăng nhập và đổi mật khẩu tạm trước khi sử dụng. Khi cần, admin chọn **Cấp lại mật khẩu** hoặc **Khóa**. Cấp lại mật khẩu hủy phiên cũ và yêu cầu đổi mật khẩu tạm lần nữa.
4. Theo dõi **Bộ xử lý và hàng đợi**. Bot cần vượt qua kiểm tra và được chọn làm phiên bản thi đấu; tài khoản không bị khóa. Có thể xem nhật ký và replay trận thử.
5. Có ít nhất hai bot đủ điều kiện thì tạo vòng tính điểm. Ví dụ hai bot: **2 ván mỗi bot / 2 ván mỗi cặp**. Chọn seed để xác định lịch ghép cặp và bố trí trận.
6. Theo dõi bảng điểm, mở từng trận hoặc xem trực tiếp khi có trận đang chạy. Khi hoàn tất, tải CSV và kiểm tra số ván trước khi công bố kết quả.

### Cách ghép cặp và tính điểm

- Số ván/cặp là số chẵn từ 2 đến 20. Mỗi cặp đổi bên trên cùng seed.
- Số ván/bot phải chia hết số ván/cặp. Số đối thủ = số ván/bot ÷ số ván/cặp, nhỏ hơn số bot. Nếu số bot lẻ, chọn số đối thủ chẵn. Ví dụ 3 bot: 4 ván/bot, 2 ván/cặp.
- Ghép cặp ngẫu nhiên theo seed, không bắt buộc mọi bot gặp nhau. Tối đa 100.000 ván/vòng; chỉ một vòng chưa hoàn tất tại một thời điểm.
- Danh sách thí sinh, luật và phiên bản bot được chốt khi tạo vòng. Thay bản đang chọn hoặc khóa tài khoản sau đó không sửa lịch vòng đã tạo.
- Mỗi vòng có Elo riêng bắt đầu **1500**, hệ số **K = 32**. Thắng/hòa/thua được 1/0,5/0 điểm; xếp theo Elo, rồi điểm, rồi ID để ổn định thứ tự.
- Elo được cập nhật theo thứ tự lịch đấu, không theo tốc độ worker. Cùng một thắng/một thua có thể không trở về 1500 vì Elo thay đổi sau từng ván.

### Phân biệt lỗi bot và lỗi máy chủ

- Lỗi cú pháp, chương trình dừng bất thường, quá thời gian hoặc đi sai luật: xem lý do/nhật ký, sửa bot và nộp bản mới. Bot gặp lỗi khi thi đấu bị xử thua theo luật.
- Lỗi Docker, worker hoặc hạ tầng: tự chạy lại, tối đa **3 lần tổng cộng**; sau đó tạm dừng. Sửa môi trường rồi dùng nút chạy lại. Không tính thua bot vì lỗi máy chủ.
- Bài/trận bị ngắt có thể cần chờ lease hết hạn (30 giây) trước khi được nhận lại. Heartbeat mỗi 5 giây.

## 4. Quy trình cho thí sinh

1. Mở `/portal`, đọc **Hướng dẫn và mã mẫu**, tải Python hoặc C++.
2. Đăng nhập và đổi mật khẩu được cấp. Mật khẩu mới ít nhất 12 ký tự, tối đa 72 byte.
3. Viết chiến thuật tại phần chọn nước đi trong mẫu. Bot đọc một dòng JSON từ stdin và trả một dòng JSON qua stdout; ghi debug vào stderr. Mỗi lượt chạy tiến trình mới, dùng `userdata` nếu cần nhớ thông tin.
4. Nộp `.py`, `.cpp` hoặc `.zip`. File đơn tối đa **1 MiB**; ZIP tối đa **5 MiB**, 64 file mã nguồn. Chỉ dùng một ngôn ngữ; C++ cho phép `.cpp/.h/.hpp`. ZIP không chứa executable, mật khẩu, symlink hay file lồng ZIP.
5. File đơn để trống đường dẫn file chính. Với ZIP, hệ thống tìm main.py/main.cpp; có thể nhập đường dẫn như `src/main.py`. C++ liên kết tất cả `.cpp`, chỉ nên có một hàm main.
6. Chờ: **Chờ kiểm tra → Kiểm tra mã → Chuẩn bị chương trình → Đấu thử → Hợp lệ/Cần sửa**. Hai trận thử đổi bên không tính điểm và không bắt buộc thắng bot mẫu.
7. Xem lý do, nhật ký và replay. Phiên bản hợp lệ mới nhất tự được chọn; có thể chọn lại bản cũ. Vòng đang thi đấu giữ phiên bản đã chốt.

Chi tiết: [Hướng dẫn sử dụng](docs/HUONG-DAN.md), [giao thức bot](docs/PROTOCOL.md).

## 5. Luật hiện hành và giới hạn

Classic v2: bàn 9 × 9, mỗi bên 10 quân theo tỷ lệ 3–3–4. Loại có 4 quân được chọn ngẫu nhiên theo seed, hai bên cùng cơ cấu; vị trí xáo riêng. Đi một ô theo tám hướng; Búa ăn Kéo, Kéo ăn Bao, Bao ăn Búa. Không đi vào ô có quân cùng bên hoặc quân đối thủ không ăn được.

Thắng khi chiếm nhà đối thủ, ăn hết quân đối thủ hoặc đối thủ hết nước hợp lệ. Hòa sau 500 nước tổng cộng hoặc lặp cùng bàn cờ và bên đến lượt ba lần; kiểm tra thắng trước hòa. Replay Classic v1 giữ cách chia quân cũ. Khu chơi trực tiếp chưa áp dụng điều kiện hòa/hết nước của engine bot.

Mặc định: 500 ms CPU/nước, 30 giây CPU/bot/trận, 3 giây phản hồi/nước, 180 giây thực tế cho vòng chạy nước đi, 256 MiB không gian địa chỉ tiến trình, 64 KiB stdout+stderr/nước, 16 KiB userdata. C++ dùng g++ 12 / C++17 với `-O2 -std=c++17`; Python 3.11, không cài thêm package. Giới hạn và lý do lỗi đầy đủ ở tài liệu giao thức.

## 6. Cấu hình và dữ liệu

| Biến môi trường | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `3000` | Cổng HTTP |
| `HOST` | `127.0.0.1` | Địa chỉ lắng nghe |
| `DB_PATH` | `data/arena.sqlite` | SQLite; dùng cùng giá trị khi seed và chạy server |
| `SUBMISSIONS_PATH` | `data/submissions` | Mã nguồn và chương trình bot đã chuẩn bị |
| `BOT_WORKERS` | `2` | Số bài kiểm tra đồng thời, từ 1 đến 4 |
| `DOCKER_BIN` | Tự tìm | Đường dẫn Docker CLI nếu không có trong PATH |
| `SANDBOX_IMAGE` | `ottv2-sandbox:phase3` | Tag image; artifact dùng image ID cố định |
| `COOKIE_SECURE` | `false` | Bật `true` khi trực tiếp phục vụ qua HTTPS |

Ví dụ PowerShell:

```powershell
$env:PORT = '3001'
$env:DB_PATH = 'data/demo.sqlite'
$env:SUBMISSIONS_PATH = 'data/demo-submissions'
npm run seed
npm start
```

Biến môi trường được đọc từ tiến trình; ứng dụng **không tự đọc file .env**. Trên Linux dùng cú pháp `PORT=3001 npm start`. Thay cổng/DB khi chạy nhiều bản thử, và dùng hostname riêng nếu muốn tách cookie trình duyệt: cookie cùng hostname có thể dùng chung giữa các cổng.

Dữ liệu không được đóng gói trong Git. Sao lưu **cả SQLite và SUBMISSIONS_PATH**; dừng server trước khi sao chép DB để tránh mất dữ liệu WAL đang ghi. Giữ bản sao khóa truy cập/mật khẩu ở nơi riêng, không commit. Server hiện là công cụ local; trước khi mở qua mạng cần cấu hình hạ tầng và HTTPS phù hợp.

Bộ xử lý bài nộp mặc định 2 slot, vòng điểm 1 slot riêng, trận mẫu tối đa 1 trận đồng thời. Tính tổng tải Docker từ cả ba nguồn khi điều chỉnh cấu hình.

## 7. Kiểm thử

```powershell
npm test
npm run test:sandbox
npm run test:pipeline
npm run test:templates
npm run test:scoring
npm run test:two-players
```

- `npm test`: auth, CSRF, quyền truy cập, mật khẩu, SQLite, luật, replay, ZIP và điều phối hàng đợi; không cần Docker.
- Các lệnh còn lại cần Docker/image sẵn sàng, dùng dữ liệu kiểm thử riêng; **chạy tuần tự**, tránh đồng thời với các job Docker khác vì có kiểm tra dọn container.
- `test:two-players`: hai phiên HTTP độc lập đổi mật khẩu, nộp multipart Python/C++, chờ kiểm tra, đấu đổi bên và xác minh điểm/CSV. Báo cáo tạo dưới `data/` và không commit.
- Không có cơ chế chạy mã bot trực tiếp trên host khi Docker bị lỗi.
- `npm run seed:bots` chỉ dùng với tài khoản/dữ liệu demo: nộp các bot tốt/lỗi qua pipeline, không dùng để khởi tạo bài thi thật.

## 8. Xử lý sự cố thường gặp

| Hiện tượng | Kiểm tra / cách xử lý |
| --- | --- |
| Không mở được trang | Giữ terminal npm start hoạt động; xem cổng và lỗi server. |
| Cổng đang được dùng | Dừng đúng server cũ hoặc chọn PORT khác; không dừng tiến trình chưa xác định. |
| Đăng nhập sai / mất mật khẩu | Kiểm tra mật khẩu đã lưu lúc seed. Admin có thể cấp lại mật khẩu thí sinh; seed không đặt lại mật khẩu. |
| Docker không được tìm thấy | Mở Docker Desktop; thêm CLI vào PATH hoặc đặt DOCKER_BIN. |
| Sandbox check thất bại | Kiểm tra Linux containers, kernel WSL2/Linux, image đã build và quyền truy cập Docker. |
| Build image lỗi mạng | Kiểm tra kết nối tải Debian/dependencies; build lại rồi chạy sandbox:check. |
| Chưa có bot đủ điều kiện | Thí sinh cần có bản Accepted đang được chọn và tài khoản không bị khóa. |
| Không tạo được vòng mới | Vòng cũ chưa hoàn tất hoặc số ván/đối thủ không khả thi. |
| Quá nhiều lần đăng nhập | Đợi cửa sổ giới hạn 15 phút; hạn áp dụng cho IP và tên tài khoản. |

Ví dụ Docker Desktop cài theo user trên Windows:

```powershell
$env:DOCKER_BIN = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe"
npm run sandbox:check
```

## 9. Cấu trúc dự án và quy tắc commit

```text
src/             Auth, SQLite, engine, sandbox, bài nộp, Elo
web/             Giao diện thí sinh, admin và tài liệu
public/          Game chơi trực tiếp và ảnh quân tại public/img/
rules/           Bộ luật mặc định có version
sandbox/         Dockerfile và supervisor tin cậy
bots/            Mã mẫu, bot tham chiếu và fixtures kiểm thử
scripts/         Seed tài khoản/bot demo và công cụ sandbox
test/            Unit/API/integration tests
docs/            Hướng dẫn sử dụng và giao thức
data/            Dữ liệu cục bộ, tự tạo, không commit
```

Giữ `package-lock.json` để người khác cài đúng dependencies. Không commit `node_modules/`, dữ liệu SQLite, mật khẩu, session, mã nộp thật, ảnh/báo cáo kiểm thử cục bộ hoặc `.env`. `npm ci` tạo lại node_modules. Ảnh runtime nằm ở `public/img/`; thư mục `img/` gốc là bản trùng cũ và đã loại khỏi Git. Các ghi chú phát triển cục bộ cũng được bỏ qua; vẫn giữ kiểm thử và fixtures cần cho việc xác minh chương trình.

Trước khi commit/push:

```powershell
npm test
git status --short
git diff --check
git add .
git diff --cached --stat
# Kiểm tra các file được stage trước khi tự tạo commit và push.
```

Hiện có auth, nộp bot, kiểm tra tự động, quản trị và vòng Elo. Đã có quản lý bộ luật có phiên bản và sandbox đấu thử theo luật. Bracket, cửa sổ nộp lại bot và kiểm thử tải toàn hệ thống 1000 bot chưa được triển khai. Giao diện chơi trực tiếp có tài nguyên font/thư viện từ CDN; các trang bot dùng tài nguyên nội bộ.

## 10. Quản lý bộ luật và sandbox luật

Tại /admin, mở **Quản lý bộ luật**. Chọn “Tạo bộ luật mới”, đặt tên, chỉnh JSON rồi lưu. Máy chủ cấp ID và version. Sửa bộ luật hiện có tạo phiên bản kế tiếp; bản cũ không bị ghi đè. Chọn phiên bản cũ để xem lại cấu hình. Nếu có người vừa sửa cùng bộ luật, tải lại trước khi lưu.

Trong **Đấu thử theo bộ luật**, chọn bộ luật và phiên bản, hai bot và seed, rồi chạy. Có thể ghép bot mẫu với bot thí sinh, hai bot thí sinh, hoặc cùng một bot ở cả hai bên. Mọi phiên bản thí sinh đã Accepted đều có thể được chọn. Trận giữ cấu hình luật và thông tin bot tại thời điểm tạo; thay luật hoặc đổi bot active sau đó không sửa trận cũ. Không cộng điểm, không thay Elo và không đổi bot active. Chọn “Xem trận” để xem replay, tự chạy hoặc tải nhật ký.

Vòng Elo hiện vẫn dùng Classic mặc định. Lưu luật mới không tự đổi luật vòng Elo. Chọn luật theo vòng bracket và cửa sổ nộp lại thuộc phase 6.

Chi tiết cấu hình, kiến trúc module và giới hạn: [RULE-SETS.md](docs/RULE-SETS.md). Kiểm thử Docker riêng cho phase này: npm run test:rules (cần image sandbox đã build và Docker đang chạy).
