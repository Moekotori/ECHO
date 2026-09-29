import { app } from 'electron';

const getDefaultIsPackaged = (): boolean => app?.isPackaged === true;

export const areDeveloperToolsAllowed = (
  isPackaged = getDefaultIsPackaged(),
  env: NodeJS.ProcessEnv = process.env,
): boolean => !isPackaged || env.ECHO_ENABLE_DEVTOOLS === '1';
