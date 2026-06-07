import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IpcChannels } from '../shared/constants/ipcChannels';
import type { EchoApi } from './apiTypes';
import type { AudioOutputSettings, AudioStatus, ChannelBalanceMonoMode, ChannelBalanceState, PlaybackSpeedMode } from '../shared/types/audio';
import type { RoomCorrectionState } from '../shared/types/eq';
import type { AppSettings, AudioTransportFadeCurve, ReplayGainMode } from '../shared/types/appSettings';
import type { GlobalShortcutAction } from '../shared/types/globalShortcuts';
import type {
  PlaybackMediaStartRequest,
  PlaybackResolvedMediaSource,
  PlaybackStartRequest,
  PlaybackStatus,
} from '../shared/types/playback';
import type { SmtcCommand, SmtcLyricsProgress } from '../shared/types/smtc';
import type { UpdateStatus } from '../shared/types/updates';
import type { DiagnosticConsoleEntry } from '../shared/types/diagnostics';
import type { DataBackupProgress } from '../shared/types/settingsBackup';
import type { SleepTimerStatus, SleepTimerStartRequest } from '../shared/types/sleepTimer';
import { calculateReplayGain, dbToLinearGain, type ReplayGainCalculation, type ReplayGainTrackData } from '../shared/utils/replayGain';
import { DEFAULT_REPLAY_GAIN_TARGET_LUFS } from '../shared/constants/replayGain';

const sanitizePathList = (paths: unknown): string[] =>
  Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : [];

const localAudioFileOpenHandlers = new Set<(paths: string[]) => void>();
const pendingLocalAudioFileOpenEvents: string[][] = [];
type AutomixAdvancePayload = {
  fromTrackId: string | null;
  toTrackId: string;
  transitionSeconds: number;
  mode?: 'smartCrossfade' | 'beatAligned' | 'energyFade' | 'gaplessFallback';
  fallbackReason?: string | null;
  beatAligned?: boolean;
  skipIntroSilence?: boolean;
  nextStartSeconds?: number;
};
const automixAdvanceHandlers = new Set<(event: AutomixAdvancePayload) => void>();

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
const audioStatusHandlers = new Set<(status: AudioStatus) => void>();
const playbackProxyCommands = new Set(['playLocalFile', 'playMediaItem', 'play', 'pause', 'stop', 'seek']);
const rendererSearchParams = new URLSearchParams(typeof window.location?.search === 'string' ? window.location.search : '');
const isMainPlaybackRenderer =
  rendererSearchParams.get('miniPlayer') !== '1' && rendererSearchParams.get('desktopLyrics') !== '1';
type MainPlaybackCommand = 'playLocalFile' | 'playMediaItem' | 'play' | 'pause' | 'stop' | 'seek';

const invokeMainPlaybackRenderer = <Result>(command: MainPlaybackCommand, args: unknown[] = []): Promise<Result> =>
  ipcRenderer.invoke(IpcChannels.PlaybackMainWindowCommand, { command, args }) as Promise<Result>;

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

const isHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value.trim());
const systemAudioTransportFadeStepMs = 10;
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
  outputMode: 'system',
  sharedBackend: 'auto',
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
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
  asioOutputChannelStart: null,
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
    outputMode: 'system',
    sharedBackend: 'auto',
    useJuceOutputRequested: false,
    useJuceDecodeRequested: false,
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
    positionSeconds: getSystemPositionSeconds(),
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
    asioOutputChannelStart: null,
    lastSharedStabilityRecoveryAt: null,
    warnings: Array.from(warnings),
    error: systemAudioError,
  };
};

