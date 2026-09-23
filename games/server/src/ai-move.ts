import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { AI_RESPONSE_LIMIT_MS, TRANSCENDENT_BUDGET_MS, chooseMove, isLegalMove, type BoardState, type Difficulty } from "../../shared/omok.js";
import { AiQueue } from "./ai-queue.js";

const OFFLOAD: ReadonlySet<Difficulty> = new Set(["extreme", "transcendent"]);
const WORKER_URL = new URL("./ai-worker.ts", import.meta.url);
const queue = new AiQueue<number>(Math.max(1, Math.min(2, availableParallelism() - 1)), AI_RESPONSE_LIMIT_MS);

export function computeCpuMove(state: BoardState, difficulty: Difficulty, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (!OFFLOAD.has(difficulty)) return Promise.resolve(chooseMove(state, difficulty));
  return queue.run((remainingMs, activeSignal) => new Promise((resolve, reject) => {
    const budgetMs = Math.max(1, Math.min(TRANSCENDENT_BUDGET_MS, remainingMs - 750));
    const worker = new Worker(WORKER_URL, { workerData: { state, difficulty, budgetMs },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } });
    worker.unref();
    let settled = false;
    let best: number | undefined;
    const finish = (move?: number, error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); activeSignal.removeEventListener("abort", abort);
      void worker.terminate().then(() => { if (error) reject(error); else resolve(move!); }, reject);
    };
    const abort = () => finish(undefined, new Error("AI 계산 취소"));
    const timer = setTimeout(() => best === undefined ? finish(undefined, new Error("AI 계산 시간 초과")) : finish(best), remainingMs);
    timer.unref();
    worker.on("message", (message: { type: "progress" | "result"; move: number }) => {
      if (settled) return;
      if (!isLegalMove(state.board, message.move, state.turn)) { finish(undefined, new Error("AI 착수 검증 실패")); return; }
      best = message.move;
      if (message.type === "result") finish(best);
    });
    worker.once("error", error => finish(undefined, error));
    worker.once("exit", () => { if (!settled) finish(undefined, new Error("AI 계산이 중단되었습니다.")); });
    activeSignal.addEventListener("abort", abort, { once: true });
    if (activeSignal.aborted) abort();
  }), signal);
}
