import type { Game } from '../../../shared/augment-marble';
import { playerDisplayOrder } from '../../../shared/augment-marble';
import { effectStart, effectRemaining } from './presentation-clock';

export const BLACK_INTRODUCTIONS: Record<string,{name:string;caption:string}> = {
 silent:{name:'사일런트',caption:'침묵하십시오. 검은 힘만이 남습니다.'},
 redistribution:{name:'부의 재분배',caption:'가진 것을 내려놓으십시오. 부는 다시 나뉩니다.'},
 collector:{name:'징수의 총',caption:'현금을 지키십시오. 50만 원 이하에는 죽음이 기다립니다.'},
 copernicus:{name:'코페르니쿠스 변환',caption:'개념이 뒤엉킵니다.'},
 pacemaker:{name:'페이스메이커',caption:'멈추지 마십시오. 세 턴의 라인 정체는 처형으로 이어집니다.'},
 guillotine:{name:'단두대',caption:'심판의 선을 벗어나십시오. 집행은 네 라운드 뒤 시작됩니다.'},
 dirge:{name:'진흔곡',caption:'출발점을 지날 때마다, 모두의 재산이 깎여 나갑니다.'},
};

/** A transition, not ownership alone: reconnects must never replay the ceremony. */
export function blackIntroductions(before:Game|undefined,after:Game){
 if(!before||before.black?.acquisitionResolved||!after.black?.acquisitionResolved)return [];
 return playerDisplayOrder(after).flatMap(seat=>(after.augments?.players[seat]?.owned??[])
  .filter(id=>Object.hasOwn(BLACK_INTRODUCTIONS,id)).map(id=>({seat,id,...BLACK_INTRODUCTIONS[id]}))).sort((a,b)=>Number(a.id==="copernicus")-Number(b.id==="copernicus"));
}

/** Only names and the agreed line; no rules text or simulated ability activation. */
export async function showBlackIntroduction(root:HTMLElement,intro:{seat:number;id:string;name:string;caption:string},playerName:string,signal:AbortSignal){
 if(signal.aborted)return;
 const duration=2400,start=effectStart(duration),remaining=effectRemaining(start,duration);
 if(!remaining)return;
 const layer=document.createElement('div');layer.className='m-black-introduction';layer.dataset.blackIntroduction=intro.id;
 const actor=document.createElement('span');actor.className='m-black-intro-player';actor.textContent=`${intro.seat+1}P · ${playerName}`;
 const title=document.createElement('strong');title.textContent=intro.name;
 const caption=document.createElement('span');caption.className='m-black-intro-caption';caption.textContent=intro.caption;
 layer.append(actor,title,caption);layer.setAttribute('role','status');layer.style.animationDelay=`-${Math.max(0,performance.now()-start)}ms`;
 const nodes=[...root.querySelectorAll<HTMLElement|SVGElement>(`[data-player-seat="${intro.seat}"],[data-token-part="${intro.seat}"]`)];
 nodes.forEach(n=>n.classList.add('m-black-intro-subject'));document.body.append(layer);
 await new Promise<void>(resolve=>{let timer:ReturnType<typeof setTimeout>;const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);layer.remove();nodes.forEach(n=>n.classList.remove('m-black-intro-subject'));resolve()};timer=setTimeout(done,remaining);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done()});
}
