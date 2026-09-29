// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LibraryTrack } from '../../../shared/types/library';
import { pluginTrackActionDrawerEvent } from './PluginTrackActionDrawer';
import { clearTrackContextMenuPluginCacheForTests, TrackContextMenu } from './TrackContextMenu';

vi.mock('../../i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const track: LibraryTrack = {
  id: 'track-1',
  path: 'D:\\Music\\track-1.flac',
  title: 'Track One',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'FLAC',
  sampleRate: 96_000,
  bitDepth: 24,
  bitrate: 1_200_000,
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
};

describe('TrackContextMenu plugin track actions', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearTrackContextMenuPluginCacheForTests();
    Reflect.deleteProperty(window, 'echo');
  });

  it('opens a plugin-provided track action from the right-click menu', async () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const openHandler = vi.fn();
    Object.defineProperty(window, 'echo', {
      configurable: true,
      value: {
        plugins: {
          list: vi.fn(async () => ({
            directory: 'D:\\Echo\\Plugins',
            plugins: [{
              id: 'echo.audio-authenticity',
              enabled: true,
              contributes: {
                trackContextMenus: [{ id: 'audio-authenticity', title: '音频可信度', commandId: 'analyze-track', localOnly: true }],
              },
            }],
          })),
        },
      },
    });
    window.addEventListener(pluginTrackActionDrawerEvent, openHandler);

    render(<TrackContextMenu track={track} position={{ x: 20, y: 24 }} onAction={onAction} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('menuitem', { name: '音频可信度' }));

    expect(openHandler).toHaveBeenCalledTimes(1);
    expect((openHandler.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      pluginId: 'echo.audio-authenticity',
      commandId: 'analyze-track',
      title: '音频可信度',
      track: { id: 'track-1' },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();

    window.removeEventListener(pluginTrackActionDrawerEvent, openHandler);
  });

  it('waits for plugin actions before showing the menu on a cold plugin cache', async () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    let resolvePlugins!: (value: {
      directory: string;
      plugins: Array<{
        id: string;
        enabled: boolean;
        contributes: { trackContextMenus: Array<{ id: string; title: string; commandId: string; localOnly: boolean }> };
      }>;
    }) => void;
    const pluginsResult = new Promise<Parameters<typeof resolvePlugins>[0]>((resolve) => {
      resolvePlugins = resolve;
    });
    Object.defineProperty(window, 'echo', {
      configurable: true,
      value: {
        plugins: {
          list: vi.fn(() => pluginsResult),
        },
      },
    });

    render(<TrackContextMenu track={track} position={{ x: 20, y: 24 }} onAction={onAction} onClose={onClose} />);

    expect(screen.queryByRole('menuitem', { name: 'trackMenu.action.playNext' })).toBeNull();

    resolvePlugins({
      directory: 'D:\\Echo\\Plugins',
      plugins: [{
        id: 'echo.audio-authenticity',
        enabled: true,
        contributes: {
          trackContextMenus: [{ id: 'audio-authenticity', title: '音频可信度', commandId: 'analyze-track', localOnly: true }],
        },
      }],
    });

    expect(await screen.findByRole('menuitem', { name: 'trackMenu.action.playNext' })).toBeTruthy();
    expect(await screen.findByRole('menuitem', { name: '音频可信度' })).toBeTruthy();
  });

  it('waits for the extra action setting before showing the menu on a cold settings cache', async () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    let resolveSettings!: (value: { trackContextMenuExtraActionsEnabled: boolean }) => void;
    const settingsResult = new Promise<Parameters<typeof resolveSettings>[0]>((resolve) => {
      resolveSettings = resolve;
    });
    Object.defineProperty(window, 'echo', {
      configurable: true,
      value: {
        app: {
          getSettings: vi.fn(() => settingsResult),
        },
      },
    });

    render(<TrackContextMenu track={track} position={{ x: 20, y: 24 }} onAction={onAction} onClose={onClose} />);

    expect(screen.queryByRole('menuitem', { name: 'trackMenu.action.playNext' })).toBeNull();

    resolveSettings({ trackContextMenuExtraActionsEnabled: true });

    expect(await screen.findByRole('menuitem', { name: 'trackMenu.action.playNext' })).toBeTruthy();
    expect(await screen.findByRole('menuitem', { name: 'trackMenu.action.openOsuTiming' })).toBeTruthy();
  });
});
