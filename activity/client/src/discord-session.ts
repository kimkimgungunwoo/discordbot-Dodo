import { DIFFICULTY_LABELS, parseDifficulty } from "./game/ai";
import { OnlineSession } from "./online-session";
import type { GameSession } from "./session";

export async function connectActivity(root: HTMLElement): Promise<GameSession> {
  const config = await fetch("/api/config").then(response => response.json());
  if (!config.clientId) throw new Error("서버의 DISCORD_CLIENT_ID 설정이 필요합니다.");
  const { DiscordSDK } = await import("@discord/embedded-app-sdk");
  const sdk = new DiscordSDK(config.clientId);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: config.clientId, response_type: "code", state: crypto.randomUUID(),
    scope: ["identify", "guilds.members.read"],
  });
  const response = await fetch("/api/oauth/token", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
  });
  const token = await response.json();
  if (!response.ok) throw new Error(token.error ?? "Discord 인증 실패");
  const auth = await sdk.commands.authenticate({ access_token: token.access_token });
  if (!auth || !sdk.guildId) throw new Error("Discord 서버 안에서 Activity를 열어주세요.");

  const panel = document.createElement("section");
  panel.className = "start-card";
  panel.style.margin = "32px auto";
  const title = document.createElement("h2"); title.textContent = "경기 선택";
  const select = document.createElement("select"); select.setAttribute("aria-label", "경기 방");
  select.style.cssText = "width:100%;padding:10px;margin-bottom:12px";
  const refresh = document.createElement("button"); refresh.className = "quiet"; refresh.textContent = "새로고침";
  const join = document.createElement("button"); join.className = "primary"; join.textContent = "입장";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  panel.append(title, select, join, refresh, status); root.replaceChildren(panel);
  const load = async () => {
    join.disabled = true;
    try {
      const response = await fetch("/api/rooms?guildId=" + encodeURIComponent(sdk.guildId!), { headers: { Authorization: "Bearer " + auth.access_token } });
      const rooms = await response.json();
      if (!response.ok) throw new Error(rooms.error);
      select.replaceChildren();
      for (const room of rooms) {
        const option = document.createElement("option");
        option.value = room.roomId;
        option.textContent = (room.hostId === auth.user.id || room.p2Id === auth.user.id ? "[참가] " : "[관전] ") + room.roomId + " · " + (room.mode === "CPU" ? `봇전 · ${DIFFICULTY_LABELS[parseDifficulty(room.difficulty)]}` : "대결");
        select.append(option);
      }
      status.textContent = rooms.length ? "채팅에 표시된 방 ID를 선택하세요." : "방장이 채팅에서 게임 시작을 눌러주세요.";
      join.disabled = !rooms.length;
    } catch { status.textContent = "방 목록을 가져오지 못했습니다. 다시 시도해주세요."; }
  };
  refresh.onclick = () => { void load(); };
  await load();
  return new Promise(resolve => {
    join.onclick = () => {
      if (select.value) { join.disabled = true; resolve(new OnlineSession(select.value, auth.access_token)); }
    };
  });
}
