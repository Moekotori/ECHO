import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Disc3, Folder, FolderOpen, ListMusic, ListPlus, RefreshCw, Search, UserRound } from 'lucide-react';
import type {
  LibraryInboxAlbumSummary,
  LibraryInboxBatch,
  LibraryInboxFilterKind,
  LibraryInboxItemStatus,
  LibraryInboxIssueReason,
  LibraryInboxScope,
  LibraryInboxStatusFilter,
  LibraryInboxTrackItem,
  LibraryInboxTrackPage,
} from '../../shared/types/library';
import { useI18n } from '../i18n/I18nProvider';
import { getLibraryBridge } from '../utils/echoBridge';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { useImeAwareDebouncedSearch } from '../utils/imeInput';

const pageSize = 60;

const emptyInboxPage = (scope: LibraryInboxScope, filter: LibraryInboxFilterKind): LibraryInboxTrackPage => ({
  items: [],
  page: 1,
  pageSize,
  total: 0,
  hasMore: false,
  batches: [],
  selectedBatch: null,
  scope,
  filter,
  status: 'all',
  story: {
    trackCount: 0,
    albumCount: 0,
    artistCount: 0,
    folderCount: 0,
    missingCoverCount: 0,
    metadataIssueCount: 0,
    unknownArtistCount: 0,
    unknownAlbumCount: 0,
    suspiciousCount: 0,
    pendingCount: 0,
    processedCount: 0,
    ignoredCount: 0,
    coverCompleteness: 0,
    metadataCompleteness: 0,
    totalDuration: 0,
    topFolders: [],
    topArtists: [],
  },
  albums: [],
  facets: {
    folders: [],
    albums: [],
    artists: [],
  },
});

const filterOptions: Array<{ value: LibraryInboxFilterKind; label: string }> = [
  { value: 'all', label: '全部新增' },
  { value: 'missing_cover', label: '缺封面' },
  { value: 'metadata_issue', label: '资料异常' },
  { value: 'unknown_artist', label: '未知艺人' },
  { value: 'unknown_album', label: '未知专辑' },
  { value: 'suspicious_file', label: '疑似异常' },
];

const statusOptions: Array<{ value: LibraryInboxStatusFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待处理' },
  { value: 'processed', label: '已处理' },
  { value: 'ignored', label: '已忽略' },
];

const reasonLabels: Record<LibraryInboxIssueReason, string> = {
  missing_cover: '缺封面',
  missing_title: '缺标题',
  missing_artist: '缺艺人',
  missing_album: '缺专辑',
  missing_album_artist: '缺专辑艺人',
  missing_track_no: '缺音轨号',
  missing_disc_no: '缺碟号',
  missing_year: '缺年份',
  missing_genre: '缺流派',
  unknown_artist: '未知艺人',
  filename_fallback: '文件名回退',
  unknown_field: '未知字段',
  metadata_fallback: '元数据回退',
  unknown_album: '未知专辑',
  embedded_metadata_error: '内嵌标签读取失败',
  embedded_cover_error: '内嵌封面读取失败',
  network_metadata_candidate: '网络元数据候选',
  network_cover_candidate: '网络封面候选',
  suspicious_file: '疑似异常',
};

const formatReason = (reason: LibraryInboxIssueReason): string => reasonLabels[reason] ?? reason;

const statusLabels: Record<LibraryInboxItemStatus, string> = {
  pending: '待处理',
  processed: '已处理',
  ignored: '已忽略',
};

const formatDateTime = (value: string | null | undefined, emptyLabel = '尚无记录'): string => {
  if (!value) {
    return emptyLabel;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
};

const folderLabel = (batch: LibraryInboxBatch | null): string => batch?.folderName ?? '最近新增';

const batchSelectValue = (scope: LibraryInboxScope, batchId: string | null): string =>
  scope === 'all' ? '__all__' : scope === 'latest' ? '__latest__' : batchId ?? '__latest__';

const readTrackPath = (item: LibraryInboxTrackItem): string => item.track.path;

const formatDurationHours = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0h';
  }

  const hours = seconds / 3600;
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
};

