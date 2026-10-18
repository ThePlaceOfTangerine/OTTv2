# Sơ đồ vòng loại trực tiếp

## Phạm vi hiện tại

Sau khi duyệt đội đi tiếp, quản trị viên tạo sơ đồ cố định theo hạt giống. Đã có lưu sơ đồ, các nhánh dẫn tới chung kết, miễn đấu, chạy toàn bộ loại trực tiếp, đấu thêm khi hòa, bản xem lại và duyệt nhà vô địch. Trạng thái “Đã đủ hai đội” chỉ nói hai đội đã xác định, không có nghĩa đã thi đấu.

## Cách xếp

- Số vị trí là lũy thừa của hai nhỏ nhất đủ cho danh sách: 3 đội dùng 4 vị trí; 5 đội dùng 8 vị trí.
- Hạt giống 1 và 2 ở hai nửa sơ đồ. Trong sơ đồ 8 vị trí, thứ tự là 1–8, 4–5, 2–7, 3–6.
- Vị trí lớn hơn số đội là suất trống. Hạt giống cao nhận suất miễn đấu: 5 đội có 3 suất cho hạt giống 1, 2 và 3. Không tạo trận giả, không cộng điểm vòng loại.
- Mỗi cặp ở vòng sau nhận đội thắng từ hai cặp liền trước. Các nhánh không được bốc lại sau mỗi vòng.
- Chỉ dùng danh sách đã duyệt; không tự thay thế đội khi tài khoản đổi hoặc bị khóa. Quy định xử lý đội bị loại hành chính sau duyệt chưa được triển khai.

## Thao tác và dữ liệu

Trong **Giải đấu**, sau khi chốt đội đi tiếp, nhập ghi chú và bấm **Tạo sơ đồ loại trực tiếp**. Kiểm tra các cặp, hạt giống, suất miễn đấu và vòng sau. Có thể tải lại để đối chiếu; không có thao tác tạo lại hoặc đổi nhánh sau khi lưu.

`GET /api/admin/tournaments/:id/bracket` trả `{ bracket: null }` nếu chưa tạo. `POST` cùng đường dẫn yêu cầu admin, CSRF, `expectedRevision` của giải và `reason` 1–1000 ký tự; trả 201 khi tạo thành công. Thiếu danh sách duyệt, sai trạng thái, phiên bản cũ hoặc đã có sơ đồ đều bị chặn; ghi sơ đồ, tăng phiên bản giải và nhật ký cùng giao dịch.

Thí sinh thuộc giải đọc `GET /api/portal/tournaments/:id/bracket`; tài khoản ngoài giải không có quyền đọc. Sơ đồ chỉ chứa thông tin đội/hạt giống và nhánh đấu, không trả mã nguồn hoặc đường dẫn bot.

Migration 12 lưu sơ đồ bất biến trong `tournament_brackets`, liên kết trực tiếp bản duyệt `tournament_qualifications`. Migration 13 bổ sung phiên chạy và hàng đợi ván loại trực tiếp. Hỗ trợ bot/luật vòng loại khi giữ luật, hoặc bot đã chốt trong đợt nộp lại chính thức. Nguồn được ghim vào phiên chạy; không đổi theo metadata bài nộp sau đó. Xem FINAL-INTAKE.md.

## Chạy đến kết thúc giải

Nhập ghi chú rồi bấm **Giữ bot/luật vòng loại và chạy toàn bộ**. Hệ thống ghim lại nguồn từ bản duyệt, xác nhận tài khoản còn hoạt động và lần lượt chạy các cặp đã đủ đội. Mỗi cặp chơi đủ số ván chính cấu hình; đổi bên luân phiên, các cặp ván liên tiếp dùng cùng mã khởi tạo. Điểm ván: thắng 1, hòa 0,5, thua 0. Nếu bằng tổng điểm, tạo từng cặp hai ván phụ đổi bên/cùng mã; hết số cặp phụ mà vẫn hòa thì hạt giống cao hơn đi tiếp. Không tự cộng trận cho suất miễn đấu.

Máy chấm có một lượt chạy đồng thời, thời hạn giữ việc 30 giây, gia hạn 5 giây, thử lại tối đa 3 lần khi hạ tầng lỗi rồi dừng ván để admin xử lý. Lỗi hạ tầng không tính thua bot. Sau khi xử lý, nhập lý do và bấm chạy lại trên ván bị chặn. Kết quả đến muộn không ghi đè ván đã lưu. Khởi động lại sẽ thu hồi việc hết hạn và tổng hợp các ván đã lưu.

Đội thắng tự đi vào cặp ở vòng sau. Khi chung kết xong, kết quả còn tạm thời; admin kiểm tra bản xem lại, nhập lý do rồi bấm **Duyệt kết quả và kết thúc giải**. Thí sinh thuộc giải thấy đội vô địch và trạng thái đã duyệt. Đây chưa phải website kết quả công khai cho khách không đăng nhập hoặc gói xuất đồng bộ offline.

