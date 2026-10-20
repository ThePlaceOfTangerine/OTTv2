# Thông báo mẫu gửi thí sinh

Cập nhật: 20/10/2026.

Ban tổ chức (BTC) sao chép phần dưới đường kẻ, thay các chỗ `[…]`, rồi gửi cho thí sinh (email, trang giải, nhóm chat). Mọi con số phải khớp với cấu hình đã lưu trong admin trước khi mở nhận bài ([FORMAT.md](FORMAT.md)).

---

# [Tên giải]: Đấu trường bot Búa · Bao · Kéo

Mỗi đội viết một chương trình (bot) bằng **Python** hoặc **C++** để tự chơi cờ Búa · Bao · Kéo trên bàn cờ. Hệ thống cho các bot đấu với nhau, xếp hạng, và các đội đứng đầu vào vòng loại trực tiếp.

## Mốc thời gian (giờ Việt Nam)

| Mốc | Thời gian |
|---|---|
| Nhận tài khoản đội qua email | [ngày giờ] |
| Mở nộp bài | [ngày giờ] |
| **Hạn nộp bài vòng loại** | **[ngày giờ]** |
| Vòng loại (máy tự chấm, không cần có mặt) | [ngày giờ] |
| Công bố bảng vòng loại (tạm tính) và nhận khiếu nại trong 30 phút | [ngày giờ] |
| Công bố [N] đội đi tiếp và luật chung kết | [ngày giờ] |
| Nộp lại bot cho chung kết (nếu có đổi luật) | [ngày giờ – ngày giờ] |
| Chung kết tại [địa điểm] | [ngày giờ] |

## Bắt đầu trong 15 phút

1. Đăng nhập `[địa chỉ portal]` bằng tài khoản đội. Lần đầu sẽ phải đổi mật khẩu. Một đội có 1–4 thành viên, dùng chung tài khoản.
2. Tải **mã mẫu** Python hoặc C++ ở trang chủ portal và nộp thử nguyên file để làm quen.
3. Đọc hướng dẫn viết bot: `[địa chỉ portal]/docs/PROTOCOL.md`.
4. Sửa hàm chấm điểm nước đi trong mã mẫu để bot chơi tốt hơn.
5. Chạy thử trên máy mình trước khi nộp:
   - Gói thử bot: kéo `main.py` vào `chay-thu.bat`.
   - Mã nguồn: `npm run ott-run -- main.py`.
   - Bot sẽ đấu 2 ván với bot mẫu, báo lỗi bằng tiếng Việt và mở bản xem lại.

## Cách nộp

- **GitHub (khuyên dùng):** repo **Private**, cài GitHub App `[tên App]`, đặt `ott.json` và thư mục `bot/` theo hướng dẫn trong portal (mục Đội & GitHub). Nộp bằng nút "Nộp commit này" hoặc tag `ott-submit`. Khi hết hạn, hệ thống lấy commit cuối cùng nhận được trước hạn.
- **Upload:** file `.py`/`.cpp` (tối đa 1 MB) hoặc ZIP (tối đa 5 MB).
- Mỗi bài được kiểm tra tự động: không dùng thư viện bị cấm, chạy được, và đấu 2 ván thử với bot mẫu. **Không cần thắng bot mẫu.**
- Mỗi đội tối đa 3 bài đang chờ kiểm tra cùng lúc. **Đừng để sát giờ:** bài tính theo thời điểm hệ thống nhận được, có biên nhận.

## Luật chính

- **Giới hạn mỗi nước:** 0,5 giây CPU, 3 giây chờ, 256 MB bộ nhớ; cả ván tối đa 30 giây CPU.
- **Thua ván do lỗi bot:** crash, quá giờ, nước sai, in sai định dạng. Lỗi của máy chủ không bao giờ tính cho đội.
- **Vòng loại:** [số] lượt; mỗi lượt gặp một đội gần điểm, 2 ván đổi bên. Thắng cặp 1 điểm, hòa 0,5.
- **Loại trực tiếp:** [N] đội, mỗi cặp [số] ván.
- **Công bố:** kết quả công khai tại `[địa chỉ site kết quả]`. Mỗi đội có mã tra cứu riêng trong portal.
- **Cấm:** dùng chung code giữa các đội, tấn công hệ thống, dùng tài khoản đội khác. Vi phạm sẽ bị loại.
- Thể thức đầy đủ: [đường dẫn FORMAT / thể lệ của BTC].

## Chung kết tại hội trường (nếu có)

- Thí sinh dùng máy khởi động từ USB của BTC (Linux có trình soạn code Geany và Firefox), hoặc [máy của trường].
- Máy chỉ vào được portal của giải, không có Internet. Bài làm lưu trong thư mục `bai-lam`.
- Mang theo: thẻ sinh viên/học sinh, [khác].

## Câu hỏi thường gặp

- **Bot báo "Hệ thống chưa đọc được câu trả lời"?** Bot in thêm chữ ra màn hình. Chỉ in đúng một dòng JSON như mã mẫu; muốn in để gỡ lỗi thì in ra stderr.
- **Bài bị "Tạm dừng do lỗi máy chủ"?** Không phải lỗi của đội. Hệ thống tự thử lại; BTC xử lý nếu vẫn dừng.
- **Không đăng nhập được?** Sai mật khẩu nhiều lần sẽ phải chờ 15 phút. Nhờ BTC cấp lại mật khẩu qua [kênh hỗ trợ].
- **Nộp nhiều lần có sao không?** Không. Bản hợp lệ mới nhất trước hạn (hoặc bản đội tự chọn) sẽ thi đấu.

Liên hệ: [email/nhóm hỗ trợ], giờ trực [khung giờ].
