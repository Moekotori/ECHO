import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { Clipboard, Film, Music2, X } from 'lucide-react';
import type { AudioPlaybackState } from '../../../shared/types/audio';
import type { LibraryTrack } from '../../../shared/types/library';
import type { MvMatchCandidate, MvSettings, MvTrackSnapshotSearchRequest, TrackVideo } from '../../../shared/types/mv';
import type { StreamingMvItem, StreamingProviderName } from '../../../shared/types/streaming';
import { clampMvOffsetMs } from '../../../shared/constants/mvOffset';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { sampleVideoElement } from './lyricsReadableColor';
import { mvDiagnosticsPreferenceChangedEvent, readMvDiagnosticsEnabled } from './mvDiagnostics';

export type MvAudioClock = {
  positionSeconds: number;
  updatedAtMs: number;
  playbackRate: number;
  durationSeconds: number | null;
  state: AudioPlaybackState;
};

type MvPanelProps = {
  trackId: string | null;
  currentTrack?: LibraryTrack | null;
  streamingTarget?: {
    provider: StreamingProviderName;
    providerTrackId: string;
  } | null;
  title: string;
  artist: string;
  coverUrl: string | null;
  hideFallbackTrackInfo?: boolean;
  smartReadableColorsEnabled?: boolean;
  isAudioPlaying: boolean;
  audioClock: MvAudioClock;
};

type BrowserShaka = {
  Player: new (video: HTMLVideoElement) => {
    load: (url: string) => Promise<void>;
    destroy: () => Promise<void>;
  };
};

type ShakaPlayerInstance = {
  load: (url: string) => Promise<void>;
  destroy: () => Promise<void>;
};

const fallbackMvSettings: MvSettings = {
  enabled: true,
  autoSearch: true,
  autoPreload: true,
  autoApplyThreshold: 0.7,
  preferHighestViewCount: false,
  immersiveBackground: true,
  immersiveBackgroundAutoScale: true,
  immersiveBackgroundScalePercent: 115,
  immersiveBackgroundOffsetXPercent: 50,
  immersiveBackgroundOffsetYPercent: 50,
  immersiveBackgroundBlurPx: 0,
  immersiveBackgroundBrightnessPercent: 100,
  immersiveBackgroundOverlayOpacityPercent: 0,
  lyricsReadabilityEnhanced: false,
  hideLyrics: false,
  restartAudioOnLoad: false,
  syncMode: 'balanced',
  replayAudioOnChange: true,
  enabledProviders: ['bilibili', 'youtube'],
  providerOrder: ['bilibili', 'youtube'],
  maxQuality: 'max',
  allow60fps: true,
};

const isAdaptiveStream = (video: TrackVideo | null): boolean =>
  Boolean(
    video?.mimeType &&
      (video.mimeType.includes('mpegurl') ||
        video.mimeType.includes('dash') ||
        video.mimeType.includes('application/vnd.apple.mpegurl')),
  );

const isUnplayableSearchCandidate = (video: TrackVideo | null): boolean =>
  Boolean(video && video.sourceType === 'search_candidate' && (!video.playableInApp || !video.mediaUrl));

type Translate = (key: TranslationKey, options?: Record<string, string | number>) => string;

const rawProviderRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const isBilibiliPlayurlBlocked = (video: TrackVideo | null): boolean => {
  if (video?.provider !== 'bilibili') {
    return false;
  }

  const raw = rawProviderRecord(video.rawProviderJson);
  return raw?.unavailableReason === 'bilibili-playurl-blocked';
};

const summarizeMvLoadError = (message: string, t: Translate): string => {
  if (/MV database is temporarily unavailable|database disk image is malformed|DatabaseHealthError|SQLITE_CORRUPT|file is not a database/i.test(message)) {
    return t('mvPanel.status.databaseUnread');
  }
  if (/network|fetch|timeout|ECONN|ENOTFOUND/i.test(message)) {
    return t('mvPanel.status.networkFailed');
  }

  return message.trim() || t('mvPanel.status.loadFailed');
};

const isMvDatabaseLoadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /MV database is temporarily unavailable|database disk image is malformed|DatabaseHealthError|SQLITE_CORRUPT|file is not a database/i.test(message);
};

const getUnavailableReason = ({
  error,
  isLoading,
  selectedVideo,
  shouldSurfaceSelectedFallback,
  t,
  videoError,
}: {
  error: string | null;
  isLoading: boolean;
  selectedVideo: TrackVideo | null;
  shouldSurfaceSelectedFallback: boolean;
  t: Translate;
  videoError: boolean;
}): string => {
  if (error) {
    return summarizeMvLoadError(error, t);
  }
  if (isLoading) {
    return t('mvPanel.status.loading');
  }
  if (!selectedVideo) {
    return t('mvPanel.status.notFound');
  }
  if (isBilibiliPlayurlBlocked(selectedVideo)) {
    return t('mvPanel.status.bilibiliBlocked');
  }
  if (videoError) {
    return t('mvPanel.status.videoFailed');
  }
  if (!selectedVideo.playableInApp) {
    return selectedVideo.provider === 'local' ? t('mvPanel.status.localUnsupported') : t('mvPanel.status.externalRequired');
  }
  if (!selectedVideo.mediaUrl) {
    return t('mvPanel.status.missingUrl');
  }
  if (shouldSurfaceSelectedFallback) {
    return t('mvPanel.status.inAppUnavailable');
  }

  return t('mvPanel.status.unavailable');
};

const mvSyncCorrectionCooldownMs = 1000;
const mvUnavailableNoticeAutoDismissMs = 3000;
const mvSyncProfiles: Record<NonNullable<MvSettings['syncMode']>, { toleranceSeconds: number; hardSeekSeconds: number; maxRateDelta: number }> = {
  stable: { toleranceSeconds: 1.2, hardSeekSeconds: 4, maxRateDelta: 0.06 },
  balanced: { toleranceSeconds: 0.45, hardSeekSeconds: 2, maxRateDelta: 0.12 },
  precise: { toleranceSeconds: 0.2, hardSeekSeconds: 0.9, maxRateDelta: 0.18 },
};
const directBilibiliStreamingSyncProfile = { toleranceSeconds: 0.18, hardSeekSeconds: 0.75, maxRateDelta: 0.18 };
const mvSyncTrackingIntervalsMs: Record<NonNullable<MvSettings['syncMode']>, number> = {
  stable: 750,
  balanced: 400,
  precise: 250,
};
const directBilibiliStreamingSyncIntervalMs = 250;
const playbackSeekedEvent = 'playback:seeked';
const mvEndedBeforeAudioEvent = 'mv:ended-before-audio';
const lyricsSmartReadableVideoSampleEvent = 'lyrics:smart-readable-video-sample';
const isReceiverTrackId = (value: string | null | undefined): value is string =>
  Boolean(value?.startsWith('dlna-receiver:') || value?.startsWith('airplay-receiver:'));
const shouldUseSnapshotMvSearch = (track: LibraryTrack | null | undefined, trackId: string | null | undefined): boolean =>
  Boolean(isReceiverTrackId(trackId) || track?.isTemporary || track?.mediaType === 'remote' || track?.mediaType === 'streaming');
const rankedMvCandidates = (candidates: MvMatchCandidate[]): MvMatchCandidate[] => [
  ...candidates.filter((entry) => entry.playableInApp),
  ...candidates.filter((entry) => !entry.playableInApp),
];
const isPlayableTrackVideo = (video: TrackVideo | null | undefined): video is TrackVideo =>
  Boolean(video?.playableInApp && video.mediaUrl);
