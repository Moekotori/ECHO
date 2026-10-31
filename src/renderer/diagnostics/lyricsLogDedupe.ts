type LogEntry = { atMs: number; expiresAtMs: number };

/** Diagnostic-only keys must not accumulate for every song and five-second clock bucket. */
export class LyricsLogDedupe {
  private readonly entries = new Map<string, LogEntry>();
  private nextSweepAtMs = 0;

  constructor(private readonly maxEntries = 512, private readonly retentionMs = 60_000) {}

  get size(): number { return this.entries.size; }

  shouldLog(key: string, dedupeMs: number, now = Date.now()): boolean {
    if (now >= this.nextSweepAtMs) {
      for (const [existingKey, entry] of this.entries) {
        if (entry.expiresAtMs <= now) this.entries.delete(existingKey);
      }
      this.nextSweepAtMs = now + Math.min(this.retentionMs, 30_000);
    }
    const previous = this.entries.get(key);
    if (previous && now - previous.atMs < dedupeMs) return false;

    this.entries.delete(key);
    this.entries.set(key, { atMs: now, expiresAtMs: now + Math.max(this.retentionMs, dedupeMs) });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return true;
  }
}
