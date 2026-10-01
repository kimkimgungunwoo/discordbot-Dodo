import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard, place, isLegalMove } from '../../shared/omok.js';
import { computeCpuMove } from '../src/ai-move.js';

test('transcendent survives a full production search in the 128 MB worker', async () => {
  let state = freshBoard();
  for (const at of [112,97,113,98]) state = place(state, at);
  const before = JSON.stringify(state), begin = performance.now();
  const at = await computeCpuMove(state, 'transcendent');
  assert.ok(isLegalMove(state.board, at, state.turn));
  assert.equal(JSON.stringify(state), before);
  assert.ok(performance.now() - begin < 15000);
});
