import { REFERENCE as R } from './rock-run-reference';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const GAME_SPEED = 2.2;
export const MOTION_SPEED = 1.1;
export const MOTION_HZ = R.fps * MOTION_SPEED;
export const MOTION_PER_TICK = MOTION_HZ * DT;
export const COUNTDOWN_TICKS = 2 * TICK_RATE;
export const PILLAR_TOP = 25;
export const PILLAR_BOTTOM = R.height;
export const PILLAR_WIDTH = 110;
export const DEATH_Y = R.height + 80;
export const TEMPLATE_TAKEOFF_X = -8;
export const FIRST_PILLAR_MIN_FRAMES = 10;
export const FIRST_WIRE_MIN_DELAY_TICKS = 8;
export const MAX_WIRE_REFIRE_Y = 300;

// Original frame units. Names replace literals; the accepted equations and callback order stay unchanged.
export const MOTION = {
  jump: 30, gravity: 3.5, fallingLimit: -20,
  catchVelocity: 15, ropeUpLimit: -30, ropeDownLimit: 30,
  releaseVelocity: 45, releaseGravity: 5.25, releaseHeight: 50,
  releaseScreenX: 70, bodyAngleOffset: 70, releaseAngle: -70,
  hookX: 45, hookY: -35,
} as const;

export const STAGES = [
  { seconds: 25, budget: 8000 }, { seconds: 28, budget: 10000 },
  { seconds: 31, budget: 12000 }, { seconds: 36, budget: 15000 },
  { seconds: 50, budget: 22000 }, { seconds: 66, budget: 33000 },
].map((stage, i) => ({ ...stage, speed: R.speeds[i] * R.fps * GAME_SPEED }));

export function distancePerMotionFrame(stage: number, speed = GAME_SPEED) {
  return R.speeds[stage] * (speed / MOTION_SPEED);
}

// Increment when changing collision or update ordering, even if the numeric settings stay the same.
const PHYSICS_REVISION = 3;
export const PATTERN_SETTINGS = JSON.stringify({
  revision: PHYSICS_REVISION, tickRate: TICK_RATE, gameSpeed: GAME_SPEED, motionSpeed: MOTION_SPEED,
  reference: R, motion: MOTION, pillar: [PILLAR_TOP, PILLAR_BOTTOM, PILLAR_WIDTH],
  deathY: DEATH_Y, takeoff: TEMPLATE_TAKEOFF_X,
  firstPillarFrames: FIRST_PILLAR_MIN_FRAMES, firstWireDelay: FIRST_WIRE_MIN_DELAY_TICKS,
  maxWireRefireY: MAX_WIRE_REFIRE_Y,
});

export function assertPatternSettings(generated: string) {
  if (generated !== PATTERN_SETTINGS) {
    throw new Error('바위달리기 물리 설정과 패턴이 다릅니다. generate-rock-run-patterns.ts를 실행하세요.');
  }
}
