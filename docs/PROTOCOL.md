# OTTv2 Bot Protocol v1

Bot là chương trình C++17 hoặc Python 3, đọc **một JSON object trên một dòng** từ stdin, ghi **một JSON object trên một dòng** ra stdout, flush và thoát với mã 0. Stderr là log. Không in lời chào/debug lên stdout. Tọa độ từ 0, hàng tăng từ trên xuống, cột tăng từ trái sang phải; không đảo bàn theo bên chơi.

## Vòng đời

Compile và chạy bot hoàn toàn trong Docker Linux. Mỗi bên có container riêng cho mỗi trận; mỗi nước đi dùng tiến trình bot mới. Không giữ biến toàn cục giữa hai lượt. Muốn giữ trí nhớ, trả `userdata`: engine gửi lại giá trị đó cho chính bot ở lượt tiếp theo. Thư mục tạm nằm trong container và có giới hạn; không nên dựa vào việc file tạm tồn tại giữa các lượt. Container bị xóa sau trận, không dùng chung giữa hai bot hay giữa hai trận.

## Engine → bot

```json
{
  "protocol_version": 1,
  "request_id": "turn-0",
  "player_index": 0,
  "seed": "arena-2026",
  "rules": {"id":"ottv2-classic","version":2,"engine":"rps-grid-v1","boardSize":9,"randomExtraPiece":true},
  "state": {"board":[],"currentTurn":0,"moveCount":0,"status":"playing","winner":null,"winReason":null,"lastMove":null},
  "legal_moves": [{"fromRow":0,"fromCol":6,"toRow":0,"toCol":7}],
  "limits": {"moveCpuMs":500,"totalCpuMs":30000,"moveWallMs":3000,"matchWallMs":180000,"memoryMb":256,"outputBytes":65536,"userdataBytes":16384},
  "userdata": null
}
```

Ví dụ trên rút gọn `rules` và `board`. Request thật chứa **toàn bộ RuleSet**. Số hàng/cột lấy từ `state.board.length` và `state.board[0].length`; nếu có `boardRows`/`boardCols` thì chúng thay cho kích thước vuông `boardSize`. Ô trống là `null`, quân là `{"player":0,"type":"R"}`. `rules.blockedCells` và `rules.voidCells` cũng là ô `null` trên board nhưng không được đi vào. Trình chỉnh luật hiện dùng chung số lượng từng loại cho hai bên (`symmetricArmies=true`). `playerPieceTypes` trong luật lịch sử vẫn có thể chứa cơ cấu riêng từng bên; bot nên đọc quân thực tế từ board. Chọn từ `legal_moves` sẽ tự tuân theo địa hình, kích thước và hướng đi của bộ luật; engine luôn kiểm tra lại.

RuleSet có `homes`, `pieceTypes`, `beats`, `directions`, `startingPositions`, `maxMoves`, `repetitionLimit` và trường mở rộng trong tương lai. Không hardcode bàn 9×9 hay số quân nếu muốn thích nghi khi đổi luật. `state` và `rules` có thể thêm trường mà vẫn giữ protocol v1; bỏ qua trường không biết.

Luật Classic v2: mỗi bên 10 quân theo tỷ lệ 3–3–4; loại có 4 quân được chọn ngẫu nhiên theo seed và dùng chung cơ cấu cho hai bên, đi một ô theo tám hướng, chỉ ăn quân yếu hơn theo R>S>P>R. Thắng bằng chiếm nhà hoặc ăn hết quân; hết nước hợp lệ thì thua; lặp bàn cờ cùng bên đến lượt ba lần hoặc đạt 500 nước tổng cộng thì hòa. Điều kiện thắng được xét trước hòa.

## Bot → engine

```json
{"request_id":"turn-0","move":{"fromRow":0,"fromCol":6,"toRow":0,"toCol":7},"userdata":{"plan":"attack"}}
```

- `request_id` phải khớp request đang xử lý.
- Bốn tọa độ phải là số nguyên; `move` phải có trong danh sách nước hợp lệ.
- `userdata` tùy chọn, phải là JSON và tối đa 16 KiB; mặc định `null`.
- Chỉ một dòng JSON (newline cuối dòng được phép); in nhiều message, JSON lỗi, nước sai hoặc mã thoát khác 0 đều xử thua.
- Không có request khi ván kết thúc hoặc không còn nước hợp lệ.

## Giới hạn và lỗi

Mặc định mỗi nước: 500 ms CPU, 3 giây wall time, 256 MiB **không gian địa chỉ tiến trình**, 64 KiB tổng stdout+stderr. Mỗi bot tối đa 30 giây CPU/trận; toàn bộ vòng chạy nước đi tối đa 180 giây wall time. CPU gồm user+system của tiến trình bot, kể cả khởi động interpreter, đo từ `getrusage(RUSAGE_CHILDREN)`; theo dõi `/proc` để dừng sớm khi CPU vượt ngưỡng. CPU của supervisor/Docker không bị tính vào bot. Bot không được tạo tiến trình/thread; runner giám sát bên ngoài vẫn có PID quota và RAM riêng.

