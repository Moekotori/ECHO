import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryTrack } from '../../shared/types/library';
import type { MvSettings, TrackVideo } from '../../shared/types/mv';
import { BilibiliMvProvider, YouTubeMvProvider } from './OnlineMvProviders';

const track: LibraryTrack = {
  id: 'track-1',
  path: 'D:\\Music\\Echo Song.flac',
  title: 'Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  albumArtist: 'Echo Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 120,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
};

const settings: MvSettings = {
  autoSearch: true,
  autoPreload: true,
  restartAudioOnLoad: false,
  enabledProviders: ['bilibili', 'youtube'],
  providerOrder: ['bilibili', 'youtube'],
  maxQuality: '1080p',
  allow60fps: true,
};

const video: TrackVideo = {
  id: 'video-1',
  trackId: 'track-1',
  provider: 'bilibili',
  sourceType: 'search_candidate',
  sourceId: 'BV1echo',
  title: 'Echo Song MV',
  artist: 'Echo Artist',
  url: 'https://www.bilibili.com/video/BV1echo',
  providerUrl: 'https://www.bilibili.com/video/BV1echo',
  thumbnailUrl: null,
  filePath: null,
  mediaUrl: null,
  mimeType: null,
  durationSeconds: null,
  width: null,
  height: null,
  selectedQualityId: 'auto',
  qualityLabel: null,
  fps: null,
  score: 0.7,
  selected: true,
  playableInApp: false,
  rawProviderJson: null,
  createdAt: '2026-05-13T00:00:00.000Z',
  updatedAt: '2026-05-13T00:00:00.000Z',
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BilibiliMvProvider', () => {
  it('maps search results and sends account cookie only from main dependencies', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          result: [
            {
              bvid: 'BV1echo',
              title: '<em class="keyword">Echo</em> Song MV',
              author: 'Echo Channel',
              pic: '//i.example/echo.jpg',
              play: '12.3万',
            },
          ],
        },
      }),
    ) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili', cookie: 'SESSDATA=secret' }),
    });

    const candidates = await provider.search(track, settings);

    expect(candidates[0]).toMatchObject({
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      providerUrl: 'https://www.bilibili.com/video/BV1echo',
      thumbnailUrl: 'https://i.example/echo.jpg',
      uploader: 'Echo Channel',
      viewCount: 123000,
    });
    expect(candidates[0]?.reasons).toContain('播放 123000');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('api.bilibili.com/x/web-interface/search/type'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'SESSDATA=secret',
          Referer: 'https://search.bilibili.com/video?keyword=Echo%20Song%20Echo%20Artist%20MV',
          Origin: 'https://search.bilibili.com',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('order=click'), expect.anything());
  });

  it('uses signed WBI search when Bilibili exposes WBI keys', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/nav')) {
        return jsonResponse({
          data: {
            wbi_img: {
              img_url: 'https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzABCDEF.png',
              sub_url: 'https://i0.hdslb.com/bfs/wbi/0123456789abcdefghijklmnopqrstuvwxyzABCDEF.png',
            },
          },
        });
      }

      return jsonResponse({
        data: {
          result: [
            {
              bvid: 'BV1wbi',
              title: 'Echo Song Official MV',
              author: 'Echo Channel',
              pic: '//i.example/wbi.jpg',
              play: '1.2万',
            },
          ],
        },
      });
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const candidates = await provider.search(track, settings);

    expect(candidates[0]).toMatchObject({
      provider: 'bilibili',
      title: 'Echo Song Official MV',
      providerUrl: 'https://www.bilibili.com/video/BV1wbi',
    });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/x/web-interface/nav'), expect.anything());
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp('api\\.bilibili\\.com/x/web-interface/wbi/search/type.*w_rid=')),
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: 'https://search.bilibili.com/video?keyword=Echo%20Song%20Echo%20Artist%20MV',
          Origin: 'https://search.bilibili.com',
        }),
      }),
    );
  });

  it('falls back to Bilibili all search when signed video search returns no candidates', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/nav')) {
        return jsonResponse({
          data: {
            wbi_img: {
              img_url: 'https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzABCDEF.png',
              sub_url: 'https://i0.hdslb.com/bfs/wbi/0123456789abcdefghijklmnopqrstuvwxyzABCDEF.png',
            },
          },
        });
      }

      if (url.includes('/x/web-interface/wbi/search/type')) {
        return jsonResponse({ data: { result: [] } });
      }

      if (url.includes('/x/web-interface/search/all/v2')) {
        return jsonResponse({
          data: {
            result: [
              {
                result_type: 'video',
                data: [
                  {
                    bvid: 'BV1all',
                    title: '<em class="keyword">Echo</em> Song Official MV',
                    author: 'Echo Channel',
                    pic: '//i.example/all.jpg',
                    play: 32000,
                  },
                ],
              },
            ],
          },
        });
      }

      return jsonResponse({ code: -1 }, 404);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const candidates = await provider.search(track, settings);

    expect(candidates[0]).toMatchObject({
      id: 'bilibili:BV1all',
      title: 'Echo Song Official MV',
      providerUrl: 'https://www.bilibili.com/video/BV1all',
      viewCount: 32000,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/x/web-interface/search/all/v2'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: 'https://search.bilibili.com/all?keyword=Echo%20Song%20Echo%20Artist%20MV',
        }),
      }),
    );
  });

  it('keeps entity-encoded Bilibili titles auto-matchable for slash-separated artists', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/nav')) {
        return jsonResponse({ data: {} });
      }

      if (url.includes('/x/web-interface/search/type')) {
        return jsonResponse({ code: -412 }, 412);
      }

      if (url.includes('/x/web-interface/search/all/v2')) {
        return jsonResponse({
          data: {
            result: [
              {
                result_type: 'video',
                data: [
                  {
                    bvid: 'BV1heaven',
                    title: '【liquid Funk】Heaven&#x27;s ray - rinahamu&amp;KOTONOHOUSE&amp;Pure 100%',
                    author: 'Echo Channel',
                    pic: '//i.example/heaven.jpg',
                    play: 5418,
                  },
                ],
              },
            ],
          },
        });
      }

      return jsonResponse({ code: -1 }, 404);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const candidates = await provider.search(
      {
        ...track,
        title: "Heaven's ray",
        artist: 'rinahamu/KOTONOHOUSE/Pure 100%',
        albumArtist: 'rinahamu/KOTONOHOUSE/Pure 100%',
      },
      settings,
    );

    expect(candidates[0]).toMatchObject({
      id: 'bilibili:BV1heaven',
      title: "【liquid Funk】Heaven's ray - rinahamu&KOTONOHOUSE&Pure 100%",
      providerUrl: 'https://www.bilibili.com/video/BV1heaven',
    });
    expect(candidates[0]?.score).toBeGreaterThanOrEqual(0.7);
  });

  it('falls back to plain Bilibili playurl when WBI playurl does not return usable streams', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/nav')) {
        return jsonResponse({
          data: {
            wbi_img: {
              img_url: 'https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzABCDEF.png',
              sub_url: 'https://i0.hdslb.com/bfs/wbi/0123456789abcdefghijklmnopqrstuvwxyzABCDEF.png',
            },
          },
        });
      }

      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 1516848961 } });
      }

      if (url.includes('/x/player/wbi/playurl')) {
        return jsonResponse({ code: -404, message: 'wbi playurl rejected' }, 404);
      }

      if (url.includes('/x/player/playurl') && url.includes('fnval=1')) {
        return jsonResponse({
          data: {
            quality: 64,
            accept_quality: [64, 16],
            durl: [{ url: 'https://upos.example/tsubasa-720.mp4' }],
          },
        });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const variants = await provider.resolve(
      {
        ...video,
        sourceId: 'BV1BD421J7w3',
        url: 'https://www.bilibili.com/video/BV1BD421J7w3',
        providerUrl: 'https://www.bilibili.com/video/BV1BD421J7w3',
      },
      settings,
    );

    expect(variants).toContainEqual(expect.objectContaining({
      id: 'bilibili-qn-64',
      protocol: 'direct',
      playableInApp: true,
      url: 'https://upos.example/tsubasa-720.mp4',
      rawProviderJson: expect.objectContaining({
        endpoint: 'playurl',
        resolver: 'bilibili-progressive-mp4-v1',
        source: 'durl',
      }),
    }));
  });

  it('logs compact Bilibili playurl health when only browser-incompatible DASH streams are resolved', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/nav')) {
        return jsonResponse({ data: {} });
      }

      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('/x/player/playurl')) {
        return jsonResponse({
          code: 0,
          message: 'OK',
          data: {
            quality: 64,
            accept_quality: [64],
            dash: {
              video: [
                {
                  id: 64,
                  baseUrl: 'https://upos.example/video-only.m4s',
                  width: 1280,
                  height: 720,
                  codecs: 'hvc1.1.6.L120.90',
                },
              ],
            },
          },
        });
      }

      return jsonResponse({ code: -1 }, 404);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const variants = await provider.resolve(video, settings);

    expect(variants.every((variant) => variant.protocol !== 'direct')).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      '[mv] Bilibili MV resolved without an in-app MP4 stream.',
      expect.objectContaining({
        bvid: 'BV1echo',
        cid: 123,
        maxQuality: '1080p',
        attempts: expect.arrayContaining([
          expect.objectContaining({
            endpoint: 'playurl',
            fnval: '1',
            status: 200,
            code: 0,
            quality: 64,
            hasDurl: false,
            hasDashVideo: true,
          }),
        ]),
      }),
    );
  });

  it('sorts Bilibili search results by match score first and play count second', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          result: [
            {
              bvid: 'BV1popular',
              title: 'Popular unrelated video',
              author: 'Echo Channel',
              pic: '//i.example/popular.jpg',
              play: '99万',
            },
            {
              bvid: 'BV1low',
              title: 'Echo Song Low Play',
              author: 'Echo Channel',
              pic: '//i.example/low.jpg',
              play: '9000',
            },
            {
              bvid: 'BV1high',
              title: 'Echo Song High Play',
              author: 'Echo Channel',
              pic: '//i.example/high.jpg',
              play: '3.2万',
            },
          ],
        },
      }),
    ) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const candidates = await provider.search(track, settings);

    expect(candidates.map((candidate) => candidate.id)).toEqual(['bilibili:BV1high', 'bilibili:BV1low', 'bilibili:BV1popular']);
    expect(candidates.map((candidate) => candidate.viewCount)).toEqual([32000, 9000, 990000]);
    expect(candidates[0]?.score).toBe(candidates[1]?.score);
    expect(candidates[1]!.score).toBeGreaterThan(candidates[2]!.score);
  });

  it('sorts Bilibili search results by play count first when popularity matching is enabled', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          result: [
            {
              bvid: 'BV1accurate',
              title: 'Echo Song Official MV',
              author: 'Echo Channel',
              pic: '//i.example/accurate.jpg',
              play: 1200,
            },
            {
              bvid: 'BV1popular',
              title: 'Popular unrelated video',
              author: 'Echo Channel',
              pic: '//i.example/popular.jpg',
              play: 250000,
            },
          ],
        },
      }),
    ) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const candidates = await provider.search(track, { ...settings, preferHighestViewCount: true }, 'Echo Song Echo Artist');

    expect(candidates.map((candidate) => candidate.id)).toEqual(['bilibili:BV1popular', 'bilibili:BV1accurate']);
    expect(candidates.map((candidate) => candidate.viewCount)).toEqual([250000, 1200]);
  });

  it('resolves the first playable direct MP4 stream within the quality cap', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('qn=80')) {
        return jsonResponse({ data: { durl: [{ url: 'https://cdn.example/1080.mp4' }] } });
      }

      if (url.includes('qn=64')) {
        return jsonResponse({ data: { durl: [{ url: 'https://cdn.example/720.mp4' }] } });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const variants = await provider.resolve(video, settings);

    expect(variants.map((variant) => variant.id)).toEqual(['bilibili-qn-80']);
    expect(variants[0]).toMatchObject({
      label: '1080p',
      qualityTier: '1080p',
      mimeType: 'video/mp4',
      playableInApp: true,
      url: 'https://cdn.example/1080.mp4',
      headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
    });
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining('qn=64'), expect.anything());
  });

  it('uses the WBI playurl endpoint when Bilibili exposes signing keys', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('/x/web-interface/nav')) {
        return jsonResponse({
          data: {
            wbi_img: {
              img_url: 'https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzABCDEF.png',
              sub_url: 'https://i0.hdslb.com/bfs/wbi/0123456789abcdefghijklmnopqrstuvwxyzABCDEF.png',
            },
          },
        });
      }

      if (url.includes('/x/player/wbi/playurl') && url.includes('qn=80')) {
        expect(url).toContain('wts=');
        expect(url).toContain('w_rid=');
        return jsonResponse({ data: { quality: 80, durl: [{ url: 'https://cdn.example/wbi-1080.mp4' }] } });
      }

      if (url.includes('/x/player/playurl')) {
        throw new Error('unsigned playurl endpoint should not be used when WBI keys are available');
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili', cookie: 'SESSDATA=secret' }),
    });

    const variants = await provider.resolve(video, settings);

    expect(variants[0]).toMatchObject({
      id: 'bilibili-qn-80',
      url: 'https://cdn.example/wbi-1080.mp4',
      rawProviderJson: {
        endpoint: 'wbi-playurl',
      },
    });
  });

  it('exposes browser-playable DASH video-only streams for muted in-app MV playback', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('qn=80') && url.includes('fnval=4048')) {
        return jsonResponse({
          data: {
            quality: 80,
            dash: {
              video: [
                {
                  id: 80,
                  baseUrl: 'https://upos.example/1080-video-only.m4s',
                  backupUrl: ['https://upos-backup.example/1080-video-only.m4s'],
                  width: 1920,
                  height: 1080,
                  frameRate: '30',
                  codecs: 'avc1.640032',
                },
              ],
            },
          },
        });
      }

      if (url.includes('qn=80') && url.includes('fnval=1')) {
        return jsonResponse({
          data: {
            quality: 80,
            durl: [{ url: 'https://upos.example/1080-progressive.mp4' }],
          },
        });
      }

      if (url.includes('qn=64') && url.includes('fnval=4048')) {
        return jsonResponse({
          data: {
            quality: 64,
            dash: {
              video: [
                {
                  id: 64,
                  baseUrl: 'https://upos.example/720-video-only.m4s',
                  width: 1280,
                  height: 720,
                  frameRate: '30',
                  codecs: 'avc1.640028',
                },
              ],
            },
          },
        });
      }

      if (url.includes('qn=64') && url.includes('fnval=1')) {
        return jsonResponse({
          data: {
            quality: 64,
            durl: [{ url: 'https://upos.example/720-progressive.mp4' }],
          },
        });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili', cookie: 'SESSDATA=secret' }),
    });

    const variants = await provider.resolve(video, settings);

    expect(variants.map((variant) => variant.id)).toEqual(['bilibili-dash-qn-80-avc']);
    expect(variants.find((variant) => variant.id === 'bilibili-dash-qn-80-avc')).toMatchObject({
      label: '1080p',
      qualityTier: '1080p',
      width: 1920,
      height: 1080,
      codec: 'avc1.640032',
      protocol: 'direct',
      playableInApp: true,
      url: 'https://upos.example/1080-video-only.m4s',
      headers: {
        Cookie: 'SESSDATA=secret',
        Referer: 'https://www.bilibili.com/video/BV1echo',
      },
      rawProviderJson: expect.objectContaining({
        mutedVideoOnly: true,
      }),
    });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('fnval=4048'), expect.anything());
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining('qn=64'), expect.anything());
  });

  it('records the current Bilibili DASH response shape for BV1KjQDYdEx2 as muted video-only playback', async () => {
    const targetVideo: TrackVideo = {
      ...video,
      sourceId: 'BV1KjQDYdEx2',
      title: '“敲卡哇伊的调调！！！被萌化惹🥰” |《さようなら、花泥棒さん (cover)》',
      url: 'https://www.bilibili.com/video/BV1KjQDYdEx2',
      providerUrl: 'https://www.bilibili.com/video/BV1KjQDYdEx2',
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ code: 0, data: { cid: 28882894939, title: targetVideo.title } });
      }

      if ((url.includes('qn=80') || url.includes('qn=64')) && url.includes('fnval=4048')) {
        return jsonResponse({
          code: 0,
          message: 'OK',
          data: {
            quality: 64,
            accept_quality: [112, 80, 64, 32, 16],
            dash: {
              video: [
                {
                  id: 64,
                  baseUrl: 'https://upos.example/BV1KjQDYdEx2-720p.m4s',
                  backupUrl: ['https://upos-backup.example/BV1KjQDYdEx2-720p.m4s'],
                  width: 1280,
                  height: 720,
                  frameRate: '30',
                  codecs: 'avc1.640028',
                },
              ],
            },
          },
        });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const variants = await provider.resolve(targetVideo, settings);

    expect(variants[0]).toMatchObject({
      id: 'bilibili-dash-qn-64-avc',
      label: '720p',
      protocol: 'direct',
      playableInApp: true,
      url: 'https://upos.example/BV1KjQDYdEx2-720p.m4s',
      headers: {
        Referer: 'https://www.bilibili.com/video/BV1KjQDYdEx2',
      },
      rawProviderJson: {
        cid: 28882894939,
        qualityLimited: true,
        mutedVideoOnly: true,
      },
    });
  });

  it('uses a bounded fallback when max quality is selected', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('qn=120')) {
        return jsonResponse({ data: { quality: 120, durl: [{ url: 'https://cdn.example/4k.mp4' }] } });
      }

      if (url.includes('qn=116')) {
        return jsonResponse({ data: { quality: 116, durl: [{ url: 'https://cdn.example/1080-60.mp4' }] } });
      }

      if (url.includes('qn=80')) {
        return jsonResponse({ data: { quality: 80, durl: [{ url: 'https://cdn.example/1080.mp4' }] } });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const variants = await provider.resolve(video, { ...settings, maxQuality: 'max', allow60fps: true });

    expect(variants.map((variant) => variant.id)).toEqual(['bilibili-qn-80']);
    expect(variants[0]).toMatchObject({
      id: 'bilibili-qn-80',
      label: '1080p',
      rawProviderJson: {
        requestedQn: 80,
        qn: 80,
        qualityRank: 2,
        qualityLimited: false,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining('qn=120'), expect.anything());
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining('qn=116'), expect.anything());
  });

  it('stops playurl resolution immediately when Bilibili bans the request', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('/x/player/playurl')) {
        return jsonResponse({ message: 'request was banned' }, 412);
      }

      return jsonResponse({ data: {} });
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const firstResult = await provider.resolve(video, { ...settings, maxQuality: 'max' });
    await provider.resolve(video, { ...settings, maxQuality: 'max' });

    const playurlCalls = vi.mocked(fetchImpl).mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/x/player/playurl'));
    expect(playurlCalls).toHaveLength(1);
    expect(playurlCalls[0]).toContain('qn=127');
    expect(playurlCalls[0]).toContain('fnval=4048');
    expect(playurlCalls[0]).not.toContain('qn=126');
    expect(firstResult[0]).toMatchObject({
      rawProviderJson: expect.objectContaining({
        unavailableReason: 'bilibili-playurl-blocked',
        status: 412,
      }),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[mv] Bilibili MV resolved without an in-app MP4 stream.',
      expect.objectContaining({
        attempts: [
          expect.objectContaining({
            qn: 127,
            status: 412,
            error: 'request_failed:412',
          }),
        ],
      }),
    );
  });

  it('honors the 60fps setting when resolving Bilibili variants', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('qn=116')) {
        return jsonResponse({ data: { quality: 116, durl: [{ url: 'https://cdn.example/1080-60.mp4' }] } });
      }

      if (url.includes('qn=80')) {
        return jsonResponse({ data: { quality: 80, durl: [{ url: 'https://cdn.example/1080.mp4' }] } });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const variants = await provider.resolve(video, { ...settings, maxQuality: '1080p', allow60fps: false });

    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining('qn=116'), expect.anything());
    expect(variants.map((variant) => variant.id)).toEqual(['bilibili-qn-80']);
  });

  it('keeps HEVC DASH streams external while allowing browser-playable DASH video-only streams', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('qn=126') || url.includes('qn=125') || url.includes('qn=127')) {
        throw new Error('2160p cap should not request 8K, Dolby Vision, or HDR variants');
      }

      if (url.includes('qn=120')) {
        return jsonResponse({
          data: {
            quality: 120,
            dash: {
              video: [
                {
                  id: 120,
                  baseUrl: 'https://upos.example/4k-video-only.m4s',
                  width: 3840,
                  height: 2160,
                  frameRate: '60',
                  codecs: 'hev1.1.6.L153.90',
                },
              ],
            },
          },
        });
      }

      if (url.includes('qn=80') && url.includes('fnval=4048')) {
        return jsonResponse({
          data: {
            quality: 80,
            dash: {
              video: [
                {
                  id: 80,
                  baseUrl: 'https://upos.example/1080-avc.m4s',
                  width: 1920,
                  height: 1080,
                  frameRate: '30',
                  codecs: 'avc1.640032',
                },
              ],
            },
          },
        });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili', cookie: 'SESSDATA=secret' }),
    });

    const variants = await provider.resolve(video, { ...settings, maxQuality: '2160p', allow60fps: true });

    expect(variants[0]).toMatchObject({
      id: 'bilibili-dash-qn-120-hevc',
      label: '4K 60fps',
      qualityTier: '2160p',
      width: 3840,
      height: 2160,
      fps: 60,
      codec: 'hev1.1.6.L153.90',
      protocol: 'dash',
      playableInApp: false,
      url: 'https://upos.example/4k-video-only.m4s',
    });
    expect(variants.find((variant) => variant.id === 'bilibili-dash-qn-80-avc')).toMatchObject({
      label: '1080p',
      qualityTier: '1080p',
      codec: 'avc1.640032',
      protocol: 'direct',
      playableInApp: true,
      url: 'https://upos.example/1080-avc.m4s',
      rawProviderJson: expect.objectContaining({
        mutedVideoOnly: true,
      }),
    });
  });

  it('keeps codec-distinct DASH variants from the same Bilibili quality id', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 1511871442 } });
      }

      if (url.includes('fnval=4048')) {
        return jsonResponse({
          data: {
            quality: 127,
            accept_quality: [127, 120, 116, 80, 64, 32, 16],
            dash: {
              video: [
                {
                  id: 127,
                  baseUrl: 'https://upos.example/8k-hevc.m4s',
                  width: 7680,
                  height: 4320,
                  frameRate: '30.000',
                  codecs: 'hev1.1.6.L180.90',
                },
                {
                  id: 127,
                  baseUrl: 'https://upos.example/8k-av1.m4s',
                  width: 7680,
                  height: 4320,
                  frameRate: '30.000',
                  codecs: 'av01.0.01M.10.0.110.01.01.01.0',
                },
                {
                  id: 120,
                  baseUrl: 'https://upos.example/4k-avc.m4s',
                  width: 3840,
                  height: 2160,
                  frameRate: '59.941',
                  codecs: 'avc1.640034',
                },
              ],
            },
          },
        });
      }

      if (url.includes('fnval=1')) {
        return jsonResponse({
          data: {
            quality: 64,
            accept_quality: [64, 16],
            durl: [{ url: 'https://upos.example/720-progressive.mp4' }],
          },
        });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili', cookie: 'SESSDATA=secret' }),
    });

    const variants = await provider.resolve(
      { ...video, sourceId: 'BV1Gm41127gL', providerUrl: 'https://www.bilibili.com/video/BV1Gm41127gL' },
      { ...settings, maxQuality: 'max', allow60fps: true },
    );

    expect(variants.find((variant) => variant.id === 'bilibili-dash-qn-127-hevc')).toMatchObject({
      label: '8K',
      playableInApp: false,
      protocol: 'dash',
    });
    expect(variants.find((variant) => variant.id === 'bilibili-dash-qn-127-av1')).toMatchObject({
      label: '8K',
      playableInApp: true,
      protocol: 'direct',
      url: 'https://upos.example/8k-av1.m4s',
      rawProviderJson: expect.objectContaining({
        mutedVideoOnly: true,
        qn: 127,
      }),
    });
    expect(variants.find((variant) => variant.id === 'bilibili-dash-qn-120-avc')).toMatchObject({
      label: '4K 60fps',
      playableInApp: true,
      protocol: 'direct',
    });
  });

  it('keeps 4K 120fps DASH streams distinct but marks HEVC variants as not in-app playable', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('qn=120')) {
        return jsonResponse({
          data: {
            quality: 120,
            dash: {
              video: [
                {
                  id: 120,
                  baseUrl: 'https://upos.example/4k-60.m4s',
                  width: 3840,
                  height: 2160,
                  frameRate: '60',
                  codecs: 'hev1.1.6.L153.90',
                },
                {
                  id: 120,
                  baseUrl: 'https://upos.example/4k-120.m4s',
                  width: 3840,
                  height: 2160,
                  frameRate: '120',
                  codecs: 'hev1.1.6.L153.90',
                },
              ],
            },
          },
        });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili', cookie: 'SESSDATA=secret' }),
    });

    const variants = await provider.resolve(video, { ...settings, maxQuality: '2160p', allow60fps: true });

    expect(variants.map((variant) => variant.id)).toContain('bilibili-dash-qn-120-hevc');
    expect(variants.map((variant) => variant.id)).toContain('bilibili-dash-qn-120-120fps-hevc');
    expect(variants.find((variant) => variant.id === 'bilibili-dash-qn-120-120fps-hevc')).toMatchObject({
      label: '4K 120fps',
      qualityTier: '2160p',
      width: 3840,
      height: 2160,
      fps: 120,
      codec: 'hev1.1.6.L153.90',
      playableInApp: false,
      url: 'https://upos.example/4k-120.m4s',
    });
  });

  it('labels Bilibili streams with the actual returned quality when the requested quality is downgraded', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('qn=127')) {
        return jsonResponse({ data: { quality: 80, durl: [{ url: 'https://cdn.example/actual-1080.mp4' }] } });
      }

      if (url.includes('qn=80')) {
        return jsonResponse({ data: { quality: 80, durl: [{ url: 'https://cdn.example/actual-1080.mp4' }] } });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const variants = await provider.resolve(video, { ...settings, maxQuality: 'max' });

    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      id: 'bilibili-qn-80',
      label: '1080p',
      qualityTier: '1080p',
      height: 1080,
      url: 'https://cdn.example/actual-1080.mp4',
      rawProviderJson: {
        requestedQn: 127,
        qn: 80,
        qualityRank: 2,
        qualityLimited: true,
      },
    });
  });

  it('labels Bilibili progressive MP4 by the actual low quality returned for high quality requests', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('fnval=4048')) {
        return jsonResponse({ code: -1 }, 403);
      }

      if (url.includes('qn=112') && url.includes('fnval=1')) {
        return jsonResponse({
          data: {
            quality: 16,
            accept_quality: [80, 16],
            durl: [{ url: 'https://cdn.example/actual-360.mp4' }],
          },
        });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const variants = await provider.resolve(video, { ...settings, maxQuality: '1440p' });

    expect(variants[0]).toMatchObject({
      id: 'bilibili-qn-16',
      label: '360p',
      height: 360,
      playableInApp: true,
      url: 'https://cdn.example/actual-360.mp4',
      rawProviderJson: {
        requestedQn: 112,
        qn: 16,
        qualityLimited: true,
      },
    });
  });

  it('keeps the Bilibili 1080p60 label when the encoded DASH height is letterboxed', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('qn=116')) {
        return jsonResponse({
          data: {
            quality: 116,
            accept_quality: [116, 80, 64],
            dash: {
              video: [
                {
                  id: 116,
                  baseUrl: 'https://upos.example/1080-60-letterbox.m4s',
                  width: 1920,
                  height: 888,
                  frameRate: '60',
                  codecs: 'avc1.640032',
                },
              ],
            },
          },
        });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili', cookie: 'SESSDATA=secret' }),
    });

    const variants = await provider.resolve(video, { ...settings, maxQuality: '1080p', allow60fps: true });

    expect(variants[0]).toMatchObject({
      id: 'bilibili-dash-qn-116-avc',
      label: '1080p 60fps',
      qualityTier: '1080p',
      width: 1920,
      height: 888,
      fps: 60,
      rawProviderJson: {
        requestedQn: 116,
        qn: 116,
        qualityRank: 4,
        availableQn: [116, 80, 64],
      },
    });
  });

  it('does not trust a high requested qn as 8K when Bilibili omits the actual quality', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({ data: { cid: 123 } });
      }

      if (url.includes('qn=127')) {
        return jsonResponse({ data: { durl: [{ url: 'https://cdn.example/no-quality-field.mp4' }] } });
      }

      return jsonResponse({ code: -1 }, 403);
    }) as typeof fetch;
    const provider = new BilibiliMvProvider({
      fetchImpl,
      getCredentials: () => ({ provider: 'bilibili' }),
    });

    const variants = await provider.resolve(video, { ...settings, maxQuality: 'max' });

    expect(variants[0]).toMatchObject({
      id: 'bilibili-qn-120',
      label: '4K',
      qualityTier: '2160p',
      height: 2160,
      url: 'https://cdn.example/no-quality-field.mp4',
    });
  });
});

