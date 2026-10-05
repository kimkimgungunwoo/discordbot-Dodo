import { test } from "node:test";
import assert from "node:assert/strict";
import { botTurn } from "../../shared/rummikub-bot.js";
import { validateTurn, type State } from "../../shared/rummikub.js";

const id = (c: number, n: number, copy = 0) => c * 26 + copy * 13 + n - 1;
const run = (c: number, from: number, size: number) => Array.from({ length: size }, (_, i) => id(c, from + i));
const state = (hand: number[], table: number[][] = [], opened = true): State => ({ hands: [hand, [id(3, 13)]], table, pile: [], opened: [opened, false], turn: 0, round: 1, passes: 0, finished: false, winner: null, scores: [] });
function playsAll(game: State) {
  const before = structuredClone(game), plan = botTurn(game, "normal");
  assert.ok(plan, "medium bot should find a move"); assert.equal(validateTurn(game, plan), null);
  assert.ok(game.hands[0].every(id => plan.flat().includes(id)), "should use every hand tile in this tactic");
  assert.deepEqual(game, before); return plan;
}
test("hard repairs interacting melds on a busy board without changing state", () => {
  const game = state([id(0, 8), id(0, 9), id(1, 4, 1)], [
    [id(0, 7), id(1, 7), id(2, 7), id(3, 7)], run(1, 1, 6), run(2, 9, 3), run(3, 1, 3),
  ]);
  const before = structuredClone(game), plan = botTurn(game, "hard");
  assert.ok(plan); assert.equal(validateTurn(game, plan), null);
  assert.ok(game.hands[0].every(id => plan.flat().includes(id)));
  assert.deepEqual(game, before);
});
test("medium adds single tiles to runs and groups instead of drawing", () => {
  playsAll(state([id(0, 4)], [run(0, 1, 3)]));
  playsAll(state([id(3, 7)], [[id(0, 7), id(1, 7), id(2, 7)]]));
});
test("medium splits a run to place a duplicate interior number", () => {
  playsAll(state([id(0, 4, 1)], [run(0, 1, 6)]));
});
test("medium extracts a fourth group tile to build a new run", () => {
  playsAll(state([id(0, 8), id(0, 9)], [[id(0, 7), id(1, 7), id(2, 7), id(3, 7)]]));
});
test("medium replaces a table joker then uses it in a different meld", () => {
  playsAll(state([id(0, 11), id(1, 3), id(1, 4)], [[id(0, 10), 104, id(0, 12)]]));
});
test("medium finds nine-tile packing where a greedy long run leaves two tiles", () => {
  playsAll(state([...run(0, 2, 7), id(1, 5), id(2, 5)]));
});
test("medium handles both physical copies of the same complete run", () => {
  playsAll(state([...run(0, 9, 3), id(0, 9, 1), id(0, 10, 1), id(0, 11, 1)], [], false));
});
test("medium first registration finds combined 30 points but cannot use table tiles", () => {
  playsAll(state([...run(0, 4, 3), ...run(1, 4, 3)], [], false));
  assert.equal(botTurn(state([id(0, 4)], [run(0, 1, 3)], false), "normal"), null);
  assert.equal(botTurn(state(run(0, 1, 3), [], false), "normal"), null);
});
test("bot decisions don't read opponent hands or hidden pile order", () => {
  const first = state([id(0, 4, 1)], [run(0, 1, 6)]), second = structuredClone(first);
  second.hands[1] = [104, 105, id(2, 1)]; second.pile = [id(3, 5), id(2, 4)];
  assert.deepEqual(botTurn(first, "normal"), botTurn(second, "normal"));
});
