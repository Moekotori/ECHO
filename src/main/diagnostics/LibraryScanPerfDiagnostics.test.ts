import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLibraryScanPerfDiagnosticsEnabled, logLibraryScanPerf } from './LibraryScanPerfDiagnostics';

const previousScanPerfLogsEnv = process.env.ECHO_SCAN_PERF_LOGS;

const restoreScanPerfLogsEnv = (): void => {
  if (previousScanPerfLogsEnv === undefined) {
    delete process.env.ECHO_SCAN_PERF_LOGS;
    return;
  }
  process.env.ECHO_SCAN_PERF_LOGS = previousScanPerfLogsEnv;
};

describe('LibraryScanPerfDiagnostics', () => {
  afterEach(() => {
    restoreScanPerfLogsEnv();
    vi.restoreAllMocks();
  });

  it('keeps scan perf logs disabled unless explicitly enabled', () => {
    delete process.env.ECHO_SCAN_PERF_LOGS;
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    expect(isLibraryScanPerfDiagnosticsEnabled()).toBe(false);
    logLibraryScanPerf({ jobId: 'job-1', phase: 'discoverFiles', durationMs: 12 });

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('logs scan perf phases when explicitly enabled', () => {
    process.env.ECHO_SCAN_PERF_LOGS = '1';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    expect(isLibraryScanPerfDiagnosticsEnabled()).toBe(true);
    logLibraryScanPerf({ jobId: 'job-1', phase: 'discoverFiles', durationMs: 12, fileCount: 34 });

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[library-scan-perf] jobId=job-1 phase=discoverFiles durationMs=12 fileCount=34'));
  });
});
