import type { GameEvent } from "../volleyball/types";

export class GameAudio {
  private context: AudioContext | null = null;
  muted = false;
  get active() { return this.context?.state === "running"; }
  async unlock() {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") await this.context.resume();
    } catch { this.context = null; }
  }
  play(events: GameEvent[]) {
    if (this.muted || !this.context || this.context.state !== "running") return;
    for (const event of events) {
      const notes = event.kind === "win" ? (event.side === "left" ? [523, 659, 784, 1047] : [392, 330, 262, 196])
        : event.kind === "point" ? [440, 660] : event.kind === "jump" ? [240, 420]
          : event.kind === "spike" ? [150, 65] : [330];
      notes.forEach((frequency, index) => {
        const context = this.context!;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * 0.085;
        oscillator.type = event.kind === "spike" ? "sawtooth" : "square";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.045, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(start); oscillator.stop(start + 0.14);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      });
    }
  }
}
