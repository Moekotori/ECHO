import { describe, expect, it, vi } from 'vitest';
import { createMockIpcRenderer } from '../test-utils/electronMocks';
import { IpcChannels } from '../shared/constants/ipcChannels';
import { createAppApi } from './ipc/appApi';
import { createLibraryApi } from './ipc/libraryApi';
import { createPlaybackApi, type PlaybackDeps } from './ipc/playbackApi';
import { createAudioApi } from './ipc/ipcAudio';
import { createEqApi } from './ipc/ipcEq';
import { createSystemAudioEngine, type SystemAudioEngine } from './systemAudioEngine';

function createMockSa(): SystemAudioEngine {
  return {
    onAudioStatus: vi.fn(() => vi.fn()),
    onTrackChange: vi.fn(() => vi.fn()),
    onLocalAudioFilesOpened: vi.fn(() => vi.fn()),
    onAutomixAdvance: vi.fn(() => vi.fn()),
    getSystemAudioStatus: vi.fn().mockReturnValue({
      host: 'ready', state: 'idle', outputMode: 'system', outputDeviceId: null,
      outputDeviceName: '', outputDeviceType: 'system', outputBackend: '',
      activeOutputBackendImpl: '', sharedBackend: 'auto', volume: 1, playbackRate: 1,
      playbackSpeedMode: 'nightcore', replayGainEnabled: false, replayGainMode: 'track',
      replayGainAppliedDb: 0, replayGainPreventedClipping: false, currentFilePath: null,
      currentTrackId: null, currentTrackTitle: null, currentTrackArtist: null,
      currentTrackAlbum: null, currentTrackAlbumArtist: null, currentTrackCoverUrl: null,
      durationSeconds: 0, positionSeconds: 0, channels: null, codec: null, bitDepth: null,
      bitrate: null, fileSampleRate: null, decoderOutputSampleRate: null,
      requestedOutputSampleRate: null, actualDeviceSampleRate: null, sharedDeviceSampleRate: null,
      resampling: false, ffmpegPath: null, ffmpegSource: null, ffmpegVersion: null,
      ffmpegHealthy: false, soxrAvailable: false, resamplerEngine: 'default',
      resamplerFallbackActive: false, echoSrcMode: 'off', echoSrcQualityProfile: 'transparent',
      echoSrcTargetSampleRate: null, echoSrcActive: false, bitPerfectCandidate: false,
      sampleRateMismatch: false, latencyProfile: 'balanced', eqEnabled: false,
      roomCorrectionEnabled: false, channelBalanceEnabled: false, dspActive: false,
      preampDb: 0, eqPresetName: null, clippingRisk: false,
      bitPerfectDisabledReason: 'mock', sharedStabilityTier: null, nativeDeviceBufferFrames: null,
      nativeRequestedBufferFrames: null, nativeActualBufferFrames: null, nativeOutputLatencyMs: null,
      nativePositionStalenessMs: null, nativeFifoCapacityFrames: null, nativeStartupPrebufferFrames: null,
      nativeBufferedFrames: null, nativeBufferedMs: null, nativeUnderrunCallbacks: 0,
      nativeUnderrunFrames: 0, lastSharedStabilityRecoveryAt: null,
      warnings: [], error: null,
      activeDecodeBackendImpl: 'chromium-media',
      dsdOutputModeRequested: 'pcm', activeDsdOutputMode: null, dsdNativeSampleRate: null,
      dsdTransportSampleRate: null,
    }),
    getSystemPlaybackStatus: vi.fn().mockReturnValue({
      state: 'idle', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null,
    }),
    lastNativeAudioStatus: null,
    systemAudioModeActive: false,
    handoffNativePlaybackToSystemAudio: vi.fn().mockResolvedValue(null),
    stopSystemPlayback: vi.fn().mockReturnValue({
      state: 'stopped', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null,
    }),
    refreshSystemAudioModeActive: vi.fn().mockResolvedValue(false),
    play: vi.fn().mockResolvedValue({ state: 'playing', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
    pause: vi.fn().mockResolvedValue({ state: 'paused', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
    stop: vi.fn().mockResolvedValue({ state: 'stopped', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
    seek: vi.fn().mockResolvedValue({ state: 'playing', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
    playLocalFileWithSystemAudio: vi.fn().mockResolvedValue({ state: 'playing', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
    playMediaItemWithSystemAudio: vi.fn().mockResolvedValue({ state: 'playing', currentTrackId: null, positionMs: 0, durationMs: 0, filePath: null }),
    shouldUseSystemAudioForPlayback: vi.fn().mockResolvedValue(false),
    requiresNativeChainedPlayback: vi.fn().mockReturnValue(false),
    requiresNativeSystemLocalPlayback: vi.fn().mockReturnValue(false),
    requiresNativeSystemMediaPlayback: vi.fn().mockReturnValue(false),
    isExplicitNativeOutputRequest: vi.fn().mockReturnValue(false),
    applySystemOutputSettings: vi.fn(),
    applySystemChannelBalanceState: vi.fn(),
    readPersistedSystemAudioMode: vi.fn().mockReturnValue(false),
  };
}

function createMockPlaybackDeps(): PlaybackDeps {
  return {
    localAudioFileOpenHandlers: new Set(),
    pendingLocalAudioFileOpenEvents: [],
    automixAdvanceHandlers: new Set(),
    isMainPlaybackRenderer: true,
    invokeMainPlaybackRenderer: vi.fn().mockResolvedValue({}),
  };
}

// ---------------------------------------------------------------------------
// Test 1: createAppApi shape
// ---------------------------------------------------------------------------
describe('createAppApi', () => {
  it('returns object with getVersion, getSettings, setSettings, minimize, close, quit', () => {
    const ipc = createMockIpcRenderer();
    const api = createAppApi(ipc as any, IpcChannels);

    expect(api).toHaveProperty('getVersion');
    expect(api).toHaveProperty('getSettings');
    expect(api).toHaveProperty('setSettings');
    expect(api).toHaveProperty('minimize');
    expect(api).toHaveProperty('close');
    expect(api).toHaveProperty('quit');
  });
});

// ---------------------------------------------------------------------------
// Test 2: createLibraryApi top-level keys
// ---------------------------------------------------------------------------
describe('createLibraryApi', () => {
  it('returns object with getTrack, getTracks, getAlbums, getArtists, getPlaylists', () => {
    const ipc = createMockIpcRenderer();
    const api = createLibraryApi(ipc as any, IpcChannels, undefined);

    expect(api).toHaveProperty('getTrack');
    expect(api).toHaveProperty('getTracks');
    expect(api).toHaveProperty('getAlbums');
    expect(api).toHaveProperty('getArtists');
    expect(api).toHaveProperty('getPlaylists');
  });
});

// ---------------------------------------------------------------------------
// Test 3: createPlaybackApi shape
// ---------------------------------------------------------------------------
describe('createPlaybackApi', () => {
  it('returns object with play, pause, stop, seek, getStatus, playLocalFile', () => {
    const ipc = createMockIpcRenderer();
    const sa = createMockSa();
    const deps = createMockPlaybackDeps();
    const api = createPlaybackApi(ipc as any, IpcChannels, sa, deps);

    expect(api).toHaveProperty('play');
    expect(api).toHaveProperty('pause');
    expect(api).toHaveProperty('stop');
    expect(api).toHaveProperty('seek');
    expect(api).toHaveProperty('getStatus');
    expect(api).toHaveProperty('playLocalFile');
  });
});

// ---------------------------------------------------------------------------
// Test 4: createAudioApi shape
// ---------------------------------------------------------------------------
describe('createAudioApi', () => {
  it('returns object with getStatus, onStatus, listDevices, setOutput', () => {
    const ipc = createMockIpcRenderer();
    const sa = createMockSa();
    const api = createAudioApi(ipc as any, IpcChannels, sa);

    expect(api).toHaveProperty('getStatus');
    expect(api).toHaveProperty('onStatus');
    expect(api).toHaveProperty('listDevices');
    expect(api).toHaveProperty('setOutput');
  });
});

// ---------------------------------------------------------------------------
// Test 5: createEqApi shape
// ---------------------------------------------------------------------------
describe('createEqApi', () => {
  it('returns object with getState, setEnabled, setBandGain, setPreamp, reset', () => {
    const ipc = createMockIpcRenderer();
    const sa = createMockSa();
    const api = createEqApi(ipc as any, IpcChannels, sa);

    expect(api).toHaveProperty('getState');
    expect(api).toHaveProperty('setEnabled');
    expect(api).toHaveProperty('setBandGain');
    expect(api).toHaveProperty('setPreamp');
    expect(api).toHaveProperty('reset');
  });
});

// ---------------------------------------------------------------------------
// Test 6: All methods in each returned object are functions
// ---------------------------------------------------------------------------
describe('all returned methods are functions', () => {
  it('createAppApi methods are functions', () => {
    const ipc = createMockIpcRenderer();
    const api = createAppApi(ipc as any, IpcChannels);

    expect(typeof api.getVersion).toBe('function');
    expect(typeof api.getSettings).toBe('function');
    expect(typeof api.setSettings).toBe('function');
    expect(typeof api.minimize).toBe('function');
    expect(typeof api.close).toBe('function');
    expect(typeof api.quit).toBe('function');
  });

  it('createLibraryApi methods are functions', () => {
    const ipc = createMockIpcRenderer();
    const api = createLibraryApi(ipc as any, IpcChannels, undefined);

    expect(typeof api.getTrack).toBe('function');
    expect(typeof api.getTracks).toBe('function');
    expect(typeof api.getAlbums).toBe('function');
    expect(typeof api.getArtists).toBe('function');
    expect(typeof api.getPlaylists).toBe('function');
  });

  it('createPlaybackApi methods are functions', () => {
    const ipc = createMockIpcRenderer();
    const sa = createMockSa();
    const deps = createMockPlaybackDeps();
    const api = createPlaybackApi(ipc as any, IpcChannels, sa, deps);

    expect(typeof api.play).toBe('function');
    expect(typeof api.pause).toBe('function');
    expect(typeof api.stop).toBe('function');
    expect(typeof api.seek).toBe('function');
    expect(typeof api.getStatus).toBe('function');
    expect(typeof api.playLocalFile).toBe('function');
  });

  it('createAudioApi methods are functions', () => {
    const ipc = createMockIpcRenderer();
    const sa = createMockSa();
    const api = createAudioApi(ipc as any, IpcChannels, sa);

    expect(typeof api.getStatus).toBe('function');
    expect(typeof api.onStatus).toBe('function');
    expect(typeof api.listDevices).toBe('function');
    expect(typeof api.setOutput).toBe('function');
  });

  it('createEqApi methods are functions', () => {
    const ipc = createMockIpcRenderer();
    const sa = createMockSa();
    const api = createEqApi(ipc as any, IpcChannels, sa);

    expect(typeof api.getState).toBe('function');
    expect(typeof api.setEnabled).toBe('function');
    expect(typeof api.setBandGain).toBe('function');
    expect(typeof api.setPreamp).toBe('function');
    expect(typeof api.reset).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Test 7-11: IPC channel verification — calling methods hits correct channels
// ---------------------------------------------------------------------------
describe('IPC channel verification', () => {
  it('createAppApi calls correct channels', async () => {
    const ipc = createMockIpcRenderer();
    const api = createAppApi(ipc as any, IpcChannels);

    await api.getVersion();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.AppGetVersion);

    await api.getSettings();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.AppGetSettings);

    await api.setSettings({});
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.AppSetSettings, {});

    await api.minimize();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.AppWindowMinimize);

    await api.close();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.AppWindowClose);

    await api.quit();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.AppQuit);
  });

  it('createLibraryApi calls correct channels', async () => {
    const ipc = createMockIpcRenderer();
    const api = createLibraryApi(ipc as any, IpcChannels, undefined);

    await api.getTrack('track-1');
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetTrack, 'track-1');

    await api.getTracks();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetTracks, undefined);

    await api.getAlbums();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetAlbums, undefined);

    await api.getArtists();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetArtists, undefined);

    await api.getPlaylists();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetPlaylists);
  });

  it('createPlaybackApi calls correct channels (non-system-audio path)', async () => {
    const ipc = createMockIpcRenderer();
    const sa = createMockSa();
    const deps = createMockPlaybackDeps();
    const api = createPlaybackApi(ipc as any, IpcChannels, sa, deps);

    await api.play();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.PlaybackPlay);

    await api.pause();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.PlaybackPause);

    await api.stop();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.PlaybackStop);

    await api.seek(30);
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.PlaybackSeek, 30);
  });

  it('createAudioApi calls correct channels', async () => {
    const ipc = createMockIpcRenderer();
    ipc.invoke.mockResolvedValue({ outputMode: 'shared', state: 'idle' });
    const sa = createMockSa();
    const api = createAudioApi(ipc as any, IpcChannels, sa);

    await api.listDevices();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.AudioListDevices);

    await api.setOutput({ outputMode: 'shared' });
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.AudioSetOutput, { outputMode: 'shared' });
  });

  it('createEqApi calls correct channels', async () => {
    const ipc = createMockIpcRenderer();
    const sa = createMockSa();
    const api = createEqApi(ipc as any, IpcChannels, sa);

    await api.getState();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.EqGetState);

    await api.setEnabled(true);
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.EqSetEnabled, true);

    await api.setBandGain({ band: 0, gainDb: 3 });
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.EqSetBandGain, { band: 0, gainDb: 3 });

    await api.setPreamp(-2);
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.EqSetPreamp, -2);

    await api.reset();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannels.EqReset);
  });
});

