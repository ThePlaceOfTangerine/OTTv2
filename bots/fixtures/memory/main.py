import sys
chunks = []
try:
    while True:
        chunks.append(bytearray(1024 * 1024))
except MemoryError:
    print('MEMORY_DENIED', file=sys.stderr)
    sys.exit(43)
