// Creates the organizers' GitHub App in one click (GitHub "App manifest" flow) and stores its credentials in the private secrets folder.
//   node scripts/github-app-manifest.js <organization> [--secrets <folder outside the repo>] [--homepage https://...] [--dry]   (docs/GITHUB.md)
// 1. Open http://127.0.0.1:47000 → the page posts the manifest to GitHub (organization settings, logged-in owner).
// 2. The owner clicks "Create GitHub App"; GitHub redirects back here with a one-time code.
// 3. The code is exchanged for App ID, slug, private key and webhook secret → the secrets folder (never printed).
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [org, ...rest] = process.argv.slice(2);
const arg = name => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const SECRETS = path.resolve(arg('secrets') || process.env.OTT_SECRETS || 'E:/OTTv2-local/secrets'), PORT = 47000, state = crypto.randomBytes(16).toString('hex');
if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(org || '')) { console.error('Cần tên Organization GitHub hợp lệ.'); process.exit(2); }
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Webhook starts disabled: the server is not reachable from the Internet yet. Enable it (Push, URL /api/github/webhook) when it is.
const manifest = {
  name: `${org}-nop-bai`.slice(0, 34),
  url: arg('homepage') || 'https://ott-ket-qua.pages.dev',
  description: 'Ban tổ chức OTTv2: đọc mã bot (chỉ đọc) trong repo Private mà đội đã chọn, để chấm bài.',
  hook_attributes: { url: 'https://example.invalid/api/github/webhook', active: false },
  redirect_url: `http://127.0.0.1:${PORT}/callback`,
  public: true,  // installable by any account: teams install it on their own repositories
  default_permissions: { contents: 'read', metadata: 'read' },
  default_events: ['push']
};
if (rest.includes('--dry')) { console.log(JSON.stringify(manifest, null, 2)); process.exit(0); }

const page = `<!doctype html><meta charset="utf-8"><title>Tạo GitHub App của BTC</title>
<body style="font-family:sans-serif;max-width:640px;margin:40px auto">
<h1>Tạo GitHub App cho tổ chức ${escape(org)}</h1>
<p>Bấm nút dưới đây. GitHub sẽ mở trang tạo App với quyền đã điền sẵn: <b>chỉ đọc nội dung repo</b>, nghe sự kiện Push, webhook đang tắt.</p>
<p>Trên trang GitHub, kiểm tra tên App rồi bấm <b>Create GitHub App for ${escape(org)}</b>.</p>
<form action="https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${state}" method="post">
<input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}">
<button style="font-size:18px;padding:10px 20px">Tạo GitHub App trên GitHub</button></form></body>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page); }
  if (url.pathname !== '/callback') { res.writeHead(404); return res.end(); }
  const code = url.searchParams.get('code');
  if (url.searchParams.get('state') !== state || !/^[A-Za-z0-9]+$/.test(code || '')) { res.writeHead(400); return res.end('Sai state hoặc thiếu code.'); }
  try {
    const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, { method: 'POST', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OTTv2-setup' } });
    const app = await response.json();
    if (!response.ok) throw new Error(`GitHub trả lỗi ${response.status}: ${app.message || ''}`);
    fs.mkdirSync(SECRETS, { recursive: true });
    const write = (name, value) => fs.writeFileSync(path.join(SECRETS, name), `${value}\n`, { mode: 0o600 });
    write('github-app-id.txt', app.id); write('github-app-slug.txt', app.slug);
    write('github-app.pem', app.pem.trim()); write('github-webhook-secret.txt', app.webhook_secret);
    console.log(`Đã tạo App: ${app.slug} (ID ${app.id}) thuộc ${app.owner?.login}. Trang App: ${app.html_url}`);
    console.log(`Đã lưu khóa vào ${SECRETS}: github-app-id.txt, github-app-slug.txt, github-app.pem, github-webhook-secret.txt.`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<meta charset="utf-8"><p>Đã tạo <b>${escape(app.slug)}</b> và lưu khóa vào thư mục secrets. Có thể đóng trang này.</p>`);
  } catch (error) {
    console.error(error.message); res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(error.message);
  }
  setTimeout(() => server.close(), 500);
});
server.listen(PORT, '127.0.0.1', () => console.log(`Mở http://127.0.0.1:${PORT} trên trình duyệt đã đăng nhập GitHub (chủ tổ chức ${org}).`));
