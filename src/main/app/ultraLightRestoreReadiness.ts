import type { WebContents } from 'electron';

export const ultraLightRendererStartupReadyTimeoutMs = 15_000;

/**
 * Resolves once the recreated renderer has dismissed its startup overlay
 * (`data-echo-startup="ready"`), i.e. the app shell is mounted and the first
 * stable frame has painted. Falls back to `false` on timeout or when the
 * renderer disappears, so callers can still proceed with degraded timing.
 */
const waitForRendererStartupReadyScript = (timeoutMs: number): string => `(() => new Promise((resolve) => {
  const root = document.documentElement;
  const isReady = () => root.dataset.echoStartup === 'ready';
  if (isReady()) {
    resolve(true);
    return;
  }
  let timer = null;
  const observer = new MutationObserver(() => {
    if (!isReady()) return;
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
    resolve(true);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-echo-startup'] });
  timer = setTimeout(() => {
    observer.disconnect();
    resolve(false);
  }, ${Math.max(0, Math.trunc(timeoutMs))});
}))()`;

export const waitForRendererStartupReady = async (
  webContents: WebContents,
  timeoutMs = ultraLightRendererStartupReadyTimeoutMs,
): Promise<boolean> => {
  if (webContents.isDestroyed()) return false;
  try {
    const ready = await webContents.executeJavaScript(waitForRendererStartupReadyScript(timeoutMs), true);
    return ready === true;
  } catch {
    return false;
  }
};

export type UltraLightRestoreWarmupFields = {
  durationMs: number;
  libraryReaderWarmed: boolean;
  databaseMemoryRestored: boolean;
};

export type UltraLightRestoreTimelineFields = {
  entryMode: string | null;
  reusedWindow: boolean;
  readyToShowMs: number | null;
  rendererReadyMs: number | null;
  rendererReady: boolean | null;
  warmup: UltraLightRestoreWarmupFields | null;
};

/** Wall-clock markers for one UltraLight restore, relative to the restore request. */
export class UltraLightRestoreTimeline {
  private readonly startedAtMs: number;
  private readyToShowAtMs: number | null = null;
  private rendererReadyAtMs: number | null = null;
  private rendererReady: boolean | null = null;
  private warmup: UltraLightRestoreWarmupFields | null = null;

  constructor(
    private readonly entryMode: string | null,
    private readonly reusedWindow: boolean,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAtMs = now();
  }

  markReadyToShow(): void {
    this.readyToShowAtMs ??= this.now();
  }

  markRendererReady(ready: boolean): void {
    if (this.rendererReadyAtMs !== null) return;
    this.rendererReadyAtMs = this.now();
    this.rendererReady = ready;
  }

  recordWarmup(warmup: UltraLightRestoreWarmupFields): void {
    this.warmup = { ...warmup };
  }

  toLogFields(): UltraLightRestoreTimelineFields {
    return {
      entryMode: this.entryMode,
      reusedWindow: this.reusedWindow,
      readyToShowMs: this.readyToShowAtMs === null ? null : this.readyToShowAtMs - this.startedAtMs,
      rendererReadyMs: this.rendererReadyAtMs === null ? null : this.rendererReadyAtMs - this.startedAtMs,
      rendererReady: this.rendererReady,
      warmup: this.warmup,
    };
  }
}
