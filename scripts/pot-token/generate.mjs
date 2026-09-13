import { Innertube, UniversalCache } from "youtubei.js";
import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { buildURL, getHeaders } from "bgutils-js/utils";
import { JSDOM } from "jsdom";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";

const dom = new JSDOM();
Object.assign(globalThis, { window: dom.window, document: dom.window.document });

const innertube = await Innertube.create({ cache: new UniversalCache(false), generate_session_locally: true });
const visitorData = innertube.session.context.client.visitorData;
if (!visitorData) throw new Error("Could not obtain visitorData from Innertube session");

const challenge = await getChallenge({ requestKey: REQUEST_KEY, fetchFunction: fetch });
if (!challenge) throw new Error("Could not get BotGuard challenge");

let interpreterJavascript = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
if (!interpreterJavascript) {
  const interpreterUrl = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (!interpreterUrl) throw new Error("Could not load BotGuard VM (no inline script and no interpreterUrl)");
  interpreterJavascript = await (await fetch(`https://www.google.com${interpreterUrl}`)).text();
}
new Function(interpreterJavascript)();

const bgClient = await BotGuardClient.create({
  program: challenge.program,
  globalName: challenge.globalName,
  globalObject: globalThis,
});
const webPoSignalOutput = [];
const botguardResponse = await bgClient.snapshot({ webPoSignalOutput });

const itResp = await fetch(buildURL("GenerateIT"), {
  method: "POST",
  headers: getHeaders(),
  body: JSON.stringify([REQUEST_KEY, botguardResponse]),
});
if (!itResp.ok) throw new Error(`GenerateIT failed: ${itResp.status} ${await itResp.text()}`);
const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await itResp.json();

const minter = await WebPoMinter.create(
  { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken },
  webPoSignalOutput,
);
const poToken = await minter.mintAsWebsafeString(visitorData);

console.log(`POT_TOKEN=${poToken}`);
console.log(`POT_VISITOR_DATA=${visitorData}`);
