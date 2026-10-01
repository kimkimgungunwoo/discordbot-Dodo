import type { RunMode } from "../../../shared/rock-run";
function readBest(mode: RunMode) { try { const raw=localStorage.getItem(`dodo:rock_run:${mode}:best`) ?? (mode==='normal'?localStorage.getItem('dodo:rock_run:bestScore'):null); const n=Number(raw); return Number.isSafeInteger(n) && n >= 0 ? n : 0; } catch { return 0; } }
import type { Spectator } from "../common/spectators";
import { createInitialState, EMPTY_INPUT, step } from "../../../shared/rock-run";
import type { RunState as GameState, RunInput as PlayerInput } from "../../../shared/rock-run";
import { ActionInput } from './input';

interface Frame { tick: number; left: PlayerInput & { jump?: boolean; hit?: boolean }; right: null }

export interface Session {
  state: GameState;
  readonly online: boolean;
  readonly role: "left" | "spectator";
  readonly ready: boolean;
  readonly stopped: boolean;
  readonly completed: boolean;
  readonly rematching: boolean;
  readonly message: string;
  readonly spectators: Spectator[];
  readonly bestScore: number;
  requestStart(): boolean;
  advance(input: PlayerInput): void;
}

export class PracticeSession implements Session {
  state;
  readonly online = false;
  readonly role = "left" as const;
  readonly ready = true;
  readonly stopped = false;
  readonly completed = false;
  readonly rematching = false;
  readonly message = "";
  readonly spectators: Spectator[] = [];
  bestScore;
  constructor(private mode: RunMode = 'normal') { this.state=createInitialState(Date.now(),mode); this.bestScore=readBest(mode); }
  requestStart() {
    if (this.state.phase === "ready") { this.state = step(this.state, { ...EMPTY_INPUT, start: true }); return true; }
    if (this.state.phase === "gameover") { this.state = step(createInitialState(Date.now(),this.mode), { ...EMPTY_INPUT, start: true }); return true; }
    return false;
  }
  advance(input: PlayerInput) {
    this.state = step(this.state, input);
    const score = this.state.mode === 'endless' ? Math.round(this.state.elapsed * 1000 / 60) : this.state.score;
    if (this.state.phase === "gameover" && score > this.bestScore) { this.bestScore = score; try { localStorage.setItem(`dodo:rock_run:${this.mode}:best`, String(score)); } catch {} }
  }
}

