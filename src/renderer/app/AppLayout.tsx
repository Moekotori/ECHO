import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { X } from 'lucide-react';
import { PlayerBar } from '../components/player/PlayerBar';
import { PlaybackQueueDrawer } from '../components/player/PlaybackQueueDrawer';
import { AudioSettingsDrawer } from '../components/player/AudioSettingsDrawer';
import { AudioIssueDiagnosticsWindow } from '../components/player/AudioIssueDiagnosticsWindow';
import { LyricsSettingsDrawer } from '../components/lyrics/LyricsSettingsDrawer';
import { MvSettingsDrawer } from '../components/lyrics/MvSettingsDrawer';
import { contrastRatio, parseHexColor, sampleImageUrl, type ReadableColorSample, type Rgb } from '../components/lyrics/lyricsReadableColor';
import { DragDropImportOverlay } from '../components/import/DragDropImportOverlay';
import { FirstRunWizard } from '../components/onboarding/FirstRunWizard';
import { loadPersistedRememberedAudioOutput } from '../components/player/audioOutputMemory';
import { Sidebar } from '../components/layout/Sidebar';
import { AppTitleBar } from '../components/layout/AppTitleBar';
import { EditableContextMenu } from '../components/ui/EditableContextMenu';
import { formatAudioHostError } from '../components/player/audioErrorFormat';
import type { AppRoute, AppRouteId } from './routes';
import type { AudioStatus } from '../../shared/types/audio';
import type { AccountProvider, AccountStatus } from '../../shared/types/accounts';
import type { AppSettings } from '../../shared/types/appSettings';
import type { DownloadJob } from '../../shared/types/downloads';
import type { UpdateStatus } from '../../shared/types/updates';
import { useI18n } from '../i18n/I18nProvider';
import { likedChangedEvent, likedTracksChangedEvent } from '../hooks/useLikedMedia';
import type { TranslationKey } from '../i18n/locales';
import { logLyricsConsole } from '../diagnostics/lyricsConsole';
import { rememberLibraryScanStatus } from '../stores/libraryScanSession';
import { clearSongsFirstPageSnapshot } from '../stores/songsFirstPageSnapshot';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { setPlaybackStatusSnapshot, useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { albumDetailNavigationEvent } from '../utils/albumNavigation';
import { artistDetailNavigationEvent } from '../utils/artistNavigation';
import { applySidebarPreferences } from './sidebarPreferences';
import { defaultSidebarRouteOrder, normalizeSidebarHiddenRouteIds, normalizeSidebarRouteOrder } from '../../shared/types/sidebar';
import type { PlaybackStatus } from '../../shared/types/playback';

type AppLayoutProps = {
  routes: AppRoute[];
};

type LyricsNavigationDetail = {
  mode?: 'lyrics' | 'mv';
};

type LyricsViewMode = 'lyrics' | 'mv';

type RouteSwitchTrace = {
  sequence: number;
  from: AppRouteId;
  to: AppRouteId;
  trigger: string;
  startedAtMs: number;
};

const lyricsViewModeMemoryKey = 'echo:lyrics:view-mode';

const routeSwitchValue = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.round(value));
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return null;
};

const logRouteSwitchDiagnostic = (
  phase: 'start' | 'end',
  details: Record<string, unknown>,
): void => {
  const fields = Object.entries(details)
    .map(([key, value]) => {
      const text = routeSwitchValue(value);
      return text === null ? null : `${key}=${text}`;
    })
    .filter((item): item is string => Boolean(item));
  console.info(`[routeSwitch:${phase}]${fields.length ? ` ${fields.join(' ')}` : ''}`);
};

const isLyricsViewMode = (value: unknown): value is LyricsViewMode =>
  value === 'lyrics' || value === 'mv';

const readRememberedLyricsViewMode = (): LyricsViewMode => {
  try {
    const value = window.sessionStorage.getItem(lyricsViewModeMemoryKey);
    return isLyricsViewMode(value) ? value : 'lyrics';
  } catch {
    return 'lyrics';
  }
};

const rememberLyricsViewMode = (mode: LyricsViewMode): void => {
  try {
    window.sessionStorage.setItem(lyricsViewModeMemoryKey, mode);
  } catch {
    // Best-effort page mode only.
  }
};

type AppWallpaperSettings = Pick<
  AppSettings,
  | 'appCustomWallpaperPath'
  | 'appPortraitWallpaperPath'
  | 'appWallpaperMediaType'
  | 'appPortraitWallpaperMediaType'
  | 'appWallpaperScalePercent'
  | 'appWallpaperBlurPx'
  | 'appWallpaperBrightnessPercent'
  | 'appWallpaperUiOpacityPercent'
  | 'appWallpaperVisualProtectionEnabled'
  | 'appWallpaperUnifiedOpacityEnabled'
  | 'appVideoWallpaperPauseMode'
>;

type LyricsMiniPlayerSettings = Pick<
  AppSettings,
  | 'lyricsPlayerBarDrawerEnabled'
  | 'lyricsPlayerBarDrawerAutoEnableForMv'
  | 'lyricsPlayerBarDrawerAutoHideEnabled'
  | 'lyricsPlayerBarDrawerOpacityPercent'
  | 'lyricsPlayerBarDrawerColorMode'
  | 'lyricsPlayerBarDrawerColor'
>;

type SidebarLayoutSettings = Pick<AppSettings, 'sidebarAutoHideEnabled' | 'sidebarHiddenRouteIds' | 'sidebarRouteOrder'>;

const defaultAppWallpaperSettings: AppWallpaperSettings = {
  appCustomWallpaperPath: null,
  appPortraitWallpaperPath: null,
  appWallpaperMediaType: 'image',
  appPortraitWallpaperMediaType: 'image',
  appWallpaperScalePercent: 100,
  appWallpaperBlurPx: 0,
  appWallpaperBrightnessPercent: 100,
  appWallpaperUiOpacityPercent: 100,
  appWallpaperVisualProtectionEnabled: true,
  appWallpaperUnifiedOpacityEnabled: false,
  appVideoWallpaperPauseMode: 'smart',
};

const defaultLyricsMiniPlayerSettings: LyricsMiniPlayerSettings = {
  lyricsPlayerBarDrawerEnabled: true,
  lyricsPlayerBarDrawerAutoEnableForMv: true,
  lyricsPlayerBarDrawerAutoHideEnabled: false,
  lyricsPlayerBarDrawerOpacityPercent: 78,
  lyricsPlayerBarDrawerColorMode: 'default',
  lyricsPlayerBarDrawerColor: '#232120',
};

const defaultSidebarLayoutSettings: SidebarLayoutSettings = {
  sidebarRouteOrder: [...defaultSidebarRouteOrder],
  sidebarHiddenRouteIds: [],
  sidebarAutoHideEnabled: false,
};

const downloadLibraryChangeDebounceMs = 250;
const persistentRouteIds = new Set<AppRouteId>(['songs', 'albums', 'artists', 'streaming', 'playlists']);
const readSongsNavigationRemoteSourceId = (event: Event): string | null => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'object' || event.detail === null) {
    return null;
  }

  const remoteSourceId = (event.detail as { remoteSourceId?: unknown }).remoteSourceId;
  return typeof remoteSourceId === 'string' && remoteSourceId.trim().length > 0 ? remoteSourceId : null;
};
const accountProviderLabelKeys: Record<AccountProvider, TranslationKey> = {
  netease: 'accountProvider.netease',
  qqmusic: 'accountProvider.qqmusic',
  kugou: 'accountProvider.kugou',
  bilibili: 'accountProvider.bilibili',
  youtube: 'accountProvider.youtube',
  soundcloud: 'accountProvider.soundcloud',
  spotify: 'accountProvider.spotify',
  tidal: 'accountProvider.tidal',
  osu: 'accountProvider.osu',
};

const isSpotifyPlaybackSetupError = (message: string): boolean =>
  /spotify/iu.test(message) && /(SDK|DRM\/Widevine|keysystem|playback device|Connect device|official player)/iu.test(message);

const inferAppWallpaperMediaType = (filePath: string | null | undefined): NonNullable<AppSettings['appWallpaperMediaType']> =>
  filePath && /\.(?:mp4|m4v|webm)$/iu.test(filePath.trim()) ? 'video' : 'image';

const isPortraitViewport = (): boolean => window.innerHeight > window.innerWidth;

const selectAppWallpaperSettings = (settings: AppSettings): AppWallpaperSettings => ({
  appCustomWallpaperPath: settings.appCustomWallpaperPath,
  appPortraitWallpaperPath: settings.appPortraitWallpaperPath ?? null,
  appWallpaperMediaType: settings.appWallpaperMediaType ?? 'image',
  appPortraitWallpaperMediaType: settings.appPortraitWallpaperMediaType ?? inferAppWallpaperMediaType(settings.appPortraitWallpaperPath),
  appWallpaperScalePercent: settings.appWallpaperScalePercent,
  appWallpaperBlurPx: settings.appWallpaperBlurPx,
  appWallpaperBrightnessPercent: settings.appWallpaperBrightnessPercent,
  appWallpaperUiOpacityPercent: settings.appWallpaperUiOpacityPercent,
  appWallpaperVisualProtectionEnabled: settings.appWallpaperVisualProtectionEnabled !== false,
  appWallpaperUnifiedOpacityEnabled: settings.appWallpaperUnifiedOpacityEnabled,
  appVideoWallpaperPauseMode: settings.appVideoWallpaperPauseMode ?? 'smart',
});

const selectLyricsMiniPlayerSettings = (settings: Partial<AppSettings>): LyricsMiniPlayerSettings => ({
  lyricsPlayerBarDrawerEnabled: settings.lyricsPlayerBarDrawerEnabled !== false,
  lyricsPlayerBarDrawerAutoEnableForMv: settings.lyricsPlayerBarDrawerAutoEnableForMv !== false,
  lyricsPlayerBarDrawerAutoHideEnabled: settings.lyricsPlayerBarDrawerAutoHideEnabled === true,
  lyricsPlayerBarDrawerOpacityPercent: Number.isFinite(settings.lyricsPlayerBarDrawerOpacityPercent)
    ? Math.max(20, Math.min(100, Math.round(Number(settings.lyricsPlayerBarDrawerOpacityPercent))))
    : defaultLyricsMiniPlayerSettings.lyricsPlayerBarDrawerOpacityPercent,
  lyricsPlayerBarDrawerColorMode:
    settings.lyricsPlayerBarDrawerColorMode === 'custom' || settings.lyricsPlayerBarDrawerColorMode === 'cover'
      ? settings.lyricsPlayerBarDrawerColorMode
      : defaultLyricsMiniPlayerSettings.lyricsPlayerBarDrawerColorMode,
  lyricsPlayerBarDrawerColor: /^#[0-9a-fA-F]{6}$/u.test(settings.lyricsPlayerBarDrawerColor ?? '')
    ? (settings.lyricsPlayerBarDrawerColor as string).toUpperCase()
    : defaultLyricsMiniPlayerSettings.lyricsPlayerBarDrawerColor,
});

