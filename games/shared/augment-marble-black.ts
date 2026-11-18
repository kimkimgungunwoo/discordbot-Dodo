import {initializeBlackExpansion,collectorThresholds,executionLiquidation,expansion,trackBlackMovement,collectBread,breadVictory} from './augment-marble-black-expansion.js';
import type {BlackExpansion} from './augment-marble-black-expansion.js';
import { advanceMovement,BOARD, COLORS, sameLine, checkWin, arrive, forcedArrival, beginEventVisits, end, startTurn, value, saleProceeds, moveCloneAlongBoard, type Game, type Action } from './augment-marble.js';
import { AUGMENT_CATALOG, type AugmentDefinition } from './augment-marble-augments.js';
import { emitAbility } from './augment-marble-runtime.js';
import { bankCashChange,withMoneyReason } from './augment-marble-money.js';
import { revivePlayer, refreshGamble } from './augment-marble-effects.js';
export const BLACK_IDS=['collector','devour','goblin','redistribution','mind_control','dirge','leech','sniper','silent','shaco','adamant','landmark_takeover','unfair_trade','copernicus','bread','pacemaker','guillotine'] as const;
export type BlackId=typeof BLACK_IDS[number];
export interface Clone {position:number;skip:number;restricted:number;rest:number}
export interface BlackPrompt {kind:'guillotine'|'sniper'|'leech'|'goblin'|'shaco_arrival'|'survival'|'forced_clone';seat:number;targets?:number[];actor?:number;absorb?:boolean;bypass?:boolean;resume?:'arrival'|'forced';tile?:number;options?:number[];amount?:number;creditor?:number|null;attack?:'collector'|'devour'|'pacemaker'|'guillotine';initial?:boolean;}
export interface BlackState {expansion?:BlackExpansion;cloneMove?:{id:number;seat:number;path:number[];wall?:{boundary:number;tile:number;next:number}};active:boolean;silenced:boolean;pending:BlackPrompt[];clones:Record<number,Clone>;mainIsClone:number[];contacts:{actor:number;target:number}[];acquisitionResolved:boolean;arrivalBypass?:number;cloneResolved?:number;goblinResolved?:number;tradeThrow?:string;cloneMoved?:string;entityFrame?:{seat:number;position:number;rest:number;skip:number;restricted:number}; deathBatch?:boolean;normalMoveId?:number;cloneOnly?:boolean;forceBatch?:{seat:number;from:number;to:number;entity?:"main"|"clone"}[];}
export function blackState(g:Game):BlackState{return g.black??={active:false,silenced:false,pending:[],clones:{},mainIsClone:[],contacts:[],acquisitionResolved:false}}
export function hasBlack(g:Game,seat:number,id:BlackId){return !!g.augments?.players[seat]?.owned.includes(id)}
export function protectedBlack(g:Game,seat:number){return hasBlack(g,seat,'adamant')}
/** Report actual prevention only; capability and price previews stay pure. */
export function reportAdamantBlock(g:Game,seat:number,reason:string,source?:number){
 if(!protectedBlack(g,seat)||g.players[seat].bankrupt)return;
 if(g.abilities.events.some(e=>e.actor===seat&&e.blocked?.revision===g.revision&&e.blocked.reason===reason&&e.blocked.source===source))return;
 emitAbility(g.abilities,{actor:seat,tile:g.players[seat].position,ability:'adamant',visual:'buff',caption:`${source!==undefined&&source!==seat?`${source+1}P · `:''}${reason} 차단`,blocked:{reason,source,revision:g.revision},stage:'after_move'});
}
export function blackTargets(g:Game,seat:number){return g.players.flatMap((p,i)=>i!==seat&&!p.bankrupt&&!protectedBlack(g,i)?[i]:[])}
export function blackEmit(g:Game,seat:number,id:BlackId,caption:string,target?:number,amount?:number){emitAbility(g.abilities,{actor:seat,target,tile:g.players[target??seat].position,ability:id,caption,amount,visual:'buff',stage:'after_move'})}
function clearLand(g:Game,seat:number){g.properties.forEach((p,i)=>{if(p.owner===seat)g.properties[i]={owner:null,buildings:0,locust:p.locust}})}
function eliminate(g:Game,seat:number,actor:number,absorb:boolean,attack:BlackId){
 const p=g.players[seat];if(p.bankrupt)return;
 const cash=p.cash+(attack==='collector'?executionLiquidation(g,seat):0);if(absorb&&actor!==seat)g.players[actor].cash+=cash;else bankCashChange(g,seat,-p.cash);
 p.cash=0;p.bankrupt=true;clearLand(g,seat);delete blackState(g).clones[seat];g.abilities.marks=g.abilities.marks.filter(m=>m.owner!==seat);
 blackEmit(g,actor,attack,`${seat+1}P 처형${absorb?` · ${cash}만원 흡수`:''}`,seat,absorb?cash:0);
}
export function survivalOptions(g:Game,seat:number,bypass=false){const options:number[]=[];if(!bypass&&!g.players[seat].liquidationRescueUsed)options.push(0);if(!bypass&&!(g.black?.silenced&&!hasBlack(g,seat,'silent')&&!protectedBlack(g,seat))&&(g.world.players[seat].disabledUntil??0)<=g.round&&g.abilities.statuses[seat].revivals?.some(r=>!r.consumed))options.push(1);if(blackState(g).clones[seat])options.push(2,3);return options}
export function requestExecution(g:Game,actor:number,target:number,id:'collector'|'devour'|'pacemaker'|'guillotine',initial=false,absorb=true){
 if(g.phase==='finished'||g.players[target].bankrupt)return;if(protectedBlack(g,target)){reportAdamantBlock(g,target,id==='collector'?'징수의 총 · 처형':id==='devour'?'꿀꺽 · 처형':AUGMENT_CATALOG.find(a=>a.id===id)?.name??id,actor);return;}
 if(id==='collector'){initial=false;const safe=expansion(g).collectorSafe;if(!safe.includes(target))safe.push(target);}
 const state=blackState(g);if(state.pending.some(p=>p.kind==='survival'&&p.seat===target))return;
 const options=survivalOptions(g,target,!initial);
 if(options.length){state.pending.push({kind:'survival',seat:target,actor,absorb:absorb&&!initial,bypass:!initial,options,attack:id,initial});blackEmit(g,actor,id,`${target+1}P 처형 · 생존 수단 선택`,target);}
 else eliminate(g,target,actor,absorb&&!initial,id);
}
export function blackInsolvency(g:Game,seat:number,creditor:number|null){const options=survivalOptions(g,seat);if(!options.some(n=>n>=2))return false;blackState(g).pending.push({kind:'survival',seat,actor:creditor??seat,creditor,absorb:false,bypass:false,options});return true}
export function blackSteal(g:Game,actor:number,target:number,rate:number,id:BlackId){if(g.players[target].bankrupt)return;if(protectedBlack(g,target)){reportAdamantBlock(g,target,id==='collector'?'징수의 총 · 처형':id==='devour'?'꿀꺽 · 처형':AUGMENT_CATALOG.find(a=>a.id===id)?.name??id,actor);return;}const amount=Math.floor(g.players[target].cash*rate);if(amount<=0)return;withMoneyReason(g,AUGMENT_CATALOG.find(a=>a.id===id)?.name??"블랙 강탈",()=>{g.players[target].cash-=amount;g.players[actor].cash+=amount;});blackEmit(g,actor,id,`${target+1}P 현금 ${amount}만원 강탈`,target,amount)}
export function redistributeBlackCash(g:Game,red:number){
 let seats=g.players.flatMap((p,s)=>!p.bankrupt?[s]:[]);while(seats.length){const mean=seats.reduce((n,s)=>n+g.players[s].cash,0)/seats.length;const eligible=seats.filter(s=>!protectedBlack(g,s)||g.players[s].cash<=mean);if(eligible.length===seats.length)break;for(const seat of seats)if(!eligible.includes(seat))reportAdamantBlock(g,seat,'부의 재분배 · 현금 감소',red);seats=eligible;}const total=seats.reduce((n,s)=>n+g.players[s].cash,0),share=Math.floor(total/Math.max(1,seats.length)),remainder=total-share*seats.length;withMoneyReason(g,"부의 재분배",()=>{for(const [i,s]of seats.entries())g.players[s].cash=share+(i<remainder?1:0);});blackEmit(g,red,'redistribution','생존 플레이어 현금 균등분배',undefined,total);g.abilities.events.at(-1)!.black={targets:seats}
}
export function activateBlackChange(g:Game,seat:number,old:string,id:string,random:()=>number){
 if(!g.black?.acquisitionResolved)return;
 if(old==='shaco'&&id!==old)delete g.black.clones[seat];
 if(id==='silent'){g.black.silenced=true;blackEmit(g,seat,'silent','일반 증강 무효화 · 경기 종료까지 유지');g.abilities.events.at(-1)!.black={targets:blackTargets(g,seat).filter(s=>!hasBlack(g,s,'silent'))};}
 if(id==='shaco'&&!g.black.clones[seat]){g.black.clones[seat]={position:(g.players[seat].position+18)%36,skip:0,restricted:0,rest:0};blackEmit(g,seat,'shaco','분신 생성');g.abilities.events.at(-1)!.black={destinationTile:g.black.clones[seat].position};}
 if(id==='redistribution')redistributeBlackCash(g,seat);
 initializeBlackExpansion(g,random);
}
export function resolveBlackAcquisition(g:Game,random:()=>number){
 const state=blackState(g);if(state.acquisitionResolved)return;state.active=true;state.acquisitionResolved=true;
 state.silenced=g.players.some((_,s)=>hasBlack(g,s,'silent'));
 if(state.silenced)for(let i=0;i<g.players.length;i++)if(protectedBlack(g,i))reportAdamantBlock(g,i,'사일런트 · 증강 무효화',g.players.findIndex((_,s)=>hasBlack(g,s,'silent')));
 for(let seat=0;seat<g.players.length;seat++){if(protectedBlack(g,seat)){g.players[seat].rest=0;g.abilities.statuses[seat].skipTurns=0;g.abilities.statuses[seat].restrictedRolls=0;g.abilities.statuses[seat].nextTurnRestricted=false;g.abilities.statuses[seat].restrictWholeTurn=false;g.world.players[seat].sleep=0;g.world.players[seat].disabledUntil=0;}if(hasBlack(g,seat,'shaco')){state.clones[seat]={position:(g.players[seat].position+BOARD.length/2)%BOARD.length,skip:0,restricted:0,rest:0};blackEmit(g,seat,'shaco','분신 생성');g.abilities.events.at(-1)!.black={destinationTile:state.clones[seat].position}}if(hasBlack(g,seat,'silent')&&seat===g.players.findIndex((_,s)=>hasBlack(g,s,'silent'))){blackEmit(g,seat,'silent','일반 증강 무효화 · 경기 종료까지 유지');g.abilities.events.at(-1)!.black={targets:blackTargets(g,seat).filter(s=>!hasBlack(g,s,'silent'))}}}
 const red=g.players.findIndex((_,s)=>hasBlack(g,s,'redistribution'));
 if(red>=0)redistributeBlackCash(g,red);
 const collectors=g.players.flatMap((p,s)=>!p.bankrupt&&hasBlack(g,s,'collector')?[s]:[]);
 state.deathBatch=true;
 for(let target=0;target<g.players.length;target++){const actor=collectors.find(s=>s!==target);if(actor!==undefined&&g.players[target].cash<=50)requestExecution(g,actor,target,'collector',true)}
 state.deathBatch=false;
 initializeBlackExpansion(g,random);collectorThresholds(g);
 if(!state.pending.length)checkWin(g);
}
export function processBlackContacts(g:Game){if(!g.black)return;g.black.contacts=[];if(!g.black.active||!g.black.acquisitionResolved||g.augmentResume==='round30')return;collectorThresholds(g);if(!g.black.pending.length&&!g.black.deathBatch)checkWin(g);}
export function blackTurnStart(g:Game){const seat=g.turn,state=blackState(g);if(!state.active||g.players[seat].bankrupt)return;
 if(hasBlack(g,seat,'leech')){const targets=blackTargets(g,seat),max=Math.max(...targets.map(s=>g.players[s].cash)),rich=targets.filter(s=>g.players[s].cash===max);if(rich.length===1)blackSteal(g,seat,rich[0],.1,'leech');else if(rich.length>1)state.pending.push({kind:'leech',seat,targets:rich})}
 if(hasBlack(g,seat,'sniper')){const targets=blackTargets(g,seat).filter(s=>sniperEntities(g,seat,s).length>0);if(targets.length)state.pending.push({kind:'sniper',seat,targets})}
}
/** Only final arrivals trigger these hooks; passing another token cannot trigger devour. */
export function blackArrival(g:Game,seat:number,forced=false,random:()=>number=Math.random):boolean{
 const state=blackState(g);if(!state.active)return false;
 if(!forced&&state.arrivalBypass!==seat&&g.abilities.lastMove?.seat===seat&&state.normalMoveId===g.abilities.lastMove.id){
  if(hasBlack(g,seat,'goblin')&&state.goblinResolved!==g.abilities.lastMove.id){state.goblinResolved=g.abilities.lastMove.id;state.pending.push({kind:'goblin',seat,tile:g.players[seat].position,resume:'arrival'});return true}
  if(hasBlack(g,seat,'shaco')&&state.clones[seat]&&state.cloneResolved!==g.abilities.lastMove.id){state.cloneResolved=g.abilities.lastMove.id;state.pending.push({kind:'shaco_arrival',seat,resume:'arrival'});return true}
 }
 if(state.arrivalBypass===seat)delete state.arrivalBypass;
 collectBread(g,seat);if(breadVictory(g))return true;
 if(hasBlack(g,seat,'devour')){for(const target of g.players.flatMap((p,i)=>i!==seat&&!p.bankrupt?[i]:[])){const clone=state.clones[target];if((state.entityFrame?.seat===target?state.entityFrame.position:g.players[target].position)===g.players[seat].position||(state.entityFrame?.seat===target?g.players[target].position:clone?.position)===g.players[seat].position)requestExecution(g,seat,target,'devour')}}
 if(g.players[seat].position===0)blackStartContact(g,seat);
 return false;
}
/** Called once per start arrival or intermediate movement checkpoint. */
export function blackStartContact(g:Game,seat:number){
 if(!g.black?.active||g.players[seat].bankrupt)return;
 if(hasBlack(g,seat,'dirge')){for(let i=0;i<g.players.length;i++)if(i!==seat&&g.players[i].cash>0&&protectedBlack(g,i))reportAdamantBlock(g,i,'진흔곡 · 현금 강탈',seat);const targets=blackTargets(g,seat),first=g.abilities.nextEventId;let total=0;for(const target of targets){const before=g.players[target].cash;blackSteal(g,seat,target,.15,'dirge');total+=before-g.players[target].cash;}g.abilities.events=g.abilities.events.filter(e=>e.id<first||e.ability!=='dirge');if(total){blackEmit(g,seat,'dirge',`상대 ${targets.length}명 현금 15% 동시 강탈`,undefined,total);g.abilities.events.at(-1)!.black={targets};}}
}

