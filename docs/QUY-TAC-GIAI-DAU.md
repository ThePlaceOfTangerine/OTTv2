# Quy tắc và cách tổ chức giải đấu

Tài liệu dành cho quản trị viên sử dụng mục **Giải đấu**. Nội dung mô tả chức năng hiện có: nhận bot, vòng loại tính điểm, chọn đội đi tiếp, loại trực tiếp và duyệt kết quả. Các thuật ngữ đều được giải thích theo cách dùng trên giao diện.

## 1. Một giải diễn ra như thế nào?

**Tạo giải → lưu danh sách đội → mở nhận bài → đóng nhận bài → chờ kiểm tra xong → chốt bot → vòng loại tính điểm → chốt đội đi tiếp → tạo sơ đồ → loại trực tiếp → duyệt kết quả và kết thúc.**

- **Đội:** một tài khoản thí sinh được thêm vào danh sách giải.
- **Bot:** chương trình Python hoặc C++ của đội. Mỗi lần nộp tạo một phiên bản mới.
- **Ván:** một lần hai bot chơi trên bàn cờ và nhận kết quả thắng, hòa hoặc thua.
- **Cặp đấu:** hai đội gặp nhau, có thể chơi nhiều ván để xác định kết quả chung.
- **Lượt đấu vòng loại:** một đợt ghép cặp; mỗi đội gặp một đối thủ, hoặc nhận suất miễn đấu nếu số đội lẻ.
- **Hạt giống:** thứ tự của đội trong bảng vòng loại đã duyệt. Hạt giống 1 có thứ hạng cao nhất.
- **Mã ghép lịch:** mã được lưu để tái lập việc ghép cặp và phân định bốc thăm khi mọi chỉ số bằng nhau. Có thể để hệ thống tự tạo.

Mục **Vòng điểm** là luồng xếp hạng cũ, tách khỏi giải này. Điểm ở đó không quyết định đội đi tiếp hoặc vô địch trong mục Giải đấu.

## 2. Cấu hình cần hiểu trước khi tạo giải

| Trường trên giao diện | Ý nghĩa và điều kiện |
| --- | --- |
| Sức chứa đội | Số đội tối đa được đăng ký; không phải số đội tự động xuất hiện. Mặc định 150, có thể sửa khi giải còn chuẩn bị. |
| Phiên bản luật vòng loại | Bàn cờ, cách đi, điều kiện thắng/hòa và giới hạn nước. Chọn đúng phiên bản trước khi mở nhận bài. |
| Số lượt đấu vòng loại | Mỗi đội được ghép một cặp mỗi lượt. Phải nhỏ hơn số bot thực tế đã chốt, không chỉ nhỏ hơn sức chứa. |
| Số ván mỗi cặp vòng loại | Số chẵn từ 2 đến 20 để đổi bên. Các ván liền nhau theo từng cặp dùng cùng mã khởi tạo. |
| Số đội vào vòng loại trực tiếp | Số đội dự kiến đi tiếp. Khi duyệt có thể nhập lại số đội phù hợp, từ 2 đến số đội thực sự thi đấu vòng loại. |
| Số ván mỗi cặp loại trực tiếp | Số lẻ từ 1 đến 19. Hệ thống chơi đủ số ván chính này rồi so tổng điểm ván. |
| Số cặp đấu thêm khi hòa | Từ 1 đến 10. Mỗi cặp phụ gồm 2 ván đổi bên; vẫn hòa sau giới hạn này thì xét hạt giống. |
| Mở/đóng nhận bài | Nhập theo giờ Việt Nam. Để trống giờ mở để mở ngay khi bấm nút; phải lưu hạn đóng trong tương lai. |

**Ví dụ giải 6 đội:** sức chứa 6, vòng loại 2 lượt, 2 ván/cặp, chọn 4 hoặc 6 đội đi tiếp, 3 ván chính/cặp loại trực tiếp và 1 cặp phụ khi hòa. Nếu chọn cả 6 đội, sơ đồ có 8 vị trí và 2 suất miễn đấu.

