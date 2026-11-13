import {COLORS,type View} from '../../../shared/augment-marble';
/** All viewers reveal the server's one persisted permutation, against the same clock. */
export async function showOrderDraw(view:View,remaining:number,signal:AbortSignal){
 const order=view.game.turnOrder;if(!order||remaining<=0||signal.aborted)return;
 const overlay=document.createElement('div');overlay.className='m-order-draw';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','턴 순서 제비뽑기');
 const panel=document.createElement('section'),title=document.createElement('h2');title.textContent='순서 뽑기';panel.append(title);
 const cards=document.createElement('div');cards.className='m-order-tickets';const labels:HTMLElement[]=[];
 view.game.players.forEach((player,seat)=>{const card=document.createElement('article');card.className='m-order-ticket';card.dataset.drawSeat=String(seat);card.style.setProperty('--seat',COLORS[seat]);card.style.setProperty('--delay',`${seat*90}ms`);const name=document.createElement('strong');name.textContent=player.name;const number=document.createElement('b');number.textContent='?';labels.push(number);card.append(name,number);cards.append(card)});panel.append(cards);
 const result=document.createElement('ol');result.className='m-order-result';for(const seat of order){const li=document.createElement('li');li.style.setProperty('--seat',COLORS[seat]);li.textContent=view.game.players[seat].name;result.append(li)}panel.append(result);overlay.append(panel);document.body.append(overlay);
 const elapsed=3600-remaining,started=performance.now();
 await new Promise<void>(resolve=>{let frame=0;const done=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',done);overlay.remove();resolve()};const draw=(now:number)=>{if(signal.aborted){done();return}const t=elapsed+now-started;
 labels.forEach((label,seat)=>{const rank=order.indexOf(seat);const reveal=t>=950+rank*350;label.textContent=reveal?`${rank+1}`:String(1+(Math.floor(t/75)+seat)%order.length);label.parentElement!.classList.toggle('revealed',reveal)});overlay.classList.toggle('complete',t>=2450);if(t<3600)frame=requestAnimationFrame(draw);else done()};signal.addEventListener('abort',done,{once:true});draw(started)});
}
