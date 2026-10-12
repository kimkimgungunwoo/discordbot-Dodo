import { DELTAS, FLAME_TICKS, FUSE_TICKS, IDLE, MOVE_TICKS, WIDTH, canMove, cell, copy, explode, install, type Direction, type Input, type Level, type State } from "./bomb-battle.js";

const PLAN_TICKS = Math.ceil(MOVE_TICKS);
interface Forecast { danger: Set<number>[]; boards: number[][]; bombs: Set<number>[]; unsafe: Set<number>; horizon: number }
function forecast(s: State, requested = 0): Forecast {
  // Never forget a live bomb just because a difficulty uses a short lookahead.
  const horizon = Math.ceil(Math.max(requested, ...s.bombs.map(b => b.explodesAt - s.tick + FLAME_TICKS + PLAN_TICKS), FLAME_TICKS + PLAN_TICKS));
  const future = copy(s), danger: Set<number>[] = [], boards: number[][] = [], bombs: Set<number>[] = [], unsafe = new Set<number>();
  for (let t = 0; t <= horizon + PLAN_TICKS; t++) {
    // Movement is before explosion in the next actual simulation tick.
    boards[t] = [...future.board]; bombs[t] = new Set(future.bombs.map(b => cell(b.x, b.y)));
    future.tick++; explode(future);
    danger[t] = new Set(future.flames.map(f => f.at));
    for (const at of danger[t]) unsafe.add(at);
  }
  return { danger, boards, bombs, unsafe, horizon };
}

/** Reach a permanent shelter as soon as possible. Waiting for a profitable
 * end-of-horizon position repeatedly used to postpone escape until too late. */
