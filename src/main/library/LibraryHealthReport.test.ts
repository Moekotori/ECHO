import { describe, expect, it } from 'vitest';
import type { AppCacheInventory } from '../../shared/types/coverCache';
import type {
  LibraryDatabaseProtectionStatus,
  LibraryDiagnostics,
  LibraryHealthReport,
  LibraryLabState,
  LibrarySummary,
} from '../../shared/types/library';
import type { RemoteBackgroundGlobalStatus, RemoteSource } from '../../shared/types/remoteSources';
import {
  createLibraryHealthReport,
  renderLibraryHealthReportMarkdown,
  type LibraryHealthReportDependencies,
} from './LibraryHealthReport';

const summary = (): LibrarySummary => ({
  songCount: 12,
  albumCount: 3,
  artistCount: 4,
  folderCount: 2,
  totalDuration: 1800,
  lastScanAt: '2026-05-20T10:00:00.000Z',
});

const diagnostics = (): LibraryDiagnostics => ({
  foldersCount: 2,
  tracksCount: 12,
  albumsCount: 3,
  artistsCount: 4,
  coversCount: 10,
  lastScan: {
    status: 'completed',
    phase: 'finished',
    discoveredCount: 12,
    parsedCount: 12,
    skippedCount: 1,
    coverCount: 10,
    errorCount: 2,
    startedAt: '2026-05-20T09:00:00.000Z',
    finishedAt: '2026-05-20T10:00:00.000Z',
  },
  lastQueryMs: {
    getTracks: 12,
    getAlbums: 8,
  },
  averageAlbumPayloadBytes: 1024,
  databasePath: 'D:\\Secret\\Music\\echo-library.sqlite',
  databaseSizeBytes: 4096,
  coverCachePath: 'D:\\Secret\\Music\\covers',
  coverCacheSizeBytes: 2048,
  coverCacheVersion: 2,
  cpuCount: 8,
  scanPerformanceMode: 'balanced',
  metadataConcurrency: 2,
  coverConcurrency: 2,
  groupingRefreshQueued: false,
  lastGroupingRefreshError: null,
});

const databaseStatus = (): LibraryDatabaseProtectionStatus => ({
  status: 'ok',
  reason: 'none',
  dataProtectionPath: 'D:\\Secret\\Protection',
  databasePath: 'D:\\Secret\\Music\\echo-library.sqlite',
  databaseSizeBytes: 4096,
  health: {
    status: 'ok',
    databasePath: 'D:\\Secret\\Music\\echo-library.sqlite',
    checkedAt: '2026-05-20T10:05:00.000Z',
  },
  snapshots: [],
  latestHealthySnapshot: {
    id: 'snapshot-1',
    path: 'D:\\Secret\\Protection\\snapshot-1',
    createdAt: '2026-05-20T08:00:00.000Z',
    reason: 'startup',
    copied: [],
    skipped: [],
    libraryHealth: {
      status: 'ok',
      databasePath: 'D:\\Secret\\Protection\\snapshot-1\\echo-library.sqlite',
      checkedAt: '2026-05-20T08:00:00.000Z',
    },
    libraryBackupMethod: 'sqlite-backup',
    databasePath: 'D:\\Secret\\Protection\\snapshot-1\\echo-library.sqlite',
    databaseSizeBytes: 4096,
  },
  latestArchive: null,
  maintenanceEvents: [],
  canRestoreSnapshot: true,
  hasRunningScan: false,
  recommendedAction: 'none',
  managerState: {
    databasePath: 'D:\\Secret\\Music\\echo-library.sqlite',
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
  },
});

const labState = (): LibraryLabState => ({
  watcherEnabled: true,
  watcherRunning: true,
  autoRescanEnabled: true,
  moveCandidateEnabled: false,
  moveRepairLabEnabled: false,
  watchedFolderCount: 2,
  totalEventCount: 3,
  pendingPathCount: 1,
  triggeredRescanCount: 1,
  droppedPathCount: 0,
  skippedDeleteEventCount: 2,
  skippedRenameEventCount: 1,
  lastTriggeredRescanAt: '2026-05-20T10:30:00.000Z',
  lastRescanError: null,
  watcherLastError: null,
  lastWatcherEventAt: null,
  lastRescanStartedAt: null,
  lastRescanFinishedAt: null,
  lastRescanPathCount: 1,
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
});