**Lưu ý về giới hạn nước:** giải thử 6 đội trước đó dùng luật rút gọn 8 nước để kiểm tra quy trình nên mọi ván đều hòa. Khi thử chất lượng chiến thuật, dùng giới hạn nước phù hợp và bot có chiến thuật khác nhau. Tăng giới hạn nước không bảo đảm mọi ván sẽ phân thắng thua.

## 3. Từng bước tạo và chạy giải

1. **Chuẩn bị môi trường:** xác nhận máy chấm Docker hoạt động; có tài khoản thí sinh và phiên bản bộ luật cần dùng. Có thể thử hai bot ở mục Đấu thử trước.
2. **Tạo giải:** vào Giải đấu, bấm Tạo giải mới, nhập tên, cấu hình và thời gian rồi bấm Tạo giải. Kiểm tra số lượt vòng loại dựa trên số đội có khả năng nộp bot hợp lệ.
3. **Lưu đội:** tick đội hoặc Chọn tất cả đội trong bộ lọc, sau đó bấm Lưu danh sách đội. Đã chọn và Đã lưu là hai số khác nhau; cần lưu ít nhất hai đội đang hoạt động.
4. **Mở nhận bài:** kiểm tra tên giải, luật, hạn nộp và danh sách rồi bấm Mở nhận bài. Sau bước này cấu hình, luật và danh sách được giữ cố định. Nếu lịch mở ở tương lai, thí sinh phải chờ đến giờ mở.
5. **Thí sinh nộp đúng giải:** ở trang thí sinh, chọn tên giải tại Nơi nộp bài rồi nộp bot. Bài luyện tập ngoài giải không tự chuyển thành bài thi. Theo dõi việc kiểm tra ở mục Giám sát.
6. **Đóng và chốt bot:** hết hạn hoặc nhập lý do rồi bấm Đóng nhận bài. Chờ các bài đúng hạn được kiểm tra xong; xử lý các lỗi hạ tầng trước khi bấm Chốt bot vòng loại. Cần ít nhất hai đội có bot hợp lệ. Đội thiếu bot hợp lệ được ghi lý do không đủ điều kiện.
7. **Bắt đầu vòng loại:** kiểm tra số bot đã chốt và số lượt; nhập mã ghép lịch nếu muốn rồi bấm Bắt đầu vòng loại. Chỉ khi lượt hiện tại xong mới bấm Tạo lượt đấu tiếp theo. Lặp đến khi đủ số lượt đã cấu hình.
8. **Chốt đội đi tiếp:** đối chiếu bảng điểm, nhập Số đội đi tiếp và lý do duyệt rồi bấm Chốt danh sách đội đi tiếp. Hệ thống lấy đúng thứ hạng, không chọn đội tùy ý. Danh sách và hạt giống không sửa lại sau khi chốt.
9. **Chốt luật và tạo sơ đồ:** trong Luật vòng chính thức có thể chọn đúng phiên bản, nhập lý do và bấm Chốt phiên bản luật chính thức. Nếu giữ nguyên luật vòng loại, vẫn dùng bot đã chốt. Nếu chọn luật khác, nhập thông báo, lịch và xác nhận chính sách rồi bấm Công bố luật và mở nộp lại. Chỉ đội đi tiếp được nộp vào đợt mới, kiểm tra theo luật chính thức. Có thể Đóng nhận bài nộp lại sớm. Sau khi đóng, chờ kiểm tra xong, nhập lý do và bấm Chốt bot chính thức. Mọi đội đi tiếp phải có bài hợp lệ trong đợt mới; thiếu bài thì hệ thống chặn chốt và không tự lấy bot cũ. Sau đó nhập Lý do thao tác loại trực tiếp và bấm Tạo sơ đồ loại trực tiếp; kiểm tra nhánh và suất miễn đấu. Luật đã chốt và sơ đồ không sửa lại sau khi lưu.
10. **Chạy loại trực tiếp:** nhập lý do và chọn một chế độ. Bấm Chạy toàn bộ vòng loại trực tiếp để máy chấm tự đi đến chung kết; hoặc Khởi tạo chế độ chạy từng cặp/vòng để điều hành bằng nút Chạy cặp này hay Chạy các cặp còn lại của vòng. Ván phụ trong cặp được chọn tự chạy khi hòa; cặp khác/vòng sau chờ lệnh. Dùng bot/luật chính thức đã chốt nếu mở nộp lại; nếu không đổi luật và không mở đợt mới thì dùng bot vòng loại.
11. **Duyệt kết quả:** xem kết quả chung kết và các bản xem lại, nhập ghi chú rồi bấm Duyệt kết quả và kết thúc giải. Chỉ lúc này kết quả chuyển từ tạm thời sang đã duyệt; thí sinh thuộc giải nhìn thấy đội vô địch.