const shouldAutoSearchForTrack = (
  settings: MvSettings,
  currentTrack: LibraryTrack | null | undefined,
  trackId: string | null | undefined,
  isAudioPlaying: boolean,
): boolean => {
  if (!trackId) {
    return false;
  }

  const autoSearchEnabled = settings.autoSearch !== false;
  const autoPreloadEnabled = settings.autoPreload !== false;
  if (!autoSearchEnabled && !autoPreloadEnabled) {
    return false;
  }

  return isAudioPlaying || shouldUseSnapshotMvSearch(currentTrack, trackId);
};
const mvSettingsKeys = [
  'enabled',
  'autoSearch',
  'autoPreload',
  'autoApplyThreshold',
  'preferHighestViewCount',
  'immersiveBackground',
  'immersiveBackgroundAutoScale',
  'immersiveBackgroundScalePercent',
  'immersiveBackgroundOffsetXPercent',
  'immersiveBackgroundOffsetYPercent',
  'immersiveBackgroundBlurPx',
  'immersiveBackgroundBrightnessPercent',
  'immersiveBackgroundOverlayOpacityPercent',
  'lyricsReadabilityEnhanced',
  'hideLyrics',
  'restartAudioOnLoad',
  'syncMode',
  'replayAudioOnChange',
  'enabledProviders',
  'providerOrder',
  'maxQuality',
  'allow60fps',
] satisfies Array<keyof MvSettings>;
const mvReloadSettingsKeys = [
  'enabled',
  'autoSearch',
  'autoPreload',
  'preferHighestViewCount',
  'enabledProviders',
  'providerOrder',
  'maxQuality',
  'allow60fps',
] satisfies Array<keyof MvSettings>;

type PlaybackSeekedDetail = {
  positionSeconds?: unknown;
  trackId?: unknown;
};

type ImmersiveBackgroundBounds = {
  width: number;
  height: number;
};

type ImmersiveVideoSize = {
  width: number;
  height: number;
};

const clampImmersiveAutoScale = (value: number): number => Math.max(1, Math.min(3.5, value));

const calculateImmersiveAutoScale = (
  bounds: ImmersiveBackgroundBounds | null,
  videoSize: ImmersiveVideoSize | null,
): number => {
  if (!bounds || !videoSize || bounds.width <= 0 || bounds.height <= 0 || videoSize.width <= 0 || videoSize.height <= 0) {
    return 1;
  }

  const coverScale = Math.max(bounds.width / videoSize.width, bounds.height / videoSize.height);
  const containScale = Math.min(bounds.width / videoSize.width, bounds.height / videoSize.height);
  if (!Number.isFinite(coverScale) || !Number.isFinite(containScale) || containScale <= 0) {
    return 1;
  }

  return clampImmersiveAutoScale(coverScale / containScale);
};

const isObjectPatch = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isMvSettingsPatch = (value: unknown): value is Partial<MvSettings> => {
  if (!isObjectPatch(value)) {
    return false;
  }

  return Object.keys(value).some((key) => mvSettingsKeys.includes(key as keyof MvSettings));
};

const shouldReloadMvSelection = (value: unknown): boolean => {
  if (!isObjectPatch(value)) {
    return true;
  }

  return Object.keys(value).some((key) =>
    mvReloadSettingsKeys.includes(key as (typeof mvReloadSettingsKeys)[number]),
  );
};

const normalizeAudioPosition = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

const normalizePlaybackRate = (value: number | undefined): number => {
  const rate = Number(value);
  return Number.isFinite(rate) ? Math.max(0.5, Math.min(2, rate)) : 1;
};

const normalizeAudioClock = (clock: MvAudioClock): MvAudioClock => ({
  positionSeconds: normalizeAudioPosition(clock.positionSeconds),
  updatedAtMs: Number.isFinite(clock.updatedAtMs) ? clock.updatedAtMs : performance.now(),
  playbackRate: normalizePlaybackRate(clock.playbackRate),
  durationSeconds:
    clock.durationSeconds && Number.isFinite(clock.durationSeconds) && clock.durationSeconds > 0
      ? clock.durationSeconds
      : null,
  state: clock.state,
});

const estimateAudioClockPositionSeconds = (clock: MvAudioClock, nowMs = performance.now()): number => {
  const normalizedClock = normalizeAudioClock(clock);
  const elapsedSeconds =
    normalizedClock.state === 'playing'
      ? Math.max(0, (nowMs - normalizedClock.updatedAtMs) / 1000) * normalizedClock.playbackRate
      : 0;
  const positionSeconds = normalizedClock.positionSeconds + elapsedSeconds;

  return normalizedClock.durationSeconds
    ? Math.min(positionSeconds, normalizedClock.durationSeconds)
    : positionSeconds;
};

const targetVideoTimeForAudio = (video: HTMLVideoElement, audioClock: MvAudioClock, offsetMs = 0): number => {
  const position = normalizeAudioPosition(estimateAudioClockPositionSeconds(audioClock));
  const offsetPosition = normalizeAudioPosition(position + offsetMs / 1000);
  const duration = Number(video.duration);
  if (video.loop && Number.isFinite(duration) && duration > 0) {
    return offsetPosition % duration;
  }

  return offsetPosition;
};

const playVideo = (video: HTMLVideoElement): void => {
  try {
    const result = video.play();
    if (result && typeof result.catch === 'function') {
      void result.catch(() => undefined);
    }
  } catch {
    // Autoplay or provider failures should degrade only the MV surface.
  }
};

const streamingTrackKey = (target: { provider: StreamingProviderName; providerTrackId: string }): string =>
  `streaming:${target.provider}:${target.providerTrackId}`;

const bilibiliVideoIdFromStreamingTarget = (target: { provider: StreamingProviderName; providerTrackId: string }): string | null => {
  if (target.provider !== 'bilibili') {
    return null;
  }

  const rawId = target.providerTrackId.trim();
  if (!rawId) {
    return null;
  }

  if (/^https?:\/\//iu.test(rawId)) {
    try {
      return new URL(rawId).pathname.match(/\/video\/((?:BV[A-Za-z0-9]+)|(?:av\d+))/iu)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  return rawId.match(/^BV[A-Za-z0-9]+$/iu)?.[0] ?? rawId.match(/^av\d+$/iu)?.[0] ?? null;
};

const bilibiliVideoUrlFromStreamingTarget = (target: { provider: StreamingProviderName; providerTrackId: string }): string | null => {
  if (target.provider !== 'bilibili') {
    return null;
  }

  const rawId = target.providerTrackId.trim();
  if (/^https?:\/\//iu.test(rawId)) {
    return rawId;
  }

  const videoId = bilibiliVideoIdFromStreamingTarget(target);
  return videoId ? `https://www.bilibili.com/video/${encodeURIComponent(videoId)}` : null;
};

const youtubeVideoIdFromValue = (value: string | null | undefined): string | null => {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const direct = raw.match(/^[A-Za-z0-9_-]{11}$/u)?.[0];
  if (direct) {
    return direct;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    }
    if (parsed.hostname.endsWith('youtube.com')) {
      return parsed.searchParams.get('v') ?? parsed.pathname.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/u)?.[1] ?? null;
    }
  } catch {
    return raw.match(/[?&]v=([A-Za-z0-9_-]{11})/u)?.[1] ?? raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/u)?.[1] ?? null;
  }

  return null;
};

const youtubeVideoUrlFromStreamingTarget = (target: { provider: StreamingProviderName; providerTrackId: string }): string | null => {
  if (target.provider !== 'youtube') {
    return null;
  }

  const videoId = youtubeVideoIdFromValue(target.providerTrackId);
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null;
};

type YouTubeEmbedOptions = {
  autoplay: boolean;
  controls?: boolean;
  loop?: boolean;
};

