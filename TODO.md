# Công việc cần làm cho OTTv2

- 19/10/2026: Theo yêu cầu người dùng, bổ sung AGENTS.md yêu cầu kiểm tra và bật web khi bắt đầu mỗi lượt làm việc trong dự án, dùng lại server nếu đã chạy. Đã khởi động npm start tại cổng 3000, xác nhận /api/health HTTP 200 (status ok) và /portal HTTP 200; giữ server hoạt động.

## Trải nghiệm người mới — 19/10/2026

- [x] Thêm mục Bắt đầu theo vai trò với lộ trình nộp bot/điều hành giải, giải thích thuật ngữ và hướng dẫn giới thiệu cho giám khảo; mã và tài liệu đã cập nhật.
- [x] Làm rõ luyện tập/bài thi, lựa chọn bot theo giai đoạn và bản đã chốt; đổi nhãn điểm cũ thành Điểm ngoài giải, thu gọn điểm cũ/tùy chọn ZIP; ẩn Hủy ở bước đổi mật khẩu bắt buộc.
- [x] Kiểm tra cú pháp JavaScript và diff; npm test 111/111 đạt ngoài sandbox (trong sandbox lỗi kết nối localhost EACCES).
- [ ] Kiểm chứng trực quan desktop/mobile, bàn phím và luồng sử dụng thật sau thay đổi; cổng localhost:3000 không hoạt động khi thử truy cập trong đợt này.
- [ ] Thử với sinh viên năm nhất/giám khảo thật và đo khả năng hoàn thành lần đầu; chưa kết luận nghiệm thu khả năng sử dụng.
- [x] Triển khai thẻ bước tiếp theo theo trạng thái và nút chuyển đến thao tác; thu gọn cấu hình số đội/vòng/ván, giữ bản tóm tắt; mở lại khi validation lỗi. Đã kiểm tra mã và test trạng thái; chưa nghiệm thu trực quan.
- [ ] Kiểm chứng trực quan thẻ tiến độ/cấu hình thu gọn trên desktop/mobile và bàn phím. Trình duyệt trong đợt này còn hiển thị HTML cũ, trong khi HTTP trực tiếp trả HTML mới; chưa đủ bằng chứng nghiệm thu UI.
- [ ] Bổ sung trang kết quả chỉ đọc cho giám khảo/khách.

Nhật ký 19/10/2026 (tiếp TODO): dùng lại web cổng 3000; bổ sung web/tournament-progress.js và hướng dẫn 6 bước trong quản lý giải. Không tự kích hoạt nút nghiệp vụ khi chuyển đến thao tác. Test trạng thái bảo đảm không gợi ý bắt đầu loại trực tiếp trước khi chốt bài nộp lại; phân biệt tạm dừng/hủy/chờ duyệt/đã duyệt. npm test 115/115 đạt; kiểm tra cú pháp/diff đạt. Sau đó bổ sung tóm tắt cấu hình và tự mở phần cấu hình khi invalid, kiểm tra cú pháp đạt. Không chạy trận, đổi luật hoặc sửa giải đang có; không thêm dependency/migration. Kiểm chứng trực quan và người dùng thật còn mở.

Nhật ký 19/10/2026: rà cấu trúc, điều hướng, giao diện admin/portal, nộp bài, bảng điểm, replay và tài liệu; triển khai cải thiện trên. Dùng ui-ux-pro-max, giữ nguyên API/engine/dữ liệu giải. Báo cáo phạm vi, vấn đề và giới hạn: docs/RA-SOAT-TRAI-NGHIEM.md. Chưa chạy integration Docker, chưa nghiệm thu người dùng thật; không đánh dấu toàn bộ phổ cập là hoàn tất.

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
- [x] Chốt hướng quy mô: dưới 150 đội thực tế; sức chứa cấu hình được; 4.000 chỉ là thử tải mở rộng tùy chọn. Cập nhật 19/10/2026: chủ dự án mở lại D01, hạ tầng thiết kế cho 1.000 đội × 4 người, giải thật linh hoạt theo số đăng ký; giữa kỳ chạy 1 laptop.
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

- [x] Sửa giới hạn đăng nhập tính cả lần thành công: tách hạn mức tài khoản/IP trực tiếp (10/100 mặc định), giữ chỗ trước bcrypt và hoàn đúng lượt khi thành công; test nhiều tài khoản chung IP, lỗi cũ không bị xóa, giới hạn IP khi đổi tên và yêu cầu đồng thời qua hai app dùng cùng DB. npm test 118/118 đạt; chưa phải thử tải LAN thật.
- [x] Triển khai TRUSTED_PROXIES theo IP/CIDR, mặc định tắt; PUBLIC_ORIGIN cố định, xác thực cấu hình trước mở DB. Giới hạn đăng nhập dùng req.ip theo chuỗi tin cậy; test từ chối header giả từ socket không tin cậy và không chọn địa chỉ giả bên trái chuỗi.
- [x] Kiểm thử API với header proxy mô phỏng: Origin đúng/sai/null/cross-site, Host và X-Forwarded-Host giả, giao thức không khớp, cookie Secure/HttpOnly/SameSite; npm test 122/122 đạt.
- [ ] Nghiệm thu end-to-end qua Nginx/Cloudflare và HTTPS thật: proxy ghi đè header, chặn cổng Node, IP khách và đăng nhập/cookie trong trình duyệt; chưa cấu hình hạ tầng trong đợt này.
- [ ] Thay quy trình admin mặc định admin/admin bằng thông tin riêng trước khi mở giải; bổ sung đổi mật khẩu admin.
- [ ] Cấp thông tin đăng nhập riêng phù hợp cho giải thật; rà soát việc dùng username làm mật khẩu ban đầu.
- [ ] Đo và thiết kế lại tiếp nhận upload quanh giới hạn hiện tại 4 lượt đồng thời; bảo vệ RAM và có backpressure.
- [x] API đăng nhập trả Retry-After theo thời gian còn lại; nút đăng nhập có đếm ngược và cho thử lại sau hạn, không tự gửi lại mật khẩu. Mã frontend đã kiểm tra cú pháp; chưa kiểm chứng trực quan riêng trạng thái 429.
- [ ] Bổ sung Retry-After và khoảng chờ cho upload/các thao tác khác; kiểm chứng trực quan 429 đăng nhập.
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
- [x] Loại phụ thuộc Internet khỏi luồng LAN: giao diện chính và site kết quả không tải tài nguyên ngoài (npm run offline:check). Khu /legacy còn Google Fonts, không dùng trong giải; offline tự dùng font hệ thống.
- [ ] Cấu hình địa chỉ server LAN cố định, HOST, firewall và hướng dẫn truy cập. Đã có hướng dẫn (docs/RUNBOOK.md) và offline:check cảnh báo HOST; chưa cấu hình trên máy thi thật.
- [ ] Sao lưu nhất quán SQLite cùng mã nguồn, artifact, manifest image và phiên bản phần mềm. Đã có snapshot VACUUM INTO + bài nộp/artifact + phiên bản phần mềm và dấu engine; chưa ghi kèm image sandbox.
- [ ] Công cụ/quy trình kiểm tra và khôi phục backup trên máy khác. Đã có npm run restore (băm, integrity_check, foreign_key_check, giữ DB cũ) và quy trình trong RUNBOOK; mới kiểm chứng khôi phục sang thư mục khác trên cùng máy.
- [ ] Chuẩn bị máy dự phòng, lịch backup, người phụ trách chuyển máy; UPS cho server và thiết bị mạng nếu có điều kiện.
- [x] Khởi động lại không mất bài đã nhận, không tính thua do hạ tầng và không cộng điểm trùng: test:recovery kill tiến trình coordinator 2 lần giữa vòng, 36 ván và bảng điểm trùng khớp lần chạy không gián đoạn; việc dở của coordinator được trả về hàng đợi ngay khi khởi động.
- [ ] Diễn tập mất điện, mất mạng, đầy đĩa và hết dung lượng lưu trữ theo môi trường thử riêng. Đã tự động hóa kill tiến trình và chạy trong namespace không mạng; chưa thử rút điện máy thật, đầy đĩa.

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

