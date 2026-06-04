// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryPage, LibraryTrack } from '../../shared/types/library';
import type { RemoteSource } from '../../shared/types/remoteSources';
import {
  createSongsFirstPageSnapshotQueryKey,
  readSongsStartupLoadDiagnostics,
  writeSongsFirstPageSnapshot,
} from '../stores/songsFirstPageSnapshot';

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
  const { PlaybackQueueProvider } = await import('../stores/PlaybackQueueProvider');
  const { I18nProvider } = await import('../i18n/I18nProvider');
  render(
    <I18nProvider>
      <PlaybackQueueProvider>
        <SongsPage />
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
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
    },
    audio: {
      getStatus: vi.fn(),
      listDevices: vi.fn(),
      setOutput: vi.fn(),
    },
    remoteSources: {
      list: vi.fn().mockResolvedValue([]),
      hydrateVisibleTracks: vi.fn().mockResolvedValue([]),
    },
  } as unknown as Window['echo'];

  return { playLocalFile };
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
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
    fireEvent.mouseEnter(screen.getAllByRole('menuitem')[0]);
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

    await renderSongsPage();

    const row = await screen.findByRole('button', { name: 'Song One' });
    fireEvent.contextMenu(row, { clientX: 240, clientY: 180 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'osu! Timing' }));

    expect(await screen.findByRole('dialog', { name: 'osu! Timing' })).toBeTruthy();
    expect(screen.getByText('12,468.75,4,1,0,100,1,0')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '复制 timing 行' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('12,468.75,4,1,0,100,1,0'));
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
    fireEvent.click(screen.getByRole('button', { name: '扫描失效歌曲、短音频并增量扫描' }));

    await waitFor(() => expect(window.echo.library.pruneInvalidTracks).toHaveBeenCalledTimes(1));
    expect(window.echo.library.scanFolder).not.toHaveBeenCalled();
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
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'source-2' } });

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
    await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(6));
    fireEvent.click(screen.getAllByRole('menuitem')[6]);
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
