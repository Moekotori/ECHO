import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { Display, IpcMainEvent, Rectangle } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AudioStatus } from '../../shared/types/audio';
import type { DesktopLyricsBounds } from '../../shared/types/appSettings';
import type { DesktopLyricsState, DesktopLyricsStylePatch } from '../../shared/types/desktopLyrics';
import type { PlaybackStatus } from '../../shared/types/playback';
import { getAppSettings, setAppSettings } from './appSettings';
import { createMainWindowWebPreferences } from './createMainWindow';
import { getMainWindow } from './windowManager';
import { recordMainRuntimeIssue, recordRendererConsoleMessage } from '../diagnostics/DevConsoleService';

const mainOutputDir = import.meta.dirname;
const defaultDesktopLyricsSize = {
  width: 1760,
  height: 150,
} as const;
const defaultVerticalDesktopLyricsSize = {
  width: 460,
  height: 640,
} as const;
const desktopLyricsMinimumSize = {
  width: 360,
  height: 84,
} as const;
const verticalDesktopLyricsReadableMinimumSize = {
  width: 360,
  height: 640,
} as const;
const horizontalDesktopLyricsReadableMinimumSize = {
  width: 1760,
  height: 150,
} as const;
const rememberBoundsDebounceMs = 300;
const forwardedAudioStatusMaxAgeMs = 30_000;
const desktopLyricsRevealMenuRetryDelaysMs = [0, 80, 220] as const;

let desktopLyricsWindow: BrowserWindow | null = null;
let rememberBoundsTimer: ReturnType<typeof setTimeout> | null = null;
let lastForwardedAudioStatus: { status: AudioStatus; receivedAtMs: number } | null = null;
let lastForwardedPlaybackStatus: { status: PlaybackStatus; receivedAtMs: number } | null = null;
let desktopLyricsMousePassthrough = false;

const toDesktopLyricsSettings = (): DesktopLyricsState['settings'] => {
  const settings = getAppSettings();
  return {
    desktopLyricsEnabled: settings.desktopLyricsEnabled,
    desktopLyricsLocked: settings.desktopLyricsLocked,
    desktopLyricsFontSizePx: settings.desktopLyricsFontSizePx,
    desktopLyricsSecondaryFontSizePx: settings.desktopLyricsSecondaryFontSizePx,
    desktopLyricsScalePercent: settings.desktopLyricsScalePercent,
    desktopLyricsFontFamily: settings.desktopLyricsFontFamily,
    desktopLyricsFontFilePath: settings.desktopLyricsFontFilePath,
    desktopLyricsColorMode: settings.desktopLyricsColorMode,
    desktopLyricsColor: settings.desktopLyricsColor,
    desktopLyricsStrokeColor: settings.desktopLyricsStrokeColor,
    desktopLyricsGradientStartColor: settings.desktopLyricsGradientStartColor,
    desktopLyricsGradientEndColor: settings.desktopLyricsGradientEndColor,
    desktopLyricsOpacityPercent: settings.desktopLyricsOpacityPercent,
    desktopLyricsTextDirection: settings.desktopLyricsTextDirection,
    desktopLyricsRomanizationEnabled: settings.desktopLyricsRomanizationEnabled,
    desktopLyricsTranslationEnabled: settings.desktopLyricsTranslationEnabled,
    desktopLyricsHideWhenNoLyricsEnabled: settings.desktopLyricsHideWhenNoLyricsEnabled,
    desktopLyricsBounds: settings.desktopLyricsBounds,
    lyricsMusicReactiveVisualsEnabled: settings.lyricsMusicReactiveVisualsEnabled,
  };
};

const getWindowBounds = (window: BrowserWindow | null): DesktopLyricsBounds | null => {
  if (!window || window.isDestroyed()) {
    return null;
  }

  return window.getBounds();
};

export const getDesktopLyricsState = (): DesktopLyricsState => {
  const settings = getAppSettings();
  const visible = Boolean(desktopLyricsWindow && !desktopLyricsWindow.isDestroyed() && desktopLyricsWindow.isVisible());

  return {
    visible,
    locked: settings.desktopLyricsLocked === true,
    bounds: getWindowBounds(desktopLyricsWindow) ?? settings.desktopLyricsBounds ?? null,
    settings: toDesktopLyricsSettings(),
  };
};

const emitDesktopLyricsStateChanged = (): void => {
  const state = getDesktopLyricsState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.DesktopLyricsStateChanged, state);
    }
  }
};

