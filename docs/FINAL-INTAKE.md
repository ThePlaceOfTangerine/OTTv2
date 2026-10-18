# Công bố luật và nhận bot nộp lại

## Phạm vi

Đã có công bố luật chính thức, mở/đóng đợt nộp lại chỉ cho đội đi tiếp, hạn riêng, lựa chọn phiên bản riêng và kiểm tra Python/C++ theo luật ghim của đợt mới. Bài, bot đã chốt, điểm và bản xem lại vòng loại vẫn giữ riêng.

**Đã có chốt bot nộp lại và dùng chúng trong loại trực tiếp.** Sau khi mở đợt này, cả API và giao diện yêu cầu chốt bot mới; không cho bỏ qua bằng bot cũ. Chính sách hiện tại yêu cầu mọi đội đã duyệt có bài hợp lệ trong đợt mới. Đội thiếu bài hoặc tài khoản không hoạt động sẽ chặn toàn bộ thao tác chốt, không loại đội hay thay hạt giống ngầm.

## Admin thao tác

1. Duyệt đội đi tiếp và chốt phiên bản luật chính thức trước khi chạy loại trực tiếp.
2. Trong **Công bố luật và mở đợt nộp lại**, viết thông báo giải thích luật và việc đội cần làm.
3. Nhập giờ mở và hạn nộp theo giờ Việt Nam; bỏ trống giờ mở để mở ngay. Hạn đóng phải ở tương lai và sau giờ mở.
4. Xác nhận chính sách **bắt buộc có bài hợp lệ trong đợt mới; không tự dùng bot vòng loại chưa kiểm tra theo luật này**.
5. Bấm **Công bố luật và mở nộp lại**. Danh sách lấy đúng các đội đã duyệt, không lấy lại toàn bộ danh sách vòng loại hoặc tự thay tài khoản bị khóa.
6. Bấm **Cập nhật bài nộp lại** để xem tiến độ. Có thể nhập lý do rồi **Đóng nhận bài nộp lại** sau khi giờ mở bắt đầu. Hết hạn thì backend tự từ chối bài mới kể cả khi admin chưa bấm đóng.

7. Chờ hết hàng đợi, xử lý lỗi hạ tầng, nhập lý do và bấm **Chốt bot chính thức**. Có thể chốt khi đã đóng sớm hoặc hết hạn. Nếu đã chọn riêng một bài hợp lệ, giữ bài đó; nếu chưa chọn, dùng bài hợp lệ mới nhất trong đợt. Thao tác lưu tất cả bot và nhật ký trong cùng giao dịch; lỗi một đội không chốt dở các đội khác.
8. Tạo sơ đồ nếu chưa có, rồi chọn chạy toàn bộ hoặc từng cặp/vòng. Máy chấm ghim nguồn bot mới, luật mới và giữ nguyên danh sách/hạt giống đã duyệt.

Không mở lại đợt thứ hai, đổi luật, thay thông báo, đổi danh sách hay gia hạn trong bước này. Chọn giờ và thông báo trước khi công bố. Luật được lưu nguyên nội dung từ bản chốt, không tự chuyển sang phiên bản mới.

## Thí sinh thao tác

Đội đã vượt vòng loại vào **Nơi nộp bài → tên giải · Nộp lại vòng chính thức**. Bấm cập nhật giải nếu chưa thấy lựa chọn mới. Đội không thuộc danh sách đi tiếp không thấy hoặc truy cập được đợt này.

Khối trạng thái hiển thị thông báo, tên/phiên bản luật, giờ Việt Nam, hạn nộp và thời gian còn lại. Đọc **Quy tắc của vòng đang chọn** và mở cấu hình đầy đủ khi cần tọa độ xuất phát. Nộp file Python/C++/ZIP và chờ kiểm tra như bình thường; có thể chọn một bản hợp lệ trong chính đợt này trước hạn.

Bài đã nhận đúng hạn tiếp tục được chấm sau hạn. Yêu cầu gửi lại cùng mã biên nhận trả đúng bài cũ, không tạo thêm bài sau hạn. Bản mới bị từ chối không làm mất bản hợp lệ trước đó của đợt mới. Chưa có bài hợp lệ trong đợt mới thì lựa chọn là trống, không tự lấy bài vòng loại.

## API và lưu trữ

- `GET /api/admin/tournaments/:id/final-intake` trả `{ intake: null }` nếu chưa mở.
- `POST .../final-intake/open`: admin + CSRF; nhận `expectedRevision` của giải, `opensAt` (có thể null), `closesAt`, `announcement` 1–3000 ký tự và `fallbackPolicy: "require_valid_final_submission"`.
- `POST .../final-intake/close`: admin + CSRF, phiên bản giải và `reason` 1–1000 ký tự.
- `POST .../final-intake/lock`: admin + CSRF, `expectedRevision` của giải và `reason` 1–1000 ký tự. Chặn chốt trùng, hàng đợi chưa xong, thiếu bài hoặc tài khoản khóa; snapshot được trigger bảo vệ.
- `POST .../bracket/start` dùng `rulesPolicy: "use_final_intake"` khi có đợt nộp lại; `keep_qualifier` chỉ hợp lệ khi không mở đợt mới và luật không đổi.
- API thí sinh dùng các đường dẫn `/api/portal/stages/:stageId/submissions` hiện có; kiểm tra tư cách thành viên, hạn, biên nhận và luật theo mã giai đoạn mới.

Migration 15 mở rộng loại giai đoạn thành `qualifier`/`final`, thêm bảng thông báo/chính sách, giữ các khóa ngoại và khôi phục đầy đủ trigger chống sửa bot/luật đã chốt. Việc dựng lại bảng có giao dịch và kiểm tra khóa ngoại trước khi commit; luôn sao lưu trước khi nâng cấp DB đang dùng.

## Bằng chứng

Unit/API: đội đủ điều kiện, công bố, lịch mở tương lai, hạn, đóng sớm, dữ liệu cũ, tài khoản khóa, lựa chọn/biên nhận độc lập, chặn lấy bot cũ và kiểm tra sau hạn. Có kiểm thử nâng cấp từ ràng buộc giai đoạn chỉ vòng loại thật sự của schema 14, bảo toàn bản chốt và khóa ngoại.

`npm run test:stages` chạy Docker Python/C++: vòng loại luật 8 nước, ghim luật chính thức 12 nước, mở nộp lại, nhận hai bài rồi đóng khi còn kiểm tra; bài được chấp nhận theo đúng luật mới. Mở lại SQLite vẫn có đợt mới, bài hợp lệ và kết quả vòng loại cũ.

Kiểm thử chốt bổ sung: thiếu một đội phải rollback, dữ liệu cũ/quyền/tài khoản khóa/chốt trùng, trigger bất biến, dùng snapshot thay metadata thay đổi và giữ nguyên luật/bot vòng loại.
