import { test } from "node:test";
import assert from "node:assert/strict";
import { RelayRoom } from "../src/volleyball-room.js";
import { validDefinition, validInput, type Peer } from "../src/protocol.js";

const idle = { x: 0, y: 0, jump: false, hit: false } as const;
const definition = { roomId: "10:1:test", guildId: "10", hostId: "1", p2Id: "2", mode: "PVP" } as const;
function participant(id: string) {
  const messages: any[] = [];
  const peer: Peer = { id, name: "user" + id, send: message => messages.push(message) };
  return { peer, messages };
}
function input(room: RelayRoom, peer: Peer, tick: number, seq = tick) { room.input(peer, { tick, seq, input: idle }); }

test("roles are fixed and PVP waits for both registered players", () => {
  const room = new RelayRoom(definition);
  const host = participant("1"), guest = participant("2"), spectator = participant("3");
  room.join(host.peer); room.join(spectator.peer);
  input(room, host.peer, 1);
  assert.equal(room.history.length, 0);
  room.join(guest.peer);
  assert.equal(spectator.messages[0].role, "spectator");
  input(room, spectator.peer, 1);
  assert.equal(room.pending.size, 0);
  input(room, host.peer, 1);
  assert.equal(room.history.length, 0);
  input(room, guest.peer, 1);
  assert.equal(room.history.length, 1);
  assert.throws(() => room.join(participant("1").peer));
});

test("out-of-order ticks commit once, in order, and late spectators get full history", () => {
  const room = new RelayRoom(definition), host = participant("1"), guest = participant("2");
  room.join(host.peer); room.join(guest.peer);
  input(room, host.peer, 2, 1); input(room, guest.peer, 2, 1);
  assert.equal(room.history.length, 0);
  input(room, host.peer, 1, 2); input(room, guest.peer, 1, 2);
  input(room, host.peer, 1, 3);
  assert.deepEqual(room.history.map(frame => frame.tick), [1, 2]);
  const spectator = participant("3"); room.join(spectator.peer);
  assert.equal(spectator.messages[0].seed, host.messages[0].seed);
  assert.deepEqual(spectator.messages.find(message => message.type === "HISTORY").frames, room.history);
  assert.throws(() => input(room, host.peer, 99, 4));
});

test("disconnect pauses input, reconnect preserves identity, sequence and history", () => {
  const room = new RelayRoom(definition), host = participant("1"), guest = participant("2");
  room.join(host.peer); room.join(guest.peer);
  input(room, host.peer, 1); input(room, guest.peer, 1);
  room.leave(guest.peer); input(room, host.peer, 2);
  assert.equal(room.history.length, 1);
  const replacement = participant("2"); room.join(replacement.peer);
  assert.equal(replacement.messages[0].seq, 1);
  assert.equal(replacement.messages[0].committedTick, 1);
  input(room, host.peer, 2); input(room, replacement.peer, 2);
  assert.equal(room.history.length, 2);
});

test("PVP needs matching player results; spectators cannot finish or take a seat", () => {
  const room = new RelayRoom(definition), host = participant("1"), guest = participant("2"), spectator = participant("3");
  for (const participant of [host, guest, spectator]) room.join(participant.peer);
  input(room, host.peer, 1); input(room, guest.peer, 1);
  const result = { tick: 1, score: { left: 7, right: 2 } };
  room.report(spectator.peer, result); room.report(host.peer, result);
  assert.equal(room.result, null);
  room.report(guest.peer, result);
  assert.equal(room.result!.winnerId, "1");
  assert.doesNotThrow(() => room.join(participant("4").peer));
});

test("CPU relays host input only and a CPU victory has null winnerId", () => {
  const room = new RelayRoom({ ...definition, p2Id: null, mode: "CPU" }), host = participant("1");
  room.join(host.peer); input(room, host.peer, 1);
  assert.equal(room.history[0].right, null);
  room.report(host.peer, { tick: 1, score: { left: 0, right: 7 } });
  assert.equal(room.result!.winnerId, null);
});

test("invalid room definitions and input values fail validation", () => {
  assert.ok(validDefinition(definition));
  assert.equal(validDefinition({ ...definition, p2Id: "1" }), false);
  assert.equal(validDefinition({ ...definition, mode: "CPU" }), false);
  assert.equal(validInput({ ...idle, jump: 1 }), false);
  assert.equal(validInput({ ...idle, x: 2 }), false);
});

