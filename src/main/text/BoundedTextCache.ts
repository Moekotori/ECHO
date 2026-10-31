/** Counts UTF-16 text payload; this is a cache budget, not a V8 heap measurement. */
export class BoundedTextCache {
  private readonly entries = new Map<string, string | null>();
  private textBytes = 0;

  constructor(private readonly maxTextBytes: number, private readonly maxEntries = 4096) {
    for (const limit of [maxTextBytes, maxEntries]) {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError('Invalid text cache limit');
    }
  }

  get(key: string): string | null | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: string | null): void {
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.entries.delete(key);
      this.textBytes -= this.weight(key, previous);
    }
    const bytes = this.weight(key, value);
    // A huge result is still returned by its caller; do not retain or truncate it.
    if (bytes > this.maxTextBytes) return;
    while (this.entries.size >= this.maxEntries || this.textBytes + bytes > this.maxTextBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.textBytes -= this.weight(oldest, this.entries.get(oldest)!);
      this.entries.delete(oldest);
    }
    this.entries.set(key, value);
    this.textBytes += bytes;
  }

  snapshot(): { entries: number; estimatedTextBytes: number } {
    return { entries: this.entries.size, estimatedTextBytes: this.textBytes };
  }

  private weight(key: string, value: string | null): number {
    return 2 * (key.length + (value?.length ?? 0));
  }
}
