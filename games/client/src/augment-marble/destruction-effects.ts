/** Shake the affected tiles, collapse their actual top buildings, then settle dust/rubble. */
export async function destroyBuildings(root:HTMLElement,tiles:number[],signal:AbortSignal){
 const canvas=document.createElement('canvas');canvas.className='m-destruction-fx';canvas.dataset.tiles=tiles.join(',');Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100vw',height:'100dvh',pointerEvents:'none',zIndex:'66'});const dpr=Math.min(devicePixelRatio||1,2);canvas.width=innerWidth*dpr;canvas.height=innerHeight*dpr;const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr);document.body.append(canvas);
 const animations:Animation[]=[],points:{x:number;y:number;size:number}[]=[];
 for(const tile of tiles){const cluster=root.querySelector<SVGGElement>(`[data-building-tile="${tile}"]`),node=cluster?.querySelector<SVGGElement>('.building-unit:last-child')??cluster?.querySelector<SVGGElement>('.m-property-flag');const region=root.querySelector<SVGElement>(`.m-board-svg [data-inspect="${tile}"]`);const r=(cluster??region)?.getBoundingClientRect();if(r)points.push({x:r.x+r.width/2,y:r.bottom,size:Math.max(18,r.width)});
 if(region)animations.push(region.animate([{transform:'translate(0,0)'},{transform:'translate(-3px,1px)'},{transform:'translate(4px,-2px)'},{transform:'translate(-4px,2px)'},{transform:'translate(0,0)'}],{duration:280,iterations:2}));
 if(node){node.style.transformBox='fill-box';node.style.transformOrigin='50% 100%';animations.push(node.animate([{transform:'translate(0,0) rotate(0deg)',opacity:1},{transform:'translate(-3px,0) rotate(-7deg)',opacity:1,offset:.22},{transform:'translate(4px,4px) rotate(12deg)',opacity:1,offset:.4},{transform:'translate(10px,25px) rotate(27deg) scale(.6,.2)',opacity:0}],{duration:850,fill:'forwards'}));}
 }
 let frame=0;const started=performance.now();
 await new Promise<void>(resolve=>{const done=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',done);for(const a of animations)a.cancel();canvas.remove();resolve()};const draw=(now:number)=>{if(signal.aborted){done();return}const t=Math.min(1,(now-started)/1100);ctx.clearRect(0,0,innerWidth,innerHeight);
 for(const point of points){const q=Math.max(0,(t-.22)/.78);if(!q)continue;
 ctx.strokeStyle=`rgba(82,60,46,${(1-q)*.7})`;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(point.x-point.size*.45,point.y);ctx.lineTo(point.x-7,point.y+4);ctx.lineTo(point.x+1,point.y-2);ctx.lineTo(point.x+point.size*.45,point.y+3);ctx.stroke();
 for(let i=0;i<12;i++){const angle=i*Math.PI*2/12,x=point.x+Math.cos(angle)*(8+q*point.size*.8),y=point.y-5-Math.sin(i*1.8)*q*16;ctx.fillStyle=`rgba(171,153,123,${Math.sin(q*Math.PI)*.5})`;ctx.beginPath();ctx.ellipse(x,y,4+q*13,3+q*8,0,0,Math.PI*2);ctx.fill();}
 for(let i=0;i<9;i++){const x=point.x+(i-4)*q*8,y=point.y-35*Math.sin(Math.PI*q)+q*q*18;ctx.save();ctx.translate(x,y);ctx.rotate(i+q*5);ctx.globalAlpha=1-q;ctx.fillStyle=i%2?'#a58e64':'#6d7569';ctx.fillRect(-2,-2,4+i%3,4);ctx.restore();}
 }if(t<1)frame=requestAnimationFrame(draw);else done()};signal.addEventListener('abort',done,{once:true});draw(started)});
}
