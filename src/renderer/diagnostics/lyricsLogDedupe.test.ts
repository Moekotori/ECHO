import { describe, expect, it } from 'vitest';
import { LyricsLogDedupe } from './lyricsLogDedupe';

describe('lyrics diagnostic key residency', () => {
  it('keeps the existing per-key cooldown and logs again at its boundary', () => {
    const dedupe = new LyricsLogDedupe();
    expect(dedupe.shouldLog('song:1', 700, 0)).toBe(true);
    expect(dedupe.shouldLog('song:1', 700, 699)).toBe(false);
    expect(dedupe.shouldLog('song:1', 700, 700)).toBe(true);
    expect(dedupe.shouldLog('song:2', 700, 700)).toBe(true);
  });

  it('bounds unique song/clock keys and drops expired ones without a periodic timer', () => {
    const dedupe = new LyricsLogDedupe();
    for (let i = 0; i < 100_000; i++) dedupe.shouldLog(`song:${i}:position:${i}`, 500, 1000);
    expect(dedupe.size).toBe(512);
    expect(dedupe.shouldLog('song:99999:position:99999', 500, 1100)).toBe(false);
    dedupe.shouldLog('next', 500, 61_001);
    expect(dedupe.size).toBe(1);
  });

  it('keeps custom cooldowns longer than the normal retention window', () => {
    const dedupe = new LyricsLogDedupe();
    expect(dedupe.shouldLog('long', 120_000, 1000)).toBe(true);
    dedupe.shouldLog('short', 500, 61_001);
    expect(dedupe.shouldLog('long', 120_000, 61_001)).toBe(false);
    expect(dedupe.shouldLog('long', 120_000, 121_000)).toBe(true);
  });
});