const buildStoryLine = (
  scopeLabel: string,
  story: LibraryInboxTrackPage['story'],
  t: ReturnType<typeof useI18n>['t'],
): string => {
  if (story.trackCount <= 0) {
    return t('inboxPage.story.empty');
  }

  const pieces = [
    t('inboxPage.story.summaryTracks', { scope: scopeLabel, count: story.trackCount }),
    t('inboxPage.story.summaryAlbums', { count: story.albumCount }),
    t('inboxPage.story.summaryArtists', { count: story.artistCount }),
  ];
  const warnings = [
    story.missingCoverCount > 0 ? t('inboxPage.story.warningMissingCover', { count: story.missingCoverCount }) : null,
    story.metadataIssueCount > 0 ? t('inboxPage.story.warningMetadataIssue', { count: story.metadataIssueCount }) : null,
  ].filter((value): value is string => Boolean(value));

  return warnings.length > 0
    ? t('inboxPage.story.withWarnings', { summary: pieces.join('、'), warnings: warnings.join('、') })
    : t('inboxPage.story.clean', { summary: pieces.join('、') });
};

const albumKey = (album: LibraryInboxAlbumSummary): string => `${album.album}\0${album.albumArtist}`;

const inboxItemKey = (item: Pick<LibraryInboxTrackItem, 'batchId' | 'track'>): string => `${item.batchId}\0${item.track.id}`;

const formatPercent = (value: number): string => `${Math.max(0, Math.min(100, Math.round(value)))}%`;

