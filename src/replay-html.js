const fs = require('node:fs');
const path = require('node:path');

// One offline HTML file (no network, no server): the public-site viewer with its CSS, scripts, piece images and the games inlined.
const WEB = path.resolve(__dirname, '../web'), PUBLIC = path.resolve(__dirname, '../web-public');
const read = file => fs.readFileSync(file, 'utf8');
const script = text => `<script>${text.replace(/<\/script/gi, '<\\/script')}</script>`;
const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// games: [{ title, summary, replay }]
function replayHtml({ title, games }) {
  const pieces = Object.fromEntries([['R', 'rock'], ['P', 'paper'], ['S', 'scissor']].map(([type, name]) =>
    [type, `data:image/svg+xml;base64,${fs.readFileSync(path.join(WEB, 'pieces', `${name}.svg`)).toString('base64')}`]));
  // JSON inside <script type="application/json">: escaping "<" keeps any text in the replay from closing the tag.
  const data = JSON.stringify(games).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>${read(path.join(PUBLIC, 'public.css'))}\n${read(path.join(WEB, 'tiles.css'))}\n.games{display:flex;flex-wrap:wrap;gap:8px}.games button[aria-pressed=true]{outline:3px solid #e0a020}</style></head>
<body>
<header class="top"><p class="eyebrow">CHẠY THỬ BOT · ott-run</p><h1>${escape(title)}</h1><p class="muted">File này mở được không cần mạng. Chạy lại ott-run sẽ ghi đè file.</p></header>
<main>
  <section class="card"><h2>Các ván</h2><div id="games" class="games"></div><p id="game-summary" role="status"></p></section>
  <section class="card" id="viewer" aria-labelledby="viewer-title">
    <h2 id="viewer-title">Xem lại ván</h2>
    <p id="viewer-status" role="status"></p>
    <div class="row"><button id="viewer-play" type="button">Tự chạy</button><button id="viewer-prev" type="button" class="secondary" title="Phím P">◀ Pha trước</button><button id="viewer-next" type="button" class="secondary" title="Phím N">Pha tiếp ▶</button><label for="viewer-turn" class="grow">Nước đi <span id="viewer-label"></span><input id="viewer-turn" type="range" min="0" value="0"></label></div>
    <div class="board-wrap"><div id="viewer-board" class="board"></div></div>
    <p class="muted keys">Phím tắt: ← → từng nước · Home/End · Space chạy/dừng · N/P pha ăn quân hoặc nhặt ô tiếp theo/trước đó. Bấm một nước trong danh sách để quay lại.</p>
    <ol id="viewer-log" class="log"></ol>
  </section>
</main>
<script type="application/json" id="ott-games">${data}</script>
${script(`window.OTT_PIECES = ${JSON.stringify(pieces)};`)}
${[path.join(WEB, 'tiles.js'), path.join(WEB, 'hints.js'), path.join(WEB, 'replay-nav.js'), path.join(PUBLIC, 'viewer.js')].map(file => script(read(file))).join('\n')}
${script(`(() => {
  const games = JSON.parse(document.getElementById('ott-games').textContent), host = document.getElementById('games');
  const show = index => {
    host.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    document.getElementById('game-summary').textContent = games[index].summary;
    OTT.openViewer(games[index].replay, games[index].title, { atEnd: false });
  };
  games.forEach((game, index) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = game.title; button.onclick = () => show(index); host.append(button); });
  show(0);
})();`)}
</body>
</html>
`;
}
module.exports = { replayHtml };
