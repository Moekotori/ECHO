import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { MiniPlayerBounds, MiniPlayerHideOptions, MiniPlayerState } from '../../shared/types/miniPlayer';
import { getAppSettings, setAppSettings } from './appSettings';
import { createMainWindow, createMainWindowWebPreferences } from './createMainWindow';
import { ensureTray } from './tray';
import { getMainWindow } from './windowManager';
import { recordMainRuntimeIssue, recordRendererConsoleMessage } from '../diagnostics/DevConsoleService';

const mainOutputDir = import.meta.dirname;
const defaultMiniPlayerSize = {
  width: 388,
  height: 74,
} as const;
const expandedMiniPlayerHeight = 324;
const miniPlayerMinimumSize = {
  width: 320,
  height: 68,
} as const;
const previousDefaultMiniPlayerSizes = [
  { width: 460, height: 92 },
  { width: 288, height: 84 },
  { width: 288, height: 46 },
  { width: 384, height: 112 },
  { width: 344, height: 96 },
  { width: 312, height: 88 },
  { width: 292, height: 82 },
  { width: 276, height: 78 },
  { width: 268, height: 68 },
] as const;
const rememberBoundsDebounceMs = 300;

let miniPlayerWindow: BrowserWindow | null = null;
let rememberBoundsTimer: ReturnType<typeof setTimeout> | null = null;
let miniPlayerQueueOpen = false;
let suppressBoundsRememberUntilMs = 0;

const migratePreviousDefaultBounds = (bounds: MiniPlayerBounds, allowExpandedHeight = false): MiniPlayerBounds => {
  const matchesPreviousDefault = bounds.width <= 312 && bounds.height <= 88 || previousDefaultMiniPlayerSizes.some(
    (size) => Math.abs(bounds.width - size.width) <= 1 && Math.abs(bounds.height - size.height) <= 1,
  );
  const targetHeight = allowExpandedHeight && bounds.height === expandedMiniPlayerHeight
    ? expandedMiniPlayerHeight
    : defaultMiniPlayerSize.height;

  if (matchesPreviousDefault) {
    return {
      x: Math.round(bounds.x + bounds.width - defaultMiniPlayerSize.width),
      y: bounds.y,
      width: defaultMiniPlayerSize.width,
      height: targetHeight,
    };
  }

  if (bounds.width > defaultMiniPlayerSize.width || bounds.height !== targetHeight) {
    return {
      ...bounds,
      width: Math.min(bounds.width, defaultMiniPlayerSize.width),
      height: targetHeight,
    };
  }

  return bounds;
};

const boundsEqual = (a: MiniPlayerBounds, b: MiniPlayerBounds): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const toMiniPlayerSettings = (): MiniPlayerState['settings'] => {
  const settings = getAppSettings();
  return {
    miniPlayerEnabled: settings.miniPlayerEnabled,
    miniPlayerLocked: false,
    miniPlayerAutoHideMainWindow: settings.miniPlayerAutoHideMainWindow,
    miniPlayerBounds: settings.miniPlayerBounds,
  };
};

const getWindowBounds = (window: BrowserWindow | null): MiniPlayerBounds | null => {
  if (!window || window.isDestroyed()) {
    return null;
  }

  return window.getBounds();
};

export const getMiniPlayerState = (): MiniPlayerState => {
  const settings = getAppSettings();
  const visible = Boolean(miniPlayerWindow && !miniPlayerWindow.isDestroyed() && miniPlayerWindow.isVisible());

  return {
    visible,
    locked: false,
    bounds: getWindowBounds(miniPlayerWindow) ?? settings.miniPlayerBounds ?? null,
    settings: toMiniPlayerSettings(),
  };
};

const emitMiniPlayerStateChanged = (): void => {
  const state = getMiniPlayerState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.MiniPlayerStateChanged, state);
    }
  }
};

const isBoundsVisible = (bounds: MiniPlayerBounds): boolean =>
  screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapWidth >= 120 && overlapHeight >= 48;
  });

