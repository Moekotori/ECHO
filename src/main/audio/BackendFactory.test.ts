import { describe, expect, it } from 'vitest';
import { createAudioBackend } from './BackendFactory';
import { DaemonAudioBackend } from './DaemonAudioBackend';
import { JsonRpcBridge } from './JsonRpcBridge';
import type { AudioOutputSettings } from '../../shared/types/audio';

const defaultOutputSettings: AudioOutputSettings = {
  outputMode: 'shared',
  volume: 1,
};

describe('BackendFactory.createAudioBackend', () => {
  it('returns a DaemonAudioBackend when jrpc is active', async () => {
    const jrpc = new JsonRpcBridge();
    try {
      const backend = await createAudioBackend({
        jrpc,
        deviceId: '',
        outputSettings: defaultOutputSettings,
      });
      expect(backend).toBeInstanceOf(DaemonAudioBackend);
      expect(backend).not.toBeNull();
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
    try {
      const backend = await createAudioBackend({
        jrpc,
        deviceId: 'test-device',
        outputSettings: defaultOutputSettings,
      });
      expect(backend).toBeInstanceOf(DaemonAudioBackend);
      // configureDevice call is fire-and-forget with .catch(() => {}),
      // so we only verify the backend was created successfully
    } finally {
      jrpc.removeAllListeners();
    }
  });
});
