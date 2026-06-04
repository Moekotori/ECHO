// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArtistDetailView } from './ArtistDetailView';
import type { AppSettings } from '../../../shared/types/appSettings';
import type { ArtistInsights, LibraryAlbum, LibraryArtist, LibraryTrack } from '../../../shared/types/library';
import type { StreamingAlbum, StreamingTrack } from '../../../shared/types/streaming';
import { I18nProvider } from '../../i18n/I18nProvider';

const queueMock = {
  appendToQueue: vi.fn(),
  currentTrackId: null as string | null,
  playTrack: vi.fn().mockResolvedValue({}),
  playTrackNext: vi.fn(),
  replaceQueue: vi.fn(),
};

let mockTracks: LibraryTrack[] = [];
let mockTotal = 0;
let mockIsLoading = false;

vi.mock('../../stores/PlaybackQueueProvider', () => ({
  usePlaybackQueue: () => queueMock,
}));

vi.mock('../album/AlbumDetailView', () => ({
  AlbumDetailView: ({ album, onBack }: { album: LibraryAlbum; onBack: () => void }) => (
    <section>
      <h1>Album detail: {album.title}</h1>
      <button type="button" onClick={onBack}>
        Back to artist
      </button>
    </section>
  ),
}));

vi.mock('./ArtistAlbumGrid', () => ({
  ArtistAlbumGrid: ({ onAlbumSelect }: { onAlbumSelect: (album: LibraryAlbum) => void }) => (
    <section aria-label="mock albums">
      <button
        type="button"
        onClick={() =>
          onAlbumSelect({
            id: 'album-1',
            albumKey: 'echo/unit',
            title: 'Mock Album',
            albumArtist: 'Echo Unit',
            year: 2026,
            trackCount: 2,
            duration: 360,
            coverId: null,
            coverThumb: null,
          })
        }
      >
        Open mock album
      </button>
    </section>
  ),
}));

vi.mock('./ArtistTrackList', async () => {
  const React = await import('react');

  return {
    ArtistTrackList: ({ onLoadedTracksChange }: { onLoadedTracksChange?: (tracks: LibraryTrack[], total: number, isLoading: boolean) => void }) => {
      React.useEffect(() => {
        onLoadedTracksChange?.(mockTracks, mockTotal, mockIsLoading);
      }, [onLoadedTracksChange]);

      return mockTracks.length === 0 && !mockIsLoading ? <p>No songs are grouped under this artist yet.</p> : <section>Mock tracks</section>;
    },
  };
});

const artist = (overrides: Partial<LibraryArtist> = {}): LibraryArtist => ({
  id: 'artist-1',
  name: 'Echo Unit',
  sortName: 'echo unit',
  role: 'both',
  trackCount: 3,
  albumCount: 2,
  coverId: null,
  coverThumb: null,
  ...overrides,
});

const track = (id: string): LibraryTrack => ({
  id,
  path: `D:\\Music\\${id}.flac`,
  title: `Track ${id}`,
  artist: 'Echo Unit',
  album: 'Album',
  albumArtist: 'Echo Unit',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 96000,
  bitDepth: 24,
  bitrate: 1000,
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
});

const artistInsights = (overrides: Partial<ArtistInsights> = {}): ArtistInsights => ({
  artist: artist(),
  nodes: [{ ...artist(), source: 'local' }],
  edges: [],
  onlineInfo: {
    status: 'empty',
    bio: null,
    imageCredits: [],
    externalLinks: [],
    relatedArtists: [],
    sourceLabels: [],
    fetchedAt: null,
  },
  concerts: { status: 'not_configured', region: null, sources: [], events: [], fetchedAt: null },
  generatedAt: '2026-05-20T00:00:00.000Z',
  ...overrides,
});

const streamingAlbum = (index: number, provider: 'netease' | 'qqmusic' = 'netease'): StreamingAlbum => ({
  id: `streaming:${provider}:album:online-${index}`,
  provider,
  providerAlbumId: `online-${index}`,
  title: `Online Echo ${index}`,
  artist: 'Echo Unit',
  artists: [{ id: `${provider}-artist-online`, provider, providerArtistId: `${provider}-artist-online`, name: 'Echo Unit' }],
  coverUrl: `https://img.example/online-${index}.jpg`,
  coverThumb: `https://img.example/online-${index}-thumb.jpg`,
  releaseDate: '2026',
  trackCount: index,
});

