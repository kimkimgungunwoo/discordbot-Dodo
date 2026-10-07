import { parentPort, workerData } from 'node:worker_threads';
import { chooseShot } from '../../shared/alkkagi.js';
const shot = chooseShot(workerData.state, workerData.difficulty, Math.random, {
  budgetMs: workerData.budgetMs,
  onProgress: shot => parentPort!.postMessage({ type: 'progress', shot }),
});
parentPort!.postMessage({ type: 'result', shot });
