# Sổ tay vận hành ngày thi

Cập nhật: 20/10/2026 (Phase 8). Dành cho ban tổ chức (BTC).

Ai làm việc nào: [RACI.md](RACI.md). Rủi ro và cách phòng: [RISKS.md](RISKS.md). Số máy chấm cần có: [CAPACITY.md](CAPACITY.md). Thể thức: [FORMAT.md](FORMAT.md).

## Danh mục trước giải (giải online lớn)

1. **Máy chủ:**
   - Cùng mã nguồn với các máy chấm (máy chấm có `ENGINE_HASH` khác sẽ bị từ chối).
   - `COOKIE_SECURE=true` sau HTTPS/Tunnel.
   - Snapshot ra ổ khác (`SNAPSHOT_DIR`).
2. **Tài khoản:** nhập đội bằng CSV.
   - Mật khẩu được băm bằng scrypt, chạy song song; 4.000 lượt đăng nhập đo được trong khoảng 105 giây trên laptop 12 nhân.
   - Tài khoản tạo trước Phase 8 tự chuyển sang scrypt ở lần đăng nhập đầu, nên lần đó chậm hơn một chút.
3. **Máy chấm:** đủ số máy theo [CAPACITY.md](CAPACITY.md) trước khi đóng nhận bài.
   - Máy chấm Docker/WSL2 tạo khóa ở admin.
   - USB máy chấm dùng đợt đăng ký ([USB-BOOT.md](USB-BOOT.md)).
4. **Red team:** chạy `npm test` (gồm `redteam.test.js`), `npm run test:bwrap` trên máy chấm và `npm run usb:test -- thisinh --grub-lock` với ảnh USB sẽ phát ([RED-TEAM.md](RED-TEAM.md)).
5. **Diễn tập:** một giải nhỏ từ đầu đến cuối với đúng cấu hình và bộ luật; chụp snapshot rồi khôi phục thử trên máy dự phòng.

# Ngày thi LAN (không cần Internet)

## Trước ngày thi

1. Máy chủ chính và **máy chủ dự phòng** có cùng mã nguồn, `npm ci`, cùng image sandbox (`docker load` từ cùng file, xem [GRADERS.md](GRADERS.md)) hoặc cùng distro `ott-grader`.
2. Đặt địa chỉ IP LAN cố định cho máy chủ, mở firewall cổng `PORT`.
3. Cắm ổ ngoài cho snapshot; chạy server với:

```powershell
$env:HOST = '0.0.0.0'; $env:PORT = '3000'
$env:SNAPSHOT_DIR = 'F:\ott-snapshots'      # ổ ngoài, không đặt cùng ổ với data/
$env:SNAPSHOT_INTERVAL_MINUTES = '10'; $env:SNAPSHOT_KEEP = '48'
npm start
```

4. Chạy `npm run offline:check` khi đã rút cáp Internet: không được có dòng `[LỖI]`. Tắt các biến cần Internet (TURNSTILE_*, GITHUB_APP_ID, SITE_AUTO_DEPLOY).
5. Nạp danh sách đội và bot đã chốt (bundle từ máy online ở Phase 5b; trước đó có thể chạy toàn bộ giải trên máy LAN).
6. Diễn tập: rút điện máy chủ khi đang chạy ván, bật lại, kiểm tra mục Giám sát.

## Trong ngày thi

- Thí sinh vào `http://<IP máy chủ>:<PORT>/portal`, đăng nhập, nộp bài; sandbox kiểm tra ngay trên máy chủ LAN.
- **Kênh dự phòng ở bàn BTC:** đội chép bot vào USB (`<mã đội>/ott.json + bot/`, `<mã đội>.zip` hoặc `<mã đội>.py/.cpp`). Admin → Giải đấu → **Nhập bài từ thư mục / USB**, chọn đúng nơi nhận bài, ghi **thời điểm nhận tại bàn** nếu nhập sau hạn. Bài vẫn được sandbox kiểm tra; nhập lại USB không tạo bản trùng. Lệnh tương đương khi không mở được giao diện: `npm run import:folder -- --stage <mã giai đoạn> --dir <thư mục> --reason "..." [--received-at 2026-11-01T09:58+07:00]` (server đang chạy sẽ tự kiểm tra bài).
- Mục **Giám sát → Sao lưu** hiện snapshot gần nhất; bấm **Chụp snapshot ngay** trước mỗi thao tác lớn (chốt bot, bắt đầu vòng, công bố).
- Kết quả xem tại `http://<IP máy chủ>:<PORT>/site/` sau mỗi lần công bố.

## Sự cố

