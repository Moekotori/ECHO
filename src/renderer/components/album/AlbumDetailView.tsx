import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronRight, Disc3, ExternalLink, FolderOpen, Heart, Info, ListEnd, Loader2, MoreHorizontal, Play, Plus, RefreshCw, Star } from 'lucide-react';
import type { AlbumOnlineInfo, AlbumOnlineInfoRequestOptions, EditableTrackTags, LibraryAlbum, LibraryArtist, LibraryPlaylist, LibraryTrack } from '../../../shared/types/library';
import { likedAlbumsChangedEvent, likedChangedEvent, likedTracksChangedEvent, useLikedTrackIds } from '../../hooks/useLikedMedia';
import { useAnimatedBackNavigation } from '../../hooks/useAnimatedBackNavigation';
import { usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { openArtistDetailByName } from '../../utils/artistNavigation';
import { albumDetailNavigationEvent, openAlbumDetailForTrack } from '../../utils/albumNavigation';
import { resolvePlaylistForTrackAdd } from '../../utils/appPrompt';
import { getLibraryBridge } from '../../utils/echoBridge';
import { OsuTimingPanel } from '../library/OsuTimingPanel';
import { TrackContextMenu } from '../library/TrackContextMenu';
import type { TrackMenuAction } from '../library/TrackContextMenu';
import { TrackTagEditorDrawer } from '../library/TrackTagEditorDrawer';
import { AlbumTrackList } from './AlbumTrackList';

type AlbumDetailViewProps = {
  album: LibraryAlbum;
  onBack: () => void;
};

const albumOriginalCoverUrl = (album: Pick<LibraryAlbum, 'coverId'>): string | null =>
  album.coverId ? `echo-cover://original/${encodeURIComponent(album.coverId)}` : null;

const coverFailureKey = (albumId: string, coverUrl: string): string => `${albumId}\n${coverUrl}`;

const formatDuration = (duration: number, t: (key: TranslationKey, options?: Record<string, string | number>) => string): string | null => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const totalMinutes = Math.round(duration / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? t('albumDetail.duration.hours', { hours, minutes }) : t('albumDetail.duration.minutes', { minutes: totalMinutes });
};

const formatSampleRate = (sampleRate: number | null): string | null => {
  if (!sampleRate) {
    return null;
  }

  if (sampleRate >= 1000) {
    const khz = sampleRate / 1000;
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)}kHz`;
  }

  return `${sampleRate}Hz`;
};

const formatBitrate = (bitrate: number | null): string | null => {
  if (!bitrate || !Number.isFinite(bitrate)) {
    return null;
  }

  return bitrate >= 1000000 ? `${(bitrate / 1000000).toFixed(1)}Mbps` : `${Math.round(bitrate / 1000)}kbps`;
};

const formatTechnicalSummary = (track: LibraryTrack | null): string | null => {
  if (!track) {
    return null;
  }

  return [
    track.codec?.toUpperCase() ?? null,
    track.bitDepth ? `${track.bitDepth}bit` : null,
    formatSampleRate(track.sampleRate),
  ]
    .filter(Boolean)
    .join(' / ') || null;
};

const uniqueValues = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));

const formatTrackCount = (count: number, t: (key: TranslationKey, options?: Record<string, string | number>) => string): string =>
  t('albumDetail.count.tracks', { count });

type TrackMenuState = {
  track: LibraryTrack;
  position: { x: number; y: number };
};

type AlbumMenuPosition = {
  x: number;
  y: number;
};

type AlbumDetailTab = 'tracks' | 'sources' | 'releases' | 'information';

type OnlineInfoState = {
  loading: boolean;
  info: AlbumOnlineInfo | null;
  error: string | null;
  loadedForAlbumId: string | null;
};

type ExternalRating = AlbumOnlineInfo['externalRatings'][number];

type AlbumInformationBlock =
  | { type: 'heading'; key: string; level: 2 | 3 | 4; text: string }
  | { type: 'paragraph'; key: string; text: string }
  | { type: 'list'; key: string; items: string[] };

type OnlineInfoProvider = Exclude<NonNullable<AlbumOnlineInfoRequestOptions['provider']>, 'all'>;

type RelatedAlbumsState = {
  loading: boolean;
  albums: LibraryAlbum[];
  total: number;
  error: string | null;
  loadedForAlbumId: string | null;
};

const emptyOnlineInfoState = (): OnlineInfoState => ({
  loading: false,
  info: null,
  error: null,
  loadedForAlbumId: null,
});

const emptyRelatedAlbumsState = (): RelatedAlbumsState => ({
  loading: false,
  albums: [],
  total: 0,
  error: null,
  loadedForAlbumId: null,
});

const albumOnlineInfoProviders: OnlineInfoProvider[] = ['wikipedia', 'musicbrainz'];
const albumMenuWidth = 218;
const albumMenuViewportPadding = 8;
const albumMenuOffset = 6;
const albumMenuSubmenuGap = 8;
const albumMenuSubmenuWidth = 224;
const albumMenuSubmenuMaxHeight = 360;

const hasOnlineInfoPayload = (info: AlbumOnlineInfo | null): boolean =>
  Boolean(
    info &&
      (info.credits.length > 0 ||
        info.sourceLinks.length > 0 ||
        info.externalRatings.length > 0 ||
        info.releaseVersions.length > 0 ||
        info.releaseDetails ||
        info.information ||
        info.artistInformation),
  );

const mergeUnique = <T,>(left: T[], right: T[], keyFor: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...left, ...right]) {
    const key = keyFor(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
};

const mergeAlbumOnlineInfo = (current: AlbumOnlineInfo | null, next: AlbumOnlineInfo): AlbumOnlineInfo => {
  if (!current) {
    return next;
  }

  const errors = Array.from(new Set([...current.errors, ...next.errors]));
  const hasErrors = errors.length > 0;
  return {
    ...current,
    status: hasOnlineInfoPayload(current) || hasOnlineInfoPayload(next) ? (hasErrors ? 'partial' : 'ready') : hasErrors ? 'error' : 'empty',
    sources: mergeUnique(current.sources, next.sources, (source) => `${source.provider}:${source.label}`),
    match: current.match ?? next.match,
    sourceLinks: mergeUnique(current.sourceLinks, next.sourceLinks, (link) => `${link.provider}:${link.url}`),
    externalRatings: mergeUnique(current.externalRatings, next.externalRatings, (rating) => `${rating.provider}:${rating.url ?? rating.score}`),
    releaseDetails: current.releaseDetails ?? next.releaseDetails,
    releaseVersions: mergeUnique(current.releaseVersions, next.releaseVersions, (version) => version.providerItemId),
    credits: mergeUnique(current.credits, next.credits, (group) => group.role),
    information: current.information ?? next.information,
    artistInformation: current.artistInformation ?? next.artistInformation,
    fetchedAt: next.fetchedAt ?? current.fetchedAt,
    expiresAt: next.expiresAt ?? current.expiresAt,
    fromCache: current.fromCache && next.fromCache,
    errors,
  };
};

const stripWikiInlineMarkup = (value: string): string =>
  value
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, '$2')
    .replace(/\[\[([^\]]+)\]\]/gu, '$1')
    .replace(/'{2,5}([^']+)'{2,5}/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .replace(/[_\t]+/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .trim();

const wikiHeadingLevel = (marker: string): 2 | 3 | 4 => {
  if (marker.length <= 2) {
    return 2;
  }
  if (marker.length === 3) {
    return 3;
  }
  return 4;
};

const informationBlocksFromExtract = (extract: string): AlbumInformationBlock[] => {
  const normalized = extract
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  if (!normalized) {
    return [];
  }

  const blocks: AlbumInformationBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = (): void => {
    const text = stripWikiInlineMarkup(paragraphLines.join(' '));
    paragraphLines = [];
    if (text) {
      blocks.push({ type: 'paragraph', key: `p-${blocks.length}-${text.slice(0, 32)}`, text });
    }
  };

  const flushList = (): void => {
    const items = listItems.map(stripWikiInlineMarkup).filter(Boolean);
    listItems = [];
    if (items.length > 0) {
      blocks.push({ type: 'list', key: `list-${blocks.length}-${items[0]?.slice(0, 32) ?? ''}`, items });
    }
  };

  for (const line of normalized.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(={2,6})\s*(.*?)\s*\1$/u);
    if (heading?.[2]) {
      flushParagraph();
      flushList();
      const text = stripWikiInlineMarkup(heading[2]);
      if (text) {
        blocks.push({ type: 'heading', key: `h-${blocks.length}-${text}`, level: wikiHeadingLevel(heading[1]), text });
      }
      continue;
    }

    const listItem = trimmed.match(/^[*#;:]+\s*(.+)$/u);
    if (listItem?.[1]) {
      flushParagraph();
      listItems.push(listItem[1]);
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks.length > 0 ? blocks : [{ type: 'paragraph', key: 'p-fallback', text: normalized }];
};

const normalizeArtistName = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase();

const isGenericAlbumArtistName = (value: string): boolean => {
  const normalized = normalizeArtistName(value).replace(/\s+/gu, ' ');
  return /^(?:various artists?|various|v\.?\s*a\.?|v\/a|unknown artists?|unknown)$/iu.test(normalized);
};

const splitTrackArtistNames = (value: string): string[] =>
  value
    .split(/\s*(?:\/|／|;|；|\||&|\s+feat\.?\s+|\s+featuring\s+|\s+with\s+|\s+x\s+|×|\+|＋)\s*/iu)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !isGenericAlbumArtistName(item));

type AlbumArtistDisplay = {
  label: string | null;
  lookupName: string | null;
};

const deriveAlbumArtistDisplay = (albumArtist: string, tracks: LibraryTrack[]): AlbumArtistDisplay => {
  const trimmedAlbumArtist = albumArtist.trim();
  if (trimmedAlbumArtist && !isGenericAlbumArtistName(trimmedAlbumArtist)) {
    return { label: trimmedAlbumArtist, lookupName: trimmedAlbumArtist };
  }

  const trackArtists = uniqueValues(tracks.map((track) => track.artist))
    .filter((artist) => !isGenericAlbumArtistName(artist));
  if (trackArtists.length === 0) {
    return { label: null, lookupName: null };
  }
  if (trackArtists.length === 1) {
    return { label: trackArtists[0], lookupName: splitTrackArtistNames(trackArtists[0])[0] ?? trackArtists[0] };
  }

  const tokenCounts = new Map<string, { label: string; count: number; order: number }>();
  trackArtists.forEach((artist, artistIndex) => {
    const seenForArtist = new Set<string>();
    splitTrackArtistNames(artist).forEach((token, tokenIndex) => {
      const normalized = normalizeArtistName(token);
      if (!normalized || seenForArtist.has(normalized)) {
        return;
      }
      seenForArtist.add(normalized);
      const current = tokenCounts.get(normalized);
      if (current) {
        tokenCounts.set(normalized, { ...current, count: current.count + 1 });
      } else {
        tokenCounts.set(normalized, { label: token, count: 1, order: artistIndex * 100 + tokenIndex });
      }
    });
  });
  const sharedTokens = Array.from(tokenCounts.values())
    .filter((token) => token.count === trackArtists.length)
    .sort((left, right) => left.order - right.order)
    .map((token) => token.label);

  if (sharedTokens.length > 0) {
    return { label: sharedTokens.join(' / '), lookupName: sharedTokens[0] };
  }

  const fallbackTokens = splitTrackArtistNames(trackArtists[0]);
  const fallbackLabel = fallbackTokens.length > 0 ? fallbackTokens.slice(0, 2).join(' / ') : trackArtists[0];
  return { label: fallbackLabel, lookupName: fallbackTokens[0] ?? trackArtists[0] };
};

const findMatchingArtist = (artists: LibraryArtist[], name: string): LibraryArtist | null => {
  const normalizedName = normalizeArtistName(name);
  return artists.find((artist) => normalizeArtistName(artist.name) === normalizedName) ?? (artists.length === 1 ? artists[0] : null);
};

const formatConfidence = (value: number): string => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

const creditRoleTitle = (role: string, t: (key: TranslationKey, options?: Record<string, string | number>) => string): string => {
  switch (role) {
    case 'Vocal':
      return t('albumDetail.credit.role.vocal');
    case 'Performer':
      return t('albumDetail.credit.role.performer');
    case 'Composer':
      return t('albumDetail.credit.role.composer');
    case 'Lyrics':
      return t('albumDetail.credit.role.lyrics');
    case 'Arrangement':
      return t('albumDetail.credit.role.arrangement');
    case 'Production':
      return t('albumDetail.credit.role.production');
    case 'Engineering':
      return t('albumDetail.credit.role.engineering');
    case 'Label':
      return t('albumDetail.credit.role.label');
    default:
      return role || t('albumDetail.credit.role.other');
  }
};

const creditRoleSummary = (role: string, t: (key: TranslationKey, options?: Record<string, string | number>) => string): string => {
  switch (role) {
    case 'Vocal':
      return t('albumDetail.credit.summary.vocal');
    case 'Performer':
      return t('albumDetail.credit.summary.performer');
    case 'Composer':
      return t('albumDetail.credit.summary.composer');
    case 'Lyrics':
      return t('albumDetail.credit.summary.lyrics');
    case 'Arrangement':
      return t('albumDetail.credit.summary.arrangement');
    case 'Production':
      return t('albumDetail.credit.summary.production');
    case 'Engineering':
      return t('albumDetail.credit.summary.engineering');
    case 'Label':
      return t('albumDetail.credit.summary.label');
    default:
      return t('albumDetail.credit.summary.other');
  }
};

const creditSourceLabel = (source: string, t: (key: TranslationKey, options?: Record<string, string | number>) => string): string => {
  switch (source) {
    case 'recording':
      return t('albumDetail.credit.source.recording');
    case 'work':
      return t('albumDetail.credit.source.work');
    case 'label':
      return t('albumDetail.credit.source.label');
    default:
      return t('albumDetail.credit.source.album');
  }
};

const sourceKindLabel = (kind: string, t: (key: TranslationKey, options?: Record<string, string | number>) => string): string => {
  switch (kind) {
    case 'database':
      return t('albumDetail.sources.kind.database');
    case 'streaming':
      return t('albumDetail.sources.kind.streaming');
    case 'official':
      return t('albumDetail.sources.kind.official');
    case 'reference':
      return t('albumDetail.sources.kind.reference');
    default:
      return t('albumDetail.sources.kind.other');
  }
};

const sourceProviderLabel = (provider: string): string => {
  switch (provider) {
    case 'musicbrainz':
      return 'MusicBrainz';
    case 'wikipedia':
      return 'Wikipedia';
    case 'wikidata':
      return 'Wikidata';
    case 'vgmdb':
      return 'VGMdb';
    case 'discogs':
      return 'Discogs';
    case 'rateYourMusic':
      return 'Rate Your Music';
    case 'spotify':
      return 'Spotify';
    case 'appleMusic':
      return 'Apple Music';
    case 'youtubeMusic':
      return 'YouTube Music';
    case 'bandcamp':
      return 'Bandcamp';
    case 'official':
      return 'Official';
    default:
      return 'Web';
  }
};

const ratingProviderLabel = (provider: ExternalRating['provider']): string => {
  switch (provider) {
    case 'rateYourMusic':
      return 'Rate Your Music';
    case 'musicbrainz':
      return 'MusicBrainz';
    case 'discogs':
      return 'Discogs';
    default:
      return 'Community';
  }
};

const formatRatingNumber = (value: number, locale: string, maxFractionDigits = 2): string =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : maxFractionDigits,
  }).format(value);

const formatRatingScore = (rating: ExternalRating, locale: string): string =>
  `${formatRatingNumber(rating.score, locale)} / ${formatRatingNumber(rating.maxScore, locale)}`;

const formatReleaseVersionMeta = (version: NonNullable<AlbumOnlineInfo['releaseVersions'][number]>): string =>
  [
    version.year ? String(version.year) : null,
    version.country,
    version.mediaFormats.join(' / ') || null,
    version.status,
    version.barcode ? `Barcode ${version.barcode}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(' - ');

export const AlbumDetailView = ({ album, onBack }: AlbumDetailViewProps): JSX.Element => {
  const { locale, t } = useI18n();
  const { appendToQueue, appendTracksToQueue, currentTrackId, playTrack, playTrackNext, removeTrackFromQueue, replaceQueue, updateTrackSnapshot } = usePlaybackQueue();
  const detailRootRef = useRef<HTMLDivElement | null>(null);
  const { isReturning, returnBack } = useAnimatedBackNavigation(onBack, true, {
    durationMs: 80,
    rootRef: detailRootRef,
  });
  const [firstTrack, setFirstTrack] = useState<LibraryTrack | null>(null);
  const [loadedTracks, setLoadedTracks] = useState<LibraryTrack[]>([]);
  const [loadedTotal, setLoadedTotal] = useState(0);
  const [isLoadingFirstTrack, setIsLoadingFirstTrack] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [coverLarge, setCoverLarge] = useState<string | null>(null);
  const [failedOriginalCover, setFailedOriginalCover] = useState(false);
  const [failedLargeCover, setFailedLargeCover] = useState(false);
  const [failedThumbCover, setFailedThumbCover] = useState(false);
  const [isAlbumLiked, setIsAlbumLiked] = useState(false);
  const [albumMenuPosition, setAlbumMenuPosition] = useState<AlbumMenuPosition | null>(null);
  const [albumPlaylistSubmenuOpen, setAlbumPlaylistSubmenuOpen] = useState(false);
  const [albumPlaylistSubmenuPosition, setAlbumPlaylistSubmenuPosition] = useState<AlbumMenuPosition>(() => ({ x: 0, y: 0 }));
  const [albumPlaylists, setAlbumPlaylists] = useState<LibraryPlaylist[]>([]);
  const [albumPlaylistsLoading, setAlbumPlaylistsLoading] = useState(false);
  const [trackMenu, setTrackMenu] = useState<TrackMenuState | null>(null);
  const [trackActionMessage, setTrackActionMessage] = useState<string | null>(null);
  const [osuTimingTrack, setOsuTimingTrack] = useState<LibraryTrack | null>(null);
  const [editingTrack, setEditingTrack] = useState<LibraryTrack | null>(null);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [tagEditorError, setTagEditorError] = useState<string | null>(null);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [activeTab, setActiveTab] = useState<AlbumDetailTab>('tracks');
  const [onlineInfoState, setOnlineInfoState] = useState<OnlineInfoState>(() => emptyOnlineInfoState());
  const [relatedAlbumsState, setRelatedAlbumsState] = useState<RelatedAlbumsState>(() => emptyRelatedAlbumsState());
  const [failedRelatedCoverUrls, setFailedRelatedCoverUrls] = useState<Record<string, true>>({});
  const tagEditorCloseTimerRef = useRef<number | null>(null);
  const onlineInfoRequestRef = useRef(0);
  const relatedAlbumsRequestRef = useRef(0);
  const albumPlaylistLoadStartedRef = useRef(false);
  const likedTrackIds = useLikedTrackIds(loadedTracks.map((track) => track.id));
  const duration = formatDuration(album.duration, t);
  const formatSummary = formatTechnicalSummary(firstTrack);
  const albumMetadata = useMemo(
    () =>
      [
        album.year ? String(album.year) : null,
        formatTrackCount(album.trackCount, t),
        duration,
        formatSummary,
      ].filter((item): item is string => Boolean(item)),
    [album.trackCount, album.year, duration, formatSummary, t],
  );
  const signalItems = useMemo(
    () =>
      firstTrack
        ? [
            firstTrack.codec?.toUpperCase() ?? null,
            firstTrack.bitDepth ? `${firstTrack.bitDepth}bit` : null,
            formatSampleRate(firstTrack.sampleRate),
            formatBitrate(firstTrack.bitrate),
          ].filter((item): item is string => Boolean(item))
        : [],
    [firstTrack],
  );
  const textureItems = useMemo(() => {
    const genres = uniqueValues(loadedTracks.map((track) => track.genre)).slice(0, 3);
    const discs = new Set(loadedTracks.map((track) => track.discNo).filter((discNo): discNo is number => Boolean(discNo && discNo > 0)));

    return [
      ...genres,
      discs.size > 1 ? t('albumDetail.texture.discs', { count: discs.size }) : null,
      loadedTotal > loadedTracks.length ? t('albumDetail.count.loadedTracks', { loaded: loadedTracks.length, total: loadedTotal }) : null,
    ].filter((item): item is string => Boolean(item));
  }, [loadedTotal, loadedTracks, t]);
  const albumFacts = useMemo(
    () => {
      const ratingFacts = (onlineInfoState.info?.externalRatings ?? []).slice(0, 2).map((rating) => ({
        label: ratingProviderLabel(rating.provider),
        value: formatRatingScore(rating, locale),
      }));

      return [
        { label: t('albumDetail.fact.format'), value: signalItems.join(' / ') || t('albumDetail.status.readingSignal') },
        { label: t('albumDetail.fact.genre'), value: textureItems[0] ?? t('albumDetail.status.unknownGenre') },
        { label: t('albumDetail.fact.released'), value: album.year ? String(album.year) : t('albumDetail.status.unknownYear') },
        ...ratingFacts,
        {
          label: t('albumDetail.fact.library'),
          value: t('albumDetail.status.libraryReady', {
            value: loadedTotal > 0 ? `${loadedTracks.length}/${loadedTotal}` : formatTrackCount(album.trackCount, t),
          }),
        },
      ];
    },
    [album.trackCount, album.year, loadedTotal, loadedTracks.length, locale, onlineInfoState.info?.externalRatings, signalItems, textureItems, t],
  );
  const albumSource = useMemo(
    () => ({ type: 'album' as const, label: album.title, albumId: album.id }),
    [album.id, album.title],
  );
  const originalCover = albumOriginalCoverUrl(album);
  const detailCoverSrc = originalCover && !failedOriginalCover
    ? originalCover
    : coverLarge && !failedLargeCover
      ? coverLarge
      : failedThumbCover
        ? null
        : album.coverThumb;
  const albumArtistDisplay = useMemo(
    () => deriveAlbumArtistDisplay(album.albumArtist, loadedTracks.length > 0 ? loadedTracks : firstTrack ? [firstTrack] : []),
    [album.albumArtist, firstTrack, loadedTracks],
  );
  const displayAlbumArtist = albumArtistDisplay.label;
  const albumArtistLookupName = albumArtistDisplay.lookupName;

  const closeAlbumMenu = useCallback((): void => {
    setAlbumMenuPosition(null);
    setAlbumPlaylistSubmenuOpen(false);
  }, []);

  const loadAlbumPlaylists = useCallback((): void => {
    if (albumPlaylistLoadStartedRef.current) {
      return;
    }

    albumPlaylistLoadStartedRef.current = true;
    const library = window.echo?.library;
    if (!library?.getPlaylists) {
      return;
    }

    setAlbumPlaylistsLoading(true);
    void library
      .getPlaylists()
      .then((items) => {
        setAlbumPlaylists(items.filter((item) => item.sourceProvider === 'local' && item.kind !== 'system'));
      })
      .catch(() => setAlbumPlaylists([]))
      .finally(() => setAlbumPlaylistsLoading(false));
  }, []);

  const openAlbumPlaylistSubmenu = useCallback(
    (target: HTMLElement): void => {
      const rect = target.getBoundingClientRect();
      const opensLeft = rect.right + albumMenuSubmenuGap + albumMenuSubmenuWidth + albumMenuViewportPadding > window.innerWidth;
      const maxTop = Math.max(albumMenuViewportPadding, window.innerHeight - Math.min(albumMenuSubmenuMaxHeight, window.innerHeight - albumMenuViewportPadding * 2));

      setAlbumPlaylistSubmenuPosition({
        x: opensLeft ? Math.max(albumMenuViewportPadding, rect.left - albumMenuSubmenuWidth - albumMenuSubmenuGap) : rect.right + albumMenuSubmenuGap,
        y: Math.max(albumMenuViewportPadding, Math.min(rect.top - 8, maxTop)),
      });
      setAlbumPlaylistSubmenuOpen(true);
      loadAlbumPlaylists();
    },
    [loadAlbumPlaylists],
  );

  const loadOnlineInfo = useCallback(
    async (force = false): Promise<void> => {
      const bridge = getLibraryBridge();
      if (!bridge?.getAlbumOnlineInfo) {
        setOnlineInfoState((current) => ({
          ...current,
          loading: false,
          error: 'Online album info is not available in this build.',
        }));
        return;
      }

      setOnlineInfoState((current) => ({
        ...current,
        loading: true,
        error: null,
      }));
      const requestId = onlineInfoRequestRef.current + 1;
      onlineInfoRequestRef.current = requestId;

      let mergedInfo: AlbumOnlineInfo | null = null;
      const errors: string[] = [];
      await Promise.all(
        albumOnlineInfoProviders.map(async (provider) => {
          try {
            const info = await bridge.getAlbumOnlineInfo(album.id, { force, provider });
            if (onlineInfoRequestRef.current !== requestId) {
              return;
            }
            mergedInfo = mergeAlbumOnlineInfo(mergedInfo, info);
            setOnlineInfoState({
              loading: true,
              info: hasOnlineInfoPayload(mergedInfo) ? mergedInfo : null,
              error: null,
              loadedForAlbumId: album.id,
            });
          } catch (error) {
            errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }),
      );

      if (onlineInfoRequestRef.current !== requestId) {
        return;
      }
      const settledInfo = mergedInfo as AlbumOnlineInfo | null;
      const finalInfo = settledInfo && errors.length > 0
        ? {
            ...settledInfo,
            status: hasOnlineInfoPayload(settledInfo) ? 'partial' as const : 'error' as const,
            errors: Array.from(new Set([...settledInfo.errors, ...errors])),
          }
        : settledInfo;
      setOnlineInfoState({
        loading: false,
        info: finalInfo,
        error: finalInfo ? null : errors.join('\n') || 'Online album info is unavailable.',
        loadedForAlbumId: album.id,
      });
    },
    [album.id],
  );

  const loadRelatedAlbums = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    const artistName = albumArtistLookupName?.trim() ?? '';

    if (!artistName || !library?.getArtists || !library.getArtistAlbums) {
      setRelatedAlbumsState({
        loading: false,
        albums: [],
        total: 0,
        error: null,
        loadedForAlbumId: album.id,
      });
      return;
    }

    const requestId = relatedAlbumsRequestRef.current + 1;
    relatedAlbumsRequestRef.current = requestId;
    setRelatedAlbumsState((current) => ({
      ...current,
      loading: true,
      error: null,
      loadedForAlbumId: album.id,
    }));

    try {
      const sourceProvider = album.mediaType === 'remote' ? 'remote' : 'local';
      const artists = await library.getArtists({ page: 1, pageSize: 50, search: artistName, sort: 'default', sourceProvider });
      if (relatedAlbumsRequestRef.current !== requestId) {
        return;
      }

      const artist = findMatchingArtist(artists.items, artistName);
      if (!artist) {
        setRelatedAlbumsState({
          loading: false,
          albums: [],
          total: 0,
          error: null,
          loadedForAlbumId: album.id,
        });
        return;
      }

      const albums = await library.getArtistAlbums(artist.id, { page: 1, pageSize: 8, sort: 'recent' });
      if (relatedAlbumsRequestRef.current !== requestId) {
        return;
      }

      setRelatedAlbumsState({
        loading: false,
        albums: albums.items,
        total: albums.total,
        error: null,
        loadedForAlbumId: album.id,
      });
    } catch (error) {
      if (relatedAlbumsRequestRef.current === requestId) {
        setRelatedAlbumsState({
          loading: false,
          albums: [],
          total: 0,
          error: error instanceof Error ? error.message : String(error),
          loadedForAlbumId: album.id,
        });
      }
    }
  }, [album.id, album.mediaType, albumArtistLookupName]);

  useEffect(() => {
    setActiveTab('tracks');
    setOnlineInfoState(emptyOnlineInfoState());
    void loadOnlineInfo(false);
  }, [album.id, loadOnlineInfo]);

  useEffect(() => {
    setRelatedAlbumsState(emptyRelatedAlbumsState());
    setFailedRelatedCoverUrls({});
    void loadRelatedAlbums();
  }, [album.id, loadRelatedAlbums]);

  const refreshAlbumLiked = useCallback(async (): Promise<void> => {
    try {
      const result = await window.echo?.library?.getLikedAlbumIds([album.id]);
      setIsAlbumLiked(result?.[album.id] === true);
    } catch {
      setIsAlbumLiked(false);
    }
  }, [album.id]);

  useEffect(() => {
    let isMounted = true;

    setCoverLarge(null);
    setFailedOriginalCover(false);
    setFailedLargeCover(false);
    setFailedThumbCover(false);

    window.echo.library
      .getAlbum(album.id)
      .then((detail) => {
        if (isMounted) {
          setCoverLarge(detail?.coverLarge ?? null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setCoverLarge(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [album.id]);

  useEffect(() => {
    void refreshAlbumLiked();
    window.addEventListener(likedAlbumsChangedEvent, refreshAlbumLiked);
    return () => window.removeEventListener(likedAlbumsChangedEvent, refreshAlbumLiked);
  }, [refreshAlbumLiked]);

  useEffect(() => {
    if (!albumMenuPosition) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeAlbumMenu();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeAlbumMenu);
    window.addEventListener('scroll', closeAlbumMenu, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeAlbumMenu);
      window.removeEventListener('scroll', closeAlbumMenu, true);
    };
  }, [albumMenuPosition, closeAlbumMenu]);

  useEffect(() => {
    albumPlaylistLoadStartedRef.current = false;
    setAlbumPlaylistSubmenuOpen(false);
    setAlbumPlaylists([]);
    setAlbumPlaylistsLoading(false);
  }, [album.id]);

  const handleFirstTrackChange = useCallback((track: LibraryTrack | null, isLoading: boolean): void => {
    setFirstTrack(track);
    setIsLoadingFirstTrack(isLoading);
  }, []);

  const handleLoadedTracksChange = useCallback((tracks: LibraryTrack[], total: number, isLoading: boolean): void => {
    setLoadedTracks(tracks);
    setLoadedTotal(total);
    setFirstTrack(tracks[0] ?? null);
    setIsLoadingFirstTrack(isLoading && tracks.length === 0);
  }, []);

  const withAlbumCoverFallback = useCallback(
    (track: LibraryTrack): LibraryTrack => (track.coverThumb || !album.coverThumb ? track : { ...track, coverThumb: album.coverThumb }),
    [album.coverThumb],
  );

  const getAllAlbumTracks = useCallback(async (): Promise<LibraryTrack[]> => {
    if (loadedTotal > 0 && loadedTracks.length >= loadedTotal) {
      return loadedTracks.map(withAlbumCoverFallback);
    }

    const library = window.echo?.library;
    if (!library?.getAlbumTracks) {
      throw new Error(t('albumDetail.tracks.error.desktopBridgeRead'));
    }

    const tracks: LibraryTrack[] = [];
    let nextPage = 1;
    const trackPageSize = 500;
    for (;;) {
      const result = await library.getAlbumTracks(album.id, { page: nextPage, pageSize: trackPageSize });
      tracks.push(...result.items);
      if (!result.hasMore) {
        return tracks.map(withAlbumCoverFallback);
      }
      nextPage += 1;
    }
  }, [album.id, loadedTotal, loadedTracks, t, withAlbumCoverFallback]);

  const handleOpenAlbumMenu = useCallback((event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setAlbumPlaylistSubmenuOpen(false);
    setAlbumMenuPosition({
      x: Math.max(albumMenuViewportPadding, Math.min(rect.left, window.innerWidth - albumMenuWidth - albumMenuViewportPadding)),
      y: Math.max(albumMenuViewportPadding, rect.bottom + albumMenuOffset),
    });
  }, []);

  const handleAddAlbumToQueue = useCallback(async (): Promise<void> => {
    closeAlbumMenu();
    try {
      setPlayError(null);
      setTrackActionMessage(null);
      const tracks = await getAllAlbumTracks();
      if (tracks.length === 0) {
        setPlayError(t('albumDetail.tracks.empty'));
        return;
      }
      appendTracksToQueue(tracks, albumSource);
      setTrackActionMessage(t('albumDetail.status.addedToQueue', { count: tracks.length }));
    } catch (error) {
      setPlayError(error instanceof Error ? error.message : String(error));
    }
  }, [albumSource, appendTracksToQueue, closeAlbumMenu, getAllAlbumTracks, t]);

  const handleAddAlbumToPlaylist = useCallback(async (playlistTarget?: LibraryPlaylist): Promise<void> => {
    closeAlbumMenu();
    try {
      setPlayError(null);
      setTrackActionMessage(null);
      const library = window.echo?.library;
      if (!library) {
        throw new Error(t('albumDetail.tracks.error.desktopBridgeActions'));
      }

      const playlist = playlistTarget ?? (await resolvePlaylistForTrackAdd(library));
      if (!playlist) {
        return;
      }

      const tracks = await getAllAlbumTracks();
      const localTrackIds = tracks.filter((track) => track.mediaType !== 'streaming').map((track) => track.id);
      if (localTrackIds.length === 0) {
        setPlayError('流媒体歌曲不能加入本地歌单，请在流媒体歌单中单独管理。');
        return;
      }

      if (library.addTracksToPlaylist) {
        await library.addTracksToPlaylist(playlist.id, localTrackIds);
      } else {
        await Promise.all(localTrackIds.map((trackId) => library.addTrackToPlaylist(playlist.id, trackId)));
      }
      window.dispatchEvent(new Event('library:playlists-changed'));
      setTrackActionMessage(t('albumDetail.tracks.status.addedToPlaylist', { playlist: playlist.name }));
    } catch (error) {
      setPlayError(error instanceof Error ? error.message : String(error));
    }
  }, [closeAlbumMenu, getAllAlbumTracks, t]);

  const handleShowAlbumInFolder = useCallback(async (): Promise<void> => {
    closeAlbumMenu();
    try {
      setPlayError(null);
      setTrackActionMessage(null);
      if (album.mediaType === 'remote') {
        setPlayError(t('albumDetail.tracks.error.remoteFileAction'));
        return;
      }

      const library = window.echo?.library;
      if (!library) {
        throw new Error(t('albumDetail.tracks.error.desktopBridgeActions'));
      }

      const track = firstTrack ?? loadedTracks[0] ?? (await getAllAlbumTracks())[0];
      if (!track) {
        setPlayError(t('albumDetail.tracks.empty'));
        return;
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
    } catch (error) {
      setPlayError(error instanceof Error ? error.message : String(error));
    }
  }, [album.mediaType, closeAlbumMenu, firstTrack, getAllAlbumTracks, loadedTracks, t]);

  const handleDetailCoverContextMenu = useCallback((event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    closeAlbumMenu();
    void (async () => {
      try {
        setPlayError(null);
        setTrackActionMessage(null);
        const library = window.echo?.library;
        if (!library?.copyAlbumCover) {
          throw new Error(t('albumDetail.tracks.error.desktopBridgeActions'));
        }

        if (!(await library.copyAlbumCover(album.id))) {
          setPlayError(t('library.albums.error.noCopyableCover'));
          return;
        }

        setTrackActionMessage(t('albumDetail.status.copiedCover'));
      } catch (error) {
        setPlayError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [album.id, closeAlbumMenu, t]);

  const handlePlayTrack = useCallback(
    async (track: LibraryTrack): Promise<void> => {
      try {
        setPlayError(null);
        const playableTracks = (loadedTracks.length > 0 ? loadedTracks : [track]).map(withAlbumCoverFallback);
        await playTrack(withAlbumCoverFallback(track), {
          replaceQueueWith: playableTracks,
          source: albumSource,
        });
      } catch (error) {
        setPlayError(error instanceof Error ? error.message : String(error));
      }
    },
    [albumSource, loadedTracks, playTrack, withAlbumCoverFallback],
  );

  const handlePlayNow = useCallback((): void => {
    if (firstTrack) {
      // TODO: load the complete album queue through LibraryService once that API can fetch all album tracks at once.
      const playableTracks = loadedTracks.length > 0 ? loadedTracks.map(withAlbumCoverFallback) : [withAlbumCoverFallback(firstTrack)];
      const firstPlayableTrack = playableTracks[0] ?? firstTrack;
      replaceQueue(playableTracks, { startTrackId: firstPlayableTrack.id, source: albumSource });
      void playTrack(firstPlayableTrack, { source: albumSource });
    }
  }, [albumSource, firstTrack, loadedTracks, playTrack, replaceQueue, withAlbumCoverFallback]);

  const handleToggleAlbumLiked = useCallback(async (): Promise<void> => {
    try {
      const previous = isAlbumLiked;
      setIsAlbumLiked(!previous);
      const result = await window.echo.library.toggleAlbumLiked(album.id);
      setIsAlbumLiked(result.liked);
      window.dispatchEvent(new Event(likedAlbumsChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
    } catch (error) {
      setPlayError(error instanceof Error ? error.message : String(error));
      void refreshAlbumLiked();
    }
  }, [album.id, isAlbumLiked, refreshAlbumLiked]);

  const handleToggleTrackLiked = useCallback(async (track: LibraryTrack): Promise<void> => {
    try {
      await window.echo.library.toggleTrackLiked(track.id);
      window.dispatchEvent(new Event(likedTracksChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
    } catch (error) {
      setPlayError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleOpenTrackMenu = useCallback((track: LibraryTrack, position: { x: number; y: number }): void => {
    setTrackMenu({ track: withAlbumCoverFallback(track), position });
  }, [withAlbumCoverFallback]);

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

  const handleSaveTags = useCallback(
    async (
      track: LibraryTrack,
      tags: EditableTrackTags,
      coverPath: string | null,
      coverUrl: string | null,
      coverMimeType: string | null,
    ): Promise<void> => {
      const library = window.echo?.library;

      if (!library?.updateTrackTags) {
        setTagEditorError(t('albumDetail.tracks.error.desktopBridgeEdit'));
        return;
      }

      setIsSavingTags(true);
      setTagEditorError(null);

      try {
        const updatedTrack = await library.updateTrackTags({ trackId: track.id, tags, coverPath, coverUrl, coverMimeType });
        setLoadedTracks((current) => current.map((item) => (item.id === updatedTrack.id ? withAlbumCoverFallback(updatedTrack) : item)));
        setFirstTrack((current) => (current?.id === updatedTrack.id ? withAlbumCoverFallback(updatedTrack) : current));
        updateTrackSnapshot(updatedTrack.id, withAlbumCoverFallback(updatedTrack));
        window.dispatchEvent(new Event('library:changed'));
        closeTagEditor();
      } catch (saveError) {
        setTagEditorError(saveError instanceof Error ? saveError.message : String(saveError));
      } finally {
        setIsSavingTags(false);
      }
    },
    [closeTagEditor, t, updateTrackSnapshot, withAlbumCoverFallback],
  );

  const handleTrackMenuAction = useCallback(
    async (action: TrackMenuAction, track: LibraryTrack, playlistTarget?: LibraryPlaylist): Promise<void> => {
      const library = window.echo?.library;
      setTrackMenu(null);

      if (action === 'clear-lyrics-cache') {
        const lyricsApi = window.echo?.lyrics;
        if (!lyricsApi?.clearCache) {
          setPlayError('Desktop bridge unavailable. Open ECHO Next in Electron to clear lyrics cache.');
          return;
        }

        try {
          setPlayError(null);
          setTrackActionMessage(null);
          await lyricsApi.clearCache(track.id);
          window.dispatchEvent(new CustomEvent('lyrics:rematch-requested', { detail: { trackId: track.id } }));
          setTrackActionMessage(`已清理歌词缓存：${track.title}`);
        } catch (actionError) {
          setPlayError(actionError instanceof Error ? actionError.message : String(actionError));
        }
        return;
      }

      if (!library && action !== 'play-next' && action !== 'add-to-queue' && action !== 'remove-from-queue' && action !== 'open-osu-timing' && action !== 'reload-embedded-tags') {
        setPlayError(t('albumDetail.tracks.error.desktopBridgeActions'));
        return;
      }

      try {
        setPlayError(null);
        setTrackActionMessage(null);

        if (
          track.mediaType === 'remote' &&
          (action === 'edit-tags' ||
            action === 'reload-embedded-tags' ||
            action === 'open-osu-timing' ||
            action === 'show-in-folder' ||
            action === 'copy-path' ||
            action === 'open-system' ||
            action === 'delete-song')
        ) {
          setPlayError(t('albumDetail.tracks.error.remoteFileAction'));
          return;
        }

        switch (action) {
          case 'play-next':
            playTrackNext(withAlbumCoverFallback(track), albumSource);
            return;
          case 'add-to-queue':
            appendToQueue(withAlbumCoverFallback(track), albumSource);
            return;
          case 'toggle-liked':
            await handleToggleTrackLiked(track);
            return;
          case 'remove-from-queue':
            {
              const removedCount = removeTrackFromQueue(track.id);
              setTrackActionMessage(
                removedCount > 0
                  ? t('albumDetail.tracks.status.removedFromQueue', { title: track.title })
                  : t('albumDetail.tracks.status.notInQueue', { title: track.title }),
              );
            }
            return;
          case 'open-osu-timing':
            setOsuTimingTrack(withAlbumCoverFallback(track));
            return;
          case 'edit-tags':
            setTagEditorError(null);
            if (tagEditorCloseTimerRef.current !== null) {
              window.clearTimeout(tagEditorCloseTimerRef.current);
              tagEditorCloseTimerRef.current = null;
            }
            setIsTagEditorOpen(false);
            setEditingTrack(track);
            window.requestAnimationFrame(() => setIsTagEditorOpen(true));
            return;
          case 'reload-embedded-tags':
            {
              const result = await library!.loadEmbeddedTrackTags(track.id);
              const nextTrack = withAlbumCoverFallback(result.track);
              setLoadedTracks((current) => current.map((item) => (item.id === nextTrack.id ? nextTrack : item)));
              setFirstTrack((current) => (current?.id === nextTrack.id ? nextTrack : current));
              if (editingTrack?.id === nextTrack.id) {
                setEditingTrack(nextTrack);
              }
              updateTrackSnapshot(nextTrack.id, nextTrack);
              setTrackActionMessage(t('albumDetail.tracks.status.reloadedTags', { title: nextTrack.title }));
              window.dispatchEvent(new Event('library:changed'));
            }
            return;
          case 'go-to-album':
            if (!(await openAlbumDetailForTrack(track))) {
              setTrackActionMessage(t('albumDetail.tracks.status.albumNotFound', { title: album.title }));
            }
            return;
          case 'show-in-folder':
            await library?.openTrackInFolder(track.id);
            return;
          case 'copy-path':
            await library?.copyTrackPath(track.id);
            return;
          case 'open-system':
            await library?.openTrackWithSystem(track.id);
            return;
          case 'copy-name-artist':
            await library?.copyTrackNameArtist(track.id);
            return;
          case 'copy-cover':
            if (!(await library?.copyTrackCover(track.id))) {
              setPlayError(t('albumDetail.tracks.error.noCoverToCopy'));
            }
            return;
          case 'save-cover':
            if (!(await library?.saveTrackCover(track.id))) {
              setPlayError(t('albumDetail.tracks.error.noCoverSaved'));
            }
            return;
          case 'delete-song':
            if (!window.confirm(t('albumDetail.tracks.confirm.delete', { title: track.title }))) {
              return;
            }
            await library?.deleteTrackFile(track.id);
            setLoadedTracks((current) => current.filter((item) => item.id !== track.id));
            setLoadedTotal((current) => Math.max(0, current - 1));
            if (firstTrack?.id === track.id) {
              setFirstTrack(loadedTracks.find((item) => item.id !== track.id) ?? null);
            }
            window.dispatchEvent(new Event('library:changed'));
            return;
          case 'add-to-playlist':
            {
              if (track.mediaType === 'streaming') {
                setPlayError('流媒体歌曲不能加入本地歌单，请在流媒体歌单中单独管理。');
                return;
              }

              const playlist = playlistTarget ?? (await resolvePlaylistForTrackAdd(library!));
              if (!playlist) {
                return;
              }

              await library!.addTrackToPlaylist(playlist.id, track.id);
              window.dispatchEvent(new Event('library:playlists-changed'));
              setTrackActionMessage(t('albumDetail.tracks.status.addedToPlaylist', { playlist: playlist.name }));
            }
            return;
          default:
            setPlayError(t('albumDetail.tracks.error.actionUnavailable'));
        }
      } catch (actionError) {
        setPlayError(actionError instanceof Error ? actionError.message : String(actionError));
      }
    },
    [
      album.title,
      albumSource,
      appendToQueue,
      editingTrack,
      firstTrack?.id,
      handleToggleTrackLiked,
      loadedTracks,
      playTrackNext,
      removeTrackFromQueue,
      t,
      updateTrackSnapshot,
      withAlbumCoverFallback,
    ],
  );

  const handleDetailCoverError = useCallback((coverUrl: string): void => {
    if (originalCover && coverUrl === originalCover && !failedOriginalCover) {
      setFailedOriginalCover(true);
      return;
    }

    if (coverLarge && coverUrl === coverLarge && !failedLargeCover) {
      setFailedLargeCover(true);
      return;
    }

    setFailedThumbCover(true);
  }, [coverLarge, failedLargeCover, failedOriginalCover, originalCover]);

  const handleOpenAlbumArtist = useCallback((): void => {
    const artistName = albumArtistLookupName?.trim() ?? '';
    if (!artistName) {
      return;
    }

    void openArtistDetailByName(artistName, { returnTo: 'albums' })
      .then((artist) => {
        if (!artist) {
          setTrackActionMessage(t('albumDetail.artist.notFound', { artist: artistName }));
        }
      })
      .catch((error) => {
        setTrackActionMessage(error instanceof Error ? error.message : String(error));
      });
  }, [albumArtistLookupName, t]);

  const handleRelatedCoverError = useCallback((relatedAlbum: LibraryAlbum, coverUrl: string): void => {
    setFailedRelatedCoverUrls((current) => ({ ...current, [coverFailureKey(relatedAlbum.id, coverUrl)]: true }));
  }, []);

  const handleOpenRelatedAlbum = useCallback((relatedAlbum: LibraryAlbum): void => {
    if (relatedAlbum.id === album.id) {
      return;
    }

    window.dispatchEvent(new CustomEvent(albumDetailNavigationEvent, { detail: { album: relatedAlbum } }));
  }, [album.id]);

  const handleExternalLinkClick = useCallback((event: MouseEvent<HTMLAnchorElement>, url: string): void => {
    event.preventDefault();
    event.stopPropagation();
    const openExternalUrl = window.echo?.app?.openExternalUrl;
    if (!openExternalUrl) {
      return;
    }
    void openExternalUrl(url);
  }, []);

  const renderRelatedAlbums = (): JSX.Element | null => {
    if (!displayAlbumArtist) {
      return null;
    }

    if (relatedAlbumsState.loadedForAlbumId !== album.id || relatedAlbumsState.loading) {
      return (
        <section className="album-related-library" aria-label={t('albumDetail.related.aria', { artist: displayAlbumArtist })}>
          <header>
            <div>
              <span>{displayAlbumArtist}</span>
              <h2>{t('albumDetail.related.heading')}</h2>
            </div>
            <small>{t('albumDetail.related.loading')}</small>
          </header>
          <div className="album-related-loading">
            <Loader2 className="spinning-icon" size={16} />
          </div>
        </section>
      );
    }

    if (relatedAlbumsState.error || relatedAlbumsState.albums.length <= 1) {
      return null;
    }

    return (
      <section className="album-related-library" aria-label={t('albumDetail.related.aria', { artist: displayAlbumArtist })}>
        <header>
          <div>
            <span>{displayAlbumArtist}</span>
            <h2>{t('albumDetail.related.heading')}</h2>
          </div>
          <small>
            {relatedAlbumsState.albums.length === relatedAlbumsState.total
              ? t('albumDetail.count.albums', { count: relatedAlbumsState.total })
              : t('albumDetail.count.loadedAlbums', { loaded: relatedAlbumsState.albums.length, total: relatedAlbumsState.total })}
          </small>
        </header>
        <div className="album-related-album-strip">
          {relatedAlbumsState.albums.map((relatedAlbum) => {
            const relatedOriginalCover = albumOriginalCoverUrl(relatedAlbum);
            const relatedCoverUrl = relatedOriginalCover && !failedRelatedCoverUrls[coverFailureKey(relatedAlbum.id, relatedOriginalCover)]
              ? relatedOriginalCover
              : relatedAlbum.coverThumb && !failedRelatedCoverUrls[coverFailureKey(relatedAlbum.id, relatedAlbum.coverThumb)]
                ? relatedAlbum.coverThumb
                : null;
            const shouldShowCover = Boolean(relatedCoverUrl);
            const isCurrentAlbum = relatedAlbum.id === album.id;
            const relatedAlbumArtistLabel = isGenericAlbumArtistName(relatedAlbum.albumArtist) ? null : relatedAlbum.albumArtist;

            return (
              <article
                className="album-related-album-card"
                aria-current={isCurrentAlbum ? 'true' : undefined}
                aria-disabled={isCurrentAlbum ? true : undefined}
                data-current={isCurrentAlbum}
                key={relatedAlbum.id}
                role="button"
                tabIndex={isCurrentAlbum ? -1 : 0}
                onClick={() => handleOpenRelatedAlbum(relatedAlbum)}
                onKeyDown={(event) => {
                  if (!isCurrentAlbum && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    handleOpenRelatedAlbum(relatedAlbum);
                  }
                }}
              >
                <div className="album-related-album-cover" data-empty={!shouldShowCover} aria-hidden="true">
                  {shouldShowCover ? (
                    <img
                      alt=""
                      decoding="async"
                      draggable={false}
                      height={260}
                      loading="lazy"
                      src={relatedCoverUrl!}
                      width={260}
                      onError={() => handleRelatedCoverError(relatedAlbum, relatedCoverUrl!)}
                    />
                  ) : (
                    <Disc3 size={24} />
                  )}
                  {isCurrentAlbum ? <span>{t('albumDetail.related.thisAlbum')}</span> : null}
                </div>
                <div className="album-related-album-copy">
                  {relatedAlbum.year ? <small>{relatedAlbum.year}</small> : null}
                  <strong>{relatedAlbum.title}</strong>
                  {relatedAlbumArtistLabel ? <span>{relatedAlbumArtistLabel}</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  };

  const renderOnlineState = (section: 'sources' | 'releases' | 'information'): JSX.Element | null => {
    const info = onlineInfoState.info;
    const isEmpty =
      info &&
      (section === 'sources'
        ? info.sourceLinks.length === 0 && !info.releaseDetails
        : section === 'releases'
          ? info.releaseVersions.length === 0
          : !info.information && !info.artistInformation);

    if (onlineInfoState.loading && !info) {
      return (
        <div className="album-online-state">
          <Loader2 className="spinning-icon" size={18} />
          <span>{t('albumDetail.online.reading')}</span>
        </div>
      );
    }

    if (onlineInfoState.error && !info) {
      return (
        <div className="album-online-state">
          <strong>{t('albumDetail.online.unavailable')}</strong>
          <span>{onlineInfoState.error}</span>
          <button type="button" onClick={() => void loadOnlineInfo(true)}>
            <RefreshCw size={14} />
            {t('albumDetail.action.refresh')}
          </button>
        </div>
      );
    }

    if (isEmpty) {
      return (
        <div className="album-online-state">
          <strong>{t('albumDetail.online.emptyTitle')}</strong>
          <span>{info.errors[0] ?? t('albumDetail.online.emptyDescription')}</span>
          <button type="button" onClick={() => void loadOnlineInfo(true)} disabled={onlineInfoState.loading}>
            {onlineInfoState.loading ? <Loader2 className="spinning-icon" size={14} /> : <RefreshCw size={14} />}
            {t('albumDetail.action.refresh')}
          </button>
        </div>
      );
    }

    return null;
  };

  const renderOnlineHeader = (): JSX.Element | null => {
    const info = onlineInfoState.info;
    if (!info) {
      return null;
    }

    return (
      <div className="album-online-header">
        <div>
          <span>{t('albumDetail.online.sources')}</span>
          <strong>{info.sources.map((source) => source.label).join(' / ') || t('albumDetail.online.noSource')}</strong>
          {info.match ? (
            <small>
              {info.match.possible ? t('albumDetail.online.possibleMatch') : t('albumDetail.online.match')} - {formatConfidence(info.match.confidence)}
            </small>
          ) : null}
        </div>
        <button type="button" onClick={() => void loadOnlineInfo(true)} disabled={onlineInfoState.loading}>
          {onlineInfoState.loading ? <Loader2 className="spinning-icon" size={14} /> : <RefreshCw size={14} />}
          {t('albumDetail.action.refresh')}
        </button>
      </div>
    );
  };

  const renderExternalRatings = (): JSX.Element | null => {
    const ratings = onlineInfoState.info?.externalRatings ?? [];
    if (!ratings.length) {
      return null;
    }

    return (
      <section className="album-external-rating-grid" aria-label={t('albumDetail.ratings.overviewAria')}>
        {ratings.map((rating) => {
          const providerLabel = ratingProviderLabel(rating.provider);
          const meta = [
            rating.ratingCount !== null ? t('albumDetail.ratings.count', { count: formatRatingNumber(rating.ratingCount, locale, 0) }) : null,
            rating.rankText,
          ].filter(Boolean).join(' - ');
          const content = (
            <>
              <Star size={16} />
              <span>{providerLabel}</span>
              <strong>{formatRatingScore(rating, locale)}</strong>
              {meta ? <small>{meta}</small> : null}
            </>
          );

          return rating.url ? (
            <a
              className="album-external-rating-card"
              href={rating.url}
              key={`${rating.provider}:${rating.url}`}
              rel="noreferrer"
              target="_blank"
              title={rating.url}
              onClick={(event) => handleExternalLinkClick(event, rating.url ?? '')}
            >
              {content}
            </a>
          ) : (
            <article className="album-external-rating-card" key={`${rating.provider}:${rating.score}:${rating.maxScore}`}>
              {content}
            </article>
          );
        })}
      </section>
    );
  };

  const renderSources = (): JSX.Element => {
    const state = renderOnlineState('sources');
    if (state) {
      return state;
    }

    const info = onlineInfoState.info;
    const details = info?.releaseDetails ?? null;
    return (
      <div className="album-online-panel album-sources-panel">
        {renderOnlineHeader()}
        {renderExternalRatings()}
        {details ? (
          <section className="album-release-detail-card" aria-label={t('albumDetail.sources.releaseAria')}>
            <div>
              <span>{t('albumDetail.sources.releaseDetails')}</span>
              <h3>{details.title}</h3>
              <p>
                {[
                  details.date,
                  details.country,
                  details.status,
                  details.mediaFormats.join(' / ') || null,
                ].filter(Boolean).join(' - ')}
              </p>
            </div>
            <div className="album-release-facts">
              {details.barcode ? (
                <span>
                  <small>{t('albumDetail.sources.barcode')}</small>
                  <strong>{details.barcode}</strong>
                </span>
              ) : null}
              {details.labels.length ? (
                <span>
                  <small>{t('albumDetail.sources.labels')}</small>
                  <strong>{details.labels.map((label) => [label.name, label.catalogNumber].filter(Boolean).join(' / ')).join(', ')}</strong>
                </span>
              ) : null}
              {details.copyrights.length ? (
                <span>
                  <small>{t('albumDetail.sources.copyright')}</small>
                  <strong>{details.copyrights.join(', ')}</strong>
                </span>
              ) : null}
            </div>
          </section>
        ) : null}
        {info?.sourceLinks.length ? (
          <section className="album-source-link-grid" aria-label={t('albumDetail.sources.linksAria')}>
            {info.sourceLinks.map((link) => (
              <a key={link.url} href={link.url} rel="noreferrer" target="_blank" title={link.url} onClick={(event) => handleExternalLinkClick(event, link.url)}>
                <ExternalLink size={15} />
                <span>{sourceProviderLabel(link.provider)}</span>
                <strong>{link.label}</strong>
                <small>{sourceKindLabel(link.kind, t)}</small>
              </a>
            ))}
          </section>
        ) : null}
      </div>
    );
  };

  const renderReleases = (): JSX.Element => {
    const state = renderOnlineState('releases');
    if (state) {
      return state;
    }

    const info = onlineInfoState.info;
    return (
      <div className="album-online-panel album-releases-panel">
        {renderOnlineHeader()}
        <section className="album-information-overview" aria-label={t('albumDetail.releases.overviewAria')}>
          <Disc3 size={18} />
          <div>
            <span>{t('albumDetail.releases.heading')}</span>
            <strong>{t('albumDetail.releases.count', { count: info?.releaseVersions.length ?? 0 })}</strong>
            <small>{t('albumDetail.releases.currentHint')}</small>
          </div>
        </section>
        <div className="album-release-version-list">
          {info?.releaseVersions.map((version) => (
            <article className="album-release-version-card" data-current={version.isMatched} key={version.providerItemId}>
              <div>
                <span>{version.isMatched ? t('albumDetail.releases.current') : sourceProviderLabel('musicbrainz')}</span>
                <h3>{version.title}</h3>
                <p>{formatReleaseVersionMeta(version)}</p>
              </div>
              <div className="album-release-version-meta">
                {version.labels.length ? (
                  <span>
                    <small>{t('albumDetail.sources.labels')}</small>
                    <strong>{version.labels.join(', ')}</strong>
                  </span>
                ) : null}
                {version.catalogNumbers.length ? (
                  <span>
                    <small>{t('albumDetail.sources.catalogNumber')}</small>
                    <strong>{version.catalogNumbers.join(', ')}</strong>
                  </span>
                ) : null}
                {version.trackCount ? (
                  <span>
                    <small>{t('albumDetail.tab.tracks')}</small>
                    <strong>{formatTrackCount(version.trackCount, t)}</strong>
                  </span>
                ) : null}
              </div>
              <a href={version.url} rel="noreferrer" target="_blank" onClick={(event) => handleExternalLinkClick(event, version.url)}>
                <ExternalLink size={14} />
                {t('albumDetail.action.openSource')}
              </a>
            </article>
          ))}
        </div>
      </div>
    );
  };

  const renderInformation = (): JSX.Element => {
    const state = renderOnlineState('information');
    if (state) {
      return state;
    }

    const info = onlineInfoState.info;
    const renderInformationBlock = (block: AlbumInformationBlock): JSX.Element => {
      if (block.type === 'heading') {
        const HeadingTag = block.level <= 2 ? 'h4' : 'h5';
        return <HeadingTag key={block.key}>{block.text}</HeadingTag>;
      }
      if (block.type === 'list') {
        return (
          <ul key={block.key}>
            {block.items.map((item, index) => (
              <li key={`${block.key}-${index}`}>{item}</li>
            ))}
          </ul>
        );
      }
      return <p key={block.key}>{block.text}</p>;
    };
    const renderInformationArticle = (information: NonNullable<AlbumOnlineInfo['information']>, label: string): JSX.Element => (
      <section className="album-information-article" key={label}>
        <div className="album-information-main">
          <span>{label} - {information.language}.wikipedia.org</span>
          <h3>{information.title}</h3>
          {information.description ? <small>{information.description}</small> : null}
          <div className="album-information-body">{informationBlocksFromExtract(information.extract).map(renderInformationBlock)}</div>
          {information.externalLinks?.length ? (
            <div className="album-information-links" aria-label={t('albumDetail.information.externalLinks')}>
              <span>{t('albumDetail.information.externalLinks')}</span>
              <div>
                {information.externalLinks.map((link) => (
                  <a key={link.url} href={link.url} rel="noreferrer" target="_blank" title={link.url} onClick={(event) => handleExternalLinkClick(event, link.url)}>
                    <ExternalLink size={13} />
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="album-information-aside">
          {information.thumbnailUrl ? <img alt="" src={information.thumbnailUrl} loading="lazy" decoding="async" /> : null}
          {information.url ? (
            <a href={information.url} target="_blank" rel="noreferrer" onClick={(event) => handleExternalLinkClick(event, information.url ?? '')}>
              <ExternalLink size={14} />
              {t('albumDetail.action.openSource')}
            </a>
          ) : null}
        </div>
      </section>
    );

    return (
      <div className="album-online-panel album-information-panel">
        {renderOnlineHeader()}
        <section className="album-information-overview" aria-label={t('albumDetail.information.overviewAria')}>
          <Info size={18} />
          <div>
            <span>{t('albumDetail.information.atGlance')}</span>
            {displayAlbumArtist ? <strong>{displayAlbumArtist}</strong> : null}
            <small>{[album.title, album.year ? String(album.year) : null, formatTrackCount(album.trackCount, t)].filter(Boolean).join(' - ')}</small>
          </div>
        </section>
        <div className="album-information-articles">
          {info?.information ? renderInformationArticle(info.information, t('albumDetail.information.albumProfile')) : null}
          {info?.artistInformation ? renderInformationArticle(info.artistInformation, t('albumDetail.information.artistProfile')) : null}
        </div>
      </div>
    );
  };

  const renderAlbumMenu = (): JSX.Element | null => {
    if (!albumMenuPosition) {
      return null;
    }

    return createPortal(
      <div className="album-menu-layer" role="presentation" onMouseDown={closeAlbumMenu}>
        <div
          className="album-context-menu"
          role="menu"
          style={{ left: albumMenuPosition.x, top: albumMenuPosition.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            className="album-menu-item album-menu-item--branch"
            role="menuitem"
            type="button"
            onClick={(event) => openAlbumPlaylistSubmenu(event.currentTarget)}
            onMouseEnter={(event) => openAlbumPlaylistSubmenu(event.currentTarget)}
          >
            <Plus size={16} />
            <span>{t('albumMenu.action.addToPlaylist')}</span>
            <ChevronRight className="album-menu-branch-icon" size={15} />
          </button>
          <button className="album-menu-item" role="menuitem" type="button" onClick={() => void handleAddAlbumToQueue()}>
            <ListEnd size={16} />
            <span>{t('albumDetail.action.addToQueue')}</span>
          </button>
          {album.mediaType !== 'remote' ? (
            <button className="album-menu-item" role="menuitem" type="button" onClick={() => void handleShowAlbumInFolder()}>
              <FolderOpen size={16} />
              <span>{t('albumDetail.action.showInFolder')}</span>
            </button>
          ) : null}
        </div>
        {albumPlaylistSubmenuOpen ? (
          <div
            className="album-playlist-submenu"
            role="menu"
            aria-label={t('albumMenu.playlistSubmenu.aria')}
            style={{ left: albumPlaylistSubmenuPosition.x, top: albumPlaylistSubmenuPosition.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {albumPlaylistsLoading ? <div className="album-playlist-submenu-empty">{t('albumMenu.playlistSubmenu.loading')}</div> : null}
            {!albumPlaylistsLoading && albumPlaylists.length === 0 ? <div className="album-playlist-submenu-empty">{t('albumMenu.playlistSubmenu.empty')}</div> : null}
            {!albumPlaylistsLoading
              ? albumPlaylists.map((playlist) => (
                  <button
                    className="album-playlist-submenu-item"
                    key={playlist.id}
                    role="menuitem"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleAddAlbumToPlaylist(playlist);
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

  return (
    <div className={`album-detail-page ${isReturning ? 'is-returning' : ''}`} ref={detailRootRef}>
      <button className="album-back-button" type="button" onClick={returnBack}>
        <ArrowLeft size={17} />
        {t('albumDetail.action.back')}
      </button>

      <section className="album-detail-hero album-detail-switch-surface" key={`album-hero-${album.id}`} aria-label={t('albumDetail.aria.details', { album: album.title })}>
        <div className="album-detail-cover" data-empty={!detailCoverSrc} onContextMenu={handleDetailCoverContextMenu}>
          {detailCoverSrc ? (
            <img alt="" decoding="async" draggable={false} height={320} src={detailCoverSrc} width={320} onError={() => handleDetailCoverError(detailCoverSrc)} />
          ) : (
            <Disc3 size={58} />
          )}
        </div>

        <div className="album-detail-console">
          <div className="album-detail-copy">
            <span className="album-detail-kicker">{t('albumDetail.label.album')}</span>
            <h1>{album.title}</h1>
            {displayAlbumArtist ? (
              <button className="album-detail-artist-link" type="button" aria-label={t('albumDetail.aria.openArtist', { artist: displayAlbumArtist })} onClick={handleOpenAlbumArtist}>
                {displayAlbumArtist}
              </button>
            ) : null}

            <div className="album-detail-meta" aria-label={t('albumDetail.aria.metadata')}>
              {albumMetadata.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>

          <div className="album-detail-actions">
            <button className="album-primary-action" type="button" disabled={!firstTrack || isLoadingFirstTrack} onClick={handlePlayNow}>
              <Play size={16} fill="currentColor" />
              {isLoadingFirstTrack ? t('albumDetail.action.readingAlbum') : t('albumDetail.action.playNow')}
            </button>
            <button
              className={`album-icon-action ${isAlbumLiked ? 'is-liked' : ''}`}
              type="button"
              aria-label={isAlbumLiked ? t('albumDetail.action.unlikeAlbum') : t('albumDetail.action.likeAlbum')}
              aria-pressed={isAlbumLiked}
              title={isAlbumLiked ? t('albumDetail.action.unlikeAlbum') : t('albumDetail.action.likeAlbum')}
              onClick={() => void handleToggleAlbumLiked()}
            >
              <Heart size={16} fill={isAlbumLiked ? 'currentColor' : 'none'} />
            </button>
            <button className="album-icon-action" type="button" aria-label={t('albumDetail.action.more')} title={t('albumDetail.action.more')} onClick={handleOpenAlbumMenu}>
              <MoreHorizontal size={17} />
            </button>
          </div>

          {playError || trackActionMessage ? <p className="album-detail-error">{playError ?? trackActionMessage}</p> : null}
        </div>

        <aside className="album-detail-facts" aria-label={t('albumDetail.aria.info')}>
          {albumFacts.map((fact) => (
            <div className="album-fact" key={fact.label}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </div>
          ))}
        </aside>
      </section>

      {renderAlbumMenu()}

      <section className="album-detail-track-console album-detail-switch-surface" key={`album-console-${album.id}`} aria-label={t('albumDetail.aria.trackConsole', { album: album.title })}>
        <header className="album-detail-tabs" aria-label={t('albumDetail.aria.sections')}>
          <button className="album-detail-tab" type="button" aria-current={activeTab === 'tracks' ? 'page' : undefined} onClick={() => setActiveTab('tracks')}>
            {t('albumDetail.tab.tracks')}
          </button>
          <button className="album-detail-tab" type="button" aria-current={activeTab === 'sources' ? 'page' : undefined} onClick={() => setActiveTab('sources')}>
            {t('albumDetail.tab.sources')}
          </button>
          <button className="album-detail-tab" type="button" aria-current={activeTab === 'releases' ? 'page' : undefined} onClick={() => setActiveTab('releases')}>
            {t('albumDetail.tab.releases')}
          </button>
          <button className="album-detail-tab" type="button" aria-current={activeTab === 'information' ? 'page' : undefined} onClick={() => setActiveTab('information')}>
            {t('albumDetail.tab.information')}
          </button>
        </header>
        {activeTab === 'tracks' ? (
          <AlbumTrackList
            albumId={album.id}
            currentTrackId={currentTrackId}
            summary={{
              duration: duration ?? t('albumDetail.status.unknownLength'),
              signal: formatSummary ?? t('albumDetail.status.readingSignal'),
              totalLabel: loadedTotal > 0 ? formatTrackCount(loadedTotal, t) : formatTrackCount(album.trackCount, t),
            }}
            onFirstTrackChange={handleFirstTrackChange}
            onLoadedTracksChange={handleLoadedTracksChange}
            onOpenTrackMenu={handleOpenTrackMenu}
            onPlayTrack={handlePlayTrack}
            onToggleTrackLiked={handleToggleTrackLiked}
          />
        ) : activeTab === 'sources' ? (
          renderSources()
        ) : activeTab === 'releases' ? (
          renderReleases()
        ) : (
          renderInformation()
        )}
        {activeTab === 'tracks' ? renderRelatedAlbums() : null}
      </section>

      {trackMenu ? (
        <TrackContextMenu
          track={trackMenu.track}
          position={trackMenu.position}
          liked={likedTrackIds[trackMenu.track.id] === true}
          onAction={(action, track, playlist) => void handleTrackMenuAction(action, track, playlist)}
          onClose={() => setTrackMenu(null)}
        />
      ) : null}

      <TrackTagEditorDrawer
        track={editingTrack}
        isOpen={isTagEditorOpen}
        isSaving={isSavingTags}
        error={tagEditorError}
        onClose={closeTagEditor}
        onSave={(track, tags, coverPath, coverUrl, coverMimeType) => void handleSaveTags(track, tags, coverPath, coverUrl, coverMimeType)}
        onTrackUpdated={(updatedTrack) => {
          const nextTrack = withAlbumCoverFallback(updatedTrack);
          setEditingTrack(nextTrack);
          setLoadedTracks((current) => current.map((item) => (item.id === nextTrack.id ? nextTrack : item)));
          setFirstTrack((current) => (current?.id === nextTrack.id ? nextTrack : current));
          updateTrackSnapshot(nextTrack.id, nextTrack);
          window.dispatchEvent(new Event('library:changed'));
        }}
      />

      <OsuTimingPanel
        track={osuTimingTrack}
        isOpen={Boolean(osuTimingTrack)}
        onClose={() => setOsuTimingTrack(null)}
        onTrackUpdated={(updatedTrack) => {
          const nextTrack = withAlbumCoverFallback(updatedTrack);
          setOsuTimingTrack(nextTrack);
          setLoadedTracks((current) => current.map((item) => (item.id === nextTrack.id ? nextTrack : item)));
          setFirstTrack((current) => (current?.id === nextTrack.id ? nextTrack : current));
          updateTrackSnapshot(nextTrack.id, nextTrack);
        }}
      />
    </div>
  );
};
