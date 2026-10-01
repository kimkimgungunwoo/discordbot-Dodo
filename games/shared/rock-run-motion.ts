import { REFERENCE as R } from './rock-run-reference';
import { MOTION as M } from './rock-run-config';
// Port of SetGame.as (normal mode): gJump, gShoot, gRope and gSpin.
// Values here are pixels per ORIGINAL 30 Hz frame, not seconds.
export type MotionMode = 'run' | 'jump' | 'shoot' | 'rope' | 'spin';
export interface Motion {
  mode: MotionMode; y: number; dy: number; spinGravity: boolean;
  hook: { x: number; y: number } | null;
}
export function pressMotion(m: Motion, x: number) {
  if (m.mode === 'run') { m.mode='jump'; m.dy=M.jump; m.spinGravity=false; }
  else if (m.mode === 'jump' || m.mode === 'spin' || m.mode === 'shoot') { m.mode='shoot'; m.hook={x:x+R.muzzle.x,y:m.y+R.muzzle.y}; }
}
export function catchMotion(m: Motion) {
  m.mode='rope';m.dy=M.catchVelocity;
  // Keep the actual contact point; swing equations use this anchor unchanged.
}
function spin(m:Motion) {m.mode='spin';m.hook=null;m.dy=M.releaseVelocity;m.spinGravity=true;}
export function frameMotion(m:Motion, held:boolean, hookScreenX:number, hookAngle:number) {
  if(m.mode==='run')return;
  if(m.mode==='rope') {
    const hookY=m.hook!.y;
    if(held) {
      if(m.dy>M.ropeUpLimit)m.dy-=M.gravity;
      if(m.y<hookY+M.releaseHeight)spin(m);
    } else if(m.dy<M.ropeDownLimit)m.dy+=M.gravity;
    // Preserve the original callback order, including gSpin within this callback.
    m.y+=m.dy;
    if(hookAngle*180/Math.PI+M.bodyAngleOffset < M.releaseAngle || hookScreenX<M.releaseScreenX)spin(m);
  } else {
    if(m.dy>M.fallingLimit)m.dy-=m.spinGravity?M.releaseGravity:M.gravity;
    m.y-=m.dy;
    if(m.dy<0&&m.mode!=='shoot')m.mode='jump';
  }
}
