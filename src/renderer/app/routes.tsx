import { lazy } from 'react';
import { Disc3, Inbox, PanelTop, type LucideIcon } from 'lucide-react';
import { HomePage } from '../pages/HomePage';
import {
  EchoAlbumsIcon,
  EchoArtistsIcon,
  EchoAudioSettingsIcon,
  EchoConnectIcon,
  EchoDownloadsIcon,
  EchoDspIcon,
  EchoFoldersIcon,
  EchoHistoryIcon,
  EchoHomeIcon,
  EchoImportFileIcon,
  EchoImportFolderIcon,
  EchoLikedIcon,
  EchoLyricsSettingsIcon,
  EchoPlaylistsIcon,
  EchoPluginsIcon,
  EchoQueueIcon,
  EchoRemoteIcon,
  EchoSettingsIcon,
  EchoSongsIcon,
  EchoStreamingIcon,
} from '../components/layout/NavIcons';
import { EmptyState } from '../components/ui/EmptyState';
import type { TranslationKey } from '../i18n/locales';
import type { SidebarRouteId } from '../../shared/types/sidebar';
import type { PluginSummary } from '../../shared/types/plugins';
import { PluginPanelPage } from '../components/plugins/PluginPanelPage';

export type AppRouteId = SidebarRouteId | 'lyrics' | `plugin:${string}`;
export const pendingAppRouteStorageKey = 'echo-next.pending-route';

const pageLoaders = {
  albums: () => import('../pages/AlbumsPage'),
  artists: () => import('../pages/ArtistsPage'),
  'audio-cd': () => import('../pages/AudioCdPage'),
  connect: () => import('../pages/ConnectPage'),
  downloads: () => import('../pages/DownloadsPage'),
  dsp: () => import('../pages/DspPage'),
  history: () => import('../pages/HistoryPage'),
  'import-folder': () => import('../pages/ImportFolderPage'),
  inbox: () => import('../pages/InboxPage'),
  plugins: () => import('../pages/PluginsPage'),
  settings: () => import('../pages/SettingsRoute'),
  folders: () => import('../pages/FoldersPage'),
  playlists: () => import('../pages/PlaylistsPage'),
  queue: () => import('../pages/QueuePage'),
  songs: () => import('../pages/SongsPage'),
  lyrics: () => import('../pages/LyricsPage'),
  liked: () => import('../pages/LikedPage'),
  remote: () => import('../components/settings/RemoteSourcesPanel'),
  streaming: () => import('../components/streaming/StreamingSearchPage'),
} satisfies Partial<Record<AppRouteId, () => Promise<unknown>>>;

export const preloadAppRoute = async (routeId: AppRouteId): Promise<void> => {
  const loader = pageLoaders[routeId as keyof typeof pageLoaders];
  const preloadContent = routeId === 'settings' ? import('../pages/SettingsPage') : Promise.resolve();
  await Promise.all([loader?.(), preloadContent]).then(() => undefined).catch(() => undefined);
};

export const preloadPendingAppRoute = async (): Promise<void> => {
  try {
    const pendingRouteId = window.localStorage.getItem(pendingAppRouteStorageKey) as AppRouteId | null;
    if (pendingRouteId) {
      await preloadAppRoute(pendingRouteId);
    }
  } catch {
    // localStorage and route preloading are both best-effort during startup.
  }
};

const AlbumsPage = lazy(() => pageLoaders.albums().then((module) => ({ default: module.AlbumsPage })));
const ArtistsPage = lazy(() => pageLoaders.artists().then((module) => ({ default: module.ArtistsPage })));
const AudioCdPage = lazy(() => pageLoaders['audio-cd']().then((module) => ({ default: module.AudioCdPage })));
const ConnectPage = lazy(() => pageLoaders.connect().then((module) => ({ default: module.ConnectPage })));
const DownloadsPage = lazy(() => pageLoaders.downloads().then((module) => ({ default: module.DownloadsPage })));
const DspPage = lazy(() => pageLoaders.dsp().then((module) => ({ default: module.DspPage })));
const HistoryPage = lazy(() => pageLoaders.history().then((module) => ({ default: module.HistoryPage })));
const ImportFolderPage = lazy(() => pageLoaders['import-folder']().then((module) => ({ default: module.ImportFolderPage })));
const InboxPage = lazy(() => pageLoaders.inbox().then((module) => ({ default: module.InboxPage })));
const PluginsPage = lazy(() => pageLoaders.plugins().then((module) => ({ default: module.PluginsPage })));
const SettingsPage = lazy(() => pageLoaders.settings().then((module) => ({ default: module.SettingsRoute })));
const FoldersPage = lazy(() => pageLoaders.folders().then((module) => ({ default: module.FoldersPage })));
const PlaylistsPage = lazy(() => pageLoaders.playlists().then((module) => ({ default: module.PlaylistsPage })));
const QueuePage = lazy(() => pageLoaders.queue().then((module) => ({ default: module.QueuePage })));
const SongsPage = lazy(() => pageLoaders.songs().then((module) => ({ default: module.SongsPage })));
const LyricsPage = lazy(() => pageLoaders.lyrics().then((module) => ({ default: module.LyricsPage })));
const LikedPage = lazy(() => pageLoaders.liked().then((module) => ({ default: module.LikedPage })));
const RemoteSourcesPanel = lazy(() => pageLoaders.remote().then((module) => ({ default: module.RemoteSourcesPanel })));
const StreamingSearchPage = lazy(() => pageLoaders.streaming().then((module) => ({ default: module.StreamingSearchPage })));

