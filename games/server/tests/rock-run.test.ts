import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, createInitialState, step, courseFor, endlessCourseFor, makeCourse, type RunState, type Course } from '../../shared/rock-run.js';
import { RUN_PATTERNS } from '../../shared/rock-run-patterns.js';
import { RockRunRoom } from '../src/rock-run-room.js';
import { validDefinition } from '../src/protocol.js';

import { searchCrossing } from '../analysis/rock-run-search.js';
import { MOTION_PER_TICK, FIRST_PILLAR_MIN_FRAMES, FIRST_WIRE_MIN_DELAY_TICKS,
  MAX_WIRE_REFIRE_Y, TEMPLATE_TAKEOFF_X, distancePerMotionFrame, assertPatternSettings } from '../../shared/rock-run-config.js';
import { GENERATED_SETTINGS } from '../../shared/rock-run-patterns.js';

const COURSE = courseFor(1);
function crossing(initial: RunState, landing: number, needsWire: boolean, course=courseFor(initial.seed)) {
  const result=searchCrossing(initial,landing,course,{allowWire:needsWire,
    minWireDelayTicks:needsWire?FIRST_WIRE_MIN_DELAY_TICKS:0,maxAirbornePressY:MAX_WIRE_REFIRE_Y});
  assert.notEqual(result.status,'inconclusive','Search budget exhausted; this is not evidence of an impossible crossing');
  return result.status==='found'?result.actions:null;
}
function makePilot() {
  let inputs: boolean[] = [];
  return (s: RunState) => {
    if (s.phase !== 'playing') return { hit: false };
    if (inputs.length) return { hit: inputs.shift()! };
    const c = courseFor(s.seed);
    if (s.grounded) {
      const index = c.platforms.findIndex(p => p.x <= s.x && p.end >= s.x);
      const p = c.platforms[index], next = c.platforms[index + 1];
      if (p && next && next.x > p.end && p.end - s.x < Math.floor(s.motionClock+MOTION_PER_TICK) * distancePerMotionFrame(s.stage) + 2) {
        const wire = c.anchors.some(a => a.x > p.end && a.x < next.x);
        inputs = crossing(s, next.x, wire) ?? [];
        assert.ok(inputs.length, `no crossing at stage ${s.stage + 1}, x=${s.x}, edge=${p.end}, gap=${next.x-p.end}, roof=${next.end-next.x}, clock=${s.motionClock}`);
        return { hit: inputs.shift()! };
      }
    }
    return { hit: false };
  };
}
const definition = { game: 'rock_run', mode: 'SOLO', roomId: '1:2:rock', hostId: '2', p2Id: null, guildId: '1' } as const;

test('endless mode keeps stage four speed and extends forward without laps or a goal', () => {
  const initial=createInitialState(77,'endless'), course=endlessCourseFor(77,0);
  assert.equal(initial.stage,3); assert.equal(initial.mode,'endless');
  assert.ok(course.platforms.length>2&&course.anchors.length>0);
  const next=step({...initial,phase:'playing',motionClock:.99},{hit:false},course);
  assert.equal(next.x,distancePerMotionFrame(3)); assert.equal(next.stage,3); assert.equal(next.phase,'playing');
  const oldEnd=Math.max(...course.platforms.map(p=>p.end));
  const extended=endlessCourseFor(77,oldEnd+10000);
  assert.equal(extended,course);
  assert.ok(Math.max(...extended.platforms.map(p=>p.end))>oldEnd+10000);
  assert.ok(extended.ends.every(Number.isFinite)===false);
});