export class OnlineSession implements Session {
  state = createInitialState(1);
  private confirmed = this.state;
  readonly online = true;
  role: "left" | "spectator" = "spectator";
  ready = false;
  stopped = false;
  completed = false;
  rematching = false;
  message = "서버 연결 중";
  spectators: Spectator[] = [];
  bestScore = 0;
  private socket: WebSocket | null = null;
  private frames = new Map<number, Frame>();
  private inputs = new Map<number, PlayerInput>();
  // Consume an edge only when it has a tick to send, even during a delayed acknowledgement.
  private pendingAction = new ActionInput();
  private serverMatchId = "";
  private seq = 0;
  private sentTick = 0;
  private replayTarget = 0;
  private hydrated = false;
  private startRequested = false;
  private startSent = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private roomId: string, private token: string) { this.connect(); }

  private connect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const previous = this.socket; this.socket = null; previous?.close();
    const url = new URL("/ws", location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url); this.socket = socket;
    socket.onopen = () => this.socket === socket && socket.send(JSON.stringify({ type: "AUTH", roomId: this.roomId, token: this.token }));
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "GAME_START") {
          this.serverMatchId = message.matchId ?? message.room.matchId;
          this.confirmed = createInitialState(message.seed, message.room.runMode ?? 'normal'); this.state = this.confirmed;
          this.role = message.role; this.seq = message.seq; this.sentTick = message.committedTick;
          this.bestScore = Number.isSafeInteger(message.room.bestScore) ? message.room.bestScore : 0;
          this.replayTarget = message.committedTick; this.frames.clear(); this.inputs.clear();
          this.hydrated = false; this.startRequested = false; this.startSent = false;
          this.pendingAction.reset();
          this.completed = false; this.rematching = false; this.stopped = false;
        } else if (message.type === "HISTORY") {
          for (const frame of message.frames) this.frames.set(frame.tick, frame);
        } else if (message.type === "FRAME") {
          this.frames.set(message.frame.tick, message.frame);
        } else if (message.type === "CAUGHT_UP") {
          this.hydrated = true;
        } else if (message.type === "PRESENCE") {
          this.ready = message.ready; this.spectators = message.spectators ?? [];
          if (!this.completed) this.message = this.role === "spectator" ? "관전 중" : message.ready ? "" : "플레이어 연결 대기";
        } else if (message.type === "CONNECTION_STATUS" && !this.completed && message.waitingFor?.length) {
          this.message = `연결 복구 대기 · ${message.remainingSeconds}초`;
        } else if (message.type === "RESULT_PENDING") {
          this.message = message.message ?? "점수 저장 중...";
        } else if (message.type === "FINISHED") {
          this.completed = true; this.message = "점수 저장 완료";
        } else if (message.type === "MATCH_REPLACED") {
          this.connect();
        } else if (message.type === "ROOM_CLOSED") {
          this.stopped = true; this.message = message.message; socket.close();
        } else if (message.type === "ERROR") {
          this.stopped = Boolean(message.terminal); this.message = message.message;
        }
      } catch { this.stopped = true; this.message = "서버 메시지를 처리하지 못했습니다."; socket.close(); }
    };
    socket.onclose = () => {
      if (this.socket !== socket || this.stopped || this.completed || this.rematching) return;
      this.ready = false; this.message = "연결이 끊겼습니다. 재연결 중";
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
  }

  requestStart() {
    if (this.role !== "left" || !this.ready || this.stopped) return false;
    if (this.confirmed.phase === "ready" && !this.startRequested) { this.startRequested = true; return true; }
    if (this.confirmed.phase !== "gameover" || !this.completed || this.rematching) return false;
    this.rematching = true; this.message = "다시 시작하는 중";
    void fetch("/api/rematch", {
      method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + this.token },
      body: JSON.stringify({ roomId: this.roomId, matchId: this.serverMatchId }), signal: AbortSignal.timeout(12000),
    }).then(async response => {
      if (!response.ok) throw new Error((await response.json()).error ?? "다시 시작하지 못했습니다.");
      this.connect();
    }).catch(error => { this.rematching = false; this.message = error instanceof Error ? error.message : "다시 시작하지 못했습니다."; });
    return true;
  }

  advance(input: PlayerInput) {
    if (!this.hydrated || this.stopped) return;
    const catchingUp = this.confirmed.tick < this.replayTarget;
    const count = catchingUp ? 240 : 1;
    for (let index = 0; index < count; index++) {
      const frame = this.frames.get(this.confirmed.tick + 1);
      if (!frame || this.confirmed.phase === "gameover") break;
      this.frames.delete(frame.tick); this.inputs.delete(frame.tick);
      this.confirmed = step(this.confirmed, frame.left);
    }
    if (this.confirmed.phase === "gameover") {
      this.state = this.confirmed;
      this.bestScore = Math.max(this.bestScore, this.confirmed.mode === 'endless' ? Math.round(this.confirmed.elapsed * 1000 / 60) : this.confirmed.score);
      this.pendingAction.reset();
      return;
    }
    if (this.role === "spectator" || !this.ready || catchingUp || this.socket?.readyState !== WebSocket.OPEN ||
        (this.confirmed.phase === "ready" && !this.startRequested)) { this.state = this.confirmed; return; }
    this.pendingAction.set(input.hit);
    while (this.sentTick < this.confirmed.tick + 6) {
      const tick = ++this.sentTick;
      const next = { hit: this.pendingAction.next(), start: this.startRequested && !this.startSent };
      if (next.start) this.startSent = true;
      this.inputs.set(tick, next);
      this.socket.send(JSON.stringify({ type: "INPUT", matchId: this.serverMatchId, tick, seq: ++this.seq,
        input: { ...next, x: 0, y: 0, jump: false } }));
    }
    let predicted = this.confirmed;
    for (let tick = this.confirmed.tick + 1; tick <= this.sentTick; tick++) predicted = step(predicted, this.inputs.get(tick) ?? input);
    this.state = predicted;
  }
}
