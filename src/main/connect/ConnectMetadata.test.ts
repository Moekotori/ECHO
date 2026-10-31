import { describe, expect, it } from 'vitest';
import type { ConnectPlaybackTarget } from '../../shared/types/connect';
import { buildDlnaDidlLite, createConnectMetadata, protocolInfoForMime, titleFromPath } from './ConnectMetadata';

const track = (overrides: Partial<ConnectPlaybackTarget> = {}): ConnectPlaybackTarget => ({
  id: 'track-1',
  path: 'D:\\Music\\Echo Song.flac',
  mediaType: 'local',
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  duration: 0,
  codec: 'flac',
  coverId: null,
  coverThumb: null,
  ...overrides,
});

describe('Connect metadata', () => {
  it('falls back to a file title, Unknown Artist, status duration, and a required HTTP cover URL', () => {
    const metadata = createConnectMetadata({
      track: track(),
      status: {
        currentFilePath: 'D:\\Music\\Status Song.mp3',
        currentTrackId: 'status-track',
        durationSeconds: 245,
        positionSeconds: 12,
      },
      coverHttpUrl: 'http://192.168.1.20:45000/connect/cover/token',
    });

    expect(metadata).toEqual({
      title: 'Echo Song.flac',
      artist: 'Unknown Artist',
      album: null,
      albumArtist: null,
      durationSeconds: 245,
      coverHttpUrl: 'http://192.168.1.20:45000/connect/cover/token',
    });
  });

  it('decodes URL filenames for title fallback', () => {
    expect(titleFromPath('https://example.test/audio/Hello%20World.mp3?token=1')).toBe('Hello World.mp3');
  });

  it('builds escaped DIDL-Lite with title, artist, album art, and protocolInfo', () => {
    const metadata = createConnectMetadata({
      track: track({
        id: 'track-&-1',
        title: 'A & <B>',
        artist: 'Artist "Q"',
        album: "Album 'Z'",
        albumArtist: 'Album & Artist',
        duration: 120,
      }),
      coverHttpUrl: 'http://192.168.1.20:45000/connect/cover/a&b',
    });

    const xml = buildDlnaDidlLite({
      id: 'track-&-1',
      streamUrl: 'http://192.168.1.20:45000/connect/audio/a&b',
      metadata,
      mimeType: 'audio/mpeg',
      sizeBytes: 123456,
    });

    expect(xml).toContain('<dc:title>A &amp; &lt;B&gt;</dc:title>');
    expect(xml).toContain('<upnp:artist>Artist &quot;Q&quot;</upnp:artist>');
    expect(xml).toContain('<upnp:album>Album &apos;Z&apos;</upnp:album>');
    expect(xml).toContain('<upnp:albumArtURI dlna:profileID="JPEG_TN">http://192.168.1.20:45000/connect/cover/a&amp;b</upnp:albumArtURI>');
    expect(xml).toContain(`protocolInfo="${protocolInfoForMime('audio/mpeg')}"`);
    expect(xml).toContain('size="123456"');
  });
});
