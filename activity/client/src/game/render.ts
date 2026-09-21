import { BALL_RADIUS, COURT_HEIGHT, COURT_WIDTH, GROUND_Y, NET_HALF_WIDTH, NET_TOP_Y, NET_X } from "./constants";
import type { GameState, Player } from "./types";
import type { SpriteMap } from "./sprites";

const INK = "#303b36";
function rect(ctx: CanvasRenderingContext2D, color: string, left: number, top: number, width: number, height: number) {
  ctx.fillStyle = color; ctx.fillRect(Math.round(left), Math.round(top), width, height);
}
function label(ctx: CanvasRenderingContext2D, text: string, left: number, top: number, size = 18, color = INK) {
  ctx.fillStyle = color; ctx.font = "bold " + size + "px monospace"; ctx.textAlign = "center"; ctx.fillText(text, left, top);
}
function background(ctx: CanvasRenderingContext2D) {
  rect(ctx, "#f3efdf", 0, 0, COURT_WIDTH, COURT_HEIGHT);
  rect(ctx, "#e7dec0", 755, 86, 54, 54); rect(ctx, "#f3efdf", 749, 80, 12, 12);
  for (const [left, top, width] of [[88, 122, 90], [371, 80, 66], [610, 155, 102]]) {
    rect(ctx, "#d4d7c9", left, top, width, 3);
    rect(ctx, "#d4d7c9", left + 18, top - 12, width - 39, 12);
    rect(ctx, "#f3efdf", left + 21, top - 9, width - 45, 9);
  }
  for (let index = 0; index < 18; index++) {
    const height = 12 + (index * 17) % 45;
    rect(ctx, "#e2e4d6", index * 60, GROUND_Y - height, 63, height);
  }
  for (const left of [60, 854]) {
    rect(ctx, "#aeb8a0", left, 330, 9, 66);
    rect(ctx, "#aeb8a0", left - 15, 351, 15, 9);
    rect(ctx, "#aeb8a0", left - 15, 339, 6, 18);
    rect(ctx, "#aeb8a0", left + 9, 366, 18, 9);
    rect(ctx, "#aeb8a0", left + 21, 345, 6, 27);
  }
  rect(ctx, INK, 0, GROUND_Y, COURT_WIDTH, 3);
  rect(ctx, "#e9e3cd", 0, GROUND_Y + 3, COURT_WIDTH, COURT_HEIGHT - GROUND_Y - 3);
  for (let index = 0; index < 55; index++) {
    rect(ctx, "#b9bca7", (index * 173 + 21) % 950, GROUND_Y + 12 + (index * 37) % 63, index % 3 ? 6 : 12, 3);
  }
}
function player(ctx: CanvasRenderingContext2D, sprites: SpriteMap, subject: Player) {
  const shadowWidth = Math.max(18, 54 + subject.y * 0.17);
  rect(ctx, "#c5c6ae", subject.x - shadowWidth / 2, GROUND_Y - 3, shadowWidth, 3);
  const frame = subject.state === "lying" ? Number(subject.ticksInState >= 12) : Math.floor(subject.ticksInState / (subject.state === "run" ? 5 : 10)) % 2;
  const key = (subject.isRight ? "right" : "left") + "/" + subject.state + "/" + frame;
  ctx.save();
  ctx.translate(Math.round(subject.x), Math.round(GROUND_Y + subject.y));
  ctx.scale(subject.facing, 1);
  ctx.drawImage(sprites[key], -60, -96, 120, 96);
  ctx.restore();
}
export function render(ctx: CanvasRenderingContext2D, sprites: SpriteMap, state: GameState, preview = false) {
  ctx.imageSmoothingEnabled = false;
  background(ctx);
  rect(ctx, INK, NET_X - NET_HALF_WIDTH, NET_TOP_Y, NET_HALF_WIDTH * 2, GROUND_Y - NET_TOP_Y);
  rect(ctx, "#e6ddc0", NET_X - 3, NET_TOP_Y + 9, 3, GROUND_Y - NET_TOP_Y - 9);
  rect(ctx, "#d18152", NET_X - 9, NET_TOP_Y, 18, 9);
  for (let top = NET_TOP_Y + 24; top < GROUND_Y; top += 18) rect(ctx, "#8b9785", NET_X + 3, top, 3, 3);
  player(ctx, sprites, state.left); player(ctx, sprites, state.right);
  if (!preview) {
    if (state.ball.powerTicks > 0) state.trail.forEach((point, index) => {
      ctx.globalAlpha = (1 - index / 7) * 0.45;
      const size = 21 - index * 2;
      rect(ctx, "#d18152", point.x - size / 2, GROUND_Y + point.y - size / 2, size, size);
    });
    ctx.globalAlpha = 1;
    ctx.drawImage(sprites["ball/" + Math.floor(state.tick / 4) % 4], Math.round(state.ball.x - BALL_RADIUS), Math.round(GROUND_Y + state.ball.y - BALL_RADIUS), BALL_RADIUS * 2, BALL_RADIUS * 2);
    for (const effect of state.effects) {
      ctx.globalAlpha = 1 - effect.age / 19;
      for (let ray = 0; ray < 8; ray++) {
        const angle = ray * Math.PI / 4;
        const radius = 12 + effect.age * (effect.kind === "spike" ? 3 : 2);
        rect(ctx, effect.kind === "spike" ? "#c56d44" : INK, effect.x + Math.cos(angle) * radius - 3, GROUND_Y + effect.y + Math.sin(angle) * radius - 3, 6, 6);
      }
    }
    ctx.globalAlpha = 1;
    if (state.phase === "countdown") {
      label(ctx, String(Math.ceil(state.phaseTicks / 60)), 480, 198, 66);
    }
    if (state.phase === "point") label(ctx, state.server === "right" ? "1P POINT!" : "CPU POINT!", 480, 160, 30);
  }
}
