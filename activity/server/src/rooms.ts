import { randomInt, randomUUID } from "node:crypto";

// 클라이언트 game/constants.ts의 WIN_SCORE와 반드시 같은 값이어야 한다.
const WIN_SCORE = 7;

export interface Input { x: -1 | 0 | 1; y: -1 | 0 | 1; jump: boolean; hit: boolean }
export interface Definition { matchId?: string; roomId: string; guildId: string; hostId: string; p2Id: string | null; mode: "CPU" | "PVP"; difficulty?: "easy" | "normal" | "hard" | "extreme" }
export interface Frame { tick: number; left: Input; right: Input | null }
export interface Result { matchId: string; reason?: string; roomId: string; winnerId: string | null; score: { left: number; right: number }; aborted?: boolean }
export interface Peer { id: string; name: string; send: (message: unknown) => void }
export function validInput(input: any): input is Input {
  return input && [-1, 0, 1].includes(input.x) && [-1, 0, 1].includes(input.y) && typeof input.jump === "boolean" && typeof input.hit === "boolean";
}
export function validDefinition(value: any): value is Definition {
  return value && (value.matchId === undefined || (typeof value.matchId === "string" && /^[\w-]{1,80}$/.test(value.matchId))) && (value.difficulty === undefined || ["easy", "normal", "hard", "extreme"].includes(value.difficulty)) &&
    typeof value.roomId === "string" && /^[\w:-]{1,180}$/.test(value.roomId) &&
    [value.guildId, value.hostId].every(id => typeof id === "string" && /^\d{1,22}$/.test(id)) &&
    ((value.mode === "CPU" && value.p2Id === null) || (value.mode === "PVP" && typeof value.p2Id === "string" && /^\d{1,22}$/.test(value.p2Id) && value.p2Id !== value.hostId));
}
export class RelayRoom {
  readonly matchId: string;
  readonly seed = randomInt(0, 2147483647);
  readonly peers = new Set<Peer>();
  readonly history: Frame[] = [];
  readonly pending = new Map<number, Partial<Record<"left" | "right", Input>>>();
  readonly sequences = new Map<string, number>();
  readonly reports = new Map<string, string>();
  readonly rematchVotes = new Set<string>();
  lastActivity = Date.now();
  result: Result | null = null;
  delivering = false;
  delivered = false;
  finishedAt: number | null = null;
  constructor(readonly definition: Definition) { this.matchId = definition.matchId ?? randomUUID(); this.definition = { ...definition, matchId: this.matchId }; }
  role(id: string) { return id === this.definition.hostId ? "left" : id === this.definition.p2Id ? "right" : "spectator"; }
  broadcast(message: unknown) { for (const peer of this.peers) peer.send(message); }
  ready() {
    return [...this.peers].some(peer => peer.id === this.definition.hostId) &&
      (this.definition.mode === "CPU" || [...this.peers].some(peer => peer.id === this.definition.p2Id));
  }
  join(peer: Peer) {
    if ([...this.peers].some(existing => existing.id === peer.id)) throw new Error("이미 다른 창에서 접속 중입니다.");
    if (this.role(peer.id) === "spectator" && [...this.peers].filter(existing => this.role(existing.id) === "spectator").length >= 50)
      throw new Error("관전 인원이 가득 찼습니다.");
    this.peers.add(peer);
    peer.send({ type: "GAME_START", matchId: this.matchId, seed: this.seed, tickRate: 60, room: this.definition, role: this.role(peer.id), userId: peer.id, committedTick: this.history.length, seq: this.sequences.get(peer.id) ?? 0 });
    for (let index = 0; index < this.history.length; index += 300) peer.send({ type: "HISTORY", frames: this.history.slice(index, index + 300) });
    peer.send({ type: "CAUGHT_UP", tick: this.history.length });
    this.presence();
    if (this.result) peer.send({ type: this.delivered ? "FINISHED" : "RESULT_PENDING", result: this.result,
      message: this.delivered ? undefined : "경기 결과 저장 중..." });
  }
  leave(peer: Peer) { this.peers.delete(peer); this.presence(); }
  presence() {
    this.broadcast({ type: "PRESENCE", ready: this.ready(), committedTick: this.history.length, players: [...this.peers].filter(peer => this.role(peer.id) !== "spectator").map(peer => ({ id: peer.id, displayName: peer.name })) });
  }
  connectionStatus() {
    if (this.result) return;
    const next = this.pending.get(this.history.length + 1);
    const missing = [this.definition.hostId, ...(this.definition.p2Id ? [this.definition.p2Id] : [])].filter(id =>
      ![...this.peers].some(peer => peer.id === id) || (Date.now() - this.lastActivity > 3000 && !next?.[id === this.definition.hostId ? "left" : "right"]));
    this.broadcast({ type: "CONNECTION_STATUS", waitingFor: missing,
      remainingSeconds: Math.max(0, Math.ceil((300000 - (Date.now() - this.lastActivity)) / 1000)) });
  }
  input(peer: Peer, message: any) {
    const side = this.role(peer.id);
    if (message.matchId !== undefined && message.matchId !== this.matchId) return;
    if (side === "spectator" || this.result || !this.ready()) return;
    if (!Number.isSafeInteger(message.tick) || !Number.isSafeInteger(message.seq) || !validInput(message.input)) throw new Error("잘못된 입력입니다.");
    if (message.seq <= (this.sequences.get(peer.id) ?? 0)) return;
    const committed = this.history.length;
    if (message.tick <= committed) return;
    if (message.tick > committed + 12 || message.tick > 72000) throw new Error("입력 tick 범위를 벗어났습니다.");
    const inputs = this.pending.get(message.tick) ?? {};
    if (inputs[side]) return;
    inputs[side] = { x: message.input.x, y: message.input.y, jump: message.input.jump, hit: message.input.hit };
    this.pending.set(message.tick, inputs);
    this.sequences.set(peer.id, message.seq);
    this.broadcast({ type: "INPUT", side, tick: message.tick, seq: message.seq, input: inputs[side] });
    while (true) {
      const tick = this.history.length + 1;
      const next = this.pending.get(tick);
      if (!next?.left || (this.definition.mode === "PVP" && !next.right)) break;
      const frame: Frame = { tick, left: next.left, right: next.right ?? null };
      this.history.push(frame); this.pending.delete(tick);
      this.lastActivity = Date.now();
      this.broadcast({ type: "FRAME", frame });
    }
  }
  report(peer: Peer, message: any) {
    if (message.matchId !== undefined && message.matchId !== this.matchId) return;
    if (this.role(peer.id) === "spectator" || this.result) return;
    const score = message.score;
    if (!score || ![score.left, score.right].every(Number.isInteger) ||
      !((score.left === WIN_SCORE && score.right >= 0 && score.right < WIN_SCORE) || (score.right === WIN_SCORE && score.left >= 0 && score.left < WIN_SCORE)) ||
      !Number.isSafeInteger(message.tick) || message.tick < 1 || message.tick > this.history.length) throw new Error("잘못된 경기 결과입니다.");
    const report = JSON.stringify({ tick: message.tick, left: score.left, right: score.right });
    this.reports.set(peer.id, report);
    const host = this.reports.get(this.definition.hostId);
    if (!host || (this.definition.p2Id && !this.reports.has(this.definition.p2Id))) return;
    if (this.definition.p2Id && host !== this.reports.get(this.definition.p2Id)) {
      this.abort("두 플레이어의 결과가 달라 경기를 중단했습니다."); return;
    }
    this.result = { matchId: this.matchId, roomId: this.definition.roomId, winnerId: score.left === WIN_SCORE ? this.definition.hostId : this.definition.p2Id, score: { left: score.left, right: score.right } };
    this.finishedAt = Date.now();
    this.broadcast({ type: "RESULT_PENDING" });
  }
  abort(reason: string) {
    if (this.result) return;
    this.result = { matchId: this.matchId, roomId: this.definition.roomId, winnerId: null, score: { left: 0, right: 0 }, aborted: true, reason };
    this.finishedAt = Date.now();
    this.broadcast({ type: "RESULT_PENDING", result: this.result, message: reason + " · 결과 전송 중" });
  }
}
