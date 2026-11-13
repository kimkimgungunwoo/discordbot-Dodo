import type {MoneyTransfer} from '../../../shared/augment-marble-money';
export const MONEY_EFFECT_MS=1400;
export const moneyCoinCount=(amount:number)=>Math.min(160,Math.max(1,Math.ceil(amount/25)));
/** One burst per committed transfer. Anchors are the sidebar cash values, never board tokens. */
export class MoneyEffects {
 private cursor=0;
 private canvas:HTMLCanvasElement|undefined;
 constructor(private root:HTMLElement){}
 baseline(events:readonly MoneyTransfer[]){this.clear();this.cursor=events.at(-1)?.id??0}
 take(events:readonly MoneyTransfer[]){const fresh=events.filter(e=>e.id>this.cursor&&e.amount>0);this.cursor=Math.max(this.cursor,events.at(-1)?.id??0);return fresh}
 clear(){this.canvas?.remove();this.canvas=undefined}
 async play(events:readonly MoneyTransfer[],signal:AbortSignal){
  if(signal.aborted||!events.length)return;
  const cash=(seat:number)=>this.root.querySelector<HTMLElement>(`[data-cash-seat="${seat}"]`);
  const canvas=document.createElement('canvas');this.canvas=canvas;canvas.className='m-money-fx';canvas.dataset.duration=String(MONEY_EFFECT_MS);canvas.dataset.transfers=JSON.stringify(events.map(e=>({from:e.from,to:e.to,amount:e.amount,coins:moneyCoinCount(e.amount)})));canvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100vw',height:'100dvh',zIndex:'115',pointerEvents:'none'});document.body.append(canvas);
  const ctx=canvas.getContext('2d')!,dpr=Math.min(devicePixelRatio||1,2);let width=innerWidth,height=innerHeight;
  const resize=()=>{width=innerWidth;height=innerHeight;canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)};resize();addEventListener('resize',resize);
  const point=(seat:number|null)=>{const node=seat===null?this.root.querySelector<HTMLElement>('.m-center'):cash(seat),r=node?.getBoundingClientRect();return r?{x:r.left+r.width/2,y:r.top+r.height/2}:{x:width/2,y:height*.4}};
  const coin=(x:number,y:number,p:number,i:number)=>{ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(p*6+i)*.12);ctx.scale(Math.max(.3,Math.abs(Math.cos(p*5+i*.4))),1);ctx.globalAlpha=Math.min(1,p*12,(1-p)*12);ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.fillStyle='#edcc70';ctx.fill();ctx.strokeStyle='#866529';ctx.lineWidth=1;ctx.stroke();ctx.beginPath();ctx.arc(-.5,-.5,4.8,0,Math.PI*2);ctx.strokeStyle='#fff0bc';ctx.stroke();ctx.font='900 9px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#8c6a25';ctx.fillText('₩',0,0);ctx.restore()};
  const label=(text:string,x:number,y:number,color:string,a:number)=>{ctx.save();ctx.globalAlpha=a;ctx.font='900 16px "Apple SD Gothic Neo","Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';const half=ctx.measureText(text).width/2;x=Math.max(half+8,Math.min(width-half-8,x));ctx.lineWidth=4;ctx.strokeStyle='#fffef8';ctx.strokeText(text,x,y);ctx.fillStyle=color;ctx.fillText(text,x,y);ctx.restore()};
  const totals=new Map<number,{gain:number;loss:number}>();for(const e of events){if(e.from!==null){const p=totals.get(e.from)??{gain:0,loss:0};p.loss+=e.amount;totals.set(e.from,p)}if(e.to!==null){const p=totals.get(e.to)??{gain:0,loss:0};p.gain+=e.amount;totals.set(e.to,p)}}
  let frame=0;const started=performance.now();
  await new Promise<void>(resolve=>{const done=()=>{cancelAnimationFrame(frame);removeEventListener('resize',resize);signal.removeEventListener('abort',done);canvas.remove();if(this.canvas===canvas)this.canvas=undefined;resolve()};
   const draw=(now:number)=>{if(signal.aborted||!canvas.isConnected){done();return}const t=Math.min(1,(now-started)/MONEY_EFFECT_MS);ctx.clearRect(0,0,width,height);
    for(const transfer of events){const a=point(transfer.from),b=point(transfer.to),count=moneyCoinCount(transfer.amount),dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,bend=Math.min(80,length*.22);for(let i=0;i<count;i++){const p=(t-(count===1?0:i/(count-1))*.22)/.56;if(p<0||p>1)continue;const arc=Math.sin(p*Math.PI)*bend;coin(a.x+dx*p-dy/length*arc,a.y+dy*p+dx/length*arc,p,i)}if(t>.65){const q=(t-.65)/.35;ctx.save();ctx.globalAlpha=(1-q)*.5;ctx.strokeStyle='#bb9340';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(b.x,b.y,8+q*25,4+q*12,0,0,Math.PI*2);ctx.stroke();ctx.restore()}}
    for(const [seat,value]of totals){const p=point(seat),card=cash(seat)?.closest('[data-player-seat]')?.getBoundingClientRect(),labelY=(offset:number)=>card?Math.min(card.bottom-12,card.top+offset):p.y+offset;if(value.loss&&t<.65)label(`−${value.loss.toLocaleString()}만원`,p.x,labelY(36)-t*4,'#ae6559',Math.min(1,t*10,(.65-t)*5));if(value.gain&&t>.45)label(`+${value.gain.toLocaleString()}만원`,p.x,labelY(value.loss?56:36)-(t-.45)*4,'#9b792d',Math.min(1,(t-.45)*8,(1-t)*8))}
    if(t<1)frame=requestAnimationFrame(draw);else done();
   };signal.addEventListener('abort',done,{once:true});draw(started);
  });
 }
}
