import { step, type Course, type RunState } from '../../shared/rock-run.js';

export interface SearchOptions {
  allowWire?: boolean;
  maxStates?: number;
  maxDelayTicks?: number;
  maxHoldTicks?: number;
  maxCoastTicks?: number;
  minWireDelayTicks?: number;
  maxAirbornePressY?: number;
}
export type SearchResult =
  | { status: 'found'; actions: boolean[] }
  | { status: 'not-found' }
  | { status: 'inconclusive'; reason: 'state-budget' | 'tick-budget' };

// Bounded input search, shared by the generator and regression tests.
// "not-found" means no route under this strategy, not a proof over all possible button sequences.
export function searchCrossing(initial: RunState, landing: number, original: Course, options: SearchOptions = {}): SearchResult {
  const course = { ...original, coins: [] };
  const platform = course.platforms.find(p => p.x === landing);
  if (!platform) throw new Error(`Missing landing platform at ${landing}`);
  const end = platform.end - 24;
  const maxStates = options.maxStates ?? 100_000;
  const maxDelay = options.maxDelayTicks ?? 100;
  const maxHold = options.maxHoldTicks ?? 120;
  const maxCoast = options.maxCoastTicks ?? 180;
  const wanted = course.anchors.filter(a => a.x > initial.x && a.x < landing).length;
  const visited = new Set<string>();
  let exhausted: 'state-budget' | 'tick-budget' | undefined;
  const stateBudgetExhausted = () => exhausted === 'state-budget';
  const advance = (s: RunState, hit: boolean) => step(s, { hit }, course);
  const landed = (s: RunState) => s.grounded && s.x >= landing - 2 && s.x < end;

  function finish(s: RunState, actions: boolean[]): boolean[] | null {
    for (let tick = 0; tick < maxCoast; tick++) {
      if (landed(s)) return actions;
      if (s.phase === 'gameover' || s.x > end || s.grounded) return null;
      s = advance(s, false); actions = [...actions, false];
    }
    exhausted ??= 'tick-budget';
    return null;
  }

  function fly(s: RunState, actions: boolean[], connections: number, lastAnchor = -1): boolean[] | null {
    if (stateBudgetExhausted()) return null;
    const m = s.motion;
    // Keep exact coordinates, attachment point and held state: each changes subsequent motion.
    const key = JSON.stringify([s.tick, s.motionClock, s.x, m.mode, m.y, m.dy, m.spinGravity,
      m.hook?.x, m.hook?.y, s.held, connections, lastAnchor]);
    if (visited.has(key)) return null;
    if (visited.size >= maxStates) { exhausted = 'state-budget'; return null; }
    visited.add(key);
    const done = finish(s, actions);
    if (done) return done;
    if (connections >= wanted || s.phase === 'gameover') return null;
    let waiting = s, prefix = actions;
    for (let delay = 0; delay < maxDelay; delay++) {
      if (!waiting.held && !waiting.grounded && waiting.y <= (options.maxAirbornePressY ?? Infinity)) {
        let hooked = waiting, sequence = prefix, anchor = -1;
        let stopped = false;
        for (let held = 0; held < maxHold; held++) {
          const before = hooked;
          hooked = advance(hooked, true); sequence = [...sequence, true];
          if (hooked.rope) {
            anchor = hooked.rope.anchor;
            if (anchor <= lastAnchor) { stopped = true; break; }
          }
          if (hooked.phase === 'gameover' || hooked.x > end) { stopped = true; break; }
          const released = anchor >= 0 && before.rope && !hooked.rope;
          if (anchor >= 0 && (released || held % 6 === 0)) {
            const result = fly(advance(hooked, false), [...sequence, false], connections + 1, anchor);
            if (result) return result;
          }
          if (released || (!hooked.rope && !hooked.shot)) { stopped = true; break; }
        }
        if (!stopped) exhausted ??= 'tick-budget';
      }
      waiting = advance(waiting, false); prefix = [...prefix, false];
      if (waiting.phase === 'gameover' || waiting.grounded || waiting.x > landing) return null;
      if (stateBudgetExhausted()) return null;
    }
    exhausted ??= 'tick-budget';
    return null;
  }

  const jumped = advance(initial, true);
  let released = advance(jumped, false);
  const prefix=[true,false];
  for(let tick=0;tick<(options.minWireDelayTicks??0);tick++) {
    released=advance(released,false);prefix.push(false);
    if(released.phase==='gameover'||released.grounded)return {status:'not-found'};
  }
  const actions = options.allowWire === false ? finish(released, prefix) : fly(released, prefix, 0);
  if (actions) return { status: 'found', actions };
  return exhausted ? { status: 'inconclusive', reason: exhausted } : { status: 'not-found' };
}
