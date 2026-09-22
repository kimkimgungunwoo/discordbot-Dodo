import { OnlineSession } from "./online-session";
import type { GameSession } from "./session";

const REDIRECT_URI = location.origin + "/";
const ROOM_KEY = "dodo:room";
const TOKEN_KEY = "dodo:token";

export async function connectActivity(root: HTMLElement): Promise<GameSession> {
  const params = new URLSearchParams(location.search);
  const roomId = params.get("room") ?? sessionStorage.getItem(ROOM_KEY) ?? "";
  if (roomId) sessionStorage.setItem(ROOM_KEY, roomId);
  if (!roomId) throw new Error("채팅에 표시된 링크로 다시 들어와주세요.");

  let token = sessionStorage.getItem(TOKEN_KEY);
  const code = params.get("code");
  if (code && !token) {
    const response = await fetch("/api/oauth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
    });
    const body = await response.json();
    if (!response.ok || !body.access_token) throw new Error(body.error ?? "Discord 인증 실패");
    token = String(body.access_token);
    sessionStorage.setItem(TOKEN_KEY, token);
    history.replaceState(null, "", "/?room=" + encodeURIComponent(roomId));
  }

  if (!token) {
    const config = await fetch("/api/config").then(response => response.json());
    if (!config.clientId) throw new Error("서버의 DISCORD_CLIENT_ID 설정이 필요합니다.");
    root.style.cssText = "min-height:100vh;display:flex;align-items:center;justify-content:center;";
    const panel = document.createElement("section");
    panel.className = "start-card";
    const title = document.createElement("h2"); title.textContent = "도도새배구";
    const button = document.createElement("button");
    button.className = "primary"; button.textContent = "Discord로 로그인";
    panel.append(title, button); root.replaceChildren(panel);
    return new Promise(() => {
      button.onclick = () => {
        const authorize = new URL("https://discord.com/oauth2/authorize");
        authorize.search = new URLSearchParams({
          client_id: config.clientId, redirect_uri: REDIRECT_URI,
          response_type: "code", scope: "identify guilds.members.read",
        }).toString();
        location.href = authorize.toString();
      };
    });
  }

  return new OnlineSession(roomId, token);
}
