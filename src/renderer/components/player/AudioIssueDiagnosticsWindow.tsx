import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Copy, Trash2, X } from 'lucide-react';
import type { AudioDiagnostics, AudioStatus } from '../../../shared/types/audio';
import type { AppSettings } from '../../../shared/types/appSettings';
import type { PlaybackStatus } from '../../../shared/types/playback';

type DiagnosticSource = 'audio-status' | 'poll' | 'manual';

type AudioIssueDiagnosticEntry = {
  at: string;
  source: DiagnosticSource;
  markers: string[];
  audio: {
    state: AudioStatus['state'];
    host: AudioStatus['host'];
    trackId: string | null;
    filePath: string | null;
    positionSeconds: number;
    durationSeconds: number;
    outputMode: AudioStatus['outputMode'];
    outputBackend: string | null;
    outputBackendImpl: string | null;
    nativeOutputFormat: string | null | undefined;
    decodeBackendImpl: string | null;
    fileSampleRate: number | null;
    decoderOutputSampleRate: number | null;
    requestedOutputSampleRate: number | null;
    actualDeviceSampleRate: number | null;
    nativeBufferedMs: number | null | undefined;
    nativeBufferedFrames: number | null | undefined;
    nativeUnderrunCallbacks: number | undefined;
    nativeUnderrunFrames: number | undefined;
    replayGainEnabled: boolean | undefined;
    replayGainAppliedDb: number | undefined;
    automixActive: boolean | undefined;
    gaplessOrAutomixEngine: string | null | undefined;
    warnings: string[];
    error: string | null;
  };
  playback?: PlaybackStatus | null;
  diagnostics?: StoredAudioDiagnostics | null;
};

type StoredAudioDiagnostics = Pick<
  AudioDiagnostics,
  'watchdogStatus' | 'recentWatchdogRecoveryCount' | 'lastWatchdogRecoveryTime' | 'playbackIssueSummary' | 'recentPlaybackEvents'
>;

type AudioIssueDiagnosticsWindowProps = {
  onClose: () => void;
};

const maxEntries = 240;
const pollIntervalMs = 3000;
const enhancedLowLoadPollIntervalMs = 15_000;
const maxStoredDiagnosticEventsPerEntry = 12;

const readEnhancedLowLoadPlaybackActive = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.lowLoadPlaybackModeEnabled === true && settings.lowLoadPlaybackEnhancementsEnabled === true;

const labels = {
  aria: '音频问题诊断窗口',
  title: '音频问题诊断',
  noTrack: '未选择曲目',
  record: '记录',
  recordTitle: '立即记录',
  copy: '复制',
  copied: '已复制',
  copyFailed: '复制失败',
  copyTitle: '复制 JSON',
  clearTitle: '清空记录',
  closeTitle: '关闭诊断',
  state: '状态',
  progress: '进度',
  output: '输出',
  decode: '解码',
  sampleRate: '采样率',
  buffer: '缓冲',
  recordCount: '记录数',
};

