import { Suspense, cloneElement, isValidElement, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { X } from 'lucide-react';
import { PlayerBar } from '../components/player/PlayerBar';
import { PlaybackQueueDrawer } from '../components/player/PlaybackQueueDrawer';
import { AudioSettingsDrawer } from '../components/player/AudioSettingsDrawer';
import { AudioIssueDiagnosticsWindow } from '../components/player/AudioIssueDiagnosticsWindow';
import { LyricsSettingsDrawer } from '../components/lyrics/LyricsSettingsDrawer';
import { LyricsVisualSettingsDrawer } from '../components/lyrics/LyricsVisualSettingsDrawer';
import { MvSettingsDrawer } from '../components/lyrics/MvSettingsDrawer';
import { contrastRatio, parseHexColor, sampleImageUrl, type ReadableColorSample, type Rgb } from '../components/lyrics/lyricsReadableColor';
import { DragDropImportOverlay } from '../components/import/DragDropImportOverlay';
import { PluginTrackActionDrawerHost } from '../components/library/PluginTrackActionDrawer';
import { FirstRunWizard } from '../components/onboarding/FirstRunWizard';
import { UserNoticeGate } from '../components/onboarding/UserNoticeGate';
import { loadPersistedRememberedAudioOutput } from '../components/player/audioOutputMemory';
import { Sidebar } from '../components/layout/Sidebar';
import { AppTitleBar } from '../components/layout/AppTitleBar';
import { EditableContextMenu } from '../components/ui/EditableContextMenu';
import { formatAudioHostError, shouldSuppressAudioHostError } from '../components/player/audioErrorFormat';
import { type AudioErrorNoticeEventDetail, showAudioErrorNoticeEvent } from '../utils/audioErrorNotice';
import { createPluginPanelRoutes } from './routes';
import type { AppRoute, AppRouteId } from './routes';
import {
  audioEchoSrcFilterProfiles,
  audioPcmDitherModes,
  audioSdmComputeBackends,
  audioSdmModes,
  audioSdmQualityProfiles,
  audioSdmTargetRates,
  type AudioEchoSrcFilterProfile,
  type AudioPcmDitherMode,
  type AudioSdmComputeBackend,
  type AudioSdmMode,
  type AudioSdmQualityProfile,
  type AudioSdmTargetRate,
  type AudioStatus,
} from '../../shared/types/audio';
import type { AccountProvider, AccountStatus } from '../../shared/types/accounts';
import { currentUserNoticeVersion, type AppSettings, type AppThemeMode } from '../../shared/types/appSettings';
import { echoProUnlockPluginId } from '../../shared/constants/featureUnlocks';
import type { DiagnosticMemoryPressureEvent } from '../../shared/types/diagnostics';
import type { DownloadJob } from '../../shared/types/downloads';
import type { LibraryTrack } from '../../shared/types/library';
import type { UpdateStatus } from '../../shared/types/updates';
import { useI18n } from '../i18n/I18nProvider';
import { likedChangedEvent, likedTracksChangedEvent } from '../hooks/useLikedMedia';
import type { TranslationKey } from '../i18n/locales';
import { logLyricsConsole } from '../diagnostics/lyricsConsole';
import { rememberLibraryScanStatus } from '../stores/libraryScanSession';
import { clearSongsFirstPageSnapshot } from '../stores/songsFirstPageSnapshot';
import { usePlaybackQueue, type QueueItem } from '../stores/PlaybackQueueProvider';
import { setPlaybackStatusSnapshot, useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { useLibraryStartupArtworkPreloader } from '../hooks/useLibraryStartupArtworkPreloader';
import { albumDetailNavigationEvent } from '../utils/albumNavigation';
import { artistDetailNavigationEvent } from '../utils/artistNavigation';
import { AnimatedOutlet } from '../ui/motion/AnimatedOutlet';
import { applySidebarPreferences } from './sidebarPreferences';
import {
  defaultSidebarHiddenRouteIds,
  defaultSidebarRouteOrder,
  lockedHiddenSidebarRouteIds,
  lockedVisibleSidebarRouteIds,
  normalizeSidebarHiddenRouteIds,
  normalizeSidebarRouteOrder,
  type SidebarRouteId,
} from '../../shared/types/sidebar';
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
const isEchoProUnlockPluginActive = (plugin: { id: string; enabled: boolean; status: string; disabledByHost?: boolean }): boolean =>
  plugin.id === echoProUnlockPluginId && plugin.enabled === true && plugin.disabledByHost !== true && plugin.status !== 'error';

const normalizeEchoSrcFilterProfile = (
  value: unknown,
  fallback: AudioEchoSrcFilterProfile = 'poly-sinc-gauss-long',
): AudioEchoSrcFilterProfile =>
  typeof value === 'string' && (audioEchoSrcFilterProfiles as readonly string[]).includes(value)
    ? value as AudioEchoSrcFilterProfile
    : fallback;

const normalizePcmDitherMode = (value: unknown): AudioPcmDitherMode =>
  typeof value === 'string' && (audioPcmDitherModes as readonly string[]).includes(value)
    ? value as AudioPcmDitherMode
    : 'off';

const normalizeSdmMode = (value: unknown): AudioSdmMode =>
  typeof value === 'string' && (audioSdmModes as readonly string[]).includes(value)
    ? value as AudioSdmMode
    : 'off';

const normalizeSdmTargetRate = (value: unknown): AudioSdmTargetRate =>
  typeof value === 'string' && (audioSdmTargetRates as readonly string[]).includes(value)
    ? value as AudioSdmTargetRate
    : 'dsd128';

const normalizeSdmQualityProfile = (value: unknown): AudioSdmQualityProfile =>
  typeof value === 'string' && (audioSdmQualityProfiles as readonly string[]).includes(value)
    ? value as AudioSdmQualityProfile
    : 'safe';

const normalizeSdmComputeBackend = (value: unknown): AudioSdmComputeBackend =>
  typeof value === 'string' && (audioSdmComputeBackends as readonly string[]).includes(value)
    ? value as AudioSdmComputeBackend
    : 'cpu';

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

const RouteLoadingFallback = (): JSX.Element => (
  <div className="page-stack page-stack--route-loading" role="status" aria-live="polite">
    <div className="route-loading-card">
      <span className="route-loading-spinner" aria-hidden="true" />
      <span>Loading...</span>
    </div>
  </div>
);

const nonTextInputTypes = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

const isTouchKeyboardEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const editable = target.closest('input, textarea, [contenteditable], [role="textbox"]');
  if (!(editable instanceof HTMLElement)) {
    return false;
  }

  if (editable instanceof HTMLInputElement) {
    return !editable.disabled && !editable.readOnly && !nonTextInputTypes.has(editable.type);
  }

  if (editable instanceof HTMLTextAreaElement) {
    return !editable.disabled && !editable.readOnly;
  }

  return editable.getAttribute('contenteditable') !== 'false' && editable.getAttribute('aria-readonly') !== 'true';
};

type AppWallpaperSettings = Pick<
  AppSettings,
  | 'appWindowAcrylicEnabled'
  | 'appWindowAcrylicKeepWhenUnfocusedEnabled'
  | 'appWindowAcrylicTransparencyPercent'
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
  | 'lyricsPlayerBarDrawerCompactOnIdleEnabled'
  | 'lyricsPlayerBarDrawerOpacityPercent'
  | 'lyricsPlayerBarDrawerColorMode'
  | 'lyricsPlayerBarDrawerColor'
>;

type SidebarLayoutSettings = Pick<AppSettings, 'sidebarAutoHideEnabled' | 'sidebarHiddenRouteIds' | 'sidebarIconOnlyEnabled' | 'sidebarRouteOrder'>;

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
  appWindowAcrylicEnabled: false,
  appWindowAcrylicKeepWhenUnfocusedEnabled: false,
  appWindowAcrylicTransparencyPercent: 70,
};

const defaultLyricsMiniPlayerSettings: LyricsMiniPlayerSettings = {
  lyricsPlayerBarDrawerEnabled: true,
  lyricsPlayerBarDrawerAutoEnableForMv: true,
  lyricsPlayerBarDrawerAutoHideEnabled: false,
  lyricsPlayerBarDrawerCompactOnIdleEnabled: false,
  lyricsPlayerBarDrawerOpacityPercent: 78,
  lyricsPlayerBarDrawerColorMode: 'default',
  lyricsPlayerBarDrawerColor: '#232120',
};

const defaultSidebarLayoutSettings: SidebarLayoutSettings = {
  sidebarRouteOrder: [...defaultSidebarRouteOrder],
  sidebarHiddenRouteIds: [...defaultSidebarHiddenRouteIds],
  sidebarAutoHideEnabled: false,
  sidebarIconOnlyEnabled: false,
};

const lockedVisibleSidebarRouteIdSet = new Set<SidebarRouteId>(lockedVisibleSidebarRouteIds);
const lockedHiddenSidebarRouteIdSet = new Set<SidebarRouteId>(lockedHiddenSidebarRouteIds);

const normalizeAppThemeMode = (value: unknown): AppThemeMode =>
  value === 'light' || value === 'dark' || value === 'system' || value === 'ambient' ? value : 'light';

const readDocumentThemeMode = (): AppThemeMode => normalizeAppThemeMode(document.documentElement.dataset.themeMode);

const downloadLibraryChangeDebounceMs = 250;
const persistentRouteIds = new Set<AppRouteId>(['songs', 'albums', 'artists', 'streaming', 'playlists']);
const readSongsNavigationRemoteSourceId = (event: Event): string | null => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'object' || event.detail === null) {
    return null;
  }

  const remoteSourceId = (event.detail as { remoteSourceId?: unknown }).remoteSourceId;
  return typeof remoteSourceId === 'string' && remoteSourceId.trim().length > 0 ? remoteSourceId : null;
};

const readAudioErrorNoticeMessage = (event: Event): string | null => {
  if (!(event instanceof CustomEvent)) {
    return null;
  }

  const detail = event.detail as AudioErrorNoticeEventDetail | null | undefined;
  if (typeof detail === 'string') {
    const message = detail.trim();
    return message ? message : null;
  }

  if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
    const message = detail.message.trim();
    return message ? message : null;
  }

  return null;
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
  qobuz: 'accountProvider.qobuz',
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
  appWindowAcrylicEnabled: settings.appWindowAcrylicEnabled === true,
  appWindowAcrylicKeepWhenUnfocusedEnabled: settings.appWindowAcrylicKeepWhenUnfocusedEnabled === true,
  appWindowAcrylicTransparencyPercent: Number.isFinite(settings.appWindowAcrylicTransparencyPercent)
    ? Math.max(0, Math.min(100, Math.round(Number(settings.appWindowAcrylicTransparencyPercent))))
    : defaultAppWallpaperSettings.appWindowAcrylicTransparencyPercent,
});

