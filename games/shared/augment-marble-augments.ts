/** Selection rules only. Concrete augment effects are registered separately. */
export const AUGMENT_TIERS = ["silver", "gold", "prism"] as const;
export type AugmentTier = typeof AUGMENT_TIERS[number];
export const TIER_LABELS: Record<AugmentTier, string> = { silver: "실버", gold: "골드", prism: "프리즘" };
export const AUGMENT_MILESTONES = [0, 1, 3, 5] as const;
export const AUGMENT_SELECTION_MS = 30_000;
// Initial configurable distribution; sampled once per match and acquisition slot.
export const TIER_WEIGHTS = { silver: 40, gold: 40, prism: 20 } as const;
export const AUGMENT_HOOKS = ["acquire", "pass_start", "before_move", "arrive", "before_build", "before_rent", "before_takeover", "turn_end"] as const;
export type AugmentHook = typeof AUGMENT_HOOKS[number];
export interface AugmentDefinition {
  id: string;
  name: string;
  tier: AugmentTier;
  description: string;
  hooks: readonly AugmentHook[];
  effect?: EffectKind;
  power?: number;
  targetTier?: AugmentTier;
}
export type EffectKind = "builder" | "calf_kick" | "cashback" | "conversion" | "double_lover" | "drop_kick" | "exploit" | "force" | "gambler" | "gas" | "glass_cannon" | "grant" | "investor" | "island_owner" | "jujitsu" | "landmark" | "low_kick" | "luck" | "mimic" | "negotiator" | "no_island" | "pickpocket" | "realtor" | "reroll" | "revival" | "robber" | "salary" | "selective_double" | "singed" | "steal" | "stealth" | "subsidy" | "tax" | "trap" | "trip" | "vendor" | "vladimir";
// 57 active original cards after retiring the three force-control augments.
export const AUGMENT_CATALOG: readonly AugmentDefinition[] = [
  {"id": "mosquito", "name": "모기", "tier": "silver", "effect": "steal", "power": 10, "description": "자신의 차례 시작 시 같은 칸의 모든 상대에게서 보유 골드의 10%를 강탈합니다. 첫 차례에는 발동하지 않습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "realtor_silver", "name": "부동산 할인", "tier": "silver", "effect": "realtor", "power": 10, "description": "지역 구매 비용을 10% 할인받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "builder_silver", "name": "건설자", "tier": "silver", "effect": "builder", "power": 10, "description": "건물 건설 비용을 10% 할인받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "salary_raise", "name": "월급 인상", "tier": "gold", "effect": "salary", "power": 50, "description": "월급을 1.5배 받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "negotiator_silver", "name": "인수의 고수", "tier": "silver", "effect": "negotiator", "power": 10, "description": "인수 비용을 10% 할인받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "selective_double", "name": "선택적 더블", "tier": "gold", "effect": "selective_double", "power": 1, "description": "매 차례 첫 주사위에서 더블 여부를 선택할 수 있습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "no_island", "name": "그런곳 가지 않아요", "tier": "silver", "effect": "no_island", "power": 1, "description": "3연속 더블이어도 무인도로 가지 않고 이동합니다. 추가 주사위는 던지지 않습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "tax_silver", "name": "세금감면", "tier": "silver", "effect": "tax", "power": 20, "description": "세금이 20% 줄어듭니다.", "hooks": ["before_move", "arrive"]},
  {"id": "suspicious_dice", "name": "수상한주사위", "tier": "silver", "effect": "reroll", "power": 1, "description": "주사위를 던진 뒤 두 주사위 중 하나를 골라 다시 던질 수 있습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "low_kick", "name": "로우킥", "tier": "silver", "effect": "low_kick", "power": 1, "description": "차례를 기다리는 동안 자신을 통과하는 상대의 다음 주사위 합계를 10 이하로 제한합니다. 해당 투척의 주사위 능력은 무시합니다.", "hooks": ["before_move", "arrive"]},
  {"id": "cocoa", "name": "코코아 팔기", "tier": "silver", "effect": "vendor", "power": 33, "description": "자신을 통과하는 상대에게 코코아를 팔아 33만원을 받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "grant_silver", "name": "지급", "tier": "silver", "effect": "grant", "power": 125, "description": "획득 즉시 125만원을 받습니다.", "hooks": ["acquire"]},
  {"id": "revival_silver", "name": "트린다미어", "tier": "silver", "effect": "revival", "power": 0, "description": "파산 위기 시 한 번 부활합니다. 부활 시 현금은 0원이 됩니다.", "hooks": ["acquire"]},
  {"id": "mimic", "name": "따라쟁이", "tier": "gold", "effect": "mimic", "power": 1, "description": "자신의 이전 차례와 현재 차례 사이에 다른 플레이어가 던진 주사위의 칸 수를 복사해 이동할 수 있습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "conversion_gold", "name": "전환 : 골드", "tier": "silver", "effect": "conversion", "power": 1, "description": "이 카드를 소비하고 골드 증강 1개를 무작위로 얻습니다.", "hooks": ["acquire"], "targetTier": "gold"},
  {"id": "pickpocket", "name": "소매치기", "tier": "silver", "effect": "pickpocket", "power": 75, "description": "상대를 통과할 때 30% 확률로 75만원을 갈취합니다.", "hooks": ["before_move", "arrive"]},
  {"id": "luck", "name": "행운!", "tier": "silver", "effect": "luck", "power": 50, "description": "이벤트 칸에서 부정적 이벤트가 발생할 확률이 50% 줄어듭니다.", "hooks": ["before_move", "arrive"]},
  {"id": "double_lover", "name": "더블애호가", "tier": "silver", "effect": "double_lover", "power": 1, "description": "주사위에서 더블이 나올 확률이 증가합니다.", "hooks": ["before_move", "arrive"]},
  {"id": "investor", "name": "전업투자자", "tier": "gold", "effect": "investor", "power": 2, "description": "월급을 받지 않는 대신 능력 수입과 부동산 수입 등 월급 외 수입이 2배가 됩니다.", "hooks": ["before_move", "arrive"]},
  {"id": "calf_kick", "name": "카프킥", "tier": "gold", "effect": "calf_kick", "power": 2, "description": "자신을 통과하는 상대의 남은 이동 칸 수를 2칸 줄입니다. 남은 칸이 부족하면 자신의 위치에서 멈춥니다.", "hooks": ["before_move", "arrive"]},
  {"id": "red_dice", "name": "레드다이스", "tier": "gold", "effect": "reroll", "power": 2, "description": "매 주사위마다 두 주사위를 한 번 다시 던질 수 있습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "vladimir", "name": "블라디미르", "tier": "gold", "effect": "vladimir", "power": 10, "description": "매 차례 시작 시 같은 라인의 상대 한 명을 골라 보유 현금의 10%를 흡수합니다. 모서리는 인접한 두 라인 모두에 포함됩니다.", "hooks": ["before_move", "arrive"]},
  {"id": "gambler_gold", "name": "도박사", "tier": "gold", "effect": "gambler", "power": 2, "description": "내 지역마다 각각 50% 확률로 통행료가 0.5배 또는 2배가 됩니다. 앞으로 얻는 지역에도 적용됩니다.", "hooks": ["acquire"]},
  {"id": "jujitsu", "name": "주짓수", "tier": "gold", "effect": "jujitsu", "power": 1, "description": "매 차례 시작 시 같은 칸의 상대를 기절시켜 한 차례 쉬게 합니다. 출발 칸에서는 발동하지 않습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "coffee", "name": "커피팔기", "tier": "gold", "effect": "vendor", "power": 45, "description": "자신을 통과하는 상대에게 커피를 팔아 45만원을 받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "grant_gold", "name": "지급 2", "tier": "gold", "effect": "grant", "power": 500, "description": "획득 즉시 500만원을 받습니다.", "hooks": ["acquire"]},
  {"id": "revival_gold", "name": "트린다미어2", "tier": "gold", "effect": "revival", "power": 125, "description": "파산 시 한 번 부활하고 현금 125만원을 받습니다.", "hooks": ["acquire"]},
  {"id": "tax_gold", "name": "세금 감면2", "tier": "gold", "effect": "tax", "power": 50, "description": "세금이 50% 줄어듭니다.", "hooks": ["before_move", "arrive"]},
  {"id": "realtor_gold", "name": "부동산 고수", "tier": "gold", "effect": "realtor", "power": 20, "description": "지역 구매 비용을 20% 할인받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "glass_cannon", "name": "유리대포", "tier": "gold", "effect": "glass_cannon", "power": 1, "description": "얻는 돈은 2.5배, 잃는 돈은 2배입니다. 플레이어 간 거래의 추가 수입은 은행에서 지급하고, 추가 지출은 소멸하며 상대가 주고받는 금액은 늘어나지 않습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "negotiator_gold", "name": "인수의 고수", "tier": "gold", "effect": "negotiator", "power": 20, "description": "인수 비용을 20% 할인받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "gas", "name": "방귀쟁이", "tier": "silver", "effect": "gas", "power": 1, "description": "자신이 한 차례 동안 도착한 칸에 방귀를 남깁니다. 2라운드 안에 도착한 상대는 다음 주사위 합계가 10 이하로 제한되고 주사위 능력을 쓸 수 없습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "conversion_prism", "name": "전환 : 프리즘", "tier": "gold", "effect": "conversion", "power": 1, "description": "이 카드를 소비하고 프리즘 증강 1개를 무작위로 얻습니다.", "hooks": ["acquire"], "targetTier": "prism"},
  {"id": "conversion_silver_two", "name": "전환 : 실버", "tier": "gold", "effect": "conversion", "power": 2, "description": "이 카드를 소비하고 실버 증강 2개를 무작위로 얻습니다.", "hooks": ["acquire"], "targetTier": "silver"},
  {"id": "builder_gold", "name": "건설고수 2", "tier": "gold", "effect": "builder", "power": 20, "description": "건물 건설 비용을 20% 할인받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "robber", "name": "강도", "tier": "gold", "effect": "robber", "power": 125, "description": "상대를 통과할 때 25% 확률로 125만원을 갈취합니다.", "hooks": ["before_move", "arrive"]},
  {"id": "cashback", "name": "페이백", "tier": "silver", "effect": "cashback", "power": 50, "description": "다른 플레이어의 증강으로 돈을 갈취당하면 잃은 돈의 50%를 돌려받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "subsidy", "name": "근로장려금", "tier": "gold", "effect": "subsidy", "power": 1, "description": "자신의 차례에 이동하는 대신 현재 위치에서 월급을 받는 것을 선택할 수 있습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "drop_kick", "name": "드롭킥", "tier": "prism", "effect": "drop_kick", "power": 3, "description": "자신을 통과하는 상대의 남은 이동 칸 수를 3칸 줄입니다. 부족하면 자신의 위치에서 멈춥니다. 상대의 다음 주사위는 합계 10 이하로 제한되며 주사위 능력을 무시합니다.", "hooks": ["before_move", "arrive"]},
  {"id": "black_dice", "name": "블랙다이스", "tier": "prism", "effect": "reroll", "power": 3, "description": "매 주사위마다 다시 던진 뒤 기존 결과와 새 결과 중 하나를 선택할 수 있습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "trap", "name": "덫", "tier": "prism", "effect": "trap", "power": 1, "description": "자신이 한 차례 동안 밟은 칸에 덫을 남깁니다. 2라운드 안에 도착한 상대는 현재 더블 추가 투척이 취소되고 다음 자기 차례가 마비됩니다.", "hooks": ["before_move", "arrive"]},
  {"id": "exploit", "name": "착취", "tier": "prism", "effect": "exploit", "power": 15, "description": "매 차례 시작 시 같은 라인의 생존 상대 수로 15%를 나눈 비율만큼 각 상대의 보유 현금을 흡수합니다. 1명은 15%, 2명은 각각 7.5%, 3명은 각각 5%입니다. 모서리는 인접한 두 라인에 포함하며, 같은 상대는 한 번만 계산합니다.", "hooks": ["before_move", "arrive"]},
  {"id": "gambler_prism", "name": "도박사2", "tier": "prism", "effect": "gambler", "power": 4, "description": "내 지역마다 각각 50% 확률로 통행료가 0배 또는 4배가 됩니다. 앞으로 얻는 지역에도 적용됩니다.", "hooks": ["acquire"]},
  {"id": "alcohol", "name": "술팔기", "tier": "prism", "effect": "vendor", "power": 63, "description": "자신을 통과하는 상대에게 술을 팔아 63만원을 받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "grant_prism", "name": "지급3", "tier": "prism", "effect": "grant", "power": 1000, "description": "획득 즉시 1000만원을 받습니다.", "hooks": ["acquire"]},
  {"id": "revival_prism", "name": "트린다미어3", "tier": "prism", "effect": "revival", "power": 250, "description": "파산 시 한 번 부활하고 현금 250만원을 받습니다.", "hooks": ["acquire"]},
  {"id": "stealth", "name": "스텔스모드", "tier": "prism", "effect": "stealth", "power": 1, "description": "자신의 차례를 기다리는 동안 다른 플레이어의 증강 효과를 받지 않습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "trip", "name": "와사바리", "tier": "prism", "effect": "trip", "power": 1, "description": "자신을 통과하는 상대를 자신의 위치에 강제로 멈추게 합니다.", "hooks": ["before_move", "arrive"]},
  {"id": "tax_prism", "name": "조세회피", "tier": "prism", "effect": "tax", "power": 100, "description": "세금을 내지 않습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "island_owner", "name": "김씨표류기", "tier": "gold", "effect": "island_owner", "power": 1, "description": "무인도를 매수할 수 있고 무인도에 갇히지 않습니다. 갇힌 상대가 나오지 못하고 차례를 쉬는 동안 돈을 강탈합니다.", "hooks": ["before_move", "arrive"]},
  {"id": "realtor_prism", "name": "부동산의 왕", "tier": "prism", "effect": "realtor", "power": 50, "description": "지역 구매 비용을 50% 할인받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "negotiator_prism", "name": "인수 왕", "tier": "prism", "effect": "negotiator", "power": 50, "description": "인수 비용을 50% 할인받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "singed", "name": "신지드", "tier": "prism", "effect": "singed", "power": 1, "description": "이동 중 경로의 상대를 뒤로 2칸 던져 도착 효과를 발생시킵니다. 던져진 상대는 매입·인수를 할 수 없습니다. 자신이 도착한 칸에는 3라운드 동안 독을 남겨, 밟은 상대의 다음 차례 주사위를 10 이하로 제한하고 주사위 능력을 무시합니다.", "hooks": ["before_move", "arrive"]},
  {"id": "conversion_gold_two", "name": "전환 : 골드 2", "tier": "prism", "effect": "conversion", "power": 2, "description": "이 카드를 소비하고 골드 증강 2개를 무작위로 얻습니다.", "hooks": ["acquire"], "targetTier": "gold"},
  {"id": "landmark", "name": "랜드마크 건설", "tier": "prism", "effect": "landmark", "power": 1, "description": "건물 3종이 완공된 자기 지역에 다시 도착하면 랜드마크를 건설할 수 있습니다. 추가 건설비는 토지와 건물 3종 정가 합계의 2배이며, 랜드마크는 인수할 수 없습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "builder_prism", "name": "건설왕", "tier": "prism", "effect": "builder", "power": 50, "description": "건물 건설 비용을 50% 할인받습니다.", "hooks": ["before_move", "arrive"]},
  {"id": "great_luck", "name": "운수대통", "tier": "prism", "effect": "luck", "power": 100, "description": "이벤트 칸에서 부정적 이벤트가 발생하지 않습니다.", "hooks": ["before_move", "arrive"]},
];
export interface AugmentOffer {
  bonus?: boolean;
  id: string;
  round: number;
  tier: AugmentTier;
  cards: string[];
  rerolled: boolean[];
  seen: string[];
}
export interface AugmentPlayer { acquired: number; laps: number; owned: string[]; offer: AugmentOffer | null }
export interface AugmentState { tierSequence: AugmentTier[]; players: AugmentPlayer[] }
const RETIRED_AUGMENTS=new Set(["force_silver","force_gold","force_prism"]);
/** Old checkpoints must not keep removed cards in either owned skills or pending offers. */
export function removeRetiredAugments(state:AugmentState,random:()=>number=Math.random,catalog:readonly AugmentDefinition[]=AUGMENT_CATALOG){
 const affected:number[]=[];
 state.players.forEach((p,seat)=>{
  if(p.owned.some(id=>RETIRED_AUGMENTS.has(id)))affected.push(seat);
  p.owned=p.owned.filter(id=>!RETIRED_AUGMENTS.has(id));
  const offer=p.offer;if(!offer)return;
  for(let slot=offer.cards.length-1;slot>=0;slot--){
   if(!RETIRED_AUGMENTS.has(offer.cards[slot]))continue;
   const available=catalog.filter(a=>a.tier===offer.tier&&!RETIRED_AUGMENTS.has(a.id)&&!p.owned.includes(a.id)&&!offer.cards.includes(a.id));
   const unseen=available.filter(a=>!offer.seen.includes(a.id)),pool=unseen.length?unseen:available;
   if(!pool.length){offer.cards.splice(slot,1);offer.rerolled.splice(slot,1);continue;}
   const replacement=sample(pool,random);offer.cards[slot]=replacement.id;offer.seen.push(replacement.id);
  }
  offer.seen=offer.seen.filter(id=>!RETIRED_AUGMENTS.has(id));
 });
 return affected;
}
export function augmentDefinition(id: string, catalog: readonly AugmentDefinition[] = AUGMENT_CATALOG) {
  const definition = catalog.find(a => a.id === id);
  if (!definition) throw new Error("등록되지 않은 증강입니다.");
  return definition;
}
function sample<T>(pool: readonly T[], random: () => number): T {
  if (!pool.length) throw new Error("증강 후보가 부족합니다.");
  return pool[Math.floor(random() * pool.length)];
}
export function createAugmentState(count: number, random: () => number = Math.random, catalog: readonly AugmentDefinition[] = AUGMENT_CATALOG, sequence?: readonly AugmentTier[]): AugmentState {
  if (!Number.isInteger(count) || count < 2 || count > 4) throw new Error("2~4명이 필요합니다.");
  const tiers = sequence ? [...sequence] : AUGMENT_MILESTONES.map(() => {
    const n = random() * 100;
    return n < TIER_WEIGHTS.silver ? "silver" : n < TIER_WEIGHTS.silver + TIER_WEIGHTS.gold ? "gold" : "prism";
  });
  if (tiers.length !== AUGMENT_MILESTONES.length || tiers.some(t => !AUGMENT_TIERS.includes(t))) throw new Error("증강 등급 순서가 올바르지 않습니다.");
  const ids = new Set<string>();
  for (const a of catalog) {
    if (!a.id || ids.has(a.id) || !AUGMENT_TIERS.includes(a.tier) || !a.name || !a.description || a.hooks.some(h => !AUGMENT_HOOKS.includes(h))) throw new Error("증강 등록 정보가 올바르지 않습니다.");
    ids.add(a.id);
  }
  for (const tier of AUGMENT_TIERS) {
    const rounds = tiers.filter(t => t === tier).length;
    // Three initial cards + three unique rerolls + previously owned cards of this tier.
    if (rounds && catalog.filter(a => a.tier === tier).length < 6 + rounds - 1) throw new Error(`${TIER_LABELS[tier]} 증강 후보가 부족합니다.`);
  }
  return { tierSequence: tiers, players: Array.from({ length: count }, () => ({ acquired: 0, laps: 0, owned: [], offer: null })) };
}
export function openAugmentOffer(state: AugmentState, seat: number, random: () => number = Math.random, catalog: readonly AugmentDefinition[] = AUGMENT_CATALOG) {
  const p = state.players[seat];
  if (!p || p.offer || p.acquired >= AUGMENT_MILESTONES.length || p.laps < AUGMENT_MILESTONES[p.acquired]) return false;
  const round = p.acquired, tier = state.tierSequence[round], pool = catalog.filter(a => a.tier === tier && !p.owned.includes(a.id)).map(a => a.id);
  const cards: string[] = [];
  for (let i = 0; i < Math.min(3, pool.length); i++) cards.push(sample(pool.filter(id => !cards.includes(id)), random));
  if (!cards.length) { p.acquired++; return false; }
  p.offer = { id: `${seat}:${round}`, round, tier, cards, rerolled: cards.map(() => pool.length <= cards.length), seen: [...cards] };
  return true;
}
function requireOffer(state: AugmentState, seat: number, offerId: string, slot: number) {
  const offer = state.players[seat]?.offer;
  if (!offer || offer.id !== offerId || !Number.isInteger(slot) || slot < 0 || slot >= offer.cards.length) throw new Error("유효하지 않은 증강 선택입니다.");
  return offer;
}
export function rerollAugment(state: AugmentState, seat: number, offerId: string, slot: number, random: () => number = Math.random, catalog: readonly AugmentDefinition[] = AUGMENT_CATALOG) {
  const offer = requireOffer(state, seat, offerId, slot), player = state.players[seat];
  if (offer.rerolled[slot]) throw new Error("이 카드의 리롤은 이미 사용했습니다.");
  const pool = catalog.filter(a => a.tier === offer.tier && !player.owned.includes(a.id) && !offer.seen.includes(a.id));
  const replacement = sample(pool, random);
  offer.cards[slot] = replacement.id; offer.rerolled[slot] = true; offer.seen.push(replacement.id);
  if (!catalog.some(a => a.tier === offer.tier && !player.owned.includes(a.id) && !offer.seen.includes(a.id))) offer.rerolled.fill(true);
}
export function selectAugment(state: AugmentState, seat: number, offerId: string, slot: number) {
  const offer = requireOffer(state, seat, offerId, slot), player = state.players[seat], chosen = offer.cards[slot];
  if (player.owned.includes(chosen) || !offer.bonus && player.acquired >= AUGMENT_MILESTONES.length) throw new Error("이미 보유했거나 획득할 수 없는 증강입니다.");
  player.owned.push(chosen); if(!offer.bonus)player.acquired++; player.offer = null;
  return chosen;
}
/** Only acquired augments are public; future tiers and other players' offers stay private. */
export function publicAugmentState(state: AugmentState, seat: number): AugmentState {
  return { tierSequence: [], players: state.players.map((p, i) => ({ acquired: p.acquired, laps: p.laps, owned: [...p.owned], offer: i === seat && p.offer ? { ...p.offer, cards: [...p.offer.cards], rerolled: [...p.offer.rerolled], seen: [] } : null })) };
}

/** Separate from personal lap milestones; every survivor receives an offer at once. */
export function openRoundPrismOffer(state:AugmentState,seat:number,random:()=>number,catalog:readonly AugmentDefinition[]=AUGMENT_CATALOG){
 const p=state.players[seat];if(p.offer)return false;
 const pool=catalog.filter(a=>a.tier==='prism'&&!p.owned.includes(a.id)).map(a=>a.id),cards:string[]=[];
 for(let i=0;i<Math.min(3,pool.length);i++)cards.push(sample(pool.filter(id=>!cards.includes(id)),random));
 if(!cards.length)return false;
 p.offer={id:`round30:${seat}`,round:30,tier:'prism',bonus:true,cards,rerolled:cards.map(()=>pool.length<=cards.length),seen:[...cards]};return true;
}
