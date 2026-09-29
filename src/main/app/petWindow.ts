import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import {
  defaultPetScalePercent,
  petScalePercentMax,
  petScalePercentMin,
  petWindowBaseSize,
  type PetBounds,
  type PetState,
} from '../../shared/types/pet';
import { recordMainRuntimeIssue, recordRendererConsoleMessage } from '../diagnostics/DevConsoleService';
import { getAppSettings, setAppSettings } from './appSettings';
import { createMainWindowWebPreferences } from './createMainWindow';

const mainOutputDir = import.meta.dirname;
const petWindowTitle = 'ECHO Pet';
const visibleOverlap = 72;
const rememberBoundsDebounceMs = 250;

let petWindow: BrowserWindow | null = null;
let rememberBoundsTimer: ReturnType<typeof setTimeout> | null = null;
let destroyingPetWindow = false;

const boundsEqual = (a: PetBounds, b: PetBounds): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const normalizePetScalePercent = (value: unknown): number => {
  const scalePercent = Number(value);
  if (!Number.isFinite(scalePercent)) {
    return defaultPetScalePercent;
  }
  return Math.round(Math.max(petScalePercentMin, Math.min(petScalePercentMax, scalePercent)));
};

const resolvePetScalePercent = (): number => normalizePetScalePercent(getAppSettings().petScalePercent);
const resolvePetWindowSize = (scalePercent = resolvePetScalePercent()): number =>
  Math.round(petWindowBaseSize * scalePercent / 100);

const resolveLivePetWindow = (): BrowserWindow | null => {
  if (petWindow && !petWindow.isDestroyed()) {
    return petWindow;
  }

  petWindow = BrowserWindow.getAllWindows().find((window) => {
    if (window.isDestroyed()) {
      return false;
    }
    if (window.getTitle() === petWindowTitle) {
      return true;
    }
    try {
      return new URL(window.webContents.getURL()).searchParams.get('pet') === '1';
    } catch {
      return false;
    }
  }) ?? null;
  return petWindow;
};

const isBoundsVisible = (bounds: PetBounds): boolean =>
  screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    const requiredOverlap = Math.min(visibleOverlap, bounds.width, bounds.height);
    return overlapWidth >= requiredOverlap && overlapHeight >= requiredOverlap;
  });

const clampBoundsToVisibleArea = (bounds: PetBounds): PetBounds => {
  const area = screen.getDisplayMatching(bounds).workArea;
  const petWindowSize = resolvePetWindowSize();
  return {
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - petWindowSize))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - petWindowSize))),
    width: petWindowSize,
    height: petWindowSize,
  };
};

const resolveDefaultPetBounds = (): PetBounds => {
  const area = screen.getPrimaryDisplay().workArea;
  const petWindowSize = resolvePetWindowSize();
  return {
    x: Math.round(area.x + area.width - petWindowSize - 28),
    y: Math.round(area.y + area.height - petWindowSize - 28),
    width: petWindowSize,
    height: petWindowSize,
  };
};

export const resolveInitialPetBounds = (): PetBounds => {
  const savedBounds = getAppSettings().petBounds;
  if (savedBounds && isBoundsVisible(savedBounds)) {
    return clampBoundsToVisibleArea(savedBounds);
  }
  return resolveDefaultPetBounds();
};

const getWindowBounds = (window: BrowserWindow | null): PetBounds | null => {
  if (!window || window.isDestroyed()) {
    return null;
  }
  const bounds = window.getBounds();
  const normalized = clampBoundsToVisibleArea(bounds);
  if (!boundsEqual(bounds, normalized)) {
    window.setBounds(normalized);
  }
  return normalized;
};

export const getPetState = (): PetState => {
  const settings = getAppSettings();
  const window = resolveLivePetWindow();
  return {
    visible: Boolean(window?.isVisible()),
    bounds: getWindowBounds(window) ?? settings.petBounds ?? null,
    settings: {
      petEnabled: settings.petEnabled === true,
      petBounds: settings.petBounds ?? null,
      petScalePercent: normalizePetScalePercent(settings.petScalePercent),
    },
  };
};

const emitPetStateChanged = (): void => {
  const state = getPetState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.PetStateChanged, state);
    }
  }
};

const applyPetAlwaysOnTop = (window: BrowserWindow): void => {
  window.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
};

const applyPetScale = (window: BrowserWindow, scalePercent = resolvePetScalePercent()): void => {
  window.webContents.setZoomFactor(scalePercent / 100);
};

const rememberPetBounds = (window: BrowserWindow): void => {
  if (window.isDestroyed()) {
    return;
  }
  const bounds = getWindowBounds(window);
  if (bounds) {
    setAppSettings({ petBounds: bounds });
    emitPetStateChanged();
  }
};

const scheduleRememberPetBounds = (window: BrowserWindow): void => {
  if (rememberBoundsTimer !== null) {
    clearTimeout(rememberBoundsTimer);
  }
  rememberBoundsTimer = setTimeout(() => {
    rememberBoundsTimer = null;
    rememberPetBounds(window);
  }, rememberBoundsDebounceMs);
};

