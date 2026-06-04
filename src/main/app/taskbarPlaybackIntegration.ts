import { basename } from 'node:path';
import { nativeImage, type BrowserWindow, type NativeImage } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AppSettings } from '../../shared/types/appSettings';
import type { AudioStatus } from '../../shared/types/audio';
import type { SmtcButtonCommand } from '../../shared/types/smtc';
import type { TaskbarPlaybackStatus } from '../../shared/types/taskbarPlayback';
import { getAudioSession } from '../audio/AudioSession';
import { getLibraryService } from '../library/LibraryService';
import { getAppSettings } from './appSettings';
import { getMainWindow } from './windowManager';

const defaultWindowTitle = 'ECHO NEXT';
const activeTitleSuffix = 'ECHO Next';

type TaskbarWindow = Pick<BrowserWindow, 'isDestroyed' | 'setProgressBar' | 'setThumbarButtons' | 'setTitle'> & {
  setThumbnailToolTip?: (toolTip: string) => void;
  webContents: Pick<BrowserWindow['webContents'], 'send'>;
};
type AudioStatusSource = {
  getStatus: () => AudioStatus;
  on: (event: 'status', listener: (status: AudioStatus) => void) => unknown;
  off: (event: 'status', listener: (status: AudioStatus) => void) => unknown;
};
type LibraryLike = {
  getTrack: (trackId: string) => { title?: string | null; artist?: string | null; albumArtist?: string | null } | null;
  isTrackLiked?: (trackId: string) => boolean;
  likeTrack?: (trackId: string) => unknown;
  unlikeTrack?: (trackId: string) => unknown;
};

type TaskbarPlaybackIntegrationOptions = {
  window: TaskbarWindow;
  audioSession?: AudioStatusSource;
  getSettings?: () => Pick<AppSettings, 'taskbarPlaybackControlsEnabled'>;
  getLibrary?: () => LibraryLike;
  platform?: NodeJS.Platform;
  createIcon?: (name: TaskbarIconName) => NativeImage | null;
};

type TaskbarIconName = 'previous' | 'play' | 'pause' | 'next' | 'heart' | 'heartFilled';

type CurrentTrackLikeState = {
  canLike: boolean;
  liked: boolean;
};

const taskbarIconMasks: Record<TaskbarIconName, readonly string[]> = {
  previous: [
    '0000000000000000',
    '0000000000000000',
    '0011000000100000',
    '0011000001100000',
    '0011000011100000',
    '0011000111100000',
    '0011001111100000',
    '0011011111100000',
    '0011011111100000',
    '0011001111100000',
    '0011000111100000',
    '0011000011100000',
    '0011000001100000',
    '0011000000100000',
    '0000000000000000',
    '0000000000000000',
  ],
  play: [
    '0000000000000000',
    '0000000000000000',
    '0001100000000000',
    '0001110000000000',
    '0001111000000000',
    '0001111100000000',
    '0001111110000000',
    '0001111111000000',
    '0001111111000000',
    '0001111110000000',
    '0001111100000000',
    '0001111000000000',
    '0001110000000000',
    '0001100000000000',
    '0000000000000000',
    '0000000000000000',
  ],
  pause: [
    '0000000000000000',
    '0000000000000000',
    '0001110001110000',
    '0001110001110000',
    '0001110001110000',
    '0001110001110000',
    '0001110001110000',
    '0001110001110000',
    '0001110001110000',
    '0001110001110000',
    '0001110001110000',
    '0001110001110000',
    '0001110001110000',
    '0001110001110000',
    '0000000000000000',
    '0000000000000000',
  ],
  next: [
    '0000000000000000',
    '0000000000000000',
    '0000010000001100',
    '0000011000001100',
    '0000011100001100',
    '0000011110001100',
    '0000011111001100',
    '0000011111101100',
    '0000011111101100',
    '0000011111001100',
    '0000011110001100',
    '0000011100001100',
    '0000011000001100',
    '0000010000001100',
    '0000000000000000',
    '0000000000000000',
  ],
  heart: [
    '0000000000000000',
    '0000000000000000',
    '0001100001100000',
    '0011110011110000',
    '0110011110011000',
    '0100001100001000',
    '0100000000001000',
    '0010000000010000',
    '0001000000100000',
    '0000100001000000',
    '0000010010000000',
    '0000001100000000',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
  ],
  heartFilled: [
    '0000000000000000',
    '0000000000000000',
    '0001100001100000',
    '0011110011110000',
    '0111111111111000',
    '0111111111111000',
    '0111111111111000',
    '0011111111110000',
    '0001111111100000',
    '0000111111000000',
    '0000011110000000',
    '0000001100000000',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
  ],
};

