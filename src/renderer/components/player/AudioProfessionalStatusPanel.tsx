import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Gauge, RadioTower, SlidersHorizontal, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioStatus } from '../../../shared/types/audio';
import { useI18n } from '../../i18n/I18nProvider';

type AudioProfessionalStatusPanelProps = {
  status: AudioStatus | null;
  variant?: 'drawer' | 'settings';
};

type ProfessionalStatusRow = {
  label: string;
  value: string;
  tone?: 'good' | 'warning' | 'danger' | 'muted';
};

type ProfessionalStatusSection = {
  title: string;
  icon: LucideIcon;
  rows: ProfessionalStatusRow[];
};

type ProfessionalStatusBadge = {
  label: string;
  tone: 'good' | 'warning' | 'danger' | 'neutral';
};

type SignalPathNode = {
  eyebrow: string;
  label: string;
  tone: 'good' | 'warning' | 'danger' | 'muted';
};

const trimTrailingZero = (value: string): string => value.replace(/\.0$/u, '');

const normalizeReason = (value: string | null | undefined, fallback: string): string =>
  value ? value.replaceAll('_', ' ') : fallback;

const formatIssueReason = (
  value: string,
  fallback: string,
  formatSharedMixRateTooHigh: (decoderRate: number, deviceRate: number) => string,
  formatWindowsAudioDefaultFormatUnusual: (deviceRate: number) => string,
): string => {
  const sharedMixRateMatch = /^shared_output_mix_rate_too_high:(\d+)->(\d+)$/u.exec(value);
  const windowsAudioDefaultFormatMatch = /^windows_audio_default_format_unusual:(\d+)$/u.exec(value);

  if (sharedMixRateMatch) {
    return formatSharedMixRateTooHigh(Number(sharedMixRateMatch[1]), Number(sharedMixRateMatch[2]));
  }

  if (windowsAudioDefaultFormatMatch) {
    return formatWindowsAudioDefaultFormatUnusual(Number(windowsAudioDefaultFormatMatch[1]));
  }

  return normalizeReason(value, fallback);
};

const formatRate = (value: number | null | undefined, unknown: string): string => {
  if (!value || !Number.isFinite(value)) {
    return unknown;
  }

  if (value >= 1000) {
    return `${trimTrailingZero((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1))} kHz`;
  }

  return `${Math.round(value)} Hz`;
};

const formatBitDepth = (value: number | null | undefined, unknown: string): string =>
  value && Number.isFinite(value) ? `${Math.round(value)} bit` : unknown;

const formatBitrate = (value: number | null | undefined, unknown: string): string =>
  value && Number.isFinite(value) ? `${Math.round(value / 1000)} kbps` : unknown;

const formatChannels = (value: number | null | undefined, unknown: string): string =>
  value && Number.isFinite(value) ? `${Math.round(value)} ch` : unknown;

const formatFrames = (value: number | null | undefined, unknown: string): string =>
  value && Number.isFinite(value) ? `${Math.round(value)} frames` : unknown;

const formatMs = (value: number | null | undefined, unknown: string): string =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${Math.round(value)} ms` : unknown;

const formatDb = (value: number | null | undefined, unknown: string): string =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${value.toFixed(2)} dB` : unknown;

const joinedWarnings = (warnings: string[] | undefined, unknown: string): string =>
  warnings?.length ? warnings.join(', ') : unknown;

