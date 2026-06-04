import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AudioStatus } from '../../shared/types/audio';
import type { AppSettings } from '../../shared/types/appSettings';
import {
  Album,
  ChevronLeft,
  ChevronRight,
  Folder,
  History,
  Library,
  ListMusic,
  Music2,
  Play,
  Radio,
  RefreshCw,
  Shuffle,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  LibraryAlbum,
  LibrarySummary,
  LibraryTrack,
  PlaybackHistoryEntry,
  PlaybackHistoryQuery,
  PlaybackHistorySummary,
  PlaybackStatsAlbum,
  PlaybackStatsDashboard,
  PlaybackStatsDay,
} from '../../shared/types/library';
import { translateCurrentLocale, useI18n } from '../i18n/I18nProvider';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { openAlbumDetail, openAlbumDetailForTrack, resolveAlbumDetailNavigationTarget } from '../utils/albumNavigation';
import { openArtistDetailByName } from '../utils/artistNavigation';
import type { AppRouteId } from '../app/routes';

const recentPageSize = 8;
const recentPlayedAlbumHistoryPageSize = 12;
const randomQueuePageSize = 36;
const recentShelfPageSize = 4;
const recommendedAlbumPageSize = 7;
const artistLeaderboardLimit = 5;
const favoriteAlbumLimit = 4;
const homeNowTitleMarqueeMinChars = 34;
const homeNowTitleMarqueeOverflowPx = 12;
const homeNowMetaMarqueeOverflowPx = 8;
const weeklyHeatmapWeeks = 12;
const signalBarCount = 48;
const playbackHistoryChangedEvent = 'playback-history:changed';
const visualActiveStates = new Set<AudioStatus['state']>(['loading', 'playing']);
const signalVisualAttackMs = 58;
const signalVisualReleaseMs = 190;
const signalVisualMotionAttackMs = 82;
const signalVisualMotionReleaseMs = 220;
const signalVisualOpacityMs = 130;
export const defaultHomeHeroTitle = '从你的音乐库开始播放。';
export const homeHeroTitleOptions = [
  '从这里开始听。',
  '今天先听哪张专辑？',
  'Wish You Were Here',
  '挑一首，马上开播。',
  '把音乐库交给随机。',
  '数字信号0101没区别',
  '#define int long long',
  '不会还有人没开随机吧？',
  '这首歌 O(1) 好听。',
  'ECCCCCCCCCCCCCCHO',
  '#include <bits/stdc++.h>',
  '缓存命中：快乐。',
  '当前播放:DSD1024超高清母带原声大碟..',
  '今天的电不好听!',
  'Buy Accuphase DP750',
  '这段低频简直像线段树一样稳!',
  'NOI 退役选手正在重建歌单。',
  'DSD 在跑，风扇在打拍子。',
  '这首歌结项非常准!',
  '随机播放，但复杂度看心情。',
  '解码热机中...',
  '这首歌的动态范围没有被卡常。',
  '别二分了，喜欢就点播放。',
  '高频不刺，像样例一样友好。',
  '歌单已过样例，准备上强测。',
  'WASAPI 独占中，别的声音先排队。',
  'ASIO 缓冲拉满，延迟先自闭。',
  '今天的 jitter 有点押韵。',
  '比特完美，情绪不完美。',
  '升频到 768k，快乐也插值。',
  '这首歌的瞬态像快排一样看脸。',
  'SRC 已关闭，玄学已开启。',
  '左右声道平衡，人生暂时不平衡。',
  '正在寻找 0.1dB 的宇宙真理。',
  '底噪很黑，钱包很空。',
  'Roon 没开，但仪式感开了。',
  '这段齿音需要一点温柔滤波。',
  'Task failed successfully: 播放成功。',
  'It just works, until WASAPI says no.',
  'Can it run Crysis? 先跑这首 24/192。',
  '404 Bass Not Found.',
  'No thoughts, just PCM.',
  'Let him cook: DAC 正在热身。',
  'This is fine, buffer underrun edition.',
  'One does not simply skip this track.',
  'POV: 你听出了电源线方向。',
  'Sir, this is a music library.',
  'Bro thinks he can hear 0.01dB.',
  'You had one job: bit-perfect.',
  'Directed by Robert B. Weide, but with reverb.',
  'Mom said it is my turn on the aux.',
  'I understood that reference, in 32-bit float.',
  'Keep calm and normalize nothing.',
  '192.168.1.1',
  '223.42.34.22',
  '已对 192.168.1.1 地址进行攻击。',
  '已对 223.42.34.22 地址进行攻击。',
  '正在对 192.168.1.1 进行无损握手。',
  '223.42.34.22 已加入今日歌单战场。',
  '你好，Windows 用户。今天也要 bit-perfect。',
  'Windows 用户已进入听歌房间。',
  '正在给 Windows 用户推送今日低频。',
  '今天加训了吗',
  '让收藏开始发声。',
  '专辑封面已经排好队。',
] as const;

const homeHeroIpFallbackOptions = ['192.168.1.1', '223.42.34.22'] as const;
const homeHeroIpTitlePattern = /(?:已对|正在对) (?:192\.168\.1\.1|223\.42\.34\.22) /u;
const homeHeroUserTitlePattern = /Windows 用户/u;
const ipv4Pattern = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/u;

const isUsableHeroIPv4 = (address: string): boolean =>
  !address.startsWith('0.') &&
  !address.startsWith('127.') &&
  !address.startsWith('169.254.') &&
  address !== '255.255.255.255';

const detectBrowserIPv4Address = async (): Promise<string | null> => {
  if (typeof RTCPeerConnection === 'undefined') {
    return null;
  }

  const connection = new RTCPeerConnection({ iceServers: [] });
  try {
    connection.createDataChannel('echo-home-ip');
    const candidates = new Set<string>();
    const waitForCandidate = new Promise<string | null>((resolve) => {
      const timeoutId = window.setTimeout(() => resolve(null), 900);
      connection.onicecandidate = (event) => {
        const candidate = event.candidate?.candidate ?? '';
        const match = candidate.match(ipv4Pattern);
        if (!match || !isUsableHeroIPv4(match[0])) {
          return;
        }
        candidates.add(match[0]);
        window.clearTimeout(timeoutId);
        resolve(match[0]);
      };
    });

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    return (await waitForCandidate) ?? candidates.values().next().value ?? null;
  } catch {
    return null;
  } finally {
    connection.close();
  }
};

const sanitizeHomeHeroUserName = (value: string | null | undefined): string | null => {
  const name = value?.replace(/[\r\n]/g, '').trim();
  if (!name) {
    return null;
  }
  return name.length > 28 ? `${name.slice(0, 28)}...` : name;
};

const personalizeHomeHeroTitle = async (title: string): Promise<string> => {
  const systemUserName = window.echo?.app?.getSystemUserName;
  const [ipAddress, userName] = await Promise.all([
    homeHeroIpTitlePattern.test(title) ? detectBrowserIPv4Address() : Promise.resolve(null),
    homeHeroUserTitlePattern.test(title) && systemUserName ? systemUserName().then(sanitizeHomeHeroUserName).catch(() => null) : Promise.resolve(null),
  ]);

  let nextTitle = title;
  if (ipAddress) {
    nextTitle = nextTitle.replace(homeHeroIpFallbackOptions[0], ipAddress).replace(homeHeroIpFallbackOptions[1], ipAddress);
  }
  if (userName) {
    nextTitle = nextTitle.replace(/Windows 用户/gu, userName);
  }
  return nextTitle;
};

type HomeRouteId = Extract<AppRouteId, 'albums' | 'artists' | 'folders' | 'history' | 'inbox' | 'liked' | 'playlists' | 'queue' | 'songs'>;
type RecentPanelMode = 'added' | 'played';
type SignalBarModel = {
  delay: string;
  duration: string;
  fallScale: string;
  height: string;
  maxScale: string;
  midScale: string;
  minScale: string;
  motion: string;
  opacity: string;
  targetHeight: number;
  targetMotion: number;
  targetOpacity: number;
  targetScale: number;
};
type MetricTileProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  routeId: HomeRouteId;
};
type HomePageData = {
  recentAddedAlbums: LibraryAlbum[];
  recommendedAlbums: LibraryAlbum[];
  summary: LibrarySummary;
  recentTracks: LibraryTrack[];
  recentHistory: PlaybackHistoryEntry[];
  recentPlayedAlbums: RecentPlayedAlbum[];
  historySummary: PlaybackHistorySummary | null;
  stats: PlaybackStatsDashboard | null;
};
type RecentPlayedAlbum = {
  album: LibraryAlbum;
  startedAt: string | null;
};

const HomeNowTitle = ({ title }: { title: string }): JSX.Element => {
  const titleRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const canScroll = title.trim().length >= homeNowTitleMarqueeMinChars;

  useEffect(() => {
    const element = titleRef.current;
    const innerElement = innerRef.current;
    if (!element || !innerElement || !canScroll) {
      setShouldScroll(false);
      return undefined;
    }

    let frameId: number | null = null;
    const updateOverflow = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const distance = Math.max(0, innerElement.scrollWidth - element.clientWidth);
        const nextShouldScroll = distance > homeNowTitleMarqueeOverflowPx;
        element.style.setProperty('--home-now-title-marquee-distance', `${distance + 26}px`);
        element.style.setProperty('--home-now-title-marquee-duration', `${Math.min(24, Math.max(10, distance / 18 + 8))}s`);
        setShouldScroll(nextShouldScroll);
      });
    };

    updateOverflow();

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(updateOverflow) : null;
    resizeObserver?.observe(element);
    resizeObserver?.observe(innerElement);
    window.addEventListener('resize', updateOverflow);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateOverflow);
    };
  }, [canScroll, title]);

  return (
    <strong className="home-now-title" data-scroll={shouldScroll ? 'true' : undefined} ref={titleRef} title={title}>
      <span ref={innerRef}>{title}</span>
    </strong>
  );
};

