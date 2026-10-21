// Small renderer for the controlled Markdown guide; no external packages or raw HTML.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const markdown = fs.readFileSync(path.join(root, 'docs/QUY-TAC-GIAI-DAU.md'), 'utf8');
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = text => escape(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\((\/(?!\/)[^\s)]+|#[^\s)]+)\)/g, '<a href="$2">$1</a>');
const lines = markdown.split(/\r?\n/), html = [], toc = [];
let list = null, section = 0;
const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
for (let index = 0; index < lines.length; index++) {
  const line = lines[index].trim();
  if (!line) { closeList(); continue; }
  if (line.startsWith('# ')) { closeList(); continue; }
  if (line.startsWith('## ')) {
    closeList(); const title = line.slice(3), id = 'section-' + (++section);
    toc.push(`<a href="#${id}">${inline(title)}</a>`); html.push(`<h2 id="${id}" tabindex="-1">${inline(title)}</h2>`); continue;
  }
  if (line.startsWith('|')) {
    closeList(); const rows = [];
    while (index < lines.length && lines[index].trim().startsWith('|')) { rows.push(lines[index].trim().slice(1, -1).split('|').map(cell => cell.trim())); index++; }
    index--;
    html.push('<div class="guide-table" tabindex="0" aria-label="Bảng hướng dẫn, có thể cuộn ngang"><table><thead><tr>' + rows[0].map(cell => `<th scope="col">${inline(cell)}</th>`).join('') + '</tr></thead><tbody>');
    for (const row of rows.slice(2)) html.push('<tr>' + row.map(cell => `<td>${inline(cell)}</td>`).join('') + '</tr>');
    html.push('</tbody></table></div>'); continue;
  }
  const item = line.match(/^(?:([-]) |\d+\. )(.+)$/);
  if (item) {
    const kind = item[1] ? 'ul' : 'ol';
    if (kind !== list) { closeList(); html.push(`<${kind}>`); list = kind; }
    html.push(`<li>${inline(item[2])}</li>`); continue;
  }
  closeList(); html.push(`<p>${inline(line)}</p>`);
}
closeList();
const page = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Quy tắc và cách tổ chức giải · OTTv2</title><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/tournament-guide.css"></head>
<body><a class="skip-link" href="#guide-content">Đến nội dung hướng dẫn</a>
<header><a href="/admin#tournaments">← Về mục Giải đấu</a><p class="eyebrow">DÀNH CHO BAN TỔ CHỨC</p><h1>Quy tắc và cách tổ chức giải đấu</h1><p>Hiểu thể thức, cách tính điểm và từng thao tác từ tạo giải đến duyệt đội vô địch.</p><span class="guide-version">Theo chức năng hiện có · Cập nhật 20/10/2026</span></header>
<div class="guide-layout"><nav aria-label="Mục lục hướng dẫn"><strong>Trong tài liệu này</strong>${toc.join('\n')}</nav><main id="guide-content">${html.join('\n')}</main></div>
<footer><a href="/admin#tournaments">← Về mục Giải đấu</a><p>OTTv2 · Hướng dẫn tổ chức giải bot</p></footer></body></html>\n`;
fs.writeFileSync(path.join(root, 'web/tournament-guide.html'), page);
console.log(`Đã tạo hướng dẫn: ${toc.length} phần.`);
