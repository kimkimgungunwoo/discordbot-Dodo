import type { Stone } from './omok.js';
import { isLegalMove } from './renju.js';
import { linePatterns } from './omok-patterns.js';

/** Candidate defenses, not a claim that occupying any one point is sufficient.
 * Inspect the opponent's projected threats and keep their connection points,
 * including moves whose own attack/defense score would otherwise be small. */
export function defenseTargets(
  board: Stone[], defender: 1 | 2,
  threats: readonly { at: number; attack: number }[], minimum: number,
  until: number,
): Set<number> {
  const attacker = defender === 1 ? 2 : 1;
  const targets = new Set<number>();
  const add = (at: number) => {
    if (isLegalMove(board, at, defender)) targets.add(at);
  };
  for (const threat of threats) {
    if (performance.now() >= until) break;
    if (threat.attack < minimum || !isLegalMove(board, threat.at, attacker)) continue;
    const projected = new Set<number>([threat.at]);
    board[threat.at] = attacker;
    try {
      for (const pattern of linePatterns(board, threat.at, attacker)) {
        if (pattern.kind === 'closed-three') continue;
        pattern.completions.forEach(at => projected.add(at));
        const [first, second] = pattern.stones;
        const dx = Math.sign(second % 15 - first % 15);
        const dy = Math.sign(Math.floor(second / 15) - Math.floor(first / 15));
        // Endpoints and gaps can disable a future open four without occupying
        // the opponent's preferred starting square.
        for (const stone of pattern.stones) for (const offset of [-2, -1, 1, 2]) {
          const x = stone % 15 + dx * offset, y = Math.floor(stone / 15) + dy * offset;
          if (x >= 0 && x < 15 && y >= 0 && y < 15 && !board[y * 15 + x]) projected.add(y * 15 + x);
        }
      }
    } finally { board[threat.at] = 0; }
    // Black's defense legality must be checked on the original position.
    projected.forEach(add);
  }
  return targets;
}
