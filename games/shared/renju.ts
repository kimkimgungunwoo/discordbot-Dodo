import type { Stone } from "./omok.js";

const SIZE = 15;
const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
export type Forbidden = "장목" | "44" | "33";
function cell(at: number, dx: number, dy: number, offset: number) {
  const x = at % SIZE + dx * offset, y = Math.floor(at / SIZE) + dy * offset;
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE ? y * SIZE + x : -1;
}
function run(board: Stone[], at: number, dx: number, dy: number) {
  let length = 1;
  for (const sign of [-1, 1]) for (let n = 1; n < SIZE; n++) {
    const next = cell(at, dx, dy, n * sign);
    if (next < 0 || board[next] !== 1) break;
    length++;
  }
  return length;
}

// RIF 9.2–9.3: exact five takes precedence; a three must have a legal
// continuation to an open four. That continuation can itself be a false three.
export function forbiddenMove(board: Stone[], at: number): Forbidden | null {
  if (!Number.isInteger(at) || at < 0 || at >= 225 || board[at]) return null;
  board[at] = 1;
  try {
    const lengths = directions.map(([dx, dy]) => run(board, at, dx, dy));
    if (lengths.includes(5)) return null;
    if (lengths.some(n => n > 5)) return "장목";
    // A double-three needs two axes with at least two existing stones;
    // two fours on one axis need at least four. Most candidate cells have
    // neither, so avoid building windows or recursing for those cells.
    const nearby = directions.map(([dx, dy]) => {
      let count = 0;
      for (const sign of [-1, 1]) for (let n = 1; n <= 4; n++) {
        const next = cell(at, dx, dy, n * sign);
        if (next < 0 || board[next] === 2) break;
        if (board[next] === 1) count++;
      }
      return count;
    });
    if (nearby.filter(n => n >= 2).length < 2 && nearby.every(n => n < 4)) return null;
    const fours = new Set<string>();
    const threes = new Map<string, Set<number>>();
    for (const [dx, dy] of directions) {
      for (let offset = -4; offset <= 0; offset++) {
        const cells = Array.from({ length: 5 }, (_, n) => cell(at, dx, dy, offset + n));
        if (cells.some(c => c < 0 || board[c] === 2)) continue;
        const stones = cells.filter(c => board[c] === 1), empty = cells.filter(c => !board[c]);
        if (stones.length !== 4) continue;
        const end = empty[0]; board[end] = 1;
        const exact = run(board, end, dx, dy) === 5;
        board[end] = 0;
        if (exact) fours.add(stones.join(","));
      }
      for (let offset = -3; offset <= 0; offset++) {
        const before = cell(at, dx, dy, offset - 1), after = cell(at, dx, dy, offset + 4);
        if (before < 0 || after < 0 || board[before] || board[after]) continue;
        const cells = Array.from({ length: 4 }, (_, n) => cell(at, dx, dy, offset + n));
        if (cells.some(c => c < 0 || board[c] === 2)) continue;
        const stones = cells.filter(c => board[c] === 1), empty = cells.filter(c => !board[c]);
        if (stones.length !== 3) continue;
        // An apparent open four whose endpoint would overline is not straight four.
        const farBefore = cell(at, dx, dy, offset - 2), farAfter = cell(at, dx, dy, offset + 5);
        if ((farBefore >= 0 && board[farBefore] === 1) || (farAfter >= 0 && board[farAfter] === 1)) continue;
        const key = stones.join(",");
        if (!threes.has(key)) threes.set(key, new Set());
        threes.get(key)!.add(empty[0]);
      }
    }
    if (fours.size >= 2) return "44";
    if (threes.size < 2) return null;
    let realThrees = 0;
    for (const continuations of threes.values()) {
      for (const next of continuations) {
        board[next] = 1;
        const wins = directions.some(([dx, dy]) => run(board, next, dx, dy) === 5);
        board[next] = 0;
        if (!wins && forbiddenMove(board, next) === null) { realThrees++; break; }
      }
      if (realThrees >= 2) return "33";
    }
    return null;
  } finally { board[at] = 0; }
}

export function isLegalMove(board: Stone[], at: number, stone: 1 | 2) {
  return Number.isInteger(at) && at >= 0 && at < 225 && board[at] === 0 && (stone === 2 || forbiddenMove(board, at) === null);
}
export function legalMoves(board: Stone[], stone: 1 | 2): number[] {
  return board.flatMap((_, at) => isLegalMove(board, at, stone) ? [at] : []);
}