test('endless keeps playable two- and three-pillar chains across segment seams', () => {
  const seed=913,course=endlessCourseFor(seed,150000),dx=distancePerMotionFrame(3);
  const platforms=course.platforms.filter((p,i,a)=>i===0||p.x!==a[i-1].x||p.end!==a[i-1].end).sort((a,b)=>a.x-b.x);
  const chainCounts=new Set<number>();
  for(let i=0;i<platforms.length-1;i++){
    const p=platforms[i],next=platforms[i+1];
    if(next.x<=p.end)continue;
    const between=course.anchors.filter(a=>a.x>p.end&&a.x<next.x);
    assert.ok(between.length<=3,`too many endless pillars at ${p.end}`);
    if(between.length>=2){chainCounts.add(between.length);assert.ok(Math.abs(between[0].x-p.end-dx*10)<.01);
      for(let a=1;a<between.length;a++)assert.ok(Math.abs(between[a].x-between[a-1].x-dx*20)<.01);}
    const initial={...createInitialState(seed,'endless'),phase:'playing' as const,x:p.end-8,y:p.y};
    const actions=crossing(initial,next.x,between.length>0,course);
    assert.ok(actions,`unplayable endless gap at ${p.end}`);
    if(between.length>=2){let state:RunState=initial;
      for(const hit of actions!){
        if(hit&&!state.held&&!state.grounded)assert.ok(state.y<=300,`low endless refire y=${state.y} at ${state.x}`);
        state=step(state,{hit},course);
      }
    }
  }
  assert.deepEqual(chainCounts,new Set([2,3]),'endless should retain both two- and three-pillar chains');
});

test('wire landings always provide a running buffer before the next jump', () => {
  for(const course of [courseFor(1),courseFor(42),endlessCourseFor(913,150000)]){
    const platforms=[...course.platforms].sort((a,b)=>a.x-b.x);
    for(let i=1;i<platforms.length;i++){
      const previous=platforms[i-1],landing=platforms[i];
      if(landing.x<=previous.end||!course.anchors.some(a=>a.x>previous.end&&a.x<landing.x))continue;
      const stage=course.ends.every(x=>x===Infinity)?3:course.ends.findIndex(end=>landing.x<end);
      assert.ok(landing.end-landing.x>=distancePerMotionFrame(stage)*16,
        `short post-wire roof at ${landing.x}: ${landing.end-landing.x}`);
    }
  }
});

test('endless server result ranks elapsed milliseconds instead of course score', () => {
  const room=new RockRunRoom({...definition,runMode:'endless'}), peer={id:'2',name:'tester',send:()=>{}};
  room.join(peer); room.state={...room.state,phase:'playing',elapsed:740,y:1000,motionClock:.99,
    motion:{mode:'jump',y:1000,dy:-1,spinGravity:false,hook:null},score:99999};
  room.input(peer,{matchId:room.matchId,tick:1,seq:1,input:{x:0,y:0,jump:false,hit:false}});
  assert.equal(room.result?.runMode,'endless');
  assert.equal(room.result?.score.left,12350);
  assert.equal(room.result?.stage,4);
});

test('fixed course has six exact score budgets totalling 100,000', () => {
  let max = 0;
  STAGES.forEach((s, stage) => {
    const coins = COURSE.coins.filter(c => c.stage === stage);
    assert.ok(coins.every(c => Number.isSafeInteger(c.value) && c.value > 0));
    assert.equal(coins.reduce((n,c) => n+c.value,0), s.budget * 7 / 10);
    max += s.budget;
  });
  assert.equal(max,100000);
});

