import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrowDodgeRoom } from "../src/arrow-dodge-room.js";
import { validDefinition, type Peer } from "../src/protocol.js";

const definition = { game: "arrow_dodge", roomId: "10:1:arrow", guildId: "10", hostId: "1", p2Id: null, mode: "SOLO" } as const;
const idle = { x: 0, y: 0, jump: false, hit: false } as const;
function participant(id: string) {
  const messages: any[] = [];
  const peer: Peer = { id, name: "user" + id, send: message => messages.push(message) };
  return { peer, messages };
}

test("arrow dodge accepts only a solo definition and relays host input with start", () => {
  assert.equal(validDefinition(definition), true);
  assert.equal(validDefinition({ ...definition, mode: "CPU" }), false);
  assert.equal(validDefinition({ ...definition, p2Id: "2" }), false);
  const room = new ArrowDodgeRoom(definition), host = participant("1"), viewer = participant("2");
  room.join(host.peer); room.join(viewer.peer);
  assert.equal(host.messages[0].role, "left"); assert.equal(viewer.messages[0].role, "spectator");
  room.input(viewer.peer, { tick: 1, seq: 1, input: idle });
  room.input(host.peer, { tick: 1, seq: 1, input: { ...idle, start: true } });
  assert.equal(room.history.length, 1);
  assert.equal(room.history[0].left.start, true);
});

test("only the host can submit a tick-consistent survival result", () => {
  const room = new ArrowDodgeRoom(definition), host = participant("1"), viewer = participant("2");
  room.join(host.peer); room.join(viewer.peer);
  for (let tick = 1; tick <= 180; tick++) room.input(host.peer, { tick, seq: tick, input: { ...idle, start: tick === 1 } });
  const result = { matchId: room.matchId, tick: 180, survivalTicks: 59, survivalMs: 983 };
  room.report(viewer.peer, result); assert.equal(room.result, null);
  room.report(host.peer, result);
  assert.equal(room.result?.winnerId, "1"); assert.equal(room.result?.survivalMs, 983);
});

test("forged duration and future result ticks are rejected", () => {
  const room = new ArrowDodgeRoom(definition), host = participant("1"); room.join(host.peer);
  room.input(host.peer, { tick: 1, seq: 1, input: idle });
  assert.throws(() => room.report(host.peer, { matchId: room.matchId, tick: 2, survivalTicks: 1, survivalMs: 17 }));
  assert.throws(() => room.report(host.peer, { matchId: room.matchId, tick: 1, survivalTicks: 1, survivalMs: 999 }));
});
