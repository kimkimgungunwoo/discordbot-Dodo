/** One turn marker follows the current piece through walking, flight and portal overlays. */
export class TurnPointer {
 private seat:number|null=null;
 private marker=document.createElement('div');
 constructor(private root:HTMLElement){this.marker.className='m-turn-pointer';this.marker.setAttribute('aria-hidden','true');this.marker.innerHTML='<svg viewBox="0 0 32 30" width="30" height="28"><path d="M10 2h12v12h8L16 28 2 14h8z" fill="#ffdc45" stroke="#171714" stroke-width="2.5" stroke-linejoin="round"/></svg>';document.body.append(this.marker);const track=()=>{const seat=this.seat,token=seat===null?null:document.querySelector<HTMLElement>(`[data-moving-seat="${seat}"],[data-flying-seat="${seat}"],[data-portal-seat="${seat}"]`)??this.root.querySelector<SVGImageElement>(`[data-token="${seat}"]`);if(!token){this.marker.hidden=true}else{const r=token.getBoundingClientRect(),stage=this.root.querySelector('.m-board-stage')?.getBoundingClientRect();this.marker.hidden=!r.width||r.bottom<0||r.top>innerHeight||!!stage&&(r.right<stage.left||r.left>stage.right);this.marker.style.left=`${r.x+r.width/2}px`;this.marker.style.top=`${r.y-4}px`;}requestAnimationFrame(track)};track();}
 set(seat:number|null){this.seat=seat;this.marker.dataset.turnSeat=seat===null?'':String(seat);}
}
