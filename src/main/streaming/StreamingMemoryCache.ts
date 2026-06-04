type CacheEntry<T> = {
  value: T;
  expiresAtMs: number;
};

export class StreamingMemoryCache {
  private readonly values = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.values.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAtMs <= Date.now()) {
      this.values.delete(key);
      return null;
    }

    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    if (ttlMs > 0) {
      this.values.set(key, { value, expiresAtMs: Date.now() + ttlMs });
    }

    return value;
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  deletePrefix(prefix: string): void {
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) {
        this.values.delete(key);
      }
    }
  }

  getOrCreateInflight<T>(key: string, create: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = create().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }
}
