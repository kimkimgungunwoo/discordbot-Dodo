import type {Game} from './augment-marble.js';
export interface MoneyTransfer {id:number;from:number|null;to:number|null;amount:number;reason?:string}
type Change={seat:number;delta:number;bank:boolean;reason?:string};
const bankWrites=new WeakSet<object>();
const reasons=new WeakMap<Game,string>();
export function withMoneyReason<T>(g:Game,reason:string,commit:()=>T):T{const old=reasons.get(g);reasons.set(g,reason);try{return commit()}finally{if(old===undefined)reasons.delete(g);else reasons.set(g,old)}}
/** Explicit bank legs cannot pair with another player's cash change. */
export function bankCashChange(g:Game,seat:number,amount:number,reason?:string){if(reason!==undefined){withMoneyReason(g,reason,()=>bankCashChange(g,seat,amount));return;}const player=g.players[seat];bankWrites.add(player);try{player.cash+=amount;}finally{bankWrites.delete(player);}}
/** Observe a validated action's real cash writes, including modifiers and refunds. */
export function captureCashTransfers(g:Game,commit:()=>void,includeReasons=false):Omit<MoneyTransfer,'id'>[]{
 const changes:Change[]=[];
 const restore=g.players.map((player,seat)=>{let cash=player.cash;Object.defineProperty(player,'cash',{configurable:true,enumerable:true,get:()=>cash,set:(value:number)=>{const delta=value-cash;cash=value;if(delta)changes.push({seat,delta,bank:bankWrites.has(player),reason:reasons.get(g)})}});return()=>Object.defineProperty(player,'cash',{value:cash,writable:true,enumerable:true,configurable:true})});
 try{commit()}finally{restore.forEach(reset=>reset())}
 const transfers:Omit<MoneyTransfer,'id'>[]=[];
 while(changes.length){const a=changes.shift()!,b=changes[0];if(!a.bank&&b&&!b.bank&&a.seat!==b.seat&&a.delta*b.delta<0&&a.reason===b.reason){const amount=Math.min(Math.abs(a.delta),Math.abs(b.delta));transfers.push({from:a.delta<0?a.seat:b.seat,to:a.delta>0?a.seat:b.seat,amount,...(includeReasons&&a.reason?{reason:a.reason}:{})});a.delta-=Math.sign(a.delta)*amount;b.delta-=Math.sign(b.delta)*amount;if(!b.delta)changes.shift();if(a.delta)changes.unshift(a)}else transfers.push({from:a.delta<0?a.seat:null,to:a.delta>0?a.seat:null,amount:Math.abs(a.delta),...(includeReasons&&a.reason?{reason:a.reason}:{})})}
 return transfers;
}
