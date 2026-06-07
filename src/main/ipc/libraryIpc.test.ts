import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type {
  LibraryDatabaseProtectionStatus,
  LibraryDatabaseRepairResult,
  LibraryDatabaseRestoreResult,
  LibraryAllUserDataDeleteResult,
  LibraryHealthReport,
  LibraryPlaylist,
} from '../../shared/types/library';
import type { RemoteBackgroundGlobalStatus, RemoteSource } from '../../shared/types/remoteSources';

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const handleMock = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers[channel] = handler;
});
const showOpenDialogMock = vi.fn();
const showSaveDialogMock = vi.fn();
const writeImageMock = vi.fn();
const createFromBufferMock = vi.fn(() => ({ isEmpty: () => false }));
const createFromPathMock = vi.fn(() => ({ isEmpty: () => false }));
const openPathMock = vi.fn();
const showItemInFolderMock = vi.fn();
const trashItemMock = vi.fn();
const getLibraryServiceMock = vi.fn();
const remoteSourceServiceMock = vi.hoisted(() => ({
  listSources: vi.fn<() => RemoteSource[]>(() => []),
  getBackgroundGlobalStatus: vi.fn<() => RemoteBackgroundGlobalStatus>(() => ({
    paused: false,
    playbackActive: false,
    concurrency: {
      metadata: 0,
      cover: 0,
      lyrics: 0,
      mv: 0,
      'duration-backfill': 0,
    },
    updatedAt: null,
  })),
}));
const closeDatabaseUserMocks = vi.hoisted(() => ({
  library: vi.fn(),
  remote: vi.fn(),
  lyrics: vi.fn(),
  mv: vi.fn(),
  streaming: vi.fn(),
}));
const appLifecycleMocks = vi.hoisted(() => ({
  relaunch: vi.fn(),
  quit: vi.fn(),
}));
const databaseManagerMock = vi.hoisted(() => ({
  closeAllUsers: vi.fn(),
  getState: vi.fn(() => ({
    databasePath: 'D:\\UserData\\echo-library.sqlite',
    openConnections: 0,
    connectionServiceNames: [],
    maintenanceInProgress: false,
    activeMaintenanceReason: null,
    lastCloseReason: null,
    lastCheckpointAt: null,
    lastCheckpointReason: null,
    lastCheckpointHealth: null,
    protected: false,
    protectionRecoveryAction: null,
  })),
  runExclusiveMaintenance: vi.fn((_reason: string, action: () => unknown) => Promise.resolve().then(action)),
}));
const downloadServiceMock = vi.hoisted(() => ({
  dispose: vi.fn(),
  getSettings: vi.fn(() => ({ outputDirectory: null })),
}));
const appSettingsMock = vi.hoisted(() => ({
  current: {
    networkMetadataEnabled: false,
    networkMetadataProviders: ['netease-cloud-music', 'qq-music'],
  },
}));
const osuArchiveImportMock = vi.hoisted(() => ({
  importOsuArchiveAsMp3Queued: vi.fn(async (request: { outputDirectory: string }) => ({
    outputPath: `${request.outputDirectory}\\Artist - Song.mp3`,
    metadata: {
      audioFilename: 'audio.mp3',
      coverFilename: 'bg.jpg',
      title: 'Song',
      artist: 'Artist',
      creator: 'Mapper',
      version: 'Hard',
      beatmapSetId: '2492872',
    },
    coverData: null,
    tags: {
      title: 'Song',
      artist: 'Artist',
      album: 'osu! beatmapset 2492872',
      albumArtist: 'Artist',
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
    },
  })),
  isOsuArchivePath: (path: string) => path.toLowerCase().endsWith('.osz'),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'downloads' ? 'D:\\Downloads' : 'D:\\UserData')),
    relaunch: appLifecycleMocks.relaunch,
    quit: appLifecycleMocks.quit,
  },
  ipcMain: {
    handle: handleMock,
  },
  clipboard: {
    writeImage: writeImageMock,
    writeText: vi.fn(),
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
    showSaveDialog: showSaveDialogMock,
  },
  nativeImage: {
    createFromBuffer: createFromBufferMock,
    createFromPath: createFromPathMock,
  },
  shell: {
    openPath: openPathMock,
    showItemInFolder: showItemInFolderMock,
    trashItem: trashItemMock,
  },
}));

vi.mock('../library/LibraryService', () => ({
  getLibraryService: getLibraryServiceMock,
  closeDefaultLibraryService: closeDatabaseUserMocks.library,
}));

vi.mock('../library/OsuArchiveImport', () => osuArchiveImportMock);

vi.mock('../library/remote/RemoteSourceService', () => ({
  closeDefaultRemoteSourceService: closeDatabaseUserMocks.remote,
  getRemoteSourceService: () => remoteSourceServiceMock,
}));

vi.mock('../lyrics/LyricsService', () => ({
  closeDefaultLyricsService: closeDatabaseUserMocks.lyrics,
}));

vi.mock('../mv/MvService', () => ({
  closeDefaultMvService: closeDatabaseUserMocks.mv,
}));

vi.mock('../streaming/StreamingService', () => ({
  closeDefaultStreamingService: closeDatabaseUserMocks.streaming,
  getStreamingService: vi.fn(),
}));

vi.mock('../app/appSettings', () => ({
  getAppSettings: () => appSettingsMock.current,
}));

vi.mock('../database/LibraryDatabaseManager', () => ({
  getLibraryDatabaseManager: () => databaseManagerMock,
}));

vi.mock('../downloads/DownloadService', () => ({
  getDownloadService: () => downloadServiceMock,
}));

const resetHandlers = (): void => {
  for (const key of Object.keys(handlers)) {
    delete handlers[key];
  }
};

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-library-ipc-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const createHealthyLibrary = (root: string): void => {
  const database = new Database(join(root, 'echo-library.sqlite'));
  database.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, title TEXT)');
  database.prepare('INSERT INTO tracks (id, title) VALUES (?, ?)').run('track-1', 'Song');
  database.close();
};

