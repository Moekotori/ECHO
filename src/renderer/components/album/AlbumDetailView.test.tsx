// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlbumOnlineInfo, LibraryAlbum, LibraryArtist, LibraryPlaylist, LibraryTrack } from '../../../shared/types/library';
import { AlbumDetailView } from './AlbumDetailView';

const queueMock = {
  appendTracksToQueue: vi.fn(),
  currentTrackId: null as string | null,
  playTrack: vi.fn().mockResolvedValue({}),
  replaceQueue: vi.fn(),
};

let mockAlbumTracks: LibraryTrack[] = [];

vi.mock('../../stores/PlaybackQueueProvider', () => ({
  usePlaybackQueue: () => queueMock,
}));

vi.mock('../../i18n/I18nProvider', () => {
  const strings: Record<string, string> = {
    'albumDetail.action.back': 'Albums',
    'albumDetail.action.addToQueue': 'Add to queue',
    'albumDetail.action.more': 'More album actions',
    'albumDetail.action.showInFolder': 'Show in folder',
    'albumDetail.tracks.status.addedToPlaylist': 'Added to {playlist}.',
    'albumMenu.action.addToPlaylist': 'Add to playlist...',
    'albumMenu.playlistSubmenu.aria': 'Choose playlist',
    'albumMenu.playlistSubmenu.empty': 'No local playlists',
    'albumMenu.playlistSubmenu.itemCount': '{count} tracks',
    'albumMenu.playlistSubmenu.loading': 'Loading playlists...',
    'albumDetail.action.openSource': 'Open source',
    'albumDetail.aria.openArtist': 'Open artist {artist}',
    'albumDetail.online.match': 'MusicBrainz match',
    'albumDetail.information.artistProfile': 'Artist profile',
    'albumDetail.information.externalLinks': 'External links',
    'albumDetail.ratings.count': '{count} ratings',
    'albumDetail.ratings.overviewAria': 'External album ratings',
    'albumDetail.releases.count': '{count} release versions',
    'albumDetail.releases.current': 'Current match',
    'albumDetail.releases.currentHint': 'Shows the matched release',
    'albumDetail.releases.heading': 'Versions / Releases',
    'albumDetail.sources.barcode': 'Barcode',
    'albumDetail.sources.catalogNumber': 'Catalog no.',
    'albumDetail.sources.kind.database': 'Database',
    'albumDetail.sources.kind.streaming': 'Streaming',
    'albumDetail.sources.labels': 'Label / catalog',
    'albumDetail.sources.releaseDetails': 'Current release',
    'albumDetail.related.heading': 'My Library',
    'albumDetail.related.thisAlbum': 'This album',
    'albumDetail.status.addedToQueue': 'Added {count} tracks to queue.',
    'albumDetail.status.copiedCover': 'Original cover copied',
    'albumDetail.tab.credits': 'Credits',
    'albumDetail.tab.information': 'Information',
    'albumDetail.tab.releases': 'Versions',
    'albumDetail.tab.sources': 'Sources',
    'albumDetail.tab.tracks': 'Tracks',
  };

  return {
    useI18n: () => ({
      t: (key: string, options?: Record<string, string | number>) =>
        Object.entries(options ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), strings[key] ?? key),
    }),
  };
});

vi.mock('./AlbumTrackList', async () => {
  const React = await import('react');

  return {
    AlbumTrackList: ({ onFirstTrackChange, onLoadedTracksChange }: {
      onFirstTrackChange?: (track: LibraryTrack | null, isLoading: boolean) => void;
      onLoadedTracksChange?: (tracks: LibraryTrack[], total: number, isLoading: boolean) => void;
    }) => {
      React.useEffect(() => {
        const loadedTracks = mockAlbumTracks.length > 0 ? mockAlbumTracks : [track()];
        onFirstTrackChange?.(loadedTracks[0] ?? null, false);
        onLoadedTracksChange?.(loadedTracks, loadedTracks.length, false);
      }, [onFirstTrackChange, onLoadedTracksChange]);

      return <section>Mock album tracks</section>;
    },
  };
});

