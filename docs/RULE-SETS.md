# Bộ luật có phiên bản và đấu thử

## Dành cho admin

1. Đăng nhập `/admin`, mở **Bộ luật → Thiết kế bàn cờ**.
2. Bấm **Tạo luật mới**, đặt tên. Chọn hình dạng là bàn cờ đổi ngay; nhập xong số hàng/cột rồi chuyển sang ô khác để áp dụng kích thước. Khi đổi bản đồ, nhà và vị trí quân được sắp lại cho vừa bàn. Dùng sáu công cụ Ô cờ, Ô chặn, Nhà A/B, Quân A/B để sửa trực tiếp; bấm lại để bỏ ô/quân, riêng nhà chỉ chuyển vị trí. **Số quân chung cho hai bên** áp dụng cùng số Búa/Bao/Kéo cho A và B. Tự đặt đủ vị trí theo bộ đếm trước khi lưu. Chọn hướng chung hoặc kiểu đi riêng từng loại quân. Có thể bật 1–3 power-up ngẫu nhiên mỗi trận. Quân nhặt được có dấu + và ăn thêm được quân cùng loại, vẫn bị loại khắc chế ăn; hiệu lực giữ đến khi bị ăn. Búa ăn Kéo, Kéo ăn Bao, Bao ăn Búa vẫn giữ nguyên.
3. Bấm **Lưu bộ luật**. Máy chủ kiểm tra cấu hình rồi cấp ID và phiên bản. JSON sai sẽ được báo lỗi, không lưu một phần.
4. Chọn bộ luật hiện có để sửa. Mỗi lần lưu tạo phiên bản kế tiếp. Phiên bản cũ giữ nguyên; đổi tên cũng không sửa tên trong cấu hình lịch sử. Chọn phiên bản cũ để xem lại cấu hình.
5. Trong **Đấu thử**, chọn phiên bản luật. Ở mỗi bên A/B, bấm **Chọn thí sinh / bot**, tìm tài khoản hoặc mã thí sinh, chọn thẻ thí sinh rồi phiên bản bot. Bản đang dùng được ưu tiên; vẫn có thể chọn bản hợp lệ cũ. Thí sinh bị khóa hoặc chưa có bot hợp lệ không chọn được. Tab **Bot mẫu** có bot Python/C++ để thử nhanh. Có thể chọn cùng bot cho hai bên.
6. Bấm **Chạy trận thử**, rồi **Xem trận**. Replay hỗ trợ tự chạy và tải nhật ký. Trận thử không cộng điểm, không cập nhật Elo và không đổi bot active.

Thanh công cụ có 6 nút: **Ô cờ**, **Ô chặn**, **Nhà A**, **Nhà B**, **Quân A**, **Quân B**. Ô cờ, ô chặn và quân hoạt động bật/tắt: bấm ô cùng loại lần nữa để xóa. Xóa ô cờ cũng bỏ quân hoặc ô chặn trên ô đó. Nhà A/B chỉ di chuyển bằng cách bấm ô mới, không xóa nhà. Quân mỗi bên không được thêm quá số lượng đã đặt; khi đủ, vẫn có thể bấm quân cùng bên để bỏ rồi đặt lại.

Trận lưu ID, phiên bản, toàn bộ JSON luật, seed và thông tin phiên bản bot. Sửa luật sau khi tạo trận không thay cấu hình của trận đó. Seed quyết định bố trí ban đầu; để chạy lại chính xác cần giữ cùng cấu hình, engine, phiên bản bot và môi trường chạy. Bot dùng nguồn ngẫu nhiên riêng không bảo đảm cho cùng kết quả khi chạy lại. Kiểm tra replay tái dựng trạng thái từ các nước đi đã lưu.

Hiện vòng Elo sử dụng Classic mặc định. Việc lưu luật không tự áp dụng luật đó vào vòng Elo. Bracket, chọn luật theo vòng, công bố luật và cửa sổ nộp lại bot thuộc phase 6, chưa có ở phase này.

