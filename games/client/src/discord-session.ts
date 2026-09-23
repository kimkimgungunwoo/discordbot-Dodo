const GAME_PATHS = { volleyball: "/volleyball", omok: "/omok" } as const;
const ROOM_KEY = "dodo:room";
const TOKEN_KEY = "dodo:token";

export async function authenticate(root: HTMLElement, game: "volleyball" | "omok") {
  const roomKey = game === "volleyball" ? ROOM_KEY : "dodo:omok:room";
  const path = GAME_PATHS[game];
  const redirectUri = location.origin + path;
  const params = new URLSearchParams(location.search);
  const roomId = params.get("room") ?? sessionStorage.getItem(roomKey) ?? "";
  if (roomId) sessionStorage.setItem(roomKey, roomId);
  if (!roomId) throw new Error("채팅에 표시된 링크로 다시 들어와주세요.");

  let token = sessionStorage.getItem(TOKEN_KEY);
  const code = params.get("code");
  if (code) {
    const expected = sessionStorage.getItem("dodo:oauth:state");
    if (!expected || expected !== params.get("state")) throw new Error("로그인 요청이 만료되었습니다. 채팅의 게임 링크로 다시 접속해주세요.");
    const response = await fetch("/api/oauth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    });
    const body = await response.json();
    if (!response.ok || !body.access_token) throw new Error(body.error ?? "Discord 인증 실패");
    token = String(body.access_token);
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem("dodo:oauth:state");
    history.replaceState(null, "", path + "?room=" + encodeURIComponent(roomId));
  }

  if (!token) {
    const config = await fetch("/api/config").then(response => response.json());
    if (!config.clientId) throw new Error("서버의 DISCORD_CLIENT_ID 설정이 필요합니다.");
    root.style.cssText = "min-height:100vh;display:flex;align-items:center;justify-content:center;";
    const panel = document.createElement("section");
    panel.className = "start-card";
    const title = document.createElement("h2"); title.textContent = game === "omok" ? "도도새오목" : "도도새배구";
    const button = document.createElement("button");
    button.className = "primary"; button.textContent = "Discord로 로그인";
    panel.append(title, button); root.replaceChildren(panel);
    return new Promise<{roomId: string; token: string}>(() => {
      button.onclick = () => {
        const state = crypto.randomUUID();
        sessionStorage.setItem("dodo:oauth:state", state);
        const authorize = new URL("https://discord.com/oauth2/authorize");
        authorize.search = new URLSearchParams({
          client_id: config.clientId, redirect_uri: redirectUri,
          response_type: "code", scope: "identify guilds.members.read", state,
        }).toString();
        location.href = authorize.toString();
      };
    });
  }

  root.style.cssText = "";
  return { roomId, token };
}
