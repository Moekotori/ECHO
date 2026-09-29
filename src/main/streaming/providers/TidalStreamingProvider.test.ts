import { afterEach, describe, expect, it, vi } from 'vitest';
import { TidalStreamingProvider } from './TidalStreamingProvider';

const appSettingsMock = vi.hoisted(() => ({
  current: {
    tidalClientId: 'settings-client-id',
    tidalClientSecret: null as string | null,
    tidalCountryCode: null as string | null,
  },
}));

vi.mock('../../app/appSettings', () => ({
  getAppSettings: () => appSettingsMock.current,
}));

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const tokenResponse = (scope = 'search.read'): Response => jsonResponse({ access_token: 'tidal-token', expires_in: 3600, scope });

const relationshipResponse = (id: string, type: string): Response => jsonResponse({
  data: [{ id, type }],
});

const coverResource = {
  id: 'cover-1',
  type: 'artworks',
  attributes: {
    files: [
      { href: 'https://resources.tidal.com/images/cover-small.jpg', width: 160, height: 160 },
      { href: 'https://resources.tidal.com/images/cover-large.jpg', width: 1280, height: 1280 },
    ],
  },
};

const profileArtResource = {
  id: 'profile-1',
  type: 'artworks',
  attributes: {
    files: [
      { href: 'https://resources.tidal.com/images/artist.jpg', width: 750, height: 750 },
    ],
  },
};

const artistResource = {
  id: 'artist-1',
  type: 'artists',
  attributes: { name: 'Echo Unit' },
  relationships: {
    profileArt: { data: { id: 'profile-1', type: 'artworks' } },
  },
};

const albumResource = {
  id: 'album-1',
  type: 'albums',
  attributes: {
    title: 'Signal Bloom',
    releaseDate: '2026-05-25',
    numberOfItems: 2,
  },
  relationships: {
    artists: { data: [{ id: 'artist-1', type: 'artists' }] },
    coverArt: { data: { id: 'cover-1', type: 'artworks' } },
    items: {
      data: [
        { id: 'track-1', type: 'tracks' },
        { id: 'track-2', type: 'tracks' },
      ],
    },
  },
};

const trackResource = {
  id: 'track-1',
  type: 'tracks',
  attributes: {
    title: 'Blue Current',
    duration: 'PT3M12S',
    explicit: false,
  },
  relationships: {
    artists: { data: [{ id: 'artist-1', type: 'artists' }] },
    albums: { data: [{ id: 'album-1', type: 'albums' }] },
  },
};

const secondTrackResource = {
  id: 'track-2',
  type: 'tracks',
  attributes: {
    title: 'Night Switch',
    duration: 'PT4M',
  },
  relationships: {
    artists: { data: [{ id: 'artist-1', type: 'artists' }] },
    albums: { data: [{ id: 'album-1', type: 'albums' }] },
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  appSettingsMock.current = {
    tidalClientId: 'settings-client-id',
    tidalClientSecret: null,
    tidalCountryCode: null,
  };
});

