# Cách hoạt động và sử dụng OTTv2

## Web này dùng để làm gì?

Bạn viết một chương trình chơi cờ thay mình, gọi là **bot**. Nộp code lên web, hệ thống sẽ cho bot đấu thử và tham gia các vòng thi do ban tổ chức tạo. Bạn không cần điều khiển từng nước đi.

Mở `/portal` để tham gia. Khu “Chơi trực tiếp” dành cho hai người tự đi quân, không tính điểm thi bot và có một số quy tắc khác.

## Lần đầu: làm theo 4 bước

1. **Tải mã mẫu Python hoặc C++.** Chọn ngôn ngữ bạn đang học. Mã mẫu đã làm sẵn phần nhận dữ liệu và gửi nước đi; có thể nộp nguyên file để thử.
2. **Đăng nhập và đặt mật khẩu riêng.** Dùng tài khoản ban tổ chức cấp. Làm theo hướng dẫn đổi mật khẩu ở lần đầu đăng nhập.
3. **Mở Bot của tôi, chọn file và bấm Nộp bot.** Nộp `main.py` hoặc `main.cpp` vừa tải. Ô “File chính trong ZIP” để trống.
4. **Chờ kết quả.** Khi thấy “Sẵn sàng thi đấu”, mở “Chi tiết & trận thử”, chọn một trận rồi bấm “Tự động chạy” để xem bot chơi. Trang tự cập nhật, không cần nộp lại cùng file.

Không bắt buộc thắng hai ván thử. Bot chỉ cần chạy đúng luật và trong thời gian cho phép. Vượt qua kiểm tra chưa có nghĩa là chiến thuật đã tốt hoặc bot sẽ không bao giờ lỗi.

## Khi muốn bot chơi tốt hơn

Mở file mẫu, tìm dòng **THAY CHIẾN THUẬT Ở ĐÂY** và sửa phần chọn nước đi. Lưu file rồi nộp bản mới.

Ba tên trong code cần biết trước:

| Tên | Ý nghĩa |
| --- | --- |
| `legal_moves` | Danh sách nước được phép đi. Chọn một nước từ đây để tránh sai luật. |
| `state.board` | Bàn cờ hiện tại: quân nào đang ở ô nào. |
| `player_index` | Bên của bạn, đánh số 0 hoặc 1. |

Mẫu đang chọn nước đầu tiên. Bạn có thể thử ưu tiên nước ăn quân hoặc tiến gần nhà đối thủ hơn. Giữ nguyên phần nhận và gửi dữ liệu khi chưa cần thay đổi nó.

Bot chạy lại từ đầu mỗi lượt, nên biến của lượt trước không tự được giữ. Ban đầu cứ quyết định từ bàn cờ hiện tại; phần ghi nhớ `userdata` có thể học sau.

## Đọc trạng thái bài nộp

| Thông báo | Việc cần làm |
| --- | --- |
| Đang chờ / Đang kiểm tra bài / Đang chuẩn bị chạy / Đang đấu thử | Chờ trang tự cập nhật. |
| Sẵn sàng thi đấu | Có thể dùng bản này để thi đấu và xem lại trận thử. |
| Cần sửa bài | Mở chi tiết, đọc gợi ý, sửa file rồi nộp lại. |
| Máy chủ gặp sự cố | Chờ hệ thống thử lại hoặc báo ban tổ chức. Chưa cần sửa code vì thông báo này. |

“Chi tiết kỹ thuật” lưu thông báo gốc để tìm lỗi. Nếu chưa hiểu, gửi phần đó cho giảng viên hoặc ban tổ chức. Đừng in lời chào vào câu trả lời của bot; phần gửi nước đi đã có sẵn trong mẫu.

## Các bản đã nộp và điểm xếp hạng

Mỗi lần nộp là một bản mới: v1 là bản đầu, v2 là bản thứ hai… Bản mới nhất vượt qua kiểm tra sẽ được chọn để thi đấu. Nếu bản mới lỗi, bản trước đang chọn vẫn được giữ. Muốn dùng lại bản cũ, bấm “Chọn bản này thi đấu”.

Vòng đã bắt đầu vẫn dùng bản được chọn lúc tạo vòng. Đổi bản sau đó chỉ ảnh hưởng vòng mới.

Mở **Bảng xếp hạng** để xem kết quả. **Elo** là điểm xếp hạng, bắt đầu từ 1500 ở mỗi vòng, thay đổi theo kết quả và đối thủ. Vì vậy, hai người cùng số trận thắng vẫn có thể có điểm khác nhau.

