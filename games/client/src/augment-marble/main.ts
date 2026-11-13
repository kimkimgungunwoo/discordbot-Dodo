import { rulesGuide } from "./rules-guide";
import { showTakeover } from "./takeover-effect";
import { AugmentTooltip } from "./augment-tooltip";
import { boardSpace } from "./board-space";
import { MarbleSound, abilitySound, stateSounds } from "./sound";
import { TurnPointer } from "./turn-pointer";
import { portalJump } from "./portal-effect";
import { destroyBuildings } from "./destruction-effects";
import { EVENT_MS,eventDefinition,EVENT_CATEGORY_LABELS } from "../../../shared/augment-marble-events";
import { eventTargets,eventOwnedTiles } from "../../../shared/augment-marble";
import { turnTargets, ISLAND_COST } from "../../../shared/augment-marble";
import { salaryAmount } from "../../../shared/augment-marble-effects";
import { showOrderDraw } from "./order-draw";
import { drawTurnOrder,ORDER_DRAW_MS } from "../../../shared/augment-marble";
import { flyToken } from "./flight";
import { MoneyEffects } from "./money-effects";
import { AbilityEffects } from "./ability-effects";
import { renderBoardB } from "./board";
import { planPresentation, projectedLanding, movementContinuation } from "./presentation";
import { abilityLabel, abilityNotes, abilityTiming, displayedRent, statusLabels, tileDescription } from "./copy";
import { AUGMENT_CATALOG, AUGMENT_SELECTION_MS, TIER_LABELS, type AugmentDefinition } from "../../../shared/augment-marble-augments";
import { cashbackAmount, incomeAmount, power, spendCost, immune, lossAmount } from "../../../shared/augment-marble-effects";
import type { AbilityEvent } from "../../../shared/augment-marble-runtime";
import "../style.css";
import "./style.css";
import { dodoProfile } from "../common/sprites";
import { authenticate } from "../discord-session";
import { RematchVoting } from "../common/rematch-voting";
import { BOARD, BUILDINGS, MAX_ROUNDS, COLOR_GROUPS_TO_WIN, netWorth, saleProceeds, preservesDeadline, availableDice, purchaseCost, buildCost, takeoverCost, takeoverBase, playerDisplayOrder, landmarkCost, landmarkAvailable, landmarkBase, START_CASH, SALARY, BONUS, construction, baseRent, landTax, COLORS, GROUP_COLORS, TURN_MS, actingSeat, applyAction, assets, autoAction, createGame, automaticContinuation, groupCount, rent, rentPayment, value, type Property, type Action, type View } from "../../../shared/augment-marble";

const root = document.querySelector<HTMLDivElement>("#app")!;
const turnPointer=new TurnPointer(root);
const sound=new MarbleSound();
root.addEventListener("pointerdown",()=>void sound.unlock(),{capture:true});
root.addEventListener("keydown",()=>void sound.unlock(),{capture:true});
const abilityEffects = new AbilityEffects(root), moneyEffects=new MoneyEffects(root);
const displayedCash=new Map<number,number>(),displayedProperties=new Map<number,Property>();
const params = new URLSearchParams(location.search), online = params.has("room") || params.has("code");
const profiles = COLORS.map(dodoProfile), boardBirds=profiles.map(p=>p.toDataURL()), reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => `${n.toLocaleString()}<small>만원</small>`;
const reason = { triple: `색상 그룹 ${COLOR_GROUPS_TO_WIN}개 독점`, line: "한 변의 모든 지역 독점", bankruptcy: "최후의 생존자", assets: `${MAX_ROUNDS}라운드 종료 · 자산승리` };
let view: View | undefined, socket: WebSocket | undefined, rematch: RematchVoting | undefined;
let connected = !online, pending = false, terminal = false, selected: number | null = null, error = "", offset = 0, retries = 0;
let timer: ReturnType<typeof setTimeout> | undefined, reconnect: ReturnType<typeof setTimeout> | undefined;
let animating = false, presentationStage = "", needsBaseline = true, draining = false, generation = 0;
let directPickingKey="";
let eventPlayerChoice:{key:string;seat:number}|null=null;
let drawnMatch="",drawingOrder=false;
let heldWall:number|undefined;
let controller = new AbortController(), movingSprite: HTMLCanvasElement | undefined, movingShadow: HTMLDivElement | undefined;
let queue: { next: View; keepDeadline: boolean }[] = [];
let info: { kind: "ability"; id: string; seat: number } | { kind: "rules" } | null = null;
let dismissedResult = "", returnFocus = "", shownEventId = 0;
let displayedLog: string[] | undefined;
let landingTarget:{seat:number;tile:number}|null=null;
let displayedPositions=new Map<number,number>();
let moveProgress={done:0,total:0};
const TILE_STEP_MS=350;

