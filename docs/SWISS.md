# Vòng loại Swiss theo điểm

## Phạm vi

Swiss là luồng giải mới, độc lập với Elo/vòng tròn cũ. Bắt đầu sau khi đã chốt bot vòng loại, sử dụng đúng snapshot bot, luật và image của giai đoạn đó. Không lấy lại active bot hoặc cấu hình mới từ bài nộp khi chạy trận.

Hiện hỗ trợ 2–256 bot đã chốt, phục vụ mục tiêu thực tế dưới 150 đội. Số vòng cấu hình từ trước và phải nhỏ hơn số bot thực đủ điều kiện, không chỉ sức chứa. Bắt đầu tạo vòng đầu; admin tạo từng vòng tiếp khi vòng hiện tại đã hoàn tất. Chưa có bracket, chọn top được duyệt hoặc công bố chính thức.

## Điểm và tie-break

- Một cặp đấu số ván chẵn đã cấu hình, mặc định 2, đổi bên. Hai ván liên tiếp dùng cùng seed bàn.
- Điểm từng ván: thắng 1, hòa 0,5, thua 0. Chỉ tổng kết cặp sau khi đủ toàn bộ ván hợp lệ.
- Điểm Swiss cho kết quả cả cặp: thắng 1, hòa 0,5, thua 0.
- Bye được 1 điểm Swiss, không cộng điểm ván, không tạo trận hoặc replay giả. Chọn đội điểm thấp chưa có bye theo thứ tự hạt giống cuối; nếu lịch còn lại không khả thi thì thử ứng viên bye tiếp theo.
- Thứ hạng: điểm Swiss → Buchholz → Sonneborn-Berger → điểm ván → thứ tự hash từ seed và ID đội. Không dùng Elo hoặc thứ tự nhận kết quả từ worker.
- Buchholz cộng điểm Swiss hiện có/cuối cùng của các đối thủ thực đã gặp. Sonneborn-Berger cộng điểm đối thủ nhân kết quả cặp (1/0,5/0). Bye không có đối thủ ảo: đóng góp 0 cho cả hai chỉ số.
- Nội bộ dùng đơn vị nửa điểm và một phần tư điểm nguyên; chỉ đổi sang số thập phân khi trả dữ liệu. Bảng trong lúc giải đang chạy là điểm tạm tính, gồm các cặp đã hoàn tất.

Đây là thể thức Swiss cho bot của OTTv2, không tuyên bố tuân thủ thuật toán Swiss FIDE.

## Ghép cặp

Vòng đầu dùng thứ tự hash từ seed. Các vòng sau ghép theo bảng điểm hiện tại, ưu tiên đối thủ gần điểm và gần hạng, không gặp lại. Thuật toán tìm ngược khi một lựa chọn tạo bế tắc, không chỉ ghép tham lam. Bye không lặp trong phạm vi số vòng được chấp nhận.

Đây là tìm một lịch hợp lệ có ưu tiên gần điểm, không phải bảo đảm nghiệm có tổng độ lệch điểm nhỏ nhất toàn cục. Tìm kiếm được giới hạn 20.000 nút và 5.000.000 kiểm tra cạnh để tránh chặn server quá lâu. Không có lịch hoặc đạt giới hạn thì trả 409, rollback toàn bộ vòng mới và báo BTC; không tự nới ràng buộc để tái đấu hoặc cấp bye lần nữa. Thuật toán không bảo đảm mọi lựa chọn ở vòng trước luôn cho phép lập đủ mọi vòng còn lại; nếu bị bế tắc cần quyết định thể lệ/cách xử lý của BTC, chưa có chức năng sửa lịch thủ công.

Seed, lịch cặp và seed từng ván được lưu trước khi chạy. Cùng dữ liệu đầu vào và seed cho cùng lịch; CPU hoặc random riêng của bot không được bảo đảm tái lập từng byte.

## Vận hành

1. Admin mở **Giải đấu**, chọn giải đã chốt bot. Phần **Vòng loại Swiss** cho biết số bot, số vòng và tổng số ván dự kiến.
2. Kiểm tra số vòng nhỏ hơn số bot thực tế. Có thể nhập seed trước khi bắt đầu; để trống thì server tạo và lưu.
3. Bấm **Bắt đầu Swiss**. Worker xử lý từng ván, admin theo dõi bảng điểm và mở replay/trực tiếp bằng **Xem trận**.
4. Nếu có ván blocked, sửa hạ tầng, nhập lý do trong ô thao tác của giải rồi bấm **Chạy lại** ở ván đó. Không dùng retry cho ván đã hoàn tất.
5. Khi vòng hiện tại xong, bấm **Tạo vòng Swiss tiếp**. Nút bị khóa khi còn queued/running/blocked; backend cũng kiểm tra lại revision và trạng thái.
6. Sau đủ số vòng, Swiss chuyển finished, giải chuyển provisional. Tải CSV để kiểm tra; kết quả vẫn chưa là quyết định chọn top/bracket hoặc công bố chính thức.

Thí sinh mở **Bảng xếp hạng**, chọn giải trong phần **Điểm Swiss của giải**. Chỉ thành viên giải được đọc bảng này; portal không trả danh sách job hoặc replay nội bộ. Phần Elo ngoài giải hiển thị riêng.

## Worker và phục hồi

Swiss có một slot riêng trong tiến trình Node.js, lease 30 giây, heartbeat 5 giây, tối đa 3 lần chạy tổng cộng khi hạ tầng lỗi. Bot crash, timeout hoặc đi sai luật được engine ghi thành thua ván; lỗi Docker/worker không xử thua bot.

