import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  AudioLines,
  Cable,
  Check,
  ChevronDown,
  Clipboard,
  EyeOff,
  FlaskConical,
  Gauge,
  Headphones,
  Layers,
  Lock,
  Monitor,
  Music2,
  RefreshCw,
  Route,
  ShieldAlert,
  SlidersHorizontal,
  Usb,
  Volume2,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioDeviceInfo, AudioLatencyProfile, AudioOutputMode, AudioOutputSettings, AudioSharedBackend, AudioStatus } from '../../../shared/types/audio';
import { hqPlayerConnectDeviceId } from '../../../shared/types/connect';
import type { LibraryTrack } from '../../../shared/types/library';
import {
  detectRendererPlatform,
  isAdvancedNativeOutputPlatform,
  normalizeAudioSharedBackendForPlatform,
} from '../../../shared/utils/audioPlatformCapabilities';
import { formatAudioChannelLayout } from '../../../shared/utils/audioChannels';
import { detectAsioCompatibilityProfile } from '../../../shared/utils/asioCompatibility';
import { isHiResAudioSpec } from '../../../shared/utils/audioQuality';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { createOutputSettings, normalizeSharedBackend, readRememberedAudioOutput, resolveSupportedLatencyProfile, writeRememberedAudioOutput } from './audioOutputMemory';
import { AudioProfessionalStatusPanel } from './AudioProfessionalStatusPanel';
import { formatAudioDiagnostics } from './audioDiagnosticsFormat';

type AudioSettingsDrawerProps = {
  isOpen: boolean;
  status: AudioStatus | null;
  hqPlayerTakeoverEnabled?: boolean;
  hqPlayerTrack?: LibraryTrack | null;
  onClose: () => void;
  onActivateHqPlayerTakeover?: () => Promise<void> | void;
  onHqPlayerTakeoverEnabledChange?: (enabled: boolean) => void;
  onStatusChange: (status: AudioStatus) => void;
};

type HiddenDeviceMenu = {
  device: AudioDeviceInfo;
  x: number;
  y: number;
} | null;

type AudioDrawerCopy = {
  asioDriver: string;
  balanceDsp: string;
  bitPerfect: string;
  bitPerfectReady: string;
  close: string;
  copyDiagnostics: string;
  copiedDiagnostics: string;
  desktopBridgeUnavailable: string;
  dspActive: string;
  dspOn: string;
  eqOff: string;
  eqOn: string;
  exclusive: string;
  juceDecode: string;
  juceDecodeFallback: string;
  juceDecodeStandby: string;
  juceOutput: string;
  nativeRate: string;
  noActiveSource: string;
  noTrack: string;
  pending: string;
  processed: string;
  ratePending: string;
  resampling: string;
  upsampling: string;
  soxrResampler: string;
  shared: string;
  directSound: string;
  dsdDop: string;
  dsdDopFallback: string;
  dsdDopStandby: string;
  ffmpegDecode: string;
  sharedMixer: string;
  asioSdkOutput: string;
  juceFallback: string;
  speedUp: string;
  standardPath: string;
  systemAudio: string;
  systemAudioDescription: string;
  systemDefaultOutput: string;
};

const hiddenDeviceStorageKey = 'echo-next.hidden-audio-devices';
const showAsioPanelSettingsStorageKey = 'echo-next.show-asio-panel-settings';
const advancedOutputOpenStorageKey = 'echo-next.audio-advanced-output-open';
const audioEngineMeterOpenStorageKey = 'echo-next.audio-engine-meter-open';
const drawerExitAnimationMs = 320;
const outputApplyTimeoutMs = 20_000;
const lowLatencyMaxBufferSizeFrames = 2048;
const highOutputSampleRateWarningThresholdHz = 192000;
const latencyProfileOptionDefinitions: Array<{ id: AudioLatencyProfile; labelKey: TranslationKey; detailKey: TranslationKey }> = [
  { id: 'lowLatency', labelKey: 'audioDrawer.latency.lowLatency', detailKey: 'audioDrawer.latency.lowLatencyDetail' },
  { id: 'balanced', labelKey: 'audioDrawer.latency.balanced', detailKey: 'audioDrawer.latency.balancedDetail' },
  { id: 'stable', labelKey: 'audioDrawer.latency.stable', detailKey: 'audioDrawer.latency.stableDetail' },
];
const asioBufferOptionDefinitions: Array<{ value: number | null; label?: string; labelKey?: TranslationKey; detailKey: TranslationKey }> = [
  { value: null, labelKey: 'audioDrawer.buffer.auto', detailKey: 'audioDrawer.buffer.profileDefault' },
  { value: 64, label: '64', detailKey: 'audioDrawer.buffer.ultraLow' },
  { value: 128, label: '128', detailKey: 'audioDrawer.buffer.low' },
  { value: 256, label: '256', detailKey: 'audioDrawer.buffer.safer' },
  { value: 512, label: '512', detailKey: 'audioDrawer.buffer.default' },
  { value: 1024, label: '1024', detailKey: 'audioDrawer.buffer.stable' },
];

const detectAudioDrawerPlatform = (): NodeJS.Platform | 'unknown' =>
  typeof window !== 'undefined' ? detectRendererPlatform(window.navigator) : 'unknown';

const getSystemAudioPlatformLabel = (platform: NodeJS.Platform | 'unknown'): string => {
  if (platform === 'win32') {
    return 'WASAPI';
  }
  if (platform === 'linux') {
    return 'Linux';
  }
  if (platform === 'darwin') {
    return 'macOS';
  }
  return 'System';
};

const getSharedBackendOptionsForPlatform = (
  platform: NodeJS.Platform | 'unknown',
): Array<{ id: AudioSharedBackend; labelKey: TranslationKey; detailKey: TranslationKey }> => {
  if (platform === 'linux') {
    return [
      { id: 'auto', labelKey: 'audioDrawer.option.linuxAutoShared', detailKey: 'audioDrawer.option.linuxAutoSharedDescription' },
      { id: 'alsa', labelKey: 'audioDrawer.option.alsaShared', detailKey: 'audioDrawer.option.alsaSharedDescription' },
    ];
  }

  if (platform === 'win32') {
    return [
      { id: 'auto', labelKey: 'audioDrawer.option.wasapiShared', detailKey: 'audioDrawer.option.wasapiSharedDescription' },
      { id: 'directsound', labelKey: 'audioDrawer.option.directSound', detailKey: 'audioDrawer.option.directSoundDescription' },
    ];
  }

  return [];
};

const sanitizeOutputBufferSizeFrames = (
  outputMode: AudioOutputMode,
  latencyProfile: AudioLatencyProfile,
  bufferSizeFrames: number | null | undefined,
): number | undefined => {
  const numeric = Number(bufferSizeFrames);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  const rounded = Math.round(numeric);
  if (latencyProfile !== 'lowLatency' || rounded <= lowLatencyMaxBufferSizeFrames) {
    return rounded;
  }

  return outputMode === 'shared' ? undefined : lowLatencyMaxBufferSizeFrames;
};

const getDeviceStorageKey = (device: AudioDeviceInfo): string => `${device.outputMode}:${device.id || device.index}:${device.name}`;

const normalizeAsioOutputChannelStart = (value: unknown): number | undefined => {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined;
};

const readHiddenDeviceKeys = (): string[] => {
  try {
    const raw = window.localStorage.getItem(hiddenDeviceStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};

const writeHiddenDeviceKeys = (keys: string[]): void => {
  try {
    const nextKeys = Array.from(new Set(keys));
    window.localStorage.setItem(hiddenDeviceStorageKey, JSON.stringify(nextKeys));
    void window.echo?.app.setSettings({ hiddenAudioDeviceKeys: nextKeys }).catch(() => undefined);
  } catch {
    // UI preference only; failure should never block audio settings.
  }
};

const loadPersistedHiddenDeviceKeys = async (): Promise<string[]> => {
  const localKeys = readHiddenDeviceKeys();
  const appBridge = window.echo?.app;

  if (!appBridge) {
    return localKeys;
  }

  const settings = await appBridge.getSettings();
  const keys = (settings.appMemoryVersion ?? 0) < 1 && localKeys.length > 0 ? localKeys : (settings.hiddenAudioDeviceKeys ?? []);
  window.localStorage.setItem(hiddenDeviceStorageKey, JSON.stringify(keys));

  if ((settings.appMemoryVersion ?? 0) < 1 && localKeys.length > 0) {
    void appBridge.setSettings({ hiddenAudioDeviceKeys: keys }).catch(() => undefined);
  }

  return keys;
};

const formatRate = (value: number | null | undefined): string => {
  if (!value) {
    return '';
  }

  return value >= 1000 ? `${Math.round(value / 1000)} kHz` : `${value} Hz`;
};

const isHighOutputSampleRate = (value: number | null | undefined): boolean =>
  Number.isFinite(value) && Number(value) >= highOutputSampleRateWarningThresholdHz;

const formatBitrate = (value: number | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  return `${Math.round(value / 1000)} kbps`;
};

const formatMode = (mode: AudioOutputMode | null | undefined, copy: AudioDrawerCopy): string => {
  if (mode === 'asio') {
    return 'ASIO';
  }

  if (mode === 'exclusive') {
    return copy.exclusive;
  }

  if (mode === 'system') {
    return copy.systemAudio;
  }

  return copy.shared;
};

const formatWasapiDeviceMode = (exclusive: boolean): string => (exclusive ? 'WASAPI Exclusive' : 'WASAPI Shared');

const shouldHighlightCurrentOutput = (mode: AudioOutputMode | null | undefined, backend: string | null | undefined): boolean =>
  mode === 'asio' || mode === 'exclusive' || backend === 'asio' || backend === 'wasapi-exclusive';

const formatCodecLine = (status: AudioStatus | null, copy: AudioDrawerCopy): string => {
  const bitrate = formatBitrate(status?.bitrate);
  const codec = status?.codec?.toUpperCase() ?? copy.noTrack;

  return [codec, bitrate].filter(Boolean).join(' / ');
};

const formatHqPlayerTrackLine = (track: LibraryTrack | null, fallback: string): string => {
  if (!track) {
    return fallback;
  }

  const bitrate = formatBitrate(track.bitrate);
  const codec = track.codec?.toUpperCase() ?? null;
  const quality = [codec, bitrate].filter(Boolean).join(' / ');
  return quality || track.title || fallback;
};

const formatHqPlayerTrackTitle = (track: LibraryTrack | null): string => {
  if (!track) {
    return '等待 HQPlayer 曲目';
  }

  return [track.title, track.artist].filter(Boolean).join(' - ') || track.id;
};

const isHiResAudio = (status: AudioStatus | null): boolean =>
  status?.outputMode !== 'shared' &&
  status?.outputMode !== 'system' &&
  isHiResAudioSpec({
    bitDepth: status?.bitDepth,
    codec: status?.codec,
    sampleRate: status?.fileSampleRate,
  });

const isLosslessCodec = (status: AudioStatus | null): boolean => {
  const codec = status?.codec?.toLocaleLowerCase();

  return Boolean(codec && ['flac', 'wav', 'wave', 'alac', 'aiff', 'ape'].some((losslessCodec) => codec.includes(losslessCodec)));
};

const readAdvancedOutputOpen = (): boolean => {
  try {
    return window.localStorage.getItem(advancedOutputOpenStorageKey) === 'true';
  } catch {
    return false;
  }
};

const writeAdvancedOutputOpen = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(advancedOutputOpenStorageKey, enabled ? 'true' : 'false');
  } catch {
    // UI preference only; failure should never block audio settings.
  }
};

const readAudioEngineMeterOpen = (): boolean => {
  try {
    return window.localStorage.getItem(audioEngineMeterOpenStorageKey) !== 'false';
  } catch {
    return true;
  }
};

const writeAudioEngineMeterOpen = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(audioEngineMeterOpenStorageKey, enabled ? 'true' : 'false');
  } catch {
    // UI preference only; failure should never block audio settings.
  }
};

const isActiveJuceBackend = (status: AudioStatus | null): boolean =>
  typeof status?.activeOutputBackendImpl === 'string' && status.activeOutputBackendImpl.startsWith('juce-');

const isActiveJuceDecodeBackend = (status: AudioStatus | null): boolean =>
  typeof status?.activeDecodeBackendImpl === 'string' && status.activeDecodeBackendImpl.startsWith('juce-');

const isJuceDecodeFallbackVisible = (status: AudioStatus | null): boolean =>
  Boolean(
    status?.useJuceDecodeRequested &&
      !isActiveJuceDecodeBackend(status) &&
      status.activeDecodeBackendImpl === 'ffmpeg' &&
      status.warnings.some((warning) => warning === 'juce_decode_fell_back_to_ffmpeg'),
  );

