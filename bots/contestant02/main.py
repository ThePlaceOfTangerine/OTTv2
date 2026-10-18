"""Bot thử nghiệm cho contestant02: tiến về nhà đối thủ và tránh bị ăn."""
import json
import sys

request = json.loads(sys.stdin.readline())
player = request['player_index']
rules = request['rules']
board = request['state']['board']
home = rules['homes'][1 - player]
recent = (request.get('userdata') or {}).get('recent', [])


def score(move):
    row, col = move['toRow'], move['toCol']
    piece = board[move['fromRow']][move['fromCol']]
    if row == home['row'] and col == home['col']:
        return 100000
    value = -max(abs(row - home['row']), abs(col - home['col']))
    if board[row][col] is not None:
        value += 8
    # Quân địch có thể ăn quân vừa di chuyển ở lượt tiếp theo hay không?
    for dr, dc in rules['directions']:
        enemy_row, enemy_col = row - dr, col - dc
        if 0 <= enemy_row < len(board) and 0 <= enemy_col < len(board[0]):
            enemy = board[enemy_row][enemy_col]
            if enemy and enemy['player'] != player:
                if rules['beats'][enemy['type']] == piece['type']:
                    value -= 5
    if [row, col] in recent:
        value -= 2
    return value


move = max(request['legal_moves'], key=score)
recent = (recent + [[move['toRow'], move['toCol']]])[-4:]
print(json.dumps({
    'request_id': request['request_id'],
    'move': move,
    'userdata': {'recent': recent}
}), flush=True)