// ---------------------------------------------------------------------------
// Test 12: createSystemAudioEngine returns expected interface
// ---------------------------------------------------------------------------
describe('createSystemAudioEngine', () => {
  it('returns object with expected interface keys and functions', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
      },
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      location: { search: '' },
      AudioContext: undefined,
    });

    const ipc = createMockIpcRenderer();
    const sa = createSystemAudioEngine(ipc as any, IpcChannels);

    expect(sa).toHaveProperty('onAudioStatus');
    expect(sa).toHaveProperty('onTrackChange');
    expect(sa).toHaveProperty('onLocalAudioFilesOpened');
    expect(sa).toHaveProperty('onAutomixAdvance');
    expect(sa).toHaveProperty('getSystemAudioStatus');
    expect(sa).toHaveProperty('getSystemPlaybackStatus');
    expect(sa).toHaveProperty('lastNativeAudioStatus');
    expect(sa).toHaveProperty('systemAudioModeActive');
    expect(sa).toHaveProperty('handoffNativePlaybackToSystemAudio');
    expect(sa).toHaveProperty('stopSystemPlayback');
    expect(sa).toHaveProperty('refreshSystemAudioModeActive');
    expect(sa).toHaveProperty('play');
    expect(sa).toHaveProperty('pause');
    expect(sa).toHaveProperty('stop');
    expect(sa).toHaveProperty('seek');
    expect(sa).toHaveProperty('playLocalFileWithSystemAudio');
    expect(sa).toHaveProperty('playMediaItemWithSystemAudio');
    expect(sa).toHaveProperty('shouldUseSystemAudioForPlayback');
    expect(sa).toHaveProperty('requiresNativeChainedPlayback');
    expect(sa).toHaveProperty('requiresNativeSystemLocalPlayback');
    expect(sa).toHaveProperty('requiresNativeSystemMediaPlayback');
    expect(sa).toHaveProperty('isExplicitNativeOutputRequest');
    expect(sa).toHaveProperty('applySystemOutputSettings');
    expect(sa).toHaveProperty('applySystemChannelBalanceState');
    expect(sa).toHaveProperty('readPersistedSystemAudioMode');

    vi.unstubAllGlobals();
  });
});