const album = (overrides: Partial<LibraryAlbum> = {}): LibraryAlbum => ({
  id: 'album-1',
  albumKey: 'echo/unit',
  title: 'Mock Album',
  albumArtist: 'Echo Unit',
  year: 2026,
  trackCount: 1,
  duration: 180,
  coverId: null,
  coverThumb: null,
  ...overrides,
});

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\track-1.flac',
  title: 'Mock Track',
  artist: 'Echo Unit',
  album: 'Mock Album',
  albumArtist: 'Echo Unit',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 1000000,
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

const artist = (): LibraryArtist => ({
  id: 'artist-1',
  name: 'Echo Unit',
  sortName: 'Echo Unit',
  role: 'both',
  trackCount: 1,
  albumCount: 1,
  coverId: null,
  coverThumb: null,
  avatarUrl: null,
  avatarThumbUrl: null,
  avatarStatus: null,
});

const playlist = (overrides: Partial<LibraryPlaylist> = {}): LibraryPlaylist => ({
  id: 'playlist-1',
  name: 'Road Mix',
  description: null,
  kind: 'manual',
  sourceProvider: 'local',
  sourcePlaylistId: null,
  coverId: null,
  coverThumb: null,
  sortMode: 'manual',
  itemCount: 0,
  createdAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  ...overrides,
});

const onlineInfo = (): AlbumOnlineInfo => ({
  albumId: 'album-1',
  status: 'ready',
  sources: [{ provider: 'wikipedia', label: 'en.wikipedia.org' }],
  match: {
    provider: 'musicbrainz',
    providerItemId: 'mb-release-1',
    title: 'Mock Album',
    artist: 'Echo Unit',
    year: 2026,
    confidence: 0.96,
    url: 'https://musicbrainz.org/release/mb-release-1',
    possible: false,
  },
  sourceLinks: [
    { provider: 'musicbrainz', label: 'MusicBrainz', url: 'https://musicbrainz.org/release/mb-release-1', kind: 'database' },
    { provider: 'rateYourMusic', label: 'Rate Your Music', url: 'https://rateyourmusic.com/release/album/echo_unit/mock_album/', kind: 'database' },
    { provider: 'spotify', label: 'Spotify', url: 'https://open.spotify.com/album/mock', kind: 'streaming' },
  ],
  externalRatings: [
    {
      provider: 'rateYourMusic',
      score: 3.82,
      maxScore: 5,
      ratingCount: 12431,
      rankText: '#24 in 2024',
      url: 'https://rateyourmusic.com/release/album/echo_unit/mock_album/',
      fetchedAt: '2026-05-21T00:00:00.000Z',
      expiresAt: '2026-06-21T00:00:00.000Z',
      confidence: 0.95,
    },
    {
      provider: 'musicbrainz',
      score: 4.55,
      maxScore: 5,
      ratingCount: 85,
      rankText: null,
      url: 'https://musicbrainz.org/release-group/mb-release-group-1',
      fetchedAt: null,
      expiresAt: null,
      confidence: 1,
    },
    {
      provider: 'discogs',
      score: 4.25,
      maxScore: 5,
      ratingCount: 12,
      rankText: 'Data provided by Discogs',
      url: 'https://www.discogs.com/release/12345-Cache-Artist-Cache-Album',
      fetchedAt: null,
      expiresAt: null,
      confidence: 0.92,
    },
  ],
  releaseDetails: {
    title: 'Mock Album',
    date: '2026-05-01',
    country: 'JP',
    barcode: '1234567890123',
    status: 'Official',
    labels: [{ name: 'Mock Label', catalogNumber: 'MOCK-1' }],
    mediaFormats: ['Digital Media'],
    copyrights: [],
  },
  releaseVersions: [
    {
      providerItemId: 'mb-release-1',
      title: 'Mock Album',
      artist: 'Echo Unit',
      year: 2026,
      date: '2026-05-01',
      country: 'JP',
      barcode: '1234567890123',
      status: 'Official',
      disambiguation: null,
      mediaFormats: ['Digital Media'],
      trackCount: 1,
      catalogNumbers: ['MOCK-1'],
      labels: ['Mock Label'],
      url: 'https://musicbrainz.org/release/mb-release-1',
      confidence: 0.96,
      isMatched: true,
    },
    {
      providerItemId: 'mb-release-2',
      title: 'Mock Album',
      artist: 'Echo Unit',
      year: 2026,
      date: '2026-06-01',
      country: 'US',
      barcode: null,
      status: 'Official',
      disambiguation: 'CD',
      mediaFormats: ['CD'],
      trackCount: 1,
      catalogNumbers: ['MOCK-CD'],
      labels: ['Mock Label'],
      url: 'https://musicbrainz.org/release/mb-release-2',
      confidence: 0.82,
      isMatched: false,
    },
  ],
  credits: [
    {
      role: 'Composer',
      people: [{ name: 'Mock Composer', detail: 'music', trackTitle: null, source: 'work' }],
    },
  ],
  information: {
    title: 'Mock Album',
    description: 'Album',
    extract: 'Mock album overview.',
    url: 'https://example.test/album',
    language: 'en',
    thumbnailUrl: null,
    externalLinks: [{ label: 'example.test / album official', url: 'https://example.test/album-official' }],
  },
  artistInformation: {
    title: 'Echo Unit',
    description: 'Artist',
    extract: 'Echo Unit artist overview.',
    url: 'https://example.test/artist',
    language: 'en',
    thumbnailUrl: null,
    externalLinks: [{ label: 'example.test / artist official', url: 'https://example.test/artist-official' }],
  },
  fetchedAt: '2026-05-21T00:00:00.000Z',
  expiresAt: '2026-06-21T00:00:00.000Z',
  fromCache: false,
  errors: [],
});

