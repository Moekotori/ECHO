import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticMemorySnapshot } from '../../shared/types/diagnostics';
import { createMemoryPressureConsoleSummary, shouldReleaseSoftMemoryPressure } from './MemoryPressureMonitor';

vi.mock('electron', () => ({
  app: {
    getAppMetrics: vi.fn(() => []),
    getVersion: vi.fn(() => '1.0.1-test'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

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
  });
});
