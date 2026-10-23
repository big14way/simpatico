/**
 * Token bucket (rate) + semaphore (concurrency). Qloo publishes no numeric limits,
 * so the defaults stay conservative: 4 req/s, burst 8, 4 in flight.
 */
export interface LimiterOptions {
  ratePerSec: number;
  burst: number;
  concurrency: number;
}

export class Limiter {
  private tokens: number;
  private last = Date.now();
  private inFlight = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly opts: LimiterOptions = { ratePerSec: 4, burst: 8, concurrency: 4 }) {
    this.tokens = opts.burst;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      await this.acquireToken();
      return await fn();
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.inFlight < this.opts.concurrency) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => { this.inFlight++; resolve(); }));
  }

  private releaseSlot(): void {
    this.inFlight--;
    const next = this.queue.shift();
    if (next) next();
  }

  private async acquireToken(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.opts.burst, this.tokens + ((now - this.last) / 1000) * this.opts.ratePerSec);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.ceil(((1 - this.tokens) / this.opts.ratePerSec) * 1000));
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
