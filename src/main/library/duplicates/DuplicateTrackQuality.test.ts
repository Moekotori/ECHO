import { describe, expect, it } from 'vitest';
import { compareTrackQuality, isLosslessCodec, normalizeCodec, scoreTrackQuality } from './DuplicateTrackQuality';
import type { TrackLikeForDuplicate } from './DuplicateTrackTypes';

const track = (overrides: Partial<TrackLikeForDuplicate> = {}): TrackLikeForDuplicate => ({
  id: 'track-1',
  title: 'Song',
  artist: 'Artist',
  duration: 180,
  ...overrides,
});

describe('DuplicateTrackQuality', () => {
  it('normalizes codec names and detects lossless codecs', () => {
    expect(normalizeCodec(' flac ')).toBe('FLAC');
    expect(isLosslessCodec('flac')).toBe(true);
    expect(isLosslessCodec('mp3')).toBe(false);
  });

  it('scores 24bit/192kHz FLAC higher than 16bit/44.1kHz FLAC', () => {
    const cdFlac = track({ codec: 'FLAC', bitDepth: 16, sampleRate: 44_100, bitrate: 900_000 });
    const hiResFlac = track({ codec: 'FLAC', bitDepth: 24, sampleRate: 192_000, bitrate: 4_000_000 });

    expect(scoreTrackQuality(hiResFlac)).toBeGreaterThan(scoreTrackQuality(cdFlac));
    expect(compareTrackQuality(cdFlac, hiResFlac)).toBeGreaterThan(0);
  });

  it('scores FLAC higher than MP3', () => {
    expect(scoreTrackQuality(track({ codec: 'FLAC', bitDepth: 16, sampleRate: 44_100 }))).toBeGreaterThan(
      scoreTrackQuality(track({ codec: 'MP3', bitrate: 320_000, sampleRate: 44_100 })),
    );
  });

  it('prefers higher bitrate when codec, bit depth, and sample rate match', () => {
    const lowerBitrate = track({ codec: 'FLAC', bitDepth: 16, sampleRate: 44_100, bitrate: 700_000 });
    const higherBitrate = track({ codec: 'FLAC', bitDepth: 16, sampleRate: 44_100, bitrate: 1_200_000 });

    expect(scoreTrackQuality(higherBitrate)).toBeGreaterThan(scoreTrackQuality(lowerBitrate));
    expect(compareTrackQuality(lowerBitrate, higherBitrate)).toBeGreaterThan(0);
  });

  it('uses stable tie-breaks when quality scores match', () => {
    const smaller = track({ codec: 'FLAC', bitDepth: 16, sampleRate: 44_100, bitrate: 900_000, sizeBytes: 10, path: 'B.flac' });
    const larger = track({ codec: 'FLAC', bitDepth: 16, sampleRate: 44_100, bitrate: 900_000, sizeBytes: 20, path: 'A.flac' });
    const firstPath = track({ codec: 'FLAC', bitDepth: 16, sampleRate: 44_100, bitrate: 900_000, sizeBytes: 10, path: 'A.flac' });

    expect(compareTrackQuality(smaller, larger)).toBeGreaterThan(0);
    expect(compareTrackQuality(firstPath, smaller)).toBeLessThan(0);
  });
});
