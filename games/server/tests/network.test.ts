import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";

test("HTTP handoff, verified WS roles, relay, history, callback retry and deletion", async () => {
  process.env.PORT = "0";
  process.env.DISCORD_CLIENT_ID = "app";
  process.env.ACTIVITY_INTERNAL_SECRET = "test-secret-".repeat(4);
  process.env.BOT_INTERNAL_URL = "http://mock-bot";
  const realFetch = globalThis.fetch;
  const results: any[] = [];
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.startsWith("http://mock-bot")) {
      results.push(JSON.parse(String(options?.body)));
      return Response.json({ ok: results.length > 1 }, { status: results.length > 1 ? 200 : 503 });
    }
    if (address.startsWith("https://discord.com/")) {
      const token = new Headers(options?.headers).get("Authorization")?.replace("Bearer ", "");
      if (token === "invalid") return Response.json({}, { status: 401 });
      if (address.endsWith("/oauth2/@me")) return Response.json({ application: { id: token === "foreign" ? "other-app" : "app" } });
      if (address.endsWith("/member")) return Response.json({ nick: "guild-" + token });
      return Response.json({ id: token, username: "user-" + token });
    }
    return realFetch(url, options);
  };
  const { server, shutdown } = await import("../src/index.js");
  const sockets: WebSocket[] = [];
  try {
    if (!server.listening) await once(server, "listening");
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}`;
    const definition = { roomId: "10:1:test", guildId: "10", hostId: "1", p2Id: "2", mode: "PVP" };
    const create = (authorized = true) => realFetch(base + "/internal/game-sessions", {
      method: "POST", headers: { "content-type": "application/json", Authorization: authorized ? "Bearer " + process.env.ACTIVITY_INTERNAL_SECRET : "bad" }, body: JSON.stringify(definition),
    });
    assert.equal((await create(false)).status, 401);
    const created = await (await create()).json();
    assert.equal((await (await create()).json()).seed, created.seed);
    async function connect(token: string) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(socket);
      const messages: any[] = [];
      socket.on("message", raw => messages.push(JSON.parse(raw.toString())));
      await once(socket, "open"); socket.send(JSON.stringify({ type: "AUTH", token, roomId: definition.roomId, userId: "1" }));
      return { socket, messages };
    }
    async function until(predicate: () => boolean, timeout = 2000) {
      const deadline = Date.now() + timeout;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for protocol message");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    for (const token of ["invalid", "foreign"]) {
      const denied = await connect(token);
      await until(() => denied.messages.some(message => message.type === "ERROR"));
      assert.equal(denied.messages.some(message => message.type === "GAME_START"), false);
    }
    const host = await connect("1"), guest = await connect("2");
    await until(() => host.messages.some(message => message.type === "PRESENCE" && message.ready));
    assert.equal(guest.messages.find(message => message.type === "GAME_START").role, "right");
    const input = { type: "INPUT", tick: 1, seq: 1, input: { x: 0, y: 0, hit: false, jump: false } };
    host.socket.send(JSON.stringify(input)); guest.socket.send(JSON.stringify(input));
    await until(() => host.messages.some(message => message.type === "FRAME"));
    const spectator = await connect("3");
    await until(() => spectator.messages.some(message => message.type === "CAUGHT_UP"));
    assert.equal(spectator.messages[0].role, "spectator");
    assert.equal(spectator.messages.find(message => message.type === "HISTORY").frames.length, 1);
    const result = { type: "RESULT", tick: 1, score: { left: 7, right: 2 } };
    host.socket.send(JSON.stringify(result)); guest.socket.send(JSON.stringify(result));
    await until(() => host.messages.some(message => message.type === "FINISHED"), 12000);
    assert.equal(results.length, 2);
    assert.equal(results[0].winnerId, "1");
    // 재대결: 같은 roomId로 handoff가 다시 오면 끝난 방을 새 방(새 seed)으로 취급해야 한다.
    const rematch = await create();
    assert.equal(rematch.status, 201);
    const rematchBody = await rematch.json();
    assert.notEqual(rematchBody.seed, created.seed);
    const late = await connect("4");
    await until(() => late.messages.some(message => message.type === "GAME_START"));
    assert.equal(late.messages.find(message => message.type === "GAME_START").role, "spectator");
  } finally {
    for (const socket of sockets) socket.terminate();
    shutdown(); globalThis.fetch = realFetch;
  }
});
