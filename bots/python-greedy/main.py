import json
import sys

# A fresh process handles one request. Keep optional memory in userdata.
request = json.loads(sys.stdin.readline())
home = request['rules']['homes'][1 - request['player_index']]
board = request['state']['board']

def score(move):
    distance = max(abs(move['toRow'] - home['row']), abs(move['toCol'] - home['col']))
    capture = 4 if board[move['toRow']][move['toCol']] else 0
    return capture - distance

move = max(request['legal_moves'], key=score)
print(json.dumps({'request_id': request['request_id'], 'move': move,
                  'userdata': {'turns': (request.get('userdata') or {}).get('turns', 0) + 1}}), flush=True)
