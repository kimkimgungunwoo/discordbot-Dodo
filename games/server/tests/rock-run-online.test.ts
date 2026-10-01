import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { OnlineSession } from '../../client/src/rock-run/session.js';
import { createInitialState, step } from '../../shared/rock-run.js';
import { COUNTDOWN_TICKS } from '../../shared/rock-run-config.js';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  sent: any[] = [];
  onopen!: () => void;
  onmessage!: (event: { data: string }) => void;
  onclose!: () => void;
  constructor(_url: unknown) { Socket.instances.push(this); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
  receive(message: unknown) { this.onmessage({ data: JSON.stringify(message) }); }
  inputs() { return this.sent.filter(m => m.type === 'INPUT'); }
}
const originalSocket = globalThis.WebSocket;
const originalLocation = (globalThis as any).location;
(globalThis as any).WebSocket = Socket;
(globalThis as any).location = new URL('https://activity.example/rock-run');
after(() => {
  globalThis.WebSocket = originalSocket;
  if (originalLocation === undefined) delete (globalThis as any).location;
  else (globalThis as any).location = originalLocation;
});

function hydrate(session: OnlineSession, socket: Socket, role = 'left', matchId = 'match') {
  socket.onopen();
  const frames = Array.from({ length: COUNTDOWN_TICKS + 1 }, (_, i) => ({
    tick: i + 1, left: { hit: false, start: i === 0 }, right: null,
  }));
  socket.receive({ type: 'GAME_START', matchId, seed: 1, role, seq: 0,
    committedTick: frames.length, room: { bestScore: 4321 } });
  socket.receive({ type: 'HISTORY', frames });
  socket.receive({ type: 'CAUGHT_UP' });
  socket.receive({ type: 'PRESENCE', ready: true });
  session.advance({ hit: false });
  assert.equal(session.state.phase, 'playing');
  return frames;
}
function connect(role = 'left') {
  const session = new OnlineSession('room', 'token');
  const socket = Socket.instances.at(-1)!;
  const history = hydrate(session, socket, role);
  return { session, socket, history };
}
function acknowledge(socket: Socket, message: any) {
  socket.receive({ type: 'FRAME', frame: { tick: message.tick, left: message.input, right: null } });
}

test('delayed acknowledgements preserve rapid release/repress and refire the airborne wire', () => {
  const { session, socket, history } = connect();
  session.advance({ hit: true });
  const first = [...socket.inputs()];
  assert.equal(first.length, 6);
  session.advance({ hit: false });
  session.advance({ hit: true });
  assert.equal(socket.inputs().length, 6, 'the network window is full');

  for (const message of first) { acknowledge(socket, message); session.advance({ hit: true }); }
  const queued = socket.inputs().slice(6);
  assert.deepEqual(queued.slice(0, 2).map(m => m.input.hit), [false, true]);

  // Replay exactly what crossed the network, not a separately constructed input sequence.
  let authoritative = createInitialState(1);
  for (const frame of history) authoritative = step(authoritative, frame.left);
  for (const message of first) authoritative = step(authoritative, message.input);
  authoritative = step(authoritative, queued[0].input);
  authoritative = step(authoritative, queued[1].input);
  assert.ok(authoritative.shot, 'the repress must launch a wire during the jump');

  session.advance({ hit: false }); session.advance({ hit: true }); session.advance({ hit: false });
  for (const message of queued) { acknowledge(socket, message); session.advance({ hit: false }); }
  const next = socket.inputs().slice(12);
  assert.deepEqual(next.slice(0, 3).map(m => m.input.hit), [false, true, false]);
});

test('a replacement match discards pending actions and spectators never transmit them', () => {
  const { session, socket } = connect();
  session.advance({ hit: false });
  session.advance({ hit: true }); session.advance({ hit: false });
  socket.receive({ type: 'MATCH_REPLACED' });
  const next = Socket.instances.at(-1)!;
  hydrate(session, next, 'left', 'replacement');
  session.advance({ hit: false });
  assert.ok(next.inputs().every(m => !m.input.hit));
  assert.ok(next.inputs().every(m => m.matchId === 'replacement'));

  const viewer = connect('spectator');
  viewer.session.advance({ hit: true }); viewer.session.advance({ hit: false });
  assert.equal(viewer.socket.inputs().length, 0);
});

test('server completion stays visible without redundant client score reports', () => {
  const { session, socket } = connect();
  const finished = { ...createInitialState(), phase: 'gameover' as const, score: 5000 };
  (session as any).confirmed = finished;
  socket.receive({ type: 'FINISHED' });
  session.advance({ hit: false });
  assert.equal(session.message, '점수 저장 완료');
  assert.equal(session.bestScore, 5000);
  assert.equal(socket.sent.some(m => m.type === 'RESULT'), false);
});
