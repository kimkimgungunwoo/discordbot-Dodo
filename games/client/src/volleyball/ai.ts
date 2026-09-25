import { BALL_RADIUS, DIVE_SPEED, SPIKE_SPEED, MOVING_SPIKE_SPEED, SPIKE_MIN_LIFT, SPIKE_MAX_LIFT, COURT_WIDTH, NET_X, MOVE_SPEED, PLAYER_HALF_WIDTH, NET_HALF_WIDTH } from "./constants";
import { advanceBallFlight, EMPTY_INPUT, step } from "./physics";
import type { GameState, Player, PlayerInput } from "./types";
function normalInput(state: GameState, self: Player): PlayerInput {
  const ball = state.ball;
  const ownSide = self.isRight ? ball.x > NET_X : ball.x < NET_X;
  let target = self.isRight ? 720 : 240;
  if (ownSide) {
    const prediction = { ...ball };
    for (let tick = 0; tick < 112 && prediction.y < -75; tick++) advanceBallFlight(prediction);
    target = prediction.x + (self.isRight ? 30 : -30) + Math.sin(Math.floor(state.tick / 24) * 2.7) * 12;
  }
  const dx = target - self.x;
  const near = Math.abs(ball.x - self.x) < 65;
  const jump = ownSide && near && ball.y < -100 && ball.y > -230 && ball.yVelocity > 0 && self.y === 0;
  const hit = ownSide && near && self.y < -35 && Math.abs(ball.y - (self.y - 55)) < 45;

  const x = direction(dx, 12);
  return { x, y: hit ? attackDirection(state, self, x === 0 ? SPIKE_SPEED : MOVING_SPIKE_SPEED) : 0, jump, hit };
}


export type AiDifficulty = "easy" | "normal" | "hard" | "extreme";
export const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  easy: "쉬움", normal: "보통", hard: "어려움", extreme: "극한",
};
export function parseDifficulty(value: unknown): AiDifficulty {
  return value === "easy" || value === "hard" || value === "extreme" ? value : "normal";
}
const direction = (distance: number, margin = 8): -1 | 0 | 1 => Math.abs(distance) <= margin ? 0 : distance > 0 ? 1 : -1;
const onSide = (x: number, self: Player) => self.isRight ? x > NET_X : x < NET_X;

function easyInput(state: GameState, self: Player): PlayerInput {
  const base = normalInput(state, self);
  const error = Math.sin(Math.floor(state.tick / 36) * 2.7) * 65;
  const active = state.tick % 24 < 14;
  return {
    x: active ? direction(state.ball.x + error - self.x, 30) : 0,
    y: 0,
    jump: active && base.jump && Math.abs(state.ball.x - self.x) < 40,
    hit: false,
  };
}

function intercept(state: GameState, self: Player, height = -110) {
  const ball = { ...state.ball };
  for (let ticks = 1; ticks <= 100; ticks++) {
    advanceBallFlight(ball);
    if (onSide(ball.x, self) && ball.yVelocity > 0 && ball.y >= height) return { x: ball.x, ticks, found: true };
    if (ball.y + BALL_RADIUS >= 0) break;
  }
  return { x: self.isRight ? 720 : 240, ticks: 100, found: false };
}
// Try the steep shot first, but only if its actual flight clears the whole net.
function attackDirection(state: GameState, self: Player, speed = MOVING_SPIKE_SPEED): -1 | 0 | 1 {
  const direction = self.isRight ? -1 : 1;
  const lift = Math.max(SPIKE_MIN_LIFT, Math.min(SPIKE_MAX_LIFT, Math.abs(state.ball.yVelocity)));
  for (const y of [1, 0, -1] as const) {
    const ball = { ...state.ball, xVelocity: direction * speed, yVelocity: y * lift * 2 };
    for (let tick = 0; tick < 50; tick++) {
      advanceBallFlight(ball);
      if (ball.xVelocity * direction <= 0 || ball.y + BALL_RADIUS >= 0) break;
      if ((ball.x - NET_X) * direction > NET_HALF_WIDTH + BALL_RADIUS) return y;
    }
  }
  return -1;
}

function rescueInput(state: GameState, self: Player): PlayerInput | null {
  if (self.y !== 0 || self.hitHeld || self.state === "dive" || self.state === "lying") return null;
  const landing = intercept(state, self, -65);
  if (!landing.found || landing.ticks > 18) return null;
  const distance = Math.abs(landing.x - self.x);
  const walkingReach = landing.ticks * MOVE_SPEED + PLAYER_HALF_WIDTH + BALL_RADIUS;
  // A dive starts moving on the next tick, then has a wider collision box.
  const divingReach = Math.max(0, landing.ticks - 1) * DIVE_SPEED + 42 + BALL_RADIUS;
  if (distance <= walkingReach || distance > divingReach) return null;
  return { x: direction(landing.x - self.x, 0), y: 0, jump: false, hit: true };
}