test("mismatched results abort and rooms do not share inputs", () => {
  const room = new RelayRoom(definition), other = new RelayRoom({ ...definition, roomId: "other" });
  const host = participant("1"), guest = participant("2");
  room.join(host.peer); room.join(guest.peer);
  input(room, host.peer, 1); input(room, guest.peer, 1);
  assert.equal(other.history.length, 0);
  room.report(host.peer, { tick: 1, score: { left: 7, right: 2 } });
  room.report(guest.peer, { tick: 1, score: { left: 2, right: 7 } });
  assert.equal(room.result!.aborted, true);
});


test("CPU difficulty is validated and delivered unchanged to reconnects and rematches", () => {
  for (const difficulty of ["easy", "normal", "hard", "extreme"] as const) {
    const cpu = { ...definition, mode: "CPU", p2Id: null, difficulty } as const;
    assert.equal(validDefinition(cpu), true);
    const room = new RelayRoom(cpu);
    const host = participant("1"); room.join(host.peer);
    assert.equal(host.messages[0].room.difficulty, difficulty);
    room.leave(host.peer);
    const reconnect = participant("1"); room.join(reconnect.peer);
    assert.equal(reconnect.messages[0].room.difficulty, difficulty);
    const rematch = new RelayRoom(room.definition);
    const spectator = participant("3"); rematch.join(spectator.peer);
    assert.equal(spectator.messages[0].room.difficulty, difficulty);
  }
  assert.equal(validDefinition({ ...definition, mode: "CPU", p2Id: null, difficulty: "impossible" }), false);
  assert.equal(validDefinition({ ...definition, mode: "CPU", p2Id: null }), true);
});


test("spectator capacity reserves both player seats and rejects duplicate spectators", () => {
  const room = new RelayRoom(definition);
  for (let id = 3; id < 53; id++) room.join(participant(String(id)).peer);
  assert.throws(() => room.join(participant("3").peer), /다른 창/);
  assert.throws(() => room.join(participant("53").peer), /관전 인원/);
  room.join(participant("1").peer); room.join(participant("2").peer);
  assert.equal(room.ready(), true);
});

test("finished rooms replay history and final result to reconnecting spectators", () => {
  const room = new RelayRoom({ ...definition, p2Id: null, mode: "CPU" });
  const host = participant("1"); room.join(host.peer); input(room, host.peer, 1);
  room.report(host.peer, { tick: 1, score: { left: 7, right: 1 } });
  const pending = participant("3"); room.join(pending.peer);
  assert.equal(pending.messages.at(-1).type, "RESULT_PENDING");
  room.delivered = true;
  const late = participant("4"); room.join(late.peer);
  assert.ok(late.messages.some(message => message.type === "HISTORY"));
  assert.equal(late.messages.at(-1).type, "FINISHED");
  assert.equal(late.messages.at(-1).result.matchId, room.matchId);
});

test("stalled player is identified and stale match inputs cannot change the game", () => {
  const room = new RelayRoom(definition), host = participant("1"), guest = participant("2");
  room.join(host.peer); room.join(guest.peer);
  room.input(host.peer, { tick: 1, seq: 1, input: idle, matchId: "old" });
  assert.equal(room.pending.size, 0);
  input(room, host.peer, 1);
  room.lastActivity = Date.now() - 4000;
  room.connectionStatus();
  assert.deepEqual(host.messages.at(-1).waitingFor, ["2"]);
});

test("volleyball broadcasts only connected spectator profiles and removes departed viewers", () => {
  const room = new RelayRoom(definition), host = participant("1"), guest = participant("2"), viewer = participant("3");
  viewer.peer.avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
  room.join(host.peer); room.join(guest.peer); room.join(viewer.peer);
  assert.deepEqual(host.messages.at(-1).spectators, [{ id: "3", displayName: "user3", avatarUrl: viewer.peer.avatarUrl }]);
  assert.equal(host.messages.at(-1).players.length, 2);
  room.leave(viewer.peer);
  assert.deepEqual(host.messages.at(-1).spectators, []);
  assert.equal(room.ready(), true);
});
