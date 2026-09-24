import { describe, expect, it } from 'vitest';
import type { IntegrationPlaybackSnapshotV1 } from '../../shared/types/integrationPlatform';
import { resolveEchoLinkV2CurrentArtwork } from './EchoLinkV2Artwork';

const snapshot = (artworkUrl: string | null): IntegrationPlaybackSnapshotV1 => ({
  version: 1,
  revision: 1,
  observedAt: '2026-07-17T00:00:00.000Z',
  state: 'playing',
  track: {
    id: null,
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    albumArtist: 'Artist',
    artworkUrl,
  },
  positionMs: 1_000,
  durationMs: 120_000,
  volume: 0.5,
  output: {
    mode: 'shared',
    deviceName: 'Speakers',
    backend: 'wasapi-internal',
  },
});

describe('resolveEchoLinkV2CurrentArtwork', () => {
  it('never reads file URLs from playback metadata', async () => {
    await expect(resolveEchoLinkV2CurrentArtwork(snapshot('file:///D:/private-cover.jpg')))
      .resolves.toBeNull();
  });

  it('does not proxy plain HTTP artwork URLs', async () => {
    await expect(resolveEchoLinkV2CurrentArtwork(snapshot('http://127.0.0.1/private-cover.jpg')))
      .resolves.toBeNull();
  });

  it('returns no artwork when there is no current track', async () => {
    await expect(resolveEchoLinkV2CurrentArtwork({ ...snapshot(null), track: null }))
      .resolves.toBeNull();
  });
});
