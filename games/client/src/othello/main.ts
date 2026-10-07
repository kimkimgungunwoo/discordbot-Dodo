import "../style.css";
import "./style.css";
import { freshBoard, place, chooseMove, counts, isLegalMove, legalMoves, AI_RESPONSE_LIMIT_MS, LABELS, TURN_LIMIT_MS, TOSS_MS, type BoardState, type Difficulty } from "../../../shared/othello";
import { loadSprites } from "../common/sprites";
import { bindSoundControl } from "../common/sound-control";
import { createSpectatorBar, type Spectator } from "../common/spectators";
import { GameAudio } from "../common/audio";
import { authenticate } from "../discord-session";

type Side = "left" | "right";
const root = document.querySelector<HTMLDivElement>("#app")!;
document.title = "도도새오델로";
const params = new URLSearchParams(location.search);
const online = params.has("room") || params.has("code");
let credentials: { roomId: string; token: string } | undefined;
try { if (online) credentials = await authenticate(root, "othello"); }
catch (error) { root.textContent = (error as Error).message; throw error; }
root.innerHTML = `<main class="shell omok-shell">
  <section class="heading"><h1>도도새오델로<span>DODO OTHELLO</span></h1><button id="sound" class="quiet" aria-pressed="false">소리 켜짐 ♪</button></section>
  <section class="arcade" aria-label="오델로 경기">
    <div class="omok-toolbar"><strong id="mode"></strong><span>8 × 8 · 빨강 선공</span><label id="difficulty-label">난이도 <select id="difficulty"><option value="easy">쉬움</option><option value="normal" selected>중간</option><option value="hard">어려움</option><option value="extreme">극한</option><option value="transcendent">초월</option></select></label><span id="move-count">0수</span></div>
    <div class="omok-stage">
      <div class="trainer trainer-top" id="trainer-left"><canvas width="120" height="96" id="portrait-left" aria-hidden="true"></canvas><div class="trainer-text"><strong id="name-left"></strong><small id="role-left"></small><div class="turn-meter"><div class="turn-meter-fill" id="meter-left"></div></div></div></div>
      <div class="board-wrap"><div class="turn-timer" id="turn-timer" role="timer" hidden></div><div class="omok-board" id="board" role="group" aria-label="오델로판, 방향키로 이동하고 Enter로 착수"></div></div>
      <div class="trainer trainer-bottom" id="trainer-right"><canvas width="120" height="96" id="portrait-right" aria-hidden="true"></canvas><div class="trainer-text"><strong id="name-right"></strong><small id="role-right"></small><div class="turn-meter"><div class="turn-meter-fill" id="meter-right"></div></div></div></div>
      <div class="overlay omok-overlay" id="overlay"><div class="start-card"><div class="coin" id="coin" hidden></div><h2 id="title">한 수의 시작</h2><p id="copy">동전을 던져 빨강·파랑을 정합니다.<br>빨간 돌이 먼저 둡니다.</p><button class="primary" id="start">동전 던지고 시작</button></div></div>
    </div>
  </section><div class="omok-footer"><span>상대 돌을 감싸 뒤집으세요 · 마지막 돌 개수로 승패 결정</span><span>둘 곳이 없으면 자동 패스</span></div>
</main>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = new GameAudio();
bindSoundControl(audio, el<HTMLButtonElement>("sound"));
const renderSpectators = createSpectatorBar(document.querySelector<HTMLElement>(".omok-stage")!);
let spectators: Spectator[] = [];
const sprites = loadSprites();
const stickerImages: Record<number, string> = {};
for (const color of [1, 2]) {
  const sticker = document.createElement("canvas");
  sticker.width = 40; sticker.height = 32;
  const ctx = sticker.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  if (color === 2) { ctx.translate(40, 0); ctx.scale(-1, 1); }
  ctx.drawImage(sprites[(color === 1 ? "left" : "right") + "/idle/0"], 0, 0);
  stickerImages[color] = sticker.toDataURL();
}
for (const side of ["left", "right"]) {
  const ctx = el<HTMLCanvasElement>("portrait-" + side).getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  if (side === "right") { ctx.translate(120, 0); ctx.scale(-1, 1); }
  ctx.drawImage(sprites[side + "/idle/0"], 0, 0, 120, 96);
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let animateBoard = false;
let state: BoardState = freshBoard(), blackSide: Side = "left", role = "left", names = { left: "나", right: "도도봇" };
let difficulty: Difficulty = "normal", mode = "CPU", matchId = "", startsAt: number | null = null, turnDeadline: number | null = null;
let ready = !online, connected = !online, started = false, delivered = false, result: any = null;
let socket: WebSocket | undefined, terminal = false, pending = false, voting = false, voteSent = false;
let notice = online ? "Discord 방에 연결 중..." : "동전 던지기로 선후공을 정해보세요.";
let actionError = "";
let localTimer: ReturnType<typeof setTimeout> | undefined;
let localTurnTimer: ReturnType<typeof setTimeout> | undefined;
const cells: HTMLButtonElement[] = [];
const turnSide = () => state.turn === 1 ? blackSide : blackSide === "left" ? "right" : "left";
const canPlay = () => started && ready && connected && !terminal && !result && !state.winner && !state.draw && !pending && startsAt !== null && Date.now() >= startsAt && role === turnSide();
for (let at = 0; at < 64; at++) {
  const button = document.createElement("button"); button.className = "intersection"; button.tabIndex = at === 27 ? 0 : -1;
  button.onclick = () => move(at);
  button.onkeydown = event => {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
    if (offset === undefined) return;
    event.preventDefault(); const next = at + offset;
    if (next >= 0 && next < 64 && (Math.abs(offset) !== 1 || Math.floor(at / 8) === Math.floor(next / 8))) { button.tabIndex = -1; cells[next].tabIndex = 0; cells[next].focus(); }
  };
  cells.push(button); el("board").append(button);
}
function playSound(win = false) { audio.play([{ kind: win ? "win" : "hit", side: "left", x: 0, y: 0 }]); }
const COIN_REVEAL_MS = 2000;
function draw() {
  renderSpectators(spectators, online);
  const tossing = started && startsAt !== null && Date.now() < startsAt;
  const landed = tossing && startsAt !== null && startsAt - Date.now() <= COIN_REVEAL_MS;
  el("mode").textContent = online ? (role === "spectator" ? "관전" : mode === "CPU" ? "봇전" : "친구와 대결") : "혼자 연습";
  el("difficulty-label").hidden = online;
  el<HTMLSelectElement>("difficulty").disabled = started && !result;
  const score = counts(state.board);
  el("move-count").textContent = `빨강 ${score.red} : ${score.blue} 파랑 · ${state.moves.length}수`;
  for (const side of ["left", "right"] as Side[]) {
    const portrait = el<HTMLCanvasElement>("portrait-" + side).getContext("2d")!;
    portrait.save(); portrait.setTransform(1, 0, 0, 1, 0, 0); portrait.clearRect(0, 0, 120, 96);
    if (side === "right") { portrait.translate(120, 0); portrait.scale(-1, 1); }
    portrait.drawImage(sprites[(side === blackSide ? "left" : "right") + "/idle/0"], 0, 0, 120, 96); portrait.restore();
    el("trainer-" + side).classList.toggle("red-side", side === blackSide);
    el("trainer-" + side).classList.toggle("blue-side", side !== blackSide);
    el("name-" + side).textContent = names[side] + (side === "right" && mode === "CPU" ? " · " + LABELS[difficulty] : "");
    el("role-" + side).textContent = !started || (tossing && !landed) ? "빨강·파랑 추첨 대기" : (side === blackSide ? "● 빨간 돌 · 선공" : "○ 파란 돌 · 후공") + (role === side ? " · 나" : "") + (state.passed && !result ? " · " + (state.passed === 1 ? "빨강" : "파랑") + " 자동 패스" : "");
    el("trainer-" + side).classList.toggle("active", started && !tossing && !result && !state.winner && !state.draw && turnSide() === side);
  }
  cells.forEach((cell, at) => {
    const stone = state.board[at];
    const legal = isLegalMove(state.board, at, state.turn);
    cell.className = "intersection" + (state.moves.at(-1) === at ? " last" : "");
    const face = (color: number) => '<span class="token-face ' + (color === 1 ? 'red' : 'blue') + '"><img class="token-sticker" alt="" draggable="false" src="' + stickerImages[color] + '"></span>';
    const markup = stone ? '<span class="othello-token">' + face(stone) + '</span>' : legal && !state.winner && !state.draw ? '<span class="legal-dot"></span>' : '';
    if (cell.dataset.stone !== String(stone)) {
      const old = Number(cell.dataset.stone);
      cell.innerHTML = markup;
      if (animateBoard && old && stone && old !== stone && !reduceMotion.matches) {
        const token = cell.firstElementChild as HTMLElement;
        token.innerHTML = face(old) + face(stone);
        token.classList.add('flipping');
        token.addEventListener('animationend', () => { token.classList.remove('flipping'); token.innerHTML = face(stone); }, { once: true });
      }
      cell.dataset.stone = String(stone);
    } else if (!stone) cell.innerHTML = markup;
    cell.setAttribute("aria-label", String.fromCharCode(65 + at % 8) + (Math.floor(at / 8) + 1) + ', ' + (stone === 1 ? '빨간 돌' : stone === 2 ? '파란 돌' : legal ? '착수 가능' : '빈칸'));
    cell.setAttribute("aria-disabled", String(!canPlay() || !legal));
  });
  animateBoard = false;
  el("overlay").hidden = started && !tossing && !result && !terminal;
  el("coin").hidden = !tossing;
  el("coin").classList.toggle("landed", landed);
  el("coin").classList.toggle("red", landed && blackSide === "left");
  el("coin").classList.toggle("blue", landed && blackSide === "right");
  el("start").hidden = tossing || (online && !result && !terminal) || (online && role === "spectator");
  el<HTMLButtonElement>("start").disabled = voting || voteSent || (online && !terminal && (!delivered || !connected));
  el("start").textContent = terminal ? "다시 연결" : result ? voteSent ? "상대 동의 대기 중" : "재경기 · 다시 동전 던지기" : "동전 던지고 시작";
  if (terminal) { el("title").textContent = "연결 안내"; el("copy").textContent = notice; }
  else if (landed) { el("title").textContent = names[blackSide] + " 선공 · 빨간 돌"; el("copy").textContent = "곧 대국이 시작됩니다."; }
  else if (tossing) { el("title").textContent = "동전 던지는 중"; el("copy").textContent = "누가 먼저 둘까요?"; }
  else if (result) {
    el("title").textContent = result.aborted ? "경기 중단" : result.winnerSide === "draw" ? "무승부" : names[result.winnerSide as Side] + " 승리";
    el("copy").textContent = actionError || (result.aborted ? result.reason ?? "연결이 종료되었습니다." : `빨강 ${counts(state.board).red} : ${counts(state.board).blue} 파랑`);
  } else { el("title").textContent = online ? "플레이어 연결 대기" : "한 수의 시작"; el("copy").textContent = "동전으로 빨강·파랑을 정하고, 빨간 돌부터 시작합니다."; }
}
const RESULT_REVEAL_DELAY_MS = 2000;
function finishLocal() {
  if (state.winner || state.draw) {
    playSound(true);
    const outcome = { winnerSide: state.draw ? "draw" : state.winner === 1 ? blackSide : blackSide === "left" ? "right" : "left" };
    setTimeout(() => { result = outcome; delivered = true; draw(); }, RESULT_REVEAL_DELAY_MS);
  }
}
let cpuWorker: Worker | undefined;
function localCpu() {
  if (localTimer) clearTimeout(localTimer);
  if (result || state.winner || state.draw || turnSide() !== "right") return;
  localTimer = setTimeout(() => {
    const requestState = state;
    const finish = (at: number) => {
      if (state !== requestState || result) return;
      animateBoard = true; state = place(state, at); finishLocal(); localCpu(); localTurnTimeout(); draw();
    };
    cpuWorker?.terminate();
    try {
      const worker = new Worker(new URL("./ai-worker.ts", import.meta.url), { type: "module" });
      cpuWorker = worker;
      let best: number | undefined;
      const timeout = setTimeout(() => fallback(), AI_RESPONSE_LIMIT_MS);
      const cleanup = () => { clearTimeout(timeout); worker.terminate(); if (cpuWorker === worker) cpuWorker = undefined; };
      const fallback = () => { cleanup(); if (state === requestState && !result) finish(best ?? chooseMove(requestState, "normal")); };
      worker.onmessage = event => {
        const { type, move } = event.data;
        if (!isLegalMove(requestState.board, move, requestState.turn)) { fallback(); return; }
        best = move;
        if (type === "result") { cleanup(); finish(move); }
      };
      worker.onerror = fallback;
      worker.postMessage({ state: requestState, difficulty });
    } catch { finish(chooseMove(requestState, "normal")); }
  }, Math.max(550, (startsAt ?? 0) - Date.now() + 550));
}
function localTurnTimeout() {
  if (localTurnTimer) { clearTimeout(localTurnTimer); localTurnTimer = undefined; }
  if (result || state.winner || state.draw || turnSide() !== "left") { turnDeadline = null; return; }
  const delay = Math.max(0, (startsAt ?? 0) - Date.now()) + TURN_LIMIT_MS;
  turnDeadline = Date.now() + delay;
  localTurnTimer = setTimeout(() => {
    localTurnTimer = undefined;
    if (result) return;
    const empty = legalMoves(state.board, state.turn);
    move(empty[Math.floor(Math.random() * empty.length)]);
  }, delay);
}
function move(at: number) {
  if (!canPlay() || state.board[at]) return;
  void audio.unlock(); notice = "";
  if (!isLegalMove(state.board, at, state.turn)) return;
  animateBoard = true;
  if (online) { pending = true; socket?.send(JSON.stringify({ type: "MOVE", matchId, revision: state.moves.length, at })); }
  else { state = place(state, at); finishLocal(); localCpu(); localTurnTimeout(); }
  draw();
}
el("start").onclick = async () => {
  void audio.unlock();
  if (terminal) { location.href = "/othello" + (credentials ? "?room=" + encodeURIComponent(credentials.roomId) : ""); return; }
  if (!online) {
    animateBoard = false; cells.forEach(c => { delete c.dataset.stone; c.innerHTML = ""; }); state = freshBoard(); notice = ""; blackSide = crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? "left" : "right";
    startsAt = Date.now() + TOSS_MS; started = true; result = null; difficulty = el<HTMLSelectElement>("difficulty").value as Difficulty; localCpu(); localTurnTimeout(); draw(); return;
  }
  if (voting || !credentials) return;
  voting = true; actionError = ""; draw();
  try {
    const response = await fetch("/api/rematch", { method: "POST", headers: { Authorization: "Bearer " + credentials.token, "content-type": "application/json" }, body: JSON.stringify({ roomId: credentials.roomId, matchId }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "재경기 요청 실패");
    if (response.status === 202) voteSent = true;
  } catch (error) { actionError = (error as Error).message; }
  finally { voting = false; draw(); }
};
let resultRevealTimer: ReturnType<typeof setTimeout> | undefined;
function revealResult(next: any, nextDelivered: boolean) {
  delivered = nextDelivered;
  if (!next) { result = null; if (resultRevealTimer) { clearTimeout(resultRevealTimer); resultRevealTimer = undefined; } return; }
  if (result || resultRevealTimer) return;
  resultRevealTimer = setTimeout(() => { resultRevealTimer = undefined; result = next; draw(); }, RESULT_REVEAL_DELAY_MS);
}
let hasSnapshot = false;
function connect() {
  hasSnapshot = false;
  if (!credentials || terminal) return;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`); socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: "AUTH", ...credentials }));
  ws.onmessage = event => {
    if (socket !== ws) return;
    const message = JSON.parse(event.data);
    if (message.type === "OTHELLO_JOIN") { role = message.role; connected = true; pending = false; }
    if (message.type === "OTHELLO_STATE") {
      if (matchId && matchId !== message.matchId) {
        voting = false; voteSent = false; actionError = "";
        if (resultRevealTimer) { clearTimeout(resultRevealTimer); resultRevealTimer = undefined; }
      }
      animateBoard = hasSnapshot && matchId === message.matchId && message.state.moves.length === state.moves.length + 1;
      hasSnapshot = true; spectators = message.spectators ?? [];
      state = message.state; blackSide = message.blackSide; names = message.players; // 서버 시각 기준 타임스탬프를 로컬 시계로 환산 (기기 시계가 틀어져 있어도 동전/타이머가 맞도록)
      const skew = Date.now() - (message.now ?? Date.now());
      startsAt = message.startsAt === null ? null : message.startsAt + skew; turnDeadline = message.turnDeadline == null ? null : message.turnDeadline + skew;
      started = startsAt !== null; ready = message.ready; matchId = message.matchId; mode = message.room.mode; difficulty = message.room.difficulty ?? "normal";
      revealResult(message.result, message.delivered); pending = false;
    } else if (message.type === "MOVE_REJECTED") { pending = false; notice = "착수:" + message.message; }
    else if (message.type === "OTHELLO_CONNECTION") ready = message.ready;
    else if (message.type === "FINISHED") { revealResult(message.result, true); }
    else if (message.type === "RESULT_PENDING" && message.result) revealResult(message.result, delivered);
    else if (message.type === "MATCH_REPLACED") { socket = undefined; ws.close(); connect(); return; }
    else if (message.type === "ROOM_CLOSED" || message.type === "ERROR" || message.type === "GAME_START") {
      terminal = true; connected = false; notice = message.message ?? "오델로 방 링크로 접속해주세요.";
      if (message.type === "ERROR") sessionStorage.removeItem("dodo:token");
      ws.close();
    }
    draw();
  };
  ws.onclose = () => {
    if (socket !== ws || terminal) return;
    connected = false; pending = false; spectators = []; notice = "연결이 끊겼습니다. 다시 연결 중..."; draw();
    setTimeout(connect, 1800);
  };
}
function tickTimer() {
  const remaining = !terminal && turnDeadline !== null ? Math.ceil((turnDeadline - Date.now()) / 1000) : null;
  const show = remaining !== null && remaining > 0 && remaining <= 10;
  el("turn-timer").hidden = !show;
  if (show) el("turn-timer").textContent = `${remaining}초 안에 두지 않으면 무작위로 착수됩니다`;
  for (const side of ["left", "right"] as Side[]) {
    const active = started && !terminal && turnDeadline !== null && turnSide() === side;
    const fraction = active ? Math.max(0, Math.min(1, (turnDeadline! - Date.now()) / TURN_LIMIT_MS)) : 1;
    el("meter-" + side).style.width = fraction * 100 + "%";
  }
}
let wasTossing = false, wasLanded = false;
setInterval(() => {
  const tossing = started && startsAt !== null && Date.now() < startsAt;
  const landed = tossing && startsAt !== null && startsAt - Date.now() <= COIN_REVEAL_MS;
  if (tossing !== wasTossing || landed !== wasLanded) { wasTossing = tossing; wasLanded = landed; draw(); }
  tickTimer();
}, 100);
draw(); tickTimer(); if (online) connect();