const HomeNowMeta = ({
  onOpenAlbum,
  onOpenArtist,
  track,
}: {
  onOpenAlbum: (track: LibraryTrack) => void;
  onOpenArtist: (artistName: string) => void;
  track: LibraryTrack | null;
}): JSX.Element => {
  const { t } = useI18n();
  const metaRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    const element = metaRef.current;
    const innerElement = innerRef.current;
    if (!element || !innerElement || !track) {
      setShouldScroll(false);
      return undefined;
    }

    let frameId: number | null = null;
    const updateOverflow = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const distance = Math.max(0, innerElement.scrollWidth - element.clientWidth);
        const nextShouldScroll = distance > homeNowMetaMarqueeOverflowPx;
        element.style.setProperty('--home-now-meta-marquee-distance', `${distance + 22}px`);
        element.style.setProperty('--home-now-meta-marquee-duration', `${Math.min(22, Math.max(10, distance / 20 + 8))}s`);
        setShouldScroll(nextShouldScroll);
      });
    };

    updateOverflow();

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(updateOverflow) : null;
    resizeObserver?.observe(element);
    resizeObserver?.observe(innerElement);
    window.addEventListener('resize', updateOverflow);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateOverflow);
    };
  }, [track]);

  if (!track) {
    return <small className="home-now-meta">{t('home.nowMeta.empty')}</small>;
  }

  const artistName = track.artist?.trim();
  const albumTitle = track.album?.trim();

  return (
    <small className="home-now-meta" data-scroll={shouldScroll ? 'true' : undefined} ref={metaRef}>
      <span className="home-now-meta-inner" ref={innerRef}>
        {artistName ? (
          <button className="home-now-link" type="button" onClick={() => onOpenArtist(artistName)}>
            {artistName}
          </button>
        ) : (
          <span>{t('queue.unknownArtist')}</span>
        )}
        <span aria-hidden="true"> · </span>
        {albumTitle ? (
          <button className="home-now-link" type="button" onClick={() => onOpenAlbum(track)}>
            {albumTitle}
          </button>
        ) : (
          <span>{t('queue.unknownAlbum')}</span>
        )}
      </span>
    </small>
  );
};

const emptySummary: LibrarySummary = {
  songCount: 0,
  albumCount: 0,
  artistCount: 0,
  folderCount: 0,
  totalDuration: 0,
  lastScanAt: null,
};
const emptyHomePageData: HomePageData = {
  recentAddedAlbums: [],
  recommendedAlbums: [],
  summary: emptySummary,
  recentTracks: [],
  recentHistory: [],
  recentPlayedAlbums: [],
  historySummary: null,
  stats: null,
};
const homePageCacheStorageKey = 'echo-next.home-page-cache.v1';
const homePageCacheVersion = 1;
const isHomePageTestRuntime = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
const homeInitialPlaybackPulseDelayMs = isHomePageTestRuntime ? 0 : 2600;
const homePlaybackHistoryRefreshDelayMs = isHomePageTestRuntime ? 0 : 900;

type StoredHomePageCache = {
  data: HomePageData;
  savedAt: string;
  version: typeof homePageCacheVersion;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const historyText = (value: string | null | undefined, fallback: string): string => {
  const text = value?.trim();
  return text && text.length > 0 ? text : fallback;
};

const recentPlayedAlbumsFromHistory = (entries: PlaybackHistoryEntry[]): RecentPlayedAlbum[] => {
  const seenAlbumKeys = new Set<string>();
  const albums: RecentPlayedAlbum[] = [];

  for (const entry of entries) {
    const title = historyText(entry.album, historyText(entry.title, translateCurrentLocale('queue.unknownAlbum')));
    const albumArtist = historyText(entry.albumArtist, historyText(entry.artist, translateCurrentLocale('queue.unknownArtist')));
    const albumKey = `${entry.mediaType}:${albumArtist.toLowerCase()}:${title.toLowerCase()}`;

    if (seenAlbumKeys.has(albumKey)) {
      continue;
    }

    seenAlbumKeys.add(albumKey);
    albums.push({
      album: {
        id: `history:${albumKey}`,
        mediaType: entry.mediaType === 'remote' ? 'remote' : 'local',
        albumKey,
        title,
        albumArtist,
        year: null,
        trackCount: 1,
        duration: entry.durationSnapshot ?? entry.durationSeconds ?? 0,
        coverId: entry.coverId,
        coverThumb: entry.coverThumb ?? entry.coverSnapshot,
      },
      startedAt: entry.startedAt,
    });
  }

  return albums.slice(0, recentPlayedAlbumHistoryPageSize);
};

const normalizeStoredHomePageData = (value: unknown): HomePageData | null => {
  if (!isRecord(value)) {
    return null;
  }

  const recentHistory = Array.isArray(value.recentHistory) ? (value.recentHistory as PlaybackHistoryEntry[]) : [];
  const storedRecentPlayedAlbums = Array.isArray(value.recentPlayedAlbums) ? (value.recentPlayedAlbums as RecentPlayedAlbum[]) : [];

  return {
    recentAddedAlbums: Array.isArray(value.recentAddedAlbums) ? (value.recentAddedAlbums as LibraryAlbum[]) : [],
    recommendedAlbums: Array.isArray(value.recommendedAlbums) ? (value.recommendedAlbums as LibraryAlbum[]) : [],
    summary: isRecord(value.summary) ? ({ ...emptySummary, ...value.summary } as LibrarySummary) : emptySummary,
    recentTracks: Array.isArray(value.recentTracks) ? (value.recentTracks as LibraryTrack[]) : [],
    recentHistory,
    recentPlayedAlbums: storedRecentPlayedAlbums.length > 0 ? storedRecentPlayedAlbums : recentPlayedAlbumsFromHistory(recentHistory),
    historySummary: isRecord(value.historySummary) ? (value.historySummary as PlaybackHistorySummary) : null,
    stats: isRecord(value.stats) ? (value.stats as PlaybackStatsDashboard) : null,
  };
};

const readStoredHomePageData = (): HomePageData | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(homePageCacheStorageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredHomePageCache>;
    if (parsed.version !== homePageCacheVersion) {
      return null;
    }

    return normalizeStoredHomePageData(parsed.data);
  } catch {
    return null;
  }
};

const writeStoredHomePageData = (data: HomePageData): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      homePageCacheStorageKey,
      JSON.stringify({
        data,
        savedAt: new Date().toISOString(),
        version: homePageCacheVersion,
      } satisfies StoredHomePageCache),
    );
  } catch {
    // Startup cache is best-effort only; never let storage pressure affect playback or navigation.
  }
};

const setCachedHomePageData = (data: HomePageData): HomePageData => {
  cachedHomePageData = data;
  writeStoredHomePageData(data);
  return data;
};

const mergeCachedHomePageData = (patch: Partial<HomePageData>): HomePageData =>
  setCachedHomePageData({
    ...(cachedHomePageData ?? emptyHomePageData),
    ...patch,
  });

const hasCachedPlaybackPulseData = (data: HomePageData | null): boolean =>
  Boolean(data && (data.historySummary || data.stats || data.recentHistory.length > 0 || data.recentPlayedAlbums.length > 0));

const hasCachedLibraryPulseData = (data: HomePageData | null): boolean =>
  Boolean(data && (
    data.summary.songCount > 0 ||
    data.summary.albumCount > 0 ||
    data.summary.artistCount > 0 ||
    data.recentTracks.length > 0 ||
    data.recentAddedAlbums.length > 0 ||
    data.recommendedAlbums.length > 0
  ));

let cachedHomePageData: HomePageData | null = readStoredHomePageData();
let cachedRecentPanelMode: RecentPanelMode = 'added';
let cachedHomeWaveformVisualizerEnabled: boolean | null = null;
let cachedHomeWaveformVisualizerSettings = {
  homeWaveformVisualizerEnabled: true,
  audioVisualSpectrumEnabled: false,
  lowLoadPlaybackModeEnabled: false,
};
let cachedHomeRandomHeroTitleEnabled: boolean | null = null;
let cachedHomeHeroTitle: string | null = null;

const pickHomeHeroTitle = (): string => {
  const index = Math.min(homeHeroTitleOptions.length - 1, Math.floor(Math.random() * homeHeroTitleOptions.length));
  return homeHeroTitleOptions[index];
};

export const resetHomePageCacheForTest = (): void => {
  cachedHomePageData = null;
  cachedRecentPanelMode = 'added';
  cachedHomeWaveformVisualizerEnabled = null;
  cachedHomeWaveformVisualizerSettings = {
    homeWaveformVisualizerEnabled: true,
    audioVisualSpectrumEnabled: false,
    lowLoadPlaybackModeEnabled: false,
  };
  cachedHomeRandomHeroTitleEnabled = null;
  cachedHomeHeroTitle = null;
  try {
    window.localStorage.removeItem(homePageCacheStorageKey);
  } catch {
    // Ignore unavailable storage in non-browser test environments.
  }
};

const formatCompactNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 1000 ? 1 : 0, notation: value >= 10000 ? 'compact' : 'standard' }).format(value);
};

const formatDuration = (seconds: number, t: ReturnType<typeof useI18n>['t']): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return t('home.duration.zeroMinutes');
  }

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return t('home.duration.minutes', { count: totalMinutes });
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? t('home.duration.hoursMinutes', { hours, minutes }) : t('home.duration.hoursOnly', { hours });
};

const formatShortDate = (value: string | null, t: ReturnType<typeof useI18n>['t'], locale: string): string => {
  if (!value) {
    return t('home.date.none');
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t('home.date.unknown');
  }

  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
};

