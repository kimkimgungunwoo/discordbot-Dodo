import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { AiQueue } from './ai-queue.js';
import { AI_RESPONSE_LIMIT_MS, validShot, type State, type Shot, type Difficulty } from '../../shared/alkkagi.js';
const queue = new AiQueue<Shot>(Math.max(1,Math.min(2,availableParallelism()-1)),AI_RESPONSE_LIMIT_MS);
export function computeShot(state: State, difficulty: Difficulty, signal: AbortSignal): Promise<Shot> {
  return queue.run((remainingMs, active) => new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./alkkagi-ai-worker.ts',import.meta.url), {workerData:{state,difficulty,budgetMs:Math.max(1,remainingMs-500)},resourceLimits:{maxOldGenerationSizeMb:128}});
    worker.unref(); let settled = false, best: Shot | undefined;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); active.removeEventListener('abort',abort);
      void worker.terminate().then(() => error ? reject(error) : resolve(best!),reject);
    };
    const abort = () => finish(new Error('AI 계산 취소'));
    const timer = setTimeout(() => finish(best ? undefined : new Error('AI 계산 시간 초과')),remainingMs); timer.unref();
    worker.on('message',(message) => {
      if (!validShot(state,message.shot)) { finish(new Error('AI 발사 검증 실패')); return; }
      best = message.shot; if (message.type === 'result') finish();
    });
    worker.once('error',error => finish(error)); worker.once('exit',() => { if (!settled) finish(new Error('AI 계산 중단')); });
    active.addEventListener('abort',abort,{once:true}); if (active.aborted) abort();
  }),signal);
}
