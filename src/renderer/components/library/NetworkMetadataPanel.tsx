import { useCallback, useState } from 'react';
import { RefreshCw, Search, Wand2 } from 'lucide-react';
import type {
  LibraryTrack,
  MissingMetadataField,
  MissingMetadataReason,
  MissingMetadataScanItem,
  NetworkCandidateList,
  NetworkMetadataScanJobStatus,
} from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { getAudioBridge, getLibraryBridge, getPlaybackBridge } from '../../utils/echoBridge';
import { NetworkCandidateCard } from './NetworkCandidateCard';

const fieldLabels: Record<string, string> = {
  album: '专辑',
  albumArtist: '专辑艺人',
  artist: '歌手',
  coverId: '封面',
  discNo: '碟号',
  genre: '流派',
  title: '标题',
  trackNo: '音轨',
  year: '年份',
};

const missingFilterOptions: Array<{ field: MissingMetadataField; label: string }> = [
  { field: 'cover', label: '封面' },
  { field: 'title', label: '标题' },
  { field: 'artist', label: '艺人' },
  { field: 'album', label: '专辑' },
  { field: 'albumArtist', label: '专辑艺人' },
  { field: 'trackNo', label: '音轨号' },
  { field: 'discNo', label: '碟号' },
  { field: 'year', label: '年份' },
  { field: 'genre', label: '流派' },
];

const missingReasonLabels: Record<MissingMetadataReason, string> = {
  missing_cover: '缺封面',
  missing_title: '缺标题',
  missing_artist: '缺歌手',
  missing_album: '缺专辑',
  missing_album_artist: '缺专辑艺人',
  missing_track_no: '缺音轨号',
  missing_disc_no: '缺碟号',
  missing_year: '缺年份',
  missing_genre: '缺流派',
  unknown_artist: '未知歌手',
  filename_fallback: '文件名猜测',
  unknown_field: '未知字段',
};

const missingReasonText = (reasons: MissingMetadataReason[]): string =>
  reasons.map((reason) => missingReasonLabels[reason] ?? reason).join('、');

const selectedMissingFieldLabel = (fields: MissingMetadataField[]): string => {
  if (!fields.length) {
    return '全部缺失项';
  }

  return fields
    .map((field) => missingFilterOptions.find((option) => option.field === field)?.label ?? field)
    .join('、');
};

