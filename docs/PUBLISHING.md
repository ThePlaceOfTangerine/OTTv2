# Công bố kết quả công khai

Cập nhật: 21/10/2026. Áp dụng cho bản có migration 19 (Phase 4). Cloudflare Pages và Google Sheets đã chạy thật lần đầu ngày 21/10/2026 (xem cuối mục từng dịch vụ).

## Cách hoạt động

- Admin vào **Giải đấu**, chọn giải, mục **Công bố kết quả công khai**: bấm **Công bố bản kết quả ngay** hoặc thêm **lịch công bố** (giờ Việt Nam). Mỗi lần công bố tạo một bản không đổi v1, v2… lưu người/thời điểm/lý do. Bảng điểm khi vòng loại chưa duyệt đội đi tiếp được ghi **tạm tính**.
- **Tạm hoãn công bố tự động**: bấm nút trên giao diện (kèm lý do), không cần sửa cấu hình máy chủ. Lịch đến hạn trong lúc tạm hoãn bị **bỏ qua** (không dồn lại khi tiếp tục); thêm lịch mới sau khi giải chạy lại.
- Sau mỗi lần công bố, máy chủ dựng lại site tĩnh vào `PUBLIC_SITE_DIR` (mặc định `data/public-site`) và xem được ngay tại `/site/` trên chính máy chủ (dùng cho chung kết LAN hoặc xem trước). Khi đã cấu hình Cloudflare, bấm **Dựng lại trang và đẩy lên Cloudflare** hoặc đặt `SITE_AUTO_DEPLOY=1` để tự đẩy sau mỗi lần công bố.
- Site gồm: `manifest.json`, `t/<giải>/latest.json` (cache 60 giây), `t/<giải>/v<N>/summary.json` và `bracket.json` (không bao giờ đổi, cache 1 năm), `team/<mã tra cứu>.json` và giao diện `index.html`. Replay chỉ công khai cho vòng loại trực tiếp, gộp trong `bracket.json`; nếu file vượt 20 MiB thì tự tách `bracket-r<lượt>.json`. Replay công khai chỉ có nước đi, thay đổi trên bàn và kết quả (không có stderr, userdata, mã bài nộp, hash hay image).
- **Mã tra cứu đội**: 20 ký tự hex, HMAC-SHA256 của mã đội với khóa tạo một lần và lưu trong DB (bảng `app_secrets`), nên không đổi khi khởi động lại hay chuyển máy cùng DB. Thí sinh xem mã ở portal → **Đội & GitHub**. File đội chỉ cập nhật theo các lần công bố chính thức; trạng thái tức thời xem trong portal.
- Trang công khai không chứa họ tên, MSSV, email, SĐT của thành viên.

## Cloudflare Pages

1. Tạo API token: My Profile → API Tokens → Create Custom Token, chỉ một quyền *Account → Cloudflare Pages → Edit*.
2. Tạo project Pages (Direct Upload). Làm trên dashboard (Workers & Pages → Create → Pages → Upload assets), hoặc dùng API bằng chính token đó:
   - `POST https://api.cloudflare.com/client/v4/accounts/<account id>/pages/projects`
   - body `{"name":"ott-ket-qua","production_branch":"main"}`.
3. Đặt biến môi trường cho máy chủ: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT`; tùy chọn `WRANGLER_VERSION` (mặc định 3.80.0, cần kiểm tra còn hỗ trợ), `PUBLIC_SITE_URL` (địa chỉ trang Pages để portal dẫn tới).
4. `npm run site:deploy` (dựng lại rồi chạy `npx wrangler@<phiên bản> pages deploy`). Kết quả mỗi lần đẩy hiện trong mục Công bố; thiếu biến thì ghi trạng thái "Bị chặn".

Đã kiểm chứng 21/10/2026 với tài khoản thật (project `ott-ket-qua`, giải mẫu trong DB tạm):
- wrangler 3.80.0 đẩy 21 file thành công.
- `manifest.json` đọc được từ Internet; trang hiển thị đúng trên điện thoại, mở được replay.
- Không lộ email.
- Cache đúng như thiết kế: `latest` 60 s, file theo phiên bản `immutable`.

Lần đẩy đầu phát hiện trang thiếu CSP/X-Frame-Options, vì Cloudflare chỉ gửi những header khai báo trong `_headers`. Nay `_headers` khai báo cùng CSP với portal, cộng `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, và trang vẫn chạy không lỗi dưới CSP đó.

