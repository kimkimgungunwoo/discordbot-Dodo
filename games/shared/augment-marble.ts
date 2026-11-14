import {captureCashTransfers,bankCashChange,type MoneyTransfer} from "./augment-marble-money.js";
import { strategicBotAction } from "./augment-marble-bot.js";
import { createEventState, drawEvent, eventDefinition, type EventId, type EventState } from "./augment-marble-events.js";
import { incomeWithoutGlass,glassIncome,lossWithoutGlass,transferMoney,stealMoney,acquireEffect, capabilities, cashback, factor, incomeAmount, power, receiveIncome, spendCost, steal, reportDiscount, reportMoney, salaryAmount, receiveSalary, consumeLoss, lossAmount, immune, refreshGamble, revivePlayer, syncRevival, flushPendingAcquisitions } from "./augment-marble-effects.js";
import { createAbilityRuntime, createRoll, diceChoices, configureRoll, throwDice, rerollDice, chooseBlackDice, emitAbility, type ForceAbility, type RerollAbility, type AbilityRuntime } from "./augment-marble-runtime.js";
import { START_CASH, SALARY, BONUS, LAND_TAX_RATE, BUILDINGS, GROUP_ECONOMY } from "./augment-marble-economy.js";
export { START_CASH, SALARY, BONUS, LAND_TAX_RATE, BUILDINGS, GROUP_ECONOMY } from "./augment-marble-economy.js";
import { AUGMENT_CATALOG, createAugmentState, openRoundPrismOffer, openAugmentOffer, rerollAugment, selectAugment, type AugmentDefinition, type AugmentState, type AugmentTier } from "./augment-marble-augments.js";
// Money is expressed in 만원. Shared by the authoritative server and practice mode.
export const COLORS = ["#547f9b", "#ba705e", "#6f8b63", "#b48a48"];
export const GROUP_COLORS = ["#b73730", "#956000", "#24733e", "#007688", "#6940a6", "#ac2e69", "#315ab7"];
export const MAX_ROUNDS = 40;
export const REVISIT_BONUS_PERCENT = 40;
export const COLOR_GROUPS_TO_WIN = 1;
export const TURN_MS = 45_000;
export type Tile = { index: number; name: string; kind: "city" | "start" | "rest" | "event" | "bonus" | "portal"; group: number; line: number; price: number };
const labels = ["출발", "A1", "A2", "A3", "A4", "이벤트", "B1", "B2", "B3", "무인도", "B4", "C1", "C2", "C3", "이벤트", "C4", "D1", "D2", "이벤트", "D3", "D4", "E1", "E2", "보너스", "E3", "E4", "F1", "포탈", "F2", "F3", "F4", "G1", "이벤트", "G2", "G3", "G4"];
export const BOARD: Tile[] = labels.map((name, index) => {
  const group = /^[A-G][1-4]$/.test(name) ? name.charCodeAt(0) - 65 : -1;
  return { index, name, kind: group >= 0 ? "city" : name === "출발" ? "start" : name === "무인도" ? "rest" : name === "보너스" ? "bonus" : name === "포탈" ? "portal" : "event", group, line: Math.floor(index / 9), price: group < 0 ? 0 : GROUP_ECONOMY[group].land[Number(name[1]) - 1] };
});
export interface Player { name: string; cash: number; position: number; bankrupt: boolean; rest: number; laps: number }
export interface Property { revisitBoost?:number; owner: number | null; buildings: number; landmark?: boolean; builtTurn?: number; purchasedTurn?:number; festival?: number; locust?: number }
export type Phase = "portal" | "event" | "rent" | "augment" | "roll" | "dice" | "buy" | "build" | "takeover" | "debt" | "end" | "finished";
export type WinReason = "bankruptcy" | "triple" | "line" | "assets";
export interface Game { roundPrism?:{given:boolean;pending:number[]}; locustBatch?:{id:number;path:number[]}; landmarkVisit?:{seat:number;tile:number;turnId:number}; teleport?:{id:number;seat:number;from:number;to:number}; destructionBatch?:{id:number;revision:number;kind:"quake"|"missile";items:{tile:number;before:Property}[]}; flightBatch?:{id:number;items:{seat:number;from:number;to:number}[]}; turnOrder?:number[];orderDrawUntil?:number; moneyTransfers?:MoneyTransfer[]; world: EventState; abilities: AbilityRuntime; players: Player[]; properties: Property[]; turn: number; turnId: number; round: number; roundPending: number[]; revision: number; phase: Phase; dice: number[]; doubles: number; extraTurn: boolean; winner: number | null; reason: WinReason | null; debt: { amount: number; creditor: number | null; reason: "rent" | "land_tax"; principal?:number;receipt?:number; resume: "takeover" | "arrival" | "event" } | null; log: string[]; augments: AugmentState | null; augmentSeat: number | null; augmentResume: "start" | "arrive" | "round30" | null }
export interface Seat { userId: string | null; name: string; bot?: string }
export interface View { presentationAt?:number; type: "MARBLE_STATE"; matchId: string; game: Game; seats: (Seat & { connected: boolean; ready?: boolean })[]; seat: number; started: boolean; deadline: number; serverNow: number; aborted?: string; rematch?: { matchId: string; votes: string[]; required: number; delivered: boolean } }
export interface Action { action: "portal_move" | "roll" | "buy" | "build" | "takeover" | "skip" | "end" | "sell" | "bankrupt" | "augment_select" | "augment_reroll" | "dice_force" | "dice_double" | "dice_copy" | "dice_reroll" | "dice_choose" | "dice_confirm" | "subsidy" | "escape" | "landmark" | "ability_target" | "island_buy" | "event_resolve" | "rent_pay" | "coupon_pass" | "home_stone" | "extra_coupon"; eventSerial?: number; amount?: number; decline?: boolean; augmentId?: string; line?: number; steps?: number; target?: number; ability?: ForceAbility | RerollAbility; option?: number; die?: 0 | 1; useNew?: boolean; offerId?: string; slot?: number; buildings?:number[]; building?: number; tile?: number }
export interface AugmentOptions { catalog?: readonly AugmentDefinition[]; tierSequence?: readonly AugmentTier[]; random?: () => number }
export function canAct(g:Game,seat:number){return g.phase==="augment"&&g.augmentResume==="round30"?!!g.roundPrism?.pending.includes(seat):seat===actingSeat(g);}
export function actingSeat(g: Game) { return g.augmentSeat ?? g.turn; }
export function createGame(names: string[], options?: AugmentOptions): Game {
  if (names.length < 2 || names.length > 4) throw new Error("2~4명이 필요합니다.");
  const catalog = options?.catalog ?? AUGMENT_CATALOG;
  const augments = catalog.length ? createAugmentState(names.length, options?.random, catalog, options?.tierSequence) : null;
  if (augments) for (let seat = 0; seat < names.length; seat++) openAugmentOffer(augments, seat, options?.random, catalog);
  return { world:createEventState(names.length), abilities: createAbilityRuntime(names.length), augments, augmentSeat: augments ? 0 : null, augmentResume: augments ? "start" : null, players: names.map(name => ({ name, cash: START_CASH, position: 0, bankrupt: false, rest: 0, laps: 0 })), properties: BOARD.map(() => ({ owner: null, buildings: 0 })), turn: 0, turnId: 1, round: 1, roundPending: names.map((_, i) => i), revision: 0, phase: augments ? "augment" : "roll", dice: [], doubles: 0, extraTurn: false, winner: null, reason: null, debt: null, log: [`각자 ${START_CASH}만원으로 출발합니다.`] };
}
export const ORDER_DRAW_MS=3600;
export function drawTurnOrder(g:Game,random:()=>number=Math.random){
 const order=g.players.map((_,i)=>i);for(let i=order.length-1;i>0;i--){const j=Math.min(i,Math.floor(random()*(i+1)));[order[i],order[j]]=[order[j],order[i]];}
 g.turnOrder=order;g.turn=order[0];if(g.augmentResume==='start')g.augmentSeat=order[0];return order;
}
function note(g: Game, text: string) { g.log.push(text); if (g.log.length > 60) g.log.shift(); }
export function groupCount(g: Game, owner: number) { return GROUP_COLORS.filter((_, group) => BOARD.filter(t => t.group === group).every(t => g.properties[t.index].owner === owner)).length; }
export function construction(index: number, building: number) {
  const group = BOARD[index].group;
  return { name: BUILDINGS[building].name, cost: group < 0 ? 0 : GROUP_ECONOMY[group].costs[building], rent: group < 0 ? 0 : GROUP_ECONOMY[group].rents[building] };
}
export function baseRent(index: number) { return Math.ceil(BOARD[index].price / 5); }
export function landValue(g: Game, owner: number) { return BOARD.reduce((sum, tile) => sum + (g.properties[tile.index].owner === owner ? tile.price : 0), 0); }
export function landTax(g:Game,owner:number,cash=g.players[owner].cash){return lossAmount(g,owner,Math.ceil(Math.max(0,cash)*LAND_TAX_RATE*factor(g,owner,"tax",true)-1e-9));}
export const cashTax=landTax;
export function tileLines(index:number){const line=Math.floor(index/9);return index%9===0?[line,(line+3)%4]:[line];}
export function sameLine(a:number,b:number){return tileLines(a).some(line=>tileLines(b).includes(line));}
export function rent(g: Game, index: number, modifiers = true) {
  const t = BOARD[index], p = g.properties[index];
  if (t.kind !== "city" || p.owner === null) return 0;
  const monopoly = BOARD.filter(x => x.group === t.group).every(x => g.properties[x.index].owner === p.owner);
  return Math.max(0, Math.ceil((baseRent(index) + BUILDINGS.reduce((sum, _, i) => sum + (p.buildings & (1 << i) ? construction(index, i).rent : 0), 0)) * (1+Math.max(0,p.revisitBoost??0)*REVISIT_BONUS_PERCENT/100) * (monopoly ? 2 : 1) * (p.landmark ? 2 : 1) * (g.abilities.gambles[p.owner]?.[index] !== undefined && modifiers && definitionsActive(g,p.owner) ? g.abilities.gambles[p.owner][index] : 1) * Math.pow(2,p.festival ?? 0) * Math.pow(.7,p.locust ?? 0) * (g.world?.famineUntil > g.round ? .5 : 1) - 1e-9));
}
export function value(g: Game, index: number) { return (g.properties[index].landmark ? landmarkBase(index) : 0) + BOARD[index].price + BUILDINGS.reduce((sum, _, i) => sum + (g.properties[index].buildings & (1 << i) ? construction(index, i).cost : 0), 0); }
export function assets(g: Game, owner: number) { return g.players[owner].cash + BOARD.reduce((sum, t) => sum + (g.properties[t.index].owner === owner ? incomeAmount(g, owner, Math.floor(value(g, t.index) / 2)) : 0), 0); }
function win(g: Game, winner: number, reason: WinReason) { g.winner = winner; g.reason = reason; g.phase = "finished"; note(g, `${winner + 1}P ${reason === "triple" ? "컬러독점" : reason === "line" ? "라인 독점" : reason === "assets" ? "라운드 제한 · 자산승리" : "파산승리"}!`); }
function checkWin(g: Game) {
  const alive = g.players.map((p, i) => p.bankrupt ? -1 : i).filter(i => i >= 0);
  if (alive.length === 1) { win(g, alive[0], "bankruptcy"); return; }
  for (const owner of alive) {
    if (groupCount(g, owner) >= COLOR_GROUPS_TO_WIN) { win(g, owner, "triple"); return; }
    if ([0, 1, 2, 3].some(line => BOARD.filter(t => t.kind === "city" && t.line === line).every(t => g.properties[t.index].owner === owner))) { win(g, owner, "line"); return; }
  }
}
interface PaymentSplit {principal?:number;receipt?:number}
function settlePayment(g:Game,payer:number,amount:number,creditor:number|null,split:PaymentSplit={}){
 consumeLoss(g,payer,amount);
 if(creditor===null){bankCashChange(g,payer,-amount);return;}
 const principal=Math.min(amount,split.principal??amount),receipt=split.receipt===undefined?principal:principal===split.principal?split.receipt:split.receipt>(split.principal??0)?glassIncome(g,creditor,principal):principal;
 transferMoney(g,payer,creditor,amount,principal,receipt);
 if(amount>principal)note(g,`${payer+1}P 유리대포 · 추가 지출 ${amount-principal}만원 소멸`);
 if(receipt>principal)note(g,`${creditor+1}P 유리대포 · 추가 수입 ${receipt-principal}만원 은행 지급`);
}
function pay(g: Game, amount: number, creditor: number | null, resume: "takeover" | "arrival" | "event" = "takeover", reason: "rent" | "land_tax" = "rent",split:PaymentSplit={}) {
  const revive = g.abilities.statuses[g.turn].revival;
  if (g.players[g.turn].cash < amount && assets(g, g.turn) < amount && revive && !revive.consumed && definitionsActive(g,g.turn)) {
    for (let tile = 0; tile < g.properties.length; tile++) if (g.properties[tile].owner === g.turn && !g.properties[tile].landmark) g.properties[tile] = { owner: null, buildings: 0,locust:g.properties[tile].locust };
    revivePlayer(g,g.turn);
    return true;
  }
  if (g.players[g.turn].cash < amount) { g.debt = { amount, creditor, resume, reason,...split }; g.phase = "debt"; note(g, `${g.turn + 1}P 지급할 ${amount}만원이 부족합니다. 자산을 매각해주세요.`); return false; }
  settlePayment(g,g.turn,amount,creditor,split);
  return true;
}
function continueArrival(g: Game, random: () => number, catalog: readonly AugmentDefinition[]) {
  if (g.augments && openAugmentOffer(g.augments, g.turn, random, catalog)) { g.augmentSeat = g.turn; g.augmentResume = "arrive"; g.phase = "augment"; }
  else advanceMovement(g, random, catalog);
}
function afterPayment(g: Game, random: () => number, catalog: readonly AugmentDefinition[]) {
  const resume = g.debt!.resume; g.debt = null;
  if(resume==="event"){g.phase="end";return;}
  if (resume === "arrival") continueArrival(g, random, catalog);
  else g.phase = "takeover";
}
function rewardRevisit(g:Game,seat:number,tile:number){
 const p=g.properties[tile];if(BOARD[tile].kind!=="city"||p.owner!==seat||p.buildings!==7)return;
 const old=p.revisitBoost??0,before=incomeWithoutGlass(g,seat,rent(g,tile));p.revisitBoost=old+1;
 if(p.revisitBoost!==old){const after=incomeWithoutGlass(g,seat,rent(g,tile));note(g,`${seat+1}P ${BOARD[tile].name} 재방문 · 통행료 ${before} → ${after}만원 (누적 +${p.revisitBoost*REVISIT_BONUS_PERCENT}%)`);emitAbility(g.abilities,{actor:seat,tile,ability:"revisit",caption:`${BOARD[tile].name} 통행료 ${before} → ${after}만원`,amount:after-before,rentChange:{before,after,level:p.revisitBoost},visual:"buff"});}
}

