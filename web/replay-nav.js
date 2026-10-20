// Replay navigation shared by the admin/portal viewer, the public site and ott-run's replay.html:
// the moves worth jumping to (captures, power-up/tile pickups) and keyboard shortcuts.
(function (root) {
  // Returns [{ turn, kinds }] where turn is the slider position right after the move (1-based).
  function replayEvents(replay) {
    const board = structuredClone(replay.initial.board), powerUps = new Set((replay.initial.powerUps || []).map(p => `${p[0]},${p[1]}`)), events = [];
    replay.turns.forEach((entry, index) => {
      const m = entry.move, target = board[m.toRow][m.toCol], kinds = [];
      if (target && target.player !== entry.player) kinds.push('capture');
      if (Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          if ('piece' in change) board[change.row][change.col] = change.piece;
          if ('tile' in change) kinds.push('tile');
        }
      } else {
        board[m.toRow][m.toCol] = board[m.fromRow][m.fromCol]; board[m.fromRow][m.fromCol] = null;
        if (powerUps.delete(`${m.toRow},${m.toCol}`)) kinds.push('tile');
      }
      if (kinds.length) events.push({ turn: index + 1, kinds });
    });
    return events;
  }
  const nextEvent = (events, turn, direction = 1) => (direction > 0 ? events.find(e => e.turn > turn) : [...events].reverse().find(e => e.turn < turn))?.turn ?? null;
  // ←/→ one move, Home/End, Space play/pause, N/P next/previous capture or pickup. active() says whether this viewer is on screen.
  function bindReplayKeys({ active, get, set, max, toggle, events }) {
    document.addEventListener('keydown', event => {
      if (!active() || event.altKey || event.ctrlKey || event.metaKey) return;
      const typing = event.target.closest?.('input,select,textarea,[contenteditable]');
      // A focused range input already moves itself with the arrow keys.
      if (typing && !(event.target.type === 'range' && !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))) return;
      const turn = get(), jump = direction => { const target = nextEvent(events(), turn, direction); if (target !== null) set(target); };
      const actions = { ArrowLeft: () => set(Math.max(0, turn - 1)), ArrowRight: () => set(Math.min(max(), turn + 1)), Home: () => set(0), End: () => set(max()),
        ' ': toggle, n: () => jump(1), N: () => jump(1), p: () => jump(-1), P: () => jump(-1) };
      if (!actions[event.key] || (event.key === ' ' && event.target.closest?.('button'))) return;
      event.preventDefault(); actions[event.key]();
    });
  }
  const api = { replayEvents, nextEvent, bindReplayKeys };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.OTT = Object.assign(root.OTT || {}, api);
})(this);
