import { writeFileSync } from "node:fs";
import { applyAction, autoAction, createGame } from "../../shared/augment-marble.js";
const samples = Number(process.env.MARBLE_SAMPLES ?? 400);
const rows: unknown[] = [];
for (const augments of [false, true]) for (const count of [2, 3, 4]) {
  const laps: number[] = [], turns: number[] = [], wins: Record<string, number> = {}, seats = Array(count).fill(0), acquired: number[] = [];
  let unfinished = 0, actions = 0;
  for (let seed = 1; seed <= samples; seed++) {
    let state = seed; const rng = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    const g = createGame(Array.from({ length: count }, (_, i) => String(i)), { ...(augments ? {} : { catalog: [] }), random: rng });
    let steps = 0;
    while (g.phase !== "finished" && steps++ < 12000) {
      applyAction(g, autoAction(g, true), rng);
      if (!g.players.every(p => Number.isSafeInteger(p.cash) && p.cash >= 0)) throw new Error(`Invalid cash: ${augments}/${count}/${seed}/${steps}`);
      if (!g.properties.every(p => p.owner === null || !g.players[p.owner].bankrupt)) throw new Error("Bankrupt owner");
    }
    actions += steps;
    if (g.phase !== "finished") { unfinished++; continue; }
    seats[g.winner!]++; wins[g.reason!] = (wins[g.reason!] ?? 0) + 1;
    laps.push(Math.max(...g.players.map(p => p.laps))); turns.push(g.turnId); acquired.push(Math.min(...(g.augments?.players.map(p => p.acquired) ?? [0])));
  }
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? null;
  const row = { augments, players: count, samples, unfinished, medianMaxLaps: median(laps), medianTurns: median(turns), medianMinAcquired: median(acquired), wins, seatWins: seats, actions };
  rows.push(row); console.log(JSON.stringify(row));
}
if (process.env.MARBLE_REPORT) writeFileSync(process.env.MARBLE_REPORT, JSON.stringify({ salary: 100, startCash: 300, samplesPerGroup: samples, rows }, null, 2) + "\n");