function arrive(g: Game, random: () => number = Math.random) {
  const player = g.players[g.turn], tile = BOARD[player.position], property = g.properties[player.position];
  delete g.landmarkVisit;
  if(property.owner===g.turn&&property.buildings===7&&!property.landmark)g.landmarkVisit={seat:g.turn,tile:player.position,turnId:g.turnId};
  landEffects(g);rewardRevisit(g,g.turn,player.position);
  note(g, `${g.turn + 1}P ${tile.name} 도착`);
  if (tile.kind === "city") {
    if (property.owner === null) g.phase = "buy";
    else if (property.owner === g.turn) g.phase = property.purchasedTurn===g.turnId&&player.laps<2?"end":"build";
    else {
      const quote = rentQuote(g,tile.index,g.turn),toll=quote.amount;
      property.festival=0;
      if(toll>0 && g.world.players[g.turn].autoPass>0){g.world.players[g.turn].autoPass--;note(g,"하이패스 · 통행료 자동 면제");g.phase="takeover";}
      else if(toll>0 && g.world.players[g.turn].passCoupons>0){g.world.rent={...quote,creditor:property.owner,tile:tile.index};g.phase="rent";}
      else {note(g,`통행료 ${quote.principal}만원 → ${property.owner+1}P`);if(pay(g,toll,property.owner,"takeover","rent",quote))g.phase="takeover";}

    }
  } else {
    g.phase = "end";
    if (tile.kind === "bonus") { const paid = receiveIncome(g, g.turn, BONUS); note(g, `보너스 ${paid}만원 수령`); }
    else if (tile.kind === "rest" && !power(g, g.turn, "island_owner")) { player.rest = 3; g.extraTurn = false; note(g, "무인도 · 최대 3턴 구금 · 더블로 무료 탈출 가능합니다."); }
    else if(tile.kind==="portal"){g.phase="portal";note(g,"포탈 · 이동할 지역을 선택하세요.");}
    else if (tile.kind === "event") openEvent(g,g.turn,random);
  }
}
function end(g: Game,random:()=>number=Math.random,catalog:readonly AugmentDefinition[]=AUGMENT_CATALOG) {
  if(!g.world?.interrupted && g.world?.deferred?.length){const visits=g.world.deferred;g.world.deferred=[];beginEventVisits(g,visits,random,catalog);return;}
  if(g.world?.interrupted){nextEventVisit(g,random,catalog);return;}
  if (g.extraTurn && !g.players[g.turn].bankrupt) {
    g.extraTurn = false; g.abilities.ordinal++; g.abilities.roll = null; note(g, "더블! 한 번 더 굴립니다."); g.phase = "roll";
    return; // Extra rolls belong to the same player's turn and the same round.
  }
  g.abilities.statuses[g.turn].restrictWholeTurn = false;
  g.abilities.lastOwnTurn[g.turn] = g.turnId;
  g.roundPending = g.roundPending.filter(seat => seat !== g.turn && !g.players[seat].bankrupt);
  if (!g.roundPending.length) {
    if (g.round >= MAX_ROUNDS) {
      const ranking = g.players.flatMap((p, seat) => p.bankrupt ? [] : [seat]).sort((a, b) => netWorth(g, b) - netWorth(g, a) || landValue(g, b) - landValue(g, a) || g.players[b].cash - g.players[a].cash || a - b);
      win(g, ranking[0], "assets"); return;
    }
    g.round++;
    flushPendingAcquisitions(g,random,catalog);
    g.roundPending = g.players.flatMap((p, i) => p.bankrupt ? [] : [i]);
    note(g, `${g.round}라운드 시작`);
  }
  const order=g.turnOrder??g.players.map((_,i)=>i);
  do { g.turn = order[(order.indexOf(g.turn)+(g.world?.direction??1)+order.length)%order.length]; } while (g.players[g.turn].bankrupt);
  g.doubles = 0; g.turnId++; g.abilities.ordinal = 0; g.abilities.roll = null; g.phase = "roll";
  if(g.round===20&&!g.roundPrism?.given&&g.augments){
   const pending=g.players.flatMap((p,i)=>!p.bankrupt&&openRoundPrismOffer(g.augments!,i,random,catalog)?[i]:[]);
   g.roundPrism={given:true,pending};
   if(pending.length){g.phase="augment";g.augmentResume="round30";g.augmentSeat=pending[0];note(g,"20라운드 · 생존자 모두 프리즘 증강 선택");return;}
  }
  startTurn(g);
}
function mutateAction(g: Game, input: Action, random: () => number = Math.random, catalog: readonly AugmentDefinition[] = AUGMENT_CATALOG): void {
  g.world ??= createEventState(g.players.length);
  if (g.phase === "finished") throw new Error("종료된 경기입니다.");
  if(g.phase==="roll"){startTurn(g);if(input.action!=="roll"&&(g.world.players[g.turn].sleepThisTurn||g.abilities.statuses[g.turn].skipTurns>0))throw new Error("수면·마비 중에는 행동할 수 없습니다.");}
  if(input.action==="event_resolve"){resolveEvent(g,input,random,catalog);g.revision++;return;}
  if(g.phase==="event")throw new Error("이벤트 처리를 먼저 마쳐주세요.");
  if(input.action==="rent_pay" || input.action==="coupon_pass"){
    if(g.phase!=="rent" || !g.world.rent)throw new Error("통행료를 선택하는 단계가 아닙니다.");
    const bill=g.world.rent;
    if(input.action==="coupon_pass"){if(g.world.players[g.turn].passCoupons<1)throw new Error("하이패스 쿠폰이 없습니다.");g.world.players[g.turn].passCoupons--;g.phase=g.world.noPurchase?"end":"takeover";note(g,"하이패스 쿠폰 · 통행료 면제");}
    else if(pay(g,bill.amount,bill.creditor,g.world.noPurchase?"event":"takeover","rent",bill))g.phase=g.world.noPurchase?"end":"takeover";
    g.world.rent=null;g.revision++;return;
  }
  if(g.phase==="rent")throw new Error("통행료 지급 여부를 먼저 선택해주세요.");
  if(input.action==="portal_move"){
   if(g.phase!=="portal"||!Number.isInteger(input.tile)||BOARD[input.tile!]?.kind!=="city")throw new Error("포탈로 이동할 지역을 선택하세요.");
   const seat=g.turn,from=g.players[seat].position,noPurchase=g.world.noPurchase;
   g.teleport={id:(g.teleport?.id??0)+1,seat,from,to:input.tile!};beginEventVisits(g,[{seat,tile:input.tile!,effects:true,noPurchase}],random,catalog);g.revision++;return;
  }
  if(g.phase==="portal")throw new Error("포탈 목적지를 먼저 선택하세요.");
  if(input.action==="home_stone"){
    if(g.phase!=="roll"||g.abilities.roll||g.world.interrupted||g.players[g.turn].rest||g.abilities.statuses[g.turn].skipTurns||g.world.players[g.turn].sleepThisTurn||!g.world.players[g.turn].homeStones)throw new Error("지금 귀환석을 사용할 수 없습니다.");
    startTurn(g);if(g.abilities.pendingTarget)throw new Error("대상을 먼저 선택해주세요.");
    g.world.players[g.turn].homeStones--;g.world.players[g.turn].endLocked=true;g.players[g.turn].position=0;const paid=receiveSalary(g,g.turn);note(g,`귀환석 · 출발 이동 · 월급 ${paid}만원`);g.extraTurn=false;g.phase="end";g.revision++;return;
  }
  if(input.action==="extra_coupon"){
    if(!["buy","build","takeover","end"].includes(g.phase)||g.world.interrupted||g.extraTurn||g.players[g.turn].rest||g.abilities.statuses[g.turn].skipTurns||g.world.players[g.turn].endLocked||!g.world.players[g.turn].extraCoupons)throw new Error("지금 한번더 쿠폰을 사용할 수 없습니다.");
    g.world.players[g.turn].extraCoupons--;g.abilities.ordinal++;g.abilities.roll=null;g.phase="roll";g.revision++;return;
  }
  if (input.action === "augment_select" || input.action === "augment_reroll") {
    if (g.phase !== "augment" || !g.augments || g.augmentSeat === null || typeof input.offerId !== "string") throw new Error("증강을 선택하는 단계가 아닙니다.");
    const seat = g.augmentResume==="round30"?g.roundPrism!.pending.find(i=>g.augments!.players[i].offer?.id===input.offerId)??-1:g.augmentSeat;
    if(seat<0)throw new Error("이미 선택을 완료한 증강입니다.");
    if (input.action === "augment_reroll") rerollAugment(g.augments, seat, input.offerId, input.slot!, random, catalog);
    else {
      const id = selectAugment(g.augments, seat, input.offerId, input.slot!);
      const firstEffect = g.abilities.nextEventId;
      acquireEffect(g, seat, id, random, catalog);
      for (const event of g.abilities.events) if (event.id >= firstEffect) { event.stage = "before_move"; delete event.move; }
      note(g, `${seat + 1}P 증강 선택 · ${catalog.find(a => a.id === id)?.name ?? id}`);
      emitAbility(g.abilities, { actor: seat, tile: g.players[seat].position, ability: id, stage: "before_move", caption: `${catalog.find(a => a.id === id)?.name ?? id}${catalog.find(a => a.id === id)?.effect === "conversion" ? " 사용 완료" : " 획득"}`, visual: "buff" });
      if(g.augmentResume==="round30"){
        g.roundPrism!.pending=g.roundPrism!.pending.filter(i=>i!==seat);
        g.augmentSeat=g.roundPrism!.pending[0]??null;
        if(g.augmentSeat===null){g.augmentResume=null;g.phase="roll";startTurn(g);}
      } else if (g.augmentResume === "start") {
        const next = (g.turnOrder??g.players.map((_,i)=>i)).find(i=>g.augments!.players[i].offer!==null)??-1;
        g.augmentSeat = next < 0 ? null : next;
        if (next < 0) { g.phase = "roll"; g.augmentResume = null; startTurn(g); }
      } else { g.augmentSeat = null; g.augmentResume = null; advanceMovement(g, random, catalog); }
    }
    g.revision++; return;
  }
  if (g.phase === "augment") throw new Error("증강을 먼저 선택해주세요.");
  const player = g.players[g.turn], index = player.position, property = g.properties[index];
  if (g.phase === "roll") startTurn(g);
  if (g.abilities.pendingTarget) {
    if (input.action !== "ability_target" || !Number.isInteger(input.target) || !turnTargets(g).includes(input.target!)) throw new Error("블라디미르 대상을 먼저 선택하세요.");
    const target = input.target!;
    steal(g, g.turn, target, Math.floor(targetWealth(g, target) * .1), "vladimir");
    g.abilities.pendingTarget = false; g.revision++; return;
  }
  const requirePhase = (...phases: Phase[]) => { if (!phases.includes(g.phase)) throw new Error("현재 단계에서 할 수 없는 행동입니다."); };
  if (["dice_force", "dice_double", "dice_copy", "dice_reroll", "dice_choose", "dice_confirm", "subsidy"].includes(input.action)) {
    diceAction(g, input, random, catalog); g.revision++; return;
  }
  if (input.action === "island_buy") {
    requirePhase("roll", "end");
    if (player.position !== 9 || !power(g, g.turn, "island_owner") || g.abilities.islandOwner !== null || player.cash < lossAmount(g,g.turn,ISLAND_COST)) throw new Error("무인도를 매수할 수 없습니다.");
    const cost=lossAmount(g,g.turn,ISLAND_COST);consumeLoss(g,g.turn,cost);player.cash -= cost; g.abilities.islandOwner = g.turn;player.rest=0; note(g, `무인도 매수 · ${cost}만원`);
  } else if (input.action === "escape") {
    requirePhase("roll"); if (!player.rest || player.cash < lossAmount(g,g.turn,50)) throw new Error("탈출할 수 없습니다.");
    const cost=lossAmount(g,g.turn,50);consumeLoss(g,g.turn,cost);player.cash -= cost; player.rest = 0; note(g, `무인도 탈출 · ${cost}만원`);
  } else if (input.action === "landmark") {
    requirePhase("build"); const cost = landmarkCost(g, index);
    if (!landmarkAvailable(g,index) || player.cash < cost) throw new Error("건물 3종이 완공된 자기 지역에 다시 도착해야 랜드마크를 건설할 수 있습니다.");
    consumeLoss(g,g.turn,cost);player.cash -= cost; reportDiscount(g, g.turn, "builder", landmarkBase(index), cost); cashback(g, g.turn, cost); property.landmark = true;delete g.landmarkVisit; note(g, `${BOARD[index].name} 랜드마크 완공`);
  } else if (input.action === "roll") {
    requirePhase("roll");
    startTurn(g);
    if(g.world.players[g.turn].sleepThisTurn){g.world.players[g.turn].sleepThisTurn=false;g.world.players[g.turn].sleep--;g.extraTurn=false;note(g,"수면 · 차례를 쉽니다.");end(g,random,catalog);}
    else if(g.abilities.statuses[g.turn].skipTurns>0){g.abilities.statuses[g.turn].skipTurns--;g.extraTurn=false;note(g,"마비 · 차례를 쉽니다.");end(g,random,catalog);}
    else if (player.rest) {
      const state=g.world.players[g.turn],restricted=g.abilities.statuses[g.turn].restrictedRolls>0||g.abilities.statuses[g.turn].restrictWholeTurn;
      let pair:[number,number]=[1+Math.floor(random()*6),state.lostThisTurn?0:1+Math.floor(random()*6)];
      if(restricted&&pair[0]+pair[1]>10)pair=pair[0]===pair[1]?[5,5]:[4,5];
      if(state.lostThisTurn&&state.lostDice>0)state.lostDice--;
      g.dice=pair;g.abilities.lastThrow={id:(g.abilities.lastThrow?.id??0)+1,seat:g.turn,kind:"roll",dice:[...pair]};
      if(pair[0]===pair[1]&&pair[1]>0){
        player.rest=0;g.doubles=0;const roll=prepareRoll(g);roll.result=pair;note(g,"무인도 · 더블로 무료 탈출");finishDice(g,random,catalog);g.extraTurn=false;
      }else{
        if(restricted&&g.abilities.statuses[g.turn].restrictedRolls>0)g.abilities.statuses[g.turn].restrictedRolls--;
        if(g.abilities.islandOwner!==null&&g.abilities.islandOwner!==g.turn&&power(g,g.abilities.islandOwner,"island_owner"))steal(g,g.abilities.islandOwner,g.turn,ISLAND_FEE,"island_owner");
        player.rest=Math.max(0,player.rest-1);state.endLocked=true;g.extraTurn=false;g.phase="end";note(g,`무인도 · ${pair.join(' + ')} · 탈출 실패, 이번 차례 종료`);
      }
    }
    else {
      {
        const roll = prepareRoll(g), c = capabilities(g);
        if(g.abilities.ordinal===0 && g.world.players[g.turn].lostThisTurn && g.world.players[g.turn].lostDice>0)g.world.players[g.turn].lostDice--;
        g.dice = g.world.players[g.turn].lostThisTurn ? [1+Math.floor(random()*6),0] : [...throwDice(roll,c,random)];
        if(g.world.players[g.turn].lostThisTurn)roll.result=[g.dice[0],0];
        g.abilities.lastThrow = { id: (g.abilities.lastThrow?.id ?? 0) + 1, seat: g.turn, kind: "roll", dice: [...g.dice] };
        if (diceChoices(roll, c, g.abilities.history).rerolls.length) g.phase = "dice";
        else finishDice(g, random, catalog);
      }
    }
  } else if (input.action === "buy") {
    requirePhase("buy"); if (player.cash < purchaseCost(g, index)) throw new Error("구매할 현금이 부족합니다.");
    const cost = purchaseCost(g, index); consumeLoss(g,g.turn,cost);player.cash -= cost; reportDiscount(g, g.turn, "realtor", BOARD[index].price, cost); cashback(g, g.turn, cost); property.owner = g.turn;property.revisitBoost=0; property.landmark=false;property.buildings=0;delete property.builtTurn; property.purchasedTurn=g.turnId;delete g.landmarkVisit;refreshGamble(g, g.turn, index, random); g.phase = player.laps>=2?"build":"end"; note(g, `${g.turn + 1}P ${BOARD[index].name} 구매`); checkWin(g);
  } else if (input.action === "build") {
    requirePhase("build"); const selected=input.buildings??[input.building!];
    if(!Array.isArray(selected)||!selected.length||selected.length>3||new Set(selected).size!==selected.length)throw new Error("건물을 선택하세요.");
    if((property.purchasedTurn===g.turnId&&player.laps<2)||property.owner!==g.turn||property.landmark||selected.some(b=>!Number.isInteger(b)||b<0||b>=BUILDINGS.length||(property.buildings&(1<<b))))throw new Error("건설할 수 없는 건물입니다.");
    const estimate=structuredClone(g);const total=selected.reduce((sum,b)=>{const cost=buildCost(estimate,index,b);consumeLoss(estimate,g.turn,cost);return sum+cost;},0);if(player.cash<total)throw new Error("건설할 현금이 부족합니다.");
    for(const b of selected){const cost=buildCost(g,index,b);consumeLoss(g,g.turn,cost);player.cash-=cost;reportDiscount(g,g.turn,"builder",construction(index,b).cost,cost);cashback(g,g.turn,cost);property.buildings|=1<<b;note(g,`${BOARD[index].name} ${construction(index,b).name} 건설`);}property.builtTurn=g.turnId;delete g.landmarkVisit;
  } else if (input.action === "takeover") {
    requirePhase("takeover"); const cost = takeoverCost(g, index);
    if (property.landmark || property.owner === null || property.owner === g.turn || player.cash < cost) throw new Error("인수할 현금이 부족합니다.");
    const principal=power(g,g.turn,"glass_cannon")?cost/2:cost;
    reportDiscount(g,g.turn,"negotiator",takeoverBase(g,index),cost);
    const receipt=incomeAmount(g,property.owner,principal);
    if(receipt>principal)reportMoney(g,property.owner,power(g,property.owner,"investor")?"investor":"glass_cannon",`인수 수입 · ${principal} → ${receipt}만원`,receipt-principal);
    consumeLoss(g,g.turn,cost);transferMoney(g,g.turn,property.owner,cost,principal,receipt); property.owner = g.turn;property.purchasedTurn=g.turnId;delete g.landmarkVisit;for(const gambles of g.abilities.gambles)delete gambles[index];refreshGamble(g,g.turn,index,random); cashback(g, g.turn, cost); g.phase = player.laps>=2?"build":"end"; note(g, `${g.turn + 1}P ${BOARD[index].name} 인수 · ${cost}만원`); checkWin(g);
  } else if (input.action === "sell") {
    requirePhase("debt"); const tile = input.tile;
    if (!Number.isInteger(tile) || tile! < 0 || tile! >= BOARD.length || g.properties[tile!].owner !== g.turn) throw new Error("내 지역만 매각할 수 있습니다.");
    const proceeds = Math.floor(value(g, tile!) / 2); g.properties[tile!] = { owner: null, buildings: 0,locust:g.properties[tile!].locust }; const paid = receiveIncome(g, g.turn, proceeds);
    note(g, `${BOARD[tile!].name} 매각 · ${paid}만원`);
    const debt = g.debt!; if (pay(g, debt.amount, debt.creditor, debt.resume, debt.reason,debt)) afterPayment(g, random, catalog);
  } else if (input.action === "bankrupt") {
    requirePhase("debt");
    if (assets(g, g.turn) >= g.debt!.amount) throw new Error("자산 매각으로 지급할 수 있습니다.");
    const liquidation=assets(g,g.turn);bankCashChange(g,g.turn,liquidation-player.cash);settlePayment(g,g.turn,liquidation,g.debt!.creditor,g.debt!);
    player.cash = 0; player.bankrupt = true; g.abilities.movement = null; g.abilities.marks = g.abilities.marks.filter(m => m.owner !== g.turn); g.extraTurn = false; g.debt = null;
    g.properties.forEach((p,i) => { if (p.owner === g.turn) g.properties[i]={owner:null,buildings:0,locust:p.locust}; });
    note(g, `${g.turn + 1}P 파산`); checkWin(g); if (g.winner === null) end(g,random,catalog);
  } else if (input.action === "skip" || input.action === "end") { requirePhase("buy", "build", "takeover", "end"); end(g,random,catalog); }
  else throw new Error("알 수 없는 행동입니다.");
  g.revision++;
}
/** Only automatic when no legal optional arrival action remains. */
export function automaticContinuation(g:Game):Action|null {
 if(!["buy","build","takeover","end"].includes(g.phase))return null;
 const seat=g.turn,p=g.players[seat],tile=p.position,property=g.properties[tile],state=g.world.players[seat];
 const coupon=!g.world.interrupted&&!g.extraTurn&&!p.rest&&!g.abilities.statuses[seat].skipTurns&&!state.endLocked&&state.extraCoupons>0;
 if(coupon)return null;
 if(g.phase==="buy"&&p.cash>=purchaseCost(g,tile))return null;
 if(g.phase==="takeover"&&!property.landmark&&property.owner!==null&&property.owner!==seat&&p.cash>=takeoverCost(g,tile))return null;
 if(g.phase==="build"&&property.owner===seat&&(property.purchasedTurn!==g.turnId||p.laps>=2)&&!property.landmark){
  if(BUILDINGS.some((_,i)=>!(property.buildings&(1<<i))&&p.cash>=buildCost(g,tile,i)))return null;
  if(landmarkAvailable(g,tile)&&p.cash>=landmarkCost(g,tile))return null;
 }
 if(tile===9&&power(g,seat,"island_owner")&&g.abilities.islandOwner===null&&p.cash>=lossAmount(g,seat,ISLAND_COST))return null;
 return {action:"end"};
}
export function autoAction(g:Game,bot=false):Action {
  const snapshot=structuredClone(g);const fallback=chooseAutoAction(snapshot,bot);
  return bot?strategicBotAction(snapshot,fallback):fallback;
}
function chooseAutoAction(g: Game, bot = false): Action {
  if(g.phase==="portal"){
   const choices=BOARD.filter(t=>t.kind==="city");const score=(tile:number)=>{const p=g.properties[tile];if(p.owner===g.turn)return p.buildings===7?10:30;if(p.owner===null&&g.players[g.turn].cash>=purchaseCost(g,tile))return 100+(criticalProperty(g,tile,g.turn)?1000:0)+BOARD[tile].price;return -rentPayment(g,tile,g.turn);};
   return {action:"portal_move",tile:choices.sort((a,b)=>score(b.index)-score(a.index))[0].index};
  }
  if(g.phase==="event")return defaultEventAction(g,bot);
  if(g.phase==="rent")return {action:g.world.players[g.turn].passCoupons>0?"coupon_pass":"rent_pay"};
  if (g.phase === "augment") {
    const offer = g.augments!.players[g.augmentSeat!].offer!;
    const preferences = ["revival", "investor", "tax", "landmark", "stealth", "salary", "steal", "force", "reroll", "realtor", "builder", "negotiator", "cashback", "double_lover", "selective_double", "conversion", "gambler", "gas", "trap", "poison", "mimic", "subsidy"];
    const ranked = offer.cards.map((id, slot) => ({ slot, rank: (() => { const n=preferences.indexOf(AUGMENT_CATALOG.find(a=>a.id===id)?.effect ?? "subsidy");return n<0?preferences.length:n; })() }));
    const slot = bot ? ranked.sort((a, b) => a.rank - b.rank)[0].slot : 0;
    return { action: "augment_select", offerId: offer.id, slot };
  }
  if (g.phase === "roll") startTurn(g);
  if (g.abilities.pendingTarget) return { action: "ability_target", target: turnTargets(g)[0] };
  const cash = g.players[g.turn].cash, index = g.players[g.turn].position, p = g.properties[index];
  if (g.phase === "dice") {
    const roll = g.abilities.roll!;
    if (roll.comparison) return { action: "dice_choose", useNew: bot && rollUtility(g, roll.comparison) > rollUtility(g, roll.result!) };
    const choices = availableDice(g);
    if (bot && rollUtility(g, roll.result!) < 0 && choices.rerolls.length) return { action: "dice_reroll", ability: choices.rerolls[0], die: 0 };
    return { action: "dice_confirm" };
  }
  if (g.phase === "roll") {
    if(g.world.players[g.turn].sleepThisTurn||g.abilities.statuses[g.turn].skipTurns>0)return {action:"roll"};
    if (bot && g.players[g.turn].position === 9 && power(g,g.turn,"island_owner") && g.abilities.islandOwner === null && cash >= lossAmount(g,g.turn,ISLAND_COST) + SALARY) return {action:"island_buy"};
    const choices = availableDice(g);
    if (bot && !g.abilities.roll) {
      const copies = choices.copies.map(sum => ({ sum, score: tileUtility(g, sum) } )).sort((a, b) => b.score - a.score);
      if (copies[0]?.score > 40) return { action: "dice_copy", option: copies[0].sum };
      if (choices.workSubsidy && cash < 60) return { action: "subsidy" };
      if (choices.selectiveDouble && g.doubles < 2) return { action: "dice_double", useNew: true };
    }
    return { action: "roll" };
  }
  if (g.phase === "debt") {
    if (assets(g, g.turn) < g.debt!.amount) return { action: "bankrupt" };
    const owned = BOARD.filter(t => g.properties[t.index].owner === g.turn).sort((a, b) => salePriority(g, a.index) - salePriority(g, b.index));
    return { action: "sell", tile: owned[0].index };
  }
  if (bot && g.phase === "end" && index===9 && power(g,g.turn,"island_owner") && g.abilities.islandOwner===null && cash>=lossAmount(g,g.turn,ISLAND_COST)) return {action:"island_buy"};
  if (bot && g.phase === "buy" && cash >= purchaseCost(g, index) + ((criticalProperty(g, index, g.turn) || g.players.some((p, i) => i !== g.turn && !p.bankrupt && criticalProperty(g, index, i))) ? 0 : SALARY)) return { action: "buy" };
  if (bot && landmarkAvailable(g,index) && cash >= landmarkCost(g, index) + SALARY * 1.5) return { action: "landmark" };
  if (bot && g.phase === "build" && !p.landmark) { const b = BUILDINGS.findIndex((_, i) => !(p.buildings & (1 << i)) && cash >= buildCost(g, index, i) + SALARY * 1.5); if (b >= 0) return { action: "build", building: b }; }
  if (bot && g.phase === "takeover" && !p.landmark && cash >= takeoverCost(g, index) + ((criticalProperty(g, index, g.turn) || g.players.some((p, i) => i !== g.turn && !p.bankrupt && criticalProperty(g, index, i))) ? 0 : SALARY * 1.5)) return { action: "takeover" };
  return { action: "end" };
}

