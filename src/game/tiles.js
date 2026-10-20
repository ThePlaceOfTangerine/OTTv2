// Data-driven tiles for rps-grid-v1. RuleSet JSON names tile types and effects; only trusted server code defines what an effect does.
const fail = message => { throw new Error(message); };
const TILE_ID = /^[a-z][a-z0-9_-]{0,23}$/, TAG = /^[a-z0-9_-]{1,24}$/;
const BUILTIN = {
  blocked: { passable: false, tags: ['impassable'], effect: null, render: { color: '#4b4f54', symbol: '■', label: 'Chướng ngại vật' } },
  void: { passable: false, tags: ['impassable', 'void'], effect: null, render: { color: '#00000000', symbol: '', label: 'Ngoài bản đồ' } },
};
// Effects stay on a piece until it is captured or picks up another effect; shield is spent when it blocks one capture.
const effects = new Map([
  ['wildcard', { label: 'Wildcard: ăn được mọi quân đối thủ, kể cả cùng loại', canCapture: () => true }],
  ['plus', { label: 'Nâng cấp: ăn thêm được quân cùng loại', canCapture: (piece, target) => piece.type === target.type }],
  ['shield', { label: 'Khiên: chặn một lần bị ăn, quân tấn công đứng yên', blocksCapture: true }],
  ['dash', { label: 'Lướt: sau khi ăn quân, đi thêm 1 ô cùng hướng', dash: true }],
]);
function registerEffect(id, effect) {
  if (!TILE_ID.test(id) || effects.has(id) || !effect || typeof effect.label !== 'string') throw new Error('Invalid or duplicate trusted effect');
  effects.set(id, effect);
}
const effect = id => (id ? effects.get(id) : null) || null;
const tileType = (rules, type) => BUILTIN[type] || rules.tileTypes?.[type] || null;

// Point symmetry pairs a cell with its mirror through the board centre; self-mirrored cells are skipped so groups are true pairs.
function spawnGroups(spawn, rows, cols, taken) {
  const region = { rowFrom: 0, rowTo: rows - 1, colFrom: 0, colTo: cols - 1, ...spawn.region }, groups = [], seen = new Set();
  for (let row = region.rowFrom; row <= region.rowTo; row++) for (let col = region.colFrom; col <= region.colTo; col++) {
    const cells = spawn.symmetry === 'point' ? [[row, col], [rows - 1 - row, cols - 1 - col]] : [[row, col]];
    if (spawn.symmetry === 'point' && cells[0][0] === cells[1][0] && cells[0][1] === cells[1][1]) continue;
    const key = cells.map(c => c.join(',')).sort().join('|');
    if (seen.has(key) || cells.some(c => taken.has(c.join(',')))) continue;
    seen.add(key); groups.push(cells);
  }
  return groups;
}

