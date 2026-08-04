import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FolderOpen, ListFilter, RefreshCw, Search, Wand2 } from 'lucide-react';
import type {
  LibraryQualityIssueKind,
  LibraryQualityIssuePage,
  LibraryQualityIssueReason,
  LibraryQualityOverviewItem,
  MissingMetadataField,
  NetworkMetadataScanJobStatus,
} from '../../../shared/types/library';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { getLibraryBridge } from '../../utils/echoBridge';

type LibraryQualityPanelProps = {
  autoRefresh?: boolean;
  networkMetadataEnabled?: boolean;
};

const issueKindFields: Partial<Record<LibraryQualityIssueKind, MissingMetadataField[]>> = {
  missing_cover: ['cover'],
  unknown_artist_album: ['artist', 'album', 'albumArtist'],
};

type TranslateOptions = Record<string, string | number>;
type Translate = (key: TranslationKey, options?: TranslateOptions) => string;
const fallbackT: Translate = translateFallback;

const reasonLabelKeys: Record<LibraryQualityIssueReason, TranslationKey> = {
  missing_cover: 'mediaLibrary.quality.reason.missingCover',
  missing_title: 'mediaLibrary.quality.reason.missingTitle',
  missing_artist: 'mediaLibrary.quality.reason.missingArtist',
  missing_album: 'mediaLibrary.quality.reason.missingAlbum',
  missing_album_artist: 'mediaLibrary.quality.reason.missingAlbumArtist',
  missing_track_no: 'mediaLibrary.quality.reason.missingTrackNo',
  missing_disc_no: 'mediaLibrary.quality.reason.missingDiscNo',
  missing_year: 'mediaLibrary.quality.reason.missingYear',
  missing_genre: 'mediaLibrary.quality.reason.missingGenre',
  unknown_artist: 'mediaLibrary.quality.reason.unknownArtist',
  filename_fallback: 'mediaLibrary.quality.reason.filenameFallback',
  unknown_field: 'mediaLibrary.quality.reason.unknownField',
  metadata_fallback: 'mediaLibrary.quality.reason.metadataFallback',
  unknown_album: 'mediaLibrary.quality.reason.unknownAlbum',
  embedded_metadata_error: 'mediaLibrary.quality.reason.embeddedMetadataError',
  embedded_cover_error: 'mediaLibrary.quality.reason.embeddedCoverError',
  network_metadata_candidate: 'mediaLibrary.quality.reason.networkMetadataCandidate',
  network_cover_candidate: 'mediaLibrary.quality.reason.networkCoverCandidate',
};

const emptyPage = (kind: LibraryQualityIssueKind): LibraryQualityIssuePage => ({
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  hasMore: false,
  kind,
});

const formatReason = (reason: LibraryQualityIssueReason, t: Translate): string => {
  const key = reasonLabelKeys[reason];
  return key ? t(key) : reason;
};

const overviewTotal = (overview: LibraryQualityOverviewItem[]): number =>
  overview.reduce((total, item) => total + item.count, 0);

const wait = (durationMs: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, durationMs));

const getCoverBackfillTotal = (job: NetworkMetadataScanJobStatus): number =>
  Math.max(0, job.totalTracks || job.scannedCount || job.diagnostics.targetCount);

const getCoverBackfillProcessed = (job: NetworkMetadataScanJobStatus): number => {
  const total = getCoverBackfillTotal(job);
  return Math.max(0, Math.min(total || job.processedTracks, job.processedTracks));
};

const getCoverBackfillProgressPercent = (job: NetworkMetadataScanJobStatus): number => {
  const total = getCoverBackfillTotal(job);
  if (total <= 0) {
    return job.status === 'completed' || job.status === 'failed' ? 100 : 0;
  }

  return Math.max(0, Math.min(100, Math.round((getCoverBackfillProcessed(job) / total) * 100)));
};

const isCoverBackfillApplying = (job: NetworkMetadataScanJobStatus): boolean =>
  job.status === 'running' && job.scannedCount > 0 && job.processedTracks > job.scannedCount;

const coverBackfillPhaseLabel = (job: NetworkMetadataScanJobStatus, indeterminate: boolean, t: Translate): string => {
  if (job.status === 'completed') {
    return t('mediaLibrary.quality.coverBackfill.completed');
  }
  if (job.status === 'failed') {
    return t('mediaLibrary.quality.coverBackfill.failed');
  }
  if (isCoverBackfillApplying(job)) {
    return t('mediaLibrary.quality.coverBackfill.applying');
  }
  if (job.candidateCount > 0) {
    return t('mediaLibrary.quality.coverBackfill.searchingThenApply');
  }
  return indeterminate ? t('mediaLibrary.quality.coverBackfill.detecting') : t('mediaLibrary.quality.coverBackfill.searching');
};

