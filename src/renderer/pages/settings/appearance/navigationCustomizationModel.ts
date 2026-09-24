import {
  Captions,
  Clock3,
  Download,
  FileDown,
  Gauge,
  Monitor,
  Volume2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { playerBarButtonIds } from '../../../../shared/types/appSettings';
import type { PlayerBarButtonId } from '../../../../shared/types/appSettings';
import {
  lockedHiddenSidebarRouteIds,
  lockedVisibleSidebarRouteIds,
  type SidebarRouteId,
} from '../../../../shared/types/sidebar';
import type { TranslationKey } from '../../../i18n/locales';

export type SidebarSettingsRouteItem = {
  id: SidebarRouteId;
  labelKey: TranslationKey;
  placement: 'main' | 'utility';
};

export const sidebarSettingsCopy = {
  titleKey: 'settings.appearance.sidebar.title',
  descriptionKey: 'settings.appearance.sidebar.description',
  mainGroupKey: 'settings.appearance.sidebar.mainGroup',
  utilityGroupKey: 'settings.appearance.sidebar.utilityGroup',
  resetKey: 'settings.appearance.sidebar.reset',
  expandKey: 'settings.appearance.sidebar.expand',
  collapseKey: 'settings.appearance.sidebar.collapse',
  visibleKey: 'settings.appearance.sidebar.visible',
  hiddenKey: 'settings.appearance.sidebar.hidden',
  fixedKey: 'settings.appearance.sidebar.fixed',
  proLockedKey: 'settings.appearance.sidebar.proLocked',
  noItemsKey: 'settings.appearance.sidebar.noItems',
} as const satisfies Record<string, TranslationKey>;

export const sidebarSettingsRouteItems: SidebarSettingsRouteItem[] = [
  { id: 'home', labelKey: 'route.home.label', placement: 'main' },
  { id: 'songs', labelKey: 'route.songs.label', placement: 'main' },
  { id: 'downloads', labelKey: 'route.downloads.label', placement: 'main' },
  { id: 'osu-downloader', labelKey: 'route.osuDownloader.label', placement: 'main' },
  { id: 'albums', labelKey: 'route.albums.label', placement: 'main' },
  { id: 'artists', labelKey: 'route.artists.label', placement: 'main' },
  { id: 'folders', labelKey: 'route.folders.label', placement: 'main' },
  { id: 'audio-cd', labelKey: 'route.audioCd.label', placement: 'main' },
  { id: 'remote', labelKey: 'route.remote.label', placement: 'main' },
  { id: 'connect', labelKey: 'route.connect.label', placement: 'main' },
  { id: 'dsp', labelKey: 'route.dsp.label', placement: 'main' },
  { id: 'streaming', labelKey: 'route.streaming.label', placement: 'main' },
  { id: 'queue', labelKey: 'route.queue.label', placement: 'main' },
  { id: 'history', labelKey: 'route.history.label', placement: 'main' },
  { id: 'playlists', labelKey: 'route.playlists.label', placement: 'main' },
  { id: 'inbox', labelKey: 'route.inbox.label', placement: 'main' },
  { id: 'plugins', labelKey: 'route.plugins.label', placement: 'main' },
  { id: 'liked', labelKey: 'route.liked.label', placement: 'utility' },
  { id: 'settings', labelKey: 'route.settings.label', placement: 'utility' },
  { id: 'audio-settings', labelKey: 'route.audioSettings.label', placement: 'utility' },
  { id: 'lyrics-settings', labelKey: 'route.lyricsSettings.label', placement: 'utility' },
  { id: 'import-folder', labelKey: 'route.importFolder.label', placement: 'utility' },
  { id: 'import-file', labelKey: 'route.importFile.label', placement: 'utility' },
];

export const sidebarSettingsRouteItemById = new Map(
  sidebarSettingsRouteItems.map((item) => [item.id, item]),
);
export const lockedVisibleSidebarRouteIdSet = new Set<SidebarRouteId>(lockedVisibleSidebarRouteIds);
export const lockedHiddenSidebarRouteIdSet = new Set<SidebarRouteId>(lockedHiddenSidebarRouteIds);

type PlayerBarButtonSettingsItem = {
  id: PlayerBarButtonId;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
};

export const defaultHiddenPlayerBarButtonIds: PlayerBarButtonId[] = ['audioExport'];
const playerBarButtonIdSet = new Set<PlayerBarButtonId>(playerBarButtonIds);

export const playerBarButtonSettingsCopy = {
  titleKey: 'settings.appearance.playerBarButtons.title',
  descriptionKey: 'settings.appearance.playerBarButtons.description',
  countKey: 'settings.appearance.playerBarButtons.count',
  resetKey: 'settings.appearance.playerBarButtons.reset',
  visibleKey: 'settings.appearance.playerBarButtons.visible',
  hiddenKey: 'settings.appearance.playerBarButtons.hidden',
} as const satisfies Record<string, TranslationKey>;

export const playerBarButtonSettingsItems: PlayerBarButtonSettingsItem[] = [
  {
    id: 'sleepTimer',
    labelKey: 'settings.appearance.playerBarButtons.sleepTimer',
    descriptionKey: 'settings.appearance.playerBarButtons.sleepTimer.description',
    icon: Clock3,
  },
  {
    id: 'desktopLyrics',
    labelKey: 'settings.appearance.playerBarButtons.desktopLyrics',
    descriptionKey: 'settings.appearance.playerBarButtons.desktopLyrics.description',
    icon: Captions,
  },
  {
    id: 'miniPlayer',
    labelKey: 'settings.appearance.playerBarButtons.miniPlayer',
    descriptionKey: 'settings.appearance.playerBarButtons.miniPlayer.description',
    icon: Monitor,
  },
  {
    id: 'volume',
    labelKey: 'settings.appearance.playerBarButtons.volume',
    descriptionKey: 'settings.appearance.playerBarButtons.volume.description',
    icon: Volume2,
  },
  {
    id: 'speed',
    labelKey: 'settings.appearance.playerBarButtons.speed',
    descriptionKey: 'settings.appearance.playerBarButtons.speed.description',
    icon: Gauge,
  },
  {
    id: 'streamingDownload',
    labelKey: 'settings.appearance.playerBarButtons.streamingDownload',
    descriptionKey: 'settings.appearance.playerBarButtons.streamingDownload.description',
    icon: Download,
  },
  {
    id: 'audioExport',
    labelKey: 'settings.appearance.playerBarButtons.audioExport',
    descriptionKey: 'settings.appearance.playerBarButtons.audioExport.description',
    icon: FileDown,
  },
];

export const normalizeHiddenPlayerBarButtonIdsForRenderer = (value: unknown): PlayerBarButtonId[] => {
  if (!Array.isArray(value)) {
    return [...defaultHiddenPlayerBarButtonIds];
  }

  const output: PlayerBarButtonId[] = [];
  const seen = new Set<PlayerBarButtonId>();
  for (const item of value) {
    if (!playerBarButtonIdSet.has(item as PlayerBarButtonId) || seen.has(item as PlayerBarButtonId)) {
      continue;
    }
    output.push(item as PlayerBarButtonId);
    seen.add(item as PlayerBarButtonId);
  }
  return output;
};
