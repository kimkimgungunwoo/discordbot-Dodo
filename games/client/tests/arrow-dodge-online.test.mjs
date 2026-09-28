import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const directory = mkdtempSync(join(tmpdir(), "dodo-arrow-online-"));
mkdirSync(join(directory, "arrow-dodge"), { recursive: true });
mkdirSync(join(directory, "common"), { recursive: true });
writeFileSync(join(directory, "common/spectators.js"), "");
for (const name of ["arrow-dodge/constants", "arrow-dodge/types", "arrow-dodge/game", "arrow-dodge/session"]) {
  const source = readFileSync(new URL("../src/" + name + ".ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  writeFileSync(join(directory, name + ".js"), output.outputText);
}
const require = createRequire(import.meta.url);
const { OnlineSession } = require(join(directory, "arrow-dodge/session.js"));
const { createInitialState, EMPTY_INPUT } = require(join(directory, "arrow-dodge/game.js"));
after(() => rmSync(directory, { recursive: true, force: true }));

globalThis.location = new URL("https://activity.example/arrow-dodge");
class Socket {
  static OPEN = 1; static instances = [];
  readyState = 1; sent = [];
  constructor() { Socket.instances.push(this); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
  receive(value) { this.onmessage({ data: JSON.stringify(value) }); }
}
globalThis.WebSocket = Socket;

function connect(role) {
  const session = new OnlineSession("room", "token"), socket = Socket.instances.at(-1);
  socket.onopen();
  socket.receive({ type: "GAME_START", seed: 4, role, userId: role === "left" ? "1" : "2", seq: 0, committedTick: 0,
    room: { game: "arrow_dodge", hostId: "1", p2Id: null, mode: "SOLO" } });
  socket.receive({ type: "CAUGHT_UP" });
  socket.receive({ type: "PRESENCE", ready: true, committedTick: 0, spectators: [], players: [] });
  return { session, socket };
}

test("solo host sends no frames before start and marks only the first input as start", () => {
  const { session, socket } = connect("left");
  session.advance(EMPTY_INPUT);
  assert.equal(socket.sent.filter(message => message.type === "INPUT").length, 0);
  assert.equal(session.requestStart(), true);
  session.advance({ x: 1, y: 0 });
  const inputs = socket.sent.filter(message => message.type === "INPUT");
  assert.equal(inputs.length, 6);
  assert.equal(inputs.filter(message => message.input.start).length, 1);
  assert.equal(inputs[0].input.start, true);
});

test("spectators replay history without sending input or results", () => {
  const { session, socket } = connect("spectator");
  socket.receive({ type: "HISTORY", frames: [{ tick: 1, left: { ...EMPTY_INPUT, start: true, jump: false, hit: false }, right: null }] });
  session.replayTarget = 1; session.advance(EMPTY_INPUT);
  assert.equal(session.state.phase, "countdown");
  assert.equal(socket.sent.some(message => ["INPUT", "RESULT"].includes(message.type)), false);
  assert.equal(session.requestStart(), false);
});

test("a confirmed game over reports tick-derived survival time once", () => {
  const { session, socket } = connect("left");
  const over = createInitialState(4); over.tick = 181; over.phase = "gameover"; over.survivalTicks = 60;
  session.confirmed = over; session.state = over;
  session.advance(EMPTY_INPUT); session.advance(EMPTY_INPUT);
  const reports = socket.sent.filter(message => message.type === "RESULT");
  assert.equal(reports.length, 1);
  assert.deepEqual({ tick: reports[0].tick, survivalTicks: reports[0].survivalTicks, survivalMs: reports[0].survivalMs },
    { tick: 181, survivalTicks: 60, survivalMs: 1000 });
});
