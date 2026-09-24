import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants as osConstants, setPriority } from 'node:os';
import { logLibraryScanPerf } from '../../diagnostics/LibraryScanPerfDiagnostics';

export type NativeScannerProcessPriorityMode = 'low' | 'balanced' | 'performance' | 'ultra';

const processPriorityByMode: Record<NativeScannerProcessPriorityMode, number> = {
  low: osConstants.priority?.PRIORITY_LOW ?? 19,
  balanced: osConstants.priority?.PRIORITY_BELOW_NORMAL ?? 10,
  performance: osConstants.priority?.PRIORITY_NORMAL ?? 0,
  ultra: osConstants.priority?.PRIORITY_NORMAL ?? 0,
};

export const setNativeScannerProcessPriority = (
  child: ChildProcessWithoutNullStreams,
  phase: 'nativeFileScanner' | 'nativeMetadataReader',
  mode: NativeScannerProcessPriorityMode,
): boolean => {
  if (typeof child.pid !== 'number') {
    return false;
  }

  try {
    setPriority(child.pid, processPriorityByMode[mode]);
    logLibraryScanPerf({
      phase,
      detail: `process_priority=${mode};pid=${child.pid};value=${processPriorityByMode[mode]}`,
    });
    return true;
  } catch (error) {
    logLibraryScanPerf({
      phase,
      detail: `process_priority=unchanged;requested=${mode};pid=${child.pid};error=${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
};

export const lowerNativeScannerProcessPriority = (
  child: ChildProcessWithoutNullStreams,
  phase: 'nativeFileScanner' | 'nativeMetadataReader',
): void => {
  setNativeScannerProcessPriority(child, phase, 'low');
};
