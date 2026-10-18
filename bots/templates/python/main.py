import json
import sys

# PHẦN ĐỌC DỮ LIỆU: đã làm sẵn, bạn có thể giữ nguyên.
# Mỗi lượt, hệ thống gửi bàn cờ và những nước được phép đi.
request = json.loads(sys.stdin.readline())

# THAY CHIẾN THUẬT Ở ĐÂY.
# legal_moves là danh sách nước được phép; [0] chọn nước đầu tiên.
# Bạn có thể chọn nước khác trong danh sách để bot chơi tốt hơn.
# Nếu cần xem bàn cờ: request['state']['board'].
# Bên của bạn là request['player_index'] (0 hoặc 1).
move = request['legal_moves'][0]

# PHẦN GỬI NƯỚC ĐI: đã làm sẵn, bạn có thể giữ nguyên.
# Không thêm print để in lời chào vào câu trả lời này.
# Muốn tự kiểm tra code, có thể in riêng: print("kiem tra", file=sys.stderr).
# Chương trình chạy lại từ đầu mỗi lượt. userdata là phần ghi nhớ giữa các lượt;
# cứ để None nếu chưa cần dùng.
print(json.dumps({'request_id': request['request_id'], 'move': move, 'userdata': None}), flush=True)