const createPngBufferFromMask = (mask: readonly string[], color: readonly [number, number, number] = [32, 41, 67]): Buffer => {
  const width = 16;
  const height = 16;
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const enabled = mask[y]?.[x] === '1';
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = enabled ? 255 : 0;
    }
  }

  return nativeImage.createFromBitmap(raw, { width, height }).toPNG();
};

const createTaskbarIcon = (name: TaskbarIconName): NativeImage | null => {
  try {
    const color: readonly [number, number, number] = name === 'heartFilled' ? [220, 38, 72] : [32, 41, 67];
    return nativeImage.createFromBuffer(createPngBufferFromMask(taskbarIconMasks[name], color));
  } catch {
    return null;
  }
};

const isTaskbarPlaybackVisible = (status: AudioStatus): boolean =>
  Boolean(status.currentTrackId || status.currentFilePath) &&
  status.state !== 'idle' &&
  status.state !== 'stopped' &&
  status.state !== 'ended' &&
  status.state !== 'error';

const safeProgress = (positionSeconds: number, durationSeconds: number): number | null => {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  return Math.max(0, Math.min(1, positionSeconds / durationSeconds));
};

const formatTitlePart = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const createEmptyStatus = (platform: NodeJS.Platform, bound: boolean, windowAvailable: boolean): TaskbarPlaybackStatus => ({
  platform,
  supported: platform === 'win32',
  bound,
  windowAvailable,
  enabled: false,
  visible: false,
  playbackState: null,
  title: defaultWindowTitle,
  progress: null,
  thumbarButtons: null,
  lastSyncAt: null,
  lastAppliedAt: null,
  lastClearedAt: null,
  lastError: null,
});

export class TaskbarPlaybackIntegration {
  private readonly window: TaskbarWindow;
  private readonly audioSession: AudioStatusSource;
  private readonly getSettings: () => Pick<AppSettings, 'taskbarPlaybackControlsEnabled'>;
  private readonly getLibrary: () => LibraryLike;
  private readonly platform: NodeJS.Platform;
  private readonly createIcon: (name: TaskbarIconName) => NativeImage | null;
  private disposed = false;
  private lastThumbarKey: string | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private status: TaskbarPlaybackStatus;
  private readonly handleStatus = (status: AudioStatus): void => {
    this.sync(status);
  };

  constructor(options: TaskbarPlaybackIntegrationOptions) {
    this.window = options.window;
    this.audioSession = options.audioSession ?? getAudioSession();
    this.getSettings = options.getSettings ?? getAppSettings;
    this.getLibrary = options.getLibrary ?? getLibraryService;
    this.platform = options.platform ?? process.platform;
    this.createIcon = options.createIcon ?? createTaskbarIcon;
    this.status = createEmptyStatus(this.platform, true, !this.window.isDestroyed());
  }

  initialize(): void {
    if (this.platform !== 'win32' || this.disposed) {
      return;
    }

    this.audioSession.on('status', this.handleStatus);
    this.sync(this.audioSession.getStatus());
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.audioSession.off('status', this.handleStatus);
    this.stopProgressTimer();
    this.clear();
  }

  refresh(): void {
    if (this.disposed || this.platform !== 'win32') {
      return;
    }

    this.sync(this.audioSession.getStatus());
  }

  getStatus(): TaskbarPlaybackStatus {
    return {
      ...this.status,
      bound: !this.disposed,
      windowAvailable: !this.window.isDestroyed(),
    };
  }

