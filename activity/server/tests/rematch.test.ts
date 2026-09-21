import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";

test("CPU/PVP rematches synchronize via bot, preserve difficulty and reject stale rounds", async () => {
  process.env.PORT = "0";
  process.env.DISCORD_CLIENT_ID = "app";
  process.env.ACTIVITY_INTERNAL_SECRET = "test-secret-".repeat(4);
  process.env.BOT_INTERNAL_URL = "http://mock-bot";
  const realFetch = globalThis.fetch;
  let base = "", serial = 0;
  const definitions = new Map<string, any>();
  const results: any[] = [];
  const handoff = (definition: any) => realFetch(base + "/internal/game-sessions", {
    method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + process.env.ACTIVITY_INTERNAL_SECRET }, body: JSON.stringify(definition),
  });
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.startsWith("http://mock-bot")) {
      const payload = JSON.parse(String(options?.body));
      if (address.endsWith("/game-results")) { results.push(payload); return Response.json({ ok: true }); }
      const prior = definitions.get(payload.roomId);
      assert.equal(prior.matchId, payload.matchId);
      const next = { ...prior, matchId: `match-${++serial}` };
      const response = await handoff(next);
      assert.equal(response.status, 201);
      definitions.set(next.roomId, next);
      return Response.json({ roomId: next.roomId, matchId: next.matchId });
    }
    if (address.startsWith("https://discord.com/")) {
      const token = new Headers(options?.headers).get("Authorization")?.replace("Bearer ", "");
      if (address.endsWith("/oauth2/@me")) return Response.json({ application: { id: "app" } });
      if (address.endsWith("/member")) return Response.json({ nick: "guild-" + token });
      return Response.json({ id: token, username: "user-" + token });
    }
    return realFetch(url, options);
  };
  const { server, shutdown } = await import("../src/index.js");
  const sockets: WebSocket[] = [];
  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 7000;
    while (!check()) { if (Date.now() > deadline) throw new Error("protocol timeout"); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  try {
    if (!server.listening) await once(server, "listening");
    const port = (server.address() as any).port;
    base = `http://127.0.0.1:${port}`;
    async function connect(definition: any, id: string) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(socket);
      const messages: any[] = [];
      socket.on("message", raw => messages.push(JSON.parse(raw.toString())));
      await once(socket, "open"); socket.send(JSON.stringify({ type: "AUTH", token: id, roomId: definition.roomId }));
      await until(() => messages.some(message => message.type === "CAUGHT_UP"));
      return { socket, messages };
    }
    const rematch = (definition: any, token: string) => realFetch(base + "/api/rematch", {
      method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ roomId: definition.roomId, matchId: definition.matchId }),
    });
    for (const mode of ["CPU", "PVP"]) {
      let definition = { roomId: `10:1:${mode}`, guildId: "10", hostId: "1", p2Id: mode === "PVP" ? "2" : null, mode, difficulty: "extreme", matchId: `match-${++serial}` };
      definitions.set(definition.roomId, definition);
      assert.equal((await handoff(definition)).status, 201);
      for (let round = 0; round < (mode === "CPU" ? 2 : 1); round++) {
        const host = await connect(definition, "1");
        const guest = mode === "PVP" ? await connect(definition, "2") : null;
        const spectator = await connect(definition, "3");
        const players = [host, ...(guest ? [guest] : [])];
        for (const player of players) player.socket.send(JSON.stringify({ type: "INPUT", matchId: definition.matchId, tick: 1, seq: 1, input: { x: 0, y: 0, hit: false, jump: false } }));
        await until(() => host.messages.some(message => message.type === "FRAME"));
        for (const player of players) player.socket.send(JSON.stringify({ type: "RESULT", matchId: definition.matchId, tick: 1, score: { left: 5, right: round } }));
        await until(() => host.messages.some(message => message.type === "RESULT_PENDING"));
        const late = await connect(definition, "4"); // Can recover before bot delivery too.
        await until(() => host.messages.some(message => message.type === "FINISHED"));
        await until(() => late.messages.some(message => message.type === "FINISHED"));
        assert.equal(results.at(-1).matchId, definition.matchId);
        assert.equal((await rematch(definition, "3")).status, 403);
        if (mode === "PVP") assert.equal((await rematch(definition, "1")).status, 202);
        assert.equal((await rematch(definition, mode === "PVP" ? "2" : "1")).status, 200);
        await until(() => spectator.messages.some(message => message.type === "MATCH_REPLACED"));
        assert.equal((await rematch(definition, "1")).status, 409);
        for (const player of [...players, spectator, late]) player.socket.close();
        const next = definitions.get(definition.roomId);
        assert.notEqual(next.matchId, definition.matchId);
        assert.equal(next.difficulty, "extreme");
        definition = next;
      }
    }
  } finally {
    for (const socket of sockets) socket.terminate();
    shutdown(); globalThis.fetch = realFetch;
  }
});
