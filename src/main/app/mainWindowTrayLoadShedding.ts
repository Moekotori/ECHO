import type { BrowserWindow } from 'electron';
import { getAppSettings } from './appSettings';
import { acquireBackgroundPauseLease, configureBackgroundPauseLeaseApplier, releaseBackgroundPauseLease } from './backgroundPauseLeases';
import { releaseSoftMemoryPressure } from '../diagnostics/SoftMemoryJanitor';
import { setDefaultRemoteSourceBackgroundParked } from '../library/remote/RemoteSourceService';
import { trayBackgroundResumeDelayMs } from '../../shared/performance/trayLoadShedding';

configureBackgroundPauseLeaseApplier(setDefaultRemoteSourceBackgroundParked);

export const releaseDefaultBackgroundMemory = (
  reason: string,
  _options?: { cleanupScope?: string },
) => releaseSoftMemoryPressure({ reason, cooldownMs: 5_000 });

/** Bind one window lifetime. The service owns playback safety and restore races. */
export const bindMainWindowTrayLoadShedding = (window: BrowserWindow): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const clearTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const backgrounded = (): boolean => !window.isDestroyed() && (!window.isVisible() || window.isMinimized());
  const report = (error: unknown): void => console.warn('[UltraLightMode] background transition failed', error);
  const park = (): void => {
    clearTimer();
    const enabled = getAppSettings().ultraLightOnMinimizeOrTrayEnabled === true;
    timer = setTimeout(() => {
      timer = null;
      if (disposed || !backgrounded()) return;
      void (async () => {
        await acquireBackgroundPauseLease('tray-hidden');
        if (disposed || !backgrounded()) return;
        if (getAppSettings().ultraLightOnMinimizeOrTrayEnabled === true) {
          const service = await import('./UltraLightModeService');
          if (disposed || !backgrounded()) return;
          await (window.isMinimized()
            ? service.enterUltraLightModeForMinimizedParking()
            : service.enterUltraLightModeForTrayParking());
        }
        await releaseDefaultBackgroundMemory('background-window');
      })().catch(report);
    }, enabled ? 0 : 30_000);
    timer.unref?.();
  };
  const resume = (): void => {
    clearTimer();
    if (backgrounded()) return;
    timer = setTimeout(() => {
      timer = null;
      if (!disposed && !backgrounded()) void releaseBackgroundPauseLease('tray-hidden').catch(report);
    }, trayBackgroundResumeDelayMs);
    timer.unref?.();
  };
  const dispose = (): void => {
    disposed = true;
    clearTimer();
    window.off('hide', park);
    window.off('minimize', park);
    window.off('show', resume);
    window.off('restore', resume);
    window.off('closed', dispose);
    // UltraLight keeps the lease until a replacement window is visible.
    void import('./UltraLightModeService').then(({ isUltraLightModeActive }) => {
      if (!isUltraLightModeActive()) return releaseBackgroundPauseLease('tray-hidden');
    }).catch(report);
  };
  window.on('hide', park);
  window.on('minimize', park);
  window.on('show', resume);
  window.on('restore', resume);
  window.on('closed', dispose);
  return dispose;
};