const clampBoundsToVisibleArea = (bounds: MiniPlayerBounds): MiniPlayerBounds => {
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const width = Math.max(miniPlayerMinimumSize.width, Math.min(bounds.width, area.width));
  const height = Math.max(miniPlayerMinimumSize.height, Math.min(bounds.height, area.height));

  return {
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
    width: Math.round(width),
    height: Math.round(height),
  };
};

const normalizeMiniPlayerWindowBounds = (window: BrowserWindow): MiniPlayerBounds => {
  const bounds = window.getBounds();
  const nextBounds = clampBoundsToVisibleArea(migratePreviousDefaultBounds(bounds, miniPlayerQueueOpen));
  if (!boundsEqual(bounds, nextBounds)) {
    window.setBounds(nextBounds);
    if (!miniPlayerQueueOpen) {
      setAppSettings({ miniPlayerBounds: nextBounds });
    }
  }

  return nextBounds;
};

export const resolveInitialMiniPlayerBounds = (): MiniPlayerBounds => {
  const savedBounds = getAppSettings().miniPlayerBounds;
  if (savedBounds && isBoundsVisible(savedBounds)) {
    return clampBoundsToVisibleArea(migratePreviousDefaultBounds(savedBounds));
  }

  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(defaultMiniPlayerSize.width, Math.max(miniPlayerMinimumSize.width, area.width - 48));
  const height = defaultMiniPlayerSize.height;

  return {
    x: Math.round(area.x + area.width - width - 28),
    y: Math.round(area.y + 44),
    width,
    height,
  };
};

const applyMiniPlayerAlwaysOnTop = (window: BrowserWindow): void => {
  window.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
};

const applyMiniPlayerLockState = (window: BrowserWindow): void => {
  window.setIgnoreMouseEvents(false);
};

const hideMainWindowForMiniPlayer = (): void => {
  if (getAppSettings().miniPlayerAutoHideMainWindow !== true) {
    return;
  }

  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  ensureTray();
  mainWindow.hide();
};

const restoreMainWindowAfterMiniPlayerHide = (): void => {
  const mainWindow = getMainWindow() ?? createMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
};

const rememberMiniPlayerBounds = (window: BrowserWindow): void => {
  if (window.isDestroyed()) {
    return;
  }

  const rawBounds = window.getBounds();
  const bounds = clampBoundsToVisibleArea({
    ...rawBounds,
    height: defaultMiniPlayerSize.height,
  });
  setAppSettings({ miniPlayerBounds: bounds });
  emitMiniPlayerStateChanged();
};

const scheduleRememberMiniPlayerBounds = (window: BrowserWindow): void => {
  if (Date.now() < suppressBoundsRememberUntilMs) {
    return;
  }
  if (rememberBoundsTimer !== null) {
    clearTimeout(rememberBoundsTimer);
  }

  rememberBoundsTimer = setTimeout(() => {
    rememberBoundsTimer = null;
    rememberMiniPlayerBounds(window);
  }, rememberBoundsDebounceMs);
};

const loadMiniPlayerRenderer = (window: BrowserWindow): void => {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set('miniPlayer', '1');
    void window.loadURL(url.toString());
    return;
  }

  void window.loadFile(join(mainOutputDir, '../renderer/index.html'), {
    query: { miniPlayer: '1' },
  });
};

