import { EVENT_MS,createEventState } from "../../shared/augment-marble-events.js";
import { type MarbleStore, type MarbleSave } from "./augment-marble-store.js";
import { AUGMENT_CATALOG, AUGMENT_SELECTION_MS, removeRetiredAugments, publicAugmentState, type AugmentDefinition } from "../../shared/augment-marble-augments.js";
import { randomInt } from "node:crypto";
import { RelayRoom } from "./volleyball-room.js";
import type { Definition, Peer } from "./protocol.js";
import { drawTurnOrder,ORDER_DRAW_MS,canAct,actingSeat, automaticContinuation, preservesDeadline, applyAction, autoAction, createGame, TURN_MS, type View } from "../../shared/augment-marble.js";

export class AugmentMarbleRoom extends RelayRoom {
  readonly game;
  started = false;
  private readonly readyPlayers = new Set<string>();
  deadline = 0;
  private forgotten = false;
  private emptySince: number | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private botTimer?: ReturnType<typeof setTimeout>;
  constructor(definition: Definition, private readonly catalog: readonly AugmentDefinition[] = AUGMENT_CATALOG, private readonly store?: MarbleStore) { super(definition); this.game = createGame(definition.seats!.map(s => s.name), { catalog, random: () => randomInt(0, 2 ** 32) / 2 ** 32 });drawTurnOrder(this.game,()=>randomInt(0,2**32)/2**32); }
  seat(id: string) { return this.definition.seats!.findIndex(s => s.userId === id); }
  override role(id: string) { return this.seat(id) === 0 ? "left" : this.seat(id) > 0 ? "right" : "spectator"; }
  override ready() { return this.definition.seats!.every(s => s.bot || (this.readyPlayers.has(s.userId!) && [...this.peers].some(p => p.id === s.userId))); }
  override join(peer: Peer) {
    if ([...this.peers].some(p => p.id === peer.id)) throw new Error("이미 다른 창에서 접속 중입니다.");
    if (this.peers.size >= 54) throw new Error("방이 가득 찼습니다.");
    this.peers.add(peer);
    if (this.seat(peer.id) >= 0) this.emptySince = null;
    this.presence();
    if (this.result) peer.send({ type: this.delivered ? "FINISHED" : "RESULT_PENDING", result: this.result });
  }
  snapshot(peer: Peer): View {
    const game = structuredClone(this.game);
    if(this.seat(peer.id)!==actingSeat(game))game.abilities.roll=null;
    if (game.augments) game.augments = publicAugmentState(game.augments, this.seat(peer.id));
    return { type: "MARBLE_STATE", matchId: this.matchId, game, seat: this.seat(peer.id),
      seats: this.definition.seats!.map(s => ({ ...s, connected: !!s.bot || [...this.peers].some(p => p.id === s.userId), ready: !!s.bot || this.readyPlayers.has(s.userId!) })),
      started: this.started, deadline: this.deadline, serverNow: Date.now(), aborted: this.result?.aborted ? this.result.reason : undefined, rematch: this.rematchStatus() };
  }
  override presence() { this.persist(); for (const peer of this.peers) peer.send(this.snapshot(peer)); }
  override leave(peer: Peer) {
    this.peers.delete(peer);
    if (!this.started) this.readyPlayers.delete(peer.id);
    if (![...this.peers].some(p => this.seat(p.id) >= 0)) this.emptySince ??= Date.now();
    this.presence();
  }
  override connectionStatus() { if (!this.result && this.emptySince !== null && Date.now() - this.emptySince >= 300_000) this.abort("모든 플레이어가 접속을 종료했습니다."); }
  override input() {}
  override report() {}
  setReady(peer: Peer, message: { matchId?: unknown; ready?: unknown }) {
    try {
      const seat = this.seat(peer.id);
      if (!this.peers.has(peer) || seat < 0 || this.definition.seats![seat].bot) throw new Error("참가자만 준비할 수 있습니다.");
      if (message.matchId !== this.matchId) throw new Error("최신 대기실을 확인해주세요.");
      if (this.started || this.result) throw new Error("이미 시작되었거나 종료된 게임입니다.");
      if (typeof message.ready !== "boolean") throw new Error("준비 상태가 올바르지 않습니다.");
      if (message.ready) this.readyPlayers.add(peer.id); else this.readyPlayers.delete(peer.id);
      if (this.ready()) {
        this.started = true;
        if (this.game.turnOrder) this.game.orderDrawUntil = Date.now() + ORDER_DRAW_MS;
        this.schedule();
      }
      this.presence();
    } catch (error) { peer.send({ type: "MARBLE_ERROR", message: (error as Error).message }); this.presence(); }
  }
  handle(peer: Peer, message: any) {
    try {
      if(Date.now()<(this.game.orderDrawUntil??0))throw new Error("순서 추첨 중입니다.");
      if (!this.started || this.result || !canAct(this.game,this.seat(peer.id))) throw new Error("자신의 차례에만 조작할 수 있습니다.");
      const simultaneous=this.game.phase==="augment"&&this.game.augmentResume==="round30";
      if(simultaneous&&(!["augment_select","augment_reroll"].includes(message.action)||message.offerId!==this.game.augments?.players[this.seat(peer.id)]?.offer?.id))throw new Error("자신의 증강만 선택할 수 있습니다.");
      if (message.matchId !== this.matchId || message.turnId !== this.game.turnId || (!simultaneous&&message.revision !== this.game.revision)) throw new Error("최신 상태를 확인한 뒤 다시 시도해주세요.");
      if (Date.now() >= this.deadline) { this.timeout(); return; }
      const before = structuredClone(this.game);
      applyAction(this.game, message, () => randomInt(0, 2 ** 32) / 2 ** 32, this.catalog);
      this.schedule(preservesDeadline(before, this.game, message)); this.presence();
    } catch (error) { peer.send({ type: "MARBLE_ERROR", message: (error as Error).message }); this.presence(); }
  }
  timeout() { if (!this.started || this.result) return; const before = structuredClone(this.game), action = autoAction(this.game); applyAction(this.game, action, () => randomInt(0, 2 ** 32) / 2 ** 32, this.catalog); this.schedule(preservesDeadline(before, this.game, action)); this.presence(); }
  private schedule(keepDeadline = false) {
    const previousDeadline = this.deadline;
    this.dispose(); this.lastActivity = Date.now();
    if (this.game.phase === "finished") {
      const winner = this.game.winner!;
      // Win/loss points, independent of the temporary economic balance.
      const scores = this.game.players.map((_, i) => i === winner ? (this.game.players.length - 1) * 10 : -10);
      this.result = { roomId: this.definition.roomId, matchId: this.matchId, winnerId: this.definition.seats![winner].userId, winnerSeat: winner, seatScores: scores, score: { left: scores[0], right: scores[1] }, reason: this.game.reason! };
      this.finishedAt = Date.now(); this.deadline = 0; return;
    }
    const drawDelay=Math.max(0,(this.game.orderDrawUntil??0)-Date.now());
    const duration = this.game.phase === "augment" ? AUGMENT_SELECTION_MS : this.game.phase === "event" ? EVENT_MS : TURN_MS;
    this.deadline = keepDeadline ? previousDeadline : Date.now() + duration+drawDelay;
    this.timer = setTimeout(() => this.timeout(), Math.max(0, this.deadline - Date.now())); this.timer.unref();
    const continuation=automaticContinuation(this.game);
    if(continuation){this.botTimer=setTimeout(()=>{if(this.result)return;applyAction(this.game,continuation,()=>randomInt(0,2**32)/2**32,this.catalog);this.schedule();this.presence()},700+drawDelay);this.botTimer.unref();}
    else if (this.definition.seats![actingSeat(this.game)].bot || this.game.augmentResume==="round30"&&this.game.roundPrism?.pending.some(i=>this.definition.seats![i].bot)) {
      this.botTimer = setTimeout(() => { if (this.result) return; const before = structuredClone(this.game),snapshot=structuredClone(this.game);if(snapshot.augmentResume==="round30")snapshot.augmentSeat=snapshot.roundPrism!.pending.find(i=>this.definition.seats![i].bot)!;const action = autoAction(snapshot, true); applyAction(this.game, action, () => randomInt(0, 2 ** 32) / 2 ** 32, this.catalog); this.schedule(preservesDeadline(before, this.game, action)); this.presence(); }, this.game.phase === "roll" ? 1400+drawDelay : 1000+drawDelay);
      this.botTimer.unref();
    }
  }
  override abort(reason: string) { this.dispose(); super.abort(reason); this.presence(); }
  forget() { this.forgotten = true; this.dispose(); }
  persist() {
    if (this.forgotten) return;
    this.store?.save({ version: 1, definition: this.definition, game: this.game, seed: this.seed, started: this.started, deadline: this.deadline, emptySince: this.emptySince, lastActivity: this.lastActivity, result: this.result, delivered: this.delivered, finishedAt: this.finishedAt, votes: [...this.rematchVotes] });
  }
  restore(saved: MarbleSave) {
    if (saved.game.abilities.schemaVersion !== 2) throw new Error("원본 능력 복원 전의 세이브는 이 규칙으로 이어갈 수 없습니다.");
    delete this.game.turnOrder;delete this.game.orderDrawUntil;
    Object.assign(this.game, saved.game); this.game.world ??= createEventState(this.game.players.length); Object.assign(this, { seed: saved.seed });
    if(this.game.augments){const affected=removeRetiredAugments(this.game.augments,()=>randomInt(0,2**32)/2**32,this.catalog),roll=this.game.abilities.roll;if(roll&&!roll.result&&affected.includes(roll.seat)){roll.min=2;roll.max=roll.restricted?10:12;}}
    this.started = saved.started; this.deadline = saved.deadline; this.lastActivity = saved.lastActivity;
    this.result = saved.result; this.delivered = saved.delivered; this.finishedAt = saved.finishedAt;
    this.emptySince = saved.emptySince ?? Date.now();
    for (const id of saved.votes) this.rematchVotes.add(id);
    if (this.started && !this.result) this.schedule(true);
  }
  dispose() { clearTimeout(this.timer); clearTimeout(this.botTimer); }
}