test('server and client complete the seeded six stages with identical scores', () => {
  const room=new RockRunRoom(definition);
  const peer={id:'2',name:'tester',send:()=>{}}; room.join(peer);
  let client=createInitialState(room.seed), wires=0;
  const pilot=makePilot();
  for(let tick=1;tick<=20000 && client.phase!=='gameover';tick++) {
    const action={...pilot(client),start:tick===1};
    const previous=client;
    client=step(client,action);
    if(!previous.rope&&client.rope) wires++;
    room.input(peer,{matchId:room.matchId,tick,seq:tick,input:{...action,x:0,y:0,jump:false}});
  }
  assert.equal(client.cleared,true); assert.ok(wires>20);
  assert.ok(client.elapsed/60 > 220 && client.elapsed/60 < 260, `clear time ${client.elapsed/60}s`);
  assert.deepEqual(room.state,client);
  assert.equal(room.result?.score.left,client.score);
  assert.equal(room.result?.cleared,true);
  const score=room.result!.score.left;
  room.report(peer,{score:{left:100000,right:0}});
  assert.equal(room.result?.score.left,score);
});
test('no input falls into the first canyon; forged scores and spectator input do nothing', () => {
  assert.equal(validDefinition(definition),true);
  assert.equal(validDefinition({...definition,mode:'CPU'}),false);
  const room=new RockRunRoom(definition), host={id:'2',name:'host',send:()=>{}}, viewer={id:'3',name:'viewer',send:()=>{}};
  room.join(host); room.join(viewer);
  room.report(host,{score:{left:100000,right:0}}); assert.equal(room.result,null);
  room.input(viewer,{tick:1,seq:1,input:{x:0,y:0,jump:false,hit:true,start:true}});assert.equal(room.history.length,0);
  for(let tick=1;tick<1000&&!room.result;tick++)room.input(host,{tick,seq:tick,input:{x:0,y:0,jump:false,hit:false,start:tick===1}});
  const result=(room as RockRunRoom).result;
  assert.equal(result?.cleared,false);assert.equal(result?.stage,1);
});

test('random courses preserve budgets and every sampled gap has a real input solution', () => {
  assert.deepEqual(makeCourse(42),makeCourse(42));
  assert.notDeepEqual(makeCourse(42).platforms,makeCourse(99).platforms);
  for (const seed of [1,2,3,42,99,12345,2147483646]) {
    const c=courseFor(seed);
    for(let stage=0;stage<6;stage++) {
      assert.equal(c.coins.filter(c=>c.stage===stage).reduce((n,c)=>n+c.value,0),STAGES[stage].budget*7/10);
      const ps=c.platforms.filter(p=>p.x >= (c.ends[stage-1]??0) && p.x<c.ends[stage]);
      for(let i=0;i<ps.length-1;i++) {
        const p=ps[i],next=ps[i+1];
        const initial={...createInitialState(seed),phase:'playing' as const,stage,x:p.end-8,y:p.y};
        const wire=c.anchors.some(a=>a.x>p.end&&a.x<next.x);
        assert.ok(crossing(initial,next.x,wire),`seed=${seed} stage=${stage} edge=${p.end}`);
      }
    }
  }
});

test('complete consecutive jumps and distinct pillar chains across multiple seeds', () => {
  for(const seed of [1,42,99]) {
    let s=createInitialState(seed), chain=new Set<number>(), maxChain=0, quickJumps=0, lastLanding=-999;
    const pilot=makePilot(), course={...courseFor(seed),coins:[]};
    for(let tick=1;tick<20000&&s.phase!=='gameover';tick++) {
      const input={...pilot(s),start:tick===1}, old=s;
      s=step(s,input,course);
      if(s.rope)chain.add(s.rope.anchor);
      maxChain=Math.max(maxChain,chain.size);
      if(s.grounded&&!old.grounded){chain.clear();lastLanding=tick;}
      if(old.grounded&&!s.grounded&&input.hit&&tick-lastLanding<25)quickJumps++;
    }
    assert.ok(s.cleared,`seed ${seed} must finish the whole course at x=${s.x} y=${s.y} stage=${s.stage}`);
    assert.ok(maxChain>=2,`seed ${seed} must use two distinct pillars without landing`);
    assert.ok(quickJumps>0);
  }
});

