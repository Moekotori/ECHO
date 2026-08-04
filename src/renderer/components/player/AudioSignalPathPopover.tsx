import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronDown,
  Cpu,
  Database,
  ShieldCheck,
  SlidersHorizontal,
  Speaker,
  Waves,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioEchoSrcRuntimeBackend, AudioOutputMode, AudioSdmRuntimeBackend, AudioStatus } from '../../../shared/types/audio';
import type { ConnectSessionStatus } from '../../../shared/types/connect';
import type { HqPlayerRemotePlaybackStatus, HqPlayerStatus } from '../../../shared/types/hqplayer';
import type { LibraryTrack } from '../../../shared/types/library';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { isHqPlayerConnectStatus } from '../../utils/connectPlayback';
import {
  audioRouteFlightTrackKey,
  getAudioRouteFlightEntries,
  recordAudioRouteFlightObservation,
  type AudioRouteFlightEntry,
} from '../../utils/audioRouteFlightRecorder';
import { formatAudioHostError } from './audioErrorFormat';
import {
  getDacCapabilityAtlasProfile,
  recordDacCapabilityObservation,
  type DacCapabilityAtlasProfile,
  type DacCapabilityModeStats,
} from '../../utils/dacCapabilityAtlas';

type AudioSignalPathPopoverProps = {
  isOpen: boolean;
  status: AudioStatus | null;
  track: LibraryTrack | null;
  connectStatus?: ConnectSessionStatus | null;
  onClose: () => void;
  onOpenAudioSettings?: () => void;
};

type AudioSignalPathControlProps = {
  isOpen: boolean;
  status: AudioStatus | null;
  track: LibraryTrack | null;
  connectStatus?: ConnectSessionStatus | null;
  onClick: () => void;
};

type SignalTone = 'good' | 'process' | 'warning' | 'danger' | 'muted';

type SignalNode = {
  title: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: SignalTone;
};

type SignalSummary = {
  label: string;
  detail: string;
  spec: string;
  tone: SignalTone;
};

type SignalTheaterMetric = {
  label: string;
  value: string;
  detail: string;
  tone: SignalTone;
};

type SignalTheaterMeter = SignalTheaterMetric & {
  fillPercent: number;
};

type SignalDoctorInsight = {
  eyebrow: string;
  title: string;
  detail: string;
  advice: string;
  tone: SignalTone;
};

type SignalTheaterModel = {
  detail: string;
  meter: SignalTheaterMeter;
  metrics: SignalTheaterMetric[];
  doctorInsights: SignalDoctorInsight[];
};

type SignalStabilityReadout = {
  headline: string;
  detail: string;
  tone: SignalTone;
  facts: SignalTheaterMetric[];
};

type DacCapabilityAtlasFact = {
  label: string;
  value: string;
  detail: string;
  tone: SignalTone;
};

type DacCapabilityAtlasModeView = {
  mode: AudioOutputMode;
  label: string;
  detail: string;
  tone: SignalTone;
};

type SignalTheaterMeterStyle = CSSProperties & {
  '--signal-meter-fill': string;
};

type RoonSignalNode = {
  badge: string;
  title: string;
  value: string;
  icon?: LucideIcon;
  tone: SignalTone;
  variant?: 'circle' | 'process';
};

type TranslateOptions = Record<string, string | number>;
type Translate = (key: TranslationKey, options?: TranslateOptions) => string;

const signalPathPopoverExitMs = 170;
const fallbackT: Translate = translateFallback;
const unknown = (t: Translate = fallbackT): string => t('audioSignalPath.unknown');
const isNativeDirectDecodeBackend = (status: AudioStatus | null): boolean =>
  (typeof status?.activeDecodeBackendLabel === 'string' &&
    status.activeDecodeBackendLabel.startsWith('native-direct-libav-audio-format'));

const formatDecodeBackend = (status: AudioStatus | null, t: Translate): string => {
  if (isNativeDirectDecodeBackend(status)) {
    return t('audioSignalPath.decode.nativeDirect');
  }

  return status?.activeDecodeBackendLabel ?? status?.activeDecodeBackendImpl ?? status?.outputBackend ?? t('audioSignalPath.decode.auto');
};

const trimTrailingZero = (value: string): string => value.replace(/\.0$/u, '');

const trimFixed = (value: number, fractionDigits: number): string =>
  value.toFixed(fractionDigits).replace(/\.?0+$/u, '');

const formatRate = (value: number | null | undefined): string | null => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  if (value >= 1000) {
    return `${trimTrailingZero((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1))} kHz`;
  }

  return `${Math.round(value)} Hz`;
};

const compactRate = (value: number | null | undefined): string | null => {
  const formatted = formatRate(value);
  return formatted?.replace(' kHz', 'k') ?? null;
};

const formatBitDepth = (value: number | null | undefined): string | null =>
  value && Number.isFinite(value) ? `${Math.round(value)} bit` : null;

const formatRoonRate = (value: number | null | undefined): string | null => formatRate(value)?.replace(' kHz', 'kHz') ?? null;

const formatHqPlayerOutputRate = (value: number | null | undefined): string | null => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  if (value >= 1_000_000) {
    return `${trimFixed(value / 1_000_000, 2)}MHz`;
  }

  return formatRoonRate(value);
};

const formatEchoSrcQualityProfile = (value: AudioStatus['echoSrcQualityProfile']): string => {
  if (value === 'balanced') {
    return 'Balanced';
  }
  if (value === 'lowLatency') {
    return 'Low latency';
  }
  return 'Transparent';
};

const formatEchoSrcFilterProfile = (value: AudioStatus['echoSrcFilterProfile']): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const formatEchoSrcBackendLabel = (backend: AudioEchoSrcRuntimeBackend | null | undefined): string | null => {
  if (backend === 'cuda') {
    return 'CUDA FIR';
  }
  if (backend === 'cpu') {
    return 'CPU FIR';
  }
  if (backend === 'soxr') {
    return 'SOXR';
  }
  if (backend === 'default') {
    return 'Default SRC';
  }
  return null;
};

const formatCudaMemory = (memoryTotalMiB: number | null | undefined): string | null => {
  if (!Number.isFinite(memoryTotalMiB) || !memoryTotalMiB || memoryTotalMiB <= 0) {
    return null;
  }

  const memoryGiB = memoryTotalMiB / 1024;
  const rounded = memoryGiB >= 10 ? Math.round(memoryGiB).toString() : memoryGiB.toFixed(1);
  return `${rounded}GB VRAM`;
};

const formatCudaRuntimeDevice = (status: AudioStatus): string | null => {
  const cudaStatus = status.echoSrcCudaStatus;
  if (!cudaStatus?.available) {
    return null;
  }

  return joinSpec([
    cudaStatus.deviceName,
    formatCudaMemory(cudaStatus.memoryTotalMiB),
  ], 'NVIDIA CUDA');
};

const formatCpuRuntimeDevice = (status: AudioStatus): string | null =>
  typeof status.cpuModel === 'string' && status.cpuModel.trim() ? status.cpuModel.trim() : null;

const formatSdmCudaRuntimeDevice = (status: AudioStatus): string | null => {
  const cudaStatus = status.sdmCudaStatus ?? status.echoSrcCudaStatus;
  if (!cudaStatus?.available) {
    return null;
  }

  return joinSpec([
    cudaStatus.deviceName,
    formatCudaMemory(cudaStatus.memoryTotalMiB),
  ], 'NVIDIA CUDA');
};

const formatDsdOutputRate = (sampleRate: number | null | undefined): string | null => {
  if (!sampleRate || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }

  const multiple = sampleRate / 2_822_400;
  const rounded = Math.round(multiple);
  if (rounded >= 1 && Math.abs(multiple - rounded) < 0.02) {
    return `DSD${rounded * 64}`;
  }

  return formatRoonRate(sampleRate);
};

const formatEchoSrcFirFrames = (frames: number | null | undefined): string | null =>
  typeof frames === 'number' && Number.isFinite(frames) && frames > 0 ? `${Math.round(frames)}f` : null;

const formatEchoSrcFirMs = (value: number | null | undefined): string | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toFixed(value >= 10 ? 1 : 2)}ms` : null;

const formatEchoSrcFirRealtime = (value: number | null | undefined): string | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${value.toFixed(value >= 10 ? 1 : 2)}x realtime` : null;

const formatEchoSrcEngine = (status: AudioStatus): string => {
  const runtime = status.echoSrcRuntime;
  if (runtime?.activeBackend) {
    const backend = formatEchoSrcBackendLabel(runtime.activeBackend);
    const cudaDevice = runtime.activeBackend === 'cuda' ? formatCudaRuntimeDevice(status) : null;
    const cpuDevice = runtime.activeBackend === 'cpu' ? formatCpuRuntimeDevice(status) : null;
    const stageText = runtime.firStageCount && runtime.firStageCount > 1
      ? `${runtime.firStageCount} stages`
      : null;
    const tapText = runtime.firStageTapCounts?.length
      ? `${runtime.firStageTapCounts.join('+')} taps`
      : runtime.tapCount
        ? `${runtime.tapCount} taps`
        : null;
    const batchText = runtime.firBatchFrames && runtime.firBatchFrames > 1
      ? `batch ${formatEchoSrcFirFrames(runtime.firBatchFrames)}`
      : null;
    const blockText = runtime.firMaxBlockFrames && runtime.firMaxBlockFrames > 1
      ? `block ${formatEchoSrcFirFrames(runtime.firMaxBlockFrames)}`
      : null;
    const workerText = runtime.firWorkerAverageMs !== null && runtime.firWorkerAverageMs !== undefined
      ? `worker ${formatEchoSrcFirMs(runtime.firWorkerAverageMs)} avg`
      : null;
    const realtimeText = formatEchoSrcFirRealtime(runtime.firRealtimeRatio);
    const stageProfiles = runtime.firStageProfiles ?? [];
    const hasStageProfiles = stageProfiles.length > 0;
    const filterSlotText = hasStageProfiles && stageProfiles.length > 1
      ? 'Filter 1x/Nx'
      : runtime.filterSlot
        ? `Filter ${runtime.filterSlot === '1x' ? '1x' : 'Nx'}`
        : null;
    const filterProfileText = hasStageProfiles
      ? stageProfiles.join(' -> ')
      : runtime.filterProfile;
    const details = runtime.filterProfile
      ? [
        cudaDevice,
        cpuDevice,
        filterSlotText,
        filterProfileText,
        stageText,
        tapText,
        runtime.firProcessingMode,
        batchText,
        blockText,
        workerText,
        realtimeText,
        runtime.phase,
        typeof runtime.impulsePeakIndex === 'number' ? `peak@${runtime.impulsePeakIndex}` : null,
        typeof runtime.preRingingEnergyRatio === 'number' ? `pre ${(runtime.preRingingEnergyRatio * 100).toFixed(1)}%` : null,
        typeof runtime.measuredStopbandPeakDb === 'number' ? `stop ${runtime.measuredStopbandPeakDb.toFixed(0)}dB` : null,
        runtime.state === 'fallback' ? `fallback: ${cleanReason(runtime.fallbackReason) ?? 'runtime fallback'}` : null,
      ]
      : [
        cpuDevice,
        runtime.state === 'fallback' ? `fallback: ${cleanReason(runtime.fallbackReason) ?? 'runtime fallback'}` : null,
      ];

    return joinSpec([backend, ...details], backend ?? 'SRC');
  }

  if (status.echoSrcCudaActive) {
    return joinSpec(['CUDA FIR', formatCudaRuntimeDevice(status), formatEchoSrcFilterProfile(status.echoSrcFilterProfile), 'GPU'], 'CUDA FIR');
  }

  return status.resamplerEngine === 'soxr' ? 'SOXR' : status.resamplerEngine ?? 'SRC';
};