const selectLyricsMiniPlayerSettings = (settings: Partial<AppSettings>): LyricsMiniPlayerSettings => ({
  lyricsPlayerBarDrawerEnabled: settings.lyricsPlayerBarDrawerEnabled !== false,
  lyricsPlayerBarDrawerAutoEnableForMv: settings.lyricsPlayerBarDrawerAutoEnableForMv !== false,
  lyricsPlayerBarDrawerAutoHideEnabled: settings.lyricsPlayerBarDrawerAutoHideEnabled === true,
  lyricsPlayerBarDrawerCompactOnIdleEnabled: settings.lyricsPlayerBarDrawerCompactOnIdleEnabled === true,
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

const miniPlayerVisualOpacity = (surfaceOpacity: number): number => {
  const clampedSurfaceOpacity = Math.max(0.2, Math.min(1, surfaceOpacity));
  return Math.max(0.72, Math.min(1, 0.72 + clampedSurfaceOpacity * 0.28));
};

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
        '--lyrics-mini-player-readable-play-bg': 'rgba(255, 255, 255, 0.20)',
        '--lyrics-mini-player-readable-play-bg-hover': 'rgba(255, 255, 255, 0.26)',
        '--lyrics-mini-player-readable-play-border': 'rgba(255, 255, 255, 0.20)',
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
        '--lyrics-mini-player-readable-play-bg': 'rgba(17, 24, 39, 0.12)',
        '--lyrics-mini-player-readable-play-bg-hover': 'rgba(17, 24, 39, 0.18)',
        '--lyrics-mini-player-readable-play-border': 'rgba(17, 24, 39, 0.18)',
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
const openLyricsVisualSettingsEvent = 'app:open-lyrics-visual-settings';
const openUserNoticeEvent = 'app:open-user-notice';
const lyricsDrawerToolsChangedEvent = 'app:lyrics-drawer-tools-changed';
const settingsBackNavigationEvent = 'app:navigate:settings-back';
const showChromeNoticeEvent = 'app:show-chrome-notice';
const pendingRouteStorageKey = 'echo-next.pending-route';
const pendingSettingsSectionStorageKey = 'echo-next.settings.pending-section';
const settingsSectionNavigationEvent = 'app:navigate:settings-section';
const lyricsMiniPlayerAutoHideDistancePx = 150;
const lyricsMiniPlayerAutoHideRevealBandPx = 164;
const lyricsMiniPlayerAutoHideDelayMs = 280;
const defaultChromeNoticeAutoHideMs = 5000;
const quickAudioNoticeAutoHideMs = 1800;
const upcomingTrackNoticeLeadSeconds = 10;
const upcomingTrackNoticeAutoHideMs = 6400;
const chromeNoticeEnterDelayMs = 16;
const chromeNoticeExitAnimationMs = 260;
const startupBlockedRouteIds = new Set<AppRouteId>(['streaming']);
const readSuppressAccountExpiryNotices = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.suppressAccountExpiryNotices === true;
const readNotificationsDisabled = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.notificationsDisabled === true;
const readUpcomingTrackNoticeEnabled = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.upcomingTrackNoticeEnabled === true;

const formatMemoryNoticeBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'n/a';
  }

  const mib = bytes / (1024 * 1024);
  if (mib < 1024) {
    return `${mib.toFixed(mib >= 100 ? 0 : 1)} MiB`;
  }

  return `${(mib / 1024).toFixed(2)} GiB`;
};

type UpcomingTrackNotice = {
  key: string;
  track: LibraryTrack;
};

type ChromeNoticePresenceProps = {
  ariaLive?: 'off' | 'polite' | 'assertive';
  children: ReactNode;
  className?: string;
  onExited?: () => void;
  role: 'alert' | 'status';
  show: boolean;
};

const ChromeNoticePresence = ({
  ariaLive,
  children,
  className,
  onExited,
  role,
  show,
}: ChromeNoticePresenceProps): JSX.Element | null => {
  const [shouldRender, setShouldRender] = useState(show);
  const [isVisible, setIsVisible] = useState(false);
  const latestChildrenRef = useRef(children);
  const onExitedRef = useRef(onExited);

  if (show) {
    latestChildrenRef.current = children;
  }

  useEffect(() => {
    onExitedRef.current = onExited;
  }, [onExited]);

  useEffect(() => {
    if (show) {
      setShouldRender(true);
      const timer = window.setTimeout(() => setIsVisible(true), chromeNoticeEnterDelayMs);
      return () => window.clearTimeout(timer);
    }

    setIsVisible(false);
    if (!shouldRender) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setShouldRender(false);
      onExitedRef.current?.();
    }, chromeNoticeExitAnimationMs);

    return () => window.clearTimeout(timer);
  }, [show, shouldRender]);

  if (!show && !shouldRender) {
    return null;
  }

  return (
    <div
      aria-hidden={isVisible ? undefined : true}
      aria-live={isVisible ? ariaLive : undefined}
      className={['chrome-notice', className, isVisible ? 'is-visible' : 'is-hiding'].filter(Boolean).join(' ')}
      role={isVisible ? role : undefined}
    >
      {show ? children : latestChildrenRef.current}
    </div>
  );
};

const getPlaybackClock = (
  snapshot: ReturnType<typeof useSharedPlaybackStatus>,
): { state: string; trackId: string | null; positionSeconds: number; durationSeconds: number } | null => {
  const audioStatus = snapshot.audioStatus;
  if (audioStatus) {
    return {
      state: audioStatus.state,
      trackId: audioStatus.currentTrackId,
      positionSeconds: audioStatus.positionSeconds,
      durationSeconds: audioStatus.durationSeconds,
    };
  }

  const playbackStatus = snapshot.playbackStatus;
  if (!playbackStatus) {
    return null;
  }

  return {
    state: playbackStatus.state,
    trackId: playbackStatus.currentTrackId,
    positionSeconds: playbackStatus.positionMs / 1000,
    durationSeconds: playbackStatus.durationMs / 1000,
  };
};

const findCurrentQueueIndex = (
  items: QueueItem[],
  currentQueueId: string | null,
  currentTrackId: string | null,
): number => {
  const queueIndex = currentQueueId ? items.findIndex((item) => item.queueId === currentQueueId) : -1;
  if (queueIndex >= 0) {
    return queueIndex;
  }
  return currentTrackId ? items.findIndex((item) => item.track.id === currentTrackId) : -1;
};

const resolveUpcomingQueueItem = (
  items: QueueItem[],
  currentQueueId: string | null,
  currentTrackId: string | null,
  repeatMode: 'off' | 'one' | 'all',
): QueueItem | null => {
  if (items.length === 0 || repeatMode === 'one') {
    return null;
  }

  const currentIndex = findCurrentQueueIndex(items, currentQueueId, currentTrackId);
  if (currentIndex < 0) {
    return null;
  }

  if (currentIndex < items.length - 1) {
    return items[currentIndex + 1] ?? null;
  }

  return repeatMode === 'all' ? items[0] ?? null : null;
};

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

const isStartupBlockedRouteId = (routeId: AppRouteId): boolean => startupBlockedRouteIds.has(routeId);

const readFallbackRouteId = (routes: AppRoute[]): AppRouteId => {
  const defaultRoute =
    routes.find((route) => route.id === 'home' && !isStartupBlockedRouteId(route.id)) ??
    routes.find((route) => route.id === 'songs' && !isStartupBlockedRouteId(route.id)) ??
    routes.find((route) => !isStartupBlockedRouteId(route.id)) ??
    routes[0];

  return defaultRoute?.id ?? 'songs';
};

const readInitialRouteId = (routes: AppRoute[]): AppRouteId => {
  const fallbackRouteId = readFallbackRouteId(routes);

  try {
    const pendingRoute = window.localStorage.getItem(pendingRouteStorageKey);
    if (pendingRoute && routes.some((route) => route.id === pendingRoute)) {
      window.localStorage.removeItem(pendingRouteStorageKey);
      return isStartupBlockedRouteId(pendingRoute as AppRouteId) ? fallbackRouteId : pendingRoute as AppRouteId;
    }
  } catch {
    // Fall back to the normal entrypoint when localStorage is unavailable.
  }

  return fallbackRouteId;
};

const diagnosticsCrashNoticeOptInStorageKey = 'echo:diagnostics:crash-notice-enabled';

const shouldAutoShowDiagnosticsCrashNotice = (): boolean => {
  try {
    return window.localStorage.getItem(diagnosticsCrashNoticeOptInStorageKey) === 'true';
  } catch {
    return false;
  }
};