const installLibraryService = () => {
  const track = {
    id: 'track-1',
    path: 'D:\\Music\\song.flac',
    title: '星灯',
    artist: 'Suara',
    album: 'Music',
    albumArtist: 'Suara',
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration: 1,
    codec: 'FLAC',
    sampleRate: 44100,
    bitDepth: 16,
    bitrate: 1000,
    coverId: null as string | null,
    coverThumb: null as string | null,
    fieldSources: {},
  };
  const service = {
    getTrack: vi.fn((_trackId?: string) => track),
    getPlaylist: vi.fn<() => LibraryPlaylist>(() => ({
      id: 'playlist-1',
      name: 'Export Mix',
      description: 'For export',
      kind: 'manual',
      sourceProvider: 'local',
      sourcePlaylistId: null,
      coverId: null,
      coverThumb: null,
      sortMode: 'manual',
      itemCount: 2,
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    })),
    getPlaylistItems: vi.fn(() => ({
      items: [
        {
          id: 'item-1',
          playlistId: 'playlist-1',
          mediaType: 'track',
          mediaId: 'track-1',
          sourceProvider: 'local',
          sourceItemId: null,
          titleSnapshot: 'Local, Song',
          artistSnapshot: 'Suara',
          albumSnapshot: 'Music',
          durationSnapshot: 123,
          coverId: null,
          coverThumb: null,
          position: 0,
          addedAt: '2026-05-14T00:00:00.000Z',
          addedFrom: 'manual',
          unavailable: false,
          track,
        },
        {
          id: 'item-2',
          playlistId: 'playlist-1',
          mediaType: 'stream_track',
          mediaId: 'stream-1',
          sourceProvider: 'netease',
          sourceItemId: 'song-1',
          titleSnapshot: 'Stream "Song"',
          artistSnapshot: 'Net Artist',
          albumSnapshot: 'Net Album',
          durationSnapshot: 456,
          coverId: null,
          coverThumb: null,
          position: 1,
          addedAt: '2026-05-14T00:00:01.000Z',
          addedFrom: 'streaming-playlist',
          unavailable: false,
          track: null,
        },
      ],
      page: 1,
      pageSize: 500,
      total: 2,
      hasMore: false,
    })),
    getLikedSongsPlaylist: vi.fn(() => ({
      id: 'liked-tracks',
      name: '喜欢的歌曲',
      description: null,
      kind: 'system',
      sourceProvider: 'local',
      sourcePlaylistId: null,
      coverId: null,
      coverThumb: null,
      sortMode: 'manual',
      itemCount: 2,
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    })),
    getLikedTracks: vi.fn((query?: { sourceProvider?: string }) => ({
      items: [
        {
          id: 'liked-item-1',
          playlistId: 'liked-tracks',
          mediaType: 'stream_track',
          mediaId: 'stream-qq-1',
          sourceProvider: 'qqmusic',
          sourceItemId: 'qq-song-1',
          titleSnapshot: 'QQ Song',
          artistSnapshot: 'QQ Artist',
          albumSnapshot: 'QQ Album',
          durationSnapshot: 321,
          coverId: null,
          coverThumb: null,
          position: 0,
          addedAt: '2026-05-14T00:00:00.000Z',
          addedFrom: 'qqmusic-liked-sync',
          unavailable: false,
          track: null,
        },
      ].filter((item) => !query?.sourceProvider || item.sourceProvider === query.sourceProvider),
      page: 1,
      pageSize: 500,
      total: query?.sourceProvider === 'qqmusic' ? 1 : 0,
      hasMore: false,
    })),
    createPlaylist: vi.fn((request: { name: string }) => ({
      id: 'playlist-imported',
      name: request.name,
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
    })),
    resolveCoverAsset: vi.fn<(_coverId?: string, _variant?: string) => { filePath: string; mimeType: string } | null>(() => null),
    addFolder: vi.fn(),
    getFolders: vi.fn(),
    getFolderOverviews: vi.fn(() => []),
    getFolderChildren: vi.fn(() => []),
    getFolderTracks: vi.fn(() => ({ items: [], page: 1, pageSize: 100, total: 0, hasMore: false })),
    resolveLibraryFolderPath: vi.fn(() => 'D:\\Music'),
    importAudioFile: vi.fn(async (path: string) => ({ id: `track-${path}`, path })),
    addTracksToPlaylist: vi.fn((_playlistId: string, trackIds: string[]) =>
      trackIds.map((trackId, index) => ({
        id: `item-${index + 1}`,
        playlistId: 'playlist-1',
        mediaType: 'track',
        mediaId: trackId,
        sourceProvider: 'local',
        sourceItemId: null,
        titleSnapshot: `Song ${index + 1}`,
        artistSnapshot: 'Artist',
        albumSnapshot: 'Album',
        durationSnapshot: 120,
        coverId: null,
        coverThumb: null,
        position: index,
        addedAt: '2026-05-18T00:00:00.000Z',
        addedFrom: 'library',
        unavailable: false,
        track: null,
      })),
    ),
    removeFolder: vi.fn(),
    scanFolder: vi.fn(),
    getScanStatus: vi.fn(),
    cancelScan: vi.fn(),
    getTracks: vi.fn(() => ({ items: [], page: 1, pageSize: 50, total: 0, hasMore: false })),
    getLibraryQualityOverview: vi.fn(() => []),
    getLibraryQualityIssues: vi.fn((query: unknown) => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasMore: false,
      kind: (query as { kind?: string }).kind,
    })),
    getLibraryInboxBatches: vi.fn(() => []),
    getLibraryInboxTracks: vi.fn((query: unknown) => ({
      items: [],
      page: 1,
      pageSize: 60,
      total: 0,
      hasMore: false,
      batches: [],
      selectedBatch: null,
      scope: (query as { scope?: string }).scope ?? 'latest',
      filter: (query as { filter?: string }).filter ?? 'all',
      status: (query as { status?: string }).status ?? 'all',
      story: {
        trackCount: 0,
        albumCount: 0,
        artistCount: 0,
        folderCount: 0,
        missingCoverCount: 0,
        metadataIssueCount: 0,
        unknownArtistCount: 0,
        unknownAlbumCount: 0,
        suspiciousCount: 0,
        pendingCount: 0,
        processedCount: 0,
        ignoredCount: 0,
        coverCompleteness: 0,
        metadataCompleteness: 0,
        totalDuration: 0,
        topFolders: [],
        topArtists: [],
      },
      albums: [],
      facets: { folders: [], albums: [], artists: [] },
    })),
    createPlaylistFromLibraryInbox: vi.fn(() => ({
      playlist: { id: 'playlist-1', name: 'Inbox', description: null, kind: 'manual', sourceProvider: 'local', sourcePlaylistId: null, coverId: null, coverThumb: null, coverUrl: null, sortMode: 'manual', itemCount: 1, createdAt: '2026-05-20T00:00:00.000Z', updatedAt: '2026-05-20T00:00:00.000Z' },
      addedCount: 1,
      matchedCount: 1,
      skippedCount: 0,
      truncated: false,
      limit: 1000,
    })),
    getLibraryInboxQueueTracks: vi.fn(() => ({
      tracks: [],
      addedCount: 0,
      matchedCount: 0,
      skippedCount: 0,
      truncated: false,
      limit: 1000,
    })),
    updateLibraryInboxItemState: vi.fn(() => ({
      updatedCount: 1,
      matchedCount: 1,
      skippedCount: 0,
      truncated: false,
      limit: 1000,
    })),
    refreshDuplicateTracks: vi.fn((mode = 'strict') => ({
      mode,
      totalTracksScanned: 0,
      duplicateGroups: 0,
      duplicateMembers: 0,
      hiddenTracks: 0,
      updatedAt: '2026-05-20T00:00:00.000Z',
    })),
    refreshDuplicateTracksAsync: vi.fn((mode = 'strict') => Promise.resolve({
      mode,
      totalTracksScanned: 0,
      duplicateGroups: 0,
      duplicateMembers: 0,
      hiddenTracks: 0,
      updatedAt: '2026-05-20T00:00:00.000Z',
    })),
    refreshDuplicateTracksPlaybackSafe: vi.fn((mode = 'strict') => Promise.resolve({
      mode,
      totalTracksScanned: 0,
      duplicateGroups: 0,
      duplicateMembers: 0,
      hiddenTracks: 0,
      updatedAt: '2026-05-20T00:00:00.000Z',
    })),
    getDuplicateHiddenCounts: vi.fn(() => ({ 'track-1': 1, 'track-2': 0 })),
    getDuplicateIndexSummary: vi.fn((mode = 'strict') => ({
      mode,
      totalTracksScanned: 0,
      duplicateGroups: 0,
      duplicateMembers: 0,
      hiddenTracks: 0,
      updatedAt: '2026-05-20T00:00:00.000Z',
    })),
    previewDuplicateTrackCleanup: vi.fn((mode = 'strict') => ({
      summary: {
        mode,
        totalTracksScanned: 0,
        duplicateGroups: 0,
        duplicateMembers: 0,
        hiddenTracks: 0,
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
      groups: [] as unknown[],
      removeTrackIds: [] as string[],
      totalTracksToRemove: 0,
      totalBytesToRemove: 0,
      generatedAt: '2026-05-20T00:00:00.000Z',
    })),
    getDuplicateTrackCleanupPreview: vi.fn((mode = 'strict') => ({
      summary: {
        mode,
        totalTracksScanned: 0,
        duplicateGroups: 0,
        duplicateMembers: 0,
        hiddenTracks: 0,
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
      groups: [] as unknown[],
      removeTrackIds: [] as string[],
      totalTracksToRemove: 0,
      totalBytesToRemove: 0,
      generatedAt: '2026-05-20T00:00:00.000Z',
    })),
    getAlbums: vi.fn(),
    getAlbum: vi.fn(),
    getAlbumForTrack: vi.fn(),
    getArtists: vi.fn(),
    getArtist: vi.fn(),
    getArtistInsights: vi.fn(() => ({
      artist: null,
      nodes: [],
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
    })),
    getArtistTracks: vi.fn(),
    getArtistAlbums: vi.fn(),
    enqueueMissingArtistImages: vi.fn(() => ({ queued: 0, skipped: 0 })),
    refreshArtistImage: vi.fn(async () => ({ queued: true, entry: null })),
    refreshVisibleArtistImages: vi.fn(() => ({ queued: 0, skipped: 0 })),
    getArtistImage: vi.fn(() => null),
    getArtistImageCacheSummary: vi.fn(() => ({ total: 0, matched: 0, pending: 0, loading: 0, notFound: 0, error: 0, rateLimited: 0 })),
    getArtistImageJobStatus: vi.fn(() => ({
      paused: false,
      running: false,
      queued: 0,
      active: 0,
      lastQueued: { queued: 0, skipped: 0 },
      summary: { total: 0, matched: 0, pending: 0, loading: 0, notFound: 0, error: 0, rateLimited: 0 },
    })),
    setArtistImageJobsPaused: vi.fn(() => ({
      paused: true,
      running: false,
      queued: 0,
      active: 0,
      lastQueued: { queued: 0, skipped: 0 },
      summary: { total: 0, matched: 0, pending: 0, loading: 0, notFound: 0, error: 0, rateLimited: 0 },
    })),
    clearArtistOnlineInfoCache: vi.fn(() => ({ removedRows: 0 })),
    kickoffArtistImageBackfill: vi.fn(() => ({
      paused: false,
      running: true,
      queued: 2,
      active: 0,
      lastQueued: { queued: 2, skipped: 0 },
      summary: { total: 2, matched: 0, pending: 2, loading: 0, notFound: 0, error: 0, rateLimited: 0 },
    })),
    clearArtistImageCache: vi.fn(() => ({ removedRows: 0, deletedFiles: 0, freedBytes: 0 })),
    setCustomArtistImageFromFile: vi.fn(async () => null),
    setCustomArtistImageFromUrl: vi.fn(async () => null),
    clearCustomArtistImage: vi.fn(() => null),
    getAlbumTracks: vi.fn(),
    getSummary: vi.fn(() => ({ songCount: 2, albumCount: 1, artistCount: 2, folderCount: 1, totalDuration: 2, lastScanAt: null })),
    refreshAlbumGrouping: vi.fn(() => ({ songCount: 2, albumCount: 1, artistCount: 2, folderCount: 1, totalDuration: 2, lastScanAt: null })),
    refreshAlbumGroupingPlaybackSafe: vi.fn(() => Promise.resolve({
      songCount: 2,
      albumCount: 1,
      artistCount: 2,
      folderCount: 1,
      totalDuration: 2,
      lastScanAt: null,
    })),
    getDiagnostics: vi.fn(() => ({
      foldersCount: 1,
      tracksCount: 2,
      albumsCount: 1,
      artistsCount: 2,
      coversCount: 0,
      lastScan: null,
      lastQueryMs: {
        getTracks: null,
        getAlbums: null,
      },
      averageAlbumPayloadBytes: null,
      databasePath: 'D:\\UserData\\echo-library.sqlite',
      databaseSizeBytes: 4096,
      coverCachePath: 'D:\\UserData\\covers',
      coverCacheSizeBytes: 0,
      coverCacheVersion: 2,
      cpuCount: 4,
      scanPerformanceMode: 'balanced',
      metadataConcurrency: 2,
      coverConcurrency: 2,
      groupingRefreshQueued: false,
      lastGroupingRefreshError: null,
    })),
    getCoverCacheDir: vi.fn(() => 'D:\\UserData\\covers'),
    getLibraryLabState: vi.fn(() => ({
      watcherEnabled: false,
      watcherRunning: false,
      autoRescanEnabled: false,
      moveCandidateEnabled: false,
      moveRepairLabEnabled: false,
      watchedFolderCount: 0,
      totalEventCount: 0,
      pendingPathCount: 0,
      triggeredRescanCount: 0,
      droppedPathCount: 0,
      skippedDeleteEventCount: 0,
      skippedRenameEventCount: 0,
      lastTriggeredRescanAt: null,
      lastRescanError: null,
      watcherLastError: null,
      lastWatcherEventAt: null,
      lastRescanStartedAt: null,
      lastRescanFinishedAt: null,
      lastRescanPathCount: 0,
      lastMetadataBackfillCount: 0,
      placeholderTrackCount: 0,
      lastSkippedByCacheCount: 0,
      moveCandidateCount: 0,
      highConfidenceCount: 0,
      mediumConfidenceCount: 0,
      lowConfidenceCount: 0,
      ambiguousCount: 0,
      lastMoveRepairAt: null,
      lastMoveRepairError: null,
      groupingRefreshQueued: false,
      lastGroupingRefreshDurationMs: null,
      lastGroupingRefreshAt: null,
      groupingRefreshDelayedForPlaybackCount: 0,
      lastGroupingRefreshError: null,
      recentWatcherEvents: [],
    })),
    clearCache: vi.fn(() => ({ scannedCount: 1, removedCount: 1, deletedCoverCacheFiles: 2, freedCoverCacheBytes: 128 })),
    hasRunningJobs: vi.fn(() => false),
    updateTrackTags: vi.fn(),
    searchNetworkTagCandidates: vi.fn(async () => []),
    getActiveMissingCoverBackfillStatus: vi.fn<() => unknown>(() => null),
    recordTrackPlayback: vi.fn(),
    getPlaybackStatsDashboardPlaybackSafe: vi.fn(() => Promise.resolve({
      generatedAt: '2026-05-20T00:00:00.000Z',
      totals: {
        playCount: 0,
        completedCount: 0,
        playedSeconds: 0,
        uniqueTracks: 0,
        uniqueArtists: 0,
      },
      topTracks: [],
      topArtists: [],
      topAlbums: [],
      formatBreakdown: [],
      qualityBreakdown: [],
      dailyActivity: [],
    })),
    deleteTrack: vi.fn(),
    deleteTracks: vi.fn((trackIds: string[]) => trackIds.length),
    resolveLyricsBackgroundCover: vi.fn(async () => ({
      coverUrl: 'echo-image://remote/cover',
      provider: 'netease-cloud-music',
      confidence: 0.96,
    })),
  };

  getLibraryServiceMock.mockReturnValue(service);
  return service;
};

