// Windows wrapper for the USB images (D15); the work happens as root in the ott-build WSL distro (docs/USB-BOOT.md):
//   npm run usb:build -- grader|thisinh [--with-wifi] [--out /mnt/e/OTTv2-local/usb]
//   npm run usb:test -- grader|thisinh [--bios] [--img FILE]
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [action, ...args] = process.argv.slice(2);
const repo = path.resolve(__dirname, '..');
// E:\OTTv2 → /mnt/e/OTTv2 (the drive must be mounted in WSL, which is the default).
const wslRepo = `/mnt/${repo[0].toLowerCase()}${repo.slice(2).replace(/\\/g, '/')}`;
const command = { build: ['bash', `${wslRepo}/usb/build.sh`], test: ['node', '--no-warnings', `${wslRepo}/usb/boot-test.js`] }[action];
if (!command || !['grader', 'thisinh'].includes(args[0])) {
  console.error('Cách dùng: node scripts/usb.js build|test grader|thisinh [tùy chọn]');
  process.exit(2);
}
const result = spawnSync('wsl.exe', ['-d', process.env.OTT_BUILD_DISTRO || 'ott-build', '-u', 'root', '--cd', wslRepo, '--', ...command, ...args], { stdio: 'inherit' });
if (result.error) console.error(`Không chạy được WSL (${result.error.message}). Xem docs/USB-BOOT.md để tạo distro ott-build.`);
process.exitCode = result.status ?? 1;
