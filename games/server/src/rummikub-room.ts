import { randomInt } from "node:crypto";
import { RelayRoom } from "./volleyball-room.js";
import type { Definition, Peer } from "./protocol.js";
import { TURN_MS, BOT_THINK_MS, BOT_TILE_MS, BOT_SETTLE_MS, BOT_FINAL_TURN_MS, botPlacementSteps, checkDraft, copyTable, createGame, endTurn, validateTurn, requireUneditedTable, type View } from "../../shared/rummikub.js";
import { botTurn } from "../../shared/rummikub-bot.js";
import { settledScores } from "../../shared/rummikub.js";

export class RummikubRoom extends RelayRoom {
  readonly game;
  draft: number[][] = [];
  revision = 0;
  deadline = 0;
  started = false;
  private emptySince: number | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private botTimer?: ReturnType<typeof setTimeout>;
  constructor(definition: Definition) {
    super(definition);
    this.game = createGame(definition.seats!.length, () => randomInt(0, 2 ** 32) / 2 ** 32);
  }
  seat(id: string) { return this.definition.seats!.findIndex(s => s.userId === id); }
  override role(id: string) { return this.seat(id) === 0 ? "left" : this.seat(id) > 0 ? "right" : "spectator"; }
  override ready() { return this.definition.seats!.every(s => s.bot || [...this.peers].some(p => p.id === s.userId)); }
  override join(peer: Peer) {
    if ([...this.peers].some(p => p.id === peer.id)) throw new Error("이미 다른 창에서 접속 중입니다.");
    if (this.peers.size >= 54) throw new Error("방이 가득 찼습니다.");
    this.peers.add(peer);
    if (this.seat(peer.id) >= 0) this.emptySince = null;
    if (!this.started && !this.result && this.ready()) { this.started = true; this.nextTurn(); }
    else this.presence();
  }
  snapshot(peer: Peer): View {
    const seat = this.seat(peer.id);
    const placed = new Set(this.draft.flat());
    return { type: "RUMMI_STATE", matchId: this.matchId, revision: this.revision, turnId: this.game.round, seat,
      seats: this.definition.seats!.map((s, i) => ({ ...s, count: this.game.hands[i].filter(id => !placed.has(id)).length, opened: this.game.opened[i], connected: !!s.bot || [...this.peers].some(p => p.id === s.userId) })),
      hand: seat < 0 ? [] : [...this.game.hands[seat]], table: copyTable(this.draft), original: copyTable(this.game.table), turn: this.game.turn,
      pileCount: this.game.pile.length, deadline: this.deadline, serverNow: Date.now(), started: this.started,
      stalledTurns: this.game.passes, stallLimit: this.game.hands.length * 2,
      endReason: this.game.finished ? this.game.winner === null ? "stalled" : "empty_hand" : null,
      finished: this.game.finished || !!this.result, winner: this.game.winner, scores: settledScores(this.game.scores, this.game.winner, this.definition.seats!) };
  }
  override presence() { for (const peer of this.peers) peer.send(this.snapshot(peer)); }
  override leave(peer: Peer) {
    this.peers.delete(peer);
    if (![...this.peers].some(p => this.seat(p.id) >= 0)) this.emptySince ??= Date.now();
    this.presence();
  }
  override connectionStatus() {
    if (this.result) return;
    if (this.emptySince !== null && Date.now() - this.emptySince >= 300_000) this.abort("모든 플레이어가 접속을 종료했습니다.");
  }
  override input() { /* Never accept frame inputs or client-reported results. */ }
  override report() {}
  handle(peer: Peer, message: any) {
    try {
      if (this.result || !this.started || this.seat(peer.id) !== this.game.turn) throw new Error("자신의 턴에만 조작할 수 있습니다.");
      if (message.matchId !== this.matchId || message.turnId !== this.game.round || message.revision !== this.revision) throw new Error("상태가 변경되어 최신 배치를 불러왔습니다.");
      if (Date.now() >= this.deadline) { this.timeout(); return; }
      if (message.action === "draft") { checkDraft(this.game, message.table); this.draft = copyTable(message.table); }
      else if (message.action === "reset") this.draft = copyTable(this.game.table);
      else if (message.action === "draw") {
        requireUneditedTable(this.game.table, this.draft);
        endTurn(this.game, this.game.table, true); this.nextTurn(); return;
      }
      else if (message.action === "commit") {
        const error = validateTurn(this.game, this.draft);
        if (error) { this.draft = copyTable(this.game.table); this.revision++; throw new Error(error + " 배치를 턴 시작 상태로 되돌렸습니다."); }
        endTurn(this.game, this.draft); this.nextTurn(); return;
      } else throw new Error("알 수 없는 조작입니다.");
      this.lastActivity = Date.now(); this.revision++; this.presence();
    } catch (error) { peer.send({ type: "RUMMI_ERROR", message: (error as Error).message }); this.presence(); }
  }
  timeout() {
    if (this.result || !this.started) return;
    // A valid draft is committed; an incomplete draft is discarded atomically.
    endTurn(this.game, this.draft, !!validateTurn(this.game, this.draft)); this.nextTurn();
  }
  private nextTurn() {
    this.dispose(); this.lastActivity = Date.now(); this.revision++;
    this.draft = copyTable(this.game.table);
    if (this.game.finished) {
      const winner = this.game.winner;
      const scores = settledScores(this.game.scores, winner, this.definition.seats!);
      this.result = { roomId: this.definition.roomId, matchId: this.matchId, winnerId: winner === null ? null : this.definition.seats![winner].userId,
        score: { left: scores[0], right: scores[1] }, seatScores: scores, winnerSeat: winner };
      this.finishedAt = Date.now(); this.deadline = 0;
    } else {
      this.deadline = Date.now() + TURN_MS;
      this.timer = setTimeout(() => this.timeout(), TURN_MS); this.timer.unref();
      const bot = this.definition.seats![this.game.turn].bot;
      if (bot) {
        this.botTimer = setTimeout(() => {
          const table = botTurn(this.game, bot);
          if (!table) { endTurn(this.game, this.game.table, true); this.nextTurn(); return; }
          const steps = botPlacementSteps(this.game.table, table);
          const placeNext = (index: number) => {
            if (index === steps.length) { endTurn(this.game, table); this.nextTurn(); return; }
            this.draft = steps[index]; this.revision++; this.presence();
            this.botTimer = setTimeout(() => placeNext(index + 1), index === steps.length - 1 ? BOT_SETTLE_MS : BOT_TILE_MS);
            this.botTimer.unref();
          };
          placeNext(0);
        }, this.game.pile.length === 0 && this.game.passes >= this.game.hands.length * 2 - 1 ? BOT_FINAL_TURN_MS : BOT_THINK_MS); this.botTimer.unref();
      }
    }
    this.presence();
  }
  override abort(reason: string) { this.dispose(); super.abort(reason); this.presence(); }
  dispose() { clearTimeout(this.timer); clearTimeout(this.botTimer); }
}
