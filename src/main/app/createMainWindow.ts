import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import type { AppSettings, RememberedWindowSize } from '../../shared/types/appSettings';
import { getAppSettings, setAppSettings } from './appSettings';
import { bindBackgroundPlaybackShortcutsToWindow } from './backgroundPlaybackShortcuts';
import { bindTaskbarPlaybackIntegration } from './taskbarPlaybackIntegration';
import { ensureTray, isAppQuitRequested, requestAppQuit } from './tray';
import { clearMainWindow, setMainWindow } from './windowManager';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { getCrashReportService } from '../diagnostics/CrashReportService';
import { closeDevConsoleWindow, recordMainRuntimeIssue, recordRendererConsoleMessage } from '../diagnostics/DevConsoleService';
import { markStartupStage } from '../diagnostics/StartupDiagnostics';
import { applyMainWindowBackgroundMaterial, isMainWindowAcrylicSupportedPlatform } from './windowBackgroundMaterial';
import { areDeveloperToolsAllowed } from './securityPolicy';
import { resolveAppIconPath } from './appIcon';
import { hideTaskbarMiniPlayerOnly, showTaskbarMiniPlayerOnly } from './taskbarMiniPlayerWindow';

const mainOutputDir = import.meta.dirname;
export const defaultMainWindowSize = {
  width: 1680,
  height: 1050,
} as const;
export const mainWindowMinimumSize = {
  width: 360,
  height: 620,
} as const;
const rememberWindowSizeDebounceMs = 350;

export const resolvePreloadPath = (baseDir = mainOutputDir): string => {
  const mjsPreload = join(baseDir, '../preload/index.mjs');

  if (existsSync(mjsPreload)) {
    return mjsPreload;
  }

  return join(baseDir, '../preload/index.js');
};

export const createMainWindowWebPreferences = (): Electron.BrowserWindowConstructorOptions['webPreferences'] => ({
  preload: resolvePreloadPath(),
  contextIsolation: true,
  nodeIntegration: false,
  devTools: areDeveloperToolsAllowed(),
  sandbox: false,
  backgroundThrottling: false,
});

export const resolveInitialMainWindowSize = (settings: AppSettings = getAppSettings()): RememberedWindowSize => {
  const rememberedSize = settings.rememberWindowSizeEnabled === false ? null : settings.rememberedWindowSize;

  return {
    width: Math.max(mainWindowMinimumSize.width, rememberedSize?.width ?? defaultMainWindowSize.width),
    height: Math.max(mainWindowMinimumSize.height, rememberedSize?.height ?? defaultMainWindowSize.height),
  };
};

export const resolveMainWindowBackgroundOptions = (
  settings: Pick<AppSettings, 'appWindowAcrylicEnabled'>,
  acrylicSupported = isMainWindowAcrylicSupportedPlatform(),
): Pick<Electron.BrowserWindowConstructorOptions, 'backgroundColor' | 'backgroundMaterial'> => {
  const acrylicEnabled = acrylicSupported && settings.appWindowAcrylicEnabled === true;

  return {
    backgroundColor: '#f7f9fc',
    ...(acrylicSupported
      ? {
          backgroundMaterial: acrylicEnabled ? 'acrylic' : 'none',
        }
      : {}),
  };
};

const rememberMainWindowSize = (window: BrowserWindow): void => {
  if (window.isDestroyed() || window.isMinimized() || window.isMaximized() || window.isFullScreen()) {
    return;
  }

  if (getAppSettings().rememberWindowSizeEnabled === false) {
    return;
  }

  const [width, height] = window.getSize();
  setAppSettings({
    rememberedWindowSize: {
      width,
      height,
    },
  });
};

