# Chốt luật vòng chính thức

Chức năng chuẩn bị cho việc đổi luật trước loại trực tiếp. Admin chốt sau khi duyệt đội đi tiếp và trước khi bắt đầu chấm loại trực tiếp; có thể làm trước hoặc sau khi tạo sơ đồ. Đã có cửa sổ nhận và kiểm tra bài nộp lại; đã có chốt bot mới và chạy trận bằng luật chính thức sau khi mọi đội đủ bài hợp lệ.

## Thao tác

1. Chọn giải, duyệt danh sách đội đi tiếp.
2. Tại **Luật vòng chính thức**, chọn phiên bản cụ thể. Danh sách gồm các phiên bản đã lưu; tên ở lựa chọn có thể là tên mới nhất của bộ luật, trạng thái sau chốt hiển thị tên thực tế của phiên bản đã chọn.
3. Nhập lý do và bấm **Chốt phiên bản luật chính thức**. Luật đã chốt không được sửa hoặc chốt lại.
4. Nếu cùng mã và phiên bản luật vòng loại: tiếp tục dùng bot đã chốt, chạy tự động hoặc từng cặp/vòng như trước.
5. Nếu khác mã hoặc phiên bản: giao diện khóa cả hai nút bắt đầu; API cũng chặn. Có thể mở [đợt nộp lại](FINAL-INTAKE.md) để nhận và kiểm tra theo luật mới; còn thiếu bước chốt bot mới trước khi chạy. Không sửa database hoặc chỉ đổi tên bộ luật để bỏ qua bước này.

Chưa chốt riêng vẫn chạy được luồng giữ bot/luật vòng loại. Giải đang chạy hoặc đã kết thúc không được đổi luật. Bản luật vòng loại, thứ hạng, bản xem lại cũ và danh sách đã duyệt không bị sửa khi chốt luật chính thức.

## Dữ liệu và API

Migration 14 tạo `tournament_final_rules`, liên kết bản duyệt đội và phiên bản bộ luật, lưu toàn bộ nội dung luật bất biến, dấu thời gian, người chốt, lý do và cờ cần nộp lại. Không cập nhật luật đã lưu khi bộ luật có phiên bản mới. Ghi bản chốt, tăng revision giải và ghi nhật ký trong một giao dịch.

- `GET /api/admin/tournaments/:id/final-rule`: trả `{ finalRule: null }` nếu chưa chốt.
- `POST` cùng đường dẫn: admin, CSRF; nhận `expectedRevision` của giải, `ruleSetId`, `ruleSetVersion` và `reason` 1–1000 ký tự. Trả 201 nếu thành công.
- Phiên bản không tồn tại, chốt trùng, trạng thái sai, dữ liệu cũ hoặc đã bắt đầu loại trực tiếp bị chặn; không ghi bản chốt dở dang.

Chốt luật là bước chuẩn bị của admin. Muốn công bố cho thí sinh, mở đợt nộp lại theo [hướng dẫn](FINAL-INTAKE.md). Khi khác luật, phải nhận/kiểm tra/chốt đủ bot trong đợt mới rồi máy chấm mới tiếp nhận, cho cả chế độ tự động và thủ công.

## Kiểm chứng

Kiểm thử chọn phiên bản cũ khi đã có bản mới, bất biến, quyền/CSRF, revision, luật không tồn tại, chốt sau khi chạy, chống dùng bot cũ khi đổi luật, lưu/đọc lại SQLite và bảo toàn dữ liệu vòng loại. Không dùng các kiểm thử này để xác nhận chức năng nộp lại đã hoàn tất.
