import { COUNTDOWN_TICKS, copy, explode, install, movePlayer, type Input, type Seat, type State } from '../../../shared/bomb-battle';
export interface Snapshot { type: 'BOMB_STATE'; matchId: string; state: State; seat: number; started: boolean; ack: number; seq: number; heldDirection?: Input["direction"]; seats: (Seat & { connected: boolean })[]; spectators: { id: string; displayName: string; avatarUrl: string | null }[]; result: { seatScores?: number[]; aborted?: boolean; reason?: string } | null; delivered: boolean; rematch?: { matchId: string; votes: string[]; required: number; delivered: boolean } }
interface Pending { seq: number; tick: number; input: Input }
/** Bounded local prediction. Acknowledged inputs never replay after reconnect. */
export class Prediction {
  snapshot: Snapshot | null = null;
  seq = 0;
  pending: Pending[] = [];
  tick = 0;
  receive(snapshot: Snapshot, reset = false) {
    if (snapshot.matchId !== this.snapshot?.matchId) { this.seq = snapshot.seq; this.tick = snapshot.state.tick; }
    if (reset || snapshot.matchId !== this.snapshot?.matchId) this.pending = [];
    this.snapshot = snapshot; this.seq = Math.max(this.seq, snapshot.seq);
    this.pending = this.pending.filter(p => p.seq > snapshot.ack);
    this.tick = Math.max(snapshot.state.tick, Math.min(this.tick, snapshot.state.tick + 12));
  }
  submit(input: Input) {
    const pending = { seq: ++this.seq, tick: this.tick + 1, input: { ...input } };
    this.pending.push(pending); if (this.pending.length > 120) this.pending.shift();
    return pending;
  }
  advance() { if (this.snapshot) this.tick = Math.min(this.tick + 1, this.snapshot.state.tick + 12); }
  view(direction: Input['direction']): State | null {
    const snapshot = this.snapshot; if (!snapshot) return null;
    const original = snapshot.state;
    if (!snapshot.started || snapshot.seat < 0 || snapshot.result) return original;
    let predicted = copy(original);
    const consumed = new Set<number>(), consumedTurns = new Set<number>();
    let held = snapshot.heldDirection ?? 0;
    const targetTick = Math.min(original.tick + 12, Math.max(original.tick + 1, this.tick + 1));
    for (let t = original.tick + 1; t <= targetTick; t++) {
      for (const pending of this.pending) if (Math.max(original.tick + 1, pending.tick) <= t) held = pending.input.direction;
      if (t === targetTick) held = direction;
      const placement = this.pending.find(p => p.input.bomb && !consumed.has(p.seq) && Math.max(original.tick + 1, p.tick) <= t);
      if (placement) consumed.add(placement.seq);
      let turn: Input['direction'] = 0;
      for (const pending of this.pending) if (pending.input.turn && !consumedTurns.has(pending.seq) && Math.max(original.tick + 1, pending.tick) <= t) {
        turn = pending.input.turn; consumedTurns.add(pending.seq);
      }
      // Predict only the controlled player's motion. Speculative explosions
      // must never eliminate idle remote players and stop the local simulation.
      predicted.tick=t;
      if(t<=COUNTDOWN_TICKS || (predicted.phase==='finished' && predicted.players[snapshot.seat].alive)) continue;
      const player=predicted.players[snapshot.seat];
      if(!player.alive && (player.eliminatedAt===null || t-player.eliminatedAt<300)) continue;
      if(placement && predicted.phase!=='finished') install(predicted,snapshot.seat,placement.seq);
      movePlayer(predicted,snapshot.seat,{direction:held,bomb:false,turn});
      explode(predicted);
    }
    const mine = predicted.players[snapshot.seat], authoritative = original.players[snapshot.seat];
    const players = original.players.map(p => ({ ...p }));
    players[snapshot.seat] = { ...authoritative, x: mine.x, y: mine.y, fromX: mine.fromX, fromY: mine.fromY, movedAt: mine.movedAt, nextMove: mine.nextMove, direction: mine.direction };
    return { ...original, tick: targetTick, players,
      bombs: [...original.bombs, ...predicted.bombs.filter(b => b.owner === snapshot.seat && b.inputSeq !== undefined && this.pending.some(p => p.seq === b.inputSeq) && !original.bombs.some(q => q.inputSeq === b.inputSeq && q.owner === b.owner))] };
  }
  disconnect() { this.pending = []; }
}
