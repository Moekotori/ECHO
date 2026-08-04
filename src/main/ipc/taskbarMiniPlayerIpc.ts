import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import {
  getTaskbarMiniPlayerState,
  hideTaskbarMiniPlayerWindow,
  setTaskbarMiniPlayerEnabled,
  showTaskbarMiniPlayerWindow,
} from '../app/taskbarMiniPlayerWindow';
import {
  setTaskbarHostClickCallback,
  setTaskbarHostDoubleClickCallback,
  setTaskbarHostReadyCallback,
} from '../app/taskbarHostProcess';
import { getAudioSession } from '../audio/AudioSession';
import { refreshTaskbarPlaybackIntegration } from '../app/taskbarPlaybackIntegration';
import { getMainWindow } from '../app/windowManager';

const relayPlaybackCommandToMainWindow = (command: string): void => {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannels.SmtcCommand, command);
  }
};


const showMainWindowFromTaskbarMiniPlayer = (): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.moveTop();
  if (process.platform === 'win32') {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setAlwaysOnTop(false);
  }
  mainWindow.focus();
};
const togglePlayback = (): void => {
  const audioSession = getAudioSession();
  const status = audioSession.getStatus();
  if (status.state === 'playing') {
    void audioSession.pause();
  } else {
    void audioSession.play();
  }
};

export const registerTaskbarMiniPlayerIpc = (): void => {
  setTaskbarHostClickCallback((action) => {
    if (action === 'playPause') {
      togglePlayback();
    } else if (action === 'next') {
      relayPlaybackCommandToMainWindow('next');
    } else if (action === 'prev') {
      relayPlaybackCommandToMainWindow('previous');
    }
  });

  setTaskbarHostDoubleClickCallback(showMainWindowFromTaskbarMiniPlayer);

  setTaskbarHostReadyCallback(() => {
    try { refreshTaskbarPlaybackIntegration(); } catch { /* best-effort */ }
  });

  ipcMain.handle(IpcChannels.TaskbarMiniPlayerShow, () => showTaskbarMiniPlayerWindow());
  ipcMain.handle(IpcChannels.TaskbarMiniPlayerHide, () => hideTaskbarMiniPlayerWindow());
  ipcMain.handle(IpcChannels.TaskbarMiniPlayerGetState, () => getTaskbarMiniPlayerState());
  ipcMain.handle(IpcChannels.TaskbarMiniPlayerSetEnabled, (_event, enabled: boolean) =>
    setTaskbarMiniPlayerEnabled(enabled),
  );
};