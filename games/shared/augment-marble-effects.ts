import { bankCashChange } from "./augment-marble-money.js";
import { SALARY } from "./augment-marble-economy.js";
import { AUGMENT_CATALOG, AUGMENT_TIERS, type AugmentDefinition, type EffectKind } from "./augment-marble-augments.js";
import { emitAbility, type DiceCapabilities } from "./augment-marble-runtime.js";
import type { Game } from "./augment-marble.js";

export function definitions(g: Game, seat: number, catalog: readonly AugmentDefinition[] = AUGMENT_CATALOG) {
  if((g.world?.players[seat].disabledUntil ?? 0)>g.round)return [];
  const owned = g.augments?.players[seat].owned ?? [];
  return catalog.filter(a => owned.includes(a.id));
}
export function power(g: Game, seat: number, kind: EffectKind) {
  return Math.max(0, ...definitions(g, seat).filter(a => a.effect === kind).map(a => a.power ?? 0));
}
export function factor(g: Game, seat: number, kind: EffectKind, discount = false) {
  return definitions(g, seat).filter(a => a.effect === kind).reduce((n, a) => n * (1 + (discount ? -1 : 1) * (a.power ?? 0) / 100), 1);
}
export function incomeAmount(g: Game, seat: number, amount: number) {
  const multiplier = (power(g, seat, "investor") ? 2 : 1) * (power(g, seat, "glass_cannon") ? 2.5 : 1);
  return Math.max(0, Math.ceil(amount * multiplier - 1e-9));
}
export function incomeWithoutGlass(g:Game,seat:number,amount:number){return Math.max(0,Math.ceil(amount*(power(g,seat,"investor")?2:1)-1e-9));}
export function glassIncome(g:Game,seat:number,amount:number){return Math.max(0,Math.ceil(amount*(power(g,seat,"glass_cannon")?2.5:1)-1e-9));}
export function lossWithoutGlass(g:Game,seat:number,amount:number){return Math.max(0,Math.ceil(amount*(g.world?.players[seat].vulnerable?2:1)));}
export function transferMoney(g:Game,payer:number,receiver:number,paid:number,principal:number,received:number){
 g.players[payer].cash-=principal;g.players[receiver].cash+=principal;
 bankCashChange(g,payer,-(paid-principal));bankCashChange(g,receiver,received-principal);
}
export function stealMoney(g:Game,actor:number,target:number,amount:number){
 const base=incomeWithoutGlass(g,actor,amount),paid=Math.min(g.players[target].cash,lossAmount(g,target,base)),principal=Math.min(paid,lossWithoutGlass(g,target,base)),received=glassIncome(g,actor,principal);
 transferMoney(g,target,actor,paid,principal,received);consumeLoss(g,target,paid);return {paid,principal,received};
}
export function salaryAmount(g:Game,seat:number){
 const status=g.world?.players[seat];
 return status?.unpaidSalary ? 0 : Math.ceil((power(g,seat,"investor")?0:SALARY*(power(g,seat,"salary")?1.5:1)*(power(g,seat,"glass_cannon")?2.5:1))*((status?.halfSalary ?? 0)>0 ? .5:1));
}
export function receiveSalary(g:Game,seat:number){const amount=salaryAmount(g,seat),status=g.world?.players[seat];if(status){if(status.unpaidSalary>0)status.unpaidSalary--;if(status.halfSalary>0)status.halfSalary--;}bankCashChange(g,seat,amount);return amount;}
export function consumeLoss(g:Game,seat:number,amount:number){const status=g.world?.players[seat];if(amount>0&&status?.vulnerable)status.vulnerable--;}

