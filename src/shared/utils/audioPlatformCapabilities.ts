import type { AudioOutputMode, AudioSharedBackend } from '../types/audio';

export const isAdvancedNativeOutputPlatform = (platform: string): boolean => platform === 'win32';

export const isNativeSharedOutputPlatform = (platform: string): boolean => platform === 'win32' || platform === 'linux';

export const normalizeAudioOutputModeForPlatform = (
  outputMode: AudioOutputMode,
  platform: string,
): AudioOutputMode => {
  if (outputMode === 'system') {
    return 'system';
  }

  return isAdvancedNativeOutputPlatform(platform) ? outputMode : 'shared';
};

export const normalizeAudioSharedBackendForPlatform = (
  sharedBackend: AudioSharedBackend | undefined,
  platform: string,
): AudioSharedBackend => {
  if (platform === 'win32') {
    return sharedBackend === 'windows' || sharedBackend === 'directsound' ? sharedBackend : 'auto';
  }

  if (platform === 'linux') {
    return sharedBackend === 'alsa' ? 'alsa' : 'auto';
  }

  return 'auto';
};

export const detectRendererPlatform = (navigatorLike: Pick<Navigator, 'platform' | 'userAgent'>): NodeJS.Platform | 'unknown' => {
  const platform = `${navigatorLike.platform} ${navigatorLike.userAgent}`.toLocaleLowerCase();

  if (platform.includes('win')) {
    return 'win32';
  }

  if (platform.includes('linux')) {
    return 'linux';
  }

  if (platform.includes('mac')) {
    return 'darwin';
  }

  return 'unknown';
};
