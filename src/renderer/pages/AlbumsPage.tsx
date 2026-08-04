import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, Disc3, ListFilter, RefreshCw, Search } from 'lucide-react';
import type { AppSettings } from '../../shared/types/appSettings';
import type { EditableAlbumTags, LibraryAlbum, LibraryPlaylist, LibrarySort, LibraryTrack } from '../../shared/types/library';
import type { RemoteSource } from '../../shared/types/remoteSources';
import { AlbumContextMenu } from '../components/album/AlbumContextMenu';
import type { AlbumMenuAction } from '../components/album/AlbumContextMenu';
import { AlbumDetailView } from '../components/album/AlbumDetailView';
import { AlbumTagEditorDrawer } from '../components/album/AlbumTagEditorDrawer';
import { LibrarySourceSwitch } from '../components/library/LibrarySourceSwitch';
import { RemoteSourceFilter } from '../components/library/RemoteSourceFilter';
import { DeferredWallImage, useScrollImagePause } from '../components/ui/DeferredWallImage';
import { getPageScrollContainer, InfiniteScrollSentinel, readPageScrollTop } from '../components/ui/InfiniteScrollSentinel';
import { likedAlbumsChangedEvent, likedChangedEvent } from '../hooks/useLikedMedia';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { albumDetailNavigationEvent, consumePendingAlbumDetailNavigation, peekPendingAlbumDetailNavigation, type DetailReturnTarget } from '../utils/albumNavigation';
import { getAppBridge, getRemoteSourcesBridge } from '../utils/echoBridge';
import { useImeAwareDebouncedSearch } from '../utils/imeInput';
import { readStoredLibrarySort, writeStoredLibrarySort } from '../utils/librarySortMemory';
import { readStoredLibrarySourceMode, writeStoredLibrarySourceMode, type LibrarySourceMode } from '../utils/librarySourceMode';

const pageSize = 90;
const albumWallReturnAnimationMs = 0;
const priorityAlbumWallImageCount = 16;
const albumWallLoadAheadDistancePx = 800;
const albumWallImageLoadAheadMargin = '480px 0px';
const albumWallMinCardWidthPx = 164;
const albumWallGridGapPx = 14;
const albumWallPaddingRightPx = 8;
const albumWallVirtualCopyHeightPx = 66;
const albumWallVirtualMinRowHeightPx = 236;
const albumWallVirtualOverscanRows = 5;
const albumWallVirtualLoadAheadRows = 4;
const albumWallVirtualFallbackRows = 4;
const albumCoverRetryDelaysMs = [600, 1800, 3600];
const maxPreservedRefreshPageSize = 800;
const preserveScrollThresholdPx = 80;
const restoreHomeScrollEvent = 'app:restore-home-scroll';
const isPreserveScrollLibraryEvent = (event: Event): boolean =>
  event instanceof CustomEvent && event.detail && typeof event.detail === 'object' && event.detail.preserveScroll === true;
const dispatchPreservedLibraryChange = (): void => {
  window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));
};
const albumSortOptions: Array<{ value: LibrarySort; labelKey: TranslationKey }> = [
  { value: 'default', labelKey: 'library.sort.default' },
  { value: 'titleAsc', labelKey: 'library.albums.sort.titleAsc' },
  { value: 'titleDesc', labelKey: 'library.albums.sort.titleDesc' },
  { value: 'artist', labelKey: 'library.albums.sort.artist' },
  { value: 'createdAsc', labelKey: 'library.sort.createdAsc' },
  { value: 'createdDesc', labelKey: 'library.sort.createdDesc' },
  { value: 'durationAsc', labelKey: 'library.sort.durationAsc' },
  { value: 'durationDesc', labelKey: 'library.sort.durationDesc' },
  { value: 'fileModifiedAsc', labelKey: 'library.sort.fileModifiedAsc' },
  { value: 'fileModifiedDesc', labelKey: 'library.sort.fileModifiedDesc' },
  { value: 'recent', labelKey: 'library.sort.recent' },
  { value: 'random', labelKey: 'library.sort.random' },
];
const albumsSortStorageKey = 'echo-next.albums.sort';
const validAlbumSortValues = new Set<LibrarySort>(albumSortOptions.map((option) => option.value));

type AlbumMenuState = {
  album: LibraryAlbum;
  position: { x: number; y: number };
};

const albumFolderPathFromTrackPath = (trackPath: string): string => {
  const trimmed = trackPath.trim();
  const separatorIndex = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return separatorIndex > 0 ? trimmed.slice(0, separatorIndex) : trimmed;
};

const formatAlbumTrackListForClipboard = (album: LibraryAlbum, tracks: LibraryTrack[]): string => {
  const header = `${album.title} - ${album.albumArtist}`;
  const lines = tracks.map((track, index) => {
    const trackNumber = track.trackNo ?? index + 1;
    const discPrefix = track.discNo && track.discNo > 1 ? `${track.discNo}-` : '';
    const artistSuffix = track.artist && track.artist !== album.albumArtist ? ` - ${track.artist}` : '';
    return `${discPrefix}${trackNumber}. ${track.title}${artistSuffix}`;
  });

  return [header, ...lines].join('\n');
};

const readAlbumWallScrollTop = (element: Element | null): number => {
  const pageSurface = element?.closest('.page-surface') as HTMLElement | null;
  return Math.max(readPageScrollTop(element), pageSurface?.scrollTop ?? 0);
};