const installLibrary = (
  getArtist = vi.fn().mockResolvedValue(artist()),
  appSettings?: Partial<AppSettings>,
  getArtistInsights = vi.fn().mockResolvedValue(artistInsights()),
  streaming?: Partial<NonNullable<NonNullable<Window['echo']>['streaming']>>,
): void => {
  window.echo = {
    app: appSettings
      ? {
          getSettings: vi.fn().mockResolvedValue(appSettings),
        }
      : undefined,
    library: {
      getArtist,
      getArtistInsights,
      getArtistTracks: vi.fn().mockImplementation(() => (mockIsLoading
        ? new Promise(() => undefined)
        : Promise.resolve({
            items: mockTracks,
            page: 1,
            pageSize: 50,
            total: mockTotal,
            hasMore: false,
          }))),
    },
    streaming,
  } as unknown as Window['echo'];
};

const renderDetail = (artistValue: LibraryArtist, onBack = vi.fn()) => {
  window.localStorage.setItem('echo-next.locale', 'en-US');
  return render(
    <I18nProvider>
      <ArtistDetailView artist={artistValue} onBack={onBack} />
    </I18nProvider>,
  );
};

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  queueMock.appendToQueue.mockReset();
  queueMock.playTrack.mockReset();
  queueMock.playTrack.mockResolvedValue({});
  queueMock.playTrackNext.mockReset();
  queueMock.replaceQueue.mockReset();
  mockTracks = [];
  mockTotal = 0;
  mockIsLoading = false;
});

