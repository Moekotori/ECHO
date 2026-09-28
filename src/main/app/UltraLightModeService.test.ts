import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trayBackgroundResumeDelayMs } from '../../shared/performance/trayLoadShedding';
import type { PersistedPlaybackSessionResume } from '../../shared/types/playback';

const mocks = vi.hoisted(() => {
  const statusListeners = new Set<(status: Record<string, unknown>) => void>();
  const audioStatus = {
    host: 'ready',
    state: 'playing',
    outputMode: 'shared',
    currentTrackId: 'track-1',
    currentFilePath: 'C:\\Music\\one.flac',
    positionSeconds: 2,
    volume: 0.8,
  };
  const audioSession = {
    getStatus: vi.fn(() => ({ ...audioStatus })),
    on: vi.fn((_event: string, listener: (status: Record<string, unknown>) => void) => statusListeners.add(listener)),
    off: vi.fn((_event: string, listener: (status: Record<string, unknown>) => void) => statusListeners.delete(listener)),
    play: vi.fn(async () => ({ ...audioStatus, state: 'playing' })),
    pause: vi.fn(async () => ({ ...audioStatus, state: 'paused' })),
    stop: vi.fn(async () => ({ ...audioStatus, state: 'stopped' })),
    seek: vi.fn(async () => ({ ...audioStatus })),
    setOutput: vi.fn(async () => ({ ...audioStatus })),
    setRepeatMode: vi.fn(),
    restorePlaybackMemory: vi.fn(() => ({ ...audioStatus, state: 'paused' })),
    syncQueueToBackend: vi.fn(async () => undefined),
    playLocalFile: vi.fn(async () => ({ ...audioStatus })),
  };
  const session = {
    version: 1 as const,
    revision: 4,
    items: [
      {
        queueId: 'queue-1',
        track: { id: 'track-1', path: 'C:\\Music\\one.flac', title: 'One', artist: 'A', album: 'Album', albumArtist: 'A', coverThumb: null },
        source: { type: 'manual' as const, label: 'Queue' },
        addedAt: '2026-08-05T00:00:00.000Z',
      },
      {
        queueId: 'queue-2',
        track: { id: 'track-2', path: 'C:\\Music\\two.flac', title: 'Two', artist: 'A', album: 'Album', albumArtist: 'A', coverThumb: null },
        source: { type: 'manual' as const, label: 'Queue' },
        addedAt: '2026-08-05T00:00:01.000Z',
      },
    ],
    currentQueueId: 'queue-1',
    currentTrackId: 'track-1',
    lastPlayedTrack: null,
    history: [],
    mode: { isShuffleEnabled: false, repeatMode: 'off' as const, automixEnabled: false },
    resume: null as PersistedPlaybackSessionResume | null,
    updatedAt: '2026-08-05T00:00:00.000Z',
  };
  const playbackStore = {
    load: vi.fn(() => session),
    save: vi.fn((next) => next),
    saveResumeFromAudioStatus: vi.fn(() => session),
  };
  const registered = new Map<string, () => void>();
  const windowListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const webContentsListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const addOnceListener = (
    listeners: Map<string, Set<(...args: unknown[]) => void>>,
    event: string,
    listener: (...args: unknown[]) => void,
  ): void => {
    const eventListeners = listeners.get(event) ?? new Set();
    eventListeners.add(listener);
    listeners.set(event, eventListeners);
  };
  const removeListener = (
    listeners: Map<string, Set<(...args: unknown[]) => void>>,
    event: string,
    listener: (...args: unknown[]) => void,
  ): void => {
    listeners.get(event)?.delete(listener);
  };
  const emitOnce = (listeners: Map<string, Set<(...args: unknown[]) => void>>, event: string, ...args: unknown[]): void => {
    const eventListeners = [...(listeners.get(event) ?? [])];
    listeners.delete(event);
    eventListeners.forEach((listener) => listener(...args));
  };
  let windowDestroyed = false;
  let readyToShowImmediately = true;
  const window = {
    isDestroyed: vi.fn(() => windowDestroyed),
    isVisible: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    destroy: vi.fn(() => { windowDestroyed = true; }),
    show: vi.fn(),
    restore: vi.fn(),
    setSkipTaskbar: vi.fn(),
    focus: vi.fn(),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'ready-to-show' && readyToShowImmediately) {
        listener();
        return;
      }
      addOnceListener(windowListeners, event, listener);
    }),
    removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      removeListener(windowListeners, event, listener);
    }),
    webContents: {
      isDestroyed: vi.fn(() => false),
      executeJavaScript: vi.fn(async (): Promise<unknown> => undefined),
      send: vi.fn(),
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        addOnceListener(webContentsListeners, event, listener);
      }),
      removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        removeListener(webContentsListeners, event, listener);
      }),
    },
  };
  return {
    audioSession,
    audioStatus,
    clearStatusListeners: () => statusListeners.clear(),
    emitAudioStatus: (patch: Record<string, unknown>) => {
      Object.assign(audioStatus, patch);
      for (const listener of statusListeners) listener({ ...audioStatus });
    },
    playbackStore,
    session,
    registered,
    window,
    setWindowDestroyed: (destroyed: boolean) => { windowDestroyed = destroyed; },
    setReadyToShowImmediately: (ready: boolean) => { readyToShowImmediately = ready; },
    emitWindowEvent: (event: string, ...args: unknown[]) => emitOnce(windowListeners, event, ...args),
    clearWindowListeners: () => {
      windowListeners.clear();
      webContentsListeners.clear();
    },
    mainWindowAvailable: false,
    ensureTray: vi.fn(),
    closeDevConsoleWindow: vi.fn(),
    closeDesktopLyricsWindow: vi.fn(),
    closeMiniPlayerWindow: vi.fn(),
    closePetWindow: vi.fn(),
    destroyTaskbarRestoreWindow: vi.fn(),
    activateTaskbarRestorePresentation: vi.fn(() => true),
    showTaskbarRestoreWindow: vi.fn((_options: unknown) => true),
    restoreDesktopLyricsWindowOnStartup: vi.fn(),
    restoreMiniPlayerWindowOnStartup: vi.fn(),
    restorePetWindowOnStartup: vi.fn(),
    createMainWindow: vi.fn(() => {
      windowDestroyed = false;
      return window;
    }),
    setDefaultTrayBackgroundPaused: vi.fn(async () => undefined),
    setManualUltraLightBackgroundPauseActive: vi.fn(),
    acquireBackgroundPauseLease: vi.fn(async () => ({ paused: true, reasons: ['manual-ultralite'] })),
    releaseBackgroundPauseLease: vi.fn(async () => ({ paused: false, reasons: [] })),
    releaseDefaultBackgroundMemory: vi.fn(async () => undefined),
    ultraLightGpuDisabled: false,
    isUltraLightGpuRuntime: false,
    relaunch: vi.fn(),
    exit: vi.fn(),
    quit: vi.fn(),
    prepareNormalRuntimeRelaunch: vi.fn((handoff?: { pendingAction?: string; resumePlayback?: boolean }) => {
      const args: string[] = [];
      if (handoff?.pendingAction) args.push(`--echo-ultra-light-restore-action=${handoff.pendingAction}`);
      if (handoff?.resumePlayback) args.push('--echo-ultra-light-resume-playback');
      return args;
    }),
    suspendPlaybackMemoryPersistence: vi.fn(),
    warmMainProcessForRendererRestore: vi.fn(async () => ({
      durationMs: 0,
      libraryReaderWarmed: true,
      databaseMemoryRestored: true,
    })),
    libraryTrack: { title: 'One', artist: 'A', albumArtist: 'A', coverId: null as string | null },
  };
});

