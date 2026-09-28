import { BaseWindow } from 'electron';
import { basename } from 'node:path';
import type { AudioStatus } from '../../shared/types/audio';
import type { GlobalShortcutAction } from '../../shared/types/globalShortcuts';
import type { PlaybackOrderMode } from '../../shared/types/playback';
import { getAudioSession, getPlaybackSessionStore } from '../audioPublicApi';
import { getLibraryService } from '../library/LibraryService';
import { resolveAppIconPath } from './appIcon';
import { TaskbarThumbnailCoverController, type TaskbarThumbnailButtons } from './taskbarThumbnailCover';

type UltraLightTaskbarPlaybackAction = Extract<
  GlobalShortcutAction,
  'previousTrack' | 'playPause' | 'nextTrack' | 'toggleCurrentTrackLiked'
>;

export type UltraLightTaskbarRestoreOptions = {
  deferPresentation?: boolean;
  onRestore: () => unknown | Promise<unknown>;
  onPlaybackAction: (action: UltraLightTaskbarPlaybackAction) => unknown | Promise<unknown>;
  onPlaybackOrderCycle: () => unknown | Promise<unknown>;
};

const playbackActionsByButtonId: Record<number, UltraLightTaskbarPlaybackAction> = {
  1: 'previousTrack',
  2: 'playPause',
  3: 'nextTrack',
  4: 'toggleCurrentTrackLiked',
};

const resolvePlaybackOrderMode = (): PlaybackOrderMode => {
  try {
    // The cached mode avoids re-parsing the full persisted queue payload on
    // every Audio Core status tick.
    const mode = getPlaybackSessionStore().getPlaybackMode();
    return mode?.isShuffleEnabled
      ? 'shuffle'
      : mode?.repeatMode === 'one'
        ? 'repeat-one'
        : 'sequential';
  } catch {
    return 'sequential';
  }
};

let restoreWindow: BaseWindow | null = null;
let restoreRequested = false;
let coverController: TaskbarThumbnailCoverController | null = null;
let audioStatusListener: ((status: AudioStatus) => void) | null = null;
let restoreOptions: UltraLightTaskbarRestoreOptions | null = null;
let lastPresentationKey: string | null = null;

/**
 * Status fields that can change what the taskbar shows. Position/level ticks
 * arrive several times per second while playing and must not reach the
 * library, the window title or the native thumbbar when nothing changed.
 */
const createPresentationKey = (status: AudioStatus, playbackOrderMode: PlaybackOrderMode): string => [
  status.state,
  status.currentTrackId ?? '',
  status.currentFilePath ?? '',
  status.currentTrackTitle ?? '',
  status.currentTrackArtist ?? '',
  status.currentTrackAlbumArtist ?? '',
  playbackOrderMode,
].join('\u0000');

const resolveTaskbarPresentation = (status: AudioStatus, playbackOrderMode: PlaybackOrderMode): {
  artworkUrl: string | null;
  buttons: TaskbarThumbnailButtons;
  title: string;
} => {
  let title = status.currentTrackTitle?.trim() || null;
  let artist = status.currentTrackArtist?.trim() || status.currentTrackAlbumArtist?.trim() || null;
  let coverId: string | null = null;
  let canLike = false;
  let liked = false;

  if (status.currentTrackId) {
    try {
      const library = getLibraryService();
      const track = library.getTrack(status.currentTrackId);
      title = track?.title?.trim() || title;
      artist = track?.artist?.trim() || track?.albumArtist?.trim() || artist;
      coverId = track?.coverId?.trim() || null;
      canLike = Boolean(track);
      liked = track ? library.isTrackLiked(status.currentTrackId) : false;
    } catch {
      // The host-backed status still provides a safe title and playback state.
    }
  }

  title ??= status.currentFilePath ? basename(status.currentFilePath) : null;
  const hasPlayback = Boolean(status.currentTrackId || status.currentFilePath)
    && status.state !== 'idle'
    && status.state !== 'stopped'
    && status.state !== 'ended'
    && status.state !== 'error';

  return {
    artworkUrl: coverId ? `echo-cover://large/${encodeURIComponent(coverId)}` : null,
    buttons: {
      playing: status.state === 'playing' || status.state === 'loading',
      canLike,
      liked,
      visible: hasPlayback,
      playbackOrder: playbackOrderMode,
    },
    title: title ? (artist ? `${title} - ${artist} | ECHO` : `${title} | ECHO`) : 'ECHO',
  };
};

