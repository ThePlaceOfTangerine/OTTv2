# Yêu cầu tổ chức giải OTTv2

Trạng thái: cơ sở triển khai v0.2, ngày 18/10/2026, giờ Việt Nam. Chủ dự án đã chốt quy mô thực tế dưới 150 đội, vòng loại Swiss theo điểm và bracket đấu thêm rồi xét hạt giống. Các chi tiết ghi là mặc định đề xuất được cấu hình trước khi mở giải; lịch thi thật và năng lực hạ tầng còn cần xác định. Tài liệu không khẳng định các tính năng bên dưới đã được triển khai.

## Phạm vi và căn cứ

Sản phẩm phải tổ chức được một giải bot từ cấp tài khoản, nhận và chốt bài, vòng loại, chọn top, bracket có đổi luật, đến công bố và phục hồi dữ liệu. Bản đầu nghiệm thu bằng giải LAN nhỏ; năng lực phục vụ quy mô lớn được xác định sau benchmark.

Căn cứ: ghi chú buổi 16/10, yêu cầu trong file vai trò, TODO.md, cùng mã hiện tại ở src/scoring.js, src/submissions/service.js, src/game/protocol.js và tài liệu giao thức.

Các ràng buộc đã được nêu trong yêu cầu dự án:

- Bot Python/C++ chạy và biên dịch trong sandbox, không thực thi trực tiếp trên host.
- Admin và thí sinh tách quyền; tài khoản đội là căn cứ xác thực bài nộp.
- Luật có phiên bản; thay luật không làm thay đổi các trận đã tạo.
- Chọn top cấu hình được, single-elimination, hỗ trợ bye và best-of-K.
- Đội đủ điều kiện có cửa sổ nộp lại sau công bố luật; không nộp thì dùng bot cũ.
- Bot lỗi bị xử thua; hạ tầng lỗi được retry và không tự tạo kết quả thắng/thua.
- Có chế độ thi LAN không phụ thuộc Internet và phương án đưa dữ liệu lên online sau đó.

## Quyết định và cấu hình triển khai

| Mã | Cần chốt | Đề xuất để triển khai | Trạng thái |
| --- | --- | --- | --- |
| D01 | Quy mô | Thực tế dưới 150 đội; mặc định sức chứa 150, cấu hình được. Nghiệm thu 16 đội LAN; 4.000 chỉ là thử tải mở rộng tùy chọn | Đã chốt hướng theo trả lời chủ dự án |
| D02 | Điểm vòng loại | Swiss theo điểm, không dùng Elo quyết định thứ hạng hoặc hạt giống giải mới | Đã chốt |
| D03 | Hòa bracket | Đấu thêm rồi xét hạt giống vòng loại; mặc định tối đa 3 cặp đổi bên | Đã chốt cách phân định; số cặp là cấu hình mặc định |
| D04 | Lịch giải | Thời điểm mở/đóng do admin cấu hình theo từng giải; chưa có ngày thi thật | Đề xuất, chưa có lịch chính thức |
| D05 | Bài còn chờ lúc hết hạn | Nhận thành công trước hạn thì tiếp tục kiểm tra; chờ mọi bài hợp lệ về thời gian được xử lý trước khi chốt | Đề xuất |
| D06 | Fallback | Ưu tiên bản đã chọn nếu hợp lệ theo luật vòng; nếu bản mới lỗi dùng bản hợp lệ gần nhất trước hạn; bot cũ phải được kiểm tra theo luật mới | Đề xuất |
| D07 | Khiếu nại | Cửa sổ cấu hình, đề xuất 30 phút sau công bố tạm; chưa chạy vòng phụ thuộc khi còn khiếu nại ảnh hưởng kết quả | Đề xuất |
| D08 | Mục tiêu dịch vụ | Các ngưỡng trong phần năng lực là mục tiêu benchmark, không phải cam kết đã đạt | Đề xuất |

Các giá trị mặc định bên dưới là cơ sở phát triển có thể điều chỉnh; admin phải kiểm tra và công bố cấu hình trước khi mở giải. Không chặn phát triển chỉ vì chưa có ngày thi thật. Nếu đổi D02/D03 hoặc các tham số sau khi đã có kết quả, phải xử lý lịch sử bằng phiên bản, không sửa ngầm.

## Quy mô và lịch thử

