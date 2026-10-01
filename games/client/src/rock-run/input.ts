// Preserve release/press edges even when both arrive between simulation ticks.
export class ActionInput {
  private held = false;
  private edges: boolean[] = [];
  set(held: boolean) {
    if (held === this.held) return;
    this.held = held;
    this.edges.push(held);
  }
  next(): boolean { return this.edges.shift() ?? this.held; }
  reset() { this.held = false; this.edges = []; }
}