export function blackMoveClone(g:Game,steps:number,direction:number,random:()=>number=Math.random){const seat=g.turn,state=blackState(g),clone=state.clones[seat];if(!clone)return;const key=`${g.turnId}:${g.abilities.ordinal}`;if(state.cloneMoved===key)return;state.cloneMoved=key;state.cloneMove={id:g.abilities.lastMove?.id??((state.cloneMove?.id??0)+1),seat,path:[clone.position]};if(clone.skip>0){clone.skip--;return}if(clone.rest>0){clone.rest--;return}const n=clone.restricted?Math.min(10,steps):steps;clone.restricted=Math.max(0,clone.restricted-1);moveCloneAlongBoard(g,n,direction,random);}

export function blackChoice(g:Game,input:Action,random:()=>number,catalog:readonly AugmentDefinition[]){
 const state=blackState(g),p=state.pending[0];if(!p)throw new Error('선택할 블랙 효과가 없습니다.');
 if(p.kind==='guillotine'){if(!p.options?.includes(input.option??-99))throw new Error('집행 라인을 선택해주세요.');if(input.option!==-1)expansion(g).guillotines.push({seat:p.seat,line:input.option!,round:g.round+4});state.pending.shift();return;}
 if(p.kind==='survival'){
  const option=input.option;if(option===undefined||!p.options?.includes(option))throw new Error('사용할 생존 수단을 선택해주세요.');
  if(option===0){const cash=g.players[p.seat].cash,proceeds=cash+BOARD.reduce((sum,t)=>sum+(g.properties[t.index].owner===p.seat?saleProceeds(g,t.index,p.seat):0),0);bankCashChange(g,p.seat,proceeds-cash);if(p.creditor!==undefined&&p.creditor!==null)g.players[p.creditor].cash+=proceeds;else bankCashChange(g,p.seat,-proceeds);clearLand(g,p.seat);g.players[p.seat].cash=0;g.players[p.seat].liquidationRescueUsed=true;}
  else if(option===1){if(!revivePlayer(g,p.seat))throw new Error('사용할 부활이 없습니다.');clearLand(g,p.seat);}
  else{const clone=state.clones[p.seat];if(!clone)throw new Error('희생할 개체가 없습니다.');if(option===2){g.players[p.seat].position=clone.position;state.mainIsClone.push(p.seat);if(state.entityFrame?.seat===p.seat){state.entityFrame.position=clone.position;state.entityFrame.rest=clone.rest;state.entityFrame.skip=clone.skip;state.entityFrame.restricted=clone.restricted;}}delete state.clones[p.seat];blackEmit(g,p.seat,'shaco',`${option===2?'본체':'분신'} 희생 · 처형 방어`)}
  state.pending.shift();if(!state.pending.length){checkWin(g);if(g.phase!=='finished'&&g.abilities.movement&&!g.players[g.turn].bankrupt){advanceMovement(g,random,catalog);return;}if(g.phase==='roll'&&g.abilities.startedTurn!==g.turnId)startTurn(g);}return;
 }
 if(p.kind==='forced_clone'){
  if(input.option!==0&&input.option!==1)throw new Error('이동할 개체를 선택해주세요.');const item=state.forceBatch?.find(i=>i.seat===p.seat),clone=state.clones[p.seat];if(!item||!clone)throw new Error('강제 이동 상태가 만료됐습니다.');if(input.option===1){item.entity='clone';item.from=clone.position;item.to=(clone.position+34)%36;}state.pending.shift();
  if(!state.pending.some(q=>q.kind==='forced_clone')){const items=state.forceBatch!;delete state.forceBatch;for(const item of items){if(item.entity==='clone'&&state.clones[item.seat])state.clones[item.seat].position=item.to;else g.players[item.seat].position=item.to;}g.flightBatch={id:(g.flightBatch?.id??0)+1,items:items.map(({seat,from,to,entity})=>({seat,from,to,entity}))};beginEventVisits(g,items.map(i=>({seat:i.seat,tile:i.to,effects:true,arrived:i.entity!=='clone',forced:true,entity:i.entity})),random,catalog);}return;
 }
 if(p.kind==='sniper'||p.kind==='leech'){
  const target=input.target;if(target===undefined||!p.targets?.includes(target)||g.players[target].bankrupt||protectedBlack(g,target))throw new Error('선택 가능한 상대를 골라주세요.');
  if(p.kind==='sniper'&&!sniperEntities(g,p.seat,target).includes(input.option===1?'clone':'main'))throw new Error('해당 개체는 저격 대상이 아닙니다.');
  if(p.kind==='sniper'&&input.option===1&&state.clones[target])state.clones[target].restricted=1;
  else if(p.kind==='sniper'){g.abilities.statuses[target].restrictedRolls=Math.max(1,g.abilities.statuses[target].restrictedRolls);g.abilities.statuses[target].restrictedBy='저격수'}
  blackSteal(g,p.seat,target,.1,p.kind);if(p.kind==='sniper'&&input.option===1){const e=g.abilities.events.at(-1);if(e)e.targetEntity='clone';}state.pending.shift();return;
 }
 if(p.kind==='goblin'){
  if(!Number.isInteger(input.option)||Math.abs(input.option!)>2)throw new Error('-2~+2칸을 선택해주세요.');const from=g.players[p.seat].position,to=(from+input.option!+36)%36;
  g.players[p.seat].position=to;g.abilities.lastMove={id:(g.abilities.lastMove?.id??0)+1,seat:p.seat,path:[from,to],flight:true};state.arrivalBypass=p.seat;state.pending.shift();blackEmit(g,p.seat,'goblin',`도깨비 · ${input.option!>0?'+':''}${input.option}칸`);arrive(g,random);return;
 }
 if(p.kind==='shaco_arrival'){
  const option=input.option;if(![0,1,2].includes(option??-1)||p.options&&!p.options.includes(option!))throw new Error('본체·분신·둘 다 중 선택해주세요.');state.pending.shift();const main=g.players[p.seat].position,clone=state.clones[p.seat];if(!clone)throw new Error('분신이 없습니다.');state.arrivalBypass=p.seat;
  const visits:Parameters<typeof beginEventVisits>[1]=[];
  if(option===0||option===2)visits.push({seat:p.seat,tile:main,effects:true,arrived:true});
  if(option===1||option===2)visits.push({seat:p.seat,tile:clone.position,effects:true,entity:'clone'});
  g.phase='end';beginEventVisits(g,visits,random,catalog);

 }
}
export function blackAutoChoice(g:Game):Action|null{const p=g.black?.pending[0];if(!p)return null;if(p.kind==='guillotine')return{action:'black_choice',option:0};if(p.kind==='survival')return{action:'black_choice',option:p.options?.find(n=>n===1)??p.options?.find(n=>n===3)??p.options?.[0]};if(p.targets){const target=p.targets.reduce((a,b)=>g.players[a].cash>=g.players[b].cash?a:b);return{action:'black_choice',target,option:p.kind==='sniper'&&!sniperEntities(g,p.seat,target).includes('main')?1:0};}if(p.kind==='goblin'){const seat=p.seat,origin=g.players[seat].position,score=(n:number)=>{const tile=BOARD[(origin+n+36)%36],owner=g.properties[tile.index].owner;return owner===seat?100:owner===null?50:-tile.price};return{action:'black_choice',option:[-2,-1,0,1,2].sort((a,b)=>score(b)-score(a))[0]}}return{action:'black_choice',option:p.options?.[0]??0}}

