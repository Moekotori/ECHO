import type {
  AudioOutputSettings,
  AudioStatus,
  ChannelBalanceMonoMode,
  ChannelBalanceState,
  PlaybackSpeedMode,
} from '../shared/types/audio';
import { audioBackendContractVersion } from '../shared/types/audio';
import type { AppSettings, AudioTransportFadeCurve, ReplayGainMode } from '../shared/types/appSettings';
import type {
  PlaybackMediaStartRequest,
  PlaybackResolvedMediaSource,
  PlaybackStartRequest,
  PlaybackStatus,
} from '../shared/types/playback';
import { calculateReplayGain, dbToLinearGain } from '../shared/utils/replayGain';
import type { ReplayGainCalculation, ReplayGainTrackData } from '../shared/utils/replayGain';
import { DEFAULT_REPLAY_GAIN_TARGET_LUFS } from '../shared/constants/replayGain';

// ---------------------------------------------------------------------------
// Module-level types
// ---------------------------------------------------------------------------

type SystemPlaybackSource = PlaybackResolvedMediaSource & {
  trackId?: string | null;
  metadata?: PlaybackStartRequest['metadata'];
  replayGain?: ReplayGainTrackData | null;
};

type PitchControlAudioElement = HTMLAudioElement & {
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};

type SystemMediaPlaybackContext = {
  request: PlaybackMediaStartRequest;
  generation: number;
  recoveryAttempts: number;
  recovering: boolean;
  source: SystemPlaybackSource | null;
};

type SystemPlaybackErrorReport = {
  phase: string;
  message: string;
  recovered: boolean;
  currentFilePath?: {
    basename: string;
    pathHash: string;
  } | null;
  mediaType?: 'local' | 'remote' | 'streaming';
  provider?: string | null;
  trackId?: string | null;
  sourceKind?: 'local' | 'remote' | 'renderer';
  sourceHost?: string | null;
  mimeType?: string | null;
  codec?: string | null;
  container?: string | null;
  duration?: number | null;
  fileSampleRate?: number | null;
  bitDepth?: number | null;
  firstFfprobeResult?: {
    codec: string | null;
    container: string | null;
    duration: number | null;
    fileSampleRate: number | null;
    bitDepth: number | null;
    bitrate: number | null;
    channels: number | null;
  } | null;
  recoveryAttempt?: number;
  maxRecoveryAttempts?: number;
  htmlAudio?: {
    networkState: number | null;
    readyState: number | null;
    errorCode: number | null;
    errorMessage: string | null;
    srcType: string;
  };
};

// ---------------------------------------------------------------------------
// AutomixAdvancePayload (exported for public API)
// ---------------------------------------------------------------------------

export type AutomixAdvancePayload = {
  fromTrackId: string | null;
  toTrackId: string;
  transitionSeconds: number;
  mode?: 'smartCrossfade' | 'beatAligned' | 'energyFade' | 'gaplessFallback';
  fallbackReason?: string | null;
  beatAligned?: boolean;
  skipIntroSilence?: boolean;
  nextStartSeconds?: number;
};

// ---------------------------------------------------------------------------
// IPC interface (DI-compatible, avoids importing 'electron')
// ---------------------------------------------------------------------------

interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Public API type
// ---------------------------------------------------------------------------

export interface SystemAudioEngine {
  // Handler registration
  onAudioStatus(handler: (status: AudioStatus) => void): () => void;
  onTrackChange(handler: (trackId: string | null, filePath: string | null) => void): () => void;
  onLocalAudioFilesOpened(handler: (paths: string[]) => void): () => void;
  onAutomixAdvance(handler: (event: AutomixAdvancePayload) => void): () => void;

  // Status queries
  getSystemAudioStatus(): AudioStatus;
  getSystemPlaybackStatus(): PlaybackStatus;

  // State access
  lastNativeAudioStatus: AudioStatus | null;
  systemAudioModeActive: boolean;

  // Playback lifecycle
  handoffNativePlaybackToSystemAudio(status: AudioStatus | null): Promise<AudioStatus | null>;
  stopSystemPlayback(state?: 'stopped' | 'idle', emitStatus?: boolean): PlaybackStatus;
  refreshSystemAudioModeActive(): Promise<boolean>;
  play(): Promise<PlaybackStatus>;
  pause(): Promise<PlaybackStatus>;
  stop(): Promise<PlaybackStatus>;
  seek(positionSeconds: number): Promise<PlaybackStatus>;

  // Direct system-audio playback entry (used by echoApi.playback.*)
  playLocalFileWithSystemAudio(request: PlaybackStartRequest): Promise<PlaybackStatus>;
  playMediaItemWithSystemAudio(request: PlaybackMediaStartRequest): Promise<PlaybackStatus>;
  shouldUseSystemAudioForPlayback(output?: AudioOutputSettings): Promise<boolean>;
  requiresNativeChainedPlayback(request: Pick<PlaybackStartRequest, 'automix' | 'gapless'>): boolean;
  requiresNativeSystemLocalPlayback(request: Pick<PlaybackStartRequest, 'filePath'>): boolean;
  requiresNativeSystemMediaPlayback(request: PlaybackMediaStartRequest): boolean;
  isExplicitNativeOutputRequest(settings: unknown): boolean;

  // Output / DSP
  applySystemOutputSettings(settings: Partial<AudioOutputSettings> | null | undefined, base?: AudioStatus | null): void;
  applySystemChannelBalanceState(state: Partial<ChannelBalanceState> | null | undefined): void;

  // Persistence
  readPersistedSystemAudioMode(): boolean;
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createSystemAudioEngine(
  ipcRenderer: IpcRendererLike,
  IpcChannels: typeof import('../shared/constants/ipcChannels').IpcChannels,
): SystemAudioEngine {
  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  const systemAudioWarning = 'system_audio_compatibility_mode';
  const systemAudioDeviceName = 'System default output';
  const systemAudioOutputBackend = 'system-audio';
  const systemAudioBackendImpl = 'electron-html-audio';
  const maxSystemMediaRecoveryAttempts = 1;
  const systemSeekConfirmTimeoutMs = 2500;
  const systemSeekToleranceSeconds = 0.75;
  const systemPrematureEndToleranceSeconds = 5;
  const systemCorruptEndRatioThreshold = 0.75;
  const systemSeekConfirmEvents: Array<keyof HTMLMediaElementEventMap> = [
    'seeked',
    'timeupdate',
    'canplay',
    'playing',
    'loadedmetadata',
  ];
  const systemPlaybackSupersededMessage = 'audio_session_run_cancelled';
  const systemPlayInterruptedByTransportPattern = /\bplay\(\) request was interrupted by a call to (?:pause|load)\(\)/iu;

  // -----------------------------------------------------------------------
  // Handler registries
  // -----------------------------------------------------------------------

  const audioStatusHandlers = new Set<(status: AudioStatus) => void>();
  const trackChangeHandlers = new Set<(trackId: string | null, filePath: string | null) => void>();
  const localAudioFileOpenHandlers = new Set<(paths: string[]) => void>();
  const pendingLocalAudioFileOpenEvents: string[][] = [];
  const automixAdvanceHandlers = new Set<(event: AutomixAdvancePayload) => void>();

  // -----------------------------------------------------------------------
  // Renderer state helpers
  // -----------------------------------------------------------------------

  const rendererSearchParams = new URLSearchParams(typeof window.location?.search === 'string' ? window.location.search : '');
  const isMainPlaybackRenderer =
    rendererSearchParams.get('miniPlayer') !== '1' && rendererSearchParams.get('desktopLyrics') !== '1';

  // -----------------------------------------------------------------------
  // State variables
  // -----------------------------------------------------------------------

  const readPersistedSystemAudioMode = (): boolean => {
    try {
      const raw = window.localStorage.getItem('echo-next.audio-output-memory');
      if (!raw) {
        return false;
      }
      const parsed = JSON.parse(raw) as { enabled?: unknown; outputMode?: unknown };
      return parsed.enabled === true && parsed.outputMode === 'system';
    } catch {
      return false;
    }
  };

  let systemAudioElement: HTMLAudioElement | null = null;
  let systemAudioContext: AudioContext | null = null;
  let systemAudioSourceNode: MediaElementAudioSourceNode | null = null;
  let systemAudioGainNode: GainNode | null = null;
  let systemAudioSplitterNode: ChannelSplitterNode | null = null;
  let systemAudioMonoLeftGainNode: GainNode | null = null;
  let systemAudioMonoRightGainNode: GainNode | null = null;
  let systemAudioMonoMergerNode: ChannelMergerNode | null = null;
  let systemAudioModeActive = readPersistedSystemAudioMode();
  let systemAudioState: AudioStatus['state'] = 'idle';
  let systemAudioSource: SystemPlaybackSource | null = null;
  let systemAudioObjectUrl: string | null = null;
  let systemAudioError: string | null = null;
  let systemAudioStatusTimer: number | null = null;
  let systemAudioTransportGain = 1;
  let systemAudioFadeGeneration = 0;
  let systemAudioTransportFadeEnabled = false;
  let systemAudioTransportFadeInMs = 80;
  let systemAudioTransportFadeOutMs = 80;
  let systemAudioTransportFadeCurve: AudioTransportFadeCurve = 'smooth';
  let lastNativeAudioStatus: AudioStatus | null = null;
  let systemPlaybackGeneration = 0;
  let systemMediaPlaybackContext: SystemMediaPlaybackContext | null = null;
  type SystemAudioStartupPositionGuard = {
    generation: number;
    trackId: string | null;
    filePath: string;
    expectedStartSeconds: number;
    startedAtMs: number;
  };
  let systemAudioStartupPositionGuard: SystemAudioStartupPositionGuard | null = null;
  let systemReplayGainEnabled = false;
  let systemReplayGainMode: ReplayGainMode = 'track';
  let systemReplayGainTargetLufs = DEFAULT_REPLAY_GAIN_TARGET_LUFS;
  let systemReplayGainCalculation: ReplayGainCalculation = {
    appliedDb: 0,
    selectedGainDb: null,
    selectedPeak: null,
    preventedClipping: false,
    active: false,
  };
  let systemChannelBalanceMonoMode: ChannelBalanceMonoMode = 'off';
  let systemOutputSettings: Pick<AudioStatus, 'volume' | 'playbackRate' | 'playbackSpeedMode'> = {
    volume: 1,
    playbackRate: 1,
    playbackSpeedMode: 'nightcore',
  };

  // -----------------------------------------------------------------------
  // Utility functions
  // -----------------------------------------------------------------------

  const isHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value.trim());
  const systemAudioTransportFadeStepMs = 10;
  const systemAudioStartupPositionGuardMs = 3000;
  const systemAudioStartupPositionToleranceSeconds = 1.5;
  const audioTransportFadeCurves = new Set<AudioTransportFadeCurve>(['linear', 'smooth', 'equalPower']);
  const isRendererReadyUrl = (value: string): boolean => /^(?:blob|data):/iu.test(value.trim());
  const nativePreferredSystemLocalAudioExtensions = new Set(['.ape']);

