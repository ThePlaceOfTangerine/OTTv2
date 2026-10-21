// OTTCONF files for the USB sticks (docs/USB-BOOT.md):
//   npm run usb:config -- grader --url http://192.168.1.10:3000 --code ott-... [--slots 2] [--out E:\]   → grader.env
//   npm run usb:config -- thisinh --portal http://192.168.1.10:3000 [--out E:\]                          → portal.env
//   npm run usb:config -- check <grader.env|portal.env>                                                   → validate a file edited by hand
//   node scripts/usb-config.js nft|firefox|wifi <portal.env>   (used at boot by the contestant USB: firewall rules, browser policy, Wi-Fi)
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv, graderConfig, portalConfig, contestantFirewall, firefoxPolicies, wifiConfig, renderGrader, renderPortal } = require('../src/usb/config');

const [command, ...rest] = process.argv.slice(2);
const arg = name => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const write = (name, text) => { const file = path.resolve(arg('out') || '.', name); fs.writeFileSync(file, text); console.log(`Đã ghi ${file}. Chép file này vào phân vùng OTTCONF của USB.`); };
const portalFile = () => parseEnv(fs.readFileSync(rest[0], 'utf8'));
try {
  if (command === 'grader') write('grader.env', renderGrader({ url: arg('url'), code: arg('code'), slots: Number(arg('slots') || 1) }));
  else if (command === 'thisinh') write('portal.env', renderPortal({ portal: arg('portal') }));
  else if (command === 'check') {
    const values = parseEnv(fs.readFileSync(rest[0], 'utf8'));
    const result = 'PORTAL_URL' in values ? { ...portalConfig(values), wifi: wifiConfig(values) ? values.WIFI_SSID : undefined } : graderConfig(values);
    console.log(`Hợp lệ: ${JSON.stringify({ ...result, code: result.code ? `${result.code.slice(0, 8)}…` : undefined })}`);
  } else if (command === 'nft') process.stdout.write(contestantFirewall(portalConfig(portalFile())));
  else if (command === 'firefox') process.stdout.write(firefoxPolicies(portalConfig(portalFile())));
  else if (command === 'wifi') process.stdout.write(wifiConfig(portalFile()) || '');
  else { console.error('Lệnh: grader --url <http://ip:cổng> --code <mã> [--slots n] [--out thư mục] | thisinh --portal <http://ip:cổng> [--out thư mục] | check <file> | nft|firefox|wifi <portal.env>'); process.exitCode = 2; }
} catch (error) { console.error(error.message); process.exitCode = 1; }
