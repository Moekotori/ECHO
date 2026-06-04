import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, FileAudio, FolderOpen, Link2, Search, Settings2, Square, Wrench, XCircle } from 'lucide-react';
import type {
  DownloadJob,
  DownloadJobStatus,
  DownloadSearchProvider,
  DownloadSearchResponse,
  DownloadSearchResult,
  DownloadSearchScope,
  DownloadSettings,
  DownloadToolsStatus,
} from '../../shared/types/downloads';
import { EmptyState } from '../components/ui/EmptyState';
import { translateFallback, useOptionalI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { getDownloadsBridge } from '../utils/echoBridge';
import { isImeComposingKeyEvent } from '../utils/imeInput';

const terminalStatuses = new Set<DownloadJobStatus>(['completed', 'failed', 'cancelled']);
const runningStatuses = new Set<DownloadJobStatus>(['queued', 'probing', 'downloading', 'extracting_audio', 'importing', 'binding_mv']);

const defaultSettings: DownloadSettings = {
  audioStrategy: 'best_available',
  importToLibrary: true,
  bindMvAfterImport: true,
  outputDirectory: null,
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
  all: 'YouTube + Bilibili',
  youtube: 'YouTube',
  bilibili: 'Bilibili',
};

const searchScopes: DownloadSearchScope[] = ['all', 'youtube', 'bilibili'];

type Translate = (key: TranslationKey, options?: Record<string, string | number>) => string;

const formatError = (error: unknown, t: Translate): string => (error instanceof Error ? error.message : String(error || t('downloads.error.operationFailed')));

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

const JobRow = ({ job, onCancel }: { job: DownloadJob; onCancel: (jobId: string) => void }): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const canCancel = runningStatuses.has(job.status);
  const duration = formatDuration(job.durationSeconds);
  const downloaded = formatBytes(job.downloadedBytes);
  const total = formatBytes(job.totalBytes);
  const speed = formatBytes(job.speedBytesPerSecond);
  const eta = formatEta(job.etaSeconds);

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
          <em>{Math.round(job.progress)}%</em>
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
        <small>{[views, result.publishedAt].filter(Boolean).join(' · ') || result.webpageUrl}</small>
      </div>
      <button className="downloads-action-button" type="button" disabled={joined} onClick={() => onDownload(result)}>
        <Download size={15} />
        {joined ? t('downloads.search.joined') : t('downloads.search.downloadAudio')}
      </button>
    </article>
  );
};

