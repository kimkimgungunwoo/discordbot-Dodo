import {effectStart,effectRemaining} from './presentation-clock';
/** Public, board-centered elimination notice; no interpolation of player names into HTML. */
export async function showElimination(root:HTMLElement,players:{name:string;seat:number;execution:boolean}[],signal:AbortSignal){
 if(signal.aborted||!players.length)return;
 const duration=1250,start=effectStart(duration),remaining=effectRemaining(start,duration);if(remaining<=0)return;
 const layer=document.createElement('div');layer.className='m-elimination-announcement';layer.setAttribute('role','status');
 const board=root.querySelector('.m-board'),r=board?.getBoundingClientRect();const x=r?r.left+r.width/2:innerWidth/2,y=r?r.top+r.height*.44:innerHeight*.44;
 Object.assign(layer.style,{left:`${Math.max(100,Math.min(innerWidth-100,x))}px`,top:`${Math.max(60,Math.min(innerHeight-80,y))}px`,animationDelay:`${-(duration-remaining)}ms`});
 for(const p of players){const row=document.createElement('div'),name=document.createElement('small'),title=document.createElement('strong');name.textContent=`${p.seat+1}P ${p.name}`;title.textContent=p.execution?'처형':'파산';row.append(name,title);layer.append(row)}document.body.append(layer);
 await new Promise<void>(resolve=>{let timer:ReturnType<typeof setTimeout>;const done=()=>{clearTimeout(timer);layer.remove();signal.removeEventListener('abort',done);resolve()};signal.addEventListener('abort',done,{once:true});timer=setTimeout(done,remaining);});
}
