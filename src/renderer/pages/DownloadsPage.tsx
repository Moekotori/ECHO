import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileAudio,
  FolderOpen,
  Heart,
  Link2,
  ListChecks,
  LogIn,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Square,
  Trash2,
  Trophy,
  UserRound,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import type { AccountStatus } from '../../shared/types/accounts';
import type {
  CreateDownloadUrlJobOptions,
  DownloadJob,
  DownloadJobStatus,
  DownloadSearchProvider,
  DownloadSearchResponse,
  DownloadSearchResult,
  DownloadSearchScope,
  DownloadSettings,
  DownloadToolsStatus,
  OsuAccountBeatmapItem,
  OsuAccountCollectionKind,
  OsuAccountCollectionResponse,
  OsuAccountProfile,
  OsuDownloadMirror,
  OsuRuleset,
} from '../../shared/types/downloads';
import { EmptyState } from '../components/ui/EmptyState';
import { translateFallback, useOptionalI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { getAccountsBridge, getDownloadsBridge } from '../utils/echoBridge';
import { isImeComposingKeyEvent } from '../utils/imeInput';
import { formatUserFacingError } from '../utils/userFacingError';

const terminalStatuses = new Set<DownloadJobStatus>(['completed', 'failed', 'cancelled']);
const runningStatuses = new Set<DownloadJobStatus>(['queued', 'probing', 'downloading', 'extracting_audio', 'importing', 'binding_mv']);

const defaultSettings: DownloadSettings = {
  audioStrategy: 'best_available',
  importToLibrary: true,
  bindMvAfterImport: true,
  outputDirectory: null,
  osuOutputDirectory: null,
  osuDownloadMirror: 'auto',
};

const statusLabelKeys: Record<DownloadJobStatus, TranslationKey> = {
  queued: 'downloads.status.queued',
  probing: 'downloads.status.probing',
  downloading: 'downloads.status.downloading',
  extracting_audio: 'downloads.status.extractingAudio',
  importing: 'downloads.status.importing',
  binding_mv: 'downloads.status.bindingMv',
  completed: 'downloads.status.completed',
  failed: 'downloads.status.failed',
  cancelled: 'downloads.status.cancelled',
};

const providerLabels: Record<DownloadJob['provider'], string> & Record<DownloadSearchProvider, string> = {
  youtube: 'YouTube',
  bilibili: 'Bilibili',
  soundcloud: 'SoundCloud',
  osu: 'osu!',
  unknown: 'URL',
};

const searchScopeLabels: Record<DownloadSearchScope, string> = {
  all: 'YouTube + Bilibili + osu!',
  youtube: 'YouTube',
  bilibili: 'Bilibili',
  osu: 'osu!',
};

const osuDownloadMirrorOptions: Array<{ value: OsuDownloadMirror; labelKey: TranslationKey; detailKey: TranslationKey }> = [
  { value: 'auto', labelKey: 'downloads.settings.osuMirror.auto', detailKey: 'downloads.settings.osuMirror.autoDetail' },
  { value: 'official', labelKey: 'downloads.settings.osuMirror.official', detailKey: 'downloads.settings.osuMirror.officialDetail' },
  { value: 'sayobot', labelKey: 'downloads.settings.osuMirror.sayobot', detailKey: 'downloads.settings.osuMirror.mirrorDetail' },
  { value: 'catboy', labelKey: 'downloads.settings.osuMirror.catboy', detailKey: 'downloads.settings.osuMirror.mirrorDetail' },
  { value: 'nerinyan', labelKey: 'downloads.settings.osuMirror.nerinyan', detailKey: 'downloads.settings.osuMirror.mirrorDetail' },
];

const searchScopes: DownloadSearchScope[] = ['all', 'youtube', 'bilibili', 'osu'];
const compactOsuQueueHistoryLimit = 30;
const osuRulesetOptions: Array<{ value: OsuRuleset; label: string }> = [
  { value: 'osu', label: 'osu!' },
  { value: 'taiko', label: 'osu!taiko' },
  { value: 'fruits', label: 'osu!catch' },
  { value: 'mania', label: 'osu!mania' },
];

type DownloadsPageProps = {
  variant?: 'all' | 'osu';
};

type Translate = (key: TranslationKey, options?: Record<string, string | number>) => string;
type OsuWorkspaceView = OsuAccountCollectionKind | 'search';
type OsuCollectionCache = Partial<Record<OsuAccountCollectionKind, OsuAccountCollectionResponse>>;
type OsuSelectionCache = Partial<Record<OsuAccountCollectionKind, string[]>>;
type OsuPageSessionState = {
  profile: OsuAccountProfile | null;
  collections: OsuCollectionCache;
  collectionKind: OsuAccountCollectionKind;
  workspaceView: OsuWorkspaceView;
  ruleset: OsuRuleset;
  bpStart: number;
  bpEnd: number;
  selectedItemKeysByKind: OsuSelectionCache;
  searchInput: string;
  searchResponse: DownloadSearchResponse;
  submittedSearch: { query: string; scope: DownloadSearchScope } | null;
};
type DownloadNotice = {
  tone: 'info' | 'success' | 'error';
  title: string;
  detail?: string | null;
  jobId?: string | null;
};

const osuPageSessionStorageKey = 'echo-next.osu-downloader-page.v1';
const osuCollectionKinds = new Set<OsuAccountCollectionKind>(['best', 'favourites', 'most_played']);
const osuWorkspaceViews = new Set<OsuWorkspaceView>(['best', 'favourites', 'most_played', 'search']);

const readOsuPageSession = (): OsuPageSessionState | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(osuPageSessionStorageKey);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<OsuPageSessionState> & {
      collection?: OsuAccountCollectionResponse | null;
    };
    const profile =
      value.profile &&
      typeof value.profile.userId === 'number' &&
      typeof value.profile.username === 'string'
        ? value.profile
        : null;
    const legacyCollection =
      value.collection &&
      osuCollectionKinds.has(value.collection.kind) &&
      Array.isArray(value.collection.items)
        ? value.collection
        : null;
    const collections: OsuCollectionCache = {};
    for (const kind of osuCollectionKinds) {
      const candidate = value.collections?.[kind];
      if (candidate?.kind === kind && Array.isArray(candidate.items)) {
        collections[kind] = candidate;
      }
    }
    if (legacyCollection && !collections[legacyCollection.kind]) {
      collections[legacyCollection.kind] = legacyCollection;
    }
    const collectionKind = osuCollectionKinds.has(value.collectionKind as OsuAccountCollectionKind)
      ? value.collectionKind as OsuAccountCollectionKind
      : legacyCollection?.kind ?? 'best';
    const legacySelectedItemKeys = (value as Partial<OsuPageSessionState> & { selectedItemKeys?: unknown }).selectedItemKeys;
    const selectedItemKeysByKind: OsuSelectionCache = {};
    for (const kind of osuCollectionKinds) {
      const keys = value.selectedItemKeysByKind?.[kind];
      if (Array.isArray(keys)) {
        selectedItemKeysByKind[kind] = keys.filter((key): key is string => typeof key === 'string');
      }
    }
    if (Array.isArray(legacySelectedItemKeys) && !selectedItemKeysByKind[collectionKind]) {
      selectedItemKeysByKind[collectionKind] = legacySelectedItemKeys.filter(
        (key): key is string => typeof key === 'string',
      );
    }

    return {
      profile,
      collections,
      collectionKind,
      workspaceView: osuWorkspaceViews.has(value.workspaceView as OsuWorkspaceView)
        ? value.workspaceView as OsuWorkspaceView
        : collectionKind,
      ruleset: osuRulesetOptions.some((option) => option.value === value.ruleset) ? value.ruleset! : 'osu',
      bpStart: typeof value.bpStart === 'number' ? value.bpStart : 1,
      bpEnd: typeof value.bpEnd === 'number' ? value.bpEnd : 100,
      selectedItemKeysByKind,
      searchInput: typeof value.searchInput === 'string' ? value.searchInput : '',
      searchResponse:
        value.searchResponse &&
        Array.isArray(value.searchResponse.results) &&
        Array.isArray(value.searchResponse.errors)
          ? value.searchResponse
          : { results: [], errors: [] },
      submittedSearch:
        value.submittedSearch &&
        typeof value.submittedSearch.query === 'string' &&
        value.submittedSearch.scope === 'osu'
          ? value.submittedSearch
          : null,
    };
  } catch {
    return null;
  }
};

const clearOsuPageSession = (): void => {
  try {
    window.sessionStorage.removeItem(osuPageSessionStorageKey);
  } catch {
    // Session storage is an optimization; account state still works without it.
  }
};

const formatError = (error: unknown, t: Translate): string =>
  formatUserFacingError(error, { context: 'downloads', fallback: t('downloads.error.operationFailed') });

const osuBeatmapsetIdFromUrl = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (host !== 'osu.ppy.sh' && host !== 'www.osu.ppy.sh') {
      return null;
    }
    return url.pathname.match(/^\/(?:beatmapsets|s)\/(\d+)(?:\/|$)/u)?.[1] ?? null;
  } catch {
    return null;
  }
};

const isOsuBeatmapsetUrl = (value: string): boolean => osuBeatmapsetIdFromUrl(value) !== null;

const formatOsuAccountError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('osu_account_login_required')) {
    return '请先登录 osu! 账号，再加载你的 BP 和收藏。';
  }
  if (message.includes('osu_account_login_expired')) {
    return 'osu! 登录已失效，请重新登录后再试。';
  }
  if (message.includes('osu_favourites_limit_exceeded')) {
    return '收藏数量过多，已达到本次加载上限。';
  }
  const cleaned = message.replace(/^Error invoking remote method '[^']+': Error:\s*/u, '');
  if (/HTTP 429|too many requests/iu.test(cleaned)) {
    return 'osu! 请求过于频繁，请稍等片刻后重试。';
  }
  if (/HTTP 5\d\d|fetch failed|network|ECONN/iu.test(cleaned)) {
    return '暂时无法连接 osu!，请检查网络或稍后重试。';
  }
  if (/unexpected response|invalid osu/iu.test(cleaned)) {
    return 'osu! 返回了无法识别的数据，请重启 ECHO 或更新后重试。';
  }
  return cleaned || '读取 osu! 账号数据失败。';
};

const formatOsuAccuracy = (accuracy: number | null): string | null => {
  if (accuracy === null || !Number.isFinite(accuracy)) {
    return null;
  }
  return `${(accuracy * 100).toFixed(2)}%`;
};

const osuProfileNumberFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
});

