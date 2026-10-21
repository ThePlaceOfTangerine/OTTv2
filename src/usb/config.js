// OTTCONF files on the USB sticks (D15): FAT32 partition edited with Notepad on Windows, read at boot by the live system.
// grader.env → USB grader (coordinator URL, enrollment code, slots). portal.env → contestant USB (portal address, firewall).
const net = require('node:net');
const fail = message => { throw new Error(message); };

// KEY=value per line; # comments; tolerates the UTF-8 BOM and CRLF that Notepad writes, and optional quotes. Never evaluated as shell.
function parseEnv(text) {
  const values = {};
  String(text).replace(/^﻿/, '').split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) fail(`Dòng ${index + 1} không đúng dạng TÊN=giá trị: ${trimmed.slice(0, 40)}`);
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  });
  return values;
}
function httpUrl(value, name) {
  let url; try { url = new URL(value); } catch { fail(`${name} phải là địa chỉ dạng http://192.168.1.10:3000`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) fail(`${name} chỉ gồm http(s)://máy:cổng, không có đường dẫn hay mật khẩu.`);
  return url;
}
function graderConfig(values) {
  const url = httpUrl(values.COORDINATOR_URL, 'COORDINATOR_URL'), slots = Number(values.GRADER_SLOTS || 1);
  if (!/^ott-[A-Za-z0-9_-]{20,80}$/.test(values.GRADER_ENROLL_CODE || '')) fail('GRADER_ENROLL_CODE phải là mã đăng ký bắt đầu bằng ott- (admin → Giám sát → Mở đợt đăng ký máy chấm).');
  if (!Number.isInteger(slots) || slots < 1 || slots > 16) fail('GRADER_SLOTS từ 1 đến 16.');
  return { url: url.origin, code: values.GRADER_ENROLL_CODE, slots };
}
// The contestant firewall allows exactly one address, so the portal must be an IPv4 literal: no DNS to trust or to leak through.
function portalConfig(values) {
  const url = httpUrl(values.PORTAL_URL, 'PORTAL_URL');
  if (net.isIPv4(url.hostname) !== true) fail('PORTAL_URL phải dùng địa chỉ IPv4 của máy chủ (ví dụ http://192.168.1.10:3000), không dùng tên miền.');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return { url: url.origin, ip: url.hostname, port };
}
// nftables for the contestant USB: only DHCP and TCP to the portal; everything else (Internet, other PCs, IPv6, DNS) is dropped.
function contestantFirewall({ ip, port }) {
  if (net.isIPv4(ip) !== true || !Number.isInteger(port) || port < 1 || port > 65535) fail('Địa chỉ portal không hợp lệ.');
  return `flush ruleset
table inet ott {
  chain input {
    type filter hook input priority 0; policy drop;
    iif lo accept
    ct state established,related accept
    udp sport 67 udp dport 68 accept
  }
  chain output {
    type filter hook output priority 0; policy drop;
    oif lo accept
    ct state established,related accept
    udp sport 68 udp dport 67 accept
    ip daddr ${ip} tcp dport ${port} accept
    ip daddr ${ip} icmp type echo-request accept
  }
  chain forward { type filter hook forward priority 0; policy drop; }
}
`;
}
// Firefox ESR enterprise policy for the contestant desktop: home page = portal, every other address blocked (own bot replays on disk allowed).
function firefoxPolicies({ url }) {
  return JSON.stringify({ policies: {
    Homepage: { URL: `${url}/portal`, Locked: true, StartPage: 'homepage' }, OverrideFirstRunPage: '', OverridePostUpdatePage: '', NoDefaultBookmarks: true,
    // Match patterns cannot carry a port (with one, Firefox blocks the portal too); the firewall already limits the port.
    WebsiteFilter: { Block: ['<all_urls>'], Exceptions: [`${new URL(url).protocol}//${new URL(url).hostname}/*`, 'file:///home/thisinh/*'] },
    DisableTelemetry: true, DisableFirefoxStudies: true, DisablePocket: true, DisableFirefoxAccounts: true, DisableAppUpdate: true, DisableProfileImport: true,
    DontCheckDefaultBrowser: true, BlockAboutConfig: true, BlockAboutProfiles: true, DisablePrivateBrowsing: true, PasswordManagerEnabled: false,
    ExtensionSettings: { '*': { installation_mode: 'blocked' } }, DNSOverHTTPS: { Enabled: false, Locked: true }
  } }, null, 2);
}
// Optional Wi-Fi for the --with-wifi image (WIFI_SSID / WIFI_PASSWORD in portal.env); the firewall is the same as on cable.
function wifiConfig(values) {
  if (!values.WIFI_SSID) return null;
  const ssid = values.WIFI_SSID, password = values.WIFI_PASSWORD || '';
  if (!/^[\x20-\x7e]{1,32}$/.test(ssid) || /["\\]/.test(ssid)) fail('WIFI_SSID 1–32 ký tự không dấu, không chứa " hoặc \\.');
  if (password && (!/^[\x20-\x7e]{8,63}$/.test(password) || /["\\]/.test(password))) fail('WIFI_PASSWORD 8–63 ký tự không dấu, không chứa " hoặc \\ (để trống nếu mạng không có mật khẩu).');
  return `ctrl_interface=\nupdate_config=0\nnetwork={\n  ssid="${ssid}"\n  ${password ? `psk="${password}"` : 'key_mgmt=NONE'}\n}\n`;
}
const crlf = text => text.replace(/\r?\n/g, '\r\n');
function renderGrader({ url, code, slots = 1 }) {
  const checked = graderConfig({ COORDINATOR_URL: url, GRADER_ENROLL_CODE: code, GRADER_SLOTS: String(slots) });
  return crlf(`# USB máy chấm OTTv2. Sửa bằng Notepad được; mỗi dòng TÊN=giá trị.
# Địa chỉ máy chủ (coordinator) trong phòng thi:
COORDINATOR_URL=${checked.url}
# Mã đăng ký: admin → Giám sát → "Mở đợt đăng ký máy chấm". Chỉ dùng được khi đợt đang mở.
GRADER_ENROLL_CODE=${checked.code}
# Số việc chấm cùng lúc (1–16), thường bằng số nhân CPU chia 2:
GRADER_SLOTS=${checked.slots}
`);
}
function renderPortal({ portal }) {
  const checked = portalConfig({ PORTAL_URL: portal });
  return crlf(`# USB máy thí sinh OTTv2. Sửa bằng Notepad được.
# Địa chỉ IPv4 của máy chủ portal; máy thí sinh chỉ được kết nối tới đúng địa chỉ và cổng này.
PORTAL_URL=${checked.url}
# Chỉ với USB build --with-wifi: bỏ dấu # và điền tên/mật khẩu Wi-Fi của phòng thi.
# WIFI_SSID=PhongThi
# WIFI_PASSWORD=matkhauwifi
`);
}
module.exports = { parseEnv, graderConfig, portalConfig, contestantFirewall, firefoxPolicies, wifiConfig, renderGrader, renderPortal };
