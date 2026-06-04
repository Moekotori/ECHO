import type { AudioStatus } from '../../../shared/types/audio';
import { isDisplayableBpmAnalysis } from '../../../shared/constants/audioAnalysis';
import type { LibraryTrack } from '../../../shared/types/library';
import { isHiResAudioSpec } from '../../../shared/utils/audioQuality';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';

type PlayerStatusChipsProps = {
  status: AudioStatus | null;
  state: string;
  track: LibraryTrack | null;
};

type Chip = {
  label: string;
  className: string;
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

const channelLabel = (channels: number | null | undefined): string | null => {
  if (!channels || !Number.isFinite(channels)) {
    return null;
  }

  if (channels === 1) {
    return 'Mono';
  }

  if (channels === 2) {
    return 'Stereo';
  }

  return `${channels}ch`;
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
  return provider ? (streamingProviderLabels[provider] ?? provider) : '在线';
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

export const PlayerStatusChips = ({ status, state, track }: PlayerStatusChipsProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const codec = normalizeDisplayCodec(track?.codec ?? status?.codec ?? null);
  const bitDepth = track?.bitDepth ?? status?.bitDepth ?? null;
  const sampleRate = track?.sampleRate ?? status?.fileSampleRate ?? null;
  const bitrate = track?.bitrate ?? status?.bitrate ?? null;
  const channels = channelLabel(status?.channels);
  const formattedRate = formatSpecRate(sampleRate);
  const playbackRate = status?.playbackRate ?? 1;
  const bpm = isDisplayableBpmAnalysis(track?.bpm, track?.analysisStatus) ? (track?.bpm ?? null) : null;
  const displayBpm = bpm ? Math.round(bpm * playbackRate) : null;
  const automixLabel = formatAutomixLabel(status);
  const windowsAudioRateWarning = hasWindowsAudioRateWarning(status);
  const isLoadingRemoteTrack = state === 'loading' && track?.mediaType === 'remote' && !isDlnaReceiverTrack(track) && !isAirPlayReceiverTrack(track);
  const streamingLabel = streamingSourceLabel(track);
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
    status?.eqEnabled ? { label: 'EQ', className: 'tag-warning' } : null,
    status?.channelBalanceEnabled ? { label: 'Balance', className: 'tag-warning' } : null,
    automixLabel ? { label: automixLabel, className: 'tag-automix' } : null,
    isDlnaReceiverTrack(track) ? { label: 'DLNA', className: 'tag-dlna' } : null,
    isAirPlayReceiverTrack(track) ? { label: 'AIRPLAY', className: 'tag-airplay' } : null,
    streamingLabel ? { label: streamingLabel, className: 'tag-streaming' } : null,
    codec ? { label: codec, className: codecClassName(codec) } : null,
    isHiResSource({ bitDepth, codec, sampleRate, track }) ? { label: 'Hi-Res', className: 'tag-hires' } : null,
    bitDepth && formattedRate ? { label: `${bitDepth}bit / ${formattedRate}`, className: 'tag-depth' } : null,
    !bitDepth && formattedRate ? { label: formattedRate, className: 'tag-depth' } : null,
    bitrate ? { label: `${Math.round(bitrate / 1000)}kbps`, className: 'tag-bitrate' } : null,
    displayBpm
      ? {
          label: playbackRate === 1 ? `${displayBpm} BPM` : `${Math.round(bpm!)} BPM -> ${displayBpm} BPM`,
          className: 'tag-bpm',
        }
      : null,
    channels ? { label: channels, className: 'tag-channel' } : null,
  ].filter((chip): chip is Chip => Boolean(chip)));

  if (chips.length === 0) {
    chips.push({ label: state === 'idle' ? t('playerStatus.ready') : state, className: state === 'error' ? 'tag-warning' : 'tag-depth' });
  }

  return (
    <div className="tag-row player-tags" aria-label={t('playerStatus.audioSpecifications')}>
      {chips.map((chip) => (
        <span className={`hifi-tag ${chip.className}`} key={chip.label}>
          {chip.label}
        </span>
      ))}
    </div>
  );
};
