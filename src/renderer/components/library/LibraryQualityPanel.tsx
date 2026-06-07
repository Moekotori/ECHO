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
import { getLibraryBridge } from '../../utils/echoBridge';

type LibraryQualityPanelProps = {
  autoRefresh?: boolean;
  networkMetadataEnabled?: boolean;
};

const issueKindFields: Partial<Record<LibraryQualityIssueKind, MissingMetadataField[]>> = {
  missing_cover: ['cover'],
  unknown_artist_album: ['artist', 'album', 'albumArtist'],
};

const reasonLabels: Record<LibraryQualityIssueReason, string> = {
  missing_cover: '缺封面',
  missing_title: '缺标题',
  missing_artist: '缺艺人',
  missing_album: '缺专辑',
  missing_album_artist: '缺专辑艺人',
  missing_track_no: '缺音轨号',
  missing_disc_no: '缺碟号',
  missing_year: '缺年份',
  missing_genre: '缺流派',
  unknown_artist: '未知艺人',
  filename_fallback: '文件名回退',
  unknown_field: '未知字段',
  metadata_fallback: '元数据回退',
  unknown_album: '未知专辑',
  embedded_metadata_error: '内嵌标签读取失败',
  embedded_cover_error: '内嵌封面读取失败',
  network_metadata_candidate: '有网络元数据候选',
  network_cover_candidate: '有网络封面候选',
};

const emptyPage = (kind: LibraryQualityIssueKind): LibraryQualityIssuePage => ({
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  hasMore: false,
  kind,
});

const formatReason = (reason: LibraryQualityIssueReason): string => reasonLabels[reason] ?? reason;

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

const coverBackfillPhaseLabel = (job: NetworkMetadataScanJobStatus, indeterminate: boolean): string => {
  if (job.status === 'completed') {
    return '封面补全完成';
  }
  if (job.status === 'failed') {
    return '封面补全失败';
  }
  if (isCoverBackfillApplying(job)) {
    return '正在下载并应用网络封面';
  }
  if (job.candidateCount > 0) {
    return '正在搜索网络封面候选，扫描完成后开始应用';
  }
  return indeterminate ? '正在检测缺失/默认封面' : '正在搜索网络封面候选';
};

const formatMissingCoverBackfillMessage = (job: NetworkMetadataScanJobStatus): string => {
  const total = job.totalTracks || job.scannedCount || job.diagnostics.targetCount;
  const processed = Math.min(total || job.processedTracks, job.processedTracks);
  const applied = job.diagnostics.appliedCount;

  if (job.status === 'queued') {
    return '封面补全已排队，等待后台网络任务开始。';
  }
  if (job.status === 'running') {
    if (!total) {
      return '正在检测缺失/默认封面的歌曲并搜索网络封面...';
    }
    return `正在补全网络封面：${processed}/${total}，已应用 ${applied} 张`;
  }
  if (job.status === 'failed') {
    return `封面补全失败：${job.errors[0] ?? '未知错误'}`;
  }

  return `封面补全完成：检测 ${job.scannedCount} 首，找到 ${job.candidateCount} 个候选条目，已应用 ${applied} 张`;
};

