// USB images (D15): set the system clock from the coordinator's HTTP Date header before the grader signs requests (HMAC allows ±5 min).
// School PCs often keep the hardware clock in Vietnam time (Windows), which Linux reads as UTC: a 7-hour skew. The hardware clock is not written.
//   node scripts/usb-clock.js [config file]   (default: /run/ottconf/grader.env, else /run/ottconf/portal.env)
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { parseEnv, graderConfig, portalConfig } = require('../src/usb/config');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function serverOf(file) {
  const values = parseEnv(fs.readFileSync(file, 'utf8'));
  return 'PORTAL_URL' in values ? portalConfig(values).url : graderConfig(values).url;
}
async function serverTime(url) {
  const sent = Date.now(), response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
  const date = Date.parse(response.headers.get('date'));
  if (!Number.isFinite(date)) throw new Error('Máy chủ không trả giờ (Date).');
  return date + (Date.now() - sent) / 2;  // HTTP Date has 1 s resolution; half the round trip is noise below that
}
async function main(file = process.argv[2] || ['/run/ottconf/grader.env', '/run/ottconf/portal.env'].find(f => fs.existsSync(f))) {
  if (!file) { console.log('OTTv2: chưa có grader.env/portal.env trong OTTCONF; không chỉnh giờ.'); return; }
  const url = serverOf(file);
  for (let attempt = 1; attempt <= 90; attempt++) {
    try {
      const time = await serverTime(url), skew = time - Date.now();
      if (Math.abs(skew) > 2000) execFileSync('date', ['-u', '-s', `@${Math.round(time / 1000)}`], { stdio: 'ignore' });
      console.log(`OTTv2: giờ theo máy chủ ${url}: ${new Date(time).toISOString()} (lệch ${Math.round(skew / 1000)} giây trước khi chỉnh).`);
      return;
    } catch (error) {
      if (attempt % 10 === 1) console.log(`OTTv2: chưa kết nối được ${url} (${error.message}); thử lại...`);
      await sleep(2000);
    }
  }
  console.log(`OTTv2: không lấy được giờ từ ${url} sau 3 phút. Kiểm tra cáp mạng và địa chỉ trong OTTCONF.`);
  process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.log(`OTTv2: ${error.message}`); process.exitCode = 1; });
module.exports = { serverTime };