- [x] Tách tiến trình điều phối, kiểm tra bài và chấm trận: coordinator (npm start) và grader agent (npm run grader); LOCAL_GRADING=0 để coordinator không tự chấm. Đấu thử admin và vòng điểm cũ vẫn chạy trên coordinator.
- [x] Chọn DB cho bản phân tán: giữ SQLite WAL ở coordinator, máy chấm không truy cập DB (quyết định 19/10/2026, không thêm PostgreSQL).
- [x] Chọn queue: dùng bảng lease SQLite có sẵn qua API coordinator; không thêm Redis/BullMQ.
- [x] API đăng ký/xác thực worker, phân quyền nhận việc và trả kết quả: khóa riêng mỗi máy, HMAC + timestamp + nonce lưu SQLite, thu hồi; mã giữ việc gắn với máy.
- [x] Phân phối source/artifact theo bài nộp (cache bất biến trên máy chấm) và image cố định (GRADER_IMAGE); không chia sẻ file SQLite. Chưa có manifest môi trường riêng.
- [x] Lease, heartbeat, thu hồi việc, giới hạn retry và chống kết quả trùng/đến muộn: test máy chết giữa việc, kết quả muộn, hai máy tranh việc, replay giả.
- [ ] Quản lý image có sẵn trên worker, tương thích kiến trúc CPU, CPU/RAM/disk và số slot. Hiện chỉ báo image và số slot; chưa kiểm kiến trúc/tài nguyên.
- [ ] Theo dõi worker online/offline, thời gian chờ, tỷ lệ lỗi và năng lực xử lý. Đã có online/lần liên lạc cuối/việc đang chạy; chưa có thời gian chờ và tỷ lệ lỗi.
- [x] Phase 2b: SandboxBackend chọn bằng SANDBOX_BACKEND; bwrap cho cùng mã lỗi với Docker trong distro WSL2 ott-grader; windows-job EXPERIMENTAL (Python); script build-rootfs/setup-grader.
- [ ] bwrap: giới hạn cgroup tổng RAM/PID và dung lượng tmpfs tương đương Docker (hiện chỉ rlimit + seccomp của supervisor).
- [x] windows-job: C++ bằng g++ có sẵn trên máy (Dev-C++/Code::Blocks/PATH/OTT_GXX) hoặc gói phụ add-cpp (WinLibs 12.2 rút gọn); test:windows-job có C++ (biên dịch, nước hợp lệ, lỗi biên dịch, crash, CPU, system()).
- [x] Quyết định mạng/file trên windows-job: không chặn; chỉ dùng cho lớp học có giám sát, kết quả ghi "không chính thức" (D13, D17).
- [ ] windows-job C++ trong thư mục có dấu tiếng Việt: g++ msvcrt không chạy, hiện chỉ báo lỗi rõ ràng (thử bản UCRT/manifest UTF-8 nếu cần).
- [ ] Chạy máy chấm WSL2 kết nối coordinator qua LAN thật (mới chạy coordinator và agent cùng trong distro).
- [ ] Benchmark nhiều máy với cấu hình khác nhau và kiểm tra công bằng giới hạn chạy.

Nghiệm thu: tắt một worker giữa trận, worker khác tiếp tục xử lý; dữ liệu và điểm vẫn nhất quán.

## P2 Công bố và đồng bộ

- [x] Trạng thái kết quả: bản nháp, đã duyệt, đã công bố; có người duyệt và dấu thời gian. Bản công bố lưu người/thời điểm/lý do, ghi "tạm tính" khi chưa duyệt đội đi tiếp.
- [x] Xuất snapshot kết quả công khai có mã phiên bản; không tính lại bảng điểm theo từng người xem (publications v1, v2… bất biến, site tĩnh).
- [x] Website công khai và cache/CDN đúng đường dẫn; không cache session hoặc dữ liệu cá nhân: deploy thật lên Cloudflare Pages (ott-ket-qua.pages.dev) 21/10/2026, cache latest 60 s / phiên bản immutable, không lộ email, _headers có CSP + X-Frame-Options (thêm sau lần deploy đầu). Đo tải: xem CAPACITY.md.
- [ ] Công bố trước thời điểm dự kiến có kết quả và giải thích trạng thái chờ.
- [x] Gói xuất offline gồm đội, bài nộp, luật, lịch, kết quả, replay, hash và phiên bản phần mềm: bundle đồng bộ (Phase 5b) gồm mọi bảng dữ liệu giải/hệ thống, file bài nộp và artifact, mã băm từng mảnh; hai máy phải cùng schema.
- [x] Import online có kiểm tra toàn vẹn, chống trùng và báo xung đột: chữ ký Ed25519, GCM + băm từng mảnh, bundle đã nhập bỏ qua, dòng từ máy không giữ quyền báo xung đột; test sync.
- [x] Quy định một nơi ghi dữ liệu chính thức tại một thời điểm; ghi nhận chuyển giao online/offline: quyền hệ thống và quyền từng giải, bàn giao trong bundle, máy kia chỉ đọc (không nhận bài, không chạy ván, chặn API sửa).

## P3 Git Google Sheets và trải nghiệm

