# USB boot: máy chấm và máy thí sinh (D15)

Cập nhật: 20/10/2026.

Hai ảnh USB dựng từ cùng một rootfs gốc. Rootfs này là rootfs máy chấm xuất từ image sandbox, nên g++ 12.2, Python 3.11 và `IMAGE_ID` giống hệt máy chấm Docker/WSL2. Nhờ vậy, máy chấm USB nhận được mọi việc đã ghim image. Kernel lấy từ bookworm-backports (6.12, do Debian ký) vì sandbox cần Landlock ABI ≥ 3.

| | USB máy chấm `ott-grader.img` | USB máy thí sinh `ott-thisinh.img` |
|---|---|---|
| Kích thước | khoảng 380 MiB | khoảng 1,6 GiB, gồm 1 GiB lưu bài; bản `-wifi` khoảng 1,7 GiB |
| Khởi động | Chép cả hệ thống vào RAM (`toram`), không swap | Desktop XFCE tự đăng nhập, không mật khẩu, không sudo, root bị khóa |
| Mạng | Tự lấy giờ từ coordinator, rồi tự đăng ký bằng mã | Tường lửa chỉ cho DHCP và đúng IP:cổng của portal; sai cấu hình thì chặn toàn bộ mạng |
| Ứng dụng | Grader agent với sandbox bwrap, tự chạy lại khi lỗi | Firefox ESR chỉ mở được portal; Geany (F5 = chạy thử với bot mẫu); "Chạy thử bot" (`ott-run`) |
| Lưu lại sau khi tắt máy | Không lưu gì | Chỉ `~/bai-lam` (phân vùng `persistence`); mọi thứ khác về sạch sau mỗi lần khởi động |
| Ổ cứng của máy | Không mount, không ghi | Không mount, không ghi |

Bố cục USB (MBR, khởi động được bằng cả BIOS cũ và UEFI có Secure Boot qua shim/GRUB do Debian ký):

| Phân vùng | Nội dung |
|---|---|
| 1 | Hệ thống live (ISO9660) |
| 2 | EFI |
| 3 | `OTTCONF`, FAT32, mở và sửa được bằng Notepad trên Windows |
| 4 | `persistence`, ext4, chỉ có ở USB thí sinh |

## Ban tổ chức: dựng ảnh

Chỉ làm một lần trên máy Windows có WSL2. Mọi thứ nằm ở ổ E:.

```powershell
# 1. Rootfs gốc (đã có từ Phase 2b): E:\OTTv2-local\ott-grader.tar — xem GRADERS.md (scripts/wsl/build-rootfs.ps1).
# 2. Distro dựng ảnh, tách khỏi distro máy chấm:
wsl --import ott-build E:\OTTv2-local\wsl\ott-build E:\OTTv2-local\ott-grader.tar --version 2
wsl -d ott-build -u root -- sh -c "apt-get update && apt-get install -y --no-install-recommends xorriso squashfs-tools mtools dosfstools grub-efi-amd64-bin grub-pc-bin shim-signed grub-efi-amd64-signed rsync qemu-system-x86 qemu-utils ovmf e2fsprogs fdisk curl ca-certificates"
# 3. Dựng (mỗi ảnh 3–4 phút, cần Internet để tải kernel/XFCE/Firefox từ Debian):
npm run usb:build -- grader
npm run usb:build -- thisinh                 # chỉ cáp LAN (mặc định cho chung kết)
npm run usb:build -- thisinh --with-wifi     # thêm firmware Wi-Fi cho laptop không có cổng LAN
# 4. Kiểm thử tự động trong QEMU (khoảng 2–5 phút mỗi lệnh):
npm run usb:test -- grader            # thêm --bios để thử BIOS cũ
npm run usb:test -- thisinh
```

