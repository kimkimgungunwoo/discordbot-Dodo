import { BALL_RADIUS, DIVE_SPEED, JUMP_VELOCITY, GRAVITY, PLAYER_HEIGHT, LYING_TICKS, RECEIVE_HORIZONTAL_DIVISOR, RECEIVE_MAX_SPEED, RECEIVE_MIN_LIFT, RECEIVE_MAX_LIFT, SPIKE_SPEED, MOVING_SPIKE_SPEED, SPIKE_MIN_LIFT, SPIKE_MAX_LIFT, COURT_WIDTH, NET_X, MOVE_SPEED, PLAYER_HALF_WIDTH, NET_HALF_WIDTH } from "./constants";
import { advanceBallFlight, EMPTY_INPUT, step } from "./physics";
import type { Ball, GameState, Player, PlayerInput } from "./types";
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

// ---- 극한 ----
// 수비수가 공에 닿을 수 있는지를 거리·점프 높이·다이브로 근사한다.
// margin = (필요 틱 - 남은 틱)의 최솟값. 양수면 어떤 방법으로도 못 닿는 공(=득점각).
const TOUCH_X = PLAYER_HALF_WIDTH + BALL_RADIUS, STAND_REACH = PLAYER_HEIGHT + BALL_RADIUS;
const RISE: number[] = [0]; // RISE[k] = 점프 k틱 후 발 높이
for (let k = 1, y = 0, v = JUMP_VELOCITY; v < 0; k++) { v += GRAVITY; y += v; RISE.push(-y); }
function riseTicks(height: number) {
  if (height <= 0) return 0;
  for (let k = 1; k < RISE.length; k++) if (RISE[k] >= height) return k;
  return Infinity;
}
function touchNeed(bx: number, by: number, x: number) {
  const gap = Math.max(0, Math.abs(bx - x) - TOUCH_X);
  const walk = Math.max(gap / MOVE_SPEED, riseTicks(-by - STAND_REACH));
  return by >= -48 - BALL_RADIUS ? Math.min(walk, 1 + Math.max(0, gap - 12) / DIVE_SPEED) : walk;
}
// 자유비행 궤적 중 defender 코트 구간을 [x, y, tick, ...]으로. 공격자 쪽에 떨어지면 null.
function flightOn(ball: Ball, defender: Player, limit = 90): number[] | null {
  const b = { ...ball }, path: number[] = [];
  for (let t = 1; t <= limit; t++) {
    advanceBallFlight(b);
    const landed = b.y + BALL_RADIUS >= 0, mine = onSide(b.x, defender);
    if (mine) path.push(b.x, landed ? -BALL_RADIUS : b.y, t);
    if (landed) return mine ? path : null;
  }
  return path;
}
function margin(path: number[], x: number, delay: number) {
  let worst = Infinity;
  for (let i = 0; i < path.length; i += 3) worst = Math.min(worst, touchNeed(path[i], path[i + 1], x) + delay - path[i + 2]);
  return worst;
}
// 스파이크 평가: 못 받는 공이면 margin 그대로. 받히는 공이면 상대가 공중에서 되받아칠 수 있는(카운터) 코스를 피한다.
function shotValue(path: number[], x: number, delay: number) {
  let worst = Infinity, counter = false;
  for (let i = 0; i < path.length; i += 3) {
    const slack = touchNeed(path[i], path[i + 1], x) + delay - path[i + 2];
    worst = Math.min(worst, slack);
    if (slack <= 0 && path[i + 1] < -STAND_REACH - 40) counter = true;
  }
  return worst > 0 ? worst : worst * 0.5 - (counter ? 12 : 0);
}
const recovery = (p: Player) => p.state === "lying" ? LYING_TICKS - p.ticksInState : p.state === "dive" ? LYING_TICKS + 6 : 0;
const courtMin = (p: Player) => p.isRight ? NET_X + NET_HALF_WIDTH + PLAYER_HALF_WIDTH : PLAYER_HALF_WIDTH;
const courtMax = (p: Player) => p.isRight ? COURT_WIDTH - PLAYER_HALF_WIDTH : NET_X - NET_HALF_WIDTH - PLAYER_HALF_WIDTH;

