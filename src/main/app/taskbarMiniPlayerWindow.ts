import { BrowserWindow } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { TaskbarMiniPlayerState } from '../../shared/types/taskbarMiniPlayer';
import { getAppSettings, setAppSettings } from './appSettings';
import {
  hideTaskbarHost,
  isTaskbarHostReady,
  showTaskbarHost,
  startTaskbarHost,
  stopTaskbarHost,
} from './taskbarHostProcess';

let taskbarMiniPlayerVisible = false;

const emitTaskbarMiniPlayerStateChanged = (): void => {
  const state = getTaskbarMiniPlayerState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.TaskbarMiniPlayerStateChanged, state);
    }
  }
};

export const getTaskbarMiniPlayerState = (): TaskbarMiniPlayerState => {
  const enabled = getAppSettings().taskbarMiniPlayerEnabled === true;
  const supported = process.platform === 'win32';
  return {
    visible: enabled && taskbarMiniPlayerVisible && isTaskbarHostReady(),
    supported,
    unsupportedReason: supported ? null : 'non-windows',
    bounds: null,
    edge: null,
    settings: {
      taskbarMiniPlayerEnabled: enabled,
    },
  };
};

export const showTaskbarMiniPlayerOnly = (): TaskbarMiniPlayerState => {
  if (getAppSettings().taskbarMiniPlayerEnabled !== true) {
    return getTaskbarMiniPlayerState();
  }

  if (startTaskbarHost()) {
    taskbarMiniPlayerVisible = true;
    showTaskbarHost();
  } else {
    taskbarMiniPlayerVisible = false;
  }

  emitTaskbarMiniPlayerStateChanged();
  return getTaskbarMiniPlayerState();
};

export const hideTaskbarMiniPlayerOnly = (): TaskbarMiniPlayerState => {
  taskbarMiniPlayerVisible = false;
  hideTaskbarHost();
  emitTaskbarMiniPlayerStateChanged();
  return getTaskbarMiniPlayerState();
};

export const showTaskbarMiniPlayerWindow = (): TaskbarMiniPlayerState => {
  setAppSettings({ taskbarMiniPlayerEnabled: true });
  return showTaskbarMiniPlayerOnly();
};

export const hideTaskbarMiniPlayerWindow = (): TaskbarMiniPlayerState => {
  setAppSettings({ taskbarMiniPlayerEnabled: false });
  taskbarMiniPlayerVisible = false;
  hideTaskbarHost();
  emitTaskbarMiniPlayerStateChanged();
  return getTaskbarMiniPlayerState();
};

export const setTaskbarMiniPlayerEnabled = (enabled: boolean): TaskbarMiniPlayerState => {
  setAppSettings({ taskbarMiniPlayerEnabled: enabled });
  if (enabled) {
    return showTaskbarMiniPlayerOnly();
  }

  taskbarMiniPlayerVisible = false;
  hideTaskbarHost();
  emitTaskbarMiniPlayerStateChanged();
  return getTaskbarMiniPlayerState();
};

export const resetTaskbarMiniPlayerBounds = (): TaskbarMiniPlayerState => {
  emitTaskbarMiniPlayerStateChanged();
  return getTaskbarMiniPlayerState();
};

export const stopTaskbarMiniPlayer = (): void => {
  taskbarMiniPlayerVisible = false;
  stopTaskbarHost();
  emitTaskbarMiniPlayerStateChanged();
};