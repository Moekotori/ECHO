type CacheEntry<T> = {
  value: T;
  expiresAtMs: number;
};

const defaultMaxEntries = 512;

export class StreamingMemoryCache {
  private readonly values = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries = defaultMaxEntries) {
    this.maxEntries = Number.isFinite(maxEntries)
      ? Math.max(1, Math.floor(maxEntries))
      : defaultMaxEntries;
  }

  get size(): number {
    return this.values.size;
  }

  get<T>(key: string): T | null {
    const entry = this.values.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAtMs <= Date.now()) {
      this.values.delete(key);
      return null;
    }

    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    if (ttlMs > 0) {
      const nowMs = Date.now();
      this.pruneExpired(nowMs);
      this.values.delete(key);
      this.values.set(key, { value, expiresAtMs: nowMs + ttlMs });
      this.enforceLimit();
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

  pruneExpired(nowMs = Date.now()): { beforeEntries: number; afterEntries: number; removedEntries: number } {
    const beforeEntries = this.values.size;
    for (const [key, entry] of this.values.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        this.values.delete(key);
      }
    }

    const afterEntries = this.values.size;
    return {
      beforeEntries,
      afterEntries,
      removedEntries: beforeEntries - afterEntries,
    };
  }

  clearValues(): { beforeEntries: number; afterEntries: number; removedEntries: number } {
    const beforeEntries = this.values.size;
    this.values.clear();
    return {
      beforeEntries,
      afterEntries: 0,
      removedEntries: beforeEntries,
    };
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

  private enforceLimit(): void {
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next();
      if (oldest.done) {
        return;
      }
      this.values.delete(oldest.value);
    }
  }
}
