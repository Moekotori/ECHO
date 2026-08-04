import type { AudioStatus } from '../../../shared/types/audio';
import { isDisplayableBpmAnalysis } from '../../../shared/constants/audioAnalysis';
import type { LibraryTrack } from '../../../shared/types/library';
import { isHiResAudioSpec } from '../../../shared/utils/audioQuality';
import { formatAudioChannelLayout } from '../../../shared/utils/audioChannels';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';

type PlayerStatusChipsProps = {
  hqPlayerActiveRate?: number | null;
  showSecondarySpecs?: boolean;
  status: AudioStatus | null;
  state: string;
  track: LibraryTrack | null;
};

type Chip = {
  label: string;
  className: string;
  title?: string;
};

const formatSpecRate = (value: number | null | undefined): string | null => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  if (value < 1000) {
    return `${Math.round(value)}Hz`;
  }

  const khz = value / 1000;
  return `${Number.isInteger(khz) ? Math.round(khz) : khz.toFixed(1)}kHz`;
};

const trimFixed = (value: number, fractionDigits: number): string =>
  value.toFixed(fractionDigits).replace(/\.?0+$/u, '');

const formatHqPlayerOutputRate = (value: number | null | undefined): string | null => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  if (value >= 1_000_000) {
    return `${trimFixed(value / 1_000_000, 2)}MHz`;
  }

  return formatSpecRate(value);
};

const positiveRate = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

type RateLiftLabel = {
  label: string;
  title?: string;
};

const splitRateUnit = (label: string): { value: string; unit: string } | null => {
  const match = /^(.+?)(kHz|Hz)$/u.exec(label);
  return match ? { value: match[1], unit: match[2] } : null;
};

const formatCompactRateLiftLabel = (sourceRateLabel: string, outputRateLabel: string): string => {
  const source = splitRateUnit(sourceRateLabel);
  const output = splitRateUnit(outputRateLabel);

  if (source && output && source.unit === output.unit) {
    return `${source.value}->${output.value}${output.unit}`;
  }

  return `${sourceRateLabel}->${outputRateLabel}`;
};

const formatRateLiftLabel = (sourceRate: number | null, outputRate: number | null): RateLiftLabel | null => {
  if (!outputRate) {
    return null;
  }

  const outputRateLabel = formatSpecRate(outputRate);
  if (!outputRateLabel) {
    return null;
  }

  const sourceRateLabel = formatSpecRate(sourceRate);
  if (sourceRateLabel && sourceRate !== null && outputRate > sourceRate + 1) {
    return {
      label: formatCompactRateLiftLabel(sourceRateLabel, outputRateLabel),
      title: `${sourceRateLabel} to ${outputRateLabel}`,
    };
  }

  return { label: outputRateLabel };
};

const formatPlaybackRateLabel = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value - 1) < 0.005) {
    return null;
  }

  return `${trimFixed(value, 2)}x`;
};

const codecClassName = (codec: string): string => {
  if (codec === 'FLAC' || codec === 'ALAC' || codec === 'DSF' || codec === 'DFF') {
    return 'tag-flac';
  }

  return 'tag-lossless';
};

const sourceCodecLabels = new Set(['AIRPLAY', 'DLNA']);
const streamingProviderLabels: Record<string, string> = {
  netease: '网易云',
  qqmusic: 'QQ',
  spotify: 'Spotify',
  tidal: 'TIDAL',
  qobuz: 'Qobuz',
  bilibili: 'Bilibili',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  m3u8: 'M3U8',
  mock: 'Mock',
};

const normalizeDisplayCodec = (codec: string | null): string | null => {
  if (!codec) {
    return null;
  }

  const normalized = codec.trim().toUpperCase();
  return normalized && !sourceCodecLabels.has(normalized) ? normalized : null;
};

const streamingSourceLabel = (track: LibraryTrack | null): string | null => {
  if (track?.mediaType !== 'streaming') {
    return null;
  }

  const provider = track.provider?.trim();
  if (provider === 'kugou') {
    return null;
  }
  return provider ? (streamingProviderLabels[provider] ?? provider) : '在线';
};

const outputModeLabel = (status: AudioStatus | null): string | null => {
  switch (status?.outputMode) {
    case 'system':
      return 'System';
    case 'shared':
      return 'Shared';
    case 'exclusive':
      return 'Exclusive';
    default:
      return null;
  }
};