const isJuceDecodeStandbyVisible = (status: AudioStatus | null): boolean =>
  Boolean(
    status?.useJuceDecodeRequested &&
      !isActiveJuceDecodeBackend(status) &&
      status.activeDecodeBackendImpl === 'ffmpeg' &&
      !isJuceDecodeFallbackVisible(status),
  );

const hasJuceFallbackWarning = (status: AudioStatus | null): boolean =>
  Boolean(status?.warnings.some((warning) => warning.startsWith('juce_') && warning.includes('fell_back')));

const isJuceFallbackVisible = (status: AudioStatus | null): boolean =>
  Boolean(
    status?.useJuceOutputRequested &&
      !isActiveJuceBackend(status) &&
      status.outputMode !== 'asio' &&
      (status.state !== 'idle' || hasJuceFallbackWarning(status)),
  );

const isActiveDsdDop = (status: AudioStatus | null): boolean => status?.activeDsdOutputMode === 'dop';

const isDsdDopFallbackVisible = (status: AudioStatus | null): boolean =>
  Boolean(
    status?.dsdOutputModeRequested === 'dop' &&
      status.activeDsdOutputMode !== 'dop' &&
      status.warnings.some((warning) => warning.startsWith('dsd_dop_fell_back_to_pcm')),
  );

const isDsdDopStandbyVisible = (status: AudioStatus | null): boolean =>
  Boolean(
    status?.dsdOutputModeRequested === 'dop' &&
      status.activeDsdOutputMode !== 'dop' &&
      !isDsdDopFallbackVisible(status) &&
      (status.codec?.toLowerCase().includes('dsd') || status.currentFilePath?.toLowerCase().endsWith('.dff')),
  );

const getPlaybackChainText = (status: AudioStatus | null, copy: AudioDrawerCopy): string => {
  if (isActiveDsdDop(status)) {
    const outputText = status?.outputMode === 'asio' ? copy.asioSdkOutput : copy.exclusive;
    return `${copy.dsdDop} -> ${outputText}`;
  }

  const decodeText = isActiveJuceDecodeBackend(status)
    ? copy.juceDecode
    : isDsdDopFallbackVisible(status)
      ? copy.dsdDopFallback
      : isDsdDopStandbyVisible(status)
        ? `${copy.ffmpegDecode} (${copy.dsdDopStandby})`
        : isJuceDecodeFallbackVisible(status)
          ? copy.juceDecodeFallback
          : isJuceDecodeStandbyVisible(status)
            ? `${copy.ffmpegDecode} (${copy.juceDecodeStandby})`
            : copy.ffmpegDecode;

  if (status?.outputMode === 'system') {
    return copy.systemAudio;
  }

  if (isActiveJuceBackend(status)) {
    return `${decodeText} -> ${copy.juceOutput}`;
  }

  if (status?.outputMode === 'asio') {
    return `${decodeText} -> ${copy.asioSdkOutput}`;
  }

  if (isJuceFallbackVisible(status)) {
    return `${decodeText} -> ${copy.juceFallback}`;
  }

  if (status?.useJuceOutputRequested) {
    return `${decodeText} -> ${copy.juceOutput}`;
  }

  if (status?.outputBackend === 'directsound-shared' || status?.sharedBackend === 'directsound') {
    return `${decodeText} -> ${copy.directSound}`;
  }

  return `${decodeText} -> ${copy.standardPath}`;
};

const formatSourceQuality = (status: AudioStatus | null, copy: AudioDrawerCopy): string => {
  const parts = [
    status?.codec?.toUpperCase() ?? null,
    status?.bitDepth ? `${status.bitDepth} bit` : null,
    formatRate(status?.fileSampleRate) || null,
    formatAudioChannelLayout(status?.channels),
  ].filter(Boolean);

  return parts.length ? parts.join(' / ') : copy.noActiveSource;
};

const getOutputSampleRate = (status: AudioStatus | null, deviceSampleRate?: number | null): number | null => {
  if (status?.outputMode === 'shared') {
    return deviceSampleRate ?? status.sharedDeviceSampleRate ?? status.actualDeviceSampleRate ?? status.requestedOutputSampleRate ?? null;
  }

  return status?.actualDeviceSampleRate ?? status?.requestedOutputSampleRate ?? status?.sharedDeviceSampleRate ?? null;
};

const isActiveDsdBitstream = (status: AudioStatus | null): boolean =>
  status?.activeDsdOutputMode === 'dop' || status?.activeDsdOutputMode === 'native';

const hasInferredRateMismatch = (status: AudioStatus | null, deviceSampleRate?: number | null): boolean => {
  if (isActiveDsdBitstream(status)) {
    return false;
  }

  const fileSampleRate = status?.fileSampleRate ?? null;
  const outputSampleRate = getOutputSampleRate(status, deviceSampleRate);

  return Boolean(fileSampleRate && outputSampleRate && fileSampleRate !== outputSampleRate);
};

const formatRatePath = (status: AudioStatus | null, deviceSampleRate: number | null | undefined, copy: AudioDrawerCopy): string => {
  if (status?.activeDsdOutputMode === 'dop') {
    const sourceRate = formatRate(status.dsdNativeSampleRate ?? status.fileSampleRate);
    const transportRate = formatRate(status.dsdTransportSampleRate ?? getOutputSampleRate(status, deviceSampleRate));

    if (sourceRate && transportRate) {
      return `${sourceRate} -> DoP ${transportRate}`;
    }
  }

  const sourceRate = formatRate(status?.fileSampleRate);
  const outputRate = formatRate(getOutputSampleRate(status, deviceSampleRate));

  if (sourceRate && outputRate && sourceRate !== outputRate) {
    return `${sourceRate} -> ${outputRate}`;
  }

  return outputRate || sourceRate || copy.ratePending;
};

const getEqSignalText = (status: AudioStatus | null, copy: AudioDrawerCopy): string => {
  if (status?.eqEnabled) {
    return status.eqPresetName ? `${copy.eqOn} / ${status.eqPresetName}` : copy.eqOn;
  }

  if (status?.channelBalanceEnabled) {
    return copy.balanceDsp;
  }

  if (status?.dspActive) {
    return copy.dspOn;
  }

  return copy.eqOff;
};

const getResampleSignalText = (status: AudioStatus | null, deviceSampleRate: number | null | undefined, copy: AudioDrawerCopy): string => {
  const resamplerSuffix = status?.resamplerEngine === 'soxr' && status.resamplerFallbackActive !== true ? ` / ${copy.soxrResampler}` : '';
  if (status?.outputMode === 'system') {
    return copy.systemAudio;
  }

  if (status?.activeDsdOutputMode === 'dop') {
    return formatRatePath(status, deviceSampleRate, copy);
  }

  if (status?.activeDsdOutputMode === 'native') {
    return copy.nativeRate;
  }

  if (status?.resampling || status?.sampleRateMismatch || hasInferredRateMismatch(status, deviceSampleRate)) {
    return `${formatRatePath(status, deviceSampleRate, copy)}${resamplerSuffix}`;
  }

  if (status?.outputMode === 'shared') {
    return copy.sharedMixer;
  }

  return copy.nativeRate;
};

const getResamplingBadgeLabel = (status: AudioStatus | null, copy: AudioDrawerCopy): string =>
  status?.echoSrcActive ? copy.upsampling : copy.resampling;

const getDirectSignalText = (status: AudioStatus | null, deviceSampleRate: number | null | undefined, copy: AudioDrawerCopy): string => {
  if (status?.outputMode === 'system') {
    return copy.systemAudio;
  }

  if (status?.outputMode === 'shared') {
    return copy.sharedMixer;
  }

  if (status?.bitPerfectCandidate) {
    return copy.bitPerfect;
  }

  if (status?.bitPerfectDisabledReason) {
    if (status.bitPerfectDisabledReason === 'echo_src_enabled') {
      return 'ECHO SRC';
    }

    return status.bitPerfectDisabledReason.replaceAll('_', ' ');
  }

  if (
    status?.resampling ||
    status?.sampleRateMismatch ||
    hasInferredRateMismatch(status, deviceSampleRate) ||
    status?.dspActive ||
    status?.eqEnabled ||
    status?.channelBalanceEnabled
  ) {
    return copy.processed;
  }

  return copy.pending;
};

const getSharedStabilityText = (status: AudioStatus | null, unknownValue: string): string => {
  if (status?.outputMode !== 'shared') {
    return 'n/a';
  }

  const tier = status.sharedStabilityTier ?? unknownValue;
  const buffered = status.nativeBufferedMs !== null && status.nativeBufferedMs !== undefined ? `${status.nativeBufferedMs} ms` : unknownValue;
  const recovery = status.lastSharedStabilityRecoveryAt ? 'recovered' : 'auto';
  return `${tier} / ${buffered} / ${recovery}`;
};

const getNativeLatencyText = (status: AudioStatus | null, unknownValue: string): string => {
  const profile = status?.latencyProfile ?? 'lowLatency';
  const requested = status?.nativeRequestedBufferFrames ?? status?.nativeDeviceBufferFrames ?? null;
  const opened = status?.nativeActualBufferFrames ?? null;
  const latency = status?.nativeOutputLatencyMs !== null && status?.nativeOutputLatencyMs !== undefined
    ? `${status.nativeOutputLatencyMs} ms`
    : unknownValue;
  const stale = status?.nativePositionStalenessMs !== null && status?.nativePositionStalenessMs !== undefined
    ? `stale ${status.nativePositionStalenessMs} ms`
    : `stale ${unknownValue}`;
  const bufferText = requested || opened
    ? `req ${requested ?? unknownValue} / open ${opened ?? unknownValue}`
    : `buffer ${unknownValue}`;

  return `${profile} / ${bufferText} / ${latency} / ${stale}`;
};

const getRecommendedLatencyMs = (status: AudioStatus | null): number | null => {
  if (status?.nativeOutputLatencyMs !== null && status?.nativeOutputLatencyMs !== undefined) {
    return status.nativeOutputLatencyMs;
  }

  const frames = status?.nativeActualBufferFrames ?? status?.nativeRequestedBufferFrames ?? status?.nativeDeviceBufferFrames ?? null;
  const sampleRate = getOutputSampleRate(status, null);

  if (!frames || !sampleRate) {
    return null;
  }

  return Math.round((frames / sampleRate) * 1000);
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
  }
};

const readShowAsioPanelSettings = (): boolean => {
  try {
    return window.localStorage.getItem(showAsioPanelSettingsStorageKey) === 'true';
  } catch {
    return false;
  }
};

const writeShowAsioPanelSettings = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(showAsioPanelSettingsStorageKey, enabled ? 'true' : 'false');
  } catch {
    // UI preference only; failure should never block audio settings.
  }
};

const getFramesLatencyMs = (frames: number | null | undefined, status: AudioStatus | null): number | null => {
  const sampleRate = getOutputSampleRate(status, null);

  if (!frames || !sampleRate) {
    return null;
  }

  return Math.round((frames / sampleRate) * 1000);
};

const formatFramesWithLatency = (frames: number | null | undefined, status: AudioStatus | null, fallback: string): string => {
  if (!frames) {
    return fallback;
  }

  const latencyMs = getFramesLatencyMs(frames, status);
  return latencyMs === null ? String(frames) : `${frames} (~${latencyMs} ms)`;
};

const deviceMatchesStatus = (device: AudioDeviceInfo, status: AudioStatus | null, mode: AudioOutputMode): boolean => {
  if (!status || status.outputMode !== mode) {
    return false;
  }

  const identityMatches = status.outputDeviceId === device.id || status.outputDeviceName === device.name;
  if (!identityMatches || mode !== 'asio') {
    return identityMatches;
  }

  const deviceChannelStart = normalizeAsioOutputChannelStart(device.asioOutputChannelStart) ?? 0;
  const statusChannelStart = normalizeAsioOutputChannelStart(status.asioOutputChannelStart) ?? 0;
  return deviceChannelStart === statusChannelStart;
};

const shouldShowAsioAdvancedRoutes = (device: AudioDeviceInfo): boolean =>
  device.outputMode === 'asio' && (
    detectAsioCompatibilityProfile(device.name) === 'asio4all' ||
    (device.asioOutputChannels ?? 0) > 2
  );

const formatAsioChannelPair = (start: number): string => `${start + 1}/${start + 2}`;

const formatAsioChannelRoute = (device: AudioDeviceInfo | null | undefined, start: number): string => {
  const pair = formatAsioChannelPair(start);
  const firstName = device?.asioChannelNames?.[start]?.trim();
  const secondName = device?.asioChannelNames?.[start + 1]?.trim();

  if (firstName && secondName) {
    return `${pair} - ${firstName} / ${secondName}`;
  }

  return `Output ${pair}`;
};