vi.mock('electron', () => ({
  app: { relaunch: mocks.relaunch, exit: mocks.exit, quit: mocks.quit },
  BrowserWindow: { getAllWindows: vi.fn(() => [mocks.window]) },
  globalShortcut: {
    isRegistered: vi.fn((accelerator: string) => mocks.registered.has(accelerator)),
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (mocks.registered.has(accelerator)) return false;
      mocks.registered.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => mocks.registered.delete(accelerator)),
  },
}));
vi.mock('../audioPublicApi', () => ({
  getAudioSession: () => mocks.audioSession,
  getPlaybackSessionStore: () => mocks.playbackStore,
}));
vi.mock('../library/LibraryService', () => ({
  getLibraryService: () => ({ getTrack: () => mocks.libraryTrack }),
}));
vi.mock('../diagnostics/DevConsoleService', () => ({ closeDevConsoleWindow: mocks.closeDevConsoleWindow }));
vi.mock('./windowManager', () => ({
  getMainWindow: () => mocks.mainWindowAvailable ? mocks.window : null,
}));
vi.mock('../ipc/playbackIpc', () => ({
  suspendPlaybackMemoryPersistence: mocks.suspendPlaybackMemoryPersistence,
}));
vi.mock('./tray', () => ({ ensureTray: mocks.ensureTray }));
vi.mock('./desktopLyricsWindow', () => ({
  closeDesktopLyricsWindow: mocks.closeDesktopLyricsWindow,
  restoreDesktopLyricsWindowOnStartup: mocks.restoreDesktopLyricsWindowOnStartup,
}));
vi.mock('./miniPlayerWindow', () => ({
  closeMiniPlayerWindow: mocks.closeMiniPlayerWindow,
  restoreMiniPlayerWindowOnStartup: mocks.restoreMiniPlayerWindowOnStartup,
}));
vi.mock('./petWindow', () => ({
  closePetWindow: mocks.closePetWindow,
  restorePetWindowOnStartup: mocks.restorePetWindowOnStartup,
}));
vi.mock('./appSettings', () => ({ getAppSettings: () => ({
  taskbarMiniPlayerEnabled: false,
  ultraLightGpuDisabled: mocks.ultraLightGpuDisabled,
}) }));
vi.mock('./UltraLightTaskbarRestoreWindow', () => ({
  activateUltraLightTaskbarRestorePresentation: mocks.activateTaskbarRestorePresentation,
  destroyUltraLightTaskbarRestoreWindow: mocks.destroyTaskbarRestoreWindow,
  refreshUltraLightTaskbarPresentation: vi.fn(),
  showUltraLightTaskbarRestoreWindow: mocks.showTaskbarRestoreWindow,
}));
vi.mock('./ultraLightGpuRuntime', () => ({
  isUltraLightGpuRuntime: () => mocks.isUltraLightGpuRuntime,
  createUltraLightGpuRuntimeArgs: (
    _argv: unknown,
    entryMode: string,
    handoff: { resumePlayback?: boolean } = {},
  ) => [
    '.',
    '--echo-ultra-light-gpu-runtime',
    ...(entryMode === 'manual' ? [] : [`--echo-ultra-light-entry=${entryMode}`]),
    ...(handoff.resumePlayback === true ? ['--echo-ultra-light-resume-playback'] : []),
  ],
  prepareNormalRuntimeRelaunch: (_argv: unknown, _environment: unknown, handoff: unknown) =>
    mocks.prepareNormalRuntimeRelaunch(handoff as { pendingAction?: string; resumePlayback?: boolean }),
}));
vi.mock('./createMainWindow', () => ({ createMainWindow: mocks.createMainWindow }));
vi.mock('../diagnostics/CrashReportService', () => ({
  getCrashReportService: () => ({ getLogger: () => null }),
}));
vi.mock('./ultraLightRestoreWarmup', () => ({
  warmMainProcessForRendererRestore: mocks.warmMainProcessForRendererRestore,
}));
vi.mock('./mainWindowTrayLoadShedding', () => ({
  setDefaultTrayBackgroundPaused: mocks.setDefaultTrayBackgroundPaused,
  setManualUltraLightBackgroundPauseActive: mocks.setManualUltraLightBackgroundPauseActive,
  releaseDefaultBackgroundMemory: mocks.releaseDefaultBackgroundMemory,
}));