test('runner audio emits cues once per transition and respects unchanged snapshots', async () => {
  const { playRunSounds }=await import('../../client/src/rock-run/audio.js');
  const events:unknown[]=[];
  const audio={play:(e:unknown)=>events.push(e),playArrowVolley:(n:number)=>events.push(n)};
  const before:RunState={...createInitialState(),phase:'playing'};
  const after={...before,tick:1,grounded:false,vy:-100,shot:{x:30,y:200}};
  playRunSounds(audio as any,before,after);
  assert.equal(events.length,2);
  playRunSounds(audio as any,after,after);
  assert.equal(events.length,2);
});

test('progress stays in its stage cell until the actual boundary', async () => {
  const { stageProgress }=await import('../../shared/rock-run.js');
  for(let stage=0;stage<6;stage++) {
    const start=stage?COURSE.ends[stage-1]:0,end=COURSE.ends[stage];
    const progress=(x:number)=>stageProgress({stage,x,cleared:false},COURSE);
    assert.ok(Math.abs(progress(start)-stage/7*100)<1e-9);
    assert.ok(Math.abs(progress((start+end)/2)-(stage+.5)/7*100)<1e-9);
    assert.ok(progress(end-1)<(stage+1)/7*100);
    assert.ok(Math.abs(progress(end+100)-(stage+1)/7*100)<1e-9);
  }
  assert.equal(stageProgress({stage:5,x:COURSE.ends[5],cleared:true},COURSE),100);
});

test('original jump follows frame-by-frame dy and ignores button duration', async () => {
  const { pressMotion,frameMotion }=await import('../../shared/rock-run-motion.js');
  const a={mode:'run' as const,y:365,dy:0,spinGravity:false,hook:null};
  const b={...a};pressMotion(a,0);pressMotion(b,0);
  // SetGame: dy -= 3.5, y -= dy, once per original frame.
  const positions=[338.5,315.5,296,280,267.5,258.5,253,251,252.5];
  for(const expected of positions){frameMotion(a,true,Infinity,0);frameMotion(b,false,Infinity,0);assert.equal(a.y,expected);assert.equal(b.y,expected);}
});

test('rope equations stay unchanged and spin allows immediate refiring', async () => {
  const {pressMotion,catchMotion,frameMotion}=await import('../../shared/rock-run-motion.js');
  const m:import('../../shared/rock-run-motion.js').Motion={mode:'shoot',y:300,dy:0,spinGravity:false,hook:{x:400,y:100}};
  catchMotion(m);assert.deepEqual(m.hook,{x:400,y:100});assert.equal(m.dy,15);
  frameMotion(m,true,380,-1);assert.equal(m.dy,11.5);assert.equal(m.y,311.5);
  frameMotion(m,false,365,-1);assert.equal(m.dy,15);assert.equal(m.y,326.5);assert.equal(m.mode,'rope');
  frameMotion(m,true,69,-1);assert.equal(m.mode,'spin');assert.equal(m.dy,45);assert.equal(m.hook,null);
  const airborne={...m};pressMotion(airborne,0);assert.equal(airborne.mode,'shoot');assert.equal(airborne.dy,45);
  for(let i=0;i<9;i++)frameMotion(m,false,Infinity,0);
  assert.equal(m.mode,'jump');assert.equal(m.dy,-2.25);
  pressMotion(m,100);assert.equal(m.mode,'shoot');
});

test('horizontal speed leaves original frame cadence and vertical equations unchanged', () => {
  const course={platforms:[],anchors:[],coins:[],ends:[Infinity]};
  let s:RunState={...createInitialState(),phase:'playing'};
  s=step(s,{hit:true},course,1.1);assert.equal(s.y,365);
  s=step(s,{hit:false},course,1.1);assert.equal(s.y,338.5);
  assert.equal(s.x,15);
  assert.equal(s.motion?.dy,26.5);
});

