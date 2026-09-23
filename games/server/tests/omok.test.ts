import { test } from "node:test";
import assert from "node:assert/strict";
import { freshBoard, place, winningLine, chooseMove, forbiddenMove, isLegalMove, legalMoves, transcendentMove, type SearchStats, type Difficulty } from "../../shared/omok.js";
import { OmokRoom } from "../src/omok-room.js";
import { computeCpuMove } from "../src/ai-move.js";
import { validDefinition, type Peer } from "../src/protocol.js";

test("gomoku validates moves, alternates colors and preserves previous board", () => {
  const initial = freshBoard(), next = place(initial, 112);
  assert.equal(initial.board[112], 0); assert.equal(next.board[112], 1); assert.equal(next.turn, 2);
  for (const at of [-1, 225, 1.5, NaN, 112]) assert.throws(() => place(next, at));
});
test("all four directions win; only white wins with overlines; rows cannot wrap", () => {
  for (const delta of [1, 15, 16, 14]) {
    const state = freshBoard();
    for (let n = 0; n < 6; n++) state.board[37 + n * delta] = 2;
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
test("transcendent completes bounded searches without mutating the board", () => {
  let state = freshBoard();
  for (const at of [112, 113, 97, 98]) state = place(state, at);
  const before = [...state.board];
  const stats: SearchStats = { nodes: 0, depth: 0, forcedWin: false, elapsedMs: 0 };
  const move = transcendentMove(state.board, state.turn, 800, stats);
  assert.ok(isLegalMove(state.board, move, state.turn));
  assert.deepEqual(state.board, before);
  assert.ok(stats.nodes > 0);
  assert.ok(stats.elapsedMs < 1800);
});
test("black forbidden shapes include broken threes and two fours on one axis", () => {
  for (const [stones, expected] of [
    [[111, 113, 97, 127], "33"],
    [[110, 113, 82, 127], "33"],
    [[110, 111, 113, 82, 97, 127], "44"],
    [[108, 110, 111, 114], "44"],
    [[109, 110, 111, 113, 114], "장목"],
  ] as [number[], string][]) {
    const state = freshBoard(); stones.forEach(at => state.board[at] = 1);
    const before = [...state.board];
    assert.equal(forbiddenMove(state.board, 112), expected);
    assert.deepEqual(state.board, before);
    assert.throws(() => place(state, 112), new RegExp(expected));
    assert.ok(!legalMoves(state.board, 1).includes(112));
    state.turn = 2; assert.doesNotThrow(() => place(state, 112));
  }
});
test("closed threes, overline continuations and edge threes are legal", () => {
  for (const stones of [[108, 111, 113, 116, 97, 127], [111, 113, 97, 127]]) {
    const state = freshBoard(); stones.forEach(at => state.board[at] = 1);
    if (stones.length === 4) state.board[110] = 2;
    assert.equal(forbiddenMove(state.board, 112), null);
  }
  const edge = freshBoard(); [0, 2, 16, 31].forEach(at => edge.board[at] = 1);
  assert.equal(forbiddenMove(edge.board, 1), null);
});
test("exact five takes precedence over simultaneous forbidden shapes", () => {
  const state = freshBoard();
  [108, 109, 110, 111, 67, 82, 97, 127, 142].forEach(at => state.board[at] = 1);
  assert.equal(forbiddenMove(state.board, 112), null);
  assert.equal(place(state, 112).winner, 1);
  const overline = freshBoard(); [108, 109, 110, 111, 113].forEach(at => overline.board[at] = 1);
  assert.throws(() => place(overline, 112), /장목/);
  overline.board[112] = 1; assert.deepEqual(winningLine(overline.board, 112), []);
});
test("every AI avoids a tempting forbidden fork", () => {
  const state = freshBoard(); [110, 111, 113, 82, 97, 127].forEach(at => state.board[at] = 1);
  assert.equal(forbiddenMove(state.board, 112), "44");
  for (const level of ["easy", "normal", "hard", "extreme", "transcendent"] as Difficulty[]) {
    const at = chooseMove(state, level);
    assert.ok(isLegalMove(state.board, at, 1), level);
    assert.doesNotThrow(() => place(state, at));
  }
});
test("transcendent proves a four-three win beyond an immediate block", () => {
  const state = freshBoard();
  // H8 creates a horizontal four and vertical open three. White must block
  // J8, then H7 or H10 creates two winning endpoints.
  [110, 111, 113, 97, 127].forEach(at => state.board[at] = 1);
  state.board[109] = 2;
  const stats: SearchStats = { nodes: 0, depth: 0, forcedWin: false, elapsedMs: 0 };
  const at = transcendentMove(state.board, 1, 1500, stats);
  assert.equal(at, 112); assert.equal(stats.forcedWin, true);
  let next = place(state, at); next = place(next, 114);
  const follow = chooseMove(next, "transcendent");
  next = place(next, follow);
  const wins = legalMoves(next.board, 1).filter(at => place({ ...next, turn: 1 }, at).winner === 1);
  assert.ok(wins.length >= 2);
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

test("forbidden online moves preserve revision and clock; spectators track joins and leaves", () => {
  const room = new OmokRoom(definition), host = peer("1"), guest = peer("2");
  const watcher = { ...peer("3"), avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png" };
  room.join(host); room.join(guest); room.join(watcher); room.startsAt = Date.now() - 1;
  [111, 113, 97, 127].forEach(at => room.state.board[at] = 1);
  const black = room.blackSide === "left" ? host : guest;
  const deadline = room.turnDeadline;
  room.move(black, { matchId: room.matchId, revision: 0, at: 112 });
  assert.equal(black.messages.at(-1).type, "MOVE_REJECTED");
  assert.match(black.messages.at(-1).message, /33/);
  assert.equal(room.state.moves.length, 0); assert.equal(room.turnDeadline, deadline);
  assert.deepEqual(room.snapshot().spectators, [{ id: "3", displayName: "player3", avatarUrl: watcher.avatarUrl }]);
  room.leave(watcher); assert.deepEqual(room.snapshot().spectators, []);
  assert.equal(room.turnDeadline, deadline);
  room.dispose();
});

test("strong AI workers return legal moves under the server runtime", async () => {
  const state = freshBoard(); [105, 106, 107, 108].forEach(at => state.board[at] = 1);
  for (const level of ["extreme", "transcendent"] as Difficulty[]) {
    assert.equal(await computeCpuMove(state, level), 109);
  }
});

test("a three with only double-four continuations is a false three", () => {
  const state = freshBoard();
  [111, 113, 97, 127, 65, 80, 95, 69, 84, 99].forEach(at => state.board[at] = 1);
  assert.equal(forbiddenMove(state.board, 112), null);
  state.board[112] = 1;
  assert.equal(forbiddenMove(state.board, 110), "44");
  assert.equal(forbiddenMove(state.board, 114), "44");
});