- [x] Đăng ký repository gắn với tài khoản đội và xác minh quyền phù hợp: GitHub App chỉ đọc, repo Private, file ott-verify.txt, một repo chỉ thuộc một đội đã xác minh. Mới kiểm chứng với server GitHub giả.
- [x] Nộp commit cụ thể; lưu bản mã nguồn, commit ID, hash, thời điểm nhận và biên nhận (nút, tag ott-submit, commit lúc hết hạn).
- [x] Lấy repository theo hàng đợi có giới hạn; không chạy hook/build script của repo ngoài sandbox: zipball theo SHA, chỉ giải nén ott.json và bot/, chặn symlink, giới hạn 50 MB, backoff rate limit.
- [x] Có nộp file dự phòng và dùng chung pipeline; không coi tên tác giả commit là xác thực. Form upload có Turnstile tùy chọn.
- [x] Tạo GitHub App thật của BTC: ott-btc-nop-bai (Organization ott-btc, 21/10/2026) bằng scripts/github-app-manifest.js; đã kiểm qua API quyền chỉ contents/metadata read, sự kiện push; khóa trong thư mục secrets ngoài repo; start-server.ps1 tự nạp.
- [ ] Thử trọn luồng với repo GitHub thật của một đội (lưu repo, cài App, xác minh, Nộp commit mới nhất → Accepted).
- [ ] Bật webhook của App khi server có địa chỉ công khai (VPS hoặc Cloudflare Tunnel có tên) và thử tag ott-submit.
- [ ] Đo thời gian lấy commit hạn nộp và rate limit với nhiều repo thật; hiện 20 đội/10 giây chưa có số đo.
- [x] Xuất phiên bản kết quả đã duyệt lên Google Sheets; lỗi Sheets không làm mất kết quả gốc: ghi thật vào bảng tính của chủ dự án 21/10/2026 (3 tab, 1 lượt thử, dữ liệu đúng).
- [x] Bộ khởi động/đóng gói và tự kiểm tra môi trường cho giáo viên ít kinh nghiệm kỹ thuật. Gói lớp học portable (Node + Python 3.11 embeddable, start.bat) và trang /setup kiểm tra windows-job/g++/Docker; bài thử máy sạch tự động 51,5 giây (docs/LOP-HOC.md).
- [ ] Thử gói lớp học trên máy phòng lab thật (Deep Freeze, tài khoản không có quyền quản trị, máy cũ) và với giáo viên chưa từng dùng (mục tiêu ≤ 10 phút).
- [ ] Luồng thao tác rõ: khởi động → kiểm tra máy → tạo giải → nhập đội → mở/chốt bài → chạy giải → công bố.
- [x] Tài liệu Quy tắc và cách tổ chức giải trong mục Giải đấu của admin: giải thích thuật ngữ/thể thức, bảng cấu hình, 11 bước tạo/chạy giải, tính điểm/miễn đấu/hòa, trạng thái, lỗi thường gặp và giới hạn hiện có. Bản nguồn docs/QUY-TAC-GIAI-DAU.md; trang web có mục lục, mở tab mới và đọc được trên điện thoại.
- [x] Bot mẫu chạy ngay, bài hướng dẫn ngắn, giải thích lỗi và replay dễ hiểu: ott-run/chay-thu.bat chạy thử với bot mẫu, gợi ý lỗi tiếng Việt dùng chung (web/hints.js, đủ mọi mã lỗi), quét tĩnh chỉ ra dòng, replay có phím tắt/nhảy pha/bấm lịch sử, replay.html offline.
- [ ] Thử ott-run và bảng huy hiệu với học sinh thật (cách đọc gợi ý lỗi, có hiểu huy hiệu không).
- [ ] Diễn tập với người chưa biết Docker/Linux/DB và ghi lại điểm vướng.
- [x] Đánh giá USB boot đã tích hợp môi trường chấm: USB máy chấm dùng đúng rootfs/IMAGE_ID của máy chấm WSL/Docker, chấm thật trong QEMU (Phase 7). Docker vẫn là mặc định cho coordinator.
- [ ] USB boot trên máy thật: Secure Boot theo hãng, phím boot, USB-C/USB SSD, GPU rời, Wi-Fi thật, ghi hàng loạt USB, 30–100 máy cùng lúc (việc của BTC theo D15).

## Nâng cấp theo nhận xét của thầy (8 phase)

Nguồn: yêu cầu ngày 19/10/2026; quyết định chốt trong docs/TOURNAMENT-REQUIREMENTS.md (D01, D09–D14).

- [x] Bước 0: đối chiếu yêu cầu với mã hiện tại, chốt mâu thuẫn và quyết định với chủ dự án.
- [x] Phase 1 – nộp bằng GitHub (code + test tự động + kiểm chứng trình duyệt/Docker với GitHub giả); chưa thử GitHub thật (xem mục P3).
- [x] Phase 2a – coordinator + grader agent, HMAC, lease/heartbeat, admin quản lý máy chấm (test tự động + Docker thật).
- [x] Phase 2b – SandboxBackend (docker/bwrap/windows-job), rootfs WSL2 dựng từ image sandbox (test tự động trên Docker, WSL2 và Windows).
- [x] Phase 3a – RuleSet dữ liệu hóa (tileTypes/tiles/tileSpawns/onMoveLimit), effect registry wildcard/shield/dash, state.tiles + piece.effect, changes trong replay, 3 bộ luật mẫu, bot mẫu cập nhật.
- [x] Phase 3b – giao diện vẽ theo bảng render của RuleSet, replay áp changes (replay cũ giữ cách mô phỏng), trình chỉnh luật có công cụ theo loại ô + JSON nâng cao, mô tả luật thí sinh sinh từ JSON.
- [x] Phase 4 – bản công bố bất biến (thủ công/lịch/tạm hoãn), site tĩnh + mã tra cứu đội, đồng bộ Google Sheets, lệnh deploy Pages; test tự động + trình duyệt + đo 4000 lượt đọc.
- [x] Phase 4 – deploy Cloudflare Pages thật (21/10/2026, giải mẫu trong DB tạm, wrangler 3.80.0, 21 file).
- [x] Phase 4 – đồng bộ Google Sheets thật (21/10/2026, service account + bảng tính của chủ dự án).
- [x] Vòng loại Swiss hỗ trợ 1.000 đội (hướng a do chủ dự án chọn): ghép theo khối 256 hạng liên tiếp, giới hạn mới 4.000; ≤256 đội giữ nguyên cách ghép. Test 1.000 đội × 8 lượt; bench vòng loại 1.000 đội chạy thật (ván giả).
- [x] Phase 5a – chạy LAN không Internet, nhập bài dự phòng từ thư mục/USB (giao diện + CLI), snapshot định kỳ ra ổ ngoài, khôi phục, tự chạy tiếp sau mất điện; test tự động (kill coordinator, cắt mạng bằng network namespace).
- [x] Phase 5b – đồng bộ bundle local ↔ online (JSONL, Ed25519, AES-256-GCM passphrase, một máy giữ quyền ghi mỗi giải + quyền hệ thống), giao diện + CLI.
- [ ] Đồng bộ thật giữa hai máy vật lý qua USB (mới kiểm chứng hai DB trên cùng máy).
- [x] Phase 6a – gói lớp học portable (OTTv2-lop-hoc.zip 45,9 MB + OTTv2-add-cpp.zip 41 MB), trang cài đặt lần đầu (chỉ localhost, tự khóa), mức tin cậy lớp học/chính thức, windows-job C++, data/settings.json, start.bat tự khởi động lại; test tự động + bài thử máy sạch.
- [x] Phase 6b – ott-run + chay-thu.bat (Job Object, fallback chạy trực tiếp báo CPU ước lượng), replay.html tự chứa, gợi ý lỗi dùng chung portal/CLI, replay phím tắt + nhảy pha + bấm lịch sử (admin/portal, site công khai, replay.html), biến động hạng và 4 huy hiệu (portal, admin, site, bản công bố); test tự động + trình duyệt + máy sạch.
- [x] Phase 7a – đăng ký máy chấm bằng mã theo đợt (migration 22, mở/đóng ở admin, khóa riêng mỗi máy, giữ trong RAM), file OTTCONF (grader.env/portal.env, chịu được Notepad), luật tường lửa và chính sách Firefox sinh từ cấu hình; test tự động.
- [x] Phase 7b – USB máy chấm và máy thí sinh dựng từ rootfs máy chấm (usb/build.sh trong distro ott-build), BIOS + UEFI Secure Boot, OTTCONF + persistence ~/bai-lam, bản --with-wifi; kiểm chứng QEMU (usb/boot-test.js): chấm bài thật, tường lửa, Firefox, desktop, ott-run, lưu bài qua 2 lần khởi động, ổ của máy không bị mount/ghi.
- [ ] Phase 7 – thử USB trên máy thật (xem mục P3).
- [x] Phase 8 – thử tải 1.000 đội × 3 lần nộp, red team, bộ tài liệu (kiểm chứng trên 1 laptop + QEMU):
  - [x] Thử tải scripts/load-test.js (WSL ott-build): 4.000 đăng nhập, 3.000 bài nộp sát hạn, 4.000 người xem, vòng loại 1.000 đội × 8 lượt (máy chấm giả qua HMAC thật), công bố + 4.000 lượt đọc site. Lần cuối: 0 lỗi, biên nhận p95 1,0 s, bảng vòng loại p95 0,29 s, health max 1,3 s.
  - [x] Sửa nhờ thử tải: giới hạn đăng nhập theo IP; scrypt thay bcryptjs; 32 upload cùng lúc; cache bảng xếp hạng + view portal serialize/gzip 2 s; settle() chỉ xét cặp vừa xong; gzip JSON; keep-alive 65 s; đếm entrants bằng COUNT.
  - [x] Đo ván thật sandbox bwrap (scripts/load-real-games.js): 1,6 giây-luồng/ván, 5,2 giây-luồng/bài kiểm tra (bot mẫu); bảng tính số máy chấm trong CAPACITY.md.
  - [x] Red team: bwrap tmpfs giới hạn 16/64 MB (fixture disk, test:bwrap 4/4); khóa GRUB PBKDF2 đạt trên cả hai ảnh, UEFI Secure Boot và BIOS; test/redteam.test.js; RED-TEAM.md.
  - [x] Tài liệu: FORMAT, ANNOUNCEMENT, RACI, RUNBOOK, RISKS, CAPACITY, RED-TEAM; QUY-TAC mục 8 + trang hướng dẫn admin dựng lại; README/CAI-DAT/SWISS/USB-BOOT/TOURNAMENT-REQUIREMENTS cập nhật.
