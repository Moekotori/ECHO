export type LibraryScanPerfContext = {
  jobId?: string | null;
  folderId?: string | null;
  phase?: string | null;
  fileCount?: number | null;
  batchSize?: number | null;
};

export type LibraryScanPerfLogPayload = LibraryScanPerfContext & {
  durationMs?: number;
  detail?: string;
};

const scanPerfLogPrefix = '[library-scan-perf]';
const recentScanPerfContextTtlMs = 30_000;

export const isLibraryScanPerfDiagnosticsEnabled = (): boolean => {
  return process.env.ECHO_SCAN_PERF_LOGS === '1';
};

let activeScanPerfContext: LibraryScanPerfContext | null = null;
let recentScanPerfContext: LibraryScanPerfContext | null = null;
let recentScanPerfContextAtMs = 0;

export const setActiveLibraryScanPerfContext = (context: LibraryScanPerfContext | null): void => {
  if (context) {
    activeScanPerfContext = { ...context };
    recentScanPerfContext = { ...context };
    recentScanPerfContextAtMs = Date.now();
    return;
  }

  activeScanPerfContext = null;
};

export const getActiveLibraryScanPerfContext = (): LibraryScanPerfContext | null =>
  activeScanPerfContext
    ? { ...activeScanPerfContext }
    : recentScanPerfContext && Date.now() - recentScanPerfContextAtMs <= recentScanPerfContextTtlMs
    ? { ...recentScanPerfContext }
    : null;

export const logLibraryScanPerf = (payload: LibraryScanPerfLogPayload): void => {
  if (!isLibraryScanPerfDiagnosticsEnabled()) {
    return;
  }

  const parts = [
    `jobId=${payload.jobId ?? activeScanPerfContext?.jobId ?? 'unknown'}`,
    `phase=${payload.phase ?? activeScanPerfContext?.phase ?? 'unknown'}`,
  ];
  const folderId = payload.folderId ?? activeScanPerfContext?.folderId;
  if (folderId) {
    parts.push(`folderId=${folderId}`);
  }
  if (typeof payload.durationMs === 'number') {
    parts.push(`durationMs=${Math.round(payload.durationMs)}`);
  }
  if (typeof payload.fileCount === 'number') {
    parts.push(`fileCount=${payload.fileCount}`);
  }
  if (typeof payload.batchSize === 'number') {
    parts.push(`batchSize=${payload.batchSize}`);
  }
  if (payload.detail) {
    parts.push(`detail=${payload.detail}`);
  }

  console.info(`${scanPerfLogPrefix} ${parts.join(' ')}`);
};

export const shouldDisableScanGuardForDiagnostics = (): boolean => process.env.ECHO_DISABLE_SCAN_GUARD === '1';

export const shouldDisableScanHealthCheckForDiagnostics = (): boolean => process.env.ECHO_DISABLE_SCAN_HEALTH_CHECK === '1';

export const shouldCheckpointScanHealthForDiagnostics = (): boolean => process.env.ECHO_SCAN_HEALTH_CHECKPOINT === '1';

export const shouldRunScanHealthCheckSynchronouslyForDiagnostics = (): boolean =>
  process.env.ECHO_SYNC_SCAN_HEALTH_CHECK === '1';
