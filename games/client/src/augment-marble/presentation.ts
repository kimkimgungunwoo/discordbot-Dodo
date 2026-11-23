import { applyAction, availableDice, type Game } from "../../../shared/augment-marble";
import { power } from "../../../shared/augment-marble-effects";
import { createRoll, type DicePair } from "../../../shared/augment-marble-runtime";
import { blackTargets, hasBlack } from "../../../shared/augment-marble-black";
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
 // The marker shows intended dice travel; walls only stop the actual token.
 copy.world.walls=[];
 if(copy.augments)copy.augments.players.forEach((p,i)=>{p.acquired=4;p.offer=null;if(i!==g.turn)p.owned=p.owned.filter(a=>!["calf_kick","drop_kick","trip"].includes(a));});
 copy.abilities.roll ??= createRoll(g.turn,g.abilities.ordinal);copy.abilities.roll.result=[g.dice[0],g.dice[1]];copy.abilities.roll.bonus=g.dice[2];copy.abilities.roll.comparison=null;copy.dice=[...g.dice];
 try{applyAction(copy,{action:"dice_confirm",...(direction===undefined?{}:{option:direction})},()=>.6);return {seat:g.turn,tile:copy.players[g.turn].position};}catch{return null;}
}

/** A landing arrow; label marks copy distances ("7칸") or who moves under mind control ("2P"). */
export interface LandingCandidate {seat:number;tile:number;label?:string}
/** Only outcomes the player already knows and chooses between; unrevealed rerolls and extra dice are never advertised. */
const candidateCache=new WeakMap<Game,{key:string;targets:LandingCandidate[]}>();
export function landingCandidates(g:Game,mindTarget?:number,mindEntity:"main"|"clone"="main"):LandingCandidate[]{
 const direction=g.world.players[g.turn].reverseThisTurn?-1:1,ahead=(from:number,steps:number)=>(from+direction*steps+360)%36;
 // Mimic: each copyable distance before rolling.
 if(g.phase==="roll")return availableDice(g).copies.map(sum=>({seat:g.turn,tile:ahead(g.players[g.turn].position,sum),label:`${sum}칸`}));
 if(g.phase!=="dice"||g.dice.length<2)return [];
 const key=`${g.revision}:${mindTarget}:${mindEntity}`,cached=candidateCache.get(g);if(cached?.key===key)return cached.targets;
 // Mind control: every movable bird's landing until one is picked, then only the picked one.
 const steps=g.dice.reduce((n,x)=>n+x,0),others=hasBlack(g,g.turn,"mind_control")?blackTargets(g,g.turn):[];
 const roll=g.abilities.roll??createRoll(g.turn,g.abilities.ordinal);
 const directions:(1|-1|undefined)[]=!roll.restricted&&power(g,g.turn,'direction')?[1,-1]:[undefined];
 // 음과 양: forced moves follow the chosen direction too, so show both sides for every bird.
 const clones=g.black?.clones??{},bird=(seat:number,entity:"main"|"clone"):LandingCandidate[]=>{const from=entity==="clone"?clones[seat].position:g.players[seat].position,label=`${seat+1}P${entity==="clone"?" 분신":""}`;return directions.map(d=>({seat,tile:d===undefined?ahead(from,steps):(from+d*steps+360)%36,label}));};
 const birds=others.flatMap(seat=>clones[seat]?[...bird(seat,"main"),...bird(seat,"clone")]:bird(seat,"main"));
 if(mindTarget!==undefined&&others.includes(mindTarget)){const targets=bird(mindTarget,mindEntity==="clone"&&clones[mindTarget]?"clone":"main");candidateCache.set(g,{key,targets});return targets;}
 const pairs:DicePair[]=[[g.dice[0],g.dice[1]]];
 const comparison=roll.comparison??g.diceComparison;if(comparison)pairs.push([comparison[0],comparison[1]]);
 // Additional dice are random: never advertise unrevealed +1/+2/+3 landings.
 const bonuses=[g.dice[2]??0];
 const outcomes=new Map<string,LandingCandidate>(),seen=new Set<string>();
 // Shaco: the own clone walks the same throw (capped at 10 while restricted) unless it is resting; its landing is a known arrival option.
 const own=clones[g.turn],cloneWalks=!!own&&hasBlack(g,g.turn,"shaco")&&!own.skip&&!own.rest,me=others.length?`${g.turn+1}P `:"";
 for(const pair of pairs)for(const bonus of bonuses)for(const direction of directions){
  const key=`${pair[0]+pair[1]}:${pair[0]===pair[1]}:${bonus}:${direction}`;if(seen.has(key))continue;seen.add(key);
  const preview={...g,dice:[...pair,...(bonus?[bonus]:[])]};const target=projectedLanding(preview,direction);
  if(target)outcomes.set(`${target.seat}:${target.tile}`,{...target,label:cloneWalks?`${me}본체`:others.length?`${g.turn+1}P`:undefined});
  if(cloneWalks){const sum=pair[0]+pair[1]+bonus,n=own.restricted?Math.min(10,sum):sum,tile=(own.position+(direction??(g.world.players[g.turn].reverseThisTurn?-1:1))*n+360)%36;outcomes.set(`clone:${tile}`,{seat:g.turn,tile,label:`${me}분신`});}
 }
 const result=[...outcomes.values(),...birds];candidateCache.set(g,{key,targets:result});return result;
}

/** Elimination becomes visible only after the token finishes its arrival. */
export function presentationGame(g:Game,pending:ReadonlySet<number>):Game{
 return pending.size?{...g,players:g.players.map((p,seat)=>pending.has(seat)?{...p,bankrupt:false}:p)}:g;
}