const resultReasonText = (reason: string | undefined): string => {
  switch (reason) {
    case 'score_below_auto_apply_threshold':
      return '候选可信度还不够自动补全，请用“应用所选”确认。';
    case 'embedded_metadata_not_ready':
      return '本地内嵌元数据还在读取中，暂时不能应用。';
    case 'embedded_metadata_present':
      return '本地内嵌元数据已存在，未覆盖。';
    case 'no_missing_fields':
      return '没有可补全的缺失字段，本地/内嵌字段已保留。';
    case 'candidate_rejected':
      return '这个候选之前已被拒绝。';
    case 'candidate_missing':
      return '候选已不存在，请重新扫描。';
    case 'embedded_cover_not_ready':
      return '本地封面还在读取中，暂时不能应用网络封面。';
    case 'cover_source_embedded_protected':
      return '已有内嵌封面，网络封面不会覆盖。';
    case 'cover_source_folder_protected':
      return '已有文件夹封面，网络封面不会覆盖。';
    case 'cover_download_failed':
      return '候选封面下载失败，标签信息仍可单独应用。';
    default:
      return reason ? `未应用：${reason}` : '没有字段被修改。';
  }
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const scanPercent = (status: NetworkMetadataScanJobStatus): number => {
  if (status.status === 'completed') {
    return 100;
  }

  if (status.status === 'failed') {
    return status.totalTracks > 0 ? Math.round((status.processedTracks / status.totalTracks) * 100) : 100;
  }

  if (status.totalTracks <= 0) {
    return status.status === 'queued' ? 5 : 10;
  }

  return Math.max(1, Math.min(99, Math.round((status.processedTracks / status.totalTracks) * 100)));
};

const scanLabel = (status: NetworkMetadataScanJobStatus, t: (key: TranslationKey) => string): string => {
  if (status.status === 'queued') {
    return t('settings.library.networkPanel.scanPreparing');
  }

  if (status.status === 'completed') {
    return t('settings.library.networkPanel.scanComplete');
  }

  if (status.status === 'failed') {
    return '扫描失败';
  }

  const currentTrack = status.currentTrackTitle ? `: ${status.currentTrackTitle}` : '';
  return `${t('settings.library.networkPanel.scanRunning')} ${status.processedTracks}/${status.totalTracks}${currentTrack}`;
};

const diagnosticsText = (diagnostics: NetworkMetadataScanJobStatus['diagnostics']): string =>
  `目标 ${diagnostics.targetCount} 首；候选缺失 ${diagnostics.noCandidateCount} 首；来源错误 ${diagnostics.providerErrors} 个；已应用 ${diagnostics.appliedCount} 项`;

const fieldSourceLabels: Record<string, string> = {
  manual: '手动编辑',
  embedded: '内嵌标签',
  sidecar: '旁车文件',
  folder_structure: '文件夹结构',
  network: '网络补全',
  filename_fallback: '文件名猜测',
  artist_fallback: '歌手兜底',
  unknown: '未知',
};

const readinessLabels: Record<string, string> = {
  pending: '等待读取',
  reading: '正在读取',
  present: '已读取',
  missing: '未找到',
  skipped: '已跳过',
  error: '读取失败',
  none: '无',
  unknown: '未知',
};

const sourceText = (source: string | null | undefined): string => {
  const key = source || 'unknown';
  return fieldSourceLabels[key] ?? key;
};

const readinessText = (status: string | null | undefined): string => {
  const key = status || 'pending';
  return readinessLabels[key] ?? key;
};

type NetworkMetadataPanelProps = {
  networkMetadataEnabled?: boolean;
};

const networkDisabledMessage = '请先打开上方“网络元数据补全”，再扫描或修复缺失信息。';

export const NetworkMetadataPanel = ({ networkMetadataEnabled = true }: NetworkMetadataPanelProps): JSX.Element => {
  const { t } = useI18n();
  const [trackId, setTrackId] = useState('');
  const [track, setTrack] = useState<LibraryTrack | null>(null);
  const [candidates, setCandidates] = useState<NetworkCandidateList>({ metadata: [], covers: [] });
  const [scanItems, setScanItems] = useState<MissingMetadataScanItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [selectedMissingFields, setSelectedMissingFields] = useState<MissingMetadataField[]>([]);
  const [scanProgress, setScanProgress] = useState<{ label: string; percent: number } | null>(null);
  const [candidateFeedback, setCandidateFeedback] = useState<Record<string, { tone: 'success' | 'info' | 'warning'; text: string }>>({});
  const networkActionDisabled = busy || !networkMetadataEnabled;

  const ensureNetworkMetadataEnabled = useCallback((): boolean => {
    if (networkMetadataEnabled) {
      return true;
    }

    setScanProgress(null);
    setMessage(networkDisabledMessage);
    return false;
  }, [networkMetadataEnabled]);

  const toggleMissingField = useCallback((field: MissingMetadataField): void => {
    setSelectedMissingFields((current) =>
      current.includes(field) ? current.filter((item) => item !== field) : [...current, field],
    );
  }, []);

  const findTrackByExactId = useCallback(async (targetTrackId: string): Promise<LibraryTrack | null> => {
    const library = getLibraryBridge();

    if (!library) {
      setMessage('桌面桥接不可用，请在 ECHO Next 桌面端中使用此功能。');
      return null;
    }

    let page = 1;
    let total = Number.POSITIVE_INFINITY;

    while ((page - 1) * 500 < total) {
      const tracks = await library.getTracks({ page, pageSize: 500 });
      const found = tracks.items.find((item) => item.id === targetTrackId) ?? null;

      if (found) {
        return found;
      }

      total = tracks.total;
      page += 1;
    }

    return null;
  }, []);

  const findTrackByInput = useCallback(
    async (input: string): Promise<LibraryTrack | null> => {
      const library = getLibraryBridge();

      if (!library) {
        setMessage('桌面桥接不可用，请在 ECHO Next 桌面端中使用此功能。');
        return null;
      }

      const exactMatch = await findTrackByExactId(input);
      if (exactMatch) {
        return exactMatch;
      }

      const query = input.trim();
      if (!query) {
        return null;
      }

      const tracks = await library.getTracks({ search: query, page: 1, pageSize: 20 });
      return tracks.items[0] ?? null;
    },
    [findTrackByExactId],
  );

  const resolveTargetTrackId = useCallback(async (): Promise<string | null> => {
    const typedTrackId = trackId.trim();
    if (typedTrackId) {
      const found = await findTrackByInput(typedTrackId);
      setTrack(found);
      return found?.id ?? null;
    }

    const playback = getPlaybackBridge();
    const audio = getAudioBridge();

    if (!playback && !audio) {
      setMessage('桌面桥接不可用，请在 ECHO Next 桌面端中使用此功能。');
      return null;
    }

    const [playbackStatus, audioStatus] = await Promise.all([
      playback?.getStatus().catch(() => null) ?? Promise.resolve(null),
      audio?.getStatus().catch(() => null) ?? Promise.resolve(null),
    ]);

    return playbackStatus?.currentTrackId ?? audioStatus?.currentTrackId ?? null;
  }, [findTrackByInput, trackId]);

  const loadTrack = useCallback(async (): Promise<LibraryTrack | null> => {
    const targetTrackId = await resolveTargetTrackId();
    if (!targetTrackId) {
      setTrack(null);
      return null;
    }

    const found = await findTrackByExactId(targetTrackId);
    setTrack(found);
    return found;
  }, [findTrackByExactId, resolveTargetTrackId]);

  const refreshCandidates = useCallback(async (): Promise<void> => {
    try {
      setScanProgress(null);
      const found = await loadTrack();
      if (!found) {
        setMessage(t('settings.library.networkPanel.trackNotFound'));
        return;
      }

      const library = getLibraryBridge();

      if (!library) {
        setMessage('桌面桥接不可用，请在 ECHO Next 桌面端中使用此功能。');
        return;
      }

      const nextCandidates = await library.showNetworkCandidates(found.id);
      setCandidates(nextCandidates);
      setCandidateFeedback({});
      setMessage(
        nextCandidates.metadata.length + nextCandidates.covers.length
          ? null
          : '还没有候选。请先扫描缺失信息，或补全当前歌曲。',
      );
    } catch (refreshError) {
      setMessage(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, [loadTrack, t]);

  const repair = useCallback(async (): Promise<void> => {
    if (!ensureNetworkMetadataEnabled()) {
      return;
    }

    setBusy(true);
    setScanProgress(null);

    try {
      const found = await loadTrack();
      if (!found) {
        setMessage(t('settings.library.networkPanel.trackNotFound'));
        return;
      }

      const library = getLibraryBridge();

      if (!library) {
        setMessage('桌面桥接不可用，请在 ECHO Next 桌面端中使用此功能。');
        return;
      }

      const result = await library.repairMissingMetadata(found.id);
      const candidateCount = result.metadata.length + result.covers.length;
      setCandidates({ metadata: result.metadata, covers: result.covers });
      setCandidateFeedback({});
      const appliedSummary = `${t('settings.library.networkPanel.appliedCount')} ${result.applied.length}；${diagnosticsText(result.diagnostics)}`;
      setMessage(
        result.errors.length
          ? result.errors.join(', ')
          : result.applied.length
            ? appliedSummary
            : candidateCount
              ? '已找到候选，但可信度不足以自动写入。请检查后点“应用所选候选”。'
              : `已启用的来源没有找到候选。${diagnosticsText(result.diagnostics)}`,
      );
    } catch (repairError) {
      setMessage(repairError instanceof Error ? repairError.message : String(repairError));
    } finally {
      setBusy(false);
    }
  }, [ensureNetworkMetadataEnabled, loadTrack, t]);

  const scanMissing = useCallback(async (): Promise<void> => {
    if (!ensureNetworkMetadataEnabled()) {
      return;
    }

    const scanFields = [...selectedMissingFields];
    const scanScope = selectedMissingFieldLabel(scanFields);
    setBusy(true);
    setScanProgress({ label: t('settings.library.networkPanel.scanPreparing'), percent: 5 });
    setMessage(`正在后台扫描${scanScope}，只处理当前筛选范围内的歌曲。切去听歌也会继续跑。`);
    setTrack(null);
    setCandidates({ metadata: [], covers: [] });
    setScanItems([]);
    setCandidateFeedback({});

    try {
      const library = getLibraryBridge();

      if (!library) {
        setMessage('桌面桥接不可用，请在 ECHO Next 桌面端中使用此功能。');
        setScanProgress(null);
        return;
      }

      let status = await library.startMissingMetadataScan({ limit: 500, fields: scanFields });
      setScanItems(status.items);
      setScanProgress({ label: scanLabel(status, t), percent: scanPercent(status) });

      while (status.status === 'queued' || status.status === 'running') {
        await delay(1000);
        status = await library.getMissingMetadataScanStatus(status.id);
        setScanItems(status.items);
        setScanProgress({ label: scanLabel(status, t), percent: scanPercent(status) });
        setMessage(
          status.totalTracks > 0
            ? `${t('settings.library.networkPanel.scanDone')} ${status.processedTracks}/${status.totalTracks}；${t('settings.library.networkPanel.candidates')} ${status.candidateCount}；${diagnosticsText(status.diagnostics)}`
            : '没有需要网络扫描的缺失文字元数据曲目。',
        );
      }

      setScanItems(status.items);
      setScanProgress({ label: scanLabel(status, t), percent: scanPercent(status) });
      setMessage(
        status.errors.length
          ? `${t('settings.library.networkPanel.scanDone')} ${status.scannedCount}；${t('settings.library.networkPanel.candidates')} ${status.candidateCount}；${t('settings.library.networkPanel.providerErrors')} ${status.errors.length}；${diagnosticsText(status.diagnostics)}`
          : status.candidateCount
            ? `${t('settings.library.networkPanel.scanDone')} ${status.scannedCount}；${t('settings.library.networkPanel.candidates')} ${status.candidateCount}；${diagnosticsText(status.diagnostics)}`
            : `${t('settings.library.networkPanel.scanDone')} ${status.scannedCount}；已启用的来源没有找到候选。${diagnosticsText(status.diagnostics)}`,
      );
    } catch (scanError) {
      setMessage(scanError instanceof Error ? scanError.message : String(scanError));
      setScanProgress(null);
    } finally {
      setBusy(false);
    }
  }, [ensureNetworkMetadataEnabled, selectedMissingFields, t]);

  const mutateCandidate = useCallback(
    async (candidateId: string, action: 'missing' | 'selected' | 'reject'): Promise<void> => {
      try {
        const library = getLibraryBridge();

        if (!library) {
          setMessage('桌面桥接不可用，请在 ECHO Next 桌面端中使用此功能。');
          return;
        }

        const scanItem = scanItems.find((item) =>
          item.candidates.metadata.some((candidate) => candidate.id === candidateId) ||
          item.candidates.covers.some((candidate) => candidate.id === candidateId),
        );
        const result =
          action === 'missing'
            ? await library.applyNetworkMissingOnly(candidateId)
            : action === 'selected'
              ? await library.applyNetworkSelected(candidateId)
              : await library.rejectNetworkCandidate(candidateId);
        const appliedKeys = Object.keys(result.appliedFields);
        const feedback =
          action === 'reject'
            ? { tone: 'info' as const, text: '已拒绝这个候选。' }
            : appliedKeys.length
              ? {
                  tone: 'success' as const,
                  text: `已应用：${appliedKeys.map((key) => fieldLabels[key] ?? key).join('、')}`,
                }
              : { tone: 'warning' as const, text: resultReasonText(result.reason) };
        setCandidateFeedback((current) => ({ ...current, [candidateId]: feedback }));
        setMessage(feedback.text);
        if (appliedKeys.length) {
          window.dispatchEvent(new Event('library:changed'));
        }

        if (scanItem) {
          const nextCandidates = await library.showNetworkCandidates(scanItem.track.id);
          const nextTrack = await findTrackByExactId(scanItem.track.id);
          setScanItems((items) =>
            items.map((item) =>
              item.track.id === scanItem.track.id
                ? { ...item, track: nextTrack ?? item.track, candidates: nextCandidates }
                : item,
            ),
          );
          return;
        }

        const refreshedTrack = track ? await findTrackByExactId(track.id) : null;
        if (refreshedTrack) {
          setTrack(refreshedTrack);
          setCandidates(await library.showNetworkCandidates(refreshedTrack.id));
        } else {
          await refreshCandidates();
        }
      } catch (mutationError) {
        setMessage(mutationError instanceof Error ? mutationError.message : String(mutationError));
      }
    },
    [findTrackByExactId, refreshCandidates, scanItems, track],
  );

  const repairScanItem = useCallback(
    async (item: MissingMetadataScanItem): Promise<void> => {
      if (!ensureNetworkMetadataEnabled()) {
        return;
      }

      setBusy(true);

      try {
        const library = getLibraryBridge();

        if (!library) {
          setMessage('桌面桥接不可用，请在 ECHO Next 桌面端中使用此功能。');
          return;
        }

        const result = await library.repairMissingMetadata(item.track.id);
        const nextTrack = await findTrackByExactId(item.track.id);
        setScanItems((items) =>
          items.map((scanItem) =>
            scanItem.track.id === item.track.id
              ? { ...scanItem, track: nextTrack ?? scanItem.track, candidates: { metadata: result.metadata, covers: result.covers } }
              : scanItem,
          ),
        );
        setMessage(
          result.errors.length
            ? result.errors.join(', ')
            : `${t('settings.library.networkPanel.appliedCount')} ${result.applied.length}；${diagnosticsText(result.diagnostics)}`,
        );
      } catch (repairError) {
        setMessage(repairError instanceof Error ? repairError.message : String(repairError));
      } finally {
        setBusy(false);
      }
    },
    [ensureNetworkMetadataEnabled, findTrackByExactId, t],
  );

  const applyAllScanCandidates = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();

    if (!library) {
      setMessage('桌面桥接不可用，请在 ECHO Next 桌面端中使用此功能。');
      return;
    }

    const candidateIds = scanItems
      .map((item) => item.candidates.metadata[0]?.id)
      .filter((candidateId): candidateId is string => Boolean(candidateId));

    if (!candidateIds.length) {
      setMessage('没有可应用的网络候选。先扫描缺失元数据，或调整网络来源后再试。');
      return;
    }

    setBusy(true);
    setBulkApplying(true);
    setCandidateFeedback({});
    setScanProgress({ label: '正在批量补全', percent: 5 });

    let appliedCount = 0;
    let skippedCount = 0;
    const feedback: Record<string, { tone: 'success' | 'info' | 'warning'; text: string }> = {};

    try {
      for (let index = 0; index < candidateIds.length; index += 1) {
        const candidateId = candidateIds[index];
        const result = await library.applyNetworkSelected(candidateId, { fields: selectedMissingFields });
        const appliedKeys = Object.keys(result.appliedFields);

        if (appliedKeys.length) {
          appliedCount += 1;
          feedback[candidateId] = {
            tone: 'success',
            text: `已应用：${appliedKeys.map((key) => fieldLabels[key] ?? key).join('、')}`,
          };
        } else {
          skippedCount += 1;
          feedback[candidateId] = { tone: 'warning', text: resultReasonText(result.reason) };
        }

        setScanProgress({
          label: '正在批量补全',
          percent: Math.max(5, Math.round(((index + 1) / candidateIds.length) * 100)),
        });
      }

      setCandidateFeedback(feedback);
      setMessage(`批量补全完成：已应用 ${appliedCount} 个候选，跳过 ${skippedCount} 个候选。`);
      if (appliedCount > 0) {
        window.dispatchEvent(new Event('library:changed'));
      }

      const refreshedItems = await Promise.all(
        scanItems.map(async (item) => {
          const [nextTrack, nextCandidates] = await Promise.all([
            findTrackByExactId(item.track.id),
            library.showNetworkCandidates(item.track.id),
          ]);
          return { ...item, track: nextTrack ?? item.track, candidates: nextCandidates };
        }),
      );
      setScanItems(refreshedItems);
      setScanProgress({ label: '批量补全完成', percent: 100 });
    } catch (applyError) {
      setMessage(applyError instanceof Error ? applyError.message : String(applyError));
      setScanProgress(null);
    } finally {
      setBulkApplying(false);
      setBusy(false);
    }
  }, [findTrackByExactId, scanItems, selectedMissingFields]);

  return (
    <section className="audio-dev-panel network-metadata-panel" aria-label={t('settings.library.networkPanel.title')}>
      <div className="audio-dev-header">
        <div>
          <span className="panel-kicker">{t('settings.library.networkPanel.kicker')}</span>
          <h2>{t('settings.library.networkPanel.title')}</h2>
        </div>
        <button
          className="tool-button"
          type="button"
          aria-label={t('settings.library.networkPanel.showCandidates')}
          title={t('settings.library.networkPanel.showCandidates')}
          onClick={() => void refreshCandidates()}
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <label className="settings-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={trackId}
          onChange={(event) => setTrackId(event.target.value)}
          placeholder={`${t('settings.library.networkPanel.trackId')} / 标题 / 歌手`}
        />
      </label>

      <div className="network-missing-filter">
        <span>筛选缺失</span>
        <div className="settings-chip-row settings-chip-row--left">
          <button
            className={`network-missing-filter-chip ${selectedMissingFields.length === 0 ? 'active' : ''}`}
            disabled={networkActionDisabled}
            type="button"
            onClick={() => setSelectedMissingFields([])}
          >
            全部
          </button>
          {missingFilterOptions.map((option) => (
            <button
              className={`network-missing-filter-chip ${selectedMissingFields.includes(option.field) ? 'active' : ''}`}
              disabled={networkActionDisabled}
              key={option.field}
              type="button"
              onClick={() => toggleMissingField(option.field)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-chip-row">
        <button className="settings-action-button" type="button" disabled={networkActionDisabled} onClick={() => void scanMissing()}>
          <Wand2 size={15} />
          {busy ? '扫描中...' : t('settings.library.networkPanel.scanMissing')}
        </button>
        <button
          className="settings-action-button"
          type="button"
          disabled={busy || !scanItems.some((item) => item.candidates.metadata.length > 0)}
          onClick={() => void applyAllScanCandidates()}
        >
          <Wand2 size={15} />
          {bulkApplying ? '补全中...' : '应用全部候选'}
        </button>
        <button className="settings-action-button" type="button" disabled={networkActionDisabled} onClick={() => void repair()}>
          {t('settings.library.networkPanel.repairMissing')}
        </button>
        <button className="settings-action-button" type="button" disabled={busy} onClick={() => void refreshCandidates()}>
          {t('settings.library.networkPanel.showCandidates')}
        </button>
      </div>

      {!networkMetadataEnabled ? <p className="settings-inline-note network-panel-message">{networkDisabledMessage}</p> : null}

      {scanProgress ? (
        <div className="network-scan-progress" role="status" aria-live="polite">
          <div className="network-scan-progress-label">
            <span>{scanProgress.label}</span>
            <strong>{Math.round(scanProgress.percent)}%</strong>
          </div>
          <div
            className="network-scan-progress-track"
            aria-label={t('settings.library.networkPanel.scanProgress')}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(scanProgress.percent)}
            role="progressbar"
          >
            <span style={{ width: `${scanProgress.percent}%` }} />
          </div>
        </div>
      ) : null}

      {message ? <p className="settings-inline-note network-panel-message">{message}</p> : null}

      {track ? (
        <div className="settings-status-grid">
          <span>
            <em>{t('settings.library.networkPanel.titleField')}</em>
            <strong>{track.title}</strong>
          </span>
          <span>
            <em>{t('settings.library.networkPanel.artistField')}</em>
            <strong>{track.artist}</strong>
          </span>
          <span>
            <em>{t('settings.library.networkPanel.embeddedMetadata')}</em>
            <strong>{readinessText(track.embeddedMetadataStatus)}</strong>
          </span>
          <span>
            <em>{t('settings.library.networkPanel.embeddedCover')}</em>
            <strong>{readinessText(track.embeddedCoverStatus)}</strong>
          </span>
        </div>
      ) : null}

      {candidates.metadata.map((candidate) =>
        track ? (
          <NetworkCandidateCard
            candidate={candidate}
            feedback={candidateFeedback[candidate.id]}
            key={candidate.id}
            track={track}
            onApplyMissingOnly={(id) => void mutateCandidate(id, 'missing')}
            onApplySelected={(id) => void mutateCandidate(id, 'selected')}
            onReject={(id) => void mutateCandidate(id, 'reject')}
          />
        ) : null,
      )}

      {scanItems.length ? (
        <div className="network-missing-list">
          {scanItems.map((item) => (
            <article className="network-missing-item" key={item.track.id}>
              <header>
                <div>
                  <strong>{item.track.title || t('settings.library.networkPanel.untitled')}</strong>
                  <span>{item.track.artist || t('settings.library.networkPanel.unknownArtist')}</span>
                </div>
                <div className="network-missing-actions">
                  <em>{missingReasonText(item.reasons)}</em>
                  <button className="settings-action-button" type="button" disabled={networkActionDisabled} onClick={() => void repairScanItem(item)}>
                    {t('settings.library.networkPanel.repairThisTrack')}
                  </button>
                </div>
              </header>
              <div className="settings-status-grid">
                <span>
                  <em>{t('settings.library.networkPanel.cover')}</em>
                  <strong>{item.track.coverId ? t('settings.library.networkPanel.localCover') : t('settings.library.networkPanel.missingCover')}</strong>
                </span>
                <span>
                  <em>{t('settings.library.networkPanel.artistSource')}</em>
                  <strong>{sourceText(item.track.fieldSources.artist)}</strong>
                </span>
                <span>
                  <em>{t('settings.library.networkPanel.embeddedMetadata')}</em>
                  <strong>{readinessText(item.track.embeddedMetadataStatus)}</strong>
                </span>
                <span>
                  <em>{t('settings.library.networkPanel.candidates')}</em>
                  <strong>{item.candidates.metadata.length + item.candidates.covers.length}</strong>
                </span>
              </div>
              {item.candidates.metadata.length ? (
                item.candidates.metadata.map((candidate) => (
                  <NetworkCandidateCard
                    candidate={candidate}
                    feedback={candidateFeedback[candidate.id]}
                    key={candidate.id}
                    track={item.track}
                    onApplyMissingOnly={(id) => void mutateCandidate(id, 'missing')}
                    onApplySelected={(id) => void mutateCandidate(id, 'selected')}
                    onReject={(id) => void mutateCandidate(id, 'reject')}
                  />
                ))
              ) : (
                <p className="settings-inline-note">{t('settings.library.networkPanel.noCandidates')}</p>
              )}
            </article>
          ))}
        </div>
      ) : null}

    </section>
  );
};
