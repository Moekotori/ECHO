// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginSummary } from '../../../shared/types/plugins';
import { runPluginPanelHostAction } from './pluginPanelHostBridge';

const plugin = {
  id: 'echo.panel',
  name: 'Panel Plugin',
  version: '1.0.0',
  apiVersion: 2,
  enabled: true,
  status: 'running',
  disabledByHost: false,
  error: null,
  directory: 'D:\\Echo\\plugins\\echo.panel',
  panel: 'D:\\Echo\\plugins\\echo.panel\\panel.html',
  permissions: ['playback:read', 'playback:control', 'library:read'],
  trustedPermissions: ['playback:read', 'playback:control', 'library:read'],
  contributes: {},
} as PluginSummary;

const pluginsApi = {
  getSettings: vi.fn(async () => ({ pluginId: plugin.id, values: { mode: 'compact' } })),
  setSettings: vi.fn(async (_pluginId: string, patch: Record<string, unknown>) => ({
    pluginId: plugin.id,
    values: patch,
  })),
} as unknown as NonNullable<Window['echo']>['plugins'];

describe('pluginPanelHostBridge', () => {
  beforeEach(() => {
    window.echo = {
      playback: {
        getStatus: vi.fn(async () => ({ state: 'playing', currentTrackId: 'track-1' })),
        play: vi.fn(async () => ({ state: 'playing' })),
        pause: vi.fn(async () => ({ state: 'paused' })),
        stop: vi.fn(async () => ({ state: 'stopped' })),
        seek: vi.fn(async (positionSeconds: number) => ({ state: 'playing', positionMs: positionSeconds * 1_000 })),
      },
      library: {
        getSummary: vi.fn(async () => ({ tracks: 1 })),
        getTracks: vi.fn(async () => ({
          items: [{
            id: 'track-1',
            title: 'Song',
            artist: 'Artist',
            path: 'D:\\Music\\song.flac',
            internalSecret: 'hidden',
          }],
          page: 1,
          pageSize: 200,
          total: 1,
          hasMore: false,
        })),
      },
    } as unknown as Window['echo'];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps playback control behind the trusted permission', async () => {
    await expect(runPluginPanelHostAction({
      action: 'host:playback:pause',
      payload: null,
      plugin: { ...plugin, trustedPermissions: [] },
      pluginsApi,
    })).rejects.toThrow('plugin_permission_denied:playback:control');

    expect(window.echo?.playback.pause).not.toHaveBeenCalled();
  });

  it('returns a bounded, field-selected library page', async () => {
    const result = await runPluginPanelHostAction({
      action: 'host:library:getTracks',
      payload: { pageSize: 999, fields: ['id', 'title'] },
      plugin,
      pluginsApi,
    });

    expect(window.echo?.library.getTracks).toHaveBeenCalledWith({
      page: 1,
      pageSize: 200,
    });
    expect(result).toEqual(expect.objectContaining({
      items: [{ id: 'track-1', title: 'Song' }],
    }));
  });

  it('lets API v2 panels read and write plugin-owned settings without app-settings access', async () => {
    await expect(runPluginPanelHostAction({
      action: 'host:settings:get',
      payload: null,
      plugin: { ...plugin, trustedPermissions: [] },
      pluginsApi,
    })).resolves.toEqual({ mode: 'compact' });

    await expect(runPluginPanelHostAction({
      action: 'host:settings:set',
      payload: { patch: { mode: 'expanded' } },
      plugin: { ...plugin, trustedPermissions: [] },
      pluginsApi,
    })).resolves.toEqual({ mode: 'expanded' });

    expect(pluginsApi.setSettings).toHaveBeenCalledWith(plugin.id, { mode: 'expanded' });
  });

  it('routes bounded plugin notifications through the app notice surface', async () => {
    const handler = vi.fn();
    window.addEventListener('app:show-chrome-notice', handler);

    await runPluginPanelHostAction({
      action: 'host:ui:notify',
      payload: { message: 'Hello from plugin' },
      plugin,
      pluginsApi,
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      detail: 'Hello from plugin',
    }));
    window.removeEventListener('app:show-chrome-notice', handler);
  });
});
