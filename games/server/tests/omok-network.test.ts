import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";

test("gomoku HTTP/WS: authoritative moves, reconnect, result callback and two-player rematch", async () => {
  process.env.PORT = "0"; process.env.DISCORD_CLIENT_ID = "app";
  process.env.ACTIVITY_INTERNAL_SECRET = "omok-test-secret-".repeat(3);
  process.env.BOT_INTERNAL_URL = "http://mock-bot";
  const originalFetch = globalThis.fetch, sockets: WebSocket[] = [], results: any[] = [];
  let base = "";
  let definition = { game: "omok", roomId: "10:1:omok", matchId: "first", guildId: "10", hostId: "1", p2Id: "2", mode: "PVP", difficulty: "normal" };
  const headers = { "content-type": "application/json", Authorization: "Bearer " + process.env.ACTIVITY_INTERNAL_SECRET };
  const handoff = () => originalFetch(base + "/internal/game-sessions", { method: "POST", headers, body: JSON.stringify(definition) });
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.startsWith("https://discord.com/")) {
      const id = new Headers(options?.headers).get("Authorization")?.replace("Bearer ", "");
      if (address.endsWith("/oauth2/@me")) return Response.json({ application: { id: "app" } });
      if (address.endsWith("/member")) return Response.json({ nick: "player-" + id });
      return Response.json({ id, username: "player-" + id });
    }
    if (address.startsWith("http://mock-bot")) {
      const payload = JSON.parse(String(options?.body));
      if (address.endsWith("/game-results")) { results.push(payload); return Response.json({ ok: true }); }
      assert.equal(payload.matchId, definition.matchId);
      definition = { ...definition, matchId: "second" };
      assert.equal((await handoff()).status, 201);
      return Response.json({ roomId: definition.roomId, matchId: definition.matchId });
    }
    return originalFetch(url, options);
  };
  const { server, shutdown } = await import("../src/index.js");
  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 7000;
    while (!check()) { if (Date.now() > deadline) throw new Error("gomoku protocol timeout"); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  try {
    if (!server.listening) await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    assert.equal((await handoff()).status, 201);
    assert.equal((await handoff()).status, 200);
    async function connect(id: string) {
      const socket = new WebSocket(base.replace("http", "ws") + "/ws"); sockets.push(socket);
      const messages: any[] = [];
      socket.on("message", raw => messages.push(JSON.parse(raw.toString())));
      await once(socket, "open"); socket.send(JSON.stringify({ type: "AUTH", roomId: definition.roomId, token: id }));
      await until(() => messages.some(m => m.type === "OMOK_STATE"));
      return { socket, messages, state: () => messages.filter(m => m.type === "OMOK_STATE").at(-1) };
    }
    const host = await connect("1"), guest = await connect("2"), spectator = await connect("3");
    await until(() => host.state().ready);
    assert.equal(spectator.messages[0].role, "spectator");
    await until(() => Date.now() >= host.state().startsAt);
    const black = host.state().blackSide === "left" ? host : guest, white = black === host ? guest : host;
    spectator.socket.send(JSON.stringify({ type: "MOVE", matchId: "first", revision: 0, at: 100 }));
    await until(() => spectator.messages.some(m => m.type === "MOVE_REJECTED"));
    host.socket.send(JSON.stringify({ type: "RESULT", matchId: "first", score: { left: 7, right: 0 }, tick: 1 }));
    for (const [player, at] of [[black, 0], [white, 30], [black, 1], [white, 31], [black, 2], [white, 32], [black, 3], [white, 33], [black, 4]] as const) {
      const revision = host.state().state.moves.length;
      player.socket.send(JSON.stringify({ type: "MOVE", matchId: "first", revision, at }));
      await until(() => host.state().state.moves.length === revision + 1);
    }
    assert.equal(host.state().result.winnerSide, host.state().blackSide);
    const late = await connect("4");
    assert.deepEqual(late.state().state, host.state().state);
    await until(() => host.messages.some(m => m.type === "FINISHED"));
    assert.equal(results[0].winnerId, black === host ? "1" : "2");
    const rematch = (id: string) => originalFetch(base + "/api/rematch", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + id }, body: JSON.stringify({ roomId: definition.roomId, matchId: "first" }) });
    assert.equal((await rematch("3")).status, 403);
    assert.equal((await rematch("1")).status, 202);
    assert.equal((await rematch("2")).status, 200);
    await until(() => spectator.messages.some(m => m.type === "MATCH_REPLACED"));
    const next = await connect("1");
    assert.equal(next.state().matchId, "second"); assert.equal(next.state().state.moves.length, 0);
    assert.equal(next.state().room.game, "omok"); assert.equal(next.state().room.difficulty, "normal");
    await originalFetch(base + "/internal/game-sessions", { method: "DELETE", headers, body: JSON.stringify({ roomId: definition.roomId }) });
    await until(() => next.messages.some(m => m.type === "ROOM_CLOSED"));
  } finally { sockets.forEach(socket => socket.terminate()); shutdown(); globalThis.fetch = originalFetch; }
});