test('wire attaches to both upper and lower pillar body', () => {
  const course={platforms:[],anchors:[{x:300,width:210}],coins:[],ends:[Infinity]};
  const fire=(y:number)=>step({...createInitialState(),phase:'playing',grounded:false,held:true,motionClock:.9,
    motion:{mode:'shoot',y:300,dy:0,spinGravity:false,hook:{x:200,y}}}, {hit:true},course);
  assert.equal(fire(150).motion?.mode,'rope');
  assert.equal(fire(300).motion?.mode,'rope');assert.equal(fire(300).rope?.y,300);
});

test('original frame ordering and 4px feet bounds are retained', async () => {
  const {frameMotion}=await import('../../shared/rock-run-motion.js');
  const m:import('../../shared/rock-run-motion.js').Motion={mode:'rope',y:170,dy:-20,spinGravity:false,hook:{x:500,y:125}};
  frameMotion(m,true,500,-1);assert.equal(m.mode,'spin');assert.equal(m.y,215);assert.equal(m.dy,45);
  const course={platforms:[{x:0,end:100,y:365}],anchors:[],coins:[],ends:[Infinity]};
  const move=(x:number)=>step({...createInitialState(),phase:'playing',x,motionClock:.9},{hit:false},course,1.1);
  assert.equal(move(87).phase,'playing');
  assert.equal(move(88).phase,'playing');assert.equal(move(88).grounded,false);
});

test('speed multiplier preserves the trajectory at equal original frame counts', () => {
  const course={platforms:[],anchors:[],coins:[],ends:[Infinity]};
  function trace(rate:number) {
    let s:RunState={...createInitialState(),phase:'playing'};
    const positions:number[][]=[];
    for(let tick=0;positions.length<12&&tick<100;tick++) {
      const previous=s.x;s=step(s,{hit:tick===0},course,rate);
      if(s.x!==previous)positions.push([s.y,s.motion!.dy]);
    }
    assert.equal(positions.length,12);return positions;
  }
  assert.deepEqual(trace(1),trace(1.1));assert.deepEqual(trace(1),trace(1.5));
});

test('narrow towers stay inside canyons with room for long swings', () => {
  for(let stage=0;stage<6;stage++) {
    const start=COURSE.ends[stage-1]??0;
    for(const a of COURSE.anchors.filter(a=>a.x>=start&&a.x<COURSE.ends[stage])) {
      assert.equal(a.width,110);
      assert.ok(!COURSE.platforms.some(p=>a.x>=p.x&&a.x<=p.end));
    }
  }
});

function templateCourse(pattern:typeof RUN_PATTERNS[number]):Course {
  const dx=distancePerMotionFrame(pattern.stage);
  return {platforms:[{x:-2000,end:0,y:365},{x:pattern.gap,end:pattern.gap+dx*30,y:365}],
    anchors:pattern.anchors.map(x=>({x,width:110})),
    coins:pattern.gold.map(c=>({...c,stage:pattern.stage,value:5,kind:'gold'})),ends:Array(6).fill(Infinity)};
}

test('every template has a playable route collecting every gold coin', () => {
  for(const p of RUN_PATTERNS){
    const c=templateCourse(p);
    let s:RunState={...createInitialState(),phase:'playing',stage:p.stage,x:-8};
    for(const hit of p.inputs)s=step(s,{hit:hit==='1'},c);
    assert.ok(s.grounded&&s.x>=p.gap,`landing ${p.stage} ${p.kind} ${p.gap}`);
    assert.equal(s.collected.size,c.coins.length,`gold ${p.stage} ${p.kind} ${p.gap}`);
  }
});

test('wire canyons cannot be jumped and chains cannot omit a pillar', () => {
  for(const p of RUN_PATTERNS.filter(p=>p.kind==='wire')){
    const c=templateCourse(p);
    const initial:RunState={...createInitialState(),phase:'playing',stage:p.stage,x:-8};
    assert.equal(crossing(initial,p.gap,false,c),null);
    if(p.anchors.length>1)for(let omit=0;omit<p.anchors.length;omit++){
      const fewer={...c,anchors:c.anchors.filter((_,i)=>i!==omit)};
      assert.equal(crossing(initial,p.gap,true,fewer),null,`skipped pillar ${omit}: stage ${p.stage} gap ${p.gap}`);
    }
  }
});