const loadPetRenderer = (window: BrowserWindow): void => {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL('/auxiliary.html', process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set('pet', '1');
    void window.loadURL(url.toString());
    return;
  }

  void window.loadFile(join(mainOutputDir, '../renderer/auxiliary.html'), {
    query: { pet: '1' },
  });
};

export const createPetWindow = (): BrowserWindow => {
  const existingWindow = resolveLivePetWindow();
  if (existingWindow) {
    getWindowBounds(existingWindow);
    return existingWindow;
  }

  const window = new BrowserWindow({
    ...resolveInitialPetBounds(),
    title: petWindowTitle,
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

  petWindow = window;
  window.setMenuBarVisibility(false);
  applyPetScale(window);
  window.webContents.on('console-message', (details) => recordRendererConsoleMessage(details));
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    recordMainRuntimeIssue('pet-load-failed', errorDescription || 'Pet renderer failed to load', {
      reason: validatedURL,
      exitCode: errorCode,
      sourceId: isMainFrame ? 'main-frame' : 'sub-frame',
    });
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    recordMainRuntimeIssue('pet-preload-error', error.message, {
      stack: error.stack,
      sourceId: preloadPath,
    });
  });
  applyPetAlwaysOnTop(window);

  window.once('ready-to-show', () => {
    getWindowBounds(window);
    if (getAppSettings().petEnabled === true) {
      window.showInactive();
      applyPetAlwaysOnTop(window);
    }
  });
  window.on('show', () => {
    applyPetAlwaysOnTop(window);
    emitPetStateChanged();
  });
  window.on('hide', emitPetStateChanged);
  window.on('move', () => scheduleRememberPetBounds(window));
  window.on('close', (event) => {
    if (destroyingPetWindow) {
      return;
    }
    event.preventDefault();
    hidePetWindow();
  });
  window.on('closed', () => {
    if (rememberBoundsTimer !== null) {
      clearTimeout(rememberBoundsTimer);
      rememberBoundsTimer = null;
    }
    petWindow = null;
    emitPetStateChanged();
  });

  loadPetRenderer(window);
  return window;
};

export const showPetWindow = (): PetState => {
  setAppSettings({ petEnabled: true });
  const window = createPetWindow();
  getWindowBounds(window);
  if (!window.isVisible()) {
    window.showInactive();
  }
  applyPetAlwaysOnTop(window);
  emitPetStateChanged();
  return getPetState();
};

export const hidePetWindow = (): PetState => {
  setAppSettings({ petEnabled: false });
  closePetWindow();
  emitPetStateChanged();
  return getPetState();
};

export const resetPetBounds = (): PetState => {
  const bounds = resolveDefaultPetBounds();
  setAppSettings({ petBounds: bounds });
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setBounds(bounds);
    applyPetAlwaysOnTop(petWindow);
  }
  emitPetStateChanged();
  return getPetState();
};

export const movePetWindow = (position: unknown): void => {
  if (!position || typeof position !== 'object' || Array.isArray(position)) {
    return;
  }
  const input = position as Partial<Pick<PetBounds, 'x' | 'y'>>;
  const x = Number(input.x);
  const y = Number(input.y);
  const window = resolveLivePetWindow();
  if (!window || !Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  const currentBounds = window.getBounds();
  const nextBounds = clampBoundsToVisibleArea({
    x: Math.round(x),
    y: Math.round(y),
    width: currentBounds.width,
    height: currentBounds.height,
  });
  window.setBounds(nextBounds);
};

export const setPetScale = (value: unknown): PetState => {
  const scalePercent = normalizePetScalePercent(value);
  const window = resolveLivePetWindow();
  const settings = getAppSettings();
  const currentBounds = window && !window.isDestroyed() ? window.getBounds() : settings.petBounds;
  setAppSettings({ petScalePercent: scalePercent });

  if (currentBounds) {
    const size = resolvePetWindowSize(scalePercent);
    const resizedBounds = clampBoundsToVisibleArea({
      x: Math.round(currentBounds.x + (currentBounds.width - size) / 2),
      y: Math.round(currentBounds.y + (currentBounds.height - size) / 2),
      width: size,
      height: size,
    });
    setAppSettings({ petBounds: resizedBounds });
    if (window && !window.isDestroyed()) {
      applyPetScale(window, scalePercent);
      window.setBounds(resizedBounds);
      applyPetAlwaysOnTop(window);
    }
  }

  emitPetStateChanged();
  return getPetState();
};

export const restorePetWindowOnStartup = (): void => {
  if (getAppSettings().petEnabled === true) {
    showPetWindow();
  }
};

export function closePetWindow(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = null;
    return;
  }
  if (rememberBoundsTimer !== null) {
    clearTimeout(rememberBoundsTimer);
    rememberBoundsTimer = null;
  }
  rememberPetBounds(petWindow);
  destroyingPetWindow = true;
  petWindow.destroy();
  destroyingPetWindow = false;
}
