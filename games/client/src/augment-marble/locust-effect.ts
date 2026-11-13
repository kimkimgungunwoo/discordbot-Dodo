import { BOARD } from '../../../shared/augment-marble';

/** Follow the board on every frame, including while the page scrolls. */
export async function showLocustSwarm(root:HTMLElement,path:number[],arrive:(tile:number)=>void,signal:AbortSignal){
 if(signal.aborted)return;
 const canvas=document.createElement('canvas');canvas.className='m-locust-fx';canvas.dataset.path=path.join(',');
 Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100vw',height:'100dvh',pointerEvents:'none',zIndex:'66'});
 const ctx=canvas.getContext('2d')!;document.body.append(canvas);
 const point=(tile:number)=>{const r=root.querySelector<SVGElement>(`.m-board-svg .m-tile[data-inspect="${tile}"]`)?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2,size:Math.min(r.width,r.height)}:null;};
 await new Promise<void>(resolve=>{
  let frame=0,last=0;const start=performance.now(),hop=420,duration=hop*5+650;
  const done=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',done);canvas.remove();resolve();};
  const draw=(now:number)=>{
   if(signal.aborted){done();return;}
   const elapsed=now-start,progress=Math.min(5,elapsed/hop),step=Math.min(4,Math.floor(progress)),fraction=progress-step;
   while(last<Math.floor(progress)){last++;arrive(path[last]);}
   const dpr=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(innerWidth*dpr)||canvas.height!==Math.round(innerHeight*dpr)){canvas.width=Math.round(innerWidth*dpr);canvas.height=Math.round(innerHeight*dpr);}
   ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);
   const a=point(path[step]),b=point(path[step+1]);
   if(a&&b){
    const x=a.x+(b.x-a.x)*fraction,y=a.y+(b.y-a.y)*fraction-15*Math.sin(fraction*Math.PI),fade=Math.min(1,(duration-elapsed)/400);
    ctx.globalAlpha=Math.max(0,fade);
    for(let i=0;i<22;i++){
     const ox=Math.sin(i*7.3)*28,oy=Math.cos(i*4.7)*17+Math.sin(elapsed/65+i)*4;
     ctx.save();ctx.translate(x+ox,y+oy);ctx.rotate(Math.sin(i)*.45);ctx.strokeStyle='#34451d';ctx.lineWidth=1.4;
     ctx.beginPath();ctx.moveTo(-6,5);ctx.lineTo(-2,0);ctx.lineTo(3,6);ctx.moveTo(1,0);ctx.lineTo(7,5);ctx.moveTo(4,-2);ctx.lineTo(8,-7);ctx.stroke();
     ctx.fillStyle=i%2?'#84a343':'#b1c66a';ctx.beginPath();ctx.ellipse(0,0,6,2.6,0,0,Math.PI*2);ctx.fill();ctx.stroke();
     ctx.fillStyle='#34451d';ctx.beginPath();ctx.arc(5,-2,2,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    const tile=path[Math.min(5,Math.floor(progress))];
    if(last>0&&BOARD[tile].kind==='city'){
     const p=point(tile);if(p){ctx.fillStyle='rgba(150,184,65,.23)';ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);}
    }
    const label=last>0&&BOARD[tile].kind==='city'?`${BOARD[tile].name} 통행료 ×0.7`:'메뚜기떼';
    ctx.font='bold 14px sans-serif';const w=ctx.measureText(label).width+20,lx=Math.max(8,Math.min(innerWidth-w-8,x-w/2)),ly=Math.max(25,y-44);
    ctx.fillStyle='#f3f7df';ctx.strokeStyle='#51652d';ctx.lineWidth=2;ctx.fillRect(lx,ly-20,w,28);ctx.strokeRect(lx,ly-20,w,28);ctx.fillStyle='#34451d';ctx.fillText(label,lx+10,ly-1);
   }
   if(elapsed<duration)frame=requestAnimationFrame(draw);else done();
  };
  signal.addEventListener('abort',done,{once:true});draw(start);
 });
}