Đo tải trên Pages thật với site 1.000 đội (21/10/2026): 4.000 request qua 64 kết nối dùng lại cho p95 0,13–0,17 s, Cloudflare không trả lỗi HTTP nào. Chi tiết và giới hạn của cách đo (một máy, một đường mạng) ở [CAPACITY.md](CAPACITY.md).

File `_headers` trong site đặt Cache-Control: file theo phiên bản `immutable`, file mới nhất và file đội 60 giây.

## Google Sheets

1. Google Cloud: bật Sheets API, tạo service account, tải file JSON khóa (lưu ngoài thư mục dự án).
2. Chia sẻ bảng tính cho email của service account (quyền Editor).
3. Đặt `GOOGLE_SERVICE_ACCOUNT_FILE` và `GOOGLE_SHEET_ID` (đoạn ID trong URL bảng tính).

Nên dùng Gmail cá nhân: tài khoản Google Workspace của trường thường chặn tạo khóa service account.

Đã kiểm chứng 21/10/2026 với tài khoản thật: lần ghi đầu thành công ngay (1 lượt thử), tự tạo 3 tab, dữ liệu xếp hạng đúng.

Mỗi lần công bố ghi 3 tab `<tên giải> · Xếp hạng`, `· Loại trực tiếp`, `· Đội` (tự tạo tab nếu thiếu) bằng 3–4 request. Lỗi (kể cả 429 quota) được thử lại với thời gian chờ tăng dần, tối đa 5 lần; sau đó admin bấm **Đồng bộ lại**. DB luôn là nguồn chính; lỗi Sheets không ảnh hưởng bản công bố.

## Giới hạn miễn phí (kiểm tra lại số liệu hiện hành trước khi dùng)

Số liệu theo tài liệu của nhà cung cấp tại thời điểm viết; các gói thay đổi thường xuyên.

| Dịch vụ | Giới hạn liên quan | Ảnh hưởng tới OTTv2 |
| --- | --- | --- |
| Cloudflare Pages Free | Khoảng 500 lượt deploy/tháng; 20.000 file/site; 25 MiB/file; request và băng thông cho file tĩnh không tính phí | Giải 1000 đội: khoảng 1.020 file, 1,1 MB (đo bằng bench). Chỉ đẩy khi công bố để giữ số lượt deploy |
| Google Sheets API | Khoảng 300 request đọc/ghi mỗi phút cho mỗi project, 60 request/phút cho mỗi người dùng; 10 triệu ô/bảng tính | 3–4 request mỗi lần công bố; 1000 đội × 3 tab rất xa giới hạn ô |

Nguồn: [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Cloudflare _headers](https://developers.cloudflare.com/pages/configuration/headers/), [Google Sheets API usage limits](https://developers.google.com/sheets/api/limits).

## Đo tải (bản tĩnh)

`npm run bench:publish` dựng giải giả lập (ván giả, không đo tốc độ chấm), công bố, dựng site vào `../OTTv2-local/bench` rồi bắn 4000 request. Kết quả ngày 20/10/2026 trên máy phát triển:

- Giải 1.000 đội chơi thật (ván giả): vòng loại 8 lượt 90 giây, loại trực tiếp top 16, mỗi lần công bố 0,1 giây.
- Site 1.000 đội: 1.014 file, khoảng 1 MB; `summary.json` 274 KB (chưa nén), `bracket.json` top 16 155 KB; dựng site 1,8 giây.
- 4000 request đồng thời (Linux/WSL, 4000 kết nối, bản nhân bản trước khi bỏ giới hạn 256): 0 lỗi, p50 1,9 s, p95 2,2 s; trên Windows bench tự dùng bể 200 kết nối (Windows từ chối quá ~230 kết nối chờ cùng lúc): 0 lỗi, p50 0,7 s, p95 1,2 s với giải 1.000 đội thật.
- Đây là server tĩnh Node trên một máy, không phải số đo Cloudflare. Phần lớn dung lượng là `summary.json`; Cloudflare tự nén gzip/brotli.
