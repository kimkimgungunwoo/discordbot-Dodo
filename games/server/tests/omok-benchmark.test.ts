import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positions } from '../scripts/omok-positions.js';
import { freshBoard, place } from '../../shared/omok.js';

test('training and heldout openings are deterministic, disjoint and legal', () => {
  const train = positions('train', 8), heldout = positions('heldout', 50);
  const keys = new Set(train.map(s => s.board.join('')));
  assert.equal(heldout.length, 50);
  for (const state of heldout) {
    assert.ok(!keys.has(state.board.join('')));
    keys.add(state.board.join(''));
    let replay = freshBoard();
    for (const at of state.moves) replay = place(replay, at);
    assert.deepEqual(replay, state);
    assert.equal(state.winner, 0); assert.equal(state.draw, false);
  }
  assert.deepEqual(positions('train', 8), train);
});
