import { REFERENCE as R } from '../../../shared/rock-run-reference';
import { PILLAR_TOP, courseFor, endlessCourseFor, type RunState } from '../../../shared/rock-run';
import { MOTION, TICK_RATE } from '../../../shared/rock-run-config';
import type { SpriteMap } from '../common/sprites';
import { render as volleyRender } from '../volleyball/render';
import { createInitialState as volleyState } from '../volleyball/physics';

// Capture only the existing volleyball sky; the character uses its original sprite map.
export function makeSky(sprites: SpriteMap) {
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 480;
  const ctx = canvas.getContext('2d')!;
  volleyRender(ctx, sprites, volleyState(1), true);
  return canvas;
}
export function render(ctx: CanvasRenderingContext2D, sprites: SpriteMap, sky: HTMLCanvasElement, s: RunState) {
  const COURSE = s.mode === 'endless' ? endlessCourseFor(s.seed,s.x) : courseFor(s.seed);
  const viewWidth = ctx.canvas.width;
  const ink = '#303b36', camera = s.x - R.playerX;
  const rect = (color: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  ctx.imageSmoothingEnabled = false;
  rect('#f3efdf', 0, 0, viewWidth, R.height);
  // Original sky / sun / clouds are above the volleyball net and players.
  ctx.drawImage(sky, 0, 0, 960, 180, 0, 0, viewWidth, 180);
  function rock(x: number, y: number, w: number) {
    x -= camera; if (x > viewWidth + 40 || x + w < -40) return;
    rect(ink, x, y, w, 480 - y); rect('#c8b48b', x + 3, y + 3, w - 6, 480 - y);
    rect('#e7dec0', x + 3, y + 3, w - 6, 9); rect('#ab9676', x + w - 12, y + 12, 9, 480 - y);
    for (let yy = y + 30, n = 0; yy < 480; yy += 30, n++) { rect('#b5a27f', x + 3, yy, w - 15, 3); rect('#a18e70', x + 12 + n % 3 * 6, yy + 3, 3, 12); }
  }
  COURSE.anchors.forEach(a => {
    rock(a.x-a.width/2,PILLAR_TOP,a.width);
  });
  COURSE.platforms.forEach(p => rock(p.x,p.y,p.end-p.x));
  COURSE.coins.forEach((c, i) => {
    const x = c.x - camera; if (s.collected.has(i) || x < -10 || x > viewWidth + 10) return;
    const gold = c.kind === 'gold';
    rect(ink, x - 5, c.y - 7, 10, 14);
    rect(ink, x - 7, c.y - 4, 14, 8);
    rect(gold ? '#ecb83f' : '#b5bcaa', x - 4, c.y - 5, 8, 10);
    rect(gold ? '#ecb83f' : '#b5bcaa', x - 5, c.y - 3, 10, 6);
    rect(gold ? '#fff0a0' : '#f2eddb', x - 3, c.y - 4, 2, 5);
    rect(gold ? '#a36b28' : '#788275', x, c.y - 2, 2, 5);
  });
  const rotation = s.rope
    ? Math.atan2(s.rope.y-(s.y+R.body.y),s.rope.x-(s.x+R.body.x))+MOTION.bodyAngleOffset*Math.PI/180
    : 0;
  // Dive sprite's chest: original pixel (23,26), scaled 2x with drawing origin (-40,-64).
  // The wire and sprite share the exact same rotation about the feet.
  const attachment = { x: R.playerX+6*Math.cos(rotation)+12*Math.sin(rotation),
    y: s.y+6*Math.sin(rotation)-12*Math.cos(rotation) };
  if (s.rope) {
    const a = s.rope;
    ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.x - camera, a.y); ctx.lineTo(attachment.x,attachment.y); ctx.stroke();
    ctx.strokeStyle = '#d8af65'; ctx.lineWidth = 1; ctx.stroke();
  } else if (s.shot) {
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(attachment.x,attachment.y); ctx.lineTo(s.shot.x - camera, s.shot.y); ctx.stroke();
    rect('#d18152', s.shot.x - camera - 3, s.shot.y - 3, 6, 6);
  }
  const pose = s.grounded ? 'run' : 'dive';
  const frame = s.grounded ? Math.floor(s.tick / 5) % 2 : 0;
  ctx.save();
  ctx.translate(R.playerX,s.y);
  if(s.rope)ctx.rotate(rotation);
  ctx.drawImage(sprites[`left/${pose}/${frame}`],-40,-64,80,64);
  ctx.restore();
  if (s.phase === 'countdown' || s.phase === 'transition') {
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.font = 'bold 28px monospace';
    ctx.fillText(s.phase === 'countdown' ? String(Math.ceil(s.countdown / TICK_RATE)) : `STAGE ${s.stage + 1}`, viewWidth/2, 230);
  }
}