| Thuộc tính | Mốc đề xuất | Cách đánh giá |
| --- | --- | --- |
| Giải LAN nghiệm thu | 16 đội, một bot được chốt mỗi đội/vòng | Hoàn thành từ tạo giải đến công bố |
| Hàng đợi thực tế | 150 đội × 3 bài đang chờ, tối đa 450 bài | 1.000 bài giả là bài thử mở rộng, không phải yêu cầu vận hành thường ngày |
| Bot vòng loại | Dưới 150 đội, mặc định sức chứa 150 cấu hình được | Swiss; số vòng cấu hình, mặc định đề xuất 8 cho giải gần 150 đội |
| Người xem thực tế | Mốc benchmark ban đầu 300 phiên; điều chỉnh theo giải | 4.000 phiên là thử tải mở rộng tùy chọn, đo riêng |
| Upload đồng thời | Tăng dần 10, 50 rồi burst 150 đội | Ghi kích thước bài, thời gian gửi, tỷ lệ thành công và retry; không hứa nhận tất cả ngay lập tức |
| Bài đang kiểm tra mỗi đội | Giữ mức hiện tại 3 bài làm mặc định thử | Thông báo và backpressure rõ ràng |

Lịch thử tương đối: chuẩn bị và kiểm tra môi trường → mở nhận bài → đóng nhận bài → xử lý nốt hàng đợi → chốt bot → chạy vòng loại → công bố tạm/giải quyết khiếu nại → chốt top → công bố luật bracket và mở nộp lại → chốt bot/thi đấu từng vòng → công bố cuối.

Đề xuất cửa sổ nộp lại mặc định 60 phút, cấu hình được. Thời gian chấm được dự toán từ số trận và benchmark; không ấn định thời lượng giải thật khi chưa có số đo. Không tự rút ngắn thời gian làm bài vì hàng đợi hạ tầng bị chậm.

## Vòng đời giải và giai đoạn

Giải có danh tính riêng, thành viên riêng và dữ liệu lịch sử riêng. Một đội là một tài khoản thi đấu trong phạm vi phiên bản đầu; danh sách thành viên con người có thể bổ sung mà không thay ID đội.

Trạng thái nghiệp vụ cần hỗ trợ:

| Trạng thái | Thao tác chính | Điều kiện chuyển tiếp |
| --- | --- | --- |
| Chuẩn bị | Nhập đội, chọn luật, lập lịch và thể thức | Cấu hình hợp lệ, đủ quyền vận hành |
| Nhận bài | Đội đủ điều kiện gửi/chọn bot | Đến hạn hoặc admin đóng có lưu lý do |
| Chờ chốt | Không nhận bài mới, tiếp tục xử lý bài đúng hạn | Không còn bài chờ/lỗi hạ tầng chưa giải quyết ảnh hưởng lựa chọn |
| Đã chốt | Đóng băng đội, bot, luật, môi trường và lịch | Đủ bot hợp lệ và xác nhận lịch |
| Thi đấu | Chạy trận, retry hạ tầng, xem tiến độ | Mọi trận bắt buộc kết thúc hợp lệ |
| Công bố tạm | Duyệt bảng điểm và xử lý khiếu nại | Khiếu nại đã giải quyết hoặc hết thời hạn |
| Kết thúc | Công bố chính thức, xuất và lưu trữ | Có bản kết quả được duyệt |

Tạm dừng và hủy phải lưu người thực hiện, thời điểm, lý do. Tạm dừng thi đấu không tự thay hạn nộp. Việc mở lại nhận bài hoặc đổi lịch phải là thao tác rõ ràng, thông báo tới đội bị ảnh hưởng và ghi nhật ký. Không chỉnh sửa snapshot của vòng đã chốt; nếu cần sửa sai phải tạo bản thay thế có liên kết lịch sử.

## Nhận bài và chốt bot

