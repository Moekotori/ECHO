import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const handleMock = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers[channel] = handler;
});
const serviceMock = {
  scheduleAutoStart: vi.fn(),
  list: vi.fn(() => ({ directory: 'D:\\Echo\\plugins', plugins: [] })),
  createExample: vi.fn((kind: string) => ({ pluginId: `echo.${kind}`, directory: 'D:\\Echo\\plugins\\example' })),
  enable: vi.fn((request) => ({ id: request.pluginId, enabled: true })),
  disable: vi.fn((pluginId: string) => ({ id: pluginId, enabled: false })),
  reload: vi.fn(async (pluginId: string) => ({ id: pluginId, status: 'running' })),
  openDirectory: vi.fn(async () => undefined),
  exportPluginPackage: vi.fn(async () => 'D:\\Echo\\plugins\\echo.playback-panel.echo-plugin.json'),
  importPluginPackage: vi.fn(async () => ({ pluginId: 'echo.playback-panel', directory: 'D:\\Echo\\plugins\\echo.playback-panel', importedFileCount: 2 })),
  runCommand: vi.fn(async () => ({ ok: true })),
  queryMetadata: vi.fn(async () => ({ providers: [], candidates: [] })),
  querySources: vi.fn(async () => ({ providers: [], tracks: [] })),
  resolveSourcePlayback: vi.fn(async () => ({ url: 'https://example.com/audio.mp3' })),
  queryLyrics: vi.fn(async () => ({ providers: [], candidates: [] })),
  queryCovers: vi.fn(async () => ({ providers: [], candidates: [] })),
  getPluginSettings: vi.fn(() => ({ pluginId: 'echo.playback-panel', values: {} })),
  updatePluginSettings: vi.fn((_pluginId: string, patch: unknown) => ({ pluginId: 'echo.playback-panel', values: patch })),
  getLogs: vi.fn(() => []),
};

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../plugins/PluginService', () => ({
  getPluginService: () => serviceMock,
}));

const resetHandlers = (): void => {
  for (const key of Object.keys(handlers)) {
    delete handlers[key];
  }
};

