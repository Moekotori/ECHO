import {
  Cpu,
  Database,
  MoreVertical,
  ShieldCheck,
  SlidersHorizontal,
  Speaker,
  Waves,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioStatus } from '../../../shared/types/audio';
import type { LibraryTrack } from '../../../shared/types/library';

type AudioSignalPathPopoverProps = {
  isOpen: boolean;
  status: AudioStatus | null;
  track: LibraryTrack | null;
  onClose: () => void;
  onOpenAudioSettings?: () => void;
};

type AudioSignalPathControlProps = {
  isOpen: boolean;
  status: AudioStatus | null;
  track: LibraryTrack | null;
  onClick: () => void;
};

type SignalTone = 'good' | 'warning' | 'danger' | 'muted';

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

const unknown = '等待信号';

const trimTrailingZero = (value: string): string => value.replace(/\.0$/u, '');

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

const formatResamplePath = (status: AudioStatus | null, track?: LibraryTrack | null): string | null => {
  if (!status?.resampling) {
    return null;
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
    status.dspActive && Math.abs(status.dspHeadroomDb ?? 0) > 0.05
      ? `Headroom ${formatDb(status.dspHeadroomDb) ?? ''}`.trim()
      : null,
    status.eqEnabled ? status.eqPresetName ? `EQ ${status.eqPresetName}` : 'EQ' : null,
    status.roomCorrectionEnabled ? 'FIR 房间校正' : null,
    status.channelBalanceEnabled ? '声道平衡' : null,
    status.replayGainEnabled ? `ReplayGain ${formatDb(status.replayGainAppliedDb) ?? ''}`.trim() : null,
    status.dspLimiterProtecting ? '安全限幅' : null,
  ].filter((module): module is string => Boolean(module));
};

export const buildAudioSignalPathNodes = (status: AudioStatus | null, track: LibraryTrack | null): SignalNode[] => {
  const dspModules = buildDspModules(status);
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
      value: dspModules.length ? dspModules.join(' + ') : '原生路径',
      detail: dspModules.length ? '经过 ECHO 处理链' : '未启用 EQ / FIR / 声道处理',
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
  if (status.dspLimiterProtecting || status.dspClippingRisk || status.resampling) {
    return 'warning';
  }
  return 'good';
};

const getSignalSummary = (status: AudioStatus | null, track: LibraryTrack | null): SignalSummary => {
  const tone = summaryTone(status);
  const spec = sourceCompactSpec(status, track);
  const resamplePath = formatResamplePath(status, track);

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
  if (
    status.dspActive
    || status.eqEnabled
    || status.roomCorrectionEnabled
    || status.channelBalanceEnabled
    || status.replayGainEnabled
  ) {
    return {
      label: '已强化',
      detail: buildDspModules(status).slice(0, 2).join(' + ') || 'DSP active',
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
    detail: '未启用 DSP',
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
  if (
    status.dspActive
    || status.eqEnabled
    || status.roomCorrectionEnabled
    || status.channelBalanceEnabled
    || status.replayGainEnabled
  ) {
    return '已强化';
  }
  if (status.resampling) {
    return '重采样';
  }
  return '无损';
};

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
  const resamplePath = formatResamplePath(status, track);

  if (resamplePath) {
    nodes.push({
      badge: '',
      title: '重采样',
      value: resamplePath,
      tone: 'warning',
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
      tone: 'warning',
      variant: 'process',
    });
  }

  if (status.channelBalanceEnabled) {
    nodes.push({
      badge: '',
      title: '声道处理',
      value: '声道平衡',
      tone: 'warning',
      variant: 'process',
    });
  }

  if (status.roomCorrectionEnabled) {
    nodes.push({
      badge: '',
      title: '房间校正',
      value: 'FIR / 声学处理',
      tone: 'warning',
      variant: 'process',
    });
  }

  if (status.eqEnabled) {
    nodes.push({
      badge: '',
      title: '参数化 EQ',
      value: '5 个频段',
      tone: 'warning',
      variant: 'process',
    });
  }

  if (nodes.length || status.dspActive) {
    nodes.push({
      badge: '',
      title: '比特位深转换',
      value: `64bit Float 至 ${outputBitDepthLabel(status.nativeOutputFormat)}`,
      tone: 'warning',
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

export const AudioSignalPathControl = ({
  isOpen,
  status,
  track,
  onClick,
}: AudioSignalPathControlProps): JSX.Element => {
  const summary = getSignalSummary(status, track);
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
  onClose,
}: AudioSignalPathPopoverProps): JSX.Element | null => {
  if (!isOpen) {
    return null;
  }

  const nodes = buildRoonSignalPathNodes(status, track);
  const summary = getSignalSummary(status, track);
  const pathLabel = getRoonPathLabel(status);

  return (
    <section className="signal-path-popover signal-path-popover--roon" role="dialog" aria-label="信号路径" data-tone={summary.tone}>
      <header className="signal-path-roon-header">
        <div>
          <h3>信号路径: {pathLabel}</h3>
          <p>点击路径任意一层了解更多</p>
        </div>
        <button className="signal-path-roon-menu" type="button" aria-label="关闭信号路径" title="关闭" onClick={onClose}>
          <MoreVertical size={22} />
        </button>
      </header>

      <div className="signal-path-roon-name">
        <span>未命名</span>
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
