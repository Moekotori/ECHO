import { describe, expect, it } from 'vitest';
import { parseReplayGainEbur128Summary } from './ReplayGainAnalyzer';

describe('parseReplayGainEbur128Summary', () => {
  it('reads the final integrated loudness and peak from ffmpeg ebur128 output', () => {
    const result = parseReplayGainEbur128Summary([
      '[Parsed_ebur128_0] Summary:',
      '  Integrated loudness:',
      '    I:         -14.2 LUFS',
      '  True peak:',
      '    Peak:      -1.0 dBFS',
    ], -18);

    expect(result).toEqual({
      integratedLufs: -14.2,
      trackGainDb: -3.8,
      trackPeak: 0.891251,
    });
  });

  it('returns null when loudness is unavailable', () => {
    expect(parseReplayGainEbur128Summary(['no summary here'])).toBeNull();
  });
});