- [x] Site công khai trên Cloudflare Pages thật (21/10/2026, site 1.000 đội): 4.000 request qua 64 kết nối p95 0,13–0,17 s, không có lỗi HTTP từ Cloudflare. Từ máy chủ OTTv2 4.000 lượt dồn cùng lúc vẫn p95 4,0 s: giải lớn dùng Pages.
- [ ] Đo site công khai từ nhiều nơi cùng lúc (một máy chỉ mở được khoảng 760/4.000 kết nối mới cùng lúc vì nghẽn mạng phía máy đo).
- [ ] deploy.js gọi npx qua shell trên Windows: Node 24 báo DEP0190 (tham số không được escape); đổi sang gọi npx.cmd trực tiếp không qua shell.
- [ ] Đo thử tải trên VPS/Cloudflare Tunnel thật và với bot thật của thí sinh (số hiện tại là laptop + bot mẫu).
- [ ] Fixture ghi đầy đĩa (disk) với backend Docker (mới chạy bwrap).

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
- [x] Máy chủ thử nghiệm cho nhóm (21/10/2026): VPS 1 vCPU/1 GB dùng chung với app khác, Ubuntu 24.04, Docker + sandbox:check đạt (Landlock ABI 4, seccomp), Node 24 riêng ở /opt/node24, dịch vụ systemd ott ở 127.0.0.1:3100 (BOT_WORKERS=1, COOKIE_SECURE=true), swap 2 GB, mở ra Internet bằng Tailscale Funnel (link .ts.net cố định). Admin tạo qua /setup bằng đường hầm SSH; /setup từ ngoài trả 409.
- [ ] Sau Tailscale Funnel mọi request đến từ 127.0.0.1: giới hạn đăng nhập theo IP (10× loginMax) dùng chung cho cả nhóm. Đủ cho nhóm nhỏ thử; trước khi mở rộng cần đọc IP thật từ proxy tin cậy.
- [ ] Chuẩn bị PostgreSQL nếu chọn kiến trúc phân tán.
- [ ] Chuẩn bị Redis/BullMQ chỉ nếu chọn phương án queue này.
- [ ] Chuẩn bị nơi lưu artifact dùng chung hoặc API tải artifact; MinIO/object storage là tùy chọn.
- [ ] Chuẩn bị Google Cloud project, quyền Sheets API và danh tính truy cập khi làm tích hợp Sheets.
- [ ] Chuẩn bị Git hosting và thông tin truy cập giới hạn quyền khi làm tích hợp Git. Mã đã hỗ trợ GitHub App (docs/GITHUB.md); App thật chưa tạo. Gitea cho LAN thuộc Phase 5.
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

- 21/10/2026: Gộp nhánh test (4 commit của thành viên nhóm: cấu hình proxy TRUSTED_PROXIES/PUBLIC_ORIGIN, giới hạn đăng nhập theo IP thật, xóa bộ luật + migration 23, trình chỉnh power-up, mục Bắt đầu, thẻ việc tiếp theo) vào thu-nghiem (ae01a51). Xung đột web/index.html, web/rules.js lấy bản test. Điểm lùi: tag local backup/thu-nghiem-truoc-gop (aea00f0). Kiểm tra trên bản gộp: npm test 181/181, test:sandbox 5/5, test:stages 1/1, test:rulesets 1/1. Triển khai máy chủ thử: sao lưu data/ trước khi cập nhật, migration lên 23, thêm TRUSTED_PROXIES=127.0.0.1 và PUBLIC_ORIGIN; qua link công khai đăng nhập sai trả 401 (không còn 403), login_limits ghi IP thật của người dùng thay vì 127.0.0.1; /portal, /admin, /site/ 200; /api/setup 409. Chưa kiểm tra giao diện mới trên trình duyệt.

- 21/10/2026: Dựng máy chủ thử nghiệm trên VPS của bạn trong nhóm (được chủ dự án đồng ý từng bước): script E:/OTTv2-local/tools/inet-setup.sh (base, node, app, sandbox, service, tailscale, funnel). sandbox:check trên VPS: Landlock ABI 4, seccomp, passwd_denied. Từ ngoài: /portal 200, /admin 200, /site/ 200, /setup 302, /api/setup 409, có CSP và X-Frame-Options. App sẵn có của chủ VPS (cổng 3000) vẫn chạy; tắt accept-dns của Tailscale để không đổi DNS của VPS. DNS công khai của Funnel: AAAA có trước, A có sau khoảng 15 phút. Chưa cho nhóm đăng nhập và chạy ván thật trên VPS.

- 21/10/2026: Viết lại README (mục lục, tính năng, công nghệ, sơ đồ Mermaid, cây thư mục, lệnh npm, năng lực đã đo, bảng tài liệu theo vai trò). Kiểm tra mọi liên kết tương đối trong README tồn tại; npm test 165/165. Thêm /.wrangler/ vào .gitignore. Giữ nguyên cấu trúc thư mục (di chuyển sẽ làm gãy đường dẫn trong mã, test, tài liệu). Commit toàn bộ lên nhánh thu-nghiem, không đụng main.

- 21/10/2026: Đo tải Cloudflare Pages thật (được chủ dự án đồng ý). Đẩy giải mẫu 1.000 đội (scripts/bench-publish.js, 1.017 file) lên ott-ket-qua.pages.dev; đo từ WSL bằng E:/OTTv2-local/tools/load-pages.js. 4.000 kết nối mới cùng lúc: chỉ 758 thành công, phần còn lại timeout kết nối phía máy đo, Cloudflare không trả lỗi HTTP. 64 kết nối dùng lại: lượt 1 p95 129 ms (1 request treo 51 s), lượt 2 4.000 request 4,9 s, p95 173 ms, 15 ETIMEDOUT. Sau đó đẩy lại giải mẫu 6 đội (Pages + Sheets). Ghi nhận cảnh báo DEP0190 của deploy.js.

- 21/10/2026: Chủ dự án lập Organization ott-btc. Tạo GitHub App ott-btc-nop-bai bằng luồng App manifest (scripts/github-app-manifest.js): một cú bấm trên GitHub, khóa lưu thẳng vào thư mục secrets, không in ra. Kiểm bằng JWT của App: quyền contents:read + metadata:read, sự kiện push, 0 nơi cài. Webhook để tắt (chưa có địa chỉ công khai). start-server.ps1 nạp GITHUB_APP_ID/PRIVATE_KEY_PATH/SLUG/WEBHOOK_SECRET; khởi động thử cổng 3999 thấy cả GitHub, Pages, Sheets. Chưa thử với repo thật của đội.

