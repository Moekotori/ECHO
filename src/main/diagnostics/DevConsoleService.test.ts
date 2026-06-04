import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticPerformanceStallPayload } from '../../shared/types/diagnostics';

vi.mock('electron', () => ({
  app: {
    getPath: () => 'D:\\ECHO\\UserData',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock('./ExceptionRecorder', () => ({
  recordDiagnosticConsoleProblem: vi.fn(),
}));

import { beginMainBackgroundTask } from './PlaybackPerformanceDiagnostics';
import { clearDevConsole, getDevConsoleSnapshot, recordPerformanceStall } from './DevConsoleService';

describe('DevConsoleService performance stalls', () => {
  beforeEach(() => {
    clearDevConsole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds a probable cause and action hint to stall logs', () => {
    const clearBackgroundTask = beginMainBackgroundTask('data-protection:snapshot');
    const payload: DiagnosticPerformanceStallPayload = {
      source: 'main',
      kind: 'event_loop',
      durationMs: 1250,
      thresholdMs: 750,
      timestamp: '2026-05-29T00:00:00.000Z',
      details: {
        expectedIntervalMs: 1000,
      },
    };

    try {
      const entry = recordPerformanceStall(payload, {
        state: 'idle',
        outputMode: 'system',
      });

      expect(entry?.message).toContain('probableCause: main_background_task');
      expect(entry?.message).toContain('why: main event loop stalled while data-protection:snapshot was active');
      expect(entry?.message).toContain('actionHint: Move or slice this background task');
      const latest = getDevConsoleSnapshot().entries.slice(-1)[0];
      expect(latest?.message).toBe(entry?.message);
    } finally {
      clearBackgroundTask();
    }
  });

  it('uses a recent completed main background task to explain delayed stall logs', () => {
    const base = Date.now() + 20_000;
    let now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const clearBackgroundTask = beginMainBackgroundTask('database:open:echo-library.sqlite');
    now = base + 2_400;
    clearBackgroundTask();
    now = base + 2_650;

    const entry = recordPerformanceStall(
      {
        source: 'main',
        kind: 'event_loop',
        durationMs: 2200,
        thresholdMs: 750,
        timestamp: '2026-05-29T00:00:02.650Z',
        details: {
          expectedIntervalMs: 1000,
        },
      },
      {
        state: 'paused',
        outputMode: 'shared',
      },
    );

    expect(entry?.message).toContain('probableCause: recent_main_background_task');
    expect(entry?.message).toContain('why: database:open:echo-library.sqlite recently took 2400ms');
    expect(entry?.message).toContain('lastBackgroundTask: database:open:echo-library.sqlite');
    expect(entry?.message).toContain('lastBackgroundTaskMs: 2400');
  });
});
