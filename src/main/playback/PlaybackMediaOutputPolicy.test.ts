import { describe, expect, it } from 'vitest';
import type { PlayableTrack } from '../../shared/types/remoteSources';
import { resolvePlaybackOutputForMediaItem } from './PlaybackMediaOutputPolicy';

const liveRadio = (duration: number | null): PlayableTrack => ({
  mediaType: 'streaming',
  trackId: 'radio-stream:test',
  provider: 'm3u8',
  providerTrackId: 'opaque-radio-url',
  stableKey: 'streaming:m3u8:opaque-radio-url',
  title: 'Zeno',
  artist: 'Live Stream',
  album: 'ECHO Live',
  duration,
  playable: true,
});

describe('resolvePlaybackOutputForMediaItem', () => {
  it('bypasses native-only DSP for a live radio stream while preserving its ASIO route', () => {
    expect(resolvePlaybackOutputForMediaItem(liveRadio(0), {
      outputMode: 'asio',
      deviceIndex: 0,
      deviceName: 'Matrix ASIO Driver',
      sdmMode: 'pcmToDsd',
      echoSrcMode: 'family4x',
      pcmDitherMode: 'tpdf',
      volume: 0.75,
    })).toEqual({
      outputMode: 'asio',
      deviceIndex: 0,
      deviceName: 'Matrix ASIO Driver',
      sdmMode: 'off',
      echoSrcMode: 'off',
      pcmDitherMode: 'off',
      volume: 0.75,
    });
  });

  it('does not change a finite M3U8 item or an ordinary streaming track', () => {
    const output = { outputMode: 'asio', sdmMode: 'pcmToDsd' } as const;
    const ordinaryStream: PlayableTrack = {
      mediaType: 'streaming',
      trackId: 'streaming:bilibili:test',
      provider: 'bilibili',
      providerTrackId: 'test',
      stableKey: 'streaming:bilibili:test',
      title: 'Ordinary stream',
      artist: 'Artist',
      album: 'Album',
      duration: 0,
      playable: true,
    };
    expect(resolvePlaybackOutputForMediaItem(liveRadio(180), output)).toBe(output);
    expect(resolvePlaybackOutputForMediaItem(ordinaryStream, output)).toBe(output);
  });
});
