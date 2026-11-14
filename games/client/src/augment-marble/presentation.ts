import { applyAction, type Game } from "../../../shared/augment-marble";
import { createRoll } from "../../../shared/augment-marble-runtime";
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
  const before = events.filter(e => e.stage === "before_move");
  const after = events.filter(e => e.stage !== "before_move");
  const steps: PresentationStep[] = [];
  let from = 0;
  for (let at = 0; at < path.length; at++) {
    const onStep = after.filter(e => e.move?.id === move?.id && e.move?.step === at + start);
    if (onStep.length) { steps.push({ path: path.slice(from, at + 1), events: onStep }); from = at; }
  }
  if (path.length > from + 1) steps.push({ path: path.slice(from), events: [] });
  const anchored = new Set(steps.flatMap(s => s.events.map(e => e.id)));
  return { dice, before, steps, after: after.filter(e => !anchored.has(e.id)) };
}

/** Preview a confirmed dice result without modifying state or exposing future augment offers. */
export function projectedLanding(g:Game):{seat:number;tile:number}|null {
 if(g.phase!=="dice"||g.dice.length<2)return null;
 const copy=structuredClone(g);
 if(copy.augments)copy.augments.players.forEach((p,i)=>{p.acquired=4;p.offer=null;if(i!==g.turn)p.owned=p.owned.filter(a=>!["calf_kick","drop_kick","trip"].includes(a));});
 copy.abilities.roll ??= createRoll(g.turn,g.abilities.ordinal);copy.abilities.roll.result=[g.dice[0],g.dice[1]];copy.abilities.roll.bonus=g.dice[2];copy.abilities.roll.comparison=null;copy.dice=[...g.dice];
 try{applyAction(copy,{action:"dice_confirm"},()=>.6);return {seat:g.turn,tile:copy.players[g.turn].position};}catch{return null;}
}
