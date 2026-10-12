import '../style.css';
import './style.css';
import { COLORS, COUNTDOWN_TICKS, GHOST_TICKS, IDLE, LEVELS, LEVEL_LABELS, ROUND_TICKS, TICK_RATE, createGame, ghost, settledScores, step, type Direction, type Input, type Level, type Seat, type State } from '../../../shared/bomb-battle';
import { botInput } from '../../../shared/bomb-battle-bot';
import { authenticate } from '../discord-session';
import { dodoProfile } from '../common/sprites';
import { GameAudio } from '../common/audio';
import { bindSoundControl } from '../common/sound-control';
import { CANVAS_HEIGHT, CANVAS_WIDTH, draw } from './render';
import { Prediction } from './session';
import { Presentation } from './presentation';
import { RematchVoting } from '../common/rematch-voting';

const root = document.querySelector<HTMLElement>('#app')!;
const online = new URLSearchParams(location.search).has('room') || new URLSearchParams(location.search).has('code');
const prediction = new Prediction(), presentation = new Presentation(), audio = new GameAudio();
const profiles = COLORS.map(dodoProfile), sound = document.createElement('button'); sound.className = 'quiet'; bindSoundControl(audio, sound);
let local: State | null = null, seats: (Seat & { connected?: boolean })[] = [], own = 0, started = false;
let socket: WebSocket | null = null, terminal = false, connected = false, message = '', retry = 0, reconnect: ReturnType<typeof setTimeout> | undefined;
let turnQueued: Direction = 0;
let direction: Direction = 0, bombQueued = false, lastSend = -99, lastEvents = -1, accumulator = 0, previousTime = 0, stopped = false, lastHud = '';
const pressed: string[] = [];
const keys: Record<string, Direction> = { ArrowUp: 1, ArrowRight: 2, ArrowDown: 3, ArrowLeft: 4 };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let canvas: HTMLCanvasElement | null = null;
let rematch: RematchVoting | undefined;
function mount() {
  root.innerHTML = `<main class="bomb-shell"><header class="heading"><div><small class="bomb-eyebrow">DODO ARCADE / 08</small><h1>도도새 폭탄전 <span>BOMB BATTLE</span></h1></div><div class="bomb-tools"><span class="bomb-mode">${online ? '온라인 대전' : '봇 연습'} · PC</span></div></header>
  <section class="arcade"><div class="bomb-top"><div><small>MODE</small> <strong>단판</strong></div><span class="bomb-survivors"></span><span class="bomb-clock"></span></div><div class="bomb-layout"><div class="bomb-map"><canvas width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" tabindex="0" aria-label="폭탄전 맵. 방향키 이동, 스페이스바 폭탄 설치"></canvas></div><aside class="bomb-side" aria-label="참가자 상태"></aside></div>
  <div class="bomb-result" hidden role="dialog" aria-modal="true" aria-label="경기 결과" tabindex="-1"><section class="bomb-result-card"></section></div><footer class="bomb-bottom"><div class="keys"><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> 이동 <span>　</span><kbd>SPACE</kbd> 폭탄</div><span class="bomb-spectators"></span><span>마지막 생존자가 승리</span></footer></section><p class="bomb-notice" role="status"></p><details class="bomb-viewers"><summary>관전자 목록</summary><div></div></details></main>`;
  root.querySelector('.bomb-tools')!.append(sound);
  root.querySelector('.bomb-viewers')!.toggleAttribute('hidden', !online); canvas = root.querySelector('canvas'); lastHud = '';
  canvas!.addEventListener('click', () => canvas!.focus());
}
function playEvents(s: State, baseline = false) {
  if (baseline) { lastEvents = s.tick; return; }
  if (s.tick <= lastEvents) return; lastEvents = s.tick;
  for (const event of s.events) {
    if (event.kind === 'blast') audio.play([{ kind: 'spike', side: 'left', x: 0, y: 0 }]);
    else if (event.kind === 'win') audio.playRummikub('win');
    else if (event.kind === 'ko') audio.playRummikub('error');
    else audio.playRummikub(event.kind === 'pickup' ? 'draw' : 'place');
  }
}
function send(bomb = false, turn: Direction = 0) {
  const snap = prediction.snapshot;
  if (!online || !connected || !snap?.started || snap.seat < 0 || snap.result || socket?.readyState !== WebSocket.OPEN) return;
  const input: Input = { direction, bomb, turn };
  const pending = prediction.submit(input);
  socket.send(JSON.stringify({ type: 'INPUT', matchId: snap.matchId, seq: pending.seq, input })); lastSend = prediction.tick;
}
function release() { pressed.length = 0; direction = 0; turnQueued = 0; bombQueued = false; send(); }
window.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (target.closest('select,input,textarea,[contenteditable=true],.bomb-result button') || !canvas || !(event.code in keys || event.code === 'Space')) return;
  event.preventDefault();
  if (event.repeat) return;
  if (event.code in keys) { pressed.push(event.code); direction = keys[event.code]; if (!online) turnQueued = direction; send(false, direction); }
  else { if (online) send(true); else bombQueued = true; }
});
window.addEventListener('keyup', event => {
  if (!(event.code in keys)) return;
  if (canvas) event.preventDefault();
  const index = pressed.indexOf(event.code); if (index >= 0) pressed.splice(index, 1);
  direction = keys[pressed.at(-1) ?? ''] ?? 0; send();
});
window.addEventListener('blur', release);
document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
function hud(s: State) {
  if (!canvas) return;
  const snapshot = prediction.snapshot;
  const remaining = Math.max(0, Math.ceil((COUNTDOWN_TICKS + ROUND_TICKS - s.tick) / TICK_RATE));
  root.querySelector('.bomb-survivors')!.textContent = `생존 ${s.players.filter(p => p.alive).length} / ${s.players.length}`;
  const clock = root.querySelector('.bomb-clock')!; clock.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`; clock.classList.toggle('urgent', remaining <= 15);
  const signature = seats.map((seat, i) => { const p = s.players[i]; return `${seat.name}:${seat.connected}:${p.alive}:${ghost(s,p)}:${p.capacity}:${p.range}:${s.bombs.filter(b=>b.owner===i).length}:${p.eliminatedAt===null ? '' : Math.ceil((GHOST_TICKS-(s.tick-p.eliminatedAt))/60)}`; }).join('|');
  if (signature !== lastHud) {
    lastHud = signature;
    root.querySelector('.bomb-side')!.innerHTML = '<small>PLAYERS / 참가자</small>' + seats.map((seat, i) => {
      const p = s.players[i], status = !p.alive ? ghost(s, p) ? '유령 · 탈락' : `기절 · ${Math.max(0, Math.ceil((GHOST_TICKS - s.tick + p.eliminatedAt!) / 60))}초 후 유령` : seat.connected === false ? '연결 끊김' : seat.bot ? `도도봇 · ${LEVEL_LABELS[seat.bot]}` : i === own ? '나 · 플레이 중' : '플레이 중';
      return `<article class="bomb-player ${i === own ? 'mine' : ''} ${!p.alive ? 'dead' : ''}" style="--seat:${COLORS[i]}"><canvas width="80" height="64" data-profile="${i}"></canvas><div><strong>${i + 1}P · ${escape(seat.name)}</strong><small>${status}</small><div class="bomb-abilities">폭탄 <b>${s.bombs.filter(b => b.owner === i).length}/${p.capacity}</b>　범위 <b>${p.range}칸</b></div></div></article>`;
    }).join('') + '<div class="bomb-legend">기본 폭발 → 각 방향 2칸<br>폭탄 아이템 → 폭탄 수 +1<br>불꽃 아이템 → 범위 +1<br>아이템은 폭발에 사라져요<br>피격 시 탈락 · 5초 후 유령</div>';
    for (const c of root.querySelectorAll<HTMLCanvasElement>('[data-profile]')) { const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.drawImage(profiles[Number(c.dataset.profile)], 0, 0, 80, 64); }
  }
  const result = root.querySelector<HTMLElement>('.bomb-result')!;
  const wasHidden = result.hidden;
  result.hidden = s.phase !== 'finished' && !snapshot?.result;
  if (!result.hidden) {
    const title = snapshot?.result?.aborted ? '경기 중단' : s.winner === null ? s.finishReason === 'timeout' ? '시간 종료 · 무승부' : '동시 전멸 · 무승부' : `${s.winner + 1}P · ${seats[s.winner].name} 승리!`;
    const scores = snapshot?.result?.seatScores ?? settledScores(s.winner,seats);
    const points = snapshot?.result?.aborted ? '' : seats.map((seat,i)=>`${i+1}P · ${seat.name}: ${scores[i]>=0?'+':''}${scores[i]}점`).join(' / ');
    const note = online ? rematch?.status ?? '결과 저장 중…' : '연습 결과는 저장하지 않습니다.';
    const label = online ? rematch?.label ?? '재시작 투표' : '다시 시작';
    const disabled = online && (!connected || !rematch?.canVote);
    const signature = `${title}:${points}:${note}:${label}:${disabled}`;
    if (result.dataset.signature !== signature) {
      result.dataset.signature = signature;
      result.querySelector('.bomb-result-card')!.innerHTML = `<h2>${escape(title)}</h2><p>${escape(points)}</p><p>${escape(note)}</p><button class="primary" ${disabled ? 'disabled' : ''}>${label}</button>`;
      result.querySelector('button')?.addEventListener('click', () => {
        if (online) void rematch?.vote();
        else { release(); local = null; canvas = null; setup(); }
      });
    }
    if (wasHidden) { release(); result.focus(); }
  }
  const myPlayer = own >= 0 ? s.players[own] : null;
  root.querySelector('.bomb-notice')!.textContent = message || (snapshot?.result?.aborted ? snapshot.result.reason! : online && !connected ? '연결이 끊겼습니다. 재연결 중…' : !started ? '참가자가 모두 접속하면 시작합니다.' : s.phase === 'countdown' ? '준비하세요! 방향키로 이동하고 Space로 폭탄을 설치하세요.' : s.phase === 'finished' ? online ? snapshot?.delivered ? '결과 저장 완료 · 결과 창에서 재시작 투표를 해주세요.' : '경기 결과 저장 중…' : '다시 시작을 눌러 새 맵에서 플레이하세요.' : myPlayer && !myPlayer.alive ? ghost(s,myPlayer) ? '유령이 되었습니다. 방향키로 돌아다닐 수 있어요. 폭탄과 아이템은 사용할 수 없습니다.' : '피격되어 탈락했습니다. 5초 뒤 유령이 됩니다.' : '벽을 뚫고 아이템을 모으세요. 폭탄은 2초 뒤 터집니다.');
}
function frame(time: number) {
  if (stopped) return;
  accumulator += Math.min(100, previousTime ? time - previousTime : 0); previousTime = time;
  while (accumulator >= 1000 / TICK_RATE) {
    accumulator -= 1000 / TICK_RATE;
    if (local) {
      const inputs = seats.map((seat, i) => i === own ? { direction, bomb: bombQueued, turn: turnQueued } : botInput(local!, i, seat.bot!));
      bombQueued = false; turnQueued = 0; local = step(local, inputs); playEvents(local);
    } else if (connected) { prediction.advance(); if (prediction.tick - lastSend >= 6) send(); }
  }
  const state = local ?? prediction.view(direction);
  if (canvas && state) {
    const positions=local ? state.players.map(p=>({x:p.x,y:p.y})) : presentation.sample(state,own,time);
    draw(canvas.getContext('2d')!,state,own,started,accumulator/(1000/TICK_RATE),positions);hud(state);
  }
  requestAnimationFrame(frame);
}
function setup() {
  started = false; lastEvents = -1; message = ''; seats = [];
  root.innerHTML = `<section class="bomb-setup"><small class="bomb-eyebrow">DODO ARCADE / BOMB BATTLE</small><h1>도도새 폭탄전</h1><canvas width="120" height="96"></canvas><p>벽을 뚫고, 폭탄을 피하고, 마지막까지 살아남으세요.<br>방향키 이동 · Space 폭탄 설치 · PC 전용</p><label>참가 인원<select id="bomb-count"><option value="2">2인 · 나 + 봇 1명</option><option value="3">3인 · 나 + 봇 2명</option><option value="4" selected>4인 · 나 + 봇 3명</option></select></label><div class="bomb-bot-options"></div><label>맵 패턴<select id="bomb-pattern"><option value="random">랜덤</option>${[0,1,2,3].map(i=>`<option value="${i}">패턴 ${i+1}</option>`).join('')}</select></label><button class="primary" id="bomb-start">게임 시작</button><small>온라인 대전: Discord에서 !게임 폭탄전<br>대기방에서 사람과 봇을 추가할 수 있어요.</small></section>`;
  const ctx = root.querySelector('canvas')!.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.drawImage(profiles[0], 0, 0, 120, 96);
  const options = () => {
    const count = Number(root.querySelector<HTMLSelectElement>('#bomb-count')!.value);
    root.querySelector('.bomb-bot-options')!.innerHTML = Array.from({length: count-1}, (_,i)=>`<label>${i+2}P 도도봇<select data-bot="${i}">${LEVELS.map(l=>`<option value="${l}" ${l==='normal'?'selected':''}>${LEVEL_LABELS[l]}</option>`).join('')}</select></label>`).join('');
  };
  options(); root.querySelector('#bomb-count')!.addEventListener('change', options);
  root.querySelector('.bomb-setup')!.append(sound);
  root.querySelector('#bomb-start')!.addEventListener('click', () => {
    const levels = [...root.querySelectorAll<HTMLSelectElement>('[data-bot]')].map(e => e.value as Level);
    const pattern = root.querySelector<HTMLSelectElement>('#bomb-pattern')!.value;
    seats = [{userId:'local', name:'나', connected:true}, ...levels.map((level,i)=>({userId:null, name:`도도봇 ${i+1}`, bot:level, connected:true}))];
    own = 0; const seed = crypto.getRandomValues(new Uint32Array(1))[0]; local = createGame(seats.length, seed, pattern === 'random' ? undefined : Number(pattern)); started = true;
    mount(); canvas!.focus();
  });
}
async function connectOnline() {
  try {
    const credentials = await authenticate(root, 'bomb_battle'); mount();
    rematch = new RematchVoting(credentials.roomId, credentials.token, () => { const state = prediction.view(direction); if (state) hud(state); });
    const connect = () => {
      if (terminal) return;
      message = '서버에 연결 중…';
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); socket = ws; let hydrated = false;
      ws.onopen = () => ws.send(JSON.stringify({type:'AUTH', ...credentials}));
      ws.onmessage = event => {
        const m = JSON.parse(event.data);
        if (m.type === 'BOMB_STATE') {
          prediction.receive(m, !hydrated); presentation.receive(m.state,m.matchId,performance.now()); playEvents(m.state, !hydrated); hydrated = true; connected = true; retry = 0; message = '';
          seats = m.seats; own = m.seat; started = m.started;
          rematch!.configure(m.matchId, own < 0 ? null : seats[own].userId, seats.filter(s => s.userId !== null).length, m.state.phase === 'finished' || !!m.result, m.delivered);
          if (m.rematch) rematch!.receive(m.rematch);
          root.querySelector('.bomb-mode')!.textContent = own < 0 ? '온라인 관전 · PC' : '온라인 대전 · PC';
          root.querySelector('.bomb-spectators')!.textContent = `관전 ${m.spectators.length}명`;
          const viewers = root.querySelector('.bomb-viewers > div')!; viewers.replaceChildren();
          for (const viewer of m.spectators) { const span = document.createElement('span'); span.textContent = viewer.displayName; span.style.marginRight = '14px'; viewers.append(span); }
        } else if (m.type === 'MATCH_REPLACED') { release(); prediction.snapshot = null; connected = false; ws.close(); }
        else if (m.type === 'REMATCH_STATUS') rematch!.receive(m);
        else if (m.type === 'FINISHED' && prediction.snapshot) { prediction.snapshot.delivered = true; rematch!.saved(); }
        else if (m.type === 'RESULT_PENDING') { if (prediction.snapshot && m.result) prediction.snapshot.result = m.result; }
        else if (m.type === 'ROOM_CLOSED' || m.type === 'ERROR') {
          terminal = m.terminal !== false; message = m.message; connected = false;
          if (!prediction.snapshot) root.textContent = message;
        }
      };
      ws.onclose = () => { connected = false; prediction.disconnect(); pressed.length=0; direction=0; if (terminal) return;
        retry++; if (retry > 12) { terminal = true; message = '연결하지 못했습니다. 새로고침으로 다시 접속해주세요.'; }
        else { message = '연결이 끊겼습니다. 재연결 중…'; reconnect = setTimeout(connect, Math.min(8000, retry * 750)); }
      };
    };
    connect();
  } catch (error) { root.textContent = (error as Error).message; }
}
if (online) void connectOnline(); else setup();
requestAnimationFrame(frame);
window.addEventListener('pagehide', () => { stopped = terminal = true; clearTimeout(reconnect); socket?.close(); }, {once:true});
