import { readFileSync } from 'node:fs';
const rows = process.argv.slice(2).flatMap(path => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
const manifests = rows.filter(row => row.type === 'manifest');
if (!manifests.length) throw new Error('No manifest');
const first = manifests[0];
if (manifests.some(m => ['revision', 'budgetMs', 'pairs', 'suite', 'freshWorker', 'workerOldSpaceMb'].some(key => m[key] !== first[key]))) throw new Error('Different benchmark revisions/settings');
const games = rows.filter(row => row.type === 'game'), seen = new Set<string>(), pairs = new Map<number, number[]>();
let wins = 0, losses = 0, draws = 0;
for (const game of games) {
  const key = `${game.pair}:${game.newColor}`;
  if (seen.has(key)) throw new Error('Duplicate game: ' + key);
  seen.add(key);
  const score = game.draw ? .5 : game.winner === game.newColor ? 1 : 0;
  if (score === 1) wins++; else if (score === 0) losses++; else draws++;
  if (!pairs.has(game.pair)) pairs.set(game.pair, []);
  pairs.get(game.pair)!.push(score);
}
const completePairs = [...pairs.values()].filter(scores => scores.length === 2).map(scores => (scores[0] + scores[1]) / 2);
let seed = 37213;
const samples: number[] = [];
for (let i = 0; i < 20000 && completePairs.length; i++) {
  let sum = 0;
  for (let j = 0; j < completePairs.length; j++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    sum += completePairs[Math.floor(seed / 2 ** 32 * completePairs.length)];
  }
  samples.push(sum / completePairs.length);
}
samples.sort((a, b) => a - b);
const interval = samples.length ? [samples[500], samples[19499]] : null;
console.log(JSON.stringify({ revision: first.revision, suite: first.suite, budgetMs: first.budgetMs,
  games: games.length, completePairs: completePairs.length, wins, losses, draws,
  scoreRate: games.length ? (wins + draws * .5) / games.length : null, pairedBootstrap95: interval,
  strengthGatePassed: first.freshWorker === true && first.workerOldSpaceMb === 128 && first.suite === 'heldout' && first.budgetMs === 11000 && completePairs.length >= 50 && interval !== null && interval[0] > .5 }, null, 2));