export const AudioProfessionalStatusPanel = ({ status, variant = 'drawer' }: AudioProfessionalStatusPanelProps): JSX.Element => {
  const { t } = useI18n();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const unknown = t('audioProfessional.value.unknown');
  const enabled = t('audioProfessional.value.enabled');
  const disabled = t('audioProfessional.value.disabled');
  const yes = t('audioProfessional.value.yes');
  const no = t('audioProfessional.value.no');

  const bitPerfectText = status?.bitPerfectCandidate
    ? t('audioProfessional.value.ready')
    : status?.bitPerfectDisabledReason
      ? normalizeReason(status.bitPerfectDisabledReason, unknown)
      : status?.outputMode === 'shared'
        ? t('audioProfessional.value.sharedMixer')
        : t('audioProfessional.value.pending');

  const playbackSummary = status
    ? `${status.outputMode} / ${formatRate(status.actualDeviceSampleRate ?? status.requestedOutputSampleRate, unknown)} / ${bitPerfectText}`
    : t('audioProfessional.summary.pending');
  const dspHeadroomActive = Boolean(status?.dspActive && Math.abs(status.dspHeadroomDb ?? 0) > 0.05);
  const dspModules = [
    dspHeadroomActive ? `${t('audioProfessional.signal.headroom')} ${formatDb(status?.dspHeadroomDb, unknown)}` : null,
    status?.eqEnabled ? t('audioProfessional.row.eq') : null,
    status?.roomCorrectionEnabled ? t('audioProfessional.signal.fir') : null,
    status?.channelBalanceEnabled ? t('audioProfessional.row.channelBalance') : null,
    status?.replayGainEnabled ? t('audioProfessional.row.replayGain') : null,
    status?.dspLimiterProtecting ? t('audioProfessional.badge.protect') : null,
  ].filter((module): module is string => Boolean(module));
  const signalPathText = status
    ? dspModules.length
      ? t('audioProfessional.value.dspPath', { modules: dspModules.join(' -> ') })
      : t('audioProfessional.value.nativePath')
    : unknown;
  const signalPathNodes: SignalPathNode[] = [
    {
      eyebrow: t('audioProfessional.signal.source'),
      label: status?.codec ?? formatRate(status?.fileSampleRate, unknown),
      tone: status ? 'good' : 'muted',
    },
    {
      eyebrow: t('audioProfessional.signal.decode'),
      label: status?.activeDecodeBackendImpl ?? status?.outputBackend ?? unknown,
      tone: status ? 'good' : 'muted',
    },
    {
      eyebrow: dspModules.length ? t('audioProfessional.signal.dsp') : t('audioProfessional.signal.native'),
      label: signalPathText,
      tone: status?.dspLimiterProtecting ? 'danger' : dspModules.length ? 'warning' : status ? 'good' : 'muted',
    },
    {
      eyebrow: t('audioProfessional.signal.output'),
      label: status?.outputDeviceName ?? status?.outputMode ?? t('audioProfessional.value.systemDefault'),
      tone: status?.sampleRateMismatch ? 'danger' : status ? 'good' : 'muted',
    },
  ];
  const protectLimiterText = status?.dspLimiterProtecting
    ? enabled
    : status?.dspClippingRisk
      ? t('audioProfessional.value.pending')
      : disabled;

  const issueReasons = useMemo(() => (
    [status?.error, ...(status?.warnings ?? [])]
      .filter((reason): reason is string => Boolean(reason?.trim()))
      .map((reason) => {
        if (reason === 'room_correction_bit_perfect_disabled') {
          return t('audioProfessional.issue.roomCorrectionBitPerfectDisabled');
        }

        if (reason === 'room_correction_clipping_risk') {
          return t('audioProfessional.issue.roomCorrectionClippingRisk');
        }

        if (reason === 'dsp_limiter_protecting') {
          return t('audioProfessional.issue.dspLimiterProtecting');
        }

        if (reason === 'dsp_clipping_risk') {
          return t('audioProfessional.issue.dspClippingRisk');
        }

        if (reason === 'audio_level_clipping_risk') {
          return t('audioProfessional.issue.audioLevelClippingRisk');
        }

        if (reason === 'audio_level_clipped') {
          return t('audioProfessional.issue.audioLevelClipped');
        }

        return formatIssueReason(
          reason,
          unknown,
          (decoderRate, deviceRate) => t('audioProfessional.issue.sharedMixRateTooHigh', {
            decoderRate: formatRate(decoderRate, unknown),
            deviceRate: formatRate(deviceRate, unknown),
          }),
          (deviceRate) => t('audioProfessional.issue.windowsDefaultFormatUnusual', {
            deviceRate: formatRate(deviceRate, unknown),
          }),
        );
      })
  ), [status, t, unknown]);

  const badges = useMemo<ProfessionalStatusBadge[]>(() => {
    const nextBadges: ProfessionalStatusBadge[] = [];

    if (status?.bitPerfectCandidate) {
      nextBadges.push({ label: t('audioProfessional.badge.bitPerfect'), tone: 'good' });
    }
    if (status?.resampling) {
      nextBadges.push({ label: t('audioProfessional.badge.resampling'), tone: 'warning' });
    }
    if (status?.dspActive || status?.eqEnabled || status?.roomCorrectionEnabled || status?.channelBalanceEnabled) {
      nextBadges.push({ label: t('audioProfessional.badge.dsp'), tone: 'warning' });
    }
    if (status?.dspLimiterProtecting) {
      nextBadges.push({ label: t('audioProfessional.badge.protect'), tone: 'warning' });
    }
    if (status?.replayGainEnabled) {
      nextBadges.push({ label: t('audioProfessional.badge.replayGain'), tone: 'neutral' });
    }
    if (status?.sampleRateMismatch) {
      nextBadges.push({ label: t('audioProfessional.badge.sampleMismatch'), tone: 'danger' });
    }
    if (issueReasons.length) {
      nextBadges.push({ label: t('audioProfessional.badge.warning'), tone: status?.error ? 'danger' : 'warning' });
    }

    return nextBadges;
  }, [issueReasons.length, status, t]);

  const sections = useMemo<ProfessionalStatusSection[]>(() => [
    {
      title: t('audioProfessional.group.playbackChain'),
      icon: Activity,
      rows: [
        { label: t('audioProfessional.row.state'), value: status?.state ?? unknown },
        { label: t('audioProfessional.row.outputMode'), value: status?.outputMode ?? unknown },
        { label: t('audioProfessional.row.outputDevice'), value: status?.outputDeviceName ?? t('audioProfessional.value.systemDefault') },
        { label: t('audioProfessional.row.outputBackend'), value: status?.outputBackend ?? status?.outputDeviceType ?? unknown },
        { label: t('audioProfessional.row.decodeBackend'), value: status?.activeDecodeBackendImpl ?? unknown },
        { label: t('audioProfessional.row.codec'), value: status?.codec ?? unknown },
        { label: t('audioProfessional.row.channels'), value: formatChannels(status?.channels, unknown) },
        { label: t('audioProfessional.row.bitDepth'), value: formatBitDepth(status?.bitDepth, unknown) },
        { label: t('audioProfessional.row.bitrate'), value: formatBitrate(status?.bitrate, unknown) },
      ],
    },
    {
      title: t('audioProfessional.group.sampleRate'),
      icon: RadioTower,
      rows: [
        { label: t('audioProfessional.row.fileSampleRate'), value: formatRate(status?.fileSampleRate, unknown) },
        { label: t('audioProfessional.row.decoderOutputSampleRate'), value: formatRate(status?.decoderOutputSampleRate, unknown) },
        { label: t('audioProfessional.row.requestedOutputSampleRate'), value: formatRate(status?.requestedOutputSampleRate, unknown) },
        { label: t('audioProfessional.row.actualDeviceSampleRate'), value: formatRate(status?.actualDeviceSampleRate, unknown) },
        { label: t('audioProfessional.row.sharedDeviceSampleRate'), value: formatRate(status?.sharedDeviceSampleRate, unknown) },
        { label: t('audioProfessional.row.resampler'), value: status?.resamplerEngine ?? 'default' },
        { label: t('audioProfessional.row.soxr'), value: status?.soxrAvailable ? yes : no },
      ],
    },
    {
      title: t('audioProfessional.group.directDsp'),
      icon: SlidersHorizontal,
      rows: [
        { label: t('audioProfessional.row.signalPath'), value: signalPathText, tone: dspModules.length ? 'warning' : 'good' },
        { label: t('audioProfessional.row.bitPerfect'), value: bitPerfectText, tone: status?.bitPerfectCandidate ? 'good' : 'muted' },
        { label: t('audioProfessional.row.resampling'), value: status?.resampling ? yes : no, tone: status?.resampling ? 'warning' : 'good' },
        { label: t('audioProfessional.row.sampleRateMismatch'), value: status?.sampleRateMismatch ? yes : no, tone: status?.sampleRateMismatch ? 'danger' : 'good' },
        { label: t('audioProfessional.row.eq'), value: status?.eqEnabled ? enabled : disabled, tone: status?.eqEnabled ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.roomCorrection'), value: status?.roomCorrectionEnabled ? enabled : disabled, tone: status?.roomCorrectionEnabled ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.channelBalance'), value: status?.channelBalanceEnabled ? enabled : disabled, tone: status?.channelBalanceEnabled ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.protectLimiter'), value: protectLimiterText, tone: status?.dspLimiterProtecting ? 'danger' : status?.dspClippingRisk ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.replayGain'), value: status?.replayGainEnabled ? `${status.replayGainMode ?? 'track'} / ${formatDb(status.replayGainAppliedDb, '0.00 dB')}` : disabled },
        { label: t('audioProfessional.row.clippingProtection'), value: status?.replayGainPreventedClipping || status?.clippingRisk ? enabled : disabled, tone: status?.clippingRisk ? 'danger' : 'muted' },
      ],
    },
    {
      title: t('audioProfessional.group.stability'),
      icon: Gauge,
      rows: [
        { label: t('audioProfessional.row.latencyProfile'), value: status?.latencyProfile ?? unknown },
        { label: t('audioProfessional.row.requestedBuffer'), value: formatFrames(status?.nativeRequestedBufferFrames, unknown) },
        { label: t('audioProfessional.row.actualBuffer'), value: formatFrames(status?.nativeActualBufferFrames, unknown) },
        { label: t('audioProfessional.row.deviceBuffer'), value: formatFrames(status?.nativeDeviceBufferFrames, unknown) },
        { label: t('audioProfessional.row.outputLatency'), value: formatMs(status?.nativeOutputLatencyMs, unknown) },
        { label: t('audioProfessional.row.buffered'), value: formatMs(status?.nativeBufferedMs, unknown) },
        { label: t('audioProfessional.row.underrun'), value: `${status?.nativeUnderrunCallbacks ?? 0} / ${status?.nativeUnderrunFrames ?? 0}` },
        { label: t('audioProfessional.row.sharedStability'), value: status?.sharedStabilityTier ?? unknown },
        { label: t('audioProfessional.row.warnings'), value: joinedWarnings(status?.warnings, unknown), tone: status?.warnings.length ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.error'), value: status?.error ?? unknown, tone: status?.error ? 'danger' : 'muted' },
      ],
    },
  ], [bitPerfectText, disabled, dspModules.length, enabled, no, protectLimiterText, signalPathText, status, t, unknown, yes]);

  const visibleSections = detailsOpen ? sections : [];
  const panelStateIcon = status?.error ? AlertTriangle : status?.bitPerfectCandidate ? CheckCircle2 : Zap;
  const PanelStateIcon = panelStateIcon;

  return (
    <section className={`audio-professional-status audio-professional-status--${variant}`} aria-label={t('audioProfessional.title')}>
      <header className="audio-professional-status__header">
        <span className="audio-professional-status__icon">
          <PanelStateIcon size={18} />
        </span>
        <div>
          <h3>{t('audioProfessional.title')}</h3>
          <p>{playbackSummary}</p>
        </div>
      </header>

      {badges.length ? (
        <div className="audio-professional-status__badges">
          {badges.map((badge) => (
            <em data-tone={badge.tone} key={`${badge.label}-${badge.tone}`}>{badge.label}</em>
          ))}
        </div>
      ) : null}

      <div className="audio-professional-status__signal" aria-label={t('audioProfessional.row.signalPath')}>
        {signalPathNodes.map((node, index) => (
          <span data-tone={node.tone} key={`${node.eyebrow}-${index}`}>
            <em>{node.eyebrow}</em>
            <strong title={node.label}>{node.label}</strong>
          </span>
        ))}
      </div>

      {issueReasons.length ? (
        <p className="audio-professional-status__issue" data-tone={status?.error ? 'danger' : 'warning'}>
          <strong>{t('audioProfessional.issue.reason')}</strong>
          <span>{issueReasons.join(' / ')}</span>
        </p>
      ) : null}

      {visibleSections.length ? (
        <div className="audio-professional-status__sections">
          {visibleSections.map((section) => {
            const SectionIcon = section.icon;

            return (
              <article className="audio-professional-status__section" key={section.title}>
                <h4>
                  <SectionIcon size={15} />
                  <span>{section.title}</span>
                </h4>
                <div className="audio-professional-status__grid">
                  {section.rows.map((row) => (
                    <span data-tone={row.tone} key={`${section.title}-${row.label}`}>
                      <em>{row.label}</em>
                      <strong title={row.value}>{row.value}</strong>
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <button className="audio-professional-status__toggle" type="button" onClick={() => setDetailsOpen((open) => !open)}>
        {detailsOpen ? t('audioProfessional.action.hideDetails') : t('audioProfessional.action.showDetails')}
      </button>
    </section>
  );
};
