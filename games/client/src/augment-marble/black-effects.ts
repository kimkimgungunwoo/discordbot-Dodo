import { BLACK_INTRODUCTIONS } from './black-introduction';
import { effectStart } from './presentation-clock';
import type { AbilityEvent } from '../../../shared/augment-marble-runtime';
import { COLORS } from '../../../shared/augment-marble';

export const BLACK_EFFECTS = {
 collector:'징수의 총',devour:'꿀꺽',goblin:'도깨비',redistribution:'부의 재분배',mind_control:'정신조종',dirge:'진흔곡',leech:'거머리',sniper:'저격수',silent:'사일런트',shaco:'샤코',adamant:'금강불괴',landmark_takeover:'랜드마크 인수',unfair_trade:'부당거래',guillotine:'단두대',pacemaker:'페이스메이커'
} as const;
type Key=keyof typeof BLACK_EFFECTS;
type Point={x:number;y:number};
export function isBlackEffect(id:string):id is Key{return Object.hasOwn(BLACK_EFFECTS,id)}
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
/** Draw on live board coordinates. No screenshots, replacement board, or synthetic players. */
export async function playBlackEffect(root:HTMLElement,event:AbilityEvent,signal:AbortSignal):Promise<void>{
 if(!isBlackEffect(event.ability)||signal.aborted)return;
 const key=event.ability,cinematic=key==='silent'||key==='redistribution',duration=key==='redistribution'?7600:key==='silent'?1650:2200;
 const start=effectStart(duration),canvas=document.createElement('canvas');canvas.className='m-black-effect';canvas.dataset.blackEffect=key;canvas.setAttribute('aria-hidden','true');
 const ctx=canvas.getContext('2d')!;document.body.append(canvas);
 const token=(seat:number)=>root.querySelector<SVGImageElement>(seat===event.target&&event.targetEntity==='clone'?`[data-clone-token="${seat}"]`:`[data-token="${seat}"]`);
 const board=()=>root.querySelector('.m-board')!.getBoundingClientRect();
 const point=(seat:number):Point=>{const r=token(seat)?.getBoundingClientRect()??root.querySelector(`[data-player-seat="${seat}"]`)?.getBoundingClientRect()??board();return{x:r.left+r.width/2,y:r.top+r.height*.65}};
 const target=event.target??event.actor;
 const seats=[...root.querySelectorAll<HTMLElement>('[data-player-seat]')].filter(n=>!n.classList.contains('bankrupt')).map(n=>Number(n.dataset.playerSeat));
 const peers=event.black?.targets??seats.filter(s=>s!==event.actor),redistributionSeats=event.black?.targets??seats;
 const actorImage=new Image(),victimImage=new Image(),cloneImage=new Image();cloneImage.src=root.querySelector(`[data-clone-token="${event.actor}"]`)?.getAttribute('href')??root.querySelector(`[data-token="${event.actor}"]`)?.getAttribute('href')??'';actorImage.src=token(event.actor)?.getAttribute('href')??'';victimImage.src=token(target)?.getAttribute('href')??'';
 const changed=new Map<HTMLElement|SVGElement,string>(),muted:HTMLElement[]=[];
 const hide=(node:HTMLElement|SVGElement|null)=>{if(node&&!changed.has(node)){changed.set(node,node.style.visibility);node.style.visibility='hidden'}};
 const drawBird=(image:HTMLImageElement,p:Point,size:number,scale=1)=>{if(image.complete&&image.naturalWidth){const h=size*image.naturalHeight/image.naturalWidth;ctx.imageSmoothingEnabled=false;ctx.drawImage(image,p.x-size*scale/2,p.y-(size*.65+h-size*.8)*scale,size*scale,h*scale)}};
 const line=(a:Point,b:Point,color:string,width=2)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()};
 const ellipse=(p:Point,rx:number,ry:number,fill:string,stroke='#303b2e')=>{ctx.fillStyle=fill;ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(p.x,p.y,Math.max(.1,rx),Math.max(.1,ry),0,0,Math.PI*2);ctx.fill();ctx.stroke()};
 const label=(text:string,p:Point,size=17)=>{ctx.font=`900 ${size}px "Apple SD Gothic Neo",sans-serif`;ctx.textAlign='center';ctx.lineWidth=4;ctx.strokeStyle='#fff9e5';ctx.strokeText(text,p.x,p.y);ctx.fillStyle='#293729';ctx.fillText(text,p.x,p.y)};
 const coin=(p:Point,r=4)=>ellipse(p,r,r*.6,'#d5b462','#75613e');
 const burst=(p:Point,t:number,color:string)=>{ctx.save();ctx.globalAlpha=1-clamp(t);for(let i=0;i<12;i++){const a=i*2.399,r=8+t*45;ctx.fillStyle=color;ctx.strokeStyle='#35422f';ctx.lineWidth=1;ctx.fillRect(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r,4,5);ctx.strokeRect(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r,4,5)}ctx.restore()};
 const stream=(a:Point,b:Point,t:number,color:string)=>{line(a,b,color,3);for(let i=0;i<9;i++){const k=(t*.9+i/9)%1,p=mix(a,b,k);p.y-=Math.sin(k*Math.PI)*18;ellipse(p,3,3,color)}};
 let shattered=false;
 await new Promise<void>(resolve=>{
 let raf=0,done=false;
 const finish=()=>{if(done)return;done=true;cancelAnimationFrame(raf);canvas.remove();for(const [node,value]of changed){node.style.visibility=value;node.classList.remove('m-guillotine-strike')}for(const n of muted)n.classList.remove('m-black-cracked');signal.removeEventListener('abort',finish);resolve()};
 signal.addEventListener('abort',finish,{once:true});
 const frame=(now:number)=>{if(done)return;const elapsed=(now-start)/1000,t=elapsed+(key==='redistribution'?1.6:key==='silent'?1.35:0);if(t<0){raf=requestAnimationFrame(frame);return}if(elapsed>=duration/1000){finish();return}
 const dpr=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(innerWidth*dpr)||canvas.height!==Math.round(innerHeight*dpr)){canvas.width=Math.round(innerWidth*dpr);canvas.height=Math.round(innerHeight*dpr)}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);
 const a=point(event.actor),b=point(target),r=board(),center={x:r.left+r.width/2,y:r.top+r.height/2},unit=Math.max(.65,Math.min(1.25,r.width/700));
 ctx.save();
 if(key==='shaco')hide(root.querySelector<SVGElement>(`[data-clone-seat="${event.actor}"]`));
 if(key==='guillotine'&&event.black?.line!==undefined){const zone=root.querySelector(`[data-guillotine-zone="${event.black.line}"]`);if(zone&&!changed.has(zone as SVGElement)){changed.set(zone as SVGElement,'');zone.classList.add('m-guillotine-strike');}}
 else if(key==='guillotine'||key==='pacemaker'){burst(b,clamp(t/.9),'#a95b69');}
 else if(key==='collector'){
 const from={x:a.x+14*unit,y:a.y-12*unit},to={x:b.x,y:b.y-8*unit};const k=clamp(t/.65),p=mix(from,to,k);
 if(t<.65){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(to.y-from.y,to.x-from.x));ctx.scale(unit,unit);ctx.fillStyle='#668276';ctx.strokeStyle='#2b3b30';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(20,0);ctx.lineTo(0,-10);ctx.lineTo(-24,-17);ctx.lineTo(-17,-3);ctx.lineTo(-35,0);ctx.lineTo(-15,8);ctx.lineTo(-23,17);ctx.lineTo(3,10);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#eee0a5';ctx.fillRect(5,-5,5,3);ctx.restore()}
 else{hide(token(target));burst(b,(t-.65)/.6,'#688373');if(t<1.65){const name=root.querySelector(`[data-player-seat="${target}"] strong`)?.textContent?.replace(/\s+/g,' ').trim()??`${target+1}P`;label(event.caption.includes('생존 수단')?'처형 위기':'처형',{x:center.x,y:center.y},Math.min(50,r.width*.085));label(name,{x:center.x,y:center.y-42*unit},Math.min(18,r.width*.035));}}
 }else if(key==='devour'){
 const k=clamp(t/.75),p={...a},size=token(event.actor)?.getBoundingClientRect().width??45;hide(token(event.actor));drawBird(actorImage,{x:p.x,y:p.y},size);
 if(t>.75){hide(token(target));const q=clamp((t-.75)/.7),v={x:b.x,y:b.y};drawBird(victimImage,v,size*.9,1-clamp((q-.65)/.35));const gap=28*(1-clamp((t-1.1)/.25));ctx.fillStyle='#fff3d3';ctx.strokeStyle='#303b2e';ctx.lineWidth=2;for(const sign of [-1,1])for(let i=0;i<5;i++){const x=b.x+(i-2)*10*unit,y=b.y+sign*(gap+8)*unit;ctx.beginPath();ctx.moveTo(x-5*unit,y+sign*10*unit);ctx.lineTo(x+5*unit,y+sign*10*unit);ctx.lineTo(x,y-sign*4*unit);ctx.closePath();ctx.fill();ctx.stroke()}if(t>1.35){burst(b,(t-1.35)/.5,'#819566');label('와그작!',{x:b.x,y:b.y-48*unit},18)}}
 }else if(key==='redistribution'){
 const ct=t-1.6;if(ct>=0){const gathering=clamp(ct/2),travel=clamp((ct-4.9)/1.5);if(ct<2)redistributionSeats.forEach(s=>{for(let i=0;i<12;i++){const k=clamp(gathering*1.5-i*.04);if(k>0&&k<1){const p=mix(point(s),center,k);p.y-=Math.sin(k*Math.PI)*30;coin(p)}}});if(ct<4.4){for(let i=0;i<Math.floor(60*gathering);i++)coin({x:center.x+(i%10-4.5)*8*unit,y:center.y-Math.floor(i/10)*5*unit},6*unit);if(ct>2)label(event.amount?`총 ${event.amount.toLocaleString()}만원`:'모인 현금',{x:center.x,y:center.y-55*unit},20)}else redistributionSeats.forEach((s,i)=>{const angle=i*Math.PI*2/redistributionSeats.length,spread=clamp((ct-4.4)/.5),origin={x:center.x+Math.cos(angle)*30*unit*spread,y:center.y+Math.sin(angle)*24*unit*spread},p=mix(origin,point(s),travel);if(travel<1)for(let n=0;n<20;n++)coin({x:p.x+(n%5-2)*7*unit,y:p.y-Math.floor(n/5)*5*unit},5*unit)})}
 }else if(key==='goblin'){
 for(let i=0;i<5;i++){const q=t*4+i*Math.PI*2/5,x=a.x+Math.cos(q)*32*unit,y=a.y+Math.sin(q)*14*unit;ctx.fillStyle='#24b99e';ctx.strokeStyle='#285244';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y+5);ctx.bezierCurveTo(x-13,y,x-8,y-15,x,y-25);ctx.bezierCurveTo(x-2,y-8,x+16,y-9,x+8,y+3);ctx.closePath();ctx.fill();ctx.stroke();ellipse({x,y:y-4},3,7,'#ccf0b7','#ccf0b7')}
 }else if(key==='mind_control'){
 for(let i=0;i<4;i++){ctx.strokeStyle='#877298';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(a.x,a.y-25);ctx.bezierCurveTo(a.x,center.y-i*7,b.x,center.y-i*7,b.x,b.y-25);ctx.stroke()}ellipse({x:b.x,y:b.y-35},14,5,'#b9a1c5');
 }else if(key==='dirge'||key==='leech'){
 const color=key==='leech'?'#75964a':'#a95b69';if(key==='dirge'){ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();for(let i=0;i<3;i++){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(a.x,a.y,(t*140+i*70)%Math.max(r.width,r.height),0,Math.PI*2);ctx.stroke()}ctx.restore()}(key==='leech'?[target]:peers).forEach(s=>stream(point(s),a,t,color));
 }else if(key==='sniper'){
 const aim={x:b.x,y:b.y-8},radius=(22-6*clamp(t))*unit;ctx.strokeStyle='#a45a4d';ctx.lineWidth=2;ctx.beginPath();ctx.arc(aim.x,aim.y,radius,0,Math.PI*2);ctx.stroke();for(const v of [-1,1]){line({x:aim.x+v*radius,y:aim.y},{x:aim.x+v*(radius+9),y:aim.y},'#a45a4d');line({x:aim.x,y:aim.y+v*radius},{x:aim.x,y:aim.y+v*(radius+9)},'#a45a4d')}if(t>.6&&t<.78)line(a,aim,'#3e4835',4);if(t>.7){burst(aim,(t-.7)/.65,'#ad6555');label('주사위 제한',{x:b.x,y:b.y-45},12)}
 }else if(key==='silent'){
 if(t>1.35&&!shattered){shattered=true;for(const s of peers)for(const card of root.querySelectorAll<HTMLElement>(`[data-owned-seat="${s}"]`)){if(card.classList.contains('tier-black'))continue;card.classList.add('m-black-cracked');muted.push(card)}}if(t>1.35)for(const card of muted){const cr=card.getBoundingClientRect(),k=clamp((t-1.35)/.8);ctx.save();ctx.globalAlpha=1-k;for(let i=0;i<5;i++){ctx.fillStyle='#d6cfac';ctx.strokeStyle='#48503d';const x=cr.x+cr.width*i/5+(i-2)*k*8,y=cr.y+k*k*55;ctx.fillRect(x,y,6,8);ctx.strokeRect(x,y,6,8)}ctx.restore()}
 }else if(key==='shaco'){
 const cell=event.black?.destinationTile===undefined?null:root.querySelector(`[data-inspect="${event.black.destinationTile}"]`),box=cell?.getBoundingClientRect(),p=box?{x:box.x+box.width/2,y:box.y+box.height/2}:a;drawBird(cloneImage,p,42*unit,clamp(t/.4));burst(p,clamp(t/1.5),'#987b9e');
 }else if(key==='adamant'){
 ctx.fillStyle='#c2a15c33';ctx.strokeStyle='#ad8d45';ctx.lineWidth=3;ctx.beginPath();for(let i=0;i<7;i++){const q=i*Math.PI/3-Math.PI/6,x=a.x+Math.cos(q)*36*unit,y=a.y-6+Math.sin(q)*43*unit;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.fill();ctx.stroke();if(t>.3)burst(a,(t-.3)/1.5,'#b99b55');
 }else if(key==='landmark_takeover'){
 const node=root.querySelector(`[data-building-tile="${event.tile}"]`),box=node?.getBoundingClientRect();if(box){ctx.fillStyle=COLORS[event.actor]+'44';ctx.strokeStyle=COLORS[event.actor];ctx.lineWidth=3;ctx.fillRect(box.x-4,box.y-4,box.width+8,box.height+8);ctx.strokeRect(box.x-4,box.y-4,box.width+8,box.height+8);label(`${event.actor+1}P 인수`,{x:box.x+box.width/2,y:box.y-10},14)}
 }else if(key==='unfair_trade'){
 ctx.save();ctx.translate(center.x,center.y);ctx.scale(unit,unit);for(const sign of [1,-1]){ctx.save();ctx.scale(sign,sign);ctx.translate(0,-12);ctx.fillStyle=COLORS[sign===1?event.actor:target];ctx.strokeStyle='#303b2e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-45,-6);ctx.lineTo(20,-6);ctx.lineTo(20,-18);ctx.lineTo(45,2);ctx.lineTo(20,22);ctx.lineTo(20,10);ctx.lineTo(-45,10);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore()}ctx.restore();for(const item of event.black?.territories??[]){const cell=root.querySelector(`[data-inspect="${item.tile}"]`),box=cell?.getBoundingClientRect();if(!box)continue;ctx.fillStyle=t<1.4?(Math.floor(t*6)%2?'#fff8ddaa':'#fff8dd22'):COLORS[item.owner]+'77';ctx.fillRect(box.x+2,box.y+2,box.width-4,box.height-4)}
 }
 if(!Object.hasOwn(BLACK_INTRODUCTIONS,key)&&!cinematic&&!["collector","devour"].includes(key)){const x=Math.max(120,Math.min(innerWidth-120,center.x)),y=Math.max(70,Math.min(innerHeight-100,center.y));label(`${event.actor+1}P · ${BLACK_EFFECTS[key]}`,{x,y:y-14},Math.min(28,innerWidth*.055));label(event.caption,{x,y:y+18},Math.min(16,innerWidth*.027));}
 ctx.restore();raf=requestAnimationFrame(frame)};
 frame(performance.now());
 });
}
