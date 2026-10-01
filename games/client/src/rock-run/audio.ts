import type { RunState } from '../../../shared/rock-run';
import type { GameAudio } from '../common/audio';

// Reuse volleyball's short arcade tones and shared mute/unlock controls.
export function playRunSounds(audio: GameAudio, before: RunState, after: RunState) {
  if (before.phase !== 'playing' || after.tick <= before.tick) return;
  if (before.grounded && !after.grounded && after.vy < 0)
    audio.play([{ x: after.x, y: after.y, kind: 'jump', side: 'left' }]);
  if (!before.shot && after.shot) audio.playArrowVolley(1);
  if (after.rope && (!before.rope || before.rope.anchor !== after.rope.anchor))
    audio.play([{ x: after.x, y: after.y, kind: 'hit', side: 'left' }]);
  if (after.collected.size > before.collected.size)
    audio.play([{ x: after.x, y: after.y, kind: 'point', side: 'left' }]);
  if (after.phase === 'gameover')
    audio.play([{ x: after.x, y: after.y, kind: 'win', side: after.cleared ? 'left' : 'right' }]);
}
