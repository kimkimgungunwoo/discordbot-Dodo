import type {Game} from './augment-marble.js';
export interface MoneyTransfer {id:number;from:number|null;to:number|null;amount:number}
type Change={seat:number;delta:number};
/** Observe a validated action's real cash writes, including modifiers and refunds. */
export function captureCashTransfers(g:Game,commit:()=>void):Omit<MoneyTransfer,'id'>[]{
 const changes:Change[]=[];
 const restore=g.players.map((player,seat)=>{let cash=player.cash;Object.defineProperty(player,'cash',{configurable:true,enumerable:true,get:()=>cash,set:(value:number)=>{const delta=value-cash;cash=value;if(delta)changes.push({seat,delta})}});return()=>Object.defineProperty(player,'cash',{value:cash,writable:true,enumerable:true,configurable:true})});
 try{commit()}finally{restore.forEach(reset=>reset())}
 const transfers:Omit<MoneyTransfer,'id'>[]=[];
 while(changes.length){const a=changes.shift()!,b=changes[0];if(b&&a.seat!==b.seat&&a.delta*b.delta<0){const amount=Math.min(Math.abs(a.delta),Math.abs(b.delta));transfers.push({from:a.delta<0?a.seat:b.seat,to:a.delta>0?a.seat:b.seat,amount});a.delta-=Math.sign(a.delta)*amount;b.delta-=Math.sign(b.delta)*amount;if(!b.delta)changes.shift();if(a.delta)changes.unshift(a)}else transfers.push({from:a.delta<0?a.seat:null,to:a.delta>0?a.seat:null,amount:Math.abs(a.delta)})}
 return transfers;
}
