import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  streamingProviderNames,
  type StreamingAlbumDetail,
  type StreamingPlaybackSource,
  type StreamingPlaylistDetail,
  type StreamingSearchResult,
  type StreamingTrack,
} from '../../shared/types/streaming';
import type { StreamingProvider } from './StreamingProvider';
import { StreamingProviderRegistry } from './StreamingProviderRegistry';
import { getStreamingProviderDescriptors, StreamingService } from './StreamingService';
import { StreamingFavoritesStore } from './StreamingFavoritesStore';
import { verifyDownloadAuthorizationToken } from '../downloads/DownloadAuthorization';

const accountState = vi.hoisted(() => ({
  connected: true,
  cookie: 'MUSIC_U=secret; csrf=hidden',
}));

vi.mock('../accounts/AccountService', () => ({
  getAccountService: () => ({
    getStatus: (provider: string) => ({
      provider,
      connected: accountState.connected,
      username: accountState.connected ? 'tester' : null,
      displayName: accountState.connected ? 'Tester' : null,
      avatarUrl: null,
      lastLoginAt: accountState.connected ? '2026-01-01T00:00:00.000Z' : null,
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

const redirectResponse = (location: string): Response =>
  new Response(null, {
    status: 302,
    headers: { location },
  });

const playlistDetail = (providerPlaylistId: string): StreamingPlaylistDetail => ({
  id: `streaming:qqmusic:playlist:${providerPlaylistId}`,
  provider: 'qqmusic',
  providerPlaylistId,
  title: 'QQ Playlist',
  description: null,
  creator: null,
  coverUrl: null,
  coverThumb: null,
  trackCount: 0,
  tracks: [],
  page: 1,
  pageSize: 500,
  total: 0,
  hasMore: false,
});

const emptyQqSearchResult = (): StreamingSearchResult => ({
  provider: 'qqmusic',
  query: '',
  page: 1,
  pageSize: 20,
  total: 0,
  hasMore: false,
  tracks: [],
  albums: [],
  artists: [],
  playlists: [],
  mvs: [],
});

const favoriteTrack = (providerTrackId: string, provider: StreamingTrack['provider'] = 'youtube'): StreamingTrack => ({
  id: `streaming:${provider}:${providerTrackId}`,
  provider,
  providerTrackId,
  stableKey: `streaming:${provider}:${providerTrackId}`,
  title: `Video ${providerTrackId}`,
  artist: 'Video Artist',
  artists: [],
  album: provider === 'bilibili' ? 'Bilibili' : 'YouTube',
  albumId: null,
  albumArtist: 'Video Artist',
  duration: 120,
  coverUrl: null,
  coverThumb: null,
  qualities: ['high'],
  explicit: false,
  playable: true,
  unavailableReason: null,
  lyricsStatus: 'unknown',
  mvStatus: 'available',
});

const albumDetail = (): StreamingAlbumDetail => ({
  id: 'streaming:netease:album:album-1',
  provider: 'netease',
  providerAlbumId: 'album-1',
  title: 'Album One',
  artist: 'Artist One',
  artists: [],
  coverUrl: null,
  coverThumb: null,
  releaseDate: '2026',
  trackCount: 1,
  tracks: [
    {
      id: 'streaming:netease:track:track-1',
      provider: 'netease',
      providerTrackId: 'track-1',
      stableKey: 'streaming:netease:track-1',
      title: 'Track One',
      artist: 'Artist One',
      artists: [],
      album: 'Album One',
      albumId: 'album-1',
      albumArtist: 'Artist One',
      duration: 180,
      coverUrl: null,
      coverThumb: null,
      qualities: ['high'],
      explicit: false,
      playable: true,
      unavailableReason: null,
      lyricsStatus: 'unknown',
      mvStatus: 'unknown',
    },
  ],
});

const fakeCacheStore = (): ConstructorParameters<typeof StreamingService>[1] =>
  ({
    importStreamingPlaylistPage: (playlist: StreamingPlaylistDetail, options: { startPosition: number }) => ({
      playlist: {
        id: 'playlist-1',
        name: playlist.title,
        description: playlist.description,
        kind: 'synced',
        sourceProvider: playlist.provider,
        sourcePlaylistId: playlist.providerPlaylistId,
        coverId: null,
        coverThumb: playlist.coverThumb,
        sortMode: 'manual',
        itemCount: playlist.tracks.length,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      nextPosition: options.startPosition + playlist.tracks.length,
    }),
  }) as unknown as ConstructorParameters<typeof StreamingService>[1];

const fakeAlbumCacheStore = () => ({
  getApiCache: vi.fn(() => null),
  upsertTracks: vi.fn(),
  setApiCache: vi.fn(),
}) as unknown as ConstructorParameters<typeof StreamingService>[1] & {
  getApiCache: ReturnType<typeof vi.fn>;
  upsertTracks: ReturnType<typeof vi.fn>;
  setApiCache: ReturnType<typeof vi.fn>;
};

describe('StreamingService playlist imports', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    accountState.connected = true;
    accountState.cookie = 'MUSIC_U=secret; csrf=hidden';
  });

  it('returns provider descriptors from a lightweight registry', () => {
    const descriptors = getStreamingProviderDescriptors();

    expect(descriptors.map((provider) => provider.name)).toEqual(streamingProviderNames);
    expect(descriptors.find((provider) => provider.name === 'netease')).toMatchObject({
      enabled: true,
      supportsSearch: true,
      supportsPlayback: true,
    });
    expect(descriptors.find((provider) => provider.name === 'kugou')).toMatchObject({
      enabled: true,
      supportsSearch: true,
      supportsPlayback: true,
      supportsDownload: true,
    });
  });

  it('resolves QQ Music c6 share links before importing playlists', async () => {
    const registry = new StreamingProviderRegistry();
    const getPlaylist = vi.fn(async (input: { providerPlaylistId: string; page?: number; pageSize?: number }) =>
      playlistDetail(input.providerPlaylistId),
    );
    const provider: StreamingProvider = {
      name: 'qqmusic',
      search: vi.fn(async () => emptyQqSearchResult()),
      getTrack: vi.fn(),
      getPlaylist,
      resolvePlayback: vi.fn(),
    };
    registry.register(provider);
    const service = new StreamingService(registry, fakeCacheStore());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        redirectResponse('https://i.y.qq.com/n2/m/share/details/taoge.html?ADTAG=pc_v17&channelId=10036163&id=9712626873&openinqqmusic=1'),
      ),
    );

    const result = await service.importPlaylistFromUrl('https://c6.y.qq.com/base/fcgi-bin/u?__=xJV4sRoZMZIT');

    expect(getPlaylist).toHaveBeenCalledWith({ providerPlaylistId: '9712626873', page: 1, pageSize: 500 });
    expect(result).toMatchObject({
      provider: 'qqmusic',
      providerPlaylistId: '9712626873',
      playlistName: 'QQ Playlist',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://c6.y.qq.com/base/fcgi-bin/u?__=xJV4sRoZMZIT',
      expect.objectContaining({
        redirect: 'manual',
        headers: expect.objectContaining({ Referer: 'https://y.qq.com/' }),
      }),
    );
  });

  it('falls back when Electron cancels manual QQ Music share redirects', async () => {
    const registry = new StreamingProviderRegistry();
    const getPlaylist = vi.fn(async (input: { providerPlaylistId: string; page?: number; pageSize?: number }) =>
      playlistDetail(input.providerPlaylistId),
    );
    registry.register({
      name: 'qqmusic',
      search: vi.fn(async () => emptyQqSearchResult()),
      getTrack: vi.fn(),
      getPlaylist,
      resolvePlayback: vi.fn(),
    });
    const service = new StreamingService(registry, fakeCacheStore());
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('Redirect was cancelled'))
        .mockResolvedValueOnce(
          redirectResponse('https://i.y.qq.com/n2/m/share/details/taoge.html?ADTAG=pc_v17&channelId=10036163&id=7592105337&openinqqmusic=1'),
        ),
    );

    const result = await service.importPlaylistFromUrl('https://c6.y.qq.com/base/fcgi-bin/u?__=FAsuDZNxMYUi');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getPlaylist).toHaveBeenCalledWith({ providerPlaylistId: '7592105337', page: 1, pageSize: 500 });
    expect(result.providerPlaylistId).toBe('7592105337');
  });

  it('imports normal QQ Music playlist links without resolving redirects', async () => {
    const registry = new StreamingProviderRegistry();
    const getPlaylist = vi.fn(async (input: { providerPlaylistId: string; page?: number; pageSize?: number }) =>
      playlistDetail(input.providerPlaylistId),
    );
    registry.register({
      name: 'qqmusic',
      search: vi.fn(),
      getTrack: vi.fn(),
      getPlaylist,
      resolvePlayback: vi.fn(),
    });
    const service = new StreamingService(registry, fakeCacheStore());
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));

    const result = await service.importPlaylistFromUrl('https://y.qq.com/n/ryqq/playlist/778899');

    expect(fetch).not.toHaveBeenCalled();
    expect(getPlaylist).toHaveBeenCalledWith({ providerPlaylistId: '778899', page: 1, pageSize: 500 });
    expect(result.providerPlaylistId).toBe('778899');
  });

  it('imports NetEase djradio links as podcast playlists', async () => {
    const registry = new StreamingProviderRegistry();
    const getPlaylist = vi.fn(
      async (input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> => ({
        id: `streaming:netease:playlist:${input.providerPlaylistId}`,
        provider: 'netease',
        providerPlaylistId: input.providerPlaylistId,
        title: 'NetEase Podcast',
        description: null,
        creator: null,
        coverUrl: null,
        coverThumb: null,
        trackCount: 0,
        tracks: [],
        page: 1,
        pageSize: 500,
        total: 0,
        hasMore: false,
      }),
    );
    registry.register({
      name: 'netease',
      search: vi.fn(),
      getTrack: vi.fn(),
      getPlaylist,
      resolvePlayback: vi.fn(),
    });
    const service = new StreamingService(registry, fakeCacheStore());

    const result = await service.importPlaylistFromUrl(
      'https://music.163.com/djradio?id=990232286&uct2=U2FsdGVkX1+uX3WDBvtPy2zyTiXl9QgSbvHnjmvo9EQ=',
    );

    expect(getPlaylist).toHaveBeenCalledWith({ providerPlaylistId: 'djradio:990232286', page: 1, pageSize: 500 });
    expect(getPlaylist).not.toHaveBeenCalledWith({ providerPlaylistId: '990232286', page: 1, pageSize: 500 });
    expect(result).toMatchObject({
      provider: 'netease',
      providerPlaylistId: 'djradio:990232286',
      playlistName: 'NetEase Podcast',
    });
  });

  it('imports QQ Music mobile, desktop, hash, and copied-share playlist link variants', async () => {
    const registry = new StreamingProviderRegistry();
    const getPlaylist = vi.fn(async (input: { providerPlaylistId: string; page?: number; pageSize?: number }) =>
      playlistDetail(input.providerPlaylistId),
    );
    registry.register({
      name: 'qqmusic',
      search: vi.fn(),
      getTrack: vi.fn(),
      getPlaylist,
      resolvePlayback: vi.fn(),
    });
    const service = new StreamingService(registry, fakeCacheStore());
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));

    const inputs = [
      ['https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=9718644800', '9718644800'],
      ['https://i.y.qq.com/n2/m/share/details/taoge.html?ADTAG=ryqq.playlist&id=9102222552', '9102222552'],
      ['https://y.qq.com/n/yqq/playlist/7177076625.html', '7177076625'],
      ['https://y.qq.com/musicmac/v6/playlist/detail.html?id=7177076626', '7177076626'],
      ['https://y.qq.com/portal/playlist.html#id=9718644801', '9718644801'],
      ['分享测试创建的歌单「测试」https://y.qq.com/n/m/detail/taoge/index.html?id=9196185963 (@QQ音乐)', '9196185963'],
      ['https://example.com/share?redirect=https%3A%2F%2Fy.qq.com%2Fn%2Fryqq%2Fplaylist%2F7373560897', '7373560897'],
    ] as const;

    expect(fetch).not.toHaveBeenCalled();
    for (const [input, expectedId] of inputs) {
      const result = await service.importPlaylistFromUrl(input);
      expect(result.providerPlaylistId).toBe(expectedId);
    }

    inputs.forEach(([, expectedId], index) => {
      expect(getPlaylist).toHaveBeenNthCalledWith(index + 1, { providerPlaylistId: expectedId, page: 1, pageSize: 500 });
    });
  });

  it('imports KuGou special playlist link variants without resolving redirects', async () => {
    const registry = new StreamingProviderRegistry();
    const getPlaylist = vi.fn(
      async (input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> => ({
        id: `streaming:kugou:playlist:${input.providerPlaylistId}`,
        provider: 'kugou',
        providerPlaylistId: input.providerPlaylistId,
        title: 'KuGou Playlist',
        description: null,
        creator: null,
        coverUrl: null,
        coverThumb: null,
        trackCount: 0,
        tracks: [],
        page: 1,
        pageSize: 500,
        total: 0,
        hasMore: false,
      }),
    );
    registry.register({
      name: 'kugou',
      search: vi.fn(),
      getTrack: vi.fn(),
      getPlaylist,
      resolvePlayback: vi.fn(),
    });
    const service = new StreamingService(registry, fakeCacheStore());
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));

    const inputs = [
      ['https://www.kugou.com/yy/special/single/889900.html', '889900'],
      ['https://www.kugou.com/songlist/gcid_778899.html', '778899'],
      ['https://m.kugou.com/plist/list/667788?specialid=667788', '667788'],
      ['https://example.com/share?url=https%3A%2F%2Fwww.kugou.com%2Fyy%2Fspecial%2Fsingle%2F556677.html', '556677'],
    ] as const;

    expect(fetch).not.toHaveBeenCalled();
    for (const [input, expectedId] of inputs) {
      const result = await service.importPlaylistFromUrl(input);
      expect(result).toMatchObject({
        provider: 'kugou',
        providerPlaylistId: expectedId,
        playlistName: 'KuGou Playlist',
      });
    }
    expect(getPlaylist).toHaveBeenCalledTimes(inputs.length);
  });

  it('rejects QQ Music taoge pages when no numeric playlist id is present', async () => {
    const registry = new StreamingProviderRegistry();
    registry.register({
      name: 'qqmusic',
      search: vi.fn(),
      getTrack: vi.fn(),
      getPlaylist: vi.fn(),
      resolvePlayback: vi.fn(),
    });
    const service = new StreamingService(registry, fakeCacheStore());

    await expect(service.importPlaylistFromUrl('https://y.qq.com/n/m/detail/taoge/index.html')).rejects.toThrow(
      'Only NetEase Cloud Music playlists or podcasts, QQ Music, KuGou Music, and Spotify playlist links are supported.',
    );
  });

  it('imports Spotify playlist links without resolving playback URLs', async () => {
    const registry = new StreamingProviderRegistry();
    const getPlaylist = vi.fn(async (input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> => ({
      id: `streaming:spotify:playlist:${input.providerPlaylistId}`,
      provider: 'spotify',
      providerPlaylistId: input.providerPlaylistId,
      title: 'Spotify Playlist',
      description: null,
      creator: null,
      coverUrl: null,
      coverThumb: null,
      trackCount: 0,
      tracks: [],
      page: 1,
      pageSize: 500,
      total: 0,
      hasMore: false,
    }));
    const resolvePlayback = vi.fn();
    registry.register({
      name: 'spotify',
      descriptor: {
        displayName: 'Spotify',
        enabled: true,
        supportsSearch: true,
        supportsPlayback: true,
        supportsDownload: false,
        supportsLyrics: false,
        supportsMv: false,
        requiresAccount: true,
      },
      search: vi.fn(),
      getTrack: vi.fn(),
      getPlaylist,
      resolvePlayback,
    });
    const service = new StreamingService(registry, fakeCacheStore());

    const result = await service.importPlaylistFromUrl('https://open.spotify.com/playlist/5MFN2Ep3ZU2FIQWIXNSLrT?si=866d26088e4a4a47');

    expect(getPlaylist).toHaveBeenCalledWith({ providerPlaylistId: '5MFN2Ep3ZU2FIQWIXNSLrT', page: 1, pageSize: 500 });
    expect(resolvePlayback).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: 'spotify',
      providerPlaylistId: '5MFN2Ep3ZU2FIQWIXNSLrT',
      playlistName: 'Spotify Playlist',
    });
  });

  it('imports YouTube playlist links into streaming favorites', async () => {
    const registry = new StreamingProviderRegistry();
    const getPlaylist = vi.fn(async (input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> => ({
      id: `streaming:youtube:playlist:${input.providerPlaylistId}`,
      provider: 'youtube',
      providerPlaylistId: input.providerPlaylistId,
      title: 'YouTube Favorites',
      description: null,
      creator: null,
      coverUrl: null,
      coverThumb: null,
      trackCount: 2,
      tracks: [favoriteTrack('video-1'), favoriteTrack('video-2')],
      page: 1,
      pageSize: 100,
      total: 2,
      hasMore: false,
    }));
    registry.register({
      name: 'youtube',
      search: vi.fn(),
      getTrack: vi.fn(),
      getPlaylist,
      resolvePlayback: vi.fn(),
    });
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-streaming-favorites-service-'));
    try {
      const favoritesStore = new StreamingFavoritesStore(join(tempRoot, 'streaming-favorites.json'));
      const service = new StreamingService(registry, fakeCacheStore(), undefined, undefined, undefined, favoritesStore);

      const result = await service.importFavoritesFromUrl('https://www.youtube.com/playlist?list=PL123');

      expect(getPlaylist).toHaveBeenCalledWith({ providerPlaylistId: 'PL123', page: 1, pageSize: 100 });
      expect(result).toMatchObject({
        provider: 'youtube',
        providerPlaylistId: 'PL123',
        collectionId: 'streaming-favorites:youtube:PL123',
        playlistName: 'YouTube Favorites',
        importedCount: 2,
        addedCount: 2,
      });
      expect(result.snapshot.providers.youtube).toEqual([]);
      expect(result.snapshot.collections[0]).toMatchObject({
        id: 'streaming-favorites:youtube:PL123',
        provider: 'youtube',
        providerPlaylistId: 'PL123',
        name: 'YouTube Favorites',
      });
      expect(result.snapshot.collections[0].tracks.map((item) => item.providerTrackId)).toEqual(['video-1', 'video-2']);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('syncs imported streaming favorite collections from the stored source id', async () => {
    const registry = new StreamingProviderRegistry();
    const getPlaylist = vi.fn(async (input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> => ({
      id: `streaming:youtube:playlist:${input.providerPlaylistId}`,
      provider: 'youtube',
      providerPlaylistId: input.providerPlaylistId,
      title: 'YouTube Favorites',
      description: null,
      creator: null,
      coverUrl: null,
      coverThumb: null,
      trackCount: 2,
      tracks: [favoriteTrack('video-1'), favoriteTrack('video-2')],
      page: 1,
      pageSize: 100,
      total: 2,
      hasMore: false,
    }));
    registry.register({
      name: 'youtube',
      search: vi.fn(),
      getTrack: vi.fn(),
      getPlaylist,
      resolvePlayback: vi.fn(),
    });
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-streaming-favorites-service-'));
    try {
      const favoritesStore = new StreamingFavoritesStore(join(tempRoot, 'streaming-favorites.json'));
      favoritesStore.importCollection('youtube', 'PL123', 'YouTube Favorites', [favoriteTrack('video-1')]);
      const service = new StreamingService(registry, fakeCacheStore(), undefined, undefined, undefined, favoritesStore);

      const result = await service.syncFavoriteCollection('streaming-favorites:youtube:PL123');

      expect(getPlaylist).toHaveBeenCalledWith({ providerPlaylistId: 'PL123', page: 1, pageSize: 100 });
      expect(result).toMatchObject({
        provider: 'youtube',
        providerPlaylistId: 'PL123',
        collectionId: 'streaming-favorites:youtube:PL123',
        importedCount: 2,
        addedCount: 1,
      });
      expect(result.snapshot.collections[0].tracks.map((item) => item.providerTrackId)).toEqual(['video-1', 'video-2']);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps Bilibili favlist URLs intact for provider requests and stores the canonical media id', async () => {
    const favlistUrl = 'https://space.bilibili.com/25265128/favlist?fid=2433003328&ftype=create';
    const registry = new StreamingProviderRegistry();
    const getPlaylist = vi.fn(async (input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> => ({
      id: 'streaming:bilibili:playlist:2433003328',
      provider: 'bilibili',
      providerPlaylistId: '2433003328',
      title: 'coop哥',
      description: null,
      creator: 'Moekotori',
      coverUrl: null,
      coverThumb: null,
      trackCount: 1,
      tracks: [favoriteTrack('BV16J411w7xW', 'bilibili')],
      page: 1,
      pageSize: 50,
      total: 1,
      hasMore: false,
    }));
    registry.register({
      name: 'bilibili',
      search: vi.fn(),
      getTrack: vi.fn(),
      getPlaylist,
      resolvePlayback: vi.fn(),
    });
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-streaming-favorites-service-'));
    try {
      const favoritesStore = new StreamingFavoritesStore(join(tempRoot, 'streaming-favorites.json'));
      const service = new StreamingService(registry, fakeCacheStore(), undefined, undefined, undefined, favoritesStore);

      const result = await service.importFavoritesFromUrl(favlistUrl);

      expect(getPlaylist).toHaveBeenCalledWith({ providerPlaylistId: favlistUrl, page: 1, pageSize: 100 });
      expect(result).toMatchObject({
        provider: 'bilibili',
        providerPlaylistId: '2433003328',
        collectionId: 'streaming-favorites:bilibili:2433003328',
        playlistName: 'coop哥',
        importedCount: 1,
        addedCount: 1,
      });
      expect(result.snapshot.collections[0]).toMatchObject({
        provider: 'bilibili',
        providerPlaylistId: '2433003328',
        name: 'coop哥',
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('exposes Spotify as playback-only and not downloadable in provider descriptors', () => {
    const registry = new StreamingProviderRegistry();
    registry.register({
      name: 'spotify',
      descriptor: {
        displayName: 'Spotify',
        enabled: true,
        supportsSearch: true,
        supportsPlayback: true,
        supportsDownload: false,
        supportsLyrics: false,
        supportsMv: false,
        requiresAccount: true,
      },
      search: vi.fn(),
      getTrack: vi.fn(),
      resolvePlayback: vi.fn(),
    });

    expect(registry.list().find((provider) => provider.name === 'spotify')).toMatchObject({
      name: 'spotify',
      supportsPlayback: true,
      supportsDownload: false,
      requiresAccount: true,
    });
  });

  it('returns streaming album details before persisting the album cache', async () => {
    vi.useFakeTimers();
    const registry = new StreamingProviderRegistry();
    const cacheStore = fakeAlbumCacheStore();
    const detail = albumDetail();
    registry.register({
      name: 'netease',
      search: vi.fn(),
      getTrack: vi.fn(),
      getAlbum: vi.fn(async () => detail),
      resolvePlayback: vi.fn(),
    });
    const service = new StreamingService(registry, cacheStore, undefined, undefined, () => false);

    const albumPromise = service.getAlbum('netease', 'album-1');
    await vi.advanceTimersByTimeAsync(150);
    const result = await albumPromise;

    expect(result.title).toBe('Album One');
    expect(cacheStore.upsertTracks).not.toHaveBeenCalled();
    expect(cacheStore.setApiCache).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(cacheStore.upsertTracks).toHaveBeenCalledWith(result.tracks);
    expect(cacheStore.setApiCache).toHaveBeenCalledWith('netease', 'album', 'album:v10:netease:album-1', result, expect.any(String));
  });

  it('keeps streaming album cache writes deferred while playback is active', async () => {
    vi.useFakeTimers();
    const registry = new StreamingProviderRegistry();
    const cacheStore = fakeAlbumCacheStore();
    registry.register({
      name: 'netease',
      search: vi.fn(),
      getTrack: vi.fn(),
      getAlbum: vi.fn(async () => albumDetail()),
      resolvePlayback: vi.fn(),
    });
    const service = new StreamingService(registry, cacheStore, undefined, undefined, () => true);

    const albumPromise = service.getAlbum('netease', 'album-1');
    await vi.advanceTimersByTimeAsync(150);
    await albumPromise;
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(1499);

    expect(cacheStore.upsertTracks).not.toHaveBeenCalled();
    expect(cacheStore.setApiCache).not.toHaveBeenCalled();
  });

  it('attaches a short-lived download authorization to protected playback sources', async () => {
    const registry = new StreamingProviderRegistry();
    registry.register({
      name: 'qqmusic',
      search: vi.fn(),
      getTrack: vi.fn(),
      resolvePlayback: vi.fn(async (): Promise<StreamingPlaybackSource> => ({
        provider: 'qqmusic',
        providerTrackId: 'song-mid',
        url: 'https://isure.stream.qqmusic.qq.com/song.flac',
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        mimeType: 'audio/flac',
        bitrate: 999000,
        sampleRate: null,
        bitDepth: 16,
        codec: 'flac',
        headers: {},
        requiresProxy: false,
        supportsRange: true,
      })),
    });
    const service = new StreamingService(registry, fakeCacheStore());

    const source = await service.resolvePlayback({ provider: 'qqmusic', providerTrackId: 'song-mid', quality: 'lossless' });

    expect(source.downloadAuthorizationToken).toEqual(expect.any(String));
    expect(
      verifyDownloadAuthorizationToken(source.downloadAuthorizationToken, {
        provider: 'qqmusic',
        providerTrackId: 'song-mid',
        url: 'https://isure.stream.qqmusic.qq.com/song.flac',
      }),
    ).toBe(true);
  });

  it('normalizes omitted playback quality to lossless before resolving sources', async () => {
    const resolvePlayback = vi.fn(async (): Promise<StreamingPlaybackSource> => ({
      provider: 'qqmusic',
      providerTrackId: 'song-mid',
      url: 'https://isure.stream.qqmusic.qq.com/song.flac',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      mimeType: 'audio/flac',
      bitrate: 999000,
      sampleRate: null,
      bitDepth: 16,
      codec: 'flac',
      headers: {},
      requiresProxy: false,
      supportsRange: true,
    }));
    const registry = new StreamingProviderRegistry();
    registry.register({
      name: 'qqmusic',
      search: vi.fn(),
      getTrack: vi.fn(),
      resolvePlayback,
    });
    const service = new StreamingService(registry, fakeCacheStore());

    await service.resolvePlayback({ provider: 'qqmusic', providerTrackId: 'song-mid' });

    expect(resolvePlayback).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'qqmusic',
      providerTrackId: 'song-mid',
      quality: 'lossless',
    }));
  });

  it('attaches protected download authorization to KuGou playback sources', async () => {
    const registry = new StreamingProviderRegistry();
    registry.register({
      name: 'kugou',
      search: vi.fn(),
      getTrack: vi.fn(),
      resolvePlayback: vi.fn(async (): Promise<StreamingPlaybackSource> => ({
        provider: 'kugou',
        providerTrackId: 'abcdef1234567890abcdef1234567890.1.2',
        url: 'https://fs.open.kugou.com/song.mp3',
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        mimeType: 'audio/mpeg',
        bitrate: 320000,
        sampleRate: null,
        bitDepth: null,
        codec: 'mp3',
        headers: {},
        requiresProxy: false,
        supportsRange: true,
      })),
    });
    accountState.cookie = 'dfid=DFID123; kg_mid=123';
    const service = new StreamingService(registry, fakeCacheStore());

    const source = await service.resolvePlayback({
      provider: 'kugou',
      providerTrackId: 'abcdef1234567890abcdef1234567890.1.2',
      quality: 'high',
    });

    expect(source.downloadAuthorizationToken).toEqual(expect.any(String));
    expect(
      verifyDownloadAuthorizationToken(source.downloadAuthorizationToken, {
        provider: 'kugou',
        providerTrackId: 'abcdef1234567890abcdef1234567890.1.2',
        url: 'https://fs.open.kugou.com/song.mp3',
      }),
    ).toBe(true);
  });

  it('does not attach protected download authorization when the platform account is not connected', async () => {
    accountState.connected = false;
    accountState.cookie = '';
    const registry = new StreamingProviderRegistry();
    registry.register({
      name: 'qqmusic',
      search: vi.fn(),
      getTrack: vi.fn(),
      resolvePlayback: vi.fn(async (): Promise<StreamingPlaybackSource> => ({
        provider: 'qqmusic',
        providerTrackId: 'song-mid',
        url: 'https://isure.stream.qqmusic.qq.com/song.flac',
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        mimeType: 'audio/flac',
        bitrate: 999000,
        sampleRate: null,
        bitDepth: 16,
        codec: 'flac',
        headers: {},
        requiresProxy: false,
        supportsRange: true,
      })),
    });
    const service = new StreamingService(registry, fakeCacheStore());

    const source = await service.resolvePlayback({ provider: 'qqmusic', providerTrackId: 'song-mid', quality: 'lossless' });

    expect(source.downloadAuthorizationToken).toBeUndefined();
  });

  it('allows playback URL resolution to take longer than normal metadata calls', async () => {
    vi.useFakeTimers();
    const registry = new StreamingProviderRegistry();
    registry.register({
      name: 'netease',
      search: vi.fn(),
      getTrack: vi.fn(),
      resolvePlayback: vi.fn(() =>
        new Promise<StreamingPlaybackSource>((resolve) => {
          setTimeout(() => {
            resolve({
              provider: 'netease',
              providerTrackId: 'song-id',
              url: 'https://m701.music.126.net/token/song.flac',
              expiresAt: new Date(Date.now() + 120_000).toISOString(),
              mimeType: 'audio/flac',
              bitrate: 999000,
              sampleRate: null,
              bitDepth: 16,
              codec: 'flac',
              headers: {},
              requiresProxy: false,
              supportsRange: true,
            });
          }, 11_000);
        })),
    });
    const service = new StreamingService(registry, fakeCacheStore());

    const sourcePromise = service.resolvePlayback({ provider: 'netease', providerTrackId: 'song-id', quality: 'lossless' });
    await vi.advanceTimersByTimeAsync(11_500);

    await expect(sourcePromise).resolves.toMatchObject({
      url: 'https://m701.music.126.net/token/song.flac',
      codec: 'flac',
    });
  });
});
