import { freshBoard, place, isLegalMove, type BoardState } from '../../shared/omok.js';

function canonical(board: number[]) {
  const signatures: string[] = [];
  for (let symmetry = 0; symmetry < 8; symmetry++) {
    const transformed = Array(225).fill(0);
    board.forEach((stone, at) => {
      let x = at % 15 - 7, y = Math.floor(at / 15) - 7;
      if (symmetry >= 4) x = -x;
      for (let i = 0; i < symmetry % 4; i++) [x, y] = [-y, x];
      transformed[(y + 7) * 15 + x + 7] = stone;
    });
    signatures.push(transformed.join(''));
  }
  return signatures.sort()[0];
}

/** Independent, reproducible legal starting positions, not harvested from wins.
 * Color-swapped engine assignments share exactly the same starting position.
 * Symmetric duplicate positions do not count as additional evidence. */
export function positions(suite: 'train' | 'heldout', count: number): BoardState[] {
  let seed = suite === 'train' ? 0x21573a : 0x78fa014;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const result: BoardState[] = [], seen = new Set<string>();
  while (result.length < count) {
    let state = place(freshBoard(), 112);
    const plies = 6 + result.length % 3 * 2;
    for (let ply = 1; ply < plies; ply++) {
      const candidates: number[] = [];
      for (let y = 4; y <= 10; y++) for (let x = 4; x <= 10; x++) {
        const at = y * 15 + x;
        if (isLegalMove(state.board, at, state.turn) && state.moves.some(previous =>
          Math.max(Math.abs(previous % 15 - x), Math.abs(Math.floor(previous / 15) - y)) <= 2)) candidates.push(at);
      }
      state = place(state, candidates[Math.floor(random() * candidates.length)]);
      if (state.winner || state.draw) break;
    }
    if (state.winner || state.draw) continue;
    const signature = canonical(state.board);
    if (!seen.has(signature)) { seen.add(signature); result.push(state); }
  }
  return result;
}
