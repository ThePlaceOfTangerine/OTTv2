function renderBracket(target, bracket, actions = null) {
  const expanded = new Set([...target.querySelectorAll('.bracket-replays[open]')].map(element => element.dataset.match));
  target.replaceChildren();
  if (!bracket) { target.append(textNode('p', 'Chưa tạo sơ đồ vòng loại trực tiếp.')); return; }
  const complete = bracket.rounds.flatMap(r => r.matches).filter(m => m.status === 'finished').length;
  const summary = document.createElement('div'); summary.className = 'bracket-summary';
  if (bracket.champion) {
    summary.classList.add('has-champion');
    summary.append(textNode('span', bracket.publishedAt ? 'ĐỘI VÔ ĐỊCH · ĐÃ DUYỆT' : 'ĐỘI VÔ ĐỊCH · CHỜ DUYỆT'));
    summary.append(textNode('strong', bracket.champion.username));
    summary.append(textNode('p', `Hạt giống ${bracket.champion.seed} · ${complete}/${bracket.teamCount - 1} cặp đã hoàn tất`));
  } else {
    summary.append(textNode('strong', bracket.status === 'paused' ? 'Đã tạm dừng · Ván đang chạy được hoàn tất' : bracket.status === 'cancelled' ? 'Đã hủy thi đấu · Không công bố vô địch' : bracket.status === 'running' ? bracket.controlMode === 'manual' ? 'Điều khiển từng cặp / từng vòng' : 'Đang thi đấu loại trực tiếp' : 'Sơ đồ đã sẵn sàng'));
    summary.append(textNode('p', `${bracket.teamCount} đội · ${complete}/${bracket.teamCount - 1} cặp đã hoàn tất`));
  }
  if (bracket.controlReason) summary.append(textNode('p', 'Lý do: ' + bracket.controlReason));
  target.append(summary);
  const grid = document.createElement('div'); grid.className = 'bracket-rounds';
  for (const round of bracket.rounds) {
    const section = document.createElement('section'); section.className = 'bracket-round';
    const count = round.matches.length;
    const heading = document.createElement('div'); heading.className = 'bracket-round-heading';
    heading.append(textNode('h4', count === 1 ? 'Chung kết' : count === 2 ? 'Bán kết' : count === 4 ? 'Tứ kết' : `Vòng ${count * 2} đội`));
    heading.append(textNode('span', `Lượt ${round.number}`)); section.append(heading);
    const manual = bracket.controlMode === 'manual' && bracket.status === 'running';
    if (manual && actions?.round) {
      const runRound = action('Chạy các cặp còn lại của vòng', () => actions.round(round.number)); runRound.className = 'bracket-schedule';
      runRound.disabled = !round.matches.some(m => m.status === 'ready') || round.matches.some(m => m.status === 'queued')
        || bracket.rounds.filter(r => r.number < round.number).some(r => r.matches.some(m => !['finished', 'bye'].includes(m.status)));
      section.append(runRound);
    }
    for (const match of round.matches) {
      const card = document.createElement('div'); card.className = 'bracket-match'; card.dataset.state = match.status;
      const top = document.createElement('div'); top.className = 'bracket-match-heading';
      top.append(textNode('strong', `Cặp ${match.id.replace('r', '').replace('-m', '.')}`));
      top.append(textNode('span', ({ finished: 'Đã có kết quả', bye: 'Miễn đấu', queued: 'Đang thi đấu', ready: 'Sẵn sàng', waiting: 'Chờ đối thủ' })[match.status] || 'Chờ thi đấu')); card.append(top);
      match.slots.forEach((team, index) => {
        const row = document.createElement('div'); row.className = 'bracket-team';
        const winner = !!team && match.winner?.userId === team.userId;
        row.dataset.result = winner ? 'winner' : match.status === 'finished' && team ? 'loser' : 'pending';
        row.append(textNode('span', team ? '#' + team.seed : '—')); row.firstChild.className = 'bracket-seed';
        const info = document.createElement('div'); info.className = 'bracket-team-info';
        info.append(textNode('strong', team ? team.username : match.sources ? `Đội thắng cặp ${match.sources[index].replace('r', '').replace('-m', '.')}` : 'Không có đối thủ'));
        if (winner) info.append(textNode('span', count === 1 && match.status === 'finished' ? 'Vô địch' : 'Đi tiếp'));
        else if (match.status === 'finished' && team) info.append(textNode('span', 'Dừng bước'));
        row.append(info);
        const score = textNode('strong', match.points ? String(match.points[index]).replace('.', ',') : '—'); score.className = 'bracket-score';
        score.setAttribute('aria-label', match.points ? `${match.points[index]} điểm ván` : 'Chưa có điểm ván'); row.append(score); card.append(row);
      });
      const result = textNode('p', match.status === 'finished' ? match.decidedBy === 'seed' ? 'Hòa điểm · Hạt giống cao hơn đi tiếp' : match.decidedBy === 'extra_games' ? 'Phân thắng thua sau các ván phụ' : 'Phân thắng thua bằng điểm ván'
        : match.status === 'bye' ? 'Tự vào vòng sau · Không tính điểm ván' : match.status === 'queued' ? 'Đang chấm điểm các ván đấu' : match.status === 'ready' ? 'Đã đủ hai đội · Chưa thi đấu' : 'Nhận đội thắng từ các cặp trước');
      result.className = 'bracket-decision'; card.append(result);
      if (manual && actions?.match && match.status === 'ready') {
        const runPair = action('Chạy cặp này', () => actions.match(match.id)); runPair.className = 'bracket-schedule'; card.append(runPair);
      }
      section.append(card);
      const games = (bracket.games || []).filter(g => g.match_id === match.id);
      if (actions && games.length) {
        const details = document.createElement('details'); details.className = 'bracket-replays';
        details.dataset.match = match.id; details.open = expanded.has(match.id);
        details.append(textNode('summary', `Xem các ván đấu (${games.length})`));
        const buttons = document.createElement('div'); buttons.className = 'bracket-replay-actions';
        for (const game of games) {
          if (game.status === 'finished' || game.status === 'running') buttons.append(action(`Xem ván ${game.number}`, () => actions.watch(game.id)));
          if (game.status === 'blocked') { details.open = true; details.append(textNode('p', `Ván ${game.number} cần xử lý hạ tầng: ${game.error}`)); buttons.append(action(`Chạy lại ván ${game.number}`, () => actions.retry(game.id))); }
        }
        details.append(buttons); card.append(details);
      }
    }
    grid.append(section);
  }
  target.append(grid);
}
