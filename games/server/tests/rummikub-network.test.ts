import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

test("Rummikub HTTP handoff and real WS: four private seats, draft sync, spectator and reconnect", { timeout: 10000 }, async () => {
  process.env.PORT = "0"; process.env.DISCORD_CLIENT_ID = "rummi-test";
  process.env.ACTIVITY_INTERNAL_SECRET = randomUUID(); delete process.env.BOT_INTERNAL_URL;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://discord.com/")) return realFetch(url, options);
    const id = new Headers(options?.headers).get("Authorization")!.replace("Bearer ", "");
    if (String(url).endsWith("/oauth2/@me")) return Response.json({ application: { id: "rummi-test" } });
    if (String(url).endsWith("/member")) return Response.json({ nick: `user${id}` });
    return Response.json({ id, username: `user${id}` });
  };
  const { server, shutdown } = await import("../src/index.js");
  const sockets: WebSocket[] = [];
  try {
    if (!server.listening) await once(server, "listening");
    const port = (server.address() as any).port, base = `http://127.0.0.1:${port}`;
    const definition = { game: "rummikub", roomId: "10:1:rummi-network", matchId: "rummi-match", guildId: "10", hostId: "1", p2Id: "2", mode: "PVP", seats: [1, 2, 3, 4].map(i => ({ userId: String(i), name: `user${i}` })) };
    const create = () => realFetch(base + "/internal/game-sessions", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + process.env.ACTIVITY_INTERNAL_SECRET }, body: JSON.stringify(definition) });
    assert.equal((await create()).status, 201); assert.equal((await create()).status, 200);
    async function until(predicate: () => boolean) {
      const stop = Date.now() + 2000;
      while (!predicate()) { if (Date.now() > stop) throw new Error("Protocol timeout"); await new Promise(r => setTimeout(r, 5)); }
    }
    async function connect(id: string) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(ws); const messages: any[] = [];
      ws.on("message", data => messages.push(JSON.parse(String(data))));
      await once(ws, "open"); ws.send(JSON.stringify({ type: "AUTH", token: id, roomId: definition.roomId }));
      await until(() => messages.some(m => m.type === "RUMMI_STATE"));
      return { ws, messages, state: () => messages.filter(m => m.type === "RUMMI_STATE").at(-1) };
    }
    const players = [];
    for (let i = 1; i <= 4; i++) players.push(await connect(String(i)));
    const observer = await connect("99");
    await until(() => players.every(p => p.state().started));
    assert.deepEqual(observer.state().hand, []); assert.equal(observer.state().seat, -1);
    assert.equal(new Set(players.flatMap(p => p.state().hand)).size, 56);
    const host = players[0], initial = host.state();
    host.ws.send(JSON.stringify({ type: "RUMMI_ACTION", action: "draft", table: [[initial.hand[0]]], matchId: initial.matchId, turnId: initial.turnId, revision: initial.revision }));
    await until(() => observer.state().table.length === 1);
    assert.deepEqual(observer.state().table, [[initial.hand[0]]]);
    assert.deepEqual(players[1].state().hand, players[1].messages[0].hand);
    const draft = host.state();
    host.ws.close(); await once(host.ws, "close");
    const reconnected = await connect("1"); assert.deepEqual(reconnected.state().table, draft.table); assert.deepEqual(reconnected.state().hand, initial.hand);
    const state = reconnected.state();
    reconnected.ws.send(JSON.stringify({ type: "RUMMI_ACTION", action: "draw", matchId: state.matchId, turnId: state.turnId, revision: state.revision }));
    await until(() => reconnected.messages.some(m => m.type === "RUMMI_ERROR"));
    assert.deepEqual(reconnected.state().table, draft.table); assert.equal(reconnected.state().hand.length, 14);
    assert.equal(reconnected.state().turn, 0); assert.equal(reconnected.state().deadline, state.deadline);
    reconnected.ws.send(JSON.stringify({ type: "RUMMI_ACTION", action: "reset", matchId: state.matchId, turnId: state.turnId, revision: state.revision }));
    await until(() => reconnected.state().table.length === 0);
    const reset = reconnected.state();
    reconnected.ws.send(JSON.stringify({ type: "RUMMI_ACTION", action: "draw", matchId: reset.matchId, turnId: reset.turnId, revision: reset.revision }));
    await until(() => players[1].state().turn === 1);
    assert.deepEqual(players[1].state().table, []); assert.equal(reconnected.state().hand.length, 15);
    const denied = observer.state();
    observer.ws.send(JSON.stringify({ type: "RUMMI_ACTION", action: "draw", matchId: denied.matchId, turnId: denied.turnId, revision: denied.revision }));
    await until(() => observer.messages.some(m => m.type === "RUMMI_ERROR"));
    assert.equal(observer.state().turn, 1);
    assert.equal((await realFetch(base + "/internal/game-sessions", { method: "DELETE", headers: { Authorization: "Bearer " + process.env.ACTIVITY_INTERNAL_SECRET, "content-type": "application/json" }, body: JSON.stringify({ roomId: definition.roomId }) })).status, 200);
    await until(() => observer.messages.some(m => m.type === "ROOM_CLOSED"));
  } finally { for (const ws of sockets) ws.terminate(); shutdown(); globalThis.fetch = realFetch; }
});
