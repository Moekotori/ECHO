import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AudioStatus } from '../../shared/types/audio';

vi.mock('electron', () => ({
  nativeImage: {
    createFromBitmap: vi.fn(() => ({ toPNG: () => Buffer.from('png') })),
    createFromBuffer: vi.fn(() => ({ isEmpty: () => false })),
  },
}));

vi.mock('../audio/AudioSession', () => ({
  getAudioSession: vi.fn(),
}));

vi.mock('../library/LibraryService', () => ({
  getLibraryService: vi.fn(),
}));

vi.mock('./appSettings', () => ({
  getAppSettings: vi.fn(() => ({ taskbarPlaybackControlsEnabled: true })),
}));

const makeStatus = (overrides: Partial<AudioStatus> = {}): AudioStatus =>
  ({
    host: 'ready',
    state: 'playing',
    outputDeviceId: null,
    outputDeviceName: null,
    outputDeviceType: null,
    outputBackend: null,
    activeOutputBackendImpl: null,
    outputMode: 'shared',
    useJuceOutputRequested: false,
    useJuceDecodeRequested: false,
    activeDecodeBackendImpl: null,
    volume: 1,
    playbackRate: 1,
    playbackSpeedMode: 'nightcore',
    currentFilePath: 'D:\\Music\\Loose.flac',
    currentTrackId: 'track-1',
    durationSeconds: 200,
    positionSeconds: 50,
    channels: 2,
    codec: 'flac',
    bitDepth: 16,
    bitrate: 900000,
    fileSampleRate: 44100,
    decoderOutputSampleRate: 44100,
    requestedOutputSampleRate: 44100,
    actualDeviceSampleRate: 44100,
    sharedDeviceSampleRate: 44100,
    resampling: false,
    bitPerfectCandidate: false,
    sampleRateMismatch: false,
    eqEnabled: false,
    channelBalanceEnabled: false,
    dspActive: false,
    preampDb: 0,
    eqPresetName: 'Flat',
    clippingRisk: false,
    bitPerfectDisabledReason: null,
    warnings: [],
    error: null,
    ...overrides,
  }) as AudioStatus;

const createAudioSession = (status = makeStatus()) => {
  const emitter = new EventEmitter();
  return {
    getStatus: vi.fn(() => status),
    on: vi.fn((event: 'status', listener: (nextStatus: AudioStatus) => void) => {
      emitter.on(event, listener);
    }),
    off: vi.fn((event: 'status', listener: (nextStatus: AudioStatus) => void) => {
      emitter.off(event, listener);
    }),
    emitStatus: (nextStatus: AudioStatus) => emitter.emit('status', nextStatus),
  };
};

const createWindow = () => ({
  destroyed: false,
  sent: [] as Array<[string, unknown]>,
  setProgressBar: vi.fn(),
  setThumbarButtons: vi.fn((_buttons: Array<{ click: () => void }>) => true),
  setThumbnailToolTip: vi.fn(),
  setTitle: vi.fn(),
  isDestroyed() {
    return this.destroyed;
  },
  webContents: {
    send: vi.fn((channel: string, payload: unknown) => {
      window.sent.push([channel, payload]);
    }),
  },
});

let window: ReturnType<typeof createWindow>;

