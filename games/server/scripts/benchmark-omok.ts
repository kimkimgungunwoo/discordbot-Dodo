import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { place, type BoardState } from '../../shared/omok.js';
import { Worker } from 'node:worker_threads';
import { positions } from './omok-positions.js';

const budgetMs = Number(process.env.OMOK_BUDGET_MS ?? 11000);
const pairs = Number(process.env.OMOK_PAIRS ?? 50);
const suite = process.env.OMOK_SUITE ?? 'heldout';
const from = Number(process.env.OMOK_FROM ?? 0), to = Number(process.env.OMOK_TO ?? pairs);
const output = process.env.OMOK_OUTPUT;
if (suite !== 'train' && suite !== 'heldout') throw new Error('OMOK_SUITE must be train or heldout');
if (![budgetMs, pairs, from, to].every(Number.isInteger) || budgetMs < 1 || pairs < 1 || from < 0 || to > pairs || from >= to) throw new Error('Invalid benchmark bounds');
const sources = ['../../shared/omok.ts', '../../shared/renju.ts', '../../shared/omok-incremental.ts', '../../shared/omok-proof.ts', '../../shared/omok-patterns.ts', '../../shared/omok-opening.ts', '../tests/fixtures/omok-legacy.ts', './omok-positions.ts', './omok-benchmark-worker.ts', './benchmark-omok.ts'];
const sourceHash = () => {
  const hash = createHash('sha256');
  for (const path of sources) hash.update(path).update(readFileSync(new URL(path, import.meta.url)));
  return hash.digest('hex');
};
const revision = sourceHash();
const manifest = { type: 'manifest', revision, budgetMs, pairs, suite, from, to, freshWorker: true, workerOldSpaceMb: 128 };
const previous = output && existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
if (previous.length && JSON.stringify(previous[0]) !== JSON.stringify(manifest)) throw new Error('Resume rejected: source/config differs from recorded manifest');
const emit = (record: object) => { const line = JSON.stringify(record); if (output) appendFileSync(output, line + '\n'); console.log(line); };
if (!previous.length) emit(manifest);
const completed = new Set(previous.filter(row => row.type === 'game').map(row => `${row.pair}:${row.newColor}`));
function moveInWorker(state: BoardState, candidate: boolean): Promise<{ at: number; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./omok-benchmark-worker.ts', import.meta.url), {
      workerData: { state, candidate, budgetMs },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    });
    let settled = false;
    const finish = (result?: { at: number; elapsedMs: number }, error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      void worker.terminate().then(() => error ? reject(error) : resolve(result!), reject);
    };
    const timer = setTimeout(() => finish(undefined, new Error('Worker exceeded production response limit')), budgetMs + 3000);
    worker.once('message', result => finish(result));
    worker.once('error', error => finish(undefined, error));
    worker.once('exit', code => { if (!settled) finish(undefined, new Error('Worker exited without result: ' + code)); });
  });
}
const starts = positions(suite, pairs);
for (let pair = from; pair < to; pair++) for (const newColor of pair % 2 ? [2, 1] : [1, 2]) {
  if (completed.has(`${pair}:${newColor}`)) continue;
  if (sourceHash() !== revision) throw new Error('Sources changed during benchmark; refusing to mix revisions');
  let state = starts[pair];
  const started = performance.now(), times: { color: number; elapsedMs: number }[] = [];
  while (!state.winner && !state.draw) {
    if (sourceHash() !== revision) throw new Error('Sources changed before move');
    const color = state.turn;
    const { at, elapsedMs } = await moveInWorker(state, color === newColor);
    if (sourceHash() !== revision) throw new Error('Sources changed during move');
    times.push({ color, elapsedMs });
    state = place(state, at); // Real server legality/win/draw rules. Illegal move aborts the experiment.
    if (state.moves.length % 10 === 0) console.error(JSON.stringify({ type: 'progress', pair, newColor, ply: state.moves.length }));
  }
  emit({ type: 'game', revision, pair, newColor, winner: state.winner, draw: state.draw,
    opening: starts[pair].moves, moves: state.moves, times, elapsedMs: Math.round(performance.now() - started) });
}
