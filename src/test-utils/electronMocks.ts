import { vi } from 'vitest';

/**
 * Creates a mock ipcMain with a captured handler registry.
 * Tests can register real IPC handlers and then inspect them.
 */
export function createMockIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, _handler: (...args: unknown[]) => void) => {
      // fire-and-forget, tracked for test assertions
    }),
    handlers,
  };
}

/**
 * Creates a mock ipcRenderer for testing preload bridge modules.
 */
export function createMockIpcRenderer() {
  return {
    invoke: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

/**
 * Creates a mock contextBridge that captures the exposed API.
 */
export function createMockContextBridge() {
  let exposedApi: unknown = null;
  return {
    exposeInMainWorld: vi.fn((_name: string, api: unknown) => {
      exposedApi = api;
    }),
    getExposedApi: () => exposedApi,
  };
}

/**
 * Creates mock IpcChannels — a Record<string, string> to satisfy typeof checking.
 */
export function createMockIpcChannels(): Record<string, string> {
  return {
    AudioGetStatus: 'audio:get-status',
    AudioListDevices: 'audio:list-devices',
    AudioSetOutput: 'audio:set-output',
    PlaybackPlay: 'playback:play',
    PlaybackPause: 'playback:pause',
    PlaybackStop: 'playback:stop',
    PlaybackSeek: 'playback:seek',
    EqGetState: 'eq:get-state',
    EqSetEnabled: 'eq:set-enabled',
    AppGetVersion: 'app:get-version',
    AppGetSettings: 'app:get-settings',
    LibraryGetTrack: 'library:get-track',
    LibraryGetAlbums: 'library:get-albums',
    DiagnosticsReportRendererError: 'diagnostics:report-renderer-error',
    DesktopLyricsRendererAudioStatus: 'desktop-lyrics:renderer-audio-status',
    PlaybackMainWindowCommand: 'playback:main-window-command',
    AudioCreateSystemStreamUrl: 'audio:create-system-stream-url',
    AudioReportSystemPlaybackError: 'audio:report-system-playback-error',
    PlaybackResolveMediaItem: 'playback:resolve-media-item',
    PlaybackLocalAudioFilesOpened: 'playback:local-audio-files-opened',
    PlaybackAutomixAdvance: 'playback:automix-advance',
    AppWindowMaximizedChanged: 'app:window-maximized-changed',
  };
}