const definition = (id: string) => AUGMENT_CATALOG.find(a => a.id === id);
const augmentTooltip=new AugmentTooltip(root,button=>{const a=definition(button.dataset.ability??""),seat=Number(button.dataset.ownedSeat);if(!a||!view?.game.players[seat])return null;return{name:abilityLabel(a),owner:`${seat+1}P ${view.game.players[seat].name}`,tier:a.tier,tierLabel:TIER_LABELS[a.tier],description:a.description,timing:abilityTiming(a),notes:abilityNotes(a)};});
function dieMarkup(value: number) {
  const dots: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return Array.from({ length: 9 }, (_, i) => `<i class="${dots[value]?.includes(i) ? "pip" : ""}"></i>`).join("");
}
function cleanupMovement() { root.querySelectorAll(".m-step-active").forEach(el=>el.classList.remove("m-step-active"));movingSprite?.remove(); movingSprite = undefined; movingShadow?.remove();movingShadow=undefined; root.querySelectorAll<HTMLElement>("[data-token],[data-token-part]").forEach(t => t.style.visibility = ""); }
function resetPresentation() {
  sound.stop();generation++; controller.abort(); controller = new AbortController(); queue = []; draining = false;
  cleanupMovement(); landingTarget=null;displayedPositions.clear();moveProgress={done:0,total:0};displayedCash.clear();displayedProperties.clear();moneyEffects.clear();abilityEffects.clear();drawingOrder=false; animating = false; presentationStage = ""; clearTimeout(timer);
}
function pause(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve => { const done = () => { clearTimeout(handle); signal.removeEventListener("abort", done); resolve(); }; const handle = setTimeout(done, ms); signal.addEventListener("abort", done, { once: true }); });
}
function syncRematch(next: View) {
  rematch?.configure(next.matchId, next.seat < 0 ? null : next.seats[next.seat].userId, next.seats.filter(s => s.userId !== null).length, next.game.phase === "finished" || !!next.aborted, next.rematch?.delivered ?? false);
  if (next.rematch) rematch?.receive(next.rematch);
}
function beginOrderDraw(next:View){
 if(!next.started||drawnMatch===next.matchId||!(next.game.orderDrawUntil!>Date.now()+offset))return;
 drawnMatch=next.matchId;drawingOrder=true;clearTimeout(timer);render();const signal=controller.signal;void showOrderDraw(next,next.game.orderDrawUntil!-Date.now()-offset,signal).finally(()=>{if(signal.aborted)return;drawingOrder=false;render();if(!online)scheduleLocal();void drain();});
}
function receive(next: View, keepDeadline = false) {
  offset = online ? next.serverNow - Date.now() : 0;
  if (needsBaseline || view?.matchId !== next.matchId || next.aborted || (!!view&&!view.started&&next.started)) {
    const starting=!!view&&!view.started&&next.started&&view.matchId===next.matchId;
    resetPresentation(); needsBaseline = false; info = null; selected = null;
    moneyEffects.baseline(next.game.moneyTransfers??[]);
    abilityEffects.baseline(next.matchId, next.game.abilities.events); shownEventId = next.game.abilities.events.at(-1)?.id ?? 0; displayedLog = undefined; view = next; pending = false; retries = 0;
    syncRematch(next); render();if(starting)sound.play("start");beginOrderDraw(next); if (!online) scheduleLocal(); return;
  }
  const last = queue.at(-1)?.next ?? view;
  if (next.game.revision < last.game.revision) return;
  if (next.game.revision === last.game.revision) {
    if (queue.length) queue[queue.length - 1].next = next;
    else { const newlyReady=next.seats.some((seat,i)=>seat.ready&&!view!.seats[i]?.ready);view.seats = next.seats;if(newlyReady&&!next.started)sound.play("ready"); view.deadline = next.deadline; view.rematch = next.rematch; view.started = next.started; syncRematch(next);beginOrderDraw(next); if (!animating) { pending = false; render(); } }
    return;
  }
  queue.push({ next, keepDeadline }); void drain();
}
async function drain() {
  if (draining||drawingOrder) return;
  draining = true; const run = generation;
  try {
    while (queue.length && run === generation) {
      const item = queue.shift()!; await present(item.next, item.keepDeadline, controller.signal);
    }
  } finally {
    if (run === generation) { draining = false; if (!online) scheduleLocal(); }
  }
}
async function present(next: View, _keepDeadline = false, signal = controller.signal) {
  const previous = view?.game, transfers=moneyEffects.take(next.game.moneyTransfers??[]),events = abilityEffects.take(next.matchId, next.game.abilities.events), plan = planPresentation(previous, next.game, events);
  if(previous?.turnId!==next.game.turnId || next.game.phase==="roll"&&previous?.abilities.ordinal!==next.game.abilities.ordinal)landingTarget=null;
  const teleport=next.game.teleport?.id!==previous?.teleport?.id?next.game.teleport:undefined;
  const takeovers=previous?next.game.properties.flatMap((p,tile)=>p.owner!==null&&previous.properties[tile].owner!==null&&p.owner!==previous.properties[tile].owner?[{tile,from:previous.properties[tile].owner!,to:p.owner}]:[]):[];
  const destruction=next.game.destructionBatch?.id!==previous?.destructionBatch?.id?next.game.destructionBatch:undefined;
  displayedProperties.clear();for(const item of destruction?.items??[])displayedProperties.set(item.tile,item.before);
  for(const item of takeovers)displayedProperties.set(item.tile,previous!.properties[item.tile]);
  for(const event of events)if(event.rentChange&&!displayedProperties.has(event.tile))displayedProperties.set(event.tile,{...next.game.properties[event.tile],revisitBoost:event.rentChange.level-1});
  const batch=next.game.flightBatch?.id!==previous?.flightBatch?.id?next.game.flightBatch?.items:undefined;
  const route=plan.steps.flatMap((s,i)=>i?s.path.slice(1):s.path);
  displayedPositions.clear();
  if(route.length>1&&next.game.abilities.lastMove)displayedPositions.set(next.game.abilities.lastMove.seat,route[0]);
  for(const event of events)if(event.flight&&!displayedPositions.has(event.flight.seat))displayedPositions.set(event.flight.seat,event.flight.from);
  for(const item of batch??[])displayedPositions.set(item.seat,item.from);
  if(teleport)displayedPositions.set(teleport.seat,teleport.from);
  const continuation=movementContinuation(previous,next.game);
  if(route.length>1)moveProgress={done:continuation?.done??0,total:continuation?.total??(next.game.abilities.lastMove?.flight?1:Math.max(route.length-1,next.game.dice.reduce((a,b)=>a+b,0)))};
  else if(previous?.turnId!==next.game.turnId)moveProgress={done:0,total:0};
  if(teleport)moveProgress={done:0,total:0};
  heldWall=next.game.abilities.lastMove?.wall&&(next.game.abilities.lastMove.id!==previous?.abilities.lastMove?.id||!previous?.abilities.lastMove?.wall)?next.game.abilities.lastMove.wall.boundary:undefined;
  displayedCash.clear();if(previous&&transfers.length)previous.players.forEach((p,i)=>{if(p.cash!==next.game.players[i].cash)displayedCash.set(i,p.cash)});
  view = next; pending = false; retries = 0; syncRematch(next); clearTimeout(timer);
  animating = !!(plan.dice || plan.steps.some(s => s.path.length > 1) || events.length || transfers.length || heldWall!==undefined || batch?.length || destruction?.items.length || teleport || takeovers.length);
  presentationStage = animating ? "발동 효과를 확인하고 있습니다" : "";
  if (["augment","event","rent","debt"].includes(next.game.phase) && actingSeat(next.game) === next.seat && (previous?.phase !== next.game.phase || next.game.world.current?.serial !== previous?.world.current?.serial)) info = null;
  displayedLog = animating ? previous?.log : undefined;
  render();
  const cues=previous?stateSounds(previous,next.game):[];
  const earlyCues=new Set(["buy","build","landmark","takeover","augment","reroll"]);
  for(const cue of cues)if(earlyCues.has(cue)&&cue!=="takeover")sound.play(cue);
  const play = async (items: AbilityEvent[]) => { for (const event of items) { if (signal.aborted) return; presentationStage = "증강 발동"; shownEventId = Math.max(shownEventId, event.id); updateStage(); if(event.rentChange){const p=next.game.properties[event.tile];if(p.revisitBoost===event.rentChange.level)displayedProperties.delete(event.tile);else displayedProperties.set(event.tile,{...p,revisitBoost:event.rentChange.level});render();}if(event.remaining!==undefined){moveProgress.total=moveProgress.done+event.remaining;const direction=next.game.world.players[next.game.turn].reverseThisTurn?-1:1;landingTarget={seat:next.game.turn,tile:(event.tile+direction*event.remaining+360)%36};render();}const cue=abilitySound(event);if(cue)sound.play(cue);await abilityEffects.play(event, signal,next.game.players.map(p=>p.name)); if(event.flight&&!signal.aborted)await animateFlight(event.flight.seat,event.flight.to,signal); } };
  try {
    await play(plan.before.filter(e => e.ability !== "dice"));
    if (plan.dice && !signal.aborted) await animateDice(plan.dice.dice, signal, plan.dice.die);
    if(!signal.aborted){
      landingTarget=teleport?{seat:teleport.seat,tile:teleport.to}:(previous?.phase==="dice"?projectedLanding(previous):null) ?? projectedLanding(next.game) ?? continuation?.target ?? (route.length>1&&next.game.abilities.lastMove?{seat:next.game.abilities.lastMove.seat,tile:next.game.abilities.lastMove.flight?route.at(-1)!:(route[0]+(next.game.world.players[next.game.abilities.lastMove.seat].reverseThisTurn?-1:1)*moveProgress.total+360)%36}:landingTarget);
      render();
      if(!teleport&&landingTarget&&(plan.dice||route.length>1))await pause(reducedMotion.matches?100:520,signal);
    }
    await play(plan.before.filter(e => e.ability === "dice"));
    if(batch?.length&&!signal.aborted){presentationStage="태풍";updateStage();await animateFlights(batch.map(item=>({seat:item.seat,tile:item.to})),signal);}
    if(teleport&&!signal.aborted){presentationStage="포탈 이동";updateStage();await animatePortal(teleport.seat,teleport.to,signal);}
    for (const step of plan.steps) {
      if (signal.aborted) return;
      if(teleport){await play(step.events);continue;}
      if(next.game.abilities.lastMove!.flight)await animateFlight(next.game.abilities.lastMove!.seat,step.path.at(-1)!,signal);
      else {await animateMovement(next.game.abilities.lastMove!.seat, step.path, signal);cleanupMovement();render();}
      await play(step.events);
    }
    if(heldWall!==undefined&&!signal.aborted)await animateWall(next.game.abilities.lastMove!.seat,next.game.abilities.lastMove!.wall!,signal);
    if(destruction?.items.length&&!signal.aborted){presentationStage=destruction.kind==="quake"?"지진 · 건물 붕괴":"미사일 · 건물 붕괴";updateStage();sound.play("quake");await destroyBuildings(root,destruction.items.map(i=>i.tile),signal);displayedProperties.clear();render();}
    await play(plan.after);
    for(const item of takeovers){if(signal.aborted)return;sound.play("takeover");await showTakeover(root,item.tile,BOARD[item.tile].name,item.from,item.to,next.game.players.map(p=>p.name),()=>{displayedProperties.delete(item.tile);render();},signal);}
    if(!signal.aborted&&transfers.length){presentationStage="금액 정산";updateStage();sound.play(next.game.players.some((p,i)=>p.laps>(previous?.players[i].laps??p.laps))?"salary":transfers.some(t=>t.from!==null&&t.to!==null)?"transfer":transfers.some(t=>t.to!==null)?"income":"payment");await moneyEffects.play(transfers,signal);}
  } finally {
    if (!signal.aborted) { cleanupMovement();heldWall=undefined; displayedPositions.clear();displayedCash.clear();displayedProperties.clear();animating = false; presentationStage = ""; shownEventId = next.game.abilities.events.at(-1)?.id ?? shownEventId; displayedLog = undefined; render(); }
  }
  if(!signal.aborted&&previous){for(const cue of cues)if(!earlyCues.has(cue))sound.play(cue);if(next.game.phase==="event"&&next.game.world.current?.serial!==previous.world.current?.serial){sound.play(`event-${eventDefinition(next.game.world.current!.id).category}`);await pause(1000,signal);}}
}
function updateStage() { const el = root.querySelector(".m-presentation-label"); if (el) el.textContent = presentationStage; }
async function animateDice(result: number[], signal: AbortSignal, die?: 0 | 1) {
  sound.play("roll");
  presentationStage = die === undefined ? "주사위를 굴리고 있습니다" : `${die + 1}번 주사위를 다시 굴리고 있습니다`; updateStage();
  const dice = root.querySelector(".m-dice"); dice?.classList.add("rolling");
  let frame = 0;
  const shuffle = () => root.querySelectorAll<HTMLElement>(".m-die").forEach((el, i) => { if (die === undefined || i === die) el.innerHTML = dieMarkup(1 + (frame * (i ? 5 : 1) + i * 3) % 6); });
  const interval = !reducedMotion.matches ? setInterval(() => { frame++; shuffle(); }, 70) : undefined;
  await pause(reducedMotion.matches ? 60 : 620, signal); clearInterval(interval); dice?.classList.remove("rolling");
  if (!signal.aborted) { root.querySelectorAll<HTMLElement>(".m-die").forEach((el, i) => el.innerHTML = dieMarkup(result[i])); dice?.classList.add("landed");sound.play(result.length===2&&result[0]===result[1]?"double":"dice"); }
}
function revealBoardTile(index:number){const stage=root.querySelector<HTMLElement>(".m-board-stage"),anchor=root.querySelector(`[data-landing-anchor="${index}"]`);if(!stage||!anchor)return 0;const r=anchor.getBoundingClientRect(),box=stage.getBoundingClientRect(),before=stage.scrollLeft;if(r.left<box.left+32||r.right>box.right-32)stage.scrollLeft+=r.left-(box.left+box.width/2);return stage.scrollLeft-before;}
async function animateWall(seat:number,wall:{boundary:number;tile:number;next:number},signal:AbortSignal){
 sound.play("wall");
 cleanupMovement();render();const token=root.querySelector<SVGImageElement>(`[data-token="${seat}"]`),bar=root.querySelector<SVGGElement>(`[data-wall="${wall.boundary}"]`);if(!token||!bar)return;
 const a=token.getBoundingClientRect(),b=bar.getBoundingClientRect(),dx=b.x+b.width/2-(a.x+a.width/2),dy=b.y+b.height/2-(a.y+a.height/2),length=Math.hypot(dx,dy)||1,travel=Math.max(0,length-a.width*.3)/(root.querySelector(".m-board-svg")!.getBoundingClientRect().width/908);
 const animation=token.animate([{transform:'translate(0,0)'},{transform:`translate(${dx/length*travel}px,${dy/length*travel}px)`,offset:.5},{transform:'translate(0,0)'}],{duration:520,easing:'ease-in-out'});
 signal.addEventListener('abort',()=>animation.cancel(),{once:true});await animation.finished.catch(()=>{});heldWall=undefined;moveProgress.total=moveProgress.done;landingTarget={seat,tile:wall.tile};render();
}
async function animatePortal(seat:number,tile:number,signal:AbortSignal){
 sound.play("portal");
 cleanupMovement();render();const board=root.querySelector<SVGSVGElement>(".m-board-svg");if(!board||!view)return;
 const positions=new Map(displayedPositions);positions.set(seat,tile);
 const template=document.createElement("template");template.innerHTML=renderBoardB(view.game,{seat:view.seat,selected,positions,target:null,birds:boardBirds,stealth:view.game.players.map((_,i)=>immune(view!.game,i)),center:""});
 const token=template.content.querySelector<SVGImageElement>(`[data-token="${seat}"]`);if(!token)return;const r=board.getBoundingClientRect(),scale=r.width/908;
 await portalJump(root,seat,new DOMRect(r.x+(Number(token.getAttribute("x"))+4)*scale,r.y+(Number(token.getAttribute("y"))+4)*scale,Number(token.getAttribute("width"))*scale,Number(token.getAttribute("height"))*scale),signal);displayedPositions.set(seat,tile);render();
}
async function animateFlight(seat:number,tile:number,signal:AbortSignal){await animateFlights([{seat,tile}],signal);}
async function animateFlights(items:{seat:number;tile:number}[],signal:AbortSignal){
 sound.play("flight");
 cleanupMovement();render();
 const board=root.querySelector<SVGSVGElement>(".m-board-svg");if(!board||!view)return;
 
 const positions=new Map(displayedPositions);for(const item of items)positions.set(item.seat,item.tile);
 const template=document.createElement("template");template.innerHTML=renderBoardB(view.game,{seat:view.seat,selected,positions,target:null,birds:boardBirds,stealth:view.game.players.map((_,i)=>immune(view!.game,i)),center:""});
 const r=board.getBoundingClientRect(),scale=r.width/908,started=performance.now();
 await Promise.all(items.map(({seat})=>{const token=template.content.querySelector<SVGImageElement>(`[data-token="${seat}"]`);if(!token)return Promise.resolve();return flyToken(root,seat,new DOMRect(r.left+(Number(token.getAttribute("x"))+4)*scale,r.top+(Number(token.getAttribute("y"))+4)*scale,Number(token.getAttribute("width"))*scale,Number(token.getAttribute("height"))*scale),signal,started);}));
 for(const item of items)displayedPositions.set(item.seat,item.tile);render();
}
async function animateMovement(seat:number,path:number[],signal:AbortSignal){
 if(path.length<2||signal.aborted)return;
 if(reducedMotion.matches){displayedPositions.set(seat,path.at(-1)!);return;}
 const token=root.querySelector<SVGImageElement>(`[data-token="${seat}"]`),board=root.querySelector<SVGSVGElement>(".m-board-svg");if(!token||!board)return;
 movingSprite?.remove();movingShadow?.remove();revealBoardTile(path[0]);
 const start=token.getBoundingClientRect(),sprite=document.createElement("canvas"),shadow=document.createElement("div");movingSprite=sprite;movingShadow=shadow;
 sprite.width=40;sprite.height=32;sprite.getContext("2d")!.drawImage(profiles[seat],0,0,40,32);sprite.dataset.movingSeat=String(seat);
 Object.assign(sprite.style,{position:"fixed",left:"0",top:"0",width:`${start.width}px`,height:`${start.height}px`,opacity:getComputedStyle(token).opacity,zIndex:"60",pointerEvents:"none",imageRendering:"pixelated",transformOrigin:"50% 100%",transform:`translate(${start.left}px,${start.top}px)`});
 Object.assign(shadow.style,{position:"fixed",left:"0",top:"0",width:`${start.width*.55}px`,height:"5px",borderRadius:"50%",background:"#303b3640",zIndex:"59",pointerEvents:"none",transform:`translate(${start.left+start.width*.225}px,${start.bottom-2}px)`});document.body.append(shadow,sprite);root.querySelectorAll<HTMLElement>(`[data-token="${seat}"],[data-token-part="${seat}"]`).forEach(el=>el.style.visibility="hidden");
 const space=boardSpace(root);let position=space.local(start);
 const destination=(tile:number)=>{const v=view!,positions=new Map(displayedPositions);positions.set(seat,tile);const template=document.createElement("template");template.innerHTML=renderBoardB(v.game,{seat:v.seat,selected,positions,target:null,birds:boardBirds,stealth:v.game.players.map((_,i)=>immune(v.game,i)),center:""});const image=template.content.querySelector<SVGImageElement>(`[data-token="${seat}"]`)!;return{x:Number(image.getAttribute("x"))+4,y:Number(image.getAttribute("y"))+4,w:Number(image.getAttribute("width")),h:Number(image.getAttribute("height"))}};
 for(let step=1;step<path.length&&!signal.aborted;step++){
  sound.play("hop");revealBoardTile(path[step]);const target=destination(path[step]),lift=Math.max(14,position.h*.85);
  sprite.dataset.step=String(moveProgress.done+1);sprite.dataset.tile=String(path[step]);root.querySelectorAll(".m-step-active").forEach(el=>el.classList.remove("m-step-active"));root.querySelector(`[data-inspect="${path[step]}"]`)?.classList.add("m-step-active");
  await new Promise<void>(resolve=>{
   let handle=0;const started=performance.now(),duration=300;
   const done=()=>{cancelAnimationFrame(handle);signal.removeEventListener("abort",done);resolve()};
   const frame=(now:number)=>{if(signal.aborted){done();return}const t=Math.min(1,(now-started)/duration),x=position.x+(target.x-position.x)*t,y=position.y+(target.y-position.y)*t,jump=Math.sin(Math.PI*t)*lift,w=position.w+(target.w-position.w)*t,h=position.h+(target.h-position.h)*t;
    const point=space.viewport({x,y:y-jump,w,h}),ground=space.viewport({x,y,w,h});
    sprite.dataset.progress=String(t);sprite.dataset.jump=String(jump*point.w/w);sprite.style.transform=`translate(${point.x}px,${point.y}px)`;sprite.style.width=`${point.w}px`;sprite.style.height=`${point.h}px`;
    shadow.style.width=`${point.w*.55}px`;shadow.style.transform=`translate(${ground.x+ground.w*.225}px,${ground.y+ground.h-2}px) scale(${1-.3*Math.sin(Math.PI*t)})`;
    if(t<1)handle=requestAnimationFrame(frame);else done();
   };signal.addEventListener("abort",done,{once:true});frame(started);
  });if(signal.aborted)return;
  await pause(TILE_STEP_MS-300,signal);if(signal.aborted)return;
  if(step===path.length-1)sound.play("land");position=target;displayedPositions.set(seat,path[step]);moveProgress.done++;presentationStage=`${seat+1}P · ${moveProgress.done} / ${moveProgress.total}칸 · ${BOARD[path[step]].name}`;updateStage();const progress=root.querySelector(".m-move-progress");if(progress)progress.textContent=`${moveProgress.done} / ${moveProgress.total}칸`;
 }
 root.querySelectorAll(".m-step-active").forEach(el=>el.classList.remove("m-step-active"));
}
function coordinates(index: number) { return index <= 9 ? [10, 10 - index] : index <= 18 ? [19 - index, 1] : index <= 27 ? [1, index - 17] : [index - 26, 10]; }
function editable() { return !drawingOrder && !!view && connected && !pending && !animating && !queue.length && view.started && !view.aborted && view.game.phase !== "finished" && view.seat === actingSeat(view.game); }
function localAction(action: Action) {
  if (!view || !view.started || animating) return;
  const next = structuredClone(view); applyAction(next.game, action); next.serverNow = Date.now();
  const keep = preservesDeadline(view.game, next.game, action);
  if (!keep) next.deadline = Date.now() + (next.game.phase === "augment" ? AUGMENT_SELECTION_MS : next.game.phase === "event" ? EVENT_MS : TURN_MS);
  receive(next, keep);
}
function scheduleLocal() {
  clearTimeout(timer); if (!view || !view.started || animating || drawingOrder || view.game.phase === "finished" || terminal) return;
  const automatic=automaticContinuation(view.game),bot = !!view.seats[actingSeat(view.game)].bot, remaining = Math.max(0, view.deadline - Date.now());
  timer = setTimeout(() => { if (!view || terminal) return; localAction(automatic??autoAction(view.game, bot)); }, automatic?250:bot ? Math.min(remaining, view.game.phase === "roll" ? 1100 : 700) : remaining);
}
function send(action: Action) {
  if (!view || !editable()) return; error = "";
  if (!online) { try { selected = null; localAction(action); } catch (e) { error = (e as Error).message; render(); } return; }
  if (socket?.readyState !== WebSocket.OPEN) return;
  pending = true; socket.send(JSON.stringify({ type: "MARBLE_ACTION", ...action, matchId: view.matchId, turnId: view.game.turnId, revision: view.game.revision })); render();
}
function startLocal(count: number) {
  resetPresentation(); needsBaseline = true; error = ""; dismissedResult = "";
  const seats = Array.from({ length: count }, (_, i) => ({ userId: i === 0 ? "local" : null, name: i === 0 ? "나" : `도도봇 ${i}`, ...(i ? { bot: "normal" } : {}), connected: true }));
  const game=createGame(seats.map(s=>s.name));
  receive({ type: "MARBLE_STATE", matchId: crypto.randomUUID(), game, seats:seats.map(s=>({...s,ready:!!s.bot})), seat: 0, started: false, deadline: 0, serverNow: Date.now() });
}
async function readyUp(){
  if(!view||view.started||view.seat<0||pending||!connected)return;
  await sound.unlock();
  const ready=!view.seats[view.seat].ready;
  if(online){
    if(socket?.readyState!==WebSocket.OPEN)return;
    pending=true;error="";socket.send(JSON.stringify({type:"MARBLE_READY",matchId:view.matchId,ready}));render();
  }else{
    const next=structuredClone(view);next.seats[next.seat].ready=ready;
    if(next.seats.every(s=>s.bot||s.ready&&s.connected)){
      next.started=true;drawTurnOrder(next.game);next.game.orderDrawUntil=Date.now()+ORDER_DRAW_MS;
      next.deadline=Date.now()+AUGMENT_SELECTION_MS+ORDER_DRAW_MS;
    }
    next.serverNow=Date.now();receive(next);
  }
}
function soundMarkup(){
  const p=sound.preferences;
  return `<details class="m-sound-settings" data-details="sound"><summary data-focus="sound" aria-label="사운드 설정">소리 ${p.enabled&&p.volume>0?"켜짐":"꺼짐"}</summary><div><label><input type="checkbox" data-sound-enabled data-focus="sound-enabled" ${p.enabled?"checked":""}>사운드</label><label><input type="checkbox" data-sound-music data-focus="sound-music" ${p.music?"checked":""}>배경음악</label><label class="m-volume">음량 <output data-sound-value>${Math.round(p.volume*100)}%</output><input type="range" min="0" max="100" value="${Math.round(p.volume*100)}" data-sound-volume data-focus="sound-volume" aria-label="음량"></label></div></details>`;
}
function lobbyMarkup(){
  const v=view!,humans=v.seats.filter(s=>!s.bot),readyCount=humans.filter(s=>s.ready&&s.connected).length,me=v.seat<0?null:v.seats[v.seat];
  return `<section class="m-lobby" aria-labelledby="m-lobby-title"><header class="m-lobby-heading"><h2 id="m-lobby-title">게임 대기실</h2><span data-ready-count aria-live="polite">준비 ${readyCount} / ${humans.length}</span></header>
    <div class="m-lobby-players">${v.seats.map((s,i)=>`<article class="m-lobby-player ${s.ready?"is-ready":""}" style="--seat:${COLORS[i]}" data-lobby-seat="${i}"><img src="${boardBirds[i]}" alt=""><div><strong>${i+1}P ${escape(s.name)}${i===v.seat?" · 나":""}</strong><span>${s.bot?"도도봇":s.connected?"접속 중":"접속 대기"}</span></div><b class="m-ready-status">${s.bot?"자동 준비":s.ready&&s.connected?"준비 완료":"준비 대기"}</b></article>`).join("")}</div>
    <div class="m-lobby-start">${me&&!me.bot?`<button class="m-primary" data-ready data-focus="ready" aria-pressed="${!!me.ready}" ${!connected||pending?"disabled":""}>${pending?"확인 중…":me.ready?"준비 취소":"준비 완료"}</button><p>봇을 제외한 모두가 준비하면 순서 추첨 후 시작합니다.</p>`:`<p>관전 중 · 참가자들이 준비하면 시작합니다.</p>`}<p class="m-error" role="status">${escape(error)}</p></div>
    <section class="m-lobby-guide"><div><h3>게임 설명</h3><button data-rules data-focus="lobby-rules">전체 규칙 보기</button></div><div class="m-lobby-rules"><section><b>승리 조건</b><p>색상 그룹 ${COLOR_GROUPS_TO_WIN}개 독점 · 한 변 독점 · 최후 생존</p></section><section><b>진행 순서</b><p>순서 추첨 → 첫 증강 선택 → 주사위와 이동</p></section><section><b>땅과 건물</b><p>처음에는 땅을 매입하고 재방문해 건설합니다. 세 번째 바퀴부터 매입·인수 직후 건설할 수 있습니다.</p></section><section><b>돈과 증강</b><p>기본 월급 ${SALARY}만원 · 보유 현금 세금 10%. 증강은 시작 전과 출발선 1·3·5회 통과 때 선택합니다.</p></section></div></section>
  </section>`;
}
root.addEventListener("input",event=>{
  const el=event.target as HTMLInputElement;
  if(el.hasAttribute("data-sound-volume")){
    sound.configure({volume:Number(el.value)/100});
    const output=root.querySelector("[data-sound-value]");if(output)output.textContent=`${el.value}%`;
    const summary=root.querySelector(".m-sound-settings summary");if(summary)summary.textContent=`소리 ${sound.preferences.enabled&&sound.preferences.volume>0?"켜짐":"꺼짐"}`;
  }
});
root.addEventListener("change",event=>{
  const el=event.target as HTMLInputElement;
  if(el.hasAttribute("data-sound-enabled")){sound.configure({enabled:el.checked});render();if(el.checked)sound.play("ready");}
  else if(el.hasAttribute("data-sound-music")){sound.configure({music:el.checked});}
});
function button(label: string, action: Action["action"], disabled = false, extra = "", primary = false) {
  return `<button ${extra} data-action="${action}" data-focus="${action}-${extra.replace(/[^\w-]/g, "")}" class="${primary ? "m-primary" : ""}" ${!editable() || disabled ? "disabled" : ""}>${label}</button>`;
}
function quote(base: number, cost: number, seat = view!.game.turn, refundable = true) {
  const refund = refundable ? cashbackAmount(view!.game, seat, cost) : 0;
  return `<div class="m-quote"><span>이번 지출</span><strong>${money(cost)}</strong>${cost !== base ? `<small>정가 ${base}만원 · 증강 적용 후</small>` : ""}${refund ? `<small>지급 후 페이백 +${refund}만원</small>` : ""}</div>`;
}
function eventPickKind():"player"|"line"|"tile"|"boundary"|null{const g=view?.game;if(g?.phase!=="event")return null;const id=g.world.current?.id;return id==="festival"&&eventOwnedTiles(g).length?"tile":id==="wall"&&g.world.walls.length<36?"boundary":id==="line_quake"?"line":["telekinesis","long_robbery","hero","tranquilizer"].includes(id??"")?"player":null;}
function directPickKind():ReturnType<typeof eventPickKind>{if(!view||!editable())return null;const g=view.game;if(g.phase==="roll"&&g.abilities.pendingTarget)return "player";return directPickingKey===`${view.matchId}:${g.world.current?.serial}`?eventPickKind():null;}
function directPlayerTargets(){if(directPickKind()!=="player")return [];return view!.game.phase==="event"?eventTargets(view!.game):turnTargets(view!.game);}
function pickPlayer(seat:number){if(!directPlayerTargets().includes(seat))return;const g=view!.game;if(g.phase==="roll")send({action:"ability_target",target:seat});else if(g.world.current!.id==="telekinesis"){eventPlayerChoice={key:`${view!.matchId}:${g.world.current!.serial}`,seat};directPickingKey="";render();}else send({action:"event_resolve",eventSerial:g.world.current!.serial,target:seat});}
function saleTiles(){if(!view||view.game.phase!=="debt"||!editable())return [];return BOARD.filter(t=>view!.game.properties[t.index].owner===view!.game.turn&&!view!.game.properties[t.index].landmark).map(t=>({tile:t.index,amount:saleProceeds(view!.game,t.index,view!.game.turn)}));}
function pickSale(tile:number){if(!saleTiles().some(t=>t.tile===tile))return;send({action:"sell",tile});}
function pickEventTile(tile:number){if(directPickKind()!=="tile"||!eventOwnedTiles(view!.game).includes(tile))return;send({action:"event_resolve",eventSerial:view!.game.world.current!.serial,tile});}
function pickBoundary(tile:number){if(directPickKind()!=="boundary"||view!.game.world.walls.includes(tile))return;send({action:"event_resolve",eventSerial:view!.game.world.current!.serial,tile});}
function pickInstruction(){const kind=eventPickKind();return kind==="player"?"플레이어 목록에서 대상을 누르세요.":kind==="line"?"맵에서 지진을 일으킬 라인을 누르세요.":kind==="boundary"?"빛나는 칸 사이 경계를 눌러 벽을 설치하세요.":"빛나는 내 땅을 눌러 축제를 여세요.";}
function pickButtonLabel(){return eventPickKind()==="player"?"플레이어 목록에서 고르기":eventPickKind()==="line"?"맵에서 라인 고르기":eventPickKind()==="boundary"?"보드에서 경계 고르기":"보드에서 땅 고르기";}
function pickLine(line:number){if(directPickKind()!=="line")return;send({action:"event_resolve",eventSerial:view!.game.world.current!.serial,line});}
function controls() {
  const v = view!, g = v.game, seat = actingSeat(g), player = g.players[seat], t = BOARD[player.position], p = g.properties[t.index];
  if (v.aborted) return `<h2>경기 중단</h2><p>${escape(v.aborted)}</p>`;
  if (g.phase === "finished") return `<h2>${g.winner! + 1}P 승리</h2><p>${reason[g.reason!]}</p><button data-show-result>경기 결과 보기</button>`;
  if (!v.started) return `<h2>참가자 준비 대기</h2><p>봇을 제외한 모든 참가자가 준비하면 시작합니다.</p>`;
  if (animating) return "";
  if(seat!==v.seat&&["roll","dice"].includes(g.phase))return `<h2>${seat+1}P ${escape(player.name)} 진행 중</h2><p>${g.phase==="dice"?'주사위 결과를 확인하고 있습니다.':'주사위를 준비하고 있습니다.'}</p>`;
  if(g.phase==="portal")return `<h2>포탈 · 목적지 선택</h2><p>보드에서 이동할 땅을 직접 누르세요.</p>`;
  if(g.phase==="event"&&directPickKind())return eventControls();
  if(g.phase==="event")return `<h2>이벤트 확인 중</h2><p>중앙 카드에서 이벤트를 확인하세요.</p>`;
  if(g.phase==="rent")return `<h2>통행료 ${g.world.rent!.amount}만원</h2><p>지급 전에 하이패스 쿠폰을 사용할 수 있습니다. 남은 쿠폰 ${g.world.players[seat].passCoupons}개</p>${button("쿠폰 사용 · 통행료 면제","coupon_pass",false,"",true)}${button("통행료 지불","rent_pay")}`;
  if (g.phase === "augment") return `<h2>${seat === v.seat ? "증강을 선택하세요" : `${seat + 1}P 증강 선택 중`}</h2><p>${seat === v.seat ? "카드1장을 고르면 즉시 획득합니다. 각 카드 위치는1회씩 바꿀 수 있습니다." : "상대의 선택지는 공개되지 않습니다. 획득한 증강은 플레이어 목록에서 볼 수 있습니다."}</p>`;
  if (g.phase === "roll") {
    if (g.abilities.pendingTarget) return `<h2>블라디미르 · 대상 선택</h2><p>같은 라인에서 재산을 흡수할 상대를 고르세요.</p><p>오른쪽 플레이어 목록에서 대상을 선택하세요.</p>`;
    const choices = availableDice(g), roll = g.abilities.roll, status = g.abilities.statuses[g.turn];
    if(g.world.players[seat].sleepThisTurn)return `<h2>수면 · 이번 차례 쉬기</h2><p>남은 수면 ${g.world.players[seat].sleep}회</p>${button("이번 차례 쉬기","roll",false,"",true)}`;
    if (status.skipTurns) return `<h2>${escape(status.skipBy ?? "덫")}에 걸렸습니다</h2><p>앞으로 ${status.skipTurns}차례를 쉽니다. 이번 차례를 넘겨주세요.</p>${button("덫 · 이번 차례 쉬기", "roll", false, "", true)}`;
    if (player.rest) return `<h2>무인도 대기</h2><p>더블이면 무료 탈출 후 나온 합만큼 이동합니다. 실패하면 이번 차례가 끝납니다. ${lossAmount(g,seat,50)}만원을 내고 탈출할 수도 있습니다.</p>${button(`${lossAmount(g,seat,50)}만원 내고 무인도 탈출`, "escape", player.cash < lossAmount(g,seat,50))}${button("탈출 주사위 던지기", "roll", false, "", true)}`;
    const configured = roll ? `합계 ${roll.min}~${roll.max}${roll.forcedDouble ? " · 더블 확정" : roll.avoidDouble ? " · 더블 제외" : ""}` : "합계2~12 · 일반 주사위";
    return `${(status.restrictedRolls || status.restrictWholeTurn)?`<p>${status.restrictedBy??"능력 효과"} · 합계 2~10 · 주사위 능력 사용 불가</p>`:""}${button(g.abilities.ordinal?"한 번 더 굴리기":"주사위 굴리기", "roll", false, "", true)}${roll?`<div class="m-roll-setting">${configured}</div>`:""}${choices.selectiveDouble ? [button("더블로 굴리기", "dice_double", false, 'data-use-new="true"'), button("더블 없이 굴리기", "dice_double", false, 'data-use-new="false"')].join("") : ""}${choices.copies.length ? `<fieldset class="m-dice-choices"><legend>따라쟁이 · 굴리기 대신 이만큼 이동</legend>${choices.copies.map(n => button(`${n}칸`, "dice_copy", false, `data-option="${n}"`)).join("")}</fieldset>` : ""}${choices.workSubsidy ? button(`이동 대신 ${salaryAmount(g, g.turn)}만원 월급 받기`, "subsidy") : ""}${player.position === 9 && power(g, seat, "island_owner") && g.abilities.islandOwner === null ? button(`무인도 매수 · ${lossAmount(g,seat,ISLAND_COST)}만원`, "island_buy", player.cash < lossAmount(g,seat,ISLAND_COST)) : ""}`;
  }
  if (g.phase === "dice") {
    const roll = g.abilities.roll!, choices = availableDice(g);
    if (roll.comparison) return `<span class="m-eyebrow">블랙다이스</span><h2>사용할 결과를 고르세요</h2><div class="m-dice-comparison"><article><small>기존 결과</small><strong>${roll.result!.join(" + ")}</strong><span>${roll.result![0] + roll.result![1]}칸</span>${button("기존 결과 유지", "dice_choose", false, 'data-use-new="false"')}</article><article><small>새 결과</small><strong>${roll.comparison.join(" + ")}</strong><span>${roll.comparison[0] + roll.comparison[1]}칸</span>${button("새 결과 사용", "dice_choose", false, 'data-use-new="true"')}</article></div><p>아직 이동하지 않았습니다. 시간이 끝나면 기존 결과를 유지하고 이동합니다.</p>`;
    return `<span class="m-eyebrow">이동 전 · 결과 확인</span><h2>${g.dice.filter(n=>n>0).join(" + ")} = ${g.dice[0] + g.dice[1]}칸</h2><p>${choices.rerolls.length ? "남은 리롤을 사용하거나 이 결과로 이동하세요." : "사용할 수 있는 리롤을 모두 썼습니다. 결과를 확정하면 이동합니다."} 리롤해도 제한 시간은 늘어나지 않습니다.</p>${choices.rerolls.map(ability => ability === "suspicious_dice" ? [0, 1].map(die => button(`${die + 1}번 주사위(${g.dice[die]}) 다시 굴리기`, "dice_reroll", false, `data-ability="${ability}" data-die="${die}"`)).join("") : button(ability === "red_dice" ? "레드다이스 · 다시 굴리기" : "블랙다이스 · 다시 굴려 비교하기", "dice_reroll", false, `data-ability="${ability}"`)).join("")}${button(`${g.dice[0] + g.dice[1]}칸 이동 확정`, "dice_confirm", false, "", true)}`;
  }
  if (g.phase === "buy") return `<span class="m-eyebrow">주인 없는 지역</span><h2>${t.name} 매입</h2><p>이번 방문에는 땅을 매입하고 깃발만 세웁니다. 다음 차례 이후 다시 방문하면 건설할 수 있습니다.</p>${quote(t.price, purchaseCost(g, t.index))}${button(`${purchaseCost(g, t.index)}만원에 매입`, "buy", player.cash < purchaseCost(g, t.index), "", true)}${button("매입하지 않고 진행", "skip")}`;
  if (g.phase === "build") {
    const landmark = landmarkAvailable(g,t.index);
    return `<span class="m-eyebrow">내 지역</span><h2>${t.name} ${p.landmark ? "랜드마크" : "건설"}</h2><p>감면 전 청구 통행료 ${money(displayedRent(g, t.index))}. 상대의 유리대포 등 보유 증강에 따라 최종 지출이 달라질 수 있습니다.</p><div class="m-build-options" data-build-key="${g.turnId}-${t.index}">${BUILDINGS.map((_, i) => {
      const b = construction(t.index, i), cost = buildCost(g, t.index, i), built = !!(p.buildings & (1 << i));
      const preview = structuredClone(g); preview.properties[t.index].buildings |= 1 << i;
      const increase = displayedRent(preview, t.index) - displayedRent(g, t.index), refund = cashbackAmount(g, seat, cost);
      return `<label class="m-build-choice"><input type="checkbox" data-build-choice value="${i}" ${built||player.cash<cost||!editable()?"disabled":""} ${built?"checked":""}><span>${b.name}<small>${built?"건설 완료":`${cost}만원 · 청구액 +${increase}만${refund?` · 환급${refund}만`:""}`}</small></span></label>`;
    }).join("")}</div>${button("선택한 건물 건설", "build",false,'data-build-selected="true"',true)}${landmark ? `${quote(landmarkBase(t.index), landmarkCost(g, t.index))}${button("랜드마크로 승격 · 통행료2배", "landmark", player.cash < landmarkCost(g, t.index))}<p>승격 후에는 인수·은행 매각이 불가능합니다.</p>` : p.buildings === 7 && !p.landmark ? power(g,g.turn,"landmark")?"<p>세 건물이 완공된 이 땅에 다시 도착하면 랜드마크를 건설할 수 있습니다.</p>":"<p>랜드마크 건설 증강을 보유해야 승격할 수 있습니다.</p>" : ""}${button("건설 마치고 차례 진행", "end", false, "", true)}`;
  }
  if (g.phase === "takeover") {
    if (p.landmark) return `<h2>${t.name} 랜드마크</h2><p>도착 처리가 끝났습니다. 랜드마크는 인수할 수 없습니다.</p>${button("차례 진행", "skip", false, "", true)}`;
    return `<span class="m-eyebrow">상대 지역 · 도착 처리 완료</span><h2>${t.name} 인수</h2><p>${p.owner! + 1}P에게 아래 금액을 내고 건물을 그대로 인수합니다. ${player.laps>=2?"인수 후 남은 건물을 바로 건설할 수 있습니다.":"세 번째 바퀴 전에는 인수 후 재방문해야 건설할 수 있습니다."}</p>${quote(takeoverBase(g,t.index), takeoverCost(g, t.index))}${button(`${takeoverCost(g, t.index)}만원에 인수`, "takeover", player.cash < takeoverCost(g, t.index), "", true)}${button("인수하지 않고 차례 진행", "skip")}`;
  }
  if (g.phase === "debt") return `<span class="m-eyebrow">${g.debt!.reason === "land_tax" ? "세금" : "통행료"} 미정산</span><h2>${money(g.debt!.amount)}이 필요합니다</h2><p>현재 현금 ${player.cash}만원 · 부족액 ${Math.max(0, g.debt!.amount - player.cash)}만원. 매각 가능한 지역을 선택하세요. 정가의50%에 수입 증강을 적용한 금액을 받습니다. 랜드마크는 매각할 수 없습니다.</p><p class="m-pick-instruction">보드에서 빛나는 내 땅을 직접 눌러 매각하세요. 땅에 표시된 +금액이 매각 대금입니다.</p><p>모두 매각했을 때 사용할 수 있는 돈 ${assets(g, g.turn)}만원.${g.debt!.reason === "land_tax" ? " 이번 세금은 매각해도 줄어들지 않습니다." : ""}</p>${button("파산 정산", "bankrupt", assets(g, g.turn) >= g.debt!.amount)}`;
  return `<span class="m-eyebrow">${escape(t.name)} 도착</span><h2>${g.extraTurn ? "더블 · 한 번 더!" : "이번 이동 완료"}</h2><p>${t.kind === "event" ? "이벤트 결과가 반영되었습니다. 발동 기록을 확인하세요." : t.kind === "rest" ? "최대 3턴 구금됩니다. 더블이면 무료 탈출합니다. 더블 추가 투척은 취소됩니다." : t.kind === "bonus" ? "보너스를 받았습니다. 적용된 증강은 아래 발동 기록에서 확인하세요." : "도착지 처리가 끝났습니다."}</p>${t.kind === "rest" && power(g,seat,"island_owner") && g.abilities.islandOwner===null ? button(`무인도 매수 · ${lossAmount(g,seat,ISLAND_COST)}만원`,"island_buy",player.cash<lossAmount(g,seat,ISLAND_COST)) : ""}${automaticContinuation(g)?'<p class="m-small-note">자동으로 진행합니다.</p>':button("추가 행동 없이 마치기", "end", false, "", true)}`;
}
function augmentMarkup() {
  const v = view!, g = v.game;
  if (drawingOrder || animating || !v.started || g.phase !== "augment" || v.aborted || v.seat !== actingSeat(g)) return "";
  const offer = g.augments?.players[v.seat].offer; if (!offer) return "";
  const tierIcon=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${offer.tier==='silver'?'M4 3h16v10l-8 8-8-8z':offer.tier==='gold'?'M2 6l5 5 5-8 5 8 5-5-3 14H5z':'M6 3h12l5 8-11 12L1 11z'}"/></svg>`;
  return `<div class="m-overlay"><section class="m-augment-dialog tier-${offer.tier}" data-tier="${offer.tier}" role="dialog" aria-modal="true" aria-labelledby="m-augment-title" aria-describedby="m-augment-help" tabindex="-1" data-dialog-key="offer-${v.matchId}-${offer.id}">
    <header><div><span class="m-eyebrow">증강 ${offer.round + 1}/4</span><h2 id="m-augment-title">${tierIcon}<span>${TIER_LABELS[offer.tier]} 증강 선택</span></h2></div><div class="m-choice-clock"><small>남은 시간</small><b class="m-augment-clock"></b></div></header>
    <p id="m-augment-help">${offer.cards.length}장 중1장을 획득합니다. 각 카드 위치는1회씩 리롤할 수 있습니다. 리롤해도 남은 시간은 늘어나지 않습니다.</p>
    <div class="m-augment-cards">${offer.cards.map((id, slot) => {
      const a = definition(id)!;
      return `<article><div class="m-card-top"><span class="m-tier-badge">${tierIcon}${TIER_LABELS[offer.tier]}</span><small>${slot + 1}번 카드</small></div><h3>${escape(a ? abilityLabel(a) : id)}</h3><span class="m-trigger">${a ? abilityTiming(a) : ""}</span><p>${escape(a?.description ?? "증강 설명을 불러오지 못했습니다.")}</p><details data-details="card-${offer.id}-${slot}"><summary>적용 범위와 중첩 보기</summary><ul>${(a ? abilityNotes(a) : []).map(n => `<li>${escape(n)}</li>`).join("")}</ul></details><div class="m-card-actions">${button("이 증강 선택", "augment_select", false, `data-offer="${escape(offer.id)}" data-slot="${slot}"`, true)}${button(offer.rerolled[slot] ? "리롤 불가" : "이 카드 리롤 · 1회", "augment_reroll", offer.rerolled[slot], `data-offer="${escape(offer.id)}" data-slot="${slot}"`)}</div></article>`;
    }).join("")}</div><footer><p>시간이 끝나면 <strong>현재 1번 카드</strong>를 자동 선택합니다. 이미 보유한 증강은 다시 나오지 않습니다. 남은 후보가 없으면 리롤할 수 없습니다.</p><p class="m-error" role="status">${escape(error)}</p></footer></section></div>`;
}
function rulesMarkup() {
 return `<div class="m-overlay"><section class="m-info-dialog m-rules-dialog" role="dialog" aria-modal="true" aria-labelledby="m-info-title" tabindex="-1" data-dialog-key="rules"><header><div><span class="m-eyebrow">플레이 가이드</span><h2 id="m-info-title">증강마블 규칙</h2></div><button data-close-info data-focus="close-info" aria-label="규칙 창 닫기">닫기</button></header>${rulesGuide()}</section></div>`;
}