describe('YouTubeMvProvider', () => {
  it('requests YouTube results ordered by view count when an API key is configured', async () => {
    const originalEchoKey = process.env.ECHO_YOUTUBE_API_KEY;
    process.env.ECHO_YOUTUBE_API_KEY = 'test-key';
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] })) as typeof fetch;
    const provider = new YouTubeMvProvider({ fetchImpl });

    try {
      await provider.search(track, settings);

      expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('order=viewCount'), expect.anything());
    } finally {
      if (originalEchoKey === undefined) {
        delete process.env.ECHO_YOUTUBE_API_KEY;
      } else {
        process.env.ECHO_YOUTUBE_API_KEY = originalEchoKey;
      }
    }
  });

  it('does not scrape YouTube when no official API key is configured', async () => {
    const originalEchoKey = process.env.ECHO_YOUTUBE_API_KEY;
    const originalYouTubeKey = process.env.YOUTUBE_DATA_API_KEY;
    delete process.env.ECHO_YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_DATA_API_KEY;
    const fetchImpl = vi.fn() as typeof fetch;
    const provider = new YouTubeMvProvider({ fetchImpl });

    try {
      const candidates = await provider.search(track, settings);

      expect(candidates).toEqual([]);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (originalEchoKey === undefined) {
        delete process.env.ECHO_YOUTUBE_API_KEY;
      } else {
        process.env.ECHO_YOUTUBE_API_KEY = originalEchoKey;
      }
      if (originalYouTubeKey === undefined) {
        delete process.env.YOUTUBE_DATA_API_KEY;
      } else {
        process.env.YOUTUBE_DATA_API_KEY = originalYouTubeKey;
      }
    }
  });
});
