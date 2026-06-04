import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { KugouStreamingProvider, encodeKugouProviderTrackId, parseKugouProviderTrackId, resolveKugouPlaybackUrl } from './KugouStreamingProvider';

const accountState = vi.hoisted(() => ({
  connected: true,
  cookie: 'dfid=DFID123; kg_mid=12345678901234567890; KugooID=42',
}));

vi.mock('../../accounts/AccountService', () => ({
  getAccountService: () => ({
    getStatus: (provider: string) => ({
      provider,
      connected: accountState.connected,
      username: accountState.connected ? '42' : null,
      displayName: accountState.connected ? 'Tester' : null,
      avatarUrl: null,
      lastLoginAt: '2026-01-01T00:00:00.000Z',
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    }),
    getCredentials: (provider: string) => ({
      provider,
      cookie: accountState.cookie,
    }),
  }),
}));

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const remoteImageUrl = (url: string): string => `echo-image://remote/${encodeURIComponent(url)}?referer=${encodeURIComponent('https://www.kugou.com/')}`;

afterEach(() => {
  vi.unstubAllGlobals();
  accountState.connected = true;
  accountState.cookie = 'dfid=DFID123; kg_mid=12345678901234567890; KugooID=42';
});

describe('KugouStreamingProvider', () => {
  it('encodes compound track ids and tolerates bare hash ids', () => {
    expect(encodeKugouProviderTrackId({ hash: 'ABCDEF1234567890ABCDEF1234567890', albumId: '22', albumAudioId: '33' })).toBe(
      'abcdef1234567890abcdef1234567890.22.33',
    );
    expect(parseKugouProviderTrackId('abcdef1234567890abcdef1234567890')).toEqual({
      hash: 'abcdef1234567890abcdef1234567890',
      albumId: null,
      albumAudioId: null,
    });
  });

  it('maps KuGou search results to streaming tracks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            total: 1,
            info: [
              {
                hash: 'abcdef1234567890abcdef1234567890',
                album_id: '22',
                album_audio_id: 33,
                songname: 'Search Song',
                singername: 'Search Artist',
                AlbumName: 'Search Album',
                duration: 181,
                imgurl: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg',
                HQFileHash: 'hq-hash',
              },
            ],
          },
        }),
      ),
    );

    const result = await new KugouStreamingProvider().search({ provider: 'kugou', query: 'search', mediaTypes: ['track'], page: 1, pageSize: 10 });

    expect(result.tracks[0]).toMatchObject({
      provider: 'kugou',
      providerTrackId: 'abcdef1234567890abcdef1234567890.22.33',
      stableKey: 'streaming:kugou:abcdef1234567890abcdef1234567890.22.33',
      title: 'Search Song',
      artist: 'Search Artist',
      album: 'Search Album',
      duration: 181,
      qualities: ['high', 'standard'],
      coverThumb: remoteImageUrl('https://imge.kugou.com/stdmusic/400/cover.jpg'),
    });
  });

  it('loads KuGou playlist pages from special ids', async () => {
    const fetchRunner = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({
        data: {
          total: 1,
          specialname: 'KuGou Mix',
          info: [
            {
              hash: 'bbbbbb1234567890bbbbbb1234567890',
              album_id: '11',
              album_audio_id: 12,
              songname: 'Playlist Song',
              singername: 'Playlist Artist',
              AlbumName: 'Playlist Album',
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchRunner);

    const playlist = await new KugouStreamingProvider().getPlaylist({ providerPlaylistId: '8899', page: 2, pageSize: 30 });

    const url = new URL(String(fetchRunner.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/v3/special/song');
    expect(url.searchParams.get('specialid')).toBe('8899');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('pagesize')).toBe('30');
    expect(playlist).toMatchObject({
      provider: 'kugou',
      providerPlaylistId: '8899',
      title: 'KuGou Mix',
      total: 1,
      hasMore: false,
    });
    expect(playlist.tracks[0]).toMatchObject({ title: 'Playlist Song', artist: 'Playlist Artist' });
  });

  it('bridges KuGou lyrics provider results into streaming lyrics', async () => {
    const lrc = '[00:01.00]hello';
    const fetchRunner = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/song/info')) {
        return jsonResponse({
          data: {
            hash: 'cccccc1234567890cccccc1234567890',
            album_id: '1',
            album_audio_id: 2,
            songname: 'Lyric Song',
            singername: 'Lyric Artist',
            AlbumName: 'Lyric Album',
            duration: 180,
          },
        });
      }
      if (url.includes('/api/v3/search/song')) {
        return jsonResponse({
          data: {
            info: [
              {
                hash: 'cccccc1234567890cccccc1234567890',
                songname: 'Lyric Song',
                singername: 'Lyric Artist',
                AlbumName: 'Lyric Album',
                duration: 180,
              },
            ],
          },
        });
      }
      if (url.includes('lyrics.kugou.com/search')) {
        return jsonResponse({ candidates: [{ id: 'lyric-id', accesskey: 'access-key', song: 'Lyric Song', singer: 'Lyric Artist', duration: 180000 }] });
      }
      if (url.includes('lyrics.kugou.com/download')) {
        return jsonResponse({ content: Buffer.from(lrc, 'utf8').toString('base64') });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new KugouStreamingProvider().getLyrics({ providerTrackId: 'cccccc1234567890cccccc1234567890.1.2' });

    expect(result).toMatchObject({
      provider: 'kugou',
      providerTrackId: 'cccccc1234567890cccccc1234567890.1.2',
      status: 'available',
      syncedLyrics: lrc,
      sourceLabel: 'KuGou',
    });
    expect(result.lines[0]).toMatchObject({ timeMs: 1000, text: 'hello' });
  });

  it('falls back through playback qualities and returns the first playable URL', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 1, data: {} }))
      .mockResolvedValueOnce(jsonResponse({ status: 1, data: { url: 'https://fs.open.kugou.com/audio.mp3' } }));
    vi.stubGlobal('fetch', fetchRunner);

    const source = await resolveKugouPlaybackUrl({
      provider: 'kugou',
      providerTrackId: 'dddddd1234567890dddddd1234567890.55.66',
      quality: 'high',
    });

    const firstUrl = new URL(String(fetchRunner.mock.calls[0][0]));
    const secondUrl = new URL(String(fetchRunner.mock.calls[1][0]));
    expect(firstUrl.pathname).toBe('/v5/url');
    expect(firstUrl.searchParams.get('quality')).toBe('320');
    expect(firstUrl.searchParams.get('hash')).toBe('dddddd1234567890dddddd1234567890');
    expect(firstUrl.searchParams.get('album_id')).toBe('55');
    expect(firstUrl.searchParams.get('album_audio_id')).toBe('66');
    expect(firstUrl.searchParams.get('key')).toBeTruthy();
    expect(firstUrl.searchParams.get('signature')).toBeTruthy();
    expect(secondUrl.searchParams.get('quality')).toBe('128');
    expect(source).toMatchObject({
      provider: 'kugou',
      providerTrackId: 'dddddd1234567890dddddd1234567890.55.66',
      url: 'https://fs.open.kugou.com/audio.mp3',
      bitrate: 128000,
      codec: 'mp3',
      supportsRange: true,
    });
  });

  it('defaults KuGou playback to lossless quality', async () => {
    const fetchRunner = vi.fn().mockResolvedValueOnce(jsonResponse({ status: 1, data: { url: 'https://fs.open.kugou.com/audio.flac' } }));
    vi.stubGlobal('fetch', fetchRunner);

    const source = await resolveKugouPlaybackUrl({
      provider: 'kugou',
      providerTrackId: 'dddddd1234567890dddddd1234567890.55.66',
    });

    const url = new URL(String(fetchRunner.mock.calls[0][0]));
    expect(url.searchParams.get('quality')).toBe('flac');
    expect(source).toMatchObject({
      url: 'https://fs.open.kugou.com/audio.flac',
      bitrate: 999000,
      codec: 'flac',
    });
  });

  it('throws a clear playback error when KuGou returns no URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 2, errcode: 20028, error: 'need verification' })));

    await expect(
      resolveKugouPlaybackUrl({
        provider: 'kugou',
        providerTrackId: 'eeeeee1234567890eeeeee1234567890',
        quality: 'standard',
      }),
    ).rejects.toThrow('need verification');
  });
});
