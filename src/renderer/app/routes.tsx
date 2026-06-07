import { Inbox, type LucideIcon } from 'lucide-react';
import { AlbumsPage } from '../pages/AlbumsPage';
import { ArtistsPage } from '../pages/ArtistsPage';
import { ConnectPage } from '../pages/ConnectPage';
import { DownloadsPage } from '../pages/DownloadsPage';
import { DspPage } from '../pages/DspPage';
import { FoldersPage } from '../pages/FoldersPage';
import { HistoryPage } from '../pages/HistoryPage';
import { HomePage } from '../pages/HomePage';
import { ImportFolderPage } from '../pages/ImportFolderPage';
import { InboxPage } from '../pages/InboxPage';
import { PlaylistsPage } from '../pages/PlaylistsPage';
import { PluginsPage } from '../pages/PluginsPage';
import { QueuePage } from '../pages/QueuePage';
import { SettingsPage } from '../pages/SettingsPage';
import { SongsPage } from '../pages/SongsPage';
import { LyricsPage } from '../pages/LyricsPage';
import { LikedPage } from '../pages/LikedPage';
import { RemoteSourcesPanel } from '../components/settings/RemoteSourcesPanel';
import { StreamingSearchPage } from '../components/streaming/StreamingSearchPage';
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

export type AppRouteId = SidebarRouteId | 'lyrics';

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
    description: 'Download queue placeholder.',
    descriptionKey: 'route.downloads.description',
    icon: EchoDownloadsIcon,
    placement: 'main',
    element: <DownloadsPage />,
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
    label: '连接',
    labelKey: 'route.connect.label',
    description: 'DLNA and AirPlay wireless playback.',
    descriptionKey: 'route.connect.description',
    icon: EchoConnectIcon,
    placement: 'main',
    element: <ConnectPage />,
  },
  {
    id: 'dsp',
    label: '音效处理',
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