const uniqueChips = (chips: Chip[]): Chip[] => {
  const seen = new Set<string>();
  return chips.filter((chip) => {
    if (seen.has(chip.label)) {
      return false;
    }
    seen.add(chip.label);
    return true;
  });
};

const isHiResSource = ({
  bitDepth,
  codec,
  sampleRate,
  track,
}: {
  bitDepth: number | null;
  codec: string | null;
  sampleRate: number | null;
  track: LibraryTrack | null;
}): boolean =>
  isHiResAudioSpec({
    bitDepth,
    codec,
    sampleRate,
    streamingQuality: track?.streamingQuality,
  });

const isDlnaReceiverTrack = (track: LibraryTrack | null): boolean =>
  Boolean(
    track &&
      track.mediaType === 'remote' &&
      track.isTemporary &&
      (track.id.startsWith('dlna-receiver:') || track.fieldSources?.title === 'dlna'),
  );

const isAirPlayReceiverTrack = (track: LibraryTrack | null): boolean =>
  Boolean(
    track &&
      track.mediaType === 'remote' &&
      track.isTemporary &&
      (track.id.startsWith('airplay-receiver:') || track.fieldSources?.title === 'airplay'),
  );

const formatAutomixLabel = (status: AudioStatus | null): string | null => {
  const automix = status?.automix;
  if (!automix?.active) {
    return null;
  }
  if (
    automix.gapless ||
    automix.transitionMode === 'gaplessFallback' ||
    automix.engine === 'nativeGapless' ||
    automix.engine === 'ffmpegGapless'
  ) {
    return null;
  }

  const seconds = automix.overlapSeconds ?? automix.transitionSeconds;
  const secondsLabel = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0.1
    ? ` ${Math.round(seconds)}s`
    : '';
  const modeLabel = automix.beatAligned || automix.transitionMode === 'beatAligned'
    ? ' beat'
    : automix.fallbackReason
      ? ' fallback'
      : '';

  return `Automix${modeLabel}${secondsLabel}`;
};

const hasWindowsAudioRateWarning = (status: AudioStatus | null): boolean =>
  Boolean(status?.warnings?.some((warning) =>
    warning.startsWith('shared_output_mix_rate_too_high:') ||
    warning.startsWith('windows_audio_default_format_unusual:')));