## Các trường cấu hình của engine rps-grid-v1

| Trường | Ý nghĩa và điều kiện |
| --- | --- |
| `id`, `version`, `name` | Máy chủ cấp ID, tăng phiên bản và lấy tên từ ô tên bộ luật khi lưu. |
| `engine` | Tên module đã cài trên máy chủ; mặc định `rps-grid-v1`. |
| `boardSize` | Số hàng và cột, số nguyên 2–32. |
| `boardRows`, `boardCols` | Số hàng và cột riêng, 2–32. Nếu không có thì dùng `boardSize`, giữ nguyên hành vi luật cũ. |
| `blockedCells`, `voidCells` | Mảng tọa độ `[row,col]`: ô chặn và ô ngoài bản đồ. Cả hai đều không thể đi vào; không được trùng nhau, trùng nhà hoặc vị trí quân. |
| `playerPieceTypes` | Hai danh sách quân riêng cho A/B, mỗi bên 1–128 quân, dùng khi `randomExtraPiece=false`. Nếu không có thì dùng chung `pieceTypes` như luật cũ. |
| `boardTheme` | Màu hiển thị `classic`, `forest`, `sand`, `slate`; không tác động luật thắng hoặc nước đi. |
| `homes` | Hai ô nhà dạng `{row, col}`, trong bàn và khác nhau. Tọa độ bắt đầu từ 0. |
| `pieceTypes` | Danh sách quân mỗi bên, 1–128 quân; mã quân gồm 1–8 chữ hoa hoặc chữ số. |
| `randomExtraPiece` | Nếu `true`, dùng 10 quân R/P/S theo tỷ lệ 3–3–4, loại có 4 quân chọn theo seed và dùng chung cho hai bên. Muốn dùng đúng danh sách `pieceTypes`, đặt `false`. |
| `beats` | Với mỗi mã quân, xác định một mã quân mà nó ăn được; ví dụ `{"R":"S","S":"P","P":"R"}`. |
| `directions` | Các bước dịch `[hàng, cột]`, mỗi thành phần từ -1 đến 1, không dùng `[0,0]`, tối đa 8 hướng. |
| `startingPositions` | Hai danh sách tọa độ, mỗi danh sách có đúng số vị trí bằng số quân. Tất cả vị trí phải trong bàn, không trùng nhau và không trùng ô nhà. Quân được xáo trộn theo seed. |
| `maxMoves` | Giới hạn số nước tổng cộng, số nguyên 1–5000. |
| `repetitionLimit` | Số lần lặp cùng bàn cờ và bên đến lượt để hòa, từ 2–10. |
| `noLegalMoves` | Hiện hỗ trợ `loss`: bên không còn nước hợp lệ bị thua. |

Với engine này, luật thắng vẫn là chiếm nhà, ăn hết quân hoặc đối thủ hết nước hợp lệ; luật thắng được xét trước giới hạn hòa. Thay cơ chế thắng cần module engine mới.

## Dành cho người phát triển

`src/game/registry.js` là nơi đăng ký các engine tin cậy. Module cung cấp adapter gồm `validate(rules)` và `create({seed, rules})`, đăng ký bằng `registerEngine('ten-engine-v1', adapter)` khi khởi động máy chủ, trước khi xử lý trận. JSON chỉ chọn tên đã đăng ký; JSON không tải file hay thực thi mã. Admin trên web không có quyền tải module JavaScript lên máy chủ.

Engine trả về cần có `rules`, `seed`, `snapshot()`, `legalMoves()`, `apply(move)` và `finish(winner, reason)`. Với vòng chạy trận hiện tại, snapshot cần giữ các trường chung `status`, `currentTurn`, `moveCount`, `winner`, `winReason`; nước đi dùng bốn tọa độ `fromRow`, `fromCol`, `toRow`, `toCol`. Engine có thể thêm trường vào snapshot; toàn bộ snapshot được gửi qua `state`. Giao diện bàn cờ hiện hiển thị lưới và các quân Búa/Bao/Kéo; module dùng mô hình khác cần bổ sung trình hiển thị tương ứng.

