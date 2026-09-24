import { BrowserWindow } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { TaskbarMiniPlayerState } from '../../shared/types/taskbarMiniPlayer';
import { getAppSettings, setAppSettings } from './appSettings';
import {
  getTaskbarHostDiagnostics,
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
  const diagnostics = getTaskbarHostDiagnostics();
  const unsupportedReason =
    process.platform !== 'win32'
      ? 'non-windows'
      : !diagnostics.hostPathAvailable || diagnostics.state === 'missing'
        ? 'host-missing'
        : diagnostics.state === 'error'
          ? 'host-start-failed'
          : null;
  const supported = unsupportedReason === null;
  return {
    visible: enabled && taskbarMiniPlayerVisible && isTaskbarHostReady(),
    supported,
    unsupportedReason,
    bounds: null,
    edge: null,
    hostState: diagnostics.state,
    lastError: diagnostics.lastError,
    settings: {
      taskbarMiniPlayerEnabled: enabled,
    },
  };
};

export const showTaskbarMiniPlayerOnly = (): TaskbarMiniPlayerState => {
  if (getAppSettings().taskbarMiniPlayerEnabled !== true) {
    return getTaskbarMiniPlayerState();
  }

  taskbarMiniPlayerVisible = true;
  showTaskbarHost();
  if (startTaskbarHost()) {
    // Visibility becomes true when the native host reports ready.
  } else {
    taskbarMiniPlayerVisible = false;
    hideTaskbarHost(true);
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

export const notifyTaskbarMiniPlayerHostStateChanged = (): void => {
  emitTaskbarMiniPlayerStateChanged();
};
