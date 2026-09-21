import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { RelayRoom, validDefinition, type Peer } from "./rooms.js";
import { identity, member, DiscordRateLimitError } from "./auth.js";

const secret = process.env.ACTIVITY_INTERNAL_SECRET ?? "";
const clientId = process.env.DISCORD_CLIENT_ID ?? "";
const rooms = new Map<string, RelayRoom>();
const rematches = new Map<string, Promise<any>>();
function internal(req: IncomingMessage) {
  const supplied = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from("Bearer " + secret);
  return secret.length >= 32 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function body(req: IncomingMessage) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 8192) throw new Error("요청이 너무 큽니다.");
  }
  return JSON.parse(data);
}
function json(res: ServerResponse, code: number, value: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://server");
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname === "/api/config") return json(res, 200, { clientId });
    if (req.method === "DELETE" && url.pathname === "/internal/game-sessions") {
      if (!internal(req)) return json(res, 401, { error: "Unauthorized" });
      const value = await body(req);
      if (typeof value.roomId !== "string") return json(res, 400, { error: "Invalid room" });
      rooms.get(value.roomId)?.broadcast({ type: "ROOM_CLOSED", message: "방장이 방을 닫았습니다." });
      rooms.delete(value.roomId);
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/internal/game-sessions") {
      if (!internal(req)) return json(res, 401, { error: "Unauthorized" });
      const definition = await body(req);
      if (!validDefinition(definition)) return json(res, 400, { error: "Invalid room" });
      if (definition.mode === "CPU") definition.difficulty ??= "normal";
      // 결과가 나온(끝난) 방이 아직 안 지워졌으면 재대결 요청으로 보고 새 방처럼 취급한다 — roomId는 재사용.
      const stale = rooms.get(definition.roomId);
      if (stale?.result && definition.matchId !== stale.matchId) {
        if (!stale.delivered) return json(res, 409, { error: "결과 전송이 완료되지 않았습니다." });
        rooms.delete(definition.roomId);
      }
      const existing = rooms.get(definition.roomId);
      if (existing && ((Object.keys(existing.definition) as Array<keyof typeof definition>).some(key => key !== "matchId" && existing.definition[key] !== definition[key]))) return json(res, 409, { error: "Room conflict" });
      if (!existing && rooms.size >= 200) return json(res, 503, { error: "Room capacity reached" });
      if (existing && definition.matchId && existing.matchId !== definition.matchId) return json(res, 409, { error: "다른 경기가 진행 중입니다." });
      const room = existing ?? new RelayRoom(definition);
      rooms.set(definition.roomId, room);
      if (stale && stale !== room) stale.broadcast({ type: "MATCH_REPLACED" });
      return json(res, existing ? 200 : 201, { roomId: definition.roomId, matchId: room.matchId, seed: room.seed, tickRate: 60 });
    }
    if (req.method === "POST" && url.pathname === "/api/oauth/token") {
      if (!clientId || !process.env.DISCORD_CLIENT_SECRET) return json(res, 503, { error: "Discord 앱 설정이 필요합니다." });
      const value = await body(req);
      if (typeof value.code !== "string" || value.code.length > 2048) return json(res, 400, { error: "Invalid OAuth code" });
      const response = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST", body: new URLSearchParams({ client_id: clientId, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code: value.code }),
        signal: AbortSignal.timeout(8000),
      });
      const token = await response.json() as any;
      if (!response.ok || !token.access_token) return json(res, 401, { error: "Discord 인증 코드 교환에 실패했습니다." });
      return json(res, 200, { access_token: token.access_token });
    }
    if (req.method === "GET" && url.pathname === "/api/rooms") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      await identity(token, clientId);
      const guildId = url.searchParams.get("guildId") ?? "";
      await member(token, guildId);
      return json(res, 200, [...rooms.values()].filter(room => room.definition.guildId === guildId).map(room => room.definition));
    }
    if (req.method === "POST" && url.pathname === "/api/rematch") {
      // Activity 안에서 직접 재대결 — 같은 방(roomId)을 새 seed로 다시 만든다.
      // CPU전은 방장 한 명뿐이니 바로 재시작하고, PVP는 둘 다 동의해야 재시작된다.
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const user = await identity(token, clientId);
      const value = await body(req);
      if (typeof value.roomId !== "string") return json(res, 400, { error: "Invalid room" });
      const room = rooms.get(value.roomId);
      if (!room) return json(res, 404, { error: "방이 만료되었습니다. 디스코드 채팅의 [게임 시작] 버튼으로 새로 시작해주세요." });
      if (value.matchId !== room.matchId) return json(res, 409, { error: "경기가 변경되었습니다. 다시 연결해주세요." });
      if (!room.result || !room.delivered) return json(res, 409, { error: "경기 결과 전송을 기다려주세요." });
      const { hostId, p2Id, mode } = room.definition;
      if (user.id !== hostId && user.id !== p2Id) return json(res, 403, { error: "참가자만 재대결할 수 있습니다." });
      await member(token, room.definition.guildId);
      if (rooms.get(value.roomId) !== room) return json(res, 409, { error: "경기가 변경되었습니다." });
      if (mode === "PVP") {
        room.rematchVotes.add(user.id);
        if (!room.rematchVotes.has(hostId) || !p2Id || !room.rematchVotes.has(p2Id))
          return json(res, 202, { waiting: true, votes: room.rematchVotes.size });
      }
      // The bot serializes rematches with lobby edits, closure and expiry, and
      // creates the next game through the same internal handoff as a chat start.
      let pending = rematches.get(room.matchId);
      if (!pending) {
        pending = (async () => {
          if (!process.env.BOT_INTERNAL_URL) throw new Error("봇 연결 설정이 필요합니다.");
          const response = await fetch(new URL("/internal/game-rematches", process.env.BOT_INTERNAL_URL), {
            method: "POST", headers: { Authorization: "Bearer " + secret, "content-type": "application/json" },
            body: JSON.stringify({ roomId: value.roomId, matchId: room.matchId, hostId, p2Id }), signal: AbortSignal.timeout(10000),
          });
          const result = await response.json() as any;
          if (!response.ok) throw new Error(result.error ?? "봇 대기방 갱신에 실패했습니다. 다시 시도해주세요.");
          return result;
        })();
        rematches.set(room.matchId, pending);
      }
      try { return json(res, 200, await pending); }
      finally { if (rematches.get(room.matchId) === pending) rematches.delete(room.matchId); }
    }
    json(res, 404, { error: "Not found" });
  } catch (error) {
    // identity()/member()가 던지는 진짜 이유(토큰 만료, Discord API 실패 등)를 그대로 보여준다 —
    // 뭉뚱그린 문구로 덮어쓰면 뭐가 문제인지 클라이언트/로그 양쪽에서 알 수가 없다.
    console.error("[activity-server]", error);
    if (error instanceof DiscordRateLimitError && !res.headersSent) {
      res.setHeader("Retry-After", String(error.retryAfter));
      return json(res, 429, { error: error.message, retryAfter: error.retryAfter });
    }
    if (!res.headersSent) json(res, 400, { error: error instanceof Error ? error.message : "요청 처리 또는 Discord 인증에 실패했습니다." });
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8192 });
wss.on("connection", socket => {
  let room: RelayRoom | undefined;
  let peer: Peer | undefined;
  let authenticating = false;
  let alive = true;
  const send = (message: unknown) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 32 * 1024 * 1024) { socket.close(1008, "Slow connection"); return; }
    socket.send(JSON.stringify(message));
  };
  const timeout = setTimeout(() => { if (!peer) socket.close(1008, "Authentication timeout"); }, 15000);
  const heartbeat = setInterval(() => {
    if (!alive) { socket.terminate(); return; }
    alive = false; socket.ping();
  }, 15000);
  socket.on("pong", () => { alive = true; });
  socket.on("error", () => socket.terminate());
  socket.on("message", async raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (!peer) {
        if (authenticating || message.type !== "AUTH") return;
        authenticating = true;
        const target = rooms.get(message.roomId);
        if (!target) {
          send({ type: "ROOM_CLOSED", message: "방이 닫혔거나 만료되었습니다. 채팅에서 새 방을 만들어주세요." });
          socket.close(1000); return;
        }
        // 둘 다 target.definition.guildId 등 서로 다른 결과를 안 쓰는 독립 호출이라 병렬로 돌린다.
        const [user, guildMember] = await Promise.all([
          identity(message.token, clientId),
          member(message.token, target.definition.guildId),
        ]);
        if (socket.readyState !== WebSocket.OPEN) return;
        if (rooms.get(message.roomId) !== target) { send({ type: "MATCH_REPLACED" }); socket.close(1000); return; }
        room = target;
        const candidate: Peer = { id: user.id, name: guildMember.nick || user.name, send };
        room.join(candidate); peer = candidate; clearTimeout(timeout);
        return;
      }
      if (message.type === "INPUT") room!.input(peer, message);
      else if (message.type === "RESULT") room!.report(peer, message);
    } catch (error) {
      send({ type: "ERROR", message: error instanceof Error ? error.message : "요청 실패", terminal: !(error instanceof DiscordRateLimitError), retryAfter: error instanceof DiscordRateLimitError ? error.retryAfter : undefined });
      socket.close(1008, "Invalid request");
    }
  });
  socket.on("close", () => {
    clearTimeout(timeout); clearInterval(heartbeat);
    if (peer) room?.leave(peer);
  });
});
// 봇 쪽 대기 알람도 결과 처리 시점부터 300초를 다시 잰다(최대 5초 지연 뒤 도착) — 이 값을 그보다
// 넉넉히 길게 잡아야 "채팅엔 [게임 시작]이 아직 떠 있는데 Activity 재경기는 이미 방이 없다"는
// 어긋남이 안 생긴다.
const REMATCH_GRACE_MS = 6 * 60_000;
const callbacks = setInterval(() => {
  for (const [roomId, room] of rooms) {
    // 실제로 활동(입력 커밋)이 없어야만 정리한다 — 계속 활발히 플레이 중이면 아무리 오래돼도 끊지 않는다.
    if (!room.result && Date.now() - room.lastActivity > 5 * 60_000) room.abort("대기 또는 경기 제한 시간이 지났습니다.");
    // 끝난 지 한참 지났는데 재대결도 안 됐으면(=아직 이 roomId의 새 RelayRoom으로 교체되지 않았으면) 그제서야 지운다.
    if (room.result && room.finishedAt && Date.now() - room.finishedAt > REMATCH_GRACE_MS) { room.broadcast({ type: "ROOM_CLOSED", message: "재경기 대기 시간이 만료되었습니다." }); rooms.delete(roomId); continue; }
    room.connectionStatus();
    if (!room.result || room.delivered || room.delivering || !process.env.BOT_INTERNAL_URL) continue;
    room.broadcast({ type: "RESULT_PENDING", result: room.result, message: "경기 결과 저장 중..." });
    room.delivering = true;
    void fetch(new URL("/internal/game-results", process.env.BOT_INTERNAL_URL), {
      method: "POST", headers: { Authorization: "Bearer " + secret, "content-type": "application/json" },
      body: JSON.stringify(room.result), signal: AbortSignal.timeout(5000),
    }).then(response => {
      if (!response.ok) return;
      room.delivered = true;
      room.broadcast({ type: "FINISHED", result: room.result });
    }).catch(() => {}).finally(() => { room.delivering = false; });
  }
}, 5000);
server.listen(Number(process.env.PORT ?? 3001), "0.0.0.0", () => console.log("[activity-server] ready"));
export function shutdown() {
  clearInterval(callbacks);
  for (const client of wss.clients) client.terminate();
  wss.close(); server.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
