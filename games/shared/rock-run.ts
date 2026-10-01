import { REFERENCE as R } from './rock-run-reference';
import { RUN_PATTERNS, GENERATED_SETTINGS } from './rock-run-patterns';
import { pressMotion, catchMotion, frameMotion, type Motion } from './rock-run-motion';
import { GAME_SPEED, MOTION_HZ, MOTION_PER_TICK, COUNTDOWN_TICKS, PILLAR_TOP, PILLAR_BOTTOM,
  PILLAR_WIDTH, DEATH_Y, TEMPLATE_TAKEOFF_X, STAGES, MOTION, distancePerMotionFrame, assertPatternSettings } from './rock-run-config';
export { DT, GAME_SPEED, MOTION_SPEED, STAGES, PILLAR_TOP, PILLAR_BOTTOM } from './rock-run-config';
export interface Platform { x: number; end: number; y: number }
export interface Anchor { x: number; width: number }
export interface Coin { x: number; y: number; stage: number; value: number; kind: 'silver' | 'gold' }
export interface Course { platforms: Platform[]; anchors: Anchor[]; coins: Coin[]; ends: number[] }
export type RunMode = 'normal' | 'endless';
export function makeCourse(seed = 1): Course {
  assertPatternSettings(GENERATED_SETTINGS);
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const platforms: Platform[] = [], anchors: Anchor[] = [], coins: Coin[] = [], ends: number[] = [];
  let start = 0;
  STAGES.forEach((stage, si) => {
    const end = start + stage.seconds * stage.speed;
    const stageCoins: Coin[] = [];
    const dx=distancePerMotionFrame(si);
    const choices=RUN_PATTERNS.filter(p=>p.stage===si);
    let bag:typeof choices=[];
    let roof:Platform={x:start,end:start+dx*32,y:R.ground};
    platforms.push(roof);
    let safeLanding=start;
    function silver() {
      // Leave the takeoff and landing arcs clear; ground coins stay on the running path.
      for(let x=Math.max(roof.x+60,safeLanding+40);x<roof.end-dx*2;x+=dx*6)
        stageCoins.push({x,y:R.ground-24,stage:si,value:0,kind:'silver'});
    }
    while(roof.end<end) {
      if(!bag.length){
        bag=[...choices];
        for(let i=bag.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
      }
      const pattern=bag.pop()!;
      // Every template includes a real successful input trace. Keep enough roof for its landing.
      const travel=Math.floor(pattern.inputs.length*MOTION_PER_TICK+1e-8)*dx+TEMPLATE_TAKEOFF_X;
      const roofFrames=pattern.anchors.length ? (random()<.45?16:24) : (random()<.45?8:20);
      const roofLength=Math.max(dx*roofFrames,travel-pattern.gap+dx*6);
      const edge=roof.end,landing=edge+pattern.gap;
      if(landing+roofLength+dx*20>end){roof.end=end+dx*2;silver();break;}
      silver();
      for(const x of pattern.anchors)anchors.push({x:edge+x,width:PILLAR_WIDTH});
      for(const coin of pattern.gold)stageCoins.push({...coin,x:edge+coin.x,stage:si,value:0,kind:'gold'});
      roof={x:landing,end:landing+roofLength,y:R.ground};
      platforms.push(roof);safeLanding=edge+travel;
    }
    // Gold carries triple weight; integer allocation preserves each stage's exact 70% coin budget.
    const units=stage.budget*7/50,totalWeight=stageCoins.reduce((n,c)=>n+(c.kind==='gold'?3:1),0);
    let usedWeight=0,usedUnits=0;
    for(const coin of stageCoins){
      usedWeight+=coin.kind==='gold'?3:1;
      const nextUnits=Math.floor(units*usedWeight/totalWeight);
      coin.value=(nextUnits-usedUnits)*5;usedUnits=nextUnits;
    }
    coins.push(...stageCoins); ends.push(end); start = end;
  });
  return { platforms, anchors, coins, ends };
}
// Segment/AABB intersection, including a shot starting inside a pillar body.
function stripIntersection(from:{x:number;y:number},to:{x:number;y:number},a:Anchor):number|null {
  return boxIntersection(from,to,a.x-a.width/2,a.x+a.width/2,PILLAR_TOP,PILLAR_BOTTOM);
}
function boxIntersection(from:{x:number;y:number},to:{x:number;y:number},left:number,right:number,top:number,bottom:number):number|null {
  let enter=0,exit=1;
  for(const [origin,delta,min,max] of [[from.x,to.x-from.x,left,right],[from.y,to.y-from.y,top,bottom]]) {
    if(Math.abs(delta)<1e-9){if(origin<min||origin>max)return null;continue;}
    const t1=(min-origin)/delta,t2=(max-origin)/delta;
    enter=Math.max(enter,Math.min(t1,t2));exit=Math.min(exit,Math.max(t1,t2));
    if(enter>exit)return null;
  }
  return enter;
}
const courses = new Map<number, Course>();
export function courseFor(seed: number): Course {
  let course = courses.get(seed);
  if (!course) { course = makeCourse(seed); if (courses.size >= 8) courses.delete(courses.keys().next().value!); courses.set(seed, course); }
  return course;
}
interface EndlessCourse extends Course { generatedTo: number; segment: number }
const endlessCourses = new Map<number, EndlessCourse>();
function makeEndlessSegment(seed:number):Course {
  let randomState=seed>>>0;
  const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
  const stage=3,dx=distancePerMotionFrame(stage),length=STAGES[stage].seconds*STAGES[stage].speed;
  // Keep two- and three-pillar chains compact enough to refire while the bird is still high.
  const choices=RUN_PATTERNS.filter(p=>p.stage===stage).map(p=>{
    if(p.anchors.length<2)return p;
    const anchors=p.anchors.map((_,i)=>dx*10+i*dx*20);
    return {...p,anchors,gap:anchors.at(-1)!+dx*16,gold:[]};
  });
  const platforms:Platform[]=[],anchors:Anchor[]=[],coins:Coin[]=[];
  let roof:Platform={x:0,end:dx*32,y:R.ground},safeLanding=0,bag:typeof choices=[];
  platforms.push(roof);
  const silver=()=>{for(let x=Math.max(roof.x+60,safeLanding+40);x<roof.end-dx*2;x+=dx*6)
    coins.push({x,y:R.ground-24,stage,value:0,kind:'silver'});};
  while(roof.end<length){
    if(!bag.length){bag=[...choices];for(let i=bag.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}}
    const pattern=bag.pop()!,travel=Math.floor(pattern.inputs.length*MOTION_PER_TICK+1e-8)*dx+TEMPLATE_TAKEOFF_X;
    const roofFrames=pattern.anchors.length ? (random()<.45?16:24) : (random()<.45?8:20);
    const roofLength=Math.max(dx*roofFrames,travel-pattern.gap+dx*8);
    const edge=roof.end,landing=edge+pattern.gap;
    if(landing+roofLength+dx*20>length){roof.end=length+dx*2;silver();break;}
    silver();
    for(const x of pattern.anchors)anchors.push({x:edge+x,width:PILLAR_WIDTH});
    for(const coin of pattern.gold)coins.push({...coin,x:edge+coin.x,stage,value:0,kind:'gold'});
    roof={x:landing,end:landing+roofLength,y:R.ground};platforms.push(roof);safeLanding=edge+travel;
  }
  return {platforms,anchors,coins,ends:[0,0,0,length,length,length]};
}
export function endlessCourseFor(seed: number, targetX = 0): Course {
  let result = endlessCourses.get(seed);
  if (!result) {
    result={platforms:[],anchors:[],coins:[],ends:Array(6).fill(Infinity),generatedTo:0,segment:0};
    if(endlessCourses.size>=8)endlessCourses.delete(endlessCourses.keys().next().value!);
    endlessCourses.set(seed,result);
  }
  while(result.generatedTo < targetX + 2400 || result.segment===0) {
    const source=makeEndlessSegment((seed+Math.imul(result.segment,0x9e3779b1))>>>0);
    const length=source.ends[3],offset=result.generatedTo;
    result.platforms.push(...source.platforms.map(p=>({x:p.x+offset,end:p.end+offset,y:p.y})));
    result.anchors.push(...source.anchors.map(a=>({...a,x:a.x+offset})));
    result.coins.push(...source.coins.map(c=>({...c,x:c.x+offset})));
    result.generatedTo+=length;result.segment++;
  }
  return result;
}
export interface RunInput { hit: boolean; start?: boolean }
export interface RunState {
  motion: Motion; motionClock: number;
  seed: number; shot: { x: number; y: number } | null;
  tick: number; phase: 'ready' | 'countdown' | 'playing' | 'transition' | 'gameover';
  countdown: number; elapsed: number; stage: number; x: number; y: number; vy: number;
  // Read-only presentation of motion, refreshed by step; never used to reconstruct physics.
  grounded: boolean; held: boolean;
  rope: { anchor: number; x: number; y: number } | null;
  score: number; collected: Set<number>; cleared: boolean; mode: RunMode;
}
export const EMPTY_INPUT: RunInput = { hit: false };
export function createInitialState(seed = 1, mode: RunMode = 'normal'): RunState {
  return { seed, motion:{mode:'run',y:R.ground,dy:0,spinGravity:false,hook:null}, motionClock:0,
    shot: null, tick: 0, phase: 'ready', countdown: 0, elapsed: 0, stage: mode === 'endless' ? 3 : 0, x: 0, y: R.ground, vy: 0,
    grounded: true, held: false,
    rope: null, score: 0, collected: new Set(), cleared: false, mode };
}
export function step(old: RunState, input: RunInput, course = old.mode === 'endless' ? endlessCourseFor(old.seed,old.x) : courseFor(old.seed), gameSpeed = GAME_SPEED): RunState {
  if (old.phase === 'gameover') return old;
  const s = { ...old, shot: old.shot ? { ...old.shot } : null, tick: old.tick + 1, rope: old.rope ? { ...old.rope } : null };
  const pressed = input.hit && !s.held;
  s.held = input.hit;
  if (s.phase === 'ready') { if (input.start) { s.phase = 'countdown'; s.countdown = COUNTDOWN_TICKS; } return s; }
  if (s.phase === 'countdown' || s.phase === 'transition') {
    if (s.phase === 'transition') s.elapsed++;
    if (--s.countdown === 0) s.phase = 'playing';
    return s;
  }
  s.elapsed++;
  const dx = distancePerMotionFrame(s.stage,gameSpeed);
  const m: Motion = {...old.motion, hook:old.motion.hook?{...old.motion.hook}:null};
  s.motion=m;
  if(!input.hit&&m.mode==='shoot'){m.hook=null;m.mode=m.spinGravity?'spin':'jump';}
  if(pressed)pressMotion(m,s.x);
  s.motionClock=old.motionClock+MOTION_PER_TICK;
  while(s.motionClock>=1) {
    s.motionClock--;
    const ropeFrame=m.mode==='rope';
    s.x+=dx;
    const screenX=m.hook?m.hook.x-s.x+R.playerX:Infinity;
    const angle=m.hook?Math.atan2(m.hook.y-(m.y+R.body.y),m.hook.x-(s.x+R.body.x)):0;
    const previousY=m.y;
    frameMotion(m,input.hit,screenX,angle);
    // Sweep the flying hook through each strip so narrow towers cannot be skipped.
    if(m.mode==='shoot'&&m.hook) {
      const from={...m.hook};
      m.hook.x+=MOTION.hookX+dx;m.hook.y+=MOTION.hookY;
      let first=Infinity,anchor=-1;
      course.anchors.forEach((a,i)=> {
        const t=stripIntersection(from,m.hook!,a);
        if(t!==null&&t<first){first=t;anchor=i;}
      });
      if(anchor>=0){
        m.hook.x=from.x+(m.hook.x-from.x)*first;
        m.hook.y=from.y+(m.hook.y-from.y)*first;
        catchMotion(m);
        s.rope={anchor,x:m.hook.x,y:m.hook.y};
      } else if(m.hook.y<0){m.hook=null;m.mode=m.spinGravity?'spin':'jump';}
    }
    const supported=course.platforms.some(p=>s.x+R.foot.right>=p.x&&s.x+R.foot.left<=p.end&&Math.abs(m.y-p.y)<.01);
    if(!ropeFrame&&m.mode!=='rope'&&m.dy<0) {
      const landing=course.platforms.find(p=>s.x+R.foot.right>=p.x&&s.x+R.foot.left<=p.end&&previousY<=p.y&&m.y>=p.y);
      if(landing){m.y=landing.y;m.dy=0;m.mode='run';m.hook=null;m.spinGravity=false;}
    }
    if(m.mode==='run'&&!supported&&m.dy===0&&m.y===previousY){m.mode='jump';m.hook=null;}
    // Die only once the entire bird has fallen below the visible playfield.
    if(m.y>DEATH_Y)s.phase='gameover';
    if(s.phase==='gameover')break;
  }
  s.y=m.y;s.vy=(m.mode==='rope'?m.dy:-m.dy)*MOTION_HZ;
  s.grounded=m.mode==='run';
  s.shot=m.mode==='shoot'&&m.hook?{...m.hook}:null;
  if(m.mode!=='rope')s.rope=null;
  for (let i = 0; i < course.coins.length; i++) {
    const c = course.coins[i];
    if (!s.collected.has(i) && boxIntersection({x:old.x,y:old.y-15},{x:s.x,y:s.y-15},c.x-23,c.x+23,c.y-25,c.y+25)!==null) {
      if (s.collected === old.collected) s.collected = new Set(s.collected);
      s.collected.add(i); s.score += c.value;
    }
  }
  if (s.phase === 'gameover') { s.phase = 'gameover'; s.rope = null; s.shot = null; return s; }
  if (s.mode !== 'endless' && s.x >= course.ends[s.stage]) {
    s.score += STAGES[s.stage].budget / 5;
    if (course.coins.every((c, i) => c.stage !== s.stage || s.collected.has(i))) s.score += STAGES[s.stage].budget / 10;
    if (s.stage === 5) { s.phase = 'gameover'; s.cleared = true; }
    else { s.stage++; s.phase = 'transition'; s.countdown = COUNTDOWN_TICKS; s.rope = null; s.shot = null;
      s.motionClock=0;
      s.y = course.platforms.find(p => p.x <= s.x && p.end > s.x)?.y ?? R.ground;
      s.motion={mode:'run',y:s.y,dy:0,spinGravity:false,hook:null};
      s.vy = 0; s.grounded = true; }
  }
  return s;
}


// Each stage fills its own cell using the generated course's actual boundaries.
export function stageProgress(s: Pick<RunState, 'stage' | 'x' | 'cleared'>, course: Course): number {
  if (s.cleared) return 100;
  const start = s.stage ? course.ends[s.stage - 1] : 0;
  const fraction = Math.max(0, Math.min(1, (s.x - start) / (course.ends[s.stage] - start)));
  return (s.stage + fraction) / (STAGES.length + 1) * 100;
}