const onlineInfoForProvider = (provider?: 'all' | 'musicbrainz' | 'wikipedia'): AlbumOnlineInfo => {
  const info = onlineInfo();
  if (provider === 'wikipedia') {
    return {
      ...info,
      status: 'ready',
      sources: [{ provider: 'wikipedia', label: 'en.wikipedia.org' }],
      match: null,
      sourceLinks: [],
      externalRatings: [],
      releaseDetails: null,
      releaseVersions: [],
      credits: [],
    };
  }
  if (provider === 'musicbrainz') {
    return {
      ...info,
      status: 'ready',
      sources: [{ provider: 'musicbrainz', label: 'MusicBrainz' }],
      information: null,
      artistInformation: null,
    };
  }
  return info;
};

const relatedAlbum = (): LibraryAlbum => ({
  ...album(),
  id: 'album-2',
  albumKey: 'echo/unit/sister',
  title: 'Sister Album',
  year: 2025,
  trackCount: 8,
  duration: 2200,
  coverId: 'cover-2',
  coverThumb: 'echo-cover://album/cover-2',
});

const installLibrary = (): {
  getAlbumOnlineInfo: ReturnType<typeof vi.fn>;
  getArtists: ReturnType<typeof vi.fn>;
  getArtistAlbums: ReturnType<typeof vi.fn>;
  addTracksToPlaylist: ReturnType<typeof vi.fn>;
  copyAlbumCover: ReturnType<typeof vi.fn>;
} => {
  const getAlbumOnlineInfo = vi.fn((_albumId: string, options?: { provider?: 'all' | 'musicbrainz' | 'wikipedia' }) =>
    Promise.resolve(onlineInfoForProvider(options?.provider)),
  );
  const getArtists = vi.fn().mockResolvedValue({
    items: [artist()],
    page: 1,
    pageSize: 50,
    total: 1,
    hasMore: false,
  });
  const getArtistAlbums = vi.fn().mockResolvedValue({
    items: [album(), relatedAlbum()],
    page: 1,
    pageSize: 8,
    total: 2,
    hasMore: false,
  });
  const addTracksToPlaylist = vi.fn().mockResolvedValue([]);
  const copyAlbumCover = vi.fn().mockResolvedValue(true);
  window.echo = {
    app: {
      openExternalUrl: vi.fn().mockResolvedValue(undefined),
    },
    library: {
      getAlbum: vi.fn().mockResolvedValue({ coverLarge: null }),
      getAlbumTracks: vi.fn().mockResolvedValue({
        items: mockAlbumTracks.length > 0 ? mockAlbumTracks : [track()],
        page: 1,
        pageSize: 500,
        total: mockAlbumTracks.length > 0 ? mockAlbumTracks.length : 1,
        hasMore: false,
      }),
      getAlbumOnlineInfo,
      getArtists,
      getArtistAlbums,
      getPlaylists: vi.fn().mockResolvedValue([playlist()]),
      createPlaylist: vi.fn().mockResolvedValue(playlist()),
      addTrackToPlaylist: vi.fn().mockResolvedValue({ id: 'playlist-item-1' }),
      addTracksToPlaylist,
      copyAlbumCover,
      getLikedAlbumIds: vi.fn().mockResolvedValue({}),
      openTrackInFolder: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Window['echo'];
  return { getAlbumOnlineInfo, getArtists, getArtistAlbums, addTracksToPlaylist, copyAlbumCover };
};

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  queueMock.appendTracksToQueue.mockReset();
  queueMock.playTrack.mockReset();
  queueMock.playTrack.mockResolvedValue({});
  queueMock.replaceQueue.mockReset();
  mockAlbumTracks = [];
});

