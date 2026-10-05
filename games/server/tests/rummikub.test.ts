import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { BOT_THINK_MS, BOT_TILE_MS, BOT_SETTLE_MS, BOT_FINAL_TURN_MS, arrangeRun, botPlacementSteps, checkDraft, copyTable, createGame, endTurn, meld, tile, validateTurn, type State } from "../../shared/rummikub.js";
import { botTurn } from "../../shared/rummikub-bot.js";
import { LocalGame } from "../../client/src/rummikub/practice.js";
import { RummikubRoom } from "../src/rummikub-room.js";
import { validDefinition, type Definition, type Peer } from "../src/protocol.js";

const id = (color: number, n: number, copy = 0) => color * 26 + copy * 13 + n - 1;
const run = (color: number, start: number, count = 3) => Array.from({ length: count }, (_, i) => id(color, start + i));
function fixture(hand: number[], table: number[][] = [], opened = false): State {
  const used = new Set([...hand, ...table.flat()]);
  const remaining = Array.from({ length: 106 }, (_, i) => i).filter(i => !used.has(i));
  return { hands: [hand, remaining.splice(0, 14)], pile: remaining, table, opened: [opened, false], turn: 0, round: 1, passes: 0, winner: null, finished: false, scores: [] };
}
const definition: Definition = { game: "rummikub", roomId: "10:1:rummi", guildId: "10", hostId: "1", p2Id: "2", mode: "PVP",
  seats: [1, 2, 3, 4].map(n => ({ userId: String(n), name: `user${n}` })) };
function peer(id: string) { const messages: any[] = []; return { messages, peer: { id, name: id, send: (m: unknown) => messages.push(m) } as Peer }; }
function action(room: RummikubRoom, p: Peer, name: string, table?: number[][]) { room.handle(p, { action: name, table, matchId: room.matchId, turnId: room.game.round, revision: room.revision }); }
function readyRoom(t: TestContext, count = 4) {
  const room = new RummikubRoom({ ...definition, seats: definition.seats!.slice(0, count) }); t.after(() => room.dispose());
  const peers = Array.from({ length: count }, (_, i) => peer(String(i + 1))); peers.forEach(p => room.join(p.peer)); return { room, peers };
}