export function lossAmount(g: Game, seat: number, amount: number) { return Math.max(0, Math.ceil(amount * (power(g, seat, "glass_cannon") ? 2 : 1) * (g.world?.players[seat].vulnerable ? 2:1))); }
export function immune(g: Game, seat: number) { return seat !== (g.world?.interrupted?.turn ?? g.turn) && !!power(g, seat, "stealth"); }
export function receiveIncome(g: Game, seat: number, amount: number) {
  const paid = incomeAmount(g, seat, amount); bankCashChange(g,seat,paid); return paid;
}
export function spendCost(g: Game, seat: number, amount: number, kind: "builder" | "realtor" | "negotiator") {
  return lossAmount(g, seat, Math.max(0, Math.ceil(amount * factor(g, seat, kind, true) - 1e-9)));
}
// Original cashback applies only to money taken by another player's augment.
export function cashback(_g: Game, _seat: number, _amount: number) {}
export function steal(g: Game, actor: number, target: number, amount: number, ability: string) {
  if (immune(g, target) || g.players[target].bankrupt) return;
  const {paid,principal,received}=stealMoney(g,actor,target,amount);
  if (power(g, target, "cashback")) receiveIncome(g, target, Math.floor(paid / 2));
  const card = definitions(g,actor).find(a => a.id === ability || a.effect === ability);
  if (paid) emitAbility(g.abilities, { actor, target, tile: g.players[target].position, ability:card?.id ?? ability, ...( ["mosquito","vladimir","exploit"].includes(ability) ? {stage:"before_move" as const} : {}), caption: `${actor + 1}P가 ${target + 1}P에게서 ${principal}만원 강탈${paid!==principal?` · 추가 지출 ${paid-principal}만원 소멸`:""}${received!==principal?` · 추가 수입 ${received-principal}만원 은행 지급`:""}`, amount: received, visual: "steal" });
}
export function refreshGamble(g: Game, seat: number, index: number, random: () => number) {
  const owned=g.augments?.players[seat].owned ?? [];
  const n=Math.max(0,...AUGMENT_CATALOG.filter(a=>owned.includes(a.id)&&a.effect==="gambler").map(a=>a.power??0));
  g.abilities.gambles[seat][index] = n ? (random() < .5 ? (n === 4 ? 0 : .5) : n) : 1;
}
export function capabilities(g: Game, seat = g.turn): DiceCapabilities {
  const owned = definitions(g, seat);
  return {
    selectiveDouble: g.abilities.ordinal === 0 && !!power(g, seat, "selective_double"), doubleLover: !!power(g, seat, "double_lover"),
    forces: owned.filter(a => a.effect === "force").map(a => `force_${a.tier}` as "force_silver" | "force_gold" | "force_prism"),
    mimic: !!power(g, seat, "mimic"), workSubsidy: !!power(g, seat, "subsidy"),
    rerolls: owned.filter(a => a.effect === "reroll").map(a => a.id as "suspicious_dice" | "red_dice" | "black_dice"),
  };
}
export function acquireEffect(g: Game, seat: number, id: string, random: () => number, catalog: readonly AugmentDefinition[] = AUGMENT_CATALOG, visited = new Set<string>()) {
  const a = catalog.find(a => a.id === id);
  if (!a || visited.has(id)) return;
  const eventStatus=g.world?.players[seat];
  if(eventStatus && eventStatus.disabledUntil>g.round){eventStatus.pendingAcquisitions??=[];if(!eventStatus.pendingAcquisitions.includes(id))eventStatus.pendingAcquisitions.push(id);return;}
  visited.add(id);
  const p = g.augments!.players[seat], status = g.abilities.statuses[seat];
  if (a.effect === "revival") {
    status.revivals ??= [];
    if(!status.revivals.some(r=>r.id===a.id)) status.revivals.push({id:a.id,cash:a.power ?? 0,tier:AUGMENT_TIERS.indexOf(a.tier),consumed:false});
    syncRevival(g,seat);
  }
  if (a.effect === "grant") { const paid = receiveIncome(g, seat, a.power ?? 0); reportMoney(g, seat, "grant", `${a.name} · +${paid}만원`, paid); }
  if (a.effect === "gambler") for (let tile = 0; tile < g.properties.length; tile++) if (g.properties[tile].owner === seat) refreshGamble(g, seat, tile, random);
  if (a.effect === "conversion") {
    p.owned = p.owned.filter(x => x !== id);
    for (let i = 0; i < (a.power ?? 1); i++) {
      const pool = catalog.filter(b => b.tier === (a.targetTier ?? a.tier) && !p.owned.includes(b.id) && !visited.has(b.id));
      if (!pool.length) break;
      const b = pool[Math.floor(random() * pool.length)]; p.owned.push(b.id);
      acquireEffect(g, seat, b.id, random, catalog, visited);
      emitAbility(g.abilities, { actor: seat, tile: g.players[seat].position, ability: b.id, caption: `${b.name} 획득`, visual: "buff" });
    }
  }
}

export function cashbackAmount(_g: Game, _seat: number, _cost: number) { return 0; }
export function reportMoney(g: Game, seat: number, kind: EffectKind, caption: string, amount?: number, stage?: "before_move" | "after_move") {
  const ability = definitions(g, seat).filter(a => a.effect === kind).at(-1);
  if (!ability) return;
  emitAbility(g.abilities, { actor: seat, tile: g.players[seat].position, ability: ability.id, caption, amount, stage, visual: "income" });
}
export function reportDiscount(g: Game, seat: number, kind: "builder" | "realtor" | "negotiator", base: number, discounted: number) {
  if (base > discounted) reportMoney(g, seat, kind, `${kind === "builder" ? "건축 할인" : kind === "realtor" ? "매입 할인" : "인수 할인"} · ${base} → ${discounted}만원`, base - discounted);
}

export function syncRevival(g:Game,seat:number) {
 const s=g.abilities.statuses[seat],remaining=s.revivals?.filter(r=>!r.consumed).sort((a,b)=>b.tier-a.tier);
 if(remaining?.length)s.revival={tier:remaining[0].tier,consumed:false};
 else if(s.revivals?.length)s.revival={tier:Math.max(...s.revivals.map(r=>r.tier)),consumed:true};
}
export function revivePlayer(g:Game,seat:number) {
 if((g.world?.players[seat].disabledUntil??0)>g.round)return false;
 const s=g.abilities.statuses[seat],charge=s.revivals?.filter(r=>!r.consumed).sort((a,b)=>b.tier-a.tier)[0];
 if(!charge)return false;
 charge.consumed=true;g.players[seat].cash=charge.cash;syncRevival(g,seat);
 emitAbility(g.abilities,{actor:seat,tile:g.players[seat].position,ability:charge.id,caption:`${AUGMENT_CATALOG.find(a=>a.id===charge.id)?.name} · 현금 ${charge.cash}만원으로 부활`,visual:"revive"});return true;
}

export function flushPendingAcquisitions(g:Game,random:()=>number,catalog:readonly AugmentDefinition[]=AUGMENT_CATALOG){
 for(let seat=0;seat<g.players.length;seat++){
  const status=g.world?.players[seat];if(!status||status.disabledUntil>g.round||g.players[seat].bankrupt)continue;
  const pending=status.pendingAcquisitions??[];status.pendingAcquisitions=[];
  for(const id of pending)if(g.augments?.players[seat].owned.includes(id))acquireEffect(g,seat,id,random,catalog);
 }
}