export function purchaseCost(g: Game, index: number, seat = g.turn) { return spendCost(g, seat, BOARD[index].price, "realtor"); }
export function buildCost(g: Game, index: number, building: number, seat = g.turn) { return spendCost(g, seat, construction(index, building).cost, "builder"); }
export function landmarkBase(index:number){return 2*(BOARD[index].price+BUILDINGS.reduce((sum,_,i)=>sum+construction(index,i).cost,0));}
export function landmarkAvailable(g:Game,index=g.players[g.turn].position){const p=g.properties[index],visit=g.landmarkVisit;return g.phase==="build"&&g.players[g.turn].position===index&&p.owner===g.turn&&p.buildings===7&&!p.landmark&&visit?.seat===g.turn&&visit.tile===index&&visit.turnId===g.turnId;}
export function landmarkCost(g: Game, index: number) { return spendCost(g, g.turn, landmarkBase(index), "builder"); }
export function takeoverBase(g:Game,index:number){return Math.ceil(value(g,index)*1.5);}
export function playerDisplayOrder(g:Game){const order=[...(g.turnOrder??g.players.map((_,i)=>i))];return g.world.direction===-1?order.reverse():order;}
export function takeoverCost(g: Game, index: number, seat = g.turn) {
  const owner = g.properties[index].owner;
  return owner === null ? 0 : spendCost(g, seat, takeoverBase(g,index), "negotiator");
}
export function rentQuote(g:Game,index:number,seat:number){
 const owner=g.properties[index].owner;if(owner===null)return {amount:0,principal:0,receipt:0};
 const protectedVisitor=immune(g,seat),base=(protectedVisitor?rent(g,index,false):incomeWithoutGlass(g,owner,rent(g,index)))*((g.world?.players[seat].overspendUntil??0)>=g.abilities.ownerTurns[seat]&&(g.world?.players[seat].overspendUntil??0)>0?1.5:1);
 const amount=lossAmount(g,seat,base),principal=lossWithoutGlass(g,seat,base),receipt=glassIncome(g,owner,principal);
 return {amount,principal,receipt};
}
export function rentPayment(g:Game,index:number,seat:number){return rentQuote(g,index,seat).amount;}