describe('library IPC', () => {
  beforeEach(async () => {
    resetHandlers();
    handleMock.mockClear();
    showOpenDialogMock.mockReset();
    showSaveDialogMock.mockReset();
    writeImageMock.mockReset();
    createFromBufferMock.mockClear();
    createFromPathMock.mockClear();
    openPathMock.mockReset();
    showItemInFolderMock.mockReset();
    trashItemMock.mockReset();
    getLibraryServiceMock.mockReset();
    remoteSourceServiceMock.listSources.mockReset();
    remoteSourceServiceMock.getBackgroundGlobalStatus.mockReset();
    remoteSourceServiceMock.listSources.mockReturnValue([]);
    remoteSourceServiceMock.getBackgroundGlobalStatus.mockReturnValue({
      paused: false,
      playbackActive: false,
      concurrency: {
        metadata: 0,
        cover: 0,
        lyrics: 0,
        mv: 0,
        'duration-backfill': 0,
      },
      updatedAt: null,
    });
    Object.values(closeDatabaseUserMocks).forEach((mock) => mock.mockReset());
    appLifecycleMocks.relaunch.mockReset();
    appLifecycleMocks.quit.mockReset();
    databaseManagerMock.closeAllUsers.mockReset();
    databaseManagerMock.getState.mockClear();
    databaseManagerMock.runExclusiveMaintenance.mockClear();
    databaseManagerMock.runExclusiveMaintenance.mockImplementation((_reason: string, action: () => unknown) => Promise.resolve().then(action));
    downloadServiceMock.dispose.mockReset();
    downloadServiceMock.getSettings.mockReset();
    downloadServiceMock.getSettings.mockReturnValue({ outputDirectory: null });
    osuArchiveImportMock.importOsuArchiveAsMp3Queued.mockClear();
    const { app } = await import('electron');
    vi.mocked(app.getPath).mockImplementation((name: string) => (name === 'downloads' ? 'D:\\Downloads' : 'D:\\UserData'));
    appSettingsMock.current = {
      networkMetadataEnabled: false,
      networkMetadataProviders: ['netease-cloud-music', 'qq-music'],
    };
    installLibraryService();
    const module = await import('./libraryIpc');
    module.registerLibraryIpc();
  });

  it('returns null when choose folder is cancelled', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await handlers[IpcChannels.LibraryChooseFolder]!();

    expect(result).toBeNull();
  });

  it('returns the selected folder path when choose folder succeeds', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['D:\\Music'] });

    const result = await handlers[IpcChannels.LibraryChooseFolder]!();

    expect(result).toBe('D:\\Music');
  });

  it('chooses audio and osu archive files for import', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['D:\\Music\\song.mp3', 'D:\\Maps\\beatmap.osz'] });

    const result = await handlers[IpcChannels.LibraryChooseImportFiles]!();

    expect(result).toEqual(['D:\\Music\\song.mp3', 'D:\\Maps\\beatmap.osz']);
    expect(showOpenDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: ['openFile', 'multiSelections'],
        filters: [expect.objectContaining({ extensions: expect.arrayContaining(['mp3', 'osz']) })],
      }),
    );
  });

  it('allows manual network tag candidate search while automatic network metadata is disabled', async () => {
    const service = installLibraryService();

    await handlers[IpcChannels.LibrarySearchNetworkTagCandidates]!(null, { trackId: 'track-1' });

    expect(service.searchNetworkTagCandidates).toHaveBeenCalledWith({
      trackId: 'track-1',
      query: undefined,
      providers: ['netease-cloud-music', 'qq-music'],
    });
  });

  it('returns the active missing-cover backfill job without starting a new one', async () => {
    const service = installLibraryService();
    service.getActiveMissingCoverBackfillStatus.mockReturnValue({
      id: 'cover-job-1',
      status: 'running',
      fields: ['cover'],
      totalTracks: 20,
      processedTracks: 5,
      scannedCount: 5,
      candidateCount: 2,
      items: [],
      errors: [],
      diagnostics: {
        targetCount: 10,
        providerErrors: 0,
        noCandidateCount: 0,
        protectedCount: 0,
        appliedCount: 1,
      },
      startedAt: '2026-06-07T00:00:00.000Z',
      finishedAt: null,
      currentTrackTitle: 'Song',
    });

    const result = await handlers[IpcChannels.LibraryNetworkGetActiveMissingCoverBackfillStatus]!();

    expect(service.getActiveMissingCoverBackfillStatus).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: 'cover-job-1', status: 'running' });
  });

  it('normalizes library quality issue queries to local bounded pages', async () => {
    const service = installLibraryService();

    await handlers[IpcChannels.LibraryGetQualityIssues]!(null, {
      kind: 'missing_cover',
      page: 2.8,
      pageSize: 999,
      sourceProvider: 'local',
      search: 'needle',
    });

    expect(service.getLibraryQualityIssues).toHaveBeenCalledWith({
      kind: 'missing_cover',
      page: 2,
      pageSize: 100,
      sourceProvider: 'local',
      search: 'needle',
    });
  });

  it('rejects unsupported library quality issue kinds and remote source filters', async () => {
    expect(() => handlers[IpcChannels.LibraryGetQualityIssues]!(null, { kind: 'bad-kind' })).toThrow(
      'library quality issue kind must be supported',
    );
    expect(() => handlers[IpcChannels.LibraryGetQualityIssues]!(null, { kind: 'missing_cover', sourceProvider: 'remote' })).toThrow(
      'library quality dashboard currently supports local sourceProvider only',
    );
  });

  it('normalizes new-songs inbox queries to bounded local pages', async () => {
    const service = installLibraryService();

    await handlers[IpcChannels.LibraryGetInboxTracks]!(null, {
      scope: 'all',
      filter: 'metadata_issue',
      status: 'pending',
      page: 3.9,
      pageSize: 999,
      folderId: ' folder-1 ',
      album: ' Album ',
      artist: ' Artist ',
      search: 'needle',
    });

    expect(service.getLibraryInboxTracks).toHaveBeenCalledWith({
      scope: 'all',
      filter: 'metadata_issue',
      status: 'pending',
      page: 3,
      pageSize: 100,
      folderId: 'folder-1',
      album: 'Album',
      artist: 'Artist',
      batchId: null,
      search: 'needle',
    });
  });

  it('normalizes inbox queue requests through the library service', async () => {
    const service = installLibraryService();

    await handlers[IpcChannels.LibraryAddInboxToQueue]!(null, {
      scope: 'latest',
      filter: 'suspicious_file',
      status: 'ignored',
      pageSize: 999,
    });

    expect(service.getLibraryInboxQueueTracks).toHaveBeenCalledWith({
      scope: 'latest',
      filter: 'suspicious_file',
      status: 'ignored',
      batchId: null,
      folderId: null,
      album: null,
      artist: null,
      page: undefined,
      pageSize: 100,
      search: undefined,
    });
  });

  it('routes new-songs inbox playlist creation through the library service', async () => {
    const service = installLibraryService();

    await handlers[IpcChannels.LibraryCreateInboxPlaylist]!(null, {
      scope: 'batch',
      batchId: ' batch-1 ',
      filter: 'missing_cover',
      name: ' Inbox Picks ',
      page: 99,
      pageSize: 999,
    });

    expect(service.createPlaylistFromLibraryInbox).toHaveBeenCalledWith({
      scope: 'batch',
      filter: 'missing_cover',
      batchId: 'batch-1',
      folderId: null,
      album: null,
      artist: null,
      page: 99,
      pageSize: 100,
      search: undefined,
      name: 'Inbox Picks',
    });
  });

  it('normalizes inbox state updates through the library service', async () => {
    const service = installLibraryService();

    await handlers[IpcChannels.LibraryUpdateInboxItemState]!(null, {
      status: 'ignored',
      items: [
        { batchId: ' batch-1 ', trackId: ' track-1 ' },
        { batchId: '', trackId: 'track-2' },
      ],
      query: { scope: 'all', status: 'pending' },
    });

    expect(service.updateLibraryInboxItemState).toHaveBeenCalledWith({
      status: 'ignored',
      items: [{ batchId: 'batch-1', trackId: 'track-1' }],
      query: {
        scope: 'all',
        status: 'pending',
        batchId: null,
        folderId: null,
        album: null,
        artist: null,
        page: undefined,
        pageSize: undefined,
        search: undefined,
      },
    });
  });

  it('returns and exports a sanitized library health report', async () => {
    const root = makeTempRoot();
    const exportPath = join(root, 'health.md');
    const { app } = await import('electron');
    vi.mocked(app.getPath).mockImplementation((name: string) => (name === 'downloads' ? root : root));
    createHealthyLibrary(root);
    const service = installLibraryService();
    service.getDiagnostics.mockReturnValue({
      ...service.getDiagnostics(),
      databasePath: join(root, 'echo-library.sqlite'),
      coverCachePath: join(root, 'covers'),
    });
    service.getCoverCacheDir.mockReturnValue(join(root, 'covers'));
    remoteSourceServiceMock.listSources.mockReturnValue([
      {
        id: 'remote-1',
        provider: 'webdav',
        displayName: 'NAS',
        status: 'enabled',
        baseUrl: 'https://example.invalid/token=secret',
        username: 'secret-user',
        authType: 'token',
        config: { secret: 'do-not-export' },
        syncMode: 'index',
        lastTestAt: null,
        lastSyncAt: null,
        lastError: 'token=secret',
        indexedTrackCount: 5,
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
    ]);
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: exportPath });

    const report = await handlers[IpcChannels.LibraryGetHealthReport]!() as LibraryHealthReport;
    expect(report.database.databasePath?.basename).toBe('echo-library.sqlite');
    expect(report.remoteSources).toMatchObject({ total: 1, enabled: 1, indexedTrackCount: 5 });

    const result = await handlers[IpcChannels.LibraryExportHealthReport]!();
    const markdown = readFileSync(result as string, 'utf8');

    expect(result).toBe(exportPath);
    expect(markdown).toContain('ECHO Next 曲库体检报告');
    expect(markdown).not.toContain(root);
    expect(markdown).not.toContain('token=secret');
    expect(markdown).not.toContain('do-not-export');
  });

  it('saves dropped audio files to downloads and imports them', async () => {
    const root = makeTempRoot();
    const { app } = await import('electron');
    vi.mocked(app.getPath).mockReturnValue(root);

    const result = await handlers[IpcChannels.LibraryImportDroppedFiles]!(null, [
      { name: 'song.flac', type: 'audio/flac', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'cover.jpg', type: 'image/jpeg', bytes: new Uint8Array([4, 5, 6]) },
    ]);

    expect(result).toMatchObject({
      importedCount: 1,
      ignoredCount: 1,
      failedCount: 0,
      outputDirectory: root,
    });
    expect(existsSync(join(root, 'song.flac'))).toBe(true);
    expect(getLibraryServiceMock().importAudioFile).toHaveBeenCalledWith(
      join(root, 'song.flac'),
      { folderPath: root, deferGroupingRefresh: true },
    );
  });

  it('imports dropped osu archives through the shared importer without treating them as unsupported', async () => {
    const root = makeTempRoot();
    const { app } = await import('electron');
    vi.mocked(app.getPath).mockReturnValue(root);

    const result = await handlers[IpcChannels.LibraryImportDroppedFiles]!(null, [
      { name: 'beatmap.osz', type: 'application/x-osu-beatmap-archive', bytes: new Uint8Array([1, 2, 3]) },
    ]);

    expect(result).toMatchObject({
      importedCount: 1,
      ignoredCount: 0,
      failedCount: 0,
      outputDirectory: root,
    });
    expect(osuArchiveImportMock.importOsuArchiveAsMp3Queued).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDirectory: root,
      }),
    );
    expect(getLibraryServiceMock().importAudioFile).toHaveBeenCalledWith(
      `${root}\\Artist - Song.mp3`,
      expect.objectContaining({
        folderPath: root,
        deferGroupingRefresh: true,
        metadata: expect.objectContaining({
          title: 'Song',
          artist: 'Artist',
          album: 'osu! beatmapset 2492872',
        }),
      }),
    );
  });

  it('classifies dropped import paths as folders, audio files, unsupported files, or missing paths', async () => {
    const root = makeTempRoot();
    const folderPath = join(root, 'Album');
    const audioPath = join(root, 'song.opus');
    const osuPath = join(root, 'beatmap.osz');
    const cuePath = join(root, 'album.cue');
    const unsupportedPath = join(root, 'cover.jpg');
    const missingPath = join(root, 'missing.flac');
    mkdirSync(folderPath, { recursive: true });
    writeFileSync(audioPath, 'audio');
    writeFileSync(osuPath, 'osz');
    writeFileSync(cuePath, 'cue');
    writeFileSync(unsupportedPath, 'image');

    const result = await handlers[IpcChannels.LibraryClassifyImportPaths]!(null, [
      folderPath,
      audioPath,
      osuPath,
      cuePath,
      unsupportedPath,
      missingPath,
    ]);

    expect(result).toEqual({
      folders: [folderPath],
      audioFiles: [audioPath],
      osuArchives: [osuPath],
      unsupportedFiles: [cuePath, unsupportedPath],
      missingPaths: [missingPath],
    });
  });

  it('imports selected local audio paths and adds them to a playlist', async () => {
    const service = installLibraryService();
    const root = makeTempRoot();
    const firstPath = join(root, 'one.flac');
    const secondPath = join(root, 'two.mp3');
    const osuPath = join(root, 'beatmap.osz');
    const unsupportedPath = join(root, 'cover.jpg');
    const missingPath = join(root, 'missing.flac');
    writeFileSync(firstPath, 'audio');
    writeFileSync(secondPath, 'audio');
    writeFileSync(osuPath, 'osz');
    writeFileSync(unsupportedPath, 'image');

    const result = await handlers[IpcChannels.LibraryAddLocalAudioFilesToPlaylist]!(null, 'playlist-1', [
      firstPath,
      secondPath,
      osuPath,
      unsupportedPath,
      missingPath,
    ]);

    expect(service.importAudioFile).toHaveBeenCalledWith(firstPath, { deferGroupingRefresh: true });
    expect(service.importAudioFile).toHaveBeenCalledWith(secondPath, { deferGroupingRefresh: true });
    expect(osuArchiveImportMock.importOsuArchiveAsMp3Queued).toHaveBeenCalledWith(
      expect.objectContaining({ archivePath: osuPath }),
    );
    expect(service.addTracksToPlaylist).toHaveBeenCalledWith('playlist-1', [
      `track-${firstPath}`,
      `track-${secondPath}`,
      'track-D:\\Downloads\\Artist - Song.mp3',
    ]);
    expect(result).toMatchObject({
      importedCount: 3,
      addedCount: 3,
      skippedCount: 2,
      failedCount: 0,
      trackIds: expect.arrayContaining([`track-${firstPath}`, `track-${secondPath}`]),
    });
  });

  it('copies a generated song card image to the clipboard', async () => {
    const result = await handlers[IpcChannels.LibraryCopyTrackCover]!(null, 'track-1');

    expect(result).toBe(true);
    expect(createFromBufferMock).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer((createFromBufferMock.mock.calls[0] as unknown[])[0])).toBe(true);
    expect(writeImageMock).toHaveBeenCalledTimes(1);
  });

  it('copies the original track cover image to the clipboard', () => {
    const service = installLibraryService();
    const root = makeTempRoot();
    const coverPath = join(root, 'cover.png');
    const coverImage = { isEmpty: () => false as false };
    writeFileSync(coverPath, 'cover');
    service.getTrack.mockReturnValue({ ...service.getTrack('track-1'), coverId: 'cover-1' });
    service.resolveCoverAsset.mockReturnValue({ filePath: coverPath, mimeType: 'image/png' });
    createFromPathMock.mockReturnValue(coverImage);

    const result = handlers[IpcChannels.LibraryCopyTrackOriginalCover]!(null, 'track-1');

    expect(result).toBe(true);
    expect(service.resolveCoverAsset).toHaveBeenCalledWith('cover-1', 'original');
    expect(createFromPathMock).toHaveBeenCalledWith(coverPath);
    expect(writeImageMock).toHaveBeenCalledWith(coverImage);
  });

  it('copies the original album cover image to the clipboard', () => {
    const service = installLibraryService();
    const root = makeTempRoot();
    const coverPath = join(root, 'album-original.png');
    const coverImage = { isEmpty: () => false as false };
    writeFileSync(coverPath, 'cover');
    service.getAlbum.mockReturnValue({
      id: 'album-1',
      albumKey: 'suara/music/2010',
      title: 'Music',
      albumArtist: 'Suara',
      year: 2010,
      trackCount: 1,
      duration: 123,
      coverId: 'cover-1',
      coverThumb: 'echo-cover://album/cover-1',
    });
    service.resolveCoverAsset.mockReturnValue({ filePath: coverPath, mimeType: 'image/png' });
    createFromPathMock.mockReturnValue(coverImage);

    const result = handlers[IpcChannels.LibraryCopyAlbumCover]!(null, 'album-1');

    expect(result).toBe(true);
    expect(service.resolveCoverAsset).toHaveBeenCalledWith('cover-1', 'original');
    expect(createFromPathMock).toHaveBeenCalledWith(coverPath);
    expect(writeImageMock).toHaveBeenCalledWith(coverImage);
  });

  it('saves a generated song card as png', async () => {
    const root = makeTempRoot();
    const outputPath = join(root, 'card.png');
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: outputPath });

    const result = await handlers[IpcChannels.LibrarySaveTrackCover]!(null, 'track-1');

    expect(result).toBe(outputPath);
    expect(showSaveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '星灯 - Suara.png',
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      }),
    );
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath).subarray(1, 4).toString()).toBe('PNG');
  });

  it('exports playlists as json, txt, m3u8, and csv', async () => {
    const service = installLibraryService();
    const root = makeTempRoot();
    const formats = ['json', 'txt', 'm3u8', 'csv'] as const;

    for (const format of formats) {
      const outputPath = join(root, `playlist.${format}`);
      showSaveDialogMock.mockResolvedValueOnce({ canceled: false, filePath: outputPath });

      const result = await handlers[IpcChannels.LibraryExportPlaylist]!(null, { playlistId: 'playlist-1', format });

      expect(result).toBe(outputPath);
      expect(existsSync(outputPath)).toBe(true);
      const content = readFileSync(outputPath, 'utf8');
      if (format === 'json') {
        expect(JSON.parse(content)).toMatchObject({
          playlist: { id: 'playlist-1', name: 'Export Mix' },
          tracks: expect.arrayContaining([
            expect.objectContaining({ title: 'Local, Song', path: 'D:\\Music\\song.flac' }),
            expect.objectContaining({ title: 'Stream "Song"', provider: 'netease', sourceItemId: 'song-1' }),
          ]),
        });
      } else if (format === 'txt') {
        expect(content).toContain('Export Mix');
        expect(content).toContain('1. Local, Song - Suara');
      } else if (format === 'm3u8') {
        expect(content).toContain('#EXTM3U');
        expect(content).toContain('D:\\Music\\song.flac');
        expect(content).toContain('# Stream "Song" - Net Artist (netease:song-1)');
      } else {
        expect(content).toContain('title,artist,album,duration,path,provider,sourceItemId,unavailable');
        expect(content).toContain('"Local, Song",Suara,Music,123,D:\\Music\\song.flac,local,,false');
        expect(content).toContain('"Stream ""Song""",Net Artist,Net Album,456,,netease,song-1,false');
      }
    }

    expect(service.getPlaylist).toHaveBeenCalledWith('playlist-1');
    expect(service.getPlaylistItems).toHaveBeenCalledWith('playlist-1', { page: 1, pageSize: 500 });
  });

  it('exports liked playlists for one source provider', async () => {
    const service = installLibraryService();
    service.getPlaylist.mockReturnValueOnce({
      id: 'liked-tracks',
      name: '喜欢的歌曲',
      description: null,
      kind: 'system',
      sourceProvider: 'local',
      sourcePlaylistId: null,
      coverId: null,
      coverThumb: null,
      sortMode: 'manual',
      itemCount: 2,
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    });
    const root = makeTempRoot();
    const outputPath = join(root, 'qq-liked.csv');
    showSaveDialogMock.mockResolvedValueOnce({ canceled: false, filePath: outputPath });

    const result = await handlers[IpcChannels.LibraryExportPlaylist]!(null, { playlistId: 'liked-tracks', format: 'csv', sourceProvider: 'qqmusic' });

    expect(result).toBe(outputPath);
    expect(service.getLikedTracks).toHaveBeenCalledWith({ page: 1, pageSize: 500, sourceProvider: 'qqmusic' });
    expect(service.getPlaylistItems).not.toHaveBeenCalled();
    const content = readFileSync(outputPath, 'utf8');
    expect(content).toContain('QQ Song,QQ Artist,QQ Album,321,,qqmusic,qq-song-1,false');
    expect(showSaveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '喜欢的歌曲 - QQ音乐.csv',
      }),
    );
  });

  it('returns null when playlist export is cancelled', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: undefined });

    const result = await handlers[IpcChannels.LibraryExportPlaylist]!(null, { playlistId: 'playlist-1', format: 'json' });

    expect(result).toBeNull();
  });

  it('imports local m3u8 files as local playlists', async () => {
    const service = installLibraryService();
    const root = makeTempRoot();
    const audioPath = join(root, 'Song One.flac');
    const playlistPath = join(root, 'Road Mix.m3u8');
    writeFileSync(audioPath, 'fake audio');
    writeFileSync(playlistPath, ['#EXTM3U', '#PLAYLIST:Road Mix', '#EXTINF:180,Artist - Song One', 'Song One.flac'].join('\n'));
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [playlistPath] });

    const result = await handlers[IpcChannels.LibraryImportPlaylistFile]!();

    expect(result).toEqual({
      playlistId: 'playlist-imported',
      playlistName: 'Road Mix',
      importedCount: 1,
      filePath: playlistPath,
    });
    expect(service.createPlaylist).toHaveBeenCalledWith({ name: 'Road Mix' });
    expect(service.importAudioFile).toHaveBeenCalledWith(audioPath, { deferGroupingRefresh: true });
    expect(service.addTracksToPlaylist).toHaveBeenCalledWith('playlist-imported', [`track-${audioPath}`]);
  });

  it('refreshes album grouping through IPC', async () => {
    const service = installLibraryService();

    const result = await handlers[IpcChannels.LibraryRefreshAlbumGrouping]!();

    expect(service.refreshAlbumGrouping).toHaveBeenCalledTimes(1);
    expect(service.refreshAlbumGroupingPlaybackSafe).not.toHaveBeenCalled();
    expect(result).toMatchObject({ albumCount: 1 });
  });

  it('returns duplicate hidden counts for normalized track ids', async () => {
    const service = installLibraryService();

    const result = await handlers[IpcChannels.LibraryGetDuplicateHiddenCounts]!(null, ['track-1', 'track-2'], 'strict');

    expect(service.getDuplicateHiddenCounts).toHaveBeenCalledWith(['track-1', 'track-2'], 'strict');
    expect(result).toEqual({ 'track-1': 1, 'track-2': 0 });
  });

  it('preserves supported duplicate modes and falls back to strict for invalid values', async () => {
    const service = installLibraryService();

    await handlers[IpcChannels.LibraryRefreshDuplicateTracks]!(null, 'balanced');
    await handlers[IpcChannels.LibraryGetDuplicateHiddenCounts]!(null, ['track-1'], 'aggressive');
    await handlers[IpcChannels.LibraryGetDuplicateIndexSummary]!(null, 'unknown');
    await handlers[IpcChannels.LibraryGetTracks]!(null, {
      page: 1,
      pageSize: 50,
      hideDuplicates: true,
      showDuplicatesOnly: true,
      duplicateMode: 'balanced',
    });

    expect(service.refreshDuplicateTracksPlaybackSafe).toHaveBeenCalledWith('balanced');
    expect(service.getDuplicateHiddenCounts).toHaveBeenCalledWith(['track-1'], 'aggressive');
    expect(service.getDuplicateIndexSummary).toHaveBeenCalledWith('strict');
    expect(service.getTracks).toHaveBeenCalledWith({
      page: 1,
      pageSize: 50,
      hideDuplicates: true,
      showDuplicatesOnly: true,
      duplicateMode: 'balanced',
    });
  });

  it('returns zero duplicate hidden counts while the protected library is unavailable', async () => {
    const service = installLibraryService();
    const { LibraryDatabaseUnavailableError } = await import('../app/dataProtection');
    service.getDuplicateHiddenCounts.mockImplementation(() => {
      throw new LibraryDatabaseUnavailableError();
    });

    const result = await handlers[IpcChannels.LibraryGetDuplicateHiddenCounts]!(null, ['track-1', 'track-2'], 'strict');

    expect(result).toEqual({ 'track-1': 0, 'track-2': 0 });
  });

  it('previews duplicate cleanup only when scans are idle', () => {
    const service = installLibraryService();
    service.hasRunningJobs.mockReturnValue(true);

    expect(() => handlers[IpcChannels.LibraryPreviewDuplicateTrackCleanup]!(null, 'strict')).toThrow(/扫描仍在运行/u);
    expect(service.previewDuplicateTrackCleanup).not.toHaveBeenCalled();
  });

  it('moves lower-ranked duplicate files to trash before removing them from the library', async () => {
    const service = installLibraryService();
    const root = makeTempRoot();
    const lowQualityPath = join(root, 'song-low.mp3');
    writeFileSync(lowQualityPath, 'audio', 'utf8');
    const keepTrack = {
      id: 'track-keep',
      path: join(root, 'song.flac'),
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      albumArtist: 'Artist',
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: 180,
      codec: 'FLAC',
      sampleRate: 96000,
      bitDepth: 24,
      bitrate: 1800000,
      coverId: null,
      coverThumb: null,
      metadataStatus: 'ok',
      embeddedMetadataStatus: 'present',
      embeddedCoverStatus: 'missing',
      networkMetadataStatus: 'none',
      fieldSources: {},
    };
    const removeTrack = {
      ...keepTrack,
      id: 'track-low',
      path: lowQualityPath,
      codec: 'MP3',
      sampleRate: 44100,
      bitDepth: null,
      bitrate: 192000,
    };

    service.getDuplicateTrackCleanupPreview.mockReturnValue({
      summary: {
        mode: 'strict',
        totalTracksScanned: 2,
        duplicateGroups: 1,
        duplicateMembers: 2,
        hiddenTracks: 1,
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
      groups: [
        {
          id: 'group-1',
          duplicateKey: 'song\u0000artist',
          confidence: 1,
          trackCount: 2,
          keep: { track: keepTrack, qualityScore: 13000, rank: 1, sizeBytes: 10, reasons: [] },
          remove: [{ track: removeTrack, qualityScore: 2500, rank: 2, sizeBytes: 5, reasons: [] }],
        },
      ],
      removeTrackIds: ['track-low'],
      totalTracksToRemove: 1,
      totalBytesToRemove: 5,
      generatedAt: '2026-05-20T00:00:00.000Z',
    });
    trashItemMock.mockResolvedValue(undefined);

    const result = await handlers[IpcChannels.LibraryApplyDuplicateTrackCleanup]!(null, {
      mode: 'strict',
      trackIds: ['track-low'],
    });

    expect(trashItemMock).toHaveBeenCalledWith(lowQualityPath);
    expect(service.deleteTracks).toHaveBeenCalledWith(['track-low']);
    expect(service.refreshDuplicateTracksAsync).toHaveBeenCalledWith('strict');
    expect(result).toMatchObject({
      requestedTrackIds: 1,
      trashedTracks: 1,
      missingFiles: 0,
      removedFromLibrary: 1,
      failedTracks: [],
      totalBytesRequested: 5,
    });
  });

  it('rejects duplicate cleanup when the request includes the kept track', async () => {
    const service = installLibraryService();
    service.getDuplicateTrackCleanupPreview.mockReturnValue({
      summary: {
        mode: 'strict',
        totalTracksScanned: 2,
        duplicateGroups: 1,
        duplicateMembers: 2,
        hiddenTracks: 1,
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
      groups: [
        {
          id: 'group-1',
          duplicateKey: 'song\u0000artist',
          confidence: 1,
          trackCount: 2,
          keep: {
            track: {
              id: 'track-keep',
              path: 'D:\\Music\\song.flac',
              title: 'Song',
              artist: 'Artist',
              album: 'Album',
              albumArtist: 'Artist',
              trackNo: null,
              discNo: null,
              year: null,
              genre: null,
              duration: 180,
              codec: 'FLAC',
              sampleRate: 96000,
              bitDepth: 24,
              bitrate: 1800000,
              coverId: null,
              coverThumb: null,
              metadataStatus: 'ok',
              embeddedMetadataStatus: 'present',
              embeddedCoverStatus: 'missing',
              networkMetadataStatus: 'none',
              fieldSources: {},
            },
            qualityScore: 13000,
            rank: 1,
            sizeBytes: 10,
            reasons: [],
          },
          remove: [],
        },
      ],
      removeTrackIds: [],
      totalTracksToRemove: 0,
      totalBytesToRemove: 0,
      generatedAt: '2026-05-20T00:00:00.000Z',
    });

    await expect(handlers[IpcChannels.LibraryApplyDuplicateTrackCleanup]!(null, {
      mode: 'strict',
      trackIds: ['track-keep'],
    })).rejects.toThrow(/重新扫描后再清理/u);
    expect(trashItemMock).not.toHaveBeenCalled();
    expect(service.deleteTracks).not.toHaveBeenCalled();
  });

  it('accepts file modified and artist-album sorting for songs and albums', async () => {
    const service = installLibraryService();

    await handlers[IpcChannels.LibraryGetTracks]!(null, { page: 1, pageSize: 50, sort: 'fileModifiedDesc', extra: true });
    await handlers[IpcChannels.LibraryGetTracks]!(null, { page: 1, pageSize: 50, sort: 'artistAlbum', extra: true });
    await handlers[IpcChannels.LibraryGetAlbums]!(null, { page: 1, pageSize: 50, sort: 'fileModifiedAsc', extra: true });

    expect(service.getTracks).toHaveBeenCalledWith({ page: 1, pageSize: 50, sort: 'fileModifiedDesc' });
    expect(service.getTracks).toHaveBeenCalledWith({ page: 1, pageSize: 50, sort: 'artistAlbum' });
    expect(service.getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 50, sort: 'fileModifiedAsc' });
  });

  it('registers artist detail IPC handlers with normalized queries', async () => {
    const service = installLibraryService();
    service.getArtist.mockReturnValue({
      id: 'artist-1',
      name: 'Suara',
      sortName: 'suara',
      role: 'both',
      trackCount: 2,
      albumCount: 1,
      coverId: null,
      coverThumb: null,
    });
    service.getArtistTracks.mockReturnValue({ items: [], page: 1, pageSize: 50, total: 0, hasMore: false });
    service.getArtistAlbums.mockReturnValue({ items: [], page: 1, pageSize: 12, total: 0, hasMore: false });

    await handlers[IpcChannels.LibraryGetArtist]!(null, 'artist-1');
    await handlers[IpcChannels.LibraryGetArtistInsights]!(null, 'artist-1', { limit: 8, includeOnline: true, region: 'HK' });
    await handlers[IpcChannels.LibraryGetArtistTracks]!(null, 'artist-1', { page: 2, pageSize: 50, sort: 'durationDesc', extra: true });
    await handlers[IpcChannels.LibraryGetArtistAlbums]!(null, 'artist-1', { page: 1, pageSize: 12, sort: 'recent' });

    expect(service.getArtist).toHaveBeenCalledWith('artist-1');
    expect(service.getArtistInsights).toHaveBeenCalledWith('artist-1', { limit: 8, includeOnline: true, forceOnline: false, region: 'HK' });
    expect(service.getArtistTracks).toHaveBeenCalledWith('artist-1', { page: 2, pageSize: 50, sort: 'durationDesc' });
    expect(service.getArtistAlbums).toHaveBeenCalledWith('artist-1', { page: 1, pageSize: 12, sort: 'recent' });
  });

  it('registers artist image cache IPC handlers', async () => {
    const service = installLibraryService();
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['D:\\Avatar\\suara.png'] });

    await handlers[IpcChannels.LibraryArtistImagesEnqueueMissing]!(null, {
      artists: [{ id: 'artist-1', name: 'Suara' }],
      limit: 25,
      force: false,
    });
    await handlers[IpcChannels.LibraryArtistImagesRefreshVisible]!(null, [{ id: 'artist-1', name: 'Suara' }]);
    await handlers[IpcChannels.LibraryArtistImagesRefreshOne]!(null, { artistId: 'artist-1', force: true });
    await handlers[IpcChannels.LibraryArtistImagesGetStatus]!(null, 'artist-1');
    await handlers[IpcChannels.LibraryArtistImagesGetSummary]!(null);
    await handlers[IpcChannels.LibraryArtistImagesGetJobStatus]!(null);
    await handlers[IpcChannels.LibraryArtistImagesSetPaused]!(null, true);
    await handlers[IpcChannels.LibraryArtistImagesKickoff]!(null, { force: true, limit: 50 });
    await handlers[IpcChannels.LibraryArtistImagesClearCache]!();
    await handlers[IpcChannels.LibraryArtistImagesChooseCustom]!(null, 'artist-1');
    await handlers[IpcChannels.LibraryArtistImagesSetCustomUrl]!(null, { artistId: 'artist-1', url: 'https://example.test/avatar.png' });
    await handlers[IpcChannels.LibraryArtistImagesClearCustom]!(null, 'artist-1');
    await handlers[IpcChannels.LibraryArtistOnlineInfoClearCache]!();

    expect(service.enqueueMissingArtistImages).toHaveBeenCalledWith([{ id: 'artist-1', name: 'Suara', artistKey: undefined, artistName: undefined }], {
      force: false,
      limit: 25,
    });
    expect(service.refreshVisibleArtistImages).toHaveBeenCalledWith([{ id: 'artist-1', name: 'Suara', artistKey: undefined, artistName: undefined }]);
    expect(service.refreshArtistImage).toHaveBeenCalledWith('artist-1', true);
    expect(service.getArtistImage).toHaveBeenCalledWith('artist-1');
    expect(service.getArtistImageCacheSummary).toHaveBeenCalledTimes(1);
    expect(service.getArtistImageJobStatus).toHaveBeenCalledTimes(1);
    expect(service.setArtistImageJobsPaused).toHaveBeenCalledWith(true);
    expect(service.kickoffArtistImageBackfill).toHaveBeenCalledWith({ force: true, limit: 50 });
    expect(service.clearArtistImageCache).toHaveBeenCalledTimes(1);
    expect(service.setCustomArtistImageFromFile).toHaveBeenCalledWith('artist-1', 'D:\\Avatar\\suara.png');
    expect(service.setCustomArtistImageFromUrl).toHaveBeenCalledWith('artist-1', 'https://example.test/avatar.png');
    expect(service.clearCustomArtistImage).toHaveBeenCalledWith('artist-1');
    expect(service.clearArtistOnlineInfoCache).toHaveBeenCalledTimes(1);
  });

  it('registers folder center IPC handlers with normalized queries', async () => {
    const service = installLibraryService();
    openPathMock.mockResolvedValue('');

    await handlers[IpcChannels.LibraryGetFolderOverviews]!();
    await handlers[IpcChannels.LibraryGetFolderChildren]!(null, { folderId: 'folder-1', parentPath: 'D:\\Music' });
    await handlers[IpcChannels.LibraryGetFolderTracks]!(null, {
      folderId: 'folder-1',
      path: 'D:\\Music\\Rock',
      recursive: false,
      page: 2,
      pageSize: 25,
      sort: 'album',
      search: 'live',
    });
    await handlers[IpcChannels.LibraryOpenLibraryFolderPath]!(null, { folderId: 'folder-1', path: 'D:\\Music' });

    expect(service.getFolderOverviews).toHaveBeenCalledTimes(1);
    expect(service.getFolderChildren).toHaveBeenCalledWith({ folderId: 'folder-1', parentPath: 'D:\\Music' });
    expect(service.getFolderTracks).toHaveBeenCalledWith({
      folderId: 'folder-1',
      path: 'D:\\Music\\Rock',
      recursive: false,
      page: 2,
      pageSize: 25,
      sort: 'album',
      search: 'live',
    });
    expect(service.resolveLibraryFolderPath).toHaveBeenCalledWith({ folderId: 'folder-1', path: 'D:\\Music' });
    expect(openPathMock).toHaveBeenCalledWith('D:\\Music');
  });

  it('returns database protection status and can create a manual snapshot', async () => {
    const root = makeTempRoot();
    const { app } = await import('electron');
    vi.mocked(app.getPath).mockImplementation(() => root);
    createHealthyLibrary(root);

    const status = await handlers[IpcChannels.LibraryCreateDatabaseSnapshot]!() as LibraryDatabaseProtectionStatus;

    expect(status.health.status).toBe('ok');
    expect(status.latestHealthySnapshot?.libraryHealth.status).toBe('ok');
    expect(status.latestHealthySnapshot?.id).toContain('manual-library-database-snapshot');
  });

  it('rejects database restore while a scan is running', async () => {
    const service = installLibraryService();
    service.hasRunningJobs.mockReturnValue(true);

    expect(() => handlers[IpcChannels.LibraryRestoreDatabaseSnapshot]!(null, 'snapshot-id')).toThrow(/扫描仍在运行/u);
    expect(closeDatabaseUserMocks.library).not.toHaveBeenCalled();
  });

  it('rejects disaster rebuild while a scan is running', async () => {
    const service = installLibraryService();
    service.hasRunningJobs.mockReturnValue(true);

    expect(() => handlers[IpcChannels.LibraryRepairDatabase]!()).toThrow(/扫描仍在运行/u);
    expect(closeDatabaseUserMocks.library).not.toHaveBeenCalled();
    expect(closeDatabaseUserMocks.remote).not.toHaveBeenCalled();
    expect(closeDatabaseUserMocks.lyrics).not.toHaveBeenCalled();
    expect(closeDatabaseUserMocks.mv).not.toHaveBeenCalled();
    expect(closeDatabaseUserMocks.streaming).not.toHaveBeenCalled();
  });

  it('schedules a recovery-mode relaunch and closes database users even during scan pressure', async () => {
    const service = installLibraryService();
    service.hasRunningJobs.mockReturnValue(true);

    const result = await handlers[IpcChannels.LibraryRelaunchRecoveryMode]!();

    expect(result).toMatchObject({ scheduled: true, mode: 'startup-auto-repair' });
    expect(appLifecycleMocks.relaunch).toHaveBeenCalledWith({
      args: expect.arrayContaining(['--echo-library-recovery-mode']),
    });
    expect(closeDatabaseUserMocks.lyrics).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.mv).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.streaming).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.remote).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.library).toHaveBeenCalledTimes(1);
  });

  it('archives a corrupt database and closes database users before rebuilding an empty library', async () => {
    const root = makeTempRoot();
    const { app } = await import('electron');
    vi.mocked(app.getPath).mockImplementation(() => root);
    writeFileSync(join(root, 'echo-library.sqlite'), 'bad current database', 'utf8');
    writeFileSync(join(root, 'echo-library.sqlite-wal'), 'bad wal', 'utf8');
    writeFileSync(join(root, 'echo-library.sqlite-shm'), 'bad shm', 'utf8');

    const result = await handlers[IpcChannels.LibraryRepairDatabase]!() as LibraryDatabaseRepairResult;

    expect(result.readyForRescan).toBe(true);
    expect(result.removedDatabaseFiles).toEqual(expect.arrayContaining(['echo-library.sqlite', 'echo-library.sqlite-wal', 'echo-library.sqlite-shm']));
    expect(result.archivePath).toBeTruthy();
    expect(existsSync(join(result.archivePath!, 'echo-library.sqlite'))).toBe(true);
    expect(existsSync(join(root, 'echo-library.sqlite'))).toBe(false);
    expect(closeDatabaseUserMocks.lyrics).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.mv).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.streaming).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.remote).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.library).toHaveBeenCalledTimes(1);
  });

  it('deletes all ECHO user data and external cover cache contents after closing database users', async () => {
    const root = makeTempRoot();
    const externalCoverCache = makeTempRoot();
    const { app } = await import('electron');
    vi.mocked(app.getPath).mockImplementation((name: string) => (name === 'downloads' ? 'D:\\Downloads' : root));
    mkdirSync(join(root, 'plugins'), { recursive: true });
    mkdirSync(join(root, 'cover-cache'), { recursive: true });
    writeFileSync(join(root, 'echo-settings.json'), '{}\n', 'utf8');
    writeFileSync(join(root, 'plugins', 'plugin-state.json'), '{}\n', 'utf8');
    writeFileSync(join(root, 'cover-cache', 'cover.webp'), 'cover', 'utf8');
    writeFileSync(join(externalCoverCache, 'external-cover.webp'), 'cover', 'utf8');
    getLibraryServiceMock.mockReturnValue({
      ...installLibraryService(),
      getCoverCacheDir: () => externalCoverCache,
    });

    const result = await handlers[IpcChannels.LibraryDeleteAllUserData]!() as LibraryAllUserDataDeleteResult;

    expect(result.userDataPath).toBe(root);
    expect(result.coverCachePath).toBe(externalCoverCache);
    expect(result.failedPaths).toEqual([]);
    expect(existsSync(join(root, 'echo-settings.json'))).toBe(false);
    expect(existsSync(join(root, 'plugins'))).toBe(false);
    expect(existsSync(join(externalCoverCache, 'external-cover.webp'))).toBe(false);
    expect(existsSync(externalCoverCache)).toBe(true);
    expect(downloadServiceMock.dispose).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.lyrics).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.mv).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.streaming).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.remote).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.library).toHaveBeenCalledTimes(1);
  });

  it('restores a healthy snapshot through IPC and closes database users first', async () => {
    const root = makeTempRoot();
    const { app } = await import('electron');
    vi.mocked(app.getPath).mockImplementation(() => root);
    createHealthyLibrary(root);
    const status = await handlers[IpcChannels.LibraryCreateDatabaseSnapshot]!() as LibraryDatabaseProtectionStatus;
    Object.values(closeDatabaseUserMocks).forEach((mock) => mock.mockClear());
    writeFileSync(join(root, 'echo-library.sqlite'), 'bad current database', 'utf8');
    const snapshotId = status.latestHealthySnapshot?.id ?? '';

    const result = await handlers[IpcChannels.LibraryRestoreDatabaseSnapshot]!(null, snapshotId) as LibraryDatabaseRestoreResult;

    expect(result.health.status).toBe('ok');
    expect(closeDatabaseUserMocks.lyrics).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.mv).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.streaming).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.remote).toHaveBeenCalledTimes(1);
    expect(closeDatabaseUserMocks.library).toHaveBeenCalledTimes(1);
  });

  it('does not accept renderer-provided snapshot paths', async () => {
    const root = makeTempRoot();
    const { app } = await import('electron');
    vi.mocked(app.getPath).mockImplementation(() => root);
    createHealthyLibrary(root);
    await handlers[IpcChannels.LibraryCreateDatabaseSnapshot]!();
    await expect(handlers[IpcChannels.LibraryRestoreDatabaseSnapshot]!(null, '..\\echo-library.sqlite')).rejects.toThrow(/找不到这个曲库数据库快照/u);
  });

  it('opens an arbitrary file path in its folder', async () => {
    await handlers[IpcChannels.LibraryOpenPathInFolder]!(null, 'D:\\Loose\\song.flac');

    expect(showItemInFolderMock).toHaveBeenCalledWith('D:\\Loose\\song.flac');
  });

  it('registers album detail IPC handler', async () => {
    const service = installLibraryService();
    service.getAlbum.mockReturnValue({
      id: 'album-1',
      albumKey: 'artist/album',
      title: 'Album',
      albumArtist: 'Artist',
      year: 2026,
      trackCount: 1,
      duration: 120,
      coverId: 'cover-1',
      coverThumb: 'echo-cover://album/cover-1',
      coverLarge: 'echo-cover://large/cover-1',
    });

    const result = await handlers[IpcChannels.LibraryGetAlbum]!(null, 'album-1');

    expect(service.getAlbum).toHaveBeenCalledWith('album-1');
    expect(result).toMatchObject({ coverLarge: 'echo-cover://large/cover-1' });
  });

  it('registers track album lookup IPC handler', async () => {
    const service = installLibraryService();
    service.getAlbumForTrack.mockReturnValue({
      id: 'album-1',
      albumKey: 'artist/album',
      title: 'Album',
      albumArtist: 'Artist',
      year: 2026,
      trackCount: 1,
      duration: 120,
      coverId: 'cover-1',
      coverThumb: 'echo-cover://album/cover-1',
    });

    const result = await handlers[IpcChannels.LibraryGetAlbumForTrack]!(null, 'track-1');

    expect(service.getAlbumForTrack).toHaveBeenCalledWith('track-1');
    expect(result).toMatchObject({ id: 'album-1' });
  });

  it('resolves lyrics background covers through the dedicated lyrics option when global network metadata is off', async () => {
    const service = installLibraryService();

    const result = await handlers[IpcChannels.LibraryResolveLyricsBackgroundCover]!(null, 'track-1');

    expect(service.resolveLyricsBackgroundCover).toHaveBeenCalledWith('track-1', ['netease-cloud-music', 'qq-music']);
    expect(result).toMatchObject({
      coverUrl: 'echo-image://remote/cover',
      provider: 'netease-cloud-music',
    });
  });
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
