import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validDefinition, type Definition, type Result } from "./protocol.js";
import type { Game } from "../../shared/augment-marble.js";

export interface MarbleSave {
  version: 1; definition: Definition; game: Game; seed: number; started: boolean;
  deadline: number; emptySince: number | null; lastActivity: number;
  result: Result | null; delivered: boolean; finishedAt: number | null; votes: string[];
}
/** Atomic per-room checkpoints, including private offers and pending movement/debt. */
export class MarbleStore {
  constructor(readonly directory: string) { mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  private path(roomId: string) { return join(this.directory, createHash("sha256").update(roomId).digest("hex") + ".json"); }
  save(value: MarbleSave) {
    const path = this.path(value.definition.roomId), pending = path + ".tmp";
    writeFileSync(pending, JSON.stringify(value), { mode: 0o600 }); renameSync(pending, path);
  }
  remove(roomId: string) { try { unlinkSync(this.path(roomId)); } catch (e: any) { if (e.code !== "ENOENT") throw e; } }
  load(): MarbleSave[] {
    const values: MarbleSave[] = [];
    for (const file of readdirSync(this.directory).filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
      try {
        const v = JSON.parse(readFileSync(join(this.directory, file), "utf8")) as MarbleSave;
        if (v.version !== 1 || !validDefinition(v.definition) || v.definition.game !== "marble" || !v.definition.matchId ||
            !Array.isArray(v.game?.players) || v.game.players.length !== v.definition.seats!.length || v.game.properties?.length !== 36 ||
            v.game.abilities?.schemaVersion !== 2 || !Number.isSafeInteger(v.game.revision) || !Number.isFinite(v.deadline) || !Array.isArray(v.votes)) throw new Error("Invalid marble checkpoint");
        values.push(v);
      } catch (error) { console.error(`[marble] checkpoint ${file} could not be restored`, error); }
    }
    return values;
  }
}