const emitSystemAudioStatus = (): AudioStatus => {
  const status = createSystemAudioStatus();
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
  positionMs: Math.round(getSystemPositionSeconds() * 1000),
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
  emitSystemAudioStatus();

  const safeStartSeconds = finiteSeconds(startSeconds) ?? 0;
  try {
    element.currentTime = safeStartSeconds;
  } catch {
    // Some HTTP streams reject seeking before metadata is ready; playback can still start.
  }

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

const isSystemOutputRequest = (settings: unknown): boolean =>
  Boolean(settings && typeof settings === 'object' && (settings as Partial<AudioOutputSettings>).outputMode === 'system');

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

ipcRenderer.on(IpcChannels.PlaybackLocalAudioFilesOpened, (_event: Electron.IpcRendererEvent, paths: unknown): void => {
  const safePaths = sanitizePathList(paths);
  if (safePaths.length === 0) {
    return;
  }

  if (localAudioFileOpenHandlers.size === 0) {
    pendingLocalAudioFileOpenEvents.push(safePaths);
    return;
  }

  for (const handler of localAudioFileOpenHandlers) {
    handler(safePaths);
  }
});

ipcRenderer.on(IpcChannels.PlaybackAutomixAdvance, (_event: Electron.IpcRendererEvent, payload: unknown): void => {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const event = payload as {
    fromTrackId?: unknown;
    toTrackId?: unknown;
    transitionSeconds?: unknown;
    mode?: unknown;
    fallbackReason?: unknown;
    beatAligned?: unknown;
    skipIntroSilence?: unknown;
    nextStartSeconds?: unknown;
  };
  if (typeof event.toTrackId !== 'string') {
    return;
  }

  for (const handler of automixAdvanceHandlers) {
    handler({
      fromTrackId: typeof event.fromTrackId === 'string' ? event.fromTrackId : null,
      toTrackId: event.toTrackId,
      transitionSeconds: typeof event.transitionSeconds === 'number' && Number.isFinite(event.transitionSeconds)
        ? event.transitionSeconds
        : 0,
      mode: event.mode === 'smartCrossfade' || event.mode === 'beatAligned' || event.mode === 'energyFade' || event.mode === 'gaplessFallback'
        ? event.mode
        : undefined,
      fallbackReason: typeof event.fallbackReason === 'string' ? event.fallbackReason : null,
      beatAligned: event.beatAligned === true,
      skipIntroSilence: event.skipIntroSilence === true,
      nextStartSeconds: typeof event.nextStartSeconds === 'number' && Number.isFinite(event.nextStartSeconds)
        ? event.nextStartSeconds
        : undefined,
    });
  }
});

const echoApi: EchoApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IpcChannels.AppGetVersion),
    minimize: () => ipcRenderer.invoke(IpcChannels.AppWindowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IpcChannels.AppWindowToggleMaximize),
    isMaximized: () => ipcRenderer.invoke(IpcChannels.AppWindowIsMaximized),
    onMaximizedChange: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: unknown): void => {
        handler(isMaximized === true);
      };
      ipcRenderer.on(IpcChannels.AppWindowMaximizedChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AppWindowMaximizedChanged, listener);
    },
    toggleFullscreen: () => ipcRenderer.invoke(IpcChannels.AppWindowToggleFullscreen),
    triggerFullscreenShortcut: () => ipcRenderer.invoke(IpcChannels.AppWindowTriggerFullscreenShortcut),
    isFullscreen: () => ipcRenderer.invoke(IpcChannels.AppWindowIsFullscreen),
    onFullscreenChange: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, isFullscreen: unknown): void => {
        handler(isFullscreen === true);
      };
      ipcRenderer.on(IpcChannels.AppWindowFullscreenChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AppWindowFullscreenChanged, listener);
    },
    close: () => ipcRenderer.invoke(IpcChannels.AppWindowClose),
    quit: () => ipcRenderer.invoke(IpcChannels.AppQuit),
    getSystemUserName: () => ipcRenderer.invoke(IpcChannels.AppGetSystemUserName),
    getSettings: () => ipcRenderer.invoke(IpcChannels.AppGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.AppSetSettings, patch),
    getTaskbarPlaybackStatus: () => ipcRenderer.invoke(IpcChannels.AppGetTaskbarPlaybackStatus),
    resetSettings: () => ipcRenderer.invoke(IpcChannels.AppResetSettings),
    exportSettings: () => ipcRenderer.invoke(IpcChannels.AppExportSettings),
    importSettings: () => ipcRenderer.invoke(IpcChannels.AppImportSettings),
    exportDataPackage: () => ipcRenderer.invoke(IpcChannels.AppExportDataPackage),
    chooseDataBackupDirectory: () => ipcRenderer.invoke(IpcChannels.AppChooseDataBackupDirectory),
    getDataBackupStatus: () => ipcRenderer.invoke(IpcChannels.AppGetDataBackupStatus),
    onDataBackupProgress: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown): void => {
        if (progress) {
          handler(progress as DataBackupProgress);
        }
      };
      ipcRenderer.on(IpcChannels.AppDataBackupProgress, listener);
      return () => ipcRenderer.off(IpcChannels.AppDataBackupProgress, listener);
    },
    runDataBackupNow: () => ipcRenderer.invoke(IpcChannels.AppRunDataBackupNow),
    importDataBackup: () => ipcRenderer.invoke(IpcChannels.AppImportDataBackup),
    openDataBackupDirectory: () => ipcRenderer.invoke(IpcChannels.AppOpenDataBackupDirectory),
    chooseFontFile: () => ipcRenderer.invoke(IpcChannels.AppChooseFontFile),
    chooseLyricsWallpaper: () => ipcRenderer.invoke(IpcChannels.AppChooseLyricsWallpaper),
    chooseAppWallpaper: () => ipcRenderer.invoke(IpcChannels.AppChooseAppWallpaper),
    loadFontFile: (path) => ipcRenderer.invoke(IpcChannels.AppLoadFontFile, path),
    chooseCacheDirectory: () => ipcRenderer.invoke(IpcChannels.AppChooseCacheDirectory),
    getDefaultCacheDirectory: () => ipcRenderer.invoke(IpcChannels.AppGetDefaultCacheDirectory),
    getCacheInventory: () => ipcRenderer.invoke(IpcChannels.AppGetCacheInventory),
    setCoverCacheDirectory: (request) => ipcRenderer.invoke(IpcChannels.AppSetCoverCacheDirectory, request),
    getUpdateStatus: () => ipcRenderer.invoke(IpcChannels.AppGetUpdateStatus),
    checkForUpdates: () => ipcRenderer.invoke(IpcChannels.AppCheckForUpdates),
    onUpdateStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as UpdateStatus);
      };
      ipcRenderer.on(IpcChannels.AppUpdateStatusChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AppUpdateStatusChanged, listener);
    },
    openRepository: () => ipcRenderer.invoke(IpcChannels.AppOpenRepository),
    openExternalUrl: (url) => ipcRenderer.invoke(IpcChannels.AppOpenExternalUrl, url),
    showTouchKeyboard: () => ipcRenderer.invoke(IpcChannels.AppShowTouchKeyboard),
    testNetworkProxy: (patch) =>
      patch === undefined ? ipcRenderer.invoke(IpcChannels.AppTestNetworkProxy) : ipcRenderer.invoke(IpcChannels.AppTestNetworkProxy, patch),
    validateGlobalShortcut: (accelerator) => ipcRenderer.invoke(IpcChannels.AppValidateGlobalShortcut, accelerator),
    onGlobalShortcutCommand: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, action: unknown): void => {
        handler(action as GlobalShortcutAction);
      };
      ipcRenderer.on(IpcChannels.AppGlobalShortcutCommand, listener);
      return () => ipcRenderer.off(IpcChannels.AppGlobalShortcutCommand, listener);
    },
  },
  desktopLyrics: {
    show: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsShow),
    hide: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsHide),
    getState: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsGetState),
    setLocked: (locked) => ipcRenderer.invoke(IpcChannels.DesktopLyricsSetLocked, locked),
    setStyle: (patch) => ipcRenderer.invoke(IpcChannels.DesktopLyricsSetStyle, patch),
    resetBounds: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsResetBounds),
    setMousePassthrough: (passthrough) => {
      ipcRenderer.send(IpcChannels.DesktopLyricsSetMousePassthrough, passthrough);
    },
    publishAudioStatus: (status) => {
      ipcRenderer.send(IpcChannels.DesktopLyricsRendererAudioStatus, status);
    },
    publishPlaybackStatus: (status) => {
      ipcRenderer.send(IpcChannels.DesktopLyricsRendererPlaybackStatus, status);
    },
    getLastAudioStatus: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsGetLastAudioStatus),
    getLastPlaybackStatus: () => ipcRenderer.invoke(IpcChannels.DesktopLyricsGetLastPlaybackStatus),
    onStateChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => {
        handler(state as Awaited<ReturnType<EchoApi['desktopLyrics']['getState']>>);
      };
      ipcRenderer.on(IpcChannels.DesktopLyricsStateChanged, listener);
      return () => ipcRenderer.off(IpcChannels.DesktopLyricsStateChanged, listener);
    },
    onAudioStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as AudioStatus);
      };
      ipcRenderer.on(IpcChannels.DesktopLyricsAudioStatus, listener);
      return () => ipcRenderer.off(IpcChannels.DesktopLyricsAudioStatus, listener);
    },
    onPlaybackStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as NonNullable<Awaited<ReturnType<EchoApi['desktopLyrics']['getLastPlaybackStatus']>>>);
      };
      ipcRenderer.on(IpcChannels.DesktopLyricsPlaybackStatus, listener);
      return () => ipcRenderer.off(IpcChannels.DesktopLyricsPlaybackStatus, listener);
    },
  },
  miniPlayer: {
    show: () => ipcRenderer.invoke(IpcChannels.MiniPlayerShow),
    hide: (options) =>
      options === undefined
        ? ipcRenderer.invoke(IpcChannels.MiniPlayerHide)
        : ipcRenderer.invoke(IpcChannels.MiniPlayerHide, options),
    getState: () => ipcRenderer.invoke(IpcChannels.MiniPlayerGetState),
    setLocked: (locked) => ipcRenderer.invoke(IpcChannels.MiniPlayerSetLocked, locked),
    setQueueOpen: (open) => ipcRenderer.invoke(IpcChannels.MiniPlayerSetQueueOpen, open),
    resetBounds: () => ipcRenderer.invoke(IpcChannels.MiniPlayerResetBounds),
    onStateChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => {
        handler(state as Awaited<ReturnType<EchoApi['miniPlayer']['getState']>>);
      };
      ipcRenderer.on(IpcChannels.MiniPlayerStateChanged, listener);
      return () => ipcRenderer.off(IpcChannels.MiniPlayerStateChanged, listener);
    },
  },
  library: {
    chooseFolder: () => ipcRenderer.invoke(IpcChannels.LibraryChooseFolder),
    chooseImportFiles: () => ipcRenderer.invoke(IpcChannels.LibraryChooseImportFiles),
    addFolder: (path) => ipcRenderer.invoke(IpcChannels.LibraryAddFolder, path),
    classifyImportPaths: (paths) => ipcRenderer.invoke(IpcChannels.LibraryClassifyImportPaths, paths),
    importDroppedFiles: async (files) => {
      const payload = await Promise.all(
        Array.from(files ?? []).map(async (file) => {
          const path = webUtils?.getPathForFile(file) || null;
          return {
            name: file.name,
            type: file.type,
            path,
            bytes: path ? null : new Uint8Array(await file.arrayBuffer()),
          };
        }),
      );
      return ipcRenderer.invoke(IpcChannels.LibraryImportDroppedFiles, payload);
    },
    getFolders: () => ipcRenderer.invoke(IpcChannels.LibraryGetFolders),
    importAudioFiles: (paths) => ipcRenderer.invoke(IpcChannels.LibraryImportAudioFiles, paths),
    getFolderOverviews: () => ipcRenderer.invoke(IpcChannels.LibraryGetFolderOverviews),
    getFolderChildren: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetFolderChildren, query),
    getFolderTracks: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetFolderTracks, query),
    openLibraryFolderPath: (request) => ipcRenderer.invoke(IpcChannels.LibraryOpenLibraryFolderPath, request),
    removeFolder: (folderId) => ipcRenderer.invoke(IpcChannels.LibraryRemoveFolder, folderId),
    scanFolder: (folderId, options) => ipcRenderer.invoke(IpcChannels.LibraryScanFolder, folderId, options),
    scanFolderChanges: (folderId) => ipcRenderer.invoke(IpcChannels.LibraryScanFolderChanges, folderId),
    rescanEmbeddedTags: (mode, options) => ipcRenderer.invoke(IpcChannels.LibraryRescanEmbeddedTags, mode, options),
    getScanStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryGetScanStatus, jobId),
    cancelScan: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryCancelScan, jobId),
    getTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryGetTrack, trackId),
    getTracks: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetTracks, query),
    getLibraryQualityOverview: () => ipcRenderer.invoke(IpcChannels.LibraryGetQualityOverview),
    getLibraryQualityIssues: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetQualityIssues, query),
    getLibraryInboxBatches: () => ipcRenderer.invoke(IpcChannels.LibraryGetInboxBatches),
    getLibraryInboxTracks: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetInboxTracks, query),
    createPlaylistFromLibraryInbox: (request) => ipcRenderer.invoke(IpcChannels.LibraryCreateInboxPlaylist, request),
    addLibraryInboxToQueue: (query) => ipcRenderer.invoke(IpcChannels.LibraryAddInboxToQueue, query),
    updateLibraryInboxItemState: (request) => ipcRenderer.invoke(IpcChannels.LibraryUpdateInboxItemState, request),
    getHealthReport: () => ipcRenderer.invoke(IpcChannels.LibraryGetHealthReport),
    exportHealthReport: () => ipcRenderer.invoke(IpcChannels.LibraryExportHealthReport),
    refreshDuplicateTracks: (mode) => ipcRenderer.invoke(IpcChannels.LibraryRefreshDuplicateTracks, mode),
    getDuplicateTrackVersions: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryGetDuplicateTrackVersions, trackId),
    getDuplicateHiddenCounts: (trackIds, mode) => ipcRenderer.invoke(IpcChannels.LibraryGetDuplicateHiddenCounts, trackIds, mode),
    getDuplicateIndexSummary: (mode) => ipcRenderer.invoke(IpcChannels.LibraryGetDuplicateIndexSummary, mode),
    previewDuplicateTrackCleanup: (mode) => ipcRenderer.invoke(IpcChannels.LibraryPreviewDuplicateTrackCleanup, mode),
    applyDuplicateTrackCleanup: (request) => ipcRenderer.invoke(IpcChannels.LibraryApplyDuplicateTrackCleanup, request),
    getPlaylists: () => ipcRenderer.invoke(IpcChannels.LibraryGetPlaylists),
    createPlaylist: (request) => ipcRenderer.invoke(IpcChannels.LibraryCreatePlaylist, request),
    updatePlaylist: (request) => ipcRenderer.invoke(IpcChannels.LibraryUpdatePlaylist, request),
    deletePlaylist: (playlistId) => ipcRenderer.invoke(IpcChannels.LibraryDeletePlaylist, playlistId),
    getPlaylist: (playlistId) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaylist, playlistId),
    getPlaylistItems: (playlistId, query) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaylistItems, playlistId, query),
    importPlaylistFile: () => ipcRenderer.invoke(IpcChannels.LibraryImportPlaylistFile),
    exportPlaylist: (request) => ipcRenderer.invoke(IpcChannels.LibraryExportPlaylist, request),
    addTrackToPlaylist: (playlistId, trackId) => ipcRenderer.invoke(IpcChannels.LibraryAddTrackToPlaylist, playlistId, trackId),
    addStreamingTrackToPlaylist: (playlistId, track) => ipcRenderer.invoke(IpcChannels.LibraryAddStreamingTrackToPlaylist, playlistId, track),
    addTracksToPlaylist: (playlistId, trackIds) => ipcRenderer.invoke(IpcChannels.LibraryAddTracksToPlaylist, playlistId, trackIds),
    addLocalAudioFilesToPlaylist: (playlistId, paths) => ipcRenderer.invoke(IpcChannels.LibraryAddLocalAudioFilesToPlaylist, playlistId, paths),
    removePlaylistItem: (itemId) => ipcRenderer.invoke(IpcChannels.LibraryRemovePlaylistItem, itemId),
    movePlaylistItem: (playlistId, itemId, targetPosition) =>
      ipcRenderer.invoke(IpcChannels.LibraryMovePlaylistItem, playlistId, itemId, targetPosition),
    clearPlaylist: (playlistId) => ipcRenderer.invoke(IpcChannels.LibraryClearPlaylist, playlistId),
    getLikedSongsPlaylist: () => ipcRenderer.invoke(IpcChannels.LibraryGetLikedSongsPlaylist),
    getLikedAlbumsPlaylist: () => ipcRenderer.invoke(IpcChannels.LibraryGetLikedAlbumsPlaylist),
    getLikedTracks: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetLikedTracks, query),
    getLikedAlbums: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetLikedAlbums, query),
    isTrackLiked: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryIsTrackLiked, trackId),
    isAlbumLiked: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryIsAlbumLiked, albumId),
    getLikedTrackIds: (trackIds) => ipcRenderer.invoke(IpcChannels.LibraryGetLikedTrackIds, trackIds),
    getLikedAlbumIds: (albumIds) => ipcRenderer.invoke(IpcChannels.LibraryGetLikedAlbumIds, albumIds),
    likeTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryLikeTrack, trackId),
    unlikeTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryUnlikeTrack, trackId),
    toggleTrackLiked: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryToggleTrackLiked, trackId),
    likeAlbum: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryLikeAlbum, albumId),
    unlikeAlbum: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryUnlikeAlbum, albumId),
    toggleAlbumLiked: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryToggleAlbumLiked, albumId),
    clearLikedTracks: (query) => ipcRenderer.invoke(IpcChannels.LibraryClearLikedTracks, query),
    clearLikedAlbums: (query) => ipcRenderer.invoke(IpcChannels.LibraryClearLikedAlbums, query),
    getAlbums: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetAlbums, query),
    getAlbum: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryGetAlbum, albumId),
    getAlbumOnlineInfo: (albumId, options) => ipcRenderer.invoke(IpcChannels.LibraryGetAlbumOnlineInfo, albumId, options),
    getAlbumForTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryGetAlbumForTrack, trackId),
    getArtists: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetArtists, query),
    getArtist: (artistId) => ipcRenderer.invoke(IpcChannels.LibraryGetArtist, artistId),
    getArtistInsights: (artistId, options) => ipcRenderer.invoke(IpcChannels.LibraryGetArtistInsights, artistId, options),
    getArtistTracks: (artistId, query) => ipcRenderer.invoke(IpcChannels.LibraryGetArtistTracks, artistId, query),
    getArtistAlbums: (artistId, query) => ipcRenderer.invoke(IpcChannels.LibraryGetArtistAlbums, artistId, query),
    clearArtistOnlineInfoCache: () => ipcRenderer.invoke(IpcChannels.LibraryArtistOnlineInfoClearCache),
    enqueueMissingArtistImages: (request) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesEnqueueMissing, request),
    refreshArtistImage: (artistId, force) =>
      ipcRenderer.invoke(IpcChannels.LibraryArtistImagesRefreshOne, { artistId, force }),
    refreshVisibleArtistImages: (artists) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesRefreshVisible, artists),
    getArtistImageStatus: (artistId) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesGetStatus, artistId),
    getArtistImageCacheSummary: () => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesGetSummary),
    getArtistImageJobStatus: () => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesGetJobStatus),
    setArtistImageJobsPaused: (paused) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesSetPaused, paused),
    kickoffArtistImageBackfill: (options) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesKickoff, options),
    clearArtistImageCache: () => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesClearCache),
    chooseArtistAvatar: (artistId) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesChooseCustom, artistId),
    setArtistAvatarFromUrl: (artistId, url) =>
      ipcRenderer.invoke(IpcChannels.LibraryArtistImagesSetCustomUrl, { artistId, url }),
    clearCustomArtistAvatar: (artistId) => ipcRenderer.invoke(IpcChannels.LibraryArtistImagesClearCustom, artistId),
    onArtistImagesUpdated: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        handler(payload as { artistId: string | null; artistKey: string; status: string });
      };
      ipcRenderer.on(IpcChannels.LibraryArtistImagesUpdated, listener);
      return () => ipcRenderer.off(IpcChannels.LibraryArtistImagesUpdated, listener);
    },
    onLibraryChanged: (handler) => {
      const listener = (): void => {
        handler();
      };
      ipcRenderer.on(IpcChannels.LibraryChanged, listener);
      return () => ipcRenderer.off(IpcChannels.LibraryChanged, listener);
    },
    onLikedTracksChanged: (handler) => {
      const listener = (): void => {
        handler();
      };
      ipcRenderer.on(IpcChannels.LibraryLikedTracksChanged, listener);
      return () => ipcRenderer.off(IpcChannels.LibraryLikedTracksChanged, listener);
    },
    getAlbumTracks: (albumId, query) => ipcRenderer.invoke(IpcChannels.LibraryGetAlbumTracks, albumId, query),
    getSummary: () => ipcRenderer.invoke(IpcChannels.LibraryGetSummary),
    refreshAlbumGrouping: () => ipcRenderer.invoke(IpcChannels.LibraryRefreshAlbumGrouping),
    getDiagnostics: () => ipcRenderer.invoke(IpcChannels.LibraryGetDiagnostics),
    getMoveCandidates: (options) => ipcRenderer.invoke(IpcChannels.LibraryGetMoveCandidates, options),
    chooseTrackCover: () => ipcRenderer.invoke(IpcChannels.LibraryChooseTrackCover),
    loadEmbeddedTrackTags: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryLoadEmbeddedTrackTags, trackId),
    updateTrackTags: (request) => ipcRenderer.invoke(IpcChannels.LibraryUpdateTrackTags, request),
    updateAlbumTags: (request) => ipcRenderer.invoke(IpcChannels.LibraryUpdateAlbumTags, request),
    recordTrackPlayback: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryRecordTrackPlayback, trackId),
    getPlaybackHistory: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaybackHistory, query),
    getPlaybackHistorySummary: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaybackHistorySummary, query),
    getPlaybackStatsDashboard: (query) => ipcRenderer.invoke(IpcChannels.LibraryGetPlaybackStatsDashboard, query),
    refreshInvalidPlaybackHistory: () => ipcRenderer.invoke(IpcChannels.LibraryRefreshInvalidPlaybackHistory),
    deletePlaybackHistoryEntry: (id) => ipcRenderer.invoke(IpcChannels.LibraryDeletePlaybackHistoryEntry, id),
    clearPlaybackHistory: () => ipcRenderer.invoke(IpcChannels.LibraryClearPlaybackHistory),
    startPlaybackHistory: (request) => ipcRenderer.invoke(IpcChannels.LibraryStartPlaybackHistory, request),
    finishPlaybackHistory: (request) => ipcRenderer.invoke(IpcChannels.LibraryFinishPlaybackHistory, request),
    openTrackInFolder: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryOpenTrackInFolder, trackId),
    openPathInFolder: (path) => ipcRenderer.invoke(IpcChannels.LibraryOpenPathInFolder, path),
    openTrackWithSystem: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryOpenTrackWithSystem, trackId),
    copyTrackPath: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryCopyTrackPath, trackId),
    copyTrackNameArtist: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryCopyTrackNameArtist, trackId),
    copyTrackCover: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryCopyTrackCover, trackId),
    copyTrackOriginalCover: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryCopyTrackOriginalCover, trackId),
    saveTrackCover: (trackId) => ipcRenderer.invoke(IpcChannels.LibrarySaveTrackCover, trackId),
    deleteTrackFile: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryDeleteTrackFile, trackId),
    copyAlbumInfo: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryCopyAlbumInfo, albumId),
    copyAlbumCover: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryCopyAlbumCover, albumId),
    saveAlbumCover: (albumId) => ipcRenderer.invoke(IpcChannels.LibrarySaveAlbumCover, albumId),
    deleteAlbumFiles: (albumId) => ipcRenderer.invoke(IpcChannels.LibraryDeleteAlbumFiles, albumId),
    pruneMissingTracks: () => ipcRenderer.invoke(IpcChannels.LibraryPruneMissingTracks),
    pruneInvalidTracks: () => ipcRenderer.invoke(IpcChannels.LibraryPruneInvalidTracks),
    clearTracks: () => ipcRenderer.invoke(IpcChannels.LibraryClearTracks),
    clearCache: () => ipcRenderer.invoke(IpcChannels.LibraryClearCache),
    repairDatabase: () => ipcRenderer.invoke(IpcChannels.LibraryRepairDatabase),
    deleteDatabase: () => ipcRenderer.invoke(IpcChannels.LibraryDeleteDatabase),
    deleteAllUserData: () => ipcRenderer.invoke(IpcChannels.LibraryDeleteAllUserData),
    getDatabaseProtectionStatus: (options) => ipcRenderer.invoke(IpcChannels.LibraryGetDatabaseProtectionStatus, options),
    createDatabaseSnapshot: () => ipcRenderer.invoke(IpcChannels.LibraryCreateDatabaseSnapshot),
    restoreDatabaseSnapshot: (snapshotId) => ipcRenderer.invoke(IpcChannels.LibraryRestoreDatabaseSnapshot, snapshotId),
    scrubQuarantinedDatabase: () => ipcRenderer.invoke(IpcChannels.LibraryScrubQuarantinedDatabase),
    discardQuarantinedProblemTracks: () => ipcRenderer.invoke(IpcChannels.LibraryDiscardQuarantinedProblemTracks),
    relaunchRecoveryMode: () => ipcRenderer.invoke(IpcChannels.LibraryRelaunchRecoveryMode),
    openDataProtectionFolder: () => ipcRenderer.invoke(IpcChannels.LibraryOpenDataProtectionFolder),
    repairMissingMetadata: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryNetworkRepairMissingMetadata, trackId),
    scanMissingMetadata: (options) => ipcRenderer.invoke(IpcChannels.LibraryNetworkScanMissingMetadata, options),
    startMissingMetadataScan: (options) => ipcRenderer.invoke(IpcChannels.LibraryNetworkStartMissingMetadataScan, options),
    getMissingMetadataScanStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryNetworkGetMissingMetadataScanStatus, jobId),
    startMissingCoverBackfill: (options) => ipcRenderer.invoke(IpcChannels.LibraryNetworkStartMissingCoverBackfill, options),
    getMissingCoverBackfillStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryNetworkGetMissingCoverBackfillStatus, jobId),
    getActiveMissingCoverBackfillStatus: () => ipcRenderer.invoke(IpcChannels.LibraryNetworkGetActiveMissingCoverBackfillStatus),
    showNetworkCandidates: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryNetworkShowCandidates, trackId),
    searchNetworkTagCandidates: (trackId, options) =>
      ipcRenderer.invoke(IpcChannels.LibrarySearchNetworkTagCandidates, { trackId, ...options }),
    resolveLyricsBackgroundCover: (trackId) => ipcRenderer.invoke(IpcChannels.LibraryResolveLyricsBackgroundCover, trackId),
    applyNetworkMissingOnly: (candidateId, options) =>
      ipcRenderer.invoke(IpcChannels.LibraryNetworkApplyMissingOnly, { candidateId, ...options }),
    applyNetworkSelected: (candidateId, options) =>
      ipcRenderer.invoke(IpcChannels.LibraryNetworkApplySelected, { candidateId, ...options }),
    rejectNetworkCandidate: (candidateId) => ipcRenderer.invoke(IpcChannels.LibraryNetworkRejectCandidate, candidateId),
    startBpmAnalysis: (options) => ipcRenderer.invoke(IpcChannels.LibraryStartBpmAnalysis, options),
    getBpmAnalysisStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryGetBpmAnalysisStatus, jobId),
    startReplayGainAnalysis: (options) => ipcRenderer.invoke(IpcChannels.LibraryStartReplayGainAnalysis, options),
    getReplayGainAnalysisStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryGetReplayGainAnalysisStatus, jobId),
    startLyricsBackfill: (options) => ipcRenderer.invoke(IpcChannels.LibraryStartLyricsBackfill, options),
    getLyricsBackfillStatus: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryGetLyricsBackfillStatus, jobId),
    getCurrentLyricsBackfillStatus: () => ipcRenderer.invoke(IpcChannels.LibraryGetCurrentLyricsBackfillStatus),
    cancelLyricsBackfill: (jobId) => ipcRenderer.invoke(IpcChannels.LibraryCancelLyricsBackfill, jobId),
  },
  libraryLab: {
    setWatcherEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetWatcherEnabled, enabled),
    setAutoRescanEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetAutoRescanEnabled, enabled),
    setMoveCandidateEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetMoveCandidateEnabled, enabled),
    setMoveRepairLabEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetMoveRepairLabEnabled, enabled),
    getState: () => ipcRenderer.invoke(IpcChannels.LibraryLabGetState),
    startWatcher: () => ipcRenderer.invoke(IpcChannels.LibraryLabStartWatcher),
    stopWatcher: () => ipcRenderer.invoke(IpcChannels.LibraryLabStopWatcher),
    refreshDiagnostics: () => ipcRenderer.invoke(IpcChannels.LibraryLabRefreshDiagnostics),
    backfillPlaceholderMetadata: () => ipcRenderer.invoke(IpcChannels.LibraryLabBackfillPlaceholderMetadata),
    getMoveCandidates: (options) => ipcRenderer.invoke(IpcChannels.LibraryLabGetMoveCandidates, options),
    dryRunMoveRepair: (candidateId) => ipcRenderer.invoke(IpcChannels.LibraryLabDryRunMoveRepair, candidateId),
    applyMoveRepair: (candidateId) => ipcRenderer.invoke(IpcChannels.LibraryLabApplyMoveRepair, candidateId),
  },
  playback: {
    getStatus: () => systemAudioModeActive ? Promise.resolve(toSystemPlaybackStatus()) : ipcRenderer.invoke(IpcChannels.PlaybackGetStatus),
    playLocalFile: async (request) => {
      if (requiresNativeChainedPlayback(request)) {
        stopSystemPlayback('stopped', false);
        systemAudioModeActive = false;
        return ipcRenderer.invoke(IpcChannels.PlaybackPlayLocalFile, withNativeSharedOutput(request));
      }

      if (requiresNativeSystemLocalPlayback(request)) {
        stopSystemPlayback('stopped', false);
        systemAudioModeActive = false;
        return ipcRenderer.invoke(IpcChannels.PlaybackPlayLocalFile, withNativeSystemFallbackOutput(request));
      }

      if (await shouldUseSystemAudioForPlayback(request.output)) {
        return isMainPlaybackRenderer
          ? playLocalFileWithSystemAudio(request)
          : invokeMainPlaybackRenderer<PlaybackStatus>('playLocalFile', [request]);
      }

      return ipcRenderer.invoke(IpcChannels.PlaybackPlayLocalFile, request);
    },
    playMediaItem: async (request) => {
      if (requiresNativeChainedPlayback(request)) {
        stopSystemPlayback('stopped', false);
        systemAudioModeActive = false;
        return ipcRenderer.invoke(IpcChannels.PlaybackPlayMediaItem, withNativeSharedOutput(request));
      }

      if (requiresNativeSystemMediaPlayback(request)) {
        stopSystemPlayback('stopped', false);
        systemAudioModeActive = false;
        return ipcRenderer.invoke(IpcChannels.PlaybackPlayMediaItem, withNativeSystemFallbackOutput(request));
      }

      if (await shouldUseSystemAudioForPlayback(request.output)) {
        return isMainPlaybackRenderer
          ? playMediaItemWithSystemAudio(request)
          : invokeMainPlaybackRenderer<PlaybackStatus>('playMediaItem', [request]);
      }

      return ipcRenderer.invoke(IpcChannels.PlaybackPlayMediaItem, request);
    },
    prepareMediaItem: (request) => ipcRenderer.invoke(IpcChannels.PlaybackPrepareMediaItem, request),
    prepareLocalFile: (request) => ipcRenderer.invoke(IpcChannels.PlaybackPrepareLocalFile, request),
    play: async () => {
      if (!await refreshSystemAudioModeActive()) {
        return ipcRenderer.invoke(IpcChannels.PlaybackPlay);
      }
      if (!isMainPlaybackRenderer) {
        return invokeMainPlaybackRenderer<PlaybackStatus>('play');
      }

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
    },
    pause: async () => {
      if (!await refreshSystemAudioModeActive()) {
        return ipcRenderer.invoke(IpcChannels.PlaybackPause);
      }
      if (!isMainPlaybackRenderer) {
        return invokeMainPlaybackRenderer<PlaybackStatus>('pause');
      }

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
    },
    stop: async () => {
      if (!await refreshSystemAudioModeActive()) {
        return ipcRenderer.invoke(IpcChannels.PlaybackStop);
      }
      if (!isMainPlaybackRenderer) {
        return invokeMainPlaybackRenderer<PlaybackStatus>('stop');
      }

      return stopSystemPlayback('stopped');
    },
    seek: async (positionSeconds) => {
      if (!await refreshSystemAudioModeActive()) {
        return ipcRenderer.invoke(IpcChannels.PlaybackSeek, positionSeconds);
      }
      if (!isMainPlaybackRenderer) {
        return invokeMainPlaybackRenderer<PlaybackStatus>('seek', [positionSeconds]);
      }

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
    },
    openLocalAudioFile: () => ipcRenderer.invoke(IpcChannels.PlaybackOpenLocalAudioFile),
    openLocalAudioFiles: () => ipcRenderer.invoke(IpcChannels.PlaybackOpenLocalAudioFiles),
    resolveLocalAudioFiles: (paths) => ipcRenderer.invoke(IpcChannels.PlaybackResolveLocalAudioFiles, paths),
    getQueueSession: () => ipcRenderer.invoke(IpcChannels.PlaybackGetQueueSession),
    saveQueueSession: (snapshot, options) => ipcRenderer.invoke(IpcChannels.PlaybackSaveQueueSession, snapshot, options),
    clearQueueSession: () => ipcRenderer.invoke(IpcChannels.PlaybackClearQueueSession),
    onQueueSessionChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown): void => {
        handler(snapshot as Awaited<ReturnType<EchoApi['playback']['getQueueSession']>>);
      };
      ipcRenderer.on(IpcChannels.PlaybackQueueSessionChanged, listener);
      return () => ipcRenderer.off(IpcChannels.PlaybackQueueSessionChanged, listener);
    },
    onLocalAudioFilesOpened: (handler) => {
      localAudioFileOpenHandlers.add(handler);
      for (const paths of pendingLocalAudioFileOpenEvents.splice(0)) {
        handler(paths);
      }

      return () => {
        localAudioFileOpenHandlers.delete(handler);
      };
    },
    onAutomixAdvance: (handler) => {
      automixAdvanceHandlers.add(handler);
      return () => {
        automixAdvanceHandlers.delete(handler);
      };
    },
  },
  remoteSources: {
    list: () => ipcRenderer.invoke(IpcChannels.RemoteSourcesList),
    getOverview: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetOverview, sourceId),
    previewAlbumGrouping: (strategy, sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesPreviewAlbumGrouping, strategy, sourceId),
    listIssues: (sourceId, kind, limit) => ipcRenderer.invoke(IpcChannels.RemoteSourcesListIssues, sourceId, kind, limit),
    create: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCreate, input),
    update: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesUpdate, input),
    disconnect: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesDisconnect, sourceId),
    delete: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesDelete, sourceId),
    test: (sourceIdOrInput) => ipcRenderer.invoke(IpcChannels.RemoteSourcesTest, sourceIdOrInput),
    browse: (sourceId, path) => ipcRenderer.invoke(IpcChannels.RemoteSourcesBrowse, sourceId, path),
    sync: (sourceId, options) => ipcRenderer.invoke(IpcChannels.RemoteSourcesSync, sourceId, options),
    cancelSync: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCancelSync, sourceId),
    getSyncStatus: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetSyncStatus, sourceId),
    createStreamUrl: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCreateStreamUrl, input),
    hydrateVisibleTracks: (trackIds, options) => ipcRenderer.invoke(IpcChannels.RemoteSourcesHydrateVisibleTracks, trackIds, options),
    lookupTracks: (sourceId, remotePaths) => ipcRenderer.invoke(IpcChannels.RemoteSourcesLookupTracks, sourceId, remotePaths),
    listIndexedTracks: (sourceId, rootPath) => ipcRenderer.invoke(IpcChannels.RemoteSourcesListIndexedTracks, sourceId, rootPath),
    listIndexedTracksPage: (sourceId, query) => ipcRenderer.invoke(IpcChannels.RemoteSourcesListIndexedTracksPage, sourceId, query),
    getIndexedFolderStats: (sourceId, rootPath) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetIndexedFolderStats, sourceId, rootPath),
    previewDirectoryItems: (sourceId, items, options) => ipcRenderer.invoke(IpcChannels.RemoteSourcesPreviewDirectoryItems, sourceId, items, options),
    startBackgroundJobs: (sourceId, kinds) => ipcRenderer.invoke(IpcChannels.RemoteSourcesStartBackgroundJobs, sourceId, kinds),
    pauseBackgroundJobs: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesPauseBackgroundJobs, sourceId),
    resumeBackgroundJobs: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesResumeBackgroundJobs, sourceId),
    getJobStatus: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetJobStatus, sourceId),
    retryFailedJobs: (sourceId, kinds) => ipcRenderer.invoke(IpcChannels.RemoteSourcesRetryFailedJobs, sourceId, kinds),
    setBackgroundPaused: (paused) => ipcRenderer.invoke(IpcChannels.RemoteSourcesSetBackgroundPaused, paused),
    getBackgroundGlobalStatus: () => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetBackgroundGlobalStatus),
    updateRuntimeLimits: (sourceId, limits) => ipcRenderer.invoke(IpcChannels.RemoteSourcesUpdateRuntimeLimits, sourceId, limits),
    createBaiduAuthUrl: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCreateBaiduAuthUrl, input),
    exchangeBaiduAuthCode: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesExchangeBaiduAuthCode, input),
    startBaiduOAuthLogin: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesStartBaiduOAuthLogin, input),
  },
  connect: {
    listDevices: () => ipcRenderer.invoke(IpcChannels.ConnectListDevices),
    refresh: () => ipcRenderer.invoke(IpcChannels.ConnectRefresh),
    getStatus: () => ipcRenderer.invoke(IpcChannels.ConnectGetStatus),
    connect: (request) => ipcRenderer.invoke(IpcChannels.ConnectConnect, request),
    disconnect: () => ipcRenderer.invoke(IpcChannels.ConnectDisconnect),
    play: () => ipcRenderer.invoke(IpcChannels.ConnectPlay),
    pause: () => ipcRenderer.invoke(IpcChannels.ConnectPause),
    stop: () => ipcRenderer.invoke(IpcChannels.ConnectStop),
    seek: (positionSeconds) => ipcRenderer.invoke(IpcChannels.ConnectSeek, positionSeconds),
    setVolume: (volumePercent) => ipcRenderer.invoke(IpcChannels.ConnectSetVolume, volumePercent),
    onStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as Awaited<ReturnType<EchoApi['connect']['getStatus']>>);
      };
      ipcRenderer.on(IpcChannels.ConnectStatus, listener);
      return () => ipcRenderer.off(IpcChannels.ConnectStatus, listener);
    },
    getReceiverStatus: () => ipcRenderer.invoke(IpcChannels.ConnectReceiverGetStatus),
    setReceiverEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.ConnectReceiverSetEnabled, enabled),
    stopReceiverPlayback: () => ipcRenderer.invoke(IpcChannels.ConnectReceiverStopPlayback),
    onReceiverStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as Awaited<ReturnType<EchoApi['connect']['getReceiverStatus']>>);
      };
      ipcRenderer.on(IpcChannels.ConnectReceiverStatus, listener);
      return () => ipcRenderer.off(IpcChannels.ConnectReceiverStatus, listener);
    },
    getAirPlayReceiverStatus: () => ipcRenderer.invoke(IpcChannels.ConnectAirPlayReceiverGetStatus),
    setAirPlayReceiverEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.ConnectAirPlayReceiverSetEnabled, enabled),
    stopAirPlayReceiverPlayback: () => ipcRenderer.invoke(IpcChannels.ConnectAirPlayReceiverStopPlayback),
    onAirPlayReceiverStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as Awaited<ReturnType<EchoApi['connect']['getAirPlayReceiverStatus']>>);
      };
      ipcRenderer.on(IpcChannels.ConnectAirPlayReceiverStatus, listener);
      return () => ipcRenderer.off(IpcChannels.ConnectAirPlayReceiverStatus, listener);
    },
  },
  streaming: {
    search: (request) => ipcRenderer.invoke(IpcChannels.StreamingSearch, request),
    getTrack: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetTrack, request),
    getTrackSourceInfo: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetTrackSourceInfo, request),
    getAlbum: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetAlbum, request),
    getArtist: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetArtist, request),
    resolvePlayback: (request) => ipcRenderer.invoke(IpcChannels.StreamingResolvePlayback, request),
    analyzeBpm: (request) => ipcRenderer.invoke(IpcChannels.StreamingAnalyzeBpm, request),
    getLyrics: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetLyrics, request),
    getMv: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetMv, request),
    getProviders: () => ipcRenderer.invoke(IpcChannels.StreamingGetProviders),
    importPlaylistFromUrl: (url) => ipcRenderer.invoke(IpcChannels.StreamingImportPlaylistFromUrl, url),
    importFavoritesFromUrl: (url) => ipcRenderer.invoke(IpcChannels.StreamingImportFavoritesFromUrl, url),
    exportFavorites: () => ipcRenderer.invoke(IpcChannels.StreamingExportFavorites),
    syncLikedSongs: (provider) => ipcRenderer.invoke(IpcChannels.StreamingSyncLikedSongs, provider),
    setTrackLiked: (request) => ipcRenderer.invoke(IpcChannels.StreamingSetTrackLiked, request),
    getFavorites: () => ipcRenderer.invoke(IpcChannels.StreamingGetFavorites),
    setFavorite: (request) => ipcRenderer.invoke(IpcChannels.StreamingSetFavorite, request),
    renameFavoriteCollection: (request) => ipcRenderer.invoke(IpcChannels.StreamingRenameFavoriteCollection, request),
    syncFavoriteCollection: (request) => ipcRenderer.invoke(IpcChannels.StreamingSyncFavoriteCollection, request),
    deleteFavoriteCollection: (request) => ipcRenderer.invoke(IpcChannels.StreamingDeleteFavoriteCollection, request),
    refreshNeteaseDailyRecommend: () => ipcRenderer.invoke(IpcChannels.StreamingRefreshNeteaseDailyRecommend),
  },
  lyrics: {
    getForTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LyricsGetForTrack, trackId),
    getForSnapshot: (request) => ipcRenderer.invoke(IpcChannels.LyricsGetForSnapshot, request),
    searchCandidates: (trackId, searchText, providerId) => ipcRenderer.invoke(IpcChannels.LyricsSearchCandidates, trackId, searchText, providerId),
    searchCandidatesForSnapshot: (request, searchText, providerId) =>
      ipcRenderer.invoke(IpcChannels.LyricsSearchCandidatesForSnapshot, request, searchText, providerId),
    previewCandidate: (trackId, candidateId) => ipcRenderer.invoke(IpcChannels.LyricsPreviewCandidate, trackId, candidateId),
    applyCandidate: (trackId, candidateId) => ipcRenderer.invoke(IpcChannels.LyricsApplyCandidate, trackId, candidateId),
    applyCandidateForSnapshot: (request, candidateId) => ipcRenderer.invoke(IpcChannels.LyricsApplyCandidateForSnapshot, request, candidateId),
    embedToTrack: (trackId, request) => ipcRenderer.invoke(IpcChannels.LyricsEmbedToTrack, trackId, request),
    applyCustomLrc: (trackId, lrcText, fileName) => ipcRenderer.invoke(IpcChannels.LyricsApplyCustomLrc, trackId, lrcText, fileName),
    markInstrumental: (trackId) => ipcRenderer.invoke(IpcChannels.LyricsMarkInstrumental, trackId),
    rejectCandidate: (candidateId) => ipcRenderer.invoke(IpcChannels.LyricsRejectCandidate, candidateId),
    setOffset: (trackId, offsetMs) => ipcRenderer.invoke(IpcChannels.LyricsSetOffset, trackId, offsetMs),
    clearCache: (trackId) => ipcRenderer.invoke(IpcChannels.LyricsClearCache, trackId),
    onChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        if (payload && typeof payload === 'object' && typeof (payload as { trackId?: unknown }).trackId === 'string') {
          handler((payload as { trackId: string }).trackId);
        }
      };
      ipcRenderer.on(IpcChannels.LyricsChanged, listener);
      return () => ipcRenderer.off(IpcChannels.LyricsChanged, listener);
    },
  },
  mv: {
    getSelected: (trackId) => ipcRenderer.invoke(IpcChannels.MvGetSelected, trackId),
    getSettings: () => ipcRenderer.invoke(IpcChannels.MvGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.MvSetSettings, patch),
    findLocalCandidates: (trackId) => ipcRenderer.invoke(IpcChannels.MvFindLocalCandidates, trackId),
    searchNetworkCandidates: (trackId, query) => ipcRenderer.invoke(IpcChannels.MvSearchNetworkCandidates, trackId, query),
    searchNetworkCandidatesForSnapshot: (request) => ipcRenderer.invoke(IpcChannels.MvSearchNetworkCandidatesForSnapshot, request),
    getTemporaryPlayableForSnapshot: (request) => ipcRenderer.invoke(IpcChannels.MvGetTemporaryPlayableForSnapshot, request),
    getCandidates: (trackId) => ipcRenderer.invoke(IpcChannels.MvGetCandidates, trackId),
    resolveStreams: (videoId) => ipcRenderer.invoke(IpcChannels.MvResolveStreams, videoId),
    setQuality: (videoId, qualityId) => ipcRenderer.invoke(IpcChannels.MvSetQuality, videoId, qualityId),
    setOffset: (trackId, offsetMs) => ipcRenderer.invoke(IpcChannels.MvSetOffset, trackId, offsetMs),
    chooseLocalVideo: (trackId) => ipcRenderer.invoke(IpcChannels.MvChooseLocalVideo, trackId),
    bindLocalVideo: (trackId, filePath) => ipcRenderer.invoke(IpcChannels.MvBindLocalVideo, trackId, filePath),
    bindUrl: (trackId, url) => ipcRenderer.invoke(IpcChannels.MvBindUrl, trackId, url),
    selectVideo: (trackId, videoId) => ipcRenderer.invoke(IpcChannels.MvSelectVideo, trackId, videoId),
    clearSelected: (trackId) => ipcRenderer.invoke(IpcChannels.MvClearSelected, trackId),
    openExternal: (videoId) => ipcRenderer.invoke(IpcChannels.MvOpenExternal, videoId),
  },
  smtc: {
    getDiagnostics: () => ipcRenderer.invoke(IpcChannels.SmtcGetDiagnostics),
    restart: () => ipcRenderer.invoke(IpcChannels.SmtcRestart),
    setLyricsProgress: (progress: SmtcLyricsProgress | null) => ipcRenderer.invoke(IpcChannels.SmtcSetLyricsProgress, progress),
    onCommand: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, command: SmtcCommand): void => {
        handler(command);
      };
      ipcRenderer.on(IpcChannels.SmtcCommand, listener);
      return () => ipcRenderer.off(IpcChannels.SmtcCommand, listener);
    },
  },
  discordPresence: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.DiscordPresenceGetStatus),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.DiscordPresenceSetEnabled, enabled),
  },
  lastfm: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.LastFmGetStatus),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LastFmSetEnabled, enabled),
    setNowPlayingEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LastFmSetNowPlayingEnabled, enabled),
    setScrobbleEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LastFmSetScrobbleEnabled, enabled),
    createAuthToken: () => ipcRenderer.invoke(IpcChannels.LastFmCreateAuthToken),
    openAuthUrl: (token) => ipcRenderer.invoke(IpcChannels.LastFmOpenAuthUrl, token),
    completeAuth: (token) => ipcRenderer.invoke(IpcChannels.LastFmCompleteAuth, token),
    authenticatePassword: (username, password) => ipcRenderer.invoke(IpcChannels.LastFmAuthenticatePassword, username, password),
    disconnect: () => ipcRenderer.invoke(IpcChannels.LastFmDisconnect),
  },
  hqPlayer: {
    getSettings: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.HqPlayerSetSettings, patch),
    getStatus: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetStatus),
    testConnection: (patch) => ipcRenderer.invoke(IpcChannels.HqPlayerTestConnection, patch),
    createPlaybackHandoff: (request) => ipcRenderer.invoke(IpcChannels.HqPlayerCreatePlaybackHandoff, request),
    sendLastPlaybackControl: () => ipcRenderer.invoke(IpcChannels.HqPlayerSendLastPlaybackControl),
    getLastPlaybackHandoff: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetLastPlaybackHandoff),
    getLastPlaybackControl: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetLastPlaybackControl),
  },
  audio: {
    getStatus: async () => {
      if (systemAudioModeActive) {
        return createSystemAudioStatus();
      }

      const status = await ipcRenderer.invoke(IpcChannels.AudioGetStatus) as AudioStatus;
      lastNativeAudioStatus = status;
      applySystemOutputSettings(null, status);
      if (status.outputMode === 'system') {
        systemAudioModeActive = true;
        return createSystemAudioStatus();
      }
      return status;
    },
    getDiagnostics: () => ipcRenderer.invoke(IpcChannels.AudioGetDiagnostics),
    onStatus: (handler) => {
      audioStatusHandlers.add(handler);
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        const nextStatus = status as AudioStatus;
        lastNativeAudioStatus = nextStatus;
        applySystemOutputSettings(null, nextStatus);
        if (systemAudioModeActive || nextStatus.outputMode === 'system') {
          if (nextStatus.outputMode === 'system') {
            systemAudioModeActive = true;
          }
          handler(createSystemAudioStatus());
          return;
        }

        handler(nextStatus as Awaited<ReturnType<EchoApi['audio']['getStatus']>>);
      };
      ipcRenderer.on(IpcChannels.AudioStatus, listener);
      return () => {
        audioStatusHandlers.delete(handler);
        ipcRenderer.off(IpcChannels.AudioStatus, listener);
      };
    },
    onSessionReset: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, event: unknown): void => {
        handler(event as Parameters<Parameters<EchoApi['audio']['onSessionReset']>[0]>[0]);
      };
      ipcRenderer.on(IpcChannels.AudioSessionReset, listener);
      return () => ipcRenderer.off(IpcChannels.AudioSessionReset, listener);
    },
    listDevices: () => ipcRenderer.invoke(IpcChannels.AudioListDevices),
    setOutput: async (settings) => {
      const wasSystemAudioModeActive = systemAudioModeActive;
      const nextStatus = await ipcRenderer.invoke(IpcChannels.AudioSetOutput, settings) as AudioStatus;
      lastNativeAudioStatus = nextStatus;
      applySystemOutputSettings(settings, nextStatus);

      if (wasSystemAudioModeActive || isSystemOutputRequest(settings) || nextStatus.outputMode === 'system') {
        systemAudioModeActive = true;
        return emitSystemAudioStatus();
      }

      if (systemAudioModeActive) {
        stopSystemPlayback('idle', false);
        systemAudioModeActive = false;
      }

      return nextStatus;
    },
    openAsioControlPanel: (settings) => ipcRenderer.invoke(IpcChannels.AudioOpenAsioControlPanel, settings),
    exportFile: (request) => ipcRenderer.invoke(IpcChannels.AudioExportFile, request),
    resetEngine: () => ipcRenderer.invoke(IpcChannels.AudioResetEngine),
    forceRestart: (reason) => ipcRenderer.invoke(IpcChannels.AudioForceRestart, reason),
    restartWindowsAudioService: () => ipcRenderer.invoke(IpcChannels.AudioRestartWindowsAudioService),
  },
  diagnostics: {
    getLastCrashSummary: () => ipcRenderer.invoke(IpcChannels.DiagnosticsGetLastCrashSummary),
    clearLastCrashSummary: () => ipcRenderer.invoke(IpcChannels.DiagnosticsClearLastCrashSummary),
    exportDiagnostics: () => ipcRenderer.invoke(IpcChannels.DiagnosticsExport),
    exportDiagnosticsZip: () => ipcRenderer.invoke(IpcChannels.DiagnosticsExportZip),
    openDiagnosticsFolder: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenFolder),
    openCrashReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenCrashReport),
    openAudioCrashReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenAudioCrashReport),
    relaunchApp: () => ipcRenderer.invoke(IpcChannels.DiagnosticsRelaunchApp),
    openDevConsole: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenDevConsole),
    getDevConsoleSnapshot: () => ipcRenderer.invoke(IpcChannels.DiagnosticsDevConsoleSnapshot),
    onDevConsoleEntry: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: unknown): void => {
        handler(entry as DiagnosticConsoleEntry);
      };
      ipcRenderer.on(IpcChannels.DiagnosticsDevConsoleEntry, listener);
      return () => ipcRenderer.off(IpcChannels.DiagnosticsDevConsoleEntry, listener);
    },
    reportRendererError: (payload) => ipcRenderer.invoke(IpcChannels.DiagnosticsReportRendererError, payload),
    reportPerformanceStall: (payload) => ipcRenderer.invoke(IpcChannels.DiagnosticsReportPerformanceStall, payload),
  },
  downloads: {
    getJobs: () => ipcRenderer.invoke(IpcChannels.DownloadsGetJobs),
    createUrlJob: (url, options) => ipcRenderer.invoke(IpcChannels.DownloadsCreateUrlJob, url, options),
    cancelJob: (jobId) => ipcRenderer.invoke(IpcChannels.DownloadsCancelJob, jobId),
    clearCompleted: () => ipcRenderer.invoke(IpcChannels.DownloadsClearCompleted),
    getSettings: () => ipcRenderer.invoke(IpcChannels.DownloadsGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.DownloadsSetSettings, patch),
    chooseOutputDirectory: () => ipcRenderer.invoke(IpcChannels.DownloadsChooseOutputDirectory),
    search: (request) => ipcRenderer.invoke(IpcChannels.DownloadsSearch, request),
    checkTools: () => ipcRenderer.invoke(IpcChannels.DownloadsCheckTools),
    onJobsUpdated: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, jobs: unknown): void => {
        handler(jobs as Awaited<ReturnType<EchoApi['downloads']['getJobs']>>);
      };
      ipcRenderer.on(IpcChannels.DownloadsJobsUpdated, listener);
      return () => ipcRenderer.off(IpcChannels.DownloadsJobsUpdated, listener);
    },
  },
  plugins: {
    list: () => ipcRenderer.invoke(IpcChannels.PluginsList),
    createExample: (kind) => ipcRenderer.invoke(IpcChannels.PluginsCreateExample, kind),
    enable: (request) => ipcRenderer.invoke(IpcChannels.PluginsEnable, request),
    disable: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsDisable, pluginId),
    reload: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsReload, pluginId),
    openDirectory: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsOpenDirectory, pluginId),
    exportPackage: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsExportPackage, pluginId),
    importPackage: (source) => {
      if (source === undefined) {
        return ipcRenderer.invoke(IpcChannels.PluginsImportPackage);
      }
      if (typeof source === 'string') {
        return ipcRenderer.invoke(IpcChannels.PluginsImportPackage, source);
      }

      const sourcePath = webUtils?.getPathForFile(source) || '';
      if (!sourcePath) {
        throw new Error('plugin_package_path_unavailable');
      }
      return ipcRenderer.invoke(IpcChannels.PluginsImportPackage, sourcePath);
    },
    runCommand: (request) => ipcRenderer.invoke(IpcChannels.PluginsRunCommand, request),
    queryMetadata: (request) => ipcRenderer.invoke(IpcChannels.PluginsQueryMetadata, request),
    querySources: (request) => ipcRenderer.invoke(IpcChannels.PluginsQuerySources, request),
    resolveSourcePlayback: (request) => ipcRenderer.invoke(IpcChannels.PluginsResolveSourcePlayback, request),
    queryLyrics: (request) => ipcRenderer.invoke(IpcChannels.PluginsQueryLyrics, request),
    queryCovers: (request) => ipcRenderer.invoke(IpcChannels.PluginsQueryCovers, request),
    getSettings: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsGetSettings, pluginId),
    setSettings: (pluginId, patch) => ipcRenderer.invoke(IpcChannels.PluginsSetSettings, pluginId, patch),
    getLogs: (pluginId) => ipcRenderer.invoke(IpcChannels.PluginsGetLogs, pluginId),
  },
  accounts: {
    getStatuses: () => ipcRenderer.invoke(IpcChannels.AccountGetStatuses),
    getStatus: (provider) => ipcRenderer.invoke(IpcChannels.AccountGetStatus, provider),
    saveCookie: (provider, cookie) => ipcRenderer.invoke(IpcChannels.AccountSaveCookie, provider, cookie),
    startLogin: (provider) => ipcRenderer.invoke(IpcChannels.AccountStartLogin, provider),
    clear: (provider) => ipcRenderer.invoke(IpcChannels.AccountClear, provider),
    check: (provider) => ipcRenderer.invoke(IpcChannels.AccountCheck, provider),
    checkAll: () => ipcRenderer.invoke(IpcChannels.AccountCheckAll),
    setBrowser: (provider, browser) => ipcRenderer.invoke(IpcChannels.AccountSetBrowser, provider, browser),
    setYouTubeBrowser: (browser) => ipcRenderer.invoke(IpcChannels.AccountSetYouTubeBrowser, browser),
    onStatusesChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, statuses: unknown): void => {
        handler(Array.isArray(statuses) ? (statuses as Awaited<ReturnType<EchoApi['accounts']['getStatuses']>>) : []);
      };
      ipcRenderer.on(IpcChannels.AccountStatusesChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AccountStatusesChanged, listener);
    },
  },
  spotify: {
    getAccessToken: () => ipcRenderer.invoke(IpcChannels.SpotifyGetAccessToken),
    getDevices: () => ipcRenderer.invoke(IpcChannels.SpotifyGetDevices),
    getPlaybackState: () => ipcRenderer.invoke(IpcChannels.SpotifyGetPlaybackState),
    ensureConnectDevice: (request) => ipcRenderer.invoke(IpcChannels.SpotifyEnsureConnectDevice, request),
    startPlayback: (request) => ipcRenderer.invoke(IpcChannels.SpotifyStartPlayback, request),
    transferPlayback: (request) => ipcRenderer.invoke(IpcChannels.SpotifyTransferPlayback, request),
    pause: (deviceId) => ipcRenderer.invoke(IpcChannels.SpotifyPause, deviceId),
    resume: (deviceId) => ipcRenderer.invoke(IpcChannels.SpotifyResume, deviceId),
    seek: (positionMs, deviceId) => ipcRenderer.invoke(IpcChannels.SpotifySeek, positionMs, deviceId),
    setVolume: (volume, deviceId) => ipcRenderer.invoke(IpcChannels.SpotifySetVolume, volume, deviceId),
  },
  eq: {
    getState: () => ipcRenderer.invoke(IpcChannels.EqGetState),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.EqSetEnabled, enabled),
    setBandGain: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandGain, request),
    setBandFrequency: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandFrequency, request),
    setBandQ: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandQ, request),
    setBandFilterType: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandFilterType, request),
    setBandEnabled: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandEnabled, request),
    setPreamp: (preampDb) => ipcRenderer.invoke(IpcChannels.EqSetPreamp, preampDb),
    setDspHeadroom: (headroomDb) => ipcRenderer.invoke(IpcChannels.EqSetDspHeadroom, headroomDb),
    setDspSafetyLimiterEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.EqSetDspSafetyLimiterEnabled, enabled),
    setPreset: (presetId) => ipcRenderer.invoke(IpcChannels.EqSetPreset, presetId),
    reset: () => ipcRenderer.invoke(IpcChannels.EqReset),
    listPresets: () => ipcRenderer.invoke(IpcChannels.EqListPresets),
    savePreset: (request) => ipcRenderer.invoke(IpcChannels.EqSavePreset, request),
    exportPreset: (request) => ipcRenderer.invoke(IpcChannels.EqExportPreset, request),
    exportApoPreset: (request) => ipcRenderer.invoke(IpcChannels.EqExportApoPreset, request),
    exportApoGraphicEqPreset: (request) => ipcRenderer.invoke(IpcChannels.EqExportApoGraphicEqPreset, request),
    previewImportPreset: () => ipcRenderer.invoke(IpcChannels.EqPreviewImportPreset),
    importPreset: () => ipcRenderer.invoke(IpcChannels.EqImportPreset),
    deletePreset: (presetId) => ipcRenderer.invoke(IpcChannels.EqDeletePreset, presetId),
    browseHeadphoneCorrections: (request) => ipcRenderer.invoke(IpcChannels.EqBrowseHeadphoneCorrections, request),
    searchHeadphoneCorrections: (request) => ipcRenderer.invoke(IpcChannels.EqSearchHeadphoneCorrections, request),
    applyHeadphoneCorrection: (request) => ipcRenderer.invoke(IpcChannels.EqApplyHeadphoneCorrection, request),
    listProfiles: () => ipcRenderer.invoke(IpcChannels.EqListProfiles),
    saveProfile: (request) => ipcRenderer.invoke(IpcChannels.EqSaveProfile, request),
    applyProfile: (profileId) => ipcRenderer.invoke(IpcChannels.EqApplyProfile, profileId),
    deleteProfile: (profileId) => ipcRenderer.invoke(IpcChannels.EqDeleteProfile, profileId),
    bindProfileToOutput: (request) => ipcRenderer.invoke(IpcChannels.EqBindProfileToOutput, request),
    getProfileBinding: (target) => ipcRenderer.invoke(IpcChannels.EqGetProfileBinding, target),
    getChannelBalanceState: async () => {
      const state = await ipcRenderer.invoke(IpcChannels.ChannelBalanceGetState) as ChannelBalanceState;
      applySystemChannelBalanceState(state);
      return state;
    },
    setChannelBalanceState: async (patch) => {
      const state = await ipcRenderer.invoke(IpcChannels.ChannelBalanceSetState, patch) as ChannelBalanceState;
      applySystemChannelBalanceState(state);
      return state;
    },
    resetChannelBalance: async () => {
      const state = await ipcRenderer.invoke(IpcChannels.ChannelBalanceReset) as ChannelBalanceState;
      applySystemChannelBalanceState(state);
      return state;
    },
    getRoomCorrectionState: () => ipcRenderer.invoke(IpcChannels.RoomCorrectionGetState) as Promise<RoomCorrectionState>,
    importRoomCorrectionIr: () => ipcRenderer.invoke(IpcChannels.RoomCorrectionImportIr) as Promise<RoomCorrectionState | null>,
    setRoomCorrectionEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.RoomCorrectionSetEnabled, enabled) as Promise<RoomCorrectionState>,
    setRoomCorrectionTrim: (trimDb) => ipcRenderer.invoke(IpcChannels.RoomCorrectionSetTrim, trimDb) as Promise<RoomCorrectionState>,
    clearRoomCorrection: () => ipcRenderer.invoke(IpcChannels.RoomCorrectionClear) as Promise<RoomCorrectionState>,
  },
  sleepTimer: {
    start: (request) => ipcRenderer.invoke(IpcChannels.SleepTimerStart, request),
    cancel: () => ipcRenderer.invoke(IpcChannels.SleepTimerCancel),
    getStatus: () => ipcRenderer.invoke(IpcChannels.SleepTimerGetStatus),
    onTick: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, remainingMs: unknown): void => {
        handler(typeof remainingMs === 'number' ? remainingMs : 0);
      };
      ipcRenderer.on(IpcChannels.SleepTimerOnTick, listener);
      return () => ipcRenderer.off(IpcChannels.SleepTimerOnTick, listener);
    },
  },
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const handleMainWindowPlaybackCommand = async (_event: Electron.IpcRendererEvent, rawRequest: unknown): Promise<void> => {
  if (!isMainPlaybackRenderer || !isPlainRecord(rawRequest) || typeof rawRequest.id !== 'string') {
    return;
  }

  const command = typeof rawRequest.command === 'string' ? rawRequest.command : '';
  const args = Array.isArray(rawRequest.args) ? rawRequest.args : [];
  if (!playbackProxyCommands.has(command)) {
    ipcRenderer.send(IpcChannels.PlaybackMainWindowCommandResult, {
      id: rawRequest.id,
      ok: false,
      error: 'unsupported_main_window_playback_command',
    });
    return;
  }

  try {
    let value: unknown = null;
    switch (command as MainPlaybackCommand) {
      case 'playLocalFile':
        value = await echoApi.playback.playLocalFile(args[0] as PlaybackStartRequest);
        break;
      case 'playMediaItem':
        value = await echoApi.playback.playMediaItem(args[0] as PlaybackMediaStartRequest);
        break;
      case 'play':
        value = await echoApi.playback.play();
        break;
      case 'pause':
        value = await echoApi.playback.pause();
        break;
      case 'stop':
        value = await echoApi.playback.stop();
        break;
      case 'seek':
        value = await echoApi.playback.seek(Number(args[0]));
        break;
    }

    ipcRenderer.send(IpcChannels.PlaybackMainWindowCommandResult, {
      id: rawRequest.id,
      ok: true,
      value,
    });
  } catch (error) {
    ipcRenderer.send(IpcChannels.PlaybackMainWindowCommandResult, {
      id: rawRequest.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

if (isMainPlaybackRenderer) {
  ipcRenderer.on(IpcChannels.PlaybackMainWindowCommandRequest, handleMainWindowPlaybackCommand);
}

contextBridge.exposeInMainWorld('echo', echoApi);
