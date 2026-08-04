import { describe, expect, it, vi } from 'vitest';
import { createMockIpcRenderer } from '../test-utils/electronMocks';
import { IpcChannels } from '../shared/constants/ipcChannels';
import {
  createAppApi,
  createDesktopLyricsApi,
  createMiniPlayerApi,
  createLibraryApi,
  createLibraryLabApi,
  createPlaybackApi,
  createRemoteSourcesApi,
  createConnectApi,
  createStreamingApi,
  createLyricsApi,
  createMvApi,
  createHqPlayerApi,
  createAudioApi,
  createEqApi,
  createSleepTimerApi,
  createDiagnosticsApi,
  createDownloadsApi,
  createPluginsApi,
  createAccountsApi,
  createSpotifyApi,
} from './ipc';

// ---------------------------------------------------------------------------
// Expected namespaces — kept in sync with apiTypes.ts EchoApi type.
// smtc / discordPresence / lastfm are not yet in apiTypes.ts — add them
// here when corresponding preload factories are created.
// ---------------------------------------------------------------------------
const expectedNamespaces = [
  'app',
  'desktopLyrics',
  'miniPlayer',
  'library',
  'libraryLab',
  'playback',
  'remoteSources',
  'connect',
  'streaming',
  'lyrics',
  'mv',
  'hqPlayer',
  'audio',
  'eq',
  'diagnostics',
  'downloads',
  'plugins',
  'accounts',
  'spotify',
  'sleepTimer',
] as const;

