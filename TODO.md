# Công việc cần làm cho OTTv2

Cập nhật lần đầu: 18/10/2026, giờ Việt Nam.

Mục tiêu: hoàn thiện nền tảng tổ chức giải bot từ chuẩn bị, nhận bài, chấm, chung kết LAN đến công bố và phục hồi sự cố; sau đó mở rộng theo số đo thực tế.

## Quy ước theo dõi

- `[x]`: đã hoàn thành trong phạm vi mô tả, có bằng chứng tương ứng.
- `[ ]`: chưa hoàn thành hoặc chưa đủ bằng chứng nghiệm thu.
- Ghi `Đang làm` hoặc `Bị chặn: lý do` ngay sau tên việc khi cần; giữ ô chưa đánh dấu.
- Sau mỗi đợt thay đổi, cập nhật checklist liên quan và nhật ký ở cuối file. Chỉ đánh dấu xong khi đạt tiêu chí nghiệm thu; không đánh dấu chỉ vì đã viết code.
- Nếu chỉ hoàn thành một phần, tách thành các mục con và chỉ đánh dấu phần đã xong. Nếu phát hiện lỗi làm mất điều kiện nghiệm thu, mở lại mục đó.
- Phân biệt tính năng đã có, kiểm thử đã chạy và khả năng vận hành ở quy mô thật. Không dùng kết quả unit test để kết luận đã chịu được 4.000 người.
- Không ghi mật khẩu, token, dữ liệu thí sinh thật hoặc nội dung bài nộp vào file này.
- P0: hoàn thiện giải cơ bản; P1: sẵn sàng vận hành; P2: mở rộng và đồng bộ; P3: tích hợp và phổ cập.

## Nền tảng hiện có

Các mục này ghi nhận chức năng đã có qua rà soát mã nguồn, không có nghĩa đã nghiệm thu cho triển khai Internet quy mô lớn.

- [x] Tài khoản, bcrypt, session, phân quyền admin/thí sinh và CSRF.
- [x] Import thí sinh bằng CSV, khóa tài khoản, reset và bắt buộc đổi mật khẩu thí sinh.
- [x] Nộp Python/C++/ZIP, kiểm tra đường dẫn và giới hạn giải nén.
- [x] Lịch sử phiên bản, chọn bot active và pipeline Queued → Scanning → Compiling → Test match → Accepted/Rejected.
- [x] Biên dịch và chạy bot trong Docker; giới hạn tài nguyên, đo CPU, Landlock và seccomp.
- [x] Phân biệt lỗi bot với lỗi hạ tầng; retry, lease và heartbeat cho hàng đợi hiện tại.
- [x] Engine, giao thức JSON stdin/stdout, bot mẫu Python/C++ và replay có kiểm tra.
- [x] Bộ luật có phiên bản bất biến, bản đồ tùy chỉnh, ô chặn, power-up và kiểu di chuyển theo loại quân.
- [x] Đấu thử theo luật tùy chỉnh, không tác động Elo.
- [x] Vòng điểm, chốt bot khi tạo vòng, Elo theo thứ tự lịch, xuất CSV.
- [x] Hàm ghép cặp giới hạn số đối thủ ở backend và kiểm thử tương ứng; chưa phải Swiss và chưa có lựa chọn đầy đủ trên giao diện.
- [x] Tài liệu cài đặt, giao thức bot và hướng dẫn sử dụng hiện tại.

## P0 Chốt yêu cầu giải

- Trạng thái: Đã chốt hướng triển khai với chủ dự án: dưới 150 đội, Swiss theo điểm, bracket đấu thêm rồi xét hạt giống. [Yêu cầu tổ chức giải v0.2](docs/TOURNAMENT-REQUIREMENTS.md) ghi rõ mặc định cấu hình và các việc BTC cần chốt trước giải thật.
- [x] Soạn bản yêu cầu v0.1: quy mô, vòng đời giải, nhận/chốt bài, vòng loại, bracket, luật mới, fallback, sự cố và tiêu chí nghiệm thu.
- [x] Xác nhận ba quyết định chính và cập nhật bản yêu cầu thành cơ sở triển khai v0.2; chi tiết còn đề xuất được ghi riêng.
- [x] Chốt hướng quy mô: dưới 150 đội thực tế; sức chứa cấu hình được; 4.000 chỉ là thử tải mở rộng tùy chọn.
- [x] Chốt vòng loại Swiss theo điểm, không dùng Elo xếp hạng giải mới.
- [x] Chốt hướng phân định bracket hòa: đấu thêm rồi dùng hạt giống; số cặp phụ là tham số cấu hình.
- [ ] Xác định số người, số đội/bot, số lượt nộp và mức đồng thời mục tiêu.
- [ ] Chốt thời gian nhận bài, thời gian chấm cho phép và lịch vòng loại/chung kết.
- [ ] Chốt thể thức, số trận mỗi cặp, đổi bên, seed và cách chọn top.
- [ ] Chốt điểm xếp hạng, tie-break, hòa ở best-of-K, bye và điều kiện đi tiếp.
- [ ] Chốt cách xử lý bot lỗi, lỗi hạ tầng, khiếu nại và chạy lại trận.
- [ ] Chốt chính sách bài nhận trước hạn nhưng chưa chấm xong; đề xuất xét thời điểm lưu thành công và cấp biên nhận.
- [ ] Chốt fallback khi bài mới không hợp lệ hoặc đội không nộp lại sau đổi luật.
- [ ] Xác định mục tiêu độ trễ nhận bài, tỷ lệ lỗi, thời gian phục hồi và mức mất dữ liệu chấp nhận được.

Nghiệm thu: có thể lệ thống nhất để triển khai và kiểm thử, không còn quyết định kết quả thi phụ thuộc xử lý tùy tình huống.

## P0 Hoàn thiện luồng giải đấu

