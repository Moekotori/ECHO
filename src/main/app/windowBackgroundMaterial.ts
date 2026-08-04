import type { BrowserWindow } from 'electron';
import type { AppSettings } from '../../shared/types/appSettings';

export const isMainWindowAcrylicSupportedPlatform = (): boolean => process.platform === 'win32';

export const applyMainWindowBackgroundMaterial = (
  window: BrowserWindow,
  settings: Pick<AppSettings, 'appWindowAcrylicEnabled' | 'appWindowAcrylicKeepWhenUnfocusedEnabled'>,
): void => {
  if (window.isDestroyed()) {
    return;
  }

  const acrylicEnabled = isMainWindowAcrylicSupportedPlatform() && settings.appWindowAcrylicEnabled === true;

  window.setBackgroundColor('#f7f9fc');

  if (isMainWindowAcrylicSupportedPlatform()) {
    window.setBackgroundMaterial(acrylicEnabled ? 'acrylic' : 'none');
  }
};
