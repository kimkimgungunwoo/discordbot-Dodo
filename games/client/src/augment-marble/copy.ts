import { incomeWithoutGlass } from "../../../shared/augment-marble-effects";
import { type AugmentDefinition, type EffectKind, TIER_LABELS } from "../../../shared/augment-marble-augments";
import { BOARD, SALARY, BONUS, rent, rentPayment, type Game } from "../../../shared/augment-marble";

const timing: Partial<Record<EffectKind, string>> = {
  copernicus:"통행료 정산 시",bread:"최종 도착 시",pacemaker:"상대의 자기 차례 종료 시",guillotine:"획득 시 · 4라운드마다 지정",collector:"획득 시 · 모든 현금 정산 후",devour:"최종 도착 시",goblin:"매 주사위 이동 후",redistribution:"획득 즉시 · 1회",mind_control:"주사위 결과 확인 후",dirge:"출발점 도착·통과 시",leech:"매 자기 차례 시작 시",sniper:"매 자기 차례 시작 시",silent:"획득 후 경기 끝까지",shaco:"획득 시 분신 생성 · 이동·생존 선택",adamant:"보유 중 항상",landmark_takeover:"랜드마크 도착 후 인수 시",unfair_trade:"매 투척 결과 확인 후 · 선택 사용",direction:"굴린 뒤 · 이동 방향 선택", force:"굴리기 전 선택", reroll:"굴린 뒤 · 이동 전", selective_double:"매 차례 첫 투척 전", double_lover:"투척 시 자동", mimic:"굴리기 대신 선택", subsidy:"이동 대신 월급 선택",
  builder:"건설 시", free_build:"일반 건물 건설 시", first_spade:"빈 지역 매입 시", tax_account:"세금 납부 · 건설 결제 시", construction_team:"최초 획득 · 출발선 통과 · 자기 차례", realtor:"매입 시", negotiator:"인수 시", salary:"월급 수령 시", tax:"세금 정산 시", investor:"수입 발생 시", glass_cannon:"수입·지출 발생 시",
  steal:"첫 차례 이후 · 같은 칸", vladimir:"차례 시작 · 대상 선택", exploit:"차례 시작 · 같은 라인 · 15% ÷ 상대 수", jujitsu:"차례 시작 · 같은 칸",
  low_kick:"상대가 나를 통과할 때", calf_kick:"상대가 나를 통과할 때", drop_kick:"상대가 나를 통과할 때", trip:"상대가 나를 통과할 때", vendor:"상대가 나를 통과할 때", pickpocket:"상대를 통과할 때", robber:"상대를 통과할 때", singed:"이동 중 상대 통과 · 도착 시 독 설치",
  gas:"도착 시 설치 · 2라운드", trap:"도착 시 설치 · 2라운드", revival:"파산 위기 · 1회", gambler:"지역별 통행료 추첨", conversion:"획득 즉시 · 카드 소비", grant:"획득 즉시", luck:"이벤트 도착 시", no_island:"3연속 더블 시", stealth:"자기 차례 대기 중", landmark:"건물 3개 완공 후 재방문",
};
export function abilityTiming(a: AugmentDefinition) { return a.effect ? timing[a.effect] ?? "보유 중 적용" : "보유 중 적용"; }
export function abilityNotes(a: AugmentDefinition): string[] {
  if(a.tier==="black")return [];
  const e=a.effect;
  if(e==="reroll") return [a.id==="suspicious_dice"?"도착 예정지를 확인한 뒤 사용 여부를 선택합니다. 추가 주사위는 1~3이며, 원래 두 주사위의 더블 판정은 유지됩니다.":"투척마다 한 번 사용할 수 있습니다.","합계 제한 상태에서는 주사위 능력을 사용할 수 없습니다. 다시 굴리거나 비교해도 제한 시간은 늘어나지 않습니다."];
  if(e==="selective_double") return ["매 차례 첫 투척에서만 선택할 수 있습니다. 더블 추가 투척에는 선택할 수 없습니다.","더블 확정에 따른 현금 보상은 없습니다."];
  if(e==="mimic") return ["자신의 직전 차례가 끝난 뒤 다른 플레이어가 확정한 투척만 복사합니다.","복사 이동은 더블 추가 투척이나 현금 보상을 주지 않습니다."];
  if(e==="gas" || e==="trap" || e==="singed") return ["지나가는 것만으로 설치물이 발동하지 않습니다. 최종 도착 시 적용됩니다.","지속 시간은 전체 라운드 기준이며, 설치자의 다음 차례에 일괄 삭제되지 않습니다."];
  if(e==="conversion") return ["카드에 적힌 대상 등급의 증강을 받습니다. 전환 카드 자체는 소비됩니다.","이미 보유한 카드는 받지 않습니다. 새 카드의 획득 효과도 적용하며 정규 선택 회차는 소비하지 않습니다."];
  if(e==="gambler") return ["각 지역의 결과를 독립적으로 추첨해 유지합니다. 매 방문마다 다시 추첨하지 않습니다.","앞으로 매입·인수하는 지역에도 적용됩니다."];
  if(e==="first_spade")return ["빈 땅을 매입할 때 별장 1개가 즉시 무료로 지어집니다. 인수에는 발동하지 않습니다."];
  if(e==="tax_account")return ["건설 적립금은 최대 200만원이며 현금과 별도로 보관합니다. 매입·인수에는 쓸 수 없습니다.","일반 건물·랜드마크 건설 시 비용 효과 적용 후 적립금을 먼저 사용합니다. 증강 무효화 중에는 적립·사용할 수 없습니다."];
  if(e==="construction_team")return ["시공권은 최초 획득 시 2장, 정방향 출발선 통과 시 1장 충전되며 최대 3장입니다.","자기 차례에 1장만 사용할 수 있습니다. 방문·매입 직후 건설 제한과 관계없이 자기 지역의 일반 건물 1개를 무료 건설합니다.","랜드마크·상대 지역에는 쓸 수 없고, 수면·기절·무인도 구금 중에는 사용할 수 없습니다."];
  if(e==="free_build") return ["별장·빌딩·호텔의 건설 비용이 0원입니다. 한 번에 여러 건물을 선택해 건설할 수 있습니다.","자기 지역과 기존 건설 가능 시점 조건은 그대로 적용됩니다. 랜드마크는 기존 비용을 지불합니다."];
  if(e==="cashback") return ["다른 플레이어의 증강으로 실제 갈취당한 금액이 환급 기준입니다.","토지 매입·건설·인수 지출을 환급하는 능력이 아닙니다."];
  if(e==="revival") return ["파산 위기에서 한 번 사용합니다. 부활 시 현금은 카드에 적힌 금액으로 설정됩니다."];
  if(e==="stealth") return ["자신의 차례에는 보호되지 않습니다. 기본 통행료·세금 등 일반 규칙은 면제하지 않습니다."];
  return [a.description];
}
export function abilityLabel(a: AugmentDefinition) { return a.name; }
export function statusLabels(g: Game, seat: number) {
  const p = g.players[seat], s = g.abilities.statuses[seat], labels: string[] = [];
  if (p.rest) labels.push(`무인도 ${p.rest}차례`);
  if (s.skipTurns) labels.push(`${s.skipBy ?? "덫"} · ${s.skipTurns}차례 휴식`);
  if (s.restrictedRolls) labels.push(`${s.restrictedBy ?? "독"} · ${s.restrictedRolls}회 투척 제한`);
  if (s.nextTurnRestricted) labels.push("신지드 · 다음 차례 주사위 제한");
  if (s.restrictWholeTurn) labels.push("신지드 · 이번 차례 주사위 제한");
  const e=g.world?.players[seat];
  if(e){if(e.passCoupons)labels.push(`하이패스 쿠폰 ${e.passCoupons}`);if(e.autoPass)labels.push(`자동 면제 ${e.autoPass}`);if(e.homeStones)labels.push(`귀환석 ${e.homeStones}`);if(e.extraCoupons)labels.push(`한번더 쿠폰 ${e.extraCoupons}`);if(e.sleep)labels.push(`수면 ${e.sleep}회`);if(e.disabledUntil>g.round)labels.push(`무능력 ${e.disabledUntil-g.round}라운드`);if(e.vulnerable)labels.push(`다음 손실 2배 ${e.vulnerable}회`);if(e.unpaidSalary)labels.push(`임금체불 ${e.unpaidSalary}회`);if(e.halfSalary)labels.push(`월급 반감 ${e.halfSalary}회`);if(e.lostThisTurn||e.lostDice)labels.push("주사위 분실");if(e.reverseThisTurn||e.reverseMoves)labels.push("역주행");if(e.overspendUntil>=g.abilities.ownerTurns[seat]&&e.overspendUntil>0)labels.push("과소비 · 통행료 1.5배");}
  if (s.revival) labels.push(s.revival.consumed ? "부활 사용 완료" : `부활 대기 · ${TIER_LABELS[(["silver", "gold", "prism"] as const)[s.revival.tier]]}`);
  return labels;
}
export function displayedRent(g: Game, index: number, visitor?: number) {
  const owner = g.properties[index].owner;
  if (owner === null) return 0;
  return visitor !== undefined && visitor !== owner ? rentPayment(g, index, visitor) : incomeWithoutGlass(g, owner, rent(g, index));
}
export function tileDescription(index: number) {
  const t = BOARD[index];
  return t.kind === "start" ? `출발을 지나거나 정확히 도착하면 기본 월급 ${SALARY}만원과 보유 증강을 반영한 월급을 받고 세금을 냅니다. 새로 얻은 증강은 이번 월급과 세금에 소급 적용되지 않습니다.` :
    t.kind === "rest" ? "도착하면 더블 추가 투척이 취소되고 최대 3턴 갇힙니다. 매 차례 더블이면 무료 탈출하며, 50만원을 내고 즉시 탈출할 수도 있습니다." :
    t.kind === "portal" ? "원하는 지역으로 순간이동합니다. 출발 통과 효과 없이 도착 지역의 통행료·매입·건설 등을 처리합니다." : t.kind === "event" ? "이벤트 결과에 따라 돈을 얻거나 잃습니다. 행운!과 운수대통은 부정적 이벤트 확률을 낮춥니다." :
    t.kind === "bonus" ? `도착하면 기본 ${BONUS}만원을 받습니다. 보유한 수입 증가 효과가 있으면 최종 수령액이 늘어납니다.` : "지역을 매입하고 건물을 지어 통행료를 받을 수 있습니다.";
}