const formatOsuProfileNumber = (value: number | null, suffix = ''): string =>
  value === null || !Number.isFinite(value) ? '-' : `${osuProfileNumberFormatter.format(value)}${suffix}`;

const formatOsuProfileAccuracy = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return '-';
  }

  const percentage = value <= 1 ? value * 100 : value;
  return `${percentage.toFixed(2)}%`;
};

const formatOsuPlayTime = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '-';
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days > 0) {
    return `${days}天 ${hours}小时`;
  }
  return `${hours}小时`;
};

const splitOsuDisplayTitle = (value: string): { title: string; artist: string | null } => {
  const parts = value.split(/\s+-\s+/u).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { title: value, artist: null };
  }

  const [artist, ...titleParts] = parts;
  return {
    artist: artist || null,
    title: titleParts.join(' - ') || value,
  };
};

const formatSearchDate = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
};

const formatSearchProviderError = (error: string, t: Translate): string => {
  const message = error.replace(/\s+/gu, ' ').trim();
  if (/could not copy .*cookie database/iu.test(message)) {
    return t('downloads.error.cookieFallback');
  }

  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
};

const formatPath = (path: string | null, t: Translate): string => path || t('downloads.folder.required');

const formatDuration = (seconds: number | null): string | null => {
  if (!seconds || !Number.isFinite(seconds)) {
    return null;
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}:${String(restSeconds).padStart(2, '0')}`;
};

const formatBytes = (bytes: number | null): string | null => {
  if (bytes === null || !Number.isFinite(bytes)) {
    return null;
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const formatEta = (seconds: number | null): string | null => {
  if (seconds === null || !Number.isFinite(seconds)) {
    return null;
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}:${String(restSeconds).padStart(2, '0')}`;
};

const formatViews = (views: number | null, t: Translate): string | null => {
  if (views === null || !Number.isFinite(views)) {
    return null;
  }

  if (views >= 10000) {
    return t('downloads.search.viewsWan', { count: (views / 10000).toFixed(views >= 100000 ? 0 : 1) });
  }

  return t('downloads.search.views', { count: Math.round(views) });
};

const searchResultKey = (result: DownloadSearchResult): string => `${result.provider}:${result.id}`;

const ToolStatus = ({ label, ready, detail }: { label: string; ready: boolean; detail: string }): JSX.Element => (
  <span className="download-tool-pill" data-ready={ready}>
    {ready ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
    <strong>{label}</strong>
    <em>{detail}</em>
  </span>
);

const JobRow = ({
  job,
  onCancel,
  compact = false,
}: {
  job: DownloadJob;
  onCancel: (jobId: string) => void;
  compact?: boolean;
}): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const canCancel = runningStatuses.has(job.status);
  const duration = formatDuration(job.durationSeconds);
  const downloaded = formatBytes(job.downloadedBytes);
  const total = formatBytes(job.totalBytes);
  const speed = formatBytes(job.speedBytesPerSecond);
  const eta = formatEta(job.etaSeconds);
  const indeterminateProgress = job.status === 'downloading' && !job.totalBytes;
  const progressLabel = indeterminateProgress ? t('downloads.job.receiving') : `${Math.round(job.progress)}%`;
  const transferDetail = [speed ? `${speed}/s` : null, eta ? `ETA ${eta}` : null].filter(Boolean).join(' · ');
  const artist = job.artist?.trim() || null;
  const compactTitle = artist && job.title?.startsWith(`${artist} - `) ? job.title.slice(artist.length + 3) : (job.title ?? 'Untitled download');
  const beatmapsetId = osuBeatmapsetIdFromUrl(job.sourceUrl);
  const compactDetails = [beatmapsetId ? `osu! #${beatmapsetId}` : providerLabels[job.provider], duration].filter(Boolean).join(' · ');
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  useEffect(() => {
    setThumbnailFailed(false);
  }, [job.thumbnailUrl]);

  if (compact) {
    return (
      <article className="download-job-row download-job-row--compact" data-status={job.status}>
        <div className="download-job-main">
          <span className="download-job-artwork">
            {job.thumbnailUrl && !thumbnailFailed ? (
              <img src={job.thumbnailUrl} alt="" onError={() => setThumbnailFailed(true)} />
            ) : (
              <FileAudio size={19} />
            )}
          </span>
          <div className="download-job-copy">
            <strong title={compactTitle}>{compactTitle}</strong>
            <span title={artist ?? undefined}>{artist ?? providerLabels[job.provider]}</span>
            <small className="download-job-source">{compactDetails}</small>
          </div>
        </div>

        <div className="download-job-progress">
          <div className="download-progress-track" data-indeterminate={indeterminateProgress || undefined} aria-label={progressLabel}>
            <span style={indeterminateProgress ? undefined : { width: `${job.progress}%` }} />
          </div>
          <div className="download-job-meta">
            <span>{t(statusLabelKeys[job.status])}</span>
            <em>{progressLabel}</em>
          </div>
          <div className="download-job-meta">
            <span>{downloaded && total ? `${downloaded} / ${total}` : downloaded ?? t('downloads.job.waitingProgress')}</span>
            <em>{transferDetail}</em>
          </div>
          {job.outputPath ? <small className="download-job-path" title={job.outputPath}>{t('downloads.job.savedTo', { path: job.outputPath })}</small> : null}
          {job.error ? <small className="download-job-error" title={job.error}>{job.error}</small> : null}
        </div>

        <button className="download-icon-button" type="button" disabled={!canCancel} onClick={() => onCancel(job.id)} aria-label={t('downloads.action.cancelJob')} title={t('downloads.action.cancelJob')}>
          <Square size={14} />
        </button>
      </article>
    );
  }

  return (
    <article className="download-job-row" data-status={job.status}>
      <div className="download-job-main">
        <span className="download-job-icon">
          <FileAudio size={18} />
        </span>
        <div className="download-job-copy">
          <strong>{job.title ?? 'Untitled download'}</strong>
          <span title={job.sourceUrl}>{job.sourceUrl}</span>
          {job.outputPath ? <small title={job.outputPath}>{t('downloads.job.savedTo', { path: job.outputPath })}</small> : null}
          {duration ? <small>{duration}</small> : null}
        </div>
        <span className="download-provider-chip">{providerLabels[job.provider]}</span>
      </div>

      <div className="download-job-progress">
        <div className="download-progress-track" data-indeterminate={indeterminateProgress || undefined} aria-label={progressLabel}>
          <span style={indeterminateProgress ? undefined : { width: `${job.progress}%` }} />
        </div>
        <div className="download-job-meta">
          <span>{t(statusLabelKeys[job.status])}</span>
          <em>{progressLabel}</em>
        </div>
        <div className="download-job-meta">
          <span>{downloaded && total ? `${downloaded} / ${total}` : downloaded ?? t('downloads.job.waitingProgress')}</span>
          <em>{transferDetail}</em>
        </div>
        {job.importedTrackId ? <small>{t('downloads.job.imported')}</small> : null}
        {job.error ? <p>{job.error}</p> : null}
      </div>

      <button className="download-icon-button" type="button" disabled={!canCancel} onClick={() => onCancel(job.id)} aria-label={t('downloads.action.cancelJob')} title={t('downloads.action.cancelJob')}>
        <Square size={15} />
      </button>
    </article>
  );
};

const SearchResultRow = ({
  result,
  joined,
  onDownload,
}: {
  result: DownloadSearchResult;
  joined: boolean;
  onDownload: (result: DownloadSearchResult) => void;
}): JSX.Element => {
  const duration = formatDuration(result.durationSeconds);
  const t = useOptionalI18n()?.t ?? translateFallback;
  const views = formatViews(result.viewCount, t);
  const publishedAt = formatSearchDate(result.publishedAt);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  useEffect(() => {
    setThumbnailFailed(false);
  }, [result.thumbnailUrl]);

  return (
    <article className="download-search-result">
      <div className="download-search-thumb">
        {result.thumbnailUrl && !thumbnailFailed ? (
          <img src={result.thumbnailUrl} alt="" onError={() => setThumbnailFailed(true)} />
        ) : (
          <FileAudio size={18} />
        )}
      </div>
      <div className="download-search-copy">
        <div>
          <span className="download-provider-chip">{providerLabels[result.provider]}</span>
          {duration ? <em>{duration}</em> : null}
        </div>
        <strong title={result.title}>{result.title}</strong>
        <span title={result.uploader ?? undefined}>{result.uploader ?? t('downloads.search.unknownUploader')}</span>
        <small>{[views, publishedAt].filter(Boolean).join(' · ') || result.webpageUrl}</small>
      </div>
      <button className="downloads-action-button" type="button" disabled={joined} onClick={() => onDownload(result)}>
        <Download size={15} />
        {joined ? t('downloads.search.joined') : t('downloads.search.downloadAudio')}
      </button>
    </article>
  );
};

const OsuAccountBeatmapRow = ({
  item,
  kind,
  downloadState,
  busy,
  selected,
  onToggle,
  onQueue,
  onOpen,
}: {
  item: OsuAccountBeatmapItem;
  kind: OsuAccountCollectionKind;
  downloadState: 'queued' | 'downloaded' | null;
  busy: boolean;
  selected: boolean;
  onToggle: () => void;
  onQueue: () => void;
  onOpen: () => void;
}): JSX.Element => {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const accuracy = formatOsuAccuracy(item.accuracy);
  const scoreDetails = [
    item.pp !== null ? `${item.pp.toFixed(1)}pp` : null,
    accuracy,
    item.scoreRank,
    item.mods.length > 0 ? `+${item.mods.join('')}` : null,
  ].filter(Boolean);
  const difficultyDetails = [
    item.difficultyName,
    item.starRating !== null ? `${item.starRating.toFixed(2)}★` : null,
    formatDuration(item.durationSeconds),
  ].filter(Boolean);
  const positionLabel =
    kind === 'best'
      ? `BP #${item.position}`
      : kind === 'most_played'
        ? `游玩 #${item.position}`
        : `收藏 #${item.position}`;

  useEffect(() => {
    setThumbnailFailed(false);
  }, [item.coverUrl]);

  return (
    <article className="osu-account-beatmap-row" data-selected={selected} data-queued={downloadState === 'queued'} data-downloaded={downloadState === 'downloaded'}>
      <label className="osu-account-beatmap-check">
        <input
          type="checkbox"
          checked={selected}
          disabled={downloadState !== null}
          aria-label={downloadState === 'queued' ? `${item.title} 已在队列` : downloadState === 'downloaded' ? `${item.title} 已下载` : `选择 ${item.title}`}
          onChange={onToggle}
        />
        <span>{selected || downloadState !== null ? <Check size={13} /> : null}</span>
      </label>
      <div className="osu-account-beatmap-cover">
        {item.coverUrl && !thumbnailFailed ? (
          <img src={item.coverUrl} alt="" onError={() => setThumbnailFailed(true)} />
        ) : (
          <FileAudio size={18} />
        )}
      </div>
      <div className="osu-account-beatmap-copy">
        <div className="osu-account-beatmap-heading">
          <span className="osu-account-position">{positionLabel}</span>
          <strong title={item.title}>{item.title}</strong>
          {item.playCount !== null ? (
            <span className="osu-account-play-count" title={`游玩 ${formatOsuProfileNumber(item.playCount)} 次`}>
              <Play size={12} fill="currentColor" />
              {formatOsuProfileNumber(item.playCount)} 次
            </span>
          ) : null}
        </div>
        <span className="osu-account-beatmap-artist" title={item.artist ?? undefined}>
          {[item.artist, item.creator ? `谱师 ${item.creator}` : null].filter(Boolean).join(' · ')}
        </span>
        <div className="osu-account-beatmap-meta">
          {scoreDetails.length > 0 ? <em>{scoreDetails.join(' · ')}</em> : null}
          {difficultyDetails.length > 0 ? <small>{difficultyDetails.join(' · ')}</small> : null}
        </div>
      </div>
      <div className="osu-account-beatmap-actions">
        {downloadState ? (
          <span className="osu-account-queued-badge">{downloadState === 'queued' ? '已在队列' : '已下载'}</span>
        ) : (
          <button type="button" disabled={busy} aria-label={`下载 ${item.title}`} title="加入下载队列" onClick={onQueue}>
            <Download size={14} />
          </button>
        )}
        <button type="button" aria-label={`打开 ${item.title} 的 osu! 页面`} title="在 osu! 打开" onClick={onOpen}>
          <ExternalLink size={14} />
        </button>
      </div>
    </article>
  );
};

