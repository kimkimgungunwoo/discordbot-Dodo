type Job<T> = {
  task: (remainingMs: number, signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  controller: AbortController;
  expires: number;
  waitingTimer?: ReturnType<typeof setTimeout>;
  detach: () => void;
};

export class AiQueue<T> {
  private queue: Job<T>[] = [];
  private active = 0;
  constructor(readonly concurrency: number, private readonly responseLimitMs: number, private readonly maxPending = 32) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || responseLimitMs <= 0) throw new Error("Invalid AI queue limits");
  }
  get running() { return this.active; }
  get pending() { return this.queue.length; }
  run(task: Job<T>["task"], signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.queue.length >= this.maxPending) return Promise.reject(new Error("AI 대기열이 가득 찼습니다."));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const job: Job<T> = { task, resolve, reject, controller, expires: performance.now() + this.responseLimitMs, detach: () => signal?.removeEventListener("abort", abort) };
      const abort = () => {
        controller.abort(signal?.reason);
        const index = this.queue.indexOf(job);
        if (index >= 0) { this.queue.splice(index, 1); clearTimeout(job.waitingTimer); job.detach(); reject(controller.signal.reason); }
      };
      signal?.addEventListener("abort", abort, { once: true });
      job.waitingTimer = setTimeout(() => {
        const index = this.queue.indexOf(job);
        if (index < 0) return;
        this.queue.splice(index, 1); job.detach(); reject(new Error("AI 계산 대기 시간 초과"));
      }, this.responseLimitMs);
      job.waitingTimer.unref();
      this.queue.push(job); this.pump();
    });
  }
  private pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      clearTimeout(job.waitingTimer);
      const remaining = job.expires - performance.now();
      if (remaining <= 0 || job.controller.signal.aborted) { job.detach(); job.reject(new Error("AI 계산 대기 취소")); continue; }
      this.active++;
      // The task must settle only after its worker has stopped. Otherwise a
      // timeout could free the slot while the old worker is still consuming CPU.
      Promise.resolve().then(() => job.task(remaining, job.controller.signal)).then(job.resolve, job.reject).finally(() => {
        job.detach(); this.active--; this.pump();
      });
    }
  }
}
