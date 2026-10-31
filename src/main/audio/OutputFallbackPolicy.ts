import type {
  AudioOutputMode,
  AudioOutputSettings,
  AudioSharedBackend,
} from '../../shared/types/audio';

type NormalizeSharedBackend = (value: unknown) => AudioSharedBackend;

export const hasExplicitDeviceSelection = (settings: AudioOutputSettings): boolean =>
  Number.isInteger(Number(settings.deviceIndex)) || Boolean(settings.deviceName);

export const isOutputStartRetryMode = (mode: AudioOutputMode): boolean =>
  mode === 'shared' || mode === 'exclusive';

export const isSharedFallbackAllowedForExclusive = (settings: AudioOutputSettings): boolean =>
  settings.exclusiveInstabilityFallbackEnabled === true;

export const isDefaultDeviceFallbackAllowed = (settings: AudioOutputSettings): boolean =>
  settings.defaultDeviceFallbackEnabled === true;

export const isAutomaticDirectSoundFallbackError = (error: Error): boolean =>
  /device_initialize_timeout|timeout_waiting_for_ready|AUDCLNT_E_DEVICE_INVALIDATED|AUDCLNT_E_ENDPOINT_CREATE_FAILED|AUDCLNT_E_UNSUPPORTED_FORMAT|device (?:is )?(?:unavailable|invalidated|removed|not found|disappeared)|no output device|default audio endpoint/iu.test(
    error.message,
  );

export const createOutputFallbackSettingsPolicy = (
  normalizeSharedBackend: NormalizeSharedBackend,
) => {
  const createSharedFallbackSettings = (settings: AudioOutputSettings): AudioOutputSettings => ({
    ...settings,
    outputMode: 'shared',
    sharedBackend: normalizeSharedBackend('windows'),
    requestedOutputSampleRate: undefined,
    useMiniaudioOutput: false,
    dsdOutputMode: 'pcm',
  });

  const createSafeSharedFallbackSettings = (settings: AudioOutputSettings): AudioOutputSettings => ({
    ...settings,
    outputMode: 'shared',
    sharedBackend: normalizeSharedBackend('windows'),
    deviceIndex: undefined,
    deviceName: undefined,
    requestedOutputSampleRate: undefined,
    latencyProfile: 'stable',
    bufferSizeFrames: undefined,
    useMiniaudioOutput: false,
    dsdOutputMode: 'pcm',
  });

  const createAutomaticDirectSoundFallbackSettings = (settings: AudioOutputSettings): AudioOutputSettings => ({
    ...createSafeSharedFallbackSettings(settings),
    sharedBackend: 'directsound',
    automaticOutputEnabled: true,
  });

  return {
    createSharedFallbackSettings,
    createSafeSharedFallbackSettings,
    createAutomaticDirectSoundFallbackSettings,
  };
};