| Tình huống | Cách xử lý |
| --- | --- |
| Mất điện / máy chủ tắt đột ngột | Bật lại, `npm start` với cùng biến môi trường. Ván và bài đang chạy dở được trả về hàng đợi ngay khi khởi động (không xử thua bot), các vòng tự chạy tiếp. Kiểm chứng: test:recovery kill tiến trình hai lần giữa vòng, kết quả trùng khớp lần chạy không gián đoạn. |
| Ổ đĩa máy chủ hỏng / máy chủ không bật được | Trên máy dự phòng: dừng server, `npm run restore -- F:\ott-snapshots\<snapshot mới nhất>` (kiểm tra băm, integrity_check, foreign_key_check; DB cũ nếu có được giữ lại, cần `--force`), rồi `npm start` với cùng biến môi trường. Đặt máy dự phòng sang IP cũ hoặc báo địa chỉ mới cho thí sinh; máy chấm từ xa đổi `COORDINATOR_URL`. Dữ liệu mất tối đa bằng chu kỳ snapshot. |
| Snapshot đang chụp thì mất điện | Bản dở dang (`*.partial`) không bao giờ được dùng và tự xóa ở lần chụp sau. |
| Mạng LAN của một đội lỗi | Dùng kênh USB ở bàn BTC như trên. |
| Mất Internet | Không ảnh hưởng thi LAN. Đồng bộ Google Sheets/Cloudflare tự thử lại hoặc chạy sau. |
| Máy chấm từ xa chết | Việc tự giao lại sau khoảng 30 giây; thu hồi khóa máy đó nếu bị mất. |
| Nhiều đội báo "Quá nhiều lần đăng nhập" | Giới hạn theo IP là 100 lần **sai** / 15 phút (đăng nhập đúng không bị tính). Có thể có người dò mật khẩu từ cùng mạng: kiểm tra bảng `login_limits`, xóa dòng `ip:…` nếu chắc chắn; đổi mật khẩu đội bị dò. |
| USB máy chấm không vào danh sách | Kiểm tra đợt đăng ký còn mở và chưa đủ số máy, đúng `COORDINATOR_URL` trong `OTTCONF/grader.env`, cáp mạng. Màn hình USB in lý do (mã sai, đợt đóng, không thấy máy chủ). |
| Máy thí sinh USB không vào portal | Kiểm tra `OTTCONF/portal.env`: phải là IPv4 của máy chủ và đúng cổng. Sai cấu hình thì máy cố ý chặn toàn bộ mạng. Đổi USB dự phòng nếu không kịp. |
| Cần sửa lệnh khởi động USB (ví dụ máy cần `nomodeset`) | Ở menu GRUB bấm `e`, đăng nhập `btc` bằng mật khẩu GRUB lúc dựng ảnh. Không đưa mật khẩu này cho thí sinh. |

Lưu ý: file DB và snapshot chứa hash mật khẩu và mã nguồn của các đội; giữ ổ ngoài như tài liệu mật.

## Đồng bộ máy online ↔ máy LAN (Phase 5b)

Bundle là thư mục `<mã>.ottbundle` (manifest ký Ed25519, dữ liệu và file bài nộp mã hóa AES-256-GCM bằng passphrase). Mỗi phạm vi dữ liệu chỉ một máy được ghi: **hệ thống** (tài khoản, hồ sơ đội, bộ luật) và **từng giải**. Máy không giữ quyền vẫn xem được nhưng không nhận bài, không chạy ván, không cho sửa; thí sinh thấy thông báo "chỉ đọc".

**Một lần trước ngày thi — ghép cặp:** trên mỗi máy chạy `npm run sync -- identity` (hoặc Admin → Giám sát → Đồng bộ) để lấy chuỗi kết nối, rồi trên máy kia `npm run sync -- add-peer <chuỗi>`. Đối chiếu **dấu khóa** hiển thị ở hai máy (đọc qua điện thoại hoặc gặp trực tiếp), không nhận chuỗi qua kênh không tin cậy.

**Khởi tạo máy LAN (DB trống):**
1. Máy online: Admin → Đồng bộ → Xuất bundle **Đầy đủ** cho máy LAN, tick bàn giao **Hệ thống** và **giải chung kết**, chọn thư mục USB, đặt passphrase ≥ 12 ký tự (đọc cho người bên LAN, không ghi lại). Hoặc `npm run sync -- export --peer <mã máy LAN> --dir E:\usb --handover system,tournament:<mã giải>` (passphrase qua biến `OTT_SYNC_PASSPHRASE` hoặc gõ khi được hỏi). Máy online lập tức chỉ đọc cho phần đã bàn giao.
2. Máy LAN (chưa có tài khoản nên dùng CLI): `npm run sync -- import --dir E:\usb\<mã>.ottbundle`, rồi `npm start`. Thí sinh và admin đăng nhập bằng mật khẩu cũ.

**Sau chung kết:** máy LAN xuất bundle **Chỉ thay đổi** (hoặc Đầy đủ nếu không chắc) cho máy online, tick bàn giao lại; máy online nhập qua giao diện. Nhập lại cùng bundle không thay đổi gì. Bundle sửa dù một byte, sai passphrase, từ máy chưa ghép cặp hoặc gửi cho máy khác đều bị từ chối trước khi ghi. Thay đổi từ máy không giữ quyền được báo **xung đột** và không áp dụng.

**Mất bundle bàn giao:** nếu USB hỏng trước khi máy nhận kịp nhập, máy gửi đang chỉ đọc. Kiểm tra chắc chắn máy kia **chưa** nhập, rồi dùng API khẩn cấp `POST /api/admin/sync/reclaim` (lý do + gõ "LẤY LẠI QUYỀN"); nếu cả hai cùng ghi sẽ phải đối chiếu tay. Mất passphrase: xuất lại bundle từ máy nguồn.

Lưu ý: hai máy phải chạy cùng phiên bản mã nguồn (cùng schema); bundle đầy đủ chứa hash mật khẩu và toàn bộ mã nguồn bot — giữ USB như tài liệu mật dù đã mã hóa.