export const ISLAND_COST = 300;
export const ISLAND_FEE = 30;
export function turnTargets(g: Game) {
  return g.players.flatMap((p, i) => i !== g.turn && !p.bankrupt && !immune(g, i) && sameLine(p.position,g.players[g.turn].position) ? [i] : []);
}
function targetWealth(g: Game, seat: number) { return g.players[seat].cash; }
function startTurn(g: Game) {
  if (g.abilities.startedTurn === g.turnId) return;
  g.abilities.startedTurn = g.turnId; g.abilities.ownerTurns[g.turn]++;
  const eventStatus=g.world?.players[g.turn];
  if(eventStatus){eventStatus.sleepThisTurn=eventStatus.sleep>0;eventStatus.endLocked=false;eventStatus.lostThisTurn=eventStatus.lostDice>0;eventStatus.reverseThisTurn=eventStatus.reverseMoves>0;}
  const status=g.abilities.statuses[g.turn];if(status.nextTurnRestricted){status.nextTurnRestricted=false;status.restrictWholeTurn=true;status.restrictedBy="신지드";}
  g.abilities.marks = g.abilities.marks.filter(m => (m.expiresRound ?? Infinity) > g.round);
  if(g.world?.players[g.turn].sleepThisTurn||g.abilities.statuses[g.turn].skipTurns>0){g.abilities.pendingTarget=false;return;}
  const position = g.players[g.turn].position;
  if (power(g, g.turn, "steal") && g.abilities.ownerTurns[g.turn] > 1) g.players.forEach((p, i) => { if (i !== g.turn && !p.bankrupt && p.position === position) steal(g, g.turn, i, Math.floor(p.cash * .1), "mosquito"); });
  if (power(g, g.turn, "jujitsu") && position !== 0) g.players.forEach((p, i) => { if (i !== g.turn && !p.bankrupt && !immune(g, i) && p.position === position) { g.abilities.statuses[i].skipTurns = Math.max(1, g.abilities.statuses[i].skipTurns); g.abilities.statuses[i].skipBy = "주짓수"; emitAbility(g.abilities, { actor:g.turn,target:i,tile:position,ability:"jujitsu",caption:"주짓수 · 다음 차례 기절",visual:"trap",stage:"before_move" }); } });
  if (power(g, g.turn, "exploit")) {const targets=turnTargets(g);for(const target of targets)steal(g,g.turn,target,Math.floor(targetWealth(g,target)*.15/targets.length),"exploit");}
  g.abilities.pendingTarget = !!power(g, g.turn, "vladimir") && turnTargets(g).length > 0;
}
export function mimicHistory(g: Game) { return g.abilities.throws.filter(t => t.seat !== g.turn && t.turnId > g.abilities.lastOwnTurn[g.turn]).map(t => t.sum); }
function prepareRoll(g: Game) {
  if (!g.abilities.roll) g.abilities.roll = createRoll(g.turn, g.abilities.ordinal, (g.abilities.statuses[g.turn].restrictedRolls > 0 || !!g.abilities.statuses[g.turn].restrictWholeTurn || !!g.world?.players[g.turn].lostThisTurn));
  return g.abilities.roll;
}
export function availableDice(g: Game) {
  const roll = g.abilities.roll ?? createRoll(g.turn, g.abilities.ordinal, (g.abilities.statuses[g.turn].restrictedRolls > 0 || !!g.abilities.statuses[g.turn].restrictWholeTurn || !!g.world?.players[g.turn].lostThisTurn));
  return diceChoices(roll, capabilities(g), mimicHistory(g), !g.players[g.turn].rest && !g.abilities.statuses[g.turn].skipTurns && !g.abilities.pendingTarget && !g.world?.players[g.turn].sleepThisTurn);
}
function diceAction(g: Game, input: Action, random: () => number, catalog: readonly AugmentDefinition[]) {
  const before = ["dice_force", "dice_double", "dice_copy", "subsidy"].includes(input.action);
  if (g.phase !== (before ? "roll" : "dice")) throw new Error("지금 사용할 수 없는 주사위 능력입니다.");
  if (before && (g.players[g.turn].rest || g.abilities.statuses[g.turn].skipTurns)) throw new Error("행동할 수 없습니다.");
  startTurn(g);
  const roll = prepareRoll(g), c = capabilities(g), choices = availableDice(g);
  if (input.action === "dice_force") {
    if (!choices.forces.includes(input.ability as ForceAbility)) throw new Error("보유하지 않은 힘조절입니다.");
    configureRoll(roll, c, { ability: input.ability as ForceAbility, option: input.option! }, roll.forcedDouble);
    emitAbility(g.abilities,{actor:g.turn,tile:g.players[g.turn].position,ability:input.ability!,stage:"before_move",caption:`${AUGMENT_CATALOG.find(a=>a.id===input.ability)?.name??"힘조절"} · 합계 ${roll.min}~${roll.max} 설정`,visual:"dice"});
  } else if (input.action === "dice_double") {
    if (!choices.selectiveDouble || typeof input.useNew !== "boolean") throw new Error("더블을 선택할 수 없습니다.");
    // Retain the configured force interval when toggling doubles.
    roll.forcedDouble = input.useNew; roll.avoidDouble = !input.useNew;
    emitAbility(g.abilities,{actor:g.turn,tile:g.players[g.turn].position,ability:"selective_double",stage:"before_move",caption:input.useNew?"선택적 더블 · 더블 선택":"선택적 더블 · 더블 제외",visual:"dice"});
  } else if (input.action === "dice_copy") {
    if (!choices.copies.includes(input.option!)) throw new Error("복사할 수 없는 이동량입니다.");
    const sum = input.option!;
    emitAbility(g.abilities,{actor:g.turn,tile:g.players[g.turn].position,ability:"mimic",stage:"before_move",caption:`따라쟁이 · ${sum}칸 이동 복사`,visual:"dice"});
    roll.result = [Math.max(1, sum - 6), Math.min(6, sum - 1)];
    g.abilities.copied = true; g.dice = [...roll.result];
    g.abilities.lastThrow = { id: (g.abilities.lastThrow?.id ?? 0) + 1, seat: g.turn, kind: "copy", dice: [...g.dice] }; finishDice(g, random, catalog);
  } else if (input.action === "subsidy") {
    if (!choices.workSubsidy) throw new Error("근로장려금을 받을 수 없습니다.");
    const paid = receiveSalary(g,g.turn);
    emitAbility(g.abilities, { actor: g.turn, tile: g.players[g.turn].position, ability: "subsidy", caption: `근로장려금 ${paid}만원`, visual: "income" });
    g.extraTurn = false; end(g,random,catalog);
  } else if (input.action === "dice_reroll") {
    rerollDice(roll, c, input.ability as RerollAbility, random, input.die); g.dice = [...roll.result!,...(roll.bonus?[roll.bonus]:[])];
    emitAbility(g.abilities,{actor:g.turn,tile:g.players[g.turn].position,ability:input.ability!,stage:"before_move",caption:input.ability === "suspicious_dice" ? `에디셔널 다이스 · +${roll.bonus}칸` : `${AUGMENT_CATALOG.find(a=>a.id===input.ability)?.name??"주사위 능력"} · 다시 던지기`,visual:"dice"});
    g.abilities.lastThrow = { id: (g.abilities.lastThrow?.id ?? 0) + 1, seat: g.turn, kind: "reroll", dice: input.ability === "suspicious_dice" ? [roll.bonus!] : [...(roll.comparison ?? roll.result!)], ...(input.ability === "suspicious_dice" ? { die: input.die } : {}) };
  } else if (input.action === "dice_choose") {
    if (typeof input.useNew !== "boolean") throw new Error("주사위 결과를 선택해주세요.");
    chooseBlackDice(roll, input.useNew); g.dice = [...roll.result!,...(roll.bonus?[roll.bonus]:[])];
  } else {
    if (!roll.result || roll.comparison) throw new Error("비교 결과를 먼저 선택해주세요.");
    finishDice(g, random, catalog);
  }
}
function finishDice(g: Game, random: () => number, catalog: readonly AugmentDefinition[]) {
  const firstEffect = g.abilities.nextEventId;
  const roll = g.abilities.roll!, player = g.players[g.turn], copied = g.abilities.copied;
  const double = !g.world.players[g.turn].lostThisTurn && !copied && g.dice[0] === g.dice[1];
  g.doubles = double ? g.doubles + 1 : 0; g.extraTurn = double;
  g.abilities.history.push(g.dice.reduce((sum,n)=>sum+n,0)); if (g.abilities.history.length > 12) g.abilities.history.shift();
  if (roll.restricted && g.abilities.statuses[g.turn].restrictedRolls > 0) g.abilities.statuses[g.turn].restrictedRolls--;
  g.abilities.throws.push({seat:g.turn, sum:g.dice.reduce((sum,n)=>sum+n,0), turnId:g.turnId});
  g.abilities.throws = g.abilities.throws.filter(t => t.turnId >= Math.min(...g.abilities.lastOwnTurn));
  note(g, `${g.turn + 1}P 주사위 ${g.dice.join(" + ")}${double ? " · 더블" : copied ? " · 복사" : ""}`);
  for (const event of g.abilities.events) if (event.id >= firstEffect) event.stage = "before_move";
  g.abilities.roll = null; g.abilities.copied = false;
  g.abilities.lastMove = { id: (g.abilities.lastMove?.id ?? 0) + 1, seat: g.turn, path: [player.position] };
  if (g.doubles >= 3 && (power(g, g.turn, "no_island") || power(g, g.turn, "island_owner"))) g.extraTurn = false;
  if (g.doubles >= 3 && !power(g, g.turn, "no_island") && !power(g, g.turn, "island_owner")) { g.abilities.lastMove.path.push(9); player.position = 9; player.rest = 3; g.extraTurn = false; g.phase = "end"; note(g, "3연속 더블 · 무인도로 이동합니다."); return; }
  if(g.abilities.ordinal===0 && g.world.players[g.turn].reverseThisTurn && g.world.players[g.turn].reverseMoves>0)g.world.players[g.turn].reverseMoves--;
  g.abilities.movement = { seat: g.turn, remaining: g.dice.reduce((sum,n)=>sum+n,0), visited: [], resume: "step" };
  advanceMovement(g, random, catalog);
}
function advanceMovement(g: Game, random: () => number, catalog: readonly AugmentDefinition[]) {
  const move = g.abilities.movement;
  if (!move) { arrive(g, random); return; }
  const player = g.players[g.turn];
  while (move.remaining > 0) {
    const direction=g.world.players[g.turn].reverseThisTurn?-1:1;
    const boundary=direction===1?player.position:(player.position+BOARD.length-1)%BOARD.length;
    if(g.world.walls.includes(boundary)){g.world.walls=g.world.walls.filter(b=>b!==boundary);move.remaining=0;g.abilities.lastMove!.wall={boundary,tile:player.position,next:(player.position+direction+36)%36};note(g,"벽 충돌 · 직전 칸에서 정지");break;}
    player.position = (player.position + direction + BOARD.length) % BOARD.length; move.remaining--; move.visited.push(player.position); g.abilities.lastMove?.path.push(player.position);
    passingEffects(g, random);
    if (g.phase === "finished") { g.abilities.movement = null; return; }
    if (player.position === 0 && direction===1) {
      player.laps++; if (g.augments) g.augments.players[g.turn].laps = player.laps;
      const salary = receiveSalary(g,g.turn); if (power(g,g.turn,"salary")) reportMoney(g,g.turn,"salary",`월급 인상 · ${salary}만원`,salary); note(g, `출발 통과 · 월급 ${salary}만원`);
      const tax = landTax(g, g.turn); note(g, `세금 ${tax}만원 · 정산 전 보유 현금 ${player.cash}만원`);
      if (!pay(g, tax, null, "arrival", "land_tax")) return;
      // The token stays on start during selection/debt; resume only the remaining steps.
      continueArrival(g, random, catalog); return;
    }
  }
  g.abilities.movement = null; arrive(g, random);
}
/** Cancel only this seat's remaining turn, including a suspended event frame. */
function cancelExtraTurn(g:Game,seat:number){
 const frame=g.world.interrupted;
 if(frame?.turn===seat){const pending=frame.extraTurn;frame.extraTurn=false;frame.doubles=0;return pending;}
 if(!frame&&g.turn===seat){const pending=g.extraTurn;g.extraTurn=false;g.doubles=0;return pending;}
 return false;
}
function tranquilize(g:Game,actor:number,target:number){
 const stopped=cancelExtraTurn(g,target),state=g.world.players[target];
 if(stopped||g.world.interrupted?.turn===target)state.endLocked=true;
 if(!stopped)state.sleep++;
 note(g,`마취총 · ${target+1}P ${stopped?'남은 더블 투척 취소':'다음 자기 차례 수면'}`);
 emitAbility(g.abilities,{actor,target,tile:g.players[target].position,ability:'tranquilizer',caption:stopped?'마취총 · 더블 추가 투척 취소':'마취총 · 한 턴 수면',visual:'trap'});
}
function applyMarks(g: Game, seat: number) {
  const tile = g.players[seat].position;
  const hit = g.abilities.marks.filter(m => m.tile === tile && m.owner !== seat && !g.players[m.owner].bankrupt && definitionsActive(g,m.owner) && !immune(g, seat) && (m.expiresRound ?? Infinity) > g.round);
  for (const mark of hit) {
    g.abilities.marks = g.abilities.marks.filter(m => m !== mark);
    const status=g.abilities.statuses[seat];
    if (mark.kind === "trap") {status.skipTurns = Math.max(status.skipTurns, 1);status.skipBy="덫";cancelExtraTurn(g,seat);}
    else if(mark.kind === "poison"){status.nextTurnRestricted=true;}
    else {status.restrictedRolls = Math.max(status.restrictedRolls, 1);status.restrictedBy="방귀쟁이";}
    emitAbility(g.abilities, { actor: mark.owner, target: seat, tile, ability: mark.kind === "poison" ? "singed" : mark.kind, caption: mark.kind === "trap" ? "덫 · 다음 투척 불가" : mark.kind === "poison" ? "신지드 · 다음 차례 주사위 제한" : "방귀쟁이 · 다음 투척 10 이하", visual: mark.kind === "gas" ? "poison" : mark.kind });
  }
}
function landEffects(g: Game) {
  const tile=g.players[g.turn].position;
  applyMarks(g,g.turn);
  // Marks remain until expiry or the first eligible opponent triggers them.
  for (const [effect, kind, duration] of [["gas","gas",2],["trap","trap",2],["singed","poison",3]] as const) {
    if (!power(g, g.turn, effect)) continue;
    const tiles = [tile];
    for (const at of new Set(tiles)) {
      g.abilities.marks = g.abilities.marks.filter(m => !(m.tile === at && m.kind === kind && m.owner === g.turn));
      g.abilities.marks.push({tile:at,owner:g.turn,kind,power:1,expiresAtOwnerTurn:0,expiresRound:g.round+duration});
    }
  }
}
function passingEffects(g: Game, random: () => number) {
  const move = g.abilities.movement!, actor = g.turn, tile = g.players[actor].position;
  // Final landing is not passing through another token.
  const passing = move.remaining > 0;
  for (let other = 0; other < g.players.length; other++) {
    if (other === actor || g.players[other].bankrupt || g.players[other].position !== tile) continue;
    if (!immune(g, other)) {
      if (passing && power(g, actor, "pickpocket") && random() < .3) steal(g,actor,other,power(g,actor,"pickpocket"),"pickpocket");
      if (passing && power(g, actor, "robber") && random() < .25) steal(g,actor,other,power(g,actor,"robber"),"robber");
      if (power(g, actor, "singed")) { g.players[other].position = (tile + BOARD.length - 2) % BOARD.length; emitAbility(g.abilities,{actor,target:other,tile,ability:"singed",caption:"신지드 · 뒤로 2칸",visual:"poison",flight:{seat:other,from:tile,to:(tile+BOARD.length-2)%BOARD.length}});forcedArrival(g,other,random); }
    }
    if (!passing || immune(g, actor)) continue;
    const vendor = power(g, other, "vendor"); if (vendor) steal(g,other,actor,vendor,"vendor");
    if (power(g,other,"low_kick") || power(g,other,"drop_kick")) { g.abilities.statuses[actor].restrictedRolls = Math.max(1,g.abilities.statuses[actor].restrictedRolls);g.abilities.statuses[actor].restrictedBy=power(g,other,"drop_kick")?"드롭킥":"로우킥"; }
    const reduction = Math.max(power(g,other,"calf_kick"),power(g,other,"drop_kick"));
    if (reduction) move.remaining = Math.max(0,move.remaining-reduction);
    if (power(g,other,"trip")) move.remaining = 0;
    if (reduction || power(g,other,"trip") || power(g,other,"low_kick")) emitAbility(g.abilities,{actor:other,target:actor,tile,ability:power(g,other,"trip")?"trip":power(g,other,"drop_kick")?"drop_kick":power(g,other,"calf_kick")?"calf_kick":"low_kick",caption:power(g,other,"trip")?"와사바리 · 이동 정지":`통과 공격 · 남은 이동 ${move.remaining}칸`,visual:"kick",remaining:move.remaining});
    // Every defender on this contact tile was passed at contact time, even if an earlier kick stops movement.
  }
}
function forcedArrival(g: Game, seat: number, random: () => number) {
  const p=g.players[seat],tile=BOARD[p.position],property=g.properties[p.position];
  applyMarks(g,seat);rewardRevisit(g,seat,tile.index);
  if(tile.kind==="event"||tile.kind==="portal"){g.world.deferred??=[];g.world.deferred.push({seat,tile:tile.index,effects:true,arrived:true,settled:true});note(g,"강제 이동 · 도착 이벤트 대기");}
  else if(tile.kind==="bonus") receiveIncome(g,seat,BONUS);
  else if(tile.kind==="rest" && !power(g,seat,"island_owner")) p.rest=3;
  else if(tile.kind==="city" && property.owner!==null && property.owner!==seat) {
    const quote=rentQuote(g,tile.index,seat),amount=quote.amount;property.festival=0;
    if(amount>0&&g.world.players[seat].autoPass>0){g.world.players[seat].autoPass--;note(g,`${seat+1}P 하이패스 · 강제 이동 통행료 면제`);}
    else if(amount>0&&g.world.players[seat].passCoupons>0){g.world.deferred??=[];g.world.deferred.push({seat,tile:tile.index,effects:false,noPurchase:true,rentAmount:amount,principal:quote.principal,receipt:quote.receipt,creditor:property.owner});note(g,`${seat+1}P 강제 이동 통행료 · 쿠폰 선택 대기`);}
    else settleForcedPayment(g,seat,amount,property.owner,quote);
  }
  else if(tile.kind==="start") { receiveSalary(g,seat);settleForcedPayment(g,seat,landTax(g,seat),null); }
}
function settleForcedPayment(g: Game, seat: number, amount: number, creditor: number | null,split:PaymentSplit={}) {
  const p=g.players[seat];
  // Forced displacement has no purchase phase. Liquidate assets only as needed for compulsory payments.
  for (const tile of BOARD.filter(t => g.properties[t.index].owner===seat).sort((a,b)=>salePriority(g,a.index)-salePriority(g,b.index))) {
    if(p.cash>=amount) break;
    const proceeds=saleProceeds(g,tile.index,seat);g.properties[tile.index]={owner:null,buildings:0,locust:g.properties[tile.index].locust};bankCashChange(g,seat,proceeds);
  }
  if(p.cash<amount) {
    const revival=g.abilities.statuses[seat].revival;
    if(revival&&!revival.consumed && revivePlayer(g,seat)) return;
    settlePayment(g,seat,p.cash,creditor,split);
    p.cash=0;p.bankrupt=true;g.properties.forEach(prop=>{if(prop.owner===seat){prop.owner=null;prop.buildings=0;prop.landmark=false;}});checkWin(g);return;
  }
  settlePayment(g,seat,amount,creditor,split);

}
function criticalProperty(g: Game, index: number, seat: number) {
  const tile = BOARD[index];
  return BOARD.filter(t => t.group === tile.group && t.index !== index).every(t => g.properties[t.index].owner === seat) ||
    BOARD.filter(t => t.kind === "city" && t.line === tile.line && t.index !== index).every(t => g.properties[t.index].owner === seat);
}
function salePriority(g: Game, index: number) { return value(g, index) + (criticalProperty(g, index, g.turn) ? 10000 : 0); }

