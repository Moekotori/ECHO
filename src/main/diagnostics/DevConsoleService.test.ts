import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error jsdom is a repo dev dependency, but its types are not installed here.
import { JSDOM } from 'jsdom';
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
import { clearDevConsole, createDevConsoleHtml, getDevConsoleSnapshot, recordPerformanceStall } from './DevConsoleService';
import { clearRuntimePerformanceDiagnosticsForTests, getRecentRuntimePerformanceStalls } from './RuntimePerformanceDiagnostics';

describe('DevConsoleService performance stalls', () => {
  beforeEach(() => {
    clearDevConsole();
    clearRuntimePerformanceDiagnosticsForTests();
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
      expect(getRecentRuntimePerformanceStalls(1)[0]).toMatchObject({
        source: 'main',
        kind: 'event_loop',
        durationMs: 1250,
        thresholdMs: 750,
        probableCause: 'main_background_task',
      });
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

  it('keeps controls alive when data-url storage is unavailable', async () => {
    const getSnapshot = vi.fn().mockResolvedValue({
      entries: [
        {
          id: 1,
          timestamp: '2026-05-29T00:00:00.000Z',
          source: 'system',
          level: 'info',
          message: 'Debug console opened.',
        },
        {
          id: 2,
          timestamp: '2026-05-29T00:00:01.000Z',
          source: 'renderer',
          level: 'warn',
          message: [
            '[performance:renderer] animation_frame stalled for 1000ms',
            'thresholdMs: 750',
            'probableCause: renderer_frame_gap',
            'confidence: low',
            'why: requestAnimationFrame gap exceeded the visible-frame threshold',
            'actionHint: Look for nearby renderer warnings, image/layout work, or a matching long_task entry.',
            'route: /',
            'audioState: paused',
            'audioMode: exclusive',
            'lastBackgroundTask: startup:ipc:sleepTimer',
            'lastBackgroundTaskMs: 0',
          ].join('\n'),
          details: {
            sourceId: 'animation_frame',
          },
        },
      ],
      maxEntries: 2500,
    });
    const onEntry = vi.fn();
    const dom = new JSDOM(createDevConsoleHtml(), {
      runScripts: 'dangerously',
      beforeParse(window: Window) {
        Object.defineProperty(window, 'echoDevConsole', {
          value: {
            getSnapshot,
            clear: vi.fn().mockResolvedValue(undefined),
            openDevTools: vi.fn().mockResolvedValue(undefined),
            onEntry,
          },
        });
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('localStorage blocked', 'SecurityError');
          },
        });
      },
    });

    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(dom.window.document.querySelector('.line')?.textContent).toContain('Debug console opened.');

    const language = dom.window.document.getElementById('language') as HTMLSelectElement;
    language.value = 'zh-CN';
    language.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    expect(dom.window.document.getElementById('consoleTitle')?.textContent).toBe('ECHO 调试控制台');
    expect(dom.window.document.getElementById('filter')?.getAttribute('placeholder')).toBe('搜索日志 / Ctrl+F');
    expect(dom.window.document.getElementById('performance')?.textContent).toBe('性能');
    expect(dom.window.document.getElementById('warnLabel')?.textContent).toBe('警告');
    const localizedDetails = Array.from(dom.window.document.querySelectorAll('.localized-detail')).map((node) => (node as Element).textContent);
    expect(localizedDetails).toContain('原因：渲染帧间隔过大');
    expect(localizedDetails).toContain('下一步：查看附近的渲染器警告、图片/布局工作，或相邻 long_task 记录。');
  });
});
