// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticPerformanceStallPayload } from '../../shared/types/diagnostics';
import { startPerformanceStallMonitor, stopPerformanceStallMonitorForTests } from './performanceStallMonitor';

type FrameCallback = FrameRequestCallback;

const reportPerformanceStall = vi.fn(async (_payload: DiagnosticPerformanceStallPayload) => undefined);
let frameCallbacks: FrameCallback[] = [];

const runNextFrame = (timestamp: number): void => {
  const callback = frameCallbacks.shift();
  expect(callback).toBeTruthy();
  callback?.(timestamp);
};

describe('performanceStallMonitor', () => {
  beforeEach(() => {
    frameCallbacks = [];
    reportPerformanceStall.mockClear();
    window.history.replaceState({}, '', '/library?tab=songs#now');
    window.echo = {
      diagnostics: {
        reportPerformanceStall,
      },
    } as unknown as typeof window.echo;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn((callback: FrameCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn(),
    });
    document.body.innerHTML = '<button id="play" class="primary action" aria-label="Play"></button>';
  });

  afterEach(() => {
    stopPerformanceStallMonitorForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('reports renderer frame stalls with route and recent input context', async () => {
    startPerformanceStallMonitor();

    const button = document.getElementById('play') as HTMLButtonElement;
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    runNextFrame(100);
    runNextFrame(900);
    await Promise.resolve();

    expect(reportPerformanceStall).toHaveBeenCalledTimes(1);
    const payload = reportPerformanceStall.mock.calls[0][0];
    expect(payload).toMatchObject({
      source: 'renderer',
      kind: 'animation_frame',
      durationMs: 800,
      thresholdMs: 750,
      windowKind: 'main',
    });
    expect(payload.details).toMatchObject({
      route: '/library?tab=songs#now',
      visibilityState: 'visible',
      documentFocused: true,
      activeElement: expect.stringContaining('button#play'),
      lastInputType: 'keydown',
      lastInputTarget: expect.stringContaining('button#play'),
      lastFrameGapMs: 800,
    });
    expect(payload.details?.lastInputAgeMs).toEqual(expect.any(Number));
  });
});
