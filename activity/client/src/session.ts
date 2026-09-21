import { computeAiInput } from "./game/ai";
import { createInitialState, step } from "./game/physics";
import type { GameEvent, GameState, PlayerInput, Side } from "./game/types";

export interface Participant {
  id: string;
  displayName: string;
  isCpu: boolean;
}

export interface SessionInfo {
  mode: "practice" | "online";
  localPlayerId: string;
  hostPlayerId: string;
  ready: boolean;
  players: Record<Side, Participant>;
}
export interface GameSession {
  readonly message?: string;
  readonly stopped?: boolean;
  readonly rematching?: boolean;
  readonly canRematch?: boolean;
  readonly info: SessionInfo;
  readonly state: GameState;
  readonly started: boolean;
  readonly matchId: number;
  requestStart(requesterId: string): boolean;
  advance(input: PlayerInput): void;
  consumeEvents(): GameEvent[];
}
export class PracticeSession implements GameSession {
  readonly info: SessionInfo = {
    mode: "practice", localPlayerId: "local", hostPlayerId: "local", ready: true,
    players: {
      left: { id: "local", displayName: "나", isCpu: false },
      right: { id: "cpu", displayName: "도도봇", isCpu: true },
    },
  };
  state = createInitialState(0);
  started = false;
  matchId = 0;
  private events: GameEvent[] = [];
  consumeEvents() { const events = this.events; this.events = []; return events; }
  requestStart(requesterId: string) {
    if (requesterId !== this.info.hostPlayerId || !this.info.ready || (this.started && this.state.phase !== "gameover")) return false;
    this.matchId++;
    this.events = [];
    this.state = createInitialState(this.matchId - 1);
    this.started = true;
    return true;
  }
  advance(input: PlayerInput) {
    if (!this.started) return;
    this.state = step(this.state, input, computeAiInput(this.state, this.state.right));
    this.events.push(...this.state.events);
  }
}
