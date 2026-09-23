import { parentPort, workerData } from "node:worker_threads";
import { chooseMove, type BoardState, type Difficulty } from "../../shared/omok.js";

const { state, difficulty } = workerData as { state: BoardState; difficulty: Difficulty };
parentPort!.postMessage(chooseMove(state, difficulty));
