# Theo dõi công việc

- Mỗi lần bắt đầu làm việc trong dự án, kiểm tra web tại http://127.0.0.1:3000/api/health. Nếu chưa chạy, khởi động bằng `npm start` tại thư mục OTTv2, giữ tiến trình hoạt động và xác nhận trang `/portal` truy cập được. Nếu đã có server hoạt động thì dùng lại, không chạy trùng hoặc tự dừng server. Đây là yêu cầu trực tiếp của người dùng ngày 19/10/2026.

- Đọc `TODO.md` trước khi thực hiện công việc trong dự án.
- Sau mỗi đợt công việc, tự cập nhật các mục liên quan trong `TODO.md` và thêm bằng chứng vào nhật ký tiến trình.
- Chỉ đánh dấu `[x]` khi đạt tiêu chí nghiệm thu trong phạm vi mục đó. Phân biệt đã viết code, đã chạy test và đã kiểm chứng vận hành thực tế.
- Việc hoàn thành một phần phải được tách nhỏ; không đánh dấu xong toàn bộ. Mở lại mục nếu lỗi mới làm mất điều kiện nghiệm thu.
- Nếu chỉ tư vấn hoặc đọc tài liệu, không đánh dấu các phần triển khai là đã xong. Không tự cài đặt, triển khai hoặc sửa code chỉ vì mục đó có trong checklist.
- Không ghi thông tin bí mật hay dữ liệu thí sinh thật vào checklist hoặc nhật ký.

# Bảo trì tài liệu người dùng

- Khi thay đổi yêu cầu môi trường, lệnh cài/chạy, tài khoản ban đầu, biến môi trường, luồng sử dụng hoặc giới hạn tính năng, cập nhật docs/CAI-DAT-VA-SU-DUNG.md và README.md trong cùng đợt; sửa ngày cập nhật theo thực tế.
- Khi sửa quy tắc giải, cập nhật docs/QUY-TAC-GIAI-DAU.md và chạy node scripts/build-tournament-guide.js; kiểm tra liên kết và lệnh khớp mã nguồn.
