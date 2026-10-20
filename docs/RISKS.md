# Sổ đăng ký rủi ro

Cập nhật: 20/10/2026 (Phase 8). Dành cho ban tổ chức (BTC). Người phụ trách theo vai trong [RACI.md](RACI.md).

Thang đánh giá:
- **Khả năng:** Thấp / Vừa / Cao.
- **Ảnh hưởng:** Nhỏ / Lớn / Nghiêm trọng (làm hỏng hoặc dừng giải).
- **Trạng thái** ghi phần nào đã kiểm chứng bằng test hoặc số đo, phần nào chỉ là quy trình.

## Hạ tầng và năng lực

| # | Rủi ro | Khả năng | Ảnh hưởng | Phòng ngừa | Khi xảy ra | Phụ trách | Trạng thái |
|---|---|---|---|---|---|---|---|
| R1 | Quá tải đăng nhập lúc mở giải (4.000 người cùng vào) | Cao | Nghiêm trọng | Băm mật khẩu bằng scrypt chạy song song (Phase 8); giới hạn đăng nhập theo IP chỉ đếm lần sai | Theo dõi `/api/health`; chờ, không tắt server | KT | Đã sửa và đo ([CAPACITY.md](CAPACITY.md)) |
| R2 | Cả phòng máy / Cloudflare Tunnel chung một IP bị khóa đăng nhập | Cao | Nghiêm trọng | Đăng nhập thành công không tính vào giới hạn IP; IP chịu 100 lần sai / 15 phút | Xóa dòng `login_limits` của IP đó | KT | Đã sửa, có test |
| R3 | Thiếu máy chấm, vòng loại kéo dài | Vừa | Lớn | Tính số máy theo [CAPACITY.md](CAPACITY.md); thêm USB máy chấm theo đợt đăng ký | Mở đợt đăng ký, cắm thêm máy; vòng đang chạy tự chia việc | MC | Có số đo |
| R4 | Máy chủ điều phối hỏng (mất điện, hỏng ổ) | Thấp | Nghiêm trọng | Snapshot định kỳ ra ổ ngoài; máy dự phòng cùng mã nguồn | Mất điện: bật lại là chạy tiếp. Hỏng ổ: `npm run restore` trên máy dự phòng ([RUNBOOK.md](RUNBOOK.md)) | KT | Đã kiểm chứng (test:recovery) |
| R5 | Đầy ổ đĩa máy chủ (bài nộp, replay, WAL; thử tải 1.000 đội: 231 MB) | Thấp | Lớn | Theo dõi dung lượng; [CAPACITY.md](CAPACITY.md) ghi dung lượng đo được | Dọn snapshot cũ, chuyển `SUBMISSIONS_PATH` | KT | Có số đo; chưa diễn tập ổ đầy thật |
| R6 | Máy chấm mất kết nối giữa ván | Vừa | Nhỏ | Lease 30 giây, việc tự giao lại; lỗi hạ tầng không xử thua bot | Thu hồi khóa máy hỏng | MC | Đã kiểm chứng (Phase 2) |
| R7 | Lệch giờ giữa các máy (HMAC chỉ chấp nhận ±5 phút) | Vừa | Lớn | USB tự lấy giờ từ coordinator; máy chấm khác dùng NTP | Chỉnh giờ, khởi động lại agent | MC | USB: đã kiểm chứng trong QEMU |
| R8 | GitHub/Internet gián đoạn sát hạn nộp | Vừa | Lớn | Upload dự phòng; webhook + quét HEAD lúc hết hạn | Nhận bài USB tại bàn kèm thời điểm nhận | HT | Chỉ đo với GitHub giả |
| R9 | Cloudflare Pages / Google Sheets lỗi hoặc hết hạn token | Thấp | Nhỏ | Site tĩnh vẫn xem được tại `/site/` của máy chủ; lỗi Sheets không ảnh hưởng bản công bố | Đồng bộ lại / đẩy lại; tạo token mới | KT | Đã chạy thật 21/10/2026; chưa đo tải trên Cloudflare |

## Bảo mật và gian lận

