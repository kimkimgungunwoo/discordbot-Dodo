import { parentPort, workerData } from "node:worker_threads";
import { chooseMove, type BoardState, type Difficulty } from "../../shared/omok.js";

const { state, difficulty, budgetMs } = workerData as { state: BoardState; difficulty: Difficulty; budgetMs: number };
const move = chooseMove(state, difficulty, Math.random, {
  budgetMs,
  onProgress: move => parentPort!.postMessage({ type: "progress", move }),
});
parentPort!.postMessage({ type: "result", move });