**Mật khẩu GRUB:** menu khởi động bị khóa. Máy vẫn tự khởi động, nhưng muốn sửa lệnh khởi động (bấm `e`) hay mở dòng lệnh GRUB thì phải đăng nhập `btc` bằng mật khẩu đặt lúc dựng ảnh:
- Đặt trước `OTT_GRUB_PASSWORD` (ít nhất 12 ký tự). Trên PowerShell: `$env:OTT_GRUB_PASSWORD='…'; $env:WSLENV='OTT_GRUB_PASSWORD'`.
- Nếu không đặt, lệnh dựng tự sinh một mật khẩu và chỉ in ra một lần.
- Ảnh chỉ lưu bản băm PBKDF2. Không đưa mật khẩu cho thí sinh; mỗi giải nên dựng ảnh với mật khẩu mới.
- Kiểm tra khóa: `npm run usb:test -- thisinh --grub-lock` (thêm `--bios` để thử BIOS cũ).

Ảnh nằm ở `E:\OTTv2-local\usb\`, kèm file `.sha256`. Ghi ra USB bằng Rufus (chọn **chế độ DD**), balenaEtcher hoặc `dd`. Ghi xong, Windows hiện thêm một ổ tên `OTTCONF`.

## Cấu hình trước ngày thi

### USB máy chấm

1. Vào admin → **Giám sát** → **Đăng ký máy chấm USB** → **Mở đợt đăng ký máy chấm**. Mặc định đợt mở 15 phút, tối đa 50 máy, tiền tố tên `usb`.
2. Lấy mã vừa hiện, rồi tạo file cấu hình:

   ```text
   npm run usb:config -- grader --url http://<IP LAN của máy chủ>:3000 --code <mã> --slots 2 --out <ổ OTTCONF>
   ```

   Cách khác: dán đoạn `grader.env` mà admin hiển thị vào file `OTTCONF\grader.env` bằng Notepad.
3. Một file `grader.env` dùng chung được cho mọi USB.
4. Cắm USB vào từng máy chấm, chọn khởi động từ USB (thường là phím F12, F9, F8 hoặc Esc).
   - Máy tự lấy giờ, tự đăng ký và hiện trong danh sách máy chấm với tên `usb-<số> (ott-grader-<6 ký tự MAC>)`.
5. Khi đã đủ máy, bấm **Đóng đợt đăng ký**.
   - Từ lúc này mã trong `grader.env` hết tác dụng.
   - Máy đã đăng ký vẫn chạy. Máy nào khởi động lại thì cần mở đợt mới.

Khóa riêng của mỗi máy chỉ nằm trong RAM (`/run`), nên rút USB hay tắt máy là khóa mất. Máy mất hoặc nghi bị chiếm quyền thì bấm **Thu hồi** trong danh sách. Mỗi lần dịch vụ máy chấm tự khởi động lại đều dùng lại khóa cũ, không tốn thêm lượt đăng ký.

### USB máy thí sinh

1. Tạo file cấu hình:

   ```text
   npm run usb:config -- thisinh --portal http://<IPv4 của máy chủ>:3000 --out <ổ OTTCONF>
   ```

   - Bắt buộc dùng địa chỉ IPv4. Tường lửa chỉ mở đúng địa chỉ đó, không dùng DNS.
   - Bản `-wifi`: bỏ dấu `#` ở hai dòng `WIFI_SSID`/`WIFI_PASSWORD` trong `portal.env`.
2. Kiểm tra một file sửa tay: `npm run usb:config -- check <file>`.
3. Khi thi, máy tự mở Firefox vào portal và Geany với `~/bai-lam/main.py`.
   - Bấm F5 trong Geany (hoặc mở menu "Chạy thử bot") để bot đấu 2 ván với bot mẫu và xem `replay.html`.
   - Học sinh nộp bài qua portal như bình thường.
4. Bài làm ghi xuống USB trong khoảng 2 giây sau khi lưu.
5. Sau giải, BTC đọc hoặc xóa `~/bai-lam` bằng cách ghi lại ảnh USB.

## Đã kiểm chứng (QEMU, 20/10/2026)

