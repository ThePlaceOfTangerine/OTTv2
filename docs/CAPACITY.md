# Năng lực hệ thống và cách tính số máy chấm

Cập nhật: 20/10/2026 (Phase 8). Dành cho ban tổ chức (BTC) và người vận hành.

Tất cả số liệu dưới đây đo trên **một laptop**:
- CPU Intel i5-11400H (6 nhân / 12 luồng), RAM 8 GB.
- Máy chủ và bộ tạo tải cùng chạy trong WSL2 (Linux 6.6), Node 24.14.

Đây là **mức tối thiểu**: một VPS có nhiều nhân hơn, hoặc tách bộ tạo tải ra máy khác, sẽ cho số tốt hơn. Chưa đo trên VPS thật hay qua Cloudflare Tunnel.

Lệnh đo lại (trong distro `ott-build`):

```bash
node scripts/load-test.js            # 1.000 đội × 3 lần nộp, 4 người xem/đội, vòng loại 8 lượt (máy chấm giả)
node scripts/load-real-games.js      # ván thật trong sandbox bwrap (40 đội × 5 lượt = 200 ván)
node scripts/bench-standings.js <arena.sqlite>   # thời gian dựng bảng điểm trên DB thật
```

Báo cáo JSON được ghi vào `output/load/`.

## 1. Thử tải 1.000 đội (D01)

**Kịch bản** (`scripts/load-test.js`), chạy đúng quy trình thật qua HTTP:
- 4.000 lượt đăng nhập (1.000 đội × 4 thành viên).
- 3.000 bài nộp trong cửa sổ 3 phút, dồn về cuối (10% bài gần 1 MB).
- Kiểm tra 3.000 bài (mỗi bài 2 ván thử).
- Vòng loại 1.000 đội × 8 lượt (8.000 ván).
- Công bố, rồi 4.000 lượt đọc site.

Trong suốt thời gian đó, **4.000 phiên đồng thời** liên tục xem bài nộp và bảng vòng loại, mỗi phiên 5–10 giây một lần.

Máy chấm dùng trong thử tải là máy chấm **giả** (8 máy × 2 luồng, đi nước hợp lệ đầu tiên, không chạy sandbox). Tuy vậy chúng nói đúng giao thức HMAC, nên coordinator vẫn làm đủ phần việc thật của nó:
- giao việc (lease), nhận heartbeat;
- kiểm tra lại replay, lưu artifact;
- ghép cặp Swiss, xếp hạng.

Kết quả lần chạy cuối (`output/load/2026-10-20T15-42-43-268Z.json`), so với mục tiêu ở [TOURNAMENT-REQUIREMENTS.md](TOURNAMENT-REQUIREMENTS.md):

| Chỉ số | Mục tiêu | Đo được |
|---|---|---|
| 4.000 đăng nhập (64 trình duyệt cùng lúc) | — | 4.000/4.000 thành công trong 119 s; p95 2,5 s |
| Cấp biên nhận nộp bài (kể cả lần gửi lại vì 429) | p95 ≤ 3 s | **p95 1,0 s**, tối đa 3,8 s; 3.000/3.000 bài |
| Xem bảng vòng loại 1.000 đội (304.201 lượt) | p95 ≤ 1 s | **p95 0,29 s** |
| Xem bài nộp của đội (304.201 lượt) | — | p95 0,27 s |
| Lỗi 5xx hoặc lỗi mạng | < 1% | **0** |
| Máy chủ phản hồi chậm nhất (`/api/health` mỗi 0,5 s) | — | 1,3 s |
| Kiểm tra 3.000 bài (6.000 ván thử, máy chấm giả) | — | 155 s |
| Vòng loại 8.000 ván (máy chấm giả) | — | 244 s; 21–45 s mỗi lượt |
| Ghép cặp một lượt mới (1.000 đội) | — | 2,1–5,2 s, tăng dần theo lượt |
| 4.000 lượt đọc site công khai **cùng một lúc**, phục vụ thẳng từ máy chủ | p95 ≤ 1 s | **không đạt**: p95 4,0 s (trên Cloudflare Pages: p95 0,13–0,17 s, xem dưới) |
| CPU máy chủ | — | 12 luồng lúc đăng nhập (scrypt); khoảng 0,7 nhân trong vòng loại |
| RAM máy chủ | — | tối đa 548 MB |
| DB sau toàn bộ kịch bản | — | 231 MB (3.000 bài, 14.000 ván kèm replay) |