/** Commit only fully validated transitions; rejected commands leave state untouched. */
export function applyAction(g: Game, input: Action, random: () => number = Math.random, catalog: readonly AugmentDefinition[] = AUGMENT_CATALOG): void {
  const next = structuredClone(g);
  const transfers=captureCashTransfers(next,()=>mutateAction(next,input,random,catalog));
  let id=next.moneyTransfers?.at(-1)?.id??0;
  if(transfers.length)next.moneyTransfers=[...(next.moneyTransfers??[]),...transfers.map(t=>({...t,id:++id}))].slice(-96);
  Object.assign(g, next);
}

export function preservesDeadline(before: Game, after: Game, action: Action) {
  return (before.augmentResume==="round30" && after.augmentResume==="round30") || action.action === "augment_reroll" || (before.turnId === after.turnId && before.abilities.ordinal === after.abilities.ordinal && ["roll", "dice"].includes(before.phase) && ["roll", "dice"].includes(after.phase));
}

function tileUtility(g: Game, sum: number) {
  const index = (g.players[g.turn].position + sum) % BOARD.length, t = BOARD[index], p = g.properties[index];
  const projectedSalary=salaryAmount(g,g.turn);const salary = g.players[g.turn].position + sum >= BOARD.length ? projectedSalary-landTax(g,g.turn,g.players[g.turn].cash+projectedSalary) : 0;
  if (t.kind === "rest") return salary - 35;
  if (t.kind === "bonus") return salary + incomeAmount(g, g.turn, BONUS);
  if (t.kind !== "city") return salary;
  if (p.owner === g.turn) return salary + (p.buildings !== 7 ? 12 : 2);
  if (p.owner !== null) return salary - rentPayment(g, index, g.turn);
  return salary + (criticalProperty(g, index, g.turn) ? 150 : 25) - purchaseCost(g, index) / 10;
}
function rollUtility(g: Game, dice: readonly number[]) { return tileUtility(g, dice[0] + dice[1]) + (dice[0] === dice[1] && g.doubles < 2 ? 12 : 0); }

