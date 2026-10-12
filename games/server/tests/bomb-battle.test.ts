import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTDOWN_TICKS, FUSE_TICKS, GHOST_TICKS, HEIGHT, IDLE, LEVELS, MOVE_TICKS, MOVE_SPEED, PLAYER_RADIUS, WIDTH, canMove, canOccupy, playerCell, cell, createGame, explode, ghost, install, step, type State } from '../../shared/bomb-battle.js';
import { botInput, safePlan } from '../../shared/bomb-battle-bot.js';
import { BombBattleRoom } from '../src/bomb-battle-room.js';
import { validDefinition, type Definition } from '../src/protocol.js';
import { Prediction, type Snapshot } from '../../client/src/bomb-battle/session.js';

function arena(count = 4): State {
  const s = createGame(count, 123); s.phase = 'playing'; s.tick = COUNTDOWN_TICKS + 1;
  s.board = s.board.map((_, at) => at % WIDTH === 0 || at % WIDTH === WIDTH-1 || at < WIDTH || at >= WIDTH*(HEIGHT-1) ? 1 : 0); return s;
}
function movePlayer(s: State, seat: number, x: number, y: number) { Object.assign(s.players[seat], {x, y, fromX:x, fromY:y}); }
const definition: Definition = { game:'bomb_battle', roomId:'10:1:bomb', guildId:'10', hostId:'1', p2Id:'2', mode:'PVP', seats:[1,2,3,4].map(i=>({userId:String(i),name:`user${i}`})) };
function snapshot(s: State, ack = 0, seq = ack): Snapshot { return {type:'BOMB_STATE', matchId:'match', state:s, seat:0, started:true, ack, seq, seats:definition.seats!, spectators:[], result:null, delivered:false}; }

test('four symmetric patterns preserve safe corners and connected destructible corridors', () => {
  for (let pattern = 0; pattern < 4; pattern++) for (const count of [2,3,4]) {
    const s = createGame(count, 1, pattern);
    for (let seat=0;seat<count;seat++) { const probe=structuredClone(s); probe.phase='playing'; install(probe,seat); assert.equal(safePlan(probe,seat,undefined,true).safe,true,`pattern ${pattern} seat ${seat} must escape first bomb`); }
    for (let y=0;y<HEIGHT;y++) for(let x=0;x<WIDTH;x++) { assert.equal(s.board[cell(x,y)],s.board[cell(WIDTH-1-x,y)]); assert.equal(s.board[cell(x,y)],s.board[cell(x,HEIGHT-1-y)]); }
    const seen = new Set<number>([cell(1,1)]), queue=[cell(1,1)];
    for(let i=0;i<queue.length;i++) for(const d of [-WIDTH,1,WIDTH,-1]) {const at=queue[i]+d; if(s.board[at]!==1 && s.board[at]!==undefined && !seen.has(at)){seen.add(at);queue.push(at);}}
    for(const p of s.players) {assert.ok(seen.has(cell(p.x,p.y))); assert.equal(s.board[cell(p.x,p.y)],0); const open=[[-1,0],[1,0],[0,-1],[0,1]].filter(([dx,dy])=>s.board[cell(p.x+dx,p.y+dy)]===0); assert.ok(open.length>=2);}
  }
});
test('continuous movement, grid installation, pass-out and no bomb re-entry',()=>{
  let s=arena();s=step(s,[{direction:2,bomb:true}],false);
  assert.equal(s.players[0].x,1+MOVE_SPEED);assert.equal(s.bombs[0].x,1);
  assert.equal(s.bombs[0].explodesAt,s.tick+FUSE_TICKS);
  for(let i=0;i<10;i++)s=step(s,[{direction:2,bomb:false}],false);
  assert.equal(canMove(s,0,1,1),false);
  for(let i=0;i<20;i++)s=step(s,[{direction:4,bomb:false}],false);
  assert.ok(s.players[0].x>=1.5+PLAYER_RADIUS-1e-6);
  const deadline=s.bombs[0].explodesAt;while(s.tick<deadline)s=step(s,[],false);
  assert.equal(s.bombs.length,0);
});

