import { describe, expect, it } from 'vitest';
import { formatOsuTimingBlock, formatOsuTimingPoint, getBeatLengthMs } from './osuTiming';

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

  it('rejects invalid BPM and offset values', () => {
    expect(() => getBeatLengthMs(0)).toThrow('bpm must be greater than 0');
    expect(() => formatOsuTimingPoint({ bpm: Number.NaN, offsetMs: 0 })).toThrow('bpm must be a finite number');
    expect(() => formatOsuTimingPoint({ bpm: 120, offsetMs: Number.POSITIVE_INFINITY })).toThrow('offsetMs must be a finite number');
  });
});
