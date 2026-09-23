import { test } from "node:test";
import assert from "node:assert/strict";
import { AiQueue } from "../src/ai-queue.js";
import { computeCpuMove } from "../src/ai-move.js";
import { freshBoard, isLegalMove, place } from "../../shared/omok.js";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("AI queue caps concurrency and releases slots on failures", async () => {
  const queue = new AiQueue<number>(2, 1000);
  const finish: ((value: number) => void)[] = [];
  const first = queue.run(() => new Promise(resolve => finish.push(resolve)));
  const second = queue.run(() => new Promise(resolve => finish.push(resolve)));
  let thirdStarted = false;
  const third = queue.run(async () => { thirdStarted = true; throw new Error("worker error"); });
  const rejected = assert.rejects(third, /worker error/);
  await tick();
  assert.equal(queue.running, 2); assert.equal(queue.pending, 1); assert.equal(thirdStarted, false);
  finish[0](10); await first; await rejected; await tick();
  assert.equal(queue.running, 1); assert.equal(queue.pending, 0);
  finish[1](20); assert.equal(await second, 20); await tick();
  assert.equal(queue.running, 0);
});

test("queued and active AI work can be cancelled without starting an extra worker", async () => {
  const queue = new AiQueue<number>(1, 1000), running = new AbortController(), waiting = new AbortController();
  const first = queue.run((_, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))), running.signal);
  let queuedStarted = false;
  const next = queue.run(async () => { queuedStarted = true; return 2; }, waiting.signal);
  const rejectedFirst = assert.rejects(first), rejectedNext = assert.rejects(next);
  await tick(); waiting.abort(); await rejectedNext;
  assert.equal(queue.pending, 0); assert.equal(queuedStarted, false);
  running.abort(); await rejectedFirst; await tick();
  assert.equal(queue.running, 0);
});

test("waiting time counts against the response limit and stale jobs never run", async () => {
  const queue = new AiQueue<number>(1, 40, 1);
  let finish!: (value: number) => void;
  const first = queue.run(() => new Promise(resolve => { finish = resolve; }));
  let staleStarted = false;
  const stale = queue.run(async () => { staleStarted = true; return 2; });
  const rejected = assert.rejects(stale, /대기 시간 초과/);
  await assert.rejects(queue.run(async () => 3), /가득/);
  await new Promise(resolve => setTimeout(resolve, 60)); await rejected;
  assert.equal(staleStarted, false); assert.equal(queue.pending, 0);
  finish(1); await first;
});

test("a queued worker receives only its remaining time budget", async () => {
  const queue = new AiQueue<number>(1, 1000);
  let finish!: (value: number) => void;
  const first = queue.run(() => new Promise(resolve => { finish = resolve; }));
  let remaining = 0;
  const second = queue.run(async budget => { remaining = budget; return 2; });
  await new Promise(resolve => setTimeout(resolve, 30)); finish(1);
  await Promise.all([first, second]);
  assert.ok(remaining > 0 && remaining < 990);
});

test("transcendent workers remain cancellable and leave the event loop responsive", async () => {
  let state = freshBoard(); for (const at of [112, 113, 97, 98]) state = place(state, at);
  const controller = new AbortController();
  const move = computeCpuMove(state, "transcendent", controller.signal);
  const rejected = assert.rejects(move, /취소/);
  const start = performance.now();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(performance.now() - start < 500, "AI blocked the event loop");
  controller.abort(); await rejected;
  const forced = freshBoard(); [105, 106, 107, 108].forEach(at => forced.board[at] = 1);
  assert.ok(isLegalMove(forced.board, await computeCpuMove(forced, "transcendent"), 1));
});
