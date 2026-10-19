import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { EditableTrackTags, LibraryPlaylist, LibraryTrack } from '../../../shared/types/library';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { openAlbumDetailForTrack } from '../../utils/albumNavigation';
import { resolvePlaylistForTrackAdd } from '../../utils/appPrompt';
import { dispatchAudioErrorNotice } from '../../utils/audioErrorNotice';
import { TrackContextMenu } from '../library/TrackContextMenu';
import type { TrackMenuAction } from '../library/TrackContextMenu';
import { TrackTagEditorDrawer } from '../library/TrackTagEditorDrawer';
const playerNowPlayingMenuActions = ['add-to-playlist', 'go-to-album', 'preview-cover', 'edit-tags', 'show-in-folder', 'copy-name-artist'] as const satisfies readonly TrackMenuAction[];
import { PlayerControlIcon } from './PlayerControlIcon';

type PlayerNowPlayingMoreMenuProps = {
  liked?: boolean;
  onMenuOpen?: () => void;
  onTrackUpdated?: (track: LibraryTrack) => void;
  suppressOpen?: boolean;
  track: LibraryTrack | null;
};

type MenuState = {
  track: LibraryTrack | null;
  position: { x: number; y: number };
};

const reportActionError = (error: unknown): void => {
  dispatchAudioErrorNotice(error instanceof Error ? error.message : String(error));
};

export const PlayerNowPlayingMoreMenu = ({
  liked = false,
  onMenuOpen,
  onTrackUpdated,
  suppressOpen = false,
  track,
}: PlayerNowPlayingMoreMenuProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editingTrack, setEditingTrack] = useState<LibraryTrack | null>(null);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [tagEditorError, setTagEditorError] = useState<string | null>(null);
  const tagEditorCloseTimerRef = useRef<number | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);

  const closeMenu = useCallback((): void => {
    setMenu(null);
  }, []);

  useEffect(() => {
    if (suppressOpen && menu) {
      closeMenu();
    }
  }, [closeMenu, menu, suppressOpen]);

  useEffect(() => () => {
    if (tagEditorCloseTimerRef.current !== null) {
      window.clearTimeout(tagEditorCloseTimerRef.current);
    }
  }, []);

  const showMenu = useCallback((button: HTMLButtonElement): void => {
    if (suppressOpen || menu) {
      return;
    }
    const rect = button.getBoundingClientRect();
    onMenuOpen?.();
    setMenu({
      track,
      position: { x: rect.left, y: rect.top },
    });
  }, [menu, onMenuOpen, suppressOpen, track]);

  const toggleMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (menu) {
      closeMenu();
    } else {
      showMenu(event.currentTarget);
    }
  }, [closeMenu, menu, showMenu]);

  const closeTagEditor = useCallback((): void => {
    setIsTagEditorOpen(false);
    if (tagEditorCloseTimerRef.current !== null) {
      window.clearTimeout(tagEditorCloseTimerRef.current);
    }
    tagEditorCloseTimerRef.current = window.setTimeout(() => {
      setEditingTrack(null);
      tagEditorCloseTimerRef.current = null;
    }, 280);
  }, []);

  const handleSaveTags = useCallback(async (
    target: LibraryTrack,
    tags: EditableTrackTags,
    coverPath: string | null,
    coverUrl: string | null,
    coverMimeType: string | null,
  ): Promise<LibraryTrack | void> => {
    const library = window.echo?.library;
    if (!library?.updateTrackTags) {
      setTagEditorError(t('songs.error.desktopBridgeFileActions'));
      return;
    }

    setIsSavingTags(true);
    setTagEditorError(null);
    try {
      const updatedTrack = await library.updateTrackTags({
        trackId: target.id,
        tags,
        coverPath,
        coverUrl,
        coverMimeType,
      });
      onTrackUpdated?.(updatedTrack);
      if (updatedTrack.embeddedMetadataStatus === 'pending' || updatedTrack.embeddedCoverStatus === 'pending') {
        setEditingTrack(updatedTrack);
        return updatedTrack;
      }
      closeTagEditor();
      return updatedTrack;
    } catch (error) {
      setTagEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingTags(false);
    }
  }, [closeTagEditor, onTrackUpdated, t]);

  const handleMenuAction = useCallback(async (
    action: TrackMenuAction,
    menuTrack: LibraryTrack,
    playlistTarget?: LibraryPlaylist,
  ): Promise<void> => {
    setMenu(null);
    const library = window.echo?.library;

    try {
      switch (action) {
        case 'add-to-playlist': {
          if (!library || menuTrack.unavailable === true || menuTrack.mediaType === 'streaming') {
            return;
          }
          const playlist = playlistTarget ?? (await resolvePlaylistForTrackAdd(library));
          if (!playlist) {
            return;
          }
          if (library.addTracksToPlaylist) {
            await library.addTracksToPlaylist(playlist.id, [menuTrack.id]);
          } else {
            await library.addTrackToPlaylist(playlist.id, menuTrack.id);
          }
          window.dispatchEvent(new Event('library:playlists-changed'));
          return;
        }
        case 'go-to-album':
          if (!(await openAlbumDetailForTrack(menuTrack))) {
            reportActionError(t('songs.error.albumNotFound', { album: menuTrack.album || 'Unknown Album' }));
          }
          return;
        case 'edit-tags':
          setTagEditorError(null);
          if (tagEditorCloseTimerRef.current !== null) {
            window.clearTimeout(tagEditorCloseTimerRef.current);
            tagEditorCloseTimerRef.current = null;
          }
          setIsTagEditorOpen(false);
          setEditingTrack(menuTrack);
          window.requestAnimationFrame(() => setIsTagEditorOpen(true));
          return;
        case 'show-in-folder':
          if (menuTrack.isTemporary) {
            await library?.openPathInFolder?.(menuTrack.path);
            return;
          }
          await library?.openTrackInFolder(menuTrack.id);
          return;
        case 'copy-name-artist':
          await library?.copyTrackNameArtist(menuTrack.id);
          return;
        default:
          return;
      }
    } catch (error) {
      reportActionError(error);
    }
  }, [t]);

  const moreLabel = t('library.trackRow.action.more');

  return (
    <div className="player-now-playing-more" data-player-utility="now-playing-more">
      <button
        ref={moreButtonRef}
        className="icon-button"
        data-workshop-icon="transport-more"
        type="button"
        disabled={!track}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        aria-label={moreLabel}
        title={moreLabel}
        onClick={toggleMenu}
      >
        <PlayerControlIcon name="more" />
      </button>
      {menu?.track ? (
        <TrackContextMenu
          track={menu.track}
          position={menu.position}
          liked={liked}
          enabledActions={playerNowPlayingMenuActions}
          onAction={(action, menuTrack, playlist) => {
            void handleMenuAction(action, menuTrack, playlist);
          }}
          onClose={closeMenu}
        />
      ) : null}
      <TrackTagEditorDrawer
        track={editingTrack}
        isOpen={isTagEditorOpen}
        isSaving={isSavingTags}
        error={tagEditorError}
        onClose={closeTagEditor}
        onSave={handleSaveTags}
        onTrackUpdated={onTrackUpdated}
      />
    </div>
  );
};
