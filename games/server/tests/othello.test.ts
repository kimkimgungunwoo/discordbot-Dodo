import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard, legalMoves, place, flips, chooseMove, counts, type BoardState, type Difficulty } from '../../shared/othello.js';
import { OthelloRoom } from '../src/othello-room.js';
import { computeCpuMove } from '../src/othello-ai-move.js';
test('opening and immutable flips', () => {
  const initial = freshBoard();
  assert.deepEqual(legalMoves(initial.board, 1), [19, 26, 37, 44]);
  const next = place(initial, 19);
  assert.equal(initial.board[27], 2);
  assert.equal(next.board[27], 1);
  assert.deepEqual(counts(next.board), { red: 4, blue: 1 });
  assert.throws(() => place(initial, 0));
});
test('all eight directions and edges', () => {
  const board = Array(64).fill(0);
  for (const [dx, dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]) {
    board[(3+dy)*8+3+dx] = 2; board[(3+2*dy)*8+3+2*dx] = 1;
  }
  assert.equal(flips(board, 27, 1).length, 8);
  const edge = Array(64).fill(0); edge[7] = 2; edge[8] = 1;
  assert.deepEqual(flips(edge, 6, 1), []);
});
test('automatic pass and termination with empty squares', () => {
  const board = Array(64).fill(1); board[0] = 0; board[1] = 2; board[3] = 0; board[4] = 2;
  const s: BoardState = { ...freshBoard(), board };
  const next = place(s, 0);
  assert.equal(next.passed, 2); assert.equal(next.turn, 1);
  assert.equal(place(next, 3).winner, 1);
  const sparse = Array(64).fill(0); sparse[1] = 2; sparse[2] = 1;
  const end = place({ ...freshBoard(), board: sparse }, 0);
  assert.equal(end.winner, 1); assert.equal(end.board.filter(s => !s).length, 61);
});
test('complete deterministic game keeps legal turns and counts', () => {
  let state = freshBoard();
  while (!state.winner && !state.draw) {
    const moves = legalMoves(state.board, state.turn); assert.ok(moves.length);
    state = place(state, moves[0]);
    assert.equal(counts(state.board).red + counts(state.board).blue, state.moves.length + 4);
    assert.ok(state.moves.length <= 60);
  }
});
test('each AI difficulty returns a legal move and reports progress', () => {
  for (const difficulty of ['easy','normal','hard','extreme','transcendent'] as Difficulty[]) {
    const state = freshBoard(), progress: number[] = [];
    const at = chooseMove(state, difficulty, () => 0, { budgetMs: 30, onProgress: at => progress.push(at) });
    assert.ok(legalMoves(state.board, state.turn).includes(at));
    if (difficulty !== 'easy') assert.ok(progress.length);
  }
});
test('server enforces roles, revisions, reconnect and authoritative result', () => {
  const room = new OthelloRoom({ game: 'othello', roomId: 'othello-test', guildId: '10', hostId: '1', p2Id: '2', mode: 'PVP' });
  const messages: any[] = [];
  const host = { id: '1', name: 'host', send: (m: any) => messages.push(m) };
  const guest = { id: '2', name: 'guest', send: (m: any) => messages.push(m) };
  const viewer = { id: '3', name: 'viewer', send: (m: any) => messages.push(m) };
  try {
    room.join(host); room.join(guest); room.join(viewer); room.startsAt = Date.now() - 1;
    room.move(viewer, { matchId: room.matchId, revision: 0, at: 19 });
    assert.equal(room.state.moves.length, 0);
    const red = room.blackSide === 'left' ? host : guest;
    room.move(red, { matchId: room.matchId, revision: 99, at: 19 });
    assert.equal(room.state.moves.length, 0);
    room.move(red, { matchId: room.matchId, revision: 0, at: 19 });
    assert.equal(room.state.moves.length, 1);
    room.leave(viewer); room.join(viewer);
    assert.equal(messages.at(-1).state.moves.length, 1);
    room.report(viewer, { score: { left: 64, right: 0 } }); assert.equal(room.result, null);
    while (!room.result) {
      const player = room.turnSide === 'left' ? host : guest;
      room.move(player, { matchId: room.matchId, revision: room.state.moves.length, at: legalMoves(room.state.board, room.state.turn)[0] });
    }
    assert.equal(room.result.score.left + room.result.score.right, room.state.moves.length + 4);
  } finally { room.dispose(); }
});
test('server AI worker returns a legal move', async () => {
  const state = freshBoard();
  assert.ok(legalMoves(state.board, 1).includes(await computeCpuMove(state, 'hard')));
});
