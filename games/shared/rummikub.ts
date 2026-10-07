// Shared, deterministic rules. Only the server owns the full hands and draw pile.
export const TURN_MS = 60_000;
export const BOT_THINK_MS = 1100;
export const BOT_TILE_MS = 420;
export const BOT_SETTLE_MS = 700;
export const BOT_FINAL_TURN_MS = 3000;
export const SEAT_COLORS = ["#487fa9", "#ba554c", "#60865c", "#cc8641"];
export interface Seat { userId: string | null; name: string; bot?: "normal" | "hard" }
/** Pairwise transfers: mixed rooms never discount human-to-human points. */
export function settledScores(raw: number[], winner: number | null, seats: Seat[]): number[] {
  if (winner === null || !raw.length) return [...raw];
  const factor = (seat: Seat) => seat.bot === "normal" ? 0.5 : seat.bot === "hard" ? 0.75 : 1;
  const scores = raw.map((score, i) => i === winner ? 0 : -Math.round(-score * Math.min(factor(seats[i]), factor(seats[winner]))));
  scores[winner] = -scores.reduce((sum, score) => sum + score, 0);
  return scores;
}
export interface Tile { id: number; color: number; number: number }
export const tile = (id: number): Tile => ({ id, color: id >= 104 ? -1 : Math.floor(id / 26), number: id >= 104 ? 0 : id % 13 + 1 });
export const copyTable = (table: number[][]) => table.map(group => [...group]);
export function requireUneditedTable(original: number[][], draft: number[][]): void {
  if (JSON.stringify(original) !== JSON.stringify(draft)) throw new Error("배치를 수정한 상태입니다. '턴 초기화'를 먼저 눌러주세요.");
}
/** Reveal only the next placed tile. Never send a bot's unrevealed plan/hand. */
export function botPlacementSteps(original: number[][], target: number[][]): number[][][] {
  const visible = new Set(original.flat());
  return target.flat().filter(id => !visible.has(id)).map(id => {
    visible.add(id);
    return target.map(group => group.filter(tileId => visible.has(tileId))).filter(group => group.length);
  });
}
interface Binding { number: number; colors: number[] }
export interface Meld { points: number; jokers: Record<number, Binding> }
export function meld(ids: number[]): Meld | null {
  if (ids.length < 3 || ids.length > 13 || new Set(ids).size !== ids.length) return null;
  if (ids.some(id => !Number.isInteger(id) || id < 0 || id > 105)) return null;
  const tiles = ids.map(tile), real = tiles.filter(t => t.number);
  if (!real.length) return null;
  if (ids.length <= 4 && real.every(t => t.number === real[0].number) && new Set(real.map(t => t.color)).size === real.length) {
    const colors = [0, 1, 2, 3].filter(c => !real.some(t => t.color === c));
    return { points: ids.length * real[0].number, jokers: Object.fromEntries(tiles.filter(t => !t.number).map(t => [t.id, { number: real[0].number, colors }])) };
  }
  if (!real.every(t => t.color === real[0].color)) return null;
  // Runs follow the displayed order (ascending or descending); no 13 -> 1 wrap.
  for (const step of [1, -1]) {
    const at = tiles.findIndex(t => t.number), start = tiles[at].number - at * step;
    const values = tiles.map((_, i) => start + i * step);
    if (values.some(n => n < 1 || n > 13) || tiles.some((t, i) => t.number && t.number !== values[i])) continue;
    return { points: values.reduce((a, b) => a + b, 0), jokers: Object.fromEntries(tiles.filter(t => !t.number).map(t => [t.id, { number: values[ids.indexOf(t.id)], colors: [real[0].color] }])) };
  }
  return null;
}
/** Current valid placement determines a joker's value; old values only help unfinished drafts. */
export function tableJokerBindings(group: number[], original: number[][]): Record<number, Binding> {
  const current = meld(group);
  if (current) return current.jokers;
  const bindings: Record<number, Binding> = {};
  for (const id of group.filter(id => id >= 104)) {
    const source = original.find(row => row.includes(id));
    if (source?.some(tileId => tileId < 104 && group.includes(tileId))) {
      const binding = meld(source)?.jokers[id];
      if (binding) bindings[id] = binding;
    }
  }
  return bindings;
}
/** Sort a run into ascending number order, including jokers' inferred slots. */
export function arrangeRun(ids: number[], preserve: Record<number, Binding> = {}): number[] {
  if (ids.length < 3 || ids.length > 13 || new Set(ids).size !== ids.length
      || ids.some(id => !Number.isInteger(id) || id < 0 || id > 105)) return [...ids];
  const real = ids.filter(id => id < 104).map(tile);
  const jokers = ids.filter(id => id >= 104);
  if (real.length < 2 || new Set(real.map(t => t.color)).size !== 1
      || new Set(real.map(t => t.number)).size !== real.length) return [...ids];
  const low = Math.min(...real.map(t => t.number)), high = Math.max(...real.map(t => t.number));
  // A valid displayed run already supplies the intended joker values. Preserve
  // them even for newly played hand jokers (their values affect opening points).
  const bindings = { ...(meld(ids)?.jokers ?? {}), ...preserve };
  for (let start = 1; start + ids.length - 1 <= 13; start++) {
    const end = start + ids.length - 1;
    if (start > low || end < high) continue;
    const slots = Array.from({ length: ids.length }, (_, i) => start + i);
    const byNumber = new Map(real.map(t => [t.number, t.id]));
    const missing = slots.filter(number => !byNumber.has(number));
    if (missing.length !== jokers.length) continue;
    let compatible = true;
    for (const id of jokers) {
      const binding = bindings[id];
      if (!binding) continue;
      if (!binding.colors.includes(real[0].color) || !missing.includes(binding.number) || byNumber.has(binding.number)) {
        compatible = false; break;
      }
      byNumber.set(binding.number, id);
    }
    if (!compatible) continue;
    const free = missing.filter(number => !byNumber.has(number));
    jokers.filter(id => !bindings[id]).forEach((id, i) => byNumber.set(free[i], id));
    return slots.map(number => byNumber.get(number)!);
  }
  // Keep the displayed value when possible, but a legal manipulation may
  // change a joker's role. Retry without stale draft bindings if necessary.
  return Object.keys(preserve).length ? arrangeRun(ids) : [...ids];
}
export interface State {
  hands: number[][]; pile: number[]; table: number[][]; opened: boolean[];
  turn: number; round: number; passes: number; winner: number | null; finished: boolean; scores: number[];
}
export function createGame(count: number, random: () => number = Math.random): State {
  if (!Number.isInteger(count) || count < 2 || count > 4) throw new Error("2~4명이 필요합니다.");
  const pile = Array.from({ length: 106 }, (_, i) => i);
  for (let i = 105; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]]; }
  return { hands: Array.from({ length: count }, () => pile.splice(0, 14)), pile, table: [], opened: Array(count).fill(false), turn: 0, round: 1, passes: 0, winner: null, finished: false, scores: [] };
}
export function checkDraft(state: State, table: unknown): asserts table is number[][] {
  if (!Array.isArray(table) || table.length > 106 || table.some(g => !Array.isArray(g) || !g.length || g.length > 106)) throw new Error("올바른 패 배치가 아닙니다.");
  const ids: unknown[] = table.flat(), original = state.table.flat(), allowed = new Set([...original, ...state.hands[state.turn]]);
  if (ids.length > 106 || new Set(ids).size !== ids.length || ids.some(id => !Number.isInteger(id) || !allowed.has(id as number))) throw new Error("중복되거나 사용할 수 없는 패입니다.");
  if (original.some(id => !ids.includes(id))) throw new Error("기존 테이블 패를 손패로 가져올 수 없습니다.");
  if (!state.opened[state.turn] && state.table.some(group => !table.some(g => g.length === group.length && g.every((id: number, i: number) => id === group[i])))) throw new Error("첫 등록 전에는 기존 조합을 바꿀 수 없습니다.");
}
export interface TurnIssues { message: string | null; groups: number[] }
export function turnIssues(state: State, table: number[][]): TurnIssues {
  try { checkDraft(state, table); } catch (e) { return { message: (e as Error).message, groups: [] }; }
  const evaluated = table.map(meld);
  const invalid = evaluated.flatMap((group, index) => group ? [] : [index]);
  if (invalid.length) return { message: "빨간 테두리의 조합을 같은 숫자·다른 색 3~4개 또는 같은 색 연속 숫자 3개 이상으로 맞춰주세요.", groups: invalid };
  const own = new Set(state.hands[state.turn]), played = table.flat().filter(id => own.has(id));
  if (!played.length) return { message: "패를 내지 않았다면 한 장 뽑기를 선택해주세요.", groups: [] };
  if (!state.opened[state.turn]) {
    const points = table.reduce((sum, group, i) => sum + (group.every(id => own.has(id)) ? evaluated[i]!.points : 0), 0);
    if (points < 30) return { message: `첫 등록은 자기 손패만으로 합계 30점 이상이어야 합니다. 현재 ${points}점입니다.`, groups: table.flatMap((group, index) => group.every(id => own.has(id)) ? [index] : []) };
  }
  // Official manipulation rules allow freeing a joker with rack/table tiles
  // or by splitting/rebuilding sets. Its old value is not a permanent binding.
  // checkDraft preserves every physical table tile (including each joker),
  // evaluated requires all final sets to be legal, and played requires a rack
  // tile this turn. Together these also enforce immediate table reuse.
  return { message: null, groups: [] };
}
export function validateTurn(state: State, table: number[][]): string | null { return turnIssues(state, table).message; }
function finish(state: State, winner: number | null) {
  state.finished = true; state.winner = winner;
  const penalties = state.hands.map(h => h.reduce((sum, id) => sum + (tile(id).number || 30), 0));
  state.scores = penalties.map(n => -n);
  if (winner !== null) state.scores[winner] = penalties.reduce((sum, n, i) => sum + (i === winner ? 0 : n), 0);
  else {
    const fewest = Math.min(...state.hands.map(hand => hand.length));
    state.hands.forEach((hand, seat) => { if (hand.length === fewest) state.scores[seat] = 0; });
  }
}
export function endTurn(state: State, table: number[][], draw = false): void {
  if (state.finished) throw new Error("종료된 경기입니다.");
  if (!draw) {
    const error = validateTurn(state, table); if (error) throw new Error(error);
    const used = new Set(table.flat()); state.hands[state.turn] = state.hands[state.turn].filter(id => !used.has(id));
    state.table = copyTable(table); state.opened[state.turn] = true; state.passes = 0;
    if (!state.hands[state.turn].length) { finish(state, state.turn); return; }
  } else {
    const id = state.pile.pop();
    if (id !== undefined) { state.hands[state.turn].push(id); state.passes = 0; }
    else if (++state.passes >= state.hands.length * 2) { finish(state, null); return; }
  }
  state.turn = (state.turn + 1) % state.hands.length; state.round++;
}

export interface View {
  type: "RUMMI_STATE"; matchId: string; revision: number; turnId: number; seat: number;
  seats: (Seat & { count: number; opened: boolean; connected: boolean })[];
  hand: number[]; table: number[][]; original: number[][]; turn: number; pileCount: number;
  deadline: number; serverNow: number; started: boolean; finished: boolean; winner: number | null; scores: number[];
  stalledTurns: number; stallLimit: number; endReason: "stalled" | "empty_hand" | null;
}