test("106 unique physical tiles, 14 per seat, duplicate copies and two jokers", () => {
  for (const count of [2, 3, 4]) {
    const game = createGame(count); assert.deepEqual(game.hands.map(h => h.length), Array(count).fill(14));
    assert.equal(new Set([...game.hands.flat(), ...game.pile]).size, 106); assert.equal(game.pile.length, 106 - count * 14);
  }
  assert.equal(tile(104).number, 0); assert.equal(tile(105).number, 0);
});
test("runs, reversed runs, groups and joker values reject wrapping/duplicate colors/gaps", () => {
  assert.ok(meld(run(0, 1))); assert.ok(meld(run(1, 10).reverse()));
  assert.ok(meld([id(0, 5), id(1, 5), id(2, 5), id(3, 5)]));
  assert.equal(meld([id(0, 12), id(0, 13), id(0, 1)]), null);
  assert.equal(meld([id(0, 5), id(0, 5, 1), id(2, 5)]), null);
  assert.equal(meld([id(0, 1), id(0, 2), id(0, 4)]), null);
  assert.equal(meld([id(0, 10), 104, id(0, 12)])?.points, 33);
  assert.equal(meld([id(0, 1), id(0, 2), 104])?.points, 6);
  assert.equal(meld([id(0, 1), 104, 105])?.points, 3); // valid same-number group
});
test("new tiles auto-sort ascending into runs and joker slots while groups retain order", () => {
  assert.deepEqual(arrangeRun([id(0, 3), id(0, 1), id(0, 2)]), run(0, 1, 3));
  assert.deepEqual(arrangeRun([id(0, 4), 104, id(0, 2)]), [id(0, 2), 104, id(0, 4)]);
  assert.deepEqual(arrangeRun([id(0, 4), id(0, 1), id(0, 3), 105]), [id(0, 1), 105, id(0, 3), id(0, 4)]);
  const group = [id(2, 7), id(0, 7), id(1, 7)];
  assert.deepEqual(arrangeRun(group), group);
});
test("first registration requires own 30 and cannot extend/manipulate existing groups", () => {
  const game = fixture([...run(0, 9), id(3, 1)], [run(1, 1)]);
  assert.equal(validateTurn(game, [...game.table, run(0, 9)]), null);
  assert.match(validateTurn(fixture(run(0, 8)), [run(0, 8)])!, /30/);
  const extending = fixture([id(1, 4), ...run(0, 9)], [run(1, 1)]);
  assert.match(validateTurn(extending, [run(1, 1, 4), run(0, 9)])!, /첫 등록/);
  endTurn(game, [...game.table, run(0, 9)]); assert.equal(game.opened[0], true); assert.deepEqual(game.hands[0], [id(3, 1)]);
});
test("invalid temporary draft is permitted; invalid commit doesn't mutate authoritative state", () => {
  const game = fixture([...run(0, 9), id(3, 1)]), before = structuredClone(game);
  assert.doesNotThrow(() => checkDraft(game, [[id(0, 9)]]));
  assert.throws(() => endTurn(game, [[id(0, 9)]])); assert.deepEqual(game, before);
  assert.throws(() => checkDraft(game, [[id(0, 9), id(0, 9)]]));
  assert.throws(() => checkDraft(game, [[game.hands[1][0]]]));
});
test("registered players split and extend table without losing any existing tile", () => {
  const game = fixture([id(0, 7), id(3, 1)], [run(0, 1, 6)], true);
  assert.equal(validateTurn(game, [run(0, 1), run(0, 4, 4)]), null);
  assert.match(validateTurn(game, [run(0, 4, 4)])!, /기존 테이블/);
  endTurn(game, [run(0, 1), run(0, 4, 4)]); assert.equal(game.hands[0].length, 1);
});
test("table joker requires matching replacement and reuse in same turn", () => {
  const table = [[id(0, 10), 104, id(0, 12)]];
  const hand = [id(0, 11), id(1, 3), id(1, 4), id(3, 1)];
  const game = fixture(hand, table, true);
  assert.equal(validateTurn(game, [run(0, 10), [id(1, 3), id(1, 4), 104]]), null);
  assert.match(validateTurn(game, [run(0, 10)])!, /기존 테이블/);
  assert.match(validateTurn(game, [[id(0, 10), id(1, 10), id(2, 10)]])!, /사용할 수 없는/);
  const stealing = fixture([id(1, 3), id(1, 4), id(1, 10), id(2, 10), id(1, 12), id(2, 12)], table, true);
  assert.match(validateTurn(stealing, [[id(0, 10), id(1, 10), id(2, 10)], [id(0, 12), id(1, 12), id(2, 12)], [id(1, 3), id(1, 4), 104]])!, /조커/);
});
test("reclaimed table joker permits splitting the old run into multiple valid melds", () => {
  const table = [[id(0, 1), 104, ...run(0, 3, 4)]];
  const hand = [id(0, 2), id(1, 7), id(2, 7), id(3, 7)];
  const game = fixture(hand, table, true);
  const rearranged = [run(0, 1, 3), run(0, 4, 3), [id(1, 7), id(2, 7), id(3, 7), 104]];
  assert.ok(rearranged.every(group => meld(group)), "every resulting table meld is valid");
  assert.equal(validateTurn(game, rearranged), null);
  endTurn(game, rearranged);
  assert.equal(game.hands[0].length, 0);
  assert.equal(game.winner, 0);
});
test("win scores conserve points; joker costs 30; exhausted pile doesn't deadlock", () => {
  const game = fixture(run(0, 9)); game.hands[1] = [104, id(1, 5)];
  endTurn(game, [run(0, 9)]); assert.equal(game.winner, 0); assert.deepEqual(game.scores, [35, -35]);
  const blocked = fixture([id(0, 1)]); blocked.pile = [];
  for (let i = 0; i < 3; i++) { endTurn(blocked, [], true); assert.equal(blocked.finished, false); }
  endTurn(blocked, [], true); assert.equal(blocked.finished, true); assert.equal(blocked.winner, null);
});
test("empty pile allows exactly two rounds for 2, 3 and 4 seats, with tied fewest tiles exempt", () => {
  for (const count of [2, 3, 4]) {
    const state = createGame(count); state.pile = [];
    state.hands = [[id(0, 13)], [id(1, 1), id(1, 2)], [104], [id(2, 3), id(2, 4)]].slice(0, count);
    for (let i = 0; i < count * 2 - 1; i++) { endTurn(state, [], true); assert.equal(state.finished, false); }
    assert.equal(state.passes, count * 2 - 1);
    endTurn(state, [], true); assert.equal(state.finished, true);
    assert.deepEqual(state.scores, [0, -3, 0, -7].slice(0, count));
  }
});
test("playing on the last chance resets the full stalled-round counter", () => {
  const state = fixture([...run(0, 9), id(3, 1)]); state.pile = []; state.passes = 3;
  endTurn(state, [run(0, 9)]);
  assert.equal(state.finished, false); assert.equal(state.passes, 0);
  for (let i = 0; i < 3; i++) { endTurn(state, state.table, true); assert.equal(state.finished, false); }
  endTurn(state, state.table, true); assert.equal(state.finished, true);
});
test("server snapshots announce the final stalled turn and the final score exemption", t => {
  const { room, peers } = readyRoom(t, 2);
  room.game.pile = []; room.game.hands = [[104], [id(0, 1), id(1, 1)]];
  for (let i = 0; i < 3; i++) action(room, peers[room.game.turn].peer, "draw");
  const warning = room.snapshot(peers[0].peer);
  assert.equal(warning.stalledTurns, warning.stallLimit - 1); assert.equal(warning.finished, false);
  action(room, peers[room.game.turn].peer, "draw");
  assert.equal(room.snapshot(peers[0].peer).endReason, "stalled"); assert.deepEqual(room.result!.seatScores, [0, -2]);
});
test("both table jokers can be replaced and reused using two distinct matching tiles", () => {
  const table = [[id(0, 9), 104, 105, id(0, 12)]];
  const hand = [id(0, 10), id(0, 11), id(1, 3), id(1, 4), id(2, 5), id(2, 6)];
  assert.equal(validateTurn(fixture(hand, table, true), [run(0, 9, 4), [id(1, 3), id(1, 4), 104], [id(2, 5), id(2, 6), 105]]), null);
});
test("moving a joker into an unrelated group still needs replacement even at the same value", () => {
  const table = [[id(0, 10), 104, id(0, 12)]];
  const hand = [id(1, 10), id(2, 10), id(1, 12), id(2, 12), id(1, 11), id(2, 11)];
  assert.match(validateTurn(fixture(hand, table, true), [[id(0, 10), id(1, 10), id(2, 10)], [id(0, 12), id(1, 12), id(2, 12)], [id(1, 11), id(2, 11), 104]])!, /조커/);
});
test("definition admits 2–4 mixed seats, rejects duplicate users and forged bots", () => {
  assert.ok(validDefinition(definition));
  assert.ok(validDefinition({ ...definition, seats: [definition.seats![0], { userId: null, name: "bot", bot: "hard" }] }));
  assert.equal(validDefinition({ ...definition, seats: [definition.seats![0], definition.seats![0]] }), false);
  assert.equal(validDefinition({ ...definition, seats: [definition.seats![0], { userId: "2", name: "bot", bot: "hard" }] }), false);
});
test("four-player private snapshots and spectators never carry opponent hand IDs", t => {
  const { room, peers } = readyRoom(t); const spectator = peer("99"); room.join(spectator.peer);
  for (let i = 0; i < 4; i++) {
    const state = peers[i].messages.at(-1); assert.deepEqual(state.hand, room.game.hands[i]);
    assert.equal(state.seat, i); assert.equal(state.hands, undefined); assert.equal(state.pile, undefined);
    assert.ok(state.seats.every((s: any) => s.count === 14 && !s.hand));
  }
  assert.deepEqual(spectator.messages.at(-1).hand, []);
  const before = room.revision; action(room, spectator.peer, "draw"); action(room, peers[1].peer, "draw"); assert.equal(room.revision, before);
});
test("invalid timeout fully rolls back table/hand before drawing exactly one", t => {
  const { room, peers } = readyRoom(t); const original = structuredClone(room.game);
  action(room, peers[0].peer, "draft", [[room.game.hands[0][0]]]);
  room.timeout(); assert.deepEqual(room.game.table, original.table); assert.deepEqual(room.game.hands[0].slice(0, 14), original.hands[0]);
  assert.equal(room.game.hands[0].length, 15); assert.equal(room.game.pile.length, original.pile.length - 1); assert.equal(room.game.turn, 1);
});
test("valid timeout commits; reconnect restores draft; stale requests cannot consume next turn", t => {
  const { room, peers } = readyRoom(t, 2); Object.assign(room.game, fixture([...run(0, 9), id(3, 1)]));
  action(room, peers[0].peer, "draft", [run(0, 9)]);
  room.leave(peers[0].peer); const replacement = peer("1"); room.join(replacement.peer);
  assert.deepEqual(replacement.messages.at(-1).table, [run(0, 9)]);
  const old = { action: "draw", matchId: room.matchId, turnId: room.game.round, revision: room.revision };
  room.timeout(); assert.deepEqual(room.game.table, [run(0, 9)]); assert.deepEqual(room.game.hands[0], [id(3, 1)]);
  const before = structuredClone(room.game); room.handle(peers[1].peer, old); assert.deepEqual(room.game, before);
});
test("invalid confirm resets draft, reset/undo never changes turn-start hand", t => {
  const { room, peers } = readyRoom(t); const hand = [...room.game.hands[0]];
  action(room, peers[0].peer, "draft", [[hand[0]]]); action(room, peers[0].peer, "commit");
  assert.deepEqual(room.draft, []); assert.deepEqual(room.game.hands[0], hand); assert.equal(room.game.turn, 0);
});
test("closed rooms stop accepting actions", t => {
  const { room, peers } = readyRoom(t); room.abort("closed"); const before = structuredClone(room.game);
  action(room, peers[0].peer, "draw"); room.timeout(); assert.deepEqual(room.game, before);
});
test("manual draw rejects any modified draft without altering hand, table, turn or deadline", t => {
  const { room, peers } = readyRoom(t, 2);
  Object.assign(room.game, fixture([...run(0, 9), id(3, 1)]));
  const before = structuredClone(room.game), deadline = room.deadline;
  for (const draft of [[[id(0, 9)]], [run(0, 9)]]) {
    action(room, peers[0].peer, "draft", draft); action(room, peers[0].peer, "draw");
    assert.deepEqual(room.game, before); assert.deepEqual(room.draft, draft); assert.equal(room.deadline, deadline);
    assert.match(peers[0].messages.findLast(m => m.type === "RUMMI_ERROR").message, /턴 초기화/);
  }
  action(room, peers[0].peer, "reset"); action(room, peers[0].peer, "draw");
  assert.equal(room.game.turn, 1); assert.equal(room.game.hands[0].length, before.hands[0].length + 1);
});
test("rearranging only existing tiles also blocks pass when the pile is empty", t => {
  const { room, peers } = readyRoom(t, 2);
  Object.assign(room.game, fixture([id(3, 1)], [run(0, 1, 6)], true)); room.game.pile = [];
  const before = structuredClone(room.game), draft = [run(0, 1), run(0, 4)];
  action(room, peers[0].peer, "draft", draft); action(room, peers[0].peer, "draw");
  assert.deepEqual(room.game, before); assert.deepEqual(room.draft, draft);
  action(room, peers[0].peer, "reset"); action(room, peers[0].peer, "draw"); assert.equal(room.game.turn, 1);
});
test("practice requires explicit reset before drawing and preserves edited tiles on rejection", t => {
  const views: any[] = [], messages: string[] = [];
  const local = new LocalGame(2, "normal", view => views.push(view), message => messages.push(message));
  t.after(() => local.dispose()); local.start();
  const before = structuredClone(local.state), deadline = views.at(-1).deadline, draft = [[local.state.hands[0][0]]];
  local.action("draft", draft); local.action("draw");
  assert.deepEqual(local.state, before); assert.deepEqual(views.at(-1).table, draft); assert.equal(views.at(-1).deadline, deadline);
  assert.match(messages.at(-1)!, /턴 초기화/);
  local.action("reset"); local.action("draw");
  assert.equal(local.state.turn, 1); assert.equal(local.state.hands[0].length, 15);
});
test("bounded bots complete seeded games with legal states and tile conservation", () => {
  for (let seed = 1; seed <= 3; seed++) {
    let value = seed; const random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 2 ** 32; };
    const game = createGame(4, random);
    for (let turn = 0; turn < 700 && !game.finished; turn++) {
      const before = structuredClone(game), draft = botTurn(game, turn % 2 ? "hard" : "normal");
      assert.deepEqual(game, before); if (draft) assert.equal(validateTurn(game, draft), null);
      endTurn(game, draft ?? game.table, !draft);
      assert.ok(game.table.every(g => meld(g))); assert.equal(new Set([...game.hands.flat(), ...game.pile, ...game.table.flat()]).size, 106);
    }
    assert.ok(game.finished);
  }
});
test("bot placement previews reveal one tile per step and preserve the existing table", () => {
  const original = [run(0, 1)], target = [run(0, 1, 4), run(1, 9)];
  const steps = botPlacementSteps(original, target);
  assert.deepEqual(steps.map(s => s.flat().length), [4, 5, 6, 7]);
  assert.deepEqual(steps.at(-1), target);
  for (const step of steps) assert.ok(original.flat().every(id => step.flat().includes(id)));
  assert.deepEqual(original, [run(0, 1)]);
});
test("online bot reveals timed placements to spectators and commits only after the final pause", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const room = new RummikubRoom({ ...definition, p2Id: null, seats: [definition.seats![0], { userId: null, name: "bot", bot: "normal" }] });
  t.after(() => room.dispose());
  const game = fixture([...run(0, 9), id(3, 1)]); game.hands.reverse(); Object.assign(room.game, game);
  const host = peer("1"), spectator = peer("99"); room.join(host.peer); room.join(spectator.peer);
  action(room, host.peer, "draw");
  t.mock.timers.tick(BOT_THINK_MS - 1); assert.deepEqual(room.draft, []);
  t.mock.timers.tick(1); assert.equal(room.draft.flat().length, 1); assert.deepEqual(room.game.table, []);
  assert.deepEqual(spectator.messages.at(-1).table, [[id(0, 9)]]); assert.deepEqual(spectator.messages.at(-1).hand, []);
  assert.equal(spectator.messages.at(-1).seats[1].count, 3);
  t.mock.timers.tick(BOT_TILE_MS); assert.equal(room.draft.flat().length, 2);
  t.mock.timers.tick(BOT_TILE_MS); assert.equal(room.draft.flat().length, 3); assert.equal(room.game.turn, 1);
  assert.equal(room.game.hands[1].length, 4); assert.deepEqual(room.game.table, []);
  t.mock.timers.tick(BOT_SETTLE_MS); assert.deepEqual(room.game.table, [run(0, 9)]); assert.equal(room.game.turn, 0); assert.equal(room.game.hands[1].length, 1);
});
test("closing during bot placement cancels remaining placement and commit timers", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const room = new RummikubRoom({ ...definition, p2Id: null, seats: [definition.seats![0], { userId: null, name: "bot", bot: "normal" }] });
  t.after(() => room.dispose());
  const game = fixture([...run(0, 9), id(3, 1)]); game.hands.reverse(); Object.assign(room.game, game);
  const host = peer("1"); room.join(host.peer); action(room, host.peer, "draw");
  t.mock.timers.tick(BOT_THINK_MS); room.abort("closed");
  const before = structuredClone(room.game), draft = copyTable(room.draft);
  t.mock.timers.tick(60_000); assert.deepEqual(room.game, before); assert.deepEqual(room.draft, draft);
});
test("the final bot turn leaves three seconds to read the forced-end warning", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const room = new RummikubRoom({ ...definition, p2Id: null, seats: [definition.seats![0], { userId: null, name: "bot", bot: "normal" }] });
  t.after(() => room.dispose());
  Object.assign(room.game, fixture([id(0, 1)])); room.game.hands[1] = [id(1, 1)]; room.game.pile = []; room.game.passes = 2;
  const host = peer("1"); room.join(host.peer); action(room, host.peer, "draw");
  assert.equal(room.snapshot(host.peer).stalledTurns, 3);
  t.mock.timers.tick(BOT_FINAL_TURN_MS - 1); assert.equal(room.game.finished, false);
  t.mock.timers.tick(1); assert.equal(room.game.finished, true); assert.deepEqual(room.game.scores, [0, 0]);
});
test("offline practice uses the same timed bot preview and commits after it", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const views: any[] = [], game = new LocalGame(2, "normal", view => views.push(view), message => assert.fail(message));
  t.after(() => game.dispose());
  const state = fixture([...run(0, 9), id(3, 1)]); state.hands.reverse(); Object.assign(game.state, state);
  game.start(); game.action("draw");
  t.mock.timers.tick(BOT_THINK_MS); assert.equal(views.at(-1).table.flat().length, 1);
  t.mock.timers.tick(BOT_TILE_MS); assert.equal(views.at(-1).table.flat().length, 2);
  t.mock.timers.tick(BOT_TILE_MS); assert.equal(views.at(-1).turn, 1);
  t.mock.timers.tick(BOT_SETTLE_MS); assert.equal(views.at(-1).turn, 0); assert.deepEqual(game.state.table, [run(0, 9)]);
});
