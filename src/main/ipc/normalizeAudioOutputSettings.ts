import { normalizeAudioOutputModeForPlatform, normalizeAudioSharedBackendForPlatform } from '../../shared/utils/audioPlatformCapabilities';
import {
  audioEchoSrcComputeBackends,
  audioEchoSrcFilterProfiles,
  audioEchoSrcModes,
  audioEchoSrcQualityProfiles,
  audioPcmDitherModes,
  audioSdmComputeBackends,
  audioSdmModes,
  audioSdmQualityProfiles,
  audioSdmTargetRates,
  type AudioBackendContractVersion,
  type AudioLatencyProfile,
  type AudioOutputMode,
  type AudioOutputSettings,
  type AudioSharedBackend,
  type PlaybackSpeedMode,
} from '../../shared/types/audio';

const outputModes = new Set<AudioOutputMode>(['shared', 'exclusive', 'asio', 'system']);
const sharedBackends = new Set<AudioSharedBackend>(['auto', 'windows', 'directsound', 'alsa']);
const latencyProfiles = new Set<AudioLatencyProfile>(['stable', 'balanced', 'lowLatency']);
const playbackSpeedModes = new Set<PlaybackSpeedMode>(['nightcore', 'daycore', 'speed']);

const hasValue = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

const copyBoolean = <K extends keyof AudioOutputSettings>(
  input: Record<string, unknown>,
  output: AudioOutputSettings,
  key: K,
): void => {
  if (typeof input[key] === 'boolean') {
    output[key] = input[key] as AudioOutputSettings[K];
  }
};

/**
 * Renderer-facing output settings validator shared by both audio IPC entry
 * points. Keep this an explicit allow-list: output settings influence native
 * device routing and must not be copied from an untrusted IPC payload blindly.
 */
