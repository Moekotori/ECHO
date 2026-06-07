import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../shared/constants/ipcChannels';
import type { EchoApi } from './apiTypes';
import { ipcRenderer, webUtils } from 'electron';

const listeners = new Map<string, (...args: unknown[]) => void>();
let exposedApi: EchoApi | null = null;
let fakeAudioInstances: FakeAudio[] = [];
let queuedAudioPlayFailures: Error[] = [];
let queuedAudioPlayPromises: Promise<void>[] = [];
let ignoreAudioCurrentTimeWrites = false;
let emitAudioPlayingOnPlay = true;

const createTestLocalStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, String(value))),
  };
};

class FakeAudio {
  preload = '';
  src = '';
  volume = 1;
  playbackRate = 1;
  preservesPitch = true;
  mozPreservesPitch = true;
  webkitPreservesPitch = true;
  ended = false;
  paused = true;
  duration = 12;
  networkState = 1;
  readyState = 0;
  error: MediaError | null = null;
  private currentTimeValue = 0;
  readonly play = vi.fn(async () => {
    const pending = queuedAudioPlayPromises.shift();
    if (pending) {
      return pending;
    }
    const failure = queuedAudioPlayFailures.shift();
    if (failure) {
      throw failure;
    }
    this.paused = false;
    if (emitAudioPlayingOnPlay) {
      this.emit('playing');
    }
  });
  readonly pause = vi.fn(() => {
    this.paused = true;
    this.emit('pause');
  });
  readonly load = vi.fn(() => {
    this.emit('loadstart');
    this.emit('loadedmetadata');
  });
  private readonly eventListeners = new Map<string, Set<() => void>>();

  constructor() {
    fakeAudioInstances.push(this);
  }

  get currentTime(): number {
    return this.currentTimeValue;
  }

  set currentTime(value: number) {
    if (!ignoreAudioCurrentTimeWrites) {
      this.currentTimeValue = value;
    }
    this.emit('seeking');
  }

  addEventListener(event: string, listener: () => void): void {
    const listenersForEvent = this.eventListeners.get(event) ?? new Set<() => void>();
    listenersForEvent.add(listener);
    this.eventListeners.set(event, listenersForEvent);
  }

  removeEventListener(event: string, listener: () => void): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  removeAttribute(name: string): void {
    if (name === 'src') {
      this.src = '';
    }
  }

  triggerError(message = 'system_audio_playback_failed', code = 4): void {
    this.error = { code, message } as MediaError;
    this.networkState = 3;
    this.emit('error');
  }

  emit(event: string): void {
    this.eventListeners.get(event)?.forEach((listener) => listener());
  }
}

const flushPromises = async (): Promise<void> => {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
};

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: EchoApi) => {
      exposedApi = api;
    },
  },
  webUtils: {
    getPathForFile: vi.fn(() => ''),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      listeners.set(channel, listener);
    }),
    off: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      if (listeners.get(channel) === listener) {
        listeners.delete(channel);
      }
    }),
    send: vi.fn(),
  },
}));