const formatEchoSrcPath = (status: AudioStatus | null, track?: LibraryTrack | null): string | null => {
  if (!status?.echoSrcActive) {
    return null;
  }

  const runtime = status.echoSrcRuntime;
  const sourceRate = formatRoonRate(runtime?.sourceSampleRate ?? status.fileSampleRate ?? track?.sampleRate);
  const targetRate = formatRoonRate(
    runtime?.targetSampleRate
    ?? status.echoSrcTargetSampleRate
    ?? status.decoderOutputSampleRate
    ?? status.requestedOutputSampleRate
    ?? status.actualDeviceSampleRate,
  );
  const engine = formatEchoSrcEngine(status);
  const quality = formatEchoSrcQualityProfile(status.echoSrcQualityProfile);

  if (sourceRate && targetRate) {
    return `${sourceRate} -> ECHO SRC ${targetRate} / ${engine} / ${quality}`;
  }

  return targetRate ? `ECHO SRC -> ${targetRate} / ${engine} / ${quality}` : `ECHO SRC / ${engine} / ${quality}`;
};

const formatSdmBackendLabel = (backend: AudioSdmRuntimeBackend | null | undefined): string | null => {
  if (backend === 'cuda') {
    return 'CUDA SDM';
  }
  if (backend === 'cpu') {
    return 'CPU SDM';
  }
  return null;
};

const formatSdmEngine = (status: AudioStatus): string => {
  const runtime = status.sdmRuntime;
  const backend = formatSdmBackendLabel(runtime?.activeBackend ?? null);
  const profile = runtime?.modulatorProfile ?? status.sdmModulatorProfile ?? null;
  const cudaDevice = runtime?.activeBackend === 'cuda' ? formatSdmCudaRuntimeDevice(status) : null;
  const workerText = runtime?.workerAverageMs !== null && runtime?.workerAverageMs !== undefined
    ? `worker ${formatEchoSrcFirMs(runtime.workerAverageMs)} avg`
    : null;
  const batchText = runtime?.batchFrames && runtime.batchFrames > 1
    ? `batch ${formatEchoSrcFirFrames(runtime.batchFrames)}`
    : null;
  const blockText = runtime?.maxBlockFrames && runtime.maxBlockFrames > 1
    ? `block ${formatEchoSrcFirFrames(runtime.maxBlockFrames)}`
    : null;
  const realtimeText = formatEchoSrcFirRealtime(runtime?.realtimeRatio);
  const fallbackText = runtime?.state === 'fallback'
    ? `fallback: ${cleanReason(runtime.fallbackReason) ?? 'runtime fallback'}`
    : null;

  return joinSpec([
    backend,
    cudaDevice,
    profile?.name,
    profile ? `${profile.order}th-order` : null,
    runtime?.processingMode,
    batchText,
    blockText,
    workerText,
    realtimeText,
    fallbackText,
  ], backend ?? 'SDM');
};

const formatSdmPath = (status: AudioStatus | null, track?: LibraryTrack | null): string | null => {
  if (status?.sdmRuntimeState !== 'pcm_to_sdm_active' && status?.sdmRuntime?.state !== 'fallback') {
    return null;
  }

  const runtime = status.sdmRuntime;
  const sourceRate = formatRoonRate(status.fileSampleRate ?? track?.sampleRate);
  const targetRate = formatDsdOutputRate(runtime?.nativeSampleRate ?? status.sdmNativeSampleRate);
  const transportRate = formatRoonRate(runtime?.transportSampleRate ?? status.sdmTransportSampleRate ?? status.requestedOutputSampleRate);
  const engine = formatSdmEngine(status);
  const detail = joinSpec([targetRate, transportRate ? `DoP ${transportRate}` : null], targetRate ?? 'SDM');

  if (sourceRate) {
    return `${sourceRate} -> ECHO SDM ${detail} / ${engine}`;
  }

  return `ECHO SDM ${detail} / ${engine}`;
};

const formatResamplePath = (status: AudioStatus | null, track?: LibraryTrack | null): string | null => {
  if (!status?.resampling) {
    return null;
  }

  const echoSrcPath = formatEchoSrcPath(status, track);
  if (echoSrcPath) {
    return echoSrcPath;
  }

  const sourceRate = formatRoonRate(status.fileSampleRate ?? track?.sampleRate);
  const outputRate = formatRoonRate(
    status.actualDeviceSampleRate
    ?? status.sharedDeviceSampleRate
    ?? status.requestedOutputSampleRate
    ?? status.decoderOutputSampleRate,
  );

  if (sourceRate && outputRate) {
    return `${sourceRate} -> ${outputRate}`;
  }

  return outputRate ? `-> ${outputRate}` : null;
};

const formatRoonBitDepth = (value: number | null | undefined): string | null =>
  value && Number.isFinite(value) ? `${Math.round(value)}bit` : null;

const formatBitrate = (value: number | null | undefined): string | null =>
  value && Number.isFinite(value) ? `${Math.round(value / 1000)} kbps` : null;

const formatChannels = (value: number | null | undefined): string | null => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  if (value === 1) {
    return 'Mono';
  }

  if (value === 2) {
    return 'Stereo';
  }

  return `${Math.round(value)} ch`;
};