test('wire patterns give breathing room before the first pillar', () => {
  for(const p of RUN_PATTERNS.filter(p=>p.kind==='wire')){
    const dx=distancePerMotionFrame(p.stage);
    assert.ok(p.anchors[0]>=dx*FIRST_PILLAR_MIN_FRAMES);
    assert.ok(p.inputs.slice(2,2+FIRST_WIRE_MIN_DELAY_TICKS).split('').every(hit=>hit==='0'));
    assert.equal(p.inputs.indexOf('1',2)>=2+FIRST_WIRE_MIN_DELAY_TICKS,true);
    const c=templateCourse(p),initial:RunState={...createInitialState(),phase:'playing',stage:p.stage,x:-8};
    assert.equal(searchCrossing(initial,p.gap,c,{minWireDelayTicks:FIRST_WIRE_MIN_DELAY_TICKS}).status,'found');
  }
});

test('every normal-mode wire trace refires before the bird drops too low', () => {
  for(const pattern of RUN_PATTERNS.filter(p=>p.kind==='wire')){
    const course:Course={platforms:[{x:-1000,end:0,y:365},{x:pattern.gap,end:pattern.gap+2000,y:365}],
      anchors:pattern.anchors.map(x=>({x,width:110})),coins:[],ends:Array(6).fill(Infinity)};
    let state:RunState={...createInitialState(),phase:'playing',stage:pattern.stage,x:TEMPLATE_TAKEOFF_X};
    for(const hit of pattern.inputs){
      const pressed=hit==='1';
      if(pressed&&!state.held&&!state.grounded)assert.ok(state.y<=MAX_WIRE_REFIRE_Y,
        `stage ${pattern.stage+1}, ${pattern.anchors.length} pillars refired at y=${state.y}`);
      state=step(state,{hit:pressed},course);
    }
  }
});

test('edge jumps require late takeoff and every stage includes both coin types', () => {
  for(const p of RUN_PATTERNS.filter(p=>p.kind==='edge')){
    const c=templateCourse(p),dx=distancePerMotionFrame(p.stage);
    const initial:RunState={...createInitialState(),phase:'playing',stage:p.stage,x:-8};
    assert.ok(crossing(initial,p.gap,false,c));
    assert.equal(crossing({...initial,x:-dx*3},p.gap,false,c),null);
  }
  for(let stage=0;stage<6;stage++)for(const kind of ['gold','silver'])
    assert.ok(COURSE.coins.some(c=>c.stage===stage&&c.kind===kind));
  for(let stage=0;stage<6;stage++) {
    const silver=COURSE.coins.filter(c=>c.stage===stage&&c.kind==='silver');
    const gold=COURSE.coins.filter(c=>c.stage===stage&&c.kind==='gold');
    assert.ok(Math.min(...gold.map(c=>c.value))>Math.max(...silver.map(c=>c.value)));
  }
});

test('rope launch below the screen uses rope death threshold, not jump threshold', () => {
  const course={platforms:[],anchors:[],coins:[],ends:[Infinity]};
  const s=step({...createInitialState(),phase:'playing',grounded:false,x:200,motionClock:.9,
    motion:{mode:'rope',y:490,dy:-20,spinGravity:false,hook:{x:0,y:125}}},{hit:true},course);
  assert.equal(s.motion?.mode,'spin');assert.equal(s.phase,'playing');
});

test('running speed does not accelerate falling', () => {
  const course={platforms:[],anchors:[],coins:[],ends:[Infinity]};
  function run(rate:number,ticks:number) {
    let s:RunState={...createInitialState(),phase:'playing'};
    for(let i=0;i<ticks;i++)s=step(s,{hit:i===0},course,rate);
    return [s.x,s.y,s.motion!.dy];
  }
  assert.deepEqual(run(1.1,20).slice(1),run(2.2,20).slice(1));
});

