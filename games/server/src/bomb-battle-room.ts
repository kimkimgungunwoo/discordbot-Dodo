import { performance } from "node:perf_hooks";
import { RelayRoom } from "./volleyball-room.js";
import type { Definition, Peer } from "./protocol.js";
import { COUNTDOWN_TICKS, IDLE, TICK_RATE, createGame, settledScores, step, type Input } from "../../shared/bomb-battle.js";
import { botInput } from "../../shared/bomb-battle-bot.js";

export class BombBattleRoom extends RelayRoom {
  game;
  started = false;
  private inputs = new Map<string, { direction: Input["direction"]; at: number; bombs: number[]; turn?: Input["direction"] }>();
  private acknowledgements = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private lastTime = 0;
  private accumulator = 0;
  private emptySince: number | null = null;
  constructor(definition: Definition) { super(definition); this.game = createGame(definition.seats!.length, this.seed); }
  seat(id: string) { return this.definition.seats!.findIndex(s => s.userId === id); }
  override role(id: string) { return this.seat(id) === 0 ? "left" : this.seat(id) > 0 ? "right" : "spectator"; }
  override ready() { return this.definition.seats!.every(s => s.bot || [...this.peers].some(p => p.id === s.userId)); }
  override join(peer: Peer) {
    if ([...this.peers].some(p => p.id === peer.id)) throw new Error("이미 다른 창에서 접속 중입니다.");
    if (this.seat(peer.id) < 0 && [...this.peers].filter(p => this.seat(p.id) < 0).length >= 50) throw new Error("관전 인원이 가득 찼습니다.");
    this.peers.add(peer); if (this.seat(peer.id) >= 0) this.emptySince = null;
    peer.send(this.snapshot(peer));
    if (!this.started && !this.result && this.ready()) {
      this.started = true; this.lastTime = performance.now();
      this.timer = setInterval(() => {
        const now = performance.now(); this.accumulator += Math.min(250, now - this.lastTime); this.lastTime = now;
        let iterations = 0;
        while (this.accumulator >= 1000 / TICK_RATE && iterations++ < 15) { this.advance(); this.accumulator -= 1000 / TICK_RATE; }
      }, 1000 / TICK_RATE); this.timer.unref();
    }
    this.presence();
  }
  snapshot(peer: Peer) {
    return { type: "BOMB_STATE", matchId: this.matchId, state: this.game, seat: this.seat(peer.id), started: this.started, serverNow: Date.now(),
      ack: this.acknowledgements.get(peer.id) ?? 0, seq: this.sequences.get(peer.id) ?? 0, heldDirection: this.game.tick - (this.inputs.get(peer.id)?.at ?? -999) <= 30 ? this.inputs.get(peer.id)?.direction ?? 0 : 0,
      seats: this.definition.seats!.map(s => ({ ...s, connected: !!s.bot || [...this.peers].some(p => p.id === s.userId) })), spectators: this.spectators(), result: this.result, delivered: this.delivered, rematch: this.rematchStatus() };
  }
  override presence() { for (const peer of this.peers) peer.send(this.snapshot(peer)); }
  override leave(peer: Peer) {
    this.peers.delete(peer); this.inputs.delete(peer.id);
    if (![...this.peers].some(p => this.seat(p.id) >= 0)) this.emptySince ??= Date.now();
    this.presence();
  }
  override connectionStatus() { if (!this.result && this.emptySince !== null && Date.now() - this.emptySince >= 300_000) this.abort("모든 참가자가 접속을 종료했습니다."); }
  override input(peer: Peer, message: any) {
    if (this.seat(peer.id) < 0 || !this.started || this.result || message.matchId !== this.matchId) return;
    if (!Number.isSafeInteger(message.seq) || message.seq < 1 || ![0, 1, 2, 3, 4].includes(message.input?.direction) || typeof message.input?.bomb !== "boolean" || (message.input?.turn !== undefined && ![0,1,2,3,4].includes(message.input.turn))) throw new Error("잘못된 폭탄전 입력입니다.");
    const seq = this.sequences.get(peer.id) ?? 0;
    if (message.seq <= seq) return;
    if (message.seq > seq + 120) throw new Error("입력 시퀀스 범위를 벗어났습니다.");
    const old = this.inputs.get(peer.id), bombs = old?.bombs ?? [];
    if (bombs.length >= 8 && message.input.bomb) throw new Error("입력 요청이 너무 많습니다.");
    if (message.input.bomb && this.game.phase === "playing") bombs.push(message.seq);
    this.inputs.set(peer.id, { direction: message.input.direction, at: this.game.tick, bombs, turn: message.input.turn || old?.turn }); this.sequences.set(peer.id, message.seq);
  }
  advance() {
    if (!this.started) return;
    const inputs = this.definition.seats!.map((seat, i): Input => {
      if (seat.bot) return this.result ? IDLE : botInput(this.game, i, seat.bot);
      const queued = this.inputs.get(seat.userId!);
      if (!queued) return IDLE;
      const bombSeq = queued.bombs.shift();
      const turn = queued.turn; queued.turn = 0;
      const lastSeq = this.sequences.get(seat.userId!) ?? 0;
      // Do not acknowledge past an installation still waiting in the queue.
      this.acknowledgements.set(seat.userId!, queued.bombs.length ? Math.min(lastSeq, queued.bombs[0] - 1) : lastSeq);
      return { direction: this.game.tick - queued.at <= 30 ? queued.direction : 0, bomb: bombSeq !== undefined, bombSeq, turn };
    });
    this.game = step(this.game, inputs); this.lastActivity = Date.now();
    if (!this.result && this.game.phase === "finished") {
      const winner = this.game.winner, scores = settledScores(winner, this.definition.seats!);
      this.result = { roomId: this.definition.roomId, matchId: this.matchId, winnerSeat: winner, winnerId: winner === null ? null : this.definition.seats![winner].userId,
        winnerSide: winner === null ? "draw" : undefined, seatScores: scores, score: { left: scores[0], right: scores[1] }, elapsedMs: Math.round((this.game.tick - COUNTDOWN_TICKS) * 1000 / TICK_RATE) };
      this.finishedAt = Date.now();
    }
    if (this.game.tick % 3 === 0 || this.game.events.length) this.presence();
    // Keep rendering KO -> ghost for five seconds, then stop simulation.
    if (this.result && this.game.tick >= Math.max(...this.game.players.map(p => p.eliminatedAt ?? 0)) + 301) this.dispose();
  }
  override report() { /* Results are exclusively authoritative. */ }
  override abort(reason: string) { this.dispose(); super.abort(reason); this.presence(); }
  dispose() { clearInterval(this.timer); }
}
