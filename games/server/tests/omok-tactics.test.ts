import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard, selectSearchMoves, isLegalMove } from '../../shared/omok.js';
import { proveThreat } from '../../shared/omok-proof.js';
import { linePatterns } from '../../shared/omok-patterns.js';
import { openingMove } from '../../shared/omok-opening.js';
for(const side of [1,2] as const) test(`VCF proves four-three for color ${side} and restores board`,()=>{
 const {board}=freshBoard();[110,111,113,97,127].forEach(at=>board[at]=side);board[109]=side===1?2:1;
 const before=[...board];const proof=proveThreat(board,side,'VCF',performance.now()+3000,12);
 assert.equal(proof.status,'proven');assert.ok(isLegalMove(board,proof.move!,side));assert.deepEqual(board,before);
});
test('VCT proves double-three attack by verifying all defender replies',()=>{
 const {board}=freshBoard();[111,113,97,127].forEach(at=>board[at]=2);
 const result=proveThreat(board,2,'VCT',performance.now()+5000,6);
 assert.equal(result.status,'proven');assert.ok(result.move!==null);
});
test('forbidden black forks are excluded and timeout is unknown',()=>{
 const {board}=freshBoard();[110,111,113,82,97,127].forEach(at=>board[at]=1);
 const before=[...board];const result=proveThreat(board,1,'VCT',performance.now()+100,8);
 if(result.move!==null)assert.ok(isLegalMove(board,result.move,1));
 assert.deepEqual(board,before);
 assert.equal(proveThreat(board,1,'VCT',performance.now()-1).status,'unknown');
});
test('table tracks open and broken threes, closed threes, and four completion points',()=>{
 for(const [stones,kind] of [[[111,112,113],'open-three'],[[110,112,113],'broken-three'],[[110,111,112,113],'four']] as const){
  const {board}=freshBoard();stones.forEach(at=>board[at]=2);
  const patterns=linePatterns(board,112,2);assert.ok(patterns.some(p=>p.kind===kind));
  if(kind==='four')assert.ok(patterns.some(p=>p.completions.includes(109)&&p.completions.includes(114)));
 }
 const {board}=freshBoard();[111,112,113].forEach(at=>board[at]=2);board[110]=1;
 assert.ok(linePatterns(board,112,2).some(p=>p.kind==='closed-three'));
});
test('forcing candidates survive width limits',()=>{
 const moves=Array.from({length:50},(_,at)=>({at,attack:at<40?30000:0,defense:0}));
 assert.equal(selectSearchMoves(moves,2).length,40);
});
test('opening seeds match only exact positions and legal continuations',()=>{
 const {board}=freshBoard();assert.equal(openingMove(board,1),112);board[112]=1;
 assert.ok(isLegalMove(board,openingMove(board,2)!,2));board[0]=2;assert.equal(openingMove(board,1),null);
});
test('a single three is not a proof, and immediate defender wins refute an attack',()=>{
 const {board}=freshBoard();board[111]=2;board[113]=2;
 assert.equal(proveThreat(board,2,'VCT',performance.now()+2000,4).status,'unknown');
 [30,31,32,33].forEach(at=>board[at]=1);
 const before=[...board];
 assert.equal(proveThreat(board,2,'VCT',performance.now()+2000,6).status,'unknown');
 assert.deepEqual(board,before);
});

test('a forbidden last defense is a draw, not a forced win', async () => {
 const { place, transcendentMove } = await import('../../shared/omok.js');
 const state = freshBoard(); state.turn = 2;
 state.board = state.board.map((_, at) => (Math.floor(at / 15) + Math.floor(at % 15 / 2)) % 2 ? 1 : 2);
 [109,110,111,113,114].forEach(at => state.board[at] = 1);
 [82,97,127].forEach(at => state.board[at] = 2);
 state.board[112] = 0; state.board[142] = 0;
 assert.equal(place(state,142).draw, true);
 const before = [...state.board];
 assert.equal(proveThreat(state.board,2,'VCF',performance.now()+1000).status,'unknown');
 assert.equal(proveThreat(state.board,2,'VCT',performance.now()+1000).status,'unknown');
 const stats = { nodes:0, depth:0, forcedWin:false, elapsedMs:0 };
 transcendentMove(state.board,2,100,stats);
 assert.equal(stats.forcedWin,false);
 assert.deepEqual(state.board,before);
});