const formatDb = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${value.toFixed(1)} dB` : null;

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const normalizeCodec = (value: string | null | undefined): string | null => {
  const codec = value?.trim();
  return codec ? codec.toUpperCase() : null;
};

const cleanReason = (value: string | null | undefined): string | null => value?.replaceAll('_', ' ') ?? null;

const formatSignalPathErrorDetail = (error: string | null | undefined, fallback: string): string =>
  formatAudioHostError(error) ?? fallback;

const joinSpec = (parts: Array<string | null | undefined>, fallback = unknown()): string =>
  parts.filter((part): part is string => Boolean(part?.trim())).join(' / ') || fallback;

const isHqPlayerSignalPath = (connectStatus: ConnectSessionStatus | null | undefined): connectStatus is ConnectSessionStatus =>
  isHqPlayerConnectStatus(connectStatus) && connectStatus.state !== 'idle' && connectStatus.state !== 'unsupported';

const hqPlayerStateLabel = (
  state: ConnectSessionStatus['state'] | HqPlayerRemotePlaybackStatus['state'] | null | undefined,
  t: Translate = fallbackT,
): string => {
  switch (state) {
    case 'connecting':
      return t('audioSignalPath.hqPlayer.state.connecting');
    case 'ready':
      return t('audioSignalPath.hqPlayer.state.ready');
    case 'playing':
      return t('audioSignalPath.hqPlayer.state.playing');
    case 'paused':
      return t('audioSignalPath.hqPlayer.state.paused');
    case 'stopped':
    case 'stop-requested':
      return t('audioSignalPath.hqPlayer.state.stopped');
    case 'error':
      return t('audioSignalPath.status.error');
    default:
      return t('audioSignalPath.hqPlayer.externalProcessing');
  }
};

const hqPlayerTone = (connectStatus: ConnectSessionStatus): SignalTone => {
  if (connectStatus.state === 'error') {
    return 'danger';
  }

  if (connectStatus.state === 'connecting' || connectStatus.state === 'ready') {
    return 'muted';
  }

  return 'process';
};

const normalizeHqPlayerCodec = (
  track: LibraryTrack | null,
  playbackStatus: HqPlayerRemotePlaybackStatus | null,
  connectStatus: ConnectSessionStatus,
): string | null => {
  const mimeCodec = playbackStatus?.metadata?.mime?.replace(/^audio\//iu, '').replace(/^x-/iu, '') ?? null;
  return normalizeCodec(track?.codec ?? mimeCodec ?? (connectStatus.metadata ? 'pcm' : null));
};

const hqPlayerSourceLabel = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  playbackStatus: HqPlayerRemotePlaybackStatus | null,
  t: Translate = fallbackT,
): string => {
  const metadata = playbackStatus?.metadata ?? null;
  const codec = normalizeHqPlayerCodec(track, playbackStatus, connectStatus);
  const sampleRate = formatRoonRate(track?.sampleRate ?? metadata?.sampleRate);
  const bitDepth = formatRoonBitDepth(track?.bitDepth ?? metadata?.bits);
  const channels = metadata?.channels && Number.isFinite(metadata.channels) ? `${Math.round(metadata.channels)}ch` : null;

  return joinSpec([codec, sampleRate, bitDepth, channels], connectStatus.metadata ? 'PCM' : t('audioSignalPath.hqPlayer.input')).replaceAll(' / ', ' ');
};

const hqPlayerCompactSpec = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  playbackStatus: HqPlayerRemotePlaybackStatus | null,
): string => {
  const metadata = playbackStatus?.metadata ?? null;
  const codec = normalizeHqPlayerCodec(track, playbackStatus, connectStatus);
  const sampleRate = compactRate(track?.sampleRate ?? metadata?.sampleRate);
  const bitDepth = track?.bitDepth ?? metadata?.bits;
  const bitDepthLabel = bitDepth && Number.isFinite(bitDepth) ? `${Math.round(bitDepth)}b` : null;

  return joinSpec([codec, sampleRate, bitDepthLabel], 'HQPlayer');
};

const hqPlayerDspLabel = (status: HqPlayerRemotePlaybackStatus | null): string | null => {
  const modules = [status?.activeMode, status?.activeFilter, status?.activeShaper]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return modules.length ? modules.join(' / ') : null;
};

const hqPlayerOutputLabel = (status: HqPlayerRemotePlaybackStatus | null, t: Translate = fallbackT): string => {
  const outputFormat = joinSpec([
    formatHqPlayerOutputRate(status?.activeRate),
    formatRoonBitDepth(status?.activeBits),
    status?.activeChannels && Number.isFinite(status.activeChannels) ? `${Math.round(status.activeChannels)}ch` : null,
  ], '');

  return outputFormat || t('audioSignalPath.hqPlayer.outputDecided');
};

const hasHqPlayerPlaybackDetails = (
  status: HqPlayerRemotePlaybackStatus | null | undefined,
): status is HqPlayerRemotePlaybackStatus =>
  Boolean(status && (
    status.activeRate
    || status.activeBits
    || status.activeChannels
    || status.activeMode?.trim()
    || status.activeFilter?.trim()
    || status.activeShaper?.trim()
    || status.metadata
  ));

const outputModeLabel = (mode: AudioStatus['outputMode'] | null | undefined, t: Translate = fallbackT): string => {
  if (mode === 'exclusive') {
    return t('audioSignalPath.outputMode.exclusive');
  }
  if (mode === 'system') {
    return t('audioSignalPath.outputMode.system');
  }
  return t('audioSignalPath.outputMode.shared');
};

const outputBackendLabel = (backend: string | null | undefined): string | null => {
  const normalized = backend?.trim().replace(/^legacy-/iu, '');
  if (!normalized) {
    return null;
  }

  if (/^wasapi[-_\s]?exclusive$/iu.test(normalized)) {
    return 'WASAPI Exclusive';
  }
  if (/^wasapi[-_\s]?shared$/iu.test(normalized)) {
    return 'WASAPI Shared';
  }
  if (/^system$/iu.test(normalized)) {
    return 'System Audio';
  }

  return normalized;
};

const formatAtlasRateList = (rates: number[], t: Translate = fallbackT): string =>
  rates
    .map((rate) => formatRoonRate(rate))
    .filter((rate): rate is string => Boolean(rate))
    .join(' / ') || t('audioSignalPath.atlas.pending');

const atlasProfileTone = (profile: DacCapabilityAtlasProfile | null): SignalTone => {
  if (!profile || profile.observations <= 0) {
    return 'muted';
  }

  if (profile.failureCount > 0 && profile.successCount === 0) {
    return 'danger';
  }

  if (profile.lastFailureReason || profile.fortyFourToFortyEightCount > 0 || profile.sampleRateConversionCount > profile.nativeOutputRates.length) {
    return 'warning';
  }

  return profile.nativeOutputRates.length ? 'good' : 'process';
};

const atlasModeTone = (stats: DacCapabilityModeStats | null | undefined): SignalTone => {
  if (!stats || stats.observations <= 0) {
    return 'muted';
  }

  if (stats.failureCount > 0 && stats.successCount === 0) {
    return 'danger';
  }

  if (stats.failureCount > 0) {
    return 'warning';
  }

  return stats.nativeSuccessCount > 0 ? 'good' : 'process';
};

const atlasModeDetail = (stats: DacCapabilityModeStats | null | undefined, t: Translate = fallbackT): string => {
  if (!stats || stats.observations <= 0) {
    return t('audioSignalPath.atlas.modeUnproven');
  }

  if (stats.failureCount > 0 && stats.successCount === 0) {
    return t('audioSignalPath.atlas.modeIssues', { count: stats.failureCount });
  }

  if (stats.failureCount > 0) {
    return t('audioSignalPath.atlas.modeMixed', { success: stats.successCount, issues: stats.failureCount });
  }

  if (stats.nativeSuccessCount > 0) {
    return t('audioSignalPath.atlas.modeNative', { success: stats.successCount, native: stats.nativeSuccessCount });
  }

  return t('audioSignalPath.atlas.modeStable', { count: stats.successCount });
};

const atlasModeViews = (
  profile: DacCapabilityAtlasProfile | null,
  status: AudioStatus | null,
  t: Translate = fallbackT,
): DacCapabilityAtlasModeView[] => {
  const modeOrder: AudioOutputMode[] = ['exclusive', 'shared', 'system'];
  const preferredOrder = status?.outputMode
    ? [status.outputMode, ...modeOrder.filter((mode) => mode !== status.outputMode)]
    : modeOrder;

  return preferredOrder
    .map((mode) => {
      const stats = profile?.modes[mode] ?? null;
      return {
        mode,
        label: outputModeLabel(mode, t),
        detail: atlasModeDetail(stats, t),
        tone: atlasModeTone(stats),
      };
    })
    .filter((modeView, index) => index < 2 || modeView.tone !== 'muted')
    .slice(0, 4);
};

const atlasFacts = (
  profile: DacCapabilityAtlasProfile | null,
  t: Translate = fallbackT,
): DacCapabilityAtlasFact[] => {
  const observedRates = formatAtlasRateList(profile?.observedOutputRates ?? [], t);
  const nativeRate = formatRoonRate(profile?.lastNativeRate);
  const nativeMode = profile?.lastNativeMode ? outputModeLabel(profile.lastNativeMode, t) : null;
  const lastFailure = cleanReason(profile?.lastFailureReason);
  const lastFailureMode = profile?.lastFailureMode ? outputModeLabel(profile.lastFailureMode, t) : null;

  return [
    {
      label: t('audioSignalPath.atlas.observedRates'),
      value: observedRates,
      detail: t('audioSignalPath.atlas.observedOnly'),
      tone: profile?.observedOutputRates.length ? 'process' : 'muted',
    },
    {
      label: t('audioSignalPath.atlas.nativeProof'),
      value: nativeRate ?? t('audioSignalPath.atlas.nativeNone'),
      detail: nativeRate && nativeMode
        ? t('audioSignalPath.atlas.nativeDetail', { mode: nativeMode })
        : t('audioSignalPath.atlas.nativeNoneDetail'),
      tone: nativeRate ? 'good' : 'muted',
    },
    {
      label: t('audioSignalPath.atlas.resampleTendency'),
      value: profile?.fortyFourToFortyEightCount
        ? t('audioSignalPath.atlas.resample441To48', { count: profile.fortyFourToFortyEightCount })
        : t('audioSignalPath.atlas.resampleNone'),
      detail: profile?.sampleRateConversionCount
        ? t('audioSignalPath.atlas.resampleDetail', { count: profile.sampleRateConversionCount })
        : t('audioSignalPath.atlas.resampleNoneDetail'),
      tone: profile?.fortyFourToFortyEightCount ? 'warning' : 'good',
    },
    {
      label: t('audioSignalPath.atlas.lastIssue'),
      value: lastFailure ?? t('audioSignalPath.atlas.lastIssueNone'),
      detail: lastFailureMode
        ? t('audioSignalPath.atlas.lastIssueDetail', { mode: lastFailureMode })
        : t('audioSignalPath.atlas.lastIssueNoneDetail'),
      tone: lastFailure ? 'warning' : 'good',
    },
  ];
};

const atlasResamplingAdvice = (
  profile: DacCapabilityAtlasProfile | null,
  t: Translate = fallbackT,
): string | null => {
  if (!profile?.lastNativeMode || !profile.lastNativeRate) {
    return null;
  }

  return t('audioSignalPath.doctor.resampling.atlasAdvice', {
    mode: outputModeLabel(profile.lastNativeMode, t),
    rate: formatRoonRate(profile.lastNativeRate) ?? t('audioSignalPath.atlas.pending'),
  });
};

const flightKindTitle = (entry: AudioRouteFlightEntry, t: Translate = fallbackT): string => {
  if (entry.kind === 'takeover') {
    return t('audioSignalPath.flight.kind.takeover');
  }
  if (entry.kind === 'rate-conversion') {
    return t('audioSignalPath.flight.kind.rateConversion');
  }
  if (entry.kind === 'failure') {
    return t('audioSignalPath.flight.kind.failure');
  }
  if (entry.kind === 'fallback') {
    return t('audioSignalPath.flight.kind.fallback');
  }
  return t('audioSignalPath.flight.kind.routeChange');
};

const formatFlightTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const flightRateLabel = (rate: number | null, t: Translate = fallbackT): string =>
  formatRoonRate(rate) ?? t('audioSignalPath.flight.ratePending');

const flightEntryDetail = (entry: AudioRouteFlightEntry, t: Translate = fallbackT): string => {
  const from = entry.previousRouteLabel ?? t('audioSignalPath.flight.routeUnknown');
  const to = entry.routeLabel || outputModeLabel(entry.outputMode, t);
  const outputRate = flightRateLabel(entry.outputRate, t);
  const ratePath = `${flightRateLabel(entry.sourceRate, t)} -> ${outputRate}`;
  const reason = cleanReason(entry.reason) ?? t('audioSignalPath.flight.reasonUnknown');

  if (entry.kind === 'takeover') {
    return t('audioSignalPath.flight.detail.takeover', { device: entry.deviceName, route: to, rate: outputRate });
  }
  if (entry.kind === 'rate-conversion') {
    return t('audioSignalPath.flight.detail.rateConversion', { path: ratePath, device: entry.deviceName });
  }
  if (entry.kind === 'failure') {
    return t('audioSignalPath.flight.detail.failure', { device: entry.deviceName, route: to, reason });
  }
  if (entry.kind === 'fallback') {
    return t('audioSignalPath.flight.detail.fallback', { from, to, reason });
  }

  return t('audioSignalPath.flight.detail.routeChange', { from, to, device: entry.deviceName });
};

const flightEntryTrackLabel = (
  entry: AudioRouteFlightEntry,
  currentTrackKey: string | null,
  t: Translate = fallbackT,
): string =>
  currentTrackKey && entry.trackKey === currentTrackKey
    ? t('audioSignalPath.flight.currentTrack')
    : entry.trackTitle ?? t('audioSignalPath.flight.recentRoute');

const sourceLabel = (status: AudioStatus | null, track: LibraryTrack | null, t: Translate = fallbackT): string => {
  const codec = normalizeCodec(track?.codec ?? status?.codec);
  const sampleRate = formatRate(track?.sampleRate ?? status?.fileSampleRate);
  const bitDepth = formatBitDepth(track?.bitDepth ?? status?.bitDepth);

  return joinSpec([codec, sampleRate, bitDepth], status ? t('audioSignalPath.source.audioSource') : unknown(t));
};

const roonSourceLabel = (status: AudioStatus | null, track: LibraryTrack | null, t: Translate = fallbackT): string => {
  const codec = normalizeCodec(track?.codec ?? status?.codec);
  const sampleRate = formatRoonRate(track?.sampleRate ?? status?.fileSampleRate);
  const bitDepth = formatRoonBitDepth(track?.bitDepth ?? status?.bitDepth);
  const channels = status?.channels && Number.isFinite(status.channels) ? `${Math.round(status.channels)}ch` : null;

  return joinSpec([codec, sampleRate, bitDepth, channels], status ? t('audioSignalPath.source.audioSource') : unknown(t)).replaceAll(' / ', ' ');
};

const sourceCompactSpec = (status: AudioStatus | null, track: LibraryTrack | null, t: Translate = fallbackT): string => {
  const codec = normalizeCodec(track?.codec ?? status?.codec);
  const sampleRate = compactRate(track?.sampleRate ?? status?.fileSampleRate);
  const bitDepth = track?.bitDepth ?? status?.bitDepth;
  const bitDepthLabel = bitDepth && Number.isFinite(bitDepth) ? `${Math.round(bitDepth)}` : null;

  return joinSpec([codec, sampleRate, bitDepthLabel ? `${bitDepthLabel}b` : null], t('audioSignalPath.source.signal'));
};

const buildDspModules = (status: AudioStatus | null, t: Translate = fallbackT): string[] => {
  if (!status) {
    return [];
  }

  const echoSrcBackendLabel = formatEchoSrcBackendLabel(status.echoSrcRuntime?.activeBackend ?? null);
  const echoSrcModule = status.echoSrcActive
    ? status.echoSrcRuntime?.state === 'fallback'
      ? `ECHO SRC fallback ${echoSrcBackendLabel ?? 'SRC'}`
      : echoSrcBackendLabel
        ? `ECHO SRC ${echoSrcBackendLabel}`
        : status.echoSrcCudaActive
          ? 'ECHO SRC CUDA FIR'
          : 'ECHO SRC'
    : null;
  const sdmModule = status.sdmRuntimeState === 'pcm_to_sdm_active' || status.sdmRuntime?.state === 'fallback'
    ? status.sdmRuntime?.state === 'fallback'
      ? 'ECHO SDM fallback'
      : status.sdmRuntime?.activeBackend === 'cuda'
        ? 'ECHO SDM CUDA'
        : 'ECHO SDM CPU'
    : null;

  return [
    status.dspActive && Math.abs(status.dspHeadroomDb ?? 0) > 0.05
      ? `Headroom ${formatDb(status.dspHeadroomDb) ?? ''}`.trim()
      : null,
    status.eqEnabled ? status.eqPresetName ? `EQ ${status.eqPresetName}` : 'EQ' : null,
    echoSrcModule,
    sdmModule,
    status.roomCorrectionEnabled ? t('audioSignalPath.dsp.roomCorrectionModule') : null,
    status.channelBalanceEnabled ? t('audioSignalPath.dsp.channelBalance') : null,
    status.replayGainEnabled ? `ReplayGain ${formatDb(status.replayGainAppliedDb) ?? ''}`.trim() : null,
    status.dspLimiterProtecting ? t('audioSignalPath.dsp.safetyLimiter') : null,
  ].filter((module): module is string => Boolean(module));
};

export const buildAudioSignalPathNodes = (status: AudioStatus | null, track: LibraryTrack | null, t: Translate = fallbackT): SignalNode[] => {
  const dspModules = buildDspModules(status, t);
  const outputRate = formatRate(status?.actualDeviceSampleRate ?? status?.requestedOutputSampleRate ?? status?.sharedDeviceSampleRate);
  const sourceTone: SignalTone = status ? 'good' : 'muted';
  const decodeTone: SignalTone = status?.resampling ? 'warning' : status ? 'good' : 'muted';
  const dspTone: SignalTone = status?.dspLimiterProtecting || status?.dspClippingRisk ? 'danger' : dspModules.length ? 'warning' : status ? 'good' : 'muted';
  const outputTone: SignalTone = status?.sampleRateMismatch || status?.error ? 'danger' : status ? 'good' : 'muted';

  return [
    {
      title: t('audioSignalPath.node.source'),
      value: sourceLabel(status, track, t),
      detail: joinSpec([
        formatChannels(status?.channels),
        formatBitrate(track?.bitrate ?? status?.bitrate),
        track?.mediaType === 'streaming' ? track.provider ?? t('audioSignalPath.source.online') : track?.mediaType === 'remote' ? t('audioSignalPath.source.remote') : t('audioSignalPath.source.local'),
      ], status ? t('audioSignalPath.source.loading') : unknown(t)),
      icon: Database,
      tone: sourceTone,
    },
    {
      title: t('audioSignalPath.node.decode'),
      value: formatDecodeBackend(status, t),
      detail: status?.resampling
        ? t('audioSignalPath.decode.resamplingTo', { rate: formatRate(status.decoderOutputSampleRate ?? status.requestedOutputSampleRate) ?? t('audioSignalPath.decode.outputRate') })
        : t('audioSignalPath.decode.keepRate', { rate: formatRate(status?.decoderOutputSampleRate ?? status?.fileSampleRate) ?? t('audioSignalPath.decode.originalRate') }),
      icon: Cpu,
      tone: decodeTone,
    },
    {
      title: t('audioSignalPath.node.process'),
      value: dspModules.length ? dspModules.join(' + ') : t('audioSignalPath.process.nativePath'),
      detail: dspModules.length ? t('audioSignalPath.process.echoChain') : t('audioSignalPath.process.noProcessing'),
      icon: dspModules.length ? SlidersHorizontal : ShieldCheck,
      tone: dspTone,
    },
    {
      title: t('audioSignalPath.node.output'),
      value: status?.outputDeviceName ?? t('audioSignalPath.output.systemDefaultDevice'),
      detail: joinSpec([
        outputModeLabel(status?.outputMode, t),
        outputBackendLabel(status?.activeOutputBackendImpl ?? status?.outputBackend),
        outputRate,
      ], status ? outputModeLabel(status.outputMode, t) : unknown(t)),
      icon: Speaker,
      tone: outputTone,
    },
  ];
};

const summaryTone = (status: AudioStatus | null): SignalTone => {
  if (!status) {
    return 'muted';
  }
  if (status.error || status.sampleRateMismatch) {
    return 'danger';
  }
  if (status.dspLimiterProtecting || status.dspClippingRisk) {
    return 'warning';
  }
  if (
    status.resampling
    || status.dspActive
    || status.eqEnabled
    || status.roomCorrectionEnabled
    || status.channelBalanceEnabled
    || status.replayGainEnabled
  ) {
    return 'process';
  }
  return 'good';
};

const getSignalSummary = (status: AudioStatus | null, track: LibraryTrack | null, t: Translate = fallbackT): SignalSummary => {
  const tone = summaryTone(status);
  const spec = sourceCompactSpec(status, track, t);
  const resamplePath = formatResamplePath(status, track);

  if (!status) {
    return {
      label: t('audioSignalPath.summary.waitingPlayback'),
      detail: t('audioSignalPath.summary.showAfterPlayback'),
      spec,
      tone,
    };
  }
  if (status.error) {
    return {
      label: t('audioSignalPath.summary.pathError'),
      detail: formatSignalPathErrorDetail(status.error, t('audioSignalPath.summary.checkOutput')),
      spec,
      tone,
    };
  }
  if (status.sampleRateMismatch) {
    return {
      label: t('audioSignalPath.summary.sampleRateMismatch'),
      detail: t('audioSignalPath.summary.sourceDeviceMismatch'),
      spec,
      tone,
    };
  }
  if (status.dspLimiterProtecting) {
    return {
      label: t('audioSignalPath.summary.protecting'),
      detail: t('audioSignalPath.summary.limiterProtecting'),
      spec,
      tone,
    };
  }
  if (status.echoSrcActive) {
    return {
      label: t('audioSignalPath.summary.upsampling'),
      detail: formatEchoSrcPath(status, track) ?? 'ECHO SRC active',
      spec,
      tone,
    };
  }
  if (
    status.dspActive
    || status.eqEnabled
    || status.roomCorrectionEnabled
    || status.channelBalanceEnabled
    || status.replayGainEnabled
  ) {
    return {
      label: t('audioSignalPath.summary.enhanced'),
      detail: buildDspModules(status, t).slice(0, 2).join(' + ') || 'DSP active',
      spec,
      tone,
    };
  }
  if (status.resampling) {
    return {
      label: t('audioSignalPath.summary.resampling'),
      detail: resamplePath ?? t('audioSignalPath.summary.toRate', { rate: formatRate(status.decoderOutputSampleRate ?? status.requestedOutputSampleRate) ?? t('audioSignalPath.decode.outputRate') }),
      spec,
      tone,
    };
  }
  if (status.bitPerfectCandidate) {
    return {
      label: t('audioSignalPath.summary.bitPerfectCandidate'),
      detail: t('audioSignalPath.summary.outputModeOutput', { mode: outputModeLabel(status.outputMode, t) }),
      spec,
      tone,
    };
  }

  return {
    label: t('audioSignalPath.summary.nativePlayback'),
    detail: t('audioSignalPath.summary.dspOff'),
    spec,
    tone,
  };
};

const getRoonPathLabel = (status: AudioStatus | null, t: Translate = fallbackT): string => {
  if (!status) {
    return t('audioSignalPath.path.waiting');
  }
  if (status.error) {
    return t('audioSignalPath.summary.pathError');
  }
  if (status.sampleRateMismatch) {
    return t('audioSignalPath.summary.sampleRateMismatch');
  }
  if (status.dspLimiterProtecting || status.dspClippingRisk) {
    return t('audioSignalPath.summary.protecting');
  }
  if (
    status.dspActive
    || status.eqEnabled
    || status.roomCorrectionEnabled
    || status.channelBalanceEnabled
    || status.replayGainEnabled
  ) {
    return t('audioSignalPath.summary.enhanced');
  }
  if (status.resampling) {
    return t('audioSignalPath.summary.resampling');
  }
  return t('audioSignalPath.path.lossless');
};

const getDisplayRoonPathLabel = (status: AudioStatus | null, t: Translate = fallbackT): string =>
  status?.echoSrcActive ? t('audioSignalPath.summary.upsampling') : getRoonPathLabel(status, t);

const outputLabel = (status: AudioStatus | null, t: Translate = fallbackT): string => {
  if (!status) {
    return unknown(t);
  }
  if (status.outputMode === 'exclusive') {
    return t('audioSignalPath.output.exclusive');
  }
  if (status.outputMode === 'system') {
    return t('audioSignalPath.output.system');
  }
  return t('audioSignalPath.output.shared');
};

const hasOutputFallbackSignal = (status: AudioStatus | null): boolean => {
  if (!status) {
    return false;
  }

  const haystack = [
    status.error,
    status.bitPerfectDisabledReason,
    ...status.warnings,
  ].filter(Boolean).join(' ').toLowerCase();

  return /fallback|fell[_ -]?back|returned to shared|compatibility_mode|recovery/u.test(haystack);
};

const requestedOutputLabel = (status: AudioStatus | null, t: Translate = fallbackT): string => {
  if (!status) {
    return t('audioSignalPath.stability.pending');
  }

  if (status.outputMode === 'system') {
    return t('audioSignalPath.output.system');
  }

  if (hasOutputFallbackSignal(status) && status.outputMode === 'shared') {
    if (status.warnings.some((warning) => /exclusive|wasapi exclusive/iu.test(warning)) || /exclusive|wasapi exclusive/iu.test(status.error ?? '')) {
      return t('audioSignalPath.output.exclusive');
    }
  }

  return outputLabel(status, t);
};

const stabilityReason = (status: AudioStatus | null, t: Translate = fallbackT): string => {
  if (!status) {
    return t('audioSignalPath.stability.reasonWaiting');
  }

  const formattedError = formatAudioHostError(status.error);
  if (formattedError) {
    return formattedError;
  }

  if (status.outputMode === 'system') {
    return t('audioSignalPath.stability.reasonSystem');
  }

  const warning = status.warnings.find((item) => item.trim().length > 0);
  const warningReason = cleanReason(warning);
  if (warningReason) {
    return warningReason;
  }

  if (status.sampleRateMismatch) {
    return t('audioSignalPath.stability.reasonRateMismatch');
  }

  if (status.resampling || status.echoSrcActive) {
    return t('audioSignalPath.stability.reasonResampling');
  }

  if (status.dspActive || status.eqEnabled || status.roomCorrectionEnabled || status.channelBalanceEnabled || status.replayGainEnabled) {
    return t('audioSignalPath.stability.reasonDsp');
  }

  return t('audioSignalPath.stability.reasonClean');
};

const buildLocalStabilityReadout = (
  status: AudioStatus | null,
  track: LibraryTrack | null,
  t: Translate = fallbackT,
): SignalStabilityReadout => {
  const sourceRate = status?.fileSampleRate ?? track?.sampleRate ?? null;
  const outputRate = status?.actualDeviceSampleRate ?? status?.sharedDeviceSampleRate ?? status?.requestedOutputSampleRate ?? null;
  const fallbackActive = status?.outputMode !== 'system' && hasOutputFallbackSignal(status);
  const dspModules = buildDspModules(status, t);
  const chainTone: SignalTone = !status
    ? 'muted'
    : status.error || status.sampleRateMismatch
      ? 'danger'
      : fallbackActive || status.outputMode === 'system'
        ? 'warning'
        : status.dspActive || status.resampling || status.echoSrcActive
          ? 'process'
          : 'good';
  const actualRoute = joinSpec([
    outputLabel(status, t),
    outputBackendLabel(status?.activeOutputBackendImpl ?? status?.outputBackend),
  ], outputLabel(status, t));
  const fallbackDetail = !status
    ? t('audioSignalPath.stability.fallbackWaiting')
    : fallbackActive
      ? t('audioSignalPath.stability.fallbackActive')
      : status.outputMode === 'system'
        ? t('audioSignalPath.stability.fallbackSystem')
        : t('audioSignalPath.stability.fallbackNone');
  const dspValue = dspModules.length
    ? dspModules.slice(0, 3).join(' + ')
    : status?.dspActive
      ? t('audioSignalPath.stability.dspActive')
      : t('audioSignalPath.stability.dspBypassed');
  const dspDetail = status?.dspLimiterProtecting
    ? t('audioSignalPath.stability.dspLimiter')
    : status?.dspClippingRisk || status?.clippingRisk
      ? t('audioSignalPath.stability.dspRisk')
      : status?.dspActive || dspModules.length
        ? t('audioSignalPath.stability.dspInPath')
        : t('audioSignalPath.stability.dspOffDetail');
  const rateValue = ratePairLabel(sourceRate, outputRate, t('audioSignalPath.metric.clockPending'));
  const rateDetail = status?.sampleRateMismatch
    ? t('audioSignalPath.stability.rateMismatch')
    : status?.resampling || status?.echoSrcActive
      ? t('audioSignalPath.stability.rateConverted')
      : outputRate
        ? t('audioSignalPath.stability.rateActual', { rate: formatRate(outputRate) ?? t('audioSignalPath.unknown') })
        : t('audioSignalPath.stability.pending');

  return {
    headline: !status
      ? t('audioSignalPath.stability.headlineWaiting')
      : status.error
        ? t('audioSignalPath.stability.headlineError')
        : fallbackActive
          ? t('audioSignalPath.stability.headlineFallback')
          : status.outputMode === 'system'
            ? t('audioSignalPath.stability.headlineSystem')
            : t('audioSignalPath.stability.headlineLive'),
    detail: stabilityReason(status, t),
    tone: chainTone,
    facts: [
      {
        label: t('audioSignalPath.stability.requested'),
        value: requestedOutputLabel(status, t),
        detail: t('audioSignalPath.stability.requestedDetail'),
        tone: fallbackActive ? 'warning' : status ? 'good' : 'muted',
      },
      {
        label: t('audioSignalPath.stability.actual'),
        value: actualRoute,
        detail: fallbackDetail,
        tone: chainTone,
      },
      {
        label: t('audioSignalPath.stability.sampleRate'),
        value: rateValue,
        detail: rateDetail,
        tone: status?.sampleRateMismatch ? 'danger' : status?.resampling || status?.echoSrcActive ? 'process' : status ? 'good' : 'muted',
      },
      {
        label: t('audioSignalPath.stability.dsp'),
        value: dspValue,
        detail: dspDetail,
        tone: status?.dspClippingRisk || status?.clippingRisk ? 'danger' : status?.dspActive || dspModules.length ? 'process' : status ? 'good' : 'muted',
      },
    ],
  };
};

const buildHqPlayerStabilityReadout = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  hqPlayerStatus: HqPlayerStatus | null,
  t: Translate = fallbackT,
): SignalStabilityReadout => {
  const playbackStatus = hqPlayerStatus?.playbackStatus ?? null;
  const sourceRate = track?.sampleRate ?? playbackStatus?.metadata?.sampleRate ?? null;
  const outputRate = playbackStatus?.activeRate ?? null;
  const tone = hqPlayerTone(connectStatus);
  const error = cleanReason(connectStatus.error);

  return {
    headline: connectStatus.state === 'error'
      ? t('audioSignalPath.stability.headlineError')
      : t('audioSignalPath.stability.headlineExternal'),
    detail: error ?? t('audioSignalPath.stability.reasonExternal'),
    tone,
    facts: [
      {
        label: t('audioSignalPath.stability.requested'),
        value: 'HQPlayer',
        detail: connectProtocolLabel(connectStatus.protocol),
        tone,
      },
      {
        label: t('audioSignalPath.stability.actual'),
        value: hqPlayerStatus?.controlInfo?.product ?? 'HQPlayer',
        detail: hqPlayerStateLabel(playbackStatus?.state ?? connectStatus.state, t),
        tone,
      },
      {
        label: t('audioSignalPath.stability.sampleRate'),
        value: outputRate
          ? hqPlayerRatePairLabel(sourceRate, outputRate, t('audioSignalPath.metric.hqPlayerClock'))
          : ratePairLabel(sourceRate, playbackStatus?.metadata?.sampleRate ?? null, t('audioSignalPath.metric.hqPlayerClock')),
        detail: playbackStatus?.activeMode ?? t('audioSignalPath.metric.externalRendererClock'),
        tone,
      },
      {
        label: t('audioSignalPath.stability.dsp'),
        value: hqPlayerDspLabel(playbackStatus) ?? t('audioSignalPath.metric.external'),
        detail: t('audioSignalPath.hqPlayer.externalChain'),
        tone: connectStatus.state === 'error' ? 'danger' : 'process',
      },
    ],
  };
};

const buildResolvedStabilityReadout = (
  status: AudioStatus | null,
  track: LibraryTrack | null,
  connectStatus: ConnectSessionStatus | null | undefined,
  hqPlayerStatus: HqPlayerStatus | null,
  t: Translate = fallbackT,
): SignalStabilityReadout =>
  isHqPlayerSignalPath(connectStatus)
    ? buildHqPlayerStabilityReadout(connectStatus, track, hqPlayerStatus, t)
    : buildLocalStabilityReadout(status, track, t);

const outputBitDepthLabel = (format: string | null | undefined): string => {
  const normalized = format?.toLowerCase() ?? '';

  if (normalized.includes('16')) {
    return '16bit';
  }
  if (normalized.includes('24')) {
    return '24bit';
  }
  return '32bit';
};

const buildRoonProcessingNodes = (status: AudioStatus | null, track: LibraryTrack | null, t: Translate = fallbackT): RoonSignalNode[] => {
  if (!status) {
    return [];
  }

  const nodes: RoonSignalNode[] = [];
  const echoSrcPath = formatEchoSrcPath(status, track);
  const sdmPath = formatSdmPath(status, track);
  const resamplePath = echoSrcPath || sdmPath ? null : formatResamplePath(status, track);
  const echoSrcRuntimeBackend = status.echoSrcRuntime?.activeBackend ?? null;
  const echoSrcRuntimeFallback = status.echoSrcRuntime?.state === 'fallback';
  const echoSrcTitle = echoSrcRuntimeFallback
    ? 'ECHO SRC fallback'
    : echoSrcRuntimeBackend === 'cuda'
      ? 'ECHO SRC CUDA FIR'
      : echoSrcRuntimeBackend === 'cpu'
        ? 'ECHO SRC CPU FIR'
        : status.echoSrcCudaActive
          ? 'ECHO SRC CUDA FIR'
          : t('audioSignalPath.processing.echoSrcUpsampling');

  if (echoSrcPath) {
    nodes.push({
      badge: '',
      title: echoSrcTitle,
      value: echoSrcPath,
      tone: 'process',
      variant: 'process',
    });
  }

  if (sdmPath) {
    nodes.push({
      badge: '',
      title: status.sdmRuntime?.state === 'fallback'
        ? 'ECHO SDM fallback'
        : status.sdmRuntime?.activeBackend === 'cuda'
          ? 'ECHO SDM CUDA'
          : 'ECHO SDM',
      value: sdmPath,
      tone: 'process',
      variant: 'process',
    });
  }

  if (resamplePath) {
    nodes.push({
      badge: '',
      title: t('audioSignalPath.summary.resampling'),
      value: resamplePath,
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.replayGainEnabled) {
    nodes.push({
      badge: '',
      title: t('audioSignalPath.processing.volumeNormalization'),
      value: joinSpec([
        'ReplayGain',
        formatDb(status.replayGainAppliedDb),
      ], 'ReplayGain'),
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.channelBalanceEnabled) {
    nodes.push({
      badge: '',
      title: t('audioSignalPath.processing.channelProcessing'),
      value: t('audioSignalPath.dsp.channelBalance'),
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.roomCorrectionEnabled) {
    nodes.push({
      badge: '',
      title: t('audioSignalPath.processing.roomCorrection'),
      value: t('audioSignalPath.processing.firAcoustic'),
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.eqEnabled) {
    nodes.push({
      badge: '',
      title: t('audioSignalPath.processing.parametricEq'),
      value: t('audioSignalPath.processing.fiveBands'),
      tone: 'process',
      variant: 'process',
    });
  }

  if (nodes.length || status.dspActive) {
    nodes.push({
      badge: '',
      title: t('audioSignalPath.processing.bitDepthConversion'),
      value: t('audioSignalPath.processing.bitDepthTo', { depth: outputBitDepthLabel(status.nativeOutputFormat) }),
      tone: 'process',
      variant: 'process',
    });
  }

  return nodes;
};

const buildRoonSignalPathNodes = (status: AudioStatus | null, track: LibraryTrack | null, t: Translate = fallbackT): RoonSignalNode[] => {
  const codec = normalizeCodec(track?.codec ?? status?.codec) ?? 'SRC';
  const directDecodeNode: RoonSignalNode[] = isNativeDirectDecodeBackend(status)
    ? [{
        badge: '',
        title: t('audioSignalPath.node.decode'),
        value: t('audioSignalPath.decode.nativeDirect'),
        icon: Cpu,
        tone: 'good',
      }]
    : [];
  const processingNodes = buildRoonProcessingNodes(status, track, t);
  const transport = joinSpec([
    outputModeLabel(status?.outputMode, t),
    outputBackendLabel(status?.activeOutputBackendImpl ?? status?.outputBackend),
  ], status ? outputModeLabel(status.outputMode, t) : unknown(t));
  const outputDetail = joinSpec([
    outputLabel(status, t),
    formatRoonRate(status?.actualDeviceSampleRate ?? status?.sharedDeviceSampleRate ?? status?.requestedOutputSampleRate),
  ], outputLabel(status, t));

  return [
    {
      badge: codec.length > 4 ? codec.slice(0, 4) : codec,
      title: t('audioSignalPath.node.dataSource'),
      value: roonSourceLabel(status, track, t),
      tone: status ? 'good' : 'muted',
    },
    ...directDecodeNode,
    ...processingNodes,
    {
      badge: '',
      title: status?.outputDeviceName ?? t('audioSignalPath.node.playbackDevice'),
      value: transport,
      icon: Waves,
      tone: status?.sampleRateMismatch || status?.error ? 'danger' : status ? 'good' : 'muted',
    },
    {
      badge: '',
      title: t('audioSignalPath.node.output'),
      value: outputDetail,
      icon: Speaker,
      tone: status?.sampleRateMismatch || status?.error ? 'danger' : status ? 'good' : 'muted',
    },
  ];
};

const getHqPlayerSignalSummary = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  hqPlayerStatus: HqPlayerStatus | null,
  t: Translate = fallbackT,
): SignalSummary => {
  const playbackStatus = hqPlayerStatus?.playbackStatus ?? null;
  const tone = hqPlayerTone(connectStatus);
  const dsp = hqPlayerDspLabel(playbackStatus);
  const output = hqPlayerOutputLabel(playbackStatus, t);

  const detail = cleanReason(connectStatus.error)
    ?? (dsp
      ? `${output} / ${dsp}`
      : `${hqPlayerStateLabel(playbackStatus?.state ?? connectStatus.state, t)} / ${t('audioSignalPath.hqPlayer.externalChain')}`);

  return {
    label: connectStatus.state === 'error' ? t('audioSignalPath.hqPlayer.error') : 'HQPlayer',
    detail,
    spec: hqPlayerCompactSpec(connectStatus, track, playbackStatus),
    tone,
  };
};

const getResolvedSignalSummary = (
  status: AudioStatus | null,
  track: LibraryTrack | null,
  connectStatus: ConnectSessionStatus | null | undefined,
  hqPlayerStatus: HqPlayerStatus | null,
  t: Translate = fallbackT,
): SignalSummary =>
  isHqPlayerSignalPath(connectStatus)
    ? getHqPlayerSignalSummary(connectStatus, track, hqPlayerStatus, t)
    : getSignalSummary(status, track, t);

const buildHqPlayerSignalPathNodes = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  hqPlayerStatus: HqPlayerStatus | null,
  t: Translate = fallbackT,
): RoonSignalNode[] => {
  const playbackStatus = hqPlayerStatus?.playbackStatus ?? null;
  const codec = normalizeHqPlayerCodec(track, playbackStatus, connectStatus) ?? 'HQ';
  const product = hqPlayerStatus?.controlInfo?.product?.trim() || 'HQPlayer Desktop';
  const dsp = hqPlayerDspLabel(playbackStatus);
  const playbackState = hqPlayerStateLabel(playbackStatus?.state ?? connectStatus.state, t);
  const output = hqPlayerOutputLabel(playbackStatus, t);
  const sourceTone: SignalTone = connectStatus.state === 'error' ? 'danger' : 'good';
  const processTone: SignalTone = connectStatus.state === 'error' ? 'danger' : 'process';

  return [
    {
      badge: codec.length > 4 ? codec.slice(0, 4) : codec,
      title: t('audioSignalPath.node.dataSource'),
      value: hqPlayerSourceLabel(connectStatus, track, playbackStatus, t),
      tone: sourceTone,
    },
    {
      badge: '',
      title: product,
      value: dsp ?? `${playbackState} / ${t('audioSignalPath.hqPlayer.externalChain')}`,
      icon: SlidersHorizontal,
      tone: processTone,
      variant: 'process',
    },
    {
      badge: '',
      title: t('audioSignalPath.node.output'),
      value: output === t('audioSignalPath.hqPlayer.outputDecided')
        ? `${output} / ${t('audioSignalPath.hqPlayer.externalRendering')}`
        : `${t('audioSignalPath.hqPlayer.output')} / ${output}`,
      icon: Speaker,
      tone: processTone,
    },
  ];
};

const buildResolvedSignalPathNodes = (
  status: AudioStatus | null,
  track: LibraryTrack | null,
  connectStatus: ConnectSessionStatus | null | undefined,
  hqPlayerStatus: HqPlayerStatus | null,
  t: Translate = fallbackT,
): RoonSignalNode[] =>
  isHqPlayerSignalPath(connectStatus)
    ? buildHqPlayerSignalPathNodes(connectStatus, track, hqPlayerStatus, t)
    : buildRoonSignalPathNodes(status, track, t);

const connectProtocolLabel = (protocol: ConnectSessionStatus['protocol'] | null | undefined): string => {
  if (protocol === 'hqplayer') {
    return 'HQPlayer Connect';
  }
  if (protocol === 'dlna') {
    return 'DLNA / UPnP';
  }
  if (protocol === 'airplay') {
    return 'AirPlay / RAOP';
  }
  return 'Local output';
};

const ratePairLabel = (
  sourceRate: number | null | undefined,
  outputRate: number | null | undefined,
  fallback: string,
): string => {
  const source = formatRoonRate(sourceRate);
  const output = formatRoonRate(outputRate);

  if (source && output) {
    return source === output ? `${source} locked` : `${source} -> ${output}`;
  }

  return joinSpec([source, output], fallback);
};

const hqPlayerRatePairLabel = (
  sourceRate: number | null | undefined,
  outputRate: number | null | undefined,
  fallback: string,
): string => {
  const source = formatRoonRate(sourceRate);
  const output = formatHqPlayerOutputRate(outputRate);

  if (source && output) {
    return source === output ? `${source} locked` : `${source} -> ${output}`;
  }

  return joinSpec([source, output], fallback);
};

const finiteNumber = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? value : null;

const signalPeakFillPercent = (peakDb: number | null | undefined): number => {
  const peak = finiteNumber(peakDb);
  if (peak === null) {
    return 0;
  }

  return clampPercent(((Math.max(-64, Math.min(0, peak)) + 64) / 64) * 100);
};

const signalLiveFillPercent = (status: AudioStatus | null): number => {
  const levels = status?.audioLevels;
  const visualEnergy = finiteNumber(levels?.visualEnergy);
  if (visualEnergy !== null) {
    return clampPercent(visualEnergy * 100);
  }

  return signalPeakFillPercent(levels?.estimatedOutputPeakDb ?? levels?.inputPeakDb);
};

const signalLiveValueLabel = (status: AudioStatus | null): string | null => {
  const levels = status?.audioLevels;
  return formatDb(levels?.estimatedOutputRmsDb ?? levels?.inputRmsDb ?? levels?.estimatedOutputPeakDb ?? levels?.inputPeakDb);
};

const buildHeadroomMeter = (status: AudioStatus | null, t: Translate = fallbackT): SignalTheaterMeter => {
  const levels = status?.audioLevels;
  const headroomDb = levels?.headroomDb ?? null;
  const clipCount = levels?.clipCount ?? 0;
  const hasClipRisk = Boolean(status?.clippingRisk || status?.dspClippingRisk || status?.dspLimiterProtecting || clipCount > 0);
  const tone: SignalTone = !status
    ? 'muted'
    : hasClipRisk || (headroomDb !== null && headroomDb <= 0.4)
      ? 'danger'
      : headroomDb !== null && headroomDb <= 3
        ? 'warning'
        : 'good';
  const levelPeak = formatDb(levels?.estimatedOutputPeakDb ?? levels?.inputPeakDb);
  const meterSource = levels?.visualTelemetryState === 'pcm'
    ? t('audioSignalPath.meter.sourcePcm')
    : levels?.visualTelemetryState === 'priming'
      ? t('audioSignalPath.meter.sourcePriming')
      : t('audioSignalPath.meter.sourceFallback');
  const detail = !status
    ? t('audioSignalPath.meter.waiting')
    : status.dspLimiterProtecting
      ? t('audioSignalPath.meter.limiterHolding')
      : clipCount > 0
        ? t(clipCount === 1 ? 'audioSignalPath.meter.clipDetected.one' : 'audioSignalPath.meter.clipDetected.many', { count: clipCount })
        : status.dspClippingRisk || status.clippingRisk
          ? t('audioSignalPath.meter.closeToZero')
          : levelPeak
            ? t('audioSignalPath.meter.detail', { source: meterSource, headroom: formatDb(headroomDb) ?? '-- dB', peak: levelPeak })
            : meterSource;

  return {
    label: t('audioSignalPath.metric.liveLevel'),
    value: signalLiveValueLabel(status) ?? '--',
    detail,
    tone,
    fillPercent: signalLiveFillPercent(status),
  };
};

const buildLocalSignalDoctorInsights = (
  status: AudioStatus | null,
  track: LibraryTrack | null,
  atlasProfile: DacCapabilityAtlasProfile | null,
  t: Translate = fallbackT,
): SignalDoctorInsight[] => {
  if (!status) {
    return [{
      eyebrow: t('audioSignalPath.doctor.eyebrow.doctor'),
      title: t('audioSignalPath.doctor.waiting.title'),
      detail: t('audioSignalPath.doctor.waiting.detail'),
      advice: t('audioSignalPath.doctor.waiting.advice'),
      tone: 'muted',
    }];
  }

  const insights: SignalDoctorInsight[] = [];
  const sourceRate = status.fileSampleRate ?? track?.sampleRate ?? null;
  const outputRate = status.actualDeviceSampleRate ?? status.sharedDeviceSampleRate ?? status.requestedOutputSampleRate ?? null;
  const ratePath = ratePairLabel(sourceRate, outputRate, 'rate pending');
  const dspModules = buildDspModules(status, t);
  const headroomDb = status.audioLevels?.headroomDb ?? null;
  const levelPeak = formatDb(status.audioLevels?.estimatedOutputPeakDb ?? status.audioLevels?.inputPeakDb);

  if (status.error || status.sampleRateMismatch) {
    const outputErrorDetail = status.error
      ? formatSignalPathErrorDetail(status.error, t('audioSignalPath.summary.checkOutput'))
      : null;
    insights.push({
      eyebrow: t('audioSignalPath.doctor.eyebrow.status'),
      title: status.error ? t('audioSignalPath.doctor.outputError.title') : t('audioSignalPath.doctor.sampleRateMismatch.title'),
      detail: outputErrorDetail ?? t('audioSignalPath.doctor.sampleRateMismatch.detail', { path: ratePath }),
      advice: status.error ? t('audioSignalPath.doctor.outputError.advice') : t('audioSignalPath.doctor.sampleRateMismatch.advice'),
      tone: 'danger',
    });
  } else if (status.resampling || (
    sourceRate !== null
    && outputRate !== null
    && Number.isFinite(sourceRate)
    && Number.isFinite(outputRate)
    && Math.round(sourceRate) !== Math.round(outputRate)
  )) {
    insights.push({
      eyebrow: t('audioSignalPath.doctor.eyebrow.why'),
      title: t('audioSignalPath.doctor.resampling.title'),
      detail: t('audioSignalPath.doctor.resampling.detail', { path: ratePath }),
      advice: atlasResamplingAdvice(atlasProfile, t) ?? t('audioSignalPath.doctor.resampling.advice'),
      tone: status.echoSrcActive ? 'process' : 'warning',
    });
  }

  if (status.dspLimiterProtecting || status.dspClippingRisk || status.clippingRisk || (headroomDb !== null && headroomDb <= 3)) {
    insights.push({
      eyebrow: t('audioSignalPath.doctor.eyebrow.level'),
      title: status.dspLimiterProtecting ? t('audioSignalPath.doctor.limiter.title') : t('audioSignalPath.doctor.headroom.title'),
      detail: status.dspLimiterProtecting
        ? t('audioSignalPath.doctor.limiter.detail')
        : t('audioSignalPath.doctor.headroom.detail', { headroom: formatDb(headroomDb) ?? '-- dB', peak: levelPeak ?? '-- dB' }),
      advice: status.dspLimiterProtecting
        ? t('audioSignalPath.doctor.limiter.advice')
        : t('audioSignalPath.doctor.headroom.advice'),
      tone: status.dspLimiterProtecting || status.dspClippingRisk || status.clippingRisk ? 'danger' : 'warning',
    });
  }

  if (status.bitPerfectCandidate) {
    insights.push({
      eyebrow: t('audioSignalPath.doctor.eyebrow.bitPerfect'),
      title: t('audioSignalPath.doctor.bitPerfect.title'),
      detail: t('audioSignalPath.doctor.bitPerfect.detail', { mode: outputModeLabel(status.outputMode, t) }),
      advice: t('audioSignalPath.doctor.bitPerfect.advice'),
      tone: 'good',
    });
  } else {
    const blockers = [
      status.resampling || status.echoSrcActive ? t('audioSignalPath.doctor.blocker.rateConversion') : null,
      dspModules.length ? dspModules.slice(0, 2).join(' + ') : null,
      status.outputMode === 'shared' || status.outputMode === 'system' ? outputModeLabel(status.outputMode, t) : null,
      cleanReason(status.bitPerfectDisabledReason),
    ].filter((item): item is string => Boolean(item));

    insights.push({
      eyebrow: t('audioSignalPath.doctor.eyebrow.bitPerfect'),
      title: t('audioSignalPath.doctor.notBitPerfect.title'),
      detail: blockers.length
        ? t('audioSignalPath.doctor.notBitPerfect.detail', { blockers: blockers.join(' / ') })
        : t('audioSignalPath.doctor.notBitPerfect.fallback'),
      advice: t('audioSignalPath.doctor.notBitPerfect.advice'),
      tone: status.sampleRateMismatch || status.error ? 'danger' : 'warning',
    });
  }

  if (status.echoSrcActive) {
    insights.push({
      eyebrow: t('audioSignalPath.doctor.eyebrow.src'),
      title: t('audioSignalPath.doctor.echoSrc.title'),
      detail: formatEchoSrcPath(status, track) ?? t('audioSignalPath.doctor.echoSrc.detail'),
      advice: t('audioSignalPath.doctor.echoSrc.advice'),
      tone: 'process',
    });
  }

  return insights.slice(0, 4);
};

const buildHqPlayerSignalDoctorInsights = (
  connectStatus: ConnectSessionStatus,
  hqPlayerStatus: HqPlayerStatus | null,
  t: Translate = fallbackT,
): SignalDoctorInsight[] => {
  const playbackStatus = hqPlayerStatus?.playbackStatus ?? null;

  if (connectStatus.state === 'error') {
    return [{
      eyebrow: t('audioSignalPath.doctor.eyebrow.hqPlayer'),
      title: t('audioSignalPath.doctor.hqPlayer.error.title'),
      detail: cleanReason(connectStatus.error) ?? t('audioSignalPath.doctor.hqPlayer.error.detail'),
      advice: t('audioSignalPath.doctor.hqPlayer.error.advice'),
      tone: 'danger',
    }];
  }

  const insights: SignalDoctorInsight[] = [{
    eyebrow: t('audioSignalPath.doctor.eyebrow.hqPlayer'),
    title: t('audioSignalPath.doctor.hqPlayer.external.title'),
    detail: t('audioSignalPath.doctor.hqPlayer.external.detail'),
    advice: t('audioSignalPath.doctor.hqPlayer.external.advice'),
    tone: 'process',
  }];

  const output = hqPlayerOutputLabel(playbackStatus, t);
  if (output !== t('audioSignalPath.hqPlayer.outputDecided')) {
    insights.push({
      eyebrow: t('audioSignalPath.doctor.eyebrow.clock'),
      title: t('audioSignalPath.doctor.hqPlayer.output.title'),
      detail: t('audioSignalPath.doctor.hqPlayer.output.detail', { output }),
      advice: t('audioSignalPath.doctor.hqPlayer.output.advice'),
      tone: 'process',
    });
  }

  if (!hasHqPlayerPlaybackDetails(playbackStatus)) {
    insights.push({
      eyebrow: t('audioSignalPath.doctor.eyebrow.status'),
      title: t('audioSignalPath.doctor.hqPlayer.waiting.title'),
      detail: t('audioSignalPath.doctor.hqPlayer.waiting.detail'),
      advice: t('audioSignalPath.doctor.hqPlayer.waiting.advice'),
      tone: 'muted',
    });
  }

  return insights.slice(0, 4);
};

const buildLocalSignalTheater = (
  status: AudioStatus | null,
  track: LibraryTrack | null,
  summary: SignalSummary,
  atlasProfile: DacCapabilityAtlasProfile | null,
  t: Translate = fallbackT,
): SignalTheaterModel => {
  const dspModules = buildDspModules(status, t);
  const outputRate = status?.actualDeviceSampleRate ?? status?.sharedDeviceSampleRate ?? status?.requestedOutputSampleRate ?? null;
  const outputMode = outputModeLabel(status?.outputMode, t);
  const outputBackend = outputBackendLabel(status?.activeOutputBackendImpl ?? status?.outputBackend);
  const processingTone: SignalTone = status?.dspLimiterProtecting || status?.dspClippingRisk
    ? 'danger'
    : dspModules.length || status?.resampling
      ? 'process'
      : status
        ? 'good'
        : 'muted';

  return {
    detail: summary.detail,
    meter: buildHeadroomMeter(status, t),
    doctorInsights: buildLocalSignalDoctorInsights(status, track, atlasProfile, t),
    metrics: [
      {
        label: t('audioSignalPath.metric.source'),
        value: roonSourceLabel(status, track, t),
        detail: joinSpec([formatBitrate(track?.bitrate ?? status?.bitrate), formatChannels(status?.channels)], t('audioSignalPath.metric.mediaMetadata')),
        tone: status ? 'good' : 'muted',
      },
      {
        label: t('audioSignalPath.metric.processing'),
        value: dspModules.length ? dspModules.slice(0, 3).join(' + ') : status?.resampling ? t('audioSignalPath.summary.resampling') : t('audioSignalPath.metric.directPath'),
        detail: formatResamplePath(status, track) ?? (dspModules.length ? t('audioSignalPath.process.echoChain') : t('audioSignalPath.metric.noDspModules')),
        tone: processingTone,
      },
      {
        label: t('audioSignalPath.metric.output'),
        value: status?.outputDeviceName ?? t('audioSignalPath.output.systemDefaultDevice'),
        detail: joinSpec([outputMode, outputBackend, formatRoonRate(outputRate)], outputMode),
        tone: status?.sampleRateMismatch || status?.error ? 'danger' : status ? 'good' : 'muted',
      },
      {
        label: t('audioSignalPath.metric.clock'),
        value: ratePairLabel(status?.fileSampleRate ?? track?.sampleRate, outputRate, t('audioSignalPath.metric.clockPending')),
        detail: status?.bitPerfectCandidate
          ? t('audioSignalPath.metric.bitPerfectCandidate')
          : status?.sampleRateMismatch
            ? t('audioSignalPath.metric.sourceDeviceRateDiffers')
            : status?.resampling || status?.echoSrcActive
              ? t('audioSignalPath.metric.rateConversionActive')
              : t('audioSignalPath.metric.nativeClockPath'),
        tone: status?.sampleRateMismatch ? 'danger' : status?.resampling || status?.echoSrcActive ? 'process' : status ? 'good' : 'muted',
      },
    ],
  };
};

const buildHqPlayerSignalTheater = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  hqPlayerStatus: HqPlayerStatus | null,
  summary: SignalSummary,
  t: Translate = fallbackT,
): SignalTheaterModel => {
  const playbackStatus = hqPlayerStatus?.playbackStatus ?? null;
  const metadata = playbackStatus?.metadata ?? null;
  const output = hqPlayerOutputLabel(playbackStatus, t);
  const dsp = hqPlayerDspLabel(playbackStatus);
  const tone = hqPlayerTone(connectStatus);
  const sourceRate = track?.sampleRate ?? metadata?.sampleRate ?? null;
  const outputRate = playbackStatus?.activeRate ?? null;
  const meterTone: SignalTone = connectStatus.state === 'error' ? 'danger' : tone === 'muted' ? 'muted' : 'process';

  return {
    detail: summary.detail,
    meter: {
      label: t('audioSignalPath.metric.liveLevel'),
      value: t('audioSignalPath.metric.external'),
      detail: connectStatus.state === 'error'
        ? cleanReason(connectStatus.error) ?? t('audioSignalPath.metric.hqPlayerError')
        : t('audioSignalPath.metric.hqPlayerOwnsGain'),
      tone: meterTone,
      fillPercent: meterTone === 'muted' ? 0 : 100,
    },
    doctorInsights: buildHqPlayerSignalDoctorInsights(connectStatus, hqPlayerStatus, t),
    metrics: [
      {
        label: t('audioSignalPath.metric.source'),
        value: hqPlayerSourceLabel(connectStatus, track, playbackStatus, t),
        detail: connectProtocolLabel(connectStatus.protocol),
        tone: connectStatus.state === 'error' ? 'danger' : 'good',
      },
      {
        label: t('audioSignalPath.metric.processing'),
        value: dsp ?? hqPlayerStateLabel(playbackStatus?.state ?? connectStatus.state, t),
        detail: hqPlayerStatus?.controlInfo?.product ?? t('audioSignalPath.hqPlayer.externalChain'),
        tone,
      },
      {
        label: t('audioSignalPath.metric.output'),
        value: output,
        detail: output === t('audioSignalPath.hqPlayer.outputDecided')
          ? t('audioSignalPath.hqPlayer.externalRendering')
          : t('audioSignalPath.hqPlayer.output'),
        tone,
      },
      {
        label: t('audioSignalPath.metric.clock'),
        value: outputRate
          ? hqPlayerRatePairLabel(sourceRate, outputRate, t('audioSignalPath.metric.hqPlayerClock'))
          : ratePairLabel(sourceRate, metadata?.sampleRate ?? null, t('audioSignalPath.metric.hqPlayerClock')),
        detail: playbackStatus?.activeMode ?? t('audioSignalPath.metric.externalRendererClock'),
        tone,
      },
    ],
  };
};

const buildResolvedSignalTheater = (
  status: AudioStatus | null,
  track: LibraryTrack | null,
  connectStatus: ConnectSessionStatus | null | undefined,
  hqPlayerStatus: HqPlayerStatus | null,
  summary: SignalSummary,
  atlasProfile: DacCapabilityAtlasProfile | null,
  t: Translate = fallbackT,
): SignalTheaterModel =>
  isHqPlayerSignalPath(connectStatus)
    ? buildHqPlayerSignalTheater(connectStatus, track, hqPlayerStatus, summary, t)
    : buildLocalSignalTheater(status, track, summary, atlasProfile, t);

const getDisplaySignalPathLabel = (
  status: AudioStatus | null,
  connectStatus: ConnectSessionStatus | null | undefined,
  t: Translate = fallbackT,
): string => {
  if (!isHqPlayerSignalPath(connectStatus)) {
    return getDisplayRoonPathLabel(status, t);
  }

  return connectStatus.state === 'error' ? t('audioSignalPath.hqPlayer.error') : 'HQPlayer';
};

export const AudioSignalPathControl = ({
  isOpen,
  status,
  track,
  connectStatus,
  onClick,
}: AudioSignalPathControlProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? fallbackT;
  const summary = getResolvedSignalSummary(status, track, connectStatus, null, t);
  const label = t('audioSignalPath.control.openLabel', { label: summary.label, spec: summary.spec });

  return (
    <button
      className="signal-path-control"
      type="button"
      data-tone={summary.tone}
      aria-label={label}
      aria-expanded={isOpen}
      title={label}
      onClick={onClick}
    >
      <span className="signal-path-control__mark" aria-hidden="true">
        <Waves size={16} />
      </span>
      <span className="signal-path-control__status-dot" aria-hidden="true" />
    </button>
  );
};

export const AudioSignalPathPopover = ({
  isOpen,
  status,
  track,
  connectStatus,
  onClose,
}: AudioSignalPathPopoverProps): JSX.Element | null => {
  const t = useOptionalI18n()?.t ?? fallbackT;
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isDoctorCollapsed, setIsDoctorCollapsed] = useState(true);
  const [isAtlasCollapsed, setIsAtlasCollapsed] = useState(true);
  const [isFlightRecorderCollapsed, setIsFlightRecorderCollapsed] = useState(true);
  const [hqPlayerStatus, setHqPlayerStatus] = useState<HqPlayerStatus | null>(null);
  const [atlasProfile, setAtlasProfile] = useState<DacCapabilityAtlasProfile | null>(() => getDacCapabilityAtlasProfile(status));
  const [flightEntries, setFlightEntries] = useState<AudioRouteFlightEntry[]>(() => getAudioRouteFlightEntries());
  const closeTimerRef = useRef<number | null>(null);
  const hqPlayerSignalActive = isHqPlayerSignalPath(connectStatus);
  const hqPlayerSessionKey = hqPlayerSignalActive
    ? `${connectStatus.deviceId}:${connectStatus.currentTrackId ?? ''}`
    : null;

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (isOpen) {
      setShouldRender(true);
      return undefined;
    }

    if (!shouldRender) {
      return undefined;
    }

    closeTimerRef.current = window.setTimeout(() => {
      setShouldRender(false);
      closeTimerRef.current = null;
    }, signalPathPopoverExitMs);

    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [isOpen, shouldRender]);

  useEffect(() => {
    setHqPlayerStatus(null);
    setIsDoctorCollapsed(true);
    setIsAtlasCollapsed(true);
    setIsFlightRecorderCollapsed(true);
  }, [hqPlayerSessionKey]);

  useEffect(() => {
    if (isOpen) {
      setIsDoctorCollapsed(true);
      setIsAtlasCollapsed(true);
      setIsFlightRecorderCollapsed(true);
    }
  }, [isOpen]);

  useEffect(() => {
    if (hqPlayerSignalActive) {
      setAtlasProfile(null);
      setFlightEntries(getAudioRouteFlightEntries());
      return;
    }

    setAtlasProfile(recordDacCapabilityObservation(status, track) ?? getDacCapabilityAtlasProfile(status));
    setFlightEntries(recordAudioRouteFlightObservation(status, track));
  }, [hqPlayerSignalActive, status, track]);

  useEffect(() => {
    if (!hqPlayerSignalActive) {
      setHqPlayerStatus(null);
      return undefined;
    }

    if (!isOpen) {
      return undefined;
    }

    let cancelled = false;
    const refreshHqPlayerStatus = (): void => {
      const getStatus = window.echo?.hqPlayer?.getStatus;
      if (!getStatus) {
        return;
      }

      void getStatus()
        .then((nextStatus) => {
          if (!cancelled) {
            setHqPlayerStatus((previousStatus) => {
              if (hasHqPlayerPlaybackDetails(nextStatus.playbackStatus)) {
                return nextStatus;
              }

              if (previousStatus && hasHqPlayerPlaybackDetails(previousStatus.playbackStatus)) {
                return {
                  ...nextStatus,
                  controlInfo: nextStatus.controlInfo ?? previousStatus.controlInfo,
                  playbackStatus: previousStatus.playbackStatus,
                };
              }

              return nextStatus;
            });
          }
        })
        .catch(() => undefined);
    };

    refreshHqPlayerStatus();
    const interval = window.setInterval(refreshHqPlayerStatus, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hqPlayerSessionKey, hqPlayerSignalActive, isOpen]);

  if (!shouldRender) {
    return null;
  }

  const nodes = buildResolvedSignalPathNodes(status, track, connectStatus, hqPlayerStatus, t);
  const summary = getResolvedSignalSummary(status, track, connectStatus, hqPlayerStatus, t);
  const theater = buildResolvedSignalTheater(status, track, connectStatus, hqPlayerStatus, summary, atlasProfile, t);
  const stability = buildResolvedStabilityReadout(status, track, connectStatus, hqPlayerStatus, t);
  const theaterMeterStyle: SignalTheaterMeterStyle = {
    '--signal-meter-fill': `${theater.meter.fillPercent}%`,
  };
  const pathLabel = getDisplaySignalPathLabel(status, connectStatus, t);
  const showAtlas = !hqPlayerSignalActive;
  const showFlightRecorder = showAtlas;
  const atlasTone = atlasProfileTone(atlasProfile);
  const atlasDeviceName = atlasProfile?.deviceName ?? status?.outputDeviceName ?? t('audioSignalPath.output.systemDefaultDevice');
  const atlasFactRows = atlasFacts(atlasProfile, t);
  const atlasModes = atlasModeViews(atlasProfile, status, t);
  const atlasToggleLabel = isAtlasCollapsed ? t('audioSignalPath.atlas.expand') : t('audioSignalPath.atlas.collapse');
  const doctorToggleLabel = isDoctorCollapsed ? t('audioSignalPath.doctor.expand') : t('audioSignalPath.doctor.collapse');
  const flightToggleLabel = isFlightRecorderCollapsed ? t('audioSignalPath.flight.expand') : t('audioSignalPath.flight.collapse');
  const currentFlightTrackKey = audioRouteFlightTrackKey(status, track);
  const currentFlightEntries = currentFlightTrackKey ? flightEntries.filter((entry) => entry.trackKey === currentFlightTrackKey) : [];
  const recentFlightEntries = currentFlightTrackKey ? flightEntries.filter((entry) => entry.trackKey !== currentFlightTrackKey) : flightEntries;
  const flightEntriesForDisplay = [...currentFlightEntries, ...recentFlightEntries].slice(0, 8);
  const flightSummaryLabel = flightEntries.length
    ? t('audioSignalPath.flight.count', { current: currentFlightEntries.length, total: flightEntries.length })
    : t('audioSignalPath.flight.empty');
  const doctorHintCountLabel = t(
    theater.doctorInsights.length === 1 ? 'audioSignalPath.doctor.hintCount.one' : 'audioSignalPath.doctor.hintCount.many',
    { count: theater.doctorInsights.length },
  );

  return (
    <section
      className="signal-path-popover signal-path-popover--roon"
      role="dialog"
      aria-label={t('audioSignalPath.title')}
      data-state={isOpen ? 'open' : 'closing'}
      data-tone={summary.tone}
    >
      <header className="signal-path-roon-header">
        <div>
          <h3>{t('audioSignalPath.header', { path: pathLabel })}</h3>
          <p>{summary.detail}</p>
        </div>
        <button className="signal-path-roon-menu" type="button" aria-label={t('audioSignalPath.closeLabel')} title={t('audioSignalPath.closeTitle')} onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      <div className="signal-path-roon-name" data-tone={summary.tone}>
        <span title={summary.spec}>{summary.spec}</span>
        <em>{t('audioSignalPath.layers', { count: nodes.length })}</em>
      </div>

      <div className="signal-path-theater" data-tone={summary.tone}>
        <div className="signal-path-theater__hero">
          <span>{t('audioSignalPath.theater.title')}</span>
          <strong>{summary.label}</strong>
          <p>{theater.detail}</p>
        </div>
        <div className="signal-path-theater__meter" data-tone={theater.meter.tone} style={theaterMeterStyle}>
          <div>
            <span>{theater.meter.label}</span>
            <strong>{theater.meter.value}</strong>
            <em>{theater.meter.detail}</em>
          </div>
          <div className="signal-path-theater__meter-rail" aria-hidden="true">
            <span />
          </div>
          <small className="signal-path-theater__meter-note">{t('audioSignalPath.meter.note')}</small>
        </div>
        <div className="signal-path-theater__grid">
          {theater.metrics.map((metric) => (
            <article className="signal-path-theater__metric" data-tone={metric.tone} key={metric.label}>
              <span>{metric.label}</span>
              <strong title={metric.value}>{metric.value}</strong>
              <em title={metric.detail}>{metric.detail}</em>
            </article>
          ))}
        </div>
      </div>

      <div className="signal-path-roon-chain">
        {nodes.map((node, index) => {
          const Icon = node.icon;

          return (
            <article
              className="signal-path-roon-node"
              data-tone={node.tone}
              data-variant={node.variant ?? 'circle'}
              key={`${node.title}-${index}`}
            >
              <span className="signal-path-roon-node__badge" aria-hidden="true">
                {Icon ? <Icon size={21} fill={Icon === Speaker ? 'currentColor' : 'none'} /> : node.badge}
              </span>
              <span className="signal-path-roon-node__line" aria-hidden="true" />
              <div className="signal-path-roon-node__copy">
                <span className="signal-path-roon-node__title">
                  <strong title={node.title} data-scroll={node.title.length > 22 ? 'true' : 'false'}>
                    <span>{node.title}</span>
                  </strong>
                </span>
                <em title={node.value}>{node.value}</em>
              </div>
            </article>
          );
        })}
      </div>

      <div
        className="signal-path-doctor"
        aria-label={t('audioSignalPath.doctor.title')}
        data-collapsed={isDoctorCollapsed ? 'true' : undefined}
      >
        <button
          className="signal-path-doctor__header"
          type="button"
          aria-expanded={!isDoctorCollapsed}
          aria-label={doctorToggleLabel}
          title={doctorToggleLabel}
          onClick={() => setIsDoctorCollapsed((current) => !current)}
        >
          <span>{t('audioSignalPath.doctor.title')}</span>
          <strong>{doctorHintCountLabel}</strong>
          <ChevronDown size={15} />
        </button>
        {!isDoctorCollapsed ? (
          <div className="signal-path-doctor__list">
            {theater.doctorInsights.map((insight) => (
              <article className="signal-path-doctor__hint" data-tone={insight.tone} key={`${insight.eyebrow}-${insight.title}`}>
                <span>{insight.eyebrow}</span>
                <strong>{insight.title}</strong>
                <em>{insight.detail}</em>
                <small>{insight.advice}</small>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      {showAtlas ? (
        <section
          className="signal-path-atlas"
          data-collapsed={isAtlasCollapsed ? 'true' : undefined}
          data-tone={atlasTone}
          aria-label={t('audioSignalPath.atlas.title')}
        >
          <button
            className="signal-path-atlas__header"
            type="button"
            aria-expanded={!isAtlasCollapsed}
            aria-label={atlasToggleLabel}
            title={atlasToggleLabel}
            onClick={() => setIsAtlasCollapsed((current) => !current)}
          >
            <div>
              <span>{t('audioSignalPath.atlas.eyebrow')}</span>
              <strong>{t('audioSignalPath.atlas.title')}</strong>
            </div>
            <em title={atlasDeviceName}>{atlasDeviceName}</em>
            <ChevronDown size={15} />
          </button>
          {!isAtlasCollapsed ? (
            <>
              <div className="signal-path-atlas__facts">
                {atlasFactRows.map((fact) => (
                  <article className="signal-path-atlas__fact" data-tone={fact.tone} key={fact.label}>
                    <span>{fact.label}</span>
                    <strong title={fact.value}>{fact.value}</strong>
                    <em title={fact.detail}>{fact.detail}</em>
                  </article>
                ))}
              </div>
              <div className="signal-path-atlas__modes" aria-label={t('audioSignalPath.atlas.modeAria')}>
                {atlasModes.map((modeView) => (
                  <span className="signal-path-atlas__mode" data-tone={modeView.tone} key={modeView.mode} title={modeView.detail}>
                    <strong>{modeView.label}</strong>
                    <em>{modeView.detail}</em>
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {showFlightRecorder ? (
        <section
          className="signal-path-flight"
          data-collapsed={isFlightRecorderCollapsed ? 'true' : undefined}
          aria-label={t('audioSignalPath.flight.title')}
        >
          <button
            className="signal-path-flight__header"
            type="button"
            aria-expanded={!isFlightRecorderCollapsed}
            aria-label={flightToggleLabel}
            title={flightToggleLabel}
            onClick={() => setIsFlightRecorderCollapsed((current) => !current)}
          >
            <div>
              <span>{t('audioSignalPath.flight.eyebrow')}</span>
              <strong>{t('audioSignalPath.flight.title')}</strong>
            </div>
            <em>{flightSummaryLabel}</em>
            <ChevronDown size={15} />
          </button>
          {!isFlightRecorderCollapsed ? (
            flightEntriesForDisplay.length ? (
              <div className="signal-path-flight__timeline">
                {flightEntriesForDisplay.map((entry) => (
                  <article className="signal-path-flight__event" data-tone={entry.tone} key={entry.id}>
                    <time dateTime={entry.at}>{formatFlightTime(entry.at)}</time>
                    <div>
                      <span>{flightEntryTrackLabel(entry, currentFlightTrackKey, t)}</span>
                      <strong>{flightKindTitle(entry, t)}</strong>
                      <em>{flightEntryDetail(entry, t)}</em>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="signal-path-flight__empty">
                <span>{t('audioSignalPath.flight.empty')}</span>
                <em>{t('audioSignalPath.flight.emptyDetail')}</em>
              </div>
            )
          ) : null}
        </section>
      ) : null}

      <section className="signal-path-stability" data-tone={stability.tone} aria-label={t('audioSignalPath.stability.title')}>
        <div className="signal-path-stability__header">
          <span>{t('audioSignalPath.stability.eyebrow')}</span>
          <strong>{stability.headline}</strong>
          <p>{stability.detail}</p>
        </div>
        <div className="signal-path-stability__grid">
          {stability.facts.map((fact) => (
            <article className="signal-path-stability__fact" data-tone={fact.tone} key={fact.label}>
              <span>{fact.label}</span>
              <strong title={fact.value}>{fact.value}</strong>
              <em title={fact.detail}>{fact.detail}</em>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
};