export const createMainWindow = (): BrowserWindow => {
  markStartupStage('main-window:create:start');
  const settings = getAppSettings();
  const initialSize = resolveInitialMainWindowSize(settings);
  const appIconPath = resolveAppIconPath();
  const window = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    minWidth: mainWindowMinimumSize.width,
    minHeight: mainWindowMinimumSize.height,
    title: 'ECHO NEXT',
    icon: appIconPath ?? undefined,
    ...resolveMainWindowBackgroundOptions(settings),
    frame: false,
    show: false,
    webPreferences: createMainWindowWebPreferences(),
  });
  let rememberSizeTimer: ReturnType<typeof setTimeout> | null = null;

  const publishMaximizedState = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.AppWindowMaximizedChanged, window.isMaximized() || window.isFullScreen());
    }
  };
  const publishFullscreenState = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.AppWindowFullscreenChanged, window.isFullScreen());
    }
  };
  const toggleFullscreenFromShortcut = (): void => {
    if (!window.isDestroyed()) {
      window.setFullScreen(!window.isFullScreen());
    }
  };

  window.webContents.on('console-message', (details) => {
    recordRendererConsoleMessage(details);
    const { level, message, lineNumber, sourceId } = details;

    if (!message.includes('[SpotifySDK]')) {
      return;
    }

    getCrashReportService().getLogger()?.info('renderer', 'renderer console', {
      level,
      message,
      line: lineNumber,
      sourceId,
    });
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    recordMainRuntimeIssue('renderer-load-failed', errorDescription || 'Renderer failed to load', {
      reason: validatedURL,
      exitCode: errorCode,
      sourceId: isMainFrame ? 'main-frame' : 'sub-frame',
    });
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    recordMainRuntimeIssue('preload-error', error.message, {
      stack: error.stack,
      sourceId: preloadPath,
    });
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      toggleFullscreenFromShortcut();
    }
  });

  const scheduleRememberSize = (): void => {
    if (rememberSizeTimer !== null) {
      clearTimeout(rememberSizeTimer);
    }

    rememberSizeTimer = setTimeout(() => {
      rememberSizeTimer = null;
      rememberMainWindowSize(window);
    }, rememberWindowSizeDebounceMs);
  };
  const refreshAcrylicAfterFocusChange = (): void => {
    const latestSettings = getAppSettings();
    if (latestSettings.appWindowAcrylicEnabled === true && latestSettings.appWindowAcrylicKeepWhenUnfocusedEnabled === true) {
      applyMainWindowBackgroundMaterial(window, latestSettings);
    }
  };

  window.once('ready-to-show', () => {
    const settings = getAppSettings();
    if (settings.miniPlayerEnabled === true && settings.miniPlayerAutoHideMainWindow === true) {
      window.hide();
    } else {
      window.show();
    }

    // Create and show the taskbar mini player if enabled.
    // It is a permanent overlay, not tied to main window focus/blur.
    if (settings.taskbarMiniPlayerEnabled === true) {
      try {
        showTaskbarMiniPlayerOnly();
      } catch {
        // Taskbar mini player is best-effort; don't block main window startup.
      }
    }

    markStartupStage('main-window:ready-to-show');
  });

  window.on('resize', scheduleRememberSize);
  window.on('blur', refreshAcrylicAfterFocusChange);
  window.on('focus', refreshAcrylicAfterFocusChange);
  window.on('maximize', publishMaximizedState);
  window.on('unmaximize', publishMaximizedState);

  // Taskbar mini player management
  // The taskbar mini player is a PERMANENT overlay. It stays visible
  // regardless of main window state (focus, blur, minimize, restore).
  //
  // The ONLY conditions that hide it:
  // 1. taskbarMiniPlayerEnabled is false (user toggled it off)
  // 2. miniPlayerEnabled is true (desktop mini player takes over)
  // 3. Main window is focused and in fullscreen

  const shouldShowTaskbarMiniPlayer = (): boolean =>
    getAppSettings().taskbarMiniPlayerEnabled === true &&
    getAppSettings().miniPlayerEnabled !== true;

  const syncTaskbarMiniPlayerForMainWindowState = (): void => {
    if (window.isDestroyed()) {
      return;
    }

    if (window.isFullScreen() && window.isFocused()) {
      try { hideTaskbarMiniPlayerOnly(); } catch { /* best-effort */ }
      return;
    }

    if (shouldShowTaskbarMiniPlayer()) {
      try { showTaskbarMiniPlayerOnly(); } catch { /* best-effort */ }
    }
  };

  window.on('enter-full-screen', () => {
    publishMaximizedState();
    publishFullscreenState();
    syncTaskbarMiniPlayerForMainWindowState();
  });
  window.on('leave-full-screen', () => {
    publishMaximizedState();
    publishFullscreenState();
    syncTaskbarMiniPlayerForMainWindowState();
  });
  window.on('focus', syncTaskbarMiniPlayerForMainWindowState);
  window.on('blur', syncTaskbarMiniPlayerForMainWindowState);

  window.on('close', (event) => {
    if (rememberSizeTimer !== null) {
      clearTimeout(rememberSizeTimer);
      rememberSizeTimer = null;
    }

    rememberMainWindowSize(window);
    closeDevConsoleWindow();

    if (!isAppQuitRequested() && getAppSettings().hideToTrayOnClose) {
      event.preventDefault();
      ensureTray();
      window.hide();
    }
  });

  window.on('closed', () => {
    if (rememberSizeTimer !== null) {
      clearTimeout(rememberSizeTimer);
      rememberSizeTimer = null;
    }

    clearMainWindow();
    closeDevConsoleWindow();

    if (!isAppQuitRequested() && !getAppSettings().hideToTrayOnClose) {
      requestAppQuit();
      app.quit();
    }
  });

  applyMainWindowBackgroundMaterial(window, settings);

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(mainOutputDir, '../renderer/index.html'));
  }

  setMainWindow(window);
  ensureTray();
  bindBackgroundPlaybackShortcutsToWindow();
  bindTaskbarPlaybackIntegration(window);
  markStartupStage('main-window:create:complete', initialSize);

  return window;
};