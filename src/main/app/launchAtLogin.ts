import { app } from 'electron';
import { isScoopInstallation, resolveScoopCurrentExePath } from './scoopService';

const getExecutablePath = (): string => {
  const rawPath = (() => {
    try {
      return app.getPath('exe') || process.execPath;
    } catch {
      return process.execPath;
    }
  })();

  if (isScoopInstallation(rawPath)) {
    return resolveScoopCurrentExePath(rawPath);
  }
  return rawPath;
};

const createLoginItemSettings = (enabled: boolean): Parameters<typeof app.setLoginItemSettings>[0] => {
  const openAtLogin = enabled === true;

  if (process.platform === 'win32') {
    return {
      openAtLogin,
      path: getExecutablePath(),
    };
  }

  return { openAtLogin };
};

export const setLaunchAtLoginEnabled = (enabled: boolean): void => {
  app.setLoginItemSettings(createLoginItemSettings(enabled));
};

export const syncLaunchAtLoginSetting = (enabled: boolean): boolean => {
  try {
    setLaunchAtLoginEnabled(enabled);
    return true;
  } catch (error) {
    console.warn('[launch-at-login] failed to sync login item', error);
    return false;
  }
};
