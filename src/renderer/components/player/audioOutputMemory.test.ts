// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutputSettings, readRememberedAudioOutput, resolveSupportedLatencyProfile, writeRememberedAudioOutput } from './audioOutputMemory';

vi.mock('../../utils/echoBridge', () => ({
  getAppBridge: () => undefined,
}));

beforeEach(() => {
  window.localStorage.clear();
});

describe('audioOutputMemory', () => {
  it('defaults empty output memory to system audio', () => {
    expect(readRememberedAudioOutput()).toMatchObject({
      enabled: false,
      outputMode: 'system',
      sharedBackend: 'auto',
      latencyProfile: 'balanced',
    });
  });

  it('keeps low latency supported for WASAPI exclusive output', () => {
    expect(resolveSupportedLatencyProfile('exclusive', 'lowLatency')).toBe('lowLatency');
    expect(createOutputSettings('exclusive', null, 'lowLatency')).toMatchObject({
      outputMode: 'exclusive',
      latencyProfile: 'lowLatency',
    });
  });

  it('persists WASAPI exclusive low-latency output memory', () => {
    writeRememberedAudioOutput({
      enabled: true,
      outputMode: 'exclusive',
      latencyProfile: 'lowLatency',
      deviceIndex: 2,
      deviceName: 'USB DAC',
    });

    expect(readRememberedAudioOutput()).toMatchObject({
      enabled: true,
      outputMode: 'exclusive',
      latencyProfile: 'lowLatency',
      deviceIndex: 2,
      deviceName: 'USB DAC',
    });
  });

  it('persists explicit ASIO output channel selection', () => {
    writeRememberedAudioOutput({
      enabled: true,
      outputMode: 'asio',
      latencyProfile: 'balanced',
      deviceIndex: 0,
      deviceName: 'ASIO4ALL v2',
      asioOutputChannelStart: 2,
    });

    expect(readRememberedAudioOutput()).toMatchObject({
      enabled: true,
      outputMode: 'asio',
      deviceIndex: 0,
      deviceName: 'ASIO4ALL v2',
      asioOutputChannelStart: 2,
    });

    expect(createOutputSettings('asio', {
      id: 'asio:0:route:2',
      index: 0,
      name: 'ASIO4ALL v2',
      outputMode: 'asio',
      sampleRate: null,
      sharedDeviceSampleRate: null,
      isDefault: false,
      asioOutputChannelStart: 2,
    })).toMatchObject({
      outputMode: 'asio',
      deviceIndex: 0,
      deviceName: 'ASIO4ALL v2',
      asioOutputChannelStart: 2,
    });
  });

  it('persists DirectSound shared backend and omits device index when creating output settings', () => {
    writeRememberedAudioOutput({
      enabled: true,
      outputMode: 'shared',
      sharedBackend: 'directsound',
      latencyProfile: 'stable',
      deviceIndex: 4,
      deviceName: 'USB DAC',
    });

    expect(readRememberedAudioOutput()).toMatchObject({
      enabled: true,
      outputMode: 'shared',
      sharedBackend: 'directsound',
      latencyProfile: 'stable',
      deviceIndex: 4,
      deviceName: 'USB DAC',
    });

    expect(createOutputSettings('shared', {
      id: 'shared:4',
      index: 4,
      name: 'USB DAC',
      outputMode: 'shared',
      sampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      isDefault: false,
    }, 'stable', 'directsound')).toMatchObject({
      outputMode: 'shared',
      sharedBackend: 'directsound',
      latencyProfile: 'stable',
      deviceName: 'USB DAC',
    });
    expect(createOutputSettings('shared', {
      id: 'shared:4',
      index: 4,
      name: 'USB DAC',
      outputMode: 'shared',
      sampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      isDefault: false,
    }, 'stable', 'directsound')).not.toHaveProperty('deviceIndex');
  });

  it('persists ALSA shared backend and keeps device index when creating Linux output settings', () => {
    writeRememberedAudioOutput({
      enabled: true,
      outputMode: 'shared',
      sharedBackend: 'alsa',
      latencyProfile: 'stable',
      deviceIndex: 2,
      deviceName: 'ALSA Default',
    });

    expect(readRememberedAudioOutput()).toMatchObject({
      enabled: true,
      outputMode: 'shared',
      sharedBackend: 'alsa',
      latencyProfile: 'stable',
      deviceIndex: 2,
      deviceName: 'ALSA Default',
    });

    expect(createOutputSettings('shared', {
      id: 'shared:2',
      index: 2,
      name: 'ALSA Default',
      outputMode: 'shared',
      sampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      isDefault: true,
    }, 'stable', 'alsa')).toMatchObject({
      outputMode: 'shared',
      sharedBackend: 'alsa',
      latencyProfile: 'stable',
      deviceIndex: 2,
      deviceName: 'ALSA Default',
    });
  });

  it('sanitizes incompatible low-latency buffer sizes in local output memory', () => {
    window.localStorage.setItem(
      'echo-next.audio-output-memory',
      JSON.stringify({
        enabled: true,
        outputMode: 'shared',
        sharedBackend: 'auto',
        latencyProfile: 'lowLatency',
        bufferSizeFrames: 8192,
      }),
    );

    expect(readRememberedAudioOutput()).not.toHaveProperty('bufferSizeFrames');

    writeRememberedAudioOutput({
      enabled: true,
      outputMode: 'shared',
      sharedBackend: 'auto',
      latencyProfile: 'lowLatency',
      bufferSizeFrames: 8192,
    });
    expect(JSON.parse(window.localStorage.getItem('echo-next.audio-output-memory') ?? '{}')).not.toHaveProperty('bufferSizeFrames');

    writeRememberedAudioOutput({
      enabled: true,
      outputMode: 'asio',
      latencyProfile: 'lowLatency',
      bufferSizeFrames: 8192,
    });
    expect(JSON.parse(window.localStorage.getItem('echo-next.audio-output-memory') ?? '{}')).toMatchObject({
      outputMode: 'asio',
      latencyProfile: 'lowLatency',
      bufferSizeFrames: 2048,
    });

    writeRememberedAudioOutput({
      enabled: true,
      outputMode: 'shared',
      sharedBackend: 'auto',
      latencyProfile: 'stable',
      bufferSizeFrames: 8192,
    });
    expect(JSON.parse(window.localStorage.getItem('echo-next.audio-output-memory') ?? '{}')).toMatchObject({
      outputMode: 'shared',
      latencyProfile: 'stable',
      bufferSizeFrames: 8192,
    });
  });
});
