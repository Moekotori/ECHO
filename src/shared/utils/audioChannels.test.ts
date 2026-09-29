import { describe, expect, it } from 'vitest';
import { formatAudioChannelLayout } from './audioChannels';

describe('formatAudioChannelLayout', () => {
  it('labels common playback channel layouts', () => {
    expect(formatAudioChannelLayout(null)).toBeNull();
    expect(formatAudioChannelLayout(1)).toBe('Mono');
    expect(formatAudioChannelLayout(2)).toBe('Stereo');
    expect(formatAudioChannelLayout(6)).toBe('5.1 (6 ch)');
    expect(formatAudioChannelLayout(8)).toBe('7.1 (8 ch)');
    expect(formatAudioChannelLayout(4)).toBe('4 ch');
  });
});
