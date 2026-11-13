import { COLORS } from "../../../shared/augment-marble";
export async function showTakeover(root:HTMLElement,tile:number,name:string,from:number,to:number,names:readonly string[],flip:()=>void,signal:AbortSignal){
 if(signal.aborted)return;
 const layer=document.createElement("div");layer.className="m-takeover-fx";layer.dataset.takeoverTile=String(tile);layer.dataset.from=String(from);layer.dataset.to=String(to);layer.style.setProperty("--owner",COLORS[to]);
 const stamp=document.createElement("div");stamp.className="m-takeover-stamp";
 const title=document.createElement("strong"),owners=document.createElement("span");title.textContent=`${name} 인수 중`;owners.textContent=`${from+1}P ${names[from]} → ${to+1}P ${names[to]}`;stamp.append(title,owners);layer.append(stamp);document.body.append(layer);
 await new Promise<void>(resolve=>{
  let frame=0,changed=false;const start=performance.now(),duration=1100;
  const done=()=>{cancelAnimationFrame(frame);signal.removeEventListener("abort",done);layer.remove();resolve();};
  const draw=(now:number)=>{
   if(signal.aborted){done();return;}
   const t=Math.min(1,(now-start)/duration);
   if(t>=.35&&!changed){changed=true;flip();title.textContent=`${name} 인수 완료`;layer.classList.add("is-transferred");layer.dataset.transferred="true";}
   const node=root.querySelector<SVGElement>(`.m-tile[data-inspect="${tile}"]`),r=node?.getBoundingClientRect();
   if(r){Object.assign(layer.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});const width=stamp.offsetWidth;stamp.style.left=`${Math.max(8,Math.min(innerWidth-width-8,r.left+r.width/2-width/2))-r.left}px`;stamp.style.top=`${Math.max(8,r.top-stamp.offsetHeight-12)-r.top}px`;}
   if(t<1)frame=requestAnimationFrame(draw);else done();
  };signal.addEventListener("abort",done,{once:true});draw(start);
 });
}
