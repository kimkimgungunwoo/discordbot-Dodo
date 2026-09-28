import { COUNTDOWN_TICKS, FIELD_RADIUS, FIELD_X, FIELD_Y, PLAYER_RADIUS, PLAYER_SPEED } from "./constants";
import type { Arrow, GameState, PlayerInput } from "./types";

export const EMPTY_INPUT: PlayerInput = { x: 0, y: 0 };

export function createInitialState(seed: number): GameState {
  return {
    tick: 0, phase: "ready", countdownTicks: 0, survivalTicks: 0, spawnTicks: 0, wave: 0,
    barragePending: false,
    rng: seed >>> 0 || 1, nextArrowId: 1,
    player: { x: FIELD_X, y: FIELD_Y, facing: 1, moveX: 0, moveY: 0 }, arrows: [],
  };
}

function random(state: GameState) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

function addArrow(state: GameState, angle: number, targetX: number, targetY: number, speed: number) {
  const x = FIELD_X + Math.cos(angle) * (FIELD_RADIUS + 24);
  const y = FIELD_Y + Math.sin(angle) * (FIELD_RADIUS + 24);
  const dx = targetX - x, dy = targetY - y;
  const length = Math.hypot(dx, dy) || 1;
  state.arrows.push({ id: state.nextArrowId++, x, y, vx: dx / length * speed, vy: dy / length * speed, length: 17, age: 0 });
}

function aimedTarget(state: GameState, spawnAngle: number, speed: number, spread: number, leadScale = 1) {
  const spawnX = FIELD_X + Math.cos(spawnAngle) * (FIELD_RADIUS + 24);
  const spawnY = FIELD_Y + Math.sin(spawnAngle) * (FIELD_RADIUS + 24);
  const flightTicks = Math.hypot(state.player.x - spawnX, state.player.y - spawnY) / speed;
  // 현재 이동을 끝까지 따라가면 불합리해지므로 비행 시간의 일부만 선행 조준한다.
  const lead = flightTicks * (0.48 + random(state) * 0.27) * leadScale;
  const predictedX = state.player.x + state.player.moveX * PLAYER_SPEED * lead;
  const predictedY = state.player.y + state.player.moveY * PLAYER_SPEED * lead;
  const perpendicular = spawnAngle + Math.PI / 2;
  const offset = (random(state) * 2 - 1) * spread;
  return {
    x: predictedX + Math.cos(perpendicular) * offset,
    y: predictedY + Math.sin(perpendicular) * offset,
  };
}

function arrowSpeed(seconds: number) {
  return 5.35 + Math.min(3.05, seconds * 0.075);
}

function spawnSkirmish(state: GameState, seconds: number) {
  const speed = arrowSpeed(seconds) * 1.04;
  const count = Math.min(5, 3 + Math.floor(seconds / 16));
  const baseAngle = random(state) * Math.PI * 2;
  for (let index = 0; index < count; index++) {
    // 기본 공격도 한쪽에서 좁게 몰아쳐 이동 경로를 누르고, 마지막 한 발은 반대편에서 교차시킨다.
    const crossShot = index === count - 1;
    const fanIndex = index - (count - 2) / 2;
    const angle = baseAngle + (crossShot ? Math.PI + (random(state) - 0.5) * 0.12 : fanIndex * 0.095);
    // 현재 위치, 절반 선행, 완전 선행을 함께 겨눠 멈춤과 계속 이동을 모두 위협한다.
    const leadScale = crossShot ? 0.72 : index % 3 === 0 ? 0.12 : index % 3 === 1 ? 0.62 : 1;
    const target = aimedTarget(state, angle, speed, 5, leadScale);
    addArrow(state, angle, target.x, target.y, speed * (0.99 + random(state) * 0.07));
  }
}

