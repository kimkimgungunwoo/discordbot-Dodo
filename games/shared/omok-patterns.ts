import type { Stone } from './omok.js';
import { isLegalMove } from './renju.js';
const axes = [[1,0],[0,1],[1,1],[1,-1]];
export interface LinePattern { stones: number[]; completions: number[]; kind: 'four' | 'open-three' | 'broken-three' | 'closed-three' }
// Cache geometric five-cell windows; legality is always checked on the actual board.
const windows = new Map<string, { stones: number[]; empty: number[] }[]>();
function table(line: string) {
  let result = windows.get(line);
  if (result) return result;
  result = [];
  for (let start=0; start+5<=line.length; start++) {
    const segment=line.slice(start,start+5);
    if (segment.includes('#')) continue;
    const stones:number[]=[], empty:number[]=[];
    for(let i=0;i<5;i++) (segment[i]==='X'?stones:empty).push(start+i);
    if(stones.length>=3) result.push({stones,empty});
  }
  if(windows.size>=16000) windows.clear();
  windows.set(line,result); return result;
}
export function linePatterns(board: Stone[], at: number, stone: 1|2): LinePattern[] {
  const result:LinePattern[]=[];
  for(const [dx,dy] of axes) {
    const cells=Array.from({length:11},(_,i)=>{const x=at%15+dx*(i-5),y=Math.floor(at/15)+dy*(i-5);return x<0||y<0||x>=15||y>=15?-1:y*15+x;});
    const line=cells.map(c=>c<0?'#':board[c]===stone?'X':board[c]?'#':'.').join('');
    const groups=new Map<string,LinePattern>();
    for(const w of table(line)) {
      if(!w.stones.includes(5)) continue;
      const stones=w.stones.map(i=>cells[i]), completions=w.empty.map(i=>cells[i]);
      if(stones.length===4) {
        const end=completions[0];
        if(!isLegalMove(board,end,stone)) continue;
        const lo=w.stones.concat(w.empty).sort((a,b)=>a-b)[0];
        if(stone===1 && (line[lo-1]==='X'||line[lo+5]==='X')) continue;
        const key=stones.join(','); const existing=groups.get(key);
        if(existing) existing.completions.push(end); else groups.set(key,{stones,completions,kind:'four'});
      } else if(stones.length===3) {
        const extensions:number[]=[];
        for(const end of completions) {
          if(!isLegalMove(board,end,stone)) continue;
          const i=cells.indexOf(end), filled=line.slice(0,i)+'X'+line.slice(i+1);
          for(let start=1;start+4<filled.length;start++) {
            if(filled.slice(start-1,start+5)!=='.XXXX.') continue;
            if(!w.stones.every(s=>s>=start&&s<start+4)||i<start||i>=start+4) continue;
            if(stone===1&&(filled[start-2]==='X'||filled[start+5]==='X')) continue;
            extensions.push(end);
          }
        }
        const key=stones.join(','); const old=groups.get(key);
        const broken=w.stones[2]-w.stones[0]>2;
        const kind=extensions.length?(broken?'broken-three':'open-three'):'closed-three';
        if(!old||old.kind==='closed-three') groups.set(key,{stones,completions:[...new Set(extensions.length?extensions:completions)],kind});
        else old.completions=[...new Set([...old.completions,...extensions])];
      }
    }
    result.push(...groups.values());
  }
  return result;
}
export function patternScore(board:Stone[],at:number,stone:1|2):number {
  board[at]=stone;
  try {
    const patterns=linePatterns(board,at,stone);
    const fours=patterns.filter(p=>p.kind==='four'), threes=patterns.filter(p=>p.kind==='open-three'||p.kind==='broken-three');
    return (fours.some(p=>p.completions.length>1)?1000000:fours.length*30000)+threes.length*8000+
      (fours.length>1?600000:0)+(fours.length&&threes.length?120000:0)+(threes.length>1?80000:0);
  } finally {board[at]=0;}
}
