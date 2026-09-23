import { DIFFICULTIES, type Difficulty } from "../../shared/omok.js";
export interface Input { x: -1 | 0 | 1; y: -1 | 0 | 1; jump: boolean; hit: boolean }
export interface Definition { game?: "volleyball" | "omok"; matchId?: string; roomId: string; guildId: string; hostId: string; p2Id: string | null; mode: "CPU" | "PVP"; difficulty?: Difficulty }
export interface Frame { tick: number; left: Input; right: Input | null }
export interface Result { matchId: string; reason?: string; roomId: string; winnerId: string | null; score: { left: number; right: number }; aborted?: boolean; winnerSide?: "left" | "right" | "draw" }
export interface Peer { id: string; name: string; send: (message: unknown) => void }
export function validInput(input: any): input is Input {
  return input && [-1, 0, 1].includes(input.x) && [-1, 0, 1].includes(input.y) && typeof input.jump === "boolean" && typeof input.hit === "boolean";
}
export function validDefinition(value: any): value is Definition {
  if (value?.game !== undefined && !["volleyball", "omok"].includes(value.game)) return false;
  return value && (value.matchId === undefined || (typeof value.matchId === "string" && /^[\w-]{1,80}$/.test(value.matchId))) && (value.difficulty === undefined || DIFFICULTIES.includes(value.difficulty)) &&
    typeof value.roomId === "string" && /^[\w:-]{1,180}$/.test(value.roomId) &&
    [value.guildId, value.hostId].every(id => typeof id === "string" && /^\d{1,22}$/.test(id)) &&
    ((value.mode === "CPU" && value.p2Id === null) || (value.mode === "PVP" && typeof value.p2Id === "string" && /^\d{1,22}$/.test(value.p2Id) && value.p2Id !== value.hostId));
}
