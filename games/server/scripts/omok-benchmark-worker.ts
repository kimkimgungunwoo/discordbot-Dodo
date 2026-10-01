import { parentPort, workerData } from 'node:worker_threads';
import { chooseMove } from '../../shared/omok.js';
import { chooseMove as legacy } from '../tests/fixtures/omok-legacy.js';
const { state, candidate, budgetMs } = workerData;
const started = performance.now();
const at = (candidate ? chooseMove : legacy)(state, 'transcendent', () => .5, { budgetMs });
parentPort!.postMessage({ at, elapsedMs: Math.round(performance.now() - started) });
