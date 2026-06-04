import { afterEach, describe, expect, it, vi } from 'vitest';
import { BilibiliStreamingProvider } from './BilibiliStreamingProvider';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../../accounts/AccountService', () => ({
  getAccountService: () => ({
    getStatus: (provider: string) => ({
      provider,
      connected: true,
      username: 'bilibili-user',
      displayName: 'Bilibili User',
      avatarUrl: null,
      lastLoginAt: '2026-01-01T00:00:00.000Z',
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    }),
    getCredentials: (provider: string) => ({
      provider,
      cookie: 'SESSDATA=secret; bili_jct=csrf',
    }),
  }),
}));

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const remoteImageUrl = (url: string): string =>
  `echo-image://remote/${encodeURIComponent(url)}?referer=${encodeURIComponent('https://www.bilibili.com/')}`;

afterEach(() => {
  execFileMock.mockReset();
  vi.unstubAllGlobals();
});

describe('BilibiliStreamingProvider', () => {
  it('advertises Bilibili as playback-only with MV support', () => {
    expect(new BilibiliStreamingProvider().descriptor).toMatchObject({
      supportsPlayback: true,
      supportsDownload: false,
      supportsMv: true,
      requiresAccount: false,
    });
  });

  it('searches Bilibili videos and maps them to playable streaming tracks', async () => {
    const fetchRunner = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: {
          numResults: 1,
          result: [
            {
              bvid: 'BV1ECHO',
              title: '<em class="keyword">ECHO</em> Live',
              author: '测试 UP',
              duration: '04:05',
              pic: '//i0.hdslb.com/bfs/archive/cover.jpg',
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new BilibiliStreamingProvider().search({
      provider: 'bilibili',
      query: 'echo',
      mediaTypes: ['track'],
      page: 1,
      pageSize: 10,
    });

    expect(String(fetchRunner.mock.calls[0][0])).toContain('search_type=video');
    expect(result.tracks[0]).toMatchObject({
      provider: 'bilibili',
      providerTrackId: 'BV1ECHO',
      stableKey: 'streaming:bilibili:BV1ECHO',
      title: 'ECHO Live',
      artist: '测试 UP',
      album: 'Bilibili',
      duration: 245,
      playable: true,
      mvStatus: 'available',
      coverThumb: remoteImageUrl('https://i0.hdslb.com/bfs/archive/cover.jpg'),
    });
    expect(result.albums).toEqual([]);
    expect(result.mvs).toEqual([]);
  });

  it('imports Bilibili favorite list pages from fid links', async () => {
    const fetchRunner = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: {
          info: {
            title: 'Bili Favorites',
            media_count: 1,
            upper: { name: 'Moe' },
          },
          has_more: false,
          medias: [
            {
              bvid: 'BV1FAV',
              title: 'Favorite Video',
              cover: '//i0.hdslb.com/bfs/archive/fav.jpg',
              duration: 98,
              upper: { name: 'Favorite UP' },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new BilibiliStreamingProvider().getPlaylist({
      providerPlaylistId: 'https://space.bilibili.com/25265128/favlist?fid=2433003328&ftype=create',
      page: 1,
      pageSize: 20,
    });

    expect(String(fetchRunner.mock.calls[0][0])).toContain('media_id=2433003328');
    expect(result).toMatchObject({
      provider: 'bilibili',
      providerPlaylistId: '2433003328',
      title: 'Bili Favorites',
      creator: 'Moe',
      total: 1,
      hasMore: false,
    });
    expect(result.tracks[0]).toMatchObject({
      providerTrackId: 'BV1FAV',
      title: 'Favorite Video',
      artist: 'Favorite UP',
      coverThumb: remoteImageUrl('https://i0.hdslb.com/bfs/archive/fav.jpg'),
    });
  });

  it('retries public Bilibili favorite imports without cookies when the API rejects the signed request', async () => {
    const fetchRunner = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: -400, message: '请求错误' }))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            info: {
              title: 'coop哥',
              media_count: 1,
              upper: { name: 'Moekotori' },
            },
            has_more: false,
            medias: [
              {
                bvid: 'BV16J411w7xW',
                title: 'Favorite Video',
                cover: '//i0.hdslb.com/bfs/archive/fav.jpg',
                duration: 98,
                upper: { name: 'Favorite UP' },
              },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new BilibiliStreamingProvider().getPlaylist({
      providerPlaylistId: 'https://space.bilibili.com/25265128/favlist?fid=2433003328&ftype=create',
      page: 1,
      pageSize: 100,
    });

    expect(String(fetchRunner.mock.calls[0][0])).toContain('ps=20');
    expect(fetchRunner).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchRunner.mock.calls[0][1]?.headers).get('cookie')).toBe('SESSDATA=secret; bili_jct=csrf');
    expect(new Headers(fetchRunner.mock.calls[1][1]?.headers).get('cookie')).toBeNull();
    expect(result).toMatchObject({
      providerPlaylistId: '2433003328',
      title: 'coop哥',
      total: 1,
    });
  });

  it('falls back to yt-dlp bilisearch when the Bilibili API returns 412', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('blocked', { status: 412 })));
    let capturedArgs: string[] = [];
    execFileMock.mockImplementation((_file: string, args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      capturedArgs = args;
      callback(
        null,
        JSON.stringify({
          entries: [
            {
              id: 'BV1FALLBACK',
              title: 'Fallback Song',
              uploader: 'Fallback UP',
              duration: 188,
              thumbnail: 'https://i0.hdslb.com/bfs/archive/fallback.jpg',
              webpage_url: 'https://www.bilibili.com/video/BV1FALLBACK',
            },
          ],
        }),
        '',
      );
    });

    const result = await new BilibiliStreamingProvider().search({
      provider: 'bilibili',
      query: 'echo',
      mediaTypes: ['track'],
      page: 1,
      pageSize: 10,
    });

    expect(capturedArgs).toContain('bilisearch10:echo');
    expect(result.tracks[0]).toMatchObject({
      providerTrackId: 'BV1FALLBACK',
      title: 'Fallback Song',
      artist: 'Fallback UP',
      duration: 188,
      coverThumb: remoteImageUrl('https://i0.hdslb.com/bfs/archive/fallback.jpg'),
    });
  });

  it('tries normalized query variants when the exact Bilibili query has no videos', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { numResults: 0, result: [] } }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          numResults: 1,
          result: [
            {
              bvid: 'BV1VARIANT',
              title: 'Echo Lab',
              author: 'Variant UP',
              duration: '02:30',
              pic: '//i0.hdslb.com/bfs/archive/variant.jpg',
            },
          ],
        },
      }));
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new BilibiliStreamingProvider().search({
      provider: 'bilibili',
      query: 'Echo - Lab',
      mediaTypes: ['track'],
      page: 1,
      pageSize: 10,
    });

    expect(String(fetchRunner.mock.calls[0][0])).toContain('keyword=Echo+-+Lab');
    expect(String(fetchRunner.mock.calls[2][0])).toContain('keyword=Echo+Lab');
    expect(result.query).toBe('Echo - Lab');
    expect(result.tracks[0]).toMatchObject({
      providerTrackId: 'BV1VARIANT',
      title: 'Echo Lab',
      artist: 'Variant UP',
    });
  });

  it('falls back to the Bilibili search page when the JSON API is blocked', async () => {
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(new Response('blocked', { status: 412 }))
      .mockResolvedValueOnce(
        new Response(
          `<script>window.__pinia={
            searchResponse: {
              searchAllResponse: {
                pageinfo: { video: { total: 1 } },
                result: [{
                  result_type: 'video',
                  data: [{
                    bvid: 'BV1WEBPAGE',
                    title: '<em class="keyword">Web</em> Song',
                    author: 'Web UP',
                    duration: '03:21',
                    pic: '//i0.hdslb.com/bfs/archive/web.jpg'
                  }]
                }]
              }
            }
          }</script>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        ),
      );
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new BilibiliStreamingProvider().search({
      provider: 'bilibili',
      query: 'web',
      mediaTypes: ['track'],
      page: 1,
      pageSize: 10,
    });

    expect(result.tracks[0]).toMatchObject({
      providerTrackId: 'BV1WEBPAGE',
      title: 'Web Song',
      artist: 'Web UP',
      duration: 201,
      coverThumb: remoteImageUrl('https://i0.hdslb.com/bfs/archive/web.jpg'),
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('resolves playback from Bilibili with the best audio-only format', async () => {
    let capturedArgs: string[] = [];
    execFileMock.mockImplementation((_file: string, args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      capturedArgs = args;
      callback(
        null,
        JSON.stringify({
          formats: [
            {
              format_id: 'video-1080p',
              vcodec: 'avc1',
              acodec: 'none',
              url: 'https://upos-sz-mirrorcos.bilivideo.com/video.m4s',
            },
            {
              format_id: 'audio-64k',
              vcodec: 'none',
              acodec: 'mp4a.40.2',
              ext: 'm4a',
              abr: 64,
              url: 'https://upos-sz-mirrorcos.bilivideo.com/audio-64.m4s?deadline=1779039623',
            },
            {
              format_id: 'audio-192k',
              vcodec: 'none',
              acodec: 'mp4a.40.2',
              ext: 'm4a',
              abr: 192,
              asr: 48000,
              url: 'https://upos-sz-mirrorcos.bilivideo.com/audio-192.m4s?deadline=1779039623',
              http_headers: {
                Referer: 'https://www.bilibili.com/video/BV1ECHO',
                Cookie: 'should-not-leak',
              },
            },
          ],
        }),
        '',
      );
    });

    const source = await new BilibiliStreamingProvider().resolvePlayback({
      provider: 'bilibili',
      providerTrackId: 'BV1ECHO',
      quality: 'high',
    });

    expect(capturedArgs).toContain('-f');
    expect(capturedArgs).toContain('--cookies');
    expect(capturedArgs).not.toContain('--add-header');
    expect(capturedArgs).toContain('ba/bestaudio');
    expect(capturedArgs).toContain('https://www.bilibili.com/video/BV1ECHO');
    expect(source.url).toContain('audio-192.m4s');
    expect(source.mimeType).toBe('audio/mp4');
    expect(source.codec).toBe('mp4a.40.2');
    expect(source.bitrate).toBe(192000);
    expect(source.sampleRate).toBe(48000);
    expect(source.supportsRange).toBe(true);
    expect(source.headers).toMatchObject({
      'User-Agent': expect.stringContaining('Mozilla/5.0'),
      Accept: '*/*',
      Referer: 'https://www.bilibili.com/video/BV1ECHO',
    });
    expect(source.headers.Cookie).toBeUndefined();
  });
});
