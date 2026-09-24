// @vitest-environment jsdom
import { Suspense } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appRoutes, createPluginPanelRoutes, preloadAppRoute, type AppRouteId } from './routes';
import type { PluginSummary } from '../../shared/types/plugins';

const settingsLoadProbes = vi.hoisted(() => ({
  route: vi.fn(),
  page: vi.fn(),
}));

vi.mock('../pages/FoldersPage', () => ({ FoldersPage: () => null }));
vi.mock('../pages/HomePage', () => ({ HomePage: () => null }));
vi.mock('../pages/PlaylistsPage', () => ({ PlaylistsPage: () => null }));
vi.mock('../pages/QueuePage', () => ({ QueuePage: () => null }));
vi.mock('../pages/SongsPage', () => ({ SongsPage: () => null }));
vi.mock('../pages/LyricsPage', () => ({ LyricsPage: () => null }));
vi.mock('../pages/LikedPage', () => ({ LikedPage: () => null }));
vi.mock('../pages/SettingsRoute', () => {
  settingsLoadProbes.route();
  return { SettingsRoute: () => <div>Lazy settings shell</div> };
});
vi.mock('../pages/SettingsPage', () => {
  settingsLoadProbes.page();
  return { SettingsPage: () => <div>Settings content</div> };
});
vi.mock('../components/settings/RemoteSourcesPanel', () => ({ RemoteSourcesPanel: () => null }));
vi.mock('../components/streaming/StreamingSearchPage', () => ({ StreamingSearchPage: () => null }));
vi.mock('../pages/ImportFolderPage', () => ({ ImportFolderPage: () => <div>Lazy import folder page</div> }));

afterEach(() => cleanup());

const getRoute = (id: AppRouteId) => {
  const route = appRoutes.find((candidate) => candidate.id === id);
  if (!route) {
    throw new Error(`Missing route: ${id}`);
  }
  return route;
};

const isLazyRoute = (id: AppRouteId): boolean => {
  const elementType = getRoute(id).element.type as { $$typeof?: symbol };
  return elementType.$$typeof === Symbol.for('react.lazy');
};

describe('app route loading boundaries', () => {
  it('creates navigable routes for enabled sandbox plugin panels', () => {
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
      contributes: {
        panels: [{ id: 'dashboard', title: 'Plugin Dashboard', path: 'panel.html', placement: 'main' }],
      },
    } as PluginSummary;

    const [route] = createPluginPanelRoutes([plugin]);

    expect(route).toMatchObject({
      id: 'plugin:echo.panel:dashboard',
      label: 'Plugin Dashboard',
      placement: 'main',
    });
    expect(route.element.props).toMatchObject({
      plugin,
      panel: plugin.contributes.panels?.[0],
    });
  });

  it('does not expose disabled or host-owned plugin panels as duplicate routes', () => {
    const disabled = {
      id: 'echo.disabled',
      enabled: false,
      status: 'disabled',
      disabledByHost: false,
      error: null,
      panel: 'D:\\Echo\\plugins\\echo.disabled\\panel.html',
      contributes: { panels: [{ id: 'main', title: 'Disabled', path: 'panel.html' }] },
    } as PluginSummary;
    const hostOwned = {
      ...disabled,
      id: 'osu.downloader',
      enabled: true,
      status: 'running',
      contributes: { panels: [{ id: 'main', title: 'osu!', hostPage: 'osu-downloader' as const }] },
    } as PluginSummary;

    expect(createPluginPanelRoutes([disabled, hostOwned])).toEqual([]);
  });

  it('lazy-loads every page except the startup home route', () => {
    const lazyRouteIds: AppRouteId[] = [
      'albums',
      'artists',
      'audio-cd',
      'connect',
      'downloads',
      'osu-downloader',
      'dsp',
      'history',
      'inbox',
      'import-folder',
      'songs',
      'lyrics',
      'folders',
      'remote',
      'streaming',
      'queue',
      'playlists',
      'liked',
      'settings',
    ];

    for (const routeId of lazyRouteIds) {
      expect(isLazyRoute(routeId), routeId).toBe(true);
    }
  });

  it('keeps only the startup home route eager', () => {
    expect(isLazyRoute('home')).toBe(false);
  });

  it('preserves the osu downloader variant on the shared lazy page', () => {
    expect(getRoute('osu-downloader').element.type).toBe(getRoute('downloads').element.type);
    expect(getRoute('osu-downloader').element.props).toMatchObject({ variant: 'osu' });
  });

  it('resolves a first-stage page through the existing Suspense boundary', async () => {
    render(
      <Suspense fallback={<div>Loading route</div>}>
        {getRoute('import-folder').element}
      </Suspense>,
    );

    expect(await screen.findByText('Lazy import folder page')).toBeTruthy();
  });

  it('preloads both settings loading stages before navigation', async () => {
    await preloadAppRoute('settings');

    expect(settingsLoadProbes.route).toHaveBeenCalledTimes(1);
    expect(settingsLoadProbes.page).toHaveBeenCalledTimes(1);
  });
});