test('render anchors running feet and visible platform edges to collision coordinates', async () => {
  const {render}=await import('../../client/src/rock-run/render.js');
  const rects:number[][]=[], translations:number[][]=[], draws:any[][]=[];
  const ctx:any={canvas:{width:960},fillRect:(...v:number[])=>rects.push(v),drawImage:(...v:any[])=>draws.push(v),save(){},restore(){},translate:(...v:number[])=>translations.push(v)};
  const bird={},s=createInitialState();s.phase='playing';
  render(ctx,{'left/run/0':bird} as any,{} as any,s);
  assert.deepEqual(translations.at(-1),[200,365]);
  const drawing=draws.find(v=>v[0]===bird)!;
  assert.equal(drawing[2]+drawing[4],0,'sprite bottom is the foot origin');
  const p=courseFor(s.seed).platforms[0];
  assert.ok(rects.some(r=>r[0]===Math.round(p.x+200)&&r[1]===p.y&&r[2]===p.end-p.x),'visible top and edges match platform');
});

test('leaving an edge falls visibly before death and can fire while falling', () => {
  const c={platforms:[{x:0,end:100,y:365}],anchors:[],coins:[],ends:[Infinity]};
  let s:RunState={...createInitialState(),phase:'playing',x:95,motionClock:.9};
  s=step(s,{hit:false},c);
  assert.equal(s.phase,'playing');assert.equal(s.grounded,false);
  for(let i=0;i<8;i++)s=step(s,{hit:false},c);
  assert.ok(s.y>365&&s.y<480);assert.equal(s.phase,'playing');
  s=step(s,{hit:true},c);assert.ok(s.shot);
  for(let i=0;i<120&&s.phase==='playing';i++)s=step(s,{hit:false},c);
  assert.equal(s.phase,'gameover');assert.ok(s.y>560);
});

test('airborne release cancels a shot and repress fires from the current position', () => {
  const c={platforms:[],anchors:[],coins:[],ends:[Infinity]};
  let s:RunState={...createInitialState(),phase:'playing',grounded:false,x:200,y:260,
    motion:{mode:'spin',y:260,dy:30,spinGravity:true,hook:null}};
  s=step(s,{hit:true},c);assert.ok(s.shot);assert.equal(s.motion?.dy,30);
  const first=s.shot.x;
  s=step(s,{hit:false},c);assert.equal(s.shot,null);assert.equal(s.motion?.mode,'spin');
  const x=s.x,y=s.y;
  s=step(s,{hit:true},c);assert.ok(s.shot);assert.equal(s.shot.x,x+12.5);assert.equal(s.shot.y,y-54.4);assert.notEqual(s.shot.x,first);
});

test('narrow and overlapping pillar strips catch swept shots', () => {
  for(const a of [{x:245,width:10},{x:200,width:110}]) {
    const c={platforms:[],anchors:[a],coins:[],ends:[Infinity]};
    const s=step({...createInitialState(),phase:'playing',held:true,grounded:false,motionClock:.9,
      motion:{mode:'shoot',y:280,dy:0,spinGravity:false,hook:{x:200,y:125}}},{hit:true},c);
    assert.ok(s.rope);assert.equal(s.motion?.mode,'rope');
  }
});

test('falling below a platform cannot snap upward onto its side', () => {
  const c={platforms:[{x:0,end:1000,y:365}],anchors:[],coins:[],ends:[Infinity]};
  const s=step({...createInitialState(),phase:'playing',grounded:false,motionClock:.9,
    motion:{mode:'jump',y:380,dy:-10,spinGravity:false,hook:null}},{hit:false},c);
  assert.equal(s.grounded,false);assert.ok(s.y>380);assert.equal(s.phase,'playing');
});


