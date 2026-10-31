import type { BrowserWindow } from 'electron';
import type { AppSettings } from '../../shared/types/appSettings';
import { resolveEffectivePerformancePolicy } from '../../shared/utils/performancePolicy';

export const isMainWindowAcrylicSupportedPlatform = (): boolean => process.platform === 'win32';

export const applyMainWindowBackgroundMaterial = (
  window: BrowserWindow,
  settings: Pick<AppSettings, 'appWindowAcrylicEnabled' | 'appWindowAcrylicKeepWhenUnfocusedEnabled' | 'lowSpecModeEnabled'>,
): void => {
  if (window.isDestroyed()) {
    return;
  }

  const acrylicEnabled = isMainWindowAcrylicSupportedPlatform() && resolveEffectivePerformancePolicy(settings).appWindowAcrylicEnabled;

  window.setBackgroundColor('#f7f9fc');

  if (isMainWindowAcrylicSupportedPlatform()) {
    window.setBackgroundMaterial(acrylicEnabled ? 'acrylic' : 'none');
  }
};
