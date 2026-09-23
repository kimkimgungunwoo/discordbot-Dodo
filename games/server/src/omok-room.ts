import { randomInt } from "node:crypto";
import { RelayRoom } from "./volleyball-room.js";
import type { Definition, Peer } from "./protocol.js";
import { freshBoard, place, TURN_LIMIT_MS, TOSS_MS, type Stone } from "../../shared/omok.js";
import { computeCpuMove } from "./ai-move.js";

function randomLegalMove(board: Stone[]): number {
  const empty: number[] = [];
  board.forEach((stone, at) => { if (!stone) empty.push(at); });
  return empty[randomInt(empty.length)];
}

/** Authentication, rematch votes and result delivery share the volleyball lifecycle. */
export class OmokRoom extends RelayRoom {
  state = freshBoard();
  readonly blackSide: "left" | "right" = randomInt(2) ? "left" : "right";
  startsAt: number | null = null;
  turnDeadline: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private turnTimer: ReturnType<typeof setTimeout> | undefined;
  private names = new Map<string, string>();
  constructor(definition: Definition) { super(definition); }
  get turnSide() { return this.state.turn === 1 ? this.blackSide : this.blackSide === "left" ? "right" : "left"; }
  snapshot() {
    return { type: "OMOK_STATE", matchId: this.matchId, room: this.definition, state: this.state,
      blackSide: this.blackSide, startsAt: this.startsAt, turnDeadline: this.turnDeadline, ready: this.ready(), result: this.result, delivered: this.delivered,
      players: { left: this.names.get(this.definition.hostId) ?? "1P", right: this.definition.p2Id ? this.names.get(this.definition.p2Id) ?? "2P" : "도도봇" } };
  }
  join(peer: Peer) {
    if ([...this.peers].some(p => p.id === peer.id)) throw new Error("이미 다른 창에서 접속 중입니다.");
    if (this.role(peer.id) === "spectator" && [...this.peers].filter(p => this.role(p.id) === "spectator").length >= 50) throw new Error("관전 인원이 가득 찼습니다.");
    this.peers.add(peer); this.names.set(peer.id, peer.name);
    peer.send({ type: "OMOK_JOIN", role: this.role(peer.id), userId: peer.id });
    if (this.ready() && this.startsAt === null) this.startsAt = Date.now() + TOSS_MS;
    this.scheduleCpu(); this.scheduleTurnTimeout(); this.presence();
  }
  presence() { this.broadcast(this.snapshot()); }
  leave(peer: Peer) { this.peers.delete(peer); this.dispose(); this.scheduleCpu(); this.scheduleTurnTimeout(); this.presence(); }
  connectionStatus() {
    if (!this.result) this.broadcast({ type: "OMOK_CONNECTION", ready: this.ready(), remainingSeconds: Math.max(0, Math.ceil((300000 - (Date.now() - this.lastActivity)) / 1000)) });
  }
  move(peer: Peer, message: any) {
    if (message.matchId !== this.matchId || message.revision !== this.state.moves.length) return peer.send({ type: "MOVE_REJECTED", message: "보드가 갱신되었습니다. 다시 착수해주세요." });
    if (this.result || !this.ready() || this.startsAt === null || Date.now() < this.startsAt || this.role(peer.id) !== this.turnSide) return peer.send({ type: "MOVE_REJECTED", message: "지금은 내 차례가 아닙니다." });
    try { this.commit(message.at); }
    catch (error) { peer.send({ type: "MOVE_REJECTED", message: (error as Error).message }); return; }
  }
  // 다음 차례를 위한 CPU/타이머 예약은 반드시 presence() 브로드캐스트 전에 끝내야 한다 —
  // 그래야 그 브로드캐스트에 이번에 새로 잡은 turnDeadline이 실려 나간다(순서가 바뀌면 클라이언트가
  // 계속 옛 값을 받아 게이지가 안 줄어든다).
  private commit(at: number) {
    this.state = place(this.state, at); this.lastActivity = Date.now();
    if (this.state.winner || this.state.draw) {
      const winnerSide = this.state.draw ? "draw" : this.state.winner === 1 ? this.blackSide : this.blackSide === "left" ? "right" : "left";
      this.result = { roomId: this.definition.roomId, matchId: this.matchId, winnerSide,
        winnerId: winnerSide === "left" ? this.definition.hostId : winnerSide === "right" ? this.definition.p2Id : null,
        score: { left: winnerSide === "left" ? 1 : 0, right: winnerSide === "right" ? 1 : 0 } };
      this.finishedAt = Date.now(); this.dispose();
    } else {
      this.scheduleCpu(); this.scheduleTurnTimeout(true);
    }
    this.presence();
  }
  private scheduleCpu() {
    if (this.timer || this.result || !this.ready() || this.startsAt === null || this.definition.mode !== "CPU" || this.turnSide !== "right") return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.ready() || this.result) return;
      const requestState = this.state, requestMatch = this.matchId;
      void computeCpuMove(requestState, this.definition.difficulty!).then(move => {
        // 계산하는 동안 경기가 끝나거나 재대결로 바뀌었을 수 있다 — 그럼 이 수는 버린다.
        if (this.result || this.matchId !== requestMatch || this.state !== requestState) return;
        this.commit(move);
      }, () => {});
    }, Math.max(500, this.startsAt - Date.now() + 500));
    this.timer.unref();
  }
  // force=true는 방금 수가 놓여 차례가 바뀌었을 때 — 기존 타이머를 반드시 버리고 새로 잡는다.
  // force 없이 호출되면(재접속 등) 이미 도는 타이머는 그대로 두고, 없을 때만 새로 시작한다.
  private scheduleTurnTimeout(force = false) {
    if (this.turnTimer) { if (!force) return; clearTimeout(this.turnTimer); this.turnTimer = undefined; }
    if (this.result || !this.ready() || this.startsAt === null || (this.definition.mode === "CPU" && this.turnSide === "right")) { this.turnDeadline = null; return; }
    const delay = Math.max(0, this.startsAt - Date.now()) + TURN_LIMIT_MS;
    this.turnDeadline = Date.now() + delay;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = undefined;
      if (!this.ready() || this.result) return;
      this.commit(randomLegalMove(this.state.board));
    }, delay);
    this.turnTimer.unref();
  }
  // Volleyball INPUT/RESULT must never mutate an authoritative gomoku room.
  input(_peer: Peer, _message: any) {}
  report(_peer: Peer, _message: any) {}
  abort(reason: string) { this.dispose(); super.abort(reason); this.presence(); }
  dispose() {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.turnTimer) clearTimeout(this.turnTimer); this.turnTimer = undefined; this.turnDeadline = null;
  }
}
