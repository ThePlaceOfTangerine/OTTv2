# Thể thức giải OTTv2

Cập nhật: 20/10/2026. Dành cho ban tổ chức (BTC) và thí sinh.

Tài liệu này tóm tắt luật thi đấu. Chi tiết thao tác của admin nằm trong [QUY-TAC-GIAI-DAU.md](QUY-TAC-GIAI-DAU.md); luật bàn cờ trong [RULE-SETS.md](RULE-SETS.md); giao thức bot trong [PROTOCOL.md](PROTOCOL.md).

Các giá trị có ghi "BTC chọn" phải được công bố trong thông báo giải ([ANNOUNCEMENT.md](ANNOUNCEMENT.md)) trước khi mở nhận bài. Sau khi mở nhận bài, các giá trị này không đổi được.

## 1. Đội và tài khoản

- Mỗi đội có **một tài khoản**, gồm 1–4 thành viên do trưởng đội khai báo trong portal (D09).
  - BTC tạo tài khoản bằng CSV `team_id,password_temp,team_name,leader_email`.
  - Lần đăng nhập đầu, trưởng đội phải đổi mật khẩu.
- Mọi thành viên dùng chung tài khoản của đội; có thể đăng nhập cùng lúc trên nhiều máy.
- Quy mô thiết kế: 1.000 đội (D01). Vòng loại hỗ trợ tối đa 4.000 bot.

## 2. Nộp bài

| Mục | Quy định |
|---|---|
| Ngôn ngữ | Python 3.11 hoặc C++17 (g++ 12, có sẵn `nlohmann/json.hpp`). |
| Cách nộp | **GitHub:** repo Private, cài GitHub App chỉ đọc, nộp theo commit (nút hoặc tag `ott-submit`); khi hết hạn, hệ thống lấy commit cuối nhận được trước hạn. **Upload:** file `.py`/`.cpp` tối đa 1 MiB, hoặc ZIP tối đa 5 MiB và 64 file. **USB tại bàn BTC:** khi thi LAN, nếu mạng của đội lỗi. Chi tiết trong [GITHUB.md](GITHUB.md). |
| Mốc thời gian | Mở và đóng theo giờ Việt Nam. Bài tính theo **thời điểm nhận** có biên nhận; bài nhận trước hạn vẫn được kiểm tra xong sau hạn. |
| Đang chờ kiểm tra | Tối đa 3 bài mỗi đội. |
| Kiểm tra bài | Quét tĩnh (cấm thư viện/lệnh hệ thống, file, mạng, tiến trình con), biên dịch, rồi **2 ván thử đổi bên với bot mẫu**. Không bắt buộc thắng bot mẫu. |
| Bot thi đấu | Bản được đội chọn nếu bản đó hợp lệ. Nếu không chọn, dùng bản hợp lệ mới nhất trước hạn. BTC **chốt bot**, sau đó bot không đổi được nữa. |

Thí sinh nên chạy thử bot trước bằng `ott-run` / `chay-thu.bat` ([LOP-HOC.md](LOP-HOC.md)): dùng cùng engine, luật và giới hạn với máy chấm.

## 3. Giới hạn khi bot chạy

Mỗi nước đi chạy trong sandbox: Docker hoặc WSL2/bwrap ở giải chính thức. Gói lớp học dùng `windows-job` và chỉ cho kết quả không chính thức.

| Giới hạn | Mức |
|---|---|
| CPU mỗi nước | 500 ms |
| Tổng CPU cả ván | 30 giây |
| Thời gian trả lời mỗi nước | 3 giây |
| Bộ nhớ | 256 MB |
| Dữ liệu in ra | 64 KB mỗi nước, đúng 1 dòng JSON |
| Dữ liệu ghi nhớ (`userdata`) | 16 KB |
| Thư mục ghi được | `/tmp` 16 MB, thư mục làm việc 64 MB |

## 4. Lỗi bot và lỗi hạ tầng

- **Lỗi bot:** crash, quá giờ, nước sai, sai định dạng, vượt giới hạn, thao tác bị cấm. Bot đó **thua ván**; replay ghi rõ lý do.
- **Lỗi hạ tầng:** máy chấm chết, mất điện, lỗi mạng giữa coordinator và máy chấm.
  - Không ai bị xử thua; ván được chạy lại.
  - Hệ thống tự thử lại tối đa 3 lần, sau đó dừng chờ BTC xử lý.