1. Thời gian chuẩn do server quyết định, lưu dạng UTC và hiển thị theo Asia/Saigon. Quy tắc đúng hạn là received_at < closes_at; đúng thời điểm closes_at không còn nhận.
2. received_at là thời điểm hệ thống hoàn tất lưu bền vững bài cùng bản ghi biên nhận. Bắt đầu upload trước hạn không bảo đảm đủ điều kiện nếu hoàn tất sau hạn.
3. Biên nhận có submission ID, giải/giai đoạn, đội, phiên bản, thời điểm và thông tin đối chiếu. Retry cùng khóa yêu cầu không tạo phiên bản mới; cùng khóa nhưng nội dung khác phải báo xung đột.
4. Việc kiểm tra thời hạn và ghi nhận bài cần nhất quán để tránh request vượt qua hạn trong lúc ghi file. File chưa có biên nhận không được tự coi là bài thi.
5. Bài đúng hạn được tiếp tục kiểm tra sau khi đóng cửa sổ. Lỗi hạ tầng không biến bài thành không hợp lệ và không cho phép chốt trong khi còn quyết định đang treo.
6. Đề xuất: lựa chọn của đội trong cửa sổ được ưu tiên nếu bản đó hợp lệ theo luật vòng; nếu không, lấy phiên bản hợp lệ mới nhất đã nhận trước hạn. Nếu đội không chọn thủ công, lấy phiên bản hợp lệ mới nhất đúng hạn.
7. Đổi active, khóa tài khoản hoặc nộp bài sau khi chốt không được âm thầm sửa bot trong snapshot. Loại đội sau chốt phải là quyết định BTC có lý do và quy tắc xử lý riêng.
8. Không có bot hợp lệ ở vòng loại thì không đủ điều kiện. Ở vòng sau, bot cũ phải qua kiểm tra tương thích luật mới; nếu không có bản dùng được thì xử bỏ cuộc theo thể lệ được công bố, không đổi thành lỗi hạ tầng.
9. Mỗi bài nộp cần gắn giải/giai đoạn; trạng thái Accepted phải cho biết đã kiểm tra theo phiên bản luật nào. Không dùng Accepted theo Classic để khẳng định hợp lệ theo mọi luật.

Tình huống bắt buộc kiểm thử: bài hoàn tất ngay trước/đúng/sau hạn; mất phản hồi sau khi lưu; hai lần retry; bài mới lỗi nhưng bản cũ hợp lệ; bài còn blocked vì hạ tầng; thay active sau chốt; đội không có bản tương thích.

## Vòng loại và xếp hạng

Vòng loại giải mới dùng Swiss theo điểm, không dùng Elo xếp hạng. Mặc định đề xuất 8 vòng khi gần 150 đội; giải thử 16 đội dùng 4 vòng. Số vòng phải cấu hình trước khi bắt đầu và không vượt số đối thủ khả thi nếu không cho tái đấu. Với 150 đội, 8 vòng và 2 ván/cặp có tối đa 1.200 ván, chưa tính đấu phân định bracket. Giải ít đội phải chọn số vòng phù hợp; không tự nhận cấu hình không thể lập lịch.

Mỗi vòng ghép các đội có điểm gần nhau, tránh gặp lại; vòng đầu theo thứ tự trộn từ seed. Thuật toán phải tìm lại cách ghép khi lựa chọn tham lam dẫn đến bế tắc. Nếu không tìm được lịch theo ràng buộc, dừng và báo BTC, không âm thầm cho tái đấu. Không tuyên bố tuân thủ Swiss FIDE; đây là thể thức Swiss riêng cho giải bot, cần test số đội chẵn/lẻ và các nhóm điểm khó ghép.

Mỗi cặp mặc định hai ván cùng seed bàn, đổi bên; tổng điểm ván thắng/hòa/thua là 1/0,5/0. Kết quả cả cặp quyết định điểm Swiss: thắng cặp=1, hòa cặp=0,5, thua cặp=0. Chỉ ghi điểm cặp sau khi đủ ván hợp lệ. Vòng tiếp theo chỉ lập lịch khi vòng hiện tại hoàn tất; tốc độ worker không ảnh hưởng ghép cặp.

Nếu số đội lẻ, cấp một bye cho đội có điểm thấp nhất chưa từng nhận bye, phân định bằng thứ tự seed nếu cần. Bye được 1 điểm Swiss, không cộng điểm ván và không tạo replay giả. Không cấp bye lần hai khi vẫn còn đội chưa có bye đủ điều kiện. Theo mặc định đề xuất, Buchholz không cộng đối thủ ảo cho bye và Sonneborn-Berger đóng góp 0 từ bye; phải công bố quy ước này.

Thứ tự đề xuất: điểm Swiss → Buchholz (tổng điểm Swiss cuối cùng của đối thủ thực đã gặp) → Sonneborn-Berger (tổng điểm cuối đối thủ nhân 1/0,5/0 theo kết quả cặp) → tổng điểm ván → thứ tự bốc thăm từ seed đã chốt. Dùng đơn vị điểm nguyên nội bộ hoặc phân số chính xác; không xếp hạng theo giá trị hiển thị đã làm tròn. Khi đối thủ rút lui, giữ điểm đã có và tính tie-break từ điểm cuối thực của đội đó; xử lý cặp tương lai là quyết định có nhật ký, không xóa lịch sử.

