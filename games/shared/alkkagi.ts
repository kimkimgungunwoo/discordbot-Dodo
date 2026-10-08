export type Color = 1 | 2;
export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme';
export const LABELS: Record<Difficulty, string> = { easy: '쉬움', normal: '중간', hard: '어려움', extreme: '극한' };
export const SIZE = 600, RADIUS = 18, MAX_SPEED = 800, DRAG_LIMIT = 150;
export const FULL_POWER_SPEED = 880;
export const isFullPower = (length: number) => length >= DRAG_LIMIT - 1e-6;
export const TURN_LIMIT_MS = 45_000, TOSS_MS = 4000, AI_RESPONSE_LIMIT_MS = 9000;
// All stones share the same stronger, arcade-style collision response.
const DT = 1 / 240, FRICTION = 1050, RESTITUTION = 1.3, STOP_SPEED = 5;
export interface Stone { id: number; color: Color; x: number; y: number; vx: number; vy: number; alive: boolean }
export interface Shot { id: number; dx: number; dy: number }
export interface State { stones: Stone[]; turn: Color; revision: number; moving: boolean; winner: 0 | Color; draw: boolean; quietTurns: number; removedBefore: number }
export function freshBoard(): State {
  const stones: Stone[] = [];
  for (const color of [1, 2] as Color[]) for (let i = 0; i < 6; i++) {
    // Rotate the same staggered formation for the opposing side.
    const rear = i >= 3, x = (rear ? 60 : 120) + (i % 3) * 180, y = rear ? 530 : 450;
    stones.push({ id: stones.length, color, x: color === 1 ? x : SIZE-x, y: color === 1 ? y : SIZE-y, vx: 0, vy: 0, alive: true });
  }
  return { stones, turn: 1, revision: 0, moving: false, winner: 0, draw: false, quietTurns: 0, removedBefore: 0 };
}
export const remaining = (s: State, color: Color) => s.stones.filter(p => p.alive && p.color === color).length;
export function validShot(s: State, shot: Shot): boolean {
  return !!shot && Number.isInteger(shot.id) && [shot.dx, shot.dy].every(v => typeof v === 'number' && Number.isFinite(v)) && Math.hypot(shot.dx, shot.dy) >= 5 && Math.hypot(shot.dx, shot.dy) <= DRAG_LIMIT + .001 && s.stones.some(p => p.id === shot.id && p.alive && p.color === s.turn) && !s.moving && !s.winner && !s.draw;
}
export function shoot(s: State, shot: Shot): State {
  if (!validShot(s, shot)) throw new Error('자기 돌을 뒤로 당겨 발사해주세요.');
  const next: State = { ...s, stones: s.stones.map(p => ({ ...p })), moving: true, revision: s.revision + 1, removedBefore: s.stones.filter(p => !p.alive).length };
  const stone = next.stones.find(p => p.id === shot.id)!;
  const length = Math.hypot(shot.dx,shot.dy);
  const scale = isFullPower(length) ? FULL_POWER_SPEED / length : MAX_SPEED / DRAG_LIMIT;
  stone.vx = shot.dx * scale; stone.vy = shot.dy * scale;
  return next;
}
// Small fixed steps prevent a fast stone from passing through another stone.
export function step(s: State): State {
  if (!s.moving) return s;
  const next = { ...s, stones: s.stones.map(p => ({ ...p })) };
  for (let sub = 0; sub < 4; sub++) {
    for (const p of next.stones) {
      if (!p.alive) continue;
      p.x += p.vx * DT; p.y += p.vy * DT;
      if (p.x < 0 || p.x > SIZE || p.y < 0 || p.y > SIZE) { p.alive = false; p.vx = p.vy = 0; continue; }
      const speed = Math.hypot(p.vx, p.vy), ratio = speed ? Math.max(0, speed - FRICTION * DT) / speed : 0;
      p.vx *= ratio; p.vy *= ratio;
    }
    for (let i = 0; i < next.stones.length; i++) for (let j = i + 1; j < next.stones.length; j++) {
      const a = next.stones[i], b = next.stones[j]; if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= RADIUS * 2) continue;
      const nx = d ? dx / d : 1, ny = d ? dy / d : 0;
      const correction = (RADIUS * 2 - d + .001) / 2;
      a.x -= nx * correction; a.y -= ny * correction; b.x += nx * correction; b.y += ny * correction;
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (closing > 0) {
        const impulse = closing * (1 + RESTITUTION) / 2;
        a.vx -= impulse * nx; a.vy -= impulse * ny; b.vx += impulse * nx; b.vy += impulse * ny;
      }
    }
    for (const p of next.stones) if (p.alive && (p.x < 0 || p.x > SIZE || p.y < 0 || p.y > SIZE)) { p.alive = false; p.vx = p.vy = 0; }
  }
  if (next.stones.every(p => !p.alive || Math.hypot(p.vx, p.vy) < STOP_SPEED)) {
    next.stones.forEach(p => { p.vx = p.vy = 0; }); next.moving = false;
    const black = remaining(next, 1), white = remaining(next, 2);
    const removed = next.stones.filter(p => !p.alive).length;
    next.quietTurns = removed > next.removedBefore ? 0 : next.quietTurns + 1;
    next.draw = (!black && !white) || next.quietTurns >= 40;
    next.winner = next.draw ? 0 : !white ? 1 : !black ? 2 : 0;
    next.turn = next.turn === 1 ? 2 : 1;
  }
  return next;
}
export function simulate(s: State, shot: Shot): State {
  let next = shoot(s, shot);
  for (let tick = 0; next.moving && tick < 600; tick++) next = step(next);
  if (next.moving) throw new Error('물리 정지 시간 초과');
  return next;
}
export function timeoutShot(s: State): Shot {
  const own = s.stones.find(p => p.alive && p.color === s.turn)!;
  const target = s.stones.filter(p => p.alive && p.color !== s.turn).sort((a, b) => Math.hypot(a.x-own.x,a.y-own.y)-Math.hypot(b.x-own.x,b.y-own.y))[0];
  const angle = Math.atan2(target.y - own.y, target.x - own.x);
  return { id: own.id, dx: Math.cos(angle) * 95, dy: Math.sin(angle) * 95 };
}
function candidates(s: State, detailed: boolean): Shot[] {
  const shots: Shot[] = [];
  for (const own of s.stones.filter(p => p.alive && p.color === s.turn)) for (const target of s.stones.filter(p => p.alive && p.color !== s.turn)) {
    const distance = Math.hypot(target.x-own.x,target.y-own.y), direct = Math.atan2(target.y-own.y,target.x-own.x);
    const ux = Math.cos(direct), uy = Math.sin(direct);
    const exitX = ux > 0 ? (SIZE-target.x)/ux : ux < 0 ? -target.x/ux : Infinity;
    const exitY = uy > 0 ? (SIZE-target.y)/uy : uy < 0 ? -target.y/uy : Infinity;
    const edgeTravel = Math.min(exitX,exitY);
    const transfer = (1 + RESTITUTION) / 2;
    const physicalPower = Math.min(DRAG_LIMIT, Math.sqrt(2 * FRICTION * (Math.max(0,distance-RADIUS*2) + edgeTravel / transfer**2)) / MAX_SPEED * DRAG_LIMIT);
    const contactAngle = Math.asin(Math.min(.95,RADIUS*2/Math.max(RADIUS*2,distance)));
    for (const factor of detailed ? [0,-.25,.25,-.55,.55,-.85,.85] : [0,-.5,.5]) {
      const offset = factor*contactAngle;
      for (const power of detailed ? [physicalPower*.85,physicalPower,physicalPower*1.12,70,100,130,150] : [physicalPower,95,145]) {
        const force = Math.max(15,Math.min(DRAG_LIMIT,power));
        shots.push({ id: own.id, dx: Math.cos(direct+offset)*force, dy: Math.sin(direct+offset)*force });
      }
    }
  }
  return shots;
}
function evaluate(s: State, color: Color): number {
  if (s.draw) return 0;
  if (s.winner) return s.winner === color ? 100000 : -100000;
  let score = (remaining(s,color) - remaining(s,color === 1 ? 2 : 1)) * 1500;
  for (const p of s.stones.filter(p => p.alive)) {
    const edge = Math.min(p.x,SIZE-p.x,p.y,SIZE-p.y);
    score += (p.color === color ? 1 : -1) * (Math.min(140,edge)*1.4 - Math.max(0,70-edge)*4);
    // Reward approaching opponents instead of waiting far outside striking range.
    if (p.color === color) {
      const opponents = s.stones.filter(other => other.alive && other.color !== color);
      const distance = Math.min(...opponents.map(other => Math.hypot(other.x-p.x,other.y-p.y)));
      score -= Math.max(0,distance-RADIUS*2)*.65;
    }
  }
  return score;
}
export interface SearchOptions { budgetMs?: number; onProgress?: (shot: Shot) => void }
export function chooseShot(s: State, difficulty: Difficulty, random = Math.random, options: SearchOptions = {}): Shot {
  if (s.moving || s.winner || s.draw) throw new Error('발사할 수 없는 상태입니다.');
  const budget = {easy:20,normal:180,hard:1200,extreme:4500}[difficulty];
  const deadline = performance.now() + Math.min(budget, options.budgetMs ?? budget), color = s.turn;
  const rootDeadline = difficulty === 'normal' ? deadline : performance.now() + Math.max(1,(deadline-performance.now())*.3);
  let best = timeoutShot(s), bestValue = -Infinity;
  if (difficulty === 'easy') {
    const angle = Math.atan2(best.dy,best.dx) + (random()-.5)*.45, power = 70+random()*65;
    return { id: best.id, dx: Math.cos(angle)*power, dy: Math.sin(angle)*power };
  }
  if (difficulty !== 'normal') options.onProgress?.(best);
  const ranked: {shot: Shot; state: State; value: number}[] = [];
  const all = candidates(s,difficulty !== 'normal');
  // Round-robin across source/target pairs so a budget doesn't favor the first stone.
  const stride = difficulty === 'normal' ? 9 : 49, groups = all.length / stride;
  for (let k = 0; k < stride && performance.now() < rootDeadline; k++) for (let g = 0; g < groups && performance.now() < rootDeadline; g++) {
    const shot = all[g*stride+k], next = simulate(s,shot), value = evaluate(next,color);
    ranked.push({shot,state:next,value});
    if (value > bestValue) { best = shot; bestValue = value; if (difficulty !== 'normal') options.onProgress?.(best); }
  }
  ranked.sort((a,b) => b.value-a.value);
  if (difficulty === 'normal') {
    const angle = Math.atan2(best.dy,best.dx)+(random()-.5)*.16;
    const power = Math.max(5,Math.min(DRAG_LIMIT,Math.hypot(best.dx,best.dy)*(.88+random()*.24)));
    const shot = {id:best.id,dx:Math.cos(angle)*power,dy:Math.sin(angle)*power};
    options.onProgress?.(shot); return shot;
  }
  // Refine strong shots with small angle/power changes before counterplay search.
  for (const candidate of ranked.slice(0,4)) {
    const angle = Math.atan2(candidate.shot.dy,candidate.shot.dx), power = Math.hypot(candidate.shot.dx,candidate.shot.dy);
    for (const offset of [-.02,0,.02]) for (const delta of [-5,5]) {
      if (performance.now() >= deadline) break;
      const force = Math.max(5,Math.min(DRAG_LIMIT,power+delta));
      const shot = {id:candidate.shot.id,dx:Math.cos(angle+offset)*force,dy:Math.sin(angle+offset)*force};
      const next = simulate(s,shot), value = evaluate(next,color);
      ranked.push({shot,state:next,value});
      if (value > bestValue) {best=shot;bestValue=value;options.onProgress?.(best);}
    }
  }
  ranked.sort((a,b)=>b.value-a.value);
  const finalists: typeof ranked = [];
  for (const candidate of ranked) {
    if (finalists.some(p => p.shot.id === candidate.shot.id &&
        Math.abs(Math.atan2(p.shot.dx*candidate.shot.dy-p.shot.dy*candidate.shot.dx,p.shot.dx*candidate.shot.dx+p.shot.dy*candidate.shot.dy)) < .05 &&
        Math.abs(Math.hypot(p.shot.dx,p.shot.dy)-Math.hypot(candidate.shot.dx,candidate.shot.dy)) < 12)) continue;
    finalists.push(candidate);
    if (finalists.length >= (difficulty === 'extreme' ? 6 : 3)) break;
  }
  // Complete each opponent-response layer before publishing its minimax choice.
  let minimax = -Infinity, tactical = best;
  for (const candidate of finalists) {
    if (performance.now() >= deadline) break;
    if (candidate.state.winner || candidate.state.draw) { if (candidate.value > minimax) { minimax = candidate.value; tactical = candidate.shot; } continue; }
    let worst = Infinity, completed = true;
    const replies: {state:State;value:number}[] = [];
    for (const reply of candidates(candidate.state,false)) {
      if (performance.now() >= deadline) { completed = false; break; }
      const after = simulate(candidate.state,reply), value = evaluate(after,color);
      replies.push({state:after,value}); worst = Math.min(worst,value);
      if (difficulty === 'hard' && worst <= minimax) break;
    }
    if (!completed) break;
    if (difficulty === 'extreme') {
      replies.sort((a,b)=>a.value-b.value); worst=Infinity;
      for (const reply of replies.slice(0,6)) {
        const after=reply.state; let value=reply.value;
        if (!after.winner && !after.draw) {
        // Search a recovery shot from every remaining source/target pair.
        const ownReplies = candidates(after,false).filter((_,index)=>index%9===0);
        let recovery = -Infinity;
        for (const follow of ownReplies) {
          if (performance.now() >= deadline) { completed = false; break; }
          recovery = Math.max(recovery,evaluate(simulate(after,follow),color));
        }
        if (!completed) break;
        value = value*.75+recovery*.25;
        }
      worst = Math.min(worst,value);
      if (worst <= minimax) break;
      }
    }
    if (!completed) break;
    if (worst > minimax) { minimax = worst; tactical = candidate.shot; options.onProgress?.(tactical); }
  }
  return tactical;
}
