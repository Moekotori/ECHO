import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Disc3, Heart, Play, Search, Shuffle, Trash2 } from 'lucide-react';
import type { LibraryAlbum, LibraryPage, LibraryPlaylistItem, LibrarySort, LibraryTrack } from '../../shared/types/library';
import type { StreamingProviderName } from '../../shared/types/streaming';
import { AlbumDetailView } from '../components/album/AlbumDetailView';
import { TrackList } from '../components/library/TrackList';
import { InfiniteScrollSentinel, readPageScrollTop, writePageScrollTop } from '../components/ui/InfiniteScrollSentinel';
import { MediaWallScrollSpacer, useMediaWallScrollSpacer } from '../components/ui/MediaWallScrollSpacer';
import { StyledSelect } from '../components/ui/StyledSelect';
import { likedAlbumsChangedEvent, likedChangedEvent, likedTracksChangedEvent } from '../hooks/useLikedMedia';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { useImeAwareDebouncedSearch } from '../utils/imeInput';

const pageSize = 100;
const sortOptions: Array<{ value: LibrarySort; label: string }> = [
  { value: 'recent', label: '最近喜欢' },
  { value: 'default', label: '手动排序' },
  { value: 'titleAsc', label: '标题 A-Z' },
  { value: 'titleDesc', label: '标题 Z-A' },
  { value: 'artist', label: '艺人' },
  { value: 'album', label: '专辑' },
];

type LikedTab = 'tracks' | 'albums';

const isLikedStreamingProvider = (provider: string | null | undefined): provider is Extract<StreamingProviderName, 'netease' | 'qqmusic'> =>
  provider === 'netease' || provider === 'qqmusic';

