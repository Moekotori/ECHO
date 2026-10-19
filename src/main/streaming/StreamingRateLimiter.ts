type QueueItem<T> = {
  work: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type ProviderState = {
  queue: QueueItem<unknown>[];
  running: number;
  lastStartedAt: number;
};

export class StreamingRateLimiter {
  private readonly states = new Map<string, ProviderState>();

  constructor(
    private readonly options: {
      maxConcurrent?: number;
      minIntervalMs?: number;
    } = {},
  ) {}

  schedule<T>(provider: string, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.getState(provider);
      state.queue.push({ work, resolve: resolve as (value: unknown) => void, reject });
      this.pump(provider);
    });
  }

  private getState(provider: string): ProviderState {
    const existing = this.states.get(provider);
    if (existing) {
      return existing;
    }

    const next: ProviderState = {
      queue: [],
      running: 0,
      lastStartedAt: 0,
    };
    this.states.set(provider, next);
    return next;
  }

  private pump(provider: string): void {
    const state = this.getState(provider);
    const maxConcurrent = this.options.maxConcurrent ?? 2;
    const minIntervalMs = this.options.minIntervalMs ?? 120;

    if (state.running >= maxConcurrent || state.queue.length === 0) {
      return;
    }

    const delayMs = Math.max(0, minIntervalMs - (Date.now() - state.lastStartedAt));
    windowSetTimeout(() => {
      if (state.running >= maxConcurrent) {
        this.pump(provider);
        return;
      }

      const item = state.queue.shift();
      if (!item) {
        return;
      }

      state.running += 1;
      state.lastStartedAt = Date.now();
      item
        .work()
        .then(item.resolve, item.reject)
        .finally(() => {
          state.running -= 1;
          this.pump(provider);
        });
      this.pump(provider);
    }, delayMs);
  }
}

const windowSetTimeout = (handler: () => void, delayMs: number): void => {
  setTimeout(handler, delayMs);
};
