#!/bin/bash
# Builds a bootable USB image (D15) inside the ott-build WSL distro, as root:
#   bash usb/build.sh grader|thisinh [--with-wifi] [--out DIR] [--base ROOTFS.tar]
# Base: the grader rootfs exported from the sandbox image (scripts/wsl/build-rootfs.ps1), so g++, Python and IMAGE_ID are those of every
# other grader. Output <out>/ott-<kind>.img: MBR disk = 1 ISO9660 live system (BIOS + UEFI with Secure Boot via Debian's signed shim/GRUB),
# 2 EFI system partition, 3 OTTCONF (FAT32, edited with Notepad), 4 persistence (contestant only, ext4, only ~/bai-lam is kept).
set -euo pipefail
KIND=${1:-}; shift || true
case "$KIND" in grader|thisinh) ;; *) echo "Cách dùng: build.sh grader|thisinh [--with-wifi] [--out DIR] [--base ROOTFS.tar]" >&2; exit 2 ;; esac
WIFI=0; OUT=/mnt/e/OTTv2-local/usb; BASE=/mnt/e/OTTv2-local/ott-grader.tar
while [ $# -gt 0 ]; do
  case "$1" in --with-wifi) WIFI=1 ;; --out) OUT=$2; shift ;; --base) BASE=$2; shift ;; *) echo "Không hiểu tham số $1" >&2; exit 2 ;; esac
  shift
done
[ "$(id -u)" = 0 ] || { echo "Chạy bằng root trong distro ott-build." >&2; exit 2; }
REPO=$(cd "$(dirname "$0")/.." && pwd)
WORK=/var/tmp/ott-usb/$KIND; ROOT=$WORK/chroot; ISO=$WORK/iso
SUFFIX=$([ "$WIFI" = 1 ] && echo -wifi || true); IMG=$OUT/ott-$KIND$SUFFIX.img
log() { printf '\n== %s\n' "$*"; }
unmount() { for m in dev/pts dev proc sys run; do mountpoint -q "$ROOT/$m" 2>/dev/null && umount -l "$ROOT/$m"; done; return 0; }
trap unmount EXIT
unmount; rm -rf "$WORK"; mkdir -p "$ROOT" "$ISO/live" "$ISO/boot/grub" "$ISO/.disk" "$OUT"