const youtubeEmbedUrlFromVideo = (video: TrackVideo | null, options: YouTubeEmbedOptions): string | null => {
  if (!video || video.provider !== 'youtube' || video.sourceType !== 'manual') {
    return null;
  }

  const videoId = youtubeVideoIdFromValue(video.providerUrl ?? video.url ?? video.sourceId);
  if (!videoId) {
    return null;
  }

  const url = new URL(`https://www.youtube.com/embed/${videoId}`);
  const controls = options.controls !== false;
  url.searchParams.set('autoplay', options.autoplay ? '1' : '0');
  url.searchParams.set('mute', '1');
  url.searchParams.set('controls', controls ? '1' : '0');
  url.searchParams.set('rel', '0');
  url.searchParams.set('playsinline', '1');
  url.searchParams.set('iv_load_policy', '3');
  if (!controls) {
    url.searchParams.set('disablekb', '1');
    url.searchParams.set('fs', '0');
    url.searchParams.set('modestbranding', '1');
  }
  if (options.loop) {
    url.searchParams.set('loop', '1');
    url.searchParams.set('playlist', videoId);
  }
  return url.toString();
};

const shouldUseDirectBilibiliStreamingVideo = (
  video: TrackVideo | null,
  target: { provider: StreamingProviderName; providerTrackId: string },
): boolean => {
  const videoId = bilibiliVideoIdFromStreamingTarget(target);
  if (!videoId) {
    return false;
  }

  return video?.provider !== 'bilibili' || video.sourceId !== videoId;
};

const shouldUseDirectYouTubeStreamingVideo = (
  video: TrackVideo | null,
  target: { provider: StreamingProviderName; providerTrackId: string },
): boolean => {
  const videoId = youtubeVideoIdFromValue(target.providerTrackId);
  if (!videoId) {
    return false;
  }

  return video?.provider !== 'youtube' || video.sourceId !== videoId;
};

const isDirectBilibiliStreamingVideo = (
  video: TrackVideo | null,
  target: { provider: StreamingProviderName; providerTrackId: string } | null | undefined,
): boolean => {
  if (!video || video.provider !== 'bilibili' || !target) {
    return false;
  }

  const videoId = bilibiliVideoIdFromStreamingTarget(target);
  return Boolean(videoId && video.sourceId === videoId);
};

const shouldFollowMusicProgress = (
  settings: MvSettings,
  video: TrackVideo | null,
  target: { provider: StreamingProviderName; providerTrackId: string } | null | undefined,
): boolean => settings.restartAudioOnLoad === true || isDirectBilibiliStreamingVideo(video, target);

const snapshotTrackIdForTrack = (currentTrack: LibraryTrack | null | undefined, fallbackTrackId: string): string => {
  if (currentTrack?.mediaType === 'streaming') {
    const stableKey = currentTrack.stableKey?.trim();
    if (stableKey) {
      return stableKey;
    }

    const provider = currentTrack.provider?.trim();
    const providerTrackId = currentTrack.providerTrackId?.trim();
    if (provider && providerTrackId) {
      return `streaming:${provider}:${providerTrackId}`;
    }
  }

  return currentTrack?.id ?? fallbackTrackId;
};

const mvSyncTrackingIntervalForSettings = (
  settings: MvSettings,
  video: TrackVideo | null,
  target: { provider: StreamingProviderName; providerTrackId: string } | null | undefined,
): number => {
  if (isDirectBilibiliStreamingVideo(video, target)) {
    return directBilibiliStreamingSyncIntervalMs;
  }

  return mvSyncTrackingIntervalsMs[settings.syncMode ?? 'balanced'] ?? mvSyncTrackingIntervalsMs.balanced;
};

const snapshotSearchRequestForTrack = ({
  artist,
  audioClock,
  coverUrl,
  currentTrack,
  fallbackMediaType = 'remote',
  title,
  trackId,
}: {
  artist: string;
  audioClock: MvAudioClock;
  coverUrl: string | null;
  currentTrack: LibraryTrack | null | undefined;
  fallbackMediaType?: MvTrackSnapshotSearchRequest['mediaType'];
  title: string;
  trackId: string;
}): MvTrackSnapshotSearchRequest => {
  const searchTitle = currentTrack?.title?.trim() || title?.trim() || 'DLNA stream';
  const searchArtist =
    currentTrack?.artist?.trim() ||
    currentTrack?.albumArtist?.trim() ||
    artist?.trim() ||
    'Unknown Artist';

  return {
    trackId: snapshotTrackIdForTrack(currentTrack, trackId),
    title: searchTitle,
    artist: searchArtist,
    album: currentTrack?.album?.trim() || null,
    albumArtist: currentTrack?.albumArtist?.trim() || null,
    durationSeconds: currentTrack?.duration && currentTrack.duration > 0 ? currentTrack.duration : audioClock.durationSeconds,
    coverThumb: currentTrack?.coverThumb ?? coverUrl,
    mediaType: currentTrack?.mediaType ?? fallbackMediaType,
    query: [searchTitle, searchArtist].filter(Boolean).join(' '),
  };
};

const getVideoSignedDriftSeconds = (video: HTMLVideoElement, targetTime: number): number => {
  const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  let drift = targetTime - currentTime;
  const duration = Number(video.duration);

  if (video.loop && Number.isFinite(duration) && duration > 0) {
    if (drift > duration / 2) {
      drift -= duration;
    } else if (drift < -duration / 2) {
      drift += duration;
    }
  }

  return drift;
};

const syncProfileForSettings = (settings: MvSettings): (typeof mvSyncProfiles)[keyof typeof mvSyncProfiles] =>
  mvSyncProfiles[settings.syncMode ?? 'balanced'] ?? mvSyncProfiles.balanced;

const uniqueCoverUrls = (...urls: Array<string | null | undefined>): string[] =>
  Array.from(new Set(urls.map((url) => url?.trim()).filter((url): url is string => Boolean(url))));

const dispatchMvEndedBeforeAudio = (trackId: string | null): void => {
  window.dispatchEvent(new CustomEvent(mvEndedBeforeAudioEvent, { detail: { trackId } }));
};

const CoverFallback = ({
  artist,
  coverUrls,
  hideTrackInfo = false,
  status,
  title,
}: {
  artist: string;
  coverUrls: string[];
  hideTrackInfo?: boolean;
  status: string;
  title: string;
}): JSX.Element => {
  const coverKey = coverUrls.join('\n');
  const [failedCoverUrls, setFailedCoverUrls] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setFailedCoverUrls(new Set());
  }, [coverKey]);

  const coverUrl = coverUrls.find((url) => !failedCoverUrls.has(url)) ?? null;
  const handleCoverError = useCallback((): void => {
    if (!coverUrl) {
      return;
    }

    setFailedCoverUrls((current) => {
      const next = new Set(current);
      next.add(coverUrl);
      return next;
    });
  }, [coverUrl]);

  return (
    <div className="lyrics-mv-card" data-cover={Boolean(coverUrl)} data-hide-track-info={hideTrackInfo ? 'true' : undefined}>
      <div className="lyrics-mv-card-backdrop" aria-hidden="true">
        {coverUrl ? <img alt="" draggable={false} src={coverUrl} onError={handleCoverError} /> : null}
      </div>
      <div className="lyrics-mv-artwork">
        {coverUrl ? (
          <img alt="" draggable={false} src={coverUrl} onError={handleCoverError} />
        ) : (
          <div className="lyrics-mv-placeholder" aria-hidden="true">
            <Music2 size={46} />
          </div>
        )}
      </div>
      <div className="lyrics-mv-copy">
        <span>
          <Film size={15} />
          {status}
        </span>
        {hideTrackInfo ? null : (
          <>
            <strong>{title}</strong>
            <em>{artist}</em>
          </>
        )}
      </div>
    </div>
  );
};