export const DownloadsPage = ({ variant = 'all' }: DownloadsPageProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const osuOnly = variant === 'osu';
  const initialOsuSessionRef = useRef<OsuPageSessionState | null>(osuOnly ? readOsuPageSession() : null);
  const initialOsuSession = initialOsuSessionRef.current;
  const [url, setUrl] = useState('');
  const [searchInput, setSearchInput] = useState(osuOnly ? initialOsuSession?.searchInput ?? '' : '');
  const [searchScope, setSearchScope] = useState<DownloadSearchScope>(osuOnly ? 'osu' : 'all');
  const [searchResponse, setSearchResponse] = useState<DownloadSearchResponse>(
    osuOnly ? initialOsuSession?.searchResponse ?? { results: [], errors: [] } : { results: [], errors: [] },
  );
  const [submittedSearch, setSubmittedSearch] = useState<{ query: string; scope: DownloadSearchScope } | null>(
    osuOnly ? initialOsuSession?.submittedSearch ?? null : null,
  );
  const [joinedResultKeys, setJoinedResultKeys] = useState<Set<string>>(() => new Set());
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [settings, setSettings] = useState<DownloadSettings>(defaultSettings);
  const [tools, setTools] = useState<DownloadToolsStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<DownloadNotice | null>(null);
  const [showAllOsuQueueHistory, setShowAllOsuQueueHistory] = useState(false);
  const [busyAction, setBusyAction] = useState<'create' | 'clear' | 'tools' | 'folder' | 'search' | null>(null);
  const [needsFolder, setNeedsFolder] = useState(false);
  const [osuAccountStatus, setOsuAccountStatus] = useState<AccountStatus | null>(null);
  const [osuAccountProfile, setOsuAccountProfile] = useState<OsuAccountProfile | null>(initialOsuSession?.profile ?? null);
  const [osuCollectionKind, setOsuCollectionKind] = useState<OsuAccountCollectionKind>(initialOsuSession?.collectionKind ?? 'best');
  const [osuWorkspaceView, setOsuWorkspaceView] = useState<OsuWorkspaceView>(initialOsuSession?.workspaceView ?? 'best');
  const [osuRuleset, setOsuRuleset] = useState<OsuRuleset>(initialOsuSession?.ruleset ?? 'osu');
  const [osuBpStart, setOsuBpStart] = useState(initialOsuSession?.bpStart ?? 1);
  const [osuBpEnd, setOsuBpEnd] = useState(initialOsuSession?.bpEnd ?? 100);
  const [osuCollections, setOsuCollections] = useState<OsuCollectionCache>(initialOsuSession?.collections ?? {});
  const [selectedOsuItemKeysByKind, setSelectedOsuItemKeysByKind] = useState<OsuSelectionCache>(
    initialOsuSession?.selectedItemKeysByKind ?? {},
  );
  const [osuCollectionFilter, setOsuCollectionFilter] = useState('');
  const [osuAccountBusy, setOsuAccountBusy] = useState<'login' | 'profile' | 'refresh' | 'collection' | 'more' | 'download' | null>(null);
  const [osuAccountError, setOsuAccountError] = useState<string | null>(null);
  const [osuAccountMessage, setOsuAccountMessage] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const jobStatusRef = useRef<Map<string, DownloadJobStatus>>(new Map());
  const settingsRequestRef = useRef(0);
  const osuDownloadMirrorRef = useRef<OsuDownloadMirror>(settings.osuDownloadMirror);

  const bridge = getDownloadsBridge();
  const accountsBridge = getAccountsBridge();
  const osuCollection = osuCollections[osuCollectionKind] ?? null;
  const selectedOsuItemKeys = useMemo(
    () => new Set(selectedOsuItemKeysByKind[osuCollectionKind] ?? []),
    [osuCollectionKind, selectedOsuItemKeysByKind],
  );
  const setSelectedOsuItemKeys = useCallback((
    update: Set<string> | ((current: Set<string>) => Set<string>),
  ): void => {
    setSelectedOsuItemKeysByKind((current) => {
      const currentKeys = new Set(current[osuCollectionKind] ?? []);
      const nextKeys = typeof update === 'function' ? update(currentKeys) : update;
      return { ...current, [osuCollectionKind]: [...nextKeys] };
    });
  }, [osuCollectionKind]);
  const activeSearchScope: DownloadSearchScope = osuOnly ? 'osu' : searchScope;
  const visibleJobs = useMemo(() => (osuOnly ? jobs.filter((job) => job.provider === 'osu') : jobs), [jobs, osuOnly]);
  const completedCount = useMemo(() => visibleJobs.filter((job) => terminalStatuses.has(job.status)).length, [visibleJobs]);
  const displayedJobs = useMemo(() => {
    if (!osuOnly || showAllOsuQueueHistory) {
      return visibleJobs;
    }
    const activeJobs = visibleJobs.filter((job) => !terminalStatuses.has(job.status));
    const historyJobs = visibleJobs.filter((job) => terminalStatuses.has(job.status));
    return [...activeJobs, ...historyJobs.slice(0, compactOsuQueueHistoryLimit)];
  }, [osuOnly, showAllOsuQueueHistory, visibleJobs]);
  const hiddenOsuQueueHistoryCount = osuOnly ? Math.max(0, visibleJobs.length - displayedJobs.length) : 0;
  const activeJobCount = useMemo(() => visibleJobs.filter((job) => runningStatuses.has(job.status)).length, [visibleJobs]);
  const totalSpeedBytesPerSecond = useMemo(
    () => visibleJobs.reduce((total, job) => total + (job.speedBytesPerSecond ?? 0), 0),
    [visibleJobs],
  );
  const visibleSearchResults =
    activeSearchScope === 'all' ? searchResponse.results : searchResponse.results.filter((result) => result.provider === activeSearchScope);
  const visibleSearchErrors =
    activeSearchScope === 'all' ? searchResponse.errors : searchResponse.errors.filter((item) => item.provider === activeSearchScope);
  const currentSearchQuery = searchInput.trim();
  const searchResultsAreCurrent = Boolean(submittedSearch && submittedSearch.query === currentSearchQuery && submittedSearch.scope === activeSearchScope);
  const displayedSearchResults = searchResultsAreCurrent ? visibleSearchResults : [];
  const searchProviderErrors = visibleSearchErrors
    .map((item) => t('downloads.search.providerErrorItem', { provider: providerLabels[item.provider], error: formatSearchProviderError(item.error, t) }))
    .join(t('punctuation.clauseSeparator'));
  const displayedSearchProviderErrors = searchResultsAreCurrent ? searchProviderErrors : '';
  const requiredOutputDirectory = osuOnly ? settings.osuOutputDirectory : settings.outputDirectory;
  const selectedOsuMirrorOption = osuDownloadMirrorOptions.find((option) => option.value === settings.osuDownloadMirror) ?? osuDownloadMirrorOptions[0]!;
  const noticeJob = useMemo(() => (notice?.jobId ? jobs.find((job) => job.id === notice.jobId) ?? null : null), [jobs, notice?.jobId]);
  const noticeProgress = noticeJob ? Math.max(0, Math.min(100, Math.round(noticeJob.progress))) : null;
  const noticeStatus = noticeJob ? t(statusLabelKeys[noticeJob.status]) : null;
  const noticeDetail = noticeJob ? (noticeJob.artist ? `${noticeJob.artist} - ${noticeJob.title ?? noticeJob.sourceUrl}` : noticeJob.title ?? noticeJob.sourceUrl) : notice?.detail;
  const noticeTitle = noticeJob && terminalStatuses.has(noticeJob.status) ? t(statusLabelKeys[noticeJob.status]) : notice?.title;
  const queuedOsuBeatmapsetIds = useMemo(
    () => new Set(
      jobs
        .filter((job) => runningStatuses.has(job.status))
        .map((job) => osuBeatmapsetIdFromUrl(job.sourceUrl))
        .filter((id): id is string => Boolean(id)),
    ),
    [jobs],
  );
  const downloadedOsuBeatmapsetIds = useMemo(
    () => new Set(
      jobs
        .filter((job) => job.provider === 'osu' && job.status === 'completed')
        .map((job) => osuBeatmapsetIdFromUrl(job.sourceUrl))
        .filter((id): id is string => Boolean(id)),
    ),
    [jobs],
  );
  const unavailableOsuBeatmapsetIds = useMemo(
    () => new Set([...queuedOsuBeatmapsetIds, ...downloadedOsuBeatmapsetIds]),
    [downloadedOsuBeatmapsetIds, queuedOsuBeatmapsetIds],
  );
  const normalizedOsuCollectionFilter = osuCollectionFilter.trim().toLocaleLowerCase();
  const filteredOsuCollectionItems = useMemo(
    () => (osuCollection?.items ?? []).filter((item) =>
      !normalizedOsuCollectionFilter ||
      [item.title, item.artist, item.creator, item.difficultyName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(normalizedOsuCollectionFilter)),
    ),
    [normalizedOsuCollectionFilter, osuCollection?.items],
  );
  const downloadableOsuCollectionItems = useMemo(
    () => (osuCollection?.items ?? []).filter((item) => !unavailableOsuBeatmapsetIds.has(item.beatmapsetId)),
    [osuCollection?.items, unavailableOsuBeatmapsetIds],
  );
  const availableOsuCollectionItems = useMemo(
    () => filteredOsuCollectionItems.filter((item) => !unavailableOsuBeatmapsetIds.has(item.beatmapsetId)),
    [filteredOsuCollectionItems, unavailableOsuBeatmapsetIds],
  );
  const unavailableOsuCollectionItemCount =
    (osuCollection?.items.length ?? 0) - downloadableOsuCollectionItems.length;
  const selectedOsuItems = useMemo(
    () => downloadableOsuCollectionItems.filter((item) => selectedOsuItemKeys.has(item.key)),
    [downloadableOsuCollectionItems, selectedOsuItemKeys],
  );
  const selectedUniqueOsuBeatmapsetCount = useMemo(
    () => new Set(selectedOsuItems.map((item) => item.beatmapsetId)).size,
    [selectedOsuItems],
  );
  const allOsuItemsSelected =
    availableOsuCollectionItems.length > 0 && availableOsuCollectionItems.every((item) => selectedOsuItemKeys.has(item.key));
  const displayedOsuBestScoreCount =
    osuAccountProfile?.bestScoreCount ??
    (osuCollection?.kind === 'best'
      ? osuCollection.items.length === 100 && osuCollection.items[0]?.position === 1
        ? 100
        : `已载 ${osuCollection.items.length}`
      : '待加载');
  const displayedOsuFavouriteCount =
    osuAccountProfile?.favouriteBeatmapsetCount ??
    (osuCollection?.kind === 'favourites' ? osuCollection.items.length : '待加载');
  const displayedOsuMostPlayedCount =
    osuAccountProfile?.mostPlayedBeatmapCount ??
    (osuCollection?.kind === 'most_played' ? osuCollection.items.length : null);
  const canLoadMoreOsuMostPlayed =
    osuCollection?.kind === 'most_played' &&
    osuCollection.items.length > 0 &&
    (
      osuCollection.total === null
        ? osuCollection.items.length % 100 === 0
        : osuCollection.items.length < osuCollection.total
    );

  const showNotice = useCallback((nextNotice: DownloadNotice): void => {
    setNotice(nextNotice);
  }, []);

  const loadOsuAccountProfile = useCallback(async (): Promise<OsuAccountProfile> => {
    if (!bridge?.getOsuAccountProfile) {
      throw new Error('当前运行环境无法读取 osu! 账号数据。');
    }

    const profile = await bridge.getOsuAccountProfile();
    setOsuAccountProfile(profile);
    setOsuRuleset(profile.defaultRuleset);
    return profile;
  }, [bridge]);

  const handleOsuAccountLogin = useCallback(async (): Promise<void> => {
    if (!accountsBridge?.startLogin) {
      setOsuAccountError('当前运行环境无法打开 osu! 登录窗口。');
      return;
    }

    setOsuAccountBusy('login');
    setOsuAccountError(null);
    setOsuAccountMessage('请在弹出的官方 osu! 页面完成登录，完成后关闭窗口。');
    try {
      const result = await accountsBridge.startLogin('osu');
      setOsuAccountStatus(result.status);
      if (!result.saved || !result.status.connected) {
        setOsuAccountProfile(null);
        setOsuAccountError(result.message || '没有检测到有效的 osu! 登录。');
        return;
      }

      const previousUserId = osuAccountProfile?.userId ?? null;
      const profile = await loadOsuAccountProfile();
      if (previousUserId !== null && previousUserId !== profile.userId) {
        setOsuCollections({});
        setSelectedOsuItemKeysByKind({});
      }
      setOsuAccountMessage(`已登录 ${profile.username}，现在可以加载 BP、玩得最多或全部收藏。`);
    } catch (loginError) {
      setOsuAccountError(formatOsuAccountError(loginError));
    } finally {
      setOsuAccountBusy(null);
    }
  }, [accountsBridge, loadOsuAccountProfile, osuAccountProfile?.userId]);

  const handleRefreshOsuAccount = useCallback(async (): Promise<void> => {
    if (!osuAccountProfile || !bridge?.getOsuAccountProfile) {
      setOsuAccountError('当前运行环境无法刷新 osu! 账号数据。');
      return;
    }

    setOsuAccountBusy('refresh');
    setOsuAccountError(null);
    setOsuAccountMessage('正在刷新 osu! 账号数据…');

    try {
      let profile = await loadOsuAccountProfile();
      let refreshedCollection: OsuAccountCollectionResponse | null = null;

      if (osuCollection && bridge.getOsuAccountCollection) {
        const start = Math.max(1, Math.min(100, Math.trunc(osuBpStart || 1)));
        const end = Math.max(start, Math.min(100, Math.trunc(osuBpEnd || start)));
        refreshedCollection = await bridge.getOsuAccountCollection(
          osuCollection.kind === 'best'
            ? { kind: 'best', ruleset: osuRuleset, start, end }
            : { kind: osuCollection.kind },
        );
        profile = refreshedCollection.profile;
        setOsuCollections((current) => ({ ...current, [refreshedCollection!.kind]: refreshedCollection! }));
        setOsuAccountProfile(profile);
        setSelectedOsuItemKeys(new Set());
      }

      setOsuAccountMessage(
        refreshedCollection
          ? `已刷新 ${profile.username} 和当前${
              refreshedCollection.kind === 'best'
                ? ' BP'
                : refreshedCollection.kind === 'most_played'
                  ? '玩得最多'
                  : '收藏'
            }列表。`
          : `已刷新 ${profile.username} 的账号数据。`,
      );
    } catch (refreshError) {
      const nextError = formatOsuAccountError(refreshError);
      setOsuAccountError(nextError);
      if (nextError.includes('登录')) {
        setOsuAccountStatus((current) => current ? { ...current, connected: false } : current);
        setOsuAccountProfile(null);
      }
    } finally {
      setOsuAccountBusy(null);
    }
  }, [bridge, loadOsuAccountProfile, osuAccountProfile, osuBpEnd, osuBpStart, osuCollection, osuRuleset, setSelectedOsuItemKeys]);

  const handleLoadOsuCollection = useCallback(async (): Promise<void> => {
    if (!bridge?.getOsuAccountCollection) {
      setOsuAccountError('当前运行环境无法读取 osu! 账号数据。');
      return;
    }
    if (!osuAccountProfile) {
      setOsuAccountError('请先登录 osu! 账号。');
      return;
    }

    const start = Math.max(1, Math.min(100, Math.trunc(osuBpStart || 1)));
    const end = Math.max(start, Math.min(100, Math.trunc(osuBpEnd || start)));
    setOsuBpStart(start);
    setOsuBpEnd(end);
    setOsuAccountBusy('collection');
    setOsuAccountError(null);
    setOsuAccountMessage(
      osuCollectionKind === 'best'
        ? `正在读取 BP #${start}-${end}…`
        : osuCollectionKind === 'most_played'
          ? '正在读取玩得最多的谱面…'
          : '正在分页读取全部收藏…',
    );
    setSelectedOsuItemKeys(new Set());

    try {
      const response = await bridge.getOsuAccountCollection(
        osuCollectionKind === 'best'
          ? { kind: 'best', ruleset: osuRuleset, start, end }
          : { kind: osuCollectionKind },
      );
      setOsuCollections((current) => ({ ...current, [response.kind]: response }));
      setOsuAccountProfile(response.profile);
      setOsuAccountMessage(
        response.kind === 'best'
          ? `已加载 ${response.items.length} 条 BP 记录。`
          : response.kind === 'most_played'
            ? `已加载玩得最多的 ${response.items.length} 个谱面。`
            : `已加载全部 ${response.items.length} 个收藏谱面。`,
      );
    } catch (collectionError) {
      setOsuCollections((current) => {
        const next = { ...current };
        delete next[osuCollectionKind];
        return next;
      });
      setOsuAccountError(formatOsuAccountError(collectionError));
      if (formatOsuAccountError(collectionError).includes('登录')) {
        setOsuAccountStatus((current) => current ? { ...current, connected: false } : current);
        setOsuAccountProfile(null);
      }
    } finally {
      setOsuAccountBusy(null);
    }
  }, [bridge, osuAccountProfile, osuBpEnd, osuBpStart, osuCollectionKind, osuRuleset, setSelectedOsuItemKeys]);

  const handleLoadMoreOsuMostPlayed = useCallback(async (): Promise<void> => {
    if (
      !bridge?.getOsuAccountCollection ||
      !osuAccountProfile ||
      osuCollection?.kind !== 'most_played'
    ) {
      return;
    }

    setOsuAccountBusy('more');
    setOsuAccountError(null);
    setOsuAccountMessage(`正在继续读取第 ${osuCollection.items.length + 1} 条之后的游玩记录…`);

    try {
      const response = await bridge.getOsuAccountCollection({
        kind: 'most_played',
        offset: osuCollection.items.length,
        limit: 100,
      });
      const mergedItems = [...new Map(
        [...osuCollection.items, ...response.items].map((item) => [item.key, item]),
      ).values()];
      const mergedResponse: OsuAccountCollectionResponse = {
        ...response,
        items: mergedItems,
        total: response.total ?? osuCollection.total,
      };
      setOsuCollections((current) => ({ ...current, most_played: mergedResponse }));
      setOsuAccountProfile(response.profile);
      setOsuAccountMessage(
        `已加载 ${mergedItems.length}${mergedResponse.total !== null ? ` / ${mergedResponse.total}` : ''} 条游玩记录。`,
      );
    } catch (loadMoreError) {
      setOsuAccountError(formatOsuAccountError(loadMoreError));
    } finally {
      setOsuAccountBusy(null);
    }
  }, [bridge, osuAccountProfile, osuCollection]);

  const focusUrlInputFromEmptyState = useCallback((): void => {
    urlInputRef.current?.focus();
    urlInputRef.current?.select();
    void (async () => {
      try {
        const clipboardText = await navigator.clipboard?.readText?.();
        if (clipboardText?.trim()) {
          setUrl(clipboardText.trim());
        }
      } catch {
        // Clipboard access is optional; focusing the input still gives the user the next step.
      }
    })();
  }, []);

  useEffect(() => {
    if (!osuOnly) {
      return;
    }

    try {
      window.sessionStorage.setItem(osuPageSessionStorageKey, JSON.stringify({
        profile: osuAccountProfile,
        collections: osuCollections,
        collectionKind: osuCollectionKind,
        workspaceView: osuWorkspaceView,
        ruleset: osuRuleset,
        bpStart: osuBpStart,
        bpEnd: osuBpEnd,
        selectedItemKeysByKind: selectedOsuItemKeysByKind,
        searchInput,
        searchResponse,
        submittedSearch,
      } satisfies OsuPageSessionState));
    } catch {
      // Keep the live page functional if storage is unavailable or full.
    }
  }, [
    osuAccountProfile,
    osuBpEnd,
    osuBpStart,
    osuCollectionKind,
    osuCollections,
    osuOnly,
    osuRuleset,
    osuWorkspaceView,
    searchInput,
    searchResponse,
    selectedOsuItemKeysByKind,
    submittedSearch,
  ]);

  useEffect(() => {
    if (!osuOnly || !accountsBridge) {
      return undefined;
    }

    let disposed = false;
    const applyStatus = async (status: AccountStatus): Promise<void> => {
      if (disposed) {
        return;
      }
      setOsuAccountStatus(status);
      if (!status.connected) {
        initialOsuSessionRef.current = null;
        setOsuAccountProfile(null);
        setOsuCollections({});
        setSelectedOsuItemKeysByKind({});
        clearOsuPageSession();
        return;
      }

      const cachedProfile = initialOsuSessionRef.current?.profile;
      const cachedStatusMatches =
        cachedProfile &&
        (
          status.username === String(cachedProfile.userId) ||
          status.username === cachedProfile.username ||
          status.displayName === cachedProfile.username
        );
      if (cachedStatusMatches) {
        setOsuAccountError(null);
        return;
      }

      setOsuCollections({});
      setSelectedOsuItemKeysByKind({});
      setOsuAccountBusy('profile');
      try {
        await loadOsuAccountProfile();
        if (!disposed) {
          setOsuAccountError(null);
        }
      } catch (profileError) {
        if (!disposed) {
          setOsuAccountProfile(null);
          setOsuAccountError(formatOsuAccountError(profileError));
        }
      } finally {
        if (!disposed) {
          setOsuAccountBusy(null);
        }
      }
    };

    void accountsBridge.getStatus('osu')
      .then(applyStatus)
      .catch((statusError) => {
        if (!disposed) {
          setOsuAccountError(formatOsuAccountError(statusError));
        }
      });
    const unsubscribe = accountsBridge.onStatusesChanged?.((statuses) => {
      const status = statuses.find((item) => item.provider === 'osu');
      if (status) {
        void applyStatus(status);
      }
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [accountsBridge, loadOsuAccountProfile, osuOnly]);

  const focusSearchInputFromEmptyState = useCallback((): void => {
    if (osuOnly) {
      setOsuWorkspaceView('search');
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return;
    }
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [osuOnly]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    if (noticeJob && !terminalStatuses.has(noticeJob.status)) {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice, noticeJob]);

  const refreshJobs = useCallback(async (): Promise<void> => {
    if (!bridge?.getJobs) {
      setJobs([]);
      return;
    }

    try {
      const nextJobs = await bridge.getJobs();
      jobStatusRef.current = new Map(nextJobs.map((job) => [job.id, job.status]));
      setJobs(nextJobs);
      const activeJob = nextJobs.find((job) => runningStatuses.has(job.status));
      if (activeJob) {
        showNotice({
          tone: 'info',
          title: t(statusLabelKeys[activeJob.status]),
          detail: activeJob.artist ? `${activeJob.artist} - ${activeJob.title ?? activeJob.sourceUrl}` : activeJob.title ?? activeJob.sourceUrl,
          jobId: activeJob.id,
        });
      }
    } catch (jobsError) {
      const nextError = formatError(jobsError, t);
      setError(nextError);
      showNotice({ tone: 'error', title: t('downloads.error.operationFailed'), detail: nextError });
    }
  }, [bridge, showNotice, t]);

  const refreshTools = useCallback(async (): Promise<void> => {
    if (!bridge?.checkTools) {
      setTools({ ytDlpAvailable: false, ffmpegAvailable: false, ytDlpVersion: null, ytDlpPath: null, ffmpegPath: null });
      return;
    }

    setBusyAction('tools');
    try {
      setTools(await bridge.checkTools());
    } catch (toolsError) {
      const nextError = formatError(toolsError, t);
      setError(nextError);
      showNotice({ tone: 'error', title: t('downloads.error.operationFailed'), detail: nextError });
    } finally {
      setBusyAction(null);
    }
  }, [bridge, showNotice, t]);

  useEffect(() => {
    if (!bridge) {
      setError(t('downloads.error.ipcUnavailable'));
      showNotice({ tone: 'error', title: t('downloads.error.operationFailed'), detail: t('downloads.error.ipcUnavailable') });
      return undefined;
    }

    void refreshJobs();
    const settingsRequestId = settingsRequestRef.current;
    void bridge.getSettings?.().then((nextSettings) => {
      if (settingsRequestId === settingsRequestRef.current) {
        osuDownloadMirrorRef.current = nextSettings.osuDownloadMirror;
        setSettings(nextSettings);
      }
    }).catch((settingsError) => setError(formatError(settingsError, t)));
    void refreshTools();

    return bridge.onJobsUpdated?.((nextJobs) => {
      let completedNotice: { title: string; detail: string; jobId: string } | null = null;
      for (const job of nextJobs) {
        const previousStatus = jobStatusRef.current.get(job.id);
        if (previousStatus && previousStatus !== 'completed' && job.status === 'completed') {
          const completedMessage = t('downloads.message.completed', { title: job.title ?? job.sourceUrl });
          setMessage(completedMessage);
          completedNotice = { title: t('downloads.status.completed'), detail: completedMessage, jobId: job.id };
          setError(null);
          break;
        }
      }
      jobStatusRef.current = new Map(nextJobs.map((job) => [job.id, job.status]));
      setJobs(nextJobs);
      if (completedNotice) {
        showNotice({ tone: 'success', title: completedNotice.title, detail: completedNotice.detail, jobId: completedNotice.jobId });
      } else {
        const activeJob = nextJobs.find((job) => runningStatuses.has(job.status));
        if (activeJob) {
          showNotice({
            tone: 'info',
            title: t(statusLabelKeys[activeJob.status]),
            detail: activeJob.artist ? `${activeJob.artist} - ${activeJob.title ?? activeJob.sourceUrl}` : activeJob.title ?? activeJob.sourceUrl,
            jobId: activeJob.id,
          });
        }
      }
    });
  }, [bridge, refreshJobs, refreshTools, showNotice, t]);

  const createDownload = useCallback(
    async (sourceUrl: string, options: CreateDownloadUrlJobOptions = {}): Promise<DownloadJob | null> => {
      if (!bridge?.createUrlJob) {
        return null;
      }

      if (!requiredOutputDirectory) {
        const folderRequiredMessage = osuOnly ? t('downloads.folder.osuRequired') : t('downloads.folder.required');
        setNeedsFolder(true);
        setError(folderRequiredMessage);
        setMessage(null);
        showNotice({ tone: 'error', title: folderRequiredMessage });
        return null;
      }

      const job = await bridge.createUrlJob(sourceUrl, {
        ...options,
        importToLibrary: settings.importToLibrary,
        bindMvAfterImport: osuOnly ? false : settings.bindMvAfterImport,
        ...(osuOnly ? { providerLock: 'osu' as const, osuDownloadMirror: osuDownloadMirrorRef.current } : {}),
      });
      jobStatusRef.current.set(job.id, job.status);
      setJobs((current) => (current.some((item) => item.id === job.id) ? current : [job, ...current]));
      setNeedsFolder(false);
      showNotice({ tone: 'info', title: t('downloads.message.queued'), detail: job.title ?? job.sourceUrl, jobId: job.id });
      return job;
    },
    [bridge, osuOnly, requiredOutputDirectory, settings.bindMvAfterImport, settings.importToLibrary, showNotice, t],
  );

  const handleCreate = useCallback(async (): Promise<void> => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return;
    }
    if (osuOnly && !isOsuBeatmapsetUrl(trimmedUrl)) {
      const nextError = t('downloads.error.osuOnlyUrl');
      setMessage(null);
      setError(nextError);
      showNotice({ tone: 'error', title: nextError });
      return;
    }

    setBusyAction('create');
    setError(null);
    setMessage(null);

    try {
      const job = await createDownload(trimmedUrl);
      if (job) {
        setUrl('');
        setMessage(osuOnly ? null : t('downloads.message.queued'));
      }
    } catch (createError) {
      const nextError = formatError(createError, t);
      setNeedsFolder(nextError.includes(t('downloads.folder.required')));
      setError(nextError);
      showNotice({ tone: 'error', title: t('downloads.error.operationFailed'), detail: nextError });
    } finally {
      setBusyAction(null);
    }
  }, [createDownload, osuOnly, showNotice, t, url]);

  const handleSearch = useCallback(async (): Promise<void> => {
    const query = searchInput.trim();
    if (!query || !bridge?.search) {
      return;
    }

    setBusyAction('search');
    setError(null);
    setMessage(null);
    setSearchResponse({ results: [], errors: [] });
    setSubmittedSearch({ query, scope: activeSearchScope });
    setJoinedResultKeys(new Set());

    try {
      setSearchResponse(await bridge.search({
        query,
        limitPerProvider: 10,
        provider: activeSearchScope,
        ...(osuOnly ? { providerLock: 'osu' as const } : {}),
      }));
    } catch (searchError) {
      const nextError = formatError(searchError, t);
      setError(nextError);
      showNotice({ tone: 'error', title: t('downloads.error.operationFailed'), detail: nextError });
    } finally {
      setBusyAction(null);
    }
  }, [activeSearchScope, bridge, osuOnly, searchInput, showNotice, t]);

  const handleDownloadSearchResult = useCallback(
    async (result: DownloadSearchResult): Promise<void> => {
      setError(null);
      setMessage(null);

      try {
        const osuTitle = osuOnly && result.provider === 'osu' ? splitOsuDisplayTitle(result.title) : null;
        const job = await createDownload(result.webpageUrl, {
          title: osuTitle?.title ?? result.title,
          ...(osuTitle?.artist ? { artist: osuTitle.artist } : {}),
          coverUrl: result.thumbnailUrl,
          webpageUrl: result.webpageUrl,
        });
        if (!job) {
          return;
        }

        setJoinedResultKeys((current) => new Set([...current, searchResultKey(result)]));
        const queuedMessage = t('downloads.message.resultQueued', { title: result.title });
        setMessage(osuOnly ? null : queuedMessage);
      } catch (downloadError) {
        const nextError = formatError(downloadError, t);
        setNeedsFolder(nextError.includes(t('downloads.folder.required')));
        setError(nextError);
        showNotice({ tone: 'error', title: t('downloads.error.operationFailed'), detail: nextError });
      }
    },
    [createDownload, osuOnly, showNotice, t],
  );

  const handleToggleAllOsuItems = useCallback((): void => {
    if (allOsuItemsSelected) {
      setSelectedOsuItemKeys(new Set());
      return;
    }
    setSelectedOsuItemKeys(new Set(availableOsuCollectionItems.map((item) => item.key)));
  }, [allOsuItemsSelected, availableOsuCollectionItems, setSelectedOsuItemKeys]);

  const queueOsuItems = useCallback(async (items: OsuAccountBeatmapItem[]): Promise<number> => {
    if (!requiredOutputDirectory) {
      const folderRequiredMessage = '请先选择 osu! 下载文件夹';
      setNeedsFolder(true);
      setOsuAccountMessage(null);
      setOsuAccountError(`${folderRequiredMessage}。右侧“下载设置”已为你标出。`);
      showNotice({
        tone: 'error',
        title: folderRequiredMessage,
        detail: '先在右侧“下载设置”中选择文件夹，再开始批量下载。',
      });
      return 0;
    }

    const uniqueItems = Array.from(
      new Map(items.map((item) => [item.beatmapsetId, item] as const)).values(),
    );
    if (uniqueItems.length === 0) {
      return 0;
    }

    setOsuAccountBusy('download');
    setOsuAccountError(null);
    setOsuAccountMessage(`正在把 ${uniqueItems.length} 个谱面加入下载队列…`);
    let queuedCount = 0;
    try {
      for (const item of uniqueItems) {
        const job = await createDownload(item.webpageUrl, {
          title: item.title,
          ...(item.artist ? { artist: item.artist } : {}),
          coverUrl: item.coverUrl,
          webpageUrl: item.webpageUrl,
        });
        if (!job) {
          break;
        }
        queuedCount += 1;
      }

      setOsuAccountMessage(`已将 ${queuedCount} 个谱面加入下载队列。`);
    } catch (batchError) {
      setOsuAccountError(formatError(batchError, t));
      setOsuAccountMessage(queuedCount > 0 ? `已加入 ${queuedCount} 个谱面，后续项目未能继续。` : null);
    } finally {
      setOsuAccountBusy(null);
    }
    return queuedCount;
  }, [createDownload, requiredOutputDirectory, showNotice, t]);

  const handleQueueSelectedOsuItems = useCallback(async (): Promise<void> => {
    const queuedCount = await queueOsuItems(selectedOsuItems);
    if (queuedCount > 0) {
      setSelectedOsuItemKeys(new Set());
    }
  }, [queueOsuItems, selectedOsuItems, setSelectedOsuItemKeys]);

  const handleChooseDirectory = useCallback(async (target: 'default' | 'osu' = 'default'): Promise<void> => {
    if (!bridge?.chooseOutputDirectory) {
      return;
    }

    setBusyAction('folder');
    setError(null);
    try {
      const nextSettings = await bridge.chooseOutputDirectory(target);
      if (nextSettings) {
        setSettings(nextSettings);
        setNeedsFolder(false);
        if (target === 'osu') {
          setOsuAccountError(null);
          setOsuAccountMessage('osu! 下载文件夹已设置，可以开始批量下载。');
        }
      }
    } catch (directoryError) {
      const nextError = formatError(directoryError, t);
      setError(nextError);
      showNotice({ tone: 'error', title: t('downloads.error.operationFailed'), detail: nextError });
    } finally {
      setBusyAction(null);
    }
  }, [bridge, showNotice, t]);

  const handleCancel = useCallback(
    async (jobId: string): Promise<void> => {
      if (!bridge?.cancelJob) {
        return;
      }

      try {
        const job = await bridge.cancelJob(jobId);
        if (job) {
          setJobs((current) => current.map((item) => (item.id === job.id ? job : item)));
        }
      } catch (cancelError) {
        const nextError = formatError(cancelError, t);
        setError(nextError);
        showNotice({ tone: 'error', title: t('downloads.error.operationFailed'), detail: nextError });
      }
    },
    [bridge, showNotice, t],
  );

  const handleClear = useCallback(async (): Promise<void> => {
    if (!bridge) {
      return;
    }

    setBusyAction('clear');
    setError(null);

    try {
      setJobs(await bridge.clearCompleted(osuOnly ? 'osu' : undefined));
      setMessage(t('downloads.message.clearedTerminal'));
    } catch (clearError) {
      const nextError = formatError(clearError, t);
      setError(nextError);
      showNotice({ tone: 'error', title: t('downloads.error.operationFailed'), detail: nextError });
    } finally {
      setBusyAction(null);
    }
  }, [bridge, osuOnly, showNotice, t]);

  const patchSettings = useCallback(
    async (patch: Partial<DownloadSettings>): Promise<void> => {
      const requestId = ++settingsRequestRef.current;
      if (patch.osuDownloadMirror) {
        osuDownloadMirrorRef.current = patch.osuDownloadMirror;
      }
      setSettings((current) => ({ ...current, ...patch }));

      if (!bridge?.setSettings) {
        return;
      }

      try {
        const savedSettings = await bridge.setSettings(patch);
        if (requestId === settingsRequestRef.current) {
          osuDownloadMirrorRef.current = savedSettings.osuDownloadMirror;
          setSettings(savedSettings);
        }
      } catch (settingsError) {
        setError(formatError(settingsError, t));
      }
    },
    [bridge, t],
  );

  const searchWorkspaceContent = (
    <>
      <form
        className="downloads-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSearch();
        }}
      >
        <label className="downloads-search-box">
          <Search size={16} />
          <input
            ref={searchInputRef}
            type="search"
            value={searchInput}
            placeholder={osuOnly ? 'Search osu! beatmap name, artist, mapper, or id' : t('downloads.search.placeholder')}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
        <button className="downloads-action-button" type="submit" disabled={!searchInput.trim() || busyAction === 'search'}>
          <Search size={16} />
          {busyAction === 'search' ? t('downloads.action.searching') : t('downloads.action.search')}
        </button>
      </form>

      {displayedSearchProviderErrors ? <p className="downloads-note">{t('downloads.search.providerErrors', { errors: displayedSearchProviderErrors })}</p> : null}
      <div className="download-search-results">
        {busyAction === 'search' ? (
          <EmptyState icon={Search} title={t('downloads.empty.searching.title')} description={t('downloads.empty.searching.description', { scope: searchScopeLabels[activeSearchScope] })} meta="Searching" />
        ) : osuOnly && !submittedSearch ? (
          <EmptyState icon={Search} title={t('downloads.empty.searchPrompt.title')} description={t('downloads.empty.searchPrompt.description')} meta="osu!" />
        ) : searchResultsAreCurrent && displayedSearchResults.length === 0 && currentSearchQuery ? (
          <EmptyState icon={Search} title={t('downloads.empty.noResults.title')} description={t('downloads.empty.noResults.description')} meta="Search" />
        ) : (
          displayedSearchResults.map((result) => (
            <SearchResultRow
              result={result}
              key={searchResultKey(result)}
              joined={joinedResultKeys.has(searchResultKey(result))}
              onDownload={(item) => void handleDownloadSearchResult(item)}
            />
          ))
        )}
      </div>
    </>
  );

  const osuAccountPanel = osuOnly ? (
    <section className="downloads-panel osu-account-library-panel">
      <div className="downloads-section-title downloads-section-title--split">
        <div>
          <UserRound size={17} />
          <h2>我的 osu! 谱面</h2>
        </div>
        {osuAccountProfile ? (
          <div className="osu-account-header-actions">
            <button
              className="downloads-action-button"
              type="button"
              disabled={osuAccountBusy !== null}
              onClick={() => void handleRefreshOsuAccount()}
            >
              <RefreshCw className={osuAccountBusy === 'refresh' ? 'spinning-icon' : undefined} size={14} />
              {osuAccountBusy === 'refresh' ? '刷新中' : '刷新数据'}
            </button>
            <button
              className="downloads-action-button osu-account-switch-button"
              type="button"
              disabled={osuAccountBusy !== null}
              onClick={() => void handleOsuAccountLogin()}
            >
              <UserRound size={14} />
              切换账号
            </button>
          </div>
        ) : null}
      </div>

      {!osuAccountProfile ? (
        <div className="osu-account-login-prompt" data-loading={osuAccountBusy === 'profile'}>
          <span className="osu-account-avatar osu-account-avatar--empty">
            <UserRound size={22} />
          </span>
          <div>
            <strong>{osuAccountBusy === 'profile' ? '正在确认 osu! 登录状态…' : '登录 osu! 账号，加载你的个人谱面'}</strong>
            <p>登录后可以按范围加载 BP、查看玩得最多的谱面、读取全部收藏，并勾选或全选加入下载队列。</p>
          </div>
          <button
            className="primary-action"
            type="button"
            disabled={osuAccountBusy !== null || !accountsBridge?.startLogin}
            onClick={() => void handleOsuAccountLogin()}
          >
            <LogIn size={16} />
            {osuAccountBusy === 'login' ? '等待登录完成' : '登录 osu!'}
          </button>
        </div>
      ) : (
          <div className="osu-account-profile" data-supporter={osuAccountProfile.isSupporter || undefined}>
            <div className="osu-account-identity">
              <span className="osu-account-avatar">
                {osuAccountProfile.avatarUrl ? <img src={osuAccountProfile.avatarUrl} alt="" /> : <UserRound size={22} />}
              </span>
              <div className="osu-account-identity-copy">
                <span className="osu-account-name-row">
                  <strong>{osuAccountProfile.username}</strong>
                </span>
                <span className="osu-account-presence">
                  <CheckCircle2 size={12} />
                  {osuAccountProfile.isOnline === true ? '在线' : osuAccountProfile.isOnline === false ? '最近在线' : '状态未知'}
                  {osuAccountProfile.countryCode ? (
                    <>
                      <img
                        src={`https://osu.ppy.sh/images/flags/${encodeURIComponent(osuAccountProfile.countryCode)}.png`}
                        alt=""
                        onError={(event) => { event.currentTarget.hidden = true; }}
                      />
                      {osuAccountProfile.countryCode}
                    </>
                  ) : null}
                  {osuAccountProfile.isSupporter ? <em className="osu-account-supporter-badge">SUPPORTER</em> : null}
                </span>
              </div>
              <button
                className="osu-account-profile-link"
                type="button"
                onClick={() => void window.echo?.app?.openExternalUrl?.(`https://osu.ppy.sh/users/${osuAccountProfile.userId}`)}
              >
                查看主页
                <ExternalLink size={13} />
              </button>
            </div>

            <div className="osu-account-primary-metrics">
              <span>
                <em>全球排名</em>
                <strong>{osuAccountProfile.globalRank === null ? '-' : `#${formatOsuProfileNumber(osuAccountProfile.globalRank)}`}</strong>
              </span>
              <span>
                <em>地区排名</em>
                <strong>{osuAccountProfile.countryRank === null ? '-' : `#${formatOsuProfileNumber(osuAccountProfile.countryRank)}`}</strong>
              </span>
              <span>
                <em>Performance</em>
                <strong>{formatOsuProfileNumber(osuAccountProfile.performancePoints, ' pp')}</strong>
              </span>
              <span>
                <em>准确率</em>
                <strong>{formatOsuProfileAccuracy(osuAccountProfile.hitAccuracy)}</strong>
              </span>
            </div>

            <div className="osu-account-secondary-metrics">
              <span><em>等级</em><strong>{formatOsuProfileNumber(osuAccountProfile.level)}</strong></span>
              <span><em>游玩次数</em><strong>{formatOsuProfileNumber(osuAccountProfile.playCount)}</strong></span>
              <span><em>最大连击</em><strong>{formatOsuProfileNumber(osuAccountProfile.maximumCombo, 'x')}</strong></span>
              <span><em>游戏时长</em><strong>{formatOsuPlayTime(osuAccountProfile.playTimeSeconds)}</strong></span>
              <span><em>BP</em><strong>{displayedOsuBestScoreCount}</strong></span>
              <span><em>收藏</em><strong>{displayedOsuFavouriteCount}</strong></span>
            </div>
          </div>
      )}

          <div className="osu-account-collection-tabs" role="group" aria-label="osu! 谱面视图">
            <button
              type="button"
              className={osuWorkspaceView === 'best' ? 'active' : undefined}
              aria-pressed={osuWorkspaceView === 'best'}
              onClick={() => {
                setOsuWorkspaceView('best');
                setOsuCollectionKind('best');
                setOsuCollectionFilter('');
                setOsuAccountMessage(null);
              }}
            >
              <Trophy size={15} />
              BP 成绩
            </button>
            <button
              type="button"
              className={osuWorkspaceView === 'most_played' ? 'active' : undefined}
              aria-pressed={osuWorkspaceView === 'most_played'}
              onClick={() => {
                setOsuWorkspaceView('most_played');
                setOsuCollectionKind('most_played');
                setOsuCollectionFilter('');
                setOsuAccountMessage(null);
              }}
            >
              <Play size={15} fill="currentColor" />
              玩得最多{displayedOsuMostPlayedCount !== null ? ` (${formatOsuProfileNumber(displayedOsuMostPlayedCount)})` : ''}
            </button>
            <button
              type="button"
              className={osuWorkspaceView === 'favourites' ? 'active' : undefined}
              aria-pressed={osuWorkspaceView === 'favourites'}
              onClick={() => {
                setOsuWorkspaceView('favourites');
                setOsuCollectionKind('favourites');
                setOsuCollectionFilter('');
                setOsuAccountMessage(null);
              }}
            >
              <Heart size={15} />
              全部收藏
            </button>
            <button
              type="button"
              className={osuWorkspaceView === 'search' ? 'active' : undefined}
              aria-pressed={osuWorkspaceView === 'search'}
              aria-label="搜索谱面"
              onClick={() => {
                setOsuWorkspaceView('search');
                setOsuAccountMessage(null);
                window.requestAnimationFrame(() => searchInputRef.current?.focus());
              }}
            >
              <Search size={15} />
              搜索
            </button>
          </div>

          {osuWorkspaceView === 'search' ? (
            <div className="osu-account-search-workspace" aria-label={t('downloads.search.aria')}>
              {searchWorkspaceContent}
            </div>
          ) : osuAccountProfile ? (
          <div className="osu-account-collection-workspace">
          <div className="osu-account-load-controls">
            {osuCollectionKind === 'best' ? (
              <>
                <label>
                  <span>模式</span>
                  <select
                    value={osuRuleset}
                    onChange={(event) => {
                      setOsuRuleset(event.target.value as OsuRuleset);
                      setOsuCollections((current) => {
                        const next = { ...current };
                        delete next.best;
                        return next;
                      });
                      setSelectedOsuItemKeys(new Set());
                    }}
                  >
                    {osuRulesetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>从第</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={osuBpStart}
                    aria-label="BP 起始排名"
                    onChange={(event) => setOsuBpStart(Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>到第</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={osuBpEnd}
                    aria-label="BP 结束排名"
                    onChange={(event) => setOsuBpEnd(Number(event.target.value))}
                  />
                </label>
              </>
            ) : osuCollectionKind === 'most_played' ? (
              <p>加载游玩次数最多的前 100 个谱面，并显示每个难度的游玩次数。</p>
            ) : (
              <p>将从 osu! 账号分页读取全部收藏；收藏较多时可能需要一些时间。</p>
            )}
            <button
              className="downloads-action-button"
              type="button"
              disabled={osuAccountBusy !== null}
              onClick={() => void handleLoadOsuCollection()}
            >
              {osuAccountBusy === 'collection'
                ? <RefreshCw size={15} />
                : osuCollectionKind === 'best'
                  ? <Trophy size={15} />
                  : osuCollectionKind === 'most_played'
                    ? <Play size={15} fill="currentColor" />
                    : <Heart size={15} />}
              {osuAccountBusy === 'collection'
                ? '加载中'
                : osuCollectionKind === 'best'
                  ? '加载 BP'
                  : osuCollectionKind === 'most_played'
                    ? '加载玩得最多'
                    : '加载全部收藏'}
            </button>
          </div>

          {osuCollection ? (
            <div className="osu-account-results">
              <div className="osu-account-selection-bar">
                <button className="downloads-action-button" type="button" disabled={availableOsuCollectionItems.length === 0} onClick={handleToggleAllOsuItems}>
                  <ListChecks size={15} />
                  {allOsuItemsSelected ? '取消全选' : '全选'}
                </button>
                <label className="osu-account-list-filter">
                  <Search size={14} />
                  <input
                    type="search"
                    value={osuCollectionFilter}
                    aria-label="筛选当前谱面列表"
                    placeholder="筛选标题、艺术家、谱师或难度"
                    onChange={(event) => setOsuCollectionFilter(event.target.value)}
                  />
                  {osuCollectionFilter ? (
                    <button type="button" aria-label="清除谱面筛选" onClick={() => setOsuCollectionFilter('')}>
                      <X size={13} />
                    </button>
                  ) : null}
                </label>
                <span>
                  已选 {selectedOsuItems.length} 个可下载谱面
                  {selectedUniqueOsuBeatmapsetCount !== selectedOsuItems.length ? ` / ${selectedUniqueOsuBeatmapsetCount} 个谱面` : ''}
                  {unavailableOsuCollectionItemCount > 0 ? ` · ${unavailableOsuCollectionItemCount} 个已下载或在队列` : ''}
                  {normalizedOsuCollectionFilter ? ` · 匹配 ${filteredOsuCollectionItems.length} 个` : ''}
                  {` · 已显示 ${osuCollection.items.length}${osuCollection.total !== null && osuCollection.total > osuCollection.items.length ? ` / 共 ${formatOsuProfileNumber(osuCollection.total)}` : ''}`}
                </span>
                <button
                  className="primary-action"
                  type="button"
                  disabled={selectedUniqueOsuBeatmapsetCount === 0 || osuAccountBusy !== null}
                  onClick={() => void handleQueueSelectedOsuItems()}
                >
                  <Download size={15} />
                  {osuAccountBusy === 'download' ? '加入队列中' : `下载已选 (${selectedUniqueOsuBeatmapsetCount})`}
                </button>
              </div>
              <div className="osu-account-beatmap-list">
                {filteredOsuCollectionItems.length === 0 ? (
                  <EmptyState
                    icon={osuCollection.kind === 'best' ? Trophy : osuCollection.kind === 'most_played' ? Play : Heart}
                    title={normalizedOsuCollectionFilter ? '没有匹配的谱面' : '没有找到谱面'}
                    description={
                      normalizedOsuCollectionFilter
                        ? '请调整筛选关键词，已加载列表不会被清除。'
                        : osuCollection.kind === 'best'
                        ? '请调整 BP 范围后重试。'
                        : osuCollection.kind === 'most_played'
                          ? '这个账号暂时没有可显示的游玩记录。'
                          : '请确认账号收藏后重试。'
                    }
                    meta="osu!"
                  />
                ) : (
                  filteredOsuCollectionItems.map((item) => (
                    <OsuAccountBeatmapRow
                      key={item.key}
                      item={item}
                      kind={osuCollection.kind}
                      downloadState={
                        queuedOsuBeatmapsetIds.has(item.beatmapsetId)
                          ? 'queued'
                          : downloadedOsuBeatmapsetIds.has(item.beatmapsetId)
                            ? 'downloaded'
                            : null
                      }
                      busy={osuAccountBusy !== null}
                      selected={selectedOsuItemKeys.has(item.key)}
                      onQueue={() => void queueOsuItems([item])}
                      onOpen={() => void window.echo?.app?.openExternalUrl?.(item.webpageUrl)}
                      onToggle={() => {
                        setSelectedOsuItemKeys((current) => {
                          const next = new Set(current);
                          if (next.has(item.key)) {
                            next.delete(item.key);
                          } else {
                            next.add(item.key);
                          }
                          return next;
                        });
                      }}
                    />
                  ))
                )}
              </div>
              {canLoadMoreOsuMostPlayed ? (
                <button
                  className="downloads-action-button osu-account-load-more"
                  type="button"
                  disabled={osuAccountBusy !== null}
                  onClick={() => void handleLoadMoreOsuMostPlayed()}
                >
                  {osuAccountBusy === 'more'
                    ? '继续加载中…'
                    : `继续加载（已显示 ${osuCollection.items.length}${osuCollection.total !== null ? ` / ${formatOsuProfileNumber(osuCollection.total)}` : ''}）`}
                </button>
              ) : null}
            </div>
          ) : null}
          </div>
          ) : null}

      {osuAccountMessage ? <p className={osuCollection ? 'sr-only' : 'osu-account-message'} role="status" aria-live="polite">{osuAccountMessage}</p> : null}
      {osuAccountError ? <p className="downloads-error osu-account-error" role="alert">{osuAccountError}</p> : null}
      {!osuAccountProfile && osuAccountStatus?.connected === false && !osuAccountError ? (
        <p className="osu-account-message">尚未连接 osu! 账号。</p>
      ) : null}
    </section>
  ) : null;

  const queuePanel = (
    <section className="downloads-panel downloads-queue-panel">
      <div className="downloads-section-title downloads-section-title--split">
        <div>
          <Download size={17} />
          <h2>{t('downloads.queue.title')}</h2>
          {osuOnly ? <span className="downloads-queue-summary">{t('downloads.queue.summary', { active: activeJobCount, total: visibleJobs.length })}</span> : null}
          {osuOnly && totalSpeedBytesPerSecond > 0 ? <span className="downloads-queue-speed">{formatBytes(totalSpeedBytesPerSecond)}/s</span> : null}
        </div>
        <button
          className={`downloads-action-button${osuOnly ? ' downloads-queue-clear' : ''}`}
          type="button"
          aria-label={t('downloads.action.clearCompleted')}
          title={t('downloads.action.clearCompleted')}
          disabled={completedCount === 0 || busyAction === 'clear'}
          onClick={() => void handleClear()}
        >
          {osuOnly ? <Trash2 size={15} /> : t('downloads.action.clearCompleted')}
        </button>
      </div>

      <div className="download-job-list">
        {visibleJobs.length === 0 ? (
          <EmptyState icon={Download} title={t('downloads.empty.queue.title')} description={t('downloads.empty.queue.description')} meta="Idle">
            <button className="downloads-action-button" type="button" aria-label={t('downloads.empty.queue.action.focusUrl')} onClick={focusUrlInputFromEmptyState}>
              <Link2 size={15} />
              {t('downloads.url.title')}
            </button>
            <button className="downloads-action-button" type="button" aria-label={t('downloads.empty.queue.action.focusSearch')} onClick={focusSearchInputFromEmptyState}>
              <Search size={15} />
              {t('downloads.search.title')}
            </button>
          </EmptyState>
        ) : (
          <>
            {displayedJobs.map((job) => <JobRow compact={osuOnly} job={job} key={job.id} onCancel={(jobId) => void handleCancel(jobId)} />)}
            {osuOnly && (hiddenOsuQueueHistoryCount > 0 || showAllOsuQueueHistory && completedCount > compactOsuQueueHistoryLimit) ? (
              <button
                className="downloads-queue-history-toggle"
                type="button"
                aria-expanded={showAllOsuQueueHistory}
                onClick={() => setShowAllOsuQueueHistory((current) => !current)}
              >
                {showAllOsuQueueHistory ? '收起历史任务' : `展开其余 ${hiddenOsuQueueHistoryCount} 条历史任务`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );

  return (
    <div className={`downloads-page${osuOnly ? ' downloads-page--osu' : ''}`}>
      {osuOnly ? <h1 className="sr-only">osu!</h1> : null}
      {notice && !osuOnly ? (
        <div className="downloads-toast" data-tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <span>
            {notice.tone === 'error' ? <XCircle size={16} /> : notice.tone === 'success' ? <CheckCircle2 size={16} /> : <Download size={16} />}
          </span>
          <div>
            <strong>{noticeTitle}</strong>
            {noticeDetail ? <small>{noticeDetail}</small> : null}
            {noticeProgress !== null ? (
              <div className="downloads-toast-progress">
                <div>
                  <span>{noticeStatus}</span>
                  <em>{noticeProgress}%</em>
                </div>
                <div className="download-progress-track" aria-label={`${noticeProgress}%`}>
                  <span style={{ width: `${noticeProgress}%` }} />
                </div>
              </div>
            ) : null}
          </div>
          <button className="downloads-toast-close" type="button" aria-label={t('notice.action.closeNotice')} title={t('notice.action.closeNotice')} onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      ) : null}
      <header className="downloads-header" aria-hidden={osuOnly || undefined}>
        <div className="downloads-header-copy">
          <span className="panel-kicker">{osuOnly ? 'Beatmap Audio' : 'Downloader'}</span>
          <h1>{osuOnly ? 'osu!' : t('downloads.title')}</h1>
          <p>{osuOnly ? t('downloads.osu.description') : t('downloads.description')}</p>
        </div>
        <div className="downloads-header-actions">
          {osuOnly ? (
            <div className="osu-downloads-overview" aria-label={t('downloads.queue.title')}>
              <span>
                <Download size={15} />
                <strong>{t('downloads.queue.summary', { active: activeJobCount, total: visibleJobs.length })}</strong>
              </span>
              <span>
                <Settings2 size={15} />
                <strong>{t(selectedOsuMirrorOption.labelKey)}</strong>
              </span>
              <span className="osu-downloads-overview-path" title={formatPath(settings.osuOutputDirectory, t)}>
                <FolderOpen size={15} />
                <strong>{formatPath(settings.osuOutputDirectory, t)}</strong>
              </span>
            </div>
          ) : null}
          <button className="downloads-action-button" type="button" onClick={() => void refreshTools()} disabled={busyAction === 'tools'}>
            <Wrench size={16} />
            {t('downloads.action.checkTools')}
          </button>
        </div>
      </header>

      <main className="downloads-grid">
        {osuAccountPanel}
        <section className="downloads-panel downloads-url-panel">
          <div className="downloads-section-title">
            <Link2 size={17} />
            <h2>{t('downloads.url.title')}</h2>
          </div>
          <div className="downloads-url-box">
            <input
              ref={urlInputRef}
              type="url"
              value={url}
              placeholder={osuOnly ? 'Paste an osu! beatmapset link' : t('downloads.url.placeholder')}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (!isImeComposingKeyEvent(event) && event.key === 'Enter') {
                  void handleCreate();
                }
              }}
            />
            <button className="primary-action" type="button" disabled={!url.trim() || busyAction === 'create'} onClick={() => void handleCreate()}>
              <Download size={16} />
              {busyAction === 'create' ? t('downloads.action.creating') : t('downloads.action.addToQueue')}
            </button>
          </div>
          {message ? <p className="downloads-note">{message}</p> : null}
          {error ? <p className="downloads-error" role="alert">{error}</p> : null}
        </section>

        {osuOnly ? null : (
          <section className="downloads-panel downloads-search-panel" aria-label={t('downloads.search.aria')}>
            <div className="downloads-section-title">
              <Search size={17} />
              <h2>{t('downloads.search.title')}</h2>
              <div className="download-search-scope" role="group" aria-label={t('downloads.search.scopeAria')}>
                {searchScopes.map((scope) => (
                  <button
                    type="button"
                    key={scope}
                    aria-pressed={searchScope === scope}
                    className={searchScope === scope ? 'active' : undefined}
                    onClick={() => {
                      setSearchScope(scope);
                      setSearchResponse({ results: [], errors: [] });
                      setSubmittedSearch(null);
                      setJoinedResultKeys(new Set());
                    }}
                  >
                    {searchScopeLabels[scope]}
                  </button>
                ))}
              </div>
            </div>
            {searchWorkspaceContent}
          </section>
        )}

        {osuOnly ? null : queuePanel}

        <aside className="downloads-side">
          {osuOnly ? queuePanel : null}
          <section className="downloads-panel downloads-settings-panel" data-attention={needsFolder}>
            <div className="downloads-section-title">
              <Settings2 size={17} />
              <h2>{t('downloads.settings.title')}</h2>
            </div>
            {osuOnly ? null : <div className="download-output-path">
              <em>{t('downloads.settings.audioStrategy')}</em>
              <strong>{t('downloads.settings.bestAvailable')}</strong>
            </div>}
            {osuOnly ? (
              <label className="download-setting-field download-setting-field--mirror">
                <span>{t('downloads.settings.osuMirror.title')}</span>
                <select
                  aria-label={t('downloads.settings.osuMirror.title')}
                  value={settings.osuDownloadMirror}
                  onChange={(event) => void patchSettings({ osuDownloadMirror: event.target.value as OsuDownloadMirror })}
                >
                  {osuDownloadMirrorOptions.map((option) => (
                    <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                  ))}
                </select>
                <small>{t(selectedOsuMirrorOption.detailKey)}</small>
              </label>
            ) : null}
            <div className="download-output-path">
              <em>{osuOnly ? t('downloads.settings.osuOutputDirectory') : t('downloads.settings.outputDirectory')}</em>
              <strong title={osuOnly ? formatPath(settings.osuOutputDirectory, t) : formatPath(settings.outputDirectory, t)}>
                {osuOnly ? formatPath(settings.osuOutputDirectory, t) : formatPath(settings.outputDirectory, t)}
              </strong>
            </div>
            <button className="downloads-action-button" type="button" onClick={() => void handleChooseDirectory(osuOnly ? 'osu' : 'default')} disabled={busyAction === 'folder'}>
              <FolderOpen size={16} />
              {(osuOnly ? settings.osuOutputDirectory : settings.outputDirectory) ? t('downloads.action.changeFolder') : t('downloads.action.chooseFolder')}
            </button>
            <label className="download-toggle-row">
              <input type="checkbox" checked={settings.importToLibrary} onChange={(event) => void patchSettings({ importToLibrary: event.target.checked })} />
              <span>{t('downloads.settings.importToLibrary')}</span>
            </label>
            {osuOnly ? null : <label className="download-toggle-row">
              <input type="checkbox" checked={settings.bindMvAfterImport} onChange={(event) => void patchSettings({ bindMvAfterImport: event.target.checked })} />
              <span>{t('downloads.settings.bindMvAfterImport')}</span>
            </label>}
            {osuOnly ? (
              <div className="downloads-settings-tool-status">
                <ToolStatus label="ffmpeg" ready={tools?.ffmpegAvailable ?? false} detail={tools?.ffmpegPath ?? t('downloads.tools.notDetected')} />
              </div>
            ) : null}
          </section>

          {osuOnly ? null : <section className="downloads-panel downloads-tools-panel">
            <div className="downloads-section-title">
              <Wrench size={17} />
              <h2>{t('downloads.tools.title')}</h2>
            </div>
            <div className="download-tools-list">
              {osuOnly ? null : <ToolStatus label="yt-dlp" ready={tools?.ytDlpAvailable ?? false} detail={tools?.ytDlpVersion ?? t('downloads.tools.notBundled')} />}
              <ToolStatus label="ffmpeg" ready={tools?.ffmpegAvailable ?? false} detail={tools?.ffmpegPath ?? t('downloads.tools.notDetected')} />
            </div>
          </section>}
        </aside>
      </main>
    </div>
  );
};