export function enterCloneVisit(g:Game,seat:number){const state=blackState(g),clone=state.clones[seat];if(!clone)return false;state.entityFrame={seat,position:g.players[seat].position,rest:g.players[seat].rest,skip:g.abilities.statuses[seat].skipTurns,restricted:g.abilities.statuses[seat].restrictedRolls};g.players[seat].position=clone.position;g.players[seat].rest=clone.rest;g.abilities.statuses[seat].skipTurns=clone.skip;g.abilities.statuses[seat].restrictedRolls=clone.restricted;return true}
export function leaveCloneVisit(g:Game){const state=g.black,frame=state?.entityFrame;if(!state||!frame)return;const clone=state.clones[frame.seat];if(clone){clone.position=g.players[frame.seat].position;clone.rest=g.players[frame.seat].rest;clone.skip=g.abilities.statuses[frame.seat].skipTurns;clone.restricted=g.abilities.statuses[frame.seat].restrictedRolls;}g.players[frame.seat].position=frame.position;g.players[frame.seat].rest=frame.rest;g.abilities.statuses[frame.seat].skipTurns=frame.skip;g.abilities.statuses[frame.seat].restrictedRolls=frame.restricted;delete state.entityFrame;}

export function queueTyphoonChoices(g:Game){const state=blackState(g),items=g.players.flatMap((p,seat)=>!p.bankrupt&&!protectedBlack(g,seat)?[{seat,from:p.position,to:(p.position+34)%36}]:[]);const clones=items.filter(i=>state.clones[i.seat]);if(!clones.length)return false;state.forceBatch=items;for(const i of clones)state.pending.push({kind:'forced_clone',seat:i.seat,options:[0,1]});return true}

export function sniperEntities(g:Game,seat:number,target:number):("main"|"clone")[]{const allowed=(pos:number)=>pos%9!==0&&!sameLine(pos,g.players[seat].position),out:("main"|"clone")[]=[];if(allowed(g.players[target].position))out.push('main');const clone=g.black?.clones[target];if(clone&&allowed(clone.position))out.push('clone');return out}

export function withCloneEntity<T>(g:Game,seat:number,run:()=>T):T{const previous=g.black?.entityFrame;enterCloneVisit(g,seat);try{return run()}finally{leaveCloneVisit(g);if(previous)blackState(g).entityFrame=previous}}