  private sync(status: AudioStatus): void {
    if (this.disposed || this.platform !== 'win32' || this.window.isDestroyed()) {
      return;
    }

    const enabled = this.getSettings().taskbarPlaybackControlsEnabled === true;
    const visible = enabled && isTaskbarPlaybackVisible(status);
    const progress = safeProgress(status.positionSeconds, status.durationSeconds);
    this.status = {
      ...this.status,
      enabled,
      visible,
      playbackState: status.state,
      progress,
      title: visible ? this.resolveTitle(status) : defaultWindowTitle,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    };

    if (!visible) {
      this.stopProgressTimer();
      this.clear();
      return;
    }

    try {
      this.updateProgress(status, progress);
      this.updateTitle(this.status.title);
      this.updateThumbarButtons(status);
      this.updateProgressTimer(status);
      this.status = {
        ...this.status,
        lastAppliedAt: new Date().toISOString(),
        lastError: null,
      };
    } catch (error) {
      this.status = {
        ...this.status,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private clear(): void {
    if (this.window.isDestroyed()) {
      return;
    }

    this.window.setProgressBar(-1);
    this.window.setThumbarButtons([]);
    this.window.setTitle(defaultWindowTitle);
    this.window.setThumbnailToolTip?.(defaultWindowTitle);
    this.lastThumbarKey = null;
    this.status = {
      ...this.status,
      title: defaultWindowTitle,
      progress: null,
      thumbarButtons: null,
      lastClearedAt: new Date().toISOString(),
    };
  }

  private updateProgressTimer(status: AudioStatus): void {
    if (status.state === 'playing' || status.state === 'loading') {
      this.startProgressTimer();
      return;
    }

    this.stopProgressTimer();
  }

  private startProgressTimer(): void {
    if (this.progressTimer) {
      return;
    }

    this.progressTimer = setInterval(() => {
      this.sync(this.audioSession.getStatus());
    }, 1000);
    this.progressTimer.unref?.();
  }

  private stopProgressTimer(): void {
    if (!this.progressTimer) {
      return;
    }

    clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private updateProgress(status: AudioStatus, progress: number | null): void {
    if (progress === null) {
      this.window.setProgressBar(-1);
      return;
    }

    this.window.setProgressBar(progress, { mode: status.state === 'paused' ? 'paused' : 'normal' });
  }

  private updateTitle(title: string): void {
    this.window.setTitle(title);
    this.window.setThumbnailToolTip?.(title);
  }

  private updateThumbarButtons(status: AudioStatus): void {
    const isPlaying = status.state === 'playing' || status.state === 'loading';
    const likeState = this.resolveCurrentTrackLikeState(status);
    const key = [
      isPlaying ? 'playing' : 'paused',
      likeState.canLike ? (likeState.liked ? 'liked' : 'unliked') : 'no-like',
    ].join(':');

    if (this.lastThumbarKey === key) {
      return;
    }

    const previousIcon = this.createIcon('previous');
    const playPauseIcon = this.createIcon(isPlaying ? 'pause' : 'play');
    const nextIcon = this.createIcon('next');
    const likeIcon = this.createIcon(likeState.liked ? 'heartFilled' : 'heart');

    if (
      !previousIcon ||
      !playPauseIcon ||
      !nextIcon ||
      !likeIcon ||
      previousIcon.isEmpty() ||
      playPauseIcon.isEmpty() ||
      nextIcon.isEmpty() ||
      likeIcon.isEmpty()
    ) {
      this.window.setThumbarButtons([]);
      this.lastThumbarKey = null;
      this.status = {
        ...this.status,
        thumbarButtons: null,
        lastError: 'Taskbar button icons were empty',
      };
      return;
    }

    const applied = this.window.setThumbarButtons([
      {
        tooltip: 'Previous',
        icon: previousIcon,
        click: () => this.sendCommand('previous'),
      },
      {
        tooltip: isPlaying ? 'Pause' : 'Play',
        icon: playPauseIcon,
        click: () => this.sendCommand('playPause'),
      },
      {
        tooltip: 'Next',
        icon: nextIcon,
        click: () => this.sendCommand('next'),
      },
      {
        tooltip: likeState.liked ? 'Unlike' : 'Like',
        icon: likeIcon,
        ...(likeState.canLike ? {} : { flags: ['disabled'] }),
        click: () => this.toggleCurrentTrackLiked(status),
      },
    ]);
    if (applied === false) {
      this.status = {
        ...this.status,
        lastError: 'Windows rejected taskbar thumbnail buttons',
      };
      return;
    }
    this.lastThumbarKey = key;
    this.status = {
      ...this.status,
      thumbarButtons: isPlaying ? 'playing' : 'paused',
    };
  }

  private sendCommand(command: SmtcButtonCommand): void {
    if (this.window.isDestroyed()) {
      return;
    }

    this.window.webContents.send(IpcChannels.SmtcCommand, command);
  }

  private resolveCurrentTrackLikeState(status: AudioStatus): CurrentTrackLikeState {
    const trackId = status.currentTrackId;
    if (!trackId) {
      return { canLike: false, liked: false };
    }

    try {
      const library = this.getLibrary();
      const track = library.getTrack(trackId);
      const canLike = Boolean(track && library.isTrackLiked && library.likeTrack && library.unlikeTrack);
      return {
        canLike,
        liked: canLike ? library.isTrackLiked?.(trackId) === true : false,
      };
    } catch {
      return { canLike: false, liked: false };
    }
  }

  private toggleCurrentTrackLiked(status: AudioStatus): void {
    const trackId = status.currentTrackId;
    if (!trackId) {
      return;
    }

    try {
      const library = this.getLibrary();
      const likeState = this.resolveCurrentTrackLikeState(status);
      if (!likeState.canLike) {
        return;
      }

      if (likeState.liked) {
        library.unlikeTrack?.(trackId);
      } else {
        library.likeTrack?.(trackId);
      }

      this.lastThumbarKey = null;
      this.window.webContents.send(IpcChannels.LibraryLikedTracksChanged);
      this.sync(this.audioSession.getStatus());
    } catch (error) {
      this.status = {
        ...this.status,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private resolveTitle(status: AudioStatus): string {
    let title: string | null = null;
    let artist: string | null = null;

    if (status.currentTrackId) {
      try {
        const track = this.getLibrary().getTrack(status.currentTrackId);
        title = formatTitlePart(track?.title);
        artist = formatTitlePart(track?.artist) ?? formatTitlePart(track?.albumArtist);
      } catch {
        title = null;
        artist = null;
      }
    }

    title ??= formatTitlePart(status.currentTrackTitle);
    artist ??= formatTitlePart(status.currentTrackArtist) ?? formatTitlePart(status.currentTrackAlbumArtist);
    title ??= status.currentFilePath ? basename(status.currentFilePath) : null;

    if (!title) {
      return defaultWindowTitle;
    }

    return artist ? `${title} - ${artist} | ${activeTitleSuffix}` : `${title} | ${activeTitleSuffix}`;
  }
}

let currentIntegration: TaskbarPlaybackIntegration | null = null;

export const bindTaskbarPlaybackIntegration = (window: BrowserWindow): void => {
  currentIntegration?.dispose();
  const integration = new TaskbarPlaybackIntegration({ window });
  currentIntegration = integration;
  integration.initialize();
  window.on('closed', () => {
    if (currentIntegration === integration) {
      currentIntegration = null;
    }
    integration.dispose();
  });
};

export const refreshTaskbarPlaybackIntegration = (): void => {
  if (!currentIntegration) {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) {
      return;
    }

    bindTaskbarPlaybackIntegration(window);
    return;
  }

  currentIntegration.refresh();
};

export const getTaskbarPlaybackStatus = (): TaskbarPlaybackStatus => {
  if (!currentIntegration) {
    const window = getMainWindow();
    return createEmptyStatus(process.platform, false, Boolean(window && !window.isDestroyed()));
  }

  return currentIntegration.getStatus();
};

export const disposeTaskbarPlaybackIntegrationForTests = (): void => {
  currentIntegration?.dispose();
  currentIntegration = null;
};