function infoMarkup() {
  if (!info || animating||drawingOrder) return "";
  if (info.kind === "rules") return rulesMarkup();
  const a = definition(info.id); if (!a) return "";
  const labels = statusLabels(view!.game, info.seat);
  return `<div class="m-overlay"><section class="m-info-dialog m-ability-dialog tier-${a.tier}" role="dialog" aria-modal="true" aria-labelledby="m-info-title" tabindex="-1" data-dialog-key="ability-${info.seat}-${a.id}"><header><div><span class="m-eyebrow">${info.seat + 1}P 보유 · ${TIER_LABELS[a.tier]}</span><h2 id="m-info-title">${escape(abilityLabel(a))}</h2></div><button data-close-info data-focus="close-info" aria-label="능력 설명 닫기">닫기</button></header><span class="m-trigger">${abilityTiming(a)}</span><p class="m-ability-description">${escape(a.description)}</p><h3>발동과 중첩</h3><ul>${abilityNotes(a).map(n => `<li>${escape(n)}</li>`).join("")}</ul>${a.effect === "revival" ? `<p class="m-current-status">${escape(labels.find(l => l.startsWith("부활")) ?? "획득 효과 확인 중")}</p>` : ""}<p class="m-small-note">이름 옆의 증강 버튼을 눌러 언제든 이 설명을 다시 볼 수 있습니다.</p></section></div>`;
}
function boardDiceControls(){return !!view&&["roll","dice"].includes(view.game.phase);}
function ownDiceControls(){return boardDiceControls()&&view!.started&&view!.seat===actingSeat(view!.game)&&!view!.aborted&&!animating&&!drawingOrder;}
function boardMarkup() {
 const v=view!,g=v.game,centerSeat=g.winner??actingSeat(g),target=g.phase==="dice"&&!animating?projectedLanding(g):landingTarget;
 const center=`<div class="m-center" style="--seat:${COLORS[centerSeat]}" data-center-seat="${centerSeat}"><div class="m-dice" role="img" aria-label="${g.dice.length?`주사위 ${g.dice.join(', ')}`:'주사위 대기'}">${(g.world.players[g.turn].lostThisTurn?[0]:[0,1]).map(i=>`<span class="m-die">${dieMarkup(g.dice[i]??0)}</span>`).join('')}</div><p class="m-center-hint">${target?`${target.seat+1}P · ${BOARD[target.tile].name} 도착${animating||g.phase==="dice"?" 예정":""}`:`${g.round}/${MAX_ROUNDS}라운드`}</p><span class="m-move-progress" aria-live="off">${animating&&moveProgress.total?`${moveProgress.done} / ${moveProgress.total}칸`:''}</span><div class="m-board-action-slot">${ownDiceControls()?`<section class="m-board-actions" aria-label="주사위 조작">${controls()}${couponControls()}<p class="m-error" role="status">${escape(error)}</p></section>`:""}</div></div>`;
 const boardGame={...g,properties:g.properties.map((p,i)=>displayedProperties.get(i)??p),world:heldWall===undefined?g.world:{...g.world,walls:[...g.world.walls,heldWall]}};
 return renderBoardB(boardGame,{seat:v.seat,selected,positions:displayedPositions,target,birds:boardBirds,stealth:g.players.map((p,i)=>g.phase!=="finished"&&!v.aborted&&!p.bankrupt&&immune(g,i)),center,salePick:saleTiles(),eventTilePick:directPickKind()==="tile"?eventOwnedTiles(g):[],boundaryPick:directPickKind()==="boundary"?BOARD.filter(t=>!g.world.walls.includes(t.index)).map(t=>t.index):[],portalPick:g.phase==="portal"&&editable(),linePick:directPickKind()==="line"});
}
function playersMarkup() {
  const v = view!, g = v.game, actor = actingSeat(g);
  return `<section class="m-players"><div class="m-section-title"><h2>플레이어</h2><span>증강에 마우스를 올리면 설명</span></div>${playerDisplayOrder(g).map(i => {const p=g.players[i];return `<article data-player-seat="${i}" ${directPlayerTargets().includes(i)?`data-pick-player="${i}" tabindex="0" role="button" aria-label="${escape(p.name)} 선택"`:""} class="m-player ${directPlayerTargets().includes(i)?"m-target-pickable":""} ${actor === i && g.phase !== "finished" ? "active" : ""} ${p.bankrupt ? "bankrupt" : ""}" style="--seat:${COLORS[i]}"><canvas data-profile="${i}" width="80" height="64"></canvas><div><strong><span>${i + 1}P</span> ${escape(p.name)}${v.seat === i ? " · 나" : ""}</strong><b class="m-money" data-cash-seat="${i}" style="--cash-font:${Math.max(9,Math.min(20,150/(displayedCash.get(i)??p.cash).toLocaleString().length))}px">${money(displayedCash.get(i)??p.cash)}</b><small>${p.bankrupt ? "파산" : `${BOARD.filter(t => g.properties[t.index].owner === i).length}개 지역 · 색상 독점 ${groupCount(g, i)}/${COLOR_GROUPS_TO_WIN} · 예상 세금 ${landTax(g,i,g.players[i].cash+salaryAmount(g,i))}만`}${v.seats[i].connected ? "" : " · 연결 끊김"}</small><div class="m-statuses">${statusLabels(g, i).map(label => `<span>${escape(label)}</span>`).join("")}</div><div class="m-ownership" aria-label="색상 그룹별 소유 현황">${GROUP_COLORS.map((color, group) => `<span style="--group:${color}" title="${String.fromCharCode(65 + group)} 그룹">${BOARD.filter(t => t.group === group).map(t => `<i class="${g.properties[t.index].owner === i ? "owned" : ""}"></i>`).join("")}</span>`).join("")}</div><div class="m-owned-augments">${(g.augments?.players[i].owned ?? []).map(id => { const a = definition(id); return `<button class="tier-${a?.tier ?? "silver"}" data-owned-seat="${i}" data-ability="${escape(id)}" data-effect="${a?.effect ?? ""}" data-focus="owned-${i}-${escape(id)}" aria-label="${escape(a?.name ?? id)} 설명 보기"><span>${a ? escape(abilityLabel(a)) : escape(id)}</span><small>${a ? TIER_LABELS[a.tier] : ""}</small></button>`; }).join("") || '<span class="m-no-augment">아직 획득한 증강 없음</span>'}</div></div></article>`;}).join("")}</section>`;
}
function inspectorMarkup() {
  if (selected === null) return "";
  const v = view!, g = v.game, t = BOARD[selected], p = g.properties[selected], visitor = v.seat >= 0 ? v.seat : undefined;
  const receipt = p.owner !== null ? displayedRent(g, t.index) : baseRent(t.index), personal = visitor !== undefined && p.owner !== visitor && p.owner !== null ? rentPayment(g, t.index, visitor) : null;
  return `<section class="m-inspector"><span class="m-eyebrow">선택한 칸 · ${t.index + 1}/36</span><h2>${t.name}${p.landmark ? " · 랜드마크" : ""}</h2>${t.kind === "city" ? `<dl><div><dt>토지 정가</dt><dd>${t.price}만원</dd></div><div><dt>소유자</dt><dd>${p.owner === null ? "주인 없음" : `${p.owner + 1}P`}</dd></div><div><dt>${p.owner === null ? "토지 기본 통행료" : "감면 전 청구액"}</dt><dd>${receipt}만원</dd></div>${personal !== null ? `<div><dt>내 방문 시 통행료</dt><dd>${personal}만원</dd></div>` : ""}${p.owner === null && visitor !== undefined ? `<div><dt>내 매입가</dt><dd>${purchaseCost(g, t.index, visitor)}만원</dd></div>` : ""}${p.owner !== null && p.owner !== visitor ? `<div><dt>${visitor === undefined ? "인수 기본액" : "내 최종 인수가"}</dt><dd>${p.landmark ? "인수 불가" : `${visitor === undefined ? takeoverBase(g,t.index) : takeoverCost(g, t.index, visitor)}만원`}</dd></div>` : ""}${p.owner === visitor ? `<div><dt>채무 시 매각 대금</dt><dd>${p.landmark ? "매각 불가" : `${saleProceeds(g, t.index, visitor)}만원`}</dd></div>` : ""}</dl><p>${p.revisitBoost?`재방문 통행료 +${p.revisitBoost*30}% / `:""}${p.festival?`축제 ${p.festival}회 · 다음 상대 방문까지 / `:""}${p.locust?`메뚜기떼 ${p.locust}회 적용 / `:""}${String.fromCharCode(65 + t.group)} 그룹 · ${t.line + 1}번 변. 통행료와 인수가는 현재 보유 증강을 반영합니다. 유리대포의 추가 수입·지출은 은행 지급·소멸로 별도 정산합니다.</p>` : `<p>${tileDescription(t.index)}</p>`}<div class="m-tile-occupants">${g.players.flatMap((player,i)=>!player.bankrupt&&player.position===t.index?[`<span style="--seat:${COLORS[i]}"><img src="${boardBirds[i]}" alt=""><b>${i+1}P ${escape(player.name)}</b></span>`]:[]).join('')}</div>${g.abilities.marks.filter(m => m.tile === t.index).map(m => `<p class="m-current-status">${m.owner + 1}P의 ${m.kind === "gas" ? "방귀" : m.kind === "trap" ? "덫" : "독"} · ${(m.expiresRound ?? g.round) - g.round}라운드 뒤 만료</p>`).join("")}</section>`;
}
function resultMarkup() {
  const v = view!, g = v.game;
  if (animating || dismissedResult === v.matchId || (g.phase !== "finished" && !v.aborted)) return "";
  return `<div class="m-overlay"><section class="m-result" role="dialog" aria-modal="true" aria-labelledby="m-result-title" tabindex="-1" data-dialog-key="result-${v.matchId}"><canvas data-winner="${g.winner ?? 0}" width="120" height="96"></canvas><span class="m-eyebrow">${v.aborted ? "경기 중단" : "경기 종료"}</span><h2 id="m-result-title">${v.aborted ? "경기가 중단되었습니다" : `${escape(g.players[g.winner!].name)} 승리!`}</h2><p>${v.aborted ? escape(v.aborted) : reason[g.reason!]}</p>${g.players.map((p, i) => `<div><strong>${i + 1}P ${escape(p.name)}</strong><span>${p.bankrupt ? "파산" : `평가 자산 ${netWorth(g, i)}만원`}</span></div>`).join("")}<small>${online ? escape(rematch?.status ?? "결과를 저장하고 있습니다.") : "연습 결과는 전적에 저장되지 않습니다."}</small><button class="m-primary" data-restart data-focus="restart" ${online && (!connected || !rematch?.canVote) ? "disabled" : ""}>${online ? escape(rematch?.label ?? "재경기 투표") : "새 경기 시작"}</button><button data-dismiss data-focus="dismiss-result">보드 다시 보기</button></section></div>`;
}
function render() {
  if (!view) return;
  const previousBuildKey=root.querySelector<HTMLElement>("[data-build-key]")?.dataset.buildKey;
  const checkedBuilds=new Set([...root.querySelectorAll<HTMLInputElement>("[data-build-choice]:checked:not(:disabled)")].map(el=>el.value));
  const boardScroll=root.querySelector<HTMLElement>(".m-board-stage")?.scrollLeft;
  const previousEvent = root.querySelector<HTMLElement>("[data-event-key]");
  const eventValues = new Map([...previousEvent?.querySelectorAll<HTMLInputElement|HTMLSelectElement>("input,select") ?? []].map(el=>[el.dataset.focus,el.value]));
  const focus = (document.activeElement as HTMLElement | null)?.dataset.focus;
  const oldScroll = root.querySelector<HTMLElement>("[role=dialog]")?.scrollTop ?? 0;
  const oldModal = root.querySelector<HTMLElement>("[role=dialog]")?.dataset.dialogKey;
  const openDetails = new Set([...root.querySelectorAll<HTMLDetailsElement>("details[open][data-details]")].map(el => el.dataset.details));
  const v = view, g = v.game, actor = actingSeat(g), finished = g.phase === "finished" || !!v.aborted;
  turnPointer.set(!v.started||finished||drawingOrder?null:actor);
  sound.setActive(!finished);
  root.innerHTML = `<main class="m-shell"><header class="heading"><div><h1>증강마블</h1></div><div class="m-header-tools"><span class="m-mode">${online ? v.seat < 0 ? "온라인 · 관전" : "온라인 대전" : "도도봇과 연습"}</span>${soundMarkup()}<button data-rules data-focus="rules">규칙 보기</button></div></header>
  ${!v.started&&!finished?lobbyMarkup():`<div class="m-layout"><section class="m-play"><div class="m-turnbar" style="--seat:${COLORS[actor]}"><span class="m-live"></span><strong>${finished ? "경기 종료" : !connected ? "연결 복구 중" : !v.started ? "접속 대기" : `${actor + 1}P ${escape(g.players[actor].name)}${actor === v.seat ? " · 내 차례" : "의 차례"}`}</strong><span class="m-turn-number">${g.round}라운드 · ${g.turnId}턴</span><b class="m-clock" aria-label="남은 행동 시간">--</b></div>${boardMarkup()}<p class="m-board-caption">지역을 누르면 내 증강을 반영한 가격과 설치물을 확인할 수 있습니다.</p>
  <section class="m-history"><div><h2>진행 기록</h2><span>최근5개</span></div><ol>${(displayedLog ?? g.log).slice(-5).reverse().map((text, i) => `<li class="${i ? "" : "latest"}"><span>${i ? "·" : "최근"}</span>${escape(text)}</li>`).join("")}</ol></section></section>
  <aside class="m-sidebar">${!finished&&(actor!==v.seat||boardDiceControls()||animating||["augment","event"].includes(g.phase)&&!directPickKind())?"":`<section class="m-action-panel" aria-live="polite" aria-busy="${animating}">${g.world.interrupted ? `<p class="m-small-note">이벤트 이동 처리 · ${actor+1}P 선택 후 원래 차례로 돌아갑니다.</p>`:""}${controls()}${couponControls()}<p class="m-error" role="status">${escape(error)}</p></section>`}${playersMarkup()}${inspectorMarkup()}<section class="m-ability-history"><div class="m-section-title"><h2>능력 발동 기록</h2><span>최근6개</span></div>${g.abilities.events.some(e => e.id <= shownEventId&&e.ability!=="dice") ? `<ol>${g.abilities.events.filter(e => e.id <= shownEventId&&e.ability!=="dice").slice(-6).reverse().map(e => `<li><span>${e.actor + 1}P</span><p>${escape(e.caption)}</p></li>`).join("")}</ol>` : '<p class="m-small-note">증강을 획득하거나 효과가 적용되면 여기에 표시됩니다.</p>'}</section></aside></div>`}</main>${augmentMarkup() || eventMarkup() || infoMarkup() || resultMarkup()}`;
  root.querySelectorAll<HTMLCanvasElement>("canvas[data-profile], canvas[data-mascot], canvas[data-winner]").forEach(canvas => { const i = Number(canvas.dataset.profile ?? canvas.dataset.token ?? canvas.dataset.mascot ?? canvas.dataset.winner ?? 0), ctx = canvas.getContext("2d")!; ctx.imageSmoothingEnabled = false; ctx.drawImage(profiles[i], 0, 0, canvas.width, canvas.height); });
  root.querySelectorAll<HTMLDetailsElement>("details[data-details]").forEach(el => { if (openDetails.has(el.dataset.details)) el.open = true; });
  const modal = root.querySelector<HTMLElement>("[role=dialog]"); root.querySelector<HTMLElement>(".m-shell")!.inert = !!modal;
  document.body.style.overflow = modal ? "hidden" : "";
  if (modal && modal.dataset.dialogKey === oldModal) modal.scrollTop = oldScroll;
  if(previousBuildKey===root.querySelector<HTMLElement>("[data-build-key]")?.dataset.buildKey)for(const el of root.querySelectorAll<HTMLInputElement>("[data-build-choice]:not(:disabled)"))el.checked=checkedBuilds.has(el.value);
  const currentEvent=root.querySelector<HTMLElement>("[data-event-key]");
  if(previousEvent?.dataset.eventKey===currentEvent?.dataset.eventKey)for(const el of currentEvent?.querySelectorAll<HTMLInputElement|HTMLSelectElement>("input,select")??[]){const value=eventValues.get(el.dataset.focus);if(value!==undefined)el.value=value;}
  const candidates = [...root.querySelectorAll<HTMLElement>("[data-focus]")];
  const restore = focus ? candidates.find(el => el.dataset.focus === focus && (!modal || modal.contains(el)) && !(el as HTMLButtonElement).disabled) : undefined;
  if (restore) restore.focus({ preventScroll: true });
  else if (modal) { if (oldModal !== modal.dataset.dialogKey || !modal.contains(document.activeElement)) (modal.querySelector<HTMLElement>("button:not(:disabled),summary") ?? modal).focus({ preventScroll: true }); }
  else if (returnFocus) { candidates.find(el => el.dataset.focus === returnFocus)?.focus({ preventScroll: true }); returnFocus = ""; }
  const boardStage=root.querySelector<HTMLElement>(".m-board-stage");if(boardStage){if(boardScroll!==undefined)boardStage.scrollLeft=boardScroll;else revealBoardTile(g.players[v.seat>=0?v.seat:actor].position)}
  positionBoardControls();tick();
}
function positionBoardControls(){
 const center=root.querySelector<HTMLElement>(".m-center"),board=root.querySelector<HTMLElement>(".m-board"),svg=root.querySelector<SVGSVGElement>(".m-board-svg"),stage=root.querySelector<HTMLElement>(".m-board-stage");if(!center||!board||!svg||!stage)return;
 const b=board.getBoundingClientRect(),s=svg.getBoundingClientRect(),v=stage.getBoundingClientRect(),scale=s.width/908,left=Math.max(s.left+124*scale,v.left+10),right=Math.min(s.left+784*scale,v.right-10);
 center.style.left=`${(left+right)/2-b.left}px`;center.style.width=`${Math.max(120,Math.min(300,right-left))}px`;
}
root.addEventListener("scroll",positionBoardControls,{capture:true,passive:true});
window.addEventListener("resize",positionBoardControls);
root.addEventListener("click", event => {
 const saleTile=(event.target as Element).closest<SVGElement>("[data-pick-sale]");if(saleTile){pickSale(Number(saleTile.dataset.pickSale));return;}
 const eventTile=(event.target as Element).closest<SVGElement>("[data-pick-event-tile]");if(eventTile){pickEventTile(Number(eventTile.dataset.pickEventTile));return;}
 const boundary=(event.target as Element).closest<SVGElement>("[data-pick-boundary]");if(boundary){pickBoundary(Number(boundary.dataset.pickBoundary));return;}
 const portalTile=(event.target as Element).closest<SVGElement>("[data-pick-portal]");if(portalTile){send({action:"portal_move",tile:Number(portalTile.dataset.pickPortal)});return;}
 const pickLineNode=(event.target as Element).closest<SVGElement>("[data-pick-line]");if(pickLineNode){pickLine(Number(pickLineNode.dataset.pickLine));return;}
 const pickPlayerNode=(event.target as Element).closest<HTMLElement>("[data-pick-player]");if(pickPlayerNode&&!(event.target as Element).closest("button")){pickPlayer(Number(pickPlayerNode.dataset.pickPlayer));return;}

  const tile=(event.target as Element).closest<SVGElement>(".m-board-svg [data-inspect]");
  if(tile){if(!animating){selected=Number(tile.dataset.inspect);render()}return;}
  const b = (event.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!b || b.disabled || animating) return;
  sound.play("click");
  if(b.hasAttribute("data-ready")){void readyUp();}
  else if(b.hasAttribute("data-begin-pick")){eventPlayerChoice=null;directPickingKey=`${view!.matchId}:${view!.game.world.current!.serial}`;const kind=eventPickKind();render();root.querySelector(kind!=="player"?".m-board-stage":".m-players")?.scrollIntoView({block:"nearest",inline:"nearest"});}
  else if(b.hasAttribute("data-cancel-pick")){directPickingKey="";render();}
  else if (b.dataset.inspect !== undefined) { selected = Number(b.dataset.inspect); render(); }
  else if (b.hasAttribute("data-rules")) { returnFocus = b.dataset.focus ?? ""; info = { kind: "rules" }; render(); }
  else if (b.dataset.ownedSeat !== undefined) { returnFocus = b.dataset.focus ?? ""; info = { kind: "ability", seat: Number(b.dataset.ownedSeat), id: b.dataset.ability! }; render(); }
  else if (b.hasAttribute("data-close-info")) { info = null; render(); }
  else if (b.hasAttribute("data-dismiss")) { dismissedResult = view!.matchId; render(); }
  else if (b.hasAttribute("data-show-result")) { dismissedResult = ""; render(); }
  else if (b.hasAttribute("data-restart")) { if (online) void rematch?.vote(); else startLocal(view!.game.players.length); }
  else if (b.dataset.action) send({ eventSerial:b.dataset.eventSerial===undefined?undefined:Number(b.dataset.eventSerial), decline:b.dataset.decline==="true", amount:root.querySelector<HTMLInputElement>("[data-event-amount]") ? Number(root.querySelector<HTMLInputElement>("[data-event-amount]")!.value):undefined, line:root.querySelector<HTMLSelectElement>("[data-event-line]") ? Number(root.querySelector<HTMLSelectElement>("[data-event-line]")!.value):undefined, steps:root.querySelector<HTMLSelectElement>("[data-event-steps]") ? Number(root.querySelector<HTMLSelectElement>("[data-event-steps]")!.value):undefined, augmentId:root.querySelector<HTMLSelectElement>("[data-event-augment]")?.value, target: root.querySelector<HTMLSelectElement>("[data-event-target]") ? Number(root.querySelector<HTMLSelectElement>("[data-event-target]")!.value) : b.dataset.target === undefined ? undefined : Number(b.dataset.target), offerId: b.dataset.offer, ability: b.dataset.ability as Action["ability"], option: b.dataset.option === undefined ? undefined : Number(b.dataset.option), die: b.dataset.die === undefined ? undefined : Number(b.dataset.die) as 0 | 1, useNew: b.dataset.useNew === undefined ? undefined : b.dataset.useNew === "true", slot: b.dataset.slot === undefined ? undefined : Number(b.dataset.slot), action: b.dataset.action as Action["action"], buildings:b.dataset.buildSelected===undefined?undefined:Array.from(root.querySelectorAll<HTMLInputElement>("[data-build-choice]:checked:not(:disabled)")).map(el=>Number(el.value)), building: b.dataset.building === undefined ? undefined : Number(b.dataset.building), tile:root.querySelector<HTMLSelectElement>("[data-event-tile]") ? Number(root.querySelector<HTMLSelectElement>("[data-event-tile]")!.value) : b.dataset.tile === undefined ? undefined : Number(b.dataset.tile) });
});
root.addEventListener("keydown", event => {
 if(event.key==="Enter"||event.key===" "){const el=event.target as HTMLElement;if(el.hasAttribute("data-pick-boundary")){event.preventDefault();pickBoundary(Number(el.dataset.pickBoundary));return;}if(el.hasAttribute("data-pick-player")){event.preventDefault();pickPlayer(Number(el.dataset.pickPlayer));return;}if(el.hasAttribute("data-pick-line")){event.preventDefault();pickLine(Number(el.dataset.pickLine));return;}}

  const modal = root.querySelector<HTMLElement>("[role=dialog]"); if (!modal) return;
  if (event.key === "Escape" && info) { event.preventDefault(); info = null; render(); return; }
  if (event.key !== "Tab") return;
  const nodes = [...modal.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex='0']")].filter(el => el.getClientRects().length && !el.closest("details:not([open]) :not(summary)"));
  if (!nodes.length) { event.preventDefault(); modal.focus(); return; }
  const index = nodes.indexOf(document.activeElement as HTMLElement);
  if (index < 0 || (!event.shiftKey && index === nodes.length - 1) || (event.shiftKey && index === 0)) { event.preventDefault(); (event.shiftKey ? nodes.at(-1)! : nodes[0]).focus(); }
});
function tick() {
  if (!view) return;
  const remaining = Math.max(0, Math.ceil((view.deadline - Date.now() - offset) / 1000));
  for (const clock of root.querySelectorAll<HTMLElement>(".m-clock,.m-augment-clock")) { clock.textContent = view.started && view.game.phase !== "finished" && !view.aborted ? `${remaining}초` : "--"; clock.classList.toggle("urgent", remaining <= 10); }
}
const ticker = setInterval(tick, 250);
async function startOnline() {
  try {
    const credentials = await authenticate(root, "marble"); rematch = new RematchVoting(credentials.roomId, credentials.token, () => { if (view && !animating) render(); });
    const connect = () => {
      if (terminal) return;
      socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`);
      socket.onopen = () => { connected = true; needsBaseline = true; socket!.send(JSON.stringify({ type: "AUTH", ...credentials })); };
      socket.onmessage = event => {
        const m = JSON.parse(event.data);
        if (m.type === "MARBLE_STATE") receive(m);
        else if (m.type === "MARBLE_ERROR") { pending = false; error = m.message;sound.play("error"); if (!animating) render(); }
        else if (m.type === "REMATCH_STATUS") rematch!.receive(m);
        else if (m.type === "FINISHED") rematch!.saved();
        else if (m.type === "MATCH_REPLACED") location.reload();
        else if (["ROOM_CLOSED", "ERROR"].includes(m.type)) { terminal = m.terminal !== false; connected = false; error = m.message; resetPresentation(); if (view) render(); else root.textContent = m.message; }
      };
      socket.onclose = () => { connected = false; pending = false; resetPresentation(); needsBaseline = true; if (terminal) return; if (++retries > 8) { terminal = true; error = "연결하지 못했습니다. 페이지를 새로고침해주세요."; } else { error = "연결을 복구하고 있습니다. 재접속하면 최신 위치에서 이어집니다."; reconnect = setTimeout(connect, Math.min(8000, retries * 1000)); } if (view) render(); else root.textContent = error; };
    };
    root.textContent = "증강마블에 연결하고 있습니다…"; connect();
  } catch (e) { root.textContent = (e as Error).message; }
}
if (online) void startOnline();
else {
  root.innerHTML = `<main class="m-setup"><h1>증강마블</h1><canvas width="160" height="128"></canvas><label>플레이 인원<select id="m-count"><option value="2">나 + 도도봇 1명</option><option value="3">나 + 도도봇 2명</option><option value="4" selected>나 + 도도봇 3명</option></select></label><button class="m-primary" id="m-start">대기실로</button><small>연습은 전적에 저장되지 않습니다.<br>온라인 대전: 디스코드에서 !게임 증강마블</small></main>`;
  const canvas = root.querySelector("canvas")!, ctx = canvas.getContext("2d")!; ctx.imageSmoothingEnabled = false; ctx.drawImage(profiles[0], 0, 0, 160, 128);
  root.querySelector("#m-start")!.addEventListener("click", () => startLocal(Number(root.querySelector<HTMLSelectElement>("#m-count")!.value)));
}
window.addEventListener("pagehide", () => { terminal = true;augmentTooltip.hide(); sound.dispose();clearInterval(ticker); resetPresentation(); clearTimeout(reconnect); socket?.close(); }, { once: true });

function eventMarkup(){if(directPickKind())return "";if(!view||!view.started||animating||view.game.phase!=="event"||!view.game.world.current)return "";const g=view.game,event=eventDefinition(g.world.current!.id),actor=actingSeat(g);return `<div class="m-overlay m-event-overlay"><section class="m-event-dialog category-${event.category}" role="dialog" aria-modal="true" aria-labelledby="m-event-title" tabindex="-1" data-dialog-key="event-${view.matchId}-${g.world.current!.serial}"><header><span>${actor+1}P ${escape(g.players[actor].name)}</span><b class="m-augment-clock" aria-label="이벤트 선택 남은 시간">--</b></header><div class="m-event-card-symbol" aria-hidden="true">?</div>${eventControls()}${actor!==view.seat?`<p class="m-small-note">${actor+1}P의 선택을 기다리고 있습니다.</p>`:''}<p class="m-error" role="status">${escape(error)}</p></section></div>`}
function eventControls(){
 const g=view!.game,pending=g.world.current!,event=eventDefinition(pending.id),id=event.id;
 const locked=editable()?"":"disabled";
 const chosen=id==="telekinesis"&&eventPlayerChoice?.key===`${view!.matchId}:${pending.serial}`&&eventTargets(g).includes(eventPlayerChoice.seat)?eventPlayerChoice.seat:null;
 const select=(label:string,key:string,options:{value:string|number;label:string}[])=>`<label class="m-event-field">${label}<select data-event-${key} data-focus="event-${key}" ${locked}>${options.map(o=>`<option value="${escape(String(o.value))}">${escape(o.label)}</option>`).join("")}</select></label>`;
 let fields="";

 if(chosen!==null)fields+=`<p>${chosen+1}P ${escape(g.players[chosen].name)}</p>`+select("뒤로 밀어낼 칸 수","steps",[1,2,3].map(i=>({value:i,label:`${i}칸`})));

 if(id==="change_augment" && g.augments?.players[g.turn].owned.length)fields+=select("교체할 증강","augment",g.augments.players[g.turn].owned.map(id=>({value:id,label:AUGMENT_CATALOG.find(a=>a.id===id)?.name??id})));
 if(id==="bet")fields+=`<label class="m-event-field">베팅 금액 (최대 ${g.players[g.turn].cash}만원)<input data-event-amount data-focus="event-amount" type="number" min="0" max="${g.players[g.turn].cash}" step="1" value="0" ${locked}></label>`;
 return `<section class="m-event-result category-${event.category}" data-event-id="${id}" data-event-key="${escape(view!.matchId)}:${pending.serial}"><span class="m-eyebrow">${EVENT_CATEGORY_LABELS[event.category]} 이벤트 · 추첨 결과</span><h2 id="m-event-title">${escape(event.name)}</h2><p>${escape(event.description)}</p>${fields}${chosen!==null?`${button("선택 확정","event_resolve",false,`data-event-serial="${pending.serial}" data-target="${chosen}"`,true)}<button data-begin-pick ${locked}>대상 다시 선택</button>`:eventPickKind()?directPickKind()?`<p class="m-pick-instruction">${pickInstruction()}</p><button data-cancel-pick>선택 취소</button>`:`<button class="m-primary" data-begin-pick ${locked}>${pickButtonLabel()}</button>`:button(fields?"선택 확정":"이벤트 적용","event_resolve",false,`data-event-serial="${pending.serial}"`,true)}${id==="hero"||id==="change_augment"?button("사용하지 않기","event_resolve",false,`data-event-serial="${pending.serial}" data-decline="true"`):""}</section>`;
}
function couponControls(){
 const v=view!,g=v.game,s=g.world.players[g.turn];if(animating||g.phase==="finished"||g.world.interrupted)return "";
 const home=g.phase==="roll"&&!g.abilities.roll&&!g.abilities.pendingTarget&&!g.players[g.turn].rest&&!g.abilities.statuses[g.turn].skipTurns&&!s.sleepThisTurn;
 const extra=["buy","build","takeover","end"].includes(g.phase)&&!s.endLocked&&!g.extraTurn&&!g.players[g.turn].rest&&!g.abilities.statuses[g.turn].skipTurns;
 if(!home&&!extra)return "";
 return `<div class="m-coupon-controls">${home&&s.homeStones?button(`귀환석 사용 (${s.homeStones}개) · 월급 받고 차례 종료`,"home_stone"):""}${extra&&s.extraCoupons?button(`한번더 쿠폰 사용 (${s.extraCoupons}개)`,"extra_coupon"):""}</div>`;
}

root.addEventListener("keydown",event=>{const tile=(event.target as Element).closest<SVGElement>(".m-board-svg [data-inspect]");if(tile&&!animating&&(event.key==='Enter'||event.key===' ')){event.preventDefault();if(tile.hasAttribute("data-pick-sale")){pickSale(Number(tile.dataset.pickSale));return;}if(tile.hasAttribute("data-pick-event-tile")){pickEventTile(Number(tile.dataset.pickEventTile));return;}if(tile.hasAttribute("data-pick-portal")){send({action:"portal_move",tile:Number(tile.dataset.pickPortal)});return;}selected=Number(tile.dataset.inspect);render()}});