vi.mock('../audio/CueSheet', () => ({
  resolveCueTrack: vi.fn((filePath: string) => {
    const match = filePath.match(/#cueTrack=(\d+)$/u);
    if (!match) return null;
    const index = Number(match[1]) - 1;
    return {
      audioPath: 'C:\\Music\\album.flac',
      startSeconds: index * 60,
      endSeconds: (index + 1) * 60,
    };
  }),
}));
vi.mock('./backgroundPauseLeases', () => ({
  acquireBackgroundPauseLease: mocks.acquireBackgroundPauseLease,
  releaseBackgroundPauseLease: mocks.releaseBackgroundPauseLease,
}));

describe('UltraLightModeService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.playbackStore.load.mockReset().mockReturnValue(mocks.session);
    vi.useFakeTimers();
    mocks.clearStatusListeners();
    mocks.registered.clear();
    mocks.ultraLightGpuDisabled = false;
    mocks.isUltraLightGpuRuntime = false;
    mocks.mainWindowAvailable = false;
    mocks.setWindowDestroyed(false);
    mocks.setReadyToShowImmediately(true);
    mocks.clearWindowListeners();
    mocks.window.isVisible.mockReturnValue(false);
    mocks.window.isMinimized.mockReturnValue(false);
    mocks.window.webContents.executeJavaScript.mockResolvedValue(undefined);
    mocks.session.resume = null;
    mocks.audioStatus.host = 'ready';
    mocks.audioStatus.state = 'playing';
    mocks.audioStatus.outputMode = 'shared';
    mocks.audioStatus.currentTrackId = 'track-1';
    mocks.audioStatus.currentFilePath = 'C:\\Music\\one.flac';
    mocks.audioStatus.positionSeconds = 2;
  });

  it('fails closed when the guaranteed restore shortcut is unavailable', async () => {
    mocks.registered.set('CommandOrControl+Shift+E', vi.fn());
    const { enterUltraLightMode } = await import('./UltraLightModeService');

    const status = await enterUltraLightMode();

    expect(status.active).toBe(false);
    expect(status.error).toBe('ultra_light_mode_restore_shortcut_unavailable');
    expect(mocks.window.destroy).not.toHaveBeenCalled();
  });

  it('destroys every UI window while keeping the main audio session alive', async () => {
    const { enterUltraLightMode } = await import('./UltraLightModeService');

    const status = await enterUltraLightMode();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(true);
    expect(mocks.playbackStore.saveResumeFromAudioStatus).toHaveBeenCalled();
    expect(mocks.closeDesktopLyricsWindow).toHaveBeenCalled();
    expect(mocks.closeMiniPlayerWindow).toHaveBeenCalled();
    expect(mocks.closePetWindow).toHaveBeenCalled();
    expect(mocks.window.destroy).toHaveBeenCalled();
    expect(mocks.acquireBackgroundPauseLease).toHaveBeenCalledWith('manual-ultralite');
    expect(mocks.releaseDefaultBackgroundMemory).toHaveBeenCalledWith('ultra-light-manual');
    expect(mocks.audioSession.stop).not.toHaveBeenCalled();
  });

  it('automatically relaunches hidden UltraLight into the GPU-disabled runtime when opted in', async () => {
    mocks.mainWindowAvailable = true;
    mocks.ultraLightGpuDisabled = true;
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(true);
    expect(mocks.relaunch).toHaveBeenCalledWith({
      args: [
        '.',
        '--echo-ultra-light-gpu-runtime',
        '--echo-ultra-light-entry=tray-auto',
        '--echo-ultra-light-resume-playback',
      ],
    });
    expect(mocks.quit).toHaveBeenCalledTimes(1);
    expect(mocks.window.destroy).not.toHaveBeenCalled();
    expect(mocks.audioSession.play).not.toHaveBeenCalled();
    expect(mocks.audioSession.pause).not.toHaveBeenCalled();
    expect(mocks.audioSession.stop).not.toHaveBeenCalled();
    expect(mocks.audioSession.seek).not.toHaveBeenCalled();
  });

  it('preserves minimize semantics across the GPU-disabled relaunch', async () => {
    mocks.mainWindowAvailable = true;
    mocks.ultraLightGpuDisabled = true;
    const { enterUltraLightModeForMinimizedParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForMinimizedParking();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(true);
    expect(mocks.relaunch).toHaveBeenCalledWith({
      args: [
        '.',
        '--echo-ultra-light-gpu-runtime',
        '--echo-ultra-light-entry=minimize-auto',
        '--echo-ultra-light-resume-playback',
      ],
    });
    expect(mocks.quit).toHaveBeenCalledTimes(1);
    expect(mocks.showTaskbarRestoreWindow).not.toHaveBeenCalled();
  });

  it('keeps automatic renderer unload in-process when GPU-disabled UltraLight is off', async () => {
    mocks.mainWindowAvailable = true;
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(true);
    expect(mocks.window.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(mocks.showTaskbarRestoreWindow).not.toHaveBeenCalled();
  });

  it('runs a tray-only settled cleanup without relaunching or delaying renderer restore', async () => {
    mocks.mainWindowAvailable = true;
    const {
      enterUltraLightModeForTrayParking,
      ultraLightTraySettledCleanupDelayMs,
    } = await import('./UltraLightModeService');

    await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.releaseDefaultBackgroundMemory).not.toHaveBeenCalledWith(
      'ultra-light-tray-settled',
      expect.anything(),
    );

    await vi.advanceTimersByTimeAsync(ultraLightTraySettledCleanupDelayMs);

    expect(mocks.releaseDefaultBackgroundMemory).toHaveBeenCalledWith(
      'ultra-light-tray-settled',
      { cleanupScope: 'ultra-light-tray-settled' },
    );
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it('cancels the settled tray cleanup when the window is restored quickly', async () => {
    mocks.mainWindowAvailable = true;
    const {
      enterUltraLightModeForTrayParking,
      restoreUltraLightMode,
      ultraLightTraySettledCleanupDelayMs,
    } = await import('./UltraLightModeService');

    await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);
    await restoreUltraLightMode();
    await vi.advanceTimersByTimeAsync(ultraLightTraySettledCleanupDelayMs);

    expect(mocks.releaseDefaultBackgroundMemory).not.toHaveBeenCalledWith(
      'ultra-light-tray-settled',
      expect.anything(),
    );
    expect(mocks.createMainWindow).toHaveBeenCalledTimes(1);
    expect(mocks.window.show).toHaveBeenCalled();
  });

  it('runs the same settled deep cleanup for minimize-triggered UltraLight', async () => {
    mocks.mainWindowAvailable = true;
    mocks.window.isVisible.mockReturnValue(true);
    mocks.window.isMinimized.mockReturnValue(true);
    const {
      enterUltraLightModeForMinimizedParking,
      ultraLightTraySettledCleanupDelayMs,
    } = await import('./UltraLightModeService');

    await enterUltraLightModeForMinimizedParking();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.window.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.releaseDefaultBackgroundMemory).not.toHaveBeenCalledWith(
      'ultra-light-minimize-settled',
      expect.anything(),
    );

    await vi.advanceTimersByTimeAsync(ultraLightTraySettledCleanupDelayMs);

    expect(mocks.releaseDefaultBackgroundMemory).toHaveBeenCalledWith(
      'ultra-light-minimize-settled',
      { cleanupScope: 'ultra-light-minimize-settled' },
    );
  });

  it('keeps a renderer-free taskbar restore window for minimize-triggered UltraLight', async () => {
    mocks.mainWindowAvailable = true;
    const { enterUltraLightModeForMinimizedParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForMinimizedParking();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(true);
    expect(mocks.showTaskbarRestoreWindow).toHaveBeenCalledTimes(1);
    expect(mocks.window.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.activateTaskbarRestorePresentation).toHaveBeenCalledTimes(1);

    const taskbarOptions = mocks.showTaskbarRestoreWindow.mock.calls[0]?.[0] as {
      deferPresentation: boolean;
      onPlaybackAction: (action: 'playPause') => Promise<void>;
      onPlaybackOrderCycle: () => Promise<void>;
    };
    expect(taskbarOptions.deferPresentation).toBe(true);
    await taskbarOptions.onPlaybackAction('playPause');
    expect(mocks.audioSession.pause).toHaveBeenCalledTimes(1);
    await taskbarOptions.onPlaybackOrderCycle();
    expect(mocks.playbackStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: expect.objectContaining({ isShuffleEnabled: true, repeatMode: 'off' }),
      }),
      { preserveRevision: true },
    );
    expect(mocks.audioSession.setRepeatMode).toHaveBeenCalledWith('off');
  });

  it('accepts automatic entry after the GPU-disabled relaunch has no main window', async () => {
    mocks.isUltraLightGpuRuntime = true;
    mocks.mainWindowAvailable = false;
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();

    expect(status.active).toBe(true);
    expect(status.error).toBeNull();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it('recreates the taskbar restore entry in the GPU-disabled minimize runtime', async () => {
    mocks.isUltraLightGpuRuntime = true;
    mocks.mainWindowAvailable = false;
    const { enterUltraLightModeForMinimizedParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForMinimizedParking();

    expect(status.active).toBe(true);
    expect(mocks.showTaskbarRestoreWindow).toHaveBeenCalledTimes(1);
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it('resumes persisted playing state after an automatic GPU-disabled handoff', async () => {
    mocks.isUltraLightGpuRuntime = true;
    mocks.mainWindowAvailable = false;
    mocks.audioStatus.state = 'paused';
    mocks.audioStatus.host = 'not-initialized';
    const startupResume = {
      queueId: 'queue-1',
      trackId: 'track-1',
      filePath: 'C:\\Music\\one.flac',
      positionMs: 2_000,
      durationMs: 180_000,
      state: 'playing',
      updatedAt: '2026-08-05T00:00:00.000Z',
    } satisfies PersistedPlaybackSessionResume;
    mocks.session.resume = {
      ...startupResume,
      state: 'paused',
    };
    const {
      enterUltraLightModeForTrayParking,
      ultraLightGpuPlaybackResumeDelayMs,
    } = await import('./UltraLightModeService');

    const entering = enterUltraLightModeForTrayParking(startupResume);
    await vi.advanceTimersByTimeAsync(ultraLightGpuPlaybackResumeDelayMs);
    const status = await entering;

    expect(status.active).toBe(true);
    expect(status.error).toBeNull();
    expect(mocks.audioSession.play).toHaveBeenCalledTimes(1);
    expect(mocks.playbackStore.saveResumeFromAudioStatus).not.toHaveBeenCalled();
  });

  it('retries a GPU-runtime playback handoff while the previous native host is still releasing', async () => {
    mocks.isUltraLightGpuRuntime = true;
    mocks.mainWindowAvailable = false;
    mocks.audioStatus.state = 'paused';
    mocks.audioStatus.host = 'not-initialized';
    mocks.audioSession.play
      .mockResolvedValueOnce({ ...mocks.audioStatus, state: 'paused' })
      .mockResolvedValueOnce({ ...mocks.audioStatus, state: 'playing' });
    const startupResume = {
      queueId: 'queue-1',
      trackId: 'track-1',
      filePath: 'C:\\Music\\one.flac',
      positionMs: 2_000,
      durationMs: 180_000,
      state: 'playing',
      updatedAt: '2026-08-05T00:00:00.000Z',
    } satisfies PersistedPlaybackSessionResume;
    const {
      enterUltraLightModeForTrayParking,
      ultraLightGpuPlaybackResumeDelayMs,
      ultraLightGpuPlaybackResumeRetryDelayMs,
    } = await import('./UltraLightModeService');

    const entering = enterUltraLightModeForTrayParking(startupResume);
    await vi.advanceTimersByTimeAsync(ultraLightGpuPlaybackResumeDelayMs);
    expect(mocks.audioSession.play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ultraLightGpuPlaybackResumeRetryDelayMs);
    const status = await entering;

    expect(status.active).toBe(true);
    expect(mocks.audioSession.play).toHaveBeenCalledTimes(2);
  });

  it('keeps a persisted paused native track resident after a GPU-disabled handoff', async () => {
    mocks.isUltraLightGpuRuntime = true;
    mocks.mainWindowAvailable = false;
    mocks.audioStatus.state = 'paused';
    mocks.audioStatus.host = 'not-initialized';
    mocks.session.resume = {
      queueId: 'queue-1',
      trackId: 'track-1',
      filePath: 'C:\\Music\\one.flac',
      positionMs: 2_000,
      durationMs: 180_000,
      state: 'paused',
      updatedAt: '2026-08-05T00:00:00.000Z',
    };
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();

    expect(status.active).toBe(true);
    expect(status.error).toBeNull();
    expect(mocks.audioSession.play).not.toHaveBeenCalled();
    expect(mocks.playbackStore.saveResumeFromAudioStatus).not.toHaveBeenCalled();
  });

  it('automatically unloads a sustained minimized renderer without touching playback', async () => {
    mocks.mainWindowAvailable = true;
    mocks.window.isVisible.mockReturnValue(true);
    mocks.window.isMinimized.mockReturnValue(true);
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(true);
    expect(mocks.window.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.audioSession.stop).not.toHaveBeenCalled();
  });

  it('rolls back automatic Ultralight when the window returns during route capture', async () => {
    mocks.mainWindowAvailable = true;
    let finishRouteCapture!: () => void;
    mocks.window.webContents.executeJavaScript.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      finishRouteCapture = () => resolve(undefined);
    }));
    const { enterUltraLightModeForTrayParking, getUltraLightModeStatus } = await import('./UltraLightModeService');

    await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);
    mocks.window.isVisible.mockReturnValue(true);
    finishRouteCapture();
    await vi.waitFor(() => expect(getUltraLightModeStatus().active).toBe(false));

    expect(mocks.window.destroy).not.toHaveBeenCalled();
    expect(mocks.window.show).toHaveBeenCalled();
    expect(mocks.window.focus).toHaveBeenCalled();
  });

  it('fully restores a surviving minimized window before the unload timer fires', async () => {
    mocks.mainWindowAvailable = true;
    mocks.window.isVisible.mockReturnValue(true);
    mocks.window.isMinimized.mockReturnValue(true);
    const { enterUltraLightModeForTrayParking, restoreUltraLightMode } = await import('./UltraLightModeService');

    await enterUltraLightModeForTrayParking();
    await restoreUltraLightMode();
    await vi.advanceTimersByTimeAsync(100);

    expect(mocks.window.show).toHaveBeenCalled();
    expect(mocks.window.restore).toHaveBeenCalled();
    expect(mocks.window.setSkipTaskbar).toHaveBeenCalledWith(false);
    expect(mocks.window.focus).toHaveBeenCalled();
    expect(mocks.window.destroy).not.toHaveBeenCalled();
  });

  it('refuses automatic renderer unload when playback still belongs to the renderer', async () => {
    mocks.mainWindowAvailable = true;
    mocks.audioStatus.outputMode = 'system';
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(false);
    expect(status.error).toBe('tray_renderer_unload_requires_native_output');
    expect(mocks.window.destroy).not.toHaveBeenCalled();
  });

  it('refuses every UltraLight entry when System Output still owns playback', async () => {
    mocks.audioStatus.outputMode = 'system';
    const { enterUltraLightMode } = await import('./UltraLightModeService');

    const status = await enterUltraLightMode();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(false);
    expect(status.error).toBe('tray_renderer_unload_requires_native_output');
    expect(mocks.window.destroy).not.toHaveBeenCalled();
    expect(mocks.audioSession.play).not.toHaveBeenCalled();
    expect(mocks.audioSession.pause).not.toHaveBeenCalled();
    expect(mocks.audioSession.stop).not.toHaveBeenCalled();
    expect(mocks.audioSession.seek).not.toHaveBeenCalled();
  });

  it('refuses automatic renderer unload while active native playback is not ready', async () => {
    mocks.mainWindowAvailable = true;
    mocks.audioStatus.host = 'starting';
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(false);
    expect(status.error).toBe('tray_renderer_unload_requires_ready_native_host');
    expect(mocks.window.destroy).not.toHaveBeenCalled();
    expect(mocks.audioSession.play).not.toHaveBeenCalled();
    expect(mocks.audioSession.pause).not.toHaveBeenCalled();
    expect(mocks.audioSession.stop).not.toHaveBeenCalled();
    expect(mocks.audioSession.seek).not.toHaveBeenCalled();
  });

  it('allows automatic renderer unload for a cold paused native track', async () => {
    mocks.mainWindowAvailable = true;
    mocks.audioStatus.state = 'paused';
    mocks.audioStatus.host = 'not-initialized';
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(true);
    expect(status.error).toBeNull();
    expect(mocks.window.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.audioSession.play).not.toHaveBeenCalled();
  });

  it('refuses automatic renderer unload for a non-local current queue item', async () => {
    mocks.mainWindowAvailable = true;
    mocks.playbackStore.load.mockReturnValueOnce({
      ...mocks.session,
      items: [{
        ...mocks.session.items[0],
        track: {
          ...mocks.session.items[0]!.track,
          mediaType: 'remote',
        } as typeof mocks.session.items[number]['track'] & { mediaType: 'remote' },
      }],
    });
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();

    expect(status.active).toBe(false);
    expect(status.error).toBe('tray_renderer_unload_requires_fully_local_queue');
    expect(mocks.window.destroy).not.toHaveBeenCalled();
  });

  it('refuses automatic renderer unload when a later queue item is remote', async () => {
    mocks.mainWindowAvailable = true;
    mocks.playbackStore.load.mockReturnValueOnce({
      ...mocks.session,
      items: [
        mocks.session.items[0],
        {
          ...mocks.session.items[1],
          track: {
            ...mocks.session.items[1]!.track,
            path: 'remote://source/next.flac',
            mediaType: 'remote',
          } as typeof mocks.session.items[number]['track'] & { mediaType: 'remote' },
        },
      ],
    });
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();

    expect(status.active).toBe(false);
    expect(status.error).toBe('tray_renderer_unload_requires_fully_local_queue');
    expect(mocks.window.destroy).not.toHaveBeenCalled();
  });

  it('unloads a fully local materialized queue while preserving the auto-fill preference', async () => {
    mocks.mainWindowAvailable = true;
    const localSessionWithAutoFill = {
      ...mocks.session,
      mode: {
        ...mocks.session.mode,
        autoFillQueueEnabled: true,
      } as typeof mocks.session.mode & { autoFillQueueEnabled: boolean },
    };
    mocks.playbackStore.load.mockReturnValueOnce(localSessionWithAutoFill);
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(true);
    expect(status.error).toBeNull();
    expect(mocks.window.destroy).toHaveBeenCalledTimes(1);
    expect(localSessionWithAutoFill.mode.autoFillQueueEnabled).toBe(true);
    expect(mocks.audioSession.play).not.toHaveBeenCalled();
    expect(mocks.audioSession.pause).not.toHaveBeenCalled();
    expect(mocks.audioSession.stop).not.toHaveBeenCalled();
    expect(mocks.audioSession.seek).not.toHaveBeenCalled();
  });

  it('keeps CUE playback resident when the community host cannot accept source ranges', async () => {
    mocks.mainWindowAvailable = true;
    const cueSession = {
      ...mocks.session,
      items: mocks.session.items.map((item, index) => ({
        ...item,
        track: {
          ...item.track,
          path: `C:\\Music\\album.cue#cueTrack=${index + 1}`,
        },
      })),
    };
    mocks.playbackStore.load
      .mockReturnValueOnce(cueSession)
      .mockReturnValueOnce(cueSession);
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();

    await vi.advanceTimersByTimeAsync(100);

    expect(status.active).toBe(false);
    expect(status.error).toBe('tray_renderer_unload_rejects_unresolved_cue_queue');
    expect(mocks.audioSession.syncQueueToBackend).not.toHaveBeenCalled();
    expect(mocks.window.destroy).not.toHaveBeenCalled();
    expect(mocks.audioSession.play).not.toHaveBeenCalled();
    expect(mocks.audioSession.pause).not.toHaveBeenCalled();
    expect(mocks.audioSession.stop).not.toHaveBeenCalled();
  });

  it('prefers the host current track over a stale persisted queue id', async () => {
    mocks.mainWindowAvailable = true;
    mocks.audioStatus.currentTrackId = 'track-local';
    mocks.audioStatus.currentFilePath = 'C:\\Music\\local.flac';
    mocks.playbackStore.load.mockReturnValueOnce({
      ...mocks.session,
      currentQueueId: 'queue-stale',
      currentTrackId: 'track-stale',
      items: [
        {
          ...mocks.session.items[0],
          queueId: 'queue-stale',
          track: {
            ...mocks.session.items[0]!.track,
            id: 'track-stale',
            path: 'C:\\Music\\stale.flac',
          },
        },
        {
          ...mocks.session.items[1],
          queueId: 'queue-local',
          track: {
            ...mocks.session.items[1]!.track,
            id: 'track-local',
            path: 'C:\\Music\\local.flac',
          },
        },
      ],
    });
    const { enterUltraLightModeForTrayParking } = await import('./UltraLightModeService');

    const status = await enterUltraLightModeForTrayParking();

    expect(status.active).toBe(true);
    expect(status.error).toBeNull();
  });

  it('restores an automatically unloaded renderer before resuming background work', async () => {
    mocks.mainWindowAvailable = true;
    const { enterUltraLightModeForTrayParking, restoreUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);

    await restoreUltraLightMode();

    expect(mocks.createMainWindow).toHaveBeenCalledTimes(1);
    expect(mocks.window.show).toHaveBeenCalled();
    expect(mocks.restoreDesktopLyricsWindowOnStartup).not.toHaveBeenCalled();
    expect(mocks.restoreMiniPlayerWindowOnStartup).not.toHaveBeenCalled();
    expect(mocks.restorePetWindowOnStartup).not.toHaveBeenCalled();
    expect(mocks.setDefaultTrayBackgroundPaused).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(trayBackgroundResumeDelayMs);
    expect(mocks.releaseBackgroundPauseLease).toHaveBeenCalledWith('tray-hidden');
  });

  it('keeps a recreated window hidden and the service restoring until its first frame is ready', async () => {
    mocks.mainWindowAvailable = true;
    mocks.setReadyToShowImmediately(false);
    const {
      enterUltraLightModeForTrayParking,
      getUltraLightModeStatus,
      restoreUltraLightMode,
    } = await import('./UltraLightModeService');
    await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);
    mocks.window.show.mockClear();

    const firstRestore = restoreUltraLightMode();
    const repeatedRestore = restoreUltraLightMode();

    expect(getUltraLightModeStatus().phase).toBe('restoring');
    await vi.waitFor(() => expect(mocks.createMainWindow).toHaveBeenCalledTimes(1));
    expect(mocks.window.show).not.toHaveBeenCalled();

    mocks.emitWindowEvent('ready-to-show');
    const [firstStatus, repeatedStatus] = await Promise.all([firstRestore, repeatedRestore]);

    expect(firstStatus.phase).toBe('inactive');
    expect(repeatedStatus.phase).toBe('inactive');
    expect(mocks.window.show).toHaveBeenCalledTimes(1);
    expect(getUltraLightModeStatus().phase).toBe('inactive');
  });

  it('rolls restore control surfaces back when a recreated window never becomes ready', async () => {
    mocks.mainWindowAvailable = true;
    mocks.setReadyToShowImmediately(false);
    const {
      enterUltraLightModeForTrayParking,
      getUltraLightModeStatus,
      restoreUltraLightMode,
      ultraLightModeRestoreReadyTimeoutMs,
    } = await import('./UltraLightModeService');
    await enterUltraLightModeForTrayParking();
    await vi.advanceTimersByTimeAsync(100);

    const restoring = restoreUltraLightMode();
    await vi.advanceTimersByTimeAsync(ultraLightModeRestoreReadyTimeoutMs);
    await restoring;

    expect(getUltraLightModeStatus()).toMatchObject({
      phase: 'active',
      error: 'ultra_light_mode_restore_window_timeout',
    });
    expect(mocks.registered.has('CommandOrControl+Shift+E')).toBe(true);
  });

  it('resumes manually paused background work only after the restored UI settles', async () => {
    const { enterUltraLightMode, restoreUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();
    await vi.advanceTimersByTimeAsync(100);
    mocks.setDefaultTrayBackgroundPaused.mockClear();
    mocks.setManualUltraLightBackgroundPauseActive.mockClear();

    await restoreUltraLightMode();

    expect(mocks.setManualUltraLightBackgroundPauseActive).not.toHaveBeenCalled();
    expect(mocks.setDefaultTrayBackgroundPaused).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(trayBackgroundResumeDelayMs);
    expect(mocks.releaseBackgroundPauseLease).toHaveBeenCalledWith('manual-ultralite');
  });

  it('does not reload the playback store for progress-only status updates', async () => {
    const { enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();
    mocks.playbackStore.load.mockClear();

    mocks.emitAudioStatus({ positionSeconds: 2.1 });
    mocks.emitAudioStatus({ positionSeconds: 2.2 });

    expect(mocks.playbackStore.load).not.toHaveBeenCalled();
  });

  it('plays the next persisted local queue item without a renderer', async () => {
    const { dispatchUltraLightModeAction, enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();

    await dispatchUltraLightModeAction('nextTrack');

    expect(mocks.audioSession.syncQueueToBackend).toHaveBeenCalledWith(expect.any(Array), 'off', 'queue-2');
    expect(mocks.audioSession.playLocalFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'C:\\Music\\two.flac',
      trackId: 'track-2',
    }));
    expect(mocks.playbackStore.save).toHaveBeenCalledWith(expect.objectContaining({
      currentQueueId: 'queue-2',
      currentTrackId: 'track-2',
    }), { preserveRevision: true });
  });

  it('continues once after Audio Core confirms the bridge path has ended', async () => {
    const { enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();
    mocks.emitAudioStatus({ state: 'ended' });
    mocks.emitAudioStatus({ state: 'ended' });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.audioSession.playLocalFile).toHaveBeenCalledTimes(1);
    expect(mocks.audioSession.playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-2' }));
  });

  it('leaves continuation to a surviving renderer and never guesses the end from position', async () => {
    const { enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();
    mocks.mainWindowAvailable = true;
    mocks.emitAudioStatus({ state: 'ended' });
    await vi.advanceTimersByTimeAsync(0);
    mocks.mainWindowAvailable = false;
    mocks.emitAudioStatus({ state: 'playing', positionSeconds: 180, durationSeconds: 180 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.audioSession.playLocalFile).not.toHaveBeenCalled();
  });

  it('does not continue a stale ended notification after the host has advanced', async () => {
    const { enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();
    mocks.emitAudioStatus({ state: 'ended' });
    mocks.emitAudioStatus({ state: 'playing', currentTrackId: 'track-2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.audioSession.playLocalFile).not.toHaveBeenCalled();
  });

  it('handles native SMTC media commands without forwarding to a renderer', async () => {
    const { dispatchUltraLightModeSmtcCommand, enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();

    await dispatchUltraLightModeSmtcCommand('pause');
    await dispatchUltraLightModeSmtcCommand({ type: 'seek', positionSeconds: 42 });

    expect(mocks.audioSession.pause).toHaveBeenCalledTimes(1);
    expect(mocks.audioSession.seek).toHaveBeenCalledWith(42);
  });

  it('resumes playback when the focused Ultralight shortcut is used from a non-playing state', async () => {
    mocks.audioStatus.state = 'stopped';
    const { dispatchUltraLightModeAction, enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();

    await dispatchUltraLightModeAction('playPause');

    expect(mocks.audioSession.play).toHaveBeenCalledTimes(1);
    mocks.audioStatus.state = 'playing';
  });

  it('keeps tray speed and playback-order commands renderer-free', async () => {
    const {
      canDispatchUltraLightModeActionWithoutRenderer,
      dispatchUltraLightModeAction,
      enterUltraLightMode,
    } = await import('./UltraLightModeService');
    await enterUltraLightMode();

    expect(canDispatchUltraLightModeActionWithoutRenderer('speedDown')).toBe(true);
    expect(canDispatchUltraLightModeActionWithoutRenderer('speedUp')).toBe(true);
    expect(canDispatchUltraLightModeActionWithoutRenderer('toggleShuffle')).toBe(true);
    expect(canDispatchUltraLightModeActionWithoutRenderer('cycleRepeatMode')).toBe(true);
    expect(canDispatchUltraLightModeActionWithoutRenderer('openPlaybackQueue')).toBe(false);

    await dispatchUltraLightModeAction('speedDown');
    await dispatchUltraLightModeAction('speedUp');
    await dispatchUltraLightModeAction('toggleShuffle');
    await dispatchUltraLightModeAction('cycleRepeatMode');

    expect(mocks.audioSession.setOutput).toHaveBeenCalledWith({ playbackRate: 0.9 });
    expect(mocks.audioSession.setOutput).toHaveBeenCalledWith({ playbackRate: 1.1 });
    expect(mocks.playbackStore.save).toHaveBeenCalledTimes(2);
    expect(mocks.createMainWindow).not.toHaveBeenCalled();
  });

  it('serves the Dynamic Island control vocabulary renderer-free while active', async () => {
    const { controlUltraLightModePlayback, enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();

    await controlUltraLightModePlayback({ type: 'playPause' });
    await controlUltraLightModePlayback({ type: 'seek', positionSeconds: 12 });
    await controlUltraLightModePlayback({ type: 'setVolume', volume: 0.35 });
    await controlUltraLightModePlayback({ type: 'playQueueItem', queueId: 'queue-2' });

    expect(mocks.audioSession.pause).toHaveBeenCalledTimes(1);
    expect(mocks.audioSession.seek).toHaveBeenCalledWith(12);
    expect(mocks.audioSession.setOutput).toHaveBeenCalledWith({ volume: 0.35 });
    expect(mocks.audioSession.syncQueueToBackend).toHaveBeenCalledWith(expect.any(Array), expect.any(String), 'queue-2');
    expect(mocks.audioSession.playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'C:\\Music\\two.flac' }));
    expect(mocks.createMainWindow).not.toHaveBeenCalled();
  });

  it('cycles playback order and plays a selected persisted queue item without a renderer', async () => {
    const { cycleUltraLightModePlaybackOrder, enterUltraLightMode, playUltraLightModeQueueItemAt } = await import('./UltraLightModeService');
    await enterUltraLightMode();

    await cycleUltraLightModePlaybackOrder();
    await playUltraLightModeQueueItemAt(1);

    expect(mocks.playbackStore.save).toHaveBeenCalledWith(expect.objectContaining({
      mode: expect.objectContaining({ isShuffleEnabled: true, repeatMode: 'off' }),
    }), { preserveRevision: true });
    expect(mocks.audioSession.setRepeatMode).toHaveBeenCalledWith('off');
    expect(mocks.audioSession.syncQueueToBackend).toHaveBeenCalledWith(
      expect.any(Array),
      'off',
      'queue-1',
    );
    expect(mocks.audioSession.playLocalFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'C:\\Music\\two.flac',
      trackId: 'track-2',
    }));
  });

  it('relaunches into the GPU-disabled runtime only when the ultra-light option is enabled', async () => {
    mocks.ultraLightGpuDisabled = true;
    const { enterUltraLightMode } = await import('./UltraLightModeService');

    const status = await enterUltraLightMode();

    expect(status.phase).toBe('entering');
    expect(mocks.playbackStore.saveResumeFromAudioStatus).toHaveBeenCalled();
    expect(mocks.relaunch).toHaveBeenCalledWith({
      args: ['.', '--echo-ultra-light-gpu-runtime', '--echo-ultra-light-resume-playback'],
    });
    expect(mocks.quit).toHaveBeenCalledTimes(1);
    expect(mocks.suspendPlaybackMemoryPersistence).toHaveBeenCalledTimes(1);
    expect(mocks.exit).not.toHaveBeenCalled();
    expect(mocks.window.destroy).not.toHaveBeenCalled();
  });

  it('preserves the playing handoff before the GPU runtime publishes its fresh status', async () => {
    mocks.isUltraLightGpuRuntime = true;
    mocks.audioStatus.state = 'paused';
    mocks.session.resume = {
      queueId: 'queue-1',
      trackId: 'track-1',
      filePath: 'C:\\Music\\one.flac',
      positionMs: 2_000,
      durationMs: 180_000,
      state: 'playing',
      updatedAt: '2026-08-05T00:00:00.000Z',
    };
    const {
      enterUltraLightMode,
      ultraLightGpuPlaybackResumeDelayMs,
    } = await import('./UltraLightModeService');

    const entering = enterUltraLightMode();
    await vi.advanceTimersByTimeAsync(ultraLightGpuPlaybackResumeDelayMs);
    await entering;

    expect(mocks.audioSession.play).toHaveBeenCalledTimes(1);
    expect(mocks.playbackStore.saveResumeFromAudioStatus).not.toHaveBeenCalled();
  });

  it('relaunches back into the normal GPU runtime when restoring the interface', async () => {
    mocks.isUltraLightGpuRuntime = true;
    const { enterUltraLightMode, restoreUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();

    await restoreUltraLightMode('openAudioSettings');

    expect(mocks.relaunch).toHaveBeenCalledWith({
      args: [
        '--echo-ultra-light-restore-action=openAudioSettings',
        '--echo-ultra-light-resume-playback',
      ],
    });
    expect(mocks.quit).toHaveBeenCalledTimes(1);
    expect(mocks.suspendPlaybackMemoryPersistence).toHaveBeenCalledTimes(1);
    expect(mocks.exit).not.toHaveBeenCalled();
  });

  it('restores a newly created main window without touching the official taskbar host', async () => {
    const { enterUltraLightMode, restoreUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();

    await restoreUltraLightMode();

    expect(mocks.createMainWindow).toHaveBeenCalledTimes(1);
    expect(mocks.createMainWindow).toHaveBeenCalledWith({ ultraLightRestore: true });
    expect(mocks.window.show).toHaveBeenCalled();
    expect(mocks.warmMainProcessForRendererRestore).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mocks.restoreDesktopLyricsWindowOnStartup).toHaveBeenCalled());
  });

  it('does not warm main-process dependencies when the surviving window is reused', async () => {
    mocks.mainWindowAvailable = true;
    mocks.window.isVisible.mockReturnValue(true);
    mocks.window.isMinimized.mockReturnValue(true);
    const { enterUltraLightModeForTrayParking, restoreUltraLightMode } = await import('./UltraLightModeService');

    await enterUltraLightModeForTrayParking();
    await restoreUltraLightMode();

    expect(mocks.createMainWindow).not.toHaveBeenCalled();
    expect(mocks.warmMainProcessForRendererRestore).not.toHaveBeenCalled();
  });

  it('holds auxiliary windows and background resume until the recreated renderer reports ready', async () => {
    let finishRendererReady!: (ready: boolean) => void;
    const { enterUltraLightMode, restoreUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();
    await vi.advanceTimersByTimeAsync(100);
    mocks.window.webContents.executeJavaScript.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finishRendererReady = resolve;
    }));

    const status = await restoreUltraLightMode();

    expect(status.phase).toBe('inactive');
    expect(mocks.window.show).toHaveBeenCalled();
    expect(mocks.restoreDesktopLyricsWindowOnStartup).not.toHaveBeenCalled();
    expect(mocks.restoreMiniPlayerWindowOnStartup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(trayBackgroundResumeDelayMs);
    expect(mocks.releaseBackgroundPauseLease).not.toHaveBeenCalledWith('manual-ultralite');

    finishRendererReady(true);
    await vi.waitFor(() => expect(mocks.restoreDesktopLyricsWindowOnStartup).toHaveBeenCalledTimes(1));
    expect(mocks.restoreMiniPlayerWindowOnStartup).toHaveBeenCalledTimes(1);
    expect(mocks.restorePetWindowOnStartup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(trayBackgroundResumeDelayMs);
    expect(mocks.releaseBackgroundPauseLease).toHaveBeenCalledWith('manual-ultralite');
  });

  it('waits for the recreated renderer before replaying the requested action', async () => {
    mocks.mainWindowAvailable = true;
    mocks.setReadyToShowImmediately(false);
    const { dispatchUltraLightModeAction, enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();
    await vi.advanceTimersByTimeAsync(100);

    const restoring = dispatchUltraLightModeAction('openLyricsSettings');
    await vi.waitFor(() => expect(mocks.createMainWindow).toHaveBeenCalledTimes(1));
    expect(mocks.window.webContents.send).not.toHaveBeenCalled();

    mocks.emitWindowEvent('ready-to-show');
    await restoring;

    expect(mocks.window.webContents.send).toHaveBeenCalledWith(
      'app:global-shortcut-command',
      'openLyricsSettings',
    );
  });

  it('restores renderer-only pet controls instead of silently ignoring them', async () => {
    mocks.mainWindowAvailable = true;
    mocks.setReadyToShowImmediately(false);
    const { dispatchUltraLightModeAction, enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();
    await vi.advanceTimersByTimeAsync(100);

    const restoring = dispatchUltraLightModeAction('toggleDesktopLyrics');
    await vi.waitFor(() => expect(mocks.createMainWindow).toHaveBeenCalledTimes(1));
    mocks.emitWindowEvent('ready-to-show');
    await restoring;

    expect(mocks.window.webContents.send).toHaveBeenCalledWith(
      'app:global-shortcut-command',
      'toggleDesktopLyrics',
    );
  });

  it('keeps boss-key volume authority in AudioSession without restoring the renderer', async () => {
    const { dispatchUltraLightModeAction, enterUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();

    await dispatchUltraLightModeAction('bossKey');

    expect(mocks.audioSession.setOutput).toHaveBeenCalledWith({ volume: 0 });
    expect(mocks.createMainWindow).not.toHaveBeenCalled();
  });

  it('reinstalls controls when recreating the main window fails', async () => {
    mocks.createMainWindow.mockImplementationOnce(() => {
      throw new Error('window-create-failed');
    });
    const { enterUltraLightMode, restoreUltraLightMode } = await import('./UltraLightModeService');
    await enterUltraLightMode();

    const status = await restoreUltraLightMode();

    expect(status.active).toBe(true);
    expect(status.error).toBe('window-create-failed');
    expect(mocks.registered.has('CommandOrControl+Shift+E')).toBe(true);
    expect(mocks.audioSession.on).toHaveBeenCalledTimes(2);
  });
});
