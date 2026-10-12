/** Deterministic grid rules, shared by authoritative server and client prediction. */
export const WIDTH = 13, HEIGHT = 11, TICK_RATE = 60;
export const MOVE_TICKS = 7 / (0.75 * 0.9), FUSE_TICKS = 120, FLAME_TICKS = 18, GHOST_TICKS = 300;
export const COUNTDOWN_TICKS = 180, ROUND_TICKS = 7200, ITEM_INTERVAL = 60, MAX_ITEMS = 8;
export const INITIAL_RANGE = 2, MAX_BOMBS = 5, MAX_RANGE = 6;
export const LEVELS = ["easy", "normal", "hard", "extreme"] as const;
export type Level = typeof LEVELS[number];
export const LEVEL_LABELS: Record<Level, string> = { easy: "쉬움", normal: "보통", hard: "어려움", extreme: "극한" };
export const COLORS = ["#d18152", "#668eac", "#719261", "#ae82a8"];
export interface Seat { userId: string | null; name: string; bot?: Level }
export type Direction = 0 | 1 | 2 | 3 | 4;
export const DELTAS = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]] as const;
// Movement uses a small body (36% of a tile); blast hits still use playerCell.
export const MOVE_SPEED = 1 / MOVE_TICKS, PLAYER_RADIUS = .18;
export interface Input { direction: Direction; bomb: boolean; bombSeq?: number; turn?: Direction; target?: { x: number; y: number } }
export const IDLE: Input = { direction: 0, bomb: false };
export interface Player { target?: { x: number; y: number }; x: number; y: number; fromX: number; fromY: number; movedAt: number; nextMove: number; direction: Direction; alive: boolean; eliminatedAt: number | null; capacity: number; range: number }
export interface Bomb { id: number; owner: number; x: number; y: number; range: number; explodesAt: number; pass: number[]; inputSeq?: number }
export interface Flame { at: number; until: number }
export interface Item { at: number; kind: "bomb" | "range" }
export interface State { tick: number; phase: "countdown" | "playing" | "finished"; board: number[]; tiles: number[]; rocks: { x: number; y: number; size: number }[]; players: Player[]; bombs: Bomb[]; flames: Flame[]; items: Item[]; rng: number; nextBomb: number; pattern: number; winner: number | null; finishReason: "survivor" | "draw" | "timeout" | null; events: { kind: "bomb" | "blast" | "pickup" | "ko" | "win"; seat?: number }[] }
export const cell = (x: number, y: number) => y * WIDTH + x;
export const playerCell = (p: { x: number; y: number }) => cell(Math.floor(p.x + .5), Math.floor(p.y + .5));
export const ghost = (s: State, p: Player) => p.eliminatedAt !== null && s.tick - p.eliminatedAt >= GHOST_TICKS;
export function copy(s: State): State { return { ...s, board: [...s.board], players: s.players.map(p => ({ ...p })), bombs: s.bombs.map(b => ({ ...b, pass: [...b.pass] })), flames: s.flames.map(f => ({ ...f })), items: s.items.map(i => ({ ...i })), events: [] }; }
function random(s: State) { let n = s.rng; n ^= n << 13; n ^= n >>> 17; n ^= n << 5; s.rng = n >>> 0; return s.rng / 4294967296; }
export function createGame(count: number, seed: number, pattern = Math.abs(seed) % 4): State {
  if (!Number.isInteger(count) || count < 2 || count > 4) throw new Error("2~4명의 참가자가 필요합니다.");
  const board = Array<number>(WIDTH * HEIGHT).fill(0);
  // Seeded, mirrored obstacles preserve equal starts and connected corridors.
  let rng = (seed >>> 0) || 1;
  const rand = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const corners = [[1, 1], [WIDTH - 2, HEIGHT - 2], [WIDTH - 2, 1], [1, HEIGHT - 2]];
  const reserved = (x: number, y: number) => corners.some(([cx, cy]) => Math.abs(cx - x) <= 2 && Math.abs(cy - y) <= 2);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++)
    if (!x || !y || x === WIDTH - 1 || y === HEIGHT - 1) board[cell(x, y)] = 1;
  const rocks: State['rocks'] = [];
  const place = (x: number, y: number, size: number) => {
    const anchors = [...new Set([cell(x,y), cell(WIDTH-x-size,y), cell(x,HEIGHT-y-size), cell(WIDTH-x-size,HEIGHT-y-size)])];
    const cells = new Set<number>();
    for (const anchor of anchors) for (let dy=0;dy<size;dy++) for(let dx=0;dx<size;dx++) {
      const px=anchor%WIDTH+dx, py=Math.floor(anchor/WIDTH)+dy, at=cell(px,py);
      if (board[at] !== 0 || reserved(px,py) || cells.has(at)) return;
      cells.add(at);
    }
    for (const at of cells) board[at]=1;
    const seen=new Set<number>([cell(1,1)]), queue=[cell(1,1)];
    for(let i=0;i<queue.length;i++) for(const delta of [-WIDTH,1,WIDTH,-1]) {
      const at=queue[i]+delta;
      if(board[at]===0 && !seen.has(at)){seen.add(at);queue.push(at);}
    }
    if(seen.size !== board.filter(v=>v===0).length) { for(const at of cells) board[at]=0; return; }
    for(const anchor of anchors) rocks.push({x:anchor%WIDTH,y:Math.floor(anchor/WIDTH),size});
  };
  if(rand()<.4) place(4, 1+Math.floor(rand()*4), 2);
  for(let attempt=0;attempt<60 && board.filter(v=>v===1).length<66;attempt++)
    place(1+Math.floor(rand()*6),1+Math.floor(rand()*5),1);
  for(let y=1;y<=5;y++) for(let x=1;x<=6;x++) {
    if(board[cell(x,y)] || reserved(x,y) || rand() > .45 + (pattern%4)*.05) continue;
    for(const px of [x,WIDTH-1-x]) for(const py of [y,HEIGHT-1-y]) board[cell(px,py)]=2;
  }
  const tiles=board.map(()=>Math.floor(rand()*4));
  return { tick: 0, phase: "countdown", board, tiles, rocks, players: corners.slice(0, count).map(([x, y]) => ({ x, y, fromX: x, fromY: y, movedAt: -MOVE_TICKS, nextMove: 0, direction: 3, alive: true, eliminatedAt: null, capacity: 1, range: INITIAL_RANGE })), bombs: [], flames: [], items: [], rng: (seed >>> 0) || 1, nextBomb: 1, pattern, winner: null, finishReason: null, events: [] };
}
export function canMove(s: State, seat: number, x: number, y: number) {
  if (x < 1 || y < 1 || x >= WIDTH - 1 || y >= HEIGHT - 1) return false;
  if (ghost(s, s.players[seat])) return true;
  return s.board[cell(x, y)] === 0 && !s.bombs.some(b => b.x === x && b.y === y && !b.pass.includes(seat));
}
/** Character footprint against tile obstacles; coordinates are tile-centre units. */
export function canOccupy(s: State, seat: number, x: number, y: number) {
  const r = PLAYER_RADIUS;
  if (x-r < .5 || y-r < .5 || x+r > WIDTH-1.5 || y+r > HEIGHT-1.5) return false;
  if (ghost(s,s.players[seat])) return true;
  for(let ty=Math.floor(y-r+.5+1e-9);ty<=Math.floor(y+r+.5-1e-9);ty++)
    for(let tx=Math.floor(x-r+.5+1e-9);tx<=Math.floor(x+r+.5-1e-9);tx++)
      if(!canMove(s,seat,tx,ty)) return false;
  return true;
}
export function movePlayer(s: State, seat: number, input: Input) {
  const p=s.players[seat]; p.fromX=p.x; p.fromY=p.y;
  const direction=input.direction || input.turn || 0;
  if(!direction) return;
  p.direction=direction;
  if(input.target) p.target={...input.target};
  const [dx,dy]=DELTAS[direction];
  let distance=MOVE_SPEED;
  if(input.target) distance=Math.min(distance,Math.abs(dx ? input.target.x-p.x : input.target.y-p.y));
  let lo=0,hi=distance;
  if(canOccupy(s,seat,p.x+dx*distance,p.y+dy*distance)) lo=distance;
  else for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(canOccupy(s,seat,p.x+dx*mid,p.y+dy*mid))lo=mid;else hi=mid;}
  p.x+=dx*lo;p.y+=dy*lo;p.movedAt=s.tick;
  for(const b of s.bombs) if(Math.abs(p.x-b.x)>=.5+PLAYER_RADIUS || Math.abs(p.y-b.y)>=.5+PLAYER_RADIUS)
    b.pass=b.pass.filter(i=>i!==seat);
}
export function install(s: State, seat: number, inputSeq?: number) {
  const p = s.players[seat], x=Math.floor(p.x+.5), y=Math.floor(p.y+.5);
  if (!p.alive || s.bombs.filter(b => b.owner === seat).length >= p.capacity || s.bombs.some(b => b.x === x && b.y === y)) return false;
  s.bombs.push({ id: s.nextBomb++, owner: seat, x, y, range: p.range, explodesAt: s.tick + FUSE_TICKS, pass: s.players.flatMap((q, i) => q.alive && Math.abs(q.x-x)<.5+PLAYER_RADIUS && Math.abs(q.y-y)<.5+PLAYER_RADIUS ? [i] : []), inputSeq });
  s.events.push({ kind: "bomb", seat }); return true;
}
/** All rays in this tick see the same walls. Bombs stop a ray and trigger a chain. */
export function explode(s: State) {
  s.flames = s.flames.filter(f => f.until > s.tick);
  const queue = s.bombs.filter(b => b.explodesAt <= s.tick || s.flames.some(f => f.at === cell(b.x, b.y)));
  const exploded = new Set<number>(), hits = new Set<number>();
  for (let i = 0; i < queue.length; i++) {
    const b = queue[i]; if (exploded.has(b.id)) continue; exploded.add(b.id); hits.add(cell(b.x, b.y));
    for (const [dx, dy] of DELTAS.slice(1)) for (let distance = 1; distance <= b.range; distance++) {
      const x = b.x + dx * distance, y = b.y + dy * distance;
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) break;
      const at = cell(x, y); if (s.board[at] === 1) break;
      hits.add(at); if (s.board[at] === 2) break;
      const other = s.bombs.find(q => q.x === x && q.y === y);
      if (other) { queue.push(other); break; }
    }
  }
  if (exploded.size) {
    s.events.push({ kind: "blast" }); s.bombs = s.bombs.filter(b => !exploded.has(b.id));
    for (const at of hits) { if (s.board[at] === 2) s.board[at] = 0; const existing = s.flames.find(f => f.at === at); if (existing) existing.until = s.tick + FLAME_TICKS; else s.flames.push({ at, until: s.tick + FLAME_TICKS }); }
  }
  s.items = s.items.filter(i => !s.flames.some(f => f.at === i.at));
}
export function step(source: State, inputs: readonly Input[], spawning = true): State {
  const s = copy(source); s.tick++;
  if (s.phase === "countdown") { if (s.tick >= COUNTDOWN_TICKS) s.phase = "playing"; return s; }
  for (let seat = 0; seat < s.players.length; seat++) {
    const p = s.players[seat], input = inputs[seat] ?? IDLE;
    if (!p.alive && !ghost(s, p)) continue;
    if (s.phase === "finished" && p.alive) continue;
    if (s.phase === "playing" && input.bomb) install(s, seat, input.bombSeq);
    movePlayer(s, seat, input);
  }
  if (s.phase === "finished") { s.flames = s.flames.filter(f => f.until > s.tick); return s; }
  explode(s);
  for (let seat = 0; seat < s.players.length; seat++) {
    const p = s.players[seat]; if (!p.alive) continue;
    if (s.flames.some(f => f.at === playerCell(p))) { p.alive = false; p.eliminatedAt = s.tick; s.events.push({ kind: "ko", seat }); }
  }
  const alive = s.players.flatMap((p, i) => p.alive ? [i] : []);
  if (alive.length <= 1 || s.tick >= COUNTDOWN_TICKS + ROUND_TICKS) {
    s.phase = "finished"; s.winner = alive.length === 1 ? alive[0] : null; s.finishReason = alive.length > 1 ? "timeout" : alive.length === 0 ? "draw" : "survivor"; s.events.push({ kind: "win", seat: s.winner ?? undefined });
  }
  for (const p of s.players) if (p.alive) {
    const at = playerCell(p), item = s.items.find(i => i.at === at);
    if (item) { if (item.kind === "bomb") p.capacity = Math.min(MAX_BOMBS, p.capacity + 1); else p.range = Math.min(MAX_RANGE, p.range + 1); s.items = s.items.filter(i => i !== item); s.events.push({ kind: "pickup" }); }
  }
  if (spawning && s.phase === "playing" && (s.tick - COUNTDOWN_TICKS) % ITEM_INTERVAL === 0 && s.items.length < MAX_ITEMS) {
    const free = s.board.flatMap((wall, at) => wall === 0 && !s.bombs.some(b => cell(b.x, b.y) === at) && !s.flames.some(f => f.at === at) && !s.items.some(i => i.at === at) && !s.players.some(p => playerCell(p) === at) ? [at] : []);
    if (free.length) s.items.push({ at: free[Math.floor(random(s) * free.length)], kind: random(s) < .5 ? "bomb" : "range" });
  }
  return s;
}

/** Pairwise point transfers, with the same mixed-room principle as Rummikub. */
export function settledScores(winner: number | null, seats: Seat[]): number[] {
  const scores=seats.map(()=>0);if(winner===null)return scores;
  const value=(seat: Seat)=>seat.bot ? ({easy:5,normal:10,hard:15,extreme:20}[seat.bot]) : 20;
  seats.forEach((seat,i)=>{if(i!==winner){const points=Math.min(value(seat),value(seats[winner]));scores[i]=-points;scores[winner]+=points;}});
  return scores;
}