describe('ArtistDetailView', () => {
  it('shows the loading state while artist tracks are being read', async () => {
    mockIsLoading = true;
    installLibrary();

    renderDetail(artist());

    await screen.findByText('Echo Unit');
    expect((screen.getByRole('button', { name: /Reading Artist/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the empty track state from the artist track section', async () => {
    installLibrary();

    renderDetail(artist({ trackCount: 0 }));

    expect(await screen.findByText('No songs are grouped under this artist yet.')).toBeTruthy();
  });

  it('renders a panoramic artist image in the detail hero when one is cached', async () => {
    installLibrary(vi.fn().mockResolvedValue(artist({
      avatarThumbUrl: 'echo-artist-image://thumb/echo-unit',
      avatarUrl: 'echo-artist-image://large/echo-unit',
      avatarStatus: 'matched',
    })));

    renderDetail(artist());

    await screen.findByText('Echo Unit');
    const hero = document.querySelector('.artist-hero') as HTMLElement | null;
    const image = document.querySelector('.artist-hero-backdrop') as HTMLImageElement | null;
    expect(hero?.dataset.hasBackdrop).toBe('true');
    expect(image?.getAttribute('src')).toBe('echo-artist-image://large/echo-unit');
    expect(image?.getAttribute('sizes')).toBeNull();
    expect(image?.getAttribute('srcset')).toBeNull();
    expect(screen.queryByText('EC')).toBeNull();
  });

  it('uses the original album cover for the panoramic fallback instead of the compressed thumb', async () => {
    installLibrary(vi.fn().mockResolvedValue(artist({
      coverId: 'cover 1',
      coverThumb: 'echo-cover://album/cover%201',
    })));

    renderDetail(artist());

    await screen.findByText('Echo Unit');
    const image = document.querySelector('.artist-hero-backdrop') as HTMLImageElement | null;
    expect(image?.getAttribute('src')).toBe('echo-cover://original/cover%201');
  });

  it('does not use the online biography thumbnail as the panoramic hero fallback', async () => {
    installLibrary(
      vi.fn().mockResolvedValue(artist({
        coverId: 'cover 1',
        coverThumb: 'echo-cover://album/cover%201',
      })),
      undefined,
      vi.fn().mockResolvedValue(artistInsights({
        onlineInfo: {
          status: 'ready',
          bio: {
            title: 'Echo Unit',
            description: null,
            extract: 'Echo Unit is a band.',
            url: 'https://example.test/wiki/Echo_Unit',
            language: 'en',
            thumbnailUrl: 'https://img.example/echo-unit-band.jpg',
          },
          imageCredits: [],
          externalLinks: [],
          relatedArtists: [],
          sourceLabels: ['Wikipedia'],
          fetchedAt: '2026-05-25T00:00:00.000Z',
        },
      })),
    );

    renderDetail(artist());

    await waitFor(() => expect(document.querySelector('.artist-hero-backdrop')?.getAttribute('src')).toBe('echo-cover://original/cover%201'));
  });

  it('renders legacy MediaWiki heading markers as headings instead of raw text', async () => {
    installLibrary(
      vi.fn().mockResolvedValue(artist()),
      undefined,
      vi.fn().mockResolvedValue(artistInsights({
        onlineInfo: {
          status: 'ready',
          bio: {
            title: 'Echo Unit',
            description: 'Japanese band',
            extract: 'Echo Unit is a band.\n\n== Career ==\nThe group built a richer biography.',
            url: 'https://example.wikipedia/Echo_Unit',
            language: 'en',
            thumbnailUrl: null,
          },
          imageCredits: [],
          externalLinks: [],
          relatedArtists: [],
          sourceLabels: ['en.wikipedia.org'],
          fetchedAt: '2026-05-20T00:00:00.000Z',
        },
      })),
    );

    renderDetail(artist());

    expect(await screen.findByText('The group built a richer biography.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Career' })).toBeTruthy();
    expect(screen.queryByText(/== Career ==/)).toBeNull();
  });

  it('falls back to the letter mark when the detail hero image fails', async () => {
    installLibrary(vi.fn().mockResolvedValue(artist({
      avatarUrl: 'echo-artist-image://large/echo-unit',
      avatarStatus: 'matched',
    })));

    renderDetail(artist());

    await screen.findByText('Echo Unit');
    const image = document.querySelector('.artist-hero-backdrop') as HTMLImageElement;
    fireEvent.error(image);

    expect(document.querySelector('.artist-hero-backdrop')).toBeNull();
    expect(screen.getByText('EC')).toBeTruthy();
  });

  it('updates the detail hero when the same artist receives an avatar', async () => {
    const getArtist = vi.fn().mockResolvedValue(artist());
    installLibrary(getArtist);
    const { rerender } = renderDetail(artist());

    await screen.findByText('Echo Unit');
    expect(screen.getByText('EC')).toBeTruthy();

    rerender(
      <I18nProvider>
        <ArtistDetailView artist={artist({ avatarUrl: 'echo-artist-image://large/echo-unit', avatarStatus: 'matched' })} onBack={vi.fn()} />
      </I18nProvider>,
    );

    await waitFor(() => expect(document.querySelector('.artist-hero-backdrop')?.getAttribute('src')).toBe('echo-artist-image://large/echo-unit'));
    expect(screen.queryByText('EC')).toBeNull();
  });

  it('plays the loaded artist queue from Play Artist', async () => {
    const first = track('1');
    const second = track('2');
    mockTracks = [first, second];
    mockTotal = 2;
    installLibrary();

    renderDetail(artist());

    await waitFor(() => expect((screen.getByRole('button', { name: /Play Artist/i }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Play Artist/i }));

    await waitFor(() => expect(queueMock.replaceQueue).toHaveBeenCalledTimes(1));
    expect(queueMock.replaceQueue).toHaveBeenCalledWith(mockTracks, {
      startTrackId: first.id,
      source: { type: 'artist', label: 'Echo Unit', artistId: 'artist-1' },
    });
    expect(queueMock.playTrack).toHaveBeenCalledWith(first, {
      source: { type: 'artist', label: 'Echo Unit', artistId: 'artist-1' },
    });
  });

  it('reveals more local overview tracks from the load more button', async () => {
    mockTracks = Array.from({ length: 8 }, (_, index) => track(String(index + 1)));
    mockTotal = 8;
    installLibrary();

    renderDetail(artist({ trackCount: 8 }));

    expect(await screen.findByText('Track 6')).toBeTruthy();
    expect(screen.queryByText('Track 7')).toBeNull();
    expect(screen.getByText('6 of 8 tracks')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Track 7')).toBeTruthy();
    expect(screen.getByText('8 of 8 tracks')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('reveals every loaded overview track from the expand all button', async () => {
    mockTracks = Array.from({ length: 14 }, (_, index) => track(String(index + 1)));
    mockTotal = 14;
    installLibrary();

    renderDetail(artist({ trackCount: 14 }));

    expect(await screen.findByText('Track 6')).toBeTruthy();
    expect(screen.queryByText('Track 14')).toBeNull();
    expect(screen.getByText('6 of 14 tracks')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));

    expect(await screen.findByText('Track 14')).toBeTruthy();
    expect(screen.getByText('14 of 14 tracks')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull();
  });

  it('returns from the artist detail after Escape plays the back animation', async () => {
    installLibrary();
    const onBack = vi.fn();

    renderDetail(artist(), onBack);

    await screen.findByText('Echo Unit');
    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onBack).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(180);
    });

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('restores the page surface scroll position after returning from an artist album', async () => {
    installLibrary();

    window.localStorage.setItem('echo-next.locale', 'en-US');
    const { container } = render(
      <I18nProvider>
        <main className="page-surface">
          <ArtistDetailView artist={artist()} onBack={vi.fn()} />
        </main>
      </I18nProvider>,
    );
    const pageSurface = container.querySelector('.page-surface') as HTMLElement;
    pageSurface.scrollTop = 480;

    fireEvent.click(await screen.findByRole('button', { name: 'Albums' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open mock album' }));
    expect(screen.getByText('Album detail: Mock Album')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to artist' }));

    expect(pageSurface.scrollTop).toBe(480);
    expect(screen.getByRole('button', { name: 'Open mock album' })).toBeTruthy();
  });

  it('loads streaming albums under local artist albums only when the general setting is enabled', async () => {
    const getAlbum = vi.fn().mockResolvedValue({
      id: 'streaming:netease:album:online-1',
      provider: 'netease',
      providerAlbumId: 'online-1',
      title: 'Online Echo',
      artist: 'Echo Unit',
      artists: [{ id: 'artist-online', provider: 'netease', providerArtistId: 'artist-online', name: 'Echo Unit' }],
      coverUrl: 'https://img.example/online.jpg',
      coverThumb: 'https://img.example/online-thumb.jpg',
      releaseDate: '2026',
      trackCount: 1,
      tracks: [
        {
          id: 'streaming:netease:track:track-1',
          provider: 'netease',
          providerTrackId: 'track-1',
          stableKey: 'streaming:netease:track:track-1',
          title: 'Online Track',
          artist: 'Echo Unit',
          artists: [{ id: 'artist-online', provider: 'netease', providerArtistId: 'artist-online', name: 'Echo Unit' }],
          album: 'Online Echo',
          albumId: 'online-1',
          albumArtist: 'Echo Unit',
          duration: 180,
          coverUrl: 'https://img.example/online-track.jpg',
          coverThumb: 'https://img.example/online-track-thumb.jpg',
          qualities: ['high'],
          explicit: false,
          playable: true,
          unavailableReason: null,
          lyricsStatus: 'unknown',
          mvStatus: 'unknown',
        },
      ],
    });
    const search = vi.fn().mockResolvedValue({
      provider: 'netease',
      query: 'Echo Unit',
      page: 1,
      pageSize: 20,
      total: 1,
      hasMore: false,
      tracks: [],
      albums: [
        {
          id: 'streaming:netease:album:online-1',
          provider: 'netease',
          providerAlbumId: 'online-1',
          title: 'Online Echo',
          artist: 'Echo Unit',
          artists: [{ id: 'artist-online', provider: 'netease', providerArtistId: 'artist-online', name: 'Echo Unit' }],
          coverUrl: 'https://img.example/online.jpg',
          coverThumb: 'https://img.example/online-thumb.jpg',
          releaseDate: '2026',
          trackCount: 10,
        },
        {
          id: 'streaming:netease:album:wrong-1',
          provider: 'netease',
          providerAlbumId: 'wrong-1',
          title: 'Afterglow Loop Jazz Hiphop',
          artist: 'Afterglow Loop',
          artists: [{ id: 'artist-wrong', provider: 'netease', providerArtistId: 'artist-wrong', name: 'Afterglow Loop' }],
          coverUrl: 'https://img.example/wrong.jpg',
          coverThumb: 'https://img.example/wrong-thumb.jpg',
          releaseDate: '2026',
          trackCount: 21,
        },
      ],
      artists: [],
      playlists: [],
      mvs: [],
    });
    installLibrary(vi.fn().mockResolvedValue(artist()), { artistStreamingAlbumsEnabled: true }, undefined, {
      getProviders: vi.fn().mockResolvedValue([
        {
          name: 'netease',
          displayName: 'NetEase',
          enabled: true,
          supportsSearch: true,
          supportsLyrics: true,
          supportsMv: true,
          requiresAccount: false,
          status: 'ready',
        },
      ]),
      search,
      getAlbum,
    });

    renderDetail(artist());
    fireEvent.click(await screen.findByRole('button', { name: 'Albums' }));

    expect(await screen.findByText('Online Echo')).toBeTruthy();
    expect(screen.queryByText('Afterglow Loop Jazz Hiphop')).toBeNull();
    expect((document.querySelector('.artist-streaming-album-card img') as HTMLImageElement | null)?.getAttribute('src')).toBe('https://img.example/online.jpg');
    fireEvent.click(screen.getByRole('button', { name: /Online Echo/ }));
    expect(await screen.findByText('Online Track')).toBeTruthy();
    expect(getAlbum).toHaveBeenCalledWith({ provider: 'netease', providerAlbumId: 'online-1' });
    expect(search).toHaveBeenCalledWith({
      provider: 'netease',
      query: 'Echo Unit',
      mediaTypes: ['album'],
      page: 1,
      pageSize: 20,
    });
  });

  it('shows 20 streaming albums first and reveals the rest from Load More', async () => {
    const pageOneAlbums = Array.from({ length: 20 }, (_, index) => streamingAlbum(index + 1, 'netease'));
    const pageTwoAlbums = Array.from({ length: 10 }, (_, index) => streamingAlbum(index + 21, 'netease'));
    const search = vi.fn().mockImplementation(({ page }: { page: number }) => Promise.resolve({
      provider: 'netease',
      query: 'Echo Unit',
      page,
      pageSize: 20,
      total: 30,
      hasMore: page === 1,
      tracks: [],
      albums: page === 1 ? pageOneAlbums : pageTwoAlbums,
      artists: [],
      playlists: [],
      mvs: [],
    }));

    installLibrary(vi.fn().mockResolvedValue(artist()), { artistStreamingAlbumsEnabled: true }, undefined, {
      getProviders: vi.fn().mockResolvedValue([
        {
          name: 'netease',
          displayName: 'NetEase',
          enabled: true,
          supportsSearch: true,
          supportsLyrics: true,
          supportsMv: true,
          requiresAccount: false,
          status: 'ready',
        },
        {
          name: 'qqmusic',
          displayName: 'QQ Music',
          enabled: true,
          supportsSearch: true,
          supportsLyrics: true,
          supportsMv: true,
          requiresAccount: false,
          status: 'ready',
        },
      ]),
      search,
    });

    renderDetail(artist());
    fireEvent.click(await screen.findByRole('button', { name: 'Albums' }));

    expect(await screen.findByText('Online Echo 20')).toBeTruthy();
    expect(screen.queryByText('Online Echo 21')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));

    expect(await screen.findByText('Online Echo 30')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
    expect(search).toHaveBeenCalledWith({
      provider: 'netease',
      query: 'Echo Unit',
      mediaTypes: ['album'],
      page: 2,
      pageSize: 20,
    });
  });

  it('uses the configured streaming album source for artist albums', async () => {
    const search = vi.fn().mockResolvedValue({
      provider: 'qqmusic',
      query: 'Echo Unit',
      page: 1,
      pageSize: 20,
      total: 1,
      hasMore: false,
      tracks: [],
      albums: [streamingAlbum(1, 'qqmusic')],
      artists: [],
      playlists: [],
      mvs: [],
    });

    installLibrary(vi.fn().mockResolvedValue(artist()), { artistStreamingAlbumsEnabled: true, artistStreamingAlbumsProvider: 'qqmusic' }, undefined, {
      getProviders: vi.fn().mockResolvedValue([
        {
          name: 'netease',
          displayName: 'NetEase',
          enabled: true,
          supportsSearch: true,
          supportsLyrics: true,
          supportsMv: true,
          requiresAccount: false,
          status: 'ready',
        },
        {
          name: 'qqmusic',
          displayName: 'QQ Music',
          enabled: true,
          supportsSearch: true,
          supportsLyrics: true,
          supportsMv: true,
          requiresAccount: false,
          status: 'ready',
        },
      ]),
      search,
    });

    renderDetail(artist());
    fireEvent.click(await screen.findByRole('button', { name: 'Albums' }));

    expect(await screen.findByText('Online Echo 1')).toBeTruthy();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({
      provider: 'qqmusic',
      query: 'Echo Unit',
      mediaTypes: ['album'],
      page: 1,
      pageSize: 20,
    });
  });

  it('returns from a streaming album detail back to the artist detail', async () => {
    const onBack = vi.fn();
    installLibrary(vi.fn().mockResolvedValue(artist()), { artistStreamingAlbumsEnabled: true }, undefined, {
      getProviders: vi.fn().mockResolvedValue([
        {
          name: 'netease',
          displayName: 'NetEase',
          enabled: true,
          supportsSearch: true,
          supportsLyrics: true,
          supportsMv: true,
          requiresAccount: false,
          status: 'ready',
        },
      ]),
      search: vi.fn().mockResolvedValue({
        provider: 'netease',
        query: 'Echo Unit',
        page: 1,
        pageSize: 20,
        total: 1,
        hasMore: false,
        tracks: [],
        albums: [streamingAlbum(1, 'netease')],
        artists: [],
        playlists: [],
        mvs: [],
      }),
      getAlbum: vi.fn().mockResolvedValue({ ...streamingAlbum(1, 'netease'), tracks: [] }),
    });

    renderDetail(artist(), onBack);
    fireEvent.click(await screen.findByRole('button', { name: 'Albums' }));
    fireEvent.click(await screen.findByRole('button', { name: /Online Echo 1/ }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '流媒体专辑' }));
    await act(async () => {
      vi.advanceTimersByTime(180);
    });

    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open mock album' })).toBeTruthy();
    expect(screen.getByText('Online Echo 1')).toBeTruthy();
  });

  it('shows a download album action inside artist streaming album details after downloads are unlocked', async () => {
    const album = streamingAlbum(1, 'netease');
    const albumTracks: StreamingTrack[] = [
      {
        id: 'streaming:netease:song:track-1',
        provider: 'netease',
        providerTrackId: 'track-1',
        stableKey: 'streaming:netease:track-1',
        title: 'Streaming Album Track 1',
        artist: 'Echo Unit',
        artists: album.artists,
        album: album.title,
        albumId: album.providerAlbumId,
        albumArtist: 'Echo Unit',
        duration: 180,
        coverUrl: album.coverUrl,
        coverThumb: album.coverThumb,
        qualities: ['standard', 'high', 'lossless'],
        explicit: false,
        playable: true,
        unavailableReason: null,
        lyricsStatus: 'unknown',
        mvStatus: 'unknown',
      },
    ];
    const resolvePlayback = vi.fn().mockResolvedValue({
      provider: 'netease',
      providerTrackId: 'track-1',
      url: 'https://cdn.example/track-1.flac',
      headers: { Referer: 'https://music.163.com/' },
      mimeType: 'audio/flac',
      codec: 'flac',
      quality: 'lossless',
      bitrate: null,
      expiresAt: null,
      downloadAuthorizationToken: 'download-token-track-1',
    });
    const createUrlJob = vi.fn().mockResolvedValue({
      id: 'download-job-1',
      sourceUrl: 'https://cdn.example/track-1.flac',
      provider: 'unknown',
      audioStrategy: 'best_available',
      status: 'queued',
      title: 'Streaming Album Track 1',
      durationSeconds: null,
      thumbnailUrl: null,
      webpageUrl: 'https://music.163.com/#/song?id=track-1',
      outputPath: null,
      downloadedBytes: null,
      totalBytes: null,
      speedBytesPerSecond: null,
      etaSeconds: null,
      importedTrackId: null,
      progress: 0,
      error: null,
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
      completedAt: null,
    });

    installLibrary(vi.fn().mockResolvedValue(artist()), { artistStreamingAlbumsEnabled: true, downloadsFeatureUnlocked: true }, undefined, {
      getProviders: vi.fn().mockResolvedValue([
        {
          name: 'netease',
          displayName: 'NetEase',
          enabled: true,
          supportsSearch: true,
          supportsLyrics: true,
          supportsMv: true,
          requiresAccount: false,
          status: 'ready',
        },
      ]),
      search: vi.fn().mockResolvedValue({
        provider: 'netease',
        query: 'Echo Unit',
        page: 1,
        pageSize: 20,
        total: 1,
        hasMore: false,
        tracks: [],
        albums: [album],
        artists: [],
        playlists: [],
        mvs: [],
      }),
      getAlbum: vi.fn().mockResolvedValue({ ...album, tracks: albumTracks }),
      resolvePlayback,
    });
    window.echo = {
      ...window.echo,
      downloads: {
        createUrlJob,
        onJobsUpdated: vi.fn(() => () => undefined),
      },
    } as unknown as Window['echo'];

    renderDetail(artist());
    fireEvent.click(await screen.findByRole('button', { name: 'Albums' }));
    fireEvent.click(await screen.findByRole('button', { name: /Online Echo 1/ }));
    expect(await screen.findByText('Streaming Album Track 1')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: '下载专辑' }));

    await waitFor(() => expect(createUrlJob).toHaveBeenCalledTimes(1));
    expect(resolvePlayback).toHaveBeenCalledWith({
      provider: 'netease',
      providerTrackId: 'track-1',
      quality: expect.any(String),
    });
    expect(createUrlJob).toHaveBeenCalledWith(
      'https://cdn.example/track-1.flac',
      expect.objectContaining({
        title: 'Streaming Album Track 1',
        album: album.title,
        outputSubdirectory: `${album.artist} - ${album.title}`,
        deferImportToLibrary: true,
        streamingProvider: 'netease',
        streamingProviderTrackId: 'track-1',
        downloadAuthorizationToken: 'download-token-track-1',
      }),
    );
  });

  it('shows configured concert provider status while online events are empty', async () => {
    installLibrary(vi.fn().mockResolvedValue(artist()), {
      onlineArtistInfoBandsintownAppId: 'echo-next',
      onlineArtistInfoRegion: 'HK',
    });

    renderDetail(artist());

    await screen.findByText('Bandsintown');
    expect(screen.getByText('No upcoming concerts matched HK.')).toBeTruthy();
  });

  it('uses the localized concert setup copy when no concert provider is configured', async () => {
    installLibrary(
      vi.fn().mockResolvedValue(artist()),
      {},
      vi.fn().mockResolvedValue(artistInsights({
        concerts: {
          status: 'not_configured',
          region: null,
          sources: [],
          events: [],
          fetchedAt: null,
          message: 'Configure Bandsintown app_id in Settings to load upcoming concerts.',
        },
      })),
    );

    renderDetail(artist());

    expect(await screen.findByText(/Concert info needs Bandsintown/)).toBeTruthy();
    expect(screen.queryByText(/app_id/)).toBeNull();
  });

  it('does not show a Bandsintown setup message after Ticketmaster is configured', async () => {
    installLibrary(
      vi.fn().mockResolvedValue(artist()),
      { onlineArtistInfoTicketmasterApiKey: 'ticketmaster-key' },
      vi.fn().mockResolvedValue(artistInsights({
        concerts: {
          status: 'not_configured',
          region: null,
          sources: [],
          events: [],
          fetchedAt: null,
          message: 'Configure Bandsintown app_id in Settings to load upcoming concerts.',
        },
      })),
    );

    renderDetail(artist());

    expect(await screen.findByText('Ticketmaster')).toBeTruthy();
    expect(screen.getByText('No upcoming concerts matched.')).toBeTruthy();
    expect(screen.queryByText(/Bandsintown app_id/)).toBeNull();
  });

  it('renders online artist bio links and concert cards after the background insights load', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const getArtistInsights = vi.fn()
      .mockResolvedValueOnce(artistInsights())
      .mockResolvedValue(artistInsights({
        onlineInfo: {
          status: 'ready',
          bio: {
            title: 'Echo Unit',
            description: 'Japanese band',
            extract: 'Echo Unit is a fictional test artist with a very polished artist profile.',
            extractHtml: '<p>Echo Unit is a <a href="/wiki/Fictional_artist">fictional test artist</a> with a very polished artist profile.</p><h2>Career</h2><p>The group built a richer biography.</p>',
            url: 'https://example.wikipedia/Echo_Unit',
            language: 'en',
            thumbnailUrl: 'https://img.example/echo.jpg',
          },
          imageCredits: ['Echo Unit image via en.wikipedia.org'],
          externalLinks: [{ label: 'Echo Unit', url: 'https://example.wikipedia/Echo_Unit', source: 'wikipedia' }],
          relatedArtists: [],
          sourceLabels: ['en.wikipedia.org', 'MusicBrainz'],
          fetchedAt: '2026-05-20T00:00:00.000Z',
        },
        concerts: {
          status: 'ready',
          region: 'HK',
          sources: ['bandsintown'],
          fetchedAt: '2026-05-20T00:00:00.000Z',
          events: [
            {
              id: 'bandsintown:evt-1',
              source: 'bandsintown',
              sourceLabel: 'Bandsintown',
              title: 'Echo Unit Live',
              startsAt: '2026-06-01T20:00:00',
              venueName: 'Echo Arena',
              city: 'Hong Kong',
              region: 'HK',
              country: 'Hong Kong',
              url: 'https://bandsintown.example/events/evt-1',
              ticketUrl: null,
              venueUrl: null,
              imageUrl: 'https://img.example/event.jpg',
            },
          ],
        },
      }));
    installLibrary(vi.fn().mockResolvedValue(artist()), { onlineArtistInfoBandsintownAppId: 'echo-next', onlineArtistInfoRegion: 'HK' }, getArtistInsights);
    window.echo = {
      ...window.echo,
      app: {
        ...window.echo?.app,
        openExternalUrl,
      },
    } as Window['echo'];

    renderDetail(artist());

    expect(await screen.findByText(/fictional test artist/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Career' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'fictional test artist' }));
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith('https://example.wikipedia/wiki/Fictional_artist'));
    expect(screen.getByText('en.wikipedia.org')).toBeTruthy();
    expect(screen.getByText('MusicBrainz')).toBeTruthy();
    expect(screen.queryByText('1 concerts found. Expand to view dates, venues, and ticket links.')).toBeNull();
    expect(screen.getByRole('button', { name: /Collapse/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Echo Unit Live/)).toBeTruthy();
    expect(screen.getByText('Hong Kong')).toBeTruthy();
    expect(screen.getByText('20:00')).toBeTruthy();
    expect(document.querySelector('.artist-event-cover')).toBeNull();
    fireEvent.click(document.querySelector('.artist-event-row') as HTMLAnchorElement);
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith('https://bandsintown.example/events/evt-1'));
    await waitFor(() =>
      expect(getArtistInsights).toHaveBeenCalledWith('artist-1', {
        limit: 12,
        includeOnline: true,
        forceOnline: false,
        region: 'HK',
      }),
    );
  });
});
