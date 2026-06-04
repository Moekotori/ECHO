import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { AppCacheInventory } from '../../shared/types/coverCache';
import type {
  LibraryDatabaseProtectionStatus,
  LibraryDiagnostics,
  LibraryHealthReport,
  LibraryHealthReportCache,
  LibraryHealthReportDatabase,
  LibraryHealthReportRemoteSources,
  LibraryHealthReportScan,
  LibraryHealthReportWatcher,
  LibraryHealthSafePath,
  LibraryLabState,
  LibraryQualityOverviewItem,
  LibrarySummary,
} from '../../shared/types/library';
import type { RemoteBackgroundGlobalStatus, RemoteSource } from '../../shared/types/remoteSources';

export type LibraryHealthReportDependencies = {
  now?: () => Date;
  getSummary: () => LibrarySummary;
  getDiagnostics: () => LibraryDiagnostics;
  getDatabaseProtectionStatus: () => LibraryDatabaseProtectionStatus;
  getQualityOverview: () => LibraryQualityOverviewItem[];
  getLibraryLabState: () => LibraryLabState;
  getCacheInventory: () => AppCacheInventory;
  listRemoteSources: () => RemoteSource[];
  getRemoteBackgroundGlobalStatus: () => RemoteBackgroundGlobalStatus;
};

export type AsyncLibraryHealthReportDependencies = Omit<LibraryHealthReportDependencies, 'getCacheInventory'> & {
  getCacheInventory: () => Promise<AppCacheInventory>;
};

const emptySummary = (): LibrarySummary => ({
  songCount: 0,
  albumCount: 0,
  artistCount: 0,
  folderCount: 0,
  totalDuration: 0,
  lastScanAt: null,
});

const emptyDiagnostics = (): LibraryDiagnostics => ({
  foldersCount: 0,
  tracksCount: 0,
  albumsCount: 0,
  artistsCount: 0,
  coversCount: 0,
  lastScan: null,
  lastQueryMs: {
    getTracks: null,
    getAlbums: null,
  },
  averageAlbumPayloadBytes: null,
  databasePath: null,
  databaseSizeBytes: null,
  coverCachePath: null,
  coverCacheSizeBytes: null,
  coverCacheVersion: 0,
  cpuCount: 0,
  scanPerformanceMode: 'balanced',
  metadataConcurrency: 0,
  coverConcurrency: 0,
});

const emptyLabState = (): LibraryLabState => ({
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
});

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 12);

export const safePathSummary = (value: string | null | undefined): LibraryHealthSafePath | null => {
  if (!value) {
    return null;
  }

  return {
    basename: basename(value),
    pathHash: hashText(value),
  };
};