- Trạng thái: Đã chạy trọn giải thử 6 đội đến duyệt đội vô địch, giữ cùng bot/luật giữa hai giai đoạn. Có nhận/chốt bài, vòng loại tính điểm, duyệt đội, loại trực tiếp, bản xem lại và duyệt kết quả trong giải. Đã có công bố/nhận/kiểm tra bài nộp lại; đã chốt bot mới và chạy loại trực tiếp theo luật mới; website kết quả công khai còn thiếu. Xem [báo cáo giải thử](docs/DEMO-6-TEAMS.md).
- [x] Tạo/sửa/xem giải nháp riêng, cấu hình Swiss và sức chứa mặc định 150 có thể sửa, ghim phiên bản luật; API chỉ dành cho admin và có CSRF.
- [x] Quản lý danh sách đội độc lập theo giải, kiểm tra tài khoản/sức chứa và lưu nguyên tử; bỏ đội không xóa tài khoản hoặc danh sách giải khác.
- [x] Nhật ký thay đổi cấu hình/danh sách riêng theo giải; revision chống ghi đè khi nhiều admin sửa cùng lúc.
- [x] Giao diện mục Giải đấu: tạo/sửa, tìm và chọn đội, xem nhật ký; kiểm tra thao tác thật và bố cục desktop/mobile bằng Playwright.
- [x] Ô Chọn tất cả đội trong bộ lọc: chọn/bỏ chọn hàng loạt, trạng thái chọn một phần, bỏ qua tài khoản khóa chưa chọn và từ chối nguyên tử khi vượt sức chứa. Kiểm tra logic renderTeams với 150 tài khoản bằng Node/DOM giả; chưa kiểm tra trực quan riêng thao tác này trên trình duyệt.
- [x] Migration 8 và kiểm thử nâng cấp từ schema 7, lưu/đọc lại DB; chưa áp dụng lên DB giải thật trong đợt này.
- [x] Liên kết bài nộp và bot được chọn với giai đoạn vòng loại riêng; tách danh sách bài và lựa chọn khỏi luyện tập/Elo cũ.
- [x] Liên kết vòng đấu, kết quả và replay Swiss với giải/giai đoạn; dùng snapshot bot/luật đã chốt, không cộng Elo.
- [x] Liên kết ván/kết quả loại trực tiếp với giải, sơ đồ và bản duyệt vòng loại; tách khỏi lịch/điểm xếp hạng cũ. Đã có đợt nộp lại riêng; đã nối bot mới đã chốt vào loại trực tiếp.
- [x] Trạng thái chuẩn bị → nhận bài → chờ xử lý hết bài → chốt bot; có lịch mở/đóng và nhật ký thao tác.
- [x] Luồng chuẩn bị → nhận/chốt bài → thi đấu → kết quả tạm thời → duyệt và kết thúc giải, với chính sách giữ cùng bot/luật. Kết quả chỉ dành cho admin và thí sinh thuộc giải; chưa có công bố cho khách không đăng nhập.
- [x] Hạn nhận bài/chọn bot vòng loại được kiểm tra ở backend, gồm kiểm tra lại sau khi lưu file; giao diện hiển thị giờ máy chủ và mốc giờ Việt Nam.
- [x] Chốt bot vòng loại sau khi xử lý hết bài đúng hạn, kể cả khi kiểm tra hoàn tất sau hạn; blocked hạ tầng ngăn chốt, thiếu bot được ghi lý do.
- [x] Snapshot bot/luật vòng loại bất biến; chọn active hoặc nộp muộn/luyện tập không sửa bot đã chốt.
- [x] Chọn số đội đi tiếp cấu hình được theo đúng thứ hạng đã hoàn tất; lưu danh sách/hạt giống, bảng điểm và bot/luật bất biến, người/thời điểm/lý do duyệt. Admin có giao diện chốt; thí sinh thuộc giải đọc danh sách đã duyệt. Chặn duyệt sớm/trùng, dữ liệu cũ và đội đi tiếp bị khóa; chưa tạo vòng loại trực tiếp.
- [x] Tạo/lưu sơ đồ loại trực tiếp từ danh sách đã duyệt; xếp nhánh theo hạt giống, hỗ trợ số đội không phải lũy thừa của hai và tự đưa đội miễn đấu sang vị trí vòng sau. Admin/thí sinh thuộc giải xem được sơ đồ; sơ đồ bất biến và có nhật ký. Xem docs/BRACKETS.md.
- [x] Chạy toàn bộ loại trực tiếp với bot/luật vòng loại đã chốt, tính kết quả cặp, tự đi tiếp và tìm đội vô địch; bản xem lại, thử lại/giữ việc và duyệt kết quả để kết thúc.
- [x] Số ván chính cấu hình, điểm ván, đổi bên/mã khởi tạo, thêm cặp hai ván khi hòa rồi xét hạt giống; unit kiểm tra 1/3 ván chính, thắng ván phụ, hòa toàn bộ và lỗi hạ tầng. Giải Docker thật thử 1 ván chính + 1 cặp phụ.
- [x] Admin chạy toàn bộ loại trực tiếp; xem tiến độ, kết quả từng cặp, bản xem lại và chạy lại ván lỗi hạ tầng.
- [x] Điều khiển chạy riêng từng cặp hoặc phần còn lại của vòng loại trực tiếp: chọn chế độ trước khi bắt đầu, chỉ cấp việc cho cặp được chọn, tự xử lý ván phụ nhưng chờ lệnh cho cặp khác/vòng sau. Kiểm tra quyền/CSRF, phiên bản phiên chạy, lệnh trùng và khởi động lại; không đổi chế độ giữa chừng.
- [x] Chọn và chốt phiên bản luật chính thức sau duyệt đội và trước chấm loại trực tiếp: lưu nguyên luật bất biến, người/thời điểm/lý do, revision và nhật ký; hỗ trợ chọn phiên bản cũ. Giữ luật vòng loại thì chạy được như trước; nếu chọn luật khác, cả API và giao diện chặn chạy bot cũ cho đến khi nhận, kiểm tra và chốt đủ bot nộp lại theo luật mới. Xem docs/FINAL-RULES.md.
- [x] Pipeline nhận bài vòng loại kiểm tra theo bản luật ghim khi mở, lưu luật trong replay; không tự dùng Classic cho mọi giải.
- [x] Công bố luật mới và mở cửa sổ nộp lại cho đúng đội đủ điều kiện: danh sách đã duyệt, luật ghim, thông báo/lịch/chính sách; API quyền/CSRF/revision và portal riêng. Xem docs/FINAL-INTAKE.md.
- [x] Pipeline kiểm tra bài nộp lại theo luật của giai đoạn tương ứng: tách bài/lựa chọn theo giai đoạn, giữ biên nhận và xử lý bài đúng hạn sau đóng; Docker Python/C++ xác minh luật chính thức 12 nước khác vòng loại 8 nước.
- [x] Hết cửa sổ thì chốt bot và áp dụng chính sách đã công bố: dùng bản chọn riêng hoặc bản hợp lệ mới nhất trong đợt chính thức; thiếu bài hợp lệ/tài khoản không hoạt động thì chặn toàn bộ, không lấy bot cũ hay thay hạt giống. Snapshot bất biến được dùng cho cả hai chế độ loại trực tiếp.
- [x] Tạm dừng/tiếp tục/hủy vòng loại trực tiếp có lý do, quyền/CSRF/revision; không cấp ván mới khi dừng, giữ kết quả ván đang chạy; chỉ hủy sau khi tạm dừng và hết ván đang chạy. Giữ trạng thái sau khởi động lại, không công bố vô địch cho giải hủy.
- [x] Tạm dừng/tiếp tục/hủy vòng loại tính điểm: giữ ván đang chạy, không cấp ván mới, giữ trạng thái sau khởi động lại; hủy chỉ sau khi dừng và hết ván đang chạy, không duyệt đội đi tiếp.
- [x] Hủy ở giai đoạn chuẩn bị/nhận bài: lý do, quyền/CSRF/revision, giữ lịch sử, ngừng nhận bài và chặn mở lại/chốt bot; bài đã nhận tiếp tục kiểm tra nhưng không dùng thi đấu.

