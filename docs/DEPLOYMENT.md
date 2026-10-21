# Phương án triển khai OTTv2

Cập nhật ngày 19/10/2026. Mục tiêu thực tế dưới 150 đội; cấu hình bên dưới là điểm bắt đầu để đo tải, chưa phải bảo đảm đủ năng lực. Chưa có thao tác deploy hoặc mua dịch vụ nào trong đợt này.

## Proxy tin cậy và địa chỉ website

Mặc định ứng dụng không tin header chuyển tiếp. Nếu chạy sau reverse proxy, cấu hình trước khi `npm start`:

```powershell
$env:TRUSTED_PROXIES = '127.0.0.1,::1'
$env:PUBLIC_ORIGIN = 'https://arena.example'
$env:COOKIE_SECURE = 'true'
npm start
```

Thay tên miền bằng địa chỉ website thật. Ví dụ chỉ phù hợp khi proxy nối tới Node từ loopback. Proxy ở máy khác thì khai báo đúng IP hoặc CIDR của proxy đó. Không dùng `true`, số hop, tên mạng viết tắt hay dải `/0`. Cấu hình không hợp lệ bị từ chối trước khi mở DB. Khi bật proxy phải có PUBLIC_ORIGIN; chỉ gồm giao thức/tên miền/cổng. Origin HTTPS yêu cầu COOKIE_SECURE=true.

Giới hạn đăng nhập dùng IP được Express xác định từ socket và chuỗi X-Forwarded-For theo danh sách tin cậy. Origin đăng nhập phải khớp PUBLIC_ORIGIN, kể cả khi Host phía upstream khác; X-Forwarded-Host không quyết định Origin hợp lệ. Giao thức được xác định cũng phải khớp PUBLIC_ORIGIN. Địa chỉ không nằm trong danh sách tin cậy không thể tự khai HTTPS/IP khách qua header.

