import { createHash } from "node:crypto";
const API = "https://discord.com/api/v10";
const TTL = 60_000;
const LIMIT = 2000;
const cache = new Map<string, { expires: number; value: any }>();
const pending = new Map<string, Promise<any>>();
const cooldowns = new Map<string, number>();
let globalUntil = 0;
export class DiscordRateLimitError extends Error {
  constructor(readonly retryAfter: number) {
    super(`Discord 요청이 많아 잠시 대기해야 합니다. ${retryAfter}초 후 다시 시도해주세요.`);
  }
}
function trim(map: Map<string, unknown>) {
  if (map.size >= LIMIT) map.delete(map.keys().next().value!);
}
export async function discord(path: string, token: string) {
  const key = createHash("sha256").update(token).digest("hex") + path;
  const now = Date.now();
  for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
  for (const [id, until] of cooldowns) if (until <= now) cooldowns.delete(id);
  const cached = cache.get(key);
  if (cached) return cached.value;
  const wait = Math.max(globalUntil, cooldowns.get(key) ?? 0) - now;
  if (wait > 0) throw new DiscordRateLimitError(Math.ceil(wait / 1000));
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const response = await fetch(API + path, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(8000) });
    if (response.status === 429) {
      const body = await response.json().catch(() => ({})) as any;
      const seconds = Number(body.retry_after ?? response.headers.get("retry-after") ?? 5);
      const retryAfter = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 5;
      const until = Date.now() + retryAfter * 1000;
      trim(cooldowns); cooldowns.set(key, until);
      if (body.global === true) globalUntil = Math.max(globalUntil, until);
      throw new DiscordRateLimitError(retryAfter);
    }
    if (!response.ok) throw new Error(`Discord 인증 또는 서버 멤버 확인에 실패했습니다. (${path} → ${response.status})`);
    const value = await response.json();
    // Never retain authorization beyond its OAuth expiry.
    const expiry = path === "/oauth2/@me" ? Date.parse((value as any).expires) : NaN;
    trim(cache); cache.set(key, { expires: Math.min(Date.now() + TTL, Number.isFinite(expiry) ? expiry : Infinity), value });
    return value;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
export async function identity(token: string, clientId: string) {
  if (typeof token !== "string" || !token || token.length > 2048 || !clientId) throw new Error("인증 토큰이 필요합니다.");
  const [authorization, user] = await Promise.all([discord("/oauth2/@me", token), discord("/users/@me", token)]);
  if (authorization.application?.id !== clientId) throw new Error("다른 앱의 인증 토큰입니다.");
  const avatar = typeof user.avatar === "string" && /^[a-zA-Z0-9_]+$/.test(user.avatar) ? user.avatar : null;
  const defaultAvatar = user.discriminator && user.discriminator !== "0" ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
  return { id: String(user.id), name: String(user.global_name ?? user.username),
    avatarUrl: avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${avatar}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${defaultAvatar}.png` };
}
export async function member(token: string, guildId: string) {
  if (!/^\d{1,22}$/.test(guildId)) throw new Error("잘못된 서버 ID입니다.");
  return discord("/users/@me/guilds/" + guildId + "/member", token);
}
