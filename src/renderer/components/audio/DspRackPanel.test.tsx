import { describe, expect, it } from 'vitest';
import { moveDspRackModule } from './DspRackPanel';

describe('moveDspRackModule', () => {
  const order = [
    'equalizer', 'convolution', 'replayGain', 'compressor',
    'crossfeed', 'stereoField', 'channelMatrix', 'channelBalance',
  ] as const;

  it('moves a module by one slot without losing module identity', () => {
    expect(moveDspRackModule(order, 'replayGain', -1)).toEqual([
      'equalizer', 'replayGain', 'convolution', 'compressor',
      'crossfeed', 'stereoField', 'channelMatrix', 'channelBalance',
    ]);
  });

  it('keeps edge modules in place', () => {
    expect(moveDspRackModule(order, 'equalizer', -1)).toEqual(order);
    expect(moveDspRackModule(order, 'channelBalance', 1)).toEqual(order);
  });
});
