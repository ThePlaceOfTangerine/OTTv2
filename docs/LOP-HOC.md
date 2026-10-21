# Gói lớp học OTTv2 (THCS, THPT)

Cập nhật: 20/10/2026.

Gói lớp học dành cho phòng máy trường phổ thông. Đặc điểm của các phòng máy này:

- Máy bị đóng băng ổ C (Deep Freeze, Shadow Defender), khởi động lại là mất dữ liệu trên ổ C.
- Người dùng không có quyền quản trị, không cài được Docker hay WSL2.
- Học sinh chủ yếu học Python; đội tuyển dùng C++.

Giải lớn ở đại học (khoảng 1.000 đội, Docker/WSL2, máy chấm phân tán) vẫn dùng cách cài trong [CAI-DAT-VA-SU-DUNG.md](CAI-DAT-VA-SU-DUNG.md).

## Giáo viên: chạy trong 3 bước

1. **Giải nén** `OTTv2-lop-hoc.zip` (khoảng 46 MB) vào USB hoặc ổ D.
   - Không đặt ở ổ C nếu máy bị đóng băng.
   - Thư mục phải có **tên không dấu**, ví dụ `D:\OTTv2`. g++ không chạy được trong thư mục có dấu tiếng Việt; Python thì vẫn chạy.
2. **Bấm đúp `start.bat`.**
   - Cửa sổ đen là máy chủ; đóng cửa sổ này để tắt.
   - Lần đầu chạy, trình duyệt tự mở trang cài đặt `http://127.0.0.1:3000/setup`.
3. **Làm theo trang cài đặt.**
   - Tạo tài khoản giáo viên. Mật khẩu ít nhất 12 ký tự; không có cách lấy lại nếu quên.
   - Chọn **mức tin cậy** (xem bảng bên dưới).
   - Tùy chọn: bật "Cho máy học sinh vào bằng mạng LAN".
   - Tùy chọn: dán danh sách lớp dạng CSV, dòng đầu là `username`. Hệ thống tạo tài khoản (mật khẩu ban đầu trùng tên, học sinh đổi ở lần đăng nhập đầu) và một "Giải luyện tập" gồm cả lớp. Trang chỉ hiện danh sách mật khẩu một lần; bấm "In danh sách".

   Máy chủ tự khởi động lại để áp dụng cài đặt, rồi trang chuyển sang nút vào trang quản trị.

Trang cài đặt có các giới hạn bảo vệ sau:

- Chỉ mở được bằng trình duyệt trên chính máy chủ, qua địa chỉ 127.0.0.1 hoặc localhost.
- Từ chối yêu cầu đến từ trang web khác.
- Tự khóa sau khi đã có tài khoản quản trị.

Muốn đổi mức tin cậy về sau thì sửa `data\settings.json` rồi chạy lại `start.bat`. Biến môi trường (nếu có) luôn được ưu tiên hơn file này.

| Mức tin cậy | Cách chạy bot | Dùng khi |
|---|---|---|
| Lớp học có giám sát | `windows-job`: Job Object của Windows giới hạn CPU, bộ nhớ, dữ liệu xuất và cấm tạo tiến trình con. **Không chặn mạng và file.** Không cần quyền quản trị. | Giờ học có giáo viên. Kết quả là **không chính thức**; trang quản trị luôn ghi "Chế độ lớp học". |
| Giải chính thức | Docker (cách ly đầy đủ như máy chấm thật). | Máy có Docker đang chạy. |

**Lớp học C++.** Máy chủ dò g++ theo thứ tự sau:

1. Thư mục `cpp\` trong gói.
2. Biến `OTT_GXX`.
3. `g++` trong `PATH`.
4. Dev-C++ hoặc Code::Blocks cài ở `Program Files`.

Nếu phòng máy chưa có g++, giải nén `OTTv2-add-cpp.zip` (khoảng 41 MB, g++ 12.2 WinLibs rút gọn) vào **chính** thư mục OTTv2 để tạo ra `cpp\`, rồi chạy lại `start.bat`. Bot C++ được biên dịch với `-O2 -std=c++17 -static`, có sẵn `nlohmann/json.hpp`. Giải chính thức chấm bằng g++ 12 trên Linux, nên bot dùng hàm riêng của Windows có thể chạy được ở lớp nhưng lỗi ở giải chính thức.

**Mạng LAN và tường lửa.**
- Khi bật LAN, học sinh mở `http://<địa chỉ máy giáo viên>:3000/portal`.
- Windows có thể hỏi quyền tường lửa cho `node.exe`, và việc cho phép cần quyền quản trị.
- Nếu không có quyền quản trị, học sinh chép bài vào USB hoặc thư mục chung. Giáo viên nhập ở mục Giải đấu → "Nhập bài từ thư mục" (xem [RUNBOOK.md](RUNBOOK.md)).

