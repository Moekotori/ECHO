import { DaemonAudioBackend } from './DaemonAudioBackend';
import type { JsonRpcBridge } from './JsonRpcBridge';
import type { AudioOutputSettings } from '../../shared/types/audio';

export interface BackendFactoryConfig {
  jrpc: JsonRpcBridge | null;
  deviceId: string;
  outputSettings: AudioOutputSettings;
}

export async function createAudioBackend(config: BackendFactoryConfig): Promise<DaemonAudioBackend | null> {
  const { jrpc, deviceId, outputSettings } = config;
  if (!jrpc || jrpc.isClosed) {
    return null;
  }
  const backend = new DaemonAudioBackend(jrpc);
  if (deviceId) {
    await backend.configureDevice?.(deviceId, outputSettings).catch(() => {});
  }
  return backend;
}
