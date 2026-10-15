import json
import sys

# Mỗi lượt chương trình đọc một dòng JSON từ stdin, rồi trả lời và thoát.
# state.board là bàn cờ; player_index là bên của bạn (0/1).
request = json.loads(sys.stdin.readline())
# THAY CHIẾN THUẬT Ở ĐÂY: mẫu chọn nước hợp lệ đầu tiên, chưa tối ưu để thắng.
# legal_moves đã chứa các nước được phép.
move = request['legal_moves'][0]
# Chỉ in một dòng JSON, giữ request_id. Ghi debug vào sys.stderr.
# Muốn nhớ giữa các lượt: thay None bằng dữ liệu JSON nhỏ (userdata).
# Chương trình khởi động lại mỗi lượt, không giữ được biến toàn cục.
print(json.dumps({'request_id': request['request_id'], 'move': move, 'userdata': None}), flush=True)
