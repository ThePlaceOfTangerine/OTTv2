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

// Rank change since the last complete round before the current one, and the four badges (D17). Pairs need round_number;
// faulted is the set of teams with a game lost to their own bot fault. Computed on read, so a published snapshot freezes it.
function progress(rows, entrants, pairs, seed, faulted = new Set()) {
  const rounds = new Map();
  for (const pair of pairs) rounds.set(pair.round_number, [...(rounds.get(pair.round_number) || []), pair]);
  const complete = [...rounds].filter(([, list]) => list.every(p => p.status === 'finished')).map(([number]) => number).sort((a, b) => a - b);
  const last = complete.at(-1) ?? 0, partial = pairs.some(p => p.status === 'finished' && p.round_number > last);
  const base = partial ? last : last - 1;
  const before = base >= 1 ? new Map(standings(entrants, pairs.filter(p => p.round_number <= base), seed).map(row => [row.userId, row.rank])) : null;
  const results = new Map(), add = (user, units) => results.set(user, [...(results.get(user) || []), units]);
  for (const pair of [...pairs].filter(p => p.status === 'finished' && p.user1 !== null).sort((a, b) => a.round_number - b.round_number)) { add(pair.user0, pair.result0_units); add(pair.user1, pair.result1_units); }
  return rows.map(row => {
    const rankChange = before?.has(row.userId) ? before.get(row.userId) - row.rank : null, history = results.get(row.userId) || [];
    let streak = 0; for (let i = history.length - 1; i >= 0 && history[i] === 2; i--) streak++;
    const badges = [];
    if (row.played >= 3 && row.losses === 0) badges.push({ code: 'undefeated' });
    if (streak >= 3) badges.push({ code: 'streak', value: streak });
    if (row.played >= 1 && !faulted.has(row.userId)) badges.push({ code: 'clean' });
    if (rankChange >= 5) badges.push({ code: 'comeback', value: rankChange });
    return { ...row, rankChange, badges };
  });
}

// Ranked teams are paired in blocks of up to CHUNK consecutive ranks. Each block uses the exact backtracking search, so up to 256 teams
// behave exactly as before; larger fields cost ~one 256-team search per block instead of a search that grows with n² per node.
const CHUNK = 256, MAX_TEAMS = 4000;
function pairRound(rows, previous, { nodeLimit = 20000, chunk = CHUNK } = {}) {
  if (rows.length < 2 || rows.length > MAX_TEAMS) throw pairingError(`Vòng loại hỗ trợ 2–${MAX_TEAMS} bot đã chốt.`);
  const seen = new Set(previous.filter(p => p.user1 !== null).map(p => [p.user0, p.user1].sort((a, b) => a - b).join(':')));
  let nodes = 0;
  // Exact search inside one block; limits apply per block so a large field does not exhaust them.
  function searchBlock(block) {
    let edgeChecks = 0, blockNodes = 0;
    const failed = new Set();
    const canPair = (a, b) => {
      if (++edgeChecks > 5000000) throw pairingError('Đạt giới hạn công việc tìm lịch vòng loại; chưa tạo vòng và không tự cho tái đấu.');
      return !seen.has(a.userId < b.userId ? `${a.userId}:${b.userId}` : `${b.userId}:${a.userId}`);
    };
    function search(pool) {
      nodes++;
      if (++blockNodes > nodeLimit) throw pairingError('Đạt giới hạn tìm lịch vòng loại. Chưa tạo vòng; BTC cần xem lại cấu hình/lịch, hệ thống không tự cho tái đấu.');
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
    return search(block);
  }
  // A block that cannot be paired absorbs the next one; a short tail (< half a block) joins the block before it.
  function pairAll(pool) {
    const pairs = [];
    for (let start = 0; start < pool.length;) {
      let end = Math.min(pool.length, start + chunk);
      if (pool.length - end < chunk / 2) end = pool.length;
      let result = searchBlock(pool.slice(start, end));
      while (!result && end < pool.length) { end = Math.min(pool.length, end + chunk); result = searchBlock(pool.slice(start, end)); }
      if (!result) return null;
      pairs.push(...result); start = end;
    }
    return pairs;
  }
  const ranked = [...rows].sort((a, b) => a.rank - b.rank);
  const byes = ranked.length % 2 ? ranked.filter(row => row.byes === 0).sort((a, b) => a.pointsUnits - b.pointsUnits || b.rank - a.rank) : [null];
  for (const bye of byes) {
    const result = pairAll(ranked.filter(row => row !== bye));
    if (result) return { pairs: result, bye: bye?.userId ?? null, searchNodes: nodes };
  }
  throw pairingError('Không tìm được lịch không tái đấu và không lặp suất miễn đấu. Chưa tạo vòng mới.');
}
module.exports = { standings, progress, pairRound, digest };