**Dữ liệu và sao lưu.** Mọi dữ liệu nằm trong thư mục `data\` cạnh `start.bat`: cơ sở dữ liệu, bài nộp và `settings.json`. Sao chép thư mục này là đủ để sao lưu. Đóng cửa sổ đen trước khi sao chép.

## Học sinh: chạy thử bot trước khi nộp

Kéo file `main.py` hoặc `main.cpp` thả vào `chay-thu.bat`, không cần máy chủ hay mạng. Lệnh chạy:

1. Quét tĩnh như lúc nộp bài.
2. Kiểm tra cú pháp hoặc biên dịch.
3. Cho bot đấu 2 ván đổi bên với bot mẫu Python, dùng đúng engine, giao thức và giới hạn thời gian của máy chấm.

Kết quả:
- Cửa sổ đen in kết quả từng ván. Nếu bot lỗi, cửa sổ in gợi ý tiếng Việt gồm chuyện gì xảy ra, cách sửa và dòng lỗi.
- Trình duyệt mở `replay.html`, lưu cạnh file bot. File này tự chứa và mở được không cần mạng.
- Khi xem replay:
  - ← → đi từng nước, Home/End về đầu/cuối, Space chạy/dừng.
  - N/P hoặc nút "Pha tiếp/Pha trước" nhảy tới lần ăn quân hoặc nhặt ô.
  - Bấm một dòng lịch sử để quay lại nước đó.

Trên Windows, bot chạy trong Job Object với cùng giới hạn CPU/RAM như máy chấm lớp học. Nếu không dùng được Job Object, hoặc chạy trên macOS/Linux, bot chạy trực tiếp và màn hình báo "Giới hạn CPU chỉ ước lượng theo thời gian thực".

Dùng bằng dòng lệnh (trong gói: `node\node.exe scripts\ott-run.js`; trong mã nguồn: `npm run ott-run --`):

```text
ott-run main.py [--vs python-greedy | cpp-greedy | <file bot khác>] [--rules classic | obstacles | powerups | <file luật .json>]
               [--games 2] [--seed chữ] [--out replay.html] [--no-open]
