import type { Spectator } from "../common/spectators";
import { createInitialState, EMPTY_INPUT, step } from "./game";
import type { GameState, PlayerInput } from "./types";

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
  state = createInitialState(1);
  readonly online = false;
  readonly role = "left" as const;
  readonly ready = true;
  readonly stopped = false;
  readonly completed = false;
  readonly rematching = false;
  readonly message = "";
  readonly spectators: Spectator[] = [];
  bestScore = Number(localStorage.getItem("dodo:arrow_dodge:bestScore")) || 0;
  requestStart() {
    if (this.state.phase === "ready") { this.state = step(this.state, { ...EMPTY_INPUT, start: true }); return true; }
    if (this.state.phase === "gameover") { this.state = step(createInitialState(Date.now()), { ...EMPTY_INPUT, start: true }); return true; }
    return false;
  }
  advance(input: PlayerInput) {
    this.state = step(this.state, input);
    const score = Math.round(this.state.survivalTicks * 1000 / 60);
    if (score > this.bestScore) { this.bestScore = score; localStorage.setItem("dodo:arrow_dodge:bestScore", String(score)); }
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
  private serverMatchId = "";
  private seq = 0;
  private sentTick = 0;
  private replayTarget = 0;
  private hydrated = false;
  private startRequested = false;
  private startSent = false;
  private reported = false;
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
          this.confirmed = createInitialState(message.seed); this.state = this.confirmed;
          this.role = message.role; this.seq = message.seq; this.sentTick = message.committedTick;
          this.bestScore = Number.isSafeInteger(message.room.bestScore) ? message.room.bestScore : 0;
          this.replayTarget = message.committedTick; this.frames.clear(); this.inputs.clear();
          this.hydrated = false; this.startRequested = false; this.startSent = false; this.reported = false;
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
          this.message = message.message ?? "생존 기록 저장 중...";
        } else if (message.type === "FINISHED") {
          this.completed = true; this.message = "생존 기록 저장 완료";
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
      this.bestScore = Math.max(this.bestScore, Math.round(this.confirmed.survivalTicks * 1000 / 60));
      if (this.role === "left" && !this.reported && this.socket?.readyState === WebSocket.OPEN) {
        const survivalMs = Math.round(this.confirmed.survivalTicks * 1000 / 60);
        this.socket.send(JSON.stringify({ type: "RESULT", matchId: this.serverMatchId, tick: this.confirmed.tick,
          survivalTicks: this.confirmed.survivalTicks, survivalMs }));
        this.reported = true; this.message = "생존 기록 확인 중...";
      }
      return;
    }
    if (this.role === "spectator" || !this.ready || catchingUp || this.socket?.readyState !== WebSocket.OPEN ||
        (this.confirmed.phase === "ready" && !this.startRequested)) { this.state = this.confirmed; return; }
    while (this.sentTick < this.confirmed.tick + 6) {
      const tick = ++this.sentTick;
      const next = { ...input, start: this.startRequested && !this.startSent };
      if (next.start) this.startSent = true;
      this.inputs.set(tick, next);
      this.socket.send(JSON.stringify({ type: "INPUT", matchId: this.serverMatchId, tick, seq: ++this.seq,
        input: { ...next, jump: false, hit: false } }));
    }
    let predicted = this.confirmed;
    for (let tick = this.confirmed.tick + 1; tick <= this.sentTick; tick++) predicted = step(predicted, this.inputs.get(tick) ?? input);
    this.state = predicted;
  }
}
