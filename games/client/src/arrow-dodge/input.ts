import type { PlayerInput } from "./types";

const held = new Set<string>();
const mapped = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS"]);
window.addEventListener("keydown", event => {
  if (!mapped.has(event.code)) return;
  event.preventDefault(); held.add(event.code);
});
window.addEventListener("keyup", event => { if (mapped.has(event.code)) { event.preventDefault(); held.delete(event.code); } });
window.addEventListener("blur", () => held.clear());
document.addEventListener("visibilitychange", () => { if (document.hidden) held.clear(); });

export function readInput(): PlayerInput {
  const left = held.has("ArrowLeft") || held.has("KeyA"), right = held.has("ArrowRight") || held.has("KeyD");
  const up = held.has("ArrowUp") || held.has("KeyW"), down = held.has("ArrowDown") || held.has("KeyS");
  return { x: left === right ? 0 : left ? -1 : 1, y: up === down ? 0 : up ? -1 : 1 };
}

export function bindTouch(root: HTMLElement) {
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-move]")) {
    const code = button.dataset.move!;
    const down = (event: Event) => { event.preventDefault(); held.add(code); };
    const up = (event: Event) => { event.preventDefault(); held.delete(code); };
    button.addEventListener("pointerdown", down); button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up); button.addEventListener("pointerleave", up);
  }
}
