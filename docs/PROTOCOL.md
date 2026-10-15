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

Ví dụ trên rút gọn `rules` và `board`. Request thật chứa **toàn bộ RuleSet**, board là ma trận `boardSize × boardSize`. Ô trống là `null`, quân là `{"player":0,"type":"R"}`. Request chứa đầy đủ các nước hợp lệ của bên đến lượt. Bot có thể chọn từ `legal_moves` hoặc tự tính nhưng engine luôn kiểm tra lại.

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
