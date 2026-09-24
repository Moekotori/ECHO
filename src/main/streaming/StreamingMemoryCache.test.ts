import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingMemoryCache } from './StreamingMemoryCache';

describe('StreamingMemoryCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prunes only expired entries', () => {
    const cache = new StreamingMemoryCache();
    const startedAtMs = Date.now();

    cache.set('expired', { value: 1 }, 1_000);
    cache.set('fresh', { value: 2 }, 60_000);

    const result = cache.pruneExpired(startedAtMs + 2_000);

    expect(result).toEqual({
      beforeEntries: 2,
      afterEntries: 1,
      removedEntries: 1,
    });
    expect(cache.get('expired')).toBeNull();
    expect(cache.get('fresh')).toEqual({ value: 2 });
  });

  it('prunes expired entries before inserting a new value', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    const cache = new StreamingMemoryCache(2);

    cache.set('expired', { value: 1 }, 10);
    cache.set('fresh', { value: 2 }, 60_000);
    vi.advanceTimersByTime(20);
    cache.set('next', { value: 3 }, 60_000);

    expect(cache.size).toBe(2);
    expect(cache.get('expired')).toBeNull();
    expect(cache.get('fresh')).toEqual({ value: 2 });
    expect(cache.get('next')).toEqual({ value: 3 });
  });

  it('evicts the least recently used value at the entry limit', () => {
    const cache = new StreamingMemoryCache(2);
    cache.set('first', { value: 1 }, 60_000);
    cache.set('second', { value: 2 }, 60_000);

    expect(cache.get('first')).toEqual({ value: 1 });
    cache.set('third', { value: 3 }, 60_000);

    expect(cache.size).toBe(2);
    expect(cache.get('second')).toBeNull();
    expect(cache.get('first')).toEqual({ value: 1 });
    expect(cache.get('third')).toEqual({ value: 3 });
  });

  it('keeps unique-value growth bounded during long sessions', () => {
    const cache = new StreamingMemoryCache(128);

    for (let index = 0; index < 10_000; index += 1) {
      cache.set(`entry-${index}`, { index }, 60_000);
    }

    expect(cache.size).toBe(128);
    expect(cache.get('entry-0')).toBeNull();
    expect(cache.get('entry-9999')).toEqual({ index: 9999 });
  });

  it('releases all reusable values under memory pressure', () => {
    const cache = new StreamingMemoryCache();
    cache.set('playback', { url: 'https://example.test/audio.flac' }, 60_000);
    cache.set('album', { tracks: new Array(100).fill('track') }, 60_000);

    expect(cache.clearValues()).toEqual({
      beforeEntries: 2,
      afterEntries: 0,
      removedEntries: 2,
    });
    expect(cache.size).toBe(0);
  });

  it('deduplicates only active inflight work', async () => {
    const cache = new StreamingMemoryCache(1);
    let calls = 0;
    const create = async (): Promise<number> => {
      calls += 1;
      return calls;
    };

    const first = cache.getOrCreateInflight('request', create);
    const duplicate = cache.getOrCreateInflight('request', create);

    expect(duplicate).toBe(first);
    await expect(first).resolves.toBe(1);
    await expect(cache.getOrCreateInflight('request', create)).resolves.toBe(2);
    expect(calls).toBe(2);
  });
});
