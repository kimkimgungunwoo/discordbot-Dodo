import { test } from "node:test";
import assert from "node:assert/strict";
import { settledScores, endTurn, type Seat, type State } from "../../shared/rummikub.js";
const human: Seat = { userId: "human", name: "human" };
const normal: Seat = { userId: null, name: "normal", bot: "normal" };
const hard: Seat = { userId: null, name: "hard", bot: "hard" };
test("mixed scoring adjusts each opponent independently and stays zero sum", () => {
  assert.deepEqual(settledScores([120, -40, -40, -40], 0, [human, human, normal, hard]), [90, -40, -20, -30]);
  assert.deepEqual(settledScores([-40, 40], 1, [human, hard]), [-30, 30]);
  assert.deepEqual(settledScores([40, -40], 0, [human, human]), [40, -40]);
  assert.deepEqual(settledScores([-40, 40], 1, [normal, hard]), [-20, 20]);
});
test("rounding preserves transfers; stalled exemptions are unchanged; raw scores stay intact", () => {
  const raw = [6, -3, -3];
  assert.deepEqual(settledScores(raw, 0, [human, normal, hard]), [4, -2, -2]);
  assert.deepEqual(raw, [6, -3, -3]);
  assert.deepEqual(settledScores([0, -30, 0], null, [human, normal, hard]), [0, -30, 0]);
});
test("first empty hand immediately ends the entire four player round", () => {
  const game: State = { hands: [[8, 9, 10], [26], [52], [78]], table: [], pile: [12], opened: [false, false, false, false], turn: 0, round: 1, passes: 0, finished: false, winner: null, scores: [] };
  endTurn(game, [[8, 9, 10]]);
  assert.equal(game.finished, true); assert.equal(game.winner, 0);
  assert.deepEqual(game.scores, [3, -1, -1, -1]);
  const before = structuredClone(game); assert.throws(() => endTurn(game, [], true), /종료된 경기/);
  assert.deepEqual(game, before);
});
