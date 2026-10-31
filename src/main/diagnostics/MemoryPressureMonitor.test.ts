import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticMemorySnapshot } from '../../shared/types/diagnostics';
import {
  checkMemoryPressureNow,
  createMemoryPressureConsoleSummary,
  resetMemoryPressureMonitorForTests,
  shouldReleaseSoftMemoryPressure,
} from './MemoryPressureMonitor';

const testMocks = vi.hoisted(() => ({
  appMetrics: vi.fn<() => Array<Record<string, unknown>>>(() => []),
  reportMemoryPressure: vi.fn(),
  releaseSoftMemoryPressure: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getAppMetrics: testMocks.appMetrics,
    getVersion: vi.fn(() => '1.0.1-test'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('./CrashReportService', () => ({
  createMemoryPressureEventFromSnapshot: (snapshot: DiagnosticMemorySnapshot, reportPath: string) => ({
    timestamp: snapshot.timestamp,
    thresholdBytes: snapshot.thresholdBytes,
    totalWorkingSetBytes: snapshot.totalWorkingSetBytes,
    totalPrivateBytes: snapshot.totalPrivateBytes,
    processCount: snapshot.processCount,
    topProcessType: snapshot.topProcesses[0]?.type ?? 'unknown',
    topProcessWorkingSetBytes: snapshot.topProcesses[0]?.workingSetBytes ?? 0,
    reportPath,
    graphicsPressure: null,
  }),
  getCrashReportService: () => ({
    getLogger: () => null,
    reportMemoryPressure: testMocks.reportMemoryPressure,
  }),
}));

vi.mock('./SoftMemoryJanitor', () => ({
  createSoftMemoryCleanupLogFields: vi.fn(() => ({})),
  releaseSoftMemoryPressure: testMocks.releaseSoftMemoryPressure,
}));

afterEach(() => {
  resetMemoryPressureMonitorForTests();
  testMocks.appMetrics.mockReset().mockReturnValue([]);
  testMocks.reportMemoryPressure.mockReset();
  testMocks.releaseSoftMemoryPressure.mockReset();
});

const makeSnapshot = (overrides: Partial<DiagnosticMemorySnapshot> = {}): DiagnosticMemorySnapshot => ({
  timestamp: '2026-06-30T12:00:00.000Z',
  thresholdBytes: 3 * 1024 * 1024 * 1024,
  totalWorkingSetBytes: 3_700_000_000,
  totalPrivateBytes: 3_100_000_000,
  processCount: 1,
  source: 'electron-app-metrics',
  currentProcess: {
    pid: 100,
    rssBytes: 400_000_000,
    heapTotalBytes: 120_000_000,
    heapUsedBytes: 80_000_000,
    externalBytes: 20_000_000,
    arrayBuffersBytes: 10_000_000,
  },
  metrics: [
    {
      pid: 220,
      type: 'Tab',
      name: 'renderer',
      workingSetBytes: 3_300_000_000,
      peakWorkingSetBytes: 3_400_000_000,
      privateBytes: 2_900_000_000,
      cpuPercent: 3,
    },
  ],
  topProcesses: [
    {
      pid: 220,
      type: 'Tab',
      name: 'renderer',
      workingSetBytes: 3_300_000_000,
      peakWorkingSetBytes: 3_400_000_000,
      privateBytes: 2_900_000_000,
      cpuPercent: 3,
    },
  ],
  appVersion: '1.0.1-test',
  platform: 'win32',
  arch: 'x64',
  ...overrides,
});

describe('createMemoryPressureConsoleSummary', () => {
  it('classifies high renderer JS heap and lyrics DOM pressure for console output', () => {
    const summary = createMemoryPressureConsoleSummary(makeSnapshot({
      rendererProcesses: [
        {
          timestamp: '2026-06-30T12:00:00.000Z',
          pid: 220,
          windowId: 1,
          windowKind: 'main',
          route: 'lyrics',
          process: {
            type: 'Tab',
            name: 'renderer',
            workingSetBytes: 3_300_000_000,
            privateBytes: 2_900_000_000,
            peakWorkingSetBytes: 3_400_000_000,
            cpuPercent: 3,
          },
          heap: {
            usedJSHeapSize: 700_000_000,
            totalJSHeapSize: 850_000_000,
            jsHeapSizeLimit: 4_000_000_000,
          },
          dom: {
            nodeCount: 60_000,
            elementCount: 40_000,
            textNodeCount: 19_000,
            documentWidth: 1200,
            documentHeight: 900,
          },
          selectors: {
            lyricsLines: 2_100,
            lyricWordNodes: 6_500,
          },
        },
      ],
    }), 'D:\\reports\\memory-pressure-report.md');

    expect(summary.likelyCause).toBe('renderer-js-heap-retention');
    expect(summary.dominantRenderer).toMatchObject({
      pid: 220,
      route: 'lyrics',
      windowKind: 'main',
    });
    expect(summary.evidence.join('\n')).toContain('renderer JS heap high');
    expect(summary.evidence.join('\n')).toContain('lyrics DOM pressure');
    expect(summary.reportPath).toBe('D:\\reports\\memory-pressure-report.md');
  });
});

describe('shouldReleaseSoftMemoryPressure', () => {
  it('requires sustained soft-threshold samples', () => {
    expect(shouldReleaseSoftMemoryPressure([
      { totalWorkingSetBytes: 99 },
      { totalWorkingSetBytes: 101 },
    ], 100)).toBe(false);

    expect(shouldReleaseSoftMemoryPressure([
      { totalWorkingSetBytes: 100 },
      { totalWorkingSetBytes: 101 },
    ], 100)).toBe(true);

    expect(shouldReleaseSoftMemoryPressure([
      { totalWorkingSetBytes: 70, totalPrivateBytes: 110 },
      { totalWorkingSetBytes: 75, totalPrivateBytes: 105 },
    ], 100)).toBe(true);
  });

  it('keeps sampling and releases caches after the first hard-pressure report', async () => {
    testMocks.appMetrics.mockReturnValue([{
      pid: 220,
      type: 'Tab',
      name: 'renderer',
      memory: {
        workingSetSize: 4 * 1024 * 1024,
        peakWorkingSetSize: 4 * 1024 * 1024,
        privateBytes: 4 * 1024 * 1024,
      },
      cpu: { percentCPUUsage: 0, idleWakeupsPerSecond: 0 },
    }]);
    testMocks.reportMemoryPressure.mockReturnValue({
      timestamp: '2026-06-30T12:00:00.000Z',
      thresholdBytes: 3 * 1024 * 1024 * 1024,
      totalWorkingSetBytes: 4 * 1024 * 1024 * 1024,
      processCount: 1,
      topProcessType: 'Tab',
      topProcessWorkingSetBytes: 4 * 1024 * 1024 * 1024,
      reportPath: 'memory-pressure-report.md',
    });
    testMocks.releaseSoftMemoryPressure.mockResolvedValue({
      ran: false,
      skipped: true,
      skippedReason: 'empty',
      cooldownHit: false,
      cooldownRemainingMs: 0,
      startedAtMs: 0,
      finishedAtMs: 0,
      taskCount: 0,
      removedEntries: 0,
      tasks: [],
      errors: [],
      errorCount: 0,
      reason: 'sustained-soft-memory-pressure',
    });

    expect(await checkMemoryPressureNow()).not.toBeNull();
    await expect(checkMemoryPressureNow()).resolves.toMatchObject({
      reportPath: 'memory-pressure-report.md',
    });

    await vi.waitFor(() => expect(testMocks.releaseSoftMemoryPressure).toHaveBeenCalledTimes(1));
    expect(testMocks.reportMemoryPressure).toHaveBeenCalledTimes(1);
  });
});
