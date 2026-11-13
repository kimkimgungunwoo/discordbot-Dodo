type AugmentInfo={name:string;owner:string;tier:string;tierLabel:string;description:string;timing:string;notes:string[]};
/** Read-only hover help, independent of turn ownership or animation locks. */
export class AugmentTooltip {
 private layer?:HTMLDivElement;
 private key="";
 private dismissedKey="";
 private anchor?:HTMLElement;
 private frame=0;
 private timer?:ReturnType<typeof setTimeout>;
 constructor(private root:HTMLElement,private describe:(button:HTMLElement)=>AugmentInfo|null){
  root.addEventListener("pointerover",event=>{if(event.pointerType==="touch")return;const button=(event.target as Element).closest<HTMLElement>("[data-owned-seat]");if(button)this.show(button);});
  root.addEventListener("pointerout",event=>{const button=(event.target as Element).closest("[data-owned-seat]");if(!button||button.contains(event.relatedTarget as Node)||this.layer?.contains(event.relatedTarget as Node))return;if(button instanceof HTMLElement&&button.dataset.focus===this.dismissedKey)this.dismissedKey="";this.scheduleHide();});
  root.addEventListener("focusin",event=>{const button=(event.target as Element).closest<HTMLElement>("[data-owned-seat]");if(button)this.show(button);});
  root.addEventListener("focusout",()=>this.scheduleHide());
  root.addEventListener("click",()=>this.hide(),true);
  document.addEventListener("keydown",event=>{if(event.key==="Escape"){this.dismissedKey=this.key;this.hide();}});
 }
 private scheduleHide(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.hide(),120);}
 show(button:HTMLElement){
  clearTimeout(this.timer);
  if(button.dataset.focus===this.dismissedKey)return;
  this.dismissedKey="";
  if(this.key===button.dataset.focus&&this.layer)return;
  this.hide();const info=this.describe(button);if(!info)return;
  this.key=button.dataset.focus??"";this.anchor=button;
  const layer=document.createElement("div");this.layer=layer;layer.id="m-augment-tooltip";layer.className=`m-augment-tooltip tier-${info.tier}`;layer.setAttribute("role","tooltip");
  const owner=document.createElement("small"),title=document.createElement("strong"),timing=document.createElement("span"),description=document.createElement("p");
  owner.textContent=`${info.owner} · ${info.tierLabel}`;title.textContent=info.name;timing.textContent=info.timing;description.textContent=info.description;layer.append(owner,title,timing,description);
  const notes=info.notes.filter(note=>note.trim()!==info.description.trim());
  if(notes.length){const list=document.createElement("ul");for(const note of notes){const item=document.createElement("li");item.textContent=note;list.append(item);}layer.append(list);}
  layer.addEventListener("pointerenter",()=>clearTimeout(this.timer));layer.addEventListener("pointerleave",()=>this.scheduleHide());
  button.setAttribute("aria-describedby",layer.id);document.body.append(layer);
  const track=()=>{
   if(!this.layer)return;
   const current=[...this.root.querySelectorAll<HTMLElement>("[data-owned-seat]")].find(el=>el.dataset.focus===this.key);
   if(!current||this.root.querySelector('[aria-modal="true"]')){this.hide();return;}
   if(current!==this.anchor){this.anchor?.removeAttribute("aria-describedby");this.anchor=current;current.setAttribute("aria-describedby",layer.id);}
   const a=current.getBoundingClientRect(),w=layer.offsetWidth,h=layer.offsetHeight;
   if(a.bottom<0||a.top>innerHeight){this.hide();return;}
   const left=a.left-w-12>=8?a.left-w-12:a.right+w+12<=innerWidth-8?a.right+12:Math.max(8,Math.min(innerWidth-w-8,a.left));
   const top=Math.max(8,Math.min(innerHeight-h-8,a.top));layer.style.left=`${left}px`;layer.style.top=`${top}px`;
   this.frame=requestAnimationFrame(track);
  };track();
 }
 hide(){clearTimeout(this.timer);cancelAnimationFrame(this.frame);this.anchor?.removeAttribute("aria-describedby");this.anchor=undefined;this.layer?.remove();this.layer=undefined;this.key="";}
}
