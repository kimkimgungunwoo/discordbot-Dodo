/** Public board + own choices only. No future tier schedule, hidden offers or live RNG access. */
import { AUGMENT_CATALOG, type AugmentDefinition } from './augment-marble-augments.js';
import { capabilities, incomeAmount, lossAmount, power, salaryAmount } from './augment-marble-effects.js';
import { createRoll, diceCandidates, type DicePair, type RollContext } from './augment-marble-runtime.js';
import { applyAction, availableDice, turnTargets, purchaseCost, takeoverCost, landmarkCost, landmarkAvailable, groupCount, SALARY, ISLAND_COST, BONUS, BOARD, construction, eventOwnedTiles, eventTargets, netWorth, rent, rentPayment, type Action, type Game } from './augment-marble.js';

export function augmentValue(g:Game,seat:number,a:AugmentDefinition):number {
 const own=BOARD.filter(t=>g.properties[t.index].owner===seat),cash=g.players[seat].cash,late=g.round/120;
 const economic=own.length,has=(kind:string)=>AUGMENT_CATALOG.some(b=>g.augments?.players[seat].owned.includes(b.id)&&b.effect===kind);
 const n=a.power??1;
 switch(a.effect){
  case 'revival':return 105+n*.2-(g.abilities.statuses[seat].revival&&!g.abilities.statuses[seat].revival?.consumed?45:0);
  case 'force':return 90+n*14;
  case 'reroll':return 80+n*15;
  case 'realtor':return n*(2-late)+Math.max(0,8-economic)*2;
  case 'builder':return n*(1.2+Math.min(economic,6)*.18);
  case 'negotiator':return n*(1.5+late);
  case 'tax':return n*(.4+economic*.12);
  case 'salary':return has('investor')?2:95;
  case 'investor':return 20+economic*12+(has('vendor')||has('steal')||has('exploit')?35:0);
  case 'glass_cannon':return 30+economic*8+(cash>700?30:-20);
  case 'grant':return incomeAmount(g,seat,n)*(.32+(cash<150?.3:0));
  case 'landmark':return 20+own.filter(t=>g.properties[t.index].buildings===7).length*45+economic*4;
  case 'subsidy':return has('investor')?0:(cash<200?85:45);
  case 'mimic':return 85;
  case 'selective_double':return 85;
  case 'double_lover':return 70;
  case 'stealth':return 75;
  case 'cashback':return 45;
  case 'vendor':return 30+n*6;
  case 'vladimir':case 'exploit':return 85;
  case 'steal':return 50;
  case 'singed':return 100;
  case 'trip':case 'drop_kick':return 85;
  case 'calf_kick':case 'low_kick':return 65;
  case 'trap':case 'gas':return 60;
  case 'pickpocket':case 'robber':return 65;
  case 'jujitsu':return 60;
  case 'no_island':return 35;
  case 'luck':return 25+n*.3;
  case 'gambler':return 30+economic*(n===4?8:5);
  case 'conversion':return 80+n*25+(a.targetTier==='prism'?25:0);
  case 'island_owner':return cash>600?65:30;
  default:return 40;
 }
}
/** Keep a cash cushion based on visible nearby tolls, then spend surplus on tempo/territory. */
export function botCashPlan(g:Game,seat=g.turn){
 const cash=g.players[seat].cash,direction=g.world.players[seat].reverseThisTurn?-1:1;
 const tolls=Array.from({length:11},(_,i)=>{const tile=(g.players[seat].position+direction*(i+2)+360)%36;return g.properties[tile].owner===seat?0:rentPayment(g,tile,seat);}).sort((a,b)=>a-b);
 const danger=tolls[8]??0,rich=cash>=SALARY*3;
 const reserve=Math.min(cash*(rich?.22:.45),Math.max(SALARY*(rich?.35:.4),danger*(rich?.45:.65)));
 return {rich,reserve:Math.ceil(reserve),spend:Math.max(0,cash-Math.ceil(reserve))};
}
function territoryPriority(g:Game,seat:number,tile:number){
 const group=BOARD.filter(t=>t.kind==='city'&&t.group===BOARD[tile].group&&t.index!==tile),line=BOARD.filter(t=>t.kind==='city'&&t.line===BOARD[tile].line&&t.index!==tile);
 const completes=(who:number)=>group.every(t=>g.properties[t.index].owner===who),wins=(who:number)=>line.every(t=>g.properties[t.index].owner===who)||completes(who)&&groupCount(g,who)>=2;
 return {deny:g.players.some((p,i)=>i!==seat&&!p.bankrupt&&completes(i)),win:wins(seat),block:g.players.some((p,i)=>i!==seat&&!p.bankrupt&&wins(i)),complete:completes(seat),owned:group.filter(t=>g.properties[t.index].owner===seat).length};
}
function invest(g:Game):Action|null{
 const seat=g.turn,p=g.players[seat],tile=p.position,property=g.properties[tile],plan=botCashPlan(g,seat);
 if(g.phase==='roll'&&!g.abilities.pendingTarget&&!g.world.players[seat].sleepThisTurn&&!g.abilities.statuses[seat].skipTurns&&p.position===9){
  const purchase=lossAmount(g,seat,ISLAND_COST);if(power(g,seat,'island_owner')&&g.abilities.islandOwner===null&&purchase<=plan.spend)return {action:'island_buy'};
  const escape=lossAmount(g,seat,50);if(p.rest&&escape<=plan.spend&&(p.cash>=SALARY*2||p.rest>=2&&p.cash>=SALARY))return {action:'escape'};
 }
 if(g.phase==='portal'){
  const options=BOARD.filter(t=>t.kind==='city').map(t=>{const prop=g.properties[t.index],priority=territoryPriority(g,seat,t.index),cost=prop.owner===null?purchaseCost(g,t.index):prop.owner===seat?0:takeoverCost(g,t.index)+rentPayment(g,t.index,seat);
   const opportunity=prop.owner===seat?(prop.buildings===7?Math.min(180,rent(g,t.index)*.3):65):cost<=p.cash?(prop.owner===null?(plan.rich?240:140):45+Math.min(300,rent(g,t.index)*.75))+priority.owned*65+(priority.complete?240:0)+(priority.win?100000:0)+(priority.block?10000:0)+(priority.deny?500:0)-cost*(plan.rich?.1:.35):-10000;
   return {tile:t.index,score:opportunity};}).sort((a,b)=>b.score-a.score);return {action:'portal_move',tile:options[0].tile};
 }
 if(g.phase==='buy'){const priority=territoryPriority(g,seat,tile),cost=purchaseCost(g,tile);return {action:cost<=p.cash&&(priority.win||priority.block||cost<=plan.spend)?'buy':'end'};}
 if(g.phase==='build'){
  if(property.landmark)return {action:'end'};
  if(landmarkAvailable(g,tile)&&landmarkCost(g,tile)<=plan.spend)return {action:'landmark'};
  const missing=[0,1,2].filter(i=>!(property.buildings&(1<<i)));let best:Action={action:'end'},bestScore=0;
  for(let mask=1;mask<1<<missing.length;mask++){const buildings=missing.filter((_,i)=>mask&(1<<i)),preview=structuredClone(g);try{applyAction(preview,{action:'build',buildings},()=>.5)}catch{continue}
   const cost=p.cash-preview.players[seat].cash;if(cost>plan.spend)continue;
   const score=(rent(preview,tile)-rent(g,tile))*2+(preview.properties[tile].buildings===7?70:0)-cost*.5;
   if(score>bestScore){bestScore=score;best={action:'build',buildings};}
  }return best;
 }
 if(g.phase==='takeover'){
  if(property.owner===null||property.owner===seat||property.landmark)return {action:'end'};
  const cost=takeoverCost(g,tile),priority=territoryPriority(g,seat,tile);if(cost>p.cash)return {action:'end'};
  const worthwhile=priority.win||priority.block||priority.complete||priority.deny||priority.owned>0||rent(g,tile)*2+BOARD[tile].price*.5>=cost||plan.rich&&rent(g,tile)>0&&cost<=p.cash*.15;
  return {action:priority.win||priority.block||cost<=plan.spend&&worthwhile?'takeover':'end'};
 }
 return null;
}
function propertyOpportunity(g:Game,seat:number,tile:number):number {
 const t=BOARD[tile],p=g.properties[tile];if(t.kind!=='city')return 0;
 if(p.owner===seat)return p.buildings===7?(power(g,seat,'landmark')&&!p.landmark?65:Math.min(90,rent(g,tile)*.3)):40;
 if(p.owner!==null){const priority=territoryPriority(g,seat,tile);if(g.players[seat].cash<takeoverCost(g,tile))return 0;return priority.win?100000:priority.block?10000:priority.complete?250:g.players[seat].cash>=SALARY*3?60:0;}
 const group=BOARD.filter(b=>b.group===t.group),ours=group.filter(b=>g.properties[b.index].owner===seat).length;
 const blocks=g.players.some((p,i)=>i!==seat&&!p.bankrupt&&group.filter(b=>g.properties[b.index].owner===i).length===3);
 const priority=territoryPriority(g,seat,tile);
 return g.players[seat].cash>=purchaseCost(g,tile,seat)?priority.win?100000:priority.block?10000:35+ours*20+(ours===3?100:0)+(blocks?80:0):5;
}
function movementEvaluator(g:Game){
 const seat=g.turn,cache=new Map<string,number>();
 return (pair:readonly number[],copied=false):number=>{
  const key=pair.join(',')+':'+copied;if(cache.has(key))return cache.get(key)!;
  const preview=structuredClone(g),cash=g.players[seat].cash,wealth=netWorth(g,seat);
  // Skip future augment offers; keep current public owned abilities intact.
  if(preview.augments)preview.augments.players.forEach(p=>{p.acquired=4;p.offer=null;});
  preview.augmentSeat=null;preview.augmentResume=null;preview.phase='dice';preview.dice=[...pair];preview.abilities.copied=copied;
  preview.abilities.roll=createRoll(seat,g.abilities.ordinal,!!g.abilities.roll?.restricted);preview.abilities.roll.result=pair as DicePair;
  try{
   applyAction(preview,{action:'dice_confirm'},()=>.6);
   const p=preview.players[seat],s=preview.abilities.statuses[seat];
   let score=(p.cash-cash)+(netWorth(preview,seat)-wealth-(p.cash-cash))*.6;
   if(p.bankrupt)score-=2000;
   if(preview.debt)score-=preview.debt.amount*1.4;
   const phase=preview.phase as Game['phase'];
   if(phase==='rent'&&preview.world.rent)score-=preview.world.rent.amount*.7;
   score+=propertyOpportunity(preview,seat,p.position)*(cash>=SALARY*3?1.6:1);
   if(p.rest)score-=45;if(s.skipTurns>g.abilities.statuses[seat].skipTurns)score-=45;
   if(s.restrictedRolls>g.abilities.statuses[seat].restrictedRolls)score-=15;
   if(preview.extraTurn)score+=g.doubles>=2?-50:cash>=SALARY*3?40:22;
   if(phase==='portal')score+=cash>=SALARY*3?90:60;
   if(phase==='event')score+=6; // No knowledge of the hypothetical draw is used.
   cache.set(key,score);return score;
  }catch{cache.set(key,-2000);return -2000;}
 };
}
function expected(roll:RollContext,lover:boolean,score:(p:DicePair)=>number):number {
 const pairs=diceCandidates(roll);if(!pairs.length)return -Infinity;
 const doubles=pairs.filter(p=>p[0]===p[1]),singles=pairs.filter(p=>p[0]!==p[1]);
 if(lover&&!roll.restricted&&!roll.forcedDouble&&doubles.length&&singles.length){const chance=Math.min(1,2*doubles.length/pairs.length);return chance*doubles.reduce((n,p)=>n+score(p),0)/doubles.length+(1-chance)*singles.reduce((n,p)=>n+score(p),0)/singles.length;}
 return pairs.reduce((n,p)=>n+score(p),0)/pairs.length;
}
function eventDestinationValue(g:Game,seat:number,tile:number):number {
 if(tile===0)return 0;const t=BOARD[tile],p=g.properties[tile];
 if(t.kind==='rest')return -65;if(t.kind==='bonus')return incomeAmount(g,seat,BONUS);if(t.kind==='event')return 5;
 return p.owner!==null&&p.owner!==seat?-rentPayment(g,tile,seat):propertyOpportunity(g,seat,tile);
}
export function strategicBotAction(g:Game,fallback:Action):Action {
 const seat=g.turn,p=g.players[seat],state=g.world.players[seat];
 const investment=invest(g);if(investment)return investment;
 if(g.phase==='roll'&&g.abilities.pendingTarget)return {action:'ability_target',target:turnTargets(g).sort((a,b)=>g.players[b].cash-g.players[a].cash)[0]};
 if(g.phase==='augment'){
  const actor=g.augmentSeat!,offer=g.augments!.players[actor].offer!;
  if(offer.cards.some(id=>!AUGMENT_CATALOG.some(a=>a.id===id)))return fallback;
  const ranked=offer.cards.map((id,slot)=>({slot,value:augmentValue(g,actor,AUGMENT_CATALOG.find(a=>a.id===id)!)})).sort((a,b)=>b.value-a.value);
  const pool=AUGMENT_CATALOG.filter(a=>a.tier===offer.tier&&!offer.seen.includes(a.id)&&!g.augments!.players[actor].owned.includes(a.id));
  const mean=pool.reduce((n,a)=>n+augmentValue(g,actor,a),0)/Math.max(1,pool.length);
  const reroll=[...ranked].reverse().find(a=>!offer.rerolled[a.slot]);
  if(reroll&&pool.length&&ranked[0].value+12<mean)return {action:'augment_reroll',offerId:offer.id,slot:reroll.slot};
  return {action:'augment_select',offerId:offer.id,slot:ranked[0].slot};
 }
 if(g.phase==='rent'&&g.world.rent){const bill=g.world.rent.amount;return {action:state.passCoupons>0&&(bill>=80||bill>=p.cash*.25||state.passCoupons>1)?'coupon_pass':'rent_pay'};}
 if(g.phase==='event'){
  const e=g.world.current!,action:Action={action:'event_resolve',eventSerial:e.serial},targets=eventTargets(g);
  if(e.id==='festival')return {...action,tile:eventOwnedTiles(g).sort((a,b)=>rent(g,b)-rent(g,a))[0]};
  if(e.id==='long_robbery'||e.id==='tranquilizer')return {...action,target:targets.sort((a,b)=>(e.id==='long_robbery'?g.players[b].cash:netWorth(g,b))-(e.id==='long_robbery'?g.players[a].cash:netWorth(g,a)))[0]};
  if(e.id==='telekinesis'){
   const options=targets.flatMap(target=>[1,2,3].map(steps=>({target,steps,value:-eventDestinationValue(g,target,(g.players[target].position-steps+36)%36)}))).sort((a,b)=>b.value-a.value);
   return {...action,target:options[0]?.target,steps:options[0]?.steps??1};
  }
  if(e.id==='line_quake'){
   const lines=[0,1,2,3].map(line=>({line,value:BOARD.filter(t=>t.kind==='city'&&t.line===line).reduce((n,t)=>{const prop=g.properties[t.index];const top=[2,1,0].find(i=>prop.buildings&(1<<i));const cost=prop.landmark?t.price:top===undefined?0:construction(t.index,top).cost;return n+cost*(prop.owner===seat?-1.5:1);},0)})).sort((a,b)=>b.value-a.value);
   return {...action,line:lines[0].line};
  }
  if(e.id==='hero'){
   const options=targets.map(target=>{const clone=structuredClone(g);clone.players[seat].position=g.players[target].position;const score=movementEvaluator(clone);return {target,value:expected(createRoll(seat,0),false,score)+eventDestinationValue(g,seat,g.players[target].position)};}).sort((a,b)=>b.value-a.value);
   const current=expected(createRoll(seat,0),false,movementEvaluator(g));return options[0]&&options[0].value>current+15?{...action,target:options[0].target}:{...action,decline:true};
  }
  if(e.id==='wall'){
   const walls=BOARD.filter(t=>!g.world.walls.includes(t.index)).map(t=>({tile:t.index,value:g.players.reduce((n,other,i)=>{if(other.bankrupt)return n;const distance=(t.index-other.position+36)%36;const reach=distance<=11?(12-distance)/12:0;return n+reach*(i===seat?-30:15+Math.max(0,-eventDestinationValue(g,i,t.index))*.25);},0)})).sort((a,b)=>b.value-a.value);
   return {...action,tile:walls[0]?.tile};
  }
  if(e.id==='change_augment'){
   const owned=g.augments?.players[seat].owned??[],cards=AUGMENT_CATALOG.filter(a=>owned.includes(a.id)).map(a=>({a,value:augmentValue(g,seat,a)})).sort((a,b)=>a.value-b.value),worst=cards[0];
   if(!worst)return {...action,decline:true};const pool=AUGMENT_CATALOG.filter(a=>a.tier===worst.a.tier&&!owned.includes(a.id));const average=pool.reduce((n,a)=>n+augmentValue(g,seat,a),0)/Math.max(1,pool.length);
   return pool.length&&average>worst.value+15?{...action,augmentId:worst.a.id}:{...action,decline:true};
  }
  if(e.id==='bet')return {...action,amount:p.cash>800&&!state.vulnerable?Math.min(50,Math.floor(p.cash*.03)):0};
  return fallback;
 }
 if(g.phase==='roll'&&!p.rest&&!g.abilities.statuses[seat].skipTurns&&!state.sleepThisTurn&&!g.abilities.pendingTarget){
  if(g.abilities.roll)return fallback;
  const choices=availableDice(g),c=capabilities(g);
  if(!choices.forces.length&&!choices.selectiveDouble&&!choices.copies.length&&!choices.workSubsidy&&!state.homeStones)return {action:'roll'};
  const score=movementEvaluator(g),normal=createRoll(seat,g.abilities.ordinal,!!state.lostThisTurn||!!g.abilities.statuses[seat].restrictedRolls||!!g.abilities.statuses[seat].restrictWholeTurn);
  if(state.lostThisTurn)return {action:'roll'};
  let best:Action={action:'roll'},value=expected(normal,c.doubleLover,score);
  for(const ability of choices.forces)for(const option of ability==='force_gold'?Array.from({length:11},(_,i)=>i+2):ability==='force_silver'?[0,1]:[0,1,2,3]){
   const roll=createRoll(seat,g.abilities.ordinal);const ranges=ability==='force_silver'?[[2,6],[7,12]]:[[2,3],[4,6],[7,9],[10,12]];
   if(ability==='force_gold'){roll.min=Math.max(2,option-2);roll.max=Math.min(12,option+2);}else [roll.min,roll.max]=ranges[option];
   const next=expected(roll,c.doubleLover,score);if(next>value+1){value=next;best={action:'dice_force',ability,option};}
  }
  if(choices.selectiveDouble)for(const useNew of [true,false]){const roll=createRoll(seat,g.abilities.ordinal);roll.forcedDouble=useNew;roll.avoidDouble=!useNew;const next=expected(roll,c.doubleLover,score);if(next>value+1){value=next;best={action:'dice_double',useNew};}}
  for(const sum of choices.copies){const next=score([Math.max(1,sum-6),Math.min(6,sum-1)],true);if(next>value+3){value=next;best={action:'dice_copy',option:sum};}}
  const lastTurn=g.abilities.lastOwnTurn[seat],stayedLastTurn=lastTurn>0&&!g.abilities.throws.some(t=>t.seat===seat&&t.turnId===lastTurn);
  const salary=salaryAmount(g,seat),needsCash=p.cash<SALARY*2;
  if(choices.workSubsidy&&salary>0&&needsCash&&!stayedLastTurn&&(value < -salary*.5 || p.cash<SALARY*.75&&value<salary*.25))return {action:'subsidy'};
  if(!stayedLastTurn&&state.homeStones&&!g.world.interrupted&&!g.abilities.ordinal&&(p.cash<SALARY*3||value<0)&&salaryAmount(g,seat)>value+65)return {action:'home_stone'};
  return best;
 }
 if(g.phase==='dice'){
  const roll=g.abilities.roll!,score=movementEvaluator(g);
  if(roll.comparison)return {action:'dice_choose',useNew:score(roll.comparison)>score(roll.result!)};
  const current=score(roll.result!),choices=availableDice(g);let best:Action={action:'dice_confirm'},value=current;
  for(const ability of choices.rerolls){
   if(ability==='suspicious_dice'){for(const die of [0,1]as const){const pairs=diceCandidates(roll,{index:die===0?1:0,value:roll.result![die===0?1:0]});const next=pairs.reduce((n,p)=>n+score(p),0)/Math.max(1,pairs.length);if(next>value+3){value=next;best={action:'dice_reroll',ability,die};}}}
   else{const next=expected(roll,capabilities(g).doubleLover,p=>ability==='black_dice'?Math.max(current,score(p)):score(p));if(next>value+2){value=next;best={action:'dice_reroll',ability};}}
  }
  return best;
 }
 if(g.phase==='end'&&!g.world.interrupted&&!state.endLocked&&!g.extraTurn&&!p.rest&&!g.abilities.statuses[seat].skipTurns&&state.extraCoupons){const next=expected(createRoll(seat,g.abilities.ordinal+1),capabilities(g).doubleLover,movementEvaluator(g));if(next>10||g.round>110&&next>-10)return {action:'extra_coupon'};}
 return fallback;
}
