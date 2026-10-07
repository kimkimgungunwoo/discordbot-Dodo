export type Stone = 0 | 1 | 2;
export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme' | 'transcendent';
export const LABELS: Record<Difficulty, string> = { easy: '쉬움', normal: '중간', hard: '어려움', extreme: '극한', transcendent: '초월' };
export const TURN_LIMIT_MS = 45_000;
export const TOSS_MS = 4000;
export const AI_RESPONSE_LIMIT_MS = 19_000;
export const TRANSCENDENT_BUDGET_MS = 16_000;
export interface BoardState { board: Stone[]; turn: 1 | 2; winner: Stone; draw: boolean; moves: number[]; line: number[]; passed: Stone }
export const other = (stone: 1 | 2): 1 | 2 => stone === 1 ? 2 : 1;
export function freshBoard(): BoardState {
  const board: Stone[] = Array(64).fill(0);
  board[27] = board[36] = 2; board[28] = board[35] = 1;
  return { board, turn: 1, winner: 0, draw: false, moves: [], line: [], passed: 0 };
}
export function flips(board: Stone[], at: number, stone: 1 | 2): number[] {
  if (!Number.isInteger(at) || at < 0 || at >= 64 || board[at]) return [];
  const result: number[] = [], x = at % 8, y = Math.floor(at / 8);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const ray: number[] = []; let cx = x + dx, cy = y + dy;
    while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8 && board[cy * 8 + cx] === other(stone)) {
      ray.push(cy * 8 + cx); cx += dx; cy += dy;
    }
    if (ray.length && cx >= 0 && cx < 8 && cy >= 0 && cy < 8 && board[cy * 8 + cx] === stone) result.push(...ray);
  }
  return result;
}
export const isLegalMove = (board: Stone[], at: number, stone: 1 | 2) => flips(board, at, stone).length > 0;
export const legalMoves = (board: Stone[], stone: 1 | 2) => board.flatMap((_, at) => isLegalMove(board, at, stone) ? [at] : []);
export const counts = (board: Stone[]) => ({ red: board.filter(s => s === 1).length, blue: board.filter(s => s === 2).length });
export function place(state: BoardState, at: number): BoardState {
  const line = flips(state.board, at, state.turn);
  if (state.winner || state.draw || !line.length) throw new Error('상대 돌을 뒤집을 수 있는 칸에 놓아주세요.');
  const board = [...state.board]; board[at] = state.turn; line.forEach(i => board[i] = state.turn);
  let turn = other(state.turn), passed: Stone = 0, winner: Stone = 0, draw = false;
  if (!legalMoves(board, turn).length) {
    passed = turn; turn = state.turn;
    if (!legalMoves(board, turn).length) { const n = counts(board); winner = n.red > n.blue ? 1 : n.blue > n.red ? 2 : 0; draw = winner === 0; passed = 0; }
  }
  return { board, turn, passed, winner, draw, moves: [...state.moves, at], line };
}
const corners = [0, 7, 56, 63];
function evaluate(state: BoardState, stone: 1 | 2): number {
  const enemy = other(stone); let score = 0;
  state.board.forEach((s, at) => {
    if (!s) return;
    const sign = s === stone ? 1 : -1, x = at % 8, y = Math.floor(at / 8);
    let weight = 1;
    if (corners.includes(at)) weight = 100;
    else if (x === 0 || x === 7 || y === 0 || y === 7) weight = 8;
    for (const c of corners) if (!state.board[c] && Math.abs(x - c % 8) <= 1 && Math.abs(y - Math.floor(c / 8)) <= 1) weight = -35;
    score += sign * weight;
  });
  return score + 12 * (legalMoves(state.board, stone).length - legalMoves(state.board, enemy).length);
}
export interface SearchOptions { budgetMs?: number; onProgress?: (move: number) => void }
export function chooseMove(state: BoardState, difficulty: Difficulty = 'normal', random = Math.random, options: SearchOptions = {}): number {
  const moves = legalMoves(state.board, state.turn);
  if (!moves.length) throw new Error('합법 수가 없습니다.');
  if (difficulty === 'easy') return moves[Math.floor(random() * moves.length)];
  const root = state.turn, empty = state.board.filter(s => !s).length;
  const settings = { normal: [2, 60], hard: [5, 250], extreme: [9, 1200], transcendent: [64, TRANSCENDENT_BUDGET_MS] }[difficulty];
  const deadline = performance.now() + Math.min(settings[1], options.budgetMs ?? Infinity);
  const timeout = Symbol('timeout'); let nodes = 0;
  const ordered = (s: BoardState) => legalMoves(s.board, s.turn).sort((a, b) => evaluate(place(s, b), s.turn) - evaluate(place(s, a), s.turn));
  function search(s: BoardState, depth: number, alpha: number, beta: number): number {
    if ((++nodes & 63) === 0 && performance.now() >= deadline) throw timeout;
    if (s.winner || s.draw) { const n = counts(s.board), difference = root === 1 ? n.red - n.blue : n.blue - n.red; return difference === 0 ? 0 : Math.sign(difference) * 100000 + difference; }
    if (!depth) return evaluate(s, root);
    const maximizing = s.turn === root; let best = maximizing ? -Infinity : Infinity;
    for (const at of ordered(s)) {
      const value = search(place(s, at), depth - 1, alpha, beta);
      best = maximizing ? Math.max(best, value) : Math.min(best, value);
      if (maximizing) alpha = Math.max(alpha, best); else beta = Math.min(beta, best);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = ordered(state)[0]; options.onProgress?.(best);
  const maxDepth = difficulty === 'extreme' && empty <= 12 ? empty : Math.min(settings[0], empty);
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      let candidate = best, value = -Infinity;
      for (const at of [best, ...moves.filter(i => i !== best)]) {
        if (performance.now() >= deadline) throw timeout;
        const v = search(place(state, at), depth - 1, value, Infinity);
        if (v > value) { value = v; candidate = at; }
      }
      best = candidate; options.onProgress?.(best);
    } catch (error) { if (error !== timeout) throw error; break; }
  }
  return best;
}
