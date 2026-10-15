# Bộ luật có phiên bản và đấu thử

## Dành cho admin

1. Đăng nhập `/admin`, tìm **Quản lý bộ luật**.
2. Bấm **Tạo bộ luật mới** để lấy cấu hình Classic làm mẫu. Đặt tên dễ nhận biết. Ví dụ, đổi `maxMoves` từ 500 thành 100 để giới hạn trận ở 100 nước tổng cộng.
3. Bấm **Lưu bộ luật**. Máy chủ kiểm tra cấu hình rồi cấp ID và phiên bản. JSON sai sẽ được báo lỗi, không lưu một phần.
4. Chọn bộ luật hiện có để sửa. Mỗi lần lưu tạo phiên bản kế tiếp. Phiên bản cũ giữ nguyên; đổi tên cũng không sửa tên trong cấu hình lịch sử. Chọn phiên bản cũ để xem lại cấu hình.
5. Trong **Đấu thử theo bộ luật**, chọn phiên bản cụ thể, hai bot và seed. Danh sách gồm bot mẫu và mọi bản nộp Accepted của thí sinh. Có thể chọn cùng một bot cho cả hai bên.
6. Bấm **Chạy trận thử**, rồi **Xem trận**. Replay hỗ trợ tự chạy và tải nhật ký. Trận thử không cộng điểm, không cập nhật Elo và không đổi bot active.

Trận lưu ID, phiên bản, toàn bộ JSON luật, seed và thông tin phiên bản bot. Sửa luật sau khi tạo trận không thay cấu hình của trận đó. Seed quyết định bố trí ban đầu; để chạy lại chính xác cần giữ cùng cấu hình, engine, phiên bản bot và môi trường chạy. Bot dùng nguồn ngẫu nhiên riêng không bảo đảm cho cùng kết quả khi chạy lại. Kiểm tra replay tái dựng trạng thái từ các nước đi đã lưu.

Hiện vòng Elo sử dụng Classic mặc định. Việc lưu luật không tự áp dụng luật đó vào vòng Elo. Bracket, chọn luật theo vòng, công bố luật và cửa sổ nộp lại bot thuộc phase 6, chưa có ở phase này.

## Các trường cấu hình của engine rps-grid-v1

| Trường | Ý nghĩa và điều kiện |
| --- | --- |
| `id`, `version`, `name` | Máy chủ cấp ID, tăng phiên bản và lấy tên từ ô tên bộ luật khi lưu. |
| `engine` | Tên module đã cài trên máy chủ; mặc định `rps-grid-v1`. |
| `boardSize` | Số hàng và cột, số nguyên 2–32. |
| `homes` | Hai ô nhà dạng `{row, col}`, trong bàn và khác nhau. Tọa độ bắt đầu từ 0. |
| `pieceTypes` | Danh sách quân mỗi bên, 1–128 quân; mã quân gồm 1–8 chữ hoa hoặc chữ số. |
| `randomExtraPiece` | Nếu `true`, dùng 10 quân R/P/S theo tỷ lệ 3–3–4, loại có 4 quân chọn theo seed và dùng chung cho hai bên. Muốn dùng đúng danh sách `pieceTypes`, đặt `false`. |
| `beats` | Với mỗi mã quân, xác định một mã quân mà nó ăn được; ví dụ `{"R":"S","S":"P","P":"R"}`. |
| `directions` | Các bước dịch `[hàng, cột]`, mỗi thành phần từ -1 đến 1, không dùng `[0,0]`, tối đa 8 hướng. |
| `startingPositions` | Hai danh sách tọa độ, mỗi danh sách có đúng số vị trí bằng số quân. Tất cả vị trí phải trong bàn, không trùng nhau và không trùng ô nhà. Quân được xáo trộn theo seed. |
| `maxMoves` | Giới hạn số nước tổng cộng, số nguyên 1–5000. |
| `repetitionLimit` | Số lần lặp cùng bàn cờ và bên đến lượt để hòa, từ 2–10. |
| `noLegalMoves` | Hiện hỗ trợ `loss`: bên không còn nước hợp lệ bị thua. |

Với engine này, luật thắng vẫn là chiếm nhà, ăn hết quân hoặc đối thủ hết nước hợp lệ; luật thắng được xét trước giới hạn hòa. Thay cơ chế thắng hoặc cách di chuyển vượt ngoài các trường trên cần module engine mới.

## Dành cho người phát triển

`src/game/registry.js` là nơi đăng ký các engine tin cậy. Module cung cấp adapter gồm `validate(rules)` và `create({seed, rules})`, đăng ký bằng `registerEngine('ten-engine-v1', adapter)` khi khởi động máy chủ, trước khi xử lý trận. JSON chỉ chọn tên đã đăng ký; JSON không tải file hay thực thi mã. Admin trên web không có quyền tải module JavaScript lên máy chủ.

Engine trả về cần có `rules`, `seed`, `snapshot()`, `legalMoves()`, `apply(move)` và `finish(winner, reason)`. Với vòng chạy trận hiện tại, snapshot cần giữ các trường chung `status`, `currentTurn`, `moveCount`, `winner`, `winReason`; nước đi dùng bốn tọa độ `fromRow`, `fromCol`, `toRow`, `toCol`. Engine có thể thêm trường vào snapshot; toàn bộ snapshot được gửi qua `state`. Giao diện bàn cờ hiện hiển thị lưới và các quân Búa/Bao/Kéo; module dùng mô hình khác cần bổ sung trình hiển thị tương ứng.

`runMatch` và `verifyReplay` tạo engine qua registry. Giao thức bot vẫn là phiên bản 1: request mang toàn bộ `rules`, `state`, `legal_moves` và giới hạn chạy. Bot nên đọc các trường này thay vì hard-code bàn 9×9 hoặc 500 nước; bỏ qua trường chưa biết. Xem [PROTOCOL.md](PROTOCOL.md).

SQLite lưu danh mục tại `rule_sets`, các cấu hình bất biến tại `rule_versions`. Sửa/xóa trực tiếp bản cấu hình bị trigger từ chối. Trận thử chốt cấu hình và thông tin bot ngay khi tạo. Artifact của bài nộp được dùng lại nhưng không bị xóa khi dọn container trận thử.

## Kiểm thử

- `npm test`: unit/API, kiểm tra quyền admin và CSRF, lưu phiên bản, cấu hình sai, xung đột phiên bản, snapshot trận, module engine và replay.
- `npm run test:rules`: cần Docker và image sandbox. Nộp Python/C++ qua pipeline thật, chạy sample–sample, student–sample, student–student với luật giới hạn 8 nước; kiểm tra replay, bot active và bảng điểm không thay đổi.

Các bài kiểm thử tự tạo DB/thư mục riêng, không dùng dữ liệu giải thật.