log "Rootfs gốc: $BASE"
tar -xf "$BASE" -C "$ROOT"
IMAGE_ID=$(cat "$ROOT/opt/arena/IMAGE_ID")
# The current project replaces the copy made when the base was built (node_modules are pure JavaScript, copied as is).
rm -rf "$ROOT/opt/ott" && mkdir -p "$ROOT/opt/ott"
# Files on the Windows drive show up as mode 777: copy with sane modes, owned by root, so nothing in the image is world-writable.
rsync -a --chmod=D755,F644 --chown=0:0 --exclude /.git --exclude /data --exclude /output --exclude /test --exclude /dist --exclude '*.sqlite*' "$REPO/" "$ROOT/opt/ott/"
# Overlays: CRLF stripped on a private copy (never on the rootfs, which holds binaries), then installed with fixed modes.
OVERLAY=$WORK/overlay; mkdir -p "$OVERLAY"
for dir in "$REPO/usb/common/rootfs" "$REPO/usb/$KIND/rootfs"; do rsync -a --chmod=D755,F644 --chown=0:0 "$dir/" "$OVERLAY/"; done
find "$OVERLAY" -type f -exec sed -i 's/\r$//' {} +
chmod 755 "$OVERLAY"/usr/local/sbin/* "$OVERLAY"/usr/local/bin/* 2>/dev/null || true
cp -a "$OVERLAY/." "$ROOT/"
rm -f "$ROOT/etc/wsl.conf" "$ROOT/.dockerenv"

log "Cài kernel, live-boot và gói cho bản $KIND"
mount -t proc proc "$ROOT/proc"; mount -t sysfs sys "$ROOT/sys"; mount --bind /dev "$ROOT/dev"; mount --bind /dev/pts "$ROOT/dev/pts"; mount -t tmpfs tmpfs "$ROOT/run"
cp /etc/resolv.conf "$ROOT/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' > "$ROOT/usr/sbin/policy-rc.d"; chmod 755 "$ROOT/usr/sbin/policy-rc.d"
# Kernel from bookworm-backports (6.12, signed by Debian like the stable one): supervisor.py needs Landlock ABI >= 3 (kernel >= 6.2),
# bookworm's 6.1 only has ABI 2. Everything else, including g++ and Python, stays exactly as in the base rootfs.
printf 'Types: deb\nURIs: http://deb.debian.org/debian\nSuites: bookworm-backports\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' > "$ROOT/etc/apt/sources.list.d/backports.sources"
PKGS="linux-image-amd64/bookworm-backports live-boot systemd-sysv udev kmod nftables iproute2 util-linux"
case "$KIND" in
  grader) PKGS="$PKGS systemd-resolved" ;;
  thisinh) PKGS="$PKGS xserver-xorg lightdm lightdm-gtk-greeter xfce4-session xfwm4 xfce4-panel xfdesktop4 xfce4-settings xfce4-terminal thunar \
    dbus-x11 dbus-user-session adwaita-icon-theme fonts-noto-core fonts-dejavu-core tzdata firefox-esr geany" ;;
esac
if [ "$WIFI" = 1 ]; then
  sed -i 's/^Components: main$/Components: main non-free-firmware/' "$ROOT/etc/apt/sources.list.d/debian.sources"
  PKGS="$PKGS wpasupplicant firmware-iwlwifi firmware-realtek firmware-atheros firmware-brcm80211 firmware-misc-nonfree"
fi
chroot "$ROOT" sh -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends $PKGS" > "$WORK/apt.log" 2>&1 \
  || { tail -30 "$WORK/apt.log"; exit 1; }

log "Cấu hình hệ thống"
UNITS="systemd-networkd ott-conf ott-clock ott-selftest"
case "$KIND" in
  grader) UNITS="$UNITS ott-grader systemd-resolved" ;;
  thisinh) UNITS="$UNITS ott-firewall ott-portal lightdm" ;;
esac
chroot "$ROOT" systemctl enable $UNITS >/dev/null 2>&1
chroot "$ROOT" systemctl set-default "$([ "$KIND" = thisinh ] && echo graphical.target || echo multi-user.target)" >/dev/null 2>&1
chroot "$ROOT" passwd -l root >/dev/null
# No login prompt on the serial console (root is locked anyway); it would hang up the port the self-test writes to.
ln -sf /dev/null "$ROOT/etc/systemd/system/serial-getty@ttyS0.service"
printf '127.0.0.1 localhost\n127.0.1.1 %s\n' "$(cat "$ROOT/etc/hostname")" > "$ROOT/etc/hosts"
if [ "$KIND" = thisinh ]; then
  chroot "$ROOT" useradd -m -u 1001 -s /bin/bash -c "Thi sinh" thisinh
  chroot "$ROOT" groupadd -f autologin; chroot "$ROOT" usermod -aG autologin thisinh
  ln -sf /usr/share/zoneinfo/Asia/Ho_Chi_Minh "$ROOT/etc/localtime"; echo Asia/Ho_Chi_Minh > "$ROOT/etc/timezone"
  H=$ROOT/home/thisinh
  mkdir -p "$H/bai-lam" "$H/.config/geany/filedefs" "$H/.config/autostart"
  # F5 in Geany runs the pupil's bot against the sample bot (ott-run) instead of starting it waiting for input.
  for type in python cpp; do printf '[build-menu]\nEX_00_LB=Chạy thử với bot mẫu\nEX_00_CM=chay-thu "%%f"\nEX_00_WD=%%d\n' > "$H/.config/geany/filedefs/filetypes.$type"; done
  printf '[Desktop Entry]\nType=Application\nName=Soạn code\nExec=geany /home/thisinh/bai-lam/main.py\n' > "$H/.config/autostart/ott-geany.desktop"
  printf '[Desktop Entry]\nType=Application\nName=Chạy thử bot\nComment=Bot của bạn đấu 2 ván với bot mẫu, rồi mở bản xem lại\nExec=xfce4-terminal --hold -x chay-thu\nIcon=utilities-terminal\nCategories=Development;\n' > "$ROOT/usr/share/applications/ott-chay-thu.desktop"
  chroot "$ROOT" chown -R thisinh:thisinh /home/thisinh
fi
rm -f "$ROOT/usr/sbin/policy-rc.d" "$ROOT/etc/resolv.conf"; : > "$ROOT/etc/machine-id"
chroot "$ROOT" apt-get clean; rm -rf "$ROOT"/var/lib/apt/lists/* "$ROOT"/tmp/* "$ROOT"/var/tmp/*
echo "$IMAGE_ID" > "$ROOT/opt/arena/IMAGE_ID"
cp "$ROOT"/boot/vmlinuz-* "$ISO/live/vmlinuz"; cp "$ROOT"/boot/initrd.img-* "$ISO/live/initrd.img"
unmount

log "Nén hệ thống (squashfs)"
mksquashfs "$ROOT" "$ISO/live/filesystem.squashfs" -comp xz -e boot -noappend -quiet -no-progress >/dev/null
touch "$ISO/live/ott-$KIND"; echo "OTTv2 $KIND $(date -u +%Y-%m-%d)" > "$ISO/.disk/info"

log "Bootloader (BIOS + UEFI Secure Boot)"
# Grader: whole system copied to RAM, so the stick can even be pulled out; no swap, never touches the computer's disks.
PARAMS=$([ "$KIND" = grader ] && echo "toram noswap" || echo "noswap persistence persistence-storage=filesystem persistence-label=persistence")
# GRUB is locked: the entry boots without a password, but editing it (e.g. init=/bin/sh = root shell) or the GRUB shell needs the
# organizers' password. Only its PBKDF2 hash goes into the image. OTT_GRUB_PASSWORD sets it; otherwise a random one is printed once.
GRUB_PASSWORD=${OTT_GRUB_PASSWORD:-}
if [ -z "$GRUB_PASSWORD" ]; then GRUB_PASSWORD=$(head -c 12 /dev/urandom | base64 | tr -d '/+=' | head -c 16); GENERATED_PASSWORD=1; fi
[ ${#GRUB_PASSWORD} -ge 12 ] || { echo "OTT_GRUB_PASSWORD cần ít nhất 12 ký tự." >&2; exit 2; }
GRUB_HASH=$(printf '%s\n%s\n' "$GRUB_PASSWORD" "$GRUB_PASSWORD" | grub-mkpasswd-pbkdf2 -c 100000 | sed -n 's/.*is \(grub\.pbkdf2\..*\)$/\1/p')
[ -n "$GRUB_HASH" ] || { echo "Không tạo được băm mật khẩu GRUB." >&2; exit 1; }
cat > "$ISO/boot/grub/grub.cfg" <<EOF
set default=0
set timeout=3
# Menu on screen and on the serial port too (the QEMU test reads it under BIOS); editing still needs the password below.
serial --unit=0 --speed=115200
terminal_input console serial
terminal_output console serial
set superusers="btc"
password_pbkdf2 btc $GRUB_HASH
search --no-floppy --set=root --file /live/ott-$KIND
menuentry "OTTv2 - $([ "$KIND" = grader ] && echo "may cham" || echo "may thi sinh")" --unrestricted {
  linux /live/vmlinuz boot=live $PARAMS quiet console=ttyS0,115200 console=tty0
  initrd /live/initrd.img
}
EOF
cp -r /usr/lib/grub/i386-pc "$ISO/boot/grub/"
grub-mkimage -O i386-pc-eltorito -p /boot/grub -o "$ISO/boot/grub/eltorito.img" biosdisk iso9660 part_msdos search search_fs_file configfile normal linux echo test
# EFI system partition: Debian's signed shim + signed GRUB for CD media (it finds the live partition by /.disk/info, then reads /boot/grub/grub.cfg).
rm -f "$WORK/efi.img"; mkfs.fat -C -n OTT-EFI "$WORK/efi.img" 8192 >/dev/null
mmd -i "$WORK/efi.img" ::/EFI ::/EFI/BOOT
mcopy -i "$WORK/efi.img" /usr/lib/shim/shimx64.efi.signed ::/EFI/BOOT/BOOTX64.EFI
mcopy -i "$WORK/efi.img" /usr/lib/shim/mmx64.efi.signed ::/EFI/BOOT/mmx64.efi
mcopy -i "$WORK/efi.img" /usr/lib/grub/x86_64-efi-signed/gcdx64.efi.signed ::/EFI/BOOT/grubx64.efi
xorriso -as mkisofs -quiet -iso-level 3 -full-iso9660-filenames -volid "OTT_$(echo "$KIND" | tr a-z A-Z)" -R -J \
  --grub2-mbr /usr/lib/grub/i386-pc/boot_hybrid.img -partition_offset 16 -append_partition 2 0xef "$WORK/efi.img" \
  -b boot/grub/eltorito.img -no-emul-boot -boot-load-size 4 -boot-info-table --grub2-boot-info \
  -eltorito-alt-boot -e --interval:appended_partition_2:all:: -no-emul-boot -c boot/boot.cat -o "$WORK/live.iso" "$ISO"

log "Ảnh USB: thêm OTTCONF$([ "$KIND" = thisinh ] && echo " và persistence")"
MiB=$((1024 * 1024)); ISO_END=$(( ( $(stat -c %s "$WORK/live.iso") + MiB - 1 ) / MiB ))
CONF_START=$((ISO_END + 1)); CONF_MB=64; PERSIST_START=$((CONF_START + CONF_MB)); PERSIST_MB=$([ "$KIND" = thisinh ] && echo 1024 || echo 0)
cp "$WORK/live.iso" "$IMG.tmp"
truncate -s $(( (PERSIST_START + PERSIST_MB + 1) * MiB )) "$IMG.tmp"
{ echo "start=$((CONF_START * 2048)), size=$((CONF_MB * 2048)), type=c"
  if [ "$PERSIST_MB" -gt 0 ]; then echo "start=$((PERSIST_START * 2048)), size=$((PERSIST_MB * 2048)), type=83"; fi; } | sfdisk --append --no-reread -q "$IMG.tmp"
mkfs.fat -F 32 -s 1 -n OTTCONF --offset $((CONF_START * 2048)) "$IMG.tmp" $((CONF_MB * 1024)) >/dev/null 2>&1
CONF=$WORK/ottconf; mkdir -p "$CONF"
if [ "$KIND" = grader ]; then
  printf '# USB may cham OTTv2. Sua bang Notepad; tao file dung bang lenh: npm run usb:config -- grader --url ... --code ...\r\nCOORDINATOR_URL=http://192.168.1.10:3000\r\n# Ma dang ky: admin > Giam sat > "Mo dot dang ky may cham"\r\nGRADER_ENROLL_CODE=<dan-ma-dang-ky>\r\nGRADER_SLOTS=1\r\n' > "$CONF/grader.env"
else
  printf '# USB may thi sinh OTTv2. Sua bang Notepad; may thi sinh chi ket noi duoc toi dung dia chi nay.\r\nPORTAL_URL=http://192.168.1.10:3000\r\n# Chi voi USB --with-wifi: bo dau # va dien Wi-Fi cua phong thi.\r\n# WIFI_SSID=PhongThi\r\n# WIFI_PASSWORD=matkhauwifi\r\n' > "$CONF/portal.env"
fi
printf 'OTTv2 - phan vung cau hinh. Xem docs/USB-BOOT.md.\r\nImage cham: %s\r\n' "$IMAGE_ID" > "$CONF/DOC-TRUOC.txt"
mcopy -i "$IMG.tmp@@$((CONF_START * MiB))" "$CONF"/* ::/
if [ "$PERSIST_MB" -gt 0 ]; then
  P=$WORK/persist; mkdir -p "$P/bai-lam"
  echo "/home/thisinh/bai-lam source=bai-lam" > "$P/persistence.conf"
  cp "$REPO/bots/templates/python/main.py" "$REPO/bots/templates/cpp/main.cpp" "$P/bai-lam/"
  sed -i 's/\r$//' "$P/bai-lam/"*; chown -R 1001:1001 "$P/bai-lam"
  mkfs.ext4 -q -F -L persistence -E offset=$((PERSIST_START * MiB)) -d "$P" "$IMG.tmp" $((PERSIST_MB * 1024))k
fi
mv "$IMG.tmp" "$IMG"
log "Xong: $IMG ($(( $(stat -c %s "$IMG") / MiB )) MiB, image chấm $IMAGE_ID)"
sha256sum "$IMG" | tee "$IMG.sha256"
if [ "${GENERATED_PASSWORD:-0}" = 1 ]; then
  log "Mật khẩu GRUB (chỉ hiện lần này, không lưu ở đâu; cần khi phải sửa lệnh khởi động): $GRUB_PASSWORD"
fi
