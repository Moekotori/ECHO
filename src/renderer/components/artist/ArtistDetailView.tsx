import { startTransition, type KeyboardEvent, type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Disc3, Download, ExternalLink, ListPlus, Play, RefreshCw, Shuffle } from 'lucide-react';
import { defaultArtistStreamingAlbumsProvider, type AppSettings, type ArtistStreamingAlbumsProvider } from '../../../shared/types/appSettings';
import type { DownloadJob, DownloadJobStatus } from '../../../shared/types/downloads';
import type { ArtistInsights, ArtistOnlineInfoBio, LibraryAlbum, LibraryArtist, LibraryTrack } from '../../../shared/types/library';
import type { StreamingAlbum, StreamingAlbumDetail, StreamingProviderDescriptor, StreamingProviderName, StreamingTrack } from '../../../shared/types/streaming';
import { useAnimatedBackNavigation } from '../../hooks/useAnimatedBackNavigation';
import { useProgressiveRenderLimit } from '../../hooks/useProgressiveRenderLimit';
import { useI18n } from '../../i18n/I18nProvider';
import { readStreamingQualityPreference } from '../../preferences/streamingQualityPreference';
import { isPlaybackCancellationError, usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { AlbumDetailView } from '../album/AlbumDetailView';
import { readPageScrollTop, writePageScrollTop } from '../ui/InfiniteScrollSentinel';
import { ArtistAlbumGrid } from './ArtistAlbumGrid';
import { artistMark } from './artistVisual';

type ArtistDetailViewProps = {
  artist: LibraryArtist;
  onBack: () => void;
};

type Translate = ReturnType<typeof useI18n>['t'];
type ArtistDetailTab = 'overview' | 'albums';

const streamingAlbumPageSize = 20;
const streamingAlbumDetailFetchDelayMs = 220;
const streamingAlbumInitialTrackRenderCount = 24;
const streamingAlbumTrackRenderStep = 48;
const streamingAlbumTrackRenderDelayMs = 80;
const overviewTrackInitialCount = 6;
const overviewTrackLoadStep = 6;
const streamingAlbumDownloadQueueYieldMs = 90;

type StreamingAlbumProviderPageState = {
  nextPage: number;
  hasMore: boolean;
};

type StreamingAlbumDownloadState = {
  albumId: string;
  title: string;
  total: number;
  queued: number;
  failedToQueue: number;
  jobIds: string[];
};

const unsupportedStreamingAlbumDownloadProviders = new Set<StreamingProviderName>(['spotify', 'tidal', 'bilibili', 'youtube', 'plugin', 'mock', 'm3u8']);
const activeDownloadStatuses = new Set<DownloadJobStatus>(['queued', 'probing', 'downloading', 'extracting_audio', 'importing', 'binding_mv']);
const albumDownloadNoticeMinIntervalMs = 1200;
const albumDownloadNoticeMinProgressStep = 5;

type AlbumDownloadNoticeSnapshot = {
  message: string;
  progress: number;
  terminal: boolean;
  updatedAtMs: number;
};

const sleep = (delayMs: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, delayMs));

const showChromeNotice = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:show-chrome-notice', { detail: message }));
};

const formatDuration = (tracks: LibraryTrack[], t: Translate): string => {
  const totalSeconds = tracks.reduce((total, track) => total + (Number.isFinite(track.duration) ? track.duration : 0), 0);

  if (totalSeconds <= 0) {
    return t('artistDetail.duration.reading');
  }

  const minutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? t('artistDetail.duration.hours', { hours, minutes: rest }) : t('artistDetail.duration.minutes', { minutes });
};

const getConfiguredConcertSources = (settings: Partial<AppSettings> | null | undefined): string[] => {
  if (!settings) {
    return [];
  }

  return [
    settings.onlineArtistInfoBandsintownAppId ? 'Bandsintown' : null,
    settings.onlineArtistInfoTicketmasterApiKey ? 'Ticketmaster' : null,
    settings.onlineArtistInfoSeatGeekClientId ? 'SeatGeek' : null,
  ].filter((source): source is string => Boolean(source));
};

const maxOverviewBioLength = 2200;

const overviewBioParagraphs = (value: string): string[] => {
  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  const limited = normalized.length > maxOverviewBioLength ? `${normalized.slice(0, maxOverviewBioLength - 3).trim()}...` : normalized;
  if (!limited) {
    return [];
  }

  const sentences = limited.match(/[^。！？.!?]+[。！？.!?]?/gu)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [limited];
  const paragraphs: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const next = current ? `${current}${sentence}` : sentence;
    if (current && next.length > 280) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) {
    paragraphs.push(current);
  }

  return paragraphs.slice(0, 4);
};

const richOverviewBioParagraphs = (value: string): string[] => {
  if (!value.trim()) {
    return overviewBioParagraphs(value);
  }

  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  const limited = normalized.length > maxOverviewBioLength ? `${normalized.slice(0, maxOverviewBioLength - 3).trim()}...` : normalized;

  if (!limited) {
    return [];
  }

  const sourceParagraphs = limited
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  const paragraphs: string[] = [];

  for (const sourceParagraph of sourceParagraphs.length ? sourceParagraphs : [limited.replace(/\s+/gu, ' ')]) {
    const sentences = sourceParagraph.match(/[^。！？.!?]+[。！？.!?]?/gu)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [sourceParagraph];
    let current = '';

    for (const sentence of sentences) {
      const next = current ? `${current}${sentence}` : sentence;
      if (current && next.length > 360) {
        paragraphs.push(current);
        current = sentence;
      } else {
        current = next;
      }
    }

    if (current) {
      paragraphs.push(current);
    }

    if (paragraphs.length >= 6) {
      break;
    }
  }

  return paragraphs.slice(0, 6);
};

type OverviewBioSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; url: string };

type OverviewBioBlock =
  | { type: 'heading'; key: string; level: 2 | 3 | 4; text: string }
  | { type: 'paragraph'; key: string; segments: OverviewBioSegment[] };

const overviewBioFallbackBlocks = (text: string): OverviewBioBlock[] => [
  { type: 'paragraph', key: 'fallback', segments: [{ type: 'text', text }] },
];

const trimBioSegments = (segments: OverviewBioSegment[]): OverviewBioSegment[] => {
  const next = segments.map((segment) => ({ ...segment }));
  for (const segment of next) {
    if (segment.type === 'text') {
      segment.text = segment.text.trimStart();
      break;
    }
    if (segment.text.trim()) {
      break;
    }
  }
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const segment = next[index];
    if (segment.type === 'text') {
      segment.text = segment.text.trimEnd();
      break;
    }
    if (segment.text.trim()) {
      break;
    }
  }
  return next.filter((segment) => segment.text.trim());
};

const appendBioTextSegment = (segments: OverviewBioSegment[], value: string): void => {
  const text = value.replace(/\s+/gu, ' ');
  if (!text) {
    return;
  }
  const last = segments[segments.length - 1];
  if (last?.type === 'text') {
    last.text += text;
    return;
  }
  segments.push({ type: 'text', text });
};

const bioSegmentsText = (segments: OverviewBioSegment[]): string =>
  segments.map((segment) => segment.text).join('').replace(/\s+/gu, ' ').trim();