const formatSeconds = (value: number | null | undefined): string => {
  if (!Number.isFinite(value)) {
    return '--:--';
  }

  const totalSeconds = Math.max(0, Math.round(Number(value)));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatNumber = (value: number | null | undefined, decimals = 0): string =>
  Number.isFinite(value) ? Number(value).toFixed(decimals) : 'n/a';

const basename = (path: string | null | undefined): string =>
  path?.split(/[\\/]/u).filter(Boolean).pop() ?? labels.noTrack;

const createMarkers = (status: AudioStatus, previous: AudioStatus | null): string[] => {
  const markers: string[] = [];
  const position = Number(status.positionSeconds);
  const duration = Number(status.durationSeconds);

  if (position >= 170 && position <= 190) {
    markers.push('three_minute_window');
  }

  if (status.state === 'ended' && duration > 0 && position < duration - 5) {
    markers.push('premature_ended_before_duration');
  }

  if (status.state === 'ended' && previous?.state !== 'ended') {
    markers.push('state_transition_to_ended');
  }

  if (duration > 0 && Math.abs(duration - 180) <= 2) {
    markers.push('duration_near_180s');
  }

  if ((status.nativeUnderrunCallbacks ?? 0) > 0) {
    markers.push('native_underrun_seen');
  }

  if (status.error) {
    markers.push('audio_error');
  }

  if (status.warnings.length > 0) {
    markers.push('warnings_present');
  }

  return markers;
};

const createEntry = (
  source: DiagnosticSource,
  status: AudioStatus,
  previous: AudioStatus | null,
  playback?: PlaybackStatus | null,
  diagnostics?: AudioDiagnostics | null,
): AudioIssueDiagnosticEntry => ({
  at: new Date().toISOString(),
  source,
  markers: createMarkers(status, previous),
  audio: {
    state: status.state,
    host: status.host,
    trackId: status.currentTrackId,
    filePath: status.currentFilePath,
    positionSeconds: status.positionSeconds,
    durationSeconds: status.durationSeconds,
    outputMode: status.outputMode,
    outputBackend: status.outputBackend,
    outputBackendImpl: status.activeOutputBackendImpl,
    nativeOutputFormat: status.nativeOutputFormat,
    decodeBackendImpl: status.activeDecodeBackendImpl,
    fileSampleRate: status.fileSampleRate,
    decoderOutputSampleRate: status.decoderOutputSampleRate,
    requestedOutputSampleRate: status.requestedOutputSampleRate,
    actualDeviceSampleRate: status.actualDeviceSampleRate,
    nativeBufferedMs: status.nativeBufferedMs,
    nativeBufferedFrames: status.nativeBufferedFrames,
    nativeUnderrunCallbacks: status.nativeUnderrunCallbacks,
    nativeUnderrunFrames: status.nativeUnderrunFrames,
    replayGainEnabled: status.replayGainEnabled,
    replayGainAppliedDb: status.replayGainAppliedDb,
    automixActive: status.automix?.active,
    gaplessOrAutomixEngine: status.automix?.engine,
    warnings: status.warnings,
    error: status.error,
  },
  playback,
  diagnostics: compactDiagnostics(diagnostics),
});

const compactDiagnostics = (diagnostics: AudioDiagnostics | null | undefined): StoredAudioDiagnostics | null => {
  if (!diagnostics) {
    return null;
  }

  return {
    watchdogStatus: diagnostics.watchdogStatus,
    recentWatchdogRecoveryCount: diagnostics.recentWatchdogRecoveryCount,
    lastWatchdogRecoveryTime: diagnostics.lastWatchdogRecoveryTime,
    playbackIssueSummary: diagnostics.playbackIssueSummary,
    recentPlaybackEvents: diagnostics.recentPlaybackEvents?.slice(-maxStoredDiagnosticEventsPerEntry),
  };
};

export const AudioIssueDiagnosticsWindow = ({ onClose }: AudioIssueDiagnosticsWindowProps): JSX.Element => {
  const [entries, setEntries] = useState<AudioIssueDiagnosticEntry[]>([]);
  const [latestStatus, setLatestStatus] = useState<AudioStatus | null>(null);
  const [latestDiagnostics, setLatestDiagnostics] = useState<AudioDiagnostics | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [enhancedLowLoadPlaybackActive, setEnhancedLowLoadPlaybackActive] = useState(false);
  const previousStatusRef = useRef<AudioStatus | null>(null);
  const shouldUseEnhancedLowLoadPolling =
    enhancedLowLoadPlaybackActive && (latestStatus?.state === 'loading' || latestStatus?.state === 'playing');

  const appendEntry = useCallback((
    source: DiagnosticSource,
    status: AudioStatus,
    playback?: PlaybackStatus | null,
    diagnostics?: AudioDiagnostics | null,
  ): void => {
    const previous = previousStatusRef.current;
    const entry = createEntry(source, status, previous, playback, diagnostics);
    previousStatusRef.current = status;
    setLatestStatus(status);
    if (source === 'manual' || entry.markers.length > 0) {
      setEntries((current) => [...current, entry].slice(-maxEntries));
    }
  }, []);

  const captureSnapshot = useCallback(async (source: DiagnosticSource): Promise<void> => {
    const audio = window.echo?.audio;
    if (!audio) {
      return;
    }

    const [status, playback, diagnostics] = await Promise.all([
      audio.getStatus(),
      window.echo?.playback?.getStatus?.().catch(() => null) ?? Promise.resolve(null),
      audio.getDiagnostics?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    setLatestDiagnostics(diagnostics);
    appendEntry(source, status, playback, diagnostics);
  }, [appendEntry]);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.echo?.audio?.onStatus?.((status) => {
      if (!disposed) {
        appendEntry('audio-status', status);
      }
    });

    void captureSnapshot('manual').catch(() => undefined);
    const intervalMs = shouldUseEnhancedLowLoadPolling ? enhancedLowLoadPollIntervalMs : pollIntervalMs;
    const timer = window.setInterval(() => {
      void captureSnapshot('poll').catch(() => undefined);
    }, intervalMs);

    return () => {
      disposed = true;
      unsubscribe?.();
      window.clearInterval(timer);
    };
  }, [appendEntry, captureSnapshot, shouldUseEnhancedLowLoadPolling]);

  useEffect(() => {
    let disposed = false;
    const refreshSettings = (): void => {
      void window.echo?.app?.getSettings?.()
        .then((settings) => {
          if (!disposed) {
            setEnhancedLowLoadPlaybackActive(readEnhancedLowLoadPlaybackActive(settings));
          }
        })
        .catch(() => undefined);
    };

    const handleSettingsChanged = (event: Event): void => {
      const detail = (event as CustomEvent<Partial<AppSettings> | null | undefined>).detail;
      if (
        !detail ||
        (
          !Object.prototype.hasOwnProperty.call(detail, 'lowLoadPlaybackModeEnabled') &&
          !Object.prototype.hasOwnProperty.call(detail, 'lowLoadPlaybackEnhancementsEnabled')
        )
      ) {
        return;
      }

      refreshSettings();
    };

    refreshSettings();
    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => {
      disposed = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  const diagnosticEvents = latestDiagnostics?.recentPlaybackEvents ?? [];
  const { suspectEvents, visibleEvents } = useMemo(() => {
    const suspect = diagnosticEvents.filter((event) => event.severity !== 'info');
    return {
      suspectEvents: suspect,
      visibleEvents: suspect.length > 0 ? suspect : diagnosticEvents.slice(-40),
    };
  }, [diagnosticEvents]);
  const logText = useMemo(
    () =>
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          playbackIssueSummary: latestDiagnostics?.playbackIssueSummary ?? null,
          suspectEvents,
          recentPlaybackEvents: diagnosticEvents,
          manualSnapshots: entries,
        },
        null,
        2,
      ),
    [diagnosticEvents, entries, latestDiagnostics?.playbackIssueSummary, suspectEvents],
  );
  const visibleLogText = useMemo(
    () =>
      JSON.stringify(
        {
          playbackIssueSummary: latestDiagnostics?.playbackIssueSummary ?? null,
          visibleEvents,
          manualSnapshots: entries.slice(-12),
        },
        null,
        2,
      ),
    [entries, latestDiagnostics?.playbackIssueSummary, visibleEvents],
  );
  const latestEntry = entries.at(-1) ?? null;
  const summary = latestDiagnostics?.playbackIssueSummary ?? null;
  const latestMarkers = [
    ...(latestEntry?.markers ?? []),
    ...(summary && summary.suspectEventCount > 0 ? [`suspect_events:${summary.suspectEventCount}`] : []),
    ...(summary && summary.recoveryEventCount > 0 ? [`recovery_events:${summary.recoveryEventCount}`] : []),
  ];

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      if (!navigator.clipboard) {
        throw new Error('clipboard_unavailable');
      }

      await navigator.clipboard.writeText(logText);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  }, [logText]);

  return (
    <section className="audio-issue-diagnostics-window" aria-label={labels.aria}>
      <header className="audio-issue-diagnostics-window__header">
        <div>
          <span className="audio-issue-diagnostics-window__eyebrow">
            <Activity size={13} />
            {labels.title}
          </span>
          <h2>{basename(latestStatus?.currentFilePath)}</h2>
        </div>
        <div className="audio-issue-diagnostics-window__actions">
          <button type="button" onClick={() => void captureSnapshot('manual')} title={labels.recordTitle}>
            {labels.record}
          </button>
          <button type="button" onClick={() => void handleCopy()} title={labels.copyTitle}>
            <Copy size={14} />
            {copyState === 'copied' ? labels.copied : copyState === 'failed' ? labels.copyFailed : labels.copy}
          </button>
          <button type="button" onClick={() => setEntries([])} title={labels.clearTitle}>
            <Trash2 size={14} />
          </button>
          <button type="button" onClick={onClose} title={labels.closeTitle}>
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="audio-issue-diagnostics-window__grid">
        <span>
          <em>{labels.state}</em>
          <strong>{latestStatus?.state ?? 'idle'}</strong>
        </span>
        <span>
          <em>{labels.progress}</em>
          <strong>{formatSeconds(latestStatus?.positionSeconds)} / {formatSeconds(latestStatus?.durationSeconds)}</strong>
        </span>
        <span>
          <em>{labels.output}</em>
          <strong>{latestStatus?.outputMode ?? 'n/a'} / {latestStatus?.activeOutputBackendImpl ?? latestStatus?.outputBackend ?? 'n/a'}</strong>
        </span>
        <span>
          <em>{labels.decode}</em>
          <strong>{latestStatus?.activeDecodeBackendImpl ?? 'n/a'}</strong>
        </span>
        <span>
          <em>{labels.sampleRate}</em>
          <strong>{formatNumber(latestStatus?.fileSampleRate)} -&gt; {formatNumber(latestStatus?.actualDeviceSampleRate)}</strong>
        </span>
        <span>
          <em>{labels.buffer}</em>
          <strong>{formatNumber(latestStatus?.nativeBufferedMs)} ms</strong>
        </span>
        <span>
          <em>Underrun</em>
          <strong>{latestStatus?.nativeUnderrunCallbacks ?? 0} / {latestStatus?.nativeUnderrunFrames ?? 0}</strong>
        </span>
        <span>
          <em>{labels.recordCount}</em>
          <strong>{diagnosticEvents.length}</strong>
        </span>
        <span>
          <em>Suspects</em>
          <strong>{summary?.suspectEventCount ?? 0}</strong>
        </span>
      </div>

      {latestMarkers.length > 0 ? (
        <div className="audio-issue-diagnostics-window__markers">
          {latestMarkers.map((marker) => (
            <span key={marker}>{marker}</span>
          ))}
        </div>
      ) : null}

      <pre className="audio-issue-diagnostics-window__log">{visibleLogText || '[]'}</pre>
    </section>
  );
};
