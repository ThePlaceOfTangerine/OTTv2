// Remote grader: npm run grader with COORDINATOR_URL, GRADER_ID, GRADER_SECRET (from admin > Giám sát), optional GRADER_SLOTS.
// USB grader (D15): GRADER_CONFIG_FILE=<OTTCONF>/grader.env holds COORDINATOR_URL + GRADER_ENROLL_CODE; the agent enrolls once and keeps
// its own key in GRADER_CREDENTIALS_FILE (on the USB image this is /run, i.e. RAM: a restarted service reuses it, a reboot enrolls again).
const fs = require('node:fs');
const os = require('node:os');
const { GraderAgent } = require('../src/grader/agent');
const { parseEnv, graderConfig } = require('../src/usb/config');

async function credentials() {
  if (!process.env.GRADER_CONFIG_FILE) return { url: process.env.COORDINATOR_URL, id: process.env.GRADER_ID, secret: process.env.GRADER_SECRET, slots: Number(process.env.GRADER_SLOTS || 1) };
  const config = graderConfig(parseEnv(fs.readFileSync(process.env.GRADER_CONFIG_FILE, 'utf8'))), cache = process.env.GRADER_CREDENTIALS_FILE;
  if (cache && fs.existsSync(cache)) {
    const saved = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (saved.url === config.url) return { ...config, id: saved.id, secret: saved.secret };
  }
  const response = await fetch(`${config.url}/api/graders/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: config.code, machine: os.hostname() }), signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Không đăng ký được với ${config.url}: ${body.error || response.status}`);
  if (cache) fs.writeFileSync(cache, JSON.stringify({ url: config.url, id: body.id, secret: body.secret }), { mode: 0o600 });
  console.log(`Đã đăng ký: ${body.name} (${body.id}).`);
  return { ...config, id: body.id, secret: body.secret };
}

if (require.main === module) (async () => {
  const { url, id, secret, slots } = await credentials();
  const agent = new GraderAgent({ url, id, secret, slots, workDir: process.env.GRADER_WORKDIR || undefined });
  if (!Number.isInteger(agent.slots) || agent.slots < 1 || agent.slots > 16) throw new Error('GRADER_SLOTS phải từ 1 đến 16.');
  await agent.start();
  console.log(`Máy chấm ${agent.id} đã kết nối ${agent.url} · ${agent.slots} luồng · image ${agent.image}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { console.log('Đang dừng, chờ việc đang chạy gửi kết quả...'); agent.stop().then(() => process.exit(0)); });
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { credentials };