Nghiệm thu: tổ chức trọn một giải thử 8–16 đội từ tạo giải đến công bố, không sửa DB thủ công.

## P0 Chuẩn bị nhận người dùng qua mạng

- [ ] Sửa giới hạn đăng nhập đang tính cả lần thành công theo IP/socket; kiểm thử nhiều người chung mạng.
- [ ] Cấu hình proxy tin cậy, nhận đúng giao thức/IP; không tin header chuyển tiếp từ nguồn tùy ý.
- [ ] Kiểm tra Origin, HTTPS và cookie khi chạy sau reverse proxy.
- [ ] Thay quy trình admin mặc định admin/admin bằng thông tin riêng trước khi mở giải; bổ sung đổi mật khẩu admin.
- [ ] Cấp thông tin đăng nhập riêng phù hợp cho giải thật; rà soát việc dùng username làm mật khẩu ban đầu.
- [ ] Đo và thiết kế lại tiếp nhận upload quanh giới hạn hiện tại 4 lượt đồng thời; bảo vệ RAM và có backpressure.
- [ ] Hiển thị trạng thái 429, Retry-After và retry có khoảng chờ phù hợp.
- [x] Biên nhận và Idempotency-Key cho nộp theo giải: retry cùng yêu cầu trả cùng bài, sau hạn vẫn tra được; kiểm thử cả hai request đồng thời.
- [ ] Mở rộng chống trùng cho luồng luyện tập cũ và khôi phục khóa retry phía trình duyệt sau reload nếu cần.
- [ ] Quyết định phạm vi /legacy: demo riêng hay dùng chung engine; xử lý xác thực tái nhập vai chơi nếu tiếp tục mở qua mạng.

Nghiệm thu: nhiều tài khoản chung IP sử dụng được; không mất/trùng bài khi retry; phiên và upload hoạt động đúng sau proxy.

## P1 Thể thức và hiệu năng

- [x] Triển khai Swiss theo điểm: ghép từng vòng, tránh tái đấu, bye, Buchholz/Sonneborn-Berger/điểm ván/seed, cấu hình số vòng; giao diện admin và bảng điểm thí sinh. Bộ ghép có giới hạn tìm kiếm, không nhận là chuẩn FIDE; xem docs/SWISS.md.
- [ ] Xem trước tổng số trận, số đối thủ và thời gian dự kiến; cảnh báo lịch vượt năng lực.
- [ ] Tách cấu hình slot kiểm tra bài, chấm vòng điểm và đấu thử; hiện vòng điểm có một slot.
- [ ] Áp dụng ngân sách tài nguyên chung để ba nguồn công việc không làm quá tải máy.
- [ ] Đo chi phí ghi toàn bộ replay mỗi lượt; tối ưu tần suất live hoặc cách lưu sự kiện theo kết quả đo.
- [ ] Đo chi phí chuẩn bị bot mẫu lặp lại; cân nhắc cache artifact theo hash và image.
- [ ] Giảm polling bảng điểm không cần thiết; có backoff, tránh request chồng và tạm ngừng khi không xem.
- [ ] Phân trang/lọc danh sách lớn và đo truy vấn/index SQLite theo dữ liệu thực tế.
- [ ] Đặt quota lưu trữ và chính sách lưu/xóa log, replay, bài nộp; giữ dữ liệu cần kiểm chứng kết quả.

## P1 Offline và phục hồi

- [ ] Đóng gói đủ runtime, sandbox image, compiler, tài khoản, luật và tài nguyên web trước ngày thi.
- [ ] Loại phụ thuộc Internet khỏi luồng LAN; xử lý font/thư viện CDN ở khu legacy nếu dùng.
- [ ] Cấu hình địa chỉ server LAN cố định, HOST, firewall và hướng dẫn truy cập.
- [ ] Sao lưu nhất quán SQLite cùng mã nguồn, artifact, manifest image và phiên bản phần mềm.
- [ ] Công cụ/quy trình kiểm tra và khôi phục backup trên máy khác.
- [ ] Chuẩn bị máy dự phòng, lịch backup, người phụ trách chuyển máy; UPS cho server và thiết bị mạng nếu có điều kiện.
- [ ] Khởi động lại không mất bài đã nhận, không tính thua do hạ tầng và không cộng điểm trùng.
- [ ] Diễn tập mất điện, mất mạng, đầy đĩa và hết dung lượng lưu trữ theo môi trường thử riêng.

Nghiệm thu: ngắt Internet vẫn hoàn thành giải LAN; khôi phục sang máy dự phòng và đối chiếu được dữ liệu/kết quả.

## P1 Kiểm thử và báo cáo năng lực