// (bx, by)에서 칠 수 있는 스파이크 6종의 상대 코트 궤적.
function spikePaths(bx: number, by: number, vy: number, attacker: Player, defender: Player) {
  const lift = Math.max(SPIKE_MIN_LIFT, Math.min(SPIKE_MAX_LIFT, Math.abs(vy)));
  const toward = attacker.isRight ? -1 : 1, paths: number[][] = [];
  for (const speed of [SPIKE_SPEED, MOVING_SPIKE_SPEED]) for (const y of [-1, 0, 1]) {
    const path = flightOn({ x: bx, y: by, xVelocity: toward * speed, yVelocity: y * lift * 2, contact: null, powerTicks: 0 }, defender);
    if (path) paths.push(path);
  }
  return paths;
}
// 수비는 lead틱 동안 [from, to] 안 어디로든 미리 옮길 수 있고, 공격은 그걸 보고 코스를 고른다.
// 반환 = 수비 최적 위치에서의 최선 코스 margin, 그리고 그 위치.
function coverage(paths: number[][], defender: Player, lead: number) {
  const reach = Math.max(0, lead - recovery(defender)) * MOVE_SPEED;
  const lo = Math.max(courtMin(defender), defender.x - reach), hi = Math.min(courtMax(defender), defender.x + reach);
  let value = Infinity, at = defender.x;
  for (let x = lo; x <= hi + 0.01; x += Math.max(8, (hi - lo) / 24)) {
    let best = -Infinity;
    for (const path of paths) best = Math.max(best, margin(path, x, Math.abs(x - defender.x) / MOVE_SPEED > lead ? recovery(defender) : 0));
    if (best < value) { value = best; at = x; }
  }
  return { value, at };
}

// 이번 틱에 실제로 스파이크가 맞는 입력 조합 중 상대가 가장 못 받는 코스.
const SPIKE_INPUTS: PlayerInput[] = [];
for (const hit of [true, false]) for (const x of [-1, 1, 0] as const) for (const y of [1, 0, -1] as const) SPIKE_INPUTS.push({ x, y, jump: false, hit });
function bestSpike(state: GameState, self: Player): PlayerInput | null {
  if (self.y >= 0 || Math.abs(state.ball.x - self.x) > 110 || Math.abs(state.ball.y - self.y + 45) > 130) return null;
  const side = self.isRight ? "right" : "left", other = self.isRight ? "left" : "right";
  let best: PlayerInput | null = null, bestValue = -Infinity;
  for (const input of SPIKE_INPUTS) {
    const next = self.isRight ? step(state, EMPTY_INPUT, input) : step(state, input, EMPTY_INPUT);
    if (!next.events.some(e => e.side === side && e.kind === "spike")) continue;
    const path = flightOn(next.ball, next[other]);
    const value = path ? shotValue(path, next[other].x, recovery(next[other])) : -1000;
    if (value > bestValue) { bestValue = value; best = input; }
  }
  return bestValue > -1000 ? best : null;
}

// 공이 내 코트에서 자유낙하하는 동안 어디서 뛰어 때릴지. 상대가 미리 자리를 잡아도 가장 못 받는 지점.
function planAttack(state: GameState, self: Player) {
  const opponent = self.isRight ? state.left : state.right;
  const b = { ...state.ball }, dir = self.isRight ? -1 : 1;
  let plan: { x: number; jumpIn: number; value: number } | null = null;
  for (let t = 1; t <= 70; t++) {
    advanceBallFlight(b);
    if (b.y + BALL_RADIUS >= 0) break;
    if (t % 2 || !onSide(b.x, self)) continue;
    const height = -b.y - STAND_REACH, rise = riseTicks(height);
    const x = Math.max(courtMin(self), Math.min(courtMax(self), b.x - dir * 12));
    if (height < 30 || rise > t || Math.abs(x - self.x) > MOVE_SPEED * t + 4) continue;
    const paths = spikePaths(b.x, b.y, b.yVelocity, self, opponent);
    if (!paths.length) continue;
    const value = coverage(paths, opponent, Math.min(t, 8)).value;
    if (!plan || value > plan.value + 0.5) plan = { x, jumpIn: t - rise, value };
  }
  return plan;
}

