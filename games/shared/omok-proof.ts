import type { Stone } from './omok.js';
import { isLegalMove } from './renju.js';
import { IncrementalThreats, WIN_SCORE } from './omok-incremental.js';

export interface ProofResult { status: 'proven' | 'unknown'; move: number | null; nodes: number }

/** AND/OR proof. All legal VCT defenses are checked, strongest replies first.
 * Geometry only orders attacks; only legal immediate wins certify a leaf.
 * Exhausted depth/time is unknown and must never be used to reject a move. */
export function proveThreat(board: Stone[], attacker: 1 | 2, mode: 'VCF' | 'VCT', deadline: number, depth = 12): ProofResult {
  const expired = Symbol('proof deadline'), defender = attacker === 1 ? 2 : 1;
  const geometry = new IncrementalThreats(board), memo = new Map<string, number>();
  let nodes = 0;
  function check() { nodes++; if (performance.now() >= deadline) throw expired; }
  function play<T>(at: number, side: 1 | 2, action: () => T): T {
    board[at] = side; geometry.update(at, 0, side);
    try { return action(); } finally { board[at] = 0; geometry.update(at, side, 0); }
  }
  function wins(side: 1 | 2): number[] {
    const result: number[] = [];
    for (const at of geometry.candidates()) {
      check();
      if (geometry.scores(at)[side - 1] >= WIN_SCORE && isLegalMove(board, at, side)) result.push(at);
    }
    return result;
  }
  function solve(left: number): number | null {
    check();
    if (left <= 0) return null;
    const key = board.join(''), known = memo.get(key);
    if (known !== undefined) return known;
    const immediate = wins(attacker);
    if (immediate.length) return immediate[0];
    const danger = wins(defender);
    if (danger.length > 1) return null;
    const attacks: { at: number; rank: number }[] = [];
    for (const at of geometry.candidates()) {
      check();
      if (danger.length && at !== danger[0]) continue;
      const score = geometry.scores(at)[attacker - 1];
      if (score >= (mode === 'VCF' ? 15000 : 8000) && isLegalMove(board, at, attacker)) attacks.push({ at, rank: score });
    }
    attacks.sort((a, b) => b.rank - a.rank);
    for (const { at } of attacks) {
      const proven = play(at, attacker, () => {
        if (wins(defender).length) return false;
        const threats = wins(attacker);
        if (threats.length > 1) return defender === 2 || board.some((_, cell) => isLegalMove(board, cell, defender));
        if (!threats.length && mode === 'VCF') return false;
        // A VCT defense can be a counterattack anywhere, including outside
        // the ordinary candidate radius. Do not discard distant legal moves.
        const replies = threats.length ? threats : board.flatMap((s, i) => s ? [] : [i]);
        if (!threats.length) replies.sort((a, b) => {
          const av = geometry.scores(a), bv = geometry.scores(b);
          return bv[defender - 1] + bv[attacker - 1] - av[defender - 1] - av[attacker - 1];
        });
        let legal = 0;
        for (const reply of replies) {
          check();
          if (!isLegalMove(board, reply, defender)) continue;
          legal++;
          if (!play(reply, defender, () => solve(left - 2) !== null)) return false;
        }
        return legal > 0 || (threats.length > 0 && board.some((_, cell) => isLegalMove(board, cell, defender)));
      });
      if (proven) {
        if (memo.size >= 4096) memo.clear();
        memo.set(key, at); return at;
      }
    }
    return null;
  }
  try {
    for (let limit = Math.min(4, depth); limit <= depth; limit += 2) {
      const move = solve(limit);
      if (move !== null) return { status: 'proven', move, nodes };
    }
    return { status: 'unknown', move: null, nodes };
  } catch (error) {
    if (error !== expired) throw error;
    return { status: 'unknown', move: null, nodes };
  }
}