export const normalizeAudioOutputSettings = (
  value: unknown,
  platform: NodeJS.Platform = process.platform,
): AudioOutputSettings | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const output: AudioOutputSettings = {};

  if (input.backendContractVersion === 2) {
    output.backendContractVersion = input.backendContractVersion as AudioBackendContractVersion;
  }

  copyBoolean(input, output, 'automaticOutputEnabled');

  if (typeof input.outputMode === 'string' && outputModes.has(input.outputMode as AudioOutputMode)) {
    output.outputMode = normalizeAudioOutputModeForPlatform(input.outputMode as AudioOutputMode, platform);
  }

  if (typeof input.sharedBackend === 'string' && sharedBackends.has(input.sharedBackend as AudioSharedBackend)) {
    output.sharedBackend = normalizeAudioSharedBackendForPlatform(input.sharedBackend as AudioSharedBackend, platform);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'deviceIndex') && input.deviceIndex == null) {
    output.deviceIndex = undefined;
  } else if (typeof input.deviceIndex === 'number' && Number.isInteger(input.deviceIndex)) {
    output.deviceIndex = input.deviceIndex;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'deviceName') && input.deviceName == null) {
    output.deviceName = undefined;
  } else if (typeof input.deviceName === 'string' && input.deviceName.trim()) {
    output.deviceName = input.deviceName;
  }

  if (
    typeof input.requestedOutputSampleRate === 'number' &&
    Number.isFinite(input.requestedOutputSampleRate) &&
    input.requestedOutputSampleRate > 0
  ) {
    output.requestedOutputSampleRate = Math.round(input.requestedOutputSampleRate);
  }

  if (typeof input.latencyProfile === 'string' && latencyProfiles.has(input.latencyProfile as AudioLatencyProfile)) {
    output.latencyProfile = input.latencyProfile as AudioLatencyProfile;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'bufferSizeFrames')) {
    output.bufferSizeFrames =
      typeof input.bufferSizeFrames === 'number' && Number.isFinite(input.bufferSizeFrames) && input.bufferSizeFrames > 0
        ? Math.round(input.bufferSizeFrames)
        : null;
  }

  copyBoolean(input, output, 'useNativeOutput');
  copyBoolean(input, output, 'useMiniaudioOutput');
  copyBoolean(input, output, 'useLibavDecode');
  copyBoolean(input, output, 'nativeDirectLocalPlaybackEnabled');

  if (input.dsdOutputMode === 'dop' || input.dsdOutputMode === 'pcm') {
    output.dsdOutputMode = input.dsdOutputMode;
  }

  if (hasValue(audioSdmModes, input.sdmMode)) output.sdmMode = input.sdmMode;
  if (hasValue(audioSdmTargetRates, input.sdmTargetRate)) output.sdmTargetRate = input.sdmTargetRate;
  if (hasValue(audioSdmQualityProfiles, input.sdmQualityProfile)) output.sdmQualityProfile = input.sdmQualityProfile;
  if (hasValue(audioSdmComputeBackends, input.sdmComputeBackend)) output.sdmComputeBackend = input.sdmComputeBackend;
  if (hasValue(audioEchoSrcFilterProfiles, input.sdmOversamplingFilterProfile1x)) {
    output.sdmOversamplingFilterProfile1x = input.sdmOversamplingFilterProfile1x;
  }
  if (hasValue(audioEchoSrcFilterProfiles, input.sdmOversamplingFilterProfileNx)) {
    output.sdmOversamplingFilterProfileNx = input.sdmOversamplingFilterProfileNx;
  }

  copyBoolean(input, output, 'exclusiveInstabilityFallbackEnabled');
  copyBoolean(input, output, 'defaultDeviceFallbackEnabled');
  copyBoolean(input, output, 'soxrFallbackEnabled');

  if (hasValue(audioEchoSrcModes, input.echoSrcMode)) output.echoSrcMode = input.echoSrcMode;
  if (hasValue(audioEchoSrcQualityProfiles, input.echoSrcQualityProfile)) {
    output.echoSrcQualityProfile = input.echoSrcQualityProfile;
  }
  copyBoolean(input, output, 'echoSrcAdvancedModeEnabled');
  if (hasValue(audioEchoSrcFilterProfiles, input.echoSrcFilterProfile)) {
    output.echoSrcFilterProfile = input.echoSrcFilterProfile;
  }
  if (hasValue(audioEchoSrcFilterProfiles, input.echoSrcFilterProfile1x)) {
    output.echoSrcFilterProfile1x = input.echoSrcFilterProfile1x;
  }
  if (hasValue(audioEchoSrcFilterProfiles, input.echoSrcFilterProfileNx)) {
    output.echoSrcFilterProfileNx = input.echoSrcFilterProfileNx;
  }
  if (hasValue(audioEchoSrcComputeBackends, input.echoSrcComputeBackend)) {
    output.echoSrcComputeBackend = input.echoSrcComputeBackend;
  }
  if (hasValue(audioPcmDitherModes, input.pcmDitherMode)) output.pcmDitherMode = input.pcmDitherMode;
  copyBoolean(input, output, 'releaseExclusiveOnPauseExperimentalEnabled');

  if (typeof input.volume === 'number' && Number.isFinite(input.volume)) {
    output.volume = Math.max(0, Math.min(1, input.volume));
  }

  if (typeof input.playbackRate === 'number' && Number.isFinite(input.playbackRate)) {
    output.playbackRate = Math.max(0.5, Math.min(2, input.playbackRate));
  }

  if (typeof input.playbackSpeedMode === 'string' && playbackSpeedModes.has(input.playbackSpeedMode as PlaybackSpeedMode)) {
    output.playbackSpeedMode = input.playbackSpeedMode as PlaybackSpeedMode;
  }

  return output;
};

export const requireAudioOutputSettings = (value: unknown): AudioOutputSettings => {
  const normalized = normalizeAudioOutputSettings(value);
  if (!normalized) {
    throw new Error('audio output settings must be an object');
  }
  return normalized;
};
