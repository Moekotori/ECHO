// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryPage, LibraryTrack } from '../../shared/types/library';
import type { AppSettings } from '../../shared/types/appSettings';
import type { RemoteSource } from '../../shared/types/remoteSources';
import type { StreamingProviderDescriptor, StreamingSearchResult, StreamingTrack } from '../../shared/types/streaming';
import {
  createSongsFirstPageSnapshotQueryKey,
  readSongsStartupLoadDiagnostics,
  writeSongsFirstPageSnapshot,
} from '../stores/songsFirstPageSnapshot';
import { showAudioErrorNoticeEvent } from '../utils/audioErrorNotice';

const sharedPlaybackState = vi.hoisted(() => ({
  value: {
    audioStatus: null as { state?: string } | null,
    playbackStatus: null as { state?: string } | null,
  },
}));

vi.mock('../stores/playbackStatusStore', () => ({
  beginPlaybackSwitchSnapshot: vi.fn(),
  setPlaybackStatusSnapshot: vi.fn(),
  useSharedPlaybackStatus: () => sharedPlaybackState.value,
}));

vi.mock('../components/library/TrackList', () => ({
  TrackList: ({
    tracks,
    currentTrackId,
    currentTrackIndex,
    canLoadMore,
    canLoadPrevious,
    duplicateHiddenCounts,
    isLoadingMore,
    likedTrackIds,
    loadedCount,
    loadedStartIndex,
    onEndReached,
    onAddToPlaylist,
    onOpenTrackMenu,
    onPlay,
    onShowVersions,
    onStartReached,
    onToggleLiked,
    onVisibleTrackIdsChange,
    totalCount,
  }: {
    tracks: LibraryTrack[];
    currentTrackId: string | null;
    currentTrackIndex?: number | null;
    canLoadMore?: boolean;
    canLoadPrevious?: boolean;
    duplicateHiddenCounts?: Record<string, number>;
    isLoadingMore?: boolean;
    likedTrackIds?: Record<string, boolean>;
    loadedCount?: number;
    loadedStartIndex?: number;
    onEndReached?: () => void;
    onAddToPlaylist?: (track: LibraryTrack) => void;
    onOpenTrackMenu?: (track: LibraryTrack, position: { x: number; y: number }) => void;
    onPlay?: (track: LibraryTrack) => void;
    onShowVersions?: (track: LibraryTrack) => void;
    onStartReached?: () => void;
    onToggleLiked?: (track: LibraryTrack) => void;
    onVisibleTrackIdsChange?: (trackIds: string[]) => void;
    totalCount?: number;
  }) => (
    <div
      className="track-list"
      data-testid="track-list"
      data-total-count={totalCount ?? tracks.length}
      data-loaded-count={loadedCount ?? tracks.length}
      data-loaded-start-index={loadedStartIndex ?? 0}
      data-current-track-index={currentTrackIndex ?? -1}
      data-loading-more={String(isLoadingMore)}
      data-visible-ids={tracks.slice(0, 2).map((track) => track.id).join(',')}
    >
      <button type="button" onClick={() => onVisibleTrackIdsChange?.(tracks.slice(0, 2).map((track) => track.id))}>
        mock-visible
      </button>
      <span data-testid="current-track-id">{currentTrackId ?? 'none'}</span>
      <button type="button" disabled={!canLoadMore} onClick={onEndReached}>
        mock-load-more
      </button>
      <button type="button" disabled={!canLoadPrevious} onClick={onStartReached}>
        mock-load-previous
      </button>
      {tracks.map((track) => (
        <div key={track.id}>
          <button
            type="button"
            onClick={() => onPlay?.(track)}
            onContextMenu={(event) => {
              event.preventDefault();
              onOpenTrackMenu?.(track, { x: event.clientX, y: event.clientY });
            }}
          >
            {track.title}
          </button>
          {duplicateHiddenCounts?.[track.id] ? (
            <button type="button" onClick={() => onShowVersions?.(track)}>
              有 {duplicateHiddenCounts[track.id] + 1} 个版本
            </button>
          ) : null}
          <button
            aria-pressed={likedTrackIds?.[track.id] === true}
            type="button"
            onClick={() => onToggleLiked?.(track)}
          >
            {likedTrackIds?.[track.id] ? `Unlike ${track.title}` : `Like ${track.title}`}
          </button>
          <button type="button" onClick={() => onAddToPlaylist?.(track)}>
            添加到歌单 {track.title}
          </button>
        </div>
      ))}
    </div>
  ),
}));

const renderSongsPage = async (): Promise<void> => {
  const { SongsPage } = await import('./SongsPage');
  const { PlaybackQueueProvider, usePlaybackQueue } = await import('../stores/PlaybackQueueProvider');
  const { I18nProvider } = await import('../i18n/I18nProvider');
  const QueueProbe = () => {
    const queue = usePlaybackQueue();
    return (
      <output
        aria-label="queue-order"
        data-order={queue.items.map((item) => item.track.title).join('>')}
        data-source-types={queue.items.map((item) => item.source.type).join(',')}
      />
    );
  };
  render(
    <I18nProvider>
      <PlaybackQueueProvider>
        <SongsPage />
        <QueueProbe />
      </PlaybackQueueProvider>
    </I18nProvider>,
  );
};

const makeTrack = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\Song.flac',
  title: 'Song One',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

const makePage = (items: LibraryTrack[]): LibraryPage<LibraryTrack> => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  hasMore: false,
});

const makePagedResult = (items: LibraryTrack[], overrides: Partial<LibraryPage<LibraryTrack>> = {}): LibraryPage<LibraryTrack> => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  hasMore: false,
  ...overrides,
});

const makeRemoteSource = (id: string, displayName: string): RemoteSource => ({
  id,
  provider: 'webdav',
  displayName,
  status: 'enabled',
  baseUrl: 'https://cloud.example.test',
  username: null,
  authType: 'basic',
  config: {},
  syncMode: 'index',
  lastTestAt: null,
  lastSyncAt: null,
  lastError: null,
  indexedTrackCount: 0,
  createdAt: '2026-05-20T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
});