function spawnBarrage(state: GameState, seconds: number) {
  const speed = arrowSpeed(seconds) * 1.06;
  const count = Math.min(20, 12 + Math.floor(seconds / 10) * 2);
  const rotation = random(state) * Math.PI * 2;
  for (let index = 0; index < count; index++) {
    const angle = rotation + index * Math.PI * 2 / count + (random(state) - 0.5) * 0.08;
    // 중앙 조준탄과 양옆 봉쇄탄을 섞어 한 방향으로 계속 달리기만 해서는 빠져나갈 수 없게 한다.
    const lane = (index % 3 - 1) * (18 + Math.min(14, seconds * 0.25));
    const target = aimedTarget(state, angle, speed, 7);
    const perpendicular = angle + Math.PI / 2;
    addArrow(state, angle, target.x + Math.cos(perpendicular) * lane,
      target.y + Math.sin(perpendicular) * lane, speed * (0.96 + random(state) * 0.1));
  }
}

function spawnAttack(state: GameState) {
  const seconds = state.survivalTicks / 60;
  if (state.barragePending) {
    spawnBarrage(state, seconds);
    state.barragePending = false;
    state.wave++;
    // 대형 웨이브를 피할 시간을 주고 다음 소규모 공격으로 돌아간다.
    state.spawnTicks = Math.max(68, 101 - Math.floor(seconds * 0.72));
  } else {
    spawnSkirmish(state, seconds);
    state.wave++;
    if (state.wave % 3 === 0) {
      // 화살이 잠깐 끊기는 예고 구간 뒤 사방 일제사격이 시작된다.
      state.barragePending = true;
      state.spawnTicks = Math.max(28, 40 - Math.floor(seconds * 0.18));
    } else {
      state.spawnTicks = Math.max(30, 48 - Math.floor(seconds * 0.34));
    }
  }
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function arrowHitsPlayer(arrow: Arrow, playerX: number, playerY: number) {
  const speed = Math.hypot(arrow.vx, arrow.vy) || 1;
  const ux = arrow.vx / speed, uy = arrow.vy / speed;
  const previousTailX = arrow.x - arrow.vx - ux * arrow.length;
  const previousTailY = arrow.y - arrow.vy - uy * arrow.length;
  const currentHeadX = arrow.x + ux * 4;
  const currentHeadY = arrow.y + uy * 4;
  return pointSegmentDistance(playerX, playerY, previousTailX, previousTailY, currentHeadX, currentHeadY) <= PLAYER_RADIUS + 3;
}

function movePlayer(state: GameState, input: PlayerInput) {
  let dx = input.x, dy = input.y;
  const length = Math.hypot(dx, dy);
  if (length) { dx /= length; dy /= length; }
  state.player.x += dx * PLAYER_SPEED;
  state.player.y += dy * PLAYER_SPEED;
  state.player.moveX = dx; state.player.moveY = dy;
  if (input.x) state.player.facing = input.x;
  const fromCenterX = state.player.x - FIELD_X, fromCenterY = state.player.y - FIELD_Y;
  const distance = Math.hypot(fromCenterX, fromCenterY);
  const limit = FIELD_RADIUS - PLAYER_RADIUS - 8;
  if (distance > limit) {
    state.player.x = FIELD_X + fromCenterX / distance * limit;
    state.player.y = FIELD_Y + fromCenterY / distance * limit;
  }
}

export function step(previous: GameState, input: PlayerInput): GameState {
  const state: GameState = {
    ...previous, tick: previous.tick + 1, player: { ...previous.player },
    arrows: previous.arrows.map(arrow => ({ ...arrow })),
  };
  if (state.phase === "ready") {
    if (input.start) { state.phase = "countdown"; state.countdownTicks = COUNTDOWN_TICKS; }
    return state;
  }
  if (state.phase === "gameover") return state;
  if (state.phase === "countdown") {
    state.countdownTicks--;
    if (state.countdownTicks <= 0) { state.phase = "playing"; state.spawnTicks = 22; }
    return state;
  }
  movePlayer(state, input);
  state.survivalTicks++;
  if (--state.spawnTicks <= 0) {
    spawnAttack(state);
  }
  for (const arrow of state.arrows) {
    arrow.x += arrow.vx; arrow.y += arrow.vy; arrow.age++;
    if (arrowHitsPlayer(arrow, state.player.x, state.player.y)) state.phase = "gameover";
  }
  state.arrows = state.arrows.filter(arrow => arrow.age < 900 &&
    !(arrow.age > 35 && Math.hypot(arrow.x - FIELD_X, arrow.y - FIELD_Y) > FIELD_RADIUS + 90));
  return state;
}
