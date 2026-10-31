import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../database/createDatabase';
import { ArtistOnlineInfoService } from './ArtistOnlineInfoService';
import type { LibraryArtist } from '../../../shared/types/library';

const artist = (overrides: Partial<LibraryArtist> = {}): LibraryArtist => ({
  id: 'artist-1',
  name: 'Echo Unit',
  sortName: 'echo unit',
  role: 'both',
  trackCount: 3,
  albumCount: 1,
  coverId: null,
  coverThumb: null,
  ...overrides,
});

describe('ArtistOnlineInfoService', () => {
  it('maps Wikimedia and MusicBrainz data into cached artist online info', async () => {
    const database = createDatabase(':memory:');
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/w/rest.php/v1/search/page')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ pages: [{ key: 'Echo_Unit', title: 'Echo Unit' }] }),
        };
      }
      if (url.includes('/api/rest_v1/page/summary/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            title: 'Echo Unit',
            description: 'Japanese band',
            extract: 'Echo Unit is a fictional test artist.',
            thumbnail: { source: 'https://img.example/echo.jpg' },
            content_urls: { desktop: { page: 'https://example.wikipedia/Echo_Unit' } },
          }),
        };
      }
      if (url.includes('/w/api.php') && url.includes('action=parse')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            parse: {
              text: {
                '*': '<div class="mw-parser-output"><style>.hidden{}</style><table class="infobox"><tbody><tr><td>Ignore this table</td></tr></tbody></table><p><a href="/wiki/Echo_Unit">Echo Unit</a> is a fictional test artist.</p><h2>Career</h2><p>The group formed as a test fixture and built a richer biography for the artist detail page.</p></div>',
              },
            },
          }),
        };
      }
      if (url.includes('/w/api.php')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: {
              pages: {
                1: {
                  extract: '<p>Echo Unit is a fictional test artist.</p><h2>Career</h2><p>The group formed as a test fixture and built a richer biography for the artist detail page.</p>',
                },
              },
            },
          }),
        };
      }
      if (url.includes('/ws/2/artist/?query=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ artists: [{ id: 'mbid-1', name: 'Echo Unit', score: 100 }] }),
        };
      }
      if (url.includes('/ws/2/artist/mbid-1')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            relations: [
              { type: 'official homepage', url: { resource: 'https://echo.example' } },
              { type: 'member of band', artist: { id: 'mbid-2', name: 'Echo Sister' } },
            ],
          }),
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = new ArtistOnlineInfoService(database, fetcher);

    const result = await service.getArtistOnlineInfo(artist(), {
      locale: 'en-US',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });
    const cached = await service.getArtistOnlineInfo(artist(), {
      locale: 'en-US',
      now: new Date('2026-05-20T00:05:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.bio?.title).toBe('Echo Unit');
    expect(result.bio?.extract).toContain('fictional test artist');
    expect(result.bio?.extract).not.toContain('<p>');
    expect(result.bio?.extractHtml).toContain('/wiki/Echo_Unit');
    expect(result.bio?.extractHtml).toContain('mw-parser-output');
    expect(result.sourceLabels).toEqual(['en.wikipedia.org', 'MusicBrainz']);
    expect(result.externalLinks.map((link) => link.url)).toEqual([
      'https://example.wikipedia/Echo_Unit',
      'https://musicbrainz.org/artist/mbid-1',
      'https://echo.example',
    ]);
    expect(result.relatedArtists?.[0]?.name).toBe('Echo Sister');
    expect(cached.fromCache).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(5);
    database.close();
  });

  it('uses Baidu Baike as a selectable artist bio source without touching Wikipedia', async () => {
    const database = createDatabase(':memory:');
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('baike.baidu.com/api/openapi/BaikeLemmaCardApi')) {
        return {
          ok: true,
          status: 200,
          url: 'http://baike.baidu.com/api/openapi/BaikeLemmaCardApi',
          json: async () => ({
            lemmaTitle: 'Echo Unit',
            abstract: 'Echo Unit 是来自测试世界的音乐组合，常用于艺人资料测试。',
            image: 'http://img.example/baidu.jpg',
            url: 'http://baike.baidu.com/item/Echo%20Unit',
          }),
        };
      }
      if (url.includes('/ws/2/artist/?query=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ artists: [] }),
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = new ArtistOnlineInfoService(database, fetcher);

    const result = await service.getArtistOnlineInfo(artist(), {
      locale: 'zh-CN',
      sources: ['baidu-baike'],
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.bio?.title).toBe('Echo Unit');
    expect(result.bio?.extract).toContain('音乐组合');
    expect(result.sourceLabels).toEqual(['百度百科']);
    expect(result.externalLinks).toEqual([
      { label: 'Echo Unit', url: 'http://baike.baidu.com/item/Echo%20Unit', source: 'baidu-baike' },
    ]);
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/^https:\/\/baike\.baidu\.com\//u);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('wikipedia.org'))).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('musicbrainz.org'))).toBe(false);
    database.close();
  });

  it('falls back to the Baidu Baike item page when the card API has no abstract', async () => {
    const database = createDatabase(':memory:');
    const fetcher = vi.fn(async (url: string, _options?: RequestInit) => {
      if (url.includes('baike.baidu.com/api/openapi/BaikeLemmaCardApi')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ errno: 2 }),
        };
      }
      if (url.includes('baike.baidu.com/item/')) {
        return {
          ok: true,
          status: 200,
          url: 'https://baike.baidu.com/item/%E5%91%A8%E6%9D%B0%E4%BC%A6/129156',
          text: async () => `
            <html>
              <head>
                <title>周杰伦（华语流行乐男歌手、音乐人、演员、导演）_百度百科</title>
                <meta name="description" content="周杰伦（Jay Chou），华语流行乐男歌手、音乐人、演员、导演。">
                <meta property="og:image" content="https://img.example/jay.jpg">
              </head>
              <body></body>
            </html>
          `,
          json: async () => ({}),
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = new ArtistOnlineInfoService(database, fetcher);

    const result = await service.getArtistOnlineInfo(artist({ name: '周杰伦', sortName: 'zhou jie lun' }), {
      locale: 'zh-CN',
      sources: ['baidu-baike'],
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.bio?.title).toBe('周杰伦（华语流行乐男歌手、音乐人、演员、导演）');
    expect(result.bio?.extract).toContain('华语流行乐男歌手');
    expect(result.bio?.url).toBe('https://baike.baidu.com/item/%E5%91%A8%E6%9D%B0%E4%BC%A6/129156');
    expect(result.sourceLabels).toEqual(['百度百科']);
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/^https:\/\/baike\.baidu\.com\//u);
    expect(String(fetcher.mock.calls[1]?.[0])).toMatch(/^https:\/\/baike\.baidu\.com\/item\//u);
    expect(fetcher.mock.calls[1]?.[1]?.redirect).toBeUndefined();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('wikipedia.org'))).toBe(false);
    database.close();
  });

  it('fails fast when Baidu Baike is unreachable instead of retrying slow modifier queries', async () => {
    const database = createDatabase(':memory:');
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('baike.baidu.com/api/openapi/BaikeLemmaCardApi')) {
        throw new Error('request_failed:-100');
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = new ArtistOnlineInfoService(database, fetcher);

    const result = await service.getArtistOnlineInfo(artist(), {
      locale: 'zh-CN',
      sources: ['baidu-baike'],
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('unavailable');
    expect(result.errors?.join('\n')).toContain('百度百科');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/^https:\/\/baike\.baidu\.com\//u);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('musicbrainz.org'))).toBe(false);
    database.close();
  });

  it('uses Moegirl as a selectable artist bio source without touching Wikipedia', async () => {
    const database = createDatabase(':memory:');
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('zh.moegirl.org.cn/api.php') && url.includes('list=search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: {
              search: [{ title: 'Echo Unit' }],
            },
          }),
        };
      }
      if (url.includes('zh.moegirl.org.cn/api.php') && url.includes('prop=extracts%7Cpageimages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: {
              pages: {
                1: {
                  title: 'Echo Unit',
                  extract: 'Echo Unit 是萌娘百科中的测试音乐组合条目。',
                  thumbnail: { source: 'https://img.example/moegirl.jpg' },
                },
              },
            },
          }),
        };
      }
      if (url.includes('/ws/2/artist/?query=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ artists: [] }),
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = new ArtistOnlineInfoService(database, fetcher);

    const result = await service.getArtistOnlineInfo(artist(), {
      locale: 'zh-CN',
      sources: ['moegirl'],
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.bio?.description).toBe('萌娘百科');
    expect(result.bio?.extract).toContain('测试音乐组合');
    expect(result.sourceLabels).toEqual(['萌娘百科']);
    expect(result.externalLinks).toEqual([
      { label: 'Echo Unit', url: 'https://zh.moegirl.org.cn/Echo_Unit', source: 'moegirl' },
    ]);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('wikipedia.org'))).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('musicbrainz.org'))).toBe(false);
    database.close();
  });

  it('falls back to Japanese Wikipedia when the current locale has no artist page', async () => {
    const database = createDatabase(':memory:');
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('zh.wikipedia.org/w/rest.php/v1/search/page')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ pages: [] }),
        };
      }
      if (url.includes('ja.wikipedia.org/w/rest.php/v1/search/page')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ pages: [{ key: 'Aiobahn', title: 'Aiobahn' }] }),
        };
      }
      if (url.includes('ja.wikipedia.org/api/rest_v1/page/summary/Aiobahn')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            title: 'Aiobahn',
            description: '韓国の音楽家',
            extract: 'Aiobahn は韓国の電子音楽家、DJ、音楽プロデューサー。',
            content_urls: { desktop: { page: 'https://ja.wikipedia.org/wiki/Aiobahn' } },
          }),
        };
      }
      if (url.includes('ja.wikipedia.org/w/api.php')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: {
              pages: {
                1: {
                  extract: 'Aiobahn は韓国の電子音楽家、DJ、音楽プロデューサー。',
                },
              },
            },
          }),
        };
      }
      if (url.includes('/ws/2/artist/?query=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ artists: [] }),
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = new ArtistOnlineInfoService(database, fetcher);

    const result = await service.getArtistOnlineInfo(artist({ name: 'Aiobahn' }), {
      locale: 'zh-CN',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.bio?.language).toBe('ja');
    expect(result.bio?.extract).toContain('電子音楽家');
    expect(result.sourceLabels).toEqual(['ja.wikipedia.org']);
    expect(result.externalLinks.map((link) => link.url)).toEqual(['https://ja.wikipedia.org/wiki/Aiobahn']);
    database.close();
  });

  it('tries exact artist names across Wikipedia languages before modifier searches', async () => {
    const database = createDatabase(':memory:');
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('zh.wikipedia.org/w/rest.php/v1/search/page')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ pages: [] }),
        };
      }
      if (url.includes('ja.wikipedia.org/w/rest.php/v1/search/page')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ pages: [] }),
        };
      }
      if (url.includes('en.wikipedia.org/w/rest.php/v1/search/page')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ pages: [{ key: 'Charlie_Puth', title: 'Charlie Puth' }] }),
        };
      }
      if (url.includes('en.wikipedia.org/api/rest_v1/page/summary/Charlie_Puth')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            title: 'Charlie Puth',
            description: 'American singer',
            extract: 'Charlie Puth is an American singer.',
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Charlie_Puth' } },
          }),
        };
      }
      if (url.includes('en.wikipedia.org/w/api.php')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: {
              pages: {
                1: {
                  extract: 'Charlie Puth is an American singer, songwriter, and record producer.',
                },
              },
            },
          }),
        };
      }
      if (url.includes('/ws/2/artist/?query=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ artists: [] }),
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = new ArtistOnlineInfoService(database, fetcher);

    const result = await service.getArtistOnlineInfo(artist({ name: 'Charlie Puth' }), {
      locale: 'zh-CN',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    const wikipediaSearchUrls = fetcher.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/w/rest.php/v1/search/page'));

    expect(result.bio?.language).toBe('en');
    expect(wikipediaSearchUrls).toHaveLength(3);
    expect(wikipediaSearchUrls.some((url) =>
      url.includes('singer') || url.includes('musician') || url.includes('band'),
    )).toBe(false);
    database.close();
  });

  it('degrades to unavailable and short-caches provider failures', async () => {
    const database = createDatabase(':memory:');
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    const service = new ArtistOnlineInfoService(database, fetcher);

    const result = await service.getArtistOnlineInfo(artist(), {
      locale: 'en-US',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('unavailable');
    expect(result.bio).toBeNull();
    expect(result.errors?.join('\n')).toContain('MusicBrainz');
    expect(result.errors?.join('\n')).toContain('Wikipedia');
    database.close();
  });
});
