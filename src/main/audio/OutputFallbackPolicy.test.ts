import { describe, expect, it, vi } from 'vitest';
import type { AudioOutputSettings, AudioSharedBackend } from '../../shared/types/audio';
import {
  createOutputFallbackSettingsPolicy,
  hasExplicitDeviceSelection,
  isAutomaticDirectSoundFallbackError,
  isDefaultDeviceFallbackAllowed,
  isOutputStartRetryMode,
  isSharedFallbackAllowedForExclusive,
} from './OutputFallbackPolicy';

describe('OutputFallbackPolicy', () => {
  it('detects explicit device selection without owning device state', () => {
    expect(hasExplicitDeviceSelection({})).toBe(false);
    expect(hasExplicitDeviceSelection({ deviceIndex: 0 })).toBe(true);
    expect(hasExplicitDeviceSelection({ deviceName: 'Studio DAC' })).toBe(true);
  });

  it('keeps retry and fallback permissions fail-closed', () => {
    expect(isOutputStartRetryMode('shared')).toBe(true);
    expect(isOutputStartRetryMode('exclusive')).toBe(true);
    expect(isOutputStartRetryMode('asio')).toBe(false);
    expect(isOutputStartRetryMode('system')).toBe(false);
    expect(isSharedFallbackAllowedForExclusive({})).toBe(false);
    expect(isDefaultDeviceFallbackAllowed({})).toBe(false);
    expect(isSharedFallbackAllowedForExclusive({ exclusiveInstabilityFallbackEnabled: true })).toBe(true);
    expect(isDefaultDeviceFallbackAllowed({ defaultDeviceFallbackEnabled: true })).toBe(true);
  });

  it('creates the same shared, safe-shared, and DirectSound fallback settings', () => {
    const normalizeSharedBackend = vi.fn((_value: unknown): AudioSharedBackend => 'windows');
    const policy = createOutputFallbackSettingsPolicy(normalizeSharedBackend);
    const settings: AudioOutputSettings = {
      outputMode: 'exclusive',
      sharedBackend: 'auto',
      deviceIndex: 7,
      deviceName: 'Studio DAC',
      requestedOutputSampleRate: 192_000,
      latencyProfile: 'lowLatency',
      bufferSizeFrames: 256,
      useMiniaudioOutput: true,
      dsdOutputMode: 'dop',
      volume: 0.75,
    };

    expect(policy.createSharedFallbackSettings(settings)).toEqual({
      ...settings,
      outputMode: 'shared',
      sharedBackend: 'windows',
      requestedOutputSampleRate: undefined,
      useMiniaudioOutput: false,
      dsdOutputMode: 'pcm',
    });
    expect(policy.createSafeSharedFallbackSettings(settings)).toEqual({
      ...settings,
      outputMode: 'shared',
      sharedBackend: 'windows',
      deviceIndex: undefined,
      deviceName: undefined,
      requestedOutputSampleRate: undefined,
      latencyProfile: 'stable',
      bufferSizeFrames: undefined,
      useMiniaudioOutput: false,
      dsdOutputMode: 'pcm',
    });
    expect(policy.createAutomaticDirectSoundFallbackSettings(settings)).toEqual({
      ...settings,
      outputMode: 'shared',
      sharedBackend: 'directsound',
      deviceIndex: undefined,
      deviceName: undefined,
      requestedOutputSampleRate: undefined,
      latencyProfile: 'stable',
      bufferSizeFrames: undefined,
      useMiniaudioOutput: false,
      dsdOutputMode: 'pcm',
      automaticOutputEnabled: true,
    });
    expect(normalizeSharedBackend).toHaveBeenCalledWith('windows');
  });

  it('only classifies known device-start failures for automatic DirectSound fallback', () => {
    expect(isAutomaticDirectSoundFallbackError(new Error('device_initialize_timeout'))).toBe(true);
    expect(isAutomaticDirectSoundFallbackError(new Error('AUDCLNT_E_DEVICE_INVALIDATED'))).toBe(true);
    expect(isAutomaticDirectSoundFallbackError(new Error('no output device'))).toBe(true);
    expect(isAutomaticDirectSoundFallbackError(new Error('access violation 0xc0000005'))).toBe(false);
    expect(isAutomaticDirectSoundFallbackError(new Error('decoder failed'))).toBe(false);
  });
});
