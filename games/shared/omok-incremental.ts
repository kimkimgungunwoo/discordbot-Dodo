import type { Stone } from './omok.js';

const SIZE = 15;
const AXES = [[1, 0], [0, 1], [1, 1], [1, -1]];
export const WIN_SCORE = 10_000_000;
interface AxisValue { score: number; four: number; three: number; win: boolean }
const lineTable = new Map<number, readonly [AxisValue, AxisValue]>();
const shifts = Array.from({ length: 11 }, (_, i) => 2 ** (i * 2));
const cell = (x: number, y: number) => x < 0 || y < 0 || x >= SIZE || y >= SIZE ? -1 : y * SIZE + x;
const lines = Array.from({ length: 225 }, (_, at) => AXES.map(([dx, dy]) =>
  Array.from({ length: 11 }, (_, i) => cell(at % SIZE + dx * (i - 5), Math.floor(at / SIZE) + dy * (i - 5)))));
const affected = Array.from({ length: 225 }, () => [] as { slot: number; shift: number }[]);
const neighbors = Array.from({ length: 225 }, (_, at) => {
  const result: number[] = [];
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const next = cell(at % SIZE + x, Math.floor(at / SIZE) + y);
    if (next >= 0) result.push(next);
  }
  return result;
});
for (let at = 0; at < 225; at++) for (let axis = 0; axis < 4; axis++) {
  lines[at][axis].forEach((next, offset) => {
    if (next >= 0 && next !== at) affected[next].push({ slot: at * 4 + axis, shift: shifts[offset] });
  });
}

// The table preserves the baseline's geometric evaluation. Renju legality is
// deliberately NOT cached here: a continuation can depend on crossing lines.
function readAxis(code: number): readonly [AxisValue, AxisValue] {
  const cached = lineTable.get(code);
  if (cached) return cached;
  const cells = shifts.map(shift => Math.floor(code / shift) % 4);
  const evaluate = (stone: 1 | 2): AxisValue => {
    cells[5] = stone;
    let run = 1;
    for (const sign of [-1, 1]) for (let n = 1; n <= 5 && cells[5 + n * sign] === stone; n++) run++;
    if (run === 5 || (stone === 2 && run > 5)) return { score: WIN_SCORE, four: 0, three: 0, win: true };
    let score = 0, completions = 0;
    for (let start = 1; start <= 5; start++) {
      let count = 0, empty = -1, blocked = false;
      for (let i = start; i < start + 5; i++) {
        if (cells[i] && cells[i] !== stone) { blocked = true; break; }
        if (cells[i] === stone) count++; else empty = i;
      }
      if (blocked) continue;
      const base = [0, 2, 30, 500, 15000, WIN_SCORE][count];
      const open = Number(cells[start - 1] === 0) + Number(cells[start + 5] === 0);
      score = Math.max(score, count === 5 ? base : base * (1 + open * .4));
      if (count === 4 && (stone === 2 || (cells[start - 1] !== stone && cells[start + 5] !== stone))) completions |= 1 << empty;
    }
    if (completions) return { score: Math.max(score, (completions & (completions - 1)) ? 1000000 : 30000), four: 1, three: 0, win: false };
    const text = cells.map(s => s === stone ? 'X' : s === 0 ? '.' : '#').join('');
    const three = ['.XXX.', '.XX.X.', '.X.XX.'].some(pattern => {
      for (let start = 0; start + pattern.length <= 11; start++) {
        if (start < 5 && start + pattern.length - 1 > 5 && text.slice(start, start + pattern.length) === pattern) return true;
      }
      return false;
    });
    return { score: Math.max(score, three ? 8000 : 0), four: 0, three: Number(three), win: false };
  };
  const result = [evaluate(1), evaluate(2)] as const;
  if (lineTable.size >= 32768) lineTable.clear();
  lineTable.set(code, result);
  return result;
}

export class IncrementalThreats {
  private codes = new Uint32Array(900);
  private nearby = new Uint8Array(225);
  private dirty = new Uint8Array(225).fill(1);
  private black = new Float64Array(225);
  private white = new Float64Array(225);
  public evaluations = 0;
  constructor(private board: Stone[]) {
    for (let at = 0; at < 225; at++) for (let axis = 0; axis < 4; axis++) {
      let code = 0;
      lines[at][axis].forEach((next, i) => { if (i !== 5) code += (next < 0 ? 3 : board[next]) * shifts[i]; });
      this.codes[at * 4 + axis] = code;
    }
    board.forEach((stone, at) => { if (stone) for (const next of neighbors[at]) this.nearby[next]++; });
  }
  /** Must be called after the board changes from `before` to `after`. */
  update(at: number, before: Stone, after: Stone) {
    const delta = after - before;
    for (const { slot, shift } of affected[at]) {
      this.codes[slot] += delta * shift;
      this.dirty[slot >> 2] = 1;
    }
    const occupiedDelta = Number(after !== 0) - Number(before !== 0);
    for (const next of neighbors[at]) this.nearby[next] += occupiedDelta;
    this.dirty[at] = 1;
  }
  candidates(): number[] {
    const result: number[] = [];
    for (let at = 0; at < 225; at++) if (!this.board[at] && this.nearby[at]) result.push(at);
    return result.length ? result : this.board.every(s => !s) ? [112] : [];
  }
  scores(at: number): readonly [number, number] {
    if (this.dirty[at]) {
      let black = 0, white = 0, bf = 0, wf = 0, bt = 0, wt = 0, bw = false, ww = false;
      for (let axis = 0; axis < 4; axis++) {
        const [b, w] = readAxis(this.codes[at * 4 + axis]);
        black += b.score; white += w.score; bf += b.four; wf += w.four; bt += b.three; wt += w.three;
        bw ||= b.win; ww ||= w.win;
      }
      const forks = (f: number, t: number) => (f > 1 ? 600000 : 0) + (f && t ? 120000 : 0) + (t > 1 ? 80000 : 0);
      this.black[at] = bw ? WIN_SCORE : black + forks(bf, bt);
      this.white[at] = ww ? WIN_SCORE : white + forks(wf, wt);
      this.dirty[at] = 0; this.evaluations++;
    }
    return [this.black[at], this.white[at]];
  }
}
