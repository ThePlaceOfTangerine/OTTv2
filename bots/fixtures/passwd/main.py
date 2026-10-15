import sys
try:
    with open('/etc/passwd') as file:
        print('UNEXPECTED_FILE_ACCESS:' + file.read(), file=sys.stderr)
except PermissionError:
    print('PASSWD_DENIED', file=sys.stderr)
    sys.exit(42)
