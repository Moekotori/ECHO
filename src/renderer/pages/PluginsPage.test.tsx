// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PluginsPage } from './PluginsPage';
import { pluginPanelBridgeChannel } from '../../shared/types/plugins';
import type { PluginSummary } from '../../shared/types/plugins';

const activity: PluginSummary['activity'] = {
  lastStartedAt: '2026-05-19T00:00:00.000Z',
  lastStoppedAt: null,
  lastCommandAt: null,
  lastEventAt: null,
  lastNetworkAt: null,
  lastProviderCallAt: null,
  lastStorageWriteAt: null,
  lastSettingsWriteAt: null,
  lastErrorAt: null,
  commandRunCount: 0,
  eventDispatchCount: 0,
  networkCallCount: 0,
  providerCallCount: 0,
  storageWriteCount: 0,
  settingsWriteCount: 0,
  errorCount: 0,
};

const security: PluginSummary['security'] = {
  requestedPermissionCount: 1,
  trustedPermissionCount: 0,
  untrustedPermissions: ['playback:read'],
  highRiskPermissions: [],
  reservedPermissions: [],
  limitedPermissions: [],
  hasEntry: true,
  hasPanel: true,
  sandboxedPanel: true,
  commandCount: 1,
  metadataProviderCount: 0,
  sourceProviderCount: 0,
  lyricsProviderCount: 0,
  coverProviderCount: 0,
  themePresetCount: 0,
  settingCount: 0,
  networkEnabled: false,
};

const plugins: PluginSummary[] = [
  {
    id: 'echo.playback-panel',
    name: '播放状态面板',
    version: '0.0.1',
    apiVersion: 1,
    compatibility: { isCompatible: true, reason: null, minEchoVersion: null },
    packageInfo: { origin: null, importedAt: null, packageVersion: null, checksum: null },
    health: { lastStartedAt: activity.lastStartedAt, lastApiCallAt: null, lastErrorAt: null, errorCount: 0, disabledByHost: false },
    directory: 'D:\\Echo\\plugins\\echo.playback-panel',
    entry: 'plugin.js',
    panel: 'D:\\Echo\\plugins\\echo.playback-panel\\panel.html',
    permissions: ['playback:read'],
    trustedPermissions: [],
    enabled: false,
    status: 'disabled',
    error: null,
    disabledByHost: false,
    activity,
    security,
    contributes: {
      commands: [{ id: 'show-status', title: '显示状态' }],
    },
    commands: [{ id: 'show-status', title: '显示状态', pluginId: 'echo.playback-panel' }],
    metadataProviders: [],
    sourceProviders: [],
    lyricsProviders: [],
    coverProviders: [],
    settingsValues: {},
  },
];

const pluginsBridge = {
  list: vi.fn(async () => ({ directory: 'D:\\Echo\\plugins', plugins })),
  createExample: vi.fn(async () => ({ pluginId: 'echo.playback-panel', directory: 'D:\\Echo\\plugins\\echo.playback-panel' })),
  enable: vi.fn(async () => ({ ...plugins[0], enabled: true, status: 'running', trustedPermissions: ['playback:read'] })),
  disable: vi.fn(async () => ({ ...plugins[0], enabled: false, status: 'disabled' })),
  reload: vi.fn(async () => plugins[0]),
  openDirectory: vi.fn(async () => undefined),
  exportPackage: vi.fn(async () => 'D:\\Echo\\plugins\\echo.playback-panel.echo-plugin.json'),
  importPackage: vi.fn(async () => ({ pluginId: 'echo.playback-panel', directory: 'D:\\Echo\\plugins\\echo.playback-panel', importedFileCount: 2, checksum: 'abc' })),
  runCommand: vi.fn(async () => undefined),
  queryLyrics: vi.fn(async () => ({ providers: [], candidates: [] })),
  queryCovers: vi.fn(async () => ({ providers: [], candidates: [] })),
  getSettings: vi.fn(async () => ({ pluginId: 'echo.playback-panel', values: {} })),
  setSettings: vi.fn(async () => ({ pluginId: 'echo.playback-panel', values: {} })),
  getLogs: vi.fn(async () => [{ id: 'log-1', pluginId: 'echo.playback-panel', level: 'info' as const, message: '已启动', createdAt: '2026-05-19T00:00:00.000Z' }]),
};

vi.mock('../utils/echoBridge', () => ({
  getPluginsBridge: () => pluginsBridge,
}));

vi.mock('../components/ui/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </div>
  ),
}));

describe('PluginsPage', () => {
  beforeEach(() => {
    Object.values(pluginsBridge).forEach((mock) => mock.mockClear());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders local plugin management and loads logs for the selected plugin', async () => {
    render(<PluginsPage />);

    expect(await screen.findByRole('heading', { name: '插件' })).toBeTruthy();
    expect((await screen.findAllByText('播放状态面板')).length).toBeGreaterThan(0);
    expect(screen.getByText(/读取播放状态/u)).toBeTruthy();
    expect(await screen.findByText('已启动')).toBeTruthy();
    expect(pluginsBridge.list).toHaveBeenCalledTimes(1);
    expect(pluginsBridge.getLogs).toHaveBeenCalledWith('echo.playback-panel');
  });

  it('confirms requested permissions before enabling a plugin', async () => {
    render(<PluginsPage />);

    const enableButtons = await screen.findAllByRole('button', { name: /启用/u });
    fireEvent.click(enableButtons.find((button) => button.className.includes('settings-action-button'))!);

    await waitFor(() => expect(pluginsBridge.enable).toHaveBeenCalledWith({
      pluginId: 'echo.playback-panel',
      trustedPermissions: ['playback:read'],
    }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('读取播放状态'));
  });

  it('creates example plugins from the management page', async () => {
    render(<PluginsPage />);

    const createButtons = await screen.findAllByRole('button', { name: '新建' });
    fireEvent.click(createButtons[0]);

    await waitFor(() => expect(pluginsBridge.createExample).toHaveBeenCalledWith('playback-panel'));
  });

  it('imports and exports local plugin packages', async () => {
    render(<PluginsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /导入插件包/u }));
    await waitFor(() => expect(pluginsBridge.importPackage).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: /导出插件包/u }));
    await waitFor(() => expect(pluginsBridge.exportPackage).toHaveBeenCalledWith('echo.playback-panel'));
  });

  it('routes sandbox panel bridge requests to the selected plugin only', async () => {
    render(<PluginsPage />);

    const iframe = await screen.findByTitle('播放状态面板 panel') as HTMLIFrameElement;
    expect(iframe.contentWindow).toBeTruthy();
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow,
      data: {
        channel: pluginPanelBridgeChannel,
        type: 'request',
        requestId: 'req-1',
        pluginId: 'echo.playback-panel',
        action: 'plugin:runCommand',
        payload: {
          commandId: 'show-status',
          args: ['from-panel'],
        },
      },
    }));

    await waitFor(() => expect(pluginsBridge.runCommand).toHaveBeenCalledWith({
      pluginId: 'echo.playback-panel',
      commandId: 'show-status',
      args: ['from-panel'],
    }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: pluginPanelBridgeChannel,
      type: 'response',
      requestId: 'req-1',
      pluginId: 'echo.playback-panel',
      ok: true,
    }), '*'));
  });
});