## Nộp nhiều file và đọc thêm

File đơn tối đa 1 MiB (khoảng 1 MB). Nếu có nhiều file, nén ZIP tối đa 5 MiB, 64 file code cùng ngôn ngữ. Không nộp file `.exe`, thư viện cài thêm hay ZIP có mật khẩu.

ZIP có `main.py` hoặc `main.cpp` rõ ràng thường không cần điền file chính. Nếu cần, nhập đường dẫn như `src/main.py`. Với C++, chỉ nên có một hàm `main`.

Hướng dẫn dành cho người mới nằm tại `/docs/PROTOCOL.md` trên web. [PROTOCOL.md](PROTOCOL.md) trong thư mục tài liệu là đặc tả kỹ thuật đầy đủ, dùng khi cần tra cấu trúc dữ liệu và giới hạn chính xác.

## Admin: điều hành một vòng điểm

1. Mở `/admin`, đăng nhập tài khoản admin. Tài khoản thí sinh không vào được API quản trị.
2. Tạo tài khoản qua CSV có dòng đầu `username`. Ví dụ:

   ```csv
   username
   team001
   team002
   ```

   Mật khẩu ban đầu trùng chính xác tên tài khoản. Thí sinh bắt buộc đổi mật khẩu ngay lần đăng nhập đầu tiên trước khi sử dụng chức năng khác; mật khẩu mới khác mật khẩu cũ, ít nhất 12 ký tự, tối đa 72 byte. CSV cũ username,password vẫn nhận nhưng giá trị cột password không được dùng. Hệ thống chỉ lưu bản hash. CSV sai hoặc trùng tài khoản bị từ chối toàn bộ. Không dùng import để sửa mật khẩu tài khoản cũ.
3. Dùng “Cấp lại mật khẩu” khi cần cấp mật khẩu mới; “Khóa” khi cần ngăn đăng nhập. Các thao tác này hủy phiên đăng nhập cũ. Khóa sau khi vòng đã bắt đầu không thay lịch đấu đã chốt.
4. Theo dõi “Bộ xử lý và hàng đợi”: worker là bộ xử lý tự động, slot là số bài/trận có thể chạy cùng lúc. “Xem nhật ký” mở thông tin bài nộp và các trận thử. Khi có trận đang chơi, nút xem trực tiếp xuất hiện.
5. Cần ít nhất hai tài khoản đang mở có bot đang được chọn và đã Accepted. Mặc định dùng **Lịch đấu tự động**: không cần nhập mã ghép lịch hay tính số ván. Mỗi cặp đấu 6 ván, mỗi bên đi trước 3 ván. Hai ván đổi bên dùng cùng mã trận; ba lượt đổi bên dùng các mã khác nhau. Hai bot tạo 6 ván tổng cộng; ba bot tạo 18 ván. Vòng kết thúc đúng lịch, cho phép bằng điểm và không tự đấu phân định.
6. Hệ thống ghép tối đa 4 đối thủ cho mỗi bot, giảm khi ít bot hoặc để không vượt 100.000 ván. Mỗi bot gặp cùng số đối thủ và có số lượt đi trước/đi sau bằng nhau. Khi thật sự cần, mở **Tự điều chỉnh lịch (nâng cao)** để dùng cấu hình riêng; đóng lại để về tự động. Ở chế độ nâng cao, số ván/bot phải chia hết số ván/cặp, số ván/cặp chẵn từ 2–20; số đối thủ nhỏ hơn số bot và phải chẵn nếu có số bot lẻ. Mã ghép lịch để trống sẽ được tự tạo.
7. Bấm “Tạo và chạy vòng điểm”. Chỉ có một vòng chưa hoàn tất tại một thời điểm. Không dùng khu “Kiểm tra đấu trường” để tính điểm: khu đó chạy trận thử theo luật với bot mẫu hoặc bot thí sinh, không ảnh hưởng bảng xếp hạng.
8. Theo dõi bảng điểm và xem từng trận. Lỗi hạ tầng tự thử lại; sau 3 lần lỗi, bấm “Chạy lại sau lỗi máy chủ” khi đã sửa Docker/máy chủ. Bot chạy lỗi trong trận thực sự thì bị xử thua.
9. Khi hoàn tất, tải CSV bảng điểm. Mỗi vòng bắt đầu Elo 1500 riêng; xếp theo Elo rồi điểm. Thắng được 1 điểm, hòa 0,5, thua 0. Elo xét thêm sức mạnh đối thủ, nên thứ hạng không chỉ dựa trên số trận thắng.

