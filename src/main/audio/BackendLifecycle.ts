import type { AudioBackend } from './AudioBackend';
import type { JsonRpcBridge } from './JsonRpcBridge';
import type { DaemonAudioBackend } from './DaemonAudioBackend';

export type BackendLifecycleReason =
  | 'daemon_freshness.bridge_missing'
  | 'daemon_freshness.bridge_closed'
  | 'daemon_freshness.bridge_identity_changed'
  | 'daemon_freshness.bridge_matching_current'
  | 'daemon_freshness.non_daemon_backend_present'
  | 'eq_sync.rpc_bridge_not_open';

export interface BackendFreshnessDecision {
  readonly reason: BackendLifecycleReason;
  readonly reusable: boolean;
  readonly shouldDisposeCachedDaemon: boolean;
}

const RECOVERABLE_LIFECYCLE_ERROR_PATTERN = /\b(?:eq_control_(?:closed|disconnected)|rpc_bridge_not_open)\b/u;

export const isBridgeUsable = (jrpc: JsonRpcBridge | null): jrpc is JsonRpcBridge =>
  jrpc !== null && jrpc.isClosed !== true && typeof jrpc.openFile === 'function';

export const isDaemonBackendFresh = (
  jrpc: JsonRpcBridge | null,
  backend: AudioBackend | null,
): BackendFreshnessDecision => {
  if (backend === null) {
    return {
      reason: jrpc?.isClosed === true
        ? 'daemon_freshness.bridge_closed'
        : 'daemon_freshness.bridge_missing',
      reusable: false,
      shouldDisposeCachedDaemon: false,
    };
  }

  if (backend.capabilities?.daemon !== true) {
    return {
      reason: 'daemon_freshness.non_daemon_backend_present',
      reusable: true,
      shouldDisposeCachedDaemon: false,
    };
  }

  const daemon = backend as DaemonAudioBackend;

  if (jrpc === null) {
    return {
      reason: 'daemon_freshness.bridge_missing',
      reusable: false,
      shouldDisposeCachedDaemon: true,
    };
  }

  if (daemon.isBridgeClosed || jrpc.isClosed === true) {
    return {
      reason: 'daemon_freshness.bridge_closed',
      reusable: false,
      shouldDisposeCachedDaemon: true,
    };
  }

  if (!daemon.isBoundToBridge(jrpc)) {
    return {
      reason: 'daemon_freshness.bridge_identity_changed',
      reusable: false,
      shouldDisposeCachedDaemon: true,
    };
  }

  return {
    reason: 'daemon_freshness.bridge_matching_current',
    reusable: true,
    shouldDisposeCachedDaemon: false,
  };
};

export const classifyRecoverableLifecycleError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);

  return RECOVERABLE_LIFECYCLE_ERROR_PATTERN.test(message);
};

export type LifecycleErrorContext = 'eq_sync' | 'general';

export const isRecoverableInEqSyncContext = (
  error: unknown,
  context?: LifecycleErrorContext,
): boolean => {
  if (context === 'general') {
    // rpc_bridge_not_open is a transport-level error and should not be
    // treated as recoverable in general (non-EQ-sync) contexts.
    const message = error instanceof Error ? error.message : String(error);
    if (/\brpc_bridge_not_open\b/u.test(message)) return false;
  }
  return classifyRecoverableLifecycleError(error);
};
