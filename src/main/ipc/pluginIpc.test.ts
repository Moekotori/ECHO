import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const handleMock = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers[channel] = handler;
});
const getPrivatePluginOperationsMock = vi.fn();
const requirePrivateFeatureMock = vi.fn(async () => undefined);
const serviceMock = {
  scheduleAutoStart: vi.fn(),
  list: vi.fn(() => ({ directory: 'D:\\Echo\\plugins', plugins: [] })),
  listMarket: vi.fn(async () => ({ generatedAt: '2026-06-22T00:00:00.000Z', plugins: [] })),
  installMarket: vi.fn(async (pluginId: string) => ({
    pluginId,
    directory: `D:\\Echo\\plugins\\${pluginId}`,
    importedFileCount: 2,
    checksum: 'a'.repeat(64),
    marketPlugin: {
      id: pluginId,
      name: 'Market Plugin',
      version: '1.0.0',
      apiVersion: 2,
      description: null,
      permissions: [],
      checksum: 'a'.repeat(64),
      sizeBytes: 120,
      updatedAt: '2026-06-22T00:00:00.000Z',
    },
  })),
  createExample: vi.fn((kind: string) => ({ pluginId: `echo.${kind}`, directory: 'D:\\Echo\\plugins\\example' })),
  enable: vi.fn((request) => ({ id: request.pluginId, enabled: true })),
  disable: vi.fn((pluginId: string) => ({ id: pluginId, enabled: false })),
  deletePlugin: vi.fn(async (pluginId: string) => ({ pluginId, directory: 'D:\\Echo\\plugins\\echo.playback-panel' })),
  reload: vi.fn(async (pluginId: string) => ({ id: pluginId, status: 'running' })),
  openDirectory: vi.fn(async () => undefined),
  exportPackage: vi.fn(async () => ({ type: 'echo-next-plugin-package', version: 1, exportedAt: '2026-06-21T00:00:00.000Z', manifest: { id: 'echo.playback-panel', name: 'Playback Panel', version: '1.0.0', apiVersion: 2 }, files: [] })),
  importPackage: vi.fn(async () => ({ pluginId: 'echo.playback-panel', directory: 'D:\\Echo\\plugins\\echo.playback-panel', importedFileCount: 2, checksum: 'abc' })),
  runCommand: vi.fn(async () => ({ ok: true })),
  queryMetadata: vi.fn(async () => ({ providers: [], candidates: [] })),
  querySources: vi.fn(async () => ({ providers: [], tracks: [] })),
  resolveSourcePlayback: vi.fn(async () => ({ url: 'https://example.com/audio.mp3' })),
  queryLyrics: vi.fn(async () => ({ providers: [], candidates: [] })),
  queryCovers: vi.fn(async () => ({ providers: [], candidates: [] })),
  getSettings: vi.fn(() => ({ pluginId: 'echo.playback-panel', values: {} })),
  setSettings: vi.fn((_pluginId: string, patch: unknown) => ({ pluginId: 'echo.playback-panel', values: patch })),
  getLogs: vi.fn(() => []),
};

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../plugins/privateEntitlements', () => ({
  createPrivateFeatureError: (feature = 'echo-pro') => Object.assign(new Error('echo_pro_private_overlay_unavailable'), {
    code: 'echo_pro_private_overlay_unavailable',
    feature,
  }),
  getPrivatePluginOperations: getPrivatePluginOperationsMock,
  requirePrivateFeature: requirePrivateFeatureMock,
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
    getPrivatePluginOperationsMock.mockReset();
    getPrivatePluginOperationsMock.mockReturnValue(serviceMock);
    requirePrivateFeatureMock.mockReset();
    requirePrivateFeatureMock.mockResolvedValue(undefined);
    vi.resetModules();
    const module = await import('./pluginIpc');
    module.registerPluginIpc();
    await Promise.resolve();
  });

  it('registers plugin handlers and schedules idle startup', () => {
    expect(serviceMock.scheduleAutoStart).toHaveBeenCalledTimes(1);
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsList, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsRunCommand, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsDelete, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsQueryMetadata, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsQuerySources, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsResolveSourcePlayback, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsQueryLyrics, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsQueryCovers, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsGetSettings, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsSetSettings, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsImportPackage, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsListMarket, expect.any(Function));
    expect(handleMock).toHaveBeenCalledWith(IpcChannels.PluginsInstallMarket, expect.any(Function));
  });

  it('routes valid plugin IPC requests to the service', async () => {
    expect(handlers[IpcChannels.PluginsList]!(null)).toEqual({ directory: 'D:\\Echo\\plugins', plugins: [] });
    await expect(handlers[IpcChannels.PluginsListMarket]!(null)).resolves.toEqual({ generatedAt: '2026-06-22T00:00:00.000Z', plugins: [] });
    await expect(handlers[IpcChannels.PluginsInstallMarket]!(null, 'echo.market-tool')).resolves.toMatchObject({ pluginId: 'echo.market-tool' });
    await expect(handlers[IpcChannels.PluginsCreateExample]!(null, 'playback-panel')).resolves.toMatchObject({ pluginId: 'echo.playback-panel' });
    await expect(handlers[IpcChannels.PluginsCreateExample]!(null, 'theme-preset')).resolves.toMatchObject({ pluginId: 'echo.theme-preset' });
    await expect(handlers[IpcChannels.PluginsEnable]!(null, { pluginId: 'echo.playback-panel' })).resolves.toMatchObject({ enabled: true });
    expect(handlers[IpcChannels.PluginsDisable]!(null, 'echo.playback-panel')).toMatchObject({ enabled: false });
    await expect(handlers[IpcChannels.PluginsDelete]!(null, 'echo.playback-panel')).resolves.toMatchObject({ pluginId: 'echo.playback-panel' });
    await expect(handlers[IpcChannels.PluginsReload]!(null, 'echo.playback-panel')).resolves.toMatchObject({ status: 'running' });
    await expect(handlers[IpcChannels.PluginsExportPackage]!(null, 'echo.playback-panel')).resolves.toMatchObject({ manifest: { id: 'echo.playback-panel' } });
    await expect(handlers[IpcChannels.PluginsImportPackage]!(null)).resolves.toMatchObject({ pluginId: 'echo.playback-panel' });
    await expect(handlers[IpcChannels.PluginsImportPackage]!(null, 'D:\\Echo\\plugin.echo')).resolves.toMatchObject({ pluginId: 'echo.playback-panel' });
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
    await expect(handlers[IpcChannels.PluginsGetSettings]!(null, 'echo.playback-panel')).resolves.toEqual({ pluginId: 'echo.playback-panel', values: {} });
    await expect(handlers[IpcChannels.PluginsSetSettings]!(null, 'echo.playback-panel', { mode: 'fast' })).resolves.toEqual({ pluginId: 'echo.playback-panel', values: { mode: 'fast' } });
    expect(handlers[IpcChannels.PluginsGetLogs]!(null, 'echo.playback-panel')).toEqual([]);

    expect(serviceMock.createExample).toHaveBeenCalledWith('playback-panel');
    expect(serviceMock.listMarket).toHaveBeenCalled();
    expect(serviceMock.installMarket).toHaveBeenCalledWith('echo.market-tool');
    expect(serviceMock.createExample).toHaveBeenCalledWith('theme-preset');
    expect(serviceMock.enable).toHaveBeenCalledWith({ pluginId: 'echo.playback-panel' });
    expect(serviceMock.deletePlugin).toHaveBeenCalledWith('echo.playback-panel');
    expect(requirePrivateFeatureMock).toHaveBeenCalledWith('plugins');
    expect(serviceMock.exportPackage).toHaveBeenCalledWith('echo.playback-panel');
    expect(serviceMock.importPackage).toHaveBeenCalledWith(undefined);
    expect(serviceMock.importPackage).toHaveBeenCalledWith('D:\\Echo\\plugin.echo');
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
    expect(serviceMock.getSettings).toHaveBeenCalledWith('echo.playback-panel');
    expect(serviceMock.setSettings).toHaveBeenCalledWith('echo.playback-panel', { mode: 'fast' });
  });

  it('rejects malformed plugin IPC payloads before reaching the service', async () => {
    await expect(handlers[IpcChannels.PluginsCreateExample]!(null, 'remote-market')).rejects.toThrow('unknown_plugin_example_kind');
    await expect(handlers[IpcChannels.PluginsInstallMarket]!(null, '')).rejects.toThrow('pluginId must be a non-empty string');
    await expect(handlers[IpcChannels.PluginsEnable]!(null, null)).rejects.toThrow('plugin enable request must be an object');
    expect(() => handlers[IpcChannels.PluginsDisable]!(null, '')).toThrow('pluginId must be a non-empty string');
    expect(() => handlers[IpcChannels.PluginsDelete]!(null, '')).toThrow('pluginId must be a non-empty string');
    await expect(handlers[IpcChannels.PluginsExportPackage]!(null, '')).rejects.toThrow('pluginId must be a non-empty string');
    await expect(handlers[IpcChannels.PluginsRunCommand]!(null, null)).rejects.toThrow('plugin command request must be an object');
    await expect(handlers[IpcChannels.PluginsQueryMetadata]!(null, null)).rejects.toThrow('plugin metadata request must be an object');
    await expect(handlers[IpcChannels.PluginsQuerySources]!(null, null)).rejects.toThrow('plugin source search request must be an object');
    await expect(handlers[IpcChannels.PluginsResolveSourcePlayback]!(null, null)).rejects.toThrow('plugin source playback request must be an object');
    await expect(handlers[IpcChannels.PluginsQueryLyrics]!(null, null)).rejects.toThrow('plugin lyrics request must be an object');
    await expect(handlers[IpcChannels.PluginsQueryCovers]!(null, null)).rejects.toThrow('plugin cover request must be an object');
    await expect(handlers[IpcChannels.PluginsGetSettings]!(null, '')).rejects.toThrow('pluginId must be a non-empty string');
    await expect(handlers[IpcChannels.PluginsSetSettings]!(null, 'echo.playback-panel', null)).rejects.toThrow('plugin settings patch must be an object');
  });

  it('blocks plugin runtime IPC when ECHO Pro is not verified', async () => {
    getPrivatePluginOperationsMock.mockReturnValue(null);

    await expect(handlers[IpcChannels.PluginsRunCommand]!(null, { pluginId: 'echo.playback-panel', commandId: 'show-status' }))
      .rejects.toThrow('echo_pro_private_overlay_unavailable');
    expect(serviceMock.runCommand).not.toHaveBeenCalled();
  });

  it('blocks plugin package export before reaching the service when plugin export is not authorized', async () => {
    requirePrivateFeatureMock.mockRejectedValue(new Error('echo_pro_required'));

    await expect(handlers[IpcChannels.PluginsExportPackage]!(null, 'echo.playback-panel'))
      .rejects.toThrow('echo_authorization_required');

    expect(serviceMock.exportPackage).not.toHaveBeenCalled();
  });

  it('blocks plugin market install before reaching the service when Pro plugins are not authorized', async () => {
    requirePrivateFeatureMock.mockRejectedValue(new Error('echo_pro_required'));

    await expect(handlers[IpcChannels.PluginsInstallMarket]!(null, 'echo.market-tool'))
      .rejects.toThrow('echo_authorization_required');

    expect(serviceMock.installMarket).not.toHaveBeenCalled();
  });
});