Elo và vòng tròn hiện có vẫn là chức năng cũ riêng cho đến khi có đường chuyển đổi; dữ liệu cũ không tự được chuyển thành điểm Swiss. Hàm ghép cặp ít đối thủ hiện có không được đổi tên thành Swiss vì nó không ghép lại theo kết quả từng vòng.

Top N phải không vượt số đội đủ điều kiện; chỉ lấy sau khi vòng đã hoàn tất và kết quả được duyệt. N mặc định đề xuất 8 hoặc 16 tùy quy mô, admin lựa chọn trước giải. Snapshot top lưu thứ hạng và hạt giống để dùng bracket.

## Bracket và phân định hòa

Đề xuất: single-elimination, best-of-5 mặc định, K là số lẻ cấu hình được. Best-of-K ở đây nghĩa là tối đa K ván chính, đội đạt hơn K/2 trận thắng kết thúc sớm; hòa không tính là trận thắng. Nếu hết K ván mà chưa ai đạt ngưỡng thì so tổng điểm thắng=1, hòa=0,5, thua=0. Mọi cách hiển thị và test phải dùng đúng định nghĩa này.

Nếu vẫn bằng điểm: đấu thêm rồi xét hạt giống như chủ dự án đã chọn; mặc định tối đa 3 cặp, mỗi cặp hai ván cùng seed và đổi bên. Chỉ phân định sau khi hoàn tất cả cặp; không dừng sau ván đầu một cặp phụ. Nếu vẫn bằng nhau thì đội có hạt giống cao hơn đi tiếp; ghi lý do rõ trong kết quả. Số cặp phụ cấu hình trước giải.

Tạo bracket với số vị trí là lũy thừa hai nhỏ nhất không nhỏ hơn N. Bye dành cho hạt giống cao theo sơ đồ đã chốt, không tạo trận thắng giả hay cộng Elo. Ví dụ 3 đội có 1 bye; 5 đội có 3 bye. N tối thiểu 2. Hạt giống cao gặp thấp theo sơ đồ tiêu chuẩn và tách hai hạt giống đầu sang hai nửa.

Đề xuất mỗi cặp chính đổi bên luân phiên; các ván thành cặp dùng cùng seed. K lẻ có một ván không ghép đối xứng: phía đi trước của ván đó xác định từ seed cặp, công bố quy tắc trước giải. Không đổi seed hoặc bên đi trước sau khi đã thấy kết quả.

Mỗi vòng lưu phiên bản luật, bot, môi trường và cấu hình phân định. Vòng kế tiếp chỉ chốt sau khi đủ kết quả hợp lệ và kết thúc khiếu nại liên quan. Admin có thể chạy từng cặp hoặc cả vòng; lỗi hạ tầng không tự cho đội đi tiếp.

## Luật mới và cửa sổ nộp lại

- Công bố luật là một sự kiện có thời điểm và phiên bản cụ thể; đội được xem luật đã công bố ngay cả khi không có quyền quản trị.
- Chỉ đội còn đủ điều kiện ở vòng đó được nộp lại; API phải kiểm tra quyền và thời gian.
- Trong cửa sổ, dùng cùng quy trình nhận bài/biên nhận/kiểm tra. Kiểm tra theo luật mới, không cố định Classic.
- Giữ bot cũ làm ứng viên fallback và kiểm tra tương thích theo luật mới; không bắt đội phải upload lại cùng nội dung.
- Thay cấu hình sau công bố phải tạo phiên bản mới và xử lý lại cửa sổ một cách công khai; không thay ngầm luật đang áp dụng.

## Lỗi khiếu nại và chạy lại

