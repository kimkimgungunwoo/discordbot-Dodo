/** A single elapsed-time timeline shared by every segment of a state presentation. */
let cursor:number|null=null;
export function resetPresentationClock(){cursor=null;}
export function beginPresentationClock(serverStart?:number){cursor=serverStart??Math.max(cursor??0,performance.now());}
export function effectStart(duration:number){const start=cursor??performance.now();if(cursor!==null)cursor=start+duration;return start;}
export function effectRemaining(start:number,duration:number){return Math.max(0,start+duration-performance.now());}
/** Wait on the shared timeline, so pauses between segments (dice, hop gaps) do not push later segments into the past. */
export function timelineDelay(ms:number){return effectRemaining(effectStart(ms),ms);}
