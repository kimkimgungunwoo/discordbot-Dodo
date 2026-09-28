import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const directory = mkdtempSync(join(tmpdir(), "dodo-arrow-tests-"));
mkdirSync(join(directory, "arrow-dodge"));
for (const name of ["arrow-dodge/constants", "arrow-dodge/types", "arrow-dodge/game"]) {
  const source = readFileSync(new URL("../src/" + name + ".ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  writeFileSync(join(directory, name + ".js"), output.outputText);
}
const require = createRequire(import.meta.url);
const { createInitialState, step, EMPTY_INPUT } = require(join(directory, "arrow-dodge/game.js"));
const { FIELD_X, FIELD_Y, FIELD_RADIUS, PLAYER_RADIUS, PLAYER_SPEED } = require(join(directory, "arrow-dodge/constants.js"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("start waits exactly two seconds and ignores movement during countdown", () => {
  let state = step(createInitialState(7), { ...EMPTY_INPUT, start: true });
  for (let tick = 0; tick < 119; tick++) state = step(state, { x: 1, y: 1 });
  assert.equal(state.phase, "countdown");
  assert.deepEqual([state.player.x, state.player.y], [FIELD_X, FIELD_Y]);
  state = step(state, EMPTY_INPUT);
  assert.equal(state.phase, "playing");
});

test("diagonal movement is normalized and the whole hitbox remains in the circle", () => {
  let straight = createInitialState(1); straight.phase = "playing";
  let diagonal = structuredClone(straight);
  straight = step(straight, { x: 1, y: 0 }); diagonal = step(diagonal, { x: 1, y: 1 });
  assert.ok(Math.abs(Math.hypot(straight.player.x - FIELD_X, straight.player.y - FIELD_Y) - PLAYER_SPEED) < 1e-9);
  assert.ok(Math.abs(Math.hypot(diagonal.player.x - FIELD_X, diagonal.player.y - FIELD_Y) - PLAYER_SPEED) < 1e-9);
  for (let tick = 0; tick < 500; tick++) diagonal = step(diagonal, { x: 1, y: 1 });
  assert.ok(Math.hypot(diagonal.player.x - FIELD_X, diagonal.player.y - FIELD_Y) <= FIELD_RADIUS - PLAYER_RADIUS - 8 + 1e-9);
});

test("same seed and input stream produce identical arrow patterns", () => {
  let left = createInitialState(123), right = createInitialState(123);
  left.phase = right.phase = "playing"; left.spawnTicks = right.spawnTicks = 1;
  for (let tick = 0; tick < 500; tick++) {
    const input = { x: tick % 80 < 40 ? 1 : -1, y: tick % 120 < 60 ? 1 : -1 };
    left = step(left, input); right = step(right, input);
  }
  assert.deepEqual(left, right);
});

test("attack rhythm alternates aimed skirmishes with large simultaneous barrages", () => {
  let state = createInitialState(19); state.phase = "playing"; state.spawnTicks = 1;
  const volleys = [], speeds = [], warningLengths = [];
  for (let tick = 0; tick < 720; tick++) {
    const wasPending = state.barragePending;
    state = step(state, { x: tick % 100 < 50 ? 1 : -1, y: tick % 140 < 70 ? -1 : 1 });
    const spawned = state.arrows.filter(arrow => arrow.age === 1);
    if (spawned.length) {
      volleys.push(spawned.length);
      speeds.push(...spawned.map(arrow => Math.hypot(arrow.vx, arrow.vy)));
    }
    if (!wasPending && state.barragePending) warningLengths.push(state.spawnTicks);
    state.arrows = [];
    if (state.phase === "gameover") state.phase = "playing";
  }
  assert.ok(volleys.some(count => count >= 12));
  assert.ok(volleys.filter(count => count >= 3 && count <= 5).length >= 4);
  assert.ok(Math.min(...speeds) >= 5.22);
  assert.ok(warningLengths.every(ticks => ticks >= 28));
});

test("arrow body collision ends the run on the exact simulation tick", () => {
  let state = createInitialState(1); state.phase = "playing"; state.spawnTicks = 100;
  state.arrows.push({ id: 1, x: FIELD_X - 2, y: FIELD_Y, vx: 4, vy: 0, length: 17, age: 2 });
  state = step(state, EMPTY_INPUT);
  assert.equal(state.phase, "gameover");
  assert.equal(state.survivalTicks, 1);
});