**Trước khi bấm các nút chốt:** đối chiếu tên giải và dữ liệu. Các bước chốt bot, duyệt đội và tạo sơ đồ được thiết kế giữ lịch sử, không có nút sửa ngược tùy ý. Sau mỗi thao tác, xem thông báo thành công và lịch sử thay đổi.

## 4. Vòng loại tính điểm và cách xếp hạng

Tất cả đội tiếp tục đấu qua các lượt; thua một cặp không bị loại ngay. Các lượt sau ưu tiên ghép đội có điểm gần nhau, tránh gặp lại đối thủ. Không phải mỗi đội đều gặp toàn bộ đội còn lại.

**Tính điểm một cặp:** mỗi ván thắng được 1 điểm ván, hòa 0,5, thua 0. Cộng điểm các ván của cặp; đội hơn điểm được 1 điểm vòng loại, bằng điểm thì mỗi đội 0,5, thua cặp được 0 điểm vòng loại.

**Ví dụ:** hai ván trong một cặp gồm một thắng và một hòa thì điểm ván là 1,5–0,5; điểm vòng loại tương ứng là 1–0. Nếu mỗi đội thắng một ván, điểm ván là 1–1 và mỗi đội nhận 0,5 điểm vòng loại.

Thứ tự xét hạng:

1. **Điểm vòng loại:** tổng điểm các cặp đã hoàn tất.
2. **Tổng điểm đối thủ:** cộng điểm vòng loại hiện tại của các đối thủ đã gặp; cao hơn xếp trước.
3. **Điểm đối thủ có trọng số:** cộng toàn bộ điểm đối thủ khi thắng cặp, một nửa khi hòa và không cộng khi thua.
4. **Điểm ván:** tổng điểm các ván đã đấu; cao hơn xếp trước.
5. **Bốc thăm theo mã ghép lịch đã lưu:** dùng khi mọi chỉ số trên bằng nhau; không bốc lại mỗi lần tải trang.

Khi số đội lẻ, một đội nhận **suất miễn đấu**: 1 điểm vòng loại, không có ván giả hoặc điểm ván. Ưu tiên đội ít điểm chưa được miễn đấu; việc chọn còn phải bảo đảm ghép được các đội còn lại. Hệ thống không lặp miễn đấu cho một đội hoặc tự cho tái đấu khi không tìm được lịch phù hợp; khi gặp giới hạn ghép, lượt mới không được tạo và admin nhận thông báo.

## 5. Vòng loại trực tiếp và phân định hòa

Danh sách đi tiếp giữ thứ tự hạt giống đã duyệt. Hạt giống 1 và 2 ở hai nửa sơ đồ; các nhánh cố định, không bốc lại sau mỗi vòng.

