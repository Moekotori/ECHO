import type {
  ArtistOnlineInfoSource,
  ArtistStreamingAlbumsProvider,
  AppSettings,
} from '../../../../shared/types/appSettings';
import type {
  ArtistImageCacheSummary,
  ArtistImageJobStatus,
  LibraryScanStatus,
} from '../../../../shared/types/library';
import type { TranslationKey } from '../../../i18n/locales';
import type {
  LibraryScanStageId,
  LibraryScanTotals,
} from '../../../utils/libraryScanProgress';

export type ArtistImageProgress = ArtistImageJobStatus & {
  startedAt: number;
};

export const networkProviderLabels: Record<AppSettings['networkMetadataProviders'][number], string> = {
  'netease-cloud-music': '网易云音乐',
  'qq-music': 'QQ 音乐',
  'kugou-music': '酷狗音乐',
  musicbrainz: 'MusicBrainz',
  'cover-art-archive': 'Cover Art Archive',
  mock: 'Mock',
};

export const visibleNetworkMetadataProviders: AppSettings['networkMetadataProviders'] = [
  'netease-cloud-music',
  'qq-music',
  'musicbrainz',
];

export const defaultNetworkMetadataProviders: AppSettings['networkMetadataProviders'] = [
  'netease-cloud-music',
  'qq-music',
];

export const artistOnlineInfoSourceOptions: Array<{
  source: ArtistOnlineInfoSource;
  label: string;
  description: string;
}> = [
  { source: 'baidu-baike', label: '百度百科', description: '中文艺人和大众歌手优先' },
  { source: 'wikipedia', label: 'Wikipedia', description: '国际艺人兜底' },
];

export const artistStreamingAlbumProviderOptions: Array<{
  provider: ArtistStreamingAlbumsProvider;
  label: string;
  description: string;
}> = [
  { provider: 'netease', label: '网易云', description: '默认来源，优先减少额外搜索压力' },
  { provider: 'qqmusic', label: 'QQ音乐', description: '艺人详情专辑页改用 QQ 音乐搜索' },
];

export const libraryScanRunningStatuses = new Set<LibraryScanStatus['status']>(['queued', 'running']);

const libraryScanPhaseLabelKeys: Record<LibraryScanStatus['phase'], TranslationKey> = {
  queued: 'mediaLibrary.folders.status.queued',
  discovering: 'mediaLibrary.folders.phase.discovering',
  checking_cache: 'mediaLibrary.folders.phase.checkingCache',
  reading_metadata: 'mediaLibrary.folders.phase.readingMetadata',
  extracting_covers: 'mediaLibrary.folders.phase.extractingCovers',
  grouping_albums: 'mediaLibrary.settings.scan.phase.grouping',
  writing_database: 'mediaLibrary.folders.phase.writingDatabase',
  finished: 'mediaLibrary.folders.phase.finished',
  failed: 'mediaLibrary.folders.phase.failed',
  cancelled: 'mediaLibrary.folders.status.cancelled',
};

export const libraryScanStageLabelKeys: Record<LibraryScanStageId, TranslationKey> = {
  discovering: 'mediaLibrary.scanProgress.stage.discovering',
  checking_cache: 'mediaLibrary.scanProgress.stage.checkingCache',
  reading_metadata: 'mediaLibrary.scanProgress.stage.readingMetadata',
  extracting_covers: 'mediaLibrary.scanProgress.stage.extractingCovers',
  grouping_albums: 'mediaLibrary.scanProgress.stage.groupingAlbums',
  writing_database: 'mediaLibrary.scanProgress.stage.writingDatabase',
};

export const libraryScanStageMetricLabelKeys: Record<LibraryScanStageId, TranslationKey> = {
  discovering: 'mediaLibrary.scanProgress.metric.files',
  checking_cache: 'mediaLibrary.scanProgress.metric.skipped',
  reading_metadata: 'mediaLibrary.scanProgress.metric.metadata',
  extracting_covers: 'mediaLibrary.scanProgress.metric.covers',
  grouping_albums: 'mediaLibrary.scanProgress.metric.albums',
  writing_database: 'mediaLibrary.scanProgress.metric.written',
};

export const libraryScanResultMetrics: Array<{
  id: string;
  labelKey: TranslationKey;
  getValue: (totals: LibraryScanTotals) => number;
}> = [
  { id: 'added', labelKey: 'mediaLibrary.scanProgress.result.added', getValue: (totals) => totals.addedTracks },
  { id: 'updated', labelKey: 'mediaLibrary.scanProgress.result.updated', getValue: (totals) => totals.updatedTracks },
  { id: 'removed', labelKey: 'mediaLibrary.scanProgress.result.removed', getValue: (totals) => totals.removedTracks },
  { id: 'skipped', labelKey: 'mediaLibrary.scanProgress.result.skipped', getValue: (totals) => totals.skippedFiles },
  { id: 'covers', labelKey: 'mediaLibrary.scanProgress.result.covers', getValue: (totals) => totals.coverCount },
  { id: 'errors', labelKey: 'mediaLibrary.scanProgress.result.errors', getValue: (totals) => totals.errorCount },
];

export const formatLibraryScanProgressMessage = (
  statuses: LibraryScanStatus[],
  t: (key: TranslationKey, options?: Record<string, string | number>) => string,
): string | null => {
  if (statuses.length === 0) {
    return null;
  }

  const active = statuses.filter((status) => libraryScanRunningStatuses.has(status.status));
  const failed = statuses.filter((status) => status.status === 'failed').length;
  const completed = statuses.filter((status) => status.status === 'completed').length;
  const cancelled = statuses.filter((status) => status.status === 'cancelled').length;
  const totalFiles = statuses.reduce((total, status) => total + status.totalFiles, 0);
  const processedFiles = statuses.reduce((total, status) => total + status.processedFiles, 0);
  const skippedFiles = statuses.reduce((total, status) => total + status.skippedFiles, 0);
  const errorCount = statuses.reduce((total, status) => total + status.errorCount, 0);

  if (active.length > 0) {
    const current = active.find((status) => status.status === 'running') ?? active[0];
    const phase = current
      ? t(libraryScanPhaseLabelKeys[current.phase] ?? 'mediaLibrary.folders.status.running')
      : t('mediaLibrary.folders.status.running');
    return t('mediaLibrary.settings.scan.progressMessage.running', {
      processed: processedFiles,
      total: totalFiles || '?',
      skipped: skippedFiles,
      errors: errorCount,
      phase,
      active: active.length,
    });
  }

  return t('mediaLibrary.settings.scan.progressMessage.finished', {
    completed,
    cancelled,
    failed,
    processed: processedFiles,
    total: totalFiles || 0,
    skipped: skippedFiles,
    errors: errorCount,
  });
};

export const emptyArtistImageSummary: ArtistImageCacheSummary = {
  total: 0,
  matched: 0,
  pending: 0,
  loading: 0,
  notFound: 0,
  error: 0,
  rateLimited: 0,
};
