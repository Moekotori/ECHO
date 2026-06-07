import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  Copy,
  Disc3,
  Download,
  FileImage,
  FileText,
  FolderOpen,
  Heart,
  ListEnd,
  ListMusic,
  Minus,
  PanelTopOpen,
  Play,
  Puzzle,
  Plus,
  RefreshCw,
  Timer,
  Tag,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LibraryPlaylist, LibraryTrack } from '../../../shared/types/library';
import type { AppSettings } from '../../../shared/types/appSettings';
import type { PluginTrackContextMenuContribution } from '../../../shared/types/plugins';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { pluginTrackActionDrawerEvent } from './PluginTrackActionDrawer';

export type TrackMenuAction =
  | 'add-to-playlist'
  | 'play-next'
  | 'add-to-queue'
  | 'toggle-liked'
  | 'remove-from-queue'
  | 'remove-from-playlist'
  | 'edit-tags'
  | 'reload-embedded-tags'
  | 'clear-lyrics-cache'
  | 'open-osu-timing'
  | 'go-to-album'
  | 'show-in-folder'
  | 'copy-path'
  | 'open-system'
  | 'copy-name-artist'
  | 'copy-cover'
  | 'save-cover'
  | 'delete-song';

type TrackContextMenuProps = {
  track: LibraryTrack;
  position: { x: number; y: number };
  liked?: boolean;
  selectionCount?: number;
  enabledActions?: readonly TrackMenuAction[];
  showRemoveFromPlaylist?: boolean;
  onAction: (action: TrackMenuAction, track: LibraryTrack, playlist?: LibraryPlaylist) => void;
  onClose: () => void;
};

type MenuItem = {
  action: TrackMenuAction;
  labelKey: TranslationKey;
  icon: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
};

type PluginMenuItem = PluginTrackContextMenuContribution & {
  pluginId: string;
};

const viewportPadding = 8;
const pointerOffset = 6;
const submenuGap = 8;
const menuWidth = 224;
const submenuWidth = 224;
const submenuMaxHeight = 360;
const menuCloseAnimationMs = 120;
const nonLocalHiddenActions = new Set<TrackMenuAction>([
  'edit-tags',
  'reload-embedded-tags',
  'open-osu-timing',
  'show-in-folder',
  'copy-path',
  'open-system',
  'copy-cover',
  'save-cover',
  'delete-song',
]);
const extraHiddenActions = new Set<TrackMenuAction>([
  'open-osu-timing',
  'open-system',
  'copy-cover',
  'save-cover',
]);
const batchActions = new Set<TrackMenuAction>(['add-to-playlist', 'play-next', 'add-to-queue', 'toggle-liked', 'remove-from-queue']);

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

const openPluginTrackActionDrawer = (item: PluginMenuItem, track: LibraryTrack): void => {
  window.dispatchEvent(new CustomEvent(pluginTrackActionDrawerEvent, {
    detail: {
      pluginId: item.pluginId,
      commandId: item.commandId,
      title: item.title,
      track,
    },
  }));
};