- Mọi ván đều lưu bộ luật (`rule_set_id`), seed, nhật ký và replay để kiểm tra lại.

## 5. Vòng loại (Swiss)

| Mục | Quy định |
|---|---|
| Số lượt | BTC chọn (mặc định 8). Số lượt phải nhỏ hơn số bot đã chốt. |
| Ván mỗi cặp | Số chẵn, đổi bên (mặc định 2), cùng seed bàn cờ. |
| Điểm | Ván: thắng 1, hòa 0,5, thua 0. Cặp: đội hơn điểm ván được 1 điểm vòng loại, bằng nhau mỗi đội 0,5. |
| Miễn đấu | Khi số đội lẻ: 1 điểm vòng loại, không có ván giả; mỗi đội được miễn đấu tối đa một lần. |
| Xếp hạng | Điểm vòng loại → tổng điểm đối thủ (Buchholz) → điểm đối thủ có trọng số (Sonneborn-Berger) → điểm ván → bốc thăm theo mã ghép lịch đã lưu. |
| Ghép cặp | Đội gần điểm gặp nhau, không gặp lại đối thủ cũ. Giải trên 256 đội ghép theo khối 256 hạng liên tiếp ([SWISS.md](SWISS.md)). |

Bảng điểm có thêm cột biến động hạng và 4 huy hiệu (Bất bại, Chuỗi thắng, Bot mẫu mực, Ngược dòng). Hai cột này **chỉ để hiển thị**, không ảnh hưởng thứ hạng.

## 6. Đi tiếp và loại trực tiếp

1. BTC duyệt **Top N** (BTC chọn, mặc định 16) theo đúng thứ hạng vòng loại, không chọn đội tùy ý. Hạt giống bằng thứ hạng.
2. BTC có thể **công bố luật chính thức mới** và mở cửa sổ nộp lại cho đội đi tiếp.
   - Đề xuất 60 phút.
   - Khi đã mở nộp lại, đội phải có bài hợp lệ theo luật mới; không tự dùng lại bot cũ.
3. **Loại trực tiếp:**
   - Sơ đồ cố định theo hạt giống; hạt giống 1 và 2 ở hai nửa.
   - Thiếu đội thì hạt giống cao được miễn đấu.
   - Mỗi cặp chơi số ván lẻ (BTC chọn; D14 đề xuất 3, phần mềm mặc định 5), đổi bên.
   - Bằng điểm thì đấu thêm từng cặp 2 ván (tối đa theo cấu hình, mặc định 3 cặp). Vẫn bằng thì hạt giống tốt hơn đi tiếp.
4. **Chung kết** có thể chạy trên LAN không cần Internet (D14), đồng bộ dữ liệu bằng bundle ký số ([RUNBOOK.md](RUNBOOK.md)). Máy chấm và máy thí sinh có thể khởi động từ USB ([USB-BOOT.md](USB-BOOT.md)).

## 7. Công bố và khiếu nại

- Kết quả công khai là các **bản công bố đánh số** (v1, v2…), không sửa được. Bản nào chưa duyệt đội đi tiếp thì ghi "tạm tính".
- Mỗi đội có **mã tra cứu** riêng để xem kết quả của mình trên site công khai.
- Khiếu nại (D07, đề xuất): trong 30 phút sau mỗi bản công bố tạm.
  - Ghi mã trận hoặc mã bài và lý do.
  - BTC lưu người quyết định, lý do và thời điểm.
  - Kết quả cũ không bị xóa.
- Chạy lại một ván vì lỗi hạ tầng không bảo đảm ra đúng nước đi cũ nếu bot dùng số ngẫu nhiên riêng; replay của mọi lần chạy đều được lưu.

## 8. Ngoài phạm vi phần mềm

Thể lệ về đạo văn, chia sẻ code giữa các đội, chi phí, giải thưởng và tư cách thí sinh do BTC quy định riêng. Phần mềm không tự phát hiện việc hai đội dùng chung code.