- Nếu số đội không phải lũy thừa của hai, sơ đồ thêm suất trống: 6 đội dùng 8 vị trí, 2 đội hạt giống cao nhất được miễn đấu vòng đầu.
- Đội được miễn đấu tự đi vào vị trí vòng sau, không tạo ván giả hoặc cộng điểm ván.
- Mỗi cặp thực chơi đủ số ván chính, đổi bên luân phiên; so tổng điểm ván để tìm đội đi tiếp.
- Nếu tổng điểm hòa, chấm thêm từng cặp 2 ván đổi bên, cùng mã khởi tạo. Chỉ đấu cặp phụ tiếp theo khi vẫn hòa.
- Hết số cặp phụ mà vẫn hòa, đội có hạt giống tốt hơn đi tiếp. Ví dụ hạt giống 2 được ưu tiên trước hạt giống 5.
- Đội thua dừng bước. Đội thắng tự vào cặp tiếp theo; đội thắng chung kết là đội vô địch chờ duyệt.

**Vì sao điểm 1,5–1,5 vẫn có đội đi tiếp?** Nếu 1 ván chính và 2 ván phụ đều hòa, mỗi đội có 1,5 điểm ván. Khi đã hết quyền đấu thêm, kết quả được phân định bằng hạt giống. Nhãn đi tiếp thể hiện quyết định đó, không phải đội có điểm ván cao hơn.

## 6. Cách đọc giao diện và trạng thái

| Trạng thái hoặc nhãn | Admin cần hiểu/làm gì |
| --- | --- |
| Đang chuẩn bị | Có thể sửa cấu hình và lưu danh sách đội. |
| Chưa đến giờ nhận bài | Đã đặt lịch, thí sinh chưa được nộp trước giờ mở. |
| Đang nhận bài | Thí sinh thuộc giải có thể nộp và chọn bot trước hạn. |
| Đã đóng nhận bài | Không nhận thêm bài; bài nhận đúng hạn tiếp tục được kiểm tra. |
| Đã chốt bot | Phiên bản bot thi đấu đã được cố định; nộp bài luyện tập không thay bot này. |
| Điểm tạm thời / chờ duyệt | Chưa duyệt đội đi tiếp hoặc chưa duyệt kết quả toàn giải; kiểm tra đúng phần đang xem. |
| Miễn đấu | Đội không có đối thủ ở lượt/cặp đó; quy tắc điểm vòng loại và loại trực tiếp khác nhau như trên. |
| Đi tiếp / dừng bước | Kết quả của cặp loại trực tiếp. Điểm từng đội ở bên phải là điểm ván, không phải số cặp thắng. |
| Đội vô địch · chờ duyệt | Chung kết đã xong nhưng chưa bấm duyệt kết quả. |
| Đội vô địch · đã duyệt | Admin đã duyệt và kết thúc giải. Các nút tạo/chạy/duyệt lại bị khóa. |

Bấm **Xem các ván đấu** trong một cặp để mở các nút xem lại. Phần đầu sơ đồ hiển thị đội vô địch và tổng số cặp đã hoàn tất. **Lượt miễn đấu** trong bảng điểm vòng loại không bao gồm các suất miễn đấu của sơ đồ loại trực tiếp.

## 7. Các tình huống thường gặp

