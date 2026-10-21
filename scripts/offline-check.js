// npm run offline:check — readiness of this machine for a LAN-only final (no Internet). Errors exit 1; warnings do not.
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { createSandboxManager } = require('../src/sandbox');

const root = path.resolve(__dirname, '..'), errors = [], warnings = [], ok = [];
// Resources a page loads by itself (not plain links a person may click).
const EXTERNAL = /(?:<script[^>]+src|<link[^>]+href|<img[^>]+src)\s*=\s*["']https?:\/\/[^"']+|url\(\s*["']?https?:\/\/[^)"']+|@import\s+["']?https?:\/\/[^"' ;]+|\.src\s*=\s*["']https?:\/\/[^"']+|fetch\(\s*["']https?:\/\/[^"']+/g;

async function scan(dir, area) {
  for (const entry of await fs.readdir(path.join(root, dir), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(html|js|css)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), text = await fs.readFile(file, 'utf8');
    for (const match of text.match(EXTERNAL) || []) {
      const where = `${path.relative(root, file)}: ${match.slice(0, 90)}`;
      if (area === 'legacy') warnings.push(`Khu /legacy (không dùng trong giải) tải tài nguyên ngoài, offline sẽ dùng font hệ thống: ${where}`);
      else if (match.includes('challenges.cloudflare.com')) (process.env.TURNSTILE_SITE_KEY ? errors : ok).push(process.env.TURNSTILE_SITE_KEY ? 'TURNSTILE_SITE_KEY đang đặt: form nộp file cần Internet để xác minh. Bỏ biến này khi thi LAN.' : 'Turnstile chỉ tải khi đặt TURNSTILE_SITE_KEY (đang tắt).');
      else errors.push(`Giao diện cần tài nguyên ngoài: ${where}`);
    }
  }
}
const reachable = () => new Promise(resolve => {
  const socket = net.connect({ host: '1.1.1.1', port: 443, timeout: 2000 }, () => { socket.destroy(); resolve(true); });
  socket.on('timeout', () => { socket.destroy(); resolve(false); }); socket.on('error', () => resolve(false));
});

(async () => {
  await scan('web', 'app'); await scan('web-public', 'app'); await scan('public', 'legacy');
  if (!errors.some(e => e.startsWith('Giao diện'))) ok.push('Giao diện thí sinh/admin và trang kết quả không tải tài nguyên ngoài.');
  for (const [key, message] of [['GITHUB_APP_ID', 'Nộp bằng GitHub cần Internet; khi thi LAN thí sinh nộp file qua portal hoặc BTC nhập từ USB.'],
    ['GOOGLE_SHEET_ID', 'Đồng bộ Google Sheets sẽ xếp hàng chờ và thử lại khi có mạng; không ảnh hưởng kết quả.'],
    ['CLOUDFLARE_API_TOKEN', 'Đẩy trang kết quả lên Cloudflare sẽ lỗi khi không có mạng; xem kết quả tại /site/ trên máy chủ LAN.']])
    if (process.env[key]) warnings.push(`${key} đang đặt: ${message}`);
  if (process.env.SITE_AUTO_DEPLOY === '1') warnings.push('SITE_AUTO_DEPLOY=1: mỗi lần công bố sẽ thử đẩy lên Cloudflare và báo lỗi khi offline.');
  if (!process.env.HOST || ['127.0.0.1', 'localhost'].includes(process.env.HOST)) warnings.push('HOST đang là 127.0.0.1: máy thí sinh trong LAN không vào được. Đặt HOST=0.0.0.0 và mở firewall cổng PORT.');
  else ok.push(`HOST=${process.env.HOST}: nhận kết nối từ LAN.`);
  if (!process.env.SNAPSHOT_DIR) warnings.push('Chưa đặt SNAPSHOT_DIR: không có snapshot định kỳ ra ổ ngoài.');
  else ok.push(`Snapshot định kỳ vào ${process.env.SNAPSHOT_DIR}.`);
  try { const info = await createSandboxManager().check(); ok.push(`Sandbox ${info.backend || 'docker'} hoạt động (image ${String(info.image).slice(0, 19)}).`); }
  catch (error) { errors.push(`Sandbox không hoạt động: ${error.message}`); }
  ok.push(await reachable() ? 'Máy đang có Internet (không bắt buộc cho thi LAN).' : 'Không có Internet: kiểm tra đang chạy ở chế độ offline.');
  for (const [label, list] of [['OK', ok], ['CẢNH BÁO', warnings], ['LỖI', errors]]) for (const line of list) console.log(`[${label}] ${line}`);
  process.exitCode = errors.length ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