const redactPathLikeText = (value: string): string =>
  value
    .replace(/[a-z]:\\[^\s"'<>|]+/giu, (match) => {
      const safe = safePathSummary(match);
      return safe ? `[path:${safe.basename}#${safe.pathHash}]` : '[path]';
    })
    .replace(/\\\\[^\s"'<>|]+/gu, (match) => {
      const safe = safePathSummary(match);
      return safe ? `[path:${safe.basename}#${safe.pathHash}]` : '[path]';
    })
    .replace(/https?:\/\/[^\s"'<>]+/giu, (match) => `[url:${hashText(match)}]`)
    .replace(/\b(cookie|token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]');

const safeText = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  return redactPathLikeText(value);
};

const safeError = (error: unknown): string => safeText(error instanceof Error ? error.message : String(error)) ?? 'unknown error';

const trySection = <T>(label: string, warnings: string[], fallback: T, action: () => T): T => {
  try {
    return action();
  } catch (error) {
    warnings.push(`${label}: ${safeError(error)}`);
    return fallback;
  }
};

const trySectionAsync = async <T>(label: string, warnings: string[], fallback: T, action: () => Promise<T>): Promise<T> => {
  try {
    return await action();
  } catch (error) {
    warnings.push(`${label}: ${safeError(error)}`);
    return fallback;
  }
};

const createDatabaseSection = (
  status: LibraryDatabaseProtectionStatus | null,
  diagnostics: LibraryDiagnostics,
): LibraryHealthReportDatabase => {
  if (!status) {
    return {
      status: 'unknown',
      healthStatus: 'unknown',
      recommendedAction: 'none',
      unrecoverableReason: null,
      canRestoreSnapshot: false,
      hasRunningScan: false,
      databaseSizeBytes: diagnostics.databaseSizeBytes,
      databasePath: safePathSummary(diagnostics.databasePath),
      latestHealthySnapshotId: null,
      managerProtected: null,
      managerOpenConnections: null,
      maintenanceInProgress: false,
    };
  }

  return {
    status: status.status,
    healthStatus: status.health?.status ?? 'unknown',
    recommendedAction: status.recommendedAction,
    unrecoverableReason: safeText(status.unrecoverableReason),
    canRestoreSnapshot: status.canRestoreSnapshot,
    hasRunningScan: status.hasRunningScan,
    databaseSizeBytes: status.databaseSizeBytes ?? diagnostics.databaseSizeBytes,
    databasePath: safePathSummary(status.databasePath ?? diagnostics.databasePath),
    latestHealthySnapshotId: status.latestHealthySnapshot?.id ?? null,
    managerProtected: status.managerState?.protected ?? null,
    managerOpenConnections: status.managerState?.openConnections ?? null,
    maintenanceInProgress: status.managerState?.maintenanceInProgress ?? false,
  };
};

const createScanSection = (diagnostics: LibraryDiagnostics): LibraryHealthReportScan => {
  const lastScan = diagnostics.lastScan;
  return {
    status: lastScan?.status ?? 'idle',
    phase: lastScan?.phase ?? 'idle',
    startedAt: lastScan?.startedAt ?? null,
    finishedAt: lastScan?.finishedAt ?? null,
    discoveredCount: lastScan?.discoveredCount ?? 0,
    parsedCount: lastScan?.parsedCount ?? 0,
    skippedCount: lastScan?.skippedCount ?? 0,
    coverCount: lastScan?.coverCount ?? 0,
    errorCount: lastScan?.errorCount ?? 0,
    performanceMode: diagnostics.scanPerformanceMode ?? 'unknown',
    metadataConcurrency: diagnostics.metadataConcurrency ?? null,
    coverConcurrency: diagnostics.coverConcurrency ?? null,
    groupingRefreshQueued: diagnostics.groupingRefreshQueued ?? false,
    lastGroupingRefreshError: safeText(diagnostics.lastGroupingRefreshError),
  };
};

const createWatcherSection = (labState: LibraryLabState): LibraryHealthReportWatcher => ({
  enabled: labState.watcherEnabled,
  running: labState.watcherRunning,
  autoRescanEnabled: labState.autoRescanEnabled,
  watchedFolderCount: labState.watchedFolderCount,
  pendingPathCount: labState.pendingPathCount,
  triggeredRescanCount: labState.triggeredRescanCount,
  skippedDeleteEventCount: labState.skippedDeleteEventCount,
  skippedRenameEventCount: labState.skippedRenameEventCount,
  lastError: safeText(labState.watcherLastError),
  lastRescanError: safeText(labState.lastRescanError),
  lastTriggeredRescanAt: labState.lastTriggeredRescanAt,
});

const emptyCacheReport = (lastError: string | null = null): LibraryHealthReportCache => ({
  generatedAt: null,
  totalSizeBytes: 0,
  items: [],
  lastError,
});

const createCacheSection = (inventory: AppCacheInventory | null, lastError: string | null): LibraryHealthReportCache => {
  if (!inventory) {
    return emptyCacheReport(lastError);
  }

  return {
    generatedAt: inventory.generatedAt,
    totalSizeBytes: inventory.totalSizeBytes,
    lastError,
    items: inventory.items.map((item) => ({
      kind: item.kind,
      label: item.label,
      path: safePathSummary(item.path),
      sizeBytes: item.sizeBytes,
      fileCount: item.fileCount,
      movable: item.movable,
      reason: item.reason,
      lastError: safeText(item.lastError),
    })),
  };
};

const createRemoteSourcesSection = (
  sources: RemoteSource[],
  background: RemoteBackgroundGlobalStatus | null,
): LibraryHealthReportRemoteSources => {
  const statusCounts = sources.reduce(
    (counts, source) => {
      if (source.status === 'enabled') {
        counts.enabled += 1;
      } else if (source.status === 'disabled') {
        counts.disabled += 1;
      } else if (source.status === 'error') {
        counts.error += 1;
      }
      counts.indexedTrackCount += source.indexedTrackCount;
      return counts;
    },
    { enabled: 0, disabled: 0, error: 0, indexedTrackCount: 0 },
  );

  return {
    total: sources.length,
    enabled: statusCounts.enabled,
    disabled: statusCounts.disabled,
    error: statusCounts.error,
    indexedTrackCount: statusCounts.indexedTrackCount,
    backgroundPaused: background?.paused ?? false,
    backgroundPlaybackActive: background?.playbackActive ?? false,
    backgroundUpdatedAt: background?.updatedAt ?? null,
    lastError: safeText(sources.find((source) => source.lastError)?.lastError),
    sources: sources.map((source) => ({
      id: source.id,
      provider: source.provider,
      displayName: safeText(source.displayName) ?? source.provider,
      status: source.status,
      syncMode: source.syncMode,
      indexedTrackCount: source.indexedTrackCount,
      lastSyncAt: source.lastSyncAt,
      lastError: safeText(source.lastError),
    })),
  };
};

type LibraryHealthReportParts = {
  generatedAt: string;
  warnings: string[];
  summary: LibrarySummary;
  diagnostics: LibraryDiagnostics;
  databaseStatus: LibraryDatabaseProtectionStatus | null;
  quality: LibraryQualityOverviewItem[];
  labState: LibraryLabState;
  cacheInventory: AppCacheInventory | null;
  cacheError: string | null;
  remoteSources: RemoteSource[];
  remoteBackground: RemoteBackgroundGlobalStatus | null;
};

const assembleLibraryHealthReport = ({
  generatedAt,
  warnings,
  summary,
  diagnostics,
  databaseStatus,
  quality,
  labState,
  cacheInventory,
  cacheError,
  remoteSources,
  remoteBackground,
}: LibraryHealthReportParts): LibraryHealthReport => ({
  generatedAt,
  summary: {
    ...summary,
    warningCount: warnings.length,
  },
  database: createDatabaseSection(databaseStatus, diagnostics),
  scan: createScanSection(diagnostics),
  quality,
  cache: createCacheSection(cacheInventory, cacheError),
  watcher: createWatcherSection(labState),
  remoteSources: createRemoteSourcesSection(remoteSources, remoteBackground),
  warnings,
});

export const createLibraryHealthReport = (dependencies: LibraryHealthReportDependencies): LibraryHealthReport => {
  const warnings: string[] = [];
  const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const summary = trySection('曲库概况', warnings, emptySummary(), dependencies.getSummary);
  const diagnostics = trySection('曲库诊断', warnings, emptyDiagnostics(), dependencies.getDiagnostics);
  const databaseStatus = trySection<LibraryDatabaseProtectionStatus | null>('数据库保护', warnings, null, dependencies.getDatabaseProtectionStatus);
  const quality = trySection<LibraryQualityOverviewItem[]>('资料质量', warnings, [], dependencies.getQualityOverview);
  const labState = trySection('实时曲库更新', warnings, emptyLabState(), dependencies.getLibraryLabState);
  let cacheError: string | null = null;
  const cacheInventory = trySection<AppCacheInventory | null>('缓存清单', warnings, null, () => {
    try {
      return dependencies.getCacheInventory();
    } catch (error) {
      cacheError = safeError(error);
      throw error;
    }
  });
  const remoteSources = trySection<RemoteSource[]>('远程源', warnings, [], dependencies.listRemoteSources);
  const remoteBackground = trySection<RemoteBackgroundGlobalStatus | null>(
    '远程后台任务',
    warnings,
    null,
    dependencies.getRemoteBackgroundGlobalStatus,
  );

  return assembleLibraryHealthReport({
    generatedAt,
    warnings,
    summary,
    diagnostics,
    databaseStatus,
    quality,
    labState,
    cacheInventory,
    cacheError,
    remoteSources,
    remoteBackground,
  });
};

export const createLibraryHealthReportAsync = async (
  dependencies: AsyncLibraryHealthReportDependencies,
): Promise<LibraryHealthReport> => {
  const warnings: string[] = [];
  const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const summary = trySection('\u66f2\u5e93\u6982\u51b5', warnings, emptySummary(), dependencies.getSummary);
  const diagnostics = trySection('\u66f2\u5e93\u8bca\u65ad', warnings, emptyDiagnostics(), dependencies.getDiagnostics);
  const databaseStatus = trySection<LibraryDatabaseProtectionStatus | null>('\u6570\u636e\u5e93\u4fdd\u62a4', warnings, null, dependencies.getDatabaseProtectionStatus);
  const quality = trySection<LibraryQualityOverviewItem[]>('\u8d44\u6599\u8d28\u91cf', warnings, [], dependencies.getQualityOverview);
  const labState = trySection('\u5b9e\u65f6\u66f4\u65b0\u66f2\u5e93', warnings, emptyLabState(), dependencies.getLibraryLabState);
  let cacheError: string | null = null;
  const cacheInventory = await trySectionAsync<AppCacheInventory | null>('\u7f13\u5b58\u6e05\u5355', warnings, null, async () => {
    try {
      return await dependencies.getCacheInventory();
    } catch (error) {
      cacheError = safeError(error);
      throw error;
    }
  });
  const remoteSources = trySection<RemoteSource[]>('\u8fdc\u7a0b\u6e90', warnings, [], dependencies.listRemoteSources);
  const remoteBackground = trySection<RemoteBackgroundGlobalStatus | null>(
    '\u8fdc\u7a0b\u540e\u53f0\u4efb\u52a1',
    warnings,
    null,
    dependencies.getRemoteBackgroundGlobalStatus,
  );

  return assembleLibraryHealthReport({
    generatedAt,
    warnings,
    summary,
    diagnostics,
    databaseStatus,
    quality,
    labState,
    cacheInventory,
    cacheError,
    remoteSources,
    remoteBackground,
  });
};

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let nextValue = value;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  return `${nextValue >= 10 || unitIndex === 0 ? nextValue.toFixed(0) : nextValue.toFixed(1)} ${units[unitIndex] ?? 'B'}`;
};

const formatSafePath = (path: LibraryHealthSafePath | null): string => (path ? `${path.basename} (#${path.pathHash})` : '未记录');

const markdownEscape = (value: string | null | undefined): string => {
  if (!value) {
    return '无';
  }
  return redactPathLikeText(value).replace(/[\\`*_{}[\]()#+\-.!|]/gu, '\\$&');
};

const line = (label: string, value: string | number | boolean | null | undefined): string => `- ${label}: ${markdownEscape(String(value ?? '无'))}`;

export const renderLibraryHealthReportMarkdown = (report: LibraryHealthReport): string => {
  const qualityLines = report.quality.length
    ? report.quality.map((item) => line(item.label, `${item.count} (${item.severity})`))
    : ['- 无资料质量统计'];
  const cacheLines = report.cache.items.length
    ? report.cache.items.map((item) =>
        `- ${markdownEscape(item.label)}: ${markdownEscape(formatBytes(item.sizeBytes))}, ${item.fileCount} files, ${item.movable ? 'movable' : 'fixed'}, ${markdownEscape(formatSafePath(item.path))}`,
      )
    : ['- 无缓存统计'];
  const remoteLines = report.remoteSources.sources.length
    ? report.remoteSources.sources.map((source) =>
        `- ${markdownEscape(source.provider)} / ${markdownEscape(source.displayName)}: ${markdownEscape(source.status)}, indexed ${source.indexedTrackCount}, last sync ${markdownEscape(source.lastSyncAt ?? '无')}`,
      )
    : ['- 无远程源'];
  const warningLines = report.warnings.length ? report.warnings.map((warning) => `- ${markdownEscape(warning)}`) : ['- 无'];

  return [
    '# ECHO Next 曲库体检报告',
    '',
    line('生成时间', report.generatedAt),
    line('歌曲', report.summary.songCount),
    line('专辑', report.summary.albumCount),
    line('艺人', report.summary.artistCount),
    line('文件夹', report.summary.folderCount),
    line('最近扫描', report.summary.lastScanAt ?? '无'),
    '',
    '## 数据库',
    line('保护状态', report.database.status),
    line('健康状态', report.database.healthStatus),
    line('恢复建议', report.database.recommendedAction),
    line('不可恢复原因', report.database.unrecoverableReason ?? '无'),
    line('可恢复健康快照', report.database.canRestoreSnapshot ? '是' : '否'),
    line('数据库大小', formatBytes(report.database.databaseSizeBytes ?? 0)),
    line('数据库路径', formatSafePath(report.database.databasePath)),
    '',
    '## 扫描',
    line('状态', report.scan.status),
    line('阶段', report.scan.phase),
    line('错误数', report.scan.errorCount),
    line('性能档位', report.scan.performanceMode),
    line('元数据并发', report.scan.metadataConcurrency ?? '未知'),
    line('封面并发', report.scan.coverConcurrency ?? '未知'),
    '',
    '## 资料质量',
    ...qualityLines,
    '',
    '## 缓存',
    line('合计', formatBytes(report.cache.totalSizeBytes)),
    ...cacheLines,
    '',
    '## 实时曲库更新',
    line('开启', report.watcher.enabled ? '是' : '否'),
    line('监听文件夹', report.watcher.watchedFolderCount),
    line('待处理路径', report.watcher.pendingPathCount),
    line('跳过删除事件', report.watcher.skippedDeleteEventCount),
    line('跳过重命名事件', report.watcher.skippedRenameEventCount),
    line('最近错误', report.watcher.lastError ?? report.watcher.lastRescanError ?? '无'),
    '',
    '## 远程源',
    line('源数量', report.remoteSources.total),
    line('启用', report.remoteSources.enabled),
    line('错误', report.remoteSources.error),
    line('已索引曲目', report.remoteSources.indexedTrackCount),
    ...remoteLines,
    '',
    '## 警告',
    ...warningLines,
    '',
  ].join('\n');
};

export const writeLibraryHealthReportMarkdown = (report: LibraryHealthReport, outputPath: string): string => {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${renderLibraryHealthReportMarkdown(report)}\n`, 'utf8');
  return outputPath;
};
