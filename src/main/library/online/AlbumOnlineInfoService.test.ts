import { describe, expect, it, vi } from 'vitest';
import type { EchoDatabase } from '../../database/createDatabase';
import type { LibraryAlbumDetail, LibraryTrack } from '../../../shared/types/library';
import { AlbumOnlineInfoService } from './AlbumOnlineInfoService';

const now = '2026-05-19T00:00:00.000Z';

const album = (): LibraryAlbumDetail => ({
  id: 'album-1',
  albumKey: 'album:key',
  title: 'Cache Album',
  albumArtist: 'Cache Artist',
  year: 2026,
  trackCount: 1,
  duration: 180,
  coverId: null,
  coverThumb: null,
  coverLarge: null,
});

const track = (): LibraryTrack => ({
  id: 'track-1',
  path: 'C:/Music/Cache Song.flac',
  title: 'Cache Song',
  artist: 'Cache Artist',
  album: 'Cache Album',
  albumArtist: 'Cache Artist',
  trackNo: 1,
  discNo: null,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'FLAC',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

const createWritableDatabase = (row: Record<string, unknown> | null = null): { database: EchoDatabase; run: ReturnType<typeof vi.fn> } => {
  const run = vi.fn();
  const database = {
    prepare: vi.fn((sql: string) => {
      if (sql.startsWith('SELECT *')) {
        return { get: vi.fn(() => row) };
      }
      if (sql.startsWith('PRAGMA')) {
        return { all: vi.fn(() => [{ name: 'cache_key' }, { name: 'information_json' }]) };
      }
      return { run };
    }),
  } as unknown as EchoDatabase;
  return { database, run };
};

describe('AlbumOnlineInfoService', () => {
  it('returns fresh cache without touching network providers', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const row = {
      status: 'ready',
      credits_json: JSON.stringify([{ role: 'Composer', people: [{ name: 'Cached Person', detail: null, trackTitle: null, source: 'release' }] }]),
      information_json: JSON.stringify({
        version: 6,
        album: null,
        artist: {
          title: 'Cached Artist',
          description: 'Artist profile',
          extract: 'Cached artist biography.',
          url: 'https://example.test/artist',
          language: 'en',
          thumbnailUrl: null,
        },
        externalRatings: [
          {
            provider: 'rateYourMusic',
            score: 3.82,
            maxScore: 5,
            ratingCount: 12431,
            rankText: '#24 in 2024',
            url: 'https://rateyourmusic.com/release/album/cache_artist/cache_album/',
            fetchedAt: now,
            expiresAt: '2999-01-01T00:00:00.000Z',
            confidence: 0.96,
          },
        ],
      }),
      match_json: JSON.stringify(null),
      sources_json: JSON.stringify([{ provider: 'musicbrainz', label: 'MusicBrainz' }]),
      provider_errors_json: JSON.stringify([]),
      fetched_at: now,
      expires_at: '2999-01-01T00:00:00.000Z',
    };
    const database = {
      prepare: vi.fn(() => ({
        get: vi.fn(() => row),
      })),
    } as unknown as EchoDatabase;

    const result = await new AlbumOnlineInfoService(database).getAlbumOnlineInfo({ album: album(), tracks: [track()] });

    expect(result.fromCache).toBe(true);
    expect(result.credits[0]?.people[0]?.name).toBe('Cached Person');
    expect(result.artistInformation?.title).toBe('Cached Artist');
    expect(result.externalRatings[0]).toMatchObject({
      provider: 'rateYourMusic',
      score: 3.82,
      maxScore: 5,
      ratingCount: 12431,
      rankText: '#24 in 2024',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps writing cache compatible with the legacy related_json column', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ releases: [], pages: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const run = vi.fn();
    const database = {
      prepare: vi.fn((sql: string) => {
        if (sql.startsWith('SELECT *')) {
          return { get: vi.fn(() => null) };
        }
        if (sql.startsWith('PRAGMA')) {
          return {
            all: vi.fn(() => [
              { name: 'cache_key' },
              { name: 'related_json' },
              { name: 'information_json' },
            ]),
          };
        }
        return { run };
      }),
    } as unknown as EchoDatabase;

    await new AlbumOnlineInfoService(database).getAlbumOnlineInfo({ album: album(), tracks: [track()] });

    const insertSql = String((database.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? '');
    expect(insertSql).toContain('related_json');
    expect(run.mock.calls[0]).toContain(JSON.stringify({}));
    expect(run.mock.calls[0]).toContain(JSON.stringify({ version: 6, album: null, artist: null, sourceLinks: [], externalRatings: [], releaseDetails: null, releaseVersions: [] }));
    vi.unstubAllGlobals();
  });

  it('refreshes fresh album info caches from before external rating support', async () => {
    const row = {
      status: 'ready',
      credits_json: JSON.stringify([]),
      information_json: JSON.stringify({
        version: 5,
        album: null,
        artist: null,
        sourceLinks: [],
        externalRatings: [],
        releaseDetails: null,
        releaseVersions: [],
      }),
      match_json: JSON.stringify(null),
      sources_json: JSON.stringify([]),
      provider_errors_json: JSON.stringify([]),
      fetched_at: now,
      expires_at: '2999-01-01T00:00:00.000Z',
    };
    const { database, run } = createWritableDatabase(row);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ releases: [], pages: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AlbumOnlineInfoService(database).getAlbumOnlineInfo({ album: album(), tracks: [track()] });

    expect(result.fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
    expect(run).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('adds MusicBrainz and Discogs ratings while classifying Rate Your Music release links', async () => {
    const run = vi.fn();
    const database = {
      prepare: vi.fn((sql: string) => {
        if (sql.startsWith('SELECT *')) {
          return { get: vi.fn(() => null) };
        }
        if (sql.startsWith('PRAGMA')) {
          return { all: vi.fn(() => [{ name: 'cache_key' }, { name: 'information_json' }]) };
        }
        return { run };
      }),
    } as unknown as EchoDatabase;
    const rymUrl = 'https://rateyourmusic.com/release/album/cache_artist/cache_album/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.hostname === 'musicbrainz.org' && url.pathname === '/ws/2/release/') {
        return {
          ok: true,
          json: async () => ({
            releases: [
              {
                id: 'mb-release-1',
                'release-group': { id: 'mb-release-group-1' },
                title: 'Cache Album',
                date: '2026-05-01',
                'artist-credit': [{ artist: { id: 'mb-artist-1', name: 'Cache Artist' } }],
                media: [{ format: 'Digital Media', 'track-count': 1 }],
              },
            ],
          }),
        };
      }
      if (url.hostname === 'musicbrainz.org' && url.pathname === '/ws/2/release/mb-release-1') {
        return {
          ok: true,
          json: async () => ({
            id: 'mb-release-1',
            'release-group': { id: 'mb-release-group-1' },
            title: 'Cache Album',
            date: '2026-05-01',
            status: 'Official',
            'artist-credit': [{ artist: { id: 'mb-artist-1', name: 'Cache Artist' } }],
            media: [{ format: 'Digital Media', 'track-count': 1 }],
            relations: [{ type: 'review', url: { resource: rymUrl } }],
          }),
        };
      }
      if (url.hostname === 'musicbrainz.org' && url.pathname === '/ws/2/release-group/mb-release-group-1') {
        return {
          ok: true,
          json: async () => ({
            id: 'mb-release-group-1',
            rating: { value: 4.55, 'votes-count': 85 },
          }),
        };
      }
      if (url.hostname === 'api.discogs.com' && url.pathname === '/database/search') {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                id: 12345,
                title: 'Cache Artist - Cache Album',
                year: 2026,
                uri: '/release/12345-Cache-Artist-Cache-Album',
              },
            ],
          }),
        };
      }
      if (url.hostname === 'api.discogs.com' && url.pathname === '/releases/12345') {
        return {
          ok: true,
          json: async () => ({
            id: 12345,
            uri: 'https://www.discogs.com/release/12345-Cache-Artist-Cache-Album',
            community: { rating: { average: 4.25, count: 12 } },
          }),
        };
      }
      if (url.pathname.includes('/w/rest.php/v1/search/page')) {
        return {
          ok: true,
          json: async () => ({ pages: [] }),
        };
      }
      throw new Error(`unexpected_url:${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AlbumOnlineInfoService(database).getAlbumOnlineInfo(
      { album: album(), tracks: [track()] },
      { locale: 'en-US', discogsUserToken: 'discogs-token' },
    );

    expect(result.sourceLinks).toEqual(
      expect.arrayContaining([
        { provider: 'rateYourMusic', label: 'Rate Your Music', url: rymUrl, kind: 'database' },
      ]),
    );
    expect(result.externalRatings).toEqual([
      expect.objectContaining({
        provider: 'musicbrainz',
        score: 4.55,
        maxScore: 5,
        ratingCount: 85,
        url: 'https://musicbrainz.org/release-group/mb-release-group-1',
      }),
      expect.objectContaining({
        provider: 'discogs',
        score: 4.25,
        maxScore: 5,
        ratingCount: 12,
        rankText: 'Data provided by Discogs',
        url: 'https://www.discogs.com/release/12345-Cache-Artist-Cache-Album',
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api.discogs.com/database/search'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Discogs token=discogs-token' }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('returns Discogs ratings when the matched MusicBrainz release group has no votes', async () => {
    const { database } = createWritableDatabase();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.hostname === 'musicbrainz.org' && url.pathname === '/ws/2/release/') {
        return {
          ok: true,
          json: async () => ({
            releases: [
              {
                id: 'mb-release-2',
                'release-group': { id: 'mb-release-group-empty' },
                title: 'SEKAI ALBUM vol.2',
                date: '2024-01-10',
                'artist-credit': [{ artist: { id: 'mb-artist-2', name: 'Nightcord at 25:00' } }],
                media: [{ format: 'CD', 'track-count': 15 }],
              },
            ],
          }),
        };
      }
      if (url.hostname === 'musicbrainz.org' && url.pathname === '/ws/2/release/mb-release-2') {
        return {
          ok: true,
          json: async () => ({
            id: 'mb-release-2',
            'release-group': { id: 'mb-release-group-empty' },
            title: 'SEKAI ALBUM vol.2',
            date: '2024-01-10',
            'artist-credit': [{ artist: { id: 'mb-artist-2', name: 'Nightcord at 25:00' } }],
            media: [{ format: 'CD', 'track-count': 15 }],
            relations: [],
          }),
        };
      }
      if (url.hostname === 'musicbrainz.org' && url.pathname === '/ws/2/release-group/mb-release-group-empty') {
        return {
          ok: true,
          json: async () => ({
            id: 'mb-release-group-empty',
            rating: { value: null, 'votes-count': 0 },
          }),
        };
      }
      if (url.hostname === 'api.discogs.com' && url.pathname === '/database/search') {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                id: 29451556,
                title: 'Nightcord At 25:00* - SEKAI ALBUM vol.2',
                year: 2024,
                uri: '/release/29451556-Nightcord-At-2500-SEKAI-Album-Vol2',
              },
            ],
          }),
        };
      }
      if (url.hostname === 'api.discogs.com' && url.pathname === '/releases/29451556') {
        return {
          ok: true,
          json: async () => ({
            id: 29451556,
            uri: 'https://www.discogs.com/release/29451556-Nightcord-At-2500-SEKAI-Album-Vol2',
            community: { rating: { average: 4.5, count: 4 } },
          }),
        };
      }
      if (url.pathname.includes('/w/rest.php/v1/search/page')) {
        return {
          ok: true,
          json: async () => ({ pages: [] }),
        };
      }
      throw new Error(`unexpected_url:${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AlbumOnlineInfoService(database).getAlbumOnlineInfo({
      album: { ...album(), title: 'SEKAI ALBUM vol.2', albumArtist: 'Nightcord at 25:00', year: 2024, trackCount: 15 },
      tracks: [{ ...track(), title: 'Track', album: 'SEKAI ALBUM vol.2', albumArtist: 'Nightcord at 25:00', artist: 'Nightcord at 25:00', year: 2024 }],
    }, { locale: 'en-US' });

    expect(result.externalRatings).toEqual([
      expect.objectContaining({
        provider: 'discogs',
        score: 4.5,
        maxScore: 5,
        ratingCount: 4,
        url: 'https://www.discogs.com/release/29451556-Nightcord-At-2500-SEKAI-Album-Vol2',
      }),
    ]);
    vi.unstubAllGlobals();
  });

  it('prefers longer Wikipedia page extracts over short summaries', async () => {
    const run = vi.fn();
    const database = {
      prepare: vi.fn((sql: string) => {
        if (sql.startsWith('SELECT *')) {
          return { get: vi.fn(() => null) };
        }
        if (sql.startsWith('PRAGMA')) {
          return { all: vi.fn(() => [{ name: 'cache_key' }, { name: 'information_json' }]) };
        }
        return { run };
      }),
    } as unknown as EchoDatabase;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.hostname === 'musicbrainz.org') {
        return {
          ok: true,
          json: async () => ({ releases: [] }),
        };
      }
      if (url.pathname.includes('/w/rest.php/v1/search/page')) {
        const query = url.searchParams.get('q') ?? '';
        return {
          ok: true,
          json: async () => ({
            pages: [
              {
                key: query.includes('Cache Album') ? 'Cache_Album' : 'Cache_Artist',
                title: query.includes('Cache Album') ? 'Cache Album' : 'Cache Artist',
              },
            ],
          }),
        };
      }
      if (url.pathname.includes('/api/rest_v1/page/summary/')) {
        const title = decodeURIComponent(url.pathname.split('/').pop() ?? '');
        return {
          ok: true,
          json: async () => ({
            title: title.replace(/_/gu, ' '),
            description: title.includes('Artist') ? 'Artist' : 'Album',
            extract: 'Short summary.',
            content_urls: { desktop: { page: `https://example.test/${title}` } },
            thumbnail: { source: null },
          }),
        };
      }
      if (url.pathname.includes('/w/api.php')) {
        const title = url.searchParams.get('titles') ?? '';
        if (url.searchParams.get('prop') === 'extlinks') {
          return {
            ok: true,
            json: async () => ({
              query: {
                pages: {
                  1: {
                    extlinks: [
                      { url: title.includes('Artist') ? 'https://artist.example.test/official' : 'https://album.example.test/official' },
                      { '*': 'mailto:ignored@example.test' },
                    ],
                  },
                },
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            query: {
              pages: {
                1: {
                  extract: title.includes('Artist')
                    ? 'Long artist biography paragraph one.\n\nLong artist biography paragraph two with career details.'
                    : 'Long album background paragraph with release context.',
                },
              },
            },
          }),
        };
      }
      throw new Error(`unexpected_url:${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AlbumOnlineInfoService(database).getAlbumOnlineInfo({ album: album(), tracks: [track()] }, { locale: 'en-US' });

    expect(result.information?.extract).toBe('Long album background paragraph with release context.');
    expect(result.information?.externalLinks).toEqual([{ label: 'album.example.test / official', url: 'https://album.example.test/official' }]);
    expect(result.artistInformation?.extract).toContain('career details');
    expect(result.artistInformation?.externalLinks).toEqual([{ label: 'artist.example.test / official', url: 'https://artist.example.test/official' }]);
    expect(result.artistInformation?.extract).toContain('\n\n');
    expect(result.artistInformation?.extract).not.toBe('Short summary.');
    vi.unstubAllGlobals();
  });

  it('fetches Wikipedia without waiting on MusicBrainz when scoped to Wikipedia', async () => {
    const { database } = createWritableDatabase();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.hostname === 'musicbrainz.org') {
        throw new Error('musicbrainz_should_not_be_called');
      }
      if (url.pathname.includes('/w/rest.php/v1/search/page')) {
        const query = url.searchParams.get('q') ?? '';
        return {
          ok: true,
          json: async () => ({
            pages: [
              {
                key: query.includes('Cache Album') ? 'Cache_Album' : 'Cache_Artist',
                title: query.includes('Cache Album') ? 'Cache Album' : 'Cache Artist',
              },
            ],
          }),
        };
      }
      if (url.pathname.includes('/api/rest_v1/page/summary/')) {
        const title = decodeURIComponent(url.pathname.split('/').pop() ?? '');
        return {
          ok: true,
          json: async () => ({
            title: title.replace(/_/gu, ' '),
            description: title.includes('Artist') ? 'Artist' : 'Album',
            extract: title.includes('Artist') ? 'Cache Artist profile.' : 'Cache Album overview.',
            content_urls: { desktop: { page: `https://example.test/${title}` } },
            thumbnail: { source: null },
          }),
        };
      }
      if (url.pathname.includes('/w/api.php')) {
        const title = url.searchParams.get('titles') ?? '';
        if (url.searchParams.get('prop') === 'extlinks') {
          return { ok: true, json: async () => ({ query: { pages: { 1: { extlinks: [] } } } }) };
        }
        return {
          ok: true,
          json: async () => ({
            query: {
              pages: {
                1: {
                  extract: title.includes('Artist') ? 'Cache Artist profile from Wikipedia.' : 'Cache Album overview from Wikipedia.',
                },
              },
            },
          }),
        };
      }
      throw new Error(`unexpected_url:${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AlbumOnlineInfoService(database).getAlbumOnlineInfo({ album: album(), tracks: [track()] }, { locale: 'en-US', provider: 'wikipedia' });

    expect(result.status).toBe('ready');
    expect(result.match).toBeNull();
    expect(result.sources).toEqual([{ provider: 'wikipedia', label: 'en.wikipedia.org' }]);
    expect(result.information?.title).toBe('Cache Album');
    expect(result.artistInformation?.title).toBe('Cache Artist');
    expect(fetchMock.mock.calls.some(([input]) => input.toString().includes('musicbrainz.org'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('rejects unrelated Wikipedia album pages even when the album title is a partial search hit', async () => {
    const { database } = createWritableDatabase();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.hostname === 'musicbrainz.org') {
        return {
          ok: true,
          json: async () => ({ releases: [] }),
        };
      }
      if (url.pathname.includes('/w/rest.php/v1/search/page')) {
        return {
          ok: true,
          json: async () => ({
            pages: [
              {
                key: '洞穴奇案',
                title: '洞穴奇案',
              },
            ],
          }),
        };
      }
      throw new Error(`unexpected_url:${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AlbumOnlineInfoService(database).getAlbumOnlineInfo({
      album: { ...album(), title: 'Explorers', albumArtist: 'Hinkik', year: 2015 },
      tracks: [{ ...track(), title: 'Explorers', album: 'Explorers', albumArtist: 'Hinkik', artist: 'Hinkik', year: 2015 }],
    });

    expect(result.information).toBeNull();
    expect(result.artistInformation).toBeNull();
    expect(result.sources.some((source) => source.provider === 'wikipedia')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/rest_v1/page/summary/'), expect.anything());
    vi.unstubAllGlobals();
  });

  it('ignores stale cached Wikipedia information that no longer matches the album or artist', async () => {
    const staleRow = {
      status: 'ready',
      credits_json: JSON.stringify([]),
      information_json: JSON.stringify({
        version: 2,
        album: {
          title: '洞穴奇案',
          description: 'Legal philosophy',
          extract: '洞穴奇案是著名法学家富勒提出的法理虚拟案例。',
          url: 'https://zh.wikipedia.org/wiki/洞穴奇案',
          language: 'zh',
          thumbnailUrl: null,
        },
        artist: null,
      }),
      match_json: JSON.stringify(null),
      sources_json: JSON.stringify([{ provider: 'wikipedia', label: 'zh.wikipedia.org' }]),
      provider_errors_json: JSON.stringify([]),
      fetched_at: now,
      expires_at: '2999-01-01T00:00:00.000Z',
    };
    const { database } = createWritableDatabase(staleRow);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.hostname === 'musicbrainz.org') {
        return {
          ok: true,
          json: async () => ({ releases: [] }),
        };
      }
      if (url.pathname.includes('/w/rest.php/v1/search/page')) {
        return {
          ok: true,
          json: async () => ({ pages: [] }),
        };
      }
      throw new Error(`unexpected_url:${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AlbumOnlineInfoService(database).getAlbumOnlineInfo({
      album: { ...album(), title: 'Explorers', albumArtist: 'Hinkik', year: 2015 },
      tracks: [{ ...track(), title: 'Explorers', album: 'Explorers', albumArtist: 'Hinkik', artist: 'Hinkik', year: 2015 }],
    });

    expect(result.fromCache).toBe(false);
    expect(result.information).toBeNull();
    expect(result.sources.some((source) => source.provider === 'wikipedia')).toBe(false);
    vi.unstubAllGlobals();
  });
});