const originalCoverUrlFromThumb = (coverUrl: string | null): string | null =>
  coverUrl?.replace(/^echo-cover:\/\/(?:thumb|album|large)\//u, 'echo-cover://original/') ?? null;

const miniPlayerArtworkUrl = (
  track: { coverId: string | null; coverThumb: string | null } | null,
): string | null =>
  track?.coverId
    ? `echo-cover://original/${encodeURIComponent(track.coverId)}`
    : originalCoverUrlFromThumb(track?.coverThumb ?? null);

const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => {
  const weight = Math.max(0, Math.min(1, amount));
  return {
    r: from.r + (to.r - from.r) * weight,
    g: from.g + (to.g - from.g) * weight,
    b: from.b + (to.b - from.b) * weight,
  };
};

const formatRgbChannels = (rgb: Rgb): string =>
  [rgb.r, rgb.g, rgb.b].map((channel) => Math.round(Math.max(0, Math.min(255, channel)))).join(', ');

const formatCssRgb = (rgb: Rgb): string => `rgb(${formatRgbChannels(rgb)})`;

const tintedMiniPlayerRgb = (sample: ReadableColorSample): Rgb => {
  const darkAnchor = { r: 21, g: 22, b: 25 };
  const darkenAmount = sample.luminance > 0.42 ? 0.58 : sample.luminance > 0.22 ? 0.46 : 0.28;
  return mixRgb(sample.averageRgb, darkAnchor, darkenAmount);
};

const miniPlayerReadableLight = { r: 255, g: 255, b: 255 };
const miniPlayerReadableLightMuted = { r: 248, g: 250, b: 252 };
const miniPlayerReadableDark = { r: 17, g: 24, b: 39 };

const getMiniPlayerReadablePalette = (backgroundRgb: Rgb): Record<string, string> => {
  const useLightText =
    contrastRatio(miniPlayerReadableLight, backgroundRgb) >= contrastRatio(miniPlayerReadableDark, backgroundRgb);

  return useLightText
    ? {
        '--lyrics-mini-player-readable-text': formatCssRgb(miniPlayerReadableLight),
        '--lyrics-mini-player-readable-muted': formatCssRgb(miniPlayerReadableLightMuted),
        '--lyrics-mini-player-readable-shadow': '0 1px 2px rgba(0, 0, 0, 0.48)',
        '--lyrics-mini-player-readable-button-bg': 'rgba(255, 255, 255, 0.10)',
        '--lyrics-mini-player-readable-button-bg-hover': 'rgba(255, 255, 255, 0.18)',
        '--lyrics-mini-player-readable-button-border': 'rgba(255, 255, 255, 0.16)',
        '--lyrics-mini-player-readable-track-bg': 'rgba(255, 255, 255, 0.24)',
        '--lyrics-mini-player-readable-track-border': 'rgba(255, 255, 255, 0.16)',
      }
    : {
        '--lyrics-mini-player-readable-text': formatCssRgb(miniPlayerReadableDark),
        '--lyrics-mini-player-readable-muted': formatCssRgb(miniPlayerReadableDark),
        '--lyrics-mini-player-readable-shadow': '0 1px 0 rgba(255, 255, 255, 0.54)',
        '--lyrics-mini-player-readable-button-bg': 'rgba(17, 24, 39, 0.08)',
        '--lyrics-mini-player-readable-button-bg-hover': 'rgba(17, 24, 39, 0.14)',
        '--lyrics-mini-player-readable-button-border': 'rgba(17, 24, 39, 0.14)',
        '--lyrics-mini-player-readable-track-bg': 'rgba(17, 24, 39, 0.18)',
        '--lyrics-mini-player-readable-track-border': 'rgba(17, 24, 39, 0.14)',
      };
};

const getDesktopLyricsForwardPositionMs = (status: AudioStatus | PlaybackStatus): number =>
  'positionSeconds' in status ? Math.round(status.positionSeconds * 1000) : status.positionMs;

const getDesktopLyricsForwardIdentity = (status: AudioStatus | PlaybackStatus): string | null =>
  status.currentTrackId ?? ('currentFilePath' in status ? status.currentFilePath : status.filePath) ?? null;

const openAudioSettingsEvent = 'app:open-audio-settings';
const openMvSettingsEvent = 'app:open-mv-settings';
const openLyricsSettingsEvent = 'app:open-lyrics-settings';
const settingsBackNavigationEvent = 'app:navigate:settings-back';
const showChromeNoticeEvent = 'app:show-chrome-notice';
const pendingRouteStorageKey = 'echo-next.pending-route';
const lyricsMiniPlayerAutoHideDistancePx = 118;
const lyricsMiniPlayerAutoHideDelayMs = 460;
const readSuppressAccountExpiryNotices = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.suppressAccountExpiryNotices === true;

const trimRateTrailingZero = (value: string): string => value.replace(/\.0$/u, '');

const formatAudioNoticeRate = (value: number): string => {
  if (value >= 1000) {
    return `${trimRateTrailingZero((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1))} kHz`;
  }

  return `${Math.round(value)} Hz`;
};

const getWindowsAudioDefaultFormatWarningRate = (warnings: string[] | null | undefined): number | null => {
  for (const warning of warnings ?? []) {
    const defaultFormatMatch = /^windows_audio_default_format_unusual:(\d+)$/u.exec(warning);
    if (defaultFormatMatch) {
      return Number(defaultFormatMatch[1]);
    }

    const sharedMixRateMatch = /^shared_output_mix_rate_too_high:\d+->(\d+)$/u.exec(warning);
    if (sharedMixRateMatch) {
      return Number(sharedMixRateMatch[1]);
    }
  }

  return null;
};

const readInitialRouteId = (routes: AppRoute[]): AppRouteId => {
  const defaultRoute = routes.find((route) => route.id === 'home') ?? routes.find((route) => route.id === 'songs') ?? routes[0];

  try {
    const pendingRoute = window.localStorage.getItem(pendingRouteStorageKey);
    if (pendingRoute && routes.some((route) => route.id === pendingRoute)) {
      window.localStorage.removeItem(pendingRouteStorageKey);
      return pendingRoute as AppRouteId;
    }
  } catch {
    // Fall back to the normal entrypoint when localStorage is unavailable.
  }

  return defaultRoute?.id ?? 'songs';
};

export const AppLayout = ({ routes }: AppLayoutProps): JSX.Element => {
  const { t } = useI18n();
  const playbackQueue = usePlaybackQueue();
  const playbackStatusSnapshot = useSharedPlaybackStatus();
  const [activeRouteId, setActiveRouteId] = useState<AppRouteId>(() => readInitialRouteId(routes));
  const [chromeNotice, setChromeNotice] = useState<string | null>(null);
  const [isChromeNoticeVisible, setIsChromeNoticeVisible] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const suppressAccountExpiryNoticesRef = useRef(false);
  const [audioErrorNotice, setAudioErrorNotice] = useState<{ message: string } | null>(null);
  const [diagnosticsNotice, setDiagnosticsNotice] = useState(false);
  const [firstRunSettings, setFirstRunSettings] = useState<AppSettings | null>(null);
  const [isFirstRunWizardOpen, setIsFirstRunWizardOpen] = useState(false);
  const [downloadsFeatureUnlocked, setDownloadsFeatureUnlocked] = useState(false);
  const [isAudioDrawerOpen, setIsAudioDrawerOpen] = useState(false);
  const [isLyricsDrawerOpen, setIsLyricsDrawerOpen] = useState(false);
  const [isMvDrawerOpen, setIsMvDrawerOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false);
  const [isWindowFullscreenTransitioning, setIsWindowFullscreenTransitioning] = useState(false);
  const [windowFullscreenTransitionTarget, setWindowFullscreenTransitionTarget] = useState<boolean | null>(null);
  const [isLyricsQueueDrawerOpen, setIsLyricsQueueDrawerOpen] = useState(false);
  const [desktopLyricsVisible, setDesktopLyricsVisible] = useState(false);
  const [desktopLyricsLocked, setDesktopLyricsLocked] = useState(false);
  const [audioDrawerStatus, setAudioDrawerStatus] = useState<AudioStatus | null>(null);
  const [audioIssueDiagnosticsWindowEnabled, setAudioIssueDiagnosticsWindowEnabled] = useState(false);
  const [signalPathControlEnabled, setSignalPathControlEnabled] = useState(false);
  const [lyricsMiniPlayerSettings, setLyricsMiniPlayerSettings] = useState<LyricsMiniPlayerSettings>(defaultLyricsMiniPlayerSettings);
  const [sidebarLayoutSettings, setSidebarLayoutSettings] = useState<SidebarLayoutSettings>(defaultSidebarLayoutSettings);
  const [lyricsMiniPlayerCoverSample, setLyricsMiniPlayerCoverSample] = useState<ReadableColorSample | null>(null);
  const [isLyricsMiniPlayerAutoHidden, setIsLyricsMiniPlayerAutoHidden] = useState(false);
  const [activeLyricsViewMode, setActiveLyricsViewMode] = useState<LyricsViewMode>(() => readRememberedLyricsViewMode());
  const lastDesktopLyricsForwardRef = useRef<string | null>(null);

  useEffect(() => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      return;
    }

    if (playbackStatusSnapshot.audioStatus) {
      const status = playbackStatusSnapshot.audioStatus;
      const positionBucket = Math.floor(getDesktopLyricsForwardPositionMs(status) / 5000);
      const logKey = `audio:${getDesktopLyricsForwardIdentity(status) ?? 'unknown'}:${status.state}:${positionBucket}`;
      if (lastDesktopLyricsForwardRef.current !== logKey) {
        lastDesktopLyricsForwardRef.current = logKey;
        logLyricsConsole('desktop.forward-clock', {
          source: 'audio',
          state: status.state,
          trackId: status.currentTrackId,
          identity: getDesktopLyricsForwardIdentity(status),
          positionMs: getDesktopLyricsForwardPositionMs(status),
          durationMs: Math.round(status.durationSeconds * 1000),
          playbackRate: status.playbackRate ?? 1,
        });
      }
      desktopLyrics.publishAudioStatus?.(playbackStatusSnapshot.audioStatus);
      return;
    }
    if (playbackStatusSnapshot.playbackStatus) {
      const status = playbackStatusSnapshot.playbackStatus;
      const positionBucket = Math.floor(getDesktopLyricsForwardPositionMs(status) / 5000);
      const logKey = `playback:${getDesktopLyricsForwardIdentity(status) ?? 'unknown'}:${status.state}:${positionBucket}`;
      if (lastDesktopLyricsForwardRef.current !== logKey) {
        lastDesktopLyricsForwardRef.current = logKey;
        logLyricsConsole('desktop.forward-clock', {
          source: 'playback',
          state: status.state,
          trackId: status.currentTrackId,
          identity: getDesktopLyricsForwardIdentity(status),
          positionMs: getDesktopLyricsForwardPositionMs(status),
          durationMs: status.durationMs,
          playbackRate: 1,
        });
      }
      desktopLyrics.publishPlaybackStatus?.(status);
    }
  }, [
    playbackStatusSnapshot.audioStatus,
    playbackStatusSnapshot.playbackStatus,
  ]);
  const [appWallpaperSettings, setAppWallpaperSettings] = useState<AppWallpaperSettings>(defaultAppWallpaperSettings);
  const [loadedAppWallpaperKey, setLoadedAppWallpaperKey] = useState<string | null>(null);
  const [isAppWallpaperDocumentHidden, setIsAppWallpaperDocumentHidden] = useState(() => document.visibilityState === 'hidden');
  const [isAppWallpaperBlurPaused, setIsAppWallpaperBlurPaused] = useState(false);
  const [isAppWallpaperPortraitViewport, setIsAppWallpaperPortraitViewport] = useState(() => isPortraitViewport());
  const appWallpaperVideoRef = useRef<HTMLVideoElement | null>(null);
  const appWallpaperBlurTimerRef = useRef<number | null>(null);
  const fullscreenTransitionTimerRef = useRef<number | null>(null);
  const fullscreenTransitionStartedAtRef = useRef(0);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lyricsMiniPlayerHostRef = useRef<HTMLDivElement | null>(null);
  const lyricsMiniPlayerAutoHideTimerRef = useRef<number | null>(null);
  const lastAudioErrorRef = useRef<string | null>(null);
  const notifiedWindowsAudioDefaultFormatKeysRef = useRef<Set<string>>(new Set());
  const previousRouteIdRef = useRef<AppRouteId>('songs');
  const routeSwitchSequenceRef = useRef(0);
  const routeSwitchTraceRef = useRef<RouteSwitchTrace | null>(null);
  const routeSwitchCommittedRouteIdRef = useRef<AppRouteId>(activeRouteId);
  const downloadImportedTrackIdsRef = useRef<Map<string, string | null>>(new Map());
  const downloadLibraryChangedTimerRef = useRef<number | null>(null);
  const notifiedUpdateKeysRef = useRef<Set<string>>(new Set());
  const visibleRoutes = useMemo(
    () =>
      applySidebarPreferences(
        routes.map((route) => (route.id === 'downloads' && !downloadsFeatureUnlocked ? { ...route, hideFromSidebar: true } : route)),
        sidebarLayoutSettings,
      ),
    [downloadsFeatureUnlocked, routes, sidebarLayoutSettings],
  );

  const startWindowFullscreenTransition = useCallback((nextFullscreen: boolean): void => {
    fullscreenTransitionStartedAtRef.current = Date.now();

    if (fullscreenTransitionTimerRef.current !== null) {
      window.clearTimeout(fullscreenTransitionTimerRef.current);
    }

    setIsWindowFullscreenTransitioning(false);
    setWindowFullscreenTransitionTarget(nextFullscreen);
    window.requestAnimationFrame(() => {
      setIsWindowFullscreenTransitioning(true);
      fullscreenTransitionTimerRef.current = window.setTimeout(() => {
        fullscreenTransitionTimerRef.current = null;
        setWindowFullscreenTransitionTarget(null);
        setIsWindowFullscreenTransitioning(false);
      }, 380);
    });
  }, []);

  useEffect(() => () => {
    if (fullscreenTransitionTimerRef.current !== null) {
      window.clearTimeout(fullscreenTransitionTimerRef.current);
      fullscreenTransitionTimerRef.current = null;
    }
    setWindowFullscreenTransitionTarget(null);
  }, []);
  const navigableRoutes = useMemo(
    () => routes.filter((route) => route.id !== 'downloads' || downloadsFeatureUnlocked),
    [downloadsFeatureUnlocked, routes],
  );
  const activeRoute = useMemo(
    () => navigableRoutes.find((route) => route.id === activeRouteId) ?? navigableRoutes[0] ?? routes[0],
    [activeRouteId, navigableRoutes, routes],
  );
  const [mountedPersistentRouteIds, setMountedPersistentRouteIds] = useState<AppRouteId[]>(() =>
    persistentRouteIds.has(activeRouteId) ? [activeRouteId] : [],
  );
  const renderedRoutes = useMemo(() => {
    const activeRouteIds = new Set<AppRouteId>();
    const nextRoutes: AppRoute[] = [];

    for (const route of navigableRoutes) {
      if (!mountedPersistentRouteIds.includes(route.id)) {
        continue;
      }

      nextRoutes.push(route);
      activeRouteIds.add(route.id);
    }

    if (activeRoute && !activeRouteIds.has(activeRoute.id)) {
      nextRoutes.push(activeRoute);
    }

    return nextRoutes;
  }, [activeRoute, mountedPersistentRouteIds, navigableRoutes]);
  const isStandaloneRoute = activeRoute.chrome === 'standalone';
  const isLyricsRoute = activeRouteId === 'lyrics';
  const shouldUseLyricsPlayerDrawer =
    isLyricsRoute &&
    (lyricsMiniPlayerSettings.lyricsPlayerBarDrawerEnabled === true ||
      (activeLyricsViewMode === 'mv' && lyricsMiniPlayerSettings.lyricsPlayerBarDrawerAutoEnableForMv !== false));
  const shouldAutoHideLyricsMiniPlayer =
    shouldUseLyricsPlayerDrawer && lyricsMiniPlayerSettings.lyricsPlayerBarDrawerAutoHideEnabled === true;
  const isLyricsMiniPlayerVisuallyHidden =
    shouldAutoHideLyricsMiniPlayer && isLyricsMiniPlayerAutoHidden && !isLyricsQueueDrawerOpen;
  const shouldRenderPlayerBar = !isStandaloneRoute || isLyricsRoute;
  const hasDesktopLyricsBridge = Boolean(window.echo?.desktopLyrics);
  const currentMiniPlayerTrack = playbackQueue.currentTrack ?? playbackQueue.lastPlayedTrack ?? null;
  const lyricsMiniPlayerCoverUrl = useMemo(
    () => miniPlayerArtworkUrl(currentMiniPlayerTrack),
    [currentMiniPlayerTrack],
  );
  const lyricsMiniPlayerStyle = useMemo<CSSProperties>(() => {
    const opacity = Math.max(0.2, Math.min(1, (lyricsMiniPlayerSettings.lyricsPlayerBarDrawerOpacityPercent ?? 78) / 100));
    const colorMode = lyricsMiniPlayerSettings.lyricsPlayerBarDrawerColorMode ?? 'default';
    const fallbackRgb = parseHexColor(defaultLyricsMiniPlayerSettings.lyricsPlayerBarDrawerColor ?? '#232120') ?? { r: 35, g: 33, b: 32 };
    const customRgb = parseHexColor(lyricsMiniPlayerSettings.lyricsPlayerBarDrawerColor) ?? fallbackRgb;
    const rgb =
      colorMode === 'cover' && lyricsMiniPlayerCoverSample
        ? tintedMiniPlayerRgb(lyricsMiniPlayerCoverSample)
        : colorMode === 'custom'
          ? customRgb
          : fallbackRgb;
    const channels = formatRgbChannels(rgb);

    return {
      '--lyrics-mini-player-opacity': opacity.toFixed(2),
      '--lyrics-mini-player-background': `rgba(${channels}, ${opacity.toFixed(2)})`,
      '--lyrics-mini-player-border': `rgba(255, 255, 255, ${Math.max(0.08, opacity * 0.2).toFixed(2)})`,
      ...getMiniPlayerReadablePalette(rgb),
    } as CSSProperties;
  }, [
    lyricsMiniPlayerCoverSample,
    lyricsMiniPlayerSettings.lyricsPlayerBarDrawerColor,
    lyricsMiniPlayerSettings.lyricsPlayerBarDrawerColorMode,
    lyricsMiniPlayerSettings.lyricsPlayerBarDrawerOpacityPercent,
  ]);
  const activeAppWallpaperPath = isAppWallpaperPortraitViewport
    ? appWallpaperSettings.appPortraitWallpaperPath ?? null
    : appWallpaperSettings.appCustomWallpaperPath;
  const activeAppWallpaperMediaType = isAppWallpaperPortraitViewport
    ? appWallpaperSettings.appPortraitWallpaperMediaType ?? inferAppWallpaperMediaType(activeAppWallpaperPath)
    : appWallpaperSettings.appWallpaperMediaType ?? inferAppWallpaperMediaType(activeAppWallpaperPath);
  const activeAppWallpaperOrientation = isAppWallpaperPortraitViewport ? 'portrait' : 'landscape';
  const appWallpaperUrl = activeAppWallpaperPath
    ? `echo-wallpaper://${isAppWallpaperPortraitViewport ? 'app-portrait' : 'app'}/custom?path=${encodeURIComponent(activeAppWallpaperPath)}`
    : null;
  const shouldShowAppWallpaperVisual = Boolean(appWallpaperUrl && !isLyricsRoute);
  const isAppWallpaperVideo = activeAppWallpaperMediaType === 'video';
  const appWallpaperKey = appWallpaperUrl
    ? `${activeAppWallpaperOrientation}:${activeAppWallpaperMediaType}:${appWallpaperUrl}`
    : null;
  const isAppWallpaperReady = Boolean(appWallpaperKey && loadedAppWallpaperKey === appWallpaperKey);
  const shouldPauseAppWallpaperVideo = Boolean(
    isAppWallpaperVideo &&
    appWallpaperUrl &&
    (!shouldShowAppWallpaperVisual ||
      (appWallpaperSettings.appVideoWallpaperPauseMode !== 'never' &&
        (isAppWallpaperDocumentHidden ||
          (appWallpaperSettings.appVideoWallpaperPauseMode !== 'minimized' && isAppWallpaperBlurPaused)))),
  );
  const appWallpaperRawUiAlpha = isAppWallpaperReady
    ? Math.max(0, Math.min(1, appWallpaperSettings.appWallpaperUiOpacityPercent / 100))
    : 1;
  const isAppWallpaperUiTransparent =
    isAppWallpaperReady &&
    !appWallpaperSettings.appWallpaperVisualProtectionEnabled &&
    appWallpaperRawUiAlpha <= 0;
  const isAppWallpaperUiZero = isAppWallpaperReady && appWallpaperRawUiAlpha <= 0;
  const appWallpaperStyle = useMemo<CSSProperties>(() => {
    const blurPx = isAppWallpaperVideo
      ? Math.min(appWallpaperSettings.appWallpaperBlurPx, 12)
      : appWallpaperSettings.appWallpaperBlurPx;
    const brightnessPercent = appWallpaperSettings.appWallpaperBrightnessPercent;
    const baseScale = appWallpaperSettings.appWallpaperScalePercent / 100;
    const blurOverscanScale = blurPx > 0 ? Math.min(0.18, blurPx * 0.004) : 0;
    const filterParts = [
      blurPx > 0 ? `blur(${blurPx}px)` : null,
      brightnessPercent !== 100 ? `brightness(${brightnessPercent}%)` : null,
    ].filter(Boolean);

    return {
      filter: filterParts.length ? filterParts.join(' ') : 'none',
      transform: `scale(${(baseScale + blurOverscanScale).toFixed(3)})`,
    };
  }, [
    appWallpaperSettings.appWallpaperBlurPx,
    appWallpaperSettings.appWallpaperBrightnessPercent,
    appWallpaperSettings.appWallpaperScalePercent,
    isAppWallpaperVideo,
  ]);
  const appShellStyle = useMemo(() => {
    const uiAlpha =
      isAppWallpaperReady && appWallpaperSettings.appWallpaperVisualProtectionEnabled
        ? Math.max(appWallpaperRawUiAlpha, 0.36)
        : appWallpaperRawUiAlpha;
    const blurAlpha = appWallpaperRawUiAlpha > 0 ? Math.max(uiAlpha, 0.45) : uiAlpha;
    const isUnified = isAppWallpaperReady && appWallpaperSettings.appWallpaperUnifiedOpacityEnabled;
    const scaledAlpha = (value: number): string => (uiAlpha * value).toFixed(3);
    const unifiedAlpha = uiAlpha.toFixed(3);

    return {
      '--app-wallpaper-ui-unified-alpha': unifiedAlpha,
      '--app-wallpaper-ui-border-alpha': isUnified ? '0' : scaledAlpha(0.2),
      '--app-wallpaper-ui-titlebar-alpha': isUnified ? unifiedAlpha : scaledAlpha(0.74),
      '--app-wallpaper-ui-sidebar-top-alpha': isUnified ? unifiedAlpha : scaledAlpha(0.58),
      '--app-wallpaper-ui-sidebar-mid-alpha': isUnified ? unifiedAlpha : scaledAlpha(0.62),
      '--app-wallpaper-ui-sidebar-bottom-alpha': isUnified ? unifiedAlpha : scaledAlpha(0.72),
      '--app-wallpaper-ui-sidebar-base-alpha': isUnified ? unifiedAlpha : scaledAlpha(0.68),
      '--app-wallpaper-ui-page-top-alpha': isUnified ? unifiedAlpha : scaledAlpha(0.28),
      '--app-wallpaper-ui-page-bottom-alpha': isUnified ? unifiedAlpha : scaledAlpha(0.74),
      '--app-wallpaper-ui-page-base-alpha': isUnified ? unifiedAlpha : scaledAlpha(0.62),
      '--app-wallpaper-ui-player-alpha': isUnified ? unifiedAlpha : scaledAlpha(0.78),
      '--app-wallpaper-ui-soft-shadow-alpha': isUnified ? '0' : scaledAlpha(0.08),
      '--app-wallpaper-ui-player-shadow-alpha': isUnified ? '0' : scaledAlpha(0.045),
      '--app-wallpaper-ui-inset-alpha': isUnified ? '0' : scaledAlpha(0.82),
      '--app-wallpaper-ui-titlebar-blur': `${(blurAlpha * 18).toFixed(1)}px`,
      '--app-wallpaper-ui-sidebar-blur': `${(blurAlpha * (isUnified ? 18 : 24)).toFixed(1)}px`,
      '--app-wallpaper-ui-surface-blur': `${(blurAlpha * 18).toFixed(1)}px`,
    } as CSSProperties;
  }, [
    appWallpaperRawUiAlpha,
    appWallpaperSettings.appWallpaperVisualProtectionEnabled,
    appWallpaperSettings.appWallpaperUnifiedOpacityEnabled,
    isAppWallpaperReady,
  ]);

  useEffect(() => {
    let cancelled = false;
    const appApi = window.echo?.app;

    void appApi?.isMaximized?.()
      .then((maximized) => {
        if (!cancelled) {
          setIsWindowMaximized(maximized);
        }
      })
      .catch(() => undefined);
    void appApi?.isFullscreen?.()
      .then((fullscreen) => {
        if (!cancelled) {
          setIsWindowFullscreen(fullscreen);
        }
      })
      .catch(() => undefined);

    const unsubscribe = appApi?.onMaximizedChange?.((maximized) => {
      setIsWindowMaximized(maximized);
    });
    const unsubscribeFullscreen = appApi?.onFullscreenChange?.((fullscreen) => {
      if (Date.now() - fullscreenTransitionStartedAtRef.current > 420) {
        startWindowFullscreenTransition(fullscreen);
      }
      setIsWindowFullscreen(fullscreen);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      unsubscribeFullscreen?.();
    };
  }, [startWindowFullscreenTransition]);

  useEffect(() => {
    let cancelled = false;

    const applyFirstRunSettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!settings || !Object.prototype.hasOwnProperty.call(settings, 'onboardingCompleted')) {
        return;
      }

      setFirstRunSettings((current) => ({ ...(current ?? {}), ...settings }) as AppSettings);
      setIsFirstRunWizardOpen(settings.onboardingCompleted === false);
    };

    const loadFirstRunSettings = (): void => {
      void window.echo?.app?.getSettings?.()
        .then((settings) => {
          if (!cancelled) {
            applyFirstRunSettings(settings);
          }
        })
        .catch(() => undefined);
    };

    const handleSettingsChanged = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail && typeof event.detail === 'object') {
        applyFirstRunSettings(event.detail as Partial<AppSettings>);
        return;
      }

      if (!cancelled) {
        loadFirstRunSettings();
      }
    };

    loadFirstRunSettings();
    window.addEventListener('settings:changed', handleSettingsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!settings) {
        return;
      }

      if (Object.prototype.hasOwnProperty.call(settings, 'downloadsFeatureUnlocked')) {
        setDownloadsFeatureUnlocked(settings.downloadsFeatureUnlocked === true);
      }

      const hasSidebarRouteOrder = Object.prototype.hasOwnProperty.call(settings, 'sidebarRouteOrder');
      const hasSidebarHiddenRouteIds = Object.prototype.hasOwnProperty.call(settings, 'sidebarHiddenRouteIds');
      const hasSidebarAutoHideEnabled = Object.prototype.hasOwnProperty.call(settings, 'sidebarAutoHideEnabled');
      if (hasSidebarRouteOrder || hasSidebarHiddenRouteIds || hasSidebarAutoHideEnabled) {
        setSidebarLayoutSettings((current) => ({
          sidebarRouteOrder: hasSidebarRouteOrder ? normalizeSidebarRouteOrder(settings.sidebarRouteOrder) : current.sidebarRouteOrder,
          sidebarHiddenRouteIds: hasSidebarHiddenRouteIds ? normalizeSidebarHiddenRouteIds(settings.sidebarHiddenRouteIds) : current.sidebarHiddenRouteIds,
          sidebarAutoHideEnabled: hasSidebarAutoHideEnabled ? settings.sidebarAutoHideEnabled === true : current.sidebarAutoHideEnabled,
        }));
      }
    };

    const refreshSettings = (): void => {
      void window.echo?.app?.getSettings?.()
        .then((settings) => {
          if (!cancelled) {
            applySettings(settings);
          }
        })
        .catch(() => undefined);
    };

    const handleSettingsChanged = (event: Event): void => {
      if (event instanceof CustomEvent) {
        applySettings(event.detail as Partial<AppSettings> | null | undefined);
        return;
      }

      if (!cancelled) {
        refreshSettings();
      }
    };

    refreshSettings();
    window.addEventListener('settings:changed', handleSettingsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!settings || !Object.prototype.hasOwnProperty.call(settings, 'audioIssueDiagnosticsWindowEnabled')) {
        return;
      }

      setAudioIssueDiagnosticsWindowEnabled(settings.audioIssueDiagnosticsWindowEnabled === true);
    };

    const refreshSettings = (): void => {
      void window.echo?.app?.getSettings?.()
        .then((settings) => {
          if (!cancelled) {
            applySettings(settings);
          }
        })
        .catch(() => undefined);
    };

    const handleSettingsChanged = (event: Event): void => {
      if (event instanceof CustomEvent) {
        applySettings(event.detail as Partial<AppSettings> | null | undefined);
        return;
      }

      if (!cancelled) {
        refreshSettings();
      }
    };

    refreshSettings();
    window.addEventListener('settings:changed', handleSettingsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!settings || !Object.prototype.hasOwnProperty.call(settings, 'signalPathControlEnabled')) {
        return;
      }

      setSignalPathControlEnabled(settings.signalPathControlEnabled === true);
    };

    const refreshSettings = (): void => {
      void window.echo?.app?.getSettings?.()
        .then((settings) => {
          if (!cancelled) {
            applySettings(settings);
          }
        })
        .catch(() => undefined);
    };

    const handleSettingsChanged = (event: Event): void => {
      if (event instanceof CustomEvent) {
        applySettings(event.detail as Partial<AppSettings> | null | undefined);
        return;
      }

      if (!cancelled) {
        refreshSettings();
      }
    };

    refreshSettings();
    window.addEventListener('settings:changed', handleSettingsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    const syncWallpaperOrientation = (): void => {
      setIsAppWallpaperPortraitViewport(isPortraitViewport());
    };

    syncWallpaperOrientation();
    window.addEventListener('resize', syncWallpaperOrientation);
    window.visualViewport?.addEventListener('resize', syncWallpaperOrientation);

    return () => {
      window.removeEventListener('resize', syncWallpaperOrientation);
      window.visualViewport?.removeEventListener('resize', syncWallpaperOrientation);
    };
  }, []);

  useEffect(() => {
    if (!appWallpaperKey) {
      setLoadedAppWallpaperKey(null);
      return;
    }

    setLoadedAppWallpaperKey((current) => (current === appWallpaperKey ? current : null));
  }, [appWallpaperKey]);

  useEffect(() => {
    const handleVisibilityChange = (): void => {
      setIsAppWallpaperDocumentHidden(document.visibilityState === 'hidden');
    };
    const handleWindowBlur = (): void => {
      if (appWallpaperBlurTimerRef.current !== null) {
        window.clearTimeout(appWallpaperBlurTimerRef.current);
      }
      appWallpaperBlurTimerRef.current = window.setTimeout(() => {
        appWallpaperBlurTimerRef.current = null;
        setIsAppWallpaperBlurPaused(true);
      }, 15000);
    };
    const handleWindowFocus = (): void => {
      if (appWallpaperBlurTimerRef.current !== null) {
        window.clearTimeout(appWallpaperBlurTimerRef.current);
        appWallpaperBlurTimerRef.current = null;
      }
      setIsAppWallpaperBlurPaused(false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      if (appWallpaperBlurTimerRef.current !== null) {
        window.clearTimeout(appWallpaperBlurTimerRef.current);
        appWallpaperBlurTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const video = appWallpaperVideoRef.current;
    if (!video || !isAppWallpaperVideo || !appWallpaperUrl) {
      return;
    }

    const hasReadyFrame = video.readyState >= 2 || (appWallpaperKey !== null && loadedAppWallpaperKey === appWallpaperKey);

    if (shouldPauseAppWallpaperVideo && hasReadyFrame) {
      video.pause();
      return;
    }

    if (shouldPauseAppWallpaperVideo && (!shouldShowAppWallpaperVisual || isAppWallpaperDocumentHidden)) {
      video.pause();
      return;
    }

    if (hasReadyFrame && appWallpaperKey && loadedAppWallpaperKey !== appWallpaperKey) {
      setLoadedAppWallpaperKey(appWallpaperKey);
    }

    try {
      const playResult = video.play();
      if (playResult && typeof playResult.catch === 'function') {
        void playResult.catch(() => {
          // Muted background video autoplay is best-effort; keep the UI usable if Chromium refuses.
        });
      }
    } catch {
      // Some test/runtime environments expose media elements without playback support.
    }
  }, [
    appWallpaperKey,
    appWallpaperUrl,
    isAppWallpaperDocumentHidden,
    isAppWallpaperVideo,
    loadedAppWallpaperKey,
    shouldPauseAppWallpaperVideo,
    shouldShowAppWallpaperVisual,
  ]);

  const getRouteSwitchPlaybackDetails = useCallback((): Record<string, unknown> => {
    const audioStatus = playbackStatusSnapshot.audioStatus;
    const playbackStatus = playbackStatusSnapshot.playbackStatus;

    return {
      playbackState: audioStatus?.state ?? playbackStatus?.state,
      outputMode: audioStatus?.outputMode,
      trackId: audioStatus?.currentTrackId ?? playbackStatus?.currentTrackId,
      audioBackend: audioStatus?.activeOutputBackendImpl ?? audioStatus?.outputBackend,
      error: playbackStatusSnapshot.error ?? audioStatus?.error,
    };
  }, [
    playbackStatusSnapshot.audioStatus?.activeOutputBackendImpl,
    playbackStatusSnapshot.audioStatus?.currentTrackId,
    playbackStatusSnapshot.audioStatus?.error,
    playbackStatusSnapshot.audioStatus?.outputBackend,
    playbackStatusSnapshot.audioStatus?.outputMode,
    playbackStatusSnapshot.audioStatus?.state,
    playbackStatusSnapshot.error,
    playbackStatusSnapshot.playbackStatus?.currentTrackId,
    playbackStatusSnapshot.playbackStatus?.state,
  ]);

  const beginRouteSwitchTrace = useCallback(
    (routeId: AppRouteId, trigger: string): void => {
      const sequence = routeSwitchSequenceRef.current + 1;
      routeSwitchSequenceRef.current = sequence;
      const trace: RouteSwitchTrace = {
        sequence,
        from: activeRouteId,
        to: routeId,
        trigger,
        startedAtMs: performance.now(),
      };
      routeSwitchTraceRef.current = trace;

      logRouteSwitchDiagnostic('start', {
        sequence,
        from: trace.from,
        to: trace.to,
        trigger,
        ...getRouteSwitchPlaybackDetails(),
      });
    },
    [activeRouteId, getRouteSwitchPlaybackDetails],
  );

  const navigateRoute = useCallback(
    (routeId: AppRouteId, trigger = 'navigateRoute'): void => {
      if (routeId === activeRouteId) {
        logRouteSwitchDiagnostic('start', {
          from: activeRouteId,
          to: routeId,
          trigger,
          result: 'same-route',
          ...getRouteSwitchPlaybackDetails(),
        });
        return;
      }

      if (routeId === 'lyrics' && activeRouteId !== 'lyrics') {
        previousRouteIdRef.current = activeRouteId;
      }

      if (routeId !== 'lyrics') {
        setIsLyricsQueueDrawerOpen(false);
      }

      beginRouteSwitchTrace(routeId, trigger);
      setActiveRouteId(routeId);
    },
    [activeRouteId, beginRouteSwitchTrace, getRouteSwitchPlaybackDetails],
  );

  useEffect(() => {
    const previousCommittedRouteId = routeSwitchCommittedRouteIdRef.current;
    if (previousCommittedRouteId === activeRouteId) {
      return;
    }

    const trace = routeSwitchTraceRef.current;
    const playbackDetails = getRouteSwitchPlaybackDetails();

    if (trace && trace.to === activeRouteId) {
      logRouteSwitchDiagnostic('end', {
        sequence: trace.sequence,
        from: trace.from,
        to: trace.to,
        trigger: trace.trigger,
        durationMs: performance.now() - trace.startedAtMs,
        ...playbackDetails,
      });
      routeSwitchTraceRef.current = null;
    } else {
      logRouteSwitchDiagnostic('end', {
        from: previousCommittedRouteId,
        to: activeRouteId,
        trigger: 'external-setActiveRouteId',
        durationMs: 0,
        ...playbackDetails,
      });
    }

    routeSwitchCommittedRouteIdRef.current = activeRouteId;
  }, [activeRouteId, getRouteSwitchPlaybackDetails]);

  useEffect(() => {
    if (!downloadsFeatureUnlocked && activeRouteId === 'downloads') {
      navigateRoute('songs', 'downloads-locked');
    }
  }, [activeRouteId, downloadsFeatureUnlocked, navigateRoute]);

  const setLyricsViewMode = useCallback((mode: LyricsViewMode): void => {
    rememberLyricsViewMode(mode);
    setActiveLyricsViewMode(mode);
  }, []);

  const handleOpenLyricsQueueDrawer = useCallback((): void => {
    setIsLyricsQueueDrawerOpen(true);
  }, []);

  const handleOpenShellQueue = useCallback((): void => {
    navigateRoute('queue');
  }, [navigateRoute]);

  const handleOpenFullQueueFromLyricsDrawer = useCallback((): void => {
    navigateRoute('queue');
  }, [navigateRoute]);

  const dismissChromeNotice = useCallback((): void => {
    setIsChromeNoticeVisible(false);
  }, []);

  useEffect(() => {
    if (!persistentRouteIds.has(activeRouteId)) {
      return;
    }

    setMountedPersistentRouteIds((current) => (current.includes(activeRouteId) ? current : [...current, activeRouteId]));
  }, [activeRouteId]);

  useEffect(() => {
    const folderInput = folderInputRef.current;

    if (!folderInput) {
      return;
    }

    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    void window.echo?.diagnostics
      ?.getLastCrashSummary()
      .then((summary) => setDiagnosticsNotice(Boolean(summary)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!chromeNotice) {
      return undefined;
    }

    setIsChromeNoticeVisible(true);

    const timer = window.setTimeout(() => {
      setIsChromeNoticeVisible(false);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [chromeNotice]);

  useEffect(() => {
    if (!chromeNotice || isChromeNoticeVisible) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setChromeNotice(null);
    }, 220);

    return () => window.clearTimeout(timer);
  }, [chromeNotice, isChromeNoticeVisible]);

  useEffect(() => {
    const handleShowChromeNotice = (event: Event): void => {
      const message = (event as CustomEvent<string>).detail;
      if (typeof message === 'string' && message.trim()) {
        setChromeNotice((current) => (current === message ? current : message));
      }
    };

    window.addEventListener(showChromeNoticeEvent, handleShowChromeNotice);
    return () => window.removeEventListener(showChromeNoticeEvent, handleShowChromeNotice);
  }, []);

  useEffect(() => {
    if (!accountNotice) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setAccountNotice(null);
    }, 6200);

    return () => window.clearTimeout(timer);
  }, [accountNotice]);

  useEffect(() => {
    let cancelled = false;

    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!settings || !Object.prototype.hasOwnProperty.call(settings, 'suppressAccountExpiryNotices')) {
        return;
      }

      const suppressed = readSuppressAccountExpiryNotices(settings);
      suppressAccountExpiryNoticesRef.current = suppressed;
      if (suppressed) {
        setAccountNotice(null);
      }
    };

    const refreshSettings = (): void => {
      void window.echo?.app?.getSettings?.().then((settings) => {
        if (!cancelled) {
          applySettings(settings);
        }
      }).catch(() => undefined);
    };

    refreshSettings();

    const handleSettingsChanged = (event: Event): void => {
      if (event instanceof CustomEvent) {
        applySettings(event.detail as Partial<AppSettings> | null | undefined);
        return;
      }

      if (!cancelled) {
        refreshSettings();
      }
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.echo?.accounts?.onStatusesChanged?.((statuses: AccountStatus[]) => {
      if (suppressAccountExpiryNoticesRef.current) {
        return;
      }

      const disconnected = statuses.filter((status) => !status.connected && Boolean(status.error));

      if (disconnected.length === 0) {
        return;
      }

      const names = disconnected.map((status) => t(accountProviderLabelKeys[status.provider] ?? 'accountProvider.unknown'));
      setAccountNotice(t('notice.accountExpired', { names: names.join(t('punctuation.listSeparator')) }));
    });

    return () => unsubscribe?.();
  }, [t]);

  useEffect(() => {
    const rawError = playbackStatusSnapshot.audioStatus?.error ?? playbackStatusSnapshot.error;

    if (!rawError || rawError === 'Desktop bridge unavailable') {
      return;
    }

    if (isSpotifyPlaybackSetupError(rawError)) {
      return;
    }

    if (lastAudioErrorRef.current === rawError) {
      return;
    }

    lastAudioErrorRef.current = rawError;
    setAudioErrorNotice({
      message: formatAudioHostError(rawError) ?? rawError,
    });
  }, [playbackStatusSnapshot.audioStatus?.error, playbackStatusSnapshot.error]);

  useEffect(() => {
    const rate = getWindowsAudioDefaultFormatWarningRate(playbackStatusSnapshot.audioStatus?.warnings);
    if (!rate || !Number.isFinite(rate)) {
      return;
    }

    const noticeKey = `windows-default-format:${Math.round(rate)}`;
    if (notifiedWindowsAudioDefaultFormatKeysRef.current.has(noticeKey)) {
      return;
    }

    notifiedWindowsAudioDefaultFormatKeysRef.current.add(noticeKey);
    setChromeNotice(t('notice.audioDefaultFormatWarning', { rate: formatAudioNoticeRate(rate) }));
  }, [playbackStatusSnapshot.audioStatus?.warnings, t]);

  useEffect(() => {
    const rawError = playbackStatusSnapshot.audioStatus?.error ?? playbackStatusSnapshot.error;
    const latestState = playbackStatusSnapshot.audioStatus?.state ?? playbackStatusSnapshot.playbackStatus?.state ?? null;

    if (rawError || !audioErrorNotice || latestState === 'error') {
      return;
    }

    lastAudioErrorRef.current = null;
    setAudioErrorNotice(null);
  }, [
    audioErrorNotice,
    playbackStatusSnapshot.audioStatus?.error,
    playbackStatusSnapshot.audioStatus?.state,
    playbackStatusSnapshot.error,
    playbackStatusSnapshot.playbackStatus?.state,
  ]);

  useEffect(() => {
    if (!audioErrorNotice) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setAudioErrorNotice(null);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [audioErrorNotice]);

  useEffect(() => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      setDesktopLyricsVisible(false);
      setDesktopLyricsLocked(false);
      return undefined;
    }

    void desktopLyrics.getState()
      .then((state) => {
        setDesktopLyricsVisible(state.visible === true);
        setDesktopLyricsLocked(state.locked === true);
      })
      .catch(() => {
        setDesktopLyricsVisible(false);
        setDesktopLyricsLocked(false);
      });

    const unsubscribe = desktopLyrics.onStateChanged?.((state) => {
      setDesktopLyricsVisible(state.visible === true);
      setDesktopLyricsLocked(state.locked === true);
    });

    return () => unsubscribe?.();
  }, [hasDesktopLyricsBridge]);

  useEffect(() => {
    const notifyUpdateStatus = (status: UpdateStatus): void => {
      if (status.state !== 'available' && status.state !== 'downloaded') {
        return;
      }

      const version = status.latestVersion ?? status.releaseName ?? '';
      const noticeKey = `${status.state}:${version || status.checkedAt || 'unknown'}`;
      if (notifiedUpdateKeysRef.current.has(noticeKey)) {
        return;
      }

      notifiedUpdateKeysRef.current.add(noticeKey);
      if (status.state === 'downloaded') {
        setChromeNotice(version ? t('notice.updateDownloadedVersion', { version }) : t('notice.updateDownloaded'));
        return;
      }

      setChromeNotice(version ? t('notice.updateAvailableVersion', { version }) : t('notice.updateAvailable'));
    };

    const unsubscribe = window.echo?.app?.onUpdateStatus?.(notifyUpdateStatus);
    void window.echo?.app?.getUpdateStatus?.().then(notifyUpdateStatus).catch(() => undefined);

    return () => unsubscribe?.();
  }, [t]);

  useEffect(() => {
    let cancelled = false;

    const refreshLyricsMiniPlayerSettings = (event?: Event): void => {
      const patch = (event as CustomEvent<Partial<AppSettings>> | undefined)?.detail;
      if (
        patch &&
        ('lyricsPlayerBarDrawerEnabled' in patch ||
          'lyricsPlayerBarDrawerAutoEnableForMv' in patch ||
          'lyricsPlayerBarDrawerAutoHideEnabled' in patch ||
          'lyricsPlayerBarDrawerOpacityPercent' in patch ||
          'lyricsPlayerBarDrawerColorMode' in patch ||
          'lyricsPlayerBarDrawerColor' in patch)
      ) {
        setLyricsMiniPlayerSettings((current) => selectLyricsMiniPlayerSettings({ ...current, ...patch }));
        return;
      }

      void window.echo?.app
        ?.getSettings?.()
        .then((settings) => {
          if (!cancelled) {
            setLyricsMiniPlayerSettings(selectLyricsMiniPlayerSettings(settings));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLyricsMiniPlayerSettings(defaultLyricsMiniPlayerSettings);
          }
        });
    };

    refreshLyricsMiniPlayerSettings();
    window.addEventListener('settings:changed', refreshLyricsMiniPlayerSettings);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', refreshLyricsMiniPlayerSettings);
    };
  }, []);

  useEffect(() => {
    if (!shouldAutoHideLyricsMiniPlayer) {
      if (lyricsMiniPlayerAutoHideTimerRef.current !== null) {
        window.clearTimeout(lyricsMiniPlayerAutoHideTimerRef.current);
        lyricsMiniPlayerAutoHideTimerRef.current = null;
      }
      setIsLyricsMiniPlayerAutoHidden(false);
      return undefined;
    }

    let animationFrame = 0;
    let disposed = false;

    const revealMiniPlayer = (): void => {
      if (lyricsMiniPlayerAutoHideTimerRef.current !== null) {
        window.clearTimeout(lyricsMiniPlayerAutoHideTimerRef.current);
        lyricsMiniPlayerAutoHideTimerRef.current = null;
      }
      setIsLyricsMiniPlayerAutoHidden((hidden) => (hidden ? false : hidden));
    };

    const isNearMiniPlayer = (clientX: number, clientY: number): boolean => {
      const host = lyricsMiniPlayerHostRef.current;
      const hostWidth = host?.offsetWidth ?? Math.min(820, Math.max(0, window.innerWidth - 96));
      const hostHeight = host?.offsetHeight ?? 72;
      const halfWidth = Math.min(window.innerWidth, hostWidth) / 2;
      const left = window.innerWidth / 2 - halfWidth - lyricsMiniPlayerAutoHideDistancePx;
      const right = window.innerWidth / 2 + halfWidth + lyricsMiniPlayerAutoHideDistancePx;
      const top = window.innerHeight - hostHeight - lyricsMiniPlayerAutoHideDistancePx - 48;

      return clientX >= left && clientX <= right && clientY >= top;
    };

    const scheduleHideMiniPlayer = (): void => {
      const host = lyricsMiniPlayerHostRef.current;
      if (isLyricsQueueDrawerOpen || (host && host.contains(document.activeElement))) {
        revealMiniPlayer();
        return;
      }
      if (lyricsMiniPlayerAutoHideTimerRef.current !== null) {
        return;
      }

      lyricsMiniPlayerAutoHideTimerRef.current = window.setTimeout(() => {
        lyricsMiniPlayerAutoHideTimerRef.current = null;
        if (!disposed) {
          setIsLyricsMiniPlayerAutoHidden(true);
        }
      }, lyricsMiniPlayerAutoHideDelayMs);
    };

    const handleMouseMove = (event: MouseEvent): void => {
      const { clientX, clientY } = event;
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        if (isNearMiniPlayer(clientX, clientY)) {
          revealMiniPlayer();
        } else {
          scheduleHideMiniPlayer();
        }
      });
    };

    const handleFocusIn = (event: FocusEvent): void => {
      const host = lyricsMiniPlayerHostRef.current;
      if (host && event.target instanceof Node && host.contains(event.target)) {
        revealMiniPlayer();
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('resize', revealMiniPlayer);

    return () => {
      disposed = true;
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (lyricsMiniPlayerAutoHideTimerRef.current !== null) {
        window.clearTimeout(lyricsMiniPlayerAutoHideTimerRef.current);
        lyricsMiniPlayerAutoHideTimerRef.current = null;
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('resize', revealMiniPlayer);
    };
  }, [isLyricsQueueDrawerOpen, shouldAutoHideLyricsMiniPlayer]);

  useEffect(() => {
    if (
      !shouldUseLyricsPlayerDrawer ||
      lyricsMiniPlayerSettings.lyricsPlayerBarDrawerColorMode !== 'cover' ||
      !lyricsMiniPlayerCoverUrl
    ) {
      setLyricsMiniPlayerCoverSample(null);
      return undefined;
    }

    let disposed = false;
    setLyricsMiniPlayerCoverSample(null);
    void sampleImageUrl(lyricsMiniPlayerCoverUrl).then((sample) => {
      if (!disposed) {
        setLyricsMiniPlayerCoverSample(sample);
      }
    });

    return () => {
      disposed = true;
    };
  }, [
    lyricsMiniPlayerCoverUrl,
    lyricsMiniPlayerSettings.lyricsPlayerBarDrawerColorMode,
    shouldUseLyricsPlayerDrawer,
  ]);

  useEffect(() => {
    let cancelled = false;

    const refreshAppWallpaperSetting = (event?: Event): void => {
      const patch = (event as CustomEvent<Partial<AppSettings>> | undefined)?.detail;
      if (
        patch &&
        ('appCustomWallpaperPath' in patch ||
          'appPortraitWallpaperPath' in patch ||
          'appWallpaperMediaType' in patch ||
          'appPortraitWallpaperMediaType' in patch ||
          'appWallpaperScalePercent' in patch ||
          'appWallpaperBlurPx' in patch ||
          'appWallpaperBrightnessPercent' in patch ||
          'appWallpaperUiOpacityPercent' in patch ||
          'appWallpaperVisualProtectionEnabled' in patch ||
          'appWallpaperUnifiedOpacityEnabled' in patch ||
          'appVideoWallpaperPauseMode' in patch)
      ) {
        setAppWallpaperSettings((current) => ({
          appCustomWallpaperPath: 'appCustomWallpaperPath' in patch ? (patch.appCustomWallpaperPath ?? null) : current.appCustomWallpaperPath,
          appPortraitWallpaperPath: 'appPortraitWallpaperPath' in patch
            ? (patch.appPortraitWallpaperPath ?? null)
            : current.appPortraitWallpaperPath,
          appWallpaperMediaType: 'appWallpaperMediaType' in patch
            ? (patch.appWallpaperMediaType ?? defaultAppWallpaperSettings.appWallpaperMediaType)
            : current.appWallpaperMediaType,
          appPortraitWallpaperMediaType: 'appPortraitWallpaperMediaType' in patch
            ? (patch.appPortraitWallpaperMediaType ?? defaultAppWallpaperSettings.appPortraitWallpaperMediaType)
            : current.appPortraitWallpaperMediaType,
          appWallpaperScalePercent: 'appWallpaperScalePercent' in patch
            ? (patch.appWallpaperScalePercent ?? defaultAppWallpaperSettings.appWallpaperScalePercent)
            : current.appWallpaperScalePercent,
          appWallpaperBlurPx: 'appWallpaperBlurPx' in patch
            ? (patch.appWallpaperBlurPx ?? defaultAppWallpaperSettings.appWallpaperBlurPx)
            : current.appWallpaperBlurPx,
          appWallpaperBrightnessPercent: 'appWallpaperBrightnessPercent' in patch
            ? (patch.appWallpaperBrightnessPercent ?? defaultAppWallpaperSettings.appWallpaperBrightnessPercent)
            : current.appWallpaperBrightnessPercent,
          appWallpaperUiOpacityPercent: 'appWallpaperUiOpacityPercent' in patch
            ? (patch.appWallpaperUiOpacityPercent ?? defaultAppWallpaperSettings.appWallpaperUiOpacityPercent)
            : current.appWallpaperUiOpacityPercent,
          appWallpaperVisualProtectionEnabled: 'appWallpaperVisualProtectionEnabled' in patch
            ? (patch.appWallpaperVisualProtectionEnabled !== false)
            : current.appWallpaperVisualProtectionEnabled,
          appWallpaperUnifiedOpacityEnabled: 'appWallpaperUnifiedOpacityEnabled' in patch
            ? (patch.appWallpaperUnifiedOpacityEnabled === true)
            : current.appWallpaperUnifiedOpacityEnabled,
          appVideoWallpaperPauseMode: 'appVideoWallpaperPauseMode' in patch
            ? (patch.appVideoWallpaperPauseMode ?? defaultAppWallpaperSettings.appVideoWallpaperPauseMode)
            : current.appVideoWallpaperPauseMode,
        }));
        return;
      }

      void window.echo?.app
        ?.getSettings?.()
        .then((settings) => {
          if (!cancelled) {
            setAppWallpaperSettings(selectAppWallpaperSettings(settings));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAppWallpaperSettings(defaultAppWallpaperSettings);
          }
        });
    };

    refreshAppWallpaperSetting();
    window.addEventListener('settings:changed', refreshAppWallpaperSetting);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', refreshAppWallpaperSetting);
    };
  }, []);

  useEffect(() => {
    const handleNavigateRoute = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (typeof detail !== 'string' || !routes.some((route) => route.id === detail)) {
        return;
      }

      navigateRoute(detail as AppRouteId);
    };
    const handleNavigateImportFolder = (): void => {
      navigateRoute('import-folder');
    };
    const handleNavigateQueue = (): void => {
      navigateRoute('queue');
    };
    const handleNavigateSongs = (event: Event): void => {
      const remoteSourceId = readSongsNavigationRemoteSourceId(event);
      navigateRoute('songs');
      if (remoteSourceId) {
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('library:show-remote-source', { detail: { sourceId: remoteSourceId } }));
        }, 0);
      }
    };
    const handleNavigateSettings = (): void => {
      navigateRoute('settings');
    };
    const handleNavigateSettingsBack = (): void => {
      if (activeRouteId !== 'settings') {
        return;
      }

      const targetRouteId =
        navigableRoutes.find((route) => route.id === 'home')?.id ??
        navigableRoutes.find((route) => route.id === 'songs')?.id ??
        navigableRoutes.find((route) => route.id !== 'settings')?.id ??
        null;

      if (targetRouteId) {
        navigateRoute(targetRouteId, 'settings-back');
      }
    };
    const handleNavigatePlugins = (): void => {
      navigateRoute('plugins');
    };
    const handleNavigateDsp = (): void => {
      navigateRoute('dsp');
    };
    const handleNavigateNowPlaying = (): void => {
      navigateRoute('queue');
    };
    const handleNavigateLyrics = (event: Event): void => {
      const detail = event instanceof CustomEvent ? (event.detail as LyricsNavigationDetail | null) : null;
      if (isLyricsViewMode(detail?.mode)) {
        if (activeRouteId === 'lyrics') {
          if (activeLyricsViewMode === detail.mode) {
            navigateRoute(previousRouteIdRef.current, 'lyrics-toggle-back');
            return;
          }

          setLyricsViewMode(detail.mode);
          return;
        }

        setLyricsViewMode(detail.mode);
        navigateRoute('lyrics');
        return;
      }

      if (activeRouteId === 'lyrics') {
        navigateRoute(previousRouteIdRef.current, 'lyrics-toggle-back');
        return;
      }

      navigateRoute('lyrics');
    };
    const handleNavigateLyricsBack = (): void => {
      navigateRoute(previousRouteIdRef.current, 'lyrics-back');
    };
    const handleNavigateAlbumDetail = (): void => {
      navigateRoute('albums');
    };
    const handleNavigateArtistDetail = (): void => {
      navigateRoute('artists');
    };

    window.addEventListener('app:navigate:route', handleNavigateRoute);
    window.addEventListener('app:navigate:import-folder', handleNavigateImportFolder);
    window.addEventListener('app:navigate:songs', handleNavigateSongs);
    window.addEventListener('app:navigate:settings', handleNavigateSettings);
    window.addEventListener(settingsBackNavigationEvent, handleNavigateSettingsBack);
    window.addEventListener('app:navigate:plugins', handleNavigatePlugins);
    window.addEventListener('app:navigate:dsp', handleNavigateDsp);
    window.addEventListener('app:navigate:queue', handleNavigateQueue);
    window.addEventListener('app:navigate:now-playing', handleNavigateNowPlaying);
    window.addEventListener('app:navigate:lyrics', handleNavigateLyrics);
    window.addEventListener('app:navigate:lyrics-back', handleNavigateLyricsBack);
    window.addEventListener(albumDetailNavigationEvent, handleNavigateAlbumDetail);
    window.addEventListener(artistDetailNavigationEvent, handleNavigateArtistDetail);
    return () => {
      window.removeEventListener('app:navigate:route', handleNavigateRoute);
      window.removeEventListener('app:navigate:import-folder', handleNavigateImportFolder);
      window.removeEventListener('app:navigate:songs', handleNavigateSongs);
      window.removeEventListener('app:navigate:settings', handleNavigateSettings);
      window.removeEventListener(settingsBackNavigationEvent, handleNavigateSettingsBack);
      window.removeEventListener('app:navigate:plugins', handleNavigatePlugins);
      window.removeEventListener('app:navigate:dsp', handleNavigateDsp);
      window.removeEventListener('app:navigate:queue', handleNavigateQueue);
      window.removeEventListener('app:navigate:now-playing', handleNavigateNowPlaying);
      window.removeEventListener('app:navigate:lyrics', handleNavigateLyrics);
      window.removeEventListener('app:navigate:lyrics-back', handleNavigateLyricsBack);
      window.removeEventListener(albumDetailNavigationEvent, handleNavigateAlbumDetail);
      window.removeEventListener(artistDetailNavigationEvent, handleNavigateArtistDetail);
    };
  }, [activeLyricsViewMode, activeRouteId, navigateRoute, navigableRoutes, routes, setLyricsViewMode]);

  useEffect(() => {
    const handleOpenAudioSettings = (): void => setIsAudioDrawerOpen(true);
    const handleOpenMvSettings = (): void => setIsMvDrawerOpen(true);
    const handleOpenLyricsSettings = (): void => setIsLyricsDrawerOpen(true);

    window.addEventListener(openAudioSettingsEvent, handleOpenAudioSettings);
    window.addEventListener(openMvSettingsEvent, handleOpenMvSettings);
    window.addEventListener(openLyricsSettingsEvent, handleOpenLyricsSettings);
    return () => {
      window.removeEventListener(openAudioSettingsEvent, handleOpenAudioSettings);
      window.removeEventListener(openMvSettingsEvent, handleOpenMvSettings);
      window.removeEventListener(openLyricsSettingsEvent, handleOpenLyricsSettings);
    };
  }, []);

  useEffect(() => {
    const audio = window.echo?.audio;

    if (!audio) {
      return;
    }

    void Promise.all([
      loadPersistedRememberedAudioOutput(),
      window.echo?.app?.getSettings?.().catch(() => null) ?? Promise.resolve(null),
    ])
      .then(([remembered, settings]) => {
        const useJuceOutput = settings?.audioUseJuceOutput === true;
        const useJuceDecode = settings?.audioUseJuceDecode === true;
        const dsdOutputMode = settings?.audioDsdOutputMode === 'dop' ? 'dop' : 'pcm';
        const asioNativeDsdExperimentalEnabled = settings?.audioAsioNativeDsdExperimentalEnabled === true;
        const asioUnavailableFallbackEnabled = settings?.audioAsioUnavailableFallbackEnabled === true;
        const exclusiveInstabilityFallbackEnabled = settings?.audioExclusiveInstabilityFallbackEnabled === true;
        const soxrFallbackEnabled = settings?.audioSoxrFallbackEnabled !== false;
        const releaseExclusiveOnPauseExperimentalEnabled = settings?.audioReleaseExclusiveOnPauseExperimentalEnabled === true;
        if (!remembered.enabled) {
          return audio
            .setOutput({
              useJuceOutput,
              useJuceDecode,
              dsdOutputMode,
              asioNativeDsdExperimentalEnabled,
              asioUnavailableFallbackEnabled,
              exclusiveInstabilityFallbackEnabled,
              soxrFallbackEnabled,
              releaseExclusiveOnPauseExperimentalEnabled,
            })
            .then(setAudioDrawerStatus);
        }

        return audio
          .setOutput({
            outputMode: remembered.outputMode,
            sharedBackend: remembered.sharedBackend,
            latencyProfile: remembered.latencyProfile,
            deviceIndex: remembered.deviceIndex,
            deviceName: remembered.deviceName,
            useJuceOutput,
            useJuceDecode,
            dsdOutputMode,
            asioNativeDsdExperimentalEnabled,
            asioUnavailableFallbackEnabled,
            exclusiveInstabilityFallbackEnabled,
            soxrFallbackEnabled,
            releaseExclusiveOnPauseExperimentalEnabled,
          })
          .then(setAudioDrawerStatus);
      })
      .catch((error) => {
        console.error('Failed to restore remembered audio output', error);
      });
  }, []);

  const notifyLibraryChanged = useCallback(async (options: { preserveScroll?: boolean } = {}): Promise<void> => {
    try {
      await window.echo?.library.getSummary();
    } catch {
      // Summary warmup is best-effort for direct chrome actions.
    }

    window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: options.preserveScroll === true } }));
  }, []);

  useEffect(() => {
    const library = window.echo?.library;

    if (!library?.onLibraryChanged) {
      return undefined;
    }

    return library.onLibraryChanged(() => {
      void notifyLibraryChanged({ preserveScroll: true });
    });
  }, [notifyLibraryChanged]);

  useEffect(() => {
    const library = window.echo?.library;

    if (!library?.onLikedTracksChanged) {
      return undefined;
    }

    return library.onLikedTracksChanged(() => {
      window.dispatchEvent(new Event(likedTracksChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
    });
  }, []);

  useEffect(() => {
    const downloads = window.echo?.downloads;

    if (!downloads?.onJobsUpdated) {
      return undefined;
    }

    const importedTrackIds = downloadImportedTrackIdsRef.current;
    const flushDownloadLibraryChanged = (): void => {
      downloadLibraryChangedTimerRef.current = null;
      clearSongsFirstPageSnapshot();
      window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));
      window.dispatchEvent(new Event('library:playlists-changed'));
    };
    return downloads.onJobsUpdated((jobs: DownloadJob[]) => {
      let importedNewTrack = false;
      const nextJobIds = new Set<string>();

      for (const job of jobs) {
        nextJobIds.add(job.id);
        const previousTrackId = importedTrackIds.get(job.id) ?? null;
        const nextTrackId = job.importedTrackId ?? null;

        if (nextTrackId && previousTrackId !== nextTrackId) {
          importedNewTrack = true;
        }

        importedTrackIds.set(job.id, nextTrackId);
      }

      for (const jobId of Array.from(importedTrackIds.keys())) {
        if (!nextJobIds.has(jobId)) {
          importedTrackIds.delete(jobId);
        }
      }

      if (importedNewTrack) {
        if (downloadLibraryChangedTimerRef.current === null) {
          downloadLibraryChangedTimerRef.current = window.setTimeout(flushDownloadLibraryChanged, downloadLibraryChangeDebounceMs);
        }
      }
    });
  }, []);

  useEffect(() => () => {
    if (downloadLibraryChangedTimerRef.current !== null) {
      window.clearTimeout(downloadLibraryChangedTimerRef.current);
      downloadLibraryChangedTimerRef.current = null;
    }
  }, []);

  const handleImportFolder = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library) {
      folderInputRef.current?.click();
      setChromeNotice(t('notice.browserFolderPicker'));
      return;
    }

    try {
      const chosenPath = await library.chooseFolder();

      if (!chosenPath) {
        return;
      }

      const folder = await library.addFolder(chosenPath);
      rememberLibraryScanStatus(await library.scanFolder(folder.id));
      await notifyLibraryChanged();
    } catch (error) {
      console.error('Failed to import folder from app chrome', error);
    }
  }, [notifyLibraryChanged, t]);

  const handleImportFile = useCallback(async (): Promise<void> => {
    const playback = window.echo?.playback;
    const library = window.echo?.library;

    if (!library?.chooseImportFiles && !playback) {
      fileInputRef.current?.click();
      setChromeNotice(t('notice.browserFolderPicker'));
      return;
    }

    try {
      const filePaths = library?.chooseImportFiles
        ? await library.chooseImportFiles()
        : playback?.openLocalAudioFiles
          ? await playback.openLocalAudioFiles()
          : await playback?.openLocalAudioFile().then((path) => (path ? [path] : null));

      if (!filePaths?.length) {
        return;
      }

      if (library?.importAudioFiles) {
        const result = await library.importAudioFiles(filePaths);
        if (result.importedCount > 0) {
          clearSongsFirstPageSnapshot();
          await notifyLibraryChanged();
          navigateRoute('songs');
        }

        const details = [
          result.importedCount > 0 ? t('notice.importFiles.imported', { count: result.importedCount }) : null,
          result.skippedCount > 0 ? t('notice.importFiles.skipped', { count: result.skippedCount }) : null,
          result.failedCount > 0 ? t('notice.importFiles.failed', { count: result.failedCount }) : null,
        ].filter(Boolean).join(t('punctuation.clauseSeparator'));
        setChromeNotice(details || t('notice.importFiles.empty'));
        return;
      }

      const result = await playbackQueue.openTemporaryLocalFiles(filePaths);
      navigateRoute('queue');
      if (result.rejected.length > 0) {
        setChromeNotice(t('notice.openFiles.partial', { opened: result.tracks.length, rejected: result.rejected.length }));
      }
    } catch (error) {
      console.error('Failed to open local audio file from app chrome', error);
    }
  }, [navigateRoute, notifyLibraryChanged, playbackQueue, t]);

  useEffect(() => {
    const unsubscribe = window.echo?.playback?.onLocalAudioFilesOpened?.((paths) => {
      if (paths.length === 0) {
        return;
      }

      void playbackQueue
        .openTemporaryLocalFiles(paths)
        .then((result) => {
          navigateRoute('queue');
          if (result.rejected.length > 0) {
            setChromeNotice(t('notice.openFiles.partial', { opened: result.tracks.length, rejected: result.rejected.length }));
          }
        })
        .catch((error) => {
          console.error('Failed to open local audio files from system', error);
        });
    });

    return () => unsubscribe?.();
  }, [navigateRoute, playbackQueue, t]);

  const handleWindowAction = useCallback(
    async (action: 'minimize' | 'toggleMaximize' | 'toggleFullscreen' | 'close'): Promise<void> => {
      const appApi = window.echo?.app;

      if (!appApi) {
        setChromeNotice(t('notice.windowControlsDesktop'));
        return;
      }

      if (action === 'toggleFullscreen') {
        startWindowFullscreenTransition(!isWindowFullscreen);
        await (appApi.triggerFullscreenShortcut?.() ?? appApi.toggleFullscreen());
      } else {
        await appApi[action]();
      }
      if (action === 'toggleMaximize' || action === 'toggleFullscreen') {
        void appApi.isMaximized?.()
          .then(setIsWindowMaximized)
          .catch(() => undefined);
        void appApi.isFullscreen?.()
          .then(setIsWindowFullscreen)
          .catch(() => undefined);
      }
    },
    [isWindowFullscreen, startWindowFullscreenTransition, t],
  );

  const handleOpenCrashReportNotice = useCallback(async (): Promise<void> => {
    try {
      const reportPath = await window.echo?.diagnostics.openCrashReport();
      setDiagnosticsNotice(false);
      setChromeNotice(reportPath ? t('notice.reportOpenedPath', { path: reportPath }) : t('notice.reportOpened'));
    } catch (error) {
      setChromeNotice(error instanceof Error ? error.message : String(error));
    }
  }, [t]);

  const handleDismissDiagnosticsNotice = useCallback(async (): Promise<void> => {
    setDiagnosticsNotice(false);
    await window.echo?.diagnostics.clearLastCrashSummary().catch(() => undefined);
  }, []);

  const handleOpenAudioCrashReport = useCallback(async (): Promise<void> => {
    try {
      await window.echo?.diagnostics.openAudioCrashReport();
    } catch (error) {
      setChromeNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleCloseAudioIssueDiagnosticsWindow = useCallback((): void => {
    setAudioIssueDiagnosticsWindowEnabled(false);
    void window.echo?.app?.setSettings?.({ audioIssueDiagnosticsWindowEnabled: false })
      .then((settings) => {
        window.dispatchEvent(new CustomEvent('settings:changed', { detail: settings }));
      })
      .catch(() => undefined);
  }, []);

  const handleBrowserFolderPicked = (files: FileList | null): void => {
    if (!files?.length) {
      return;
    }

    setChromeNotice(t('notice.browserFilePicker', { name: `${files.length} file(s)` }));
  };

  const handleBrowserFilePicked = (files: FileList | null): void => {
    const file = files?.[0];

    if (!file) {
      return;
    }

    setChromeNotice(t('notice.browserFilePicker', { name: `"${file.name}"` }));
  };

  const handleToggleDesktopLyrics = useCallback(async (): Promise<void> => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      return;
    }

    try {
      const state = desktopLyricsVisible
        ? await desktopLyrics.hide()
        : await desktopLyrics.show();
      setDesktopLyricsVisible(state.visible === true);
    } catch {
      setDesktopLyricsVisible((current) => current);
    }
  }, [desktopLyricsVisible]);

  const handleUnlockDesktopLyrics = useCallback(async (): Promise<void> => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics || !desktopLyricsLocked) {
      return;
    }

    try {
      const state = await desktopLyrics.setLocked(false);
      setDesktopLyricsVisible(state.visible === true);
      setDesktopLyricsLocked(state.locked === true);
    } catch {
      setDesktopLyricsLocked((current) => current);
    }
  }, [desktopLyricsLocked]);

  return (
    <div
      className={`app-shell ${isStandaloneRoute ? 'app-shell--standalone' : ''} ${isLyricsRoute ? 'app-shell--lyrics' : ''} ${
        shouldUseLyricsPlayerDrawer ? 'app-shell--lyrics-player-drawer app-shell--lyrics-mini-player' : ''
      } ${
        shouldShowAppWallpaperVisual ? 'app-shell--wallpaper' : ''
      } ${
        shouldShowAppWallpaperVisual && isAppWallpaperReady ? 'app-shell--wallpaper-ready' : ''
      } ${
        sidebarLayoutSettings.sidebarAutoHideEnabled ? 'app-shell--sidebar-auto-hide' : ''
      }`}
      data-wallpaper-unified-opacity={shouldShowAppWallpaperVisual && isAppWallpaperReady && appWallpaperSettings.appWallpaperUnifiedOpacityEnabled ? 'true' : undefined}
      data-wallpaper-visual-protection={
        shouldShowAppWallpaperVisual && isAppWallpaperReady ? (appWallpaperSettings.appWallpaperVisualProtectionEnabled ? 'true' : 'false') : undefined
      }
      data-wallpaper-ui-transparent={shouldShowAppWallpaperVisual && isAppWallpaperUiTransparent ? 'true' : undefined}
      data-wallpaper-ui-zero={shouldShowAppWallpaperVisual && isAppWallpaperUiZero ? 'true' : undefined}
      data-wallpaper-orientation={shouldShowAppWallpaperVisual ? activeAppWallpaperOrientation : undefined}
      data-window-fullscreen={isWindowFullscreen ? 'true' : 'false'}
      data-window-fullscreen-target={
        (windowFullscreenTransitionTarget ?? isWindowFullscreen) ? 'true' : 'false'
      }
      data-window-fullscreen-transition={isWindowFullscreenTransitioning ? 'true' : undefined}
      style={appShellStyle}
    >
      {appWallpaperUrl ? (
        <div
          className="app-wallpaper-layer"
          aria-hidden="true"
          data-hidden={shouldShowAppWallpaperVisual ? undefined : 'true'}
          data-loaded={isAppWallpaperReady}
        >
          {isAppWallpaperVideo ? (
            <video
              ref={appWallpaperVideoRef}
              src={appWallpaperUrl}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              style={appWallpaperStyle}
              onCanPlay={() => setLoadedAppWallpaperKey(appWallpaperKey)}
              onLoadedData={() => setLoadedAppWallpaperKey(appWallpaperKey)}
              onEnded={(event) => {
                event.currentTarget.currentTime = 0;
                void event.currentTarget.play().catch(() => undefined);
              }}
              onError={() => {
                setLoadedAppWallpaperKey((current) => (current === appWallpaperKey ? current : null));
              }}
            />
          ) : (
            <img
              src={appWallpaperUrl}
              alt=""
              style={appWallpaperStyle}
              onLoad={() => setLoadedAppWallpaperKey(appWallpaperKey)}
            />
          )}
        </div>
      ) : null}

      <AppTitleBar
        activeRouteId={activeRouteId}
        isAudioSettingsOpen={isAudioDrawerOpen}
        isLyricsSettingsOpen={isLyricsDrawerOpen}
        isMvSettingsOpen={isMvDrawerOpen}
        onRouteChange={navigateRoute}
        onOpenAudioSettings={() => setIsAudioDrawerOpen(true)}
        onOpenLyricsSettings={() => setIsLyricsDrawerOpen(true)}
        onOpenMvSettings={() => setIsMvDrawerOpen(true)}
        onMinimize={() => void handleWindowAction('minimize')}
        onToggleMaximize={() => void handleWindowAction('toggleMaximize')}
        onToggleFullscreen={() => void handleWindowAction('toggleFullscreen')}
        isWindowMaximized={isWindowMaximized}
        isWindowFullscreen={isWindowFullscreen}
        onClose={() => void handleWindowAction('close')}
      />

      {isStandaloneRoute ? null : (
        <Sidebar
          routes={visibleRoutes}
          activeRouteId={activeRouteId}
          onRouteChange={navigateRoute}
          onOpenAudioSettings={() => setIsAudioDrawerOpen(true)}
          onOpenLyricsSettings={() => setIsLyricsDrawerOpen(true)}
          onImportFolder={() => void handleImportFolder()}
          onImportFile={() => void handleImportFile()}
        />
      )}

      {renderedRoutes.map((route) => {
        const isActive = route.id === activeRoute.id;
        const routeIsStandalone = route.chrome === 'standalone';
        const routeElement =
          route.id === 'lyrics' && isValidElement(route.element)
            ? cloneElement(route.element as ReactElement<{ usePlayerDrawerHeader?: boolean }>, {
                usePlayerDrawerHeader: shouldUseLyricsPlayerDrawer,
              })
            : route.element;

        return (
          <main
            aria-hidden={isActive ? undefined : true}
            className={`page-surface ${routeIsStandalone ? 'page-surface--standalone' : ''}`}
            data-route-id={route.id}
            hidden={!isActive}
            key={route.id}
          >
            {routeElement}
          </main>
        );
      })}

      <EditableContextMenu />

      {isStandaloneRoute ? null : <DragDropImportOverlay onNotice={setChromeNotice} />}

      {isFirstRunWizardOpen ? (
        <FirstRunWizard
          initialSettings={firstRunSettings}
          onClose={() => setIsFirstRunWizardOpen(false)}
          onCompleted={(settings) => {
            if (settings) {
              setFirstRunSettings(settings);
              setAppWallpaperSettings(selectAppWallpaperSettings(settings));
              setLyricsMiniPlayerSettings(selectLyricsMiniPlayerSettings(settings));
            }
          }}
        />
      ) : null}

      <input
        ref={folderInputRef}
        className="browser-preview-picker"
        type="file"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => handleBrowserFolderPicked(event.target.files)}
      />
      <input
        ref={fileInputRef}
        className="browser-preview-picker"
        type="file"
        accept=".flac,.mp3,.wav,.m4a,.m4p,.aac,.ogg,.opus,.wma,.alac,.aiff,.aif,.ape,.wv,.tta,.tak,.caf,.dsf,.dff,.mka,.mkv,.mp4,.mov,.webm,.mp2,.mp1,.mpc,.ofr,.ofs,.spx,.amr,.ac3,.dts,audio/*"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => handleBrowserFilePicked(event.target.files)}
      />

      {audioIssueDiagnosticsWindowEnabled ? (
        <AudioIssueDiagnosticsWindow onClose={handleCloseAudioIssueDiagnosticsWindow} />
      ) : null}

      {chromeNotice ? (
        <div className={`chrome-notice ${isChromeNoticeVisible ? 'is-visible' : 'is-hiding'}`} role="status">
          <span className="chrome-notice-message">{chromeNotice}</span>
          <button className="chrome-notice-close" type="button" aria-label={t('notice.action.closeNotice')} title={t('notice.action.closeNotice')} onClick={dismissChromeNotice}>
            <X size={14} />
          </button>
        </div>
      ) : null}

      {diagnosticsNotice ? (
        <div className="chrome-notice chrome-notice--diagnostics" role="status">
          <span>{t('notice.diagnosticsCrash.description')}</span>
          <div className="chrome-notice-actions">
            <button type="button" onClick={() => void handleOpenCrashReportNotice()}>
              {t('notice.action.openReport')}
            </button>
            <button type="button" onClick={() => void handleDismissDiagnosticsNotice()}>
              {t('notice.action.ignore')}
            </button>
          </div>
        </div>
      ) : null}

      {accountNotice ? (
        <div className="chrome-notice chrome-notice--account" role="alert">
          <strong>{t('notice.accountExpired.title')}</strong>
          <span>{accountNotice}</span>
        </div>
      ) : null}

      {audioErrorNotice ? (
        <div className="chrome-notice chrome-notice--audio-error" role="alert">
          <strong>{t('notice.audioError.title')}</strong>
          <span>{audioErrorNotice.message}</span>
          <small>{t('notice.audioError.description')}</small>
          <div className="chrome-notice-actions">
            <button type="button" onClick={() => void handleOpenAudioCrashReport()}>
              {t('notice.action.openReport')}
            </button>
            <button type="button" onClick={() => setAudioErrorNotice(null)}>
              {t('notice.action.close')}
            </button>
          </div>
        </div>
      ) : null}

      <AudioSettingsDrawer
        isOpen={isAudioDrawerOpen}
        status={audioDrawerStatus}
        hqPlayerTakeoverEnabled={playbackQueue.hqPlayerTakeoverEnabled}
        hqPlayerTrack={playbackQueue.currentTrack ?? playbackQueue.lastPlayedTrack}
        onClose={() => setIsAudioDrawerOpen(false)}
        onActivateHqPlayerTakeover={async () => {
          const status = await playbackQueue.activateHqPlayerTakeover();
          if (status) {
            setPlaybackStatusSnapshot({ playbackStatus: status, error: null });
          }
        }}
        onHqPlayerTakeoverEnabledChange={playbackQueue.setHqPlayerTakeoverEnabled}
        onStatusChange={setAudioDrawerStatus}
      />
      <LyricsSettingsDrawer isOpen={isLyricsDrawerOpen} onClose={() => setIsLyricsDrawerOpen(false)} />
      <MvSettingsDrawer isOpen={isMvDrawerOpen} onClose={() => setIsMvDrawerOpen(false)} />
      <PlaybackQueueDrawer
        isOpen={isLyricsRoute && isLyricsQueueDrawerOpen}
        onClose={() => setIsLyricsQueueDrawerOpen(false)}
        onOpenFullQueue={handleOpenFullQueueFromLyricsDrawer}
      />

      {shouldRenderPlayerBar ? (
        <div
          ref={lyricsMiniPlayerHostRef}
          className={[
            'player-bar-host',
            shouldUseLyricsPlayerDrawer ? 'lyrics-player-drawer-host lyrics-mini-player-host' : '',
            shouldAutoHideLyricsMiniPlayer ? 'lyrics-player-drawer-host--auto-hide' : '',
            isLyricsMiniPlayerVisuallyHidden ? 'lyrics-player-drawer-host--auto-hidden' : '',
          ].filter(Boolean).join(' ')}
          data-auto-hide={shouldAutoHideLyricsMiniPlayer ? 'true' : undefined}
          data-auto-hide-state={shouldAutoHideLyricsMiniPlayer ? (isLyricsMiniPlayerVisuallyHidden ? 'hidden' : 'visible') : undefined}
          data-mini-player-color-mode={shouldUseLyricsPlayerDrawer ? lyricsMiniPlayerSettings.lyricsPlayerBarDrawerColorMode : undefined}
          style={shouldUseLyricsPlayerDrawer ? lyricsMiniPlayerStyle : undefined}
        >
          <PlayerBar
            desktopLyricsLocked={desktopLyricsLocked}
            desktopLyricsVisible={desktopLyricsVisible}
            hasDesktopLyricsBridge={hasDesktopLyricsBridge}
            onOpenAudioSettings={() => setIsAudioDrawerOpen(true)}
            onOpenQueue={isLyricsRoute ? handleOpenLyricsQueueDrawer : handleOpenShellQueue}
            showQueueButton={true}
            showSignalPathControl={!isLyricsRoute && signalPathControlEnabled}
            onToggleDesktopLyrics={handleToggleDesktopLyrics}
            onUnlockDesktopLyrics={handleUnlockDesktopLyrics}
          />
        </div>
      ) : null}
    </div>
  );
};
