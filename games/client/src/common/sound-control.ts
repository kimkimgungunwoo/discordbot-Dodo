import { GameAudio } from "./audio";

export function bindSoundControl(audio: GameAudio, button: HTMLButtonElement) {
  function update() {
    button.textContent = audio.muted ? "소리 꺼짐 ♩" : audio.active ? "소리 켜짐 ♪" : "소리 켜기 ♪";
    button.setAttribute("aria-pressed", String(audio.muted));
    button.title = !audio.muted && !audio.active ? "한 번 눌러 경기 소리를 켜세요" : "게임 소리 설정";
  }
  async function unlock() { await audio.unlock(); update(); }
  button.addEventListener("click", () => {
    audio.muted = audio.active ? !audio.muted : false;
    if (!audio.muted) void unlock();
    update();
  });
  // Browsers require a gesture even for spectators, who never press Start.
  const activate = (event: Event) => {
    if (event.target === button || button.contains(event.target as Node)) return;
    if (!audio.muted && !audio.active) void unlock();
  };
  window.addEventListener("pointerdown", activate);
  window.addEventListener("keydown", activate);
  update();
}