export const InboxPage = (): JSX.Element => {
  const { t } = useI18n();
  const queue = usePlaybackQueue();
  const [scope, setScope] = useState<LibraryInboxScope>('latest');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryInboxFilterKind>('all');
  const [status, setStatus] = useState<LibraryInboxStatusFilter>('all');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [album, setAlbum] = useState<string | null>(null);
  const [artist, setArtist] = useState<string | null>(null);
  const {
    search,
    searchInputProps,
    setSearch,
    setSearchInput,
  } = useImeAwareDebouncedSearch(220);
  const [pageData, setPageData] = useState<LibraryInboxTrackPage>(() => emptyInboxPage('latest', 'all'));
  const [items, setItems] = useState<LibraryInboxTrackItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [isAddingToQueue, setIsAddingToQueue] = useState(false);
  const [isUpdatingState, setIsUpdatingState] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Record<string, LibraryInboxTrackItem>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const localizedFilterOptions = useMemo<Array<{ value: LibraryInboxFilterKind; label: string }>>(
    () => [
      { value: 'all', label: t('inboxPage.filter.all') },
      { value: 'missing_cover', label: t('inboxPage.filter.missingCover') },
      { value: 'metadata_issue', label: t('inboxPage.filter.metadataIssue') },
      { value: 'unknown_artist', label: t('inboxPage.filter.unknownArtist') },
      { value: 'unknown_album', label: t('inboxPage.filter.unknownAlbum') },
      { value: 'suspicious_file', label: t('inboxPage.filter.suspiciousFile') },
    ],
    [t],
  );

  const localizedStatusOptions = useMemo<Array<{ value: LibraryInboxStatusFilter; label: string }>>(
    () => [
      { value: 'all', label: t('inboxPage.status.all') },
      { value: 'pending', label: t('inboxPage.status.pending') },
      { value: 'processed', label: t('inboxPage.status.processed') },
      { value: 'ignored', label: t('inboxPage.status.ignored') },
    ],
    [t],
  );

  const loadInbox = useCallback(
    async (nextPage: number, mode: 'replace' | 'append'): Promise<void> => {
      const library = getLibraryBridge();
      if (!library?.getLibraryInboxTracks) {
        setPageData(emptyInboxPage(scope, filter));
        setItems([]);
        setError(t('inboxPage.error.desktopBridgeRead'));
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setIsLoading(true);
      setError(null);

      try {
        const result = await library.getLibraryInboxTracks({
          scope,
          batchId: scope === 'batch' ? batchId : null,
          filter,
          status,
          folderId,
          album,
          artist,
          page: nextPage,
          pageSize,
          search,
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        setPageData(result);
        setItems((current) => (mode === 'append' ? [...current, ...result.items] : result.items));
      } catch (loadError) {
        if (requestIdRef.current === requestId) {
          setPageData(emptyInboxPage(scope, filter));
          setItems([]);
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }
    },
    [album, artist, batchId, filter, folderId, scope, search, status, t],
  );

  useEffect(() => {
    void loadInbox(1, 'replace');
  }, [loadInbox]);

  useEffect(() => {
    setSelectedItems({});
  }, [album, artist, batchId, filter, folderId, scope, search, status]);

  useEffect(() => {
    const unsubscribe = getLibraryBridge()?.onLibraryChanged?.(() => {
      void loadInbox(1, 'replace');
    });

    return () => unsubscribe?.();
  }, [loadInbox]);

  const selectedBatch = pageData.selectedBatch;
  const story = pageData.story;
  const albumSummaries = pageData.albums;
  const hasFilters = filter !== 'all' || status !== 'all' || Boolean(folderId || album || artist || search);
  const visibleCount = items.length;
  const selectedItemList = useMemo(() => Object.values(selectedItems), [selectedItems]);
  const selectedCount = selectedItemList.length;
  const allVisibleSelected = items.length > 0 && items.every((item) => Boolean(selectedItems[inboxItemKey(item)]));

  const currentInboxQuery = useMemo(
    () => ({
      scope,
      batchId: scope === 'batch' ? batchId : null,
      filter,
      status,
      folderId,
      album,
      artist,
      search,
    }),
    [album, artist, batchId, filter, folderId, scope, search, status],
  );

  const selectedScopeLabel = useMemo(() => {
    if (scope === 'all') {
      return t('inboxPage.batch.recentAll');
    }
    if (scope === 'latest') {
      return t('inboxPage.batch.latest');
    }
    return selectedBatch?.folderName ?? t('inboxPage.batch.selected');
  }, [scope, selectedBatch, t]);

  const storyLine = useMemo(() => buildStoryLine(selectedScopeLabel, story, t), [selectedScopeLabel, story, t]);

  const handleSelectBatch = (value: string): void => {
    setMessage(null);
    setFolderId(null);
    setAlbum(null);
    setArtist(null);

    if (value === '__all__') {
      setScope('all');
      setBatchId(null);
      return;
    }
    if (value === '__latest__') {
      setScope('latest');
      setBatchId(null);
      return;
    }

    setScope('batch');
    setBatchId(value);
  };

  const handleCreatePlaylist = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.createPlaylistFromLibraryInbox) {
      setError('桌面桥接暂不可用，无法生成歌单。');
      return;
    }

    setIsCreatingPlaylist(true);
    setMessage(null);
    setError(null);

    try {
      const result = await library.createPlaylistFromLibraryInbox({
        ...currentInboxQuery,
        name: '新歌待听清单',
      });
      const suffix = result.truncated ? `，已按性能保护加入前 ${result.limit} 首` : '';
      setMessage(`已生成歌单「${result.playlist.name}」，加入 ${result.addedCount} 首${suffix}。`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setIsCreatingPlaylist(false);
    }
  }, [currentInboxQuery]);

  const handleAddToQueue = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    const source = { type: 'manual' as const, label: '新歌收件箱' };

    setIsAddingToQueue(true);
    setMessage(null);
    setError(null);

    try {
      if (selectedItemList.length > 0) {
        queue.appendTracksToQueue(selectedItemList.map((item) => item.track), source);
        setMessage(`已加入队列 ${selectedItemList.length} 首。`);
        return;
      }

      if (!library?.addLibraryInboxToQueue) {
        setError('桌面桥接暂不可用，无法加入队列。');
        return;
      }

      const result = await library.addLibraryInboxToQueue(currentInboxQuery);
      if (result.tracks.length === 0) {
        setError('当前筛选没有可加入队列的本地歌曲。');
        return;
      }

      queue.appendTracksToQueue(result.tracks, source);
      const suffix = result.truncated ? `，已按性能保护加入前 ${result.limit} 首` : '';
      setMessage(`已加入队列 ${result.addedCount} 首${suffix}。`);
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : String(queueError));
    } finally {
      setIsAddingToQueue(false);
    }
  }, [currentInboxQuery, queue, selectedItemList]);

  const handleUpdateState = useCallback(
    async (nextStatus: LibraryInboxItemStatus): Promise<void> => {
      const library = getLibraryBridge();
      if (!library?.updateLibraryInboxItemState) {
        setError('桌面桥接暂不可用，无法更新收件箱状态。');
        return;
      }

      setIsUpdatingState(true);
      setMessage(null);
      setError(null);

      try {
        const result = await library.updateLibraryInboxItemState({
          status: nextStatus,
          items: selectedItemList.length > 0
            ? selectedItemList.map((item) => ({ batchId: item.batchId, trackId: item.track.id }))
            : undefined,
          query: selectedItemList.length > 0 ? undefined : currentInboxQuery,
        });
        setSelectedItems({});
        await loadInbox(1, 'replace');
        const suffix = result.truncated ? `，已按上限处理前 ${result.limit} 首` : '';
        setMessage(`已标记为${statusLabels[nextStatus]} ${result.updatedCount} 首${suffix}。`);
      } catch (stateError) {
        setError(stateError instanceof Error ? stateError.message : String(stateError));
      } finally {
        setIsUpdatingState(false);
      }
    },
    [currentInboxQuery, loadInbox, selectedItemList],
  );

  const handleOpenTrack = useCallback(async (trackId: string): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.openTrackInFolder) {
      setError('桌面桥接暂不可用，无法定位歌曲。');
      return;
    }

    try {
      await library.openTrackInFolder(trackId);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  }, []);

  const clearFilters = (): void => {
    setFilter('all');
    setStatus('all');
    setFolderId(null);
    setAlbum(null);
    setArtist(null);
    setSearchInput('');
    setSearch('');
    setMessage(null);
  };

  const selectAlbumSummary = (summary: LibraryInboxAlbumSummary): void => {
    setMessage(null);
    setAlbum(summary.album === 'Unknown Album' ? null : summary.album);
    setArtist(null);
  };

  const toggleSelectedItem = (item: LibraryInboxTrackItem): void => {
    const key = inboxItemKey(item);
    setSelectedItems((current) => {
      if (current[key]) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: item };
    });
  };

  const toggleVisibleSelection = (): void => {
    setSelectedItems((current) => {
      if (allVisibleSelected) {
        const next = { ...current };
        items.forEach((item) => {
          delete next[inboxItemKey(item)];
        });
        return next;
      }

      const next = { ...current };
      items.forEach((item) => {
        next[inboxItemKey(item)] = item;
      });
      return next;
    });
  };

  const openSingleSelected = async (): Promise<void> => {
    const selectedItem = selectedItemList[0];
    if (selectedItemList.length !== 1 || !selectedItem) {
      return;
    }
    await handleOpenTrack(selectedItem.track.id);
  };

  return (
    <div className="inbox-page">
      <header className="inbox-hero">
        <div className="inbox-hero-copy">
          <span className="panel-kicker">{t('inboxPage.hero.kicker')}</span>
          <h1>{t('route.inbox.label')}</h1>
          <div className="inbox-hero-meta">
            <span>{selectedScopeLabel}</span>
            <span>{formatDateTime(selectedBatch?.finishedAt ?? pageData.batches[0]?.finishedAt, t('inboxPage.date.none'))}</span>
          </div>
        </div>
        <div className="inbox-stats" aria-label={t('inboxPage.stats.aria')}>
          <span>
            <strong>{pageData.total}</strong>
            <em>{t('inboxPage.stats.currentResults')}</em>
          </span>
          <span>
            <strong>{selectedBatch?.addedCount ?? pageData.batches.reduce((sum, batch) => sum + batch.addedCount, 0)}</strong>
            <em>{t('inboxPage.stats.newSongs')}</em>
          </span>
          <span>
            <strong>{selectedBatch?.missingCoverCount ?? pageData.batches.reduce((sum, batch) => sum + batch.missingCoverCount, 0)}</strong>
            <em>{t('inboxPage.filter.missingCover')}</em>
          </span>
        </div>
      </header>

      <section className="inbox-story-panel" aria-label={t('inboxPage.story.aria')}>
        <div className="inbox-story-copy">
          <span className="panel-kicker">{t('inboxPage.story.kicker')}</span>
          <strong>{storyLine}</strong>
          <div className="inbox-story-tags">
            {story.topFolders.slice(0, 3).map((folder) => (
              <button key={folder.value} onClick={() => setFolderId(folder.value)} type="button">
                {folder.label} · {folder.count}
              </button>
            ))}
            {story.topArtists.slice(0, 3).map((artistFacet) => (
              <button key={artistFacet.value} onClick={() => setArtist(artistFacet.value)} type="button">
                {artistFacet.label} · {artistFacet.count}
              </button>
            ))}
          </div>
        </div>
        <div className="inbox-story-numbers">
          <span>
            <strong>{story.albumCount}</strong>
            <em>{t('inboxPage.story.newAlbums')}</em>
          </span>
          <span>
            <strong>{story.artistCount}</strong>
            <em>{t('inboxPage.story.newArtists')}</em>
          </span>
          <span>
            <strong>{formatDurationHours(story.totalDuration)}</strong>
            <em>{t('inboxPage.story.totalDuration')}</em>
          </span>
        </div>
      </section>

      <section className="inbox-processing-panel" aria-label={t('inboxPage.processing.aria')}>
        <div className="inbox-processing-cards">
          <button
            className="inbox-processing-card"
            data-active={status === 'pending' ? 'true' : undefined}
            onClick={() => {
              setFilter('all');
              setStatus('pending');
            }}
            type="button"
          >
            <Clock3 size={18} />
            <span>
              <strong>{story.pendingCount}</strong>
              <em>{t('inboxPage.processing.pending')}</em>
            </span>
          </button>
          <button
            className="inbox-processing-card"
            data-active={filter === 'missing_cover' ? 'true' : undefined}
            onClick={() => setFilter('missing_cover')}
            type="button"
          >
            <Disc3 size={18} />
            <span>
              <strong>{story.missingCoverCount}</strong>
              <em>{t('inboxPage.filter.missingCover')}</em>
            </span>
          </button>
          <button
            className="inbox-processing-card"
            data-active={filter === 'metadata_issue' ? 'true' : undefined}
            onClick={() => setFilter('metadata_issue')}
            type="button"
          >
            <CheckCircle2 size={18} />
            <span>
              <strong>{story.metadataIssueCount}</strong>
              <em>{t('inboxPage.filter.metadataIssue')}</em>
            </span>
          </button>
          <button
            className="inbox-processing-card"
            data-active={filter === 'suspicious_file' ? 'true' : undefined}
            onClick={() => setFilter('suspicious_file')}
            type="button"
          >
            <AlertTriangle size={18} />
            <span>
              <strong>{story.suspiciousCount}</strong>
              <em>{t('inboxPage.filter.suspiciousFile')}</em>
            </span>
          </button>
        </div>
        <div className="inbox-quality-summary" aria-label={t('inboxPage.quality.aria')}>
          <span>
            <strong>{formatPercent(story.coverCompleteness)}</strong>
            <em>{t('inboxPage.quality.coverCompleteness')}</em>
          </span>
          <span>
            <strong>{formatPercent(story.metadataCompleteness)}</strong>
            <em>{t('inboxPage.quality.metadataCompleteness')}</em>
          </span>
          <span>
            <strong>{story.unknownArtistCount + story.unknownAlbumCount}</strong>
            <em>{t('inboxPage.quality.unknownArtistAlbum')}</em>
          </span>
          <span>
            <strong>{story.processedCount}</strong>
            <em>{t('inboxPage.status.processed')}</em>
          </span>
        </div>
      </section>

      <section className="inbox-toolbar" aria-label={t('inboxPage.toolbar.aria')}>
        <label className="inbox-select-field">
          <span>{t('inboxPage.toolbar.batch')}</span>
          <select value={batchSelectValue(scope, batchId)} onChange={(event) => handleSelectBatch(event.target.value)}>
            <option value="__latest__">{t('inboxPage.batch.latest')}</option>
            <option value="__all__">{t('inboxPage.batch.recentAll')}</option>
            {pageData.batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.folderName} · {batch.addedCount}
              </option>
            ))}
          </select>
        </label>

        <label className="inbox-search-field">
          <Search size={16} />
          <input
            aria-label={t('inboxPage.search.aria')}
            placeholder={t('inboxPage.search.placeholder')}
            type="search"
            {...searchInputProps}
          />
        </label>

        <button className="inbox-icon-button" disabled={isLoading} onClick={() => void loadInbox(1, 'replace')} title={t('home.recommend.refresh')} type="button">
          <RefreshCw size={17} />
        </button>
        <button
          className="inbox-command-button"
          disabled={isCreatingPlaylist || pageData.total === 0}
          onClick={() => void handleCreatePlaylist()}
          type="button"
        >
          <ListPlus size={17} />
          <span>{t('inboxPage.action.generatePlaylist')}</span>
        </button>
        <button
          className="inbox-command-button"
          disabled={isAddingToQueue || pageData.total === 0}
          onClick={() => void handleAddToQueue()}
          type="button"
        >
          <ListMusic size={17} />
          <span>{t('inboxPage.action.addToQueue')}</span>
        </button>
      </section>

      <section className="inbox-filter-row" aria-label={t('inboxPage.filter.aria')}>
        {localizedFilterOptions.map((option) => (
          <button
            className="list-filter-chip"
            data-active={filter === option.value ? 'true' : undefined}
            key={option.value}
            onClick={() => {
              setMessage(null);
              setFilter(option.value);
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
        {hasFilters ? (
          <button className="list-filter-chip" onClick={clearFilters} type="button">
            {t('inboxPage.filter.clear')}
          </button>
        ) : null}
      </section>

      <section className="inbox-filter-row" aria-label={t('inboxPage.status.aria')}>
        {localizedStatusOptions.map((option) => (
          <button
            className="list-filter-chip"
            data-active={status === option.value ? 'true' : undefined}
            key={option.value}
            onClick={() => {
              setMessage(null);
              setStatus(option.value);
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </section>

      <section className="inbox-facet-row" aria-label={t('inboxPage.facets.aria')}>
        <label>
          <Folder size={15} />
          <select value={folderId ?? ''} onChange={(event) => setFolderId(event.target.value || null)}>
            <option value="">{t('inboxPage.facets.allFolders')}</option>
            {pageData.facets.folders.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.label} · {facet.count}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Disc3 size={15} />
          <select value={album ?? ''} onChange={(event) => setAlbum(event.target.value || null)}>
            <option value="">{t('inboxPage.facets.allAlbums')}</option>
            {pageData.facets.albums.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.label} · {facet.count}
              </option>
            ))}
          </select>
        </label>
        <label>
          <UserRound size={15} />
          <select value={artist ?? ''} onChange={(event) => setArtist(event.target.value || null)}>
            <option value="">{t('inboxPage.facets.allArtists')}</option>
            {pageData.facets.artists.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.label} · {facet.count}
              </option>
            ))}
          </select>
        </label>
      </section>

      {albumSummaries.length > 0 ? (
        <section className="inbox-album-wall" aria-label="新增专辑墙">
          <div className="inbox-section-heading">
            <span className="panel-kicker">New Albums</span>
            <strong>新增专辑墙</strong>
          </div>
          <div className="inbox-album-grid">
            {albumSummaries.map((summary) => (
              <button
                className="inbox-album-card"
                key={albumKey(summary)}
                onClick={() => selectAlbumSummary(summary)}
                type="button"
              >
                <span className="inbox-album-art" data-empty={!summary.coverThumb ? 'true' : undefined}>
                  {summary.coverThumb ? <img alt="" loading="lazy" src={summary.coverThumb} /> : <Disc3 size={24} />}
                </span>
                <span className="inbox-album-copy">
                  <strong>{summary.album}</strong>
                  <em>{summary.albumArtist}</em>
                  <small>
                    {summary.trackCount} 首 · {formatDurationHours(summary.duration)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {message ? <div className="inbox-notice">{message}</div> : null}
      {error ? (
        <div className="inbox-notice inbox-notice--error">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {items.length > 0 ? (
        <section className="inbox-bulk-bar" aria-label="收件箱批量操作">
          <button className="inbox-selection-toggle" onClick={toggleVisibleSelection} type="button">
            {allVisibleSelected ? '取消本页选择' : '选择本页'}
          </button>
          <span>{selectedCount > 0 ? `已选 ${selectedCount} 首` : `当前筛选 ${pageData.total} 首`}</span>
          <button className="inbox-command-button" disabled={isAddingToQueue} onClick={() => void handleAddToQueue()} type="button">
            <ListMusic size={16} />
            <span>加入队列</span>
          </button>
          <button className="inbox-command-button" disabled={selectedCount !== 1} onClick={() => void openSingleSelected()} type="button">
            <FolderOpen size={16} />
            <span>定位文件</span>
          </button>
          <button className="inbox-command-button" disabled={isUpdatingState} onClick={() => void handleUpdateState('processed')} type="button">
            标记已处理
          </button>
          <button className="inbox-command-button" disabled={isUpdatingState} onClick={() => void handleUpdateState('ignored')} type="button">
            忽略问题
          </button>
          <button className="inbox-command-button" disabled={isUpdatingState} onClick={() => void handleUpdateState('pending')} type="button">
            设为待处理
          </button>
        </section>
      ) : null}

      <section className="inbox-list" aria-label="新歌列表" data-loading={isLoading ? 'true' : undefined}>
        {items.length === 0 ? (
          <div className="inbox-empty-state">
            <strong>{isLoading ? t('inboxPage.loading') : pageData.batches.length === 0 ? t('inboxPage.empty.title') : t('inboxPage.empty.noMatch')}</strong>
            <span>{pageData.batches.length === 0 ? t('inboxPage.empty.description') : t('inboxPage.empty.tryFilter')}</span>
          </div>
        ) : (
          items.map((item) => (
            <article className="inbox-track-row" key={`${item.batchId}:${item.track.id}`}>
              <label className="inbox-row-check">
                <input
                  checked={Boolean(selectedItems[inboxItemKey(item)])}
                  onChange={() => toggleSelectedItem(item)}
                  type="checkbox"
                />
                <span />
              </label>
              <div className="inbox-track-cover" data-empty={!item.track.coverThumb ? 'true' : undefined}>
                {item.track.coverThumb ? <img alt="" loading="lazy" src={item.track.coverThumb} /> : <Disc3 size={20} />}
              </div>
              <div className="inbox-track-main">
                <div className="inbox-track-title">
                  <strong>{item.track.title}</strong>
                  <span>{formatDateTime(item.addedAt)}</span>
                </div>
                <div className="inbox-track-meta">
                  <span>{item.track.artist || 'Unknown Artist'}</span>
                  <span>{item.track.album || 'Unknown Album'}</span>
                </div>
                <div className="inbox-track-path">{readTrackPath(item)}</div>
                <div className="inbox-reason-row">
                  <span data-status={item.inboxStatus}>{statusLabels[item.inboxStatus]}</span>
                  {item.reasons.slice(0, 4).map((reason) => (
                    <span key={reason}>{formatReason(reason)}</span>
                  ))}
                </div>
                {item.reasons.length > 4 ? (
                  <div className="inbox-reason-row">
                    <span>还有 {item.reasons.length - 4} 项</span>
                  </div>
                ) : null}
              </div>
              <button className="inbox-icon-button" onClick={() => void handleOpenTrack(item.track.id)} title="定位歌曲" type="button">
                <FolderOpen size={17} />
              </button>
            </article>
          ))
        )}
      </section>

      {pageData.hasMore ? (
        <button className="inbox-load-more" disabled={isLoading} onClick={() => void loadInbox(pageData.page + 1, 'append')} type="button">
          {isLoading ? '正在读取...' : `继续加载 ${visibleCount}/${pageData.total}`}
        </button>
      ) : null}
    </div>
  );
};
