import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeteaseStreamingProvider, setNeteaseApiForTests } from './NeteaseStreamingProvider';
import { QQMusicStreamingProvider } from './QQMusicStreamingProvider';

const accountStatus = vi.hoisted(() => ({
  connected: true,
  displayName: 'Tester',
  username: 'tester',
  avatarUrl: null,
  qqCookie: 'uin=o123456; qm_keyst=secret',
  neteaseCookie: 'MUSIC_U=secret; csrf=hidden',
}));

vi.mock('../../accounts/AccountService', () => ({
  getAccountService: () => ({
    getStatus: (provider: string) => ({
      provider,
      connected: accountStatus.connected,
      username: accountStatus.username,
      displayName: accountStatus.displayName,
      avatarUrl: accountStatus.avatarUrl,
      lastLoginAt: '2026-01-01T00:00:00.000Z',
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    }),
    getCredentials: (provider: string) => ({
      provider,
      cookie: provider === 'qqmusic' ? accountStatus.qqCookie : accountStatus.neteaseCookie,
    }),
  }),
}));

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const remoteImageUrl = (url: string, referer: string): string =>
  `echo-image://remote/${encodeURIComponent(url)}?referer=${encodeURIComponent(referer)}`;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setNeteaseApiForTests(undefined);
  accountStatus.connected = true;
  accountStatus.qqCookie = 'uin=o123456; qm_keyst=secret';
  accountStatus.neteaseCookie = 'MUSIC_U=secret; csrf=hidden';
});

