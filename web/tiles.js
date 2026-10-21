// Draws board tiles from RuleSet.tileTypes[type].render so new tile types need only JSON; unknown types get a neutral fallback.
const tileBuiltins = { blocked: ['terrain-blocked', 'Chướng ngại vật'], void: ['terrain-void', 'Ngoài bản đồ'] };
function tileLabel(rules, type) { return tileBuiltins[type]?.[1] || rules.tileTypes?.[type]?.render?.label || `Loại ô ${type}`; }
function paintTile(cell, rules, type) {
  cell.dataset.tile = type;
  if (tileBuiltins[type]) { cell.classList.add(tileBuiltins[type][0]); return tileLabel(rules, type); }
  const definition = rules.tileTypes?.[type], mark = document.createElement('span');
  mark.className = 'tile-mark'; mark.setAttribute('aria-hidden', 'true');
  if (definition?.render) {
    cell.classList.add('tile-custom'); if (!definition.passable) cell.classList.add('tile-impassable');
    cell.style.setProperty('--tile-color', definition.render.color); mark.textContent = definition.render.symbol;
  } else { cell.classList.add('tile-unknown'); mark.textContent = '?'; }
  cell.append(mark);
  return tileLabel(rules, type);
}
// A piece's effect is shown with the render of the tile type that grants it.
function paintEffect(token, rules, effect) {
  token.dataset.effect = effect;
  const source = Object.values(rules.tileTypes || {}).find(type => type.effect === effect)?.render;
  const badge = document.createElement('span'); badge.className = 'effect-badge';
  badge.textContent = source?.symbol || effect.slice(0, 2).toUpperCase();
  if (source) badge.style.setProperty('--tile-color', source.color);
  token.append(badge);
  return source?.label || `Hiệu ứng ${effect}`;
}
