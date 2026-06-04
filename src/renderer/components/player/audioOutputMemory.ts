import type { AudioDeviceInfo, AudioLatencyProfile, AudioOutputMode, AudioOutputSettings, AudioSharedBackend } from '../../../shared/types/audio';
import type { RememberedAudioOutput } from '../../../shared/types/appSettings';
import { getAppBridge } from '../../utils/echoBridge';

const storageKey = 'echo-next.audio-output-memory';
const lowLatencyMaxBufferSizeFrames = 2048;
const defaultRememberedAudioOutput: RememberedAudioOutput = {
  enabled: true,
  outputMode: 'system',
  sharedBackend: 'auto',
  latencyProfile: 'balanced',
};
const defaultLocalRememberedAudioOutput: RememberedAudioOutput = {
  ...defaultRememberedAudioOutput,
  enabled: false,
};

export const resolveSupportedLatencyProfile = (
  _outputMode: AudioOutputMode,
  latencyProfile: AudioLatencyProfile,
): AudioLatencyProfile => {
  return latencyProfile;
};

export const normalizeSharedBackend = (value: unknown): AudioSharedBackend =>
  value === 'windows' || value === 'directsound' || value === 'alsa' ? value : 'auto';

const sanitizeBufferSizeFrames = (
  outputMode: AudioOutputMode,
  latencyProfile: AudioLatencyProfile,
  bufferSizeFrames: unknown,
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

const readStoredRememberedAudioOutput = (): Partial<RememberedAudioOutput> | null => {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as Partial<RememberedAudioOutput>;
};

const normalizeRememberedAudioOutput = (
  value: Partial<RememberedAudioOutput> | null | undefined,
  fallback: RememberedAudioOutput = defaultRememberedAudioOutput,
): RememberedAudioOutput => {
  const raw = value ?? fallback;
  const outputMode =
    raw.outputMode === 'shared' || raw.outputMode === 'exclusive' || raw.outputMode === 'asio' || raw.outputMode === 'system'
      ? raw.outputMode
      : fallback.outputMode;
  const sharedBackend = normalizeSharedBackend(raw.sharedBackend);
  const latencyProfile: AudioLatencyProfile =
    raw.latencyProfile === 'stable' || raw.latencyProfile === 'balanced' || raw.latencyProfile === 'lowLatency'
      ? raw.latencyProfile
      : (fallback.latencyProfile ?? defaultRememberedAudioOutput.latencyProfile ?? 'balanced');
  const supportedLatencyProfile = resolveSupportedLatencyProfile(outputMode, latencyProfile);
  const remembered: RememberedAudioOutput = {
    ...raw,
    enabled: raw.enabled === true,
    outputMode,
    sharedBackend,
    latencyProfile: supportedLatencyProfile,
    deviceIndex: Number.isInteger(Number(raw.deviceIndex)) ? Number(raw.deviceIndex) : undefined,
    deviceName: typeof raw.deviceName === 'string' && raw.deviceName.trim() ? raw.deviceName : undefined,
    asioOutputChannelStart: outputMode === 'asio' && Number.isInteger(Number(raw.asioOutputChannelStart)) && Number(raw.asioOutputChannelStart) >= 0
      ? Number(raw.asioOutputChannelStart)
      : undefined,
  };

  const bufferSizeFrames = sanitizeBufferSizeFrames(outputMode, supportedLatencyProfile, raw.bufferSizeFrames);
  if (bufferSizeFrames !== undefined) {
    remembered.bufferSizeFrames = bufferSizeFrames;
  } else {
    delete remembered.bufferSizeFrames;
  }

  return remembered;
};

export const readRememberedAudioOutput = (): RememberedAudioOutput => {
  try {
    return normalizeRememberedAudioOutput(readStoredRememberedAudioOutput(), defaultLocalRememberedAudioOutput);
  } catch {
    return { ...defaultLocalRememberedAudioOutput };
  }
};

export const writeRememberedAudioOutput = (settings: RememberedAudioOutput): void => {
  const latencyProfile = settings.latencyProfile ?? 'balanced';
  const sanitized = {
    ...settings,
    latencyProfile,
    bufferSizeFrames: sanitizeBufferSizeFrames(settings.outputMode, latencyProfile, settings.bufferSizeFrames),
  };
  if (sanitized.bufferSizeFrames === undefined) {
    delete sanitized.bufferSizeFrames;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(sanitized));
  void getAppBridge()?.setSettings({ rememberedAudioOutput: sanitized }).catch(() => undefined);
};

export const loadPersistedRememberedAudioOutput = async (): Promise<RememberedAudioOutput> => {
  const appBridge = getAppBridge();
  const localRaw = (() => {
    try {
      return readStoredRememberedAudioOutput();
    } catch {
      return null;
    }
  })();
  const localOutput = normalizeRememberedAudioOutput(localRaw, defaultLocalRememberedAudioOutput);

  if (!appBridge) {
    return localRaw === null ? { ...defaultRememberedAudioOutput } : localOutput;
  }

  const settings = await appBridge.getSettings();
  const shouldPromoteLegacyLocalOutput = localRaw !== null && (settings.appMemoryVersion ?? 0) < 1 && localOutput.enabled;
  const rawRemembered = shouldPromoteLegacyLocalOutput
    ? localOutput
    : (settings.rememberedAudioOutput ?? defaultRememberedAudioOutput);
  const remembered = normalizeRememberedAudioOutput(rawRemembered);
  window.localStorage.setItem(storageKey, JSON.stringify(remembered));

  if (shouldPromoteLegacyLocalOutput) {
    void appBridge.setSettings({ rememberedAudioOutput: remembered }).catch(() => undefined);
  }

  return remembered;
};

export const createOutputSettings = (
  outputMode: AudioOutputMode,
  device: AudioDeviceInfo | null,
  latencyProfile: AudioLatencyProfile = 'balanced',
  sharedBackend: AudioSharedBackend = 'auto',
): AudioOutputSettings => {
  const normalizedSharedBackend = outputMode === 'shared' ? normalizeSharedBackend(sharedBackend) : 'auto';
  const settings: AudioOutputSettings = {
    outputMode,
    latencyProfile: resolveSupportedLatencyProfile(outputMode, latencyProfile),
  };

  if (outputMode === 'shared') {
    settings.sharedBackend = normalizedSharedBackend;
  }

  if (device) {
    if (normalizedSharedBackend !== 'directsound') {
      settings.deviceIndex = device.index;
    }
    settings.deviceName = device.name;
    if (outputMode === 'asio' && Number.isInteger(Number(device.asioOutputChannelStart)) && Number(device.asioOutputChannelStart) >= 0) {
      settings.asioOutputChannelStart = Number(device.asioOutputChannelStart);
    }
  } else {
    settings.deviceIndex = undefined;
    settings.deviceName = undefined;
  }

  return settings;
};
