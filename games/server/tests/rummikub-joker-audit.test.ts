import { test } from "node:test";
import assert from "node:assert/strict";
import { arrangeRun, meld, validateTurn, tableJokerBindings, type State } from "../../shared/rummikub.js";

const id = (color: number, n: number, copy = 0) => color * 26 + copy * 13 + n - 1;
test("a replaced joker displays its new value, with fallback only for unfinished melds", () => {
  const original = [[id(0, 5), id(0, 6), 104]];
  const changed = [id(0, 5), id(0, 6), id(0, 7), 104];
  assert.equal(validateTurn(state([id(0, 7)], original), [changed]), null);
  assert.equal(tableJokerBindings(changed, original)[104].number, 8);
  assert.equal(tableJokerBindings([...original[0], id(0, 3)], original)[104].number, 7);
  assert.deepEqual(arrangeRun([...changed].reverse(), tableJokerBindings(changed, original)), changed);
});
function state(hand: number[], table: number[][]): State {
  return { hands: [hand, [id(3, 13)]], table, pile: [], opened: [true, false], turn: 0,
    round: 1, passes: 0, finished: false, winner: null, scores: [] };
}

test("two jokers may be recovered through legal splitting without exact hand replacements", () => {
  const old = [[id(0, 10), 104, id(0, 12)], [id(0, 10, 1), 105, id(0, 12, 1)]];
  const hand = [id(0, 11), id(1, 10), id(2, 10), id(1, 12), id(2, 12),
    id(1, 3), id(1, 4), id(2, 3), id(2, 4)];
  const target = [[id(0, 10), id(0, 11), id(0, 12)],
    [id(0, 10, 1), id(1, 10), id(2, 10)], [id(0, 12, 1), id(1, 12), id(2, 12)],
    [id(1, 3), id(1, 4), 104], [id(2, 3), id(2, 4), 105]];
  assert.ok(target.every(group => meld(group)));
  assert.equal(validateTurn(state(hand, old), target), null);
  const both = [target[0], [id(0, 10, 1), id(0, 11, 1), id(0, 12, 1)], ...target.slice(3)];
  assert.equal(validateTurn(state([...hand, id(0, 11, 1)], old), both), null);
});

test("sorting reversed two-joker runs preserves each physical joker's slot", () => {
  const original = [id(0, 10), 104, 105, id(0, 13)];
  assert.deepEqual(arrangeRun([...original].reverse(), meld(original)!.jokers), original);
});

test("sorting a valid endpoint joker keeps the displayed value and opening points", () => {
  const original = [id(0, 9), id(0, 10), 104];
  assert.equal(meld(original)!.points, 30);
  assert.deepEqual(arrangeRun(original), original);
});
