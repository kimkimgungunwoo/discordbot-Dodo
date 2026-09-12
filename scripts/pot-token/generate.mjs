// Lavalink youtube-plugin의 PoToken(pot.token / pot.visitorData)을 재생성한다.
// "Sign in to confirm you're not a bot" 벽 — 특히 클라우드/데이터센터 IP(Lightsail 등)에서 자주 걸림 —
// 을 WEB/WEBEMBEDDED 클라이언트에서 우회하는 공식 수단. 토큰은 ~12시간(43200초) 뒤 만료돼서
// .github/workflows/refresh-pot-token.yml 이 주기적으로 이 스크립트를 돌려 갱신한다.
//
// identifier는 "content binding" 키일 뿐 — 실제 재생되는 영상과는 무관하다. 항상 존재할 만한
// 안정적인 영상 ID(Rick Astley - Never Gonna Give You Up)를 고정으로 쓴다.
//
// 참고: youtubei.js로 실제 visitorData를 받아오는 "정석" 경로는 지금 bgutils-js@3.2.0과
// 버전이 안 맞아서 "Content binding is too long" 에러로 깨짐(2026-09 확인) — 그래서 영상 ID를
// identifier로 쓰는 방식으로 우회한다. 두 라이브러리가 호환되게 업데이트되면 그쪽으로 바꿔도 된다.

import { BG } from "bgutils-js";
import { JSDOM } from "jsdom";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const IDENTIFIER = process.env.POT_IDENTIFIER || "dQw4w9WgXcQ";

const dom = new JSDOM();
Object.assign(globalThis, { window: dom.window, document: dom.window.document });

const bgConfig = {
  fetch: (input, init) => fetch(input, init),
  globalObj: globalThis,
  identifier: IDENTIFIER,
  requestKey: REQUEST_KEY,
};

const bgChallenge = await BG.Challenge.create(bgConfig);
if (!bgChallenge) throw new Error("Could not get BotGuard challenge");

const interpreterJavascript =
  bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
if (!interpreterJavascript) throw new Error("Could not load BotGuard VM");
new Function(interpreterJavascript)();

const poTokenResult = await BG.PoToken.generate({
  program: bgChallenge.program,
  globalName: bgChallenge.globalName,
  bgConfig,
});

// GitHub Actions에서 파싱하기 쉽게 KEY=VALUE 줄로 출력 (dotenv/.env 형식과도 동일)
console.log(`POT_TOKEN=${poTokenResult.poToken}`);
console.log(`POT_VISITOR_DATA=${IDENTIFIER}`);
