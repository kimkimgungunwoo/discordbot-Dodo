import { applyAction, availableDice, type Game } from "../../../shared/augment-marble";
import { power } from "../../../shared/augment-marble-effects";
import { createRoll, diceCandidates, type DicePair } from "../../../shared/augment-marble-runtime";
import type { AbilityEvent } from "../../../shared/augment-marble-runtime";

export interface PresentationStep { path: number[]; events: AbilityEvent[] }
/** Continue the same throw across salary, tax debt, augment selection and rerolls. */
export function movementContinuation(previous:Game|undefined,next:Game){
 const move=next.abilities.lastMove,old=previous?.abilities.lastMove,pending=previous?.abilities.movement;
 if(!move||!old||move.id!==old.id||!pending||pending.seat!==move.seat||move.path.length<=old.path.length)return null;
 const done=old.path.length-1,direction=previous!.world.players[move.seat].reverseThisTurn?-1:1;
 return {done,total:done+pending.remaining,target:{seat:move.seat,tile:(old.path.at(-1)!+direction*pending.remaining+360)%36}};
}
/** Interpret explicit throw IDs and movement checkpoints, never infer a roll from an old face value. */
export function planPresentation(previous: Game | undefined, next: Game, events: AbilityEvent[]) {
  const lastThrow = next.abilities.lastThrow;
  const dice = previous && lastThrow && lastThrow.kind !== "copy" && lastThrow.id !== previous.abilities.lastThrow?.id ? lastThrow : null;
  const move = next.abilities.lastMove, old = previous?.abilities.lastMove;
  const start = move && old?.id === move.id ? old.path.length - 1 : 0;
  const path = previous && move ? move.path.slice(start) : [];
  const clone=next.black?.cloneMove;if(previous&&move&&clone?.id!==previous.black?.cloneMove?.id&&clone?.id===move.id&&clone.seat===move.seat&&clone.path.length>path.length){while(path.length<clone.path.length)path.push(path.at(-1)??move.path[0]);}

  const before = events.filter(e => e.stage === "before_move");
  const after = events.filter(e => e.stage !== "before_move");
  const steps: PresentationStep[] = [];
  let from = 0;
  for (let at = 0; at < path.length; at++) {
    const onStep = after.filter(e => !["collector","devour"].includes(e.ability) && e.move?.id === move?.id && e.move?.step === at + start);
    if (onStep.length) { steps.push({ path: path.slice(from, at + 1), events: onStep }); from = at; }
  }
  if (path.length > from + 1) steps.push({ path: path.slice(from), events: [] });
  const anchored = new Set(steps.flatMap(s => s.events.map(e => e.id)));
  return { dice, before, steps, after: after.filter(e => !anchored.has(e.id)) };
}

/** Preview a confirmed dice result without modifying state or exposing future augment offers. */
export function projectedLanding(g:Game,direction?:1|-1):{seat:number;tile:number}|null {
 if(g.phase!=="dice"||g.dice.length<2)return null;
 const copy=structuredClone(g);
 if(copy.augments)copy.augments.players.forEach((p,i)=>{p.acquired=4;p.offer=null;if(i!==g.turn)p.owned=p.owned.filter(a=>!["calf_kick","drop_kick","trip"].includes(a));});
 copy.abilities.roll ??= createRoll(g.turn,g.abilities.ordinal);copy.abilities.roll.result=[g.dice[0],g.dice[1]];copy.abilities.roll.bonus=g.dice[2];copy.abilities.roll.comparison=null;copy.dice=[...g.dice];
 try{applyAction(copy,{action:"dice_confirm",...(direction===undefined?{}:{option:direction})},()=>.6);return {seat:g.turn,tile:copy.players[g.turn].position};}catch{return null;}
}

/** All remaining dice/direction outcomes; previews never select a final arrow. */
const candidateCache=new WeakMap<Game,{revision:number;targets:{seat:number;tile:number}[]}>();
export function landingCandidates(g:Game):{seat:number;tile:number}[]{
 if(g.phase!=="dice"||g.dice.length<2)return [];
 const cached=candidateCache.get(g);if(cached?.revision===g.revision)return cached.targets;
 const roll=g.abilities.roll??createRoll(g.turn,g.abilities.ordinal),choices=availableDice(g);
 const pairs:DicePair[]=[[g.dice[0],g.dice[1]]];
 const comparison=roll.comparison??g.diceComparison;if(comparison)pairs.push([comparison[0],comparison[1]]);
 if(choices.rerolls.some(id=>id==='red_dice'||id==='black_dice'))pairs.push(...diceCandidates(roll));
 const bonuses=choices.rerolls.includes('suspicious_dice')?[g.dice[2]??0,1,2,3]:[g.dice[2]??0];
 const directions:(1|-1|undefined)[]=!roll.restricted&&power(g,g.turn,'direction')?[1,-1]:[undefined];
 const outcomes=new Map<string,{seat:number;tile:number}>(),seen=new Set<string>();
 for(const pair of pairs)for(const bonus of bonuses)for(const direction of directions){
  const key=`${pair[0]+pair[1]}:${pair[0]===pair[1]}:${bonus}:${direction}`;if(seen.has(key))continue;seen.add(key);
  const preview={...g,dice:[...pair,...(bonus?[bonus]:[])]};const target=projectedLanding(preview,direction);
  if(target)outcomes.set(`${target.seat}:${target.tile}`,target);
 }
 const result=[...outcomes.values()];candidateCache.set(g,{revision:g.revision,targets:result});return result;
}
