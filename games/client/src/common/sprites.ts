import type { PlayerState } from "../volleyball/types";

export type SpriteMap = Record<string, HTMLCanvasElement>;
const INK = "#303b36";
function sprite(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return canvas;
}
function bird(state: PlayerState, frame: number, accent: string) {
  return sprite(40, 32, ctx => {
    const rect = (color: string, left: number, top: number, width: number, height: number) => {
      ctx.fillStyle = color; ctx.fillRect(left, top, width, height);
    };
    const low = state === "dive" || (state === "lying" && frame === 0);
    const bob = state === "idle" || state === "run" || state === "win" ? frame : 0;
    ctx.save();
    ctx.translate(0, -bob);
    if (low) {
      rect(INK, 3, 20, 24, 9); rect(INK, 23, 16, 9, 12);
      rect("#829084", 5, 21, 20, 6); rect("#f2eddb", 25, 18, 6, 7);
      rect(INK, 30, 21, 9, 5); rect("#d8af65", 31, 22, 7, 2);
      rect(INK, 28, 19, 2, 2); rect(accent, 22, 25, 6, 2);
      rect(INK, 0, 23, 4, 3); rect(INK, 9, 29, 8, 2);
    } else {
      rect(INK, 10, 13, 17, 15); rect(INK, 7, 17, 22, 8);
      rect("#829084", 11, 14, 14, 12); rect("#829084", 9, 18, 17, 6);
      rect("#b5bcaa", 16, 20, 9, 6);
      rect(INK, 19, 4, 10, 14); rect(INK, 17, 7, 14, 8);
      rect("#f2eddb", 20, 6, 8, 11); rect("#f2eddb", 19, 8, 11, 6);
      rect(INK, 27, 11, 10, 7); rect(INK, 34, 14, 4, 6);
      rect("#d8af65", 28, 12, 8, 4); rect("#d8af65", 35, 15, 2, 3);
      rect(INK, 25, state === "lose" ? 10 : 8, 2, state === "lose" ? 1 : 3);
      rect(INK, 19, 2, 3, 4); rect(INK, 22, 3, 3, 2);
      rect(accent, 18, 16, 11, 3); rect(accent, 16, 18, 4, 5);
      rect(INK, 4, 14, 5, 3); rect(INK, 6, 17, 5, 3);
      const raised = state === "spike" || state === "hit" || state === "win";
      if (raised) {
        rect(INK, 10, 7 + frame * 2, 4, 13); rect("#b5bcaa", 11, 8 + frame * 2, 2, 10);
      } else {
        rect(INK, 11, 18, 9, 4); rect("#657367", 12, 18, 6, 3);
      }
      const airborne = state === "jump" || state === "fall" || state === "spike";
      const stride = state === "run" ? (frame ? 3 : -3) : 0;
      rect(INK, 13 + stride, 27, 3, airborne ? 2 : 4);
      rect(INK, 22 - stride, 27, 3, airborne ? 2 : 4);
      rect(INK, 13 + stride, airborne ? 28 : 30 + bob, 6, 2);
      rect(INK, 22 - stride, airborne ? 28 : 30 + bob, 6, 2);
    }
    ctx.restore();
  });
}
export function loadSprites(): SpriteMap {
  const sprites: SpriteMap = {};
  const states: PlayerState[] = ["idle", "run", "jump", "fall", "hit", "spike", "dive", "lying", "win", "lose"];
  for (const side of ["left", "right"]) for (const state of states) for (let frame = 0; frame < 2; frame++) {
    sprites[side + "/" + state + "/" + frame] = bird(state, frame, side === "left" ? "#d18152" : "#668eac");
  }
  for (let frame = 0; frame < 4; frame++) {
    sprites["ball/" + frame] = sprite(12, 12, ctx => {
      const rows = ["....####....", "..########..", ".##########.", ".##########.", "############", "############", "############", "############", ".##########.", ".##########.", "..########..", "....####...."];
      rows.forEach((row, top) => [...row].forEach((pixel, left) => {
        if (pixel !== "#") return;
        const border = !rows[top - 1]?.[left] || rows[top - 1]?.[left] === "." || !rows[top + 1]?.[left] || rows[top + 1]?.[left] === "." || row[left - 1] !== "#" || row[left + 1] !== "#";
        ctx.fillStyle = border ? INK : (left + top + frame * 2) % 7 < 2 ? "#d18152" : "#f9f5e6";
        ctx.fillRect(left, top, 1, 1);
      }));
    });
  }
  return sprites;
}
