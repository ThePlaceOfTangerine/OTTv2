# Quản lý giải đấu

Hướng dẫn dành cho ban tổ chức: [Quy tắc và cách tổ chức giải đấu](QUY-TAC-GIAI-DAU.md). Trên giao diện, vào **Giải đấu → Đọc hướng dẫn** để xem bản trình bày có mục lục, bảng cấu hình và 11 bước thao tác.

## Phạm vi hiện có

Trang quản trị có mục **Giải đấu** để tạo giải nháp, chỉnh cấu hình, chọn phiên bản luật và quản lý danh sách tài khoản đội. Mỗi giải có mã riêng và lịch sử thao tác riêng. Một tài khoản có thể được thêm vào nhiều giải; gỡ khỏi danh sách một giải không xóa tài khoản hoặc danh sách giải khác.

Giải mới mặc định dùng vòng loại tính điểm, sức chứa 150 đội, 8 lượt đấu, 2 ván/cặp, chọn 16 đội, 5 ván mỗi cặp loại trực tiếp và tối đa 3 cặp phụ khi hòa rồi xét hạt giống. Đã có mở/đóng nhận bài, chốt bot, chạy vòng loại, bảng điểm, bản xem lại, CSV và duyệt đội đi tiếp; đã có chạy loại trực tiếp và duyệt kết quả trong giải (giữ bot/luật vòng loại). Mục Vòng điểm và bài luyện tập ngoài giải vẫn là luồng cũ riêng. Xem [cách chạy vòng loại](SWISS.md).

Đã có tạo và xem [sơ đồ vòng loại trực tiếp](BRACKETS.md) từ danh sách đã duyệt, gồm nhánh đấu và suất miễn đấu. Có chạy toàn bộ đến chung kết và duyệt đội vô địch; chưa có cửa sổ đổi luật/nộp lại hoặc website kết quả công khai.

Đã có [chọn/chốt phiên bản luật chính thức](FINAL-RULES.md). Đã có [công bố và nhận bài nộp lại](FINAL-INTAKE.md) theo luật chính thức, nhưng chưa chốt bot mới; nếu muốn chạy ngay, giữ luật vòng loại và không mở đợt nộp lại.

Không cần cài thêm dependency. Migration 8–15 tự bổ sung các bảng khi ứng dụng mở database. Sao lưu dữ liệu đang dùng trước khi cập nhật theo hướng dẫn README.

## Thao tác

1. Khởi động server, đăng nhập admin và mở **Giải đấu**.
2. Đặt tên, kiểm tra cấu hình và phiên bản luật rồi bấm **Tạo giải**. Với giải thử 16 đội, có thể đặt sức chứa 16, Swiss 4 vòng, top 8 hoặc 16.
3. Chọn tài khoản đội và bấm **Lưu danh sách đội**. Tài khoản bị khóa, đã xóa hoặc admin không được thêm vào giải. Chưa cần bot Accepted để đăng ký trong giai đoạn chuẩn bị.
4. Chọn lại giải để sửa hoặc xem lịch sử. Bấm **Tải lại dữ liệu** để lấy thay đổi mới nhất từ máy chủ. Lưu thay đổi trước khi đổi giải/tải lại.
5. Lưu hạn đóng ở phần cấu hình, theo giờ Việt Nam. Để trống giờ mở để mở ngay; bấm **Mở nhận bài** khi danh sách đội đã sẵn sàng. Danh sách và luật được sao chụp cố định cho giai đoạn vòng loại.
6. Thí sinh vào **Bot của tôi**, chọn đúng giải ở **Nơi nộp bài**, nộp file và giữ mã biên nhận. Chỉ đội đã đăng ký được nộp; bài được kiểm tra theo đúng luật của giai đoạn.
7. Hết hạn, backend ngừng nhận và chọn bot mới, kể cả khi giao diện chưa cập nhật hoặc server vừa khởi động lại. Có thể đóng sớm với lý do; bài đã nhận tiếp tục được kiểm tra.
8. Bấm **Tải lại dữ liệu**, xử lý hết bài lỗi hạ tầng rồi nhập lý do và bấm **Chốt bot vòng loại**. Cần ít nhất hai đội có bot hợp lệ. Snapshot hiển thị bản bot của từng đội; đội không có bản hợp lệ được ghi lý do không đủ điều kiện.