// ---------------------------------------------------------------------------
// Build the full echoApi shape the same way src/preload/index.ts does,
// but with test mocks.
// ---------------------------------------------------------------------------
function buildEchoApi() {
  const ipcRenderer = createMockIpcRenderer() as any;
  const sa = {
    systemAudioModeActive: false,
    getSystemAudioStatus: vi.fn(),
    getSystemPlaybackStatus: vi.fn(),
    setSystemOutputMode: vi.fn(),
    stopSystemPlayback: vi.fn(),
    lastNativeAudioStatus: null as any,
    applySystemOutputSettings: vi.fn(),
    requiresNativeChainedPlayback: vi.fn().mockReturnValue(false),
    requiresNativeSystemLocalPlayback: vi.fn().mockReturnValue(false),
    requiresNativeSystemMediaPlayback: vi.fn().mockReturnValue(false),
    shouldUseSystemAudioForPlayback: vi.fn().mockResolvedValue(false),
    playLocalFileWithSystemAudio: vi.fn(),
    applyEqState: vi.fn(),
    applyChannelBalanceState: vi.fn(),
    applyRoomCorrectionState: vi.fn(),
  };
  const webUtils = { getPathForFile: vi.fn() };
  const deps = {
    localAudioFileOpenHandlers: new Set<(paths: string[]) => void>(),
    pendingLocalAudioFileOpenEvents: [] as string[][],
    automixAdvanceHandlers: new Set<(event: any) => void>(),
    isMainPlaybackRenderer: true,
    invokeMainPlaybackRenderer: vi.fn(),
  };

  return {
    app: createAppApi(ipcRenderer, IpcChannels),
    desktopLyrics: createDesktopLyricsApi(ipcRenderer, IpcChannels),
    miniPlayer: createMiniPlayerApi(ipcRenderer, IpcChannels),
    library: createLibraryApi(ipcRenderer, IpcChannels, webUtils as any),
    libraryLab: createLibraryLabApi(ipcRenderer, IpcChannels),
    playback: createPlaybackApi(ipcRenderer, IpcChannels, sa as any, deps),
    remoteSources: createRemoteSourcesApi(ipcRenderer, IpcChannels),
    connect: createConnectApi(ipcRenderer, IpcChannels),
    streaming: createStreamingApi(ipcRenderer, IpcChannels),
    lyrics: createLyricsApi(ipcRenderer, IpcChannels),
    mv: createMvApi(ipcRenderer, IpcChannels),
    hqPlayer: createHqPlayerApi(ipcRenderer, IpcChannels),
    audio: createAudioApi(ipcRenderer, IpcChannels, sa as any),
    eq: createEqApi(ipcRenderer, IpcChannels, sa as any),
    diagnostics: createDiagnosticsApi(ipcRenderer, IpcChannels),
    downloads: createDownloadsApi(ipcRenderer, IpcChannels),
    plugins: createPluginsApi(ipcRenderer, IpcChannels, webUtils as any),
    accounts: createAccountsApi(ipcRenderer, IpcChannels),
    spotify: createSpotifyApi(ipcRenderer, IpcChannels),
    sleepTimer: createSleepTimerApi(ipcRenderer, IpcChannels),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('echoApi shape', () => {
  const echoApi = buildEchoApi();

  it('has exactly the expected namespaces', () => {
    const actualKeys = Object.keys(echoApi).sort();
    const expectedKeys = [...expectedNamespaces].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });

  it('each namespace is an object with methods (not null/undefined)', () => {
    for (const key of expectedNamespaces) {
      const ns = (echoApi as Record<string, unknown>)[key];
      expect(ns, `namespace "${key}" should be defined`).toBeDefined();
      expect(ns, `namespace "${key}" should not be null`).not.toBeNull();
      expect(typeof ns, `namespace "${key}" should be an object`).toBe('object');

      const methods = Object.values(ns as object).filter((v) => typeof v === 'function');
      expect(methods.length, `namespace "${key}" should have at least one method`).toBeGreaterThan(0);
    }
  });

  it('audio has core methods: getStatus / onStatus / listDevices / setOutput', () => {
    const audioMethods = ['getStatus', 'onStatus', 'listDevices', 'setOutput'];
    for (const method of audioMethods) {
      expect(
        typeof (echoApi.audio as Record<string, unknown>)[method],
        `audio.${method} should be a function`,
      ).toBe('function');
    }
  });

  it('audio has extended methods: getDiagnostics / onSessionReset / exportFile / resetEngine / forceRestart', () => {
    const extended = ['getDiagnostics', 'onSessionReset', 'exportFile', 'resetEngine', 'forceRestart'];
    for (const method of extended) {
      expect(
        typeof (echoApi.audio as Record<string, unknown>)[method],
        `audio.${method} should be a function`,
      ).toBe('function');
    }
  });

  it('playback has core methods: play / pause / stop / seek / getStatus', () => {
    const playbackMethods = ['play', 'pause', 'stop', 'seek', 'getStatus'];
    for (const method of playbackMethods) {
      expect(
        typeof (echoApi.playback as Record<string, unknown>)[method],
        `playback.${method} should be a function`,
      ).toBe('function');
    }
  });

  it('playback has extended methods: playLocalFile / prepareLocalFile / playMediaItem / prepareMediaItem / openLocalAudioFile', () => {
    const extended = ['playLocalFile', 'prepareLocalFile', 'playMediaItem', 'prepareMediaItem', 'openLocalAudioFile'];
    for (const method of extended) {
      expect(
        typeof (echoApi.playback as Record<string, unknown>)[method],
        `playback.${method} should be a function`,
      ).toBe('function');
    }
  });

  it('library has core methods: getTrack / getAlbums / getArtists / getAlbum / getPlaylists', () => {
    const libraryMethods = ['getTrack', 'getAlbums', 'getArtists', 'getAlbum', 'getPlaylists'];
    for (const method of libraryMethods) {
      expect(
        typeof (echoApi.library as Record<string, unknown>)[method],
        `library.${method} should be a function`,
      ).toBe('function');
    }
  });

  it('library has extended methods: chooseFolder / addFolder / getFolders / getTracks / getSummary', () => {
    const extended = ['chooseFolder', 'addFolder', 'getFolders', 'getTracks', 'getSummary'];
    for (const method of extended) {
      expect(
        typeof (echoApi.library as Record<string, unknown>)[method],
        `library.${method} should be a function`,
      ).toBe('function');
    }
  });

  it('all namespace methods are functions (typeof === "function")', () => {
    for (const key of expectedNamespaces) {
      const ns = (echoApi as Record<string, Record<string, unknown>>)[key];
      for (const [methodName, method] of Object.entries(ns)) {
        expect(
          typeof method,
          `${key}.${methodName} should be a function, got ${typeof method}`,
        ).toBe('function');
      }
    }
  });
});
