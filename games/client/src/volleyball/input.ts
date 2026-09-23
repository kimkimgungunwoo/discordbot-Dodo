import type { PlayerInput } from "./types";

const pressed = new Set<string>();
const GAME_KEYS = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyA", "KeyD", "KeyW", "KeyS", "KeyZ", "KeyJ",
]);

window.addEventListener("keydown", (e) => {
  if (GAME_KEYS.has(e.code)) e.preventDefault(); // 페이지 스크롤이 방향키/스페이스를 가져가는 것 방지
  pressed.add(e.code);
});
window.addEventListener("keyup", (e) => pressed.delete(e.code));

export function clearInput() { pressed.clear(); }
window.addEventListener("blur", clearInput);
document.addEventListener("visibilitychange", () => { if (document.hidden) clearInput(); });

export function bindTouchControls(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>("[data-key]").forEach(button => {
    const key = button.dataset.key!;
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pressed.add(key);
    });
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(eventName, () => pressed.delete(key));
    }
  });
}

export function readKeyboardInput(): PlayerInput {
  const left = pressed.has("ArrowLeft") || pressed.has("KeyA");
  const right = pressed.has("ArrowRight") || pressed.has("KeyD");
  const up = pressed.has("ArrowUp") || pressed.has("KeyW");
  const down = pressed.has("ArrowDown") || pressed.has("KeyS");
  const jump = up || pressed.has("Space");
  const hit = pressed.has("KeyZ") || pressed.has("KeyJ");

  let x: PlayerInput["x"] = 0;
  if (left && !right) x = -1;
  else if (right && !left) x = 1;

  return { x, y: up === down ? 0 : up ? -1 : 1, jump, hit };
}