const getDesktopLyricsConstrainArea = (display: Display): Rectangle => display.bounds;

const isBoundsVisible = (bounds: DesktopLyricsBounds): boolean =>
  screen.getAllDisplays().some((display) => {
    const area = getDesktopLyricsConstrainArea(display);
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapWidth >= 96 && overlapHeight >= 48;
  });

const clampBoundsToVisibleArea = (bounds: DesktopLyricsBounds): DesktopLyricsBounds => {
  const display = screen.getDisplayMatching(bounds);
  const area = getDesktopLyricsConstrainArea(display);
  const width = Math.max(desktopLyricsMinimumSize.width, Math.min(bounds.width, area.width));
  const height = Math.max(desktopLyricsMinimumSize.height, Math.min(bounds.height, area.height));

  return {
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
    width: Math.round(width),
    height: Math.round(height),
  };
};

const expandBoundsToReadableVerticalArea = (bounds: DesktopLyricsBounds): DesktopLyricsBounds => {
  const display = screen.getDisplayMatching(bounds);
  const area = getDesktopLyricsConstrainArea(display);
  const width = Math.max(bounds.width, Math.min(verticalDesktopLyricsReadableMinimumSize.width, area.width));
  const height = Math.max(bounds.height, Math.min(verticalDesktopLyricsReadableMinimumSize.height, area.height));

  return clampBoundsToVisibleArea({
    x: Math.round(bounds.x - (width - bounds.width) / 2),
    y: Math.round(bounds.y - (height - bounds.height) / 2),
    width,
    height,
  });
};

const expandBoundsToReadableHorizontalArea = (bounds: DesktopLyricsBounds): DesktopLyricsBounds => {
  const display = screen.getDisplayMatching(bounds);
  const area = getDesktopLyricsConstrainArea(display);
  const width = Math.max(bounds.width, Math.min(horizontalDesktopLyricsReadableMinimumSize.width, area.width));
  const height = Math.max(bounds.height, Math.min(horizontalDesktopLyricsReadableMinimumSize.height, area.height));

  return clampBoundsToVisibleArea({
    x: Math.round(bounds.x - (width - bounds.width) / 2),
    y: bounds.y,
    width,
    height,
  });
};

const shouldUseVerticalDesktopLyricsBounds = (): boolean =>
  getAppSettings().desktopLyricsTextDirection === 'vertical';

const normalizeDesktopLyricsBoundsForTextDirection = (bounds: DesktopLyricsBounds): DesktopLyricsBounds =>
  shouldUseVerticalDesktopLyricsBounds()
    ? expandBoundsToReadableVerticalArea(bounds)
    : expandBoundsToReadableHorizontalArea(bounds);

export const resolveInitialDesktopLyricsBounds = (): DesktopLyricsBounds => {
  const savedBounds = getAppSettings().desktopLyricsBounds;
  if (savedBounds && isBoundsVisible(savedBounds)) {
    return normalizeDesktopLyricsBoundsForTextDirection(savedBounds);
  }

  const area = screen.getPrimaryDisplay().workArea;
  const defaultSize = shouldUseVerticalDesktopLyricsBounds()
    ? defaultVerticalDesktopLyricsSize
    : defaultDesktopLyricsSize;
  const width = Math.min(defaultSize.width, Math.max(desktopLyricsMinimumSize.width, area.width - 48));
  const height = Math.min(defaultSize.height, Math.max(desktopLyricsMinimumSize.height, area.height - 48));

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height - height - 84),
    width,
    height,
  };
};

const applyDesktopLyricsAlwaysOnTop = (window: BrowserWindow): void => {
  window.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.moveTop();
};

const applyDesktopLyricsLockState = (window: BrowserWindow): void => {
  const locked = getAppSettings().desktopLyricsLocked === true;
  window.setIgnoreMouseEvents(locked || desktopLyricsMousePassthrough, { forward: true });
};

const rememberDesktopLyricsBounds = (window: BrowserWindow): void => {
  if (window.isDestroyed()) {
    return;
  }

  const bounds = clampBoundsToVisibleArea(window.getBounds());
  setAppSettings({ desktopLyricsBounds: bounds });
  emitDesktopLyricsStateChanged();
};

