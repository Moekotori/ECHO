import { describe, expect, it } from 'vitest';
import type { AudioBackend, ProbeResult } from './AudioBackend';
import {
  classifyRecoverableLifecycleError,
  isBridgeUsable,
  isDaemonBackendFresh,
  isRecoverableInEqSyncContext,
  type LifecycleErrorContext,
} from './BackendLifecycle';
import { DaemonAudioBackend } from './DaemonAudioBackend';
import { JsonRpcBridge } from './JsonRpcBridge';

const createBridge = (): JsonRpcBridge => new JsonRpcBridge();

const closeBridge = async (bridge: JsonRpcBridge): Promise<JsonRpcBridge> => {
  await bridge.close();
  return bridge;
};

const createNonDaemonBackend = (): AudioBackend => ({
  capabilities: { daemon: false, exclusiveMode: false },
  start: async () => {},
  openFile: async (filePath: string): Promise<ProbeResult> => ({
    status: 'probed',
    filePath,
    sampleRate: 48000,
    channels: 2,
    durationSeconds: 1,
    codec: 'pcm',
    container: 'wav',
  }),
  pause: async () => {},
  resume: async () => {},
  seek: async () => {},
  stop: async () => {},
  getPositionSeconds: () => 0,
  onPosition: () => {},
  onEnded: () => {},
  onError: () => {},
  dispose: () => {},
});

describe('BackendLifecycle daemon freshness decisions', () => {
  it('rejects cached daemon backend when the active bridge is missing', () => {
    const backend = new DaemonAudioBackend(createBridge());

    expect(isDaemonBackendFresh(null, backend)).toEqual({
      reason: 'daemon_freshness.bridge_missing',
      reusable: false,
      shouldDisposeCachedDaemon: true,
    });
  });

  it('rejects cached daemon backend when its bridge is closed', async () => {
    const bridge = await closeBridge(createBridge());
    const backend = new DaemonAudioBackend(bridge);

    expect(isDaemonBackendFresh(bridge, backend)).toEqual({
      reason: 'daemon_freshness.bridge_closed',
      reusable: false,
      shouldDisposeCachedDaemon: true,
    });
  });

  it('rejects cached daemon backend when active bridge identity changed', () => {
    const backend = new DaemonAudioBackend(createBridge());

    expect(isDaemonBackendFresh(createBridge(), backend)).toEqual({
      reason: 'daemon_freshness.bridge_identity_changed',
      reusable: false,
      shouldDisposeCachedDaemon: true,
    });
  });

  it('reuses cached daemon backend bound to the current open bridge', () => {
    const bridge = createBridge();
    const backend = new DaemonAudioBackend(bridge);

    expect(isDaemonBackendFresh(bridge, backend)).toEqual({
      reason: 'daemon_freshness.bridge_matching_current',
      reusable: true,
      shouldDisposeCachedDaemon: false,
    });
  });

  it('preserves an existing non-daemon backend without daemon bridge checks', () => {
    expect(isDaemonBackendFresh(null, createNonDaemonBackend())).toEqual({
      reason: 'daemon_freshness.non_daemon_backend_present',
      reusable: true,
      shouldDisposeCachedDaemon: false,
    });
  });

  it('reports a null cached backend as unavailable without requesting disposal', () => {
    expect(isDaemonBackendFresh(createBridge(), null)).toEqual({
      reason: 'daemon_freshness.bridge_missing',
      reusable: false,
      shouldDisposeCachedDaemon: false,
    });
  });
});

describe('BackendLifecycle bridge usability', () => {
  it('rejects a missing bridge', () => {
    expect(isBridgeUsable(null)).toBe(false);
  });

  it('rejects a closed bridge that still has openFile', async () => {
    expect(isBridgeUsable(await closeBridge(createBridge()))).toBe(false);
  });

  it('rejects a closed bridge without openFile', () => {
    expect(isBridgeUsable({ isClosed: true } as JsonRpcBridge)).toBe(false);
  });

  it('accepts an open bridge with openFile', () => {
    expect(isBridgeUsable(createBridge())).toBe(true);
  });
});

describe('BackendLifecycle recoverable lifecycle errors', () => {
  it('matches eq_control_closed errors', () => {
    expect(classifyRecoverableLifecycleError(new Error('eq_control_closed'))).toBe(true);
  });

  it('matches eq_control_disconnected errors', () => {
    expect(classifyRecoverableLifecycleError('native: eq_control_disconnected')).toBe(true);
  });

  it('matches rpc_bridge_not_open errors', () => {
    expect(classifyRecoverableLifecycleError(new Error('rpc_bridge_not_open'))).toBe(true);
  });

  it('rejects unrelated lifecycle errors', () => {
    expect(classifyRecoverableLifecycleError(new Error('decoder_failed'))).toBe(false);
  });

  it('keeps an EQ sync context seam with the same current classification (default eq_sync context)', () => {
    expect(isRecoverableInEqSyncContext(new Error('rpc_bridge_not_open'))).toBe(true);
    expect(isRecoverableInEqSyncContext(new Error('decoder_failed'))).toBe(false);
  });

  it('rpc_bridge_not_open is recoverable in eq_sync context', () => {
    expect(isRecoverableInEqSyncContext(
      new Error('rpc_bridge_not_open'),
      'eq_sync',
    )).toBe(true);
  });

  it('rpc_bridge_not_open is NOT recoverable in general context', () => {
    expect(isRecoverableInEqSyncContext(
      new Error('rpc_bridge_not_open'),
      'general',
    )).toBe(false);
  });

  it('eq_control_closed is recoverable in both contexts', () => {
    const error = new Error('eq_control_closed');
    expect(isRecoverableInEqSyncContext(error, 'eq_sync')).toBe(true);
    expect(isRecoverableInEqSyncContext(error, 'general')).toBe(true);
  });
});