test('fixed walls stop rays, crates are destroyed but block every ray in the same tick', () => {
  const s=arena();movePlayer(s,0,3,3);s.players[0].range=6; install(s,0);s.board[cell(5,3)]=2;s.board[cell(3,5)]=1;s.tick+=FUSE_TICKS;explode(s);
  assert.equal(s.board[cell(5,3)],0); assert.ok(s.flames.some(f=>f.at===cell(5,3))); assert.ok(!s.flames.some(f=>f.at===cell(6,3)));assert.ok(!s.flames.some(f=>f.at===cell(3,5)));
});
test('chain reactions are order independent and all same-tick blasts see unbroken crates',()=>{
  const s=arena();movePlayer(s,0,3,3);movePlayer(s,1,5,3);movePlayer(s,2,3,5);s.players.forEach(p=>p.range=6);install(s,0);install(s,1);install(s,2);s.bombs[1].explodesAt+=60;s.board[cell(5,5)]=2;s.tick+=FUSE_TICKS;
  const reversed=structuredClone(s);reversed.bombs.reverse();explode(s);explode(reversed);assert.equal(s.bombs.length,0);assert.deepEqual(new Set(s.flames.map(f=>f.at)),new Set(reversed.flames.map(f=>f.at)));assert.ok(!s.flames.some(f=>f.at===cell(6,5)));
});
test('same tick extinction is draw; KO remains eliminated and becomes ghost exactly after five seconds',()=>{
  let s=arena(2);movePlayer(s,1,2,1);install(s,0);s.tick+=FUSE_TICKS-1;s=step(s,[],false);assert.equal(s.phase,'finished');assert.equal(s.winner,null);assert.ok(s.players.every(p=>!p.alive));const eliminated=s.players[0].eliminatedAt!;
  while(s.tick<eliminated+GHOST_TICKS-1)s=step(s,[],false);assert.equal(ghost(s,s.players[0]),false);s=step(s,[{direction:2,bomb:true}],false);assert.equal(ghost(s,s.players[0]),true);assert.equal(s.players[0].x,1+MOVE_SPEED);assert.equal(s.bombs.length,0);assert.equal(s.players[0].alive,false);
});
test('random items continue spawning on eligible floor, capped, deterministic, blast removes without blocking',()=>{
  let a=arena(),b=structuredClone(a);for(let i=0;i<600;i++){a=step(a,[]);b=step(b,[]);}assert.deepEqual(a,b);assert.equal(a.items.length,8);
  for(const item of a.items){assert.equal(a.board[item.at],0);assert.ok(!a.players.some(p=>cell(p.x,p.y)===item.at));}
  a.items=[{at:cell(2,1),kind:'bomb'},{at:cell(3,1),kind:'range'}];install(a,0);a.tick+=FUSE_TICKS;explode(a);assert.equal(a.items.length,0);assert.ok(a.flames.some(f=>f.at===cell(3,1)));
});
test('pickup caps apply; ghosts do not collect items or install bombs',()=>{
  let s=arena();s.players[0].capacity=5;s.items=[{at:cell(1,1),kind:'bomb'}];s=step(s,[],false);assert.equal(s.items.length,0);assert.equal(s.players[0].capacity,5);
  s.players[0].alive=false;s.players[0].eliminatedAt=s.tick-GHOST_TICKS;s.items=[{at:cell(2,1),kind:'range'}];s=step(s,[{direction:2,bomb:true}],false);assert.equal(s.items.length,1);assert.equal(s.bombs.length,0);
});
test('all bot levels only install with escape paths; extreme escapes its own bomb',()=>{
  for(const level of LEVELS){const s=arena();movePlayer(s,0,3,3);for(const d of [-WIDTH,1,WIDTH,-1])s.board[cell(3,3)+d]=2;s.tick=Math.ceil(s.tick/21)*21;assert.equal(botInput(s,0,level).bomb,false);assert.equal(safePlan(s,0).safe,true);}
  let s=arena();s.board[cell(3,1)]=2;s.tick=210;let bombs=0;for(let i=0;i<150;i++){const input=botInput(s,0,'extreme');if(input.bomb)bombs++;s=step(s,[input],false);}assert.ok(bombs>0);assert.equal(s.players[0].alive,true);assert.equal(s.board[cell(3,1)],0);
});
test('online seats validate 2-4 humans/bots, reject transcendent and preserve rummikub restrictions',()=>{
  assert.ok(validDefinition(definition));assert.ok(validDefinition({...definition,seats:[definition.seats![0],{userId:null,name:'CPU',bot:'extreme'}],p2Id:null}));assert.equal(validDefinition({...definition,seats:[definition.seats![0],{userId:null,name:'CPU',bot:'transcendent'}]}),false);assert.equal(validDefinition({...definition,game:'rummikub',seats:[definition.seats![0],{userId:null,name:'CPU',bot:'extreme'}]}),false);
});
test('server runs without waiting for inputs, ignores spectators/results, deduplicates placement and expires direction',t=>{
  const room=new BombBattleRoom(definition);t.after(()=>room.dispose());const messages:any[][]=[];
  const peers=[1,2,3,4,5].map((id,i)=>{messages[i]=[];return{id:String(id),name:String(id),send:(m:unknown)=>messages[i].push(m)};});peers.forEach(p=>room.join(p));room.dispose();room.game=arena();
  const input={matchId:room.matchId,seq:1,input:{direction:2,bomb:true}};room.input(peers[4],input);room.report();room.input(peers[0],input);room.input(peers[0],input);room.advance();assert.equal(room.game.bombs.length,1);assert.equal(room.game.players[0].x,1+MOVE_SPEED);assert.equal(room.snapshot(peers[0]).ack,1);
  for(let i=0;i<32;i++)room.advance();const x=room.game.players[0].x;for(let i=0;i<14;i++)room.advance();assert.equal(room.game.players[0].x,x);assert.equal(room.game.players[1].x,11);
  room.leave(peers[0]);room.join(peers[0]);assert.equal(room.snapshot(peers[0]).seq,1);room.input(peers[0],input);assert.equal(room.game.bombs.length,1);assert.equal(room.snapshot(peers[4]).seat,-1);
});
test('prediction responds before acknowledgement then converges, reconciles installations and resets on reconnect',()=>{
  const p=new Prediction(),s=arena();p.receive(snapshot(s));p.submit({direction:2,bomb:true});p.advance();const view=p.view(2)!;assert.ok(view.players[0].x>1 && view.players[0].x<2);assert.equal(view.bombs.length,1);assert.equal(s.players[0].x,1);
  const confirmed=step(s,[{direction:2,bomb:true,bombSeq:1}],false);p.receive(snapshot(confirmed,1));assert.equal(p.pending.length,0);assert.equal(p.view(0)!.bombs.length,1);assert.equal(p.view(0)!.players[0].x,confirmed.players[0].x);
  p.submit({direction:3,bomb:true});p.disconnect();p.receive(snapshot(confirmed,1,2),true);assert.equal(p.pending.length,0);assert.equal(p.submit(IDLE).seq,3);
  for(let i=0;i<200;i++)p.advance();assert.ok(p.tick<=confirmed.tick+12);
});

