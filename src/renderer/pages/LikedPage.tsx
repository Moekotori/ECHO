import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BarChart3,
  ChevronRight,
  Clock3,
  Disc3,
  FileOutput,
  FolderHeart,
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  Monitor,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import '../styles/liked.css';
import type {
  LibraryAlbum,
  LibraryPage,
  LibraryPlaylistItem,
  LibrarySort,
  LibraryTrack,
  PlaylistExportFormat,
} from "../../shared/types/library";
import type { StreamingProviderName } from "../../shared/types/streaming";
import { AlbumDetailView } from "../components/album/AlbumDetailView";
import { LikedTrackTable } from "../components/library/LikedTrackTable";
import {
  InfiniteScrollSentinel,
  readPageScrollTop,
  writePageScrollTop,
} from "../components/ui/InfiniteScrollSentinel";
import {
  MediaWallScrollSpacer,
  useMediaWallScrollSpacer,
} from "../components/ui/MediaWallScrollSpacer";
import { StyledSelect } from "../components/ui/StyledSelect";
import {
  likedAlbumsChangedEvent,
  likedChangedEvent,
  likedTracksChangedEvent,
} from "../hooks/useLikedMedia";
import {
  type QueueSource,
  usePlaybackQueue,
} from "../stores/PlaybackQueueProvider";
import { useI18n } from "../i18n/I18nProvider";
import { useImeAwareDebouncedSearch } from "../utils/imeInput";

const pageSize = 100;
const sortOptionKeys: Array<{
  value: LibrarySort;
  labelKey: `likedPage.sort.${string}`;
}> = [
  { value: "recent", labelKey: "likedPage.sort.recent" },
  { value: "frequent", labelKey: "likedPage.sort.frequent" },
  { value: "default", labelKey: "likedPage.sort.default" },
  { value: "titleAsc", labelKey: "likedPage.sort.titleAsc" },
  { value: "titleDesc", labelKey: "likedPage.sort.titleDesc" },
  { value: "artist", labelKey: "likedPage.sort.artist" },
  { value: "album", labelKey: "likedPage.sort.album" },
];
const likedExportOptions: Array<{
  value: PlaylistExportFormat;
  label: string;
}> = [
  { value: "json", label: "JSON" },
  { value: "txt", label: "TXT" },
  { value: "m3u8", label: "M3U8" },
  { value: "csv", label: "CSV" },
];

type LikedTab = "tracks" | "albums";
type LikedSyncProvider = Extract<StreamingProviderName, "netease" | "qqmusic">;
type LikedTrackSourceProvider = "all" | "local" | LikedSyncProvider;
type LikedTrackSection =
  "all" | "recent" | "frequent" | "local" | LikedSyncProvider;
type I18nT = ReturnType<typeof useI18n>["t"];

const likedSyncProviders: Array<{
  provider: LikedSyncProvider;
  labelKey: `likedPage.provider.${string}`;
}> = [
  { provider: "netease", labelKey: "likedPage.provider.netease" },
  { provider: "qqmusic", labelKey: "likedPage.provider.qqmusic" },
];

const likedProviderLogos: Record<LikedSyncProvider, string> = {
  netease: new URL(
    "../assets/service-logos/neteasecloudmusic.svg",
    import.meta.url,
  ).href,
  qqmusic: new URL("../assets/service-logos/qqmusic.svg", import.meta.url).href,
};

const likedTrackSourceProviders: Array<{
  provider: Exclude<LikedTrackSourceProvider, "all">;
  labelKey: `likedPage.provider.${string}`;
}> = [
  { provider: "local", labelKey: "likedPage.provider.local" },
  ...likedSyncProviders,
];

const isLikedStreamingProvider = (
  provider: string | null | undefined,
): provider is Extract<StreamingProviderName, "netease" | "qqmusic"> =>
  provider === "netease" || provider === "qqmusic";

const itemToTrack = (item: LibraryPlaylistItem, t: I18nT): LibraryTrack => {
  if (item.track) {
    return {
      ...item.track,
      unavailable: item.unavailable,
      playlistItemId: item.id,
    };
  }

  if (
    item.mediaType === "stream_track" &&
    item.mediaId &&
    item.sourceItemId &&
    !item.unavailable
  ) {
    return {
      id: item.mediaId,
      mediaType: "streaming",
      path: item.mediaId,
      provider: item.sourceProvider,
      providerTrackId: item.sourceItemId,
      stableKey: item.mediaId,
      title: item.titleSnapshot ?? "Streaming track",
      artist: item.artistSnapshot ?? "Unknown Artist",
      album: item.albumSnapshot ?? "",
      albumArtist: item.artistSnapshot ?? "",
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: item.durationSnapshot ?? 0,
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
      coverId: item.coverId,
      coverThumb: item.coverThumb,
      fieldSources: {
        title: item.sourceProvider,
        artist: item.sourceProvider,
        album: item.sourceProvider,
      },
      unavailable: false,
      playlistItemId: item.id,
    };
  }

  return {
    id: item.mediaId ?? item.id,
    path: "",
    title: item.titleSnapshot ?? t("likedPage.track.unavailable"),
    artist: item.artistSnapshot ?? "Unknown Artist",
    album: item.albumSnapshot ?? "",
    albumArtist: item.artistSnapshot ?? "",
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration: item.durationSnapshot ?? 0,
    codec: null,
    sampleRate: null,
    bitDepth: null,
    bitrate: null,
    coverId: item.coverId,
    coverThumb: item.coverThumb,
    fieldSources: {},
    unavailable: true,
    playlistItemId: item.id,
  };
};

