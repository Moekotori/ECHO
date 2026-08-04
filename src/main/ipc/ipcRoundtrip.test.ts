import { describe, expect, it, vi } from 'vitest';
import { createMockIpcRenderer } from '../../test-utils/electronMocks';
import { createAudioApi } from '../../preload/ipc/ipcAudio';
import { createPlaybackApi } from '../../preload/ipc/playbackApi';
import { createLibraryApi } from '../../preload/ipc/libraryApi';
import { createEqApi } from '../../preload/ipc/ipcEq';
import { createAppApi } from '../../preload/ipc/appApi';
import type { SystemAudioEngine } from '../../preload/systemAudioEngine';
import type { PlaybackDeps } from '../../preload/ipc/playbackApi';
import type { AudioStatus, AudioDeviceInfo } from '../../shared/types/audio';
import type { PlaybackStatus } from '../../shared/types/playback';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IpcChannels = {
  AudioGetStatus: 'audio:get-status',
  AudioListDevices: 'audio:list-devices',
  AudioSetOutput: 'audio:set-output',
  PlaybackPlay: 'playback:play',
  PlaybackPause: 'playback:pause',
  PlaybackSeek: 'playback:seek',
  EqGetState: 'eq:get-state',
  AppGetVersion: 'app:get-version',
  LibraryGetTrack: 'library:get-track',
  LibraryGetAlbums: 'library:get-albums',
};

const playbackStatus = (state: PlaybackStatus['state']): PlaybackStatus => ({
  state,
  currentTrackId: null,
  positionMs: 0,
  durationMs: 0,
  filePath: null,
});

function createMockSystemAudioEngine(): SystemAudioEngine {
  return {
    systemAudioModeActive: false,
    lastNativeAudioStatus: null,
    refreshSystemAudioModeActive: vi.fn().mockResolvedValue(false),
    isExplicitNativeOutputRequest: vi.fn().mockReturnValue(true),
    applySystemOutputSettings: vi.fn(),
    applySystemChannelBalanceState: vi.fn(),
    getSystemAudioStatus: vi.fn(() => ({} as AudioStatus)),
    getSystemPlaybackStatus: vi.fn(() => playbackStatus('idle')),
    handoffNativePlaybackToSystemAudio: vi.fn().mockResolvedValue(null),
    stopSystemPlayback: vi.fn(() => playbackStatus('stopped')),
    play: vi.fn().mockResolvedValue(playbackStatus('playing')),
    pause: vi.fn().mockResolvedValue(playbackStatus('paused')),
    stop: vi.fn().mockResolvedValue(playbackStatus('stopped')),
    seek: vi.fn().mockResolvedValue(playbackStatus('playing')),
    playLocalFileWithSystemAudio: vi.fn().mockResolvedValue(playbackStatus('playing')),
    playMediaItemWithSystemAudio: vi.fn().mockResolvedValue(playbackStatus('playing')),
    shouldUseSystemAudioForPlayback: vi.fn().mockResolvedValue(false),
    requiresNativeChainedPlayback: vi.fn().mockReturnValue(false),
    requiresNativeSystemLocalPlayback: vi.fn().mockReturnValue(false),
    requiresNativeSystemMediaPlayback: vi.fn().mockReturnValue(false),
    onAudioStatus: vi.fn(() => vi.fn()),
    onTrackChange: vi.fn(() => vi.fn()),
    onLocalAudioFilesOpened: vi.fn(() => vi.fn()),
    onAutomixAdvance: vi.fn(() => vi.fn()),
    readPersistedSystemAudioMode: vi.fn().mockReturnValue(false),
  };
}

function createMockPlaybackDeps(): PlaybackDeps {
  return {
    localAudioFileOpenHandlers: new Set(),
    pendingLocalAudioFileOpenEvents: [],
    automixAdvanceHandlers: new Set(),
    isMainPlaybackRenderer: false,
    invokeMainPlaybackRenderer: vi.fn() as PlaybackDeps['invokeMainPlaybackRenderer'],
  };
}

// ---------------------------------------------------------------------------
// Round-trip Tests
// ---------------------------------------------------------------------------