const formatAsioOutputCount = (
  device: AudioDeviceInfo,
): string | null => {
  const outputChannels = device.asioOutputChannels;
  return outputChannels && Number.isFinite(outputChannels) && outputChannels > 0
    ? `${Math.round(outputChannels)} outputs`
    : null;
};

const createAsioRouteDevice = (device: AudioDeviceInfo, start: number): AudioDeviceInfo => ({
  ...device,
  id: `${device.id}:asio-route:${start}`,
  asioOutputChannelStart: start,
});

const getDeviceIcon = (deviceName: string, outputMode: AudioOutputMode | AudioDeviceInfo['outputMode']): LucideIcon => {
  const name = deviceName.toLocaleLowerCase();

  if (outputMode === 'asio' || name.includes('asio')) {
    return Zap;
  }

  if (name.includes('default') || name.includes('system')) {
    return Waves;
  }

  if (name.includes('hdmi') || name.includes('monitor') || name.includes('display')) {
    return Monitor;
  }

  if (name.includes('headphone') || name.includes('headset') || name.includes('earphone') || name.includes('earbud')) {
    return Headphones;
  }

  if (name.includes('speaker') || name.includes('realtek')) {
    return Volume2;
  }

  if (
    name.includes('usb') ||
    name.includes('dac') ||
    name.includes('digital') ||
    name.includes('teac') ||
    name.includes('topping') ||
    name.includes('fiio')
  ) {
    return name.includes('usb') ? Usb : AudioLines;
  }

  if (name.includes('virtual') || name.includes('voicemeeter') || name.includes('motiv mix')) {
    return name.includes('virtual') ? Route : Layers;
  }

  return Music2;
};

const getCurrentOutputName = (status: AudioStatus | null, fallbackDeviceName: string | null | undefined, copy: AudioDrawerCopy): string =>
  status?.outputDeviceName || fallbackDeviceName || copy.systemDefaultOutput;

const getCurrentBackend = (status: AudioStatus | null, copy: AudioDrawerCopy): string => status?.outputBackend || status?.outputDeviceType || copy.systemAudio;

