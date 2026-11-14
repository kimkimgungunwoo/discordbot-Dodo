/** Server-owned building blocks. The live catalog is enabled only as effects are implemented. */
export type DicePair = readonly [number, number];
export type RerollAbility = "suspicious_dice" | "red_dice" | "black_dice";
export type ForceAbility = "force_silver" | "force_gold" | "force_prism";
export interface DiceCapabilities {
  selectiveDouble: boolean;
  doubleLover: boolean;
  forces: ForceAbility[];
  mimic: boolean;
  workSubsidy: boolean;
  rerolls: RerollAbility[];
}
export interface RollContext {
  bonus?: number;
  seat: number;
  ordinal: number;
  restricted: boolean;
  min: number;
  max: number;
  forcedDouble: boolean;
  avoidDouble?: boolean;
  used: RerollAbility[];
  result: DicePair | null;
  comparison: DicePair | null;
}
export interface DiceChoices {
  selectiveDouble: boolean;
  forces: ForceAbility[];
  copies: number[];
  workSubsidy: boolean;
  rerolls: RerollAbility[];
}
/** Call for EVERY throw, including double bonus throws. No first-throw gate on dice abilities. */
export function createRoll(seat: number, ordinal: number, restricted = false): RollContext {
  return { seat, ordinal, restricted, min: 2, max: restricted ? 10 : 12, forcedDouble: false, used: [], result: null, comparison: null };
}
export function diceChoices(roll: RollContext, capabilities: DiceCapabilities, history: readonly number[], canAct = true): DiceChoices {
  const available = canAct && !roll.restricted;
  const before = available && roll.result === null;
  return {
    selectiveDouble: before && capabilities.selectiveDouble,
    forces: before ? [...capabilities.forces] : [],
    copies: before && capabilities.mimic ? [...new Set(history)] : [],
    workSubsidy: before && roll.ordinal === 0 && capabilities.workSubsidy,
    rerolls: available && roll.result !== null && roll.comparison === null ? capabilities.rerolls.filter(id => !roll.used.includes(id) && true) : [],
  };
}
export function configureRoll(roll: RollContext, capabilities: DiceCapabilities, force?: { ability: ForceAbility; option: number }, forcedDouble = false) {
  if (roll.result) throw new Error("이미 굴린 주사위의 조건은 바꿀 수 없습니다.");
  if (roll.restricted && (force || forcedDouble)) throw new Error("이번 투척은 주사위 능력을 사용할 수 없습니다.");
  let min = 2, max = roll.restricted ? 10 : 12;
  if (force) {
    if (!capabilities.forces.includes(force.ability)) throw new Error("보유하지 않은 힘조절입니다.");
    const ranges = force.ability === "force_silver" ? [[2, 6], [7, 12]] : [[2, 3], [4, 6], [7, 9], [10, 12]];
    if (force.ability === "force_gold") {
      // Clamp the target interval to the two-dice domain.
      if (!Number.isInteger(force.option) || force.option < 2 || force.option > 12) throw new Error("목표 거리가 올바르지 않습니다.");
      min = Math.max(2, force.option - 2); max = Math.min(12, force.option + 2);
    } else {
      const range = ranges[force.option];
      if (!Number.isInteger(force.option) || !range) throw new Error("힘조절 범위가 올바르지 않습니다.");
      [min, max] = range;
    }
  }
  if (forcedDouble && !capabilities.selectiveDouble) throw new Error("선택적 더블을 보유하지 않았습니다.");
  Object.assign(roll, { min, max, forcedDouble });
  if(forcedDouble)roll.avoidDouble=false;
}
export function diceCandidates(roll: RollContext, keep?: { index: 0 | 1; value: number }): DicePair[] {
  const result: DicePair[] = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
    if (a + b < roll.min || a + b > roll.max || (roll.forcedDouble && a !== b) || (roll.avoidDouble && a === b)) continue;
    if (keep && [a, b][keep.index] !== keep.value) continue;
    result.push([a, b]);
  }
  return result;
}
function sampleDice(roll: RollContext, doubleLover: boolean, random: () => number, keep?: { index: 0 | 1; value: number }): DicePair {
  if (!keep && !doubleLover && !roll.forcedDouble && !roll.avoidDouble && roll.min === 2 && roll.max === 12) return [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)];
  const candidates = diceCandidates(roll, keep);
  if (!candidates.length) throw new Error("조건에 맞는 주사위가 없습니다.");
  // Preserve uniform pairs, but double the aggregate natural-double probability.
  const doubles = candidates.filter(p => p[0] === p[1]), singles = candidates.filter(p => p[0] !== p[1]);
  if (doubleLover && !roll.restricted && !roll.forcedDouble && doubles.length && singles.length) {
    const pool = random() < Math.min(1, 2 * doubles.length / candidates.length) ? doubles : singles;
    return pool[Math.floor(random() * pool.length)];
  }
  return candidates[Math.floor(random() * candidates.length)];
}
export function throwDice(roll: RollContext, capabilities: DiceCapabilities, random: () => number): DicePair {
  if (roll.result) throw new Error("이미 투척했습니다.");
  return roll.result = sampleDice(roll, capabilities.doubleLover, random);
}
export function rerollDice(roll: RollContext, capabilities: DiceCapabilities, ability: RerollAbility, random: () => number, die?: 0 | 1) {
  if (!diceChoices(roll, capabilities, []).rerolls.includes(ability)) throw new Error("지금 사용할 수 없는 리롤입니다.");
  if(ability === "suspicious_dice"){roll.bonus=1+Math.floor(Math.min(.999999,Math.max(0,random()))*3);roll.used.push(ability);return;}
  const previous = roll.result!;

  const keepIndex = die === 0 ? 1 : 0;
  const next = sampleDice(roll, capabilities.doubleLover, random, undefined);
  roll.used.push(ability);
  if (ability === "black_dice") roll.comparison = next;
  else roll.result = next;
}
export function chooseBlackDice(roll: RollContext, useNew: boolean) {
  if (!roll.comparison) throw new Error("비교할 주사위가 없습니다.");
  if (useNew) roll.result = roll.comparison;
  roll.comparison = null;
}

