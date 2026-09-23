// ai-move.ts가 극한/초월처럼 오래 걸리는 계산에 대해서만 이 워커를 띄운다.
// 한 번 계산하고 결과를 보낸 뒤 끝나는 일회성 워커라 별도의 메시지 루프가 없다.
import { parentPort, workerData } from "node:worker_threads";
import { chooseMove, type BoardState, type Difficulty } from "../../shared/omok.js";

const { state, difficulty } = workerData as { state: BoardState; difficulty: Difficulty };
parentPort!.postMessage(chooseMove(state, difficulty));
