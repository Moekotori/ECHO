import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clipboard, RefreshCw } from 'lucide-react';
import type { AudioDiagnostics, AudioStatus } from '../../../shared/types/audio';
import { useI18n } from '../../i18n/I18nProvider';
import { getAudioBridge } from '../../utils/echoBridge';

type AudioDiagnosticsFallback = Partial<AudioDiagnostics> & Partial<AudioStatus>;

const diagnosticsRefreshIntervalMs = 3000;

const scheduleIdleDiagnosticsRefresh = (callback: () => void): (() => void) => {
  let cancelled = false;
  let idleId: number | null = null;
  let timeoutId: number | null = null;
  const requestIdleCallback = window.requestIdleCallback;
  const cancelIdleCallback = window.cancelIdleCallback;

  const frameId = window.requestAnimationFrame(() => {
    if (cancelled) {
      return;
    }

    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(() => {
        if (!cancelled) {
          callback();
        }
      }, { timeout: 1500 });
      return;
    }

    timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        callback();
      }
    }, 180);
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frameId);
    if (idleId !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleId);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
};

const formatValue = (value: unknown, unknownValue = 'N/A'): string => {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : unknownValue;
  }

  if (value === null || value === undefined || value === '') {
    return unknownValue;
  }

  return String(value);
};

const createFallbackDiagnostics = (status: AudioStatus | null): AudioDiagnosticsFallback => ({
  state: status?.state ?? 'idle',
  host: status?.host ?? 'not-initialized',
  outputMode: status?.outputMode ?? 'shared',
  sharedBackend: status?.sharedBackend ?? null,
  latencyProfile: status?.latencyProfile ?? 'lowLatency',
  outputBackend: status?.outputBackend ?? null,
  activeOutputBackendImpl: status?.activeOutputBackendImpl ?? null,
  nativeOutputFormat: status?.nativeOutputFormat ?? null,
  outputDeviceName: status?.outputDeviceName ?? null,
  currentFilePath: status?.currentFilePath ?? null,
  currentTrackId: status?.currentTrackId ?? null,
  durationSeconds: status?.durationSeconds ?? 0,
  positionSeconds: status?.positionSeconds ?? 0,
  playbackRate: status?.playbackRate ?? 1,
  fileSampleRate: status?.fileSampleRate ?? null,
  decoderOutputSampleRate: status?.decoderOutputSampleRate ?? null,
  requestedOutputSampleRate: status?.requestedOutputSampleRate ?? null,
  actualDeviceSampleRate: status?.actualDeviceSampleRate ?? null,
  sharedDeviceSampleRate: status?.sharedDeviceSampleRate ?? null,
  resampling: status?.resampling ?? false,
  ffmpegPath: status?.ffmpegPath ?? null,
  ffmpegSource: status?.ffmpegSource ?? null,
  ffmpegVersion: status?.ffmpegVersion ?? null,
  ffmpegHealthy: status?.ffmpegHealthy ?? false,
  soxrAvailable: status?.soxrAvailable ?? false,
  resamplerEngine: status?.resamplerEngine ?? 'default',
  resamplerFallbackActive: status?.resamplerFallbackActive ?? false,
  bitPerfectCandidate: status?.bitPerfectCandidate ?? false,
  sampleRateMismatch: status?.sampleRateMismatch ?? false,
  warnings: status?.warnings ?? [],
  error: status?.error ?? null,
  sharedStabilityTier: status?.sharedStabilityTier ?? null,
  nativeDeviceBufferFrames: status?.nativeDeviceBufferFrames ?? null,
  nativeRequestedBufferFrames: status?.nativeRequestedBufferFrames ?? null,
  nativeActualBufferFrames: status?.nativeActualBufferFrames ?? null,
  nativeOutputLatencyMs: status?.nativeOutputLatencyMs ?? null,
  nativePositionStalenessMs: status?.nativePositionStalenessMs ?? null,
  nativeFifoCapacityFrames: status?.nativeFifoCapacityFrames ?? null,
  nativeStartupPrebufferFrames: status?.nativeStartupPrebufferFrames ?? null,
  nativeBufferedFrames: status?.nativeBufferedFrames ?? null,
  nativeBufferedMs: status?.nativeBufferedMs ?? null,
  nativeUnderrunCallbacks: status?.nativeUnderrunCallbacks ?? 0,
  nativeUnderrunFrames: status?.nativeUnderrunFrames ?? 0,
  lastSharedStabilityRecoveryAt: status?.lastSharedStabilityRecoveryAt ?? null,
  watchdogStatus: status?.state === 'playing' ? 'monitoring' : 'idle',
  recentWatchdogRecoveryCount: 0,
  lastWatchdogRecoveryTime: null,
});