Về site công khai: 4.000 lượt đọc dồn vào **cùng một khoảnh khắc** là trường hợp xấu nhất, không đạt mục tiêu ở cả hai cách phục vụ đã thử:
- Phục vụ thẳng từ máy chủ: p95 4,0 s (lần đo này).
- Máy chủ file tĩnh riêng (Phase 4, [PUBLISHING.md](PUBLISHING.md)): p95 2,2 s.

Đo trên **Cloudflare Pages thật** (`ott-ket-qua.pages.dev`, 21/10/2026):
- **Dữ liệu:** site giải mẫu 1.000 đội (1.017 file, `summary.json` khoảng 270 KB).
- **Hỗn hợp request:** trang chủ, script, `manifest`, `latest`, `summary` (×2), file đội.
- **Nơi đo:** một máy trong WSL, qua mạng gia đình. Công cụ: `E:\OTTv2-local\tools\load-pages.js`.

| Cách gửi | Kết quả |
|---|---|
| 4.000 request, **64 kết nối dùng lại** (giống trình duyệt), lượt đầu | 3.999/4.000 thành công (200); p50 42 ms, **p95 129 ms**, p99 756 ms; 1 request treo 51 s |
| Như trên, lượt thứ hai | 4.000 request trong 4,9 s (khoảng 813 request/giây); p50 44 ms, **p95 173 ms**; 15 lỗi kết nối `ETIMEDOUT` (0,4%) |
| 4.000 request, **mỗi request một kết nối mới, cùng lúc** | Chỉ 758 thành công: số còn lại không mở được kết nối (`ETIMEDOUT`/`CONNECT_TIMEOUT`) |

Cách đọc:
- Cloudflare **không trả lỗi HTTP nào** (không 429, không 5xx) trong mọi lượt.
- Lượt "4.000 kết nối mới cùng lúc" nghẽn ở **máy và mạng đo** (NAT/router mở 4.000 kết nối TLS một lúc). Ngoài đời, 4.000 người xem đi từ 4.000 nơi khác nhau, nên lượt này không phản ánh sức chịu của Cloudflare.
- Với kết nối được dùng lại như trình duyệt thật, p95 dưới 0,2 s, **đạt mục tiêu p95 ≤ 1 s**.
- Chưa đo từ nhiều nơi cùng lúc (cần dịch vụ như k6 Cloud/loader.io).
- Cloudflare Pages không trả header `cf-cache-status`, nên không tách được request trúng cache với request về gốc.

**Khuyến nghị:** giải lớn dùng Cloudflare Pages. `/site/` trên máy chủ chỉ dùng cho giải nhỏ hoặc thi LAN.

### Đã sửa nhờ thử tải

| Vấn đề | Trước | Sau |
|---|---|---|
| Giới hạn đăng nhập theo IP tính cả lần đăng nhập đúng | 10/4.000 đăng nhập thành công | 4.000/4.000 |
| Băm mật khẩu `bcryptjs` trên luồng chính | 4.000 đăng nhập mất 950 s, máy chủ đứng (health p95 60 s) | scrypt trên thread pool: 105–119 s, health p95 dưới 0,4 s |
| Chỉ nhận 4 bài upload cùng lúc | biên nhận p95 111 s, 43.427 lần 429 | 32 bài cùng lúc: p95 1,0 s |
| Bảng vòng loại tính lại và serialize ở mỗi lượt xem (15 ms, 349 KB) | máy chủ quá tải trong vòng loại, đứng 48–55 s, lỗi kết nối | bảng xếp hạng lưu đệm theo dữ liệu; trang thí sinh dựng lại tối đa 2 s/lần, đã nén gzip |
| `settle()` đọc lại mọi ván kèm replay sau mỗi kết quả | (một phần của tình trạng quá tải trên) | chỉ xét cặp vừa có kết quả, đọc người thắng bằng `json_extract` |

## 2. Tốc độ chấm thật trong sandbox

**Cách đo** (`scripts/load-real-games.js`):
- Một máy chấm thật (`scripts/grader.js`, sandbox bwrap, rootfs máy chấm, 4 luồng) kiểm tra 40 bài rồi chơi vòng loại 40 đội × 5 lượt = 200 ván.
- Bot là bot mẫu: 30 Python, 10 C++.
- Báo cáo: `output/load/2026-10-20T15-47-10-636Z-real-games.json`.

