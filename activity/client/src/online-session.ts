import { computeAiInput, parseDifficulty, DIFFICULTY_LABELS, type AiDifficulty } from "./game/ai";
import { createInitialState, step } from "./game/physics";
import type { GameEvent, GameState, PlayerInput, Side } from "./game/types";
import type { GameSession, SessionInfo } from "./session";

const EMPTY_INPUT: PlayerInput = { x: 0, y: 0, jump: false, hit: false };

interface Frame { tick: number; left: PlayerInput; right: PlayerInput | null }
export class OnlineSession implements GameSession {
  info: SessionInfo = {
    mode: "online", localPlayerId: "", hostPlayerId: "", ready: false,
    players: { left: { id: "", displayName: "1P", isCpu: false }, right: { id: "", displayName: "2P", isCpu: false } },
  };
  // state는 화면에 그릴 "예측" 상태 — 서버 왕복 없이 내 입력을 즉시 반영해서 보여준다.
  state = createInitialState(0);
  // confirmed는 서버가 실제로 확정한 프레임만으로 진행되는 진짜 상태 — 결과 판정/전송은 항상 이걸로 한다.
  private confirmed = createInitialState(0);
  started = false;
  matchId = 1;
  private serverMatchId = "";
  get stopped() { return this.terminal; }
  message = "서버 연결 중";
  role: Side | "spectator" = "spectator";
  private socket: WebSocket | null = null;
  private frames = new Map<number, Frame>();
  private myInputs = new Map<number, PlayerInput>();
  private lastOpponentInput: PlayerInput = EMPTY_INPUT;
  private seq = 0;
  private sentTick = 0;
  private replayTarget = 0;
  private cpu = false;
  private difficulty: AiDifficulty = "normal";
  private hydrated = false;
  private terminal = false;
  private completed = false;
  private retryUntil = 0;
  private rematchError = "";
  private rematchPending = false;
  private reported = false;
  private events: GameEvent[] = [];
  constructor(private roomId: string, private token: string) { this.connect(); }
  private connect() {
    if (this.rematchPending) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    const url = new URL("/ws", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => this.socket === socket && socket.send(JSON.stringify({ type: "AUTH", roomId: this.roomId, token: this.token }));
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "GAME_START") {
          this.serverMatchId = message.matchId ?? message.room.matchId ?? "";
          this.matchId++;
          this.info.ready = false;
          this.rematchError = ""; this.retryUntil = 0; this.terminal = false;
          this.frames.clear(); this.myInputs.clear(); this.lastOpponentInput = EMPTY_INPUT;
          this.events = []; this.reported = false; this.hydrated = false; this.completed = false; this.rematching = false;
          this.confirmed = createInitialState(message.seed);
          this.state = this.confirmed;
          this.started = false; this.role = message.role;
          this.seq = message.seq; this.sentTick = message.committedTick;
          this.replayTarget = message.committedTick; this.cpu = message.room.mode === "CPU";
          this.difficulty = parseDifficulty(message.room.difficulty);
          this.info.localPlayerId = message.userId; this.info.hostPlayerId = message.room.hostId;
          this.info.players.left = { id: message.room.hostId, displayName: "1P", isCpu: false };
          this.info.players.right = { id: message.room.p2Id ?? "cpu", displayName: this.cpu ? `도도봇 · ${DIFFICULTY_LABELS[this.difficulty]}` : "2P", isCpu: this.cpu };
        } else if (message.type === "HISTORY") {
          for (const frame of message.frames) this.frames.set(frame.tick, frame);
        } else if (message.type === "FRAME") {
          this.frames.set(message.frame.tick, message.frame);
          // 상대가 실제로 보낸 입력을 다음 예측의 "일단 이걸로 가정" 값으로 기억해둔다.
          const theirs = this.role === "left" ? message.frame.right : message.frame.left;
          if (theirs) this.lastOpponentInput = theirs;
        }
        else if (message.type === "CAUGHT_UP") this.hydrated = true;
        else if (message.type === "PRESENCE") {
          if (message.ready && !this.info.ready) this.sentTick = message.committedTick;
          this.info.ready = message.ready;
          if (!this.completed && !this.reported) this.message = message.ready ? (this.role === "spectator" ? "관전 중" : "") : "플레이어 연결을 기다리는 중";
          for (const participant of message.players) for (const side of ["left", "right"] as const) {
            if (this.info.players[side].id === participant.id) this.info.players[side].displayName = participant.displayName;
          }
        } else if (message.type === "CONNECTION_STATUS") {
          if (!this.completed) {
            const names = message.waitingFor.map((id: string) => Object.values(this.info.players).find(player => player.id === id)?.displayName ?? "플레이어");
            this.message = names.length ? `${names.join(", ")} 연결 또는 입력 대기 · ${message.remainingSeconds}초 후 중단` : (this.role === "spectator" ? "관전 중" : "");
          }
        } else if (message.type === "MATCH_REPLACED") {
          this.connect();
        } else if (message.type === "ROOM_CLOSED") {
          this.terminal = true; this.completed = false; this.rematching = false;
          this.message = message.message;
          if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
          socket.close();
        } else if (message.type === "RESULT_PENDING") {
          this.message = message.message ?? "경기 결과 저장 중...";
          if (message.result?.aborted) {
            this.state = this.confirmed = { ...this.confirmed, phase: "gameover", winner: null };
            this.started = true;
          }
        }
        else if (message.type === "FINISHED") {
          // 종료 후 연결을 유지한다. 새 경기는 MATCH_REPLACED 알림으로 따라간다.
          this.completed = true;
          this.message = message.result?.aborted ? (message.result.reason ?? "경기가 중단되었습니다.") : "경기 종료 · 재대결을 기다리는 중";
          if (message.result?.aborted) {
            this.state = this.confirmed = { ...this.confirmed, phase: "gameover", winner: null };
            this.started = true;
          }
        } else if (message.type === "ERROR") {
          // 요청 제한은 대기 후 재접속하고, 영구 오류는 종료 상태에서도 그대로 표시한다.
          if (Number.isFinite(message.retryAfter) && message.retryAfter > 0) {
            this.retryUntil = Date.now() + message.retryAfter * 1000;
            this.rematchError = message.message;
          }
          this.terminal = Boolean(message.terminal);
          this.message = this.rematchError || message.message;
        }
      } catch {
        this.terminal = true; this.message = "서버 메시지를 처리하지 못했습니다."; socket.close();
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.info.ready = false;
      if (!this.terminal) {
        if (!this.completed && !this.rematchError) this.message = "연결이 끊겼습니다. 재연결 중";
        this.scheduleReconnect(1500);
      }
    };
  }
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleReconnect(delay: number) {
    if (this.reconnectTimer || this.rematchPending) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.terminal) this.connect();
    }, Math.max(delay, this.retryUntil - Date.now()));
  }
  rematching = false;
  get canRematch() {
    return !this.terminal && this.completed && !this.rematching && Date.now() >= this.retryUntil;
  }
  requestStart(requesterId: string) {
    const isPlayer = requesterId === this.info.hostPlayerId ||
      (!this.info.players.right.isCpu && requesterId === this.info.players.right.id);
    if (!isPlayer || !this.canRematch) return false;
    // 클릭한 "즉시" 대기 중인 자동 재연결 타이머를 지운다 — /api/rematch 응답(Discord API 왕복 포함)이
    // 늦어지는 동안 타이머가 먼저 발동해 옛(재대결 전) 방으로 소켓을 하나 더 여는 레이스를 막기 위함.
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.rematchPending = true;
    // 소켓은 여기서 끊지 않는다 — 200(진짜 재시작)인지 202(상대 투표 대기중)인지 모르는 채로 끊으면
    // PVP에서 아직 투표 대기 중인 플레이어가 상대 투표 시 오는 MATCH_REPLACED를 못 받는다.
    // connect()가 자기 차례에 기존 소켓을 알아서 닫으니, 실제로 재시작이 확정된 뒤(200)에만 호출한다.
    this.rematchError = "";
    this.rematching = true;
    this.message = "재대결을 시작하는 중";
    fetch("/api/rematch", {
      method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + this.token },
      body: JSON.stringify({ roomId: this.roomId, matchId: this.serverMatchId }),
      signal: AbortSignal.timeout(12000),
    })
      .then(response => {
        this.rematchPending = false;
        if (response.status === 202) {
          this.message = "재대결 투표함 · 상대방 응답을 기다리는 중";
          this.rematching = false;
          this.scheduleReconnect(1500); // 상대가 투표하면 완성될 수 있으니 계속 재시도한다.
          return;
        }
        if (!response.ok) return response.json().then(body => {
          this.rematchError = body.error ?? "재대결을 시작하지 못했습니다.";
          this.message = this.rematchError;
          if (response.status === 429) {
            const seconds = Number(body.retryAfter ?? response.headers?.get("Retry-After") ?? 5);
            this.retryUntil = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 5) * 1000;
          }
          this.rematching = false;
          this.scheduleReconnect(1500);
        });
        // 성공(200) — 여기서 rematching을 끄지 않는다. HTTP 응답과 실제 재입장(GAME_START) 사이에
        // 시간차가 있어서, 여기서 끄면 그 잠깐 사이에 "재경기" 버튼/종료 화면이 다시 번쩍 뜬다.
        // 진짜 새 경기가 시작될 때(GAME_START)까지 켜둔 채로 두고, 그때 거기서 끈다.
        this.connect();
      })
      .catch(() => { this.rematchPending = false; this.rematchError = "재대결을 시작하지 못했습니다. 다시 시도해주세요."; this.message = this.rematchError; this.rematching = false; this.scheduleReconnect(1500); });
    return true;
  }
  consumeEvents() { const events = this.events; this.events = []; return events; }
  advance(input: PlayerInput) {
    if (!this.hydrated || (this.terminal && !this.completed)) return;
    const catchingUp = this.confirmed.tick < this.replayTarget;
    const count = catchingUp ? 240 : this.frames.size > 12 ? 4 : 1;
    for (let index = 0; index < count; index++) {
      const frame = this.frames.get(this.confirmed.tick + 1);
      if (!frame || this.confirmed.phase === "gameover") break;
      this.frames.delete(frame.tick);
      this.myInputs.delete(frame.tick);
      const right = this.cpu ? computeAiInput(this.confirmed, this.confirmed.right, this.difficulty) : frame.right!;
      this.confirmed = step(this.confirmed, frame.left, right);
      if (!catchingUp) this.events.push(...this.confirmed.events);
      this.started = true;
    }
    if (this.confirmed.phase === "gameover") {
      this.state = this.confirmed;
      if (!this.completed && this.role !== "spectator" && !this.reported && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "RESULT", matchId: this.serverMatchId, tick: this.confirmed.tick, score: { left: this.confirmed.left.score, right: this.confirmed.right.score } }));
        this.reported = true;
      }
      return;
    }
    if (!this.info.ready || this.role === "spectator" || catchingUp || this.socket?.readyState !== WebSocket.OPEN) {
      this.state = this.confirmed;
      return;
    }
    while (this.sentTick < this.confirmed.tick + 6) {
      const tick = ++this.sentTick;
      this.myInputs.set(tick, input);
      this.socket.send(JSON.stringify({ type: "INPUT", matchId: this.serverMatchId, tick, seq: ++this.seq, input }));
    }
    // 예측: 확정 상태 위에 "이미 서버로 보낸 내 입력"과 "상대의 마지막 입력(또는 CPU)"을 얹어 앞서 그려본다.
    // 내 쪽은 실제로 보낼 값 그대로라 절대 틀릴 일이 없고, 상대 쪽만 나중에 살짝 보정될 수 있다.
    let predicted: GameState = this.confirmed;
    for (let tick = this.confirmed.tick + 1; tick <= this.sentTick; tick++) {
      const mine = this.myInputs.get(tick) ?? input;
      const theirs = this.cpu ? computeAiInput(predicted, predicted.right, this.difficulty) : this.lastOpponentInput;
      const left = this.role === "left" ? mine : theirs;
      const right = this.role === "right" ? mine : theirs;
      predicted = step(predicted, left, right);
    }
    this.state = predicted;
  }
}
