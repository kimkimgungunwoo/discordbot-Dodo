export type Side = "left" | "right";
export type PlayerState = "idle" | "run" | "jump" | "fall" | "hit" | "spike" | "dive" | "lying" | "win" | "lose";
export interface PlayerInput { x: -1 | 0 | 1; y: -1 | 0 | 1; jump: boolean; hit: boolean }
export interface Player {
  x: number; y: number; yVelocity: number; state: PlayerState;
  ticksInState: number; facing: 1 | -1; isRight: boolean;
  diveDirection: 1 | -1; score: number; hitHeld: boolean; spikeAvailable: boolean;
}
export interface Ball {
  x: number; y: number; xVelocity: number; yVelocity: number;
  contact: Side | null; powerTicks: number;
}
export interface GameEvent {
  kind: "jump" | "hit" | "spike" | "point" | "win";
  x: number; y: number; side: Side;
}
export interface Effect { x: number; y: number; kind: "hit" | "spike"; age: number }
export interface GameState {
  tick: number; phase: "countdown" | "playing" | "point" | "gameover";
  left: Player; right: Player; ball: Ball; phaseTicks: number;
  winner: Side | null; server: Side; events: GameEvent[]; effects: Effect[];
  trail: { x: number; y: number }[];
}