export const formatPlaybackDiagnosticsText = (diagnostics: AudioDiagnosticsFallback): string => {
  const rows: Array<[string, unknown]> = [
    ['state', diagnostics.state],
    ['host', diagnostics.host],
    ['outputMode', diagnostics.outputMode],
    ['sharedBackend', diagnostics.sharedBackend],
    ['latencyProfile', diagnostics.latencyProfile],
    ['outputBackend', diagnostics.outputBackend],
    ['activeOutputBackendImpl', diagnostics.activeOutputBackendImpl],
    ['nativeOutputFormat', diagnostics.nativeOutputFormat],
    ['outputDeviceName', diagnostics.outputDeviceName],
    ['currentFilePath', diagnostics.currentFilePath],
    ['currentTrackId', diagnostics.currentTrackId],
    ['durationSeconds', diagnostics.durationSeconds],
    ['positionSeconds', diagnostics.positionSeconds],
    ['playbackRate', diagnostics.playbackRate],
    ['fileSampleRate', diagnostics.fileSampleRate],
    ['decoderOutputSampleRate', diagnostics.decoderOutputSampleRate],
    ['requestedOutputSampleRate', diagnostics.requestedOutputSampleRate],
    ['actualDeviceSampleRate', diagnostics.actualDeviceSampleRate],
    ['sharedDeviceSampleRate', diagnostics.sharedDeviceSampleRate],
    ['resampling', diagnostics.resampling],
    ['ffmpegPath', diagnostics.ffmpegPath],
    ['ffmpegSource', diagnostics.ffmpegSource],
    ['ffmpegVersion', diagnostics.ffmpegVersion],
    ['ffmpegHealthy', diagnostics.ffmpegHealthy],
    ['soxrAvailable', diagnostics.soxrAvailable],
    ['resamplerEngine', diagnostics.resamplerEngine],
    ['resamplerFallbackActive', diagnostics.resamplerFallbackActive],
    ['bitPerfectCandidate', diagnostics.bitPerfectCandidate],
    ['sampleRateMismatch', diagnostics.sampleRateMismatch],
    ['sharedStabilityTier', diagnostics.sharedStabilityTier],
    ['nativeDeviceBufferFrames', diagnostics.nativeDeviceBufferFrames],
    ['nativeRequestedBufferFrames', diagnostics.nativeRequestedBufferFrames],
    ['nativeActualBufferFrames', diagnostics.nativeActualBufferFrames],
    ['nativeOutputLatencyMs', diagnostics.nativeOutputLatencyMs],
    ['nativePositionStalenessMs', diagnostics.nativePositionStalenessMs],
    ['nativeFifoCapacityFrames', diagnostics.nativeFifoCapacityFrames],
    ['nativeStartupPrebufferFrames', diagnostics.nativeStartupPrebufferFrames],
    ['nativeBufferedFrames', diagnostics.nativeBufferedFrames],
    ['nativeBufferedMs', diagnostics.nativeBufferedMs],
    ['nativeUnderrunCallbacks', diagnostics.nativeUnderrunCallbacks],
    ['nativeUnderrunFrames', diagnostics.nativeUnderrunFrames],
    ['lastSharedStabilityRecoveryAt', diagnostics.lastSharedStabilityRecoveryAt],
    ['warnings', diagnostics.warnings],
    ['error', diagnostics.error],
    ['watchdogStatus', diagnostics.watchdogStatus],
    ['recentWatchdogRecoveryCount', diagnostics.recentWatchdogRecoveryCount],
    ['lastWatchdogRecoveryTime', diagnostics.lastWatchdogRecoveryTime],
  ];

  return ['ECHO Next Playback Stability Diagnostics', ...rows.map(([label, value]) => `${label}: ${formatValue(value)}`)].join('\n');
};

