import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const directory = mkdtempSync(join(tmpdir(), "dodo-tests-"));
mkdirSync(join(directory, "game"));
for (const name of ["game/constants", "game/types", "game/physics", "game/ai", "session"]) {
  const source = readFileSync(new URL("../src/" + name + ".ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  writeFileSync(join(directory, name + ".js"), output.outputText);
}
const require = createRequire(import.meta.url);
const { createInitialState, step, EMPTY_INPUT } = require(join(directory, "game/physics.js"));
const { PracticeSession } = require(join(directory, "session.js"));
const { BALL_RADIUS, GROUND_Y, NET_TOP_Y, RECEIVE_MAX_LIFT, WIN_SCORE } = require(join(directory, "game/constants.js"));
after(() => rmSync(directory, { recursive: true, force: true }));
function playing() { const state = createInitialState(0); state.phase = "playing"; return state; }
function freeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  return value;
}
test("fixed ticks are deterministic and never mutate their input", () => {
  const initial = freeze(playing());
  const input = { x: 1, jump: true, hit: false };
  assert.deepEqual(step(initial, input, EMPTY_INPUT), step(initial, input, EMPTY_INPUT));
  assert.equal(initial.tick, 0);
});
test("countdown lasts 180 ticks and does not accept early movement", () => {
  let state = createInitialState(0);
  for (let tick = 0; tick < 179; tick++) state = step(state, { x: 1, jump: true, hit: true }, EMPTY_INPUT);
  assert.equal(state.phase, "countdown"); assert.equal(state.left.x, 240);
  state = step(state, EMPTY_INPUT, EMPTY_INPUT); assert.equal(state.phase, "playing");
});
test("dive moves through the air before recovering on the ground", () => {
  const initial = playing();
  initial.ball = { ...initial.ball, x: 480, y: -350 };
  let state = step(initial, { x: 1, y: 0, jump: false, hit: true }, EMPTY_INPUT);
  for (let tick = 0; tick < 8; tick++) state = step(state, EMPTY_INPUT, EMPTY_INPUT);
  assert.equal(state.left.state, "dive"); assert.ok(state.left.y < 0); assert.ok(state.left.x > 290);
  for (let tick = 0; tick < 35; tick++) state = step(state, EMPTY_INPUT, EMPTY_INPUT);
  assert.equal(state.left.state, "idle"); assert.equal(state.left.y, 0);
});
test("holding jump repeats the jump after landing", () => {
  let state = playing();
  state.ball = { ...state.ball, x: 480, y: -350 };
  let jumps = 0;
  for (let tick = 0; tick < 70; tick++) {
    state = step(state, { ...EMPTY_INPUT, jump: true }, EMPTY_INPUT);
    jumps += state.events.filter(event => event.kind === "jump").length;
  }
  assert.equal(jumps, 2);
});
test("a contact produces one hit while the ball overlaps a player", () => {
  const initial = playing();
  initial.ball = { ...initial.ball, x: 240, y: -35, yVelocity: 0 };
  const first = step(initial, EMPTY_INPUT, EMPTY_INPUT);
  assert.equal(first.events.filter(event => event.kind === "hit").length, 1);
  const next = step(first, EMPTY_INPUT, EMPTY_INPUT);
  assert.equal(next.events.filter(event => event.kind === "hit").length, 0);
});
test("downward input spikes down and emits effects", () => {
  const initial = playing();
  initial.left.y = -130;
  initial.ball = { ...initial.ball, x: 240, y: -190 };
  const state = step(initial, { x: 0, y: 1, jump: false, hit: true }, EMPTY_INPUT);
  assert.ok(state.events.some(event => event.kind === "spike"));
  assert.equal(state.ball.powerTicks, 32); assert.ok(state.ball.yVelocity > 0);
});
test("spikes use contact-time vertical input, not automatic height correction", () => {
  for (const height of [-130, -30]) for (const direction of [-1, 0, 1]) {
    const initial = playing();
    initial.left.y = height;
    initial.left.state = "spike";
    initial.left.spikeAvailable = true;
    initial.ball = { ...initial.ball, x: 258, y: height - 60 };
    const state = step(initial, { ...EMPTY_INPUT, y: direction }, EMPTY_INPUT);
    assert.equal(Math.sign(state.ball.yVelocity), direction);
    assert.ok(state.ball.xVelocity > 0);
  }
});
test("horizontal input strengthens a spike toward the opponent, even on back contact", () => {
  function shot(side, offset, horizontal) {
    const initial = playing();
    initial[side].y = -130;
    initial.ball = { ...initial.ball, x: initial[side].x + offset, y: -190 };
    const input = { ...EMPTY_INPUT, x: horizontal, hit: true };
    return step(initial, side === "left" ? input : EMPTY_INPUT, side === "right" ? input : EMPTY_INPUT);
  }
  const standing = shot("left", 24, 0);
  const moving = shot("left", 24, 1);
  const mirror = shot("right", -24, -1);
  const backwards = shot("left", -24, 0);
  assert.ok(moving.ball.xVelocity > standing.ball.xVelocity);
  assert.equal(mirror.ball.xVelocity, -moving.ball.xVelocity);
  assert.ok(backwards.ball.xVelocity > 0);
});
test("normal reception depends on contact position and softens a power shot", () => {
  for (const offset of [-24, 0, 24]) {
    const initial = playing();
    initial.ball = { ...initial.ball, x: 240 + offset, y: -70, yVelocity: 20, powerTicks: 20 };
    const state = step(initial, EMPTY_INPUT, EMPTY_INPUT);
    assert.equal(Math.sign(state.ball.xVelocity), Math.sign(offset));
    assert.ok(state.ball.yVelocity < 0);
    assert.equal(state.ball.powerTicks, 0);
  }
});
test("an expired swing and a used swing cannot create another spike", () => {
  for (const used of [false, true]) {
    const initial = playing();
    initial.left.y = -130;
    initial.left.state = "spike";
    initial.left.ticksInState = used ? 3 : 15;
    initial.left.spikeAvailable = !used;
    initial.ball = { ...initial.ball, x: 258, y: -190 };
    const state = step(initial, EMPTY_INPUT, EMPTY_INPUT);
    assert.equal(state.events[0].kind, "hit");
  }
});
test("net top bounces upward and center impacts stay finite", () => {
  const initial = playing();
  initial.ball = { ...initial.ball, x: 480, y: NET_TOP_Y - GROUND_Y - BALL_RADIUS - 6, yVelocity: 8 };
  const state = step(initial, EMPTY_INPUT, EMPTY_INPUT);
  assert.ok(state.ball.yVelocity < 0); assert.equal(state.ball.y, NET_TOP_Y - GROUND_Y - BALL_RADIUS);
});
test("ground contact uses ball radius and awards exactly one winning point", () => {
  const initial = playing(); initial.right.score = WIN_SCORE - 1;
  initial.ball = { ...initial.ball, x: 70, y: -BALL_RADIUS - 1, yVelocity: 3 };
  const state = step(initial, EMPTY_INPUT, EMPTY_INPUT);
  assert.equal(state.phase, "gameover"); assert.equal(state.winner, "right");
  const next = step(state, EMPTY_INPUT, EMPTY_INPUT);
  assert.equal(next.right.score, WIN_SCORE); assert.equal(next.events.length, 0);
  assert.ok(next.right.ticksInState > state.right.ticksInState);
});
test("ordinary returns have a compact arc without ceiling contact", () => {
  for (const lift of [12, RECEIVE_MAX_LIFT]) {
    let state = playing();
    state.ball = { ...state.ball, x: 70, y: -120, yVelocity: -lift };
    let top = state.ball.y;
    let ticks = 0;
    do {
      state = step(state, EMPTY_INPUT, EMPTY_INPUT);
      top = Math.min(top, state.ball.y);
      ticks++;
    } while (state.ball.y < -120 && ticks < 100);
    assert.ok(-120 - top >= 95 && -120 - top <= 145);
    assert.ok(ticks >= 34 && ticks <= 43);
    assert.equal(state.phase, "playing");
  }
});
test("receiving a hard shot caps lift rather than making a huge balloon return", () => {
  const initial = playing();
  initial.ball = { ...initial.ball, x: 240, y: -100, yVelocity: 28, powerTicks: 15 };
  const state = step(initial, EMPTY_INPUT, EMPTY_INPUT);
  assert.equal(state.ball.yVelocity, -RECEIVE_MAX_LIFT);
  assert.equal(state.ball.powerTicks, 0);
});
test("ceiling contact starts a slow fall instead of a rubber-wall rebound", () => {
  const initial = playing();
  initial.ball = { ...initial.ball, x: 70, y: -GROUND_Y + BALL_RADIUS + 1, yVelocity: -28 };
  const state = step(initial, EMPTY_INPUT, EMPTY_INPUT);
  assert.equal(state.ball.y, -GROUND_Y + BALL_RADIUS);
  assert.ok(state.ball.yVelocity > 0 && state.ball.yVelocity < 2);
  const next = step(state, EMPTY_INPUT, EMPTY_INPUT);
  assert.ok(next.ball.y > state.ball.y);
});
test("moving power hits do not arbitrarily amplify vertical velocity", () => {
  const initial = playing();
  initial.left.y = -130;
  initial.ball = { ...initial.ball, x: 258, y: -190 };
  const neutral = step(initial, { ...EMPTY_INPUT, y: 1, hit: true }, EMPTY_INPUT);
  const moving = step(initial, { ...EMPTY_INPUT, x: 1, y: 1, hit: true }, EMPTY_INPUT);
  assert.ok(moving.ball.xVelocity > neutral.ball.xVelocity);
  assert.equal(moving.ball.yVelocity, neutral.ball.yVelocity);
});
test("only the host can start and rematch resets the match", () => {
  const session = new PracticeSession();
  assert.equal(session.requestStart("visitor"), false);
  assert.equal(session.requestStart("local"), true);
  assert.equal(session.requestStart("local"), false);
  session.state.phase = "gameover"; session.state.left.score = WIN_SCORE;
  assert.equal(session.requestStart("visitor"), false);
  assert.equal(session.requestStart("local"), true);
  assert.equal(session.state.left.score, 0); assert.equal(session.matchId, 2);
  assert.equal(session.state.phase, "countdown");
});
test("long CPU practice stays finite and within the court", () => {
  const session = new PracticeSession(); session.requestStart("local");
  for (let tick = 0; tick < 18000 && session.state.phase !== "gameover"; tick++) {
    session.advance(EMPTY_INPUT);
    assert.ok(Number.isFinite(session.state.ball.x + session.state.ball.y));
    assert.ok(session.state.left.x < 480 && session.state.right.x > 480);
  }
  assert.equal(session.state.phase, "gameover");
});


const { computeAiInput } = require(join(directory, "game/ai.js"));
test("all difficulties are pure, deterministic and use legal player inputs", () => {
  const state = playing();
  state.ball = { ...state.ball, x: 730, y: -170, yVelocity: 7 };
  const frozen = freeze(state);
  for (const difficulty of ["easy", "normal", "hard", "extreme"]) {
    const input = computeAiInput(frozen, frozen.right, difficulty);
    assert.deepEqual(input, computeAiInput(structuredClone(frozen), { ...frozen.right }, difficulty));
    assert.ok([-1, 0, 1].includes(input.x));
    assert.ok([-1, 0, 1].includes(input.y));
    assert.equal(typeof input.jump, "boolean");
    assert.equal(typeof input.hit, "boolean");
  }
  assert.deepEqual(computeAiInput(frozen, frozen.right), computeAiInput(frozen, frozen.right, "normal"));
});

test("new difficulty levels separate in mirrored matches against the original AI", () => {
  const totals = {};
  for (const difficulty of ["easy", "hard", "extreme"]) {
    let points = 0, conceded = 0;
    for (let seed = 0; seed < 4; seed++) {
      let state = createInitialState(seed);
      const side = seed < 2 ? "right" : "left";
      while (state.phase !== "gameover" && state.tick < 12000) {
        state = step(state, computeAiInput(state, state.left, side === "left" ? difficulty : "normal"),
          computeAiInput(state, state.right, side === "right" ? difficulty : "normal"));
      }
      assert.equal(state.phase, "gameover", difficulty + " should finish this matchup");
      points += state[side].score;
      conceded += state[side === "right" ? "left" : "right"].score;
    }
    totals[difficulty] = points - conceded;
  }
  assert.ok(totals.easy < 0);
  assert.ok(totals.hard > 0);
  assert.ok(totals.extreme > totals.hard);
});