  const getPlaybackPathExtension = (filePath: string): string => {
    const pathPart = filePath.trim().replace(/[?#].*$/u, '');
    const fileName = pathPart.split(/[\\/]/u).pop() ?? pathPart;
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
      return '';
    }

    return fileName.slice(dotIndex).toLowerCase();
  };

  const isNativePreferredSystemLocalPath = (filePath: string | null | undefined): boolean => {
    const rawPath = filePath?.trim() ?? '';
    return (
      rawPath.length > 0 &&
      !isHttpUrl(rawPath) &&
      !isRendererReadyUrl(rawPath) &&
      nativePreferredSystemLocalAudioExtensions.has(getPlaybackPathExtension(rawPath))
    );
  };
  const hashPathForDiagnostics = (value: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const safePathForDiagnostics = (value: string | null | undefined): SystemPlaybackErrorReport['currentFilePath'] => {
    const raw = value?.trim();
    if (!raw) {
      return null;
    }
    const normalized = raw.replace(/\\/gu, '/');
    const basename = normalized.split('/').filter(Boolean).at(-1) ?? raw;
    return { basename, pathHash: hashPathForDiagnostics(raw) };
  };
  const inferContainerForDiagnostics = (value: string | null | undefined, mimeType?: string | null): string | null => {
    const mimeSubtype = mimeType?.split(';', 1)[0]?.split('/').at(-1)?.trim();
    if (mimeSubtype) {
      return mimeSubtype.toUpperCase();
    }
    const pathPart = value?.split(/[?#]/u, 1)[0] ?? '';
    const extension = /\.([a-z0-9]+)$/iu.exec(pathPart)?.[1];
    return extension ? extension.toUpperCase() : null;
  };
  const sourceTechnicalDiagnostics = (
    source: SystemPlaybackSource | null,
  ): Pick<SystemPlaybackErrorReport, 'codec' | 'container' | 'duration' | 'fileSampleRate' | 'bitDepth' | 'firstFfprobeResult'> => {
    const probe = source?.probe;
    const container = inferContainerForDiagnostics(source?.filePath, source?.mimeType);
    const duration = finiteSeconds(probe?.durationSeconds) ?? finiteSeconds(source?.durationSeconds) ?? null;
    const codec = typeof probe?.codec === 'string' && probe.codec.trim() ? probe.codec : null;
    const fileSampleRate = typeof probe?.fileSampleRate === 'number' && Number.isFinite(probe.fileSampleRate) ? probe.fileSampleRate : null;
    const bitDepth = typeof probe?.bitDepth === 'number' && Number.isFinite(probe.bitDepth) ? probe.bitDepth : null;
    const bitrate = typeof probe?.bitrate === 'number' && Number.isFinite(probe.bitrate) ? probe.bitrate : null;
    const channels = typeof probe?.channels === 'number' && Number.isFinite(probe.channels) ? probe.channels : null;
    return {
      codec,
      container,
      duration,
      fileSampleRate,
      bitDepth,
      firstFfprobeResult: probe
        ? {
            codec,
            container,
            duration,
            fileSampleRate,
            bitDepth,
            bitrate,
            channels,
          }
        : null,
    };
  };

  const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

  const errorName = (error: unknown): string | null => {
    if (error instanceof Error) {
      return error.name;
    }

    if (error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string') {
      return (error as { name: string }).name;
    }

    return null;
  };

  const isExpectedSystemPlaybackInterruption = (error: unknown): boolean => {
    const message = errorMessage(error);
    if (message.includes(systemPlaybackSupersededMessage)) {
      return true;
    }

    if (systemPlayInterruptedByTransportPattern.test(message)) {
      return true;
    }

    return errorName(error) === 'AbortError' && /\bplay\(\)|HTMLMediaElement/iu.test(message);
  };

  const htmlAudioSrcType = (value: string | null | undefined): string => {
    const raw = value?.trim() ?? '';
    if (!raw) {
      return 'empty';
    }
    if (/^blob:/iu.test(raw)) {
      return 'blob';
    }
    if (/^data:/iu.test(raw)) {
      return 'data';
    }
    if (/^https?:/iu.test(raw)) {
      return 'http';
    }
    if (/^echo-audio:/iu.test(raw)) {
      return 'echo-audio';
    }
    if (/^file:/iu.test(raw)) {
      return 'file';
    }
    return 'other';
  };
  const isLocalSystemSource = (source: SystemPlaybackSource | null): boolean => {
    const rawUrl = source?.filePath?.trim() ?? '';
    return rawUrl.length > 0 && !isHttpUrl(rawUrl) && !isRendererReadyUrl(rawUrl);
  };
  const isSystemNetworkMediaPlayback = (): boolean => {
    const mediaType = systemMediaPlaybackContext?.request.item.mediaType;
    if (mediaType === 'remote' || mediaType === 'streaming') {
      return true;
    }

    const rawUrl = systemAudioSource?.filePath?.trim() ?? '';
    return rawUrl.length > 0 && isHttpUrl(rawUrl);
  };

  const createSystemAudioMediaErrorMessage = (element: HTMLAudioElement, fallback = 'system_audio_playback_failed'): string => {
    const code = typeof element.error?.code === 'number' ? element.error.code : null;
    const nativeMessage = element.error?.message?.trim() ?? '';
    if (code === 3) {
      return nativeMessage ? `system_audio_decode_error: ${nativeMessage}` : 'system_audio_decode_error';
    }
    if (code === 4) {
      return nativeMessage ? `system_audio_source_not_supported: ${nativeMessage}` : 'system_audio_source_not_supported';
    }

    return nativeMessage || fallback;
  };

  const createSystemAudioPrematureEndMessage = (positionSeconds: number, durationSeconds: number): string =>
    `system_audio_decode_error; positionSeconds=${positionSeconds.toFixed(3)}; durationSeconds=${durationSeconds.toFixed(3)}`;

  const createSystemAudioLooseDurationMessage = (positionSeconds: number, durationSeconds: number): string =>
    `system_audio_ended_before_reported_duration; positionSeconds=${positionSeconds.toFixed(3)}; durationSeconds=${durationSeconds.toFixed(3)}`;

  const isClearlyCorruptSystemEnd = (positionSeconds: number, durationSeconds: number): boolean =>
    durationSeconds > 0 &&
    positionSeconds < durationSeconds - systemPrematureEndToleranceSeconds &&
    positionSeconds / durationSeconds < systemCorruptEndRatioThreshold;

  const nextSystemPlaybackGeneration = (): number => {
    systemPlaybackGeneration += 1;
    return systemPlaybackGeneration;
  };

  const sourceDiagnostics = (source: SystemPlaybackSource | null): Pick<SystemPlaybackErrorReport, 'sourceKind' | 'sourceHost' | 'mimeType'> => {
    const rawUrl = source?.filePath?.trim() ?? '';
    if (!rawUrl) {
      return { sourceKind: undefined, sourceHost: null, mimeType: source?.mimeType ?? null };
    }

    if (isRendererReadyUrl(rawUrl)) {
      return { sourceKind: 'renderer', sourceHost: null, mimeType: source?.mimeType ?? null };
    }

    if (isHttpUrl(rawUrl)) {
      try {
        return { sourceKind: 'remote', sourceHost: new URL(rawUrl).host, mimeType: source?.mimeType ?? null };
      } catch {
        return { sourceKind: 'remote', sourceHost: null, mimeType: source?.mimeType ?? null };
      }
    }

    return { sourceKind: 'local', sourceHost: null, mimeType: source?.mimeType ?? null };
  };

  const htmlAudioDiagnostics = (): SystemPlaybackErrorReport['htmlAudio'] => {
    const element = systemAudioElement;
    const src = element?.currentSrc || element?.src;
    return {
      networkState: typeof element?.networkState === 'number' ? element.networkState : null,
      readyState: typeof element?.readyState === 'number' ? element.readyState : null,
      errorCode: typeof element?.error?.code === 'number' ? element.error.code : null,
      errorMessage: element?.error?.message ?? null,
      srcType: htmlAudioSrcType(src),
    };
  };

  const mediaRequestDiagnostics = (request: PlaybackMediaStartRequest | null): Pick<SystemPlaybackErrorReport, 'mediaType' | 'provider' | 'trackId'> => {
    const item = request?.item;
    if (!item) {
      return {};
    }

    return {
      mediaType: item.mediaType,
      provider: item.mediaType === 'streaming' ? item.provider : null,
      trackId: item.trackId,
    };
  };

  const reportSystemPlaybackError = (report: SystemPlaybackErrorReport): void => {
    void ipcRenderer.invoke(IpcChannels.AudioReportSystemPlaybackError, report).catch(() => undefined);
  };

  const createSystemPlaybackErrorReportBase = (
    source: SystemPlaybackSource | null,
  ): Pick<
    SystemPlaybackErrorReport,
    | 'currentFilePath'
    | 'sourceKind'
    | 'sourceHost'
    | 'mimeType'
    | 'codec'
    | 'container'
    | 'duration'
    | 'fileSampleRate'
    | 'bitDepth'
    | 'firstFfprobeResult'
  > => ({
    currentFilePath: safePathForDiagnostics(source?.filePath),
    ...sourceDiagnostics(source),
    ...sourceTechnicalDiagnostics(source),
  });

  const createFallbackAudioStatus = (): AudioStatus => ({
    host: 'ready',
    state: 'idle',
    outputDeviceId: null,
    outputDeviceName: systemAudioDeviceName,
    outputDeviceType: 'system',
    outputBackend: systemAudioOutputBackend,
    activeOutputBackendImpl: systemAudioBackendImpl,
    activeOutputBackendLabel: systemAudioBackendImpl,
    outputMode: 'system',
    sharedBackend: 'auto',
    backendContractVersion: audioBackendContractVersion,
    useNativeOutputRequested: false,
    useMiniaudioOutputRequested: false,
    useLibavDecodeRequested: false,
    activeDecodeBackendLabel: 'chromium-media',
    activeDecodeBackendImpl: 'chromium-media',
    dsdOutputModeRequested: 'pcm',
    activeDsdOutputMode: null,
    dsdNativeSampleRate: null,
    dsdTransportSampleRate: null,
    volume: systemOutputSettings.volume,
    playbackRate: systemOutputSettings.playbackRate,
    playbackSpeedMode: systemOutputSettings.playbackSpeedMode,
    replayGainEnabled: false,
    replayGainMode: 'track',
    replayGainAppliedDb: 0,
    replayGainPreventedClipping: false,
    currentFilePath: null,
    currentTrackId: null,
    currentTrackTitle: null,
    currentTrackArtist: null,
    currentTrackAlbum: null,
    currentTrackAlbumArtist: null,
    currentTrackCoverUrl: null,
    durationSeconds: 0,
    positionSeconds: 0,
    channels: null,
    codec: null,
    bitDepth: null,
    bitrate: null,
    fileSampleRate: null,
    decoderOutputSampleRate: null,
    requestedOutputSampleRate: null,
    actualDeviceSampleRate: null,
    sharedDeviceSampleRate: null,
    resampling: false,
    ffmpegPath: null,
    ffmpegSource: null,
    ffmpegVersion: null,
    ffmpegHealthy: false,
    soxrAvailable: false,
    resamplerEngine: 'default',
    resamplerFallbackActive: false,
    echoSrcMode: 'off',
    echoSrcQualityProfile: 'transparent',
    echoSrcTargetSampleRate: null,
    echoSrcActive: false,
    bitPerfectCandidate: false,
    sampleRateMismatch: false,
    latencyProfile: 'balanced',
    eqEnabled: false,
    roomCorrectionEnabled: false,
    channelBalanceEnabled: systemChannelBalanceActive(),
    dspActive: systemChannelBalanceActive(),
    preampDb: 0,
    eqPresetName: null,
    clippingRisk: false,
    bitPerfectDisabledReason: systemAudioWarning,
    sharedStabilityTier: null,
    nativeDeviceBufferFrames: null,
    nativeRequestedBufferFrames: null,
    nativeActualBufferFrames: null,
    nativeOutputLatencyMs: null,
    nativePositionStalenessMs: null,
    nativeFifoCapacityFrames: null,
    nativeStartupPrebufferFrames: null,
    nativeBufferedFrames: null,
    nativeBufferedMs: null,
    nativeUnderrunCallbacks: 0,
    nativeUnderrunFrames: 0,
    lastSharedStabilityRecoveryAt: null,
    warnings: [systemAudioWarning],
    error: null,
  });

  const finiteSeconds = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

  const getSystemDurationSeconds = (): number => {
    const elementDuration = finiteSeconds(systemAudioElement?.duration);
    const sourceDuration = finiteSeconds(systemAudioSource?.durationSeconds ?? undefined);
    const probeDuration = finiteSeconds(systemAudioSource?.probe?.durationSeconds);

    return elementDuration ?? sourceDuration ?? probeDuration ?? 0;
  };

  const getSystemPositionSeconds = (): number => finiteSeconds(systemAudioElement?.currentTime) ?? 0;

  const getSystemStatusPositionSeconds = (): number => {
    if (!systemAudioSource && (systemAudioState === 'idle' || systemAudioState === 'stopped')) {
      systemAudioStartupPositionGuard = null;
      return 0;
    }

    const actual = getSystemPositionSeconds();
    const guard = systemAudioStartupPositionGuard;

    if (!guard) {
      return actual;
    }

    const sameGeneration = guard.generation === systemPlaybackGeneration;
    const sameSource =
      systemAudioSource?.trackId === guard.trackId &&
      systemAudioSource?.filePath === guard.filePath;

    if (
      !sameGeneration ||
      !sameSource ||
      systemAudioState === 'idle' ||
      systemAudioState === 'stopped' ||
      systemAudioState === 'ended' ||
      systemAudioState === 'error'
    ) {
      systemAudioStartupPositionGuard = null;
      return actual;
    }

    const elapsedSeconds = Math.max(0, (performance.now() - guard.startedAtMs) / 1000);
    const guardExpired = elapsedSeconds * 1000 > systemAudioStartupPositionGuardMs;
    const expected = systemAudioState === 'playing'
      ? guard.expectedStartSeconds + elapsedSeconds * systemOutputSettings.playbackRate
      : guard.expectedStartSeconds;
    const actualLooksLikeOldPosition =
      Math.abs(actual - expected) > systemAudioStartupPositionToleranceSeconds;

    if (!guardExpired && actualLooksLikeOldPosition) {
      const duration = getSystemDurationSeconds();
      return duration > 0 ? Math.min(expected, duration) : Math.max(0, expected);
    }

    if (!actualLooksLikeOldPosition || guardExpired) {
      systemAudioStartupPositionGuard = null;
    }

    return actual;
  };

  const systemPositionMatches = (element: HTMLAudioElement, targetSeconds: number): boolean => {
    const currentSeconds = finiteSeconds(element.currentTime);
    return currentSeconds !== null && Math.abs(currentSeconds - targetSeconds) <= systemSeekToleranceSeconds;
  };

  const waitForSystemSeekConfirmed = (
    element: HTMLAudioElement,
    targetSeconds: number,
    generation: number,
  ): Promise<void> => {
    if (systemPositionMatches(element, targetSeconds)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
      let maybeResolve = (): void => undefined;
      let rejectForElementError = (): void => undefined;

      const cleanup = (): void => {
        if (timeoutId !== null) {
          globalThis.clearTimeout(timeoutId);
          timeoutId = null;
        }
        for (const event of systemSeekConfirmEvents) {
          element.removeEventListener(event, maybeResolve);
        }
        element.removeEventListener('error', rejectForElementError);
      };

      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      maybeResolve = (): void => {
        if (generation !== systemPlaybackGeneration) {
          finish(new Error(systemPlaybackSupersededMessage));
          return;
        }

        if (systemPositionMatches(element, targetSeconds)) {
          finish();
        }
      };

      rejectForElementError = (): void => {
        finish(new Error(createSystemAudioMediaErrorMessage(element, systemAudioError || 'system_audio_playback_failed')));
      };

      for (const event of systemSeekConfirmEvents) {
        element.addEventListener(event, maybeResolve);
      }
      element.addEventListener('error', rejectForElementError);
      timeoutId = globalThis.setTimeout(() => finish(new Error('system_audio_seek_timeout')), systemSeekConfirmTimeoutMs);
      maybeResolve();
    });
  };

  const createSystemAudioStatus = (): AudioStatus => {
    const base = lastNativeAudioStatus ?? createFallbackAudioStatus();
    const probe = systemAudioSource?.probe;
    const warnings = new Set([...(Array.isArray(base.warnings) ? base.warnings : []), systemAudioWarning]);

    return {
      ...base,
      host: 'ready',
      state: systemAudioState,
      outputDeviceId: null,
      outputDeviceName: systemAudioDeviceName,
      outputDeviceType: 'system',
      outputBackend: systemAudioOutputBackend,
      activeOutputBackendImpl: systemAudioBackendImpl,
      activeOutputBackendLabel: systemAudioBackendImpl,
      outputMode: 'system',
      sharedBackend: 'auto',
      backendContractVersion: audioBackendContractVersion,
      useNativeOutputRequested: false,
      useMiniaudioOutputRequested: false,
      useLibavDecodeRequested: false,
      activeDecodeBackendLabel: 'chromium-media',
      activeDecodeBackendImpl: 'chromium-media',
      dsdOutputModeRequested: 'pcm',
      activeDsdOutputMode: null,
      dsdNativeSampleRate: null,
      dsdTransportSampleRate: null,
      volume: systemOutputSettings.volume,
      playbackRate: systemOutputSettings.playbackRate,
      playbackSpeedMode: systemOutputSettings.playbackSpeedMode,
      replayGainEnabled: systemReplayGainEnabled,
      replayGainMode: systemReplayGainMode,
      replayGainAppliedDb: systemReplayGainCalculation.appliedDb,
      replayGainPreventedClipping: systemReplayGainCalculation.preventedClipping,
      currentFilePath: systemAudioSource?.filePath ?? null,
      currentTrackId: systemAudioSource?.trackId ?? null,
      currentTrackTitle: systemAudioSource?.metadata?.title ?? null,
      currentTrackArtist: systemAudioSource?.metadata?.artist ?? null,
      currentTrackAlbum: systemAudioSource?.metadata?.album ?? null,
      currentTrackAlbumArtist: systemAudioSource?.metadata?.albumArtist ?? null,
      currentTrackCoverUrl: systemAudioSource?.metadata?.coverUrl ?? null,
      durationSeconds: getSystemDurationSeconds(),
      positionSeconds: getSystemStatusPositionSeconds(),
      channels: probe?.channels ?? null,
      codec: probe?.codec ?? null,
      bitDepth: probe?.bitDepth ?? null,
      bitrate: probe?.bitrate ?? null,
      fileSampleRate: probe?.fileSampleRate ?? null,
      decoderOutputSampleRate: probe?.fileSampleRate ?? null,
      requestedOutputSampleRate: null,
      actualDeviceSampleRate: null,
      sharedDeviceSampleRate: null,
      resampling: false,
      echoSrcMode: 'off',
      echoSrcQualityProfile: 'transparent',
      echoSrcTargetSampleRate: null,
      echoSrcActive: false,
      bitPerfectCandidate: false,
      sampleRateMismatch: false,
      latencyProfile: 'balanced',
      eqEnabled: false,
      roomCorrectionEnabled: false,
      channelBalanceEnabled: systemChannelBalanceActive(),
      dspActive: systemChannelBalanceActive() || (systemReplayGainCalculation.active && Math.abs(systemReplayGainCalculation.appliedDb) >= 0.001),
      preampDb: 0,
      eqPresetName: null,
      clippingRisk: false,
      audioLevels: undefined,
      bitPerfectDisabledReason: systemAudioWarning,
      sharedStabilityTier: null,
      nativeDeviceBufferFrames: null,
      nativeRequestedBufferFrames: null,
      nativeActualBufferFrames: null,
      nativeOutputLatencyMs: null,
      nativePositionStalenessMs: null,
      nativeFifoCapacityFrames: null,
      nativeStartupPrebufferFrames: null,
      nativeBufferedFrames: null,
      nativeBufferedMs: null,
      nativeUnderrunCallbacks: 0,
      nativeUnderrunFrames: 0,
      lastSharedStabilityRecoveryAt: null,
      warnings: Array.from(warnings),
      error: systemAudioError,
    };
  };

  // Track change detection — emitted as part of every status update
  let lastEmittedTrackId: string | null = null;
  let lastEmittedFilePath: string | null = null;

  const emitTrackChangeIfNeeded = (): void => {
    const trackId = systemAudioSource?.trackId ?? null;
    const filePath = systemAudioSource?.filePath ?? null;
    if (trackId !== lastEmittedTrackId || filePath !== lastEmittedFilePath) {
      lastEmittedTrackId = trackId;
      lastEmittedFilePath = filePath;
      for (const handler of trackChangeHandlers) {
        handler(trackId, filePath);
      }
    }
  };

  const emitSystemAudioStatus = (): AudioStatus => {
    const status = createSystemAudioStatus();
    emitTrackChangeIfNeeded();
    for (const handler of audioStatusHandlers) {
      handler(status);
    }
    if (typeof ipcRenderer.send === 'function') {
      ipcRenderer.send(IpcChannels.DesktopLyricsRendererAudioStatus, status);
    }
    return status;
  };

  const startSystemStatusTimer = (): void => {
    if (systemAudioStatusTimer !== null) {
      return;
    }

    systemAudioStatusTimer = window.setInterval(() => {
      if (systemAudioModeActive && (systemAudioState === 'playing' || systemAudioState === 'loading')) {
        emitSystemAudioStatus();
      }
    }, 500);
  };

  const stopSystemStatusTimer = (): void => {
    if (systemAudioStatusTimer === null) {
      return;
    }

    window.clearInterval(systemAudioStatusTimer);
    systemAudioStatusTimer = null;
  };

  const releaseSystemObjectUrl = (): void => {
    if (systemAudioObjectUrl) {
      URL.revokeObjectURL(systemAudioObjectUrl);
      systemAudioObjectUrl = null;
    }
  };

  const replayGainLinearGain = (): number =>
    systemReplayGainCalculation.active && Math.abs(systemReplayGainCalculation.appliedDb) >= 0.001
      ? Math.max(0, Math.min(16, dbToLinearGain(systemReplayGainCalculation.appliedDb)))
      : 1;

  const systemChannelBalanceActive = (): boolean => systemChannelBalanceMonoMode !== 'off';

  const disconnectAudioNode = (node: AudioNode | null): void => {
    try {
      node?.disconnect();
    } catch {
      // The WebAudio graph is best-effort for system output DSP.
    }
  };

  const connectSystemAudioGraph = (): void => {
    if (!systemAudioContext || !systemAudioSourceNode || !systemAudioGainNode) {
      return;
    }

    disconnectAudioNode(systemAudioSourceNode);
    disconnectAudioNode(systemAudioSplitterNode);
    disconnectAudioNode(systemAudioMonoLeftGainNode);
    disconnectAudioNode(systemAudioMonoRightGainNode);
    disconnectAudioNode(systemAudioMonoMergerNode);
    disconnectAudioNode(systemAudioGainNode);

    if (!systemChannelBalanceActive()) {
      systemAudioSourceNode.connect(systemAudioGainNode);
      systemAudioGainNode.connect(systemAudioContext.destination);
      return;
    }

    systemAudioSplitterNode = systemAudioSplitterNode ?? systemAudioContext.createChannelSplitter(2);
    systemAudioMonoLeftGainNode = systemAudioMonoLeftGainNode ?? systemAudioContext.createGain();
    systemAudioMonoRightGainNode = systemAudioMonoRightGainNode ?? systemAudioContext.createGain();
    systemAudioMonoMergerNode = systemAudioMonoMergerNode ?? systemAudioContext.createChannelMerger(2);

    const leftGain =
      systemChannelBalanceMonoMode === 'right'
        ? 0
        : systemChannelBalanceMonoMode === 'sum'
          ? 0.5
          : 1;
    const rightGain =
      systemChannelBalanceMonoMode === 'left'
        ? 0
        : systemChannelBalanceMonoMode === 'sum'
          ? 0.5
          : 1;

    systemAudioMonoLeftGainNode.gain.value = leftGain;
    systemAudioMonoRightGainNode.gain.value = rightGain;
    systemAudioSourceNode.connect(systemAudioSplitterNode);
    systemAudioSplitterNode.connect(systemAudioMonoLeftGainNode, 0);
    systemAudioSplitterNode.connect(systemAudioMonoRightGainNode, 1);
    systemAudioMonoLeftGainNode.connect(systemAudioMonoMergerNode, 0, 0);
    systemAudioMonoRightGainNode.connect(systemAudioMonoMergerNode, 0, 1);

    if (systemChannelBalanceMonoMode === 'sum') {
      systemAudioMonoLeftGainNode.connect(systemAudioMonoMergerNode, 0, 1);
      systemAudioMonoRightGainNode.connect(systemAudioMonoMergerNode, 0, 0);
    }

    systemAudioMonoMergerNode.connect(systemAudioGainNode);
    systemAudioGainNode.connect(systemAudioContext.destination);
  };

  const applySystemChannelBalanceState = (state: Partial<ChannelBalanceState> | null | undefined): void => {
    const monoMode =
      state?.enabled === true && (state.monoMode === 'sum' || state.monoMode === 'left' || state.monoMode === 'right')
        ? state.monoMode
        : 'off';
    if (monoMode === systemChannelBalanceMonoMode) {
      return;
    }

    systemChannelBalanceMonoMode = monoMode;
    connectSystemAudioGraph();
    if (systemAudioModeActive) {
      emitSystemAudioStatus();
    }
  };

  const ensureSystemAudioGraph = (element: HTMLAudioElement): void => {
    if (systemAudioGainNode) {
      return;
    }

    const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      return;
    }

    try {
      systemAudioContext = systemAudioContext ?? new AudioContextConstructor();
      systemAudioSourceNode = systemAudioSourceNode ?? systemAudioContext.createMediaElementSource(element);
      systemAudioGainNode = systemAudioContext.createGain();
      connectSystemAudioGraph();
    } catch {
      systemAudioGainNode = null;
    }
  };

  const applySystemElementOutput = (): void => {
    if (!systemAudioElement) {
      return;
    }

    systemAudioElement.playbackRate = systemOutputSettings.playbackRate;
    const preservesPitch = systemOutputSettings.playbackSpeedMode === 'speed';
    const pitchElement = systemAudioElement as PitchControlAudioElement;
    pitchElement.preservesPitch = preservesPitch;
    pitchElement.mozPreservesPitch = preservesPitch;
    pitchElement.webkitPreservesPitch = preservesPitch;
    if (systemAudioGainNode) {
      systemAudioElement.volume = systemOutputSettings.volume;
      systemAudioGainNode.gain.value = replayGainLinearGain() * systemAudioTransportGain;
      return;
    }

    systemAudioElement.volume = Math.max(0, Math.min(1, systemOutputSettings.volume * replayGainLinearGain() * systemAudioTransportGain));
  };

  const setSystemAudioTransportGain = (gain: number): void => {
    systemAudioTransportGain = Math.max(0, Math.min(1, Number.isFinite(gain) ? gain : 1));
    applySystemElementOutput();
  };

  const cancelSystemAudioTransportFade = (restoreGain = true): void => {
    systemAudioFadeGeneration += 1;
    if (restoreGain) {
      setSystemAudioTransportGain(1);
    }
  };

  const waitForSystemAudioFadeStep = (durationMs: number): Promise<void> =>
    new Promise((resolve) => {
      globalThis.setTimeout(resolve, Math.max(0, durationMs));
    });

  type SystemAudioTransportFadeSettings = {
    enabled: boolean;
    durationMs: number;
    curve: AudioTransportFadeCurve;
  };

  const normalizeSystemAudioTransportFadeDurationMs = (value: unknown, fallback = 80): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Math.round(Math.max(0, Math.min(2000, numeric)))
      : fallback;
  };

  const normalizeSystemAudioTransportFadeCurve = (value: unknown): AudioTransportFadeCurve =>
    audioTransportFadeCurves.has(value as AudioTransportFadeCurve)
      ? (value as AudioTransportFadeCurve)
      : 'smooth';

  const applySystemAudioTransportFadeCurve = (progress: number, curve: AudioTransportFadeCurve): number => {
    const clamped = Math.max(0, Math.min(1, progress));
    if (curve === 'equalPower') {
      return Math.sin((clamped * Math.PI) / 2);
    }
    if (curve === 'smooth') {
      return clamped * clamped * (3 - (2 * clamped));
    }

    return clamped;
  };

  const applySystemAudioTransportFadeSettings = (settings: Partial<AppSettings> | null | undefined): void => {
    systemAudioTransportFadeEnabled = settings?.audioTransportFadeEnabled === true;
    systemAudioTransportFadeInMs = normalizeSystemAudioTransportFadeDurationMs(settings?.audioTransportFadeInMs);
    systemAudioTransportFadeOutMs = normalizeSystemAudioTransportFadeDurationMs(settings?.audioTransportFadeOutMs);
    systemAudioTransportFadeCurve = normalizeSystemAudioTransportFadeCurve(settings?.audioTransportFadeCurve);
  };

  const getSystemAudioTransportFadeSettings = (direction: 'in' | 'out'): SystemAudioTransportFadeSettings => {
    const durationMs = direction === 'in' ? systemAudioTransportFadeInMs : systemAudioTransportFadeOutMs;
    return {
      enabled: systemAudioTransportFadeEnabled && durationMs > 0,
      durationMs,
      curve: systemAudioTransportFadeCurve,
    };
  };

  const refreshSystemTransportFadeSettings = async (): Promise<void> => {
    try {
      applySystemAudioTransportFadeSettings(await ipcRenderer.invoke(IpcChannels.AppGetSettings) as AppSettings);
    } catch {
      applySystemAudioTransportFadeSettings(null);
    }
  };

  const fadeSystemAudioTransportGain = async (
    fromGain: number,
    toGain: number,
    playbackGeneration: number,
    settings: SystemAudioTransportFadeSettings,
  ): Promise<boolean> => {
    if (!settings.enabled || settings.durationMs <= 0) {
      setSystemAudioTransportGain(toGain);
      return true;
    }

    const generation = systemAudioFadeGeneration + 1;
    systemAudioFadeGeneration = generation;
    const startGain = Math.max(0, Math.min(1, Number.isFinite(fromGain) ? fromGain : 1));
    const endGain = Math.max(0, Math.min(1, Number.isFinite(toGain) ? toGain : 1));
    const steps = Math.max(1, Math.ceil(settings.durationMs / systemAudioTransportFadeStepMs));

    for (let step = 0; step <= steps; step += 1) {
      if (generation !== systemAudioFadeGeneration || playbackGeneration !== systemPlaybackGeneration) {
        return false;
      }

      const progress = applySystemAudioTransportFadeCurve(step / steps, settings.curve);
      setSystemAudioTransportGain(startGain + ((endGain - startGain) * progress));

      if (step < steps) {
        await waitForSystemAudioFadeStep(systemAudioTransportFadeStepMs);
      }
    }

    return true;
  };

  const refreshSystemReplayGain = async (source: SystemPlaybackSource): Promise<void> => {
    let settings: Partial<AppSettings> | null = null;
    try {
      settings = await ipcRenderer.invoke(IpcChannels.AppGetSettings) as AppSettings;
    } catch {
      settings = null;
    }

    applySystemAudioTransportFadeSettings(settings);
    systemReplayGainEnabled = settings?.replayGainEnabled === true;
    systemReplayGainMode = settings?.replayGainMode ?? 'track';
    systemReplayGainTargetLufs = settings?.replayGainTargetLufs ?? DEFAULT_REPLAY_GAIN_TARGET_LUFS;
    systemReplayGainCalculation = calculateReplayGain({
      ...(source.replayGain ?? {}),
      enabled: systemReplayGainEnabled,
      mode: systemReplayGainMode,
      targetLufs: systemReplayGainTargetLufs,
      preampDb: settings?.replayGainPreampDb ?? 0,
      preventClipping: settings?.replayGainPreventClipping !== false,
    });
    applySystemChannelBalanceState(settings?.channelBalance);
  };

  const applySystemOutputSettings = (settings: Partial<AudioOutputSettings> | null | undefined, base?: AudioStatus | null): void => {
    const nextVolume = typeof settings?.volume === 'number' && Number.isFinite(settings.volume)
      ? Math.max(0, Math.min(1, settings.volume))
      : base?.volume;
    const nextPlaybackRate = typeof settings?.playbackRate === 'number' && Number.isFinite(settings.playbackRate)
      ? Math.max(0.5, Math.min(2, settings.playbackRate))
      : base?.playbackRate;
    const nextPlaybackSpeedMode: PlaybackSpeedMode =
      settings?.playbackSpeedMode === 'daycore' || settings?.playbackSpeedMode === 'speed'
        ? settings.playbackSpeedMode
        : base?.playbackSpeedMode ?? systemOutputSettings.playbackSpeedMode;

    systemOutputSettings = {
      volume: nextVolume ?? systemOutputSettings.volume,
      playbackRate: nextPlaybackRate ?? systemOutputSettings.playbackRate,
      playbackSpeedMode: nextPlaybackSpeedMode,
    };

    applySystemElementOutput();
  };

  const toSystemPlaybackStatus = (): PlaybackStatus => ({
    state: systemAudioState,
    currentTrackId: systemAudioSource?.trackId ?? null,
    positionMs: Math.round(getSystemStatusPositionSeconds() * 1000),
    durationMs: Math.round(getSystemDurationSeconds() * 1000),
    filePath: systemAudioSource?.filePath ?? null,
  });

  const finishInterruptedSystemPlayback = (generation: number, element: HTMLAudioElement): PlaybackStatus => {
    if (generation === systemPlaybackGeneration) {
      cancelSystemAudioTransportFade();
      systemAudioError = null;
      if (element.paused && systemAudioState !== 'stopped' && systemAudioState !== 'idle' && systemAudioState !== 'ended') {
        systemAudioState = 'paused';
      }
      if (systemAudioState !== 'playing' && systemAudioState !== 'loading') {
        stopSystemStatusTimer();
      }
      emitSystemAudioStatus();
    }

    return toSystemPlaybackStatus();
  };

  const ensureSystemAudioElement = (): HTMLAudioElement => {
    if (systemAudioElement) {
      return systemAudioElement;
    }

    const element = new Audio();
    element.preload = 'auto';
    element.addEventListener('loadstart', () => {
      systemAudioState = 'loading';
      systemAudioError = null;
      emitSystemAudioStatus();
    });
    element.addEventListener('loadedmetadata', () => emitSystemAudioStatus());
    element.addEventListener('playing', () => {
      systemAudioState = 'playing';
      systemAudioError = null;
      startSystemStatusTimer();
      emitSystemAudioStatus();
    });
    element.addEventListener('canplay', () => {
      if (systemAudioState === 'loading' && !element.paused && !element.ended) {
        systemAudioState = 'playing';
        systemAudioError = null;
        startSystemStatusTimer();
        emitSystemAudioStatus();
      }
    });
    const markSystemAudioWaiting = (): void => {
      if (!isSystemNetworkMediaPlayback() || element.paused || element.ended || systemAudioState === 'error' || systemAudioState === 'stopped') {
        return;
      }

      systemAudioState = 'loading';
      startSystemStatusTimer();
      emitSystemAudioStatus();
    };
    element.addEventListener('waiting', markSystemAudioWaiting);
    element.addEventListener('stalled', markSystemAudioWaiting);
    element.addEventListener('pause', () => {
      if (!element.paused) {
        return;
      }

      if (systemAudioState !== 'stopped' && systemAudioState !== 'ended' && systemAudioState !== 'error') {
        systemAudioState = 'paused';
      }
      stopSystemStatusTimer();
      emitSystemAudioStatus();
    });
    element.addEventListener('ended', () => {
      const endedAfterBrowserPause = systemAudioState === 'paused' && element.ended === true;
      if (systemAudioState !== 'playing' && systemAudioState !== 'loading' && !endedAfterBrowserPause) {
        return;
      }

      const endedPositionSeconds = getSystemPositionSeconds();
      const durationSeconds = getSystemDurationSeconds();
      const premature =
        isLocalSystemSource(systemAudioSource) &&
        durationSeconds > 0 &&
        endedPositionSeconds < durationSeconds - systemPrematureEndToleranceSeconds;
      const clearlyCorrupt = premature && isClearlyCorruptSystemEnd(endedPositionSeconds, durationSeconds);
      if (clearlyCorrupt) {
        systemAudioState = 'error';
        systemAudioError = createSystemAudioPrematureEndMessage(endedPositionSeconds, durationSeconds);
        stopSystemStatusTimer();
        emitSystemAudioStatus();
        reportSystemPlaybackError({
          phase: 'system-audio-ended-before-duration',
          message: systemAudioError,
          recovered: false,
          ...mediaRequestDiagnostics(systemMediaPlaybackContext?.request ?? null),
          ...createSystemPlaybackErrorReportBase(systemAudioSource),
          trackId: systemAudioSource?.trackId ?? null,
          recoveryAttempt: systemMediaPlaybackContext?.recoveryAttempts ?? 0,
          maxRecoveryAttempts: maxSystemMediaRecoveryAttempts,
          htmlAudio: htmlAudioDiagnostics(),
        });
        return;
      }
      if (premature) {
        reportSystemPlaybackError({
          phase: 'system-audio-ended-before-reported-duration',
          message: createSystemAudioLooseDurationMessage(endedPositionSeconds, durationSeconds),
          recovered: true,
          ...mediaRequestDiagnostics(systemMediaPlaybackContext?.request ?? null),
          ...createSystemPlaybackErrorReportBase(systemAudioSource),
          trackId: systemAudioSource?.trackId ?? null,
          recoveryAttempt: systemMediaPlaybackContext?.recoveryAttempts ?? 0,
          maxRecoveryAttempts: maxSystemMediaRecoveryAttempts,
          htmlAudio: htmlAudioDiagnostics(),
        });
      }
      systemAudioState = 'ended';
      stopSystemStatusTimer();
      emitSystemAudioStatus();
    });
    element.addEventListener('error', () => {
      if (!systemAudioSource && (systemAudioState === 'stopped' || systemAudioState === 'idle')) {
        return;
      }
      systemAudioState = 'error';
      systemAudioError = createSystemAudioMediaErrorMessage(element);
      stopSystemStatusTimer();
      emitSystemAudioStatus();
      void handleSystemPlaybackFailure('system-audio-htmlaudio-error', new Error(systemAudioError), systemPlaybackGeneration);
    });
    element.addEventListener('timeupdate', () => emitSystemAudioStatus());

    systemAudioElement = element;
    applySystemOutputSettings(null);
    return element;
  };

  const resolveSystemSourceUrl = async (source: SystemPlaybackSource): Promise<string> => {
    releaseSystemObjectUrl();

    const trimmed = source.filePath.trim();
    if (isRendererReadyUrl(trimmed)) {
      return trimmed;
    }

    return ipcRenderer.invoke(IpcChannels.AudioCreateSystemStreamUrl, {
      url: trimmed,
      headers: isHttpUrl(trimmed) ? source.inputHeaders : undefined,
      mimeType: source.mimeType ?? null,
    }) as Promise<string>;
  };

  const playSystemSource = async (
    source: SystemPlaybackSource,
    startSeconds: number | undefined,
    options: {
      generation: number;
      request?: PlaybackMediaStartRequest | null;
      allowRecovery?: boolean;
    },
  ): Promise<PlaybackStatus> => {
    const { generation, request = null, allowRecovery = true } = options;
    const safeStartSeconds = finiteSeconds(startSeconds) ?? 0;
    systemAudioStartupPositionGuard = {
      generation,
      trackId: source.trackId ?? null,
      filePath: source.filePath,
      expectedStartSeconds: safeStartSeconds,
      startedAtMs: performance.now(),
    };
    systemAudioModeActive = true;
    systemAudioSource = source;
    systemAudioState = 'loading';
    systemAudioError = null;
    if (request) {
      if (!systemMediaPlaybackContext || systemMediaPlaybackContext.generation !== generation) {
        systemMediaPlaybackContext = {
          request,
          generation,
          recoveryAttempts: 0,
          recovering: false,
          source,
        };
      } else {
        systemMediaPlaybackContext.request = request;
        systemMediaPlaybackContext.source = source;
      }
    } else if (systemMediaPlaybackContext?.generation !== generation) {
      systemMediaPlaybackContext = null;
    }

    const element = ensureSystemAudioElement();
    cancelSystemAudioTransportFade();
    await refreshSystemReplayGain(source);
    ensureSystemAudioGraph(element);
    await systemAudioContext?.resume?.().catch(() => undefined);
    const sourceUrl = await resolveSystemSourceUrl(source);
    if (generation !== systemPlaybackGeneration) {
      throw new Error(systemPlaybackSupersededMessage);
    }
    element.pause();
    element.src = sourceUrl;
    applySystemElementOutput();
    element.load();

    try {
      element.currentTime = safeStartSeconds;
    } catch {
      // Some HTTP streams reject seeking before metadata is ready; playback can still start.
    }
    emitSystemAudioStatus();

    try {
      await element.play();
      if (generation !== systemPlaybackGeneration) {
        throw new Error(systemPlaybackSupersededMessage);
      }
      systemAudioState = 'playing';
      systemAudioError = null;
      startSystemStatusTimer();
      emitSystemAudioStatus();
    } catch (error) {
      if (generation !== systemPlaybackGeneration || isExpectedSystemPlaybackInterruption(error)) {
        return finishInterruptedSystemPlayback(generation, element);
      }
      if (allowRecovery) {
        const recovered = await handleSystemPlaybackFailure('system-audio-htmlaudio-error', error, generation);
        if (recovered) {
          return recovered;
        }
      }
      systemAudioState = 'error';
      systemAudioError = error instanceof Error ? error.message : String(error);
      emitSystemAudioStatus();
      throw error;
    }

    return toSystemPlaybackStatus();
  };

  const createSystemPlaybackSourceFromNativeStatus = (status: AudioStatus | null): SystemPlaybackSource | null => {
    if (!status) {
      return null;
    }

    const filePath = status.currentFilePath?.trim();
    if (!filePath) {
      return null;
    }

    return {
      filePath,
      probe: {
        durationSeconds: finiteSeconds(status.durationSeconds) ?? undefined,
        fileSampleRate: status.fileSampleRate,
        channels: status.channels ?? undefined,
        codec: status.codec,
        bitDepth: status.bitDepth,
        bitrate: status.bitrate,
      },
      durationSeconds: finiteSeconds(status.durationSeconds),
      trackId: status.currentTrackId ?? null,
      metadata: {
        title: status.currentTrackTitle ?? null,
        artist: status.currentTrackArtist ?? null,
        album: status.currentTrackAlbum ?? null,
        albumArtist: status.currentTrackAlbumArtist ?? null,
        coverUrl: status.currentTrackCoverUrl ?? null,
      },
      mimeType: null,
      replayGain: null,
    };
  };

  const canHandoffNativeStatusToSystemAudio = (status: AudioStatus | null): boolean =>
    Boolean(
      createSystemPlaybackSourceFromNativeStatus(status) &&
        (status?.state === 'playing' || status?.state === 'loading'),
    );

  const handoffNativePlaybackToSystemAudio = async (status: AudioStatus | null): Promise<AudioStatus | null> => {
    if (!isMainPlaybackRenderer || !canHandoffNativeStatusToSystemAudio(status)) {
      return null;
    }

    const source = createSystemPlaybackSourceFromNativeStatus(status);
    if (!source) {
      return null;
    }

    const generation = nextSystemPlaybackGeneration();
    await ipcRenderer.invoke(IpcChannels.PlaybackStop).catch(() => undefined);
    await playSystemSource(source, status?.positionSeconds, {
      generation,
      request: null,
      allowRecovery: true,
    });
    return createSystemAudioStatus();
  };

  const handleSystemPlaybackFailure = async (
    phase: string,
    error: unknown,
    generation: number,
  ): Promise<PlaybackStatus | null> => {
    const message = errorMessage(error);
    if (generation !== systemPlaybackGeneration || isExpectedSystemPlaybackInterruption(error)) {
      return null;
    }

    const context = systemMediaPlaybackContext;
    const canRefreshMedia =
      context &&
      context.generation === generation &&
      !context.recovering &&
      context.recoveryAttempts < maxSystemMediaRecoveryAttempts &&
      (context.request.item.mediaType === 'streaming' || context.request.item.mediaType === 'remote');

    if (!canRefreshMedia) {
      reportSystemPlaybackError({
        phase,
        message,
        recovered: false,
        ...mediaRequestDiagnostics(context?.request ?? null),
        ...createSystemPlaybackErrorReportBase(context?.source ?? systemAudioSource),
        recoveryAttempt: context?.recoveryAttempts ?? 0,
        maxRecoveryAttempts: maxSystemMediaRecoveryAttempts,
        htmlAudio: htmlAudioDiagnostics(),
      });
      return null;
    }

    context.recovering = true;
    context.recoveryAttempts += 1;
    const recoveryAttempt = context.recoveryAttempts;
    const startSeconds = getSystemPositionSeconds();

    try {
      const retryRequest: PlaybackMediaStartRequest = {
        ...context.request,
        startSeconds,
        forceRefresh: true,
      };
      const resolved = await ipcRenderer.invoke(IpcChannels.PlaybackResolveMediaItem, retryRequest) as PlaybackResolvedMediaSource;
      if (systemMediaPlaybackContext !== context || generation !== systemPlaybackGeneration) {
        return null;
      }

      const recoveredStatus = await playSystemSource(
        {
          ...resolved,
          trackId: context.request.item.trackId,
          metadata: {
            title: context.request.item.title,
            artist: context.request.item.artist,
            album: context.request.item.album,
            albumArtist: context.request.item.albumArtist,
            coverUrl: context.request.item.coverThumb,
          },
          replayGain: context.request.item.replayGain ?? null,
        },
        startSeconds,
        { generation, request: context.request, allowRecovery: false },
      );
      if (systemMediaPlaybackContext !== context || generation !== systemPlaybackGeneration) {
        return null;
      }

      reportSystemPlaybackError({
        phase,
        message,
        recovered: true,
        ...mediaRequestDiagnostics(context.request),
        ...createSystemPlaybackErrorReportBase(context.source),
        recoveryAttempt,
        maxRecoveryAttempts: maxSystemMediaRecoveryAttempts,
        htmlAudio: htmlAudioDiagnostics(),
      });
      return recoveredStatus;
    } catch (recoveryError) {
      if (systemMediaPlaybackContext === context && generation === systemPlaybackGeneration) {
        const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
        reportSystemPlaybackError({
          phase: 'system-audio-recovery-failed',
          message: `${message}; retry="${recoveryMessage}"`,
          recovered: false,
          ...mediaRequestDiagnostics(context.request),
          ...createSystemPlaybackErrorReportBase(context.source),
          recoveryAttempt,
          maxRecoveryAttempts: maxSystemMediaRecoveryAttempts,
          htmlAudio: htmlAudioDiagnostics(),
        });
      }
      return null;
    } finally {
      if (systemMediaPlaybackContext === context) {
        context.recovering = false;
      }
    }
  };

  const stopSystemPlayback = (
    state: Extract<AudioStatus['state'], 'stopped' | 'idle'> = 'stopped',
    emitStatus = true,
  ): PlaybackStatus => {
    nextSystemPlaybackGeneration();
    systemAudioStartupPositionGuard = null;
    cancelSystemAudioTransportFade();
    systemMediaPlaybackContext = null;
    stopSystemStatusTimer();
    if (systemAudioElement) {
      systemAudioElement.pause();
      systemAudioElement.removeAttribute('src');
      systemAudioElement.load();
    }
    releaseSystemObjectUrl();
    systemAudioSource = null;
    systemReplayGainCalculation = {
      appliedDb: 0,
      selectedGainDb: null,
      selectedPeak: null,
      preventedClipping: false,
      active: false,
    };
    systemAudioState = state;
    systemAudioError = null;
    if (emitStatus) {
      emitSystemAudioStatus();
    }
    return toSystemPlaybackStatus();
  };

  // -----------------------------------------------------------------------
  // Decision helpers
  // -----------------------------------------------------------------------

  const isSystemOutputRequest = (settings: unknown): boolean =>
    Boolean(settings && typeof settings === 'object' && (settings as Partial<AudioOutputSettings>).outputMode === 'system');

  const refreshSystemAudioModeActive = async (): Promise<boolean> => {
    if (systemAudioModeActive) {
      return true;
    }

    try {
      const status = await ipcRenderer.invoke(IpcChannels.AudioGetStatus) as AudioStatus;
      lastNativeAudioStatus = status;
      applySystemOutputSettings(null, status);
      if (status.outputMode === 'system') {
        systemAudioModeActive = true;
        return true;
      }
    } catch {
      // If the native status query fails, fall back to the normal playback IPC path.
    }

    return false;
  };

  const isExplicitNativeOutputRequest = (settings: unknown): boolean =>
    Boolean(
      settings &&
        typeof settings === 'object' &&
        Object.prototype.hasOwnProperty.call(settings, 'outputMode') &&
        (settings as Partial<AudioOutputSettings>).outputMode !== undefined &&
        (settings as Partial<AudioOutputSettings>).outputMode !== 'system',
    );

  const requiresNativeChainedPlayback = (request: Pick<PlaybackStartRequest, 'automix' | 'gapless'>): boolean =>
    (request.automix?.enabled === true && Boolean(request.automix.nextItem)) ||
    (request.gapless?.enabled === true && Boolean(request.gapless.nextItem));

  const requiresNativeSystemLocalPlayback = (request: Pick<PlaybackStartRequest, 'filePath'>): boolean =>
    isNativePreferredSystemLocalPath(request.filePath);

  const requiresNativeSystemMediaPlayback = (request: PlaybackMediaStartRequest): boolean =>
    request.item.mediaType === 'local' && isNativePreferredSystemLocalPath(request.item.path);

  const withNativeSharedOutput = <T extends { output?: AudioOutputSettings }>(request: T): T => ({
    ...request,
    output: {
      ...(request.output ?? {}),
      outputMode: 'shared',
    },
  });

  const withNativeSystemFallbackOutput = <T extends { output?: AudioOutputSettings }>(request: T): T => {
    if (request.output?.outputMode && request.output.outputMode !== 'system') {
      return request;
    }

    return withNativeSharedOutput(request);
  };

  const shouldUseSystemAudioMode = (): boolean =>
    systemAudioModeActive || lastNativeAudioStatus?.outputMode === 'system';

  const shouldUseSystemAudioForPlayback = async (output?: AudioOutputSettings): Promise<boolean> => {
    if (isSystemOutputRequest(output) || shouldUseSystemAudioMode()) {
      return true;
    }

    return refreshSystemAudioModeActive();
  };

  const playLocalFileWithSystemAudio = (request: PlaybackStartRequest): Promise<PlaybackStatus> => {
    const generation = nextSystemPlaybackGeneration();
    return playSystemSource(
      {
        filePath: request.filePath,
        probe: request.probe,
        durationSeconds: request.probe?.durationSeconds ?? null,
        trackId: request.trackId ?? null,
        metadata: request.metadata,
        mimeType: null,
        replayGain: request.replayGain ?? null,
      },
      request.startSeconds,
      { generation, request: null, allowRecovery: true },
    );
  };

  const playMediaItemWithSystemAudio = async (request: PlaybackMediaStartRequest): Promise<PlaybackStatus> => {
    const generation = nextSystemPlaybackGeneration();
    const resolved = await ipcRenderer.invoke(IpcChannels.PlaybackResolveMediaItem, request) as PlaybackResolvedMediaSource;
    if (generation !== systemPlaybackGeneration) {
      throw new Error(systemPlaybackSupersededMessage);
    }
    return playSystemSource({
      ...resolved,
      trackId: request.item.trackId,
      metadata: {
        title: request.item.title,
        artist: request.item.artist,
        album: request.item.album,
        albumArtist: request.item.albumArtist,
        coverUrl: request.item.coverThumb,
      },
      replayGain: request.item.replayGain ?? null,
    }, request.startSeconds, {
      generation,
      request,
      allowRecovery: true,
    });
  };

  // -----------------------------------------------------------------------
  // Higher-level playback control (used by echoApi.playback.*)
  // -----------------------------------------------------------------------

  const play = async (): Promise<PlaybackStatus> => {
    const element = ensureSystemAudioElement();
    if (!element.src) {
      return toSystemPlaybackStatus();
    }
    await refreshSystemTransportFadeSettings();
    const fadeInSettings = getSystemAudioTransportFadeSettings('in');
    if (element.paused) {
      const generation = systemPlaybackGeneration;
      setSystemAudioTransportGain(fadeInSettings.enabled ? 0 : 1);
      try {
        await element.play();
      } catch (error) {
        cancelSystemAudioTransportFade();
        throw error;
      }
      if (generation !== systemPlaybackGeneration) {
        return toSystemPlaybackStatus();
      }
      systemAudioState = 'playing';
      startSystemStatusTimer();
      emitSystemAudioStatus();
      await fadeSystemAudioTransportGain(systemAudioTransportGain, 1, generation, fadeInSettings);
      return toSystemPlaybackStatus();
    }
    setSystemAudioTransportGain(1);
    systemAudioState = 'playing';
    startSystemStatusTimer();
    emitSystemAudioStatus();
    return toSystemPlaybackStatus();
  };

  const pause = async (): Promise<PlaybackStatus> => {
    const element = ensureSystemAudioElement();
    await refreshSystemTransportFadeSettings();
    const fadeOutSettings = getSystemAudioTransportFadeSettings('out');
    if (!element.paused && systemAudioState === 'playing') {
      const generation = systemPlaybackGeneration;
      if (fadeOutSettings.enabled) {
        await fadeSystemAudioTransportGain(systemAudioTransportGain, 0, generation, fadeOutSettings);
      }
      if (generation !== systemPlaybackGeneration) {
        return toSystemPlaybackStatus();
      }
    }
    element.pause();
    systemAudioState = 'paused';
    stopSystemStatusTimer();
    emitSystemAudioStatus();
    return toSystemPlaybackStatus();
  };

  const stop = async (): Promise<PlaybackStatus> => stopSystemPlayback('stopped');

  const seek = async (positionSeconds: unknown): Promise<PlaybackStatus> => {
    const element = ensureSystemAudioElement();
    const durationSeconds = getSystemDurationSeconds();
    const requestedPositionSeconds = Number.isFinite(Number(positionSeconds)) ? Number(positionSeconds) : 0;
    const safePositionSeconds =
      durationSeconds > 0
        ? Math.min(durationSeconds, Math.max(0, requestedPositionSeconds))
        : Math.max(0, requestedPositionSeconds);
    try {
      element.currentTime = safePositionSeconds;
      await waitForSystemSeekConfirmed(element, safePositionSeconds, systemPlaybackGeneration);
      systemAudioError = null;
    } catch (error) {
      systemAudioError = error instanceof Error ? error.message : String(error);
      emitSystemAudioStatus();
      throw error;
    }
    emitSystemAudioStatus();
    return toSystemPlaybackStatus();
  };

  // -----------------------------------------------------------------------
  // Public API — handler registration
  // -----------------------------------------------------------------------

  const onAudioStatus = (handler: (status: AudioStatus) => void): (() => void) => {
    audioStatusHandlers.add(handler);
    return () => {
      audioStatusHandlers.delete(handler);
    };
  };

  const onTrackChange = (
    handler: (trackId: string | null, filePath: string | null) => void,
  ): (() => void) => {
    trackChangeHandlers.add(handler);
    return () => {
      trackChangeHandlers.delete(handler);
    };
  };

  const onLocalAudioFilesOpened = (handler: (paths: string[]) => void): (() => void) => {
    localAudioFileOpenHandlers.add(handler);
    for (const paths of pendingLocalAudioFileOpenEvents.splice(0)) {
      handler(paths);
    }
    return () => {
      localAudioFileOpenHandlers.delete(handler);
    };
  };

  const onAutomixAdvance = (handler: (event: AutomixAdvancePayload) => void): (() => void) => {
    automixAdvanceHandlers.add(handler);
    return () => {
      automixAdvanceHandlers.delete(handler);
    };
  };

  // -----------------------------------------------------------------------
  // Return public API
  // -----------------------------------------------------------------------

  return {
    onAudioStatus,
    onTrackChange,
    onLocalAudioFilesOpened,
    onAutomixAdvance,
    getSystemAudioStatus: createSystemAudioStatus,
    getSystemPlaybackStatus: toSystemPlaybackStatus,
    get lastNativeAudioStatus() {
      return lastNativeAudioStatus;
    },
    set lastNativeAudioStatus(value: AudioStatus | null) {
      lastNativeAudioStatus = value;
    },
    get systemAudioModeActive() {
      return systemAudioModeActive;
    },
    set systemAudioModeActive(active: boolean) {
      systemAudioModeActive = active;
    },
    handoffNativePlaybackToSystemAudio,
    stopSystemPlayback,
    refreshSystemAudioModeActive,
    play,
    pause,
    stop,
    seek,
    playLocalFileWithSystemAudio,
    playMediaItemWithSystemAudio,
    shouldUseSystemAudioForPlayback,
    requiresNativeChainedPlayback,
    requiresNativeSystemLocalPlayback,
    requiresNativeSystemMediaPlayback,
    isExplicitNativeOutputRequest,
    applySystemOutputSettings,
    applySystemChannelBalanceState,
    readPersistedSystemAudioMode,
  };
}
