# OTTv2 — Nền tảng tổ chức giải thi đấu bot

Ứng dụng Node.js cho trò chơi Búa · Bao · Kéo trên bàn cờ. Thí sinh nộp bot Python/C++; máy chủ kiểm tra và chấm trong Docker. Mục tiêu thực tế dưới 150 đội, chưa chứng nhận năng lực ở tải này.

**Người mới bắt đầu:** đọc [Hướng dẫn tải, cài đặt và sử dụng](docs/CAI-DAT-VA-SU-DUNG.md). Tài liệu bao gồm cài lần đầu, tài khoản, điều hành giải, nộp bot, dữ liệu/backup, cập nhật và xử lý lỗi.

## Chạy nhanh trên máy cá nhân

Cần Node.js ≥ 24.16, npm, Git và Docker Linux đang hoạt động (Windows dùng Docker Desktop/WSL2). Sandbox cần Landlock ABI ≥ 3, seccomp và cgroup v2; kiểm tra trên máy thực tế.

```text
git clone https://github.com/ThePlaceOfTangerine/OTTv2.git
cd OTTv2
npm ci
npm run seed
npm run sandbox:build
npm run sandbox:check
npm start
```

Mở [admin](http://127.0.0.1:3000/admin) hoặc [portal thí sinh](http://127.0.0.1:3000/portal). Giữ terminal hoạt động; Ctrl+C để dừng. Những lần sau chỉ cần mở Docker và chạy npm start.

Seed tạo admin/admin và contestant01–contestant20 với mật khẩu ban đầu trùng tên; thí sinh bắt buộc đổi mật khẩu lần đầu. Chạy seed lại không đổi mật khẩu tài khoản đã có. Thông tin mặc định dành cho local; chưa mở Internet trước khi xử lý tài khoản mặc định và cấu hình proxy/HTTPS trong TODO.

## Chức năng hiện có

- Quản lý tài khoản, luật có phiên bản, bàn cờ tùy chỉnh và bot mẫu.
- Nhận bài theo giải/giai đoạn và hạn nộp, biên nhận, hàng đợi kiểm tra, chốt bot bất biến.
- Vòng loại tính điểm: ghép đội gần điểm, tránh gặp lại, chỉ số phụ và duyệt đội đi tiếp.
- Công bố luật chính thức, mở nộp lại cho đội đi tiếp, kiểm tra/chốt bot theo luật mới.
- Loại trực tiếp, miễn đấu, ván phụ đổi bên, hòa xét hạt giống; chạy tự động hoặc từng cặp/vòng.
- Tạm dừng/tiếp tục/hủy thi đấu; hủy trước thi đấu; nhật ký, bản xem lại và duyệt kết quả.

Vòng điểm/Elo và khu chơi trực tiếp cũ là các luồng riêng. Đã có [giải thử Docker 6 đội](docs/DEMO-6-TEAMS.md); thử tải, backup/restore sang máy khác, máy chấm phân tán và trang kết quả cho khách còn trong [TODO](TODO.md).

## Tài liệu

| Nội dung | Tài liệu |
| --- | --- |
| Cài và dùng từ đầu | [Hướng dẫn người tải dự án](docs/CAI-DAT-VA-SU-DUNG.md) |
| Tạo và điều hành giải | [Quy tắc giải đấu](docs/QUY-TAC-GIAI-DAU.md) |
| Quản lý giải và danh sách đội | [Quản lý giải](docs/TOURNAMENTS.md) |
| Vòng loại / loại trực tiếp | [Vòng loại](docs/SWISS.md), [Loại trực tiếp](docs/BRACKETS.md) |
| Đổi luật / nộp lại | [Luật chính thức](docs/FINAL-RULES.md), [Nhận và chốt bài mới](docs/FINAL-INTAKE.md) |
| Viết bot | [Hướng dẫn bot](docs/HUONG-DAN.md), [Giao thức](docs/PROTOCOL.md), [Bộ luật](docs/RULE-SETS.md) |
| Triển khai và yêu cầu | [Triển khai](docs/DEPLOYMENT.md), [Yêu cầu giải](docs/TOURNAMENT-REQUIREMENTS.md) |

## Phát triển và cập nhật

- npm test: unit/API; npm run test:stages: luồng giải bằng Docker. Các lệnh khác nằm trong package.json.
- Sao lưu data/ và phiên bản mã/image trước cập nhật. SQLite tự migration khi khởi động; DB cần đi cùng artifact trong data/submissions.
- Git không chứa data/, node_modules, .env, khóa bí mật hoặc kết quả thử cục bộ. Giữ package-lock.json và dùng npm ci.
- Khi đổi cách cài/chạy hoặc hành vi sử dụng, cập nhật hướng dẫn người dùng, README và TODO trong cùng đợt. Sửa quy tắc giải thì dựng lại trang admin bằng node scripts/build-tournament-guide.js.

Quy trình đóng gói/khôi phục và bảo vệ khi mở qua mạng còn cần hoàn thiện; xem trạng thái cụ thể trong TODO trước tổ chức giải thật.
