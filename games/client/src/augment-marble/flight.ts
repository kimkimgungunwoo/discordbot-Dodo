import { boardSpace } from "./board-space";
/** Shared forced-movement arc: one continuous flight, landing squash, then cleanup. */
export async function flyToken(root:HTMLElement,seat:number,to:DOMRect,signal:AbortSignal,startedAt=performance.now()){
 const token=root.querySelector<SVGImageElement>(`[data-token="${seat}"]`);if(!token||signal.aborted)return;
 const space=boardSpace(root),from=space.local(token.getBoundingClientRect()),target=space.local(to),sprite=document.createElement('img'),shadow=document.createElement('div');
 sprite.src=token.getAttribute('href')??token.getAttribute('xlink:href')??'';sprite.dataset.flyingSeat=String(seat);sprite.dataset.startedAt=String(startedAt);
 Object.assign(sprite.style,{position:'fixed',left:'0',top:'0',pointerEvents:'none',zIndex:'65',imageRendering:'pixelated',transformOrigin:'50% 100%'});
 Object.assign(shadow.style,{position:'fixed',left:'0',top:'0',height:'5px',borderRadius:'50%',background:'#303b3640',zIndex:'64',pointerEvents:'none'});
 const parts=root.querySelectorAll<HTMLElement>(`[data-token="${seat}"],[data-token-part="${seat}"]`);parts.forEach(p=>p.style.visibility='hidden');document.body.append(shadow,sprite);
 await new Promise<void>(resolve=>{let frame=0;const start=startedAt,duration=780,lift=Math.max(55,Math.min(125,Math.hypot(target.x-from.x,target.y-from.y)*.4));
 const done=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',done);sprite.remove();shadow.remove();parts.forEach(p=>p.style.visibility='');resolve()};
 const draw=(now:number)=>{if(signal.aborted){done();return}const t=Math.max(0,Math.min(1,(now-start)/duration)),p=Math.min(1,t/.84),ease=p*p*(3-2*p),x=from.x+(target.x-from.x)*ease,y=from.y+(target.y-from.y)*ease,jump=Math.sin(Math.PI*p)*lift,w=from.w+(target.w-from.w)*ease,h=from.h+(target.h-from.h)*ease,squash=t>.84?Math.sin((t-.84)/.16*Math.PI)*.18:0;
 const point=space.viewport({x,y:y-jump,w,h}),ground=space.viewport({x,y,w,h});
 sprite.dataset.progress=String(p);sprite.dataset.jump=String(jump*point.w/w);sprite.style.width=`${point.w}px`;sprite.style.height=`${point.h}px`;sprite.style.transform=`translate(${point.x}px,${point.y}px) rotate(${Math.sin(p*Math.PI)*-22}deg) scale(${1+squash},${1-squash})`;shadow.style.width=`${point.w*.55}px`;shadow.style.transform=`translate(${ground.x+ground.w*.225}px,${ground.y+ground.h-2}px) scale(${1-.5*Math.sin(p*Math.PI)})`;
 if(t<1)frame=requestAnimationFrame(draw);else done()};signal.addEventListener('abort',done,{once:true});draw(performance.now());
 });
}