export const LibraryQualityPanel = ({ autoRefresh = true, networkMetadataEnabled = false }: LibraryQualityPanelProps): JSX.Element => {
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
      ? '封面补全完成'
      : coverBackfillJob?.status === 'failed'
        ? '封面补全失败'
        : '正在补全网络封面';
  const coverBackfillProgressLabel = coverBackfillIndeterminate
    ? '正在检测缺失/默认封面'
    : `${coverBackfillProcessed} / ${coverBackfillTotal || coverBackfillProcessed}`;
  const coverBackfillPhase = coverBackfillJob ? coverBackfillPhaseLabel(coverBackfillJob, coverBackfillIndeterminate) : null;

  const refreshOverview = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.getLibraryQualityOverview) {
      setOverview([]);
      setMessage('桌面桥接暂不可用，无法读取资料质量概览。');
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
  }, []);

  const loadIssues = useCallback(
    async (kind: LibraryQualityIssueKind, page = 1, nextSearch = search): Promise<void> => {
      const library = getLibraryBridge();
      if (!library?.getLibraryQualityIssues) {
        setIssuePage(emptyPage(kind));
        setMessage('桌面桥接暂不可用，无法读取问题歌曲列表。');
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
    [search],
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
      setMessage('桌面桥接暂不可用，无法定位文件。');
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
  }, []);

  const handleRepairTrack = useCallback(
    async (trackId: string): Promise<void> => {
      const library = getLibraryBridge();
      if (!networkMetadataEnabled) {
        setMessage('请先开启网络元数据补全，再补全单曲。');
        return;
      }
      if (!library?.repairMissingMetadata) {
        setMessage('桌面桥接暂不可用，无法补全单曲资料。');
        return;
      }

      setActionBusy(`repair:${trackId}`);
      try {
        const result = await library.repairMissingMetadata(trackId);
        const candidateCount = result.metadata.length + result.covers.length;
        setMessage(`已完成单曲补全检查，找到 ${candidateCount} 个候选，应用 ${result.diagnostics.appliedCount} 项。`);
        await refreshOverview();
        await loadIssues(selectedKind, issuePage.page);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setActionBusy(null);
      }
    },
    [issuePage.page, loadIssues, networkMetadataEnabled, refreshOverview, selectedKind],
  );

  const pollMissingCoverBackfillJob = useCallback(
    async (jobId: string): Promise<void> => {
      if (coverBackfillPollingJobIdRef.current === jobId) {
        return;
      }

      const library = getLibraryBridge();
      if (!library?.getMissingCoverBackfillStatus) {
        setActionBusy(null);
        setMessage('桌面桥接暂不可用，无法读取封面补全进度。');
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
          setMessage(formatMissingCoverBackfillMessage(status));
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
    [issuePage.page, loadIssues, refreshOverview, selectedKind],
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
        setMessage(formatMissingCoverBackfillMessage(status));
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
  }, [networkMetadataEnabled, pollMissingCoverBackfillJob]);

  const handleStartBatchScan = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!networkMetadataEnabled) {
      setMessage('请先开启网络元数据补全，再扫描当前分类。');
      return;
    }
    if (!selectedOverview?.actionAvailable) {
      setMessage('这个分类建议先重扫本地文件或检查文件健康，暂不启用网络补全。');
      return;
    }
    if (!library?.startMissingMetadataScan) {
      setMessage('桌面桥接暂不可用，无法启动网络资料扫描。');
      return;
    }

    const isMissingCoverBackfill = selectedKind === 'missing_cover';
    if (isMissingCoverBackfill && !library.startMissingCoverBackfill) {
      setMessage('桌面桥接暂不可用，无法启动网络封面补全。');
      return;
    }

    setActionBusy(isMissingCoverBackfill ? 'cover-backfill' : 'batch-scan');
    try {
      if (isMissingCoverBackfill) {
        const job = await library.startMissingCoverBackfill({ limit: 500, fields: ['cover'] });
        setCoverBackfillJob(job);
        setMessage(formatMissingCoverBackfillMessage(job));
        if (job.status === 'completed' || job.status === 'failed') {
          setActionBusy(null);
        } else {
          void pollMissingCoverBackfillJob(job.id);
        }
        return;
      }

      const job = await library.startMissingMetadataScan({ limit: 100, fields: selectedFields });
      setMessage(`已开始小批量资料扫描：${job.id.slice(0, 8)}，最多处理 ${job.totalTracks || 100} 首。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!isMissingCoverBackfill) {
        setActionBusy(null);
      }
    }
  }, [networkMetadataEnabled, pollMissingCoverBackfillJob, selectedFields, selectedKind, selectedOverview?.actionAvailable]);

  return (
    <div className="settings-cache-panel settings-cache-panel--library-quality">
      <button
        aria-expanded={expanded}
        className="settings-library-quality-summary"
        onClick={handleToggleExpanded}
        type="button"
      >
        <span>
          <strong>资料质量整理</strong>
          <em>{overviewBusy ? '正在统计...' : total > 0 ? `${total} 个本地资料问题` : '本地曲库资料看起来很干净'}</em>
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
                aria-label="搜索资料质量问题歌曲"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleSearchSubmit();
                  }
                }}
                placeholder="搜索歌曲、艺人、专辑"
                value={search}
              />
            </label>
            <button className="settings-action-button" disabled={issuesBusy} onClick={handleSearchSubmit} type="button">
              <Search size={15} />
              筛选
            </button>
            <button
              className="settings-action-button"
              disabled={actionBusy !== null || !networkMetadataEnabled || !selectedOverview?.actionAvailable}
              onClick={() => void handleStartBatchScan()}
              type="button"
            >
              <RefreshCw className={actionBusy === 'batch-scan' || actionBusy === 'cover-backfill' ? 'spinning-icon' : undefined} size={15} />
              {selectedKind === 'missing_cover' ? '补全缺失封面' : '扫描当前分类'}
            </button>
          </div>

          {!networkMetadataEnabled ? (
            <p className="settings-inline-note">网络补全未开启；当前仍可查看和定位问题歌曲，不会自动修改标签。</p>
          ) : null}
          {message ? <p className="settings-inline-note">{message}</p> : null}
          {coverBackfillJob && selectedKind === 'missing_cover' ? (
            <div className="settings-update-progress settings-library-cover-backfill-progress" role="status" aria-live="polite">
              <div className="settings-update-progress-label">
                <strong>{coverBackfillPhase ?? coverBackfillProgressTitle}</strong>
                <span>{coverBackfillProgressLabel}</span>
              </div>
              <div
                aria-label="网络封面补全进度"
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
                  {coverBackfillJob.currentTrackTitle ?? coverBackfillPhase ?? (coverBackfillIndeterminate ? '正在搜索网络封面候选' : '等待后台结果')}
                </span>
                <span>
                  候选条目 {coverBackfillJob.candidateCount} / 已应用 {coverBackfillJob.diagnostics.appliedCount} / 错误 {coverBackfillJob.errors.length}
                </span>
              </div>
            </div>
          ) : null}

          <div className="settings-library-quality-list" aria-busy={issuesBusy}>
            {issuesBusy ? <p className="settings-inline-note">正在读取问题歌曲...</p> : null}
            {!issuesBusy && issuePage.items.length === 0 ? (
              <p className="settings-inline-note">这个分类暂时没有问题歌曲。</p>
            ) : null}
            {issuePage.items.map((item) => (
              <article className="settings-library-quality-row" key={item.track.id}>
                <div>
                  <strong>{item.track.title || '未命名歌曲'}</strong>
                  <span>{item.track.artist || 'Unknown Artist'} · {item.track.album || 'Unknown Album'}</span>
                  <small title={item.track.path}>{item.track.path}</small>
                  <div className="settings-library-quality-reasons">
                    {item.reasons.map((reason) => (
                      <em key={reason}>{formatReason(reason)}</em>
                    ))}
                    {item.candidateCount ? <em>{item.candidateCount} 个候选</em> : null}
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
                    定位文件
                  </button>
                  <button
                    className="settings-action-button"
                    disabled={actionBusy !== null || !networkMetadataEnabled}
                    onClick={() => void handleRepairTrack(item.track.id)}
                    type="button"
                  >
                    <Wand2 size={15} />
                    补全此曲
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="settings-library-quality-pager">
            <span>
              第 {issuePage.page} 页 · 共 {issuePage.total} 首
            </span>
            <button
              className="settings-action-button"
              disabled={issuesBusy || issuePage.page <= 1}
              onClick={() => void loadIssues(selectedKind, issuePage.page - 1)}
              type="button"
            >
              上一页
            </button>
            <button
              className="settings-action-button"
              disabled={issuesBusy || !issuePage.hasMore}
              onClick={() => void loadIssues(selectedKind, issuePage.page + 1)}
              type="button"
            >
              下一页
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
};
