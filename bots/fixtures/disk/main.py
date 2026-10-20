import sys
# Red team: fill the sandbox's writable folders 8 MB file by file (RLIMIT_FSIZE caps one file, not the folder).
written = 0
try:
    for folder in ('/tmp', '/work'):
        for i in range(1000):
            with open(f'{folder}/fill-{i}', 'wb') as f:
                f.write(b'\0' * (8 * 1024 * 1024))
            written += 8
            print(written, file=sys.stderr, flush=True)
except OSError as error:
    print(f'DISK_FULL {written}MB {error.errno}', file=sys.stderr)
    sys.exit(44)
print(f'UNEXPECTED_DISK_UNLIMITED {written}MB', file=sys.stderr)
sys.exit(45)