const makeStreamingProvider = (overrides: Partial<StreamingProviderDescriptor> = {}): StreamingProviderDescriptor => ({
  name: 'qqmusic',
  displayName: 'QQ Music',
  enabled: true,
  supportsSearch: true,
  supportsPlayback: true,
  supportsDownload: true,
  supportsLyrics: true,
  supportsMv: true,
  requiresAccount: false,
  accountConnected: true,
  ...overrides,
});

const makeStreamingTrack = (overrides: Partial<StreamingTrack> = {}): StreamingTrack => ({
  id: 'streaming:qqmusic:song-mid',
  provider: 'qqmusic',
  providerTrackId: 'song-mid',
  stableKey: 'streaming:qqmusic:song-mid',
  title: 'Song One',
  artist: 'Artist',
  artists: [{ id: 'artist-1', provider: 'qqmusic', providerArtistId: 'artist-mid', name: 'Artist' }],
  album: 'Streaming Album',
  albumId: 'album-mid',
  albumArtist: 'Artist',
  duration: 180,
  coverUrl: null,
  coverThumb: null,
  qualities: ['standard', 'high', 'lossless'],
  explicit: false,
  playable: true,
  unavailableReason: null,
  lyricsStatus: 'available',
  mvStatus: 'unknown',
  ...overrides,
});

const makeStreamingSearchResult = (tracks: StreamingTrack[], overrides: Partial<StreamingSearchResult> = {}): StreamingSearchResult => ({
  provider: 'qqmusic',
  query: '',
  page: 1,
  pageSize: 20,
  total: tracks.length,
  hasMore: false,
  tracks,
  albums: [],
  artists: [],
  playlists: [],
  mvs: [],
  ...overrides,
});