const safeBioLinkUrl = (href: string | null, baseUrl: string | null): string | null => {
  if (!href || href.startsWith('#')) {
    return null;
  }
  try {
    const url = new URL(href, baseUrl ?? undefined);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const collectBioSegments = (node: ChildNode, baseUrl: string | null, segments: OverviewBioSegment[]): void => {
  if (node.nodeType === 3) {
    appendBioTextSegment(segments, node.textContent ?? '');
    return;
  }
  if (node.nodeType !== 1) {
    return;
  }

  const element = node as Element;
  const tagName = element.tagName.toLocaleLowerCase();
  if (
    tagName === 'script' ||
    tagName === 'style' ||
    tagName === 'table' ||
    tagName === 'figure' ||
    tagName === 'sup' ||
    element.classList.contains('mw-editsection') ||
    element.classList.contains('reference')
  ) {
    return;
  }
  if (tagName === 'br') {
    appendBioTextSegment(segments, '\n');
    return;
  }
  if (tagName === 'a') {
    const childSegments: OverviewBioSegment[] = [];
    element.childNodes.forEach((child) => collectBioSegments(child, baseUrl, childSegments));
    const linkText = bioSegmentsText(trimBioSegments(childSegments));
    const linkUrl = safeBioLinkUrl(element.getAttribute('href'), baseUrl);
    if (linkText && linkUrl) {
      segments.push({ type: 'link', text: linkText, url: linkUrl });
    } else if (linkText) {
      appendBioTextSegment(segments, linkText);
    }
    return;
  }

  element.childNodes.forEach((child) => collectBioSegments(child, baseUrl, segments));
};

const htmlOverviewBioBlocks = (html: string | null | undefined, baseUrl: string | null): OverviewBioBlock[] => {
  if (!html?.trim() || typeof DOMParser === 'undefined') {
    return [];
  }

  const document = new DOMParser().parseFromString(html, 'text/html');
  const blocks: OverviewBioBlock[] = [];
  const shouldSkipElement = (element: Element): boolean => {
    const tagName = element.tagName.toLocaleLowerCase();
    return (
      tagName === 'script' ||
      tagName === 'style' ||
      tagName === 'table' ||
      tagName === 'figure' ||
      tagName === 'sup' ||
      element.classList.contains('infobox') ||
      element.classList.contains('navbox') ||
      element.classList.contains('metadata') ||
      element.classList.contains('reference') ||
      element.classList.contains('reflist') ||
      element.classList.contains('mw-editsection')
    );
  };
  const visitElement = (element: Element): void => {
    if (blocks.length >= 10) {
      return;
    }
    if (shouldSkipElement(element)) {
      return;
    }
    const tagName = element.tagName.toLocaleLowerCase();
    if (/^h[2-4]$/u.test(tagName)) {
      const segments: OverviewBioSegment[] = [];
      element.childNodes.forEach((child) => collectBioSegments(child, baseUrl, segments));
      const text = bioSegmentsText(trimBioSegments(segments));
      if (text) {
        blocks.push({ type: 'heading', key: `h-${blocks.length}-${text}`, level: Number(tagName.slice(1)) as 2 | 3 | 4, text });
      }
      return;
    }
    if (tagName === 'p' || tagName === 'li' || tagName === 'dd' || tagName === 'dt') {
      const segments: OverviewBioSegment[] = [];
      element.childNodes.forEach((child) => collectBioSegments(child, baseUrl, segments));
      const cleaned = trimBioSegments(segments);
      if (cleaned.length > 0 && bioSegmentsText(cleaned)) {
        blocks.push({ type: 'paragraph', key: `p-${blocks.length}-${bioSegmentsText(cleaned).slice(0, 32)}`, segments: cleaned });
      }
      return;
    }
    if (element.children.length > 0) {
      Array.from(element.children).forEach(visitElement);
      return;
    }

    const segments: OverviewBioSegment[] = [];
    element.childNodes.forEach((child) => collectBioSegments(child, baseUrl, segments));
    const cleaned = trimBioSegments(segments);
    if (cleaned.length > 0 && bioSegmentsText(cleaned)) {
      blocks.push({ type: 'paragraph', key: `text-${blocks.length}-${bioSegmentsText(cleaned).slice(0, 32)}`, segments: cleaned });
    }
  };

  Array.from(document.body.children).forEach(visitElement);
  return blocks.slice(0, 8);
};

const plainOverviewBioBlocks = (value: string): OverviewBioBlock[] => {
  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  const limited = normalized.length > maxOverviewBioLength ? `${normalized.slice(0, maxOverviewBioLength - 3).trim()}...` : normalized;
  const blocks: OverviewBioBlock[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = (): void => {
    const text = paragraphLines.join(' ').trim();
    paragraphLines = [];
    if (!text) {
      return;
    }
    richOverviewBioParagraphs(text).forEach((paragraph) => {
      blocks.push({
        type: 'paragraph',
        key: `plain-p-${blocks.length}-${paragraph.slice(0, 32)}`,
        segments: [{ type: 'text', text: paragraph }],
      });
    });
  };

  for (const line of limited.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    const heading = trimmed.match(/^(={2,6})\s*(.*?)\s*\1$/u);
    if (heading?.[2]) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        key: `plain-h-${blocks.length}-${heading[2]}`,
        level: Math.min(4, Math.max(2, heading[1].length)) as 2 | 3 | 4,
        text: heading[2].trim(),
      });
      continue;
    }
    paragraphLines.push(trimmed);
  }
  flushParagraph();
  return blocks.slice(0, 8);
};

const overviewBioBlocksFor = (bio: ArtistOnlineInfoBio): OverviewBioBlock[] => {
  const baseUrl = bio.url ?? (bio.language ? `https://${bio.language}.wikipedia.org/wiki/` : null);
  const htmlBlocks = htmlOverviewBioBlocks(bio.extractHtml, baseUrl);
  return htmlBlocks.length > 0 ? htmlBlocks : plainOverviewBioBlocks(bio.extract);
};

const formatTrackDuration = (duration: number): string => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return '--:--';
  }

  const totalSeconds = Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const aroundWebHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./iu, '');
  } catch {
    return url;
  }
};

const aroundWebLabel = (label: string, url: string): string => {
  const host = aroundWebHost(url);
  const lower = `${label} ${host}`.toLocaleLowerCase();
  if (lower.includes('youtube')) {
    return 'YouTube';
  }
  if (lower.includes('instagram')) {
    return 'Instagram';
  }
  if (lower.includes('twitter') || lower.includes('x.com')) {
    return 'X';
  }
  if (lower.includes('spotify')) {
    return 'Spotify';
  }
  if (lower.includes('facebook')) {
    return 'Facebook';
  }
  if (lower.includes('official') || lower.includes('homepage') || lower.includes('site')) {
    return 'Official';
  }
  return label || host;
};

const isAroundWebLink = (label: string, url: string): boolean => {
  const value = `${label} ${url}`.toLocaleLowerCase();
  return /official|homepage|site|youtube|instagram|twitter|x\.com|spotify|facebook|tiktok|soundcloud|linkfire|bandcamp/u.test(value);
};

const normalizeStreamingAlbumText = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s*\([^)]*\)|\s*（[^）]*）/gu, '').replace(/[\s._'’"-]+/gu, '');

const streamingAlbumArtistTokens = (value: string): string[] =>
  value
    .split(/\s*(?:,|、|\/|&|;|；|\|| feat\.? | featuring | with | x |×|\+|＋)\s*/iu)
    .map(normalizeStreamingAlbumText)
    .filter(Boolean);

const streamingAlbumMatchesArtist = (album: StreamingAlbum, artistName: string): boolean => {
  const expected = normalizeStreamingAlbumText(artistName);
  if (!expected) {
    return false;
  }

  const candidates = new Set([
    album.artist,
    ...album.artists.map((artist) => artist.name),
  ].flatMap(streamingAlbumArtistTokens));
  return candidates.has(expected);
};

const normalizeStreamingAlbumProvider = (value: unknown): ArtistStreamingAlbumsProvider =>
  value === 'qqmusic' ? 'qqmusic' : defaultArtistStreamingAlbumsProvider;

const isStreamingAlbumProviderAvailable = (
  providerName: ArtistStreamingAlbumsProvider,
  providers: StreamingProviderDescriptor[],
): boolean => {
  const descriptor = providers.find((provider) => provider.name === providerName);
  if (!descriptor) {
    return true;
  }

  return (
    descriptor.enabled &&
    descriptor.supportsSearch &&
    descriptor.status !== 'disabled' &&
    (descriptor.requiresAccount !== true || descriptor.accountConnected === true)
  );
};

const streamingAlbumMeta = (album: StreamingAlbum): string =>
  [
    album.provider,
    album.trackCount ? `${album.trackCount} 首歌` : null,
    album.releaseDate,
  ].filter(Boolean).join(' / ');

const streamingAlbumCoverFailureKey = (album: StreamingAlbum, coverUrl: string): string => `${album.id}\n${coverUrl}`;

const mergeUniqueStreamingAlbums = (current: StreamingAlbum[], incoming: StreamingAlbum[]): StreamingAlbum[] =>
  Array.from(new Map([...current, ...incoming].map((album) => [`${album.provider}:${album.providerAlbumId || album.id}`, album])).values());

const streamingTrackWebUrl = (track: StreamingTrack): string | null => {
  switch (track.provider) {
    case 'netease':
      return `https://music.163.com/#/song?id=${encodeURIComponent(track.providerTrackId)}`;
    case 'qqmusic':
      return `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(track.providerTrackId)}`;
    case 'kugou':
      return `https://www.kugou.com/song/#hash=${encodeURIComponent(track.providerTrackId.split('.')[0] ?? track.providerTrackId)}`;
    default:
      return null;
  }
};

const streamingTrackToLibraryTrack = (track: StreamingTrack): LibraryTrack => ({
  id: track.stableKey || `${track.provider}:${track.providerTrackId}`,
  mediaType: 'streaming',
  path: track.stableKey,
  provider: track.provider,
  providerTrackId: track.providerTrackId,
  streamingQuality: readStreamingQualityPreference(),
  stableKey: track.stableKey,
  title: track.title,
  artist: track.artist,
  album: track.album,
  albumArtist: track.albumArtist ?? track.artist,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: track.duration ?? 0,
  codec: null,
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  coverId: null,
  coverThumb: track.coverThumb ?? track.coverUrl,
  fieldSources: {
    title: track.provider,
    artist: track.provider,
    album: track.provider,
  },
  unavailable: !track.playable,
});

const concertSourceName = (source: string): string => {
  const labels: Record<string, string> = {
    bandsintown: 'Bandsintown',
    ticketmaster: 'Ticketmaster',
    seatgeek: 'SeatGeek',
    songkick: 'Songkick',
    eplus: 'eplus',
    eventernote: 'Eventernote',
  };
  return labels[source] ?? source;
};

const formatEventDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatEventDateParts = (value: string): { month: string; day: string; label: string } => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { month: '', day: value, label: value };
  }

  return {
    month: date.toLocaleDateString(undefined, { month: 'short' }),
    day: date.toLocaleDateString(undefined, { day: 'numeric' }),
    label: formatEventDate(value),
  };
};