export const AppLayout = ({ routes }: AppLayoutProps): JSX.Element => {
  const { t } = useI18n();
  const playbackQueue = usePlaybackQueue();
  const playbackStatusSnapshot = useSharedPlaybackStatus();
  useLibraryStartupArtworkPreloader();
  const [activeRouteId, setActiveRouteId] = useState<AppRouteId>(() => readInitialRouteId(routes));
  const [chromeNotice, setChromeNotice] = useState<string | null>(null);
  const [chromeNoticeAutoHideMs, setChromeNoticeAutoHideMs] = useState(defaultChromeNoticeAutoHideMs);
  const [availableUpdateStatus, setAvailableUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isUpdateNoticeVisible, setIsUpdateNoticeVisible] = useState(false);
  const [updateActionBusy, setUpdateActionBusy] = useState(false);
  const [isChromeNoticeVisible, setIsChromeNoticeVisible] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const suppressAccountExpiryNoticesRef = useRef(false);
  const [notificationsDisabled, setNotificationsDisabled] = useState(false);
  const notificationsDisabledRef = useRef(false);
  const [upcomingTrackNoticeEnabled, setUpcomingTrackNoticeEnabled] = useState(false);
  const upcomingTrackNoticeEnabledRef = useRef(false);
  const [streamingFeatureEnabled, setStreamingFeatureEnabled] = useState(true);
  const [osuDownloaderFeatureEnabled, setOsuDownloaderFeatureEnabled] = useState(false);
  const [upcomingTrackNotice, setUpcomingTrackNotice] = useState<UpcomingTrackNotice | null>(null);
  const [isUpcomingTrackNoticeVisible, setIsUpcomingTrackNoticeVisible] = useState(false);
  const lastUpcomingTrackNoticeKeyRef = useRef<string | null>(null);
  const lastUpcomingTrackPlaybackIdentityRef = useRef<string | null>(null);
  const [audioErrorNotice, setAudioErrorNotice] = useState<{ message: string } | null>(null);
  const [diagnosticsNotice, setDiagnosticsNotice] = useState(false);
  const [memoryPressureNotice, setMemoryPressureNotice] = useState<DiagnosticMemoryPressureEvent | null>(null);
  const [firstRunSettings, setFirstRunSettings] = useState<AppSettings | null>(null);
  const [userNoticeSettingsLoaded, setUserNoticeSettingsLoaded] = useState(false);
  const [userNoticeAccepted, setUserNoticeAccepted] = useState(false);
  const [userNoticeReviewOpen, setUserNoticeReviewOpen] = useState(false);
  const [isFirstRunWizardOpen, setIsFirstRunWizardOpen] = useState(false);
  const [isFirstRunWizardClosing, setIsFirstRunWizardClosing] = useState(false);
  const firstRunWizardMountedRef = useRef(false);
  const firstRunWizardCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [downloadsFeatureUnlocked, setDownloadsFeatureUnlocked] = useState(false);
  const [connectDonatorUnlocked, setConnectDonatorUnlocked] = useState(false);
  const [echoProPluginUnlocked, setEchoProPluginUnlocked] = useState(false);
  const [pluginPanelRoutes, setPluginPanelRoutes] = useState<AppRoute[]>([]);
  const [isAudioDrawerOpen, setIsAudioDrawerOpen] = useState(false);
  const [isLyricsDrawerOpen, setIsLyricsDrawerOpen] = useState(false);
  const [isLyricsVisualDrawerOpen, setIsLyricsVisualDrawerOpen] = useState(false);
  const [lyricsDrawerCurrentTrackTools, setLyricsDrawerCurrentTrackTools] = useState<ReactNode | null>(null);
  const [isMvDrawerOpen, setIsMvDrawerOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false);
  const [isWindowFullscreenTransitioning, setIsWindowFullscreenTransitioning] = useState(false);
  const [windowFullscreenTransitionTarget, setWindowFullscreenTransitionTarget] = useState<boolean | null>(null);
  const [isLyricsQueueDrawerOpen, setIsLyricsQueueDrawerOpen] = useState(false);
  const [desktopLyricsVisible, setDesktopLyricsVisible] = useState(false);
  const [, setDesktopLyricsLocked] = useState(false);
  const [audioDrawerStatus, setAudioDrawerStatus] = useState<AudioStatus | null>(null);
  const [audioIssueDiagnosticsWindowEnabled, setAudioIssueDiagnosticsWindowEnabled] = useState(false);
  const [signalPathControlEnabled, setSignalPathControlEnabled] = useState(false);
  const [lyricsMiniPlayerSettings, setLyricsMiniPlayerSettings] = useState<LyricsMiniPlayerSettings>(defaultLyricsMiniPlayerSettings);
  const [sidebarLayoutSettings, setSidebarLayoutSettings] = useState<SidebarLayoutSettings>(defaultSidebarLayoutSettings);
  const [featureCommentsHidden, setFeatureCommentsHidden] = useState(false);
  const [lyricsMiniPlayerCoverSample, setLyricsMiniPlayerCoverSample] = useState<ReadableColorSample | null>(null);
  const [isLyricsMiniPlayerAutoHidden, setIsLyricsMiniPlayerAutoHidden] = useState(false);
  const [activeLyricsViewMode, setActiveLyricsViewMode] = useState<LyricsViewMode>(() => readRememberedLyricsViewMode());
  const lastDesktopLyricsForwardRef = useRef<string | null>(null);

  useEffect(() => {
    const handleLyricsDrawerToolsChanged = (event: Event): void => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      setLyricsDrawerCurrentTrackTools((event.detail as { currentTrackTools?: ReactNode | null } | null)?.currentTrackTools ?? null);
    };

    window.addEventListener(lyricsDrawerToolsChangedEvent, handleLyricsDrawerToolsChanged);
    return () => window.removeEventListener(lyricsDrawerToolsChangedEvent, handleLyricsDrawerToolsChanged);
  }, []);

  useEffect(() => {
    const handleOpenUserNotice = (): void => {
      setUserNoticeSettingsLoaded(true);
      setUserNoticeReviewOpen(true);
    };

    window.addEventListener(openUserNoticeEvent, handleOpenUserNotice);
    return () => window.removeEventListener(openUserNoticeEvent, handleOpenUserNotice);
  }, []);

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
  const [appAppearanceTheme, setAppAppearanceTheme] = useState<AppThemeMode>(() => readDocumentThemeMode());
  const [loadedAppWallpaperKey, setLoadedAppWallpaperKey] = useState<string | null>(null);
  const [isAppWallpaperDocumentHidden, setIsAppWallpaperDocumentHidden] = useState(() => document.visibilityState === 'hidden');
  const [isAppWallpaperBlurPaused, setIsAppWallpaperBlurPaused] = useState(false);
  const [isAppWallpaperPortraitViewport, setIsAppWallpaperPortraitViewport] = useState(() => isPortraitViewport());
  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const appWallpaperVideoRef = useRef<HTMLVideoElement | null>(null);
  const appWallpaperBlurTimerRef = useRef<number | null>(null);
  const fullscreenTransitionTimerRef = useRef<number | null>(null);
  const fullscreenTransitionStartedAtRef = useRef(0);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lyricsMiniPlayerHostRef = useRef<HTMLDivElement | null>(null);
  const lyricsMiniPlayerAutoHideTimerRef = useRef<number | null>(null);
  const touchOnScreenKeyboardEnabledRef = useRef(false);
  const touchKeyboardLastRequestAtRef = useRef(0);
  const lastAudioErrorRef = useRef<string | null>(null);
  const notifiedWindowsAudioDefaultFormatKeysRef = useRef<Set<string>>(new Set());
  const previousRouteIdRef = useRef<AppRouteId>('songs');
  const routeSwitchSequenceRef = useRef(0);
  const routeSwitchTraceRef = useRef<RouteSwitchTrace | null>(null);
  const routeSwitchCommittedRouteIdRef = useRef<AppRouteId>(activeRouteId);
  const activeRouteIdRef = useRef<AppRouteId>(activeRouteId);
  const downloadImportedTrackIdsRef = useRef<Map<string, string | null>>(new Map());
  const downloadLibraryChangedTimerRef = useRef<number | null>(null);
  const availableRoutes = useMemo(() => [...routes, ...pluginPanelRoutes], [pluginPanelRoutes, routes]);

  const visibleRoutes = useMemo(
    () =>
      applySidebarPreferences(
        availableRoutes.map((route) => (
          (route.id === 'downloads' && !downloadsFeatureUnlocked) ||
          (route.id === 'streaming' && !streamingFeatureEnabled) ||
          (route.id === 'osu-downloader' && !osuDownloaderFeatureEnabled)
            ? { ...route, hideFromSidebar: true }
            : route
        )),
        sidebarLayoutSettings,
      ),
    [availableRoutes, downloadsFeatureUnlocked, osuDownloaderFeatureEnabled, sidebarLayoutSettings, streamingFeatureEnabled],
  );
  const sidebarRouteById = useMemo(() => new Map(availableRoutes.map((route) => [route.id, route])), [availableRoutes]);

  const persistSidebarLayoutPatch = useCallback((patch: Pick<SidebarLayoutSettings, 'sidebarHiddenRouteIds' | 'sidebarRouteOrder'>): void => {
    const nextSettings: Pick<SidebarLayoutSettings, 'sidebarHiddenRouteIds' | 'sidebarRouteOrder'> = {
      sidebarRouteOrder: normalizeSidebarRouteOrder(patch.sidebarRouteOrder),
      sidebarHiddenRouteIds: normalizeSidebarHiddenRouteIds(patch.sidebarHiddenRouteIds),
    };

    setSidebarLayoutSettings((current) => ({
      ...current,
      ...nextSettings,
    }));

    void window.echo?.app?.setSettings?.(nextSettings)
      .then((settings) => {
        window.dispatchEvent(new CustomEvent('settings:changed', { detail: settings }));
      })
      .catch(() => undefined);
  }, []);

  const handleSidebarRouteHide = useCallback(
    (routeId: SidebarRouteId): void => {
      if (lockedVisibleSidebarRouteIdSet.has(routeId) || lockedHiddenSidebarRouteIdSet.has(routeId)) {
        return;
      }

      persistSidebarLayoutPatch({
        sidebarRouteOrder: normalizeSidebarRouteOrder(sidebarLayoutSettings.sidebarRouteOrder),
        sidebarHiddenRouteIds: normalizeSidebarHiddenRouteIds([...normalizeSidebarHiddenRouteIds(sidebarLayoutSettings.sidebarHiddenRouteIds), routeId]),
      });
    },
    [persistSidebarLayoutPatch, sidebarLayoutSettings.sidebarHiddenRouteIds, sidebarLayoutSettings.sidebarRouteOrder],
  );

  const handleSidebarRouteReorder = useCallback(
    (routeIds: SidebarRouteId[], placement: AppRoute['placement']): void => {
      const nextVisibleRouteIds = routeIds.filter((routeId) => sidebarRouteById.get(routeId)?.placement === placement);
      const routeIdSet = new Set(nextVisibleRouteIds);
      const remainingRouteIds = [...nextVisibleRouteIds];
      const currentOrder = normalizeSidebarRouteOrder(sidebarLayoutSettings.sidebarRouteOrder);
      const nextOrder = currentOrder.map((routeId) => {
        const route = sidebarRouteById.get(routeId);
        if (route?.placement !== placement || !routeIdSet.has(routeId)) {
          return routeId;
        }

        return remainingRouteIds.shift() ?? routeId;
      });

      persistSidebarLayoutPatch({
        sidebarRouteOrder: nextOrder,
        sidebarHiddenRouteIds: normalizeSidebarHiddenRouteIds(sidebarLayoutSettings.sidebarHiddenRouteIds),
      });
    },
    [persistSidebarLayoutPatch, sidebarLayoutSettings.sidebarHiddenRouteIds, sidebarLayoutSettings.sidebarRouteOrder, sidebarRouteById],
  );

  const refreshConnectFeatureUnlock = useCallback((): void => {
    const getEchoProAccountStatus = window.echo?.app?.getEchoProAccountStatus;
    if (!getEchoProAccountStatus) {
      return;
    }

    void getEchoProAccountStatus()
      .then((status) => {
        const unlocked = status.pro === true;
        setConnectDonatorUnlocked(unlocked);
      })
      .catch(() => setConnectDonatorUnlocked(false));
  }, []);

  const refreshPluginPanelRoutes = useCallback((): void => {
    const listPlugins = window.echo?.plugins?.list;
    if (!listPlugins) {
      setPluginPanelRoutes([]);
      setEchoProPluginUnlocked(false);
      return;
    }

    void listPlugins()
      .then((result) => {
        setPluginPanelRoutes(createPluginPanelRoutes(result.plugins));
        setEchoProPluginUnlocked(result.plugins.some(isEchoProUnlockPluginActive));
      })
      .catch(() => {
        setPluginPanelRoutes([]);
        setEchoProPluginUnlocked(false);
      });
  }, []);

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
    () =>
      availableRoutes.filter((route) =>
        (route.id !== 'downloads' || downloadsFeatureUnlocked) &&
        (route.id !== 'streaming' || streamingFeatureEnabled) &&
        (route.id !== 'osu-downloader' || osuDownloaderFeatureEnabled),
      ),
    [availableRoutes, downloadsFeatureUnlocked, osuDownloaderFeatureEnabled, streamingFeatureEnabled],
  );
  const activeRoute = useMemo(
    () => navigableRoutes.find((route) => route.id === activeRouteId) ?? navigableRoutes[0] ?? availableRoutes[0],
    [activeRouteId, availableRoutes, navigableRoutes],
  );
  const [mountedPersistentRouteIds, setMountedPersistentRouteIds] = useState<AppRouteId[]>(() =>
    persistentRouteIds.has(activeRouteId) ? [activeRouteId] : [],
  );
  const pruneInactivePersistentRoutes = useCallback((): void => {
    const activeId = activeRouteIdRef.current;
    setMountedPersistentRouteIds((current) => current.filter((routeId) => routeId === activeId && persistentRouteIds.has(routeId)));
  }, []);
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
  useEffect(() => {
    if (!isLyricsRoute && isLyricsVisualDrawerOpen) {
      setIsLyricsVisualDrawerOpen(false);
    }
  }, [isLyricsRoute, isLyricsVisualDrawerOpen]);
  const shouldRenderDragDropImportOverlay = !isStandaloneRoute && activeRouteId !== 'plugins';
  const shouldRenderUserNoticeGate = userNoticeReviewOpen || (userNoticeSettingsLoaded && !userNoticeAccepted);
  const shouldRenderFirstRunWizard = !shouldRenderUserNoticeGate && (isFirstRunWizardOpen || isFirstRunWizardClosing);
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
      '--lyrics-mini-player-visual-opacity': miniPlayerVisualOpacity(opacity).toFixed(2),
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
  const isAmbientThemeActive = appAppearanceTheme === 'ambient';
  const appWallpaperUrl = !isAmbientThemeActive && activeAppWallpaperPath
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
    const acrylicTransparencyPercent = Math.max(0, Math.min(100, appWallpaperSettings.appWindowAcrylicTransparencyPercent ?? 70));
    const acrylicOpacityPercent = 100 - acrylicTransparencyPercent;
    const acrylicReadabilityPercent = Math.max(acrylicOpacityPercent, 32);
    const acrylicTextProtectionPercent = Math.max(acrylicOpacityPercent, 46);
    const acrylicMix = (factor: number, max: number): string => `${Math.round(Math.max(0, Math.min(max, acrylicOpacityPercent * factor)))}%`;
    const acrylicReadableMix = (factor: number, max: number): string => `${Math.round(Math.max(0, Math.min(max, acrylicReadabilityPercent * factor)))}%`;
    const acrylicProtectionMix = (factor: number, max: number): string => `${Math.round(Math.max(0, Math.min(max, acrylicTextProtectionPercent * factor)))}%`;

    return {
      '--app-acrylic-readable-page-strong-mix': acrylicReadableMix(0.82, 52),
      '--app-acrylic-readable-page-muted-mix': acrylicReadableMix(0.66, 46),
      '--app-acrylic-readable-surface-mix': acrylicReadableMix(0.78, 50),
      '--app-acrylic-readable-surface-strong-mix': acrylicReadableMix(1.02, 58),
      '--app-acrylic-readable-sidebar-mix': acrylicReadableMix(0.9, 54),
      '--app-acrylic-readable-player-mix': acrylicReadableMix(1.06, 60),
      '--app-acrylic-text-protection-mix': acrylicProtectionMix(0.34, 28),
      '--app-acrylic-page-strong-mix': acrylicMix(0.95, 58),
      '--app-acrylic-page-muted-mix': acrylicMix(0.78, 52),
      '--app-acrylic-titlebar-mix': acrylicMix(1.24, 70),
      '--app-acrylic-sidebar-strong-mix': acrylicMix(1.12, 66),
      '--app-acrylic-sidebar-muted-mix': acrylicMix(1.02, 62),
      '--app-acrylic-player-strong-mix': acrylicMix(1.42, 74),
      '--app-acrylic-player-mix': acrylicMix(1.22, 70),
      '--app-acrylic-surface-mix': acrylicMix(0.86, 58),
      '--app-acrylic-surface-strong-mix': acrylicMix(1.26, 70),
      '--app-acrylic-surface-muted-mix': acrylicMix(0.72, 54),
      '--app-acrylic-field-mix': acrylicMix(1.32, 74),
      '--app-acrylic-button-mix': acrylicMix(1.18, 72),
      '--app-acrylic-button-hover-mix': acrylicMix(1.56, 82),
      '--app-acrylic-row-mix': acrylicMix(0.72, 54),
      '--app-acrylic-row-hover-mix': acrylicMix(1.18, 70),
      '--app-acrylic-active-mix': acrylicMix(1.34, 76),
      '--app-acrylic-home-shell-strong-mix': acrylicMix(1.04, 64),
      '--app-acrylic-home-shell-muted-mix': acrylicMix(0.72, 54),
      '--app-acrylic-home-hero-strong-mix': acrylicMix(0.96, 62),
      '--app-acrylic-home-hero-mix': acrylicMix(0.66, 54),
      '--app-acrylic-home-hero-muted-mix': acrylicMix(0.52, 48),
      '--app-acrylic-home-now-strong-mix': acrylicMix(1.18, 70),
      '--app-acrylic-home-now-mix': acrylicMix(0.92, 62),
      '--app-acrylic-home-week-mix': acrylicMix(0.68, 52),
      '--app-acrylic-home-activity-mix': acrylicMix(0.56, 48),
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
    appWallpaperSettings.appWindowAcrylicTransparencyPercent,
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

  const clearFirstRunWizardCloseTimer = useCallback((): void => {
    if (firstRunWizardCloseTimerRef.current !== null) {
      clearTimeout(firstRunWizardCloseTimerRef.current);
      firstRunWizardCloseTimerRef.current = null;
    }
  }, []);

  const openFirstRunWizard = useCallback((): void => {
    clearFirstRunWizardCloseTimer();
    firstRunWizardMountedRef.current = true;
    setIsFirstRunWizardClosing(false);
    setIsFirstRunWizardOpen(true);
  }, [clearFirstRunWizardCloseTimer]);

  const closeFirstRunWizard = useCallback((): void => {
    if (!firstRunWizardMountedRef.current) {
      setIsFirstRunWizardClosing(false);
      setIsFirstRunWizardOpen(false);
      return;
    }

    clearFirstRunWizardCloseTimer();
    setIsFirstRunWizardClosing(true);
    firstRunWizardCloseTimerRef.current = setTimeout(() => {
      firstRunWizardMountedRef.current = false;
      firstRunWizardCloseTimerRef.current = null;
      setIsFirstRunWizardOpen(false);
      setIsFirstRunWizardClosing(false);
    }, 220);
  }, [clearFirstRunWizardCloseTimer]);

  useEffect(() => () => clearFirstRunWizardCloseTimer(), [clearFirstRunWizardCloseTimer]);

  useEffect(() => {
    let cancelled = false;

    const applyFirstRunSettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (
        !settings ||
        (!Object.prototype.hasOwnProperty.call(settings, 'onboardingCompleted') &&
          !Object.prototype.hasOwnProperty.call(settings, 'userNoticeAcceptedVersion'))
      ) {
        return;
      }

      setFirstRunSettings((current) => ({ ...(current ?? {}), ...settings }) as AppSettings);
      const hasUserNoticeAcceptedVersion = Object.prototype.hasOwnProperty.call(settings, 'userNoticeAcceptedVersion');
      let nextUserNoticeAccepted = userNoticeAccepted;
      if (hasUserNoticeAcceptedVersion) {
        nextUserNoticeAccepted = settings.userNoticeAcceptedVersion === currentUserNoticeVersion;
      } else if (settings.onboardingCompleted === true) {
        nextUserNoticeAccepted = true;
      }
      if (hasUserNoticeAcceptedVersion) {
        setUserNoticeAccepted(nextUserNoticeAccepted);
        setUserNoticeSettingsLoaded(true);
      } else if (settings.onboardingCompleted === true) {
        setUserNoticeAccepted(true);
        setUserNoticeSettingsLoaded(true);
      }

      if (!nextUserNoticeAccepted) {
        closeFirstRunWizard();
        return;
      }

      if (settings.onboardingCompleted === false) {
        openFirstRunWizard();
      } else {
        closeFirstRunWizard();
      }
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
  }, [closeFirstRunWizard, openFirstRunWizard, userNoticeAccepted]);

  useEffect(() => {
    let cancelled = false;

    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!settings) {
        return;
      }

      if (Object.prototype.hasOwnProperty.call(settings, 'downloadsFeatureUnlocked')) {
        setDownloadsFeatureUnlocked(settings.downloadsFeatureUnlocked === true);
      }

      if (Object.prototype.hasOwnProperty.call(settings, 'streamingFeatureEnabled')) {
        setStreamingFeatureEnabled(settings.streamingFeatureEnabled === true);
      }

      if (Object.prototype.hasOwnProperty.call(settings, 'osuDownloaderFeatureEnabled')) {
        setOsuDownloaderFeatureEnabled(settings.osuDownloaderFeatureEnabled === true);
      }

      if (Object.prototype.hasOwnProperty.call(settings, 'featureCommentsHidden')) {
        setFeatureCommentsHidden(settings.featureCommentsHidden === true);
      }

      if (Object.prototype.hasOwnProperty.call(settings, 'appearanceTheme')) {
        setAppAppearanceTheme(normalizeAppThemeMode(settings.appearanceTheme));
      }

      const hasSidebarRouteOrder = Object.prototype.hasOwnProperty.call(settings, 'sidebarRouteOrder');
      const hasSidebarHiddenRouteIds = Object.prototype.hasOwnProperty.call(settings, 'sidebarHiddenRouteIds');
      const hasSidebarAutoHideEnabled = Object.prototype.hasOwnProperty.call(settings, 'sidebarAutoHideEnabled');
      const hasSidebarIconOnlyEnabled = Object.prototype.hasOwnProperty.call(settings, 'sidebarIconOnlyEnabled');
      if (hasSidebarRouteOrder || hasSidebarHiddenRouteIds || hasSidebarAutoHideEnabled || hasSidebarIconOnlyEnabled) {
        setSidebarLayoutSettings((current) => ({
          sidebarRouteOrder: hasSidebarRouteOrder ? normalizeSidebarRouteOrder(settings.sidebarRouteOrder) : current.sidebarRouteOrder,
          sidebarHiddenRouteIds: hasSidebarHiddenRouteIds ? normalizeSidebarHiddenRouteIds(settings.sidebarHiddenRouteIds) : current.sidebarHiddenRouteIds,
          sidebarAutoHideEnabled: hasSidebarAutoHideEnabled ? settings.sidebarAutoHideEnabled === true : current.sidebarAutoHideEnabled,
          sidebarIconOnlyEnabled: hasSidebarIconOnlyEnabled ? settings.sidebarIconOnlyEnabled === true : current.sidebarIconOnlyEnabled,
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
    refreshConnectFeatureUnlock();
    refreshPluginPanelRoutes();
    const handlePluginsChanged = (): void => {
      refreshConnectFeatureUnlock();
      refreshPluginPanelRoutes();
      window.dispatchEvent(new Event('settings:changed'));
    };
    const handleEchoProStatusChanged = (): void => {
      refreshConnectFeatureUnlock();
      window.dispatchEvent(new Event('settings:changed'));
    };
    window.addEventListener('plugins:changed', handlePluginsChanged);
    window.addEventListener('echo-pro:status-changed', handleEchoProStatusChanged);
    return () => {
      window.removeEventListener('plugins:changed', handlePluginsChanged);
      window.removeEventListener('echo-pro:status-changed', handleEchoProStatusChanged);
    };
  }, [refreshConnectFeatureUnlock, refreshPluginPanelRoutes]);

  useEffect(() => {
    let cancelled = false;

    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!settings || !Object.prototype.hasOwnProperty.call(settings, 'touchOnScreenKeyboardEnabled')) {
        return;
      }

      touchOnScreenKeyboardEnabledRef.current = settings.touchOnScreenKeyboardEnabled === true;
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

    const handleFocusIn = (event: FocusEvent): void => {
      if (!touchOnScreenKeyboardEnabledRef.current || !isTouchKeyboardEditableTarget(event.target)) {
        return;
      }

      const now = Date.now();
      if (now - touchKeyboardLastRequestAtRef.current < 700) {
        return;
      }

      touchKeyboardLastRequestAtRef.current = now;
      void window.echo?.app?.showTouchKeyboard?.().catch(() => undefined);
    };

    refreshSettings();
    window.addEventListener('settings:changed', handleSettingsChanged);
    window.addEventListener('focusin', handleFocusIn);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
      window.removeEventListener('focusin', handleFocusIn);
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
      setIsWindowFocused(false);
      if (appWallpaperBlurTimerRef.current !== null) {
        window.clearTimeout(appWallpaperBlurTimerRef.current);
      }
      appWallpaperBlurTimerRef.current = window.setTimeout(() => {
        appWallpaperBlurTimerRef.current = null;
        setIsAppWallpaperBlurPaused(true);
      }, 15000);
    };
    const handleWindowFocus = (): void => {
      setIsWindowFocused(true);
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
    playbackStatusSnapshot.audioStatus,
    playbackStatusSnapshot.error,
    playbackStatusSnapshot.playbackStatus,
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
      const nextRouteId =
        (routeId === 'streaming' && !streamingFeatureEnabled) ||
        (routeId === 'osu-downloader' && !osuDownloaderFeatureEnabled)
          ? readFallbackRouteId(routes)
          : routeId;
      const nextTrigger = nextRouteId === routeId ? trigger : `${trigger}:blocked`;

      if (nextRouteId === activeRouteId) {
        logRouteSwitchDiagnostic('start', {
          from: activeRouteId,
          to: nextRouteId,
          trigger: nextTrigger,
          result: 'same-route',
          ...getRouteSwitchPlaybackDetails(),
        });
        return;
      }

      if (nextRouteId === 'lyrics' && activeRouteId !== 'lyrics') {
        previousRouteIdRef.current = activeRouteId;
      }

      if (nextRouteId !== 'lyrics') {
        setIsLyricsQueueDrawerOpen(false);
      }

      beginRouteSwitchTrace(nextRouteId, nextTrigger);
      const commitActiveRoute = (): void => setActiveRouteId(nextRouteId);
      if (nextRouteId === 'lyrics' || activeRouteId === 'lyrics') {
        startTransition(commitActiveRoute);
        return;
      }

      commitActiveRoute();
    },
    [activeRouteId, beginRouteSwitchTrace, getRouteSwitchPlaybackDetails, osuDownloaderFeatureEnabled, routes, streamingFeatureEnabled],
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

  useEffect(() => {
    if (!navigableRoutes.some((route) => route.id === activeRouteId) && activeRoute?.id && activeRoute.id !== activeRouteId) {
      navigateRoute(activeRoute.id, 'route-unavailable');
    }
  }, [activeRoute, activeRouteId, navigateRoute, navigableRoutes]);

  useEffect(() => {
    if (activeRouteId === 'streaming' && !streamingFeatureEnabled) {
      navigateRoute(readFallbackRouteId(routes), 'blocked-route-recovery');
    }
  }, [activeRouteId, navigateRoute, routes, streamingFeatureEnabled]);

  useEffect(() => {
    if (activeRouteId === 'osu-downloader' && !osuDownloaderFeatureEnabled) {
      navigateRoute(readFallbackRouteId(routes), 'blocked-route-recovery');
    }
  }, [activeRouteId, navigateRoute, osuDownloaderFeatureEnabled, routes]);

  const setLyricsViewMode = useCallback((mode: LyricsViewMode, deferCommit = false): void => {
    rememberLyricsViewMode(mode);
    const commitLyricsViewMode = (): void => setActiveLyricsViewMode(mode);
    if (deferCommit) {
      startTransition(commitLyricsViewMode);
      return;
    }

    commitLyricsViewMode();
  }, []);

  const handleOpenAudioSettingsDrawer = useCallback((): void => {
    setIsLyricsDrawerOpen(false);
    setIsLyricsVisualDrawerOpen(false);
    setIsMvDrawerOpen(false);
    startTransition(() => setIsAudioDrawerOpen(true));
  }, []);

  const handleOpenLyricsSettingsDrawer = useCallback((): void => {
    setIsAudioDrawerOpen(false);
    setIsLyricsVisualDrawerOpen(false);
    setIsMvDrawerOpen(false);
    startTransition(() => setIsLyricsDrawerOpen(true));
  }, []);

  const handleOpenLyricsVisualSettingsDrawer = useCallback((): void => {
    if (!isLyricsRoute) {
      return;
    }

    setIsAudioDrawerOpen(false);
    setIsLyricsDrawerOpen(false);
    setIsMvDrawerOpen(false);
    setIsLyricsVisualDrawerOpen(true);
  }, [isLyricsRoute]);

  const handleOpenMvSettingsDrawer = useCallback((): void => {
    setIsAudioDrawerOpen(false);
    setIsLyricsDrawerOpen(false);
    setIsLyricsVisualDrawerOpen(false);
    startTransition(() => setIsMvDrawerOpen(true));
  }, []);

  const handleOpenLyricsQueueDrawer = useCallback((): void => {
    startTransition(() => setIsLyricsQueueDrawerOpen(true));
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

  const clearNotificationNotices = useCallback((): void => {
    setChromeNotice(null);
    setIsChromeNoticeVisible(false);
    setAccountNotice(null);
    setUpcomingTrackNotice(null);
    setIsUpcomingTrackNoticeVisible(false);
    setAudioErrorNotice(null);
    setDiagnosticsNotice(false);
    setMemoryPressureNotice(null);
  }, []);

  const showChromeNotice = useCallback((message: string, autoHideMs = defaultChromeNoticeAutoHideMs): void => {
    if (notificationsDisabledRef.current) {
      return;
    }

    setChromeNoticeAutoHideMs(autoHideMs);
    setChromeNotice((current) => (current === message ? current : message));
    setIsChromeNoticeVisible(true);
  }, []);

  const showAudioErrorNotice = useCallback((rawError: string): void => {
    if (notificationsDisabledRef.current) {
      return;
    }

    if (!rawError || rawError === 'Desktop bridge unavailable') {
      return;
    }

    if (isSpotifyPlaybackSetupError(rawError)) {
      return;
    }

    if (shouldSuppressAudioHostError(rawError)) {
      return;
    }

    if (lastAudioErrorRef.current === rawError) {
      return;
    }

    lastAudioErrorRef.current = rawError;
    setAudioErrorNotice({
      message: formatAudioHostError(rawError) ?? rawError,
    });
  }, []);

  useEffect(() => {
    activeRouteIdRef.current = activeRouteId;

    if (persistentRouteIds.has(activeRouteId)) {
      setMountedPersistentRouteIds((current) => (current.includes(activeRouteId) ? current : [...current, activeRouteId]));
    }
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
    if (!shouldAutoShowDiagnosticsCrashNotice()) {
      return;
    }

    void window.echo?.diagnostics
      ?.getLastCrashSummary()
      .then((summary) => {
        if (!notificationsDisabledRef.current) {
          setDiagnosticsNotice(Boolean(summary));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const unsubscribe = window.echo?.diagnostics?.onMemoryPressure?.((event) => {
      pruneInactivePersistentRoutes();
      if (!notificationsDisabledRef.current) {
        setMemoryPressureNotice(event);
      }
    });

    return () => unsubscribe?.();
  }, [pruneInactivePersistentRoutes]);

  useEffect(() => {
    if (!chromeNotice || notificationsDisabled || !isChromeNoticeVisible) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setIsChromeNoticeVisible(false);
    }, chromeNoticeAutoHideMs);

    return () => window.clearTimeout(timer);
  }, [chromeNotice, chromeNoticeAutoHideMs, isChromeNoticeVisible, notificationsDisabled]);

  useEffect(() => {
    const handleShowChromeNotice = (event: Event): void => {
      const message = (event as CustomEvent<string>).detail;
      if (typeof message === 'string' && message.trim()) {
        showChromeNotice(message);
      }
    };

    window.addEventListener(showChromeNoticeEvent, handleShowChromeNotice);
    return () => window.removeEventListener(showChromeNoticeEvent, handleShowChromeNotice);
  }, [showChromeNotice]);

  useEffect(() => {
    if (!upcomingTrackNotice || notificationsDisabled || !upcomingTrackNoticeEnabled) {
      return undefined;
    }

    setIsUpcomingTrackNoticeVisible(true);

    const timer = window.setTimeout(() => {
      setIsUpcomingTrackNoticeVisible(false);
    }, upcomingTrackNoticeAutoHideMs);

    return () => window.clearTimeout(timer);
  }, [notificationsDisabled, upcomingTrackNotice, upcomingTrackNoticeEnabled]);

  useEffect(() => {
    if (notificationsDisabledRef.current || !upcomingTrackNoticeEnabledRef.current) {
      return;
    }

    const clock = getPlaybackClock(playbackStatusSnapshot);
    if (!clock || clock.state !== 'playing') {
      return;
    }

    const durationSeconds = Number.isFinite(clock.durationSeconds) ? clock.durationSeconds : 0;
    const positionSeconds = Number.isFinite(clock.positionSeconds) ? clock.positionSeconds : 0;
    const remainingSeconds = durationSeconds - positionSeconds;
    if (
      durationSeconds <= upcomingTrackNoticeLeadSeconds ||
      positionSeconds < 0 ||
      remainingSeconds <= 0 ||
      remainingSeconds > upcomingTrackNoticeLeadSeconds
    ) {
      return;
    }

    const currentIdentity = clock.trackId ?? playbackQueue.currentQueueId ?? playbackQueue.currentTrackId ?? 'unknown';
    if (lastUpcomingTrackPlaybackIdentityRef.current !== currentIdentity) {
      lastUpcomingTrackPlaybackIdentityRef.current = currentIdentity;
      lastUpcomingTrackNoticeKeyRef.current = null;
    }

    const upcomingItem = resolveUpcomingQueueItem(
      playbackQueue.items,
      playbackQueue.currentQueueId,
      clock.trackId ?? playbackQueue.currentTrackId,
      playbackQueue.repeatMode,
    );
    if (!upcomingItem) {
      return;
    }

    const noticeKey = `${currentIdentity}->${upcomingItem.queueId}:${upcomingItem.track.id}`;
    if (lastUpcomingTrackNoticeKeyRef.current === noticeKey) {
      return;
    }

    lastUpcomingTrackNoticeKeyRef.current = noticeKey;
    setUpcomingTrackNotice({
      key: noticeKey,
      track: upcomingItem.track,
    });
  }, [
    playbackQueue.currentQueueId,
    playbackQueue.currentTrackId,
    playbackQueue.items,
    playbackQueue.repeatMode,
    playbackStatusSnapshot,
  ]);

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
      if (!settings) {
        return;
      }

      if (Object.prototype.hasOwnProperty.call(settings, 'suppressAccountExpiryNotices')) {
        const suppressed = readSuppressAccountExpiryNotices(settings);
        suppressAccountExpiryNoticesRef.current = suppressed;
        if (suppressed) {
          setAccountNotice(null);
        }
      }

      if (Object.prototype.hasOwnProperty.call(settings, 'notificationsDisabled')) {
        const disabled = readNotificationsDisabled(settings);
        notificationsDisabledRef.current = disabled;
        setNotificationsDisabled(disabled);
        if (disabled) {
          clearNotificationNotices();
        }
      }

      if (Object.prototype.hasOwnProperty.call(settings, 'upcomingTrackNoticeEnabled')) {
        const enabled = readUpcomingTrackNoticeEnabled(settings);
        upcomingTrackNoticeEnabledRef.current = enabled;
        setUpcomingTrackNoticeEnabled(enabled);
        if (!enabled) {
          setUpcomingTrackNotice(null);
          setIsUpcomingTrackNoticeVisible(false);
        }
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
  }, [clearNotificationNotices]);

  useEffect(() => {
    const unsubscribe = window.echo?.accounts?.onStatusesChanged?.((statuses: AccountStatus[]) => {
      if (notificationsDisabledRef.current || suppressAccountExpiryNoticesRef.current) {
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
    if (rawError) {
      showAudioErrorNotice(rawError);
    }
  }, [playbackStatusSnapshot.audioStatus?.error, playbackStatusSnapshot.error, showAudioErrorNotice]);

  useEffect(() => {
    const handleShowAudioErrorNotice = (event: Event): void => {
      const message = readAudioErrorNoticeMessage(event);
      if (message) {
        showAudioErrorNotice(message);
      }
    };

    window.addEventListener(showAudioErrorNoticeEvent, handleShowAudioErrorNotice);
    return () => window.removeEventListener(showAudioErrorNoticeEvent, handleShowAudioErrorNotice);
  }, [showAudioErrorNotice]);

  useEffect(() => {
    if (notificationsDisabledRef.current) {
      return;
    }

    const rate = getWindowsAudioDefaultFormatWarningRate(playbackStatusSnapshot.audioStatus?.warnings);
    if (!rate || !Number.isFinite(rate)) {
      return;
    }

    const noticeKey = `windows-default-format:${Math.round(rate)}`;
    if (notifiedWindowsAudioDefaultFormatKeysRef.current.has(noticeKey)) {
      return;
    }

    notifiedWindowsAudioDefaultFormatKeysRef.current.add(noticeKey);
    showChromeNotice(t('notice.audioDefaultFormatWarning', { rate: formatAudioNoticeRate(rate) }), quickAudioNoticeAutoHideMs);
  }, [playbackStatusSnapshot.audioStatus?.warnings, showChromeNotice, t]);

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
      if (status.state !== 'available' && status.state !== 'downloading' && status.state !== 'downloaded') {
        setAvailableUpdateStatus(null);
        setIsUpdateNoticeVisible(false);
        return;
      }

      setAvailableUpdateStatus(status);
      setIsUpdateNoticeVisible(true);
    };

    const unsubscribe = window.echo?.app?.onUpdateStatus?.(notifyUpdateStatus);
    void window.echo?.app?.getUpdateStatus?.().then(notifyUpdateStatus).catch(() => undefined);

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshLyricsMiniPlayerSettings = (event?: Event): void => {
      const patch = (event as CustomEvent<Partial<AppSettings>> | undefined)?.detail;
      if (
        patch &&
        ('lyricsPlayerBarDrawerEnabled' in patch ||
          'lyricsPlayerBarDrawerAutoEnableForMv' in patch ||
          'lyricsPlayerBarDrawerAutoHideEnabled' in patch ||
          'lyricsPlayerBarDrawerCompactOnIdleEnabled' in patch ||
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
      if (clientY >= window.innerHeight - lyricsMiniPlayerAutoHideRevealBandPx) {
        return true;
      }

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
          'appWindowAcrylicEnabled' in patch ||
          'appWindowAcrylicKeepWhenUnfocusedEnabled' in patch ||
          'appWindowAcrylicTransparencyPercent' in patch ||
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
          appWindowAcrylicEnabled: 'appWindowAcrylicEnabled' in patch
            ? (patch.appWindowAcrylicEnabled === true)
            : current.appWindowAcrylicEnabled,
          appWindowAcrylicKeepWhenUnfocusedEnabled: 'appWindowAcrylicKeepWhenUnfocusedEnabled' in patch
            ? (patch.appWindowAcrylicKeepWhenUnfocusedEnabled === true)
            : current.appWindowAcrylicKeepWhenUnfocusedEnabled,
          appWindowAcrylicTransparencyPercent: 'appWindowAcrylicTransparencyPercent' in patch && Number.isFinite(patch.appWindowAcrylicTransparencyPercent)
            ? Math.max(0, Math.min(100, Math.round(Number(patch.appWindowAcrylicTransparencyPercent))))
            : current.appWindowAcrylicTransparencyPercent,
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
      if (typeof detail !== 'string' || !availableRoutes.some((route) => route.id === detail)) {
        return;
      }

      navigateRoute(detail as AppRouteId);
    };
    const handleNavigateImportFolder = (): void => {
      navigateRoute('import-folder');
    };
    const handleNavigateQueue = (): void => {
      if (isLyricsRoute) {
        startTransition(() => setIsLyricsQueueDrawerOpen((current) => !current));
        return;
      }

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

          setLyricsViewMode(detail.mode, true);
          return;
        }

        setLyricsViewMode(detail.mode, true);
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
  }, [activeLyricsViewMode, activeRouteId, availableRoutes, isLyricsRoute, navigateRoute, navigableRoutes, routes, setLyricsViewMode]);

  useEffect(() => {
    window.addEventListener(openAudioSettingsEvent, handleOpenAudioSettingsDrawer);
    window.addEventListener(openMvSettingsEvent, handleOpenMvSettingsDrawer);
    window.addEventListener(openLyricsSettingsEvent, handleOpenLyricsSettingsDrawer);
    window.addEventListener(openLyricsVisualSettingsEvent, handleOpenLyricsVisualSettingsDrawer);
    return () => {
      window.removeEventListener(openAudioSettingsEvent, handleOpenAudioSettingsDrawer);
      window.removeEventListener(openMvSettingsEvent, handleOpenMvSettingsDrawer);
      window.removeEventListener(openLyricsSettingsEvent, handleOpenLyricsSettingsDrawer);
      window.removeEventListener(openLyricsVisualSettingsEvent, handleOpenLyricsVisualSettingsDrawer);
    };
  }, [
    handleOpenAudioSettingsDrawer,
    handleOpenLyricsSettingsDrawer,
    handleOpenLyricsVisualSettingsDrawer,
    handleOpenMvSettingsDrawer,
  ]);

  const handleAudioDrawerStatusChange = useCallback((status: AudioStatus | null): void => {
    setAudioDrawerStatus(status);
    setPlaybackStatusSnapshot({ audioStatus: status, error: status?.error ?? null });
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
        const useMiniaudioOutput =
          settings?.audioUseMiniaudioOutput === true || settings?.audioMiniaudioOutputExperimentalEnabled === true;
        const useLibavDecode = settings?.audioUseLibavDecode === true;
        const nativeDirectLocalPlaybackEnabled = settings?.audioNativeDirectLocalPlaybackEnabled === true;
        const dsdOutputMode = settings?.audioDsdOutputMode === 'dop' ? 'dop' : 'pcm';
        const sdmMode = normalizeSdmMode(settings?.audioSdmMode);
        const sdmTargetRate = normalizeSdmTargetRate(settings?.audioSdmTargetRate);
        const sdmQualityProfile = normalizeSdmQualityProfile(settings?.audioSdmQualityProfile);
        const sdmComputeBackend = normalizeSdmComputeBackend(settings?.audioSdmComputeBackend);
        const sdmOversamplingFilterProfile1x = normalizeEchoSrcFilterProfile(settings?.audioSdmOversamplingFilterProfile1x, 'poly-sinc-ext2-long');
        const sdmOversamplingFilterProfileNx = normalizeEchoSrcFilterProfile(settings?.audioSdmOversamplingFilterProfileNx, 'poly-sinc-ext2-hires-lp');
        const exclusiveInstabilityFallbackEnabled = settings?.audioExclusiveInstabilityFallbackEnabled === true;
        const soxrFallbackEnabled = settings?.audioSoxrFallbackEnabled !== false;
        const echoSrcMode = settings?.audioEchoSrcMode === 'family2x' || settings?.audioEchoSrcMode === 'family4x' || settings?.audioEchoSrcMode === 'family8x'
          ? settings.audioEchoSrcMode
          : 'off';
        const echoSrcQualityProfile =
          settings?.audioEchoSrcQualityProfile === 'balanced' || settings?.audioEchoSrcQualityProfile === 'lowLatency'
            ? settings.audioEchoSrcQualityProfile
            : 'transparent';
        const echoSrcAdvancedModeEnabled = settings?.audioEchoSrcAdvancedModeEnabled === true;
        const echoSrcFilterProfile = normalizeEchoSrcFilterProfile(settings?.audioEchoSrcFilterProfile);
        const echoSrcFilterProfile1x = normalizeEchoSrcFilterProfile(settings?.audioEchoSrcFilterProfile1x, echoSrcFilterProfile);
        const echoSrcFilterProfileNx = normalizeEchoSrcFilterProfile(settings?.audioEchoSrcFilterProfileNx, 'poly-sinc-hb');
        const echoSrcComputeBackend = settings?.audioEchoSrcComputeBackend === 'cuda' ? 'cuda' : 'cpu';
        const pcmDitherMode = normalizePcmDitherMode(settings?.audioPcmDitherMode);
        const releaseExclusiveOnPauseExperimentalEnabled = settings?.audioReleaseExclusiveOnPauseExperimentalEnabled === true;
        if (!remembered.enabled) {
          return audio
            .setOutput({
              useMiniaudioOutput,
              useLibavDecode,
              nativeDirectLocalPlaybackEnabled,
              dsdOutputMode,
              sdmMode,
              sdmTargetRate,
              sdmQualityProfile,
              sdmComputeBackend,
              sdmOversamplingFilterProfile1x,
              sdmOversamplingFilterProfileNx,
              exclusiveInstabilityFallbackEnabled,
              soxrFallbackEnabled,
              echoSrcMode,
              echoSrcQualityProfile,
              echoSrcAdvancedModeEnabled,
              echoSrcFilterProfile,
              echoSrcFilterProfile1x,
              echoSrcFilterProfileNx,
              echoSrcComputeBackend,
              pcmDitherMode,
              releaseExclusiveOnPauseExperimentalEnabled,
            })
            .then(handleAudioDrawerStatusChange);
        }

        return audio
          .setOutput({
            outputMode: remembered.outputMode,
            sharedBackend: remembered.sharedBackend,
            latencyProfile: remembered.latencyProfile,
            deviceIndex: remembered.deviceIndex,
            deviceName: remembered.deviceName,
            useMiniaudioOutput,
            useLibavDecode,
            nativeDirectLocalPlaybackEnabled,
            dsdOutputMode,
            sdmMode,
            sdmTargetRate,
            sdmQualityProfile,
            sdmComputeBackend,
            sdmOversamplingFilterProfile1x,
            sdmOversamplingFilterProfileNx,
            exclusiveInstabilityFallbackEnabled,
            soxrFallbackEnabled,
            echoSrcMode,
            echoSrcQualityProfile,
            echoSrcAdvancedModeEnabled,
            echoSrcFilterProfile,
            echoSrcFilterProfile1x,
            echoSrcFilterProfileNx,
            echoSrcComputeBackend,
            pcmDitherMode,
            releaseExclusiveOnPauseExperimentalEnabled,
          })
          .then(handleAudioDrawerStatusChange);
      })
      .catch((error) => {
        console.error('Failed to restore remembered audio output', error);
      });
  }, [handleAudioDrawerStatusChange]);

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
      showChromeNotice(t('notice.browserFolderPicker'));
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
  }, [notifyLibraryChanged, showChromeNotice, t]);

  const handleImportFile = useCallback(async (): Promise<void> => {
    const playback = window.echo?.playback;
    const library = window.echo?.library;

    if (!library?.chooseImportFiles && !playback) {
      fileInputRef.current?.click();
      showChromeNotice(t('notice.browserFolderPicker'));
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
        showChromeNotice(details || t('notice.importFiles.empty'));
        return;
      }

      const result = await playbackQueue.openTemporaryLocalFiles(filePaths);
      navigateRoute('queue');
      if (result.rejected.length > 0) {
        showChromeNotice(t('notice.openFiles.partial', { opened: result.tracks.length, rejected: result.rejected.length }));
      }
    } catch (error) {
      console.error('Failed to open local audio file from app chrome', error);
    }
  }, [navigateRoute, notifyLibraryChanged, playbackQueue, showChromeNotice, t]);

  useEffect(() => {
    const handleAppImportFile = (): void => {
      void handleImportFile();
    };

    window.addEventListener('app:import-file', handleAppImportFile);
    return () => window.removeEventListener('app:import-file', handleAppImportFile);
  }, [handleImportFile]);

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
            showChromeNotice(t('notice.openFiles.partial', { opened: result.tracks.length, rejected: result.rejected.length }));
          }
        })
        .catch((error) => {
          console.error('Failed to open local audio files from system', error);
        });
    });

    return () => unsubscribe?.();
  }, [navigateRoute, playbackQueue, showChromeNotice, t]);

  const handleWindowAction = useCallback(
    async (action: 'minimize' | 'toggleMaximize' | 'toggleFullscreen' | 'close'): Promise<void> => {
      const appApi = window.echo?.app;

      if (!appApi) {
        showChromeNotice(t('notice.windowControlsDesktop'));
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
    [isWindowFullscreen, showChromeNotice, startWindowFullscreenTransition, t],
  );

  const handleOpenUpdateSettings = useCallback((): void => {
    try {
      window.sessionStorage.setItem(pendingSettingsSectionStorageKey, 'about');
      window.localStorage.setItem(pendingSettingsSectionStorageKey, 'about');
    } catch {
      // SettingsPage falls back to the normal settings entrypoint when storage is unavailable.
    }

    setIsAudioDrawerOpen(false);
    setIsLyricsDrawerOpen(false);
    setIsLyricsVisualDrawerOpen(false);
    setIsMvDrawerOpen(false);
    navigateRoute('settings');
    window.dispatchEvent(new CustomEvent(settingsSectionNavigationEvent, { detail: { section: 'about' } }));
  }, [navigateRoute]);

  const handleStartUpdate = useCallback(async (): Promise<void> => {
    const appApi = window.echo?.app;
    if (!appApi?.downloadUpdate) {
      handleOpenUpdateSettings();
      return;
    }

    setUpdateActionBusy(true);
    try {
      setAvailableUpdateStatus(await appApi.downloadUpdate());
    } finally {
      setUpdateActionBusy(false);
    }
  }, [handleOpenUpdateSettings]);

  const showReportOpenedNotice = useCallback(
    (format: 'markdown' | 'text', reportPath: string | undefined): void => {
      const messageKey = format === 'text' ? 'notice.reportOpenedText' : 'notice.reportOpenedMarkdown';
      const pathMessageKey = format === 'text' ? 'notice.reportOpenedTextPath' : 'notice.reportOpenedMarkdownPath';
      showChromeNotice(reportPath ? t(pathMessageKey, { path: reportPath }) : t(messageKey));
    },
    [showChromeNotice, t],
  );

  const handleOpenCrashReportNotice = useCallback(async (format: 'markdown' | 'text' = 'markdown'): Promise<void> => {
    try {
      const reportPath = format === 'text'
        ? await window.echo?.diagnostics.openCrashTextReport()
        : await window.echo?.diagnostics.openCrashReport();
      setDiagnosticsNotice(false);
      showReportOpenedNotice(format, reportPath);
    } catch (error) {
      showChromeNotice(error instanceof Error ? error.message : String(error));
    }
  }, [showChromeNotice, showReportOpenedNotice]);

  const handleDismissDiagnosticsNotice = useCallback(async (): Promise<void> => {
    setDiagnosticsNotice(false);
    await window.echo?.diagnostics.clearLastCrashSummary().catch(() => undefined);
  }, []);

  const handleOpenAudioCrashReport = useCallback(async (format: 'markdown' | 'text' = 'markdown'): Promise<void> => {
    try {
      const reportPath = format === 'text'
        ? await window.echo?.diagnostics.openAudioCrashTextReport()
        : await window.echo?.diagnostics.openAudioCrashReport();
      showReportOpenedNotice(format, reportPath);
    } catch (error) {
      showChromeNotice(error instanceof Error ? error.message : String(error));
    }
  }, [showChromeNotice, showReportOpenedNotice]);

  const handleOpenMemoryPressureReport = useCallback(async (): Promise<void> => {
    try {
      const reportPath = await window.echo?.diagnostics.openMemoryPressureReport();
      setMemoryPressureNotice(null);
      showChromeNotice(reportPath ? t('notice.reportOpenedPath', { path: reportPath }) : t('notice.reportOpened'));
    } catch (error) {
      showChromeNotice(error instanceof Error ? error.message : String(error));
    }
  }, [showChromeNotice, t]);

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

    showChromeNotice(t('notice.browserFilePicker', { name: `${files.length} file(s)` }));
  };

  const handleBrowserFilePicked = (files: FileList | null): void => {
    const file = files?.[0];

    if (!file) {
      return;
    }

    showChromeNotice(t('notice.browserFilePicker', { name: `"${file.name}"` }));
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

  const handleRevealDesktopLyricsMenu = useCallback(async (): Promise<void> => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics?.revealMenu) {
      return;
    }

    try {
      const state = await desktopLyrics.revealMenu();
      setDesktopLyricsVisible(state.visible === true);
      setDesktopLyricsLocked(state.locked === true);
    } catch {
      setDesktopLyricsVisible((current) => current);
      setDesktopLyricsLocked((current) => current);
    }
  }, []);

  const updateNoticeVersion = availableUpdateStatus?.latestVersion ?? availableUpdateStatus?.releaseName ?? null;
  const updateNoticeMessage = availableUpdateStatus?.state === 'downloaded'
    ? (updateNoticeVersion ? t('notice.updateDownloadedVersion', { version: updateNoticeVersion }) : t('notice.updateDownloaded'))
    : (updateNoticeVersion ? t('notice.updateAvailableVersion', { version: updateNoticeVersion }) : t('notice.updateAvailable'));
  const updateActionDisabled = updateActionBusy || availableUpdateStatus?.state === 'downloading' || availableUpdateStatus?.state === 'downloaded';
  const updateActionLabel = availableUpdateStatus?.state === 'downloading'
    ? t('settings.about.updates.progress.downloading')
    : t('notice.action.updateNow');

  return (
    <div
      className={`app-shell ${isStandaloneRoute ? 'app-shell--standalone' : ''} ${isLyricsRoute ? 'app-shell--lyrics' : ''} ${
        shouldUseLyricsPlayerDrawer ? 'app-shell--lyrics-player-drawer app-shell--lyrics-mini-player' : ''
      } ${
        shouldShowAppWallpaperVisual ? 'app-shell--wallpaper' : ''
      } ${
        shouldShowAppWallpaperVisual && isAppWallpaperReady ? 'app-shell--wallpaper-ready' : ''
      } ${
        appWallpaperSettings.appWindowAcrylicEnabled ? 'app-shell--acrylic' : ''
      } ${
        isLyricsVisualDrawerOpen ? 'app-shell--lyrics-visual-drawer-open' : ''
      } ${
        sidebarLayoutSettings.sidebarAutoHideEnabled ? 'app-shell--sidebar-auto-hide' : ''
      } ${
        sidebarLayoutSettings.sidebarIconOnlyEnabled && !sidebarLayoutSettings.sidebarAutoHideEnabled ? 'app-shell--sidebar-icon-only' : ''
      }`}
      data-wallpaper-unified-opacity={shouldShowAppWallpaperVisual && isAppWallpaperReady && appWallpaperSettings.appWallpaperUnifiedOpacityEnabled ? 'true' : undefined}
      data-wallpaper-visual-protection={
        shouldShowAppWallpaperVisual && isAppWallpaperReady ? (appWallpaperSettings.appWallpaperVisualProtectionEnabled ? 'true' : 'false') : undefined
      }
      data-wallpaper-ui-transparent={shouldShowAppWallpaperVisual && isAppWallpaperUiTransparent ? 'true' : undefined}
      data-wallpaper-ui-zero={shouldShowAppWallpaperVisual && isAppWallpaperUiZero ? 'true' : undefined}
      data-wallpaper-orientation={shouldShowAppWallpaperVisual ? activeAppWallpaperOrientation : undefined}
      data-window-acrylic={appWallpaperSettings.appWindowAcrylicEnabled ? 'true' : undefined}
      data-window-acrylic-keep-unfocused={appWallpaperSettings.appWindowAcrylicEnabled && appWallpaperSettings.appWindowAcrylicKeepWhenUnfocusedEnabled ? 'true' : undefined}
      data-window-focused={isWindowFocused ? 'true' : 'false'}
      data-feature-comments-hidden={featureCommentsHidden ? 'true' : undefined}
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
        isLyricsVisualSettingsOpen={isLyricsVisualDrawerOpen}
        isMvSettingsOpen={isMvDrawerOpen}
        isProUnlocked={connectDonatorUnlocked || echoProPluginUnlocked}
        updateStatus={availableUpdateStatus}
        onRouteChange={navigateRoute}
        onOpenUpdateSettings={handleOpenUpdateSettings}
        onOpenAudioSettings={handleOpenAudioSettingsDrawer}
        onOpenLyricsSettings={handleOpenLyricsSettingsDrawer}
        onOpenLyricsVisualSettings={handleOpenLyricsVisualSettingsDrawer}
        onOpenMvSettings={handleOpenMvSettingsDrawer}
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
          iconOnly={sidebarLayoutSettings.sidebarIconOnlyEnabled && !sidebarLayoutSettings.sidebarAutoHideEnabled}
          onRouteChange={navigateRoute}
          onOpenAudioSettings={handleOpenAudioSettingsDrawer}
          onOpenLyricsSettings={handleOpenLyricsSettingsDrawer}
          onImportFolder={() => void handleImportFolder()}
          onImportFile={() => void handleImportFile()}
          onHideRoute={handleSidebarRouteHide}
          onReorderRoutes={handleSidebarRouteReorder}
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
          <AnimatedOutlet
            className={`page-surface ${routeIsStandalone ? 'page-surface--standalone' : ''}`}
            hidden={!isActive}
            isActive={isActive}
            key={route.id}
            routeId={route.id}
          >
            <Suspense fallback={<RouteLoadingFallback />}>
              {routeElement}
            </Suspense>
          </AnimatedOutlet>
        );
      })}

      <EditableContextMenu />

      {shouldRenderDragDropImportOverlay ? <DragDropImportOverlay onNotice={showChromeNotice} /> : null}

      {shouldRenderUserNoticeGate ? (
        <UserNoticeGate
          onAccepted={(settings) => {
            setUserNoticeSettingsLoaded(true);
            setUserNoticeAccepted(true);
            setUserNoticeReviewOpen(false);
            if (settings) {
              setFirstRunSettings(settings);
              setAppWallpaperSettings(selectAppWallpaperSettings(settings));
              setLyricsMiniPlayerSettings(selectLyricsMiniPlayerSettings(settings));
            }
          }}
        />
      ) : null}

      {shouldRenderFirstRunWizard ? (
        <FirstRunWizard
          initialSettings={firstRunSettings}
          presentationState={isFirstRunWizardClosing ? 'closing' : 'open'}
          onClose={closeFirstRunWizard}
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

      <div className="chrome-notice-layer">
        <ChromeNoticePresence
          ariaLive="polite"
          className="chrome-notice--update"
          role="status"
          show={!notificationsDisabled && Boolean(availableUpdateStatus) && isUpdateNoticeVisible}
        >
          {availableUpdateStatus ? (
            <>
              <span className="chrome-notice-message">{updateNoticeMessage}</span>
              <div className="chrome-notice-actions">
                <button type="button" disabled={updateActionDisabled} onClick={() => void handleStartUpdate()}>
                  {updateActionLabel}
                </button>
                <button type="button" onClick={handleOpenUpdateSettings}>
                  {t('notice.action.viewUpdateDetails')}
                </button>
                <button type="button" onClick={() => setIsUpdateNoticeVisible(false)}>
                  {t('notice.action.close')}
                </button>
              </div>
            </>
          ) : null}
        </ChromeNoticePresence>

        <ChromeNoticePresence
          onExited={() => setChromeNotice(null)}
          role="status"
          show={!notificationsDisabled && Boolean(chromeNotice) && isChromeNoticeVisible}
        >
          <span className="chrome-notice-message">{chromeNotice}</span>
          <button className="chrome-notice-close" type="button" aria-label={t('notice.action.closeNotice')} title={t('notice.action.closeNotice')} onClick={dismissChromeNotice}>
            <X size={14} />
          </button>
        </ChromeNoticePresence>

        <ChromeNoticePresence
          ariaLive="polite"
          className="upcoming-track-notice"
          onExited={() => setUpcomingTrackNotice(null)}
          role="status"
          show={!notificationsDisabled && upcomingTrackNoticeEnabled && Boolean(upcomingTrackNotice) && isUpcomingTrackNoticeVisible}
        >
          {upcomingTrackNotice ? (
            <>
              <div className="upcoming-track-notice__cover" data-empty={!upcomingTrackNotice.track.coverThumb}>
                {upcomingTrackNotice.track.coverThumb ? (
                  <img
                    alt={t('notice.upcomingTrack.coverAlt', { title: upcomingTrackNotice.track.title })}
                    src={upcomingTrackNotice.track.coverThumb}
                  />
                ) : (
                  <span aria-hidden="true" />
                )}
              </div>
              <div className="upcoming-track-notice__copy">
                <span>{t('notice.upcomingTrack.kicker')}</span>
                <strong title={upcomingTrackNotice.track.title}>{upcomingTrackNotice.track.title}</strong>
                <em title={upcomingTrackNotice.track.artist || t('queue.unknownArtist')}>
                  {upcomingTrackNotice.track.artist || t('queue.unknownArtist')}
                </em>
                <small title={upcomingTrackNotice.track.album || t('queue.unknownAlbum')}>
                  {upcomingTrackNotice.track.album || t('queue.unknownAlbum')}
                </small>
              </div>
              <button
                className="chrome-notice-close"
                type="button"
                aria-label={t('notice.action.closeNotice')}
                title={t('notice.action.closeNotice')}
                onClick={() => setIsUpcomingTrackNoticeVisible(false)}
              >
                <X size={14} />
              </button>
            </>
          ) : null}
        </ChromeNoticePresence>

        <ChromeNoticePresence
          ariaLive="assertive"
          className="chrome-notice--memory-pressure"
          role="alert"
          show={!notificationsDisabled && Boolean(memoryPressureNotice)}
        >
          {memoryPressureNotice ? (
            <>
              <strong>{t('notice.memoryPressure.title')}</strong>
              <span>
                {t('notice.memoryPressure.description', {
                  process: memoryPressureNotice.topProcessType,
                  processMemory: formatMemoryNoticeBytes(memoryPressureNotice.topProcessWorkingSetBytes),
                  threshold: formatMemoryNoticeBytes(memoryPressureNotice.thresholdBytes),
                  usage: formatMemoryNoticeBytes(memoryPressureNotice.totalWorkingSetBytes),
                })}
              </span>
              <small>{t('notice.memoryPressure.reportReady')}</small>
              <div className="chrome-notice-actions">
                <button type="button" onClick={() => void handleOpenMemoryPressureReport()}>
                  {t('notice.action.openReport')}
                </button>
                <button type="button" onClick={() => setMemoryPressureNotice(null)}>
                  {t('notice.action.close')}
                </button>
              </div>
            </>
          ) : null}
        </ChromeNoticePresence>

        <ChromeNoticePresence
          className="chrome-notice--diagnostics"
          role="status"
          show={!notificationsDisabled && diagnosticsNotice}
        >
          <span>{t('notice.diagnosticsCrash.description')}</span>
          <div className="chrome-notice-actions">
            <button type="button" onClick={() => void handleOpenCrashReportNotice('markdown')}>
              {t('notice.action.openMarkdownReport')}
            </button>
            <button type="button" onClick={() => void handleOpenCrashReportNotice('text')}>
              {t('notice.action.openTextReport')}
            </button>
            <button type="button" onClick={() => void handleDismissDiagnosticsNotice()}>
              {t('notice.action.ignore')}
            </button>
          </div>
        </ChromeNoticePresence>

        <ChromeNoticePresence
          className="chrome-notice--account"
          role="alert"
          show={!notificationsDisabled && Boolean(accountNotice)}
        >
          {accountNotice ? (
            <>
              <strong>{t('notice.accountExpired.title')}</strong>
              <span>{accountNotice}</span>
            </>
          ) : null}
        </ChromeNoticePresence>

        <ChromeNoticePresence
          className="chrome-notice--audio-error"
          role="alert"
          show={!notificationsDisabled && Boolean(audioErrorNotice)}
        >
          {audioErrorNotice ? (
            <>
              <strong>{t('notice.audioError.title')}</strong>
              <span>{audioErrorNotice.message}</span>
              <small>{t('notice.audioError.description')}</small>
              <div className="chrome-notice-actions">
                <button type="button" onClick={() => void handleOpenAudioCrashReport('markdown')}>
                  {t('notice.action.openMarkdownReport')}
                </button>
                <button type="button" onClick={() => void handleOpenAudioCrashReport('text')}>
                  {t('notice.action.openTextReport')}
                </button>
                <button type="button" onClick={() => setAudioErrorNotice(null)}>
                  {t('notice.action.close')}
                </button>
              </div>
            </>
          ) : null}
        </ChromeNoticePresence>
      </div>

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
        onStatusChange={handleAudioDrawerStatusChange}
      />
      <LyricsSettingsDrawer
        currentTrackTools={lyricsDrawerCurrentTrackTools}
        isOpen={isLyricsDrawerOpen}
        onClose={() => setIsLyricsDrawerOpen(false)}
      />
      <LyricsVisualSettingsDrawer
        isOpen={isLyricsVisualDrawerOpen}
        onClose={() => setIsLyricsVisualDrawerOpen(false)}
      />
      <MvSettingsDrawer isOpen={isMvDrawerOpen} onClose={() => setIsMvDrawerOpen(false)} />
      <PluginTrackActionDrawerHost />
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
            desktopLyricsVisible={desktopLyricsVisible}
            hasDesktopLyricsBridge={hasDesktopLyricsBridge}
            lyricsCompactOnIdle={lyricsMiniPlayerSettings.lyricsPlayerBarDrawerCompactOnIdleEnabled === true}
            lyricsMiniPlayer={shouldUseLyricsPlayerDrawer}
            onOpenAudioSettings={handleOpenAudioSettingsDrawer}
            onOpenQueue={isLyricsRoute ? handleOpenLyricsQueueDrawer : handleOpenShellQueue}
            showQueueButton={true}
            showSignalPathControl={!isLyricsRoute && signalPathControlEnabled}
            onRevealDesktopLyricsMenu={() => void handleRevealDesktopLyricsMenu()}
            onToggleDesktopLyrics={handleToggleDesktopLyrics}
          />
        </div>
      ) : null}
    </div>
  );
};
