# Rà soát trải nghiệm người mới

Rà soát ban đầu: 19/10/2026. Cập nhật sau merge: 21/10/2026. Đối tượng: sinh viên năm nhất, ban tổ chức và giám khảo ngoài chuyên môn.

## Phạm vi

Rà cấu trúc dự án, tài liệu cài đặt và điều hành, giao diện dùng chung admin/portal, điều hướng, nộp bài, bảng điểm, bản xem lại và các API tương ứng. Đây là rà soát khả năng sử dụng; chưa phải kiểm toán từng dòng mã hoặc nghiệm thu toàn bộ hệ thống.

## Vấn đề và thay đổi

| Vấn đề | Thay đổi trong đợt này |
| --- | --- |
| Mở ứng dụng chưa biết bot là gì và bắt đầu ở đâu | Mục Bắt đầu mặc định, giải thích sản phẩm bằng tiếng Việt, hướng dẫn 4 bước theo vai trò |
| Tài liệu cài đặt khiến thí sinh tưởng phải cài Docker | Tách hướng dẫn cho người tham gia và người vận hành ngay đầu tài liệu |
| Có thể nhầm bài luyện tập với bài dự thi | Nhắc chọn đúng giải/giai đoạn ở hướng dẫn và đầu biểu mẫu |
| Mô tả bản mới nhất không đúng khi đã chọn riêng bot cho giải | Sửa nội dung, nhắc kiểm tra lựa chọn và bản chốt bất biến |
| Vòng điểm cũ dễ bị hiểu là giải chính thức | Đổi tên điều hướng thành Điểm ngoài giải; thu gọn bảng điểm cũ; cảnh báo trong hướng dẫn cũ |
| Một file cũng phải đọc tùy chọn ZIP | Thu gọn tùy chọn file chính trong ZIP |
| Thuật ngữ khó hiểu với người ngoài chuyên môn | Giải thích bot, phiên bản, chốt bot, cặp đấu và hạt giống; kịch bản giới thiệu cho giám khảo |
| Có thể bấm Hủy khi bắt buộc đổi mật khẩu, mất chỗ thao tác | Ẩn nút Hủy trong bước bắt buộc; giữ nút khi đổi mật khẩu tự nguyện |

Nguyên tắc: có thể đi thẳng đến chức năng bằng thanh điều hướng hoặc liên kết; không bắt hoàn thành bài hướng dẫn. Không tự chọn giải hay tự thay bot giúp người dùng vì dễ nộp sai ngữ cảnh.

## Còn cần cải thiện và kiểm chứng

- Đã bổ sung thẻ bước tiếp theo theo trạng thái, nút chuyển đến thao tác (không tự thực thi), tóm tắt cấu hình và phần chỉnh số đội/vòng/ván thu gọn. Chưa nghiệm thu trực quan; các điều khiển nghiệp vụ vẫn được giữ để kiểm tra đầy đủ.
- Sau merge 21/10/2026 đã có trang kết quả công khai `/site/`, bảng điểm và replay theo bản do ban tổ chức công bố. Đã kiểm chứng luồng công bố/xem kết quả trên DB QA. Các kết quả kiểm thử ghi ngày 19/10 bên dưới là bằng chứng lịch sử trước merge.
- Cần cho sinh viên và giám khảo thật thử: tự nộp mẫu vào đúng giải, tìm bản đã chọn, mở bản xem lại, phân biệt kết quả tạm thời/đã duyệt; ghi thời gian và chỗ cần trợ giúp.
- Chưa kiểm chứng trực quan trên trình duyệt trong đợt này: thử kết nối máy chủ localhost:3000 bị từ chối. Cần kiểm tra desktop/mobile, bàn phím và luồng đăng nhập trên máy đang chạy ứng dụng.

## Kiểm chứng

- `node --check web/workspace.js`: đạt.
- `npm test`: 111/111 đạt khi chạy ngoài sandbox; lần đầu trong sandbox bị EACCES khi test kết nối localhost.
- Đợt tiếp TODO: `npm test` 115/115 đạt, có 4 test mới bao phủ hướng dẫn khi danh sách chưa lưu, chờ mở, nhận/chốt bài, vòng loại, đổi luật/nộp lại, loại trực tiếp, tạm dừng, hủy và duyệt kết quả. Web cổng 3000 hoạt động; HTTP trực tiếp trả HTML có thẻ tiến độ nhưng phiên trình duyệt kiểm tra vẫn hiện bản cũ, nên chưa xác nhận trực quan phần mới.
- Chưa chạy lại integration Docker; thay đổi chỉ ở giao diện và tài liệu, không sửa engine, API hoặc dữ liệu giải.
