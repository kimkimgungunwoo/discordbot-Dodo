import { test } from "node:test";
import assert from "node:assert/strict";
import { discord, identity, DiscordRateLimitError } from "../src/auth.js";

test("auth cache merges requests, isolates tokens, expires and honors rate limits", async () => {
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  let now = originalNow(), calls = 0;
  Date.now = () => now;
  let limited = false;
  globalThis.fetch = async () => {
    calls++;
    return limited ? Response.json({ retry_after: 10 }, { status: 429 }) : Response.json({ id: "1" });
  };
  try {
    await Promise.all([discord("/test", "token-a"), discord("/test", "token-a")]);
    await discord("/test", "token-a");
    assert.equal(calls, 1);
    await discord("/test", "token-b");
    assert.equal(calls, 2);
    now += 60_001;
    limited = true;
    await assert.rejects(discord("/test", "token-a"), DiscordRateLimitError);
    await assert.rejects(discord("/test", "token-a"), DiscordRateLimitError);
    assert.equal(calls, 3);
    now += 10_001;
    limited = false;
    await discord("/test", "token-a");
    assert.equal(calls, 4);
    globalThis.fetch = async () => Response.json({ application: { id: "wrong-app" }, id: "1" });
    await assert.rejects(identity("other-token", "expected-app"), /다른 앱/);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

test("authenticated identities include Discord avatars and default avatars", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const avatar of ["avatar_hash", null]) {
      globalThis.fetch = async url => Response.json(String(url).endsWith("/oauth2/@me")
        ? { application: { id: "app" } }
        : { id: "4194304", global_name: "도도새", avatar, discriminator: "0" });
      const user = await identity("avatar-test-" + avatar, "app");
      assert.equal(user.name, "도도새");
      assert.equal(user.avatarUrl, avatar ? "https://cdn.discordapp.com/avatars/4194304/avatar_hash.png?size=64" : "https://cdn.discordapp.com/embed/avatars/1.png");
    }
  } finally { globalThis.fetch = originalFetch; }
});
