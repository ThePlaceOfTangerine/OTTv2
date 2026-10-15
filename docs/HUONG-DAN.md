# Cách hoạt động và sử dụng OTTv2

## Web này dùng để làm gì?

Thí sinh viết chương trình tự chọn nước đi (bot), nộp lên web; máy chủ chạy bot trong Docker, kiểm tra rồi cho đấu tự động. Người xem chỉ theo dõi bàn cờ, không điều khiển thay bot. Khu vực “Chơi trực tiếp” là game người chơi tự đi quân, dùng luật legacy riêng.

Hiện ứng dụng chạy tại `http://127.0.0.1:3000` trên máy đang bật server. Địa chỉ này chỉ trỏ về chính máy đang mở trình duyệt; chưa cấu hình để máy khác trong mạng truy cập. Máy chủ cần Node.js và Docker Desktop đang hoạt động để xử lý bot. Người dùng không cần tự gõ lệnh Docker cho từng bài.

## Thí sinh: từ mẫu đến thi đấu

1. Mở `/portal`, đăng nhập bằng tài khoản ban tổ chức cấp. Lần đầu, nhập mật khẩu được cấp và đặt mật khẩu mới (ít nhất 12 ký tự, tối đa 72 byte, nhập lại khớp). Phải hoàn tất bước này trước khi dùng tài khoản. Sau này có thể bấm “Đổi mật khẩu”; khi admin reset, cần đổi lại mật khẩu tạm.
2. Tải Mã mẫu Python hoặc Mã mẫu C++. Mẫu đã đọc/ghi dữ liệu đúng giao thức, chọn nước hợp lệ đầu tiên. Có thể nộp nguyên mẫu để tập sử dụng; sau đó sửa phần được chú thích “THAY CHIẾN THUẬT Ở ĐÂY”. Mẫu hợp lệ không có nghĩa là chiến thuật mạnh.
3. Chọn file `.py` hoặc `.cpp`. Nếu nhiều file, nén ZIP chứa source. File đơn tối đa 1 MiB, ZIP tối đa 5 MiB và 64 file source; không nộp chương trình đã biên dịch hoặc gói cài thư viện.
4. Với file đơn, để trống “File chạy chính”. Với ZIP, có thể để trống khi có main.py/main.cpp rõ ràng; nếu hệ thống không xác định được, nhập đường dẫn tương đối như `src/main.py`. Các file C++ được liên kết cùng nhau, chỉ nên có một hàm main.
5. Bấm “Nộp bot”. Trang tự cập nhật; không cần liên tục nộp lại hay tải lại trang. Mỗi lần nộp tạo bản v1, v2…
6. Đọc trạng thái theo bảng bên dưới. Khi hợp lệ, bấm “Chi tiết & trận thử”, chọn trận rồi bấm “Tự động chạy”; dùng tạm dừng, tốc độ, thanh kéo và “Về đầu” để phân tích nước đi.
7. Bản hợp lệ mới nhất tự được chọn làm ACTIVE. Muốn dùng bản cũ, bấm “Dùng bản này cho vòng mới”. Bài mới bị từ chối không thay bản ACTIVE trước đó.
8. Chờ ban tổ chức tạo vòng điểm. Danh sách và bản bot được chốt lúc vòng bắt đầu; đổi ACTIVE sau đó chỉ ảnh hưởng vòng mới. Chọn vòng ở “Bảng xếp hạng” để xem Elo, số ván và thắng/hòa/thua.

| Trạng thái | Ý nghĩa / việc cần làm |
| --- | --- |
| Chờ kiểm tra (Queued) | Đã nhận bài, chờ slot máy xử lý. Không cần nộp lại. |
| Kiểm tra mã (Scanning) | Kiểm tra file, giải nén và thao tác bị cấm. |
| Chuẩn bị chương trình (Compiling) | Kiểm tra cú pháp Python hoặc biên dịch C++17. |
| Đấu thử (Test match) | Hai ván đổi bên với bot mẫu. Không tính điểm; không bắt buộc thắng. |
| Hợp lệ (Accepted) | Chạy đúng trong hai trận thử, có thể chọn cho vòng điểm. Không bảo đảm không bao giờ lỗi trong các tình huống khác. |
| Cần sửa (Rejected) | Xem lý do và nhật ký, sửa code rồi nộp bản mới. |
| Lỗi hạ tầng | Máy chủ/Docker gặp sự cố, tự thử tối đa 3 lần; nếu dừng, bấm “Thử lại” hoặc báo ban tổ chức. Không quy thành lỗi bot. |