export const createMiniPlayerWindow = (): BrowserWindow => {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    normalizeMiniPlayerWindowBounds(miniPlayerWindow);
    return miniPlayerWindow;
  }

  const bounds = resolveInitialMiniPlayerBounds();
  const window = new BrowserWindow({
    ...bounds,
    minWidth: miniPlayerMinimumSize.width,
    minHeight: miniPlayerMinimumSize.height,
    title: 'ECHO Mini Player',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    webPreferences: createMainWindowWebPreferences(),
  });

  miniPlayerWindow = window;
  window.setMenuBarVisibility(false);
  window.webContents.on('console-message', (details) => {
    recordRendererConsoleMessage(details);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    recordMainRuntimeIssue('mini-player-load-failed', errorDescription || 'Mini player renderer failed to load', {
      reason: validatedURL,
      exitCode: errorCode,
      sourceId: isMainFrame ? 'main-frame' : 'sub-frame',
    });
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    recordMainRuntimeIssue('mini-player-preload-error', error.message, {
      stack: error.stack,
      sourceId: preloadPath,
    });
  });
  applyMiniPlayerAlwaysOnTop(window);
  applyMiniPlayerLockState(window);

  window.once('ready-to-show', () => {
    normalizeMiniPlayerWindowBounds(window);
    if (getAppSettings().miniPlayerEnabled === true) {
      window.showInactive();
      applyMiniPlayerAlwaysOnTop(window);
    }
  });

  window.on('show', () => {
    applyMiniPlayerAlwaysOnTop(window);
    emitMiniPlayerStateChanged();
  });
  window.on('hide', emitMiniPlayerStateChanged);
  window.on('move', () => scheduleRememberMiniPlayerBounds(window));
  window.on('resize', () => scheduleRememberMiniPlayerBounds(window));
  window.on('closed', () => {
    if (rememberBoundsTimer !== null) {
      clearTimeout(rememberBoundsTimer);
      rememberBoundsTimer = null;
    }

    miniPlayerWindow = null;
    emitMiniPlayerStateChanged();
  });

  loadMiniPlayerRenderer(window);
  return window;
};

export const showMiniPlayerWindow = (): MiniPlayerState => {
  miniPlayerQueueOpen = false;
  setAppSettings({ miniPlayerEnabled: true });
  const window = createMiniPlayerWindow();
  normalizeMiniPlayerWindowBounds(window);
  applyMiniPlayerLockState(window);
  if (!window.isVisible()) {
    window.showInactive();
  }
  applyMiniPlayerAlwaysOnTop(window);
  hideMainWindowForMiniPlayer();
  emitMiniPlayerStateChanged();
  return getMiniPlayerState();
};

export const hideMiniPlayerWindow = (options: MiniPlayerHideOptions = {}): MiniPlayerState => {
  miniPlayerQueueOpen = false;
  setAppSettings({ miniPlayerEnabled: false });
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.hide();
  }
  if (options.restoreMainWindow === true) {
    restoreMainWindowAfterMiniPlayerHide();
  }
  emitMiniPlayerStateChanged();
  return getMiniPlayerState();
};

export const closeMiniPlayerWindow = (): void => {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow = null;
    return;
  }

  if (rememberBoundsTimer !== null) {
    clearTimeout(rememberBoundsTimer);
    rememberBoundsTimer = null;
  }

  rememberMiniPlayerBounds(miniPlayerWindow);
  miniPlayerWindow.destroy();
};

export const setMiniPlayerLocked = (_locked: boolean): MiniPlayerState => {
  setAppSettings({ miniPlayerLocked: false });
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    applyMiniPlayerLockState(miniPlayerWindow);
    applyMiniPlayerAlwaysOnTop(miniPlayerWindow);
  }
  emitMiniPlayerStateChanged();
  return getMiniPlayerState();
};

export const setMiniPlayerQueueOpen = (open: boolean): MiniPlayerState => {
  miniPlayerQueueOpen = open;
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) {
    return getMiniPlayerState();
  }

  const currentBounds = miniPlayerWindow.getBounds();
  const nextBounds = clampBoundsToVisibleArea({
    ...currentBounds,
    height: open ? expandedMiniPlayerHeight : defaultMiniPlayerSize.height,
  });
  suppressBoundsRememberUntilMs = Date.now() + rememberBoundsDebounceMs + 100;
  miniPlayerWindow.setBounds(nextBounds);
  applyMiniPlayerAlwaysOnTop(miniPlayerWindow);
  emitMiniPlayerStateChanged();
  return getMiniPlayerState();
};

export const resetMiniPlayerBounds = (): MiniPlayerState => {
  miniPlayerQueueOpen = false;
  const bounds = resolveInitialMiniPlayerBounds();
  setAppSettings({ miniPlayerBounds: bounds });
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.setBounds(bounds);
    applyMiniPlayerAlwaysOnTop(miniPlayerWindow);
  }
  emitMiniPlayerStateChanged();
  return getMiniPlayerState();
};

export const restoreMiniPlayerWindowOnStartup = (): void => {
  if (getAppSettings().miniPlayerEnabled === true) {
    showMiniPlayerWindow();
  }
};