- [x] Chạy npm test ngày 18/10/2026: 67/67 test đạt.
- [x] Sau bổ sung quản lý giải nháp: npm test 74/74 đạt; có test API phân quyền/CSRF, validation, roster độc lập, sửa đồng thời và migration.
- [x] Kiểm tra giao diện quản lý giải nháp trên dữ liệu thử: tạo 16 đội/4 vòng/top 8, lưu 2 đội, tải lại còn nguyên; ảnh desktop và mobile 390 px không tràn ngang. Chưa kiểm chứng runner Swiss/bracket.
- [x] Sau bổ sung nhận/chốt bài: npm test 82/82 đạt; kiểm tra deadline trong lúc ghi file, lịch mở tương lai, retry đồng thời, fallback, chọn thủ công, chốt nguyên tử và snapshot bất biến.
- [x] npm run test:stages đạt với Docker thật: Python/C++, luật tùy chỉnh 8 nước, đóng khi còn hàng đợi, chốt bot và đọc lại snapshot sau mở lại database.
- [x] Playwright hoàn tất luồng admin mở giải → hai thí sinh nộp bot được Accepted → admin đóng/chốt đúng hai phiên bản; kiểm tra giao diện 390 px không tràn ngang trên DB thử.
- [x] Chạy npm run sandbox:check ngày 18/10/2026: available=true, Landlock ABI 7, seccomp=true, passwd_denied=true.
- [ ] Chạy lại integration Docker: test:sandbox, test:pipeline, test:templates, test:scoring, test:two-players, test:rules; chạy tuần tự trên dữ liệu thử.
- [ ] Test bracket 3, 5, 8, 16 đội; bye, hòa và lỗi hạ tầng.
- [x] Kiểm thử riêng sơ đồ với 2/3/5/8/16/150/256 đội: hạt giống cao miễn đấu, nhánh 1/2 tách nhau, không lặp đội, đủ đường đi, dữ liệu sai, revision, tạo trùng, nhật ký, bất biến và lưu/đọc lại SQLite. Mô phỏng đội thắng để kiểm tra đường đi; chưa chấm trận loại trực tiếp thật.
- [x] Swiss: npm test 90/90 đạt; mô phỏng ghép nhiều vòng cho 3/5/16/149/150 đội, kiểm tra điểm, bye, không tái đấu, giới hạn tìm kiếm, API phân quyền/CSRF/revision và CSV. Không phải benchmark chạy 150 bot thật.
- [x] Swiss: test:stages đạt với Docker Python/C++, đổi bên/cùng seed mỗi cặp ván, luật ghim 8 nước, snapshot độc lập bài nộp bị sửa và đọc kết quả sau mở lại DB.
- [x] Swiss: Playwright chạy 4 đội/2 vòng trên DB thử, xem replay 8 nước và bảng điểm thí sinh; kiểm tra 390 px không tràn ngang sau sửa tiêu đề replay có seed dài.
- [x] Worker Swiss: test lease hết hạn, khởi động lại để tổng hợp kết quả, retry lỗi hạ tầng và từ chối kết quả đến muộn; chưa thay thế diễn tập mất điện toàn hệ thống.
- [x] Test nộp sát hạn, hoàn tất kiểm tra sau hạn, đổi active sau chốt và fallback trong giai đoạn vòng loại.
- [ ] Mở rộng các ca hạn nộp/fallback cho cửa sổ nộp lại bracket khi triển khai.
- [ ] Test đổi luật giữa các vòng; replay và kết quả cũ giữ đúng luật lịch sử.
- [ ] Test worker bị ngắt, lease hết hạn, retry và kết quả đến muộn không được ghi đè/cộng điểm trùng.
- [ ] Test backup/restore sang máy khác và hoàn thành giải khi Internet bị ngắt.
- [ ] Load test đăng nhập nhiều tài khoản, gồm cùng IP và qua proxy.
- [ ] Load test hàng đợi thực tế 450 bài (150 đội × 3); thử 1.000 bài giả là mở rộng tùy chọn, tách khỏi upload đồng thời.
- [ ] Load test upload theo burst tăng dần và mức mục tiêu đã chốt.
- [ ] Load test bảng điểm: mốc ban đầu 300 người xem; 4.000 là thử tải mở rộng tùy chọn, không là yêu cầu vận hành mặc định.
- [ ] Benchmark trận Python/C++, thời gian biên dịch và số slot; ghi p50/p95/p99, tỷ lệ lỗi, CPU/RAM/disk và thời gian rút hàng đợi.
- [ ] Báo cáo cấu hình, dữ liệu thử, nút thắt và căn cứ số máy; không mặc định 5–6 máy là đủ.
- [ ] CI cho unit/API test; integration sandbox trên runner phù hợp và theo lịch/tác vụ riêng.

## P2 Máy chấm phân tán

- [ ] Tách tiến trình điều phối, kiểm tra bài và chấm trận.
- [ ] Chọn DB cho bản phân tán; đề xuất PostgreSQL, giữ SQLite cho bản local nếu phù hợp.
- [ ] Chọn queue PostgreSQL hoặc Redis/BullMQ; ghi rõ quyết định trước khi thêm dịch vụ.
- [ ] API đăng ký/xác thực worker, phân quyền nhận việc và trả kết quả.
- [ ] Phân phối source/artifact theo hash, image cố định và manifest môi trường; không chia sẻ file SQLite qua mạng.
- [ ] Lease, heartbeat, thu hồi việc, giới hạn retry và chống kết quả trùng/đến muộn.
- [ ] Quản lý image có sẵn trên worker, tương thích kiến trúc CPU, CPU/RAM/disk và số slot.
- [ ] Theo dõi worker online/offline, thời gian chờ, tỷ lệ lỗi và năng lực xử lý.
- [ ] Benchmark nhiều máy với cấu hình khác nhau và kiểm tra công bằng giới hạn chạy.

Nghiệm thu: tắt một worker giữa trận, worker khác tiếp tục xử lý; dữ liệu và điểm vẫn nhất quán.

## P2 Công bố và đồng bộ