describe('TaskbarPlaybackIntegration', () => {
  beforeEach(() => {
    vi.resetModules();
    window = createWindow();
  });

  it('sets playback progress and the current track title on Windows', async () => {
    const { TaskbarPlaybackIntegration } = await import('./taskbarPlaybackIntegration');
    const audioSession = createAudioSession();
    const integration = new TaskbarPlaybackIntegration({
      window,
      audioSession,
      platform: 'win32',
      getSettings: () => ({ taskbarPlaybackControlsEnabled: true }),
      getLibrary: () => ({
        getTrack: () => ({ title: 'Song A', artist: 'Artist A' }),
      }),
      createIcon: () => ({ isEmpty: () => false }) as never,
    });

    integration.initialize();

    expect(window.setProgressBar).toHaveBeenCalledWith(0.25, { mode: 'normal' });
    expect(window.setTitle).toHaveBeenCalledWith('Song A - Artist A | ECHO Next');
    expect(window.setThumbnailToolTip).toHaveBeenCalledWith('Song A - Artist A | ECHO Next');
    expect(window.setThumbarButtons).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ tooltip: 'Pause' })]));
    integration.dispose();
  });

  it('uses audio status metadata for streaming tracks that are not in the library', async () => {
    const { TaskbarPlaybackIntegration } = await import('./taskbarPlaybackIntegration');
    const audioSession = createAudioSession(makeStatus({
      currentFilePath: 'https://cdn.example.test/play/opaque-stream-token?expires=soon',
      currentTrackId: 'streaming:youtube:abc123',
      currentTrackTitle: 'Streaming Song',
      currentTrackArtist: 'Streaming Artist',
      currentTrackAlbumArtist: 'Streaming Album Artist',
    }));
    const integration = new TaskbarPlaybackIntegration({
      window,
      audioSession,
      platform: 'win32',
      getSettings: () => ({ taskbarPlaybackControlsEnabled: true }),
      getLibrary: () => ({
        getTrack: () => null,
      }),
      createIcon: () => ({ isEmpty: () => false }) as never,
    });

    integration.initialize();

    expect(window.setTitle).toHaveBeenCalledWith('Streaming Song - Streaming Artist | ECHO Next');
    expect(window.setThumbnailToolTip).toHaveBeenCalledWith('Streaming Song - Streaming Artist | ECHO Next');
    integration.dispose();
  });

  it('keeps paused progress but marks the taskbar progress as paused', async () => {
    const { TaskbarPlaybackIntegration } = await import('./taskbarPlaybackIntegration');
    const audioSession = createAudioSession(makeStatus({ state: 'paused', positionSeconds: 80, durationSeconds: 160 }));
    const integration = new TaskbarPlaybackIntegration({
      window,
      audioSession,
      platform: 'win32',
      getSettings: () => ({ taskbarPlaybackControlsEnabled: true }),
      getLibrary: () => ({
        getTrack: () => ({ title: 'Paused Song', artist: null }),
      }),
      createIcon: () => ({ isEmpty: () => false }) as never,
    });

    integration.initialize();

    expect(window.setProgressBar).toHaveBeenCalledWith(0.5, { mode: 'paused' });
    expect(window.setTitle).toHaveBeenCalledWith('Paused Song | ECHO Next');
    expect(window.setThumbarButtons).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ tooltip: 'Play' })]));
  });

  it('clears taskbar state when playback stops', async () => {
    const { TaskbarPlaybackIntegration } = await import('./taskbarPlaybackIntegration');
    const audioSession = createAudioSession(makeStatus({ state: 'stopped' }));
    const integration = new TaskbarPlaybackIntegration({
      window,
      audioSession,
      platform: 'win32',
      getSettings: () => ({ taskbarPlaybackControlsEnabled: true }),
      getLibrary: () => ({
        getTrack: () => ({ title: 'Song A', artist: 'Artist A' }),
      }),
      createIcon: () => ({ isEmpty: () => false }) as never,
    });

    integration.initialize();

    expect(window.setProgressBar).toHaveBeenCalledWith(-1);
    expect(window.setThumbarButtons).toHaveBeenCalledWith([]);
    expect(window.setTitle).toHaveBeenCalledWith('ECHO NEXT');
  });

  it('clears taskbar state when taskbar playback controls are disabled', async () => {
    const { TaskbarPlaybackIntegration } = await import('./taskbarPlaybackIntegration');
    const audioSession = createAudioSession();
    const integration = new TaskbarPlaybackIntegration({
      window,
      audioSession,
      platform: 'win32',
      getSettings: () => ({ taskbarPlaybackControlsEnabled: false }),
      getLibrary: () => ({
        getTrack: () => ({ title: 'Song A', artist: 'Artist A' }),
      }),
      createIcon: () => ({ isEmpty: () => false }) as never,
    });

    integration.initialize();

    expect(window.setProgressBar).toHaveBeenCalledWith(-1);
    expect(window.setThumbarButtons).toHaveBeenCalledWith([]);
    expect(window.setTitle).toHaveBeenCalledWith('ECHO NEXT');
  });

  it('forwards taskbar thumbnail button clicks through the SMTC command channel', async () => {
    const { TaskbarPlaybackIntegration } = await import('./taskbarPlaybackIntegration');
    const audioSession = createAudioSession();
    const integration = new TaskbarPlaybackIntegration({
      window,
      audioSession,
      platform: 'win32',
      getSettings: () => ({ taskbarPlaybackControlsEnabled: true }),
      getLibrary: () => ({
        getTrack: () => ({ title: 'Song A', artist: 'Artist A' }),
      }),
      createIcon: () => ({ isEmpty: () => false }) as never,
    });

    integration.initialize();
    const buttons = window.setThumbarButtons.mock.calls.at(-1)?.[0] ?? [];
    buttons[0].click();
    buttons[1].click();
    buttons[2].click();

    expect(window.webContents.send).toHaveBeenCalledWith(IpcChannels.SmtcCommand, 'previous');
    expect(window.webContents.send).toHaveBeenCalledWith(IpcChannels.SmtcCommand, 'playPause');
    expect(window.webContents.send).toHaveBeenCalledWith(IpcChannels.SmtcCommand, 'next');
    integration.dispose();
  });

  it('adds a liked button and refreshes the taskbar state after toggling the current track', async () => {
    const { TaskbarPlaybackIntegration } = await import('./taskbarPlaybackIntegration');
    const audioSession = createAudioSession();
    const likeTrack = vi.fn<(trackId: string) => void>();
    const unlikeTrack = vi.fn<(trackId: string) => void>();
    let liked = false;
    const integration = new TaskbarPlaybackIntegration({
      window,
      audioSession,
      platform: 'win32',
      getSettings: () => ({ taskbarPlaybackControlsEnabled: true }),
      getLibrary: () => ({
        getTrack: () => ({ title: 'Song A', artist: 'Artist A' }),
        isTrackLiked: () => liked,
        likeTrack: (trackId: string) => {
          liked = true;
          likeTrack(trackId);
        },
        unlikeTrack: (trackId: string) => {
          liked = false;
          unlikeTrack(trackId);
        },
      }),
      createIcon: () => ({ isEmpty: () => false }) as never,
    });

    integration.initialize();
    let buttons = window.setThumbarButtons.mock.calls.at(-1)?.[0] ?? [];
    expect(buttons).toEqual(expect.arrayContaining([expect.objectContaining({ tooltip: 'Like' })]));

    buttons[3].click();

    expect(likeTrack).toHaveBeenCalledWith('track-1');
    expect(window.webContents.send).toHaveBeenCalledWith(IpcChannels.LibraryLikedTracksChanged);
    buttons = window.setThumbarButtons.mock.calls.at(-1)?.[0] ?? [];
    expect(buttons).toEqual(expect.arrayContaining([expect.objectContaining({ tooltip: 'Unlike' })]));

    buttons[3].click();

    expect(unlikeTrack).toHaveBeenCalledWith('track-1');
    integration.dispose();
  });
});
