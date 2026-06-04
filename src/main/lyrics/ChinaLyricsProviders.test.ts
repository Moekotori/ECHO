import { afterEach, describe, expect, it, vi } from 'vitest';
import { KugouLyricsProvider } from './KugouLyricsProvider';
import { KuwoLyricsProvider } from './KuwoLyricsProvider';
import { AmllTtmlLyricsProvider } from './AmllTtmlLyricsProvider';
import { NeteaseLyricsProvider } from './NeteaseLyricsProvider';
import { QQMusicLyricsProvider } from './QQMusicLyricsProvider';
import { buildNormalizedLyricsQuery } from './lyricsQueryBuilder';
import type { LyricsQuery } from '../../shared/types/lyrics';

const query: LyricsQuery = {
  trackId: 'track-1',
  title: 'Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  durationSeconds: 120,
};

const normalizedQuery = buildNormalizedLyricsQuery(query);

const request = {
  query,
  normalized: {
    ...normalizedQuery,
    searchVariants: normalizedQuery.searchVariants.slice(0, 1),
  },
  timeoutMs: 4500,
};

const mockJsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const mockTextResponse = (value: string, status = 200): Response =>
  new Response(value, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

const amllTtml = [
  '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:amll="http://www.example.com/ns/amll" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">',
  '<head><metadata>',
  '<amll:meta key="musicName" value="Echo Song"/>',
  '<amll:meta key="artists" value="Echo Artist"/>',
  '<amll:meta key="album" value="Echo Album"/>',
  '<amll:meta key="ncmMusicId" value="101126"/>',
  '</metadata></head>',
  '<body dur="0:02.000"><div>',
  '<p begin="0.000" end="2.000"><span begin="0.000" end="1.000">Echo</span><span begin="1.000" end="2.000">line</span></p>',
  '</div></body>',
  '</tt>',
].join('');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('China lyrics providers', () => {
  it('maps AMLL TTML search results through a NetEase id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          result: {
            songs: [
              {
                id: 101126,
                name: 'Echo Song',
                duration: 2000,
                artists: [{ name: 'Echo Artist' }],
                album: { name: 'Echo Album' },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(mockTextResponse(amllTtml));
    vi.stubGlobal('fetch', fetchMock);

    const [candidate] = await new AmllTtmlLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'amll-ttml',
      providerLyricsId: 'amll-ttml:ncm:101126',
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 2,
      syncedLyrics: amllTtml,
      sourceLabel: 'AMLL TTML',
    });
    expect(candidate.matchReasons).toContain('amll_ttml_provider');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/ncm-lyrics/101126.ttml');
  });

  it('uses a streaming NetEase source id directly for AMLL TTML lyrics', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockTextResponse(amllTtml));
    vi.stubGlobal('fetch', fetchMock);

    const streamingQuery: LyricsQuery = {
      ...query,
      trackId: 'streaming:netease:101126',
      mediaType: 'streaming',
      sourceId: '101126',
      stableKey: 'streaming:netease:101126',
    };
    const [candidate] = await new AmllTtmlLyricsProvider().search({
      query: streamingQuery,
      normalized: buildNormalizedLyricsQuery(streamingQuery),
      timeoutMs: 4500,
    });

    expect(candidate).toMatchObject({
      provider: 'amll-ttml',
      providerLyricsId: 'amll-ttml:ncm:101126',
      title: 'Echo Song',
      syncedLyrics: amllTtml,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ncm-lyrics/101126.ttml');
  });

  it('does not treat non-NetEase numeric streaming source ids as AMLL TTML ids', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockJsonResponse({ result: { songs: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const streamingQuery: LyricsQuery = {
      ...query,
      trackId: 'streaming:qqmusic:101126',
      mediaType: 'streaming',
      sourceId: '101126',
      stableKey: 'streaming:qqmusic:101126',
    };
    const normalizedStreamingQuery = buildNormalizedLyricsQuery(streamingQuery);
    const results = await new AmllTtmlLyricsProvider().search({
      query: streamingQuery,
      normalized: {
        ...normalizedStreamingQuery,
        searchVariants: normalizedStreamingQuery.searchVariants.slice(0, 1),
      },
      timeoutMs: 4500,
    });

    expect(results).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('music.163.com/api/search');
    expect(String(fetchMock.mock.calls[1][0])).toContain('music.163.com/api/cloudsearch');
  });

  it('falls back to another AMLL TTML mirror when the first mirror misses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          result: {
            songs: [
              {
                id: 101126,
                name: 'Echo Song',
                duration: 2000,
                artists: [{ name: 'Echo Artist' }],
                album: { name: 'Echo Album' },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(mockTextResponse('missing', 404))
      .mockResolvedValueOnce(mockTextResponse(amllTtml));
    vi.stubGlobal('fetch', fetchMock);

    const [candidate] = await new AmllTtmlLyricsProvider().search(request);

    expect(candidate.provider).toBe('amll-ttml');
    expect(String(fetchMock.mock.calls[2][0])).toContain('amll-ttml-db.stevexmh.net/ncm/101126');
  });

  it('falls back to NetEase cloudsearch for AMLL TTML song ids', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse({ code: 405, message: 'busy' }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          result: {
            songs: [
              {
                id: 101126,
                name: 'Echo Song',
                dt: 2000,
                ar: [{ name: 'Echo Artist' }],
                al: { name: 'Echo Album' },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(mockTextResponse(amllTtml));
    vi.stubGlobal('fetch', fetchMock);

    const [candidate] = await new AmllTtmlLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'amll-ttml',
      providerLyricsId: 'amll-ttml:ncm:101126',
      durationSeconds: 2,
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/cloudsearch/pc');
  });

  it('maps NetEase search and lyric responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          result: {
            songs: [
              {
                id: 123,
                name: 'Echo Song',
                duration: 120000,
                artists: [{ name: 'Echo Artist' }],
                album: { name: 'Echo Album' },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          lrc: { lyric: '[00:01.00]Line' },
          tlyric: { lyric: '[00:01.00]Translated' },
          romalrc: { lyric: '[00:01.00]Romanized' },
        }),
      );
    vi.stubGlobal(
      'fetch',
      fetchMock,
    );

    const [candidate] = await new NeteaseLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'netease',
      providerLyricsId: 'netease:123',
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
      syncedLyrics: '[00:01.00]Line',
      translationLyrics: '[00:01.00]Translated',
      romanizationLyrics: '[00:01.00]Romanized',
      sourceLabel: 'NetEase',
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('yv=1');
    expect(String(fetchMock.mock.calls[1][0])).toContain('rv=1');
  });

  it('stops NetEase automatic matching after the first searchable variant with lyrics', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          result: {
            songs: [
              {
                id: 123,
                name: 'Echo Song',
                duration: 120000,
                artists: [{ name: 'Echo Artist' }],
                album: { name: 'Echo Album' },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          lrc: { lyric: '[00:01.00]Fast line' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const variantQuery: LyricsQuery = {
      ...query,
      title: 'Echo Song (Acoustic)',
    };
    const normalized = buildNormalizedLyricsQuery(variantQuery);
    const [candidate] = await new NeteaseLyricsProvider().search({
      query: variantQuery,
      normalized,
      timeoutMs: 4500,
      collectAllCandidates: false,
    });

    expect(candidate).toMatchObject({
      provider: 'netease',
      providerLyricsId: 'netease:123',
      syncedLyrics: '[00:01.00]Fast line',
    });
    expect(normalized.searchVariants.length).toBeGreaterThan(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to NetEase cloudsearch when legacy search is throttled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse({ code: 405, message: 'busy' }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          result: {
            songs: [
              {
                id: 123,
                name: 'Echo Song',
                dt: 120000,
                ar: [{ name: 'Echo Artist' }],
                al: { name: 'Echo Album' },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          lrc: { lyric: '[00:01.00]Line' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const [candidate] = await new NeteaseLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'netease',
      providerLyricsId: 'netease:123',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
      syncedLyrics: '[00:01.00]Line',
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/cloudsearch/pc');
  });

  it('maps NetEase nolyric responses to instrumental results', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          mockJsonResponse({
            result: {
              songs: [
                {
                  id: 456,
                  name: 'Echo Song Instrumental',
                  duration: 120000,
                  artists: [{ name: 'Echo Artist' }],
                  album: { name: 'Echo Album' },
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(mockJsonResponse({ nolyric: true })),
    );

    const [candidate] = await new NeteaseLyricsProvider().search(request);

    expect(candidate.instrumental).toBe(true);
    expect(candidate.syncedLyrics).toBeNull();
    expect(candidate.plainLyrics).toBeNull();
  });

  it('keeps NetEase karaoke lyrics even when ordinary lyrics are missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          mockJsonResponse({
            result: {
              songs: [
                {
                  id: 789,
                  name: 'Echo Song',
                  duration: 120000,
                  artists: [{ name: 'Echo Artist' }],
                  album: { name: 'Echo Album' },
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            klyric: { lyric: '[00:01.00]<00:01.00>Hello <00:01.50>world' },
          }),
        ),
    );

    const [candidate] = await new NeteaseLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'netease',
      providerLyricsId: 'netease:789',
      syncedLyrics: null,
      karaokeLyrics: '[00:01.00]<00:01.00>Hello <00:01.50>world',
    });
  });

  it('keeps NetEase YRC word lyrics before ordinary karaoke lyrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          mockJsonResponse({
            result: {
              songs: [
                {
                  id: 790,
                  name: 'Echo Song',
                  duration: 120000,
                  artists: [{ name: 'Echo Artist' }],
                  album: { name: 'Echo Album' },
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            lrc: { lyric: '[00:01.00]Plain line' },
            yrc: { lyric: '[1000,1200](1000,300,0)Hello (1300,400,0)world' },
            klyric: { lyric: '[00:01.00]<00:01.00>Less <00:01.50>precise' },
          }),
        ),
    );

    const [candidate] = await new NeteaseLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'netease',
      providerLyricsId: 'netease:790',
      syncedLyrics: '[00:01.00]Plain line',
      karaokeLyrics: '[1000,1200](1000,300,0)Hello (1300,400,0)world',
    });
  });

  it('maps QQ Music search and plain lyric responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          mockJsonResponse({
            req_1: {
              data: {
                body: {
                  song: {
                    list: [
                      {
                        mid: 'song-mid',
                        name: 'Echo Song',
                        interval: 120,
                        singer: [{ name: 'Echo Artist' }],
                        album: { name: 'Echo Album' },
                      },
                    ],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            lyric: '[00:01.00]Line',
            trans: '[00:01.00]Translated',
            roma: '[00:01.00]Romanized',
          }),
        ),
    );

    const [candidate] = await new QQMusicLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'qqmusic',
      providerLyricsId: 'qqmusic:song-mid',
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
      syncedLyrics: '[00:01.00]Line',
      translationLyrics: '[00:01.00]Translated',
      romanizationLyrics: '[00:01.00]Romanized',
      sourceLabel: 'QQ Music',
    });
  });

  it('decodes QQ Music base64 lyric fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          mockJsonResponse({
            req_1: {
              data: {
                body: {
                  song: {
                    list: [
                      {
                        mid: 'song-mid',
                        name: 'Echo Song',
                        interval: 120,
                        singer: [{ name: 'Echo Artist' }],
                        album: { name: 'Echo Album' },
                      },
                    ],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            lyric: Buffer.from('Plain line', 'utf8').toString('base64'),
          }),
        ),
    );

    const [candidate] = await new QQMusicLyricsProvider().search(request);

    expect(candidate.plainLyrics).toBe('Plain line');
  });

  it('uses QQ Music streaming source id directly when searching lyrics candidates', async () => {
    const streamingQuery: LyricsQuery = {
      ...query,
      trackId: 'streaming:qqmusic:123456',
      mediaType: 'streaming',
      sourceId: '123456',
      stableKey: 'streaming:qqmusic:123456',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(mockJsonResponse({ code: 0, data: [] }))
        .mockResolvedValueOnce(
          mockJsonResponse({
            code: 0,
            data: [
              {
                id: 123456,
                mid: 'normalized-song-mid',
                name: 'Echo Song',
                interval: 120,
                singer: [{ name: 'Echo Artist' }],
                album: { name: 'Echo Album' },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            lyric: '[00:01.00]Direct streaming line',
          }),
        ),
    );

    const [candidate] = await new QQMusicLyricsProvider().search({
      query: streamingQuery,
      normalized: buildNormalizedLyricsQuery(streamingQuery),
      timeoutMs: 4500,
    });

    expect(candidate).toMatchObject({
      provider: 'qqmusic',
      providerLyricsId: 'qqmusic:normalized-song-mid',
      title: 'Echo Song',
      artist: 'Echo Artist',
      syncedLyrics: '[00:01.00]Direct streaming line',
    });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(String(fetchMock.mock.calls[0][0])).toContain('songmid=123456');
    expect(String(fetchMock.mock.calls[1][0])).toContain('songid=123456');
    expect(String(fetchMock.mock.calls[2][0])).toContain('songmid=normalized-song-mid');
  });

  it('keeps QQ Music qrc lyrics even when ordinary lyrics are missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          mockJsonResponse({
            req_1: {
              data: {
                body: {
                  song: {
                    list: [
                      {
                        mid: 'song-mid',
                        name: 'Echo Song',
                        interval: 120,
                        singer: [{ name: 'Echo Artist' }],
                        album: { name: 'Echo Album' },
                      },
                    ],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            qrc: '[00:01.00]<00:01.00>Hello <00:01.50>world',
          }),
        ),
    );

    const [candidate] = await new QQMusicLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'qqmusic',
      providerLyricsId: 'qqmusic:song-mid',
      syncedLyrics: null,
      karaokeLyrics: '[00:01.00]<00:01.00>Hello <00:01.50>world',
    });
  });

  it('falls back to the legacy QQ Music search response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          mockJsonResponse({
            req_1: {
              data: {
                body: {
                  song: {
                    list: [],
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            data: {
              song: {
                list: [
                  {
                    mid: 'legacy-song-mid',
                    name: 'Echo Song',
                    interval: 120,
                    singer: [{ name: 'Echo Artist' }],
                    album: { name: 'Echo Album' },
                  },
                ],
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            lyric: '[00:01.00]Legacy line',
          }),
        ),
    );

    const [candidate] = await new QQMusicLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'qqmusic',
      providerLyricsId: 'qqmusic:legacy-song-mid',
      syncedLyrics: '[00:01.00]Legacy line',
    });
  });

  it('maps KuGou search, lyric candidate, and downloaded LRC responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            info: [
              {
                hash: 'kugou-hash',
                SongName: 'Echo Song',
                SingerName: 'Echo Artist',
                AlbumName: 'Echo Album',
                Duration: 120,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          candidates: [
            {
              id: 'lyric-id',
              accesskey: 'lyric-key',
              song: 'Echo Song',
              singer: 'Echo Artist',
              duration: 120000,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          content: Buffer.from('[00:01.00]KuGou line', 'utf8').toString('base64'),
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const [candidate] = await new KugouLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'kugou',
      providerLyricsId: 'kugou:lyric-id',
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
      syncedLyrics: '[00:01.00]KuGou line',
      sourceLabel: 'KuGou',
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('hash=kugou-hash');
    expect(String(fetchMock.mock.calls[2][0])).toContain('accesskey=lyric-key');
  });

  it('maps Kuwo search and lrclist responses to synced lyrics', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          abslist: [
            {
              MUSICRID: 'MUSIC_12345',
              SONGNAME: 'Echo Song',
              ARTIST: 'Echo Artist',
              ALBUM: 'Echo Album',
              DURATION: 120,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            lrclist: [
              { time: '1.2', lineLyric: 'Kuwo line' },
              { time: '2.34', lineLyric: 'Second line' },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const [candidate] = await new KuwoLyricsProvider().search(request);

    expect(candidate).toMatchObject({
      provider: 'kuwo',
      providerLyricsId: 'kuwo:12345',
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
      syncedLyrics: '[00:01.20]Kuwo line\n[00:02.34]Second line',
      sourceLabel: 'Kuwo',
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('musicId=12345');
  });

  it('swallows provider network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(new NeteaseLyricsProvider().search(request)).resolves.toEqual([]);
    await expect(new QQMusicLyricsProvider().search(request)).resolves.toEqual([]);
    await expect(new KugouLyricsProvider().search(request)).resolves.toEqual([]);
    await expect(new KuwoLyricsProvider().search(request)).resolves.toEqual([]);
  });
});
