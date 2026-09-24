import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
const dir = mkdtempSync(join(tmpdir(), 'omok-fuzz-'));
for (const name of ['omok', 'renju']) {
  const source = readFileSync(`/Users/gunwoo/programming/discordbot/games/server/../shared/${name}.ts`, 'utf8');
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const require = createRequire(import.meta.url);
const { freshBoard, place, chooseMove, forbiddenMove, isLegalMove } = require(join(dir, 'omok.js'));

function mkRandom(seed) { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) >>> 0; return s / 0xffffffff; }; }

let violations = 0, games = 0, blackMoves = 0;
const DIFFS = ['easy', 'normal', 'hard', 'extreme'];
for (let seed = 1; seed <= 200; seed++) {
  const rnd = mkRandom(seed);
  const blackDiff = DIFFS[seed % DIFFS.length];
  const whiteDiff = DIFFS[(seed + 1) % DIFFS.length];
  let state = freshBoard();
  games++;
  let n = 0;
  while (!state.winner && !state.draw && n < 225) {
    const diff = state.turn === 1 ? blackDiff : whiteDiff;
    let move;
    try { move = chooseMove(state, diff, rnd); }
    catch (e) { break; }
    if (state.turn === 1) {
      blackMoves++;
      // 직접 forbiddenMove로 재검증 -- chooseMove가 낸 수가 실제로 금수인지 독립적으로 확인.
      const check = forbiddenMove(state.board, move);
      if (check) {
        violations++;
        console.log('VIOLATION: seed', seed, 'diff', diff, 'move', move, 'forbidden as', check, 'moveNumber', n);
      }
    }
    try { state = place(state, move); }
    catch (e) {
      console.log('PLACE THREW for AI-selected move: seed', seed, 'diff', diff, 'move', move, 'turn', state.turn, 'error:', e.message);
      violations++;
      break;
    }
    n++;
  }
}
console.log('games:', games, 'black moves checked:', blackMoves, 'violations:', violations);
