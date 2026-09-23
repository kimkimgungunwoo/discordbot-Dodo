import "../style.css";
import { TICK_MS } from "./constants";
import { bindTouchControls, clearInput, readKeyboardInput } from "./input";
import { loadSprites } from "../common/sprites";
import { render } from "./render";
import { bindSoundControl } from "../common/sound-control";
import { createSpectatorBar } from "../common/spectators";
import { GameAudio } from "../common/audio";
import { PracticeSession, type GameSession } from "./session";
import { OnlineSession } from "./online-session";
import { authenticate } from "../discord-session";

const app = document.querySelector<HTMLDivElement>("#app")!;
const params = new URLSearchParams(location.search);
const embedded = params.has("room") || params.has("code") || sessionStorage.getItem("dodo:room") !== null;
let session: GameSession;
try {
  if (embedded) {
    app.textContent = "Discord 연결 중";
    const { roomId, token } = await authenticate(app, "volleyball");
    session = new OnlineSession(roomId, token);
  } else {
    session = new PracticeSession();
  }
} catch (error) {
  app.textContent = error instanceof Error ? error.message : "연결에 실패했습니다.";
  throw error;
}
app.innerHTML = `
  <main class="shell">
    <section class="heading"><h1>도도새배구<span>DODO VOLLEY</span></h1><button id="sound" class="quiet" aria-pressed="false">소리 켜짐 ♪</button></section>
    <section class="arcade" aria-label="도도새배구 게임">
      <div class="scoreboard">
        <div class="competitor"><span class="tag orange">1P</span><div class="player-details"><span id="left-name" class="player-name"></span><small id="left-role"></small></div></div>
        <div class="score"><b id="left-score">0</b><span>7점 선취<small id="phase">READY TO PLAY</small></span><b id="right-score">0</b></div>
        <div class="competitor opponent"><div class="player-details"><span id="right-name" class="player-name"></span><small id="right-role"></small></div><span class="tag blue" id="right-tag">AI</span></div>
      </div>
      <div class="court">
        <canvas id="game" width="960" height="480" aria-label="왼쪽 도도새를 조작해 7점을 먼저 획득하세요"></canvas>
        <div id="overlay" class="overlay">
          <div class="start-card">
            <h2 id="card-title">게임 대기</h2>
            <p id="card-copy" hidden></p>
            <button id="start" class="primary">게임 시작</button>
            <p class="host-note" id="host-note">Enter</p>
          </div>
        </div>
      </div>
      <span id="status" class="connection-status" role="status" aria-live="polite">게임 대기</span>
    </section>
    <section class="guide" aria-label="조작 방법">
      <div><kbd>←</kbd><kbd>→</kbd><span>이동 <small>A / D</small></span></div>
      <div><kbd>↑</kbd><span>점프 <small>W / Space</small></span></div>
      <div><kbd>Z</kbd><span>공중 강타 <small>↑ 띄우기 · ↓ 내리꽂기 · 중립 직선</small></span></div>
      <div><kbd>→</kbd><span>+</span><kbd>Z</kbd><span>다이빙</span></div>
    </section>
    <div class="touch-controls" aria-label="터치 조작"><div><button data-key="ArrowLeft" aria-label="왼쪽 이동">←</button><button data-key="ArrowRight" aria-label="오른쪽 이동">→</button></div><div><button data-key="ArrowUp">점프</button><button data-key="ArrowDown" aria-label="아래 방향 강타">↓</button><button data-key="KeyZ">공격</button></div></div>
  </main>`;

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const sprites = loadSprites();
const audio = new GameAudio();
const overlay = document.querySelector<HTMLDivElement>("#overlay")!;
const start = document.querySelector<HTMLButtonElement>("#start")!;
const sound = document.querySelector<HTMLButtonElement>("#sound")!;
const leftScore = document.querySelector<HTMLElement>("#left-score")!;
const rightScore = document.querySelector<HTMLElement>("#right-score")!;
const phase = document.querySelector<HTMLElement>("#phase")!;
const status = document.querySelector<HTMLElement>("#status")!;
const playerNames = {
  left: document.querySelector<HTMLElement>("#left-name")!,
  right: document.querySelector<HTMLElement>("#right-name")!,
};
const playerRoles = {
  left: document.querySelector<HTMLElement>("#left-role")!,
  right: document.querySelector<HTMLElement>("#right-role")!,
};
let lastScreen = "";
let accumulator = 0;
let last = performance.now();