function validateTiles(r, { rows, cols, inside, unavailable, homes, starts }) {
  if (r.onMoveLimit !== undefined && !['draw', 'material'].includes(r.onMoveLimit)) fail('onMoveLimit chỉ nhận "draw" hoặc "material".');
  if (r.tileTypes === undefined) { if (r.tiles !== undefined || r.tileSpawns !== undefined) fail('Khai báo tileTypes trước khi dùng tiles/tileSpawns.'); return; }
  if (r.powerUps) fail('Không dùng powerUps cũ cùng tileTypes; khai báo ô hiệu ứng bằng tileSpawns.');
  if (!r.tileTypes || typeof r.tileTypes !== 'object' || Array.isArray(r.tileTypes) || Object.keys(r.tileTypes).length > 32) fail('tileTypes phải là đối tượng, tối đa 32 loại ô.');
  for (const [id, type] of Object.entries(r.tileTypes)) {
    if (!TILE_ID.test(id) || BUILTIN[id]) fail(`Mã loại ô không hợp lệ hoặc trùng loại có sẵn: ${id}`);
    if (!type || typeof type !== 'object' || typeof type.passable !== 'boolean') fail(`Loại ô ${id} cần passable true/false.`);
    if (type.tags !== undefined && (!Array.isArray(type.tags) || type.tags.length > 8 || type.tags.some(tag => typeof tag !== 'string' || !TAG.test(tag)))) fail(`Tags của ${id} không hợp lệ.`);
    if (type.effect !== undefined && type.effect !== null && !effects.has(type.effect)) fail(`Hiệu ứng chưa được cài trên máy chủ: ${type.effect}`);
    if (type.effect && !type.passable) fail(`Ô hiệu ứng ${id} phải đi vào được.`);
    const render = type.render;
    if (!render || !/^#[0-9a-fA-F]{6}$/.test(render.color) || typeof render.symbol !== 'string' || [...render.symbol].length > 2 || typeof render.label !== 'string' || !render.label || render.label.length > 40)
      fail(`render của ${id} cần color #rrggbb, symbol tối đa 2 ký tự và label 1–40 ký tự.`);
  }
  // Fixed tiles and spawns may not cover homes, starting squares or other tiles.
  const taken = new Set([...unavailable, ...homes.map(h => `${h.row},${h.col}`), ...starts]);
  if (r.tiles !== undefined && (!Array.isArray(r.tiles) || r.tiles.length > rows * cols)) fail('tiles phải là danh sách.');
  for (const tile of r.tiles || []) {
    if (!tile || !Array.isArray(tile.at) || tile.at.length !== 2 || !inside(...tile.at) || !r.tileTypes[tile.type]) fail('Ô trong tiles cần at [hàng, cột] trong bàn và type đã khai báo.');
    if (taken.has(tile.at.join(','))) fail(`Ô ${tile.at.join(',')} trùng nhà, vị trí xuất phát hoặc ô khác.`);
    taken.add(tile.at.join(','));
  }
  if (r.tileSpawns !== undefined && (!Array.isArray(r.tileSpawns) || r.tileSpawns.length > 8)) fail('tileSpawns tối đa 8 nhóm.');
  for (const spawn of r.tileSpawns || []) {
    if (!spawn || !Array.isArray(spawn.types) || !spawn.types.length || spawn.types.some(type => !r.tileTypes[type]?.passable)) fail('tileSpawns.types cần các loại ô đã khai báo và đi vào được.');
    if (!Array.isArray(spawn.count) || spawn.count.length !== 2 || !spawn.count.every(n => Number.isInteger(n) && n >= 0 && n <= 16) || spawn.count[0] > spawn.count[1]) fail('tileSpawns.count cần [min, max] từ 0 đến 16.');
    if (!['point', 'none'].includes(spawn.symmetry ?? 'none')) fail('tileSpawns.symmetry chỉ nhận "point" hoặc "none".');
    const region = spawn.region;
    if (region !== undefined && (!region || !['rowFrom', 'rowTo', 'colFrom', 'colTo'].every(k => Number.isInteger(region[k])) || !inside(region.rowFrom, region.colFrom) || !inside(region.rowTo, region.colTo) || region.rowFrom > region.rowTo || region.colFrom > region.colTo)) fail('tileSpawns.region nằm ngoài bàn.');
    const groups = spawnGroups(spawn, rows, cols, taken);
    if (groups.length < spawn.count[0] || !groups.length) fail('Vùng rải ô không đủ chỗ trống (đã trừ nhà, vị trí xuất phát và ô khác).');
    // Later spawn groups cannot reuse this region's cells.
    for (const cells of groups) for (const cell of cells) taken.add(cell.join(','));
  }
}

// Called once per game after pieces are placed; consumes the seeded random stream only when tileTypes exist.
function placeTiles(rules, rows, cols, random, shuffle) {
  const tiles = [], add = (row, col, type) => tiles.push({ row, col, type, tags: [...(tileType(rules, type).tags || [])] });
  for (const key of ['blockedCells', 'voidCells']) for (const [row, col] of rules[key] || []) add(row, col, key === 'blockedCells' ? 'blocked' : 'void');
  for (const tile of rules.tiles || []) add(tile.at[0], tile.at[1], tile.type);
  const starts = rules.startingPositions.flat().map(p => p.join(','));
  const taken = new Set([...tiles.map(t => `${t.row},${t.col}`), ...rules.homes.map(h => `${h.row},${h.col}`), ...starts]);
  for (const spawn of rules.tileSpawns || []) {
    const groups = shuffle(spawnGroups(spawn, rows, cols, taken), random);
    const count = Math.min(groups.length, spawn.count[0] + Math.floor(random() * (spawn.count[1] - spawn.count[0] + 1)));
    for (const cells of groups.slice(0, count)) {
      const type = spawn.types[Math.floor(random() * spawn.types.length)];
      for (const [row, col] of cells) { add(row, col, type); taken.add(`${row},${col}`); }
    }
  }
  return tiles.sort((a, b) => a.row - b.row || a.col - b.col);
}
module.exports = { BUILTIN, effect, tileType, registerEffect, validateTiles, placeTiles, effectIds: () => [...effects.keys()] };
