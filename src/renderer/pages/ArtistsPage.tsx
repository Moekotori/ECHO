import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Image as ImageIcon, ImagePlus, Link, ListFilter, Play, RefreshCw, RotateCcw, Search } from 'lucide-react';
import type { LibraryArtist, LibrarySort } from '../../shared/types/library';
import type { RemoteSource } from '../../shared/types/remoteSources';
import { ArtistDetailView } from '../components/artist/ArtistDetailView';
import { artistMark } from '../components/artist/artistVisual';
import { LibrarySourceSwitch } from '../components/library/LibrarySourceSwitch';
import { RemoteSourceFilter } from '../components/library/RemoteSourceFilter';
import { DeferredWallImage, useScrollImagePause } from '../components/ui/DeferredWallImage';
import { InfiniteScrollSentinel, readPageScrollTop, writePageScrollTop } from '../components/ui/InfiniteScrollSentinel';
import { MediaWallScrollSpacer, useMediaWallScrollSpacer } from '../components/ui/MediaWallScrollSpacer';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import type { DetailReturnTarget } from '../utils/albumNavigation';
import { artistDetailNavigationEvent, consumePendingArtistDetailNavigation } from '../utils/artistNavigation';
import { getRemoteSourcesBridge } from '../utils/echoBridge';
import { useImeAwareDebouncedSearch } from '../utils/imeInput';
import { readStoredLibrarySort, writeStoredLibrarySort } from '../utils/librarySortMemory';
import { readStoredLibrarySourceMode, writeStoredLibrarySourceMode, type LibrarySourceMode } from '../utils/librarySourceMode';

const pageSize = 96;
const artistWallReturnAnimationMs = 80;
const priorityArtistWallImageCount = 32;
const maxPreservedRefreshPageSize = 500;
const preserveScrollThresholdPx = 80;
const isPreserveScrollLibraryEvent = (event: Event): boolean =>
  event instanceof CustomEvent && event.detail && typeof event.detail === 'object' && event.detail.preserveScroll === true;
const artistSortOptions: Array<{ value: LibrarySort; labelKey: TranslationKey }> = [
  { value: 'default', labelKey: 'library.sort.default' },
  { value: 'titleAsc', labelKey: 'library.artists.sort.nameAsc' },
  { value: 'titleDesc', labelKey: 'library.artists.sort.nameDesc' },
  { value: 'frequent', labelKey: 'library.artists.sort.frequent' },
  { value: 'createdAsc', labelKey: 'library.sort.createdAsc' },
  { value: 'createdDesc', labelKey: 'library.sort.createdDesc' },
  { value: 'random', labelKey: 'library.sort.random' },
];
const artistsSortStorageKey = 'echo-next.artists.sort';
const validArtistSortValues = new Set<LibrarySort>(artistSortOptions.map((option) => option.value));

const hasArtistAvatar = (artist: LibraryArtist): boolean => Boolean(artist.avatarUrl || artist.avatarThumbUrl);

const prioritizeArtistsWithAvatars = (items: LibraryArtist[]): LibraryArtist[] =>
  [...items].sort((left, right) => Number(hasArtistAvatar(right)) - Number(hasArtistAvatar(left)));

const versionedArtistImageUrl = (imageUrl: string | null, version: number | undefined): string | null => {
  if (!imageUrl || !version || !imageUrl.startsWith('echo-artist-image://')) {
    return imageUrl;
  }

  return `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}v=${version}`;
};

const artistMeta = (artist: LibraryArtist, t: (key: TranslationKey, options?: Record<string, string | number>) => string): string => {
  const parts: string[] = [];

  if (artist.trackCount > 0) {
    parts.push(t('library.artists.meta.tracks', { count: artist.trackCount }));
  }

  if (artist.albumCount > 0) {
    parts.push(t('library.artists.meta.albums', { count: artist.albumCount }));
  }

  return parts.join(' / ') || t('library.artists.meta.noTracks');
};

type ArtistAvatarMenuAction = 'choose-file' | 'set-url' | 'clear-custom';

type ArtistAvatarContextMenuProps = {
  artist: LibraryArtist;
  position: { x: number; y: number };
  onAction: (action: ArtistAvatarMenuAction, artist: LibraryArtist) => void;
  onClose: () => void;
};

const menuViewportPadding = 8;
const menuPointerOffset = 6;
const artistAvatarMenuWidth = 226;

