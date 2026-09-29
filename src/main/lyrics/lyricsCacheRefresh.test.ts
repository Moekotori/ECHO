import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackLyrics } from '../../shared/types/lyrics';
import {
  hasActiveLyricsRefreshMiss,
  isWordTimingRefreshProvider,
  matchesCachedLyricsIdentity,
  mergeSecondaryFieldsFromLyrics,
  rememberLyricsRefreshMiss,
} from './lyricsCacheRefresh';

const lyrics = (overrides: Partial<TrackLyrics> = {}): TrackLyrics => ({
  id: 'lyrics-1',
  trackId: 'track-1',
  provider: 'netease',
  providerLyricsId: 'netease:chosen',
  kind: 'synced',
  title: 'Song',
  artist: 'Artist',
  album: null,
  durationSeconds: 120,
  lines: [{
    timeMs: 1_000,
    text: 'Hello world',
    words: [
      { text: 'Hello ', startMs: 1_000, endMs: 1_500 },
      { text: 'world', startMs: 1_500, endMs: 2_000 },
    ],
  }],
  plainText: 'Hello world',
  syncedText: '[00:01.00]Hello world',
  offsetMs: 0,
  score: 1,
  cachedAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('lyricsCacheRefresh', () => {
  it('merges requested secondary text without replacing chosen lyrics or word timings', () => {
    const target = lyrics();
    const source = lyrics({
      id: 'other-lyrics',
      provider: 'lrclib',
      providerLyricsId: 'lrclib:other',
      lines: [{
        timeMs: 1_180,
        text: 'Hello world',
        translation: '你好，世界',
      }],
      syncedText: '[00:01.18]Hello world',
    });

    const merged = mergeSecondaryFieldsFromLyrics(target, source, ['translation']);

    expect(merged).not.toBe(target);
    expect(merged).toMatchObject({
      provider: 'netease',
      providerLyricsId: 'netease:chosen',
      syncedText: '[00:01.00]Hello world',
    });
    expect(merged.lines[0]).toEqual({
      ...target.lines[0],
      translation: '你好，世界',
    });
  });

  it('keeps an existing secondary field instead of silently replacing it', () => {
    const target = lyrics({
      lines: [{ timeMs: 1_000, text: 'Hello world', translation: '原翻译' }],
    });
    const source = lyrics({
      lines: [{ timeMs: 1_000, text: 'Hello world', translation: '新翻译' }],
    });

    expect(mergeSecondaryFieldsFromLyrics(target, source, ['translation'])).toBe(target);
  });

  it('expires transient refresh misses instead of suppressing retries for the whole process', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00.000Z'));
    const misses = new Map<string, number>();

    rememberLyricsRefreshMiss(misses, 'track-1');
    expect(hasActiveLyricsRefreshMiss(misses, 'track-1')).toBe(true);

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(hasActiveLyricsRefreshMiss(misses, 'track-1')).toBe(false);
    expect(misses.has('track-1')).toBe(false);
  });

  it('prunes expired misses before remembering another track', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00.000Z'));
    const misses = new Map<string, number>();

    rememberLyricsRefreshMiss(misses, 'expired-1');
    rememberLyricsRefreshMiss(misses, 'expired-2');
    vi.advanceTimersByTime(5 * 60 * 1000);
    rememberLyricsRefreshMiss(misses, 'fresh');

    expect(misses.size).toBe(1);
    expect(misses.has('expired-1')).toBe(false);
    expect(misses.has('expired-2')).toBe(false);
    expect(hasActiveLyricsRefreshMiss(misses, 'fresh')).toBe(true);
  });

  it('refreshes the miss TTL when the same track fails again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00.000Z'));
    const misses = new Map<string, number>();

    rememberLyricsRefreshMiss(misses, 'track-1');
    vi.advanceTimersByTime(4 * 60 * 1000);
    rememberLyricsRefreshMiss(misses, 'track-1');
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(hasActiveLyricsRefreshMiss(misses, 'track-1')).toBe(true);
  });

  it('keeps the most recently remembered 512 misses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00.000Z'));
    const misses = new Map<string, number>();

    rememberLyricsRefreshMiss(misses, 'refreshed');
    for (let index = 0; index < 511; index += 1) {
      rememberLyricsRefreshMiss(misses, `track-${index}`);
    }
    rememberLyricsRefreshMiss(misses, 'refreshed');
    rememberLyricsRefreshMiss(misses, 'latest');

    expect(misses.size).toBe(512);
    expect(misses.has('track-0')).toBe(false);
    expect(misses.has('track-510')).toBe(true);
    expect(misses.has('refreshed')).toBe(true);
    expect(misses.has('latest')).toBe(true);
  });

  it('only refreshes word timings for providers that expose karaoke timing data', () => {
    expect(isWordTimingRefreshProvider('netease')).toBe(true);
    expect(isWordTimingRefreshProvider('qqmusic')).toBe(true);
    expect(isWordTimingRefreshProvider('amll-ttml')).toBe(true);
    expect(isWordTimingRefreshProvider('lrclib')).toBe(false);
  });

  it('requires the same provider and provider lyrics id before upgrading word timings', () => {
    const cached = lyrics();

    expect(matchesCachedLyricsIdentity(cached, 'netease', 'netease:chosen')).toBe(true);
    expect(matchesCachedLyricsIdentity(cached, 'netease', 'netease:other')).toBe(false);
    expect(matchesCachedLyricsIdentity(cached, 'qqmusic', 'netease:chosen')).toBe(false);
    expect(matchesCachedLyricsIdentity(
      { provider: 'netease', providerLyricsId: null },
      'netease',
      null,
    )).toBe(false);
  });
});