export type AppRoute = {
  id: AppRouteId;
  label: string;
  labelKey?: TranslationKey;
  description: string;
  descriptionKey?: TranslationKey;
  icon: LucideIcon;
  placement: 'main' | 'utility';
  chrome?: 'shell' | 'standalone';
  hideFromSidebar?: boolean;
  element: JSX.Element;
};

const PlaceholderPage = ({
  icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}): JSX.Element => (
  <div className="page-stack">
    <EmptyState icon={icon} title={title} description={description} meta="This view still uses the shared ECHO Next shell." />
  </div>
);

export const createPluginPanelRoutes = (plugins: PluginSummary[]): AppRoute[] =>
  plugins.flatMap((plugin) => {
    if (!plugin.enabled || plugin.disabledByHost || plugin.status === 'error') {
      return [];
    }

    const declaredPanels = plugin.contributes.panels ?? [];
    const contributedPanels = declaredPanels.filter((panel) => !panel.hostPage && Boolean(panel.path));
    const panels = declaredPanels.length > 0
      ? contributedPanels
      : plugin.panel
        ? [{ id: 'main', title: plugin.name, placement: 'main' as const }]
        : [];

    return panels.map((panel): AppRoute => ({
      id: `plugin:${encodeURIComponent(plugin.id)}:${encodeURIComponent(panel.id)}`,
      label: panel.title,
      description: `${plugin.name} 插件面板`,
      icon: PanelTop,
      placement: panel.placement ?? 'main',
      element: <PluginPanelPage plugin={plugin} panel={panel} />,
    }));
  });

