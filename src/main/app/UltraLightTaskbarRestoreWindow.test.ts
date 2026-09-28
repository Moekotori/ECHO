import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const windowListeners = new Map<string, (...args: unknown[]) => void>();
  let statusListener: ((status: Record<string, unknown>) => void) | null = null;
  let coverOptions: { onButtonClick: (buttonId: number) => void } | null = null;
  let destroyed = false;
  const status = {
    currentFilePath: 'C:\\Music\\song.flac',
    currentTrackAlbumArtist: null,
    currentTrackArtist: 'Artist',
    currentTrackId: 'track-1',
    currentTrackTitle: 'Status title',
    state: 'playing',
  };
  const window = {
    destroy: vi.fn(() => { destroyed = true; }),
    getNativeWindowHandle: vi.fn(() => Buffer.alloc(8, 1)),
    isDestroyed: vi.fn(() => destroyed),
    minimize: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      windowListeners.set(event, listener);
    }),
    setSkipTaskbar: vi.fn(),
    setTitle: vi.fn(),
    showInactive: vi.fn(),
  };
  const coverController = {
    clear: vi.fn(),
    dispose: vi.fn(),
    setButtons: vi.fn(() => true),
    setCover: vi.fn(async () => true),
  };
  const audioSession = {
    getStatus: vi.fn(() => status),
    off: vi.fn((_event: string, listener: (next: Record<string, unknown>) => void) => {
      if (statusListener === listener) statusListener = null;
    }),
    on: vi.fn((_event: string, listener: (next: Record<string, unknown>) => void) => {
      statusListener = listener;
    }),
  };
  const library = {
    getTrack: vi.fn((): {
      albumArtist: string | null;
      artist: string;
      coverId: string | null;
      title: string;
    } => ({
      albumArtist: null,
      artist: 'Library artist',
      coverId: 'cover 1',
      title: 'Library title',
    })),
    isTrackLiked: vi.fn(() => true),
  };
  const playbackSession = {
    mode: { isShuffleEnabled: false, repeatMode: 'off' },
  };
  return {
    audioSession,
    BaseWindow: vi.fn(function BaseWindowMock() { return window; }),
    Controller: vi.fn(function ControllerMock(options: { onButtonClick: (buttonId: number) => void }) {
      coverOptions = options;
      return coverController;
    }),
    coverController,
    getCoverOptions: () => coverOptions,
    getStatusListener: () => statusListener,
    library,
    playbackSession,
    reset: () => {
      destroyed = false;
      coverOptions = null;
      statusListener = null;
      windowListeners.clear();
      Object.assign(status, {
        currentFilePath: 'C:\\Music\\song.flac',
        currentTrackAlbumArtist: null,
        currentTrackArtist: 'Artist',
        currentTrackId: 'track-1',
        currentTrackTitle: 'Status title',
        state: 'playing',
      });
      Object.assign(playbackSession.mode, { isShuffleEnabled: false, repeatMode: 'off' });
    },
    status,
    window,
    windowListeners,
  };
});

vi.mock('electron', () => ({ BaseWindow: mocks.BaseWindow }));
vi.mock('../audioPublicApi', () => ({
  getAudioSession: () => mocks.audioSession,
  getPlaybackSessionStore: () => ({
    getPlaybackMode: () => mocks.playbackSession.mode,
    load: () => {
      throw new Error('full session parse must not run on status ticks');
    },
  }),
}));
vi.mock('../library/LibraryService', () => ({ getLibraryService: () => mocks.library }));
vi.mock('./appIcon', () => ({ resolveAppIconPath: () => 'C:\\ECHO\\echo.ico' }));
vi.mock('./taskbarThumbnailCover', () => ({ TaskbarThumbnailCoverController: mocks.Controller }));

