import { describe, expect, it } from 'vitest';
import {
  formatOsuBookmarksLine,
  formatOsuTimingBlock,
  formatOsuTimingPoint,
  getBeatLengthMs,
  getMeasureLengthMs,
  getOsuBookmarkOffsets,
} from './osuTiming';

describe('osuTiming', () => {
  it('formats a standard 128 BPM timing point', () => {
    expect(getBeatLengthMs(128)).toBe(468.75);
    expect(formatOsuTimingPoint({ bpm: 128, offsetMs: 0 })).toBe('0,468.75,4,1,0,100,1,0');
  });

  it('keeps decimal BPM precision up to six beat-length decimals', () => {
    expect(formatOsuTimingPoint({ bpm: 123.456, offsetMs: 12 })).toBe('12,486.00311,4,1,0,100,1,0');
  });

  it('rounds the offset to osu integer milliseconds', () => {
    expect(formatOsuTimingPoint({ bpm: 180, offsetMs: 37.6 })).toBe('38,333.333333,4,1,0,100,1,0');
  });

  it('formats a paste-ready TimingPoints block', () => {
    expect(formatOsuTimingBlock({ bpm: 150, offsetMs: 25 })).toBe('[TimingPoints]\n25,400,4,1,0,100,1,0');
  });

  it('derives measure length from BPM and meter', () => {
    expect(getMeasureLengthMs(150, 4)).toBe(1600);
    expect(formatOsuTimingPoint({ bpm: 150, offsetMs: 25, meter: 3 })).toBe('25,400,3,1,0,100,1,0');
  });

  it('generates osu editor bookmarks on measure downbeats', () => {
    expect(getOsuBookmarkOffsets({ bpm: 120, offsetMs: 250, meter: 4, measureCount: 4 })).toEqual([250, 2250, 4250, 6250]);
    expect(formatOsuBookmarksLine({ bpm: 120, offsetMs: 250, meter: 4, measureCount: 3 })).toBe('Bookmarks: 250,2250,4250');
  });

  it('skips negative bookmark offsets while staying on the same measure grid', () => {
    expect(getOsuBookmarkOffsets({ bpm: 120, offsetMs: -750, meter: 4, measureCount: 3 })).toEqual([1250, 3250, 5250]);
  });

  it('rejects invalid BPM and offset values', () => {
    expect(() => getBeatLengthMs(0)).toThrow('bpm must be greater than 0');
    expect(() => formatOsuTimingPoint({ bpm: Number.NaN, offsetMs: 0 })).toThrow('bpm must be a finite number');
    expect(() => formatOsuTimingPoint({ bpm: 120, offsetMs: Number.POSITIVE_INFINITY })).toThrow('offsetMs must be a finite number');
    expect(() => getOsuBookmarkOffsets({ bpm: 120, offsetMs: 0, measureCount: 0 })).toThrow('measureCount must be a positive integer');
  });
});
