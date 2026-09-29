import { EventEmitter } from 'node:events';
import { basename, extname } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Readable, Writable } from 'node:stream';
import { DeviceService } from './DeviceService';
import { DecoderPipeline } from './DecoderPipeline';
import {
  createEchoSrcFirPlan,
  createEchoSrcFirStagePlans,
  createEchoSrcFirTaps,
} from './EchoSrcFirEngine';
import { getEqBridge } from './EqBridge';
import { EqStateStore } from './EqStateStore';
import {
  PcmLevelMeterTransform,
  createAudioLevelTelemetry,
  createNativeAudioLevelTelemetry,
  visualSpectrumBucketCount,
  type PcmLevelSnapshot,
} from './AudioLevelMeter';
import type { EqProfileBindingTarget } from '../../shared/types/eq';
import { NativePcmHostProcess, isNativeOutputBridgeAvailable, startAudioDaemon, stopAudioDaemon, daemonBridge } from './NativePcmHostProcess';
import type { DaemonAudioBackend, DaemonOutputSettings, NativeDspProcessingConfig } from './DaemonAudioBackend';
import type { NativeDspProcessingStatus } from './JsonRpcBridge';
import { normalizeAudioInputSource } from './AudioBackend';
import type { AudioBackendQueueItem, AudioBackendQueueSnapshot, AudioInputSource } from './AudioBackend';
import { createAudioBackend } from './BackendFactory';
import { activeJsonRpcBridge } from './HostBridgeRegistry';
import { PlaybackClock } from './PlaybackClock';
import { isCueTrackPath } from './CueSheet';
import { isDsdCodec, isDsdFilePath, isDsfFilePath, resolveDsdDopTransportSampleRate, resolveDsdPcmOutputSampleRate, shouldProbeDsdNativeSampleRate } from './DsdProbe';
import { createDsfDopStream, createDsfNativeDsdStream, readDsfDopInfo } from './DsdDopPipeline';
import { resolveSdmDopTransportSampleRate, resolveSdmModulatorProfile, resolveSdmNativeSampleRate } from './SdmFormatPlan';
import { AutomixAnalyzer } from './AutomixAnalyzer';
import { planAutomixTransitionV2 } from './AutomixPlannerV2';
import { normalizeAudioSampleRate } from './SampleRateGuards';
import { isAlacCodec, isMp4ContainerPath } from './Mp4AudioCodec';
import { getAppSettings } from '../app/appSettings';
import { noteDataProtectionPlaybackActivity } from '../app/dataProtection';
import { buildNetworkProxyEnv } from '../network/proxyEnv';
import { markPlaybackBreadcrumb, runPlaybackPerformanceStep, runPlaybackPerformanceStepSync } from '../diagnostics/PlaybackPerformanceDiagnostics';
import { calculateReplayGain, dbToLinearGain, type ReplayGainCalculation, type ReplayGainTrackData } from '../../shared/utils/replayGain';
import { normalizeAudioSharedBackendForPlatform } from '../../shared/utils/audioPlatformCapabilities';
import {
  createEstimatedAutomixAnalysis,
  planAutomixTransition,
  type AutomixTransitionPlan,
  type TrackTransitionAnalysis,
} from './AutomixPlanner';
import {
  audioEchoSrcFilterProfiles,
  audioPcmDitherModes,
  audioSdmComputeBackends,
  audioSdmModes,
  audioSdmQualityProfiles,
  audioSdmTargetRates,
} from '../../shared/types/audio';
import type {
  AudioDeviceInfo,
  AudioDiagnostics,
  AudioEchoSrcComputeBackend,
  AudioEchoSrcFirProcessingMode,
  AudioEchoSrcFilterProfile,
  AudioEchoSrcFilterSlot,
  AudioEchoSrcMode,
  AudioEchoSrcQualityProfile,
  AudioEchoSrcRuntimeStatus,
  AudioLatencyProfile,
  AudioOutputMode,
  AudioOutputSettings,
  AudioPlaybackState,
  AudioProbeResult,
  AudioResamplerEngine,
  AudioSharedBackend,
  AudioSessionPlayPcmStreamRequest,
  AudioSessionPrepareLocalFileRequest,
  AudioSessionAutomixNextTrack,
  AudioSessionGaplessNextTrack,
  AudioSessionPlayRequest,
  AudioStatus,
  NativeDirectLocalPlaybackFallbackReason,
  DecoderRun,
  NativeBridgeReadyResult,
  NativeOutputTelemetry,
  NativeOutputStartOptions,
  PcmDecodeRequest,
  SampleRatePlan,
} from './audioTypes';
import type {
  ActiveDsdOutputMode,
  AudioDsdOutputMode,
  AudioLevelTelemetry,
  AudioPlaybackDiagnosticEvent,
  AudioPlaybackDiagnosticSeverity,
  AudioPlaybackIssueSummary,
  AudioPcmDitherMode,
  AudioSdmComputeBackend,
  AudioSdmMode,
  AudioSdmOversamplingEngine,
  AudioSdmQualityProfile,
  AudioSdmRuntimeStatus,
  AudioSdmRuntimeState,
  AudioSdmTargetRate,
  PlaybackSpeedMode,
  SharedStabilityTier,
} from '../../shared/types/audio';
import type {
  AutomixAnalysisV2,
  AutomixRuntimePhase,
  AutomixRuntimeState,
  AutomixTransitionCommittedEventV2,
  AutomixTransitionPlanV2,
} from '../../shared/types/automix';
import { automixAnalysisVersion, resolveAutomixRuntimePhase } from '../../shared/types/automix';
import type { PlaybackMemory } from './PlaybackMemoryStore';
import type { AudioCrashReportPayload } from '../diagnostics/CrashReportService';
import { hashText } from '../diagnostics/Logger';
import { PcmVolumeTransform } from './transforms/PcmVolumeTransform';
import { PcmPlaybackRateTransform } from './transforms/PcmPlaybackRateTransform';
import { PcmLinearResamplerTransform } from './transforms/PcmLinearResamplerTransform';
import { normalizeStabilityRecoveryOptions } from './helpers/stabilityHelpers';
import {
  createOutputFallbackSettingsPolicy,
  hasExplicitDeviceSelection,
  isAutomaticDirectSoundFallbackError,
  isDefaultDeviceFallbackAllowed,
  isOutputStartRetryMode,
  isSharedFallbackAllowedForExclusive,
} from './OutputFallbackPolicy';
import {
  fallbackSampleRate,
  fallbackSharedMixSampleRate,
  maxReliableSharedOutputSampleRate,
  maxEchoSrcPcmTargetSampleRate,
  recommendedWindowsSharedDefaultSampleRate,
  preparedLocalPlaybackTtlMs,
  preparedLocalPlaybackMaxItems,
  defaultWatchdogIntervalMs,
  defaultWatchdogStallChecks,
  defaultWatchdogMaxRecoveriesPerTrack,
  defaultWatchdogRecoveryWindowMs,
  watchdogPositionEpsilonSeconds,
  unexpectedPositionJumpEarlyMinimumSeconds,
  unexpectedPositionJumpEarlyToleranceSeconds,
  unexpectedPositionJumpGuardMs,
  nativeStartupPositionGuardWindowMs,
  nativeStartupPositionDriftToleranceSeconds,
  nativeStartupPositionDriftMaxRebaseSeconds,
  playbackDiagnosticEventLimit,
  nativeUnderrunWindowMs,
  pausedOutputPrewarmResumeWaitMs,
  heldHttpDecoderTimelineLeadCapSeconds,
  nativeUnderrunCallbackThreshold,
  nativeUnderrunFramesThresholdMs,
  exclusiveNativeUnderrunStartupGraceMs,
  nativeTelemetryStatusIntervalMs,
  nativeStartupTelemetryLogWindowMs,
  nativeStartupTelemetryLogIntervalMs,
  exclusiveInstabilityFallbackDisabledLogCooldownMs,
  levelMeterVisualIntervalMs,
  levelMeterStatusIntervalMs,
  levelMeterNonVisualStatusIntervalMs,
  mainEventLoopLagSampleIntervalMs,
  isAudioVisualSpectrumEnabled,
  isPlaybackIntegrationVisualTelemetryActive,
  sharedStabilityMemoryTtlMs,
} from './helpers/playbackDefaults';
import { runtimeCpuModel, inactiveDeviceReasons, isNativeHostNotificationEvent } from './helpers/deviceHelpers';
import {
  getReplayGainAudioSettings,
} from './helpers/replayGainHelpers';
import {
  defaultTransportFadeDurationMs,
  defaultTransportFadeStepMs,
  defaultTransportFadeCurve,
  normalizeTransportFadeDurationMs,
  normalizeTransportFadeCurve,
  applyTransportFadeCurve,
  type TransportFadeDirection,
  type TransportFadeSettings,
} from './helpers/transportHelpers';
import {
  sharedLowLatencyProfile,
  sharedStabilityProfiles,
  stableSharedProfile,
  echoSrcUltraOutputProfile,
  nativeAdaptiveOutputProfiles,
  nativeExclusiveFeedProfile,
  httpStreamingSharedProfile,
  directSoundSharedProfile,
  type SharedOutputProfile,
} from './helpers/stabilityHelpers';
import type {
  ActiveAutomixState,
  ActiveAutomixTransition,
  AudioErrorRecoveryHandler,
  AudioSessionDependencies,
  AutomixAnalyzerLike,
  DecoderPipelineLike,
  DeviceServiceLike,
  LocalPrepareContext,
  NativeAutomixPlayback,
  PausedDecoderPrewarm,
  PositionSample,
  PreparedLocalPlaybackItem,
  PreparedLocalProbeUse,
  StabilityRecoveryOptions,
} from './AudioSessionTypes';

export type { AudioErrorRecoveryHandler, AudioSessionDependencies } from './AudioSessionTypes';

type OutputBridgeLike = Omit<NativePcmHostProcess, 'beginSession' | 'start' | 'stopGracefully' | 'syncDspState' | 'activateDspControl'> & {
  beginSession?: (
    options?: { startSeconds?: number; playbackRate?: number; durationSeconds?: number } & Record<string, unknown>,
  ) => number;
  start: (
    options: NativeOutputStartOptions & Record<string, unknown>,
  ) => Promise<NativeBridgeReadyResult>;
  stopGracefully?: (reason?: string, timeoutMs?: number, waitForExit?: boolean) => Promise<void>;
  syncDspState?: (profileTarget?: EqProfileBindingTarget) => Promise<void>;
  activateDspControl?: () => void;
};
type BridgeEventListeners = {
  position: (frames: unknown, telemetry?: unknown) => void;
  ended: () => void;
  error: (error: unknown) => void;
  deviceEvent: (event: unknown) => void;
};
type BridgeStartResult = {
  bridge: OutputBridgeLike;
  plan: SampleRatePlan;
  ready: NativeBridgeReadyResult;
  hostReused: boolean;
  hostRestartReason: string | null;
};
type StartOutputBridgeOptions = {
  allowNativeDirectLocalPlaybackChannelMapping?: boolean;
};

const isAudioSessionRunCancelledError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);

  return message.includes('audio_session_run_cancelled');
};
const isLivePcmSourcePath = (filePath: string | null | undefined): boolean =>
  typeof filePath === 'string' && filePath.startsWith('airplay-receiver:');
const sharedReplacementGracefulStopTimeoutMs = 750;
const releaseExclusiveOnPauseGracefulStopTimeoutMs = 1_500;
const releaseExclusiveOnPausePlayWaitTimeoutMs = 900;
const decoderStopTimeoutMs = 500;
const decoderStopForcedExitWaitMs = 250;
const sdmNativeOutputReadyTimeoutMs = 3_000;
const latencyProfiles: Record<AudioLatencyProfile, Pick<NativeOutputStartOptions, 'bufferSizeFrames'>> = {
  lowLatency: {
    bufferSizeFrames: 1024,
  },
  balanced: {
    bufferSizeFrames: 2048,
  },
  stable: {
    bufferSizeFrames: 8192,
  },
};

const lowLatencyMaxBufferSizeFrames = 2048;
const lowLatencyBufferClampedWarning = `low_latency_buffer_clamped:${lowLatencyMaxBufferSizeFrames}`;
const lowLatencyBufferIgnoredWarning = 'low_latency_buffer_ignored';
const exclusiveLowLatencyMinimumBufferMs = 8;
const exclusiveLowLatencyBufferStepFrames = 128;

const defaultLatencyProfileForMode = (_outputMode: AudioOutputMode): AudioLatencyProfile => 'balanced';

const defaultLogger = (message: string): void => {
  console.warn(message);
};
const defaultDiagnosticLogger = (message: string): void => {
  console.info(message);
};
const noopLogger = (): void => undefined;

const verboseAudioLogsEnabled = process.env.ECHO_VERBOSE_AUDIO_LOGS === '1';

const shouldLogPlaybackDiagnosticEvent = (event: AudioPlaybackDiagnosticEvent): boolean => {
  if (event.kind === 'startup_telemetry') {
    return false;
  }

  if (event.kind === 'position_jump_suspected' && event.reason === 'guarded_position_jump_ignored') {
    return false;
  }

  return (
    event.severity !== 'info' ||
    event.kind === 'play_request' ||
    event.kind === 'output_ready' ||
    (event.warnings?.length ?? 0) > 0
  );
};

const defaultAudioErrorReporter = (payload: AudioCrashReportPayload): void => {
  void import('../diagnostics/CrashReportService')
    .then(({ getCrashReportService }) => {
      getCrashReportService().reportAudioError(payload);
    })
    .catch(() => undefined);
};

const normalizePositiveInteger = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.round(numberValue) : null;
};

const capSharedOutputSampleRate = (sampleRate: number): number =>
  sampleRate > maxReliableSharedOutputSampleRate ? maxReliableSharedOutputSampleRate : sampleRate;

const createWindowsSharedDefaultFormatWarning = (
  platform: NodeJS.Platform | string,
  outputMode: AudioOutputMode,
  sharedDeviceSampleRate: number | null,
): string | null => {
  if (
    platform !== 'win32' ||
    outputMode !== 'shared' ||
    sharedDeviceSampleRate === null ||
    sharedDeviceSampleRate <= recommendedWindowsSharedDefaultSampleRate
  ) {
    return null;
  }

  return `windows_audio_default_format_unusual:${sharedDeviceSampleRate}`;
};

const normalizeResetReason = (reason: string): string => {
  const normalized = reason.trim().replace(/[\r\n]+/gu, ' ').slice(0, 96);

  return normalized || 'force-restart';
};

const isHttpPlaybackUrl = (value: string): boolean => /^https?:\/\//iu.test(value.trim());
const isLocalPlaybackPath = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0 && !isHttpPlaybackUrl(value) && !isLivePcmSourcePath(value);
const localDirectPlaybackPilotExtensions = new Set([
  '.wav',
  '.wave',
  '.aif',
  '.aiff',
  '.aifc',
  '.flac',
  '.fla',
  '.m4a',
  '.mp3',
  '.ogg',
  '.oga',
  '.dsf',
  '.dff',
]);

const createPossibleCorruptAudioFileError = (positionSeconds: number, durationSeconds: number): Error =>
  new Error(
    `audio_file_decode_failed_or_corrupt; positionSeconds=${positionSeconds.toFixed(3)}; durationSeconds=${durationSeconds.toFixed(3)}`,
  );

const prematureLocalEndToleranceSeconds = 20;
const corruptLocalEndRatioThreshold = 0.5;
const localPlaybackAutoRecoveryWindowMs = 5 * 60 * 1000;
const localPlaybackAutoRecoveryMaxAttempts = 1;
const recoverableLocalDecodeErrorPattern =
  /\baudio_file_decode_failed_or_corrupt\b|\bkind="input_invalid"\b|invalid data found when processing input|decode_frame\(\) failed|error while decoding stream/iu;
const nativeDirectLocalPlaybackErrorPattern = /\bdirect_pcm_reader_failed\b/iu;
const recoverableDaemonRemotePlaybackErrorPattern =
  /\bdaemon_rpc_bridge_closed\b|\brpc_bridge_(?:closed|not_open)\b|\bavcodec_(?:receive_frame|send_packet) failed\b|\bav_read_frame failed\b|invalid data found when processing input|input\/output error|connection (?:reset|timed out)|network is unreachable/iu;
const isClearlyCorruptLocalEnd = (positionSeconds: number, durationSeconds: number): boolean =>
  durationSeconds > 0 &&
  positionSeconds < durationSeconds - prematureLocalEndToleranceSeconds &&
  positionSeconds / durationSeconds < corruptLocalEndRatioThreshold;

const isLocalDirectPlaybackPilotPath = (value: string): boolean => {
  if (isHttpPlaybackUrl(value) || isCueTrackPath(value)) {
    return false;
  }

  const extension = extname(value).toLowerCase();
  return localDirectPlaybackPilotExtensions.has(extension);
};

const isNativeDaemonLocalSourceSupported = (filePath: string, probe: AudioProbeResult): boolean =>
  isLocalDirectPlaybackPilotPath(filePath) ||
  (isMp4ContainerPath(filePath) && isAlacCodec(probe.codec));

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

const resolveBufferSizeFrames = (
  settings: AudioOutputSettings | undefined,
  fallback: number | null | undefined,
): number | undefined => {
  if (!settings || !hasOwn(settings, 'bufferSizeFrames')) {
    return fallback ?? undefined;
  }

  return normalizePositiveInteger(settings.bufferSizeFrames) ?? undefined;
};

const sanitizeLowLatencyBuffer = (
  outputMode: AudioOutputMode,
  latencyProfile: AudioLatencyProfile,
  bufferSizeFrames: number | undefined,
): { bufferSizeFrames: number | undefined; warning: string | null } => {
  if (latencyProfile !== 'lowLatency' || bufferSizeFrames === undefined || bufferSizeFrames <= lowLatencyMaxBufferSizeFrames) {
    return { bufferSizeFrames, warning: null };
  }

  if (outputMode === 'shared') {
    return { bufferSizeFrames: undefined, warning: lowLatencyBufferIgnoredWarning };
  }

  return { bufferSizeFrames: lowLatencyMaxBufferSizeFrames, warning: lowLatencyBufferClampedWarning };
};

const isWritableUsable = (writable: Writable | null): writable is Writable =>
  Boolean(writable && !writable.destroyed && !writable.writableEnded);

const normalizeOutputMode = (value: unknown): AudioOutputMode => {
  return value === 'exclusive' || value === 'asio' || value === 'system' ? value : 'shared';
};

const normalizeSharedBackend = (value: unknown): AudioSharedBackend => {
  return normalizeAudioSharedBackendForPlatform(value as AudioSharedBackend | undefined, process.platform);
};

const {
  createSharedFallbackSettings,
  createSafeSharedFallbackSettings,
  createAutomaticDirectSoundFallbackSettings,
} = createOutputFallbackSettingsPolicy(normalizeSharedBackend);

const normalizeDsdOutputMode = (value: unknown): AudioDsdOutputMode => (value === 'dop' ? 'dop' : 'pcm');

const isResidentOutputMode = (value: unknown): boolean => {
  const mode = normalizeOutputMode(value);
  return mode === 'exclusive' || mode === 'asio';
};

const canReuseResidentOutputBridge = (_outputMode: AudioOutputMode): boolean => {
  return true;
};

const normalizeLatencyProfile = (value: unknown): AudioLatencyProfile => {
  return value === 'stable' || value === 'lowLatency' ? value : 'balanced';
};

const resolveSupportedLatencyProfile = (
  _outputMode: AudioOutputMode,
  latencyProfile: AudioLatencyProfile,
): AudioLatencyProfile => {
  return latencyProfile;
};

const resolveLatencyProfile = (
  nextOutputMode: AudioOutputMode,
  requestedLatencyProfile: unknown,
  previousOutputMode: AudioOutputMode,
  previousLatencyProfile: AudioLatencyProfile,
  outputModeWasRequested: boolean,
): AudioLatencyProfile => {
  if (requestedLatencyProfile !== undefined) {
    return resolveSupportedLatencyProfile(nextOutputMode, normalizeLatencyProfile(requestedLatencyProfile));
  }

  if (outputModeWasRequested && nextOutputMode !== previousOutputMode) {
    return defaultLatencyProfileForMode(nextOutputMode);
  }

  return resolveSupportedLatencyProfile(nextOutputMode, previousLatencyProfile ?? defaultLatencyProfileForMode(nextOutputMode));
};

const roundUpToExclusiveLowLatencyStep = (frames: number): number =>
  Math.ceil(frames / exclusiveLowLatencyBufferStepFrames) * exclusiveLowLatencyBufferStepFrames;

const getLatencyProfileBufferSizeFrames = (
  outputMode: AudioOutputMode,
  latencyProfile: AudioLatencyProfile,
  requestedOutputSampleRate: number,
): number => {
  const baseBufferSizeFrames = latencyProfiles[latencyProfile].bufferSizeFrames ?? 2048;

  if (outputMode !== 'exclusive' || latencyProfile !== 'lowLatency') {
    return baseBufferSizeFrames;
  }

  const sampleRate = normalizePositiveInteger(requestedOutputSampleRate) ?? 48000;
  const minimumFrames = Math.ceil((sampleRate * exclusiveLowLatencyMinimumBufferMs) / 1000);
  return Math.max(baseBufferSizeFrames, roundUpToExclusiveLowLatencyStep(minimumFrames));
};

export const normalizePlaybackRate = (value: unknown): number => {
  const rate = Number(value);
  return Number.isFinite(rate) ? Math.max(0.5, Math.min(2, rate)) : 1;
};

const normalizePlaybackSpeedMode = (value: unknown): PlaybackSpeedMode => {
  return value === 'daycore' || value === 'speed' ? value : 'nightcore';
};

const normalizeEchoSrcMode = (value: unknown): AudioEchoSrcMode =>
  value === 'compatibility48' || value === 'family2x' || value === 'family4x' || value === 'family8x' ? value : 'off';

const normalizeEchoSrcQualityProfile = (value: unknown): AudioEchoSrcQualityProfile =>
  value === 'balanced' || value === 'lowLatency' ? value : 'transparent';

const normalizeEchoSrcFilterProfile = (value: unknown): AudioEchoSrcFilterProfile =>
  typeof value === 'string' && (audioEchoSrcFilterProfiles as readonly string[]).includes(value)
    ? value as AudioEchoSrcFilterProfile
    : 'poly-sinc-gauss-long';

const resolveEchoSrcFilterSlot = (sourceSampleRate: number | null): AudioEchoSrcFilterSlot | null => {
  if (!sourceSampleRate) {
    return null;
  }
  return sourceSampleRate < 50_000 ? '1x' : 'nx';
};

const resolveEchoSrcFilterProfileForSlot = (
  slot: AudioEchoSrcFilterSlot | null,
  settings: Pick<AudioOutputSettings, 'echoSrcFilterProfile' | 'echoSrcFilterProfile1x' | 'echoSrcFilterProfileNx'>,
): AudioEchoSrcFilterProfile => {
  const legacyProfile = normalizeEchoSrcFilterProfile(settings.echoSrcFilterProfile);
  if (slot === 'nx') {
    return normalizeEchoSrcFilterProfile(settings.echoSrcFilterProfileNx ?? 'poly-sinc-hb');
  }

  return normalizeEchoSrcFilterProfile(settings.echoSrcFilterProfile1x ?? legacyProfile);
};

const normalizeEchoSrcComputeBackend = (value: unknown): AudioEchoSrcComputeBackend =>
  value === 'cuda' ? 'cuda' : 'cpu';

const normalizePcmDitherMode = (value: unknown): AudioPcmDitherMode =>
  typeof value === 'string' && (audioPcmDitherModes as readonly string[]).includes(value)
    ? value as AudioPcmDitherMode
    : 'off';

const normalizeSdmMode = (value: unknown): AudioSdmMode =>
  typeof value === 'string' && (audioSdmModes as readonly string[]).includes(value)
    ? value as AudioSdmMode
    : 'off';

const normalizeSdmTargetRate = (value: unknown): AudioSdmTargetRate =>
  typeof value === 'string' && (audioSdmTargetRates as readonly string[]).includes(value)
    ? value as AudioSdmTargetRate
    : 'dsd128';

const normalizeSdmQualityProfile = (value: unknown): AudioSdmQualityProfile =>
  typeof value === 'string' && (audioSdmQualityProfiles as readonly string[]).includes(value)
    ? value as AudioSdmQualityProfile
    : 'safe';

const normalizeSdmComputeBackend = (value: unknown): AudioSdmComputeBackend =>
  typeof value === 'string' && (audioSdmComputeBackends as readonly string[]).includes(value)
    ? value as AudioSdmComputeBackend
    : 'cpu';

const realtimePcmToSdmTargetRates = new Set<AudioSdmTargetRate>(['dsd64', 'dsd128', 'dsd256']);

const resolveSdmRuntimeState = (
  mode: AudioSdmMode,
  activeDsdOutputMode: ActiveDsdOutputMode,
  pcmToSdmActive = false,
): AudioSdmRuntimeState => {
  if (mode === 'pcmToDsd' && pcmToSdmActive) {
    return 'pcm_to_sdm_active';
  }

  if (mode === 'pcmToDsd') {
    return 'pcm_to_sdm_not_routed';
  }

  if (mode === 'dsdPassthrough' && (activeDsdOutputMode === 'dop' || activeDsdOutputMode === 'native')) {
    return 'dsd_passthrough';
  }

  return 'off';
};

const normalizeEchoSrcUpsampleFactor = (sourceSampleRate: number | null, targetSampleRate: number | null): 1 | 2 | 4 | 8 | null => {
  if (!sourceSampleRate || !targetSampleRate || sourceSampleRate <= 0 || targetSampleRate <= 0) {
    return null;
  }

  const factor = targetSampleRate / sourceSampleRate;
  return factor === 1 || factor === 2 || factor === 4 || factor === 8 ? factor : null;
};

type EchoSrcFirBlockPlan = {
  processingMode: AudioEchoSrcFirProcessingMode;
  maxBlockFrames: number;
  targetBatchFrames: number;
};

const resolveSdmBlockPlan = (
  targetRate: AudioSdmTargetRate,
): EchoSrcFirBlockPlan => {
  return {
    processingMode: 'realtime',
    maxBlockFrames: targetRate === 'dsd128' ? 4096 : 2048,
    targetBatchFrames: 1,
  };
};

type SdmOversamplingPlan = {
  engine: AudioSdmOversamplingEngine;
  qualityProfile: AudioEchoSrcQualityProfile;
  filterProfile1x: AudioEchoSrcFilterProfile;
  filterProfileNx: AudioEchoSrcFilterProfile;
  filterSlot: AudioEchoSrcFilterSlot | null;
  sourceSampleRate: number | null;
  targetSampleRate: number | null;
  factor: number | null;
  precision: number;
};

const resolveSdmOversamplingFilterProfiles = (
  qualityProfile: AudioSdmQualityProfile,
): Pick<SdmOversamplingPlan, 'filterProfile1x' | 'filterProfileNx'> => {
  if (qualityProfile === 'insane') {
    return {
      filterProfile1x: 'sinc-long-h',
      filterProfileNx: 'poly-sinc-gauss-xla',
    };
  }

  if (qualityProfile === 'reference') {
    return {
      filterProfile1x: 'poly-sinc-ext2-long',
      filterProfileNx: 'poly-sinc-ext2-hires-lp',
    };
  }

  if (qualityProfile === 'hifi') {
    return {
      filterProfile1x: 'poly-sinc-gauss-long',
      filterProfileNx: 'poly-sinc-gauss-hires-lp',
    };
  }

  return {
    filterProfile1x: 'sinc-long',
    filterProfileNx: 'poly-sinc-hb',
  };
};

const resolveSdmOversamplingPlan = (
  qualityProfile: AudioSdmQualityProfile,
  sourceSampleRate: number | null,
  targetSampleRate: number | null,
  engine: AudioSdmOversamplingEngine = 'soxr',
  filterOverrides: Partial<Pick<SdmOversamplingPlan, 'filterProfile1x' | 'filterProfileNx'>> = {},
): SdmOversamplingPlan => {
  const normalizedSourceSampleRate = normalizeAudioSampleRate(sourceSampleRate);
  const normalizedTargetSampleRate = normalizeAudioSampleRate(targetSampleRate);
  const factor = normalizedSourceSampleRate && normalizedTargetSampleRate
    ? Math.round((normalizedTargetSampleRate / normalizedSourceSampleRate) * 100) / 100
    : null;
  const filterSlot = resolveEchoSrcFilterSlot(normalizedSourceSampleRate);
  const filters = resolveSdmOversamplingFilterProfiles(qualityProfile);
  const filterProfile1x = normalizeEchoSrcFilterProfile(filterOverrides.filterProfile1x ?? filters.filterProfile1x);
  const filterProfileNx = normalizeEchoSrcFilterProfile(filterOverrides.filterProfileNx ?? filters.filterProfileNx);

  return {
    engine,
    qualityProfile: 'transparent',
    filterProfile1x,
    filterProfileNx,
    filterSlot,
    sourceSampleRate: normalizedSourceSampleRate,
    targetSampleRate: normalizedTargetSampleRate,
    factor,
    precision: 28,
  };
};

const resolveSdmOversamplingEffectiveFilterProfile = (
  plan: SdmOversamplingPlan,
): AudioEchoSrcFilterProfile =>
  plan.filterSlot === 'nx' ? plan.filterProfileNx : plan.filterProfile1x;

const createEchoSrcRuntimeStatus = (
  state: AudioEchoSrcRuntimeStatus['state'],
  options: {
    sourceSampleRate: number | null;
    targetSampleRate: number | null;
    filterProfile: AudioEchoSrcFilterProfile | null;
    filterSlot?: AudioEchoSrcFilterSlot | null;
    qualityProfile: AudioEchoSrcQualityProfile | null;
    requestedBackend: AudioEchoSrcRuntimeStatus['requestedBackend'];
    activeBackend: AudioEchoSrcRuntimeStatus['activeBackend'];
    cudaActive?: boolean;
    fallbackReason?: string | null;
    firStageCount?: number | null;
    firStageTapCounts?: number[] | null;
    firStageProfiles?: AudioEchoSrcFilterProfile[] | null;
    firTotalTapCount?: number | null;
    firProcessingMode?: AudioEchoSrcFirProcessingMode | null;
    firBatchFrames?: number | null;
    firMaxBlockFrames?: number | null;
  },
): AudioEchoSrcRuntimeStatus => {
  const sourceSampleRate = normalizeAudioSampleRate(options.sourceSampleRate);
  const targetSampleRate = normalizeAudioSampleRate(options.targetSampleRate);
  const firPlan = options.filterProfile && sourceSampleRate && targetSampleRate
    ? createEchoSrcFirPlan(options.filterProfile, sourceSampleRate, targetSampleRate)
    : null;

  return {
    state,
    sourceSampleRate,
    targetSampleRate,
    requestedBackend: options.requestedBackend,
    activeBackend: options.activeBackend,
    filterProfile: options.filterProfile,
    filterSlot: options.filterSlot ?? null,
    qualityProfile: options.qualityProfile,
    tapCount: options.firTotalTapCount ?? firPlan?.tapCount ?? null,
    firStageCount: options.firStageCount ?? null,
    firStageTapCounts: options.firStageTapCounts ?? null,
    firStageProfiles: options.firStageProfiles ?? null,
    firProcessingMode: options.firProcessingMode ?? null,
    firBatchFrames: options.firBatchFrames ?? null,
    firMaxBlockFrames: options.firMaxBlockFrames ?? null,
    firLastInputFrames: null,
    firLastOutputFrames: null,
    firWorkerRequests: null,
    firWorkerAverageMs: null,
    firWorkerLastMs: null,
    firRealtimeRatio: null,
    nominalLatencyFrames: null,
    nominalLatencyMilliseconds: null,
    limiterCeilingDb: null,
    limiterGainReductionDb: null,
    limiterProtecting: false,
    window: firPlan?.window ?? null,
    phase: firPlan?.phase ?? null,
    normalizedCutoff: firPlan?.normalizedCutoff ?? null,
    transitionRatio: firPlan?.transitionRatio ?? null,
    stopbandAttenuationDb: firPlan?.attenuationDb ?? null,
    impulsePeakIndex: null,
    impulseEnergyCentroid: null,
    preRingingEnergyRatio: null,
    measuredStopbandPeakDb: null,
    measuredPassbandRippleDb: null,
    cudaActive: options.cudaActive === true,
    fallbackReason: options.fallbackReason ?? null,
  };
};

const createSdmOversamplingRuntimeStatus = (
  plan: SdmOversamplingPlan | null,
  options: {
    state?: AudioEchoSrcRuntimeStatus['state'];
    requestedBackend?: AudioEchoSrcRuntimeStatus['requestedBackend'];
    activeBackend?: AudioEchoSrcRuntimeStatus['activeBackend'];
    fallbackReason?: string | null;
    firStageCount?: number | null;
    firStageTapCounts?: number[] | null;
    firStageProfiles?: AudioEchoSrcFilterProfile[] | null;
    firTotalTapCount?: number | null;
    firProcessingMode?: AudioEchoSrcFirProcessingMode | null;
    firBatchFrames?: number | null;
    firMaxBlockFrames?: number | null;
  } = {},
): AudioEchoSrcRuntimeStatus | null => {
  if (!plan) {
    return null;
  }

  const firBackend = plan.engine === 'echo-fir';
  const defaultBackend: AudioEchoSrcRuntimeStatus['requestedBackend'] =
    firBackend ? 'cuda' : plan.engine === 'default' ? 'default' : 'soxr';
  const requestedBackend: AudioEchoSrcRuntimeStatus['requestedBackend'] = options.requestedBackend ?? defaultBackend;
  const activeBackend: AudioEchoSrcRuntimeStatus['activeBackend'] = options.activeBackend ?? (firBackend ? null : defaultBackend);

  return createEchoSrcRuntimeStatus(options.state ?? (firBackend ? 'planned' : 'active'), {
    sourceSampleRate: plan.sourceSampleRate,
    targetSampleRate: plan.targetSampleRate,
    filterProfile: firBackend ? resolveSdmOversamplingEffectiveFilterProfile(plan) : null,
    filterSlot: plan.filterSlot,
    qualityProfile: plan.qualityProfile,
    requestedBackend,
    activeBackend,
    cudaActive: activeBackend === 'cuda',
    fallbackReason: options.fallbackReason ?? null,
    firStageCount: options.firStageCount ?? null,
    firStageTapCounts: options.firStageTapCounts ?? null,
    firStageProfiles: options.firStageProfiles ?? null,
    firTotalTapCount: options.firTotalTapCount ?? null,
    firProcessingMode: options.firProcessingMode ?? null,
    firBatchFrames: options.firBatchFrames ?? null,
    firMaxBlockFrames: options.firMaxBlockFrames ?? null,
  });
};

const createSdmRuntimeStatus = (
  state: AudioSdmRuntimeStatus['state'],
  options: {
    targetRate: AudioSdmTargetRate | null;
    nativeSampleRate: number | null;
    transportSampleRate: number | null;
    modulatorProfile: AudioSdmRuntimeStatus['modulatorProfile'];
    requestedBackend: AudioSdmRuntimeStatus['requestedBackend'];
    activeBackend: AudioSdmRuntimeStatus['activeBackend'];
    oversamplingPlan?: SdmOversamplingPlan | null;
    oversamplingRuntime?: AudioEchoSrcRuntimeStatus | null;
    processingMode?: AudioEchoSrcFirProcessingMode | null;
    batchFrames?: number | null;
    maxBlockFrames?: number | null;
    cudaActive?: boolean;
    fallbackReason?: string | null;
  },
): AudioSdmRuntimeStatus => ({
  state,
  requestedBackend: options.requestedBackend,
  activeBackend: options.activeBackend,
  targetRate: options.targetRate,
  nativeSampleRate: normalizeAudioSampleRate(options.nativeSampleRate),
  transportSampleRate: normalizeAudioSampleRate(options.transportSampleRate),
  oversamplingEngine: options.oversamplingPlan?.engine ?? null,
  oversamplingQualityProfile: options.oversamplingPlan?.qualityProfile ?? null,
  oversamplingFilterProfile1x: options.oversamplingPlan?.filterProfile1x ?? null,
  oversamplingFilterProfileNx: options.oversamplingPlan?.filterProfileNx ?? null,
  oversamplingFilterSlot: options.oversamplingPlan?.filterSlot ?? null,
  oversamplingSourceSampleRate: options.oversamplingPlan?.sourceSampleRate ?? null,
  oversamplingTargetSampleRate: options.oversamplingPlan?.targetSampleRate ?? null,
  oversamplingFactor: options.oversamplingPlan?.factor ?? null,
  oversamplingPrecision: options.oversamplingPlan?.precision ?? null,
  oversamplingRuntime: options.oversamplingRuntime ?? createSdmOversamplingRuntimeStatus(options.oversamplingPlan ?? null),
  modulatorProfile: options.modulatorProfile,
  processingMode: options.processingMode ?? null,
  batchFrames: options.batchFrames ?? null,
  maxBlockFrames: options.maxBlockFrames ?? null,
  lastInputFrames: null,
  lastOutputFrames: null,
  cudaActive: options.cudaActive === true,
  fallbackReason: options.fallbackReason ?? null,
  workerRequests: null,
  workerAverageMs: null,
  workerLastMs: null,
  realtimeRatio: null,
});

const applyNativeDspProcessingStatus = (
  plan: SampleRatePlan,
  processing: NativeDspProcessingStatus | null,
): SampleRatePlan => {
  if (!processing) {
    return plan;
  }

  const echoSrc = processing.echoSrc;
  const echoSrcLastInputFrames = (echoSrc.lastInputFrames ?? 0) > 0
    ? echoSrc.lastInputFrames ?? null
    : null;
  const echoSrcLastOutputFrames = (echoSrc.lastOutputFrames ?? 0) > 0
    ? echoSrc.lastOutputFrames ?? null
    : null;
  const echoSrcLastProcessMs = (echoSrc.lastProcessMilliseconds ?? 0) > 0
    ? echoSrc.lastProcessMilliseconds ?? null
    : null;
  const echoSrcRealtimeRatio =
    echoSrcLastInputFrames && echoSrcLastProcessMs && (echoSrc.sourceSampleRate ?? 0) > 0
      ? echoSrcLastProcessMs / (echoSrcLastInputFrames / (echoSrc.sourceSampleRate as number) * 1_000)
      : null;
  // Plain family 2x/4x/8x SRC is performed by the host Libav decode rate.
  // Its FIR telemetry is intentionally inactive, so it must not be mistaken
  // for an unavailable resampler. Only the advanced host-owned FIR route is
  // authoritative here.
  const echoSrcRuntime = plan.echoSrcRuntime && plan.echoSrcFirActive
    ? {
      ...plan.echoSrcRuntime,
      state: !echoSrc.active
        ? 'unavailable' as const
        : echoSrc.fallbackReason
          ? 'fallback' as const
          : 'active' as const,
      sourceSampleRate: echoSrc.sourceSampleRate ?? plan.echoSrcRuntime.sourceSampleRate,
      targetSampleRate: echoSrc.targetSampleRate ?? plan.echoSrcRuntime.targetSampleRate,
      requestedBackend: echoSrc.requestedBackend ?? plan.echoSrcRuntime.requestedBackend,
      activeBackend: echoSrc.activeBackend,
      firStageCount: echoSrc.stageCount,
      cudaActive: echoSrc.activeBackend === 'cuda',
      fallbackReason: echoSrc.fallbackReason,
      lastInputFrames: echoSrcLastInputFrames,
      lastOutputFrames: echoSrcLastOutputFrames,
      workerRequests: echoSrc.processedBlocks ?? null,
      workerAverageMs: echoSrc.averageProcessMilliseconds ?? null,
      workerLastMs: echoSrcLastProcessMs,
      realtimeRatio: echoSrcRealtimeRatio,
      nominalLatencyFrames: echoSrc.nominalLatencyFrames ?? null,
      nominalLatencyMilliseconds: echoSrc.nominalLatencyMilliseconds ?? null,
      limiterCeilingDb: processing.limiter?.active === true
        ? processing.limiter.ceilingDb
        : null,
      limiterGainReductionDb: processing.limiter?.active === true
        ? processing.limiter.gainReductionDb
        : null,
      limiterProtecting: processing.limiter?.protecting === true,
    }
    : plan.echoSrcRuntime;

  const sdm = processing.sdm;
  const sdmLastInputFrames = (sdm.lastInputFrames ?? 0) > 0
    ? sdm.lastInputFrames ?? null
    : null;
  const sdmLastOutputFrames = (sdm.lastOutputFrames ?? 0) > 0
    ? sdm.lastOutputFrames ?? null
    : null;
  const sdmLastProcessMs = (sdm.lastProcessMilliseconds ?? 0) > 0
    ? sdm.lastProcessMilliseconds ?? null
    : null;
  const sdmRealtimeRatio =
    sdmLastInputFrames && sdmLastProcessMs && (sdm.sourceSampleRate ?? 0) > 0
      ? sdmLastProcessMs / (sdmLastInputFrames / (sdm.sourceSampleRate as number) * 1_000)
      : null;
  const sdmRuntime = plan.sdmRuntime && plan.sdmPcmToDsdActive
    ? {
      ...plan.sdmRuntime,
      state: !sdm.active
        ? 'unavailable' as const
        : sdm.fallbackReason
          ? 'fallback' as const
          : 'active' as const,
      requestedBackend: sdm.requestedBackend ?? plan.sdmRuntime.requestedBackend,
      activeBackend: sdm.modulatorBackend ?? sdm.activeBackend,
      cudaActive: (sdm.modulatorBackend ?? sdm.activeBackend) === 'cuda',
      fallbackReason: sdm.fallbackReason,
      lastInputFrames: sdmLastInputFrames,
      lastOutputFrames: sdmLastOutputFrames,
      workerRequests: sdm.processedBlocks ?? null,
      workerAverageMs: sdm.averageProcessMilliseconds ?? null,
      workerLastMs: sdmLastProcessMs,
      realtimeRatio: sdmRealtimeRatio,
      oversamplingRuntime: plan.sdmRuntime.oversamplingRuntime
        ? {
          ...plan.sdmRuntime.oversamplingRuntime,
          state: !sdm.active
            ? 'unavailable' as const
            : sdm.oversamplingFallbackReason
              ? 'fallback' as const
              : 'active' as const,
          sourceSampleRate: sdm.sourceSampleRate ?? plan.sdmRuntime.oversamplingRuntime.sourceSampleRate,
          targetSampleRate: sdm.targetSampleRate ?? plan.sdmRuntime.oversamplingRuntime.targetSampleRate,
          requestedBackend: sdm.requestedBackend ?? plan.sdmRuntime.oversamplingRuntime.requestedBackend,
          activeBackend: sdm.oversamplingBackend ?? sdm.activeBackend,
          firStageCount: sdm.stageCount,
          cudaActive: (sdm.oversamplingBackend ?? sdm.activeBackend) === 'cuda',
          fallbackReason: sdm.oversamplingFallbackReason ?? null,
          lastInputFrames: null,
          lastOutputFrames: null,
          workerRequests: null,
          workerAverageMs: null,
          workerLastMs: null,
          realtimeRatio: null,
        }
        : null,
    }
    : plan.sdmRuntime;

  const warnings = [...plan.warnings];
  for (const fallbackReason of [
    plan.echoSrcFirActive ? echoSrc.fallbackReason : null,
    sdm.fallbackReason,
    sdm.oversamplingFallbackReason,
  ]) {
    if (fallbackReason && !warnings.includes(fallbackReason)) {
      warnings.push(fallbackReason);
    }
  }

  return {
    ...plan,
    echoSrcCudaActive: plan.echoSrcFirActive
      ? echoSrc.activeBackend === 'cuda'
      : plan.echoSrcCudaActive,
    echoSrcCudaStatus: echoSrc.activeBackend === 'cuda'
      ? {
        available: true,
        source: 'native-host',
        deviceName: echoSrc.deviceName ?? 'NVIDIA CUDA',
        driverVersion: null,
        cudaVersion: null,
        error: null,
      }
      : plan.echoSrcCudaStatus,
    echoSrcRuntime,
    sdmActualComputeBackend: sdm.active ? sdm.activeBackend : null,
    sdmOversamplingFirActive: sdm.active && sdm.stageCount > 0,
    sdmCudaStatus: sdm.activeBackend === 'cuda'
      ? {
        available: true,
        source: 'native-host',
        deviceName: sdm.deviceName ?? 'NVIDIA CUDA',
        driverVersion: null,
        cudaVersion: null,
        error: null,
      }
      : plan.sdmCudaStatus,
    sdmRuntime,
    warnings,
  };
};

const nativeDaemonRemoteCodecs = new Set(['aac', 'alac', 'flac', 'm4a', 'm4s', 'mp3', 'mpeg', 'mp4', 'mp4a']);
const nativeDaemonRemoteExtensions = new Set(['.aac', '.alac', '.flac', '.m4a', '.m4s', '.mp3']);
const nativeDaemonRemoteMimePattern = /^audio\/(?:aac|flac|mpeg|mp4)/u;
export const isNativeDaemonRemoteSourceSupported = (
  filePath: string,
  mimeType: string | null | undefined,
  probe: AudioProbeResult,
): boolean => {
  const codec = probe.codec?.trim().toLocaleLowerCase() ?? '';
  if (nativeDaemonRemoteCodecs.has(codec) || codec.startsWith('mp4a.') || nativeDaemonRemoteMimePattern.test(codec)) {
    return true;
  }
  const mime = mimeType?.trim().toLocaleLowerCase() ?? '';
  if (nativeDaemonRemoteMimePattern.test(mime)) {
    return true;
  }
  try {
    return nativeDaemonRemoteExtensions.has(extname(new URL(filePath).pathname).toLocaleLowerCase());
  } catch {
    return false;
  }
};

const detectPcmRateFamilyBase = (sampleRate: number): 44100 | 48000 | null => {
  const rounded = Math.round(sampleRate);
  if (rounded > 0 && rounded % 44100 === 0) {
    return 44100;
  }
  if (rounded > 0 && rounded % 48000 === 0) {
    return 48000;
  }
  return null;
};

const resolveEchoSrcTargetSampleRate = (
  mode: AudioEchoSrcMode,
  sourceSampleRate: number,
): number | null => {
  if (mode === 'off') {
    return null;
  }

  if (mode === 'compatibility48') {
    return sourceSampleRate === 48000 ? null : 48000;
  }

  const familyBase = detectPcmRateFamilyBase(sourceSampleRate);
  if (!familyBase) {
    return null;
  }

  const multiplier = mode === 'family8x' ? 8 : mode === 'family4x' ? 4 : 2;
  const target = familyBase * multiplier;
  if (target > maxEchoSrcPcmTargetSampleRate || sourceSampleRate >= target) {
    return null;
  }

  return target;
};

const maxOutputStartRetries = 2;
const daemonRemotePlaybackSignalTimeoutMs = 30_000;

class DaemonRemoteSampleRateCorrection extends Error {
  constructor(readonly sourceSampleRate: number) {
    super(`daemon_remote_source_rate_correction:${sourceSampleRate}`);
    this.name = 'DaemonRemoteSampleRateCorrection';
  }
}

const waitForDaemonPlaybackSignal = async (
  signal: Promise<void>,
  signalName: 'first_pcm' | 'audio_started',
): Promise<void> => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`daemon_remote_${signalName}_timeout`)),
          daemonRemotePlaybackSignalTimeoutMs,
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const classifyDaemonRemoteFallbackReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message.toLocaleLowerCase() : '';
  if (message.includes('401') || message.includes('403') || message.includes('authorization')) return 'authorization';
  if (message.includes('range') || message.includes('416')) return 'range';
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('codec') || message.includes('format') || message.includes('probe')) return 'format';
  if (message.includes('header')) return 'headers';
  return 'open_failed';
};

const shouldUseMiniaudioOutputForHost = (
  outputMode: AudioOutputMode,
  sharedBackend: AudioSharedBackend,
  requested: boolean,
): boolean => {
  if (!requested) {
    return false;
  }

  if (outputMode !== 'shared' && outputMode !== 'exclusive') {
    return false;
  }

  return !(outputMode === 'shared' && sharedBackend === 'directsound');
};

const isNativeDirectLocalPlaybackSampleRateSupported = (
  probe: AudioProbeResult,
  plan: SampleRatePlan,
): boolean => {
  const fileSampleRate = normalizeAudioSampleRate(probe.fileSampleRate);
  const decoderOutputSampleRate = normalizeAudioSampleRate(plan.decoderOutputSampleRate);
  if (fileSampleRate === null || decoderOutputSampleRate === null) {
    return false;
  }

  if (fileSampleRate === decoderOutputSampleRate) {
    return true;
  }

  if (plan.echoSrcActive === true) {
    return true;
  }

  return plan.outputMode === 'shared';
};

const isNativeDirectLocalPlaybackBackend = (backendImpl: string | null | undefined): boolean =>
  backendImpl === 'native-direct-daemon-libav' ||
  backendImpl === 'native-direct-juce-audio-format' ||
  backendImpl === 'native-direct-juce-audio-format-src-pcm';

const nativeDirectLocalPlaybackFallbackReasons = new Set<NativeDirectLocalPlaybackFallbackReason>([
  'disabled',
  'unsupported_format',
  'unsupported_channels',
  'unsupported_sample_rate',
  'remote_source',
  'cue_track',
  'input_headers',
  'libav_decode_requested',
  'dsd_active',
  'sdm_active',
  'echo_src_active',
  'dsp_active',
  'replaygain_active',
  'visual_telemetry_active',
  'chained_playback',
  'unsupported_output_mode',
  'custom_device_not_supported',
  'daemon_unavailable',
  'reader_failed',
]);

const isNativeDirectLocalPlaybackFallbackReason = (value: string): value is NativeDirectLocalPlaybackFallbackReason =>
  nativeDirectLocalPlaybackFallbackReasons.has(value as NativeDirectLocalPlaybackFallbackReason);

const getNativeDirectLocalPlaybackFallbackReason = (
  filePath: string,
  inputHeaders: Record<string, string> | null | undefined,
  probe: AudioProbeResult,
  plan: SampleRatePlan,
  outputSettings: AudioOutputSettings,
  hasChainedPlayback: boolean,
): NativeDirectLocalPlaybackFallbackReason | null => {
  if (process.env.ECHO_FORCE_LEGACY_LOCAL_PLAYBACK === '1') {
    return 'disabled';
  }

  if (
    isPlaybackIntegrationVisualTelemetryActive() &&
    getNativeDspLegacyFallbackBlockReason(plan, outputSettings) === null
  ) {
    return 'visual_telemetry_active';
  }

  if (hasChainedPlayback) {
    return 'chained_playback';
  }

  if (!isLocalDirectPlaybackPilotPath(filePath)) {
    return 'unsupported_format';
  }

  if (isHttpPlaybackUrl(filePath)) {
    return 'remote_source';
  }

  if (isCueTrackPath(filePath)) {
    return 'cue_track';
  }

  if (inputHeaders) {
    return 'input_headers';
  }

  if (plan.dsdOutputMode !== 'pcm') {
    return 'dsd_active';
  }

  if (plan.sdmPcmToDsdActive) {
    return 'sdm_active';
  }

  if (!isNativeDirectLocalPlaybackSampleRateSupported(probe, plan)) {
    return 'unsupported_sample_rate';
  }

  if (probe.channels < 1 || probe.channels > 2) {
    return 'unsupported_channels';
  }

  return null;
};

const getNativeDspLegacyFallbackBlockReason = (
  plan: SampleRatePlan,
  outputSettings: AudioOutputSettings,
): 'echo_src' | 'dither' | 'sdm' | null => {
  if (plan.sdmPcmToDsdActive) {
    return 'sdm';
  }
  if (plan.echoSrcActive && plan.echoSrcAdvancedModeEnabled) {
    return 'echo_src';
  }
  const outputMode = normalizeOutputMode(outputSettings.outputMode);
  if (normalizePcmDitherMode(outputSettings.pcmDitherMode) !== 'off' && outputMode !== 'shared') {
    return 'dither';
  }
  return null;
};

const getNativeDirectDaemonPlaybackFallbackReason = (
  filePath: string,
  inputHeaders: Record<string, string> | null | undefined,
  mimeType: string | null | undefined,
  probe: AudioProbeResult,
  plan: SampleRatePlan,
  outputSettings: AudioOutputSettings,
  hasChainedPlayback: boolean,
): NativeDirectLocalPlaybackFallbackReason | null => {
  if (process.env.ECHO_FORCE_LEGACY_LOCAL_PLAYBACK === '1') {
    return 'disabled';
  }

  if (
    isPlaybackIntegrationVisualTelemetryActive() &&
    getNativeDspLegacyFallbackBlockReason(plan, outputSettings) === null
  ) {
    return 'visual_telemetry_active';
  }

  if (hasChainedPlayback) {
    return 'chained_playback';
  }

  if (isHttpPlaybackUrl(filePath)) {
    if (process.env.ECHO_DISABLE_DAEMON_REMOTE_PLAYBACK === '1') {
      return 'remote_source';
    }
    try {
      normalizeAudioInputSource({
        kind: 'http',
        uri: filePath,
        headers: inputHeaders ?? undefined,
        mimeType,
      });
    } catch {
      return 'input_headers';
    }
    if (!isNativeDaemonRemoteSourceSupported(filePath, mimeType, probe)) {
      return 'unsupported_format';
    }
  } else {
    if (isCueTrackPath(filePath)) {
      return 'cue_track';
    }

    if (!isNativeDaemonLocalSourceSupported(filePath, probe)) {
      return 'unsupported_format';
    }

    if (inputHeaders) {
      return 'input_headers';
    }
  }

  const outputMode = normalizeOutputMode(outputSettings.outputMode);
  if (outputMode !== 'shared' && outputMode !== 'exclusive' && outputMode !== 'asio') {
    return 'unsupported_output_mode';
  }

  if (plan.dsdOutputMode !== 'pcm') {
    return 'dsd_active';
  }
  // A persisted DoP preference is not an active DSD route for a PCM source.
  // Preserve the established legacy PCM path unless a native DSP feature
  // explicitly requires the daemon; in that case the host-facing PCM plan is
  // authoritative and the dormant DSD preference must not block playback.
  if (
    normalizeDsdOutputMode(outputSettings.dsdOutputMode) !== 'pcm' &&
    getNativeDspLegacyFallbackBlockReason(plan, outputSettings) === null
  ) {
    return 'dsd_active';
  }

  if (probe.channels < 1 || probe.channels > 2) {
    return 'unsupported_channels';
  }

  return null;
};

const resolveNativeDirectLocalPlaybackOutputChannels = (
  probe: AudioProbeResult,
  fallbackReason: NativeDirectLocalPlaybackFallbackReason | null,
): number =>
  fallbackReason === null && probe.channels === 1
    ? 2
    : probe.channels;

const dsdDopSupportedOutputModes = new Set<AudioOutputMode>(['exclusive', 'asio']);

const getDsdDopDisabledWarning = (
  filePath: string,
  inputHeaders: Record<string, string> | null | undefined,
  probe: AudioProbeResult,
  outputSettings: AudioOutputSettings,
  outputMode: AudioOutputMode,
): string | null => {
  if (normalizeDsdOutputMode(outputSettings.dsdOutputMode) !== 'dop') {
    return null;
  }

  if (!isDsdFilePath(filePath) && !isDsdCodec(probe.codec)) {
    return null;
  }

  if (!isDsfFilePath(filePath) || inputHeaders || isCueTrackPath(filePath)) {
    return 'dsd_dop_format_unsupported';
  }

  if (!dsdDopSupportedOutputModes.has(outputMode)) {
    return 'dsd_dop_requires_exclusive_or_asio';
  }

  if (probe.channels < 1 || probe.channels > 2 || !resolveDsdDopTransportSampleRate(probe)) {
    return 'dsd_dop_format_unsupported';
  }

  if (Math.abs((outputSettings.playbackRate ?? 1) - 1) > 1e-6 || Math.abs((outputSettings.volume ?? 1) - 1) > 1e-6) {
    return 'dsd_dop_disabled_by_dsp';
  }

  const eqState = EqStateStore.loadEqState();
  const channelBalanceState = EqStateStore.loadChannelBalanceState();
  const roomCorrectionState = EqStateStore.loadRoomCorrectionState();
  if (eqState.enabled || roomCorrectionState.enabled || channelBalanceState.enabled) {
    return 'dsd_dop_disabled_by_dsp';
  }

  return null;
};

const shouldAttemptDsdDop = (
  filePath: string,
  inputHeaders: Record<string, string> | null | undefined,
  probe: AudioProbeResult,
  outputSettings: AudioOutputSettings,
  outputMode: AudioOutputMode,
): boolean => getDsdDopDisabledWarning(filePath, inputHeaders, probe, outputSettings, outputMode) === null &&
  normalizeDsdOutputMode(outputSettings.dsdOutputMode) === 'dop';

const isDsdPlaybackCandidate = (filePath: string, probe: AudioProbeResult): boolean =>
  isDsdFilePath(filePath) || isDsdCodec(probe.codec);

const shouldAttemptAsioNativeDsd = (
  filePath: string,
  inputHeaders: Record<string, string> | null | undefined,
  probe: AudioProbeResult,
  outputSettings: AudioOutputSettings,
  outputMode: AudioOutputMode,
): boolean => outputMode === 'asio' &&
  shouldAttemptDsdDop(filePath, inputHeaders, probe, outputSettings, outputMode) &&
  isDsfFilePath(filePath);

const deviceInitializeTimeoutPatterns = [
  /\bdevice_initialize_timeout\b/u,
];

const isDeviceInitializeTimeoutError = (error: Error): boolean =>
  deviceInitializeTimeoutPatterns.some((pattern) => pattern.test(error.message));

const isUnsupportedExclusiveFormatError = (error: Error): boolean =>
  /WASAPI exclusive format unsupported|AUDCLNT_E_UNSUPPORTED_FORMAT|0x88890008/iu.test(error.message);

const isEqControlDisconnectError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);

  return /\b(?:eq_control_(?:closed|disconnected|connection_timeout)|ECONNREFUSED|ECONNRESET)\b/u.test(message);
};

const numericReadyField = (ready: NativeBridgeReadyResult, field: string): number | null => {
  const value = ready.device[field];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
};

const getReadyOutputSampleRate = (ready: NativeBridgeReadyResult): number | null =>
  normalizeAudioSampleRate(ready.actualDeviceSampleRate) ??
  normalizeAudioSampleRate(ready.device.sampleRate) ??
  normalizeAudioSampleRate(ready.device.hardwareSampleRate);

const getReadyOutputFormat = (ready: NativeBridgeReadyResult | null): string | null => {
  const format = ready?.device.format;

  return typeof format === 'string' && format.trim() ? format.trim() : null;
};

const createProbeFromHint = (filePath: string, hint: AudioSessionPlayRequest['probe']): AudioProbeResult | null => {
  if (!hint) {
    return null;
  }

  const fileSampleRate = normalizeAudioSampleRate(hint.fileSampleRate);
  if (hint.fileSampleRate !== null && hint.fileSampleRate !== undefined && fileSampleRate === null) {
    return null;
  }

  return {
    filePath,
    durationSeconds: Math.max(0, Number(hint.durationSeconds ?? 0)),
    fileSampleRate,
    channels: Math.max(1, Math.min(8, normalizePositiveInteger(hint.channels) ?? 2)),
    codec: typeof hint.codec === 'string' && hint.codec.trim() ? hint.codec : null,
    bitDepth: normalizePositiveInteger(hint.bitDepth),
    bitrate: normalizePositiveInteger(hint.bitrate),
  };
};

const createStreamProbeFromHint = (filePath: string, hint: AudioSessionPlayRequest['probe']): AudioProbeResult => ({
  filePath,
  durationSeconds: Math.max(0, Number(hint?.durationSeconds ?? 0)),
  fileSampleRate: normalizeAudioSampleRate(hint?.fileSampleRate),
  channels: Math.max(1, Math.min(8, normalizePositiveInteger(hint?.channels) ?? 2)),
  codec: typeof hint?.codec === 'string' && hint.codec.trim() ? hint.codec : null,
  bitDepth: normalizePositiveInteger(hint?.bitDepth),
  bitrate: normalizePositiveInteger(hint?.bitrate),
});

const createProbeHint = (probe: AudioProbeResult): AudioSessionPlayRequest['probe'] => ({
  durationSeconds: probe.durationSeconds,
  fileSampleRate: probe.fileSampleRate,
  channels: probe.channels,
  codec: probe.codec,
  bitDepth: probe.bitDepth,
  bitrate: probe.bitrate,
});

const isProbeHintCompleteEnough = (probe: AudioSessionPrepareLocalFileRequest['probe'] | undefined): boolean =>
  Boolean(
    probe &&
      typeof probe.durationSeconds === 'number' &&
      Number.isFinite(probe.durationSeconds) &&
      probe.durationSeconds > 0 &&
      Object.prototype.hasOwnProperty.call(probe, 'fileSampleRate') &&
      (probe.fileSampleRate === null ||
        (typeof probe.fileSampleRate === 'number' && Number.isFinite(probe.fileSampleRate) && probe.fileSampleRate > 0)) &&
      typeof probe.channels === 'number' &&
      Number.isFinite(probe.channels) &&
      probe.channels > 0,
  );

const clampAutomixTransitionSeconds = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(2, Math.min(16, value))
    : 16;

const nativeAutomixDualDeckEnabled = false;
const nativeAutomixDualDeckLateArmWindowSeconds = 60;
const automixAdvanceAudibleRatio = 0.5;
// The feature toggle remains opt-in. Once enabled, production builds use the
// native beta path by default; ECHO_AUTOMIX_V2_PHASE=off is the kill switch.
// Tests preserve the legacy default unless they explicitly select a phase.
const automixV2Phase: AutomixRuntimePhase = resolveAutomixRuntimePhase(
  process.env.ECHO_AUTOMIX_V2_PHASE,
  process.env.NODE_ENV === 'test' ? 'off' : 'native_beta',
);
const automixV2NativeEnabled = automixV2Phase === 'native_beta' || automixV2Phase === 'native_default';

const getAutomixAudibleAdvanceSeconds = (transition: ActiveAutomixTransition): number => {
  const transitionSeconds = Number.isFinite(transition.transitionSeconds) ? Math.max(0, transition.transitionSeconds) : 0;
  return transition.transitionStartSeconds + (transitionSeconds * automixAdvanceAudibleRatio);
};

const createAutomixAnalysisHint = (probe: AudioSessionPlayRequest['probe'] | undefined) => ({
  bpm: probe?.bpm ?? null,
  bpmConfidence: probe?.bpmConfidence ?? null,
  beatOffsetMs: probe?.beatOffsetMs ?? null,
});

const mergeProbeHints = (
  primary: AudioSessionPrepareLocalFileRequest['probe'] | undefined,
  fallback: AudioSessionPrepareLocalFileRequest['probe'] | undefined,
): AudioSessionPrepareLocalFileRequest['probe'] | undefined => {
  const merged = { ...(fallback ?? {}), ...(primary ?? {}) };

  return Object.keys(merged).length > 0 ? merged : undefined;
};

const redactUrlSecrets = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.search) {
      url.search = '?redacted';
    }

    return url.toString();
  } catch {
    return value;
  }
};

const safePlaybackDiagnosticPath = (value: string | null | undefined): { basename: string; pathHash: string } | null => {
  const raw = value?.trim();
  return raw ? { basename: basename(raw), pathHash: hashText(raw) } : null;
};

const inferPlaybackDiagnosticContainer = (value: string | null | undefined): string | null => {
  const extension = extname((value ?? '').split(/[?#]/u, 1)[0] ?? '').replace(/^\./u, '').trim();
  return extension ? extension.toUpperCase() : null;
};

const createPlaybackProbeDiagnostics = (
  probe: AudioProbeResult | null,
  filePath: string | null | undefined,
): Record<string, unknown> | null => {
  if (!probe) {
    return null;
  }

  return {
    codec: probe.codec ?? null,
    container: inferPlaybackDiagnosticContainer(probe.filePath || filePath),
    duration: probe.durationSeconds,
    fileSampleRate: probe.fileSampleRate,
    bitDepth: probe.bitDepth,
    bitrate: probe.bitrate,
    channels: probe.channels,
  };
};

const createDeviceFromOutputSettings = (settings: AudioOutputSettings): AudioDeviceInfo | null => {
  if (!hasExplicitDeviceSelection(settings)) {
    return null;
  }

  const outputMode = normalizeOutputMode(settings.outputMode);
  if (outputMode === 'system') {
    return null;
  }

  const outputModeKey: AudioDeviceInfo['outputMode'] = outputMode;
  const deviceIndex = Number.isInteger(Number(settings.deviceIndex)) ? Number(settings.deviceIndex) : -1;

  return {
    id: deviceIndex >= 0 ? `${outputModeKey}:${deviceIndex}` : `${outputModeKey}:${settings.deviceName ?? 'selected'}`,
    index: deviceIndex,
    name: settings.deviceName ?? 'Selected output',
    outputMode: outputModeKey,
    sampleRate: null,
    sharedDeviceSampleRate: null,
    isDefault: false,
  };
};

type OutputRouteDeviceSnapshot = {
  deviceId: string | null;
  deviceIndex: number | null;
  deviceName: string | null;
};

const createOutputRouteDeviceSnapshot = (
  settings: AudioOutputSettings | null | undefined,
  device: AudioDeviceInfo | null | undefined,
): OutputRouteDeviceSnapshot => ({
  deviceId: device?.id ?? null,
  deviceIndex: Number.isInteger(Number(device?.index))
    ? Number(device?.index)
    : Number.isInteger(Number(settings?.deviceIndex))
      ? Number(settings?.deviceIndex)
      : null,
  deviceName: device?.name ?? settings?.deviceName ?? null,
});

const outputRouteDeviceChanged = (
  requested: OutputRouteDeviceSnapshot,
  final: OutputRouteDeviceSnapshot,
): boolean => (
  requested.deviceId !== final.deviceId ||
  requested.deviceIndex !== final.deviceIndex ||
  requested.deviceName !== final.deviceName
);

type AudioOutputRestartSnapshot = {
  outputMode: AudioOutputMode;
  sharedBackend: AudioSharedBackend;
  deviceIndex: number | null;
  deviceName: string | null;
  requestedOutputSampleRate: number | null;
  latencyProfile: AudioLatencyProfile;
  bufferSizeFrames: number | null;
  useMiniaudioOutput: boolean;
  nativeDirectLocalPlaybackEnabled: boolean;
  dsdOutputMode: AudioDsdOutputMode;
  defaultDeviceFallbackEnabled: boolean;
  soxrFallbackEnabled: boolean;
  echoSrcMode: AudioEchoSrcMode;
  echoSrcQualityProfile: AudioEchoSrcQualityProfile;
  echoSrcAdvancedModeEnabled: boolean;
  echoSrcFilterProfile: AudioEchoSrcFilterProfile;
  echoSrcFilterProfile1x: AudioEchoSrcFilterProfile;
  echoSrcFilterProfileNx: AudioEchoSrcFilterProfile;
  echoSrcComputeBackend: AudioEchoSrcComputeBackend;
  sdmMode: AudioSdmMode;
  sdmTargetRate: AudioSdmTargetRate;
  sdmQualityProfile: AudioSdmQualityProfile;
  sdmComputeBackend: AudioSdmComputeBackend;
  sdmOversamplingFilterProfile1x: AudioEchoSrcFilterProfile;
  sdmOversamplingFilterProfileNx: AudioEchoSrcFilterProfile;
  pcmDitherMode: AudioPcmDitherMode;
  releaseExclusiveOnPauseExperimentalEnabled: boolean;
};

const createOutputRestartSnapshot = (settings: AudioOutputSettings): AudioOutputRestartSnapshot => {
  const outputMode = normalizeOutputMode(settings.outputMode);
  const sharedBackend = outputMode === 'shared' ? normalizeSharedBackend(settings.sharedBackend) : 'auto';

  return {
    outputMode,
    sharedBackend,
    deviceIndex: Number.isInteger(Number(settings.deviceIndex)) ? Number(settings.deviceIndex) : null,
    deviceName: typeof settings.deviceName === 'string' && settings.deviceName.trim() ? settings.deviceName : null,
    requestedOutputSampleRate: outputMode === 'shared' ? null : normalizeAudioSampleRate(settings.requestedOutputSampleRate),
    latencyProfile: normalizeLatencyProfile(settings.latencyProfile),
    bufferSizeFrames: normalizePositiveInteger(settings.bufferSizeFrames),
    useMiniaudioOutput: settings.useMiniaudioOutput === true,
    nativeDirectLocalPlaybackEnabled: settings.nativeDirectLocalPlaybackEnabled === true,
    dsdOutputMode: normalizeDsdOutputMode(settings.dsdOutputMode),
    defaultDeviceFallbackEnabled: settings.defaultDeviceFallbackEnabled === true,
    soxrFallbackEnabled: settings.soxrFallbackEnabled !== false,
    echoSrcMode: normalizeEchoSrcMode(settings.echoSrcMode),
    echoSrcQualityProfile: normalizeEchoSrcQualityProfile(settings.echoSrcQualityProfile),
    echoSrcAdvancedModeEnabled: settings.echoSrcAdvancedModeEnabled === true,
    echoSrcFilterProfile: normalizeEchoSrcFilterProfile(settings.echoSrcFilterProfile),
    echoSrcFilterProfile1x: normalizeEchoSrcFilterProfile(settings.echoSrcFilterProfile1x ?? settings.echoSrcFilterProfile),
    echoSrcFilterProfileNx: normalizeEchoSrcFilterProfile(settings.echoSrcFilterProfileNx ?? 'poly-sinc-hb'),
    echoSrcComputeBackend: normalizeEchoSrcComputeBackend(settings.echoSrcComputeBackend),
    sdmMode: normalizeSdmMode(settings.sdmMode),
    sdmTargetRate: normalizeSdmTargetRate(settings.sdmTargetRate),
    sdmQualityProfile: normalizeSdmQualityProfile(settings.sdmQualityProfile),
    sdmComputeBackend: normalizeSdmComputeBackend(settings.sdmComputeBackend),
    sdmOversamplingFilterProfile1x: normalizeEchoSrcFilterProfile(settings.sdmOversamplingFilterProfile1x ?? 'sinc-long'),
    sdmOversamplingFilterProfileNx: normalizeEchoSrcFilterProfile(settings.sdmOversamplingFilterProfileNx ?? 'poly-sinc-hb'),
    pcmDitherMode: normalizePcmDitherMode(settings.pcmDitherMode),
    releaseExclusiveOnPauseExperimentalEnabled: settings.releaseExclusiveOnPauseExperimentalEnabled === true,
  };
};

const outputRestartSettingsEqual = (left: AudioOutputSettings, right: AudioOutputSettings): boolean => {
  const leftSnapshot = createOutputRestartSnapshot(left);
  const rightSnapshot = createOutputRestartSnapshot(right);

  return (Object.keys(leftSnapshot) as Array<keyof AudioOutputRestartSnapshot>).every((key) => leftSnapshot[key] === rightSnapshot[key]);
};

const outputRestartSettingsEqualIgnoringDsdDirect = (left: AudioOutputSettings, right: AudioOutputSettings): boolean => {
  const leftSnapshot = createOutputRestartSnapshot(left);
  const rightSnapshot = createOutputRestartSnapshot(right);
  rightSnapshot.dsdOutputMode = leftSnapshot.dsdOutputMode;

  return (Object.keys(leftSnapshot) as Array<keyof AudioOutputRestartSnapshot>).every((key) => leftSnapshot[key] === rightSnapshot[key]);
};

const clampOutputVolume = (volume: number): number =>
  Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;

const resolveSdmPcmToDsdHeadroomGain = (plan: SampleRatePlan | null | undefined): number => {
  if (plan?.sdmPcmToDsdActive !== true) {
    return 1;
  }

  const headroomDb = Math.max(0, Number(plan.sdmModulatorProfile?.recommendedHeadroomDb ?? 6));
  return dbToLinearGain(-headroomDb);
};

const resolveOutputVolumeRouting = (
  bridge: OutputBridgeLike | null | undefined,
  plan: SampleRatePlan | null | undefined,
  volume: number,
): { bridgeVolume: number; softwareGain: number; meterGain: number; nativeVolumeControl: boolean } => {
  const safeVolume = clampOutputVolume(volume);
  const sdmPcmToDsdActive = plan?.sdmPcmToDsdActive === true;
  const nativeVolumeControl = typeof bridge?.setVolume === 'function' && !sdmPcmToDsdActive;
  const protectedSdmBridgeVolume = typeof bridge?.setVolume === 'function' && sdmPcmToDsdActive;

  return {
    bridgeVolume: nativeVolumeControl || protectedSdmBridgeVolume ? safeVolume : 1,
    softwareGain: nativeVolumeControl ? 1 : (protectedSdmBridgeVolume ? 1 : safeVolume) * resolveSdmPcmToDsdHeadroomGain(plan),
    meterGain: nativeVolumeControl || protectedSdmBridgeVolume ? safeVolume : 1,
    nativeVolumeControl,
  };
};

type PcmDitherRuntimeStatus = {
  active: boolean;
  targetBitDepth: 16 | 24 | null;
  reason: string | null;
};

const inferPcmDitherTargetBitDepth = (nativeOutputFormat: string | null | undefined): 16 | 24 | null => {
  const normalized = nativeOutputFormat?.toLowerCase() ?? '';
  if (!normalized || normalized.includes('float')) {
    return null;
  }
  if (/\b(?:pcm|s|int)?16\b/u.test(normalized) || normalized.includes('pcm16')) {
    return 16;
  }
  if (/\b(?:pcm|s|int)?24\b/u.test(normalized) || normalized.includes('pcm24') || normalized.includes('pcm32')) {
    return 24;
  }
  return null;
};

const resolvePcmDitherRuntimeStatus = (
  mode: AudioPcmDitherMode,
  nativeOutputFormat: string | null | undefined,
): PcmDitherRuntimeStatus => {
  if (mode === 'off') {
    return { active: false, targetBitDepth: null, reason: 'off' };
  }

  if (!nativeOutputFormat) {
    return { active: false, targetBitDepth: null, reason: 'output_format_pending' };
  }

  if (nativeOutputFormat.toLowerCase().includes('float')) {
    return { active: false, targetBitDepth: null, reason: 'float_output_not_quantized' };
  }

  const targetBitDepth = inferPcmDitherTargetBitDepth(nativeOutputFormat);
  if (!targetBitDepth) {
    return { active: false, targetBitDepth: null, reason: `unsupported_output_format:${nativeOutputFormat}` };
  }

  return { active: true, targetBitDepth, reason: null };
};

type RepeatMode = 'off' | 'one' | 'all';

export class AudioSession extends EventEmitter {
  // Backing field for bridge — used by legacy test harness via dependency injection
  private _bridge: OutputBridgeLike | null = null;
  private get bridge(): OutputBridgeLike | null { return this._bridge; }
  private set bridge(value: OutputBridgeLike | null) { this._bridge = value; }


  // Bridge event listeners — attached during playback to forward native host events
  private attachedBridgeEvents: { bridge: OutputBridgeLike; listeners: BridgeEventListeners } | null = null;

  // Stubs for removed bridge infrastructure (to be eliminated in Wave 3)
  private detachBridgeEvents(bridge: OutputBridgeLike | null = this.attachedBridgeEvents?.bridge ?? null): void {
    const attached = this.attachedBridgeEvents;
    if (!bridge || !attached || attached.bridge !== bridge) {
      return;
    }

    const removeListener = bridge.off ?? bridge.removeListener;
    if (removeListener) {
      removeListener.call(bridge, 'position', attached.listeners.position);
      removeListener.call(bridge, 'ended', attached.listeners.ended);
      removeListener.call(bridge, 'error', attached.listeners.error);
      removeListener.call(bridge, 'device-event', attached.listeners.deviceEvent);
    }

    this.attachedBridgeEvents = null;
    this.lastPositionSample = null;
  }

  private attachBridgeEvents(bridge: OutputBridgeLike, token: number): void {
    if (!bridge || typeof bridge.on !== 'function') {
      throw new Error('native output bridge is unavailable for event attachment');
    }

    this.detachBridgeEvents();
    this.markExpectedPositionDiscontinuity();

    const listeners: BridgeEventListeners = {
      position: (frames: unknown, telemetry?: unknown) => {
        if (this.runToken !== token) {
          return;
        }

        const now = Date.now();
        const positionReportedBeforePlaying = this.state !== 'playing';
        const previousClockPositionSeconds = this.clock.getPositionSeconds();
        if (positionReportedBeforePlaying) {
          this.nativePositionReportedBeforePlaying = true;
          if (this.nativePositionBeforePlayingBaselineSeconds === null) {
            this.nativePositionBeforePlayingBaselineSeconds = previousClockPositionSeconds;
          }
        }
        this.clock.updateFrames(Number(frames));
        const positionSeconds = this.clock.getPositionSeconds();
        const nativeTelemetry =
          telemetry && typeof telemetry === 'object' && !Array.isArray(telemetry)
            ? (telemetry as NativeOutputTelemetry)
            : null;
        const guardedRebasePositionSeconds = this.createGuardedPositionJumpRebase(
          positionSeconds,
          now,
          previousClockPositionSeconds,
        );
        if (guardedRebasePositionSeconds !== null) {
          this.clock.rebase(guardedRebasePositionSeconds);
          bridge.rebaseOutputClock?.(
            guardedRebasePositionSeconds,
            this.currentOutputSettings?.playbackRate ?? this.outputSettings.playbackRate,
          );
          this.watchdogLastPositionSeconds = guardedRebasePositionSeconds;
          this.handlePositionSample(token, guardedRebasePositionSeconds, nativeTelemetry, now);
          this.watchdogStalledChecks = 0;
          if (nativeTelemetry) {
            this.handleNativeTelemetry(nativeTelemetry, { suppressStartupTelemetryLog: true });
          }
          return;
        }

        this.watchdogLastPositionSeconds = positionSeconds;
        this.handlePositionSample(token, positionSeconds, nativeTelemetry, now);
        if (!positionReportedBeforePlaying) {
          this.nativePositionReportedBeforePlaying = false;
        }
        this.maybeAdvanceAutomix(token);
        this.watchdogStalledChecks = 0;
        if (nativeTelemetry) {
          this.handleNativeTelemetry(nativeTelemetry);
        }
      },
      ended: () => {
        if (this.runToken !== token) {
          return;
        }

        if (this.state !== 'playing' && this.state !== 'loading') {
          this.recordPlaybackDiagnosticEvent('ended', 'info', 'ended_ignored_while_not_playing', {
            positionSeconds: this.clock.getPositionSeconds(),
            details: {
              token,
              state: this.state,
            },
          });
          return;
        }

        this.updatePositionFromOutput();
        this.maybeAdvanceAutomix(token);

        const activeChainedPlayback = this.activeAutomix;
        const expectedEndSeconds = activeChainedPlayback
          ? activeChainedPlayback.compositeStartSeconds + activeChainedPlayback.compositeDurationSeconds
          : this.currentProbe?.durationSeconds ?? 0;
        const premature =
          expectedEndSeconds > 0 && this.clock.getPositionSeconds() < expectedEndSeconds - prematureLocalEndToleranceSeconds;
        const clearlyCorrupt = premature && isClearlyCorruptLocalEnd(this.clock.getPositionSeconds(), expectedEndSeconds);
        if (clearlyCorrupt && !activeChainedPlayback && isLocalPlaybackPath(this.currentFilePath)) {
          this.recordPlaybackDiagnosticEvent(
            'ended',
            'suspect',
            activeChainedPlayback
              ? 'ended_before_chained_duration'
              : 'ended_before_duration',
            {
              positionSeconds: this.clock.getPositionSeconds(),
              durationSeconds: expectedEndSeconds,
              details: {
                token,
                chainedPlaybackActive: Boolean(activeChainedPlayback),
                remainingSeconds: expectedEndSeconds > 0 ? Math.max(0, expectedEndSeconds - this.clock.getPositionSeconds()) : null,
              },
            },
          );
          if (this.reserveLocalPlaybackRecoverySlot('premature_local_end')) {
            void this.recoverLocalPlaybackRestart(
              token,
              'premature_local_end_recovered',
              this.clock.getPositionSeconds(),
              expectedEndSeconds,
              { eventKind: 'ended' },
            );
            return;
          }

          this.state = 'ended';
          this.handleError(createPossibleCorruptAudioFileError(this.clock.getPositionSeconds(), expectedEndSeconds));
          return;
        }

        this.handlePlaybackEnded(token);

        if (premature) {
          this.recordPlaybackDiagnosticEvent(
            'ended',
            'suspect',
            activeChainedPlayback
              ? 'ended_before_chained_duration'
              : 'ended_before_duration',
            {
              positionSeconds: this.clock.getPositionSeconds(),
              durationSeconds: expectedEndSeconds,
              details: {
                token,
                chainedPlaybackActive: Boolean(activeChainedPlayback),
                remainingSeconds: expectedEndSeconds > 0 ? Math.max(0, expectedEndSeconds - this.clock.getPositionSeconds()) : null,
              },
            },
          );
        }
        noteDataProtectionPlaybackActivity(false);
      },
      error: (error: unknown) => {
        if (this.runToken !== token) {
          return;
        }

        this.handleError(error instanceof Error ? error : new Error(String(error)));
      },
      deviceEvent: (event: unknown) => {
        if (this.runToken !== token) {
          return;
        }

        this.deviceService.invalidateCache?.();
        this.enqueueNativeHostNotification(event, token);
      },
    };

    bridge.on('position', listeners.position);
    bridge.on('ended', listeners.ended);
    bridge.on('error', listeners.error);
    bridge.on('device-event', listeners.deviceEvent);
    this.attachedBridgeEvents = { bridge, listeners };
  }

  private async stopBridgeGracefully(bridge: OutputBridgeLike, reason: string): Promise<void> {
    try {
      if (bridge.stopGracefully) {
        const timeoutMs = this.getGracefulStopTimeoutMs(reason);
        const waitForExit = this.getGracefulStopWaitForExit(reason);
        await this.stopBridgeWithOptions(bridge, reason, timeoutMs, waitForExit);
      } else {
        bridge.stop();
      }
    } catch (error) {
      this.logger(`[AudioSession] graceful stop failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (this.bridge === bridge) {
        this.detachBridgeEvents(bridge);
        this.bridge = null;
        this.currentReadyResult = null;
        this.currentBridgeOutputMode = null;
        this.currentBridgeSharedBackend = null;
        this.currentResidentOutputSampleRate = null;
      }
    }
  }

  private getGracefulStopTimeoutMs(reason: string): number | undefined {
    if (reason === 'app-quit') {
      return 1500;
    }

    const outputMode =
      reason === 'replace-output'
        ? this.currentBridgeOutputMode
        : null;

    if (reason === 'replace-output' && outputMode === 'shared' && this.currentBridgeSharedBackend !== 'directsound') {
      return sharedReplacementGracefulStopTimeoutMs;
    }

    return undefined;
  }

  private getGracefulStopWaitForExit(reason: string): boolean {
    return (
      reason === 'app-quit' ||
      reason === 'replace-output' ||
      reason === 'reset-audio-engine' ||
      reason === 'force-restart' ||
      reason.startsWith('windows-audio-service')
    );
  }

  private async stopBridgeWithOptions(
    bridge: OutputBridgeLike,
    reason: string,
    timeoutMs: number | undefined,
    waitForExit: boolean,
  ): Promise<void> {
    if (!bridge.stopGracefully) {
      bridge.stop();
      return;
    }

    if (timeoutMs === undefined && !waitForExit) {
      await bridge.stopGracefully(reason);
      return;
    }

    await bridge.stopGracefully(reason, timeoutMs, waitForExit);
  }

  private async detachSharedReplacementBridge(_reason: string): Promise<void> {}
  private shouldDetachSharedReplacement(_nextOutputMode: AudioOutputMode, _nextSharedBackend: AudioSharedBackend): boolean { return false; }
  private get isWritableUsable(): never { throw new Error('not implemented'); }
  private readonly _depCreateBridge?: () => unknown;
  private createBridge(): OutputBridgeLike {
    const bridge = this._depCreateBridge
      ? this._depCreateBridge()
      : new NativePcmHostProcess({
        logger: this.logger,
        platform: this.platform as NodeJS.Platform,
      });

    const bridgeShape = bridge && typeof bridge === 'object'
      ? bridge as { on?: unknown; start?: unknown }
      : null;
    if (!bridgeShape || typeof bridgeShape.on !== 'function' || typeof bridgeShape.start !== 'function') {
      throw new Error('native output bridge factory did not create a usable bridge');
    }

    return bridge as OutputBridgeLike;
  }
  private get bridgeStopInProgress(): Promise<void> | null { return null; }
  private set bridgeStopInProgress(_v: Promise<void> | null) {}

  private readonly decoder: DecoderPipelineLike;
  private readonly automixAnalyzer: AutomixAnalyzerLike;
  private readonly deviceService: DeviceServiceLike;
  private readonly isNativeHostAvailable: () => boolean;
  private readonly startAudioDaemonForPlayback: () => Promise<void>;
  private readonly stopAudioDaemonForPlayback: () => Promise<void>;
  private readonly createDaemonAudioBackendForPlayback: (
    deviceId: string,
    outputSettings: AudioOutputSettings & DaemonOutputSettings,
  ) => Promise<DaemonAudioBackend | null>;
  private readonly reportAudioError: (payload: AudioCrashReportPayload) => void;
  private readonly logger: (message: string) => void;
  private readonly verboseLogger: (message: string) => void;
  private readonly diagnosticLogger: (message: string) => void;
  private readonly platform: NodeJS.Platform | string;
  private readonly clock = new PlaybackClock();
  private outputSettings: Required<Pick<AudioOutputSettings, 'outputMode' | 'latencyProfile' | 'volume' | 'playbackRate' | 'playbackSpeedMode'>> &
    Omit<AudioOutputSettings, 'outputMode' | 'latencyProfile' | 'volume' | 'playbackRate' | 'playbackSpeedMode'> = {
    outputMode: 'shared',
    automaticOutputEnabled: false,
    latencyProfile: 'balanced',
    sharedBackend: 'auto',
    useMiniaudioOutput: false,
    nativeDirectLocalPlaybackEnabled: true,
    dsdOutputMode: 'pcm',
    sdmMode: 'off',
    sdmTargetRate: 'dsd128',
    sdmQualityProfile: 'safe',
    sdmComputeBackend: 'cpu',
    sdmOversamplingFilterProfile1x: 'sinc-long',
    sdmOversamplingFilterProfileNx: 'poly-sinc-hb',
    exclusiveInstabilityFallbackEnabled: false,
    defaultDeviceFallbackEnabled: false,
    soxrFallbackEnabled: true,
    echoSrcMode: 'off',
    echoSrcQualityProfile: 'transparent',
    echoSrcAdvancedModeEnabled: false,
    echoSrcFilterProfile: 'poly-sinc-gauss-long',
    echoSrcFilterProfile1x: 'poly-sinc-gauss-long',
    echoSrcFilterProfileNx: 'poly-sinc-hb',
    echoSrcComputeBackend: 'cpu',
    pcmDitherMode: 'off',
    releaseExclusiveOnPauseExperimentalEnabled: false,
    volume: 1,
    playbackRate: 1,
    playbackSpeedMode: 'nightcore',
  };
  private state: AudioPlaybackState = 'idle';
  private automaticOutputStage: AudioStatus['automaticOutputStage'] = 'disabled';
  private hostStatus: AudioStatus['host'] = isNativeOutputBridgeAvailable() ? 'not-initialized' : 'unavailable';
  private currentProbe: AudioProbeResult | null = null;
  private currentTrackId: string | null = null;
  private currentFilePath: string | null = null;
  private currentTrackMetadata: AudioSessionPlayRequest['metadata'] | null = null;
  private currentInputHeaders: Record<string, string> | null = null;
  private currentOutputSettings: AudioOutputSettings | null = null;
  private pendingOutputRestartContext: { recoveryReason?: string | null; fallbackReason?: string | null } | null = null;
  private currentPlan: SampleRatePlan | null = null;
  private currentNativeProcessingStatus: NativeDspProcessingStatus | null = null;
  private currentDevice: AudioDeviceInfo | null = null;
  private currentOutputBackend: string | null = null;
  private currentOutputBackendImpl: string | null = null;
  private currentOutputDeviceType: string | null = null;
  private currentOutputDeviceName: string | null = null;
  private currentUseMiniaudioOutputRequested = false;
  private currentDecodeBackendImpl: string | null = null;
  private currentDsdOutputModeRequested: AudioDsdOutputMode = 'pcm';
  private currentActiveDsdOutputMode: ActiveDsdOutputMode = null;
  private currentDsdNativeSampleRate: number | null = null;
  private currentDsdTransportSampleRate: number | null = null;
  private asioNativeDsdDisabledForCurrentPlayback = false;
  private repeatMode: RepeatMode = 'off';
  private queueRevision = 0;
  private currentQueueItemId: string | null = null;
  private currentQueueRevision: number | null = null;
  private queueSnapshot: AudioBackendQueueSnapshot = {
    revision: 0,
    currentItemId: null,
    repeatMode: 'off',
    items: [],
  };
  private currentReplayGain: ReplayGainTrackData | null = null;
  private currentReplayGainCalculation: ReplayGainCalculation = {
    appliedDb: 0,
    selectedGainDb: null,
    selectedPeak: null,
    preventedClipping: false,
    active: false,
  };
  private currentReadyResult: NativeBridgeReadyResult | null = null;
  private currentBridgeOutputMode: AudioOutputMode | null = null;
  private currentBridgeSharedBackend: AudioSharedBackend | null = null;
  private currentResidentOutputSampleRate: number | null = null;
  private currentResamplerEngine: AudioResamplerEngine = 'default';
  private currentResamplerFallbackActive = false;
  private activeAutomix: ActiveAutomixState | null = null;
  private activeAutomixV2: {
    state: AutomixRuntimeState;
    plan: AutomixTransitionPlanV2;
    nextFilePath: string;
    nextInputHeaders: Record<string, string> | null;
    nextMetadata: AudioSessionPlayRequest['metadata'] | null;
    nextProbe: AudioProbeResult;
    nextReplayGain: ReplayGainTrackData | null;
  } | null = null;
  private automixPreparationTask: Promise<void> | null = null;
  private daemonGaplessActive = false;
  private nativeHostNotificationQueue: Promise<void> = Promise.resolve();
  private decoderRun: DecoderRun | null = null;
  private decoderStopInProgress: Promise<void> | null = null;
  private pausedOutputPrewarmPromise: Promise<void> | null = null;
  private pausedSeekTransaction: Promise<void> | null = null;
  private pausedDecoderPrewarm: PausedDecoderPrewarm | null = null;
  private gainTransform: PcmVolumeTransform | null = null;
  private speedTransform: PcmPlaybackRateTransform | null = null;
  private levelMeterTransform: PcmLevelMeterTransform | null = null;
  private decoderPipelineCleanup: (() => void) | null = null;
  private levelSnapshot: PcmLevelSnapshot = {
    inputPeakDb: null,
    inputRmsDb: null,
    visualSpectrum: Array.from({ length: visualSpectrumBucketCount }, () => 0),
    visualSpectrumVersion: 2,
    visualEnergy: 0,
    visualTransient: 0,
    visualTelemetryState: 'fallback',
    clipCount: 0,
    lastClipAt: null,
    levelMeterObserveCostMs: 0,
    visualSpectrumComputeCostMs: 0,
  };
  private readonly disabledVisualSpectrum = Array.from({ length: visualSpectrumBucketCount }, () => 0);
  private nativeAudioLevels: AudioLevelTelemetry | null = null;
  private errorMessage: string | null = null;
  private outputWarnings: string[] = [];
  private pausedPositionSeconds: number | null = null;
  private exclusiveReleaseOnPausePromise: Promise<void> | null = null;
  private exclusiveReleasedOnPause = false;
  private exclusiveResumeAfterRelease = false;
  private runToken = 0;
  private readonly watchdogIntervalMs: number;
  private readonly watchdogStallChecks: number;
  private readonly watchdogMaxRecoveriesPerTrack: number;
  private readonly watchdogRecoveryWindowMs: number;
  private readonly transportFadeDurationOverrideMs: number | null;
  private readonly transportFadeStepMs: number;
  private readonly transportFadeWait: (durationMs: number) => Promise<void>;
  private transportFadeGeneration = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogLastPositionSeconds: number | null = null;
  private watchdogStalledChecks = 0;
  private watchdogRecovering = false;
  private watchdogPendingWarning: string | null = null;
  private pendingOutputWarnings: string[] = [];
  private playbackDiagnosticEvents: AudioPlaybackDiagnosticEvent[] = [];
  private lastExclusiveInstabilityFallbackDisabledLogAt: number | null = null;
  private lastPositionSample: PositionSample | null = null;
  private positionJumpGuardUntilMs = 0;
  private watchdogLastRecoveryAt: string | null = null;
  private readonly watchdogRecoveries = new Map<string, { count: number; windowStartedAt: number }>();
  private readonly localPlaybackRecoveries = new Map<string, { count: number; windowStartedAt: number }>();
  private sharedStabilityTier: SharedStabilityTier = 'standard';
  private currentOutputAdaptiveProfile: SharedOutputProfile | null = null;
  private pendingOutputAdaptiveProfile: SharedOutputProfile | null = null;
  private sharedStabilityRecovering = false;
  private lastSharedStabilityRecoveryAt: string | null = null;
  private nativeDeviceBufferFrames: number | null = null;
  private nativeRequestedBufferFrames: number | null = null;
  private nativeActualBufferFrames: number | null = null;
  private nativeFifoCapacityFrames: number | null = null;
  private nativeStartupPrebufferFrames: number | null = null;
  private nativeTelemetry: NativeOutputTelemetry = {
    positionFrames: 0,
    bufferedFrames: null,
    underrunCallbacks: 0,
    underrunFrames: 0,
    dspClippingRisk: false,
    dspLimiterProtecting: false,
  };
  private lastNativeTelemetryStatusEmittedAt = 0;
  private lastLevelMeterStatusEmittedAt = 0;
  private nativeStartupStatusGuardActive = false;
  private nativePositionReportedBeforePlaying = false;
  private nativePositionBeforePlayingBaselineSeconds: number | null = null;
  private nativePlaybackStartedAtMs = 0;
  private nativePlaybackStartPositionSeconds = 0;
  private lastNativeStartupTelemetryLoggedAt = 0;
  private nativeStartupUnderrunBaseline: Pick<NativeOutputTelemetry, 'underrunCallbacks' | 'underrunFrames'> | null = null;
  private nativeUnderrunWindow:
    | {
        startedAt: number;
        callbacks: number;
        frames: number;
      }
    | null = null;
  private mainEventLoopLagTimer: ReturnType<typeof setInterval> | null = null;
  private mainEventLoopLagMs = 0;
  private audioHostRestartCount = 0;
  private playbackRecoveryCount = 0;
  private activeDaemonBackend: DaemonAudioBackend | null = null;
  private activeDaemonRemoteSource = false;
  private daemonStopInProgress: Promise<void> | null = null;
  private readonly preparedLocalPlaybackCache = new Map<string, PreparedLocalPlaybackItem>();
  private readonly sharedStabilityMemory = new Map<string, { tier: SharedStabilityTier; expiresAt: number }>();
  private lastSharedStabilityRecoveryKey: string | null = null;
  private audioErrorRecoveryHandler: AudioErrorRecoveryHandler | null = null;
  private readonly eqStateListener = (): void => {
    this.emitStatus();
  };

  constructor(dependencies: AudioSessionDependencies = {}) {
    super();
    this.setMaxListeners(64);
    this.logger = dependencies.logger ?? defaultLogger;
    this.verboseLogger = dependencies.logger ?? (verboseAudioLogsEnabled ? defaultLogger : noopLogger);
    this.platform = dependencies.platform ?? process.platform;
    this.decoder = dependencies.decoder ?? new DecoderPipeline({
      logger: this.logger,
      getSpawnEnv: () => buildNetworkProxyEnv(getAppSettings()),
    });
    this.automixAnalyzer = dependencies.automixAnalyzer ?? new AutomixAnalyzer({
      logger: this.logger,
      persistentStore: process.env.NODE_ENV !== 'test',
    });
    this.deviceService = dependencies.deviceService ?? new DeviceService({ logger: this.logger, platform: this.platform });
    if (!dependencies.deviceService && process.env.NODE_ENV !== 'test') {
      void this.deviceService.listRoutingDevicesAsync?.().catch((error) => {
        this.logger(`[AudioSession] output route cache prewarm failed: ${
          error instanceof Error ? error.message : String(error)
        }`);
      });
    }
    this.isNativeHostAvailable = dependencies.isNativeHostAvailable ?? isNativeOutputBridgeAvailable;
    this.startAudioDaemonForPlayback = dependencies.startAudioDaemon ?? startAudioDaemon;
    this.stopAudioDaemonForPlayback = dependencies.stopAudioDaemon ?? stopAudioDaemon;
    this.createDaemonAudioBackendForPlayback = dependencies.createDaemonAudioBackend ?? (async (deviceId, outputSettings) => {
      if (!daemonBridge?.isDaemonRunning?.()) {
        return null;
      }

      return createAudioBackend({
        jrpc: activeJsonRpcBridge,
        deviceId,
        outputSettings,
      });
    });
    this._depCreateBridge = dependencies.createBridge;
    this.reportAudioError = dependencies.reportAudioError ?? defaultAudioErrorReporter;
    this.watchdogIntervalMs = Math.max(250, dependencies.watchdogIntervalMs ?? defaultWatchdogIntervalMs);
    this.watchdogStallChecks = Math.max(1, dependencies.watchdogStallChecks ?? defaultWatchdogStallChecks);
    this.watchdogMaxRecoveriesPerTrack = Math.max(
      0,
      dependencies.watchdogMaxRecoveriesPerTrack ?? defaultWatchdogMaxRecoveriesPerTrack,
    );
    this.watchdogRecoveryWindowMs = Math.max(1000, dependencies.watchdogRecoveryWindowMs ?? defaultWatchdogRecoveryWindowMs);
    this.transportFadeDurationOverrideMs = Number.isFinite(dependencies.transportFadeDurationMs)
      ? Math.max(0, Number(dependencies.transportFadeDurationMs))
      : null;
    this.transportFadeStepMs = Math.max(1, dependencies.transportFadeStepMs ?? defaultTransportFadeStepMs);
    this.transportFadeWait = dependencies.transportFadeWait ?? ((durationMs) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.max(0, durationMs));
      timer.unref?.();
    }));
    this.diagnosticLogger = dependencies.diagnosticLogger ?? defaultDiagnosticLogger;
    this.hostStatus = this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';
    this.on('error', () => undefined);
    getEqBridge().on('state', this.eqStateListener);
    getEqBridge().on('channelBalanceState', this.eqStateListener);
    getEqBridge().on('roomCorrectionState', this.eqStateListener);
    if (!dependencies.disableWatchdogTimer) {
      this.watchdogTimer = setInterval(() => {
        void this.checkPlaybackWatchdog();
      }, this.watchdogIntervalMs);
      this.watchdogTimer.unref?.();
      this.startMainEventLoopLagMonitor();
    }
  }

  private startMainEventLoopLagMonitor(): void {
    if (this.mainEventLoopLagTimer) {
      return;
    }

    let expectedAt = performance.now() + mainEventLoopLagSampleIntervalMs;
    this.mainEventLoopLagTimer = setInterval(() => {
      const now = performance.now();
      this.mainEventLoopLagMs = Math.round(Math.max(0, now - expectedAt));
      expectedAt = now + mainEventLoopLagSampleIntervalMs;
    }, mainEventLoopLagSampleIntervalMs);
    this.mainEventLoopLagTimer.unref?.();
  }

  listDevices(): AudioDeviceInfo[] {
    return this.deviceService.listDevices();
  }

  async listDevicesAsync(): Promise<AudioDeviceInfo[]> {
    // ASIO probing can contend with a live native session. During playback,
    // refresh only the OS shared endpoint list and retain cached ASIO routes.
    // This keeps USB hot-plug discovery live without reopening ASIO drivers.
    if (this.state === 'loading' || this.state === 'playing' || this.state === 'paused') {
      const cachedDevices = this.deviceService.listDevices();
      const sharedDevices = await (this.deviceService.refreshSharedDevicesAsync?.()
        ?? Promise.resolve(cachedDevices.filter((device) => device.outputMode === 'shared')));
      return [
        ...sharedDevices,
        ...cachedDevices.filter((device) => device.outputMode !== 'shared'),
      ];
    }
    const devices = await (this.deviceService.refreshRoutingDevicesAsync?.()
      ?? this.deviceService.listRoutingDevicesAsync?.()
      ?? this.deviceService.listDevicesAsync?.()
      ?? this.deviceService.listDevices());

    if (
      this.state === 'error' &&
      this.currentDevice &&
      !devices.some((device) =>
        device.outputMode === (this.currentDevice?.outputMode === 'exclusive' ? 'shared' : this.currentDevice?.outputMode) &&
        device.name === this.currentDevice?.name,
      )
    ) {
      this.currentDevice = null;
      this.currentOutputDeviceName = null;
      this.currentOutputDeviceType = null;
      this.currentOutputBackend = null;
      this.currentOutputBackendImpl = null;
      this.emitStatus();
    }

    return devices;
  }

  setAudioErrorRecoveryHandler(handler: AudioErrorRecoveryHandler | null): void {
    this.audioErrorRecoveryHandler = handler;
  }

  private async refreshDeviceService(): Promise<void> {
    if (this.deviceService.refresh) {
      await this.deviceService.refresh();
      return;
    }

    await (this.deviceService.listDevicesAsync?.() ?? Promise.resolve(this.deviceService.listDevices()));
  }

  async prepareLocalFile(request: AudioSessionPrepareLocalFileRequest): Promise<void> {
    const startedAt = performance.now();
    const context = this.createLocalPrepareContext(request.filePath, request.trackId, request.probe);
    const redactedFilePath = redactUrlSecrets(request.filePath);
    const providedProbe = createProbeFromHint(request.filePath, request.probe);
    const dsdNativeProbeRequired = providedProbe ? shouldProbeDsdNativeSampleRate(providedProbe) : false;
    const providedProbeComplete = isProbeHintCompleteEnough(request.probe) && !dsdNativeProbeRequired;

    if (verboseAudioLogsEnabled) {
      this.logger(JSON.stringify({
        event: 'local_prepare_started',
        filePath: redactedFilePath,
        trackId: request.trackId ?? null,
        usedProvidedProbe: providedProbeComplete,
      }));
    }

    try {
      let probeHint = request.probe;
      let probeMs = 0;

      if (!providedProbeComplete) {
        const probeStartedAt = performance.now();
        const probed = await this.decoder.probeLocalFile(request.filePath);
        probeMs = Math.max(0, Math.round(performance.now() - probeStartedAt));
        probeHint = mergeProbeHints(createProbeHint(probed), request.probe);
      }

      const probe = createProbeFromHint(request.filePath, probeHint);
      const plan = probe
        ? this.createSampleRatePlan(probe, context.outputSettings, context.device)
        : null;
      const now = Date.now();

      this.storePreparedLocalPlayback(context.key, {
        filePath: request.filePath,
        trackId: request.trackId,
        probe: probeHint,
        preparedAt: now,
        expiresAt: now + preparedLocalPlaybackTtlMs,
        outputMode: plan?.outputMode,
        requestedOutputSampleRate: plan?.requestedOutputSampleRate ?? null,
        decoderOutputSampleRate: plan?.decoderOutputSampleRate ?? null,
        warnings: plan?.warnings,
      });

      if (request.automixAnalyze === true && probe) {
        const analysisHint = createAutomixAnalysisHint(probeHint);
        void this.automixAnalyzer.analyze({
          filePath: request.filePath,
          probe,
          headers: request.inputHeaders,
          hint: analysisHint,
        }).catch((error) => {
          this.logger(`[AudioSession] Automix prepare analysis skipped: ${error instanceof Error ? error.message : String(error)}`);
        });
      }

      if (verboseAudioLogsEnabled) {
        this.logger(JSON.stringify({
          event: 'local_prepare_completed',
          filePath: redactedFilePath,
          trackId: request.trackId ?? null,
          prepareMs: Math.max(0, Math.round(performance.now() - startedAt)),
          probeMs,
          usedProvidedProbe: providedProbeComplete,
          requestedOutputSampleRate: plan?.requestedOutputSampleRate ?? null,
          decoderOutputSampleRate: plan?.decoderOutputSampleRate ?? null,
        }));
      }
    } catch (error) {
      this.logger(JSON.stringify({
        event: 'local_prepare_failed',
        filePath: redactedFilePath,
        trackId: request.trackId ?? null,
        prepareMs: Math.max(0, Math.round(performance.now() - startedAt)),
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async resolveAutomaticOutputSettings(settings: AudioOutputSettings): Promise<AudioOutputSettings> {
    const manualRouteRequested =
      settings.outputMode !== undefined ||
      settings.sharedBackend !== undefined ||
      settings.deviceIndex !== undefined ||
      settings.deviceName !== undefined ||
      settings.latencyProfile !== undefined ||
      settings.bufferSizeFrames !== undefined;

    if (settings.automaticOutputEnabled !== true) {
      if (settings.automaticOutputEnabled === false) {
        this.automaticOutputStage = 'disabled';
      }
      if (settings.automaticOutputEnabled === undefined && this.outputSettings.automaticOutputEnabled === true && manualRouteRequested) {
        this.automaticOutputStage = 'disabled';
        return { ...settings, automaticOutputEnabled: false };
      }
      return settings;
    }

    try {
      await this.refreshDeviceService();
    } catch (error) {
      this.logger(`[AudioSession] automatic output device refresh failed; using current device snapshot: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }

    const nativeSharedSupported = this.platform === 'win32' || this.platform === 'linux' || this.platform === 'darwin';
    this.automaticOutputStage = nativeSharedSupported ? 'default-shared' : 'disabled';
    return {
      ...settings,
      automaticOutputEnabled: true,
      outputMode: nativeSharedSupported ? 'shared' : 'system',
      sharedBackend: 'auto',
      latencyProfile: 'balanced',
      bufferSizeFrames: null,
      deviceIndex: undefined,
      deviceName: undefined,
      defaultDeviceFallbackEnabled: true,
      exclusiveInstabilityFallbackEnabled: true,
    };
  }

  async setOutput(settings: AudioOutputSettings): Promise<AudioStatus> {
    settings = await this.resolveAutomaticOutputSettings(settings);
    this.cancelTransportFade();
    const previousOutputSettings = this.currentOutputSettings ? { ...this.currentOutputSettings } : null;
    const previousGlobalOutputSettings = { ...this.outputSettings };
    this.updatePositionFromOutput();
    if (this.shouldClearSharedStabilityMemory(settings)) {
      this.sharedStabilityMemory.clear();
      this.lastSharedStabilityRecoveryKey = null;
      if (!this.sharedStabilityRecovering) {
        this.sharedStabilityTier = 'standard';
      }
    }
    const baseOutputMode = this.currentOutputSettings?.outputMode ?? this.outputSettings.outputMode;
    const baseLatencyProfile = this.currentOutputSettings?.latencyProfile ?? this.outputSettings.latencyProfile;
    const baseSharedBackend = this.currentOutputSettings?.sharedBackend ?? this.outputSettings.sharedBackend;
    const baseVolume = this.currentOutputSettings?.volume ?? this.outputSettings.volume;
    const basePlaybackRate = this.currentOutputSettings?.playbackRate ?? this.outputSettings.playbackRate;
    const basePlaybackSpeedMode = this.currentOutputSettings?.playbackSpeedMode ?? this.outputSettings.playbackSpeedMode;
    const nextOutputMode = normalizeOutputMode(settings.outputMode ?? baseOutputMode);
    const nextSharedBackend =
      nextOutputMode === 'shared'
        ? normalizeSharedBackend(settings.sharedBackend ?? baseSharedBackend)
        : 'auto';
    const nextLatencyProfile = resolveLatencyProfile(
      nextOutputMode,
      settings.latencyProfile,
      baseOutputMode,
      baseLatencyProfile,
      settings.outputMode !== undefined,
    );
    const nextBufferSizeFrames = this.sanitizeLowLatencyBufferForOutputMode(
      nextOutputMode,
      nextLatencyProfile,
      resolveBufferSizeFrames(settings, this.outputSettings.bufferSizeFrames),
      'output_settings',
    );
    this.outputSettings = {
      ...this.outputSettings,
      ...settings,
      outputMode: nextOutputMode,
      sharedBackend: nextSharedBackend,
      latencyProfile: nextLatencyProfile,
      bufferSizeFrames: nextBufferSizeFrames,
      useMiniaudioOutput: settings.useMiniaudioOutput ?? this.outputSettings.useMiniaudioOutput ?? false,
      nativeDirectLocalPlaybackEnabled:
        settings.nativeDirectLocalPlaybackEnabled ?? this.outputSettings.nativeDirectLocalPlaybackEnabled ?? false,
      dsdOutputMode: normalizeDsdOutputMode(settings.dsdOutputMode ?? this.outputSettings.dsdOutputMode),
      sdmMode: normalizeSdmMode(settings.sdmMode ?? this.outputSettings.sdmMode),
      sdmTargetRate: normalizeSdmTargetRate(settings.sdmTargetRate ?? this.outputSettings.sdmTargetRate),
      sdmQualityProfile: normalizeSdmQualityProfile(settings.sdmQualityProfile ?? this.outputSettings.sdmQualityProfile),
      sdmComputeBackend: normalizeSdmComputeBackend(settings.sdmComputeBackend ?? this.outputSettings.sdmComputeBackend),
      sdmOversamplingFilterProfile1x: normalizeEchoSrcFilterProfile(
        settings.sdmOversamplingFilterProfile1x ?? this.outputSettings.sdmOversamplingFilterProfile1x ?? 'sinc-long',
      ),
      sdmOversamplingFilterProfileNx: normalizeEchoSrcFilterProfile(
        settings.sdmOversamplingFilterProfileNx ?? this.outputSettings.sdmOversamplingFilterProfileNx ?? 'poly-sinc-hb',
      ),
      exclusiveInstabilityFallbackEnabled:
        settings.exclusiveInstabilityFallbackEnabled ??
        this.outputSettings.exclusiveInstabilityFallbackEnabled ??
        false,
      defaultDeviceFallbackEnabled: settings.defaultDeviceFallbackEnabled ?? this.outputSettings.defaultDeviceFallbackEnabled ?? false,
      soxrFallbackEnabled: settings.soxrFallbackEnabled ?? this.outputSettings.soxrFallbackEnabled ?? true,
      echoSrcMode: normalizeEchoSrcMode(settings.echoSrcMode ?? this.outputSettings.echoSrcMode),
      echoSrcQualityProfile: normalizeEchoSrcQualityProfile(settings.echoSrcQualityProfile ?? this.outputSettings.echoSrcQualityProfile),
      echoSrcAdvancedModeEnabled:
        settings.echoSrcAdvancedModeEnabled ?? this.outputSettings.echoSrcAdvancedModeEnabled ?? false,
      echoSrcFilterProfile: normalizeEchoSrcFilterProfile(settings.echoSrcFilterProfile ?? this.outputSettings.echoSrcFilterProfile),
      echoSrcFilterProfile1x: normalizeEchoSrcFilterProfile(
        settings.echoSrcFilterProfile1x ??
          this.outputSettings.echoSrcFilterProfile1x ??
          settings.echoSrcFilterProfile ??
          this.outputSettings.echoSrcFilterProfile,
      ),
      echoSrcFilterProfileNx: normalizeEchoSrcFilterProfile(
        settings.echoSrcFilterProfileNx ?? this.outputSettings.echoSrcFilterProfileNx ?? 'poly-sinc-hb',
      ),
      echoSrcComputeBackend: normalizeEchoSrcComputeBackend(settings.echoSrcComputeBackend ?? this.outputSettings.echoSrcComputeBackend),
      pcmDitherMode: normalizePcmDitherMode(settings.pcmDitherMode ?? this.outputSettings.pcmDitherMode),
      releaseExclusiveOnPauseExperimentalEnabled:
        settings.releaseExclusiveOnPauseExperimentalEnabled ??
        this.outputSettings.releaseExclusiveOnPauseExperimentalEnabled ??
        false,
      volume: Math.max(0, Math.min(1, Number(settings.volume ?? baseVolume) || 0)),
      playbackRate: normalizePlaybackRate(settings.playbackRate ?? basePlaybackRate),
      playbackSpeedMode: normalizePlaybackSpeedMode(settings.playbackSpeedMode ?? basePlaybackSpeedMode),
    };
    if (this.outputSettings.sharedBackend === 'directsound') {
      this.outputSettings.deviceIndex = undefined;
    }

    const outputModeChanged = nextOutputMode !== normalizeOutputMode(baseOutputMode);
    if (outputModeChanged && nextOutputMode !== 'system') {
      const targetModeDevice = this.resolveSelectedDevice(this.outputSettings);
      if (targetModeDevice) {
        this.outputSettings.deviceIndex = targetModeDevice.index;
        this.outputSettings.deviceName = targetModeDevice.name;
      } else if (this.outputSettings.deviceName) {
        // Device indexes belong to a backend/mode-specific enumeration. When the
        // target list is not cached, preserve the stable human-readable route and
        // let the native backend resolve it instead of reusing a stale index.
        this.outputSettings.deviceIndex = undefined;
      }
    }

    if (this.currentOutputSettings) {
      const currentNativeDirectLocalPlaybackEnabled =
        settings.nativeDirectLocalPlaybackEnabled === undefined
          ? this.currentOutputSettings.nativeDirectLocalPlaybackEnabled
          : this.outputSettings.nativeDirectLocalPlaybackEnabled;
      this.currentOutputSettings = {
        ...this.currentOutputSettings,
        ...this.outputSettings,
        nativeDirectLocalPlaybackEnabled: currentNativeDirectLocalPlaybackEnabled,
      };
      this.currentUseMiniaudioOutputRequested = this.currentOutputSettings.useMiniaudioOutput === true;
      this.currentDsdOutputModeRequested = normalizeDsdOutputMode(this.currentOutputSettings.dsdOutputMode);
    } else {
      this.currentUseMiniaudioOutputRequested = this.outputSettings.useMiniaudioOutput === true;
      this.currentDsdOutputModeRequested = normalizeDsdOutputMode(this.outputSettings.dsdOutputMode);
    }

    this.currentDevice = createDeviceFromOutputSettings(this.currentOutputSettings ?? this.outputSettings);

    if (nextOutputMode === 'system') {
      this.runToken += 1;
      await this.stopResourcesGracefully('system-output-mode', true);
      this.resetSessionAfterForcedStop();
      this.hostStatus = 'ready';
      return this.getStatus();
    }

    const outputOnlyChangesVolume =
      previousOutputSettings !== null &&
      Object.keys(settings).every((key) => key === 'volume') &&
      this.currentOutputSettings !== null;
    const outputOnlyChangesPlaybackSpeed =
      previousOutputSettings !== null &&
      Object.keys(settings).every((key) => key === 'playbackRate' || key === 'playbackSpeedMode') &&
      this.currentOutputSettings !== null &&
      (this.state !== 'playing' || this.speedTransform !== null || this.activeDaemonBackend !== null);

    if (outputOnlyChangesVolume) {
      const volumeRouting = resolveOutputVolumeRouting(this.bridge, this.currentPlan, this.outputSettings.volume);
      this.bridge?.setVolume?.(volumeRouting.bridgeVolume);
      this.gainTransform?.setVolume(volumeRouting.softwareGain);
      this.levelMeterTransform?.setGain(volumeRouting.meterGain);
      if (this.activeDaemonBackend) {
        await this.activeDaemonBackend.setVolume?.(this.outputSettings.volume);
      }
      this.emitStatus();
      return this.getStatus();
    }

    if (outputOnlyChangesPlaybackSpeed) {
      const positionSeconds = this.clock.getPositionSeconds();
      this.speedTransform?.setPlaybackRate(this.outputSettings.playbackRate);
      this.bridge?.resetOutputClock?.(positionSeconds, this.outputSettings.playbackRate);
      if (this.activeDaemonBackend) {
        await this.activeDaemonBackend.setPlaybackSpeed(
          this.outputSettings.playbackRate,
          this.outputSettings.playbackSpeedMode,
        );
      }
      this.clock.reset(positionSeconds, this.currentPlan?.actualDeviceSampleRate ?? this.currentPlan?.requestedOutputSampleRate ?? null);
      this.markExpectedPositionDiscontinuity();
      this.emitStatus();
      return this.getStatus();
    }

    const outputDoesNotRequireRestart =
      previousOutputSettings !== null &&
      this.currentOutputSettings !== null &&
      outputRestartSettingsEqual(previousOutputSettings, this.currentOutputSettings);
    const outputOnlyChangesDormantDsdDirectSettings =
      previousOutputSettings !== null &&
      this.currentOutputSettings !== null &&
      this.currentFilePath !== null &&
      this.currentProbe !== null &&
      !isDsdPlaybackCandidate(this.currentFilePath, this.currentProbe) &&
      outputRestartSettingsEqualIgnoringDsdDirect(previousOutputSettings, this.currentOutputSettings);
    const playbackSpeedChanged =
      previousOutputSettings !== null &&
      this.currentOutputSettings !== null &&
      (normalizePlaybackRate(previousOutputSettings.playbackRate) !== normalizePlaybackRate(this.currentOutputSettings.playbackRate) ||
        normalizePlaybackSpeedMode(previousOutputSettings.playbackSpeedMode) !==
          normalizePlaybackSpeedMode(this.currentOutputSettings.playbackSpeedMode));
    const playbackSpeedCanUpdateInPlace = this.speedTransform !== null;

    if (this.state === 'paused' && (outputDoesNotRequireRestart || outputOnlyChangesDormantDsdDirectSettings)) {
      this.emitStatus();
      return this.getStatus();
    }

    if (this.state === 'paused') {
      this.runToken += 1;
      await this.stopResourcesGracefully('output-settings-paused');
      this.currentPlan = null;
      this.currentResidentOutputSampleRate = null;
      this.currentOutputBackend = null;
      this.currentOutputBackendImpl = null;
      this.currentOutputDeviceType = null;
      this.currentOutputDeviceName = null;
      this.currentUseMiniaudioOutputRequested = this.outputSettings.useMiniaudioOutput === true;
      this.currentDsdOutputModeRequested = normalizeDsdOutputMode(this.outputSettings.dsdOutputMode);
      this.currentActiveDsdOutputMode = null;
      this.currentDsdNativeSampleRate = null;
      this.currentDsdTransportSampleRate = null;
      this.currentDecodeBackendImpl = null;
      this.currentReadyResult = null;
      this.currentBridgeSharedBackend = null;
      this.hostStatus = this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';
      this.emitStatus();
      return this.getStatus();
    }

    if (this.state === 'playing' && this.currentFilePath && this.currentProbe && this.currentOutputSettings) {
      if (
        (outputDoesNotRequireRestart || outputOnlyChangesDormantDsdDirectSettings) &&
        (!playbackSpeedChanged || playbackSpeedCanUpdateInPlace)
      ) {
        const volumeRouting = resolveOutputVolumeRouting(this.bridge, this.currentPlan, this.outputSettings.volume);
        this.bridge?.setVolume?.(volumeRouting.bridgeVolume);
        this.gainTransform?.setVolume(volumeRouting.softwareGain);
        this.levelMeterTransform?.setGain(volumeRouting.meterGain);

        if (playbackSpeedChanged) {
          const positionSeconds = this.clock.getPositionSeconds();
          this.speedTransform?.setPlaybackRate(this.outputSettings.playbackRate);
          this.bridge?.resetOutputClock?.(positionSeconds, this.outputSettings.playbackRate);
          this.clock.reset(positionSeconds, this.currentPlan?.actualDeviceSampleRate ?? this.currentPlan?.requestedOutputSampleRate ?? null);
          this.markExpectedPositionDiscontinuity();
        }

        this.emitStatus();
        return this.getStatus();
      }

      if (this.isCurrentLivePcmStream()) {
        this.currentOutputSettings = previousOutputSettings;
        this.currentDevice = createDeviceFromOutputSettings(this.currentOutputSettings ?? this.outputSettings);
        this.currentUseMiniaudioOutputRequested = this.currentOutputSettings?.useMiniaudioOutput === true;
        this.currentDsdOutputModeRequested = 'pcm';
        this.addOutputWarning('live_pcm_output_restart_skipped');
        this.logger(
          `[AudioSession] output change saved globally but live PCM stream cannot be restarted source="${redactUrlSecrets(
            this.currentFilePath,
          )}"`,
        );
        this.emitStatus();
        return this.getStatus();
      }

      const positionSeconds = this.clock.getPositionSeconds();
      try {
        return await this.playLocalFile({
          filePath: this.currentFilePath,
          trackId: this.currentTrackId ?? undefined,
          startSeconds: positionSeconds,
          output: this.currentOutputSettings,
          probe: createProbeHint(this.currentProbe),
          inputHeaders: this.currentInputHeaders ?? undefined,
          replayGain: this.currentReplayGain,
        });
      } catch (error) {
        this.outputSettings = previousGlobalOutputSettings;
        this.currentOutputSettings = previousOutputSettings;
        this.currentDevice = createDeviceFromOutputSettings(this.currentOutputSettings ?? this.outputSettings);
        this.emitStatus();
        throw error;
      }
    }

    this.emitStatus();
    return this.getStatus();
  }

  async playLocalFile(request: AudioSessionPlayRequest): Promise<AudioStatus> {
    noteDataProtectionPlaybackActivity(true);
    const token = this.runToken + 1;
    const previousOutputSettings = this.currentOutputSettings ? { ...this.currentOutputSettings } : null;
    const previousDevice = this.currentDevice ? { ...this.currentDevice } : null;
    const outputRestartContext = this.pendingOutputRestartContext;
    const outputAdaptiveProfile = this.pendingOutputAdaptiveProfile;
    this.pendingOutputRestartContext = null;
    this.pendingOutputAdaptiveProfile = null;
    this.currentOutputAdaptiveProfile = outputAdaptiveProfile;
    this.runToken = token;
    this.asioNativeDsdDisabledForCurrentPlayback = false;
    const decoderStop = this.stopDecoderRun();
    if (decoderStop) {
      await decoderStop;
    }
    if (this.activeDaemonBackend || this.daemonStopInProgress) {
      await this.stopActiveDaemonBackend('playback-replaced');
    }
    this.verboseLogger(
      `[AudioSession] playLocalFile: file="${redactUrlSecrets(request.filePath)}" trackId=${request.trackId ?? 'n/a'} start=${
        request.startSeconds ?? 0
      }`,
    );

    this.state = 'loading';
    this.hostStatus = 'starting';
    this.errorMessage = null;
    this.outputWarnings = [
      ...(this.watchdogPendingWarning ? [this.watchdogPendingWarning] : []),
      ...this.pendingOutputWarnings,
    ];
    this.exclusiveReleasedOnPause = false;
    this.watchdogPendingWarning = null;
    this.pendingOutputWarnings = [];
    this.resetWatchdogProgress();
    this.resetLevelMeter();
    this.resetNativeTelemetry();
    this.currentFilePath = request.filePath;
    this.currentInputHeaders = request.inputHeaders ?? null;
    this.currentTrackId = request.trackId ?? null;
    this.currentTrackMetadata = request.metadata ?? null;
    this.currentReplayGain = request.replayGain ?? null;
    this.currentReplayGainCalculation = {
      appliedDb: 0,
      selectedGainDb: null,
      selectedPeak: null,
      preventedClipping: false,
      active: false,
    };
    this.pausedPositionSeconds = null;
    this.currentProbe = null;
    this.currentPlan = null;
    this.currentNativeProcessingStatus = null;
    this.currentResidentOutputSampleRate = null;
    this.currentOutputBackend = null;
    this.currentOutputBackendImpl = null;
    this.currentOutputDeviceType = null;
    this.currentOutputDeviceName = null;
    this.currentResamplerEngine = 'default';
    this.currentResamplerFallbackActive = false;
    this.activeAutomix = null;
    this.activeAutomixV2 = null;
    this.daemonGaplessActive = false;
    this.currentDecodeBackendImpl = null;
    this.nativeStartupStatusGuardActive = false;
    this.nativePositionReportedBeforePlaying = false;
    this.nativePositionBeforePlayingBaselineSeconds = null;
    this.currentOutputSettings = this.createOutputSettingsForRequest(request.output);
    if (this.currentOutputSettings.automaticOutputEnabled === true) {
      this.automaticOutputStage = 'default-shared';
    }
    const playbackPerfDetails = (): { trackId: string | null; outputMode: string | null } => ({
      trackId: this.currentTrackId,
      outputMode: normalizeOutputMode(this.currentOutputSettings?.outputMode ?? this.outputSettings.outputMode),
    });
    this.recordPlaybackDiagnosticEvent('play_request', 'info', 'playLocalFile', {
      trackId: request.trackId ?? null,
      filePath: request.filePath,
      positionSeconds: request.startSeconds ?? 0,
      outputMode: normalizeOutputMode(this.currentOutputSettings.outputMode),
      details: {
        requestedStartSeconds: request.startSeconds ?? 0,
        hasProbeHint: Boolean(request.probe),
        hasInputHeaders: Boolean(request.inputHeaders),
      },
    });
    if (normalizeOutputMode(this.currentOutputSettings.outputMode) === 'system') {
      this.state = 'error';
      this.hostStatus = 'ready';
      this.errorMessage = 'system_audio_requires_renderer';
      this.addOutputWarning('system_audio_requires_renderer');
      this.emitStatus();
      throw new Error('system_audio_requires_renderer');
    }
    this.currentUseMiniaudioOutputRequested = this.currentOutputSettings.useMiniaudioOutput === true;
    this.currentDsdOutputModeRequested = normalizeDsdOutputMode(this.currentOutputSettings.dsdOutputMode);
    this.currentActiveDsdOutputMode = null;
    this.currentDsdNativeSampleRate = null;
    this.currentDsdTransportSampleRate = null;
    this.currentDevice = normalizeOutputMode(this.currentOutputSettings.outputMode) === 'exclusive' ||
      normalizeOutputMode(this.currentOutputSettings.outputMode) === 'asio'
      ? await this.resolvePlaybackDeviceForSettings(this.currentOutputSettings)
      : this.resolvePlanDeviceForSettings(this.currentOutputSettings);
    const requestedOutputSettings = { ...this.currentOutputSettings };
    const requestedDevice = this.currentDevice ? { ...this.currentDevice } : null;
    this.clock.reset(request.startSeconds ?? 0, null);
    this.resetSharedStabilityForFreshPlayback(this.currentOutputSettings.outputMode ?? 'shared', this.currentOutputSettings, this.currentDevice);
    this.verboseLogger(
      `[AudioSession] output: mode=${this.currentOutputSettings.outputMode ?? 'shared'} sharedBackend=${
        this.currentOutputSettings.sharedBackend ?? 'auto'
      } device=${
        this.currentDevice ? `${this.currentDevice.index}:${this.currentDevice.name}` : 'default'
      }`,
    );
    this.emitStatus();

    try {
      const preparedProbe = this.takePreparedLocalProbe(request, this.currentOutputSettings);
      if (preparedProbe) {
        this.verboseLogger(JSON.stringify({
          event: 'local_prepare_used_for_playback',
          filePath: redactUrlSecrets(request.filePath),
          trackId: request.trackId ?? null,
          cacheAgeMs: preparedProbe.ageMs,
        }));
      }
      const playbackProbeHint = preparedProbe?.probe ?? request.probe;
      let probe = createProbeFromHint(request.filePath, playbackProbeHint);
      if (!probe || shouldProbeDsdNativeSampleRate(probe)) {
        if (isHttpPlaybackUrl(request.filePath)) {
          probe = createStreamProbeFromHint(request.filePath, playbackProbeHint);
          this.verboseLogger(JSON.stringify({
            event: 'stream_probe_fallback_used_for_playback',
            filePath: redactUrlSecrets(request.filePath),
            trackId: request.trackId ?? null,
          }));
        } else {
          const probed = await runPlaybackPerformanceStep('AudioSession.playLocalFile', 'probeLocalFile', playbackPerfDetails(), () =>
            this.decoder.probeLocalFile(request.filePath),
          );
          probe = createProbeFromHint(request.filePath, mergeProbeHints(createProbeHint(probed), playbackProbeHint)) ?? probed;
        }
      }
      this.assertCurrentRun(token);
      this.currentProbe = probe;
      const daemonCandidatePlan = this.createSampleRatePlan(probe, this.currentOutputSettings!, this.currentDevice);
      const gaplessRequested = request.gapless?.enabled === true && Boolean(request.gapless.next);
      const gaplessNext = gaplessRequested ? request.gapless?.next ?? null : null;
      const daemonGaplessCandidates = gaplessNext
        ? [gaplessNext, ...(request.gapless?.following ?? [])].slice(0, 31)
        : [];
      const daemonGaplessProbeCandidates = await Promise.all(
        daemonGaplessCandidates.map((track) =>
          this.resolveAutomixNextProbe(track).catch((error) => {
            this.logger(`[AudioSession] native gapless candidate skipped: ${
              error instanceof Error ? error.message : String(error)
            }`);
            return null;
          })),
      );
      const firstUnavailableGaplessIndex = daemonGaplessProbeCandidates.findIndex((candidate) => candidate === null);
      const daemonGaplessTrackCount = firstUnavailableGaplessIndex >= 0
        ? firstUnavailableGaplessIndex
        : daemonGaplessCandidates.length;
      const daemonGaplessTracks = daemonGaplessCandidates.slice(0, daemonGaplessTrackCount);
      const daemonGaplessProbes = daemonGaplessProbeCandidates
        .slice(0, daemonGaplessTrackCount)
        .filter((candidate): candidate is AudioProbeResult => candidate !== null);
      const daemonGaplessUnavailableReason = !gaplessRequested
        ? null
        : request.automix?.enabled === true
          ? 'automix_active'
          : !gaplessNext || daemonGaplessProbes.length === 0
            ? 'next_track_unavailable'
            : !isLocalPlaybackPath(request.filePath)
              || daemonGaplessTracks.some((track, index) =>
                !isLocalPlaybackPath(track.filePath)
                || !isNativeDaemonLocalSourceSupported(track.filePath, daemonGaplessProbes[index]!)
                || Boolean(track.inputHeaders))
              || Boolean(request.inputHeaders)
              || daemonGaplessProbes.some((nextProbe, index) =>
                nextProbe.channels < 1
                || nextProbe.channels > 2
                || isDsdCodec(nextProbe.codec)
                || isDsdFilePath(daemonGaplessTracks[index]?.filePath ?? ''))
              ? 'unsupported_next_track'
              : normalizeOutputMode(this.currentOutputSettings?.outputMode) !== 'shared'
                && daemonGaplessProbes.some((nextProbe) =>
                  normalizeAudioSampleRate(nextProbe.fileSampleRate) !== normalizeAudioSampleRate(probe.fileSampleRate))
                ? 'sample_rate_mismatch'
              : daemonCandidatePlan.dsdOutputMode !== 'pcm'
                || daemonCandidatePlan.sdmPcmToDsdActive === true
                || daemonCandidatePlan.echoSrcActive === true
                ? 'native_processing_active'
                : Math.abs((this.currentOutputSettings?.playbackRate ?? 1) - 1) > 1e-6
                  ? 'playback_rate_active'
                  : getReplayGainAudioSettings().replayGainEnabled === true
                    ? 'replay_gain_active'
                    : null;
      const daemonGaplessEligible = gaplessRequested && daemonGaplessUnavailableReason === null;
      const automixV2Requested = request.automix?.enabled === true && Boolean(request.automix.next);
      const hasChainedPlaybackRequest = gaplessRequested && !daemonGaplessEligible;
      const legacyPlaybackRequest: AudioSessionPlayRequest = gaplessRequested
        ? { ...request, gapless: undefined, automix: undefined }
        : automixV2Requested
          ? { ...request, automix: undefined }
          : request;
      if (daemonGaplessUnavailableReason) {
        this.addOutputWarning(`native_gapless_unavailable:${daemonGaplessUnavailableReason}`);
      }
      const nativeDirectLocalPlaybackFallbackReason =
        request.remoteDaemonPlaybackFallbackAttempt === true && isHttpPlaybackUrl(request.filePath)
          ? 'remote_source'
          : getNativeDirectDaemonPlaybackFallbackReason(
              request.filePath,
              request.inputHeaders,
              request.mimeType,
              probe,
              daemonCandidatePlan,
              this.currentOutputSettings!,
              hasChainedPlaybackRequest,
            );
      const remoteDaemonPlayback = nativeDirectLocalPlaybackFallbackReason === null && isHttpPlaybackUrl(request.filePath);
      let daemonGaplessFellBackToOrdinaryPlayback = false;
      if (nativeDirectLocalPlaybackFallbackReason === null) {
        try {
          // One-shot PCM/DoP/native-DSD hosts own the hardware device. A
          // daemon takeover must wait for the old process to exit so ASIO
          // cannot observe overlapping PCM and DSD transports.
          if (this.bridge || this.bridgeStopInProgress) {
            await this.stopResourcesGracefully('native-direct-takeover', true);
            this.assertCurrentRun(token);
          }
          if (this.activeDaemonBackend || this.daemonStopInProgress) {
            await this.stopActiveDaemonBackend('native-direct-replace');
          }
          await this.startAudioDaemonForPlayback();
          this.assertCurrentRun(token);
          const daemonOutputMode = normalizeOutputMode(this.currentOutputSettings!.outputMode);
          const nativePlan = daemonCandidatePlan;
          this.currentPlan = nativePlan;
          const nativeProcessing: NativeDspProcessingConfig = {
            outputFormat: nativePlan.sdmPcmToDsdActive
              ? nativePlan.sdmOutputFormat ?? 'dop24le'
              : 'pcm',
          };
          const sourceSampleRate = normalizeAudioSampleRate(nativePlan.fileSampleRate);
          const echoTargetSampleRate = normalizeAudioSampleRate(nativePlan.echoSrcTargetSampleRate);
          const echoUpsampleFactor = normalizeEchoSrcUpsampleFactor(sourceSampleRate, echoTargetSampleRate);
          if (
            nativePlan.echoSrcActive &&
            nativePlan.echoSrcAdvancedModeEnabled &&
            sourceSampleRate &&
            echoTargetSampleRate &&
            echoUpsampleFactor &&
            echoUpsampleFactor !== 1
          ) {
            const stagePlans = createEchoSrcFirStagePlans(
              nativePlan.echoSrcFilterProfile,
              sourceSampleRate,
              echoTargetSampleRate,
              {
                resolveProfile: (stageSourceRate) => resolveEchoSrcFilterProfileForSlot(
                  resolveEchoSrcFilterSlot(stageSourceRate),
                  {
                    echoSrcFilterProfile: nativePlan.echoSrcFilterProfile,
                    echoSrcFilterProfile1x: nativePlan.echoSrcFilterProfile1x,
                    echoSrcFilterProfileNx: nativePlan.echoSrcFilterProfileNx,
                  },
                ),
              },
            );
            const nativeStages = stagePlans.length > 0
              ? stagePlans.map((stage) => ({
                  upsampleFactor: stage.upsampleFactor,
                  taps: Array.from(createEchoSrcFirTaps(stage.plan)),
                }))
              : [{
                  upsampleFactor: echoUpsampleFactor,
                  taps: Array.from(createEchoSrcFirTaps(
                    createEchoSrcFirPlan(nativePlan.echoSrcFilterProfile, sourceSampleRate, echoTargetSampleRate),
                  )),
                }];
            nativeProcessing.echoSrc = {
              sourceSampleRate,
              targetSampleRate: echoTargetSampleRate,
              stages: nativeStages,
              computeBackend: nativePlan.echoSrcComputeBackend,
            };
          }
          const ditherMode = normalizePcmDitherMode(this.currentOutputSettings!.pcmDitherMode);
          if (ditherMode !== 'off' && !nativePlan.sdmPcmToDsdActive && daemonOutputMode !== 'shared') {
            nativeProcessing.dither = { mode: ditherMode, bitDepth: 24 };
          }
          if (nativePlan.sdmPcmToDsdActive) {
            const sdmTargetSampleRate = normalizeAudioSampleRate(nativePlan.sdmTransportSampleRate);
            if (!sourceSampleRate || !sdmTargetSampleRate) {
              throw new Error('native_sdm_invalid_sample_rate_plan');
            }
            const sdmStagePlans = createEchoSrcFirStagePlans(
              nativePlan.sdmOversamplingFilterProfile,
              sourceSampleRate,
              sdmTargetSampleRate,
              {
                resolveProfile: (stageSourceRate) => resolveEchoSrcFilterProfileForSlot(
                  resolveEchoSrcFilterSlot(stageSourceRate),
                  {
                    echoSrcFilterProfile: nativePlan.sdmOversamplingFilterProfile,
                    echoSrcFilterProfile1x: nativePlan.sdmOversamplingFilterProfile1x,
                    echoSrcFilterProfileNx: nativePlan.sdmOversamplingFilterProfileNx,
                  },
                ),
              },
            );
            if (sdmStagePlans.length === 0) {
              throw new Error(`native_sdm_oversampling_unsupported:${sourceSampleRate}->${sdmTargetSampleRate}`);
            }
            nativeProcessing.sdm = {
              sourceSampleRate,
              targetSampleRate: sdmTargetSampleRate,
              stages: sdmStagePlans.map((stage) => ({
                upsampleFactor: stage.upsampleFactor,
                taps: Array.from(createEchoSrcFirTaps(stage.plan)),
              })),
              qualityProfile: normalizeSdmQualityProfile(this.currentOutputSettings!.sdmQualityProfile),
              computeBackend: nativePlan.sdmComputeBackend,
            };
          }
          const daemonRequestedSampleRate = nativePlan.requestedOutputSampleRate;
          const daemonOutputSettings: AudioOutputSettings & DaemonOutputSettings = {
            ...this.currentOutputSettings!,
            requestedOutputSampleRate: daemonRequestedSampleRate,
            nativeProcessing,
          };
          const daemonBackend = await this.createDaemonAudioBackendForPlayback(
            this.currentDevice?.id ?? '',
            daemonOutputSettings,
          );
          if (!daemonBackend) {
            throw new Error('daemon_backend_unavailable');
          }
          this.activeDaemonBackend = daemonBackend;
          this.activeDaemonRemoteSource = remoteDaemonPlayback;
          this.currentNativeProcessingStatus = daemonBackend.getNativeProcessingStatus?.() ?? null;
          if (remoteDaemonPlayback) {
            // Remote URLs and auth headers are short-lived session material.
            // The renderer/main queue remains authoritative and resolves the
            // next track again after the host reports a real drained EOF.
            await daemonBackend.clearQueue();
          } else {
            await this.replayQueueSnapshotToDaemonBackend(daemonBackend);
          }
          this.assertCurrentRun(token);

          let resolveFirstPcm: (() => void) | null = null;
          let rejectFirstPcm: ((error: Error) => void) | null = null;
          let resolveAudioStarted: (() => void) | null = null;
          let rejectAudioStarted: ((error: Error) => void) | null = null;
          let remoteAudioStartedObserved = false;
          const firstPcmSignal = new Promise<void>((resolve, reject) => {
            resolveFirstPcm = resolve;
            rejectFirstPcm = reject;
          });
          const audioStartedSignal = new Promise<void>((resolve, reject) => {
            resolveAudioStarted = resolve;
            rejectAudioStarted = reject;
          });
          // Notifications can arrive while audio.openSource is still resolving.
          // Mark both rejections handled immediately while preserving the
          // original promises for the startup waits below.
          void firstPcmSignal.catch(() => undefined);
          void audioStartedSignal.catch(() => undefined);

          daemonBackend.onPosition((pos: number) => {
            if (this.runToken === token && this.state === 'playing') {
              const sampledAtMs = Date.now();
              this.clock.reset(pos, probe.fileSampleRate ?? 48000);
              this.watchdogLastPositionSeconds = pos;
              this.handlePositionSample(token, pos, null, sampledAtMs);
              this.maybeAdvanceAutomix(token);
              this.watchdogStalledChecks = 0;
              this.emitNativeTelemetryStatus();
            }
          });

          daemonBackend.onLevelMeter?.((snapshot) => {
            if (this.runToken !== token || (this.state !== 'playing' && this.state !== 'loading')) {
              return;
            }
            this.nativeAudioLevels = createNativeAudioLevelTelemetry(
              Math.max(...snapshot.peakDb),
              Math.max(...snapshot.rmsDb),
            );
            if (this.state === 'playing') {
              const now = Date.now();
              if (now - this.lastLevelMeterStatusEmittedAt >= levelMeterStatusIntervalMs) {
                this.lastLevelMeterStatusEmittedAt = now;
                this.emitStatus();
              }
            }
          });

          daemonBackend.onAutomixTransitionCommitted((event) => {
            if (this.runToken === token && (this.state === 'playing' || this.state === 'loading')) {
              this.handleAutomixV2TransitionCommitted(event);
            }
          });

          daemonBackend.onEnded((params?: Record<string, unknown>) => {
            if (this.runToken === token && (this.state === 'playing' || this.state === 'loading')) {
              if (remoteDaemonPlayback && this.state === 'loading' && !remoteAudioStartedObserved) {
                const error = new Error('daemon_remote_ended_before_started');
                rejectFirstPcm?.(error);
                rejectAudioStarted?.(error);
                return;
              }
              this.updatePositionFromOutput();
              this.maybeAdvanceAutomix(token);
              if (params?.queueAdvance === true) {
                this.handleQueueAdvance(params);
              } else {
                void this.finalizeNaturalDaemonEnd(token);
              }
            }
          });

          daemonBackend.onError((err: Error) => {
            if (this.runToken === token) {
              if (remoteDaemonPlayback && this.state === 'loading') {
                rejectFirstPcm?.(err);
                rejectAudioStarted?.(err);
                return;
              }
              this.handleError(err);
            }
          });

          if (remoteDaemonPlayback) {
            daemonBackend.onFirstPcm(() => resolveFirstPcm?.());
            daemonBackend.onStarted(() => {
              remoteAudioStartedObserved = true;
              resolveAudioStarted?.();
            });
          }

          const requestedSpeed = this.currentOutputSettings?.playbackRate ?? this.outputSettings.playbackRate;
          const requestedSpeedMode = this.currentOutputSettings?.playbackSpeedMode ?? this.outputSettings.playbackSpeedMode;
          if (Math.abs(requestedSpeed - 1) > 1e-6 || requestedSpeedMode !== 'nightcore') {
            await daemonBackend.setPlaybackSpeed(requestedSpeed, requestedSpeedMode);
          }

          await daemonBackend.setVolume?.(this.currentOutputSettings?.volume ?? this.outputSettings.volume);
          // A fresh daemon starts with flat/default processors. Rehydrate every
          // persisted DSP module before openFile can enqueue the first PCM.
          await daemonBackend.syncDspState?.(this.createEqProfileBindingTarget());
          const daemonReplayGain = this.calculateCurrentReplayGain();
          await daemonBackend.setReplayGainConfig({
            trackGainDb: daemonReplayGain.appliedDb,
            albumGainDb: daemonReplayGain.appliedDb,
            peak: 0,
            mode: daemonReplayGain.active ? 1 : 0,
            preampDb: 0,
            preventClipping: false,
          });
          this.currentReplayGainCalculation = daemonReplayGain;
          this.assertCurrentRun(token);
          const inputSource: AudioInputSource = remoteDaemonPlayback
            ? {
                kind: 'http',
                uri: request.filePath,
                headers: request.inputHeaders,
                mimeType: request.mimeType,
              }
            : { kind: 'local', uri: request.filePath };
          const delayDaemonStart = remoteDaemonPlayback || daemonGaplessEligible;
          const backendProbe = await runPlaybackPerformanceStep(
            'AudioSession.playLocalFile',
            'daemon open',
            playbackPerfDetails(),
            () => daemonBackend.openSource(
              inputSource,
              request.startSeconds ?? 0,
              delayDaemonStart ? { startPaused: true, autoPlay: false } : undefined,
            ),
          );
          this.assertCurrentRun(token);
          if (daemonGaplessEligible && gaplessNext) {
            const queuedNext = this.queueSnapshot.items.find((item) =>
              item.trackId === (gaplessNext.trackId ?? gaplessNext.filePath) || item.filePath === gaplessNext.filePath,
            );
            try {
              await runPlaybackPerformanceStep(
                'AudioSession.playLocalFile',
                'daemon gapless prepare',
                playbackPerfDetails(),
                () => daemonBackend.prepareGapless({
                  filePath: gaplessNext.filePath,
                  trackId: gaplessNext.trackId ?? gaplessNext.filePath,
                  itemId: queuedNext?.itemId,
                  metadata: queuedNext?.metadata,
                  following: daemonGaplessTracks.slice(1).map((track) => {
                    const queuedTrack = this.queueSnapshot.items.find((item) =>
                      item.trackId === (track.trackId ?? track.filePath) || item.filePath === track.filePath,
                    );
                    return {
                      filePath: track.filePath,
                      trackId: track.trackId ?? track.filePath,
                      itemId: queuedTrack?.itemId,
                      metadata: queuedTrack?.metadata,
                    };
                  }),
                }),
              );
              this.daemonGaplessActive = true;
            } catch (gaplessError) {
              this.daemonGaplessActive = false;
              const reason = gaplessError instanceof Error ? gaplessError.message.slice(0, 96) : 'unknown';
              this.addOutputWarning(`native_gapless_prepare_failed:${reason}`);
              this.logger(`[AudioSession] native gapless priming failed; continuing normal playback: ${reason}`);
            }
            await daemonBackend.startOpenedSource();
            this.assertCurrentRun(token);
          }
          if (remoteDaemonPlayback) {
            const actualSourceSampleRate = normalizeAudioSampleRate(backendProbe.sourceSampleRate);
            const plannedSourceSampleRate = normalizeAudioSampleRate(probe.fileSampleRate);
            const sourceRateAffectsOutputPlan =
              daemonOutputMode === 'exclusive' ||
              daemonOutputMode === 'asio' ||
              nativePlan.echoSrcActive ||
              nativePlan.sdmPcmToDsdActive;
            if (
              sourceRateAffectsOutputPlan &&
              actualSourceSampleRate &&
              actualSourceSampleRate !== plannedSourceSampleRate &&
              request.remoteSampleRateCorrectionAttempt !== true
            ) {
              throw new DaemonRemoteSampleRateCorrection(actualSourceSampleRate);
            }
            if (
              sourceRateAffectsOutputPlan &&
              actualSourceSampleRate &&
              actualSourceSampleRate !== plannedSourceSampleRate
            ) {
              throw new Error(
                `daemon_remote_source_rate_mismatch:${String(plannedSourceSampleRate)}:${actualSourceSampleRate}`,
              );
            }
            await daemonBackend.startOpenedSource();
            this.assertCurrentRun(token);
            await runPlaybackPerformanceStep(
              'AudioSession.playLocalFile',
              'first PCM',
              playbackPerfDetails(),
              () => waitForDaemonPlaybackSignal(firstPcmSignal, 'first_pcm'),
            );
            this.assertCurrentRun(token);
            await runPlaybackPerformanceStep(
              'AudioSession.playLocalFile',
              'audio started',
              playbackPerfDetails(),
              () => waitForDaemonPlaybackSignal(audioStartedSignal, 'audio_started'),
            );
            this.assertCurrentRun(token);
          }

          this.currentProbe = {
            filePath: probe.filePath,
            // AudioDaemon reports its decoded/output rate here. Preserve the
            // probe's source rate so status and bit-perfect diagnostics do not
            // mistake an output rate for the file's native rate.
            fileSampleRate: normalizeAudioSampleRate(backendProbe.sourceSampleRate) ?? probe.fileSampleRate,
            channels: backendProbe.channels ?? probe.channels,
            durationSeconds: backendProbe.durationSeconds ?? probe.durationSeconds,
            codec: backendProbe.codec ?? probe.codec,
            bitDepth: backendProbe.bitDepth ?? probe.bitDepth,
            bitrate: backendProbe.bitrate ?? probe.bitrate,
          };

          const daemonReady = daemonBackend.getOutputReady();
          if (daemonReady) {
            const actualDeviceSampleRate = normalizeAudioSampleRate(
              daemonReady.hardwareSampleRate ?? daemonReady.sampleRate,
            );
            this.currentReadyResult = {
              ok: true,
              device: daemonReady,
              requestedOutputSampleRate: daemonRequestedSampleRate,
              actualDeviceSampleRate,
            };
            this.currentPlan = applyNativeDspProcessingStatus(
              this.createSampleRatePlan(
                this.currentProbe,
                this.currentOutputSettings!,
                this.currentDevice,
                actualDeviceSampleRate,
              ),
              this.currentNativeProcessingStatus,
            );
            this.assertAsioSampleRateUsable();
            this.assertReadySampleRateConsistent();
            this.currentOutputDeviceType = typeof daemonReady.deviceType === 'string' ? daemonReady.deviceType : null;
            this.currentOutputDeviceName = typeof daemonReady.deviceName === 'string' ? daemonReady.deviceName : null;
          }
          this.currentActiveDsdOutputMode = nativePlan.sdmPcmToDsdActive
            ? 'dop'
            : nativePlan.dsdOutputMode !== 'pcm'
              ? nativePlan.dsdOutputMode
              : null;
          this.currentDsdNativeSampleRate = nativePlan.sdmNativeSampleRate ?? nativePlan.dsdNativeSampleRate;
          this.currentDsdTransportSampleRate = nativePlan.sdmTransportSampleRate ?? nativePlan.dsdTransportSampleRate;
          this.currentDecodeBackendImpl = 'native-direct-daemon-libav';
          this.currentOutputBackend = daemonReady?.backend ?? 'jsonrpc';
          this.currentOutputBackendImpl = daemonReady?.backendImpl ?? 'native-daemon-output';
          this.clock.reset(request.startSeconds ?? 0, backendProbe.sampleRate ?? probe.fileSampleRate ?? 48_000);
          this.state = 'playing';
          this.hostStatus = 'ready';
          this.resetWatchdogProgress();
          this.markNativeStartupStatusGuard();
          const automixPreparation = this.prepareDaemonAutomixV2(
            request,
            probe,
            daemonBackend,
            token,
            nativePlan,
          ).catch((error) => {
            if (this.runToken === token) {
              this.activeAutomixV2 = null;
              this.addOutputWarning(`automix_v2_background_prepare_failed:${
                error instanceof Error ? error.message.slice(0, 96) : 'unknown'
              }`);
              this.emitStatus();
            }
          }).finally(() => {
            if (this.automixPreparationTask === automixPreparation) {
              this.automixPreparationTask = null;
            }
          });
          this.automixPreparationTask = automixPreparation;
          this.recordPlaybackDiagnosticEvent('output_ready', 'info', 'native_direct_daemon_playback', {
            trackId: request.trackId ?? null,
            filePath: request.filePath,
            outputMode: daemonOutputMode,
            outputBackend: this.currentOutputBackend,
            outputBackendImpl: this.currentOutputBackendImpl,
            details: {
              codec: this.currentProbe.codec,
              sampleRate: backendProbe.sampleRate,
              channels: backendProbe.channels,
              startSeconds: request.startSeconds ?? 0,
            },
          });
          this.emitStatus();
          return this.getStatus();
        } catch (daemonError) {
          if (daemonError instanceof DaemonRemoteSampleRateCorrection) {
            throw daemonError;
          }
          await this.stopActiveDaemonBackend('native-direct-start-failed');
          try {
            // A failed daemon startup may leave an exclusive/ASIO device open
            // even after audio.stop. Reset the host before any later route can
            // attempt a different wire format.
            await this.stopAudioDaemonForPlayback();
          } catch (stopError) {
            this.logger(`[AudioSession] daemon reset after startup failure failed: ${
              stopError instanceof Error ? stopError.message : String(stopError)
            }`);
          }
          if (remoteDaemonPlayback) {
            const reason = classifyDaemonRemoteFallbackReason(daemonError);
            const warning = `daemon_remote_source_fell_back:${reason}`;
            this.addOutputWarning(warning);
            this.logger(`[AudioSession] ${warning}`);
          } else {
            const message = daemonError instanceof Error ? daemonError.message.slice(0, 96) : 'unknown';
            if (daemonGaplessEligible) {
              this.daemonGaplessActive = false;
              daemonGaplessFellBackToOrdinaryPlayback = true;
              this.addOutputWarning(`native_gapless_unavailable:daemon_start_failed:${message}`);
              this.logger(`[AudioSession] native gapless host unavailable; continuing ordinary playback: ${message}`);
            } else {
              this.addOutputWarning(`daemon_playback_failed_closed:${message}`);
              throw daemonError;
            }
          }
        }
      }
      if (
        !daemonGaplessFellBackToOrdinaryPlayback &&
        nativeDirectLocalPlaybackFallbackReason !== 'disabled' &&
        process.env.ECHO_FORCE_LEGACY_LOCAL_PLAYBACK !== '1'
      ) {
        this.addOutputWarning(`native_direct_local_playback_not_applied:${nativeDirectLocalPlaybackFallbackReason}`);
      }
      const legacyFallbackPlan = this.createSampleRatePlan(probe, this.currentOutputSettings!, this.currentDevice);
      const nativeDspBlockReason = getNativeDspLegacyFallbackBlockReason(legacyFallbackPlan, this.currentOutputSettings!);
      if (nativeDspBlockReason) {
        throw new Error(
          `native_dsp_${nativeDspBlockReason}_requires_daemon_local_playback:${nativeDirectLocalPlaybackFallbackReason}`,
        );
      }
      let { bridge, plan, ready, hostReused, hostRestartReason } = await runPlaybackPerformanceStep(
        'AudioSession.playLocalFile',
        'startOutputBridgeForProbe',
        playbackPerfDetails(),
        () => this.startOutputBridgeForProbe(
          probe,
          token,
          request.startSeconds ?? 0,
          { allowNativeDirectLocalPlaybackChannelMapping: false },
        ),
      );
      this.assertCurrentRun(token);
      this.applyReadyResult(ready);
      try {
        this.assertReadySampleRateConsistent();
      } catch (error) {
        const failedPlan = this.currentPlan as SampleRatePlan | null;
        if (failedPlan?.outputMode !== 'exclusive') {
          throw error;
        }

        if (!this.currentOutputSettings || !isSharedFallbackAllowedForExclusive(this.currentOutputSettings)) {
          this.addOutputWarning('exclusive_output_fallback_blocked');
          this.logger(
            `[AudioSession] exclusive sample-rate mismatch; automatic shared fallback is disabled: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          throw error;
        }

        const fallback = await runPlaybackPerformanceStep(
          'AudioSession.playLocalFile',
          'startOutputBridgeForProbe',
          playbackPerfDetails(),
          () => this.startSharedFallbackForProbe(
            probe,
            token,
            request.startSeconds ?? 0,
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
        bridge = fallback.bridge;
        plan = fallback.plan;
        ready = fallback.ready;
        hostReused = fallback.hostReused;
        hostRestartReason = fallback.hostRestartReason;
        this.assertCurrentRun(token);
        this.applyReadyResult(ready);
      }
      this.verboseLogger(
        `[AudioSession] host ready: requested=${ready.requestedOutputSampleRate} actual=${
          ready.actualDeviceSampleRate ?? 'n/a'
        }`,
      );
      let activePlan = this.currentPlan ?? plan;
      this.logAudioTransition(activePlan, {
        hostReused,
        hostRestartReason,
        previousOutputSettings,
        previousDevice,
        requestedOutputSettings,
        requestedDevice,
        recoveryReason: outputRestartContext?.recoveryReason ?? null,
        fallbackReason: outputRestartContext?.fallbackReason ?? null,
        preparedLocalProbeUsed: Boolean(preparedProbe),
        preparedLocalProbeAgeMs: preparedProbe?.ageMs ?? null,
      });
      if (this.exclusiveResumeAfterRelease && activePlan.outputMode === 'exclusive') {
        this.exclusiveResumeAfterRelease = false;
      }
      if (activePlan.dsdOutputMode === 'native') {
        try {
          const info = await readDsfDopInfo(request.filePath);
          const nativeDsdStream = createDsfNativeDsdStream(request.filePath, info, request.startSeconds ?? 0);
          this.currentDsdNativeSampleRate = info.nativeSampleRate;
          this.currentDsdTransportSampleRate = null;
          this.currentActiveDsdOutputMode = 'native';
          this.currentDecodeBackendImpl = 'dsf-bitstream-native-dsd';
          this.assertCurrentRun(token);
          const sessionId = bridge.beginSession?.({
            startSeconds: request.startSeconds ?? 0,
            playbackRate: 1,
            durationSeconds: probe.durationSeconds,
          });
          const writable = bridge.createSessionWritable?.(sessionId) ?? bridge.writable;
          if (!writable) {
            throw new Error('native output bridge did not expose a writable native DSD stream');
          }

          this.startBitstreamRun(nativeDsdStream, writable, token);
          this.state = 'playing';
          this.hostStatus = 'ready';
          this.resetWatchdogProgress();
          this.markNativeStartupStatusGuard();
          this.emitStatus();
          return this.getStatus();
        } catch (error) {
          if (this.runToken !== token) {
            throw new Error('audio_session_run_cancelled');
          }

          if (isAudioSessionRunCancelledError(error)) {
            throw error;
          }

          const nativeDsdError = error instanceof Error ? error : new Error(String(error));
          this.addOutputWarning(`asio_native_dsd_fell_back_to_dop:${nativeDsdError.message.slice(0, 96)}`);
          await this.stopResourcesGracefully('asio-native-dsd-fallback-to-dop');
          this.asioNativeDsdDisabledForCurrentPlayback = true;
          this.currentOutputSettings = {
            ...this.currentOutputSettings,
          };
          this.currentActiveDsdOutputMode = null;
          this.currentDsdNativeSampleRate = null;
          this.currentDsdTransportSampleRate = null;
          ({ bridge, plan, ready, hostReused, hostRestartReason } = await runPlaybackPerformanceStep(
            'AudioSession.playLocalFile',
            'startOutputBridgeForProbe',
            playbackPerfDetails(),
            () => this.startOutputBridgeForProbe(
              probe,
              token,
              request.startSeconds ?? 0,
              { allowNativeDirectLocalPlaybackChannelMapping: false },
            ),
          ));
          this.assertCurrentRun(token);
          this.applyReadyResult(ready);
          activePlan = this.currentPlan ?? plan;
        }
      }
      if (activePlan.dsdOutputMode === 'dop') {
        try {
          const info = await readDsfDopInfo(request.filePath);
          const dopStream = createDsfDopStream(request.filePath, info, request.startSeconds ?? 0);
          this.currentDsdNativeSampleRate = info.nativeSampleRate;
          this.currentDsdTransportSampleRate = info.transportSampleRate;
          this.currentActiveDsdOutputMode = 'dop';
          this.currentDecodeBackendImpl = 'dsf-bitstream-dop';
          this.assertCurrentRun(token);
          const sessionId = bridge.beginSession?.({
            startSeconds: request.startSeconds ?? 0,
            playbackRate: 1,
            durationSeconds: probe.durationSeconds,
          });
          const writable = bridge.createSessionWritable?.(sessionId) ?? bridge.writable;
          if (!writable) {
            throw new Error('native output bridge did not expose a writable DoP stream');
          }

          this.startBitstreamRun(dopStream, writable, token);
          this.state = 'playing';
          this.hostStatus = 'ready';
          this.resetWatchdogProgress();
          this.markNativeStartupStatusGuard();
          this.emitStatus();
          return this.getStatus();
        } catch (error) {
          if (this.runToken !== token) {
            throw new Error('audio_session_run_cancelled');
          }

          if (isAudioSessionRunCancelledError(error)) {
            throw error;
          }

          const dopError = error instanceof Error ? error : new Error(String(error));
          this.addOutputWarning(`dsd_dop_fell_back_to_pcm:${dopError.message.slice(0, 96)}`);
          await this.stopResourcesGracefully('dsd-dop-fallback-to-pcm');
          this.currentOutputSettings = {
            ...this.currentOutputSettings,
            dsdOutputMode: 'pcm',
          };
          this.currentActiveDsdOutputMode = null;
          this.currentDsdNativeSampleRate = null;
          this.currentDsdTransportSampleRate = null;
          ({ bridge, plan, ready, hostReused, hostRestartReason } = await runPlaybackPerformanceStep(
            'AudioSession.playLocalFile',
            'startOutputBridgeForProbe',
            playbackPerfDetails(),
            () => this.startOutputBridgeForProbe(
              probe,
              token,
              request.startSeconds ?? 0,
              { allowNativeDirectLocalPlaybackChannelMapping: false },
            ),
          ));
          this.assertCurrentRun(token);
          this.applyReadyResult(ready);
        }
      }
      const pcmPlan = this.currentPlan ?? plan;
      const nativeAutomix = await runPlaybackPerformanceStep(
        'AudioSession.playLocalFile',
        'createDecoderRunForPlayback',
        playbackPerfDetails(),
        () => this.createNativeAutomixPlayback(
          legacyPlaybackRequest,
          probe,
          pcmPlan,
          this.currentOutputSettings!,
          bridge,
        ),
      );
      // Prefer the single FFmpeg concat path; native dual-deck gapless stays as a decoder-compat fallback.
      const shouldUseNativeGaplessFallback = !nativeAutomix && !this.decoder.decodeGaplessSequence;
      const nativeGapless = shouldUseNativeGaplessFallback
        ? await runPlaybackPerformanceStep(
            'AudioSession.playLocalFile',
            'createDecoderRunForPlayback',
            playbackPerfDetails(),
            () => this.createNativeGaplessPlayback(
              legacyPlaybackRequest,
              probe,
              pcmPlan,
              this.currentOutputSettings!,
              bridge,
            ),
          )
        : null;
      const automixRun = nativeAutomix
        ? null
        : nativeGapless
          ? null
          : await runPlaybackPerformanceStep(
              'AudioSession.playLocalFile',
              'createDecoderRunForPlayback',
              playbackPerfDetails(),
              () => this.createAutomixDecoderRunForPlayback(legacyPlaybackRequest, probe, pcmPlan, this.currentOutputSettings!),
            );
      const gaplessRun = nativeAutomix || nativeGapless || automixRun
        ? null
        : await runPlaybackPerformanceStep(
            'AudioSession.playLocalFile',
            'createDecoderRunForPlayback',
            playbackPerfDetails(),
            () => this.createGaplessDecoderRunForPlayback(legacyPlaybackRequest, probe, pcmPlan, this.currentOutputSettings!),
          );
      const activeChainedState = nativeAutomix?.state ?? nativeGapless?.state ?? automixRun?.state ?? gaplessRun?.state ?? null;
      const playbackRun = automixRun
        ? automixRun.run
        : gaplessRun
          ? gaplessRun.run
          : await runPlaybackPerformanceStep(
            'AudioSession.playLocalFile',
            'createDecoderRunForPlayback',
            playbackPerfDetails(),
              () => this.createDecoderRunForPlayback(
                request.filePath,
                request.inputHeaders,
                request.startSeconds ?? 0,
                probe,
                pcmPlan,
                this.currentOutputSettings!,
              ),
            );
      this.activeAutomix = activeChainedState;

      await this.syncEqStateForPlayback(bridge);
      this.assertCurrentRun(token);
      const bridgeStartSeconds = activeChainedState?.compositeStartSeconds ?? request.startSeconds ?? 0;
      const bridgeDurationSeconds = activeChainedState
        ? activeChainedState.compositeStartSeconds + activeChainedState.compositeDurationSeconds
        : probe.durationSeconds;
      markPlaybackBreadcrumb('AudioSession.playLocalFile:bridge.beginSession:start', playbackPerfDetails());
      const sessionId = bridge.beginSession?.({
        startSeconds: bridgeStartSeconds,
        playbackRate: this.currentOutputSettings!.playbackRate,
        durationSeconds: bridgeDurationSeconds,
      });
      markPlaybackBreadcrumb('AudioSession.playLocalFile:bridge.beginSession:complete', playbackPerfDetails());
      markPlaybackBreadcrumb('AudioSession.playLocalFile:bridge.createSessionWritable:start', playbackPerfDetails());
      const writable = bridge.createSessionWritable?.(sessionId) ?? bridge.writable;
      markPlaybackBreadcrumb('AudioSession.playLocalFile:bridge.createSessionWritable:complete', playbackPerfDetails());
      if (!writable) {
        throw new Error('native output bridge did not expose a writable PCM stream');
      }

      if ((nativeAutomix || nativeGapless) && bridge.createAutomixNextWritable?.() && bridge.prepareAutomixPlan) {
        const nextWritable = bridge.createAutomixNextWritable!();
        const nativeChainedState = (nativeAutomix ?? nativeGapless)!.state;
        const transition = nativeChainedState.transitions[0];
        bridge.prepareAutomixPlan(nativeChainedState.plan, {
          fadeStartSeconds: Math.max(0, transition?.transitionStartSeconds ?? nativeChainedState.transitionStartSeconds),
          sampleRate: pcmPlan.actualDeviceSampleRate ?? pcmPlan.requestedOutputSampleRate,
        });
        this.startNativeAutomixRuns(
          (nativeAutomix ?? nativeGapless)!.currentRun,
          (nativeAutomix ?? nativeGapless)!.nextRun,
          writable,
          nextWritable,
          token,
          nativeGapless ? 'native-gapless-dual-deck' : 'native-automix-dual-deck',
        );
      } else if (playbackRun) {
        if (nativeAutomix || nativeGapless) {
          this.logger('[Automix] native output bridge missing Automix deck, falling back to simple playback');
        }
        runPlaybackPerformanceStepSync('AudioSession.playLocalFile', 'startDecoderRun', playbackPerfDetails(), () => {
          this.startDecoderRun(playbackRun, writable, token);
        });
        if (isHttpPlaybackUrl(request.filePath)) {
          await this.waitForDecoderReadyBeforePlaying(playbackRun, token, {
            positionSeconds: activeChainedState?.compositeStartSeconds ?? request.startSeconds ?? 0,
            playbackRate: this.currentOutputSettings.playbackRate ?? 1,
            sampleRate: pcmPlan.actualDeviceSampleRate ?? pcmPlan.requestedOutputSampleRate,
          });
        }
      }

      this.state = 'playing';
      this.hostStatus = 'ready';
      this.resetWatchdogProgress();
      this.markNativeStartupStatusGuard();
      this.emitStatus();
      if (request.automixAnalyze === true) {
        const analysisHint = createAutomixAnalysisHint(playbackProbeHint);
        void this.automixAnalyzer.analyze({
          filePath: request.filePath,
          probe,
          headers: request.inputHeaders,
          hint: analysisHint,
        }).catch((error) => {
          this.logger(`[AudioSession] Automix playback analysis skipped: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      return this.getStatus();
    } catch (error) {
      if (error instanceof DaemonRemoteSampleRateCorrection) {
        return this.playLocalFile({
          ...request,
          probe: mergeProbeHints(
            { fileSampleRate: error.sourceSampleRate },
            request.probe,
          ),
          remoteSampleRateCorrectionAttempt: true,
        });
      }
      if (this.runToken === token) {
        this.handleError(error instanceof Error ? error : new Error(String(error)));
      }

      throw error;
    }
  }

  async playPcmStream(request: AudioSessionPlayPcmStreamRequest): Promise<AudioStatus> {
    const token = this.runToken + 1;
    this.runToken = token;
    this.pendingOutputAdaptiveProfile = null;
    this.currentOutputAdaptiveProfile = null;
    const decoderStop = this.stopDecoderRun();
    if (decoderStop) {
      await decoderStop;
    }
    this.logger(
      `[AudioSession] playPcmStream: source="${redactUrlSecrets(request.sourceId)}" trackId=${request.trackId ?? 'n/a'} sampleRate=${
        request.sampleRate
      } channels=${request.channels}`,
    );

    this.state = 'loading';
    this.hostStatus = 'starting';
    this.errorMessage = null;
    this.outputWarnings = [
      ...(this.watchdogPendingWarning ? [this.watchdogPendingWarning] : []),
      ...this.pendingOutputWarnings,
    ];
    this.exclusiveReleasedOnPause = false;
    this.watchdogPendingWarning = null;
    this.pendingOutputWarnings = [];
    this.resetWatchdogProgress();
    this.resetLevelMeter();
    this.resetNativeTelemetry();
    this.currentFilePath = request.sourceId;
    this.currentInputHeaders = null;
    this.currentTrackId = request.trackId ?? null;
    this.currentTrackMetadata = request.metadata ?? null;
    this.pausedPositionSeconds = null;
    this.currentProbe = null;
    this.currentPlan = null;
    this.currentNativeProcessingStatus = null;
    this.currentResidentOutputSampleRate = null;
    this.currentOutputBackend = null;
    this.currentOutputBackendImpl = null;
    this.currentOutputDeviceType = null;
    this.currentOutputDeviceName = null;
    this.currentResamplerEngine = 'default';
    this.currentResamplerFallbackActive = false;
    this.currentDecodeBackendImpl = request.decoderBackendImpl ?? 'airplay-raop-pcm';
    this.currentOutputSettings = this.createOutputSettingsForRequest(request.output);
    this.currentUseMiniaudioOutputRequested = this.currentOutputSettings.useMiniaudioOutput === true;
    this.currentDsdOutputModeRequested = 'pcm';
    this.currentActiveDsdOutputMode = null;
    this.currentDsdNativeSampleRate = null;
    this.currentDsdTransportSampleRate = null;
    this.currentDevice = normalizeOutputMode(this.currentOutputSettings.outputMode) === 'exclusive' ||
      normalizeOutputMode(this.currentOutputSettings.outputMode) === 'asio'
      ? await this.resolvePlaybackDeviceForSettings(this.currentOutputSettings)
      : this.resolvePlanDeviceForSettings(this.currentOutputSettings);
    this.resetSharedStabilityForFreshPlayback(this.currentOutputSettings.outputMode ?? 'shared', this.currentOutputSettings, this.currentDevice);
    this.emitStatus();

    try {
      const sampleRate = Math.max(8_000, Math.round(request.sampleRate));
      const channels = Math.max(1, Math.min(8, Math.round(request.channels)));
      const probe: AudioProbeResult = {
        filePath: request.sourceId,
        durationSeconds: Math.max(0, request.durationSeconds ?? 0),
        fileSampleRate: sampleRate,
        channels,
        codec: 'pcm-f32le',
        bitDepth: 32,
        bitrate: sampleRate * channels * 32,
      };
      this.currentProbe = probe;
      let { bridge, plan, ready, hostReused, hostRestartReason } = await this.startOutputBridgeForProbe(probe, token, 0);
      this.assertCurrentRun(token);
      this.applyReadyResult(ready);
      try {
        this.assertReadySampleRateConsistent();
      } catch (error) {
        const failedPlan = this.currentPlan as SampleRatePlan | null;
        if (failedPlan?.outputMode !== 'exclusive') {
          throw error;
        }

        if (!this.currentOutputSettings || !isSharedFallbackAllowedForExclusive(this.currentOutputSettings)) {
          this.addOutputWarning('exclusive_output_fallback_blocked');
          this.logger(
            `[AudioSession] exclusive sample-rate mismatch; automatic shared fallback is disabled: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          throw error;
        }

        const fallback = await this.startSharedFallbackForProbe(
          probe,
          token,
          0,
          error instanceof Error ? error : new Error(String(error)),
        );
        bridge = fallback.bridge;
        plan = fallback.plan;
        ready = fallback.ready;
        hostReused = fallback.hostReused;
        hostRestartReason = fallback.hostRestartReason;
        this.assertCurrentRun(token);
        this.applyReadyResult(ready);
      }

      const activePlan = this.currentPlan ?? plan;
      this.logAudioTransition(activePlan, {
        hostReused,
        hostRestartReason,
        preparedLocalProbeUsed: false,
        preparedLocalProbeAgeMs: null,
      });
      await this.syncEqStateForPlayback(bridge);
      this.assertCurrentRun(token);
      const sessionId = bridge.beginSession?.({
        startSeconds: 0,
        playbackRate: this.currentOutputSettings.playbackRate,
        durationSeconds: probe.durationSeconds,
      });
      const writable = bridge.createSessionWritable?.(sessionId) ?? bridge.writable;
      if (!writable) {
        throw new Error('native output bridge did not expose a writable PCM stream');
      }

      const runDone = new Promise<void>((resolve, reject) => {
        request.stream.once('end', resolve);
        request.stream.once('close', resolve);
        request.stream.once('error', reject);
      });
      const run: DecoderRun = {
        stream: request.stream,
        stop: () => request.stream.destroy(),
        done: runDone,
        decoderBackendImpl: 'airplay-raop-pcm',
        resamplerEngine: 'default',
        resamplerFallbackActive: false,
      };
      this.currentDecodeBackendImpl = 'airplay-raop-pcm';
      this.startDecoderRun(run, writable, token);

      this.state = 'playing';
      this.hostStatus = 'ready';
      this.resetWatchdogProgress();
      this.markNativeStartupStatusGuard();
      this.emitStatus();
      return this.getStatus();
    } catch (error) {
      request.stream.destroy();
      if (this.runToken === token) {
        this.handleError(error instanceof Error ? error : new Error(String(error)));
      }

      throw error;
    }
  }

  restorePlaybackMemory(memory: PlaybackMemory): AudioStatus {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      return this.getStatus();
    }

    const positionSeconds = Math.max(0, Number(memory.positionSeconds) || 0);
    this.runToken += 1;
    this.stopResources();
    this.resetLevelMeter();
    this.state = 'paused';
    this.hostStatus = this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';
    this.errorMessage = null;
    this.outputWarnings = [];
    this.currentFilePath = memory.filePath;
    this.currentInputHeaders = null;
    this.currentTrackId = memory.trackId;
    this.currentTrackMetadata = memory.metadata ?? null;
    this.currentOutputSettings = { ...this.outputSettings };
    this.currentDevice = createDeviceFromOutputSettings(this.currentOutputSettings);
    this.currentResamplerEngine = 'default';
    this.currentResamplerFallbackActive = false;
    this.currentProbe = createProbeFromHint(memory.filePath, {
      durationSeconds: memory.probe?.durationSeconds ?? memory.durationSeconds,
      fileSampleRate: memory.probe?.fileSampleRate,
      channels: memory.probe?.channels,
      codec: memory.probe?.codec,
      bitDepth: memory.probe?.bitDepth,
      bitrate: memory.probe?.bitrate,
    });
    this.currentPlan = null;
    this.currentResidentOutputSampleRate = null;
    this.currentOutputBackend = null;
    this.currentOutputBackendImpl = null;
    this.currentOutputDeviceType = null;
    this.currentOutputDeviceName = null;
    this.currentUseMiniaudioOutputRequested = this.outputSettings.useMiniaudioOutput === true;
    this.currentDsdOutputModeRequested = normalizeDsdOutputMode(this.outputSettings.dsdOutputMode);
    this.currentActiveDsdOutputMode = null;
    this.currentDsdNativeSampleRate = null;
    this.currentDsdTransportSampleRate = null;
    this.currentDecodeBackendImpl = null;
    this.pausedPositionSeconds = positionSeconds;
    this.clock.reset(positionSeconds, null);
    this.emitStatus();
    return this.getStatus();
  }

  async play(): Promise<AudioStatus> {
    await this.waitForExclusiveReleaseOnPause('play');

    // A shared-output paused seek may still be tearing down the old host and
    // preparing the new target. Do not snapshot pausedPositionSeconds until
    // that transaction has committed; otherwise resume can reopen the stale
    // position while the newer seek is still awaiting cleanup.
    const pausedSeekTransaction = this.pausedSeekTransaction;
    if (pausedSeekTransaction) {
      await pausedSeekTransaction;
    }

    if (this.state === 'paused' && this.currentFilePath && this.currentOutputSettings) {
      if (this.activeDaemonBackend) {
        try {
          await this.activeDaemonBackend.resume();
          const positionSeconds = this.activeDaemonBackend.getPositionSeconds();
          this.pausedPositionSeconds = null;
          this.clock.reset(positionSeconds, this.currentProbe?.fileSampleRate ?? null);
          this.state = 'playing';
          this.hostStatus = 'ready';
          this.resetWatchdogProgress();
          this.emitStatus();
          return this.getStatus();
        } catch (error) {
          this.handleError(error instanceof Error ? error : new Error(String(error)));
          return this.getStatus();
        }
      }

      if (this.hostStatus === 'starting' && this.pausedOutputPrewarmPromise) {
        await this.waitBrieflyForPausedOutputPrewarm();
        if (this.state !== 'paused' || !this.currentFilePath || !this.currentOutputSettings) {
          return this.getStatus();
        }
      }

      if (this.isCurrentLivePcmStream()) {
        this.addOutputWarning('live_pcm_resume_skipped');
        this.logger(
          `[AudioSession] play requested for live PCM stream; waiting for sender to resume source="${redactUrlSecrets(
            this.currentFilePath,
          )}"`,
        );
        this.emitStatus();
        return this.getStatus();
      }

      const bridge = this.bridge;
      const currentProbe = this.currentProbe;
      const currentPlan = this.currentPlan;
      const canResumePreparedBridge =
        bridge &&
        isWritableUsable(bridge.writable) &&
        currentProbe &&
        currentPlan &&
        this.currentReadyResult &&
        this.hostStatus === 'ready';

      const canResumeNativeDirectPausedBridge =
        bridge &&
        typeof bridge.beginSession === 'function' &&
        isNativeDirectLocalPlaybackBackend(this.currentDecodeBackendImpl) &&
        currentProbe &&
        currentPlan &&
        this.currentReadyResult &&
        this.hostStatus === 'ready';

      if (canResumeNativeDirectPausedBridge && bridge && currentProbe && currentPlan) {
        this.runToken += 1;
        const token = this.runToken;
        const startSeconds = this.pausedPositionSeconds ?? this.clock.getPositionSeconds();
        const fadeInTargetVolume = this.getTransportFadeTargetVolume();
        const fadeInSettings = this.getTransportFadeSettings('in');
        const shouldFadeIn = this.prepareNativeTransportFadeIn(bridge, fadeInTargetVolume, fadeInSettings);
        this.pausedPositionSeconds = null;
        this.attachBridgeEvents(bridge, token);
        const replayGainCalculation = this.calculateCurrentReplayGain();
        const nativeDirectPlaybackRate = normalizePlaybackRate(this.currentOutputSettings.playbackRate);
        const sessionId = bridge.beginSession?.({
          startSeconds,
          playbackRate: nativeDirectPlaybackRate,
          durationSeconds: currentProbe.durationSeconds,
          directFilePath: this.currentFilePath,
          directStartSeconds: startSeconds,
          directSampleRate: currentPlan.decoderOutputSampleRate,
          directChannels: currentProbe.channels,
          directOutputChannels: currentPlan.outputChannels,
          directPlaybackRate: nativeDirectPlaybackRate,
          directGain: this.replayGainLinearGain(replayGainCalculation),
        });
        if (!sessionId) {
          throw new Error('native output bridge did not expose a direct PCM playback session');
        }
        if (isResidentOutputMode(currentPlan.outputMode)) {
          await bridge.setPaused?.(false);
          this.assertCurrentRun(token);
        }
        bridge.resetOutputClock?.(startSeconds, nativeDirectPlaybackRate);
        this.clock.reset(startSeconds, currentPlan.actualDeviceSampleRate ?? currentPlan.requestedOutputSampleRate);
        this.state = 'playing';
        this.hostStatus = 'ready';
        this.nativeUnderrunWindow = null;
        this.resetWatchdogProgress();
        this.markNativeStartupStatusGuard();
        this.emitStatus();
        if (shouldFadeIn) {
          await this.fadeNativeTransportVolume(bridge, 0, fadeInTargetVolume, token, fadeInSettings);
        }
        return this.getStatus();
      }

      if (canResumePreparedBridge && bridge && currentProbe && currentPlan) {
        this.runToken += 1;
        const token = this.runToken;
        const startSeconds = this.pausedPositionSeconds ?? this.clock.getPositionSeconds();
        const fadeInTargetVolume = this.getTransportFadeTargetVolume();
        const fadeInSettings = this.getTransportFadeSettings('in');
        const shouldFadeIn = this.prepareNativeTransportFadeIn(bridge, fadeInTargetVolume, fadeInSettings);
        this.pausedPositionSeconds = null;
        this.attachBridgeEvents(bridge, token);
        const prewarmedRun = this.consumePausedDecoderPrewarm(this.currentFilePath, startSeconds);
        const timelineStartSeconds = prewarmedRun?.timelineStartSeconds ?? startSeconds;
        const sessionId = bridge.beginSession?.({
          startSeconds: timelineStartSeconds,
          playbackRate: this.currentOutputSettings.playbackRate ?? 1,
          durationSeconds: currentProbe.durationSeconds,
          startPaused: isResidentOutputMode(currentPlan.outputMode),
        });
        bridge.resetOutputClock?.(timelineStartSeconds, this.currentOutputSettings.playbackRate ?? 1);
        this.clock.reset(timelineStartSeconds, currentPlan.actualDeviceSampleRate ?? currentPlan.requestedOutputSampleRate);

        const run = prewarmedRun?.run ?? await this.createDecoderRunForPlayback(
          this.currentFilePath,
          this.currentInputHeaders,
          startSeconds,
          currentProbe,
          currentPlan,
          this.currentOutputSettings,
        );
        const writable = bridge.createSessionWritable?.(sessionId) ?? bridge.writable;
        if (!writable) {
          throw new Error('native output bridge did not expose a writable PCM stream');
        }
        this.startDecoderRun(run, writable, token);
        // Keep the resident device callback paused until the replacement
        // decoder is attached to the new session. Resuming first advances the
        // native output clock through silent underrun frames and later forces
        // the UI position to roll back when real PCM arrives.
        if (isResidentOutputMode(currentPlan.outputMode)) {
          await bridge.setPaused?.(false);
          this.assertCurrentRun(token);
        }
        if (isHttpPlaybackUrl(this.currentFilePath)) {
          this.pausedPositionSeconds = timelineStartSeconds;
          this.state = 'loading';
          this.hostStatus = 'ready';
          this.emitStatus();
          try {
            await this.waitForDecoderReadyBeforePlaying(run, token, {
              positionSeconds: timelineStartSeconds,
              playbackRate: this.currentOutputSettings.playbackRate ?? 1,
              sampleRate: currentPlan.actualDeviceSampleRate ?? currentPlan.requestedOutputSampleRate,
            });
          } catch (error) {
            if (isAudioSessionRunCancelledError(error)) {
              return this.getStatus();
            }

            throw error;
          }
          this.pausedPositionSeconds = null;
        }
        this.state = 'playing';
        this.hostStatus = this.hostStatus === 'starting' ? 'starting' : 'ready';
        this.nativeUnderrunWindow = null;
        this.resetWatchdogProgress();
        this.markNativeStartupStatusGuard();
        this.emitStatus();
        if (shouldFadeIn) {
          await this.fadeNativeTransportVolume(bridge, 0, fadeInTargetVolume, token, fadeInSettings);
        }
        return this.getStatus();
      }

      this.exclusiveResumeAfterRelease = this.exclusiveReleasedOnPause;
      this.exclusiveReleasedOnPause = false;
      return this.playLocalFile({
        filePath: this.currentFilePath,
        trackId: this.currentTrackId ?? undefined,
        metadata: this.currentTrackMetadata ?? undefined,
        startSeconds: this.pausedPositionSeconds ?? this.clock.getPositionSeconds(),
        output: this.currentOutputSettings,
        probe: this.currentProbe ? createProbeHint(this.currentProbe) : undefined,
        inputHeaders: this.currentInputHeaders ?? undefined,
      });
    }

    return this.getStatus();
  }

  private shouldReleaseExclusiveOnPause(): boolean {
    return Boolean(
      this.state === 'playing' &&
      this.currentOutputSettings?.releaseExclusiveOnPauseExperimentalEnabled === true &&
      normalizeOutputMode(this.currentPlan?.outputMode ?? this.currentOutputSettings.outputMode) === 'exclusive' &&
      this.bridge &&
      this.currentReadyResult,
    );
  }

  private async waitForExclusiveReleaseOnPause(reason: string): Promise<void> {
    const release = this.exclusiveReleaseOnPausePromise;
    if (!release) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        release,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, releaseExclusiveOnPausePlayWaitTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }

    if (this.exclusiveReleaseOnPausePromise) {
      this.addOutputWarning('exclusive_release_on_pause_still_finishing');
      this.logger(`[AudioSession] continuing ${reason} while exclusive pause release finishes in background`);
    }
  }

  private getTransportFadeTargetVolume(): number {
    const volume = this.currentOutputSettings?.volume ?? this.outputSettings.volume;
    return Math.max(0, Math.min(1, Number(volume) || 0));
  }

  private cancelTransportFade(): void {
    this.transportFadeGeneration += 1;
  }

  private getTransportFadeSettings(direction: TransportFadeDirection): TransportFadeSettings {
    try {
      const settings = getAppSettings();
      const configuredDurationMs = direction === 'in'
        ? settings.audioTransportFadeInMs
        : settings.audioTransportFadeOutMs;
      const durationMs = this.transportFadeDurationOverrideMs
        ?? normalizeTransportFadeDurationMs(configuredDurationMs);

      return {
        enabled: settings.audioTransportFadeEnabled === true && durationMs > 0,
        durationMs,
        stepMs: this.transportFadeStepMs,
        curve: normalizeTransportFadeCurve(settings.audioTransportFadeCurve),
      };
    } catch {
      const durationMs = this.transportFadeDurationOverrideMs ?? defaultTransportFadeDurationMs;
      return {
        enabled: false,
        durationMs,
        stepMs: this.transportFadeStepMs,
        curve: defaultTransportFadeCurve,
      };
    }
  }

  private async fadeNativeTransportVolume(
    bridge: OutputBridgeLike | null,
    fromVolume: number,
    toVolume: number,
    runToken: number,
    settings: TransportFadeSettings,
  ): Promise<boolean> {
    if (!bridge?.setVolume || !settings.enabled || settings.durationMs <= 0) {
      return true;
    }

    const generation = this.transportFadeGeneration + 1;
    this.transportFadeGeneration = generation;
    const startVolume = Math.max(0, Math.min(1, Number(fromVolume) || 0));
    const endVolume = Math.max(0, Math.min(1, Number(toVolume) || 0));
    const stepMs = Math.max(1, settings.stepMs);
    const steps = Math.max(1, Math.ceil(settings.durationMs / stepMs));

    for (let step = 0; step <= steps; step += 1) {
      if (generation !== this.transportFadeGeneration || this.runToken !== runToken || this.bridge !== bridge) {
        return false;
      }

      const progress = applyTransportFadeCurve(step / steps, settings.curve);
      bridge.setVolume(startVolume + ((endVolume - startVolume) * progress));

      if (step < steps) {
        await this.transportFadeWait(stepMs);
      }
    }

    return true;
  }

  private prepareNativeTransportFadeIn(
    bridge: OutputBridgeLike | null,
    targetVolume: number,
    settings: TransportFadeSettings,
  ): boolean {
    if (!bridge?.setVolume) {
      return false;
    }

    if (!settings.enabled || settings.durationMs <= 0 || targetVolume <= 0) {
      bridge.setVolume(targetVolume);
      return false;
    }

    this.cancelTransportFade();
    bridge.setVolume(0);
    return true;
  }

  private async releaseExclusiveOutputOnPause(
    bridge: OutputBridgeLike,
    token: number,
    positionSeconds: number,
    sampleRate: number | null,
  ): Promise<void> {
    const decoderStop = this.stopDecoderRun();
    if (decoderStop) {
      await decoderStop;
    }
    try {
      bridge.endSession?.();
    } catch {
      // Best-effort idle transition before releasing exclusive WASAPI.
    }

    this.detachBridgeEvents(bridge);
    this.pausedPositionSeconds = positionSeconds;
    this.clock.reset(positionSeconds, sampleRate);
    this.state = 'paused';
    this.hostStatus = 'starting';
    this.nativeUnderrunWindow = null;
    this.resetWatchdogProgress();
    this.exclusiveReleasedOnPause = true;
    this.addOutputWarning('exclusive_released_on_pause');
    this.emitStatus();

    const release = this.releaseExclusiveBridgeOnPause(bridge, token);
    this.exclusiveReleaseOnPausePromise = release;
    try {
      await release;
    } finally {
      if (this.exclusiveReleaseOnPausePromise === release) {
        this.exclusiveReleaseOnPausePromise = null;
      }
    }
  }

  private async releaseExclusiveBridgeOnPause(bridge: OutputBridgeLike, token: number): Promise<void> {
    const reason = 'release-exclusive-on-pause';
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    try {
      await Promise.race([
        this.stopBridgeWithOptions(bridge, reason, releaseExclusiveOnPauseGracefulStopTimeoutMs, true),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(new Error('release_exclusive_on_pause_timeout'));
          }, releaseExclusiveOnPauseGracefulStopTimeoutMs + 250);
        }),
      ]);
    } catch (error) {
      if (timedOut) {
        this.addOutputWarning('exclusive_release_on_pause_forced_stop');
      } else {
        this.addOutputWarning('exclusive_release_on_pause_failed');
      }
      this.logger(`[AudioSession] exclusive release on pause cleanup failed: ${
        error instanceof Error ? error.message : String(error)
      }`);
      try {
        bridge.stop();
      } catch {
        // The host may have already exited or be force-killed by stopGracefully.
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (this.bridge === bridge && this.runToken === token) {
        this.bridge = null;
        this.currentReadyResult = null;
        this.currentBridgeOutputMode = null;
        this.currentBridgeSharedBackend = null;
        this.currentResidentOutputSampleRate = null;
        this.hostStatus = this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';
        this.emitStatus();
      }
    }
  }

  async pause(): Promise<AudioStatus> {
    if (this.activeDaemonBackend && (this.state === 'playing' || this.state === 'loading')) {
      try {
        const pos = this.activeDaemonBackend.getPositionSeconds();
        await this.activeDaemonBackend.pause();
        this.pausedPositionSeconds = pos;
        this.clock.reset(pos, this.currentProbe?.fileSampleRate ?? null);
        this.state = 'paused';
        this.hostStatus = 'ready';
        this.resetWatchdogProgress();
        this.emitStatus();
        return this.getStatus();
      } catch (error) {
        this.handleError(error instanceof Error ? error : new Error(String(error)));
        return this.getStatus();
      }
    }
    if (this.state === 'playing' || this.state === 'loading') {
      if (this.state === 'playing') {
        this.updatePositionFromOutput();
      }
      let positionSeconds = this.state === 'playing' ? this.clock.getPositionSeconds() : this.pausedPositionSeconds ?? 0;
      const sampleRate = this.currentPlan?.actualDeviceSampleRate ?? this.currentPlan?.requestedOutputSampleRate ?? null;
      const shouldReleaseExclusiveOnPause = this.shouldReleaseExclusiveOnPause();
      this.recordPlaybackDiagnosticEvent('pause_request', 'info', 'pause', {
        positionSeconds,
        details: {
          releaseExclusiveOnPause: shouldReleaseExclusiveOnPause,
        },
      });
      try {
        const fadeOutSettings = this.getTransportFadeSettings('out');
        if (this.state === 'playing' && this.bridge?.setVolume && fadeOutSettings.enabled) {
          const fadeBridge = this.bridge;
          const fadeToken = this.runToken;
          await this.fadeNativeTransportVolume(fadeBridge, this.getTransportFadeTargetVolume(), 0, fadeToken, fadeOutSettings);
          if (this.runToken !== fadeToken || this.bridge !== fadeBridge || this.state !== 'playing') {
            return this.getStatus();
          }
          this.updatePositionFromOutput();
          positionSeconds = this.clock.getPositionSeconds();
        }

        const keepResidentBridge = Boolean(
          this.state === 'playing' &&
          !shouldReleaseExclusiveOnPause &&
          isResidentOutputMode(this.currentPlan?.outputMode ?? this.currentOutputSettings?.outputMode) &&
          this.bridge &&
          this.currentReadyResult,
        );
        const canHoldPausedDecoder = this.canHoldCurrentDecoderForPausedResume();
        this.runToken += 1;
        this.activeAutomix = null;
        this.activeAutomixV2 = null;
        const token = this.runToken;
        if (shouldReleaseExclusiveOnPause && this.bridge) {
          await this.releaseExclusiveOutputOnPause(this.bridge, token, positionSeconds, sampleRate);
          return this.getStatus();
        }
        const heldPausedDecoder = canHoldPausedDecoder
          ? this.holdCurrentDecoderForPausedResume(token, positionSeconds)
          : false;
        if (keepResidentBridge) {
          // Pause the callback immediately, then abort (rather than drain) the
          // current session so resume is never queued behind audio.inputEnd.
          await this.bridge?.setPaused?.(true);
          this.assertCurrentRun(token);
          const decoderStop = heldPausedDecoder ? null : this.stopDecoderRun();
          await this.bridge?.abortSession?.();
          this.assertCurrentRun(token);
          if (decoderStop) {
            void decoderStop.catch((stopError) => {
              this.logger(`[AudioSession] paused decoder cleanup finished with error: ${
                stopError instanceof Error ? stopError.message : String(stopError)
              }`);
            });
          }
        } else {
          this.stopResources({ preservePausedDecoderPrewarm: heldPausedDecoder });
        }
        this.pausedPositionSeconds = positionSeconds;
        this.clock.reset(positionSeconds, sampleRate);
        this.state = 'paused';
        this.nativeUnderrunWindow = null;
        this.resetWatchdogProgress();
        const canPrewarm = !keepResidentBridge && Boolean(this.currentProbe && this.currentOutputSettings && this.isNativeHostAvailable());
        this.hostStatus = canPrewarm ? 'starting' : this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';
        if (keepResidentBridge) {
          this.hostStatus = 'ready';
        }
        this.emitStatus();
        if (canPrewarm) {
          this.startPausedOutputPrewarm(token, positionSeconds);
        } else if (keepResidentBridge && this.currentProbe && this.currentPlan && this.currentOutputSettings) {
          void this.preparePausedDecoderRun(token, positionSeconds, this.currentProbe, this.currentPlan, this.currentOutputSettings);
        }
      } catch (error) {
        this.addOutputWarning('pause_cleanup_failed');
        this.logger(`[AudioSession] pause cleanup failed; forcing paused state: ${error instanceof Error ? error.message : String(error)}`);
        try {
          this.stopResources();
        } catch {
          // Pause must remain best-effort even when the host is already half-disposed.
        }
        this.runToken += 1;
        this.activeAutomix = null;
        this.activeAutomixV2 = null;
        this.pausedPositionSeconds = positionSeconds;
        this.clock.reset(positionSeconds, sampleRate);
        this.state = 'paused';
        this.hostStatus = this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';
        this.nativeUnderrunWindow = null;
        this.resetWatchdogProgress();
        this.emitStatus();
      }
    }

    return this.getStatus();
  }

  stop(): AudioStatus {
    this.recordPlaybackDiagnosticEvent('stop_request', 'info', 'stop', {
      positionSeconds: this.clock.getPositionSeconds(),
    });
    this.cancelTransportFade();
    this.runToken += 1;
    this.exclusiveReleaseOnPausePromise = null;
    this.exclusiveReleasedOnPause = false;
    this.exclusiveResumeAfterRelease = false;
    this.stopResources();
    this.resetLevelMeter();
    this.resetNativeTelemetry();
    this.state = 'stopped';
    this.hostStatus = this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';
    this.currentProbe = null;
    this.currentTrackId = null;
    this.currentTrackMetadata = null;
    this.currentReplayGain = null;
    this.currentReplayGainCalculation = {
      appliedDb: 0,
      selectedGainDb: null,
      selectedPeak: null,
      preventedClipping: false,
      active: false,
    };
    this.currentFilePath = null;
    this.currentInputHeaders = null;
    this.currentPlan = null;
    this.currentResidentOutputSampleRate = null;
    this.currentDevice = null;
    this.currentOutputBackend = null;
    this.currentOutputBackendImpl = null;
    this.currentOutputDeviceType = null;
    this.currentOutputDeviceName = null;
    this.currentResamplerEngine = 'default';
    this.currentResamplerFallbackActive = false;
    this.currentDecodeBackendImpl = null;
    this.activeAutomix = null;
    this.activeAutomixV2 = null;
    this.daemonGaplessActive = false;
    this.currentUseMiniaudioOutputRequested = false;
    this.currentDsdOutputModeRequested = 'pcm';
    this.currentActiveDsdOutputMode = null;
    this.currentDsdNativeSampleRate = null;
    this.currentDsdTransportSampleRate = null;
    this.currentReadyResult = null;
    this.currentBridgeOutputMode = null;
    this.currentBridgeSharedBackend = null;
    this.pausedPositionSeconds = null;
    this.errorMessage = null;
    this.outputWarnings = [];
    this.resetWatchdogProgress();
    this.clock.reset(0, null);
    this.emitStatus();
    return this.getStatus();
  }

  async resetEngine(): Promise<AudioStatus> {
    return this.forceRestart('reset-audio-engine');
  }

  async forceRestart(reason: string): Promise<AudioStatus> {
    const resetReason = normalizeResetReason(reason);
    this.runToken += 1;
    await this.stopResourcesGracefully(resetReason, true);
    await this.stopAudioDaemonForPlayback();
    await this.refreshDeviceService();
    this.watchdogRecoveries.clear();
    this.localPlaybackRecoveries.clear();
    this.watchdogLastRecoveryAt = null;
    this.watchdogPendingWarning = null;
    this.sharedStabilityTier = 'standard';
    this.sharedStabilityRecovering = false;
    this.lastSharedStabilityRecoveryKey = null;
    this.watchdogRecovering = false;
    this.lastSharedStabilityRecoveryAt = null;
    this.resetSessionAfterForcedStop();
    const status = this.getStatus();
    this.emit('session-reset', { reason: resetReason, status });
    return status;
  }

  async stopForWindowsAudioServiceRestart(reason = 'windows-audio-service-preflight'): Promise<AudioStatus> {
    const resetReason = normalizeResetReason(reason);
    this.runToken += 1;
    await this.stopResourcesGracefully(resetReason, true);
    await this.stopAudioDaemonForPlayback();
    this.resetSessionAfterForcedStop();
    return this.getStatus();
  }

  private resetSessionAfterForcedStop(): void {
    this.exclusiveReleaseOnPausePromise = null;
    this.exclusiveReleasedOnPause = false;
    this.exclusiveResumeAfterRelease = false;
    this.resetLevelMeter();
    this.resetNativeTelemetry();
    this.state = 'stopped';
    this.hostStatus = this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';
    this.currentProbe = null;
    this.currentTrackId = null;
    this.currentTrackMetadata = null;
    this.currentReplayGain = null;
    this.currentReplayGainCalculation = {
      appliedDb: 0,
      selectedGainDb: null,
      selectedPeak: null,
      preventedClipping: false,
      active: false,
    };
    this.currentFilePath = null;
    this.currentInputHeaders = null;
    this.currentPlan = null;
    this.currentResidentOutputSampleRate = null;
    this.currentDevice = null;
    this.currentOutputBackend = null;
    this.currentOutputBackendImpl = null;
    this.currentOutputDeviceType = null;
    this.currentOutputDeviceName = null;
    this.currentUseMiniaudioOutputRequested = false;
    this.activeAutomix = null;
    this.activeAutomixV2 = null;
    this.daemonGaplessActive = false;
    this.currentReadyResult = null;
    this.currentBridgeOutputMode = null;
    this.currentBridgeSharedBackend = null;
    this.pausedPositionSeconds = null;
    this.errorMessage = null;
    this.outputWarnings = [];
    this.pendingOutputWarnings = [];
    this.resetWatchdogProgress();
    this.clock.reset(0, null);
    this.emitStatus();
  }

  async seek(positionSeconds: number): Promise<AudioStatus> {
    if (!this.currentFilePath || !this.currentOutputSettings) {
      return this.getStatus();
    }

    if (this.isCurrentLivePcmStream()) {
      this.addOutputWarning('live_pcm_seek_skipped');
      this.logger(
        `[AudioSession] seek ignored for live PCM stream source="${redactUrlSecrets(this.currentFilePath)}" position=${Math.max(
          0,
          Number(positionSeconds) || 0,
        ).toFixed(3)}`,
      );
      this.emitStatus();
      return this.getStatus();
    }

    const safePositionSeconds = Math.min(
      Math.max(0, positionSeconds),
      this.currentProbe?.durationSeconds && this.currentProbe.durationSeconds > 0
        ? this.currentProbe.durationSeconds
        : Number.POSITIVE_INFINITY,
    );
    this.recordPlaybackDiagnosticEvent('seek_request', 'info', 'seek', {
      positionSeconds: safePositionSeconds,
      details: {
        requestedPositionSeconds: positionSeconds,
        state: this.state,
      },
    });
    this.resetLevelMeter();

    if (this.activeDaemonBackend) {
      if (this.state === 'paused') {
        try {
          await this.activeDaemonBackend.seek(safePositionSeconds);
          this.daemonGaplessActive = false;
          this.pausedPositionSeconds = safePositionSeconds;
          this.clock.reset(safePositionSeconds, this.currentProbe?.fileSampleRate ?? null);
          this.emitStatus();
          return this.getStatus();
        } catch (error) {
          this.handleError(error instanceof Error ? error : new Error(String(error)));
          return this.getStatus();
        }
      }
      if (this.state === 'playing') {
        try {
          await this.activeDaemonBackend.seek(safePositionSeconds);
          this.daemonGaplessActive = false;
          this.clock.reset(safePositionSeconds, this.currentProbe?.fileSampleRate ?? null);
          this.emitStatus();
          return this.getStatus();
        } catch (error) {
          this.handleError(error instanceof Error ? error : new Error(String(error)));
          return this.getStatus();
        }
      }
    }

    if (this.state === 'paused') {
      const sampleRate = this.currentPlan?.actualDeviceSampleRate ?? this.currentPlan?.requestedOutputSampleRate ?? null;
      this.runToken += 1;
      const token = this.runToken;
      const keepResidentPausedBridge = Boolean(
        this.bridge &&
        this.currentReadyResult &&
        isResidentOutputMode(this.currentPlan?.outputMode ?? this.currentOutputSettings.outputMode),
      );
      if (keepResidentPausedBridge) {
        this.stopPausedDecoderPrewarm();
        this.pausedPositionSeconds = safePositionSeconds;
        this.clock.reset(safePositionSeconds, sampleRate);
        this.hostStatus = 'ready';
        this.emitStatus();
        if (this.currentProbe && this.currentPlan) {
          void this.preparePausedDecoderRun(
            token,
            safePositionSeconds,
            this.currentProbe,
            this.currentPlan,
            this.currentOutputSettings,
          );
        }
        return this.getStatus();
      }
      // Publish the latest user target synchronously before yielding to host
      // cleanup. A concurrently requested resume will wait for this complete
      // transaction and can only start from the new target.
      this.pausedPositionSeconds = safePositionSeconds;
      this.clock.reset(safePositionSeconds, sampleRate);
      this.emitStatus();
      const transaction = (async (): Promise<void> => {
        await this.stopResourcesGracefully('seek-paused');
        if (this.runToken !== token) {
          return;
        }
        const keepExclusiveReleased =
          this.exclusiveReleasedOnPause &&
          this.currentOutputSettings?.releaseExclusiveOnPauseExperimentalEnabled === true &&
          normalizeOutputMode(this.currentOutputSettings.outputMode) === 'exclusive';
        const canPrewarm = !keepExclusiveReleased && Boolean(this.currentProbe && this.currentOutputSettings && this.isNativeHostAvailable());
        this.hostStatus = canPrewarm ? 'starting' : this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';
        this.emitStatus();
        if (canPrewarm) {
          this.startPausedOutputPrewarm(token, safePositionSeconds);
        }
      })();
      this.pausedSeekTransaction = transaction;
      try {
        await transaction;
      } finally {
        if (this.pausedSeekTransaction === transaction) {
          this.pausedSeekTransaction = null;
        }
      }
      return this.getStatus();
    }

    if ((this.state === 'playing' || this.state === 'loading') && this.bridge && isWritableUsable(this.bridge.writable) && this.currentProbe && this.currentPlan) {
      const token = this.runToken + 1;
      this.runToken = token;
      const bridge = this.bridge;
      const activeDsdOutputMode = this.currentPlan.dsdOutputMode;
      const nativeDirectSeekActive = isNativeDirectLocalPlaybackBackend(this.currentDecodeBackendImpl);
      const transactionalPcmSeek =
        !nativeDirectSeekActive && activeDsdOutputMode !== 'dop' && activeDsdOutputMode !== 'native';
      if (transactionalPcmSeek) {
        // Freeze the device callback before detaching the old decoder. Both
        // shared and exclusive resident outputs otherwise keep rendering
        // silence while seek setup runs, making UI time advance before audio.
        await bridge.setPaused?.(true);
        this.assertCurrentRun(token);
      }
      const decoderStop = this.stopDecoderRun();
      if (transactionalPcmSeek) {
        // Establish a strict raw-pipe byte boundary. Decoder process teardown
        // may finish later, but synchronous unpipe/destroy above prevents any
        // new old-session PCM from being submitted past this abort barrier.
        await bridge.abortSession?.();
        this.assertCurrentRun(token);
        if (decoderStop) {
          void decoderStop.catch((stopError) => {
            this.logger(`[AudioSession] seek decoder cleanup finished with error: ${
              stopError instanceof Error ? stopError.message : String(stopError)
            }`);
          });
        }
      } else if (decoderStop) {
        await decoderStop;
      }
      this.assertCurrentRun(token);

      let bitstreamRun: { stream: Readable; decodeBackendImpl: string; nativeSampleRate: number; transportSampleRate: number | null } | null = null;
      if (activeDsdOutputMode === 'dop' || activeDsdOutputMode === 'native') {
        try {
          const info = await readDsfDopInfo(this.currentFilePath);
          bitstreamRun = {
            stream: activeDsdOutputMode === 'native'
              ? createDsfNativeDsdStream(this.currentFilePath, info, safePositionSeconds)
              : createDsfDopStream(this.currentFilePath, info, safePositionSeconds),
            decodeBackendImpl: activeDsdOutputMode === 'native' ? 'dsf-bitstream-native-dsd' : 'dsf-bitstream-dop',
            nativeSampleRate: info.nativeSampleRate,
            transportSampleRate: activeDsdOutputMode === 'dop' ? info.transportSampleRate : null,
          };
        } catch (error) {
          if (this.runToken !== token || isAudioSessionRunCancelledError(error)) {
            return this.getStatus();
          }

          this.handleError(error instanceof Error ? error : new Error(String(error)));
          return this.getStatus();
        }
      }

      const waitForHttpDecoderReady = isHttpPlaybackUrl(this.currentFilePath);
      const nativeDirectPlaybackRate = normalizePlaybackRate(this.currentOutputSettings.playbackRate);
      const replayGainCalculation = nativeDirectSeekActive ? this.calculateCurrentReplayGain() : null;
      const sessionId = bridge.beginSession?.({
        startSeconds: safePositionSeconds,
        playbackRate: nativeDirectPlaybackRate,
        durationSeconds: this.currentProbe.durationSeconds,
        startPaused: transactionalPcmSeek,
        ...(nativeDirectSeekActive
          ? {
              directFilePath: this.currentFilePath,
              directStartSeconds: safePositionSeconds,
              directSampleRate: this.currentPlan.decoderOutputSampleRate,
              directChannels: this.currentProbe.channels,
              directOutputChannels: this.currentPlan.outputChannels,
              directPlaybackRate: nativeDirectPlaybackRate,
              directGain: this.replayGainLinearGain(replayGainCalculation ?? this.currentReplayGainCalculation),
            }
          : {}),
      });
      bridge.resetOutputClock?.(safePositionSeconds, this.currentOutputSettings.playbackRate ?? 1);
      this.attachBridgeEvents(bridge, token);
      this.clock.reset(safePositionSeconds, this.currentPlan.actualDeviceSampleRate ?? this.currentPlan.requestedOutputSampleRate);
      if (nativeDirectSeekActive) {
        this.resetWatchdogProgress();
        this.emitStatus();
        return this.getStatus();
      }
      if (waitForHttpDecoderReady) {
        this.state = 'loading';
        this.hostStatus = 'ready';
        this.emitStatus();
      }

      if (bitstreamRun) {
        const writable = bridge.createSessionWritable?.(sessionId) ?? bridge.writable;
        if (!writable) {
          throw new Error('native output bridge did not expose a writable DSD bitstream');
        }
        this.currentActiveDsdOutputMode = activeDsdOutputMode;
        this.currentDsdNativeSampleRate = bitstreamRun.nativeSampleRate;
        this.currentDsdTransportSampleRate = bitstreamRun.transportSampleRate;
        this.currentDecodeBackendImpl = bitstreamRun.decodeBackendImpl;
        this.startBitstreamRun(bitstreamRun.stream, writable, token);
        this.resetWatchdogProgress();
        this.emitStatus();
        return this.getStatus();
      }

      const run = await this.createDecoderRunForPlayback(
        this.currentFilePath,
        this.currentInputHeaders,
        safePositionSeconds,
        this.currentProbe,
        this.currentPlan,
        this.currentOutputSettings,
      );
      const writable = bridge.createSessionWritable?.(sessionId) ?? bridge.writable;
      if (!writable) {
        throw new Error('native output bridge did not expose a writable PCM stream');
      }
      this.startDecoderRun(run, writable, token);
      if (waitForHttpDecoderReady) {
        await this.waitForDecoderReadyBeforePlaying(run, token, {
          positionSeconds: safePositionSeconds,
          playbackRate: this.currentOutputSettings.playbackRate ?? 1,
          sampleRate: this.currentPlan.actualDeviceSampleRate ?? this.currentPlan.requestedOutputSampleRate,
        });
      }
      if (transactionalPcmSeek) {
        // audio.resume returns only after the target session has reached the
        // native startup-prebuffer threshold, so a completed seek is audible
        // immediately and its position is already backed by consumed PCM.
        await bridge.setPaused?.(false);
        this.assertCurrentRun(token);
      }
      this.state = 'playing';
      this.resetWatchdogProgress();
      this.emitStatus();
      return this.getStatus();
    }

    return this.playLocalFile({
      filePath: this.currentFilePath,
      trackId: this.currentTrackId ?? undefined,
      metadata: this.currentTrackMetadata ?? undefined,
      startSeconds: safePositionSeconds,
      output: this.currentOutputSettings,
      inputHeaders: this.currentInputHeaders ?? undefined,
    });
  }

  getStatus(): AudioStatus {
    this.updatePositionFromOutput();

    const plan = this.currentPlan;
    const eqState = EqStateStore.loadEqState();
    const channelBalanceState = EqStateStore.loadChannelBalanceState();
    const roomCorrectionState = EqStateStore.loadRoomCorrectionState();
    const dspModuleActive = eqState.enabled || roomCorrectionState.enabled || channelBalanceState.enabled;
    const audioVisualSpectrumEnabled = isAudioVisualSpectrumEnabled();
    this.levelMeterTransform?.setVisualSpectrumEnabled(audioVisualSpectrumEnabled);
    const audioLevels = this.nativeAudioLevels ?? createAudioLevelTelemetry(
      audioVisualSpectrumEnabled ? this.levelSnapshot : this.createLevelSnapshotWithoutVisualTelemetry(this.levelSnapshot),
      eqState,
      channelBalanceState,
      dspModuleActive,
    );
    const estimatedOutputTruePeakDb = audioLevels.estimatedOutputTruePeakDb ?? null;
    const realtimeLevelClippingRisk =
      (audioLevels.estimatedOutputPeakDb !== null && audioLevels.estimatedOutputPeakDb >= 0) ||
      (estimatedOutputTruePeakDb !== null && estimatedOutputTruePeakDb >= 0);
    const realtimeLevelClipped = audioLevels.clipCount > 0;
    const nativeDspClippingRisk = this.nativeTelemetry.dspClippingRisk === true;
    const nativeDspLimiterProtecting = this.nativeTelemetry.dspLimiterProtecting === true;
    const legacyChainedPlaybackActive = this.activeAutomix !== null;
    const nativeAutomixV2Active =
      this.activeAutomixV2?.state === 'armed' || this.activeAutomixV2?.state === 'committed';
    const automixV2Configured = this.activeAutomixV2 !== null && automixV2Phase !== 'off';
    const chainedPlaybackActive = legacyChainedPlaybackActive || nativeAutomixV2Active || this.daemonGaplessActive;
    const gaplessActive = this.activeAutomix?.gapless === true || this.daemonGaplessActive;
    const automixActive = (legacyChainedPlaybackActive && !gaplessActive) || automixV2Configured;
    const gaplessPlaybackEnabled = getAppSettings().gaplessPlaybackEnabled === true;
    const settings = getReplayGainAudioSettings();
    const replayGainCalculation = this.currentReplayGainCalculation;
    const replayGainActive = replayGainCalculation.active && Math.abs(replayGainCalculation.appliedDb) >= 0.001;
    const echoSrcActive = plan?.echoSrcActive === true;
    const sdmPcmToDsdActive = plan?.sdmPcmToDsdActive === true;
    const dspActive =
      dspModuleActive
      || legacyChainedPlaybackActive
      || nativeAutomixV2Active
      || replayGainActive
      || echoSrcActive
      || sdmPcmToDsdActive;
    const bitPerfectDisabledReason = eqState.enabled
      ? 'eq_enabled'
      : roomCorrectionState.enabled
        ? 'room_correction_enabled'
        : channelBalanceState.enabled
          ? 'channel_balance_enabled'
          : legacyChainedPlaybackActive || nativeAutomixV2Active
            ? gaplessActive
              ? 'gapless_enabled'
              : 'automix_enabled'
            : replayGainActive
              ? 'replay_gain_enabled'
              : echoSrcActive
                ? 'echo_src_enabled'
                : sdmPcmToDsdActive
                  ? 'sdm_enabled'
                  : null;
    const warnings = [...(plan?.warnings ?? [])];
    for (const warning of this.outputWarnings) {
      if (!warnings.includes(warning)) {
        warnings.push(warning);
      }
    }

    if (eqState.enabled) {
      warnings.push('eq_enabled_bit_perfect_disabled');
    } else if (roomCorrectionState.enabled) {
      warnings.push('room_correction_bit_perfect_disabled');
    } else if (channelBalanceState.enabled) {
      warnings.push('channel_balance_bit_perfect_disabled');
    } else if (legacyChainedPlaybackActive || nativeAutomixV2Active) {
      warnings.push(gaplessActive ? 'gapless_enabled_bit_perfect_disabled' : 'automix_enabled_bit_perfect_disabled');
    } else if (replayGainActive) {
      warnings.push('replay_gain_bit_perfect_disabled');
    } else if (echoSrcActive) {
      warnings.push('echo_src_bit_perfect_disabled');
    } else if (sdmPcmToDsdActive) {
      warnings.push('sdm_pcm_to_dsd_bit_perfect_disabled');
    }

    if (settings.replayGainEnabled === true && (this.currentActiveDsdOutputMode === 'dop' || this.currentActiveDsdOutputMode === 'native')) {
      warnings.push('replay_gain_disabled_by_dsd_direct');
    }

    if (eqState.clippingRisk || roomCorrectionState.clippingRisk || channelBalanceState.clippingRisk) {
      warnings.push(eqState.clippingRisk ? 'eq_clipping_risk' : roomCorrectionState.clippingRisk ? 'room_correction_clipping_risk' : 'channel_balance_clipping_risk');
    }
    if (nativeDspLimiterProtecting && !warnings.includes('dsp_limiter_protecting')) {
      warnings.push('dsp_limiter_protecting');
    } else if (nativeDspClippingRisk && !warnings.includes('dsp_clipping_risk')) {
      warnings.push('dsp_clipping_risk');
    }
    if (realtimeLevelClippingRisk && !warnings.includes('audio_level_clipping_risk')) {
      warnings.push('audio_level_clipping_risk');
    }
    if (realtimeLevelClipped && !warnings.includes('audio_level_clipped')) {
      warnings.push('audio_level_clipped');
    }

    const nativeSampleRate = plan?.actualDeviceSampleRate ?? plan?.requestedOutputSampleRate ?? null;
    const nativeBufferedMs =
      nativeSampleRate && this.nativeTelemetry.bufferedFrames !== null
        ? Math.round((this.nativeTelemetry.bufferedFrames / nativeSampleRate) * 1000)
        : null;
    const nativeActualBufferFrames = this.nativeActualBufferFrames ?? this.nativeDeviceBufferFrames;
    const nativeOutputLatencyMs =
      nativeSampleRate && nativeActualBufferFrames !== null
        ? Math.round((nativeActualBufferFrames / nativeSampleRate) * 1000)
        : null;
    const nativePositionStalenessMs =
      this.bridge?.getPositionStalenessMs?.() ?? this.nativeTelemetry.nativePositionStalenessMs ?? null;
    const ffmpeg = this.decoder.getToolchainInfo?.() ?? null;
    const rawPositionSeconds = this.clock.getPositionSeconds();
    const currentAutomixTransition =
      this.activeAutomix && this.activeAutomix.nextTransitionIndex > 0
        ? this.activeAutomix.transitions[this.activeAutomix.nextTransitionIndex - 1]
        : null;
    const automixPositionSeconds =
      currentAutomixTransition
        ? Math.max(
            0,
            rawPositionSeconds - (this.activeAutomix?.compositeStartSeconds ?? 0) - currentAutomixTransition.trackStartOutputSeconds +
              currentAutomixTransition.trackStartSourceSeconds,
          )
        : rawPositionSeconds;
    const automixDurationSeconds = this.currentProbe?.durationSeconds ?? 0;
    const nativeDirectLocalPlaybackRequested = process.env.ECHO_FORCE_LEGACY_LOCAL_PLAYBACK !== '1';
    const nativeDirectLocalPlaybackActive = isNativeDirectLocalPlaybackBackend(this.currentDecodeBackendImpl);
    const nativeDirectLocalPlaybackWarningReason = this.getNativeDirectLocalPlaybackStatusFallbackReason();
    const nativeDirectLocalPlaybackFallbackReason = nativeDirectLocalPlaybackActive
      ? null
      : nativeDirectLocalPlaybackWarningReason ?? (nativeDirectLocalPlaybackRequested ? null : 'disabled');
    const nativeOutputFormat = getReadyOutputFormat(this.currentReadyResult);
    const pcmDitherMode = normalizePcmDitherMode(this.currentOutputSettings?.pcmDitherMode ?? this.outputSettings.pcmDitherMode);
    const nativeDitherStatus = nativeDirectLocalPlaybackActive
      ? this.currentNativeProcessingStatus?.dither ?? null
      : null;
    const nativeDitherBitDepth: 16 | 24 | null = nativeDitherStatus?.bitDepth === 16 || nativeDitherStatus?.bitDepth === 24
      ? nativeDitherStatus.bitDepth
      : null;
    const pcmDitherRuntimeStatus = nativeDitherStatus
      ? {
        active: nativeDitherStatus.active,
        targetBitDepth: nativeDitherBitDepth,
        reason: nativeDitherStatus.active
          ? null
          : nativeDitherStatus.mode === 'off'
            ? 'off'
            : 'native_host_inactive',
      }
      : this.currentActiveDsdOutputMode === 'dop' || this.currentActiveDsdOutputMode === 'native'
        ? { active: false, targetBitDepth: null, reason: 'dsd_direct_bypass' }
        : sdmPcmToDsdActive
          ? { active: false, targetBitDepth: null, reason: 'sdm_direct_bypass' }
          : resolvePcmDitherRuntimeStatus(pcmDitherMode, nativeOutputFormat);
    const sdmMode = normalizeSdmMode(this.currentOutputSettings?.sdmMode ?? this.outputSettings.sdmMode);
    const sdmTargetRate = normalizeSdmTargetRate(this.currentOutputSettings?.sdmTargetRate ?? this.outputSettings.sdmTargetRate);
    const sdmQualityProfile = normalizeSdmQualityProfile(
      this.currentOutputSettings?.sdmQualityProfile ?? this.outputSettings.sdmQualityProfile,
    );
    const sdmComputeBackend = normalizeSdmComputeBackend(
      this.currentOutputSettings?.sdmComputeBackend ?? this.outputSettings.sdmComputeBackend,
    );
    const sdmOversamplingFilterProfile1x = normalizeEchoSrcFilterProfile(
      this.currentOutputSettings?.sdmOversamplingFilterProfile1x ?? this.outputSettings.sdmOversamplingFilterProfile1x ?? 'sinc-long',
    );
    const sdmOversamplingFilterProfileNx = normalizeEchoSrcFilterProfile(
      this.currentOutputSettings?.sdmOversamplingFilterProfileNx ?? this.outputSettings.sdmOversamplingFilterProfileNx ?? 'poly-sinc-hb',
    );
    const sdmRuntimeState = resolveSdmRuntimeState(sdmMode, this.currentActiveDsdOutputMode, sdmPcmToDsdActive);

    return {
      host: this.hostStatus,
      cpuModel: runtimeCpuModel,
      state: this.state,
      outputDeviceId: this.currentDevice?.id ?? null,
      outputDeviceName: this.currentOutputDeviceName ?? this.currentDevice?.name ?? null,
      outputDeviceType: this.currentOutputDeviceType,
      outputBackend: this.currentOutputBackend,
      activeOutputBackendImpl: this.currentOutputBackendImpl,
      nativeOutputFormat,
      outputMode: plan?.outputMode ?? this.outputSettings.outputMode,
      automaticOutputEnabled: this.currentOutputSettings
        ? this.currentOutputSettings.automaticOutputEnabled === true
        : this.outputSettings.automaticOutputEnabled === true,
      automaticOutputStage: this.automaticOutputStage,
      sharedBackend: normalizeSharedBackend(this.currentOutputSettings?.sharedBackend ?? this.outputSettings.sharedBackend),
      useMiniaudioOutputRequested: this.currentOutputSettings
        ? this.currentUseMiniaudioOutputRequested
        : this.outputSettings.useMiniaudioOutput === true,
      nativeDirectLocalPlaybackRequested,
      nativeDirectLocalPlaybackActive,
      nativeDirectLocalPlaybackFallbackReason,
      activeDecodeBackendImpl: this.currentDecodeBackendImpl,
      activeDecodeBackendLabel: this.currentDecodeBackendImpl === 'native-direct-daemon-libav'
        ? 'native-direct-libav-audio-format-daemon'
        : null,
      dsdOutputModeRequested: this.currentOutputSettings
        ? this.currentDsdOutputModeRequested
        : normalizeDsdOutputMode(this.outputSettings.dsdOutputMode),
      activeDsdOutputMode: this.currentActiveDsdOutputMode,
      dsdNativeSampleRate: this.currentDsdNativeSampleRate,
      dsdTransportSampleRate: this.currentDsdTransportSampleRate,
      sdmMode,
      sdmTargetRate,
      sdmQualityProfile,
      sdmComputeBackend,
      sdmOversamplingFilterProfile1x,
      sdmOversamplingFilterProfileNx,
      sdmActualComputeBackend: plan?.sdmActualComputeBackend ?? null,
      sdmActive: sdmRuntimeState === 'dsd_passthrough' || sdmRuntimeState === 'pcm_to_sdm_active',
      sdmRuntimeState,
      sdmNativeSampleRate: plan?.sdmNativeSampleRate ?? null,
      sdmTransportSampleRate: plan?.sdmTransportSampleRate ?? null,
      sdmModulatorProfile: plan?.sdmModulatorProfile ?? null,
      sdmCudaStatus: plan?.sdmCudaStatus ?? null,
      sdmRuntime: plan?.sdmRuntime ?? null,
      latencyProfile: normalizeLatencyProfile(this.currentOutputSettings?.latencyProfile ?? this.outputSettings.latencyProfile),
      volume: this.outputSettings.volume,
      playbackRate: this.outputSettings.playbackRate,
      playbackSpeedMode: this.outputSettings.playbackSpeedMode,
      replayGainEnabled: settings.replayGainEnabled === true,
      replayGainMode: settings.replayGainMode ?? 'track',
      replayGainAppliedDb: replayGainCalculation.appliedDb,
      replayGainPreventedClipping: replayGainCalculation.preventedClipping,
      gaplessPlaybackEnabled,
      automix: {
        enabled: automixActive,
        mode: this.activeAutomixV2
          ? this.activeAutomixV2.state === 'committed'
            ? 'transitioning'
            : this.activeAutomixV2.state === 'preparing' || this.activeAutomixV2.state === 'armed'
              ? 'armed'
              : 'off'
          : this.activeAutomix
          ? this.activeAutomix.nextTransitionIndex > 0
            ? 'transitioning'
            : 'armed'
          : this.daemonGaplessActive
            ? 'armed'
            : 'off',
        active: chainedPlaybackActive,
        transitionSeconds: this.activeAutomixV2
          ? this.activeAutomixV2.plan.overlapFrames / this.activeAutomixV2.plan.mixSampleRate
          : this.activeAutomix?.transitionSeconds ?? null,
        transitionStartedAtSeconds: this.activeAutomixV2
          ? this.activeAutomixV2.plan.fadeStartOutputFrame / this.activeAutomixV2.plan.mixSampleRate
          : this.activeAutomix?.transitionStartSeconds ?? null,
        nextTrackId: this.activeAutomixV2?.plan.toTrackId ?? this.activeAutomix?.nextTrackId ?? null,
        transitionMode: this.activeAutomixV2?.plan.mode ?? this.activeAutomix?.plan.mode ?? null,
        fallbackReason: this.activeAutomixV2?.plan.fallbackReason ?? this.activeAutomix?.plan.fallbackReason ?? null,
        beatAligned: this.activeAutomixV2?.plan.mode === 'beat_match' || this.activeAutomix?.plan.beatAligned === true,
        gapless: gaplessActive,
        skipIntroSilence: this.activeAutomix?.plan.skipIntroSilence ?? false,
        engine: this.activeAutomixV2 && nativeAutomixV2Active
          ? 'nativeDualDeck'
          : this.daemonGaplessActive
          ? 'nativeGapless'
          : this.currentDecodeBackendImpl === 'native-gapless-dual-deck'
            ? 'nativeGapless'
            : this.currentDecodeBackendImpl === 'ffmpeg-gapless'
              ? 'ffmpegGapless'
              : this.currentDecodeBackendImpl === 'native-automix-dual-deck'
                ? 'nativeDualDeck'
                : this.currentDecodeBackendImpl === 'ffmpeg-automix'
                  ? 'ffmpegPremix'
                  : chainedPlaybackActive
                    ? 'fallback'
                    : null,
        tempoRatio: this.activeAutomixV2?.plan.tempoRatio ?? this.activeAutomix?.plan.tempoRatio ?? null,
        nextStartSeconds: this.activeAutomixV2?.plan.nextStartSeconds ?? this.activeAutomix?.plan.nextStartSeconds ?? null,
        overlapSeconds: this.activeAutomixV2
          ? this.activeAutomixV2.plan.overlapFrames / this.activeAutomixV2.plan.mixSampleRate
          : this.activeAutomix?.plan.overlapSeconds ?? null,
        advanceAtSeconds: this.activeAutomixV2
          ? this.activeAutomixV2.plan.commitOutputFrame / this.activeAutomixV2.plan.mixSampleRate
          : this.activeAutomix?.plan.advanceAtSeconds ?? null,
        plannedTrackCount: this.activeAutomixV2 ? 2 : this.activeAutomix ? this.activeAutomix.transitions.length + 1 : 0,
        nextTransitionIndex: this.activeAutomix?.nextTransitionIndex ?? 0,
        phase: automixV2Phase,
        runtimeState: this.activeAutomixV2?.state ?? 'idle',
        planId: this.activeAutomixV2?.plan.planId ?? null,
        analysisVersion: this.activeAutomixV2 ? automixAnalysisVersion : null,
        bitPerfectDisabled: nativeAutomixV2Active,
        automixBypassed: this.activeAutomixV2?.state === 'fallback'
          ? this.activeAutomixV2.plan.fallbackReason
          : null,
      },
      currentFilePath: this.currentFilePath,
      currentTrackId: this.currentTrackId,
      currentQueueItemId: this.currentTrackId ? this.currentQueueItemId : null,
      queueRevision: this.currentQueueRevision,
      currentTrackTitle: this.currentTrackMetadata?.title ?? null,
      currentTrackArtist: this.currentTrackMetadata?.artist ?? null,
      currentTrackAlbum: this.currentTrackMetadata?.album ?? null,
      currentTrackAlbumArtist: this.currentTrackMetadata?.albumArtist ?? null,
      currentTrackCoverUrl: this.currentTrackMetadata?.coverUrl ?? null,
      durationSeconds: automixDurationSeconds,
      positionSeconds: automixPositionSeconds,
      channels: this.currentProbe?.channels ?? null,
      codec: this.currentProbe?.codec ?? null,
      bitDepth: this.currentProbe?.bitDepth ?? null,
      bitrate: this.currentProbe?.bitrate ?? null,
      fileSampleRate: plan?.fileSampleRate ?? null,
      decoderOutputSampleRate: plan?.decoderOutputSampleRate ?? null,
      requestedOutputSampleRate: plan?.requestedOutputSampleRate ?? null,
      actualDeviceSampleRate: plan?.actualDeviceSampleRate ?? null,
      sharedDeviceSampleRate: plan?.sharedDeviceSampleRate ?? this.currentDevice?.sharedDeviceSampleRate ?? null,
      resampling: plan?.resampling ?? false,
      ffmpegPath: ffmpeg?.path ?? null,
      ffmpegSource: ffmpeg?.source ?? null,
      ffmpegVersion: ffmpeg?.version ?? ffmpeg?.manifestVersion ?? null,
      ffmpegHealthy: ffmpeg?.healthy ?? false,
      soxrAvailable: ffmpeg?.soxrAvailable ?? false,
      resamplerEngine: this.currentResamplerEngine,
      resamplerFallbackActive: this.currentResamplerFallbackActive,
      echoSrcMode: plan?.echoSrcMode ?? 'off',
      echoSrcQualityProfile: plan?.echoSrcQualityProfile ?? normalizeEchoSrcQualityProfile(this.outputSettings.echoSrcQualityProfile),
      echoSrcAdvancedModeEnabled: plan?.echoSrcAdvancedModeEnabled ?? (this.outputSettings.echoSrcAdvancedModeEnabled === true),
      echoSrcFilterProfile: plan?.echoSrcFilterProfile ?? normalizeEchoSrcFilterProfile(this.outputSettings.echoSrcFilterProfile),
      echoSrcFilterProfile1x: plan?.echoSrcFilterProfile1x ?? normalizeEchoSrcFilterProfile(this.outputSettings.echoSrcFilterProfile1x ?? this.outputSettings.echoSrcFilterProfile),
      echoSrcFilterProfileNx: plan?.echoSrcFilterProfileNx ?? normalizeEchoSrcFilterProfile(this.outputSettings.echoSrcFilterProfileNx ?? 'poly-sinc-hb'),
      echoSrcComputeBackend: plan?.echoSrcComputeBackend ?? normalizeEchoSrcComputeBackend(this.outputSettings.echoSrcComputeBackend),
      echoSrcCudaActive: plan?.echoSrcCudaActive ?? false,
      echoSrcCudaStatus: plan?.echoSrcCudaStatus,
      echoSrcTargetSampleRate: plan?.echoSrcTargetSampleRate ?? null,
      echoSrcActive,
      echoSrcRuntime: plan?.echoSrcRuntime ?? null,
      pcmDitherMode,
      pcmDitherActive: pcmDitherRuntimeStatus.active,
      pcmDitherTargetBitDepth: pcmDitherRuntimeStatus.targetBitDepth,
      pcmDitherReason: pcmDitherRuntimeStatus.reason,
      bitPerfectCandidate: this.currentReadyResult !== null && (plan?.bitPerfectCandidate ?? false) && !dspActive,
      sampleRateMismatch: plan?.sampleRateMismatch ?? false,
      eqEnabled: eqState.enabled,
      roomCorrectionEnabled: roomCorrectionState.enabled,
      channelBalanceEnabled: channelBalanceState.enabled,
      dspActive,
      preampDb: eqState.preampDb,
      dspHeadroomDb: eqState.dspHeadroomDb ?? 0,
      eqPresetName: eqState.presetName,
      clippingRisk: eqState.clippingRisk || roomCorrectionState.clippingRisk || Boolean(channelBalanceState.clippingRisk) || nativeDspClippingRisk || nativeDspLimiterProtecting || realtimeLevelClippingRisk || realtimeLevelClipped,
      dspClippingRisk: nativeDspClippingRisk,
      dspLimiterProtecting: nativeDspLimiterProtecting,
      audioLevels,
      bitPerfectDisabledReason,
      sharedStabilityTier: plan?.outputMode === 'shared' ? this.sharedStabilityTier : null,
      nativeDeviceBufferFrames: this.nativeDeviceBufferFrames,
      nativeRequestedBufferFrames: this.nativeRequestedBufferFrames,
      nativeActualBufferFrames,
      nativeOutputLatencyMs,
      nativePositionStalenessMs,
      nativeFifoCapacityFrames: this.nativeFifoCapacityFrames,
      nativeStartupPrebufferFrames: this.nativeStartupPrebufferFrames,
      nativeBufferedFrames: this.nativeTelemetry.bufferedFrames,
      nativeBufferedMs,
      nativeUnderrunCallbacks: this.nativeTelemetry.underrunCallbacks,
      nativeUnderrunFrames: this.nativeTelemetry.underrunFrames,
      mainEventLoopLagMs: this.mainEventLoopLagMs,
      audioHostRestartCount: this.audioHostRestartCount,
      playbackRecoveryCount: this.playbackRecoveryCount,
      lastSharedStabilityRecoveryAt: this.lastSharedStabilityRecoveryAt,
      warnings,
      error: this.errorMessage,
    };
  }

  private recordPlaybackDiagnosticEvent(
    kind: AudioPlaybackDiagnosticEvent['kind'],
    severity: AudioPlaybackDiagnosticSeverity,
    reason: string,
    options: Partial<
      Pick<
        AudioPlaybackDiagnosticEvent,
        | 'trackId'
        | 'filePath'
        | 'positionSeconds'
        | 'durationSeconds'
        | 'outputMode'
        | 'outputBackend'
        | 'outputBackendImpl'
        | 'details'
      >
    > = {},
  ): void {
    const clockPosition = this.clock.getPositionSeconds();
    const positionSeconds = options.positionSeconds ?? (Number.isFinite(clockPosition) ? clockPosition : null);
    const durationSeconds = options.durationSeconds ?? this.currentProbe?.durationSeconds ?? null;
    const safePositionSeconds = typeof positionSeconds === 'number' && Number.isFinite(positionSeconds) ? positionSeconds : null;
    const safeDurationSeconds = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) ? durationSeconds : null;
    const outputMode =
      options.outputMode ??
      this.currentPlan?.outputMode ??
      (this.currentOutputSettings ? normalizeOutputMode(this.currentOutputSettings.outputMode) : null);
    const warnings = [...new Set([...this.outputWarnings, ...this.pendingOutputWarnings])].slice(-12);
    const event: AudioPlaybackDiagnosticEvent = {
      at: new Date().toISOString(),
      kind,
      severity,
      reason,
      state: this.state,
      trackId: options.trackId ?? this.currentTrackId,
      filePath: options.filePath ?? this.currentFilePath,
      positionSeconds: safePositionSeconds,
      durationSeconds: safeDurationSeconds,
      outputMode,
      outputBackend: options.outputBackend ?? this.currentOutputBackend,
      outputBackendImpl: options.outputBackendImpl ?? this.currentOutputBackendImpl,
      nativeBufferedFrames: this.nativeTelemetry.bufferedFrames,
      nativeUnderrunCallbacks: this.nativeTelemetry.underrunCallbacks,
      nativeUnderrunFrames: this.nativeTelemetry.underrunFrames,
      warnings,
      details: options.details,
    };

    if (severity === 'recovery') {
      this.playbackRecoveryCount += 1;
    }

    this.playbackDiagnosticEvents.push(event);
    if (this.playbackDiagnosticEvents.length > playbackDiagnosticEventLimit) {
      this.playbackDiagnosticEvents.splice(0, this.playbackDiagnosticEvents.length - playbackDiagnosticEventLimit);
    }

    this.logPlaybackDiagnosticEvent(event);
  }

  private logPlaybackDiagnosticEvent(event: AudioPlaybackDiagnosticEvent): void {
    if (!shouldLogPlaybackDiagnosticEvent(event)) {
      return;
    }

    const nativeSampleRate = this.currentPlan?.actualDeviceSampleRate ?? this.currentPlan?.requestedOutputSampleRate ?? null;
    const nativeBufferedMs =
      nativeSampleRate && event.nativeBufferedFrames !== null && event.nativeBufferedFrames !== undefined
        ? Math.round((event.nativeBufferedFrames / nativeSampleRate) * 1000)
        : null;
    const probeDiagnostics = createPlaybackProbeDiagnostics(this.currentProbe, event.filePath);
    const payload = {
      at: event.at,
      event: event.kind,
      severity: event.severity,
      reason: event.reason,
      state: event.state,
      trackId: event.trackId,
      filePath: event.filePath ? redactUrlSecrets(event.filePath) : null,
      currentFilePath: safePlaybackDiagnosticPath(event.filePath),
      codec: this.currentProbe?.codec ?? null,
      container: inferPlaybackDiagnosticContainer(event.filePath),
      duration: event.durationSeconds,
      fileSampleRate: this.currentProbe?.fileSampleRate ?? null,
      bitDepth: this.currentProbe?.bitDepth ?? null,
      mimeType: null,
      firstFfprobeResult: probeDiagnostics,
      outputMode: event.outputMode,
      outputBackend: event.outputBackend,
      outputBackendImpl: event.outputBackendImpl,
      positionSeconds: event.positionSeconds,
      durationSeconds: event.durationSeconds,
      nativeBufferedFrames: event.nativeBufferedFrames ?? null,
      nativeBufferedMs,
      nativeUnderrunCallbacks: event.nativeUnderrunCallbacks ?? 0,
      nativeUnderrunFrames: event.nativeUnderrunFrames ?? 0,
      levelMeterObserveCostMs: this.levelSnapshot.levelMeterObserveCostMs,
      visualSpectrumComputeCostMs: this.levelSnapshot.visualSpectrumComputeCostMs,
      mainEventLoopLagMs: this.mainEventLoopLagMs,
      audioHostRestartCount: this.audioHostRestartCount,
      playbackRecoveryCount: this.playbackRecoveryCount,
      warnings: event.warnings ?? [],
      details: event.details ?? null,
    };

    this.diagnosticLogger(`[AudioSession] playback diagnostic ${JSON.stringify(payload)}`);
  }

  private getPlaybackIssueSummary(): AudioPlaybackIssueSummary {
    const suspectEvents = this.playbackDiagnosticEvents.filter((event) => event.severity === 'suspect' || event.severity === 'error');
    const recoveryEvents = this.playbackDiagnosticEvents.filter((event) => event.severity === 'recovery');
    const commandEvents = this.playbackDiagnosticEvents.filter((event) =>
      event.kind === 'play_request' ||
      event.kind === 'seek_request' ||
      event.kind === 'pause_request' ||
      event.kind === 'stop_request',
    );

    return {
      eventCount: this.playbackDiagnosticEvents.length,
      suspectEventCount: suspectEvents.length,
      recoveryEventCount: recoveryEvents.length,
      lastSuspectEventAt: suspectEvents.at(-1)?.at ?? null,
      lastRecoveryEventAt: recoveryEvents.at(-1)?.at ?? null,
      lastCommandAt: commandEvents.at(-1)?.at ?? null,
    };
  }

  getDiagnostics(): AudioDiagnostics {
    const status = this.getStatus();

    return {
      state: status.state,
      host: status.host,
      outputMode: status.outputMode,
      sharedBackend: status.sharedBackend,
      latencyProfile: status.latencyProfile,
      outputBackend: status.outputBackend,
      activeOutputBackendImpl: status.activeOutputBackendImpl,
      nativeOutputFormat: status.nativeOutputFormat,
      useMiniaudioOutputRequested: status.useMiniaudioOutputRequested,
      nativeDirectLocalPlaybackRequested: status.nativeDirectLocalPlaybackRequested,
      nativeDirectLocalPlaybackActive: status.nativeDirectLocalPlaybackActive,
      nativeDirectLocalPlaybackFallbackReason: status.nativeDirectLocalPlaybackFallbackReason,
      activeDecodeBackendImpl: status.activeDecodeBackendImpl,
      dsdOutputModeRequested: status.dsdOutputModeRequested,
      activeDsdOutputMode: status.activeDsdOutputMode,
      dsdNativeSampleRate: status.dsdNativeSampleRate,
      dsdTransportSampleRate: status.dsdTransportSampleRate,
      outputDeviceName: status.outputDeviceName,
      currentFilePath: status.currentFilePath,
      currentTrackId: status.currentTrackId,
      durationSeconds: status.durationSeconds,
      positionSeconds: status.positionSeconds,
      playbackRate: status.playbackRate,
      fileSampleRate: status.fileSampleRate,
      decoderOutputSampleRate: status.decoderOutputSampleRate,
      requestedOutputSampleRate: status.requestedOutputSampleRate,
      actualDeviceSampleRate: status.actualDeviceSampleRate,
      sharedDeviceSampleRate: status.sharedDeviceSampleRate,
      resampling: status.resampling,
      ffmpegPath: status.ffmpegPath,
      ffmpegSource: status.ffmpegSource,
      ffmpegVersion: status.ffmpegVersion,
      ffmpegHealthy: status.ffmpegHealthy,
      soxrAvailable: status.soxrAvailable,
      resamplerEngine: status.resamplerEngine,
      resamplerFallbackActive: status.resamplerFallbackActive,
      echoSrcMode: status.echoSrcMode,
      echoSrcQualityProfile: status.echoSrcQualityProfile,
      echoSrcAdvancedModeEnabled: status.echoSrcAdvancedModeEnabled,
      echoSrcFilterProfile: status.echoSrcFilterProfile,
      echoSrcFilterProfile1x: status.echoSrcFilterProfile1x,
      echoSrcFilterProfileNx: status.echoSrcFilterProfileNx,
      echoSrcComputeBackend: status.echoSrcComputeBackend,
      echoSrcCudaActive: status.echoSrcCudaActive,
      echoSrcCudaStatus: status.echoSrcCudaStatus,
      echoSrcTargetSampleRate: status.echoSrcTargetSampleRate,
      echoSrcActive: status.echoSrcActive,
      echoSrcRuntime: status.echoSrcRuntime,
      bitPerfectCandidate: status.bitPerfectCandidate,
      sampleRateMismatch: status.sampleRateMismatch,
      sharedStabilityTier: status.sharedStabilityTier,
      nativeDeviceBufferFrames: status.nativeDeviceBufferFrames,
      nativeRequestedBufferFrames: status.nativeRequestedBufferFrames,
      nativeActualBufferFrames: status.nativeActualBufferFrames,
      nativeOutputLatencyMs: status.nativeOutputLatencyMs,
      nativePositionStalenessMs: status.nativePositionStalenessMs,
      nativeFifoCapacityFrames: status.nativeFifoCapacityFrames,
      nativeStartupPrebufferFrames: status.nativeStartupPrebufferFrames,
      nativeBufferedFrames: status.nativeBufferedFrames,
      nativeBufferedMs: status.nativeBufferedMs,
      nativeUnderrunCallbacks: status.nativeUnderrunCallbacks,
      nativeUnderrunFrames: status.nativeUnderrunFrames,
      mainEventLoopLagMs: status.mainEventLoopLagMs,
      audioHostRestartCount: status.audioHostRestartCount,
      playbackRecoveryCount: status.playbackRecoveryCount,
      lastSharedStabilityRecoveryAt: status.lastSharedStabilityRecoveryAt,
      warnings: status.warnings,
      error: status.error,
      watchdogStatus: this.getWatchdogStatus(),
      recentWatchdogRecoveryCount: this.getRecentWatchdogRecoveryCount(),
      lastWatchdogRecoveryTime: this.watchdogLastRecoveryAt,
      recentPlaybackEvents: this.playbackDiagnosticEvents,
      playbackIssueSummary: this.getPlaybackIssueSummary(),
    };
  }

  async checkPlaybackWatchdog(): Promise<void> {
    const token = this.runToken;

    try {
      // Both playback paths expose the host-owned output clock. The daemon
      // intentionally has no legacy PCM bridge, so using only this.bridge here
      // would leave daemon-direct playback outside the same stall recovery
      // policy as resident native output.
      const playbackPositionSource = this.activeDaemonBackend ?? this.bridge;
      if (
        this.state !== 'playing' ||
        this.watchdogRecovering ||
        this.sharedStabilityRecovering ||
        !playbackPositionSource ||
        !this.currentFilePath ||
        !this.currentOutputSettings
      ) {
        this.resetWatchdogProgress();
        return;
      }

      const positionSeconds = playbackPositionSource.getPositionSeconds();
      if (!Number.isFinite(positionSeconds)) {
        this.resetWatchdogProgress();
        return;
      }

      if (
        this.watchdogLastPositionSeconds === null ||
        positionSeconds > this.watchdogLastPositionSeconds + watchdogPositionEpsilonSeconds
      ) {
        this.watchdogLastPositionSeconds = positionSeconds;
        this.watchdogStalledChecks = 0;
        return;
      }

      this.watchdogStalledChecks += 1;
      if (this.watchdogStalledChecks < this.watchdogStallChecks) {
        return;
      }

      await this.recoverFromWatchdogStall(positionSeconds, token);
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  dispose(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.mainEventLoopLagTimer) {
      clearInterval(this.mainEventLoopLagTimer);
      this.mainEventLoopLagTimer = null;
    }
    getEqBridge().off('state', this.eqStateListener);
    getEqBridge().off('channelBalanceState', this.eqStateListener);
    getEqBridge().off('roomCorrectionState', this.eqStateListener);
    this.detachBridgeEvents();
    this.stopResources();
  }

  async disposeGracefully(reason = 'dispose'): Promise<void> {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.mainEventLoopLagTimer) {
      clearInterval(this.mainEventLoopLagTimer);
      this.mainEventLoopLagTimer = null;
    }

    getEqBridge().off('state', this.eqStateListener);
    getEqBridge().off('channelBalanceState', this.eqStateListener);
    getEqBridge().off('roomCorrectionState', this.eqStateListener);
    await this.stopResourcesGracefully(reason);
    this.detachBridgeEvents();
  }

  private createOutputSettingsForRequest(output: AudioOutputSettings | undefined): AudioOutputSettings {
    const baseOutputSettings =
      this.currentOutputSettings &&
      this.currentFilePath &&
      (this.state === 'playing' || this.state === 'paused' || this.state === 'loading') &&
      output?.outputMode === undefined
        ? this.currentOutputSettings
        : this.outputSettings;
    const baseOutputMode = normalizeOutputMode(baseOutputSettings.outputMode);
    const nextOutputMode = normalizeOutputMode(output?.outputMode ?? baseOutputMode);
    const nextLatencyProfile = resolveLatencyProfile(
      nextOutputMode,
      output?.latencyProfile,
      baseOutputMode,
      baseOutputSettings.latencyProfile ?? defaultLatencyProfileForMode(baseOutputMode),
      output?.outputMode !== undefined,
    );

    const settings: AudioOutputSettings = {
      ...baseOutputSettings,
      ...output,
      outputMode: nextOutputMode,
      sharedBackend: nextOutputMode === 'shared'
        ? normalizeSharedBackend(output?.sharedBackend ?? baseOutputSettings.sharedBackend)
        : 'auto',
      latencyProfile: nextLatencyProfile,
      bufferSizeFrames: this.sanitizeLowLatencyBufferForOutputMode(
        nextOutputMode,
        nextLatencyProfile,
        resolveBufferSizeFrames(output, baseOutputSettings.bufferSizeFrames),
        'playback_request',
      ),
      exclusiveInstabilityFallbackEnabled:
        output?.exclusiveInstabilityFallbackEnabled ??
        baseOutputSettings.exclusiveInstabilityFallbackEnabled ??
        false,
      defaultDeviceFallbackEnabled: output?.defaultDeviceFallbackEnabled ?? baseOutputSettings.defaultDeviceFallbackEnabled ?? false,
      useMiniaudioOutput: output?.useMiniaudioOutput ?? baseOutputSettings.useMiniaudioOutput ?? false,
      nativeDirectLocalPlaybackEnabled: process.env.ECHO_FORCE_LEGACY_LOCAL_PLAYBACK !== '1',
      dsdOutputMode: normalizeDsdOutputMode(output?.dsdOutputMode ?? baseOutputSettings.dsdOutputMode),
      sdmMode: normalizeSdmMode(output?.sdmMode ?? baseOutputSettings.sdmMode),
      sdmTargetRate: normalizeSdmTargetRate(output?.sdmTargetRate ?? baseOutputSettings.sdmTargetRate),
      sdmQualityProfile: normalizeSdmQualityProfile(output?.sdmQualityProfile ?? baseOutputSettings.sdmQualityProfile),
      sdmComputeBackend: normalizeSdmComputeBackend(output?.sdmComputeBackend ?? baseOutputSettings.sdmComputeBackend),
      sdmOversamplingFilterProfile1x: normalizeEchoSrcFilterProfile(
        output?.sdmOversamplingFilterProfile1x ?? baseOutputSettings.sdmOversamplingFilterProfile1x ?? 'sinc-long',
      ),
      sdmOversamplingFilterProfileNx: normalizeEchoSrcFilterProfile(
        output?.sdmOversamplingFilterProfileNx ?? baseOutputSettings.sdmOversamplingFilterProfileNx ?? 'poly-sinc-hb',
      ),
      soxrFallbackEnabled: output?.soxrFallbackEnabled ?? baseOutputSettings.soxrFallbackEnabled ?? true,
      echoSrcMode: normalizeEchoSrcMode(output?.echoSrcMode ?? baseOutputSettings.echoSrcMode),
      echoSrcQualityProfile: normalizeEchoSrcQualityProfile(output?.echoSrcQualityProfile ?? baseOutputSettings.echoSrcQualityProfile),
      echoSrcAdvancedModeEnabled:
        output?.echoSrcAdvancedModeEnabled ?? baseOutputSettings.echoSrcAdvancedModeEnabled ?? false,
      echoSrcFilterProfile: normalizeEchoSrcFilterProfile(output?.echoSrcFilterProfile ?? baseOutputSettings.echoSrcFilterProfile),
      echoSrcFilterProfile1x: normalizeEchoSrcFilterProfile(
        output?.echoSrcFilterProfile1x ?? baseOutputSettings.echoSrcFilterProfile1x ?? output?.echoSrcFilterProfile ?? baseOutputSettings.echoSrcFilterProfile,
      ),
      echoSrcFilterProfileNx: normalizeEchoSrcFilterProfile(
        output?.echoSrcFilterProfileNx ?? baseOutputSettings.echoSrcFilterProfileNx ?? 'poly-sinc-hb',
      ),
      echoSrcComputeBackend: normalizeEchoSrcComputeBackend(output?.echoSrcComputeBackend ?? baseOutputSettings.echoSrcComputeBackend),
      releaseExclusiveOnPauseExperimentalEnabled:
        output?.releaseExclusiveOnPauseExperimentalEnabled ??
        baseOutputSettings.releaseExclusiveOnPauseExperimentalEnabled ??
        false,
      volume: Math.max(0, Math.min(1, Number(output?.volume ?? baseOutputSettings.volume) || 0)),
      playbackRate: normalizePlaybackRate(output?.playbackRate ?? baseOutputSettings.playbackRate),
      playbackSpeedMode: normalizePlaybackSpeedMode(output?.playbackSpeedMode ?? baseOutputSettings.playbackSpeedMode),
    };

    if (settings.sharedBackend === 'directsound') {
      settings.deviceIndex = undefined;
    }

    return settings;
  }

  private getRequestedResamplerEngine(plan: SampleRatePlan, outputSettings: AudioOutputSettings): AudioResamplerEngine {
    if (plan.echoSrcActive) {
      return this.getPreferredFfmpegResamplerEngine();
    }

    if (plan.sdmPcmToDsdActive) {
      return this.getPreferredFfmpegResamplerEngine();
    }

    if (
      plan.outputMode === 'shared' &&
      outputSettings.sharedBackend !== 'directsound' &&
      plan.fileSampleRate !== null &&
      plan.fileSampleRate !== plan.decoderOutputSampleRate
    ) {
      return this.getPreferredFfmpegResamplerEngine();
    }

    return 'default';
  }

  private getPreferredFfmpegResamplerEngine(): AudioResamplerEngine {
    const toolchain = this.decoder.getToolchainInfo?.();
    return toolchain ? (toolchain.soxrAvailable ? 'soxr' : 'default') : 'soxr';
  }

  private createDecodeRequest(
    filePath: string,
    inputHeaders: Record<string, string> | null | undefined,
    startSeconds: number,
    channels: number,
    plan: SampleRatePlan,
    outputSettings: AudioOutputSettings,
  ): PcmDecodeRequest {
    const resamplerEngine = this.getRequestedResamplerEngine(plan, outputSettings);
    this.currentResamplerEngine = resamplerEngine;
    this.currentResamplerFallbackActive = false;

    return {
      filePath,
      inputHeaders: inputHeaders ?? undefined,
      startSeconds,
      channels,
      decoderOutputSampleRate: plan.decoderOutputSampleRate,
      resamplerEngine,
      resamplerQualityProfile: plan.sdmPcmToDsdActive ? 'transparent' : plan.echoSrcQualityProfile,
      allowResamplerFallback: outputSettings.soxrFallbackEnabled !== false,
      onResamplerFallback: (warning: string) => {
        this.currentResamplerEngine = 'default';
        this.currentResamplerFallbackActive = true;
        if (plan.sdmPcmToDsdActive && this.currentPlan?.sdmRuntime) {
          this.currentPlan = {
            ...this.currentPlan,
            sdmRuntime: {
              ...this.currentPlan.sdmRuntime,
              oversamplingEngine: 'default',
              oversamplingQualityProfile: null,
              oversamplingPrecision: null,
              oversamplingRuntime: createEchoSrcRuntimeStatus('fallback', {
                sourceSampleRate: this.currentPlan.sdmRuntime.oversamplingSourceSampleRate,
                targetSampleRate: this.currentPlan.sdmRuntime.oversamplingTargetSampleRate,
                filterProfile: null,
                filterSlot: this.currentPlan.sdmRuntime.oversamplingFilterSlot,
                qualityProfile: null,
                requestedBackend: 'soxr',
                activeBackend: 'default',
                fallbackReason: warning,
              }),
              fallbackReason: this.currentPlan.sdmRuntime.fallbackReason ?? warning,
            },
          };
        }
        this.addOutputWarning(warning);
        this.emitStatus();
      },
    };
  }

  private createFfmpegDecoderRun(request: PcmDecodeRequest): DecoderRun {
    this.currentDecodeBackendImpl = 'ffmpeg';
    return this.decoder.decodeLocalFile(request);
  }

  private async createDecoderRunForPlayback(
    filePath: string,
    inputHeaders: Record<string, string> | null | undefined,
    startSeconds: number,
    probe: AudioProbeResult,
    plan: SampleRatePlan,
    outputSettings: AudioOutputSettings,
  ): Promise<DecoderRun> {
    const request = this.createDecodeRequest(
      filePath,
      inputHeaders,
      startSeconds,
      probe.channels,
      plan,
      outputSettings,
    );

    return this.createFfmpegDecoderRun(request);
  }

  private async resolveAutomixNextProbe(next: AudioSessionAutomixNextTrack): Promise<AudioProbeResult> {
    let nextProbe = createProbeFromHint(next.filePath, next.probe);
    if (!nextProbe || shouldProbeDsdNativeSampleRate(nextProbe)) {
      if (isHttpPlaybackUrl(next.filePath)) {
        nextProbe = createStreamProbeFromHint(next.filePath, next.probe);
      } else {
        const probed = await this.decoder.probeLocalFile(next.filePath);
        nextProbe = createProbeFromHint(next.filePath, mergeProbeHints(createProbeHint(probed), next.probe)) ?? probed;
      }
    }

    return nextProbe;
  }

  private getAutomixCandidateTrackId(track: AudioSessionAutomixNextTrack | null | undefined): string | null {
    if (!track) {
      return null;
    }

    return track.trackId ?? track.filePath;
  }

  private async resolveAutomixAnalysis(
    filePath: string,
    inputHeaders: Record<string, string> | undefined,
    probe: AudioProbeResult,
    hint: AudioSessionPlayRequest['probe'] | undefined,
    provided: TrackTransitionAnalysis | null | undefined,
  ): Promise<TrackTransitionAnalysis> {
    if (provided) {
      return provided;
    }

    const analysisHint = createAutomixAnalysisHint(hint);
    const analysisRequest = {
      filePath,
      probe,
      headers: inputHeaders,
      hint: analysisHint,
    };
    const cached = this.automixAnalyzer.getCachedAnalysis?.(analysisRequest) ?? null;
    if (cached) {
      return cached;
    }

    const estimated = createEstimatedAutomixAnalysis(probe, analysisHint);
    void this.automixAnalyzer.analyze(analysisRequest).catch((error) => {
      this.logger(`[AudioSession] Automix background analysis skipped: ${error instanceof Error ? error.message : String(error)}`);
    });
    return estimated;
  }

  private unavailableAutomixAnalysisV2(
    probe: AudioProbeResult,
    reason: string,
  ): AutomixAnalysisV2 {
    return {
      version: automixAnalysisVersion,
      fingerprint: `${probe.filePath}:${probe.durationSeconds}`,
      status: 'unavailable',
      durationSeconds: Math.max(0, probe.durationSeconds),
      bpm: null,
      bpmConfidence: null,
      beatOffsetMs: null,
      beatGridSeconds: [],
      downbeatGridSeconds: [],
      phraseBoundaries: [],
      key: null,
      leadingSilenceSeconds: 0,
      trailingSilenceSeconds: 0,
      integratedLufs: null,
      segmentRmsDb: [],
      energyCurve: [],
      analyzedAt: null,
      error: reason,
    };
  }

  private async prepareDaemonAutomixV2(
    request: AudioSessionPlayRequest,
    currentProbe: AudioProbeResult,
    backend: DaemonAudioBackend,
    token: number,
    sampleRatePlan: SampleRatePlan,
  ): Promise<void> {
    const next = request.automix?.enabled === true ? request.automix.next ?? null : null;
    if (!next || automixV2Phase === 'off') {
      return;
    }

    const currentIndex = this.queueSnapshot.items.findIndex((item) =>
      (this.currentQueueItemId !== null && item.itemId === this.currentQueueItemId)
      || item.trackId === (request.trackId ?? request.filePath)
      || item.filePath === request.filePath,
    );
    let nextIndex = currentIndex + 1;
    if (nextIndex >= this.queueSnapshot.items.length && this.queueSnapshot.repeatMode === 'all') {
      nextIndex = 0;
    }
    const currentQueueItem = currentIndex >= 0 ? this.queueSnapshot.items[currentIndex] : null;
    const nextQueueItem = nextIndex >= 0 && nextIndex < this.queueSnapshot.items.length
      ? this.queueSnapshot.items[nextIndex]
      : null;
    const requestedNextTrackId = next.trackId ?? next.filePath;
    if (!currentQueueItem || !nextQueueItem
      || (nextQueueItem.trackId !== requestedNextTrackId && nextQueueItem.filePath !== next.filePath)) {
      this.addOutputWarning('automix_v2_queue_identity_unavailable');
      return;
    }

    const nextProbe = await this.resolveAutomixNextProbe(next).catch((error) => {
      this.addOutputWarning('automix_v2_next_probe_failed');
      this.logger(`[AudioSession] AutoMix V2 next probe failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (!nextProbe || this.runToken !== token) {
      return;
    }

    const analyzeV2 = this.automixAnalyzer.analyzeV2?.bind(this.automixAnalyzer);
    const [currentAnalysis, nextAnalysis] = analyzeV2
      ? await Promise.all([
          analyzeV2({
            filePath: request.filePath,
            probe: currentProbe,
            headers: request.inputHeaders,
            hint: createAutomixAnalysisHint(request.probe),
            trackId: request.trackId,
          }),
          analyzeV2({
            filePath: next.filePath,
            probe: nextProbe,
            headers: next.inputHeaders,
            hint: createAutomixAnalysisHint(next.probe),
            trackId: next.trackId,
          }),
        ])
      : [
          this.unavailableAutomixAnalysisV2(currentProbe, 'v2_analyzer_unavailable'),
          this.unavailableAutomixAnalysisV2(nextProbe, 'v2_analyzer_unavailable'),
        ];
    if (this.runToken !== token) {
      return;
    }

    const mixSampleRate = normalizeAudioSampleRate(
      this.currentPlan?.actualDeviceSampleRate
        ?? this.currentReadyResult?.actualDeviceSampleRate
        ?? sampleRatePlan.requestedOutputSampleRate,
    ) ?? 48_000;
    const currentSourcePositionSeconds = Math.max(
      request.startSeconds ?? 0,
      backend.getPositionSeconds(),
    );
    const currentOutputFrame = Math.max(
      0,
      Math.round((currentSourcePositionSeconds - (request.startSeconds ?? 0)) * mixSampleRate),
    );
    const plan = planAutomixTransitionV2({
      queueRevision: this.queueSnapshot.revision,
      fromItemId: currentQueueItem.itemId,
      fromTrackId: currentQueueItem.trackId,
      toItemId: nextQueueItem.itemId,
      toTrackId: nextQueueItem.trackId,
      mixSampleRate,
      currentOutputFrame,
      currentSourcePositionSeconds,
      currentAnalysis,
      nextAnalysis,
      currentIsDsd: isDsdCodec(currentProbe.codec) || isDsdFilePath(request.filePath),
      nextIsDsd: isDsdCodec(nextProbe.codec) || isDsdFilePath(next.filePath),
      playbackRate: this.currentOutputSettings?.playbackRate ?? 1,
      maxTransitionSeconds: request.automix?.maxTransitionSeconds,
    });
    plan.currentReplayGainDb = this.calculateCurrentReplayGain().appliedDb;
    plan.nextReplayGainDb = this.calculateReplayGainForTrack(next.replayGain).appliedDb;
    this.recordPlaybackDiagnosticEvent('play_request', 'info', 'automix_v2_plan', {
      trackId: request.trackId ?? null,
      filePath: request.filePath,
      details: {
        phase: automixV2Phase,
        planId: plan.planId,
        mode: plan.mode,
        fallbackReason: plan.fallbackReason,
        queueRevision: plan.queueRevision,
      },
    });

    this.activeAutomixV2 = {
      state: plan.mode === 'gapless_fallback' ? 'fallback' : 'preparing',
      plan,
      nextFilePath: next.filePath,
      nextInputHeaders: next.inputHeaders ?? null,
      nextMetadata: next.metadata ?? null,
      nextProbe,
      nextReplayGain: next.replayGain ?? null,
    };
    if (!automixV2NativeEnabled) {
      this.activeAutomixV2.state = plan.mode === 'gapless_fallback' ? 'fallback' : 'idle';
      this.addOutputWarning(`automix_v2_shadow:${plan.mode}`);
      return;
    }

    const bypassReason = sampleRatePlan.dsdOutputMode !== 'pcm'
      ? 'dsd_direct'
      : sampleRatePlan.sdmPcmToDsdActive
        ? 'sdm_active'
        : Math.abs((this.currentOutputSettings?.playbackRate ?? 1) - 1) > 1e-6
          ? 'playback_rate_active'
          : plan.mode === 'gapless_fallback'
            ? plan.fallbackReason ?? 'gapless_fallback'
            : null;
    if (bypassReason) {
      this.activeAutomixV2.state = 'fallback';
      this.addOutputWarning(`automix_v2_bypassed:${bypassReason}`);
      return;
    }

    try {
      const result = await backend.prepareAutomixV2({
        plan,
        nextSource: normalizeAudioInputSource({
          kind: isHttpPlaybackUrl(next.filePath) ? 'http' : 'local',
          uri: next.filePath,
          headers: next.inputHeaders,
          mimeType: next.mimeType,
        }),
      });
      if (this.runToken !== token || this.activeAutomixV2?.plan.planId !== plan.planId) {
        await backend.cancelAutomixV2(plan.planId).catch(() => undefined);
        return;
      }
      this.activeAutomixV2.state = result.state;
      if (result.state === 'fallback') {
        this.addOutputWarning(`automix_v2_fallback:${result.reason ?? 'unknown'}`);
      }
    } catch (error) {
      if (this.activeAutomixV2?.plan.planId === plan.planId) {
        this.activeAutomixV2.state = 'fallback';
      }
      const reason = error instanceof Error ? error.message.slice(0, 96) : 'unknown';
      this.addOutputWarning(`automix_v2_prepare_failed:${reason}`);
      this.logger(`[AudioSession] AutoMix V2 prepare failed closed: ${reason}`);
    }
  }

  private createGaplessTransitionPlan(
    currentStartSeconds: number,
    currentProbe: AudioProbeResult,
    nextProbe: AudioProbeResult,
  ): AutomixTransitionPlan | null {
    const currentDuration = Math.max(0, currentProbe.durationSeconds);
    const nextDuration = Math.max(0, nextProbe.durationSeconds);
    if (currentDuration - currentStartSeconds < 0.25 || nextDuration < 0.25) {
      return null;
    }

    return {
      mode: 'gaplessFallback',
      currentStartSeconds,
      currentEndSeconds: currentDuration,
      currentFadeStartSeconds: currentDuration,
      nextStartSeconds: 0,
      overlapSeconds: 0.001,
      curve: 'tri',
      currentGainDb: 0,
      nextGainDb: 0,
      tempoRatio: 1,
      advanceAtSeconds: Math.max(0, currentDuration - currentStartSeconds),
      skipIntroSilence: false,
      beatAligned: false,
      fallbackReason: null,
    };
  }

  private createGaplessTransition(
    fromTrackId: string | null,
    next: AudioSessionGaplessNextTrack,
    nextProbe: AudioProbeResult,
    transitionStartSeconds: number,
    trackStartSourceSeconds: number,
    plan: AutomixTransitionPlan,
  ): ActiveAutomixTransition {
    return {
      fromTrackId,
      nextTrackId: next.trackId ?? next.filePath,
      nextFilePath: next.filePath,
      nextInputHeaders: next.inputHeaders ?? null,
      nextProbe,
      nextReplayGain: next.replayGain ?? null,
      transitionSeconds: 0,
      transitionStartSeconds,
      trackStartOutputSeconds: transitionStartSeconds,
      trackStartSourceSeconds,
      plan,
    };
  }

  private async createNativeAutomixPlayback(
    request: AudioSessionPlayRequest,
    currentProbe: AudioProbeResult,
    plan: SampleRatePlan,
    outputSettings: AudioOutputSettings,
    bridge: OutputBridgeLike,
  ): Promise<NativeAutomixPlayback | null> {
    const automix = request.automix;
    const next = automix?.next ?? null;
    if (
      !nativeAutomixDualDeckEnabled ||
      automix?.enabled !== true ||
      !next ||
      (automix.following?.length ?? 0) > 0 ||
      typeof bridge.prepareAutomixPlan !== 'function' ||
      typeof bridge.createAutomixNextWritable !== 'function' ||
      outputSettings.playbackRate !== 1 ||
      plan.dsdOutputMode !== 'pcm' ||
      plan.sdmPcmToDsdActive === true ||
      isDsdCodec(currentProbe.codec) ||
      isDsdFilePath(request.filePath)
    ) {
      return null;
    }

    const currentStartSeconds = Math.max(0, request.startSeconds ?? 0);
    const currentRemainingSeconds = Math.max(0, currentProbe.durationSeconds - currentStartSeconds);
    if (currentRemainingSeconds < 4) {
      return null;
    }
    const lateArmThresholdSeconds = Math.max(0, currentProbe.durationSeconds - nativeAutomixDualDeckLateArmWindowSeconds);
    if (currentStartSeconds <= 0 || currentStartSeconds < lateArmThresholdSeconds) {
      return null;
    }

    const nextProbe = await this.resolveAutomixNextProbe(next);
    if (nextProbe.durationSeconds < 4 || isDsdCodec(nextProbe.codec) || isDsdFilePath(next.filePath)) {
      return null;
    }

    const [currentAnalysis, nextAnalysis] = await Promise.all([
      this.resolveAutomixAnalysis(
        request.filePath,
        request.inputHeaders,
        currentProbe,
        request.probe,
        automix.currentAnalysis,
      ),
      this.resolveAutomixAnalysis(
        next.filePath,
        next.inputHeaders,
        nextProbe,
        next.probe,
        automix.nextAnalysis,
      ),
    ]);
    const transitionPlan = planAutomixTransition({
      currentProbe,
      nextProbe,
      currentStartSeconds,
      currentAnalysis,
      nextAnalysis,
      currentHint: createAutomixAnalysisHint(request.probe),
      nextHint: createAutomixAnalysisHint(next.probe),
      maxTransitionSeconds: clampAutomixTransitionSeconds(automix.maxTransitionSeconds),
      beatAlignEnabled: automix.beatAlignEnabled !== false,
    });
    if (!transitionPlan) {
      return null;
    }

    const currentDecodeRequest = this.createDecodeRequest(
      request.filePath,
      request.inputHeaders,
      transitionPlan.currentStartSeconds,
      currentProbe.channels,
      plan,
      outputSettings,
    );
    currentDecodeRequest.durationSeconds = Math.max(0.001, transitionPlan.currentEndSeconds - transitionPlan.currentStartSeconds);
    const nextDecodeRequest = this.createDecodeRequest(
      next.filePath,
      next.inputHeaders,
      transitionPlan.nextStartSeconds,
      currentProbe.channels,
      plan,
      outputSettings,
    );
    if (transitionPlan.beatAligned && Math.abs(transitionPlan.tempoRatio - 1) >= 0.001) {
      nextDecodeRequest.tempoRatio = transitionPlan.tempoRatio;
    }
    const transitionStartSeconds = Math.max(0, transitionPlan.currentFadeStartSeconds - transitionPlan.currentStartSeconds);
    const transition: ActiveAutomixTransition = {
      fromTrackId: request.trackId ?? null,
      nextTrackId: this.getAutomixCandidateTrackId(next) ?? next.filePath,
      nextFilePath: next.filePath,
      nextInputHeaders: next.inputHeaders ?? null,
      nextProbe,
      nextReplayGain: next.replayGain ?? null,
      transitionSeconds: transitionPlan.overlapSeconds,
      transitionStartSeconds,
      trackStartOutputSeconds: transitionStartSeconds,
      trackStartSourceSeconds: transitionPlan.nextStartSeconds,
      plan: transitionPlan,
    };
    const compositeDurationSeconds = transitionStartSeconds + Math.max(0, nextProbe.durationSeconds - transitionPlan.nextStartSeconds);

    return {
      currentRun: this.decoder.decodeLocalFile(currentDecodeRequest),
      nextRun: this.decoder.decodeLocalFile(nextDecodeRequest),
      state: {
        enabled: true,
        gapless: false,
        nextTransitionIndex: 0,
        fromTrackId: request.trackId ?? null,
        nextTrackId: next.trackId ?? next.filePath,
        nextFilePath: next.filePath,
        nextInputHeaders: next.inputHeaders ?? null,
        nextProbe,
        nextReplayGain: next.replayGain ?? null,
        transitionSeconds: transitionPlan.overlapSeconds,
        transitionStartSeconds,
        compositeStartSeconds: transitionPlan.currentStartSeconds,
        compositeDurationSeconds,
        plan: transitionPlan,
        transitions: [transition],
      },
    };
  }

  private async createNativeGaplessPlayback(
    request: AudioSessionPlayRequest,
    currentProbe: AudioProbeResult,
    plan: SampleRatePlan,
    outputSettings: AudioOutputSettings,
    bridge: OutputBridgeLike,
  ): Promise<NativeAutomixPlayback | null> {
    const gapless = request.gapless;
    const next = gapless?.next ?? null;
    if (
      request.automix?.enabled === true ||
      gapless?.enabled !== true ||
      !next ||
      (gapless.following?.length ?? 0) > 0 ||
      typeof bridge.prepareAutomixPlan !== 'function' ||
      typeof bridge.createAutomixNextWritable !== 'function' ||
      outputSettings.playbackRate !== 1 ||
      plan.dsdOutputMode !== 'pcm' ||
      plan.sdmPcmToDsdActive === true ||
      isDsdCodec(currentProbe.codec) ||
      isDsdFilePath(request.filePath)
    ) {
      return null;
    }

    const currentStartSeconds = Math.max(0, request.startSeconds ?? 0);
    const nextProbe = await this.resolveAutomixNextProbe(next);
    if (isDsdCodec(nextProbe.codec) || isDsdFilePath(next.filePath)) {
      return null;
    }

    const transitionPlan = this.createGaplessTransitionPlan(currentStartSeconds, currentProbe, nextProbe);
    if (!transitionPlan) {
      return null;
    }

    const currentDecodeRequest = this.createDecodeRequest(
      request.filePath,
      request.inputHeaders,
      currentStartSeconds,
      currentProbe.channels,
      plan,
      outputSettings,
    );
    const nextDecodeRequest = this.createDecodeRequest(
      next.filePath,
      next.inputHeaders,
      0,
      currentProbe.channels,
      plan,
      outputSettings,
    );
    const transitionStartSeconds = Math.max(0, currentProbe.durationSeconds - currentStartSeconds);
    const transition = this.createGaplessTransition(
      request.trackId ?? null,
      next,
      nextProbe,
      transitionStartSeconds,
      0,
      transitionPlan,
    );

    return {
      currentRun: this.decoder.decodeLocalFile(currentDecodeRequest),
      nextRun: this.decoder.decodeLocalFile(nextDecodeRequest),
      state: {
        enabled: true,
        gapless: true,
        nextTransitionIndex: 0,
        fromTrackId: request.trackId ?? null,
        nextTrackId: next.trackId ?? next.filePath,
        nextFilePath: next.filePath,
        nextInputHeaders: next.inputHeaders ?? null,
        nextProbe,
        nextReplayGain: next.replayGain ?? null,
        transitionSeconds: 0,
        transitionStartSeconds,
        compositeStartSeconds: currentStartSeconds,
        compositeDurationSeconds: transitionStartSeconds + nextProbe.durationSeconds,
        plan: transitionPlan,
        transitions: [transition],
      },
    };
  }

  private async createAutomixDecoderRunForPlayback(
    request: AudioSessionPlayRequest,
    currentProbe: AudioProbeResult,
    plan: SampleRatePlan,
    outputSettings: AudioOutputSettings,
  ): Promise<{ run: DecoderRun; state: ActiveAutomixState } | null> {
    const automix = request.automix;
    const next = automix?.next ?? null;
    if (
      automix?.enabled !== true ||
      !next ||
      !this.decoder.decodeAutomixPair ||
      outputSettings.playbackRate !== 1 ||
      plan.dsdOutputMode !== 'pcm'
    ) {
      return null;
    }

    const currentStartSeconds = Math.max(0, request.startSeconds ?? 0);
    const currentRemainingSeconds = Math.max(0, currentProbe.durationSeconds - currentStartSeconds);
    if (currentRemainingSeconds < 4) {
      return null;
    }

    const candidates = [next, ...(automix.following ?? [])].slice(0, 4);
    const resolvedCandidates: Array<{
      track: AudioSessionAutomixNextTrack;
      probe: AudioProbeResult;
      analysis: TrackTransitionAnalysis;
    }> = [];
    for (const candidate of candidates) {
      const candidateProbe = await this.resolveAutomixNextProbe(candidate);
      if (candidateProbe.durationSeconds < 4 || isDsdCodec(candidateProbe.codec) || isDsdFilePath(candidate.filePath)) {
        continue;
      }

      const candidateAnalysis = await this.resolveAutomixAnalysis(
        candidate.filePath,
        candidate.inputHeaders,
        candidateProbe,
        candidate.probe,
        candidate === next ? automix.nextAnalysis : null,
      );
      resolvedCandidates.push({
        track: candidate,
        probe: candidateProbe,
        analysis: candidateAnalysis,
      });
    }
    const firstCandidate = resolvedCandidates[0];
    if (!firstCandidate) {
      return null;
    }

    const currentAnalysis = await this.resolveAutomixAnalysis(
      request.filePath,
      request.inputHeaders,
      currentProbe,
      request.probe,
      automix.currentAnalysis,
    );
    const transitionPlans: AutomixTransitionPlan[] = [];
    let previousProbe = currentProbe;
    let previousAnalysis = currentAnalysis;
    let previousHint = request.probe;
    let previousStartSeconds = currentStartSeconds;
    for (const candidate of resolvedCandidates) {
      const transitionPlan = planAutomixTransition({
        currentProbe: previousProbe,
        nextProbe: candidate.probe,
        currentStartSeconds: previousStartSeconds,
        currentAnalysis: previousAnalysis,
        nextAnalysis: candidate.analysis,
        currentHint: createAutomixAnalysisHint(previousHint),
        nextHint: createAutomixAnalysisHint(candidate.track.probe),
        maxTransitionSeconds: clampAutomixTransitionSeconds(automix.maxTransitionSeconds),
        beatAlignEnabled: automix.beatAlignEnabled !== false,
      });
      if (!transitionPlan) {
        break;
      }

      transitionPlans.push(transitionPlan);
      previousProbe = candidate.probe;
      previousAnalysis = candidate.analysis;
      previousHint = candidate.track.probe;
      previousStartSeconds = transitionPlan.nextStartSeconds;
    }
    const transitionPlan = transitionPlans[0];
    if (!transitionPlan) {
      return null;
    }

    const currentDecodeRequest = this.createDecodeRequest(
      request.filePath,
      request.inputHeaders,
      transitionPlan.currentStartSeconds,
      currentProbe.channels,
      plan,
      outputSettings,
    );
    currentDecodeRequest.replayGainDb = this.calculateCurrentReplayGain().appliedDb;
    const nextDecodeRequest = this.createDecodeRequest(
      firstCandidate.track.filePath,
      firstCandidate.track.inputHeaders,
      transitionPlan.nextStartSeconds,
      currentProbe.channels,
      plan,
      outputSettings,
    );
    nextDecodeRequest.replayGainDb = this.calculateReplayGainForTrack(firstCandidate.track.replayGain).appliedDb;
    const followingDecodeRequests = resolvedCandidates.slice(1, transitionPlans.length).map((candidate, index) => ({
      track: {
        ...this.createDecodeRequest(
          candidate.track.filePath,
          candidate.track.inputHeaders,
          transitionPlans[index + 1].nextStartSeconds,
          currentProbe.channels,
          plan,
          outputSettings,
        ),
        durationSeconds: candidate.probe.durationSeconds,
        replayGainDb: this.calculateReplayGainForTrack(candidate.track.replayGain).appliedDb,
      },
      plan: transitionPlans[index + 1],
    }));
    this.currentDecodeBackendImpl = 'ffmpeg-automix';
    const run = this.decoder.decodeAutomixPair({
      current: {
        ...currentDecodeRequest,
        durationSeconds: currentProbe.durationSeconds,
      },
      next: {
        ...nextDecodeRequest,
        durationSeconds: firstCandidate.probe.durationSeconds,
      },
      plan: transitionPlan,
      following: followingDecodeRequests,
    });
    const trackStartOutputSeconds = [0];
    const trackStartSourceSeconds = [transitionPlan.currentStartSeconds];
    const transitions: ActiveAutomixTransition[] = [];
    for (let index = 0; index < transitionPlans.length; index += 1) {
      const activePlan = transitionPlans[index];
      const candidate = resolvedCandidates[index];
      const sourceStartSeconds = index === 0 ? transitionPlan.currentStartSeconds : transitionPlans[index - 1].nextStartSeconds;
      const transitionStartSeconds = trackStartOutputSeconds[index] + Math.max(0, activePlan.currentFadeStartSeconds - sourceStartSeconds);
      transitions.push({
        fromTrackId: index === 0
          ? request.trackId ?? null
          : this.getAutomixCandidateTrackId(resolvedCandidates[index - 1]?.track),
        nextTrackId: this.getAutomixCandidateTrackId(candidate.track) ?? candidate.track.filePath,
        nextFilePath: candidate.track.filePath,
        nextInputHeaders: candidate.track.inputHeaders ?? null,
        nextProbe: candidate.probe,
        nextReplayGain: candidate.track.replayGain ?? null,
        transitionSeconds: activePlan.overlapSeconds,
        transitionStartSeconds,
        trackStartOutputSeconds: transitionStartSeconds,
        trackStartSourceSeconds: activePlan.nextStartSeconds,
        plan: activePlan,
      });
      trackStartOutputSeconds[index + 1] = transitionStartSeconds;
      trackStartSourceSeconds[index + 1] = activePlan.nextStartSeconds;
    }
    const lastCandidate = resolvedCandidates[transitionPlans.length - 1];
    const lastTrackOutputStartSeconds = trackStartOutputSeconds[transitionPlans.length] ?? 0;
    const lastTrackSourceStartSeconds = trackStartSourceSeconds[transitionPlans.length] ?? 0;
    const compositeDurationSeconds = lastTrackOutputStartSeconds + Math.max(0, lastCandidate.probe.durationSeconds - lastTrackSourceStartSeconds);

    return {
      run,
      state: {
        enabled: true,
        gapless: false,
        nextTransitionIndex: 0,
        fromTrackId: request.trackId ?? null,
        nextTrackId: firstCandidate.track.trackId ?? firstCandidate.track.filePath,
        nextFilePath: firstCandidate.track.filePath,
        nextInputHeaders: firstCandidate.track.inputHeaders ?? null,
        nextProbe: firstCandidate.probe,
        nextReplayGain: firstCandidate.track.replayGain ?? null,
        transitionSeconds: transitionPlan.overlapSeconds,
        transitionStartSeconds: transitions[0]?.transitionStartSeconds ?? 0,
        compositeStartSeconds: transitionPlan.currentStartSeconds,
        compositeDurationSeconds,
        plan: transitionPlan,
        transitions,
      },
    };
  }

  private async createGaplessDecoderRunForPlayback(
    request: AudioSessionPlayRequest,
    currentProbe: AudioProbeResult,
    plan: SampleRatePlan,
    outputSettings: AudioOutputSettings,
  ): Promise<{ run: DecoderRun; state: ActiveAutomixState } | null> {
    const gapless = request.gapless;
    const next = gapless?.next ?? null;
    if (
      gapless?.enabled !== true ||
      !next ||
      !this.decoder.decodeGaplessSequence ||
      outputSettings.playbackRate !== 1 ||
      plan.dsdOutputMode !== 'pcm' ||
      isDsdCodec(currentProbe.codec) ||
      isDsdFilePath(request.filePath)
    ) {
      return null;
    }

    const currentStartSeconds = Math.max(0, request.startSeconds ?? 0);
    const candidates = [next];
    const resolvedCandidates: Array<{
      track: AudioSessionGaplessNextTrack;
      probe: AudioProbeResult;
    }> = [];
    for (const candidate of candidates) {
      const candidateProbe = await this.resolveAutomixNextProbe(candidate);
      if (candidateProbe.durationSeconds < 0.25 || isDsdCodec(candidateProbe.codec) || isDsdFilePath(candidate.filePath)) {
        break;
      }
      resolvedCandidates.push({ track: candidate, probe: candidateProbe });
    }

    const firstCandidate = resolvedCandidates[0];
    if (!firstCandidate) {
      return null;
    }

    const firstPlan = this.createGaplessTransitionPlan(currentStartSeconds, currentProbe, firstCandidate.probe);
    if (!firstPlan) {
      return null;
    }

    const currentDecodeRequest = this.createDecodeRequest(
      request.filePath,
      request.inputHeaders,
      currentStartSeconds,
      currentProbe.channels,
      plan,
      outputSettings,
    );
    currentDecodeRequest.replayGainDb = this.calculateCurrentReplayGain().appliedDb;

    const nextDecodeRequest = this.createDecodeRequest(
      firstCandidate.track.filePath,
      firstCandidate.track.inputHeaders,
      0,
      currentProbe.channels,
      plan,
      outputSettings,
    );
    nextDecodeRequest.replayGainDb = this.calculateReplayGainForTrack(firstCandidate.track.replayGain).appliedDb;

    const followingDecodeRequests = resolvedCandidates.slice(1).map((candidate) => {
      const decodeRequest = this.createDecodeRequest(
        candidate.track.filePath,
        candidate.track.inputHeaders,
        0,
        currentProbe.channels,
        plan,
        outputSettings,
      );
      decodeRequest.replayGainDb = this.calculateReplayGainForTrack(candidate.track.replayGain).appliedDb;
      return {
        ...decodeRequest,
        durationSeconds: candidate.probe.durationSeconds,
      };
    });

    const run = this.decoder.decodeGaplessSequence({
      current: {
        ...currentDecodeRequest,
        durationSeconds: currentProbe.durationSeconds,
      },
      next: {
        ...nextDecodeRequest,
        durationSeconds: firstCandidate.probe.durationSeconds,
      },
      following: followingDecodeRequests,
    });
    run.decoderBackendImpl = 'ffmpeg-gapless';
    this.currentDecodeBackendImpl = 'ffmpeg-gapless';

    const transitions: ActiveAutomixTransition[] = [];
    let trackStartOutputSeconds = Math.max(0, currentProbe.durationSeconds - currentStartSeconds);
    let previousTrackId: string | null = request.trackId ?? null;
    let previousProbe = currentProbe;
    let previousStartSeconds = currentStartSeconds;
    for (const candidate of resolvedCandidates) {
      const transitionPlan = transitions.length === 0
        ? firstPlan
        : this.createGaplessTransitionPlan(previousStartSeconds, previousProbe, candidate.probe);
      if (!transitionPlan) {
        break;
      }
      transitions.push(this.createGaplessTransition(
        previousTrackId,
        candidate.track,
        candidate.probe,
        trackStartOutputSeconds,
        0,
        transitionPlan,
      ));
      previousTrackId = candidate.track.trackId ?? candidate.track.filePath;
      previousProbe = candidate.probe;
      previousStartSeconds = 0;
      trackStartOutputSeconds += candidate.probe.durationSeconds;
    }

    return {
      run,
      state: {
        enabled: true,
        gapless: true,
        nextTransitionIndex: 0,
        fromTrackId: request.trackId ?? null,
        nextTrackId: firstCandidate.track.trackId ?? firstCandidate.track.filePath,
        nextFilePath: firstCandidate.track.filePath,
        nextInputHeaders: firstCandidate.track.inputHeaders ?? null,
        nextProbe: firstCandidate.probe,
        nextReplayGain: firstCandidate.track.replayGain ?? null,
        transitionSeconds: 0,
        transitionStartSeconds: transitions[0]?.transitionStartSeconds ?? 0,
        compositeStartSeconds: currentStartSeconds,
        compositeDurationSeconds: trackStartOutputSeconds,
        plan: firstPlan,
        transitions,
      },
    };
  }

  private resolvePlanDeviceForSettings(outputSettings: AudioOutputSettings): AudioDeviceInfo | null {
    const outputMode = normalizeOutputMode(outputSettings.outputMode);
    if (outputMode === 'exclusive') {
      const resolvedDevice = this.resolveSelectedDevice(outputSettings);
      if (resolvedDevice) {
        return resolvedDevice;
      }

      if (!hasExplicitDeviceSelection(outputSettings)) {
        if (this.platform === 'darwin') {
          return this.resolveDefaultSharedDevice();
        }
        const defaultExclusiveDevice = this.deviceService.listDevices().find(
          (device) => device.outputMode === 'exclusive' && device.isDefault,
        );
        if (defaultExclusiveDevice) {
          return defaultExclusiveDevice;
        }
      }
    }
    const explicitDevice = createDeviceFromOutputSettings(outputSettings);

    if (explicitDevice) {
      return explicitDevice;
    }

    return outputMode === 'shared' ? this.resolveDefaultSharedDevice() : null;
  }

  private async resolvePlaybackDeviceForSettings(outputSettings: AudioOutputSettings): Promise<AudioDeviceInfo | null> {
    const resolvedDevice = this.resolvePlanDeviceForSettings(outputSettings);
    if (
      normalizeOutputMode(outputSettings.outputMode) !== 'exclusive' ||
      (resolvedDevice?.sampleRate && resolvedDevice.sharedDeviceSampleRate)
    ) {
      return resolvedDevice;
    }

    const listDevicesAsync = this.deviceService.listDevicesAsync;
    if (!listDevicesAsync) {
      return resolvedDevice;
    }

    try {
      const devices = await listDevicesAsync.call(this.deviceService);
      const selectedDevice = this.resolveSelectedDevice(outputSettings, devices);
      if (selectedDevice) {
        return selectedDevice;
      }

      if (!hasExplicitDeviceSelection(outputSettings)) {
        return devices.find((device) => device.outputMode === 'exclusive' && device.isDefault) ?? resolvedDevice;
      }

      return resolvedDevice;
    } catch (error) {
      this.logger(`[AudioSession] exclusive device capability refresh failed: ${
        error instanceof Error ? error.message : String(error)
      }`);
      return resolvedDevice;
    }
  }

  private createLocalPrepareContext(
    filePath: string,
    trackId: string | undefined,
    probe: AudioSessionPrepareLocalFileRequest['probe'] | undefined,
    output: AudioOutputSettings | undefined = undefined,
  ): LocalPrepareContext {
    const outputSettings = this.createOutputSettingsForRequest(output);
    const outputMode = normalizeOutputMode(outputSettings.outputMode);
    const device = this.resolvePlanDeviceForSettings(outputSettings);
    const sampleRateProbe = createProbeFromHint(filePath, probe) ?? {
      filePath,
      durationSeconds: probe?.durationSeconds ?? 1,
      fileSampleRate: probe?.fileSampleRate ?? null,
      channels: probe?.channels ?? 2,
      codec: probe?.codec ?? null,
      bitDepth: probe?.bitDepth ?? null,
      bitrate: probe?.bitrate ?? null,
    };
    const plan = this.createSampleRatePlan(sampleRateProbe, outputSettings, device);
    const deviceIdentity = device
      ? `${device.outputMode}:${device.index}:${device.name}`
      : `${outputMode}:default:${outputSettings.deviceIndex ?? ''}:${outputSettings.deviceName ?? ''}`;

    return {
      outputSettings,
      device,
      key: JSON.stringify({
        filePath,
        trackId: trackId ?? null,
        outputMode,
        sharedBackend: outputMode === 'shared' ? normalizeSharedBackend(outputSettings.sharedBackend) : null,
        deviceIdentity,
        requestedOutputSampleRate: plan.requestedOutputSampleRate,
        playbackSpeedMode: outputSettings.playbackSpeedMode ?? null,
      }),
    };
  }

  private prunePreparedLocalPlaybackCache(now = Date.now()): void {
    for (const [key, item] of this.preparedLocalPlaybackCache.entries()) {
      if (item.expiresAt <= now) {
        this.preparedLocalPlaybackCache.delete(key);
      }
    }
  }

  private storePreparedLocalPlayback(key: string, item: PreparedLocalPlaybackItem): void {
    this.prunePreparedLocalPlaybackCache(item.preparedAt);
    this.preparedLocalPlaybackCache.delete(key);
    this.preparedLocalPlaybackCache.set(key, item);

    while (this.preparedLocalPlaybackCache.size > preparedLocalPlaybackMaxItems) {
      const oldestKey = this.preparedLocalPlaybackCache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }

      this.preparedLocalPlaybackCache.delete(oldestKey);
    }
  }

  private takePreparedLocalProbe(
    request: AudioSessionPlayRequest,
    outputSettings: AudioOutputSettings,
  ): PreparedLocalProbeUse | null {
    const context = this.createLocalPrepareContext(request.filePath, request.trackId, request.probe, outputSettings);
    const now = Date.now();
    this.prunePreparedLocalPlaybackCache(now);
    const cached = this.preparedLocalPlaybackCache.get(context.key);

    if (!cached) {
      if (verboseAudioLogsEnabled) {
        this.logger(JSON.stringify({
          event: 'local_prepare_cache_miss',
          filePath: redactUrlSecrets(request.filePath),
          trackId: request.trackId ?? null,
        }));
      }
      return null;
    }

    this.preparedLocalPlaybackCache.delete(context.key);
    this.preparedLocalPlaybackCache.set(context.key, cached);
    const ageMs = Math.max(0, now - cached.preparedAt);
    if (verboseAudioLogsEnabled) {
      this.logger(JSON.stringify({
        event: 'local_prepare_cache_hit',
        filePath: redactUrlSecrets(request.filePath),
        trackId: request.trackId ?? null,
        cacheAgeMs: ageMs,
      }));
    }

    return {
      probe: mergeProbeHints(request.probe, cached.probe),
      ageMs,
    };
  }

  private createSampleRatePlan(
    probe: AudioProbeResult,
    outputSettings: AudioOutputSettings,
    selectedDevice: AudioDeviceInfo | null,
    actualDeviceSampleRate: number | null = null,
    planOptions: { residentOutputSampleRate?: number | null } = {},
  ): SampleRatePlan {
    const outputMode = normalizeOutputMode(outputSettings.outputMode);
    const fileSampleRate = normalizeAudioSampleRate(probe.fileSampleRate);
    const sourceSampleRate = fileSampleRate ?? fallbackSampleRate;
    const preferredFfmpegResampler = this.getPreferredFfmpegResamplerEngine();
    const dsdPcmOutputSampleRate = resolveDsdPcmOutputSampleRate(probe);
    const dsdDopTransportSampleRate = shouldAttemptDsdDop(
      probe.filePath,
      this.currentInputHeaders,
      probe,
      outputSettings,
      outputMode,
    )
      ? resolveDsdDopTransportSampleRate(probe)
      : null;
    const asioNativeDsdSampleRate = !this.asioNativeDsdDisabledForCurrentPlayback && shouldAttemptAsioNativeDsd(
      probe.filePath,
      this.currentInputHeaders,
      probe,
      outputSettings,
      outputMode,
    )
      ? fileSampleRate
      : null;
    const dsdOutputMode: Exclude<ActiveDsdOutputMode, null> = asioNativeDsdSampleRate
      ? 'native'
      : dsdDopTransportSampleRate
        ? 'dop'
        : 'pcm';
    const sourceOutputSampleRate = asioNativeDsdSampleRate ?? dsdDopTransportSampleRate ?? dsdPcmOutputSampleRate ?? sourceSampleRate;
    const sdmMode = normalizeSdmMode(outputSettings.sdmMode);
    const sdmTargetRate = normalizeSdmTargetRate(outputSettings.sdmTargetRate);
    const sdmQualityProfile = normalizeSdmQualityProfile(outputSettings.sdmQualityProfile);
    const sdmComputeBackend = normalizeSdmComputeBackend(outputSettings.sdmComputeBackend);
    const sdmPcmToDsdRequested = sdmMode === 'pcmToDsd';
    const sdmExclusivePcmToDsdBlocked = false;
    const sdmOutputModeSupported = outputMode === 'exclusive' || outputMode === 'asio';
    const sdmTargetSupported = realtimePcmToSdmTargetRates.has(sdmTargetRate);
    const sdmChannelSupported = probe.channels >= 1 && probe.channels <= 2;
    const sdmPcmToDsdActive =
      sdmPcmToDsdRequested &&
      dsdOutputMode === 'pcm' &&
      !dsdPcmOutputSampleRate &&
      sdmOutputModeSupported &&
      sdmTargetSupported &&
      sdmChannelSupported;
    const sdmNativeSampleRate = sdmPcmToDsdActive ? resolveSdmNativeSampleRate(sdmTargetRate, sourceSampleRate) : null;
    const sdmTransportSampleRate = sdmPcmToDsdActive ? resolveSdmDopTransportSampleRate(sdmTargetRate, sourceSampleRate) : null;
    const sdmOutputFormat: SampleRatePlan['sdmOutputFormat'] = sdmPcmToDsdActive
      ? 'dop24le'
      : null;
    // The native host is the authority for the active compute backend. Keep
    // the planning phase unresolved until device.configure returns telemetry.
    const sdmActualComputeBackend: AudioSdmComputeBackend | null = null;
    const sdmOversamplingPlan = sdmPcmToDsdActive
      ? resolveSdmOversamplingPlan(
        sdmQualityProfile,
        sourceSampleRate,
        sdmTransportSampleRate,
        'echo-fir',
        {
          filterProfile1x: outputSettings.sdmOversamplingFilterProfile1x,
          filterProfileNx: outputSettings.sdmOversamplingFilterProfileNx,
        },
      )
      : null;
    const sdmOversamplingFilterProfile = sdmOversamplingPlan
      ? resolveSdmOversamplingEffectiveFilterProfile(sdmOversamplingPlan)
      : normalizeEchoSrcFilterProfile(outputSettings.sdmOversamplingFilterProfile1x ?? 'sinc-long');
    const sdmOversamplingFilterProfile1x = sdmOversamplingPlan?.filterProfile1x
      ?? normalizeEchoSrcFilterProfile(outputSettings.sdmOversamplingFilterProfile1x ?? 'sinc-long');
    const sdmOversamplingFilterProfileNx = sdmOversamplingPlan?.filterProfileNx
      ?? normalizeEchoSrcFilterProfile(outputSettings.sdmOversamplingFilterProfileNx ?? 'poly-sinc-hb');
    const sdmOversamplingFirActive = sdmPcmToDsdActive &&
      createEchoSrcFirStagePlans(
        sdmOversamplingFilterProfile,
        sourceSampleRate,
        sdmTransportSampleRate ?? sourceSampleRate,
      ).length > 0;
    const sdmOversamplingRuntime = sdmPcmToDsdActive
      ? createSdmOversamplingRuntimeStatus(sdmOversamplingPlan, {
        state: sdmComputeBackend === 'cuda' ? 'planned' : 'active',
        requestedBackend: sdmComputeBackend,
        activeBackend: sdmComputeBackend === 'cuda' ? null : 'cpu',
        fallbackReason: null,
      })
      : null;
    const sdmModulatorProfile = sdmPcmToDsdActive
      ? resolveSdmModulatorProfile(sdmQualityProfile)
      : null;
    const sdmBlockPlan = sdmPcmToDsdActive && sdmActualComputeBackend
      ? resolveSdmBlockPlan(sdmTargetRate)
      : null;
    const sdmNotRoutedReason = (() => {
      if (!sdmPcmToDsdRequested) {
        return null;
      }
      if (sdmExclusivePcmToDsdBlocked) {
        return 'sdm_pcm_to_dsd_native_dsd_required';
      }
      if (!sdmOutputModeSupported) {
        return 'sdm_pcm_to_dsd_requires_native_dsd_output';
      }
      if (dsdOutputMode !== 'pcm' || dsdPcmOutputSampleRate) {
        return 'sdm_pcm_to_dsd_bypassed_for_dsd_source';
      }
      if (!sdmChannelSupported) {
        return `sdm_pcm_to_dsd_channels_unsupported:${probe.channels}`;
      }
      if (!sdmTargetSupported) {
        return `sdm_pcm_to_dsd_target_unsupported:${sdmTargetRate}`;
      }

      return sdmPcmToDsdActive ? null : 'sdm_pcm_to_dsd_not_routed';
    })();
    const sdmRuntime =
      !sdmPcmToDsdRequested
        ? null
        : sdmPcmToDsdActive
          ? (() => {
              const state: AudioSdmRuntimeStatus['state'] = 'active';
              return createSdmRuntimeStatus(state, {
                targetRate: sdmTargetRate,
                nativeSampleRate: sdmNativeSampleRate,
                transportSampleRate: sdmTransportSampleRate,
                modulatorProfile: sdmModulatorProfile,
                requestedBackend: sdmComputeBackend,
                activeBackend: sdmComputeBackend === 'cuda' ? null : 'cpu',
                oversamplingPlan: sdmOversamplingPlan,
                oversamplingRuntime: sdmOversamplingRuntime,
                processingMode: sdmBlockPlan?.processingMode ?? null,
                batchFrames: sdmBlockPlan?.targetBatchFrames ?? null,
                maxBlockFrames: sdmBlockPlan?.maxBlockFrames ?? null,
                cudaActive: false,
                fallbackReason: null,
              });
            })()
          : createSdmRuntimeStatus('unavailable', {
            targetRate: sdmTargetRate,
            nativeSampleRate: null,
            transportSampleRate: null,
            modulatorProfile: null,
            requestedBackend: sdmComputeBackend,
            activeBackend: null,
            fallbackReason: sdmNotRoutedReason,
          });
    const explicitRequestedSampleRate = normalizeAudioSampleRate(outputSettings.requestedOutputSampleRate);
    const echoSrcMode = normalizeEchoSrcMode(outputSettings.echoSrcMode);
    const echoSrcQualityProfile = normalizeEchoSrcQualityProfile(outputSettings.echoSrcQualityProfile);
    const echoSrcAdvancedModeEnabled = outputSettings.echoSrcAdvancedModeEnabled === true;
    const echoSrcFirModeEnabled = echoSrcMode !== 'compatibility48' && echoSrcAdvancedModeEnabled;
    const echoSrcFilterSlot = resolveEchoSrcFilterSlot(sourceSampleRate);
    const echoSrcFilterProfile1x = normalizeEchoSrcFilterProfile(outputSettings.echoSrcFilterProfile1x ?? outputSettings.echoSrcFilterProfile);
    const echoSrcFilterProfileNx = normalizeEchoSrcFilterProfile(outputSettings.echoSrcFilterProfileNx ?? 'poly-sinc-hb');
    const echoSrcFilterProfile = resolveEchoSrcFilterProfileForSlot(echoSrcFilterSlot, {
      echoSrcFilterProfile: outputSettings.echoSrcFilterProfile,
      echoSrcFilterProfile1x,
      echoSrcFilterProfileNx,
    });
    const echoSrcComputeBackend = normalizeEchoSrcComputeBackend(outputSettings.echoSrcComputeBackend);
    const echoSrcOutputModeSupported = outputMode === 'exclusive' || outputMode === 'asio';
    const echoSrcTargetSampleRate =
      echoSrcMode !== 'off' &&
      echoSrcOutputModeSupported &&
      dsdOutputMode === 'pcm' &&
      !dsdPcmOutputSampleRate &&
      !sdmPcmToDsdActive
        ? resolveEchoSrcTargetSampleRate(echoSrcMode, sourceSampleRate)
        : null;
    const echoSrcActive = echoSrcTargetSampleRate !== null && echoSrcTargetSampleRate !== sourceOutputSampleRate;
    const echoSrcCudaActive = false;
    const echoSrcRequestedBackend = echoSrcMode === 'off'
      ? null
      : echoSrcFirModeEnabled
        ? echoSrcComputeBackend
        : preferredFfmpegResampler;
    const echoSrcRuntime: AudioEchoSrcRuntimeStatus | null =
      echoSrcMode === 'off'
        ? null
        : !echoSrcActive
          ? createEchoSrcRuntimeStatus('bypassed', {
            sourceSampleRate,
            targetSampleRate: echoSrcTargetSampleRate,
            filterProfile: echoSrcFirModeEnabled ? echoSrcFilterProfile : null,
            filterSlot: echoSrcFirModeEnabled ? echoSrcFilterSlot : null,
            qualityProfile: echoSrcQualityProfile,
            requestedBackend: echoSrcRequestedBackend,
            activeBackend: null,
          })
          : !echoSrcFirModeEnabled
            ? createEchoSrcRuntimeStatus('active', {
              sourceSampleRate,
              targetSampleRate: echoSrcTargetSampleRate,
              filterProfile: null,
              filterSlot: null,
              qualityProfile: echoSrcQualityProfile,
              requestedBackend: preferredFfmpegResampler,
              activeBackend: preferredFfmpegResampler,
            })
            : createEchoSrcRuntimeStatus(echoSrcComputeBackend === 'cuda' ? 'planned' : 'active', {
                sourceSampleRate,
                targetSampleRate: echoSrcTargetSampleRate,
                filterProfile: echoSrcFilterProfile,
                filterSlot: echoSrcFilterSlot,
                qualityProfile: echoSrcQualityProfile,
                requestedBackend: echoSrcComputeBackend,
                activeBackend: echoSrcComputeBackend === 'cuda' ? null : 'cpu',
                fallbackReason: null,
              });
    const residentOutputSampleRate =
      outputMode !== 'shared' ? normalizeAudioSampleRate(planOptions.residentOutputSampleRate) : null;
    const sharedDeviceSampleRate =
      normalizeAudioSampleRate(selectedDevice?.sharedDeviceSampleRate) ??
      (outputMode === 'shared' ? normalizeAudioSampleRate(selectedDevice?.sampleRate) : null);
    const currentReadySampleRate =
      outputMode === 'shared' ? normalizeAudioSampleRate(this.currentReadyResult?.actualDeviceSampleRate) : null;
    const sharedRequestedSampleRate =
      sharedDeviceSampleRate ?? currentReadySampleRate ?? fallbackSharedMixSampleRate;
    const cappedSharedRequestedSampleRate = capSharedOutputSampleRate(sharedRequestedSampleRate);
    const sdmOutputSampleRate = sdmTransportSampleRate;
    const requestedOutputSampleRate =
      residentOutputSampleRate ??
      (outputMode === 'shared'
        ? cappedSharedRequestedSampleRate
        : asioNativeDsdSampleRate ??
          dsdDopTransportSampleRate ??
          dsdPcmOutputSampleRate ??
          sdmOutputSampleRate ??
          echoSrcTargetSampleRate ??
          explicitRequestedSampleRate ??
          sourceOutputSampleRate);
    const decoderOutputSampleRate =
      sdmPcmToDsdActive && sdmTransportSampleRate
        ? sdmTransportSampleRate
        : requestedOutputSampleRate;
    const warnings: string[] = [];
    const windowsSharedDefaultFormatWarning = createWindowsSharedDefaultFormatWarning(
      this.platform,
      outputMode,
      sharedDeviceSampleRate ?? (outputMode === 'shared' ? actualDeviceSampleRate : null),
    );

    if (!fileSampleRate) {
      warnings.push('file_sample_rate_unknown_using_44100_fallback');
    }

    if (windowsSharedDefaultFormatWarning) {
      warnings.push(windowsSharedDefaultFormatWarning);
    }

    const dsdDopDisabledWarning = getDsdDopDisabledWarning(
      probe.filePath,
      this.currentInputHeaders,
      probe,
      outputSettings,
      outputMode,
    );
    if (dsdDopDisabledWarning) {
      warnings.push(dsdDopDisabledWarning);
    }

    if (outputMode === 'shared' && sharedRequestedSampleRate !== cappedSharedRequestedSampleRate) {
      warnings.push(`shared_output_sample_rate_capped:${sharedRequestedSampleRate}->${cappedSharedRequestedSampleRate}`);
    }

    if (dsdOutputMode === 'pcm' && dsdPcmOutputSampleRate && fileSampleRate !== null && fileSampleRate !== decoderOutputSampleRate) {
      warnings.push(`dsd_source_decoded_to_pcm:${fileSampleRate}->${decoderOutputSampleRate}`);
    }

    if (sdmPcmToDsdRequested) {
      if (sdmPcmToDsdActive) {
        warnings.push(`sdm_pcm_to_dsd_active:${sourceSampleRate}->${sdmNativeSampleRate}`);
        if (sdmOversamplingPlan) {
          warnings.push(
            sdmOversamplingPlan.engine === 'echo-fir'
              ? `sdm_oversampling_echo_fir_planned:${sdmOversamplingPlan.sourceSampleRate}->${sdmOversamplingPlan.targetSampleRate}:${resolveSdmOversamplingEffectiveFilterProfile(sdmOversamplingPlan)}`
              : `sdm_oversampling_soxr:${sdmOversamplingPlan.sourceSampleRate}->${sdmOversamplingPlan.targetSampleRate}:precision=${sdmOversamplingPlan.precision}`,
          );
        }
      } else if (sdmNotRoutedReason) {
        warnings.push(sdmNotRoutedReason);
      }
    }

    if (echoSrcMode !== 'off' && outputMode === 'shared') {
      warnings.push('echo_src_bypassed_in_shared_output');
    } else if (echoSrcMode !== 'off' && !echoSrcOutputModeSupported) {
      warnings.push('echo_src_bypassed_in_non_direct_output');
    } else if (echoSrcMode !== 'off' && dsdOutputMode !== 'pcm') {
      warnings.push('echo_src_bypassed_for_dsd_direct');
    } else if (echoSrcMode !== 'off' && dsdPcmOutputSampleRate) {
      warnings.push('echo_src_bypassed_for_dsd_pcm');
    } else if (echoSrcMode !== 'off' && sdmPcmToDsdActive) {
      warnings.push('echo_src_bypassed_for_sdm');
    } else if (echoSrcMode !== 'off' && echoSrcActive) {
      warnings.push(`echo_src_active:${sourceSampleRate}->${echoSrcTargetSampleRate}`);
    }

    if (
      !residentOutputSampleRate &&
      outputMode !== 'shared' &&
      !dsdPcmOutputSampleRate &&
      explicitRequestedSampleRate &&
      explicitRequestedSampleRate !== sourceOutputSampleRate
    ) {
      warnings.push('explicit_resampling_requested_for_exclusive_output');
    }

    if (
      residentOutputSampleRate &&
      fileSampleRate !== null &&
      sourceOutputSampleRate !== residentOutputSampleRate
    ) {
      warnings.push('resident_output_resampling_to_device_rate');
    }

    const sampleRateMismatch =
      actualDeviceSampleRate !== null && actualDeviceSampleRate !== requestedOutputSampleRate;
    if (sampleRateMismatch) {
      warnings.push(
        `actual_device_sample_rate_mismatch:${requestedOutputSampleRate}->${actualDeviceSampleRate}`,
      );
    }
    if (
      outputMode === 'shared' &&
      actualDeviceSampleRate !== null &&
      actualDeviceSampleRate > maxReliableSharedOutputSampleRate &&
      actualDeviceSampleRate !== requestedOutputSampleRate
    ) {
      warnings.push(`shared_output_mix_rate_too_high:${requestedOutputSampleRate}->${actualDeviceSampleRate}`);
    }

    const fileToDecoderResampling = dsdOutputMode !== 'pcm'
      ? false
      : fileSampleRate !== null && fileSampleRate !== decoderOutputSampleRate;
    const outputSideResampling = dsdOutputMode !== 'pcm'
      ? false
      : actualDeviceSampleRate !== null && actualDeviceSampleRate !== decoderOutputSampleRate;
    const sharedModeResampling =
      dsdOutputMode !== 'pcm'
        ? false
        : outputMode === 'shared' &&
          fileSampleRate !== null &&
          ((actualDeviceSampleRate !== null && actualDeviceSampleRate !== fileSampleRate) ||
            requestedOutputSampleRate !== fileSampleRate);
    const resampling = fileToDecoderResampling || outputSideResampling || sharedModeResampling;

    if (sharedModeResampling) {
      warnings.push('shared_output_resampling_or_mixer_rate_difference');
    }

    const bitPerfectCandidate =
      dsdOutputMode !== 'pcm'
        ? true
        : outputMode !== 'shared' &&
          fileSampleRate !== null &&
          fileSampleRate === decoderOutputSampleRate &&
          fileSampleRate === requestedOutputSampleRate &&
          (actualDeviceSampleRate === null || actualDeviceSampleRate === requestedOutputSampleRate) &&
          !sampleRateMismatch &&
          !sdmPcmToDsdActive;

    return {
      fileSampleRate,
      outputChannels: probe.channels,
      decoderOutputSampleRate,
      requestedOutputSampleRate,
      actualDeviceSampleRate,
      sharedDeviceSampleRate,
      dsdOutputMode,
      dsdNativeSampleRate: dsdOutputMode !== 'pcm' ? fileSampleRate : null,
      dsdTransportSampleRate: dsdOutputMode === 'dop' ? dsdDopTransportSampleRate : null,
      outputMode,
      resampling,
      echoSrcMode,
      echoSrcQualityProfile,
      echoSrcAdvancedModeEnabled,
      echoSrcFirActive: echoSrcActive && echoSrcFirModeEnabled,
      echoSrcFilterProfile,
      echoSrcFilterProfile1x,
      echoSrcFilterProfileNx,
      echoSrcFilterSlot,
      echoSrcComputeBackend,
      echoSrcCudaActive,
      echoSrcTargetSampleRate,
      echoSrcActive,
      echoSrcRuntime,
      sdmPcmToDsdActive,
      sdmOutputFormat,
      sdmNativeSampleRate,
      sdmTransportSampleRate,
      sdmComputeBackend,
      sdmActualComputeBackend,
      sdmModulatorProfile,
      sdmProcessingMode: sdmBlockPlan?.processingMode ?? null,
      sdmBatchFrames: sdmBlockPlan?.targetBatchFrames ?? null,
      sdmMaxBlockFrames: sdmBlockPlan?.maxBlockFrames ?? null,
      sdmOversamplingFilterProfile,
      sdmOversamplingFilterProfile1x,
      sdmOversamplingFilterProfileNx,
      sdmOversamplingFirActive,
      sdmRuntime,
      bitPerfectCandidate,
      sampleRateMismatch,
      warnings,
    };
  }

  private applyReadyResult(ready: NativeBridgeReadyResult): void {
    if (!this.currentProbe || !this.currentOutputSettings) {
      return;
    }

    if (!isResidentOutputMode(this.currentOutputSettings.outputMode)) {
      this.currentResidentOutputSampleRate = null;
    }
    const readyDevice = ready.device;
    const requestedOutputMode = normalizeOutputMode(this.currentOutputSettings.outputMode);
    const readyBackend = typeof readyDevice.backend === 'string' ? readyDevice.backend.toLowerCase() : '';
    const readyBackendImpl = typeof readyDevice.backendImpl === 'string' ? readyDevice.backendImpl.toLowerCase() : '';
    const readyBackendIdentity = `${readyBackend} ${readyBackendImpl}`;
    if (requestedOutputMode === 'exclusive') {
      if (readyDevice.exclusive !== true || !readyBackendIdentity.includes('exclusive')) {
        throw new Error(
          `native_output_contract_mismatch: requested=exclusive actualExclusive=${String(readyDevice.exclusive)} ` +
          `backend=${readyDevice.backend ?? 'unknown'} backendImpl=${readyDevice.backendImpl ?? 'unknown'}`,
        );
      }
    } else if (requestedOutputMode === 'asio') {
      if (!readyBackendIdentity.includes('asio')) {
        throw new Error(
          `native_output_contract_mismatch: requested=asio backend=${readyDevice.backend ?? 'unknown'} ` +
          `backendImpl=${readyDevice.backendImpl ?? 'unknown'}`,
        );
      }
    } else if (requestedOutputMode === 'shared' && readyDevice.exclusive === true) {
      throw new Error(
        `native_output_contract_mismatch: requested=shared actualExclusive=true ` +
        `backend=${readyDevice.backend ?? 'unknown'} backendImpl=${readyDevice.backendImpl ?? 'unknown'}`,
      );
    }
    const requestedSharedBackend = normalizeSharedBackend(this.currentOutputSettings.sharedBackend);
    if (
      requestedOutputMode === 'shared' &&
      requestedSharedBackend === 'directsound' &&
      !readyBackendIdentity.includes('directsound')
    ) {
      throw new Error(
        `native_output_contract_mismatch: requested=directsound actualBackend=${readyDevice.backend ?? 'unknown'} ` +
        `backendImpl=${readyDevice.backendImpl ?? 'unknown'}`,
      );
    }
    this.currentReadyResult = ready;
    this.currentOutputBackend = typeof readyDevice.backend === 'string' ? readyDevice.backend : null;
    this.currentOutputBackendImpl = typeof readyDevice.backendImpl === 'string' ? readyDevice.backendImpl : null;
    this.currentActiveDsdOutputMode = this.currentPlan?.dsdOutputMode !== 'pcm' ? this.currentPlan?.dsdOutputMode ?? null : null;
    this.currentDsdNativeSampleRate = this.currentPlan?.dsdNativeSampleRate ?? null;
    this.currentDsdTransportSampleRate = this.currentPlan?.dsdTransportSampleRate ?? null;
    this.currentOutputDeviceType = typeof readyDevice.deviceType === 'string' ? readyDevice.deviceType : null;
    this.currentOutputDeviceName = typeof readyDevice.deviceName === 'string' ? readyDevice.deviceName : null;
    this.currentBridgeOutputMode = requestedOutputMode;
    this.currentBridgeSharedBackend =
      this.currentBridgeOutputMode === 'shared'
        ? this.currentOutputBackend === 'directsound-shared'
          ? 'directsound'
          : normalizeSharedBackend(this.currentOutputSettings.sharedBackend)
        : null;
    const readySharedRate =
      normalizeAudioSampleRate(readyDevice.sharedDeviceSampleRate) ??
      normalizeAudioSampleRate(readyDevice.sharedSampleRate);
    const enumeratedSharedRate = normalizeAudioSampleRate(this.currentDevice?.sharedDeviceSampleRate);
    const selectedDevice = readySharedRate
      ? {
          ...(this.currentDevice ?? {
            id: `${this.currentOutputSettings.outputMode ?? 'shared'}:ready`,
            index: this.currentOutputSettings.deviceIndex ?? -1,
            name: this.currentOutputSettings.deviceName ?? 'Selected output',
            outputMode: 'shared',
            sampleRate: null,
            isDefault: false,
          }),
          sharedDeviceSampleRate: enumeratedSharedRate ?? readySharedRate,
        }
      : this.currentDevice;
    const readyDeviceName = typeof readyDevice.deviceName === 'string' ? readyDevice.deviceName : null;
    const readySampleRate =
      normalizeAudioSampleRate(readyDevice.sharedDeviceSampleRate) ??
      normalizeAudioSampleRate(readyDevice.sharedSampleRate) ??
      ready.actualDeviceSampleRate;
    const previousPlan = this.currentPlan;
    const resolvedDevice =
      readyDeviceName || readySampleRate
        ? {
            ...(selectedDevice ?? createDeviceFromOutputSettings(this.currentOutputSettings) ?? {
              id: `${this.currentOutputSettings.outputMode ?? 'shared'}:ready`,
              index: this.currentOutputSettings.deviceIndex ?? -1,
              name: 'Selected output',
              outputMode: 'shared',
              sampleRate: null,
              sharedDeviceSampleRate: null,
              isDefault: false,
            }),
            name: readyDeviceName ?? selectedDevice?.name ?? this.currentOutputSettings.deviceName ?? 'Selected output',
            sampleRate: readySampleRate,
            sharedDeviceSampleRate: enumeratedSharedRate ?? readySharedRate ?? selectedDevice?.sharedDeviceSampleRate ?? readySampleRate,
          }
        : selectedDevice;

    this.currentDevice = resolvedDevice;
    this.currentPlan = this.createSampleRatePlan(
      this.currentProbe,
      this.currentOutputSettings,
      resolvedDevice,
      ready.actualDeviceSampleRate,
      { residentOutputSampleRate: this.currentResidentOutputSampleRate },
    );
    this.currentPlan = {
      ...this.currentPlan,
      outputChannels: previousPlan?.outputChannels ?? this.currentPlan.outputChannels,
    };
    this.assertAsioSampleRateUsable();
    this.nativeDeviceBufferFrames = numericReadyField(ready, 'deviceBufferFrames');
    this.nativeRequestedBufferFrames = numericReadyField(ready, 'requestedDeviceBufferFrames');
    this.nativeActualBufferFrames =
      numericReadyField(ready, 'nativeActualBufferFrames') ??
      numericReadyField(ready, 'actualBufferFrames') ??
      this.nativeDeviceBufferFrames;
    this.nativeFifoCapacityFrames = numericReadyField(ready, 'fifoCapacityFrames');
    this.nativeStartupPrebufferFrames = numericReadyField(ready, 'startupPrebufferFrames');
    if (readyDevice.bufferSizeFallback === true) {
      const requestedBufferFrames = numericReadyField(ready, 'requestedDeviceBufferFrames');
      const openedBufferFrames = numericReadyField(ready, 'openedDeviceBufferFrames') ?? this.nativeActualBufferFrames;
      this.addOutputWarning(
        requestedBufferFrames && openedBufferFrames
          ? `native_output_buffer_size_fell_back:${requestedBufferFrames}->${openedBufferFrames}`
          : 'native_output_buffer_size_fell_back',
      );
    }
    this.clock.setSampleRate(ready.actualDeviceSampleRate ?? this.currentPlan.requestedOutputSampleRate);
    this.recordPlaybackDiagnosticEvent('output_ready', 'info', 'native_output_ready', {
      trackId: this.currentTrackId,
      filePath: this.currentFilePath,
      outputMode: this.currentPlan.outputMode,
      outputBackend: this.currentOutputBackend,
      outputBackendImpl: this.currentOutputBackendImpl,
      details: {
        outputDeviceName: this.currentOutputDeviceName,
        nativeOutputFormat: getReadyOutputFormat(this.currentReadyResult),
        fileSampleRate: this.currentPlan.fileSampleRate,
        decoderOutputSampleRate: this.currentPlan.decoderOutputSampleRate,
        requestedOutputSampleRate: this.currentPlan.requestedOutputSampleRate,
        actualDeviceSampleRate: this.currentPlan.actualDeviceSampleRate,
        nativeDeviceBufferFrames: this.nativeDeviceBufferFrames,
        nativeRequestedBufferFrames: this.nativeRequestedBufferFrames,
        nativeActualBufferFrames: this.nativeActualBufferFrames,
        nativeFifoCapacityFrames: this.nativeFifoCapacityFrames,
        nativeStartupPrebufferFrames: this.nativeStartupPrebufferFrames,
      },
    });
  }

  private assertAsioSampleRateUsable(): void {
    const plan = this.currentPlan;
    if (plan?.outputMode === 'asio' && plan.actualDeviceSampleRate !== null &&
        plan.actualDeviceSampleRate !== plan.requestedOutputSampleRate) {
      throw new Error(
        `asio_output_sample_rate_mismatch:${plan.requestedOutputSampleRate}->${plan.actualDeviceSampleRate}`,
      );
    }
  }

  private assertReadySampleRateConsistent(): void {
    const plan = this.currentPlan;

    if (!plan || plan.outputMode !== 'exclusive' || plan.actualDeviceSampleRate === null) {
      return;
    }

    if (plan.actualDeviceSampleRate !== plan.requestedOutputSampleRate) {
      throw new Error(
        `${plan.outputMode}_output_sample_rate_mismatch:${plan.requestedOutputSampleRate}->${plan.actualDeviceSampleRate}`,
      );
    }
  }

  private logAudioTransition(
    plan: SampleRatePlan,
    transition: {
      hostReused: boolean;
      hostRestartReason: string | null;
      previousOutputSettings?: AudioOutputSettings | null;
      previousDevice?: AudioDeviceInfo | null;
      requestedOutputSettings?: AudioOutputSettings | null;
      requestedDevice?: AudioDeviceInfo | null;
      recoveryReason?: string | null;
      fallbackReason?: string | null;
      preparedLocalProbeUsed?: boolean;
      preparedLocalProbeAgeMs?: number | null;
    },
  ): void {
    const sharedMixRate =
      plan.outputMode === 'shared'
        ? plan.sharedDeviceSampleRate ?? plan.actualDeviceSampleRate ?? plan.requestedOutputSampleRate
        : null;
    if (!transition.hostReused) {
      this.audioHostRestartCount += 1;
    }
    const previousDevice = createOutputRouteDeviceSnapshot(transition.previousOutputSettings, transition.previousDevice);
    const requestedDevice = createOutputRouteDeviceSnapshot(transition.requestedOutputSettings, transition.requestedDevice);
    const finalDevice = createOutputRouteDeviceSnapshot(this.currentOutputSettings, this.currentDevice);

    this.verboseLogger(
      JSON.stringify({
        event: 'audio_transition',
        outputMode: plan.outputMode,
        sourceSampleRate: plan.fileSampleRate,
        sharedMixRate,
        decoderOutputRate: plan.decoderOutputSampleRate,
        hostReused: transition.hostReused,
        hostRestartReason: transition.hostRestartReason,
        preparedLocalProbeUsed: transition.preparedLocalProbeUsed === true,
        preparedLocalProbeAgeMs: transition.preparedLocalProbeAgeMs ?? null,
        previousOutputMode: transition.previousOutputSettings
          ? normalizeOutputMode(transition.previousOutputSettings.outputMode)
          : null,
        requestedOutputMode: transition.requestedOutputSettings
          ? normalizeOutputMode(transition.requestedOutputSettings.outputMode)
          : null,
        finalOutputMode: plan.outputMode,
        previousDeviceId: previousDevice.deviceId,
        previousDeviceName: previousDevice.deviceName,
        previousDeviceIndex: previousDevice.deviceIndex,
        requestedDeviceId: requestedDevice.deviceId,
        requestedDeviceName: requestedDevice.deviceName,
        requestedDeviceIndex: requestedDevice.deviceIndex,
        finalDeviceId: finalDevice.deviceId,
        finalDeviceName: finalDevice.deviceName,
        finalDeviceIndex: finalDevice.deviceIndex,
        recoveryReason: transition.recoveryReason ?? null,
        fallbackReason:
          transition.fallbackReason ??
          (transition.hostRestartReason?.includes('fallback') ? transition.hostRestartReason : null),
        levelMeterObserveCostMs: this.levelSnapshot.levelMeterObserveCostMs,
        visualSpectrumComputeCostMs: this.levelSnapshot.visualSpectrumComputeCostMs,
        mainEventLoopLagMs: this.mainEventLoopLagMs,
        audioHostRestartCount: this.audioHostRestartCount,
        playbackRecoveryCount: this.playbackRecoveryCount,
        whetherDeviceChangedUnexpectedly:
          outputRouteDeviceChanged(requestedDevice, finalDevice) &&
          hasExplicitDeviceSelection(transition.requestedOutputSettings ?? {}) &&
          !isDefaultDeviceFallbackAllowed(transition.requestedOutputSettings ?? {}),
      }),
    );
  }

  private resolveSelectedDevice(
    outputSettings: AudioOutputSettings,
    availableDevices: AudioDeviceInfo[] = this.deviceService.listDevices(),
  ): AudioDeviceInfo | null {
    const deviceIndex = Number(outputSettings.deviceIndex);
    const deviceName = outputSettings.deviceName;

    if (!Number.isInteger(deviceIndex) && !deviceName) {
      return null;
    }

    const requestedMode = normalizeOutputMode(outputSettings.outputMode);
    const expectedDeviceMode: AudioDeviceInfo['outputMode'] = requestedMode === 'system'
      || (requestedMode === 'exclusive' && this.platform === 'darwin')
      ? 'shared'
      : requestedMode;

    const devices = availableDevices.filter((device) => device.outputMode === expectedDeviceMode);

    if (deviceName) {
      const nameMatch = devices.find((device) => device.name === deviceName);
      if (nameMatch) {
        return nameMatch;
      }
    }

    if (Number.isInteger(deviceIndex)) {
      return devices.find((device) => device.index === deviceIndex) ?? null;
    }

    return null;
  }

  private resolveDefaultSharedDevice(): AudioDeviceInfo | null {
    const sharedDevices = this.deviceService.listDevices().filter((device) => device.outputMode === 'shared');

    return sharedDevices.find((device) => device.isDefault) ?? sharedDevices[0] ?? null;
  }

  private createBridgeStartCandidates(outputSettings: AudioOutputSettings): Array<AudioDeviceInfo | null> {
    const outputMode = normalizeOutputMode(outputSettings.outputMode);
    if (outputMode === 'exclusive' || outputMode === 'asio') {
      if (this.currentDevice?.outputMode === outputMode) {
        return isDefaultDeviceFallbackAllowed(outputSettings) ? [this.currentDevice, null] : [this.currentDevice];
      }
      const resolvedDevice = this.resolveSelectedDevice(outputSettings);
      if (resolvedDevice) {
        return isDefaultDeviceFallbackAllowed(outputSettings) ? [resolvedDevice, null] : [resolvedDevice];
      }
    }
    const explicitDevice = createDeviceFromOutputSettings(outputSettings);

    if (explicitDevice) {
      return isDefaultDeviceFallbackAllowed(outputSettings) ? [explicitDevice, null] : [explicitDevice];
    }

    return [null];
  }

  private createNativeOutputStartOptions(options: NativeOutputStartOptions): NativeOutputStartOptions {
    const outputMode = options.exclusive ? 'exclusive' : 'shared';
    const requestedLatencyProfile = resolveSupportedLatencyProfile(outputMode, normalizeLatencyProfile(options.latencyProfile));
    const rawBufferSizeFrames = normalizePositiveInteger(options.bufferSizeFrames) ?? undefined;
    const latencyProfile = requestedLatencyProfile;
    const explicitBufferSizeFrames = this.sanitizeLowLatencyBufferForOutputMode(
      outputMode,
      latencyProfile,
      rawBufferSizeFrames,
      'native_start_options',
    );
    const profileBufferSizeFrames =
      explicitBufferSizeFrames ??
      getLatencyProfileBufferSizeFrames(outputMode, latencyProfile, options.requestedOutputSampleRate);

    if (options.exclusive) {
      return {
        ...options,
        latencyProfile,
        startupPrebufferMs: options.startupPrebufferMs,
        startupPrebufferTimeoutMs: options.startupPrebufferTimeoutMs,
        bufferSizeFrames: profileBufferSizeFrames,
      };
    }

    const sharedBackend = normalizeSharedBackend(options.sharedBackend);
    const sharedProfile = sharedBackend === 'directsound'
      ? directSoundSharedProfile
      : latencyProfile === 'stable'
        ? stableSharedProfile
        : latencyProfile === 'lowLatency' && this.sharedStabilityTier === 'standard'
          ? sharedLowLatencyProfile
          : sharedStabilityProfiles[this.sharedStabilityTier];
    const effectiveSharedProfile: SharedOutputProfile = {
      ...sharedProfile,
      fifoCapacityMs: options.fifoCapacityMs ?? sharedProfile.fifoCapacityMs,
      startupPrebufferMs: options.startupPrebufferMs ?? sharedProfile.startupPrebufferMs,
      startupPrebufferTimeoutMs: options.startupPrebufferTimeoutMs ?? sharedProfile.startupPrebufferTimeoutMs,
    };
    const sharedProfileBufferSizeFrames = sharedProfile.bufferSizeFrames ?? 0;
    const effectiveLatencyProfile =
      latencyProfile === 'lowLatency' && sharedProfileBufferSizeFrames > lowLatencyMaxBufferSizeFrames
        ? (this.sharedStabilityTier === 'emergency' || sharedProfile === stableSharedProfile ? 'stable' : 'balanced')
        : latencyProfile;
    if (effectiveLatencyProfile !== latencyProfile) {
      this.addOutputWarning(lowLatencyBufferIgnoredWarning);
      this.logger(
        `[AudioSession] ${lowLatencyBufferIgnoredWarning}; source=shared_stability_profile outputMode=shared requestedBuffer=${sharedProfileBufferSizeFrames}`,
      );
    }

    return {
      ...options,
      latencyProfile: effectiveLatencyProfile,
      ...effectiveSharedProfile,
      bufferSizeFrames: explicitBufferSizeFrames ?? (
        sharedBackend === 'directsound'
          ? effectiveSharedProfile.bufferSizeFrames
          : Math.max(profileBufferSizeFrames, effectiveSharedProfile.bufferSizeFrames ?? 0)
      ),
    };
  }

  private async startOutputBridgeForProbe(
    probe: AudioProbeResult,
    token: number,
    startSeconds: number,
    options: StartOutputBridgeOptions = {},
  ): Promise<BridgeStartResult> {
    if (!this.currentOutputSettings) {
      throw new Error('audio output settings unavailable');
    }

    // This is the factory boundary for every one-shot PCM, DoP, and native
    // DSD host. Enforce single output ownership here so future callers cannot
    // accidentally overlap a resident daemon with a raw hardware bridge.
    if (this.activeDaemonBackend || this.daemonStopInProgress) {
      await this.stopActiveDaemonBackend('one-shot-output-takeover');
    }
    await this.stopAudioDaemonForPlayback();
    this.assertCurrentRun(token);

    const candidates = this.createBridgeStartCandidates(this.currentOutputSettings);
    let lastError: Error | null = null;
    let previousBridgeStopped = false;

    for (const candidate of candidates) {
      this.assertCurrentRun(token);
      const outputMode = normalizeOutputMode(this.currentOutputSettings.outputMode);
      const usingDefaultSharedFallback =
        outputMode === 'shared' && candidate === null && hasExplicitDeviceSelection(this.currentOutputSettings);
      const planDevice = outputMode === 'shared' && candidate === null ? this.resolveDefaultSharedDevice() : candidate;
      this.currentDevice = planDevice;
      const residentOutputSampleRate = null;
      this.currentResidentOutputSampleRate = residentOutputSampleRate;
      this.currentPlan = this.createSampleRatePlan(
        probe,
        this.currentOutputSettings,
        this.currentDevice,
        null,
        { residentOutputSampleRate },
      );
      const nativeDirectPreflightFallbackReason = getNativeDirectLocalPlaybackFallbackReason(
        probe.filePath,
        this.currentInputHeaders,
        probe,
        this.currentPlan,
        this.currentOutputSettings,
        options.allowNativeDirectLocalPlaybackChannelMapping !== true,
      );
      const outputChannels = resolveNativeDirectLocalPlaybackOutputChannels(probe, nativeDirectPreflightFallbackReason);
      this.currentPlan = {
        ...this.currentPlan,
        outputChannels,
      };
      this.verboseLogger(
        `[AudioSession] sample-rate plan: file=${this.currentPlan.fileSampleRate ?? 'n/a'} decoder=${
          this.currentPlan.decoderOutputSampleRate
        } requested=${this.currentPlan.requestedOutputSampleRate} mode=${this.currentPlan.outputMode} device=${
          planDevice ? `${planDevice.index}:${planDevice.name}` : 'default'
        }`,
      );
      this.clock.reset(startSeconds, this.currentPlan.requestedOutputSampleRate);
      const sharedBackend = outputMode === 'shared' ? normalizeSharedBackend(this.currentOutputSettings.sharedBackend) : 'auto';
      const useDirectSoundBackend = sharedBackend === 'directsound';
      const useMiniaudioOutputForHost = shouldUseMiniaudioOutputForHost(
        outputMode,
        sharedBackend,
        this.currentOutputSettings.useMiniaudioOutput === true,
      );
      const streamingSharedProfile =
        outputMode === 'shared' && !useDirectSoundBackend && isHttpPlaybackUrl(probe.filePath)
          ? httpStreamingSharedProfile
          : null;
      const isDsdDopOutput = this.currentPlan.dsdOutputMode === 'dop';
      const isSdmPcmToDsdOutput = this.currentPlan.sdmPcmToDsdActive === true;
      const isSdmNativeDsdOutput = this.currentPlan.sdmOutputFormat === 'dsd-native-raw';
      const isSourceNativeDsdOutput = this.currentPlan.dsdOutputMode === 'native';
      const isNativeDsdOutput = isSourceNativeDsdOutput || isSdmNativeDsdOutput;
      const residentReuseAllowed = canReuseResidentOutputBridge(outputMode);
      const echoSrcUltraOutputProfileOverride =
        this.currentPlan.echoSrcMode === 'family8x' && this.currentPlan.echoSrcActive
          ? echoSrcUltraOutputProfile
          : null;
      const adaptiveOutputProfile =
        outputMode !== 'shared' && this.currentPlan.dsdOutputMode === 'pcm'
          ? this.currentOutputAdaptiveProfile
          : null;
      const stabilityOutputProfile =
        adaptiveOutputProfile ??
        echoSrcUltraOutputProfileOverride ??
        (outputMode === 'exclusive' ? nativeExclusiveFeedProfile : null);

      const startOptions = this.createNativeOutputStartOptions({
        requestedOutputSampleRate: this.currentPlan.requestedOutputSampleRate,
        sharedMixSampleRate: outputMode === 'shared' ? this.currentPlan.requestedOutputSampleRate : null,
        channels: this.currentPlan.outputChannels,
        deviceIndex: useDirectSoundBackend
          ? undefined
          : candidate?.index ?? (usingDefaultSharedFallback ? undefined : this.currentOutputSettings.deviceIndex),
        deviceName: candidate?.name ?? (usingDefaultSharedFallback ? undefined : this.currentOutputSettings.deviceName),
        sharedBackend,
        exclusive: outputMode === 'exclusive',
        asio: outputMode === 'asio',
        useMiniaudioOutput:
          isDsdDopOutput || isSdmPcmToDsdOutput || isNativeDsdOutput
            ? false
            : useMiniaudioOutputForHost,
        latencyProfile: echoSrcUltraOutputProfileOverride ? 'stable' : this.currentOutputSettings.latencyProfile,
        bufferSizeFrames:
          stabilityOutputProfile?.bufferSizeFrames ??
          this.currentOutputSettings.bufferSizeFrames ??
          streamingSharedProfile?.bufferSizeFrames,
        fifoCapacityMs: stabilityOutputProfile?.fifoCapacityMs ?? streamingSharedProfile?.fifoCapacityMs,
        startupPrebufferMs: stabilityOutputProfile?.startupPrebufferMs ?? streamingSharedProfile?.startupPrebufferMs,
        startupPrebufferTimeoutMs:
          stabilityOutputProfile?.startupPrebufferTimeoutMs ?? streamingSharedProfile?.startupPrebufferTimeoutMs,
        volume: this.currentOutputSettings.volume,
        startSeconds,
        playbackRate: this.currentOutputSettings.playbackRate,
        playbackSpeedMode: this.currentOutputSettings.playbackSpeedMode,
        durationSeconds: probe.durationSeconds,
        inputFormat: isNativeDsdOutput
          ? 'dsd-native-raw'
          : isDsdDopOutput || isSdmPcmToDsdOutput
            ? 'dop24le'
            : 'pcm-f32le',
        readyTimeoutMs: isNativeDsdOutput ? sdmNativeOutputReadyTimeoutMs : undefined,
        nativeDsdSampleRate: isSourceNativeDsdOutput
          ? this.currentPlan.dsdNativeSampleRate
          : isSdmNativeDsdOutput
            ? this.currentPlan.sdmNativeSampleRate
            : null,
      });
      const reusableBridge = this.bridge;
      if (!useDirectSoundBackend && residentReuseAllowed && reusableBridge?.canReuseFor?.(startOptions) && this.currentReadyResult) {
        const residentSampleRate =
          isResidentOutputMode(outputMode) ? getReadyOutputSampleRate(this.currentReadyResult) : null;
        this.currentResidentOutputSampleRate = residentSampleRate;
        if (residentSampleRate) {
          this.currentPlan = this.createSampleRatePlan(
            probe,
            this.currentOutputSettings,
            this.currentDevice,
            residentSampleRate,
            { residentOutputSampleRate: residentSampleRate },
          );
          this.currentPlan = {
            ...this.currentPlan,
            outputChannels,
          };
          this.clock.reset(startSeconds, residentSampleRate);
        }
        this.attachBridgeEvents(reusableBridge, token);
        return {
          bridge: reusableBridge,
          plan: this.currentPlan,
          ready: this.currentReadyResult,
          hostReused: true,
          hostRestartReason: null,
        };
      }

      if (!this.bridge && this.bridgeStopInProgress && !previousBridgeStopped) {
        await this.bridgeStopInProgress;
        this.assertCurrentRun(token);
        previousBridgeStopped = true;
      }

      const hostRestartReason = this.bridge
        ? this.currentReadyResult
          ? residentReuseAllowed
            ? 'reuse_key_changed'
            : 'session_rotation'
          : 'resident_host_not_ready'
        : 'initial_start';

      if (this.bridge && !previousBridgeStopped) {
        if (this.shouldDetachSharedReplacement(outputMode, sharedBackend)) {
          await this.detachSharedReplacementBridge('replace-output');
        } else {
          await this.stopResourcesGracefully('replace-output');
        }
        this.assertCurrentRun(token);
        previousBridgeStopped = true;
      }

      let startRetryAttempts = 0;
      while (startRetryAttempts <= maxOutputStartRetries) {
        const bridge = this.createBridge();
        this.bridge = bridge;
        this.attachBridgeEvents(bridge, token);

        try {
          const ready = await bridge.start(startOptions);
          this.assertCurrentRun(token);

          if (usingDefaultSharedFallback) {
            this.addOutputWarning('shared_output_fell_back_to_default_device');
            this.addOutputWarning('shared_output_recovered_to_default_device');
          }

          return { bridge, plan: this.currentPlan, ready, hostReused: false, hostRestartReason };
        } catch (error) {
          if (isAudioSessionRunCancelledError(error)) {
            await this.stopBridgeGracefully(bridge, 'output-start-superseded');
            throw error;
          }

          lastError = error instanceof Error ? error : new Error(String(error));
          this.logger(`[AudioSession] output start failed: ${lastError.message}`);
          this.reportRecoverableAudioError(lastError, 'output-start', {
            outputMode,
            candidate: candidate ? { index: candidate.index, name: candidate.name, outputMode: candidate.outputMode } : 'default',
            requestedOutputSampleRate: this.currentPlan.requestedOutputSampleRate,
            channels: this.currentPlan.outputChannels,
          });
          await this.stopBridgeGracefully(bridge, 'output-start-failed');
          this.assertCurrentRun(token);
          if (this.currentPlan?.dsdOutputMode === 'native' && this.currentOutputSettings.dsdOutputMode === 'dop') {
            this.addOutputWarning(`native_dsd_fell_back_to_dop:${lastError.message.slice(0, 96)}`);
            this.asioNativeDsdDisabledForCurrentPlayback = true;
            this.currentOutputSettings = {
              ...this.currentOutputSettings,
            };
            this.currentActiveDsdOutputMode = null;
            this.currentDsdNativeSampleRate = null;
            this.currentDsdTransportSampleRate = null;
            return this.startOutputBridgeForProbe(probe, token, startSeconds, options);
          }
          if (this.currentPlan?.dsdOutputMode === 'dop' && this.currentOutputSettings.dsdOutputMode === 'dop') {
            this.addOutputWarning(`dsd_dop_fell_back_to_pcm:${lastError.message.slice(0, 96)}`);
            this.currentOutputSettings = {
              ...this.currentOutputSettings,
              dsdOutputMode: 'pcm',
            };
            this.currentActiveDsdOutputMode = null;
            this.currentDsdNativeSampleRate = null;
            this.currentDsdTransportSampleRate = null;
            return this.startOutputBridgeForProbe(probe, token, startSeconds, options);
          }
          if (this.currentPlan?.sdmPcmToDsdActive === true && this.currentOutputSettings.sdmMode === 'pcmToDsd') {
            this.addOutputWarning(`sdm_pcm_to_dsd_fell_back_to_pcm:${lastError.message.slice(0, 96)}`);
            this.currentOutputSettings = {
              ...this.currentOutputSettings,
              sdmMode: 'off',
            };
            return this.startOutputBridgeForProbe(probe, token, startSeconds, options);
          }
          if (isDeviceInitializeTimeoutError(lastError)) {
            this.addOutputWarning('device_initialize_timeout');
            this.logger('[AudioSession] device initialize timed out; skipping retry on same device');
            candidates.length = 0;
            break;
          }
          if (outputMode === 'exclusive' && isUnsupportedExclusiveFormatError(lastError)) {
            this.addOutputWarning('exclusive_output_format_unsupported');
            this.logger('[AudioSession] exclusive format is unsupported; skipping retries that only reopen the same format');
            break;
          }
          if (
            isOutputStartRetryMode(outputMode) &&
            !usingDefaultSharedFallback &&
            startRetryAttempts < maxOutputStartRetries
          ) {
            startRetryAttempts += 1;
            this.addOutputWarning(`${outputMode}_output_retry_same_device:${startRetryAttempts}`);
            this.logger(
              `[AudioSession] ${outputMode} output start failed; retrying original mode/device attempt=${startRetryAttempts}/${maxOutputStartRetries}: ${lastError.message}`,
            );
            continue;
          }
          break;
        }
      }
    }

    if (normalizeOutputMode(this.currentOutputSettings.outputMode) === 'exclusive') {
      if (!isSharedFallbackAllowedForExclusive(this.currentOutputSettings)) {
        this.addOutputWarning('exclusive_output_fallback_blocked');
        this.logger(
          `[AudioSession] exclusive output failed; automatic shared fallback is disabled: ${
            lastError?.message ?? 'unknown exclusive output error'
          }`,
        );
        throw lastError ?? new Error('exclusive output failed before ready');
      }
      const fallbackSettings = createSharedFallbackSettings(this.currentOutputSettings);
      const fallbackDevice = this.resolveSelectedDevice(fallbackSettings) ?? createDeviceFromOutputSettings(fallbackSettings);
      this.assertCurrentRun(token);
      this.currentOutputSettings = fallbackSettings;
      this.currentUseMiniaudioOutputRequested = fallbackSettings.useMiniaudioOutput === true;
      this.currentDevice = fallbackDevice;
      this.currentPlan = this.createSampleRatePlan(probe, fallbackSettings, fallbackDevice);
      this.addOutputWarning('exclusive_output_fell_back_to_shared');
      if (this.exclusiveResumeAfterRelease) {
        this.addOutputWarning('exclusive_resume_fell_back_to_shared');
        this.exclusiveResumeAfterRelease = false;
      }
      this.logger(
        `[AudioSession] exclusive output failed; falling back to shared output: ${
          lastError?.message ?? 'unknown exclusive output error'
        }`,
      );
      this.clock.reset(startSeconds, this.currentPlan.requestedOutputSampleRate);

      const bridge = this.createBridge();
      this.bridge = bridge;
      this.attachBridgeEvents(bridge, token);

      try {
        const ready = await bridge.start(this.createNativeOutputStartOptions({
          requestedOutputSampleRate: this.currentPlan.requestedOutputSampleRate,
          sharedMixSampleRate: this.currentPlan.requestedOutputSampleRate,
          channels: probe.channels,
          deviceIndex: fallbackDevice?.index ?? fallbackSettings.deviceIndex,
          deviceName: fallbackDevice?.name ?? fallbackSettings.deviceName,
          sharedBackend: fallbackSettings.sharedBackend,
          exclusive: false,
          useMiniaudioOutput: false,
          latencyProfile: fallbackSettings.latencyProfile,
          bufferSizeFrames: fallbackSettings.bufferSizeFrames ?? undefined,
          volume: fallbackSettings.volume,
          startSeconds,
          playbackRate: fallbackSettings.playbackRate,
          playbackSpeedMode: fallbackSettings.playbackSpeedMode,
          durationSeconds: probe.durationSeconds,
        }));
        this.assertCurrentRun(token);

        return {
          bridge,
          plan: this.currentPlan,
          ready,
          hostReused: false,
          hostRestartReason: 'exclusive_fallback_to_shared',
        };
      } catch (error) {
        if (isAudioSessionRunCancelledError(error)) {
          await this.stopBridgeGracefully(bridge, 'shared-fallback-superseded');
          throw error;
        }

        const fallbackError = error instanceof Error ? error : new Error(String(error));
        this.logger(`[AudioSession] shared fallback failed: ${fallbackError.message}`);
        await this.stopBridgeGracefully(bridge, 'shared-fallback-failed');
        if (hasExplicitDeviceSelection(fallbackSettings) && !isDefaultDeviceFallbackAllowed(fallbackSettings)) {
          this.addOutputWarning('shared_output_default_device_fallback_blocked');
          throw fallbackError;
        }
        return this.startSafeSharedFallbackForProbe(probe, token, startSeconds, fallbackError);
      }
    }

    if (normalizeOutputMode(this.currentOutputSettings.outputMode) === 'shared') {
      if (hasExplicitDeviceSelection(this.currentOutputSettings) && !isDefaultDeviceFallbackAllowed(this.currentOutputSettings)) {
        this.addOutputWarning('shared_output_default_device_fallback_blocked');
        this.logger(
          `[AudioSession] selected shared output failed; automatic default-device fallback is disabled: ${
            lastError?.message ?? 'unknown shared output error'
          }`,
        );
        throw lastError ?? new Error('selected shared output failed before ready');
      }
      return this.startSafeSharedFallbackForProbe(
        probe,
        token,
        startSeconds,
        lastError ?? new Error('shared output failed before ready'),
      );
    }

    throw lastError ?? new Error('no output device candidates available');
  }

  private async startSafeSharedFallbackForProbe(
    probe: AudioProbeResult,
    token: number,
    startSeconds: number,
    cause: Error,
  ): Promise<BridgeStartResult> {
    if (!this.currentOutputSettings) {
      throw new Error('audio output settings unavailable');
    }

    await this.stopResourcesGracefully('safe-shared-fallback');

    const fallbackSettings = createSafeSharedFallbackSettings(this.currentOutputSettings);
    const fallbackDevice = this.resolveDefaultSharedDevice();
    this.assertCurrentRun(token);
    this.currentOutputSettings = fallbackSettings;
    this.currentUseMiniaudioOutputRequested = fallbackSettings.useMiniaudioOutput === true;
    this.currentDevice = fallbackDevice;
    this.currentPlan = this.createSampleRatePlan(probe, fallbackSettings, fallbackDevice);
    this.sharedStabilityTier = 'emergency';
    this.addOutputWarning('shared_output_recovered_safe_mode');
    this.logger(`[AudioSession] shared output failed; trying safe shared output: ${cause.message}`);
    this.clock.reset(startSeconds, this.currentPlan.requestedOutputSampleRate);

    const bridge = this.createBridge();
    this.bridge = bridge;
    this.attachBridgeEvents(bridge, token);

    try {
      const ready = await bridge.start(this.createNativeOutputStartOptions({
        requestedOutputSampleRate: this.currentPlan.requestedOutputSampleRate,
        sharedMixSampleRate: this.currentPlan.requestedOutputSampleRate,
        channels: probe.channels,
        sharedBackend: fallbackSettings.sharedBackend,
        exclusive: false,
        useMiniaudioOutput: false,
        latencyProfile: fallbackSettings.latencyProfile,
        bufferSizeFrames: fallbackSettings.bufferSizeFrames ?? undefined,
        volume: fallbackSettings.volume,
        startSeconds,
        playbackRate: fallbackSettings.playbackRate,
        playbackSpeedMode: fallbackSettings.playbackSpeedMode,
        durationSeconds: probe.durationSeconds,
      }));
      this.assertCurrentRun(token);

      this.reportRecoverableAudioError(cause, 'safe-shared-fallback', {
        recovered: true,
        requestedOutputSampleRate: this.currentPlan.requestedOutputSampleRate,
        channels: probe.channels,
      });
      if (fallbackSettings.automaticOutputEnabled === true) {
        this.automaticOutputStage = 'safe-shared';
      }
      return {
        bridge,
        plan: this.currentPlan,
        ready,
        hostReused: false,
        hostRestartReason: 'safe_shared_fallback',
      };
    } catch (error) {
      if (isAudioSessionRunCancelledError(error)) {
        await this.stopBridgeGracefully(bridge, 'safe-shared-fallback-superseded');
        throw error;
      }

      const fallbackError = error instanceof Error ? error : new Error(String(error));
      this.logger(`[AudioSession] safe shared fallback failed: ${fallbackError.message}`);
      await this.stopBridgeGracefully(bridge, 'safe-shared-fallback-failed');
      if (
        this.currentOutputSettings.automaticOutputEnabled === true &&
        this.platform === 'win32' &&
        isAutomaticDirectSoundFallbackError(fallbackError)
      ) {
        return this.startAutomaticDirectSoundFallbackForProbe(probe, token, startSeconds, fallbackError);
      }
      if (this.currentOutputSettings.automaticOutputEnabled === true) {
        this.automaticOutputStage = 'failed';
      }
      throw fallbackError;
    }
  }

  private async startAutomaticDirectSoundFallbackForProbe(
    probe: AudioProbeResult,
    token: number,
    startSeconds: number,
    cause: Error,
  ): Promise<BridgeStartResult> {
    if (!this.currentOutputSettings) {
      throw new Error('audio output settings unavailable');
    }

    const fallbackSettings = createAutomaticDirectSoundFallbackSettings(this.currentOutputSettings);
    this.assertCurrentRun(token);
    this.currentOutputSettings = fallbackSettings;
    this.currentUseMiniaudioOutputRequested = false;
    this.currentDevice = null;
    this.currentPlan = this.createSampleRatePlan(probe, fallbackSettings, null);
    this.sharedStabilityTier = 'emergency';
    this.addOutputWarning('automatic_output_trying_directsound');
    this.logger(`[AudioSession] automatic WASAPI recovery failed; trying DirectSound compatibility output: ${cause.message}`);
    this.clock.reset(startSeconds, this.currentPlan.requestedOutputSampleRate);

    const bridge = this.createBridge();
    this.bridge = bridge;
    this.attachBridgeEvents(bridge, token);

    try {
      const ready = await bridge.start(this.createNativeOutputStartOptions({
        requestedOutputSampleRate: this.currentPlan.requestedOutputSampleRate,
        sharedMixSampleRate: this.currentPlan.requestedOutputSampleRate,
        channels: probe.channels,
        sharedBackend: 'directsound',
        exclusive: false,
        useMiniaudioOutput: false,
        latencyProfile: 'stable',
        volume: fallbackSettings.volume,
        startSeconds,
        playbackRate: fallbackSettings.playbackRate,
        playbackSpeedMode: fallbackSettings.playbackSpeedMode,
        durationSeconds: probe.durationSeconds,
      }));
      this.assertCurrentRun(token);
      this.automaticOutputStage = 'directsound';
      this.addOutputWarning('automatic_output_recovered_directsound');
      this.reportRecoverableAudioError(cause, 'automatic-directsound-fallback', {
        recovered: true,
        requestedOutputSampleRate: this.currentPlan.requestedOutputSampleRate,
        channels: probe.channels,
      });
      return {
        bridge,
        plan: this.currentPlan,
        ready,
        hostReused: false,
        hostRestartReason: 'automatic_directsound_fallback',
      };
    } catch (error) {
      if (isAudioSessionRunCancelledError(error)) {
        await this.stopBridgeGracefully(bridge, 'automatic-directsound-fallback-superseded');
        throw error;
      }

      const fallbackError = error instanceof Error ? error : new Error(String(error));
      this.logger(`[AudioSession] automatic DirectSound fallback failed: ${fallbackError.message}`);
      await this.stopBridgeGracefully(bridge, 'automatic-directsound-fallback-failed');
      this.automaticOutputStage = 'system-required';
      this.addOutputWarning('automatic_output_system_audio_required');
      throw fallbackError;
    }
  }

  private async startSharedFallbackForProbe(
    probe: AudioProbeResult,
    token: number,
    startSeconds: number,
    cause: Error,
  ): Promise<BridgeStartResult> {
    if (!this.currentOutputSettings) {
      throw new Error('audio output settings unavailable');
    }

    await this.stopResourcesGracefully('shared-fallback');

    const fallbackSettings = createSharedFallbackSettings(this.currentOutputSettings);
    const fallbackDevice = this.resolveSelectedDevice(fallbackSettings) ?? createDeviceFromOutputSettings(fallbackSettings);
    this.assertCurrentRun(token);
    this.currentOutputSettings = fallbackSettings;
    this.currentUseMiniaudioOutputRequested = fallbackSettings.useMiniaudioOutput === true;
    this.currentDevice = fallbackDevice;
    this.currentPlan = this.createSampleRatePlan(probe, fallbackSettings, fallbackDevice);
    this.addOutputWarning('exclusive_output_fell_back_to_shared');
    if (this.exclusiveResumeAfterRelease) {
      this.addOutputWarning('exclusive_resume_fell_back_to_shared');
      this.exclusiveResumeAfterRelease = false;
    }
    this.logger(`[AudioSession] exclusive output failed; falling back to shared output: ${cause.message}`);
    this.clock.reset(startSeconds, this.currentPlan.requestedOutputSampleRate);

    const bridge = this.createBridge();
    this.bridge = bridge;
    this.attachBridgeEvents(bridge, token);

    try {
      const ready = await bridge.start(this.createNativeOutputStartOptions({
        requestedOutputSampleRate: this.currentPlan.requestedOutputSampleRate,
        sharedMixSampleRate: this.currentPlan.requestedOutputSampleRate,
        channels: probe.channels,
        deviceIndex: fallbackDevice?.index ?? fallbackSettings.deviceIndex,
        deviceName: fallbackDevice?.name ?? fallbackSettings.deviceName,
        sharedBackend: fallbackSettings.sharedBackend,
        exclusive: false,
        useMiniaudioOutput: false,
        latencyProfile: fallbackSettings.latencyProfile,
        bufferSizeFrames: fallbackSettings.bufferSizeFrames ?? undefined,
        volume: fallbackSettings.volume,
        startSeconds,
        playbackRate: fallbackSettings.playbackRate,
        playbackSpeedMode: fallbackSettings.playbackSpeedMode,
        durationSeconds: probe.durationSeconds,
      }));
      this.assertCurrentRun(token);

      return {
        bridge,
        plan: this.currentPlan,
        ready,
        hostReused: false,
        hostRestartReason: 'exclusive_fallback_to_shared',
      };
    } catch (error) {
      if (isAudioSessionRunCancelledError(error)) {
        await this.stopBridgeGracefully(bridge, 'shared-fallback-superseded');
        throw error;
      }

      const fallbackError = error instanceof Error ? error : new Error(String(error));
      this.logger(`[AudioSession] shared fallback failed: ${fallbackError.message}`);
      await this.stopBridgeGracefully(bridge, 'shared-fallback-failed');
      if (hasExplicitDeviceSelection(fallbackSettings) && !isDefaultDeviceFallbackAllowed(fallbackSettings)) {
        this.addOutputWarning('shared_output_default_device_fallback_blocked');
        throw fallbackError;
      }
      return this.startSafeSharedFallbackForProbe(probe, token, startSeconds, fallbackError);
    }
  }

  private holdCurrentDecoderForPausedResume(token: number, startSeconds: number): boolean {
    const filePath = this.currentFilePath;
    const run = this.decoderRun;
    if (
      !this.canHoldCurrentDecoderForPausedResume() ||
      !filePath ||
      !run ||
      run.stream.destroyed ||
      run.stream.readableEnded
    ) {
      return false;
    }

    this.decoderPipelineCleanup?.();
    this.decoderPipelineCleanup = null;
    this.decoderRun = null;
    try {
      run.stream.unpipe();
    } catch {
    }
    try {
      run.stream.pause();
    } catch {
    }

    for (const transform of [this.gainTransform, this.speedTransform, this.levelMeterTransform]) {
      try {
        transform?.destroy();
      } catch {
      }
    }
    this.gainTransform = null;
    this.speedTransform = null;
    this.levelMeterTransform = null;

    this.stopPausedDecoderPrewarm();
    const prewarm: PausedDecoderPrewarm = {
      kind: 'held',
      token,
      filePath,
      startSeconds,
      timelineStartSeconds: this.estimateHeldDecoderTimelineStartSeconds(startSeconds),
      run,
    };
    this.pausedDecoderPrewarm = prewarm;
    run.done.catch((error) => {
      if (this.pausedDecoderPrewarm !== prewarm) {
        return;
      }

      this.pausedDecoderPrewarm = null;
      this.logger(`[AudioSession] paused HTTP decoder exited before resume: ${error instanceof Error ? error.message : String(error)}`);
    });
    return true;
  }

  private canHoldCurrentDecoderForPausedResume(): boolean {
    return Boolean(
      this.currentFilePath &&
      isHttpPlaybackUrl(this.currentFilePath) &&
      this.decoderRun &&
      this.currentActiveDsdOutputMode === null &&
      !this.activeAutomix,
    );
  }

  private estimateHeldDecoderTimelineStartSeconds(startSeconds: number): number {
    const sampleRate = this.currentPlan?.actualDeviceSampleRate ?? this.currentPlan?.requestedOutputSampleRate ?? null;
    const bufferedFrames = this.nativeTelemetry.bufferedFrames;
    const bufferedSeconds =
      sampleRate && bufferedFrames !== null
        ? Math.max(0, Math.min(heldHttpDecoderTimelineLeadCapSeconds, bufferedFrames / sampleRate))
        : 0;
    const durationSeconds =
      this.currentProbe?.durationSeconds && this.currentProbe.durationSeconds > 0
        ? this.currentProbe.durationSeconds
        : Number.POSITIVE_INFINITY;

    return Math.min(durationSeconds, Math.max(0, startSeconds + bufferedSeconds));
  }

  private startPausedOutputPrewarm(token: number, startSeconds: number): void {
    const promise = this.preparePausedOutputBridge(token, startSeconds);
    this.pausedOutputPrewarmPromise = promise;
    void promise.finally(() => {
      if (this.pausedOutputPrewarmPromise === promise) {
        this.pausedOutputPrewarmPromise = null;
      }
    });
  }

  private async waitBrieflyForPausedOutputPrewarm(): Promise<void> {
    const prewarm = this.pausedOutputPrewarmPromise;
    if (!prewarm) {
      return;
    }

    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        prewarm.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        ),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, pausedOutputPrewarmResumeWaitMs);
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }

    if (
      settled ||
      this.pausedOutputPrewarmPromise !== prewarm ||
      this.state !== 'paused' ||
      this.hostStatus !== 'starting'
    ) {
      return;
    }

    await this.stopResourcesGracefully('paused-output-prewarm-superseded');
    this.hostStatus = this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';
    this.emitStatus();
  }

  private stopPausedDecoderPrewarm(): void {
    const prewarm = this.pausedDecoderPrewarm;
    this.pausedDecoderPrewarm = null;
    if (!prewarm) {
      return;
    }

    try {
      prewarm.run.stream.destroy();
    } catch {
    }
    try {
      prewarm.run.stop();
    } catch {
    }
  }

  private consumePausedDecoderPrewarm(filePath: string, startSeconds: number): PausedDecoderPrewarm | null {
    const prewarm = this.pausedDecoderPrewarm;
    if (
      !prewarm ||
      prewarm.filePath !== filePath ||
      Math.abs(prewarm.startSeconds - startSeconds) > 0.01 ||
      prewarm.run.stream.destroyed ||
      prewarm.run.stream.readableEnded
    ) {
      if (prewarm) {
        this.stopPausedDecoderPrewarm();
      }
      return null;
    }

    this.pausedDecoderPrewarm = null;
    return prewarm;
  }

  private async preparePausedDecoderRun(
    token: number,
    startSeconds: number,
    probe: AudioProbeResult,
    plan: SampleRatePlan,
    outputSettings: AudioOutputSettings,
  ): Promise<void> {
    const filePath = this.currentFilePath;
    if (
      !filePath ||
      !isHttpPlaybackUrl(filePath) ||
      this.currentActiveDsdOutputMode !== null ||
      this.activeAutomix
    ) {
      return;
    }

    let run: DecoderRun | null = null;
    try {
      run = await this.createDecoderRunForPlayback(
        filePath,
        this.currentInputHeaders,
        startSeconds,
        probe,
        plan,
        outputSettings,
      );

      if (this.runToken !== token || this.state !== 'paused' || this.currentFilePath !== filePath) {
        run.stop();
        return;
      }

      const ready = run.ready ?? Promise.resolve();
      const prewarm: PausedDecoderPrewarm = {
        kind: 'fresh',
        token,
        filePath,
        startSeconds,
        timelineStartSeconds: startSeconds,
        run,
      };
      const existingPrewarm = this.pausedDecoderPrewarm;

      if (existingPrewarm?.kind === 'held') {
        ready.then(() => {
          if (this.runToken !== token || this.state !== 'paused' || this.currentFilePath !== filePath) {
            try {
              run?.stop();
            } catch {
                    }
            return;
          }

          this.stopPausedDecoderPrewarm();
          this.pausedDecoderPrewarm = prewarm;
        }).catch((error) => {
          try {
            run?.stop();
          } catch {
          }
          this.logger(`[AudioSession] paused HTTP decoder prewarm failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        run.done.catch((error) => {
          if (this.pausedDecoderPrewarm !== prewarm) {
            return;
          }

          this.pausedDecoderPrewarm = null;
          this.logger(`[AudioSession] paused HTTP decoder exited before resume: ${error instanceof Error ? error.message : String(error)}`);
        });
        return;
      }

      this.stopPausedDecoderPrewarm();
      this.pausedDecoderPrewarm = prewarm;
      ready.catch((error) => {
        if (this.pausedDecoderPrewarm !== prewarm) {
          return;
        }

        this.pausedDecoderPrewarm = null;
        try {
          run?.stop();
        } catch {
        }
        this.logger(`[AudioSession] paused HTTP decoder prewarm failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      run.done.catch((error) => {
        if (this.pausedDecoderPrewarm !== prewarm) {
          return;
        }

        this.pausedDecoderPrewarm = null;
        this.logger(`[AudioSession] paused HTTP decoder exited before resume: ${error instanceof Error ? error.message : String(error)}`);
      });
    } catch (error) {
      if (this.runToken !== token) {
        run?.stop();
        return;
      }

      this.logger(`[AudioSession] paused HTTP decoder prewarm skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async preparePausedOutputBridge(token: number, startSeconds: number): Promise<void> {
    const probe = this.currentProbe;

    if (!probe || !this.currentOutputSettings || !this.currentFilePath) {
      return;
    }

    try {
      const { ready } = await this.startOutputBridgeForProbe(probe, token, startSeconds);

      if (this.runToken !== token) {
        return;
      }

      this.applyReadyResult(ready);
      this.hostStatus = 'ready';
      this.emitStatus();
      const plan = this.currentPlan;
      const outputSettings = this.currentOutputSettings;
      if (plan && outputSettings) {
        void this.preparePausedDecoderRun(token, startSeconds, probe, plan, outputSettings);
      }
    } catch (error) {
      if (this.runToken !== token) {
        return;
      }

      await this.stopResourcesGracefully('paused-output-prewarm-failed');
      this.currentPlan = null;
      this.currentResidentOutputSampleRate = null;
      this.currentOutputBackend = null;
      this.currentOutputBackendImpl = null;
      this.currentOutputDeviceType = null;
      this.currentOutputDeviceName = null;
      this.currentUseMiniaudioOutputRequested = false;
      this.currentDecodeBackendImpl = null;
      this.currentReadyResult = null;
      this.hostStatus = this.isNativeHostAvailable() ? 'not-initialized' : 'unavailable';

      if (this.state === 'playing') {
        this.handleError(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      this.logger(`[AudioSession] paused output prewarm failed: ${error instanceof Error ? error.message : String(error)}`);
      this.emitStatus();
    }
  }
  private updatePositionFromOutput(): void {
    if (this.state === 'playing' && this.bridge?.getPositionSeconds) {
      const reportedPositionSeconds = this.bridge.getPositionSeconds();
      if (!Number.isFinite(reportedPositionSeconds)) {
        return;
      }

      const now = Date.now();
      const previousClockPositionSeconds = this.clock.getPositionSeconds();
      const guardedBaselinePositionSeconds =
        this.nativePositionReportedBeforePlaying && this.nativePositionBeforePlayingBaselineSeconds !== null
          ? this.nativePositionBeforePlayingBaselineSeconds
          : previousClockPositionSeconds;
      const shouldGuardStartupPosition = this.nativePositionReportedBeforePlaying || this.nativeStartupStatusGuardActive;
      const guardedRebasePositionSeconds = shouldGuardStartupPosition
        ? this.createGuardedPositionJumpRebase(
            reportedPositionSeconds,
            now,
            guardedBaselinePositionSeconds,
            { ignorePreviousSample: true },
          )
        : null;
      const positionSeconds = guardedRebasePositionSeconds ?? reportedPositionSeconds;
      const plan = this.currentPlan;
      const sampleRate = plan?.actualDeviceSampleRate ?? plan?.requestedOutputSampleRate ?? null;
      if (guardedRebasePositionSeconds !== null) {
        this.bridge.rebaseOutputClock?.(
          guardedRebasePositionSeconds,
          this.currentOutputSettings?.playbackRate ?? this.outputSettings.playbackRate,
        );
        this.watchdogLastPositionSeconds = guardedRebasePositionSeconds;
        this.handlePositionSample(this.runToken, guardedRebasePositionSeconds, null, now);
        this.nativePositionReportedBeforePlaying = false;
        this.nativePositionBeforePlayingBaselineSeconds = null;
        this.nativeStartupStatusGuardActive = false;
      } else if (shouldGuardStartupPosition) {
        this.nativePositionReportedBeforePlaying = false;
        this.nativePositionBeforePlayingBaselineSeconds = null;
        this.nativeStartupStatusGuardActive = false;
      }
      this.clock.reset(positionSeconds, sampleRate);
    }
  }

  private async waitForDecoderReadyBeforePlaying(
    run: DecoderRun,
    token: number,
    timeline?: { positionSeconds: number; playbackRate: number; sampleRate: number | null },
  ): Promise<void> {
    if (!run.ready) {
      return;
    }

    try {
      await run.ready;
    } catch (error) {
      if (this.runToken !== token) {
        throw new Error('audio_session_run_cancelled');
      }

      throw error instanceof Error ? error : new Error(String(error));
    }

    this.assertCurrentRun(token);
    if (timeline) {
      this.bridge?.resetOutputClock?.(timeline.positionSeconds, timeline.playbackRate);
      this.clock.reset(timeline.positionSeconds, timeline.sampleRate);
    }
  }

  private getLevelMeterStreamSampleRate(livePcmResamplerActive = false): number | undefined {
    const fallback = normalizeAudioSampleRate(this.currentProbe?.fileSampleRate) ?? undefined;
    const plan = this.currentPlan;
    if (!plan) {
      return fallback;
    }

    if (livePcmResamplerActive) {
      return normalizeAudioSampleRate(plan.actualDeviceSampleRate) ?? normalizeAudioSampleRate(plan.decoderOutputSampleRate) ?? fallback;
    }

    return normalizeAudioSampleRate(plan.decoderOutputSampleRate) ?? fallback;
  }

  private startDecoderRun(run: DecoderRun, writable: Writable, token: number): void {
    markPlaybackBreadcrumb('AudioSession.startDecoderRun:enter');
    this.decoderPipelineCleanup?.();
    run.ready?.catch(() => undefined);
    const volume = this.currentOutputSettings?.volume ?? this.outputSettings.volume;
    const volumeRouting = resolveOutputVolumeRouting(this.bridge, this.currentPlan, volume);
    const replayGainCalculation = this.calculateCurrentReplayGain();
    markPlaybackBreadcrumb('AudioSession.startDecoderRun:createTransforms:start');
    const replayGainTransform = new PcmVolumeTransform(run.replayGainAppliedInStream === true ? 1 : this.replayGainLinearGain(replayGainCalculation), 16);
    const livePcmResampler = this.createLivePcmResamplerTransform();
    const gainTransform = new PcmVolumeTransform(volumeRouting.softwareGain);
    const speedTransform = new PcmPlaybackRateTransform(
      this.currentProbe?.channels ?? 2,
      this.currentOutputSettings?.playbackRate ?? this.outputSettings.playbackRate,
    );
    const levelMeterTransform = new PcmLevelMeterTransform(
      (snapshot) => this.handleLevelSnapshot(snapshot),
      levelMeterVisualIntervalMs,
      undefined,
      this.getLevelMeterStreamSampleRate(Boolean(livePcmResampler)),
      this.currentProbe?.channels ?? undefined,
      isAudioVisualSpectrumEnabled(),
    );
    levelMeterTransform.setGain(volumeRouting.meterGain);
    markPlaybackBreadcrumb('AudioSession.startDecoderRun:createTransforms:complete');
    let inputEnded = false;
    const signalNativeInputEnded = (): void => {
      if (inputEnded || this.runToken !== token || this.decoderRun !== run) {
        return;
      }

      inputEnded = true;
      try {
        writable.end();
      } catch {
        // The native host may already have been stopped by pause/seek/stop.
      }
    };

    this.decoderRun = run;
    this.currentReplayGainCalculation = replayGainCalculation;
    this.gainTransform = gainTransform;
    this.speedTransform = speedTransform;
    this.levelMeterTransform = levelMeterTransform;
    const handlePipelineError = (stage: string) => (error: unknown): void => {
      if (this.runToken !== token || this.decoderRun !== run) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.handleError(new Error(`${stage}: ${message}`));
    };
    const streamErrorHandler = handlePipelineError('decoder_stream_error');
    const resamplerErrorHandler = handlePipelineError('live_pcm_resampler_error');
    const gainErrorHandler = handlePipelineError('pcm_gain_error');
    const replayGainErrorHandler = handlePipelineError('pcm_replay_gain_error');
    const speedErrorHandler = handlePipelineError('pcm_speed_error');
    const levelErrorHandler = handlePipelineError('pcm_level_meter_error');
    const writableErrorHandler = handlePipelineError('native_writable_error');

    markPlaybackBreadcrumb('AudioSession.startDecoderRun:attachHandlers:start');
    run.stream.on('error', streamErrorHandler);
    livePcmResampler?.on('error', resamplerErrorHandler);
    gainTransform.on('error', gainErrorHandler);
    replayGainTransform.on('error', replayGainErrorHandler);
    speedTransform.on('error', speedErrorHandler);
    levelMeterTransform.on('error', levelErrorHandler);
    writable.on('error', writableErrorHandler);
    this.decoderPipelineCleanup = (): void => {
      run.stream.off('error', streamErrorHandler);
      livePcmResampler?.off('error', resamplerErrorHandler);
      livePcmResampler?.destroy();
      gainTransform.off('error', gainErrorHandler);
      replayGainTransform.off('error', replayGainErrorHandler);
      replayGainTransform.destroy();
      speedTransform.off('error', speedErrorHandler);
      levelMeterTransform.off('error', levelErrorHandler);
      writable.off('error', writableErrorHandler);
    };
    markPlaybackBreadcrumb('AudioSession.startDecoderRun:attachHandlers:complete');
    let pcmSource: Readable = run.stream;
    if (livePcmResampler) {
      pcmSource = pcmSource.pipe(livePcmResampler);
    }
    markPlaybackBreadcrumb('AudioSession.startDecoderRun:pipelinePipe:start');
    const finalOutputSource = pcmSource.pipe(gainTransform).pipe(replayGainTransform).pipe(speedTransform).pipe(levelMeterTransform);
    finalOutputSource.pipe(writable, { end: false });
    markPlaybackBreadcrumb('AudioSession.startDecoderRun:pipelinePipe:complete');
    finalOutputSource.once('end', signalNativeInputEnded);
    run.done.catch((error: unknown) => {
      if (this.runToken === token) {
        this.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private calculateCurrentReplayGain(): ReplayGainCalculation {
    if (this.currentActiveDsdOutputMode === 'dop' || this.currentActiveDsdOutputMode === 'native') {
      return {
        appliedDb: 0,
        selectedGainDb: null,
        selectedPeak: null,
        preventedClipping: false,
        active: false,
      };
    }

    return this.calculateReplayGainForTrack(this.currentReplayGain);
  }

  private calculateReplayGainForTrack(replayGain: ReplayGainTrackData | null | undefined): ReplayGainCalculation {
    const settings = getReplayGainAudioSettings();
    return calculateReplayGain({
      ...(replayGain ?? {}),
      enabled: settings.replayGainEnabled,
      mode: settings.replayGainMode,
      targetLufs: settings.replayGainTargetLufs,
      preampDb: settings.replayGainPreampDb,
      preventClipping: settings.replayGainPreventClipping,
    });
  }

  private replayGainLinearGain(calculation: ReplayGainCalculation): number {
    if (!calculation.active || Math.abs(calculation.appliedDb) < 0.001) {
      return 1;
    }
    return Math.max(0, Math.min(16, dbToLinearGain(calculation.appliedDb)));
  }

  private startNativeAutomixRuns(
    currentRun: DecoderRun,
    nextRun: DecoderRun,
    currentWritable: Writable,
    nextWritable: Writable,
    token: number,
    decoderBackendImpl: 'native-automix-dual-deck' | 'native-gapless-dual-deck' = 'native-automix-dual-deck',
  ): void {
    this.decoderPipelineCleanup?.();
    const volume = this.currentOutputSettings?.volume ?? this.outputSettings.volume;
    const nativeVolumeControl = typeof this.bridge?.setVolume === 'function';
    const currentReplayGainCalculation = this.calculateCurrentReplayGain();
    const nextReplayGainCalculation = this.calculateReplayGainForTrack(this.activeAutomix?.nextReplayGain);
    const currentGainTransform = new PcmVolumeTransform(nativeVolumeControl ? 1 : volume);
    const nextGainTransform = new PcmVolumeTransform(nativeVolumeControl ? 1 : volume);
    const currentReplayGainTransform = new PcmVolumeTransform(this.replayGainLinearGain(currentReplayGainCalculation), 16);
    const nextReplayGainTransform = new PcmVolumeTransform(this.replayGainLinearGain(nextReplayGainCalculation), 16);
    const levelMeterTransform = new PcmLevelMeterTransform(
      (snapshot) => this.handleLevelSnapshot(snapshot),
      levelMeterVisualIntervalMs,
      undefined,
      this.getLevelMeterStreamSampleRate(),
      this.currentProbe?.channels ?? undefined,
      isAudioVisualSpectrumEnabled(),
    );
    levelMeterTransform.setGain(nativeVolumeControl ? volume : 1);
    const combinedRun: DecoderRun = {
      stream: currentRun.stream,
      stop: () => {
        currentRun.stop();
        nextRun.stop();
      },
      done: Promise.allSettled([currentRun.done, nextRun.done]).then((results) => {
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (rejected) {
          throw rejected.reason instanceof Error ? rejected.reason : new Error(String(rejected.reason));
        }
      }),
      decoderBackendImpl,
      resamplerEngine: currentRun.resamplerEngine,
      resamplerFallbackActive: currentRun.resamplerFallbackActive || nextRun.resamplerFallbackActive,
    };
    let currentEnded = false;
    let nextEnded = false;
    const signalCurrentEnded = (): void => {
      if (currentEnded || this.runToken !== token || this.decoderRun !== combinedRun) {
        return;
      }

      currentEnded = true;
      try {
        currentWritable.end();
      } catch {
        // The native host may already have been stopped by pause/seek/stop.
      }
    };
    const signalNextEnded = (): void => {
      if (nextEnded || this.runToken !== token || this.decoderRun !== combinedRun) {
        return;
      }

      nextEnded = true;
      try {
        nextWritable.end();
      } catch {
        // The native host may already have been stopped by pause/seek/stop.
      }
    };

    this.decoderRun = combinedRun;
    this.currentDecodeBackendImpl = decoderBackendImpl;
    this.currentReplayGainCalculation = currentReplayGainCalculation;
    this.gainTransform = currentGainTransform;
    this.speedTransform = null;
    this.levelMeterTransform = levelMeterTransform;
    const handlePipelineError = (stage: string) => (error: unknown): void => {
      if (this.runToken !== token || this.decoderRun !== combinedRun) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.handleError(new Error(`${stage}: ${message}`));
    };
    const currentStreamErrorHandler = handlePipelineError('native_automix_current_stream_error');
    const nextStreamErrorHandler = handlePipelineError('native_automix_next_stream_error');
    const currentGainErrorHandler = handlePipelineError('native_automix_current_gain_error');
    const nextGainErrorHandler = handlePipelineError('native_automix_next_gain_error');
    const currentReplayGainErrorHandler = handlePipelineError('native_automix_current_replay_gain_error');
    const nextReplayGainErrorHandler = handlePipelineError('native_automix_next_replay_gain_error');
    const levelErrorHandler = handlePipelineError('native_automix_level_meter_error');
    const currentWritableErrorHandler = handlePipelineError('native_automix_current_writable_error');
    const nextWritableErrorHandler = handlePipelineError('native_automix_next_writable_error');

    currentRun.stream.on('error', currentStreamErrorHandler);
    nextRun.stream.on('error', nextStreamErrorHandler);
    currentGainTransform.on('error', currentGainErrorHandler);
    nextGainTransform.on('error', nextGainErrorHandler);
    currentReplayGainTransform.on('error', currentReplayGainErrorHandler);
    nextReplayGainTransform.on('error', nextReplayGainErrorHandler);
    levelMeterTransform.on('error', levelErrorHandler);
    currentWritable.on('error', currentWritableErrorHandler);
    nextWritable.on('error', nextWritableErrorHandler);
    this.decoderPipelineCleanup = (): void => {
      currentRun.stream.off('error', currentStreamErrorHandler);
      nextRun.stream.off('error', nextStreamErrorHandler);
      currentGainTransform.off('error', currentGainErrorHandler);
      nextGainTransform.off('error', nextGainErrorHandler);
      currentReplayGainTransform.off('error', currentReplayGainErrorHandler);
      nextReplayGainTransform.off('error', nextReplayGainErrorHandler);
      levelMeterTransform.off('error', levelErrorHandler);
      currentWritable.off('error', currentWritableErrorHandler);
      nextWritable.off('error', nextWritableErrorHandler);
      currentRun.stream.unpipe(currentGainTransform);
      currentGainTransform.unpipe(currentReplayGainTransform);
      currentReplayGainTransform.unpipe(levelMeterTransform);
      levelMeterTransform.unpipe(currentWritable);
      nextRun.stream.unpipe(nextGainTransform);
      nextGainTransform.unpipe(nextReplayGainTransform);
      nextReplayGainTransform.unpipe(nextWritable);
    };

    currentRun.stream.pipe(currentGainTransform).pipe(currentReplayGainTransform).pipe(levelMeterTransform).pipe(currentWritable, { end: false });
    nextRun.stream.pipe(nextGainTransform).pipe(nextReplayGainTransform).pipe(nextWritable, { end: false });
    levelMeterTransform.once('end', signalCurrentEnded);
    nextGainTransform.once('end', signalNextEnded);
    currentRun.done.then(signalCurrentEnded).catch((error: unknown) => {
      if (this.runToken === token) {
        this.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    });
    nextRun.done.then(signalNextEnded).catch((error: unknown) => {
      if (this.runToken === token) {
        this.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private startBitstreamRun(stream: Readable, writable: Writable, token: number): void {
    this.decoderPipelineCleanup?.();
    let inputEnded = false;
    const signalNativeInputEnded = (): void => {
      if (inputEnded || this.runToken !== token) {
        return;
      }

      inputEnded = true;
      try {
        writable.end();
      } catch {
        // The native host may already have been stopped by pause/seek/stop.
      }
    };

    const handlePipelineError = (stage: string) => (error: unknown): void => {
      if (this.runToken !== token) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.handleError(new Error(`${stage}: ${message}`));
    };
    const streamErrorHandler = handlePipelineError('dsd_dop_stream_error');
    const writableErrorHandler = handlePipelineError('native_writable_error');

    stream.on('error', streamErrorHandler);
    writable.on('error', writableErrorHandler);
    this.decoderPipelineCleanup = (): void => {
      stream.off('error', streamErrorHandler);
      writable.off('error', writableErrorHandler);
      stream.unpipe(writable);
      stream.destroy();
    };
    stream.pipe(writable, { end: false });
    stream.once('end', signalNativeInputEnded);
    stream.once('close', signalNativeInputEnded);
  }

  private maybeAdvanceAutomix(token: number): void {
    const automix = this.activeAutomix;
    if (!automix || this.runToken !== token) {
      return;
    }

    const compositePositionSeconds = Math.max(0, this.clock.getPositionSeconds() - automix.compositeStartSeconds);
    let advanced = false;
    while (automix.nextTransitionIndex < automix.transitions.length) {
      const transition = automix.transitions[automix.nextTransitionIndex];
      const advanceAtSeconds = transition ? getAutomixAudibleAdvanceSeconds(transition) : 0;
      if (!transition || compositePositionSeconds < advanceAtSeconds) {
        break;
      }

      const nextPositionSeconds = transition.trackStartSourceSeconds + Math.max(0, compositePositionSeconds - transition.transitionStartSeconds);
      automix.nextTransitionIndex += 1;
      automix.fromTrackId = transition.fromTrackId;
      automix.nextTrackId = transition.nextTrackId;
      automix.nextFilePath = transition.nextFilePath;
      automix.nextInputHeaders = transition.nextInputHeaders;
      automix.nextProbe = transition.nextProbe;
      automix.nextReplayGain = transition.nextReplayGain;
      automix.transitionSeconds = transition.transitionSeconds;
      automix.transitionStartSeconds = transition.transitionStartSeconds;
      automix.plan = transition.plan;
      this.currentTrackId = transition.nextTrackId;
      this.currentFilePath = transition.nextFilePath;
      this.currentInputHeaders = transition.nextInputHeaders;
      this.currentProbe = transition.nextProbe;
      this.currentReplayGain = transition.nextReplayGain;
      this.currentReplayGainCalculation = this.calculateCurrentReplayGain();
      this.emit('automix-advance', {
        fromTrackId: transition.fromTrackId,
        toTrackId: transition.nextTrackId,
        transitionSeconds: transition.transitionSeconds,
        mode: transition.plan.mode,
        fallbackReason: transition.plan.fallbackReason,
        beatAligned: transition.plan.beatAligned,
        skipIntroSilence: transition.plan.skipIntroSilence,
        nextStartSeconds: nextPositionSeconds,
      });
      advanced = true;
    }
    if (advanced) {
      this.emitStatus();
    }
  }

  private handleAutomixV2TransitionCommitted(event: AutomixTransitionCommittedEventV2): void {
    const active = this.activeAutomixV2;
    if (!active || active.plan.planId !== event.planId
      || active.plan.queueRevision !== event.queueRevision
      || active.plan.fromItemId !== event.fromItemId
      || active.plan.toItemId !== event.toItemId) {
      this.addOutputWarning('automix_v2_stale_transition_event');
      return;
    }

    active.state = 'committed';
    this.currentQueueItemId = event.toItemId;
    this.currentQueueRevision = event.queueRevision;
    this.currentTrackId = event.toTrackId;
    this.currentFilePath = active.nextFilePath;
    this.currentInputHeaders = active.nextInputHeaders;
    this.currentTrackMetadata = active.nextMetadata;
    this.currentProbe = active.nextProbe;
    this.currentReplayGain = active.nextReplayGain;
    this.currentReplayGainCalculation = this.calculateCurrentReplayGain();
    this.clock.reset(event.sourcePositionSeconds, active.plan.mixSampleRate);
    this.emit('automix-advance', {
      fromTrackId: event.fromTrackId,
      toTrackId: event.toTrackId,
      fromItemId: event.fromItemId,
      toItemId: event.toItemId,
      queueRevision: event.queueRevision,
      planId: event.planId,
      transitionSeconds: active.plan.overlapFrames / active.plan.mixSampleRate,
      mode: active.plan.mode,
      fallbackReason: active.plan.fallbackReason,
      beatAligned: active.plan.mode === 'beat_match',
      skipIntroSilence: active.plan.nextStartSeconds > 0.12,
      nextStartSeconds: event.sourcePositionSeconds,
    });
    this.recordPlaybackDiagnosticEvent('ended', 'info', 'automix_v2_transition_committed', {
      trackId: event.toTrackId,
      filePath: active.nextFilePath,
      positionSeconds: event.sourcePositionSeconds,
      details: {
        planId: event.planId,
        queueRevision: event.queueRevision,
        operationId: event.operationId,
        outputFrame: event.outputFrame,
      },
    });
    this.emitStatus();
  }

  private handleQueueAdvance(params: Record<string, unknown>): void {
    if (typeof params.nextFilePath === 'string') {
      this.currentFilePath = params.nextFilePath;
      this.currentTrackId = typeof params.nextTrackId === 'string' ? params.nextTrackId : null;
      const metadata = params.nextMetadata && typeof params.nextMetadata === 'object' && !Array.isArray(params.nextMetadata)
        ? params.nextMetadata as Record<string, unknown>
        : null;
      this.currentTrackMetadata = metadata
        ? {
            title: typeof metadata.title === 'string' ? metadata.title : null,
            artist: typeof metadata.artist === 'string' ? metadata.artist : null,
            album: typeof metadata.album === 'string' ? metadata.album : null,
            albumArtist: typeof metadata.albumArtist === 'string' ? metadata.albumArtist : null,
            coverUrl: typeof metadata.coverUrl === 'string' ? metadata.coverUrl : null,
          }
        : null;
    }
    const nextSampleRate = Number(params.nextSampleRate);
    const nextSourceSampleRate = Number(params.nextSourceSampleRate);
    const nextChannels = Number(params.nextChannels);
    const nextDurationSeconds = Number(params.nextDurationSeconds);
    const nextStartSeconds = Number(params.nextStartSeconds);
    const nextQueueRevision = Number(params.queueRevision);
    this.currentQueueItemId = typeof params.nextItemId === 'string' ? params.nextItemId : null;
    this.currentQueueRevision = Number.isSafeInteger(nextQueueRevision) && nextQueueRevision > 0
      ? nextQueueRevision
      : null;
    this.currentProbe = {
      filePath: this.currentFilePath ?? '',
      fileSampleRate: Number.isFinite(nextSourceSampleRate) && nextSourceSampleRate > 0
        ? nextSourceSampleRate
        : Number.isFinite(nextSampleRate) && nextSampleRate > 0
          ? nextSampleRate
        : this.currentProbe?.fileSampleRate ?? null,
      channels: Number.isFinite(nextChannels) && nextChannels > 0
        ? Math.round(nextChannels)
        : this.currentProbe?.channels ?? 2,
      durationSeconds: Number.isFinite(nextDurationSeconds) && nextDurationSeconds > 0
        ? nextDurationSeconds
        : this.currentProbe?.durationSeconds ?? 0,
      codec: typeof params.nextCodec === 'string' ? params.nextCodec : this.currentProbe?.codec ?? null,
      bitDepth: typeof params.nextBitDepth === 'number' && Number.isFinite(params.nextBitDepth)
        ? params.nextBitDepth
        : null,
      bitrate: null,
    };
    if (this.currentPlan && Number.isFinite(nextSourceSampleRate) && nextSourceSampleRate > 0) {
      if (this.currentPlan.outputMode === 'shared') {
        this.currentPlan = {
          ...this.currentPlan,
          fileSampleRate: nextSourceSampleRate,
        };
      } else if (
        this.currentPlan.outputMode === 'asio' &&
        Number.isFinite(nextSampleRate) &&
        nextSampleRate > 0
      ) {
        const requestedSampleRate = Number(params.targetSampleRate);
        const actualSampleRate = Number(params.actualSampleRate);
        const nextRequestedSampleRate = Number.isFinite(requestedSampleRate) && requestedSampleRate > 0
          ? requestedSampleRate
          : nextSampleRate;
        const nextActualSampleRate = Number.isFinite(actualSampleRate) && actualSampleRate > 0
          ? actualSampleRate
          : nextSampleRate;
        const sampleRateMismatch = nextActualSampleRate !== nextRequestedSampleRate;
        const resampling = nextSourceSampleRate !== nextSampleRate
          || nextSampleRate !== nextActualSampleRate;
        this.currentPlan = {
          ...this.currentPlan,
          fileSampleRate: nextSourceSampleRate,
          decoderOutputSampleRate: nextSampleRate,
          requestedOutputSampleRate: nextRequestedSampleRate,
          actualDeviceSampleRate: nextActualSampleRate,
          resampling,
          bitPerfectCandidate: this.currentPlan.dsdOutputMode === 'pcm'
            && !resampling
            && !sampleRateMismatch
            && this.currentPlan.echoSrcActive !== true
            && this.currentPlan.sdmPcmToDsdActive !== true,
          sampleRateMismatch,
        };
      }
    }
    const startSeconds = Number.isFinite(nextStartSeconds) ? Math.max(0, nextStartSeconds) : 0;
    this.clock.reset(startSeconds, Number.isFinite(nextSampleRate) && nextSampleRate > 0 ? nextSampleRate : null);
    this.state = 'playing';
    this.hostStatus = 'ready';
    this.recordPlaybackDiagnosticEvent('ended', 'info', 'daemon_queue_advance', {
      trackId: this.currentTrackId,
      filePath: this.currentFilePath,
      positionSeconds: startSeconds,
      details: {
        operationId: params.operationId ?? null,
        queueRevision: params.queueRevision ?? null,
        queueItemId: params.nextItemId ?? null,
        previousSampleRate: params.previousSampleRate ?? null,
        targetSampleRate: params.targetSampleRate ?? null,
        actualSampleRate: params.actualSampleRate ?? null,
        sampleRateTransitionMode: params.sampleRateTransitionMode ?? null,
        sampleRateTransitionDurationMs: params.sampleRateTransitionDurationMs ?? null,
      },
    });
    // The daemon is already playing the next track.
    // Emit status so the renderer updates its display.
    // Don't change state — position events from the daemon keep it 'playing'.
    this.emitStatus();
  }

  private handlePlaybackEnded(token: number): void {
    if (this.runToken !== token) {
      return;
    }

    if (this.state !== 'playing' && this.state !== 'loading') {
      this.recordPlaybackDiagnosticEvent('ended', 'info', 'ended_ignored_while_not_playing', {
        positionSeconds: this.clock.getPositionSeconds(),
        details: {
          token,
          state: this.state,
        },
      });
      return;
    }

    // AUTOMIX GATE: If activeAutomix has pending transitions, automix owns advancement.
    // Log and defer queue advance; do NOT block the ended event — the bridge path
    // uses ended+premature-detection to drive recovery, and the daemon path consumes
    // transitions via maybeAdvanceAutomix on position before reaching here.
    if (this.activeAutomix !== null && this.activeAutomix.nextTransitionIndex < this.activeAutomix.transitions.length) {
      this.logger(
        `[AudioSession] handlePlaybackEnded: automix has pending transitions ` +
        `(${this.activeAutomix.nextTransitionIndex}/${this.activeAutomix.transitions.length}), deferring advance`,
      );
    }

    // LIVE STREAM GUARD: If is a live PCM stream, skip advance
    if (this.isCurrentLivePcmStream()) {
      this.state = 'stopped';
      this.resetWatchdogProgress();
      this.emit('ended', this.getStatus());
      this.emitStatus();
      return;
    }

    this.activeAutomix = null;
    this.activeAutomixV2 = null;
    this.daemonGaplessActive = false;
    this.state = 'ended';
    this.resetWatchdogProgress();
    this.emit('ended', this.getStatus());
    this.emitStatus();
    this.recordPlaybackDiagnosticEvent('ended', 'info', 'ended', {
      positionSeconds: this.clock.getPositionSeconds(),
      durationSeconds: this.currentProbe?.durationSeconds ?? 0,
      details: { token },
    });
  }

  setRepeatMode(mode: RepeatMode): void {
    this.repeatMode = mode;
  }

  private enqueueNativeHostNotification(event: unknown, token: number): void {
    this.nativeHostNotificationQueue = this.nativeHostNotificationQueue
      .then(() => this.handleNativeHostNotification(event, token))
      .catch((error) => {
        this.logger(
          `[AudioSession] native host notification handler failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  private async handleNativeHostNotification(event: unknown, token: number): Promise<void> {
    if (
      this.runToken !== token ||
      !isNativeHostNotificationEvent(event) ||
      this.state !== 'playing' ||
      this.watchdogRecovering ||
      this.sharedStabilityRecovering ||
      !this.currentFilePath ||
      !this.currentOutputSettings ||
      !this.currentPlan ||
      !this.currentProbe ||
      !this.bridge
    ) {
      return;
    }

    const reason = typeof event.reason === 'string' && event.reason ? event.reason : 'unknown';
    const affectsCurrentOutput = event.currentDevice === true || event.followsDefaultDevice === true;
    let recoveryReason: string | null = null;

    if (event.event === 'audio_session_disconnected') {
      recoveryReason = `native_session_disconnected:${reason}`;
    } else if (event.event === 'default_device_changed' && affectsCurrentOutput) {
      recoveryReason = 'default_device_changed';
    } else if (event.event === 'device_removed' && affectsCurrentOutput) {
      recoveryReason = 'audio_device_removed';
    } else if (event.event === 'device_state_changed' && affectsCurrentOutput && inactiveDeviceReasons.has(reason)) {
      recoveryReason = `audio_device_state_changed:${reason}`;
    } else if (event.event === 'device_sample_rate_changed' && affectsCurrentOutput) {
      recoveryReason = `audio_device_sample_rate_changed:${event.code ?? 'unknown'}`;
    }

    if (!recoveryReason) {
      return;
    }

    const bridgePositionSeconds = this.bridge.getPositionSeconds();
    const positionSeconds = Number.isFinite(bridgePositionSeconds) ? bridgePositionSeconds : this.clock.getPositionSeconds();
    this.sharedStabilityRecovering = true;
    this.logger(
      `[AudioSession] ${recoveryReason}; restarting output after native host notification position=${positionSeconds.toFixed(3)}`,
    );

    const recoveryOptions: StabilityRecoveryOptions = {
      runToken: token,
      sharedStabilityRecoveryClaimed: true,
    };

    if (this.currentPlan.outputMode === 'exclusive' && event.event !== 'default_device_changed') {
      if (this.currentOutputSettings?.exclusiveInstabilityFallbackEnabled !== true) {
        this.sharedStabilityRecovering = false;
        this.addOutputWarning(recoveryReason);
        this.recordExclusiveInstabilityWithoutFallback(positionSeconds, recoveryReason, null);
        return;
      }
      this.addPendingOutputWarning(recoveryReason);
      await this.fallbackExclusiveToSharedForInstability(positionSeconds, recoveryOptions);
      return;
    }

    await this.recoverOutputStability(recoveryReason, positionSeconds, recoveryOptions);
  }

  private handleNativeTelemetry(
    telemetry: NativeOutputTelemetry,
    options: { suppressStartupTelemetryLog?: boolean } = {},
  ): void {
    const now = Date.now();
    this.nativeTelemetry = {
      positionFrames: Math.max(0, Math.round(Number(telemetry.positionFrames) || 0)),
      bufferedFrames:
        telemetry.bufferedFrames === null || telemetry.bufferedFrames === undefined
          ? null
          : Math.max(0, Math.round(Number(telemetry.bufferedFrames) || 0)),
      underrunCallbacks: Math.max(0, Math.round(Number(telemetry.underrunCallbacks) || 0)),
      underrunFrames: Math.max(0, Math.round(Number(telemetry.underrunFrames) || 0)),
      dspClippingRisk: telemetry.dspClippingRisk === true,
      dspLimiterProtecting: telemetry.dspLimiterProtecting === true,
      reportedAtMs:
        telemetry.reportedAtMs === null || telemetry.reportedAtMs === undefined
          ? null
          : Math.max(0, Number(telemetry.reportedAtMs) || 0),
      nativePositionStalenessMs:
        telemetry.nativePositionStalenessMs === null || telemetry.nativePositionStalenessMs === undefined
          ? null
          : Math.max(0, Math.round(Number(telemetry.nativePositionStalenessMs) || 0)),
    };

    if (this.state === 'playing') {
      if (options.suppressStartupTelemetryLog !== true) {
        this.logNativeStartupTelemetry(now);
      }
      void this.checkNativeUnderrunRecovery();
      this.emitNativeTelemetryStatus();
    }
  }

  private logNativeStartupTelemetry(now: number): void {
    if (!this.nativePlaybackStartedAtMs || !this.currentPlan) {
      return;
    }

    const elapsedMs = now - this.nativePlaybackStartedAtMs;
    if (
      elapsedMs < 0 ||
      elapsedMs > nativeStartupTelemetryLogWindowMs ||
      now - this.lastNativeStartupTelemetryLoggedAt < nativeStartupTelemetryLogIntervalMs
    ) {
      return;
    }

    this.lastNativeStartupTelemetryLoggedAt = now;
    const sampleRate = this.currentPlan.actualDeviceSampleRate ?? this.currentPlan.requestedOutputSampleRate;
    const nativeBufferedMs =
      sampleRate && this.nativeTelemetry.bufferedFrames !== null
        ? Math.round((this.nativeTelemetry.bufferedFrames / sampleRate) * 1000)
        : null;
    const playbackRate = Math.max(
      0.25,
      Math.min(4, Number(this.currentOutputSettings?.playbackRate ?? this.outputSettings.playbackRate) || 1),
    );
    const startupElapsedSeconds = elapsedMs / 1000;
    const startupExpectedPositionSeconds = this.nativePlaybackStartPositionSeconds + startupElapsedSeconds * playbackRate;
    const startupPositionDriftSeconds = this.clock.getPositionSeconds() - startupExpectedPositionSeconds;
    const baseline = this.nativeStartupUnderrunBaseline;

    this.recordPlaybackDiagnosticEvent('startup_telemetry', 'info', 'native_startup_telemetry', {
      positionSeconds: this.clock.getPositionSeconds(),
      outputMode: this.currentPlan.outputMode,
      outputBackend: this.currentOutputBackend,
      outputBackendImpl: this.currentOutputBackendImpl,
      details: {
        startupElapsedMs: Math.round(elapsedMs),
        startupExpectedPositionSeconds,
        startupPositionDriftSeconds,
        nativeBufferedMs,
        nativeBufferedFrames: this.nativeTelemetry.bufferedFrames,
        nativeUnderrunCallbackDelta: baseline ? this.nativeTelemetry.underrunCallbacks - baseline.underrunCallbacks : 0,
        nativeUnderrunFrameDelta: baseline ? this.nativeTelemetry.underrunFrames - baseline.underrunFrames : 0,
        nativeActualBufferFrames: this.nativeActualBufferFrames,
        nativeFifoCapacityFrames: this.nativeFifoCapacityFrames,
        nativeStartupPrebufferFrames: this.nativeStartupPrebufferFrames,
        nativePositionStalenessMs: this.nativeTelemetry.nativePositionStalenessMs ?? null,
      },
    });
  }

  private async checkNativeUnderrunRecovery(): Promise<void> {
    const token = this.runToken;

    try {
      if (
        this.state !== 'playing' ||
        this.watchdogRecovering ||
        this.sharedStabilityRecovering ||
        !this.currentFilePath ||
        !this.currentOutputSettings ||
        !this.currentPlan ||
        !this.currentProbe
      ) {
        return;
      }

      const now = Date.now();
      if (
        this.currentPlan.outputMode === 'exclusive' &&
        this.nativePlaybackStartedAtMs > 0 &&
        now - this.nativePlaybackStartedAtMs < exclusiveNativeUnderrunStartupGraceMs
      ) {
        this.nativeUnderrunWindow = {
          startedAt: now,
          callbacks: this.nativeTelemetry.underrunCallbacks,
          frames: this.nativeTelemetry.underrunFrames,
        };
        return;
      }

      if (!this.nativeUnderrunWindow || now - this.nativeUnderrunWindow.startedAt > nativeUnderrunWindowMs) {
        this.nativeUnderrunWindow = {
          startedAt: now,
          callbacks: this.nativeTelemetry.underrunCallbacks,
          frames: this.nativeTelemetry.underrunFrames,
        };
        return;
      }

      const callbackDelta = this.nativeTelemetry.underrunCallbacks - this.nativeUnderrunWindow.callbacks;
      const frameDelta = this.nativeTelemetry.underrunFrames - this.nativeUnderrunWindow.frames;
      const sampleRate = this.currentPlan.actualDeviceSampleRate ?? this.currentPlan.requestedOutputSampleRate;
      const frameThreshold = Math.max(1, Math.round((sampleRate * nativeUnderrunFramesThresholdMs) / 1000));

      if (callbackDelta < nativeUnderrunCallbackThreshold && frameDelta < frameThreshold) {
        return;
      }

      if (
        (this.currentPlan.outputMode === 'exclusive' || this.currentPlan.outputMode === 'shared') &&
        frameDelta < frameThreshold
      ) {
        return;
      }

      const positionSeconds = this.clock.getPositionSeconds();
      const nativeUnderrunDelta = {
        callbackDelta,
        frameDelta,
        windowMs: Math.max(0, now - this.nativeUnderrunWindow.startedAt),
      };
      if (this.currentPlan.outputMode === 'exclusive') {
        await this.recoverOutputStability('exclusive_output_underrun_detected', positionSeconds, {
          runToken: token,
          nativeUnderrunDelta,
        });
        return;
      }

      const reason = this.currentPlan.outputMode === 'shared' ? 'shared_output_underrun_detected' : 'native_output_underrun_detected';
      await this.recoverOutputStability(reason, positionSeconds, { runToken: token, nativeUnderrunDelta });
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private stopDecoderRun(): Promise<void> | null {
    const previousStop = this.decoderStopInProgress;
    this.decoderPipelineCleanup?.();
    this.decoderPipelineCleanup = null;

    const run = this.decoderRun;
    this.decoderRun = null;
    if (run) {
    try {
      run.stream.unpipe();
    } catch {
    }
    try {
      run.stream.destroy();
    } catch {
    }
      run.stop();
    }

    if (this.gainTransform) {
      try {
        this.gainTransform.destroy();
      } catch {
      }
      this.gainTransform = null;
    }

    if (this.speedTransform) {
      try {
        this.speedTransform.destroy();
      } catch {
      }
      this.speedTransform = null;
    }

    if (this.levelMeterTransform) {
      try {
        this.levelMeterTransform.destroy();
      } catch {
      }
      this.levelMeterTransform = null;
    }

    if (!previousStop && run?.waitForExitOnStop !== true) {
      return null;
    }

    const stopPromise = (async (): Promise<void> => {
      if (previousStop) {
        try {
          await previousStop;
        } catch {
          // Prior cleanup already logged or was superseded.
        }
      }

      if (run?.waitForExitOnStop === true) {
        await this.waitForDecoderRunExit(run);
      }
    })();

    this.decoderStopInProgress = stopPromise;
    return stopPromise.finally(() => {
      if (this.decoderStopInProgress === stopPromise) {
        this.decoderStopInProgress = null;
      }
    });
  }

  private async waitForDecoderRunExit(run: DecoderRun): Promise<void> {
    if (await this.waitForDecoderRunDone(run, decoderStopTimeoutMs)) {
      return;
    }

    this.forceCleanupDecoderRun(run);
    if (await this.waitForDecoderRunDone(run, decoderStopForcedExitWaitMs)) {
      return;
    }

    this.logger('[AudioSession] decoder process still did not exit after forced cleanup; continuing');
  }

  private async waitForDecoderRunDone(run: DecoderRun, timeoutMs: number): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let exited = false;

    try {
      exited = await Promise.race([
        run.done.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => {
            resolve(false);
          }, timeoutMs);
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }

    return exited;
  }

  private forceCleanupDecoderRun(run: DecoderRun): void {
    try {
      run.stop();
    } catch {
    }
    try {
      run.stream.destroy();
    } catch {
    }
  }

  private resetLevelMeter(): void {
    this.levelMeterTransform?.reset();
    this.nativeAudioLevels = null;
    this.levelSnapshot = {
      inputPeakDb: null,
      inputRmsDb: null,
      visualSpectrum: Array.from({ length: visualSpectrumBucketCount }, () => 0),
      visualSpectrumVersion: 2,
      visualEnergy: 0,
      visualTransient: 0,
      visualTelemetryState: 'fallback',
      clipCount: 0,
      lastClipAt: null,
      levelMeterObserveCostMs: 0,
      visualSpectrumComputeCostMs: 0,
    };
    this.lastLevelMeterStatusEmittedAt = 0;
  }

  private resetNativeTelemetry(): void {
    this.nativeAudioLevels = null;
    this.nativeDeviceBufferFrames = null;
    this.nativeRequestedBufferFrames = null;
    this.nativeActualBufferFrames = null;
    this.nativeFifoCapacityFrames = null;
    this.nativeStartupPrebufferFrames = null;
    this.nativeTelemetry = {
      positionFrames: 0,
      bufferedFrames: null,
      underrunCallbacks: 0,
      underrunFrames: 0,
      dspClippingRisk: false,
      dspLimiterProtecting: false,
      reportedAtMs: null,
      nativePositionStalenessMs: null,
    };
    this.lastNativeTelemetryStatusEmittedAt = 0;
    this.lastLevelMeterStatusEmittedAt = 0;
    this.nativePlaybackStartedAtMs = 0;
    this.nativePlaybackStartPositionSeconds = 0;
    this.lastNativeStartupTelemetryLoggedAt = 0;
    this.nativeStartupUnderrunBaseline = null;
    this.nativeUnderrunWindow = null;
  }

  private shouldClearSharedStabilityMemory(settings: AudioOutputSettings): boolean {
    return (
      hasOwn(settings, 'latencyProfile') ||
      hasOwn(settings, 'bufferSizeFrames') ||
      hasOwn(settings, 'deviceIndex') ||
      hasOwn(settings, 'deviceName')
    );
  }

  private pruneSharedStabilityMemory(now = Date.now()): void {
    for (const [key, record] of this.sharedStabilityMemory.entries()) {
      if (record.expiresAt <= now) {
        this.sharedStabilityMemory.delete(key);
      }
    }
  }

  private createSharedStabilityMemoryKey(
    settings: AudioOutputSettings,
    device: AudioDeviceInfo | null,
  ): string | null {
    if (normalizeOutputMode(settings.outputMode) !== 'shared') {
      return null;
    }

    const explicitDeviceIndex = Number.isInteger(Number(settings.deviceIndex)) ? Number(settings.deviceIndex) : null;
    const explicitDevice = hasExplicitDeviceSelection(settings);
    const readyDefaultDevice = !explicitDevice && typeof device?.id === 'string' && device.id.endsWith(':ready');
    const deviceIndex = readyDefaultDevice ? explicitDeviceIndex : Number.isInteger(Number(device?.index)) ? Number(device?.index) : explicitDeviceIndex;
    const deviceName = readyDefaultDevice ? 'default' : device?.name ?? settings.deviceName ?? 'default';

    return JSON.stringify({
      sharedBackend: normalizeSharedBackend(settings.sharedBackend),
      deviceId: readyDefaultDevice ? null : device?.id ?? null,
      deviceIndex,
      deviceName,
      explicitDevice,
    });
  }

  private getRememberedSharedStabilityTier(
    settings: AudioOutputSettings,
    device: AudioDeviceInfo | null,
  ): SharedStabilityTier | null {
    const key = this.createSharedStabilityMemoryKey(settings, device);
    if (!key) {
      return null;
    }

    const now = Date.now();
    this.pruneSharedStabilityMemory(now);
    const record = this.sharedStabilityMemory.get(key);
    return record && record.expiresAt > now ? record.tier : null;
  }

  private rememberSharedStabilityTier(
    settings: AudioOutputSettings,
    device: AudioDeviceInfo | null,
    tier: SharedStabilityTier,
  ): void {
    const key = this.createSharedStabilityMemoryKey(settings, device);
    if (!key) {
      return;
    }

    this.pruneSharedStabilityMemory();
    this.sharedStabilityMemory.set(key, {
      tier,
      expiresAt: Date.now() + sharedStabilityMemoryTtlMs,
    });
    this.lastSharedStabilityRecoveryKey = key;
  }

  private resetSharedStabilityForFreshPlayback(
    outputMode: AudioOutputMode,
    settings: AudioOutputSettings | null = this.currentOutputSettings,
    device: AudioDeviceInfo | null = this.currentDevice,
  ): void {
    if (outputMode === 'shared' && !this.watchdogRecovering && !this.sharedStabilityRecovering) {
      const key = settings ? this.createSharedStabilityMemoryKey(settings, device) : null;
      const lastRecoveryAtMs = this.lastSharedStabilityRecoveryAt ? Date.parse(this.lastSharedStabilityRecoveryAt) : Number.NaN;
      const recentSameDeviceRecovery =
        key !== null &&
        key === this.lastSharedStabilityRecoveryKey &&
        this.sharedStabilityTier !== 'standard' &&
        Number.isFinite(lastRecoveryAtMs) &&
        Date.now() - lastRecoveryAtMs < sharedStabilityMemoryTtlMs
          ? this.sharedStabilityTier
          : null;
      this.sharedStabilityTier = settings
        ? this.getRememberedSharedStabilityTier(settings, device) ?? recentSameDeviceRecovery ?? 'standard'
        : recentSameDeviceRecovery ?? 'standard';
    }
  }

  private handleLevelSnapshot(snapshot: PcmLevelSnapshot): void {
    const audioVisualSpectrumEnabled = isAudioVisualSpectrumEnabled();
    const statusIntervalMs = audioVisualSpectrumEnabled ? levelMeterStatusIntervalMs : levelMeterNonVisualStatusIntervalMs;
    this.levelMeterTransform?.setVisualSpectrumEnabled(audioVisualSpectrumEnabled);
    this.levelSnapshot = audioVisualSpectrumEnabled ? snapshot : this.createLevelSnapshotWithoutVisualTelemetry(snapshot);
    if (this.state === 'playing') {
      const now = Date.now();
      if (now - this.lastLevelMeterStatusEmittedAt >= statusIntervalMs) {
        this.lastLevelMeterStatusEmittedAt = now;
        this.emitStatus();
      }
    }
  }

  private createLevelSnapshotWithoutVisualTelemetry(snapshot: PcmLevelSnapshot): PcmLevelSnapshot {
    return {
      ...snapshot,
      visualSpectrum: this.disabledVisualSpectrum,
      visualEnergy: 0,
      visualTransient: 0,
      visualTelemetryState: 'fallback',
    };
  }

  private disposeActiveDaemonBackend(): void {
    if (!this.activeDaemonBackend) return;
    try {
      this.activeDaemonBackend.dispose();
    } catch {
    }
    this.activeDaemonBackend = null;
    this.activeDaemonRemoteSource = false;
    this.daemonGaplessActive = false;
  }

  private queueActiveDaemonStop(reason: string): void {
    if (!this.activeDaemonBackend) {
      return;
    }

    const backend = this.activeDaemonBackend;
    this.activeDaemonBackend = null;
    this.activeDaemonRemoteSource = false;
    this.daemonGaplessActive = false;
    const stopPromise = backend.stop()
      .catch((error) => {
        this.logger(`[AudioSession] daemon stop failed (${reason}): ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        try {
          backend.dispose();
        } catch {
        }
        if (this.daemonStopInProgress === stopPromise) {
          this.daemonStopInProgress = null;
        }
      });
    this.daemonStopInProgress = stopPromise;
  }

  private async stopActiveDaemonBackend(reason: string): Promise<void> {
    this.queueActiveDaemonStop(reason);
    if (this.daemonStopInProgress) {
      await this.daemonStopInProgress;
    }
  }

  /** Sync the playback queue to the daemon backend for autonomous advancement. */
  async syncQueueToBackend(
    items: AudioBackendQueueItem[],
    repeatMode: RepeatMode = 'off',
    currentItemId: string | null = null,
  ): Promise<void> {
    this.queueRevision += 1;
    this.queueSnapshot = {
      revision: this.queueRevision,
      currentItemId,
      repeatMode,
      items: items.map((item) => ({ ...item })),
    };
    this.currentQueueItemId = currentItemId;
    this.currentQueueRevision = this.queueRevision;
    const backend = this.activeDaemonBackend;
    if (backend) {
      if (this.activeDaemonRemoteSource) {
        await backend.clearQueue();
      } else {
        await backend.setQueue(this.createDaemonQueueSnapshotForCurrentPlan());
        const activePlan = this.activeAutomixV2;
        if (activePlan && automixV2NativeEnabled
            && (activePlan.state === 'preparing'
              || activePlan.state === 'armed'
              || activePlan.state === 'committed')) {
          const daemonAutomixState = await backend.getAutomixStateV2();
          if (daemonAutomixState.planId === activePlan.plan.planId
              && daemonAutomixState.state === 'committed') {
            activePlan.plan.queueRevision = this.queueSnapshot.revision;
            activePlan.state = 'committed';
          } else if (daemonAutomixState.state === 'idle'
              || daemonAutomixState.planId !== activePlan.plan.planId) {
            activePlan.state = 'fallback';
            this.addOutputWarning('automix_v2_cancelled_by_queue_revision');
          } else {
            activePlan.state = daemonAutomixState.state;
          }
        }
      }
    }
  }

  private async replayQueueSnapshotToDaemonBackend(backend: DaemonAudioBackend): Promise<void> {
    if (this.queueSnapshot.revision <= 0) {
      return;
    }
    await backend.setQueue(this.createDaemonQueueSnapshotForCurrentPlan());
  }

  private async finalizeNaturalDaemonEnd(token: number): Promise<void> {
    await this.stopActiveDaemonBackend('daemon-natural-end');
    if (this.runToken !== token) {
      return;
    }
    this.handlePlaybackEnded(token);
  }

  private createDaemonQueueSnapshotForCurrentPlan(): AudioBackendQueueSnapshot {
    const snapshot: AudioBackendQueueSnapshot = {
      ...this.queueSnapshot,
      items: this.queueSnapshot.items.map((item) => ({ ...item })),
    };
    const strictAsioPcmQueue = this.currentPlan?.outputMode === 'asio'
      && this.currentPlan.dsdOutputMode === 'pcm'
      && this.currentPlan.echoSrcActive !== true
      && this.currentPlan.sdmPcmToDsdActive !== true;
    const hasCompleteSampleRateMetadata = snapshot.items.every((item) =>
      normalizeAudioSampleRate(item.sampleRate) !== null);
    if (
      this.currentPlan?.outputMode === 'shared' ||
      (strictAsioPcmQueue && hasCompleteSampleRateMetadata)
    ) {
      return snapshot;
    }

    const sourceSampleRate = normalizeAudioSampleRate(this.currentProbe?.fileSampleRate);
    if (!sourceSampleRate) {
      return {
        ...snapshot,
        currentItemId: null,
        repeatMode: 'off',
        items: [],
      };
    }

    const currentIndex = snapshot.items.findIndex((item) =>
      (snapshot.currentItemId !== null && item.itemId === snapshot.currentItemId) ||
      (snapshot.currentItemId === null && this.currentFilePath !== null && item.filePath === this.currentFilePath));
    if (currentIndex < 0) {
      return {
        ...snapshot,
        currentItemId: null,
        repeatMode: 'off',
        items: [],
      };
    }

    const currentItem = {
      ...snapshot.items[currentIndex]!,
      sampleRate: sourceSampleRate,
    };
    if (snapshot.repeatMode === 'one') {
      return {
        ...snapshot,
        currentItemId: currentItem.itemId,
        items: [currentItem],
      };
    }

    const allItemsRateCompatible = snapshot.items.every((item) =>
      normalizeAudioSampleRate(item.sampleRate) === sourceSampleRate);
    if (snapshot.repeatMode === 'all' && allItemsRateCompatible) {
      return snapshot;
    }

    const compatibleItems = [currentItem];
    for (let index = currentIndex + 1; index < snapshot.items.length; index += 1) {
      const item = snapshot.items[index]!;
      if (normalizeAudioSampleRate(item.sampleRate) !== sourceSampleRate) {
        break;
      }
      compatibleItems.push({ ...item, sampleRate: sourceSampleRate });
    }

    return {
      ...snapshot,
      currentItemId: currentItem.itemId,
      repeatMode: 'off',
      items: compatibleItems,
    };
  }

  private stopResources(options: { preservePausedDecoderPrewarm?: boolean } = {}): void {
    this.queueActiveDaemonStop('synchronous-resource-stop');
    this.cancelTransportFade();
    this.pausedOutputPrewarmPromise = null;
    if (options.preservePausedDecoderPrewarm !== true) {
      this.stopPausedDecoderPrewarm();
    }
    void this.stopDecoderRun();

    if (this.bridge) {
      this.detachBridgeEvents(this.bridge);
      try {
        this.bridge.stop();
      } catch {
        // Emergency cleanup must stay synchronous and best-effort.
      }
      this.bridge = null;
      this.currentReadyResult = null;
      this.currentBridgeOutputMode = null;
      this.currentBridgeSharedBackend = null;
      this.currentResidentOutputSampleRate = null;
    }
  }

  private async stopResourcesGracefully(reason: string, waitForExitOverride?: boolean): Promise<void> {
    if (this.activeDaemonBackend || this.daemonStopInProgress) {
      await this.stopActiveDaemonBackend(reason);
    }
    this.pausedOutputPrewarmPromise = null;
    this.stopPausedDecoderPrewarm();
    const decoderStop = this.stopDecoderRun();
    if (decoderStop) {
      await decoderStop;
    }

    const bridge = this.bridge;
    if (!bridge) {
      this.currentReadyResult = null;
      this.currentBridgeOutputMode = null;
      this.currentBridgeSharedBackend = null;
      this.currentResidentOutputSampleRate = null;
      if (this.bridgeStopInProgress) {
        await this.bridgeStopInProgress;
      }
      return;
    }

    const timeoutMs = bridge.stopGracefully ? this.getGracefulStopTimeoutMs(reason) : undefined;
    const waitForExit = bridge.stopGracefully
      ? waitForExitOverride ?? this.getGracefulStopWaitForExit(reason)
      : false;
    this.bridge = null;
    this.detachBridgeEvents(bridge);
    this.currentReadyResult = null;
    this.currentBridgeOutputMode = null;
    this.currentBridgeSharedBackend = null;
    this.currentResidentOutputSampleRate = null;

    const stopPromise = (async (): Promise<void> => {
      try {
        if (bridge.stopGracefully) {
          await this.stopBridgeWithOptions(bridge, reason, timeoutMs, waitForExit);
        } else {
          bridge.stop();
        }
      } catch (error) {
        this.logger(`[AudioSession] graceful stop failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    this.bridgeStopInProgress = stopPromise;

    try {
      await stopPromise;
    } finally {
      if (this.bridgeStopInProgress === stopPromise) {
        this.bridgeStopInProgress = null;
      }
      if (this.bridge === bridge) {
        this.detachBridgeEvents(bridge);
        this.bridge = null;
      }
      this.currentReadyResult = null;
      this.currentBridgeOutputMode = null;
      this.currentBridgeSharedBackend = null;
      this.currentResidentOutputSampleRate = null;
    }
  }




  private handleError(error: Error): void {
    this.logger(`[AudioSession] ${error.message}`);
    if (isAudioSessionRunCancelledError(error)) {
      this.logger('[AudioSession] ignored superseded playback run cancellation');
      return;
    }

    if (this.tryRecoverDaemonRemotePlaybackError(error)) {
      return;
    }

    if (this.tryRecoverNativeDirectLocalPlaybackError(error)) {
      return;
    }

    if (this.tryRecoverLocalDecodeError(error)) {
      return;
    }

    if (this.tryClaimRecoverableAudioError(error)) {
      this.stopResources();
      this.errorMessage = null;
      this.state = 'loading';
      this.hostStatus = 'starting';
      this.resetWatchdogProgress();
      this.emitStatus();
      return;
    }

    if (
      this.state === 'loading' &&
      (this.currentPlan?.outputMode === 'asio' || this.currentPlan?.outputMode === 'exclusive')
    ) {
      this.deviceService.invalidateCache?.();
    }

    this.stopResources();
    this.errorMessage = error.message;
    this.state = 'error';
    this.hostStatus = 'error';
    this.reportFatalAudioError(error);
    this.resetWatchdogProgress();
    this.emit('error', error, this.getStatus());
    this.emitStatus();
  }

  private tryRecoverDaemonRemotePlaybackError(error: Error): boolean {
    if (
      this.state !== 'playing' ||
      !this.currentFilePath ||
      !this.currentOutputSettings ||
      !this.currentProbe ||
      !this.currentPlan ||
      this.activeAutomix ||
      !this.activeDaemonRemoteSource ||
      !isHttpPlaybackUrl(this.currentFilePath) ||
      this.currentDecodeBackendImpl !== 'native-direct-daemon-libav' ||
      !recoverableDaemonRemotePlaybackErrorPattern.test(error.message) ||
      getNativeDspLegacyFallbackBlockReason(this.currentPlan, this.currentOutputSettings) !== null ||
      !this.reserveLocalPlaybackRecoverySlot('daemon_remote_decode_error')
    ) {
      return false;
    }

    this.updatePositionFromOutput();
    const filePath = this.currentFilePath;
    const trackId = this.currentTrackId;
    const metadata = this.currentTrackMetadata ?? undefined;
    const replayGain = this.currentReplayGain;
    const inputHeaders = this.currentInputHeaders ? { ...this.currentInputHeaders } : undefined;
    const output = { ...this.currentOutputSettings };
    const probe = createProbeHint(this.currentProbe);
    const safePositionSeconds = Math.min(
      Math.max(0, this.clock.getPositionSeconds()),
      this.currentProbe.durationSeconds || Number.POSITIVE_INFINITY,
    );
    const fallbackCause = /\b(?:daemon_)?rpc_bridge_(?:closed|not_open)\b/iu.test(error.message)
      ? 'transport_closed'
      : 'decode_error';

    this.addPendingOutputWarning(`daemon_remote_decode_fell_back_to_pcm:${fallbackCause}`);
    this.recordPlaybackDiagnosticEvent(
      'watchdog_recovery',
      'recovery',
      'daemon_remote_decode_fell_back_to_pcm',
      {
        trackId,
        filePath,
        positionSeconds: safePositionSeconds,
        durationSeconds: this.currentProbe.durationSeconds,
        details: {
          cause: error.message,
          fallbackBackend: 'legacy-pcm',
        },
      },
    );
    this.logger(
      `[AudioSession] remote daemon playback failed; falling back to PCM decoder file="${redactUrlSecrets(
        filePath,
      )}" position=${safePositionSeconds.toFixed(3)} cause=${error.message}`,
    );

    void this.playLocalFile({
      filePath,
      trackId: trackId ?? undefined,
      metadata,
      replayGain,
      startSeconds: safePositionSeconds,
      output,
      probe,
      inputHeaders,
      remoteDaemonPlaybackFallbackAttempt: true,
    }).catch((recoveryError) => {
      if (isAudioSessionRunCancelledError(recoveryError)) {
        this.verboseLogger('[AudioSession] remote daemon PCM fallback was superseded by a newer playback run');
        return;
      }

      this.handleError(recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError)));
    });
    return true;
  }

  private tryRecoverNativeDirectLocalPlaybackError(error: Error): boolean {
    if (
      this.state !== 'playing' ||
      !this.currentFilePath ||
      !this.currentOutputSettings ||
      !this.currentProbe ||
      this.activeAutomix ||
      !isLocalPlaybackPath(this.currentFilePath) ||
      !isNativeDirectLocalPlaybackBackend(this.currentDecodeBackendImpl) ||
      !nativeDirectLocalPlaybackErrorPattern.test(error.message) ||
      !this.reserveLocalPlaybackRecoverySlot('native_direct_local_playback')
    ) {
      return false;
    }

    this.updatePositionFromOutput();
    const positionSeconds = this.clock.getPositionSeconds();
    const safePositionSeconds = Math.min(
      Math.max(0, positionSeconds),
      this.currentProbe.durationSeconds || Number.POSITIVE_INFINITY,
    );
    const output = {
      ...this.currentOutputSettings,
      nativeDirectLocalPlaybackEnabled: false,
    };

    this.addPendingOutputWarning('native_direct_local_playback_failed');
    this.addPendingOutputWarning('native_direct_local_playback_fell_back_to_pcm');
    this.addPendingOutputWarning('native_direct_local_playback_not_applied:reader_failed');
    this.recordPlaybackDiagnosticEvent('watchdog_recovery', 'recovery', 'native_direct_local_playback_fell_back_to_pcm', {
      trackId: this.currentTrackId,
      filePath: this.currentFilePath,
      positionSeconds: safePositionSeconds,
      durationSeconds: this.currentProbe.durationSeconds,
      outputMode: this.currentPlan?.outputMode ?? normalizeOutputMode(this.currentOutputSettings.outputMode),
      details: {
        cause: error.message,
        fileSampleRate: this.currentPlan?.fileSampleRate ?? null,
        decoderOutputSampleRate: this.currentPlan?.decoderOutputSampleRate ?? null,
        requestedOutputSampleRate: this.currentPlan?.requestedOutputSampleRate ?? null,
        actualDeviceSampleRate: this.currentPlan?.actualDeviceSampleRate ?? null,
      },
    });
    this.logger(
      `[AudioSession] native direct local playback failed; falling back to PCM decoder file="${redactUrlSecrets(
        this.currentFilePath,
      )}" position=${safePositionSeconds.toFixed(3)} cause=${error.message}`,
    );

    void this.playLocalFile({
      filePath: this.currentFilePath,
      trackId: this.currentTrackId ?? undefined,
      metadata: this.currentTrackMetadata ?? undefined,
      replayGain: this.currentReplayGain,
      startSeconds: safePositionSeconds,
      output,
      probe: createProbeHint(this.currentProbe),
      inputHeaders: this.currentInputHeaders ?? undefined,
    }).catch((recoveryError) => {
      if (isAudioSessionRunCancelledError(recoveryError)) {
        this.verboseLogger('[AudioSession] native direct fallback was superseded by a newer playback run');
        return;
      }

      this.handleError(recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError)));
    });
    return true;
  }

  private tryRecoverLocalDecodeError(error: Error): boolean {
    if (
      this.state !== 'playing' ||
      !this.currentFilePath ||
      !this.currentOutputSettings ||
      !this.currentProbe ||
      this.activeAutomix ||
      !isLocalPlaybackPath(this.currentFilePath) ||
      !recoverableLocalDecodeErrorPattern.test(error.message) ||
      !this.reserveLocalPlaybackRecoverySlot('local_decode_error')
    ) {
      return false;
    }

    const token = this.runToken;
    this.updatePositionFromOutput();
    const positionSeconds = this.clock.getPositionSeconds();
    void this.recoverLocalPlaybackRestart(
      token,
      'local_decode_error_recovered',
      positionSeconds,
      this.currentProbe.durationSeconds,
      { cause: error },
    );
    return true;
  }

  private tryClaimRecoverableAudioError(error: Error): boolean {
    if (!this.audioErrorRecoveryHandler) {
      return false;
    }

    try {
      return this.audioErrorRecoveryHandler(error, this.getStatus()) === true;
    } catch (recoveryError) {
      this.logger(`[AudioSession] audio error recovery handler failed: ${
        recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
      }`);
      return false;
    }
  }

  private assertCurrentRun(token: number): void {
    if (this.runToken !== token) {
      throw new Error('audio_session_run_cancelled');
    }
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  private markNativeStartupStatusGuard(): void {
    this.nativeStartupStatusGuardActive = true;
    this.nativePlaybackStartedAtMs = Date.now();
    this.nativePlaybackStartPositionSeconds =
      this.nativePositionReportedBeforePlaying && this.nativePositionBeforePlayingBaselineSeconds !== null
        ? this.nativePositionBeforePlayingBaselineSeconds
        : this.clock.getPositionSeconds();
    this.lastNativeStartupTelemetryLoggedAt = 0;
    this.nativeStartupUnderrunBaseline = {
      underrunCallbacks: this.nativeTelemetry.underrunCallbacks,
      underrunFrames: this.nativeTelemetry.underrunFrames,
    };
    this.nativeUnderrunWindow = null;
  }

  private isCurrentLivePcmStream(): boolean {
    return isLivePcmSourcePath(this.currentFilePath) || (
      this.currentFilePath !== null &&
      this.currentDecodeBackendImpl === 'airplay-raop-pcm'
    );
  }

  private skipLivePcmRestart(reason: string, positionSeconds: number): void {
    this.addOutputWarning('live_pcm_restart_skipped');
    this.recordPlaybackDiagnosticEvent('live_restart_skipped', 'suspect', reason, {
      positionSeconds,
      details: {
        source: 'live_pcm_stream',
      },
    });
    this.logger(
      `[AudioSession] ${reason}; live PCM stream cannot be restarted source="${redactUrlSecrets(
        this.currentFilePath ?? 'unknown',
      )}" position=${Math.max(0, positionSeconds).toFixed(3)}`,
    );
    this.resetWatchdogProgress();
    this.emitStatus();
  }

  private createLivePcmResamplerTransform(): PcmLinearResamplerTransform | null {
    if (!this.isCurrentLivePcmStream() || !this.currentProbe || !this.currentPlan) {
      return null;
    }

    const sourceSampleRate = normalizeAudioSampleRate(this.currentProbe.fileSampleRate);
    const targetSampleRate =
      normalizeAudioSampleRate(this.currentPlan.actualDeviceSampleRate) ?? normalizeAudioSampleRate(this.currentPlan.decoderOutputSampleRate);
    const channels = normalizePositiveInteger(this.currentProbe.channels) ?? 2;
    if (!sourceSampleRate || !targetSampleRate || sourceSampleRate === targetSampleRate) {
      return null;
    }

    this.addOutputWarning(`live_pcm_resampled:${sourceSampleRate}->${targetSampleRate}`);
    this.logger(
      `[AudioSession] live PCM resampler enabled source=${sourceSampleRate} target=${targetSampleRate} channels=${channels}`,
    );
    return new PcmLinearResamplerTransform(channels, sourceSampleRate, targetSampleRate);
  }

  private emitNativeTelemetryStatus(): void {
    const now = Date.now();
    if (now - this.lastNativeTelemetryStatusEmittedAt < nativeTelemetryStatusIntervalMs) {
      return;
    }

    this.lastNativeTelemetryStatusEmittedAt = now;
    this.emitStatus();
  }

  private isNativeStartupPositionGuardActive(now: number): boolean {
    return (
      this.nativePlaybackStartedAtMs > 0 &&
      now - this.nativePlaybackStartedAtMs <= nativeStartupPositionGuardWindowMs
    );
  }

  private handlePositionSample(token: number, positionSeconds: number, _telemetry: NativeOutputTelemetry | null, sampledAtMs = Date.now()): void {
    if (!Number.isFinite(positionSeconds)) {
      this.lastPositionSample = null;
      return;
    }

    const currentSample: PositionSample = {
      token,
      trackId: this.currentTrackId,
      filePath: this.currentFilePath,
      positionSeconds,
      sampledAtMs,
    };
    this.lastPositionSample = currentSample;
  }

  private createGuardedPositionJumpRebase(
    reportedPositionSeconds: number,
    now: number,
    previousPositionHintSeconds: number,
    options: { ignorePreviousSample?: boolean } = {},
  ): number | null {
    const previousSample = options.ignorePreviousSample ? null : this.lastPositionSample;
    const startupGuardActive = this.isNativeStartupPositionGuardActive(now);
    const positionDiscontinuityGuardActive = now < this.positionJumpGuardUntilMs;
    if (
      !Number.isFinite(reportedPositionSeconds) ||
      !Number.isFinite(previousPositionHintSeconds) ||
      this.state !== 'playing' ||
      this.activeAutomix ||
      this.isCurrentLivePcmStream() ||
      this.currentActiveDsdOutputMode === 'dop' ||
      this.currentActiveDsdOutputMode === 'native' ||
      (!startupGuardActive && !positionDiscontinuityGuardActive) ||
      (previousSample !== null &&
        (previousSample.token !== this.runToken ||
          previousSample.trackId !== this.currentTrackId ||
          previousSample.filePath !== this.currentFilePath))
    ) {
      return null;
    }

    const playbackRate = Math.max(
      0.25,
      Math.min(4, Number(this.currentOutputSettings?.playbackRate ?? this.outputSettings.playbackRate) || 1),
    );
    const baselinePositionSeconds = previousSample?.positionSeconds ?? Math.max(0, previousPositionHintSeconds);
    const elapsedSeconds = previousSample ? Math.max(0, (now - previousSample.sampledAtMs) / 1000) : 0;
    const expectedPositionSeconds = Math.max(0, baselinePositionSeconds + elapsedSeconds * playbackRate);
    const startupElapsedSeconds =
      startupGuardActive && this.nativePlaybackStartedAtMs > 0
        ? Math.max(0, (now - this.nativePlaybackStartedAtMs) / 1000)
        : null;
    const startupExpectedPositionSeconds =
      startupElapsedSeconds !== null
        ? Math.max(0, this.nativePlaybackStartPositionSeconds + startupElapsedSeconds * playbackRate)
        : null;
    const startupUnexpectedAdvanceSeconds =
      startupExpectedPositionSeconds !== null
        ? reportedPositionSeconds - startupExpectedPositionSeconds
        : null;
    const reportedAdvanceSeconds = reportedPositionSeconds - baselinePositionSeconds;
    const allowedAdvanceSeconds = elapsedSeconds * playbackRate + unexpectedPositionJumpEarlyToleranceSeconds;
    const unexpectedAdvanceSeconds = reportedAdvanceSeconds - allowedAdvanceSeconds;
    const shouldRebaseStartupDrift =
      startupUnexpectedAdvanceSeconds !== null &&
      startupUnexpectedAdvanceSeconds >= nativeStartupPositionDriftToleranceSeconds &&
      startupUnexpectedAdvanceSeconds <= nativeStartupPositionDriftMaxRebaseSeconds;
    const shouldRebaseDiscontinuity =
      positionDiscontinuityGuardActive &&
      reportedAdvanceSeconds > unexpectedPositionJumpEarlyMinimumSeconds &&
      unexpectedAdvanceSeconds >= unexpectedPositionJumpEarlyMinimumSeconds;

    if (!shouldRebaseStartupDrift && !shouldRebaseDiscontinuity) {
      return null;
    }

    const durationSeconds = Math.max(0, Number(this.currentProbe?.durationSeconds) || 0);
    if (durationSeconds > 0 && baselinePositionSeconds >= durationSeconds - 10) {
      return null;
    }

    const maxPositionSeconds = durationSeconds > 1 ? durationSeconds - 1 : Number.POSITIVE_INFINITY;
    const rebasePositionSeconds = Math.max(
      0,
      Math.min(shouldRebaseStartupDrift ? startupExpectedPositionSeconds ?? expectedPositionSeconds : expectedPositionSeconds, maxPositionSeconds),
    );
    this.recordPlaybackDiagnosticEvent('position_jump_suspected', 'suspect', 'guarded_position_jump_ignored', {
      positionSeconds: rebasePositionSeconds,
      durationSeconds,
      details: {
        previousPositionSeconds: previousSample?.positionSeconds ?? null,
        previousPositionHintSeconds,
        reportedPositionSeconds,
        expectedPositionSeconds,
        startupExpectedPositionSeconds,
        startupUnexpectedAdvanceSeconds,
        unexpectedAdvanceSeconds,
        elapsedSeconds,
        startupElapsedSeconds,
        firstPositionSample: previousSample === null,
        action: shouldRebaseStartupDrift
          ? 'rebase_startup_clock_drift'
          : 'rebase_without_restart',
      },
    });
    this.verboseLogger(
      `[AudioSession] guarded playback position jump ignored; rebased clock at ${rebasePositionSeconds.toFixed(3)}s ` +
        `reported=${reportedPositionSeconds.toFixed(3)}s previous=${baselinePositionSeconds.toFixed(3)}s`,
    );
    return rebasePositionSeconds;
  }

  private sanitizeLowLatencyBufferForOutputMode(
    outputMode: AudioOutputMode,
    latencyProfile: AudioLatencyProfile,
    bufferSizeFrames: number | undefined,
    source: string,
  ): number | undefined {
    const sanitized = sanitizeLowLatencyBuffer(outputMode, latencyProfile, bufferSizeFrames);
    if (sanitized.warning && sanitized.bufferSizeFrames !== bufferSizeFrames) {
      this.addOutputWarning(sanitized.warning);
      this.logger(
        `[AudioSession] ${sanitized.warning}; source=${source} outputMode=${outputMode} requestedBuffer=${bufferSizeFrames ?? 'auto'}`,
      );
    }

    return sanitized.bufferSizeFrames;
  }

  private addOutputWarning(warning: string): void {
    if (!this.outputWarnings.includes(warning)) {
      this.outputWarnings.push(warning);
    }
  }

  private addPendingOutputWarning(warning: string): void {
    if (!this.pendingOutputWarnings.includes(warning)) {
      this.pendingOutputWarnings.push(warning);
    }
  }

  private getNativeDirectLocalPlaybackStatusFallbackReason(): NativeDirectLocalPlaybackFallbackReason | null {
    const warning = [...this.outputWarnings, ...this.pendingOutputWarnings]
      .reverse()
      .find((item) => item.startsWith('native_direct_local_playback_not_applied:'));
    if (!warning) {
      return null;
    }

    const reason = warning.slice('native_direct_local_playback_not_applied:'.length);
    return isNativeDirectLocalPlaybackFallbackReason(reason) ? reason : null;
  }

  private markExpectedPositionDiscontinuity(durationMs = unexpectedPositionJumpGuardMs): void {
    this.lastPositionSample = null;
    this.positionJumpGuardUntilMs = Math.max(this.positionJumpGuardUntilMs, Date.now() + durationMs);
  }

  private reportRecoverableAudioError(error: Error, phase: string, details?: unknown): void {
    try {
      this.reportAudioError({
        message: error.message,
        stack: error.stack,
        phase,
        severity: 'recoverable',
        details,
        audioStatus: this.getStatus(),
      });
    } catch {
      // Diagnostics must never interrupt playback recovery.
    }
  }

  private createEqProfileBindingTarget(): EqProfileBindingTarget {
    const settings = this.currentOutputSettings ?? this.outputSettings;
    const outputMode = this.currentPlan?.outputMode ?? normalizeOutputMode(settings.outputMode);
    const sharedBackend = outputMode === 'shared' ? normalizeSharedBackend(settings.sharedBackend) : 'auto';

    return {
      outputMode,
      sharedBackend,
      outputBackend: this.currentOutputBackend,
      outputDeviceId: this.currentDevice?.id ?? null,
      outputDeviceName: this.currentDevice?.name ?? this.currentOutputDeviceName ?? settings.deviceName ?? null,
      outputDeviceType: this.currentOutputDeviceType ?? this.currentDevice?.outputMode ?? null,
      deviceIndex: Number.isInteger(Number(settings.deviceIndex)) ? Number(settings.deviceIndex) : null,
      deviceName: settings.deviceName ?? null,
    };
  }

  private async syncEqStateForPlayback(bridge: OutputBridgeLike | null = this.bridge): Promise<void> {
    try {
      if (!bridge?.syncDspState) {
        return;
      }
      bridge.activateDspControl?.();
      await bridge.syncDspState(this.createEqProfileBindingTarget());
    } catch (error) {
      if (!isEqControlDisconnectError(error)) {
        throw error;
      }

      this.addOutputWarning('eq_control_sync_skipped');
      this.logger(`[AudioSession] EQ control sync skipped during playback start: ${error instanceof Error ? error.message : String(error)}`);
      this.reportRecoverableAudioError(error instanceof Error ? error : new Error(String(error)), 'eq-control-sync', {
        recovered: true,
      });
    }
  }

  private reportFatalAudioError(error: Error): void {
    try {
      this.reportAudioError({
        message: error.message,
        stack: error.stack,
        phase: this.state === 'loading' ? 'playback-start' : this.state,
        severity: 'fatal',
        details: {
          outputWarnings: this.outputWarnings,
          currentOutputSettings: this.currentOutputSettings,
          currentPlan: this.currentPlan,
        },
        audioStatus: this.getStatus(),
      });
    } catch {
      // Diagnostics must never turn an audio error into a second failure.
    }
  }

  private resetWatchdogProgress(): void {
    this.watchdogLastPositionSeconds = null;
    this.watchdogStalledChecks = 0;
  }

  private getWatchdogRecoveryKey(): string | null {
    return this.currentTrackId ?? this.currentFilePath;
  }

  private getRecentWatchdogRecoveryCount(): number {
    const key = this.getWatchdogRecoveryKey();
    if (!key) {
      return 0;
    }

    const recovery = this.watchdogRecoveries.get(key);
    if (!recovery || Date.now() - recovery.windowStartedAt > this.watchdogRecoveryWindowMs) {
      return 0;
    }

    return recovery.count;
  }

  private getWatchdogStatus(): AudioDiagnostics['watchdogStatus'] {
    if (this.watchdogRecovering || this.sharedStabilityRecovering) {
      return 'recovering';
    }

    if (this.getRecentWatchdogRecoveryCount() >= this.watchdogMaxRecoveriesPerTrack && this.watchdogMaxRecoveriesPerTrack > 0) {
      return 'limited';
    }

    return this.state === 'playing' ? 'monitoring' : 'idle';
  }

  private reserveWatchdogRecoverySlot(): number | null {
    const key = this.getWatchdogRecoveryKey();
    if (!key) {
      return null;
    }

    const now = Date.now();
    const current = this.watchdogRecoveries.get(key);
    const recovery =
      !current || now - current.windowStartedAt > this.watchdogRecoveryWindowMs
        ? { count: 0, windowStartedAt: now }
        : current;

    if (recovery.count >= this.watchdogMaxRecoveriesPerTrack) {
      this.watchdogRecoveries.set(key, recovery);
      return null;
    }

    recovery.count += 1;
    this.watchdogRecoveries.set(key, recovery);
    return recovery.count;
  }

  private reserveLocalPlaybackRecoverySlot(reason: string, now = Date.now()): boolean {
    const playbackKey = this.getWatchdogRecoveryKey();
    if (!playbackKey) {
      return false;
    }

    const key = `${reason}:${playbackKey}`;
    const current = this.localPlaybackRecoveries.get(key);
    if (!current || now - current.windowStartedAt > localPlaybackAutoRecoveryWindowMs) {
      this.localPlaybackRecoveries.set(key, { count: 1, windowStartedAt: now });
      return true;
    }

    if (current.count >= localPlaybackAutoRecoveryMaxAttempts) {
      return false;
    }

    current.count += 1;
    this.localPlaybackRecoveries.set(key, current);
    return true;
  }

  private async recoverLocalPlaybackRestart(
    token: number,
    reason: string,
    positionSeconds: number,
    durationSeconds: number,
    options: { cause?: Error; eventKind?: 'ended' | 'watchdog_recovery' } = {},
  ): Promise<void> {
    if (!this.isRecoveryRunCurrent(token)) {
      return;
    }

    if (!this.currentFilePath || !this.currentOutputSettings || !this.currentProbe || !isLocalPlaybackPath(this.currentFilePath)) {
      return;
    }

    const filePath = this.currentFilePath;
    const trackId = this.currentTrackId;
    const metadata = this.currentTrackMetadata ?? undefined;
    const replayGain = this.currentReplayGain;
    const inputHeaders = this.currentInputHeaders ? { ...this.currentInputHeaders } : undefined;
    const output = { ...this.currentOutputSettings };
    const probe = createProbeHint(this.currentProbe);
    const safePositionSeconds = Math.min(Math.max(0, positionSeconds), durationSeconds || Number.POSITIVE_INFINITY);

    this.addPendingOutputWarning(reason);
    this.recordPlaybackDiagnosticEvent(options.eventKind ?? 'watchdog_recovery', 'recovery', reason, {
      trackId,
      filePath,
      positionSeconds: safePositionSeconds,
      durationSeconds,
      details: {
        cause: options.cause?.message ?? null,
        remainingSeconds: Math.max(0, durationSeconds - safePositionSeconds),
      },
    });
    this.logger(
      `[AudioSession] ${reason}; retrying local playback once file="${redactUrlSecrets(filePath)}" position=${safePositionSeconds.toFixed(
        3,
      )} duration=${durationSeconds.toFixed(3)}`,
    );

    if (!this.isRecoveryRunCurrent(token)) {
      return;
    }

    try {
      this.pendingOutputRestartContext = {
        recoveryReason: reason,
        fallbackReason: null,
      };
      await this.playLocalFile({
        filePath,
        trackId: trackId ?? undefined,
        metadata,
        replayGain,
        startSeconds: safePositionSeconds,
        output,
        probe,
        inputHeaders,
      });
    } catch (error) {
      if (isAudioSessionRunCancelledError(error)) {
        this.verboseLogger(`[AudioSession] ${reason} recovery was superseded by a newer playback run`);
        return;
      }

      this.logger(
        `[AudioSession] ${reason} recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (this.runToken === token) {
        this.resetWatchdogProgress();
      }
    }
  }

  private tierForRecoveryCount(recoveryCount: number): SharedStabilityTier {
    return recoveryCount >= 2 ? 'emergency' : 'recovery';
  }

  private nativeAdaptiveProfileForRecoveryCount(recoveryCount: number): SharedOutputProfile {
    return recoveryCount >= 2 ? nativeAdaptiveOutputProfiles.emergency : nativeAdaptiveOutputProfiles.recovery;
  }

  private outputSettingsForRecoveryCount(recoveryCount: number, isSharedOutput: boolean): AudioOutputSettings {
    const output = { ...(this.currentOutputSettings ?? {}) };

    if (recoveryCount >= 3) {
      return {
        ...output,
        latencyProfile: 'stable',
        bufferSizeFrames: latencyProfiles.stable.bufferSizeFrames,
      };
    }

    if (isSharedOutput) {
      return {
        ...output,
        latencyProfile: recoveryCount >= 2 ? 'stable' : 'balanced',
        bufferSizeFrames: undefined,
      };
    }

    return {
      ...output,
      latencyProfile: recoveryCount >= 2 ? 'stable' : 'balanced',
      bufferSizeFrames: this.nativeAdaptiveProfileForRecoveryCount(recoveryCount).bufferSizeFrames,
    };
  }

  private recordExclusiveInstabilityWithoutFallback(
    positionSeconds: number,
    reason: string,
    nativeUnderrunDelta: StabilityRecoveryOptions['nativeUnderrunDelta'] | null,
  ): void {
    const outputMode = this.currentPlan?.outputMode ?? normalizeOutputMode(this.currentOutputSettings?.outputMode);
    const plan = this.currentPlan;
    const nativeSampleRate = plan?.actualDeviceSampleRate ?? plan?.requestedOutputSampleRate ?? null;
    const nativeBufferedMs =
      nativeSampleRate && this.nativeTelemetry.bufferedFrames !== null
        ? Math.round((this.nativeTelemetry.bufferedFrames / nativeSampleRate) * 1000)
        : null;
    const safePositionSeconds = Math.min(Math.max(0, positionSeconds), this.currentProbe?.durationSeconds || Number.POSITIVE_INFINITY);

    this.addOutputWarning('exclusive_output_unstable');
    this.recordPlaybackDiagnosticEvent('watchdog_recovery', 'suspect', `${reason}_fallback_disabled`, {
      positionSeconds: safePositionSeconds,
      durationSeconds: this.currentProbe?.durationSeconds,
      outputMode,
      details: {
        bitDepth: this.currentProbe?.bitDepth ?? null,
        fileSampleRate: plan?.fileSampleRate ?? null,
        decoderOutputSampleRate: plan?.decoderOutputSampleRate ?? null,
        requestedOutputSampleRate: plan?.requestedOutputSampleRate ?? null,
        actualDeviceSampleRate: plan?.actualDeviceSampleRate ?? null,
        nativeOutputFormat: getReadyOutputFormat(this.currentReadyResult),
        nativeBufferedMs,
        nativeUnderrunCallbacks: this.nativeTelemetry.underrunCallbacks,
        nativeUnderrunFrames: this.nativeTelemetry.underrunFrames,
        nativeUnderrunCallbackDelta: nativeUnderrunDelta?.callbackDelta ?? null,
        nativeUnderrunFrameDelta: nativeUnderrunDelta?.frameDelta ?? null,
        nativeUnderrunWindowMs: nativeUnderrunDelta?.windowMs ?? null,
        fallbackDisabled: true,
      },
    });
    const now = Date.now();
    if (
      this.lastExclusiveInstabilityFallbackDisabledLogAt === null ||
      now - this.lastExclusiveInstabilityFallbackDisabledLogAt >= exclusiveInstabilityFallbackDisabledLogCooldownMs
    ) {
      this.lastExclusiveInstabilityFallbackDisabledLogAt = now;
      this.logger(
        `[AudioSession] ${reason}; automatic shared fallback is disabled file="${redactUrlSecrets(
          this.currentFilePath ?? '',
        )}" position=${safePositionSeconds.toFixed(3)}`,
      );
    }
  }

  private async fallbackExclusiveToSharedForInstability(
    positionSeconds: number,
    callerTokenOrOptions: number | StabilityRecoveryOptions = {},
  ): Promise<void> {
    const options = normalizeStabilityRecoveryOptions(callerTokenOrOptions);
    const token = options.runToken ?? this.runToken;
    const releaseSharedStabilityRecovery = options.sharedStabilityRecoveryClaimed || !this.sharedStabilityRecovering;
    if (!options.sharedStabilityRecoveryClaimed) {
      if (this.sharedStabilityRecovering) {
        return;
      }
      this.sharedStabilityRecovering = true;
    }

    let recoveryRunToken: number | null = null;

    try {
      if (!this.isRecoveryRunCurrent(token)) {
        this.logger('[AudioSession] exclusive instability fallback skipped after playback run changed');
        return;
      }

      if (!this.currentFilePath || !this.currentOutputSettings || !this.currentProbe || this.state !== 'playing') {
        return;
      }

      if (this.isCurrentLivePcmStream()) {
        this.skipLivePcmRestart('exclusive_output_unstable', positionSeconds);
        return;
      }

      const outputMode = this.currentPlan?.outputMode ?? normalizeOutputMode(this.currentOutputSettings.outputMode);
      if (outputMode !== 'exclusive') {
        return;
      }

      if (!isSharedFallbackAllowedForExclusive(this.currentOutputSettings)) {
        this.recordExclusiveInstabilityWithoutFallback(positionSeconds, 'exclusive_output_unstable', options.nativeUnderrunDelta ?? null);
        return;
      }

      const filePath = this.currentFilePath;
      const trackId = this.currentTrackId;
      const probe = createProbeHint(this.currentProbe);
      const safePositionSeconds = Math.min(Math.max(0, positionSeconds), this.currentProbe.durationSeconds || Number.POSITIVE_INFINITY);
      const plan = this.currentPlan;
      const nativeSampleRate = plan?.actualDeviceSampleRate ?? plan?.requestedOutputSampleRate ?? null;
      const nativeBufferedMs =
        nativeSampleRate && this.nativeTelemetry.bufferedFrames !== null
          ? Math.round((this.nativeTelemetry.bufferedFrames / nativeSampleRate) * 1000)
          : null;
      const nativeUnderrunDelta = options.nativeUnderrunDelta ?? null;
      const output = createSharedFallbackSettings(this.currentOutputSettings);
      const cause = new Error('exclusive_output_unstable');

      this.lastSharedStabilityRecoveryAt = new Date().toISOString();
      this.watchdogLastRecoveryAt = this.lastSharedStabilityRecoveryAt;
      this.addPendingOutputWarning('exclusive_output_unstable');
      this.addPendingOutputWarning('exclusive_output_fell_back_to_shared');
      this.recordPlaybackDiagnosticEvent('watchdog_recovery', 'recovery', 'exclusive_output_unstable', {
        trackId,
        filePath,
        positionSeconds: safePositionSeconds,
        durationSeconds: this.currentProbe.durationSeconds,
        outputMode,
        details: {
          bitDepth: this.currentProbe.bitDepth,
          fileSampleRate: plan?.fileSampleRate ?? null,
          decoderOutputSampleRate: plan?.decoderOutputSampleRate ?? null,
          requestedOutputSampleRate: plan?.requestedOutputSampleRate ?? null,
          actualDeviceSampleRate: plan?.actualDeviceSampleRate ?? null,
          nativeOutputFormat: getReadyOutputFormat(this.currentReadyResult),
          nativeBufferedMs,
          nativeUnderrunCallbacks: this.nativeTelemetry.underrunCallbacks,
          nativeUnderrunFrames: this.nativeTelemetry.underrunFrames,
          nativeUnderrunCallbackDelta: nativeUnderrunDelta?.callbackDelta ?? null,
          nativeUnderrunFrameDelta: nativeUnderrunDelta?.frameDelta ?? null,
          nativeUnderrunWindowMs: nativeUnderrunDelta?.windowMs ?? null,
        },
      });
      this.logger(
        `[AudioSession] exclusive output unstable; falling back to shared output file="${redactUrlSecrets(filePath)}" position=${safePositionSeconds.toFixed(
          3,
        )}`,
      );
      this.reportRecoverableAudioError(cause, 'exclusive-instability-fallback', {
        recovered: true,
        requestedOutputSampleRate: this.currentPlan?.requestedOutputSampleRate ?? null,
        actualDeviceSampleRate: this.currentPlan?.actualDeviceSampleRate ?? null,
        nativeTelemetry: this.nativeTelemetry,
      });

      if (!this.isRecoveryRunCurrent(token)) {
        this.logger('[AudioSession] exclusive instability fallback aborted before restart after playback run changed');
        return;
      }

      recoveryRunToken = this.runToken + 1;
      this.pendingOutputRestartContext = {
        recoveryReason: 'exclusive_output_unstable',
        fallbackReason: 'exclusive_output_unstable_to_shared',
      };
      await this.playLocalFile({
        filePath,
        trackId: trackId ?? undefined,
        metadata: this.currentTrackMetadata ?? undefined,
        startSeconds: safePositionSeconds,
        output,
        probe,
        inputHeaders: this.currentInputHeaders ?? undefined,
      });
      if (this.runToken !== recoveryRunToken) {
        this.logger('[AudioSession] exclusive instability fallback was superseded after playback restart');
        return;
      }
    } catch (error) {
      if (isAudioSessionRunCancelledError(error)) {
        this.logger('[AudioSession] exclusive instability fallback was superseded by a newer playback run');
      } else {
        this.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (releaseSharedStabilityRecovery) {
        this.sharedStabilityRecovering = false;
      }
      if (this.runToken === token || this.runToken === recoveryRunToken) {
        this.resetWatchdogProgress();
      }
    }
  }

  private async recoverOutputStability(
    reason: string,
    positionSeconds: number,
    callerTokenOrOptions: number | StabilityRecoveryOptions = {},
  ): Promise<void> {
    const options = normalizeStabilityRecoveryOptions(callerTokenOrOptions);
    const token = options.runToken ?? this.runToken;
    const releaseSharedStabilityRecovery = options.sharedStabilityRecoveryClaimed || !this.sharedStabilityRecovering;
    if (!options.sharedStabilityRecoveryClaimed) {
      if (this.sharedStabilityRecovering) {
        return;
      }
      this.sharedStabilityRecovering = true;
    }

    let recoveryRunToken: number | null = null;

    try {
      if (!this.isRecoveryRunCurrent(token)) {
        this.verboseLogger(`[AudioSession] ${reason}; stability recovery skipped after playback run changed`);
        return;
      }

      if (!this.currentFilePath || !this.currentOutputSettings || !this.currentProbe || this.state !== 'playing') {
        return;
      }

      if (this.isCurrentLivePcmStream()) {
        this.skipLivePcmRestart(reason, positionSeconds);
        return;
      }

      const outputMode = this.currentPlan?.outputMode ?? normalizeOutputMode(this.currentOutputSettings.outputMode);
      const isSharedOutput = outputMode === 'shared';
      const recoveryCount = this.reserveWatchdogRecoverySlot();
      if (recoveryCount === null) {
        this.addOutputWarning(isSharedOutput ? 'shared_stability_recovery_limited' : 'native_output_stability_recovery_limited');
        this.emitStatus();
        return;
      }

      const filePath = this.currentFilePath;
      const trackId = this.currentTrackId;
      const sharedRecoveryTier = isSharedOutput ? this.tierForRecoveryCount(recoveryCount) : null;
      const nativeAdaptiveProfile = isSharedOutput ? null : this.nativeAdaptiveProfileForRecoveryCount(recoveryCount);
      const output = this.outputSettingsForRecoveryCount(recoveryCount, isSharedOutput);
      const probe = createProbeHint(this.currentProbe);
      const safePositionSeconds = Math.min(Math.max(0, positionSeconds), this.currentProbe.durationSeconds || Number.POSITIVE_INFINITY);
      const targetBuffer =
        output.latencyProfile === 'stable'
          ? 'stable'
          : `${
              sharedRecoveryTier
                ? sharedStabilityProfiles[sharedRecoveryTier].bufferSizeFrames
                : normalizePositiveInteger(output.bufferSizeFrames) ?? latencyProfiles.lowLatency.bufferSizeFrames
            } frames`;

      if (sharedRecoveryTier) {
        this.sharedStabilityTier = sharedRecoveryTier;
        this.rememberSharedStabilityTier(this.currentOutputSettings, this.currentDevice, sharedRecoveryTier);
      }
      this.lastSharedStabilityRecoveryAt = new Date().toISOString();
      this.watchdogLastRecoveryAt = this.lastSharedStabilityRecoveryAt;
      this.addPendingOutputWarning(reason);
      if (reason === 'audio_watchdog_recovered_native_output') {
        this.addPendingOutputWarning(`${reason}:${recoveryCount}`);
      }
      if (isSharedOutput) {
        this.addPendingOutputWarning(`shared_stability_recovered:${recoveryCount}`);
      } else {
        this.addPendingOutputWarning(`native_output_stability_recovered:${recoveryCount}`);
      }
      this.addPendingOutputWarning(`native_output_buffer_recovered:${targetBuffer}`);
      this.recordPlaybackDiagnosticEvent('watchdog_recovery', 'recovery', reason, {
        trackId,
        filePath,
        positionSeconds: safePositionSeconds,
        durationSeconds: this.currentProbe.durationSeconds,
        outputMode,
        details: {
          recoveryCount,
          targetBuffer,
          sharedRecoveryTier,
          adaptiveBufferSizeFrames: nativeAdaptiveProfile?.bufferSizeFrames ?? null,
          adaptiveFifoCapacityMs: nativeAdaptiveProfile?.fifoCapacityMs ?? null,
          adaptiveStartupPrebufferMs: nativeAdaptiveProfile?.startupPrebufferMs ?? null,
          adaptiveStartupPrebufferTimeoutMs: nativeAdaptiveProfile?.startupPrebufferTimeoutMs ?? null,
        },
      });
      this.verboseLogger(
        `[AudioSession] ${reason}; restarting ${outputMode} output buffer=${targetBuffer} file="${redactUrlSecrets(filePath)}" position=${safePositionSeconds.toFixed(
          3,
        )} recovery=${recoveryCount}`,
      );

      if (!this.isRecoveryRunCurrent(token)) {
        this.verboseLogger(`[AudioSession] ${reason}; stability recovery aborted before restart after playback run changed`);
        return;
      }

      recoveryRunToken = this.runToken + 1;
      this.pendingOutputRestartContext = {
        recoveryReason: reason,
        fallbackReason: null,
      };
      this.pendingOutputAdaptiveProfile = nativeAdaptiveProfile;
      await this.playLocalFile({
        filePath,
        trackId: trackId ?? undefined,
        metadata: this.currentTrackMetadata ?? undefined,
        startSeconds: safePositionSeconds,
        output,
        probe,
        inputHeaders: this.currentInputHeaders ?? undefined,
      });
      if (this.runToken !== recoveryRunToken) {
        this.verboseLogger(`[AudioSession] ${reason}; stability recovery was superseded after playback restart`);
        return;
      }
    } catch (error) {
      if (isAudioSessionRunCancelledError(error)) {
        this.verboseLogger('[AudioSession] output stability recovery was superseded by a newer playback run');
      } else {
        this.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (releaseSharedStabilityRecovery) {
        this.sharedStabilityRecovering = false;
      }
      if (this.runToken === token || this.runToken === recoveryRunToken) {
        this.resetWatchdogProgress();
      }
    }
  }

  private isRecoveryRunCurrent(runToken: number | undefined): boolean {
    return runToken === undefined || this.runToken === runToken;
  }

  private async recoverFromWatchdogStall(positionSeconds: number, callerToken?: number): Promise<void> {
    const token = callerToken ?? this.runToken;

    if (this.watchdogRecovering || this.sharedStabilityRecovering) {
      return;
    }

    this.watchdogRecovering = true;
    try {
      if (!this.currentFilePath || !this.currentOutputSettings || !this.currentProbe || this.state !== 'playing') {
        this.resetWatchdogProgress();
        return;
      }

      if (this.isCurrentLivePcmStream()) {
        this.skipLivePcmRestart('audio_watchdog_recovered_native_output', positionSeconds);
        return;
      }

      await this.recoverOutputStability('audio_watchdog_recovered_native_output', positionSeconds, token);
    } finally {
      this.watchdogRecovering = false;
    }
  }
}

let defaultAudioSession: AudioSession | null = null;

export const getAudioSession = (): AudioSession => {
  if (!defaultAudioSession) {
    defaultAudioSession = new AudioSession();
  }
  return defaultAudioSession;
};

export const hasAudioSession = (): boolean => defaultAudioSession !== null;

export const disposeDefaultAudioSessionGracefully = async (reason = 'app-quit'): Promise<void> => {
  if (!defaultAudioSession) {
    return;
  }

  const session = defaultAudioSession;
  defaultAudioSession = null;
  await session.disposeGracefully(reason);
  try {
    await stopAudioDaemon();
  } catch {}
};