- **Đã tick đội nhưng chưa mở được:** bấm Lưu danh sách đội; kiểm tra Đã lưu ít nhất 2 đội và các tài khoản không bị khóa.
- **Không chốt được bot:** còn bài chờ/đang kiểm tra/lỗi hạ tầng, hoặc chưa đóng nhận bài, hoặc chưa đủ 2 bot hợp lệ. Xem mục Giám sát và thông báo cụ thể.
- **Bài kiểm tra xong sau hạn:** bài đã được nhận đúng hạn vẫn tiếp tục được kiểm tra. Hệ thống căn cứ thời điểm nhận, không bắt mọi việc kiểm tra phải xong trước hạn.
- **Bài mới bị từ chối:** hệ thống có thể dùng bản hợp lệ trước đó trong đúng giải; nếu đội đã chọn riêng một bản hợp lệ, lựa chọn đó được ưu tiên. Luôn đối chiếu danh sách bot đã chốt.
- **Số lượt vòng loại quá nhiều so với bot thực tế:** phải có số lượt nhỏ hơn số bot đã chốt; cấu hình đã cố định sau mở nhận bài. Không sửa trực tiếp database để vượt kiểm tra; cần chuẩn bị giải thử mới với cấu hình phù hợp.
- **Không tạo được lượt tiếp theo:** chờ lượt hiện tại hoàn tất, xử lý các ván lỗi hoặc kiểm tra thông báo không tìm được lịch không tái đấu.
- **Lỗi bot trong trận:** bot có thể bị xử thua theo lỗi được ghi trong bản xem lại. **Lỗi hạ tầng:** không xử thua bot; hệ thống thử lại tối đa 3 lần rồi dừng ván để admin xử lý. Nhập lý do rồi bấm chạy lại sau khi khắc phục máy chấm.
- **Tất cả đều hòa và bằng điểm:** kiểm tra lý do kết thúc trong bản xem lại, giới hạn nước và chiến thuật bot. Các chỉ số phụ có thể bằng nhau đúng quy tắc; khi đó mã ghép lịch quyết định thứ tự vòng loại.
- **Thông báo dữ liệu đã thay đổi:** có thể lượt đấu vừa hoàn tất hoặc admin khác vừa thao tác. Bấm cập nhật/tải lại dữ liệu, kiểm tra lại rồi thao tác; tải lại có thể làm mất phần chọn chưa lưu.
- **Chế độ từng cặp/vòng đang chờ:** đây là trạng thái bình thường. Nhập lý do rồi chọn cặp đã đủ hai đội. Chạy cả vòng chỉ được khi các vòng trước đã xong và không còn cặp đang chạy trong chính vòng đó; nút chỉ đưa các cặp chưa chạy vào hàng đợi. Các ván phụ của một cặp đã chọn vẫn tự hoàn tất. Không đổi chế độ sau khi khởi tạo.
- **Đội đi tiếp bị khóa/xóa:** hệ thống không tự bỏ qua thứ hạng để lấy đội khác. Cần xử lý tài khoản trước khi duyệt đội hoặc bắt đầu loại trực tiếp.

## 8. Phạm vi hiện có và những việc cần chuẩn bị

Hiện có thể chạy trọn giải với **cùng bot và bộ luật giữa vòng loại và loại trực tiếp**, xem lại ván và duyệt kết quả. Đã diễn tập thật 6 đội với Docker Python/C++. Thử tải 1.000 đội (đăng nhập, nộp bài sát hạn, vòng loại 8 lượt, 4.000 người xem) có số đo trong tài liệu docs/CAPACITY.md; thời gian chấm thật phụ thuộc số máy chấm.

Đã có chế độ tự chạy toàn bộ, chế độ admin điều khiển từng cặp/vòng và bước chọn/chốt luật chính thức. Đã có công bố luật, cửa sổ nộp lại và kiểm tra theo luật chính thức. Chính sách yêu cầu bài hợp lệ trong đợt mới, không tự lấy bot vòng loại chưa được kiểm tra theo luật mới. Đã hỗ trợ chốt bot đợt mới và chạy loại trực tiếp theo luật đó. Sau khi mở nộp lại phải chốt đủ bot mới, không thể bỏ qua bằng bot cũ. Nếu muốn chạy ngay, hãy giữ luật vòng loại. Khi chưa chốt riêng, luồng cũ vẫn giữ luật vòng loại như trước.

Đã có tạm dừng/tiếp tục/hủy cho vòng loại và loại trực tiếp (xem hai mục cuối). Kết quả cho khách không đăng nhập được đưa ra bằng **bản công bố** trên site công khai, có mã tra cứu riêng cho từng đội (xem docs/PUBLISHING.md); trong portal, kết quả đã duyệt dành cho admin và thí sinh thuộc giải.

Trước giải thật: chốt thể lệ và lịch với ban tổ chức; kiểm tra đủ bot; chọn số lượt phù hợp; diễn tập bằng luật và chiến thuật thực tế; sao lưu database cùng bài nộp/artifact; đo thời gian chấm và chuẩn bị máy dự phòng.

