import type { AbilityEvent } from '../../../shared/augment-marble-runtime';

/** Distinct silhouettes around the affected token, separate from its overhead caption. */
export function statusEffect(event:AbilityEvent){
 if(!['trap','poison'].includes(event.visual)||event.flight)return null;
 const node=document.createElement('div');
 const kind=event.visual==='poison'?(event.ability==='gas'?'gas':'poison'):event.ability==='trap'?'trap':'sleep';
 node.className=`m-status-impact status-${kind}`;node.dataset.statusImpact=kind;
 const trap=`<ellipse cx="50" cy="66" rx="34" ry="11" fill="#1b162a" opacity=".35"/><g class="m-trap-jaw jaw-back"><path d="M16 57 Q50 27 84 57 L75 49 71 60 61 49 54 61 45 49 37 60 28 49Z" fill="#d1d7e2" stroke="#372447" stroke-width="3"/></g><g class="m-trap-jaw jaw-front"><path d="M16 61 Q50 91 84 61 L75 69 71 58 61 69 54 57 45 69 37 58 28 69Z" fill="#a5adbf" stroke="#372447" stroke-width="3"/></g><circle class="m-trap-spark" cx="50" cy="58" r="24" fill="none" stroke="#ffe391" stroke-width="4" stroke-dasharray="3 12"/>`;
 const poison=`<ellipse class="m-toxic-pool" cx="50" cy="64" rx="35" ry="13" fill="${kind==='gas'?'#c7b153':'#9edb38'}" stroke="#52662c" stroke-width="2"/>${[0,1,2,3,4].map(i=>`<circle class="m-toxic-bubble" style="--delay:${i*110}ms" cx="${25+i*12}" cy="58" r="${7+i%3*2}" fill="${kind==='gas'?'#b7ae68':'#a8da5a'}" stroke="#52662c" stroke-width="1.5"/>`).join('')}<g class="m-toxic-skull" fill="#eff9ce" stroke="#435425" stroke-width="2"><path d="M39 37 Q37 23 50 23 Q63 23 61 37 L57 42 V47 H43 V42Z"/><circle cx="45" cy="34" r="2.5" fill="#435425"/><circle cx="55" cy="34" r="2.5" fill="#435425"/><path d="M48 43V47 M52 43V47"/></g>`;
 const sleep=`<ellipse cx="50" cy="64" rx="29" ry="10" fill="#b6a1dc" opacity=".45"/><g class="m-sleep-stars" fill="#ffe591" stroke="#73519b" stroke-width="2"><path d="M25 22l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z"/><path d="M75 20l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z"/></g>`;
 node.innerHTML=`<svg viewBox="0 0 100 90" aria-hidden="true">${kind==='trap'?trap:kind==='sleep'?sleep:poison}</svg>`;
 return node;
}