describe('plugin IPC', () => {
  beforeEach(async () => {
    resetHandlers();
    handleMock.mockClear();
    Object.values(serviceMock).forEach((mock) => mock.mockClear());
    vi.resetModules();
    const module = await import('./pluginIpc');
    module.registerPluginIpc();
  });

  it('registers plugin handlers and schedules idle startup', () => {
    expect(serviceMock.scheduleAutoStart).toHaveBeenCalledTimes(1);
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsList, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsRunCommand, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsQueryMetadata, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsQuerySources, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsResolveSourcePlayback, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsQueryLyrics, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsQueryCovers, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsGetSettings, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsSetSettings, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsImportPackage, expect.any(Function));
  });

  it('routes valid plugin IPC requests to the service', async () => {
    expect(handlers[IpcChannels.PluginsList]!(null)).toEqual({ directory: 'D:\\Echo\\plugins', plugins: [] });
    expect(handlers[IpcChannels.PluginsCreateExample]!(null, 'playback-panel')).toMatchObject({ pluginId: 'echo.playback-panel' });
    expect(handlers[IpcChannels.PluginsCreateExample]!(null, 'theme-preset')).toMatchObject({ pluginId: 'echo.theme-preset' });
    expect(handlers[IpcChannels.PluginsEnable]!(null, { pluginId: 'echo.playback-panel' })).toMatchObject({ enabled: true });
    expect(handlers[IpcChannels.PluginsDisable]!(null, 'echo.playback-panel')).toMatchObject({ enabled: false });
    await expect(handlers[IpcChannels.PluginsReload]!(null, 'echo.playback-panel')).resolves.toMatchObject({ status: 'running' });
    await expect(handlers[IpcChannels.PluginsExportPackage]!(null, 'echo.playback-panel')).resolves.toContain('echo.playback-panel');
    await expect(handlers[IpcChannels.PluginsImportPackage]!(null)).resolves.toMatchObject({ pluginId: 'echo.playback-panel' });
    await expect(handlers[IpcChannels.PluginsRunCommand]!(null, { pluginId: 'echo.playback-panel', commandId: 'show-status' })).resolves.toEqual({ ok: true });
    await expect(handlers[IpcChannels.PluginsQueryMetadata]!(null, { track: { title: 'Song' } })).resolves.toEqual({ providers: [], candidates: [] });
    await expect(handlers[IpcChannels.PluginsQuerySources]!(null, { query: 'Song' })).resolves.toEqual({ providers: [], tracks: [] });
    await expect(handlers[IpcChannels.PluginsResolveSourcePlayback]!(null, {
      pluginId: 'echo.source-provider',
      providerId: 'direct-url',
      providerTrackId: 'demo-stream',
    })).resolves.toEqual({ url: 'https://example.com/audio.mp3' });
    await expect(handlers[IpcChannels.PluginsQueryLyrics]!(null, { track: { title: 'Song' } })).resolves.toEqual({ providers: [], candidates: [] });
    await expect(handlers[IpcChannels.PluginsQueryCovers]!(null, { track: { title: 'Song' } })).resolves.toEqual({ providers: [], candidates: [] });
    expect(handlers[IpcChannels.PluginsGetSettings]!(null, 'echo.playback-panel')).toEqual({ pluginId: 'echo.playback-panel', values: {} });
    expect(handlers[IpcChannels.PluginsSetSettings]!(null, 'echo.playback-panel', { mode: 'fast' })).toEqual({ pluginId: 'echo.playback-panel', values: { mode: 'fast' } });
    expect(handlers[IpcChannels.PluginsGetLogs]!(null, 'echo.playback-panel')).toEqual([]);

    expect(serviceMock.createExample).toHaveBeenCalledWith('playback-panel');
    expect(serviceMock.createExample).toHaveBeenCalledWith('theme-preset');
    expect(serviceMock.enable).toHaveBeenCalledWith({ pluginId: 'echo.playback-panel' });
    expect(serviceMock.exportPluginPackage).toHaveBeenCalledWith('echo.playback-panel');
    expect(serviceMock.importPluginPackage).toHaveBeenCalledTimes(1);
    expect(serviceMock.runCommand).toHaveBeenCalledWith({ pluginId: 'echo.playback-panel', commandId: 'show-status' });
    expect(serviceMock.queryMetadata).toHaveBeenCalledWith({ track: { title: 'Song' } });
    expect(serviceMock.querySources).toHaveBeenCalledWith({ query: 'Song' });
    expect(serviceMock.resolveSourcePlayback).toHaveBeenCalledWith({
      pluginId: 'echo.source-provider',
      providerId: 'direct-url',
      providerTrackId: 'demo-stream',
    });
    expect(serviceMock.queryLyrics).toHaveBeenCalledWith({ track: { title: 'Song' } });
    expect(serviceMock.queryCovers).toHaveBeenCalledWith({ track: { title: 'Song' } });
    expect(serviceMock.getPluginSettings).toHaveBeenCalledWith('echo.playback-panel');
    expect(serviceMock.updatePluginSettings).toHaveBeenCalledWith('echo.playback-panel', { mode: 'fast' });
  });

  it('rejects malformed plugin IPC payloads before reaching the service', () => {
    expect(() => handlers[IpcChannels.PluginsCreateExample]!(null, 'remote-market')).toThrow('unknown_plugin_example_kind');
    expect(() => handlers[IpcChannels.PluginsEnable]!(null, null)).toThrow('plugin enable request must be an object');
    expect(() => handlers[IpcChannels.PluginsDisable]!(null, '')).toThrow('pluginId must be a non-empty string');
    expect(() => handlers[IpcChannels.PluginsExportPackage]!(null, '')).toThrow('pluginId must be a non-empty string');
    expect(() => handlers[IpcChannels.PluginsRunCommand]!(null, null)).toThrow('plugin command request must be an object');
    expect(() => handlers[IpcChannels.PluginsQueryMetadata]!(null, null)).toThrow('plugin metadata request must be an object');
    expect(() => handlers[IpcChannels.PluginsQuerySources]!(null, null)).toThrow('plugin source search request must be an object');
    expect(() => handlers[IpcChannels.PluginsResolveSourcePlayback]!(null, null)).toThrow('plugin source playback request must be an object');
    expect(() => handlers[IpcChannels.PluginsQueryLyrics]!(null, null)).toThrow('plugin lyrics request must be an object');
    expect(() => handlers[IpcChannels.PluginsQueryCovers]!(null, null)).toThrow('plugin cover request must be an object');
    expect(() => handlers[IpcChannels.PluginsGetSettings]!(null, '')).toThrow('pluginId must be a non-empty string');
    expect(() => handlers[IpcChannels.PluginsSetSettings]!(null, 'echo.playback-panel', null)).toThrow('plugin settings patch must be an object');
  });
});