const itemToAlbum = (item: LibraryPlaylistItem, t: I18nT): LibraryAlbum => {
  if (item.album) {
    return item.album;
  }

  return {
    id: item.mediaId ?? item.id,
    albumKey: item.mediaId ?? item.id,
    title:
      item.titleSnapshot ??
      item.albumSnapshot ??
      t("likedPage.album.unavailableTitle"),
    albumArtist: item.artistSnapshot ?? "Unknown Artist",
    year: null,
    trackCount: 0,
    duration: item.durationSnapshot ?? 0,
    coverId: item.coverId,
    coverThumb: item.coverThumb,
  };
};

export const LikedPage = (): JSX.Element => {
  const { t } = useI18n();
  const [tab, setTab] = useState<LikedTab>("tracks");
  const [trackItems, setTrackItems] = useState<LibraryPlaylistItem[]>([]);
  const [albumItems, setAlbumItems] = useState<LibraryPlaylistItem[]>([]);
  const [trackTotal, setTrackTotal] = useState(0);
  const [allTrackTotal, setAllTrackTotal] = useState(0);
  const [albumTotal, setAlbumTotal] = useState(0);
  const [trackPage, setTrackPage] = useState(1);
  const [albumPage, setAlbumPage] = useState(1);
  const [trackHasMore, setTrackHasMore] = useState(false);
  const [albumHasMore, setAlbumHasMore] = useState(false);
  const { searchInput, setSearchInput, search, setSearch, searchInputProps } =
    useImeAwareDebouncedSearch(250);
  const [trackSort, setTrackSort] = useState<LibrarySort>("default");
  const [albumSort, setAlbumSort] = useState<LibrarySort>("default");
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncingLikedProvider, setSyncingLikedProvider] =
    useState<LikedSyncProvider | null>(null);
  const [trackSection, setTrackSection] = useState<LikedTrackSection>("all");
  const [trackSourceProvider, setTrackSourceProvider] =
    useState<LikedTrackSourceProvider>("all");
  const [sourceTotals, setSourceTotals] = useState<
    Record<Exclude<LikedTrackSourceProvider, "all">, number>
  >({ local: 0, netease: 0, qqmusic: 0 });
  const [selectedTrackIds, setSelectedTrackIds] = useState<
    Record<string, boolean>
  >({});
  const [likedExportFormat, setLikedExportFormat] =
    useState<PlaylistExportFormat>("json");
  const [isExportingLikedTracks, setIsExportingLikedTracks] = useState(false);
  const [isPreparingPlayAll, setIsPreparingPlayAll] = useState(false);
  const [isTrackLoading, setIsTrackLoading] = useState(false);
  const [isAlbumLoading, setIsAlbumLoading] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<LibraryAlbum | null>(null);
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pageScrollTopRef = useRef(0);
  const shouldRestorePageScrollRef = useRef(false);
  const trackRequestIdRef = useRef(0);
  const albumRequestIdRef = useRef(0);
  const trackSourceProviderRef = useRef<LikedTrackSourceProvider>("all");
  const lastSelectedTrackIndexRef = useRef<number | null>(null);
  const {
    appendToQueue,
    appendTracksToQueue,
    currentTrackId,
    playTrack,
    playTrackNext,
    playTracksNext,
  } = usePlaybackQueue();

  const sortOptions = useMemo(
    () =>
      sortOptionKeys.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t],
  );
  const likedTrackSourceOptions = useMemo(
    () =>
      likedTrackSourceProviders.map((item) => ({
        ...item,
        label: t(item.labelKey),
      })),
    [t],
  );
  const likedSyncProviderOptions = useMemo(
    () =>
      likedSyncProviders.map((item) => ({ ...item, label: t(item.labelKey) })),
    [t],
  );
  const getLikedTrackSourceLabel = useCallback(
    (provider: LikedTrackSourceProvider): string =>
      provider === "all"
        ? t("likedPage.nav.all")
        : (likedTrackSourceOptions.find((item) => item.provider === provider)
            ?.label ?? provider),
    [likedTrackSourceOptions, t],
  );
  const getLikedSyncProviderLabel = useCallback(
    (provider: LikedSyncProvider): string =>
      likedSyncProviderOptions.find((item) => item.provider === provider)
        ?.label ?? provider,
    [likedSyncProviderOptions],
  );
  const activeViewLabel = useMemo(() => {
    if (tab === "albums") {
      return t("likedPage.nav.albums");
    }
    if (trackSection === "recent") {
      return t("likedPage.nav.recent");
    }
    if (trackSection === "frequent") {
      return t("likedPage.nav.frequent");
    }
    if (trackSection === "all") {
      return t("likedPage.nav.all");
    }
    return getLikedTrackSourceLabel(trackSourceProvider);
  }, [getLikedTrackSourceLabel, t, tab, trackSection, trackSourceProvider]);
  const tracks = useMemo(
    () => trackItems.map((item) => itemToTrack(item, t)),
    [t, trackItems],
  );
  const albums = useMemo(
    () => albumItems.map((item) => itemToAlbum(item, t)),
    [albumItems, t],
  );
  const likedQueueSource = useMemo<QueueSource>(() => {
    const sourceLabel = getLikedTrackSourceLabel(trackSourceProvider);
    if (trackSourceProvider === "all") {
      return {
        type: "manual",
        label: t("likedPage.queue.label", { source: sourceLabel }),
      };
    }
    return {
      type: "liked",
      label: t("likedPage.queue.label", { source: sourceLabel }),
      sourceProvider: trackSourceProvider,
      search: search || undefined,
      sort: trackSort,
    };
  }, [
    getLikedTrackSourceLabel,
    search,
    t,
    trackSort,
    trackSourceProvider,
  ]);
  const selectedTracks = useMemo(
    () => tracks.filter((track) => selectedTrackIds[track.id] === true),
    [selectedTrackIds, tracks],
  );
  const activeSort = tab === "tracks" ? trackSort : albumSort;
  const activeTotal = tab === "tracks" ? trackTotal : albumTotal;
  const hasActiveContent = activeTotal > 0;
  const isCurrentTabLoading =
    tab === "tracks" ? isTrackLoading : isAlbumLoading;
  const isCurrentTabAppending =
    isCurrentTabLoading &&
    (tab === "tracks" ? tracks.length > 0 : albums.length > 0);
  const hasActiveQuery =
    searchInput.trim().length > 0 ||
    activeSort !== "default" ||
    (tab === "tracks" && trackSourceProvider !== "all");
  const showWorkspace =
    hasActiveContent || hasActiveQuery || isCurrentTabLoading;
  const { wallRef: likedAlbumWallRef, spacerHeight: likedAlbumSpacerHeight } =
    useMediaWallScrollSpacer<HTMLElement>({
      itemCount: albums.length,
      totalCount: albumTotal,
      minColumnWidth: 164,
      columnGap: 14,
      rowGap: 14,
      estimatedItemHeight: 214,
    });

  const loadTracks = useCallback(
    async (
      nextPage: number,
      mode: "replace" | "append",
      sourceProvider = trackSourceProviderRef.current,
    ): Promise<void> => {
      const requestId = trackRequestIdRef.current + 1;
      trackRequestIdRef.current = requestId;
      setIsTrackLoading(true);
      setError(null);

      try {
        const library = window.echo?.library;
        if (!library) {
          setTrackItems([]);
          setTrackPage(1);
          setTrackTotal(0);
          setTrackHasMore(false);
          return;
        }

        const result: LibraryPage<LibraryPlaylistItem> =
          await library.getLikedTracks({
            page: nextPage,
            pageSize,
            search,
            sort: trackSort,
            ...(sourceProvider === "all" ? {} : { sourceProvider }),
          });

        if (trackRequestIdRef.current !== requestId) {
          return;
        }

        setTrackItems((current) =>
          mode === "append" ? [...current, ...result.items] : result.items,
        );
        setTrackPage(result.page);
        setTrackTotal(result.total);
        if (sourceProvider === "all") {
          setAllTrackTotal(result.total);
        }
        setTrackHasMore(result.hasMore);
      } catch (loadError) {
        if (trackRequestIdRef.current === requestId) {
          setError(
            loadError instanceof Error ? loadError.message : String(loadError),
          );
        }
      } finally {
        if (trackRequestIdRef.current === requestId) {
          setIsTrackLoading(false);
        }
      }
    },
    [search, trackSort],
  );

  const refreshSourceTotals = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.getLikedTracks) {
      return;
    }

    try {
      const providers: Array<Exclude<LikedTrackSourceProvider, "all">> = [
        "local",
        "netease",
        "qqmusic",
      ];
      const [allResult, ...providerResults] = await Promise.all([
        library.getLikedTracks({
          page: 1,
          pageSize: 1,
          search: "",
          sort: "recent",
        }),
        ...providers.map((sourceProvider) =>
          library.getLikedTracks({
            page: 1,
            pageSize: 1,
            search: "",
            sort: "recent",
            sourceProvider,
          }),
        ),
      ]);
      setAllTrackTotal(allResult.total);
      setSourceTotals(
        Object.fromEntries(
          providers.map((provider, index) => [
            provider,
            providerResults[index]?.total ?? 0,
          ]),
        ) as Record<Exclude<LikedTrackSourceProvider, "all">, number>,
      );
    } catch {
      // Keep the last known counts; the main list still remains usable.
    }
  }, []);

  const loadAlbums = useCallback(
    async (nextPage: number, mode: "replace" | "append"): Promise<void> => {
      const requestId = albumRequestIdRef.current + 1;
      albumRequestIdRef.current = requestId;
      setIsAlbumLoading(true);
      setError(null);

      try {
        const library = window.echo?.library;
        if (!library) {
          setAlbumItems([]);
          setAlbumPage(1);
          setAlbumTotal(0);
          setAlbumHasMore(false);
          return;
        }

        const result = await library.getLikedAlbums({
          page: nextPage,
          pageSize,
          search,
          sort: albumSort,
          sourceProvider: "local",
        });

        if (albumRequestIdRef.current !== requestId) {
          return;
        }

        setAlbumItems((current) =>
          mode === "append" ? [...current, ...result.items] : result.items,
        );
        setAlbumPage(result.page);
        setAlbumTotal(result.total);
        setAlbumHasMore(result.hasMore);
      } catch (loadError) {
        if (albumRequestIdRef.current === requestId) {
          setError(
            loadError instanceof Error ? loadError.message : String(loadError),
          );
        }
      } finally {
        if (albumRequestIdRef.current === requestId) {
          setIsAlbumLoading(false);
        }
      }
    },
    [albumSort, search],
  );

  useEffect(() => {
    void loadTracks(1, "replace");
  }, [loadTracks, trackSourceProvider]);

  useEffect(() => {
    void loadAlbums(1, "replace");
  }, [loadAlbums]);

  useEffect(() => {
    void refreshSourceTotals();
  }, [refreshSourceTotals]);

  useEffect(() => {
    const reloadTracks = (): void => {
      void loadTracks(1, "replace");
      void refreshSourceTotals();
    };
    const reloadAlbums = (): void => void loadAlbums(1, "replace");
    window.addEventListener(likedTracksChangedEvent, reloadTracks);
    window.addEventListener(likedAlbumsChangedEvent, reloadAlbums);
    return () => {
      window.removeEventListener(likedTracksChangedEvent, reloadTracks);
      window.removeEventListener(likedAlbumsChangedEvent, reloadAlbums);
    };
  }, [loadAlbums, loadTracks, refreshSourceTotals]);

  useLayoutEffect(() => {
    writePageScrollTop(pageRootRef.current, 0);
  }, [activeSort, search, tab, trackSourceProvider]);

  useEffect(() => {
    setSelectedTrackIds({});
    lastSelectedTrackIndexRef.current = null;
  }, [activeSort, search, tab, trackSourceProvider]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        showWorkspace
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [showWorkspace]);

  useLayoutEffect(() => {
    if (selectedAlbum || !shouldRestorePageScrollRef.current) {
      return;
    }

    writePageScrollTop(pageRootRef.current, pageScrollTopRef.current);
    shouldRestorePageScrollRef.current = false;
  }, [selectedAlbum]);

  const openAlbumDetail = useCallback((album: LibraryAlbum): void => {
    pageScrollTopRef.current = readPageScrollTop(pageRootRef.current);
    shouldRestorePageScrollRef.current = true;
    setSelectedAlbum(album);
  }, []);

  const handleLoadMoreAlbums = useCallback((): void => {
    if (isAlbumLoading || !albumHasMore) {
      return;
    }

    void loadAlbums(albumPage + 1, "append");
  }, [albumHasMore, albumPage, isAlbumLoading, loadAlbums]);

  const handlePlayAll = useCallback(async (): Promise<void> => {
    if (isPreparingPlayAll) {
      return;
    }

    setIsPreparingPlayAll(true);
    setError(null);
    try {
      let playbackItems = trackItems;
      const library = window.echo?.library;
      if (trackTotal > trackItems.length && library?.getLikedTracks) {
        const collected: LibraryPlaylistItem[] = [];
        let nextPage = 1;
        let hasMore = true;
        while (hasMore) {
          const result = await library.getLikedTracks({
            page: nextPage,
            pageSize: 500,
            search,
            sort: trackSort,
            ...(trackSourceProvider === "all"
              ? {}
              : { sourceProvider: trackSourceProvider }),
          });
          collected.push(...result.items);
          hasMore = result.hasMore;
          nextPage = result.page + 1;
        }
        playbackItems = collected;
      }

      const playbackTracks = playbackItems.map((item) => itemToTrack(item, t));
      const playable = playbackTracks.filter(
        (track) => !track.unavailable && track.path,
      );
      if (playable.length === 0) {
        setError(t("likedPage.message.noPlayableTracks"));
        return;
      }

      await playTrack(playable[0], {
        replaceQueueWith: playable,
        source: likedQueueSource,
      });
      if (playable.length < playbackTracks.length) {
        setError(t("likedPage.message.skippedUnavailable"));
      }
    } catch (playError) {
      setError(
        playError instanceof Error ? playError.message : String(playError),
      );
    } finally {
      setIsPreparingPlayAll(false);
    }
  }, [
    isPreparingPlayAll,
    likedQueueSource,
    playTrack,
    search,
    t,
    trackItems,
    trackSort,
    trackSourceProvider,
    trackTotal,
  ]);

  const selectTrackSourceProvider = useCallback(
    (
      provider: LikedTrackSourceProvider,
      section: LikedTrackSection = provider,
    ): void => {
      trackSourceProviderRef.current = provider;
      setTrackSourceProvider(provider);
      setTrackSection(section);
      if (section === "frequent") {
        setTrackSort("frequent");
      } else if (section === "all") {
        setTrackSort("default");
      } else if (
        section === "recent" ||
        section === "local" ||
        section === "netease" ||
        section === "qqmusic"
      ) {
        setTrackSort("recent");
      }
      setSyncStatus(null);
      setError(null);
    },
    [],
  );

  const handleSortChange = useCallback(
    (nextSort: LibrarySort): void => {
      if (tab === "albums") {
        setAlbumSort(nextSort);
        return;
      }

      setTrackSort(nextSort);
      if (trackSourceProvider !== "all") {
        setTrackSection(trackSourceProvider);
      } else if (nextSort === "recent" || nextSort === "frequent") {
        setTrackSection(nextSort);
      } else {
        setTrackSection("all");
      }
    },
    [tab, trackSourceProvider],
  );

  const handleSyncLikedSongs = useCallback(
    async (provider: LikedSyncProvider): Promise<void> => {
      const streaming = window.echo?.streaming;
      const providerLabel = getLikedSyncProviderLabel(provider);
      selectTrackSourceProvider(provider, provider);
      setTab("tracks");
      if (!streaming?.syncLikedSongs) {
        setError(t("likedPage.message.syncUnavailable"));
        return;
      }

      setSyncingLikedProvider(provider);
      setSyncStatus(null);
      setError(null);
      try {
        const result = await streaming.syncLikedSongs(provider);
        const providerResult = result.providers.find(
          (item) => item.provider === provider,
        );
        if (providerResult && !providerResult.success) {
          throw new Error(
            providerResult.error ??
              t("likedPage.message.syncFailed", { provider: providerLabel }),
          );
        }

        const importedCount =
          providerResult?.importedCount ?? result.importedCount;
        const addedCount = providerResult?.addedCount ?? result.addedCount;
        setSyncStatus(
          t("likedPage.message.synced", {
            provider: providerLabel,
            imported: importedCount,
            added: addedCount,
          }),
        );
        window.dispatchEvent(new Event(likedTracksChangedEvent));
        window.dispatchEvent(new Event(likedChangedEvent));
      } catch (syncError) {
        setError(
          syncError instanceof Error ? syncError.message : String(syncError),
        );
      } finally {
        setSyncingLikedProvider(null);
      }
    },
    [getLikedSyncProviderLabel, selectTrackSourceProvider, t],
  );

  const handleToggleTrackLiked = useCallback(
    async (track: LibraryTrack): Promise<void> => {
      if (
        track.mediaType === "streaming" &&
        isLikedStreamingProvider(track.provider) &&
        track.providerTrackId
      ) {
        const streaming = window.echo?.streaming;
        if (!streaming?.setTrackLiked) {
          throw new Error(t("likedPage.error.streamingUnavailable"));
        }

        await streaming.setTrackLiked({
          provider: track.provider,
          providerTrackId: track.providerTrackId,
          liked: false,
        });
      } else {
        await window.echo.library.unlikeTrack(track.id);
      }
      setTrackItems((current) =>
        current.filter((item) => (item.mediaId ?? item.id) !== track.id),
      );
      setSelectedTrackIds((current) => {
        const next = { ...current };
        delete next[track.id];
        return next;
      });
      setTrackTotal((current) => Math.max(0, current - 1));
      window.dispatchEvent(new Event(likedTracksChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
    },
    [t],
  );

  const handleToggleTrackSelected = useCallback(
    (track: LibraryTrack, index: number, range: boolean): void => {
      setSelectedTrackIds((current) => {
        const next = { ...current };
        const shouldSelect = next[track.id] !== true;
        if (range && lastSelectedTrackIndexRef.current !== null) {
          const start = Math.min(lastSelectedTrackIndexRef.current, index);
          const end = Math.max(lastSelectedTrackIndexRef.current, index);
          tracks.slice(start, end + 1).forEach((item) => {
            if (!item.unavailable) {
              next[item.id] = shouldSelect;
            }
          });
        } else if (shouldSelect && !track.unavailable) {
          next[track.id] = true;
        } else {
          delete next[track.id];
        }
        return next;
      });
      lastSelectedTrackIndexRef.current = index;
    },
    [tracks],
  );

  const handleToggleSelectAll = useCallback((): void => {
    const selectable = tracks.filter((track) => !track.unavailable);
    const allSelected =
      selectable.length > 0 &&
      selectable.every((track) => selectedTrackIds[track.id] === true);
    setSelectedTrackIds(
      allSelected
        ? {}
        : Object.fromEntries(selectable.map((track) => [track.id, true])),
    );
    lastSelectedTrackIndexRef.current = null;
  }, [selectedTrackIds, tracks]);

  const handlePlaySelectedNext = useCallback((): void => {
    const playable = selectedTracks.filter(
      (track) => !track.unavailable && track.path,
    );
    if (playable.length > 0) {
      playTracksNext(playable, likedQueueSource);
      setSyncStatus(
        t("likedPage.message.queuedNext", { count: playable.length }),
      );
    }
  }, [likedQueueSource, playTracksNext, selectedTracks, t]);

  const handleAddSelectedToQueue = useCallback((): void => {
    const playable = selectedTracks.filter(
      (track) => !track.unavailable && track.path,
    );
    if (playable.length > 0) {
      appendTracksToQueue(playable, likedQueueSource);
      setSyncStatus(
        t("likedPage.message.addedToQueue", { count: playable.length }),
      );
    }
  }, [appendTracksToQueue, likedQueueSource, selectedTracks, t]);

  const handleRemoveSelected = useCallback(async (): Promise<void> => {
    if (
      selectedTracks.length === 0 ||
      !window.confirm(
        t("likedPage.confirm.removeSelected", { count: selectedTracks.length }),
      )
    ) {
      return;
    }

    try {
      await Promise.all(
        selectedTracks.map(async (track) => {
          if (
            track.mediaType === "streaming" &&
            isLikedStreamingProvider(track.provider) &&
            track.providerTrackId
          ) {
            await window.echo?.streaming?.setTrackLiked?.({
              provider: track.provider,
              providerTrackId: track.providerTrackId,
              liked: false,
            });
          } else {
            await window.echo.library.unlikeTrack(track.id);
          }
        }),
      );
      const removedIds = new Set(selectedTracks.map((track) => track.id));
      setTrackItems((current) =>
        current.filter((item) => !removedIds.has(item.mediaId ?? item.id)),
      );
      setTrackTotal((current) => Math.max(0, current - removedIds.size));
      setSelectedTrackIds({});
      window.dispatchEvent(new Event(likedTracksChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : String(removeError),
      );
    }
  }, [selectedTracks, t]);

  const handleExportLikedTracks = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.getLikedSongsPlaylist || !library.exportPlaylist) {
      setError(t("likedPage.message.exportBridgeUnavailable"));
      setSyncStatus(null);
      return;
    }

    setIsExportingLikedTracks(true);
    setError(null);
    setSyncStatus(null);
    try {
      const playlist = await library.getLikedSongsPlaylist();
      const exportedPath = await library.exportPlaylist({
        playlistId: playlist.id,
        format: likedExportFormat,
        ...(trackSourceProvider === "all"
          ? {}
          : { sourceProvider: trackSourceProvider }),
      });
      const sourceLabel = getLikedTrackSourceLabel(trackSourceProvider);
      setSyncStatus(
        exportedPath
          ? t("likedPage.message.exported", {
              source: sourceLabel,
              path: exportedPath,
            })
          : t("likedPage.message.exportCancelled"),
      );
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : String(exportError),
      );
      setSyncStatus(null);
    } finally {
      setIsExportingLikedTracks(false);
    }
  }, [getLikedTrackSourceLabel, likedExportFormat, t, trackSourceProvider]);

  const handleToggleAlbumLiked = useCallback(
    async (album: LibraryAlbum): Promise<void> => {
      await window.echo.library.unlikeAlbum(album.id);
      setAlbumItems((current) =>
        current.filter((item) => (item.mediaId ?? item.id) !== album.id),
      );
      setAlbumTotal((current) => Math.max(0, current - 1));
      window.dispatchEvent(new Event(likedAlbumsChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
    },
    [],
  );

  const navigateToRoute = useCallback(
    (routeId: "albums" | "songs" | "streaming"): void => {
      window.dispatchEvent(
        new CustomEvent("app:navigate:route", { detail: routeId }),
      );
    },
    [],
  );

  const clearSearch = useCallback((): void => {
    setSearchInput("");
    setSearch("");
    searchInputRef.current?.focus();
  }, [setSearch, setSearchInput]);

  if (selectedAlbum) {
    return (
      <AlbumDetailView
        album={selectedAlbum}
        onBack={() => setSelectedAlbum(null)}
      />
    );
  }

  const selectedCount = selectedTracks.length;

  return (
    <div
      ref={pageRootRef}
      className={`liked-page liked-page--${tab} ${showWorkspace ? "liked-page--content" : "liked-page--empty"}`}
    >
      <aside className="liked-library-nav" aria-label={t("likedPage.nav.aria")}>
        <div className="liked-library-nav-header">
          <Heart size={21} aria-hidden="true" />
          <div>
            <h1>{t("likedPage.title")}</h1>
            <p>
              {t("likedPage.summary", {
                tracks: allTrackTotal,
                albums: albumTotal,
              })}
            </p>
          </div>
        </div>

        <nav
          className="liked-library-nav-list"
          aria-label={t("likedPage.nav.aria")}
        >
          <button
            className={
              tab === "tracks" && trackSection === "all" ? "is-active" : ""
            }
            type="button"
            aria-pressed={tab === "tracks" && trackSection === "all"}
            onClick={() => {
              setTab("tracks");
              selectTrackSourceProvider("all", "all");
            }}
          >
            <Heart
              size={17}
              fill={
                tab === "tracks" && trackSection === "all"
                  ? "currentColor"
                  : "none"
              }
            />
            <span>{t("likedPage.nav.all")}</span>
            <strong>{allTrackTotal}</strong>
          </button>
          <button
            className={
              tab === "tracks" && trackSection === "recent" ? "is-active" : ""
            }
            type="button"
            aria-pressed={tab === "tracks" && trackSection === "recent"}
            onClick={() => {
              setTab("tracks");
              selectTrackSourceProvider("all", "recent");
            }}
          >
            <Clock3 size={17} />
            <span>{t("likedPage.nav.recent")}</span>
            <strong>{allTrackTotal}</strong>
          </button>
          <button
            className={
              tab === "tracks" && trackSection === "frequent" ? "is-active" : ""
            }
            type="button"
            aria-pressed={tab === "tracks" && trackSection === "frequent"}
            onClick={() => {
              setTab("tracks");
              selectTrackSourceProvider("all", "frequent");
            }}
          >
            <BarChart3 size={17} />
            <span>{t("likedPage.nav.frequent")}</span>
            <strong>{allTrackTotal}</strong>
          </button>
          <span className="liked-library-nav-divider" />
          <button
            className={
              tab === "tracks" && trackSection === "local" ? "is-active" : ""
            }
            type="button"
            aria-pressed={tab === "tracks" && trackSection === "local"}
            onClick={() => {
              setTab("tracks");
              selectTrackSourceProvider("local", "local");
            }}
          >
            <Monitor size={17} />
            <span>{t("likedPage.provider.local")}</span>
            <strong>{sourceTotals.local}</strong>
          </button>
          {likedSyncProviderOptions.map((item) => (
            <div className="liked-library-provider-row" key={item.provider}>
              <button
                className={
                  tab === "tracks" && trackSection === item.provider
                    ? "is-active"
                    : ""
                }
                type="button"
                aria-pressed={
                  tab === "tracks" && trackSection === item.provider
                }
                aria-label={item.label}
                onClick={() => {
                  setTab("tracks");
                  selectTrackSourceProvider(item.provider, item.provider);
                }}
              >
                <img src={likedProviderLogos[item.provider]} alt="" />
                <span>{item.label}</span>
                <strong>{sourceTotals[item.provider]}</strong>
              </button>
              <button
                className="liked-provider-sync"
                type="button"
                aria-label={`${t("likedPage.action.sync")} ${item.label}`}
                disabled={syncingLikedProvider !== null}
                onClick={() => void handleSyncLikedSongs(item.provider)}
              >
                {syncingLikedProvider === item.provider ? (
                  <Loader2 className="spinning-icon" size={14} />
                ) : (
                  <RefreshCw size={14} />
                )}
              </button>
            </div>
          ))}
          <span className="liked-library-nav-divider" />
          <button
            className={tab === "albums" ? "is-active" : ""}
            type="button"
            aria-pressed={tab === "albums"}
            onClick={() => setTab("albums")}
          >
            <Disc3 size={17} />
            <span>{t("likedPage.nav.albums")}</span>
            <strong>{albumTotal}</strong>
          </button>
        </nav>
      </aside>

      <main className="liked-library-workspace">
        <header className="liked-workspace-header">
          <div className="liked-workspace-title">
            <h2>{activeViewLabel}</h2>
            <p>
              {t("likedPage.summary", {
                tracks: trackTotal,
                albums: albumTotal,
              })}
            </p>
          </div>
          {tab === "tracks" && trackTotal > 0 && !isTrackLoading ? (
            <button
              className="liked-primary-action"
              type="button"
              disabled={isPreparingPlayAll}
              onClick={() => void handlePlayAll()}
            >
              {isPreparingPlayAll ? (
                <Loader2 className="spinning-icon" size={17} />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              {t("likedPage.action.playAll")}
            </button>
          ) : null}
          {showWorkspace ? (
            <label className="search-box">
              <Search size={18} aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                placeholder={t("likedPage.search.placeholder")}
                aria-keyshortcuts="Control+K Meta+K"
                {...searchInputProps}
              />
            </label>
          ) : (
            <span />
          )}
          {showWorkspace ? (
            <StyledSelect
              className="liked-sort-control"
              value={activeSort}
              options={sortOptions}
              onChange={handleSortChange}
              ariaLabel={t("likedPage.sort.aria")}
            />
          ) : null}
        </header>

        {tab === "tracks" && selectedCount > 0 ? (
          <div
            className="liked-selection-bar"
            role="toolbar"
            aria-label={t("likedPage.selection.aria")}
          >
            <span className="liked-selection-count">
              <ListMusic size={16} />
              {t("likedPage.selection.count", { count: selectedCount })}
            </span>
            <button type="button" onClick={handlePlaySelectedNext}>
              <SkipForward size={16} />
              {t("likedPage.selection.playNext")}
            </button>
            <button type="button" onClick={handleAddSelectedToQueue}>
              <ListPlus size={16} />
              {t("likedPage.selection.addToQueue")}
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => void handleRemoveSelected()}
            >
              <Trash2 size={16} />
              {t("likedPage.selection.remove")}
            </button>
            <details className="liked-selection-more">
              <summary aria-label={t("likedPage.action.more")}>
                <MoreHorizontal size={17} />
                {t("likedPage.action.more")}
              </summary>
              <div>
                <div className="liked-export-menu-group">
                  <StyledSelect
                    className="liked-export-format"
                    value={likedExportFormat}
                    options={likedExportOptions}
                    onChange={setLikedExportFormat}
                    ariaLabel={t("likedPage.export.aria")}
                    showFilterIcon={false}
                  />
                  <button
                    type="button"
                    disabled={isExportingLikedTracks}
                    onClick={() => void handleExportLikedTracks()}
                  >
                    <FileOutput size={15} />
                    {isExportingLikedTracks
                      ? t("likedPage.action.exporting")
                      : t("likedPage.action.export")}
                  </button>
                </div>
                <button type="button" onClick={() => setSelectedTrackIds({})}>
                  {t("likedPage.selection.clear")}
                </button>
              </div>
            </details>
            <button
              className="liked-selection-close"
              type="button"
              aria-label={t("likedPage.selection.clear")}
              onClick={() => setSelectedTrackIds({})}
            >
              <X size={18} />
            </button>
          </div>
        ) : null}

        {tab === "tracks" ? (
          isTrackLoading && tracks.length === 0 ? (
            <section
              className="liked-loading-state"
              aria-label={t("likedPage.message.loading")}
              aria-live="polite"
            >
              <Loader2 className="spinning-icon" size={28} />
              <span>{t("likedPage.message.loading")}</span>
            </section>
          ) : tracks.length > 0 ? (
            <>
              <LikedTrackTable
                items={trackItems}
                tracks={tracks}
                currentTrackId={currentTrackId}
                selectedTrackIds={selectedTrackIds}
                onToggleSelected={handleToggleTrackSelected}
                onToggleSelectAll={handleToggleSelectAll}
                onPlay={(track) =>
                  void playTrack(track, {
                    replaceQueueWith: tracks.filter(
                      (item) => !item.unavailable,
                    ),
                    source: likedQueueSource,
                  })
                }
                onPlayNext={(track) => playTrackNext(track, likedQueueSource)}
                onAddToQueue={(track) => appendToQueue(track, likedQueueSource)}
                onToggleLiked={(track) => void handleToggleTrackLiked(track)}
                loadMoreSentinel={
                  <InfiniteScrollSentinel
                    canLoadMore={trackHasMore}
                    isLoading={isTrackLoading}
                    onLoadMore={() =>
                      void loadTracks(trackPage + 1, "append")
                    }
                  />
                }
              />
            </>
          ) : searchInput.trim() ? (
            <section
              className="liked-no-results"
              aria-label={t("likedPage.search.noResults.title")}
            >
              <Search size={32} strokeWidth={1.5} />
              <h2>{t("likedPage.search.noResults.title")}</h2>
              <p>{t("likedPage.search.noResults.description")}</p>
              <button type="button" onClick={clearSearch}>
                {t("likedPage.search.clear")}
              </button>
            </section>
          ) : (
            <section
              className="liked-empty-state liked-empty-state--tracks"
              aria-label={t("likedPage.empty.tracks.title")}
            >
              <div className="liked-empty-intro">
                <div className="liked-empty-icon">
                  <FolderHeart size={43} strokeWidth={1.45} />
                </div>
                <h2>{t("likedPage.empty.tracks.welcomeHeading")}</h2>
                <p>{t("likedPage.empty.tracks.welcomeDescription")}</p>
                <div className="liked-empty-actions">
                  <button
                    className="liked-empty-primary"
                    type="button"
                    onClick={() => navigateToRoute("songs")}
                  >
                    {t("likedPage.empty.browseLocal")}
                  </button>
                  <button
                    className="liked-empty-secondary"
                    type="button"
                    onClick={() => navigateToRoute("streaming")}
                  >
                    {t("likedPage.empty.import")}
                  </button>
                </div>
              </div>
              <div className="liked-empty-sources">
                <h3>{t("likedPage.empty.sources.title")}</h3>
                <div className="liked-empty-source-list">
                  <button
                    className="liked-empty-source-row"
                    type="button"
                    onClick={() => navigateToRoute("songs")}
                  >
                    <span className="liked-empty-source-icon is-local">
                      <FolderHeart size={23} />
                    </span>
                    <span className="liked-empty-source-copy">
                      <strong>{t("likedPage.empty.source.local.title")}</strong>
                      <small>{t("likedPage.empty.source.local.status")}</small>
                    </span>
                    <span className="liked-empty-source-action">
                      {t("likedPage.empty.source.local.action")}
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  {likedSyncProviderOptions.map((item) => (
                    <button
                      className="liked-empty-source-row"
                      type="button"
                      key={item.provider}
                      aria-label={`${t("likedPage.action.sync")} ${item.label}`}
                      disabled={syncingLikedProvider !== null}
                      onClick={() => void handleSyncLikedSongs(item.provider)}
                    >
                      <span className="liked-empty-source-icon">
                        <img
                          src={likedProviderLogos[item.provider]}
                          alt=""
                          draggable={false}
                        />
                      </span>
                      <span className="liked-empty-source-copy">
                        <strong>
                          {t(`likedPage.empty.source.${item.provider}.title`)}
                        </strong>
                        <small>
                          {t("likedPage.empty.source.streaming.status")}
                        </small>
                      </span>
                      <span className="liked-empty-source-action">
                        {syncingLikedProvider === item.provider
                          ? t("likedPage.empty.source.streaming.syncing")
                          : t("likedPage.empty.source.streaming.action")}
                      </span>
                      {syncingLikedProvider === item.provider ? (
                        <Loader2 className="spinning-icon" size={17} />
                      ) : (
                        <ChevronRight size={17} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="liked-empty-tip">
                <Heart size={15} />
                <span>{t("likedPage.empty.hint.like")}</span>
              </div>
            </section>
          )
        ) : (
          <>
            <section
              ref={likedAlbumWallRef}
              className="album-wall liked-album-wall"
              aria-label={t("likedPage.albumWall.aria")}
            >
              {isAlbumLoading && albums.length === 0 ? (
                <section
                  className="liked-loading-state liked-loading-state--albums"
                  aria-label={t("likedPage.message.loading")}
                >
                  <Loader2 className="spinning-icon" size={28} />
                  <span>{t("likedPage.message.loading")}</span>
                </section>
              ) : albums.length > 0 ? (
                albums.map((album) => {
                  const item = albumItems.find(
                    (candidate) =>
                      (candidate.mediaId ?? candidate.id) === album.id,
                  );
                  const unavailable =
                    item?.unavailable === true || !item?.album;
                  return (
                    <article
                      className="album-card"
                      data-unavailable={unavailable ? "true" : undefined}
                      key={item?.id ?? album.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => !unavailable && openAlbumDetail(album)}
                    >
                      <div
                        className="album-cover"
                        data-empty={!album.coverThumb}
                      >
                        {album.coverThumb ? (
                          <img
                            alt=""
                            decoding="async"
                            draggable={false}
                            height={320}
                            loading="lazy"
                            src={album.coverThumb}
                            width={320}
                          />
                        ) : (
                          <Disc3 size={24} />
                        )}
                      </div>
                      <div className="album-copy">
                        <strong>{album.title}</strong>
                        <span>{album.albumArtist}</span>
                        <small>
                          {unavailable
                            ? t("likedPage.album.unavailable")
                            : t("likedPage.album.trackCount", {
                                count: album.trackCount,
                              })}
                        </small>
                      </div>
                      <button
                        className="album-card-like is-liked"
                        type="button"
                        aria-label={t("likedPage.album.unlikeAria", {
                          title: album.title,
                        })}
                        aria-pressed="true"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleToggleAlbumLiked(album);
                        }}
                      >
                        <Heart size={16} fill="currentColor" />
                      </button>
                    </article>
                  );
                })
              ) : searchInput.trim() ? (
                <section
                  className="liked-no-results liked-no-results--albums"
                  aria-label={t("likedPage.search.noResults.title")}
                >
                  <Search size={32} />
                  <h2>{t("likedPage.search.noResults.title")}</h2>
                  <p>{t("likedPage.search.noResults.description")}</p>
                  <button type="button" onClick={clearSearch}>
                    {t("likedPage.search.clear")}
                  </button>
                </section>
              ) : (
                <section
                  className="liked-empty-state liked-empty-state--albums"
                  aria-label={t("likedPage.empty.albums.title")}
                >
                  <div className="liked-empty-icon">
                    <FolderHeart size={54} />
                  </div>
                  <h2>{t("likedPage.empty.albums.title")}</h2>
                  <p>{t("likedPage.empty.description")}</p>
                  <div className="liked-empty-actions">
                    <button
                      className="liked-empty-primary"
                      type="button"
                      onClick={() => navigateToRoute("albums")}
                    >
                      {t("likedPage.empty.browseAlbums")}
                    </button>
                  </div>
                </section>
              )}
            </section>
            <InfiniteScrollSentinel
              canLoadMore={albumHasMore}
              isLoading={isAlbumLoading}
              onLoadMore={handleLoadMoreAlbums}
            />
          </>
        )}

        {error ||
        syncStatus ||
        isCurrentTabAppending ||
        isExportingLikedTracks ? (
          <div
            className="list-footer"
            role={error ? "alert" : "status"}
            aria-live={error ? "assertive" : "polite"}
          >
            <span>
              {error ??
                syncStatus ??
                (isExportingLikedTracks
                  ? t("likedPage.message.exporting")
                  : t("likedPage.message.loading"))}
            </span>
            {error || syncStatus ? (
              <button
                className="liked-footer-dismiss"
                type="button"
                aria-label={t("likedPage.action.clear")}
                onClick={() => {
                  setError(null);
                  setSyncStatus(null);
                }}
              >
                <X size={15} />
              </button>
            ) : null}
          </div>
        ) : null}
        {tab === "albums" ? (
          <MediaWallScrollSpacer height={likedAlbumSpacerHeight} />
        ) : null}
      </main>
    </div>
  );
};