const formatMissingCoverBackfillMessage = (job: NetworkMetadataScanJobStatus, t: Translate): string => {
  const total = job.totalTracks || job.scannedCount || job.diagnostics.targetCount;
  const processed = Math.min(total || job.processedTracks, job.processedTracks);
  const applied = job.diagnostics.appliedCount;

  if (job.status === 'queued') {
    return t('mediaLibrary.quality.coverBackfill.queued');
  }
  if (job.status === 'running') {
    if (!total) {
      return t('mediaLibrary.quality.coverBackfill.runningIndeterminate');
    }
    return t('mediaLibrary.quality.coverBackfill.running', { processed, total, applied });
  }
  if (job.status === 'failed') {
    return t('mediaLibrary.quality.coverBackfill.failedReason', { reason: job.errors[0] ?? t('mediaLibrary.quality.unknownError') });
  }

  return t('mediaLibrary.quality.coverBackfill.completedDetail', { scanned: job.scannedCount, candidates: job.candidateCount, applied });
};

export const LibraryQualityPanel = ({ autoRefresh = true, networkMetadataEnabled = false }: LibraryQualityPanelProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? fallbackT;
  const [expanded, setExpanded] = useState(false);
  const [overview, setOverview] = useState<LibraryQualityOverviewItem[]>([]);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [selectedKind, setSelectedKind] = useState<LibraryQualityIssueKind>('missing_cover');
  const [issuePage, setIssuePage] = useState<LibraryQualityIssuePage>(() => emptyPage('missing_cover'));
  const [issuesBusy, setIssuesBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [coverBackfillJob, setCoverBackfillJob] = useState<NetworkMetadataScanJobStatus | null>(null);
  const coverBackfillPollGenerationRef = useRef(0);
  const coverBackfillPollingJobIdRef = useRef<string | null>(null);
  const total = useMemo(() => overviewTotal(overview), [overview]);
  const selectedOverview = overview.find((item) => item.kind === selectedKind) ?? null;
  const selectedFields = issueKindFields[selectedKind] ?? [];
  const coverBackfillProgressPercent = coverBackfillJob ? getCoverBackfillProgressPercent(coverBackfillJob) : 0;
  const coverBackfillTotal = coverBackfillJob ? getCoverBackfillTotal(coverBackfillJob) : 0;
  const coverBackfillProcessed = coverBackfillJob ? getCoverBackfillProcessed(coverBackfillJob) : 0;
  const coverBackfillIndeterminate = Boolean(
    coverBackfillJob && coverBackfillTotal === 0 && (coverBackfillJob.status === 'queued' || coverBackfillJob.status === 'running'),
  );
  const coverBackfillProgressTitle =
    coverBackfillJob?.status === 'completed'
      ? t('mediaLibrary.quality.coverBackfill.completed')
      : coverBackfillJob?.status === 'failed'
        ? t('mediaLibrary.quality.coverBackfill.failed')
        : t('mediaLibrary.quality.coverBackfill.inProgress');
  const coverBackfillProgressLabel = coverBackfillIndeterminate
    ? t('mediaLibrary.quality.coverBackfill.detecting')
    : `${coverBackfillProcessed} / ${coverBackfillTotal || coverBackfillProcessed}`;
  const coverBackfillPhase = coverBackfillJob ? coverBackfillPhaseLabel(coverBackfillJob, coverBackfillIndeterminate, t) : null;

  const refreshOverview = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.getLibraryQualityOverview) {
      setOverview([]);
      setMessage(t('mediaLibrary.quality.error.bridgeOverview'));
      return;
    }

    setOverviewBusy(true);
    try {
      setOverview(await library.getLibraryQualityOverview());
    } catch (error) {
      setOverview([]);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOverviewBusy(false);
    }
  }, [t]);

  const loadIssues = useCallback(
    async (kind: LibraryQualityIssueKind, page = 1, nextSearch = search): Promise<void> => {
      const library = getLibraryBridge();
      if (!library?.getLibraryQualityIssues) {
        setIssuePage(emptyPage(kind));
        setMessage(t('mediaLibrary.quality.error.bridgeIssues'));
        return;
      }

      setIssuesBusy(true);
      try {
        const nextPage = await library.getLibraryQualityIssues({
          kind,
          page,
          pageSize: 20,
          sourceProvider: 'local',
          search: nextSearch,
        });
        setIssuePage(nextPage);
        setSelectedKind(kind);
      } catch (error) {
        setIssuePage(emptyPage(kind));
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setIssuesBusy(false);
      }
    },
    [search, t],
  );

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    let cancelled = false;
    let idleId: number | null = null;
    let timeoutId: number | null = null;
    const refreshWhenIdle = (): void => {
      if (!cancelled) {
        void refreshOverview();
      }
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(refreshWhenIdle, { timeout: 1500 });
    } else {
      timeoutId = window.setTimeout(refreshWhenIdle, 250);
    }

    const unsubscribe = getLibraryBridge()?.onLibraryChanged?.(() => {
      void refreshOverview();
    });
    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      unsubscribe?.();
    };
  }, [autoRefresh, refreshOverview]);

  const handleSelectKind = useCallback(
    (kind: LibraryQualityIssueKind): void => {
      setMessage(null);
      void loadIssues(kind, 1);
    },
    [loadIssues],
  );

  const handleSearchSubmit = useCallback((): void => {
    void loadIssues(selectedKind, 1, search);
  }, [loadIssues, search, selectedKind]);

  const handleToggleExpanded = useCallback((): void => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && overview.length === 0 && !overviewBusy) {
      void refreshOverview();
    }
    if (nextExpanded && issuePage.items.length === 0 && issuePage.total === 0) {
      void loadIssues(selectedKind, 1);
    }
  }, [expanded, issuePage.items.length, issuePage.total, loadIssues, overview.length, overviewBusy, refreshOverview, selectedKind]);

  const handleOpenTrack = useCallback(async (trackId: string): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.openTrackInFolder) {
      setMessage(t('mediaLibrary.quality.error.bridgeOpenTrack'));
      return;
    }

    setActionBusy(`open:${trackId}`);
    try {
      await library.openTrackInFolder(trackId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(null);
    }
  }, [t]);

  const handleRepairTrack = useCallback(
    async (trackId: string): Promise<void> => {
      const library = getLibraryBridge();
      if (!networkMetadataEnabled) {
        setMessage(t('mediaLibrary.quality.message.enableNetworkFirstRepair'));
        return;
      }
      if (!library?.repairMissingMetadata) {
        setMessage(t('mediaLibrary.quality.error.bridgeRepair'));
        return;
      }

      setActionBusy(`repair:${trackId}`);
      try {
        const result = await library.repairMissingMetadata(trackId);
        const candidateCount = result.metadata.length + result.covers.length;
        setMessage(t('mediaLibrary.quality.message.repairDone', { candidates: candidateCount, applied: result.diagnostics.appliedCount }));
        await refreshOverview();
        await loadIssues(selectedKind, issuePage.page);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setActionBusy(null);
      }
    },
    [issuePage.page, loadIssues, networkMetadataEnabled, refreshOverview, selectedKind, t],
  );

  const pollMissingCoverBackfillJob = useCallback(
    async (jobId: string): Promise<void> => {
      if (coverBackfillPollingJobIdRef.current === jobId) {
        return;
      }

      const library = getLibraryBridge();
      if (!library?.getMissingCoverBackfillStatus) {
        setActionBusy(null);
        setMessage(t('mediaLibrary.quality.error.bridgeCoverProgress'));
        return;
      }

      const pollGeneration = coverBackfillPollGenerationRef.current + 1;
      coverBackfillPollGenerationRef.current = pollGeneration;
      coverBackfillPollingJobIdRef.current = jobId;
      const isCurrentPoll = (): boolean => coverBackfillPollGenerationRef.current === pollGeneration;

      try {
        for (;;) {
          await wait(900);
          if (!isCurrentPoll()) {
            return;
          }
          const status = await library.getMissingCoverBackfillStatus(jobId);
          if (!isCurrentPoll()) {
            return;
          }
          setCoverBackfillJob(status);
          setMessage(formatMissingCoverBackfillMessage(status, t));
          if (status.status === 'completed' || status.status === 'failed') {
            await refreshOverview();
            await loadIssues(selectedKind, issuePage.page);
            return;
          }
        }
      } catch (error) {
        if (isCurrentPoll()) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (isCurrentPoll()) {
          setActionBusy(null);
          coverBackfillPollingJobIdRef.current = null;
        }
      }
    },
    [issuePage.page, loadIssues, refreshOverview, selectedKind, t],
  );

  useEffect(() => {
    return () => {
      coverBackfillPollGenerationRef.current += 1;
      coverBackfillPollingJobIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!networkMetadataEnabled) {
      return;
    }

    const library = getLibraryBridge();
    if (!library?.getActiveMissingCoverBackfillStatus) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const status = await library.getActiveMissingCoverBackfillStatus?.();
        if (cancelled || !status) {
          return;
        }

        setCoverBackfillJob(status);
        setMessage(formatMissingCoverBackfillMessage(status, t));
        if (status.status === 'queued' || status.status === 'running') {
          setActionBusy('cover-backfill');
          void pollMissingCoverBackfillJob(status.id);
        }
      } catch {
        // Reattaching to an existing main-process job is best-effort.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [networkMetadataEnabled, pollMissingCoverBackfillJob, t]);

  const handleStartBatchScan = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!networkMetadataEnabled) {
      setMessage(t('mediaLibrary.quality.message.enableNetworkFirstScan'));
      return;
    }
    if (!selectedOverview?.actionAvailable) {
      setMessage(t('mediaLibrary.quality.message.actionUnavailable'));
      return;
    }
    if (!library?.startMissingMetadataScan) {
      setMessage(t('mediaLibrary.quality.error.bridgeStartScan'));
      return;
    }

    const isMissingCoverBackfill = selectedKind === 'missing_cover';
    if (isMissingCoverBackfill && !library.startMissingCoverBackfill) {
      setMessage(t('mediaLibrary.quality.error.bridgeStartCoverBackfill'));
      return;
    }

    setActionBusy(isMissingCoverBackfill ? 'cover-backfill' : 'batch-scan');
    try {
      if (isMissingCoverBackfill) {
        const job = await library.startMissingCoverBackfill({ limit: 500, fields: ['cover'] });
        setCoverBackfillJob(job);
        setMessage(formatMissingCoverBackfillMessage(job, t));
        if (job.status === 'completed' || job.status === 'failed') {
          setActionBusy(null);
        } else {
          void pollMissingCoverBackfillJob(job.id);
        }
        return;
      }

      const job = await library.startMissingMetadataScan({ limit: 100, fields: selectedFields });
      setMessage(t('mediaLibrary.quality.message.batchScanStarted', { id: job.id.slice(0, 8), total: job.totalTracks || 100 }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!isMissingCoverBackfill) {
        setActionBusy(null);
      }
    }
  }, [networkMetadataEnabled, pollMissingCoverBackfillJob, selectedFields, selectedKind, selectedOverview?.actionAvailable, t]);

  return (
    <div className="settings-cache-panel settings-cache-panel--library-quality">
      <button
        aria-expanded={expanded}
        className="settings-library-quality-summary"
        onClick={handleToggleExpanded}
        type="button"
      >
        <span>
          <strong>{t('mediaLibrary.quality.title')}</strong>
          <em>{overviewBusy ? t('mediaLibrary.quality.summary.counting') : total > 0 ? t('mediaLibrary.quality.summary.issues', { count: total }) : t('mediaLibrary.quality.summary.clean')}</em>
        </span>
        <ListFilter size={16} />
      </button>

      {expanded ? (
        <>
          <div className="settings-library-quality-grid">
            {overview.map((item) => (
              <button
                className="settings-library-quality-card"
                data-active={item.kind === selectedKind ? 'true' : undefined}
                data-severity={item.severity}
                key={item.kind}
                onClick={() => handleSelectKind(item.kind)}
                type="button"
              >
                <span>
                  <strong>{item.count}</strong>
                  <em>{item.label}</em>
                </span>
                <small>{item.description}</small>
              </button>
            ))}
          </div>

          <div className="settings-library-quality-toolbar">
            <label>
              <Search size={14} />
              <input
                aria-label={t('mediaLibrary.quality.search.aria')}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleSearchSubmit();
                  }
                }}
                placeholder={t('mediaLibrary.quality.search.placeholder')}
                value={search}
              />
            </label>
            <button className="settings-action-button" disabled={issuesBusy} onClick={handleSearchSubmit} type="button">
              <Search size={15} />
              {t('mediaLibrary.quality.action.filter')}
            </button>
            <button
              className="settings-action-button"
              disabled={actionBusy !== null || !networkMetadataEnabled || !selectedOverview?.actionAvailable}
              onClick={() => void handleStartBatchScan()}
              type="button"
            >
              <RefreshCw className={actionBusy === 'batch-scan' || actionBusy === 'cover-backfill' ? 'spinning-icon' : undefined} size={15} />
              {selectedKind === 'missing_cover' ? t('mediaLibrary.quality.action.backfillMissingCover') : t('mediaLibrary.quality.action.scanCurrent')}
            </button>
          </div>

          {!networkMetadataEnabled ? (
            <p className="settings-inline-note">{t('mediaLibrary.quality.note.networkDisabled')}</p>
          ) : null}
          {message ? <p className="settings-inline-note">{message}</p> : null}
          {coverBackfillJob && selectedKind === 'missing_cover' ? (
            <div className="settings-update-progress settings-library-cover-backfill-progress" role="status" aria-live="polite">
              <div className="settings-update-progress-label">
                <strong>{coverBackfillPhase ?? coverBackfillProgressTitle}</strong>
                <span>{coverBackfillProgressLabel}</span>
              </div>
              <div
                aria-label={t('mediaLibrary.quality.coverBackfill.progressAria')}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={coverBackfillIndeterminate ? undefined : coverBackfillProgressPercent}
                className="settings-update-progress-track"
                data-indeterminate={coverBackfillIndeterminate ? 'true' : undefined}
                role="progressbar"
              >
                <span style={{ width: `${coverBackfillIndeterminate ? 35 : coverBackfillProgressPercent}%` }} />
              </div>
              <div className="settings-update-progress-meta">
                <span title={coverBackfillJob.currentTrackTitle ?? undefined}>
                  {coverBackfillJob.currentTrackTitle ?? coverBackfillPhase ?? (coverBackfillIndeterminate ? t('mediaLibrary.quality.coverBackfill.searching') : t('mediaLibrary.quality.coverBackfill.waitingResult'))}
                </span>
                <span>
                  {t('mediaLibrary.quality.coverBackfill.meta', {
                    candidates: coverBackfillJob.candidateCount,
                    applied: coverBackfillJob.diagnostics.appliedCount,
                    errors: coverBackfillJob.errors.length,
                  })}
                </span>
              </div>
            </div>
          ) : null}

          <div className="settings-library-quality-list" aria-busy={issuesBusy}>
            {issuesBusy ? <p className="settings-inline-note">{t('mediaLibrary.quality.message.loadingIssues')}</p> : null}
            {!issuesBusy && issuePage.items.length === 0 ? (
              <p className="settings-inline-note">{t('mediaLibrary.quality.message.noIssues')}</p>
            ) : null}
            {issuePage.items.map((item) => (
              <article className="settings-library-quality-row" key={item.track.id}>
                <div>
                  <strong>{item.track.title || t('mediaLibrary.quality.untitledTrack')}</strong>
                  <span>{item.track.artist || 'Unknown Artist'} · {item.track.album || 'Unknown Album'}</span>
                  <small title={item.track.path}>{item.track.path}</small>
                  <div className="settings-library-quality-reasons">
                    {item.reasons.map((reason) => (
                      <em key={reason}>{formatReason(reason, t)}</em>
                    ))}
                    {item.candidateCount ? <em>{t('mediaLibrary.quality.candidates', { count: item.candidateCount })}</em> : null}
                  </div>
                </div>
                <div className="settings-library-quality-actions">
                  {selectedOverview?.severity === 'danger' ? <AlertTriangle size={15} /> : null}
                  <button
                    className="settings-action-button"
                    disabled={actionBusy !== null}
                    onClick={() => void handleOpenTrack(item.track.id)}
                    type="button"
                  >
                    <FolderOpen size={15} />
                    {t('mediaLibrary.quality.action.locateFile')}
                  </button>
                  <button
                    className="settings-action-button"
                    disabled={actionBusy !== null || !networkMetadataEnabled}
                    onClick={() => void handleRepairTrack(item.track.id)}
                    type="button"
                  >
                    <Wand2 size={15} />
                    {t('mediaLibrary.quality.action.repairTrack')}
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="settings-library-quality-pager">
            <span>
              {t('mediaLibrary.quality.pager', { page: issuePage.page, total: issuePage.total })}
            </span>
            <button
              className="settings-action-button"
              disabled={issuesBusy || issuePage.page <= 1}
              onClick={() => void loadIssues(selectedKind, issuePage.page - 1)}
              type="button"
            >
              {t('mediaLibrary.quality.action.previousPage')}
            </button>
            <button
              className="settings-action-button"
              disabled={issuesBusy || !issuePage.hasMore}
              onClick={() => void loadIssues(selectedKind, issuePage.page + 1)}
              type="button"
            >
              {t('mediaLibrary.quality.action.nextPage')}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
};