Proxy ngoài cùng phải **ghi đè** các header do khách gửi. Với Nginx là điểm kết thúc HTTPS và nối trực tiếp Node, phần location có thể dùng:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host arena.example;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host "";
}
```

Đây chỉ là phần chuyển tiếp trong server HTTPS đã có chứng chỉ; cấu hình TLS/chuyển hướng HTTP, WebSocket legacy và Cloudflare nhiều tầng cần kiểm chứng riêng. Chặn truy cập trực tiếp cổng Node từ Internet. Không dùng nguyên ví dụ loopback nếu một tiến trình/người khác trên cùng máy có thể gửi header tùy ý; danh sách tin cậy là ranh giới vận hành phải được bảo vệ. Không tự mở cổng, đổi proxy hay bật HTTPS trên máy hiện tại trong đợt triển khai mã này.

## Đề xuất

Dùng một máy chủ Linux có quyền chạy Docker và ổ đĩa bền vững để chạy Node.js, SQLite, lưu bài và sandbox. Đặt Cloudflare phía trước cho DNS, HTTPS/proxy và cache tài nguyên công khai. Với kiến trúc hiện tại đây là đường triển khai ít thay đổi nhất.

Ví dụ luồng: trình duyệt → Cloudflare → reverse proxy trên VPS → Node.js → SQLite và hàng đợi → Docker sandbox trên máy chủ. Cloudflare không chấm bot thay cho Docker trong mô hình này.

VPS ở Việt Nam hoặc Singapore là lựa chọn để thử độ trễ cho thí sinh trong nước. Có thể so sánh nhà cung cấp VPS trong nước với Hetzner Cloud Singapore; chọn theo quyền Docker/kernel, CPU thực tế, SSD, backup, kết nối và kết quả sandbox:check. Chưa chốt nhà cung cấp/gói trả phí hoặc giá tháng; cần ngân sách và benchmark trước khi mua.

## Vai trò Cloudflare

| Phương án | Phù hợp với dự án |
| --- | --- |
| DNS/proxy/CDN trước VPS | Đề xuất cho bản online; chỉ cache tài nguyên công khai |
| Cloudflare Tunnel tới máy có sẵn | Phù hợp demo hoặc thử nghiệm có giám sát; máy gốc vẫn phải bật và có mạng |
| Workers/Pages cho toàn bộ ứng dụng hiện tại | Không deploy nguyên trạng: node:sqlite và node:child_process là stub không thực thi trong Workers |
| Cloudflare Containers | Sản phẩm riêng, không mặc nhiên là máy Docker host tương thích runner; cần kiểm chứng lại runtime, kernel, Landlock/seccomp/cgroups, lưu trữ và quyền điều khiển container trước khi cân nhắc |
| Website kết quả tĩnh trên Cloudflare | Có thể bổ sung sau khi có snapshot kết quả được duyệt; không thay DB và máy chấm |

Workers có hỗ trợ nhiều Node API nhưng tài liệu hiện liệt kê node:sqlite và node:child_process trong nhóm non-functional stubs. OTTv2 sử dụng cả hai, cùng Docker CLI và file trên đĩa; bật nodejs_compat không đủ để chạy toàn bộ ứng dụng. Đây là đánh giá mức phù hợp với code hiện tại, không phải kết luận rằng mọi kiến trúc Cloudflare đều không thể làm giải bot.

Tunnel cài cloudflared tại máy gốc và tạo kết nối đi ra Cloudflare, không yêu cầu IP public cho máy gốc. Tunnel không giữ website hoạt động khi máy gốc tắt/mất điện/mất Internet. Chưa cần cài cloudflared khi chỉ thi LAN.

## Cấu hình thử ban đầu

- VPS Linux x86_64, khoảng 4 vCPU, RAM 8–16 GB, SSD và quyền Docker; ưu tiên khả năng nâng cấp. Cấu hình CPU chia sẻ có thể dao động, phải đo thời gian chấm.
- Node.js theo engines của dự án, Git, Docker Engine với cgroup v2 và seccomp; kernel có Landlock ABI ≥ 3. Không coi tên bản phân phối là bằng chứng đủ, phải chạy sandbox:check trên máy thuê.
- SQLite và SUBMISSIONS_PATH trên ổ bền vững; backup ra vị trí khác máy. Một tiến trình ứng dụng/DB ở bước đầu, không chia sẻ file SQLite qua network filesystem.
- Một reverse proxy như Caddy hoặc Nginx. Cloudflare proxy phía trước hoặc Tunnel là hai cách đưa truy cập tới origin; không bắt buộc dùng cả hai.
- Giữ số slot chấm nhỏ lúc đầu. Hiện pipeline nhận bài, Elo cũ, Swiss và đấu thử đều có thể dùng tài nguyên Docker; cần tính tổng tải và tránh chạy các giải cũ/demo đồng thời trong thi thật.

Chỉ tăng máy chấm hoặc tách web/worker sau khi có báo cáo thời gian biên dịch, trận trung bình/p95, tốc độ rút hàng đợi và mức CPU/RAM/disk. Worker phân tán qua nhiều máy chưa được triển khai; đặt web ở VPS và để worker ở nhà chưa phải cấu hình sẵn dùng của phiên bản này.

## Điều kiện cần hoàn thành trước khi mở thi online

Các mục này đã có trong TODO, chưa được coi là hoàn tất chỉ vì có tài liệu triển khai:

- Đã có giới hạn đăng nhập phù hợp IP chung và cấu hình proxy tin cậy/Origin; cần nghiệm thu với proxy/TLS thật, nhiều người chung mạng và chính sách bảo vệ cổng Node.
- Đổi thông tin admin mặc định, quy trình cấp tài khoản riêng và cookie Secure khi triển khai HTTPS.
- Kiểm tra nhận bài/retry khi mạng chậm, hạn nộp, quota dung lượng và rate limit tại đúng origin.
- Backup/restore DB cùng source/artifact/image; diễn tập khôi phục trên máy khác.
- Load test theo quy mô thực tế và tính thời gian chấm. 4.000 là thử mở rộng tùy chọn.
- Đường dẫn /api hiện dùng Cache-Control: no-store; giữ các API session/bài nộp/quản trị ngoài cache công khai. Không bật Cache Everything cho toàn website.
- Chốt cách phục vụ /legacy; đây là luồng riêng cần rà soát trước khi mở công khai.

## Demo và thi offline

Demo tiết kiệm có thể dùng máy hiện tại đã kiểm tra sandbox + Tunnel sau khi cấu hình web/proxy đúng. Thi chính thức online nên dùng nguồn điện/mạng ổn định và backup độc lập. Chung kết cắt Internet dùng server LAN; khi có Internet lại cần quy trình đồng bộ riêng, vẫn còn trong TODO.

## Nguồn chính thức đã kiểm tra

- [Cloudflare Workers Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) — danh sách API thật và stub.
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) — cloudflared và kết nối đi ra từ origin.
- [Cloudflare Containers limits](https://developers.cloudflare.com/containers/platform/limits/) — nền tảng container riêng, không là xác nhận tương thích sandbox OTTv2.
- [Hetzner Cloud servers](https://docs.hetzner.com/cloud/servers/overview/) và [thay đổi nền tảng](https://docs.hetzner.cloud/whats-new) — tham khảo VPS và khu vực Singapore; cần kiểm tra gói/giá tại lúc mua.
