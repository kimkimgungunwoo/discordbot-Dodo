import type { GameState, Side } from "./types";

/** Display coordinates only. Never feed these states back into simulation. */
export class Presentation {
  private previous: GameState | null = null;
  private current: GameState | null = null;
  private shown: GameState | null = null;
  private matchId = -1;

  reset() { this.previous = this.current = this.shown = null; }

  update(state: GameState, matchId: number) {
    const old = this.current;
    if (matchId !== this.matchId || !old || old.phase !== state.phase ||
        state.tick < old.tick || state.tick - old.tick > 4 ||
        old.left.score !== state.left.score || old.right.score !== state.right.score) {
      this.reset();
    }
    this.matchId = matchId;
    this.previous = this.current ?? state;
    this.current = state;
  }

  sample(alpha: number, elapsedMs: number, remote: Side | "both" | null): GameState {
    const current = this.current!;
    const previous = this.previous ?? current;
    const mix = (a: number, b: number) => a + (b - a) * Math.max(0, Math.min(1, alpha));
    const state: GameState = { ...current, left: { ...current.left }, right: { ...current.right }, ball: { ...current.ball } };
    if (current.phase === "playing") {
      for (const side of ["left", "right"] as const) {
        if (remote !== side && remote !== "both") continue;
        const target = state[side];
        target.x = mix(previous[side].x, target.x);
        target.y = mix(previous[side].y, target.y);
        const shown = this.shown?.[side];
        // 95% of a correction settles in 90ms; cap discontinuities at 80px.
        // A fixed time constant makes this independent of monitor refresh rate.
        if (shown && Math.hypot(target.x - shown.x, target.y - shown.y) < 80) {
          const weight = 1 - Math.exp(-Math.max(0, elapsedMs) / 30);
          target.x = shown.x + (target.x - shown.x) * weight;
          target.y = shown.y + (target.y - shown.y) * weight;
        }
      }
      // Snap at impacts rather than drawing a segment through the net/player.
      if (previous.ball.contact === current.ball.contact &&
          previous.ball.powerTicks >= current.ball.powerTicks &&
          Math.sign(previous.ball.xVelocity) === Math.sign(current.ball.xVelocity) &&
          Math.sign(previous.ball.yVelocity) === Math.sign(current.ball.yVelocity) &&
          Math.hypot(previous.ball.x - current.ball.x, previous.ball.y - current.ball.y) < 50) {
        state.ball.x = mix(previous.ball.x, current.ball.x);
        state.ball.y = mix(previous.ball.y, current.ball.y);
      }
    }
    this.shown = state;
    return state;
  }
}
