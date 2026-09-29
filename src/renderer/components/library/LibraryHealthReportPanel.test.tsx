// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryHealthReport } from '../../../shared/types/library';
import { LibraryHealthReportPanel } from './LibraryHealthReportPanel';

let libraryBridge: Record<string, unknown> | null = null;

vi.mock('../../utils/echoBridge', () => ({
  getLibraryBridge: () => libraryBridge,
}));

const makeReport = (overrides: Partial<LibraryHealthReport> = {}): LibraryHealthReport => ({
  generatedAt: '2026-05-20T12:00:00.000Z',
  summary: {
    songCount: 42,
    albumCount: 7,
    artistCount: 5,
    folderCount: 2,
    totalDuration: 3600,
    lastScanAt: '2026-05-20T11:00:00.000Z',
    warningCount: 1,
  },
  database: {
    status: 'ok',
    healthStatus: 'ok',
    recommendedAction: 'none',
    unrecoverableReason: null,
    canRestoreSnapshot: true,
    hasRunningScan: false,
    databaseSizeBytes: 4096,
    databasePath: { basename: 'echo-library.sqlite', pathHash: 'abc123456789' },
    latestHealthySnapshotId: 'snapshot-1',
    managerProtected: false,
    managerOpenConnections: 0,
    maintenanceInProgress: false,
  },
  scan: {
    status: 'completed',
    phase: 'finished',
    startedAt: '2026-05-20T10:00:00.000Z',
    finishedAt: '2026-05-20T11:00:00.000Z',
    discoveredCount: 42,
    parsedCount: 42,
    skippedCount: 0,
    coverCount: 40,
    errorCount: 1,
    performanceMode: 'balanced',
    metadataConcurrency: 2,
    coverConcurrency: 2,
    groupingRefreshQueued: false,
    lastGroupingRefreshError: null,
  },
  quality: [
    {
      kind: 'missing_cover',
      label: '缺封面',
      count: 3,
      severity: 'warning',
      description: '没有可用封面的本地歌曲。',
      actionAvailable: true,
      lastError: null,
    },
  ],
  cache: {
    generatedAt: '2026-05-20T12:00:00.000Z',
    totalSizeBytes: 2048,
    lastError: null,
    items: [
      {
        kind: 'cover',
        label: '封面缓存',
        path: { basename: 'covers', pathHash: 'def123456789' },
        sizeBytes: 2048,
        fileCount: 2,
        movable: true,
        reason: '可迁移',
        lastError: null,
      },
    ],
  },
  watcher: {
    enabled: false,
    running: false,
    autoRescanEnabled: false,
    watchedFolderCount: 2,
    pendingPathCount: 0,
    triggeredRescanCount: 0,
    skippedDeleteEventCount: 0,
    skippedRenameEventCount: 0,
    lastError: null,
    lastRescanError: null,
    lastTriggeredRescanAt: null,
  },
  remoteSources: {
    total: 1,
    enabled: 1,
    disabled: 0,
    error: 0,
    indexedTrackCount: 12,
    backgroundPaused: false,
    backgroundPlaybackActive: false,
    backgroundUpdatedAt: null,
    lastError: null,
    sources: [],
  },
  warnings: ['缓存清单: 权限不足'],
  ...overrides,
});

afterEach(() => {
  cleanup();
  libraryBridge = null;
  vi.restoreAllMocks();
});

describe('LibraryHealthReportPanel', () => {
  it('stays collapsed by default and refreshes a compact report when opened', async () => {
    const getHealthReport = vi.fn().mockResolvedValue(makeReport());
    libraryBridge = {
      getHealthReport,
    };

    render(<LibraryHealthReportPanel />);

    const toggle = screen.getByRole('button', { name: /曲库体检报告/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    await waitFor(() => expect(getHealthReport).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('42 首 · 1 个警告 · 3 个资料问题')).toBeTruthy();
    expect(screen.getByText('缓存清单: 权限不足')).toBeTruthy();
  });

  it('copies the safe summary and exports markdown through the library bridge', async () => {
    const getHealthReport = vi.fn().mockResolvedValue(makeReport());
    const exportHealthReport = vi.fn().mockResolvedValue('D:\\Exports\\health.md');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    libraryBridge = {
      getHealthReport,
      exportHealthReport,
    };

    render(<LibraryHealthReportPanel />);
    fireEvent.click(screen.getByRole('button', { name: /曲库体检报告/ }));
    await screen.findByText('42 首 · 1 个警告 · 3 个资料问题');

    fireEvent.click(screen.getByRole('button', { name: /复制摘要/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('曲库：42 首')));

    fireEvent.click(screen.getByRole('button', { name: /导出 Markdown/ }));
    await waitFor(() => expect(exportHealthReport).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/已导出/)).toBeTruthy();
  });
});