export function safePlan(s: State, seat: number, horizon = FUSE_TICKS + FLAME_TICKS + MOVE_TICKS, mustLeave = false, _aggressive = false): { direction: Direction; safe: boolean } {
  return escapePlan(s, seat, forecast(s, horizon), mustLeave);
}
function escapePlan(s: State, seat: number, f: Forecast, mustLeave = false): { direction: Direction; safe: boolean } {
  const p = s.players[seat], start = cell(p.x, p.y);
  const safeFrom = (at: number, t: number) => !f.danger.slice(t).some(cells => cells.has(at));
  if (!mustLeave && safeFrom(start, 0)) return { direction: 0, safe: true };
  type Node = { at: number; first: Direction; left: boolean };
  let nodes: Node[] = [{ at: start, first: 0, left: false }];
  for (let t = 0; t < f.horizon; t += PLAN_TICKS) {
    const next = new Map<string, Node>(), shelters: Node[] = [];
    for (const node of nodes) for (let d = 0; d < DELTAS.length; d++) {
      if (t === 0 && mustLeave && d === 0) continue;
      if (t === 0 && s.tick + 1 + 1e-9 < p.nextMove && d !== 0) continue;
      const [dx, dy] = DELTAS[d], at = node.at + dx + dy * WIDTH;
      if (f.boards[t][at] !== 0) continue;
      if (f.bombs[t].has(at) && !(at === start && !node.left && s.bombs.some(b => cell(b.x, b.y) === start && b.pass.includes(seat)))) continue;
      let safe = true;
      for(let dt=t;dt<Math.min(t+Math.ceil(PLAN_TICKS/2),f.danger.length);dt++)
        if(f.danger[dt].has(node.at)) { safe=false; break; }
      for (let dt = t; dt < Math.min(t + PLAN_TICKS, f.danger.length); dt++) if (f.danger[dt].has(at)) { safe = false; break; }
      if (!safe) continue;
      const first = t === 0 ? d as Direction : node.first, left = node.left || at !== start;
      const candidate = { at, first, left }, key = `${at}:${first}:${Number(left)}`;
      next.set(key, candidate);
      if ((!mustLeave || left) && safeFrom(at, t)) shelters.push(candidate);
    }
    if (shelters.length) {
      // Move now when equally short safe routes exist, rather than procrastinate.
      const shelter = shelters.find(n => n.first !== 0) ?? shelters[0];
      return { direction: shelter.first, safe: true };
    }
    nodes = [...next.values()]; if (!nodes.length) break;
  }
  return { direction: 0, safe: false };
}
function usefulBomb(s: State, seat: number, level: Level) {
  const p = s.players[seat];
  for (const [dx, dy] of DELTAS.slice(1)) for (let distance = 1; distance <= p.range; distance++) {
    const x = p.x + dx * distance, y = p.y + dy * distance, wall = s.board[cell(x, y)];
    if (wall === undefined || wall === 1) break;
    if (wall === 2) return true;
    if (s.players.some((q, i) => i !== seat && q.alive && q.x === x && q.y === y)) return true;
    if (s.bombs.some(b => b.x === x && b.y === y)) break;
  }
  return false;
}
function explore(s: State, seat: number, level: Level, f: Forecast): Direction {
  const p = s.players[seat], start = cell(p.x, p.y);
  const queue = [{ at: start, first: 0 as Direction, distance: 0 }], seen = new Set([start]);
  let best: Direction = 0, bestScore = -Infinity;
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node.at !== start) {
      const item = s.items.some(item => item.at === node.at);
      const crate = DELTAS.slice(1).some(([dx, dy]) => s.board[node.at + dx + dy * WIDTH] === 2);
      // Approach a firing lane, not the opponent's occupied tile: sharing a
      // tile prevents safe planting and used to deadlock the remaining bots.
      const nx=node.at%WIDTH, ny=Math.floor(node.at/WIDTH);
      const occupied=s.players.some((q,index)=>index!==seat && q.alive && cell(q.x,q.y)===node.at);
      const opponent = !occupied && s.players.some((q,index)=> {
        if(index===seat || !q.alive || (q.x!==nx && q.y!==ny)) return false;
        const distance=Math.abs(q.x-nx)+Math.abs(q.y-ny);
        if(distance>p.range) return false;
        const dx=Math.sign(q.x-nx),dy=Math.sign(q.y-ny);
        for(let n=1;n<distance;n++) if(s.board[cell(nx+dx*n,ny+dy*n)]!==0) return false;
        return true;
      });
      const reward = occupied ? -1000 : opponent ? (level === "extreme" ? 38 : 28) : item ? 24 : crate ? 12 : -1000;
      const score = reward - node.distance * 3;
      if (score > bestScore) { bestScore = score; best = node.first; }
    }
    for (let d = 1; d < DELTAS.length; d++) {
      const [dx, dy] = DELTAS[d], at = node.at + dx + dy * WIDTH;
      if (seen.has(at) || s.board[at] !== 0 || f.unsafe.has(at) || !canMove(s, seat, at % WIDTH, Math.floor(at / WIDTH))) continue;
      seen.add(at); queue.push({ at, first: node.first || d as Direction, distance: node.distance + 1 });
    }
  }
  return bestScore > -1000 ? best : 0;
}
function gridBotInput(s: State, seat: number, level: Level): Input {
  const p = s.players[seat];
  if (!p.alive || s.phase !== "playing" || s.tick + 1 + 1e-9 < p.nextMove) return IDLE;
  const f = forecast(s), at = cell(p.x, p.y);
  // Safety is identical at every difficulty and bypasses easy/normal pauses.
  if (f.unsafe.has(at)) {
    const escape = escapePlan(s, seat, f);
    return { direction: escape.direction, bomb: false };
  }
  // Stay in shelter until our bomb and its lingering flames have disappeared.
  // Do not pick up an item or plant another bomb during the retreat.
  if (s.bombs.some(b => b.owner === seat)) return IDLE;
  const period = level === "easy" ? Math.round(MOVE_TICKS * 3) : level === "normal" ? Math.round(MOVE_TICKS * 2) : 1;
  if ((s.tick - seat * 2) % period !== 0) return IDLE;
  if (level === "easy" && Math.floor(s.tick / period + seat) % 4 === 0) return IDLE;
  if (usefulBomb(s, seat, level) && !s.players.some((q, index) => index !== seat && q.alive && cell(q.x, q.y) === at)) {
    const hypothetical = copy(s);
    if (install(hypothetical, seat)) {
      // The real bomb is installed in the next step, not the current state tick.
      hypothetical.bombs.at(-1)!.explodesAt++;
      const escape = safePlan(hypothetical, seat, undefined, true);
      if (escape.safe && escape.direction) return { direction: escape.direction, bomb: true };
    }
  }
  return { direction: explore(s, seat, level, f), bomb: false };
}

/** Grid planning chooses waypoints; locomotion uses the same continuous physics as humans. */
export function botInput(s: State, seat: number, level: Level): Input {
  const p=s.players[seat];
  if(!p.alive || s.phase!=="playing") return IDLE;
  if(p.target && Math.hypot(p.target.x-p.x,p.target.y-p.y)>1e-6) {
    const direction: Direction = Math.abs(p.target.x-p.x)>1e-6 ? p.target.x>p.x?2:4 : p.target.y>p.y?3:1;
    return {direction,bomb:false,target:p.target};
  }
  const grid={...s,players:s.players.map(q=>({...q,x:Math.round(q.x),y:Math.round(q.y),nextMove:0}))};
  const input=gridBotInput(grid,seat,level);
  if(!input.direction) return input;
  const [dx,dy]=DELTAS[input.direction];
  return {...input,target:{x:Math.round(p.x)+dx,y:Math.round(p.y)+dy}};
}