describe('TidalStreamingProvider', () => {
  it('stays disabled until TIDAL API credentials are configured', () => {
    expect(new TidalStreamingProvider().descriptor).toMatchObject({
      enabled: false,
      supportsSearch: false,
      supportsPlayback: false,
      supportsDownload: false,
      status: 'needs_account',
    });
  });

  it('uses custom TIDAL developer credentials from settings', async () => {
    appSettingsMock.current = {
      tidalClientId: 'settings-client-id',
      tidalClientSecret: 'settings-client-secret',
      tidalCountryCode: 'HK',
    };
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(relationshipResponse('track-1', 'tracks'))
      .mockResolvedValueOnce(jsonResponse({
        data: [trackResource],
        included: [trackResource, albumResource, artistResource, coverResource],
      }));
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new TidalStreamingProvider().search({
      provider: 'tidal',
      query: 'Echo Unit',
      mediaTypes: ['track'],
      pageSize: 10,
    });

    const tokenRequest = fetchRunner.mock.calls[0][1] as RequestInit;
    expect(tokenRequest.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('settings-client-id:settings-client-secret', 'utf8').toString('base64')}`,
    });
    expect(String(tokenRequest.body)).toContain('scope=search.read');
    expect(String(fetchRunner.mock.calls[1][0])).toContain('/searchResults/Echo%20Unit/relationships/tracks');
    expect(String(fetchRunner.mock.calls[1][0])).toContain('countryCode=HK');
    expect(fetchRunner.mock.calls[1][1]?.headers).toMatchObject({
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    });
    expect(String(fetchRunner.mock.calls[2][0])).toContain('/tracks?filter[id]=track-1');
    expect(result.tracks[0]?.providerTrackId).toBe('track-1');
  });

  it('reports missing TIDAL search.read scope before catalog search', async () => {
    appSettingsMock.current = {
      tidalClientId: 'settings-client-id',
      tidalClientSecret: 'settings-client-secret',
      tidalCountryCode: 'US',
    };
    const fetchRunner = vi.fn().mockResolvedValueOnce(tokenResponse(''));
    vi.stubGlobal('fetch', fetchRunner);

    await expect(new TidalStreamingProvider().search({
      provider: 'tidal',
      query: 'mi',
      mediaTypes: ['track'],
    })).rejects.toThrow(/search\.read scope/iu);
    expect(fetchRunner).toHaveBeenCalledTimes(1);
  });

  it('maps TIDAL catalog search results as metadata-only streaming items', async () => {
    vi.stubEnv('ECHO_TIDAL_CLIENT_ID', 'client-id');
    vi.stubEnv('ECHO_TIDAL_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('ECHO_TIDAL_COUNTRY_CODE', 'JP');
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(relationshipResponse('track-1', 'tracks'))
      .mockResolvedValueOnce(jsonResponse({
        data: [trackResource],
        included: [albumResource, artistResource, coverResource],
      }))
      .mockResolvedValueOnce(relationshipResponse('album-1', 'albums'))
      .mockResolvedValueOnce(jsonResponse({
        data: [albumResource],
        included: [artistResource, coverResource],
      }))
      .mockResolvedValueOnce(relationshipResponse('artist-1', 'artists'))
      .mockResolvedValueOnce(jsonResponse({
        data: [artistResource],
        included: [profileArtResource],
      }));
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new TidalStreamingProvider().search({
      provider: 'tidal',
      query: 'Echo Unit',
      mediaTypes: ['track', 'album', 'artist'],
      pageSize: 10,
    });

    expect(result.tracks[0]).toMatchObject({
      provider: 'tidal',
      providerTrackId: 'track-1',
      title: 'Blue Current',
      artist: 'Echo Unit',
      album: 'Signal Bloom',
      duration: 192,
      playable: false,
      unavailableReason: expect.stringContaining('metadata only'),
    });
    expect(result.albums[0]).toMatchObject({
      providerAlbumId: 'album-1',
      title: 'Signal Bloom',
      artist: 'Echo Unit',
      coverUrl: 'https://resources.tidal.com/images/cover-large.jpg',
    });
    expect(result.artists[0]).toMatchObject({
      providerArtistId: 'artist-1',
      name: 'Echo Unit',
      avatarUrl: 'https://resources.tidal.com/images/artist.jpg',
    });
    expect(String(fetchRunner.mock.calls[1][0])).toContain('/searchResults/Echo%20Unit/relationships/tracks');
    expect(String(fetchRunner.mock.calls[1][0])).toContain('countryCode=JP');
    expect(String(fetchRunner.mock.calls[3][0])).toContain('/searchResults/Echo%20Unit/relationships/albums');
    expect(String(fetchRunner.mock.calls[5][0])).toContain('/searchResults/Echo%20Unit/relationships/artists');
  });

  it('loads TIDAL relationship search tracks with detail metadata', async () => {
    vi.stubEnv('ECHO_TIDAL_CLIENT_ID', 'client-id');
    vi.stubEnv('ECHO_TIDAL_CLIENT_SECRET', 'client-secret');
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(relationshipResponse('track-1', 'tracks'))
      .mockResolvedValueOnce(jsonResponse({
        data: [trackResource],
        included: [albumResource, artistResource, coverResource],
      }));
    vi.stubGlobal('fetch', fetchRunner);

    const result = await new TidalStreamingProvider().search({
      provider: 'tidal',
      query: 'sing',
      mediaTypes: ['track'],
      pageSize: 10,
    });

    expect(result.tracks[0]).toMatchObject({
      providerTrackId: 'track-1',
      title: 'Blue Current',
      artist: 'Echo Unit',
      album: 'Signal Bloom',
    });
    expect(String(fetchRunner.mock.calls[1][0])).toContain('/searchResults/sing/relationships/tracks');
    expect(String(fetchRunner.mock.calls[1][0])).toContain('explicitFilter=include');
    expect(String(fetchRunner.mock.calls[2][0])).toContain('/tracks?filter[id]=track-1');
  });

  it('loads album detail with unplayable track metadata', async () => {
    vi.stubEnv('ECHO_TIDAL_CLIENT_ID', 'client-id');
    vi.stubEnv('ECHO_TIDAL_CLIENT_SECRET', 'client-secret');
    const fetchRunner = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: albumResource,
        included: [trackResource, secondTrackResource, artistResource, coverResource],
      }));
    vi.stubGlobal('fetch', fetchRunner);

    const detail = await new TidalStreamingProvider().getAlbum({ providerAlbumId: 'album-1' });

    expect(detail.title).toBe('Signal Bloom');
    expect(detail.tracks).toHaveLength(2);
    expect(detail.tracks[0]).toMatchObject({
      title: 'Blue Current',
      playable: false,
      album: 'Signal Bloom',
    });
  });

  it('refuses direct playback for TIDAL tracks', async () => {
    await expect(new TidalStreamingProvider().resolvePlayback({
      provider: 'tidal',
      providerTrackId: 'track-1',
      quality: 'lossless',
    })).rejects.toThrow(/metadata-only/iu);
  });
});
