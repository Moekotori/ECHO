import { join } from 'node:path';
import { existsSync } from 'node:fs';
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

const mainOutputDir = import.meta.dirname;
const appIconPath = join(mainOutputDir, '../../software.ico');
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
  const initialSize = resolveInitialMainWindowSize();
  const window = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    minWidth: mainWindowMinimumSize.width,
    minHeight: mainWindowMinimumSize.height,
    title: 'ECHO NEXT',
    icon: existsSync(appIconPath) ? appIconPath : undefined,
    backgroundColor: '#f7f9fc',
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

  window.once('ready-to-show', () => {
    const settings = getAppSettings();
    if (settings.miniPlayerEnabled === true && settings.miniPlayerAutoHideMainWindow === true) {
      window.hide();
    } else {
      window.show();
    }
    markStartupStage('main-window:ready-to-show');
  });

  window.on('resize', scheduleRememberSize);
  window.on('maximize', publishMaximizedState);
  window.on('unmaximize', publishMaximizedState);
  window.on('enter-full-screen', () => {
    publishMaximizedState();
    publishFullscreenState();
  });
  window.on('leave-full-screen', () => {
    publishMaximizedState();
    publishFullscreenState();
  });

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