`runMatch` và `verifyReplay` tạo engine qua registry. Giao thức bot vẫn là phiên bản 1: request mang toàn bộ `rules`, `state`, `legal_moves` và giới hạn chạy. Bot nên đọc các trường này thay vì hard-code bàn 9×9 hoặc 500 nước; bỏ qua trường chưa biết. Xem [PROTOCOL.md](PROTOCOL.md).

SQLite lưu danh mục tại `rule_sets`, các cấu hình bất biến tại `rule_versions`. Sửa/xóa trực tiếp bản cấu hình bị trigger từ chối. Trận thử chốt cấu hình và thông tin bot ngay khi tạo. Artifact của bài nộp được dùng lại nhưng không bị xóa khi dọn container trận thử.

## Kiểm thử

- `npm test`: unit/API, kiểm tra quyền admin và CSRF, lưu phiên bản, cấu hình sai, xung đột phiên bản, snapshot trận, module engine và replay.
- `npm run test:rules`: cần Docker và image sandbox. Nộp Python/C++ qua pipeline thật, chạy sample–sample, student–sample, student–student với luật giới hạn 8 nước; kiểm tra replay, bot active và bảng điểm không thay đổi.

Các bài kiểm thử tự tạo DB/thư mục riêng, không dùng dữ liệu giải thật.

## Di chuyển riêng và power-up

- `symmetricArmies: true`: từ chối cấu hình hai bên khác số lượng từng loại quân. Trình chỉnh trực quan luôn dùng chung `pieceTypes`; luật cũ vẫn đọc được.
- `powerUps: true`: tạo ngẫu nhiên 1–3 vật phẩm ở ô trống, không đặt trên nhà, quân, ô chặn hay ô bỏ; nếu chỉ còn 1–2 ô hợp lệ thì số vật phẩm không vượt số ô. Vị trí tái hiện được bằng seed. Không sinh lại sau khi nhặt.
- `movementByType`: ví dụ `{"R":{"kind":"rook"},"P":{"kind":"knight"},"S":{"kind":"bishop"}}`. Các kiểu: `king`, `rook`, `bishop`, `queen`, `knight`, `pawn`, `custom`. Các kiểu này chỉ quy định di chuyển; ăn quân vẫn theo Búa/Bao/Kéo và power-up. Không có chiếu vua, nhập thành hay phong cấp.
- Tốt: A tiến xuống, B tiến lên; đi thẳng một ô trống, ăn chéo một ô; không đi hai ô hoặc bắt qua đường.
- Tự chỉnh: `{"kind":"custom","directions":[[-1,0],[0,1]],"maxSteps":3,"jump":false,"relative":true}`. Mỗi hướng là độ lệch hàng/cột, thành phần −8 đến 8, tối đa 48 hướng khác nhau; tầm 1–32 bước. `jump` chỉ giữ để đọc cấu hình cũ, không còn cho phép nhảy qua quân/địa hình. `relative` đảo hướng cho B. Không khai báo loại nào thì loại đó dùng `directions` chung.

Tính năng tùy chỉnh áp dụng ở **Đấu thử**. Vòng điểm chính thức vẫn dùng bộ luật Classic mặc định.

### Quân chặn đường nhau

Quân hai bên đều chặn đường nhau: không được đi xuyên hay nhảy qua quân phía trước, kể cả khi có power-up. Chỉ được ăn quân đối thủ ở ô đích nếu đúng luật. Mã đi chữ L bị cản ở ô sát quân theo chiều dài chữ L. Hướng tự chỉnh dài phải có các ô trung gian trống; ô chặn và ô ngoài bản đồ cũng cản đường. Replay trước engine phiên bản 2 giữ luật lịch sử.
