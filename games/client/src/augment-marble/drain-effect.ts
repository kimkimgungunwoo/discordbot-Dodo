/** Blood-like wisps flow from the victim into the caster; shared by draining abilities. */
export function bloodDrain(from:()=>DOMRect|undefined,to:()=>DOMRect|undefined,duration:number,signal:AbortSignal,theme:"blood"|"green"="blood",startAt?:number){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('m-blood-drain');svg.dataset.flow='target-to-caster';svg.dataset.theme=theme;svg.setAttribute('aria-hidden','true');
 Object.assign(svg.style,{position:'fixed',inset:'0',width:'100vw',height:'100dvh',pointerEvents:'none',zIndex:'108',overflow:'visible'});
 const ns='http://www.w3.org/2000/svg',make=(tag:string,attributes:Record<string,string>)=>{const node=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);svg.append(node);return node};
 const green=theme==='green';
 const veil=make('path',{fill:'none',stroke:green?'#064b16':'#6b102b','stroke-width':'13',opacity:'.35','stroke-linecap':'round'}),thread=make('path',{fill:'none',stroke:green?'#17d52f':'#b52547','stroke-width':'4','stroke-linecap':'round'});
 const sparks=Array.from({length:15},(_,i)=>make('ellipse',{rx:String(3+i%3),ry:String(2+i%2),fill:i%3?(green?'#13d92c':'#b71e40'):(green?'#b4ff4a':'#ff8d9b')}));
 const impact=make('ellipse',{rx:'18',ry:'9',fill:'none',stroke:green?'#39ed45':'#d14161','stroke-width':'3'}),heal=make('ellipse',{rx:'20',ry:'10',fill:'none',stroke:green?'#85ff34':'#ff647e','stroke-width':'3'});
 document.body.append(svg);let frame=0;const started=startAt??performance.now();
 const done=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',done);svg.remove()};
 const draw=(now:number)=>{if(signal.aborted||!svg.isConnected){done();return}const t=Math.max(0,Math.min(1,(now-started)/duration)),a=from(),b=to();if(!a||!b){done();return}
 const sx=a.x+a.width/2,sy=a.y+a.height*.6,tx=b.x+b.width/2,ty=b.y+b.height*.6,dx=tx-sx,dy=ty-sy,len=Math.hypot(dx,dy)||1,bend=Math.min(100,len*.22),board=document.querySelector(".m-board-svg")?.getBoundingClientRect(),midX=(sx+tx)/2,midY=(sy+ty)/2,sign=board&&((board.x+board.width/2-midX)*(-dy/len)+(board.y+board.height/2-midY)*(dx/len))<0?-1:1,cx=midX-dy/len*bend*sign,cy=midY+dx/len*bend*sign;
 const path=`M${sx} ${sy}Q${cx} ${cy} ${tx} ${ty}`;veil.setAttribute('d',path);thread.setAttribute('d',path);const alpha=Math.min(1,t*8,(1-t)*5);veil.setAttribute('opacity',String(alpha*.3));thread.setAttribute('opacity',String(alpha*.7));
 sparks.forEach((dot,i)=>{const p=(t-i*.018)/.58;if(p<0||p>1){dot.setAttribute('opacity','0');return}const q=1-p,x=q*q*sx+2*q*p*cx+p*p*tx,y=q*q*sy+2*q*p*cy+p*p*ty;dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y+Math.sin(p*12+i)*5));dot.setAttribute('opacity',String(Math.min(1,p*12,(1-p)*10)));dot.setAttribute('transform',`rotate(${Math.atan2(dy,dx)*180/Math.PI},${x},${y})`)});
 impact.setAttribute('cx',String(sx));impact.setAttribute('cy',String(sy));impact.setAttribute('rx',String(15+t*14));impact.setAttribute('opacity',String(Math.max(0,1-t*3)));heal.setAttribute('cx',String(tx));heal.setAttribute('cy',String(ty));heal.setAttribute('rx',String(13+Math.sin(Math.max(0,t-.3)*Math.PI)*19));heal.setAttribute('opacity',String(t>.3?Math.sin((t-.3)/.7*Math.PI):0));
 if(t<1)frame=requestAnimationFrame(draw);else done();
 };signal.addEventListener('abort',done,{once:true});draw(performance.now());return done;
}
