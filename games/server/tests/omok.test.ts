import { test } from "node:test";
import assert from "node:assert/strict";
import { freshBoard, place, winningLine, chooseMove, type Difficulty } from "../../shared/omok.js";
import { OmokRoom } from "../src/omok-room.js";
import { validDefinition, type Peer } from "../src/protocol.js";

test("gomoku validates moves, alternates colors and preserves previous board", () => {
  const initial = freshBoard(), next = place(initial, 112);
  assert.equal(initial.board[112], 0); assert.equal(next.board[112], 1); assert.equal(next.turn, 2);
  for (const at of [-1, 225, 1.5, NaN, 112]) assert.throws(() => place(next, at));
});
test("all four directions and overlines win, rows cannot wrap", () => {
  for (const delta of [1, 15, 16, 14]) {
    const state = freshBoard();
    for (let n = 0; n < 6; n++) state.board[37 + n * delta] = 1;
    assert.equal(winningLine(state.board, 37).length, 6);
  }
  const state = freshBoard();
  for (const at of [13, 14, 15, 16, 17]) state.board[at] = 2;
  assert.deepEqual(winningLine(state.board, 15), []);
  let game = freshBoard();
  for (const at of [0, 30, 1, 31, 2, 32, 3, 33, 4]) game = place(game, at);
  assert.equal(game.winner, 1); assert.throws(() => place(game, 5));
});
test("full board without five is a draw", () => {
  const state = freshBoard();
  state.board = state.board.map((_, at) => (Math.floor(at / 15) + Math.floor((at % 15) / 2)) % 2 ? 1 : 2);
  const color = state.board[224] as 1 | 2; state.board[224] = 0; state.turn = color;
  state.moves = Array.from({ length: 224 }, (_, at) => at);
  assert.equal(place(state, 224).draw, true);
});
test("all AI levels finish wins; medium and above block immediate loss and preserve state", () => {
  for (const difficulty of ["easy", "normal", "hard", "extreme", "transcendent"] as Difficulty[]) {
    const state = freshBoard();
    for (const at of [105, 106, 107, 108]) state.board[at] = 1;
    assert.equal(chooseMove(state, difficulty), 109);
    state.board = state.board.map(stone => stone === 1 ? 2 : stone);
    const before = JSON.stringify(state);
    assert.equal(chooseMove(state, difficulty, () => .8), 109);
    assert.equal(JSON.stringify(state), before);
  }
});
test("AI levels produce legal moves across a complete bounded game", () => {
  let state = freshBoard();
  const levels: Difficulty[] = ["normal", "hard", "extreme", "easy"];
  for (let n = 0; n < 225 && !state.winner && !state.draw; n++) {
    const move = chooseMove(state, levels[n % 4], () => .7);
    assert.equal(state.board[move], 0);
    state = place(state, move);
  }
  assert.ok(state.winner || state.draw);
});
test("transcendent plays legal moves and outsearches extreme without dragging the full-game benchmark", () => {
  // 전체 게임 루프에 넣지 않는 이유: "초월"은 극한보다 예산이 훨씬 커서(500ms→2000ms) 매 수마다
  // 오래 걸리고, 그 알고리즘 자체는 극한과 같은 timeBoundedMove를 공유하니 극한 쪽 전체 게임
  // 테스트가 이미 그 경로를 검증한다. 여기선 몇 수만 합법성만 확인한다.
  let state = freshBoard();
  for (const at of [112, 113, 97, 98]) state = place(state, at);
  for (let n = 0; n < 3 && !state.winner && !state.draw; n++) {
    const move = chooseMove(state, "transcendent");
    assert.equal(state.board[move], 0);
    state = place(state, move);
  }
});
const definition = { game: "omok" as const, roomId: "10:1:omok", guildId: "10", hostId: "1", p2Id: "2", mode: "PVP" as const };
function peer(id: string) { const messages: any[] = []; return { id, name: "player" + id, send: (message: any) => messages.push(message), messages }; }
test("server owns coin, turns, results; spectators and forged results cannot change a game", () => {
  const room = new OmokRoom(definition), host = peer("1"), guest = peer("2"), spectator = peer("3");
  room.join(host); assert.equal(room.startsAt, null); room.join(guest); room.join(spectator);
  assert.equal(spectator.messages[0].role, "spectator");
  assert.ok(room.startsAt! > Date.now());
  const move = (who: Peer, at: number, revision = room.state.moves.length) => room.move(who, { matchId: room.matchId, revision, at });
  move(host, 100); assert.equal(room.state.moves.length, 0);
  room.startsAt = Date.now() - 1;
  move(spectator, 100); assert.equal(room.state.moves.length, 0);
  const black = room.blackSide === "left" ? host : guest, white = black === host ? guest : host;
  move(white, 100); assert.equal(room.state.moves.length, 0);
  move(black, 0); move(black, 1); assert.equal(room.state.moves.length, 1);
  move(white, 15, 0); assert.equal(room.state.moves.length, 1);
  move(white, 0); assert.equal(room.state.moves.length, 1);
  room.report(host, { score: { left: 7, right: 0 }, tick: 1 }); assert.equal(room.result, null);
  room.leave(guest); move(white, 15); assert.equal(room.state.moves.length, 1);
  room.join(guest); assert.equal(guest.messages.at(-1).state.moves.length, 1);
  for (const [who, at] of [[white, 30], [black, 1], [white, 31], [black, 2], [white, 32], [black, 3], [white, 33], [black, 4]] as [Peer, number][]) move(who, at);
  assert.equal(room.result?.winnerId, black.id); assert.equal(room.result?.winnerSide, room.blackSide);
  move(white, 34); assert.equal(room.state.moves.length, 9);
  room.dispose();
});
test("CPU starts when black, reconnect preserves coin and board", async () => {
  const room = new OmokRoom({ ...definition, p2Id: null, mode: "CPU", difficulty: "normal" });
  const host = peer("1"); room.startsAt = Date.now() - 1; room.join(host);
  const color = room.blackSide;
  if (color === "left") room.move(host, { matchId: room.matchId, revision: 0, at: 112 });
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(room.state.moves.length, color === "left" ? 2 : 1);
  room.leave(host); room.join(host); assert.equal(room.blackSide, color);
  assert.equal(room.turnSide, "left"); room.dispose();
});
test("idle turn auto-plays a random legal move on a 45s clock and keeps rescheduling", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const room = new OmokRoom({ ...definition, mode: "PVP" });
  const host = peer("1"), guest = peer("2");
  room.join(host);
  room.startsAt = Date.now() - 1;
  room.join(guest);
  assert.equal(room.state.moves.length, 0);
  assert.ok(room.turnDeadline! > Date.now());
  // 방금 잡은 turnDeadline이 실제로 이 시점의 브로드캐스트에 실려 나가야 한다 — 스케줄링이
  // presence() 뒤에서 일어나면 클라이언트는 계속 옛 값(null)을 받아 게이지가 안 줄어든다.
  assert.equal(guest.messages.at(-1).turnDeadline, room.turnDeadline);
  t.mock.timers.tick(44999);
  assert.equal(room.state.moves.length, 0);
  t.mock.timers.tick(1);
  assert.equal(room.state.moves.length, 1);
  assert.ok(room.turnDeadline! > Date.now());
  assert.equal(guest.messages.at(-1).turnDeadline, room.turnDeadline);
  t.mock.timers.tick(45000);
  assert.equal(room.state.moves.length, 2);
  room.dispose();
});
test("room definition rejects unknown game types", () => {
  assert.equal(validDefinition(definition), true);
  assert.equal(validDefinition({ ...definition, game: "unknown" }), false);
});
