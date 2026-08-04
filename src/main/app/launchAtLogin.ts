import { app } from 'electron';

const getExecutablePath = (): string => {
  try {
    return app.getPath('exe') || process.execPath;
  } catch {
    return process.execPath;
  }
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