| # | Rủi ro | Khả năng | Ảnh hưởng | Phòng ngừa | Khi xảy ra | Phụ trách | Trạng thái |
|---|---|---|---|---|---|---|---|
| R10 | Bot thoát sandbox hoặc phá máy chấm (fork bomb, ghi đầy RAM, mạng) | Vừa | Nghiêm trọng | Docker/bwrap: Landlock, seccomp, rlimit, không có mạng; tmpfs giới hạn 16/64 MB (Phase 8) | Thu hồi máy chấm; xem log; chạy lại ván | MC | Có test ([RED-TEAM.md](RED-TEAM.md)) |
| R11 | Dùng `windows-job` (lớp học) cho giải thật | Thấp | Nghiêm trọng | Admin luôn ghi "không chính thức"; máy chấm windows-job có cảnh báo | Chạy lại bằng Docker/WSL2 | TL | Quy trình |
| R12 | Thí sinh lấy root trên USB thi (sửa lệnh khởi động) | Vừa | Lớn | GRUB khóa bằng mật khẩu PBKDF2 (Phase 8); root bị khóa; không sudo | Thu USB, ghi lại ảnh | GT | Có test QEMU, UEFI và BIOS ([RED-TEAM.md](RED-TEAM.md)); chưa thử máy thật |
| R13 | Thí sinh khởi động hệ điều hành khác hoặc vào BIOS | Vừa | Lớn | Giám thị; mật khẩu BIOS nếu máy của BTC | Đổi máy, lập biên bản | GT | Chỉ là quy trình |
| R14 | Đội xem hoặc sửa bài của đội khác | Thấp | Nghiêm trọng | Mọi API kiểm tra chủ sở hữu; red team truy cập chéo | Khóa tài khoản, kiểm tra nhật ký | KT | Có test |
| R15 | Lộ DB, snapshot, bundle hoặc USB (chứa hash mật khẩu, mã nguồn) | Thấp | Lớn | Bundle mã hóa; ổ ngoài giữ như tài liệu mật; mã đăng ký máy chấm đóng ngay khi đủ máy | Đổi mật khẩu đội, thu hồi khóa | TB | Quy trình |
| R16 | Hai đội dùng chung code | Vừa | Lớn | Thể lệ; lưu toàn bộ bài nộp và hash để đối chiếu | TL xem xét theo thể lệ | TL | Phần mềm không tự phát hiện |
| R17 | Mã đăng ký máy chấm bị lộ khi đợt đang mở | Thấp | Lớn | Mã 192 bit, chỉ hiện một lần; đợt tự đóng (mặc định 15 phút) | Đóng đợt, thu hồi máy lạ | MC | Có test |

## Vận hành và con người

| # | Rủi ro | Khả năng | Ảnh hưởng | Phòng ngừa | Khi xảy ra | Phụ trách | Trạng thái |
|---|---|---|---|---|---|---|---|
| R18 | Bấm nhầm nút chốt (chốt bot, duyệt Top N, tạo sơ đồ) | Vừa | Lớn | Các nút yêu cầu lý do; snapshot trước mỗi thao tác chốt | Khôi phục snapshot trên máy dự phòng; công bố bản sửa có lý do | TL | Quy trình |
| R19 | Cấu hình giải sai (số lượt, Top N, luật) sau khi đã mở nhận bài | Vừa | Lớn | Hai người kiểm tra trước khi mở; diễn tập giải nhỏ | Tạo giải mới; không sửa thẳng DB | TL | Quy trình |
| R20 | Máy thật không khởi động USB (Secure Boot, chế độ BIOS, USB-C) | Cao | Lớn | Thử trước trên từng loại máy ([USB-BOOT.md](USB-BOOT.md)) | Dùng máy dự phòng hoặc portal trên máy của trường | GT | Chưa thử máy thật |
| R21 | Mất passphrase hoặc USB bàn giao giữa online ↔ LAN | Thấp | Lớn | Đọc passphrase trực tiếp, mang hai USB | Xuất lại; khẩn cấp: `reclaim` ([RUNBOOK.md](RUNBOOK.md)) | KT | Đã kiểm chứng trên một máy |
| R22 | Phòng máy trường không cho mở tường lửa (gói lớp học) | Cao | Nhỏ | Nhận bài qua USB / thư mục chung | Nhập bài từ thư mục | HT | Quy trình |
| R23 | Thông báo giải và cấu hình không khớp | Vừa | Lớn | Sinh thông báo từ cấu hình đã lưu ([ANNOUNCEMENT.md](ANNOUNCEMENT.md)) | Đính chính, gia hạn nếu cần | TB | Quy trình |