export const DownloadsPage = (): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [url, setUrl] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchScope, setSearchScope] = useState<DownloadSearchScope>('all');
  const [searchResponse, setSearchResponse] = useState<DownloadSearchResponse>({ results: [], errors: [] });
  const [joinedResultKeys, setJoinedResultKeys] = useState<Set<string>>(() => new Set());
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [settings, setSettings] = useState<DownloadSettings>(defaultSettings);
  const [tools, setTools] = useState<DownloadToolsStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'create' | 'clear' | 'tools' | 'folder' | 'search' | null>(null);
  const [needsFolder, setNeedsFolder] = useState(false);
  const jobStatusRef = useRef<Map<string, DownloadJobStatus>>(new Map());

  const bridge = getDownloadsBridge();
  const completedCount = useMemo(() => jobs.filter((job) => terminalStatuses.has(job.status)).length, [jobs]);
  const visibleSearchResults =
    searchScope === 'all' ? searchResponse.results : searchResponse.results.filter((result) => result.provider === searchScope);
  const visibleSearchErrors =
    searchScope === 'all' ? searchResponse.errors : searchResponse.errors.filter((item) => item.provider === searchScope);
  const searchProviderErrors = visibleSearchErrors
    .map((item) => t('downloads.search.providerErrorItem', { provider: providerLabels[item.provider], error: formatSearchProviderError(item.error, t) }))
    .join(t('punctuation.clauseSeparator'));

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
      setError(formatError(jobsError, t));
    }
  }, [bridge, t]);

  const refreshTools = useCallback(async (): Promise<void> => {
    if (!bridge?.checkTools) {
      setTools({ ytDlpAvailable: false, ffmpegAvailable: false, ytDlpVersion: null, ytDlpPath: null, ffmpegPath: null });
      return;
    }

    setBusyAction('tools');
    try {
      setTools(await bridge.checkTools());
    } catch (toolsError) {
      setError(formatError(toolsError, t));
    } finally {
      setBusyAction(null);
    }
  }, [bridge, t]);

  useEffect(() => {
    if (!bridge) {
      setError(t('downloads.error.ipcUnavailable'));
      return undefined;
    }

    void refreshJobs();
    void bridge.getSettings?.().then(setSettings).catch((settingsError) => setError(formatError(settingsError, t)));
    void refreshTools();

    return bridge.onJobsUpdated?.((nextJobs) => {
      for (const job of nextJobs) {
        const previousStatus = jobStatusRef.current.get(job.id);
        if (previousStatus && previousStatus !== 'completed' && job.status === 'completed') {
          setMessage(t('downloads.message.completed', { title: job.title ?? job.sourceUrl }));
          setError(null);
          break;
        }
      }
      jobStatusRef.current = new Map(nextJobs.map((job) => [job.id, job.status]));
      setJobs(nextJobs);
    });
  }, [bridge, refreshJobs, refreshTools, t]);

  const createDownload = useCallback(
    async (sourceUrl: string): Promise<DownloadJob | null> => {
      if (!bridge?.createUrlJob) {
        return null;
      }

      if (!settings.outputDirectory) {
        setNeedsFolder(true);
        setError(t('downloads.folder.required'));
        setMessage(null);
        return null;
      }

      const job = await bridge.createUrlJob(sourceUrl, {
        importToLibrary: settings.importToLibrary,
        bindMvAfterImport: settings.bindMvAfterImport,
      });
      jobStatusRef.current.set(job.id, job.status);
      setJobs((current) => (current.some((item) => item.id === job.id) ? current : [job, ...current]));
      setNeedsFolder(false);
      return job;
    },
    [bridge, settings, t],
  );

  const handleCreate = useCallback(async (): Promise<void> => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return;
    }

    setBusyAction('create');
    setError(null);
    setMessage(null);

    try {
      const job = await createDownload(trimmedUrl);
      if (job) {
        setUrl('');
        setMessage(t('downloads.message.queued'));
      }
    } catch (createError) {
      const nextError = formatError(createError, t);
      setNeedsFolder(nextError.includes(t('downloads.folder.required')));
      setError(nextError);
    } finally {
      setBusyAction(null);
    }
  }, [createDownload, t, url]);

  const handleSearch = useCallback(async (): Promise<void> => {
    const query = searchInput.trim();
    if (!query || !bridge?.search) {
      return;
    }

    setBusyAction('search');
    setError(null);
    setMessage(null);
    setSearchResponse({ results: [], errors: [] });
    setJoinedResultKeys(new Set());

    try {
      setSearchResponse(await bridge.search({ query, limitPerProvider: 10, provider: searchScope }));
    } catch (searchError) {
      setError(formatError(searchError, t));
    } finally {
      setBusyAction(null);
    }
  }, [bridge, searchInput, searchScope, t]);

  const handleDownloadSearchResult = useCallback(
    async (result: DownloadSearchResult): Promise<void> => {
      setError(null);
      setMessage(null);

      try {
        const job = await createDownload(result.webpageUrl);
        if (!job) {
          return;
        }

        setJoinedResultKeys((current) => new Set([...current, searchResultKey(result)]));
        setMessage(t('downloads.message.resultQueued', { title: result.title }));
      } catch (downloadError) {
        const nextError = formatError(downloadError, t);
        setNeedsFolder(nextError.includes(t('downloads.folder.required')));
        setError(nextError);
      }
    },
    [createDownload, t],
  );

  const handleChooseDirectory = useCallback(async (): Promise<void> => {
    if (!bridge?.chooseOutputDirectory) {
      return;
    }

    setBusyAction('folder');
    setError(null);
    try {
      const nextSettings = await bridge.chooseOutputDirectory();
      if (nextSettings) {
        setSettings(nextSettings);
        setNeedsFolder(false);
      }
    } catch (directoryError) {
      setError(formatError(directoryError, t));
    } finally {
      setBusyAction(null);
    }
  }, [bridge, t]);

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
        setError(formatError(cancelError, t));
      }
    },
    [bridge, t],
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
      setError(formatError(clearError, t));
    } finally {
      setBusyAction(null);
    }
  }, [bridge, t]);

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

  return (
    <div className="downloads-page">
      <header className="downloads-header">
        <div>
          <span className="panel-kicker">Downloader</span>
          <h1>{t('downloads.title')}</h1>
          <p>{t('downloads.description')}</p>
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
              type="url"
              value={url}
              placeholder={t('downloads.url.placeholder')}
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
                    setJoinedResultKeys(new Set());
                  }}
                >
                  {searchScopeLabels[scope]}
                </button>
              ))}
            </div>
          </div>
          <form
            className="downloads-url-box"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSearch();
            }}
          >
            <label className="downloads-search-box">
              <Search size={16} />
              <input
                type="search"
                value={searchInput}
                placeholder={t('downloads.search.placeholder')}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>
            <button className="downloads-action-button" type="submit" disabled={!searchInput.trim() || busyAction === 'search'}>
              <Search size={16} />
              {busyAction === 'search' ? t('downloads.action.searching') : t('downloads.action.search')}
            </button>
          </form>

          {searchProviderErrors ? <p className="downloads-note">{t('downloads.search.providerErrors', { errors: searchProviderErrors })}</p> : null}
          <div className="download-search-results">
            {busyAction === 'search' ? (
              <EmptyState icon={Search} title={t('downloads.empty.searching.title')} description={t('downloads.empty.searching.description', { scope: searchScopeLabels[searchScope] })} meta="Searching" />
            ) : visibleSearchResults.length === 0 && searchInput.trim() ? (
              <EmptyState icon={Search} title={t('downloads.empty.noResults.title')} description={t('downloads.empty.noResults.description')} meta="Search" />
            ) : (
              visibleSearchResults.map((result) => (
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

        <section className="downloads-panel downloads-queue-panel">
          <div className="downloads-section-title downloads-section-title--split">
            <div>
              <Download size={17} />
              <h2>{t('downloads.queue.title')}</h2>
            </div>
            <button className="downloads-action-button" type="button" disabled={completedCount === 0 || busyAction === 'clear'} onClick={() => void handleClearCompleted()}>
              {t('downloads.action.clearCompleted')}
            </button>
          </div>

          <div className="download-job-list">
            {jobs.length === 0 ? (
              <EmptyState icon={Download} title={t('downloads.empty.queue.title')} description={t('downloads.empty.queue.description')} meta="Idle" />
            ) : (
              jobs.map((job) => <JobRow job={job} key={job.id} onCancel={(jobId) => void handleCancel(jobId)} />)
            )}
          </div>
        </section>

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
            <div className="download-output-path">
              <em>{t('downloads.settings.outputDirectory')}</em>
              <strong title={formatPath(settings.outputDirectory, t)}>{formatPath(settings.outputDirectory, t)}</strong>
            </div>
            <button className="downloads-action-button" type="button" onClick={() => void handleChooseDirectory()} disabled={busyAction === 'folder'}>
              <FolderOpen size={16} />
              {settings.outputDirectory ? t('downloads.action.changeFolder') : t('downloads.action.chooseFolder')}
            </button>
            <label className="download-toggle-row">
              <input type="checkbox" checked={settings.importToLibrary} onChange={(event) => void patchSettings({ importToLibrary: event.target.checked })} />
              <span>{t('downloads.settings.importToLibrary')}</span>
            </label>
            <label className="download-toggle-row">
              <input type="checkbox" checked={settings.bindMvAfterImport} onChange={(event) => void patchSettings({ bindMvAfterImport: event.target.checked })} />
              <span>{t('downloads.settings.bindMvAfterImport')}</span>
            </label>
          </section>

          <section className="downloads-panel">
            <div className="downloads-section-title">
              <Wrench size={17} />
              <h2>{t('downloads.tools.title')}</h2>
            </div>
            <div className="download-tools-list">
              <ToolStatus label="yt-dlp" ready={tools?.ytDlpAvailable ?? false} detail={tools?.ytDlpVersion ?? t('downloads.tools.notBundled')} />
              <ToolStatus label="ffmpeg" ready={tools?.ffmpegAvailable ?? false} detail={tools?.ffmpegPath ?? t('downloads.tools.notDetected')} />
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
};