function requestStart() {
  void audio.unlock();
  if (session.requestStart(session.info.localPlayerId)) {
    clearInput(); accumulator = 0; last = performance.now();
    updateUi();
    start.blur();
  }
}
start.addEventListener("click", requestStart);
window.addEventListener("keydown", event => {
  if (event.code === "Enter" && !event.repeat && event.target !== start && event.target !== sound) requestStart();
});
bindSoundControl(audio, sound);
const renderSpectators = createSpectatorBar(document.querySelector<HTMLElement>(".arcade")!);
bindTouchControls(app);
document.addEventListener("visibilitychange", () => { accumulator = 0; last = performance.now(); });
function updateUi() {
  renderSpectators(session.info.spectators ?? [], session.info.mode === "online");
  const state = session.state;
  for (const side of ["left", "right"] as const) {
    const participant = session.info.players[side];
    playerNames[side].textContent = participant.displayName;
    playerNames[side].title = participant.displayName;
    playerRoles[side].textContent = participant.isCpu ? "CPU · 봇전" : participant.id === session.info.hostPlayerId ? "HOST · 방장" : "PLAYER · 참가자";
  }
  document.querySelector("#right-tag")!.textContent = session.info.players.right.isCpu ? "AI" : "2P";
  leftScore.textContent = String(state.left.score); rightScore.textContent = String(state.right.score);
  const screen = session.stopped ? "stopped" : !session.started ? "lobby" : state.phase;
  const finished = screen === "gameover";
  const isHost = session.info.localPlayerId === session.info.hostPlayerId;
  if (session.info.mode === "online") {
    const isPlayer = isHost || (!session.info.players.right.isCpu && session.info.localPlayerId === session.info.players.right.id);
    start.hidden = !finished || Boolean(session.rematching);
    start.disabled = !isPlayer || !session.canRematch;
    document.querySelector("#host-note")!.textContent = session.rematching ? "재시작중..." : session.message ?? "";
    if (!session.started) document.querySelector("#card-title")!.textContent = "플레이어 연결 대기";
    status.textContent = session.message ?? "";
  } else {
    start.hidden = false;
    start.disabled = !session.info.ready || !isHost;
    document.querySelector("#host-note")!.textContent = !isHost ? "1P의 시작을 기다리는 중" : !session.info.ready ? "참가자 준비 중" : "Enter";
  }
  if (screen === lastScreen) return;
  lastScreen = screen;
  overlay.hidden = screen !== "lobby" && screen !== "stopped" && !finished;
  if (screen === "stopped") {
    document.querySelector("#card-title")!.textContent = "경기 연결 종료";
    document.querySelector<HTMLElement>("#card-copy")!.hidden = true;
  }
  phase.textContent = ({ lobby: "대기", countdown: "준비", playing: "경기 중", point: "득점", gameover: "종료", stopped: "연결 종료" })[screen];
  status.textContent = session.message || phase.textContent;
  if (finished) {
    const winnerName = state.winner ? session.info.players[state.winner].displayName : "";
    document.querySelector("#card-title")!.textContent = winnerName ? winnerName + " 승리" : "경기 중단";
    const copy = document.querySelector<HTMLElement>("#card-copy")!;
    copy.hidden = !state.winner;
    copy.textContent = state.left.score + " : " + state.right.score;
    start.textContent = "재경기";
  }
}
function frame(now: number) {
  const elapsed = Math.min(100, now - last);
  last = now;
  if (!document.hidden) {
    accumulator += elapsed;
    while (accumulator >= TICK_MS) {
      accumulator -= TICK_MS;
      session.advance(readKeyboardInput());
      audio.play(session.consumeEvents());
    }
    updateUi();
    render(ctx, sprites, session.state, !session.started, session.info.players.right.isCpu);
  }
  requestAnimationFrame(frame);
}
updateUi();
render(ctx, sprites, session.state, true, session.info.players.right.isCpu);
requestAnimationFrame(frame);