export const PlayerStatusChips = ({
  hqPlayerActiveRate = null,
  showSecondarySpecs = true,
  status,
  state,
  track,
}: PlayerStatusChipsProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const codec = normalizeDisplayCodec(track?.codec ?? status?.codec ?? null);
  const bitDepth = track?.bitDepth ?? status?.bitDepth ?? null;
  const sampleRate = track?.sampleRate ?? status?.fileSampleRate ?? null;
  const bitrate = track?.bitrate ?? status?.bitrate ?? null;
  const channels = formatAudioChannelLayout(status?.channels);
  const playbackRate = status?.playbackRate ?? 1;
  const playbackRateLabel = formatPlaybackRateLabel(playbackRate);
  const bpm = isDisplayableBpmAnalysis(track?.bpm, track?.analysisStatus, track?.bpmConfidence) ? (track?.bpm ?? null) : null;
  const displayBpm = bpm ? Math.round(bpm * playbackRate) : null;
  const automixLabel = formatAutomixLabel(status);
  const windowsAudioRateWarning = hasWindowsAudioRateWarning(status);
  const isLoadingRemoteTrack = state === 'loading' && track?.mediaType === 'remote' && !isDlnaReceiverTrack(track) && !isAirPlayReceiverTrack(track);
  const streamingLabel = streamingSourceLabel(track);
  const outputMode = outputModeLabel(status);
  const hqPlayerRate = typeof hqPlayerActiveRate === 'number' && Number.isFinite(hqPlayerActiveRate) && hqPlayerActiveRate > 0
    ? hqPlayerActiveRate
    : null;
  const hqPlayerOutputRateLabel =
    hqPlayerRate && (!sampleRate || hqPlayerRate > sampleRate + 1) ? formatHqPlayerOutputRate(hqPlayerRate) : null;
  const echoSrcOutputRate = status?.echoSrcActive
    ? positiveRate(status.echoSrcTargetSampleRate)
      ?? positiveRate(status.actualDeviceSampleRate)
      ?? positiveRate(status.requestedOutputSampleRate)
      ?? positiveRate(status.decoderOutputSampleRate)
    : null;
  const echoSrcRateLiftVisible = Boolean(echoSrcOutputRate && (!sampleRate || echoSrcOutputRate > sampleRate + 1));
  const formattedRateLift = echoSrcRateLiftVisible
    ? formatRateLiftLabel(sampleRate, echoSrcOutputRate)
    : null;
  const formattedRate = formattedRateLift?.label ?? formatSpecRate(sampleRate);
  const formattedRateTitle = formattedRateLift?.title ?? formattedRate ?? undefined;
  const specRateClassName = echoSrcRateLiftVisible ? 'tag-depth tag-rate-lift-output' : 'tag-depth';
  const chips: Chip[] = uniqueChips([
    isLoadingRemoteTrack ? { label: '加载中', className: 'tag-loading' } : null,
    windowsAudioRateWarning
      ? { label: 'Windows Rate High', className: 'tag-warning' }
      : status?.sampleRateMismatch
        ? { label: 'Rate Mismatch', className: 'tag-warning' }
        : null,
    status?.roomCorrectionEnabled ? { label: 'FIR', className: 'tag-warning' } : null,
    status?.dspLimiterProtecting ? { label: 'Protect', className: 'tag-warning' } : null,
    !status?.dspLimiterProtecting && status?.dspClippingRisk ? { label: 'DSP Risk', className: 'tag-warning' } : null,
    status?.dspActive && Math.abs(status?.dspHeadroomDb ?? 0) > 0.05 ? { label: `Headroom ${status?.dspHeadroomDb?.toFixed(1)}dB`, className: 'tag-warning' } : null,
    status?.eqEnabled ? { label: 'EQ', className: 'tag-eq' } : null,
    status?.channelBalanceEnabled ? { label: 'Balance', className: 'tag-warning' } : null,
    automixLabel ? { label: automixLabel, className: 'tag-automix' } : null,
    isDlnaReceiverTrack(track) ? { label: 'DLNA', className: 'tag-dlna' } : null,
    isAirPlayReceiverTrack(track) ? { label: 'AIRPLAY', className: 'tag-airplay' } : null,
    streamingLabel ? { label: streamingLabel, className: 'tag-streaming' } : null,
    outputMode ? { label: outputMode, className: 'tag-output-mode' } : null,
    status?.bitPerfectCandidate ? { label: 'Bit-Perfect', className: 'tag-bit-perfect' } : null,
    hqPlayerOutputRateLabel ? { label: 'HQPlayer', className: 'tag-hqplayer' } : null,
    hqPlayerOutputRateLabel ? { label: hqPlayerOutputRateLabel, className: 'tag-hqplayer' } : null,
    playbackRateLabel ? { label: playbackRateLabel, className: 'tag-speed' } : null,
    codec ? { label: codec, className: codecClassName(codec) } : null,
    isHiResSource({ bitDepth, codec, sampleRate, track }) ? { label: 'Hi-Res', className: 'tag-hires' } : null,
    bitDepth && formattedRate
      ? {
          label: `${bitDepth}bit / ${formattedRate}`,
          className: specRateClassName,
          title: formattedRateTitle ? `${bitDepth}bit / ${formattedRateTitle}` : undefined,
        }
      : null,
    !bitDepth && formattedRate ? { label: formattedRate, className: specRateClassName, title: formattedRateTitle } : null,
    showSecondarySpecs && bitrate ? { label: `${Math.round(bitrate / 1000)}kbps`, className: 'tag-bitrate' } : null,
    displayBpm
      ? {
          label: playbackRate === 1 ? `${displayBpm} BPM` : `${Math.round(bpm!)} BPM -> ${displayBpm} BPM`,
          className: 'tag-bpm',
        }
      : null,
    showSecondarySpecs && channels ? { label: channels, className: 'tag-channel' } : null,
  ].filter((chip): chip is Chip => Boolean(chip)));

  if (chips.length === 0) {
    chips.push({ label: state === 'idle' ? t('playerStatus.ready') : state, className: state === 'error' ? 'tag-warning' : 'tag-depth' });
  }

  return (
    <div className="tag-row player-tags" aria-label={t('playerStatus.audioSpecifications')}>
      {chips.map((chip) => (
        <span className={`hifi-tag ${chip.className}`} key={chip.label} title={chip.title} aria-label={chip.title}>
          <span className="hifi-tag__label">{chip.label}</span>
        </span>
      ))}
    </div>
  );
};
