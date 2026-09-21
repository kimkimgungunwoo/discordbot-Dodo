// Manual deterministic balance/performance probe: node tests/ai-benchmark.mjs
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const dir = mkdtempSync(join(tmpdir(), 'dodo-balance-'));
try {
  for (const name of ['constants', 'types', 'physics', 'ai']) {
    const source = readFileSync(new URL('../src/game/' + name + '.ts', import.meta.url), 'utf8');
    writeFileSync(join(dir, name + '.js'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  const require = createRequire(import.meta.url);
  const { createInitialState, step } = require(join(dir, 'physics.js'));
  const { computeAiInput } = require(join(dir, 'ai.js'));
  for (const difficulty of ['easy', 'normal', 'hard', 'extreme']) {
    let wins = 0, points = 0, against = 0, totalTicks = 0, unfinished = 0;
    const start = performance.now();
    for (let seed = 0; seed < 4; seed++) {
      let state = createInitialState(seed);
      const side = seed < 2 ? 'right' : 'left';
      while (state.phase !== 'gameover' && state.tick < 12000) {
        state = step(state, computeAiInput(state, state.left, side === 'left' ? difficulty : 'normal'), computeAiInput(state, state.right, side === 'right' ? difficulty : 'normal'));
      }
      wins += state.winner === side;
      points += state[side].score;
      against += state[side === 'right' ? 'left' : 'right'].score;
      unfinished += state.phase !== 'gameover';
      totalTicks += state.tick;
    }
    console.log({ difficulty, wins, points, against, unfinished, totalTicks, msPerTick: (performance.now() - start) / totalTicks });
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
