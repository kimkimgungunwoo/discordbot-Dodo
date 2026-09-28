export interface PlayerInput { x: -1 | 0 | 1; y: -1 | 0 | 1; start?: boolean }
export interface Player {
  x: number; y: number; facing: -1 | 1; moveX: number; moveY: number;
}
export interface Arrow {
  id: number; x: number; y: number; vx: number; vy: number; length: number; age: number;
}
export interface GameState {
  tick: number;
  phase: "ready" | "countdown" | "playing" | "gameover";
  countdownTicks: number;
  survivalTicks: number;
  spawnTicks: number;
  wave: number;
  barragePending: boolean;
  rng: number;
  nextArrowId: number;
  player: Player;
  arrows: Arrow[];
}
