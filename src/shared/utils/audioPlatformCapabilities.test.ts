import { describe, expect, it } from 'vitest';
import {
  isAdvancedNativeOutputPlatform,
  isExclusiveNativeOutputPlatform,
  isNativeSharedOutputPlatform,
  normalizeAudioSharedBackendForPlatform,
  normalizeAudioOutputModeForPlatform,
} from './audioPlatformCapabilities';

describe('audio platform capabilities', () => {
  it('keeps Windows output modes unchanged', () => {
    expect(isAdvancedNativeOutputPlatform('win32')).toBe(true);
    expect(isNativeSharedOutputPlatform('win32')).toBe(true);
    expect(normalizeAudioOutputModeForPlatform('shared', 'win32')).toBe('shared');
    expect(normalizeAudioOutputModeForPlatform('exclusive', 'win32')).toBe('exclusive');
    expect(normalizeAudioSharedBackendForPlatform('auto', 'win32')).toBe('auto');
    expect(normalizeAudioSharedBackendForPlatform('windows', 'win32')).toBe('windows');
    expect(normalizeAudioSharedBackendForPlatform('directsound', 'win32')).toBe('directsound');
    expect(normalizeAudioSharedBackendForPlatform('alsa', 'win32')).toBe('auto');
  });

  it('allows Linux shared output and downgrades advanced output modes', () => {
    expect(isAdvancedNativeOutputPlatform('linux')).toBe(false);
    expect(isNativeSharedOutputPlatform('linux')).toBe(true);
    expect(normalizeAudioOutputModeForPlatform('shared', 'linux')).toBe('shared');
    expect(normalizeAudioOutputModeForPlatform('exclusive', 'linux')).toBe('shared');
    expect(normalizeAudioSharedBackendForPlatform('directsound', 'linux')).toBe('auto');
    expect(normalizeAudioSharedBackendForPlatform('windows', 'linux')).toBe('auto');
    expect(normalizeAudioSharedBackendForPlatform('alsa', 'linux')).toBe('alsa');
  });

  it('allows macOS shared output while keeping advanced modes unavailable', () => {
    expect(isAdvancedNativeOutputPlatform('darwin')).toBe(false);
    expect(isExclusiveNativeOutputPlatform('darwin')).toBe(true);
    expect(isNativeSharedOutputPlatform('darwin')).toBe(true);
    expect(normalizeAudioOutputModeForPlatform('shared', 'darwin')).toBe('shared');
    expect(normalizeAudioOutputModeForPlatform('exclusive', 'darwin')).toBe('exclusive');
    expect(normalizeAudioOutputModeForPlatform('asio', 'darwin')).toBe('shared');
    expect(normalizeAudioOutputModeForPlatform('system', 'darwin')).toBe('shared');
    expect(normalizeAudioSharedBackendForPlatform('alsa', 'darwin')).toBe('auto');
  });
});