- [ ] Trạng thái kết quả: bản nháp, đã duyệt, đã công bố; có người duyệt và dấu thời gian.
- [ ] Xuất snapshot kết quả công khai có mã phiên bản; không tính lại bảng điểm theo từng người xem.
- [ ] Website công khai và cache/CDN đúng đường dẫn; không cache session hoặc dữ liệu cá nhân.
- [ ] Công bố trước thời điểm dự kiến có kết quả và giải thích trạng thái chờ.
- [ ] Gói xuất offline gồm đội, bài nộp, luật, lịch, kết quả, replay, hash và phiên bản phần mềm.
- [ ] Import online có kiểm tra toàn vẹn, chống trùng và báo xung đột.
- [ ] Quy định một nơi ghi dữ liệu chính thức tại một thời điểm; ghi nhận chuyển giao online/offline.

## P3 Git Google Sheets và trải nghiệm

- [ ] Đăng ký repository gắn với tài khoản đội và xác minh quyền phù hợp.
- [ ] Nộp commit cụ thể; lưu bản mã nguồn, commit ID, hash, thời điểm nhận và biên nhận.
- [ ] Lấy repository theo hàng đợi có giới hạn; không chạy hook/build script của repo ngoài sandbox.
- [ ] Có nộp file dự phòng và dùng chung pipeline; không coi tên tác giả commit là xác thực.
- [ ] Xuất phiên bản kết quả đã duyệt lên Google Sheets; lỗi Sheets không làm mất kết quả gốc.
- [ ] Bộ khởi động/đóng gói và tự kiểm tra môi trường cho giáo viên ít kinh nghiệm kỹ thuật.
- [ ] Luồng thao tác rõ: khởi động → kiểm tra máy → tạo giải → nhập đội → mở/chốt bài → chạy giải → công bố.
- [x] Tài liệu Quy tắc và cách tổ chức giải trong mục Giải đấu của admin: giải thích thuật ngữ/thể thức, bảng cấu hình, 11 bước tạo/chạy giải, tính điểm/miễn đấu/hòa, trạng thái, lỗi thường gặp và giới hạn hiện có. Bản nguồn docs/QUY-TAC-GIAI-DAU.md; trang web có mục lục, mở tab mới và đọc được trên điện thoại.
- [ ] Bot mẫu chạy ngay, bài hướng dẫn ngắn cho sinh viên năm nhất, giải thích lỗi và replay dễ hiểu.
- [ ] Diễn tập với người chưa biết Docker/Linux/DB và ghi lại điểm vướng.
- [ ] Đánh giá USB boot đã tích hợp môi trường chấm; giữ Docker hiện tại đến khi phương án thay thế được nghiệm thu.

## Công cụ và điều kiện cài đặt

Đánh dấu đã xác minh trên máy hiện tại, không áp dụng tự động cho máy mượn hoặc máy triển khai mới. Không cài dịch vụ tùy chọn trước khi chốt kiến trúc.

- [x] Node.js 24.16.0 và npm 11.13.0 có trên máy hiện tại.
- [x] Git có trên máy hiện tại.
- [x] Docker Desktop/WSL2 và sandbox image hiện tại hoạt động qua sandbox:check.
- [x] Dockerfile đã có Python, g++, thư viện JSON C++ và libseccomp; không cần cài riêng trên host để dùng runner hiện tại.
- [ ] Chuẩn bị k6 cho load test, bằng CLI hoặc Docker; mới là đề xuất, chưa cài trong đợt này.
- [ ] Chọn và cấu hình Caddy hoặc Nginx khi triển khai HTTPS.
- [ ] Chuẩn bị domain/DNS và Cloudflare nếu công bố Internet.
- [x] Ghi phương án triển khai trong docs/DEPLOYMENT.md: VPS Linux chạy Node/SQLite/Docker, Cloudflare phía trước; demo có thể dùng Tunnel. Chưa mua VPS/domain hoặc triển khai dịch vụ.
- [ ] Chuẩn bị PostgreSQL nếu chọn kiến trúc phân tán.
- [ ] Chuẩn bị Redis/BullMQ chỉ nếu chọn phương án queue này.
- [ ] Chuẩn bị nơi lưu artifact dùng chung hoặc API tải artifact; MinIO/object storage là tùy chọn.
- [ ] Chuẩn bị Google Cloud project, quyền Sheets API và danh tính truy cập khi làm tích hợp Sheets.
- [ ] Chuẩn bị Git hosting và thông tin truy cập giới hạn quyền khi làm tích hợp Git.
- [ ] Chuẩn bị runner CI Linux phù hợp cho integration sandbox.
- [ ] Xác minh runtime/image/sandbox:check riêng trên từng máy mới; Windows cần Docker Desktop/WSL2 phù hợp.

Nguồn cài đặt:

- Docker Windows: https://docs.docker.com/desktop/setup/install/windows-install/
- k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
- Express sau proxy: https://expressjs.com/en/guide/behind-proxies.html
- Cloudflare cache: https://developers.cloudflare.com/cache/get-started/

## Hạ tầng và tổ chức

Cấu hình dưới đây chỉ là điểm bắt đầu để benchmark, chưa cam kết đáp ứng tải mục tiêu.

- [ ] Kiểm kê máy phát triển/demo: đề xuất 4 nhân, RAM 8–16 GB, SSD.
- [ ] Chuẩn bị máy điều phối thử: đề xuất 4 vCPU, RAM 8 GB, SSD; hạn chế chấm cùng máy.
- [ ] Chuẩn bị máy chấm thử: đề xuất 4–8 nhân, RAM 8–16 GB, cùng kiến trúc/môi trường.
- [ ] Chốt số slot theo benchmark; tính cả hai container mỗi trận và tài nguyên biên dịch.
- [ ] Chuẩn bị LAN ổn định, dây mạng cho server, địa chỉ cố định, máy dự phòng và nguồn điện.
- [ ] Phân công người điều hành, phụ trách hạ tầng, hỗ trợ thí sinh và duyệt kết quả.
- [ ] Hồ sơ nộp thầy: thể thức, announcement, lịch, hướng dẫn nộp, tính điểm, lỗi/khiếu nại, kiến trúc và phương án dự phòng.
- [ ] Buổi announce trước chung kết: hướng dẫn Git nếu dùng, đổi luật, thời hạn nộp lại và thao tác LAN.
- [ ] Thi thử trọn quy trình 8–16 đội; ghi biên bản, sự cố và việc khắc phục.

## Thứ tự thực hiện đề xuất

