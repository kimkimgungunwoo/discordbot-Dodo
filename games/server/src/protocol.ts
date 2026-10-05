import { DIFFICULTIES, type Difficulty } from "../../shared/omok.js";
import type { Seat } from "../../shared/rummikub.js";
export interface Input { x: -1 | 0 | 1; y: -1 | 0 | 1; jump: boolean; hit: boolean; start?: boolean }
export interface Definition { game?: "volleyball" | "omok" | "arrow_dodge" | "rock_run" | "rummikub"; seats?: Seat[]; matchId?: string; roomId: string; guildId: string; hostId: string; p2Id: string | null; mode: "CPU" | "PVP" | "SOLO"; difficulty?: Difficulty; runMode?: "normal" | "endless"; bestScore?: number }
export interface Frame { tick: number; left: Input; right: Input | null }
export interface Result { matchId: string; reason?: string; roomId: string; winnerId: string | null; score: { left: number; right: number }; seatScores?: number[]; winnerSeat?: number | null; stage?: number; cleared?: boolean; elapsedMs?: number; runMode?: "normal" | "endless"; survivalMs?: number; moveCount?: number; aborted?: boolean; winnerSide?: "left" | "right" | "draw" }
export interface Peer { id: string; name: string; avatarUrl?: string; send: (message: unknown) => void }
export function validInput(input: any): input is Input {
  return input && [-1, 0, 1].includes(input.x) && [-1, 0, 1].includes(input.y) && typeof input.jump === "boolean" && typeof input.hit === "boolean" &&
    (input.start === undefined || typeof input.start === "boolean");
}
export function validDefinition(value: any): value is Definition {
  if (value?.game !== undefined && !["volleyball", "omok", "arrow_dodge", "rock_run", "rummikub"].includes(value.game)) return false;
  const game = value?.game ?? "volleyball";
  const modeValid = game === "rummikub" ? value.mode === "PVP" && validSeats(value.seats, value.hostId)
    : (game === "arrow_dodge" || game === "rock_run")
    ? value.mode === "SOLO" && value.p2Id === null
    : (value.mode === "CPU" && value.p2Id === null) || (value.mode === "PVP" && typeof value.p2Id === "string" && /^\d{1,22}$/.test(value.p2Id) && value.p2Id !== value.hostId);
  return value && (value.matchId === undefined || (typeof value.matchId === "string" && /^[\w-]{1,80}$/.test(value.matchId))) && (value.difficulty === undefined || DIFFICULTIES.includes(value.difficulty)) &&
    (value.runMode === undefined || (game === "rock_run" && ["normal", "endless"].includes(value.runMode))) &&
    (value.bestScore === undefined || (Number.isSafeInteger(value.bestScore) && value.bestScore >= 0)) &&
    typeof value.roomId === "string" && /^[\w:-]{1,180}$/.test(value.roomId) &&
    [value.guildId, value.hostId].every(id => typeof id === "string" && /^\d{1,22}$/.test(id)) &&
    modeValid;
}
function validSeats(seats: any, hostId: string): boolean {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 4 || seats[0]?.userId !== hostId) return false;
  if (!seats.every(s => s && typeof s.name === "string" && s.name.length <= 80 &&
    (s.userId === null ? ["normal", "hard"].includes(s.bot) : typeof s.userId === "string" && /^\d{1,22}$/.test(s.userId) && s.bot === undefined))) return false;
  const humans = seats.filter(s => s.userId !== null).map(s => s.userId);
  return new Set(humans).size === humans.length;
}