const refreshTaskbarPresentation = (
  status = getAudioSession().getStatus(),
  options: { force?: boolean } = {},
): void => {
  const window = restoreWindow;
  const controller = coverController;
  if (!window || window.isDestroyed() || !controller) return;

  const playbackOrderMode = resolvePlaybackOrderMode();
  const presentationKey = createPresentationKey(status, playbackOrderMode);
  if (options.force !== true && presentationKey === lastPresentationKey) return;
  lastPresentationKey = presentationKey;

  const presentation = resolveTaskbarPresentation(status, playbackOrderMode);
  window.setTitle(presentation.title);

  if (presentation.artworkUrl) {
    controller.setButtons(presentation.buttons);
    void controller.setCover(presentation.artworkUrl).catch(() => undefined);
  } else {
    // Remove stale artwork, then recreate the renderer-free native proxy so
    // coverless tracks still expose playback buttons.
    controller.clear();
    controller.setButtons(presentation.buttons);
  }
};

const disposeTaskbarPresentation = (): void => {
  if (audioStatusListener) {
    try {
      getAudioSession().off('status', audioStatusListener);
    } catch {
      // Audio Core may already be shutting down.
    }
    audioStatusListener = null;
  }
  coverController?.dispose();
  coverController = null;
  lastPresentationKey = null;
};

/**
 * Forces the next presentation update even when the audio status is unchanged,
 * e.g. after a like toggle that the status payload does not carry.
 */
export const refreshUltraLightTaskbarPresentation = (): void => {
  refreshTaskbarPresentation(undefined, { force: true });
};

const requestUltraLightRestore = (
  window: BaseWindow,
  options: UltraLightTaskbarRestoreOptions,
): void => {
  if (restoreRequested || window.isDestroyed()) return;
  restoreRequested = true;
  // Keep the renderer-free window minimized until the real main window is
  // ready. This avoids exposing a blank native shell during restoration.
  window.minimize();
  void Promise.resolve(options.onRestore()).catch((error) => {
    restoreRequested = false;
    console.warn('[UltraLightMode] taskbar restore request failed', error);
  });
};

export const activateUltraLightTaskbarRestorePresentation = (): boolean => {
  const window = restoreWindow;
  const options = restoreOptions;
  if (!window || window.isDestroyed() || !options) return false;
  if (coverController) return true;

  coverController = new TaskbarThumbnailCoverController({
    getNativeWindowHandle: () => window.getNativeWindowHandle(),
    onButtonClick: (buttonId) => {
      if (buttonId === 0) {
        requestUltraLightRestore(window, options);
        return;
      }
      if (buttonId === 5) {
        void Promise.resolve(options.onPlaybackOrderCycle())
          .catch((error) => console.warn('[UltraLightMode] taskbar playback order change failed', error))
          .finally(() => refreshTaskbarPresentation(undefined, { force: true }));
        return;
      }
      const action = playbackActionsByButtonId[buttonId];
      if (!action) return;
      void Promise.resolve(options.onPlaybackAction(action))
        .catch((error) => console.warn(`[UltraLightMode] taskbar ${action} failed`, error))
        .finally(() => refreshTaskbarPresentation(undefined, { force: true }));
    },
  });
  lastPresentationKey = null;
  audioStatusListener = (status) => refreshTaskbarPresentation(status);
  getAudioSession().on('status', audioStatusListener);
  refreshTaskbarPresentation();
  return true;
};

export const destroyUltraLightTaskbarRestoreWindow = (): void => {
  const window = restoreWindow;
  restoreWindow = null;
  restoreRequested = false;
  restoreOptions = null;
  disposeTaskbarPresentation();
  if (window && !window.isDestroyed()) {
    window.destroy();
  }
};

export const showUltraLightTaskbarRestoreWindow = (
  options: UltraLightTaskbarRestoreOptions,
): boolean => {
  if (process.platform !== 'win32') return false;

  destroyUltraLightTaskbarRestoreWindow();
  const appIconPath = resolveAppIconPath();
  const window = new BaseWindow({
    width: 320,
    height: 180,
    x: -32_000,
    y: -32_000,
    show: false,
    title: 'ECHO',
    icon: appIconPath ?? undefined,
    skipTaskbar: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    resizable: false,
    movable: false,
    closable: false,
    hasShadow: false,
    opacity: 0,
  });
  restoreWindow = window;
  restoreRequested = false;
  restoreOptions = options;

  window.on('restore', () => requestUltraLightRestore(window, options));
  window.on('closed', () => {
    if (restoreWindow === window) {
      restoreWindow = null;
      restoreRequested = false;
      restoreOptions = null;
      disposeTaskbarPresentation();
    }
  });

  if (options.deferPresentation !== true) {
    activateUltraLightTaskbarRestorePresentation();
  }
  window.setSkipTaskbar(false);
  window.showInactive();
  window.minimize();
  return true;
};

export const hasUltraLightTaskbarRestoreWindow = (): boolean =>
  Boolean(restoreWindow && !restoreWindow.isDestroyed());
