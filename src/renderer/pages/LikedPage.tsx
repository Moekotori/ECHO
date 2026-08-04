import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Disc3, Download, Heart, Loader2, Play, RefreshCw, Search, Shuffle, Trash2 } from 'lucide-react';
import type { LibraryAlbum, LibraryPage, LibraryPlaylistItem, LibrarySort, LibraryTrack, PlaylistExportFormat } from '../../shared/types/library';
import type { StreamingProviderName } from '../../shared/types/streaming';
import { AlbumDetailView } from '../components/album/AlbumDetailView';
import { TrackList } from '../components/library/TrackList';
import { InfiniteScrollSentinel, readPageScrollTop, writePageScrollTop } from '../components/ui/InfiniteScrollSentinel';
import { MediaWallScrollSpacer, useMediaWallScrollSpacer } from '../components/ui/MediaWallScrollSpacer';
import { StyledSelect } from '../components/ui/StyledSelect';
import { likedAlbumsChangedEvent, likedChangedEvent, likedTracksChangedEvent } from '../hooks/useLikedMedia';
import { type QueueSource, usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { useI18n } from '../i18n/I18nProvider';
import { useImeAwareDebouncedSearch } from '../utils/imeInput';

const pageSize = 100;
const sortOptionKeys: Array<{ value: LibrarySort; labelKey: `likedPage.sort.${string}` }> = [
  { value: 'recent', labelKey: 'likedPage.sort.recent' },
  { value: 'default', labelKey: 'likedPage.sort.default' },
  { value: 'titleAsc', labelKey: 'likedPage.sort.titleAsc' },
  { value: 'titleDesc', labelKey: 'likedPage.sort.titleDesc' },
  { value: 'artist', labelKey: 'likedPage.sort.artist' },
  { value: 'album', labelKey: 'likedPage.sort.album' },
];
const likedExportOptions: Array<{ value: PlaylistExportFormat; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'txt', label: 'TXT' },
  { value: 'm3u8', label: 'M3U8' },
  { value: 'csv', label: 'CSV' },
];

type LikedTab = 'tracks' | 'albums';
type LikedSyncProvider = Extract<StreamingProviderName, 'netease' | 'qqmusic'>;
type LikedTrackSourceProvider = 'local' | LikedSyncProvider;
type I18nT = ReturnType<typeof useI18n>['t'];

const likedSyncProviders: Array<{ provider: LikedSyncProvider; labelKey: `likedPage.provider.${string}` }> = [
  { provider: 'netease', labelKey: 'likedPage.provider.netease' },
  { provider: 'qqmusic', labelKey: 'likedPage.provider.qqmusic' },
];

const likedTrackSourceProviders: Array<{ provider: LikedTrackSourceProvider; labelKey: `likedPage.provider.${string}` }> = [
  { provider: 'local', labelKey: 'likedPage.provider.local' },
  ...likedSyncProviders,
];

const isLikedStreamingProvider = (provider: string | null | undefined): provider is Extract<StreamingProviderName, 'netease' | 'qqmusic'> =>
  provider === 'netease' || provider === 'qqmusic';