test('placement on the first playing tick is accepted and acknowledged',t=>{
  const room=new BombBattleRoom({...definition,seats:definition.seats!.slice(0,2)});t.after(()=>room.dispose());
  const p={id:'1',name:'one',send:()=>{}};room.join(p);room.join({id:'2',name:'two',send:()=>{}});room.dispose();room.game=arena(2);room.game.tick=COUNTDOWN_TICKS;
  room.input(p,{matchId:room.matchId,seq:1,input:{direction:0,bomb:true}});room.advance();assert.equal(room.game.bombs.length,1);assert.equal(room.snapshot(p).ack,1);
});
test('timeout is a draw, spectator capacity reserves all four seats, late join sees stored result',t=>{
  let s=arena();s.tick=COUNTDOWN_TICKS+7200-1;s=step(s,[],false);assert.equal(s.finishReason,'timeout');assert.equal(s.winner,null);
  const room=new BombBattleRoom(definition);t.after(()=>room.dispose());
  for(let i=5;i<55;i++)room.join({id:String(i),name:'viewer',send:()=>{}});
  assert.throws(()=>room.join({id:'55',name:'full',send:()=>{}}),/관전/);
  const p={id:'1',name:'one',send:()=>{}};for(let i=1;i<=4;i++)room.join({...p,id:String(i)});room.dispose();assert.equal(room.ready(),true);
  room.game=s;room.advance();assert.equal(room.result!.winnerSide,'draw');room.delivered=true;
  const state=room.snapshot(p);assert.ok(state.result);assert.equal(state.delivered,true);
});
test('delayed snapshots preserve immediate input response without finalizing speculative KO',()=>{
  const p=new Prediction(),s=arena();p.receive(snapshot(s));p.submit({direction:2,bomb:true});p.advance();assert.ok(p.view(2)!.players[0].x>1);
  let authoritative=structuredClone(s);for(let i=0;i<12;i++){authoritative=step(authoritative,[],false);p.advance();}
  const delayed=step(authoritative,[{direction:2,bomb:true,bombSeq:1}],false);p.receive(snapshot(delayed,1));assert.equal(p.pending.length,0);assert.equal(p.view(0)!.bombs.length,1);assert.equal(p.view(0)!.players[0].x,delayed.players[0].x);
  delayed.flames=[{at:playerCell(delayed.players[0]),until:delayed.tick+18}];p.receive(snapshot(delayed,1));assert.equal(p.view(0)!.players[0].alive,true);
});


