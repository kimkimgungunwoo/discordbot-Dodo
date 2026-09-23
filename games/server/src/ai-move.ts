import { Worker } from "node:worker_threads";
import { chooseMove, type BoardState, type Difficulty } from "../../shared/omok.js";

const OFFLOAD: ReadonlySet<Difficulty> = new Set(["extreme", "transcendent"]);
const WORKER_URL = new URL("./ai-worker.ts", import.meta.url);

export function computeCpuMove(state: BoardState, difficulty: Difficulty): Promise<number> {
  if (!OFFLOAD.has(difficulty)) return Promise.resolve(chooseMove(state, difficulty));
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: { state, difficulty } });
    worker.unref();
    worker.once("message", (move: number) => { void worker.terminate(); resolve(move); });
    worker.once("error", error => { void worker.terminate(); reject(error); });
  });
}