```

Mã thoát của lệnh:
- 0: bot chạy đúng mọi ván.
- 1: bot có lỗi.
- 2: không chạy được (thiếu Python/g++, sai tham số).

## Bảng xếp hạng: biến động hạng và huy hiệu

Bảng vòng loại ở portal, trang quản trị và site công khai có thêm hai cột.

**Cột ±** so với lượt trước:
- Mốc so sánh là lượt hoàn tất gần nhất trước lượt đang hiển thị: khi một lượt còn đang đấu thì so với lượt vừa xong; khi lượt cuối đã xong thì so với lượt trước đó.
- Sau lượt đầu tiên chưa có mốc nên hiện "–".

**Cột Huy hiệu**, tính theo D17:

| Huy hiệu | Điều kiện |
|---|---|
| 🏆 Bất bại | Đã đấu ít nhất 3 trận và chưa thua trận nào. Hòa vẫn giữ huy hiệu; lượt miễn đấu không tính. |
| 🔥 Chuỗi thắng | Đang thắng ít nhất 3 trận liên tiếp. Mất ngay khi hòa hoặc thua. |
| 🛡️ Bot mẫu mực | Đã đấu và chưa có ván nào bị xử thua vì lỗi bot (crash, quá giờ, nước sai…). |
| 🚀 Ngược dòng | Lên ít nhất 5 hạng so với lượt trước. |

Cách hiển thị:
- Rê chuột lên huy hiệu để xem lý do. Trên điện thoại, chú thích nằm ngay dưới bảng.
- Bản công bố lưu luôn hai cột này.
- Loại trực tiếp không có huy hiệu và biến động hạng.

## Ban tổ chức: đóng gói

Đóng gói trên máy Windows có Node 24 và đã chạy `npm install`. Các file cần tải trước:

| File | Nguồn | Cách kiểm tra |
|---|---|---|
| `python-3.11.9-embed-amd64.zip` | python.org/ftp/python/3.11.9/ | Sau khi giải nén, `Get-AuthenticodeSignature python.exe` phải ra Valid, chữ ký "Python Software Foundation". python.org không còn công bố MD5 cho bản embeddable. |
| `json.hpp` v3.11.2 | github.com/nlohmann/json/releases (bản Debian bookworm của máy chấm cũng là 3.11.2) | sha256 `665fa14b8af3837966949e8eb0052d583e2ac105d3438baba9951785512cf921` |
| WinLibs GCC 12.2.0 msvcrt r5, chỉ cần khi làm gói C++ | github.com/brechtsanders/winlibs_mingw/releases, file `winlibs-x86_64-posix-seh-gcc-12.2.0-mingw-w64msvcrt-10.0.0-r5.zip` | sha256 phải khớp file `.sha256` đi kèm release: `60247caa…6a42fe` |

```powershell
npm run package:classroom -- --python <python embed zip> --json <json.hpp> --mingw <thư mục mingw64 đã giải nén> --out E:\OTTv2-local\dist
```

Lệnh in ra kích thước và sha256 của `OTTv2-lop-hoc.zip` và `OTTv2-add-cpp.zip`; gửi kèm sha256 khi phát gói cho giáo viên.

Gói chứa:
- Node (`node\node.exe`), mã ứng dụng và `node_modules`.
- Python 3.11 embeddable.
- `vendor\include\nlohmann\json.hpp`.
- `jobrun.exe` dựng sẵn, nên máy trường không phải biên dịch helper.
- `start.bat` và `DOC-TRUOC.txt`.

Gói không chứa cơ sở dữ liệu, tài khoản, bài nộp hay test.

Gói C++ chỉ giữ những gì g++ cần để biên dịch bot tĩnh: `g++`, `cc1plus`, `as`, `ld`, header C++/Windows và các thư viện liên kết mặc định. DLL được chọn theo kết quả `objdump -p`.

## Bài thử "máy sạch" (20/10/2026)

Script: `E:\OTTv2-local\tools\clean-phase6a.js` (nằm ngoài repo). Các bước:

1. Giải nén gói vào thư mục mới.
2. Chạy `start.bat` với `PATH` chỉ còn thư mục Windows (không có Node, Python, Git, g++, Docker).
3. Trình duyệt tự động đi hết trang cài đặt (mức "lớp học", 2 học sinh).
4. Giáo viên đăng nhập.
5. Học sinh kéo `main.py` vào `chay-thu.bat` (thư mục bài có dấu cách).
6. Hai học sinh đổi mật khẩu, mỗi em nộp một bot mẫu (Python và C++, giao diện điện thoại 390 px).

| Mốc (giây, tính từ lúc giải nén) | Thư mục `lop10a` | Thư mục `Tin học 10A` |
|---|---|---|
| Giải nén gói + gói C++ | 1,8 | 1,8 |
| Máy chủ chạy | 4,8 | 4,4 |
| Xong trang cài đặt, đã tự khởi động lại | 8,4 | 7,7 |
| `chay-thu.bat`: 2 ván + `replay.html` (lần chạy sau Phase 6b) | 26,4 | chưa đo |
| Bot Python: Accepted | 22,3 (sau 6b: 40,0) | 23,6 |
| Bot C++: Accepted | 51,5 (sau 6b: 67,9) | Không chấm được. Trang cài đặt và trang quản trị báo rõ phải chuyển sang thư mục không dấu. |

Đây là thời gian máy tự thao tác trên laptop phát triển. Mục tiêu "người mới làm xong trong 10 phút" **chưa** được kiểm chứng với người thật, cũng chưa thử trên máy phòng lab cũ hoặc máy có Deep Freeze.

## Giới hạn đã biết

- `windows-job` không chặn mạng và đọc/ghi file. Chỉ dùng khi có giám sát; không dùng cho giải chính thức.
- g++ không chạy trong thư mục có dấu tiếng Việt.
- Gói chỉ chạy trên Windows 10/11 64-bit. Bản Node đóng kèm (Node 24) không hỗ trợ Windows 7/8.
- Biên dịch C++ ở chế độ lớp học được cho tối đa 60 giây CPU (Docker: 20 giây), vì máy trường chậm và riêng `json.hpp` đã mất vài giây.
