import { describe, expect, it, vi } from 'vitest';
import { createAudioBackend } from './BackendFactory';
import { DaemonAudioBackend } from './DaemonAudioBackend';
import { JsonRpcBridge } from './JsonRpcBridge';
import type { AudioOutputSettings } from '../../shared/types/audio';

const defaultOutputSettings: AudioOutputSettings = {
  outputMode: 'shared',
  volume: 1,
};

const configuredDevice = {
  accepted: true,
  changed: false,
  deviceOpened: false,
  outputMode: 'shared' as const,
  deviceId: '',
  deviceIndex: -1,
  deviceName: '',
  sampleRate: 48_000,
  channels: 2,
  bufferSize: 2048,
  sharedBackend: 'system',
};

describe('BackendFactory.createAudioBackend', () => {
  it('returns a DaemonAudioBackend when jrpc is active', async () => {
    const jrpc = new JsonRpcBridge();
    const configureDevice = vi.spyOn(jrpc, 'configureDevice').mockResolvedValue(configuredDevice);
    try {
      const backend = await createAudioBackend({
        jrpc,
        deviceId: '',
        outputSettings: defaultOutputSettings,
      });
      expect(backend).toBeInstanceOf(DaemonAudioBackend);
      expect(backend).not.toBeNull();
      expect(configureDevice).toHaveBeenCalledWith(expect.objectContaining({ deviceId: '', outputMode: 'shared' }));
    } finally {
      jrpc.removeAllListeners();
    }
  });

  it('returns null when jrpc is null', async () => {
    const backend = await createAudioBackend({
      jrpc: null,
      deviceId: '',
      outputSettings: defaultOutputSettings,
    });
    expect(backend).toBeNull();
  });

  it('returns null when jrpc is closed', async () => {
    const jrpc = new JsonRpcBridge();
    await jrpc.close();
    const backend = await createAudioBackend({
      jrpc,
      deviceId: '',
      outputSettings: defaultOutputSettings,
    });
    expect(backend).toBeNull();
  });

  it('calls configureDevice when deviceId is provided and jrpc is active', async () => {
    const jrpc = new JsonRpcBridge();
    const configureDevice = vi.spyOn(jrpc, 'configureDevice').mockResolvedValue({
      ...configuredDevice,
      deviceId: 'test-device',
    });
    try {
      const backend = await createAudioBackend({
        jrpc,
        deviceId: 'test-device',
        outputSettings: defaultOutputSettings,
      });
      expect(backend).toBeInstanceOf(DaemonAudioBackend);
      expect(configureDevice).toHaveBeenCalledWith(expect.objectContaining({
        deviceId: 'test-device',
        outputMode: 'shared',
        channels: 2,
      }));
    } finally {
      jrpc.removeAllListeners();
    }
  });
});
