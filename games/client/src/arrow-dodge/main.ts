import "../style.css";
import "./style.css";
import { GameAudio } from "../common/audio";
import { bindSoundControl } from "../common/sound-control";
import { createSpectatorBar } from "../common/spectators";
import { loadSprites } from "../common/sprites";
import { authenticate } from "../discord-session";
import { TICK_MS } from "./constants";
import { bindTouch, readInput } from "./input";
import { render } from "./render";
import { OnlineSession, PracticeSession, type Session } from "./session";

const root = document.querySelector<HTMLDivElement>("#app")!;
document.title = "도도새 화살피하기";
const params = new URLSearchParams(location.search);
const online = params.has("room") || params.has("code") || sessionStorage.getItem("dodo:arrow_dodge:room") !== null;
let session: Session;
try {
  if (online) {
    root.textContent = "Discord 연결 중";
    const credentials = await authenticate(root, "arrow_dodge");
    session = new OnlineSession(credentials.roomId, credentials.token);
  } else session = new PracticeSession();
} catch (error) {
  root.textContent = error instanceof Error ? error.message : "연결에 실패했습니다.";
  throw error;
}

root.innerHTML = `<main class="shell arrow-shell">
  <section class="heading"><h1>도도새 화살피하기<span>DODO ARROW DODGE</span></h1><button id="sound" class="quiet" aria-pressed="false">소리 켜기 ♪</button></section>
  <section class="arrow-arcade" aria-label="도도새 화살피하기 게임">
    <div class="arrow-stage">
      <canvas id="game" width="960" height="768" aria-label="방향키 또는 WASD로 도도새를 움직여 화살을 피하세요"></canvas>
      <div class="score-panel">
        <div class="survival-time"><small>TIME</small><strong id="time">0.00</strong><span>초</span></div>
        <div class="personal-best"><small>내 최고점수</small><strong id="best-score">0.00초</strong></div>
      </div>
      <div class="overlay" id="overlay"><div class="start-card">
        <h2 id="title">화살 피하기</h2>
        <p id="copy">사방에서 날아오는 화살을 피해<br>최대한 오래 살아남으세요.</p>
        <button class="primary" id="start">게임 시작</button>
        <p class="host-note" id="note">누르면 2초 뒤 시작</p>
      </div></div>
    </div>

  </section>
  <section class="arrow-guide"><span><kbd>WASD</kbd> 또는 <kbd>방향키</kbd> 이동</span><span>대각선 이동 가능</span></section>
  <div class="arrow-touch" aria-label="터치 조작">
    <button data-move="ArrowUp" aria-label="위">↑</button><button data-move="ArrowLeft" aria-label="왼쪽">←</button>
    <button data-move="ArrowDown" aria-label="아래">↓</button><button data-move="ArrowRight" aria-label="오른쪽">→</button>
  </div>
</main>`;

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const sprites = loadSprites();
const audio = new GameAudio();
const overlay = document.querySelector<HTMLDivElement>("#overlay")!;
const title = document.querySelector<HTMLElement>("#title")!;
const copy = document.querySelector<HTMLElement>("#copy")!;
const start = document.querySelector<HTMLButtonElement>("#start")!;
const note = document.querySelector<HTMLElement>("#note")!;
const time = document.querySelector<HTMLElement>("#time")!;
const bestScore = document.querySelector<HTMLElement>("#best-score")!;
const sound = document.querySelector<HTMLButtonElement>("#sound")!;
const renderSpectators = createSpectatorBar(document.querySelector<HTMLElement>(".arrow-stage")!);
bindTouch(root);
bindSoundControl(audio, sound);

function requestStart() { void audio.unlock(); if (session.requestStart()) start.blur(); updateUi(); }
start.addEventListener("click", requestStart);
window.addEventListener("keydown", event => {
  if (event.code === "Enter" && !event.repeat && event.target !== start) requestStart();
});

function updateUi() {
  const state = session.state;
  time.textContent = (state.survivalTicks / 60).toFixed(2);
  const currentScore = Math.round(state.survivalTicks * 1000 / 60);
  bestScore.textContent = `${(Math.max(session.bestScore, currentScore) / 1000).toFixed(2)}초`;
  renderSpectators(session.spectators, session.online);
  const gameover = state.phase === "gameover";
  const waiting = state.phase === "ready";
  overlay.hidden = !waiting && !gameover && !session.stopped;
  if (session.stopped) {
    title.textContent = "게임 연결 종료"; copy.textContent = session.message; start.hidden = true; return;
  }
  if (gameover) {
    title.textContent = "GAME OVER";
    copy.innerHTML = `생존 시간<br><strong>${(state.survivalTicks / 60).toFixed(2)}초</strong>`;
    start.textContent = "다시 시작";
    start.hidden = session.role === "spectator";
    start.disabled = session.online && (!session.completed || session.rematching);
    note.textContent = session.role === "spectator" ? "플레이어의 재시작을 기다리는 중" : session.message;
  } else if (waiting) {
    title.textContent = session.role === "spectator" ? "관전 대기" : "화살 피하기";
    copy.innerHTML = session.role === "spectator" ? "플레이어가 시작하면<br>관전이 시작됩니다." : "사방에서 날아오는 화살을 피해<br>최대한 오래 살아남으세요.";
    start.textContent = "게임 시작";
    start.hidden = session.role === "spectator";
    start.disabled = !session.ready;
    note.textContent = session.ready ? "누르면 2초 뒤 시작" : session.message;
  }
}

let last = performance.now(), accumulator = 0;
let lastAudioTick = session.state.tick;
let lastArrowId = session.state.nextArrowId - 1;
function playNewArrowSounds(previousTick: number) {
  const state = session.state;
  if (state.tick < previousTick || state.nextArrowId - 1 < lastArrowId) lastArrowId = 0;
  const newestId = state.nextArrowId - 1;
  // 재접속 관전의 과거 프레임은 한 번에 재생될 수 있으므로 실시간 진행에서만 소리를 낸다.
  if (state.tick - previousTick <= 2 && newestId > lastArrowId) audio.playArrowVolley(newestId - lastArrowId);
  lastArrowId = newestId; lastAudioTick = state.tick;
}
function frame(now: number) {
  accumulator += Math.min(100, now - last); last = now;
  while (accumulator >= TICK_MS) {
    accumulator -= TICK_MS;
    const previousTick = lastAudioTick;
    session.advance(readInput());
    playNewArrowSounds(previousTick);
  }
  updateUi(); render(ctx, sprites, session.state);
  requestAnimationFrame(frame);
}
updateUi(); render(ctx, sprites, session.state); requestAnimationFrame(frame);
