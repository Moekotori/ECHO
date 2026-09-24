import { describe, expect, it } from 'vitest';
import { defaultDspRackState, normalizeDspRackState } from './dspRack';

describe('normalizeDspRackState', () => {
  it('migrates the v1 four-module order without discarding custom placement', () => {
    const state = normalizeDspRackState({
      schemaVersion: 1,
      order: ['replayGain', 'equalizer', 'channelBalance', 'convolution'],
    });

    expect(state.schemaVersion).toBe(3);
    expect(state.order).toEqual([
      'replayGain', 'equalizer', 'channelBalance', 'convolution',
      'compressor', 'crossfeed', 'stereoField', 'channelMatrix',
    ]);
    expect(state.compressor).toEqual(defaultDspRackState().compressor);
  });

  it('clamps spatial processors to the native contracts', () => {
    const state = normalizeDspRackState({
      order: defaultDspRackState().order,
      crossfeed: { enabled: true, amount: 2, cutoffHz: 20 },
      stereoField: { enabled: true, width: 3, centerGainDb: 30, sideGainDb: -30 },
      channelMatrix: {
        enabled: true,
        leftToLeft: 3,
        rightToLeft: -3,
        leftToRight: 0.25,
        rightToRight: 0.75,
      },
    });

    expect(state.crossfeed).toMatchObject({ enabled: true, amount: 1, cutoffHz: 100 });
    expect(state.stereoField).toMatchObject({ enabled: true, width: 2, centerGainDb: 18, sideGainDb: -18 });
    expect(state.channelMatrix).toMatchObject({
      enabled: true,
      leftToLeft: 2,
      rightToLeft: -2,
      leftToRight: 0.25,
      rightToRight: 0.75,
    });
  });

  it('clamps persisted compressor parameters to the native contract', () => {
    const state = normalizeDspRackState({
      order: defaultDspRackState().order,
      compressor: {
        enabled: true,
        thresholdDb: -200,
        ratio: 100,
        attackMs: 0,
        releaseMs: 9_000,
        kneeDb: 40,
        makeupDb: 30,
        mix: 2,
      },
    });

    expect(state.compressor).toMatchObject({
      enabled: true,
      thresholdDb: -72,
      ratio: 40,
      attackMs: 0.1,
      releaseMs: 5_000,
      kneeDb: 24,
      makeupDb: 24,
      mix: 1,
    });
  });
});