const cacheInventory = (): AppCacheInventory => ({
  generatedAt: '2026-05-20T10:40:00.000Z',
  totalSizeBytes: 3072,
  items: [
    {
      kind: 'cover',
      label: '封面缓存',
      path: 'D:\\Secret\\Music\\covers',
      sizeBytes: 2048,
      fileCount: 2,
      movable: true,
      reason: '可迁移',
      lastError: null,
    },
    {
      kind: 'lyrics-mv',
      label: '歌词/MV 记录',
      path: 'D:\\Secret\\Music\\echo-library.sqlite',
      sizeBytes: 1024,
      fileCount: 1,
      movable: false,
      reason: '不移动主数据库',
      lastError: 'EACCES D:\\Secret\\Music\\echo-library.sqlite token=abc123',
    },
  ],
});

const remoteSource = (): RemoteSource => ({
  id: 'remote-1',
  provider: 'webdav',
  displayName: 'NAS Music',
  status: 'enabled',
  baseUrl: 'https://example.invalid/token-secret',
  username: 'user@example.invalid',
  authType: 'token',
  config: { secret: 'do-not-export' },
  syncMode: 'index',
  lastTestAt: null,
  lastSyncAt: '2026-05-20T10:15:00.000Z',
  lastError: 'failed https://example.invalid/private?token=secret',
  indexedTrackCount: 8,
  createdAt: '2026-05-20T08:00:00.000Z',
  updatedAt: '2026-05-20T10:15:00.000Z',
});

const remoteBackground = (): RemoteBackgroundGlobalStatus => ({
  paused: false,
  playbackActive: false,
  concurrency: {
    metadata: 1,
    cover: 1,
    lyrics: 0,
    mv: 0,
    'duration-backfill': 0,
  },
  updatedAt: '2026-05-20T10:20:00.000Z',
});

const createDependencies = (overrides: Partial<LibraryHealthReportDependencies> = {}): LibraryHealthReportDependencies => ({
  now: () => new Date('2026-05-20T12:00:00.000Z'),
  getSummary: summary,
  getDiagnostics: diagnostics,
  getDatabaseProtectionStatus: databaseStatus,
  getQualityOverview: () => [
    {
      kind: 'missing_cover',
      label: '缺封面',
      count: 3,
      severity: 'warning',
      description: '没有封面',
      actionAvailable: true,
      lastError: null,
    },
  ],
  getLibraryLabState: labState,
  getCacheInventory: cacheInventory,
  listRemoteSources: () => [remoteSource()],
  getRemoteBackgroundGlobalStatus: remoteBackground,
  ...overrides,
});

describe('LibraryHealthReport', () => {
  it('aggregates readonly library sections and keeps paths summarized', () => {
    const report = createLibraryHealthReport(createDependencies());

    expect(report.summary).toMatchObject({ songCount: 12, warningCount: 0 });
    expect(report.database).toMatchObject({
      status: 'ok',
      healthStatus: 'ok',
      canRestoreSnapshot: true,
      databasePath: { basename: 'echo-library.sqlite' },
    });
    expect(report.scan.errorCount).toBe(2);
    expect(report.quality[0]?.count).toBe(3);
    expect(report.cache.items[0]?.path?.basename).toBe('covers');
    expect(report.watcher).toMatchObject({ enabled: true, pendingPathCount: 1, skippedDeleteEventCount: 2 });
    expect(report.remoteSources).toMatchObject({ total: 1, enabled: 1, indexedTrackCount: 8 });
  });

  it('exports sanitized markdown without raw local paths or remote secrets', () => {
    const report = createLibraryHealthReport(createDependencies());
    const markdown = renderLibraryHealthReportMarkdown(report);

    expect(markdown).toContain('echo\\-library\\.sqlite');
    expect(markdown).not.toContain('D:\\Secret\\Music');
    expect(markdown).not.toContain('token-secret');
    expect(markdown).not.toContain('token=abc123');
    expect(markdown).not.toContain('token=secret');
    expect(markdown).not.toContain('do-not-export');
  });

  it('degrades individual failing sections into warnings', () => {
    const report = createLibraryHealthReport(
      createDependencies({
        getCacheInventory: () => {
          throw new Error('cache failed D:\\Secret\\Cache token=cache-secret');
        },
        listRemoteSources: () => {
          throw new Error('cookie=remote-secret');
        },
      }),
    );

    expect(report.cache.items).toEqual([]);
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings.join('\n')).not.toContain('cache-secret');
    expect(report.warnings.join('\n')).not.toContain('remote-secret');
  });
});