[Về mục Giải đấu](/admin#tournaments)

## Tạm dừng, tiếp tục và hủy loại trực tiếp

Admin nhập **Lý do thao tác loại trực tiếp** rồi chọn nút tương ứng. Các thao tác chỉ áp dụng cho phiên loại trực tiếp đã khởi tạo, cả chế độ tự chạy và từng cặp/vòng.

- **Tạm dừng loại trực tiếp:** ngừng cấp ván mới ngay; ván đã được máy chấm nhận vẫn hoàn tất và giữ bản xem lại. Chưa ghép/chạy các ván phụ hoặc vòng sau cho đến khi tiếp tục.
- **Tiếp tục loại trực tiếp:** xử lý các kết quả đã lưu rồi tiếp tục hàng đợi. Chế độ từng cặp/vòng vẫn giữ các cặp đã được cho phép, không chuyển sang tự chạy toàn giải.
- **Hủy thi đấu loại trực tiếp:** phải tạm dừng trước và chờ không còn ván đang chạy. Giải chuyển sang đã hủy, không thể tiếp tục, khởi tạo lại hoặc duyệt vô địch. Giữ dữ liệu, kết quả đã có và lý do để đối chiếu.

API admin có CSRF: POST .../bracket/pause, /resume, /cancel; nhận expectedRevision của **phiên loại trực tiếp** và reason 1–1000 ký tự. Lệnh cũ, thao tác sai trạng thái hoặc trên phiên đã xong bị chặn. Trạng thái điều khiển lưu trong state_json, không đổi luật/nguồn bot bất biến. Sau khi khởi động lại vẫn giữ tạm dừng/hủy. Hàng đợi và cơ chế phục hồi lỗi hạ tầng vẫn giữ nguyên.

Chức năng này chưa áp dụng cho vòng loại tính điểm hoặc cửa sổ nhận bài; không coi là nút hủy tổng quát ở mọi giai đoạn.

## Tạm dừng, tiếp tục và hủy vòng loại

Admin nhập lý do tại phần vòng loại tính điểm. **Tạm dừng vòng loại** ngừng cấp ván mới; ván đang chạy vẫn hoàn tất và lưu bản xem lại. Điểm cặp/lượt được tổng hợp khi tiếp tục, không xử thua vì tạm dừng. Không tạo lượt mới hoặc chạy lại ván lỗi khi đang dừng.

**Tiếp tục vòng loại** tổng hợp các ván đã xong rồi tiếp tục hàng đợi, giữ luật, bot và lịch cũ. Khởi động lại server vẫn giữ trạng thái tạm dừng.

**Hủy thi đấu vòng loại** chỉ được dùng sau khi tạm dừng và không còn ván đang chạy. Giải chuyển sang đã hủy, giữ lịch sử và bản xem lại, không thể tiếp tục, tạo lượt mới hoặc duyệt đội đi tiếp. Chưa hỗ trợ hủy giải ở giai đoạn chuẩn bị hoặc nhận bài.

API admin: POST /api/admin/tournaments/:id/swiss/pause, /resume, /cancel, có CSRF; nhận expectedRevision của phiên vòng loại và reason 1–1000 ký tự. Migration 16 lưu điều khiển trong swiss_controls; mỗi thao tác tăng phiên bản phiên/giải và ghi người, thời gian, lý do trong nhật ký.

## Hủy giải trước thi đấu

Khi giải đang chuẩn bị, nhận bài hoặc đã đóng nhưng chưa chốt bot, admin nhập lý do và bấm **Hủy giải trước thi đấu**. Thao tác cần đúng phiên bản dữ liệu và lưu nhật ký. Giải đã hủy không thể mở lại, sửa danh sách, nhận bài mới hoặc chốt bot; lịch sử và bài đã nhận vẫn giữ. Bài đã nhận tiếp tục được kiểm tra để giữ biên nhận/kết quả kiểm tra, không được dùng thi đấu trong giải đã hủy. Giải đã chốt bot hoặc đang thi đấu không dùng nút này; dùng điều khiển riêng của giai đoạn đang chạy. API: POST /api/admin/tournaments/:id/cancel, admin + CSRF, expectedRevision của giải và reason 1–500 ký tự.