## Bot nhận dữ liệu ra sao?

Mỗi lượt, máy chủ chạy chương trình và đưa một dòng JSON vào stdin. Bot đọc bàn cờ (`state.board`), bên của mình (`player_index`) và danh sách nước được phép (`legal_moves`). Bot trả một dòng JSON qua stdout, gồm `request_id` giữ nguyên và `move` là nước đã chọn. Không có giao diện hay thao tác chuột bên trong bot.

Bot khởi động lại mỗi lượt, nên biến toàn cục không giữ được trí nhớ; dùng `userdata` để nhận lại thông tin ở lượt tiếp theo. Ghi debug vào stderr, không in lời chào lên stdout. Giới hạn mặc định: 500 ms CPU/nước, 30 giây CPU/bot/trận, 256 MiB bộ nhớ tiến trình; tổng output stdout + stderr mỗi nước tối đa 64 KiB. Bot không được mở mạng, tạo tiến trình hoặc truy cập file ngoài phạm vi cho phép.

Đặc tả đầy đủ và ví dụ: [PROTOCOL.md](PROTOCOL.md).

## Admin: điều hành một vòng điểm

1. Mở `/admin`, đăng nhập tài khoản admin. Tài khoản thí sinh không vào được API quản trị.
2. Tạo tài khoản qua CSV có dòng đầu `username,password`. Ví dụ:

   ```csv
   username,password
   team001,
   team002,
   ```

   Mật khẩu để trống được tạo ngẫu nhiên. Lưu phần thông tin trả về rồi bấm “Ẩn mật khẩu”; hệ thống chỉ lưu bản hash. CSV sai hoặc trùng tài khoản bị từ chối toàn bộ. Không dùng import để sửa mật khẩu tài khoản cũ.
3. Dùng “Cấp lại mật khẩu” khi cần cấp mật khẩu mới; “Khóa” khi cần ngăn đăng nhập. Các thao tác này hủy phiên đăng nhập cũ. Khóa sau khi vòng đã bắt đầu không thay lịch đấu đã chốt.
4. Theo dõi “Bộ xử lý và hàng đợi”: worker là bộ xử lý tự động, slot là số bài/trận có thể chạy cùng lúc. “Xem nhật ký” mở thông tin bài nộp và các trận thử. Khi có trận đang chơi, nút xem trực tiếp xuất hiện.
5. Cần ít nhất hai tài khoản đang mở có bot ACTIVE Accepted. Nhập seed, số ván mỗi bot và số ván mỗi cặp. Thử ban đầu: 2 ván/bot và 2 ván/cặp. Mỗi cặp chơi đổi bên trên cùng seed; seed quyết định việc ghép cặp và bố trí trận, không phải mật khẩu.
6. Số ván/bot phải chia hết số ván/cặp; số ván/cặp chẵn từ 2–20; số đối thủ nhỏ hơn số bot. Với số bot lẻ, chọn số đối thủ chẵn, ví dụ 3 bot: 4 ván/bot, 2 ván/cặp.
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

Khung “Hướng dẫn và mã mẫu” nằm ở đầu trang thí sinh, có thể đọc trước khi đăng nhập. Chọn “Giao thức và luật chơi” để đọc quy định, hoặc tải một mã mẫu Python/C++. Các đường dẫn đọc và tải mẫu không yêu cầu đổi mật khẩu; thao tác nộp bài vẫn yêu cầu đăng nhập và hoàn tất đổi mật khẩu tạm.

## Admin: chọn và sửa luật

Mở **Quản lý bộ luật**, chọn luật có sẵn hoặc **Tạo bộ luật mới**. Đặt tên, chỉnh cấu hình và bấm **Lưu bộ luật**. Mỗi lần lưu được đánh số tự động; đó là phiên bản luật, không phải bản nộp của bot. Ví dụ bản 1 giới hạn 500 nước, bản 2 giới hạn 100 nước: trận cũ giữ bản 1, trận mới có thể chọn bản 2. Lịch sử chỉ hiện khi bộ luật đã có nhiều lần lưu.

Trong **Đấu thử theo bộ luật**, chọn luật (thường là bản mới nhất), hai bot và seed rồi chạy. Các bản cũ được ghi rõ để kiểm tra lại khi cần. Trận thử không cập nhật điểm, Elo hay bot đang chọn. Vòng Elo hiện dùng Classic mặc định; việc lưu luật chỉ bổ sung lựa chọn cho đấu thử. Bracket và cửa sổ nộp lại bot chưa có.