export const TrackContextMenu = ({ track, position, liked = false, selectionCount = 1, enabledActions, showRemoveFromPlaylist = false, onAction, onClose }: TrackContextMenuProps): JSX.Element => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const playlistLoadStartedRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const [playlistSubmenuOpen, setPlaylistSubmenuOpen] = useState(false);
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [pluginMenuItems, setPluginMenuItems] = useState<PluginMenuItem[]>([]);
  const [playlistSubmenuPosition, setPlaylistSubmenuPosition] = useState(() => ({ x: position.x + menuWidth + submenuGap, y: position.y }));
  const [menuPosition, setMenuPosition] = useState(() => ({
    x: position.x + pointerOffset,
    y: position.y + pointerOffset,
  }));
  const [menuMaxHeight, setMenuMaxHeight] = useState(() => window.innerHeight - viewportPadding * 2);
  const [extraActionsEnabled, setExtraActionsEnabled] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const requestClose = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      return;
    }

    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, menuCloseAnimationMs);
  }, [onClose]);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsClosing(false);
  }, [position.x, position.y, track.id]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (!menu) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    const viewportMaxHeight = Math.max(0, window.innerHeight - viewportPadding * 2);
    const measuredHeight = Math.max(menu.scrollHeight, rect.height);
    const fittedHeight = Math.min(measuredHeight, viewportMaxHeight);
    const nextY = clamp(
      position.y + pointerOffset,
      viewportPadding,
      Math.max(viewportPadding, window.innerHeight - fittedHeight - viewportPadding),
    );

    setMenuPosition({
      x: clamp(position.x + pointerOffset, viewportPadding, window.innerWidth - rect.width - viewportPadding),
      y: nextY,
    });
    setMenuMaxHeight(Math.max(0, window.innerHeight - nextY - viewportPadding));
  }, [enabledActions, extraActionsEnabled, liked, pluginMenuItems.length, position.x, position.y, selectionCount, showRemoveFromPlaylist, track.mediaType]);

  const loadPlaylists = (): void => {
    if (playlistLoadStartedRef.current) {
      return;
    }

    playlistLoadStartedRef.current = true;
    const library = window.echo?.library;
    if (!library) {
      return;
    }

    setPlaylistsLoading(true);
    void library
      .getPlaylists()
      .then((items) => {
        setPlaylists(items.filter((item) => item.sourceProvider === 'local' && item.kind !== 'system'));
      })
      .finally(() => setPlaylistsLoading(false));
  };

  const openPlaylistSubmenu = (target: HTMLElement): void => {
    const rect = target.getBoundingClientRect();
    const opensLeft = rect.right + submenuGap + submenuWidth + viewportPadding > window.innerWidth;
    const maxTop = Math.max(viewportPadding, window.innerHeight - Math.min(submenuMaxHeight, window.innerHeight - viewportPadding * 2));

    setPlaylistSubmenuPosition({
      x: opensLeft ? Math.max(viewportPadding, rect.left - submenuWidth - submenuGap) : rect.right + submenuGap,
      y: clamp(rect.top - 8, viewportPadding, maxTop),
    });
    setPlaylistSubmenuOpen(true);
    loadPlaylists();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', requestClose);
    window.addEventListener('scroll', requestClose, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', requestClose);
      window.removeEventListener('scroll', requestClose, true);
    };
  }, [requestClose]);

  useEffect(() => {
    let cancelled = false;
    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!cancelled) {
        setExtraActionsEnabled(settings?.trackContextMenuExtraActionsEnabled === true);
      }
    };
    const handleSettingsChanged = (event: Event): void => {
      const detail = (event as CustomEvent<Partial<AppSettings>>).detail;
      if (Object.prototype.hasOwnProperty.call(detail ?? {}, 'trackContextMenuExtraActionsEnabled')) {
        applySettings(detail);
      }
    };

    void window.echo?.app?.getSettings?.().then(applySettings).catch(() => applySettings(null));
    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  const isBatch = selectionCount > 1;
  const isLocalFileTrack = !track.mediaType || track.mediaType === 'local';
  const isStreamingTrack = track.mediaType === 'streaming';
  const enabledActionSet = enabledActions ? new Set(enabledActions) : null;
  useEffect(() => {
    if (isBatch) {
      setPluginMenuItems([]);
      return undefined;
    }

    const plugins = window.echo?.plugins;
    if (!plugins) {
      setPluginMenuItems([]);
      return undefined;
    }

    let cancelled = false;
    void plugins.list()
      .then((result) => {
        if (cancelled) {
          return;
        }

        const nextItems = result.plugins
          .filter((plugin) => plugin.enabled)
          .flatMap((plugin) =>
            (plugin.contributes.trackContextMenus ?? []).map((item) => ({
              ...item,
              pluginId: plugin.id,
            })),
          )
          .filter((item) => isLocalFileTrack || item.localOnly !== true);
        setPluginMenuItems(nextItems);
      })
      .catch(() => {
        if (!cancelled) {
          setPluginMenuItems([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isBatch, isLocalFileTrack]);

  const allItems: MenuItem[] = [
    { action: 'add-to-playlist', labelKey: 'trackMenu.action.addToPlaylist', icon: Plus },
    { action: 'play-next', labelKey: 'trackMenu.action.playNext', icon: Play },
    { action: 'add-to-queue', labelKey: 'trackMenu.action.addToQueue', icon: ListEnd },
    { action: 'toggle-liked', labelKey: isBatch || !liked ? 'trackMenu.action.like' : 'trackMenu.action.unlike', icon: Heart },
    { action: 'remove-from-queue', labelKey: 'trackMenu.action.removeFromQueue', icon: Minus },
    { action: 'remove-from-playlist', labelKey: 'trackMenu.action.removeFromPlaylist', icon: Trash2, danger: true },
    { action: 'open-osu-timing', labelKey: 'trackMenu.action.openOsuTiming', icon: Timer },
    { action: 'edit-tags', labelKey: 'trackMenu.action.editTags', icon: Tag },
    { action: 'reload-embedded-tags', labelKey: 'trackMenu.action.reloadEmbeddedTags', icon: RefreshCw },
    { action: 'clear-lyrics-cache', labelKey: 'trackMenu.action.clearLyricsCache', icon: FileText },
    { action: 'go-to-album', labelKey: 'trackMenu.action.goToAlbum', icon: Disc3 },
    { action: 'show-in-folder', labelKey: 'trackMenu.action.showInFolder', icon: FolderOpen },
    { action: 'copy-path', labelKey: 'trackMenu.action.copyPath', icon: Copy },
    { action: 'open-system', labelKey: 'trackMenu.action.openSystem', icon: PanelTopOpen },
    { action: 'copy-name-artist', labelKey: 'trackMenu.action.copyNameArtist', icon: ListMusic },
    { action: 'copy-cover', labelKey: 'trackMenu.action.copyCover', icon: FileImage },
    { action: 'save-cover', labelKey: 'trackMenu.action.saveCover', icon: Download },
    { action: 'delete-song', labelKey: 'trackMenu.action.deleteSong', icon: Trash2, danger: true },
  ];
  const items = allItems.filter((item) => {
    if (enabledActionSet && !enabledActionSet.has(item.action)) {
      return false;
    }

    if (!extraActionsEnabled && extraHiddenActions.has(item.action)) {
      return false;
    }

    if (item.action === 'add-to-playlist') {
      return !isStreamingTrack;
    }

    if (item.action === 'remove-from-playlist') {
      return !isBatch && showRemoveFromPlaylist;
    }

    if (isBatch && !batchActions.has(item.action)) {
      return false;
    }

    return isLocalFileTrack || !nonLocalHiddenActions.has(item.action);
  });

  return createPortal(
    <div className="track-menu-layer" role="presentation" onMouseDown={requestClose}>
      <div
        ref={menuRef}
        className={`track-context-menu${isClosing ? ' track-context-menu--closing' : ''}`}
        role="menu"
        style={{ left: menuPosition.x, top: menuPosition.y, maxHeight: menuMaxHeight }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {isBatch ? <div className="track-menu-heading">已选 {selectionCount} 首</div> : null}
        {items.map((item) => {
          const Icon = item.icon;
          if (item.action === 'add-to-playlist') {
            return (
              <button
                className="track-menu-item track-menu-item--branch"
                data-danger={item.danger ? 'true' : undefined}
                disabled={item.disabled}
                key={item.action}
                role="menuitem"
                type="button"
                onClick={(event) => openPlaylistSubmenu(event.currentTarget)}
                onMouseEnter={(event) => openPlaylistSubmenu(event.currentTarget)}
              >
                <Icon size={16} />
                <span>{t(item.labelKey)}</span>
                <ChevronRight className="track-menu-branch-icon" size={15} />
              </button>
            );
          }

          return (
            <button
              className="track-menu-item"
              data-danger={item.danger ? 'true' : undefined}
              disabled={item.disabled}
              key={item.action}
              role="menuitem"
              type="button"
              onClick={() => onAction(item.action, track)}
            >
              <Icon size={16} />
              <span>{t(item.labelKey)}</span>
            </button>
          );
        })}
        {pluginMenuItems.map((item) => (
          <button
            className="track-menu-item"
            key={`${item.pluginId}:${item.id}`}
            role="menuitem"
            type="button"
            title={item.description}
            onClick={() => {
              openPluginTrackActionDrawer(item, track);
              onClose();
            }}
          >
            <Puzzle size={16} />
            <span>{item.title}</span>
          </button>
        ))}
      </div>
      {playlistSubmenuOpen ? (
        <div
          className={`track-playlist-submenu${isClosing ? ' track-playlist-submenu--closing' : ''}`}
          role="menu"
          aria-label="选择歌单"
          style={{ left: playlistSubmenuPosition.x, top: playlistSubmenuPosition.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {playlistsLoading ? <div className="track-playlist-submenu-empty">读取歌单...</div> : null}
          {!playlistsLoading && playlists.length === 0 ? <div className="track-playlist-submenu-empty">没有本地歌单</div> : null}
          {!playlistsLoading
            ? playlists.map((playlist) => (
                <button
                  className="track-playlist-submenu-item"
                  key={playlist.id}
                  role="menuitem"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAction('add-to-playlist', track, playlist);
                  }}
                >
                  <span>{playlist.name}</span>
                  <small>{playlist.itemCount} 首</small>
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
};
