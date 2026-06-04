import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  Plus,
  RefreshCw,
  Timer,
  Tag,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LibraryPlaylist, LibraryTrack } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';

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

const viewportPadding = 8;
const pointerOffset = 6;
const submenuGap = 8;
const menuWidth = 224;
const submenuWidth = 224;
const submenuMaxHeight = 360;
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
const batchActions = new Set<TrackMenuAction>(['add-to-playlist', 'play-next', 'add-to-queue', 'toggle-liked', 'remove-from-queue']);

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

export const TrackContextMenu = ({ track, position, liked = false, selectionCount = 1, enabledActions, showRemoveFromPlaylist = false, onAction, onClose }: TrackContextMenuProps): JSX.Element => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const playlistLoadStartedRef = useRef(false);
  const [playlistSubmenuOpen, setPlaylistSubmenuOpen] = useState(false);
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistSubmenuPosition, setPlaylistSubmenuPosition] = useState(() => ({ x: position.x + menuWidth + submenuGap, y: position.y }));
  const [menuPosition, setMenuPosition] = useState(() => ({
    x: position.x + pointerOffset,
    y: position.y + pointerOffset,
  }));

  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (!menu) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    setMenuPosition({
      x: clamp(position.x + pointerOffset, viewportPadding, window.innerWidth - rect.width - viewportPadding),
      y: clamp(position.y + pointerOffset, viewportPadding, window.innerHeight - rect.height - viewportPadding),
    });
  }, [position.x, position.y]);

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
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const isBatch = selectionCount > 1;
  const isLocalFileTrack = !track.mediaType || track.mediaType === 'local';
  const isStreamingTrack = track.mediaType === 'streaming';
  const enabledActionSet = enabledActions ? new Set(enabledActions) : null;
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
    <div className="track-menu-layer" role="presentation" onMouseDown={onClose}>
      <div
        ref={menuRef}
        className="track-context-menu"
        role="menu"
        style={{ left: menuPosition.x, top: menuPosition.y }}
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
      </div>
      {playlistSubmenuOpen ? (
        <div
          className="track-playlist-submenu"
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