1. Chốt yêu cầu và thể lệ.
2. Quản lý giai đoạn giải, hạn nộp, tài khoản qua mạng.
3. Top N, bracket, luật theo vòng và cửa sổ nộp lại.
4. Backup/restore và hoàn thành giải LAN nhỏ.
5. Kiểm thử tải, tối ưu và quyết định số máy theo số đo.
6. Máy chấm phân tán, công bố và đồng bộ online/offline.
7. Git, Sheets và bộ đóng gói cho người ít kỹ thuật.

## Nhật ký tiến trình

- 19/10/2026: Hoàn thành chốt bot chính thức nguyên tử, kiểm tra hạn/hàng đợi/tài khoản/đủ bài mọi đội; giữ bản chọn riêng hoặc bản hợp lệ mới nhất của đợt mới, không lấy bot cũ. Nối snapshot vào máy chấm tự động/thủ công, giữ danh sách/hạt giống và luật/bot vòng loại. npm test 108/108 đạt; test:stages Docker Python/C++ đạt (~56 giây), chạy loại trực tiếp luật 12 nước và xác minh replay dùng đúng bài mới. API chốt có quyền/CSRF/revision; chốt trùng và rollback thiếu đội được kiểm tra. Cập nhật nút admin/hướng dẫn, không thêm dependency hoặc migration. Chưa kiểm chứng trực quan riêng nút mới.

- 19/10/2026: Hoàn thành công bố/nhận/đóng bài nộp lại chính thức, migration 15 bảo toàn dữ liệu cũ. npm test 107/107 và test:stages Docker thật đạt: quyền, hạn nộp, tách bài, luật ghim, mở lại DB. Trình duyệt DB giả: công bố cho đúng 5 đội, portal có đợt riêng/luật 16 nước/thông báo/hạn giờ Việt Nam; 390 px không tràn. Ảnh output/playwright/final-intake-portal.png. Cập nhật hướng dẫn, không thêm dependency. Chốt bot đợt mới và nối loại trực tiếp là mục tiếp theo.

- 19/10/2026: Hoàn thành chọn/chốt luật chính thức, migration 14 và API admin có CSRF; luật bất biến theo phiên bản, lưu người/thời điểm/lý do và tăng revision nguyên tử. npm test 103/103 đạt: luật cũ khi đã có bản mới, bất biến, lưu/đọc lại SQLite, quyền, CSRF, dữ liệu cũ, trạng thái sai và chặn cả hai chế độ chạy khi đổi luật. Trình duyệt kiểm chứng trên DB giả: chốt luật 16 nước khác vòng loại, tạo sơ đồ nhưng cả hai nút chạy bị khóa; 390 px không tràn ngang. Ảnh output/playwright/final-rule-pinned.png. Đã cập nhật hướng dẫn; không thêm dependency. Công bố/nhận/chốt bot nộp lại còn chưa triển khai.
- 19/10/2026: Xác minh cổng 3000 và server thử đã dừng; sao lưu SQLite tại data/backups/before-final-rules-20261019-002121 trước khi mở lại server với migration 14. Không chốt hay đổi luật cho các giải đang dùng của người dùng.

- 18/10/2026: Thêm chế độ điều khiển từng cặp/vòng trên cùng máy chấm loại trực tiếp; không thay schema và vẫn tương thích phiên tự chạy trước đây. API /bracket/schedule nhận phiên bản phiên chạy, lý do và đúng một cặp hoặc vòng. npm test 101/101 đạt; gồm 7 ca máy chấm kiểm tra chỉ cấp việc đã chọn, chờ sau vòng, chống trùng/lệnh cũ và giữ chế độ khi khởi động lại. Trình duyệt trên DB giả 5 đội: khởi tạo không tạo ván, chạy một cặp rồi cả bán kết, chung kết vẫn ready; kiểm tra 390 px không tràn. Ảnh output/playwright/bracket-manual-controls.png. Đã cập nhật quy tắc/hướng dẫn và dựng lại trang tài liệu; không thêm dependency, không sửa giải thật.

- 18/10/2026: Thêm hướng dẫn cho admin tại docs/QUY-TAC-GIAI-DAU.md và web/tournament-guide.html; dựng HTML từ Markdown bằng scripts/build-tournament-guide.js, không thêm dependency. Đặt liên kết ngay đầu mục Giải đấu. Kiểm tra bằng trình duyệt: mở từ admin sang tab mới, đủ 8 phần và 11 bước, mục lục đến đúng phần, desktop/390 px không tràn ngang; đã trả kích thước màn hình mặc định và giữ tab tài liệu. Ảnh output/playwright/tournament-guide-desktop.png, tournament-guide-mobile.png. Kiểm tra cú pháp script, dựng lại tài liệu và git diff --check đạt; không đổi dữ liệu giải hoặc thuật toán.

- 18/10/2026: Cải tiến giao diện kết quả loại trực tiếp: khối vô địch nổi bật và trạng thái duyệt, mỗi đội một hàng với điểm lớn, tô đội đi tiếp kèm nhãn, phân biệt dừng bước/miễn đấu, giải thích hòa xét hạt giống. Gom bản xem lại vào phần mở rộng và giữ trạng thái mở khi cập nhật. Xác minh trực tiếp trên giải 6 đội tại cổng 3000, mở bản xem lại thành công và giữ phần mở rộng sau cập nhật; màn hình 390 px không tràn ngang, đã khôi phục kích thước mặc định. Ảnh output/playwright/bracket-results-redesign.png và bracket-results-mobile.png; kiểm tra cú pháp và git diff --check đạt. Không đổi dữ liệu hoặc cách tính điểm.

