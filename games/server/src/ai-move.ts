import { Worker } from "node:worker_threads";
import { chooseMove, type BoardState, type Difficulty } from "../../shared/omok.js";

// 극한/초월은 시간 예산이 커서(최대 0.5~2초) 메인 스레드에서 그대로 돌리면 그동안 서버가 이 방뿐
// 아니라 다른 모든 방·HTTP 요청까지 멈춘다 — 워커 스레드로 빼서 이벤트 루프를 막지 않게 한다.
// 나머지 난이도는 몇 ms면 끝나서 워커 기동 비용(수십 ms)이 오히려 손해라 메인 스레드에서 그냥 돈다.
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
