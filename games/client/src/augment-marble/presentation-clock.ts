/** A single elapsed-time timeline shared by every segment of a state presentation. */
let cursor:number|null=null;
export function resetPresentationClock(){cursor=null;}
export function beginPresentationClock(serverStart?:number){cursor=Math.max(cursor??0,serverStart??performance.now());}
export function effectStart(duration:number){const start=cursor??performance.now();if(cursor!==null)cursor=start+duration;return start;}
export function effectRemaining(start:number,duration:number){return Math.max(0,start+duration-performance.now());}
