import { describe, expect, it, vi } from 'vitest';
import {
  UltraLightRestoreTimeline,
  ultraLightRendererStartupReadyTimeoutMs,
  waitForRendererStartupReady,
} from './ultraLightRestoreReadiness';

const createWebContents = (executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>) => ({
  isDestroyed: vi.fn(() => false),
  executeJavaScript: vi.fn(executeJavaScript),
});

describe('waitForRendererStartupReady', () => {
  it('waits for the startup overlay dismissal marker inside the renderer', async () => {
    const webContents = createWebContents(async () => true);

    await expect(waitForRendererStartupReady(webContents as never)).resolves.toBe(true);

    const [script] = webContents.executeJavaScript.mock.calls[0]!;
    expect(script).toContain("root.dataset.echoStartup === 'ready'");
    expect(script).toContain('MutationObserver');
    expect(script).toContain(String(ultraLightRendererStartupReadyTimeoutMs));
  });

  it('reports not ready on renderer failure or destruction instead of throwing', async () => {
    const failing = createWebContents(async () => {
      throw new Error('renderer gone');
    });
    await expect(waitForRendererStartupReady(failing as never)).resolves.toBe(false);

    const destroyed = createWebContents(async () => true);
    destroyed.isDestroyed.mockReturnValue(true);
    await expect(waitForRendererStartupReady(destroyed as never)).resolves.toBe(false);
    expect(destroyed.executeJavaScript).not.toHaveBeenCalled();
  });
});

describe('UltraLightRestoreTimeline', () => {
  it('reports durations relative to the restore request and keeps the first marks', () => {
    let nowMs = 1_000;
    const timeline = new UltraLightRestoreTimeline('manual', false, () => nowMs);

    nowMs = 1_400;
    timeline.markReadyToShow();
    nowMs = 1_500;
    timeline.markReadyToShow();
    timeline.recordWarmup({ durationMs: 120, libraryReaderWarmed: true, databaseMemoryRestored: true });
    nowMs = 2_300;
    timeline.markRendererReady(true);
    nowMs = 9_000;
    timeline.markRendererReady(false);

    expect(timeline.toLogFields()).toEqual({
      entryMode: 'manual',
      reusedWindow: false,
      readyToShowMs: 400,
      rendererReadyMs: 1_300,
      rendererReady: true,
      warmup: { durationMs: 120, libraryReaderWarmed: true, databaseMemoryRestored: true },
    });
  });

  it('leaves unmarked stages null', () => {
    const timeline = new UltraLightRestoreTimeline('tray-auto', true, () => 5);

    expect(timeline.toLogFields()).toEqual({
      entryMode: 'tray-auto',
      reusedWindow: true,
      readyToShowMs: null,
      rendererReadyMs: null,
      rendererReady: null,
      warmup: null,
    });
  });
});