describe('China streaming providers', () => {
  it('maps NetEase search results to streaming tracks', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            result: {
              songCount: 1,
              songs: [
                {
                  id: 123,
                  name: '测试歌曲',
                  duration: 181000,
                  artists: [{ id: 1, name: '测试歌手' }],
                  album: { id: 2, name: '测试专辑', picId: 109951 },
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            songs: [
              {
                id: 123,
                album: { picUrl: 'https://p.music.126.net/detail-cover.jpg' },
              },
            ],
          }),
        ),
    );

    const result = await new NeteaseStreamingProvider().search({ provider: 'netease', query: '测试', page: 1, pageSize: 10 });

    expect(result.tracks[0]).toMatchObject({
      provider: 'netease',
      providerTrackId: '123',
      stableKey: 'streaming:netease:123',
      title: '测试歌曲',
      artist: '测试歌手',
      album: '测试专辑',
      duration: 181,
      coverThumb: remoteImageUrl('https://p.music.126.net/detail-cover.jpg?param=160y160', 'https://music.163.com/'),
    });
  });

  it('retries NetEase search with normalized query variants when the exact query is empty', async () => {
    setNeteaseApiForTests(null);
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { songCount: 0, songs: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            songCount: 1,
            songs: [
              {
                id: 321,
                name: 'Echo Lab',
                duration: 181000,
                artists: [{ id: 1, name: 'Variant Artist' }],
                album: { id: 2, name: 'Variant Album' },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          songs: [
            {
              id: 321,
              album: { picUrl: 'https://p.music.126.net/variant-cover.jpg' },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new NeteaseStreamingProvider().search({ provider: 'netease', query: 'Echo-Lab', page: 1, pageSize: 10 });

    expect(result.query).toBe('Echo-Lab');
    expect(result.tracks[0]).toMatchObject({
      providerTrackId: '321',
      title: 'Echo Lab',
    });
    expect(String(fetchRunner.mock.calls[0][0])).toContain('s=Echo-Lab');
    expect(String(fetchRunner.mock.calls[1][0])).toContain('s=Echo+Lab');
  });

  it('falls back to the NetEase enhanced cloud search when the public search is empty', async () => {
    const cloudsearch = vi.fn().mockResolvedValue({
      body: {
        result: {
          songCount: 1,
          songs: [
            {
              id: 654,
              name: 'Cloud Song',
              dt: 182000,
              ar: [{ id: 7, name: 'Cloud Artist' }],
              al: { id: 8, name: 'Cloud Album' },
            },
          ],
        },
      },
    });
    setNeteaseApiForTests({ cloudsearch });
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { songCount: 0, songs: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          songs: [
            {
              id: 654,
              album: { picUrl: 'https://p.music.126.net/cloud-cover.jpg' },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new NeteaseStreamingProvider().search({ provider: 'netease', query: 'cloud', page: 1, pageSize: 10 });

    expect(cloudsearch).toHaveBeenCalledWith({
      keywords: 'cloud',
      type: 1,
      limit: 10,
      offset: 0,
      cookie: 'MUSIC_U=secret; csrf=hidden',
    });
    expect(result.tracks[0]).toMatchObject({
      providerTrackId: '654',
      title: 'Cloud Song',
      artist: 'Cloud Artist',
      album: 'Cloud Album',
      coverThumb: remoteImageUrl('https://p.music.126.net/cloud-cover.jpg?param=160y160', 'https://music.163.com/'),
    });
  });

  it('cools down NetEase enhanced cloud search after frequent operation responses', async () => {
    const cloudsearch = vi
      .fn()
      .mockRejectedValueOnce({
        status: 405,
        body: { code: 405, msg: '操作频繁，请稍候再试', message: '操作频繁，请稍候再试' },
      })
      .mockResolvedValue({
        body: {
          result: {
            songCount: 1,
            songs: [
              {
                id: 655,
                name: 'Should Stay Cool',
                dt: 181000,
                ar: [{ id: 7, name: 'Cloud Artist' }],
                al: { id: 8, name: 'Cloud Album' },
              },
            ],
          },
        },
      });
    setNeteaseApiForTests({ cloudsearch });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ result: { songCount: 0, songs: [] } }))),
    );

    const first = await new NeteaseStreamingProvider().search({ provider: 'netease', query: 'cloud', page: 1, pageSize: 10 });
    const second = await new NeteaseStreamingProvider().search({ provider: 'netease', query: 'cloud', page: 1, pageSize: 10 });

    expect(first.tracks).toHaveLength(0);
    expect(second.tracks).toHaveLength(0);
    expect(cloudsearch).toHaveBeenCalledTimes(1);
  });

  it('maps NetEase album search results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          result: {
            albumCount: 1,
            albums: [
              {
                id: 456,
                name: '测试专辑',
                publishTime: 1767225600000,
                size: 12,
                picUrl: 'https://p.music.126.net/album.jpg',
                artists: [{ id: 1, name: '测试歌手' }],
              },
            ],
          },
        }),
      ),
    );

    const result = await new NeteaseStreamingProvider().search({ provider: 'netease', query: '测试', mediaTypes: ['album'], page: 1, pageSize: 10 });

    expect(result.albums[0]).toMatchObject({
      provider: 'netease',
      providerAlbumId: '456',
      title: '测试专辑',
      artist: '测试歌手',
      trackCount: 12,
      releaseDate: '2026-01-01',
      coverThumb: remoteImageUrl('https://p.music.126.net/album.jpg?param=160y160', 'https://music.163.com/'),
    });
  });

  it('maps NetEase playlist search results', async () => {
    const fetchRunner = vi.fn().mockResolvedValue(
      jsonResponse({
        result: {
          playlistCount: 1,
          playlists: [
            {
              id: 7788,
              name: 'NetEase Playlist',
              trackCount: 42,
              coverImgUrl: 'https://p.music.126.net/playlist.jpg',
              creator: { nickname: 'NetEase DJ' },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new NeteaseStreamingProvider().search({ provider: 'netease', query: 'mix', mediaTypes: ['playlist'], page: 1, pageSize: 10 });

    expect(String(fetchRunner.mock.calls[0][0])).toContain('type=1000');
    expect(result.playlists[0]).toMatchObject({
      provider: 'netease',
      providerPlaylistId: '7788',
      title: 'NetEase Playlist',
      creator: 'NetEase DJ',
      trackCount: 42,
      coverThumb: remoteImageUrl('https://p.music.126.net/playlist.jpg?param=160y160', 'https://music.163.com/'),
    });
  });

  it('loads NetEase album details for clickable streaming albums', async () => {
    setNeteaseApiForTests(null);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          album: {
            id: 456,
            name: 'NetEase Detail Album',
            publishTime: 1767225600000,
            size: 1,
            picUrl: 'https://p.music.126.net/album-detail.jpg',
            artists: [{ id: 1, name: 'Detail Artist' }],
          },
          songs: [
            {
              id: 123,
              name: 'Detail Song',
              duration: 181000,
              artists: [{ id: 1, name: 'Detail Artist' }],
              album: { id: 456, name: 'NetEase Detail Album' },
            },
          ],
        }),
      ),
    );

    const detail = await new NeteaseStreamingProvider().getAlbum({ providerAlbumId: '456' });

    expect(detail).toMatchObject({
      provider: 'netease',
      providerAlbumId: '456',
      title: 'NetEase Detail Album',
      artist: 'Detail Artist',
    });
    expect(detail.tracks[0]).toMatchObject({
      providerTrackId: '123',
      title: 'Detail Song',
    });
  });

  it('loads NetEase album tracks from the enhanced album API shape', async () => {
    const albumApi = vi.fn().mockResolvedValue({
      body: {
        album: {
          id: 457,
          name: 'NetEase API Album',
          publishTime: 1767225600000,
          size: 1,
          picUrl: 'https://p.music.126.net/api-album.jpg',
          artists: [{ id: 1, name: 'API Artist' }],
          songs: [
            {
              id: 124,
              name: 'API Song',
              duration: 181000,
              artists: [{ id: 1, name: 'API Artist' }],
              album: { id: 457, name: 'NetEase API Album' },
            },
          ],
        },
      },
    });
    setNeteaseApiForTests({ album: albumApi });

    const detail = await new NeteaseStreamingProvider().getAlbum({ providerAlbumId: '457' });

    expect(albumApi).toHaveBeenCalledWith(expect.objectContaining({ id: '457', cookie: 'MUSIC_U=secret; csrf=hidden' }));
    expect(detail.tracks).toHaveLength(1);
    expect(detail.tracks[0]).toMatchObject({
      providerTrackId: '124',
      title: 'API Song',
    });
  });

  it('maps NetEase artist search results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          result: {
            artistCount: 1,
            artists: [
              {
                id: 789,
                name: '测试歌手',
                picUrl: 'https://p.music.126.net/artist.jpg',
              },
            ],
          },
        }),
      ),
    );

    const result = await new NeteaseStreamingProvider().search({ provider: 'netease', query: '测试', mediaTypes: ['artist'], page: 1, pageSize: 10 });

    expect(result.artists[0]).toMatchObject({
      provider: 'netease',
      providerArtistId: '789',
      name: '测试歌手',
      avatarUrl: remoteImageUrl('https://p.music.126.net/artist.jpg?param=160y160', 'https://music.163.com/'),
    });
  });

  it('falls back to NetEase track search to discover strict artist results', async () => {
    setNeteaseApiForTests(null);
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { artistCount: 0, artists: [] } }))
      .mockResolvedValueOnce(jsonResponse({ result: { artistCount: 0, artists: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            songCount: 1,
            songs: [
              {
                id: 123,
                name: 'Isekai Song',
                duration: 181000,
                artists: [{ id: 789, name: '異世界情緒' }],
                album: { id: 456, name: 'Isekai Album' },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ songs: [{ id: 123, album: { picUrl: 'https://p.music.126.net/isekai.jpg' } }] }));
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new NeteaseStreamingProvider().search({ provider: 'netease', query: '异世界情绪', mediaTypes: ['artist'], page: 1, pageSize: 10 });

    expect(result.query).toBe('异世界情绪');
    expect(result.tracks).toEqual([]);
    expect(result.artists[0]).toMatchObject({
      provider: 'netease',
      providerArtistId: '789',
      name: '異世界情緒',
    });
    expect(String(fetchRunner.mock.calls[0][0])).toContain('type=100');
    expect(String(fetchRunner.mock.calls[2][0])).toContain('type=1');
  });

  it('loads NetEase artist details with top tracks and albums', async () => {
    const artistsApi = vi.fn().mockResolvedValue({
      body: {
        artist: { id: 789, name: 'NetEase Artist', picUrl: 'https://p.music.126.net/artist-detail.jpg' },
        hotSongs: [],
      },
    });
    const topSongApi = vi.fn().mockResolvedValue({
      body: {
        songs: [
          {
            id: 123,
            name: 'Artist Song',
            duration: 181000,
            noCopyrightRcmd: { type: 1 },
            copyright: 0,
            artists: [{ id: 789, name: 'NetEase Artist' }],
            album: { id: 456, name: 'Artist Album' },
          },
        ],
      },
    });
    const artistAlbumApi = vi.fn().mockResolvedValue({
      body: {
        hotAlbums: [
          {
            id: 456,
            name: 'Artist Album',
            publishTime: 1767225600000,
            size: 1,
            picUrl: 'https://p.music.126.net/artist-album.jpg',
            artists: [{ id: 789, name: 'NetEase Artist' }],
          },
        ],
      },
    });
    setNeteaseApiForTests({ artists: artistsApi, artist_top_song: topSongApi, artist_album: artistAlbumApi });

    const detail = await new NeteaseStreamingProvider().getArtist({ providerArtistId: '789' });

    expect(artistsApi).toHaveBeenCalledWith(expect.objectContaining({ id: '789', cookie: 'MUSIC_U=secret; csrf=hidden' }));
    expect(detail).toMatchObject({
      provider: 'netease',
      providerArtistId: '789',
      name: 'NetEase Artist',
    });
    expect(detail.topTracks[0]).toMatchObject({ providerTrackId: '123', title: 'Artist Song', playable: true });
    expect(detail.albums[0]).toMatchObject({ providerAlbumId: '456', title: 'Artist Album' });
  });

  it('resolves NetEase playback with CDN request headers for the native decoder', async () => {
    setNeteaseApiForTests(null);
    const fetchRunner = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 123,
            url: 'https://m701.music.126.net/token/song.mp3',
            br: 320000,
            type: 'mp3',
          },
        ],
      }),
    );
    vi.stubGlobal(
      'fetch',
      fetchRunner,
    );

    const source = await new NeteaseStreamingProvider().resolvePlayback({ provider: 'netease', providerTrackId: '123', quality: 'high' });

    expect(String(fetchRunner.mock.calls[0][0])).toContain('csrf_token=hidden');
    expect(String(fetchRunner.mock.calls[0][0])).toContain('os=pc');
    expect(source).toMatchObject({
      provider: 'netease',
      providerTrackId: '123',
      url: 'https://m701.music.126.net/token/song.mp3',
      headers: expect.objectContaining({
        Referer: 'https://music.163.com/',
        Origin: 'https://music.163.com',
        Cookie: 'MUSIC_U=secret; csrf=hidden',
      }),
      requiresProxy: false,
      supportsRange: true,
    });
  });

  it('defaults NetEase playback to lossless through the enhanced song_url_v1 resolver', async () => {
    const songUrlV1 = vi.fn().mockResolvedValue({
      body: {
        data: [
          {
            url: 'https://m701.music.126.net/enhanced/song.flac',
            br: 999000,
            type: 'flac',
            level: 'lossless',
          },
        ],
      },
    });
    const fetchRunner = vi.fn();
    setNeteaseApiForTests({ song_url_v1: songUrlV1 });
    vi.stubGlobal('fetch', fetchRunner);

    const source = await new NeteaseStreamingProvider().resolvePlayback({ provider: 'netease', providerTrackId: '123' });

    expect(songUrlV1).toHaveBeenCalledWith({
      id: 123,
      level: 'lossless',
      cookie: 'MUSIC_U=secret; csrf=hidden',
    });
    expect(fetchRunner).not.toHaveBeenCalled();
    expect(source).toMatchObject({
      url: 'https://m701.music.126.net/enhanced/song.flac',
      codec: 'flac',
      bitrate: 999000,
      headers: expect.objectContaining({
        Cookie: 'MUSIC_U=secret; csrf=hidden',
        Referer: 'https://music.163.com/',
      }),
    });
  });

  it('falls back to the NetEase bitrate song_url resolver when song_url_v1 returns no URL', async () => {
    const songUrlV1 = vi.fn().mockResolvedValue({
      body: {
        data: [{ id: 123, url: null, br: 320000, type: 'mp3' }],
      },
    });
    const songUrl = vi.fn().mockResolvedValue({
      body: {
        data: [
          {
            url: 'https://m701.music.126.net/legacy/song.mp3',
            br: 320000,
            type: 'mp3',
          },
        ],
      },
    });
    const fetchRunner = vi.fn();
    setNeteaseApiForTests({ song_url_v1: songUrlV1, song_url: songUrl });
    vi.stubGlobal('fetch', fetchRunner);

    const source = await new NeteaseStreamingProvider().resolvePlayback({ provider: 'netease', providerTrackId: '123', quality: 'high' });

    expect(songUrlV1).toHaveBeenCalledWith({
      id: 123,
      level: 'exhigh',
      cookie: 'MUSIC_U=secret; csrf=hidden',
    });
    expect(songUrl).toHaveBeenCalledWith({
      id: 123,
      br: 320000,
      cookie: 'MUSIC_U=secret; csrf=hidden',
    });
    expect(fetchRunner).not.toHaveBeenCalled();
    expect(source).toMatchObject({
      url: 'https://m701.music.126.net/legacy/song.mp3',
      codec: 'mp3',
      bitrate: 320000,
    });
  });

  it('falls back to the public NetEase playback URL API when the enhanced resolver stalls', async () => {
    vi.useFakeTimers();
    const songUrlV1 = vi.fn(() => new Promise<never>(() => undefined));
    const fetchRunner = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 123,
            url: 'https://m701.music.126.net/fallback/song.flac',
            br: 999000,
            type: 'flac',
            level: 'lossless',
          },
        ],
      }),
    );
    setNeteaseApiForTests({ song_url_v1: songUrlV1 });
    vi.stubGlobal('fetch', fetchRunner);

    const pending = new NeteaseStreamingProvider().resolvePlayback({ provider: 'netease', providerTrackId: '123', quality: 'lossless' });
    await vi.advanceTimersByTimeAsync(2500);
    const source = await pending;

    expect(songUrlV1).toHaveBeenCalledTimes(1);
    expect(fetchRunner).toHaveBeenCalledTimes(1);
    expect(source).toMatchObject({
      url: 'https://m701.music.126.net/fallback/song.flac',
      codec: 'flac',
      bitrate: 999000,
    });
  });

  it('falls back to high quality when NetEase max quality returns no URL', async () => {
    setNeteaseApiForTests(null);
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 123, url: null, br: 999000, type: 'flac', code: 200 }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 123, url: null, br: 999000, type: 'flac', code: 200 }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 123, url: null, br: 999000, type: 'flac', code: 200 }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 123, url: null, br: 999000, type: 'flac', code: 200 }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 123, url: null, br: 999000, type: 'flac', code: 200 }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 123,
              url: 'https://m701.music.126.net/token/song.mp3',
              br: 320000,
              type: 'mp3',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const source = await new NeteaseStreamingProvider().resolvePlayback({ provider: 'netease', providerTrackId: '123', quality: 'hires' });

    expect(source).toMatchObject({
      url: 'https://m701.music.126.net/token/song.mp3',
      codec: 'mp3',
      bitrate: 320000,
    });
    expect(fetchRunner).toHaveBeenCalledTimes(6);
    expect(String(fetchRunner.mock.calls[0][0])).toContain('level=jymaster');
    expect(String(fetchRunner.mock.calls[3][0])).toContain('level=hires');
    expect(String(fetchRunner.mock.calls[5][0])).toContain('level=exhigh');
    expect(String(fetchRunner.mock.calls[0][0])).toContain('encodeType=flac');
  });

  it('maps QQ Music search results to streaming tracks', async () => {
    const fetchRunner = vi.fn().mockResolvedValue(
      jsonResponse({
        req_1: {
          data: {
            body: {
              song: {
                list: [
                  {
                    mid: 'song-mid',
                    name: '测试歌曲',
                    interval: 180,
                    pay: { pay_play: 1 },
                    action: { msgpay: 11 },
                    singer: [{ mid: 'artist-mid', name: '测试歌手' }],
                    album: { mid: 'album-mid', name: '测试专辑' },
                  },
                ],
              },
            },
            meta: {
              sum: 1,
            },
          },
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      fetchRunner,
    );

    const result = await new QQMusicStreamingProvider().search({ provider: 'qqmusic', query: '测试', page: 1, pageSize: 10 });

    expect(result.tracks[0]).toMatchObject({
      provider: 'qqmusic',
      providerTrackId: 'song-mid',
      stableKey: 'streaming:qqmusic:song-mid',
      title: '测试歌曲',
      artist: '测试歌手',
      album: '测试专辑',
      duration: 180,
      coverThumb: remoteImageUrl('https://y.gtimg.cn/music/photo_new/T002R150x150M000album-mid.jpg', 'https://y.qq.com/'),
      playable: true,
      qualities: ['standard', 'high', 'lossless'],
    });
  });

  it('marks paid QQ Music tracks unavailable when no playback account is connected', async () => {
    accountStatus.connected = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          req_1: {
            data: {
              body: {
                song: {
                  list: [
                    {
                      mid: 'paid-song-mid',
                      name: 'Paid Song',
                      pay: { pay_play: 1 },
                      singer: [{ mid: 'artist-mid', name: 'Paid Artist' }],
                      album: { mid: 'album-mid', name: 'Paid Album' },
                    },
                  ],
                },
              },
              meta: { sum: 1 },
            },
          },
        }),
      ),
    );

    const result = await new QQMusicStreamingProvider().search({ provider: 'qqmusic', query: 'paid', page: 1, pageSize: 10 });

    expect(result.tracks[0]).toMatchObject({
      providerTrackId: 'paid-song-mid',
      playable: false,
      qualities: ['standard'],
      unavailableReason: '需要 QQ 音乐会员或当前版权不可播放。',
    });
  });

  it('loads QQ Music streaming lyrics directly by songmid', async () => {
    const fetchRunner = vi.fn().mockResolvedValue(
      jsonResponse({
        lyric: '[00:01.00]QQ lyric line',
        trans: '[00:01.00]QQ translation',
        roma: '[00:01.00]QQ romanization',
      }),
    );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new QQMusicStreamingProvider().getLyrics({ providerTrackId: 'song-mid' });

    expect(result).toMatchObject({
      provider: 'qqmusic',
      providerTrackId: 'song-mid',
      status: 'available',
      syncedLyrics: '[00:01.00]QQ lyric line',
      translationLyrics: '[00:01.00]QQ translation',
      romanizationLyrics: '[00:01.00]QQ romanization',
    });
    expect(String(fetchRunner.mock.calls[0][0])).toContain('songmid=song-mid');
  });

  it('retries QQ Music streaming lyrics with normalized songmid when the track id is numeric', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ lyric: '' }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: [
            {
              id: 123456,
              mid: 'normalized-song-mid',
              name: 'QQ Song',
              singer: [{ mid: 'artist-mid', name: 'QQ Artist' }],
              album: { mid: 'album-mid', name: 'QQ Album' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ lyric: '[00:02.00]Normalized lyric' }));
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new QQMusicStreamingProvider().getLyrics({ providerTrackId: '123456' });

    expect(result).toMatchObject({
      provider: 'qqmusic',
      providerTrackId: '123456',
      status: 'available',
      syncedLyrics: '[00:02.00]Normalized lyric',
    });
    expect(String(fetchRunner.mock.calls[0][0])).toContain('songmid=123456');
    expect(String(fetchRunner.mock.calls[1][0])).toContain('songmid=123456');
    expect(String(fetchRunner.mock.calls[2][0])).toContain('songid=123456');
    expect(String(fetchRunner.mock.calls[3][0])).toContain('songmid=normalized-song-mid');
  });

  it('retries QQ Music search with normalized query variants when the exact query is empty', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          req_1: {
            data: {
              body: { song: { list: [] } },
              meta: { sum: 0 },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_1: {
            data: {
              body: {
                song: {
                  list: [
                    {
                      mid: 'variant-song-mid',
                      name: 'Echo Lab',
                      interval: 180,
                      singer: [{ mid: 'artist-mid', name: 'Variant Artist' }],
                      album: { mid: 'album-mid', name: 'Variant Album' },
                    },
                  ],
                },
              },
              meta: { sum: 1 },
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new QQMusicStreamingProvider().search({ provider: 'qqmusic', query: 'Echo-Lab', page: 1, pageSize: 10 });

    expect(result.query).toBe('Echo-Lab');
    expect(result.tracks[0]).toMatchObject({
      providerTrackId: 'variant-song-mid',
      title: 'Echo Lab',
    });
    expect(JSON.parse(String(fetchRunner.mock.calls[0][1]?.body)).req_1.param.query).toBe('Echo-Lab');
    expect(JSON.parse(String(fetchRunner.mock.calls[1][1]?.body)).req_1.param.query).toBe('Echo Lab');
  });

  it('maps QQ Music album search results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          req_1: {
            data: {
              body: {
                album: {
                  totalnum: 1,
                  list: [
                    {
                      albumMID: 'album-mid',
                      albumName: '测试专辑',
                      singerName: '测试歌手',
                      publicTime: '2026-01-01',
                      song_count: 9,
                    },
                  ],
                },
              },
            },
          },
        }),
      ),
    );

    const result = await new QQMusicStreamingProvider().search({ provider: 'qqmusic', query: '测试', mediaTypes: ['album'], page: 1, pageSize: 10 });

    expect(result.albums[0]).toMatchObject({
      provider: 'qqmusic',
      providerAlbumId: 'album-mid',
      title: '测试专辑',
      artist: '测试歌手',
      releaseDate: '2026-01-01',
      trackCount: 9,
      coverThumb: remoteImageUrl('https://y.gtimg.cn/music/photo_new/T002R150x150M000album-mid.jpg', 'https://y.qq.com/'),
    });
  });

  it('maps QQ Music playlist search results', async () => {
    const fetchRunner = vi.fn().mockResolvedValue(
      jsonResponse({
        req_1: {
          data: {
            body: {
              songlist: {
                totalnum: 1,
                list: [
                  {
                    dissid: 'qq-playlist-id',
                    dissname: 'QQ Playlist',
                    song_count: 35,
                    imgurl: 'https://y.gtimg.cn/music/photo_new/T002R150x150M000playlist.jpg',
                    creator: 'QQ DJ',
                  },
                ],
              },
            },
            meta: { sum: 1 },
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new QQMusicStreamingProvider().search({ provider: 'qqmusic', query: 'mix', mediaTypes: ['playlist'], page: 1, pageSize: 10 });

    expect(JSON.parse(String(fetchRunner.mock.calls[0][1]?.body)).req_1.param.search_type).toBe(3);
    expect(result.playlists[0]).toMatchObject({
      provider: 'qqmusic',
      providerPlaylistId: 'qq-playlist-id',
      title: 'QQ Playlist',
      creator: 'QQ DJ',
      trackCount: 35,
      coverThumb: remoteImageUrl('https://y.gtimg.cn/music/photo_new/T002R150x150M000playlist.jpg', 'https://y.qq.com/'),
    });
  });

  it('loads QQ Music playlists with a same-origin legacy API referer', async () => {
    const fetchRunner = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        subcode: 0,
        cdlist: [
          {
            disstid: '9648223902',
            dissname: 'QQ Imported Playlist',
            logo: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000playlist.jpg',
            songnum: 1,
            total_song_num: 1,
            songlist: [
              {
                songmid: 'playlist-song-mid',
                songname: 'Playlist Song',
                interval: 240,
                albummid: 'album-mid',
                albumname: 'Playlist Album',
                singer: [{ mid: 'artist-mid', name: 'Playlist Artist' }],
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchRunner);

    const detail = await new QQMusicStreamingProvider().getPlaylist({ providerPlaylistId: '9648223902', page: 1, pageSize: 500 });
    const headers = fetchRunner.mock.calls[0][1]?.headers as Record<string, string>;

    expect(headers.Referer).toBe('https://c.y.qq.com/');
    expect(String(fetchRunner.mock.calls[0][0])).toContain('disstid=9648223902');
    expect(detail).toMatchObject({
      provider: 'qqmusic',
      providerPlaylistId: '9648223902',
      title: 'QQ Imported Playlist',
      total: 1,
      hasMore: false,
    });
    expect(detail.tracks[0]).toMatchObject({
      providerTrackId: 'playlist-song-mid',
      title: 'Playlist Song',
      artist: 'Playlist Artist',
    });
  });

  it('does not silently import an empty QQ Music playlist when the detail body is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        jsonResponse({
          code: 0,
          subcode: 1,
          message: 'invalid referer',
        }),
      ),
    );

    await expect(new QQMusicStreamingProvider().getPlaylist({ providerPlaylistId: '9648223902' })).rejects.toThrow('invalid referer');
  });

  it('retries QQ Music playlist details with a raw Referer header when Electron net rejects the first request', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          subcode: 1,
          message: 'invalid referer',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          subcode: 0,
          cdlist: [
            {
              disstid: '9718644800',
              dissname: 'QQ Imported Playlist',
              songnum: 1,
              total_song_num: 1,
              songlist: [
                {
                  songmid: 'playlist-song-mid',
                  songname: 'Playlist Song',
                  interval: 240,
                  singer: [{ mid: 'artist-mid', name: 'Playlist Artist' }],
                },
              ],
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const detail = await new QQMusicStreamingProvider().getPlaylist({ providerPlaylistId: '9718644800' });

    expect(fetchRunner).toHaveBeenCalledTimes(2);
    expect(fetchRunner.mock.calls[1][1]?.headers).toEqual(expect.objectContaining({ Referer: 'https://c.y.qq.com/' }));
    expect(detail.tracks[0]).toMatchObject({
      providerTrackId: 'playlist-song-mid',
      title: 'Playlist Song',
    });
  });

  it('does not silently import an empty QQ Music playlist when the first page has a nonzero total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          code: 0,
          subcode: 0,
          cdlist: [
            {
              disstid: '9718644800',
              dissname: 'QQ Empty Shell',
              songnum: 1018,
              total_song_num: 1018,
              songlist: [],
            },
          ],
        }),
      ),
    );

    await expect(new QQMusicStreamingProvider().getPlaylist({ providerPlaylistId: '9718644800' })).rejects.toThrow(
      'QQ Music playlist detail returned an empty song list.',
    );
  });

  it('loads QQ Music album details for clickable streaming albums', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            mid: 'album-mid',
            name: 'QQ Detail Album',
            singername: 'Detail Artist',
            aDate: '2026-01-01',
            total: 1,
            list: [
              {
                mid: 'detail-song-mid',
                name: 'Detail Song',
                interval: 180,
                singer: [{ mid: 'artist-mid', name: 'Detail Artist' }],
                album: { mid: 'album-mid', name: 'QQ Detail Album' },
              },
            ],
          },
        }),
      ),
    );

    const detail = await new QQMusicStreamingProvider().getAlbum({ providerAlbumId: 'album-mid' });

    expect(detail).toMatchObject({
      provider: 'qqmusic',
      providerAlbumId: 'album-mid',
      title: 'QQ Detail Album',
      artist: 'Detail Artist',
    });
    expect(detail.tracks[0]).toMatchObject({
      providerTrackId: 'detail-song-mid',
      title: 'Detail Song',
    });
  });

  it('maps QQ Music artist search results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          req_1: {
            data: {
              body: {
                singer: {
                  totalnum: 1,
                  list: [
                    {
                      singerMID: 'artist-mid',
                      singerName: '测试歌手',
                    },
                  ],
                },
              },
            },
          },
        }),
      ),
    );

    const result = await new QQMusicStreamingProvider().search({ provider: 'qqmusic', query: '测试', mediaTypes: ['artist'], page: 1, pageSize: 10 });

    expect(result.artists[0]).toMatchObject({
      provider: 'qqmusic',
      providerArtistId: 'artist-mid',
      name: '测试歌手',
      avatarUrl: remoteImageUrl('https://y.gtimg.cn/music/photo_new/T001R500x500M000artist-mid.jpg', 'https://y.qq.com/'),
    });
  });

  it('falls back to QQ Music track search to discover strict artist results', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          req_1: {
            data: {
              body: { singer: { list: [] } },
              meta: { sum: 0 },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_1: {
            data: {
              body: { singer: { list: [] } },
              meta: { sum: 0 },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_1: {
            data: {
              body: {
                song: {
                  list: [
                    {
                      mid: 'song-mid',
                      name: 'Isekai Song',
                      interval: 180,
                      singer: [{ mid: 'artist-mid', name: '異世界情緒' }],
                      album: { mid: 'album-mid', name: 'Isekai Album' },
                    },
                  ],
                },
              },
              meta: { sum: 1 },
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new QQMusicStreamingProvider().search({ provider: 'qqmusic', query: '异世界情绪', mediaTypes: ['artist'], page: 1, pageSize: 10 });

    expect(result.query).toBe('异世界情绪');
    expect(result.tracks).toEqual([]);
    expect(result.artists[0]).toMatchObject({
      provider: 'qqmusic',
      providerArtistId: 'artist-mid',
      name: '異世界情緒',
    });
    expect(JSON.parse(String(fetchRunner.mock.calls[0][1]?.body)).req_1.param.search_type).toBe(9);
    expect(JSON.parse(String(fetchRunner.mock.calls[2][1]?.body)).req_1.param.search_type).toBe(0);
  });

  it('loads QQ Music artist details with top tracks and albums', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            singer: { mid: 'artist-mid', name: 'QQ Artist' },
            list: [
              {
                musicData: {
                  mid: 'song-mid',
                  name: 'Artist Song',
                  interval: 180,
                  singer: [{ mid: 'artist-mid', name: 'QQ Artist' }],
                  album: { mid: 'album-mid', name: 'Artist Album' },
                },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            singer: { mid: 'artist-mid', name: 'QQ Artist' },
            list: [
              {
                albumMID: 'album-mid',
                albumName: 'Artist Album',
                singerName: 'QQ Artist',
                publicTime: '2026-01-01',
                song_count: 1,
              },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const detail = await new QQMusicStreamingProvider().getArtist({ providerArtistId: 'artist-mid' });

    expect(String(fetchRunner.mock.calls[0][0])).toContain('singermid=artist-mid');
    expect(String(fetchRunner.mock.calls[1][0])).toContain('singermid=artist-mid');
    expect(detail).toMatchObject({
      provider: 'qqmusic',
      providerArtistId: 'artist-mid',
      name: 'QQ Artist',
    });
    expect(detail.topTracks[0]).toMatchObject({ providerTrackId: 'song-mid', title: 'Artist Song' });
    expect(detail.albums[0]).toMatchObject({ providerAlbumId: 'album-mid', title: 'Artist Album' });
  });

  it('infers QQ Music artist detail names from album metadata when singer payloads only expose mids', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              singer: { mid: 'artist-mid' },
              list: [],
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              singer: { mid: 'artist-mid' },
              list: [
                {
                  albumMID: 'album-mid',
                  albumName: 'Artist Album',
                  singerName: 'QQ Artist',
                  publicTime: '2026-01-01',
                  song_count: 1,
                },
              ],
            },
          }),
        ),
    );

    const detail = await new QQMusicStreamingProvider().getArtist({ providerArtistId: 'artist-mid' });

    expect(detail).toMatchObject({
      provider: 'qqmusic',
      providerArtistId: 'artist-mid',
      name: 'QQ Artist',
    });
    expect(detail.topTracks).toHaveLength(0);
    expect(detail.albums[0]).toMatchObject({ providerAlbumId: 'album-mid', title: 'Artist Album', artist: 'QQ Artist' });
  });

  it('resolves a QQ Music artist name to singermid when detail lookup returns 404', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          req_1: {
            data: {
              body: {
                singer: {
                  list: [{ singerMID: 'real-mid', singerName: '赵小六' }],
                },
              },
              meta: { sum: 1 },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            singer: { mid: 'real-mid', name: '赵小六' },
            list: [
              {
                musicData: {
                  mid: 'song-mid',
                  name: 'Artist Song',
                  interval: 180,
                  singer: [{ mid: 'real-mid', name: '赵小六' }],
                  album: { mid: 'album-mid', name: 'Artist Album' },
                },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            singer: { mid: 'real-mid', name: '赵小六' },
            list: [],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const detail = await new QQMusicStreamingProvider().getArtist({ providerArtistId: '赵小六' });

    expect(JSON.parse(String(fetchRunner.mock.calls[2][1]?.body)).req_1.param.search_type).toBe(9);
    expect(String(fetchRunner.mock.calls[3][0])).toContain('singermid=real-mid');
    expect(detail).toMatchObject({
      provider: 'qqmusic',
      providerArtistId: 'real-mid',
      name: '赵小六',
    });
    expect(detail.topTracks[0]).toMatchObject({ providerTrackId: 'song-mid', title: 'Artist Song' });
  });

  it('falls back to QQ Music track search when artist detail and artist search cannot resolve an artist page', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          req_1: {
            data: {
              body: { singer: { list: [] } },
              meta: { sum: 0 },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_1: {
            data: {
              body: {
                song: {
                  list: [
                    {
                      mid: 'qq-song-mid',
                      name: 'QQ Search Song',
                      interval: 241,
                      singer: [{ mid: 'qq-artist-mid', name: 'ずっと真夜中でいいのに。' }],
                      album: { mid: 'qq-album-mid', name: 'QQ Search Album' },
                    },
                  ],
                },
              },
              meta: { sum: 1 },
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const detail = await new QQMusicStreamingProvider().getArtist({ providerArtistId: 'ずっと真夜中でいいのに。' });

    expect(JSON.parse(String(fetchRunner.mock.calls[2][1]?.body)).req_1.param.search_type).toBe(9);
    expect(JSON.parse(String(fetchRunner.mock.calls[3][1]?.body)).req_1.param.search_type).toBe(0);
    expect(detail).toMatchObject({
      provider: 'qqmusic',
      providerArtistId: 'qq-artist-mid',
      name: 'ずっと真夜中でいいのに。',
    });
    expect(detail.topTracks[0]).toMatchObject({ providerTrackId: 'qq-song-mid', title: 'QQ Search Song' });
    expect(detail.albums[0]).toMatchObject({ providerAlbumId: 'qq-album-mid', title: 'QQ Search Album' });
  });

  it('maps QQ Music playlist song fields to streaming tracks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          cdlist: [
            {
              dissname: 'QQ Playlist',
              desc: 'Imported from QQ Music',
              logo: 'https://qpic.y.qq.com/music_cover/playlist.jpg',
              total_song_num: 1,
              songlist: [
                {
                  songmid: 'playlist-song-mid',
                  songid: 123,
                  songname: 'Playlist Song Title',
                  songorig: 'Original Song Title',
                  interval: 242,
                  singer: [{ mid: 'artist-mid', name: 'Playlist Artist' }],
                  albumname: 'Playlist Album',
                  albummid: 'playlist-album-mid',
                },
              ],
            },
          ],
        }),
      ),
    );

    const playlist = await new QQMusicStreamingProvider().getPlaylist({ providerPlaylistId: '123456', page: 1, pageSize: 10 });

    expect(playlist).toMatchObject({
      provider: 'qqmusic',
      providerPlaylistId: '123456',
      title: 'QQ Playlist',
      trackCount: 1,
    });
    expect(playlist.tracks[0]).toMatchObject({
      provider: 'qqmusic',
      providerTrackId: 'playlist-song-mid',
      stableKey: 'streaming:qqmusic:playlist-song-mid',
      title: 'Playlist Song Title',
      artist: 'Playlist Artist',
      album: 'Playlist Album',
      duration: 242,
      coverThumb: remoteImageUrl('https://y.gtimg.cn/music/photo_new/T002R150x150M000playlist-album-mid.jpg', 'https://y.qq.com/'),
    });
  });

  it('loads QQ Music liked songs from nested profile-order responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            body: {
              song: {
                total_song_num: 1,
                list: [
                  {
                    songInfo: {
                      songmid: 'liked-song-mid',
                      songname: 'QQ Liked Song',
                      interval: 216,
                      singer: [{ mid: 'artist-mid', name: 'QQ Liked Artist' }],
                      album: { mid: 'album-mid', name: 'QQ Liked Album' },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );

    const playlist = await new QQMusicStreamingProvider().getLikedSongsPlaylist({ page: 1, pageSize: 20 });

    expect(playlist).toMatchObject({
      provider: 'qqmusic',
      providerPlaylistId: 'liked-songs',
      title: 'QQ 喜欢',
      total: 1,
      hasMore: false,
    });
    expect(playlist.tracks[0]).toMatchObject({
      providerTrackId: 'liked-song-mid',
      title: 'QQ Liked Song',
      artist: 'QQ Liked Artist',
      album: 'QQ Liked Album',
      duration: 216,
    });
  });

  it('adds QQ Music tracks to the liked playlist with nested playlist ids', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            folders: [{ dirName: '我喜欢', dirId: 7788 }],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ code: 0 }));
    vi.stubGlobal('fetch', fetchRunner);

    await new QQMusicStreamingProvider().setTrackLiked({ providerTrackId: 'song-mid', liked: true });

    const addUrl = new URL(String(fetchRunner.mock.calls[1][0]));
    expect(addUrl.pathname).toBe('/splcloud/fcgi-bin/fcg_music_add2songdir.fcg');
    expect(addUrl.searchParams.get('dirid')).toBe('7788');
    expect(addUrl.searchParams.get('midlist')).toBe('song-mid');
    expect(addUrl.searchParams.get('g_tk')).toBeTruthy();
  });

  it('removes QQ Music tracks from the liked playlist using nested song ids', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            folders: [{ dirName: '我喜欢', dirID: 7788 }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              songInfo: {
                songID: 2468,
                songmid: 'song-mid',
                songname: 'QQ Liked Song',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ code: 0 }));
    vi.stubGlobal('fetch', fetchRunner);

    await new QQMusicStreamingProvider().setTrackLiked({ providerTrackId: 'song-mid', liked: false });

    const removeUrl = new URL(String(fetchRunner.mock.calls[2][0]));
    expect(removeUrl.pathname).toBe('/splcloud/fcgi-bin/fcg_music_delbatchsong.fcg');
    expect(removeUrl.searchParams.get('dirid')).toBe('7788');
    expect(removeUrl.searchParams.get('songids')).toBe('2468');
  });

  it('fetches NetEase playlist song details in batches small enough for the API', async () => {
    setNeteaseApiForTests(null);
    const trackIds = Array.from({ length: 250 }, (_value, index) => index + 1);
    const detailSongs = (ids: number[]) =>
      ids.map((id) => ({
        id,
        name: `Song ${id}`,
        dt: 180000 + id,
        ar: [{ id: 1000 + id, name: `Artist ${id}` }],
        al: { id: 2000 + id, name: `Album ${id}`, picUrl: `https://p.music.126.net/${id}.jpg` },
      }));
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          playlist: {
            name: 'NetEase Likes',
            trackCount: trackIds.length,
            trackIds: trackIds.map((id) => ({ id })),
            tracks: [],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ songs: detailSongs(trackIds.slice(0, 100)) }))
      .mockResolvedValueOnce(jsonResponse({ songs: detailSongs(trackIds.slice(100, 200)) }))
      .mockResolvedValueOnce(jsonResponse({ songs: detailSongs(trackIds.slice(200)) }));
    vi.stubGlobal('fetch', fetchRunner);

    const playlist = await new NeteaseStreamingProvider().getPlaylist({ providerPlaylistId: '163289102', page: 1, pageSize: 250 });

    expect(playlist).toMatchObject({
      provider: 'netease',
      providerPlaylistId: '163289102',
      title: 'NetEase Likes',
      trackCount: 250,
      total: 250,
      hasMore: false,
    });
    expect(playlist.tracks).toHaveLength(250);
    expect(playlist.tracks[0]).toMatchObject({
      providerTrackId: '1',
      title: 'Song 1',
      artist: 'Artist 1',
      album: 'Album 1',
    });
    expect(fetchRunner).toHaveBeenCalledTimes(4);
    const detailRequests = fetchRunner.mock.calls.slice(1).map(([url]) => new URL(String(url)));
    expect(detailRequests.map((url) => JSON.parse(url.searchParams.get('ids') ?? '[]')).map((ids) => ids.length)).toEqual([100, 100, 50]);
  });

  it('uses the NetEase playlist track API for large playlist pages', async () => {
    const trackIds = Array.from({ length: 1500 }, (_value, index) => index + 1);
    const playlistTrackAll = vi.fn().mockResolvedValue({
      body: {
        songs: [
          {
            id: 1001,
            name: 'Deep Page Song',
            dt: 188000,
            ar: [{ id: 1, name: 'Deep Artist' }],
            al: { id: 2, name: 'Deep Album', picUrl: 'https://p.music.126.net/deep.jpg' },
          },
        ],
      },
    });
    setNeteaseApiForTests({ playlist_track_all: playlistTrackAll });
    const fetchRunner = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        playlist: {
          name: 'Large NetEase Playlist',
          trackCount: trackIds.length,
          trackIds: trackIds.map((id) => ({ id })),
          tracks: [],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchRunner);

    const playlist = await new NeteaseStreamingProvider().getPlaylist({ providerPlaylistId: '2764805072', page: 3, pageSize: 500 });

    expect(playlistTrackAll).toHaveBeenCalledWith({
      id: '2764805072',
      limit: 500,
      offset: 1000,
      cookie: 'MUSIC_U=secret; csrf=hidden',
    });
    expect(fetchRunner).toHaveBeenCalledTimes(1);
    expect(playlist).toMatchObject({
      provider: 'netease',
      providerPlaylistId: '2764805072',
      title: 'Large NetEase Playlist',
      total: 1500,
      hasMore: false,
    });
    expect(playlist.tracks).toHaveLength(1);
    expect(playlist.tracks[0]).toMatchObject({
      providerTrackId: '1001',
      title: 'Deep Page Song',
      artist: 'Deep Artist',
      album: 'Deep Album',
    });
  });

  it('loads NetEase djradio podcasts as playlist tracks', async () => {
    const djDetail = vi.fn().mockResolvedValue({
      body: {
        data: {
          id: 990232286,
          name: 'NetEase Podcast',
          desc: 'Podcast description',
          picUrl: 'https://p.music.126.net/podcast.jpg',
          programCount: 91,
          dj: { nickname: 'Podcast Host', userId: 315024388 },
        },
      },
    });
    const djProgram = vi.fn().mockResolvedValue({
      body: {
        count: 89,
        more: true,
        programs: [
          {
            id: 3717478129,
            name: 'IRIS OUT／歌ってみた【星川サラにじさんじ】',
            mainTrackId: 3370584713,
            duration: 147048,
            coverUrl: 'https://p.music.126.net/episode.jpg',
            existLyric: false,
            mainSong: {
              id: 3370584713,
              name: 'IRIS OUT／歌ってみた【星川サラにじさんじ】',
              duration: 147048,
              artists: [],
              album: { id: 0, name: null, picUrl: null },
              fee: 0,
            },
            dj: { nickname: 'Podcast Host', userId: 315024388 },
          },
          {
            id: 3714838368,
            name: '【MV】流星☆ラブビーム！／星川サラ【オリジナル曲】',
            mainTrackId: 3356941636,
            duration: 165912,
            mainSong: {
              id: 3356941636,
              name: '【MV】流星☆ラブビーム！／星川サラ【オリジナル曲】',
              duration: 165912,
              artists: [{ id: 315024388, name: 'Podcast Host' }],
              album: { id: 0, name: '[DJ节目]Ted007zz的DJ节目 第90期', picUrl: 'https://p.music.126.net/noisy-album.jpg' },
              fee: 0,
            },
            dj: { nickname: 'Podcast Host', userId: 315024388 },
          },
        ],
      },
    });
    setNeteaseApiForTests({ dj_detail: djDetail, dj_program: djProgram });

    const playlist = await new NeteaseStreamingProvider().getPlaylist({ providerPlaylistId: 'djradio:990232286', page: 2, pageSize: 10 });

    expect(djDetail).toHaveBeenCalledWith({ rid: '990232286', cookie: 'MUSIC_U=secret; csrf=hidden' });
    expect(djProgram).toHaveBeenCalledWith({
      rid: '990232286',
      limit: 10,
      offset: 10,
      asc: 'false',
      cookie: 'MUSIC_U=secret; csrf=hidden',
    });
    expect(playlist).toMatchObject({
      provider: 'netease',
      providerPlaylistId: 'djradio:990232286',
      title: 'NetEase Podcast',
      description: 'Podcast description',
      creator: 'Podcast Host',
      trackCount: 89,
      total: 89,
      hasMore: true,
    });
    expect(playlist.coverThumb).toBe(remoteImageUrl('https://p.music.126.net/podcast.jpg?param=160y160', 'https://music.163.com/'));
    expect(playlist.tracks[0]).toMatchObject({
      providerTrackId: '3370584713',
      title: 'IRIS OUT／歌ってみた【星川サラにじさんじ】',
      artist: 'Podcast Host',
      album: 'NetEase Podcast',
      albumId: 'djradio:990232286',
      duration: 147.048,
      coverThumb: remoteImageUrl('https://p.music.126.net/episode.jpg?param=160y160', 'https://music.163.com/'),
      lyricsStatus: 'unknown',
    });
    expect(playlist.tracks[1]).toMatchObject({
      providerTrackId: '3356941636',
      title: '【MV】流星☆ラブビーム！／星川サラ【オリジナル曲】',
      album: 'NetEase Podcast',
      albumId: 'djradio:990232286',
    });
  });

  it('loads NetEase liked songs from nested enhanced likelist responses', async () => {
    const loginStatus = vi.fn().mockResolvedValue({ body: { data: { profile: { userId: 42 } } } });
    const likelist = vi.fn().mockResolvedValue({ body: { data: { ids: [{ id: 301 }, 302] } } });
    setNeteaseApiForTests({ login_status: loginStatus, likelist });
    const fetchRunner = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          songs: [
            {
              id: 301,
              name: 'Liked One',
              dt: 181000,
              ar: [{ id: 1, name: 'Liked Artist' }],
              al: { id: 2, name: 'Liked Album', picUrl: 'https://p.music.126.net/liked-one.jpg' },
            },
            {
              id: 302,
              name: 'Liked Two',
              dt: 182000,
              ar: [{ id: 3, name: 'Second Artist' }],
              al: { id: 4, name: 'Second Album' },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const playlist = await new NeteaseStreamingProvider().getLikedSongsPlaylist({ page: 1, pageSize: 2 });

    expect(likelist).toHaveBeenCalledWith({ uid: '42', cookie: 'MUSIC_U=secret; csrf=hidden' });
    expect(playlist).toMatchObject({
      provider: 'netease',
      providerPlaylistId: 'liked-songs',
      title: '网易云我喜欢',
      trackCount: 2,
      total: 2,
      hasMore: false,
    });
    expect(playlist.tracks[0]).toMatchObject({
      providerTrackId: '301',
      title: 'Liked One',
      artist: 'Liked Artist',
      album: 'Liked Album',
    });
  });

  it('falls back to the NetEase liked playlist when likelist returns no ids', async () => {
    const loginStatus = vi.fn().mockResolvedValue({ body: { data: { profile: { userId: 42 } } } });
    const likelist = vi.fn().mockResolvedValue({ body: { ids: [] } });
    const userPlaylist = vi.fn().mockResolvedValue({
      body: {
        playlist: [{ id: 9988, name: '我喜欢的音乐', specialType: 5 }],
      },
    });
    setNeteaseApiForTests({ login_status: loginStatus, likelist, user_playlist: userPlaylist });
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ids: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          playlist: {
            id: 9988,
            trackIds: [{ id: 401 }, { id: 402 }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          songs: [
            {
              id: 401,
              name: 'Fallback Like',
              dt: 181000,
              ar: [{ id: 1, name: 'Fallback Artist' }],
              al: { id: 2, name: 'Fallback Album' },
            },
            {
              id: 402,
              name: 'Fallback Like Two',
              dt: 182000,
              ar: [{ id: 3, name: 'Fallback Artist Two' }],
              al: { id: 4, name: 'Fallback Album Two' },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const playlist = await new NeteaseStreamingProvider().getLikedSongsPlaylist({ page: 1, pageSize: 10 });

    expect(userPlaylist).toHaveBeenCalledWith({ uid: '42', limit: 1000, offset: 0, cookie: 'MUSIC_U=secret; csrf=hidden' });
    expect(String(fetchRunner.mock.calls[1][0])).toContain('/api/v6/playlist/detail');
    expect(playlist.tracks.map((track) => track.providerTrackId)).toEqual(['401', '402']);
    expect(playlist.total).toBe(2);
  });

  it('resolves the NetEase account id from nested public account responses', async () => {
    setNeteaseApiForTests(null);
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { bindings: [{ userId: 777 }] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { checkPoint: [501] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          songs: [
            {
              id: 501,
              name: 'Public Account Like',
              dt: 181000,
              ar: [{ id: 1, name: 'Public Artist' }],
              al: { id: 2, name: 'Public Album' },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const playlist = await new NeteaseStreamingProvider().getLikedSongsPlaylist({ page: 1, pageSize: 10 });

    expect(String(fetchRunner.mock.calls[0][0])).toContain('/api/w/nuser/account/get');
    expect(String(fetchRunner.mock.calls[1][0])).toContain('uid=777');
    expect(playlist.tracks[0]).toMatchObject({
      providerTrackId: '501',
      title: 'Public Account Like',
    });
  });

  it('writes NetEase liked state through the public fallback when the enhanced API is unavailable', async () => {
    const loginStatus = vi.fn().mockResolvedValue({ body: { profile: { userId: 42 } } });
    setNeteaseApiForTests({ login_status: loginStatus });
    const fetchRunner = vi.fn().mockResolvedValueOnce(jsonResponse({ code: 200 }));
    vi.stubGlobal('fetch', fetchRunner);

    await new NeteaseStreamingProvider().setTrackLiked({ providerTrackId: '123', liked: true });

    const likeUrl = new URL(String(fetchRunner.mock.calls[0][0]));
    expect(likeUrl.pathname).toBe('/api/song/like');
    expect(likeUrl.searchParams.get('trackId')).toBe('123');
    expect(likeUrl.searchParams.get('userid')).toBe('42');
    expect(likeUrl.searchParams.get('like')).toBe('true');
    expect(likeUrl.searchParams.get('csrf_token')).toBe('hidden');
  });

  it('maps NetEase daily recommendations from the signed-in account', async () => {
    const recommendSongs = vi.fn().mockResolvedValue({
      body: {
        data: {
          dailySongs: [
            {
              id: 456,
              name: 'Daily Song',
              dt: 210000,
              ar: [{ id: 7, name: 'Daily Artist' }],
              al: { id: 8, name: 'Daily Album', picUrl: 'http://p.music.126.net/daily.jpg' },
            },
          ],
        },
      },
    });
    setNeteaseApiForTests({ recommend_songs: recommendSongs });

    const playlist = await new NeteaseStreamingProvider().getDailyRecommendPlaylist();

    expect(recommendSongs).toHaveBeenCalledWith({ cookie: 'MUSIC_U=secret; csrf=hidden' });
    expect(playlist).toMatchObject({
      provider: 'netease',
      providerPlaylistId: 'daily-recommend',
      title: '每日推荐',
      trackCount: 1,
      hasMore: false,
      coverThumb: remoteImageUrl('https://p.music.126.net/daily.jpg?param=160y160', 'https://music.163.com/'),
    });
    expect(playlist.tracks[0]).toMatchObject({
      providerTrackId: '456',
      title: 'Daily Song',
      artist: 'Daily Artist',
      album: 'Daily Album',
      coverThumb: remoteImageUrl('https://p.music.126.net/daily.jpg?param=160y160', 'https://music.163.com/'),
    });
  });

  it('resolves QQ Music playback through vkey without leaking account cookies', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              mid: 'song-mid',
              name: '测试歌曲',
              file: { media_mid: 'media-mid' },
              singer: [{ name: '测试歌手' }],
              album: { name: '测试专辑', mid: 'album-mid' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_0: {
            data: {
              sip: ['https://isure.stream.qqmusic.qq.com/'],
              midurlinfo: [{ purl: 'M800media-mid.mp3?vkey=temporary' }],
            },
          },
        }),
      );
    vi.stubGlobal(
      'fetch',
      fetchRunner,
    );

    const source = await new QQMusicStreamingProvider().resolvePlayback({ provider: 'qqmusic', providerTrackId: 'song-mid', quality: 'high' });
    const vkeyBody = JSON.parse(String(fetchRunner.mock.calls[1][1]?.body));

    expect(vkeyBody.req_0).toMatchObject({
      module: 'music.vkey.GetVkey',
      method: 'UrlGetVkey',
      param: {
        filename: ['M800media-mid.mp3'],
        songmid: ['song-mid'],
        ctx: 0,
      },
    });
    expect(source).toMatchObject({
      provider: 'qqmusic',
      providerTrackId: 'song-mid',
      url: 'https://isure.stream.qqmusic.qq.com/M800media-mid.mp3?vkey=temporary',
      headers: {},
      requiresProxy: false,
      supportsRange: true,
    });
  });

  it('resolves public QQ Music playback without requiring an account cookie', async () => {
    accountStatus.connected = false;
    accountStatus.qqCookie = '';
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              mid: 'song-mid',
              name: 'Public Song',
              file: { media_mid: 'media-mid' },
              singer: [{ name: 'Public Artist' }],
              album: { name: 'Public Album', mid: 'album-mid' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_0: {
            data: {
              sip: ['https://isure.stream.qqmusic.qq.com/'],
              midurlinfo: [{ purl: 'M500media-mid.mp3?vkey=temporary' }],
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const source = await new QQMusicStreamingProvider().resolvePlayback({ provider: 'qqmusic', providerTrackId: 'song-mid', quality: 'standard' });
    const detailHeaders = fetchRunner.mock.calls[0][1]?.headers as Record<string, string>;
    const vkeyHeaders = fetchRunner.mock.calls[1][1]?.headers as Record<string, string>;

    expect(detailHeaders.Cookie).toBeUndefined();
    expect(vkeyHeaders.Cookie).toBeUndefined();
    expect(source).toMatchObject({
      provider: 'qqmusic',
      providerTrackId: 'song-mid',
      url: 'https://isure.stream.qqmusic.qq.com/M500media-mid.mp3?vkey=temporary',
      codec: 'mp3',
      bitrate: 128000,
    });
  });

  it('resolves QQ Music playback with normalized songmid when the track id is numeric', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: [
            {
              id: 123456,
              mid: 'normalized-song-mid',
              name: 'Numeric Song',
              file: { media_mid: 'normalized-media-mid' },
              singer: [{ mid: 'artist-mid', name: 'Numeric Artist' }],
              album: { mid: 'album-mid', name: 'Numeric Album' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_0: {
            data: {
              sip: ['https://isure.stream.qqmusic.qq.com/'],
              midurlinfo: [{ purl: 'M800normalized-media-mid.mp3?vkey=temporary' }],
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const source = await new QQMusicStreamingProvider().resolvePlayback({ provider: 'qqmusic', providerTrackId: '123456', quality: 'high' });
    const vkeyBody = JSON.parse(String(fetchRunner.mock.calls[2][1]?.body));

    expect(String(fetchRunner.mock.calls[0][0])).toContain('songmid=123456');
    expect(String(fetchRunner.mock.calls[1][0])).toContain('songid=123456');
    expect(vkeyBody.req_0.param).toMatchObject({
      filename: ['M800normalized-media-mid.mp3'],
      songmid: ['normalized-song-mid'],
    });
    expect(source).toMatchObject({
      provider: 'qqmusic',
      providerTrackId: '123456',
      url: 'https://isure.stream.qqmusic.qq.com/M800normalized-media-mid.mp3?vkey=temporary',
    });
  });

  it('defaults QQ Music playback to lossless and falls back to a playable quality', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              mid: 'song-mid',
              name: 'Fallback Song',
              file: { media_mid: 'media-mid' },
              singer: [{ name: 'Fallback Artist' }],
              album: { name: 'Fallback Album', mid: 'album-mid' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_0: {
            data: {
              sip: ['https://isure.stream.qqmusic.qq.com/'],
              midurlinfo: [{ purl: '' }],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_0: {
            data: {
              sip: ['https://isure.stream.qqmusic.qq.com/'],
              midurlinfo: [{ purl: '' }],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_0: {
            data: {
              sip: ['https://isure.stream.qqmusic.qq.com/'],
              midurlinfo: [{ purl: '' }],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          req_0: {
            data: {
              sip: ['https://isure.stream.qqmusic.qq.com/'],
              midurlinfo: [{ purl: 'M800media-mid.mp3?vkey=temporary' }],
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const source = await new QQMusicStreamingProvider().resolvePlayback({ provider: 'qqmusic', providerTrackId: 'song-mid' });

    const losslessBody = JSON.parse(String(fetchRunner.mock.calls[1][1]?.body));
    const highBody = JSON.parse(String(fetchRunner.mock.calls[4][1]?.body));

    expect(losslessBody.req_0.param.filename).toEqual(['F000media-mid.flac']);
    expect(losslessBody.req_0.module).toBe('music.vkey.GetVkey');
    expect(highBody.req_0.param.filename).toEqual(['M800media-mid.mp3']);
    expect(highBody.req_0.module).toBe('music.vkey.GetVkey');
    expect(source).toMatchObject({
      url: 'https://isure.stream.qqmusic.qq.com/M800media-mid.mp3?vkey=temporary',
      codec: 'mp3',
      bitrate: 320000,
      bitDepth: null,
    });
  });

  it('exposes account status through provider descriptors', () => {
    accountStatus.connected = false;
    const qqDescriptor = new QQMusicStreamingProvider().descriptor;
    const neteaseDescriptor = new NeteaseStreamingProvider().descriptor;

    expect(qqDescriptor).toMatchObject({
      displayName: 'QQ 音乐',
      requiresAccount: false,
      accountConnected: false,
      status: 'ready',
    });
    expect(neteaseDescriptor).toMatchObject({
      displayName: '网易云音乐',
      requiresAccount: false,
      accountConnected: false,
      status: 'ready',
    });
  });
});
