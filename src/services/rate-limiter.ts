export class QueueOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueOverflowError";
  }
}

interface QueueItem<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export interface RateLimiterOptions {
  requestsPerSecond: number;
  maxQueued: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimiterQueue {
  private readonly minIntervalMs: number;
  private readonly maxQueued: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly queue: QueueItem<unknown>[] = [];

  private isRunning = false;
  private nextAvailableAt = 0;

  constructor(options: RateLimiterOptions) {
    this.minIntervalMs = 1000 / Math.max(1, options.requestsPerSecond);
    this.maxQueued = Math.max(1, options.maxQueued);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(new QueueOverflowError(`Brave request queue is full (max=${this.maxQueued})`));
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task: task as () => Promise<unknown>, resolve: resolve as (value: unknown) => void, reject });
      void this.pump();
    });
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  private async pump(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    try {
      while (this.queue.length > 0) {
        const now = this.now();
        const waitMs = this.nextAvailableAt - now;
        if (waitMs > 0) {
          await this.sleep(waitMs);
        }

        const next = this.queue.shift();
        if (!next) {
          continue;
        }

        const startedAt = this.now();
        this.nextAvailableAt = Math.max(this.nextAvailableAt, startedAt) + this.minIntervalMs;

        try {
          const result = await next.task();
          next.resolve(result);
        } catch (error) {
          next.reject(error);
        }
      }
    } finally {
      this.isRunning = false;
      if (this.queue.length > 0) {
        void this.pump();
      }
    }
  }
}