const ArtistLeaderboard = ({
  artists,
  onOpenArtist,
}: {
  artists: PlaybackStatsDashboard['topArtists'];
  onOpenArtist: (artistName: string) => void;
}): JSX.Element => {
  const { t } = useI18n();
  const visibleArtists = artists
    .filter((artist) => artist.artist.trim().length > 0)
    .slice(0, artistLeaderboardLimit);
  const maxPlayCount = Math.max(...visibleArtists.map((artist) => artist.playCount), 1);

  if (visibleArtists.length === 0) {
    return (
      <div className="home-artist-rank-empty" role="status">
        <UserRound size={18} />
        <span>
          <strong>{t('home.artistLeaderboard.emptyTitle')}</strong>
          <small>{t('home.artistLeaderboard.emptyDescription')}</small>
        </span>
      </div>
    );
  }

  return (
    <ol className="home-artist-leaderboard" aria-label={t('home.artistLeaderboard.aria')}>
      {visibleArtists.map((artist, index) => {
        const artistName = artist.artist.trim();
        const score = Math.max(0.08, artist.playCount / maxPlayCount);
        const completionRate = artist.playCount > 0 ? Math.round((artist.completedCount / artist.playCount) * 100) : 0;

        return (
          <li className="home-artist-rank-item" key={`${artistName}-${index}`}>
            <button
              className="home-artist-rank-row"
              data-rank-lead={index === 0 ? 'true' : undefined}
              style={{ '--home-artist-score': score } as CSSProperties}
              type="button"
              onClick={() => onOpenArtist(artistName)}
            >
              <span className="home-artist-rank-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="home-artist-rank-main">
                <strong>{artistName}</strong>
                <span className="home-artist-rank-meta">
                  <span>{t('home.artistLeaderboard.playCount', { count: formatCompactNumber(artist.playCount) })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDuration(artist.playedSeconds, t)}</span>
                </span>
              </span>
              <span className="home-artist-rank-chip">{t('home.artistLeaderboard.completionRate', { rate: completionRate })}</span>
              <span className="home-artist-rank-meter" aria-hidden="true">
                <i />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};

const statsAlbumToLibraryAlbum = (album: PlaybackStatsAlbum): LibraryAlbum | null => {
  if (!album.albumId) {
    return null;
  }

  return {
    id: album.albumId,
    mediaType: album.mediaType === 'remote' ? 'remote' : 'local',
    albumKey: album.albumKey ?? album.albumId,
    title: album.title,
    albumArtist: album.albumArtist,
    year: album.year,
    trackCount: album.trackCount,
    duration: album.duration,
    coverId: album.coverId,
    coverThumb: album.coverThumb,
  };
};

const normalizeFavoriteAlbumText = (value: string | null | undefined): string =>
  (value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const isFavoriteAlbumCandidate = (candidate: LibraryAlbum, album: PlaybackStatsAlbum): boolean => {
  const sameTitle = normalizeFavoriteAlbumText(candidate.title) === normalizeFavoriteAlbumText(album.title);
  const sameArtist = normalizeFavoriteAlbumText(candidate.albumArtist) === normalizeFavoriteAlbumText(album.albumArtist);
  const sameYear = candidate.year === album.year || !candidate.year || !album.year;

  return sameTitle && sameArtist && sameYear;
};

const findFavoriteLibraryAlbum = async (album: PlaybackStatsAlbum): Promise<LibraryAlbum | null> => {
  const library = window.echo?.library;

  if (!library?.getAlbums) {
    throw new Error('Desktop library bridge unavailable. Open ECHO Next in Electron to locate this album.');
  }

  const search = album.title.trim() || album.albumArtist.trim();
  if (!search) {
    return null;
  }

  const result = await library.getAlbums({ page: 1, pageSize: 50, search });
  return result.items.find((candidate) => isFavoriteAlbumCandidate(candidate, album)) ?? null;
};

const favoriteStatsAlbumWithTarget = (album: PlaybackStatsAlbum, target: LibraryAlbum): PlaybackStatsAlbum => ({
  ...album,
  albumId: target.id,
  albumKey: target.albumKey,
  mediaType: target.mediaType === 'remote' ? 'remote' : 'local',
  title: target.title,
  albumArtist: target.albumArtist,
  year: target.year,
  trackCount: target.trackCount,
  duration: target.duration,
  coverId: target.coverId,
  coverThumb: target.coverThumb ?? album.coverThumb,
});

const hasReadableFavoriteAlbumTracks = async (album: PlaybackStatsAlbum, target: LibraryAlbum): Promise<boolean> => {
  const library = window.echo?.library;
  const expectedTrackCount = Math.max(album.trackCount, target.trackCount);
  if (!library?.getAlbumTracks || expectedTrackCount <= 0) {
    return true;
  }

  try {
    const result = await library.getAlbumTracks(target.id, { page: 1, pageSize: 1 });
    return result.total > 0 || result.items.length > 0;
  } catch {
    return true;
  }
};

const resolveFavoriteAlbumTarget = async (album: PlaybackStatsAlbum): Promise<LibraryAlbum | null> => {
  const libraryAlbum = statsAlbumToLibraryAlbum(album);
  if (libraryAlbum) {
    const resolvedAlbum = await resolveAlbumDetailNavigationTarget(libraryAlbum);
    if (await hasReadableFavoriteAlbumTracks(album, resolvedAlbum)) {
      return resolvedAlbum;
    }

    const fallbackAlbum = await findFavoriteLibraryAlbum(album);
    return fallbackAlbum && await hasReadableFavoriteAlbumTracks(album, fallbackAlbum) ? fallbackAlbum : null;
  }

  const resolvedAlbum = await findFavoriteLibraryAlbum(album);
  return resolvedAlbum && await hasReadableFavoriteAlbumTracks(album, resolvedAlbum) ? resolvedAlbum : null;
};

const FavoriteAlbumGrid = ({
  albums,
  onOpenAlbum,
}: {
  albums: PlaybackStatsAlbum[];
  onOpenAlbum: (album: PlaybackStatsAlbum) => void;
}): JSX.Element => {
  const { t } = useI18n();
  const visibleAlbums = albums
    .filter((album) => album.title.trim().length > 0)
    .slice(0, favoriteAlbumLimit);

  if (visibleAlbums.length === 0) {
    return (
      <div className="home-favorite-album-empty" role="status">
        <Album size={18} />
        <span>
          <strong>{t('home.favoriteAlbums.emptyTitle')}</strong>
          <small>{t('home.favoriteAlbums.emptyDescription')}</small>
        </span>
      </div>
    );
  }

  return (
    <div className="home-favorite-album-grid" aria-label={t('home.favoriteAlbums.aria')}>
      {visibleAlbums.map((album, index) => {
        return (
          <button
            className="home-favorite-album-card"
            key={album.id}
            type="button"
            onClick={() => onOpenAlbum(album)}
          >
            <Artwork coverThumb={homeArtworkUrl(album, 'large')} title={album.title} size={96} />
            <span className="home-favorite-album-rank">{String(index + 1).padStart(2, '0')}</span>
            <span className="home-favorite-album-copy">
              <strong>{album.title}</strong>
              <small>{album.albumArtist || t('queue.unknownArtist')}</small>
              <em>{t('home.artistLeaderboard.playCount', { count: formatCompactNumber(album.playCount) })} · {formatDuration(album.playedSeconds, t)}</em>
            </span>
          </button>
        );
      })}
    </div>
  );
};

const startOfDay = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfWeek = (date: Date): Date => {
  const next = startOfDay(date);
  const day = next.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + mondayOffset);
  return next;
};

const compareDay = (left: Date, right: Date): number => startOfDay(left).getTime() - startOfDay(right).getTime();

const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatMonthLabel = (date: Date, t: ReturnType<typeof useI18n>['t']): string =>
  t('home.month.label', { month: date.getMonth() + 1 });

const clampSignal = (value: number): number => Math.max(0, Math.min(1, value));

const hashStableString = (seed: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

type LibraryBridge = NonNullable<NonNullable<Window['echo']>['library']>;

const loadRecommendedAlbums = async (library: LibraryBridge, albumCount: number, sort: 'default' | 'random' = 'default'): Promise<LibraryAlbum[]> => {
  if (!library.getAlbums || albumCount <= 0) {
    return [];
  }

  try {
    const result = await library.getAlbums({
      page: 1,
      pageSize: recommendedAlbumPageSize,
      sort,
    });
    return Array.from(new Map(result.items.map((album) => [album.id, album])).values());
  } catch {
    return [];
  }
};

const loadRecentAddedAlbums = async (library: LibraryBridge, albumCount: number): Promise<LibraryAlbum[]> => {
  if (!library.getAlbums || albumCount <= 0) {
    return [];
  }

  try {
    const result = await library.getAlbums({
      page: 1,
      pageSize: recentPageSize,
      sort: 'recent',
    });
    return Array.from(new Map(result.items.map((album) => [album.id, album])).values());
  } catch {
    return [];
  }
};

const loadRecentPlayedAlbums = async (library: LibraryBridge, entries: PlaybackHistoryEntry[]): Promise<RecentPlayedAlbum[]> => {
  if (!library.getAlbumForTrack || entries.length === 0) {
    return [];
  }

  const resolvedAlbums = await Promise.all(
    entries.map(async (entry): Promise<RecentPlayedAlbum | null> => {
      if (!entry.trackId) {
        return null;
      }

      try {
        const album = await library.getAlbumForTrack(entry.trackId);
        return album ? { album, startedAt: entry.startedAt } : null;
      } catch {
        return null;
      }
    }),
  );

  const seenAlbumIds = new Set<string>();
  const albums: RecentPlayedAlbum[] = [];
  for (const item of resolvedAlbums) {
    if (!item || seenAlbumIds.has(item.album.id)) {
      continue;
    }

    seenAlbumIds.add(item.album.id);
    albums.push(item);
  }

  return albums;
};

const dbToSignalUnit = (db: number | null | undefined): number | null => {
  if (db === null || db === undefined || !Number.isFinite(db)) {
    return null;
  }

  return clampSignal(Math.pow(10, db / 24));
};

const hashSignalSeed = (seed: string): number => {
  return hashStableString(seed);
};

const seededSignalNoise = (seed: string, index: number): number => {
  const hash = hashSignalSeed(`${seed}:${index}`);
  return (hash % 1000) / 1000;
};

const signalBand = (position: number, center: number, width: number): number => {
  const distance = (position - center) / width;
  return Math.exp(-(distance * distance));
};

const sanitizeVisualSpectrum = (spectrum: number[] | undefined): number[] => {
  if (!Array.isArray(spectrum) || spectrum.length === 0) {
    return [];
  }

  return spectrum.map((value) => (Number.isFinite(value) ? clampSignal(value) : 0));
};

const visualSpectrumAt = (spectrum: number[], position: number): number => {
  if (spectrum.length === 0) {
    return 0;
  }

  const scaled = clampSignal(position) * (spectrum.length - 1);
  const leftIndex = Math.floor(scaled);
  const rightIndex = Math.min(spectrum.length - 1, leftIndex + 1);
  const mix = scaled - leftIndex;
  return spectrum[leftIndex] * (1 - mix) + spectrum[rightIndex] * mix;
};

const signalVisualStep = (current: number, target: number, elapsedMs: number, attackMs: number, releaseMs: number): number => {
  const timeConstant = target > current ? attackMs : releaseMs;
  const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / timeConstant);
  return current + (target - current) * Math.min(1, Math.max(0, alpha));
};

const startOfThisWeekQuery = (): PlaybackHistoryQuery => {
  const start = startOfWeek(new Date());

  return { from: start.toISOString(), to: addDays(start, 7).toISOString() };
};

const weeklyHeatmapQuery = (): PlaybackHistoryQuery => {
  const currentWeekStart = startOfWeek(new Date());
  const from = addDays(currentWeekStart, -7 * (weeklyHeatmapWeeks - 1));

  return { from: from.toISOString(), to: addDays(currentWeekStart, 7).toISOString() };
};

const navigateHomeRoute = (routeId: HomeRouteId): void => {
  window.dispatchEvent(new CustomEvent('app:navigate:route', { detail: routeId }));
};

const readHomeWaveformVisualizerEnabled = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.homeWaveformVisualizerEnabled !== false &&
  settings?.audioVisualSpectrumEnabled === true &&
  settings?.lowLoadPlaybackModeEnabled !== true;

const readHomeRandomHeroTitleEnabled = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.homeRandomHeroTitleEnabled === true;

const useHomeWaveformVisualizerEnabled = (): boolean => {
  const [enabled, setEnabled] = useState(() => cachedHomeWaveformVisualizerEnabled ?? false);

  useEffect(() => {
    let cancelled = false;
    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (
        !settings ||
        (!Object.prototype.hasOwnProperty.call(settings, 'homeWaveformVisualizerEnabled') &&
          !Object.prototype.hasOwnProperty.call(settings, 'audioVisualSpectrumEnabled') &&
          !Object.prototype.hasOwnProperty.call(settings, 'lowLoadPlaybackModeEnabled'))
      ) {
        return;
      }

      cachedHomeWaveformVisualizerSettings = {
        homeWaveformVisualizerEnabled:
          typeof settings.homeWaveformVisualizerEnabled === 'boolean'
            ? settings.homeWaveformVisualizerEnabled
            : cachedHomeWaveformVisualizerSettings.homeWaveformVisualizerEnabled,
        audioVisualSpectrumEnabled:
          typeof settings.audioVisualSpectrumEnabled === 'boolean'
            ? settings.audioVisualSpectrumEnabled
            : cachedHomeWaveformVisualizerSettings.audioVisualSpectrumEnabled,
        lowLoadPlaybackModeEnabled:
          typeof settings.lowLoadPlaybackModeEnabled === 'boolean'
            ? settings.lowLoadPlaybackModeEnabled
            : cachedHomeWaveformVisualizerSettings.lowLoadPlaybackModeEnabled,
      };
      const nextEnabled = readHomeWaveformVisualizerEnabled(cachedHomeWaveformVisualizerSettings);
      cachedHomeWaveformVisualizerEnabled = nextEnabled;
      if (!cancelled) {
        setEnabled(nextEnabled);
      }
    };

    void window.echo?.app?.getSettings?.().then(applySettings).catch(() => undefined);

    const handleSettingsChanged = (event: Event): void => {
      applySettings((event as CustomEvent<Partial<AppSettings> | null | undefined>).detail);
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  return enabled;
};

const useHomeRandomHeroTitleEnabled = (): boolean => {
  const [enabled, setEnabled] = useState(() => cachedHomeRandomHeroTitleEnabled ?? true);

  useEffect(() => {
    let cancelled = false;
    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!settings || !Object.prototype.hasOwnProperty.call(settings, 'homeRandomHeroTitleEnabled')) {
        return;
      }

      const nextEnabled = readHomeRandomHeroTitleEnabled(settings);
      cachedHomeRandomHeroTitleEnabled = nextEnabled;
      if (!cancelled) {
        setEnabled(nextEnabled);
      }
    };

    void window.echo?.app?.getSettings?.().then(applySettings).catch(() => undefined);

    const handleSettingsChanged = (event: Event): void => {
      applySettings((event as CustomEvent<Partial<AppSettings> | null | undefined>).detail);
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  return enabled;
};

const homeArtworkUrl = (
  source: { coverId?: string | null; coverThumb?: string | null; coverSnapshot?: string | null },
  variant: 'album' | 'large' | 'thumb' = 'album',
): string | null => {
  const fallback = source.coverThumb ?? source.coverSnapshot ?? null;
  if (source.coverId) {
    return `echo-cover://${variant}/${encodeURIComponent(source.coverId)}`;
  }

  return fallback?.replace(/^echo-cover:\/\/(?:thumb|album|large|original)\//u, `echo-cover://${variant}/`) ?? fallback;
};

const trackFromHistory = (entry: PlaybackHistoryEntry): LibraryTrack => ({
  id: entry.stableKey ?? entry.trackId ?? entry.id,
  mediaType: entry.mediaType,
  path: entry.mediaType === 'streaming' ? entry.stableKey ?? entry.trackPath : entry.trackPath,
  provider: entry.provider,
  providerTrackId: entry.providerTrackId,
  stableKey: entry.stableKey,
  title: entry.title,
  artist: entry.artist,
  album: entry.album,
  albumArtist: entry.albumArtist,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: entry.durationSeconds,
  codec: null,
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  coverId: entry.coverId,
  coverThumb: entry.coverThumb ?? entry.coverSnapshot,
  fieldSources: {},
});

const Artwork = ({ coverThumb, title, size = 92 }: { coverThumb: string | null; title: string; size?: number }): JSX.Element => (
  <div className="home-artwork" data-empty={!coverThumb} style={{ '--home-artwork-size': `${size}px` } as CSSProperties}>
    {coverThumb ? <img alt="" src={coverThumb} /> : <Music2 size={Math.max(22, Math.round(size * 0.28))} />}
    <span className="sr-only">{title}</span>
  </div>
);

const MetricTile = ({ icon: Icon, label, value, detail, routeId }: MetricTileProps): JSX.Element => {
  const { t } = useI18n();

  return (
    <button className="home-metric-tile" type="button" aria-label={t('home.metric.openAria', { label })} onClick={() => navigateHomeRoute(routeId)}>
      <Icon size={19} />
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
    </button>
  );
};

const SectionHeader = ({
  title,
  action,
  actionLabel,
  routeId,
}: {
  title: string;
  action?: JSX.Element;
  actionLabel?: string;
  routeId?: HomeRouteId;
}): JSX.Element => (
  <header className="home-section-header">
    <h2>{title}</h2>
    {action ??
    (routeId && actionLabel ? (
      <button type="button" onClick={() => navigateHomeRoute(routeId)}>
        {actionLabel}
      </button>
    ) : null)}
  </header>
);

const SignalVisualizer = ({ seed, status }: { seed: string; status: AudioStatus | null }): JSX.Element => {
  const barElementsRef = useRef<Array<HTMLElement | null>>([]);
  const targetBarsRef = useRef<SignalBarModel[]>([]);
  const smoothedSignalRef = useRef<{
    frameId: number | null;
    lastTime: number;
    motion: number[];
    opacity: number[];
    scale: number[];
  }>({
    frameId: null,
    lastTime: 0,
    motion: [],
    opacity: [],
    scale: [],
  });
  const audioLevels = status?.audioLevels ?? null;
  const isActive = visualActiveStates.has(status?.state ?? 'idle');
  const peakUnit = dbToSignalUnit(audioLevels?.estimatedOutputPeakDb ?? audioLevels?.inputPeakDb);
  const rmsUnit = dbToSignalUnit(audioLevels?.estimatedOutputRmsDb ?? audioLevels?.inputRmsDb);
  const peak = peakUnit ?? 0;
  const rms = rmsUnit ?? 0;
  const meterReady = Boolean(audioLevels);
  const signalSeed = seed;
  const visualSpectrum = sanitizeVisualSpectrum(audioLevels?.visualSpectrum);
  const visualSpectrumPeak = Math.max(0, ...visualSpectrum);
  const visualTelemetryState = audioLevels?.visualTelemetryState;
  const telemetryIsPriming = visualTelemetryState === 'priming';
  const trustedPcmSpectrum =
    visualSpectrum.length > 0 && (visualTelemetryState === 'pcm' || telemetryIsPriming || (visualTelemetryState === undefined && visualSpectrumPeak > 0.001));
  const visualEnergy = clampSignal(audioLevels?.visualEnergy ?? 0);
  const visualTransient = clampSignal(audioLevels?.visualTransient ?? 0);
  const positionSeconds = status?.positionSeconds ?? 0;
  const meterIsSilent = isActive && meterReady && visualSpectrumPeak <= 0.003 && visualEnergy <= 0.025 && peak <= 0.026 && rms <= 0.02;
  const meterIsPriming = telemetryIsPriming || (meterIsSilent && positionSeconds < 1.2);
  const flatActiveMeter = meterIsSilent && !meterIsPriming;
  const energy = meterIsPriming
    ? telemetryIsPriming
      ? clampSignal(visualEnergy * 0.66 + rms * 0.05)
      : 0.06
    : flatActiveMeter
      ? 0.1
      : meterReady
        ? trustedPcmSpectrum
          ? clampSignal(visualEnergy * 0.86 + peak * 0.16 + rms * 0.14)
          : clampSignal(peak * 0.44 + rms * 0.42)
        : 0;
  const crest = meterIsPriming
    ? telemetryIsPriming
      ? clampSignal(visualTransient * 0.35 + peak * 0.04)
      : 0.04
    : flatActiveMeter
      ? 0.06
      : meterReady
        ? trustedPcmSpectrum
          ? clampSignal(visualTransient * 0.86 + Math.max(0, peak - rms) * 1.8 + peak * 0.08)
          : clampSignal(Math.max(0, peak - rms) * 2.1 + peak * 0.12)
        : 0;
  const hasVisualSpectrum = trustedPcmSpectrum && !flatActiveMeter && visualSpectrumPeak > 0.001;
  const timeSlice = Math.floor(positionSeconds * 12);
  const bars: SignalBarModel[] = Array.from({ length: signalBarCount }, (_, index) => {
    const position = index / Math.max(1, signalBarCount - 1);
    const coarse = seededSignalNoise(signalSeed, index);
    const fine = seededSignalNoise(signalSeed, index + 101);
    const transient = seededSignalNoise(`${signalSeed}:hit:${timeSlice}`, Math.floor(index / 2));
    const bassBand = signalBand(position, 0.14 + seededSignalNoise(signalSeed, 701) * 0.08, 0.18);
    const vocalBand = signalBand(position, 0.45 + seededSignalNoise(signalSeed, 702) * 0.14, 0.26);
    const airBand = signalBand(position, 0.78 + seededSignalNoise(signalSeed, 703) * 0.08, 0.16);
    const edgeDrop = Math.sin(position * Math.PI);
    const fallbackHit = Math.max(0, (transient - 0.58) / 0.42);
    const comb =
      0.92 +
      Math.sin(position * Math.PI * (4.4 + coarse * 2.8) + fine * Math.PI) * 0.15 +
      Math.sin(position * Math.PI * (10.5 + fine * 4.2)) * 0.08;
    const fallbackProfile = clampSignal(
      bassBand * (0.55 + rms * 0.36) +
        vocalBand * (0.34 + energy * 0.34) +
        airBand * (0.2 + crest * 0.52) +
        edgeDrop * 0.22 +
        (coarse - 0.5) * 0.16 +
        (fine - 0.5) * 0.1,
    );
    const visualSpectrumValue = hasVisualSpectrum ? Math.pow(visualSpectrumAt(visualSpectrum, position), 0.68) : 0;
    const spectrumContour = hasVisualSpectrum
      ? clampSignal(
          visualSpectrumValue * 0.84 +
            Math.pow(visualSpectrumAt(visualSpectrum, Math.max(0, position - 0.035)), 0.72) * 0.08 +
            Math.pow(visualSpectrumAt(visualSpectrum, Math.min(1, position + 0.035)), 0.72) * 0.08,
        )
      : 0;
    const spectralProfile = hasVisualSpectrum
      ? clampSignal(spectrumContour * (1.02 + energy * 0.2) + edgeDrop * (telemetryIsPriming ? 0.006 : 0.018 + visualTransient * 0.035))
      : fallbackProfile;
    const meterHeight = hasVisualSpectrum
      ? 4 +
        (0.028 +
          spectralProfile * (telemetryIsPriming ? 0.2 + energy * 0.12 : 0.66 + energy * 0.58) +
          energy * (telemetryIsPriming ? 0.05 : 0.12) +
          (telemetryIsPriming ? 0 : visualTransient * edgeDrop * 0.18)) *
          86
      : 4 + (energy * (0.16 + spectralProfile * comb) + rms * edgeDrop * 0.1 + fallbackHit * crest * 0.38) * 86;
    const idleHeight = 3 + (0.03 + coarse * 0.05) * 34;
    const height = meterReady && isActive ? meterHeight : idleHeight;
    const motion = hasVisualSpectrum
      ? telemetryIsPriming
        ? 0.018 + spectrumContour * 0.035 + visualTransient * 0.035
        : 0.032 + spectrumContour * 0.09 + visualTransient * 0.18 + crest * 0.05
      : meterReady && isActive
        ? 0.08 + spectralProfile * 0.12 + crest * 0.18 + fallbackHit * 0.18
        : 0.04 + coarse * 0.05;
    const minScale = Math.max(0.32, 1 - motion * (0.66 + fine * 0.24));
    const maxScale = Math.min(1.18, 1 + motion * 0.44);
    const midScale = minScale + (maxScale - minScale) * (0.28 + fine * 0.24);
    const fallScale = minScale + (maxScale - minScale) * (0.48 + coarse * 0.18);

    const targetHeight = Math.max(4, Math.min(96, height));
    const targetScale = targetHeight / 100;
    const targetOpacity =
      meterReady && isActive
        ? 0.5 + Math.min(0.42, energy * 0.25 + spectralProfile * 0.2 + (hasVisualSpectrum ? 0 : fallbackHit * 0.13))
        : 0.12 + coarse * 0.08;
    const requestedMotion = hasVisualSpectrum
      ? telemetryIsPriming
        ? targetScale * (0.024 + spectrumContour * 0.045) + visualTransient * 0.012
        : targetScale * (0.045 + spectrumContour * 0.11) + visualTransient * 0.04 + energy * 0.012 + crest * 0.012
      : targetScale * (0.1 + spectralProfile * 0.18) + energy * 0.02 + crest * 0.024 + fallbackHit * 0.012;
    const liveMotion =
      meterReady && isActive
        ? meterIsPriming
          ? Math.min(telemetryIsPriming ? 0.03 : 0.045, targetScale * (telemetryIsPriming ? 0.32 : 0.5))
          : Math.min(0.24, targetScale * 0.68, Math.max(flatActiveMeter ? 0.055 : 0.024, requestedMotion))
        : 0;

    return {
      delay: `${hasVisualSpectrum ? -(index % 12) * 0.018 : -(index % 23) * (0.026 + fine * 0.018)}s`,
      duration: `${
        hasVisualSpectrum ? 980 + Math.round((0.5 + edgeDrop * 0.5) * 260) + (telemetryIsPriming ? 180 : 0) : 980 + Math.round((coarse * 0.48 + fine * 0.16) * 620)
      }ms`,
      fallScale: fallScale.toFixed(3),
      height: `${targetHeight.toFixed(2)}%`,
      maxScale: maxScale.toFixed(3),
      midScale: midScale.toFixed(3),
      minScale: minScale.toFixed(3),
      motion: liveMotion.toFixed(4),
      opacity: targetOpacity.toFixed(3),
      targetHeight,
      targetMotion: liveMotion,
      targetOpacity,
      targetScale,
    };
  });
  targetBarsRef.current = bars;

  useEffect(() => {
    const state = smoothedSignalRef.current;

    const applyImmediateTargets = (): void => {
      targetBarsRef.current.forEach((bar, index) => {
        state.scale[index] = bar.targetScale;
        state.motion[index] = bar.targetMotion;
        state.opacity[index] = bar.targetOpacity;
        const element = barElementsRef.current[index];
        element?.style.setProperty('--home-signal-display-scale', bar.targetScale.toFixed(4));
        element?.style.setProperty('--home-signal-display-motion', bar.targetMotion.toFixed(4));
        element?.style.setProperty('--home-signal-display-opacity', bar.targetOpacity.toFixed(3));
      });
    };

    if (!isActive || !meterReady) {
      if (state.frameId !== null) {
        window.cancelAnimationFrame(state.frameId);
        state.frameId = null;
      }
      state.lastTime = 0;
      applyImmediateTargets();
      return undefined;
    }

    const tick = (timestamp: number): void => {
      const elapsedMs = state.lastTime > 0 ? Math.min(48, timestamp - state.lastTime) : 16.7;
      state.lastTime = timestamp;

      targetBarsRef.current.forEach((bar, index) => {
        const currentScale = state.scale[index] ?? bar.targetScale;
        const currentMotion = state.motion[index] ?? bar.targetMotion;
        const currentOpacity = state.opacity[index] ?? bar.targetOpacity;
        const nextScale = signalVisualStep(currentScale, bar.targetScale, elapsedMs, signalVisualAttackMs, signalVisualReleaseMs);
        const nextMotion = signalVisualStep(currentMotion, bar.targetMotion, elapsedMs, signalVisualMotionAttackMs, signalVisualMotionReleaseMs);
        const nextOpacity = signalVisualStep(currentOpacity, bar.targetOpacity, elapsedMs, signalVisualOpacityMs, signalVisualOpacityMs);
        const element = barElementsRef.current[index];

        state.scale[index] = nextScale;
        state.motion[index] = nextMotion;
        state.opacity[index] = nextOpacity;
        element?.style.setProperty('--home-signal-display-scale', nextScale.toFixed(4));
        element?.style.setProperty('--home-signal-display-motion', nextMotion.toFixed(4));
        element?.style.setProperty('--home-signal-display-opacity', nextOpacity.toFixed(3));
      });

      state.frameId = window.requestAnimationFrame(tick);
    };

    state.frameId = window.requestAnimationFrame(tick);

    return () => {
      if (state.frameId !== null) {
        window.cancelAnimationFrame(state.frameId);
        state.frameId = null;
      }
      state.lastTime = 0;
    };
  }, [isActive, meterReady, signalSeed]);

  return (
    <div className="home-signal-visualizer" data-active={isActive} data-meter-ready={meterReady} data-telemetry-state={visualTelemetryState ?? 'none'} aria-label={translateCurrentLocale('home.signalVisualizer.aria')}>
      <div className="home-signal-bars" aria-hidden="true">
        {bars.map((bar, index) => (
          <i
            key={index}
            ref={(element) => {
              barElementsRef.current[index] = element;
            }}
            style={
              {
                '--home-signal-delay': bar.delay,
                '--home-signal-duration': bar.duration,
                '--home-signal-fall-scale': bar.fallScale,
                '--home-signal-height': bar.height,
                '--home-signal-max-scale': bar.maxScale,
                '--home-signal-mid-scale': bar.midScale,
                '--home-signal-min-scale': bar.minScale,
                '--home-signal-motion': bar.motion,
                '--home-signal-opacity': bar.opacity,
                '--home-signal-scale': bar.targetScale.toFixed(4),
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
};

const scheduleHomeStartupWork = (callback: () => void, delayMs = 0): (() => void) => {
  if (typeof window === 'undefined') {
    callback();
    return () => undefined;
  }

  let frameId: number | null = null;
  let timeoutId: number | null = null;
  const run = (): void => {
    frameId = null;
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      callback();
    }, delayMs);
  };

  if (typeof window.requestAnimationFrame === 'function') {
    frameId = window.requestAnimationFrame(run);
  } else {
    run();
  }

  return () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
};

const WeeklyHeatmap = ({ days }: { days: PlaybackStatsDay[] }): JSX.Element => {
  const { t } = useI18n();
  const today = startOfDay(new Date());
  const currentWeekStart = startOfWeek(today);
  const firstWeekStart = addDays(currentWeekStart, -7 * (weeklyHeatmapWeeks - 1));
  const gridEnd = addDays(currentWeekStart, 6);
  const activityByDate = new Map(days.map((day) => [day.date, day]));
  const cells: Array<{
    date: Date;
    dateKey: string;
    isFuture: boolean;
    playCount: number;
    playedSeconds: number;
  }> = [];

  for (let day = firstWeekStart; compareDay(day, gridEnd) <= 0; day = addDays(day, 1)) {
    const date = startOfDay(day);
    const dateKey = formatDateKey(date);
    const activity = activityByDate.get(dateKey);
    cells.push({
      date,
      dateKey,
      isFuture: compareDay(date, today) > 0,
      playCount: activity?.playCount ?? 0,
      playedSeconds: activity?.playedSeconds ?? 0,
    });
  }

  const weeks = Array.from({ length: weeklyHeatmapWeeks }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const maxCount = Math.max(...cells.map((day) => day.playCount), 1);
  const monthStarts = weeks.reduce<Array<{ label: string; month: number; span: number; week: number; year: number }>>((labels, week, weekIndex) => {
    const firstDay = week[0]?.date;

    if (!firstDay) {
      return labels;
    }

    const lastLabel = labels.at(-1);
    if (!lastLabel || firstDay.getMonth() !== lastLabel.month || firstDay.getFullYear() !== lastLabel.year) {
      labels.push({
        label: formatMonthLabel(firstDay, t),
        month: firstDay.getMonth(),
        span: 1,
        week: weekIndex,
        year: firstDay.getFullYear(),
      });
      return labels;
    }

    lastLabel.span += 1;
    return labels;
  }, []);
  const activeWeeks = weeks.filter((week) => week.some((day) => !day.isFuture && day.playCount > 0)).length;
  const getLevel = (count: number): number => {
    if (count <= 0) {
      return 0;
    }

    const ratio = count / maxCount;
    if (ratio >= 0.8) {
      return 4;
    }
    if (ratio >= 0.55) {
      return 3;
    }
    if (ratio >= 0.25) {
      return 2;
    }
    return 1;
  };

  return (
    <div className="home-week-heatmap">
      <div className="home-week-months" style={{ gridTemplateColumns: `24px repeat(${weeklyHeatmapWeeks}, var(--home-week-cell))` }}>
        {monthStarts.map((month) => (
          <span key={`${month.year}-${month.month}`} style={{ gridColumn: `${month.week + 2} / span ${month.span}` }}>
            {month.label}
          </span>
        ))}
      </div>
      <div className="home-week-grid-shell">
        <div className="home-weekdays" aria-hidden="true">
          <span>{t('home.weekday.mon')}</span>
          <span />
          <span>{t('home.weekday.wed')}</span>
          <span />
          <span>{t('home.weekday.fri')}</span>
          <span />
          <span />
        </div>
        <div
          className="home-week-grid"
          style={{ gridTemplateColumns: `repeat(${weeklyHeatmapWeeks}, var(--home-week-cell))` }}
          aria-label={t('home.weeklyHeatmap.aria', { weeks: weeklyHeatmapWeeks })}
        >
          {cells.map((day) => (
            <span
              className="home-week-cell"
              data-future={day.isFuture ? 'true' : undefined}
              data-level={day.isFuture ? 0 : getLevel(day.playCount)}
              key={day.dateKey}
              title={t('home.weeklyHeatmap.dayTitle', { date: day.dateKey, playCount: day.playCount, duration: formatDuration(day.playedSeconds, t) })}
              aria-label={t('home.weeklyHeatmap.dayAria', { date: day.dateKey, playCount: day.playCount })}
            />
          ))}
        </div>
      </div>
      <div className="home-week-legend" aria-hidden="true">
        <span>{t('home.weeklyHeatmap.activeWeeks', { count: activeWeeks })}</span>
        <i data-level={0} />
        <i data-level={1} />
        <i data-level={2} />
        <i data-level={3} />
        <i data-level={4} />
      </div>
    </div>
  );
};

export const HomePage = (): JSX.Element => {
  const { locale, t } = useI18n();
  const queue = usePlaybackQueue();
  const playbackStatusSnapshot = useSharedPlaybackStatus();
  const initialHomeData = cachedHomePageData ?? emptyHomePageData;
  const [recentAddedAlbums, setRecentAddedAlbums] = useState<LibraryAlbum[]>(initialHomeData.recentAddedAlbums);
  const [recommendedAlbums, setRecommendedAlbums] = useState<LibraryAlbum[]>(initialHomeData.recommendedAlbums);
  const [summary, setSummary] = useState<LibrarySummary>(initialHomeData.summary);
  const [recentTracks, setRecentTracks] = useState<LibraryTrack[]>(initialHomeData.recentTracks);
  const [recentHistory, setRecentHistory] = useState<PlaybackHistoryEntry[]>(initialHomeData.recentHistory);
  const [recentPlayedAlbums, setRecentPlayedAlbums] = useState<RecentPlayedAlbum[]>(initialHomeData.recentPlayedAlbums);
  const [historySummary, setHistorySummary] = useState<PlaybackHistorySummary | null>(initialHomeData.historySummary);
  const [stats, setStats] = useState<PlaybackStatsDashboard | null>(initialHomeData.stats);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingRandomQueue, setIsGeneratingRandomQueue] = useState(false);
  const [isRefreshingRecommendations, setIsRefreshingRecommendations] = useState(false);
  const [isRefreshingFavoriteAlbums, setIsRefreshingFavoriteAlbums] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentPanelMode, setRecentPanelMode] = useState<RecentPanelMode>(cachedRecentPanelMode);
  const [recentShelfPage, setRecentShelfPage] = useState(0);
  const requestIdRef = useRef(0);
  const pulseRequestIdRef = useRef(0);
  const playbackPulseRequestIdRef = useRef(0);
  const currentPlayedAlbumRequestIdRef = useRef(0);
  const recommendationRequestIdRef = useRef(0);
  const playbackHistoryRefreshTimerRef = useRef<number | null>(null);

  const focusTrack = queue.currentTrack ?? queue.lastPlayedTrack ?? recentTracks[0] ?? (recentHistory[0] ? trackFromHistory(recentHistory[0]) : null);
  const audioStatus = playbackStatusSnapshot.audioStatus;
  const homeWaveformVisualizerEnabled = useHomeWaveformVisualizerEnabled();
  const homeRandomHeroTitleEnabled = useHomeRandomHeroTitleEnabled();
  const [randomHomeHeroTitle, setRandomHomeHeroTitle] = useState(() => {
    cachedHomeHeroTitle ??= pickHomeHeroTitle();
    return cachedHomeHeroTitle;
  });
  const homeHeroTitle = homeRandomHeroTitleEnabled ? randomHomeHeroTitle : t('home.hero.defaultTitle');
  const topArtist = stats?.topArtists[0]?.artist ?? focusTrack?.artist ?? 'ECHO';

  useEffect(() => {
    let cancelled = false;
    void personalizeHomeHeroTitle(randomHomeHeroTitle).then((nextTitle) => {
      if (cancelled || nextTitle === randomHomeHeroTitle) {
        return;
      }
      cachedHomeHeroTitle = nextTitle;
      setRandomHomeHeroTitle(nextTitle);
    });
    return () => {
      cancelled = true;
    };
  }, [randomHomeHeroTitle]);

  const playTrack = useCallback(
    async (track: LibraryTrack): Promise<void> => {
      try {
        await queue.playTrack(track, {
          replaceQueueWith: recentTracks.length > 0 ? recentTracks.filter((candidate) => !candidate.unavailable) : undefined,
          source: { type: 'manual', label: 'ECHO Home' },
        });
      } catch (playError) {
        setError(playError instanceof Error ? playError.message : String(playError));
      }
    },
    [queue, recentTracks],
  );

  const generateRandomQueue = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library?.getTracks) {
      setError(t('home.error.desktopBridgeRandom'));
      return;
    }

    try {
      setError(null);
      setIsGeneratingRandomQueue(true);
      const result = await library.getTracks({ page: 1, pageSize: randomQueuePageSize, sort: 'random', randomWindow: true });
      const randomTracks = result.items.filter((track) => !track.unavailable);

      if (randomTracks.length === 0) {
        setError(t('queue.error.noRandomTracks'));
        return;
      }

      const currentTrack = queue.currentTrack;
      const queueTracks = currentTrack
        ? [currentTrack, ...randomTracks.filter((track) => track.id !== currentTrack.id)]
        : randomTracks;

      queue.replaceQueue(queueTracks, {
        startTrackId: currentTrack?.id,
        source: { type: 'songs', label: t('queue.randomSource'), sort: 'random' },
      });
      navigateHomeRoute('queue');
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : String(queueError));
    } finally {
      setIsGeneratingRandomQueue(false);
    }
  }, [queue, t]);

  const openTrackAlbum = useCallback(async (track: LibraryTrack): Promise<void> => {
    try {
      setError(null);
      const album = await openAlbumDetailForTrack(track, { returnTo: 'home' });
      if (!album) {
        setError(t('home.error.albumNotFound', { album: track.album || t('queue.unknownAlbum') }));
      }
    } catch (navigationError) {
      setError(navigationError instanceof Error ? navigationError.message : String(navigationError));
    }
  }, [t]);

  const openTrackArtist = useCallback(async (artistName: string): Promise<void> => {
    try {
      setError(null);
      const artist = await openArtistDetailByName(artistName, { returnTo: 'home' });
      if (!artist) {
        setError(t('home.error.artistNotFound', { artist: artistName || t('queue.unknownArtist') }));
      }
    } catch (navigationError) {
      setError(navigationError instanceof Error ? navigationError.message : String(navigationError));
    }
  }, [t]);

  const openRecommendedAlbum = useCallback((album: LibraryAlbum): void => {
    void openAlbumDetail(album, { returnTo: 'home' }).catch((navigationError) => {
      setError(navigationError instanceof Error ? navigationError.message : String(navigationError));
    });
  }, []);

  const openFavoriteAlbum = useCallback((album: PlaybackStatsAlbum): void => {
    void (async () => {
      setError(null);
      const libraryAlbum = await resolveFavoriteAlbumTarget(album);
      if (!libraryAlbum) {
        setError(t('home.error.albumNotFound', { album: album.title || t('queue.unknownAlbum') }));
        return;
      }

      await openAlbumDetail(libraryAlbum, { returnTo: 'home' });
    })().catch((navigationError) => {
        setError(navigationError instanceof Error ? navigationError.message : String(navigationError));
    });
  }, [t]);

  const refreshFavoriteAlbums = useCallback((): void => {
    const topAlbums = stats?.topAlbums ?? [];
    if (topAlbums.length === 0 || isRefreshingFavoriteAlbums) {
      return;
    }

    void (async () => {
      setError(null);
      setIsRefreshingFavoriteAlbums(true);
      const refreshedAlbums: PlaybackStatsAlbum[] = [];

      for (const album of topAlbums) {
        const target = await resolveFavoriteAlbumTarget(album);
        if (target) {
          refreshedAlbums.push(favoriteStatsAlbumWithTarget(album, target));
        }
      }

      setStats((current) => {
        if (!current) {
          return current;
        }

        const nextStats = { ...current, topAlbums: refreshedAlbums };
        mergeCachedHomePageData({ stats: nextStats });
        return nextStats;
      });
    })().catch((refreshError) => {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }).finally(() => {
      setIsRefreshingFavoriteAlbums(false);
    });
  }, [isRefreshingFavoriteAlbums, stats?.topAlbums]);

  const changeRecentPanelMode = useCallback((mode: RecentPanelMode): void => {
    cachedRecentPanelMode = mode;
    setRecentPanelMode(mode);
  }, []);

  const refreshRecommendedAlbums = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    const requestId = recommendationRequestIdRef.current + 1;
    recommendationRequestIdRef.current = requestId;

    if (!library?.getAlbums) {
      setError(t('home.error.desktopBridgeRecommend'));
      return;
    }

    try {
      setError(null);
      setIsRefreshingRecommendations(true);
      const nextRecommendedAlbums = await loadRecommendedAlbums(library, summary.albumCount, 'random');

      if (recommendationRequestIdRef.current !== requestId) {
        return;
      }

      mergeCachedHomePageData({
        recommendedAlbums: nextRecommendedAlbums,
      });
      setRecommendedAlbums(nextRecommendedAlbums);
    } catch (loadError) {
      if (recommendationRequestIdRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (recommendationRequestIdRef.current === requestId) {
        setIsRefreshingRecommendations(false);
      }
    }
  }, [summary.albumCount, t]);

  const pushRecentPlayedAlbum = useCallback((item: RecentPlayedAlbum): void => {
    setRecentPlayedAlbums((current) => {
      const nextRecentPlayedAlbums = [item, ...current.filter((candidate) => candidate.album.id !== item.album.id)].slice(
        0,
        recentPlayedAlbumHistoryPageSize,
      );

      mergeCachedHomePageData({
        recentPlayedAlbums: nextRecentPlayedAlbums,
      });

      return nextRecentPlayedAlbums;
    });
  }, []);

  const loadPlaybackPulse = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    const requestId = playbackPulseRequestIdRef.current + 1;
    playbackPulseRequestIdRef.current = requestId;

    if (!library?.getPlaybackHistory || !library.getPlaybackHistorySummary) {
      return;
    }

    try {
      const historyPage = await library.getPlaybackHistory({ page: 1, pageSize: recentPlayedAlbumHistoryPageSize, sort: 'recent' });
      if (playbackPulseRequestIdRef.current !== requestId) {
        return;
      }

      const fallbackRecentPlayedAlbums = recentPlayedAlbumsFromHistory(historyPage.items);
      mergeCachedHomePageData({
        recentHistory: historyPage.items,
        recentPlayedAlbums: fallbackRecentPlayedAlbums,
      });
      setRecentHistory(historyPage.items);
      setRecentPlayedAlbums((current) => (current.length > 0 && fallbackRecentPlayedAlbums.length > 0 ? current : fallbackRecentPlayedAlbums));

      const weekQuery = startOfThisWeekQuery();
      const heatmapQuery = weeklyHeatmapQuery();
      const historySummaryPromise = library.getPlaybackHistorySummary(weekQuery);
      const statsPromise = library.getPlaybackStatsDashboard?.(heatmapQuery) ?? Promise.resolve(null);
      const recentPlayedAlbumsPromise = loadRecentPlayedAlbums(library, historyPage.items);
      const [nextHistorySummary, nextStats] = await Promise.all([historySummaryPromise, statsPromise]);

      if (playbackPulseRequestIdRef.current !== requestId) {
        return;
      }

      mergeCachedHomePageData({
        historySummary: nextHistorySummary,
        stats: nextStats,
      });
      setHistorySummary(nextHistorySummary);
      setStats(nextStats);

      const resolvedRecentPlayedAlbums = await recentPlayedAlbumsPromise;
      if (playbackPulseRequestIdRef.current !== requestId) {
        return;
      }

      const nextRecentPlayedAlbums = resolvedRecentPlayedAlbums.length > 0 ? resolvedRecentPlayedAlbums : fallbackRecentPlayedAlbums;
      mergeCachedHomePageData({
        recentPlayedAlbums: nextRecentPlayedAlbums,
      });
      setRecentPlayedAlbums(nextRecentPlayedAlbums);
    } catch (loadError) {
      if (playbackPulseRequestIdRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    }
  }, []);

  const loadRecentPlaybackPulse = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    const requestId = playbackPulseRequestIdRef.current + 1;
    playbackPulseRequestIdRef.current = requestId;

    if (!library?.getPlaybackHistory) {
      return;
    }

    try {
      const historyPage = await library.getPlaybackHistory({ page: 1, pageSize: recentPlayedAlbumHistoryPageSize, sort: 'recent' });
      if (playbackPulseRequestIdRef.current !== requestId) {
        return;
      }

      const fallbackRecentPlayedAlbums = recentPlayedAlbumsFromHistory(historyPage.items);
      mergeCachedHomePageData({
        recentHistory: historyPage.items,
        recentPlayedAlbums: fallbackRecentPlayedAlbums,
      });
      setRecentHistory(historyPage.items);
      setRecentPlayedAlbums((current) => (current.length > 0 && fallbackRecentPlayedAlbums.length > 0 ? current : fallbackRecentPlayedAlbums));

      const resolvedRecentPlayedAlbums = await loadRecentPlayedAlbums(library, historyPage.items);
      if (playbackPulseRequestIdRef.current !== requestId) {
        return;
      }

      const nextRecentPlayedAlbums = resolvedRecentPlayedAlbums.length > 0 ? resolvedRecentPlayedAlbums : fallbackRecentPlayedAlbums;
      mergeCachedHomePageData({
        recentPlayedAlbums: nextRecentPlayedAlbums,
      });
      setRecentPlayedAlbums(nextRecentPlayedAlbums);
    } catch (loadError) {
      if (playbackPulseRequestIdRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    }
  }, []);

  const loadLibraryPulse = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    const requestId = pulseRequestIdRef.current + 1;
    pulseRequestIdRef.current = requestId;

    if (!library?.getSummary || !library.getTracks) {
      return;
    }

    try {
      const [nextSummary, tracksPage] = await Promise.all([
        library.getSummary(),
        library.getTracks({ page: 1, pageSize: recentPageSize, sort: 'recent' }),
      ]);
      const [nextRecentAddedAlbums, nextRecommendedAlbums] = await Promise.all([
        loadRecentAddedAlbums(library, nextSummary.albumCount),
        loadRecommendedAlbums(library, nextSummary.albumCount),
      ]);

      if (pulseRequestIdRef.current !== requestId) {
        return;
      }

      mergeCachedHomePageData({
        recentAddedAlbums: nextRecentAddedAlbums,
        recommendedAlbums: nextRecommendedAlbums,
        summary: nextSummary,
        recentTracks: tracksPage.items,
      });
      setRecentAddedAlbums(nextRecentAddedAlbums);
      setRecommendedAlbums(nextRecommendedAlbums);
      setSummary(nextSummary);
      setRecentTracks(tracksPage.items);
    } catch (loadError) {
      if (pulseRequestIdRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    }
  }, []);

  const loadHome = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setError(null);

    if (!library?.getSummary || !library.getTracks) {
      setSummary(emptySummary);
      setRecentAddedAlbums([]);
      setRecommendedAlbums([]);
      setRecentTracks([]);
      setError(t('home.error.desktopBridgeView'));
      setIsLoading(false);
      return;
    }

    try {
      const [nextSummary, tracksPage] = await Promise.all([
        library.getSummary(),
        library.getTracks({ page: 1, pageSize: recentPageSize, sort: 'recent' }),
      ]);
      const [nextRecentAddedAlbums, nextRecommendedAlbums] = await Promise.all([
        loadRecentAddedAlbums(library, nextSummary.albumCount),
        loadRecommendedAlbums(library, nextSummary.albumCount),
      ]);

      if (requestIdRef.current !== requestId) {
        return;
      }

      mergeCachedHomePageData({
        recentAddedAlbums: nextRecentAddedAlbums,
        recommendedAlbums: nextRecommendedAlbums,
        summary: nextSummary,
        recentTracks: tracksPage.items,
      });
      setRecentAddedAlbums(nextRecentAddedAlbums);
      setRecommendedAlbums(nextRecommendedAlbums);
      setSummary(nextSummary);
      setRecentTracks(tracksPage.items);
    } catch (loadError) {
      if (requestIdRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [t]);

  const refreshHome = useCallback(async (): Promise<void> => {
    setRecentShelfPage(0);
    await loadHome();
  }, [loadHome]);

  useEffect(() => {
    if (cachedHomePageData === null) {
      const cancelHomeLoad = scheduleHomeStartupWork(() => void loadHome());
      const cancelPlaybackPulse = scheduleHomeStartupWork(() => void loadPlaybackPulse(), homeInitialPlaybackPulseDelayMs);

      return () => {
        cancelHomeLoad();
        cancelPlaybackPulse();
      };
    }

    const scheduledRefreshes: Array<() => void> = [];
    if (!hasCachedLibraryPulseData(cachedHomePageData)) {
      scheduledRefreshes.push(scheduleHomeStartupWork(() => void loadLibraryPulse()));
    } else if (!hasCachedPlaybackPulseData(cachedHomePageData)) {
      scheduledRefreshes.push(scheduleHomeStartupWork(() => void loadPlaybackPulse(), homeInitialPlaybackPulseDelayMs));
    }
    if (scheduledRefreshes.length > 0) {
      return () => scheduledRefreshes.forEach((cancelRefresh) => cancelRefresh());
    }

    return undefined;
  }, [loadHome, loadLibraryPulse, loadPlaybackPulse]);

  useEffect(() => {
    const handleLibraryChanged = (): void => {
      void loadLibraryPulse();
    };

    window.addEventListener('library:changed', handleLibraryChanged);
    return () => window.removeEventListener('library:changed', handleLibraryChanged);
  }, [loadLibraryPulse]);

  useEffect(() => {
    const handlePlaybackHistoryChanged = (): void => {
      if (playbackHistoryRefreshTimerRef.current !== null) {
        window.clearTimeout(playbackHistoryRefreshTimerRef.current);
      }
      playbackHistoryRefreshTimerRef.current = window.setTimeout(() => {
        playbackHistoryRefreshTimerRef.current = null;
        void loadRecentPlaybackPulse();
      }, homePlaybackHistoryRefreshDelayMs);
    };

    window.addEventListener(playbackHistoryChangedEvent, handlePlaybackHistoryChanged);
    return () => {
      window.removeEventListener(playbackHistoryChangedEvent, handlePlaybackHistoryChanged);
      if (playbackHistoryRefreshTimerRef.current !== null) {
        window.clearTimeout(playbackHistoryRefreshTimerRef.current);
        playbackHistoryRefreshTimerRef.current = null;
      }
    };
  }, [loadRecentPlaybackPulse]);

  useEffect(() => {
    const track = queue.currentTrack;
    const library = window.echo?.library;
    const requestId = currentPlayedAlbumRequestIdRef.current + 1;
    currentPlayedAlbumRequestIdRef.current = requestId;

    if (!track) {
      return;
    }

    const fallbackAlbum: LibraryAlbum = {
      id: `current:${track.stableKey ?? track.id ?? track.path}`,
      mediaType: track.mediaType === 'remote' ? 'remote' : 'local',
      albumKey: `current:${track.stableKey ?? track.id ?? track.path}`,
      title: track.album || track.title,
      albumArtist: track.albumArtist || track.artist,
      year: track.year,
      trackCount: 1,
      duration: track.duration,
      coverId: track.coverId,
      coverThumb: track.coverThumb,
    };

    const startedAt = new Date().toISOString();

    if (!library?.getAlbumForTrack || track.isTemporary) {
      pushRecentPlayedAlbum({ album: fallbackAlbum, startedAt });
      return;
    }

    void library
      .getAlbumForTrack(track.id)
      .then((album) => {
        if (currentPlayedAlbumRequestIdRef.current !== requestId) {
          return;
        }

        pushRecentPlayedAlbum({ album: album ?? fallbackAlbum, startedAt });
      })
      .catch(() => {
        if (currentPlayedAlbumRequestIdRef.current === requestId) {
          pushRecentPlayedAlbum({ album: fallbackAlbum, startedAt });
        }
      });
  }, [pushRecentPlayedAlbum, queue.currentTrack, recentHistory]);

  useEffect(() => {
    setRecentShelfPage(0);
  }, [recentPanelMode]);

  useEffect(() => {
    const itemCount = recentPanelMode === 'added' ? recentAddedAlbums.length : recentPlayedAlbums.length;
    const lastPage = Math.max(0, Math.ceil(itemCount / recentShelfPageSize) - 1);
    setRecentShelfPage((currentPage) => Math.min(currentPage, lastPage));
  }, [recentAddedAlbums.length, recentPanelMode, recentPlayedAlbums.length]);

  const pulseTiles = useMemo<MetricTileProps[]>(
    () => [
      { icon: Music2, label: t('home.metric.songs'), value: formatCompactNumber(summary.songCount), detail: t('home.metric.songsDetail', { duration: formatDuration(summary.totalDuration, t) }), routeId: 'songs' },
      { icon: Album, label: t('home.metric.albums'), value: formatCompactNumber(summary.albumCount), detail: t('home.metric.albumsDetail'), routeId: 'albums' },
      { icon: UserRound, label: t('home.metric.artists'), value: formatCompactNumber(summary.artistCount), detail: topArtist, routeId: 'artists' },
      { icon: Folder, label: t('home.metric.folders'), value: formatCompactNumber(summary.folderCount), detail: t('home.metric.foldersDetail', { date: formatShortDate(summary.lastScanAt, t, locale) }), routeId: 'folders' },
    ],
    [locale, summary, t, topArtist],
  );

  const weeklyPlayCount = historySummary?.rangeCount ?? stats?.totals.playCount ?? 0;
  const weeklyDuration = historySummary?.rangePlayedSeconds ?? stats?.totals.playedSeconds ?? 0;
  const hasWeeklyActivity = weeklyPlayCount > 0 || weeklyDuration > 0 || (stats?.dailyActivity.some((day) => day.playCount > 0 || day.playedSeconds > 0) ?? false);
  const activeRecentItemCount = recentPanelMode === 'added' ? recentAddedAlbums.length : recentPlayedAlbums.length;
  const recentTotalPages = Math.max(1, Math.ceil(activeRecentItemCount / recentShelfPageSize));
  const recentPageStart = recentShelfPage * recentShelfPageSize;
  const visibleRecentAddedAlbums = recentAddedAlbums.slice(recentPageStart, recentPageStart + recentShelfPageSize);
  const visibleRecentPlayedAlbums = recentPlayedAlbums.slice(recentPageStart, recentPageStart + recentShelfPageSize);

  return (
    <div className="home-page">
      <section className="home-hero" aria-label={t('home.hero.aria')}>
        <div className="home-hero-copy">
          <span className="home-signal-label">
            <Radio size={15} />
            {t('home.hero.kicker')}
          </span>
          <h1>{homeHeroTitle}</h1>
          <p>
            {focusTrack
              ? t('home.hero.description.resume', { artist: focusTrack.artist || t('queue.unknownArtist'), title: focusTrack.title })
              : t('home.hero.description.empty')}
          </p>
          <div className="home-hero-actions">
            <button className="home-primary-action" type="button" disabled={!focusTrack} onClick={() => focusTrack && void playTrack(focusTrack)}>
              <Play size={17} fill="currentColor" />
              {t('home.hero.action.continue')}
            </button>
            <button className="home-secondary-action" type="button" onClick={() => navigateHomeRoute('queue')}>
              <ListMusic size={17} />
              {t('home.hero.action.viewQueue')}
            </button>
            <button className="home-secondary-action" type="button" disabled={isLoading} onClick={() => void refreshHome()}>
              <RefreshCw size={17} />
              {isLoading ? t('home.recommend.refreshing') : t('home.recommend.refresh')}
            </button>
            <button className="home-secondary-action" type="button" disabled={summary.songCount <= 0 || isGeneratingRandomQueue} onClick={() => void generateRandomQueue()}>
              <Shuffle size={17} />
              {isGeneratingRandomQueue ? t('queue.action.generatingRandom') : t('queue.action.generateRandom')}
            </button>
          </div>
        </div>

        <div className="home-now-card" data-empty={!focusTrack} data-signal-enabled={homeWaveformVisualizerEnabled}>
          <div className="home-now-artwork-stack">
            <Artwork coverThumb={focusTrack ? homeArtworkUrl(focusTrack, 'album') : null} title={focusTrack?.title ?? t('nowPlaying.emptyTitle')} size={132} />
          </div>
          <div className="home-now-copy">
            <span>{queue.currentTrack ? t('home.hero.nowPlaying') : t('home.hero.recentSignal')}</span>
            <HomeNowTitle title={focusTrack?.title ?? t('nowPlaying.emptyTitle')} />
            <HomeNowMeta track={focusTrack} onOpenAlbum={(track) => void openTrackAlbum(track)} onOpenArtist={(artistName) => void openTrackArtist(artistName)} />
          </div>
          {homeWaveformVisualizerEnabled ? (
            <SignalVisualizer seed={audioStatus?.currentTrackId ?? focusTrack?.id ?? focusTrack?.path ?? focusTrack?.title ?? 'idle'} status={audioStatus} />
          ) : null}
        </div>
      </section>

      <section className="home-pulse" aria-label={t('home.hero.statsAria')}>
        <div className="home-metric-grid">
          {pulseTiles.map((tile) => (
            <MetricTile key={tile.label} {...tile} />
          ))}
        </div>
      </section>

      <section className="home-content-grid">
        <div className="home-panel home-recent-panel" data-mode={recentPanelMode}>
          <header className="home-section-header home-recent-header">
            <div className="home-recent-title-row">
              <h2>{t('home.recent.title')}</h2>
              <div className="home-segmented-control" role="tablist" aria-label={t('home.recent.tabsAria')}>
                <button type="button" role="tab" aria-selected={recentPanelMode === 'played'} data-active={recentPanelMode === 'played'} onClick={() => changeRecentPanelMode('played')}>
                  {t('home.recent.tab.played')}
                </button>
                <button type="button" role="tab" aria-selected={recentPanelMode === 'added'} data-active={recentPanelMode === 'added'} onClick={() => changeRecentPanelMode('added')}>
                  {t('home.recent.tab.added')}
                </button>
              </div>
            </div>
            <div className="home-activity-actions">
              <button
                className="home-shelf-arrow"
                type="button"
                aria-label={t('home.recent.prevPage')}
                disabled={recentShelfPage <= 0}
                onClick={() => setRecentShelfPage((page) => Math.max(0, page - 1))}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="home-shelf-arrow"
                type="button"
                aria-label={t('home.recent.nextPage')}
                disabled={recentShelfPage >= recentTotalPages - 1}
                onClick={() => setRecentShelfPage((page) => Math.min(recentTotalPages - 1, page + 1))}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </header>

          {recentPanelMode === 'added' ? (
            recentAddedAlbums.length > 0 ? (
              <div className="home-cover-rail">
                {visibleRecentAddedAlbums.map((album) => (
                  <button className="home-cover-card" key={album.id} type="button" onClick={() => openRecommendedAlbum(album)}>
                    <Artwork coverThumb={homeArtworkUrl(album, 'large')} title={album.title} size={176} />
                    <strong>{album.title}</strong>
                    <span>{album.albumArtist || t('queue.unknownArtist')} · {t('home.count.tracks', { count: album.trackCount })}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="home-empty-panel">
                <Library size={24} />
                <strong>{t('home.recent.emptyAddedTitle')}</strong>
                <span>{t('home.recent.emptyAddedDescription')}</span>
              </div>
            )
          ) : recentPlayedAlbums.length > 0 ? (
            <div className="home-cover-rail home-played-rail">
              {visibleRecentPlayedAlbums.map((item) => (
                <button className="home-cover-card" key={item.album.id} type="button" onClick={() => openRecommendedAlbum(item.album)}>
                  <Artwork coverThumb={homeArtworkUrl(item.album, 'large')} title={item.album.title} size={156} />
                  <strong>{item.album.title}</strong>
                  <span>{item.album.albumArtist || t('queue.unknownArtist')} · {formatShortDate(item.startedAt, t, locale)}</span>
                </button>
              ))}
            </div>
          ) : (
              <div className="home-empty-panel">
                <History size={24} />
                <strong>{t('home.recent.emptyPlayedTitle')}</strong>
                <span>{t('home.recent.emptyPlayedDescription')}</span>
              </div>
            )}
        </div>

        <div className="home-panel home-week-panel" data-empty={!hasWeeklyActivity}>
          <SectionHeader title={t('home.week.title')} actionLabel={t('route.history.label')} routeId="history" />
          <div className="home-week-summary">
            <div className="home-week-stat">
              <span>{t('home.week.playCount')}</span>
              <strong>{formatCompactNumber(weeklyPlayCount)}</strong>
              <small>{t('home.week.times')}</small>
            </div>
            <div className="home-week-stat">
              <span>{t('home.week.listenDuration')}</span>
              <strong>{formatDuration(weeklyDuration, t)}</strong>
            </div>
          </div>
          <WeeklyHeatmap days={stats?.dailyActivity ?? []} />
          {!hasWeeklyActivity ? (
            <p className="home-week-hint">{t('home.week.emptyHint')}</p>
          ) : null}
        </div>
      </section>

      <section className="home-panel home-recommend-panel" data-empty={recommendedAlbums.length === 0}>
        <SectionHeader
          title={t('home.recommend.title')}
          action={
            <button type="button" disabled={isRefreshingRecommendations || summary.albumCount <= 0} onClick={() => void refreshRecommendedAlbums()}>
              <RefreshCw size={15} />
              {isRefreshingRecommendations ? t('home.recommend.refreshing') : t('home.recommend.refresh')}
            </button>
          }
        />
        {recommendedAlbums.length > 0 ? (
          <div className="home-cover-rail home-recommend-rail">
            {recommendedAlbums.map((album) => (
              <button className="home-cover-card" key={album.id} type="button" onClick={() => openRecommendedAlbum(album)}>
                <Artwork coverThumb={homeArtworkUrl(album, 'large')} title={album.title} size={176} />
                <strong>{album.title}</strong>
                <span>
                  {album.albumArtist || t('queue.unknownArtist')} · {t('home.count.tracks', { count: album.trackCount })}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="home-empty-panel home-empty-panel--compact">
            <Album size={24} />
            <strong>{t('home.recommend.emptyTitle')}</strong>
            <span>{t('home.recommend.emptyDescription')}</span>
          </div>
        )}
      </section>

      <section className="home-stats-grid" aria-label={t('home.preferences.aria')}>
        <div className="home-panel home-artist-rank-panel" data-empty={(stats?.topArtists.length ?? 0) === 0}>
          <SectionHeader title={t('home.artistLeaderboard.title')} />
          <ArtistLeaderboard artists={stats?.topArtists ?? []} onOpenArtist={(artistName) => void openTrackArtist(artistName)} />
        </div>

        <div className="home-panel home-favorite-album-panel" data-empty={(stats?.topAlbums?.length ?? 0) === 0}>
          <SectionHeader
            title={t('home.favoriteAlbums.title')}
            action={
              <button type="button" disabled={isRefreshingFavoriteAlbums || (stats?.topAlbums?.length ?? 0) === 0} onClick={refreshFavoriteAlbums}>
                <RefreshCw size={15} />
                {isRefreshingFavoriteAlbums ? t('home.recommend.refreshing') : t('home.recommend.refresh')}
              </button>
            }
          />
          <FavoriteAlbumGrid albums={stats?.topAlbums ?? []} onOpenAlbum={openFavoriteAlbum} />
        </div>
      </section>

      {error || isLoading ? (
        <p className="home-status-line" role={error ? 'alert' : 'status'}>
          {error ?? t('home.status.loading')}
        </p>
      ) : null}
    </div>
  );
};
