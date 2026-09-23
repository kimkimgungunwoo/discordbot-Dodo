export const SIZE = 15;
export type Stone = 0 | 1 | 2;
export type Difficulty = "easy" | "normal" | "hard" | "extreme" | "transcendent";
export const LABELS: Record<Difficulty, string> = { easy: "쉬움", normal: "중간", hard: "어려움", extreme: "극한", transcendent: "초월" };
export const DIFFICULTIES = Object.keys(LABELS) as Difficulty[];
export const TURN_LIMIT_MS = 45_000;
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
function candidates(board: Stone[], radius: number) {
  const cells = new Set<number>();
  board.forEach((stone, at) => {
    if (!stone) return;
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      const next = index(at % SIZE + x, Math.floor(at / SIZE) + y);
      if (next >= 0 && !board[next]) cells.add(next);
    }
  });
  return cells.size ? [...cells] : [112];
}
function threat(board: Stone[], at: number, stone: 1 | 2, openBonus: boolean) {
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
      const base = [0, 2, 30, 500, 15000, 10000000][count];
      if (!openBonus || count === 5) { best = Math.max(best, base); continue; }
      const before = index(at % SIZE + (offset - 1) * dx, Math.floor(at / SIZE) + (offset - 1) * dy);
      const after = index(at % SIZE + (offset + 5) * dx, Math.floor(at / SIZE) + (offset + 5) * dy);
      const open = Number(before >= 0 && board[before] === 0) + Number(after >= 0 && board[after] === 0);
      best = Math.max(best, base * (1 + open * .4));
    }
    value += best;
  }
  board[at] = 0;
  return value;
}
function ranked(board: Stone[], stone: 1 | 2, radius: number, openBonus: boolean) {
  return candidates(board, radius).map(at => ({ at, attack: threat(board, at, stone, openBonus), defense: threat(board, at, other(stone), openBonus) }))
    .sort((a, b) => (b.attack + b.defense * 1.1) - (a.attack + a.defense * 1.1) || Math.abs(a.at - 112) - Math.abs(b.at - 112));
}
function pickWithTemperature(scored: { at: number; score: number }[], temperature: number, random: () => number): number {
  if (temperature <= 0 || scored.length <= 1) return scored[0].at;
  const top = scored[0].score;
  const pool = scored.filter(s => top - s.score <= temperature);
  const weights = pool.map(s => temperature - (top - s.score) + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll <= 0) return pool[i].at; }
  return pool[pool.length - 1].at;
}
function evaluate(board: Stone[], turn: 1 | 2, radius: number, openBonus: boolean): number {
  const choices = ranked(board, turn, radius, openBonus);
  const topAttack = choices[0].attack + (choices[1] ? choices[1].attack * .5 : 0);
  const bestDefense = Math.max(...choices.map(move => move.defense));
  return topAttack - bestDefense * 1.1;
}
interface FixedSearch { depth: number; width: number; budget: number }
interface TimedSearch { budgetMs: number; width: number; maxDepth: number }
const isTimed = (search: FixedSearch | TimedSearch): search is TimedSearch => "budgetMs" in search;
const FULL_RADIUS = 2;
interface Profile { radius: number; openBonus: boolean; temperature: number; search: FixedSearch | TimedSearch | null }
const PROFILES: Record<Difficulty, Profile> = {
  easy: { radius: 1, openBonus: false, temperature: 700, search: null },
  normal: { radius: 1, openBonus: true, temperature: 150, search: { depth: 1, width: 5, budget: 180 } },
  hard: { radius: FULL_RADIUS, openBonus: true, temperature: 0, search: { depth: 2, width: 7, budget: 1200 } },
  extreme: { radius: FULL_RADIUS, openBonus: true, temperature: 0, search: { budgetMs: 500, width: 10, maxDepth: 8 } },
  transcendent: { radius: FULL_RADIUS, openBonus: true, temperature: 0, search: { budgetMs: 2000, width: 12, maxDepth: 10 } },
};
function greedyMove(board: Stone[], stone: 1 | 2, profile: Profile, random: () => number): number {
  const options = ranked(board, stone, profile.radius, profile.openBonus);
  return pickWithTemperature(options.map(o => ({ at: o.at, score: o.attack + o.defense * 1.1 })), profile.temperature, random);
}
function searchMove(board: Stone[], stone: 1 | 2, profile: Profile, random: () => number): number {
  const { radius, openBonus, temperature } = profile;
  const { depth, width, budget: initialBudget } = profile.search as FixedSearch;
  let budget = initialBudget;
  function search(turn: 1 | 2, remaining: number, alpha: number, beta: number): number {
    if (board.every(Boolean)) return 0;
    const choices = ranked(board, turn, radius, openBonus);
    if (choices.some(move => move.attack >= 10000000)) return 10000000 + remaining * 10000;
    if (!remaining || --budget <= 0) return evaluate(board, turn, radius, openBonus);
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
  const options = ranked(board, stone, radius, openBonus);
  const scored: { at: number; score: number }[] = [];
  for (const move of options.slice(0, width)) {
    board[move.at] = stone;
    const value = -search(other(stone), depth, -Infinity, Infinity) + move.attack * .01;
    board[move.at] = 0;
    scored.push({ at: move.at, score: value });
    if (budget <= 0) break;
  }
  scored.sort((a, b) => b.score - a.score);
  return pickWithTemperature(scored.length ? scored : [{ at: options[0].at, score: 0 }], temperature, random);
}
function timeBoundedMove(board: Stone[], stone: 1 | 2, profile: Profile, random: () => number): number {
  const { radius, openBonus, temperature } = profile;
  const { budgetMs, width, maxDepth } = profile.search as TimedSearch;
  const deadline = Date.now() + budgetMs;
  function search(turn: 1 | 2, remaining: number, alpha: number, beta: number): number {
    if (board.every(Boolean)) return 0;
    const choices = ranked(board, turn, radius, openBonus);
    if (choices.some(move => move.attack >= 10000000)) return 10000000 + remaining * 10000;
    if (!remaining || Date.now() >= deadline) return evaluate(board, turn, radius, openBonus);
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
  const options = ranked(board, stone, radius, openBonus);
  let overallScored: { at: number; score: number }[] = [{ at: options[0].at, score: 0 }];
  for (let depth = 2; depth <= maxDepth && Date.now() < deadline; depth++) {
    const scored: { at: number; score: number }[] = [];
    let complete = true;
    for (const move of options.slice(0, width)) {
      if (Date.now() >= deadline) { complete = false; break; }
      board[move.at] = stone;
      const value = -search(other(stone), depth, -Infinity, Infinity) + move.attack * .01;
      board[move.at] = 0;
      scored.push({ at: move.at, score: value });
    }
    if (!complete) break;
    overallScored = scored;
  }
  overallScored.sort((a, b) => b.score - a.score);
  return pickWithTemperature(overallScored, temperature, random);
}
export function chooseMove(state: BoardState, difficulty: Difficulty = "normal", random = Math.random): number {
  if (state.winner || state.draw) throw new Error("종료된 경기입니다.");
  const board = [...state.board], stone = state.turn;
  const forced = ranked(board, stone, FULL_RADIUS, true);
  const win = forced.find(move => move.attack >= 10000000);
  if (win) return win.at;
  const block = forced.find(move => move.defense >= 10000000);
  if (block) return block.at;
  const profile = PROFILES[difficulty];
  if (!profile.search) return greedyMove(board, stone, profile, random);
  return isTimed(profile.search) ? timeBoundedMove(board, stone, profile, random) : searchMove(board, stone, profile, random);
}