function hardInput(state: GameState, self: Player): PlayerInput {
  const rescue = rescueInput(state, self);
  if (rescue) return rescue;
  const ball = state.ball;
  const landing = intercept(state, self);
  const offset = self.isRight ? 28 : -28;
  const min = self.isRight ? NET_X + NET_HALF_WIDTH + PLAYER_HALF_WIDTH : PLAYER_HALF_WIDTH;
  const max = self.isRight ? COURT_WIDTH - PLAYER_HALF_WIDTH : NET_X - NET_HALF_WIDTH - PLAYER_HALF_WIDTH;
  const target = Math.max(min, Math.min(max, landing.x + offset));
  let x = direction(target - self.x);
  const own = onSide(ball.x, self);
  const near = Math.abs(ball.x - self.x) < 70;
  const jump = own && near && ball.y > -255 && ball.y < -125 && ball.yVelocity > -2 && self.y === 0;
  const hit = own && self.y < -30 && near && Math.abs(ball.y - (self.y - 55)) < 60 && !self.hitHeld;
  if (hit) x = self.isRight ? -1 : 1;
  return { x, y: hit ? attackDirection(state, self) : 0, jump, hit };
}

function tacticalInput(state: GameState, self: Player, extreme: boolean): PlayerInput {
  const base = hardInput(state, self);
  if (state.phase !== "playing" || !onSide(state.ball.x, self)) return base;
  const landing = intercept(state, self);
  if (Math.abs(state.ball.x - self.x) > 180 && landing.ticks > 16) return base;
  const side = self.isRight ? "right" : "left";
  const other = self.isRight ? "left" : "right";
  const candidates: PlayerInput[] = [base];
  for (const x of [-1, 0, 1] as const) {
    candidates.push({ x, y: 0, jump: false, hit: false });
    candidates.push({ x, y: 0, jump: true, hit: false });
    for (const y of [-1, 0, 1] as const) candidates.push({ x, y, jump: self.y === 0, hit: true });
  }
  const rescue = rescueInput(state, self);
  if (rescue) candidates.push(rescue);
  let best = base, bestValue = -Infinity;
  for (const candidate of candidates) {
    let future = state;
    let value = 0;
    let touched = false;
    for (let tick = 0; tick < (extreme ? 24 : 16); tick++) {
      const input = tick < 6 ? candidate : hardInput(future, future[side]);
      const opponent = extreme ? hardInput(future, future[other]) : EMPTY_INPUT;
      future = self.isRight ? step(future, opponent, input) : step(future, input, opponent);
      for (const event of future.events) {
        if (event.side === side && (event.kind === "hit" || event.kind === "spike")) touched = true;
      }
      if (future.phase !== "playing") break;
    }
    if (touched) value += 40;
    value += (future[side].score - self.score) * 10000;
    value -= (future[other].score - state[other].score) * 10000;
    const outgoing = !onSide(future.ball.x, self);
    if (outgoing) {
      value += 300;
      // Reward a shot the defender cannot reach in time, not merely a hit.
      const receive = intercept(future, future[other]);
      if (receive.found) {
        const gap = Math.abs(receive.x - future[other].x);
        const reach = receive.ticks * MOVE_SPEED + PLAYER_HALF_WIDTH + BALL_RADIUS;
        value += Math.max(-120, Math.min(300, gap - reach)) * 2;
        value += Math.max(0, 30 - receive.ticks) * 3;
      }
    } else {
      const next = intercept(future, future[side]);
      value -= Math.abs(next.x + (self.isRight ? 28 : -28) - future[side].x) * 0.8;
      if (future.ball.y > -100 && future.ball.yVelocity > 0) value -= 150;
    }
    if (future[side].state === "lying") value -= 100;
    if (value > bestValue) { bestValue = value; best = candidate; }
  }
  return best;
}

export function computeAiInput(state: GameState, self: Player, difficulty: AiDifficulty = "normal"): PlayerInput {
  if (difficulty === "easy") return easyInput(state, self);
  if (difficulty === "hard") return tacticalInput(state, self, false);
  if (difficulty === "extreme") return tacticalInput(state, self, true);
  return normalInput(state, self);
}
