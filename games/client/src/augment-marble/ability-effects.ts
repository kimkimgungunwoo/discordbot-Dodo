import { bloodDrain } from "./drain-effect";
import { AUGMENT_CATALOG } from "../../../shared/augment-marble-augments";
import type { AbilityEvent } from "../../../shared/augment-marble-runtime";
import { abilityLabel } from "./copy";

export function captionSeat(event:AbilityEvent){return event.target!==undefined&&["steal","kick","trip","poison","trap"].includes(event.visual)?event.target:event.actor;}
/** Harmful effects follow their victim; the caption explicitly identifies the source. */
export class AbilityEffects {
  private match = "";
  private cursor = 0;
  private layers = new Set<HTMLElement>();
  constructor(private readonly root: HTMLElement) {}
  baseline(match: string, events: readonly AbilityEvent[]) { this.clear(); this.match=match;this.cursor=events.at(-1)?.id??0; }
  take(match:string,events:readonly AbilityEvent[]){if(match!==this.match){this.baseline(match,events);return []}const fresh=events.filter(e=>e.id>this.cursor&&e.ability!=="dice");this.cursor=Math.max(this.cursor,events.at(-1)?.id??0);return fresh;}
  clear(){for(const layer of this.layers)layer.remove();this.layers.clear();}
  async play(event:AbilityEvent,signal:AbortSignal,names:readonly string[]=[]){
    if(signal.aborted||event.ability==="dice")return;
    const definition=AUGMENT_CATALOG.find(a=>a.id===event.ability),label=definition?abilityLabel(definition):({revisit:"재방문 특혜",tranquilizer:"마취총",steal:"모기",gas:"방귀쟁이",revival:"부활",subsidy:"근로장려금",trap:"덫",poison:"신지드"} as Record<string,string>)[event.ability]??"능력 발동";
    const seat=captionSeat(event),harmful=seat!==event.actor;
    const anchor=(seat:number)=>document.querySelector<HTMLElement>(`[data-moving-seat="${seat}"],[data-flying-seat="${seat}"],[data-portal-seat="${seat}"]`)??this.root.querySelector<SVGImageElement>(`[data-token="${seat}"]`);
    const stage=this.root.querySelector<HTMLElement>(".m-board-stage"),subject=anchor(seat);
    if(stage&&subject){const rect=subject.getBoundingClientRect(),box=stage.getBoundingClientRect();if(subject.hasAttribute('data-token')&&(rect.left<box.left+25||rect.right>box.right-25))stage.scrollLeft+=rect.left+rect.width/2-(box.left+box.width/2);}
    const duration=Math.min(1700,Math.max(1100,650+event.caption.length*20));
    const layer=document.createElement("div");layer.className=`m-ability-fx fx-${event.visual}`;layer.dataset.actor=String(event.actor);layer.dataset.ability=event.ability;layer.dataset.anchorSeat=String(seat);layer.style.setProperty("--caption-duration",`${duration}ms`);
    const caption=document.createElement("span");caption.className="m-ability-caption";const title=document.createElement("strong");title.textContent=`${seat+1}P${names[seat]?` ${names[seat]}`:""} · ${label}`;const description=document.createElement("span");description.textContent=event.caption;caption.append(title);
    if(harmful){const source=document.createElement("span");source.className="m-ability-source";source.textContent=`가해: ${event.actor+1}P${names[event.actor]?` ${names[event.actor]}`:""}`;caption.append(source);}
    caption.append(description);layer.append(caption);
    const targets=[{node:layer,seat}];
    const addParticles=(node:HTMLElement)=>{const ring=document.createElement('b');ring.className='m-ability-ring';node.append(ring);for(let i=0;i<8;i++){const dot=document.createElement('i'),angle=i*Math.PI/4;dot.style.setProperty('--dx',`${Math.round(Math.cos(angle)*32)}px`);dot.style.setProperty('--dy',`${Math.round(Math.sin(angle)*24)}px`);node.append(dot)}};
    addParticles(layer);
    if(event.target!==undefined&&event.target!==seat){const hit=document.createElement('div');hit.className=`m-ability-fx m-ability-hit fx-${event.visual}`;hit.dataset.anchorSeat=String(event.target);addParticles(hit);targets.push({node:hit,seat:event.target})}
    for(const target of targets){document.body.append(target.node);this.layers.add(target.node)}
    const cards=[...this.root.querySelectorAll<HTMLElement>(`[data-owned-seat="${event.actor}"]`)].filter(el=>el.dataset.ability===event.ability||el.dataset.effect===definition?.effect||el.dataset.effect===event.ability);for(const card of cards)card.classList.add('ability-active');
    const rentNode=event.rentChange?this.root.querySelector(`[data-rent-tile="${event.tile}"]`):null;if(rentNode){rentNode.classList.add("m-toll-raised");layer.dataset.rentBefore=String(event.rentChange!.before);layer.dataset.rentAfter=String(event.rentChange!.after);}
    const drain=event.target!==undefined&&["vladimir","exploit","mosquito"].includes(event.ability)?bloodDrain(()=>anchor(event.target!)?.getBoundingClientRect(),()=>anchor(event.actor)?.getBoundingClientRect(),duration,signal):undefined;
    if(drain){layer.classList.add('m-drain-caster');layer.dataset.drainTarget=String(event.target);}
    const panel=this.root.querySelector<HTMLElement>('.m-effect-current');if(panel){const text=document.createElement('span');text.textContent=event.caption;panel.replaceChildren(text)}
    let frame=0;
    const track=()=>{if(!layer.isConnected)return;for(const target of targets){const token=anchor(target.seat),fallback=this.root.querySelector(`[data-landing-anchor="${event.tile}"]`),rect=(token??fallback)?.getBoundingClientRect();if(!rect)continue;target.node.style.left=`${rect.left+rect.width/2}px`;target.node.style.top=`${rect.top}px`;if(target.node===layer){const w=caption.offsetWidth,center=rect.left+rect.width/2,left=Math.max(12,Math.min(innerWidth-12-w,center-w/2));layer.style.setProperty('--caption-offset',`${left-(center-w/2)}px`)}}frame=requestAnimationFrame(track)};track();
    await new Promise<void>(resolve=>{const done=()=>{rentNode?.classList.remove("m-toll-raised");drain?.();clearTimeout(timer);cancelAnimationFrame(frame);signal.removeEventListener('abort',done);for(const {node} of targets){node.remove();this.layers.delete(node)}for(const card of cards)card.classList.remove('ability-active');resolve()};const timer=setTimeout(done,duration);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done()});
  }
}