export function netWorth(g: Game, seat: number) { return g.players[seat].cash + BOARD.reduce((sum, t) => sum + (g.properties[t.index].owner === seat ? Math.floor(value(g, t.index) / 2) : 0), 0); }

export function saleProceeds(g: Game, index: number, seat = g.turn) { return incomeAmount(g, seat, Math.floor(value(g, index) / 2)); }

export function definitionsActive(g:Game,seat:number){return (g.world?.players[seat].disabledUntil ?? 0)<=g.round;}
export function openEvent(g:Game,seat:number,random:()=>number=Math.random,id?:EventId){
 const event={id:id ?? drawEvent(random,power(g,seat,"luck")),seat,serial:g.world.nextSerial++};
 g.world.current=event;g.world.history.push(event);if(g.world.history.length>60)g.world.history.shift();g.phase="event";
 note(g,`${seat+1}P 이벤트 · ${eventDefinition(event.id).name}`);
}
export function eventTargets(g:Game){return g.players.flatMap((p,i)=>i!==g.turn&&!p.bankrupt?[i]:[]);}
export function eventOwnedTiles(g:Game){return BOARD.filter(t=>t.kind==="city"&&g.properties[t.index].owner===g.turn).map(t=>t.index);}
function eventSample<T>(pool:readonly T[],random:()=>number):T|undefined{return pool.length?pool[Math.min(pool.length-1,Math.floor(random()*pool.length))]:undefined;}
function eventShuffle<T>(pool:readonly T[],random:()=>number){const a=[...pool];for(let i=a.length-1;i>0;i--){const j=Math.min(i,Math.floor(random()*(i+1)));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function destroyTopBuilding(g:Game,tile:number,loseEmpty=false,kind:"quake"|"missile"="quake"){
 const p=g.properties[tile],before={...p};
 const record=()=>{if(g.destructionBatch?.revision!==g.revision)g.destructionBatch={id:(g.destructionBatch?.id??0)+1,revision:g.revision,kind,items:[]};g.destructionBatch!.items.push({tile,before});};
 if(p.landmark){p.landmark=false;record();note(g,`${BOARD[tile].name} 랜드마크 붕괴`);return;}
 for(let i=BUILDINGS.length-1;i>=0;i--)if(p.buildings&(1<<i)){p.buildings&=~(1<<i);record();note(g,`${BOARD[tile].name} ${BUILDINGS[i].name} 붕괴`);return;}
 if(loseEmpty&&p.owner!==null){p.owner=null;p.festival=0;record();note(g,`${BOARD[tile].name} 소유권 소멸`);}
}

function beginEventVisits(g:Game,visits:EventState["visits"],random:()=>number,catalog:readonly AugmentDefinition[]){
 if(!g.world.interrupted)g.world.interrupted={turn:g.turn,extraTurn:g.extraTurn,doubles:g.doubles,ordinal:g.abilities.ordinal,phase:"end",sleepAtStart:g.players[g.turn].rest};
 // A nested displacement resolves ahead of the remaining visitors.
 g.world.visits.unshift(...visits);nextEventVisit(g,random,catalog);
}
function nextEventVisit(g:Game,random:()=>number=Math.random,catalog:readonly AugmentDefinition[]=AUGMENT_CATALOG){
 while(g.world.visits.length){
  const visit=g.world.visits.shift()!;if(g.players[visit.seat].bankrupt||(visit.arrived&&g.players[visit.seat].position!==visit.tile))continue;
  g.world.noPurchase=!!visit.noPurchase;
  g.turn=visit.seat;g.extraTurn=false;g.doubles=0;g.abilities.ordinal=0;g.abilities.roll=null;g.abilities.movement=null;
  const previous=g.players[g.turn].position;g.players[g.turn].position=visit.tile;
  if(!visit.arrived&&previous!==visit.tile)g.abilities.lastMove={id:(g.abilities.lastMove?.id??0)+1,seat:g.turn,path:[previous,visit.tile],flight:visit.flight};
  g.phase="end";
  // Forced arrivals share Singed settlement. Ordinary event visits retain their destination rules.
  if(visit.rentAmount!==undefined&&visit.creditor!==undefined){g.world.rent={amount:visit.rentAmount,principal:visit.principal,receipt:visit.receipt,creditor:visit.creditor,tile:visit.tile};g.phase="rent";}
  else if(visit.effects&&visit.settled){if(BOARD[visit.tile].kind==="event")openEvent(g,visit.seat,random);else if(BOARD[visit.tile].kind==="portal")g.phase="portal";}
  else if(visit.effects&&(visit.forced||visit.startEffects&&visit.tile===0))forcedArrival(g,visit.seat,random);
  else if(visit.effects && visit.tile!==0)arrive(g,random);
  if(g.world.interrupted && g.turn===g.world.interrupted.turn && g.players[g.turn].rest>g.world.interrupted.sleepAtStart)g.world.interrupted.extraTurn=false;
  return;
 }
 const frame=g.world.interrupted;if(!frame)return;
 g.world.interrupted=null;g.world.noPurchase=false;g.turn=frame.turn;g.extraTurn=frame.extraTurn&&!g.players[g.turn].bankrupt;g.doubles=frame.doubles;g.abilities.ordinal=frame.ordinal;g.phase="end";
 if(g.players[g.turn].bankrupt){checkWin(g);if(g.winner===null)end(g,random,catalog);}
}
function resolveEvent(g:Game,input:Action,random:()=>number,catalog:readonly AugmentDefinition[]){
 const pending=g.world.current;
 if(g.phase!=="event"||!pending||pending.seat!==g.turn||input.eventSerial!==pending.serial)throw new Error("최신 이벤트를 확인해주세요.");
 const id=pending.id,seat=g.turn,status=g.world.players[seat];
 const target=()=>{if(!Number.isInteger(input.target)||!eventTargets(g).includes(input.target!))throw new Error("대상 플레이어를 선택해주세요.");return input.target!;};
 const ownedTile=()=>{if(!eventOwnedTiles(g).length)return undefined;if(!Number.isInteger(input.tile)||!eventOwnedTiles(g).includes(input.tile!))throw new Error("내 지역을 선택해주세요.");return input.tile!;};
 if(input.decline && id!=="hero"&&id!=="change_augment")throw new Error("이 이벤트는 거부할 수 없습니다.");
 // The atomic applyAction clone prevents failed choices from consuming the event.
 g.world.current=null;g.phase="end";
 if(input.decline){note(g,`${eventDefinition(id).name} · 사용 포기`);return;}
 switch(id){
  case "salary_again":{const paid=receiveSalary(g,seat);note(g,`월급 한번더! · ${paid}만원`);break;}
  case "festival":{const tile=ownedTile();if(tile!==undefined){g.properties[tile].festival=(g.properties[tile].festival??0)+1;note(g,`${BOARD[tile].name} 축제 · 다음 상대 방문까지 통행료 2배`);}else note(g,"소유 지역이 없어 축제 종료");break;}
  case "telekinesis":{const other=target();if(!Number.isInteger(input.steps)||input.steps!<1||input.steps!>3)throw new Error("밀어낼 칸 수는 1~3입니다.");beginEventVisits(g,[{seat:other,tile:(g.players[other].position-input.steps!+36)%36,effects:true,flight:true,forced:true}],random,catalog);break;}
  case "line_quake":{if(!Number.isInteger(input.line)||input.line!<0||input.line!>3)throw new Error("라인을 선택해주세요.");for(const t of BOARD.filter(t=>t.kind==="city"&&t.line===input.line))destroyTopBuilding(g,t.index);break;}
  case "pass_coupon":status.passCoupons++;break;
  case "long_robbery":{const other=target();const {principal}=stealMoney(g,seat,other,Math.floor(g.players[other].cash*.1));note(g,`초장거리 강도 · ${other+1}P에게서 ${principal}만원 강탈`);break;}
  case "home_stone":status.homeStones++;break;
  case "wall":{const free=BOARD.map(t=>t.index).filter(i=>!g.world.walls.includes(i));if(!free.length)break;if(!Number.isInteger(input.tile)||!free.includes(input.tile!))throw new Error("벽이 없는 경계를 선택해주세요.");g.world.walls.push(input.tile!);break;}
  case "hero":{const other=target();beginEventVisits(g,[{seat,tile:g.players[other].position,effects:true,startEffects:true}],random,catalog);break;}
  case "tranquilizer":tranquilize(g,seat,target());break;
  case "extra_coupon":status.extraCoupons++;break;
  case "typhoon":{
   const items=playerDisplayOrder(g).filter(i=>!g.players[i].bankrupt).map(seat=>({seat,from:g.players[seat].position,to:(g.players[seat].position+34)%36}));
   g.flightBatch={id:(g.flightBatch?.id??0)+1,items};for(const item of items)g.players[item.seat].position=item.to;
   beginEventVisits(g,items.map(item=>({seat:item.seat,tile:item.to,effects:true,arrived:true,forced:true})),random,catalog);break;
  }
  case "locust":{const start=Math.min(35,Math.floor(random()*36));g.locustBatch={id:(g.locustBatch?.id??0)+1,path:Array.from({length:6},(_,i)=>(start+i)%36)};for(let step=1;step<=5;step++){const tile=(start+step)%36;if(BOARD[tile].kind==="city")g.properties[tile].locust=(g.properties[tile].locust??0)+1;}note(g,`메뚜기떼 · ${BOARD[start].name}에서 5칸 이동`);break;}
  case "change_augment":{
   const owned=g.augments?.players[seat].owned??[];if(!owned.length){note(g,"보유 증강이 없어 교체 종료");break;}
   const old=catalog.find(a=>a.id===input.augmentId&&owned.includes(a.id));if(!old)throw new Error("교체할 증강을 선택해주세요.");
   const replacement=eventSample(catalog.filter(a=>a.tier===old.tier&&!owned.includes(a.id)),random);if(!replacement){note(g,"교체할 후보가 없습니다.");break;}
   g.augments!.players[seat].owned=owned.filter(id=>id!==old.id);g.augments!.players[seat].owned.push(replacement.id);
   const revivals=g.abilities.statuses[seat].revivals;if(revivals)g.abilities.statuses[seat].revivals=revivals.filter(r=>r.id!==old.id);
   if(old.effect==="revival"){g.abilities.statuses[seat].revival=null;syncRevival(g,seat);}
   if(old.effect==="gambler")for(const t of BOARD)if(g.properties[t.index].owner===seat)refreshGamble(g,seat,t.index,random);
   acquireEffect(g,seat,replacement.id,random,catalog);note(g,`증강변경 · ${old.name} → ${replacement.name}`);break;
  }
  case "quake":for(const tile of eventShuffle(BOARD.filter(t=>g.properties[t.index].buildings||g.properties[t.index].landmark).map(t=>t.index),random).slice(0,3))destroyTopBuilding(g,tile);break;
  case "wormhole":{const tile=eventSample(BOARD.filter(t=>t.kind==="event"&&t.index!==g.players[seat].position),random);if(tile)beginEventVisits(g,[{seat,tile:tile.index,effects:false}],random,catalog);break;}
  case "homing":{g.players[seat].position=0;const salary=receiveSalary(g,seat);note(g,`귀소본능 · 월급 ${salary}만원`);pay(g,landTax(g,seat),null,"event","land_tax");break;}
  case "random_wall":{const tile=eventSample(BOARD.map(t=>t.index).filter(i=>!g.world.walls.includes(i)),random);if(tile!==undefined)g.world.walls.push(tile);break;}
  case "auto_pass":status.autoPass++;break;
  case "fool":{const other=eventSample(eventTargets(g),random);if(other!==undefined)beginEventVisits(g,[{seat,tile:g.players[other].position,effects:true}],random,catalog);break;}
  case "reverse_order":g.world.direction=g.world.direction===1?-1:1;break;
  case "bet":{if(!Number.isSafeInteger(input.amount)||input.amount!<0||input.amount!>g.players[seat].cash)throw new Error("보유 현금 이하의 정수 금액을 입력해주세요.");const amount=input.amount!;if(random()<.5){const profit=receiveIncome(g,seat,amount);note(g,`도박 성공 · 원금 유지 · 수익 ${profit}만원`);}else{const loss=Math.min(g.players[seat].cash,lossAmount(g,seat,amount));consumeLoss(g,seat,loss);g.players[seat].cash-=loss;note(g,`도박 실패 · ${loss}만원 손실`);}break;}
  case "depression":for(const s of g.world.players)s.halfSalary++;break;
  case "sleep":status.sleep++;cancelExtraTurn(g,seat);status.endLocked=true;break;
  case "vacation":beginEventVisits(g,[{seat,tile:9,effects:true}],random,catalog);break;
  case "unpaid":status.unpaidSalary++;break;
  case "lost_die":status.lostDice++;break;
  case "famine":g.world.famineUntil=g.round+3;break;
  case "overspend":status.overspendUntil=g.abilities.ownerTurns[seat]+3;break;
  case "reverse_move":status.reverseMoves++;break;
  case "disable":status.disabledUntil=g.round+3;g.abilities.pendingTarget=false;break;
  case "vulnerable":status.vulnerable++;break;
  case "missile":for(const tile of eventShuffle(eventOwnedTiles(g),random).slice(0,3))destroyTopBuilding(g,tile,true,"missile");break;
  default:{const unreachable:never=id;throw new Error(`처리되지 않은 이벤트: ${unreachable}`);}
 }
}
function defaultEventAction(g:Game,bot:boolean):Action {
 const event=g.world.current!;const action:Action={action:"event_resolve",eventSerial:event.serial};
 const id=event.id;
 if(["telekinesis","long_robbery","hero","tranquilizer"].includes(id))action.target=eventTargets(g).sort((a,b)=>g.players[b].cash-g.players[a].cash)[0];
 if(id==="hero"&&!bot)action.decline=true;
 if(id==="telekinesis")action.steps=1;
 if(id==="festival")action.tile=eventOwnedTiles(g).sort((a,b)=>rent(g,b)-rent(g,a))[0];
 if(id==="line_quake")action.line=0;
 if(id==="wall")action.tile=BOARD.find(t=>!g.world.walls.includes(t.index))?.index;
 if(id==="change_augment")action.decline=true;
 if(id==="bet")action.amount=0;
 return action;
}
