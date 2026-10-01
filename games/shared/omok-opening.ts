import type { Stone } from './omok.js';
import { isLegalMove } from './renju.js';
// Conservative center development seeds, not a claim of solved Renju openings.
// Exact positions only; all eight rotations/reflections are matched.
const seeds = [ {black:[] as number[],white:[] as number[],turn:1,move:112},
  {black:[112],white:[] as number[],turn:2,move:97},
  {black:[112],white:[97],turn:1,move:113} ];
export function openingMove(board:Stone[],turn:1|2):number|null {
  for(const seed of seeds) for(let symmetry=0;symmetry<8;symmetry++) {
    if(seed.turn!==turn)continue;
    const transform=(at:number)=>{let x=at%15-7,y=Math.floor(at/15)-7;if(symmetry>=4)x=-x;for(let n=0;n<symmetry%4;n++)[x,y]=[-y,x];return (y+7)*15+x+7;};
    const expected=new Map<number,number>([...seed.black.map(at=>[transform(at),1] as [number,number]),...seed.white.map(at=>[transform(at),2] as [number,number])]);
    if(board.every((s,at)=>s===(expected.get(at)??0))&&isLegalMove(board,transform(seed.move),turn))return transform(seed.move);
  }return null;
}