export type AbilityVisual = "steal" | "kick" | "trip" | "poison" | "trap" | "income" | "revive" | "dice" | "buff";
export interface AbilityEvent {
  id: number;
  actor: number;
  target?: number;
  tile: number;
  ability: string;
  caption: string;
  visual: AbilityVisual;
  rentChange?:{before:number;after:number;level:number};
  remaining?:number;
  amount?: number;
  flight?: { seat:number; from:number; to:number };
  stage?: "before_move" | "after_move";
  move?: { id: number; step: number };
}
export interface AbilityRuntime {
  schemaVersion: 2;
  gambles: Record<number, number>[];
  throws: { seat: number; sum: number; turnId: number }[];
  lastOwnTurn: number[];
  islandOwner: number | null;
  pendingTarget: boolean;
  nextEventId: number;
  events: AbilityEvent[];
  roll: RollContext | null;
  movement: { seat: number; remaining: number; visited: number[]; resume: "step" | "arrival" } | null;
  statuses: { skipTurns: number; skipBy?: string; restrictedRolls: number; restrictedBy?: string; nextTurnRestricted?: boolean; restrictWholeTurn?: boolean; revivals?: { id: string; cash: number; tier: number; consumed: boolean }[]; revival: { tier: number; consumed: boolean } | null }[];
  lastThrow?: { additional?: boolean; id: number; seat: number; kind: "roll" | "reroll" | "copy"; dice: number[]; die?: 0 | 1 } | null;
  lastMove: { id: number; seat: number; path: number[]; flight?:boolean;wall?:{boundary:number;tile:number;next:number} } | null;
  startedTurn: number;
  ordinal: number;
  history: number[];
  ownerTurns: number[];
  copied: boolean;
  marks: { power: number; tile: number; owner: number; kind: "gas" | "trap" | "poison"; expiresAtOwnerTurn: number; expiresRound?: number }[];
}
export function createAbilityRuntime(count: number): AbilityRuntime {
  return { schemaVersion: 2, gambles: Array.from({length: count}, () => ({})), throws: [], lastOwnTurn: Array(count).fill(0), islandOwner: null, pendingTarget: false, lastThrow: null, lastMove: null, startedTurn: 0, ordinal: 0, history: [], ownerTurns: Array(count).fill(0), copied: false, nextEventId: 1, events: [], roll: null, movement: null, statuses: Array.from({ length: count }, () => ({ skipTurns: 0, restrictedRolls: 0, revival: null })), marks: [] };
}
/** Ordered, bounded public stream. Clients deduplicate IDs; reconnects do not replay old attacks. */
export function emitAbility(runtime: AbilityRuntime, event: Omit<AbilityEvent, "id">) {
  const move = runtime.movement && runtime.lastMove && event.stage !== "before_move" ? { id: runtime.lastMove.id, step: runtime.lastMove.path.length - 1 } : undefined;
  runtime.events.push({ ...event, ...(move ? { move } : {}), id: runtime.nextEventId++ });
  if (runtime.events.length > 64) runtime.events.splice(0, runtime.events.length - 64);
}