- 21/10/2026: Cấu hình Cloudflare Pages và Google Sheets với tài khoản thật của chủ dự án. Khóa nằm ở E:/OTTv2-local/secrets (ngoài repo, chỉ tài khoản Windows của chủ dự án đọc được; không ghi vào tài liệu). Token Cloudflare chỉ có quyền Pages: Edit; project ott-ket-qua tạo bằng API. Kiểm chứng bằng giải mẫu 6 đội trong DB tạm E:/OTTv2-local/realtest (E:/OTTv2-local/tools/real-publish-test.js): Sheets ghi 3 tab ngay lần đầu; Pages đẩy 21 file, đọc lại manifest từ Internet, trang hiển thị đúng ở 390 px, replay mở được, không có email trong file công khai. Phát hiện trang trên Pages thiếu CSP/X-Frame-Options (Cloudflare chỉ gửi header trong _headers) → thêm vào _headers, deploy lại và xác nhận header + không lỗi CSP. Thêm scripts/start-server.ps1 (UTF-8 có BOM để PowerShell 5.1 đọc đúng tiếng Việt), chạy thử cổng 3999. Trên ott-ket-qua.pages.dev hiện là dữ liệu giải mẫu.

- 20/10/2026: Hoàn thành Phase 8. Tìm nguyên nhân máy chủ đứng 48–55 s trong vòng loại bằng --cpu-prof: không có tác vụ đồng bộ dài (đoạn bận liền dài nhất 2,1 s) mà là quá tải luồng chính (cửa sổ 60 s bận 58,7 s): JSON.stringify bảng ~150 KB mỗi lượt xem, tính lại xếp hạng mỗi khi một cặp xong, settle() đọc lại mọi ván kèm replay. Sửa: view portal dựng lại tối đa 2 s/lần đã serialize + gzip, settle() theo cặp với json_extract. Lần chạy cuối (output/load/2026-10-20T15-42-43-268Z.json): 4.000/4.000 đăng nhập, 3.000/3.000 biên nhận p95 1,0 s, 304.201 lượt xem bảng p95 0,29 s, 0 lỗi mạng/5xx, health max 1,3 s, vòng loại 8.000 ván 244 s, ghép cặp 2,1–5,2 s, DB 231 MB; site 4.000 lượt dồn cùng lúc p95 4,0 s (chưa đạt). Ván thật bwrap (output/load/2026-10-20T15-47-10-636Z-real-games.json): 200 ván 79 s với 4 luồng, 40/40 Accepted. Dựng lại 3 ảnh USB có khóa GRUB; usb:test --grub-lock đạt UEFI + BIOS cả hai ảnh, test khởi động đầy đủ vẫn đạt. Sửa CAPACITY: số Phase 4 site tĩnh là p95 2,2 s (trước đó ghi nhầm dưới 1 s). npm test 165/165, test:bwrap 4/4. Chưa thử VPS/Cloudflare thật, máy thật, bot thật.

- 20/10/2026: Phase 8 đang làm, tạm dừng theo yêu cầu. Đã sửa và đo (WSL ott-build, i5-11400H 12 luồng, 8 GB): giới hạn đăng nhập theo IP chặn 3.990/4.000 lượt (sửa: đăng nhập đúng trả lượt); bcryptjs 4.000 lượt 950 s, server không phản hồi (sửa: scrypt, 105 s); upload 4 lượt cùng lúc làm biên nhận p95 111 s (sửa: 32, p95 0,74 s); bảng 1.000 đội 15 ms + 349 KB mỗi lượt xem (sửa: cache, rút gọn, gzip; 2,4 ms); bwrap tmpfs không giới hạn 616 MB/nước (sửa: --size). npm test 165/165. Chưa xong: tác vụ chặn ~48 s trong vòng loại (đang profile), vòng loại 8 lượt + site, ván thật sandbox, GRUB lock test, CAPACITY.md. Chưa commit.

