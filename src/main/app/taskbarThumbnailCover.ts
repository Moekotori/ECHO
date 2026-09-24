import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, net } from 'electron';
import sharp from 'sharp';
import { readResponseBodyLimited } from '../network/readResponseBodyLimited';

type NativeTaskbarThumbnailHelper = {
  attach: (windowHandle: Buffer) => boolean;
  setCover: (rgba: Buffer, width: number, height: number) => boolean;
  setButtons: (playing: boolean, canLike: boolean, liked: boolean, visible: boolean) => boolean;
  setButtonHandler: (handler: (buttonId: number) => void) => boolean;
  clear: () => void;
  detach: () => void;
};

export type TaskbarThumbnailButtons = {
  playing: boolean;
  canLike: boolean;
  liked: boolean;
  visible: boolean;
};

export type DecodedTaskbarCover = { data: Buffer; width: number; height: number };

export type TaskbarThumbnailCoverControllerOptions = {
  getNativeWindowHandle: () => Buffer;
  onButtonClick: (buttonId: number) => void;
  loadHelper?: () => NativeTaskbarThumbnailHelper | null;
  decodeCover?: (url: string, signal?: AbortSignal) => Promise<DecodedTaskbarCover | null>;
};

const helperFileName = 'echo-taskbar-thumbnail-helper.node';
const maximumCoverDimension = 512;
const maximumEncodedCoverBytes = 8 * 1024 * 1024;
const maximumInputPixels = 4096 * 4096;

const resolveHelperPath = (): string | null => {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, helperFileName)]
    : [
        join(app.getAppPath(), 'electron-app', 'build', helperFileName),
        join(process.cwd(), 'electron-app', 'build', helperFileName),
      ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

let cachedHelper: NativeTaskbarThumbnailHelper | null | undefined;

const loadNativeHelper = (): NativeTaskbarThumbnailHelper | null => {
  if (cachedHelper !== undefined) return cachedHelper;
  cachedHelper = null;
  if (process.platform !== 'win32') return cachedHelper;

  const helperPath = resolveHelperPath();
  if (!helperPath) return cachedHelper;
  try {
    const loaded = createRequire(import.meta.url)(helperPath) as Partial<NativeTaskbarThumbnailHelper>;
    if (
      typeof loaded.attach === 'function' &&
      typeof loaded.setCover === 'function' &&
      typeof loaded.setButtons === 'function' &&
      typeof loaded.setButtonHandler === 'function' &&
      typeof loaded.clear === 'function' &&
      typeof loaded.detach === 'function'
    ) {
      cachedHelper = loaded as NativeTaskbarThumbnailHelper;
    }
  } catch {
    cachedHelper = null;
  }
  return cachedHelper;
};

const decodeCover = async (url: string, signal?: AbortSignal): Promise<DecodedTaskbarCover | null> => {
  try {
    const response = await net.fetch(url, { signal });
    if (!response.ok) return null;
    const encoded = Buffer.from(await readResponseBodyLimited(response, maximumEncodedCoverBytes, { signal }));
    if (encoded.length === 0 || signal?.aborted) return null;
    const result = await sharp(encoded, { animated: false, limitInputPixels: maximumInputPixels })
      .resize(maximumCoverDimension, maximumCoverDimension, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return signal?.aborted ? null : { data: result.data, width: result.info.width, height: result.info.height };
  } catch {
    return null;
  }
};

export class TaskbarThumbnailCoverController {
  private readonly helper: NativeTaskbarThumbnailHelper | null;
  private readonly getNativeWindowHandle: () => Buffer;
  private readonly onButtonClick: (buttonId: number) => void;
  private readonly decodeCover: (url: string, signal?: AbortSignal) => Promise<DecodedTaskbarCover | null>;
  private attached = false;
  private handlerAttached = false;
  private lastCoverUrl: string | null = null;
  private requestToken = 0;
  private coverAbortController: AbortController | null = null;

  constructor(options: TaskbarThumbnailCoverControllerOptions) {
    this.helper = (options.loadHelper ?? loadNativeHelper)();
    this.getNativeWindowHandle = options.getNativeWindowHandle;
    this.onButtonClick = options.onButtonClick;
    this.decodeCover = options.decodeCover ?? decodeCover;
  }

  isAvailable(): boolean {
    return this.helper !== null;
  }

  async setCover(url: string | null): Promise<boolean> {
    if (!url || !this.ensureAttached()) {
      this.clear();
      return false;
    }
    if (url === this.lastCoverUrl) return true;

    this.coverAbortController?.abort();
    const controller = new AbortController();
    this.coverAbortController = controller;
    const token = ++this.requestToken;
    let decoded: DecodedTaskbarCover | null;
    try {
      decoded = await this.decodeCover(url, controller.signal);
    } catch {
      decoded = null;
    } finally {
      if (this.coverAbortController === controller) this.coverAbortController = null;
    }
    if (!decoded || token !== this.requestToken || !this.helper) return false;
    try {
      const applied = this.helper.setCover(decoded.data, decoded.width, decoded.height);
      if (applied) this.lastCoverUrl = url;
      return applied;
    } catch {
      return false;
    }
  }

  setButtons(buttons: TaskbarThumbnailButtons): boolean {
    if (!this.helper) return false;
    if (!this.attached && !buttons.visible) return true;
    if (!this.ensureAttached()) return false;
    try {
      return this.helper.setButtons(buttons.playing, buttons.canLike, buttons.liked, buttons.visible);
    } catch {
      return false;
    }
  }

  clear(): void {
    this.coverAbortController?.abort();
    this.coverAbortController = null;
    this.requestToken += 1;
    this.lastCoverUrl = null;
    if (!this.helper || !this.attached) return;
    try {
      this.helper.clear();
    } catch {
      // The normal Electron thumbnail remains the fallback.
    }
  }

  dispose(): void {
    this.coverAbortController?.abort();
    this.coverAbortController = null;
    this.requestToken += 1;
    this.lastCoverUrl = null;
    if (this.helper && this.attached) {
      try {
        this.helper.detach();
      } catch {
        // The process is shutting down; no recovery is needed.
      }
    }
    this.attached = false;
    this.handlerAttached = false;
  }

  private ensureAttached(): boolean {
    if (!this.helper) return false;
    if (!this.attached) {
      try {
        this.attached = this.helper.attach(this.getNativeWindowHandle());
      } catch {
        this.attached = false;
      }
    }
    if (this.attached && !this.handlerAttached) {
      try {
        this.handlerAttached = this.helper.setButtonHandler(this.onButtonClick);
      } catch {
        this.handlerAttached = false;
      }
    }
    return this.attached;
  }
}
