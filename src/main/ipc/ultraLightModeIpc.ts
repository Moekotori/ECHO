import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { UltraLightModeStatus } from '../../shared/types/ultraLightMode';
import {
  enterUltraLightMode,
  getUltraLightModeStatus,
  restoreUltraLightMode,
} from '../app/UltraLightModeService';

export const registerUltraLightModeIpc = (): void => {
  ipcMain.handle(IpcChannels.AppUltraLightModeGetStatus, (): UltraLightModeStatus => getUltraLightModeStatus());
  ipcMain.handle(IpcChannels.AppUltraLightModeEnter, (): Promise<UltraLightModeStatus> => enterUltraLightMode());
  ipcMain.handle(IpcChannels.AppUltraLightModeRestore, (): Promise<UltraLightModeStatus> => restoreUltraLightMode());
};
