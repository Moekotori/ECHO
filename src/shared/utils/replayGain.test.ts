import { describe, expect, it } from 'vitest';
import { calculateReplayGain } from './replayGain';

describe('calculateReplayGain', () => {
  it('falls back from album gain to track gain', () => {
    expect(calculateReplayGain({
      enabled: true,
      mode: 'album',
      trackGainDb: -4.5,
      albumGainDb: null,
      trackPeak: 0.8,
      preampDb: 1,
      preventClipping: true,
    })).toMatchObject({
      appliedDb: -3.5,
      selectedGainDb: -4.5,
      active: true,
      preventedClipping: false,
    });
  });

  it('limits positive gain when peak would clip', () => {
    expect(calculateReplayGain({
      enabled: true,
      mode: 'track',
      trackGainDb: 6,
      trackPeak: 0.9,
      preampDb: 0,
      preventClipping: true,
    })).toMatchObject({
      appliedDb: 0.915,
      preventedClipping: true,
    });
  });

  it('uses integrated LUFS with the current target for Spotify-style normalization', () => {
    expect(calculateReplayGain({
      enabled: true,
      mode: 'track',
      integratedLufs: -9,
      trackGainDb: -9,
      targetLufs: -14,
      trackPeak: 0.7,
      preampDb: 0,
      preventClipping: true,
    })).toMatchObject({
      appliedDb: -5,
      selectedGainDb: -5,
      active: true,
    });
  });

  it('stays inactive when disabled or missing gain', () => {
    expect(calculateReplayGain({
      enabled: false,
      mode: 'track',
      trackGainDb: 2,
      preampDb: 0,
      preventClipping: true,
    }).active).toBe(false);
    expect(calculateReplayGain({
      enabled: true,
      mode: 'track',
      preampDb: 0,
      preventClipping: true,
    }).active).toBe(false);
  });
});
