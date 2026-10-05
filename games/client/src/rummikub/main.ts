import "../style.css";
import "./style.css";
import { dodoProfile } from "../common/sprites";
import { GameAudio } from "../common/audio";
import { bindSoundControl } from "../common/sound-control";
import { authenticate } from "../discord-session";
import { SEAT_COLORS, copyTable, meld, tile, checkDraft, requireUneditedTable, type View } from "../../../shared/rummikub";
import { LocalGame } from "./practice";

const root = document.querySelector<HTMLDivElement>("#app")!;
const profiles = SEAT_COLORS.map(dodoProfile);
const tableColors = ["#dce7ef", "#efddda", "#dfe9d9", "#f0e2ce"];
const audio = new GameAudio(), soundButton = document.createElement("button");
soundButton.className = "r-sound";
bindSoundControl(audio, soundButton); // Bind once; preserve the same button across renders.
let recentTiles = new Set<number>(), soundBaseline = false;
const params = new URLSearchParams(location.search), online = params.has("room") || params.has("code");
let view: View | undefined, pending = false, connected = !online, terminal = false, socket: WebSocket | undefined;
let selected = new Set<number>(), undo: number[][][] = [], sortBy: "color" | "number" = "color", offset = 0;
let local: LocalGame | undefined, reconnect: ReturnType<typeof setTimeout> | undefined, retries = 0;
let alertText = "", suppressClick = false, dragging: { id: number; x: number; y: number; moved: boolean } | undefined, ghost: HTMLElement | undefined;
const editable = () => !!view && connected && !pending && view.started && !view.finished && view.seat === view.turn;
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function tileMarkup(id: number, onTable = false) {
  const t = tile(id), color = t.color < 0 ? "#776044" : SEAT_COLORS[t.color];
  return `<button class="r-tile ${selected.has(id) ? "selected" : ""} ${onTable && recentTiles.has(id) ? "just-placed" : ""}" data-tile="${id}" style="--tile-color:${color}" aria-pressed="${selected.has(id)}" aria-label="${t.number ? ["파랑", "빨강", "초록", "주황"][t.color] + ' ' + t.number : '조커'}"><b>${t.number || "★"}</b><small>${t.number ? ["●", "◆", "▲", "■"][t.color] : "JOKER"}</small></button>`;
}
function receive(next: View) {
  recentTiles.clear();
  if (view && soundBaseline && view.matchId === next.matchId && next.revision > view.revision) {
    const before = new Set(view.table.flat());
    recentTiles = new Set(next.table.flat().filter(id => !before.has(id)));
    if (!view.finished && next.finished && next.scores.length) audio.playRummikub("win");
    else if (next.pileCount < view.pileCount) audio.playRummikub("draw");
    else if (next.turnId !== view.turnId) audio.playRummikub("turn");
    else if (recentTiles.size || JSON.stringify(view.table) !== JSON.stringify(next.table)) audio.playRummikub(next.table.flat().length < before.size ? "reset" : "place");
  }
  soundBaseline = true;
  if (view?.turnId !== next.turnId || view?.matchId !== next.matchId) { undo = []; selected.clear(); alertText = ""; }
  view = next; offset = next.serverNow - Date.now(); pending = false; retries = 0;
  render();
}
function notify(message: string) { alertText = message; audio.playRummikub("error"); const el = root.querySelector(".r-notice"); if (el) el.textContent = message; }
function send(action: string, table?: number[][]) {
  if (!editable() || !view) return;
  if (action === "draw") {
    try { requireUneditedTable(view.original, view.table); }
    catch (error) { notify((error as Error).message); return; }
  }
  alertText = "";
  if (local) { local.action(action, table); return; }
  if (socket?.readyState !== WebSocket.OPEN) { notify("연결을 복구한 뒤 다시 시도해주세요."); return; }
  pending = true;
  socket.send(JSON.stringify({ type: "RUMMI_ACTION", action, table, matchId: view.matchId, turnId: view.turnId, revision: view.revision }));
  render();
}
function change(table: number[][]) {
  if (!view || !editable()) return;
  try {
    checkDraft({ table: view.original, hands: [view.hand], turn: 0, opened: [view.seats[view.seat].opened] } as Parameters<typeof checkDraft>[0], table);
    undo.push(copyTable(view.table)); if (undo.length > 100) undo.shift(); selected.clear(); send("draft", table);
  } catch (error) { notify((error as Error).message); }
}
function move(ids: number[], target: number | "rack" | "new", at?: number) {
  if (!view || !editable() || !ids.length) return;
  if (target === "rack" && ids.some(id => !view!.hand.includes(id))) { notify("기존 테이블 패는 손패로 가져올 수 없습니다."); return; }
  const table = copyTable(view.table);
  // Compute insertion offset before removing selected tiles from the same meld.
  let insert = typeof target === "number" ? (at ?? table[target].length) - table[target].slice(0, at ?? table[target].length).filter(id => ids.includes(id)).length : 0;
  for (let i = 0; i < table.length; i++) table[i] = table[i].filter(id => !ids.includes(id));
  if (target === "new") table.push(ids);
  else if (typeof target === "number") table[target].splice(insert, 0, ...ids);
  change(table.filter(g => g.length));
}
function render() {
  if (!view) return;
  const scrollTop = root.querySelector(".r-table")?.scrollTop ?? 0;
  const v = view, can = editable(), used = new Set(v.table.flat());
  const hand = v.hand.filter(id => !used.has(id)).sort((a, b) => sortBy === "color" ? tile(a).color - tile(b).color || tile(a).number - tile(b).number : tile(a).number - tile(b).number || tile(a).color - tile(b).color);
  const bot = v.seats[v.turn].bot;
  const placing = bot && JSON.stringify(v.table) !== JSON.stringify(v.original);
  const turnText = v.finished ? "경기 종료" : !connected ? "재연결 중" : !v.started ? "참가자 접속 대기" : v.turn === v.seat ? "내 차례" : `${v.turn + 1}P 차례${bot ? placing ? " · 패 놓는 중" : " · 패 고르는 중" : ""}`;
  root.innerHTML = `<main class="r-shell">
    <header class="heading"><h1>도도새 루미큐브 <span>RUMMIKUB</span></h1><div class="r-tools"><span class="r-mode">${online ? "온라인" : "연습 모드"}${v.seat < 0 ? " · 관전" : ""}</span></div></header>
    <section class="r-arcade" style="--turn-color:${v.started && !v.finished ? SEAT_COLORS[v.turn] : "#727c68"};--table-color:${v.started && !v.finished ? tableColors[v.turn] : "#e6e8d8"}">
      <div class="r-players">${v.seats.map((s, i) => `<article class="r-player ${v.turn === i && v.started && !v.finished ? "active" : ""}" style="--seat:${SEAT_COLORS[i]}"><canvas width="120" height="96" data-face="${i}"></canvas><div class="r-player-info"><strong>${i + 1}P · ${escape(s.name)}${i === v.seat ? " (나)" : ""}</strong><small>${s.opened ? "등록 완료" : "첫 등록 전"}${s.connected ? "" : " · 접속 대기"} · ${s.count}개</small>${i !== v.seat ? `<div class="r-backs" aria-label="상대 손패 ${s.count}개">${"<i></i>".repeat(Math.min(s.count, 14))}${s.count > 14 ? `<small>+${s.count - 14}</small>` : ""}</div>` : ""}</div></article>`).join("")}</div>
      <div class="r-status"><strong>${turnText}</strong><span>남은 패 ${v.pileCount}개</span><b class="r-clock">--</b></div>
      ${v.started && !v.finished && !v.pileCount ? `<aside class="r-stall-status ${v.stalledTurns >= v.stallLimit - 1 ? "last-turn" : ""}" role="status">${v.stalledTurns >= v.stallLimit - 1
        ? "종료 예고 · 이번 차례에도 패를 내지 않으면 두 바퀴 연속 진행 없음으로 경기가 종료됩니다. 손패 수가 가장 적은 사람은 감점하지 않습니다."
        : `뽑을 패가 없습니다 · 연속 진행 없음 ${v.stalledTurns}/${v.stallLimit}턴. 두 바퀴 동안 아무도 패를 내지 않으면 종료됩니다.`}</aside>` : ""}
      <section class="r-table" aria-label="공용 테이블">
        ${v.table.map((group, i) => `<div class="r-meld ${meld(group) ? "valid" : "invalid"}" data-group="${i}"><button class="r-grip" data-select-group="${i}" aria-label="조합 전체 선택" ${!can ? "disabled" : ""}>⠿</button><button class="r-insert" data-place="${i}" data-at="0" aria-label="조합 앞에 놓기">+</button>${group.map(id => tileMarkup(id, true)).join("")}<button class="r-insert" data-place="${i}" data-at="${group.length}" aria-label="조합 뒤에 놓기">+</button></div>`).join("")}
        <button class="r-new" data-new ${!can ? "disabled" : ""}>+ 새 조합<span>패를 끌어 놓으세요</span></button>
      </section>
      <section class="r-hand-area"><div class="r-hand-heading"><strong>${v.seat < 0 ? "관전 중 · 모든 손패 비공개" : `내 손패 · ${hand.length}개`}</strong><button data-sort>정렬: ${sortBy === "color" ? "색상" : "숫자"}</button></div><div class="r-rack" data-rack>${hand.map(id => tileMarkup(id)).join("")}${!hand.length ? '<span class="r-empty">' + (v.seat < 0 ? "테이블의 진행 상황만 표시합니다." : "손패 없음") + '</span>' : ""}</div></section>
      <div class="r-actions"><button data-action="undo" ${!can || !undo.length ? "disabled" : ""}>되돌리기</button><button data-action="reset" ${!can ? "disabled" : ""}>턴 초기화</button><span></span><button data-action="draw" aria-describedby="r-draw-help" ${!can ? "disabled" : ""}>${v.pileCount ? "한 장 받고 넘기기" : "패 없음 · 차례 넘기기"}</button><button class="r-primary" data-action="commit" ${!can ? "disabled" : ""}>턴 종료</button></div>
      <p class="r-draw-help" id="r-draw-help">배치를 수정했다면 '턴 초기화'를 먼저 눌러야 차례를 넘길 수 있습니다.</p>
      <p class="r-notice" role="status" aria-live="polite">${escape(alertText)}</p>
    </section>
    <details class="r-rules"><summary>조작 · 규칙</summary><p>패를 끌거나 여러 패를 선택한 뒤 + 버튼으로 놓으세요. 조합의 ⠿ 버튼은 묶음 전체를 선택합니다. 연속 숫자는 순서대로 놓으세요.</p><p>첫 등록은 내 패로 30점 이상. 이후에는 테이블 재배열이 가능합니다. 정상 조합은 같은 숫자·다른 색 3~4개 또는 같은 색 연속 숫자 3개 이상입니다.</p><p>60초가 끝나면 유효한 배치는 확정됩니다. 미완성 배치는 초기화하고 한 장 뽑습니다. 턴 종료 검증에 실패하면 배치를 초기화합니다. 조커 잔여 점수는 30점입니다.</p></details>
    ${v.finished ? `<div class="r-overlay"><section class="r-result"><h2>${v.endReason === "stalled" ? "진행 정체로 종료" : v.winner === null ? "경기 종료" : `${v.winner + 1}P 승리!`}</h2>${v.endReason === "stalled" ? "<small>두 바퀴 동안 새로 낸 패가 없어 종료되었습니다. 손패 수가 가장 적은 사람은 공동 최저까지 감점하지 않습니다.</small>" : ""}${v.winner !== null && v.seats.some(seat => seat.bot) ? "<small>봇 승패 보정 적용 · 중급 50% / 어려움 75% · 사람끼리 100%</small>" : ""}${v.scores.map((score, i) => `<p><b style="color:${SEAT_COLORS[i]}">${i + 1}P · ${escape(v.seats[i].name)}</b><strong>${score > 0 ? "+" : ""}${score}점${v.endReason === "stalled" && score === 0 ? " · 감점 없음" : ""}</strong></p>`).join("")}<small>${online ? "전적·포인트 랭킹: !게임 통계 → 루미큐브. 재경기는 디스코드 대기방에서 시작해주세요." : "연습 결과는 저장하지 않습니다."}</small><button data-restart>${online ? "테이블 확인" : "다시 시작"}</button></section></div>` : ""}
  </main>`;
  root.querySelector(".r-tools")!.append(soundButton);
  const tableElement = root.querySelector<HTMLElement>(".r-table")!;
  tableElement.scrollTop = scrollTop;
  if (placing) {
    const placed = tableElement.querySelector<HTMLElement>(".just-placed");
    if (placed) {
      const box = placed.getBoundingClientRect(), visible = tableElement.getBoundingClientRect();
      if (box.bottom > visible.bottom) tableElement.scrollTop += box.bottom - visible.bottom + 12;
      else if (box.top < visible.top) tableElement.scrollTop -= visible.top - box.top + 12;
    }
  }
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>("[data-face]")) {
    const ctx = canvas.getContext("2d")!; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(profiles[Number(canvas.dataset.face)], 0, 0, 120, 96);
  }
  tick();
  recentTiles.clear();
}
root.addEventListener("click", event => {
  if (suppressClick) { suppressClick = false; return; }
  const target = (event.target as HTMLElement).closest<HTMLElement>("button");
  if (!target) { if ((event.target as HTMLElement).closest("[data-rack]")) move([...selected], "rack"); return; }
  if (target.hasAttribute("data-restart")) { if (online) root.querySelector(".r-overlay")?.remove(); else location.reload(); return; }
  if (target.hasAttribute("data-sort")) { sortBy = sortBy === "color" ? "number" : "color"; render(); return; }
  if (!editable() || !view) return;
  if (target.dataset.tile !== undefined) {
    const id = Number(target.dataset.tile); if (selected.has(id)) selected.delete(id); else selected.add(id); render();
  } else if (target.dataset.selectGroup !== undefined) {
    selected = new Set(view.table[Number(target.dataset.selectGroup)]); render();
  } else if (target.hasAttribute("data-new")) move([...selected], "new");
  else if (target.dataset.place !== undefined) move([...selected], Number(target.dataset.place), Number(target.dataset.at));
  else if (target.dataset.action === "undo") { const table = undo.pop(); if (table) { selected.clear(); send("draft", table); } }
  else if (target.dataset.action) { selected.clear(); send(target.dataset.action); }
});
root.addEventListener("pointerdown", event => {
  suppressClick = false;
  if (!editable() || event.button !== 0) return;
  const t = (event.target as HTMLElement).closest<HTMLElement>("[data-tile]"); if (!t) return;
  dragging = { id: Number(t.dataset.tile), x: event.clientX, y: event.clientY, moved: false };
});
window.addEventListener("pointermove", event => {
  if (!dragging) return;
  if (!dragging.moved && Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) < 6) return;
  if (!dragging.moved) {
    dragging.moved = true; if (!selected.has(dragging.id)) selected = new Set([dragging.id]);
    ghost = document.createElement("div"); ghost.className = "r-drag-ghost"; ghost.innerHTML = [...selected].map(id => tileMarkup(id)).join(""); document.body.append(ghost);
  }
  event.preventDefault(); ghost!.style.left = event.clientX + 8 + "px"; ghost!.style.top = event.clientY + 8 + "px";
}, { passive: false });
window.addEventListener("pointerup", event => {
  if (!dragging) return;
  if (dragging.moved) {
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const group = target?.closest<HTMLElement>("[data-group]"), rack = target?.closest("[data-rack]"), next = target?.closest("[data-new]");
    if (rack) move([...selected], "rack");
    else if (group && view) {
      const index = Number(group.dataset.group), t = target?.closest<HTMLElement>("[data-tile]");
      let at = view.table[index].length;
      if (t) { const box = t.getBoundingClientRect(); at = view.table[index].indexOf(Number(t.dataset.tile)) + (event.clientX > box.x + box.width / 2 ? 1 : 0); }
      if (target?.closest<HTMLElement>("[data-at]")) at = Number(target.closest<HTMLElement>("[data-at]")!.dataset.at);
      move([...selected], index, at);
    } else if (next || target?.classList.contains("r-table")) move([...selected], "new");
    ghost?.remove(); ghost = undefined;
    // Suppress the synthetic click, but end dragging before the next mouse move.
    suppressClick = true;
  }
  dragging = undefined;
});
window.addEventListener("pointercancel", () => { ghost?.remove(); ghost = undefined; dragging = undefined; });
function tick() {
  const clock = root.querySelector(".r-clock");
  if (clock && view) { const remaining = Math.max(0, Math.ceil((view.deadline - Date.now() - offset) / 1000)); clock.textContent = view.started && !view.finished ? `${remaining}초` : "--"; clock.classList.toggle("urgent", remaining <= 10 && view.started && !view.finished); }
}
const ticker = setInterval(tick, 250);
async function startOnline() {
  try {
    const credentials = await authenticate(root, "rummikub");
    const connect = () => {
      if (terminal) return;
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`); socket = ws;
      ws.onopen = () => { connected = true; ws.send(JSON.stringify({ type: "AUTH", ...credentials })); };
      ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === "RUMMI_STATE") receive(message);
        else if (message.type === "RUMMI_ERROR") notify(message.message);
        else if (["ROOM_CLOSED", "ERROR"].includes(message.type)) { terminal = message.terminal !== false; alertText = message.message; connected = false; if (view) render(); else root.textContent = message.message; }
        else if (message.type === "MATCH_REPLACED") location.reload();
        else if (message.type === "RESULT_PENDING" && message.result?.aborted) notify(message.result.reason);
      };
      ws.onclose = () => {
        soundBaseline = false;
        connected = false; pending = false;
        if (terminal) return;
        if (++retries > 8) { terminal = true; alertText = "연결하지 못했습니다. 새로고침으로 다시 접속해주세요."; }
        else { alertText = "연결을 복구 중입니다. 손패와 턴 상태는 서버에 보관됩니다."; reconnect = setTimeout(connect, Math.min(8000, retries * 1000)); }
        if (view) render(); else root.textContent = alertText;
      };
    };
    root.textContent = "루미큐브에 연결 중…"; connect();
  } catch (error) { root.textContent = (error as Error).message; }
}
if (online) void startOnline();
else {
  root.innerHTML = `<main class="r-setup"><h1>도도새 루미큐브</h1><canvas width="160" height="128"></canvas><p>연습 모드</p><label>인원 <select id="r-count"><option value="2">2인</option><option value="3">3인</option><option value="4" selected>4인</option></select></label><label>도도봇 <select id="r-level"><option value="normal">중간</option><option value="hard">어려움</option></select></label><button class="r-primary" id="r-start">게임 시작</button><small>온라인 대결은 디스코드에서 !게임 루미큐브</small></main>`;
  root.querySelector(".r-setup")!.append(soundButton);
  const ctx = root.querySelector("canvas")!.getContext("2d")!; ctx.imageSmoothingEnabled = false; ctx.drawImage(profiles[0], 0, 0, 160, 128);
  root.querySelector("#r-start")!.addEventListener("click", () => {
    const count = Number(root.querySelector<HTMLSelectElement>("#r-count")!.value), difficulty = root.querySelector<HTMLSelectElement>("#r-level")!.value as "normal" | "hard";
    local = new LocalGame(count, difficulty, receive, notify); local.start();
  });
}
window.addEventListener("pagehide", () => { terminal = true; clearInterval(ticker); clearTimeout(reconnect); local?.dispose(); socket?.close(); }, { once: true });