describe('preload SMTC API', () => {
  beforeEach(async () => {
    listeners.clear();
    fakeAudioInstances = [];
    queuedAudioPlayFailures = [];
    queuedAudioPlayPromises = [];
    ignoreAudioCurrentTimeWrites = false;
    emitAudioPlayingOnPlay = true;
    exposedApi = null;
    vi.stubGlobal('window', {
      localStorage: createTestLocalStorage(),
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    });
    window.localStorage.clear();
    vi.stubGlobal('Audio', FakeAudio);
    vi.mocked(ipcRenderer.invoke).mockReset();
    vi.mocked(ipcRenderer.send).mockReset();
    vi.mocked(webUtils.getPathForFile).mockReset();
    vi.mocked(webUtils.getPathForFile).mockReturnValue('');
    vi.resetModules();
    await import('./index');
  });

  it('subscribes to SMTC commands and unsubscribes cleanly', () => {
    const handler = vi.fn();
    const unsubscribe = exposedApi!.smtc.onCommand(handler);
    const listener = listeners.get(IpcChannels.SmtcCommand);

    expect(listener).toBeTruthy();
    listener?.({}, 'playPause');
    expect(handler).toHaveBeenCalledWith('playPause');
    listener?.({}, { type: 'seek', positionSeconds: 12.5 });
    expect(handler).toHaveBeenCalledWith({ type: 'seek', positionSeconds: 12.5 });

    unsubscribe();
    expect(listeners.has(IpcChannels.SmtcCommand)).toBe(false);
  });

  it('exposes SMTC diagnostics through IPC', async () => {
    await exposedApi!.smtc.getDiagnostics();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.SmtcGetDiagnostics);
  });

  it('exposes SMTC restart through IPC', async () => {
    await exposedApi!.smtc.restart();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.SmtcRestart);
  });

  it('subscribes to audio status updates and unsubscribes cleanly', () => {
    const handler = vi.fn();
    const unsubscribe = exposedApi!.audio.onStatus(handler);
    const listener = listeners.get(IpcChannels.AudioStatus);
    const status = { state: 'ended', currentTrackId: 'track-1' };

    expect(listener).toBeTruthy();
    listener?.({}, status);
    expect(handler).toHaveBeenCalledWith(status);

    unsubscribe();
    expect(listeners.has(IpcChannels.AudioStatus)).toBe(false);
  });

  it('exposes audio diagnostics through IPC', async () => {
    await exposedApi!.audio.getDiagnostics();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AudioGetDiagnostics);
  });

  it('exposes audio engine reset through IPC', async () => {
    await exposedApi!.audio.resetEngine();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AudioResetEngine);
  });

  it('exposes audio force restart and Windows audio service restart through IPC', async () => {
    await exposedApi!.audio.forceRestart('settings');
    await exposedApi!.audio.restartWindowsAudioService();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AudioForceRestart, 'settings');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AudioRestartWindowsAudioService);
  });

  it('subscribes to audio session reset events and unsubscribes cleanly', () => {
    const handler = vi.fn();
    const unsubscribe = exposedApi!.audio.onSessionReset(handler);
    const listener = listeners.get(IpcChannels.AudioSessionReset);
    const event = { reason: 'force-restart', status: { state: 'stopped' } };

    expect(listener).toBeTruthy();
    listener?.({}, event);
    expect(handler).toHaveBeenCalledWith(event);

    unsubscribe();
    expect(listeners.has(IpcChannels.AudioSessionReset)).toBe(false);
  });

  it('exposes crash report file opening through IPC', async () => {
    await exposedApi!.diagnostics.openCrashReport();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.DiagnosticsOpenCrashReport);
  });

  it('exposes safe diagnostics zip export through IPC', async () => {
    await exposedApi!.diagnostics.exportDiagnosticsZip();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.DiagnosticsExportZip);
  });

  it('exposes audio crash report file opening through IPC', async () => {
    await exposedApi!.diagnostics.openAudioCrashReport();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.DiagnosticsOpenAudioCrashReport);
  });

  it('exposes app quit through IPC', async () => {
    await exposedApi!.app.quit();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppQuit);
  });

  it('exposes performance stall reporting through IPC', async () => {
    const payload = {
      source: 'renderer' as const,
      kind: 'animation_frame' as const,
      durationMs: 1200,
      thresholdMs: 750,
      timestamp: '2026-05-26T00:00:00.000Z',
      windowKind: 'main' as const,
    };

    await exposedApi!.diagnostics.reportPerformanceStall(payload);

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.DiagnosticsReportPerformanceStall, payload);
  });

  it('exposes the dropped import path classifier', async () => {
    await exposedApi!.library.classifyImportPaths(['D:\\Music']);
    await exposedApi!.library.chooseImportFiles();
    await exposedApi!.library.resolveLyricsBackgroundCover('track-1');
    await exposedApi!.library.getActiveMissingCoverBackfillStatus?.();
    await exposedApi!.library.getLibraryInboxBatches();
    await exposedApi!.library.getLibraryInboxTracks({ scope: 'latest', filter: 'all' });
    await exposedApi!.library.createPlaylistFromLibraryInbox({ scope: 'latest', filter: 'missing_cover' });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryClassifyImportPaths, ['D:\\Music']);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryChooseImportFiles);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryResolveLyricsBackgroundCover, 'track-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryNetworkGetActiveMissingCoverBackfillStatus);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetInboxBatches);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetInboxTracks, { scope: 'latest', filter: 'all' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryCreateInboxPlaylist, { scope: 'latest', filter: 'missing_cover' });
  });

  it('exposes custom artist avatar helpers through IPC', async () => {
    await exposedApi!.library.chooseArtistAvatar('artist-1');
    await exposedApi!.library.setArtistAvatarFromUrl('artist-1', 'https://example.test/avatar.png');
    await exposedApi!.library.clearCustomArtistAvatar('artist-1');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryArtistImagesChooseCustom, 'artist-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryArtistImagesSetCustomUrl, {
      artistId: 'artist-1',
      url: 'https://example.test/avatar.png',
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryArtistImagesClearCustom, 'artist-1');
  });

  it('serializes dropped files for library import', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'song.flac', { type: 'audio/flac' });
    await exposedApi!.library.importDroppedFiles([file]);

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.LibraryImportDroppedFiles,
      [{ name: 'song.flac', type: 'audio/flac', path: null, bytes: new Uint8Array([1, 2, 3]) }],
    );
  });

  it('serializes dropped file paths without reading large file bytes when Electron exposes a path', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'beatmap.osz', { type: 'application/x-osu-beatmap-archive' });
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer');
    vi.mocked(webUtils.getPathForFile).mockReturnValue('D:\\Maps\\beatmap.osz');

    await exposedApi!.library.importDroppedFiles([file]);

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.LibraryImportDroppedFiles,
      [{ name: 'beatmap.osz', type: 'application/x-osu-beatmap-archive', path: 'D:\\Maps\\beatmap.osz', bytes: null }],
    );
  });

  it('exposes local audio file opening helpers through IPC', async () => {
    await exposedApi!.playback.openLocalAudioFiles();
    await exposedApi!.playback.resolveLocalAudioFiles(['D:\\Music\\song.flac']);
    await exposedApi!.library.openPathInFolder('D:\\Music\\song.flac');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PlaybackOpenLocalAudioFiles);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PlaybackResolveLocalAudioFiles, ['D:\\Music\\song.flac']);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryOpenPathInFolder, 'D:\\Music\\song.flac');
  });

  it('routes remembered system audio playback through HTMLAudio instead of native IPC', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/test-token');
      }
      return Promise.resolve(null);
    });
    await import('./index');

    const status = await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\song.mp3',
      trackId: 'track-1',
      probe: { durationSeconds: 10 },
    });

    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
      IpcChannels.PlaybackPlayLocalFile,
      expect.anything(),
    );
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AudioCreateSystemStreamUrl, {
      url: 'D:\\Music\\song.mp3',
      headers: undefined,
      mimeType: null,
    });
    expect(fakeAudioInstances).toHaveLength(1);
    expect(fakeAudioInstances[0].src).toBe('echo-audio://system/test-token');
    expect(fakeAudioInstances[0].play).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({
      state: 'playing',
      currentTrackId: 'track-1',
      durationMs: 12_000,
      filePath: 'D:\\Music\\song.mp3',
    });
  });

  it('routes local .ape playback through native shared output even when system audio is remembered', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    const nativeStatus = {
      state: 'playing',
      currentTrackId: 'track-ape',
      positionMs: 0,
      durationMs: 180_000,
      filePath: 'D:\\Music\\song.ape',
    };
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.PlaybackPlayLocalFile) {
        return Promise.resolve(nativeStatus);
      }
      return Promise.resolve(null);
    });
    await import('./index');

    const status = await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\song.ape',
      trackId: 'track-ape',
      probe: { durationSeconds: 180 },
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.PlaybackPlayLocalFile,
      expect.objectContaining({
        filePath: 'D:\\Music\\song.ape',
        output: expect.objectContaining({ outputMode: 'shared' }),
      }),
    );
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(IpcChannels.AudioCreateSystemStreamUrl, expect.anything());
    expect(fakeAudioInstances).toHaveLength(0);
    expect(status).toBe(nativeStatus);
  });

  it('routes local .ape media items through native shared output even when system audio is remembered', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    const nativeStatus = {
      state: 'playing',
      currentTrackId: 'track-ape',
      positionMs: 0,
      durationMs: 180_000,
      filePath: 'D:\\Music\\song.ape',
    };
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.PlaybackPlayMediaItem) {
        return Promise.resolve(nativeStatus);
      }
      return Promise.resolve(null);
    });
    await import('./index');

    const status = await exposedApi!.playback.playMediaItem({
      item: {
        mediaType: 'local',
        trackId: 'track-ape',
        path: 'D:\\Music\\song.ape',
        title: 'APE Song',
        artist: 'Artist',
        album: 'Album',
        duration: 180,
      },
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.PlaybackPlayMediaItem,
      expect.objectContaining({
        item: expect.objectContaining({ path: 'D:\\Music\\song.ape' }),
        output: expect.objectContaining({ outputMode: 'shared' }),
      }),
    );
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(IpcChannels.PlaybackResolveMediaItem, expect.anything());
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(IpcChannels.AudioCreateSystemStreamUrl, expect.anything());
    expect(fakeAudioInstances).toHaveLength(0);
    expect(status).toBe(nativeStatus);
  });

  it('preserves explicit native output settings for local .ape playback', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.PlaybackPlayLocalFile) {
        return Promise.resolve({
          state: 'playing',
          currentTrackId: 'track-ape-exclusive',
          positionMs: 0,
          durationMs: 180_000,
          filePath: 'D:\\Music\\song.ape',
        });
      }
      return Promise.resolve(null);
    });
    await import('./index');

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\song.ape',
      trackId: 'track-ape-exclusive',
      output: { outputMode: 'exclusive' },
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.PlaybackPlayLocalFile,
      expect.objectContaining({
        output: expect.objectContaining({ outputMode: 'exclusive' }),
      }),
    );
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(IpcChannels.AudioCreateSystemStreamUrl, expect.anything());
    expect(fakeAudioInstances).toHaveLength(0);
  });

  it('does not report a stopped system play request as a fatal HTMLAudio error', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    let rejectPlay: (error: Error) => void = () => undefined;
    queuedAudioPlayPromises = [
      new Promise<void>((_resolve, reject) => {
        rejectPlay = reject;
      }),
    ];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/interrupted-token');
      }
      if (channel === IpcChannels.AudioReportSystemPlaybackError) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });
    await import('./index');

    const playPromise = exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\interrupted.mp3',
      trackId: 'track-interrupted',
      probe: { durationSeconds: 10 },
    });
    await flushPromises();
    expect(fakeAudioInstances[0].play).toHaveBeenCalledTimes(1);

    await expect(exposedApi!.playback.stop()).resolves.toMatchObject({
      state: 'stopped',
      currentTrackId: null,
      filePath: null,
    });
    rejectPlay(new Error('The play() request was interrupted by a call to pause(). https://goo.gl/LdLk22'));

    await expect(playPromise).resolves.toMatchObject({
      state: 'stopped',
      currentTrackId: null,
      filePath: null,
    });
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
      IpcChannels.AudioReportSystemPlaybackError,
      expect.anything(),
    );
    await expect(exposedApi!.audio.getStatus()).resolves.toMatchObject({
      outputMode: 'system',
      state: 'stopped',
      currentTrackId: null,
      error: null,
    });
  });

  it('fades remembered system audio out on pause and back in on play', async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      exposedApi = null;
      fakeAudioInstances = [];
      window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
      vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
        if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
          return Promise.resolve('echo-audio://system/fade-token');
        }
        if (channel === IpcChannels.AppGetSettings) {
          return Promise.resolve({
            audioTransportFadeEnabled: true,
            audioTransportFadeInMs: 80,
            audioTransportFadeOutMs: 80,
            audioTransportFadeCurve: 'linear',
          });
        }
        return Promise.resolve(null);
      });
      await import('./index');

      await exposedApi!.playback.playLocalFile({
        filePath: 'D:\\Music\\fade.flac',
        trackId: 'track-fade',
        probe: { durationSeconds: 10 },
      });
      const element = fakeAudioInstances[0];

      const pausePromise = exposedApi!.playback.pause();
      await vi.advanceTimersByTimeAsync(40);
      expect(element.volume).toBeGreaterThan(0);
      expect(element.volume).toBeLessThan(1);
      await vi.advanceTimersByTimeAsync(40);
      await expect(pausePromise).resolves.toMatchObject({ state: 'paused' });
      expect(element.pause).toHaveBeenCalled();
      expect(element.volume).toBe(0);

      const playPromise = exposedApi!.playback.play();
      await Promise.resolve();
      expect(element.volume).toBe(0);
      await vi.advanceTimersByTimeAsync(40);
      expect(element.volume).toBeGreaterThan(0);
      expect(element.volume).toBeLessThan(1);
      await vi.advanceTimersByTimeAsync(40);
      await expect(playPromise).resolves.toMatchObject({ state: 'playing' });
      expect(element.volume).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps remembered system audio play/pause fade disabled by default', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/no-fade-token');
      }
      if (channel === IpcChannels.AppGetSettings) {
        return Promise.resolve({});
      }
      return Promise.resolve(null);
    });
    await import('./index');

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\no-fade.flac',
      trackId: 'track-no-fade',
      probe: { durationSeconds: 10 },
    });
    const element = fakeAudioInstances[0];

    await expect(exposedApi!.playback.pause()).resolves.toMatchObject({ state: 'paused' });
    expect(element.pause).toHaveBeenCalled();
    expect(element.volume).toBe(1);

    await expect(exposedApi!.playback.play()).resolves.toMatchObject({ state: 'playing' });
    expect(element.volume).toBe(1);
  });

  it('proxies mini-player system audio playback to the main renderer', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    vi.stubGlobal('window', {
      localStorage: createTestLocalStorage(),
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      location: { search: '?miniPlayer=1' },
    });
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    const proxiedStatus = {
      state: 'playing',
      currentTrackId: 'track-mini',
      positionMs: 0,
      durationMs: 180_000,
      filePath: 'D:\\Music\\mini.flac',
    };
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.PlaybackMainWindowCommand) {
        return Promise.resolve(proxiedStatus);
      }
      return Promise.resolve(null);
    });
    await import('./index');

    const status = await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\mini.flac',
      trackId: 'track-mini',
      probe: { durationSeconds: 180 },
    });

    expect(status).toEqual(proxiedStatus);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PlaybackMainWindowCommand, {
      command: 'playLocalFile',
      args: [
        expect.objectContaining({
          filePath: 'D:\\Music\\mini.flac',
          trackId: 'track-mini',
        }),
      ],
    });
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
      IpcChannels.AudioCreateSystemStreamUrl,
      expect.anything(),
    );
    expect(fakeAudioInstances).toHaveLength(0);
  });

  it('executes proxied playback commands in the main renderer', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/proxy-token');
      }
      return Promise.resolve(null);
    });
    await import('./index');

    const listener = listeners.get(IpcChannels.PlaybackMainWindowCommandRequest);
    expect(listener).toBeTruthy();
    listener?.({}, {
      id: 'command-1',
      command: 'playLocalFile',
      args: [
        {
          filePath: 'D:\\Music\\main.flac',
          trackId: 'track-main',
          probe: { durationSeconds: 200 },
        },
      ],
    });
    await flushPromises();

    expect(fakeAudioInstances).toHaveLength(1);
    expect(fakeAudioInstances[0].src).toBe('echo-audio://system/proxy-token');
    expect(ipcRenderer.send).toHaveBeenCalledWith(
      IpcChannels.PlaybackMainWindowCommandResult,
      expect.objectContaining({
        id: 'command-1',
        ok: true,
        value: expect.objectContaining({
          state: 'playing',
          currentTrackId: 'track-main',
          filePath: 'D:\\Music\\main.flac',
        }),
      }),
    );
  });

  it('resets reused system audio playback to the beginning for a new track', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string, request?: unknown) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        const streamRequest = request as { url: string };
        return Promise.resolve(streamRequest.url.includes('next') ? 'echo-audio://system/next-token' : 'echo-audio://system/current-token');
      }
      return Promise.resolve(null);
    });
    await import('./index');

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\current.mp3',
      trackId: 'track-current',
      startSeconds: 119,
      probe: { durationSeconds: 180 },
    });
    expect(fakeAudioInstances[0].currentTime).toBe(119);

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\next.mp3',
      trackId: 'track-next',
      probe: { durationSeconds: 180 },
    });

    expect(fakeAudioInstances).toHaveLength(1);
    expect(fakeAudioInstances[0].src).toBe('echo-audio://system/next-token');
    expect(fakeAudioInstances[0].currentTime).toBe(0);
  });

  it('routes Automix requests through native shared output instead of system HTMLAudio', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.PlaybackPlayLocalFile) {
        return Promise.resolve({
          state: 'playing',
          currentTrackId: 'track-1',
          positionMs: 0,
          durationMs: 180_000,
          filePath: 'D:\\Music\\song.mp3',
        });
      }
      return Promise.resolve(null);
    });
    await import('./index');

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\song.mp3',
      trackId: 'track-1',
      output: { outputMode: 'system' },
      probe: { durationSeconds: 180 },
      automix: {
        enabled: true,
        nextItem: {
          mediaType: 'local',
          trackId: 'track-2',
          path: 'D:\\Music\\next.mp3',
          title: 'Next',
          artist: 'Artist',
          album: 'Album',
          duration: 180,
        },
      },
    });

    expect(fakeAudioInstances).toHaveLength(0);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.PlaybackPlayLocalFile,
      expect.objectContaining({
        output: expect.objectContaining({ outputMode: 'shared' }),
        automix: expect.objectContaining({
          enabled: true,
          nextItem: expect.objectContaining({ trackId: 'track-2' }),
        }),
      }),
    );
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
      IpcChannels.AudioCreateSystemStreamUrl,
      expect.anything(),
    );
  });

  it('ignores stale system audio pause events after playback has resumed', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.PlaybackResolveMediaItem) {
        return Promise.resolve({
          filePath: 'https://cdn.example.test/streaming.flac',
          inputHeaders: undefined,
          mimeType: 'audio/flac',
          durationSeconds: 180,
        });
      }
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/streaming-token');
      }
      return Promise.resolve(null);
    });
    await import('./index');
    const statuses: Array<Awaited<ReturnType<EchoApi['audio']['getStatus']>>> = [];
    exposedApi!.audio.onStatus((status) => statuses.push(status));

    await exposedApi!.playback.playMediaItem({
      item: {
        mediaType: 'streaming',
        trackId: 'streaming-track',
        provider: 'netease',
        providerTrackId: 'provider-track',
        quality: 'high',
        stableKey: 'netease:provider-track',
        title: 'Streaming',
        artist: 'Artist',
        album: 'Album',
        duration: 180,
        coverThumb: null,
        playable: true,
      },
    });

    const statusCount = statuses.length;
    fakeAudioInstances[0].currentTime = 2;
    fakeAudioInstances[0].paused = false;
    fakeAudioInstances[0].emit('pause');

    expect(statuses).toHaveLength(statusCount);
    await expect(exposedApi!.audio.getStatus()).resolves.toMatchObject({
      outputMode: 'system',
      state: 'playing',
      currentTrackId: 'streaming-track',
      positionSeconds: 2,
    });
  });

  it('marks system streaming audio as loading while HTMLAudio waits for data', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.PlaybackResolveMediaItem) {
        return Promise.resolve({
          filePath: 'https://cdn.example.test/streaming.flac',
          inputHeaders: undefined,
          mimeType: 'audio/flac',
          durationSeconds: 180,
        });
      }
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/streaming-token');
      }
      return Promise.resolve(null);
    });
    await import('./index');
    const statuses: Array<Awaited<ReturnType<EchoApi['audio']['getStatus']>>> = [];
    exposedApi!.audio.onStatus((status) => statuses.push(status));

    await exposedApi!.playback.playMediaItem({
      item: {
        mediaType: 'streaming',
        trackId: 'streaming-track',
        provider: 'netease',
        providerTrackId: 'provider-track',
        quality: 'high',
        stableKey: 'netease:provider-track',
        title: 'Streaming',
        artist: 'Artist',
        album: 'Album',
        duration: 180,
        coverThumb: null,
        playable: true,
      },
    });

    fakeAudioInstances[0].emit('waiting');
    expect(statuses.at(-1)).toMatchObject({
      outputMode: 'system',
      state: 'loading',
      currentTrackId: 'streaming-track',
    });

    fakeAudioInstances[0].emit('canplay');
    expect(statuses.at(-1)).toMatchObject({
      outputMode: 'system',
      state: 'playing',
      currentTrackId: 'streaming-track',
    });
  });

  it('marks system audio as playing after the play promise resolves even without a playing event', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    emitAudioPlayingOnPlay = false;
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/no-playing-event');
      }
      return Promise.resolve(null);
    });
    await import('./index');
    const statuses: Array<Awaited<ReturnType<EchoApi['audio']['getStatus']>>> = [];
    exposedApi!.audio.onStatus((status) => statuses.push(status));

    const status = await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\song.mp3',
      trackId: 'track-no-playing-event',
      probe: { durationSeconds: 180 },
    });

    fakeAudioInstances[0].currentTime = 2;

    expect(status).toMatchObject({
      state: 'playing',
      currentTrackId: 'track-no-playing-event',
      positionMs: 0,
    });
    expect(statuses.at(-1)).toMatchObject({
      state: 'playing',
      currentTrackId: 'track-no-playing-event',
    });
    await expect(exposedApi!.audio.getStatus()).resolves.toMatchObject({
      outputMode: 'system',
      state: 'playing',
      currentTrackId: 'track-no-playing-event',
      positionSeconds: 2,
    });
  });

  it('reports local system audio ending before duration as a decode failure', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/broken-token');
      }
      if (channel === IpcChannels.AudioReportSystemPlaybackError) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });
    await import('./index');
    const statuses: Array<Awaited<ReturnType<EchoApi['audio']['getStatus']>>> = [];
    exposedApi!.audio.onStatus((status) => statuses.push(status));

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\broken.flac',
      trackId: 'track-bad',
      probe: { durationSeconds: 120 },
    });
    fakeAudioInstances[0].duration = 120;
    fakeAudioInstances[0].currentTime = 72;
    fakeAudioInstances[0].emit('ended');

    expect(statuses.at(-1)).toMatchObject({
      outputMode: 'system',
      state: 'error',
      currentTrackId: 'track-bad',
      error: expect.stringContaining('system_audio_decode_error'),
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.AudioReportSystemPlaybackError,
      expect.objectContaining({
        phase: 'system-audio-ended-before-duration',
        recovered: false,
        sourceKind: 'local',
        trackId: 'track-bad',
      }),
    );
  });

  it('ignores local system audio ended events while playback is paused', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/paused-token');
      }
      if (channel === IpcChannels.AudioReportSystemPlaybackError) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });
    await import('./index');
    const statuses: Array<Awaited<ReturnType<EchoApi['audio']['getStatus']>>> = [];
    exposedApi!.audio.onStatus((status) => statuses.push(status));

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\paused.flac',
      trackId: 'track-paused',
      probe: { durationSeconds: 120 },
    });
    fakeAudioInstances[0].duration = 120;
    fakeAudioInstances[0].currentTime = 72;
    await exposedApi!.playback.pause();
    fakeAudioInstances[0].emit('ended');

    expect(statuses.at(-1)).toMatchObject({
      outputMode: 'system',
      state: 'paused',
      currentTrackId: 'track-paused',
      error: null,
    });
    await expect(exposedApi!.audio.getStatus()).resolves.toMatchObject({
      outputMode: 'system',
      state: 'paused',
      currentTrackId: 'track-paused',
      positionSeconds: 72,
      error: null,
    });
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
      IpcChannels.AudioReportSystemPlaybackError,
      expect.objectContaining({
        phase: 'system-audio-ended-before-duration',
      }),
    );
  });

  it('accepts local system audio ended after the browser pauses at the media tail', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/natural-end-token');
      }
      return Promise.resolve(null);
    });
    await import('./index');
    const statuses: Array<Awaited<ReturnType<EchoApi['audio']['getStatus']>>> = [];
    exposedApi!.audio.onStatus((status) => statuses.push(status));

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\natural-end.flac',
      trackId: 'track-natural-end',
      probe: { durationSeconds: 120 },
    });
    fakeAudioInstances[0].duration = 120;
    fakeAudioInstances[0].currentTime = 120;
    fakeAudioInstances[0].ended = true;
    fakeAudioInstances[0].paused = true;
    fakeAudioInstances[0].emit('pause');
    fakeAudioInstances[0].emit('ended');

    expect(statuses.at(-1)).toMatchObject({
      outputMode: 'system',
      state: 'ended',
      currentTrackId: 'track-natural-end',
      positionSeconds: 120,
      error: null,
    });
    await expect(exposedApi!.audio.getStatus()).resolves.toMatchObject({
      outputMode: 'system',
      state: 'ended',
      currentTrackId: 'track-natural-end',
      positionSeconds: 120,
      error: null,
    });
  });

  it('allows local system audio to end when only the reported duration looks loose', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/loose-duration-token');
      }
      if (channel === IpcChannels.AudioReportSystemPlaybackError) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });
    await import('./index');
    const statuses: Array<Awaited<ReturnType<EchoApi['audio']['getStatus']>>> = [];
    exposedApi!.audio.onStatus((status) => statuses.push(status));

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\loose-duration.flac',
      trackId: 'track-loose-duration',
      probe: { durationSeconds: 347.293 },
    });
    fakeAudioInstances[0].duration = 347.293;
    fakeAudioInstances[0].currentTime = 267.271;
    fakeAudioInstances[0].emit('ended');

    expect(statuses.at(-1)).toMatchObject({
      outputMode: 'system',
      state: 'ended',
      currentTrackId: 'track-loose-duration',
      error: null,
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.AudioReportSystemPlaybackError,
      expect.objectContaining({
        phase: 'system-audio-ended-before-reported-duration',
        recovered: true,
        sourceKind: 'local',
        trackId: 'track-loose-duration',
      }),
    );
  });

  it('applies ReplayGain on remembered system audio playback', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AppGetSettings) {
        return Promise.resolve({
          replayGainEnabled: true,
          replayGainMode: 'track',
          replayGainPreampDb: 0,
          replayGainPreventClipping: true,
        });
      }
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/replaygain-token');
      }
      return Promise.resolve(null);
    });
    await import('./index');

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\song.mp3',
      trackId: 'track-rg',
      probe: { durationSeconds: 10 },
      replayGain: { trackGainDb: -6, trackPeak: 0.8 },
    });

    expect(fakeAudioInstances[0].volume).toBeCloseTo(0.501, 3);
    await expect(exposedApi!.audio.getStatus()).resolves.toMatchObject({
      outputMode: 'system',
      replayGainEnabled: true,
      replayGainMode: 'track',
      replayGainAppliedDb: -6,
    });
  });

  it('keeps active system audio playback alive when changing volume', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string, settings?: unknown) => {
      if (channel === IpcChannels.AudioSetOutput) {
        const output = settings as { volume?: number };
        return Promise.resolve({
          outputMode: 'shared',
          playbackRate: 1,
          playbackSpeedMode: 'nightcore',
          volume: output.volume ?? 1,
          warnings: [],
        });
      }
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/volume-token');
      }
      return Promise.resolve(null);
    });
    await import('./index');

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\song.mp3',
      trackId: 'track-volume',
      probe: { durationSeconds: 10 },
    });
    fakeAudioInstances[0].pause.mockClear();
    const nextStatus = await exposedApi!.audio.setOutput({ volume: 0.25 });

    expect(fakeAudioInstances[0].pause).not.toHaveBeenCalled();
    expect(fakeAudioInstances[0].volume).toBeCloseTo(0.25, 3);
    expect(nextStatus).toMatchObject({
      outputMode: 'system',
      state: 'playing',
      currentTrackId: 'track-volume',
      volume: 0.25,
    });
  });

  it('lets system Nightcore pitch follow playback speed like osu!', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string, settings?: unknown) => {
      if (channel === IpcChannels.AudioSetOutput) {
        const output = settings as { playbackRate?: number; playbackSpeedMode?: string; outputMode?: string };
        return Promise.resolve({
          outputMode: output.outputMode ?? 'system',
          playbackRate: output.playbackRate ?? 1,
          playbackSpeedMode: output.playbackSpeedMode ?? 'nightcore',
          volume: 1,
          warnings: [],
        });
      }
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/nightcore-token');
      }
      return Promise.resolve(null);
    });
    await import('./index');

    await exposedApi!.audio.setOutput({ outputMode: 'system', playbackRate: 1.25, playbackSpeedMode: 'nightcore' });
    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\song.mp3',
      trackId: 'track-nightcore',
      probe: { durationSeconds: 10 },
    });

    expect(fakeAudioInstances[0].playbackRate).toBe(1.25);
    expect(fakeAudioInstances[0].preservesPitch).toBe(false);
    expect(fakeAudioInstances[0].mozPreservesPitch).toBe(false);
    expect(fakeAudioInstances[0].webkitPreservesPitch).toBe(false);

    await exposedApi!.audio.setOutput({ outputMode: 'system', playbackRate: 1.25, playbackSpeedMode: 'speed' });

    expect(fakeAudioInstances[0].playbackRate).toBe(1.25);
    expect(fakeAudioInstances[0].preservesPitch).toBe(true);
  });

  it('rejects a system audio seek when HTMLAudio stays at the old position', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string) => {
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        return Promise.resolve('echo-audio://system/seek-token');
      }
      return Promise.resolve(null);
    });
    await import('./index');

    await exposedApi!.playback.playLocalFile({
      filePath: 'D:\\Music\\song.mp3',
      trackId: 'track-seek',
      probe: { durationSeconds: 10 },
    });
    fakeAudioInstances[0].currentTime = 2;
    ignoreAudioCurrentTimeWrites = true;

    const seekPromise = exposedApi!.playback.seek(8);
    const seekAssertion = expect(seekPromise).rejects.toThrow('system_audio_seek_timeout');
    await vi.advanceTimersByTimeAsync(2600);

    await seekAssertion;
    await expect(exposedApi!.audio.getStatus()).resolves.toMatchObject({
      outputMode: 'system',
      error: 'system_audio_seek_timeout',
      positionSeconds: 2,
    });
  });

  it('refreshes a system media source after the initial HTMLAudio play fails', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    queuedAudioPlayFailures = [new Error('expired stream')];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string, request?: unknown) => {
      if (channel === IpcChannels.PlaybackResolveMediaItem) {
        const playbackRequest = request as { forceRefresh?: boolean };
        return Promise.resolve(
          playbackRequest.forceRefresh
            ? {
                filePath: 'https://cdn.example.test/refreshed.mp3',
                inputHeaders: { Referer: 'https://music.example.test/' },
                mimeType: 'audio/mpeg',
                durationSeconds: 180,
              }
            : {
                filePath: 'https://cdn.example.test/expired.flac',
                inputHeaders: { Referer: 'https://music.example.test/' },
                mimeType: 'audio/flac',
                durationSeconds: 180,
              },
        );
      }
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        const streamRequest = request as { url: string };
        return Promise.resolve(streamRequest.url.includes('refreshed') ? 'echo-audio://system/fresh' : 'echo-audio://system/stale');
      }
      if (channel === IpcChannels.AudioReportSystemPlaybackError) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });
    await import('./index');

    const status = await exposedApi!.playback.playMediaItem({
      item: {
        mediaType: 'streaming',
        trackId: 'streaming-track',
        provider: 'netease',
        providerTrackId: 'provider-track',
        quality: 'high',
        stableKey: 'netease:provider-track',
        title: 'Streaming',
        artist: 'Artist',
        album: 'Album',
        duration: 180,
        coverThumb: null,
        playable: true,
      },
    });

    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(IpcChannels.PlaybackPlayMediaItem, expect.anything());
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.PlaybackResolveMediaItem,
      expect.objectContaining({ forceRefresh: true }),
    );
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AudioCreateSystemStreamUrl, {
      url: 'https://cdn.example.test/expired.flac',
      headers: { Referer: 'https://music.example.test/' },
      mimeType: 'audio/flac',
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AudioCreateSystemStreamUrl, {
      url: 'https://cdn.example.test/refreshed.mp3',
      headers: { Referer: 'https://music.example.test/' },
      mimeType: 'audio/mpeg',
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.AudioReportSystemPlaybackError,
      expect.objectContaining({
        phase: 'system-audio-htmlaudio-error',
        recovered: true,
        mediaType: 'streaming',
        provider: 'netease',
      }),
    );
    expect(fakeAudioInstances[0].play).toHaveBeenCalledTimes(2);
    expect(fakeAudioInstances[0].src).toBe('echo-audio://system/fresh');
    expect(status.filePath).toBe('https://cdn.example.test/refreshed.mp3');
  });

  it('recovers an asynchronous HTMLAudio error without leaving system output mode', async () => {
    vi.resetModules();
    exposedApi = null;
    fakeAudioInstances = [];
    window.localStorage.setItem('echo-next.audio-output-memory', JSON.stringify({ enabled: true, outputMode: 'system' }));
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel: string, request?: unknown) => {
      if (channel === IpcChannels.PlaybackResolveMediaItem) {
        const playbackRequest = request as { forceRefresh?: boolean };
        return Promise.resolve(
          playbackRequest.forceRefresh
            ? {
                filePath: 'https://cdn.example.test/recovered.mp3',
                inputHeaders: undefined,
                mimeType: 'audio/mpeg',
                durationSeconds: 90,
              }
            : {
                filePath: 'https://cdn.example.test/initial.mp3',
                inputHeaders: undefined,
                mimeType: 'audio/mpeg',
                durationSeconds: 90,
              },
        );
      }
      if (channel === IpcChannels.AudioCreateSystemStreamUrl) {
        const streamRequest = request as { url: string };
        return Promise.resolve(streamRequest.url.includes('recovered') ? 'echo-audio://system/recovered' : 'echo-audio://system/initial');
      }
      if (channel === IpcChannels.AudioReportSystemPlaybackError) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });
    await import('./index');

    await exposedApi!.playback.playMediaItem({
      item: {
        mediaType: 'streaming',
        trackId: 'streaming-track',
        provider: 'soundcloud',
        providerTrackId: 'provider-track',
        stableKey: 'soundcloud:provider-track',
        title: 'Streaming',
        artist: 'Artist',
        album: 'Album',
        duration: 90,
        coverThumb: null,
        playable: true,
      },
    });

    fakeAudioInstances[0].currentTime = 12;
    fakeAudioInstances[0].triggerError('media element decode failed', 3);
    await flushPromises();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.PlaybackResolveMediaItem,
      expect.objectContaining({ forceRefresh: true, startSeconds: 12 }),
    );
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.AudioReportSystemPlaybackError,
      expect.objectContaining({
        phase: 'system-audio-htmlaudio-error',
        recovered: true,
        mediaType: 'streaming',
        provider: 'soundcloud',
        htmlAudio: expect.objectContaining({
          errorCode: 3,
          errorMessage: 'media element decode failed',
        }),
      }),
    );
    expect(fakeAudioInstances[0].play).toHaveBeenCalledTimes(2);
    expect(fakeAudioInstances[0].src).toBe('echo-audio://system/recovered');
    await expect(exposedApi!.audio.getStatus()).resolves.toMatchObject({
      outputMode: 'system',
      state: 'playing',
      currentTrackId: 'streaming-track',
    });
  });

  it('subscribes to system local audio file open events and unsubscribes cleanly', () => {
    const handler = vi.fn();
    const listener = listeners.get(IpcChannels.PlaybackLocalAudioFilesOpened);

    expect(listener).toBeTruthy();
    listener?.({}, ['D:\\Music\\queued-before-subscribe.flac']);
    const unsubscribe = exposedApi!.playback.onLocalAudioFilesOpened(handler);
    expect(handler).toHaveBeenCalledWith(['D:\\Music\\queued-before-subscribe.flac']);

    listener?.({}, ['D:\\Music\\song.flac', 12, 'D:\\Music\\two.opus']);
    expect(handler).toHaveBeenCalledWith(['D:\\Music\\song.flac', 'D:\\Music\\two.opus']);

    unsubscribe();
    listener?.({}, ['D:\\Music\\after-unsubscribe.flac']);
    expect(handler).not.toHaveBeenCalledWith(['D:\\Music\\after-unsubscribe.flac']);
  });

  it('subscribes to playback queue session changes and unsubscribes cleanly', () => {
    const handler = vi.fn();
    const unsubscribe = exposedApi!.playback.onQueueSessionChanged?.(handler);
    const listener = listeners.get(IpcChannels.PlaybackQueueSessionChanged);
    const snapshot = { version: 1, items: [], updatedAt: '2026-05-26T00:00:00.000Z' };

    expect(listener).toBeTruthy();
    listener?.({}, snapshot);
    expect(handler).toHaveBeenCalledWith(snapshot);

    unsubscribe?.();
    expect(ipcRenderer.off).toHaveBeenCalledWith(IpcChannels.PlaybackQueueSessionChanged, listener);
    expect(listeners.get(IpcChannels.PlaybackQueueSessionChanged)).toBeUndefined();
  });

  it('exposes lyrics wallpaper picker through IPC', async () => {
    await exposedApi!.app.chooseLyricsWallpaper();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppChooseLyricsWallpaper);
  });

  it('exposes app wallpaper picker through IPC', async () => {
    await exposedApi!.app.chooseAppWallpaper();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppChooseAppWallpaper);
  });

  it('exposes app update helpers through IPC', async () => {
    const handler = vi.fn();
    await exposedApi!.app.getUpdateStatus();
    await exposedApi!.app.checkForUpdates();
    const unsubscribe = exposedApi!.app.onUpdateStatus(handler);
    const listener = listeners.get(IpcChannels.AppUpdateStatusChanged);
    const status = { state: 'downloading', downloadPercent: 42 };
    listener?.({}, status);
    unsubscribe();
    await exposedApi!.app.openRepository();
    await exposedApi!.app.openExternalUrl('https://discord.gg/g7v4WMRq3K');
    await exposedApi!.app.testNetworkProxy();
    await exposedApi!.app.showTouchKeyboard();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppGetUpdateStatus);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppCheckForUpdates);
    expect(handler).toHaveBeenCalledWith(status);
    expect(listeners.has(IpcChannels.AppUpdateStatusChanged)).toBe(false);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppOpenRepository);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppOpenExternalUrl, 'https://discord.gg/g7v4WMRq3K');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppTestNetworkProxy);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppShowTouchKeyboard);
  });

  it('exposes app window maximized state through IPC', async () => {
    const handler = vi.fn();

    await exposedApi!.app.isMaximized();
    const unsubscribe = exposedApi!.app.onMaximizedChange(handler);
    const listener = listeners.get(IpcChannels.AppWindowMaximizedChanged);
    listener?.({}, true);
    listener?.({}, 'yes');
    unsubscribe();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppWindowIsMaximized);
    expect(handler).toHaveBeenNthCalledWith(1, true);
    expect(handler).toHaveBeenNthCalledWith(2, false);
    expect(listeners.has(IpcChannels.AppWindowMaximizedChanged)).toBe(false);
  });

  it('exposes app window fullscreen helpers through IPC', async () => {
    const handler = vi.fn();

    await exposedApi!.app.toggleFullscreen();
    await exposedApi!.app.triggerFullscreenShortcut();
    await exposedApi!.app.isFullscreen();
    const unsubscribe = exposedApi!.app.onFullscreenChange(handler);
    const listener = listeners.get(IpcChannels.AppWindowFullscreenChanged);
    listener?.({}, true);
    listener?.({}, 'yes');
    unsubscribe();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppWindowToggleFullscreen);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppWindowTriggerFullscreenShortcut);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppWindowIsFullscreen);
    expect(handler).toHaveBeenNthCalledWith(1, true);
    expect(handler).toHaveBeenNthCalledWith(2, false);
    expect(listeners.has(IpcChannels.AppWindowFullscreenChanged)).toBe(false);
  });

  it('exposes mini player window helpers through IPC', async () => {
    const handler = vi.fn();
    await exposedApi!.miniPlayer.show();
    await exposedApi!.miniPlayer.hide();
    await exposedApi!.miniPlayer.hide({ restoreMainWindow: true });
    await exposedApi!.miniPlayer.getState();
    await exposedApi!.miniPlayer.setLocked(true);
    await exposedApi!.miniPlayer.setQueueOpen(true);
    await exposedApi!.miniPlayer.resetBounds();
    const unsubscribe = exposedApi!.miniPlayer.onStateChanged(handler);
    const listener = listeners.get(IpcChannels.MiniPlayerStateChanged);
    const state = {
      visible: true,
      locked: true,
      bounds: null,
      settings: {
        miniPlayerEnabled: true,
        miniPlayerLocked: true,
        miniPlayerAutoHideMainWindow: false,
        miniPlayerBounds: null,
      },
    };

    listener?.({}, state);
    unsubscribe();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MiniPlayerShow);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MiniPlayerHide);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MiniPlayerHide, { restoreMainWindow: true });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MiniPlayerGetState);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MiniPlayerSetLocked, true);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MiniPlayerSetQueueOpen, true);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MiniPlayerResetBounds);
    expect(handler).toHaveBeenCalledWith(state);
    expect(listeners.has(IpcChannels.MiniPlayerStateChanged)).toBe(false);
  });

  it('exposes global shortcut validation and command events', async () => {
    const handler = vi.fn();
    await exposedApi!.app.validateGlobalShortcut('Ctrl+Alt+Space');
    const unsubscribe = exposedApi!.app.onGlobalShortcutCommand(handler);
    const listener = listeners.get(IpcChannels.AppGlobalShortcutCommand);

    listener?.({}, 'playPause');
    unsubscribe();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppValidateGlobalShortcut, 'Ctrl+Alt+Space');
    expect(handler).toHaveBeenCalledWith('playPause');
    expect(listeners.has(IpcChannels.AppGlobalShortcutCommand)).toBe(false);
  });

  it('exposes duplicate track APIs through IPC', async () => {
    await exposedApi!.library.refreshDuplicateTracks('strict');
    await exposedApi!.library.getDuplicateTrackVersions('track-1');
    await exposedApi!.library.getDuplicateHiddenCounts(['track-1'], 'strict');
    await exposedApi!.library.getDuplicateIndexSummary('strict');
    await exposedApi!.library.previewDuplicateTrackCleanup('strict');
    await exposedApi!.library.applyDuplicateTrackCleanup({ mode: 'strict', trackIds: ['track-2'] });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryRefreshDuplicateTracks, 'strict');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetDuplicateTrackVersions, 'track-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetDuplicateHiddenCounts, ['track-1'], 'strict');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetDuplicateIndexSummary, 'strict');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryPreviewDuplicateTrackCleanup, 'strict');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryApplyDuplicateTrackCleanup, { mode: 'strict', trackIds: ['track-2'] });
  });

  it('exposes database recovery discard action through IPC', async () => {
    await exposedApi!.library.discardQuarantinedProblemTracks();
    await exposedApi!.library.relaunchRecoveryMode();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryDiscardQuarantinedProblemTracks);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryRelaunchRecoveryMode);
  });

  it('exposes plugin management APIs through IPC', async () => {
    await exposedApi!.plugins.list();
    await exposedApi!.plugins.createExample('playback-panel');
    await exposedApi!.plugins.enable({ pluginId: 'echo.playback-panel', trustedPermissions: ['playback:read'] });
    await exposedApi!.plugins.disable('echo.playback-panel');
    await exposedApi!.plugins.reload('echo.playback-panel');
    await exposedApi!.plugins.openDirectory('echo.playback-panel');
    await exposedApi!.plugins.exportPackage('echo.playback-panel');
    await exposedApi!.plugins.importPackage();
    const pluginPackageFile = new File(['{}'], 'plugin.echo', { type: 'application/json' });
    vi.mocked(webUtils.getPathForFile).mockReturnValueOnce('D:\\Echo\\plugin.echo');
    await exposedApi!.plugins.importPackage(pluginPackageFile);
    await exposedApi!.plugins.runCommand({ pluginId: 'echo.playback-panel', commandId: 'show-status' });
    await exposedApi!.plugins.queryMetadata({ track: { title: 'Song' } });
    await exposedApi!.plugins.querySources({ query: 'Song' });
    await exposedApi!.plugins.resolveSourcePlayback({ pluginId: 'echo.source-provider', providerId: 'direct-url', providerTrackId: 'demo-stream' });
    await exposedApi!.plugins.queryLyrics({ track: { title: 'Song' } });
    await exposedApi!.plugins.queryCovers({ track: { title: 'Song' } });
    await exposedApi!.plugins.getSettings('echo.playback-panel');
    await exposedApi!.plugins.setSettings('echo.playback-panel', { mode: 'fast' });
    await exposedApi!.plugins.getLogs('echo.playback-panel');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsList);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsCreateExample, 'playback-panel');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsEnable, {
      pluginId: 'echo.playback-panel',
      trustedPermissions: ['playback:read'],
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsDisable, 'echo.playback-panel');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsReload, 'echo.playback-panel');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsOpenDirectory, 'echo.playback-panel');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsExportPackage, 'echo.playback-panel');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsImportPackage);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsImportPackage, 'D:\\Echo\\plugin.echo');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsRunCommand, {
      pluginId: 'echo.playback-panel',
      commandId: 'show-status',
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsQueryMetadata, { track: { title: 'Song' } });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsQuerySources, { query: 'Song' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsResolveSourcePlayback, {
      pluginId: 'echo.source-provider',
      providerId: 'direct-url',
      providerTrackId: 'demo-stream',
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsQueryLyrics, { track: { title: 'Song' } });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsQueryCovers, { track: { title: 'Song' } });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsGetSettings, 'echo.playback-panel');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsSetSettings, 'echo.playback-panel', { mode: 'fast' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PluginsGetLogs, 'echo.playback-panel');
  });

  it('exposes account status APIs without cookie readback helpers', async () => {
    const handler = vi.fn();
    await exposedApi!.accounts.saveCookie('netease', 'MUSIC_U=secret');
    await exposedApi!.accounts.startLogin?.('netease');
    await exposedApi!.accounts.setBrowser('soundcloud', 'chrome');
    await exposedApi!.accounts.getStatuses();
    const unsubscribe = exposedApi!.accounts.onStatusesChanged(handler);
    const listener = listeners.get(IpcChannels.AccountStatusesChanged);
    const statuses = [{ provider: 'bilibili', connected: false, error: 'expired' }];
    listener?.({}, statuses);
    unsubscribe();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AccountSaveCookie, 'netease', 'MUSIC_U=secret');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AccountStartLogin, 'netease');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AccountSetBrowser, 'soundcloud', 'chrome');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AccountGetStatuses);
    expect(handler).toHaveBeenCalledWith(statuses);
    expect(listeners.has(IpcChannels.AccountStatusesChanged)).toBe(false);
    expect(Object.keys(exposedApi!.accounts)).not.toContain('getCookie');
  });

  it('exposes lyrics APIs through IPC', async () => {
    await exposedApi!.lyrics.getForTrack('track-1');
    await exposedApi!.lyrics.searchCandidates('track-1');
    await exposedApi!.lyrics.previewCandidate?.('track-1', 'candidate-1');
    await exposedApi!.lyrics.applyCandidate('track-1', 'candidate-1');
    await exposedApi!.lyrics.embedToTrack?.('track-1', { candidateId: 'candidate-1' });
    await exposedApi!.lyrics.applyCustomLrc?.('track-1', '[00:01.00]Line', 'custom.lrc');
    await exposedApi!.lyrics.markInstrumental('track-1');
    await exposedApi!.lyrics.rejectCandidate('candidate-1');
    await exposedApi!.lyrics.setOffset('track-1', 500);
    await exposedApi!.lyrics.clearCache('track-1');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LyricsGetForTrack, 'track-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LyricsSearchCandidates, 'track-1', undefined, undefined);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LyricsPreviewCandidate, 'track-1', 'candidate-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LyricsApplyCandidate, 'track-1', 'candidate-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LyricsEmbedToTrack, 'track-1', { candidateId: 'candidate-1' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LyricsApplyCustomLrc, 'track-1', '[00:01.00]Line', 'custom.lrc');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LyricsMarkInstrumental, 'track-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LyricsRejectCandidate, 'candidate-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LyricsSetOffset, 'track-1', 500);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LyricsClearCache, 'track-1');
  });

  it('exposes MV APIs through IPC', async () => {
    await exposedApi!.mv.getSelected('track-1');
    await exposedApi!.mv.getSettings();
    await exposedApi!.mv.setSettings({ maxQuality: '2160p' });
    await exposedApi!.mv.findLocalCandidates('track-1');
    await exposedApi!.mv.searchNetworkCandidates('track-1');
    await exposedApi!.mv.getTemporaryPlayableForSnapshot({
      trackId: 'track-1',
      title: 'Song',
      artist: 'Artist',
      mediaType: 'local',
    });
    await exposedApi!.mv.getCandidates('track-1');
    await exposedApi!.mv.resolveStreams('video-1');
    await exposedApi!.mv.setQuality('video-1', 'auto');
    await exposedApi!.mv.setOffset('track-1', 250);
    await exposedApi!.mv.chooseLocalVideo('track-1');
    await exposedApi!.mv.bindLocalVideo('track-1', 'D:\\Music\\Song.mp4');
    await exposedApi!.mv.bindUrl('track-1', 'https://www.bilibili.com/video/BV1ECHO');
    await exposedApi!.mv.selectVideo('track-1', 'video-1');
    await exposedApi!.mv.clearSelected('track-1');
    await exposedApi!.mv.openExternal('video-1');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvGetSelected, 'track-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvGetSettings);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvSetSettings, { maxQuality: '2160p' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvFindLocalCandidates, 'track-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvSearchNetworkCandidates, 'track-1', undefined);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvGetTemporaryPlayableForSnapshot, {
      trackId: 'track-1',
      title: 'Song',
      artist: 'Artist',
      mediaType: 'local',
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvGetCandidates, 'track-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvResolveStreams, 'video-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvSetQuality, 'video-1', 'auto');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvSetOffset, 'track-1', 250);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvChooseLocalVideo, 'track-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvBindLocalVideo, 'track-1', 'D:\\Music\\Song.mp4');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvBindUrl, 'track-1', 'https://www.bilibili.com/video/BV1ECHO');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvSelectVideo, 'track-1', 'video-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvClearSelected, 'track-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.MvOpenExternal, 'video-1');
  });
});