export const MvPanel = ({
  artist,
  audioClock,
  coverUrl,
  currentTrack = null,
  hideFallbackTrackInfo = false,
  isAudioPlaying,
  smartReadableColorsEnabled = false,
  streamingTarget = null,
  title,
  trackId,
}: MvPanelProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [selectedVideo, setSelectedVideo] = useState<TrackVideo | null>(null);
  const [settings, setSettings] = useState<MvSettings>(fallbackMvSettings);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(() => !window.echo?.mv);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [isUnavailableNoticeDismissed, setUnavailableNoticeDismissed] = useState(false);
  const [isDiagnosticsReportEnabled, setDiagnosticsReportEnabled] = useState(readMvDiagnosticsEnabled);
  const [hasCopiedDiagnosticsReport, setHasCopiedDiagnosticsReport] = useState(false);
  const [immersiveBackgroundBounds, setImmersiveBackgroundBounds] = useState<ImmersiveBackgroundBounds | null>(null);
  const [immersiveVideoSize, setImmersiveVideoSize] = useState<ImmersiveVideoSize | null>(null);
  const requestRef = useRef(0);
  const preloadAttemptRef = useRef<string | null>(null);
  const lastVideoSyncAtRef = useRef(0);
  const videoSeekingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const backgroundRef = useRef<HTMLDivElement | null>(null);
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
  const backgroundDragRef = useRef<{
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const isAudioPlayingRef = useRef(isAudioPlaying);
  const previousAudioPlayingRef = useRef(isAudioPlaying);
  const previousAudioSyncPlayingRef = useRef(isAudioPlaying);
  const audioClockRef = useRef(normalizeAudioClock(audioClock));
  const previousAudioClockRef = useRef(normalizeAudioClock(audioClock));
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    audioClockRef.current = normalizeAudioClock(audioClock);
  }, [audioClock]);

  const applyVideoPlaybackRate = useCallback((video: HTMLVideoElement): void => {
    try {
      video.playbackRate = audioClockRef.current.playbackRate;
    } catch {
      // Video rate support varies by stream/provider; MV failures must not interrupt audio.
    }
  }, []);

  useEffect(() => {
    audioClockRef.current = normalizeAudioClock(audioClock);
    if (videoRef.current) {
      applyVideoPlaybackRate(videoRef.current);
    }
    if (backgroundVideoRef.current) {
      applyVideoPlaybackRate(backgroundVideoRef.current);
    }
  }, [applyVideoPlaybackRate, audioClock]);

  const loadSettings = useCallback(async (): Promise<MvSettings> => {
    if (!window.echo?.mv?.getSettings) {
      setSettings(fallbackMvSettings);
      setHasLoadedSettings(true);
      return fallbackMvSettings;
    }

    try {
      const nextSettings = await window.echo.mv.getSettings();
      setSettings(nextSettings);
      setHasLoadedSettings(true);
      return nextSettings;
    } catch {
      setSettings(fallbackMvSettings);
      setHasLoadedSettings(true);
      return fallbackMvSettings;
    }
  }, []);

  const patchSettings = useCallback(
    async (patch: Partial<MvSettings>): Promise<void> => {
      setSettings((current) => ({ ...current, ...patch }));
      try {
        if (window.echo?.mv?.setSettings) {
          setSettings(await window.echo.mv.setSettings(patch));
          window.dispatchEvent(new CustomEvent('settings:changed', { detail: patch }));
        }
      } catch {
        void loadSettings();
      }
    },
    [loadSettings],
  );

  const resolveNetworkVideo = useCallback(async (video: TrackVideo | null): Promise<TrackVideo | null> => {
    if (!video || video.temporary || video.provider === 'local' || !window.echo?.mv?.resolveStreams) {
      return video;
    }

    try {
      const resolved = await window.echo.mv.resolveStreams(video.id);
      return isPlayableTrackVideo(video) && !isPlayableTrackVideo(resolved.video) ? video : resolved.video;
    } catch (resolveError) {
      if (isMvDatabaseLoadError(resolveError)) {
        throw resolveError;
      }
      return video;
    }
  }, []);

  const selectFirstPlayableCandidate = useCallback(
    async (mvApi: NonNullable<NonNullable<Window['echo']>['mv']>, targetTrackId: string, candidates: MvMatchCandidate[]): Promise<TrackVideo | null> => {
      if (!mvApi.selectVideo) {
        return null;
      }

      for (const candidate of rankedMvCandidates(candidates)) {
        try {
          const selected = await mvApi.selectVideo(targetTrackId, candidate.id);
          const resolved = await resolveNetworkVideo(selected);
          if (isPlayableTrackVideo(resolved)) {
            return resolved;
          }
        } catch {
          // Try the next candidate; search results can include external-only videos.
        }
      }

      return null;
    },
    [resolveNetworkVideo],
  );

  const searchCandidatesForActiveTrack = useCallback(async (options: { forceSnapshot?: boolean } = {}): Promise<TrackVideo | null> => {
    const mvApi = window.echo?.mv;
    if (!trackId || !mvApi) {
      return null;
    }

    if ((options.forceSnapshot || shouldUseSnapshotMvSearch(currentTrack, trackId)) && mvApi.searchNetworkCandidatesForSnapshot) {
      const request = snapshotSearchRequestForTrack({
        artist,
        audioClock: audioClockRef.current,
        coverUrl,
        currentTrack,
        fallbackMediaType: options.forceSnapshot ? 'local' : 'remote',
        title,
        trackId,
      });
      const candidates = await mvApi.searchNetworkCandidatesForSnapshot(request);
      return selectFirstPlayableCandidate(mvApi, request.trackId, candidates);
    }

    await mvApi.searchNetworkCandidates?.(trackId);
    return null;
  }, [artist, coverUrl, currentTrack, selectFirstPlayableCandidate, title, trackId]);

  const getTemporaryPlayableForActiveTrack = useCallback(async (options: { forceSnapshot?: boolean } = {}): Promise<TrackVideo | null> => {
    const mvApi = window.echo?.mv;
    if (!trackId || !mvApi?.getTemporaryPlayableForSnapshot) {
      return null;
    }

    const request = snapshotSearchRequestForTrack({
      artist,
      audioClock: audioClockRef.current,
      coverUrl,
      currentTrack,
      fallbackMediaType: options.forceSnapshot ? 'local' : 'remote',
      title,
      trackId,
    });

    return mvApi.getTemporaryPlayableForSnapshot(request);
  }, [artist, coverUrl, currentTrack, title, trackId]);

  const loadSelected = useCallback(async (options: { preserveCurrent?: boolean } = {}): Promise<void> => {
    if (streamingTarget) {
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!options.preserveCurrent) {
      setSelectedVideo(null);
    }
    setIsLoading(Boolean(trackId && window.echo?.mv));
    setError(null);
    setVideoError(false);

    if (!trackId || !window.echo?.mv) {
      setIsLoading(false);
      return;
    }

    try {
      const nextSettings = await loadSettings();
      if (nextSettings.enabled === false) {
        if (requestRef.current !== requestId) {
          return;
        }
        setSelectedVideo(null);
        setIsLoading(false);
        return;
      }
      let video = await window.echo.mv.getSelected(trackId);
      if (
        !video &&
        shouldAutoSearchForTrack(nextSettings, currentTrack, trackId, isAudioPlayingRef.current) &&
        preloadAttemptRef.current !== trackId
      ) {
        preloadAttemptRef.current = trackId;
        video = (await searchCandidatesForActiveTrack()) ?? (await window.echo.mv.getSelected(trackId));
      }
      let resolvedVideo = await resolveNetworkVideo(video);
      if (
        isUnplayableSearchCandidate(resolvedVideo) &&
        shouldAutoSearchForTrack(nextSettings, currentTrack, trackId, isAudioPlayingRef.current) &&
        preloadAttemptRef.current !== trackId
      ) {
        preloadAttemptRef.current = trackId;
        video = (await searchCandidatesForActiveTrack()) ?? (await window.echo.mv.getSelected(trackId));
        resolvedVideo = await resolveNetworkVideo(video);
      }
      if (requestRef.current !== requestId) {
        return;
      }
      setSelectedVideo(resolvedVideo);
    } catch (loadError) {
      if (requestRef.current === requestId) {
        if (isMvDatabaseLoadError(loadError)) {
          try {
            const fallbackVideo = await getTemporaryPlayableForActiveTrack({ forceSnapshot: true });
            const resolvedFallbackVideo = await resolveNetworkVideo(fallbackVideo);
            if (requestRef.current === requestId && resolvedFallbackVideo?.playableInApp && resolvedFallbackVideo.mediaUrl) {
              setSelectedVideo(resolvedFallbackVideo);
              setError(null);
              return;
            }
          } catch {
            // Keep the original database error visible if snapshot fallback cannot recover playback.
          }
        }

        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setSelectedVideo(null);
      }
    } finally {
      if (requestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [currentTrack, getTemporaryPlayableForActiveTrack, loadSettings, resolveNetworkVideo, searchCandidatesForActiveTrack, streamingTarget, trackId]);

  useEffect(() => {
    if (!streamingTarget) {
      return;
    }

    const effectiveTrackId = trackId ?? streamingTrackKey(streamingTarget);
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setSelectedVideo(null);
    setIsLoading(true);
    setError(null);
    setVideoError(false);

    void (async () => {
      const nextSettings = await loadSettings();
      if (requestRef.current !== requestId || nextSettings.enabled === false) {
        return;
      }

      const mvApi = window.echo?.mv;
      let video = await mvApi?.getSelected?.(effectiveTrackId) ?? null;
      const directBilibiliUrl = bilibiliVideoUrlFromStreamingTarget(streamingTarget);
      if (directBilibiliUrl && mvApi?.bindUrl && shouldUseDirectBilibiliStreamingVideo(video, streamingTarget)) {
        video = await mvApi.bindUrl(effectiveTrackId, directBilibiliUrl);
      }
      const directYouTubeUrl = youtubeVideoUrlFromStreamingTarget(streamingTarget);
      if (directYouTubeUrl && mvApi?.bindUrl && shouldUseDirectYouTubeStreamingVideo(video, streamingTarget)) {
        video = await mvApi.bindUrl(effectiveTrackId, directYouTubeUrl);
      }
      if (!video && mvApi?.searchNetworkCandidatesForSnapshot) {
        let streamingMvItems: StreamingMvItem[] = [];
        try {
          const streamingMv = await window.echo?.streaming?.getMv?.(streamingTarget);
          streamingMvItems = streamingMv?.status === 'available' ? streamingMv.items : [];
        } catch {
          streamingMvItems = [];
        }

        const searchTargets =
          streamingMvItems.length > 0
            ? streamingMvItems
            : [
                {
                  title,
                  artist,
                  duration: audioClockRef.current.durationSeconds,
                  thumbnailUrl: coverUrl,
                },
              ];

        for (const item of searchTargets) {
          const candidates = await mvApi.searchNetworkCandidatesForSnapshot({
            trackId: effectiveTrackId,
            title: item.title,
            artist: item.artist || artist,
            durationSeconds: item.duration ?? audioClockRef.current.durationSeconds,
            coverThumb: item.thumbnailUrl ?? coverUrl,
            mediaType: 'streaming',
            query: [item.title, item.artist || artist].filter(Boolean).join(' '),
          });
          const selectedCandidate = await selectFirstPlayableCandidate(mvApi, effectiveTrackId, candidates);
          if (selectedCandidate) {
            video = selectedCandidate;
            break;
          }
        }
      }

      const resolvedVideo = await resolveNetworkVideo(video);
      if (requestRef.current === requestId) {
        setSelectedVideo(resolvedVideo);
      }
    })()
      .catch(async (loadError) => {
        if (requestRef.current === requestId) {
          if (isMvDatabaseLoadError(loadError) && window.echo?.mv?.getTemporaryPlayableForSnapshot) {
            try {
              const temporaryVideo = await window.echo.mv.getTemporaryPlayableForSnapshot({
                trackId: effectiveTrackId,
                title,
                artist,
                durationSeconds: audioClockRef.current.durationSeconds,
                coverThumb: coverUrl,
                mediaType: 'streaming',
                query: [title, artist].filter(Boolean).join(' '),
              });
              if (requestRef.current === requestId && temporaryVideo?.playableInApp && temporaryVideo.mediaUrl) {
                setSelectedVideo(temporaryVideo);
                setError(null);
                return;
              }
            } catch {
              // Keep the original database error visible if temporary playback cannot recover.
            }
          }

          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setSelectedVideo(null);
        }
      })
      .finally(() => {
        if (requestRef.current === requestId) {
          setIsLoading(false);
        }
      });
  }, [artist, coverUrl, loadSettings, resolveNetworkVideo, selectFirstPlayableCandidate, streamingTarget, title, trackId]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  useEffect(() => {
    const wasAudioPlaying = previousAudioPlayingRef.current;
    previousAudioPlayingRef.current = isAudioPlaying;

    if (!isAudioPlaying || wasAudioPlaying || selectedVideo || !trackId || preloadAttemptRef.current === trackId) {
      return;
    }

    void loadSelected();
  }, [isAudioPlaying, loadSelected, selectedVideo, trackId]);

  useEffect(() => {
    const handleMvChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ trackId?: string | null }>).detail;
      if (!detail?.trackId || detail.trackId === trackId) {
        void loadSelected({ preserveCurrent: true });
      }
    };

    window.addEventListener('mv:changed', handleMvChanged);
    return () => window.removeEventListener('mv:changed', handleMvChanged);
  }, [loadSelected, trackId]);

  useEffect(() => {
    const handleSettingsChanged = (event: Event): void => {
      const patch = event instanceof CustomEvent ? event.detail : null;
      if (patch && !isMvSettingsPatch(patch)) {
        return;
      }

      if (isMvSettingsPatch(patch) && !shouldReloadMvSelection(patch)) {
        setSettings((current) => ({ ...current, ...patch }));
        setHasLoadedSettings(true);
        return;
      }

      void loadSettings().then((nextSettings) => {
        if (nextSettings.enabled === false) {
          setSelectedVideo(null);
          setVideoError(false);
          return;
        }

        if (shouldReloadMvSelection(patch)) {
          void loadSelected();
        }
      });
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => window.removeEventListener('settings:changed', handleSettingsChanged);
  }, [loadSelected, loadSettings]);

  const isMvEnabled = settings.enabled !== false;
  const selectedMvOffsetMs = clampMvOffsetMs(Number(selectedVideo?.offsetMs ?? 0));
  const videoMediaUrl = isMvEnabled && selectedVideo?.playableInApp && selectedVideo.mediaUrl && !videoError ? selectedVideo.mediaUrl : null;
  const showVideo = Boolean(videoMediaUrl);
  const youtubeEmbedUrl = youtubeEmbedUrlFromVideo(selectedVideo, { autoplay: isAudioPlaying, controls: false });
  const showYouTubeEmbed = Boolean(isMvEnabled && youtubeEmbedUrl && !showVideo);
  const youtubeBackgroundEmbedUrl = youtubeEmbedUrlFromVideo(selectedVideo, {
    autoplay: isAudioPlaying,
    controls: false,
    loop: true,
  });
  const showYouTubeImmersiveBackground = Boolean(
    settings.immersiveBackground !== false && showYouTubeEmbed && youtubeBackgroundEmbedUrl,
  );
  const shouldSurfaceSelectedFallback = Boolean(
    selectedVideo && !showYouTubeEmbed && (videoError || selectedVideo.playableInApp || selectedVideo.sourceType === 'manual'),
  );
  const adaptiveStream = isAdaptiveStream(selectedVideo);
  const showImmersiveBackground = Boolean((settings.immersiveBackground !== false && showVideo) || showYouTubeImmersiveBackground);
  const isLyricsReadabilityEnhanced = settings.lyricsReadabilityEnhanced === true || smartReadableColorsEnabled;
  const hasVisibleMvSurface = showVideo || showYouTubeEmbed;
  const unavailableReason = hasVisibleMvSurface
    ? null
    : getUnavailableReason({
        error,
        isLoading,
        selectedVideo,
        shouldSurfaceSelectedFallback,
        t,
        videoError,
      });
  const temporaryPlaybackNotice = showVideo && selectedVideo?.temporary ? t('mvPanel.status.temporaryPlayback') : null;
  const mvNotice = unavailableReason ?? temporaryPlaybackNotice;

  const updateImmersiveVideoSize = useCallback(
    (video: HTMLVideoElement | null): void => {
      const width = Math.round(video?.videoWidth || selectedVideo?.width || 0);
      const height = Math.round(video?.videoHeight || selectedVideo?.height || 0);
      setImmersiveVideoSize((current) => {
        if (width <= 0 || height <= 0) {
          return current;
        }
        if (current?.width === width && current.height === height) {
          return current;
        }
        return { width, height };
      });
    },
    [selectedVideo?.height, selectedVideo?.width],
  );

  useEffect(() => {
    const width = Math.round(selectedVideo?.width ?? 0);
    const height = Math.round(selectedVideo?.height ?? 0);
    setImmersiveVideoSize(width > 0 && height > 0 ? { width, height } : null);
  }, [selectedVideo?.height, selectedVideo?.id, selectedVideo?.width, videoMediaUrl]);

  useEffect(() => {
    if (!showImmersiveBackground) {
      setImmersiveBackgroundBounds(null);
      return undefined;
    }

    const updateBounds = (): void => {
      const rect = backgroundRef.current?.getBoundingClientRect();
      const width = Math.round(rect?.width || window.innerWidth || 0);
      const height = Math.round(rect?.height || window.innerHeight || 0);
      setImmersiveBackgroundBounds((current) => {
        if (width <= 0 || height <= 0) {
          return current;
        }
        if (current?.width === width && current.height === height) {
          return current;
        }
        return { width, height };
      });
    };

    updateBounds();
    const ResizeObserverCtor = window.ResizeObserver;
    const resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(updateBounds) : null;
    if (resizeObserver && backgroundRef.current) {
      resizeObserver.observe(backgroundRef.current);
    }
    window.addEventListener('resize', updateBounds);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, [showImmersiveBackground]);

  const mvDiagnosticsReport = useMemo(() => {
    if (!isDiagnosticsReportEnabled || hasVisibleMvSurface) {
      return null;
    }

    return JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        reason: unavailableReason,
        error,
        videoError,
        isLoading,
        track: {
          id: trackId,
          title,
          artist,
          mediaType: currentTrack?.mediaType ?? null,
          durationSeconds: currentTrack?.duration ?? audioClock.durationSeconds ?? null,
        },
        selectedVideo: selectedVideo
          ? {
              id: selectedVideo.id,
              provider: selectedVideo.provider,
              sourceType: selectedVideo.sourceType,
              sourceId: selectedVideo.sourceId,
              title: selectedVideo.title,
              qualityLabel: selectedVideo.qualityLabel,
              selectedQualityId: selectedVideo.selectedQualityId,
              mimeType: selectedVideo.mimeType,
              playableInApp: selectedVideo.playableInApp,
              hasMediaUrl: Boolean(selectedVideo.mediaUrl),
              temporary: selectedVideo.temporary === true,
            }
          : null,
        settings: {
          enabled: settings.enabled !== false,
          autoSearch: settings.autoSearch,
          autoPreload: settings.autoPreload,
          maxQuality: settings.maxQuality,
          allow60fps: settings.allow60fps,
          immersiveBackground: settings.immersiveBackground !== false,
          restartAudioOnLoad: settings.restartAudioOnLoad,
          syncMode: settings.syncMode ?? 'balanced',
        },
        audioClock: normalizeAudioClock(audioClock),
        userAgent: navigator.userAgent,
      },
      null,
      2,
    );
  }, [
    artist,
    audioClock,
    currentTrack?.duration,
    currentTrack?.mediaType,
    error,
    isDiagnosticsReportEnabled,
    isLoading,
    selectedVideo,
    settings,
    hasVisibleMvSurface,
    title,
    trackId,
    unavailableReason,
    videoError,
  ]);

  const copyDiagnosticsReport = useCallback((): void => {
    if (!mvDiagnosticsReport) {
      return;
    }

    const writeReport = navigator.clipboard?.writeText(mvDiagnosticsReport);
    if (!writeReport) {
      return;
    }

    void writeReport.then(() => {
      setHasCopiedDiagnosticsReport(true);
      window.setTimeout(() => setHasCopiedDiagnosticsReport(false), 1200);
    });
  }, [mvDiagnosticsReport]);

  useEffect(() => {
    setUnavailableNoticeDismissed(false);
    setHasCopiedDiagnosticsReport(false);
  }, [trackId, mvNotice]);

  useEffect(() => {
    const handlePreferenceChanged = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail as { enabled?: unknown } | null : null;
      setDiagnosticsReportEnabled(typeof detail?.enabled === 'boolean' ? detail.enabled : readMvDiagnosticsEnabled());
    };

    window.addEventListener(mvDiagnosticsPreferenceChangedEvent, handlePreferenceChanged);
    return () => window.removeEventListener(mvDiagnosticsPreferenceChangedEvent, handlePreferenceChanged);
  }, []);

  useEffect(() => {
    if (!mvNotice || isUnavailableNoticeDismissed) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setUnavailableNoticeDismissed(true);
    }, mvUnavailableNoticeAutoDismissMs);

    return () => window.clearTimeout(timeoutId);
  }, [isUnavailableNoticeDismissed, mvNotice]);

  const immersiveBackgroundStyle = useMemo(
    () => {
      const manualScale = (settings.immersiveBackgroundScalePercent ?? 115) / 100;
      const autoScale = settings.immersiveBackgroundAutoScale === false
        ? 1
        : calculateImmersiveAutoScale(immersiveBackgroundBounds, immersiveVideoSize);
      return ({
        '--mv-immersive-scale': (manualScale * autoScale).toFixed(2),
        '--mv-immersive-auto-scale': autoScale.toFixed(2),
        '--mv-immersive-position-x': `${settings.immersiveBackgroundOffsetXPercent ?? 50}%`,
        '--mv-immersive-position-y': `${settings.immersiveBackgroundOffsetYPercent ?? 50}%`,
        '--mv-immersive-blur': `${settings.immersiveBackgroundBlurPx ?? 0}px`,
        '--mv-immersive-brightness': `${settings.immersiveBackgroundBrightnessPercent ?? 100}%`,
        '--mv-immersive-overlay-opacity': ((settings.immersiveBackgroundOverlayOpacityPercent ?? 0) / 100).toFixed(2),
      }) as CSSProperties;
    },
    [
      immersiveBackgroundBounds,
      immersiveVideoSize,
      settings.immersiveBackgroundAutoScale,
      settings.immersiveBackgroundBlurPx,
      settings.immersiveBackgroundBrightnessPercent,
      settings.immersiveBackgroundOffsetXPercent,
      settings.immersiveBackgroundOffsetYPercent,
      settings.immersiveBackgroundOverlayOpacityPercent,
      settings.immersiveBackgroundScalePercent,
    ],
  );

  const updateImmersiveOffsetFromDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>, shouldPersist = false): void => {
      const drag = backgroundDragRef.current;
      if (!drag) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const nextX = Math.max(0, Math.min(100, Math.round(drag.offsetX + ((event.clientX - drag.startX) / Math.max(1, rect.width)) * 100)));
      const nextY = Math.max(0, Math.min(100, Math.round(drag.offsetY + ((event.clientY - drag.startY) / Math.max(1, rect.height)) * 100)));
      setSettings((current) => ({
        ...current,
        immersiveBackgroundOffsetXPercent: nextX,
        immersiveBackgroundOffsetYPercent: nextY,
      }));

      if (shouldPersist) {
        void patchSettings({
          immersiveBackgroundOffsetXPercent: nextX,
          immersiveBackgroundOffsetYPercent: nextY,
        });
      }
    },
    [patchSettings],
  );

  useEffect(() => {
    isAudioPlayingRef.current = isAudioPlaying;
  }, [isAudioPlaying]);

  useEffect(() => {
    preloadAttemptRef.current = null;
    lastVideoSyncAtRef.current = 0;
    videoSeekingRef.current = false;
    previousAudioClockRef.current = normalizeAudioClock(audioClockRef.current);
  }, [trackId]);

  const syncVideoElementToAudio = useCallback((video: HTMLVideoElement | null, options: { force?: boolean; bypassCooldown?: boolean; recordCooldown?: boolean } = {}): boolean => {
    const directBilibiliStreamingVideo = isDirectBilibiliStreamingVideo(selectedVideo, streamingTarget);
    const followMusicProgress = shouldFollowMusicProgress(settingsRef.current, selectedVideo, streamingTarget);
    if (!video || videoSeekingRef.current || (!followMusicProgress && !options.force)) {
      return false;
    }

    const targetTime = targetVideoTimeForAudio(video, audioClockRef.current, selectedVideo?.offsetMs ?? 0);
    const signedDrift = getVideoSignedDriftSeconds(video, targetTime);
    const drift = Math.abs(signedDrift);
    const syncProfile = directBilibiliStreamingVideo ? directBilibiliStreamingSyncProfile : syncProfileForSettings(settingsRef.current);
    const syncCooldownMs = directBilibiliStreamingVideo ? 150 : mvSyncCorrectionCooldownMs;
    const now = Date.now();

    if (!options.force && drift <= syncProfile.toleranceSeconds) {
      applyVideoPlaybackRate(video);
      return false;
    }

    if (!options.force && drift < syncProfile.hardSeekSeconds) {
      const correction = Math.max(-syncProfile.maxRateDelta, Math.min(syncProfile.maxRateDelta, signedDrift / syncProfile.hardSeekSeconds));
      try {
        video.playbackRate = audioClockRef.current.playbackRate * (1 + correction);
        return true;
      } catch {
        return false;
      }
    }

    if (!options.force && !options.bypassCooldown && now - lastVideoSyncAtRef.current < syncCooldownMs) {
      return false;
    }

    try {
      video.currentTime = targetTime;
      applyVideoPlaybackRate(video);
      if (options.recordCooldown !== false) {
        lastVideoSyncAtRef.current = now;
      }
      return true;
    } catch {
      return false;
    }
  }, [applyVideoPlaybackRate, selectedVideo, streamingTarget]);

  const syncVideoToAudio = useCallback((options: { force?: boolean; bypassCooldown?: boolean } = {}): boolean => {
    const foregroundSynced = syncVideoElementToAudio(videoRef.current, options);
    const backgroundSynced = syncVideoElementToAudio(backgroundVideoRef.current, { ...options, recordCooldown: false });
    return foregroundSynced || backgroundSynced;
  }, [syncVideoElementToAudio]);

  useEffect(() => {
    const wasAudioPlaying = previousAudioSyncPlayingRef.current;
    previousAudioSyncPlayingRef.current = isAudioPlaying;

    if (showVideo && isAudioPlaying && !wasAudioPlaying) {
      syncVideoToAudio({ force: true, bypassCooldown: true });
    }
  }, [isAudioPlaying, showVideo, syncVideoToAudio]);

  useEffect(() => {
    if (!showVideo || !videoRef.current) {
      return;
    }

    applyVideoPlaybackRate(videoRef.current);

    if (isAudioPlaying) {
      syncVideoToAudio({ force: true, bypassCooldown: true });
      playVideo(videoRef.current);
      return;
    }

    videoRef.current.pause();
  }, [applyVideoPlaybackRate, isAudioPlaying, showVideo, syncVideoToAudio, videoMediaUrl]);

  useEffect(() => {
    if (!showImmersiveBackground || !backgroundVideoRef.current) {
      return;
    }

    applyVideoPlaybackRate(backgroundVideoRef.current);

    if (isAudioPlaying) {
      syncVideoToAudio({ force: true, bypassCooldown: true });
      playVideo(backgroundVideoRef.current);
      return;
    }

    backgroundVideoRef.current.pause();
  }, [applyVideoPlaybackRate, isAudioPlaying, showImmersiveBackground, syncVideoToAudio, videoMediaUrl]);

  useEffect(() => {
    const nextClock = normalizeAudioClock(audioClock);
    const positionJumped = Math.abs(nextClock.positionSeconds - previousAudioClockRef.current.positionSeconds) > 2;
    audioClockRef.current = nextClock;
    previousAudioClockRef.current = nextClock;

    if (!showVideo) {
      return;
    }

    syncVideoToAudio({ bypassCooldown: positionJumped });
  }, [audioClock, showVideo, syncVideoToAudio]);

  useEffect(() => {
    const handlePlaybackSeeked = (event: Event): void => {
      const detail = event instanceof CustomEvent ? (event.detail as PlaybackSeekedDetail | null) : null;
      const eventTrackId = typeof detail?.trackId === 'string' && detail.trackId.trim() ? detail.trackId : null;
      if (eventTrackId && eventTrackId !== trackId) {
        return;
      }

      const positionSeconds = Number(detail?.positionSeconds);
      if (!Number.isFinite(positionSeconds)) {
        return;
      }

      const nextPosition = normalizeAudioPosition(positionSeconds);
      const nextClock = normalizeAudioClock({
        ...audioClockRef.current,
        positionSeconds: nextPosition,
        updatedAtMs: performance.now(),
      });
      audioClockRef.current = nextClock;
      previousAudioClockRef.current = nextClock;
      syncVideoToAudio({ force: true, bypassCooldown: true });
    };

    window.addEventListener(playbackSeekedEvent, handlePlaybackSeeked);
    return () => window.removeEventListener(playbackSeekedEvent, handlePlaybackSeeked);
  }, [syncVideoToAudio, trackId]);

  useEffect(() => {
    lastVideoSyncAtRef.current = 0;
    videoSeekingRef.current = false;
  }, [videoMediaUrl]);

  useEffect(() => {
    if (showVideo) {
      syncVideoToAudio({ force: true, bypassCooldown: true });
    }
  }, [selectedMvOffsetMs, showVideo, syncVideoToAudio]);

  useEffect(() => {
    if (!showVideo || !isAudioPlaying || !shouldFollowMusicProgress(settings, selectedVideo, streamingTarget)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      syncVideoToAudio();
    }, mvSyncTrackingIntervalForSettings(settings, selectedVideo, streamingTarget));

    return () => window.clearInterval(intervalId);
  }, [
    isAudioPlaying,
    selectedVideo,
    settings,
    showVideo,
    streamingTarget,
    syncVideoToAudio,
  ]);

  useEffect(() => {
    if (!showVideo || !adaptiveStream || !videoMediaUrl || !videoRef.current) {
      return undefined;
    }

    let disposed = false;
    let player: ShakaPlayerInstance | null = null;
    const videoElement = videoRef.current;

    void import('shaka-player')
      .then((module) => {
        const shaka = ((module as { default?: BrowserShaka }).default ?? module) as BrowserShaka;
        if (disposed || !shaka?.Player) {
          return;
        }

        player = new shaka.Player(videoElement);
        return player.load(videoMediaUrl).then(() => {
          applyVideoPlaybackRate(videoElement);
          syncVideoToAudio({ force: true, bypassCooldown: true });
          if (isAudioPlayingRef.current) {
            playVideo(videoElement);
            return undefined;
          }

          videoElement.pause();
          return undefined;
        });
      })
      .catch(() => setVideoError(true));

    return () => {
      disposed = true;
      if (player) {
        void player.destroy();
      }
    };
  }, [adaptiveStream, applyVideoPlaybackRate, showVideo, syncVideoToAudio, videoMediaUrl]);

  useEffect(() => {
    if (!showImmersiveBackground || !adaptiveStream || !videoMediaUrl || !backgroundVideoRef.current) {
      return undefined;
    }

    let disposed = false;
    let player: ShakaPlayerInstance | null = null;
    const videoElement = backgroundVideoRef.current;

    void import('shaka-player')
      .then((module) => {
        const shaka = ((module as { default?: BrowserShaka }).default ?? module) as BrowserShaka;
        if (disposed || !shaka?.Player) {
          return;
        }

        player = new shaka.Player(videoElement);
        return player.load(videoMediaUrl).then(() => {
          applyVideoPlaybackRate(videoElement);
          syncVideoToAudio({ force: true, bypassCooldown: true });
          if (isAudioPlayingRef.current) {
            playVideo(videoElement);
            return undefined;
          }

          videoElement.pause();
          return undefined;
        });
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (player) {
        void player.destroy();
      }
    };
  }, [adaptiveStream, applyVideoPlaybackRate, showImmersiveBackground, syncVideoToAudio, videoMediaUrl]);

  useEffect(() => {
    if (!smartReadableColorsEnabled || !showImmersiveBackground || !showVideo) {
      return undefined;
    }

    let disposed = false;
    const publishSample = async (): Promise<void> => {
      const videoElement = backgroundVideoRef.current;
      if (!videoElement || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      const sample = await sampleVideoElement(videoElement);
      if (!disposed) {
        window.dispatchEvent(new CustomEvent(lyricsSmartReadableVideoSampleEvent, {
          detail: { trackId, sample },
        }));
      }
    };

    void publishSample();
    const intervalId = window.setInterval(() => {
      void publishSample();
    }, 1500);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [showImmersiveBackground, showVideo, smartReadableColorsEnabled, trackId, videoMediaUrl]);

  useEffect(() => {
    if (!smartReadableColorsEnabled || (showImmersiveBackground && showVideo)) {
      return;
    }

    window.dispatchEvent(new CustomEvent(lyricsSmartReadableVideoSampleEvent, {
      detail: { trackId, sample: null },
    }));
  }, [showImmersiveBackground, showVideo, smartReadableColorsEnabled, trackId]);

  if (!hasLoadedSettings || !isMvEnabled) {
    return (
      <section
        className="lyrics-mv-panel"
        aria-label="MV"
        data-lyrics-readability={isLyricsReadabilityEnhanced ? 'true' : undefined}
        data-mv-enabled="false"
      />
    );
  }

  return (
    <>
      {mvNotice && !isUnavailableNoticeDismissed ? (
        <div className="lyrics-mv-unavailable-reason" aria-live="polite">
          <span>{t('mvPanel.notice.unavailable')}</span>
          <strong>{mvNotice}</strong>
          <button
            type="button"
            className="lyrics-mv-unavailable-close"
            aria-label={t('mvPanel.action.dismissUnavailable')}
            title={t('mvPanel.action.close')}
            onClick={() => setUnavailableNoticeDismissed(true)}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {mvDiagnosticsReport ? (
        <section className="lyrics-mv-diagnostics-report" aria-label="MV diagnostics">
          <div>
            <strong>{t('mvPanel.diagnostics.title')}</strong>
            <button type="button" onClick={copyDiagnosticsReport}>
              <Clipboard size={13} />
              {hasCopiedDiagnosticsReport ? t('mvPanel.action.copied') : t('mvPanel.action.copy')}
            </button>
          </div>
          <textarea readOnly value={mvDiagnosticsReport} />
        </section>
      ) : null}

      {showImmersiveBackground ? (
        <div
          ref={backgroundRef}
          className="lyrics-mv-background"
          aria-hidden="true"
          data-auto-scale={settings.immersiveBackgroundAutoScale === false ? 'false' : 'true'}
          data-provider={showYouTubeImmersiveBackground ? 'youtube' : undefined}
          data-lyrics-readability={isLyricsReadabilityEnhanced ? 'true' : undefined}
          style={immersiveBackgroundStyle}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            backgroundDragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              offsetX: settings.immersiveBackgroundOffsetXPercent ?? 50,
              offsetY: settings.immersiveBackgroundOffsetYPercent ?? 50,
            };
            event.currentTarget.dataset.dragging = 'true';
          }}
          onPointerMove={(event) => updateImmersiveOffsetFromDrag(event)}
          onPointerUp={(event) => {
            updateImmersiveOffsetFromDrag(event, true);
            event.currentTarget.releasePointerCapture(event.pointerId);
            event.currentTarget.dataset.dragging = 'false';
            backgroundDragRef.current = null;
          }}
          onPointerCancel={(event) => {
            event.currentTarget.dataset.dragging = 'false';
            backgroundDragRef.current = null;
          }}
        >
          {showYouTubeImmersiveBackground ? (
            <iframe
              className="lyrics-mv-background-video lyrics-mv-background-video--youtube"
              src={youtubeBackgroundEmbedUrl ?? undefined}
              allow="autoplay; encrypted-media; picture-in-picture"
              tabIndex={-1}
              title=""
            />
          ) : (
            <video
              ref={backgroundVideoRef}
              className="lyrics-mv-background-video"
              src={!adaptiveStream ? (videoMediaUrl ?? undefined) : undefined}
              autoPlay={isAudioPlaying}
              loop
              muted
              onLoadedMetadata={(event) => {
                updateImmersiveVideoSize(event.currentTarget);
                applyVideoPlaybackRate(event.currentTarget);
                syncVideoToAudio({ force: true, bypassCooldown: true });
                if (isAudioPlayingRef.current) {
                  playVideo(event.currentTarget);
                  return;
                }

                event.currentTarget.pause();
              }}
              playsInline
            />
          )}
        </div>
      ) : null}

      <section
        className="lyrics-mv-panel"
        aria-label="MV"
        data-immersive-active={showImmersiveBackground ? 'true' : 'false'}
        data-lyrics-readability={isLyricsReadabilityEnhanced ? 'true' : undefined}
        data-mv-enabled="true"
      >
      <div className="lyrics-mv-ambient" style={coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined} />

      {showVideo ? (
        <div className="lyrics-mv-player">
          <video
            ref={videoRef}
            className="lyrics-mv-video"
            src={!adaptiveStream ? (videoMediaUrl ?? undefined) : undefined}
            autoPlay={isAudioPlaying}
            muted
            onError={() => setVideoError(true)}
            onEnded={() => {
              if (isAudioPlayingRef.current) {
                dispatchMvEndedBeforeAudio(trackId);
              }
            }}
            onLoadedMetadata={(event) => {
              applyVideoPlaybackRate(event.currentTarget);
              syncVideoToAudio({ force: true, bypassCooldown: true });
              if (isAudioPlayingRef.current) {
                playVideo(event.currentTarget);
                return;
              }

              event.currentTarget.pause();
            }}
            onSeeking={() => {
              videoSeekingRef.current = true;
            }}
            onSeeked={() => {
              videoSeekingRef.current = false;
            }}
            playsInline
          />
        </div>
      ) : showYouTubeEmbed ? (
        <div className="lyrics-mv-player">
          <iframe
            className="lyrics-mv-video lyrics-mv-video--youtube"
            src={youtubeEmbedUrl ?? undefined}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title={selectedVideo?.title ?? 'YouTube MV'}
          />
        </div>
      ) : (
        <CoverFallback
          artist={artist}
          coverUrls={uniqueCoverUrls(shouldSurfaceSelectedFallback ? selectedVideo?.thumbnailUrl : null, coverUrl)}
          hideTrackInfo={hideFallbackTrackInfo}
          status={
            isMvEnabled
              ? selectedVideo
                ? videoError && shouldSurfaceSelectedFallback
                  ? 'Playback failed'
                  : shouldSurfaceSelectedFallback
                    ? 'External player required'
                    : 'MV unavailable'
                : isLoading
                  ? 'Loading MV'
                  : 'MV unavailable'
              : 'MV disabled'
          }
          title={(shouldSurfaceSelectedFallback ? selectedVideo?.title : null) ?? title}
        />
      )}
      </section>
    </>
  );
};