Chỉ giải ở trạng thái draft được sửa cấu hình/danh sách. Nếu hai admin cùng sửa, phiên bản cũ bị từ chối bằng 409; tải lại trước khi thao tác tiếp. Tải lại sẽ thay nội dung biểu mẫu bằng dữ liệu server.

## API quản trị

Mọi endpoint yêu cầu đăng nhập admin. POST, PATCH, PUT yêu cầu X-CSRF-Token.

| Phương thức | Đường dẫn | Nội dung |
| --- | --- | --- |
| GET | /api/admin/tournaments?page=0 | Danh sách 50 giải/trang và tổng số |
| POST | /api/admin/tournaments | Tạo giải từ name và cấu hình tùy chọn |
| GET | /api/admin/tournaments/:id | Cấu hình, đội và nhật ký riêng của giải |
| PATCH | /api/admin/tournaments/:id | Sửa các trường, bắt buộc expectedRevision |
| PUT | /api/admin/tournaments/:id/entrants | Thay danh sách đội, bắt buộc expectedRevision và userIds |
| POST | /api/admin/tournaments/:id/open | Mở vòng loại, expectedRevision; có thể truyền opensAt/closesAt thay lịch nháp |
| POST | /api/admin/tournaments/:id/close | Đóng sớm, expectedRevision và reason |
| POST | /api/admin/tournaments/:id/lock | Chốt bot sau hạn hoặc sau đóng sớm, expectedRevision và reason |

Ví dụ tạo giải nhỏ:

```json
{
  "name": "Thi thử LAN",
  "config": {"maxTeams": 16, "swissRounds": 4, "topN": 8}
}
```

Cấu hình chấp nhận format=swiss, maxTeams 2–4000, swissRounds 1–20 nhỏ hơn sức chứa, gamesPerPair chẵn 2–20, topN 2–maxTeams, bestOf lẻ 1–19, extraPairs 1–10. Cấu hình tối đa 4.000 chỉ để cho phép thử mở rộng, không bảo đảm năng lực xử lý. Khi bắt đầu thi đấu, bước triển khai sau phải kiểm tra số đội thực tế và khả năng ghép đủ vòng không tái đấu.

ruleSetId/ruleSetVersion chọn chính xác phiên bản luật đã lưu; nếu bỏ trống khi tạo thì dùng Classic mặc định. Đổi bộ luật cần gửi cả hai trường. opensAt/closesAt lưu Unix timestamp mili giây hoặc null trong giải nháp; khi mở cần hạn đóng trong tương lai. Thời gian được kiểm tra tại backend sau khi file đã được ghi và đồng bộ; không xét thời điểm bắt đầu upload.

PUT entrants nhận toàn bộ danh sách mong muốn và thực hiện nguyên tử. Dùng userIds=[] để gỡ tất cả đội khỏi giải nháp. Không nhận ID trùng, đội vượt sức chứa hay tài khoản không đủ điều kiện. Cả cấu hình và danh sách dùng chung revision để tránh ghi đè; mọi lần lưu thành công tăng revision và ghi sự kiện với admin thực hiện.

## API thí sinh và chính sách chốt

| Phương thức | Đường dẫn | Nội dung |
| --- | --- | --- |
| GET | /api/portal/tournaments | Giai đoạn mà tài khoản có quyền tham gia, kèm serverNow |
| GET | /api/portal/stages/:stageId/submissions | Chỉ bài của chính mình ở giai đoạn và snapshot đã chốt của mình |
| POST | /api/portal/stages/:stageId/submissions | Multipart bot, entry tùy chọn; session và CSRF bắt buộc |

Có thể gửi header Idempotency-Key (16–100 ký tự chữ/số/_/-). Cùng khóa, đội và giai đoạn, cùng nội dung/tên file/entry trả lại cùng biên nhận, kể cả đã hết hạn; đổi nội dung với khóa cũ bị từ chối 409. Giao diện giữ khóa để retry một upload chưa nhận được phản hồi thành công; đóng trang sẽ mất khóa phía trình duyệt nhưng bài đã nhận vẫn nằm trong lịch sử. Đây không phải bảo đảm chống trùng cho mọi thao tác nộp file mới.

