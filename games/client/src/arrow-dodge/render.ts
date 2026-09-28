import { FIELD_RADIUS, FIELD_X, FIELD_Y, HEIGHT, WIDTH } from "./constants";
import type { GameState } from "./types";
import type { SpriteMap } from "../common/sprites";

const INK = "#303b36", VANILLA = "#f3efdf", ORANGE = "#d18152";
function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, width: number, height: number) {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function background(ctx: CanvasRenderingContext2D) {
  rect(ctx, VANILLA, 0, 0, WIDTH, HEIGHT);
  rect(ctx, "#e7dec0", 852, 94, 45, 45);
  for (const [x, y, width] of [[58, 120, 90], [170, 260, 62], [785, 172, 76], [830, 350, 54]]) {
    rect(ctx, "#d4d7c9", x, y, width, 3); rect(ctx, "#f3efdf", x + 17, y - 10, width - 34, 10);
  }
  for (let index = 0; index < 18; index++) {
    const height = 20 + index * 19 % 60;
    rect(ctx, "#e2e4d6", index * 58, HEIGHT - 120 - height, 61, height);
  }
  for (const x of [45, 895]) {
    rect(ctx, "#aeb8a0", x, HEIGHT - 170, 8, 70); rect(ctx, "#aeb8a0", x - 16, HEIGHT - 145, 16, 8);
    rect(ctx, "#aeb8a0", x + 8, HEIGHT - 135, 18, 8); rect(ctx, "#aeb8a0", x + 20, HEIGHT - 158, 6, 31);
  }
  rect(ctx, "#e9e3cd", 0, HEIGHT - 100, WIDTH, 100); rect(ctx, INK, 0, HEIGHT - 103, WIDTH, 3);
  for (let index = 0; index < 42; index++) rect(ctx, "#b9bca7", (index * 173 + 21) % WIDTH, HEIGHT - 84 + (index * 37) % 70, index % 3 ? 5 : 10, 3);
}

function field(ctx: CanvasRenderingContext2D) {
  ctx.beginPath(); ctx.arc(FIELD_X, FIELD_Y, FIELD_RADIUS + 8, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
  ctx.beginPath(); ctx.arc(FIELD_X, FIELD_Y, FIELD_RADIUS + 4, 0, Math.PI * 2); ctx.fillStyle = "#e6ddc0"; ctx.fill();
  ctx.beginPath(); ctx.arc(FIELD_X, FIELD_Y, FIELD_RADIUS, 0, Math.PI * 2); ctx.fillStyle = VANILLA; ctx.fill();
  ctx.strokeStyle = ORANGE; ctx.lineWidth = 2; ctx.stroke();
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, length: number) {
  const angle = Math.atan2(vy, vx);
  ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(angle);
  ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-length, 0); ctx.lineTo(4, 0); ctx.stroke();
  ctx.strokeStyle = ORANGE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-length, 0); ctx.lineTo(2, 0); ctx.stroke();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(0, -5); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#f2eddb"; ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(1, -2); ctx.lineTo(1, 2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-length + 3, 0); ctx.lineTo(-length - 3, -4); ctx.moveTo(-length + 3, 0); ctx.lineTo(-length - 3, 4); ctx.stroke();
  ctx.restore();
}

function player(ctx: CanvasRenderingContext2D, sprites: SpriteMap, state: GameState) {
  const player = state.player;
  const frame = Math.floor(state.tick / 6) % 2;
  ctx.save(); ctx.translate(Math.round(player.x), Math.round(player.y));
  ctx.scale(player.facing, 1);
  ctx.rotate(player.moveY * player.facing * 0.25);
  ctx.drawImage(sprites[`left/spike/${frame}`], -18, -15, 36, 29);
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, sprites: SpriteMap, state: GameState) {
  ctx.imageSmoothingEnabled = false; background(ctx); field(ctx);
  ctx.save(); ctx.beginPath(); ctx.arc(FIELD_X, FIELD_Y, FIELD_RADIUS - 1, 0, Math.PI * 2); ctx.clip();
  for (const item of state.arrows) arrow(ctx, item.x, item.y, item.vx, item.vy, item.length);
  player(ctx, sprites, state);
  ctx.restore();
  if (state.phase === "countdown") {
    ctx.fillStyle = INK; ctx.font = "bold 72px monospace"; ctx.textAlign = "center";
    ctx.fillText(String(Math.max(1, Math.ceil(state.countdownTicks / 60))), FIELD_X, FIELD_Y + 25);
  }
}