test('continuous speed is frame independent and stops and reverses on the next tick',()=>{
  let s=arena();for(let i=0;i<30;i++)s=step(s,[{direction:2,bomb:false}],false);
  assert.ok(Math.abs(s.players[0].x-(1+30*MOVE_SPEED))<1e-8);
  const x=s.players[0].x;s=step(s,[IDLE],false);assert.equal(s.players[0].x,x);
  s=step(s,[{direction:4,bomb:false}],false);assert.ok(Math.abs(s.players[0].x-(x-MOVE_SPEED))<1e-8);
  assert.equal(FUSE_TICKS,120);
});

test('every difficulty escapes its own bomb despite nearby item bait and waits for lingering flames',()=>{
  for(const level of LEVELS){
    let s=arena();s.board[cell(3,1)]=2;s.items=[{at:cell(1,3),kind:'range'}];
    let installed=false;
    for(let tick=0;tick<FUSE_TICKS+180;tick++){
      const input=botInput(s,0,level);installed ||= input.bomb;s=step(s,[input],false);
      assert.equal(s.players[0].alive,true,`${level} must not die to its own bomb at ${s.tick}`);
    }
    assert.equal(installed,true,`${level} must still plant useful bombs`);
    assert.equal(s.board[cell(3,1)],0);
  }
});
test('easy and normal interrupt thinking pauses to flee a known impending blast',()=>{
  for(const level of ['easy','normal'] as const){
    const s=arena();movePlayer(s,0,3,3);movePlayer(s,1,1,3);s.players[1].range=4;install(s,1);s.bombs[0].explodesAt=s.tick+10;
    const input=botInput(s,0,level);assert.notEqual(input.direction,0);assert.equal(input.bomb,false);
    const next=step(s,[input],false);assert.equal(next.players[0].alive,true);
  }
});

test('seeded maps vary floors and stone positions, keep every corridor connected, and sometimes contain large rocks',()=>{
  const layouts=new Set<string>(); let large=0;
  for(let seed=1;seed<=100;seed++){
    const s=createGame(4,seed*7919,0);assert.deepEqual(s,createGame(4,seed*7919,0));layouts.add(JSON.stringify(s.rocks));
    const seen=new Set([cell(1,1)]),queue=[cell(1,1)];
    for(let i=0;i<queue.length;i++)for(const d of [-WIDTH,1,WIDTH,-1]){const at=queue[i]+d;if(s.board[at]!==undefined&&s.board[at]!==1&&!seen.has(at)){seen.add(at);queue.push(at);}}
    assert.equal(seen.size,s.board.filter(v=>v!==1).length);
    for(const rock of s.rocks){if(rock.size===2)large++;for(let y=0;y<rock.size;y++)for(let x=0;x<rock.size;x++)assert.equal(s.board[cell(rock.x+x,rock.y+y)],1);}
  }
  assert.ok(layouts.size>80);assert.ok(large>0);assert.ok(large<400);
});
test('turns move immediately between cell centres without cooldown',()=>{
  let s=arena();s=step(s,[{direction:2,bomb:false}],false);const x=s.players[0].x;
  s=step(s,[{direction:3,bomb:false}],false);
  assert.equal(s.players[0].x,x);assert.equal(s.players[0].y,1+MOVE_SPEED);
});

test('remote snapshots interpolate while the local position is immediate and match changes reset history',async()=>{
  const {Presentation}=await import('../../client/src/bomb-battle/presentation.js');const view=new Presentation();
  const a=arena(),b=structuredClone(a);b.tick+=3;b.players[1].x-=3*MOVE_SPEED;
  view.receive(a,'match',1000);view.receive(b,'match',1050);
  const first=view.sample(b,0,1080),second=view.sample(b,0,1090);
  assert.equal(first[0].x,b.players[0].x);assert.ok(first[1].x<a.players[1].x && first[1].x>b.players[1].x);
  assert.ok(second[1].x<first[1].x);
  view.receive(a,'new',1100);assert.equal(view.sample(a,0,1100)[1].x,a.players[1].x);
});

