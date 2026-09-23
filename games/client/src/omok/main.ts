import "../style.css";
import "./style.css";
import { freshBoard, place, chooseMove, LABELS, TURN_LIMIT_MS, TOSS_MS, type BoardState, type Difficulty } from "../../../shared/omok";
import { loadSprites } from "../common/sprites";
import { GameAudio } from "../common/audio";
import { authenticate } from "../discord-session";

type Side = "left" | "right";
const root = document.querySelector<HTMLDivElement>("#app")!;
document.title = "도도새오목";
const params = new URLSearchParams(location.search);
const online = params.has("room") || params.has("code");
let credentials: { roomId: string; token: string } | undefined;
try { if (online) credentials = await authenticate(root, "omok"); }
catch (error) { root.textContent = (error as Error).message; throw error; }
root.innerHTML = `<main class="shell omok-shell">
  <section class="heading"><h1>도도새오목<span>DODO GOMOKU</span></h1><button id="sound" class="quiet" aria-pressed="false">소리 켜짐 ♪</button></section>
  <section class="arcade" aria-label="오목 경기">
    <div class="omok-toolbar"><strong id="mode"></strong><span>15 × 15 · 자유룰</span><label id="difficulty-label">난이도 <select id="difficulty"><option value="easy">쉬움</option><option value="normal" selected>중간</option><option value="hard">어려움</option><option value="extreme">극한</option><option value="transcendent">초월</option></select></label><span id="move-count">0수</span></div>
    <div class="omok-stage">
      <div class="trainer trainer-top" id="trainer-left"><canvas width="120" height="96" id="portrait-left" aria-hidden="true"></canvas><div class="trainer-text"><strong id="name-left"></strong><small id="role-left"></small><div class="turn-meter"><div class="turn-meter-fill" id="meter-left"></div></div></div></div>
      <div class="turn-timer" id="turn-timer" role="timer" hidden></div>
      <div class="board-wrap"><div class="omok-board" id="board" role="group" aria-label="오목판, 방향키로 이동하고 Enter로 착수"></div></div>
      <div class="trainer trainer-bottom" id="trainer-right"><canvas width="120" height="96" id="portrait-right" aria-hidden="true"></canvas><div class="trainer-text"><strong id="name-right"></strong><small id="role-right"></small><div class="turn-meter"><div class="turn-meter-fill" id="meter-right"></div></div></div></div>
      <div class="overlay omok-overlay" id="overlay"><div class="start-card"><div class="coin" id="coin" hidden></div><h2 id="title">한 수의 시작</h2><p id="copy">동전을 던져 흑백을 정합니다.<br>흑돌이 먼저 둡니다.</p><button class="primary" id="start">동전 던지고 시작</button></div></div>
    </div><div class="omok-status" id="status" role="status" aria-live="polite"></div>
  </section><div class="omok-footer"><span>가로 · 세로 · 대각선 5개 이상 연결하면 승리</span><span>금수 없음 · 마지막 수는 주황 표시</span></div>
</main>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = new GameAudio();
let muted = false;
el("sound").onclick = () => { muted = !muted; audio.muted = muted; el("sound").textContent = muted ? "소리 꺼짐" : "소리 켜짐 ♪"; el("sound").setAttribute("aria-pressed", String(muted)); };
const sprites = loadSprites();
for (const side of ["left", "right"]) {
  const ctx = el<HTMLCanvasElement>("portrait-" + side).getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  if (side === "right") { ctx.translate(120, 0); ctx.scale(-1, 1); }
  ctx.drawImage(sprites[side + "/idle/0"], 0, 0, 120, 96);
}
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
for (let at = 0; at < 225; at++) {
  const button = document.createElement("button"); button.className = "intersection"; button.tabIndex = at === 112 ? 0 : -1;
  button.onclick = () => move(at);
  button.onkeydown = event => {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -15, ArrowDown: 15 }[event.key];
    if (offset === undefined) return;
    event.preventDefault(); const next = at + offset;
    if (next >= 0 && next < 225 && (Math.abs(offset) !== 1 || Math.floor(at / 15) === Math.floor(next / 15))) { button.tabIndex = -1; cells[next].tabIndex = 0; cells[next].focus(); }
  };
  cells.push(button); el("board").append(button);
}
function playSound(win = false) { audio.play([{ kind: win ? "win" : "hit", side: "left", x: 0, y: 0 }]); }
const COIN_REVEAL_MS = 2000;
function draw() {
  const tossing = started && startsAt !== null && Date.now() < startsAt;
  const landed = tossing && startsAt !== null && startsAt - Date.now() <= COIN_REVEAL_MS;
  el("mode").textContent = online ? (role === "spectator" ? "관전" : mode === "CPU" ? "봇전" : "친구와 대결") : "혼자 연습";
  el("difficulty-label").hidden = online;
  el<HTMLSelectElement>("difficulty").disabled = started && !result;
  el("move-count").textContent = state.moves.length + "수";
  for (const side of ["left", "right"] as Side[]) {
    el("name-" + side).textContent = names[side] + (side === "right" && mode === "CPU" ? " · " + LABELS[difficulty] : "");
    el("role-" + side).textContent = !started || (tossing && !landed) ? "흑백 추첨 대기" : (side === blackSide ? "● 흑돌 · 선공" : "○ 백돌 · 후공") + (role === side ? " · 나" : "");
    el("trainer-" + side).classList.toggle("active", started && !tossing && !result && !state.winner && !state.draw && turnSide() === side);
  }
  cells.forEach((cell, at) => {
    const stone = state.board[at];
    cell.className = "intersection" + ([48, 56, 112, 168, 176].includes(at) ? " star" : "") + (state.moves.at(-1) === at ? " last" : "") + (state.line.includes(at) ? " winning" : "");
    cell.innerHTML = stone ? `<span class="stone ${stone === 1 ? "black" : "white"}"></span>` : canPlay() ? `<span class="stone ghost ${state.turn === 1 ? "black" : "white"}"></span>` : "";
    cell.setAttribute("aria-label", `${String.fromCharCode(65 + at % 15)}${Math.floor(at / 15) + 1}, ${stone === 1 ? "흑돌" : stone === 2 ? "백돌" : "빈칸"}`);
    cell.setAttribute("aria-disabled", String(!canPlay() || !!stone));
  });
  el("overlay").hidden = started && !tossing && !result && !terminal;
  el("coin").hidden = !tossing;
  el("coin").classList.toggle("landed", landed);
  el("coin").classList.toggle("red", landed && blackSide === "left");
  el("coin").classList.toggle("blue", landed && blackSide === "right");
  el("start").hidden = tossing || (online && !result && !terminal) || (online && role === "spectator");
  el<HTMLButtonElement>("start").disabled = voting || voteSent || (online && !terminal && (!delivered || !connected));
  el("start").textContent = terminal ? "다시 연결" : result ? voteSent ? "상대 동의 대기 중" : "재경기 · 다시 동전 던지기" : "동전 던지고 시작";
  if (terminal) { el("title").textContent = "연결 안내"; el("copy").textContent = notice; }
  else if (landed) { el("title").textContent = names[blackSide] + " 선공 · 흑돌"; el("copy").textContent = "곧 대국이 시작됩니다."; }
  else if (tossing) { el("title").textContent = "동전 던지는 중"; el("copy").textContent = "누가 먼저 둘까요?"; }
  else if (result) {
    el("title").textContent = result.aborted ? "경기 중단" : result.winnerSide === "draw" ? "무승부" : names[result.winnerSide as Side] + " 승리";
    el("copy").textContent = actionError || (result.aborted ? result.reason ?? "연결이 종료되었습니다." : `${state.moves.length}수 만에 대국이 끝났습니다.`);
  } else { el("title").textContent = online ? "플레이어 연결 대기" : "한 수의 시작"; el("copy").textContent = "동전으로 흑백을 정하고, 흑돌부터 시작합니다."; }
  el("status").textContent = terminal || !connected ? notice : result ? (online && !delivered ? "결과를 Discord에 전송 중..." : voteSent ? "상대의 재경기 동의를 기다립니다." : "대국이 끝났습니다.") : !started ? notice : tossing ? "동전 던지기로 흑백을 정하고 있습니다." : !ready ? "상대의 재접속을 기다립니다." : state.winner || state.draw ? "대국이 끝났습니다." : (role === "spectator" ? "관전 중 · " : "") + `${names[turnSide()]}의 차례 · ${state.turn === 1 ? "흑돌" : "백돌"}` + (notice.startsWith("착수:") ? " · " + notice.slice(3) : "");
}
const RESULT_REVEAL_DELAY_MS = 2000;
function finishLocal() {
  if (state.winner || state.draw) {
    playSound(true);
    // 승부가 갈린 순간 바로 안내창을 덮지 않고, 완성된 5줄이 보이는 보드를 잠깐 먼저 보여준다.
    const outcome = { winnerSide: state.draw ? "draw" : state.winner === 1 ? blackSide : blackSide === "left" ? "right" : "left" };
    setTimeout(() => { result = outcome; delivered = true; draw(); }, RESULT_REVEAL_DELAY_MS);
  }
}
function localCpu() {
  if (localTimer) clearTimeout(localTimer);
  if (result || turnSide() !== "right") return;
  localTimer = setTimeout(() => { state = place(state, chooseMove(state, difficulty)); playSound(); finishLocal(); localTurnTimeout(); draw(); }, Math.max(550, (startsAt ?? 0) - Date.now() + 550));
}
// 온라인 대국은 서버가 45초 턴 제한을 돌리지만(omok-room.ts), 혼자 연습 모드엔 서버가 없어서
// 여기서 같은 규칙을 흉내낸다 — 내 차례에만 걸고, CPU 차례는 이미 localCpu()가 더 빠르게 처리한다.
function localTurnTimeout() {
  if (localTurnTimer) { clearTimeout(localTurnTimer); localTurnTimer = undefined; }
  if (result || turnSide() !== "left") { turnDeadline = null; return; }
  const delay = Math.max(0, (startsAt ?? 0) - Date.now()) + TURN_LIMIT_MS;
  turnDeadline = Date.now() + delay;
  localTurnTimer = setTimeout(() => {
    localTurnTimer = undefined;
    if (result) return;
    const empty: number[] = []; state.board.forEach((stone, at) => { if (!stone) empty.push(at); });
    move(empty[Math.floor(Math.random() * empty.length)]);
  }, delay);
}
function move(at: number) {
  if (!canPlay() || state.board[at]) return;
  void audio.unlock(); notice = "";
  if (online) { pending = true; socket?.send(JSON.stringify({ type: "MOVE", matchId, revision: state.moves.length, at })); }
  else { state = place(state, at); playSound(); finishLocal(); localCpu(); localTurnTimeout(); }
  draw();
}
el("start").onclick = async () => {
  void audio.unlock();
  if (terminal) { location.href = "/omok" + (credentials ? "?room=" + encodeURIComponent(credentials.roomId) : ""); return; }
  if (!online) {
    state = freshBoard(); notice = ""; blackSide = crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? "left" : "right";
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
// 승부가 갈린 순간 바로 안내창을 덮지 않고, 완성된 5줄이 보이는 보드를 잠깐 먼저 보여준다.
function revealResult(next: any, nextDelivered: boolean) {
  delivered = nextDelivered;
  if (!next) { result = null; if (resultRevealTimer) { clearTimeout(resultRevealTimer); resultRevealTimer = undefined; } return; }
  if (result || resultRevealTimer) return;
  resultRevealTimer = setTimeout(() => { resultRevealTimer = undefined; result = next; draw(); }, RESULT_REVEAL_DELAY_MS);
}
function connect() {
  if (!credentials || terminal) return;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`); socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: "AUTH", ...credentials }));
  ws.onmessage = event => {
    if (socket !== ws) return;
    const message = JSON.parse(event.data);
    if (message.type === "OMOK_JOIN") { role = message.role; connected = true; pending = false; }
    if (message.type === "OMOK_STATE") {
      if (matchId && matchId !== message.matchId) {
        voting = false; voteSent = false; actionError = "";
        if (resultRevealTimer) { clearTimeout(resultRevealTimer); resultRevealTimer = undefined; }
      }
      if (matchId === message.matchId && message.state.moves.length > state.moves.length) playSound(!!message.state.winner);
      state = message.state; blackSide = message.blackSide; names = message.players; startsAt = message.startsAt; turnDeadline = message.turnDeadline ?? null;
      started = startsAt !== null; ready = message.ready; matchId = message.matchId; mode = message.room.mode; difficulty = message.room.difficulty ?? "normal";
      revealResult(message.result, message.delivered); pending = false;
    } else if (message.type === "MOVE_REJECTED") { pending = false; notice = "착수:" + message.message; }
    else if (message.type === "OMOK_CONNECTION") ready = message.ready;
    else if (message.type === "FINISHED") { revealResult(message.result, true); }
    else if (message.type === "RESULT_PENDING" && message.result) revealResult(message.result, delivered);
    else if (message.type === "MATCH_REPLACED") { socket = undefined; ws.close(); connect(); return; }
    else if (message.type === "ROOM_CLOSED" || message.type === "ERROR" || message.type === "GAME_START") {
      terminal = true; connected = false; notice = message.message ?? "오목 방 링크로 접속해주세요.";
      if (message.type === "ERROR") sessionStorage.removeItem("dodo:token");
      ws.close();
    }
    draw();
  };
  ws.onclose = () => {
    if (socket !== ws || terminal) return;
    connected = false; pending = false; notice = "연결이 끊겼습니다. 다시 연결 중..."; draw();
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