export const PlaybackStabilityDiagnosticsPanel = (): JSX.Element => {
  const { t } = useI18n();
  const desktopBridgeUnavailable = t('settings.playback.stability.error.desktopBridgeUnavailable');
  const [isExpanded, setIsExpanded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<AudioDiagnosticsFallback>(() => createFallbackDiagnostics(null));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshDiagnostics = useCallback(async (): Promise<void> => {
    try {
      const audio = getAudioBridge();

      if (!audio) {
        setDiagnostics(createFallbackDiagnostics(null));
        setError(desktopBridgeUnavailable);
        return;
      }

      if ('getDiagnostics' in audio && typeof audio.getDiagnostics === 'function') {
        setDiagnostics(await audio.getDiagnostics());
      } else {
        setDiagnostics(createFallbackDiagnostics(await audio.getStatus()));
      }
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, [desktopBridgeUnavailable]);

  useEffect(() => {
    if (!isExpanded) {
      return undefined;
    }

    const cancelInitialRefresh = scheduleIdleDiagnosticsRefresh(() => {
      void refreshDiagnostics();
    });
    const interval = window.setInterval(() => {
      void refreshDiagnostics();
    }, diagnosticsRefreshIntervalMs);

    return () => {
      cancelInitialRefresh();
      window.clearInterval(interval);
    };
  }, [isExpanded, refreshDiagnostics]);

  const rows = useMemo(
    () => [
      ['state', diagnostics.state],
      ['host', diagnostics.host],
      ['outputMode', diagnostics.outputMode],
      ['sharedBackend', diagnostics.sharedBackend],
      ['latencyProfile', diagnostics.latencyProfile],
      ['outputBackend', diagnostics.outputBackend],
      ['activeOutputBackendImpl', diagnostics.activeOutputBackendImpl],
      ['nativeOutputFormat', diagnostics.nativeOutputFormat],
      ['outputDeviceName', diagnostics.outputDeviceName],
      ['currentFilePath', diagnostics.currentFilePath],
      ['currentTrackId', diagnostics.currentTrackId],
      ['durationSeconds', diagnostics.durationSeconds],
      ['positionSeconds', diagnostics.positionSeconds],
      ['playbackRate', diagnostics.playbackRate],
      ['fileSampleRate', diagnostics.fileSampleRate],
      ['decoderOutputSampleRate', diagnostics.decoderOutputSampleRate],
      ['requestedOutputSampleRate', diagnostics.requestedOutputSampleRate],
      ['actualDeviceSampleRate', diagnostics.actualDeviceSampleRate],
      ['sharedDeviceSampleRate', diagnostics.sharedDeviceSampleRate],
      ['resampling', diagnostics.resampling],
      ['bitPerfectCandidate', diagnostics.bitPerfectCandidate],
      ['sampleRateMismatch', diagnostics.sampleRateMismatch],
      [t('settings.playback.stability.field.sharedStabilityTier'), diagnostics.sharedStabilityTier],
      [t('settings.playback.stability.field.nativeDeviceBufferFrames'), diagnostics.nativeDeviceBufferFrames],
      ['nativeRequestedBufferFrames', diagnostics.nativeRequestedBufferFrames],
      ['nativeActualBufferFrames', diagnostics.nativeActualBufferFrames],
      ['nativeOutputLatencyMs', diagnostics.nativeOutputLatencyMs],
      ['nativePositionStalenessMs', diagnostics.nativePositionStalenessMs],
      [t('settings.playback.stability.field.nativeFifoCapacityFrames'), diagnostics.nativeFifoCapacityFrames],
      [t('settings.playback.stability.field.nativeStartupPrebufferFrames'), diagnostics.nativeStartupPrebufferFrames],
      [t('settings.playback.stability.field.nativeBufferedFrames'), diagnostics.nativeBufferedFrames],
      [t('settings.playback.stability.field.nativeBufferedMs'), diagnostics.nativeBufferedMs],
      [t('settings.playback.stability.field.nativeUnderrunCallbacks'), diagnostics.nativeUnderrunCallbacks],
      [t('settings.playback.stability.field.nativeUnderrunFrames'), diagnostics.nativeUnderrunFrames],
      [t('settings.playback.stability.field.lastSharedStabilityRecoveryAt'), diagnostics.lastSharedStabilityRecoveryAt],
      ['warnings', diagnostics.warnings],
      ['error', diagnostics.error],
      [t('settings.playback.stability.field.watchdogStatus'), diagnostics.watchdogStatus],
      [t('settings.playback.stability.field.recentWatchdogRecoveryCount'), diagnostics.recentWatchdogRecoveryCount],
      [t('settings.playback.stability.field.lastWatchdogRecoveryTime'), diagnostics.lastWatchdogRecoveryTime],
    ],
    [diagnostics, t],
  );

  const copyDiagnostics = useCallback(async (): Promise<void> => {
    try {
      await window.navigator.clipboard.writeText(formatPlaybackDiagnosticsText(diagnostics));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      setError(null);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }, [diagnostics]);

  return (
    <section className="audio-dev-panel playback-stability-panel" aria-label={t('settings.playback.stability.title')} data-expanded={isExpanded}>
      <div className="audio-dev-header">
        <button
          className="settings-collapse-toggle playback-stability-toggle"
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
        >
          <span>
            <span className="panel-kicker">Audio</span>
            <strong>{t('settings.playback.stability.title')}</strong>
          </span>
          <ChevronDown size={17} />
        </button>
        {isExpanded ? (
          <div className="playback-stability-actions">
            <button className="settings-action-button" type="button" onClick={() => void copyDiagnostics()}>
              <Clipboard size={15} />
              {copied ? t('settings.playback.stability.action.copied') : t('settings.playback.stability.action.copy')}
            </button>
            <button
              className="tool-button"
              type="button"
              aria-label={t('settings.playback.stability.action.refresh')}
              title={t('settings.playback.stability.action.refresh')}
              onClick={() => void refreshDiagnostics()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        ) : null}
      </div>

      {isExpanded ? (
        <div className="settings-status-grid playback-stability-grid">
          {rows.map(([label, value]) => (
            <span key={String(label)}>
              <em>{label}</em>
              <strong title={formatValue(value, t('settings.playback.stability.value.unknown'))}>
                {formatValue(value, t('settings.playback.stability.value.unknown'))}
              </strong>
            </span>
          ))}
        </div>
      ) : null}

      {error ? <p className="settings-inline-error">{error}</p> : null}
    </section>
  );
};
