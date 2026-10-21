# Phân vai ban tổ chức (RACI)

Cập nhật: 20/10/2026. Dành cho ban tổ chức (BTC).

Ký hiệu:
- **R** (Responsible): người làm.
- **A** (Accountable): người chịu trách nhiệm cuối và ký duyệt; mỗi việc chỉ có một A.
- **C** (Consulted): người được hỏi ý kiến trước.
- **I** (Informed): người được báo sau.

Một người có thể giữ nhiều vai. Giải ~1.000 đội nên có ít nhất 5 người, chưa kể giám thị phòng thi.

| Vai | Viết tắt | Việc chính |
|---|---|---|
| Trưởng BTC | TB | Duyệt thể lệ, lịch, kết quả; quyết định khiếu nại |
| Kỹ thuật hệ thống | KT | Máy chủ/VPS, coordinator, sao lưu, đồng bộ, Cloudflare/GitHub App |
| Phụ trách máy chấm | MC | Image/rootfs, máy chấm, USB máy chấm, theo dõi hàng đợi |
| Phụ trách thể lệ & luật | TL | Bộ luật, cấu hình giải, đối chiếu kết quả, khiếu nại kỹ thuật |
| Hỗ trợ thí sinh | HT | Kênh hỏi đáp, cấp lại mật khẩu, nhập bài USB tại bàn |
| Giám thị phòng thi | GT | Máy thí sinh, USB thí sinh, trật tự phòng thi |

## Trước giải

| Việc | TB | KT | MC | TL | HT | GT |
|---|---|---|---|---|---|---|
| Chốt thể lệ, lịch, Top N, số lượt ([FORMAT.md](FORMAT.md)) | A | C | C | R | I | I |
| Gửi thông báo giải ([ANNOUNCEMENT.md](ANNOUNCEMENT.md)) | A | I | I | R | R | I |
| Dựng máy chủ, HTTPS/Tunnel, GitHub App, Turnstile | I | A/R | C | I | I | |
| Nhập đội (CSV), gửi tài khoản | A | R | | | R | |
| Tạo bộ luật, tạo giải, mở nhận bài | A | C | | R | I | |
| Dựng image/rootfs, USB máy chấm, đăng ký máy chấm | I | C | A/R | | | |
| Ước lượng số máy chấm ([CAPACITY.md](CAPACITY.md)) | A | C | R | C | | |
| Red team và diễn tập sự cố ([RED-TEAM.md](RED-TEAM.md), [RUNBOOK.md](RUNBOOK.md)) | A | R | R | C | I | I |
| Kiểm tra máy thật cho USB thí sinh ([USB-BOOT.md](USB-BOOT.md)) | I | C | R | | | A/R |

## Trong giai đoạn nộp bài và vòng loại

| Việc | TB | KT | MC | TL | HT | GT |
|---|---|---|---|---|---|---|
| Theo dõi hàng đợi kiểm tra, máy chấm, lỗi hạ tầng | I | C | A/R | | I | |
| Trả lời thí sinh, cấp lại mật khẩu | I | C | | C | A/R | |
| Đóng nhận bài, chờ kiểm tra xong, chốt bot | A | I | C | R | I | |
| Chạy các lượt vòng loại, xử lý ván dừng | I | C | R | A | | |
| Chụp snapshot trước mỗi thao tác chốt | I | A/R | | R | | |
| Công bố bảng tạm tính | A | R | | C | I | |
| Nhận và xử lý khiếu nại (30 phút) | A | C | C | R | R | |
| Duyệt Top N, công bố luật chính thức, mở nộp lại | A | I | | R | I | |

## Chung kết (LAN)

| Việc | TB | KT | MC | TL | HT | GT |
|---|---|---|---|---|---|---|
| Bàn giao dữ liệu online → LAN (bundle, passphrase) | A | R | | C | | |
| Kiểm tra máy chủ LAN (`npm run offline:check`), snapshot ra ổ ngoài | I | A/R | C | | | |
| Cắm USB máy chấm, mở/đóng đợt đăng ký | I | C | A/R | | | |
| Cắm USB thí sinh, kiểm tra vào được portal | I | | C | | C | A/R |
| Nhập bài USB tại bàn khi mạng đội lỗi | I | C | | I | A/R | C |
| Chạy loại trực tiếp, xem replay cùng khán giả | A | C | R | R | | |
| Duyệt kết quả, công bố cuối | A | R | | R | I | I |
| Bàn giao dữ liệu LAN → online | A | R | | | | |

## Sau giải

| Việc | TB | KT | MC | TL | HT | GT |
|---|---|---|---|---|---|---|
| Lưu trữ DB/snapshot/bundle như tài liệu mật, hủy bản thừa | A | R | | | | |
| Thu USB, ghi lại ảnh sạch (xóa `bai-lam`) | I | | C | | | A/R |
| Thu hồi khóa máy chấm, đóng GitHub App, đổi mật khẩu admin | A | R | R | | | |
| Tổng kết sự cố, cập nhật [RISKS.md](RISKS.md) | A | R | R | R | R | C |