const itemToTrack = (item: LibraryPlaylistItem): LibraryTrack => {
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
    title: item.titleSnapshot ?? '不可用歌曲',
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

const itemToAlbum = (item: LibraryPlaylistItem): LibraryAlbum => {
  if (item.album) {
    return item.album;
  }

  return {
    id: item.mediaId ?? item.id,
    albumKey: item.mediaId ?? item.id,
    title: item.titleSnapshot ?? item.albumSnapshot ?? '不可用专辑',
    albumArtist: item.artistSnapshot ?? 'Unknown Artist',
    year: null,
    trackCount: 0,
    duration: item.durationSnapshot ?? 0,
    coverId: item.coverId,
    coverThumb: item.coverThumb,
  };
};

export const LikedPage = (): JSX.Element => {
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
  const [isTrackLoading, setIsTrackLoading] = useState(false);
  const [isAlbumLoading, setIsAlbumLoading] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<LibraryAlbum | null>(null);
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const pageScrollTopRef = useRef(0);
  const shouldRestorePageScrollRef = useRef(false);
  const trackRequestIdRef = useRef(0);
  const albumRequestIdRef = useRef(0);
  const { currentTrackId, playTrack, replaceQueue } = usePlaybackQueue();

  const tracks = useMemo(() => trackItems.map(itemToTrack), [trackItems]);
  const albums = useMemo(() => albumItems.map(itemToAlbum), [albumItems]);
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
    async (nextPage: number, mode: 'replace' | 'append'): Promise<void> => {
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
          sourceProvider: 'local',
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
  }, [loadAlbums, loadTracks]);

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
  }, [search, sort, tab]);

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
      setError('没有可播放的喜欢歌曲。');
      return;
    }

    replaceQueue(playable, { startTrackId: playable[0].id, source: { type: 'manual', label: '喜欢的歌曲' } });
    await playTrack(playable[0], { source: { type: 'manual', label: '喜欢的歌曲' } });
    if (playable.length < tracks.length) {
      setError('部分文件不可用，播放时已跳过。');
    }
  }, [playTrack, replaceQueue, tracks]);

  const handleShuffleAll = useCallback(async (): Promise<void> => {
    const playable = tracks.filter((track) => !track.unavailable && track.path).sort(() => Math.random() - 0.5);
    if (playable.length === 0) {
      setError('没有可播放的喜欢歌曲。');
      return;
    }

    replaceQueue(playable, { startTrackId: playable[0].id, source: { type: 'manual', label: '喜欢的歌曲' } });
    await playTrack(playable[0], { source: { type: 'manual', label: '喜欢的歌曲' } });
  }, [playTrack, replaceQueue, tracks]);

  const handleToggleTrackLiked = useCallback(async (track: LibraryTrack): Promise<void> => {
    if (track.mediaType === 'streaming' && isLikedStreamingProvider(track.provider) && track.providerTrackId) {
      const streaming = window.echo?.streaming;
      if (!streaming?.setTrackLiked) {
        throw new Error('Streaming liked tracks are unavailable.');
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
  }, []);

  const handleToggleAlbumLiked = useCallback(async (album: LibraryAlbum): Promise<void> => {
    await window.echo.library.unlikeAlbum(album.id);
    setAlbumItems((current) => current.filter((item) => (item.mediaId ?? item.id) !== album.id));
    setAlbumTotal((current) => Math.max(0, current - 1));
    window.dispatchEvent(new Event(likedAlbumsChangedEvent));
    window.dispatchEvent(new Event(likedChangedEvent));
  }, []);

  const handleClear = useCallback(async (): Promise<void> => {
    if (tab === 'tracks') {
      if (!window.confirm('清空喜欢的歌曲？')) {
        return;
      }
      await window.echo.library.clearLikedTracks({ sourceProvider: 'local' });
      setTrackItems([]);
      setTrackTotal(0);
      window.dispatchEvent(new Event(likedTracksChangedEvent));
    } else {
      if (!window.confirm('清空喜欢的专辑？')) {
        return;
      }
      await window.echo.library.clearLikedAlbums({ sourceProvider: 'local' });
      setAlbumItems([]);
      setAlbumTotal(0);
      window.dispatchEvent(new Event(likedAlbumsChangedEvent));
    }
    window.dispatchEvent(new Event(likedChangedEvent));
  }, [tab]);

  if (selectedAlbum) {
    return <AlbumDetailView album={selectedAlbum} onBack={() => setSelectedAlbum(null)} />;
  }

  return (
    <div ref={pageRootRef} className="liked-page">
      <header className="liked-hero">
        <div>
          <span className="queue-kicker">Library</span>
          <h1>喜欢</h1>
          <p>{trackTotal} 首歌曲 · {albumTotal} 张专辑</p>
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
          喜欢的歌曲
        </button>
        <button className={tab === 'albums' ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === 'albums'} onClick={() => setTab('albums')}>
          喜欢的专辑
        </button>
      </div>

      <div className="songs-control-row">
        <label className="search-box">
          <Search size={18} aria-hidden="true" />
          <input type="search" placeholder="搜索喜欢的音乐" {...searchInputProps} />
        </label>

        <StyledSelect
          className="liked-sort-control"
          value={sort}
          options={sortOptions}
          onChange={setSort}
          ariaLabel="鍠滄鎺掑簭"
        />
      </div>

      <div className="liked-actions">
        {tab === 'tracks' ? (
          <>
            <button className="queue-tool-button" type="button" disabled={tracks.length === 0} onClick={() => void handlePlayAll()}>
              <Play size={16} fill="currentColor" /> 播放全部
            </button>
            <button className="queue-tool-button" type="button" disabled={tracks.length === 0} onClick={() => void handleShuffleAll()}>
              <Shuffle size={16} /> 随机播放
            </button>
          </>
        ) : null}
        <button className="queue-tool-button danger" type="button" disabled={(tab === 'tracks' ? trackTotal : albumTotal) === 0} onClick={() => void handleClear()}>
          <Trash2 size={16} /> 清空
        </button>
      </div>

      {tab === 'tracks' ? (
        tracks.length > 0 ? (
          <TrackList
            tracks={tracks}
            currentTrackId={currentTrackId}
            canLoadMore={trackHasMore && !isTrackLoading}
            likedTrackIds={likedTrackMap}
            onEndReached={() => void loadTracks(trackPage + 1, 'append')}
            onPlay={(track) => void playTrack(track, { replaceQueueWith: tracks.filter((item) => !item.unavailable), source: { type: 'manual', label: '喜欢的歌曲' } })}
            onToggleLiked={(track) => void handleToggleTrackLiked(track)}
          />
        ) : (
          <div className="queue-empty-state"><Heart size={24} /><strong>还没有喜欢的歌曲</strong><span>在歌曲或专辑页面点击爱心即可收藏到这里</span></div>
        )
      ) : (
        <>
          <section ref={likedAlbumWallRef} className="album-wall liked-album-wall" aria-label="喜欢的专辑">
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
                    <small>{unavailable ? '专辑不可用' : `${album.trackCount} tracks`}</small>
                  </div>
                  <button className="album-card-like is-liked" type="button" aria-label={`Unlike ${album.title}`} aria-pressed="true" onClick={(event) => { event.stopPropagation(); void handleToggleAlbumLiked(album); }}>
                    <Heart size={16} fill="currentColor" />
                  </button>
                </article>
              );
            }) : <div className="queue-empty-state"><Heart size={24} /><strong>还没有喜欢的专辑</strong><span>在歌曲或专辑页面点击爱心即可收藏到这里</span></div>}
          </section>
          <InfiniteScrollSentinel canLoadMore={albumHasMore} isLoading={isAlbumLoading} onLoadMore={handleLoadMoreAlbums} />
        </>
      )}

      {error || isLoading ? <div className="list-footer"><span>{error ?? '正在读取喜欢的音乐...'}</span></div> : null}
      {tab === 'albums' ? <MediaWallScrollSpacer height={likedAlbumSpacerHeight} /> : null}
    </div>
  );
};
