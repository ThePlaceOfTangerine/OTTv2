const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pairingError = message => Object.assign(new Error(message), { status: 409 });

// Match points use half-point units; Sonneborn-Berger uses quarter-point units.
function standings(entrants, pairs, seed) {
  const rows = new Map(entrants.map(e => [e.userId, { userId: e.userId, username: e.username, version: e.version,
    pointsUnits: 0, buchholzUnits: 0, sbUnits: 0, gameUnits: 0, played: 0, wins: 0, draws: 0, losses: 0, byes: 0,
    tieKey: digest([seed, 'rank', e.userId]) }]));
  const finished = pairs.filter(p => p.status === 'finished');
  for (const pair of finished) {
    const a = rows.get(pair.user0); if (!a) throw new Error('Missing Swiss entrant');
    a.pointsUnits += pair.result0_units;
    if (pair.user1 === null) { a.byes++; continue; }
    const b = rows.get(pair.user1); if (!b) throw new Error('Missing Swiss opponent');
    b.pointsUnits += pair.result1_units;
    for (const [row, result, games] of [[a, pair.result0_units, pair.game0_units], [b, pair.result1_units, pair.game1_units]]) {
      row.played++; row.gameUnits += games;
      row.wins += +(result === 2); row.draws += +(result === 1); row.losses += +(result === 0);
    }
  }
  for (const pair of finished.filter(p => p.user1 !== null)) {
    const a = rows.get(pair.user0), b = rows.get(pair.user1);
    a.buchholzUnits += b.pointsUnits; b.buchholzUnits += a.pointsUnits;
    a.sbUnits += b.pointsUnits * pair.result0_units; b.sbUnits += a.pointsUnits * pair.result1_units;
  }
  return [...rows.values()].sort((a, b) => b.pointsUnits - a.pointsUnits || b.buchholzUnits - a.buchholzUnits
    || b.sbUnits - a.sbUnits || b.gameUnits - a.gameUnits || a.tieKey.localeCompare(b.tieKey) || a.userId - b.userId)
    .map((row, index) => ({ ...row, rank: index + 1, points: row.pointsUnits / 2, buchholz: row.buchholzUnits / 2,
      sonnebornBerger: row.sbUnits / 4, gamePoints: row.gameUnits / 2 }));
}

function pairRound(rows, previous, { nodeLimit = 20000 } = {}) {
  if (rows.length < 2 || rows.length > 256) throw pairingError('Vòng loại hiện hỗ trợ 2–256 bot đã chốt; mục tiêu thực tế dưới 150 đội.');
  const seen = new Set(previous.filter(p => p.user1 !== null).map(p => [p.user0, p.user1].sort((a, b) => a - b).join(':')));
  let edgeChecks = 0;
  const canPair = (a, b) => {
    if (++edgeChecks > 5000000) throw pairingError('Đạt giới hạn công việc tìm lịch vòng loại; chưa tạo vòng và không tự cho tái đấu.');
    return !seen.has(a.userId < b.userId ? `${a.userId}:${b.userId}` : `${b.userId}:${a.userId}`);
  };
  let nodes = 0;
  const failed = new Set();
  function search(pool) {
    if (++nodes > nodeLimit) throw pairingError('Đạt giới hạn tìm lịch vòng loại. Chưa tạo vòng; BTC cần xem lại cấu hình/lịch, hệ thống không tự cho tái đấu.');
    if (!pool.length) return [];
    const key = pool.map(p => p.userId).join(','); if (failed.has(key)) return null;
    // Fail early on the most constrained team; prefer the closest points/rank for its opponent.
    let first, candidates;
    for (const row of pool) {
      const options = pool.filter(other => other !== row && canPair(row, other));
      if (!options.length) { failed.add(key); return null; }
      if (!candidates || options.length < candidates.length) { first = row; candidates = options; }
    }
    candidates.sort((a, b) => Math.abs(first.pointsUnits - a.pointsUnits) - Math.abs(first.pointsUnits - b.pointsUnits)
      || Math.abs(first.rank - a.rank) - Math.abs(first.rank - b.rank) || a.rank - b.rank);
    for (const other of candidates) {
      const rest = search(pool.filter(row => row !== first && row !== other));
      if (rest) return [[first.userId, other.userId], ...rest];
    }
    failed.add(key); return null;
  }
  const byes = rows.length % 2 ? rows.filter(row => row.byes === 0).sort((a, b) => a.pointsUnits - b.pointsUnits || b.rank - a.rank) : [null];
  for (const bye of byes) {
    const result = search(rows.filter(row => row !== bye));
    if (result) return { pairs: result, bye: bye?.userId ?? null, searchNodes: nodes };
  }
  throw pairingError('Không tìm được lịch không tái đấu và không lặp suất miễn đấu. Chưa tạo vòng mới.');
}
module.exports = { standings, pairRound, digest };
