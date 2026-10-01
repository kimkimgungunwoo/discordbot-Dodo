import { RelayRoom } from './volleyball-room.js';
import { createInitialState, step } from '../../shared/rock-run.js';
import { TICK_RATE } from '../../shared/rock-run-config.js';
import type { Peer } from './protocol.js';
export class RockRunRoom extends RelayRoom {
  state = createInitialState(this.seed, this.definition.runMode ?? 'normal');
  input(peer: Peer, message: any) {
    super.input(peer, message);
    while (!this.result && this.state.tick < this.history.length) {
      this.state = step(this.state, this.history[this.state.tick].left);
      if (this.state.phase === 'gameover') {
        const elapsedMs = Math.round(this.state.elapsed * 1000 / TICK_RATE);
        this.result = { matchId: this.matchId, roomId: this.definition.roomId, winnerId: this.definition.hostId,
          score: { left: this.state.mode === 'endless' ? elapsedMs : this.state.score, right: 0 }, stage: this.state.stage + 1, cleared: this.state.cleared,
          elapsedMs, runMode: this.state.mode };
        this.finishedAt = Date.now(); this.broadcast({ type: 'RESULT_PENDING', result: this.result });
      }
    }
  }
  // Scores are computed from committed inputs; client reports cannot award points.
  report(_peer: Peer, _message: any) {}
}
