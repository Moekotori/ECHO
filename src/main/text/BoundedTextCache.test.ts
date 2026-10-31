import { expect, it } from 'vitest';
import { BoundedTextCache } from './BoundedTextCache';
import { libraryTextSortKey } from '../library/LibrarySortKey';
import { librarySortTextCache } from '../library/libraryTextCaches';

it('bounds text independently of entry count and accounts for replacements and cached nulls', () => {
  const cache = new BoundedTextCache(20, 3);
  cache.set('a', '1234');
  cache.set('b', '1234');
  expect(cache.snapshot()).toEqual({ entries: 2, estimatedTextBytes: 20 });
  cache.set('b', null);
  expect(cache.snapshot().estimatedTextBytes).toBe(12);
  cache.set('c', '123');
  cache.set('d', '1');
  expect(cache.get('a')).toBeUndefined();
  expect(cache.get('b')).toBeNull();
  expect(cache.snapshot()).toEqual({ entries: 3, estimatedTextBytes: 14 });
});

it('keeps existing insertion-order eviction and skips oversized values without evicting unrelated results', () => {
  const cache = new BoundedTextCache(100, 2);
  cache.set('a', 'a');
  cache.set('b', 'b');
  expect(cache.get('a')).toBe('a');
  cache.set('c', 'c');
  expect(cache.get('a')).toBeUndefined();
  cache.set('huge', 'x'.repeat(100));
  expect(cache.get('b')).toBe('b');
  expect(cache.get('c')).toBe('c');
  cache.set('b', 'x'.repeat(100));
  expect(cache.get('b')).toBeUndefined();
  expect(cache.snapshot()).toEqual({ entries: 1, estimatedTextBytes: 4 });
});

it('retains the existing 4096 entry capacity for ordinary metadata without idle expiry', () => {
  const cache = new BoundedTextCache(1024 * 1024);
  for (let i = 0; i < 4096; i++) cache.set(String(i), 'ordinary title');
  expect(cache.snapshot().entries).toBe(4096);
  expect(cache.get('0')).toBe('ordinary title');
  cache.set('4096', 'ordinary title');
  expect(cache.get('0')).toBeUndefined();
  expect(cache.get('1')).toBe('ordinary title');
});

it('returns the complete sort key for oversized metadata without retaining it', () => {
  const ordinary = ['周杰伦', 'アイドル', '아이유', 'Track 10', 'Café'];
  const expected = ordinary.map(libraryTextSortKey);
  const huge = 'a'.repeat(3 * 1024 * 1024);
  expect(libraryTextSortKey(huge)).toBe(huge);
  expect(librarySortTextCache.get(huge)).toBeUndefined();
  expect(librarySortTextCache.snapshot().estimatedTextBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(ordinary.map(libraryTextSortKey)).toEqual(expected);
});
