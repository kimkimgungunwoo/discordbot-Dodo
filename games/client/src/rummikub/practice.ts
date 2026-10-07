import { createGame, copyTable, checkDraft, endTurn, validateTurn, botPlacementSteps, requireUneditedTable, TURN_MS, BOT_THINK_MS, BOT_TILE_MS, BOT_SETTLE_MS, BOT_FINAL_TURN_MS, type View, type Seat } from "../../../shared/rummikub";
import { botTurn } from "../../../shared/rummikub-bot";
import { settledScores } from "../../../shared/rummikub";

/** Offline practice adapter; multiplayer state is always owned by RummikubRoom. */
export class LocalGame {
  readonly state;
  readonly seats: Seat[];
  private draft: number[][] = [];
  private revision = 0;
  private deadline = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private botTimer?: ReturnType<typeof setTimeout>;
  constructor(count: number, readonly difficulty: "normal" | "hard", readonly receive: (view: View) => void, readonly notify: (message: string) => void) {
    this.state = createGame(count);
    this.seats = Array.from({ length: count }, (_, i) => i ? { userId: null, name: `도도봇 ${i}`, bot: difficulty } : { userId: "local", name: "나" });
  }
  start() { this.next(); }
  private emit() {
    const s = this.state;
    const placed = new Set(this.draft.flat());
    this.receive({ type: "RUMMI_STATE", matchId: "practice", revision: this.revision, turnId: s.round, seat: 0,
      seats: this.seats.map((seat, i) => ({ ...seat, count: s.hands[i].filter(id => !placed.has(id)).length, opened: s.opened[i], connected: true })),
      hand: [...s.hands[0]], table: copyTable(this.draft), original: copyTable(s.table), turn: s.turn, pileCount: s.pile.length,
      stalledTurns: s.passes, stallLimit: s.hands.length * 2, endReason: s.finished ? s.winner === null ? "stalled" : "empty_hand" : null,
      deadline: this.deadline, serverNow: Date.now(), started: true, finished: s.finished, winner: s.winner, scores: settledScores(s.scores, s.winner, this.seats) });
  }
  action(action: string, table?: number[][]) {
    if (this.state.turn !== 0 || this.state.finished) return;
    try {
      if (Date.now() >= this.deadline) { this.timeout(); return; }
      if (action === "draft") { checkDraft(this.state, table); this.draft = copyTable(table); }
      else if (action === "reset") this.draft = copyTable(this.state.table);
      else if (action === "draw") {
        requireUneditedTable(this.state.table, this.draft);
        endTurn(this.state, this.state.table, true); this.next(); return;
      }
      else if (action === "commit") {
        const error = validateTurn(this.state, this.draft);
        if (error) throw new Error(error + " 배치를 수정하거나 '턴 초기화'를 눌러주세요.");
        endTurn(this.state, this.draft); this.next(); return;
      }
      this.revision++; this.emit();
    } catch (error) { this.revision++; this.emit(); this.notify((error as Error).message); }
  }
  private timeout() {
    const edited = JSON.stringify(this.draft) !== JSON.stringify(this.state.table);
    const error = validateTurn(this.state, this.draft);
    if (edited && error) {
      this.deadline = Date.now() + 15_000;
      clearTimeout(this.timer); this.timer = setTimeout(() => this.timeout(), 15_000);
      this.emit(); this.notify(error + " 배치는 유지됩니다. 수정 후 턴을 종료해주세요."); return;
    }
    endTurn(this.state, this.draft, !!error); this.next();
  }
  private next() {
    this.dispose(); this.revision++; this.draft = copyTable(this.state.table); this.deadline = this.state.finished ? 0 : Date.now() + TURN_MS;
    this.emit(); if (this.state.finished) return;
    this.timer = setTimeout(() => this.timeout(), TURN_MS);
    if (this.state.turn) this.botTimer = setTimeout(() => {
      const table = botTurn(this.state, this.difficulty);
      if (!table) { endTurn(this.state, this.state.table, true); this.next(); return; }
      const steps = botPlacementSteps(this.state.table, table);
      const placeNext = (index: number) => {
        if (index === steps.length) { endTurn(this.state, table); this.next(); return; }
        this.draft = steps[index]; this.revision++; this.emit();
        this.botTimer = setTimeout(() => placeNext(index + 1), index === steps.length - 1 ? BOT_SETTLE_MS : BOT_TILE_MS);
      };
      placeNext(0);
    }, this.state.pile.length === 0 && this.state.passes >= this.state.hands.length * 2 - 1 ? BOT_FINAL_TURN_MS : BOT_THINK_MS);
  }
  dispose() { clearTimeout(this.timer); clearTimeout(this.botTimer); }
}