test('overlapping shots attach at their true height across the whole pillar', () => {
  const c={platforms:[],anchors:[{x:200,width:110}],coins:[],ends:[Infinity]};
  for(const height of [40,180,300,440]) {
    const s=step({...createInitialState(),phase:'playing',grounded:false,x:200,y:height+54.4,motionClock:.9,
      motion:{mode:'jump',y:height+54.4,dy:0,spinGravity:false,hook:null}},{hit:true},c);
    assert.ok(s.rope,`height ${height}`);
    assert.equal(s.rope.x,212.5);assert.ok(Math.abs(s.rope.y-height)<1e-8);
  }
});

test('shots below and above visible pillar bounds cannot attach', () => {
  const c={platforms:[],anchors:[{x:200,width:110}],coins:[],ends:[Infinity]};
  for(const height of [10,530]) {
    const s=step({...createInitialState(),phase:'playing',grounded:false,held:true,motionClock:.9,
      motion:{mode:'shoot',y:300,dy:0,spinGravity:false,hook:{x:200,y:height}}},{hit:true},c);
    assert.equal(s.rope,null);
  }
});

test('pattern metadata rejects stale speeds and motion settings', () => {
  assert.doesNotThrow(()=>assertPatternSettings(GENERATED_SETTINGS));
  const settings=JSON.parse(GENERATED_SETTINGS);
  assert.throws(()=>assertPatternSettings(JSON.stringify({...settings,gameSpeed:settings.gameSpeed+1})),/패턴이 다릅니다/);
  assert.throws(()=>assertPatternSettings(JSON.stringify({...settings,motionSpeed:settings.motionSpeed+1})),/패턴이 다릅니다/);
});

test('search exhaustion is inconclusive, never evidence of an impossible route', () => {
  const p=RUN_PATTERNS.find(p=>p.kind==='wire')!,c=templateCourse(p);
  const initial:RunState={...createInitialState(),phase:'playing',stage:p.stage,x:-8};
  assert.deepEqual(searchCrossing(initial,p.gap,c,{maxStates:0}),{status:'inconclusive',reason:'state-budget'});
  assert.deepEqual(searchCrossing(initial,p.gap,c,{allowWire:false,maxCoastTicks:0}),{status:'inconclusive',reason:'tick-budget'});
  assert.equal(searchCrossing(initial,p.gap,c).status,'found');
  assert.equal(searchCrossing(initial,p.gap,c,{allowWire:false}).status,'not-found');
});

test('wire endpoint follows the rotated dive sprite chest, without changing physics', async () => {
  const {render}=await import('../../client/src/rock-run/render.js');
  for(const point of [{x:400,y:100},{x:120,y:350}]){
    const s:RunState={...createInitialState(),phase:'playing',x:200,y:280,grounded:false,
      motion:{mode:'rope',y:280,dy:15,spinGravity:false,hook:{...point}},rope:{anchor:0,...point}};
    const before=structuredClone(s);
    let rotation=0;const lines:number[][]=[],moves:number[][]=[];
    const ctx:any={canvas:{width:960},fillRect(){},drawImage(){},save(){},restore(){},translate(){},
      rotate:(a:number)=>{rotation=a;},beginPath(){},stroke(){},moveTo:(...v:number[])=>moves.push(v),lineTo:(...v:number[])=>lines.push(v)};
    render(ctx,{} as any,{} as any,s);
    const [x,y]=lines[0];
    // Inverse transform must put the attachment inside the original dive chest pixels.
    const dx=x-200,dy=y-280;
    assert.ok(Math.abs(dx*Math.cos(rotation)+dy*Math.sin(rotation)-6)<1e-8);
    assert.ok(Math.abs(-dx*Math.sin(rotation)+dy*Math.cos(rotation)+12)<1e-8);
    assert.deepEqual(moves[0],[point.x,point.y]);
    assert.deepEqual(s,before);
  }
});