export const appRoutes: AppRoute[] = [
  {
    id: 'home',
    label: 'Home',
    labelKey: 'route.home.label',
    description: 'Library overview and recent listening.',
    descriptionKey: 'route.home.description',
    icon: EchoHomeIcon,
    placement: 'main',
    element: <HomePage />,
  },
  {
    id: 'songs',
    label: 'Songs',
    labelKey: 'route.songs.label',
    description: 'Local library song list.',
    descriptionKey: 'route.songs.description',
    icon: EchoSongsIcon,
    placement: 'main',
    element: <SongsPage />,
  },
  {
    id: 'downloads',
    label: 'Downloads',
    labelKey: 'route.downloads.label',
    description: 'Search, download, extract audio, and import results.',
    descriptionKey: 'route.downloads.description',
    icon: EchoDownloadsIcon,
    placement: 'main',
    element: <DownloadsPage />,
  },
  {
    id: 'osu-downloader',
    label: 'osu!',
    labelKey: 'route.osuDownloader.label',
    description: 'osu! beatmap audio downloader.',
    icon: EchoDownloadsIcon,
    placement: 'main',
    element: <DownloadsPage variant="osu" />,
  },
  {
    id: 'lyrics',
    label: 'Lyrics',
    labelKey: 'route.lyrics.label',
    description: 'Lyrics and immersive playback.',
    descriptionKey: 'route.lyrics.description',
    icon: EchoLyricsSettingsIcon,
    placement: 'main',
    chrome: 'standalone',
    // The standalone lyrics page is still reachable from the player controls; avoid a duplicate sidebar entry beside Lyrics Settings.
    hideFromSidebar: true,
    element: <LyricsPage />,
  },
  {
    id: 'albums',
    label: 'Albums',
    labelKey: 'route.albums.label',
    description: 'Grouped album wall.',
    descriptionKey: 'route.albums.description',
    icon: EchoAlbumsIcon,
    placement: 'main',
    element: <AlbumsPage />,
  },
  {
    id: 'artists',
    label: 'Artists',
    labelKey: 'route.artists.label',
    description: 'Browse by artist.',
    descriptionKey: 'route.artists.description',
    icon: EchoArtistsIcon,
    placement: 'main',
    element: <ArtistsPage />,
  },
  {
    id: 'folders',
    label: 'Folders',
    labelKey: 'route.folders.label',
    description: 'Local import roots.',
    descriptionKey: 'route.folders.description',
    icon: EchoFoldersIcon,
    placement: 'main',
    element: <FoldersPage />,
  },
  {
    id: 'audio-cd',
    label: 'Audio CD',
    labelKey: 'route.audioCd.label',
    description: 'Direct Audio CD playback.',
    descriptionKey: 'route.audioCd.description',
    icon: Disc3,
    placement: 'main',
    element: <AudioCdPage />,
  },
  {
    id: 'remote',
    label: 'Cloud / Remote',
    labelKey: 'route.remote.label',
    description: 'Remote sources.',
    descriptionKey: 'route.remote.description',
    icon: EchoRemoteIcon,
    placement: 'main',
    element: <RemoteSourcesPanel />,
  },
  {
    id: 'connect',
    label: 'Connect',
    labelKey: 'route.connect.label',
    description: 'DLNA and AirPlay wireless playback.',
    descriptionKey: 'route.connect.description',
    icon: EchoConnectIcon,
    placement: 'main',
    element: <ConnectPage />,
  },
  {
    id: 'dsp',
    label: 'DSP',
    labelKey: 'route.dsp.label',
    description: 'Signal-chain tuning workbench.',
    descriptionKey: 'route.dsp.description',
    icon: EchoDspIcon,
    placement: 'main',
    element: <DspPage />,
  },
  {
    id: 'streaming',
    label: 'Streaming',
    labelKey: 'route.streaming.label',
    description: 'Streaming music sources.',
    descriptionKey: 'route.streaming.description',
    icon: EchoStreamingIcon,
    placement: 'main',
    element: <StreamingSearchPage />,
  },
  {
    id: 'queue',
    label: 'Queue',
    labelKey: 'route.queue.label',
    description: 'Playback queue.',
    descriptionKey: 'route.queue.description',
    icon: EchoQueueIcon,
    placement: 'main',
    element: <QueuePage />,
  },
  {
    id: 'history',
    label: 'History',
    labelKey: 'route.history.label',
    description: 'Playback history.',
    descriptionKey: 'route.history.description',
    icon: EchoHistoryIcon,
    placement: 'main',
    element: <HistoryPage />,
  },
  {
    id: 'playlists',
    label: 'Playlists',
    labelKey: 'route.playlists.label',
    description: 'User playlists.',
    descriptionKey: 'route.playlists.description',
    icon: EchoPlaylistsIcon,
    placement: 'main',
    element: <PlaylistsPage />,
  },
  {
    id: 'inbox',
    label: 'Inbox',
    labelKey: 'route.inbox.label',
    description: 'New tracks from each scan.',
    descriptionKey: 'route.inbox.description',
    icon: Inbox,
    placement: 'main',
    element: <InboxPage />,
  },
  {
    id: 'plugins',
    label: 'Plugins',
    labelKey: 'route.plugins.label',
    description: 'Local editable plugins.',
    descriptionKey: 'route.plugins.description',
    icon: EchoPluginsIcon,
    placement: 'main',
    element: <PluginsPage />,
  },
  {
    id: 'liked',
    label: 'Liked',
    labelKey: 'route.liked.label',
    description: 'Saved tracks.',
    descriptionKey: 'route.liked.description',
    icon: EchoLikedIcon,
    placement: 'utility',
    element: <LikedPage />,
  },
  {
    id: 'settings',
    label: 'Settings',
    labelKey: 'route.settings.label',
    description: 'Application settings.',
    descriptionKey: 'route.settings.description',
    icon: EchoSettingsIcon,
    placement: 'utility',
    element: <SettingsPage />,
  },
  {
    id: 'audio-settings',
    label: 'Audio Settings',
    labelKey: 'route.audioSettings.label',
    description: 'Output and decoder settings.',
    descriptionKey: 'route.audioSettings.description',
    icon: EchoAudioSettingsIcon,
    placement: 'utility',
    element: <PlaceholderPage icon={EchoAudioSettingsIcon} title="Audio Settings" description="Output device, sample rate, and decoder options live here." />,
  },
  {
    id: 'lyrics-settings',
    label: 'Lyrics Settings',
    labelKey: 'route.lyricsSettings.label',
    description: 'Lyrics preferences.',
    descriptionKey: 'route.lyricsSettings.description',
    icon: EchoLyricsSettingsIcon,
    placement: 'utility',
    element: <PlaceholderPage icon={EchoLyricsSettingsIcon} title="Lyrics Settings" description="Lyrics sources and timing settings are stored here." />,
  },
  {
    id: 'import-folder',
    label: 'Import Folder',
    labelKey: 'route.importFolder.label',
    description: 'Choose a local music folder.',
    descriptionKey: 'route.importFolder.description',
    icon: EchoImportFolderIcon,
    placement: 'utility',
    element: <ImportFolderPage />,
  },
  {
    id: 'import-file',
    label: 'Import File',
    labelKey: 'route.importFile.label',
    description: 'Import a single audio file.',
    descriptionKey: 'route.importFile.description',
    icon: EchoImportFileIcon,
    placement: 'utility',
    element: <PlaceholderPage icon={EchoImportFileIcon} title="Import File" description="Single-file import will reuse the same metadata pipeline." />,
  },
];
