import json
import sys

# PHẦN ĐỌC DỮ LIỆU: giữ nguyên để nhận một lượt từ hệ thống.
request = json.loads(sys.stdin.readline())
board = request['state']['board']
player = request['player_index']
rules = request['rules']
home = rules['homes'][1 - player]
# Luật cũ không có powerUps: khi đó danh sách này rỗng.
power_ups = request['state'].get('powerUps', [])
# Luật mới mô tả ô trong state['tiles'] (type + tags); loại ô có "effect"
# trong rules['tileTypes'] là ô hiệu ứng (wildcard, shield, dash...).
tile_types = rules.get('tileTypes', {})
effect_tiles = {(t['row'], t['col']) for t in request['state'].get('tiles', [])
                if tile_types.get(t['type'], {}).get('effect')}

# THAY CHIẾN THUẬT Ở ĐÂY.
# Chỉ chọn từ legal_moves: hệ thống đã xét ô chặn, ô ngoài bản đồ,
# kiểu đi riêng (Xe/Tượng/Mã/... hoặc tự chỉnh) và luật ăn quân.
# Không tự giới hạn nước đi trong 1 ô hay mặc định bàn cờ 9 x 9.
def score(move):
    row, col = move['toRow'], move['toCol']
    piece = board[move['fromRow']][move['fromCol']]
    # Chiếm nhà đối thủ là thắng ngay.
    if row == home['row'] and col == home['col']:
        return 100000
    target = board[row][col]
    points = 0
    if target is not None:
        # Quân có khiên (effect == 'shield') không bị ăn: nước này chỉ làm vỡ khiên.
        points = 5 if target.get('effect') == 'shield' else 40
    # Quân đã có powered hoặc effect thì không cần ưu tiên nhặt thêm.
    has_bonus = piece.get('powered', False) or piece.get('effect')
    if not has_bonus and ([row, col] in power_ups or (row, col) in effect_tiles):
        points += 15
    # Chỉ là gợi ý tiến gần nhà, không phải số lượt cần để đến đó.
    # Với bản đồ có chướng ngại hoặc kiểu đi khác, có thể sửa cách tính này.
    distance = max(abs(row - home['row']), abs(col - home['col']))
    return points - distance

move = max(request['legal_moves'], key=score)

# PHẦN GỬI NƯỚC ĐI: giữ nguyên. Không in lời chào vào stdout.
# Muốn xem nhật ký: print("kiem tra", file=sys.stderr).
# Bot chạy lại mỗi lượt; userdata là phần nhớ, để None nếu chưa cần.
print(json.dumps({'request_id': request['request_id'], 'move': move,
                  'userdata': None}), flush=True)
