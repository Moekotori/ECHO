import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, FileAudio, FolderOpen, Link2, Search, Settings2, Square, Wrench, X, XCircle } from 'lucide-react';
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
  OsuDownloadMirror,
} from '../../shared/types/downloads';
import { EmptyState } from '../components/ui/EmptyState';
import { translateFallback, useOptionalI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { getDownloadsBridge } from '../utils/echoBridge';
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

type DownloadsPageProps = {
  variant?: 'all' | 'osu';
};

type Translate = (key: TranslationKey, options?: Record<string, string | number>) => string;
type DownloadNotice = {
  tone: 'info' | 'success' | 'error';
  title: string;
  detail?: string | null;
  jobId?: string | null;
};

const formatError = (error: unknown, t: Translate): string =>
  formatUserFacingError(error, { context: 'downloads', fallback: t('downloads.error.operationFailed') });

const isOsuBeatmapsetUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    return (host === 'osu.ppy.sh' || host === 'www.osu.ppy.sh') && /^\/(?:beatmapsets|s)\/\d+(?:\/|$)/u.test(url.pathname);
  } catch {
    return false;
  }
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
  const progressLabel = `${Math.round(job.progress)}%`;
  const artist = job.artist?.trim() || null;
  const compactTitle = artist && job.title?.startsWith(`${artist} - `) ? job.title.slice(artist.length + 3) : (job.title ?? 'Untitled download');

  if (compact) {
    return (
      <article className="download-job-row download-job-row--compact" data-status={job.status}>
        <div className="download-job-main">
          <div className="download-job-copy">
            <strong>{compactTitle}</strong>
            {artist ? <span>{artist}</span> : null}
          </div>
        </div>

        <div className="download-job-progress">
          <div className="download-progress-track" aria-label={progressLabel}>
            <span style={{ width: `${job.progress}%` }} />
          </div>
        </div>
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
        <div className="download-progress-track" aria-label={`${Math.round(job.progress)}%`}>
          <span style={{ width: `${job.progress}%` }} />
        </div>
        <div className="download-job-meta">
          <span>{t(statusLabelKeys[job.status])}</span>
          <em>{progressLabel}</em>
        </div>
        <div className="download-job-meta">
          <span>{downloaded && total ? `${downloaded} / ${total}` : downloaded ?? t('downloads.job.waitingProgress')}</span>
          <em>{speed ? `${speed}/s` : eta ? `ETA ${eta}` : ''}</em>
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

export const DownloadsPage = ({ variant = 'all' }: DownloadsPageProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const osuOnly = variant === 'osu';
  const [url, setUrl] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchScope, setSearchScope] = useState<DownloadSearchScope>(osuOnly ? 'osu' : 'all');
  const [searchResponse, setSearchResponse] = useState<DownloadSearchResponse>({ results: [], errors: [] });
  const [submittedSearch, setSubmittedSearch] = useState<{ query: string; scope: DownloadSearchScope } | null>(null);
  const [joinedResultKeys, setJoinedResultKeys] = useState<Set<string>>(() => new Set());
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [settings, setSettings] = useState<DownloadSettings>(defaultSettings);
  const [tools, setTools] = useState<DownloadToolsStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<DownloadNotice | null>(null);
  const [busyAction, setBusyAction] = useState<'create' | 'clear' | 'tools' | 'folder' | 'search' | null>(null);
  const [needsFolder, setNeedsFolder] = useState(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const jobStatusRef = useRef<Map<string, DownloadJobStatus>>(new Map());

  const bridge = getDownloadsBridge();
  const activeSearchScope: DownloadSearchScope = osuOnly ? 'osu' : searchScope;
  const visibleJobs = useMemo(() => (osuOnly ? jobs.filter((job) => job.provider === 'osu') : jobs), [jobs, osuOnly]);
  const completedCount = useMemo(() => visibleJobs.filter((job) => terminalStatuses.has(job.status)).length, [visibleJobs]);
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
  const noticeJob = useMemo(() => (notice?.jobId ? jobs.find((job) => job.id === notice.jobId) ?? null : null), [jobs, notice?.jobId]);
  const noticeProgress = noticeJob ? Math.max(0, Math.min(100, Math.round(noticeJob.progress))) : null;
  const noticeStatus = noticeJob ? t(statusLabelKeys[noticeJob.status]) : null;
  const noticeDetail = noticeJob ? (noticeJob.artist ? `${noticeJob.artist} - ${noticeJob.title ?? noticeJob.sourceUrl}` : noticeJob.title ?? noticeJob.sourceUrl) : notice?.detail;
  const noticeTitle = noticeJob && terminalStatuses.has(noticeJob.status) ? t(statusLabelKeys[noticeJob.status]) : notice?.title;

  const showNotice = useCallback((nextNotice: DownloadNotice): void => {
    setNotice(nextNotice);
  }, []);

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

  const focusSearchInputFromEmptyState = useCallback((): void => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

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
    void bridge.getSettings?.().then(setSettings).catch((settingsError) => setError(formatError(settingsError, t)));
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
        ...(osuOnly ? { providerLock: 'osu' as const } : {}),
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

  const handleClearCompleted = useCallback(async (): Promise<void> => {
    if (!bridge?.clearCompleted) {
      return;
    }

    setBusyAction('clear');
    setError(null);

    try {
      setJobs(await bridge.clearCompleted());
      setMessage(t('downloads.message.clearedTerminal'));
    } catch (clearError) {
      const nextError = formatError(clearError, t);
      setError(nextError);
      showNotice({ tone: 'error', title: t('downloads.error.operationFailed'), detail: nextError });
    } finally {
      setBusyAction(null);
    }
  }, [bridge, showNotice, t]);

  const patchSettings = useCallback(
    async (patch: Partial<DownloadSettings>): Promise<void> => {
      const nextSettings = { ...settings, ...patch };
      setSettings(nextSettings);

      if (!bridge?.setSettings) {
        return;
      }

      try {
        setSettings(await bridge.setSettings(patch));
      } catch (settingsError) {
        setError(formatError(settingsError, t));
      }
    },
    [bridge, settings, t],
  );

  const queuePanel = (
    <section className="downloads-panel downloads-queue-panel">
      <div className="downloads-section-title downloads-section-title--split">
        <div>
          {osuOnly ? null : <Download size={17} />}
          <h2>{t('downloads.queue.title')}</h2>
        </div>
        {osuOnly ? null : <button className="downloads-action-button" type="button" disabled={completedCount === 0 || busyAction === 'clear'} onClick={() => void handleClearCompleted()}>
          {t('downloads.action.clearCompleted')}
        </button>}
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
          visibleJobs.map((job) => <JobRow compact={osuOnly} job={job} key={job.id} onCancel={(jobId) => void handleCancel(jobId)} />)
        )}
      </div>
    </section>
  );

  return (
    <div className={`downloads-page${osuOnly ? ' downloads-page--osu' : ''}`}>
      {notice ? (
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
      <header className="downloads-header">
        <div>
          <span className="panel-kicker">Downloader</span>
          <h1>{osuOnly ? 'osu downloader' : t('downloads.title')}</h1>
          <p>{osuOnly ? 'Download osu! beatmaps as tagged MP3 files.' : t('downloads.description')}</p>
        </div>
        <button className="downloads-action-button" type="button" onClick={() => void refreshTools()} disabled={busyAction === 'tools'}>
          <Wrench size={16} />
          {t('downloads.action.checkTools')}
        </button>
      </header>

      <main className="downloads-grid">
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
          {error ? <p className="downloads-error">{error}</p> : null}
        </section>

        <section className="downloads-panel downloads-search-panel" aria-label={t('downloads.search.aria')}>
          <div className="downloads-section-title">
            <Search size={17} />
            <h2>{t('downloads.search.title')}</h2>
            {osuOnly ? null : <div className="download-search-scope" role="group" aria-label={t('downloads.search.scopeAria')}>
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
            </div>}
          </div>
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
        </section>

        {osuOnly ? null : queuePanel}

        <aside className="downloads-side">
          <section className="downloads-panel" data-attention={needsFolder}>
            <div className="downloads-section-title">
              <Settings2 size={17} />
              <h2>{t('downloads.settings.title')}</h2>
            </div>
            <div className="download-output-path">
              <em>{t('downloads.settings.audioStrategy')}</em>
              <strong>{t('downloads.settings.bestAvailable')}</strong>
            </div>
            {osuOnly ? (
              <div className="download-setting-field">
                <span>{t('downloads.settings.osuMirror.title')}</span>
                <div className="download-mirror-options" role="group" aria-label={t('downloads.settings.osuMirror.title')}>
                  {osuDownloadMirrorOptions.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={settings.osuDownloadMirror === option.value}
                      className="download-mirror-option"
                      onClick={() => void patchSettings({ osuDownloadMirror: option.value })}
                    >
                      <strong>{t(option.labelKey)}</strong>
                      <em>{t(option.detailKey)}</em>
                    </button>
                  ))}
                </div>
              </div>
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
          </section>

          <section className="downloads-panel">
            <div className="downloads-section-title">
              <Wrench size={17} />
              <h2>{t('downloads.tools.title')}</h2>
            </div>
            <div className="download-tools-list">
              {osuOnly ? null : <ToolStatus label="yt-dlp" ready={tools?.ytDlpAvailable ?? false} detail={tools?.ytDlpVersion ?? t('downloads.tools.notBundled')} />}
              <ToolStatus label="ffmpeg" ready={tools?.ffmpegAvailable ?? false} detail={tools?.ffmpegPath ?? t('downloads.tools.notDetected')} />
            </div>
          </section>
          {osuOnly ? queuePanel : null}
        </aside>
      </main>
    </div>
  );
};
