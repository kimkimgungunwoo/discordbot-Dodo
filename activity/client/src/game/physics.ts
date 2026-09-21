import { BALL_GRAVITY, BALL_RADIUS, CEILING_DROP_SPEED, COURT_WIDTH, DIVE_SPEED, GRAVITY, GROUND_Y, JUMP_VELOCITY, LYING_TICKS, MOVE_SPEED, NET_HALF_WIDTH, NET_TOP_Y, NET_X, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, SPIKE_TICKS, SPIKE_SPEED, MOVING_SPIKE_SPEED, RECEIVE_MIN_LIFT, RECEIVE_MAX_LIFT, WIN_SCORE } from "./constants";
import type { Ball, GameState, Player, PlayerInput, PlayerState, Side } from "./types";

export const EMPTY_INPUT: PlayerInput = { x: 0, y: 0, jump: false, hit: false };
function makePlayer(side: Side, score = 0): Player {
  return { x: side === "left" ? 240 : 720, y: 0, yVelocity: 0, state: "idle", ticksInState: 0, facing: side === "left" ? 1 : -1, isRight: side === "right", diveDirection: 1, score, hitHeld: false, spikeAvailable: false };
}
function serveBall(side: Side): Ball {
  return { x: side === "left" ? 280 : 680, y: -280, xVelocity: 0, yVelocity: 0, contact: null, powerTicks: 0 };
}
export function createInitialState(seed: number): GameState {
  const server: Side = seed % 2 === 0 ? "left" : "right";
  return { tick: 0, phase: "countdown", left: makePlayer("left"), right: makePlayer("right"), ball: serveBall(server), phaseTicks: 180, winner: null, server, events: [], effects: [], trail: [] };
}
function pose(player: Player, state: PlayerState) {
  if (player.state !== state) { player.state = state; player.ticksInState = 0; }
}
function stepPlayer(state: GameState, side: Side, input: PlayerInput) {
  const player = state[side];
  const jump = input.jump;
  const hit = input.hit && !player.hitHeld;
  player.hitHeld = input.hit;
  player.ticksInState++;
  if (player.state === "lying") {
    if (player.ticksInState >= LYING_TICKS) pose(player, "idle");
    return;
  }
  if (player.state === "dive") player.x += player.diveDirection * DIVE_SPEED;
  else {
    player.x += input.x * MOVE_SPEED;
    if (input.x) player.facing = input.x;
    if (player.y === 0) {
      if (jump) {
        player.yVelocity = JUMP_VELOCITY; pose(player, "jump");
        state.events.push({ kind: "jump", side, x: player.x, y: player.y });
      } else if (hit && input.x) {
        pose(player, "dive"); player.diveDirection = input.x; player.yVelocity = -4;
      } else if (hit) pose(player, "hit");
      else if (player.state !== "hit" || player.ticksInState >= 10) pose(player, input.x ? "run" : "idle");
    }
    if ((player.y < 0 || jump) && hit && player.state !== "spike") {
      pose(player, "spike");
      player.spikeAvailable = true;
    }
  }
  const min = player.isRight ? NET_X + NET_HALF_WIDTH + PLAYER_HALF_WIDTH : PLAYER_HALF_WIDTH;
  const max = player.isRight ? COURT_WIDTH - PLAYER_HALF_WIDTH : NET_X - NET_HALF_WIDTH - PLAYER_HALF_WIDTH;
  player.x = Math.max(min, Math.min(max, player.x));
  if (player.y < 0 || player.yVelocity < 0 || player.state === "dive") {
    player.yVelocity += player.state === "dive" ? 0.4 : GRAVITY;
    player.y += player.yVelocity;
    if (player.y >= 0) {
      player.y = 0; player.yVelocity = 0;
      pose(player, player.state === "dive" ? "lying" : "idle");
    } else if (player.state !== "dive" && (player.state !== "spike" || player.ticksInState >= SPIKE_TICKS)) {
      pose(player, player.yVelocity < 0 ? "jump" : "fall");
    }
  }
}
function overlaps(ball: Ball, player: Player) {
  const low = player.state === "dive" || player.state === "lying";
  const halfWidth = low ? 42 : PLAYER_HALF_WIDTH;
  const height = low ? 48 : PLAYER_HEIGHT;
  const closestX = Math.max(player.x - halfWidth, Math.min(player.x + halfWidth, ball.x));
  const closestY = Math.max(player.y - height, Math.min(player.y, ball.y));
  return (ball.x - closestX) ** 2 + (ball.y - closestY) ** 2 <= BALL_RADIUS ** 2;
}
// Shared by gameplay and AI prediction; mutates only the supplied ball.
export function advanceBallFlight(ball: Ball) {
  const previousX = ball.x, previousY = ball.y;
  ball.yVelocity += BALL_GRAVITY;
  ball.x += ball.xVelocity; ball.y += ball.yVelocity;
  ball.powerTicks = Math.max(0, ball.powerTicks - 1);
  if (ball.x < BALL_RADIUS || ball.x > COURT_WIDTH - BALL_RADIUS) {
    ball.x = Math.max(BALL_RADIUS, Math.min(COURT_WIDTH - BALL_RADIUS, ball.x)); ball.xVelocity *= -1;
  }
  if (ball.y < -GROUND_Y + BALL_RADIUS) {
    ball.y = -GROUND_Y + BALL_RADIUS; ball.yVelocity = CEILING_DROP_SPEED;
  }
  const netTop = NET_TOP_Y - GROUND_Y;
  if (Math.abs(ball.x - NET_X) < NET_HALF_WIDTH + BALL_RADIUS && ball.y + BALL_RADIUS > netTop) {
    if (previousY + BALL_RADIUS <= netTop && ball.yVelocity > 0) {
      ball.y = netTop - BALL_RADIUS; ball.yVelocity = -Math.abs(ball.yVelocity) * 0.75;
    } else {
      const direction = previousX <= NET_X ? -1 : 1;
      ball.x = NET_X + direction * (NET_HALF_WIDTH + BALL_RADIUS);
      ball.xVelocity = direction * Math.max(2, Math.abs(ball.xVelocity) * 0.8);
    }
    ball.powerTicks = 0;
  }
}
function stepBall(state: GameState, inputs: Record<Side, PlayerInput>): Side | null {
  const ball = state.ball;
  advanceBallFlight(ball);
  if (ball.contact && !overlaps(ball, state[ball.contact])) ball.contact = null;
  for (const side of ["left", "right"] as const) {
    const player = state[side];
    if (ball.contact === side || !overlaps(ball, player)) continue;
    const spike = player.state === "spike" && player.spikeAvailable;
    const offset = ball.x - player.x;
    const lift = Math.max(RECEIVE_MIN_LIFT, Math.min(RECEIVE_MAX_LIFT, Math.abs(ball.yVelocity)));
    if (spike) {
      const input = inputs[side];
      const speed = input.x === 0 ? SPIKE_SPEED : MOVING_SPIKE_SPEED;
      ball.xVelocity = (player.isRight ? -speed : speed);
      ball.yVelocity = (input.y ?? 0) * lift * 2;
      player.spikeAvailable = false;
    } else {
      ball.xVelocity = Math.max(-12, Math.min(12, offset / 4));
      ball.yVelocity = -lift;
    }
    ball.contact = side; ball.powerTicks = spike ? 32 : 0;
    const kind = spike ? "spike" : "hit";
    state.events.push({ kind, side, x: ball.x, y: ball.y });
    state.effects.push({ kind, x: ball.x, y: ball.y, age: 0 });
    if (player.y === 0 && player.state !== "lying" && player.state !== "dive") pose(player, "hit");
  }
  if (ball.y + BALL_RADIUS >= 0) {
    ball.y = -BALL_RADIUS; return ball.x < NET_X ? "right" : "left";
  }
  return null;
}
export function step(previous: GameState, leftInput: PlayerInput, rightInput: PlayerInput): GameState {
  const state: GameState = { ...previous, tick: previous.tick + 1, left: { ...previous.left }, right: { ...previous.right }, ball: { ...previous.ball }, events: [], effects: previous.effects.filter(effect => effect.age < 18).map(effect => ({ ...effect, age: effect.age + 1 })), trail: previous.trail.map(point => ({ ...point })) };
  if (state.phase === "gameover") {
    state.left.ticksInState++; state.right.ticksInState++; return state;
  }
  if (state.phase === "countdown" || state.phase === "point") {
    state.phaseTicks--;
    if (state.phaseTicks <= 0) {
      state.left = makePlayer("left", state.left.score); state.right = makePlayer("right", state.right.score);
      state.ball = serveBall(state.server); state.trail = []; state.effects = []; state.phase = "playing";
    }
    return state;
  }
  stepPlayer(state, "left", leftInput); stepPlayer(state, "right", rightInput);
  state.trail = [{ x: state.ball.x, y: state.ball.y }, ...state.trail].slice(0, 7);
  const scorer = stepBall(state, { left: leftInput, right: rightInput });
  if (scorer) {
    state[scorer].score++; state.server = scorer === "left" ? "right" : "left";
    state.events.push({ kind: "point", side: scorer, x: state.ball.x, y: state.ball.y });
    if (state[scorer].score >= WIN_SCORE) {
      state.winner = scorer; state.phase = "gameover";
      for (const side of ["left", "right"] as const) {
        state[side].y = 0; state[side].yVelocity = 0; pose(state[side], side === scorer ? "win" : "lose");
      }
      state.events.push({ kind: "win", side: scorer, x: 0, y: 0 });
    } else { state.phase = "point"; state.phaseTicks = 75; }
  }
  return state;
}
