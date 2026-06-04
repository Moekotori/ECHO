import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Copy, Download, FileImage, Heart, ListEnd, Play, Plus, Tag, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LibraryAlbum, LibraryPlaylist } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';

export type AlbumMenuAction =
  | 'play-album'
  | 'add-to-playlist'
  | 'add-to-queue'
  | 'toggle-liked'
  | 'edit-tags'
  | 'copy-info'
  | 'copy-cover'
  | 'save-cover'
  | 'delete-album';

type AlbumContextMenuProps = {
  album: LibraryAlbum;
  position: { x: number; y: number };
  liked?: boolean;
  onAction: (action: AlbumMenuAction, album: LibraryAlbum, playlist?: LibraryPlaylist) => void;
  onClose: () => void;
};

type MenuItem = {
  action: AlbumMenuAction;
  labelKey: TranslationKey;
  icon: LucideIcon;
  danger?: boolean;
};

const viewportPadding = 8;
const pointerOffset = 6;
const submenuGap = 8;
const menuWidth = 218;
const submenuWidth = 224;
const submenuMaxHeight = 360;
const remoteHiddenActions = new Set<AlbumMenuAction>(['edit-tags', 'delete-album']);

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

export const AlbumContextMenu = ({ album, position, liked = false, onAction, onClose }: AlbumContextMenuProps): JSX.Element => {
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

  const allItems: MenuItem[] = [
    { action: 'play-album', labelKey: 'albumMenu.action.playAlbum', icon: Play },
    { action: 'add-to-playlist', labelKey: 'albumMenu.action.addToPlaylist', icon: Plus },
    { action: 'add-to-queue', labelKey: 'albumMenu.action.addToQueue', icon: ListEnd },
    { action: 'toggle-liked', labelKey: liked ? 'albumMenu.action.unlikeAlbum' : 'albumMenu.action.likeAlbum', icon: Heart },
    { action: 'edit-tags', labelKey: 'albumMenu.action.editTags', icon: Tag },
    { action: 'copy-info', labelKey: 'albumMenu.action.copyInfo', icon: Copy },
    { action: 'copy-cover', labelKey: 'albumMenu.action.copyCover', icon: FileImage },
    { action: 'save-cover', labelKey: 'albumMenu.action.saveCover', icon: Download },
    { action: 'delete-album', labelKey: 'albumMenu.action.deleteAlbum', icon: Trash2, danger: true },
  ];
  const items = allItems.filter((item) => album.mediaType !== 'remote' || !remoteHiddenActions.has(item.action));

  return createPortal(
    <div className="album-menu-layer" role="presentation" onMouseDown={onClose}>
      <div
        ref={menuRef}
        className="album-context-menu"
        role="menu"
        style={{ left: menuPosition.x, top: menuPosition.y }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {items.map((item) => {
          const Icon = item.icon;
          if (item.action === 'add-to-playlist') {
            return (
              <button
                className="album-menu-item album-menu-item--branch"
                data-danger={item.danger ? 'true' : undefined}
                key={item.action}
                role="menuitem"
                type="button"
                onClick={(event) => openPlaylistSubmenu(event.currentTarget)}
                onMouseEnter={(event) => openPlaylistSubmenu(event.currentTarget)}
              >
                <Icon size={16} />
                <span>{t(item.labelKey)}</span>
                <ChevronRight className="album-menu-branch-icon" size={15} />
              </button>
            );
          }

          return (
            <button
              className="album-menu-item"
              data-danger={item.danger ? 'true' : undefined}
              key={item.action}
              role="menuitem"
              type="button"
              onClick={() => onAction(item.action, album)}
            >
              <Icon size={16} />
              <span>{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>
      {playlistSubmenuOpen ? (
        <div
          className="album-playlist-submenu"
          role="menu"
          aria-label={t('albumMenu.playlistSubmenu.aria')}
          style={{ left: playlistSubmenuPosition.x, top: playlistSubmenuPosition.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {playlistsLoading ? <div className="album-playlist-submenu-empty">{t('albumMenu.playlistSubmenu.loading')}</div> : null}
          {!playlistsLoading && playlists.length === 0 ? <div className="album-playlist-submenu-empty">{t('albumMenu.playlistSubmenu.empty')}</div> : null}
          {!playlistsLoading
            ? playlists.map((playlist) => (
                <button
                  className="album-playlist-submenu-item"
                  key={playlist.id}
                  role="menuitem"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAction('add-to-playlist', album, playlist);
                  }}
                >
                  <span>{playlist.name}</span>
                  <small>{t('albumMenu.playlistSubmenu.itemCount', { count: playlist.itemCount })}</small>
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
};
