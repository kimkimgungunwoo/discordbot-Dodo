import {BOARD,tileLines,value,checkWin,playerDisplayOrder,type Game} from './augment-marble.js';
import {blackState,hasBlack,protectedBlack,blackEmit,requestExecution} from './augment-marble-black.js';
export interface BreadTrail {tiles:number[];eaten:number}
export interface PaceCounter {lines:number[];count:number;turn:number}
export interface GuillotineMark {seat:number;line:number;round:number}
export interface BlackExpansion {
 initialized:string[];bread:Record<number,BreadTrail>;breadGrace:{seat:number;tile:number}[];
 pace:Record<number,PaceCounter>;guillotines:GuillotineMark[];nextGuillotine:Record<number,number>;
 collectorSafe:number[];lastRound:number;
}
export function expansion(g:Game):BlackExpansion{return blackState(g).expansion??={initialized:[],bread:{},breadGrace:[],pace:{},guillotines:[],nextGuillotine:{},collectorSafe:[],lastRound:g.round}}
export function initializeBlackExpansion(g:Game,random:()=>number=Math.random){
 if(!g.black?.acquisitionResolved||g.phase==='finished')return;const state=expansion(g);
 state.initialized=state.initialized.filter(key=>{const [seat,id]=key.split(":");return g.augments?.players[Number(seat)]?.owned.includes(id)});
 for(const seat of playerDisplayOrder(g))for(const id of g.augments?.players[seat].owned??[]){const key=`${seat}:${id}`;if(state.initialized.includes(key))continue;state.initialized.push(key);
  if(id==='bread'){const pool=BOARD.filter(t=>t.kind==='city').map(t=>t.index);for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.min(.999999,Math.max(0,random()))*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}state.bread[seat]={tiles:pool.slice(0,6),eaten:0};}
  if(id==='guillotine'){state.nextGuillotine[seat]=g.round+4;g.black.pending.push({kind:'guillotine',seat,options:[-1,0,1,2,3]});}
  if(id==='copernicus'||id==='pacemaker')blackEmit(g,seat,id,id==='copernicus'?'통행료 방향 반전':'라인 체류 감시 시작');
 }
}
export function activePacemaker(g:Game){return g.players.findIndex((p,seat)=>!p.bankrupt&&hasBlack(g,seat,'pacemaker'))}
/** Main-token checkpoints reset dwell even when the final tile returns to the old line. */
export function trackBlackMovement(g:Game,seat:number,tile=g.players[seat].position){
 if(!g.black?.acquisitionResolved||g.black.entityFrame?.seat===seat||g.abilities.movingEntity==='clone')return;
 const state=expansion(g),lines=tileLines(tile),counter=state.pace[seat];if(!counter){state.pace[seat]={lines,count:0,turn:-1};return}
 const overlap=counter.lines.filter(line=>lines.includes(line));if(!overlap.length){counter.lines=lines;counter.count=0}else counter.lines=overlap;
}
export function pacemakerTurnEnd(g:Game){
 const actor=activePacemaker(g),seat=g.turn;if(actor<0||actor===seat||g.players[seat].bankrupt)return;
 trackBlackMovement(g,seat);const counter=expansion(g).pace[seat];if(counter.turn===g.turnId)return;
 counter.turn=g.turnId;counter.count++;if(counter.count>=3){requestExecution(g,actor,seat,'pacemaker');counter.count=0;counter.lines=tileLines(g.players[seat].position)}
}
export function collectBread(g:Game,seat:number,tile=g.players[seat].position){
 const state=expansion(g),trail=state.bread[seat];if(!hasBlack(g,seat,'bread')||g.players[seat].bankrupt||!trail?.tiles.includes(tile))return false;
 trail.tiles=trail.tiles.filter(i=>i!==tile);trail.eaten++;state.breadGrace.push({seat,tile});
 if(g.properties[tile].owner===seat)g.properties[tile].breadBoost=true;
 blackEmit(g,seat,'bread',`빵조각 ${trail.eaten}/6`);return true;
}
export function breadVictory(g:Game){
 const state=expansion(g),winners=playerDisplayOrder(g).filter(s=>!g.players[s].bankrupt&&hasBlack(g,s,'bread')&&state.bread[s]?.eaten===6);
 if(!winners.length)return false;g.winners=winners;g.winner=winners[0];g.reason='bread';g.phase='finished';g.log.push(`${winners.map(s=>`${s+1}P`).join(' · ')} 빵조각 수집 승리`);return true;
}
export function breadArrival(g:Game,seat:number){
 if(!g.black?.acquisitionResolved)return false;collectBread(g,seat);breadVictory(g);
 const state=expansion(g),i=state.breadGrace.findIndex(v=>v.seat===seat&&v.tile===g.players[seat].position);if(i<0)return false;state.breadGrace.splice(i,1);return true;
}
/** Resolve the pickup batch before any final-arrival executions, allowing co-winners. */
export function breadArrivalBatch(g:Game,visits:{seat:number;tile:number;effects:boolean;settled?:boolean}[]){
 if(!g.black?.acquisitionResolved||visits.length<2)return;
 for(const v of visits)if(v.effects&&!v.settled&&!g.players[v.seat].bankrupt)collectBread(g,v.seat,v.tile);
 breadVictory(g);
}
export function guillotineRound(g:Game){
 if(!g.black?.acquisitionResolved||g.phase==='finished')return;const state=expansion(g);if(state.lastRound===g.round)return;state.lastRound=g.round;
 const due=state.guillotines.filter(m=>m.round<=g.round);state.guillotines=state.guillotines.filter(m=>m.round>g.round);
 const order=playerDisplayOrder(g),victims=order.filter(s=>!g.players[s].bankrupt&&due.some(m=>tileLines(g.players[s].position).includes(m.line)));
 const casters=order.filter(s=>!g.players[s].bankrupt&&(!victims.includes(s)||protectedBlack(g,s)||!!g.black!.clones[s]));
 const loot:{seat:number;cash:number}[]=[];g.black.deathBatch=true;
 for(const m of due){blackEmit(g,m.seat,'guillotine','단두대 집행');g.abilities.events.at(-1)!.black={line:m.line};}
 for(const target of victims){const mark=due.filter(m=>tileLines(g.players[target].position).includes(m.line)).sort((a,b)=>order.indexOf(a.seat)-order.indexOf(b.seat));const winner=mark.find(m=>casters.includes(m.seat));const actor=winner?.seat??mark[0].seat,cash=g.players[target].cash;
  requestExecution(g,actor,target,'guillotine',false,false);if(g.players[target].bankrupt&&winner)loot.push({seat:actor,cash});
 }
 for(const item of loot)if(!g.players[item.seat].bankrupt)g.players[item.seat].cash+=item.cash;
 g.black.deathBatch=false;
 for(const seat of order)if(!g.players[seat].bankrupt&&hasBlack(g,seat,'guillotine')&&g.round>=(state.nextGuillotine[seat]??Infinity)){
  state.nextGuillotine[seat]=g.round+4;g.black.pending.push({kind:'guillotine',seat,options:[-1,0,1,2,3]});
 }
 if(!g.black.pending.length)checkWin(g);
}
export function collectorActor(g:Game,target:number){return playerDisplayOrder(g).find(s=>s!==target&&!g.players[s].bankrupt&&hasBlack(g,s,'collector'))}
/** Called before ordinary liquidation; creditors receive only the cash that actually exists. */
export function collectorPayment(g:Game,seat:number,amount:number,creditor:number|null){
 if(!g.black?.acquisitionResolved||amount<=0||protectedBlack(g,seat)||expansion(g).collectorSafe.includes(seat)||collectorActor(g,seat)===undefined||g.players[seat].cash-amount>50)return false;
 const paid=Math.min(g.players[seat].cash,amount);g.players[seat].cash-=paid;if(creditor!==null)g.players[creditor].cash+=paid;
 requestExecution(g,collectorActor(g,seat)!,seat,'collector');g.phase='end';g.extraTurn=false;return true;
}
export function collectorThresholds(g:Game){
 if(g.phase==='finished'||!g.black?.active||!g.black.acquisitionResolved||g.augmentResume==='round30')return;
 const state=expansion(g);state.collectorSafe=state.collectorSafe.filter(s=>g.players[s].cash<=50);
 for(const target of playerDisplayOrder(g)){const actor=collectorActor(g,target);if(actor!==undefined&&!g.players[target].bankrupt&&g.players[target].cash<=50&&!state.collectorSafe.includes(target)){
  state.collectorSafe.push(target);requestExecution(g,actor,target,'collector');
 }}
}
export function executionLiquidation(g:Game,seat:number){return BOARD.reduce((sum,t)=>sum+(g.properties[t.index].owner===seat?Math.floor(value(g,t.index)/2):0),0)}
