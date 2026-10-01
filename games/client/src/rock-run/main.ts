import { GameAudio } from '../common/audio';
import { bindSoundControl } from '../common/sound-control';
import { playRunSounds } from './audio';
import { ActionInput } from './input';
import '../style.css';
import './style.css';
import { courseFor, endlessCourseFor, stageProgress } from '../../../shared/rock-run';
import { TICK_RATE } from '../../../shared/rock-run-config';
import { loadSprites } from '../common/sprites';
import { authenticate } from '../discord-session';
import { PracticeSession, OnlineSession, type Session } from './session';
import { makeSky, render } from './render';

const root = document.querySelector<HTMLDivElement>('#app')!;
document.title = '도도새 바위 달리기';
const params = new URLSearchParams(location.search);
let session: Session;
if (params.has('room') || params.has('code') || sessionStorage.getItem('dodo:rock_run:room')) {
  try { const auth = await authenticate(root, 'rock_run'); session = new OnlineSession(auth.roomId, auth.token); }
  catch (error) { root.textContent = String(error); throw error; }
} else session = new PracticeSession(params.get('mode') === 'endless' ? 'endless' : 'normal');
root.innerHTML = `<main class="shell"><section class="heading"><h1>도도새 바위 달리기<span>DODO ROCK RUN</span></h1><button id="sound" class="quiet">소리 켜기 ♪</button></section>
<section class="arcade"><div class="scoreboard"><div><b id="score">0</b><small id="best"></small></div><div class="run-stage"><b id="stage">STAGE 1 / 6</b><small id="clock">0:00</small></div><span id="mode">일반 모드</span></div>
<div class="court"><canvas id="game" width="960" height="480" aria-label="점프와 와이어로 바위산을 건너세요"></canvas>
<div class="overlay" id="overlay"><div class="start-card"><h2 id="title">바위산을 건너라!</h2><p id="copy">6단계 코스를 달리며 동전을 모으세요.</p><button class="primary" id="start">게임 시작</button><p id="note" class="host-note">2초 뒤 출발</p></div></div></div>
<div class="run-progress" id="run-progress" aria-label="코스 진행률"><div id="progress"></div><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>GOAL</span></div></section>
<section class="guide"><div><kbd>Space</kbd><span>또는 화면 누르기<br>지상: 점프 · 공중: 다시 눌러 와이어 · 연결 후 누르기: 상승 · 놓기: 하강<br>발사 중 놓으면 취소 · 스윙 끝 자동 해제 · 공중에서 다시 발사</span></div></section></main>`;
const canvas = document.querySelector<HTMLCanvasElement>('#game')!, ctx = canvas.getContext('2d')!;
const sprites = loadSprites(), sky = makeSky(sprites);
const el = (id: string) => document.getElementById(id)!;
const button = el('start') as HTMLButtonElement;
const audio = new GameAudio();
bindSoundControl(audio, el("sound") as HTMLButtonElement);
const actionInput = new ActionInput();
const timeText = (milliseconds: number) => `${Math.floor(milliseconds/60000)}:${String(Math.floor(milliseconds/1000)%60).padStart(2,'0')}.${String(Math.floor(milliseconds/10)%100).padStart(2,'0')}`;
let wasOver = false;
button.onclick = () => { actionInput.reset(); session.requestStart(); button.blur(); };
window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat && session.state.phase !== 'ready') actionInput.set(true); } if (e.code === 'Enter' && !e.repeat && e.target !== button) button.click(); });
window.addEventListener('keyup', e => { if (e.code === 'Space') { actionInput.set(false); e.preventDefault(); } });
canvas.addEventListener('pointerdown', e => { e.preventDefault(); actionInput.set(true); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => actionInput.set(false));
canvas.addEventListener('pointercancel', () => actionInput.reset());
window.addEventListener('blur', () => actionInput.reset());
let last = performance.now(), accumulator = 0;
function frame(now: number) {
  accumulator += Math.min(100, now - last); last = now;
  while (accumulator >= 1000 / TICK_RATE) { accumulator -= 1000 / TICK_RATE; const before = session.state; session.advance({ hit: actionInput.next() }); playRunSounds(audio, before, session.state); }
  const s = session.state, over = s.phase === 'gameover';
  if (over && !wasOver) actionInput.reset(); wasOver = over;
  const endless=s.mode==='endless', elapsedMs=Math.round(s.elapsed*1000/TICK_RATE), current=endless?elapsedMs:s.score;
  el('score').textContent = endless ? timeText(elapsedMs) : s.score.toLocaleString();
  el('best').textContent = `${session.role === 'spectator' ? '플레이어 최고기록' : '내 최고기록'} ${endless ? timeText(Math.max(session.bestScore,current)) : `${Math.max(session.bestScore,current).toLocaleString()}점`}`;
  el('stage').textContent = endless ? 'ENDLESS' : `STAGE ${s.stage + 1} / 6`;
  el('clock').textContent = `${Math.floor(s.elapsed / (TICK_RATE*60))}:${String(Math.floor(s.elapsed / TICK_RATE) % 60).padStart(2, '0')}`;
  const COURSE = endless ? endlessCourseFor(s.seed,s.x) : courseFor(s.seed);
  el('progress').style.width = `${endless ? 0 : stageProgress(s,COURSE)}%`;
  el('run-progress').hidden = endless;
  el('mode').textContent = endless ? '엔드리스 · 4단계 속도' : '일반 모드';
  el('overlay').hidden = s.phase !== 'ready' && !over && !session.stopped;
  el('title').textContent = session.stopped ? '연결 종료' : over ? s.cleared ? '완주 성공!' : 'GAME OVER' : '바위산을 건너라!';
  el('copy').textContent = over ? (endless ? `${timeText(elapsedMs)} 생존 · 다시 도전해보세요` : `${s.score.toLocaleString()}점 · ${s.stage + 1}단계 · ${s.cleared ? '코스 클리어' : '다시 도전해보세요'}`) : '공중에서 다시 눌러 와이어 발사. 연결 후 누르면 상승하고 놓으면 하강합니다.';
  button.textContent = over ? '다시 시작' : '게임 시작';
  button.hidden = session.role === 'spectator' || session.stopped;
  button.disabled = !session.ready || (session.online && over && (!session.completed || session.rematching));
  el('note').textContent = session.role === 'spectator' ? '플레이어 관전 중' : over ? session.message : endless ? '2초 뒤 출발 · 추락할 때까지 최대한 오래 달리세요' : '2초 뒤 출발 · 동전과 단계 보너스 최대 100,000점';
  render(ctx, sprites, sky, s); requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { actionInput.reset(); last = performance.now(); accumulator = 0; });
requestAnimationFrame(frame);