| Chỉ số | Đo được |
|---|---|
| Kiểm tra một bài (quét, biên dịch, 2 ván thử) | 40/40 Accepted trong 52 s với 4 luồng, tức **5,2 giây-luồng mỗi bài** (gồm cả C++) |
| Một ván vòng loại | 200 ván trong 79 s với 4 luồng, tức **1,6 giây-luồng mỗi ván**, khoảng 2.280 ván/giờ/luồng |
| Độ dài ván của bot mẫu | 51 nước trung bình; tổng CPU hai bot 1,2 s mỗi ván; mọi ván kết thúc do chiếm nhà |
| Một lượt 40 ván | 14–18 s |

Lưu ý khi dùng số này:
- Bot mẫu đi nhanh và kết thúc sớm. Bot thật có thể dùng tới **30 s CPU mỗi bot mỗi ván**, tức tối đa khoảng 60 s mỗi ván, và đi tới giới hạn số nước. Vì vậy hãy lập kế hoạch theo cả trường hợp xấu.
- Mỗi luồng chiếm khoảng 1 nhân CPU khi bot tính toán. Đề xuất số luồng ≈ số nhân vật lý (laptop 6 nhân: 4–6 luồng).
- Chưa đo cách số liệu thay đổi khi tăng số luồng trên cùng máy.

## 3. Cách tính số máy chấm

Số ván:
- **Vòng loại:** số đội ÷ 2 × số lượt × số ván mỗi cặp. Ví dụ 1.000 đội × 8 lượt × 2 ván = **8.000 ván**.
- **Kiểm tra bài:** mỗi bài nộp tốn khoảng 5,2 giây-luồng với bot mẫu. Sát hạn 3.000 bài thì khoảng 15.600 giây-luồng.

Thời gian:
- Thời gian một lượt ≈ (số ván của lượt × giây-luồng mỗi ván) ÷ tổng số luồng chấm.
- Cộng thêm ghép cặp (2–5 s) và thời gian chờ ván chậm nhất của lượt (tối đa 180 s theo giới hạn mỗi ván).

Ước tính cho **1.000 đội, 8 lượt, 2 ván mỗi cặp (8.000 ván)**. Đây là phép tính từ số đo trên, chưa phải số đo trực tiếp với từng cấu hình:

| Tổng số luồng chấm | Bot nhanh như bot mẫu (1,6 s/ván) | Bot trung bình (giả định 10 s/ván) | Bot xấu nhất (60 s/ván) |
|---|---|---|---|
| 4 (1 laptop) | ≈ 55 phút | ≈ 5,6 giờ | ≈ 33 giờ |
| 20 (5 máy × 4) | ≈ 11 phút + ghép cặp | ≈ 67 phút | ≈ 6,7 giờ |
| 48 (12 máy × 4) | ≈ 5 phút + ghép cặp | ≈ 28 phút | ≈ 2,8 giờ |

Kiểm tra 3.000 bài sát hạn (bot mẫu, 5,2 giây-luồng mỗi bài):
- 4 luồng: khoảng 65 phút.
- 20 luồng: khoảng 13 phút.
- 48 luồng: khoảng 5,5 phút.

Bài vẫn có biên nhận ngay khi nộp; phần kiểm tra chạy sau.

Cách dùng bảng:
1. Đo bot thật: sau khi đóng nhận bài, chạy thử vài lượt hoặc xem cột CPU trong replay.
2. Chọn số luồng để mỗi lượt xong trong khung giờ BTC muốn.
3. Thêm máy chấm USB qua đợt đăng ký ([USB-BOOT.md](USB-BOOT.md)). Coordinator xử lý được ít nhất khoảng 33 ván/giây (8.000 ván trong 244 s ở thử tải), nên không phải là giới hạn với số máy chấm như trên.

## 4. Giới hạn đã biết

- Chỉ có một coordinator (SQLite). Nếu máy này hỏng, khôi phục từ snapshot ([RUNBOOK.md](RUNBOOK.md)); chưa có chạy song song hai coordinator.
- Ghép cặp chạy đồng bộ, 2–5 s mỗi lượt với 1.000 đội; trong lúc đó các request khác phải chờ.
- Trang admin của vòng loại (gồm mọi cặp và ván) nặng khoảng 660 KB với 1.000 đội; p95 2,6 s khi đang tải cao.
- Bảng vòng loại trên portal có thể trễ tối đa 2 giây so với kết quả mới nhất. Các thao tác chốt (duyệt đội đi tiếp, ghép cặp) luôn dùng dữ liệu tức thời.