const writeAlbumWallScrollTop = (element: Element | null, top: number): void => {
  const scrollContainer = getPageScrollContainer(element);
  const pageSurface = element?.closest('.page-surface') as HTMLElement | null;

  if (scrollContainer) {
    scrollContainer.scrollTop = top;
  }

  if (pageSurface && pageSurface !== scrollContainer) {
    pageSurface.scrollTop = 0;
  }
};

export const AlbumsPage = (): JSX.Element => {
  const { t } = useI18n();
  const { appendTracksToQueue, playTrack, playTrackNext } = usePlaybackQueue();
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [total, setTotal] = useState(0);
  const { search, searchInputProps } = useImeAwareDebouncedSearch(250);
  const [sort, setSort] = useState<LibrarySort>(() => readStoredLibrarySort(albumsSortStorageKey, validAlbumSortValues));
  const [sourceMode, setSourceModeState] = useState<LibrarySourceMode>(() => readStoredLibrarySourceMode());
  const [remoteSourceId, setRemoteSourceId] = useState<string | null>(null);
  const [remoteSources, setRemoteSources] = useState<RemoteSource[]>([]);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [initialAlbumDetailRequest] = useState(() => peekPendingAlbumDetailNavigation());
  const [selectedAlbum, setSelectedAlbum] = useState<LibraryAlbum | null>(() => initialAlbumDetailRequest?.album ?? null);
  const [selectedAlbumReturnTo, setSelectedAlbumReturnTo] = useState<DetailReturnTarget | null>(() => initialAlbumDetailRequest?.returnTo ?? null);
  const [isAlbumWallReturning, setIsAlbumWallReturning] = useState(false);
  const [albumMenu, setAlbumMenu] = useState<AlbumMenuState | null>(null);
  const [likedAlbumIds, setLikedAlbumIds] = useState<Record<string, boolean>>({});
  const [editingAlbum, setEditingAlbum] = useState<LibraryAlbum | null>(null);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [tagEditorError, setTagEditorError] = useState<string | null>(null);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [albumWallVirtualizationEnabled, setAlbumWallVirtualizationEnabled] = useState(false);
  const [albumWallViewportWidth, setAlbumWallViewportWidth] = useState(0);
  const [failedCoverUrls, setFailedCoverUrls] = useState<Record<string, string>>({});
  const [coverRetryKeys, setCoverRetryKeys] = useState<Record<string, number>>({});
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const pageScrollTopRef = useRef(0);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const shouldRestorePageScrollRef = useRef(false);
  const requestIdRef = useRef(0);
  const isLoadingRef = useRef(false);
  const tagEditorCloseTimerRef = useRef<number | null>(null);
  const albumWallReturnTimerRef = useRef<number | null>(null);
  const sourceRouteReturnCloseTimerRef = useRef<number | null>(null);
  const coverRetryTimersRef = useRef<Record<string, number>>({});
  const coverErrorAttemptsRef = useRef<Record<string, { url: string; count: number }>>({});
  const albumWallVirtualLoadRequestedRef = useRef(false);
  const pauseDeferredAlbumImages = useScrollImagePause(pageRootRef);

  useEffect(() => {
    if (!isSortOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (!sortMenuRef.current?.contains(event.target as Node)) {
        setIsSortOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isSortOpen]);

  const loadAlbums = useCallback(
    async (
      nextPage: number,
      mode: 'replace' | 'append',
      options: { pageSizeOverride?: number; restoreScrollTop?: number } = {},
    ) => {
      if (mode === 'append' && isLoadingRef.current) {
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      isLoadingRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const library = window.echo?.library;

        if (!library) {
          setAlbums([]);
          setPage(1);
          setTotal(0);
          setHasMore(false);
          setError(t('library.albums.error.desktopBridge'));
          return;
        }

        const result = await library.getAlbums({
          page: nextPage,
          pageSize: options.pageSizeOverride ?? pageSize,
          search,
          sort,
          sourceProvider: sourceMode,
          ...(sourceMode === 'remote' && remoteSourceId ? { sourceId: remoteSourceId } : {}),
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        setAlbums((current) => (mode === 'append' ? [...current, ...result.items] : result.items));
        setPage(options.pageSizeOverride && mode === 'replace' ? Math.max(1, Math.ceil(result.items.length / pageSize)) : result.page);
        setTotal(result.total);
        setHasMore(result.hasMore);
        if (mode === 'replace') {
          setFailedCoverUrls({});
          setCoverRetryKeys({});
          Object.values(coverRetryTimersRef.current).forEach((timer) => window.clearTimeout(timer));
          coverRetryTimersRef.current = {};
          coverErrorAttemptsRef.current = {};
        }
        if (typeof options.restoreScrollTop === 'number') {
          const restoreScrollTop = options.restoreScrollTop;
          window.setTimeout(() => writeAlbumWallScrollTop(pageRootRef.current, restoreScrollTop), 0);
        }
      } catch (loadError) {
        if (requestIdRef.current === requestId) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (requestIdRef.current === requestId) {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [remoteSourceId, search, sort, sourceMode, t],
  );

  const setSourceMode = useCallback((mode: LibrarySourceMode): void => {
    setSourceModeState(mode);
    if (mode !== 'remote') {
      setRemoteSourceId(null);
    }
    writeStoredLibrarySourceMode(mode);
  }, []);

  const refreshRemoteSources = useCallback(async (): Promise<void> => {
    const remoteApi = getRemoteSourcesBridge();
    if (!remoteApi?.list) {
      setRemoteSources([]);
      return;
    }

    try {
      const sources = await remoteApi.list();
      setRemoteSources(sources.filter((source) => source.status !== 'disabled'));
    } catch {
      setRemoteSources([]);
    }
  }, []);

  useEffect(() => {
    void loadAlbums(1, 'replace');
  }, [loadAlbums]);

  useEffect(() => {
    writeStoredLibrarySort(albumsSortStorageKey, sort);
  }, [sort]);

  useEffect(() => {
    if (sourceMode !== 'remote') {
      return undefined;
    }

    void refreshRemoteSources();

    const handleRemoteSourcesChanged = (): void => {
      void refreshRemoteSources();
    };

    window.addEventListener('library:changed', handleRemoteSourcesChanged);
    return () => window.removeEventListener('library:changed', handleRemoteSourcesChanged);
  }, [refreshRemoteSources, sourceMode]);

  useEffect(() => {
    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      setAlbumWallVirtualizationEnabled(settings?.albumWallVirtualizationEnabled === true);
    };

    const loadSettings = (): void => {
      const app = getAppBridge();

      if (!app?.getSettings) {
        applySettings(null);
        return;
      }

      void app.getSettings().then(applySettings).catch(() => applySettings(null));
    };

    const handleSettingsChanged = (event: Event): void => {
      const detail = event instanceof CustomEvent ? (event.detail as Partial<AppSettings> | null | undefined) : null;

      if (detail && Object.prototype.hasOwnProperty.call(detail, 'albumWallVirtualizationEnabled')) {
        applySettings(detail);
        return;
      }

      loadSettings();
    };

    loadSettings();
    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => window.removeEventListener('settings:changed', handleSettingsChanged);
  }, []);

  useEffect(() => {
    const handleLibraryChanged = (event: Event): void => {
      const scrollTop = readAlbumWallScrollTop(pageRootRef.current);
      if (isPreserveScrollLibraryEvent(event) && scrollTop > preserveScrollThresholdPx) {
        void loadAlbums(1, 'replace', {
          pageSizeOverride: Math.min(maxPreservedRefreshPageSize, Math.max(pageSize, page * pageSize, albums.length)),
          restoreScrollTop: scrollTop,
        });
        return;
      }

      writeAlbumWallScrollTop(pageRootRef.current, 0);
      void loadAlbums(1, 'replace');
    };

    window.addEventListener('library:changed', handleLibraryChanged);
    return () => window.removeEventListener('library:changed', handleLibraryChanged);
  }, [albums.length, loadAlbums, page]);

  useEffect(() => {
    if (albums.length === 0) {
      setLikedAlbumIds({});
      return undefined;
    }

    let isMounted = true;
    const ids = albums.map((album) => album.id);
    void window.echo?.library?.getLikedAlbumIds?.(ids)
      .then((result) => {
        if (isMounted) {
          setLikedAlbumIds(result);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLikedAlbumIds({});
        }
      });

    return () => {
      isMounted = false;
    };
  }, [albums]);

  useLayoutEffect(() => {
    writeAlbumWallScrollTop(pageRootRef.current, 0);
  }, [search, sort, sourceMode]);

  useLayoutEffect(() => {
    if (selectedAlbum || !shouldRestorePageScrollRef.current) {
      return;
    }

    writeAlbumWallScrollTop(pageRootRef.current, pageScrollTopRef.current);
    shouldRestorePageScrollRef.current = false;
  }, [selectedAlbum]);

  const openAlbumDetail = useCallback((album: LibraryAlbum, returnTo: DetailReturnTarget | null = null): void => {
    if (albumWallReturnTimerRef.current !== null) {
      window.clearTimeout(albumWallReturnTimerRef.current);
      albumWallReturnTimerRef.current = null;
    }
    setIsAlbumWallReturning(false);
    pageScrollTopRef.current = readAlbumWallScrollTop(pageRootRef.current);
    shouldRestorePageScrollRef.current = !returnTo;
    setSelectedAlbumReturnTo(returnTo);
    setSelectedAlbum(album);
  }, []);

  const closeAlbumDetail = useCallback((showReturnAnimation = false): void => {
    if (sourceRouteReturnCloseTimerRef.current !== null) {
      window.clearTimeout(sourceRouteReturnCloseTimerRef.current);
      sourceRouteReturnCloseTimerRef.current = null;
    }

    setSelectedAlbumReturnTo(null);
    setSelectedAlbum(null);

    if (!showReturnAnimation || albumWallReturnAnimationMs <= 0) {
      return;
    }

    if (albumWallReturnTimerRef.current !== null) {
      window.clearTimeout(albumWallReturnTimerRef.current);
    }

    setIsAlbumWallReturning(true);
    albumWallReturnTimerRef.current = window.setTimeout(() => {
      albumWallReturnTimerRef.current = null;
      setIsAlbumWallReturning(false);
    }, albumWallReturnAnimationMs);
  }, []);

  const closeAlbumDetailAfterSourceRouteSwitch = useCallback((): void => {
    if (sourceRouteReturnCloseTimerRef.current !== null) {
      window.clearTimeout(sourceRouteReturnCloseTimerRef.current);
    }

    sourceRouteReturnCloseTimerRef.current = window.setTimeout(() => {
      sourceRouteReturnCloseTimerRef.current = null;
      closeAlbumDetail();
    }, 0);
  }, [closeAlbumDetail]);

  useEffect(() => {
    const pendingRequest = consumePendingAlbumDetailNavigation();
    if (pendingRequest) {
      openAlbumDetail(pendingRequest.album, pendingRequest.returnTo ?? null);
    }

    const handleNavigateAlbumDetail = (event: Event): void => {
      const request = (event as CustomEvent<{ album?: LibraryAlbum; returnTo?: DetailReturnTarget }>).detail;
      if (request?.album) {
        consumePendingAlbumDetailNavigation();
        openAlbumDetail(request.album, request.returnTo ?? null);
      }
    };

    window.addEventListener(albumDetailNavigationEvent, handleNavigateAlbumDetail);
    return () => window.removeEventListener(albumDetailNavigationEvent, handleNavigateAlbumDetail);
  }, [openAlbumDetail]);

  const handleBackFromAlbumDetail = useCallback((): void => {
    if (selectedAlbumReturnTo === 'history') {
      window.dispatchEvent(new CustomEvent('app:navigate:route', { detail: 'history' }));
      closeAlbumDetailAfterSourceRouteSwitch();
      return;
    }

    if (selectedAlbumReturnTo === 'home') {
      window.dispatchEvent(new CustomEvent('app:navigate:route', { detail: 'home' }));
      window.requestAnimationFrame(() => window.dispatchEvent(new Event(restoreHomeScrollEvent)));
      closeAlbumDetailAfterSourceRouteSwitch();
      return;
    }

    if (selectedAlbumReturnTo === 'folders') {
      window.dispatchEvent(new CustomEvent('app:navigate:route', { detail: 'folders' }));
      closeAlbumDetailAfterSourceRouteSwitch();
      return;
    }

    if (selectedAlbumReturnTo === 'songs') {
      window.dispatchEvent(new Event('app:navigate:songs'));
      closeAlbumDetailAfterSourceRouteSwitch();
      return;
    }

    closeAlbumDetail(true);
  }, [closeAlbumDetail, closeAlbumDetailAfterSourceRouteSwitch, selectedAlbumReturnTo]);

  const getAllAlbumTracks = useCallback(async (albumId: string): Promise<LibraryTrack[]> => {
    const library = window.echo?.library;

    if (!library) {
      throw new Error(t('library.albums.error.desktopBridge'));
    }

    const tracks: LibraryTrack[] = [];
    let nextPage = 1;
    const trackPageSize = 500;
    for (;;) {
      const result = await library.getAlbumTracks(albumId, { page: nextPage, pageSize: trackPageSize });
      tracks.push(...result.items);
      if (!result.hasMore) {
        return tracks;
      }
      nextPage += 1;
    }
  }, [t]);

  const playAlbum = useCallback(
    async (album: LibraryAlbum): Promise<void> => {
      const tracks = await getAllAlbumTracks(album.id);
      const firstTrack = tracks[0];
      if (!firstTrack) {
        setError(t('library.albums.error.noPlayableTracks'));
        return;
      }

      const source = { type: 'album' as const, label: album.title, albumId: album.id };
      await playTrack(firstTrack, {
        replaceQueueWith: tracks,
        source,
      });
    },
    [getAllAlbumTracks, playTrack, t],
  );

  const playAlbumNext = useCallback(
    async (album: LibraryAlbum): Promise<void> => {
      const tracks = await getAllAlbumTracks(album.id);
      if (!tracks.length) {
        setError(t('library.albums.error.noPlayableTracks'));
        return;
      }

      const source = { type: 'album' as const, label: album.title, albumId: album.id };
      for (const track of [...tracks].reverse()) {
        playTrackNext(track, source);
      }
      setStatusMessage(t('library.albums.message.addedPlayNext', { count: tracks.length }));
    },
    [getAllAlbumTracks, playTrackNext, t],
  );

  const writeClipboardText = useCallback(
    async (text: string): Promise<void> => {
      if (!window.navigator.clipboard?.writeText) {
        throw new Error(t('library.albums.error.clipboardUnsupported'));
      }

      await window.navigator.clipboard.writeText(text);
      setStatusMessage(t('library.albums.message.copiedToClipboard'));
    },
    [t],
  );

  const closeTagEditor = useCallback((): void => {
    setIsTagEditorOpen(false);
    if (tagEditorCloseTimerRef.current !== null) {
      window.clearTimeout(tagEditorCloseTimerRef.current);
    }
    tagEditorCloseTimerRef.current = window.setTimeout(() => {
      setEditingAlbum(null);
      tagEditorCloseTimerRef.current = null;
    }, 280);
  }, []);

  const handleOpenAlbumMenu = useCallback((event: MouseEvent<HTMLElement>, album: LibraryAlbum): void => {
    event.preventDefault();
    event.stopPropagation();
    setAlbumMenu({ album, position: { x: event.clientX, y: event.clientY } });
  }, []);

  const openAlbumInFolder = useCallback(
    async (album: LibraryAlbum): Promise<void> => {
      const library = window.echo?.library;

      if (!library) {
        throw new Error(t('library.albums.error.desktopBridge'));
      }

      const result = await library.getAlbumTracks(album.id, { page: 1, pageSize: 1 });
      const track = result.items[0];
      if (!track) {
        throw new Error(t('albumTagEditor.error.noReadableTrack'));
      }

      if (library.openTrackInFolder) {
        await library.openTrackInFolder(track.id);
        return;
      }

      if (library.openPathInFolder) {
        await library.openPathInFolder(track.path);
        return;
      }

      throw new Error(t('albumTagEditor.error.openFolderUnsupported'));
    },
    [t],
  );

  const deleteAlbumFiles = useCallback(
    async (album: LibraryAlbum): Promise<boolean> => {
      const library = window.echo?.library;

      if (!library?.deleteAlbumFiles) {
        throw new Error(t('library.albums.error.desktopBridge'));
      }

      if (!window.confirm(t('library.albums.confirm.deleteAlbumFiles', { title: album.title, count: album.trackCount }))) {
        return false;
      }

      await library.deleteAlbumFiles(album.id);
      setAlbums((current) => current.filter((item) => item.id !== album.id));
      dispatchPreservedLibraryChange();
      return true;
    },
    [t],
  );

  const handleAlbumMenuAction = useCallback(
    async (action: AlbumMenuAction, album: LibraryAlbum, playlistTarget?: LibraryPlaylist): Promise<void> => {
      const library = window.echo?.library;
      setAlbumMenu(null);

      if (!library) {
        setError(t('library.albums.error.desktopBridge'));
        return;
      }

      try {
        setError(null);
        setStatusMessage(null);

        if (album.mediaType === 'remote' && (action === 'show-in-folder' || action === 'edit-tags' || action === 'delete-album')) {
          setError(t('library.albums.error.remoteEditUnsupported'));
          return;
        }

        switch (action) {
          case 'play-album':
            await playAlbum(album);
            return;
          case 'play-next':
            await playAlbumNext(album);
            return;
          case 'add-to-queue':
            appendTracksToQueue(await getAllAlbumTracks(album.id), { type: 'album' as const, label: album.title, albumId: album.id });
            return;
          case 'add-to-playlist':
            {
              const playlist = playlistTarget;
              if (!playlist) {
                return;
              }

              const tracks = await getAllAlbumTracks(album.id);
              const localTrackIds = tracks.filter((track) => track.mediaType !== 'streaming').map((track) => track.id);
              if (localTrackIds.length === 0) {
                setError('流媒体歌曲不能加入本地歌单，请在流媒体歌单中单独管理。');
                return;
              }

              if (localTrackIds.length > 0) {
                if (library.addTracksToPlaylist) {
                  await library.addTracksToPlaylist(playlist.id, localTrackIds);
                } else {
                  await Promise.all(localTrackIds.map((trackId) => library.addTrackToPlaylist(playlist.id, trackId)));
                }
              }
              window.dispatchEvent(new Event('library:playlists-changed'));
            }
            return;
          case 'toggle-liked':
            {
              const previous = likedAlbumIds[album.id] === true;
              setLikedAlbumIds((current) => ({ ...current, [album.id]: !previous }));
              const result = await library.toggleAlbumLiked(album.id);
              setLikedAlbumIds((current) => ({ ...current, [album.id]: result.liked }));
              window.dispatchEvent(new Event(likedAlbumsChangedEvent));
              window.dispatchEvent(new Event(likedChangedEvent));
            }
            return;
          case 'edit-tags':
            setTagEditorError(null);
            if (tagEditorCloseTimerRef.current !== null) {
              window.clearTimeout(tagEditorCloseTimerRef.current);
              tagEditorCloseTimerRef.current = null;
            }
            setIsTagEditorOpen(false);
            setEditingAlbum(album);
            window.requestAnimationFrame(() => setIsTagEditorOpen(true));
            return;
          case 'show-in-folder':
            await openAlbumInFolder(album);
            return;
          case 'copy-info':
            await library.copyAlbumInfo(album.id);
            setStatusMessage(t('library.albums.message.copiedToClipboard'));
            return;
          case 'copy-title':
            await writeClipboardText(album.title);
            return;
          case 'copy-artist':
            await writeClipboardText(album.albumArtist);
            return;
          case 'copy-path':
            {
              const tracks = await getAllAlbumTracks(album.id);
              const firstTrack = tracks[0];
              if (!firstTrack) {
                throw new Error(t('albumTagEditor.error.noReadableTrack'));
              }
              await writeClipboardText(albumFolderPathFromTrackPath(firstTrack.path));
            }
            return;
          case 'copy-track-list':
            {
              const tracks = await getAllAlbumTracks(album.id);
              if (!tracks.length) {
                throw new Error(t('albumTagEditor.error.noReadableTrack'));
              }
              await writeClipboardText(formatAlbumTrackListForClipboard(album, tracks));
            }
            return;
          case 'copy-cover':
            if (!(await library.copyAlbumCover(album.id))) {
              setError(t('library.albums.error.noCopyableCover'));
            }
            return;
          case 'save-cover':
            if (!(await library.saveAlbumCover(album.id))) {
              setError(t('library.albums.error.coverNotSaved'));
            }
            return;
          case 'delete-album':
            await deleteAlbumFiles(album);
            return;
      }
    } catch (actionError) {
      setStatusMessage(null);
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
    },
    [appendTracksToQueue, deleteAlbumFiles, getAllAlbumTracks, likedAlbumIds, openAlbumInFolder, playAlbum, playAlbumNext, t, writeClipboardText],
  );

  const handleDeleteEditingAlbum = useCallback(
    async (album: LibraryAlbum): Promise<void> => {
      setIsSavingTags(true);
      setTagEditorError(null);

      try {
        const deleted = await deleteAlbumFiles(album);
        if (deleted) {
          closeTagEditor();
        }
      } catch (deleteError) {
        setTagEditorError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      } finally {
        setIsSavingTags(false);
      }
    },
    [closeTagEditor, deleteAlbumFiles],
  );

  const handleSaveAlbumTags = useCallback(
    async (
      album: LibraryAlbum,
      tags: EditableAlbumTags,
      coverPath: string | null,
      coverUrl: string | null,
      coverMimeType: string | null,
    ): Promise<void> => {
      const library = window.echo?.library;

      if (!library) {
        setTagEditorError(t('library.albums.error.desktopBridge'));
        return;
      }

      setIsSavingTags(true);
      setTagEditorError(null);

      try {
        const updatedAlbum = await library.updateAlbumTags({ albumId: album.id, tags, coverPath, coverUrl, coverMimeType });
        setAlbums((current) => current.map((item) => (item.id === album.id ? updatedAlbum : item)));
        closeTagEditor();
      } catch (saveError) {
        setTagEditorError(saveError instanceof Error ? saveError.message : String(saveError));
      } finally {
        setIsSavingTags(false);
      }
    },
    [closeTagEditor, t],
  );

  const handleLoadMoreAlbums = useCallback((): void => {
    if (isLoadingRef.current || !hasMore) {
      return;
    }

    void loadAlbums(page + 1, 'append');
  }, [hasMore, loadAlbums, page]);

  const handleRefresh = useCallback((): void => {
    writeAlbumWallScrollTop(pageRootRef.current, 0);
    void loadAlbums(1, 'replace');
  }, [loadAlbums]);

  const handleAlbumKeyDown = useCallback((event: KeyboardEvent<HTMLElement>, album: LibraryAlbum): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAlbumDetail(album);
    }
  }, [openAlbumDetail]);

  const handleAlbumCoverError = useCallback((album: LibraryAlbum): void => {
    if (!album.coverThumb) {
      return;
    }

    const previousAttempt = coverErrorAttemptsRef.current[album.id];
    const nextCount = previousAttempt?.url === album.coverThumb ? previousAttempt.count + 1 : 1;
    coverErrorAttemptsRef.current[album.id] = { url: album.coverThumb, count: nextCount };

    const retryDelay = albumCoverRetryDelaysMs[nextCount - 1];
    if (typeof retryDelay === 'number') {
      if (!coverRetryTimersRef.current[album.id]) {
        coverRetryTimersRef.current[album.id] = window.setTimeout(() => {
          delete coverRetryTimersRef.current[album.id];
          setCoverRetryKeys((current) => ({
            ...current,
            [album.id]: (current[album.id] ?? 0) + 1,
          }));
        }, retryDelay);
      }
      return;
    }

    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
      console.warn('Failed to load album cover', {
        url: album.coverThumb,
        albumId: album.id,
      });
    }

    setFailedCoverUrls((current) =>
      current[album.id] === album.coverThumb
        ? current
        : {
            ...current,
            [album.id]: album.coverThumb!,
          },
    );
  }, []);

  const handleAlbumCoverLoad = useCallback((album: LibraryAlbum): void => {
    if (!album.coverThumb) {
      return;
    }

    const retryTimer = coverRetryTimersRef.current[album.id];
    if (retryTimer) {
      window.clearTimeout(retryTimer);
      delete coverRetryTimersRef.current[album.id];
    }

    const previousAttempt = coverErrorAttemptsRef.current[album.id];
    if (previousAttempt?.url === album.coverThumb) {
      delete coverErrorAttemptsRef.current[album.id];
    }

    setFailedCoverUrls((current) => {
      if (current[album.id] !== album.coverThumb) {
        return current;
      }

      const next = { ...current };
      delete next[album.id];
      return next;
    });
  }, []);

  const albumWallColumnCount = useMemo(() => {
    const availableWidth = Math.max(0, albumWallViewportWidth - albumWallPaddingRightPx);

    if (availableWidth <= 0) {
      return 1;
    }

    return Math.max(1, Math.floor((availableWidth + albumWallGridGapPx) / (albumWallMinCardWidthPx + albumWallGridGapPx)));
  }, [albumWallViewportWidth]);

  const albumWallEstimatedCardWidth = useMemo(() => {
    const availableWidth = Math.max(
      albumWallMinCardWidthPx,
      albumWallViewportWidth - albumWallPaddingRightPx - albumWallGridGapPx * (albumWallColumnCount - 1),
    );

    return Math.max(albumWallMinCardWidthPx, availableWidth / albumWallColumnCount);
  }, [albumWallColumnCount, albumWallViewportWidth]);
  const albumWallEstimatedRowHeight = Math.ceil(Math.max(albumWallVirtualMinRowHeightPx, albumWallEstimatedCardWidth + albumWallVirtualCopyHeightPx));
  const albumWallVirtualRowCount = albumWallVirtualizationEnabled ? Math.ceil(albums.length / albumWallColumnCount) : 0;
  const albumWallVirtualizer = useVirtualizer({
    count: albumWallVirtualRowCount,
    getScrollElement: () => getPageScrollContainer(pageRootRef.current),
    estimateSize: () => albumWallEstimatedRowHeight,
    overscan: albumWallVirtualOverscanRows,
  });
  const albumWallVirtualRows = albumWallVirtualizer.getVirtualItems();
  const renderedAlbumWallVirtualRows =
    albumWallVirtualizationEnabled && albumWallVirtualRows.length > 0
      ? albumWallVirtualRows
      : albumWallVirtualizationEnabled
        ? Array.from({ length: Math.min(albumWallVirtualRowCount, albumWallVirtualFallbackRows) }, (_, index) => ({
            index,
            key: `album-wall-fallback-${index}`,
            start: index * albumWallEstimatedRowHeight,
          }))
        : [];
  const lastAlbumWallVirtualRowIndex = renderedAlbumWallVirtualRows.at(-1)?.index ?? -1;
  const albumWallVirtualTotalSize = Math.max(albumWallVirtualizer.getTotalSize(), albumWallVirtualRowCount * albumWallEstimatedRowHeight);
  const albumWallVirtualSectionStyle = {
    height: albumWallVirtualTotalSize,
    '--album-wall-columns': albumWallColumnCount,
    '--album-wall-row-height': `${albumWallEstimatedRowHeight}px`,
  } as CSSProperties;

  useLayoutEffect(() => {
    if (!albumWallVirtualizationEnabled) {
      return undefined;
    }

    const element = pageRootRef.current;

    if (!element) {
      return undefined;
    }

    const updateWidth = (): void => {
      const nextWidth = Math.max(0, Math.floor(element.clientWidth));
      setAlbumWallViewportWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    updateWidth();

    if (typeof window.ResizeObserver === 'function') {
      const observer = new window.ResizeObserver(() => updateWidth());
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [albumWallVirtualizationEnabled]);

  useLayoutEffect(() => {
    if (!albumWallVirtualizationEnabled) {
      return;
    }

    writeAlbumWallScrollTop(pageRootRef.current, readAlbumWallScrollTop(pageRootRef.current));
  }, [albumWallVirtualizationEnabled]);

  useEffect(() => {
    if (!albumWallVirtualizationEnabled) {
      return undefined;
    }

    const pageSurface = pageRootRef.current?.closest('.page-surface') as HTMLElement | null;

    if (!pageSurface || typeof window.MutationObserver !== 'function') {
      return undefined;
    }

    const normalizeVisibleScroll = (): void => {
      if (pageSurface.hidden) {
        return;
      }

      writeAlbumWallScrollTop(pageRootRef.current, readPageScrollTop(pageRootRef.current));
    };

    normalizeVisibleScroll();

    const observer = new window.MutationObserver(normalizeVisibleScroll);
    observer.observe(pageSurface, { attributes: true, attributeFilter: ['hidden'] });
    return () => observer.disconnect();
  }, [albumWallVirtualizationEnabled]);

  useEffect(() => {
    if (!isLoading) {
      albumWallVirtualLoadRequestedRef.current = false;
    }
  }, [albums.length, isLoading]);

  useEffect(() => {
    if (!albumWallVirtualizationEnabled || !hasMore || isLoading || albumWallVirtualRowCount <= 0 || albumWallVirtualLoadRequestedRef.current) {
      return;
    }

    const loadAheadBoundary = Math.max(0, albumWallVirtualRowCount - albumWallVirtualLoadAheadRows);

    if (lastAlbumWallVirtualRowIndex < loadAheadBoundary) {
      return;
    }

    albumWallVirtualLoadRequestedRef.current = true;
    handleLoadMoreAlbums();
  }, [albumWallVirtualizationEnabled, albumWallVirtualRowCount, handleLoadMoreAlbums, hasMore, isLoading, lastAlbumWallVirtualRowIndex]);

  const renderAlbumCard = (album: LibraryAlbum, index: number): JSX.Element => {
    const shouldShowCover = Boolean(album.coverThumb && failedCoverUrls[album.id] !== album.coverThumb);
    const isPriorityCover = index < priorityAlbumWallImageCount;

    return (
      <article
        className="album-card"
        key={album.id}
        role="button"
        tabIndex={0}
        onClick={() => openAlbumDetail(album)}
        onContextMenu={(event) => handleOpenAlbumMenu(event, album)}
        onKeyDown={(event) => handleAlbumKeyDown(event, album)}
      >
        <div className="album-cover" data-empty={!shouldShowCover} aria-hidden="true">
          {shouldShowCover ? (
            <DeferredWallImage
              key={`${album.coverThumb}:${coverRetryKeys[album.id] ?? 0}`}
              alt=""
              decoding="async"
              draggable={false}
              height={320}
              loading={isPriorityCover ? 'eager' : 'lazy'}
              paused={pauseDeferredAlbumImages}
              priority={isPriorityCover}
              rootMargin={albumWallImageLoadAheadMargin}
              src={album.coverThumb!}
              width={320}
              onError={() => handleAlbumCoverError(album)}
              onLoad={() => handleAlbumCoverLoad(album)}
            />
          ) : (
            <Disc3 size={24} />
          )}
        </div>
        <div className="album-copy">
          <strong>{album.title}</strong>
          <div className="album-meta-row">
            <span>{album.albumArtist}</span>
            <small>{t('library.albums.card.tracks', { count: album.trackCount })}</small>
          </div>
          {album.mediaType === 'remote' ? <small className="remote-media-source">{album.sourceDisplayName ?? album.provider ?? t('library.source.remote')}</small> : null}
        </div>
      </article>
    );
  };

  useEffect(() => {
    return () => {
      if (albumWallReturnTimerRef.current !== null) {
        window.clearTimeout(albumWallReturnTimerRef.current);
      }
      if (sourceRouteReturnCloseTimerRef.current !== null) {
        window.clearTimeout(sourceRouteReturnCloseTimerRef.current);
      }
      Object.values(coverRetryTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      coverRetryTimersRef.current = {};
    };
  }, []);

  return (
    <>
      {selectedAlbum ? <AlbumDetailView album={selectedAlbum} onBack={handleBackFromAlbumDetail} /> : null}
      <div
        className="albums-page"
        data-detail-open={selectedAlbum ? 'true' : 'false'}
        data-detail-returning={isAlbumWallReturning ? 'true' : undefined}
        aria-hidden={selectedAlbum ? 'true' : undefined}
      >
        <header className="songs-header">
          <div className="songs-title-group">
            <h1>{t('library.albums.title')}</h1>
            <span>{t('library.count.total', { count: total })}</span>
          </div>
          <button className="tool-button album-refresh" type="button" aria-label={t('library.action.refresh')} title={t('library.action.refresh')} onClick={handleRefresh}>
            <RefreshCw size={17} />
          </button>
        </header>

      <div className="songs-control-row">
        <label className="search-box">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            placeholder={t('library.albums.searchPlaceholder')}
            {...searchInputProps}
          />
        </label>

        <LibrarySourceSwitch value={sourceMode} onChange={setSourceMode} />
        {sourceMode === 'remote' ? <RemoteSourceFilter sources={remoteSources} value={remoteSourceId} onChange={setRemoteSourceId} /> : null}

        <div className="sort-select" ref={sortMenuRef}>
          <button
            className="sort-button"
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isSortOpen}
            onClick={() => setIsSortOpen((current) => !current)}
          >
            <ListFilter className="sort-button-icon" size={16} aria-hidden="true" />
            <span className="sort-button-label">{t(albumSortOptions.find((option) => option.value === sort)?.labelKey ?? 'library.sort.default')}</span>
            <ChevronDown className="sort-button-chevron" size={15} aria-hidden="true" />
          </button>
          {isSortOpen ? (
            <div className="sort-menu" role="listbox" aria-label={t('library.albums.sort.aria')}>
              {albumSortOptions.map((option) => (
                <button
                  key={option.value}
                  className="sort-option"
                  type="button"
                  role="option"
                  aria-selected={sort === option.value}
                  onClick={() => {
                    setSort(option.value);
                    setIsSortOpen(false);
                  }}
                >
                  <span>{t(option.labelKey)}</span>
                  {sort === option.value ? <Check size={14} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div ref={pageRootRef} className="media-wall-scroll-shell page-scroll-container">
        {albumWallVirtualizationEnabled ? (
          <section
            className="album-wall album-wall--virtualized"
            aria-label={t('library.albums.listAria')}
            data-virtualized="true"
            data-estimated-row-height={String(albumWallEstimatedRowHeight)}
            data-column-count={albumWallColumnCount}
            style={albumWallVirtualSectionStyle}
          >
            {renderedAlbumWallVirtualRows.map((virtualRow) => {
              const rowStartIndex = virtualRow.index * albumWallColumnCount;
              const rowAlbums = albums.slice(rowStartIndex, rowStartIndex + albumWallColumnCount);

              return (
                <div
                  className="album-wall-virtual-row"
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="album-wall-virtual-grid">
                    {rowAlbums.map((album, offset) => renderAlbumCard(album, rowStartIndex + offset))}
                  </div>
                </div>
              );
            })}
          </section>
        ) : (
          <section className="album-wall" aria-label={t('library.albums.listAria')}>
            {albums.map((album, index) => renderAlbumCard(album, index))}
          </section>
        )}
        {albumWallVirtualizationEnabled ? null : (
          <InfiniteScrollSentinel
            canLoadMore={hasMore}
            fallbackDistance={albumWallLoadAheadDistancePx}
            isLoading={isLoading}
            onLoadMore={handleLoadMoreAlbums}
            rootMargin={`${albumWallLoadAheadDistancePx}px 0px`}
          />
        )}

        {error || statusMessage || isLoading ? (
          <div className="list-footer">
            <span>{error ?? statusMessage ?? t('library.albums.loading')}</span>
          </div>
        ) : null}
      </div>
      {albumMenu ? (
        <AlbumContextMenu
          album={albumMenu.album}
          position={albumMenu.position}
          liked={likedAlbumIds[albumMenu.album.id] === true}
          onAction={(action, album, playlist) => void handleAlbumMenuAction(action, album, playlist)}
          onClose={() => setAlbumMenu(null)}
        />
      ) : null}
      <AlbumTagEditorDrawer
        album={editingAlbum}
        isOpen={isTagEditorOpen}
        isSaving={isSavingTags}
        error={tagEditorError}
        onClose={closeTagEditor}
        onDeleteAlbum={handleDeleteEditingAlbum}
        onOpenInFolder={openAlbumInFolder}
        onSave={(album, tags, coverPath, coverUrl, coverMimeType) => void handleSaveAlbumTags(album, tags, coverPath, coverUrl, coverMimeType)}
      />
      </div>
    </>
  );
};
