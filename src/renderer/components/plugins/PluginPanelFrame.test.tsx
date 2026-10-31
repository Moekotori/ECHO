// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { pluginPanelBridgeChannel } from '../../../shared/types/plugins';
import type { PluginSummary } from '../../../shared/types/plugins';
import type { AudioStatus } from '../../../shared/types/audio';
import { PluginPanelFrame } from './PluginPanelFrame';

const pluginsBridge = {
  getLogs: vi.fn(async () => []),
  runCommand: vi.fn(async () => ({ ok: true })),
};

vi.mock('../../utils/echoBridge', () => ({
  getPluginsBridge: () => pluginsBridge,
}));

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
  permissions: ['playback:read', 'library:read'],
  trustedPermissions: ['playback:read', 'library:read'],
  contributes: {},
} as PluginSummary;

let audioStatusHandler: ((status: AudioStatus) => void) | null = null;
const unsubscribeAudio = vi.fn();

describe('PluginPanelFrame', () => {
  beforeEach(() => {
    audioStatusHandler = null;
    unsubscribeAudio.mockClear();
    window.echo = {
      audio: {
        onStatus: vi.fn((handler: (status: AudioStatus) => void) => {
          audioStatusHandler = handler;
          return unsubscribeAudio;
        }),
      },
      playback: {
        getStatus: vi.fn(async () => ({ state: 'playing', currentTrackId: 'track-1' })),
      },
    } as unknown as typeof window.echo;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('allows a trusted panel to subscribe to host-owned playback events', async () => {
    render(
      <PluginPanelFrame
        plugin={plugin}
        panelPath={plugin.panel!}
        title="Panel Plugin"
      />,
    );
    const iframe = screen.getByTitle('Panel Plugin') as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow,
      data: {
        channel: pluginPanelBridgeChannel,
        version: 2,
        type: 'request',
        requestId: 'subscribe-1',
        pluginId: plugin.id,
        action: 'plugin:subscribe',
        payload: { eventName: 'playback:status' },
      },
    }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'response',
      requestId: 'subscribe-1',
      ok: true,
      result: { eventName: 'playback:status', subscribed: true },
    }), '*'));

    audioStatusHandler?.({ state: 'playing' } as AudioStatus);

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: pluginPanelBridgeChannel,
      version: 2,
      type: 'event',
      pluginId: plugin.id,
      eventName: 'playback:status',
      payload: expect.objectContaining({ state: 'playing' }),
    }), '*');
  });

  it('rejects subscriptions when the plugin permission was not trusted', async () => {
    const untrustedPlugin = { ...plugin, trustedPermissions: [] };
    render(
      <PluginPanelFrame
        plugin={untrustedPlugin}
        panelPath={untrustedPlugin.panel!}
        title="Untrusted Panel"
      />,
    );
    const iframe = screen.getByTitle('Untrusted Panel') as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow,
      data: {
        channel: pluginPanelBridgeChannel,
        version: 2,
        type: 'request',
        requestId: 'subscribe-2',
        pluginId: plugin.id,
        action: 'plugin:subscribe',
        payload: { eventName: 'playback:status' },
      },
    }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'response',
      requestId: 'subscribe-2',
      ok: false,
    }), '*'));
  });

  it('routes permission-checked host actions for interactive panels', async () => {
    render(
      <PluginPanelFrame
        plugin={plugin}
        panelPath={plugin.panel!}
        title="Panel Plugin"
      />,
    );
    const iframe = screen.getByTitle('Panel Plugin') as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage');

    window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow,
      data: {
        channel: pluginPanelBridgeChannel,
        version: 2,
        type: 'request',
        requestId: 'host-1',
        pluginId: plugin.id,
        action: 'host:playback:getStatus',
      },
    }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'response',
      requestId: 'host-1',
      ok: true,
      result: expect.objectContaining({ state: 'playing', currentTrackId: 'track-1' }),
    }), '*'));
    expect(window.echo?.playback.getStatus).toHaveBeenCalledTimes(1);
  });
});