const installEcho = (tracks: LibraryTrack[] = []) => {
  const playLocalFile = vi.fn().mockImplementation(({ filePath, trackId }: { filePath: string; trackId?: string }) =>
    Promise.resolve({
      state: 'playing',
      currentTrackId: trackId ?? tracks[0]?.id ?? null,
      positionMs: 0,
      durationMs: 180000,
      filePath,
    }),
  );
  const playMediaItem = vi.fn().mockImplementation(({ item }: { item: { trackId: string; duration?: number } }) =>
    Promise.resolve({
      state: 'playing',
      currentTrackId: item.trackId,
      positionMs: 0,
      durationMs: Math.round((item.duration ?? 180) * 1000),
      filePath: 'https://stream.example.test/song.flac',
    }),
  );

  window.echo = {
    library: {
      getTracks: vi.fn().mockResolvedValue(makePage(tracks)),
      getTrack: vi.fn((trackId: string) => Promise.resolve(tracks.find((track) => track.id === trackId) ?? null)),
      getAlbums: vi.fn(),
      getAlbumTracks: vi.fn(),
      getSummary: vi.fn(),
      chooseFolder: vi.fn(),
      addFolder: vi.fn(),
      getFolders: vi.fn().mockResolvedValue([]),
      removeFolder: vi.fn(),
      scanFolder: vi.fn(),
      getScanStatus: vi.fn(),
      cancelScan: vi.fn(),
      getDiagnostics: vi.fn(),
      recordTrackPlayback: vi.fn(),
      refreshAlbumGrouping: vi.fn(),
      refreshDuplicateTracks: vi.fn().mockResolvedValue({
        mode: 'strict',
        totalTracksScanned: tracks.length,
        duplicateGroups: 1,
        duplicateMembers: 2,
        hiddenTracks: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      getDuplicateTrackVersions: vi.fn().mockResolvedValue([]),
      getDuplicateHiddenCounts: vi.fn().mockResolvedValue({}),
      getDuplicateIndexSummary: vi.fn().mockResolvedValue({
        mode: 'strict',
        totalTracksScanned: tracks.length,
        duplicateGroups: 0,
        duplicateMembers: 0,
        hiddenTracks: 0,
        updatedAt: '',
      }),
      getLikedTrackIds: vi.fn().mockResolvedValue({}),
      toggleTrackLiked: vi.fn().mockResolvedValue({ liked: true }),
      getPlaylists: vi.fn().mockResolvedValue([
        {
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
          createdAt: '2026-05-18T00:00:00.000Z',
          updatedAt: '2026-05-18T00:00:00.000Z',
        },
      ]),
      createPlaylist: vi.fn(),
      addTrackToPlaylist: vi.fn().mockResolvedValue({ id: 'playlist-item-1' }),
      addTracksToPlaylist: vi.fn().mockResolvedValue([{ id: 'playlist-item-1' }]),
      addStreamingTrackToPlaylist: vi.fn().mockResolvedValue({ id: 'playlist-item-streaming' }),
      pruneInvalidTracks: vi.fn().mockResolvedValue({
        scannedCount: tracks.length,
        removedCount: 0,
        missingRemovedCount: 0,
        shortRemovedCount: 0,
        shortDurationThresholdSeconds: 5,
      }),
      pruneMissingTracks: vi.fn().mockResolvedValue({ scannedCount: tracks.length, removedCount: 0 }),
      clearTracks: vi.fn().mockResolvedValue({ scannedCount: tracks.length, removedCount: tracks.length }),
      clearCache: vi.fn(),
      startBpmAnalysis: vi.fn(),
      getBpmAnalysisStatus: vi.fn(),
      updateTrackTags: vi.fn(({ trackId }) =>
        Promise.resolve({
          ...(tracks.find((track) => track.id === trackId) ?? makeTrack({ id: trackId })),
          title: 'Song One Edited',
        }),
      ),
    },
    playback: {
      getStatus: vi.fn().mockResolvedValue({
        state: 'idle',
        currentTrackId: null,
        positionMs: 0,
        durationMs: 0,
        filePath: null,
      }),
      playLocalFile,
      playMediaItem,
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      openLocalAudioFile: vi.fn(),
    },
    app: {
      getVersion: vi.fn(),
      getSettings: vi.fn().mockResolvedValue({
        duplicateTracksEnabled: false,
        duplicateTracksMode: 'strict',
      }),
      setSettings: vi.fn().mockResolvedValue({
        duplicateTracksEnabled: true,
        duplicateTracksMode: 'strict',
      }),
      openExternalUrl: vi.fn().mockResolvedValue(undefined),
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
    },
    audio: {
      getStatus: vi.fn().mockResolvedValue({ state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
      onStatus: vi.fn(),
      listDevices: vi.fn(),
      setOutput: vi.fn(),
    },
    remoteSources: {
      list: vi.fn().mockResolvedValue([]),
      hydrateVisibleTracks: vi.fn().mockResolvedValue([]),
    },
    streaming: {
      getProviders: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue(makeStreamingSearchResult([])),
    },
  } as unknown as Window['echo'];

  return { playLocalFile, playMediaItem };
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  sharedPlaybackState.value.audioStatus = null;
  sharedPlaybackState.value.playbackStatus = null;
});

describe('SongsPage', () => {
  it('renders a renderer first-page snapshot before SQLite returns the fresh page', async () => {
    const cachedTrack = makeTrack({ id: 'cached-track', title: 'Cached Song' });
    const freshTrack = makeTrack({ id: 'fresh-track', title: 'Fresh Song' });
    installEcho();
    const queryKey = createSongsFirstPageSnapshotQueryKey({
      pageSize: 100,
      search: '',
      sort: 'default',
      hideDuplicates: false,
      duplicateMode: 'strict',
    });
    writeSongsFirstPageSnapshot(queryKey, makePagedResult([cachedTrack], { total: 10000, hasMore: true }));

    let resolveTracks!: (page: LibraryPage<LibraryTrack>) => void;
    vi.mocked(window.echo.library.getTracks).mockReturnValue(
      new Promise<LibraryPage<LibraryTrack>>((resolve) => {
        resolveTracks = resolve;
      }),
    );

    await renderSongsPage();

    expect(screen.getByText('Cached Song')).toBeTruthy();
    expect(screen.getByTestId('track-list').getAttribute('data-total-count')).toBe('10000');

    await waitFor(() =>
      expect(readSongsStartupLoadDiagnostics()).toMatchObject({
        source: 'renderer-snapshot',
        itemCount: 1,
        total: 10000,
      }),
    );

    resolveTracks(makePagedResult([freshTrack], { total: 1 }));

    await screen.findByText('Fresh Song');
    expect(screen.queryByText('Cached Song')).toBeNull();
    const diagnostics = readSongsStartupLoadDiagnostics();
    expect(diagnostics?.source).toBe('renderer-snapshot');
    expect(diagnostics?.sqliteQueryMs).toEqual(expect.any(Number));
    expect(diagnostics?.total).toBe(1);
  });

  it('does not scan or start heavy library jobs while loading the startup song list', async () => {
    installEcho([makeTrack()]);

    await renderSongsPage();

    await screen.findByText('Song One');
    expect(window.echo.library.scanFolder).not.toHaveBeenCalled();
    expect(window.echo.library.refreshAlbumGrouping).not.toHaveBeenCalled();
    expect(window.echo.library.startBpmAnalysis).not.toHaveBeenCalled();
  });

  it('shows the disaster recovery hint when the song list hits a corrupt database', async () => {
    installEcho();
    vi.mocked(window.echo.library.getTracks).mockRejectedValue(new Error('SQLITE_CORRUPT: file is not a database'));

    await renderSongsPage();

    expect(await screen.findByText(/归档坏库并重建空库/)).toBeTruthy();
  });

  it('restores the remembered song sort mode', async () => {
    window.localStorage.setItem('echo-next.songs.sort', 'recent');
    installEcho([makeTrack()]);

    await renderSongsPage();

    await waitFor(() =>
      expect(window.echo.library.getTracks).toHaveBeenCalledWith(expect.objectContaining({ sort: 'recent' })),
    );
  });

  it('remembers the selected song sort mode', async () => {
    installEcho([makeTrack()]);

    await renderSongsPage();
    fireEvent.click(screen.getByRole('button', { name: /默认排序|Default sort/ }));
    fireEvent.click(screen.getByRole('option', { name: /按艺术家 \/ 专辑|By artist \/ album/ }));

    await waitFor(() => expect(window.localStorage.getItem('echo-next.songs.sort')).toBe('artistAlbum'));
    await waitFor(() =>
      expect(window.echo.library.getTracks).toHaveBeenCalledWith(expect.objectContaining({ sort: 'artistAlbum' })),
    );
  });

  it('filters the song list to duplicate tracks from the sort menu', async () => {
    installEcho([makeTrack(), makeTrack({ id: 'track-2', title: 'Song Two' })]);

    await renderSongsPage();
    await screen.findByText('Song One');
    fireEvent.click(screen.getByRole('button', { name: /默认排序|Default sort/ }));
    fireEvent.click(screen.getByRole('option', { name: /只看重复歌曲|Duplicates only/ }));

    await waitFor(() =>
      expect(window.echo.library.getTracks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          hideDuplicates: false,
          showDuplicatesOnly: true,
          duplicateMode: 'strict',
        }),
      ),
    );
    expect(screen.getByRole('button', { name: /只看重复歌曲|Duplicates only/ })).toBeTruthy();
  });

  it('filters the song list by sample rate independently from sorting', async () => {
    installEcho([makeTrack({ sampleRate: 192000 })]);

    await renderSongsPage();
    await screen.findByText('Song One');
    fireEvent.click(screen.getByRole('button', { name: /榛樿鎺掑簭|Default sort/ }));
    const optionLabels = screen.getAllByRole('option').map((option) => option.textContent ?? '');
    const defaultSortIndex = optionLabels.findIndex((label) => label.includes('Default sort') || label.includes('榛樿鎺掑簭'));
    const sampleRateIndex = optionLabels.findIndex((label) => label.includes('192 kHz'));
    expect(defaultSortIndex).toBeGreaterThanOrEqual(0);
    expect(defaultSortIndex).toBeLessThan(sampleRateIndex);
    fireEvent.click(screen.getByRole('option', { name: /192 kHz/ }));

    await waitFor(() =>
      expect(window.echo.library.getTracks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sort: 'default',
          audioFormatFilter: 'sampleRate192000',
        }),
      ),
    );
    expect(document.querySelector('.sort-button-label')?.textContent).not.toContain('192');
    expect(document.querySelector('.sort-button-filter-count')?.textContent).toBe('1');
  });

  it('filters the song list to osu imports from the filter section', async () => {
    installEcho([makeTrack({ album: 'osu! beatmapset 2141496' })]);

    await renderSongsPage();
    await screen.findByText('Song One');
    fireEvent.click(screen.getByRole('button', { name: /姒涙顓婚幒鎺戠碍|Default sort/ }));
    fireEvent.click(screen.getByRole('option', { name: /osu!/ }));

    await waitFor(() =>
      expect(window.echo.library.getTracks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sort: 'default',
          showOsuOnly: true,
        }),
      ),
    );
    expect(document.querySelector('.sort-button-label')?.textContent).not.toContain('osu');
    expect(document.querySelector('.sort-button-filter-count')?.textContent).toBe('1');
  });

  it('routes osu playback through the enabled Hi-Fi switch with NetEase first', async () => {
    const osuTrack = makeTrack({
      title: 'Bismuth',
      artist: 'Ludicin',
      album: 'osu! beatmapset 2141496',
      codec: 'mp3',
      bitrate: 263000,
      coverThumb: 'echo-cover://thumb/osu-local-cover',
    });
    const { playLocalFile, playMediaItem } = installEcho([osuTrack]);
    vi.mocked(window.echo.streaming.getProviders).mockResolvedValue([
      makeStreamingProvider({ name: 'qqmusic', displayName: 'QQ Music', accountConnected: true }),
      makeStreamingProvider({ name: 'netease', displayName: '网易云音乐', accountConnected: true }),
    ]);
    vi.mocked(window.echo.streaming.search).mockImplementation(async (request) =>
      makeStreamingSearchResult([
        makeStreamingTrack({
          provider: request.provider,
          title: 'Bismuth (TV Size)',
          artist: 'Ludicin',
          stableKey: `streaming:${request.provider}:mismatch`,
          providerTrackId: 'mismatch',
        }),
        makeStreamingTrack({
          provider: request.provider,
          title: 'Bismuth',
          artist: 'Ludicin',
          stableKey: `streaming:${request.provider}:bismuth`,
          providerTrackId: 'bismuth',
        }),
      ], { provider: request.provider }),
    );

    await renderSongsPage();
    await screen.findByText('Bismuth');

    fireEvent.click(screen.getByRole('button', { name: /Default sort|榛樿鎺掑簭|濮掓稒顭堥濠氬箳閹烘垹纰?/ }));
    fireEvent.click(screen.getByRole('option', { name: /osu!/ }));
    fireEvent.click(await screen.findByRole('switch', { name: /高音质音源|Hi-Fi Source/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bismuth' }));

    await waitFor(() =>
      expect(window.echo.streaming.search).toHaveBeenCalledWith({
        provider: 'netease',
        query: 'Bismuth Ludicin',
        mediaTypes: ['track'],
        page: 1,
        pageSize: 20,
      }),
    );
    expect(window.echo.streaming.search).toHaveBeenCalledWith(expect.objectContaining({ provider: 'qqmusic' }));
    expect(playLocalFile).not.toHaveBeenCalled();
    await waitFor(() => expect(playMediaItem).toHaveBeenCalledTimes(1));
    expect(playMediaItem).toHaveBeenCalledWith(expect.objectContaining({
      item: expect.objectContaining({
        mediaType: 'streaming',
        provider: 'netease',
        providerTrackId: 'bismuth',
        quality: 'lossless',
        title: 'Bismuth',
        artist: 'Ludicin',
        coverThumb: 'echo-cover://thumb/osu-local-cover',
      }),
    }));
  });

  it('keeps the filtered osu song list queued after resolving the current Hi-Fi track', async () => {
    const labyrinth = makeTrack({
      id: 'track-labyrinth',
      title: 'Labyrinth',
      artist: 'yaseta',
      album: 'osu! beatmapset 1595581',
    });
    const matusa = makeTrack({
      id: 'track-matusa',
      title: 'Matusa Bomber',
      artist: 'Rahatt',
      album: 'osu! beatmapset 1764169',
    });
    const { playMediaItem } = installEcho([labyrinth, matusa]);
    vi.mocked(window.echo.streaming.getProviders).mockResolvedValue([
      makeStreamingProvider({ name: 'netease', displayName: 'NetEase', accountConnected: true }),
    ]);
    vi.mocked(window.echo.streaming.search).mockImplementation(async (request) =>
      makeStreamingSearchResult([
        makeStreamingTrack({
          provider: request.provider,
          title: 'Labyrinth',
          artist: 'yaseta',
          stableKey: `streaming:${request.provider}:labyrinth`,
          providerTrackId: 'labyrinth',
        }),
      ], { provider: request.provider }),
    );

    await renderSongsPage();
    await screen.findByText('Matusa Bomber');

    fireEvent.click(document.querySelector('.sort-button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('option', { name: /osu!/ }));
    fireEvent.click(await screen.findByRole('switch', { name: /Hi-Fi Source/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Labyrinth' }));

    await waitFor(() => expect(playMediaItem).toHaveBeenCalledTimes(1));
    expect(window.echo.streaming.search).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('queue-order').getAttribute('data-order')).toBe('Labyrinth>Matusa Bomber');
    expect(screen.getByLabelText('queue-order').getAttribute('data-source-types')).toBe('streaming,songs');
  });

  it('falls back to local osu playback when Hi-Fi matching finds no exact source', async () => {
    const osuTrack = makeTrack({
      title: 'Cord Cutter',
      artist: 'Boom Kitty',
      album: 'osu! beatmapset 1859304',
      codec: 'mp3',
      bitrate: 128000,
    });
    const { playLocalFile, playMediaItem } = installEcho([osuTrack]);
    vi.mocked(window.echo.streaming.getProviders).mockResolvedValue([
      makeStreamingProvider({ name: 'netease', displayName: 'NetEase', accountConnected: true }),
    ]);
    vi.mocked(window.echo.streaming.search).mockResolvedValue(makeStreamingSearchResult([
      makeStreamingTrack({
        provider: 'netease',
        title: 'Cord Cutter',
        artist: 'Different Artist',
        stableKey: 'streaming:netease:mismatch',
        providerTrackId: 'mismatch',
      }),
    ], { provider: 'netease' }));

    await renderSongsPage();
    await screen.findByText('Cord Cutter');

    fireEvent.click(screen.getByRole('button', { name: /Default sort|姒涙顓婚幒鎺戠碍|婵帗绋掗…鍫ヮ敇婵犳艾绠抽柟鐑樺灩绾?/ }));
    fireEvent.click(screen.getByRole('option', { name: /osu!/ }));
    fireEvent.click(await screen.findByRole('switch', { name: /Hi-Fi Source/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cord Cutter' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: osuTrack.path,
      trackId: osuTrack.id,
    }));
    expect(playMediaItem).not.toHaveBeenCalled();
    expect(await screen.findAllByText(/No lossless source matched both title and artist exactly: Cord Cutter - Boom Kitty/)).toHaveLength(2);
  });

  it('keeps osu playback local while the Hi-Fi switch is off', async () => {
    const osuTrack = makeTrack({
      title: 'Bismuth',
      artist: 'Ludicin',
      album: 'osu! beatmapset 2141496',
      codec: 'mp3',
      bitrate: 263000,
    });
    const { playLocalFile, playMediaItem } = installEcho([osuTrack]);

    await renderSongsPage();
    await screen.findByText('Bismuth');

    fireEvent.click(screen.getByRole('button', { name: /Default sort|姒涙顓婚幒鎺戠碍|婵帗绋掗…鍫ヮ敇婵犳艾绠抽柟鐑樺灩绾?/ }));
    fireEvent.click(screen.getByRole('option', { name: /osu!/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bismuth' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledTimes(1));
    expect(window.echo.streaming.search).not.toHaveBeenCalled();
    expect(playMediaItem).not.toHaveBeenCalled();
  });

  it('loads liked state for loaded tracks outside the visible virtual window', async () => {
    const tracks = [
      makeTrack({ id: 'track-1', title: 'Song One' }),
      makeTrack({ id: 'track-2', title: 'Song Two' }),
      makeTrack({ id: 'track-3', title: 'Song Three' }),
    ];
    installEcho(tracks);
    vi.mocked(window.echo.library.getLikedTrackIds).mockResolvedValue({
      'track-1': false,
      'track-2': false,
      'track-3': true,
    });

    await renderSongsPage();

    await screen.findByText('Song Three');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unlike Song Three' })).toBeTruthy());
    expect(window.echo.library.getLikedTrackIds).toHaveBeenCalledWith(['track-1', 'track-2', 'track-3']);
  });

  it('checks an unknown liked state before toggling so a stale empty heart does not unlike the track', async () => {
    const track = makeTrack({ id: 'track-3', title: 'Song Three' });
    installEcho([track]);
    let resolveLikedState!: (value: Record<string, boolean>) => void;
    const likedState = new Promise<Record<string, boolean>>((resolve) => {
      resolveLikedState = resolve;
    });
    vi.mocked(window.echo.library.getLikedTrackIds).mockReturnValue(likedState);
    vi.mocked(window.echo.library.toggleTrackLiked).mockResolvedValue({ liked: false });

    await renderSongsPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Like Song Three' }));
    resolveLikedState({ 'track-3': true });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Unlike Song Three' })).toBeTruthy());
    expect(window.echo.library.getLikedTrackIds).toHaveBeenCalledWith(['track-3']);
    expect(window.echo.library.toggleTrackLiked).not.toHaveBeenCalled();
  });

  it('dispatches navigation from the import folder button', async () => {
    installEcho();
    const navigate = vi.fn();
    window.addEventListener('app:navigate:import-folder', navigate);

    await renderSongsPage();
    fireEvent.click(screen.getByRole('button', { name: '导入文件夹' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    window.removeEventListener('app:navigate:import-folder', navigate);
  });

  it('dispatches file import from the import file toolbar button', async () => {
    installEcho();
    const importFile = vi.fn();
    window.addEventListener('app:import-file', importFile);

    await renderSongsPage();
    fireEvent.click(screen.getByRole('button', { name: 'Import File' }));

    await waitFor(() => expect(importFile).toHaveBeenCalledTimes(1));
    window.removeEventListener('app:import-file', importFile);
  });

  it('plays a local file from TrackRow and exposes queue currentTrackId to TrackList', async () => {
    const track = makeTrack();
    const { playLocalFile } = installEcho([track]);

    await renderSongsPage();

    await screen.findByText('Song One');
    expect(screen.getByTestId('current-track-id').textContent).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Song One' }));

    await waitFor(() =>
      expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({
        filePath: track.path,
        trackId: track.id,
        probe: expect.objectContaining({
          durationSeconds: track.duration,
          fileSampleRate: track.sampleRate,
          channels: 2,
          codec: track.codec,
          bitDepth: track.bitDepth,
          bitrate: track.bitrate,
        }),
      })),
    );
    await waitFor(() => expect(screen.getByTestId('current-track-id').textContent).toBe('track-1'));
  });

  it('adds a song to a local playlist from the row list-plus action', async () => {
    const track = makeTrack();
    installEcho([track]);

    await renderSongsPage();

    fireEvent.click(await screen.findByRole('button', { name: /添加到歌单\s*Song One/ }));

    await waitFor(() => expect(window.echo.library.addTracksToPlaylist).toHaveBeenCalledWith('playlist-1', ['track-1']));
  });

  it('keeps streaming tracks out of local playlist add flows', async () => {
    const streamingTrack = makeTrack({
      id: 'streaming:netease:200',
      mediaType: 'streaming',
      path: 'streaming:netease:200',
      provider: 'netease',
      providerTrackId: '200',
      stableKey: 'streaming:netease:200',
      title: 'Cloud Song',
    });
    installEcho([streamingTrack]);

    await renderSongsPage();

    fireEvent.click(await screen.findByRole('button', { name: /添加到歌单\s*Cloud Song/ }));

    await waitFor(() => expect(screen.getByText('流媒体歌曲不能加入本地歌单，请在流媒体歌单中单独管理。')).toBeTruthy());
    expect(window.echo.library.addTracksToPlaylist).not.toHaveBeenCalled();
    expect(window.echo.library.addStreamingTrackToPlaylist).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Cloud Song' }), { clientX: 240, clientY: 180 });

    expect(screen.queryByRole('menuitem', { name: /加入歌单|Add to playlist|加入播放清單|プレイリストに追加/u })).toBeNull();
  });

  it('uses the app playlist picker instead of window.prompt when multiple playlists exist', async () => {
    const track = makeTrack();
    installEcho([track]);
    vi.spyOn(window, 'prompt').mockImplementation(() => {
      throw new Error('prompt() is not supported.');
    });
    vi.mocked(window.echo.library.getPlaylists).mockResolvedValue([
      {
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
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
      {
        id: 'playlist-2',
        name: 'Second Mix',
        description: null,
        kind: 'manual',
        sourceProvider: 'local',
        sourcePlaylistId: null,
        coverId: null,
        coverThumb: null,
        sortMode: 'manual',
        itemCount: 3,
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
    ]);

    await renderSongsPage();

    fireEvent.click(await screen.findByRole('button', { name: /添加到歌单\s*Song One/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Second Mix/ }));

    await waitFor(() => expect(window.echo.library.addTracksToPlaylist).toHaveBeenCalledWith('playlist-2', ['track-1']));
    expect(window.prompt).not.toHaveBeenCalled();
  });

  it('does not open playlist creation when cancelling the app playlist picker', async () => {
    const track = makeTrack();
    installEcho([track]);
    vi.mocked(window.echo.library.getPlaylists).mockResolvedValue([
      {
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
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
      {
        id: 'playlist-2',
        name: 'Second Mix',
        description: null,
        kind: 'manual',
        sourceProvider: 'local',
        sourcePlaylistId: null,
        coverId: null,
        coverThumb: null,
        sortMode: 'manual',
        itemCount: 3,
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
    ]);

    await renderSongsPage();

    fireEvent.click(await screen.findByRole('button', { name: /添加到歌单\s*Song One/ }));
    await screen.findByText('Road Mix');
    fireEvent.click(document.querySelector('.app-prompt-cancel') as HTMLButtonElement);

    await waitFor(() => expect(screen.queryByText('Road Mix')).toBeNull());
    expect(window.echo.library.createPlaylist).not.toHaveBeenCalled();
    expect(window.echo.library.addTracksToPlaylist).not.toHaveBeenCalled();
  });

  it('shows playlist choices from the context menu add-to-playlist hover', async () => {
    const track = makeTrack();
    installEcho([track]);
    vi.spyOn(window, 'prompt').mockImplementation(() => {
      throw new Error('prompt() is not supported.');
    });
    vi.mocked(window.echo.library.getPlaylists).mockResolvedValue([
      {
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
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
      {
        id: 'playlist-2',
        name: 'Second Mix',
        description: null,
        kind: 'manual',
        sourceProvider: 'local',
        sourcePlaylistId: null,
        coverId: null,
        coverThumb: null,
        sortMode: 'manual',
        itemCount: 3,
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
    ]);

    await renderSongsPage();

    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Song One' }), { clientX: 240, clientY: 180 });
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: 'Add to playlist...' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Second Mix/ }));

    await waitFor(() => expect(window.echo.library.addTracksToPlaylist).toHaveBeenCalledWith('playlist-2', ['track-1']));
    expect(window.prompt).not.toHaveBeenCalled();
  });

  it('opens osu timing from the song context menu and copies the timing line', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    installEcho([makeTrack({ bpm: 128, bpmConfidence: 0.9, beatOffsetMs: 12, analysisStatus: 'complete' })]);
    vi.mocked(window.echo.app.getSettings).mockResolvedValue({
      duplicateTracksEnabled: false,
      duplicateTracksMode: 'strict',
      trackContextMenuExtraActionsEnabled: true,
    } as AppSettings);

    await renderSongsPage();

    const row = await screen.findByRole('button', { name: 'Song One' });
    fireEvent.contextMenu(row, { clientX: 240, clientY: 180 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'osu! Timing' }));

    expect(await screen.findByRole('dialog', { name: 'osu! Timing' })).toBeTruthy();
    expect(screen.getByText('12,468.75,4,1,0,100,1,0')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '复制 timing 行' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('12,468.75,4,1,0,100,1,0'));
  });

  it('opens the osu beatmapset page from the osu-filtered context menu using the system browser bridge', async () => {
    installEcho([makeTrack({ title: 'Cord Cutter', album: 'osu! beatmapset 1859304' })]);

    await renderSongsPage();

    fireEvent.click(await screen.findByRole('button', { name: /Default sort/ }));
    fireEvent.click(screen.getByRole('option', { name: /osu!/ }));
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Cord Cutter' }), { clientX: 240, clientY: 180 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open beatmap page' }));

    await waitFor(() => expect(window.echo.app.openExternalUrl).toHaveBeenCalledWith('https://osu.ppy.sh/beatmapsets/1859304'));
  });

  it('prunes invalid library entries from the toolbar without starting a folder scan', async () => {
    const track = makeTrack();
    installEcho([track]);
    vi.mocked(window.echo.library.pruneInvalidTracks).mockResolvedValue({
      scannedCount: 1,
      removedCount: 1,
      missingRemovedCount: 0,
      shortRemovedCount: 1,
      shortDurationThresholdSeconds: 5,
    });
    vi.mocked(window.echo.library.getFolders).mockResolvedValue([
      {
        id: 'folder-1',
        path: 'D:/Music',
        name: 'Music',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    vi.mocked(window.echo.library.scanFolder).mockResolvedValue({
      id: 'scan-1',
      folderId: 'folder-1',
      status: 'completed',
      phase: 'finished',
      totalFiles: 1,
      processedFiles: 1,
      skippedFiles: 1,
      addedTracks: 0,
      updatedTracks: 0,
      removedTracks: 0,
      coverCount: 0,
      errorCount: 0,
      errors: [],
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
    });

    await renderSongsPage();
    fireEvent.click(
      screen.queryByRole('button', { name: '扫描失效歌曲、短音频并增量扫描' }) ??
        screen.getByRole('button', { name: 'Scan invalid songs, short audio, and incremental changes' }),
    );

    await waitFor(() => expect(window.echo.library.pruneInvalidTracks).toHaveBeenCalledTimes(1));
    expect(window.echo.library.scanFolder).not.toHaveBeenCalled();
    expect(await screen.findByText(/维护完成：检查 1 首|Maintenance complete: checked 1/)).toBeTruthy();
  });

  it('confirms before clearing the song list', async () => {
    const track = makeTrack();
    installEcho([track]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await renderSongsPage();
    await screen.findByText('Song One');
    fireEvent.click(screen.getByRole('button', { name: /清空列表|Clear list/ }));

    await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('清空歌曲列表？\n这会从列表移除 1 首歌曲，不会删除本地音乐文件。'));
    await waitFor(() => expect(window.echo.library.clearTracks).toHaveBeenCalledTimes(1));
  });

  it('passes the full library total to TrackList after the first page loads', async () => {
    const firstPageTracks = Array.from({ length: 100 }, (_, index) => makeTrack({ id: `track-${index + 1}`, title: `Song ${index + 1}` }));
    installEcho();
    vi.mocked(window.echo.library.getTracks).mockResolvedValue(makePagedResult(firstPageTracks, { total: 10000, hasMore: true }));

    await renderSongsPage();

    await waitFor(() => expect(screen.getByTestId('track-list').getAttribute('data-total-count')).toBe('10000'));
    expect(screen.getByTestId('track-list').getAttribute('data-loaded-count')).toBe('100');
  });

  it('routes playback failures to the upper-left audio notice instead of the page error banner', async () => {
    const track = makeTrack();
    const { playLocalFile } = installEcho([track]);
    playLocalFile.mockRejectedValueOnce(new Error('Error invoking remote method playback:play-local-file: echo-audio-host runtime_error'));
    const notices: Event[] = [];
    window.addEventListener(showAudioErrorNoticeEvent, (event) => notices.push(event));

    await renderSongsPage();
    await screen.findByText('Song One');
    fireEvent.click(screen.getByText('Song One'));

    await waitFor(() => expect(notices).toHaveLength(1));
    expect((notices[0] as CustomEvent).detail).toEqual({
      message: 'Error invoking remote method playback:play-local-file: echo-audio-host runtime_error',
    });
    expect(document.querySelector('.audio-error')).toBeNull();
  });

  it('hides the local and cloud source switch when no remote source is connected', async () => {
    installEcho([makeTrack()]);

    await renderSongsPage();
    await screen.findByText('Song One');

    expect(screen.queryByRole('group', { name: /Library source|曲库来源/u })).toBeNull();
  });

  it('shows the source switch after a remote source is connected', async () => {
    installEcho([makeTrack()]);
    vi.mocked(window.echo.remoteSources.list).mockResolvedValue([makeRemoteSource('source-1', 'AList One')]);

    await renderSongsPage();
    await screen.findByText('Song One');

    expect(await screen.findByRole('group', { name: /Library source|曲库来源/u })).toBeTruthy();
  });

  it('does not refresh remote sources on local library changes', async () => {
    installEcho([makeTrack()]);
    vi.mocked(window.echo.remoteSources.list).mockResolvedValue([makeRemoteSource('source-1', 'AList One')]);

    await renderSongsPage();
    await screen.findByText('Song One');
    await waitFor(() => expect(window.echo.remoteSources.list).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));
    await waitFor(() => expect(window.echo.library.getTracks).toHaveBeenCalledTimes(2));

    expect(window.echo.remoteSources.list).toHaveBeenCalledTimes(1);
  });

  it('delays the local source remote-source probe while playback is active', async () => {
    let delayedRefresh: (() => void) | null = null;
    const realSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 4000) {
        delayedRefresh = () => {
          if (typeof handler === 'function') {
            handler(...args);
          }
        };
        const timerId = realSetTimeout(() => undefined, 0);
        window.clearTimeout(timerId);
        return timerId;
      }

      return realSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout);
    sharedPlaybackState.value.audioStatus = { state: 'playing' };
    installEcho([makeTrack()]);
    vi.mocked(window.echo.remoteSources.list).mockResolvedValue([makeRemoteSource('source-1', 'AList One')]);

    await renderSongsPage();
    await screen.findByText('Song One');

    expect(window.echo.remoteSources.list).not.toHaveBeenCalled();
    expect(delayedRefresh).toBeTruthy();

    (delayedRefresh as unknown as () => void)();
    await waitFor(() => expect(window.echo.remoteSources.list).toHaveBeenCalledTimes(1));
  });

  it('refreshes remote sources on library changes while remote mode is active', async () => {
    window.localStorage.setItem('echo-next.library.source-mode', 'remote');
    installEcho([makeTrack({ mediaType: 'remote', sourceId: 'source-1' })]);
    vi.mocked(window.echo.remoteSources.list).mockResolvedValue([makeRemoteSource('source-1', 'AList One')]);

    await renderSongsPage();
    await screen.findByText('Song One');
    await waitFor(() => expect(window.echo.remoteSources.list).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));

    await waitFor(() => expect(window.echo.remoteSources.list).toHaveBeenCalledTimes(2));
  });

  it('loads duplicate badges only for visible song rows', async () => {
    const tracks = Array.from({ length: 5 }, (_, index) => makeTrack({ id: `track-${index + 1}`, title: `Song ${index + 1}` }));
    installEcho(tracks);

    await renderSongsPage();
    await screen.findByText('Song 1');
    fireEvent.click(screen.getByRole('button', { name: 'mock-visible' }));

    await waitFor(() => expect(window.echo.library.getDuplicateHiddenCounts).toHaveBeenCalledWith(['track-1', 'track-2'], 'strict'));
    expect(window.echo.library.getDuplicateTrackVersions).not.toHaveBeenCalled();
  });

  it('hydrates only visible remote rows in remote source mode', async () => {
    window.localStorage.setItem('echo-next.library.source-mode', 'remote');
    const tracks = [
      makeTrack({
        id: 'remote-track-1',
        mediaType: 'remote',
        path: 'remote://source-1/music/one.flac',
        sourceId: 'source-1',
        provider: 'webdav',
        remotePath: '/music/one.flac',
        stableKey: 'stable-1',
        title: 'Remote One',
      }),
      makeTrack({
        id: 'remote-track-2',
        mediaType: 'remote',
        path: 'remote://source-1/music/two.flac',
        sourceId: 'source-1',
        provider: 'webdav',
        remotePath: '/music/two.flac',
        stableKey: 'stable-2',
        title: 'Remote Two',
      }),
    ];
    installEcho(tracks);
    vi.mocked(window.echo.remoteSources.list).mockResolvedValue([makeRemoteSource('source-1', 'AList One')]);
    vi.mocked(window.echo.remoteSources.hydrateVisibleTracks).mockResolvedValue([
      { ...tracks[0], coverId: 'cover-1', coverThumb: 'echo-cover://thumb/cover-1' },
    ]);

    await renderSongsPage();
    await screen.findByText('Remote One');
    fireEvent.click(screen.getByRole('button', { name: 'mock-visible' }));

    await waitFor(() =>
      expect(window.echo.remoteSources.hydrateVisibleTracks).toHaveBeenCalledWith(
        ['remote-track-1', 'remote-track-2'],
        { metadata: true, cover: true, priority: 12 },
      ),
    );
  });

  it('filters the remote song list by selected source', async () => {
    window.localStorage.setItem('echo-next.library.source-mode', 'remote');
    installEcho([
      makeTrack({
        id: 'remote-track-1',
        mediaType: 'remote',
        path: 'remote://source-1/music/one.flac',
        sourceId: 'source-1',
        provider: 'webdav',
        remotePath: '/music/one.flac',
        stableKey: 'stable-1',
        title: 'Remote One',
      }),
    ]);
    vi.mocked(window.echo.remoteSources.list).mockResolvedValue([
      makeRemoteSource('source-1', 'AList One'),
      makeRemoteSource('source-2', 'AList Two'),
    ]);

    await renderSongsPage();
    await screen.findByText('Remote One');
    fireEvent.click(await screen.findByRole('button', { name: 'All cloud sources' }));
    fireEvent.click(screen.getByRole('option', { name: 'AList Two' }));

    await waitFor(() =>
      expect(window.echo.library.getTracks).toHaveBeenLastCalledWith(
        expect.objectContaining({ sourceProvider: 'remote', sourceId: 'source-2' }),
      ),
    );
  });

  it('does not hydrate visible rows while the local source mode is active', async () => {
    const tracks = [
      makeTrack({ id: 'track-1', title: 'Song One' }),
      makeTrack({ id: 'track-2', title: 'Song Two' }),
    ];
    installEcho(tracks);

    await renderSongsPage();
    await screen.findByText('Song One');
    fireEvent.click(screen.getByRole('button', { name: 'mock-visible' }));
    await new Promise((resolve) => setTimeout(resolve, 260));

    expect(window.echo.remoteSources.hydrateVisibleTracks).not.toHaveBeenCalled();
  });

  it('keeps TrackList totalCount stable when appending the second song page', async () => {
    const firstPageTracks = Array.from({ length: 100 }, (_, index) => makeTrack({ id: `track-${index + 1}`, title: `Song ${index + 1}` }));
    const secondPageTracks = Array.from({ length: 100 }, (_, index) => makeTrack({ id: `track-${index + 101}`, title: `Song ${index + 101}` }));
    installEcho();
    vi.mocked(window.echo.library.getTracks)
      .mockResolvedValueOnce(makePagedResult(firstPageTracks, { page: 1, total: 10000, hasMore: true }))
      .mockResolvedValueOnce(makePagedResult(secondPageTracks, { page: 2, total: 10000, hasMore: true }));

    await renderSongsPage();
    await waitFor(() => expect(screen.getByTestId('track-list').getAttribute('data-loaded-count')).toBe('100'));

    fireEvent.click(screen.getByRole('button', { name: 'mock-load-more' }));

    await waitFor(() => expect(screen.getByTestId('track-list').getAttribute('data-loaded-count')).toBe('200'));
    expect(screen.getByTestId('track-list').getAttribute('data-total-count')).toBe('10000');
    expect(window.echo.library.getTracks).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
    expect(window.echo.library.getDuplicateTrackVersions).not.toHaveBeenCalled();
  });

  it('preserved library:changed refreshes the song list without losing scroll', async () => {
    installEcho([makeTrack({ id: 'track-1', title: 'Song One' })]);
    vi.mocked(window.echo.library.getTracks)
      .mockResolvedValueOnce(makePagedResult([makeTrack({ id: 'track-1', title: 'Song One' })]))
      .mockResolvedValueOnce(makePagedResult([makeTrack({ id: 'track-2', title: 'Song Two' })]));

    await renderSongsPage();
    await screen.findByText('Song One');
    const trackList = screen.getByTestId('track-list');
    trackList.scrollTop = 640;

    window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));

    await waitFor(() => expect(window.echo.library.getTracks).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Song Two')).toBeTruthy();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(trackList.scrollTop).toBe(640);
  });

  it('keeps the song list scroll position after saving tags from the context menu', async () => {
    const originalTrack = makeTrack({ id: 'track-1', title: 'Song One' });
    const updatedTrack = makeTrack({ id: 'track-1', title: 'Song One Edited' });
    installEcho([originalTrack]);
    vi.mocked(window.echo.library.updateTrackTags).mockResolvedValue(updatedTrack);

    await renderSongsPage();
    await screen.findByText('Song One');
    const trackList = screen.getByTestId('track-list');

    const row = await screen.findByRole('button', { name: 'Song One' });
    fireEvent.contextMenu(row, { clientX: 240, clientY: 180 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit tags' }));
    trackList.scrollTop = 640;
    vi.mocked(window.echo.library.getTracks).mockResolvedValueOnce(makePagedResult([updatedTrack]));
    fireEvent.click(await screen.findByRole('button', { name: '保存标签' }));

    await waitFor(() => expect(window.echo.library.updateTrackTags).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.echo.library.getTracks).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(trackList.scrollTop).toBe(640);
  });

  it('closes the duplicate version panel when clicking the overlay outside the panel', async () => {
    const track = makeTrack();
    const hiddenTrack = makeTrack({ id: 'track-2', path: 'D:\\Music\\Song Copy.flac' });
    installEcho([track]);
    vi.mocked(window.echo.library.getDuplicateHiddenCounts).mockResolvedValue({ [track.id]: 1 });
    vi.mocked(window.echo.library.getDuplicateTrackVersions).mockResolvedValue([
      { groupId: 'group-1', track, qualityScore: 100, rank: 1, hidden: false, reasons: [] },
      { groupId: 'group-1', track: hiddenTrack, qualityScore: 80, rank: 2, hidden: true, reasons: [] },
    ]);

    await renderSongsPage();
    await screen.findByText('Song One');
    fireEvent.click(screen.getByRole('button', { name: 'mock-visible' }));

    fireEvent.click(await screen.findByRole('button', { name: /版本/ }));
    const dialog = await screen.findByRole('dialog', { name: '重复歌曲版本' });

    fireEvent.click(screen.getByText('Duplicate Track Merge View'));
    expect(screen.queryByRole('dialog', { name: '重复歌曲版本' })).not.toBeNull();

    fireEvent.click(dialog);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '重复歌曲版本' })).toBeNull());
  });
});
