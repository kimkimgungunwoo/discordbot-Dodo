import "../style.css";
import "./style.css";
import { dodoProfile } from "../common/sprites";
import { GameAudio } from "../common/audio";
import { bindSoundControl } from "../common/sound-control";
import { authenticate } from "../discord-session";
import { SEAT_COLORS, arrangeRun, copyTable, meld, tile, checkDraft, turnIssues, requireUneditedTable, tableJokerBindings, type View } from "../../../shared/rummikub";
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
let handOrder: number[] = [], manualOrder = false;
let newestHandTiles = new Set<number>();
let local: LocalGame | undefined, reconnect: ReturnType<typeof setTimeout> | undefined, retries = 0;
let alertText = "", suppressClick = false, dragging: { id: number; x: number; y: number; moved: boolean; fromRack: boolean; pointer: number } | undefined, ghost: HTMLElement | undefined;
let rackMarker: HTMLElement | undefined;
const editable = () => !!view && connected && !pending && view.started && !view.finished && view.seat === view.turn;
const rackEditable = () => !!view && view.seat >= 0 && !view.finished;
const compareHand = (a: number, b: number) => sortBy === "color" ? tile(a).color - tile(b).color || tile(a).number - tile(b).number || a - b : tile(a).number - tile(b).number || tile(a).color - tile(b).color || a - b;
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function tileMarkup(id: number, onTable = false, binding?: { number: number; colors: number[] }) {
  const t = tile(id), color = t.color < 0 ? "#776044" : SEAT_COLORS[t.color];
  const colors = ["파랑", "빨강", "초록", "주황"], marks = ["●", "◆", "▲", "■"];
  const represented = binding ? `${binding.colors.map(c => marks[c]).join("/")} ${binding.number}` : "";
  const label = t.number ? colors[t.color] + " " + t.number : represented ? `조커 · ${binding!.colors.map(c => colors[c]).join("/")} ${binding!.number}` : "조커";
  const newest = !onTable && newestHandTiles.has(id);
  return `<button class="r-tile ${selected.has(id) ? "selected" : ""} ${newest ? "newly-drawn" : ""} ${onTable && recentTiles.has(id) ? "just-placed" : ""}" data-tile="${id}" style="--tile-color:${color}" aria-pressed="${selected.has(id)}" aria-label="${label}${newest ? " · 최근 받은 패" : ""}" ${represented ? `title="조커 · ${label.slice(5)}로 사용 중"` : ""}><b>${t.number || "★"}</b><small>${t.number ? marks[t.color] : represented || "JOKER"}</small></button>`;
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
  if (view?.turnId !== next.turnId || view?.matchId !== next.matchId) { clearDrag(); undo = []; selected.clear(); alertText = ""; }
  const newHand = view?.matchId !== next.matchId || view?.seat !== next.seat;
  if (newHand) { handOrder = []; manualOrder = false; newestHandTiles.clear(); }
  const owned = new Set(next.hand), known = new Set(handOrder);
  const incoming = next.hand.filter(id => !known.has(id));
  handOrder = [...handOrder.filter(id => owned.has(id)), ...incoming];
  if (newHand) handOrder.sort(compareHand);
  else if (incoming.length) newestHandTiles = new Set(incoming);
  newestHandTiles = new Set([...newestHandTiles].filter(id => owned.has(id)));
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
  const existingBindings = typeof target === "number" ? tableJokerBindings(view.table[target], view.original) : {};
  for (let i = 0; i < table.length; i++) table[i] = table[i].filter(id => !ids.includes(id));
  if (target === "new") table.push(arrangeRun(ids));
  else if (typeof target === "number") {
    table[target].splice(insert, 0, ...ids);
    table[target] = arrangeRun(table[target], existingBindings);
  }
  change(table.filter(g => g.length));
}
function rackPosition(x: number, y: number) {
  const tiles = [...root.querySelectorAll<HTMLElement>("[data-rack] [data-tile]")];
  if (!tiles.length) return undefined;
  const boxes = tiles.map(element => ({element, box: element.getBoundingClientRect()}));
  const distance = (box: DOMRect) => Math.max(box.top-y, y-box.bottom, 0);
  const nearest = boxes.reduce((a,b) => distance(a.box) <= distance(b.box) ? a : b);
  const row = boxes.filter(item => Math.abs(item.box.top-nearest.box.top) < 10);
  const before = row.find(item => x < item.box.left+item.box.width/2);
  const anchor = before ?? row[row.length-1];
  const index = tiles.indexOf(anchor.element)+(before ? 0 : 1);
  return { before: tiles[index] ? Number(tiles[index].dataset.tile) : undefined,
    x: before ? anchor.box.left-3 : anchor.box.right+3, y: anchor.box.top, height: anchor.box.height };
}
function reorderHand(ids: number[], before?: number) {
  if (!rackEditable() || !view) return;
  const used = new Set(view.table.flat());
  const moving = new Set(ids.filter(id => view!.hand.includes(id) && !used.has(id)));
  if (!moving.size || (before !== undefined && moving.has(before))) return;
  const ordered = handOrder.filter(id => moving.has(id)), rest = handOrder.filter(id => !moving.has(id));
  const at = before === undefined ? rest.length : rest.indexOf(before);
  if (at < 0) return;
  rest.splice(at,0,...ordered); handOrder = rest; manualOrder = true; selected.clear(); render();
}
function clearDrag() {
  ghost?.remove(); ghost = undefined; rackMarker?.remove(); rackMarker = undefined; dragging = undefined;
}
function render() {
  if (!view) return;
  const scrollTop = root.querySelector(".r-table")?.scrollTop ?? 0;
  const v = view, can = editable(), used = new Set(v.table.flat());
  const ownTurn = v.started && !v.finished && v.seat >= 0 && v.seat === v.turn;
  const issues = ownTurn ? turnIssues({ table: v.original, hands: [v.hand], turn: 0, opened: [v.seats[v.seat].opened] } as Parameters<typeof turnIssues>[0], v.table) : { message: null, groups: [] };
  const invalidGroups = new Set(issues.groups);
  const edited = JSON.stringify(v.original) !== JSON.stringify(v.table);
  const hand = handOrder.filter(id => !used.has(id));
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
        ${v.table.map((group, i) => { const bindings = tableJokerBindings(group, v.original), invalid = invalidGroups.has(i) || !meld(group); return `<div class="r-meld ${invalid ? "invalid" : "valid"}" data-group="${i}" aria-invalid="${invalid}" ${invalid ? 'title="이 조합을 수정해주세요"' : ''}><button class="r-grip" data-select-group="${i}" aria-label="조합 전체 선택" ${!can ? "disabled" : ""}>⠿</button><button class="r-insert" data-place="${i}" data-at="0" aria-label="조합 앞에 놓기">+</button>${group.map(id => tileMarkup(id, true, bindings[id])).join("")}<button class="r-insert" data-place="${i}" data-at="${group.length}" aria-label="조합 뒤에 놓기">+</button></div>`; }).join("")}
        <button class="r-new" data-new ${!can ? "disabled" : ""}>+ 새 조합<span>패를 끌어 놓으세요</span></button>
      </section>
      <section class="r-hand-area"><div class="r-hand-heading"><strong>${v.seat < 0 ? "관전 중 · 모든 손패 비공개" : `내 손패 · ${hand.length}개`}</strong><button data-sort ${v.seat < 0 ? "disabled" : ""}>${manualOrder ? "직접 정렬" : `정렬: ${sortBy === "color" ? "색상" : "숫자"}`}</button></div><div class="r-rack" data-rack>${hand.map(id => tileMarkup(id)).join("")}${!hand.length ? '<span class="r-empty">' + (v.seat < 0 ? "테이블의 진행 상황만 표시합니다." : "손패 없음") + '</span>' : ""}</div></section>
      ${ownTurn && edited && issues.message ? `<p class="r-correction" role="status">${escape(issues.message)} 배치를 수정해야 턴을 종료할 수 있습니다.</p>` : ''}
      <div class="r-actions"><button data-action="undo" ${!can || !undo.length ? "disabled" : ""}>되돌리기</button><button data-action="reset" ${!can ? "disabled" : ""}>턴 초기화</button><span></span><button data-action="draw" aria-describedby="r-draw-help" ${!can || edited ? "disabled" : ""}>${v.pileCount ? "한 장 받고 넘기기" : "패 없음 · 차례 넘기기"}</button><button class="r-primary" data-action="commit" ${!can || !!issues.message ? "disabled" : ""}>턴 종료</button></div>
      <p class="r-draw-help" id="r-draw-help">배치를 수정했다면 '턴 초기화'를 먼저 눌러야 차례를 넘길 수 있습니다.</p>
      <p class="r-notice" role="status" aria-live="polite">${escape(alertText)}</p>
    </section>
    <details class="r-rules"><summary>조작 · 규칙</summary><p>패를 끌거나 여러 패를 선택한 뒤 + 버튼으로 놓으세요. 조합의 ⠿ 버튼은 묶음 전체를 선택합니다. 연속 숫자는 순서대로 놓으세요.</p><p>첫 등록은 내 패로 30점 이상. 이후에는 테이블 재배열이 가능합니다. 정상 조합은 같은 숫자·다른 색 3~4개 또는 같은 색 연속 숫자 3개 이상입니다.</p><p>조커는 손패나 테이블 패로 조합을 재구성해 회수하고 같은 턴에 다시 사용할 수 있습니다. 모든 조합이 유효하고 내 손패를 한 장 이상 내야 합니다.</p><p>60초가 끝나면 유효한 배치는 확정됩니다. 수정 중인 배치가 잘못되었다면 그대로 유지되며 15초씩 수정 시간이 주어집니다. 빨간 테두리의 조합을 수정해야 턴을 끝낼 수 있습니다. 배치를 바꾸지 않았다면 한 장 뽑고 넘깁니다. 조커 잔여 점수는 30점입니다.</p></details>
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
  if (target.hasAttribute("data-sort") && rackEditable()) { sortBy = sortBy === "color" ? "number" : "color"; manualOrder = false; handOrder.sort(compareHand); render(); return; }
  if (!view || (!editable() && !(rackEditable() && target.closest("[data-rack]")))) return;
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
  if (event.button !== 0) return;
  const t = (event.target as HTMLElement).closest<HTMLElement>("[data-tile]"); if (!t) return;
  const fromRack = !!t.closest("[data-rack]");
  if (fromRack ? !rackEditable() : !editable()) return;
  dragging = { id: Number(t.dataset.tile), x: event.clientX, y: event.clientY, moved: false, fromRack, pointer: event.pointerId };
});
window.addEventListener("pointermove", event => {
  if (!dragging || dragging.pointer !== event.pointerId) return;
  if (!dragging.moved && Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) < 6) return;
  if (!dragging.moved) {
    dragging.moved = true; if (!selected.has(dragging.id)) selected = new Set([dragging.id]);
    if (dragging.fromRack && view) selected = new Set([...selected].filter(id => view!.hand.includes(id) && !view!.table.flat().includes(id)));
    ghost = document.createElement("div"); ghost.className = "r-drag-ghost"; ghost.innerHTML = [...selected].map(id => tileMarkup(id)).join(""); document.body.append(ghost);
  }
  event.preventDefault(); ghost!.style.left = event.clientX + 8 + "px"; ghost!.style.top = event.clientY + 8 + "px";
  rackMarker?.remove(); rackMarker = undefined;
  if (dragging.fromRack && document.elementFromPoint(event.clientX,event.clientY)?.closest("[data-rack]")) {
    const position = rackPosition(event.clientX,event.clientY);
    if (position) {
      rackMarker = document.createElement("div"); rackMarker.className = "r-rack-marker";
      Object.assign(rackMarker.style,{left:position.x+"px",top:position.y+"px",height:position.height+"px"}); document.body.append(rackMarker);
    }
  }
}, { passive: false });
window.addEventListener("pointerup", event => {
  if (!dragging || dragging.pointer !== event.pointerId) return;
  if (dragging.moved) {
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const group = target?.closest<HTMLElement>("[data-group]"), rack = target?.closest("[data-rack]"), next = target?.closest("[data-new]");
    if (rack && dragging.fromRack) reorderHand([...selected],rackPosition(event.clientX,event.clientY)?.before);
    else if (rack) move([...selected], "rack");
    else if (group && view) {
      const index = Number(group.dataset.group), t = target?.closest<HTMLElement>("[data-tile]");
      let at = view.table[index].length;
      if (t) { const box = t.getBoundingClientRect(); at = view.table[index].indexOf(Number(t.dataset.tile)) + (event.clientX > box.x + box.width / 2 ? 1 : 0); }
      if (target?.closest<HTMLElement>("[data-at]")) at = Number(target.closest<HTMLElement>("[data-at]")!.dataset.at);
      move([...selected], index, at);
    } else if (next || target?.classList.contains("r-table")) move([...selected], "new");
    clearDrag();
    // Suppress the synthetic click, but end dragging before the next mouse move.
    suppressClick = true;
  }
  clearDrag();
});
window.addEventListener("pointercancel", clearDrag);
window.addEventListener("blur", clearDrag);
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