Mã lỗi bot: `bot_crash`, `cpu_timeout`, `total_cpu_timeout`, `wall_timeout`, `output_limit`, `invalid_output`, `userdata_limit`, `illegal_move`, `sandbox_violation`. Bot đó thua. Việc đọc file trái phép bị Landlock trả PermissionError/EACCES; nếu bot không xử lý được thì thành `bot_crash`. Mở mạng hoặc fork bị seccomp kết thúc tiến trình. Không bảo đảm phát hiện ý định truy cập đã được bot tự bắt lỗi; quyền truy cập vẫn bị từ chối.

Lỗi Docker, image, kernel, supervisor hoặc deadline tổng do hạ tầng được phân loại `infrastructure_error`, chạy lại cả trận với cùng seed tối đa hai lần bổ sung, không gán thắng/thua. Compile lỗi là `bot_error` trước khi trận bắt đầu; giữ lý do trong log, không tạo nước đi giả.

## C++ và Python

C++ compile bằng **g++ 12, `-O2 -std=c++17`**, link tất cả file `.cpp`, không nhận thêm flag từ bot. Header `nlohmann/json.hpp` có sẵn. Python dùng Python 3.11 của image với `-I -S -B`, không cài package do bot yêu cầu; module trong thư mục entry hoặc gốc source có thể import. Môi trường mạng bị tắt trong cả compile và runtime.

Image được chốt theo SHA-256 ID cho compile/runtime và lưu vào replay; sửa tag sau khi bắt đầu không đổi image trận đó. Phiên bản engine, RuleSet, seed và source hash cũng được lưu. Seed tái lập engine; để tái lập **hành vi bot**, bot phải quyết định tất định từ request/seed/userdata, không dùng đồng hồ hoặc random hệ thống. Thời gian CPU không tất định giữa các lần chạy nên chỉ so sánh nước đi/kết quả, không so sánh byte của log metrics.

Bot mẫu: `bots/python-greedy/main.py`, `bots/cpp-greedy/main.cpp`. Template: `bots/templates/python/main.py`, `bots/templates/cpp/main.cpp`.

Classic v2 đặt randomExtraPiece=true: engine lấy 3 quân mỗi loại R/P/S và thêm một quân được chọn từ R/P/S theo seed. pieceTypes trong RuleSet là pool cơ sở; đọc state.board để biết số quân thực tế của ván. RuleSet v1 không có cờ này vẫn dùng 3R+3P+4S, giúp replay lịch sử giữ nguyên.

Nộp qua GitHub: repo có `ott.json` ở gốc (`{"language":"python","entry":"main.py"}` hoặc `cpp`/`main.cpp`) và mã trong `bot/`; `entry` tính từ `bot/`, chỉ file mã nguồn trong `bot/` được chấm. Xem [GITHUB.md](GITHUB.md).

## Viết bot cho luật tùy chỉnh

Các giới hạn 9×9, 10 quân, một ô/tám hướng và 500 nước ở trên chỉ mô tả Classic. Đọc cấu hình của chính trận đang chơi. Hai ván kiểm tra bài nộp và vòng điểm hiện dùng Classic; luật tùy chỉnh được dùng trong Đấu thử do admin tạo.

| Dữ liệu | Cách dùng |
| --- | --- |
| `state.board` | Số hàng/cột thật lấy từ mảng; đếm quân hiện tại từ các phần tử khác null. |
| `rules.homes[1-player_index]` | Nhà đối thủ, không cố định tọa độ hoặc góc bàn. |
| `rules.blockedCells`, `rules.voidCells` | Các cặp `[row,col]` không được đi vào, dù board có thể là null. Thiếu trường thì dùng danh sách rỗng. |
| `state.powerUps` | Khi bật power-up, các cặp `[row,col]` còn vật phẩm; dùng danh sách rỗng nếu thiếu. |
| `piece.powered` | true nếu quân đã nhặt vật phẩm, mặc định false khi thiếu. |
| `rules.movementByType` | Cấu hình di chuyển theo mã R/P/S. Nếu loại đó không có cấu hình, dùng `rules.directions` chung. |
| `legal_moves` | Nguồn nước hợp lệ chính thức, đã xét địa hình, kiểu đi, quyền sở hữu, ăn quân và power-up. |

### Power-up

`rules.powerUps=true` tạo ngẫu nhiên từ 1 đến 3 vật phẩm lúc bắt đầu, không vượt số ô trống hợp lệ; không đặt trên nhà/quân/ô chặn/ô bỏ. Vị trí tái hiện bằng seed, không sinh lại sau khi nhặt. Đi vào ô có vật phẩm sẽ xóa vật phẩm và đặt `powered: true` trên quân. Hiệu lực giữ đến khi quân bị ăn, không cộng dồn.