describe('UltraLightTaskbarRestoreWindow', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.reset();
  });

  it('keeps a renderer-free taskbar preview with host-backed artwork and controls', async () => {
    const onRestore = vi.fn(async () => undefined);
    const onPlaybackAction = vi.fn(async () => undefined);
    const onPlaybackOrderCycle = vi.fn(async () => {
      mocks.playbackSession.mode.isShuffleEnabled = true;
    });
    const {
      hasUltraLightTaskbarRestoreWindow,
      showUltraLightTaskbarRestoreWindow,
    } = await import('./UltraLightTaskbarRestoreWindow');

    expect(showUltraLightTaskbarRestoreWindow({ onPlaybackAction, onPlaybackOrderCycle, onRestore })).toBe(true);
    expect(mocks.BaseWindow).toHaveBeenCalledWith(expect.objectContaining({
      title: 'ECHO',
      icon: 'C:\\ECHO\\echo.ico',
      show: false,
      skipTaskbar: false,
      opacity: 0,
    }));
    expect(mocks.window.setTitle).toHaveBeenCalledWith('Library title - Library artist | ECHO');
    expect(mocks.coverController.setButtons).toHaveBeenCalledWith({
      playing: true,
      canLike: true,
      liked: true,
      visible: true,
    });
    expect(mocks.coverController.setCover).toHaveBeenCalledWith('echo-cover://large/cover%201');
    expect(mocks.audioSession.on).toHaveBeenCalledWith('status', expect.any(Function));
    expect(mocks.window.setSkipTaskbar).toHaveBeenCalledWith(false);
    expect(mocks.window.showInactive).toHaveBeenCalledTimes(1);
    expect(mocks.window.minimize).toHaveBeenCalledTimes(1);
    expect(hasUltraLightTaskbarRestoreWindow()).toBe(true);

    mocks.getCoverOptions()?.onButtonClick(2);
    await vi.waitFor(() => expect(onPlaybackAction).toHaveBeenCalledWith('playPause'));

    mocks.getCoverOptions()?.onButtonClick(5);
    await vi.waitFor(() => expect(onPlaybackOrderCycle).toHaveBeenCalledTimes(1));

    mocks.status.state = 'paused';
    mocks.getStatusListener()?.(mocks.status);
    expect(mocks.coverController.setButtons).toHaveBeenLastCalledWith(expect.objectContaining({ playing: false }));

    mocks.getCoverOptions()?.onButtonClick(0);
    await vi.waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    mocks.windowListeners.get('restore')?.();
    mocks.windowListeners.get('restore')?.();
    await Promise.resolve();
    expect(mocks.window.minimize).toHaveBeenCalledTimes(2);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('cleans up the native preview and Audio Core listener', async () => {
    const {
      destroyUltraLightTaskbarRestoreWindow,
      showUltraLightTaskbarRestoreWindow,
    } = await import('./UltraLightTaskbarRestoreWindow');

    showUltraLightTaskbarRestoreWindow({
      onPlaybackAction: () => undefined,
      onPlaybackOrderCycle: () => undefined,
      onRestore: () => undefined,
    });
    destroyUltraLightTaskbarRestoreWindow();

    expect(mocks.audioSession.off).toHaveBeenCalledWith('status', expect.any(Function));
    expect(mocks.coverController.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.window.destroy).toHaveBeenCalledTimes(1);
  });

  it('defers the native helper handoff until the old renderer window is gone', async () => {
    const {
      activateUltraLightTaskbarRestorePresentation,
      showUltraLightTaskbarRestoreWindow,
    } = await import('./UltraLightTaskbarRestoreWindow');

    showUltraLightTaskbarRestoreWindow({
      deferPresentation: true,
      onPlaybackAction: () => undefined,
      onPlaybackOrderCycle: () => undefined,
      onRestore: () => undefined,
    });

    expect(mocks.Controller).not.toHaveBeenCalled();
    expect(mocks.audioSession.on).not.toHaveBeenCalled();
    expect(activateUltraLightTaskbarRestorePresentation()).toBe(true);
    expect(mocks.Controller).toHaveBeenCalledTimes(1);
    expect(mocks.audioSession.on).toHaveBeenCalledWith('status', expect.any(Function));
  });

  it('ignores status ticks that do not change what the taskbar shows', async () => {
    const {
      refreshUltraLightTaskbarPresentation,
      showUltraLightTaskbarRestoreWindow,
    } = await import('./UltraLightTaskbarRestoreWindow');

    showUltraLightTaskbarRestoreWindow({
      onPlaybackAction: () => undefined,
      onPlaybackOrderCycle: () => undefined,
      onRestore: () => undefined,
    });
    expect(mocks.window.setTitle).toHaveBeenCalledTimes(1);
    expect(mocks.coverController.setButtons).toHaveBeenCalledTimes(1);
    expect(mocks.library.getTrack).toHaveBeenCalledTimes(1);

    for (let tick = 0; tick < 8; tick += 1) {
      mocks.getStatusListener()?.({ ...mocks.status, positionSeconds: tick * 0.25 });
    }
    expect(mocks.window.setTitle).toHaveBeenCalledTimes(1);
    expect(mocks.coverController.setButtons).toHaveBeenCalledTimes(1);
    expect(mocks.coverController.clear).not.toHaveBeenCalled();
    expect(mocks.library.getTrack).toHaveBeenCalledTimes(1);

    mocks.library.isTrackLiked.mockReturnValue(false);
    refreshUltraLightTaskbarPresentation();
    expect(mocks.coverController.setButtons).toHaveBeenCalledTimes(2);
    expect(mocks.coverController.setButtons).toHaveBeenLastCalledWith(expect.objectContaining({ liked: false }));

    mocks.status.currentTrackId = 'track-2';
    mocks.getStatusListener()?.(mocks.status);
    expect(mocks.library.getTrack).toHaveBeenCalledTimes(3);
    expect(mocks.coverController.setButtons).toHaveBeenCalledTimes(3);
  });

  it('removes stale artwork while retaining controls for a coverless track', async () => {
    mocks.library.getTrack.mockReturnValue({
      albumArtist: null,
      artist: 'Artist',
      coverId: null,
      title: 'No cover',
    });
    const { showUltraLightTaskbarRestoreWindow } = await import('./UltraLightTaskbarRestoreWindow');

    showUltraLightTaskbarRestoreWindow({
      onPlaybackAction: () => undefined,
      onPlaybackOrderCycle: () => undefined,
      onRestore: () => undefined,
    });

    expect(mocks.coverController.clear).toHaveBeenCalledTimes(1);
    expect(mocks.coverController.setCover).not.toHaveBeenCalled();
    expect(mocks.coverController.setButtons).toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  });
});
