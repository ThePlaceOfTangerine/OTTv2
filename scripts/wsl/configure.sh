#!/bin/sh
# Called as root by setup-grader.ps1: configure.sh COORDINATOR_URL GRADER_ID GRADER_SECRET SLOTS
set -eu
for value in "$1" "$2" "$3" "$4"; do
  case "$value" in *[!A-Za-z0-9:/._-]*|'') echo "Giá trị cấu hình không hợp lệ: $value" >&2; exit 2 ;; esac
done
umask 077
printf 'COORDINATOR_URL=%s\nGRADER_ID=%s\nGRADER_SECRET=%s\nGRADER_SLOTS=%s\n' "$1" "$2" "$3" "$4" > /etc/ott-grader.env
chown grader:grader /etc/ott-grader.env