| Trường hợp | Xử lý đề xuất |
| --- | --- |
| Mã không biên dịch/không qua kiểm tra đầu vào | Rejected, có lý do; fallback theo quy tắc chốt |
| Bot crash, sai output, đi sai luật, vượt giới hạn | Bot đó thua ván theo giao thức đã công bố |
| Docker/worker/mạng nội bộ/artifact hạ tầng lỗi | Không xử thua bot; retry cùng snapshot và seed, tối đa 3 lần tổng cộng |
| Hết số lần retry hạ tầng | Blocked, BTC xử lý rồi retry có nhật ký; không chốt kết quả phụ thuộc |
| Hết hạn toàn trận do runner/hạ tầng | Infrastructure error theo phân loại hiện tại; không suy ra đội thắng |
| Khiếu nại chiến thuật hoặc kết quả bất lợi nhưng hệ thống đúng | Giữ kết quả, lưu giải thích |
| Xác nhận lỗi engine/runner/lịch ảnh hưởng kết quả | Dừng phần phụ thuộc, xác định phạm vi ảnh hưởng, tạo lần xử lý thay thế có truy vết |

Khiếu nại cần mã trận/bài, mô tả và bằng chứng; BTC lưu người quyết định, lý do và mốc thời gian. Không xóa kết quả cũ để che lịch sử. Chạy lại vì hạ tầng không bảo đảm bot dùng random riêng sẽ đi giống hệt; lưu replay của mọi lần cần thiết để đối chiếu và công bố rõ giới hạn tái lập.

## Mục tiêu năng lực và phục hồi đề xuất

Các số này chưa được đo, cần chủ dự án chấp thuận hoặc điều chỉnh. Báo cáo phải nêu phần cứng, loại tải, kích thước file và kết quả thực tế.

| Chỉ tiêu | Mục tiêu ban đầu | Phạm vi đo |
| --- | --- | --- |
| Cấp biên nhận | p95 ≤ 3 giây sau khi nhận đủ body cho bài 1 MiB ở tải được duyệt | Không gồm thời gian chấm, không tính thời gian mạng upload của thí sinh |
| Xem bảng điểm công khai | p95 ≤ 1 giây ở tải được duyệt | Snapshot kết quả, tách cache hit và miss |
| Lỗi bất ngờ HTTP 5xx | < 1% trong kịch bản tải được duyệt | Báo riêng 429, retry và tỷ lệ hoàn thành cuối; không che quá tải bằng 429 |
| Bài đã có biên nhận | Không mất khi tiến trình restart | Phải có test crash; chưa cam kết mất máy/đĩa |
| Mất máy điều phối | Mục tiêu phục hồi ≤ 15 phút, mất dữ liệu ≤ 5 phút theo backup | Cần cơ chế backup, lưu ngoài máy và diễn tập; phần chưa backup không được gọi là zero-loss |
| Thu hồi việc worker ngắt | Mục tiêu ≤ 60 giây trong mạng bình thường | Hiện lease 30 giây; kiểm thử lại sau phân tán |
| Thời gian hoàn tất chấm | Tổng số ván × thời gian đo mỗi ván / slot thực, cộng biên dịch và retry | Chốt SLA giải sau benchmark |

Nếu cần không mất bất kỳ bài đã nhận khi cả máy/đĩa hỏng, phải bổ sung sao lưu đồng bộ hoặc xác nhận lưu ở nơi thứ hai trước biên nhận; không suy ra bảo đảm đó từ SQLite và backup định kỳ.

## Tiêu chí nghiệm thu và liên kết TODO

| Nhóm TODO P0 đầu tiên | Bằng chứng cần để đánh dấu hoàn thành |
| --- | --- |
| Quy mô | D01 được chốt; có số đội, lượt nộp và tải đồng thời tách biệt |
| Thời gian | D04 được chốt hoặc xác nhận cơ chế cấu hình; có ngân sách thời gian chấm và lịch thi thử |
| Thể thức | D02 và cấu hình số trận/đổi bên/seed/top được chốt |
| Tie-break và bracket | D03 và thứ tự tie-break được chốt, bao phủ hòa/bye |
| Lỗi và khiếu nại | Chính sách retry, blocked, khiếu nại và thay thế kết quả được duyệt |
| Bài chờ sau hạn | D05 được chốt và các mốc thời gian có định nghĩa không mơ hồ |
| Fallback | D06 được chốt, gồm bot cũ không tương thích luật mới |
| Năng lực và phục hồi | D08 được chốt làm mục tiêu; việc đạt mục tiêu là nghiệm thu P1 riêng |

Quy mô, Swiss theo điểm và hướng phân định hòa đã đủ để bắt đầu mô hình dữ liệu. Lịch thật, SLA chấm và các mặc định thể lệ chi tiết vẫn cần BTC kiểm tra trước khi mở giải. Các ca nghiệm thu phải được chuyển thành test khi triển khai tính năng tương ứng.
