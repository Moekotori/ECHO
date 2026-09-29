import { describe, expect, it } from 'vitest';
import type { AudioStatus } from '../../../shared/types/audio';
import {
  buildLastFmTrackPayload,
  cleanText,
  getLastFmScrobbleThresholdSec,
  isUnknownText,
  parseArtistTitle,
} from './LastFmTrackPayload';

const status = {
  currentFilePath: 'D:\\Music\\Fallback Artist - Fallback Title.flac',
  durationSeconds: 120,
} as AudioStatus;

describe('LastFmTrackPayload', () => {
  it('cleans text and recognizes unknown placeholders', () => {
    expect(cleanText('  A\t B  ')).toBe('A B');
    expect(isUnknownText('Unknown Artist', 'artist')).toBe(true);
    expect(isUnknownText('Unknown Track', 'title')).toBe(true);
    expect(isUnknownText('Unknown Album', 'album')).toBe(true);
  });

  it('parses Artist - Title filenames', () => {
    expect(parseArtistTitle('Artist - Title')).toEqual({ artist: 'Artist', title: 'Title' });
  });

  it('builds payload from useful metadata and skips unknown album', () => {
    expect(
      buildLastFmTrackPayload(
        {
          title: 'Unknown Track',
          artist: 'Unknown Artist',
          album: 'Unknown Album',
          albumArtist: 'Album Artist',
          duration: 90,
        },
        status,
      ),
    ).toEqual({
      artist: 'Album Artist',
      title: 'Fallback Title',
      album: '',
      duration: 90,
    });
  });

  it('uses Last.fm scrobble threshold bounds', () => {
    expect(getLastFmScrobbleThresholdSec(0)).toBe(30);
    expect(getLastFmScrobbleThresholdSec(120)).toBe(60);
    expect(getLastFmScrobbleThresholdSec(1000)).toBe(240);
    expect(getLastFmScrobbleThresholdSec(20)).toBe(30);
  });
});
