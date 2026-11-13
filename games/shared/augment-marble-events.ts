/** Event identities are independent of augments. Draws use replacement. */
export const EVENT_MS = 30_000;
export type EventCategory = "positive" | "neutral" | "negative";
export const EVENT_CATEGORY_LABELS = {positive:"긍정",neutral:"중립",negative:"부정"};
export const EVENT_CATALOG = [
 ["salary_again","월급 한번더!","positive","현재 월급을 한 번 더 받습니다."],
 ["festival","축제!","positive","내 지역 하나를 선택합니다. 다른 플레이어의 다음 첫 방문까지 통행료가 2배가 됩니다."],
 ["telekinesis","염력","positive","다른 플레이어 한 명을 선택해 뒤로 1~3칸 밀어냅니다. 신지드와 같은 강제 도착 효과를 적용하며, 직접 매입·건설·인수는 할 수 없습니다."],
 ["line_quake","흔들흔들 열매","positive","선택한 라인의 각 지역에서 최상위 건물 하나를 파괴합니다. 랜드마크도 대상입니다."],
 ["pass_coupon","하이패스 쿠폰","positive","통행료 청구 시 선택해서 사용할 수 있는 면제 쿠폰 1개를 받습니다."],
 ["long_robbery","초장거리 강도","positive","다른 플레이어 한 명을 선택해 보유 현금의 10%를 강탈합니다."],
 ["home_stone","귀환석","positive","자기 차례 투척 전에 출발로 순간이동할 수 있는 귀환석 1개를 받습니다. 사용하면 월급만 받고 차례를 마칩니다."],
 ["wall","벽생성","positive","원하는 두 칸 사이에 벽을 설치합니다. 처음 부딪힌 플레이어는 벽 직전 칸에 멈추고 도착 효과를 받습니다."],
 ["hero","영웅출현!","positive","선택한 플레이어의 위치로 순간이동합니다. 도착지 효과가 발동하며 이동을 포기할 수 있습니다."],
 ["tranquilizer","마취총","positive","다른 플레이어 한 명을 즉시 마취합니다. 남은 더블 투척이 있으면 취소하고, 대기 중인 대상은 다음 자기 차례를 한 번 쉽니다."],
 ["extra_coupon","한번더 쿠폰","positive","자기 이동 처리를 마친 뒤 추가 투척할 수 있는 쿠폰 1개를 받습니다. 주사위 능력을 사용할 수 있습니다."],
 ["typhoon","태풍","neutral","모든 플레이어가 뒤로 2칸 이동하고 도착지 효과를 받습니다. 신지드와 같은 강제 도착 효과를 적용하며, 직접 매입·건설·인수는 할 수 없습니다."],
 ["locust","메뚜기떼","neutral","무작위 칸에서 시작해 5칸을 이동합니다. 지나간 지역의 통행료가 경기 종료까지 30% 감소합니다."],
 ["change_augment","증강변경","neutral","내 증강 하나를 같은 등급의 미보유 증강으로 무작위 교체합니다. 교체를 거부할 수 있습니다."],
 ["quake","지진","neutral","건물이 있는 지역 중 무작위 최대 3곳에서 최상위 건물 하나를 파괴합니다. 랜드마크도 대상입니다."],
 ["wormhole","웜홀","neutral","다른 이벤트 칸으로 순간이동합니다. 새 이벤트는 발동하지 않습니다."],
 ["homing","귀소본능","neutral","출발로 순간이동해 월급과 세금를 정산합니다."],
 ["random_wall","무작위 벽 생성","neutral","무작위 두 칸 사이에 벽을 설치합니다. 처음 부딪힌 플레이어는 벽 직전 칸에 멈춥니다."],
 ["auto_pass","하이패스","neutral","다음 통행료 1회를 자동으로 면제받습니다."],
 ["fool","바보출현","neutral","무작위 다른 플레이어의 위치로 순간이동하고 도착지 효과를 받습니다."],
 ["reverse_order","역순서","neutral","플레이어의 차례 진행 방향을 반대로 바꿉니다."],
 ["bet","도박","neutral","현재 현금 안에서 베팅합니다. 50% 확률로 베팅액의 2배를 돌려받고, 실패하면 베팅액을 잃습니다."],
 ["depression","경제대공황","negative","모든 플레이어의 다음 월급이 50% 감소합니다."],
 ["sleep","기면증","negative","현재 더블 추가 투척을 취소하고 다음 자기 차례를 한 번 쉽니다."],
 ["vacation","휴가","negative","무인도로 순간이동해 무인도 효과를 받습니다."],
 ["unpaid","임금체불","negative","다음 월급을 받지 못합니다."],
 ["lost_die","주사위 분실","negative","다음 자기 차례는 주사위 하나만 사용하며 주사위 능력을 사용할 수 없습니다."],
 ["famine","흉년","negative","3라운드 동안 모든 지역의 통행료가 절반이 됩니다. 반복되면 기간을 갱신합니다."],
 ["overspend","과소비","negative","다음 자기 차례 3회 동안 내가 내는 통행료가 1.5배가 됩니다. 상대도 그 금액을 받습니다."],
 ["reverse_move","역주행","negative","다음 자기 차례에는 주사위 합계만큼 뒤로 이동합니다. 출발선 효과는 발동하지 않습니다."],
 ["disable","무능력자","negative","3라운드 동안 내 증강의 사용과 발동이 정지됩니다."],
 ["vulnerable","면역력 감소","negative","다음 금전 손실이 2배가 됩니다."],
 ["missile","미사일","negative","내 지역 중 무작위 최대 3곳의 최상위 건물을 하나 파괴합니다. 건물이 없다면 소유권을 잃습니다."],
] as const;
export type EventId = typeof EVENT_CATALOG[number][0];
export function eventDefinition(id: EventId) { const row=EVENT_CATALOG.find(e=>e[0]===id);if(!row)throw new Error("등록되지 않은 이벤트입니다.");return {id:row[0],name:row[1],category:row[2],description:row[3]}; }
export interface EventPlayer {
 passCoupons:number; homeStones:number; extraCoupons:number; autoPass:number;
 halfSalary:number; unpaidSalary:number; sleep:number; sleepThisTurn?:boolean; lostDice:number; reverseMoves:number;
 vulnerable:number; disabledUntil:number; overspendUntil:number;
 lostThisTurn:boolean; reverseThisTurn:boolean; endLocked?:boolean; pendingAcquisitions?:string[];
}
export interface EventVisit {settled?:boolean;startEffects?:boolean;forced?:boolean;arrived?:boolean;flight?:boolean;seat:number;tile:number;effects:boolean;noPurchase?:boolean;rentAmount?:number;creditor?:number}
export interface EventState {
 version:1; players:EventPlayer[]; direction:1|-1; famineUntil:number; walls:number[];
 current:{id:EventId;seat:number;serial:number}|null; nextSerial:number;
 rent:{amount:number;creditor:number;tile:number}|null;
 visits:EventVisit[]; deferred?:EventVisit[]; noPurchase?:boolean;
 interrupted:{turn:number;extraTurn:boolean;doubles:number;ordinal:number;phase:"end";sleepAtStart:number}|null;
 history:{id:EventId;seat:number;serial:number}[];
}
export function createEventState(count:number):EventState {
 return {version:1,players:Array.from({length:count},()=>({passCoupons:0,homeStones:0,extraCoupons:0,autoPass:0,halfSalary:0,unpaidSalary:0,sleep:0,lostDice:0,reverseMoves:0,vulnerable:0,disabledUntil:0,overspendUntil:0,lostThisTurn:false,reverseThisTurn:false})),direction:1,famineUntil:0,walls:[],current:null,nextSerial:1,rent:null,visits:[],interrupted:null,history:[]};
}
export function drawEvent(random:()=>number,negativeReduction=0):EventId {
 // Removed negative probability is redistributed equally to positive and neutral.
 const negative=(1-Math.min(100,Math.max(0,negativeReduction))/100)/3;
 const positive=(1-negative)/2,n=random();const category:EventCategory=n<positive?"positive":n<1-negative?"neutral":"negative";
 const pool=EVENT_CATALOG.filter(e=>e[2]===category);return pool[Math.min(pool.length-1,Math.floor(random()*pool.length))][0];
}