## Khi trang không chạy

- Không truy cập được `127.0.0.1:3000`: kiểm tra server Node đang chạy (`npm start` từ thư mục OTTv2). Giữ tiến trình server hoạt động.
- Đăng nhập được nhưng bot không chạy: admin bấm “Kiểm tra Docker”, kiểm tra Docker Desktop và image sandbox. Xem lỗi hạ tầng trong hàng đợi.
- Không tạo được vòng điểm: xem số bot đủ điều kiện, cấu hình số ván và vòng cũ đã hoàn tất chưa.
- Thấy bài bị từ chối: mở “Chi tiết & trận thử”, xem gợi ý và “Nhật ký kiểm tra”. Không sửa code chỉ vì máy chủ báo lỗi hạ tầng.

Đã có quản lý bộ luật và sandbox luật ở trang admin. Bracket và cửa sổ nộp lại bot chưa được triển khai. Xem [hướng dẫn bộ luật](RULE-SETS.md) để tạo, lưu phiên bản và chạy thử.

Luật Classic v2: mỗi bên 10 quân Búa/Bao/Kéo theo tỷ lệ 3–3–4. Loại có 4 quân được chọn ngẫu nhiên theo seed; hai bên có cùng cơ cấu, vị trí được xáo trộn riêng. Classic v1 và replay cũ vẫn giữ cơ cấu 3 Búa, 3 Bao, 4 Kéo. Game trực tiếp cũng đã đổi cách chia quân sang 3–3–4 ngẫu nhiên.

Trang thí sinh chia thành **Bot của tôi**, **Bảng xếp hạng** và **Hướng dẫn**. Mở Hướng dẫn để đọc giao thức hoặc tải mã mẫu Python/C++. Trang đăng nhập cũng có các liên kết đọc và tải mẫu, không yêu cầu tài khoản. Thao tác nộp bài vẫn yêu cầu đăng nhập và hoàn tất đổi mật khẩu tạm.

Trang admin chia thành **Giám sát**, **Thí sinh**, **Vòng điểm**, **Bộ luật**, **Đấu thử** và **Hướng dẫn**. Phần **Thêm thí sinh** và **Thiết lập vòng đấu** hiển thị trực tiếp. Các lựa chọn dùng nút/thẻ có dấu ✓ cho mục đang chọn: lọc thí sinh, chọn vòng điểm, bộ luật, phiên bản, hình dạng, màu bàn cờ, hướng đi, cách chia quân, bản bot và tốc độ replay. Danh sách dài có tìm kiếm và chuyển trang. JSON và nhật ký kỹ thuật mở bằng nút riêng khi cần. Trên điện thoại, các nút tự xuống hàng và bảng rộng cuộn trong khung.

Trong **Thí sinh**, tìm theo tên hoặc mã #, lọc tài khoản có bot/đã khóa và chuyển trang khi danh sách dài. Bấm **Xóa**, nhập lại đúng tên rồi xác nhận. Tài khoản mất quyền đăng nhập, các bài đang chờ được hủy và bot biến khỏi lựa chọn trận mới. Trận và điểm cũ vẫn giữ để xem lịch sử; tên tài khoản không được dùng lại. Nếu bài đang được kiểm tra, cần chờ kiểm tra xong rồi xóa. Khóa tài khoản dùng khi chỉ muốn tạm ngừng và có thể mở lại.

## Admin: chọn và sửa luật

Mở **Quản lý bộ luật**, chọn luật có sẵn hoặc **Tạo bộ luật mới**. Đặt tên, chỉnh cấu hình và bấm **Lưu bộ luật**. Mỗi lần lưu được đánh số tự động; đó là phiên bản luật, không phải bản nộp của bot. Ví dụ bản 1 giới hạn 500 nước, bản 2 giới hạn 100 nước: trận cũ giữ bản 1, trận mới có thể chọn bản 2. Lịch sử chỉ hiện khi bộ luật đã có nhiều lần lưu.

Trong **Đấu thử theo bộ luật**, chọn luật (thường là bản mới nhất), hai bot và seed rồi chạy. Các bản cũ được ghi rõ để kiểm tra lại khi cần. Trận thử không cập nhật điểm, Elo hay bot đang chọn. Vòng Elo hiện dùng Classic mặc định; việc lưu luật chỉ bổ sung lựa chọn cho đấu thử. Bracket và cửa sổ nộp lại bot chưa có.
