import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import sharp from 'sharp';

// Thin wrapper around the native echo-taskbar-thumbnail-helper.node addon.
// The addon makes the Electron main window present a supplied bitmap as its
// DWM iconic thumbnail while the native side keeps live preview on the window.

const addonFileName = 'echo-taskbar-thumbnail-helper.node';

// Covers are decoded to this square size and handed to the native side; DWM
// scales down from here for the small hover thumbnail.
const coverRenderSize = 512;

export type TaskbarThumbnailDiagnostics = {
  forced: boolean;
  hasMaster: boolean;
  thumbnailRequests: number;
  livePreviewRequests: number;
  lastThumbnailHr: number;
  lastLivePreviewHr: number;
  lastLivePreviewCaptured: boolean;
};

type TaskbarThumbnailAddon = {
  attach: (hwnd: Buffer) => boolean;
  setCover: (rgba: Buffer, width: number, height: number) => boolean;
  refresh: () => boolean;
  clear: () => boolean;
  detach: () => void;
  getState?: () => TaskbarThumbnailDiagnostics;
};

const resolveAddonPath = (): string => {
  if (app.isPackaged) {
    return join(process.resourcesPath, addonFileName);
  }
  return join(app.getAppPath(), 'electron-app', 'build', addonFileName);
};

let addonLoadAttempted = false;
let addon: TaskbarThumbnailAddon | null = null;

const loadAddon = (): TaskbarThumbnailAddon | null => {
  if (addonLoadAttempted) {
    return addon;
  }
  addonLoadAttempted = true;

  if (process.platform !== 'win32') {
    return null;
  }

  const addonPath = resolveAddonPath();
  if (!existsSync(addonPath)) {
    return null;
  }

  try {
    const require = createRequire(import.meta.url);
    const loaded = require(addonPath) as TaskbarThumbnailAddon;
    if (
      typeof loaded?.attach === 'function' &&
      typeof loaded?.setCover === 'function' &&
      typeof loaded?.refresh === 'function' &&
      typeof loaded?.clear === 'function' &&
      typeof loaded?.detach === 'function'
    ) {
      addon = loaded;
    }
  } catch {
    addon = null;
  }

  return addon;
};

// __CHUNK_MARKER__

export type TaskbarThumbnailCoverDeps = {
  getNativeWindowHandle: () => Buffer;
  loadAddon?: () => TaskbarThumbnailAddon | null;
  decodeCover?: (coverPath: string) => Promise<{ data: Buffer; width: number; height: number } | null>;
};

const decodeCoverToRgba = async (
  coverPath: string,
): Promise<{ data: Buffer; width: number; height: number } | null> => {
  try {
    const { data, info } = await sharp(coverPath, { animated: false })
      .resize(coverRenderSize, coverRenderSize, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
};

/**
 * Drives the native iconic-thumbnail addon for one window. Safe to construct
 * even when the addon is missing: `isAvailable()` reports false and all
 * mutating calls become no-ops so the caller can fall back to clip mode.
 */
export class TaskbarThumbnailCoverController {
  private readonly getNativeWindowHandle: () => Buffer;
  private readonly addon: TaskbarThumbnailAddon | null;
  private readonly decodeCover: (
    coverPath: string,
  ) => Promise<{ data: Buffer; width: number; height: number } | null>;
  private attached = false;
  private lastCoverPath: string | null = null;
  private applyToken = 0;

  constructor(deps: TaskbarThumbnailCoverDeps) {
    this.getNativeWindowHandle = deps.getNativeWindowHandle;
    this.addon = (deps.loadAddon ?? loadAddon)();
    this.decodeCover = deps.decodeCover ?? decodeCoverToRgba;
  }

  isAvailable(): boolean {
    return this.addon !== null;
  }

  private ensureAttached(): boolean {
    if (!this.addon) {
      return false;
    }
    if (this.attached) {
      return true;
    }
    try {
      this.attached = this.addon.attach(this.getNativeWindowHandle());
    } catch {
      this.attached = false;
    }
    return this.attached;
  }

  /**
   * Show `coverPath` (a jpg/jpeg/png file) as the taskbar thumbnail. Decoding
   * is async; the most recent call wins. Returns true if the addon accepted a
   * cover (or the same cover was already applied), false if unavailable.
   */
  async setCover(coverPath: string | null): Promise<boolean> {
    if (!this.addon) {
      return false;
    }
    if (!coverPath || !existsSync(coverPath)) {
      this.clear();
      return false;
    }
    if (!this.ensureAttached()) {
      return false;
    }
    if (coverPath === this.lastCoverPath) {
      return true;
    }

    const token = ++this.applyToken;
    const decoded = await this.decodeCover(coverPath);
    if (!decoded || token !== this.applyToken) {
      // A newer setCover/clear superseded this decode; drop the stale result.
      return false;
    }

    try {
      const applied = this.addon.setCover(decoded.data, decoded.width, decoded.height);
      if (applied) {
        this.lastCoverPath = coverPath;
      }
      return applied;
    } catch {
      return false;
    }
  }

  /** Restore the live window preview (drop the cover bitmap). */
  clear(): void {
    this.applyToken += 1;
    this.lastCoverPath = null;
    if (!this.addon || !this.attached) {
      return;
    }
    try {
      this.addon.clear();
    } catch {
      // ignore failures restoring the default preview
    }
  }

  /** Read native-side diagnostic counters, or null if unavailable. */
  getDiagnostics(): TaskbarThumbnailDiagnostics | null {
    if (!this.addon || typeof this.addon.getState !== 'function') {
      return null;
    }
    try {
      return this.addon.getState();
    } catch {
      return null;
    }
  }

  /** Detach the window subclass. Call before the window is destroyed. */
  dispose(): void {
    this.applyToken += 1;
    this.lastCoverPath = null;
    if (!this.addon || !this.attached) {
      return;
    }
    try {
      this.addon.detach();
    } catch {
      // ignore detach failures during teardown
    }
    this.attached = false;
  }
}
