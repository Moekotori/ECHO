import { app } from 'electron';

const getDefaultIsPackaged = (): boolean => app?.isPackaged === true;

export const getEntitlementDiagnosticOfflineKey = (
  env: NodeJS.ProcessEnv = process.env,
  isPackaged = getDefaultIsPackaged(),
): string => {
  if (isPackaged) {
    return '';
  }
  return env.ECHO_PRO_OFFLINE_KEY ?? env.ECHO_PRO_DEV_KEY ?? '';
};
