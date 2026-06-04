import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { MiniPlayerHideOptions } from '../../shared/types/miniPlayer';
import {
  getMiniPlayerState,
  hideMiniPlayerWindow,
  resetMiniPlayerBounds,
  setMiniPlayerLocked,
  setMiniPlayerQueueOpen,
  showMiniPlayerWindow,
} from '../app/miniPlayerWindow';

const normalizeMiniPlayerHideOptions = (options: unknown): MiniPlayerHideOptions => ({
  restoreMainWindow: Boolean(
    options &&
      typeof options === 'object' &&
      (options as { restoreMainWindow?: unknown }).restoreMainWindow === true,
  ),
});

export const registerMiniPlayerIpc = (): void => {
  ipcMain.handle(IpcChannels.MiniPlayerShow, () => showMiniPlayerWindow());
  ipcMain.handle(IpcChannels.MiniPlayerHide, (_event, options: unknown) =>
    hideMiniPlayerWindow(normalizeMiniPlayerHideOptions(options)),
  );
  ipcMain.handle(IpcChannels.MiniPlayerGetState, () => getMiniPlayerState());
  ipcMain.handle(IpcChannels.MiniPlayerSetLocked, (_event, locked: unknown) => setMiniPlayerLocked(locked === true));
  ipcMain.handle(IpcChannels.MiniPlayerSetQueueOpen, (_event, open: unknown) => setMiniPlayerQueueOpen(open === true));
  ipcMain.handle(IpcChannels.MiniPlayerResetBounds, () => resetMiniPlayerBounds());
};
