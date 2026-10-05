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

  playRummikub(kind: "place" | "draw" | "turn" | "win" | "error" | "reset") {
    if (this.muted || !this.context || this.context.state !== "running") return;
    const context = this.context;
    const notes = { place: [640], draw: [440, 330], turn: [523, 784], win: [523, 659, 784, 1047], error: [185, 155], reset: [390, 290] }[kind];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const start = context.currentTime + index * 0.085, duration = kind === "place" ? 0.075 : 0.13;
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, start);
      if (kind === "place") oscillator.frequency.exponentialRampToValueAtTime(320, start + duration);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.06, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + duration + 0.01);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }

  playArrowVolley(count: number) {
    if (this.muted || !this.context || this.context.state !== "running" || count < 1) return;
    const context = this.context;
    const barrage = count >= 8;
    const voices = Math.min(count, 12);
    for (let index = 0; index < voices; index++) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + (barrage ? (index % 4) * 0.006 : index * 0.012);
      const frequency = (barrage ? 620 : 760) + (index % 5) * 47;
      oscillator.type = barrage ? "sawtooth" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(barrage ? 115 : 190, start + (barrage ? 0.13 : 0.085));
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(barrage ? 0.019 : 0.011, start + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (barrage ? 0.15 : 0.1));
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + (barrage ? 0.16 : 0.11));
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  }
}
