import { useEffect, useRef, useState } from 'react';
import {
  Cpu,
  Database,
  ShieldCheck,
  SlidersHorizontal,
  Speaker,
  Waves,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioStatus } from '../../../shared/types/audio';
import type { ConnectSessionStatus } from '../../../shared/types/connect';
import type { HqPlayerRemotePlaybackStatus, HqPlayerStatus } from '../../../shared/types/hqplayer';
import type { LibraryTrack } from '../../../shared/types/library';
import { isHqPlayerConnectStatus } from '../../utils/connectPlayback';

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

type RoonSignalNode = {
  badge: string;
  title: string;
  value: string;
  icon?: LucideIcon;
  tone: SignalTone;
  variant?: 'circle' | 'process';
};

const signalPathPopoverExitMs = 170;
const unknown = '等待信号';

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

const formatEchoSrcPath = (status: AudioStatus | null, track?: LibraryTrack | null): string | null => {
  if (!status?.echoSrcActive) {
    return null;
  }

  const sourceRate = formatRoonRate(status.fileSampleRate ?? track?.sampleRate);
  const targetRate = formatRoonRate(
    status.echoSrcTargetSampleRate
    ?? status.decoderOutputSampleRate
    ?? status.requestedOutputSampleRate
    ?? status.actualDeviceSampleRate,
  );
  const engine = status.resamplerEngine === 'soxr' ? 'SOXR' : status.resamplerEngine ?? 'SRC';
  const quality = formatEchoSrcQualityProfile(status.echoSrcQualityProfile);

  if (sourceRate && targetRate) {
    return `${sourceRate} -> ${targetRate} / ${engine} ${quality}`;
  }

  return targetRate ? `${targetRate} / ${engine} ${quality}` : `${engine} ${quality}`;
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

const normalizeCodec = (value: string | null | undefined): string | null => {
  const codec = value?.trim();
  return codec ? codec.toUpperCase() : null;
};

const cleanReason = (value: string | null | undefined): string | null => value?.replaceAll('_', ' ') ?? null;

const joinSpec = (parts: Array<string | null | undefined>, fallback = unknown): string =>
  parts.filter((part): part is string => Boolean(part?.trim())).join(' / ') || fallback;

const formatUzumePath = (status: AudioStatus | null): string | null => {
  switch (status?.uzumeFormatPath) {
    case 'pcm_bitperfect':
      return 'PCM bit-perfect';
    case 'pcm_processed':
      return 'PCM processed / UZUME skeleton';
    case 'dsd_direct':
      return status.activeDsdOutputMode === 'native' ? 'DSD direct / Native' : 'DSD direct / DoP';
    case 'dsd_upsampling':
      return 'DSD upsampling / SDM-only';
    case 'd2p_processed':
      return 'DSD -> PCM processed';
    case 'sdm_processed':
      return 'SDM processed';
    default:
      if (status?.activeDsdOutputMode === 'native') {
        return 'DSD direct / Native';
      }
      if (status?.activeDsdOutputMode === 'dop') {
        return 'DSD direct / DoP';
      }
      return status?.dspActive ? 'PCM processed / UZUME skeleton' : null;
  }
};

const formatUzumeRuntimeDetail = (status: AudioStatus | null): string => {
  const parts = [
    status?.uzumeRuntimeModel ?? null,
    status?.uzumeProfile ?? null,
    status?.uzumeDirectDisabledReason ? cleanReason(status.uzumeDirectDisabledReason) : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length ? parts.join(' / ') : 'transitional compatibility chain';
};

const isHqPlayerSignalPath = (connectStatus: ConnectSessionStatus | null | undefined): connectStatus is ConnectSessionStatus =>
  isHqPlayerConnectStatus(connectStatus) && connectStatus.state !== 'idle' && connectStatus.state !== 'unsupported';

const hqPlayerStateLabel = (state: ConnectSessionStatus['state'] | HqPlayerRemotePlaybackStatus['state'] | null | undefined): string => {
  switch (state) {
    case 'connecting':
      return '连接中';
    case 'ready':
      return '已就绪';
    case 'playing':
      return '播放中';
    case 'paused':
      return '已暂停';
    case 'stopped':
    case 'stop-requested':
      return '已停止';
    case 'error':
      return '异常';
    default:
      return '外部处理';
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
): string => {
  const metadata = playbackStatus?.metadata ?? null;
  const codec = normalizeHqPlayerCodec(track, playbackStatus, connectStatus);
  const sampleRate = formatRoonRate(track?.sampleRate ?? metadata?.sampleRate);
  const bitDepth = formatRoonBitDepth(track?.bitDepth ?? metadata?.bits);
  const channels = metadata?.channels && Number.isFinite(metadata.channels) ? `${Math.round(metadata.channels)}ch` : null;

  return joinSpec([codec, sampleRate, bitDepth, channels], connectStatus.metadata ? 'PCM' : 'HQPlayer 输入').replaceAll(' / ', ' ');
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

const hqPlayerOutputLabel = (status: HqPlayerRemotePlaybackStatus | null): string => {
  const outputFormat = joinSpec([
    formatHqPlayerOutputRate(status?.activeRate),
    formatRoonBitDepth(status?.activeBits),
    status?.activeChannels && Number.isFinite(status.activeChannels) ? `${Math.round(status.activeChannels)}ch` : null,
  ], '');

  return outputFormat || '由 HQPlayer 决定';
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

const outputModeLabel = (mode: AudioStatus['outputMode'] | null | undefined): string => {
  if (mode === 'asio') {
    return 'ASIO';
  }
  if (mode === 'exclusive') {
    return '独占';
  }
  if (mode === 'system') {
    return '系统音频';
  }
  return '共享';
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
  if (/^asio$/iu.test(normalized)) {
    return 'ASIO';
  }
  if (/^system$/iu.test(normalized)) {
    return 'System Audio';
  }

  return normalized;
};

const sourceLabel = (status: AudioStatus | null, track: LibraryTrack | null): string => {
  const codec = normalizeCodec(track?.codec ?? status?.codec);
  const sampleRate = formatRate(track?.sampleRate ?? status?.fileSampleRate);
  const bitDepth = formatBitDepth(track?.bitDepth ?? status?.bitDepth);

  return joinSpec([codec, sampleRate, bitDepth], status ? '音频源' : unknown);
};

const roonSourceLabel = (status: AudioStatus | null, track: LibraryTrack | null): string => {
  const codec = normalizeCodec(track?.codec ?? status?.codec);
  const sampleRate = formatRoonRate(track?.sampleRate ?? status?.fileSampleRate);
  const bitDepth = formatRoonBitDepth(track?.bitDepth ?? status?.bitDepth);
  const channels = status?.channels && Number.isFinite(status.channels) ? `${Math.round(status.channels)}ch` : null;

  return joinSpec([codec, sampleRate, bitDepth, channels], status ? '音频源' : unknown).replaceAll(' / ', ' ');
};

const sourceCompactSpec = (status: AudioStatus | null, track: LibraryTrack | null): string => {
  const codec = normalizeCodec(track?.codec ?? status?.codec);
  const sampleRate = compactRate(track?.sampleRate ?? status?.fileSampleRate);
  const bitDepth = track?.bitDepth ?? status?.bitDepth;
  const bitDepthLabel = bitDepth && Number.isFinite(bitDepth) ? `${Math.round(bitDepth)}` : null;

  return joinSpec([codec, sampleRate, bitDepthLabel ? `${bitDepthLabel}b` : null], 'Signal');
};

const buildDspModules = (status: AudioStatus | null): string[] => {
  if (!status) {
    return [];
  }

  return [
    (status.uzumeHeadroomActive || status.dspActive) && Math.abs(status.dspHeadroomDb ?? 0) > 0.05
      ? `Headroom ${formatDb(status.dspHeadroomDb) ?? ''}`.trim()
      : null,
    status.eqEnabled ? status.eqPresetName ? `EQ ${status.eqPresetName}` : 'EQ' : null,
    status.echoSrcActive ? 'ECHO/SOXR SRC (compat)' : null,
    status.roomCorrectionEnabled ? 'FIR 房间校正 (compat)' : null,
    status.channelBalanceEnabled ? '声道平衡 (compat)' : null,
    status.replayGainEnabled ? `ReplayGain ${formatDb(status.replayGainAppliedDb) ?? ''}`.trim() : null,
    status.dspLimiterProtecting ? '安全限幅' : null,
  ].filter((module): module is string => Boolean(module));
};

export const buildAudioSignalPathNodes = (status: AudioStatus | null, track: LibraryTrack | null): SignalNode[] => {
  const dspModules = buildDspModules(status);
  const uzumePath = formatUzumePath(status);
  const outputRate = formatRate(status?.actualDeviceSampleRate ?? status?.requestedOutputSampleRate ?? status?.sharedDeviceSampleRate);
  const sourceTone: SignalTone = status ? 'good' : 'muted';
  const decodeTone: SignalTone = status?.resampling ? 'warning' : status ? 'good' : 'muted';
  const dspTone: SignalTone = status?.dspLimiterProtecting || status?.dspClippingRisk ? 'danger' : dspModules.length ? 'warning' : status ? 'good' : 'muted';
  const outputTone: SignalTone = status?.sampleRateMismatch || status?.error ? 'danger' : status ? 'good' : 'muted';

  return [
    {
      title: 'Source',
      value: sourceLabel(status, track),
      detail: joinSpec([
        formatChannels(status?.channels),
        formatBitrate(track?.bitrate ?? status?.bitrate),
        track?.mediaType === 'streaming' ? track.provider ?? '在线源' : track?.mediaType === 'remote' ? '远程媒体' : '本地媒体',
      ], status ? '源信息准备中' : unknown),
      icon: Database,
      tone: sourceTone,
    },
    {
      title: 'Decode',
      value: status?.activeDecodeBackendImpl ?? status?.outputBackend ?? '自动解码',
      detail: status?.resampling
        ? `重采样到 ${formatRate(status.decoderOutputSampleRate ?? status.requestedOutputSampleRate) ?? '输出采样率'}`
        : `保持 ${formatRate(status?.decoderOutputSampleRate ?? status?.fileSampleRate) ?? '原采样率'}`,
      icon: Cpu,
      tone: decodeTone,
    },
    {
      title: 'Process',
      value: dspModules.length ? dspModules.join(' + ') : uzumePath ?? '原生路径',
      detail: dspModules.length
        ? `${uzumePath ?? 'UZUME skeleton'} / ${formatUzumeRuntimeDetail(status)}`
        : `${uzumePath ?? 'PCM bit-perfect'} / ${formatUzumeRuntimeDetail(status)} / 未启用 UZUME section`,
      icon: dspModules.length ? SlidersHorizontal : ShieldCheck,
      tone: dspTone,
    },
    {
      title: 'Output',
      value: status?.outputDeviceName ?? '系统默认设备',
      detail: joinSpec([
        outputModeLabel(status?.outputMode),
        outputBackendLabel(status?.activeOutputBackendImpl ?? status?.outputBackend),
        outputRate,
      ], status ? outputModeLabel(status.outputMode) : unknown),
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

const getSignalSummary = (status: AudioStatus | null, track: LibraryTrack | null): SignalSummary => {
  const tone = summaryTone(status);
  const spec = sourceCompactSpec(status, track);
  const resamplePath = formatResamplePath(status, track);
  const uzumePath = formatUzumePath(status);

  if (!status) {
    return {
      label: '等待播放',
      detail: '播放后显示链路',
      spec,
      tone,
    };
  }
  if (status.error) {
    return {
      label: '链路异常',
      detail: cleanReason(status.error) ?? '需要检查输出',
      spec,
      tone,
    };
  }
  if (status.sampleRateMismatch) {
    return {
      label: '采样率不一致',
      detail: '源与设备不一致',
      spec,
      tone,
    };
  }
  if (status.dspLimiterProtecting) {
    return {
      label: '保护中',
      detail: '限幅保护输出',
      spec,
      tone,
    };
  }
  if (status.echoSrcActive) {
    return {
      label: '升频',
      detail: `${formatEchoSrcPath(status, track) ?? 'ECHO/SOXR SRC active'} / 兼容路径`,
      spec,
      tone,
    };
  }
  if (status.uzumeFormatPath === 'dsd_direct' || status.activeDsdOutputMode === 'dop' || status.activeDsdOutputMode === 'native') {
    return {
      label: 'DSD direct',
      detail: uzumePath ?? 'DSD direct',
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
      label: 'UZUME skeleton',
      detail: buildDspModules(status).slice(0, 2).join(' + ') || uzumePath || formatUzumeRuntimeDetail(status),
      spec,
      tone,
    };
  }
  if (status.resampling) {
    return {
      label: '重采样',
      detail: resamplePath ?? `到 ${formatRate(status.decoderOutputSampleRate ?? status.requestedOutputSampleRate) ?? '输出采样率'}`,
      spec,
      tone,
    };
  }
  if (status.bitPerfectCandidate) {
    return {
      label: '纯净候选',
      detail: `${outputModeLabel(status.outputMode)}输出`,
      spec,
      tone,
    };
  }

  return {
    label: '原生播放',
    detail: '未启用 UZUME',
    spec,
    tone,
  };
};

const getRoonPathLabel = (status: AudioStatus | null): string => {
  if (!status) {
    return '等待';
  }
  if (status.error || status.sampleRateMismatch) {
    return '异常';
  }
  if (status.dspLimiterProtecting || status.dspClippingRisk) {
    return '保护中';
  }
  if (status.uzumeFormatPath === 'dsd_direct' || status.activeDsdOutputMode === 'dop' || status.activeDsdOutputMode === 'native') {
    return 'DSD direct';
  }
  if (
    status.dspActive
    || status.eqEnabled
    || status.roomCorrectionEnabled
    || status.channelBalanceEnabled
    || status.replayGainEnabled
  ) {
    return 'UZUME skeleton';
  }
  if (status.resampling) {
    return '重采样';
  }
  return '无损';
};

const getDisplayRoonPathLabel = (status: AudioStatus | null): string =>
  status?.echoSrcActive ? '升频' : getRoonPathLabel(status);

const outputLabel = (status: AudioStatus | null): string => {
  if (!status) {
    return unknown;
  }
  if (status.outputMode === 'asio') {
    return 'ASIO 输出';
  }
  if (status.outputMode === 'exclusive') {
    return '独占输出';
  }
  if (status.outputMode === 'system') {
    return '系统输出';
  }
  return '共享输出';
};

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

const buildRoonProcessingNodes = (status: AudioStatus | null, track: LibraryTrack | null): RoonSignalNode[] => {
  if (!status) {
    return [];
  }

  const nodes: RoonSignalNode[] = [];
  const echoSrcPath = formatEchoSrcPath(status, track);
  const resamplePath = echoSrcPath ? null : formatResamplePath(status, track);

  if (echoSrcPath) {
    nodes.push({
      badge: '',
      title: 'ECHO/SOXR SRC (compat)',
      value: echoSrcPath,
      tone: 'process',
      variant: 'process',
    });
  }

  if (resamplePath) {
    nodes.push({
      badge: '',
      title: '重采样',
      value: resamplePath,
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.replayGainEnabled) {
    nodes.push({
      badge: '',
      title: '音量标准化',
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
      title: '声道处理',
      value: '声道平衡',
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.roomCorrectionEnabled) {
    nodes.push({
      badge: '',
      title: '房间校正',
      value: 'FIR / 声学处理',
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.eqEnabled) {
    nodes.push({
      badge: '',
      title: '参数化 EQ',
      value: '5 个频段',
      tone: 'process',
      variant: 'process',
    });
  }

  if (nodes.length || status.dspActive) {
    nodes.push({
      badge: '',
      title: '比特位深转换',
      value: `64bit Float 至 ${outputBitDepthLabel(status.nativeOutputFormat)}`,
      tone: 'process',
      variant: 'process',
    });
  }

  return nodes;
};

const buildRoonSignalPathNodes = (status: AudioStatus | null, track: LibraryTrack | null): RoonSignalNode[] => {
  const codec = normalizeCodec(track?.codec ?? status?.codec) ?? 'SRC';
  const processingNodes = buildRoonProcessingNodes(status, track);
  const transport = joinSpec([
    outputModeLabel(status?.outputMode),
    outputBackendLabel(status?.activeOutputBackendImpl ?? status?.outputBackend),
  ], status ? outputModeLabel(status.outputMode) : unknown);
  const outputDetail = joinSpec([
    outputLabel(status),
    formatRoonRate(status?.actualDeviceSampleRate ?? status?.sharedDeviceSampleRate ?? status?.requestedOutputSampleRate),
  ], outputLabel(status));

  return [
    {
      badge: codec.length > 4 ? codec.slice(0, 4) : codec,
      title: '数据源',
      value: roonSourceLabel(status, track),
      tone: status ? 'good' : 'muted',
    },
    ...processingNodes,
    {
      badge: '',
      title: status?.outputDeviceName ?? '播放设备',
      value: transport,
      icon: Waves,
      tone: status?.sampleRateMismatch || status?.error ? 'danger' : status ? 'good' : 'muted',
    },
    {
      badge: '',
      title: '输出',
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
): SignalSummary => {
  const playbackStatus = hqPlayerStatus?.playbackStatus ?? null;
  const tone = hqPlayerTone(connectStatus);
  const dsp = hqPlayerDspLabel(playbackStatus);
  const output = hqPlayerOutputLabel(playbackStatus);

  const detail = cleanReason(connectStatus.error)
    ?? (dsp
      ? `${output} / ${dsp}`
      : `${hqPlayerStateLabel(playbackStatus?.state ?? connectStatus.state)} / 外部处理链`);

  return {
    label: connectStatus.state === 'error' ? 'HQPlayer 异常' : 'HQPlayer',
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
): SignalSummary =>
  isHqPlayerSignalPath(connectStatus)
    ? getHqPlayerSignalSummary(connectStatus, track, hqPlayerStatus)
    : getSignalSummary(status, track);

const buildHqPlayerSignalPathNodes = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  hqPlayerStatus: HqPlayerStatus | null,
): RoonSignalNode[] => {
  const playbackStatus = hqPlayerStatus?.playbackStatus ?? null;
  const codec = normalizeHqPlayerCodec(track, playbackStatus, connectStatus) ?? 'HQ';
  const product = hqPlayerStatus?.controlInfo?.product?.trim() || 'HQPlayer Desktop';
  const dsp = hqPlayerDspLabel(playbackStatus);
  const playbackState = hqPlayerStateLabel(playbackStatus?.state ?? connectStatus.state);
  const output = hqPlayerOutputLabel(playbackStatus);
  const sourceTone: SignalTone = connectStatus.state === 'error' ? 'danger' : 'good';
  const processTone: SignalTone = connectStatus.state === 'error' ? 'danger' : 'process';

  return [
    {
      badge: codec.length > 4 ? codec.slice(0, 4) : codec,
      title: '数据源',
      value: hqPlayerSourceLabel(connectStatus, track, playbackStatus),
      tone: sourceTone,
    },
    {
      badge: '',
      title: product,
      value: dsp ?? `${playbackState} / 外部处理链`,
      icon: SlidersHorizontal,
      tone: processTone,
      variant: 'process',
    },
    {
      badge: '',
      title: '输出',
      value: output === '由 HQPlayer 决定' ? `${output} / 外部渲染` : `HQPlayer 输出 / ${output}`,
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
): RoonSignalNode[] =>
  isHqPlayerSignalPath(connectStatus)
    ? buildHqPlayerSignalPathNodes(connectStatus, track, hqPlayerStatus)
    : buildRoonSignalPathNodes(status, track);

const getDisplaySignalPathLabel = (status: AudioStatus | null, connectStatus: ConnectSessionStatus | null | undefined): string => {
  if (!isHqPlayerSignalPath(connectStatus)) {
    return getDisplayRoonPathLabel(status);
  }

  return connectStatus.state === 'error' ? 'HQPlayer 异常' : 'HQPlayer';
};

export const AudioSignalPathControl = ({
  isOpen,
  status,
  track,
  connectStatus,
  onClick,
}: AudioSignalPathControlProps): JSX.Element => {
  const summary = getResolvedSignalSummary(status, track, connectStatus, null);
  const label = `打开音频链路：${summary.label}，${summary.spec}`;

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
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [hqPlayerStatus, setHqPlayerStatus] = useState<HqPlayerStatus | null>(null);
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
  }, [hqPlayerSessionKey]);

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

  const nodes = buildResolvedSignalPathNodes(status, track, connectStatus, hqPlayerStatus);
  const summary = getResolvedSignalSummary(status, track, connectStatus, hqPlayerStatus);
  const pathLabel = getDisplaySignalPathLabel(status, connectStatus);

  return (
    <section
      className="signal-path-popover signal-path-popover--roon"
      role="dialog"
      aria-label="信号路径"
      data-state={isOpen ? 'open' : 'closing'}
      data-tone={summary.tone}
    >
      <header className="signal-path-roon-header">
        <div>
          <h3>信号路径: {pathLabel}</h3>
          <p>{summary.detail}</p>
        </div>
        <button className="signal-path-roon-menu" type="button" aria-label="关闭信号路径" title="关闭" onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      <div className="signal-path-roon-name" data-tone={summary.tone}>
        <span title={summary.spec}>{summary.spec}</span>
        <em>{nodes.length} 层链路</em>
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
                {Icon ? <Icon size={21} fill={node.title === '输出' ? 'currentColor' : 'none'} /> : node.badge}
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
    </section>
  );
};