// 받는 공을 네트 앞 높은 곳으로 올려(셋) 다음 타에 꽂을 수 있게 하는 받는 위치.
function planSet(state: GameState, self: Player) {
  const dir = self.isRight ? -1 : 1, spot = NET_X - dir * 170;
  const b = { ...state.ball };
  for (let t = 1; t <= 90; t++) {
    advanceBallFlight(b);
    if (b.y + BALL_RADIUS >= 0) return null;
    if (!onSide(b.x, self) || b.yVelocity <= 0 || b.y < -STAND_REACH + 4) continue;
    let best: { x: number; score: number } | null = null;
    for (let offset = -48; offset <= 48; offset += 8) {
      const x = Math.max(courtMin(self), Math.min(courtMax(self), b.x - offset));
      if (Math.abs(x - self.x) > MOVE_SPEED * t) continue;
      const set = { ...b, xVelocity: Math.max(-RECEIVE_MAX_SPEED, Math.min(RECEIVE_MAX_SPEED, (b.x - x) / RECEIVE_HORIZONTAL_DIVISOR)), yVelocity: -Math.max(RECEIVE_MIN_LIFT, Math.min(RECEIVE_MAX_LIFT, Math.abs(b.yVelocity))) };
      for (let s = 1; s <= 90; s++) {
        advanceBallFlight(set);
        if (set.y + BALL_RADIUS >= 0 || !onSide(set.x, self)) break;
        if (set.yVelocity > 0 && set.y < -STAND_REACH - 90 && set.y > -STAND_REACH - 220) {
          const score = -Math.abs(set.x - spot);
          if (!best || score > best.score) best = { x, score };
        }
      }
    }
    return best;
  }
  return null;
}

// 공이 상대 코트에 있을 때: 상대가 칠 만한 지점들의 스파이크를 모두 가정하고 가장 안전한 수비 위치.
function guardTarget(state: GameState, self: Player): number | null {
  const opponent = self.isRight ? state.left : state.right;
  const b = { ...state.ball }, paths: number[][] = [];
  let first = 0;
  for (let t = 1; t <= 60 && paths.length < 24; t++) {
    advanceBallFlight(b);
    if (b.y + BALL_RADIUS >= 0 || onSide(b.x, self)) return null;
    if (t % 3 || b.y > -STAND_REACH - 30 || touchNeed(b.x, b.y, opponent.x) + recovery(opponent) > t) continue;
    first ||= t;
    paths.push(...spikePaths(b.x, b.y, b.yVelocity, opponent, self).map(path => path.map((v, i) => i % 3 === 2 ? v + t - first : v)));
  }
  return paths.length ? coverage(paths, self, first).at : null;
}

function extremeInput(state: GameState, self: Player): PlayerInput {
  if (state.phase !== "playing") return hardInput(state, self);
  const spike = bestSpike(state, self);
  if (spike) return spike;
  if (self.state === "dive" || self.state === "lying") return EMPTY_INPUT;
  const ball = state.ball, dir = self.isRight ? -1 : 1;
  if (!onSide(ball.x, self)) {
    const guard = guardTarget(state, self);
    if (guard !== null) return { x: direction(guard - self.x, 4), y: 0, jump: false, hit: false };
    return tacticalInput(state, self, true);
  }
  if (self.y < 0) {
    // 공중에선 방향만 바꿀 수 있다. 머리 위로 넘어가는 공을 따라가지 말고 떨어질 곳으로 흘러간다.
    const landing = intercept(state, self);
    return { x: direction((landing.found ? landing.x : ball.x) - dir * 12 - self.x, 4), y: 0, jump: false, hit: false };
  }
  const attack = planAttack(state, self);
  // 내가 올린 공(네트 쪽으로 가거나 수직)은 무조건 때린다. 넘어온 공은 확실한 득점각일 때만 바로 때리고 아니면 셋.
  const ownSet = ball.xVelocity * dir >= 0;
  if (attack && (ownSet || attack.value > 0)) {
    return { x: direction(attack.x - self.x, 3), y: 0, jump: attack.jumpIn <= 0, hit: false };
  }
  // 서서 받을 수 있으면 다이브(20틱 누워 있음)보다 항상 낫다.
  const set = planSet(state, self);
  if (set) return { x: direction(set.x - self.x, 3), y: 0, jump: false, hit: false };
  const rescue = rescueInput(state, self);
  if (rescue) return rescue;
  if (attack) return { x: direction(attack.x - self.x, 3), y: 0, jump: attack.jumpIn <= 0, hit: false };
  return tacticalInput(state, self, true);
}

export function computeAiInput(state: GameState, self: Player, difficulty: AiDifficulty = "normal"): PlayerInput {
  if (difficulty === "easy") return easyInput(state, self);
  if (difficulty === "hard") return tacticalInput(state, self, false);
  if (difficulty === "extreme") return extremeInput(state, self);
  return normalInput(state, self);
}