API admin: `POST /api/admin/tournaments/:id/bracket/start` với `expectedRevision`, `reason`, `rulesPolicy: "keep_qualifier"`; `POST .../publish` với `expectedRevision`, `reason`; `GET /api/admin/bracket-games/:id` để xem trận; `POST .../:id/retry` với lý do. Mọi thao tác ghi yêu cầu admin và CSRF. Khi đọc sơ đồ, trường `games` cho biết các ván, trạng thái cặp gồm `queued`/`finished`, `champion` và `publishedAt` cho biết đội vô địch và thời điểm duyệt. Nguồn bot/luật nội bộ không được trả qua API.

## Kiểm chứng

### Điều khiển từng cặp hoặc từng vòng

Trước khi bắt đầu, chọn **Khởi tạo chế độ chạy từng cặp/vòng** thay cho nút chạy toàn bộ. Chế độ cố định cho phiên chạy; mặc định API cũ vẫn chạy tự động. Bot và luật được ghim như chế độ tự động nhưng chưa tạo ván chấm cho đến khi admin ra lệnh.

Trên sơ đồ, bấm **Chạy cặp này** khi đã đủ hai đội. Hoặc bấm **Chạy các cặp còn lại của vòng**: các vòng trước phải hoàn tất và chính vòng đó không có cặp đang chạy; chỉ những cặp sẵn sàng chưa chạy được thêm vào hàng đợi. Đội miễn đấu vẫn tự đi tiếp. Cặp đã được chọn tự chạy đủ ván chính và các ván phụ cần thiết, nhưng không tự khởi chạy cặp khác/vòng sau. Khởi động lại giữ nguyên chế độ và các cặp đã được cấp lệnh; không tự chuyển thành chạy toàn giải.

API `POST .../bracket/start` nhận thêm `mode: "manual"` hoặc `"auto"`. API `POST /api/admin/tournaments/:id/bracket/schedule` nhận `expectedRevision` **của phiên chạy loại trực tiếp** (khác phiên bản giải), `reason` và đúng một trong `matchId` hoặc `round`. Phải là admin, có CSRF; lệnh cũ, trùng hoặc cặp chưa đủ đội bị chặn. Ghi nhật ký và cấp việc trong cùng giao dịch. Trận đã chạy không được chấm trùng khi yêu cầu chạy phần còn lại của vòng.

`test/brackets.test.js`: sơ đồ 2/3/5/8/16/150/256 đội, hạt giống, miễn đấu, đường đi, dữ liệu không hợp lệ, tạo trùng, phiên bản cũ, nhật ký, giới hạn truy cập dữ liệu nội bộ và đọc lại từ SQLite. Mô phỏng đội thắng để kiểm tra nhánh không phải chạy trận bot thật. Kiểm thử API kiểm tra đăng nhập, quyền, CSRF và thành viên giải.

## Tạm dừng, tiếp tục và hủy loại trực tiếp

Admin nhập **Lý do thao tác loại trực tiếp** rồi chọn nút tương ứng. Các thao tác chỉ áp dụng cho phiên loại trực tiếp đã khởi tạo, cả chế độ tự chạy và từng cặp/vòng.

- **Tạm dừng loại trực tiếp:** ngừng cấp ván mới ngay; ván đã được máy chấm nhận vẫn hoàn tất và giữ bản xem lại. Chưa ghép/chạy các ván phụ hoặc vòng sau cho đến khi tiếp tục.
- **Tiếp tục loại trực tiếp:** xử lý các kết quả đã lưu rồi tiếp tục hàng đợi. Chế độ từng cặp/vòng vẫn giữ các cặp đã được cho phép, không chuyển sang tự chạy toàn giải.
- **Hủy thi đấu loại trực tiếp:** phải tạm dừng trước và chờ không còn ván đang chạy. Giải chuyển sang đã hủy, không thể tiếp tục, khởi tạo lại hoặc duyệt vô địch. Giữ dữ liệu, kết quả đã có và lý do để đối chiếu.

API admin có CSRF: POST .../bracket/pause, /resume, /cancel; nhận expectedRevision của **phiên loại trực tiếp** và reason 1–1000 ký tự. Lệnh cũ, thao tác sai trạng thái hoặc trên phiên đã xong bị chặn. Trạng thái điều khiển lưu trong state_json, không đổi luật/nguồn bot bất biến. Sau khi khởi động lại vẫn giữ tạm dừng/hủy. Hàng đợi và cơ chế phục hồi lỗi hạ tầng vẫn giữ nguyên.

Chức năng này chưa áp dụng cho vòng loại tính điểm hoặc cửa sổ nhận bài; không coi là nút hủy tổng quát ở mọi giai đoạn.