`npm run usb:test` dựng một coordinator thật trên máy dựng ảnh rồi khởi động USB trong QEMU, máy ảo nhìn thấy coordinator ở địa chỉ `10.0.2.2`.

Có hai điều kiện thêm vào để mô phỏng tình huống xấu:
- Gắn thêm một "ổ cứng của máy" nhãn INTERNAL.
- Với máy chấm, đặt đồng hồ máy về năm 2020.

Kết quả:

| Ảnh | UEFI + Secure Boot (khóa Microsoft) | BIOS (SeaBIOS) |
|---|---|---|
| Máy chấm | Đạt | Đạt |
| Thí sinh (2 lần khởi động) | Đạt | Đạt |
| Thí sinh `-wifi` (2 lần khởi động) | Đạt | — |

**Máy chấm:**
- Kết nối 14–18 giây sau khi bật máy và chấm thật một bài Python: Accepted, chạy trong sandbox bwrap ngay trên USB.
- Đồng hồ lệch 6 năm được chỉnh theo coordinator.
- Chỉ phân vùng `OTTCONF` được mount; ổ INTERNAL không mount và không đổi byte nào.

**Máy thí sinh:**
- Mạng:
  - Portal trả mã 200.
  - Internet (`1.1.1.1`), cổng khác trên chính máy chủ và DNS đều bị chặn.
  - Tường lửa có chính sách mặc định là chặn.
- Trình duyệt:
  - Firefox thật sự tải được `/portal` và `/assets/app.js`; máy chủ ghi nhận các yêu cầu này.
  - Trang chủ Firefox bị khóa vào portal.
- Desktop và quyền:
  - XFCE và Firefox chạy; ảnh chụp ở `output/playwright/usb-thisinh-desktop.png`.
  - Không có sudo, root bị khóa.
- Công cụ:
  - `ott-run` chạy được và xuất `replay.html`.
  - g++ 12.2.0 và Python 3.11.2 khớp với máy chấm.
- Lưu bài và ổ của máy:
  - File trong `~/bai-lam` còn sau khi khởi động lại.
  - Ổ INTERNAL không bị mount và không bị ghi.

Lỗi phát hiện nhờ test và đã sửa:
- live-boot mặc định mount mọi ổ (kể cả ổ của máy) để tìm file persistence; nay dùng `persistence-storage=filesystem`.
- Mẫu ngoại lệ của Firefox có kèm cổng khiến Firefox chặn luôn portal.
- Dữ liệu vừa lưu bị mất nếu tắt máy ngay; nay ghi xuống USB trong vòng 2 giây.
- Kernel 6.1 không đủ Landlock cho sandbox.

## Chưa kiểm chứng: BTC phải tự thử trên máy thật

- Secure Boot trên máy thật của từng hãng (một số máy chỉ tin khóa của hãng, khi đó phải tắt Secure Boot hoặc bật "3rd party CA").
- Phím chọn khởi động, chế độ CSM/BIOS cũ, USB-C, USB SSD.
- Card đồ họa rời (NVIDIA không có driver độc quyền, chỉ dùng `nouveau`/VESA), màn hình độ phân giải cao.
- Wi-Fi thật: bản `-wifi` chỉ được thử là khởi động được, chưa kết nối mạng Wi-Fi thật nào.
- 30–100 máy cùng đăng ký và cùng mở portal; Rufus/Etcher ghi hàng loạt USB.
- Gõ tiếng Việt: chưa có bộ gõ. Code và chú thích không dấu không bị ảnh hưởng.

## Giới hạn

- Máy thí sinh chỉ chặn ở tầng mạng và trình duyệt. Thí sinh có quyền trên máy (ví dụ BIOS, khởi động hệ điều hành khác) thì phải có giám thị.
- Mã đăng ký trong `grader.env` là bí mật trong lúc đợt còn mở. Đóng đợt ngay khi đủ máy.
- Mỗi lần đổi mã nguồn OTTv2 cần dựng lại ảnh và ghi lại USB. Máy chấm báo `ENGINE_HASH` khác thì coordinator từ chối giao việc.
