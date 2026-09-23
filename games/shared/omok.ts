import { forbiddenMove, isLegalMove, legalMoves } from "./renju.js";
export { forbiddenMove, isLegalMove, legalMoves } from "./renju.js";
export const SIZE = 15;
export type Stone = 0 | 1 | 2;
export type Difficulty = "easy" | "normal" | "hard" | "extreme" | "transcendent";
export const LABELS: Record<Difficulty, string> = { easy: "쉬움", normal: "중간", hard: "어려움", extreme: "극한", transcendent: "초월" };
export const DIFFICULTIES = Object.keys(LABELS) as Difficulty[];
export const TURN_LIMIT_MS = 45_000;
export const TOSS_MS = 4000;
export const TRANSCENDENT_BUDGET_MS = 11_000;
export const AI_RESPONSE_LIMIT_MS = 14_000;
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
    if (line.length === 5 || (board[at] === 2 && line.length > 5)) return line;
  }
  return [];
}
export function place(state: BoardState, at: number): BoardState {
  if (state.winner || state.draw || !Number.isInteger(at) || at < 0 || at >= SIZE * SIZE || state.board[at]) throw new Error("빈 교차점에 착수해주세요.");
  const forbidden = state.turn === 1 ? forbiddenMove(state.board, at) : null;
  if (forbidden) throw new Error(`흑돌 ${forbidden} 금수입니다. 다른 곳에 착수해주세요.`);
  const board = [...state.board]; board[at] = state.turn;
  const line = winningLine(board, at), moves = [...state.moves, at];
  return { board, moves, line, winner: line.length ? state.turn : 0, draw: !line.length && !legalMoves(board, other(state.turn)).length, turn: other(state.turn) };
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
function threat(board: Stone[], at: number, stone: 1 | 2, openBonus: boolean, advanced: boolean) {
  board[at] = stone;
  if (winningLine(board, at).length) { board[at] = 0; return 10000000; }
  let value = 0;
  let fourAxes = 0, threeAxes = 0;
  for (const [dx, dy] of directions) {
    let best = 0;
    const completions = new Set<number>();
    for (let offset = -4; offset <= 0; offset++) {
      let count = 0, blocked = false;
      for (let n = 0; n < 5; n++) {
        const cell = index(at % SIZE + (offset + n) * dx, Math.floor(at / SIZE) + (offset + n) * dy);
        if (cell < 0 || (board[cell] && board[cell] !== stone)) { blocked = true; break; }
        if (board[cell] === stone) count++;
      }
      if (blocked) continue;
      if (advanced && count === 4) {
        const before = index(at % SIZE + (offset - 1) * dx, Math.floor(at / SIZE) + (offset - 1) * dy);
        const after = index(at % SIZE + (offset + 5) * dx, Math.floor(at / SIZE) + (offset + 5) * dy);
        if (stone === 2 || ((before < 0 || board[before] !== stone) && (after < 0 || board[after] !== stone))) {
          for (let n = 0; n < 5; n++) {
            const next = index(at % SIZE + (offset + n) * dx, Math.floor(at / SIZE) + (offset + n) * dy);
            if (!board[next]) completions.add(next);
          }
        }
      }
      const base = [0, 2, 30, 500, 15000, 10000000][count];
      if (!openBonus || count === 5) { best = Math.max(best, base); continue; }
      const before = index(at % SIZE + (offset - 1) * dx, Math.floor(at / SIZE) + (offset - 1) * dy);
      const after = index(at % SIZE + (offset + 5) * dx, Math.floor(at / SIZE) + (offset + 5) * dy);
      const open = Number(before >= 0 && board[before] === 0) + Number(after >= 0 && board[after] === 0);
      best = Math.max(best, base * (1 + open * .4));
    }
    if (advanced) {
      if (completions.size) { fourAxes++; best = Math.max(best, completions.size > 1 ? 1000000 : 30000); }
      let line = "";
      for (let n = -5; n <= 5; n++) {
        const next = index(at % SIZE + dx * n, Math.floor(at / SIZE) + dy * n);
        line += next < 0 ? "#" : board[next] === stone ? "X" : board[next] === 0 ? "." : "#";
      }
      const openThree = [".XXX.", ".XX.X.", ".X.XX."].some(pattern => {
        for (let start = 0; start + pattern.length <= line.length; start++) {
          if (start < 5 && start + pattern.length - 1 > 5 && line.slice(start, start + pattern.length) === pattern) return true;
        }
        return false;
      });
      if (openThree && !completions.size) { threeAxes++; best = Math.max(best, 8000); }
    }
    value += best;
  }
  board[at] = 0;
  return value + (fourAxes > 1 ? 600000 : 0) + (fourAxes && threeAxes ? 120000 : 0) + (threeAxes > 1 ? 80000 : 0);
}
function ranked(board: Stone[], stone: 1 | 2, radius: number, openBonus: boolean, advanced = false) {
  const nearby = candidates(board, radius).filter(at => isLegalMove(board, at, stone));
  return (nearby.length ? nearby : legalMoves(board, stone)).map(at => ({ at, attack: threat(board, at, stone, openBonus, advanced), defense: isLegalMove(board, at, other(stone)) ? threat(board, at, other(stone), openBonus, advanced) : 0 }))
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
  if (!choices.length) return 0;
  const topAttack = choices[0].attack + (choices[1] ? choices[1].attack * .5 : 0);
  const bestDefense = Math.max(...choices.map(move => move.defense));
  return topAttack - bestDefense * 1.1;
}
interface FixedSearch { depth: number; width: number; budget: number }
interface TimedSearch { budgetMs: number; width: number; maxDepth: number }
const isTimed = (search: FixedSearch | TimedSearch): search is TimedSearch => "budgetMs" in search;
const FULL_RADIUS = 2;
interface Profile { radius: number; openBonus: boolean; temperature: number; search: FixedSearch | TimedSearch | null }
const PROFILES: Record<Exclude<Difficulty, "transcendent">, Profile> = {
  easy: { radius: 1, openBonus: false, temperature: 700, search: null },
  normal: { radius: 1, openBonus: true, temperature: 150, search: { depth: 1, width: 5, budget: 180 } },
  hard: { radius: FULL_RADIUS, openBonus: true, temperature: 0, search: { depth: 2, width: 7, budget: 1200 } },
  extreme: { radius: FULL_RADIUS, openBonus: true, temperature: 0, search: { budgetMs: 500, width: 10, maxDepth: 8 } },
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
    if (!choices.length) return 0;
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
    if (!choices.length) return 0;
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
export interface SearchStats { nodes: number; depth: number; forcedWin: boolean; elapsedMs: number; rejectedAttacks?: number }
export interface SearchOptions { budgetMs?: number; onProgress?: (move: number) => void }
export function transcendentMove(board: Stone[], stone: 1 | 2, budgetMs = TRANSCENDENT_BUDGET_MS, stats?: SearchStats, onProgress?: (move: number) => void): number {
  const started = performance.now(), deadline = started + Math.max(0, budgetMs);
  const MATE = 1_000_000_000, WIN = 10000000, timeout = Symbol("search timeout");
  type Choice = { at: number; attack: number; defense: number };
  type Entry = { depth: number; score: number; bound: "exact" | "lower" | "upper"; move: number };
  const table = new Map<string, Entry>(), moveCache = new Map<string, [Choice[], Choice[]]>();
  const shapeCache = new Map<string, [number, number]>();
  const neighborhoods = Array.from({ length: 225 }, (_, at) => directions.flatMap(([dx, dy]) =>
    Array.from({ length: 11 }, (_, n) => index(at % SIZE + dx * (n - 5), Math.floor(at / SIZE) + dy * (n - 5)))));
  const proofs = new Map<string, number>(), killers = new Map<number, number[]>();
  const history = [new Float64Array(225), new Float64Array(225)];
  let nodes = 0, completedDepth = 0, forcedWin = false, rejectedAttacks = 0;
  let hashA = 0, hashB = 0, seed = 0x12345678;
  const hashes = Array.from({ length: 450 }, () => {
    const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    return [next(), next()];
  });
  function toggle(at: number, turn: 1 | 2) { const [a, b] = hashes[at * 2 + turn - 1]; hashA ^= a; hashB ^= b; }
  board.forEach((value, at) => { if (value) toggle(at, value); });
  const boardKey = () => `${hashA}:${hashB}`;
  const key = (turn: 1 | 2) => `${boardKey()}:${turn}`;
  function checkTime() { nodes++; if (performance.now() >= deadline) throw timeout; }
  const center = (at: number) => Math.abs(at % 15 - 7) + Math.abs(Math.floor(at / 15) - 7);
  const order = (a: Choice, b: Choice) => (b.attack + b.defense * 1.1) - (a.attack + a.defense * 1.1) || center(a.at) - center(b.at) || a.at - b.at;
  function options(turn: 1 | 2) {
    checkTime();
    const id = boardKey(), cached = moveCache.get(id);
    if (cached) return cached[turn - 1];
    const pair: [Choice[], Choice[]] = [[], []];
    const score = (at: number) => {
      const blackLegal = isLegalMove(board, at, 1);
      let shape = "";
      for (const next of neighborhoods[at]) shape += next < 0 ? "3" : board[next];
      let values = shapeCache.get(shape);
      if (!values) {
        values = [threat(board, at, 1, true, true), threat(board, at, 2, true, true)];
        if (shapeCache.size >= 16000) shapeCache.clear();
        shapeCache.set(shape, values);
      }
      const black = blackLegal ? values[0] : 0, white = values[1];
      if (blackLegal) pair[0].push({ at, attack: black, defense: white });
      pair[1].push({ at, attack: white, defense: black });
    };
    const nearby = candidates(board, 2);
    for (const at of nearby) if (!board[at]) score(at);
    if (!pair[0].length || !pair[1].length) {
      const seen = new Set(nearby);
      for (let at = 0; at < 225; at++) if (!board[at] && !seen.has(at)) score(at);
    }
    pair.forEach(moves => moves.sort(order));
    if (moveCache.size >= 4096) moveCache.clear();
    moveCache.set(id, pair);
    return pair[turn - 1];
  }
  function played<T>(at: number, turn: 1 | 2, action: () => T): T {
    board[at] = turn; toggle(at, turn);
    try { return action(); } finally { toggle(at, turn); board[at] = 0; }
  }
  // Only a fully verified continuous-four sequence is a proof. Timeouts
  // mean unknown, so defensive screening never discards an unproven move.
  function prove(turn: 1 | 2, remaining: number, until: number): number | null {
    if (performance.now() >= until || remaining <= 0) return null;
    const id = key(turn), known = proofs.get(id);
    if (known !== undefined) return known;
    const moves = options(turn), win = moves.find(m => m.attack >= WIN);
    if (win) return win.at;
    const enemyWins = options(other(turn)).filter(m => m.attack >= WIN);
    if (enemyWins.length > 1) return null;
    const attacks = moves.filter(m => m.attack >= 15000 && (!enemyWins.length || m.at === enemyWins[0].at));
    for (const move of attacks) {
      if (performance.now() >= until) break;
      const proven = played(move.at, turn, () => {
        const replies = options(other(turn));
        if (replies.some(m => m.attack >= WIN)) return false;
        const threats = options(turn).filter(m => m.attack >= WIN);
        if (threats.length > 1) return true;
        if (!threats.length) return false;
        const block = threats[0].at;
        if (!isLegalMove(board, block, other(turn))) return true;
        return played(block, other(turn), () => prove(turn, remaining - 2, until) !== null);
      });
      if (proven) { if (proofs.size >= 4096) proofs.clear(); proofs.set(id, move.at); return move.at; }
    }
    return null;
  }
  function evaluateChoices(moves: Choice[], defense: Choice[]) {
    const top = (choices: Choice[]) => {
      const values = choices.map(m => m.attack).sort((a, b) => b - a);
      return (values[0] ?? 0) + (values[1] ?? 0) * .4 + (values[2] ?? 0) * .15;
    };
    return top(moves) - top(defense) * 1.08;
  }
  function search(turn: 1 | 2, depth: number, alpha: number, beta: number, ply: number, extension = 4): number {
    checkTime();
    const id = key(turn), entry = table.get(id), alphaStart = alpha, betaStart = beta;
    if (depth > 0 && entry && entry.depth >= depth) {
      if (entry.bound === "exact") return entry.score;
      if (entry.bound === "lower") alpha = Math.max(alpha, entry.score);
      else beta = Math.min(beta, entry.score);
      if (alpha >= beta) return entry.score;
    }
    const moves = options(turn), enemyMoves = options(other(turn));
    if (!moves.length) return 0;
    if (moves.some(m => m.attack >= WIN)) return MATE - ply;
    const enemyWins = enemyMoves.filter(m => m.attack >= WIN);
    if (enemyWins.length > 1) return -MATE + ply + 1;
    let selected: Choice[], quietScore = -Infinity;
    if (enemyWins.length) {
      selected = moves.filter(m => m.at === enemyWins[0].at);
      if (!selected.length) return -MATE + ply + 1;
    } else if (depth <= 0) {
      const standPat = evaluateChoices(moves, enemyMoves);
      if (extension <= 0) return standPat;
      // An opponent open-three/fork cannot be ignored by standing pat.
      const threatened = enemyMoves.some(m => m.attack >= 100000);
      if (!threatened) {
        quietScore = standPat;
        if (standPat >= beta) return standPat;
        alpha = Math.max(alpha, standPat);
      }
      selected = moves.filter(m => m.attack >= 15000 || (threatened && m.defense >= 8000)).slice(0, 10);
      if (!selected.length) return standPat;
    } else {
      selected = moves.slice(0, ply < 3 ? 18 : 12);
      const priority = (move: Choice) => move.at === entry?.move ? 1e12 :
        move.attack >= 30000 || move.defense >= 30000 ? 1e10 + move.attack + move.defense :
        (killers.get(ply)?.includes(move.at) ? 1e8 : 0) + history[turn - 1][move.at] + move.attack + move.defense * 1.1;
      selected.sort((a, b) => priority(b) - priority(a));
    }
    if (ply >= 48) return evaluateChoices(moves, enemyMoves);
    let best = quietScore, bestMove = selected[0].at;
    for (let i = 0; i < selected.length; i++) {
      const move = selected[i];
      const score = played(move.at, turn, () => {
        const nextExtension = depth <= 0 ? extension - 1 : extension;
        if (i === 0 || !Number.isFinite(alpha)) return -search(other(turn), depth - 1, -beta, -alpha, ply + 1, nextExtension);
        const quiet = move.attack < 8000 && move.defense < 8000 && !enemyWins.length;
        const reduction = depth >= 3 && i >= 6 && quiet ? 1 : 0;
        let value = -search(other(turn), depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, nextExtension);
        if (reduction && value > alpha) value = -search(other(turn), depth - 1, -alpha - 1, -alpha, ply + 1, nextExtension);
        if (value > alpha && value < beta) value = -search(other(turn), depth - 1, -beta, -alpha, ply + 1, nextExtension);
        return value;
      });
      if (score > best) { best = score; bestMove = move.at; }
      alpha = Math.max(alpha, score);
      if (alpha >= beta) {
        if (depth > 0) {
          killers.set(ply, [move.at, ...(killers.get(ply) ?? []).filter(at => at !== move.at)].slice(0, 2));
          history[turn - 1][move.at] += depth * depth;
        }
        break;
      }
    }
    if (depth > 0) {
      if (table.size >= 48000) table.clear();
      table.set(id, { depth, score: best, move: bestMove, bound: best <= alphaStart ? "upper" : best >= betaStart ? "lower" : "exact" });
    }
    return best;
  }
  let root = ranked(board, stone, 2, true, true).slice(0, 24);
  if (!root.length) throw new Error("착수할 수 있는 곳이 없습니다.");
  let bestMove = root[0].at;
  onProgress?.(bestMove);
  try {
    const proof = prove(stone, 32, started + budgetMs * .15);
    if (proof !== null) { bestMove = proof; forcedWin = true; }
    else {
      const danger = prove(other(stone), 24, started + budgetMs * .22);
      if (danger !== null) {
        const defense = options(stone).find(m => m.at === danger);
        if (defense && !root.some(m => m.at === danger)) root.unshift(defense);
        const safe: Choice[] = [], screenUntil = started + budgetMs * .40;
        for (let i = 0; i < root.length; i++) {
          const until = Math.min(screenUntil, performance.now() + Math.max(1, (screenUntil - performance.now()) / (root.length - i)));
          const lost = played(root[i].at, stone, () => prove(other(stone), 24, until) !== null);
          if (!lost) safe.push(root[i]); else rejectedAttacks++;
        }
        if (safe.length) { root = safe; bestMove = root[0].at; onProgress?.(bestMove); }
      }
      for (let depth = 1; depth <= 26; depth++) {
        let alpha = -Infinity;
        const scores: { move: Choice; score: number }[] = [];
        for (const move of root) {
          checkTime();
          const score = played(move.at, stone, () => -search(other(stone), depth - 1, -Infinity, -alpha, 1));
          scores.push({ move, score }); alpha = Math.max(alpha, score);
        }
        scores.sort((a, b) => b.score - a.score);
        bestMove = scores[0].move.at; completedDepth = depth;
        root = scores.map(s => s.move); onProgress?.(bestMove);
        if (scores[0].score > MATE - 100) { forcedWin = true; break; }
      }
    }
  } catch (error) { if (error !== timeout) throw error; }
  onProgress?.(bestMove);
  if (stats) Object.assign(stats, { nodes, depth: completedDepth, forcedWin, rejectedAttacks, elapsedMs: performance.now() - started });
  return bestMove;
}

export function chooseMove(state: BoardState, difficulty: Difficulty = "normal", random = Math.random, options: SearchOptions = {}): number {
  if (state.winner || state.draw) throw new Error("종료된 경기입니다.");
  const board = [...state.board], stone = state.turn;
  const forced = ranked(board, stone, FULL_RADIUS, true);
  const win = forced.find(move => move.attack >= 10000000);
  if (win) return win.at;
  const block = forced.find(move => move.defense >= 10000000);
  if (block) return block.at;
  if (!forced.length) throw new Error("착수할 수 있는 곳이 없습니다.");
  if (forced.length === 1) return forced[0].at;
  if (difficulty === "transcendent") return transcendentMove(board, stone, options.budgetMs, undefined, options.onProgress);
  const profile = PROFILES[difficulty];
  if (!profile.search) return greedyMove(board, stone, profile, random);
  return isTimed(profile.search) ? timeBoundedMove(board, stone, profile, random) : searchMove(board, stone, profile, random);
}