- 20/10/2026: Hoàn thành Phase 7 trong QEMU (D15). 7a: migration 22 (grader_enrollments, graders.enrollment_id), GraderService.openEnrollment/enroll/closeEnrollment, POST /api/graders/enroll, khối "Đăng ký máy chấm USB" ở admin, scripts/grader.js đọc GRADER_CONFIG_FILE + GRADER_CREDENTIALS_FILE, src/usb/config.js (parseEnv chịu BOM/CRLF, IPv4 bắt buộc cho portal, nftables, Firefox policy, Wi-Fi), scripts/usb-config.js, scripts/usb-clock.js; test/usb.test.js. 7b: distro WSL ott-build trên E: (từ ott-grader.tar), usb/build.sh dựng squashfs + GRUB BIOS + shim/GRUB ký (gcdx64) + ảnh MBR 4 phân vùng; usb/boot-test.js chạy coordinator thật + QEMU (OVMF khóa Microsoft, SeaBIOS) với ổ INTERNAL giả lập. Kết quả: máy chấm UEFI SB và BIOS kết nối sau 14–18 giây, bài Python Accepted bằng bwrap trên USB, giờ lệch 6 năm được chỉnh; máy thí sinh UEFI SB, BIOS và bản -wifi: portal 200, Internet/cổng khác/DNS bị chặn, Firefox tải được /portal, XFCE chạy, không sudo, root khóa, ott-run 0, ~/bai-lam còn sau khởi động lại, ổ INTERNAL không đổi. Lỗi tìm thấy khi thử: sed bỏ CR làm hỏng file node, rsync --exclude dist bỏ mất node_modules/*/dist, quyền 777 từ ổ Windows, kernel 6.1 thiếu Landlock ABI 3 (dùng backports 6.12), serial getty làm mất output tự kiểm tra, live-boot mount ổ của máy khi tìm persistence (thêm persistence-storage=filesystem), Firefox chặn cả portal vì ngoại lệ có cổng, dữ liệu chưa kịp ghi khi tắt máy (dirty_expire 2 giây). Ảnh: ott-grader.img 376 MiB, ott-thisinh.img 1.591 MiB, ott-thisinh-wifi.img 1.679 MiB ở E:/OTTv2-local/usb. npm test đạt. Chưa thử máy thật.

- 20/10/2026: Hoàn thành Phase 6b (D17: Bất bại ≥3 trận không thua, chuỗi thắng chỉ khi đang còn, loại trực tiếp không có huy hiệu, ott-run dùng Job Object rồi fallback). Mã: scripts/ott-run.js, src/replay-html.js, web/hints.js, web/replay-nav.js, web-public/viewer.js (tách từ public.js), progress() trong swiss-pairing.js, migration 21 (swiss_games.fault_user, điền ngược từ replay), WindowsJobManager({direct}), quét tĩnh theo dòng. Test: npm test 153/153 (thêm classroom-ux.test.js: mọi mã lỗi có gợi ý, số dòng quét tĩnh, biến động hạng/huy hiệu đối chiếu định nghĩa trên 40 mùa giả, replay.html không gọi mạng và không bị phá thẻ script; swiss.test kiểm fault_user + Bot mẫu mực); test:ott-run 4/4 (Python: mẫu, crash, vòng lặp, nước sai, in thừa, import cấm với tên file có dấu cách; C++ khi có g++); test:windows-job đạt. Trình duyệt (E:/OTTv2-local/tools/ui-phase6b.js, ui-replay-html.js): cột ±/huy hiệu/chú thích ở admin, portal 390 px, site công khai; phím tắt, nút pha, bấm lịch sử ở replay admin và site; replay.html mở từ file với mạng bị chặn: 0 yêu cầu ra ngoài, 0 lỗi. Máy sạch: chay-thu.bat ra 2 ván + replay.html sau 26,4 giây. Gói OTTv2-lop-hoc.zip 46,0 MB. Chưa thử với học sinh thật.

- 20/10/2026: Hoàn thành Phase 6a (D13 C++, D17 đối tượng THCS/THPT). Mã: src/settings.js (data/settings.json, biến môi trường ưu tiên), src/setup.js + web/setup.* (trang /setup chỉ mở khi chưa có admin, chỉ nhận kết nối loopback với Host 127.0.0.1/localhost, chặn Origin/Sec-Fetch-Site khác nguồn; tạo admin, nhập CSV lớp, tạo "Giải luyện tập", ghi mức tin cậy, thoát mã 75 để start.bat chạy lại), windows-job dò python/g++ trong gói, jobrun --processes cho trình biên dịch, scripts/package-classroom.js. Tải và kiểm tra: Python 3.11.9 embeddable (chữ ký Authenticode PSF hợp lệ), json.hpp 3.11.2 (sha256 khớp release), WinLibs GCC 12.2 msvcrt r5 (sha256 khớp file .sha256 của release); lưu ở E:/OTTv2-local/downloads. Phát hiện khi thử: chcp 65001 trong .bat làm hỏng đường dẫn có dấu (đã bỏ), tar.exe không nhận đường dẫn có dấu (dùng cwd), g++ msvcrt không chạy trong thư mục có dấu (báo lỗi rõ). npm test 148/148; test:windows-job (có g++) 3 đạt + 1 bỏ qua đúng điều kiện. Bài thử máy sạch (E:/OTTv2-local/tools/clean-phase6a.js, PATH chỉ còn Windows): thư mục lop10a, Python Accepted 22,3 giây, C++ Accepted 51,5 giây; thư mục "Tin học 10A" Python Accepted, C++ báo cần thư mục không dấu. Chưa thử máy phòng lab thật/người thật.

- 20/10/2026: Hoàn thành Phase 5b (D16). Migration 20 (sync_identity Ed25519, sync_peers, sync_authority, sync_state, sync_bundles). src/sync/bundle.js: bundle thư mục manifest ký + chunks JSONL ≤50 MB + file bài nộp, AES-256-GCM/scrypt; nhập trong một transaction với defer_foreign_keys + foreign_key_check, chỉ nhận thay đổi từ máy giữ quyền, ghi file sau khi nhận dòng, idempotent theo mã bundle. Không dùng dải ID (schema không có AUTOINCREMENT): dữ liệu hệ thống một máy ghi, nhật ký/bản công bố theo khóa tự nhiên. src/sync/authority.js + middleware chỉ đọc, bộ nhận việc 3 runner, nhận bài, lịch công bố tôn trọng quyền. Lỗi phát hiện khi test: trigger chặn chèn bot vào giai đoạn đã chốt (đổi thứ tự nạp), khóa tra cứu tạo lười sau khi xuất (tạo ngay khi khởi động), bộ luật mẫu khác created_at (bỏ khỏi so sánh). npm test 145/145; test sync: online → LAN (khởi tạo, bàn giao) → online giống hệt, sửa byte/giả manifest/sai passphrase/máy lạ bị từ chối, nhập lại không đổi, máy hết quyền chỉ gây xung đột. Kiểm chứng CLI + trình duyệt (E:/OTTv2-local/tools/ui-phase5b.js): ghép cặp, khởi tạo LAN bằng CLI 0 xung đột, quyền hiển thị đúng hai bên, portal online báo chỉ đọc; 390 px không tràn. Chưa thử hai máy vật lý.

- 20/10/2026: Hoàn thành Phase 5a. src/intake/folder.js (thư mục/USB: <đội>/ott.json+bot/, <đội>.zip, <đội>.py/.cpp; trùng nội dung không tạo bản mới; thời điểm nhận tại bàn BTC phải trong cửa sổ nộp; ghi nhật ký giải) + giao diện + npm run import:folder; submit() nhận receivedAt/origin. src/backup/snapshots.js: VACUUM INTO + kho bài nộp đã xong chép một lần + upload bài đang chờ, .partial khi mất điện bị bỏ, giữ N bản; npm run restore kiểm tra băm/integrity/foreign key, mở snapshot chỉ đọc (sửa lỗi: openDatabase từng ghi vào snapshot), giữ DB cũ. Khởi động lại trả ngay việc dở của coordinator về hàng đợi (máy chấm từ xa vẫn chờ lease). npm run offline:check. docs/RUNBOOK.md. Test: npm test 144/144; test:recovery (kill 2 lần, kết quả trùng khớp); test/offline.integration.js chạy trong bwrap --unshare-net ở distro ott-grader với sandbox bwrap thật: đăng nhập portal, nộp Python, nhập C++ từ USB, cả hai Accepted, snapshot, công bố, /site/, offline:check không lỗi; trên máy có Internet test tự bỏ qua. Trình duyệt (E:/OTTv2-local/tools/ui-phase5a.js): chụp snapshot, nhập USB, nhập lại báo đã có; 390 px không tràn. Docker Desktop đang tắt trên máy này nên không chạy lại các test Docker trong đợt này.

- 20/10/2026: Bỏ giới hạn 256 đội của vòng loại theo hướng (a): src/swiss-pairing.js ghép theo khối 256 hạng liên tiếp, mỗi khối dùng tìm kiếm quay lui cũ (≤256 đội kết quả trùng cách ghép một khối — có test), khối bế tắc gộp khối kế tiếp, giới hạn tìm kiếm tính theo khối; swiss.js nhận 2–4.000 bot. Đo: 256 đội 0,3 s/lượt, 1.000 đội ~1 s/lượt, 4.000 đội ~4,5 s/lượt (10 lượt, không lỗi). Test thêm: 1.000 đội × 8 lượt không tái đấu/lặp miễn đấu, cặp gần hạng, tất định; khối bế tắc tự gộp. npm test 142/142. bench:publish giải 1.000 đội chơi thật (ván giả): vòng loại 90 s, site 1.014 file/~1 MB, 4000 lượt đọc (bể 200 kết nối trên Windows) 0 lỗi, p95 1,2 s. Chưa đo với máy chấm thật. Chưa commit theo yêu cầu (chủ dự án test sau khi xong các phase); tiếp theo là Phase 5.

- 20/10/2026: Hoàn thành Phase 4 (migration 19: app_secrets, publications bất biến, publication_schedules/controls, sheet_syncs, site_deploys). src/publish/: snapshot công khai (bỏ thông tin thành viên, mã bài, hash, stderr, userdata), dựng site tĩnh (manifest/latest/v<N>/team/_headers, tách replay theo lượt khi vượt giới hạn), SheetsClient JWT service account + backoff 429 + tự tạo tab, deploy Pages qua npx wrangler (Bị chặn khi thiếu biến). Lịch công bố bị bỏ qua khi tạm hoãn; mã tra cứu HMAC với khóa lưu trong DB. Giao diện admin mục Công bố, mã tra cứu ở portal, site web-public/ xem tại /site/. npm test 140/140 (thêm 5 test). Trình duyệt (E:/OTTv2-local/tools/ui-phase4.js): công bố, đặt lịch, tạm hoãn, deploy báo chưa cấu hình; site hiển thị bảng điểm, sơ đồ, xem ván (vẽ ô hiệu ứng), tra cứu bằng mã; không chứa email riêng; 390 px không tràn. Bench (npm run bench:publish): phát hiện vòng loại giới hạn 256 đội; site 1.000 đội (nhân bản từ giải 256 đội thật) 1.016 file/1,08 MB; 4000 lượt đọc đồng thời: Linux 0 lỗi p95 2,2 s; Windows từ chối >~230 kết nối chờ nên đo qua bể 200 kết nối: 0 lỗi p95 1,5 s. Chưa có số đo Cloudflare/Sheets thật.

- 19/10/2026: Hoàn thành Phase 3b. web/tiles.js vẽ ô/hiệu ứng theo render của RuleSet (loại lạ có ô xám dấu ?); replay áp changes và ghi chú ăn quân/vỡ khiên/lướt/nhặt ô; trình chỉnh luật sinh nút công cụ từ tileTypes, đánh dấu vùng rải, chặn đặt ô trên vị trí quân, khóa power-up cũ khi có tileTypes; mô tả luật portal sinh từ JSON. Kiểm chứng trình duyệt với Docker thật (script E:/OTTv2-local/tools/ui-phase3b.js): thêm loại ô "bùn" chỉ bằng JSON, lưu, chạy trận Python vs C++; bàn cờ vẽ khớp engine ở cả 89 lượt (lệch 0), trận classic 75/75 lượt kể cả khi bỏ changes như replay cũ; 390 px không tràn. Ảnh output/playwright/rules-tiles-editor.png, replay-tiles-*.png. npm test 135/135.

- 19/10/2026: Thêm dấu phiên bản engine (src/grader/version.js) vào yêu cầu nhận việc; coordinator từ chối máy chấm lệch phiên bản (test grader 4/4). Dựng lại rootfs và distro ott-grader bằng mã Phase 3a tại E:OTTv2-local; dấu khớp giữa Windows, rootfs và WSL. Sửa lỗi setup-grader.ps1: $PSScriptRoot rỗng trong giá trị mặc định param của PowerShell 5.1 (lỗi do đợt chuyển sang ổ E, lần trước kiểm tra bằng biến giả lập nên không phát hiện).
- 19/10/2026: Hoàn thành Phase 3a theo D12 và các điểm chốt (một hiệu ứng/quân, nhặt ô mới thì thay; Dash theo hướng đơn vị, chỉ ăn theo RPS thường, không vào nhà; material 1 điểm/quân, bằng thì hòa; ô rải 1–2 cặp đối xứng qua tâm, không trùng nhà/vị trí xuất phát). src/game/tiles.js (validate, rải ô, effect registry), engine ghi changes mỗi lượt và verifyReplay đối chiếu; luật cũ không có tileTypes giữ nguyên snapshot. rules/obstacles.json, rules/powerups.json nạp sẵn cùng classic. npm test 135/135 (thêm 10 test: validate, đối xứng/tất định, nhặt/thay hiệu ứng, wildcard, shield, dash, material, loại ô mới chỉ bằng JSON, changes bị sửa thì không qua, replay cũ vẫn qua). test:rulesets: bot mẫu Python/C++ chơi cả 3 bộ luật trên Docker và bwrap cho kết quả giống hệt (cùng số nước). test:templates, test:rules, test:sandbox Docker đạt. Giao diện chưa đổi (3b).

- 19/10/2026: Hoàn thành Phase 2b. Tách DockerSession thành phần giao tiếp supervisor dùng chung; thêm src/sandbox/bwrap.js, src/sandbox/windows-job.js + sandbox/windows/jobrun.cs (biên dịch bằng csc.exe có sẵn), factory SANDBOX_BACKEND. Phát hiện giới hạn CPU theo tiến trình của Job Object chỉ cắt thưa (giới hạn 0,3 s cắt ở 1,5 s; 0,6 s cắt ở 6,1 s) nên helper đo accounting mỗi 10 ms; sau sửa cắt ở 203/515 ms. Build rootfs từ image sandbox sha256:9770f940…, import distro ott-grader bằng setup-grader.ps1 (đã được chủ dự án đồng ý): probe Landlock ABI 3/seccomp/passwd denied; test:bwrap 4 đạt + 1 bỏ qua (kiểm tra container Docker), 8 fixture cùng mã lỗi với Docker; test:grader với bwrap đạt. Trên Windows: test:windows-job 3 đạt + 2 todo (C++, mạng/file); npm test 125/125, test:sandbox/test:grader/test:pipeline/test:stages Docker đạt sau refactor. Chưa thử máy chấm WSL2 qua LAN thật.

- 19/10/2026: Hoàn thành Phase 2a máy chấm phân tán, migration 18 (graders, grader_nonces). Tách vòng loại/loại trực tiếp/kiểm tra bài thành claim–job–heartbeat–finish–fail dùng chung cho chấm cục bộ và máy từ xa; gom phần chạy ván trùng lặp vào src/grader/play.js, kiểm tra bài vào src/submissions/check.js. API /api/grader/* ký HMAC, coordinator kiểm replay khớp seed/luật/bot rồi verifyReplay. npm test 125/125 (thêm 4 test phân tán); test:grader Docker thật: 2 máy chấm, bot Python/C++ Accepted, 5 tấn công lúc chạy bị chặn (network/passwd/fork/memory → bot_crash, loop → cpu_timeout), vòng loại chạy bằng artifact truyền qua mạng; test:pipeline và test:stages đạt. Trình duyệt: tạo máy chấm, lệnh chạy hiện một lần, agent kết nối, thu hồi; 390 px không tràn (output/playwright/graders-admin.png). Chạy thử npm start (LOCAL_GRADING=0) + npm run grader bằng tiến trình thật. Chưa đo năng lực nhiều máy thật.

- 19/10/2026: Hoàn thành Phase 1 nộp bằng GitHub, migration 17 (team_profiles, team_repos, repo_pushes, repo_snapshots, cột commit trên bot_submissions). GitHub App bằng JWT RS256 node:crypto + fetch, không thêm dependency; CSV đội; xác minh repo; nút/tag/webhook HMAC; lấy commit lúc hết hạn và chặn chốt bot khi chưa xong; zipball chỉ giải nén ott.json + bot/; Turnstile tùy chọn. npm test 121/121 (thêm 10 test với server GitHub giả: giả mạo repo, repo public, symlink/hook/.., SHA sau hạn, trùng delivery, rate limit, cùng SHA hai đội); test:pipeline và test:stages Docker đạt. Trình duyệt (playwright-core trong scratchpad, Chromium có sẵn): đội khai thành viên, lưu/xác minh repo, nộp commit Accepted qua Docker thật; admin thấy bảng repo; desktop và 390 px không tràn. Ảnh output/playwright/github-*.png. Sửa lỗi thông báo xác minh bị ghi đè khi kiểm tra. Chưa thử GitHub App/webhook thật.

- 19/10/2026 (tiếp P0 proxy): thêm src/http-config.js, TRUSTED_PROXIES/PUBLIC_ORIGIN vào server; từ chối trust-all/số hop/dải /0, Origin có path/query/credentials và HTTPS thiếu COOKIE_SECURE. Mặc định không tin proxy. Express xác định IP/giao thức theo proxy tin cậy; Origin dùng địa chỉ cố định, không dựa vào X-Forwarded-Host. Kiểm thử header mô phỏng và cấu hình: npm test 122/122 đạt; cú pháp/diff đạt. Cập nhật README, hướng dẫn cài và DEPLOYMENT với ví dụ proxy ghi đè header. Không deploy, đổi proxy/firewall, sửa DB hoặc dừng server cổng 3000; backend mới nạp ở lần khởi động lại tiếp theo. Nginx/Cloudflare/TLS và hành vi cookie trong trình duyệt thật chưa nghiệm thu.

- 19/10/2026 (tiếp P0 mạng): sửa giới hạn đăng nhập trong src/app.js, mặc định 10/tài khoản và 100/IP socket trong 15 phút; giữ chỗ đồng bộ trước bcrypt, hoàn đúng một lượt cho yêu cầu thành công và đúng cửa sổ hết hạn. Giữ các lỗi cũ, không tin X-Forwarded-For để đổi IP. Retry-After theo thời gian còn lại và JSON retryAfter. Thêm 3 test API cho đăng nhập chung mạng, giới hạn IP/đổi tên/header giả/thời gian còn lại và đồng thời qua hai app chung DB; npm test 118/118 đạt ngoài sandbox. Sau đó thêm nút đăng nhập đếm ngược, không tự retry mật khẩu; kiểm tra cú pháp frontend/backend và diff đạt. Cập nhật README/hướng dẫn. Không sửa schema hoặc dữ liệu người dùng; server 3000 được giữ hoạt động theo AGENTS, backend mới chưa nạp vào tiến trình này và cần lần khởi động lại tiếp theo. Chưa kiểm chứng trực quan riêng 429 hoặc thử tải LAN/proxy thật; các mục proxy/upload còn mở.

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

- 19/10/2026: Rà soát đối chiếu yêu cầu nâng cấp 8 phase (GitHub, máy chấm phân tán, rule engine, công bố tĩnh, chung kết offline, lớp học, USB boot, red team) với mã hiện tại. Phát hiện mâu thuẫn với D01 (dưới 150 đội so với ~1.000 đội), mô hình đội/tài khoản và kiến trúc portal tĩnh; chờ chủ dự án trả lời trước khi code. Chỉ đọc mã/tài liệu, không đổi trạng thái checklist.

- [x] Hướng dẫn tải/cài/sử dụng cho người mới tại docs/CAI-DAT-VA-SU-DUNG.md, README dẫn tới đúng luồng giải hiện tại; quy tắc duy trì tài liệu trong AGENTS.md.
- 19/10/2026: Soạn hướng dẫn cài lần đầu/chạy lại, admin/thí sinh, cập nhật/backup/LAN, biến môi trường và lỗi thường gặp. Đối chiếu package.json, seed, server và đường dẫn lưu bài; sửa README bỏ mô tả cũ chưa có loại trực tiếp/nộp lại. Chỉ thay tài liệu, không cài lại hoặc thao tác giải thật.

- 20/10/2026: Khởi động web local bằng npm start theo yêu cầu test; xác nhận /api/health HTTP 200 (status ok, phase 5) và /portal HTTP 200. Giữ tiến trình server cổng 3000 hoạt động.

- 21/10/2026: Theo yêu cầu người dùng, đã tắt tiến trình npm start của web local; kiểm tra không còn listener cổng 3000. Không tự khởi động lại server trong lượt dừng này.

- 21/10/2026: Tạo nhánh test từ main, lưu 12 file code/test tại d234cbb, ghép origin/thu-nghiem (4e56c0c) và xử lý xung đột server/auth/script. npm test đạt 177/177; chưa chạy integration Docker hoặc nghiệm thu proxy thật. Tài liệu local giữ ngoài staging, bản gốc lưu data/backups/local-docs-before-test-merge-20261021 và stash. Không push, không bật lại server theo yêu cầu dừng trước đó.

- 21/10/2026: Kiểm thử nhánh test sau merge bằng Playwright + UI/UX Pro Max. Tổng kết tự động cuối: 201 ca, 198 đạt, 0 lỗi còn lại, 2 skip và 1 TODO; hai lỗi native C++ ban đầu do thiếu nlohmann/json.hpp đã đạt sau khi đặt OTT_CPP_INCLUDE tới header lấy từ image Docker, không sửa source. UI: 8 mục admin và 5 mục portal ở desktop/mobile, đổi mật khẩu, upload Python/C++, vòng loại/chung kết/công bố/replay trên DB QA riêng. Phát hiện panel công bố ẩn sau tạo giải, mất focus khi sửa ô bằng bàn phím, hướng dẫn công khai lỗi thời và favicon 404. Báo cáo local: output/playwright/full-qa/REPORT.md. Chưa sửa source/commit/push; chưa nghiệm thu offline thật, bwrap/USB boot, proxy/TLS/dịch vụ ngoài hoặc load test.

- 21/10/2026: Đã sửa bốn vấn đề từ full QA: phát tournament-updated sau render để panel công bố/nhập bài đồng bộ cả khi tạo mới; chặn phản hồi cũ khi đổi giải; giữ focus ô bàn cờ khi Enter/Space render lại; cập nhật hướng dẫn trang kết quả công khai; favicon SVG bàn cờ dùng chung và đóng gói vào site tĩnh. npm test 177/177 đạt, syntax/diff đạt; Playwright xác nhận tạo hai giải/chuyển giải/tạo nháp ẩn panel, focus desktop1366/mobile390, link /site và favicon200 không lỗi JS/request. Log data/ui-fixes-result.log, ảnh output/playwright/fixes-qa. Chỉ dùng DB QA; đã dừng server QA, chưa commit/push.

- 21/10/2026: Mở web local bằng npm start trên dữ liệu hiện có để người dùng test bản sửa UI; sao lưu DB/WAL/SHM trước khởi động tại data/backups/before-local-start-20261021-130908. /api/health, /portal và /admin HTTP 200; giữ server cổng 3000 hoạt động.

- 21/10/2026: Power-up có hai chế độ trực quan: random toàn bàn hoặc admin tự đặt vị trí; bỏ viền/phạm vi rải cố định khỏi editor, lưu mới không mang region. Luật mẫu ottv2-powerups bản 2 rải 2–4 ô hợp lệ toàn bàn; giữ phiên bản cũ/replay/giải đã ghim bất biến. 179/179 unit/API test đạt, Docker rulesets Python/C++ đạt; UI xác nhận đặt 2 ô thủ công, chuyển chế độ giữ bản nháp, random preview ngoài vùng giữa, lưu/tải lại và lịch sử bất biến. Cập nhật tài liệu/dựng hướng dẫn/cú pháp/diff đạt. Log data/powerup-ui-result.log, ảnh output/playwright/powerups-qa. Sao lưu trước restart tại data/backups/before-powerup-v2-20261021-132337, web local3000 đã mở lại với control mới; chưa commit/push.

- 21/10/2026: Tách công cụ theo Classic (5 cơ bản), Obstacles (thêm Ô chặn, gộp Tường đá; mẫu bản 2), Power-ups (nhập min/max 1–16 hoặc tự đặt). Thêm DELETE luật riêng với quyền/CSRF/expectedVersion; migration23 lưu archive, giữ luật mặc định và lịch sử, chặn dùng luật đã xóa cho giải/trận mới; đồng bộ archive trong bundle. 181/181 unit/API đạt (gồm xóa/quyền/sync), Docker 3 luật Python/C++ đạt. UI desktop/mobile xác nhận công cụ, số lượng3, Hủy/Xác nhận xóa và lịch sử. Log data/rule-tools-delete-result.log; ảnh output/playwright/rule-tools-qa. Đã sao lưu DB trước khởi động lại local; cập nhật tài liệu/dựng hướng dẫn; chưa commit/push.
