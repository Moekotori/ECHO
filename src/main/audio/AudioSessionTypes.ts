import type { DecoderPipeline } from './DecoderPipeline';
import type { AutomixAnalyzer } from './AutomixAnalyzer';
import type { DeviceService } from './DeviceService';
import type { AutomixTransitionPlan } from './AutomixPlanner';
import type { EchoSrcFirWorkerClientLike } from './EchoSrcFirWorkerTransform';
import type { PcmToDsdDoPWorkerClientLike } from './PcmToDsdDoPTransform';
import type { AudioCrashReportPayload } from '../diagnostics/CrashReportService';
import type { ReplayGainTrackData } from '../../shared/utils/replayGain';
import type {
  AudioDeviceInfo,
  AudioOutputMode,
  AudioOutputSettings,
  AudioProbeResult,
  AudioSessionPrepareLocalFileRequest,
  AudioStatus,
  DecoderRun,
  FfmpegToolchainDiagnostics,
} from './audioTypes';
import { resolveEchoSrcFirBackendStatus } from './EchoSrcFirEngine';

export type DecoderPipelineLike = Pick<DecoderPipeline, 'probeLocalFile' | 'decodeLocalFile'> & {
  decodeAutomixPair?: DecoderPipeline['decodeAutomixPair'];
  decodeGaplessSequence?: DecoderPipeline['decodeGaplessSequence'];
  getToolchainInfo?: () => FfmpegToolchainDiagnostics;
};

export type AutomixAnalyzerLike = Pick<AutomixAnalyzer, 'analyze'> & Partial<Pick<AutomixAnalyzer, 'getCachedAnalysis'>>;

export type DeviceServiceLike = Pick<DeviceService, 'listDevices'> &
  Partial<Pick<DeviceService, 'listDevicesAsync' | 'refresh' | 'invalidateCache'>>;

export type PausedDecoderPrewarm = {
  kind: 'held' | 'fresh';
  token: number;
  filePath: string;
  startSeconds: number;
  timelineStartSeconds: number;
  run: DecoderRun;
};

export type PreparedLocalPlaybackItem = {
  filePath: string;
  trackId?: string;
  probe?: AudioSessionPrepareLocalFileRequest['probe'];
  preparedAt: number;
  expiresAt: number;
  outputMode?: AudioOutputMode;
  requestedOutputSampleRate?: number | null;
  decoderOutputSampleRate?: number | null;
  warnings?: string[];
};

export type LocalPrepareContext = {
  key: string;
  outputSettings: AudioOutputSettings;
  device: AudioDeviceInfo | null;
};

export type PositionSample = {
  token: number;
  trackId: string | null;
  filePath: string | null;
  positionSeconds: number;
  sampledAtMs: number;
};

export type StabilityRecoveryOptions = {
  runToken?: number;
  sharedStabilityRecoveryClaimed?: boolean;
  nativeUnderrunDelta?: {
    callbackDelta: number;
    frameDelta: number;
    windowMs: number;
  };
};

export type PreparedLocalProbeUse = {
  probe: AudioSessionPrepareLocalFileRequest['probe'];
  ageMs: number;
};

export type ActiveAutomixState = {
  enabled: boolean;
  gapless: boolean;
  nextTransitionIndex: number;
  fromTrackId: string | null;
  nextTrackId: string;
  nextFilePath: string;
  nextInputHeaders: Record<string, string> | null;
  nextProbe: AudioProbeResult;
  nextReplayGain: ReplayGainTrackData | null;
  transitionSeconds: number;
  transitionStartSeconds: number;
  compositeStartSeconds: number;
  compositeDurationSeconds: number;
  plan: AutomixTransitionPlan;
  transitions: ActiveAutomixTransition[];
};

export type ActiveAutomixTransition = {
  fromTrackId: string | null;
  nextTrackId: string;
  nextFilePath: string;
  nextInputHeaders: Record<string, string> | null;
  nextProbe: AudioProbeResult;
  nextReplayGain: ReplayGainTrackData | null;
  transitionSeconds: number;
  transitionStartSeconds: number;
  trackStartOutputSeconds: number;
  trackStartSourceSeconds: number;
  plan: AutomixTransitionPlan;
};

export type NativeAutomixPlayback = {
  currentRun: DecoderRun;
  nextRun: DecoderRun;
  state: ActiveAutomixState;
};

export type AudioErrorRecoveryHandler = (error: Error, status: AudioStatus) => boolean;

export type AudioSessionDependencies = {
  decoder?: DecoderPipelineLike;
  automixAnalyzer?: AutomixAnalyzerLike;
  deviceService?: DeviceServiceLike;
  /** @deprecated Wave 1 — kept for test compat, removed in Wave 6 */
  createBridge?: () => unknown;
  isNativeHostAvailable?: () => boolean;
  createEchoSrcCudaWorkerClient?: () => EchoSrcFirWorkerClientLike & { dispose?: () => void };
  createSdmCudaWorkerClient?: () => PcmToDsdDoPWorkerClientLike & { dispose?: () => void };
  resolveEchoSrcFirBackendStatus?: typeof resolveEchoSrcFirBackendStatus;
  reportAudioError?: (payload: AudioCrashReportPayload) => void;
  logger?: (message: string) => void;
  diagnosticLogger?: (message: string) => void;
  watchdogIntervalMs?: number;
  watchdogStallChecks?: number;
  watchdogMaxRecoveriesPerTrack?: number;
  watchdogRecoveryWindowMs?: number;
  transportFadeDurationMs?: number;
  transportFadeStepMs?: number;
  transportFadeWait?: (durationMs: number) => Promise<void>;
  disableWatchdogTimer?: boolean;
  platform?: NodeJS.Platform | string;
};