const scheduleRememberDesktopLyricsBounds = (window: BrowserWindow): void => {
  if (rememberBoundsTimer !== null) {
    clearTimeout(rememberBoundsTimer);
  }

  rememberBoundsTimer = setTimeout(() => {
    rememberBoundsTimer = null;
    rememberDesktopLyricsBounds(window);
  }, rememberBoundsDebounceMs);
};

const applyDesktopLyricsReadableBoundsForTextDirection = (window: BrowserWindow): void => {
  if (window.isDestroyed()) {
    return;
  }

  const bounds = window.getBounds();
  const nextBounds = normalizeDesktopLyricsBoundsForTextDirection(bounds);
  if (
    bounds.x === nextBounds.x &&
    bounds.y === nextBounds.y &&
    bounds.width === nextBounds.width &&
    bounds.height === nextBounds.height
  ) {
    return;
  }

  window.setBounds(nextBounds);
  setAppSettings({ desktopLyricsBounds: nextBounds });
};

const loadDesktopLyricsRenderer = (window: BrowserWindow): void => {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set('desktopLyrics', '1');
    void window.loadURL(url.toString());
    return;
  }

  void window.loadFile(join(mainOutputDir, '../renderer/index.html'), {
    query: { desktopLyrics: '1' },
  });
};

export const createDesktopLyricsWindow = (): BrowserWindow => {
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    return desktopLyricsWindow;
  }

  const bounds = resolveInitialDesktopLyricsBounds();
  const window = new BrowserWindow({
    ...bounds,
    minWidth: desktopLyricsMinimumSize.width,
    minHeight: desktopLyricsMinimumSize.height,
    title: 'ECHO Desktop Lyrics',
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

  desktopLyricsWindow = window;
  window.setMenuBarVisibility(false);
  window.webContents.on('console-message', (details) => {
    recordRendererConsoleMessage(details);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    recordMainRuntimeIssue('desktop-lyrics-load-failed', errorDescription || 'Desktop lyrics renderer failed to load', {
      reason: validatedURL,
      exitCode: errorCode,
      sourceId: isMainFrame ? 'main-frame' : 'sub-frame',
    });
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    recordMainRuntimeIssue('desktop-lyrics-preload-error', error.message, {
      stack: error.stack,
      sourceId: preloadPath,
    });
  });
  applyDesktopLyricsAlwaysOnTop(window);
  applyDesktopLyricsLockState(window);

  window.once('ready-to-show', () => {
    if (getAppSettings().desktopLyricsEnabled === true) {
      window.showInactive();
      applyDesktopLyricsAlwaysOnTop(window);
    }
  });

  window.on('show', () => {
    applyDesktopLyricsAlwaysOnTop(window);
    emitDesktopLyricsStateChanged();
  });
  window.on('hide', emitDesktopLyricsStateChanged);
  window.on('move', () => scheduleRememberDesktopLyricsBounds(window));
  window.on('resize', () => scheduleRememberDesktopLyricsBounds(window));
  window.on('closed', () => {
    if (rememberBoundsTimer !== null) {
      clearTimeout(rememberBoundsTimer);
      rememberBoundsTimer = null;
    }

    desktopLyricsWindow = null;
    emitDesktopLyricsStateChanged();
  });

  loadDesktopLyricsRenderer(window);
  return window;
};

export const showDesktopLyricsWindow = (): DesktopLyricsState => {
  setAppSettings({ desktopLyricsEnabled: true });
  desktopLyricsMousePassthrough = getAppSettings().desktopLyricsLocked === true;
  const window = createDesktopLyricsWindow();
  applyDesktopLyricsReadableBoundsForTextDirection(window);
  applyDesktopLyricsLockState(window);
  if (!window.isVisible()) {
    window.showInactive();
  }
  applyDesktopLyricsAlwaysOnTop(window);
  emitDesktopLyricsStateChanged();
  return getDesktopLyricsState();
};

export const hideDesktopLyricsWindow = (): DesktopLyricsState => {
  setAppSettings({ desktopLyricsEnabled: false });
  desktopLyricsMousePassthrough = false;
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    desktopLyricsWindow.hide();
  }
  emitDesktopLyricsStateChanged();
  return getDesktopLyricsState();
};