test('all bot difficulties pursue and bomb opponents after human elimination on an empty map',()=>{
  for(const level of LEVELS){
    let s=arena(3);s.players[0].alive=false;s.players[0].eliminatedAt=s.tick;
    movePlayer(s,1,3,5);movePlayer(s,2,9,5);let planted=false;
    for(let i=0;i<600 && s.phase==='playing';i++){
      const input=botInput(s,1,level);planted ||= input.bomb;
      s=step(s,[IDLE,input,IDLE],false);
      if(planted)break;
    }
    assert.ok(planted,`${level} must pursue and attack without crates or items`);
  }
});
test('bots separate from an overlapping opponent and resume attacks',()=>{
  for(const level of LEVELS){
    let s=arena(2);movePlayer(s,0,5,5);movePlayer(s,1,5,5);let planted=false;
    for(let i=0;i<300;i++){const input=botInput(s,0,level);planted ||= input.bomb;s=step(s,[input,IDLE],false);if(planted)break;}
    assert.ok(planted,`${level} must leave overlap and attack`);
  }
});

test('a short tap produces a subcell movement and does not queue a full tile',()=>{
  let s=arena();s=step(s,[{direction:0,bomb:false,turn:2}],false);
  const x=s.players[0].x;assert.equal(x,1+MOVE_SPEED);
  for(let i=0;i<30;i++)s=step(s,[IDLE],false);assert.equal(s.players[0].x,x);
});

test('server preserves a press and release received within one simulation tick',t=>{
  const room=new BombBattleRoom({...definition,seats:definition.seats!.slice(0,2)});t.after(()=>room.dispose());
  const p={id:'1',name:'one',send:()=>{}};room.join(p);room.join({...p,id:'2'});room.dispose();room.game=arena(2);
  room.input(p,{matchId:room.matchId,seq:1,input:{direction:2,bomb:false,turn:2}});
  room.input(p,{matchId:room.matchId,seq:2,input:IDLE});room.advance();
  assert.equal(room.game.players[0].x,1+MOVE_SPEED);assert.equal(room.snapshot(p).ack,2);
  for(let i=0;i<30;i++)room.advance();assert.equal(room.game.players[0].x,1+MOVE_SPEED);
});
test('prediction preserves a released short tap and converges after acknowledgement',()=>{
  let s=arena();const p=new Prediction();p.receive(snapshot(s));
  p.submit({direction:2,bomb:false,turn:2});p.submit(IDLE);p.advance();
  assert.equal(p.view(0)!.players[0].x,1+MOVE_SPEED);
  s=step(s,[{direction:0,bomb:false,turn:2}],false);p.receive(snapshot(s,2));
  assert.equal(p.view(0)!.players[0].x,s.players[0].x);
});
test('footprint cannot clip a wall or large rock and fractional placement stays on the grid',()=>{
  let s=arena();s.board[cell(3,1)]=1;
  for(let i=0;i<30;i++)s=step(s,[{direction:2,bomb:false}],false);
  assert.ok(s.players[0].x<=2.5-PLAYER_RADIUS);assert.ok(canOccupy(s,0,s.players[0].x,s.players[0].y));
  install(s,0);assert.equal(s.bombs[0].x,2);assert.equal(s.bombs[0].y,1);
  s.items=[{at:playerCell(s.players[0]),kind:'range'}];s=step(s,[IDLE],false);assert.equal(s.players[0].range,3);
});


test('off-centre characters fit narrow corridors while blast damage still covers the entire grid cell',()=>{
  let s=arena();
  for(let y=1;y<HEIGHT-1;y++){s.board[cell(2,y)]=1;s.board[cell(4,y)]=1;}
  movePlayer(s,0,3.3,3);
  assert.ok(canOccupy(s,0,3.3,3));
  for(let i=0;i<12;i++)s=step(s,[{direction:3,bomb:false}],false);
  assert.ok(s.players[0].y>4);assert.equal(s.players[0].x,3.3);
  assert.equal(canOccupy(s,0,3.4,s.players[0].y),false);
  const at=playerCell(s.players[0]);s.flames=[{at,until:s.tick+10}];
  s=step(s,[IDLE],false);assert.equal(s.players[0].alive,false);
});
