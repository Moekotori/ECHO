import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, Menu, nativeImage, Tray } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { GlobalShortcutAction } from '../../shared/types/globalShortcuts';
import { getMainWindow } from './windowManager';

const mainOutputDir = import.meta.dirname;
const appIconPath = join(mainOutputDir, '../../software.ico');

let tray: Tray | null = null;
let quitRequested = false;

const getCommandWindow = () => {
  const window = getMainWindow();
  if (!window || window.isDestroyed()) {
    return null;
  }

  return window;
};

const showMainWindow = (): void => {
  const window = getCommandWindow();

  if (!window) {
    return;
  }

  window.show();
  if (window.isMinimized()) {
    window.restore();
  }
  window.focus();
};

const hideMainWindow = (): void => {
  const window = getCommandWindow();
  if (!window) {
    return;
  }

  window.hide();
};

const sendPlaybackCommand = (action: GlobalShortcutAction): void => {
  const window = getCommandWindow();
  if (!window) {
    return;
  }

  window.webContents.send(IpcChannels.AppGlobalShortcutCommand, action);
};

const openAudioSettings = (): void => {
  showMainWindow();
  sendPlaybackCommand('openAudioSettings');
};

const quitApp = (): void => {
  quitRequested = true;
  app.quit();
};

const showMiniPlayer = (): void => {
  void import('./miniPlayerWindow')
    .then(({ showMiniPlayerWindow }) => showMiniPlayerWindow())
    .catch(() => undefined);
};

const hideMiniPlayer = (): void => {
  void import('./miniPlayerWindow')
    .then(({ hideMiniPlayerWindow }) => hideMiniPlayerWindow())
    .catch(() => undefined);
};

const createTrayIcon = (): Electron.NativeImage => {
  if (existsSync(appIconPath)) {
    return nativeImage.createFromPath(appIconPath);
  }

  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#2f6f8f"/>
      <path d="M12 9v13.2a4 4 0 1 1-2-3.46V9h13v4H12z" fill="#ffffff"/>
    </svg>
  `);

  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
};

const buildTrayMenu = (): Electron.Menu =>
  Menu.buildFromTemplate([
    { label: '显示主界面', click: showMainWindow },
    { label: '隐藏主界面', click: hideMainWindow },
    { type: 'separator' },
    { label: '播放 / 暂停', click: () => sendPlaybackCommand('playPause') },
    { label: '上一首', click: () => sendPlaybackCommand('previousTrack') },
    { label: '下一首', click: () => sendPlaybackCommand('nextTrack') },
    { label: '停止播放', click: () => sendPlaybackCommand('stop') },
    { type: 'separator' },
    { label: '打开迷你播放器', click: showMiniPlayer },
    { label: '隐藏迷你播放器', click: hideMiniPlayer },
    { label: '音频设置', click: openAudioSettings },
    { type: 'separator' },
    { label: '退出 ECHO', click: quitApp },
  ]);

export const ensureTray = (): void => {
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
    return;
  }

  tray = new Tray(createTrayIcon());
  tray.setToolTip('ECHO NEXT');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showMainWindow);
};

export const destroyTray = (): void => {
  tray?.destroy();
  tray = null;
};

export const requestAppQuit = (): void => {
  quitRequested = true;
};

export const isAppQuitRequested = (): boolean => quitRequested;