export const AudioSettingsDrawer = ({
  isOpen,
  status,
  hqPlayerTakeoverEnabled = false,
  hqPlayerTrack = null,
  onClose,
  onActivateHqPlayerTakeover,
  onHqPlayerTakeoverEnabledChange = () => undefined,
  onStatusChange,
}: AudioSettingsDrawerProps): JSX.Element | null => {
  const { t } = useI18n();
  const copy = useMemo<AudioDrawerCopy>(
    () => ({
      asioDriver: t('audioDrawer.device.asioDriver'),
      balanceDsp: t('audioDrawer.signal.balanceDsp'),
      bitPerfect: t('audioDrawer.signal.bitPerfect'),
      bitPerfectReady: t('audioDrawer.badge.bitPerfectReady'),
      close: t('audioDrawer.action.close'),
      copyDiagnostics: t('audioDrawer.action.copyDiagnostics'),
      copiedDiagnostics: t('audioDrawer.action.copiedDiagnostics'),
      desktopBridgeUnavailable: t('audioDrawer.error.desktopBridgeUnavailable'),
      dspActive: t('audioDrawer.badge.dspActive'),
      dspOn: t('audioDrawer.signal.dspOn'),
      eqOff: t('audioDrawer.signal.eqOff'),
      eqOn: t('audioDrawer.signal.eqOn'),
      exclusive: t('audioDrawer.mode.exclusive'),
      ffmpegDecode: t('audioDrawer.signal.ffmpegDecode'),
      juceDecode: t('audioDrawer.signal.juceDecode'),
      juceDecodeFallback: t('audioDrawer.signal.juceDecodeFallback'),
      juceDecodeStandby: t('audioDrawer.signal.juceDecodeStandby'),
      juceOutput: t('audioDrawer.badge.juceOutput'),
      juceFallback: t('audioDrawer.badge.juceFallback'),
      asioSdkOutput: t('audioDrawer.signal.asioSdkOutput'),
      nativeRate: t('audioDrawer.signal.nativeRate'),
      noActiveSource: t('audioDrawer.signal.noActiveSource'),
      noTrack: t('audioDrawer.status.noTrack'),
      pending: t('audioDrawer.signal.pending'),
      processed: t('audioDrawer.signal.processed'),
      ratePending: t('audioDrawer.status.ratePending'),
      resampling: t('audioDrawer.badge.resampling'),
      upsampling: t('audioDrawer.badge.upsampling'),
      soxrResampler: t('audioDrawer.badge.soxrResampler'),
      shared: t('audioDrawer.mode.shared'),
      directSound: t('audioDrawer.mode.directSound'),
      dsdDop: t('audioDrawer.signal.dsdDop'),
      dsdDopFallback: t('audioDrawer.signal.dsdDopFallback'),
      dsdDopStandby: t('audioDrawer.signal.dsdDopStandby'),
      sharedMixer: t('audioDrawer.signal.sharedMixer'),
      speedUp: t('audioDrawer.badge.speedUp'),
      standardPath: t('audioDrawer.signal.standardPath'),
      systemAudio: t('audioDrawer.device.systemAudio'),
      systemAudioDescription: t('audioDrawer.device.systemAudioDescription'),
      systemDefaultOutput: t('audioDrawer.device.systemDefaultOutput'),
    }),
    [t],
  );
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputMode, setOutputMode] = useState<AudioOutputMode>(status?.outputMode ?? 'shared');
  const [sharedBackend, setSharedBackend] = useState<AudioSharedBackend>(() => readRememberedAudioOutput().sharedBackend ?? 'auto');
  const [rememberOutput, setRememberOutput] = useState(() => readRememberedAudioOutput().enabled);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isMotionOpen, setIsMotionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [hqPlayerTakeoverBusy, setHqPlayerTakeoverBusy] = useState(false);
  const [useJuceOutput, setUseJuceOutput] = useState(status?.useJuceOutputRequested === true);
  const [useJuceDecode, setUseJuceDecode] = useState(status?.useJuceDecodeRequested === true);
  const [useDsdDop, setUseDsdDop] = useState(status?.dsdOutputModeRequested === 'dop');
  const [asioNativeDsdExperimentalEnabled, setAsioNativeDsdExperimentalEnabled] = useState(false);
  const [dsdAutoVolumeLockEnabled, setDsdAutoVolumeLockEnabled] = useState(false);
  const [asioUnavailableFallbackEnabled, setAsioUnavailableFallbackEnabled] = useState(false);
  const [exclusiveInstabilityFallbackEnabled, setExclusiveInstabilityFallbackEnabled] = useState(false);
  const [soxrFallbackEnabled, setSoxrFallbackEnabled] = useState(true);
  const [releaseExclusiveOnPauseExperimentalEnabled, setReleaseExclusiveOnPauseExperimentalEnabled] = useState(false);
  const [fixedVolumeEnabled, setFixedVolumeEnabled] = useState(false);
  const [lowLoadPlaybackModeEnabled, setLowLoadPlaybackModeEnabled] = useState(false);
  const [lowLoadPlaybackEnhancementsEnabled, setLowLoadPlaybackEnhancementsEnabled] = useState(false);
  const [hiddenDeviceKeys, setHiddenDeviceKeys] = useState<string[]>(() => readHiddenDeviceKeys());
  const [hiddenDeviceMenu, setHiddenDeviceMenu] = useState<HiddenDeviceMenu>(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [forceRestartBusy, setForceRestartBusy] = useState(false);
  const [windowsAudioRestartBusy, setWindowsAudioRestartBusy] = useState(false);
  const [troubleshootingMessage, setTroubleshootingMessage] = useState<string | null>(null);
  const [isAudioEngineMeterOpen, setIsAudioEngineMeterOpen] = useState(() => readAudioEngineMeterOpen());
  const [isAdvancedOutputOpen, setIsAdvancedOutputOpen] = useState(() => readAdvancedOutputOpen());
  const [isBufferOptionsOpen, setIsBufferOptionsOpen] = useState(false);
  const [showAsioPanelSettings, setShowAsioPanelSettings] = useState(() => readShowAsioPanelSettings());
  const rendererPlatform = useMemo(() => detectAudioDrawerPlatform(), []);

  const hiddenDeviceKeySet = useMemo(() => new Set(hiddenDeviceKeys), [hiddenDeviceKeys]);
  const visibleDevices = useMemo(
    () => devices.filter((device) => !hiddenDeviceKeySet.has(getDeviceStorageKey(device))),
    [devices, hiddenDeviceKeySet],
  );
  const hiddenDevices = useMemo(
    () => devices.filter((device) => hiddenDeviceKeySet.has(getDeviceStorageKey(device))),
    [devices, hiddenDeviceKeySet],
  );
  const allSharedDevices = useMemo(() => devices.filter((device) => device.outputMode === 'shared'), [devices]);
  const defaultSharedDevice = useMemo(() => allSharedDevices.find((device) => device.isDefault) ?? null, [allSharedDevices]);
  const sharedDevices = useMemo(() => visibleDevices.filter((device) => device.outputMode === 'shared'), [visibleDevices]);
  const asioDevices = useMemo(() => visibleDevices.filter((device) => device.outputMode === 'asio'), [visibleDevices]);
  const advancedNativeOutputAvailable = useMemo(() => isAdvancedNativeOutputPlatform(rendererPlatform), [rendererPlatform]);
  const sharedBackendOptions = useMemo(() => getSharedBackendOptionsForPlatform(rendererPlatform), [rendererPlatform]);
  const windowsAudioServiceRestartAvailable = rendererPlatform === 'win32';
  const systemAudioPlatformLabel = useMemo(() => getSystemAudioPlatformLabel(rendererPlatform), [rendererPlatform]);
  const wasapiExclusive = outputMode === 'exclusive';
  const systemAudioActive = !hqPlayerTakeoverEnabled && (
    rendererPlatform === 'win32'
      ? outputMode === 'shared' && status?.outputMode !== 'system' && !status?.outputDeviceName && sharedBackend !== 'directsound'
      : outputMode === 'system' || status?.outputMode === 'system'
  );
  const lockWasapiExclusive = !advancedNativeOutputAvailable || outputMode === 'asio' || outputMode === 'system';
  const statusDevice = useMemo(() => {
    if (!status) {
      return null;
    }

    if (status.outputMode === 'system') {
      return null;
    }

    return devices.find((device) => {
      const modeMatches = status.outputMode === 'asio' ? device.outputMode === 'asio' : device.outputMode === 'shared';
      return modeMatches && (status.outputDeviceId === device.id || status.outputDeviceName === device.name);
    }) ?? null;
  }, [devices, status]);
  const effectiveSharedSampleRate = status?.outputMode === 'shared' ? statusDevice?.sharedDeviceSampleRate ?? statusDevice?.sampleRate ?? null : null;

  const engineBadges = useMemo(() => {
    const badges: Array<{ label: string; tone: 'ready' | 'warning' | 'neutral' | 'gold' }> = [];
    if (hqPlayerTakeoverEnabled) {
      badges.push({ label: 'HQPlayer', tone: 'ready' });
    }

    const hasEq = status?.dspActive || status?.eqEnabled || status?.warnings.some((warning) => /eq|equalizer/i.test(warning));

    if (hasEq) {
      badges.push({ label: copy.dspActive, tone: 'neutral' });
    }

    if (isHiResAudio(status)) {
      badges.push({ label: 'Hi-Res', tone: 'gold' });
    } else if (isLosslessCodec(status)) {
      badges.push({ label: 'Lossless', tone: 'gold' });
    }

    if ((status?.playbackRate ?? 1) > 1.0001) {
      badges.push({ label: copy.speedUp, tone: 'warning' });
    }

    if (status?.bitPerfectCandidate) {
      badges.push({ label: copy.bitPerfectReady, tone: 'ready' });
    }

    if (status?.resampling || status?.sampleRateMismatch) {
      badges.push({ label: getResamplingBadgeLabel(status, copy), tone: 'warning' });
    }

    if (status?.resamplerEngine === 'soxr' && status.resamplerFallbackActive !== true) {
      badges.push({ label: copy.soxrResampler, tone: 'ready' });
    }

    if (isActiveDsdDop(status)) {
      badges.push({ label: copy.dsdDop, tone: 'ready' });
    } else if (isDsdDopFallbackVisible(status)) {
      badges.push({ label: copy.dsdDopFallback, tone: 'warning' });
    } else if (isDsdDopStandbyVisible(status)) {
      badges.push({ label: copy.dsdDopStandby, tone: 'neutral' });
    }

    if (isActiveJuceDecodeBackend(status)) {
      badges.push({ label: copy.juceDecode, tone: 'ready' });
    } else if (isJuceDecodeFallbackVisible(status)) {
      badges.push({ label: copy.juceDecodeFallback, tone: 'warning' });
    } else if (isJuceDecodeStandbyVisible(status)) {
      badges.push({ label: copy.juceDecodeStandby, tone: 'neutral' });
    }

    if (status?.outputBackend === 'directsound-shared' || status?.sharedBackend === 'directsound') {
      badges.push({ label: copy.directSound, tone: 'warning' });
    }

    if (isActiveJuceBackend(status)) {
      badges.push({ label: copy.juceOutput, tone: 'ready' });
    } else if (isJuceFallbackVisible(status)) {
      badges.push({ label: copy.juceFallback, tone: 'warning' });
    }

    const rateBadgeLabel = getResamplingBadgeLabel(status, copy);
    if (hasInferredRateMismatch(status, effectiveSharedSampleRate) && !badges.some((badge) => badge.label === rateBadgeLabel)) {
      badges.push({ label: rateBadgeLabel, tone: 'warning' });
    }

    return badges;
  }, [copy, effectiveSharedSampleRate, hqPlayerTakeoverEnabled, status]);

  const engineSignalDetails = useMemo(
    () => hqPlayerTakeoverEnabled
      ? [
          { label: t('audioDrawer.meter.source'), value: formatHqPlayerTrackTitle(hqPlayerTrack) },
          { label: t('audioDrawer.meter.chain'), value: 'ECHO Connect -> HQPlayer' },
          { label: 'EQ', value: '由 HQPlayer 处理' },
          { label: t('audioDrawer.meter.resample'), value: '由 HQPlayer 决定' },
          { label: t('audioDrawer.meter.direct'), value: '外部渲染器' },
          { label: t('audioDrawer.meter.latency'), value: 'HQPlayer buffer' },
          { label: t('settings.playback.stability.field.sharedStabilityTier'), value: 'ECHO 本机输出已释放' },
        ]
      : [
          { label: t('audioDrawer.meter.source'), value: formatSourceQuality(status, copy) },
          { label: t('audioDrawer.meter.chain'), value: getPlaybackChainText(status, copy) },
          { label: 'EQ', value: getEqSignalText(status, copy) },
          { label: status?.activeDsdOutputMode === 'dop' ? 'DoP' : status?.echoSrcActive ? t('audioDrawer.meter.upsample') : t('audioDrawer.meter.resample'), value: getResampleSignalText(status, effectiveSharedSampleRate, copy) },
          { label: t('audioDrawer.meter.direct'), value: getDirectSignalText(status, effectiveSharedSampleRate, copy) },
          { label: t('audioDrawer.meter.latency'), value: getNativeLatencyText(status, t('settings.playback.stability.value.unknown')) },
          { label: t('settings.playback.stability.field.sharedStabilityTier'), value: getSharedStabilityText(status, t('settings.playback.stability.value.unknown')) },
        ],
    [copy, effectiveSharedSampleRate, hqPlayerTakeoverEnabled, hqPlayerTrack, status, t],
  );
  const engineRatePath = useMemo(
    () => hqPlayerTakeoverEnabled
      ? [formatRate(hqPlayerTrack?.sampleRate), 'HQPlayer'].filter(Boolean).join(' -> ') || '由 HQPlayer 决定'
      : formatRatePath(status, effectiveSharedSampleRate, copy),
    [copy, effectiveSharedSampleRate, hqPlayerTakeoverEnabled, hqPlayerTrack?.sampleRate, status],
  );
  const currentOutputName = useMemo(
    () => hqPlayerTakeoverEnabled ? 'HQPlayer' : getCurrentOutputName(status, statusDevice?.name ?? defaultSharedDevice?.name, copy),
    [copy, defaultSharedDevice?.name, hqPlayerTakeoverEnabled, status, statusDevice?.name],
  );
  const currentOutputMode = status?.outputMode ?? outputMode;
  const currentOutputSampleRate = hqPlayerTakeoverEnabled
    ? hqPlayerTrack?.sampleRate ?? null
    : getOutputSampleRate(status, effectiveSharedSampleRate);
  const showHighOutputSampleRateWarning =
    !hqPlayerTakeoverEnabled &&
    (currentOutputMode === 'shared' || currentOutputMode === 'system') &&
    isHighOutputSampleRate(currentOutputSampleRate);
  const currentAsioRoute = useMemo(() => {
    if (hqPlayerTakeoverEnabled || status?.outputMode !== 'asio') {
      return null;
    }

    const start = normalizeAsioOutputChannelStart(status.asioOutputChannelStart) ?? 0;
    return formatAsioChannelRoute(statusDevice, start);
  }, [hqPlayerTakeoverEnabled, status?.asioOutputChannelStart, status?.outputMode, statusDevice]);

  const currentOutput = useMemo(() => {
    const currentMode = currentOutputMode;
    const name = currentOutputName;

    if (hqPlayerTakeoverEnabled) {
      return {
        name,
        mode: currentMode,
        modeLabel: '外部渲染器',
        backend: 'HQPlayer Connect',
        asioRoute: null,
        sampleRate: formatRate(hqPlayerTrack?.sampleRate),
        bitPerfect: '由 HQPlayer 负责输出',
        highlight: true,
        Icon: Cable,
      };
    }

    return {
      name,
      mode: currentMode,
      modeLabel: formatMode(currentMode, copy),
      backend: getCurrentBackend(status, copy),
      asioRoute: currentAsioRoute,
      sampleRate: formatRate(currentOutputSampleRate),
      bitPerfect: status?.bitPerfectCandidate
        ? copy.bitPerfectReady
        : status?.bitPerfectDisabledReason === 'echo_src_enabled'
          ? 'ECHO SRC'
          : status?.bitPerfectDisabledReason ?? copy.standardPath,
      highlight: shouldHighlightCurrentOutput(currentMode, status?.outputBackend),
      Icon: getDeviceIcon(name, currentMode),
    };
  }, [copy, currentAsioRoute, currentOutputMode, currentOutputName, currentOutputSampleRate, hqPlayerTakeoverEnabled, hqPlayerTrack?.sampleRate, status]);
  const currentLatencyProfile = status?.latencyProfile ?? readRememberedAudioOutput().latencyProfile ?? 'lowLatency';
  const supportedLatencyProfile = resolveSupportedLatencyProfile(outputMode, currentLatencyProfile);
  const currentAsioBufferFrames =
    status?.outputMode === 'asio'
      ? status.nativeRequestedBufferFrames ?? null
      : readRememberedAudioOutput().bufferSizeFrames ?? null;
  const recommendedLatencyMs = getRecommendedLatencyMs(status);
  const optionActiveLabel = t('audioDrawer.option.active');
  const optionSetLabel = t('audioDrawer.option.set');
  const autoBufferLabel = t('audioDrawer.buffer.auto');
  const unknownValue = t('settings.playback.stability.value.unknown');
  const recommendedLatencyText = recommendedLatencyMs !== null
    ? t('audioDrawer.asioLatency.value', { value: recommendedLatencyMs })
    : unknownValue;
  const asioBufferStatusText = t('audioDrawer.asioLatency.status', {
    requested: formatFramesWithLatency(status?.nativeRequestedBufferFrames, status, autoBufferLabel),
    opened: formatFramesWithLatency(status?.nativeActualBufferFrames, status, unknownValue),
  });
  const latencyProfileOptions = useMemo(
    () => latencyProfileOptionDefinitions.map((option) => ({
      id: option.id,
      label: t(option.labelKey),
      detail: t(option.detailKey),
    })),
    [t],
  );
  const asioBufferOptions = useMemo(
    () => asioBufferOptionDefinitions.map((option) => ({
      value: option.value,
      label: option.label ?? (option.labelKey ? t(option.labelKey) : ''),
      detail: t(option.detailKey),
    })),
    [t],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const audio = window.echo?.audio;

    if (!audio) {
      setError(copy.desktopBridgeUnavailable);
      setDevices([]);
      return;
    }

    try {
      const nextStatus = await audio.getStatus();
      setOutputMode(nextStatus.outputMode);
      onStatusChange(nextStatus);

      const nextDevices = await audio.listDevices();
      setDevices(nextDevices);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, [copy.desktopBridgeUnavailable, onStatusChange]);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      let secondFrame = 0;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setIsMotionOpen(true));
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }

    setIsMotionOpen(false);

    if (!shouldRender) {
      return undefined;
    }

    const timer = window.setTimeout(() => setShouldRender(false), drawerExitAnimationMs);
    return () => window.clearTimeout(timer);
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const remembered = readRememberedAudioOutput();
    setRememberOutput(remembered.enabled);
    setSharedBackend(normalizeAudioSharedBackendForPlatform(remembered.sharedBackend ?? 'auto', rendererPlatform));
    void window.echo?.app
      .getSettings()
      .then((settings) => {
        setRememberOutput(settings.rememberedAudioOutput?.enabled === true);
        setSharedBackend(
          normalizeAudioSharedBackendForPlatform(settings.rememberedAudioOutput?.sharedBackend ?? remembered.sharedBackend ?? 'auto', rendererPlatform),
        );
        setUseJuceOutput(settings.audioUseJuceOutput === true);
        setUseJuceDecode(settings.audioUseJuceDecode === true);
        setUseDsdDop(settings.audioDsdOutputMode === 'dop');
        setAsioNativeDsdExperimentalEnabled(settings.audioAsioNativeDsdExperimentalEnabled === true);
        setDsdAutoVolumeLockEnabled(settings.audioDsdAutoVolumeLockEnabled === true);
        setAsioUnavailableFallbackEnabled(settings.audioAsioUnavailableFallbackEnabled === true);
        setExclusiveInstabilityFallbackEnabled(settings.audioExclusiveInstabilityFallbackEnabled === true);
        setSoxrFallbackEnabled(settings.audioSoxrFallbackEnabled !== false);
        setReleaseExclusiveOnPauseExperimentalEnabled(settings.audioReleaseExclusiveOnPauseExperimentalEnabled === true);
        setFixedVolumeEnabled(settings.fixedVolumeEnabled === true);
        setLowLoadPlaybackModeEnabled(settings.lowLoadPlaybackModeEnabled === true);
        setLowLoadPlaybackEnhancementsEnabled(settings.lowLoadPlaybackEnhancementsEnabled === true);
      })
      .catch(() => undefined);
    void loadPersistedHiddenDeviceKeys().then(setHiddenDeviceKeys).catch(() => setHiddenDeviceKeys(readHiddenDeviceKeys()));
    void refresh();

    const handleSettingsChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{
        lowLoadPlaybackEnhancementsEnabled?: unknown;
        lowLoadPlaybackModeEnabled?: unknown;
      } | null | undefined>).detail;
      if (!detail) {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(detail, 'lowLoadPlaybackModeEnabled')) {
        setLowLoadPlaybackModeEnabled(detail.lowLoadPlaybackModeEnabled === true);
      }
      if (Object.prototype.hasOwnProperty.call(detail, 'lowLoadPlaybackEnhancementsEnabled')) {
        setLowLoadPlaybackEnhancementsEnabled(detail.lowLoadPlaybackEnhancementsEnabled === true);
      }
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => window.removeEventListener('settings:changed', handleSettingsChanged);
  }, [isOpen, refresh, rendererPlatform]);

  useEffect(() => {
    if (status?.outputMode) {
      setOutputMode(status.outputMode);
    }
    if (status?.sharedBackend || status?.outputBackend === 'directsound-shared') {
      setSharedBackend(
        normalizeAudioSharedBackendForPlatform(
          status.outputBackend === 'directsound-shared' ? 'directsound' : normalizeSharedBackend(status.sharedBackend),
          rendererPlatform,
        ),
      );
    }
    setUseJuceOutput(status?.useJuceOutputRequested === true);
    setUseJuceDecode(status?.useJuceDecodeRequested === true);
    setUseDsdDop(status?.dsdOutputModeRequested === 'dop');
  }, [
    rendererPlatform,
    status?.dsdOutputModeRequested,
    status?.outputBackend,
    status?.outputMode,
    status?.sharedBackend,
    status?.useJuceDecodeRequested,
    status?.useJuceOutputRequested,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !hiddenDeviceMenu) {
      return undefined;
    }

    const closeMenu = (): void => setHiddenDeviceMenu(null);

    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [hiddenDeviceMenu, isOpen]);

  const persistOutput = useCallback(
    (settings: AudioOutputSettings, enabled = rememberOutput): void => {
      const remembered = readRememberedAudioOutput();
      const isDeviceSelection = settings.outputMode !== undefined;
      const hasBufferSize = Object.prototype.hasOwnProperty.call(settings, 'bufferSizeFrames');
      const nextOutputMode = settings.outputMode ?? remembered.outputMode ?? status?.outputMode ?? outputMode ?? 'shared';
      const nextSharedBackend = nextOutputMode === 'shared'
        ? normalizeAudioSharedBackendForPlatform(normalizeSharedBackend(settings.sharedBackend ?? remembered.sharedBackend ?? sharedBackend), rendererPlatform)
        : 'auto';
      const nextLatencyProfile = resolveSupportedLatencyProfile(
        nextOutputMode,
        settings.latencyProfile ?? remembered.latencyProfile ?? status?.latencyProfile ?? 'lowLatency',
      );
      const nextBufferSizeFrames = sanitizeOutputBufferSizeFrames(
        nextOutputMode,
        nextLatencyProfile,
        hasBufferSize
          ? settings.bufferSizeFrames ?? undefined
          : remembered.bufferSizeFrames,
      );
      writeRememberedAudioOutput({
        enabled,
        outputMode: nextOutputMode,
        sharedBackend: nextSharedBackend,
        latencyProfile: nextLatencyProfile,
        deviceIndex: isDeviceSelection ? settings.deviceIndex : remembered.deviceIndex,
        deviceName: isDeviceSelection ? settings.deviceName : remembered.deviceName,
        asioOutputChannelStart: isDeviceSelection ? settings.asioOutputChannelStart : remembered.asioOutputChannelStart,
        bufferSizeFrames: nextBufferSizeFrames,
      });
    },
    [outputMode, rememberOutput, rendererPlatform, sharedBackend, status?.latencyProfile, status?.outputMode],
  );

  const applyOutput = useCallback(
    async (settings: AudioOutputSettings): Promise<void> => {
      const audio = window.echo?.audio;
      const shouldLeaveHqPlayerTakeover = hqPlayerTakeoverEnabled && settings.outputMode !== undefined;

      if (!audio) {
        setError(copy.desktopBridgeUnavailable);
        return;
      }

      setIsBusy(true);
      setError(null);
      const previousMode = outputMode;
      try {
        if (shouldLeaveHqPlayerTakeover) {
          const connect = window.echo?.connect;
          const connectStatus = await connect?.getStatus?.().catch(() => null);
          if (connectStatus?.protocol === 'hqplayer' && connectStatus.deviceId === hqPlayerConnectDeviceId && connect?.disconnect) {
            await withTimeout(connect.disconnect(), 3_500, 'HQPlayer stop timed out').catch(() => undefined);
          }
        }

        const settingsWithFallback: AudioOutputSettings = { ...settings };
        if (settings.asioUnavailableFallbackEnabled !== undefined) {
          settingsWithFallback.asioUnavailableFallbackEnabled = settings.asioUnavailableFallbackEnabled;
        } else if (asioUnavailableFallbackEnabled) {
          settingsWithFallback.asioUnavailableFallbackEnabled = true;
        }
        if (settings.exclusiveInstabilityFallbackEnabled !== undefined) {
          settingsWithFallback.exclusiveInstabilityFallbackEnabled = settings.exclusiveInstabilityFallbackEnabled;
        } else if (exclusiveInstabilityFallbackEnabled) {
          settingsWithFallback.exclusiveInstabilityFallbackEnabled = true;
        }
        if (settings.asioNativeDsdExperimentalEnabled !== undefined) {
          settingsWithFallback.asioNativeDsdExperimentalEnabled = settings.asioNativeDsdExperimentalEnabled;
        } else if (asioNativeDsdExperimentalEnabled) {
          settingsWithFallback.asioNativeDsdExperimentalEnabled = true;
        }
        if (settings.soxrFallbackEnabled !== undefined) {
          settingsWithFallback.soxrFallbackEnabled = settings.soxrFallbackEnabled;
        }
        if (settings.releaseExclusiveOnPauseExperimentalEnabled !== undefined) {
          settingsWithFallback.releaseExclusiveOnPauseExperimentalEnabled = settings.releaseExclusiveOnPauseExperimentalEnabled;
        } else if (releaseExclusiveOnPauseExperimentalEnabled) {
          settingsWithFallback.releaseExclusiveOnPauseExperimentalEnabled = true;
        }
        if (rememberOutput) {
          persistOutput(settingsWithFallback);
        }
        const nextStatus = await withTimeout(audio.setOutput(settingsWithFallback), outputApplyTimeoutMs, 'Audio output switch timed out');
        setOutputMode(nextStatus.outputMode);
        setSharedBackend(
          normalizeAudioSharedBackendForPlatform(
            nextStatus.outputBackend === 'directsound-shared'
              ? 'directsound'
              : normalizeSharedBackend(nextStatus.sharedBackend ?? settings.sharedBackend ?? sharedBackend),
            rendererPlatform,
          ),
        );
        onStatusChange(nextStatus);
        if (shouldLeaveHqPlayerTakeover) {
          onHqPlayerTakeoverEnabledChange(false);
        }
      } catch (applyError) {
        setError(applyError instanceof Error ? applyError.message : String(applyError));
        try {
          const latestStatus = await withTimeout(audio.getStatus(), 2_500, 'Audio status refresh timed out');
          setOutputMode(latestStatus.outputMode);
          setSharedBackend(
            normalizeAudioSharedBackendForPlatform(
              latestStatus.outputBackend === 'directsound-shared'
                ? 'directsound'
                : normalizeSharedBackend(latestStatus.sharedBackend ?? sharedBackend),
              rendererPlatform,
            ),
          );
          onStatusChange(latestStatus);
        } catch {
          setOutputMode(status?.outputMode ?? previousMode);
        }
      } finally {
        setIsBusy(false);
      }
    },
    [
      asioNativeDsdExperimentalEnabled,
      asioUnavailableFallbackEnabled,
      copy.desktopBridgeUnavailable,
      exclusiveInstabilityFallbackEnabled,
      hqPlayerTakeoverEnabled,
      onStatusChange,
      onHqPlayerTakeoverEnabledChange,
      outputMode,
      persistOutput,
      releaseExclusiveOnPauseExperimentalEnabled,
      rememberOutput,
      rendererPlatform,
      sharedBackend,
      status?.outputMode,
    ],
  );

  const applyLatencyProfile = useCallback(
    (requestedLatencyProfile: AudioLatencyProfile): void => {
      const nextOutputMode = status?.outputMode ?? outputMode ?? 'shared';
      const latencyProfile = resolveSupportedLatencyProfile(nextOutputMode, requestedLatencyProfile);
      const remembered = readRememberedAudioOutput();
      const rememberedBufferSizeFrames = remembered.bufferSizeFrames ?? null;
      const currentBufferSizeFrames =
        nextOutputMode === 'asio'
          ? currentAsioBufferFrames ?? rememberedBufferSizeFrames
          : rememberedBufferSizeFrames;
      const settings: AudioOutputSettings = { latencyProfile };
      const sanitizedBufferSizeFrames = sanitizeOutputBufferSizeFrames(
        nextOutputMode,
        latencyProfile,
        currentBufferSizeFrames,
      );

      if (nextOutputMode === 'asio') {
        settings.bufferSizeFrames = null;
      } else if (
        latencyProfile === 'lowLatency' &&
        currentBufferSizeFrames !== null &&
        sanitizedBufferSizeFrames !== currentBufferSizeFrames
      ) {
        settings.bufferSizeFrames = sanitizedBufferSizeFrames ?? null;
      }

      void applyOutput(settings);
    },
    [applyOutput, currentAsioBufferFrames, outputMode, status?.outputMode],
  );

  const applyDevice = (mode: AudioOutputMode, device: AudioDeviceInfo | null): void => {
    const nextMode = mode === 'system' || advancedNativeOutputAvailable ? mode : 'shared';
    const remembered = readRememberedAudioOutput();
    const settings = createOutputSettings(
      nextMode,
      device,
      status?.latencyProfile ?? remembered.latencyProfile ?? 'balanced',
      nextMode === 'shared' ? sharedBackend : 'auto',
    );
    if (nextMode === 'asio' && remembered.bufferSizeFrames) {
      settings.bufferSizeFrames = remembered.bufferSizeFrames;
    }
    setOutputMode(nextMode);
    void applyOutput(settings);
  };

  const applySystemAudio = (): void => {
    const remembered = readRememberedAudioOutput();
    const nextMode: AudioOutputMode = rendererPlatform === 'win32' ? 'shared' : 'system';
    const nextSharedBackend: AudioSharedBackend = rendererPlatform === 'win32' ? 'windows' : 'auto';
    const settings = createOutputSettings(
      nextMode,
      null,
      status?.latencyProfile ?? remembered.latencyProfile ?? 'balanced',
      nextSharedBackend,
    );
    setOutputMode(nextMode);
    setSharedBackend(nextSharedBackend);
    void applyOutput(settings);
  };

  const handleHqPlayerTakeover = useCallback(async (): Promise<void> => {
    if (hqPlayerTakeoverEnabled) {
      setError(null);
      const connect = window.echo?.connect;
      const connectStatus = await connect?.getStatus?.().catch(() => null);
      if (connectStatus?.protocol === 'hqplayer' && connectStatus.deviceId === hqPlayerConnectDeviceId && connect?.disconnect) {
        await withTimeout(connect.disconnect(), 3_500, 'HQPlayer stop timed out').catch((disconnectError) => {
          setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError));
        });
      }
      onHqPlayerTakeoverEnabledChange(false);
      return;
    }

    if (!onActivateHqPlayerTakeover) {
      setError('HQPlayer 接管不可用。');
      return;
    }

    setHqPlayerTakeoverBusy(true);
    setError(null);
    try {
      await onActivateHqPlayerTakeover();
      onHqPlayerTakeoverEnabledChange(true);
    } catch (takeoverError) {
      setError(takeoverError instanceof Error ? takeoverError.message : String(takeoverError));
    } finally {
      setHqPlayerTakeoverBusy(false);
    }
  }, [hqPlayerTakeoverEnabled, onActivateHqPlayerTakeover, onHqPlayerTakeoverEnabledChange]);

  const openAsioControlPanel = async (device: AudioDeviceInfo): Promise<void> => {
    const audio = window.echo?.audio;
    if (!audio?.openAsioControlPanel) {
      setError(copy.desktopBridgeUnavailable);
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      await audio.openAsioControlPanel({
        deviceIndex: device.index,
        deviceName: device.name,
      });
    } catch (panelError) {
      setError(panelError instanceof Error ? panelError.message : String(panelError));
    } finally {
      setIsBusy(false);
    }
  };

  const applySharedBackend = (nextSharedBackend: AudioSharedBackend): void => {
    const remembered = readRememberedAudioOutput();
    const currentDevice = allSharedDevices.find((device) => deviceMatchesStatus(device, status, 'shared')) ?? defaultSharedDevice;
    const settings = createOutputSettings(
      'shared',
      currentDevice,
      status?.latencyProfile ?? remembered.latencyProfile ?? 'balanced',
      nextSharedBackend,
    );

    setOutputMode('shared');
    setSharedBackend(nextSharedBackend);
    void applyOutput(settings);
  };

  const toggleExclusive = (enabled: boolean): void => {
    if (lockWasapiExclusive) {
      return;
    }

    const nextMode: AudioOutputMode = enabled ? 'exclusive' : 'shared';
    const currentDevice = allSharedDevices.find((device) => deviceMatchesStatus(device, status, outputMode)) ?? null;
    applyDevice(nextMode, currentDevice);
  };

  const toggleAdvancedOutputOpen = (): void => {
    setIsAdvancedOutputOpen((current) => {
      const next = !current;
      writeAdvancedOutputOpen(next);
      return next;
    });
  };

  const toggleAudioEngineMeterOpen = (): void => {
    setIsAudioEngineMeterOpen((current) => {
      const next = !current;
      writeAudioEngineMeterOpen(next);
      return next;
    });
  };

  const toggleRememberOutput = (enabled: boolean): void => {
    setRememberOutput(enabled);
    persistOutput(
      {
        outputMode: status?.outputMode ?? outputMode,
        sharedBackend: status?.sharedBackend ?? sharedBackend,
        latencyProfile: resolveSupportedLatencyProfile(status?.outputMode ?? outputMode, status?.latencyProfile ?? currentLatencyProfile),
        deviceIndex: statusDevice?.index,
        deviceName: status?.outputDeviceName ?? statusDevice?.name,
        asioOutputChannelStart: status?.outputMode === 'asio' ? status.asioOutputChannelStart ?? undefined : undefined,
        bufferSizeFrames: status?.outputMode === 'asio' ? currentAsioBufferFrames : undefined,
      },
      enabled,
    );
  };

  const toggleFixedVolume = async (enabled: boolean): Promise<void> => {
    const app = window.echo?.app;
    const audio = window.echo?.audio;

    setFixedVolumeEnabled(enabled);
    try {
      const nextSettings = await app?.setSettings?.({
        fixedVolumeEnabled: enabled,
        ...(enabled ? { playerVolume: 1 } : {}),
      });
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: nextSettings ?? { fixedVolumeEnabled: enabled } }));
      if (enabled && audio) {
        onStatusChange(await audio.setOutput({ volume: 1 }));
      }
    } catch (fixedVolumeError) {
      setFixedVolumeEnabled(!enabled);
      setError(fixedVolumeError instanceof Error ? fixedVolumeError.message : String(fixedVolumeError));
    }
  };

  const toggleLowLoadPlaybackMode = (enabled: boolean): void => {
    const app = window.echo?.app;
    const previous = lowLoadPlaybackModeEnabled;
    if (!app?.setSettings) {
      setError(copy.desktopBridgeUnavailable);
      return;
    }

    setLowLoadPlaybackModeEnabled(enabled);
    void app
      .setSettings({ lowLoadPlaybackModeEnabled: enabled })
      .then((nextSettings) => {
        const detail = nextSettings && typeof nextSettings === 'object'
          ? { ...nextSettings, lowLoadPlaybackModeEnabled: enabled }
          : { lowLoadPlaybackModeEnabled: enabled };
        window.dispatchEvent(new CustomEvent('settings:changed', { detail }));
      })
      .catch((settingsError) => {
        setLowLoadPlaybackModeEnabled(previous);
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
      });
  };

  const toggleLowLoadPlaybackEnhancements = (enabled: boolean): void => {
    const app = window.echo?.app;
    const previous = lowLoadPlaybackEnhancementsEnabled;
    if (!app?.setSettings) {
      setError(copy.desktopBridgeUnavailable);
      return;
    }

    setLowLoadPlaybackEnhancementsEnabled(enabled);
    void app
      .setSettings({ lowLoadPlaybackEnhancementsEnabled: enabled })
      .then((nextSettings) => {
        const detail = nextSettings && typeof nextSettings === 'object'
          ? { ...nextSettings, lowLoadPlaybackEnhancementsEnabled: enabled }
          : { lowLoadPlaybackEnhancementsEnabled: enabled };
        window.dispatchEvent(new CustomEvent('settings:changed', { detail }));
      })
      .catch((settingsError) => {
        setLowLoadPlaybackEnhancementsEnabled(previous);
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
      });
  };

  const toggleJuceOutput = (enabled: boolean): void => {
    const previous = useJuceOutput;
    setUseJuceOutput(enabled);
    void window.echo?.app.setSettings({ audioUseJuceOutput: enabled }).catch(() => undefined);
    void applyOutput({ useJuceOutput: enabled }).catch(() => {
      setUseJuceOutput(previous);
    });
  };

  const toggleJuceDecode = (enabled: boolean): void => {
    const previous = useJuceDecode;
    setUseJuceDecode(enabled);
    void window.echo?.app.setSettings({ audioUseJuceDecode: enabled }).catch(() => undefined);
    void applyOutput({ useJuceDecode: enabled }).catch(() => {
      setUseJuceDecode(previous);
    });
  };

  const toggleDsdDirectChain = (enabled: boolean): void => {
    const previousDsdDop = useDsdDop;
    const previousAsioNativeDsd = asioNativeDsdExperimentalEnabled;
    const dsdOutputMode = enabled ? 'dop' : 'pcm';
    setUseDsdDop(enabled);
    setAsioNativeDsdExperimentalEnabled(enabled);
    void window.echo?.app
      .setSettings({
        audioDsdOutputMode: dsdOutputMode,
        audioAsioNativeDsdExperimentalEnabled: enabled,
      })
      .catch(() => undefined);
    void applyOutput({ dsdOutputMode, asioNativeDsdExperimentalEnabled: enabled }).catch(() => {
      setUseDsdDop(previousDsdDop);
      setAsioNativeDsdExperimentalEnabled(previousAsioNativeDsd);
    });
  };

  const toggleDsdDop = (enabled: boolean): void => {
    toggleDsdDirectChain(enabled);
  };

  const toggleAsioNativeDsdExperimental = (enabled: boolean): void => {
    toggleDsdDirectChain(enabled);
  };

  const toggleDsdAutoVolumeLock = (enabled: boolean): void => {
    const previous = dsdAutoVolumeLockEnabled;
    setDsdAutoVolumeLockEnabled(enabled);
    void window.echo?.app
      .setSettings({ audioDsdAutoVolumeLockEnabled: enabled })
      .then((nextSettings) => {
        window.dispatchEvent(new CustomEvent('settings:changed', { detail: nextSettings ?? { audioDsdAutoVolumeLockEnabled: enabled } }));
      })
      .catch((volumeLockError) => {
        setDsdAutoVolumeLockEnabled(previous);
        setError(volumeLockError instanceof Error ? volumeLockError.message : String(volumeLockError));
      });
  };

  const toggleAsioUnavailableFallback = (enabled: boolean): void => {
    const previous = asioUnavailableFallbackEnabled;
    setAsioUnavailableFallbackEnabled(enabled);
    void window.echo?.app.setSettings({ audioAsioUnavailableFallbackEnabled: enabled }).catch(() => undefined);
    void applyOutput({ asioUnavailableFallbackEnabled: enabled }).catch(() => {
      setAsioUnavailableFallbackEnabled(previous);
    });
  };

  const toggleExclusiveInstabilityFallback = (enabled: boolean): void => {
    const previous = exclusiveInstabilityFallbackEnabled;
    setExclusiveInstabilityFallbackEnabled(enabled);
    void window.echo?.app.setSettings({ audioExclusiveInstabilityFallbackEnabled: enabled }).catch(() => undefined);
    void applyOutput({ exclusiveInstabilityFallbackEnabled: enabled }).catch(() => {
      setExclusiveInstabilityFallbackEnabled(previous);
    });
  };

  const toggleSoxrFallback = (enabled: boolean): void => {
    const previous = soxrFallbackEnabled;
    setSoxrFallbackEnabled(enabled);
    void window.echo?.app.setSettings({ audioSoxrFallbackEnabled: enabled }).catch(() => undefined);
    void applyOutput({ soxrFallbackEnabled: enabled }).catch(() => {
      setSoxrFallbackEnabled(previous);
    });
  };

  const toggleReleaseExclusiveOnPauseExperimental = (enabled: boolean): void => {
    const previous = releaseExclusiveOnPauseExperimentalEnabled;
    setReleaseExclusiveOnPauseExperimentalEnabled(enabled);
    void window.echo?.app.setSettings({ audioReleaseExclusiveOnPauseExperimentalEnabled: enabled }).catch(() => undefined);
    void applyOutput({ releaseExclusiveOnPauseExperimentalEnabled: enabled }).catch(() => {
      setReleaseExclusiveOnPauseExperimentalEnabled(previous);
    });
  };

  const hideDevice = (device: AudioDeviceInfo): void => {
    setHiddenDeviceKeys((currentKeys) => {
      const nextKeys = Array.from(new Set([...currentKeys, getDeviceStorageKey(device)]));
      writeHiddenDeviceKeys(nextKeys);
      return nextKeys;
    });
    setHiddenDeviceMenu(null);
  };

  const restoreDevice = (device: AudioDeviceInfo): void => {
    setHiddenDeviceKeys((currentKeys) => {
      const nextKeys = currentKeys.filter((key) => key !== getDeviceStorageKey(device));
      writeHiddenDeviceKeys(nextKeys);
      return nextKeys;
    });
  };

  const openDeviceMenu = (event: MouseEvent<HTMLButtonElement>, device: AudioDeviceInfo): void => {
    event.preventDefault();
    event.stopPropagation();
    setHiddenDeviceMenu({
      device,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 72)),
    });
  };

  const suppressNativeDeviceMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    if (event.button !== 2) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  const copyDiagnostics = useCallback(async (): Promise<void> => {
    const audio = window.echo?.audio;

    if (!audio) {
      setError(copy.desktopBridgeUnavailable);
      return;
    }

    try {
      const diagnostics = await audio.getDiagnostics();
      await window.navigator.clipboard.writeText(formatAudioDiagnostics(diagnostics));
      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 1800);
      setError(null);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }, [copy.desktopBridgeUnavailable]);

  const resetAudioEngine = useCallback(async (): Promise<void> => {
    const audio = window.echo?.audio;

    if (!audio) {
      setError(copy.desktopBridgeUnavailable);
      return;
    }

    setResetBusy(true);
    setResetMessage(null);
    try {
      const nextStatus = await audio.resetEngine();
      setOutputMode(nextStatus.outputMode);
      onStatusChange(nextStatus);
      setError(null);
      setResetMessage(t('audioDrawer.action.resetEngineDone'));
      window.setTimeout(() => setResetMessage(null), 2200);
      void refresh();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setResetBusy(false);
    }
  }, [copy.desktopBridgeUnavailable, onStatusChange, refresh, t]);

  const forceRestartAudioEngine = useCallback(async (): Promise<void> => {
    const audio = window.echo?.audio;

    if (!audio) {
      setError(copy.desktopBridgeUnavailable);
      return;
    }

    setForceRestartBusy(true);
    setTroubleshootingMessage(null);
    try {
      const nextStatus = await audio.forceRestart('audio-drawer-force-restart');
      setOutputMode(nextStatus.outputMode);
      onStatusChange(nextStatus);
      setError(null);
      setTroubleshootingMessage(t('audioDrawer.troubleshooting.softDone'));
      window.setTimeout(() => setTroubleshootingMessage(null), 2400);
      void refresh();
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : String(restartError));
    } finally {
      setForceRestartBusy(false);
    }
  }, [copy.desktopBridgeUnavailable, onStatusChange, refresh, t]);

  const restartWindowsAudioService = useCallback(async (): Promise<void> => {
    if (!windowsAudioServiceRestartAvailable) {
      return;
    }

    if (!window.confirm(t('audioDrawer.troubleshooting.hardConfirm'))) {
      return;
    }

    const audio = window.echo?.audio;

    if (!audio) {
      setError(copy.desktopBridgeUnavailable);
      return;
    }

    setWindowsAudioRestartBusy(true);
    setTroubleshootingMessage(null);
    try {
      const nextStatus = await audio.restartWindowsAudioService();
      setOutputMode(nextStatus.outputMode);
      onStatusChange(nextStatus);
      setError(null);
      setTroubleshootingMessage(t('audioDrawer.troubleshooting.hardDone'));
      window.setTimeout(() => setTroubleshootingMessage(null), 2800);
      void refresh();
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : String(restartError));
    } finally {
      setWindowsAudioRestartBusy(false);
    }
  }, [copy.desktopBridgeUnavailable, onStatusChange, refresh, t, windowsAudioServiceRestartAvailable]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="audio-drawer-root no-drag" role="presentation" data-open={isMotionOpen}>
      <button className="audio-drawer-scrim" type="button" aria-label={copy.close} onClick={onClose} />
      <aside className="audio-drawer" aria-label={t('audioDrawer.title')}>
        <div className="audio-drawer-scroll">
          <header className="audio-drawer-header">
            <div>
              <SlidersHorizontal size={18} />
              <h2>{t('audioDrawer.title')}</h2>
            </div>
            <button className="audio-drawer-close" type="button" aria-label={copy.close} title={copy.close} onClick={onClose}>
              <X size={20} />
            </button>
          </header>

        <section
          className={['audio-engine-meter', isAudioEngineMeterOpen ? 'audio-engine-meter--open' : ''].filter(Boolean).join(' ')}
          aria-label="HiFi Engine"
        >
          <div className="audio-engine-meter__top">
            <button
              className="audio-engine-meter__summary"
              type="button"
              aria-expanded={isAudioEngineMeterOpen}
              onClick={toggleAudioEngineMeterOpen}
            >
            <span className="audio-engine-meter__icon">
              <Zap size={17} />
            </span>
            <div>
              <span>HiFi Engine</span>
              <strong>{hqPlayerTakeoverEnabled ? formatHqPlayerTrackLine(hqPlayerTrack, 'HQPlayer 接管中') : formatCodecLine(status, copy)}</strong>
            </div>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            <button
              className="audio-engine-meter__refresh"
              type="button"
              aria-label={t('audioProfessional.action.refresh')}
              title={t('audioProfessional.action.refresh')}
              onClick={() => void refresh()}
              disabled={isBusy}
            >
              <RefreshCw size={15} />
            </button>
          </div>
          {isAudioEngineMeterOpen ? (
            <>
          <div className="audio-engine-meter__grid">
            <span>
              <em>{t('audioDrawer.meter.output')}</em>
              <strong title={currentOutputName}>{currentOutputName}</strong>
            </span>
            <span>
              <em>{t('audioDrawer.meter.mode')}</em>
              <strong>{currentOutput.modeLabel}</strong>
            </span>
            <span>
              <em>{t('audioDrawer.meter.rate')}</em>
              <strong>{engineRatePath}</strong>
            </span>
          </div>
          <div className="audio-engine-meter__details">
            {engineSignalDetails.map((detail) => (
              <span key={detail.label}>
                <em>{detail.label}</em>
                <strong title={detail.value}>{detail.value}</strong>
              </span>
            ))}
          </div>
          {engineBadges.length ? (
            <div className="audio-engine-meter__badges">
              {engineBadges.map((badge) => (
                <em data-tone={badge.tone} key={badge.label}>
                  {badge.label}
                </em>
              ))}
            </div>
          ) : null}
          <span className="audio-engine-meter__hint">{t('audioDrawer.note.engine')}</span>
            </>
          ) : null}
        </section>

        <section className="audio-drawer-section audio-current-output-section">
          <div className="audio-drawer-section-title">
            <Headphones size={17} />
            <h3>{t('audioDrawer.section.currentOutput')}</h3>
          </div>
          <div
            className={[
              'audio-current-output-card',
              currentOutput.highlight ? 'audio-current-output-card--gold' : '',
              currentOutput.mode === 'asio' ? 'audio-current-output-card--asio' : '',
            ].filter(Boolean).join(' ')}
          >
            <span className="audio-current-output-card__icon">
              <currentOutput.Icon size={22} />
            </span>
            <div className="audio-current-output-card__body">
              <strong title={currentOutput.name}>{currentOutput.name}</strong>
              <span>
                {currentOutput.modeLabel} / {currentOutput.sampleRate || copy.ratePending}
              </span>
              <span>
                {[currentOutput.backend, currentOutput.asioRoute, currentOutput.bitPerfect].filter(Boolean).join(' / ')}
              </span>
            </div>
            <em>{t('audioDrawer.device.selected')}</em>
          </div>
          {showHighOutputSampleRateWarning ? (
            <p className="audio-current-output-warning" role="alert">
              <ShieldAlert size={14} aria-hidden="true" />
              <span>{t('audioDrawer.warning.highOutputSampleRate')}</span>
            </p>
          ) : null}
        </section>

        <section className="audio-drawer-section">
          <label className="audio-toggle-row">
            <span>
              <Gauge size={17} />
              <strong>{t('audioDrawer.option.lowLoadPlaybackMode')}</strong>
            </span>
            <input
              type="checkbox"
              checked={lowLoadPlaybackModeEnabled}
              onChange={(event) => toggleLowLoadPlaybackMode(event.currentTarget.checked)}
            />
          </label>
          <p className="audio-section-note">{t('audioDrawer.option.lowLoadPlaybackModeDescription')}</p>
          <label className="audio-toggle-row">
            <span>
              <ShieldAlert size={17} />
              <strong>{t('audioDrawer.option.lowLoadPlaybackEnhancements')}</strong>
            </span>
            <input
              type="checkbox"
              checked={lowLoadPlaybackEnhancementsEnabled}
              onChange={(event) => toggleLowLoadPlaybackEnhancements(event.currentTarget.checked)}
            />
          </label>
          <p className="audio-section-note">{t('audioDrawer.option.lowLoadPlaybackEnhancementsDescription')}</p>
        </section>

        <section className="audio-drawer-section">
          <button
            className={`audio-device-pill ${hqPlayerTakeoverEnabled ? 'active' : ''}`}
            type="button"
            title="HQPlayer 接管"
            disabled={hqPlayerTakeoverBusy}
            onClick={() => void handleHqPlayerTakeover()}
          >
            <Cable size={15} />
            <span>
              <strong>{hqPlayerTakeoverEnabled ? '取消 HQPlayer 接管' : 'HQPlayer 接管'}</strong>
              <small>{hqPlayerTakeoverEnabled ? '退出接管后可重新选择本机输出设备' : '接管后播放、上一首、下一首都会优先交给 HQPlayer'}</small>
            </span>
            <em>{hqPlayerTakeoverEnabled ? '退出接管' : '外部输出'}</em>
            {hqPlayerTakeoverEnabled ? <Check size={15} /> : null}
          </button>
        </section>

        <section className="audio-drawer-section">
          <div className="audio-drawer-section-title">
            <Waves size={17} />
            <h3>{t('audioDrawer.section.systemDevices')}</h3>
          </div>
          <button
            className={`audio-device-pill ${systemAudioActive ? 'active' : ''}`}
            type="button"
            title={copy.systemAudio}
            disabled={isBusy}
            onClick={applySystemAudio}
          >
            <Waves size={15} />
            <span>
              <strong>{copy.systemAudio}</strong>
              <small>{copy.systemAudioDescription}</small>
            </span>
            <em>{systemAudioPlatformLabel}</em>
            {systemAudioActive ? <Check size={15} /> : null}
          </button>
          <button
            className={`audio-device-pill ${!systemAudioActive && !hqPlayerTakeoverEnabled && !status?.outputDeviceName && outputMode !== 'asio' && outputMode !== 'system' ? 'active' : ''}`}
            type="button"
            title={copy.systemDefaultOutput}
            disabled={isBusy}
            onClick={() => applyDevice(wasapiExclusive ? 'exclusive' : 'shared', null)}
          >
            <Waves size={15} />
            <span>
              <strong>{t('audioDrawer.device.systemDefault')}</strong>
              <small>{formatWasapiDeviceMode(wasapiExclusive)} / {t('audioDrawer.device.systemSelectedRoute')}</small>
            </span>
            <em>WASAPI</em>
            {!systemAudioActive && !hqPlayerTakeoverEnabled && outputMode !== 'asio' && outputMode !== 'system' && !status?.outputDeviceName ? <Check size={15} /> : null}
          </button>
          {sharedDevices.length === 0 ? <p className="audio-drawer-empty">{t('audioDrawer.empty.systemDevices')}</p> : null}
          {sharedDevices.map((device) => {
            const isActive = !hqPlayerTakeoverEnabled && deviceMatchesStatus(device, status, outputMode);
            const DeviceIcon = getDeviceIcon(device.name, wasapiExclusive ? 'exclusive' : 'shared');
            const sampleRate = formatRate(device.sharedDeviceSampleRate ?? device.sampleRate);

            return (
              <button
                className={`audio-device-pill ${isActive ? 'active' : ''}`}
                key={device.id}
                type="button"
                title={device.name}
                disabled={isBusy}
                onMouseDown={suppressNativeDeviceMenu}
                onContextMenu={(event) => openDeviceMenu(event, device)}
                onClick={() => applyDevice(wasapiExclusive ? 'exclusive' : 'shared', device)}
              >
                <DeviceIcon size={15} />
                <span>
                  <strong>{device.name}</strong>
                  <small>{formatWasapiDeviceMode(wasapiExclusive)} / {sampleRate || t('audioDrawer.status.sampleRatePending')}</small>
                </span>
                <em>WASAPI</em>
                {isActive ? <Check size={15} /> : null}
              </button>
            );
          })}
          {advancedNativeOutputAvailable ? (
            <>
              <label className="audio-toggle-row audio-toggle-row--section-control">
                <span>
                  <Lock size={17} />
                  <strong>{t('audioDrawer.option.wasapiExclusive')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={wasapiExclusive}
                  disabled={lockWasapiExclusive || isBusy}
                  onChange={(event) => toggleExclusive(event.currentTarget.checked)}
                />
              </label>
              <p className="audio-section-note">{t('audioDrawer.option.wasapiExclusiveDescription')}</p>
            </>
          ) : null}
        </section>

        {advancedNativeOutputAvailable ? (
          <section className="audio-drawer-section">
            <div className="audio-drawer-section-title">
              <Zap size={17} />
              <h3>{t('audioDrawer.section.asioDevices')}</h3>
            </div>
            <p className="audio-section-note">{t('audioDrawer.note.asio')}</p>
            {asioDevices.length === 0 ? <p className="audio-drawer-empty">{t('audioDrawer.empty.asioDevices')}</p> : null}
            {asioDevices.map((device) => {
              const defaultRouteDevice = createAsioRouteDevice(device, 0);
              const isActive = !hqPlayerTakeoverEnabled && deviceMatchesStatus(defaultRouteDevice, status, 'asio');
              const DeviceIcon = getDeviceIcon(device.name, 'asio');
              const outputCountLabel = formatAsioOutputCount(device);
              const routeCount = Math.max(0, Math.floor((device.asioOutputChannels ?? 0) / 2));
              const routeStarts = shouldShowAsioAdvancedRoutes(device)
                ? Array.from({ length: routeCount }, (_value, index) => index * 2)
                : [];

              return (
                <div className="audio-asio-device-group" key={device.id}>
                  <button
                    className={`audio-device-pill audio-device-pill--asio ${isActive ? 'active' : ''}`}
                    type="button"
                    title={device.name}
                    disabled={isBusy}
                    onMouseDown={suppressNativeDeviceMenu}
                    onContextMenu={(event) => openDeviceMenu(event, device)}
                    onClick={() => applyDevice('asio', defaultRouteDevice)}
                  >
                    <DeviceIcon size={15} />
                    <span>
                      <strong>{device.name}</strong>
                      <small>{copy.asioDriver} / {outputCountLabel ?? t('audioDrawer.device.lowLatency')}</small>
                    </span>
                    <em>ASIO</em>
                    {isActive ? <Check size={15} /> : null}
                  </button>
                  {showAsioPanelSettings ? (
                    <div className="audio-asio-device-actions">
                      <button type="button" disabled={isBusy} onClick={() => void openAsioControlPanel(device)}>
                        <SlidersHorizontal size={14} />
                        <span>{t('audioDrawer.action.openAsioPanel')}</span>
                      </button>
                    </div>
                  ) : null}
                  {routeStarts.length > 1 ? (
                    <div className="audio-asio-routes" aria-label={t('audioDrawer.asioRoutes.title')}>
                      {routeStarts.map((start) => {
                        const routeDevice = createAsioRouteDevice(device, start);
                        const routeActive = !hqPlayerTakeoverEnabled && deviceMatchesStatus(routeDevice, status, 'asio');
                        return (
                          <button
                            className={`audio-asio-route ${routeActive ? 'active' : ''}`}
                            key={start}
                            type="button"
                            disabled={isBusy}
                            onClick={() => applyDevice('asio', routeDevice)}
                          >
                            <span>{formatAsioChannelRoute(device, start)}</span>
                            {routeActive ? <Check size={14} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}

        <section className={`audio-drawer-section audio-drawer-options${isAdvancedOutputOpen ? ' audio-drawer-options--open' : ''}`}>
          <button
            className="audio-drawer-options-toggle"
            type="button"
            aria-expanded={isAdvancedOutputOpen}
            onClick={toggleAdvancedOutputOpen}
          >
            <span>
              <Gauge size={17} />
              <strong>{t('audioDrawer.section.advancedOutput')}</strong>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <p>{t('audioDrawer.section.advancedOutputDescription')}</p>

          {isAdvancedOutputOpen ? (
            <div className="audio-drawer-options-body">
              {advancedNativeOutputAvailable ? (
                <>
              <label className="audio-toggle-row">
                <span>
                  <AudioLines size={17} />
                  <strong>{t('audioDrawer.option.juceOutput')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={useJuceOutput}
                  disabled={isBusy}
                  onChange={(event) => toggleJuceOutput(event.currentTarget.checked)}
                />
              </label>
              <p>{t('audioDrawer.note.juceOutput')}</p>

              <label className="audio-toggle-row">
                <span>
                  <Music2 size={17} />
                  <strong>{t('audioDrawer.option.juceDecode')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={useJuceDecode}
                  disabled={isBusy}
                  onChange={(event) => toggleJuceDecode(event.currentTarget.checked)}
                />
              </label>
              <p>{t('audioDrawer.note.juceDecode')}</p>

              <label className="audio-toggle-row">
                <span>
                  <Route size={17} />
                  <strong>{t('audioDrawer.option.dsdDop')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={useDsdDop}
                  disabled={isBusy}
                  onChange={(event) => toggleDsdDop(event.currentTarget.checked)}
                />
              </label>
              <p>
                {t('audioDrawer.note.dsdDop')}
                <span className="audio-section-note-inline-warning">需要使用 ASIO</span>
              </p>

              <label className="audio-toggle-row">
                <span>
                  <FlaskConical size={17} />
                  <strong>{t('audioDrawer.option.asioNativeDsd')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={asioNativeDsdExperimentalEnabled}
                  disabled={isBusy}
                  onChange={(event) => toggleAsioNativeDsdExperimental(event.currentTarget.checked)}
                />
              </label>
              <p>
                {t('audioDrawer.note.asioNativeDsd')}
                <span className="audio-section-note-inline-warning">需要使用 ASIO</span>
              </p>

              <label className="audio-toggle-row">
                <span>
                  <Lock size={17} />
                  <strong>{t('audioDrawer.option.dsdAutoVolumeLock')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={dsdAutoVolumeLockEnabled}
                  disabled={isBusy}
                  onChange={(event) => toggleDsdAutoVolumeLock(event.currentTarget.checked)}
                />
              </label>
              <p>{t('audioDrawer.note.dsdAutoVolumeLock')}</p>

              <label className="audio-toggle-row">
                <span>
                  <Zap size={17} />
                  <strong>{t('audioDrawer.guard.asioUnavailable.title')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={asioUnavailableFallbackEnabled}
                  disabled={isBusy}
                  onChange={(event) => toggleAsioUnavailableFallback(event.currentTarget.checked)}
                />
              </label>
              <p>{t('audioDrawer.guard.asioUnavailable.description')}</p>

              <label className="audio-toggle-row">
                <span>
                  <ShieldAlert size={17} />
                  <strong>{t('audioDrawer.guard.exclusiveInstability.title')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={exclusiveInstabilityFallbackEnabled}
                  disabled={isBusy}
                  onChange={(event) => toggleExclusiveInstabilityFallback(event.currentTarget.checked)}
                />
              </label>
              <p>{t('audioDrawer.guard.exclusiveInstability.description')}</p>

              <label className="audio-toggle-row">
                <span>
                  <Waves size={17} />
                  <strong>{t('audioDrawer.guard.soxrFallback.title')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={soxrFallbackEnabled}
                  disabled={isBusy}
                  onChange={(event) => toggleSoxrFallback(event.currentTarget.checked)}
                />
              </label>
              <p>{t('audioDrawer.guard.soxrFallback.description')}</p>

              <label className="audio-toggle-row">
                <span>
                  <Lock size={17} />
                  <strong>{t('audioDrawer.option.releaseExclusiveOnPause')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={releaseExclusiveOnPauseExperimentalEnabled}
                  disabled={isBusy}
                  onChange={(event) => toggleReleaseExclusiveOnPauseExperimental(event.currentTarget.checked)}
                />
              </label>
              <p>{t('audioDrawer.note.releaseExclusiveOnPause')}</p>
                </>
              ) : null}

              {sharedBackendOptions.length > 0 ? (
                <div className="audio-drawer-mini-grid" aria-label={t('audioDrawer.option.sharedBackend')}>
                  {sharedBackendOptions.map((option) => (
                    <button
                      className={`audio-device-pill ${outputMode === 'shared' && sharedBackend === option.id ? 'active' : ''}`}
                      type="button"
                      key={option.id}
                      disabled={isBusy}
                      onClick={() => applySharedBackend(option.id)}
                    >
                      <Waves size={15} />
                      <span>
                        <strong>{t(option.labelKey)}</strong>
                        <small>{t(option.detailKey)}</small>
                      </span>
                      <em>{outputMode === 'shared' && sharedBackend === option.id ? optionActiveLabel : optionSetLabel}</em>
                    </button>
                  ))}
                </div>
              ) : null}

          <div className={`audio-buffer-collapse${isBufferOptionsOpen ? ' audio-buffer-collapse--open' : ''}`}>
            <button
              className="audio-buffer-collapse-button"
              type="button"
              aria-expanded={isBufferOptionsOpen}
              onClick={() => setIsBufferOptionsOpen((value) => !value)}
            >
              <span>
                <Gauge size={17} />
                <strong>{t('audioDrawer.buffer.title')}</strong>
                {!isBufferOptionsOpen ? <small>{t('audioDrawer.buffer.collapsedDescription')}</small> : null}
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>

            {isBufferOptionsOpen ? (
              <div className="audio-buffer-collapse-body">
                <div className="audio-drawer-mini-grid" aria-label={t('audioDrawer.buffer.latencyProfile')}>
                  {latencyProfileOptions.map((option) => (
                    <button
                      className={`audio-device-pill ${supportedLatencyProfile === option.id ? 'active' : ''}`}
                      type="button"
                      key={option.id}
                      disabled={isBusy}
                      onClick={() => applyLatencyProfile(option.id)}
                    >
                      <Gauge size={15} />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.detail}</small>
                      </span>
                      <em>{supportedLatencyProfile === option.id ? optionActiveLabel : optionSetLabel}</em>
                    </button>
                  ))}
                </div>

                {advancedNativeOutputAvailable && outputMode === 'asio' ? (
                  <>
                    <div className="audio-drawer-section-title audio-drawer-section-title--compact">
                      <Zap size={17} />
                      <h3>{t('audioDrawer.buffer.asio')}</h3>
                    </div>
                    <div className="audio-drawer-mini-grid" aria-label={t('audioDrawer.buffer.asio')}>
                      {asioBufferOptions.map((option) => {
                        const isActive = option.value === null
                          ? currentAsioBufferFrames === null
                          : currentAsioBufferFrames === option.value;

                        return (
                          <button
                            className={`audio-device-pill ${isActive ? 'active' : ''}`}
                            type="button"
                            key={option.label}
                            disabled={isBusy}
                            onClick={() => void applyOutput({ bufferSizeFrames: option.value })}
                          >
                            <Zap size={15} />
                            <span>
                              <strong>{option.label}</strong>
                              <small>{option.detail}</small>
                            </span>
                            <em>{isActive ? optionActiveLabel : optionSetLabel}</em>
                          </button>
                        );
                      })}
                    </div>
                    <p>
                      {asioBufferStatusText}
                    </p>
                    <div className="audio-recommended-latency">
                      <div>
                        <span>{t('audioDrawer.asioLatency.recommended')}</span>
                        <strong>{recommendedLatencyText}</strong>
                      </div>
                      <p>{t('audioDrawer.asioLatency.description')}</p>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <label className="audio-toggle-row">
            <span>
              <RefreshCw size={17} />
              <strong>{t('audioDrawer.option.rememberOutput')}</strong>
            </span>
            <input
              type="checkbox"
              checked={rememberOutput}
              onChange={(event) => toggleRememberOutput(event.currentTarget.checked)}
            />
          </label>
          <p>{t('audioDrawer.option.rememberOutputDescription')}</p>

          <label className="audio-toggle-row">
            <span>
              <Lock size={17} />
              <strong>{t('audioDrawer.option.fixedVolume')}</strong>
            </span>
            <input
              type="checkbox"
              checked={fixedVolumeEnabled}
              onChange={(event) => void toggleFixedVolume(event.currentTarget.checked)}
            />
          </label>
          <p>{t('audioDrawer.option.fixedVolumeDescription')}</p>

          <button className="audio-diagnostics-copy-button" type="button" disabled={resetBusy || isBusy} onClick={() => void resetAudioEngine()}>
            <RefreshCw size={16} />
            <span>{resetBusy ? t('audioDrawer.action.resetEngineBusy') : resetMessage ?? t('audioDrawer.action.resetEngine')}</span>
          </button>

          <div className="audio-advanced-todo">
            <strong>{t('audioDrawer.todo.outputControls')}</strong>
            <span>{t('audioDrawer.todo.outputControlsDescription')}</span>
          </div>
            </div>
          ) : null}
        </section>

        {error ? <p className="audio-drawer-error">{error}</p> : null}

          <details className="audio-drawer-section audio-hidden-devices">
            <summary>
              <EyeOff size={17} />
              <span>{t('audioDrawer.section.hiddenDevices')}</span>
              <em>{hiddenDevices.length}</em>
            </summary>
            {hiddenDevices.length === 0 ? <p className="audio-drawer-empty">{t('audioDrawer.empty.hiddenDevices')}</p> : null}
            {hiddenDevices.map((device) => {
              const DeviceIcon = getDeviceIcon(device.name, device.outputMode);
              const sampleRate = formatRate(device.sharedDeviceSampleRate ?? device.sampleRate);

              return (
                <div className={`audio-hidden-device ${device.outputMode === 'asio' ? 'audio-hidden-device--asio' : ''}`} key={getDeviceStorageKey(device)}>
                  <DeviceIcon size={15} />
                  <span>
                    <strong title={device.name}>{device.name}</strong>
                    <small>{device.outputMode === 'asio' ? copy.asioDriver : t('audioDrawer.device.systemOutput')} / {sampleRate || t('audioDrawer.status.sampleRatePending')}</small>
                  </span>
                  <button type="button" onClick={() => restoreDevice(device)}>
                    {t('audioDrawer.action.restore')}
                  </button>
                </div>
              );
            })}
          </details>

          {advancedNativeOutputAvailable ? (
            <section className="audio-drawer-section audio-asio-panel-visibility">
              <label className="audio-toggle-row">
                <span>
                  <SlidersHorizontal size={17} />
                  <strong>{t('audioDrawer.option.showAsioPanelSettings')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={showAsioPanelSettings}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    setShowAsioPanelSettings(enabled);
                    writeShowAsioPanelSettings(enabled);
                  }}
                />
              </label>
              <p>{t('audioDrawer.option.showAsioPanelSettingsDescription')}</p>
            </section>
          ) : null}

          <section className="audio-drawer-section audio-drawer-troubleshooting">
            <div className="audio-drawer-section-title">
              <RefreshCw size={17} />
              <h3>{t('audioDrawer.troubleshooting.title')}</h3>
            </div>
            <p>{t('audioDrawer.troubleshooting.description')}</p>
            <div className="audio-drawer-troubleshooting__actions">
              <button
                className="audio-diagnostics-copy-button"
                type="button"
                disabled={forceRestartBusy || windowsAudioRestartBusy || isBusy}
                onClick={() => void forceRestartAudioEngine()}
              >
                <RefreshCw size={16} />
                <span>{forceRestartBusy ? t('audioDrawer.troubleshooting.softBusy') : t('audioDrawer.troubleshooting.softAction')}</span>
              </button>
              {windowsAudioServiceRestartAvailable ? (
                <button
                  className="audio-diagnostics-copy-button audio-diagnostics-copy-button--danger"
                  type="button"
                  disabled={forceRestartBusy || windowsAudioRestartBusy || isBusy}
                  onClick={() => void restartWindowsAudioService()}
                >
                  <Waves size={16} />
                  <span>{windowsAudioRestartBusy ? t('audioDrawer.troubleshooting.hardBusy') : t('audioDrawer.troubleshooting.hardAction')}</span>
                </button>
              ) : null}
            </div>
            {troubleshootingMessage ? <p className="audio-drawer-troubleshooting__message">{troubleshootingMessage}</p> : null}
          </section>

          {hqPlayerTakeoverEnabled ? (
            <section className="audio-professional-status audio-professional-status--drawer" aria-label={t('audioProfessional.title')}>
              <header className="audio-professional-status__header">
                <span className="audio-professional-status__icon">
                  <Cable size={18} />
                </span>
                <div>
                  <h3>{t('audioProfessional.title')}</h3>
                  <p>HQPlayer Connect / 外部渲染器 / ECHO 本机输出已释放</p>
                </div>
              </header>
              <div className="audio-professional-status__badges">
                <em data-tone="good">接管中</em>
                <em data-tone="neutral">外部输出</em>
              </div>
              <p className="audio-professional-status__issue" data-tone="warning">
                <strong>当前曲目</strong>
                <span>{formatHqPlayerTrackTitle(hqPlayerTrack)}</span>
              </p>
            </section>
          ) : (
            <AudioProfessionalStatusPanel status={status} />
          )}

          <div className="audio-professional-status-actions">
            <button className="audio-diagnostics-copy-button" type="button" onClick={() => void refresh()} disabled={isBusy}>
              <RefreshCw size={16} />
              <span>{t('audioProfessional.action.refresh')}</span>
            </button>
            <button className="audio-diagnostics-copy-button" type="button" onClick={() => void copyDiagnostics()}>
              <Clipboard size={16} />
              <span>{diagnosticsCopied ? copy.copiedDiagnostics : copy.copyDiagnostics}</span>
            </button>
          </div>
        </div>
      </aside>
      {hiddenDeviceMenu ? (
        <div
          className="audio-device-context-menu"
          role="menu"
          style={{ left: hiddenDeviceMenu.x, top: hiddenDeviceMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={() => hideDevice(hiddenDeviceMenu.device)}>
            <EyeOff size={14} />
            <span>{t('audioDrawer.action.hideDevice')}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
};
