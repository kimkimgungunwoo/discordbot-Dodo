/** 15x15 freestyle: five or more wins, no forbidden moves. */
export const SIZE = 15;
export type Stone = 0 | 1 | 2;
export type Difficulty = "easy" | "normal" | "hard" | "extreme" | "transcendent";
export const LABELS: Record<Difficulty, string> = { easy: "쉬움", normal: "중간", hard: "어려움", extreme: "극한", transcendent: "초월" };
export const DIFFICULTIES = Object.keys(LABELS) as Difficulty[];
// 한 수를 이 안에 두지 않으면 서버가 대신 무작위로 둔다 — 클라이언트도 같은 값으로 턴 타이머 게이지를 그린다.
export const TURN_LIMIT_MS = 45_000;
// 동전 던지기 총 대기 시간 — 클라이언트가 이 중 마지막 구간을 "공개" 연출로 쓴다(omok/main.ts의 COIN_REVEAL_MS).
export const TOSS_MS = 4000;
export interface BoardState { board: Stone[]; turn: 1 | 2; winner: Stone; draw: boolean; moves: number[]; line: number[] }
const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
export const other = (stone: 1 | 2): 1 | 2 => stone === 1 ? 2 : 1;
export const freshBoard = (): BoardState => ({ board: Array(SIZE * SIZE).fill(0), turn: 1, winner: 0, draw: false, moves: [], line: [] });
function index(x: number, y: number) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? y * SIZE + x : -1; }
export function winningLine(board: Stone[], at: number): number[] {
  if (!board[at]) return [];
  for (const [dx, dy] of directions) {
    const line = [at];
    for (const sign of [-1, 1]) for (let n = 1; n < SIZE; n++) {
      const next = index(at % SIZE + dx * n * sign, Math.floor(at / SIZE) + dy * n * sign);
      if (next < 0 || board[next] !== board[at]) break;
      line.push(next);
    }
    if (line.length >= 5) return line;
  }
  return [];
}
export function place(state: BoardState, at: number): BoardState {
  if (state.winner || state.draw || !Number.isInteger(at) || at < 0 || at >= SIZE * SIZE || state.board[at]) throw new Error("빈 교차점에 착수해주세요.");
  const board = [...state.board]; board[at] = state.turn;
  const line = winningLine(board, at), moves = [...state.moves, at];
  return { board, moves, line, winner: line.length ? state.turn : 0, draw: !line.length && moves.length === SIZE * SIZE, turn: other(state.turn) };
}
function candidates(board: Stone[]) {
  const cells = new Set<number>();
  board.forEach((stone, at) => {
    if (!stone) return;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      const next = index(at % SIZE + x, Math.floor(at / SIZE) + y);
      if (next >= 0 && !board[next]) cells.add(next);
    }
  });
  return cells.size ? [...cells] : [112];
}
// Five-cell windows include broken as well as contiguous threats.
function threat(board: Stone[], at: number, stone: 1 | 2) {
  board[at] = stone;
  let value = 0;
  for (const [dx, dy] of directions) {
    let best = 0;
    for (let offset = -4; offset <= 0; offset++) {
      let count = 0, blocked = false;
      for (let n = 0; n < 5; n++) {
        const cell = index(at % SIZE + (offset + n) * dx, Math.floor(at / SIZE) + (offset + n) * dy);
        if (cell < 0 || (board[cell] && board[cell] !== stone)) { blocked = true; break; }
        if (board[cell] === stone) count++;
      }
      if (blocked) continue;
      const before = index(at % SIZE + (offset - 1) * dx, Math.floor(at / SIZE) + (offset - 1) * dy);
      const after = index(at % SIZE + (offset + 5) * dx, Math.floor(at / SIZE) + (offset + 5) * dy);
      const open = Number(before >= 0 && board[before] === 0) + Number(after >= 0 && board[after] === 0);
      best = Math.max(best, [0, 2, 30, 500, 15000, 10000000][count] * (count === 5 ? 1 : 1 + open * .4));
    }
    value += best;
  }
  board[at] = 0;
  return value;
}
function ranked(board: Stone[], stone: 1 | 2) {
  return candidates(board).map(at => ({ at, attack: threat(board, at, stone), defense: threat(board, at, other(stone)) }))
    .sort((a, b) => (b.attack + b.defense * 1.1) - (a.attack + a.defense * 1.1) || Math.abs(a.at - 112) - Math.abs(b.at - 112));
}
// 탐색 없이 즉시 최선의(가장 위협적인) 자리를 두는 예전 "보통" 수준 — 지금은 "쉬움"이 이걸 쓴다.
function greedyMove(board: Stone[], stone: 1 | 2): number {
  return ranked(board, stone)[0].at;
}
// 이중 위협(포크) 평가 — 한 수만 보면 "동시에 두 군데를 위협하는 수"를 못 잡는다.
function evaluate(board: Stone[], turn: 1 | 2): number {
  const choices = ranked(board, turn);
  const topAttack = choices[0].attack + (choices[1] ? choices[1].attack * .5 : 0);
  const bestDefense = Math.max(...choices.map(move => move.defense));
  return topAttack - bestDefense * 1.1;
}
// 알파베타에 예산(budget)을 걸어 실행시간을 제한한다. depth/width/budget이 클수록 더 깊고 넓게, 더 오래 읽는다.
const SEARCH_SETTINGS: Record<"normal" | "hard", { depth: number; width: number; budget: number }> = {
  normal: { depth: 1, width: 5, budget: 180 },
  hard: { depth: 2, width: 7, budget: 1200 },
};
function searchMove(board: Stone[], stone: 1 | 2, { depth, width, budget: initialBudget }: { depth: number; width: number; budget: number }): number {
  let budget = initialBudget;
  function search(turn: 1 | 2, remaining: number, alpha: number, beta: number): number {
    if (board.every(Boolean)) return 0;
    const choices = ranked(board, turn);
    if (choices.some(move => move.attack >= 10000000)) return 10000000 + remaining * 10000;
    if (!remaining || --budget <= 0) return evaluate(board, turn);
    let best = -Infinity;
    const forced = choices.filter(move => move.defense >= 10000000);
    for (const move of (forced.length ? forced : choices.slice(0, width))) {
      board[move.at] = turn;
      const score = -search(other(turn), remaining - 1, -beta, -alpha);
      board[move.at] = 0;
      best = Math.max(best, score); alpha = Math.max(alpha, score);
      if (alpha >= beta || budget <= 0) break;
    }
    return best;
  }
  const options = ranked(board, stone);
  let best = options[0].at, score = -Infinity;
  for (const move of options.slice(0, width)) {
    board[move.at] = stone;
    const value = -search(other(stone), depth, -Infinity, Infinity) + move.attack * .01;
    board[move.at] = 0;
    if (value > score) { best = move.at; score = value; }
    if (budget <= 0) break;
  }
  return best;
}
// "극한"/"초월"은 고정 깊이 대신 시간 예산 안에서 반복 심화(iterative deepening)로 갈 수 있는 만큼 깊이
// 읽는다 — 노드 예산과 달리 위치가 단순하면 훨씬 깊게, 복잡하면 얕게 스스로 조절되고 서버 이벤트 루프를
// 막는 시간도 확정적으로 보장된다. "초월"은 예산·폭·최대 깊이를 전부 더 크게 잡아 뚜렷하게 더 오래·넓게 읽는다.
const TIME_BOUNDED_SETTINGS: Record<"extreme" | "transcendent", { budgetMs: number; width: number; maxDepth: number }> = {
  extreme: { budgetMs: 500, width: 10, maxDepth: 8 },
  transcendent: { budgetMs: 2000, width: 12, maxDepth: 10 },
};
function timeBoundedMove(board: Stone[], stone: 1 | 2, { budgetMs, width, maxDepth }: { budgetMs: number; width: number; maxDepth: number }): number {
  const deadline = Date.now() + budgetMs;
  function search(turn: 1 | 2, remaining: number, alpha: number, beta: number): number {
    if (board.every(Boolean)) return 0;
    const choices = ranked(board, turn);
    if (choices.some(move => move.attack >= 10000000)) return 10000000 + remaining * 10000;
    if (!remaining || Date.now() >= deadline) return evaluate(board, turn);
    let best = -Infinity;
    const forced = choices.filter(move => move.defense >= 10000000);
    for (const move of (forced.length ? forced : choices.slice(0, width))) {
      board[move.at] = turn;
      const score = -search(other(turn), remaining - 1, -beta, -alpha);
      board[move.at] = 0;
      best = Math.max(best, score); alpha = Math.max(alpha, score);
      if (alpha >= beta || Date.now() >= deadline) break;
    }
    return best;
  }
  const options = ranked(board, stone);
  let overallBest = options[0].at;
  // 시간이 다 되기 전에 끝난 깊이의 결과만 채택한다 — 도중에 잘린 얕은 추정치로 더 나은 수를 덮어쓰지 않기 위해서다.
  for (let depth = 2; depth <= maxDepth && Date.now() < deadline; depth++) {
    let best = overallBest, score = -Infinity, complete = true;
    for (const move of options.slice(0, width)) {
      if (Date.now() >= deadline) { complete = false; break; }
      board[move.at] = stone;
      const value = -search(other(stone), depth, -Infinity, Infinity) + move.attack * .01;
      board[move.at] = 0;
      if (value > score) { best = move.at; score = value; }
    }
    if (!complete) break;
    overallBest = best;
  }
  return overallBest;
}
export function chooseMove(state: BoardState, difficulty: Difficulty = "normal", random = Math.random): number {
  if (state.winner || state.draw) throw new Error("종료된 경기입니다.");
  void random; // 하위 호환을 위해 시그니처는 유지하지만, 모든 단계가 결정론적으로 수를 고른다.
  const board = [...state.board], stone = state.turn, options = ranked(board, stone);
  const win = options.find(move => move.attack >= 10000000);
  if (win) return win.at;
  const block = options.find(move => move.defense >= 10000000);
  if (block) return block.at;
  if (difficulty === "easy") return greedyMove(board, stone);
  if (difficulty === "extreme" || difficulty === "transcendent") return timeBoundedMove(board, stone, TIME_BOUNDED_SETTINGS[difficulty]);
  return searchMove(board, stone, SEARCH_SETTINGS[difficulty]);
}