Khi worker ngắt, lease hết hạn thì nhận lại công việc. Kết quả chỉ được lưu khi còn sở hữu lease; kết quả đến muộn không ghi đè. Lúc server khởi động, các ván đã lưu được tổng kết lại nếu quá trình trước ngắt giữa lưu replay và cộng điểm. Điểm được tính lại từ cặp hoàn tất, nên gọi tổng kết nhiều lần không cộng điểm trùng.

Server khởi động/dừng worker Swiss cùng các service khác. Slot Swiss cộng thêm vào tài nguyên đang dùng bởi pipeline, đấu thử và Elo cũ; điều phối ngân sách tài nguyên chung và worker phân tán vẫn thuộc TODO.

## API

Mọi thao tác ghi yêu cầu session admin và X-CSRF-Token.

| Phương thức | Đường dẫn | Nội dung |
| --- | --- | --- |
| GET | /api/admin/tournaments/:id/swiss | Tiến độ, preview, bảng điểm, vòng/cặp/ván |
| POST | /api/admin/tournaments/:id/swiss/start | expectedRevision của giải đã chốt; seed tùy chọn 1–100 ký tự |
| POST | /api/admin/tournaments/:id/swiss/next | expectedRevision của phiên Swiss gần nhất |
| GET | /api/admin/tournaments/:id/swiss/export | CSV điểm Swiss và tie-break |
| GET | /api/admin/swiss-games/:id | Replay hoặc trạng thái live của ván |
| POST | /api/admin/swiss-games/:id/retry | reason 1–500 ký tự, chỉ ván blocked |
| GET | /api/portal/tournaments/:id/swiss | Bảng điểm của giải mà thí sinh là thành viên, không trả job/cặp |

Migration 10 bổ sung bảng Swiss, không chuyển đổi hoặc ghi đè dữ liệu Elo cũ. Không cần dependency mới.

## Kiểm chứng

### Duyệt đội đi tiếp

Sau khi hoàn tất mọi lượt đấu, admin nhập số đội đi tiếp (mặc định theo cấu hình giải) và lý do tại **Chốt đội vào vòng loại trực tiếp**. Số đội phải từ 2 đến số đội đã chốt bot; hệ thống không tự giảm số đội khi thiếu. Danh sách lấy đúng thứ tự bảng điểm, không chọn thủ công hoặc tự bỏ qua đội bị khóa/xóa. Cần xử lý tài khoản đó trước khi duyệt.

`POST /api/admin/tournaments/:id/swiss/approve` nhận `expectedRevision` của giải, `swissRevision` của bảng điểm, `topN` và `reason` (1–1000 ký tự), yêu cầu admin và CSRF. Phản hồi bảng điểm có `qualification`: số đội, người/thời điểm duyệt và danh sách hạt giống. Thí sinh thuộc giải cũng xem được danh sách này; không nhận đường dẫn hoặc thông tin artifact nội bộ.

Migration 11 lưu một bản bất biến cho mỗi giải: bảng điểm đầy đủ, đội đi tiếp, bot đã chốt, luật, cấu hình và mã ghép lịch; lưu nhật ký và tăng phiên bản giải trong cùng giao dịch. Không có nút sửa hoặc duyệt lại sau khi chốt. Đây là duyệt đội đi tiếp, chưa tạo vòng loại trực tiếp hoặc công bố kết quả toàn giải.

- test/swiss.test.js: tính điểm/tie-break, bye, tái lập lịch, nhiều vòng với 3/5/16/149/150 đội; backtracking, giới hạn tìm kiếm; worker, retry, lease, điểm không trùng, phục hồi tổng kết và số đội thực.
- test/auth.test.js: quyền admin/thí sinh, CSRF, revision, giới hạn đọc theo giải và CSV.
- npm run test:stages: Docker thật Python/C++, luật tùy chỉnh 8 nước, đóng/chốt bài, Swiss đổi bên, dùng snapshot dù metadata bài nộp thay đổi, replay và bảng điểm còn nguyên khi mở lại DB.

Test thuật toán ghép 150 đội không thay cho load test upload, API, database hoặc chấm toàn bộ giải trên VPS. Xem [TODO](../TODO.md) và [phương án triển khai](DEPLOYMENT.md).

## Tạm dừng, tiếp tục và hủy vòng loại

Admin nhập lý do tại phần vòng loại tính điểm. **Tạm dừng vòng loại** ngừng cấp ván mới; ván đang chạy vẫn hoàn tất và lưu bản xem lại. Điểm cặp/lượt được tổng hợp khi tiếp tục, không xử thua vì tạm dừng. Không tạo lượt mới hoặc chạy lại ván lỗi khi đang dừng.

**Tiếp tục vòng loại** tổng hợp các ván đã xong rồi tiếp tục hàng đợi, giữ luật, bot và lịch cũ. Khởi động lại server vẫn giữ trạng thái tạm dừng.

**Hủy thi đấu vòng loại** chỉ được dùng sau khi tạm dừng và không còn ván đang chạy. Giải chuyển sang đã hủy, giữ lịch sử và bản xem lại, không thể tiếp tục, tạo lượt mới hoặc duyệt đội đi tiếp. Chưa hỗ trợ hủy giải ở giai đoạn chuẩn bị hoặc nhận bài.

API admin: POST /api/admin/tournaments/:id/swiss/pause, /resume, /cancel, có CSRF; nhận expectedRevision của phiên vòng loại và reason 1–1000 ký tự. Migration 16 lưu điều khiển trong swiss_controls; mỗi thao tác tăng phiên bản phiên/giải và ghi người, thời gian, lý do trong nhật ký.
