import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const directory = mkdtempSync(join(tmpdir(), "dodo-online-"));
mkdirSync(join(directory, "volleyball"));
for (const name of ["volleyball/constants", "volleyball/types", "volleyball/physics", "volleyball/ai", "volleyball/online-session", "volleyball/presentation"]) {
  const source = readFileSync(new URL("../src/" + name + ".ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  writeFileSync(join(directory, name + ".js"), output.outputText);
}
const require = createRequire(import.meta.url);
const { OnlineSession } = require(join(directory, "volleyball/online-session.js"));
const { createInitialState, step, EMPTY_INPUT } = require(join(directory, "volleyball/physics.js"));
const { computeAiInput } = require(join(directory, "volleyball/ai.js"));
after(() => rmSync(directory, { recursive: true, force: true }));
globalThis.location = new URL("https://activity.example/");
class Socket {
  static OPEN = 1;
  static instances = [];
  readyState = 1;
  sent = [];
  constructor() { Socket.instances.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
}
globalThis.WebSocket = Socket;
function connect(role, mode = "PVP", committedTick = 0) {
  const session = new OnlineSession("room", "verified-token");
  const socket = Socket.instances.at(-1);
  socket.onopen();
  socket.receive({ type: "GAME_START", seed: 42, role, userId: role === "left" ? "1" : "2", seq: 0, committedTick,
    room: { hostId: "1", p2Id: mode === "CPU" ? null : "2", mode } });
  return { session, socket };
}
function ready(socket, committedTick = 0) {
  socket.receive({ type: "CAUGHT_UP" });
  socket.receive({ type: "PRESENCE", ready: true, committedTick, players: [] });
}

test("two players and a late spectator reproduce identical PVP states", () => {
  const host = connect("left"), guest = connect("right");
  ready(host.socket); ready(guest.socket);
  let expected = createInitialState(42);
  const history = [];
  for (let tick = 1; tick <= 2000 && expected.phase !== "gameover"; tick++) {
    const frame = { tick, left: { ...EMPTY_INPUT, x: tick % 3 - 1, hit: tick % 11 === 0 }, right: { ...EMPTY_INPUT, jump: tick % 30 === 0 } };
    history.push(frame); expected = step(expected, frame.left, frame.right);
    for (const player of [host, guest]) { player.socket.receive({ type: "FRAME", frame }); player.session.advance(EMPTY_INPUT); }
  }
  const spectator = connect("spectator", "PVP", history.length);
  spectator.socket.receive({ type: "HISTORY", frames: history }); ready(spectator.socket, history.length);
  for (let index = 0; index < 4; index++) spectator.session.advance(EMPTY_INPUT);
  assert.deepEqual(host.session.state, expected);
  assert.deepEqual(guest.session.state, expected);
  assert.deepEqual(spectator.session.state, expected);
  assert.equal(spectator.socket.sent.some(message => message.type === "INPUT"), false);
  assert.deepEqual(spectator.session.consumeEvents(), []);
});

test("missing frames stall physics and reconnection resubmits uncommitted inputs", () => {
  const player = connect("right"); ready(player.socket);
  player.session.advance(EMPTY_INPUT);
  // 확정 프레임은 아직 하나도 안 왔지만, 내 입력은 즉시 반영(예측)돼서 6틱만큼 앞서가 있어야 한다.
  assert.equal(player.session.state.tick, 6);
  assert.equal(player.socket.sent.filter(message => message.type === "INPUT").length, 6);
  player.socket.receive({ type: "PRESENCE", ready: false, committedTick: 0, players: [] });
  ready(player.socket);
  player.session.advance(EMPTY_INPUT);
  assert.equal(player.socket.sent.filter(message => message.type === "INPUT").length, 12);
  assert.equal(player.session.requestStart("1"), false);
});

test("requestStart accepts host or p2 once finished, but not a bystander", () => {
  globalThis.fetch = () => new Promise(() => {});
  const guest = connect("right"); ready(guest.socket);
  guest.session.completed = true;
  assert.equal(guest.session.requestStart("3"), false);
  assert.equal(guest.session.requestStart("2"), true);
  guest.session.rematching = false;
  assert.equal(guest.session.requestStart("1"), true);
  delete globalThis.fetch;
});

test("CPU history replays deterministic AI and FINISHED does not truncate spectator playback", () => {
  let expected = createInitialState(42);
  const frames = [];
  while (expected.phase !== "gameover" && frames.length < 20000) {
    const tick = expected.tick + 1;
    frames.push({ tick, left: EMPTY_INPUT, right: null });
    expected = step(expected, EMPTY_INPUT, computeAiInput(expected, expected.right));
  }
  assert.equal(expected.phase, "gameover");
  const spectator = connect("spectator", "CPU", frames.length);
  spectator.socket.receive({ type: "HISTORY", frames }); ready(spectator.socket, frames.length);
  spectator.socket.receive({ type: "FINISHED" });
  for (let index = 0; index < Math.ceil(frames.length / 240); index++) spectator.session.advance(EMPTY_INPUT);
  assert.deepEqual(spectator.session.state, expected);
  assert.equal(spectator.socket.sent.some(message => message.type === "RESULT"), false);
});


test("CPU history replay uses the selected difficulty for players and spectators", () => {
  for (const difficulty of ["easy", "normal", "hard", "extreme"]) {
    let expected = createInitialState(42);
    const frames = [];
    for (let tick = 1; tick <= 360; tick++) {
      frames.push({ tick, left: EMPTY_INPUT, right: null });
      expected = step(expected, EMPTY_INPUT, computeAiInput(expected, expected.right, difficulty));
    }
    for (const role of ["left", "spectator"]) {
      const session = new OnlineSession("room", "verified-token");
      const socket = Socket.instances.at(-1);
      socket.receive({ type: "GAME_START", seed: 42, role, userId: "1", seq: 0, committedTick: 360,
        room: { hostId: "1", p2Id: null, mode: "CPU", difficulty } });
      socket.receive({ type: "HISTORY", frames });
      socket.receive({ type: "CAUGHT_UP" });
      session.advance(EMPTY_INPUT); session.advance(EMPTY_INPUT);
      assert.deepEqual(session.state, expected, difficulty + ": " + role);
      assert.match(session.info.players.right.displayName, /도도봇 · /);
    }
  }
});

test("rematch keeps the live socket until the outcome is known, then swaps and ignores stale events", async () => {
  const originalFetch = globalThis.fetch;
  let resolve;
  globalThis.fetch = () => new Promise(done => { resolve = done; });
  const player = connect("left", "CPU"); ready(player.socket);
  player.session.completed = true;
  try {
    assert.equal(player.session.requestStart("1"), true);
    // 200/202 응답을 알기 전엔 기존 소켓을 끊지 않는다 — PVP 투표 대기 중 상대가 투표하면
    // 오는 MATCH_REPLACED를 이 소켓으로 그대로 받아야 하기 때문.
    assert.equal(player.socket.readyState, 1);
    assert.equal(player.session.message, "재대결을 시작하는 중");
    assert.equal(player.session.reconnectTimer, null);
    resolve({ ok: true, status: 200 });
    await new Promise(done => setImmediate(done));
    const next = Socket.instances.at(-1);
    assert.notEqual(next, player.socket);
    assert.equal(player.socket.readyState, 3); // connect()가 그제서야 옛 소켓을 닫음
    // 이미 교체된 옛 소켓에 뒤늦게 도착한 이벤트는 여전히 무시된다.
    player.socket.receive({ type: "ERROR", terminal: true, message: "stale error" });
    assert.notEqual(player.session.message, "stale error");
    next.receive({ type: "GAME_START", seed: 1, role: "left", userId: "1", seq: 0, committedTick: 0,
      room: { hostId: "1", p2Id: null, mode: "CPU", difficulty: "hard" } });
    ready(next); player.session.advance(EMPTY_INPUT);
    assert.equal(next.sent.filter(message => message.type === "INPUT").length, 6);
    assert.equal(player.session.rematching, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("PVP rematch vote-pending (202) keeps the socket live to catch MATCH_REPLACED", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 202 });
  const player = connect("left", "PVP"); ready(player.socket);
  player.session.completed = true;
  try {
    assert.equal(player.session.requestStart("1"), true);
    await new Promise(done => setImmediate(done));
    assert.equal(player.session.message, "재대결 투표함 · 상대방 응답을 기다리는 중");
    assert.equal(player.session.rematching, false);
    // 202 응답 후에도 소켓은 살아있어야 상대 투표 완료 시 MATCH_REPLACED를 즉시 받는다.
    assert.equal(player.socket.readyState, 1);
    clearTimeout(player.session.reconnectTimer); player.session.reconnectTimer = null;
    player.socket.receive({ type: "MATCH_REPLACED" });
    const next = Socket.instances.at(-1);
    assert.notEqual(next, player.socket);
  } finally { globalThis.fetch = originalFetch; }
});

test("rate-limited rematches preserve the error and block retries until cooldown", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 429, ok: false, json: async () => ({ error: "10초 후 다시 시도해주세요", retryAfter: 10 }) });
  const player = connect("left", "CPU"); ready(player.socket);
  player.session.completed = true;
  try {
    player.session.requestStart("1");
    await new Promise(done => setImmediate(done));
    assert.equal(player.session.message, "10초 후 다시 시도해주세요");
    assert.equal(player.session.requestStart("1"), false);
    clearTimeout(player.session.reconnectTimer); player.session.reconnectTimer = null;
    player.session.connect();
    const socket = Socket.instances.at(-1);
    socket.receive({ type: "ERROR", terminal: true, message: "종료된 방" });
    assert.equal(player.session.message, "10초 후 다시 시도해주세요");
  } finally { clearTimeout(player.session.reconnectTimer); globalThis.fetch = originalFetch; }
});

test("finished spectators stay connected, follow a rematch, and stop on room closure", () => {
  const spectator = connect("spectator", "CPU"); ready(spectator.socket);
  spectator.socket.receive({ type: "FINISHED", result: { score: { left: 5, right: 2 } } });
  assert.equal(spectator.socket.readyState, 1);
  assert.equal(spectator.session.reconnectTimer, null);
  spectator.socket.receive({ type: "MATCH_REPLACED" });
  const next = Socket.instances.at(-1);
  assert.notEqual(next, spectator.socket);
  next.receive({ type: "GAME_START", matchId: "new-match", seed: 1, role: "spectator", userId: "3", seq: 0, committedTick: 0,
    room: { hostId: "1", p2Id: null, mode: "CPU" } });
  assert.equal(spectator.session.completed, false);
  next.receive({ type: "ROOM_CLOSED", message: "방이 만료되었습니다." });
  assert.equal(spectator.session.stopped, true);
  assert.equal(spectator.session.canRematch, false);
  assert.equal(spectator.session.reconnectTimer, null);
  assert.equal(spectator.session.message, "방이 만료되었습니다.");
});

test("aborted game and stalled input are visible without waiting for gameover physics", () => {
  const player = connect("left", "PVP"); ready(player.socket);
  player.socket.receive({ type: "CONNECTION_STATUS", waitingFor: ["2"], remainingSeconds: 240 });
  assert.match(player.session.message, /2P.*240초/);
  player.socket.receive({ type: "RESULT_PENDING", result: { aborted: true }, message: "연결 시간 초과 · 결과 전송 중" });
  assert.equal(player.session.state.phase, "gameover");
  assert.equal(player.session.state.winner, null);
  assert.equal(player.session.canRematch, false);
  player.socket.receive({ type: "FINISHED", result: { aborted: true, reason: "연결 시간 초과" } });
  assert.equal(player.session.canRematch, true);
  assert.equal(player.session.message, "연결 시간 초과");
});

test("spectators receive live sounds and profile updates without sending player input", () => {
  const { session, socket } = connect("spectator", "CPU");
  ready(socket);
  const spectators = [{ id: "3", displayName: "관전자", avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png" }];
  socket.receive({ type: "PRESENCE", ready: true, committedTick: 0, players: [], spectators });
  assert.deepEqual(session.info.spectators, spectators);
  let state = createInitialState(42), events = [];
  for (let tick = 1; tick <= 600; tick++) {
    const frame = { tick, left: { ...EMPTY_INPUT, jump: tick % 40 === 0 }, right: null };
    state = step(state, frame.left, computeAiInput(state, state.right));
    events.push(...state.events);
    socket.receive({ type: "FRAME", frame }); session.advance(EMPTY_INPUT);
  }
  assert.ok(events.length > 0);
  assert.deepEqual(session.consumeEvents(), events);
  assert.equal(socket.sent.some(m => m.type === "INPUT" || m.type === "RESULT"), false);
  socket.receive({ type: "PRESENCE", ready: true, committedTick: 600, players: [], spectators: [] });
  assert.deepEqual(session.info.spectators, []);
});


test("early opponent inputs apply at their tick without rewriting earlier predictions", () => {
  const { session, socket } = connect("left"); ready(socket);
  session.confirmed = createInitialState(42); session.confirmed.phase = "playing";
  const initial = session.confirmed;
  socket.receive({ type: "INPUT", side: "right", tick: 4, input: { ...EMPTY_INPUT, x: -1 } });
  session.advance(EMPTY_INPUT);
  let expected = initial;
  for (let tick = 1; tick <= 6; tick++) expected = step(expected, EMPTY_INPUT, { ...EMPTY_INPUT, x: tick >= 4 ? -1 : 0 });
  assert.deepEqual(session.state, expected);
  assert.deepEqual(session.confirmed, initial);
  socket.receive({ type: "INPUT", side: "right", tick: 7, matchId: "stale", input: { ...EMPTY_INPUT, x: 1 } });
  socket.receive({ type: "INPUT", side: "right", tick: 100, input: { ...EMPTY_INPUT, x: 1 } });
  assert.equal(session.opponentInputs.size, 1);
  for (let tick = 1; tick <= 6; tick++) {
    socket.receive({ type: "FRAME", frame: { tick, left: EMPTY_INPUT, right: { ...EMPTY_INPUT, x: tick >= 4 ? -1 : 0 } } });
    session.advance(EMPTY_INPUT);
  }
  assert.deepEqual(session.confirmed, expected);
  assert.equal(session.opponentInputs.size, 0);
});

const { Presentation } = require(join(directory, "volleyball/presentation.js"));
test("display correction settles smoothly without changing collision coordinates", () => {
  const display = new Presentation();
  const initial = createInitialState(0); initial.phase = "playing";
  display.update(initial, 1); display.sample(1, 16, "right");
  const corrected = structuredClone(initial); corrected.tick++; corrected.right.x -= 40; corrected.left.x += 6.4;
  display.update(corrected, 1);
  const first = display.sample(1, 16, "right");
  assert.equal(first.left.x, corrected.left.x);
  assert.ok(first.right.x > corrected.right.x && first.right.x < initial.right.x);
  for (let frame = 0; frame < 6; frame++) display.sample(1, 16, "right");
  const settled = display.sample(1, 16, "right");
  assert.ok(Math.abs(settled.right.x - corrected.right.x) < 1);
  assert.equal(corrected.right.x, 680);
  const point = { ...corrected, phase: "point" };
  display.update(point, 1);
  assert.equal(display.sample(0, 16, "right").right.x, 680);
  display.update(initial, 2);
  assert.equal(display.sample(0, 16, "right").right.x, 720);
});

test("ball rendering snaps on reflection and interpolates free flight", () => {
  const display = new Presentation();
  const initial = createInitialState(0); initial.phase = "playing"; initial.ball.xVelocity = 10;
  display.update(initial, 1);
  const next = structuredClone(initial); next.tick++; next.ball.x += 9;
  display.update(next, 1);
  assert.equal(display.sample(0.5, 16, null).ball.x, initial.ball.x + 4.5);
  const bounce = structuredClone(next); bounce.tick++; bounce.ball.xVelocity = -10; bounce.ball.x -= 9;
  display.update(bounce, 1);
  assert.equal(display.sample(0.5, 16, null).ball.x, bounce.ball.x);
});

test("50/100/200ms delayed and batched relay preserves convergence and improves prediction", () => {
  for (const rtt of [50, 100, 200]) {
    const improved = connect("left"), baseline = connect("left");
    ready(improved.socket); ready(baseline.socket);
    let truth = createInitialState(42); truth.phase = "playing";
    // Keep the ball away while exercising reversals and jumps.
    truth.ball = { ...truth.ball, x: 480, y: -350 };
    improved.session.confirmed = structuredClone(truth);
    baseline.session.confirmed = structuredClone(truth);
    const states = [truth], messages = [];
    const latency = Math.round(rtt / (1000 / 60));
    for (let tick = 1; tick <= 180; tick++) {
      const input = { ...EMPTY_INPUT, x: Math.floor(tick / 10) % 2 ? -1 : 1, jump: tick % 23 === 0 };
      truth = step(truth, EMPTY_INPUT, input); states.push(truth);
      messages.push({ at: tick + Math.ceil(latency / 2), body: { type: "INPUT", side: "right", tick, input } });
      messages.push({ at: tick + latency, body: { type: "FRAME", frame: { tick, left: EMPTY_INPUT, right: input } } });
    }
    messages.sort((a, b) => a.at - b.at);
    // Batch delivery every third tick to reproduce transport/browser jitter.
    let error = 0, oldError = 0;
    for (let clock = 1; clock <= 220; clock++) {
      if (clock % 3 === 0) while (messages.length && messages[0].at <= clock) {
        const { body } = messages.shift();
        improved.socket.receive(body);
        if (body.type === "FRAME") baseline.socket.receive(body);
      }
      improved.session.advance(EMPTY_INPUT); baseline.session.advance(EMPTY_INPUT);
      for (const player of [improved, baseline]) {
        assert.deepEqual(player.session.confirmed, states[player.session.confirmed.tick]);
      }
      const expected = states[improved.session.state.tick];
      if (expected?.phase === "playing") {
        error += Math.abs(improved.session.state.right.x - expected.right.x);
        oldError += Math.abs(baseline.session.state.right.x - expected.right.x);
      }
    }
    assert.equal(improved.session.confirmed.tick, 180);
    assert.deepEqual(improved.session.confirmed, baseline.session.confirmed);
    assert.ok(error < oldError, `${rtt}ms: early=${error}, frame-only=${oldError}`);
    assert.ok(improved.session.opponentInputs.size <= 12);
  }
});
