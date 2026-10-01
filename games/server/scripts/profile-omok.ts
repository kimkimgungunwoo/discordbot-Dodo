import { freshBoard, place, transcendentMove, type SearchStats } from '../../shared/omok.js';
import { transcendentMove as legacy } from '../tests/fixtures/omok-legacy.js';
const positions = [[112,97,113,98], [112,96,127,98], [112,97,113,98,111,114,99,82,66,96,94,110]];
for (const moves of positions) {
  let state = freshBoard(); for (const at of moves) state = place(state, at);
  for (const [name, engine] of [['legacy', legacy], ['candidate', transcendentMove]] as const) {
    const stats: SearchStats = { nodes: 0, depth: 0, forcedWin: false, elapsedMs: 0 };
    const at = engine([...state.board], state.turn, Number(process.env.OMOK_BUDGET_MS ?? 1000), stats);
    console.log(JSON.stringify({ name, position: moves.length, at, ...stats }));
  }
}
