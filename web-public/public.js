// Static results site: reads only published JSON files; every value is shown with textContent.
const $ = id => document.getElementById(id);
const vn = time => new Date(time).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' });
const node = (tag, value, className) => { const element = document.createElement(tag); if (value !== undefined) element.textContent = value; if (className) element.className = className; return element; };
const label = team => team ? `${team.team}${team.teamName ? ` · ${team.teamName}` : ''}` : '—';
async function get(file) {
  const response = await fetch(file, { cache: 'no-cache' });
  if (!response.ok) throw new Error(response.status === 404 ? 'Không tìm thấy dữ liệu.' : `Không tải được dữ liệu (${response.status}).`);
  return response.json();
}
function table(target, headers, rows) {
  const element = node('table'), head = node('tr'), body = node('tbody');
  for (const header of headers) head.append(node('th', header));
  const thead = node('thead'); thead.append(head); element.append(thead, body);
  for (const row of rows) { const tr = node('tr'); for (const value of row) { const td = value instanceof Node ? node('td') : node('td', value ?? '—'); if (value instanceof Node) td.append(value); tr.append(td); } body.append(tr); }
  target.replaceChildren(element);
}

let latest = null, bracketData = null;
async function load(id) {
  latest = await get(`t/${id}/latest.json`);
  const summary = await get(latest.files.summary);
  $('status').textContent = `Bản công bố v${latest.version} · ${vn(latest.publishedAt)} (giờ Việt Nam)${summary.swiss?.provisional ? ' · bảng điểm tạm tính' : ''}`;
  const swiss = summary.swiss;
  $('standings-note').textContent = !swiss ? 'Vòng loại chưa bắt đầu.' : `${swiss.roundsFinished}/${swiss.roundsTotal} lượt hoàn tất${swiss.provisional ? ' · chưa duyệt, có thể thay đổi' : ''}. Bằng điểm xét: tổng điểm đối thủ → điểm đối thủ có trọng số → điểm ván.`;
  table($('standings'), ['Hạng', '±', 'Đội', 'Huy hiệu', 'Điểm', 'Tổng điểm đối thủ', 'Có trọng số', 'Điểm ván', 'T-H-B'], (swiss?.standings || []).map(e => [e.rank, OTT.rankChangeText(e.rankChange), label(e), OTT.badgeCell(e.badges), e.points, e.buchholz, e.sonnebornBerger, e.gamePoints, `${e.wins}-${e.draws}-${e.losses}`]));
  if (swiss?.standings?.length) $('standings').append(OTT.badgeLegend());
  $('qualified').replaceChildren(...(summary.qualification?.teams || []).map(team => node('li', `${label(team)} · hạt giống ${team.seed}`)));
  if (!summary.qualification) $('qualified').replaceChildren(node('li', 'Chưa duyệt danh sách đi tiếp.'));
  bracketData = latest.files.bracket ? await get(latest.files.bracket) : null;
  renderBracket();
}
function renderBracket() {
  const host = $('bracket'); host.replaceChildren();
  if (!bracketData) { host.append(node('p', 'Chưa có sơ đồ vòng loại trực tiếp.', 'muted')); return; }
  if (bracketData.champion) host.append(node('p', `Đội vô địch: ${label(bracketData.champion)}${bracketData.publishedAt ? ' · đã duyệt' : ' · chờ duyệt'}`, 'champion'));
  const rounds = node('div', undefined, 'rounds');
  for (const round of bracketData.rounds) {
    const count = round.matches.length, section = node('section', undefined, 'round');
    section.append(node('h3', count === 1 ? 'Chung kết' : count === 2 ? 'Bán kết' : count === 4 ? 'Tứ kết' : `Vòng ${count * 2} đội`));
    for (const match of round.matches) {
      const card = node('div', undefined, `match ${match.status}`);
      match.slots.forEach((slot, i) => card.append(node('p', `${label(slot)}${match.points ? ` · ${match.points[i]}` : ''}${match.winner && slot && match.winner.userId === slot.userId ? ' ✓' : ''}`, match.winner && slot && match.winner.userId === slot.userId ? 'winner' : '')));
      const games = bracketData.games.filter(game => game.matchId === match.id && game.status === 'finished');
      if (games.length) {
        const buttons = node('div', undefined, 'row');
        for (const game of games) { const button = node('button', `Ván ${game.number}`); button.type = 'button'; button.className = 'secondary'; button.onclick = () => openGame(game, round.number).catch(show); buttons.append(button); }
        card.append(buttons);
      }
      section.append(card);
    }
    rounds.append(section);
  }
  host.append(rounds);
}
async function openGame(game, round) {
  let replay = game.replay;
  // Large brackets keep replays in one file per round.
  const roundFile = latest.files.bracketRounds.find(file => file.endsWith(`/bracket-r${round}.json`));
  if (!replay && roundFile) replay = (await get(roundFile)).games.find(g => g.id === game.id)?.replay;
  if (!replay) throw new Error('Ván này chưa có bản xem lại.');
  OTT.openViewer(replay, `Xem lại ván ${game.number}`); $('viewer').scrollIntoView({ behavior: 'smooth' });
}
function show(error) { $('status').textContent = error.message; }

$('tournament').onchange = () => { history.replaceState(null, '', `#${$('tournament').value}`); load($('tournament').value).catch(show); };
$('lookup').onsubmit = async event => {
  event.preventDefault();
  const code = $('code').value.trim().toLowerCase(), host = $('team');
  if (!/^[0-9a-f]{20}$/.test(code)) { host.replaceChildren(node('p', 'Mã tra cứu gồm đúng 20 ký tự 0–9 và a–f.')); return; }
  try {
    const team = await get(`team/${code}.json`);
    host.replaceChildren(node('h3', label(team)), ...team.tournaments.map(t => node('p', `${t.name} · bản v${t.version} (${vn(t.publishedAt)})${t.provisional ? ' · tạm tính' : ''} · hạng ${t.rank ?? '—'} · ${t.points ?? 0} điểm · ${t.qualified ? `đi tiếp, hạt giống ${t.seed}` : 'chưa đi tiếp'}${t.bracket ? ` · ${t.bracket}` : ''}${t.bot.lockedVersion ? ` · bot đã chốt v${t.bot.lockedVersion}` : ''}${t.bot.latestStatus ? ` · bài mới nhất v${t.bot.latestVersion}: ${t.bot.latestStatus}` : ''}`)));
  } catch { host.replaceChildren(node('p', 'Chưa có dữ liệu cho mã này. Kiểm tra lại mã hoặc chờ lần công bố tiếp theo.')); }
};
(async () => {
  const manifest = await get('manifest.json');
  $('generated').textContent = `Cập nhật lúc ${vn(manifest.generatedAt)} (giờ Việt Nam)`;
  if (!manifest.tournaments.length) { $('status').textContent = 'Chưa có kết quả được công bố.'; return; }
  $('tournament').replaceChildren(...manifest.tournaments.map(t => { const option = node('option', `${t.name} · bản v${t.version}`); option.value = t.id; return option; }));
  const wanted = location.hash.slice(1);
  if (manifest.tournaments.some(t => t.id === wanted)) $('tournament').value = wanted;
  await load($('tournament').value);
})().catch(show);
