import { describe, expect, it } from 'vitest';
import { StreamingMemoryCache } from './StreamingMemoryCache';

describe('StreamingMemoryCache', () => {
  it('prunes only expired entries', () => {
    const cache = new StreamingMemoryCache();
    const startedAtMs = Date.now();

    cache.set('expired', { value: 1 }, 1);
    cache.set('fresh', { value: 2 }, 60_000);

    const result = cache.pruneExpired(startedAtMs + 10);

    expect(result).toEqual({
      beforeEntries: 2,
      afterEntries: 1,
      removedEntries: 1,
    });
    expect(cache.get('expired')).toBeNull();
    expect(cache.get('fresh')).toEqual({ value: 2 });
  });
});