API chi tiết, replay, activate và retry dùng đường dẫn bài nộp hiện tại; activate tự phân biệt bài thuộc giai đoạn và bài luyện tập. Bài giai đoạn không cập nhật active_bots của luồng Elo cũ. Chỉ chọn Accepted trong cùng giai đoạn, trong cửa sổ đang mở. Chọn thủ công được ưu tiên; nếu chưa chọn, dùng bản Accepted mới nhất. Bản mới Rejected không thay thế bản hợp lệ trước đó. Retry bài lỗi hạ tầng sau hạn không tạo biên nhận mới và không đổi thời điểm nhận.

Chốt bị từ chối nếu còn queued/running/blocked, dù đó là bản không được chọn. Khi chốt thành công, lưu submission ID, version, source hash, image, ngôn ngữ, entry và luật của mỗi bot. Snapshot và các dòng đội của giai đoạn đã chốt được bảo vệ khỏi sửa/xóa ở database. Thay active, khóa tài khoản hoặc nộp luyện tập sau đó không sửa snapshot. Lỗi biên dịch/bot không hợp lệ loại bài; thiếu bot của một đội ghi no_accepted_submission, tài khoản bị khóa/xóa ghi account_ineligible.

Hết giờ được suy ra từ đồng hồ server khi đọc/nhận bài/chốt, không cần browser hoặc timer nền hoạt động. Bản ghi nội bộ có thể vẫn mang trạng thái open cho đến thao tác đóng/chốt nhưng API trả effective status closing và không nhận bài nữa. Chưa hỗ trợ mở lại cửa sổ, hủy lịch tương lai, nộp lại vòng bracket hoặc mang bot cũ sang luật mới; các mục này vẫn theo dõi trong TODO.

Ghi file được sync trước khi chấp nhận bài. Phục hồi sau mất toàn bộ máy/đĩa vẫn cần quy trình backup riêng; không coi đây là bảo đảm không mất dữ liệu khi phần cứng hỏng.

## Kiểm chứng

`npm test` chạy cả test/tournaments.test.js và kiểm thử phân quyền/CSRF API trong test/auth.test.js. Các trường hợp gồm cấu hình sai, danh sách đội không hợp lệ, rollback nguyên tử, sức chứa, sửa đồng thời, đóng băng chỉnh sửa ngoài draft, luật có phiên bản, nâng cấp schema 7 và lưu/đọc lại database.

test/tournament-stages.test.js kiểm tra hạn trong lúc ghi file, retry biên nhận sau hạn, pipeline theo luật, fallback, lựa chọn thủ công, snapshot và chặn chốt khi hạ tầng lỗi. `npm run test:stages` chạy Docker thật với Python/C++ theo luật tùy chỉnh 8 nước, đóng trước khi xử lý hàng đợi rồi chốt artifact. Các bộ Docker chạy tuần tự.

Yêu cầu đầy đủ và các mặc định thể lệ đang đề xuất: [TOURNAMENT-REQUIREMENTS.md](TOURNAMENT-REQUIREMENTS.md). Tiến trình: [TODO.md](../TODO.md).

## Hủy giải trước thi đấu

Khi giải đang chuẩn bị, nhận bài hoặc đã đóng nhưng chưa chốt bot, admin nhập lý do và bấm **Hủy giải trước thi đấu**. Thao tác cần đúng phiên bản dữ liệu và lưu nhật ký. Giải đã hủy không thể mở lại, sửa danh sách, nhận bài mới hoặc chốt bot; lịch sử và bài đã nhận vẫn giữ. Bài đã nhận tiếp tục được kiểm tra để giữ biên nhận/kết quả kiểm tra, không được dùng thi đấu trong giải đã hủy. Giải đã chốt bot hoặc đang thi đấu không dùng nút này; dùng điều khiển riêng của giai đoạn đang chạy. API: POST /api/admin/tournaments/:id/cancel, admin + CSRF, expectedRevision của giải và reason 1–500 ký tự.