const clampMenuPosition = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

const ArtistAvatarContextMenu = ({ artist, position, onAction, onClose }: ArtistAvatarContextMenuProps): JSX.Element => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState(() => ({
    x: position.x + menuPointerOffset,
    y: position.y + menuPointerOffset,
  }));

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    setMenuPosition({
      x: clampMenuPosition(position.x + menuPointerOffset, menuViewportPadding, window.innerWidth - rect.width - menuViewportPadding),
      y: clampMenuPosition(position.y + menuPointerOffset, menuViewportPadding, window.innerHeight - rect.height - menuViewportPadding),
    });
  }, [position.x, position.y]);

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

  return createPortal(
    <div className="album-menu-layer" role="presentation" onMouseDown={onClose}>
      <div
        ref={menuRef}
        className="album-context-menu artist-avatar-context-menu"
        role="menu"
        style={{ left: menuPosition.x, top: menuPosition.y, width: artistAvatarMenuWidth }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="album-menu-item" role="menuitem" type="button" onClick={() => onAction('choose-file', artist)}>
          <ImagePlus size={16} />
          <span>设置头像</span>
        </button>
        <button className="album-menu-item" role="menuitem" type="button" onClick={() => onAction('set-url', artist)}>
          <Link size={16} />
          <span>从网络加载头像</span>
        </button>
        {artist.avatarProvider === 'manual' ? (
          <button className="album-menu-item" role="menuitem" type="button" onClick={() => onAction('clear-custom', artist)}>
            <RotateCcw size={16} />
            <span>恢复自动头像</span>
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};

export const ArtistsPage = (): JSX.Element => {
  const { t } = useI18n();
  const [artists, setArtists] = useState<LibraryArtist[]>([]);
  const [total, setTotal] = useState(0);
  const { search, searchInputProps } = useImeAwareDebouncedSearch(250);
  const [sort, setSort] = useState<LibrarySort>(() => readStoredLibrarySort(artistsSortStorageKey, validArtistSortValues));
  const [sourceMode, setSourceModeState] = useState<LibrarySourceMode>(() => readStoredLibrarySourceMode());
  const [remoteSourceId, setRemoteSourceId] = useState<string | null>(null);
  const [remoteSources, setRemoteSources] = useState<RemoteSource[]>([]);
  const [prioritizeArtistAvatars, setPrioritizeArtistAvatars] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [initialArtistDetailRequest] = useState(() => consumePendingArtistDetailNavigation());
  const [selectedArtist, setSelectedArtist] = useState<LibraryArtist | null>(() => initialArtistDetailRequest?.artist ?? null);
  const [selectedArtistReturnTo, setSelectedArtistReturnTo] = useState<DetailReturnTarget | null>(() => initialArtistDetailRequest?.returnTo ?? null);
  const [isArtistWallReturning, setIsArtistWallReturning] = useState(false);
  const [artistWallAlbumArtwork, setArtistWallAlbumArtwork] = useState(false);
  const [artistWallAlbumFallbackForMissingAvatars, setArtistWallAlbumFallbackForMissingAvatars] = useState(false);
  const [artistImagesAutoFetch, setArtistImagesAutoFetch] = useState(false);
  const [artistAvatarMenu, setArtistAvatarMenu] = useState<{ artist: LibraryArtist; position: { x: number; y: number } } | null>(null);
  const [artistAvatarVersions, setArtistAvatarVersions] = useState<Record<string, number>>({});
  const [failedAvatarUrls, setFailedAvatarUrls] = useState<Record<string, string>>({});
  const [failedCoverUrls, setFailedCoverUrls] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const pageScrollTopRef = useRef(0);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const shouldRestorePageScrollRef = useRef(false);
  const requestIdRef = useRef(0);
  const isLoadingRef = useRef(false);
  const artistWallReturnTimerRef = useRef<number | null>(null);
  const sourceRouteReturnCloseTimerRef = useRef<number | null>(null);
  const requestedArtistImageIdsRef = useRef(new Set<string>());
  const pauseDeferredArtistImages = useScrollImagePause(pageRootRef);
  const { wallRef: artistWallRef, spacerHeight } = useMediaWallScrollSpacer<HTMLElement>({
    itemCount: artists.length,
    totalCount: total,
    minColumnWidth: 128,
    columnGap: 22,
    rowGap: 30,
    estimatedItemHeight: 174,
  });

  useEffect(() => {
    if (!isSortOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!sortMenuRef.current?.contains(event.target as Node)) {
        setIsSortOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isSortOpen]);

  useEffect(
    () => () => {
      if (artistWallReturnTimerRef.current !== null) {
        window.clearTimeout(artistWallReturnTimerRef.current);
      }
      if (sourceRouteReturnCloseTimerRef.current !== null) {
        window.clearTimeout(sourceRouteReturnCloseTimerRef.current);
      }
    },
    [],
  );

  const loadArtists = useCallback(
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

        if (!library?.getArtists) {
          setArtists([]);
          setPage(1);
          setTotal(0);
          setHasMore(false);
          setError(t('library.artists.error.desktopBridge'));
          return;
        }

        const result = await library.getArtists({
          page: nextPage,
          pageSize: options.pageSizeOverride ?? pageSize,
          search,
          sort,
          sourceProvider: sourceMode,
          ...(sourceMode === 'remote' && remoteSourceId ? { sourceId: remoteSourceId } : {}),
          ...(prioritizeArtistAvatars ? { prioritizeArtistAvatars: true } : {}),
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        setArtists((current) => {
          const next = mode === 'append' ? [...current, ...result.items] : result.items;
          return prioritizeArtistAvatars ? prioritizeArtistsWithAvatars(next) : next;
        });
        setPage(options.pageSizeOverride && mode === 'replace' ? Math.max(1, Math.ceil(result.items.length / pageSize)) : result.page);
        setTotal(result.total);
        setHasMore(result.hasMore);
        if (typeof options.restoreScrollTop === 'number') {
          const restoreScrollTop = options.restoreScrollTop;
          window.setTimeout(() => writePageScrollTop(pageRootRef.current, restoreScrollTop), 0);
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
    [prioritizeArtistAvatars, remoteSourceId, search, sort, sourceMode, t],
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
    void loadArtists(1, 'replace');
  }, [loadArtists]);

  useEffect(() => {
    writeStoredLibrarySort(artistsSortStorageKey, sort);
  }, [sort]);

  useEffect(() => {
    void refreshRemoteSources();

    const handleRemoteSourcesChanged = (): void => {
      void refreshRemoteSources();
    };

    window.addEventListener('library:changed', handleRemoteSourcesChanged);
    return () => window.removeEventListener('library:changed', handleRemoteSourcesChanged);
  }, [refreshRemoteSources]);

  useEffect(() => {
    const handleLibraryChanged = (event: Event): void => {
      const scrollTop = readPageScrollTop(pageRootRef.current);
      if (isPreserveScrollLibraryEvent(event) && scrollTop > preserveScrollThresholdPx) {
        void loadArtists(1, 'replace', {
          pageSizeOverride: Math.min(maxPreservedRefreshPageSize, Math.max(pageSize, page * pageSize, artists.length)),
          restoreScrollTop: scrollTop,
        });
        return;
      }

      writePageScrollTop(pageRootRef.current, 0);
      void loadArtists(1, 'replace');
    };

    window.addEventListener('library:changed', handleLibraryChanged);
    return () => window.removeEventListener('library:changed', handleLibraryChanged);
  }, [artists.length, loadArtists, page]);

  useLayoutEffect(() => {
    writePageScrollTop(pageRootRef.current, 0);
  }, [prioritizeArtistAvatars, search, sort, sourceMode]);

  useLayoutEffect(() => {
    if (selectedArtist || !shouldRestorePageScrollRef.current) {
      return;
    }

    writePageScrollTop(pageRootRef.current, pageScrollTopRef.current);
    shouldRestorePageScrollRef.current = false;
  }, [selectedArtist]);

  useEffect(() => {
    const loadSettings = (): void => {
      const app = window.echo?.app;

      if (!app?.getSettings) {
        setArtistWallAlbumArtwork(false);
        setArtistWallAlbumFallbackForMissingAvatars(false);
        return;
      }

      void app
        .getSettings()
        .then((settings) => {
          setArtistWallAlbumArtwork(settings.artistWallAlbumArtwork === true);
          setArtistWallAlbumFallbackForMissingAvatars(settings.artistWallAlbumFallbackForMissingAvatars === true);
          setArtistImagesAutoFetch(settings.autoFetchArtistImages === true);
        })
        .catch(() => {
          setArtistWallAlbumArtwork(false);
          setArtistWallAlbumFallbackForMissingAvatars(false);
          setArtistImagesAutoFetch(false);
        });
    };

    loadSettings();
    window.addEventListener('settings:changed', loadSettings);
    return () => window.removeEventListener('settings:changed', loadSettings);
  }, []);

  const handleLoadMoreArtists = useCallback((): void => {
    if (isLoadingRef.current || !hasMore) {
      return;
    }

    void loadArtists(page + 1, 'append');
  }, [hasMore, loadArtists, page]);

  const handleRefresh = useCallback((): void => {
    writePageScrollTop(pageRootRef.current, 0);
    void loadArtists(1, 'replace');
  }, [loadArtists]);

  const applyUpdatedArtist = useCallback((updatedArtist: LibraryArtist): void => {
    setArtistAvatarVersions((current) => ({
      ...current,
      [updatedArtist.id]: (current[updatedArtist.id] ?? 0) + 1,
    }));
    setFailedAvatarUrls((current) => {
      if (!(updatedArtist.id in current)) {
        return current;
      }

      const next = { ...current };
      delete next[updatedArtist.id];
      return next;
    });
    setFailedCoverUrls((current) => {
      if (!(updatedArtist.id in current)) {
        return current;
      }

      const next = { ...current };
      delete next[updatedArtist.id];
      return next;
    });
    setArtists((current) => {
      let changed = false;
      const next = current.map((artist) => {
        if (artist.id !== updatedArtist.id) {
          return artist;
        }

        changed = true;
        return updatedArtist;
      });

      return changed ? (prioritizeArtistAvatars ? prioritizeArtistsWithAvatars(next) : next) : current;
    });
    setSelectedArtist((current) => (current?.id === updatedArtist.id ? updatedArtist : current));
  }, [prioritizeArtistAvatars]);

  useEffect(() => {
    const library = window.echo?.library;

    if (!library?.onArtistImagesUpdated || !library?.getArtist) {
      return undefined;
    }

    return library.onArtistImagesUpdated((payload) => {
      if (!payload.artistId) {
        return;
      }

      void library
        .getArtist(payload.artistId)
        .then((updatedArtist) => {
          if (updatedArtist) {
            applyUpdatedArtist(updatedArtist);
          }
        })
        .catch(() => undefined);
    });
  }, [applyUpdatedArtist]);

  useEffect(() => {
    if (!artistImagesAutoFetch || artists.length === 0) {
      return;
    }

    const library = window.echo?.library;
    if (!library?.refreshVisibleArtistImages) {
      return;
    }

    const candidates = artists
      .filter((artist) => {
        if (artist.avatarThumbUrl || requestedArtistImageIdsRef.current.has(artist.id)) {
          return false;
        }

        return artist.avatarStatus !== 'not_found' && artist.avatarStatus !== 'error' && artist.avatarStatus !== 'rate_limited';
      })
      .slice(0, pageSize);

    if (candidates.length === 0) {
      return;
    }

    for (const artist of candidates) {
      requestedArtistImageIdsRef.current.add(artist.id);
    }

    void library.refreshVisibleArtistImages(candidates.map((artist) => ({ id: artist.id, name: artist.name }))).catch(() => undefined);
  }, [artistImagesAutoFetch, artists]);

  const handleArtistCoverError = useCallback((artist: LibraryArtist, failedUrl: string | null): void => {
    if (!failedUrl) {
      return;
    }

    setFailedCoverUrls((current) =>
      current[artist.id] === failedUrl
        ? current
        : {
            ...current,
            [artist.id]: failedUrl,
          },
    );
  }, []);

  const handleArtistAvatarError = useCallback((artist: LibraryArtist, failedUrl: string | null): void => {
    if (!failedUrl) {
      return;
    }

    setFailedAvatarUrls((current) =>
      current[artist.id] === failedUrl
        ? current
        : {
            ...current,
            [artist.id]: failedUrl,
          },
    );
  }, []);

  const handleRefreshArtistAvatar = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, artist: LibraryArtist): void => {
      event.preventDefault();
      event.stopPropagation();

      if (!artistImagesAutoFetch) {
        return;
      }

      const library = window.echo?.library;
      if (!library?.refreshArtistImage || !library?.getArtist) {
        return;
      }

      setFailedAvatarUrls((current) => {
        const next = { ...current };
        delete next[artist.id];
        return next;
      });

      void library
        .refreshArtistImage(artist.id, true)
        .then(() => library.getArtist(artist.id))
        .then((updatedArtist) => {
          if (updatedArtist) {
            applyUpdatedArtist(updatedArtist);
          }
        })
        .catch(() => undefined);
    },
    [applyUpdatedArtist, artistImagesAutoFetch],
  );

  const reloadArtistAfterAvatarChange = useCallback(
    async (artist: LibraryArtist): Promise<void> => {
      const library = window.echo?.library;
      if (!library?.getArtist) {
        return;
      }

      setFailedAvatarUrls((current) => {
        const next = { ...current };
        delete next[artist.id];
        return next;
      });
      setFailedCoverUrls((current) => {
        const next = { ...current };
        delete next[artist.id];
        return next;
      });

      const updatedArtist = await library.getArtist(artist.id);
      if (updatedArtist) {
        applyUpdatedArtist(updatedArtist);
      }
    },
    [applyUpdatedArtist],
  );

  const handleArtistAvatarContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, artist: LibraryArtist): void => {
    event.preventDefault();
    event.stopPropagation();
    setArtistAvatarMenu({
      artist,
      position: { x: event.clientX, y: event.clientY },
    });
  }, []);

  const handleArtistAvatarMenuAction = useCallback(
    (action: ArtistAvatarMenuAction, artist: LibraryArtist): void => {
      setArtistAvatarMenu(null);
      const library = window.echo?.library;

      if (!library) {
        setError('当前运行环境不支持设置艺术家头像。');
        return;
      }

      const run = async (): Promise<void> => {
        if (action === 'choose-file') {
          if (!library.chooseArtistAvatar) {
            throw new Error('当前运行环境不支持选择艺术家头像。');
          }
          const entry = await library.chooseArtistAvatar(artist.id);
          if (!entry) {
            return;
          }
          await reloadArtistAfterAvatarChange(artist);
          return;
        }

        if (action === 'set-url') {
          if (!library.setArtistAvatarFromUrl) {
            throw new Error('当前运行环境不支持从网络设置艺术家头像。');
          }
          const url = window.prompt('输入头像图片 URL', '');
          if (!url?.trim()) {
            return;
          }
          await library.setArtistAvatarFromUrl(artist.id, url.trim());
          await reloadArtistAfterAvatarChange(artist);
          return;
        }

        if (!library.clearCustomArtistAvatar) {
          throw new Error('当前运行环境不支持恢复自动头像。');
        }
        await library.clearCustomArtistAvatar(artist.id);
        if (artistImagesAutoFetch && library.refreshArtistImage) {
          await library.refreshArtistImage(artist.id, true).catch(() => undefined);
        }
        await reloadArtistAfterAvatarChange(artist);
      };

      void run().catch((avatarError) => {
        setError(avatarError instanceof Error ? avatarError.message : String(avatarError));
      });
    },
    [artistImagesAutoFetch, reloadArtistAfterAvatarChange],
  );

  const openArtistDetail = useCallback((artist: LibraryArtist, returnTo: DetailReturnTarget | null = null): void => {
    if (artistWallReturnTimerRef.current !== null) {
      window.clearTimeout(artistWallReturnTimerRef.current);
      artistWallReturnTimerRef.current = null;
    }
    setIsArtistWallReturning(false);
    pageScrollTopRef.current = readPageScrollTop(pageRootRef.current);
    shouldRestorePageScrollRef.current = !returnTo;
    setSelectedArtistReturnTo(returnTo);
    setSelectedArtist(artist);
  }, []);

  const closeArtistDetail = useCallback((showReturnAnimation = false): void => {
    if (sourceRouteReturnCloseTimerRef.current !== null) {
      window.clearTimeout(sourceRouteReturnCloseTimerRef.current);
      sourceRouteReturnCloseTimerRef.current = null;
    }

    setSelectedArtistReturnTo(null);
    setSelectedArtist(null);

    if (!showReturnAnimation) {
      return;
    }

    if (artistWallReturnTimerRef.current !== null) {
      window.clearTimeout(artistWallReturnTimerRef.current);
    }

    setIsArtistWallReturning(true);
    artistWallReturnTimerRef.current = window.setTimeout(() => {
      artistWallReturnTimerRef.current = null;
      setIsArtistWallReturning(false);
    }, artistWallReturnAnimationMs);
  }, []);

  const closeArtistDetailAfterSourceRouteSwitch = useCallback((): void => {
    if (sourceRouteReturnCloseTimerRef.current !== null) {
      window.clearTimeout(sourceRouteReturnCloseTimerRef.current);
    }

    sourceRouteReturnCloseTimerRef.current = window.setTimeout(() => {
      sourceRouteReturnCloseTimerRef.current = null;
      closeArtistDetail();
    }, 0);
  }, [closeArtistDetail]);

  useEffect(() => {
    const pendingRequest = consumePendingArtistDetailNavigation();
    if (pendingRequest) {
      openArtistDetail(pendingRequest.artist, pendingRequest.returnTo ?? null);
    }

    const handleNavigateArtistDetail = (event: Event): void => {
      const request = (event as CustomEvent<{ artist?: LibraryArtist; returnTo?: DetailReturnTarget }>).detail;
      if (request?.artist) {
        consumePendingArtistDetailNavigation();
        openArtistDetail(request.artist, request.returnTo ?? null);
      }
    };

    window.addEventListener(artistDetailNavigationEvent, handleNavigateArtistDetail);
    return () => window.removeEventListener(artistDetailNavigationEvent, handleNavigateArtistDetail);
  }, [openArtistDetail]);

  const handleBackFromArtistDetail = useCallback((): void => {
    if (selectedArtistReturnTo === 'albums') {
      window.dispatchEvent(new CustomEvent('app:navigate:route', { detail: 'albums' }));
      closeArtistDetailAfterSourceRouteSwitch();
      return;
    }

    if (selectedArtistReturnTo === 'history') {
      window.dispatchEvent(new CustomEvent('app:navigate:route', { detail: 'history' }));
      closeArtistDetailAfterSourceRouteSwitch();
      return;
    }

    if (selectedArtistReturnTo === 'home') {
      window.dispatchEvent(new CustomEvent('app:navigate:route', { detail: 'home' }));
      closeArtistDetailAfterSourceRouteSwitch();
      return;
    }

    if (selectedArtistReturnTo === 'songs') {
      window.dispatchEvent(new Event('app:navigate:songs'));
      closeArtistDetailAfterSourceRouteSwitch();
      return;
    }

    closeArtistDetail(true);
  }, [closeArtistDetail, closeArtistDetailAfterSourceRouteSwitch, selectedArtistReturnTo]);

  const handleArtistKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>, artist: LibraryArtist): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openArtistDetail(artist);
    }
  }, [openArtistDetail]);

  return (
    <>
      {selectedArtist ? <ArtistDetailView artist={selectedArtist} onBack={handleBackFromArtistDetail} /> : null}
      {artistAvatarMenu ? (
        <ArtistAvatarContextMenu
          artist={artistAvatarMenu.artist}
          position={artistAvatarMenu.position}
          onAction={handleArtistAvatarMenuAction}
          onClose={() => setArtistAvatarMenu(null)}
        />
      ) : null}
      <div
        className="artists-page"
        data-detail-open={selectedArtist ? 'true' : 'false'}
        data-detail-returning={isArtistWallReturning ? 'true' : undefined}
        aria-hidden={selectedArtist ? 'true' : undefined}
      >
      <header className="songs-header">
        <div className="songs-title-group">
          <h1>{t('library.artists.title')}</h1>
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
            placeholder={t('library.artists.searchPlaceholder')}
            {...searchInputProps}
          />
        </label>

        <div className="artist-control-actions">
          <button
            className="sort-button artist-avatar-priority-toggle"
            type="button"
            aria-pressed={prioritizeArtistAvatars}
            title={t('library.artists.avatarPriority')}
            onClick={() => setPrioritizeArtistAvatars((current) => !current)}
          >
            <ImageIcon className="sort-button-icon" size={16} aria-hidden="true" />
            <span className="sort-button-label">{t('library.artists.avatarPriority')}</span>
          </button>

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
              <span className="sort-button-label">{t(artistSortOptions.find((option) => option.value === sort)?.labelKey ?? 'library.sort.default')}</span>
              <ChevronDown className="sort-button-chevron" size={15} aria-hidden="true" />
            </button>
            {isSortOpen ? (
              <div className="sort-menu" role="listbox" aria-label={t('library.artists.sort.aria')}>
                {artistSortOptions.map((option) => (
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
      </div>

      <div ref={pageRootRef} className="media-wall-scroll-shell page-scroll-container">
        <section ref={artistWallRef} className="artist-wall" aria-label={t('library.artists.listAria')}>
          {artists.map((artist, index) => {
            const avatarVersion = artistAvatarVersions[artist.id];
            const avatarImageUrl = versionedArtistImageUrl(artist.avatarUrl ?? artist.avatarThumbUrl ?? null, avatarVersion);
            const coverImageUrl = artist.coverSource === 'default' ? null : artist.coverThumb;
            const shouldShowAvatar = Boolean(
              avatarImageUrl && failedAvatarUrls[artist.id] !== avatarImageUrl,
            );
            const shouldUseMissingAvatarFallback = artist.avatarStatus === 'not_found'
              || artist.avatarStatus === 'error'
              || artist.avatarStatus === 'rate_limited'
              || Boolean(avatarImageUrl && failedAvatarUrls[artist.id] === avatarImageUrl);
            const shouldShowCover = Boolean(
              !shouldShowAvatar
                && (artistWallAlbumArtwork || (artistWallAlbumFallbackForMissingAvatars && shouldUseMissingAvatarFallback))
                && coverImageUrl
                && failedCoverUrls[artist.id] !== coverImageUrl,
            );
            const imageUrl = shouldShowAvatar ? avatarImageUrl : shouldShowCover ? coverImageUrl : null;
            const avatarSrcSet = shouldShowAvatar && artist.avatarThumbUrl && artist.avatarUrl && artist.avatarThumbUrl !== artist.avatarUrl
              ? `${versionedArtistImageUrl(artist.avatarThumbUrl, avatarVersion)} 192w, ${versionedArtistImageUrl(artist.avatarUrl, avatarVersion)} 1024w`
              : undefined;

            return (
              <article
                className="artist-card"
                data-cover={Boolean(imageUrl)}
                key={artist.id}
                role="button"
                tabIndex={0}
                onClick={() => openArtistDetail(artist)}
                onKeyDown={(event) => handleArtistKeyDown(event, artist)}
              >
                <div
                  className="artist-avatar"
                  data-cover={Boolean(imageUrl)}
                  data-visual={shouldShowAvatar ? 'avatar' : shouldShowCover ? 'cover' : 'letter'}
                  aria-hidden="true"
                  onContextMenu={(event) => handleArtistAvatarContextMenu(event, artist)}
                >
                  {imageUrl ? (
                    <DeferredWallImage
                      alt=""
                      decoding="async"
                      draggable={false}
                      height={384}
                      loading="lazy"
                      paused={pauseDeferredArtistImages}
                      priority={index < priorityArtistWallImageCount}
                      sizes="124px"
                      src={imageUrl}
                      srcSet={avatarSrcSet}
                      width={384}
                      onError={() => {
                        if (shouldShowAvatar) {
                          handleArtistAvatarError(artist, imageUrl);
                        } else {
                          handleArtistCoverError(artist, imageUrl);
                        }
                      }}
                    />
                  ) : (
                    <span>{artistMark(artist.name)}</span>
                  )}
                </div>
                {artistImagesAutoFetch ? (
                  <button
                    className="artist-avatar-refresh"
                    type="button"
                    aria-label={`Refresh avatar for ${artist.name}`}
                    title="Refresh artist avatar"
                    onClick={(event) => handleRefreshArtistAvatar(event, artist)}
                  >
                    <RefreshCw size={13} />
                  </button>
                ) : null}
                <div className="artist-copy">
                  <strong>{artist.name}</strong>
                  {artist.mediaType === 'remote' ? <small className="remote-media-source">{artist.sourceDisplayName ?? artist.provider ?? t('library.source.remote')}</small> : null}
                  <small>{artistMeta(artist, t)}</small>
                </div>
                <span className="artist-card-action" aria-hidden="true">
                  <Play size={14} fill="currentColor" />
                </span>
              </article>
            );
          })}
        </section>
        <InfiniteScrollSentinel canLoadMore={hasMore} isLoading={isLoading} onLoadMore={handleLoadMoreArtists} />

        {error ? (
          <div className="list-footer">
            <span>{error}</span>
          </div>
        ) : null}
        <MediaWallScrollSpacer height={spacerHeight} />
      </div>
      </div>
    </>
  );
};
