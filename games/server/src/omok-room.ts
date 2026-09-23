import { randomInt } from "node:crypto";
import { RelayRoom } from "./volleyball-room.js";
import type { Definition, Peer } from "./protocol.js";
import { freshBoard, place, legalMoves, chooseMove, TURN_LIMIT_MS, TOSS_MS, type BoardState } from "../../shared/omok.js";
import { computeCpuMove } from "./ai-move.js";

function randomLegalMove(state: BoardState): number {
  const choices = legalMoves(state.board, state.turn);
  return choices[randomInt(choices.length)];
}

export class OmokRoom extends RelayRoom {
  state = freshBoard();
  readonly blackSide: "left" | "right" = randomInt(2) ? "left" : "right";
  startsAt: number | null = null;
  turnDeadline: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private turnTimer: ReturnType<typeof setTimeout> | undefined;
  private cpuGeneration = 0;
  private cpuPending = false;
  private cpuController: AbortController | undefined;
  private names = new Map<string, string>();
  constructor(definition: Definition) { super(definition); }
  get turnSide() { return this.state.turn === 1 ? this.blackSide : this.blackSide === "left" ? "right" : "left"; }
  snapshot() {
    return { type: "OMOK_STATE", matchId: this.matchId, room: this.definition, state: this.state,
      blackSide: this.blackSide, startsAt: this.startsAt, turnDeadline: this.turnDeadline, ready: this.ready(), result: this.result, delivered: this.delivered,
      spectators: this.spectators(), players: { left: this.names.get(this.definition.hostId) ?? "1P", right: this.definition.p2Id ? this.names.get(this.definition.p2Id) ?? "2P" : "도도봇" } };
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
  leave(peer: Peer) {
    this.peers.delete(peer);
    if (this.role(peer.id) !== "spectator") { this.dispose(); this.scheduleCpu(); this.scheduleTurnTimeout(); }
    this.presence();
  }
  connectionStatus() {
    if (!this.result) this.broadcast({ type: "OMOK_CONNECTION", ready: this.ready(), remainingSeconds: Math.max(0, Math.ceil((300000 - (Date.now() - this.lastActivity)) / 1000)) });
  }
  move(peer: Peer, message: any) {
    if (message.matchId !== this.matchId || message.revision !== this.state.moves.length) return peer.send({ type: "MOVE_REJECTED", message: "보드가 갱신되었습니다. 다시 착수해주세요." });
    if (this.result || !this.ready() || this.startsAt === null || Date.now() < this.startsAt || this.role(peer.id) !== this.turnSide) return peer.send({ type: "MOVE_REJECTED", message: "지금은 내 차례가 아닙니다." });
    try { this.commit(message.at); }
    catch (error) { peer.send({ type: "MOVE_REJECTED", message: (error as Error).message }); return; }
  }
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
    if (this.timer || this.cpuPending || this.result || !this.ready() || this.startsAt === null || this.definition.mode !== "CPU" || this.turnSide !== "right") return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.ready() || this.result) return;
      const requestState = this.state, requestMatch = this.matchId, generation = this.cpuGeneration;
      this.cpuPending = true;
      this.cpuController = new AbortController();
      void computeCpuMove(requestState, this.definition.difficulty!, this.cpuController.signal).then(move => {
        if (generation !== this.cpuGeneration) return;
        this.cpuPending = false;
        if (!this.ready() || this.result || this.matchId !== requestMatch || this.state !== requestState) return;
        this.commit(move);
      }).catch(() => {
        if (generation !== this.cpuGeneration) return;
        this.cpuPending = false;
        if (!this.ready() || this.result || this.state !== requestState) return;
        this.commit(chooseMove(this.state, "normal"));
      });
    }, Math.max(500, this.startsAt - Date.now() + 500));
    this.timer.unref();
  }
  private scheduleTurnTimeout(force = false) {
    if (this.turnTimer) { if (!force) return; clearTimeout(this.turnTimer); this.turnTimer = undefined; }
    if (this.result || !this.ready() || this.startsAt === null || (this.definition.mode === "CPU" && this.turnSide === "right")) { this.turnDeadline = null; return; }
    const delay = Math.max(0, this.startsAt - Date.now()) + TURN_LIMIT_MS;
    this.turnDeadline = Date.now() + delay;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = undefined;
      if (!this.ready() || this.result) return;
      this.commit(randomLegalMove(this.state));
    }, delay);
    this.turnTimer.unref();
  }
  input(_peer: Peer, _message: any) {}
  report(_peer: Peer, _message: any) {}
  abort(reason: string) { this.dispose(); super.abort(reason); this.presence(); }
  dispose() {
    this.cpuGeneration++; this.cpuPending = false;
    this.cpuController?.abort(); this.cpuController = undefined;
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.turnTimer) clearTimeout(this.turnTimer); this.turnTimer = undefined; this.turnDeadline = null;
  }
}
