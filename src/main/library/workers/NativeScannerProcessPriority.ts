import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants as osConstants, setPriority } from 'node:os';
import { logLibraryScanPerf } from '../../diagnostics/LibraryScanPerfDiagnostics';

const lowBackgroundPriority = osConstants.priority?.PRIORITY_LOW ?? 19;

export const lowerNativeScannerProcessPriority = (
  child: ChildProcessWithoutNullStreams,
  phase: 'nativeFileScanner' | 'nativeMetadataReader',
): void => {
  if (typeof child.pid !== 'number') {
    return;
  }

  try {
    setPriority(child.pid, lowBackgroundPriority);
    logLibraryScanPerf({
      phase,
      detail: `process_priority=low;pid=${child.pid}`,
    });
  } catch (error) {
    logLibraryScanPerf({
      phase,
      detail: `process_priority=unchanged;pid=${child.pid};error=${error instanceof Error ? error.message : String(error)}`,
    });
  }
};
