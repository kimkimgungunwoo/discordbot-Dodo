import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard, type Stone } from '../../shared/omok.js';
import { IncrementalThreats } from '../../shared/omok-incremental.js';
import { legacyThreat } from './fixtures/omok-legacy.js';

test('incremental evaluation equals baseline after random moves and complete undo', () => {
  const { board } = freshBoard(), engine = new IncrementalThreats(board);
  let seed = 71933;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const history: { at: number; stone: Stone }[] = [];
  function verify() {
    const before = [...board];
    for (let at = 0; at < 225; at++) if (!board[at]) {
      assert.deepEqual(engine.scores(at), [legacyThreat(board, at, 1, true, true), legacyThreat(board, at, 2, true, true)], `cell ${at}, ply ${history.length}`);
    }
    assert.deepEqual(board, before);
  }
  verify();
  for (let i = 0; i < 100; i++) {
    let at: number; do { at = Math.floor(random() * 225); } while (board[at]);
    const stone = (i % 2 + 1) as 1 | 2;
    board[at] = stone; engine.update(at, 0, stone); history.push({ at, stone });
    if (i % 5 === 0) verify();
  }
  while (history.length) {
    const { at, stone } = history.pop()!;
    board[at] = 0; engine.update(at, stone, 0);
    if (history.length % 5 === 0) verify();
  }
  assert.deepEqual(engine.candidates(), [112]);
});

test('low geometric scores cannot hide a forbidden black move', async () => {
  const { isLegalMove } = await import('../../shared/omok.js');
  let seed = 97129;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let sample = 0; sample < 100; sample++) {
    const { board } = freshBoard();
    for (let i = 0; i < 80; i++) board[Math.floor(random() * 225)] = random() < .65 ? 1 : 2;
    const engine = new IncrementalThreats(board);
    for (let at = 0; at < 225; at++) if (!board[at] && engine.scores(at)[0] < 8000) {
      assert.ok(isLegalMove(board, at, 1), `sample ${sample}, cell ${at}`);
    }
  }
});

test('black overlines and exact fives retain baseline geometry at borders', () => {
  for (const stones of [[105,106,107,108,110], [105,106,107,108], [0,1,2,3,5]]) {
    const { board } = freshBoard(); stones.forEach(at => board[at] = 1);
    const engine = new IncrementalThreats(board);
    for (let at = 0; at < 225; at++) if (!board[at]) assert.deepEqual(engine.scores(at),
      [legacyThreat(board, at, 1, true, true), legacyThreat(board, at, 2, true, true)]);
  }
});
