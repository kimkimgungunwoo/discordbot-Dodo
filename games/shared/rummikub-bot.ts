import { copyTable, meld, tile, validateTurn, type State } from "./rummikub.js";

const bits = Array.from({ length: 106 }, (_, id) => 1n << BigInt(id));
const values = bits.map((_, id) => tile(id));
const maskOf = (ids: number[]) => ids.reduce((mask, id) => mask | bits[id], 0n);
interface Candidate { ids: number[]; mask: bigint; utility: number; points: number }

/** Only public table + own hand are searched. Never samples opponents or pile. */
export function botTurn(state: State, difficulty: "normal" | "hard"): number[][] | null {
  const started = performance.now(), budget = difficulty === "hard" ? 160 : 55;
  const hand = state.hands[state.turn], opened = state.opened[state.turn];
  const required = opened ? state.table.flat() : [], pool = [...required, ...hand];
  const own = new Set(hand), mandatory = maskOf(required), all = maskOf(pool);
  const weight = (id: number) => own.has(id) ? 1000 + (values[id].number || 30) : 0;
  const maxUtility = hand.reduce((sum, id) => sum + weight(id), 0);
  const buckets = Array.from({ length: 52 }, () => [] as number[]);
  for (const id of pool) if (id < 104) buckets[values[id].color * 13 + values[id].number - 1].push(id);
  const jokers = pool.filter(id => id >= 104), candidates: Candidate[] = [], seen = new Set<bigint>();
  const add = (ids: number[]) => {
    const mask = maskOf(ids); if (seen.has(mask)) return;
    const evaluation = meld(ids); if (!evaluation) return;
    seen.add(mask); candidates.push({ ids: [...ids], mask, utility: ids.reduce((s, id) => s + weight(id), 0), points: evaluation.points });
  };
  const combinations = (choices: number[][], index = 0, chosen: number[] = [], used = 0n) => {
    if (index === choices.length) { add(chosen); return; }
    for (const id of choices[index]) if (!(used & bits[id])) combinations(choices, index + 1, [...chosen, id], used | bits[id]);
  };
  // Enumerate physical copies and joker alternatives, not just the first copy.
  for (let n = 1; n <= 13; n++) for (let colors = 1; colors < 16; colors++) {
    const selected = [0, 1, 2, 3].filter(c => colors & 1 << c);
    if (selected.length < 3) continue;
    combinations(selected.map(c => [...buckets[c * 13 + n - 1], ...jokers]));
  }
  // Every longer run can be partitioned into lengths 3..5. Existing long melds
  // are also preserved below, including their joker replacement alternatives.
  for (let c = 0; c < 4; c++) for (let size = 3; size <= 5; size++) for (let start = 1; start + size <= 14; start++) {
    combinations(Array.from({ length: size }, (_, i) => [...buckets[c * 13 + start + i - 1], ...jokers]));
  }
  if (opened) for (const group of state.table) {
    const bindings = meld(group)!.jokers;
    combinations(group.map(id => id < 104 ? [id] : [id, ...pool.filter(replacement => {
      const v = values[replacement], binding = bindings[id];
      return v.number === binding.number && binding.colors.includes(v.color);
    })]));
  }
  candidates.sort((a, b) => b.utility - a.utility || b.ids.length - a.ids.length);
  let best: number[][] | null = null, bestUtility = 0, bestPotential = -1;
  const consider = (table: number[][]) => {
    const used = new Set(table.flat());
    const utility = [...used].reduce((sum, id) => sum + weight(id), 0);
    if (utility < bestUtility || (difficulty === "normal" && utility === bestUtility)) return;
    // Among equally productive moves prefer remaining tiles with run/group
    // partners. This uses only our hand, never the hidden opponents' tiles.
    const left = hand.filter(id => !used.has(id));
    const potential = left.reduce((sum, id, i) => sum + left.slice(i + 1).reduce((n, other) => {
      const a = values[id], b = values[other];
      return n + (id >= 104 || other >= 104 ? 3 : a.number === b.number && a.color !== b.color ? 2 : a.color === b.color && Math.abs(a.number - b.number) >= 1 && Math.abs(a.number - b.number) <= 2 ? 1 : 0);
    }, 0), 0);
    if ((utility === bestUtility && potential <= bestPotential) || validateTurn(state, table)) return;
    best = copyTable(table); bestUtility = utility; bestPotential = potential;
  };
  const handCandidates = candidates.filter(c => !(c.mask & mandatory));
  // Cheap, guaranteed legal fallbacks before rearrangement search. Try both
  // extending first and making own melds first so the two choices can compete.
  for (const extendFirst of [true, false]) {
    const draft = copyTable(state.table), used = new Set<number>();
    const extend = () => {
      if (!opened) return;
      for (const id of [...hand].sort((a, b) => weight(b) - weight(a))) if (!used.has(id)) {
        let placed = false;
        for (let i = 0; i < draft.length && !placed; i++) for (let at = 0; at <= draft[i].length; at++) {
          const group = [...draft[i]]; group.splice(at, 0, id);
          if (!meld(group)) continue;
          const next = [...draft]; next[i] = group;
          if (!validateTurn(state, next)) { draft[i] = group; used.add(id); placed = true; break; }
        }
      }
    };
    if (extendFirst) extend();
    for (const c of handCandidates) if (c.ids.every(id => !used.has(id))) { draft.push(c.ids); c.ids.forEach(id => used.add(id)); }
    extend(); consider(draft);
  }
  if (bestUtility === maxUtility) return best;

  const byTile = Array.from({ length: 106 }, () => [] as Candidate[]);
  for (const c of candidates) for (const id of c.ids) byTile[id].push(c);
  let nodes = 0, deadline = started + budget;
  const nodeLimit = difficulty === "hard" ? 24000 : 7000;
  const search = (available: bigint, missing: bigint, groups: number[][], utility: number, openingPoints: number, possible: number) => {
    if (++nodes > nodeLimit || (nodes % 32 === 0 && performance.now() > deadline) || bestUtility === maxUtility) return;
    if (utility + possible < bestUtility || (difficulty === "normal" && utility + possible === bestUtility)) return;
    if (!missing && (opened || openingPoints >= 30)) consider(opened ? groups : [...state.table, ...groups]);
    if (bestUtility === maxUtility) return;
    let pivot = -1, choices: Candidate[] = [], smallest = Infinity;
    // Cover every old table tile; hand tiles are optional. Branch on the most
    // constrained tile to avoid blindly enumerating permutations of all melds.
    const needed = missing || available;
    for (const id of pool) if (needed & bits[id]) {
      const options = byTile[id].filter(c => (c.mask & available) === c.mask);
      if (options.length < smallest) { pivot = id; choices = options; smallest = options.length; if (!smallest) break; }
    }
    if (pivot < 0 || (missing && !choices.length)) return;
    for (const c of choices) {
      search(available & ~c.mask, missing & ~c.mask, [...groups, c.ids], utility + c.utility, openingPoints + c.points, possible - c.utility);
      if (nodes > nodeLimit || bestUtility === maxUtility || performance.now() > deadline) return;
    }
    if (!missing) search(available & ~bits[pivot], 0n, groups, utility, openingPoints, possible - weight(pivot));
  };
  // Hard: solve small interacting table neighborhoods first. Fixed unrelated
  // melds need no branching, leaving time for multi-meld repairs on busy boards.
  // Validate the entire resulting table, including joker recovery, every time.
  if (difficulty === "hard" && opened && state.table.length > 1) {
    const rowMasks = state.table.map(maskOf), handMask = maskOf(hand);
    const relevant = rowMasks.map((mask, index) => ({ index, value: candidates.reduce((n, c) => n + ((c.mask & mask) && c.utility ? c.utility : 0), 0) }))
      .sort((a, b) => b.value - a.value).slice(0, 6).map(row => row.index);
    deadline = started + budget * 0.45;
    for (let a = 0; a < relevant.length && performance.now() < deadline; a++) {
      for (let b = a + 1; b < relevant.length && performance.now() < deadline; b++) {
        const selected = new Set([relevant[a], relevant[b]]);
        const missing = rowMasks[relevant[a]] | rowMasks[relevant[b]];
        nodes = 0;
        search(missing | handMask, missing, state.table.filter((_, i) => !selected.has(i)), 0, 0, maxUtility);
        if (bestUtility === maxUtility) return best;
      }
    }
    nodes = 0; deadline = started + budget;
  }
  if (performance.now() < deadline) search(all, mandatory, [], 0, 0, maxUtility);
  return best;
}