describe('IPC round-trip: preload factory → mock invoke → response', () => {
  // ---- 1. audio:get-status ----
  it('audio:get-status → createAudioApi.getStatus() calls invoke with audio:get-status', async () => {
    const ipcRenderer = createMockIpcRenderer();
    const sa = createMockSystemAudioEngine();
    const mockStatus: AudioStatus = {
      host: 'ready',
      state: 'idle' as AudioStatus['state'],
      outputDeviceId: 'dev-1',
      outputDeviceName: 'Speakers',
      outputDeviceType: 'wasapi',
      outputBackend: 'wasapi-shared',
      activeOutputBackendImpl: 'wasapi-shared',
      outputMode: 'shared',
      sharedBackend: 'windows',
      activeDecodeBackendImpl: 'juce',
      volume: 1,
      playbackRate: 1,
      playbackSpeedMode: 'speed',
      currentFilePath: null,
      currentTrackId: null,
      durationSeconds: 0,
      positionSeconds: 0,
      channels: 2,
      codec: null,
      bitDepth: null,
      bitrate: null,
      fileSampleRate: null,
      decoderOutputSampleRate: null,
      requestedOutputSampleRate: null,
      actualDeviceSampleRate: null,
      sharedDeviceSampleRate: null,
      resampling: false,
      bitPerfectCandidate: false,
      sampleRateMismatch: false,
      eqEnabled: false,
      channelBalanceEnabled: false,
      dspActive: false,
      preampDb: 0,
      eqPresetName: null,
      clippingRisk: false,
      bitPerfectDisabledReason: null,
      warnings: [],
      error: null,
    };
    ipcRenderer.invoke = vi.fn().mockResolvedValue(mockStatus);

    const api = createAudioApi(ipcRenderer as unknown as Electron.IpcRenderer, IpcChannels, sa);
    const result = await api.getStatus();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AudioGetStatus);
    expect(result).toEqual(mockStatus);
  });

  // ---- 2. audio:list-devices ----
  it('audio:list-devices → createAudioApi.listDevices() calls invoke with audio:list-devices', async () => {
    const ipcRenderer = createMockIpcRenderer();
    const sa = createMockSystemAudioEngine();
    const mockDevices: AudioDeviceInfo[] = [
      {
        id: 'd1',
        index: 0,
        name: 'Speakers',
        outputMode: 'shared',
        sampleRate: 48000,
        sharedDeviceSampleRate: 48000,
        isDefault: true,
      },
    ];
    ipcRenderer.invoke = vi.fn().mockResolvedValue(mockDevices);

    const api = createAudioApi(ipcRenderer as unknown as Electron.IpcRenderer, IpcChannels, sa);
    const result = await api.listDevices();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AudioListDevices);
    expect(result).toEqual(mockDevices);
  });

  // ---- 3. audio:set-output ----
  it('audio:set-output → createAudioApi.setOutput({...}) calls invoke with audio:set-output', async () => {
    const ipcRenderer = createMockIpcRenderer();
    const sa = createMockSystemAudioEngine();
    const mockStatus: AudioStatus = {
      host: 'ready',
      state: 'playing',
      outputDeviceId: 'dev-2',
      outputDeviceName: 'DAC',
      outputDeviceType: 'wasapi',
      outputBackend: 'wasapi-exclusive',
      activeOutputBackendImpl: 'wasapi-exclusive',
      outputMode: 'exclusive',
      sharedBackend: null,
      activeDecodeBackendImpl: 'juce',
      volume: 1,
      playbackRate: 1,
      playbackSpeedMode: 'speed',
      currentFilePath: null,
      currentTrackId: null,
      durationSeconds: 0,
      positionSeconds: 0,
      channels: 2,
      codec: null,
      bitDepth: null,
      bitrate: null,
      fileSampleRate: null,
      decoderOutputSampleRate: null,
      requestedOutputSampleRate: null,
      actualDeviceSampleRate: null,
      sharedDeviceSampleRate: null,
      resampling: false,
      bitPerfectCandidate: false,
      sampleRateMismatch: false,
      eqEnabled: false,
      channelBalanceEnabled: false,
      dspActive: false,
      preampDb: 0,
      eqPresetName: null,
      clippingRisk: false,
      bitPerfectDisabledReason: null,
      warnings: [],
      error: null,
    };
    ipcRenderer.invoke = vi.fn().mockResolvedValue(mockStatus);
    const settings = { outputMode: 'exclusive' as const, deviceName: 'DAC' };

    const api = createAudioApi(ipcRenderer as unknown as Electron.IpcRenderer, IpcChannels, sa);
    const result = await api.setOutput(settings);

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AudioSetOutput, settings);
    expect(result).toEqual(mockStatus);
  });

  // ---- 4. playback:play ----
  it('playback:play → createPlaybackApi.play() calls invoke with playback:play', async () => {
    const ipcRenderer = createMockIpcRenderer();
    const sa = createMockSystemAudioEngine();
    const deps = createMockPlaybackDeps();
    const mockStatus = { state: 'playing' };
    ipcRenderer.invoke = vi.fn().mockResolvedValue(mockStatus);

    const api = createPlaybackApi(
      ipcRenderer as unknown as Electron.IpcRenderer,
      IpcChannels as unknown as typeof import('../../shared/constants/ipcChannels').IpcChannels,
      sa,
      deps,
    );
    const result = await api.play();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PlaybackPlay);
    expect(result).toEqual(mockStatus);
  });

  // ---- 5. playback:pause ----
  it('playback:pause → createPlaybackApi.pause() calls invoke with playback:pause', async () => {
    const ipcRenderer = createMockIpcRenderer();
    const sa = createMockSystemAudioEngine();
    const deps = createMockPlaybackDeps();
    const mockStatus = { state: 'paused' };
    ipcRenderer.invoke = vi.fn().mockResolvedValue(mockStatus);

    const api = createPlaybackApi(
      ipcRenderer as unknown as Electron.IpcRenderer,
      IpcChannels as unknown as typeof import('../../shared/constants/ipcChannels').IpcChannels,
      sa,
      deps,
    );
    const result = await api.pause();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PlaybackPause);
    expect(result).toEqual(mockStatus);
  });

  // ---- 6. playback:seek ----
  it('playback:seek → createPlaybackApi.seek(30) calls invoke with playback:seek', async () => {
    const ipcRenderer = createMockIpcRenderer();
    const sa = createMockSystemAudioEngine();
    const deps = createMockPlaybackDeps();
    const mockStatus = { state: 'playing' };
    ipcRenderer.invoke = vi.fn().mockResolvedValue(mockStatus);

    const api = createPlaybackApi(
      ipcRenderer as unknown as Electron.IpcRenderer,
      IpcChannels as unknown as typeof import('../../shared/constants/ipcChannels').IpcChannels,
      sa,
      deps,
    );
    const result = await api.seek(30);

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.PlaybackSeek, 30);
    expect(result).toEqual(mockStatus);
  });

  // ---- 7. library:get-track ----
  it('library:get-track → createLibraryApi().library.getTrack(id) calls invoke with library:get-track', async () => {
    const ipcRenderer = createMockIpcRenderer();
    const mockTrack = { id: 'track-1', title: 'Test Song' };
    ipcRenderer.invoke = vi.fn().mockResolvedValue(mockTrack);

    const api = createLibraryApi(
      ipcRenderer as unknown as Electron.IpcRenderer,
      IpcChannels as unknown as typeof import('../../shared/constants/ipcChannels').IpcChannels,
      undefined,
    );
    const result = await api.getTrack('track-1');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetTrack, 'track-1');
    expect(result).toEqual(mockTrack);
  });

  // ---- 8. library:get-albums ----
  it('library:get-albums → createLibraryApi().library.getAlbums() calls invoke with library:get-albums', async () => {
    const ipcRenderer = createMockIpcRenderer();
    const mockAlbums = [{ id: 'a1', title: 'Album One' }];
    ipcRenderer.invoke = vi.fn().mockResolvedValue(mockAlbums);

    const api = createLibraryApi(
      ipcRenderer as unknown as Electron.IpcRenderer,
      IpcChannels as unknown as typeof import('../../shared/constants/ipcChannels').IpcChannels,
      undefined,
    );
    const result = await api.getAlbums(undefined as unknown as Parameters<typeof api.getAlbums>[0]);

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.LibraryGetAlbums, undefined);
    expect(result).toEqual(mockAlbums);
  });

  // ---- 9. eq:get-state ----
  it('eq:get-state → createEqApi.getState() calls invoke with eq:get-state', async () => {
    const ipcRenderer = createMockIpcRenderer();
    const sa = createMockSystemAudioEngine();
    const mockState = { enabled: true, bands: [], preampDb: 0 };
    ipcRenderer.invoke = vi.fn().mockResolvedValue(mockState);

    const api = createEqApi(ipcRenderer as unknown as Electron.IpcRenderer, IpcChannels, sa);
    const result = await api.getState();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.EqGetState);
    expect(result).toEqual(mockState);
  });

  // ---- 10. app:get-version ----
  it('app:get-version → createAppApi.getVersion() calls invoke with app:get-version', async () => {
    const ipcRenderer = createMockIpcRenderer();
    const mockVersion = '3.0.0';
    ipcRenderer.invoke = vi.fn().mockResolvedValue(mockVersion);

    const api = createAppApi(
      ipcRenderer as unknown as Electron.IpcRenderer,
      IpcChannels as unknown as typeof import('../../shared/constants/ipcChannels').IpcChannels,
    );
    const result = await api.getVersion();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.AppGetVersion);
    expect(result).toEqual(mockVersion);
  });
});