export const revealDesktopLyricsMenu = (): DesktopLyricsState => {
  setAppSettings({ desktopLyricsLocked: false });
  desktopLyricsMousePassthrough = false;
  const state = showDesktopLyricsWindow();
  const window = desktopLyricsWindow;

  if (window && !window.isDestroyed()) {
    window.setIgnoreMouseEvents(false, { forward: true });
    for (const delayMs of desktopLyricsRevealMenuRetryDelaysMs) {
      setTimeout(() => {
        if (!window.isDestroyed()) {
          window.webContents.send(IpcChannels.DesktopLyricsRevealMenu);
        }
      }, delayMs);
    }
  }

  return state;
};

export const closeDesktopLyricsWindow = (): void => {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) {
    desktopLyricsWindow = null;
    desktopLyricsMousePassthrough = false;
    return;
  }

  if (rememberBoundsTimer !== null) {
    clearTimeout(rememberBoundsTimer);
    rememberBoundsTimer = null;
  }

  setAppSettings({
    desktopLyricsEnabled: desktopLyricsWindow.isVisible() || getAppSettings().desktopLyricsEnabled === true,
  });
  rememberDesktopLyricsBounds(desktopLyricsWindow);
  desktopLyricsWindow.destroy();
  desktopLyricsMousePassthrough = false;
};

export const setDesktopLyricsLocked = (locked: boolean): DesktopLyricsState => {
  setAppSettings({ desktopLyricsLocked: locked });
  desktopLyricsMousePassthrough = locked;
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    applyDesktopLyricsLockState(desktopLyricsWindow);
    applyDesktopLyricsAlwaysOnTop(desktopLyricsWindow);
  }
  emitDesktopLyricsStateChanged();
  return getDesktopLyricsState();
};

export const setDesktopLyricsMousePassthrough = (event: IpcMainEvent, passthrough: unknown): void => {
  if (
    !desktopLyricsWindow ||
    desktopLyricsWindow.isDestroyed() ||
    event.sender !== desktopLyricsWindow.webContents
  ) {
    return;
  }

  desktopLyricsMousePassthrough = getAppSettings().desktopLyricsLocked === true || passthrough === true;
  applyDesktopLyricsLockState(desktopLyricsWindow);
};

export const setDesktopLyricsStyle = (patch: DesktopLyricsStylePatch): DesktopLyricsState => {
  setAppSettings(patch);
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    applyDesktopLyricsReadableBoundsForTextDirection(desktopLyricsWindow);
    applyDesktopLyricsAlwaysOnTop(desktopLyricsWindow);
  }
  emitDesktopLyricsStateChanged();
  return getDesktopLyricsState();
};

export const resetDesktopLyricsBounds = (): DesktopLyricsState => {
  const bounds = resolveInitialDesktopLyricsBounds();
  setAppSettings({ desktopLyricsBounds: bounds });
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    desktopLyricsWindow.setBounds(bounds);
    applyDesktopLyricsAlwaysOnTop(desktopLyricsWindow);
  }
  emitDesktopLyricsStateChanged();
  return getDesktopLyricsState();
};

export const restoreDesktopLyricsWindowOnStartup = (): void => {
  if (getAppSettings().desktopLyricsEnabled === true) {
    showDesktopLyricsWindow();
  }
};

export const receiveDesktopLyricsRendererAudioStatus = (event: IpcMainEvent, status: unknown): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return;
  }

  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return;
  }

  lastForwardedAudioStatus = {
    status: status as AudioStatus,
    receivedAtMs: Date.now(),
  };

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.DesktopLyricsAudioStatus, lastForwardedAudioStatus.status);
    }
  }
};

export const receiveDesktopLyricsRendererPlaybackStatus = (event: IpcMainEvent, status: unknown): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return;
  }

  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return;
  }

  lastForwardedPlaybackStatus = {
    status: status as PlaybackStatus,
    receivedAtMs: Date.now(),
  };

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.DesktopLyricsPlaybackStatus, lastForwardedPlaybackStatus.status);
    }
  }
};

export const getLastDesktopLyricsAudioStatus = (): AudioStatus | null => {
  if (!lastForwardedAudioStatus) {
    return null;
  }

  return Date.now() - lastForwardedAudioStatus.receivedAtMs <= forwardedAudioStatusMaxAgeMs
    ? lastForwardedAudioStatus.status
    : null;
};

export const getLastDesktopLyricsPlaybackStatus = (): PlaybackStatus | null => {
  if (!lastForwardedPlaybackStatus) {
    return null;
  }

  return Date.now() - lastForwardedPlaybackStatus.receivedAtMs <= forwardedAudioStatusMaxAgeMs
    ? lastForwardedPlaybackStatus.status
    : null;
};
