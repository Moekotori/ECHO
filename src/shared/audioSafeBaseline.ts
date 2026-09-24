import type { AppSettings } from './types/appSettings';
import type { AudioOutputSettings } from './types/audio';

export const safeAudioDspAppSettingsPatch = {
  audioDsdOutputMode: 'pcm',
  audioSdmMode: 'off',
  audioSdmTargetRate: 'dsd128',
  audioSdmQualityProfile: 'safe',
  audioSdmComputeBackend: 'cpu',
  audioSdmOversamplingFilterProfile1x: 'sinc-long',
  audioSdmOversamplingFilterProfileNx: 'poly-sinc-hb',
  audioEchoSrcMode: 'off',
  audioEchoSrcQualityProfile: 'transparent',
  audioEchoSrcAdvancedModeEnabled: false,
  audioEchoSrcFilterProfile: 'poly-sinc-gauss-long',
  audioEchoSrcFilterProfile1x: 'poly-sinc-gauss-long',
  audioEchoSrcFilterProfileNx: 'poly-sinc-hb',
  audioEchoSrcComputeBackend: 'cpu',
  audioPcmDitherMode: 'off',
} satisfies Partial<AppSettings>;

export const safeAudioDspOutputSettings = {
  dsdOutputMode: 'pcm',
  sdmMode: 'off',
  sdmTargetRate: 'dsd128',
  sdmQualityProfile: 'safe',
  sdmComputeBackend: 'cpu',
  sdmOversamplingFilterProfile1x: 'sinc-long',
  sdmOversamplingFilterProfileNx: 'poly-sinc-hb',
  echoSrcMode: 'off',
  echoSrcQualityProfile: 'transparent',
  echoSrcAdvancedModeEnabled: false,
  echoSrcFilterProfile: 'poly-sinc-gauss-long',
  echoSrcFilterProfile1x: 'poly-sinc-gauss-long',
  echoSrcFilterProfileNx: 'poly-sinc-hb',
  echoSrcComputeBackend: 'cpu',
  pcmDitherMode: 'off',
} satisfies AudioOutputSettings;

export const safeAudioResetOutputSettings = {
  automaticOutputEnabled: false,
  outputMode: 'shared',
  sharedBackend: 'auto',
  latencyProfile: 'balanced',
  bufferSizeFrames: null,
  useNativeOutput: false,
  useMiniaudioOutput: false,
  useLibavDecode: false,
  nativeDirectLocalPlaybackEnabled: false,
  ...safeAudioDspOutputSettings,
  exclusiveInstabilityFallbackEnabled: false,
  soxrFallbackEnabled: true,
  releaseExclusiveOnPauseExperimentalEnabled: false,
} satisfies AudioOutputSettings;
