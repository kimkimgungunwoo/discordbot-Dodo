import '../style.css';
import './style.css';
import { freshBoard, shoot, step, remaining, validShot, timeoutShot, SIZE, RADIUS, DRAG_LIMIT, isFullPower, LABELS, TURN_LIMIT_MS, TOSS_MS, AI_RESPONSE_LIMIT_MS, type State, type Shot, type Difficulty } from '../../../shared/alkkagi';
import { loadSprites } from '../common/sprites';
import { GameAudio } from '../common/audio';
import { bindSoundControl } from '../common/sound-control';
import { createSpectatorBar, type Spectator } from '../common/spectators';
import { authenticate } from '../discord-session';
type Side = 'left' | 'right';
const root = document.querySelector<HTMLDivElement>('#app')!;
document.title = '도도새 알까기';
const online = new URLSearchParams(location.search).has('room') || new URLSearchParams(location.search).has('code');
let credentials: {roomId:string;token:string} | undefined;
try { if (online) credentials = await authenticate(root,'alkkagi'); } catch(error) { root.textContent = (error as Error).message; throw error; }
root.innerHTML = `<main class="shell omok-shell">
<section class="heading"><h1>도도새 알까기<span>DODO ALKKAGI</span></h1><button id="sound" class="quiet" aria-pressed="false">소리 켜짐 ♪</button></section>
<section class="arcade" aria-label="알까기 경기">
<div class="omok-toolbar"><strong id="mode"></strong><span>흑백 각 6개</span><label id="difficulty-label">난이도 <select id="difficulty"><option value="easy">쉬움</option><option value="normal" selected>중간</option><option value="hard">어려움</option><option value="extreme">극한</option></select></label><span id="score"></span></div>
<div class="omok-stage">
<div class="trainer trainer-top" id="trainer-left"><canvas width="120" height="96" id="portrait-left" aria-hidden="true"></canvas><div class="trainer-text"><strong id="name-left"></strong><small id="role-left"></small><div class="turn-meter"><div class="turn-meter-fill" id="meter-left"></div></div></div></div>
<div class="board-wrap"><div class="turn-timer" id="turn-timer" role="timer" hidden></div><canvas id="board" width="600" height="600" tabindex="0" aria-label="알까기판. 자기 돌을 누르고 뒤로 당긴 다음 놓으면 반대 방향으로 발사됩니다."></canvas></div>
<div class="trainer trainer-bottom" id="trainer-right"><canvas width="120" height="96" id="portrait-right" aria-hidden="true"></canvas><div class="trainer-text"><strong id="name-right"></strong><small id="role-right"></small><div class="turn-meter"><div class="turn-meter-fill" id="meter-right"></div></div></div></div>
<div class="overlay omok-overlay" id="overlay"><div class="start-card"><div class="coin" id="coin" hidden></div><h2 id="title">도도새 알까기</h2><p id="copy">돌을 뒤로 당겨 상대 돌을 밀어내세요.</p><button id="start" class="primary">동전 던지고 시작</button></div></div>
</div></section><div class="omok-status" id="status" role="status"></div><div class="omok-footer"><span>뒤로 당겨 놓으면 반대 방향으로 발사 · 길게 당길수록 강하게</span><span>모든 돌이 멈추면 다음 차례 · Esc로 조준 취소</span></div></main>`;
const el = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('board'), ctx = canvas.getContext('2d')!;
// Leave room outside the physical board for edge stones, outlines and shadows.
const BOARD_MARGIN = RADIUS + 10, CANVAS_SIZE = SIZE + BOARD_MARGIN * 2;
canvas.width = canvas.height = CANVAS_SIZE;
const audio = new GameAudio(); bindSoundControl(audio,el<HTMLButtonElement>('sound'));
const sprites = loadSprites();
for (const side of ['left','right']) {
  const portrait = el<HTMLCanvasElement>('portrait-'+side).getContext('2d')!; portrait.imageSmoothingEnabled = false;
  if (side === 'right') { portrait.translate(120,0); portrait.scale(-1,1); }
  portrait.drawImage(sprites[side+'/idle/0'],0,0,120,96);
}
const spectatorBar = createSpectatorBar(document.querySelector<HTMLElement>('.omok-stage')!);
let spectators: Spectator[] = [];
let state = freshBoard(), blackSide: Side = 'left', role = 'left', names = {left:'나',right:'도도봇'};
let difficulty: Difficulty = 'normal', mode = 'CPU', matchId = '';
let ready = !online, connected = !online, started = false, pending = false, terminal = false, delivered = false;
let startsAt: number | null = null, turnDeadline: number | null = null, result: any = null, notice = '';
let socket: WebSocket | undefined, voting = false, voteSent = false;
let worker: Worker | undefined, workerTimer: ReturnType<typeof setTimeout> | undefined, cpuTimer: ReturnType<typeof setTimeout> | undefined;
let drag: {id:number;pointer:number;x:number;y:number;originX:number;originY:number} | undefined;
let snapshotAt = performance.now();
const turnSide = () => state.turn === 1 ? blackSide : blackSide === 'left' ? 'right' : 'left';
const canPlay = () => started && connected && ready && !terminal && !pending && !result && !state.moving && !state.winner && !state.draw && startsAt !== null && Date.now() >= startsAt && role === turnSide();
function ui() {
  const tossing = started && startsAt !== null && Date.now() < startsAt;
  el('mode').textContent = online ? role === 'spectator' ? '관전' : mode === 'CPU' ? '봇전' : '친구와 대결' : '혼자 연습';
  el('difficulty-label').hidden = online; el<HTMLSelectElement>('difficulty').disabled = started && !result;
  el('score').textContent = `흑 ${remaining(state,1)} : ${remaining(state,2)} 백`;
  for (const side of ['left','right'] as Side[]) {
    el('name-'+side).textContent = names[side]+(side === 'right' && mode === 'CPU' ? ' · '+LABELS[difficulty] : '');
    el('role-'+side).textContent = (side === blackSide ? '● 흑돌 · 선공' : '○ 백돌 · 후공')+(role === side ? ' · 나' : '')+` · 남은 돌 ${remaining(state,side === blackSide ? 1 : 2)}개`;
    el('trainer-'+side).classList.toggle('active',started && !tossing && !result && turnSide() === side);
    const fraction = turnDeadline !== null && turnSide() === side ? Math.max(0,Math.min(1,(turnDeadline-Date.now())/TURN_LIMIT_MS)) : 1;
    el('meter-'+side).style.width = fraction*100+'%';
  }
  el('overlay').hidden = started && !tossing && !result && !terminal;
  el('coin').hidden = !tossing;
  el('title').textContent = terminal ? '연결 안내' : result ? result.aborted ? '경기 중단' : result.winnerSide === 'draw' ? '무승부' : names[result.winnerSide as Side]+' 승리' : tossing ? '흑백 추첨 중' : online ? '플레이어 연결 대기' : '도도새 알까기';
  el('copy').textContent = terminal ? notice : result ? result.reason ?? `흑 ${remaining(state,1)} : ${remaining(state,2)} 백` : tossing ? names[blackSide]+' · 흑돌 선공' : '자기 돌을 뒤로 당겼다가 놓으세요.';
  el('start').hidden = tossing || (online && !result && !terminal) || (online && role === 'spectator');
  el<HTMLButtonElement>('start').disabled = voting || voteSent || (online && !terminal && (!connected || !delivered));
  el('start').textContent = terminal ? '다시 연결' : result ? voteSent ? '상대 동의 대기 중' : '재경기' : '동전 던지고 시작';
  el('status').textContent = notice || (!started ? '자기 돌을 누르고 뒤로 당겨 조준하세요.' : !connected || !ready ? '플레이어 연결 대기 중...' : state.moving ? '돌이 멈추기를 기다리는 중...' : result ? state.quietTurns >= 40 ? '40턴 동안 탈락한 돌이 없어 무승부입니다.' : '경기가 끝났습니다.' : tossing ? '곧 경기가 시작됩니다.' : role === turnSide() ? '내 차례 · 자기 돌을 뒤로 당겨 발사하세요.' : names[turnSide()]+' 차례');
  const seconds = turnDeadline === null ? 0 : Math.ceil((turnDeadline-Date.now())/1000);
  el('turn-timer').hidden = seconds <= 0 || seconds > 10;
  if (seconds > 0 && seconds <= 10) el('turn-timer').textContent = `${seconds}초 뒤 자동 발사`;
  spectatorBar(spectators,online);
}
function render(view: State) {
  ctx.clearRect(0,0,CANVAS_SIZE,CANVAS_SIZE);
  ctx.fillStyle = '#f1eedf'; ctx.fillRect(0,0,CANVAS_SIZE,CANVAS_SIZE);
  ctx.save(); ctx.translate(BOARD_MARGIN,BOARD_MARGIN);
  ctx.fillStyle = '#daca9f'; ctx.fillRect(0,0,SIZE,SIZE);
  ctx.strokeStyle = '#807d6060'; ctx.lineWidth = 1; ctx.strokeRect(0,0,SIZE,SIZE);
  ctx.strokeStyle = '#807d60'; ctx.lineWidth = 1;
  for (let i=0;i<15;i++) { const at=20+i*40; ctx.beginPath(); ctx.moveTo(20,at); ctx.lineTo(580,at); ctx.moveTo(at,20); ctx.lineTo(at,580); ctx.stroke(); }
  ctx.fillStyle = '#66694e'; for (const [x,y] of [[140,140],[460,140],[300,300],[140,460],[460,460]]) { ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill(); }
  for (const stone of view.stones) {
    if (!stone.alive) continue;
    ctx.save(); ctx.shadowColor='#303b3640'; ctx.shadowBlur=3; ctx.shadowOffsetY=3;
    const gradient=ctx.createRadialGradient(stone.x-6,stone.y-7,2,stone.x,stone.y,RADIUS);
    gradient.addColorStop(0,stone.color===1?'#5e6861':'#fffef6'); gradient.addColorStop(1,stone.color===1?'#26322c':'#ddd9c6');
    ctx.fillStyle=gradient; ctx.beginPath(); ctx.arc(stone.x,stone.y,RADIUS,0,Math.PI*2); ctx.fill(); ctx.restore();
    ctx.strokeStyle=stone.color===1?'#26322c':'#aaa991'; ctx.stroke();
    if (canPlay() && stone.color===state.turn) { ctx.strokeStyle='#c9814d88'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(stone.x,stone.y,RADIUS+4,0,Math.PI*2); ctx.stroke(); ctx.lineWidth=1; }
  }
  if (drag && canPlay()) {
    const stone=state.stones.find(p=>p.id===drag!.id)!;
    const dx=drag.originX-drag.x,dy=drag.originY-drag.y,length=Math.hypot(dx,dy);
    if (length>=5) {
      const power=Math.min(1,length/DRAG_LIMIT);
      const ux=dx/length,uy=dy/length,reach=RADIUS+20+power*50;
      const x=stone.x+ux*reach,y=stone.y+uy*reach;
      ctx.save(); ctx.strokeStyle='#59614c';ctx.lineWidth=3;ctx.lineCap='round';ctx.setLineDash([4,7]);
      ctx.beginPath();ctx.moveTo(stone.x+ux*(RADIUS+5),stone.y+uy*(RADIUS+5));ctx.lineTo(x,y);ctx.stroke();
      ctx.restore();
      // Keep the power gauge beside the pull position and inside the canvas.
      const gaugeWidth=70,gaugeHeight=10;
      const gaugeX=Math.max(-BOARD_MARGIN+6,Math.min(SIZE+BOARD_MARGIN-gaugeWidth-6,drag.x-gaugeWidth/2));
      const gaugeY=Math.max(-BOARD_MARGIN+6,Math.min(SIZE+BOARD_MARGIN-gaugeHeight-6,drag.y+22));
      ctx.save();ctx.fillStyle='#f1eedf';ctx.strokeStyle='#59614c';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.roundRect(gaugeX,gaugeY,gaugeWidth,gaugeHeight,4);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.roundRect(gaugeX+2,gaugeY+2,gaugeWidth-4,gaugeHeight-4,2);ctx.clip();
      ctx.fillStyle=isFullPower(length)?'#b66a45':'#59614c';
      ctx.fillRect(gaugeX+2,gaugeY+2,(gaugeWidth-4)*power,gaugeHeight-4);ctx.restore();
    }
  }
  ctx.restore();
}
function point(event: PointerEvent) { const rect=canvas.getBoundingClientRect(); return {x:(event.clientX-rect.left)/rect.width*CANVAS_SIZE-BOARD_MARGIN,y:(event.clientY-rect.top)/rect.height*CANVAS_SIZE-BOARD_MARGIN}; }
canvas.onpointerdown=event=>{
  if (!canPlay() || (event.pointerType==='mouse' && event.button!==0)) return;
  const p=point(event),stone=state.stones.find(s=>s.alive && s.color===state.turn && Math.hypot(s.x-p.x,s.y-p.y)<=RADIUS+8);
  if (!stone) return; event.preventDefault(); void audio.unlock(); drag={id:stone.id,pointer:event.pointerId,...p,originX:p.x,originY:p.y};canvas.setPointerCapture(event.pointerId);
};
canvas.onpointermove=event=>{if(drag?.pointer===event.pointerId){Object.assign(drag,point(event));event.preventDefault();}};
canvas.onpointerup=event=>{
  if(!drag || drag.pointer!==event.pointerId)return;
  const p=point(event),dx=drag.originX-p.x,dy=drag.originY-p.y,length=Math.hypot(dx,dy),scale=length>DRAG_LIMIT?DRAG_LIMIT/length:1;
  const shot={id:drag.id,dx:dx*scale,dy:dy*scale};drag=undefined;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  fire(shot);
};
canvas.onpointercancel=()=>{drag=undefined;};canvas.onlostpointercapture=()=>{drag=undefined;};
window.addEventListener('keydown',event=>{if(event.key==='Escape')drag=undefined;});
function fire(shot: Shot) {
  if(!canPlay() || !validShot(state,shot))return;notice='';
  if(online){pending=true;socket?.send(JSON.stringify({type:'SHOT',matchId,revision:state.revision,shot}));}
  else beginShot(shot);ui();
}
function beginShot(shot: Shot) { state=shoot(state,shot);turnDeadline=null;audio.play([{kind:'hit',side:turnSide(),x:0,y:0}]); }
function cancelCpu(){if(cpuTimer)clearTimeout(cpuTimer);cpuTimer=undefined;worker?.terminate();worker=undefined;if(workerTimer)clearTimeout(workerTimer);workerTimer=undefined;}
function localTurn(){
  if(online || state.moving || result || !started)return;
  if(state.winner || state.draw){result={winnerSide:state.draw?'draw':state.winner===1?blackSide:blackSide==='left'?'right':'left'};delivered=true;turnDeadline=null;cancelCpu();ui();return;}
  if(turnSide()==='left'){turnDeadline=Math.max(Date.now(),startsAt??0)+TURN_LIMIT_MS;return;}
  turnDeadline=null;if(cpuTimer || worker)return;
  cpuTimer=setTimeout(()=>{
    cpuTimer=undefined;const request=state;
    const finish=(shot:Shot)=>{cancelCpu();if(state===request && !result && validShot(state,shot))beginShot(shot);};
    let best=timeoutShot(request);
    try{
      worker=new Worker(new URL('./ai-worker.ts',import.meta.url),{type:'module'});
      workerTimer=setTimeout(()=>finish(best),AI_RESPONSE_LIMIT_MS);
      worker.onmessage=event=>{if(!validShot(request,event.data.shot)){finish(best);return;}best=event.data.shot;if(event.data.type==='result')finish(best);};
      worker.onerror=()=>finish(best);worker.postMessage({state:request,difficulty});
    }catch{finish(best);}
  },Math.max(0,(startsAt??0)-Date.now())+500);
}
el('start').onclick=async()=>{
  void audio.unlock();
  if(terminal){location.href='/alkkagi'+(credentials?'?room='+encodeURIComponent(credentials.roomId):'');return;}
  if(!online){cancelCpu();state=freshBoard();blackSide=crypto.getRandomValues(new Uint8Array(1))[0]%2?'left':'right';difficulty=el<HTMLSelectElement>('difficulty').value as Difficulty;startsAt=Date.now()+TOSS_MS;started=true;result=null;drag=undefined;notice='';localTurn();ui();return;}
  if(!credentials || voting)return;voting=true;notice='';ui();
  try{const response=await fetch('/api/rematch',{method:'POST',headers:{Authorization:'Bearer '+credentials.token,'content-type':'application/json'},body:JSON.stringify({roomId:credentials.roomId,matchId})});const body=await response.json();if(!response.ok)throw new Error(body.error??'재경기 요청 실패');voteSent=response.status===202;}catch(error){notice=(error as Error).message;}finally{voting=false;ui();}
};
function connect(){
  if(!credentials || terminal)return;
  const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);socket=ws;
  ws.onopen=()=>ws.send(JSON.stringify({type:'AUTH',...credentials}));
  ws.onmessage=event=>{
    if(socket!==ws)return;const message=JSON.parse(event.data);
    if(message.type==='ALKKAGI_JOIN'){role=message.role;connected=true;pending=false;notice='';}
    else if(message.type==='ALKKAGI_STATE'){
      if(matchId!==message.matchId){voting=false;voteSent=false;drag=undefined;notice='';}
      if(state.revision!==message.state.revision || message.state.moving || !message.ready)drag=undefined;
      state=message.state;snapshotAt=performance.now();blackSide=message.blackSide;names=message.players;matchId=message.matchId;mode=message.room.mode;difficulty=message.room.difficulty??'normal';ready=message.ready;pending=false;
      const skew=Date.now()-message.now;startsAt=message.startsAt===null?null:message.startsAt+skew;turnDeadline=message.turnDeadline===null?null:message.turnDeadline+skew;
      started=startsAt!==null;result=message.result;delivered=message.delivered;spectators=message.spectators??[];
    }else if(message.type==='SHOT_REJECTED'){pending=false;notice=message.message;}
    else if(message.type==='ALKKAGI_CONNECTION'){ready=message.ready;if(!ready)drag=undefined;}
    else if(message.type==='FINISHED'){result=message.result;delivered=true;}
    else if(message.type==='RESULT_PENDING'){result=message.result;}
    else if(message.type==='MATCH_REPLACED'){socket=undefined;ws.close();connect();return;}
    else if(message.type==='ROOM_CLOSED' || message.type==='ERROR'){terminal=true;connected=false;drag=undefined;notice=message.message??'방이 종료되었습니다.';if(message.type==='ERROR')sessionStorage.removeItem('dodo:token');ws.close();}
    ui();
  };
  ws.onclose=()=>{if(socket!==ws || terminal)return;connected=false;pending=false;drag=undefined;notice='연결이 끊겼습니다. 다시 연결 중...';ui();setTimeout(connect,1800);};
}
let last=performance.now(),accumulator=0;
function frame(now:number){
  const elapsed=document.hidden?0:Math.min(70,now-last);last=now;
  if(!online){
    accumulator+=elapsed;
    while(accumulator>=1000/60){accumulator-=1000/60;if(state.moving){state=step(state);if(!state.moving)localTurn();}}
    if(turnDeadline!==null && Date.now()>=turnDeadline && canPlay())fire(timeoutShot(state));
  }
  let view=state;
  if(online && state.moving){const ticks=Math.min(3,Math.floor((now-snapshotAt)/(1000/60)));for(let i=0;i<ticks;i++)view=step(view);}
  render(view);requestAnimationFrame(frame);
}
setInterval(ui,100);ui();requestAnimationFrame(frame);if(online)connect();
window.addEventListener('pagehide',()=>{cancelCpu();socket?.close();});
