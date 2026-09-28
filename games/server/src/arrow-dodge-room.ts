import { RelayRoom } from "./volleyball-room.js";
import type { Peer } from "./protocol.js";

export class ArrowDodgeRoom extends RelayRoom {
  report(peer: Peer, message: any) {
    if (message.matchId !== this.matchId || this.role(peer.id) !== "left" || this.result) return;
    if (!Number.isSafeInteger(message.tick) || message.tick < 1 || message.tick > this.history.length ||
        !Number.isSafeInteger(message.survivalTicks) || message.survivalTicks < 0 || message.survivalTicks > message.tick) {
      throw new Error("잘못된 생존 기록입니다.");
    }
    const startIndex = this.history.findIndex(frame => frame.left.start === true);
    const expectedSurvivalTicks = startIndex < 0 ? -1 : message.tick - (startIndex + 1) - 120;
    if (message.survivalTicks !== expectedSurvivalTicks) throw new Error("잘못된 생존 기록입니다.");
    const survivalMs = Math.round(message.survivalTicks * 1000 / 60);
    if (message.survivalMs !== survivalMs) throw new Error("잘못된 생존 기록입니다.");
    this.result = {
      matchId: this.matchId, roomId: this.definition.roomId, winnerId: this.definition.hostId,
      survivalMs, score: { left: survivalMs, right: 0 },
    };
    this.finishedAt = Date.now();
    this.broadcast({ type: "RESULT_PENDING", result: this.result, message: "생존 기록 저장 중..." });
  }
}