const formatEventTime = (value: string, timeTbd?: boolean): string | null => {
  if (timeTbd) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const eventPrimaryLocation = (event: ArtistInsights['concerts']['events'][number], t: Translate): string =>
  event.city || event.venueName || event.region || event.country || t('artistDetail.events.venuePending');

const eventSecondaryInfo = (event: ArtistInsights['concerts']['events'][number]): string =>
  [
    event.title,
    event.venueName && event.venueName !== event.city ? event.venueName : null,
    event.region && event.region !== event.city ? event.region : null,
    event.country && event.country !== event.city && event.country !== event.region ? event.country : null,
  ].filter(Boolean).join(' / ');

export const ArtistDetailView = ({ artist, onBack }: ArtistDetailViewProps): JSX.Element => {
  const { t } = useI18n();
  const { appendToQueue, playTrack, replaceQueue } = usePlaybackQueue();
  const [verifiedArtist, setVerifiedArtist] = useState<LibraryArtist | null>(artist);
  const [isVerifyingArtist, setIsVerifyingArtist] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [loadedTracks, setLoadedTracks] = useState<LibraryTrack[]>([]);
  const [loadedTrackTotal, setLoadedTrackTotal] = useState(artist.trackCount);
  const [overviewTrackVisibleCount, setOverviewTrackVisibleCount] = useState(overviewTrackInitialCount);
  const [areTracksLoading, setAreTracksLoading] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [artistInsights, setArtistInsights] = useState<ArtistInsights | null>(null);
  const [areInsightsLoading, setAreInsightsLoading] = useState(false);
  const [onlineRefreshRequest, setOnlineRefreshRequest] = useState(0);
  const [configuredConcertSources, setConfiguredConcertSources] = useState<string[]>([]);
  const [configuredConcertRegion, setConfiguredConcertRegion] = useState<string | null>(null);
  const [onlineArtistInfoSourcesKey, setOnlineArtistInfoSourcesKey] = useState('');
  const [downloadsFeatureUnlocked, setDownloadsFeatureUnlocked] = useState(false);
  const [streamingAlbumsEnabled, setStreamingAlbumsEnabled] = useState(true);
  const [streamingAlbumProvider, setStreamingAlbumProvider] = useState<ArtistStreamingAlbumsProvider>(defaultArtistStreamingAlbumsProvider);
  const [streamingAlbums, setStreamingAlbums] = useState<StreamingAlbum[]>([]);
  const [streamingAlbumVisibleCount, setStreamingAlbumVisibleCount] = useState(streamingAlbumPageSize);
  const [streamingAlbumProviderPages, setStreamingAlbumProviderPages] = useState<Record<string, StreamingAlbumProviderPageState>>({});
  const [areStreamingAlbumsLoading, setAreStreamingAlbumsLoading] = useState(false);
  const [areMoreStreamingAlbumsLoading, setAreMoreStreamingAlbumsLoading] = useState(false);
  const [streamingAlbumsError, setStreamingAlbumsError] = useState<string | null>(null);
  const [failedStreamingAlbumCoverUrls, setFailedStreamingAlbumCoverUrls] = useState<Record<string, true>>({});
  const [areConcertsExpanded, setAreConcertsExpanded] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState<LibraryAlbum | null>(null);
  const [selectedStreamingAlbum, setSelectedStreamingAlbum] = useState<StreamingAlbum | null>(null);
  const [selectedStreamingAlbumDetail, setSelectedStreamingAlbumDetail] = useState<StreamingAlbumDetail | null>(null);
  const [isStreamingAlbumDetailLoading, setIsStreamingAlbumDetailLoading] = useState(false);
  const [streamingAlbumDetailError, setStreamingAlbumDetailError] = useState<string | null>(null);
  const [resolvingStreamingTrackKey, setResolvingStreamingTrackKey] = useState<string | null>(null);
  const [streamingAlbumDownload, setStreamingAlbumDownload] = useState<StreamingAlbumDownloadState | null>(null);
  const [queuedStreamingTrackKey, setQueuedStreamingTrackKey] = useState<string | null>(null);
  const [failedHeroImageUrl, setFailedHeroImageUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ArtistDetailTab>('overview');
  const detailRootRef = useRef<HTMLDivElement | null>(null);
  const detailScrollTopRef = useRef(0);
  const shouldRestoreDetailScrollRef = useRef(false);
  const streamingAlbumDownloadRunIdRef = useRef(0);
  const lastStreamingAlbumDownloadNoticeRef = useRef<AlbumDownloadNoticeSnapshot | null>(null);
  const handleBackFromStreamingAlbum = useCallback((): void => {
    setSelectedStreamingAlbum(null);
    setSelectedStreamingAlbumDetail(null);
    setStreamingAlbumDetailError(null);
    setResolvingStreamingTrackKey(null);
    setStreamingAlbumDownload(null);
    streamingAlbumDownloadRunIdRef.current += 1;
  }, []);
  const { isReturning, returnBack } = useAnimatedBackNavigation(onBack, !selectedAlbum && !selectedStreamingAlbum, { rootRef: detailRootRef });
  const { isReturning: isStreamingAlbumReturning, returnBack: returnBackFromStreamingAlbum } = useAnimatedBackNavigation(
    handleBackFromStreamingAlbum,
    Boolean(selectedStreamingAlbum),
    { rootRef: detailRootRef },
  );
  const source = useMemo(() => ({ type: 'artist' as const, label: artist.name, artistId: artist.id }), [artist.id, artist.name]);
  const displayArtist = verifiedArtist?.id === artist.id ? verifiedArtist : artist;
  const displayedTrackCount = Math.max(displayArtist.trackCount, loadedTrackTotal);
  const heroImageUrl = displayArtist.avatarUrl ?? (displayArtist.coverId ? `echo-cover://original/${encodeURIComponent(displayArtist.coverId)}` : null);
  const shouldShowHeroImage = Boolean(heroImageUrl && failedHeroImageUrl !== heroImageUrl);
  const selectedStreamingAlbumTrackRenderLimit = useProgressiveRenderLimit({
    identityKey: selectedStreamingAlbumDetail?.id ?? selectedStreamingAlbum?.id ?? null,
    itemCount: selectedStreamingAlbumDetail?.tracks.length ?? 0,
    initialCount: streamingAlbumInitialTrackRenderCount,
    step: streamingAlbumTrackRenderStep,
    delayMs: streamingAlbumTrackRenderDelayMs,
  });
  const handleSelectTab = useCallback((nextTab: ArtistDetailTab): void => {
    if (nextTab === activeTab) {
      return;
    }

    startTransition(() => setActiveTab(nextTab));
  }, [activeTab]);

  useEffect(() => {
    setVerifiedArtist(artist);
    setFailedHeroImageUrl(null);
  }, [artist]);

  useEffect(() => {
    let isCancelled = false;

    const verifyArtist = async (): Promise<void> => {
      const library = window.echo?.library;

      if (!library?.getArtist) {
        setVerifyError(t('artistDetail.error.desktopBridgeRead'));
        return;
      }

      setIsVerifyingArtist(true);
      setVerifyError(null);

      try {
        const result = await library.getArtist(artist.id);

        if (!isCancelled) {
          setVerifiedArtist(result);
        }
      } catch (error) {
        if (!isCancelled) {
          setVerifyError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!isCancelled) {
          setIsVerifyingArtist(false);
        }
      }
    };

    void verifyArtist();

    return () => {
      isCancelled = true;
    };
  }, [artist.id, t]);

  useEffect(() => {
    setSelectedAlbum(null);
    setFailedHeroImageUrl(null);
    setFailedStreamingAlbumCoverUrls({});
    setStreamingAlbums([]);
    setStreamingAlbumVisibleCount(streamingAlbumPageSize);
    setStreamingAlbumProviderPages({});
    setStreamingAlbumsError(null);
    setSelectedStreamingAlbum(null);
    setSelectedStreamingAlbumDetail(null);
    setStreamingAlbumDetailError(null);
    setResolvingStreamingTrackKey(null);
    setQueuedStreamingTrackKey(null);
    setAreConcertsExpanded(true);
    setOverviewTrackVisibleCount(overviewTrackInitialCount);
    setActiveTab('overview');
  }, [artist.id]);

  useEffect(() => {
    let isCancelled = false;

    const loadArtistTracks = async (): Promise<void> => {
      const library = window.echo?.library;

      if (!library?.getArtistTracks) {
        setLoadedTracks([]);
        setLoadedTrackTotal(artist.trackCount);
        setAreTracksLoading(false);
        setPlayError(t('artistDetail.tracks.error.desktopBridgeRead'));
        return;
      }

      setAreTracksLoading(true);
      setPlayError(null);

      try {
        const result = await library.getArtistTracks(artist.id, {
          page: 1,
          pageSize: Math.min(Math.max(artist.trackCount, 50), 500),
          sort: 'default',
        });

        if (!isCancelled) {
          setLoadedTracks(result.items);
          setLoadedTrackTotal(result.total);
        }
      } catch (error) {
        if (!isCancelled) {
          setLoadedTracks([]);
          setLoadedTrackTotal(artist.trackCount);
          setPlayError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!isCancelled) {
          setAreTracksLoading(false);
        }
      }
    };

    void loadArtistTracks();

    return () => {
      isCancelled = true;
    };
  }, [artist.id, artist.trackCount, t]);

  useEffect(() => {
    let isCancelled = false;

    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (isCancelled) {
        return;
      }

      const hasConcertSettings = !settings || (
        Object.prototype.hasOwnProperty.call(settings, 'onlineArtistInfoBandsintownAppId') ||
        Object.prototype.hasOwnProperty.call(settings, 'onlineArtistInfoTicketmasterApiKey') ||
        Object.prototype.hasOwnProperty.call(settings, 'onlineArtistInfoSeatGeekClientId') ||
        Object.prototype.hasOwnProperty.call(settings, 'onlineArtistInfoRegion')
      );
      if (hasConcertSettings) {
        setConfiguredConcertSources(getConfiguredConcertSources(settings));
        setConfiguredConcertRegion(settings?.onlineArtistInfoRegion?.trim() || null);
      }
      if (!settings || Object.prototype.hasOwnProperty.call(settings, 'onlineArtistInfoSources')) {
        setOnlineArtistInfoSourcesKey(Array.isArray(settings?.onlineArtistInfoSources) ? settings.onlineArtistInfoSources.join('|') : '');
      }
      if (!settings || Object.prototype.hasOwnProperty.call(settings, 'downloadsFeatureUnlocked')) {
        setDownloadsFeatureUnlocked(settings?.downloadsFeatureUnlocked === true);
      }
      if (!settings || Object.prototype.hasOwnProperty.call(settings, 'artistStreamingAlbumsEnabled')) {
        setStreamingAlbumsEnabled(settings?.artistStreamingAlbumsEnabled !== false);
      }
      if (!settings || Object.prototype.hasOwnProperty.call(settings, 'artistStreamingAlbumsProvider')) {
        setStreamingAlbumProvider(normalizeStreamingAlbumProvider(settings?.artistStreamingAlbumsProvider));
      }
    };

    void window.echo?.app?.getSettings?.().then(applySettings).catch(() => applySettings(null));

    const handleSettingsChanged = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail as Partial<AppSettings> : null;
      if (
        detail &&
        (
          Object.prototype.hasOwnProperty.call(detail, 'onlineArtistInfoBandsintownAppId') ||
          Object.prototype.hasOwnProperty.call(detail, 'onlineArtistInfoTicketmasterApiKey') ||
          Object.prototype.hasOwnProperty.call(detail, 'onlineArtistInfoSeatGeekClientId') ||
          Object.prototype.hasOwnProperty.call(detail, 'onlineArtistInfoRegion') ||
          Object.prototype.hasOwnProperty.call(detail, 'onlineArtistInfoSources') ||
          Object.prototype.hasOwnProperty.call(detail, 'downloadsFeatureUnlocked') ||
          Object.prototype.hasOwnProperty.call(detail, 'artistStreamingAlbumsEnabled') ||
          Object.prototype.hasOwnProperty.call(detail, 'artistStreamingAlbumsProvider')
        )
      ) {
        applySettings(detail);
      }
    };

    window.addEventListener('settings:changed', handleSettingsChanged);

    return () => {
      isCancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    const downloads = window.echo?.downloads;
    if (!downloads?.onJobsUpdated || !streamingAlbumDownload?.jobIds.length) {
      return undefined;
    }

    return downloads.onJobsUpdated((jobs: DownloadJob[]) => {
      const albumJobs = streamingAlbumDownload.jobIds
        .map((jobId) => jobs.find((job) => job.id === jobId) ?? null)
        .filter((job): job is DownloadJob => Boolean(job));
      const completedCount = albumJobs.filter((job) => job.status === 'completed').length;
      const failedCount = streamingAlbumDownload.failedToQueue + albumJobs.filter((job) => job.status === 'failed' || job.status === 'cancelled').length;
      const terminalCount = completedCount + failedCount;
      const activeJob = albumJobs.find((job) => activeDownloadStatuses.has(job.status)) ?? null;
      const activeProgress = activeJob ? Math.max(0, Math.min(100, activeJob.progress)) / 100 : 0;
      const progress = Math.round(Math.max(0, Math.min(100, ((completedCount + activeProgress) / streamingAlbumDownload.total) * 100)));
      const notice =
        terminalCount >= streamingAlbumDownload.total
          ? failedCount > 0
            ? `专辑下载结束：${streamingAlbumDownload.title}，完成 ${completedCount}/${streamingAlbumDownload.total}，失败 ${failedCount}`
            : `专辑下载完成：${streamingAlbumDownload.title}（${streamingAlbumDownload.total}/${streamingAlbumDownload.total}）`
          : `专辑下载中：${streamingAlbumDownload.title}，${completedCount}/${streamingAlbumDownload.total} · ${progress}%`;

      const now = Date.now();
      const lastNotice = lastStreamingAlbumDownloadNoticeRef.current;
      const shouldShowNotice =
        !lastNotice ||
        terminalCount >= streamingAlbumDownload.total ||
        now - lastNotice.updatedAtMs >= albumDownloadNoticeMinIntervalMs ||
        Math.abs(progress - lastNotice.progress) >= albumDownloadNoticeMinProgressStep;

      if (shouldShowNotice && lastNotice?.message !== notice) {
        lastStreamingAlbumDownloadNoticeRef.current = {
          message: notice,
          progress,
          terminal: terminalCount >= streamingAlbumDownload.total,
          updatedAtMs: now,
        };
        showChromeNotice(notice);
      }

      if (terminalCount >= streamingAlbumDownload.total && streamingAlbumDownload.queued + streamingAlbumDownload.failedToQueue >= streamingAlbumDownload.total) {
        setStreamingAlbumDownload(null);
      }
    });
  }, [streamingAlbumDownload]);

  useEffect(() => {
    let isCancelled = false;

    const loadInsights = async (): Promise<void> => {
      const library = window.echo?.library;
      if (!library?.getArtistInsights) {
        setArtistInsights(null);
        return;
      }

      setAreInsightsLoading(true);

      try {
        const localResult = await library.getArtistInsights(artist.id, { limit: 12, includeOnline: false });
        if (!isCancelled) {
          setArtistInsights(localResult);
        }

        const result = await library.getArtistInsights(artist.id, {
          limit: 12,
          includeOnline: true,
          forceOnline: onlineRefreshRequest > 0,
          region: configuredConcertRegion,
        });
        if (!isCancelled) {
          setArtistInsights(result);
        }
      } catch (error) {
        if (!isCancelled) {
          setArtistInsights(null);
        }
      } finally {
        if (!isCancelled) {
          setAreInsightsLoading(false);
        }
      }
    };

    void loadInsights();

    return () => {
      isCancelled = true;
    };
  }, [artist.id, configuredConcertRegion, configuredConcertSources.length, onlineArtistInfoSourcesKey, onlineRefreshRequest]);

  useEffect(() => {
    let isCancelled = false;

    const loadStreamingAlbums = async (): Promise<void> => {
      const streaming = window.echo?.streaming;
      if (!streamingAlbumsEnabled || activeTab !== 'albums') {
        setStreamingAlbums([]);
        setStreamingAlbumVisibleCount(streamingAlbumPageSize);
        setStreamingAlbumProviderPages({});
        setStreamingAlbumsError(null);
        setAreStreamingAlbumsLoading(false);
        setAreMoreStreamingAlbumsLoading(false);
        return;
      }

      if (!streaming?.search) {
        setStreamingAlbums([]);
        setStreamingAlbumVisibleCount(streamingAlbumPageSize);
        setStreamingAlbumProviderPages({});
        setStreamingAlbumsError('桌面桥接不可用。请在 ECHO Next 桌面版中搜索流媒体专辑。');
        setAreStreamingAlbumsLoading(false);
        setAreMoreStreamingAlbumsLoading(false);
        return;
      }

      setAreStreamingAlbumsLoading(true);
      setAreMoreStreamingAlbumsLoading(false);
      setStreamingAlbumVisibleCount(streamingAlbumPageSize);
      setStreamingAlbumProviderPages({});
      setStreamingAlbumsError(null);

      try {
        const providers = streaming.getProviders ? await streaming.getProviders() : [];
        if (!isStreamingAlbumProviderAvailable(streamingAlbumProvider, providers)) {
          if (!isCancelled) {
            setStreamingAlbums([]);
            setStreamingAlbumProviderPages({});
            setStreamingAlbumsError(null);
          }
          return;
        }
        const result = await streaming.search({
          provider: streamingAlbumProvider,
          query: displayArtist.name,
          mediaTypes: ['album'],
          page: 1,
          pageSize: streamingAlbumPageSize,
        });
        const albums = result.albums
          .filter((album) => streamingAlbumMatchesArtist(album, displayArtist.name));
        const nextProviderPages = {
          [streamingAlbumProvider]: {
            nextPage: result.page + 1,
            hasMore: result.hasMore,
          },
        };
        const uniqueAlbums = mergeUniqueStreamingAlbums([], albums);

        if (!isCancelled) {
          setStreamingAlbums(uniqueAlbums);
          setStreamingAlbumProviderPages(nextProviderPages);
          setStreamingAlbumsError(null);
        }
      } catch (error) {
        if (!isCancelled) {
          setStreamingAlbums([]);
          setStreamingAlbumProviderPages({});
          setStreamingAlbumsError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!isCancelled) {
          setAreStreamingAlbumsLoading(false);
        }
      }
    };

    void loadStreamingAlbums();

    return () => {
      isCancelled = true;
    };
  }, [activeTab, displayArtist.name, streamingAlbumProvider, streamingAlbumsEnabled]);

  useEffect(() => {
    let isCancelled = false;
    let timer: number | null = null;
    const album = selectedStreamingAlbum;
    const streaming = window.echo?.streaming;

    const loadStreamingAlbumDetail = async (): Promise<void> => {
      if (!album || !streaming?.getAlbum) {
        return;
      }

      try {
        const detail = await streaming.getAlbum({
          provider: album.provider,
          providerAlbumId: album.providerAlbumId,
        });
        if (!isCancelled) {
          setSelectedStreamingAlbumDetail(detail);
        }
      } catch (error) {
        if (!isCancelled) {
          setSelectedStreamingAlbumDetail(null);
          setStreamingAlbumDetailError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!isCancelled) {
          setIsStreamingAlbumDetailLoading(false);
        }
      }
    };

    if (!album) {
      setSelectedStreamingAlbumDetail(null);
      setStreamingAlbumDetailError(null);
      setIsStreamingAlbumDetailLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    if (!streaming?.getAlbum) {
      setSelectedStreamingAlbumDetail(null);
      setStreamingAlbumDetailError('桌面桥接不可用。请在 ECHO Next 桌面版中读取流媒体专辑。');
      setIsStreamingAlbumDetailLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsStreamingAlbumDetailLoading(true);
    setStreamingAlbumDetailError(null);
    timer = window.setTimeout(() => {
      void loadStreamingAlbumDetail();
    }, streamingAlbumDetailFetchDelayMs);

    return () => {
      isCancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [selectedStreamingAlbum]);

  useLayoutEffect(() => {
    if (selectedAlbum || selectedStreamingAlbum || !shouldRestoreDetailScrollRef.current) {
      return;
    }

    writePageScrollTop(detailRootRef.current, detailScrollTopRef.current);
    shouldRestoreDetailScrollRef.current = false;
  }, [selectedAlbum, selectedStreamingAlbum]);

  const handlePlayArtist = useCallback(async (): Promise<void> => {
    const firstTrack = loadedTracks[0];

    if (!firstTrack) {
      return;
    }

    try {
      setPlayError(null);
      replaceQueue(loadedTracks, { startTrackId: firstTrack.id, source });
      await playTrack(firstTrack, { source });
    } catch (error) {
      setPlayError(error instanceof Error ? error.message : String(error));
    }
  }, [loadedTracks, playTrack, replaceQueue, source]);

  const handleShuffleArtist = useCallback(async (): Promise<void> => {
    if (loadedTracks.length === 0) {
      return;
    }

    const startTrack = loadedTracks[Math.floor(Math.random() * loadedTracks.length)];

    try {
      setPlayError(null);
      replaceQueue(loadedTracks, { startTrackId: startTrack.id, source });
      await playTrack(startTrack, { source });
    } catch (error) {
      setPlayError(error instanceof Error ? error.message : String(error));
    }
  }, [loadedTracks, playTrack, replaceQueue, source]);

  const handlePlayPreviewTrack = useCallback(
    async (track: LibraryTrack): Promise<void> => {
      try {
        setPlayError(null);
        replaceQueue(loadedTracks.length > 0 ? loadedTracks : [track], { startTrackId: track.id, source });
        await playTrack(track, { source });
      } catch (error) {
        setPlayError(error instanceof Error ? error.message : String(error));
      }
    },
    [loadedTracks, playTrack, replaceQueue, source],
  );

  const handleQueueArtist = useCallback((): void => {
    loadedTracks.forEach((track) => appendToQueue(track, source));
  }, [appendToQueue, loadedTracks, source]);

  const handleLoadMoreOverviewTracks = useCallback((): void => {
    setOverviewTrackVisibleCount((current) => Math.min(current + overviewTrackLoadStep, loadedTracks.length));
  }, [loadedTracks.length]);
  const handleExpandAllOverviewTracks = useCallback((): void => {
    setOverviewTrackVisibleCount(loadedTracks.length);
  }, [loadedTracks.length]);

  const handleSelectAlbum = useCallback((album: LibraryAlbum): void => {
    detailScrollTopRef.current = readPageScrollTop(detailRootRef.current);
    shouldRestoreDetailScrollRef.current = true;
    setSelectedAlbum(album);
  }, []);
  const handleSelectStreamingAlbum = useCallback((album: StreamingAlbum): void => {
    detailScrollTopRef.current = readPageScrollTop(detailRootRef.current);
    shouldRestoreDetailScrollRef.current = true;
    setSelectedStreamingAlbum(album);
    setSelectedStreamingAlbumDetail(null);
    setStreamingAlbumDetailError(null);
  }, []);
  const handleStreamingAlbumKeyDown = useCallback((event: KeyboardEvent<HTMLElement>, album: StreamingAlbum): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelectStreamingAlbum(album);
    }
  }, [handleSelectStreamingAlbum]);
  const handlePlayStreamingTrack = useCallback(async (track: StreamingTrack): Promise<void> => {
    if (!track.playable || resolvingStreamingTrackKey === track.stableKey) {
      return;
    }

    setResolvingStreamingTrackKey(track.stableKey);
    setStreamingAlbumDetailError(null);
    try {
      await playTrack(streamingTrackToLibraryTrack(track), {
        source: { type: 'streaming', label: `${track.album} / ${track.provider}`, provider: track.provider },
        forceNewQueueItem: true,
      });
    } catch (error) {
      if (!isPlaybackCancellationError(error)) {
        setStreamingAlbumDetailError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setResolvingStreamingTrackKey((current) => (current === track.stableKey ? null : current));
    }
  }, [playTrack, resolvingStreamingTrackKey]);
  const handleQueueStreamingTrack = useCallback((track: StreamingTrack): void => {
    if (!track.playable) {
      setStreamingAlbumDetailError(track.unavailableReason ?? '这首流媒体歌曲暂时不可播放。');
      return;
    }

    appendToQueue(streamingTrackToLibraryTrack(track), { type: 'streaming', label: `${track.album} / ${track.provider}`, provider: track.provider });
    setQueuedStreamingTrackKey(track.stableKey);
    window.setTimeout(() => setQueuedStreamingTrackKey((current) => (current === track.stableKey ? null : current)), 1400);
  }, [appendToQueue]);
  const handlePlayStreamingAlbum = useCallback(async (): Promise<void> => {
    const detail = selectedStreamingAlbumDetail;
    const playableTracks = detail?.tracks.filter((track) => track.playable).map(streamingTrackToLibraryTrack) ?? [];
    const firstTrack = playableTracks[0];
    if (!detail || !firstTrack) {
      setStreamingAlbumDetailError('这张流媒体专辑暂时没有可播放的歌曲。');
      return;
    }

    try {
      setStreamingAlbumDetailError(null);
      await playTrack(firstTrack, {
        replaceQueueWith: playableTracks,
        source: { type: 'streaming', label: `${detail.title} / ${detail.provider}`, provider: detail.provider },
      });
    } catch (error) {
      if (!isPlaybackCancellationError(error)) {
        setStreamingAlbumDetailError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [playTrack, selectedStreamingAlbumDetail]);
  const handleDownloadStreamingAlbum = useCallback(async (): Promise<void> => {
    const detail = selectedStreamingAlbumDetail;
    if (!detail || streamingAlbumDownload) {
      return;
    }

    const downloads = window.echo?.downloads;
    const streaming = window.echo?.streaming;
    if (!downloads?.createUrlJob || !streaming?.resolvePlayback) {
      setStreamingAlbumDetailError('下载服务不可用：请在 ECHO Next 桌面端使用。');
      showChromeNotice('下载服务不可用：请在 ECHO Next 桌面端使用。');
      return;
    }

    const downloadableTracks = detail.tracks.filter((track) =>
      track.playable &&
      !unsupportedStreamingAlbumDownloadProviders.has(track.provider) &&
      Boolean(streamingTrackWebUrl(track)),
    );

    if (downloadableTracks.length === 0) {
      setStreamingAlbumDetailError('这张流媒体专辑没有可下载的歌曲。');
      showChromeNotice(`无法下载专辑：${detail.title}`);
      return;
    }

    const runId = streamingAlbumDownloadRunIdRef.current + 1;
    streamingAlbumDownloadRunIdRef.current = runId;
    lastStreamingAlbumDownloadNoticeRef.current = null;
    const albumSubdirectory = [detail.artist, detail.title].filter(Boolean).join(' - ') || detail.title;
    let queuedCount = 0;
    let failedToQueueCount = 0;

    setStreamingAlbumDetailError(null);
    setStreamingAlbumDownload({
      albumId: detail.id,
      title: detail.title,
      total: downloadableTracks.length,
      queued: 0,
      failedToQueue: 0,
      jobIds: [],
    });
    showChromeNotice(`准备下载专辑：${detail.title}（0/${downloadableTracks.length}）`);

    for (let index = 0; index < downloadableTracks.length; index += 1) {
      if (streamingAlbumDownloadRunIdRef.current !== runId) {
        return;
      }

      const track = downloadableTracks[index];
      const webpageUrl = streamingTrackWebUrl(track);
      if (!webpageUrl) {
        failedToQueueCount += 1;
        setStreamingAlbumDownload((current) =>
          current?.albumId === detail.id
            ? { ...current, failedToQueue: failedToQueueCount }
            : current,
        );
        continue;
      }

      showChromeNotice(`解析专辑：${detail.title}，${index + 1}/${downloadableTracks.length} · ${track.title}`);

      try {
        const source = await streaming.resolvePlayback({
          provider: track.provider,
          providerTrackId: track.providerTrackId,
          quality: readStreamingQualityPreference(),
        });
        const job = await downloads.createUrlJob(source.url, {
          title: track.title,
          artist: track.artist,
          album: track.album || detail.title,
          albumArtist: track.albumArtist ?? detail.artist ?? track.artist,
          coverUrl: track.coverUrl ?? track.coverThumb ?? detail.coverUrl ?? detail.coverThumb ?? null,
          webpageUrl,
          outputSubdirectory: albumSubdirectory,
          bindMvAfterImport: false,
          deferImportToLibrary: true,
          requestHeaders: source.headers,
          directAudio: true,
          directAudioMimeType: source.mimeType,
          directAudioExtension: source.codec,
          streamingProvider: track.provider,
          streamingProviderTrackId: track.providerTrackId,
          streamingStableKey: track.stableKey,
          downloadAuthorizationToken: source.downloadAuthorizationToken,
        });

        queuedCount += 1;
        setStreamingAlbumDownload((current) =>
          current?.albumId === detail.id
            ? {
                ...current,
                queued: queuedCount,
                jobIds: current.jobIds.includes(job.id) ? current.jobIds : [...current.jobIds, job.id],
              }
            : current,
        );
      } catch (error) {
        failedToQueueCount += 1;
        setStreamingAlbumDownload((current) =>
          current?.albumId === detail.id
            ? { ...current, failedToQueue: failedToQueueCount }
            : current,
        );
        setStreamingAlbumDetailError(error instanceof Error ? error.message : '添加专辑下载任务失败');
      }

      await sleep(streamingAlbumDownloadQueueYieldMs);
    }

    if (streamingAlbumDownloadRunIdRef.current !== runId) {
      return;
    }

    const finalNotice = failedToQueueCount > 0
      ? `专辑已加入下载队列：${detail.title}，成功 ${queuedCount}/${downloadableTracks.length}，失败 ${failedToQueueCount}`
      : `专辑已加入下载队列：${detail.title}（${queuedCount}/${downloadableTracks.length}）`;
    showChromeNotice(finalNotice);
    if (queuedCount === 0) {
      setStreamingAlbumDownload(null);
    }
  }, [selectedStreamingAlbumDetail, streamingAlbumDownload]);
  const handleExternalLinkClick = useCallback((event: MouseEvent<HTMLAnchorElement>, url: string): void => {
    const openExternalUrl = window.echo?.app?.openExternalUrl;
    if (!openExternalUrl) {
      return;
    }

    event.preventDefault();
    void openExternalUrl(url);
  }, []);
  const handleRefreshOnlineInfo = useCallback((): void => {
    setOnlineRefreshRequest((current) => current + 1);
  }, []);
  const handleStreamingAlbumCoverError = useCallback((album: StreamingAlbum, coverUrl: string): void => {
    setFailedStreamingAlbumCoverUrls((current) => ({ ...current, [streamingAlbumCoverFailureKey(album, coverUrl)]: true }));
  }, []);
  const handleLoadMoreStreamingAlbums = useCallback(async (): Promise<void> => {
    if (areStreamingAlbumsLoading || areMoreStreamingAlbumsLoading) {
      return;
    }

    const nextVisibleCount = streamingAlbumVisibleCount + streamingAlbumPageSize;
    const providerEntries = Object.entries(streamingAlbumProviderPages).filter(([, state]) => state.hasMore);
    if (streamingAlbums.length >= nextVisibleCount || providerEntries.length === 0) {
      setStreamingAlbumVisibleCount((current) => Math.min(current + streamingAlbumPageSize, streamingAlbums.length));
      return;
    }

    const streaming = window.echo?.streaming;
    if (!streaming?.search) {
      setStreamingAlbumsError('桌面桥接不可用。请在 ECHO Next 桌面版中搜索流媒体专辑。');
      return;
    }

    setAreMoreStreamingAlbumsLoading(true);
    setStreamingAlbumsError(null);

    try {
      const results = await Promise.allSettled(providerEntries.map(([provider, state]) =>
        streaming.search({
          provider: provider as StreamingProviderName,
          query: displayArtist.name,
          mediaTypes: ['album'],
          page: state.nextPage,
          pageSize: streamingAlbumPageSize,
        }),
      ));
      const albums = results
        .flatMap((result) => result.status === 'fulfilled' ? result.value.albums : [])
        .filter((album) => streamingAlbumMatchesArtist(album, displayArtist.name));

      setStreamingAlbums((current) => mergeUniqueStreamingAlbums(current, albums));
      setStreamingAlbumProviderPages((current) => {
        const next = { ...current };
        providerEntries.forEach(([provider, previous], index) => {
          const result = results[index];
          next[provider] = {
            nextPage: result?.status === 'fulfilled' ? result.value.page + 1 : previous.nextPage,
            hasMore: result?.status === 'fulfilled' ? result.value.hasMore : false,
          };
        });
        return next;
      });
      setStreamingAlbumVisibleCount((current) => current + streamingAlbumPageSize);
      if (results.every((result) => result.status === 'rejected')) {
        setStreamingAlbumsError('暂时无法读取更多流媒体专辑。');
      }
    } catch (error) {
      setStreamingAlbumsError(error instanceof Error ? error.message : String(error));
    } finally {
      setAreMoreStreamingAlbumsLoading(false);
    }
  }, [
    areMoreStreamingAlbumsLoading,
    areStreamingAlbumsLoading,
    displayArtist.name,
    streamingAlbumProviderPages,
    streamingAlbumVisibleCount,
    streamingAlbums.length,
  ]);
  const canPlay = loadedTracks.length > 0;
  const visibleStreamingAlbums = streamingAlbums.slice(0, streamingAlbumVisibleCount);
  const hasMoreStreamingAlbums =
    streamingAlbums.length > streamingAlbumVisibleCount ||
    Object.values(streamingAlbumProviderPages).some((state) => state.hasMore);
  const onlineInfo = artistInsights?.onlineInfo ?? null;
  const onlineBio = onlineInfo?.bio ?? null;
  const onlineSources = onlineInfo?.sourceLabels ?? [];
  const externalLinks = onlineInfo?.externalLinks ?? [];
  const concertInfo = artistInsights?.concerts ?? null;
  const concertEvents = concertInfo?.events ?? [];
  const concertCountLabel = concertEvents.length > 0 ? t('artistDetail.events.count', { count: concertEvents.length }) : null;
  const concertSourceLabel = concertInfo?.sources.length
    ? concertInfo.sources.map(concertSourceName).join(' / ')
    : configuredConcertSources.length
      ? configuredConcertSources.join(' / ')
      : t('artistDetail.events.providerKeysRequired');
  const concertEmptyMessage = configuredConcertSources.length
    ? (concertInfo?.status === 'unavailable' && concertInfo.message
      ? concertInfo.message
      : (configuredConcertRegion ? t('artistDetail.events.noConcertsRegion', { region: configuredConcertRegion }) : t('artistDetail.events.noConcerts')))
    : t('artistDetail.events.configureProviders');
  const overviewBioFallback = t('artistDetail.overview.bioFallback');
  const overviewBioBlocks = useMemo(
    () => (onlineBio ? overviewBioBlocksFor(onlineBio) : overviewBioFallbackBlocks(overviewBioFallback)),
    [onlineBio, overviewBioFallback],
  );
  const overviewFacts = [
    { label: t('artistDetail.fact.tracks'), value: t('artistDetail.meta.tracks', { count: displayedTrackCount }) },
    { label: t('artistDetail.fact.albums'), value: t('artistDetail.meta.albums', { count: displayArtist.albumCount }) },
    { label: t('artistDetail.fact.loaded'), value: loadedTracks.length > 0 ? formatDuration(loadedTracks, t) : t('artistDetail.status.readySoon') },
    { label: t('artistDetail.fact.sources'), value: onlineSources.length ? onlineSources.join(' / ') : t('artistDetail.status.localLibrary') },
  ];
  const aroundWebLinks = externalLinks
    .filter((link) => isAroundWebLink(link.label, link.url))
    .map((link) => ({ ...link, label: aroundWebLabel(link.label, link.url), host: aroundWebHost(link.url) }))
    .slice(0, 8);
  const visibleOverviewTrackCount = Math.min(overviewTrackVisibleCount, loadedTracks.length);
  const overviewPreviewTracks = loadedTracks.slice(0, visibleOverviewTrackCount);
  const hasMoreOverviewTracks = visibleOverviewTrackCount < loadedTracks.length;

  if (selectedStreamingAlbum) {
    const album = selectedStreamingAlbumDetail ?? selectedStreamingAlbum;
    const detailTracks = selectedStreamingAlbumDetail?.tracks ?? [];
    const visibleDetailTracks = detailTracks.slice(0, selectedStreamingAlbumTrackRenderLimit);
    const coverSrc = selectedStreamingAlbumDetail
      ? selectedStreamingAlbumDetail.coverUrl ?? selectedStreamingAlbumDetail.coverThumb ?? selectedStreamingAlbum.coverThumb ?? selectedStreamingAlbum.coverUrl ?? null
      : selectedStreamingAlbum.coverThumb ?? null;
    const downloadableDetailTrackCount = detailTracks.filter((track) =>
      track.playable &&
      !unsupportedStreamingAlbumDownloadProviders.has(track.provider) &&
      Boolean(streamingTrackWebUrl(track)),
    ).length;
    const isStreamingAlbumDownloadBusy = Boolean(streamingAlbumDownload && streamingAlbumDownload.albumId === album.id);

    return (
      <div className={`album-detail-page artist-streaming-album-detail ${isStreamingAlbumReturning ? 'is-returning' : ''}`} ref={detailRootRef}>
        <button className="album-back-button" type="button" onClick={returnBackFromStreamingAlbum}>
          <ArrowLeft size={17} />
          流媒体专辑
        </button>

        <section className="album-detail-hero" aria-label={`${album.title} 流媒体专辑详情`}>
          <div className="album-detail-cover" data-empty={!coverSrc}>
            {coverSrc ? <img alt="" decoding="async" draggable={false} height={320} src={coverSrc} width={320} /> : <Disc3 size={58} />}
          </div>

          <div className="album-detail-console">
            <div className="album-detail-copy">
              <span className="album-detail-kicker">流媒体专辑</span>
              <h1>{album.title}</h1>
              <p>{album.artist}</p>
              <div className="album-detail-meta" aria-label="流媒体专辑信息">
                {[album.provider, album.releaseDate, album.trackCount ? `${album.trackCount} 首歌` : null].filter(Boolean).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>

            <div className="album-detail-actions">
              <button className="album-primary-action" type="button" disabled={isStreamingAlbumDetailLoading || detailTracks.length === 0} onClick={() => void handlePlayStreamingAlbum()}>
                <Play size={16} fill="currentColor" />
                {isStreamingAlbumDetailLoading ? '读取中' : '播放整张'}
              </button>
            </div>

            {downloadsFeatureUnlocked ? (
              <div className="album-detail-actions">
                <button
                  className="album-secondary-action"
                  type="button"
                  disabled={isStreamingAlbumDetailLoading || downloadableDetailTrackCount === 0 || isStreamingAlbumDownloadBusy}
                  onClick={() => void handleDownloadStreamingAlbum()}
                >
                  {isStreamingAlbumDownloadBusy ? <RefreshCw className="spinning-icon" size={16} /> : <Download size={16} />}
                  {isStreamingAlbumDownloadBusy ? '下载中' : '下载专辑'}
                </button>
              </div>
            ) : null}

            {streamingAlbumDetailError ? <p className="album-detail-error">{streamingAlbumDetailError}</p> : null}
          </div>
        </section>

        <section className="album-detail-track-console" aria-label={`${album.title} 流媒体歌曲`}>
          <header className="album-detail-tabs" aria-label="流媒体专辑分区">
            <button className="album-detail-tab" type="button" aria-current="page">
              歌曲
            </button>
          </header>

          {isStreamingAlbumDetailLoading && detailTracks.length === 0 ? <div className="streaming-state">正在读取专辑...</div> : null}
          {!isStreamingAlbumDetailLoading && detailTracks.length === 0 && !streamingAlbumDetailError ? <div className="streaming-state">这张专辑没有可显示的歌曲。</div> : null}
          {detailTracks.length > 0 ? (
            <div className="streaming-album-track-list">
              {visibleDetailTracks.map((track) => {
                const isResolving = resolvingStreamingTrackKey === track.stableKey;
                const isQueued = queuedStreamingTrackKey === track.stableKey;
                const trackCover = track.coverThumb ?? track.coverUrl ?? coverSrc;

                return (
                  <article className="streaming-row" data-unavailable={!track.playable} key={track.stableKey} onDoubleClick={() => void handlePlayStreamingTrack(track)}>
                    <div className="streaming-cover" data-empty={!trackCover}>
                      {trackCover ? <img alt="" decoding="async" draggable={false} height={56} loading="lazy" src={trackCover} width={56} /> : <Disc3 size={18} />}
                    </div>
                    <div className="streaming-main">
                      <div className="streaming-title-line">
                        <strong>{track.title}</strong>
                      </div>
                      <span>{track.artist} / {track.album}</span>
                      <small>{track.playable ? `${track.provider} / ${track.qualities.join(' / ') || 'standard'}` : (track.unavailableReason ?? '暂时不可播放')}</small>
                    </div>
                    <span className="streaming-duration">{formatTrackDuration(track.duration ?? 0)}</span>
                    <div className="streaming-actions" onDoubleClick={(event) => event.stopPropagation()}>
                      <button type="button" title="播放" disabled={!track.playable || Boolean(resolvingStreamingTrackKey)} onClick={() => void handlePlayStreamingTrack(track)}>
                        {isResolving ? <RefreshCw className="spinning-icon" size={16} /> : <Play size={16} />}
                      </button>
                      <button type="button" title="加入队列" disabled={!track.playable} onClick={() => handleQueueStreamingTrack(track)}>
                        {isQueued ? <ListPlus size={16} /> : <ListPlus size={16} />}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  if (selectedAlbum) {
    return <AlbumDetailView album={selectedAlbum} onBack={() => setSelectedAlbum(null)} />;
  }

  if (!isVerifyingArtist && !verifiedArtist) {
    return (
      <div className={`artist-detail-page ${isReturning ? 'is-returning' : ''}`} ref={detailRootRef}>
        <button className="artist-detail-back" type="button" onClick={returnBack}>
          <ArrowLeft size={17} />
          {t('artistDetail.action.back')}
        </button>
        <section className="artist-detail-missing">
          <h1>{t('artistDetail.missing.title')}</h1>
          <p>{t('artistDetail.missing.description')}</p>
        </section>
      </div>
    );
  }

  return (
    <div className={`artist-detail-page ${isReturning ? 'is-returning' : ''}`} ref={detailRootRef}>
      <button className="artist-detail-back" type="button" onClick={returnBack}>
        <ArrowLeft size={17} />
        {t('artistDetail.action.back')}
      </button>

      <section className="artist-hero" data-has-backdrop={shouldShowHeroImage} aria-label={t('artistDetail.aria.details', { artist: displayArtist.name })}>
        {shouldShowHeroImage && heroImageUrl ? (
          <img
            className="artist-hero-backdrop"
            alt=""
            decoding="async"
            draggable={false}
            src={heroImageUrl}
            onError={() => setFailedHeroImageUrl(heroImageUrl)}
          />
        ) : null}
        {!shouldShowHeroImage ? (
          <div className="artist-hero-art" aria-hidden="true">
            <span>{artistMark(displayArtist.name)}</span>
          </div>
        ) : null}

        <div className="artist-hero-copy">
          <span className="artist-detail-kicker">{t('artistDetail.label.artist')}</span>
          <h1>{displayArtist.name}</h1>
          <div className="artist-hero-meta" aria-label={t('artistDetail.aria.metadata')}>
            <span>{t('artistDetail.meta.tracks', { count: displayedTrackCount })}</span>
            <span>{t('artistDetail.meta.albums', { count: displayArtist.albumCount })}</span>
            <span>{loadedTracks.length > 0 ? t('artistDetail.meta.loadedTracks', { loaded: loadedTracks.length, total: loadedTrackTotal }) : t('artistDetail.status.collectedLocally')}</span>
          </div>
          <div className="artist-hero-actions">
            <button className="artist-primary-action" type="button" disabled={!canPlay || areTracksLoading} onClick={() => void handlePlayArtist()}>
              <Play size={16} fill="currentColor" />
              {areTracksLoading && !canPlay ? t('artistDetail.action.readingArtist') : t('artistDetail.action.playArtist')}
            </button>
            <button className="artist-secondary-action" type="button" disabled={!canPlay} onClick={() => void handleShuffleArtist()}>
              <Shuffle size={16} />
              {t('artistDetail.action.shuffle')}
            </button>
            <button className="artist-secondary-action" type="button" disabled={!canPlay} onClick={handleQueueArtist}>
              <ListPlus size={16} />
              {t('artistDetail.action.addToQueue')}
            </button>
            <button className="artist-secondary-action" type="button" disabled={areInsightsLoading} onClick={handleRefreshOnlineInfo}>
              <RefreshCw className={areInsightsLoading ? 'spinning-icon' : undefined} size={16} />
              {t('artistDetail.action.refreshInfo')}
            </button>
          </div>

          {onlineSources.length || externalLinks.length ? (
            <div className="artist-online-strip" aria-label={t('artistDetail.aria.onlineSources')}>
              {onlineSources.map((sourceLabel) => (
                <span key={sourceLabel}>{sourceLabel}</span>
              ))}
              {externalLinks.slice(0, 3).map((link) => (
                <a href={link.url} key={link.url} rel="noreferrer" target="_blank" onClick={(event) => handleExternalLinkClick(event, link.url)}>
                  <ExternalLink size={13} />
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}

          {playError || verifyError ? <p className="artist-detail-error">{playError ?? verifyError}</p> : null}
        </div>
      </section>

      <nav className="artist-detail-tabs" aria-label={t('artistDetail.aria.sections', { artist: displayArtist.name })}>
        <button aria-current={activeTab === 'overview' ? 'page' : undefined} type="button" onClick={() => handleSelectTab('overview')}>
          {t('artistDetail.tab.overview')}
        </button>
        <button aria-current={activeTab === 'albums' ? 'page' : undefined} type="button" onClick={() => handleSelectTab('albums')}>
          {t('artistDetail.tab.albums')}
        </button>
      </nav>

      {activeTab === 'overview' ? (
        <div className="artist-tab-panel artist-overview-panel">
          <section className="artist-overview-grid" id="artist-overview" aria-label={t('artistDetail.aria.overview')}>
            <article className="artist-overview-copy">
              <span>{t('artistDetail.label.overview')}</span>
              <h2>{t('artistDetail.overview.about', { artist: displayArtist.name })}</h2>
              {overviewBioBlocks.map((block) =>
                block.type === 'heading' ? (
                  <h3 className="artist-overview-bio-heading" data-level={block.level} key={block.key}>
                    {block.text}
                  </h3>
                ) : (
                  <p key={block.key}>
                    {block.segments.map((segment, index) =>
                      segment.type === 'link' ? (
                        <a href={segment.url} key={`${segment.url}-${index}`} rel="noreferrer" target="_blank" onClick={(event) => handleExternalLinkClick(event, segment.url)}>
                          {segment.text}
                        </a>
                      ) : segment.text,
                    )}
                  </p>
                ),
              )}
            </article>
            <aside className="artist-overview-sidebar" aria-label={t('artistDetail.aria.facts')}>
              <div className="artist-sidebar-facts">
                {overviewFacts.map((fact) => (
                  <div key={fact.label}>
                    <span>{fact.label}</span>
                    <strong>{fact.value}</strong>
                  </div>
                ))}
              </div>
              {aroundWebLinks.length > 0 ? (
                <section className="artist-around-web" aria-label={t('artistDetail.aroundWeb.aria')}>
                  <span>{t('artistDetail.aroundWeb.heading')}</span>
                  <div>
                    {aroundWebLinks.map((link) => (
                      <a href={link.url} key={link.url} rel="noreferrer" target="_blank" title={`${link.label} / ${link.host}`} onClick={(event) => handleExternalLinkClick(event, link.url)}>
                        <ExternalLink size={14} />
                        {link.label}
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}
            </aside>
          </section>

          <section className="artist-section artist-overview-tracks" aria-label={t('artistDetail.tracks.aria', { artist: displayArtist.name })}>
            <header>
              <div>
                <span>{t('artistDetail.status.localLibrary')}</span>
                <h2>{t('artistDetail.tracks.heading', { artist: displayArtist.name })}</h2>
              </div>
              <small>
                {loadedTracks.length > 0
                  ? t('artistDetail.tracks.loadedCount', { loaded: visibleOverviewTrackCount, total: loadedTrackTotal })
                  : t('artistDetail.tracks.loading')}
              </small>
            </header>
            {overviewPreviewTracks.length > 0 ? (
              <>
                <div className="artist-overview-track-grid">
                  {overviewPreviewTracks.map((track) => {
                    const shouldShowCover = Boolean(track.coverThumb);

                    return (
                      <article className="artist-overview-track-card" key={track.id}>
                        <span className="artist-overview-track-cover" data-empty={!shouldShowCover} aria-hidden="true">
                          {shouldShowCover ? <img alt="" decoding="async" draggable={false} loading="lazy" src={track.coverThumb!} /> : <Disc3 size={20} />}
                        </span>
                        <span className="artist-overview-track-copy">
                          <strong>{track.title}</strong>
                          <small>{track.album || t('artistDetail.tracks.unknownAlbum')}</small>
                        </span>
                        <time>{formatTrackDuration(track.duration)}</time>
                        <button type="button" aria-label={t('queue.action.play', { title: track.title })} onClick={() => void handlePlayPreviewTrack(track)}>
                          <Play size={14} fill="currentColor" />
                        </button>
                      </article>
                    );
                  })}
                </div>
                {hasMoreOverviewTracks ? (
                  <div className="artist-overview-track-actions">
                    <button className="artist-load-more artist-overview-track-load-more" type="button" onClick={handleLoadMoreOverviewTracks}>
                      {t('albumDetail.tracks.loadMore')}
                    </button>
                    <button className="artist-load-more artist-overview-track-expand-all" type="button" onClick={handleExpandAllOverviewTracks}>
                      {t('artistDetail.tracks.expandAll')}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="artist-detail-empty">{areTracksLoading ? t('artistDetail.tracks.loading') : t('artistDetail.tracks.empty')}</p>
            )}
          </section>

          <section className="artist-section artist-events-section" aria-label={t('artistDetail.aria.events')}>
            <header>
              <div>
                <span>{t('artistDetail.section.events')}</span>
                <h2>{t('artistDetail.section.concertInfo')}</h2>
              </div>
              <div className="artist-events-header-actions">
                <small>{concertCountLabel ? `${concertCountLabel} / ${concertSourceLabel}` : concertSourceLabel}</small>
                {concertEvents.length > 0 ? (
                  <button
                    className="artist-events-toggle"
                    type="button"
                    aria-expanded={areConcertsExpanded}
                    onClick={() => setAreConcertsExpanded((current) => !current)}
                  >
                    <ChevronDown size={15} />
                    {areConcertsExpanded ? t('artistDetail.events.collapse') : t('artistDetail.events.expand')}
                  </button>
                ) : null}
              </div>
            </header>
            {concertEvents.length > 0 && !areConcertsExpanded ? (
              <p className="artist-detail-empty artist-events-collapsed">
                {t('artistDetail.events.collapsedHint', { count: concertEvents.length })}
              </p>
            ) : null}
            {concertEvents.length > 0 && areConcertsExpanded ? (
              <div className="artist-event-list">
                {concertEvents.map((event) => {
                  const dateParts = formatEventDateParts(event.startsAt);
                  const timeLabel = formatEventTime(event.startsAt, event.timeTbd);
                  const sourceLabel = event.sourceLabel ?? event.source;
                  const eventUrl = event.ticketUrl ?? event.url ?? null;

                  return (
                    <a
                      className="artist-event-row"
                      href={eventUrl ?? undefined}
                      key={event.id}
                      rel="noreferrer"
                      target="_blank"
                      title={`${dateParts.label} / ${eventSecondaryInfo(event)} / ${sourceLabel}`}
                      onClick={eventUrl ? (clickEvent) => handleExternalLinkClick(clickEvent, eventUrl) : undefined}
                    >
                      <span className="artist-event-date">
                        <time dateTime={event.startsAt} aria-label={dateParts.label}>
                          {dateParts.month ? <span className="artist-event-month">{dateParts.month}</span> : null}
                          <strong className="artist-event-day">{dateParts.day}</strong>
                        </time>
                      </span>
                      <span className="artist-event-info">
                        <strong className="artist-event-primary">{eventPrimaryLocation(event, t)}</strong>
                        <span className="artist-event-secondary">{eventSecondaryInfo(event) || sourceLabel}</span>
                      </span>
                      <span className="artist-event-time" aria-label={sourceLabel}>
                        {timeLabel ?? sourceLabel}
                      </span>
                    </a>
                  );
                })}
              </div>
            ) : null}
            {concertEvents.length === 0 ? (
              <p className="artist-detail-empty">
                {concertEmptyMessage}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === 'albums' ? (
        <section className="artist-tab-panel artist-albums-view" id="artist-albums" aria-label={t('artistDetail.albums.aria', { artist: displayArtist.name })}>
          <header className="artist-albums-view-header">
            <div>
              <span>{t('artistDetail.tab.albums')}</span>
              <h2>{t('artistDetail.albums.heading', { artist: displayArtist.name })}</h2>
            </div>
            <strong>{t('artistDetail.meta.albums', { count: displayArtist.albumCount })}</strong>
          </header>
          <ArtistAlbumGrid artistId={displayArtist.id} artistName={displayArtist.name} albumCount={displayArtist.albumCount} onAlbumSelect={handleSelectAlbum} />
          {streamingAlbumsEnabled ? (
            <section className="artist-streaming-albums" aria-label={`${displayArtist.name} 流媒体专辑`}>
              <header>
                <div>
                  <span>流媒体</span>
                  <h2>流媒体专辑</h2>
                </div>
                <small>{areStreamingAlbumsLoading ? '搜索中...' : `${streamingAlbums.length} 张专辑`}</small>
              </header>
              {streamingAlbums.length > 0 ? (
                <div className="artist-album-strip artist-streaming-album-strip">
                  {visibleStreamingAlbums.map((album) => {
                    const coverUrl = album.coverUrl && !failedStreamingAlbumCoverUrls[streamingAlbumCoverFailureKey(album, album.coverUrl)]
                      ? album.coverUrl
                      : album.coverThumb && !failedStreamingAlbumCoverUrls[streamingAlbumCoverFailureKey(album, album.coverThumb)]
                        ? album.coverThumb
                        : null;
                    const shouldShowCover = Boolean(coverUrl);

                    return (
                      <article
                        className="artist-album-card artist-streaming-album-card"
                        key={album.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectStreamingAlbum(album)}
                        onKeyDown={(event) => handleStreamingAlbumKeyDown(event, album)}
                      >
                        <div className="artist-album-cover" data-empty={!shouldShowCover} aria-hidden="true">
                          {shouldShowCover ? (
                            <img
                              alt=""
                              decoding="async"
                              draggable={false}
                              height={320}
                              loading="lazy"
                              src={coverUrl!}
                              width={320}
                              onError={() => handleStreamingAlbumCoverError(album, coverUrl!)}
                            />
                          ) : (
                            <Disc3 size={24} />
                          )}
                        </div>
                        <div className="artist-album-copy">
                          <strong>{album.title}</strong>
                          <span>{streamingAlbumMeta(album)}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}
              {hasMoreStreamingAlbums ? (
                <button
                  className="artist-load-more"
                  type="button"
                  disabled={areMoreStreamingAlbumsLoading}
                  onClick={() => void handleLoadMoreStreamingAlbums()}
                >
                  {areMoreStreamingAlbumsLoading ? '加载中...' : '加载更多'}
                </button>
              ) : null}
              {!areStreamingAlbumsLoading && streamingAlbums.length === 0 && !streamingAlbumsError ? (
                <p className="artist-detail-empty">暂未找到匹配的流媒体专辑。</p>
              ) : null}
              {streamingAlbumsError ? <p className="artist-detail-error">{streamingAlbumsError}</p> : null}
            </section>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};