- 18/10/2026: Hoàn thiện máy chấm loại trực tiếp và duyệt kết quả, migration 13; ghim bot/luật, cộng điểm ván, cặp phụ đổi bên, xét hạt giống, tự đi tiếp, bản xem lại và phục hồi giữ việc. npm test 99/99 đạt; trong đó 5 ca máy chấm loại trực tiếp kiểm tra 6 đội, hòa, thắng chính/phụ, lỗi hạ tầng, thử lại, kết quả muộn, hết hạn giữ việc và duyệt kết quả. Không thêm dependency.
- 18/10/2026: Theo yêu cầu người dùng, tạo và chạy thật giải 14761b35-4597-4c99-8911-3e7cb93d0ae5 với 6 đội mẫu (3 Python, 3 C++), luật rút gọn 8 nước: 6 bài Accepted, 12 ván vòng loại, 2 suất miễn đấu, 5 cặp loại trực tiếp/15 ván; kiểm chứng 27 bản xem lại. Vô địch demo6_20261018161539_2; đã duyệt/kết thúc và đối chiếu sau mở lại DB. Xem docs/DEMO-6-TEAMS.md. Không sửa giải test đang có; sao lưu trước chạy tại data/backups/before-demo6-20261018-231533, server cổng 3000 đã mở lại schema 13.
- 18/10/2026: Mở chính giải thử trên trình duyệt người dùng, xác nhận hiển thị đã kết thúc/đã công bố, mở bản xem lại ván chung kết (hòa sau 8 nước) thành công. Ảnh kết quả output/playwright/demo-six-completed.png. Giải ngắn kiểm tra luồng và phân định hòa, không phải đánh giá bot hoặc thử tải 150 đội; diễn tập 8–16 đội/đổi luật/ngoại tuyến còn riêng trong checklist.

- 18/10/2026: Hoàn thành sơ đồ loại trực tiếp, migration 12, src/brackets.js và giao diện dùng chung admin/thí sinh. npm test 94/94 đạt; sau bổ sung chặn phần tử null, test/brackets.test.js 3/3 đạt. Playwright tạo sơ đồ 5 đội/8 vị trí/3 suất miễn đấu, tải lại giữ nguyên và khóa tạo lại; 390 px/1366 px không tràn. Ảnh output/playwright/bracket-mobile.png và bracket-desktop.png. Không thêm dependency; chạy trận, phân định hòa và luật/nộp lại vòng chính thức còn trong TODO.
- 18/10/2026: Sao lưu SQLite khi server đã dừng vào data/backups/before-bracket-20261018-230819; khởi động lại cổng 3000 và xác minh schema 12. Không tự tạo sơ đồ cho giải đang dùng của người dùng.

- 18/10/2026: Hoàn thành duyệt đội đi tiếp, migration 11 và API có phân quyền/CSRF/revision; danh sách bất biến, giữ đúng thứ hạng và bot chốt. npm test 91/91 đạt; test:stages Docker thật đạt và đọc lại danh sách sau mở lại DB. Playwright duyệt 2/3 đội trên DB giả, tải lại giữ nguyên/khóa duyệt lại, 390 px không tràn; ảnh output/playwright/qualification-mobile.png. Không thêm dependency; vòng loại trực tiếp còn chưa triển khai.
- 18/10/2026: Dừng server cũ, sao lưu các file SQLite vào data/backups/before-qualification-20261018-225936 rồi khởi động lại cổng 3000; xác minh schema 11. Không tự duyệt danh sách đội đi tiếp của giải đang dùng.

- 18/10/2026: Việt hóa thuật ngữ giải trên giao diện admin/thí sinh và thông báo kiểm tra dữ liệu: vòng loại tính điểm, vòng loại trực tiếp, tổng điểm đối thủ, điểm đối thủ có trọng số, lượt miễn đấu và mã ghép lịch. Bổ sung giải thích chỉ số phụ; giữ nguyên tên trường/API và tiêu đề CSV máy đọc để tương thích. Kiểm tra cú pháp và npm test 90/90 đạt (chạy ngoài sandbox vì kết nối localhost bị EACCES).

- 18/10/2026: Hoàn thành khối trạng thái nhận bài nổi bật tại portal: hạn nộp chữ lớn, múi giờ Việt Nam, thời gian còn lại theo lần cập nhật máy chủ; phân biệt luyện tập/chưa mở/đang nhận/còn dưới 24 giờ/đã đóng/đã chốt bằng nhãn và màu. Kiểm tra 6 trạng thái với dữ liệu mẫu trong trình duyệt, bố cục 390 px và 1280 px không tràn ngang; ảnh output/playwright/stage-status-mobile.png. Kiểm tra cú pháp web/app.js đạt; không thay đổi hạn nộp hoặc dữ liệu giải.

- 18/10/2026: Làm rõ đội đã tick và đội đã lưu: bộ đếm hiển thị cả hai, cảnh báo thay đổi chưa lưu, khóa Mở nhận bài khi danh sách chưa lưu hoặc ít hơn hai đội đã lưu. Kiểm tra cú pháp và 4 trường hợp logic controls bằng Node đạt; chưa xác minh trực quan riêng thay đổi này.

- 18/10/2026: Thêm checkbox chọn tất cả trong danh sách đội; giữ lựa chọn ngoài bộ lọc, chỉ lưu khi bấm Lưu danh sách đội. Kiểm tra cú pháp và 5 tình huống chọn/bỏ chọn/giới hạn/tài khoản khóa đạt; không thêm dependency. Áp dụng nguyên tắc nhãn rõ và trạng thái mixed của skill UI/UX; công cụ tra cứu Python của skill không chạy được trên PATH, dùng hướng dẫn đã đọc.

- 18/10/2026: Khắc phục API giải đấu 404 trên cổng 3000: tiến trình Node khởi động trước khi bổ sung route; khởi động lại server nạp mã và migration hiện tại. Không sửa dữ liệu giải thủ công.