describe('AlbumDetailView', () => {
  it('plays the return animation before leaving after Escape', () => {
    vi.useFakeTimers();
    installLibrary();
    const onBack = vi.fn();

    render(<AlbumDetailView album={album()} onBack={onBack} />);

    expect(screen.getByText('Mock Album')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onBack).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('starts reading online album info when the detail opens and shows tracks by default', async () => {
    const { getAlbumOnlineInfo } = installLibrary();

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    await waitFor(() => expect(getAlbumOnlineInfo).toHaveBeenCalledWith('album-1', { force: false, provider: 'wikipedia' }));
    expect(getAlbumOnlineInfo).toHaveBeenCalledWith('album-1', { force: false, provider: 'musicbrainz' });

    expect(screen.getByText('Mock album tracks')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tracks' }).getAttribute('aria-current')).toBe('page');
    expect(await screen.findByText('4.55 / 5')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
    expect(await screen.findByText('1234567890123')).toBeTruthy();
    expect(screen.getAllByText('3.82 / 5').length).toBeGreaterThan(0);
    expect(screen.getByText('12,431 ratings - #24 in 2024')).toBeTruthy();
    expect(screen.getAllByText('4.55 / 5').length).toBeGreaterThan(0);
    expect(screen.getByText('85 ratings')).toBeTruthy();
    expect(screen.getAllByText('MusicBrainz').length).toBeGreaterThan(0);
    expect(screen.getByText('4.25 / 5')).toBeTruthy();
    expect(screen.getByText('12 ratings - Data provided by Discogs')).toBeTruthy();
    expect(screen.getAllByText('Discogs').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rate Your Music').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Spotify').length).toBeGreaterThan(0);
  });

  it('hides the external rating panel when rating data is absent', async () => {
    const { getAlbumOnlineInfo } = installLibrary();
    getAlbumOnlineInfo.mockImplementation((_albumId: string, options?: { provider?: 'all' | 'musicbrainz' | 'wikipedia' }) =>
      Promise.resolve({ ...onlineInfoForProvider(options?.provider), externalRatings: [] }),
    );

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sources' }));

    expect(await screen.findByText('1234567890123')).toBeTruthy();
    expect(screen.queryByText('3.82 / 5')).toBeNull();
  });

  it('shows MusicBrainz release versions and marks the current match', async () => {
    installLibrary();

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Versions' }));

    expect(await screen.findByText('Current match')).toBeTruthy();
    expect(screen.getByText('MOCK-CD')).toBeTruthy();
  });

  it('shows artist information after opening the information tab', async () => {
    installLibrary();

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Information' }));

    expect(await screen.findByText('Artist profile - en.wikipedia.org')).toBeTruthy();
    expect(screen.getByText('Echo Unit artist overview.')).toBeTruthy();
  });

  it('shows Wikipedia information before MusicBrainz finishes', async () => {
    const { getAlbumOnlineInfo } = installLibrary();
    let resolveMusicBrainz: (info: AlbumOnlineInfo) => void = () => {};
    getAlbumOnlineInfo.mockImplementation((_albumId: string, options?: { provider?: 'all' | 'musicbrainz' | 'wikipedia' }) => {
      if (options?.provider === 'wikipedia') {
        return Promise.resolve(onlineInfoForProvider('wikipedia'));
      }
      return new Promise<AlbumOnlineInfo>((resolve) => {
        resolveMusicBrainz = resolve;
      });
    });

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Information' }));

    expect(await screen.findByText('Artist profile - en.wikipedia.org')).toBeTruthy();
    expect(screen.getByText('Echo Unit artist overview.')).toBeTruthy();

    resolveMusicBrainz(onlineInfoForProvider('musicbrainz'));
    await waitFor(() => expect(getAlbumOnlineInfo).toHaveBeenCalledTimes(2));
  });

  it('formats wiki-style information into readable blocks', async () => {
    const { getAlbumOnlineInfo } = installLibrary();
    const info = onlineInfo();
    getAlbumOnlineInfo.mockResolvedValueOnce({
      ...info,
      artistInformation: {
        ...info.artistInformation!,
        extract: [
          'Echo Unit artist overview.',
          '',
          '== Career ==',
          'First era line.',
          '',
          '=== Discography ===',
          '* First album',
          '* Second album',
        ].join('\n'),
      },
    });

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Information' }));

    expect(await screen.findByRole('heading', { name: 'Career' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Discography' })).toBeTruthy();
    expect(screen.getByText('First album').closest('li')).toBeTruthy();
    expect(screen.queryByText(/== Career ==/u)).toBeNull();
  });

  it('uses original album artwork in the detail hero', async () => {
    installLibrary();

    const { container } = render(<AlbumDetailView album={album({
      coverId: 'cover 1',
      coverThumb: 'echo-cover://album/cover%201',
    })} onBack={vi.fn()} />);

    expect((container.querySelector('.album-detail-cover img') as HTMLImageElement | null)?.getAttribute('src')).toBe('echo-cover://original/cover%201');
  });

  it('copies the original album artwork from the detail cover context menu', async () => {
    const { copyAlbumCover } = installLibrary();

    const { container } = render(<AlbumDetailView album={album({
      coverId: 'cover 1',
      coverThumb: 'echo-cover://album/cover%201',
    })} onBack={vi.fn()} />);

    fireEvent.contextMenu(container.querySelector('.album-detail-cover')!);

    await waitFor(() => expect(copyAlbumCover).toHaveBeenCalledWith('album-1'));
    expect(screen.getByText('Original cover copied')).toBeTruthy();
  });

  it('opens information links through the system browser bridge', async () => {
    installLibrary();

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Information' }));
    fireEvent.click(await screen.findByRole('link', { name: /album official/i }));

    await waitFor(() => expect(window.echo?.app?.openExternalUrl).toHaveBeenCalledWith('https://example.test/album-official'));
  });

  it('adds the album tracks to the queue from the hero more menu', async () => {
    mockAlbumTracks = [track({ id: 'track-1', title: 'First Track' }), track({ id: 'track-2', title: 'Second Track' })];
    installLibrary();

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    await screen.findByText('Mock album tracks');
    fireEvent.click(screen.getByRole('button', { name: 'More album actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to queue' }));

    await waitFor(() => expect(queueMock.appendTracksToQueue).toHaveBeenCalledWith(mockAlbumTracks, { type: 'album', label: 'Mock Album', albumId: 'album-1' }));
    expect(screen.getByText('Added 2 tracks to queue.')).toBeTruthy();
  });

  it('adds the album tracks to a playlist from the hero more menu', async () => {
    mockAlbumTracks = [track({ id: 'track-1', title: 'First Track' }), track({ id: 'track-2', title: 'Second Track' })];
    const { addTracksToPlaylist } = installLibrary();

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    await screen.findByText('Mock album tracks');
    fireEvent.click(screen.getByRole('button', { name: 'More album actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to playlist...' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Road Mix/ }));

    await waitFor(() => expect(addTracksToPlaylist).toHaveBeenCalledWith('playlist-1', ['track-1', 'track-2']));
    expect(screen.getByText('Added to Road Mix.')).toBeTruthy();
  });

  it('shows the first album track in its folder from the hero more menu', async () => {
    const { getAlbumOnlineInfo } = installLibrary();

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    await waitFor(() => expect(getAlbumOnlineInfo).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'More album actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show in folder' }));

    await waitFor(() => expect(window.echo?.library?.openTrackInFolder).toHaveBeenCalledWith('track-1'));
  });

  it('opens the album artist detail from the hero artist name', async () => {
    const { getArtists } = installLibrary();
    const navigate = vi.fn();
    window.addEventListener('app:navigate:artist-detail', navigate);

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open artist Echo Unit' }));

    await waitFor(() => expect(getArtists).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Echo Unit', sort: 'default' }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]?.[0] as CustomEvent).detail.artist.id).toBe('artist-1');
    expect((navigate.mock.calls[0]?.[0] as CustomEvent).detail.returnTo).toBe('albums');

    window.removeEventListener('app:navigate:artist-detail', navigate);
  });

  it('derives the album artist display from track artists when the album artist is Various Artists', async () => {
    mockAlbumTracks = [
      track({
        id: 'track-1',
        artist: 'Mock Producer / Echo Unit / Hatsune Miku',
        albumArtist: 'Various Artists',
      }),
      track({
        id: 'track-2',
        artist: 'Echo Unit / Hatsune Miku',
        albumArtist: 'Various Artists',
      }),
    ];
    const { getArtists } = installLibrary();

    render(<AlbumDetailView album={album({ albumArtist: 'Various Artists' })} onBack={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Open artist Various Artists' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tracks' }));

    expect(await screen.findByRole('button', { name: 'Open artist Echo Unit / Hatsune Miku' })).toBeTruthy();
    await waitFor(() =>
      expect(getArtists).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Echo Unit', sort: 'default', sourceProvider: 'local' }),
    );
    expect(screen.queryByText('Various Artists')).toBeNull();
  });

  it('shows the album artist library shelf under the track list', async () => {
    const { getArtists, getArtistAlbums } = installLibrary();

    render(<AlbumDetailView album={album()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tracks' }));

    expect(await screen.findByText('My Library')).toBeTruthy();
    expect(screen.getByText('Sister Album')).toBeTruthy();
    expect(screen.getByText('This album')).toBeTruthy();
    expect(getArtists).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Echo Unit', sort: 'default', sourceProvider: 'local' });
    expect(getArtistAlbums).toHaveBeenCalledWith('artist-1', { page: 1, pageSize: 8, sort: 'recent' });
  });
});