Quân nâng cấp ăn được loại vốn yếu hơn **và cùng loại**, vẫn không được ăn loại khắc chế. Ví dụ Búa+ ăn Búa hoặc Kéo, vẫn bị Bao ăn. Quân cùng loại được nâng cấp hay chưa đều có thể bị quân nâng cấp tấn công. Không ăn quân cùng bên.

Snapshot luật cũ không có `powerUps`; quân thường không có `powered`. Python đọc bằng `.get('powerUps', [])` / `.get('powered', False)`; C++ dùng `.value("powerUps", json::array())` / `.value("powered", false)`.

### Loại ô và hiệu ứng (luật có `tileTypes`)

`state.tiles` liệt kê mọi ô đặc biệt: `[{"row":4,"col":3,"type":"shield","tags":["effect"]}]`, gồm cả ô chặn (`blocked`), ô ngoài bản đồ (`void`) và loại ô BTC tự đặt. Ý nghĩa từng loại nằm trong `rules.tileTypes[type]` (`passable`, `tags`, `effect`, `render`). Đi vào ô có `effect` thì quân nhận `piece.effect` (`wildcard`, `shield`, `dash`...) và ô biến mất; mỗi quân giữ một hiệu ứng, nhặt ô mới thì thay. Luật không có `tileTypes` thì không có `state.tiles`; đọc bằng `.get('tiles', [])` / `.value("tiles", json::array())`.

**Lưu ý: `legal_moves` không phải lúc nào cũng mô tả kết quả.** Nước ăn quân đối thủ có `effect: "shield"` vẫn nằm trong `legal_moves`, nhưng kết quả là khiên vỡ và quân của bạn đứng yên. Quân có `dash` sau khi ăn sẽ tự đi thêm 1 ô cùng hướng nếu được phép, không cần bot gửi thêm nước. Xem `state.lastMove.blocked` và `state.lastMove.bonus_step` để biết điều gì đã xảy ra ở lượt trước. Chi tiết luật hiệu ứng và `onMoveLimit` trong [RULE-SETS.md](RULE-SETS.md).

### Di chuyển theo từng loại

Ví dụ: `"movementByType":{"R":{"kind":"rook"},"P":{"kind":"knight"},"S":{"kind":"bishop"}}`.

- `king`: một ô theo tám hướng; `rook`: ngang/dọc; `bishop`: chéo; `queen`: ngang/dọc/chéo. Các tia dài dừng ở vật cản hoặc quân, không nhảy qua.
- `knight`: đi chữ L, bị cản chân ở ô sát quân theo chiều dài chữ L. Không nhảy qua quân hoặc vật cản.
- `pawn`: bên 0 tiến xuống, bên 1 tiến lên; đi thẳng một ô trống, ăn chéo một ô. Không đi hai ô, phong cấp, bắt qua đường.
- `custom`: ví dụ `{"kind":"custom","directions":[[0,1],[-1,0]],"maxSteps":3,"jump":false,"relative":true}`. Mỗi hướng có thành phần −8 đến 8, tối đa 48 hướng khác nhau, không `[0,0]`; tầm 1–32 bước. `relative=true` đảo hướng cho bên 1. Cờ `jump` trong luật cũ không còn cho phép nhảy. Chi tiết chặn đường xem RULE-SETS.md.

Đây chỉ là kiểu đi; không áp dụng chiếu vua hoặc nhập thành của cờ vua. Cách đơn giản và ít lỗi nhất là chấm điểm từng phần tử của `legal_moves`, không tự dựng lại bộ kiểm tra luật.

### Chiến thuật mẫu và kiểm tra bài

Bốn file mẫu dùng hàm `score`: chiếm nhà được 100000 điểm; ăn quân +40 (đánh quân có khiên chỉ +5 vì không ăn được); nhặt power-up hoặc ô hiệu ứng khi quân chưa có `powered`/`effect` +15; trừ khoảng cách tới nhà. Khoảng cách là gợi ý, chưa tính đường vòng hoặc số lượt thật với các kiểu đi mới. Hai nước cùng điểm thì giữ nước xuất hiện trước trong `legal_moves`.

Bot chỉ được gọi khi ván còn đang chơi và có nước hợp lệ. Giữ nguyên phần đọc/gửi JSON, chỉ sửa chiến thuật khi mới bắt đầu. Để kiểm tra luật tùy chỉnh, nhờ admin chạy Đấu thử và xem replay. File đã nộp là phiên bản cố định; muốn dùng mẫu cập nhật thì tải lại và nộp phiên bản mới.

### Quân chặn đường nhau

Quân hai bên đều chặn đường nhau: không được đi xuyên hay nhảy qua quân phía trước, kể cả khi có power-up. Chỉ được ăn quân đối thủ ở ô đích nếu đúng luật. Mã đi chữ L bị cản ở ô sát quân theo chiều dài chữ L. Hướng tự chỉnh dài phải có các ô trung gian trống; ô chặn và ô ngoài bản đồ cũng cản đường. Replay trước engine phiên bản 2 giữ luật lịch sử.