const itemToTrack = (item: LibraryPlaylistItem, t: I18nT): LibraryTrack => {
  if (item.track) {
    return { ...item.track, unavailable: item.unavailable, playlistItemId: item.id };
  }

  if (item.mediaType === 'stream_track' && item.mediaId && item.sourceItemId && !item.unavailable) {
    return {
      id: item.mediaId,
      mediaType: 'streaming',
      path: item.mediaId,
      provider: item.sourceProvider,
      providerTrackId: item.sourceItemId,
      stableKey: item.mediaId,
      title: item.titleSnapshot ?? 'Streaming track',
      artist: item.artistSnapshot ?? 'Unknown Artist',
      album: item.albumSnapshot ?? '',
      albumArtist: item.artistSnapshot ?? '',
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
    path: '',
    title: item.titleSnapshot ?? t('likedPage.track.unavailable'),
    artist: item.artistSnapshot ?? 'Unknown Artist',
    album: item.albumSnapshot ?? '',
    albumArtist: item.artistSnapshot ?? '',
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
    title: item.titleSnapshot ?? item.albumSnapshot ?? t('likedPage.album.unavailableTitle'),
    albumArtist: item.artistSnapshot ?? 'Unknown Artist',
    year: null,
    trackCount: 0,
    duration: item.durationSnapshot ?? 0,
    coverId: item.coverId,
    coverThumb: item.coverThumb,
  };
};

export const LikedPage = (): JSX.Element => {
  const { t } = useI18n();
  const [tab, setTab] = useState<LikedTab>('tracks');
  const [trackItems, setTrackItems] = useState<LibraryPlaylistItem[]>([]);
  const [albumItems, setAlbumItems] = useState<LibraryPlaylistItem[]>([]);
  const [trackTotal, setTrackTotal] = useState(0);
  const [albumTotal, setAlbumTotal] = useState(0);
  const [trackPage, setTrackPage] = useState(1);
  const [albumPage, setAlbumPage] = useState(1);
  const [trackHasMore, setTrackHasMore] = useState(false);
  const [albumHasMore, setAlbumHasMore] = useState(false);
  const { search, searchInputProps } = useImeAwareDebouncedSearch(250);
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncingLikedProvider, setSyncingLikedProvider] = useState<LikedSyncProvider | null>(null);
  const [trackSourceProvider, setTrackSourceProvider] = useState<LikedTrackSourceProvider>('local');
  const [likedExportFormat, setLikedExportFormat] = useState<PlaylistExportFormat>('json');
  const [isExportingLikedTracks, setIsExportingLikedTracks] = useState(false);
  const [isTrackLoading, setIsTrackLoading] = useState(false);
  const [isAlbumLoading, setIsAlbumLoading] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<LibraryAlbum | null>(null);
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const pageScrollTopRef = useRef(0);
  const shouldRestorePageScrollRef = useRef(false);
  const trackRequestIdRef = useRef(0);
  const albumRequestIdRef = useRef(0);
  const trackSourceProviderRef = useRef<LikedTrackSourceProvider>('local');
  const { currentTrackId, playTrack } = usePlaybackQueue();

  const sortOptions = useMemo(() => sortOptionKeys.map((option) => ({ value: option.value, label: t(option.labelKey) })), [t]);
  const likedTrackSourceOptions = useMemo(() => likedTrackSourceProviders.map((item) => ({ ...item, label: t(item.labelKey) })), [t]);
  const likedSyncProviderOptions = useMemo(() => likedSyncProviders.map((item) => ({ ...item, label: t(item.labelKey) })), [t]);
  const getLikedTrackSourceLabel = useCallback(
    (provider: LikedTrackSourceProvider): string => likedTrackSourceOptions.find((item) => item.provider === provider)?.label ?? provider,
    [likedTrackSourceOptions],
  );
  const getLikedSyncProviderLabel = useCallback(
    (provider: LikedSyncProvider): string => likedSyncProviderOptions.find((item) => item.provider === provider)?.label ?? provider,
    [likedSyncProviderOptions],
  );
  const tracks = useMemo(() => trackItems.map((item) => itemToTrack(item, t)), [t, trackItems]);
  const albums = useMemo(() => albumItems.map((item) => itemToAlbum(item, t)), [albumItems, t]);
  const likedQueueSource = useMemo<QueueSource>(() => {
    const sourceLabel = getLikedTrackSourceLabel(trackSourceProvider);
    return {
      type: 'liked',
      label: t('likedPage.queue.label', { source: sourceLabel }),
      sourceProvider: trackSourceProvider,
      search: search || undefined,
      sort,
    };
  }, [getLikedTrackSourceLabel, search, sort, t, trackSourceProvider]);
  const likedTrackMap = useMemo(() => Object.fromEntries(tracks.map((track) => [track.id, true])), [tracks]);
  const isLoading = isTrackLoading || isAlbumLoading;
  const { wallRef: likedAlbumWallRef, spacerHeight: likedAlbumSpacerHeight } = useMediaWallScrollSpacer<HTMLElement>({
    itemCount: albums.length,
    totalCount: albumTotal,
    minColumnWidth: 164,
    columnGap: 14,
    rowGap: 14,
    estimatedItemHeight: 214,
  });

  const loadTracks = useCallback(
    async (nextPage: number, mode: 'replace' | 'append', sourceProvider = trackSourceProviderRef.current): Promise<void> => {
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

        const result: LibraryPage<LibraryPlaylistItem> = await library.getLikedTracks({
          page: nextPage,
          pageSize,
          search,
          sort,
          sourceProvider,
        });

        if (trackRequestIdRef.current !== requestId) {
          return;
        }

        setTrackItems((current) => (mode === 'append' ? [...current, ...result.items] : result.items));
        setTrackPage(result.page);
        setTrackTotal(result.total);
        setTrackHasMore(result.hasMore);
      } catch (loadError) {
        if (trackRequestIdRef.current === requestId) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (trackRequestIdRef.current === requestId) {
          setIsTrackLoading(false);
        }
      }
    },
    [search, sort],
  );

  const loadAlbums = useCallback(
    async (nextPage: number, mode: 'replace' | 'append'): Promise<void> => {
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
          sort,
          sourceProvider: 'local',
        });

        if (albumRequestIdRef.current !== requestId) {
          return;
        }

        setAlbumItems((current) => (mode === 'append' ? [...current, ...result.items] : result.items));
        setAlbumPage(result.page);
        setAlbumTotal(result.total);
        setAlbumHasMore(result.hasMore);
      } catch (loadError) {
        if (albumRequestIdRef.current === requestId) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (albumRequestIdRef.current === requestId) {
          setIsAlbumLoading(false);
        }
      }
    },
    [search, sort],
  );

  useEffect(() => {
    void loadTracks(1, 'replace');
    void loadAlbums(1, 'replace');
  }, [loadAlbums, loadTracks, trackSourceProvider]);

  useEffect(() => {
    const reloadTracks = (): void => void loadTracks(1, 'replace');
    const reloadAlbums = (): void => void loadAlbums(1, 'replace');
    window.addEventListener(likedTracksChangedEvent, reloadTracks);
    window.addEventListener(likedAlbumsChangedEvent, reloadAlbums);
    return () => {
      window.removeEventListener(likedTracksChangedEvent, reloadTracks);
      window.removeEventListener(likedAlbumsChangedEvent, reloadAlbums);
    };
  }, [loadAlbums, loadTracks]);

  useLayoutEffect(() => {
    writePageScrollTop(pageRootRef.current, 0);
  }, [search, sort, tab, trackSourceProvider]);

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

    void loadAlbums(albumPage + 1, 'append');
  }, [albumHasMore, albumPage, isAlbumLoading, loadAlbums]);

  const handlePlayAll = useCallback(async (): Promise<void> => {
    const playable = tracks.filter((track) => !track.unavailable && track.path);
    if (playable.length === 0) {
      setError(t('likedPage.message.noPlayableTracks'));
      return;
    }

    await playTrack(playable[0], {
      replaceQueueWith: playable,
      source: likedQueueSource,
    });
    if (playable.length < tracks.length) {
      setError(t('likedPage.message.skippedUnavailable'));
    }
  }, [likedQueueSource, playTrack, t, tracks]);

  const handleShuffleAll = useCallback(async (): Promise<void> => {
    const playable = tracks.filter((track) => !track.unavailable && track.path).sort(() => Math.random() - 0.5);
    if (playable.length === 0) {
      setError(t('likedPage.message.noPlayableTracks'));
      return;
    }

    await playTrack(playable[0], {
      replaceQueueWith: playable,
      source: likedQueueSource,
    });
  }, [likedQueueSource, playTrack, t, tracks]);

  const selectTrackSourceProvider = useCallback((provider: LikedTrackSourceProvider): void => {
    trackSourceProviderRef.current = provider;
    setTrackSourceProvider(provider);
    setSyncStatus(null);
    setError(null);
  }, []);

  const handleSyncLikedSongs = useCallback(
    async (provider: LikedSyncProvider): Promise<void> => {
      const streaming = window.echo?.streaming;
      const providerLabel = getLikedSyncProviderLabel(provider);
      selectTrackSourceProvider(provider);
      setTab('tracks');
      if (!streaming?.syncLikedSongs) {
        setError(t('likedPage.message.syncUnavailable'));
        return;
      }

      setSyncingLikedProvider(provider);
      setSyncStatus(null);
      setError(null);
      try {
        const result = await streaming.syncLikedSongs(provider);
        const providerResult = result.providers.find((item) => item.provider === provider);
        if (providerResult && !providerResult.success) {
          throw new Error(providerResult.error ?? t('likedPage.message.syncFailed', { provider: providerLabel }));
        }

        const importedCount = providerResult?.importedCount ?? result.importedCount;
        const addedCount = providerResult?.addedCount ?? result.addedCount;
        setSyncStatus(t('likedPage.message.synced', { provider: providerLabel, imported: importedCount, added: addedCount }));
        window.dispatchEvent(new Event(likedTracksChangedEvent));
        window.dispatchEvent(new Event(likedChangedEvent));
      } catch (syncError) {
        setError(syncError instanceof Error ? syncError.message : String(syncError));
      } finally {
        setSyncingLikedProvider(null);
      }
    },
    [getLikedSyncProviderLabel, selectTrackSourceProvider, t],
  );

  const handleTrackSourceClick = useCallback(
    (provider: LikedTrackSourceProvider): void => {
      if (provider === 'local') {
        selectTrackSourceProvider(provider);
        setTab('tracks');
        return;
      }

      void handleSyncLikedSongs(provider);
    },
    [handleSyncLikedSongs, selectTrackSourceProvider],
  );

  const handleToggleTrackLiked = useCallback(async (track: LibraryTrack): Promise<void> => {
    if (track.mediaType === 'streaming' && isLikedStreamingProvider(track.provider) && track.providerTrackId) {
      const streaming = window.echo?.streaming;
      if (!streaming?.setTrackLiked) {
        throw new Error(t('likedPage.error.streamingUnavailable'));
      }

      await streaming.setTrackLiked({
        provider: track.provider,
        providerTrackId: track.providerTrackId,
        liked: false,
      });
    } else {
      await window.echo.library.unlikeTrack(track.id);
    }
    setTrackItems((current) => current.filter((item) => (item.mediaId ?? item.id) !== track.id));
    setTrackTotal((current) => Math.max(0, current - 1));
    window.dispatchEvent(new Event(likedTracksChangedEvent));
    window.dispatchEvent(new Event(likedChangedEvent));
  }, [t]);

  const handleExportLikedTracks = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.getLikedSongsPlaylist || !library.exportPlaylist) {
      setError(t('likedPage.message.exportBridgeUnavailable'));
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
        sourceProvider: trackSourceProvider,
      });
      const sourceLabel = getLikedTrackSourceLabel(trackSourceProvider);
      setSyncStatus(exportedPath ? t('likedPage.message.exported', { source: sourceLabel, path: exportedPath }) : t('likedPage.message.exportCancelled'));
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
      setSyncStatus(null);
    } finally {
      setIsExportingLikedTracks(false);
    }
  }, [getLikedTrackSourceLabel, likedExportFormat, t, trackSourceProvider]);

  const handleToggleAlbumLiked = useCallback(async (album: LibraryAlbum): Promise<void> => {
    await window.echo.library.unlikeAlbum(album.id);
    setAlbumItems((current) => current.filter((item) => (item.mediaId ?? item.id) !== album.id));
    setAlbumTotal((current) => Math.max(0, current - 1));
    window.dispatchEvent(new Event(likedAlbumsChangedEvent));
    window.dispatchEvent(new Event(likedChangedEvent));
  }, []);

  const handleClear = useCallback(async (): Promise<void> => {
    if (tab === 'tracks') {
      if (!window.confirm(t('likedPage.confirm.clearTracks'))) {
        return;
      }
      await window.echo.library.clearLikedTracks({ sourceProvider: 'local' });
      setTrackItems([]);
      setTrackTotal(0);
      window.dispatchEvent(new Event(likedTracksChangedEvent));
    } else {
      if (!window.confirm(t('likedPage.confirm.clearAlbums'))) {
        return;
      }
      await window.echo.library.clearLikedAlbums({ sourceProvider: 'local' });
      setAlbumItems([]);
      setAlbumTotal(0);
      window.dispatchEvent(new Event(likedAlbumsChangedEvent));
    }
    window.dispatchEvent(new Event(likedChangedEvent));
  }, [t, tab]);

  if (selectedAlbum) {
    return <AlbumDetailView album={selectedAlbum} onBack={() => setSelectedAlbum(null)} />;
  }

  return (
    <div ref={pageRootRef} className={`liked-page liked-page--${tab}`}>
      <header className="liked-hero">
        <div>
          <span className="queue-kicker">{t('likedPage.kicker')}</span>
          <h1>{t('likedPage.title')}</h1>
          <p>{t('likedPage.summary', { tracks: trackTotal, albums: albumTotal })}</p>
        </div>
      </header>

      <div className="liked-tabs" role="tablist">
        <button
          className={tab === 'tracks' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={tab === 'tracks'}
          onClick={() => setTab('tracks')}
        >
          {t('likedPage.tab.tracks')}
        </button>
        <button className={tab === 'albums' ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === 'albums'} onClick={() => setTab('albums')}>
          {t('likedPage.tab.albums')}
        </button>
      </div>

      <div className="songs-control-row">
        <label className="search-box">
          <Search size={18} aria-hidden="true" />
          <input type="search" placeholder={t('likedPage.search.placeholder')} {...searchInputProps} />
        </label>

        <StyledSelect
          className="liked-sort-control"
          value={sort}
          options={sortOptions}
          onChange={setSort}
          ariaLabel={t('likedPage.sort.aria')}
        />
      </div>

      <div className="liked-actions">
        {tab === 'tracks' ? (
          <>
            <div className="liked-sync-actions" aria-label={t('likedPage.source.aria')}>
              {likedTrackSourceOptions.map((item) => {
                const isLocal = item.provider === 'local';
                const isActive = trackSourceProvider === item.provider;
                const isSyncing = !isLocal && syncingLikedProvider === item.provider;
                return (
                  <button
                    className={`queue-tool-button ${isActive ? 'is-active' : ''}`}
                    type="button"
                    key={item.provider}
                    disabled={syncingLikedProvider !== null}
                    aria-pressed={isActive}
                    title={isLocal ? t('likedPage.source.localTitle') : t('likedPage.source.syncTitle', { provider: item.label })}
                    onClick={() => handleTrackSourceClick(item.provider)}
                  >
                    {isSyncing ? <Loader2 className="spinning-icon" size={16} /> : isLocal ? <Disc3 size={16} /> : <RefreshCw size={16} />}
                    {item.label}
                  </button>
                );
              })}
            </div>
            <button className="queue-tool-button" type="button" disabled={tracks.length === 0} onClick={() => void handlePlayAll()}>
              <Play size={16} fill="currentColor" /> {t('likedPage.action.playAll')}
            </button>
            <button className="queue-tool-button" type="button" disabled={tracks.length === 0} onClick={() => void handleShuffleAll()}>
              <Shuffle size={16} /> {t('likedPage.action.shuffle')}
            </button>
            <StyledSelect
              className="liked-sort-control"
              value={likedExportFormat}
              options={likedExportOptions}
              onChange={setLikedExportFormat}
              ariaLabel={t('likedPage.export.aria')}
            />
            <button className="queue-tool-button" type="button" disabled={isExportingLikedTracks} onClick={() => void handleExportLikedTracks()}>
              {isExportingLikedTracks ? <Loader2 className="spinning-icon" size={16} /> : <Download size={16} />}
              {isExportingLikedTracks ? t('likedPage.action.exporting') : t('likedPage.action.export')}
            </button>
          </>
        ) : null}
        <button
          className="queue-tool-button danger"
          type="button"
          disabled={tab === 'tracks' ? trackSourceProvider !== 'local' || trackTotal === 0 : albumTotal === 0}
          onClick={() => void handleClear()}
        >
          <Trash2 size={16} /> {t('likedPage.action.clear')}
        </button>
      </div>

      {tab === 'tracks' ? (
        tracks.length > 0 ? (
          <TrackList
            key={`${trackSourceProvider}:${search}:${sort}`}
            tracks={tracks}
            currentTrackId={currentTrackId}
            canLoadMore={trackHasMore && !isTrackLoading}
            isLoadingMore={isTrackLoading}
            totalCount={trackTotal}
            loadedCount={tracks.length}
            likedTrackIds={likedTrackMap}
            onEndReached={() => void loadTracks(trackPage + 1, 'append')}
            onPlay={(track) => void playTrack(track, { replaceQueueWith: tracks.filter((item) => !item.unavailable), source: likedQueueSource })}
            onToggleLiked={(track) => void handleToggleTrackLiked(track)}
          />
        ) : (
          <div className="queue-empty-state"><Heart size={24} /><strong>{t('likedPage.empty.tracks.title')}</strong><span>{t('likedPage.empty.description')}</span></div>
        )
      ) : (
        <>
          <section ref={likedAlbumWallRef} className="album-wall liked-album-wall" aria-label={t('likedPage.albumWall.aria')}>
            {albums.length > 0 ? albums.map((album) => {
              const item = albumItems.find((candidate) => (candidate.mediaId ?? candidate.id) === album.id);
              const unavailable = item?.unavailable === true || !item?.album;
              return (
                <article className="album-card" data-unavailable={unavailable ? 'true' : undefined} key={item?.id ?? album.id} role="button" tabIndex={0} onClick={() => !unavailable && openAlbumDetail(album)}>
                  <div className="album-cover" data-empty={!album.coverThumb} aria-hidden="true">
                    {album.coverThumb ? <img alt="" decoding="async" draggable={false} height={320} loading="lazy" src={album.coverThumb} width={320} /> : <Disc3 size={24} />}
                  </div>
                  <div className="album-copy">
                    <strong>{album.title}</strong>
                    <span>{album.albumArtist}</span>
                    <small>{unavailable ? t('likedPage.album.unavailable') : t('likedPage.album.trackCount', { count: album.trackCount })}</small>
                  </div>
                  <button className="album-card-like is-liked" type="button" aria-label={t('likedPage.album.unlikeAria', { title: album.title })} aria-pressed="true" onClick={(event) => { event.stopPropagation(); void handleToggleAlbumLiked(album); }}>
                    <Heart size={16} fill="currentColor" />
                  </button>
                </article>
              );
            }) : <div className="queue-empty-state"><Heart size={24} /><strong>{t('likedPage.empty.albums.title')}</strong><span>{t('likedPage.empty.description')}</span></div>}
          </section>
          <InfiniteScrollSentinel canLoadMore={albumHasMore} isLoading={isAlbumLoading} onLoadMore={handleLoadMoreAlbums} />
        </>
      )}

      {error || syncStatus || isLoading || isExportingLikedTracks ? <div className="list-footer"><span>{error ?? syncStatus ?? (isExportingLikedTracks ? t('likedPage.message.exporting') : t('likedPage.message.loading'))}</span></div> : null}
      {tab === 'albums' ? <MediaWallScrollSpacer height={likedAlbumSpacerHeight} /> : null}
    </div>
  );
};
