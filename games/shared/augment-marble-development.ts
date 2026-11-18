import type { Game } from './augment-marble.js';
import { BOARD, BUILDINGS } from './augment-marble.js';
import { consumeLoss, lossAmount, power, reportMoney, spendCost } from './augment-marble-effects.js';
export const CREDIT_CAP=200,PERMIT_CAP=3;
export interface DevelopmentPlayer { credit:number; permits:number; teamInitialized:boolean; permitTurn:number|null }
export interface DevelopmentState { players:DevelopmentPlayer[] }
export function createDevelopmentState(count:number):DevelopmentState{return {players:Array.from({length:count},()=>({credit:0,permits:0,teamInitialized:false,permitTurn:null}))};}
export function initializeDevelopment(g:Game){
 g.development??={players:[]};
 for(let seat=0;seat<g.players.length;seat++){
  const state=g.development.players[seat]??={credit:0,permits:0,teamInitialized:false,permitTurn:null};
  if(!state.teamInitialized&&g.augments?.players[seat].owned.includes('builder_gold')){state.teamInitialized=true;state.permits=Math.min(PERMIT_CAP,state.permits+2);}
 }
 return g.development;
}
export function constructionCredit(g:Game,seat:number){return power(g,seat,'tax_account')?g.development?.players[seat]?.credit??0:0;}
export function recordTaxCredit(g:Game,seat:number,paid:number){
 if(!power(g,seat,'tax_account')||paid<=0)return;
 const state=initializeDevelopment(g).players[seat],amount=Math.min(CREDIT_CAP-state.credit,Math.floor(paid/lossAmount(g,seat,1)));
 if(amount<=0)return;state.credit+=amount;reportMoney(g,seat,'tax_account',`절세통장 · 건설 적립 +${amount}만원 (${state.credit}/${CREDIT_CAP})`,amount);
}
export function rechargeConstructionPermit(g:Game,seat:number){
 if(!power(g,seat,'construction_team'))return;
 const state=initializeDevelopment(g).players[seat];if(state.permits>=PERMIT_CAP)return;
 state.permits++;reportMoney(g,seat,'construction_team',`출장 건설반 · 시공권 +1장 (${state.permits}/${PERMIT_CAP})`);
}
export function constructionQuote(g:Game,seat:number,base:number,free=false){
 const total=free?0:spendCost(g,seat,base,'builder'),credit=Math.min(total,constructionCredit(g,seat));return {total,credit,cash:total-credit};
}
export function payConstruction(g:Game,seat:number,quote:ReturnType<typeof constructionQuote>){
 if(quote.credit){const state=initializeDevelopment(g).players[seat];state.credit-=quote.credit;reportMoney(g,seat,'tax_account',`절세통장 · 건설 적립 ${quote.credit}만원 사용`,quote.credit);}
 consumeLoss(g,seat,quote.total);g.players[seat].cash-=quote.cash;
}
export function constructionPermitTiles(g:Game,seat:number){return BOARD.filter(t=>t.kind==='city'&&g.properties[t.index].owner===seat&&!g.properties[t.index].landmark&&g.properties[t.index].buildings!==7).map(t=>t.index);}
export function canUseConstructionPermit(g:Game,seat=g.turn){
 const state=g.development?.players[seat],available=state?.permits??(g.augments?.players[seat].owned.includes('builder_gold')?2:0);
 return seat===g.turn&&power(g,seat,'construction_team')>0&&available>0&&state?.permitTurn!==g.turnId&&['roll','buy','build','takeover','end'].includes(g.phase)&&!g.world.interrupted&&!g.black?.pending.length&&!g.abilities.pendingTarget&&!g.players[seat].bankrupt&&!g.players[seat].rest&&!g.abilities.statuses[seat].skipTurns&&!g.world.players[seat].sleepThisTurn&&!g.world.players[seat].endLocked&&!(g.abilities.startedTurn!==g.turnId&&g.world.players[seat].sleep>0)&&constructionPermitTiles(g,seat).length>0;
}
export function useConstructionPermit(g:Game,tile:number|undefined,building:number|undefined){
 if(!canUseConstructionPermit(g)||!Number.isInteger(tile)||!constructionPermitTiles(g,g.turn).includes(tile!)||!Number.isInteger(building)||building!<0||building!>=BUILDINGS.length||g.properties[tile!].buildings&(1<<building!))throw new Error('시공권으로 건설할 자기 지역과 일반 건물을 선택해주세요.');
 const state=initializeDevelopment(g).players[g.turn];state.permits--;state.permitTurn=g.turnId;
 g.properties[tile!].buildings|=1<<building!;g.properties[tile!].builtTurn=g.turnId;delete g.landmarkVisit;
 reportMoney(g,g.turn,'construction_team',`출장 건설반 · ${BOARD[tile!].name} ${BUILDINGS[building!].name} 무료 건설`);
 g.abilities.events.at(-1)!.tile=tile!;
}