| Ngày | Công việc | Bằng chứng và giới hạn |
| --- | --- | --- |
| 18/10/2026 | Rà soát yêu cầu và các thành phần dự án; tạo checklist | Đọc ghi chú Word, mã nguồn, cấu hình, tài liệu và test; chưa triển khai các mục còn thiếu |
| 18/10/2026 | Chạy unit/API test | npm test: 67 pass, 0 fail; chưa phải load test hoặc toàn bộ integration Docker |
| 18/10/2026 | Kiểm tra môi trường sandbox | npm run sandbox:check: available=true, ABI 7, seccomp=true, passwd_denied=true |
| 18/10/2026 | Bắt đầu P0 chốt yêu cầu; soạn docs/TOURNAMENT-REQUIREMENTS.md v0.1 | Đã đối chiếu code/giao thức hiện tại; có đề xuất và tiêu chí cho từng nhóm. Đang chờ chốt quy mô, điểm vòng loại và hòa bracket; chưa đánh dấu các quyết định nghiệp vụ là xong |
| 18/10/2026 | Chủ dự án chốt quy mô và thể thức; cập nhật yêu cầu v0.2 | Dưới 150 đội, Swiss theo điểm, bracket đấu thêm rồi dùng hạt giống; 4.000 chỉ là thử tải mở rộng. Các mặc định chi tiết và lịch thật vẫn được ghi riêng |
| 18/10/2026 | Hoàn thành quản lý giải nháp và danh sách đội | src/tournaments.js, migration 8, web/tournaments.js và mục Giải đấu trong admin; hướng dẫn docs/TOURNAMENTS.md. Chưa nối bài nộp, hạn nộp hoặc runner Swiss/bracket |
| 18/10/2026 | Kiểm chứng quản lý giải nháp | 74/74 unit/API test đạt; Playwright tạo giải, chọn đội, tải lại, kiểm tra desktop và 390 px trên DB tạm. Dùng ui-ux-pro-max cho biểu mẫu và Playwright cho UI; không thêm dependency |
| 18/10/2026 | Hoàn thành nhận/chốt bài vòng loại theo giải | Migration 9, src/tournament-stages.js, pipeline có stage/rules và biên nhận Idempotency-Key; giao diện admin/thí sinh có lịch, chọn giải và trạng thái. Luồng luyện tập/Elo cũ riêng; runner Swiss/bracket chưa triển khai |
| 18/10/2026 | Kiểm chứng nhận/chốt bài vòng loại | 82/82 unit/API test; test:stages Docker Python/C++ và mở lại DB đạt. Playwright hai tài khoản nộp thật qua multipart, Accepted rồi admin đóng/chốt hai snapshot; 390 px không tràn. Không cài thêm dependency, không chạy migration lên DB giải thật |
| 18/10/2026 | Hoàn thành Swiss vòng loại | Migration 10, src/swiss-pairing.js và src/swiss.js; lịch từng vòng, đổi bên, điểm/tie-break/bye, worker lease/retry, replay và CSV; giao diện admin/thí sinh. Không thay Elo cũ; chưa chọn top, bracket hoặc công bố chính thức |
| 18/10/2026 | Kiểm chứng Swiss và ghi phương án deploy | npm test 90/90; test:stages Docker thật đạt; Playwright 4 đội/2 vòng, replay và bảng điểm thí sinh, mobile 390 px không tràn. Mô phỏng ghép tới 150 đội không phải thử tải bot thật. docs/SWISS.md và docs/DEPLOYMENT.md; không thêm dependency, không deploy |

- 19/10/2026: Dừng server và sao lưu data/backups/before-final-intake-20261019-003506; mở lại cổng 3000 với schema 15, foreign_key_check không có lỗi. Giữ 1 giải finished và 1 giải submissions_open; không tự mở đợt nộp lại cho giải thật.

- [x] Hiển thị mô tả luật tiếng Việt ngay khi thí sinh chọn nơi nộp bài, cho cả vòng loại/vòng chính thức; bàn cờ, quân, di chuyển, ăn quân, thắng/hòa, vật phẩm và cấu hình đầy đủ theo luật ghim.
- 19/10/2026: Bổ sung mô tả luật trong thẻ nơi nộp bài, dùng textContent và bố cục co giãn. Kiểm tra cú pháp web/app.js đạt; mô phỏng DOM xác minh vòng loại 500 nước, chuyển sang luật chính thức 16 nước/bàn 7×11 và luyện tập không giữ mô tả cũ. Chưa kiểm chứng trực quan riêng thay đổi này.

- 19/10/2026: Hoàn thành điều khiển tạm dừng/tiếp tục/hủy riêng loại trực tiếp. npm test 109/109 đạt, gồm ván đang chạy hoàn tất khi dừng, không cấp ván mới, khởi động lại giữ dừng, tiếp tục hoàn tất, hủy không chạy/công bố và quyền/CSRF/revision. Kiểm tra cú pháp và diff đạt; cập nhật hướng dẫn admin. Không thêm dependency/migration, chưa kiểm chứng trực quan riêng các nút mới. Các giai đoạn khác được giữ là mục chưa hoàn thành.

- 19/10/2026: Bổ sung điều khiển vòng loại, migration 16 lưu swiss_controls; API quyền/CSRF/revision, lý do và nhật ký. Kiểm thử ván đang chạy, không cấp thêm việc, khởi động lại, tiếp tục hoàn tất và hủy không thể duyệt đội. Cập nhật nút admin, trạng thái thí sinh và hướng dẫn; chưa kiểm chứng trực quan riêng các nút mới. Không thêm dependency.

- 19/10/2026: npm test 110/110 đạt; cú pháp/dựng hướng dẫn/diff đạt. Sao lưu data/backups/before-swiss-controls-20261019-005307 trước mở lại server cổng 3000, schema 16 và foreign_key_check không có lỗi. Không thao tác dừng/hủy các giải thật.

- 19/10/2026: Hoàn thành hủy giải trước thi đấu, nút admin và nhãn giải đã hủy ở portal; npm test 111/111 đạt, gồm quyền/CSRF, dữ liệu cũ, hủy trùng, chặn nộp/chốt/mở lại và giữ danh sách/nhật ký. Cú pháp/dựng hướng dẫn/diff đạt; chưa kiểm chứng trực quan riêng nút mới. Không thêm dependency/migration; server cổng 3000 đã mở lại, không hủy giải thật.

- 19/10/2026: Chuẩn bị tập thay đổi để commit: giữ mã nguồn/bot mẫu/test/tài liệu/TODO/AGENTS; loại ghi chú Word gốc, DB/backup, dependency, cache, kết quả thử và cấu hình editor khỏi Git bằng .gitignore, không xóa dữ liệu trên máy. Rà mẫu private key/token không thấy kết quả. Chưa commit hoặc push.

- [x] Hướng dẫn tải/cài/sử dụng cho người mới tại docs/CAI-DAT-VA-SU-DUNG.md, README dẫn tới đúng luồng giải hiện tại; quy tắc duy trì tài liệu trong AGENTS.md.
- 19/10/2026: Soạn hướng dẫn cài lần đầu/chạy lại, admin/thí sinh, cập nhật/backup/LAN, biến môi trường và lỗi thường gặp. Đối chiếu package.json, seed, server và đường dẫn lưu bài; sửa README bỏ mô tả cũ chưa có loại trực tiếp/nộp lại. Chỉ thay tài liệu, không cài lại hoặc thao tác giải thật.
