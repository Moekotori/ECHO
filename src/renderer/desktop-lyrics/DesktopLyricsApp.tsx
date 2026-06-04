import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Languages, Lock, Minus, Palette, Plus, RotateCcw, X } from 'lucide-react';
import type { AudioStatus } from '../../shared/types/audio';
import type { AppSettings } from '../../shared/types/appSettings';
import type { ConnectSessionStatus } from '../../shared/types/connect';
import type { DesktopLyricsState, DesktopLyricsStylePatch } from '../../shared/types/desktopLyrics';
import type { LibraryTrack } from '../../shared/types/library';
import type { LyricLine, LyricsKind, LyricsTrackSnapshotRequest, TrackLyrics } from '../../shared/types/lyrics';
import type { PlaybackStatus } from '../../shared/types/playback';
import type { StreamingLyricsResult, StreamingProviderName } from '../../shared/types/streaming';
import { streamingProviderNames } from '../../shared/types/streaming';
import { shouldShowRomanizationForLyrics } from '../../shared/utils/lyricsLanguage';
import { getActiveLyricIndex } from '../components/lyrics/LyricsView';
import { titleFromPath } from '../components/player/playerFormat';
import { logLyricsConsole } from '../diagnostics/lyricsConsole';
import { translateFallback, useOptionalI18n } from '../i18n/I18nProvider';
import { registerAppearanceFontFile, serializeFontList } from '../preferences/appearancePreferences';

type DesktopLyricsSettings = Required<Pick<
  AppSettings,
  | 'desktopLyricsEnabled'
  | 'desktopLyricsLocked'
  | 'desktopLyricsFontSizePx'
  | 'desktopLyricsScalePercent'
  | 'desktopLyricsFontFamily'
  | 'desktopLyricsFontFilePath'
  | 'desktopLyricsColorMode'
  | 'desktopLyricsColor'
  | 'desktopLyricsStrokeColor'
  | 'desktopLyricsOpacityPercent'
  | 'desktopLyricsRomanizationEnabled'
  | 'desktopLyricsTranslationEnabled'
>> & Pick<AppSettings, 'desktopLyricsBounds'>;

type DesktopLyricsStateSnapshot = {
  kind: LyricsKind;
  lines: LyricLine[];
  offsetMs: number;
};

type PlaybackClock = {
  source: 'playback' | 'connect' | 'forwarded';
  currentTrackId: string | null;
  filePath: string | null;
  state: string;
  positionMs: number;
  durationMs: number;
  playbackRate: number;
  updatedAtMs: number;
  nativePositionStalenessMs?: number | null;
  nativeBufferedMs?: number | null;
  nativeUnderrunCallbacks?: number;
};

type ForwardedLyricsMetadata = {
  trackId: string | null;
  filePath: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  durationSeconds: number | null;
};

const fallbackSettings: DesktopLyricsSettings = {
  desktopLyricsEnabled: false,
  desktopLyricsLocked: false,
  desktopLyricsFontSizePx: 34,
  desktopLyricsScalePercent: 100,
  desktopLyricsFontFamily: 'Microsoft YaHei',
  desktopLyricsFontFilePath: null,
  desktopLyricsColorMode: 'theme',
  desktopLyricsColor: '#FFFFFF',
  desktopLyricsStrokeColor: '#111827',
  desktopLyricsOpacityPercent: 96,
  desktopLyricsRomanizationEnabled: true,
  desktopLyricsTranslationEnabled: true,
  desktopLyricsBounds: null,
};

const colorSwatches = ['#FFFFFF', '#FFD166', '#6EE7B7', '#7DD3FC', '#F0ABFC', '#FB7185'];
const forwardedStatusMaxAgeMs = 45_000;
const desktopLyricsClockPollIntervalMs = 700;
const enhancedLowLoadClockPollIntervalMs = 1800;
const enhancedLowLoadLyricSyncIntervalMs = 500;
const desktopLyricsClockStaleTelemetryThresholdMs = 750;
const desktopLyricsClockUnderrunBufferThresholdMs = 40;
const desktopLyricsStageHorizontalPaddingPx = 36;
const desktopLyricsOverflowTolerancePx = 4;
const desktopLyricsMenuRevealSelector = '.desktop-lyrics-lines strong, .desktop-lyrics-lines span, .desktop-lyrics-menu';
const desktopLyricsMouseInteractiveSelector = '.desktop-lyrics-lines, .desktop-lyrics-menu';
const desktopLyricsMenuHideDelayMs = 420;

const readEnhancedLowLoadPlaybackActive = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.lowLoadPlaybackModeEnabled === true && settings.lowLoadPlaybackEnhancementsEnabled === true;

type DesktopLyricsTextFitOptions = {
  text: string;
  availableWidthPx: number;
  fontSizePx: number;
  fontFamily: string;
  fontWeight: number;
  scalePercent: number;
};

let desktopLyricsMeasureCanvas: HTMLCanvasElement | null = null;

const estimateDesktopLyricsTextWidth = (text: string, fontSizePx: number): number =>
  Array.from(text).reduce((width, char) => {
    if (/\s/u.test(char)) {
      return width + fontSizePx * 0.35;
    }
    if (/[\u0000-\u007f]/u.test(char)) {
      return width + fontSizePx * 0.58;
    }
    return width + fontSizePx;
  }, 0);

const measureDesktopLyricsTextWidth = (
  text: string,
  fontSizePx: number,
  fontFamily: string,
  fontWeight: number,
): number => {
  if (typeof document === 'undefined') {
    return estimateDesktopLyricsTextWidth(text, fontSizePx);
  }

  desktopLyricsMeasureCanvas ??= document.createElement('canvas');
  const context = (() => {
    try {
      return desktopLyricsMeasureCanvas?.getContext('2d') ?? null;
    } catch {
      return null;
    }
  })();
  if (!context) {
    return estimateDesktopLyricsTextWidth(text, fontSizePx);
  }

  context.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`;
  return context.measureText(text).width;
};

export const shouldShowDesktopLyricsText = ({
  text,
  availableWidthPx,
  fontSizePx,
  fontFamily,
  fontWeight,
  scalePercent,
}: DesktopLyricsTextFitOptions): boolean => {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return true;
  }

  const scaledTextWidth =
    measureDesktopLyricsTextWidth(normalizedText, fontSizePx, fontFamily, fontWeight) * (scalePercent / 100);
  return scaledTextWidth <= Math.max(0, availableWidthPx) + desktopLyricsOverflowTolerancePx;
};

export const getDesktopLyricsTextFitScale = ({
  text,
  availableWidthPx,
  fontSizePx,
  fontFamily,
  fontWeight,
  scalePercent,
}: DesktopLyricsTextFitOptions): number => {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return 1;
  }

  const scaledTextWidth =
    measureDesktopLyricsTextWidth(normalizedText, fontSizePx, fontFamily, fontWeight) * (scalePercent / 100);
  const availableWidth = Math.max(0, availableWidthPx) + desktopLyricsOverflowTolerancePx;
  if (scaledTextWidth <= availableWidth || availableWidth <= 0) {
    return 1;
  }

  return Math.max(0.62, Math.min(1, availableWidth / scaledTextWidth));
};

const emptyLyrics = (offsetMs = 0): DesktopLyricsStateSnapshot => ({
  kind: 'empty',
  lines: [],
  offsetMs,
});

const trackLyricsToState = (lyrics: TrackLyrics | null, fallbackOffsetMs = 0): DesktopLyricsStateSnapshot => {
  if (!lyrics) {
    return emptyLyrics(fallbackOffsetMs);
  }

  return {
    kind: lyrics.kind,
    lines: lyrics.lines,
    offsetMs: lyrics.offsetMs,
  };
};

const streamingLyricsToState = (result: StreamingLyricsResult, fallbackOffsetMs = 0): DesktopLyricsStateSnapshot => {
  const directLines = result.lines
    .map((line) => ({
      timeMs: line.timeMs ?? -1,
      text: line.text.trim(),
      ...(line.translation ? { translation: line.translation } : {}),
      ...(line.romanization ? { romanization: line.romanization } : {}),
    }))
    .filter((line) => line.text.length > 0);
  const fallbackLines = (result.plainLyrics ?? result.syncedLyrics ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ timeMs: -1, text }));
  const lines = directLines.length ? directLines : fallbackLines;

  return {
    kind: lines.some((line) => line.timeMs >= 0) ? 'synced' : lines.length ? 'plain' : 'empty',
    lines,
    offsetMs: fallbackOffsetMs,
  };
};

const pickDesktopLyricsSettings = (settings: Partial<AppSettings> | null | undefined): DesktopLyricsSettings => ({
  desktopLyricsEnabled: settings?.desktopLyricsEnabled === true,
  desktopLyricsLocked: settings?.desktopLyricsLocked === true,
  desktopLyricsFontSizePx: settings?.desktopLyricsFontSizePx ?? fallbackSettings.desktopLyricsFontSizePx,
  desktopLyricsScalePercent: settings?.desktopLyricsScalePercent ?? fallbackSettings.desktopLyricsScalePercent,
  desktopLyricsFontFamily: settings?.desktopLyricsFontFamily ?? fallbackSettings.desktopLyricsFontFamily,
  desktopLyricsFontFilePath: settings?.desktopLyricsFontFilePath ?? fallbackSettings.desktopLyricsFontFilePath,
  desktopLyricsColorMode:
    settings?.desktopLyricsColorMode === 'custom' || settings?.desktopLyricsColorMode === 'theme'
      ? settings.desktopLyricsColorMode
      : fallbackSettings.desktopLyricsColorMode,
  desktopLyricsColor: settings?.desktopLyricsColor ?? fallbackSettings.desktopLyricsColor,
  desktopLyricsStrokeColor: settings?.desktopLyricsStrokeColor ?? fallbackSettings.desktopLyricsStrokeColor,
  desktopLyricsOpacityPercent: settings?.desktopLyricsOpacityPercent ?? fallbackSettings.desktopLyricsOpacityPercent,
  desktopLyricsRomanizationEnabled: settings?.desktopLyricsRomanizationEnabled ?? fallbackSettings.desktopLyricsRomanizationEnabled,
  desktopLyricsTranslationEnabled: settings?.desktopLyricsTranslationEnabled ?? fallbackSettings.desktopLyricsTranslationEnabled,
  desktopLyricsBounds: settings?.desktopLyricsBounds ?? null,
});

const isStreamingProviderName = (value: string | null | undefined): value is StreamingProviderName =>
  streamingProviderNames.includes(value as StreamingProviderName);

const isStreamingTrack = (
  track: LibraryTrack | null,
): track is LibraryTrack & { provider: StreamingProviderName; providerTrackId: string } =>
  track?.mediaType === 'streaming' &&
  isStreamingProviderName(track.provider) &&
  typeof track.providerTrackId === 'string' &&
  track.providerTrackId.trim().length > 0;

const finiteNonNegative = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, value);
};

const positiveFinite = (value: number | null | undefined): number | null => {
  const normalized = finiteNonNegative(value);
  return normalized && normalized > 0 ? normalized : null;
};

const trimmedText = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

const remoteBrowserTrackIdPattern = /^remote-browser:([^:]+):(.+)$/u;
const remoteIndexedTrackIdPattern = /^remote:([^:]+):(.+)$/u;

const isDesktopLyricsSnapshotTrackId = (trackId: string | null | undefined): boolean =>
  Boolean(
    trackId?.startsWith('remote-browser:') ||
    trackId?.startsWith('dlna-receiver:') ||
    trackId?.startsWith('airplay-receiver:'),
  );

const sourceIdFromRemoteIdentity = (trackId: string | null | undefined, filePath: string | null | undefined): string | null => {
  const remoteBrowserMatch = remoteBrowserTrackIdPattern.exec(trackId ?? '');
  if (remoteBrowserMatch?.[1]) {
    return remoteBrowserMatch[1];
  }

  const remoteIndexedMatch = remoteIndexedTrackIdPattern.exec(trackId ?? '');
  if (remoteIndexedMatch?.[1]) {
    return remoteIndexedMatch[1];
  }

  const remotePathMatch = /^remote:\/\/([^/]+)\//u.exec(filePath ?? '');
  return remotePathMatch?.[1] ?? null;
};

const audioStatusToLyricsMetadata = (status: AudioStatus): ForwardedLyricsMetadata => ({
  trackId: status.currentTrackId,
  filePath: status.currentFilePath,
  title: trimmedText(status.currentTrackTitle),
  artist: trimmedText(status.currentTrackArtist),
  album: trimmedText(status.currentTrackAlbum),
  albumArtist: trimmedText(status.currentTrackAlbumArtist),
  durationSeconds: positiveFinite(status.durationSeconds),
});

const buildDesktopLyricsSnapshotRequest = (
  trackId: string,
  track: LibraryTrack | null,
  metadata: ForwardedLyricsMetadata | null,
): LyricsTrackSnapshotRequest | null => {
  const sourcePath = trimmedText(track?.path) ?? metadata?.filePath ?? null;
  const title = trimmedText(track?.title) ?? metadata?.title ?? (sourcePath ? titleFromPath(sourcePath) : null);
  if (!title) {
    return null;
  }

  const sourceId = trimmedText(track?.sourceId) ?? sourceIdFromRemoteIdentity(trackId, sourcePath);
  return {
    trackId: track?.id ?? trackId,
    title,
    artist:
      trimmedText(track?.artist) ??
      trimmedText(track?.albumArtist) ??
      metadata?.artist ??
      metadata?.albumArtist ??
      'Unknown Artist',
    album: trimmedText(track?.album) ?? metadata?.album ?? null,
    albumArtist: trimmedText(track?.albumArtist) ?? metadata?.albumArtist ?? null,
    durationSeconds: positiveFinite(track?.duration) ?? metadata?.durationSeconds ?? null,
    mediaType: track?.mediaType === 'streaming' ? 'streaming' : 'remote',
    sourceId,
    stableKey: trimmedText(track?.stableKey) ?? trackId,
  };
};

const shouldUseDesktopLyricsSnapshot = (
  trackId: string,
  track: LibraryTrack | null,
  metadata: ForwardedLyricsMetadata | null,
): boolean =>
  Boolean(
    track?.isTemporary ||
    isDesktopLyricsSnapshotTrackId(trackId) ||
    isDesktopLyricsSnapshotTrackId(track?.id) ||
    (!track && (
      isDesktopLyricsSnapshotTrackId(trackId) ||
      trackId.startsWith('remote:') ||
      metadata?.filePath?.startsWith('remote://')
    )),
  );

const parseStreamingTrackId = (trackId: string | null): { provider: StreamingProviderName; providerTrackId: string } | null => {
  const match = /^streaming:([^:]+):(.+)$/u.exec(trackId ?? '');
  if (!match || !isStreamingProviderName(match[1])) {
    return null;
  }

  return {
    provider: match[1],
    providerTrackId: match[2],
  };
};

const playbackStatusToClock = (status: PlaybackStatus, updatedAtMs: number): PlaybackClock => ({
  source: 'playback',
  currentTrackId: status.currentTrackId,
  filePath: status.filePath,
  state: status.state,
  positionMs: status.positionMs,
  durationMs: status.durationMs,
  playbackRate: 1,
  updatedAtMs,
});

const hqPlayerDesktopLyricsStates = new Set(['connecting', 'ready', 'playing', 'paused', 'stopped']);

export const hqPlayerConnectStatusToDesktopLyricsClock = (
  status: ConnectSessionStatus | null | undefined,
  updatedAtMs: number,
): PlaybackClock | null => {
  if (
    status?.protocol !== 'hqplayer' ||
    !status.currentTrackId ||
    !hqPlayerDesktopLyricsStates.has(status.state)
  ) {
    return null;
  }

  return {
    source: 'connect',
    currentTrackId: status.currentTrackId,
    filePath: null,
    state: status.state === 'ready' || status.state === 'connecting' ? 'loading' : status.state,
    positionMs: Math.round(Math.max(0, status.positionSeconds) * 1000),
    durationMs: Math.round(Math.max(0, status.durationSeconds || status.metadata?.durationSeconds || 0) * 1000),
    playbackRate: 1,
    updatedAtMs,
  };
};

const audioStatusToClock = (status: AudioStatus, updatedAtMs: number): PlaybackClock => ({
  source: 'forwarded',
  currentTrackId: status.currentTrackId,
  filePath: status.currentFilePath,
  state: status.state,
  positionMs: Math.round(status.positionSeconds * 1000),
  durationMs: Math.round(status.durationSeconds * 1000),
  playbackRate: status.playbackRate ?? 1,
  updatedAtMs,
  nativePositionStalenessMs: finiteNonNegative(status.nativePositionStalenessMs),
  nativeBufferedMs: finiteNonNegative(status.nativeBufferedMs),
  nativeUnderrunCallbacks: status.nativeUnderrunCallbacks,
});

const clockHasIdentity = (clock: PlaybackClock | null): boolean => Boolean(clock?.currentTrackId || clock?.filePath);

const clocksHaveSameIdentity = (left: PlaybackClock | null, right: PlaybackClock | null): boolean =>
  Boolean(
    left &&
    right &&
    (
      (left.currentTrackId && left.currentTrackId === right.currentTrackId) ||
      (left.filePath && left.filePath === right.filePath)
    ),
  );

const isActiveClock = (clock: PlaybackClock | null): boolean =>
  Boolean(clock && clockHasIdentity(clock) && ['loading', 'playing', 'paused'].includes(clock.state));

const getEstimatedPlainLyricIndex = (lines: LyricLine[], positionMs: number, durationMs: number): number => {
  if (!lines.length) {
    return -1;
  }

  if (!durationMs || durationMs <= 0) {
    return 0;
  }

  const progress = Math.max(0, Math.min(0.999999, positionMs / durationMs));
  return Math.max(0, Math.min(lines.length - 1, Math.floor(progress * lines.length)));
};

export const getInterpolatedPositionMs = (clock: PlaybackClock): number => {
  if (clock.state !== 'playing') {
    return Math.max(0, clock.positionMs);
  }

  const nativePositionStalenessMs = finiteNonNegative(clock.nativePositionStalenessMs);
  const nativeBufferedMs = finiteNonNegative(clock.nativeBufferedMs);
  const nativeUnderrunCallbacks = finiteNonNegative(clock.nativeUnderrunCallbacks);
  if (
    (nativePositionStalenessMs !== null && nativePositionStalenessMs >= desktopLyricsClockStaleTelemetryThresholdMs) ||
    (
      nativeUnderrunCallbacks !== null &&
      nativeUnderrunCallbacks > 0 &&
      nativeBufferedMs !== null &&
      nativeBufferedMs <= desktopLyricsClockUnderrunBufferThresholdMs
    )
  ) {
    return Math.max(0, clock.positionMs);
  }

  const elapsedMs = Math.max(0, performance.now() - clock.updatedAtMs);
  const durationLimit = clock.durationMs > 0 ? clock.durationMs : Number.POSITIVE_INFINITY;
  return Math.min(durationLimit, Math.max(0, clock.positionMs + elapsedMs * clock.playbackRate));
};

const getActiveIndex = (lyrics: DesktopLyricsStateSnapshot, clock: PlaybackClock): number => {
  const positionMs = getInterpolatedPositionMs(clock);
  if (lyrics.kind === 'synced') {
    return getActiveLyricIndex(lyrics.lines, positionMs, lyrics.offsetMs);
  }

  if (lyrics.kind === 'plain') {
    return getEstimatedPlainLyricIndex(lyrics.lines, positionMs, clock.durationMs);
  }

  return -1;
};

const lineText = (line: LyricLine | null | undefined): string => line?.text.trim() ?? '';

const clockIdentity = (clock: PlaybackClock | null): string | null =>
  clock?.currentTrackId ?? clock?.filePath ?? null;

const summarizeClockForLyricsLog = (clock: PlaybackClock | null): Record<string, unknown> | null =>
  clock
    ? {
        source: clock.source,
        state: clock.state,
        trackId: clock.currentTrackId,
        identity: clockIdentity(clock),
        positionMs: Math.round(clock.positionMs),
        durationMs: clock.durationMs,
        playbackRate: clock.playbackRate,
        ageMs: Math.round(performance.now() - clock.updatedAtMs),
        nativePositionStalenessMs: clock.nativePositionStalenessMs ?? null,
        nativeBufferedMs: clock.nativeBufferedMs ?? null,
        nativeUnderrunCallbacks: clock.nativeUnderrunCallbacks ?? null,
      }
    : null;

const secondaryLineTexts = (
  line: LyricLine | null | undefined,
  showRomanization: boolean,
  showTranslation: boolean,
): string[] => {
  const romanization = showRomanization ? line?.romanization?.trim() : '';
  const translation = showTranslation ? line?.translation?.trim() : '';
  return [romanization, translation].filter((text): text is string => Boolean(text));
};

export const DesktopLyricsApp = (): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [settings, setSettings] = useState<DesktopLyricsSettings>(fallbackSettings);
  const [playbackClock, setPlaybackClock] = useState<PlaybackClock | null>(null);
  const [forwardedClock, setForwardedClock] = useState<PlaybackClock | null>(null);
  const [forwardedLyricsMetadata, setForwardedLyricsMetadata] = useState<ForwardedLyricsMetadata | null>(null);
  const [forwardedUpdatedAtMs, setForwardedUpdatedAtMs] = useState(0);
  const [lyrics, setLyrics] = useState<DesktopLyricsStateSnapshot>(() => emptyLyrics());
  const [lyricsRefreshToken, setLyricsRefreshToken] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [viewportWidthPx, setViewportWidthPx] = useState(() => window.innerWidth);
  const [enhancedLowLoadPlaybackActive, setEnhancedLowLoadPlaybackActive] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const lyricsRequestRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastActiveClockLogRef = useRef<{ key: string; positionMs: number } | null>(null);

  const activeClock = useMemo(() => {
    const forwardedClockFresh =
      forwardedClock &&
      clockHasIdentity(forwardedClock) &&
      performance.now() - forwardedUpdatedAtMs <= forwardedStatusMaxAgeMs;

    if (isActiveClock(playbackClock) && playbackClock?.source === 'connect') {
      return playbackClock;
    }

    if (
      forwardedClockFresh &&
      (!isActiveClock(playbackClock) || clocksHaveSameIdentity(forwardedClock, playbackClock))
    ) {
      return forwardedClock;
    }

    return playbackClock;
  }, [forwardedClock, forwardedUpdatedAtMs, playbackClock]);

  const activeTrackId = activeClock?.currentTrackId ?? null;
  const activeForwardedLyricsMetadata = useMemo(() => {
    if (!activeClock || !forwardedLyricsMetadata) {
      return null;
    }

    if (activeClock.currentTrackId && activeClock.currentTrackId === forwardedLyricsMetadata.trackId) {
      return forwardedLyricsMetadata;
    }

    if (activeClock.filePath && activeClock.filePath === forwardedLyricsMetadata.filePath) {
      return forwardedLyricsMetadata;
    }

    return null;
  }, [
    activeClock?.currentTrackId,
    activeClock?.filePath,
    forwardedLyricsMetadata?.album,
    forwardedLyricsMetadata?.albumArtist,
    forwardedLyricsMetadata?.artist,
    forwardedLyricsMetadata?.durationSeconds,
    forwardedLyricsMetadata?.filePath,
    forwardedLyricsMetadata?.title,
    forwardedLyricsMetadata?.trackId,
  ]);

  useEffect(() => {
    if (!activeClock) {
      lastActiveClockLogRef.current = null;
      logLyricsConsole('desktop.active-clock', { clock: null }, { dedupeKey: 'desktop-active-clock:none', dedupeMs: 2000 });
      return;
    }

    const identity = clockIdentity(activeClock) ?? 'unknown';
    const key = `${activeClock.source}:${identity}:${activeClock.state}`;
    const lastLog = lastActiveClockLogRef.current;
    const positionJumpMs = lastLog && lastLog.key === key ? activeClock.positionMs - lastLog.positionMs : 0;
    const shouldLog =
      !lastLog ||
      lastLog.key !== key ||
      positionJumpMs < -1500 ||
      positionJumpMs > 7000;
    if (!shouldLog) {
      return;
    }

    lastActiveClockLogRef.current = { key, positionMs: activeClock.positionMs };
    logLyricsConsole(
      'desktop.active-clock',
      {
        clock: summarizeClockForLyricsLog(activeClock),
        previousKey: lastLog?.key ?? null,
        positionJumpMs,
      },
      { dedupeKey: `desktop-active-clock:${key}`, dedupeMs: 700 },
    );
  }, [activeClock]);

  const refreshPlaybackClock = useCallback(async (): Promise<void> => {
    const playback = window.echo?.playback;
    if (!playback?.getStatus) {
      return;
    }

    try {
      const [playbackStatus, connectStatus] = await Promise.all([
        playback.getStatus().catch(() => null),
        window.echo?.connect?.getStatus?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      const updatedAtMs = performance.now();
      const connectClock = hqPlayerConnectStatusToDesktopLyricsClock(connectStatus, updatedAtMs);
      setPlaybackClock(connectClock ?? (playbackStatus ? playbackStatusToClock(playbackStatus, updatedAtMs) : null));
    } catch {
      setPlaybackClock(null);
    }
  }, []);

  useEffect(() => {
    const updateViewportWidth = (): void => setViewportWidthPx(window.innerWidth);
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  useEffect(() => {
    let disposed = false;
    const loadSettings = async (): Promise<void> => {
      try {
        const [appSettings, desktopState] = await Promise.all([
          window.echo?.app?.getSettings?.(),
          window.echo?.desktopLyrics?.getState?.(),
        ]);
        if (disposed) {
          return;
        }

        setSettings(pickDesktopLyricsSettings(desktopState?.settings ?? appSettings));
        setEnhancedLowLoadPlaybackActive(readEnhancedLowLoadPlaybackActive(appSettings));
      } catch {
        if (!disposed) {
          setSettings(fallbackSettings);
          setEnhancedLowLoadPlaybackActive(false);
        }
      }
    };

    void loadSettings();
    const unsubscribe = window.echo?.desktopLyrics?.onStateChanged?.((state: DesktopLyricsState) => {
      setSettings(pickDesktopLyricsSettings(state.settings));
    });

    const handleSettingsChanged = (event: Event): void => {
      const detail = (event as CustomEvent<Partial<AppSettings> | null | undefined>).detail;
      if (
        !detail ||
        (
          !Object.prototype.hasOwnProperty.call(detail, 'lowLoadPlaybackModeEnabled') &&
          !Object.prototype.hasOwnProperty.call(detail, 'lowLoadPlaybackEnhancementsEnabled')
        )
      ) {
        return;
      }

      void window.echo?.app?.getSettings?.()
        .then((nextSettings) => {
          if (!disposed) {
            setEnhancedLowLoadPlaybackActive(readEnhancedLowLoadPlaybackActive(nextSettings));
          }
        })
        .catch(() => undefined);
    };

    window.addEventListener('settings:changed', handleSettingsChanged);

    return () => {
      disposed = true;
      unsubscribe?.();
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics?.setMousePassthrough) {
      return undefined;
    }

    let lastPassthrough: boolean | null = null;
    const setPassthrough = (passthrough: boolean): void => {
      if (lastPassthrough === passthrough) {
        return;
      }

      lastPassthrough = passthrough;
      desktopLyrics.setMousePassthrough(passthrough);
    };

    if (settings.desktopLyricsLocked) {
      setPassthrough(true);
      return () => {
        desktopLyrics.setMousePassthrough(false);
      };
    }

    let hideMenuTimer: number | null = null;
    const clearHideMenuTimer = (): void => {
      if (hideMenuTimer !== null) {
        window.clearTimeout(hideMenuTimer);
        hideMenuTimer = null;
      }
    };
    const updateMenuVisible = (visible: boolean, delayed = false): void => {
      if (visible) {
        clearHideMenuTimer();
        setMenuVisible((current) => (current ? current : true));
        return;
      }

      if (delayed) {
        if (hideMenuTimer === null) {
          hideMenuTimer = window.setTimeout(() => {
            hideMenuTimer = null;
            setMenuVisible(false);
          }, desktopLyricsMenuHideDelayMs);
        }
        return;
      }

      clearHideMenuTimer();
      setMenuVisible((current) => (current === visible ? current : visible));
    };
    const updatePassthrough = (event: MouseEvent): void => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const overMenuRevealSurface = Boolean(target?.closest(desktopLyricsMenuRevealSelector));
      const overInteractiveSurface = Boolean(target?.closest(desktopLyricsMouseInteractiveSelector));
      updateMenuVisible(overMenuRevealSurface, !overMenuRevealSurface);
      setPassthrough(!overInteractiveSurface);
    };
    const passthroughOnLeave = (): void => {
      updateMenuVisible(false);
      setPassthrough(true);
    };

    window.addEventListener('mousemove', updatePassthrough);
    window.addEventListener('mouseleave', passthroughOnLeave);
    window.addEventListener('blur', passthroughOnLeave);
    document.addEventListener('visibilitychange', passthroughOnLeave);
    setPassthrough(true);

    return () => {
      clearHideMenuTimer();
      window.removeEventListener('mousemove', updatePassthrough);
      window.removeEventListener('mouseleave', passthroughOnLeave);
      window.removeEventListener('blur', passthroughOnLeave);
      document.removeEventListener('visibilitychange', passthroughOnLeave);
      desktopLyrics.setMousePassthrough(false);
    };
  }, [settings.desktopLyricsLocked]);

  useEffect(() => {
    if (!settings.desktopLyricsFontFilePath) {
      return;
    }

    void window.echo?.app
      .loadFontFile(settings.desktopLyricsFontFilePath)
      .then((fontFile) => registerAppearanceFontFile('desktopLyrics', fontFile))
      .catch(() => undefined);
  }, [settings.desktopLyricsFontFilePath]);

  useEffect(() => {
    const desktopLyrics = window.echo?.desktopLyrics;
    void desktopLyrics?.getLastAudioStatus?.().then((status) => {
      if (status) {
        const updatedAtMs = performance.now();
        const clock = audioStatusToClock(status, updatedAtMs);
        logLyricsConsole('desktop.receive-clock', { source: 'audio', clock: summarizeClockForLyricsLog(clock) }, {
          dedupeKey: `desktop-receive-audio:${clockIdentity(clock) ?? 'unknown'}:${Math.floor(clock.positionMs / 5000)}`,
          dedupeMs: 500,
        });
        setForwardedClock(clock);
        setForwardedLyricsMetadata(audioStatusToLyricsMetadata(status));
        setForwardedUpdatedAtMs(updatedAtMs);
      }
    }).catch(() => undefined);

    const unsubscribe = desktopLyrics?.onAudioStatus?.((status) => {
      const updatedAtMs = performance.now();
      const clock = audioStatusToClock(status, updatedAtMs);
      logLyricsConsole('desktop.receive-clock', { source: 'audio', clock: summarizeClockForLyricsLog(clock) }, {
        dedupeKey: `desktop-receive-audio:${clockIdentity(clock) ?? 'unknown'}:${Math.floor(clock.positionMs / 5000)}`,
        dedupeMs: 500,
      });
      setForwardedClock(clock);
      setForwardedLyricsMetadata(audioStatusToLyricsMetadata(status));
      setForwardedUpdatedAtMs(updatedAtMs);
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const desktopLyrics = window.echo?.desktopLyrics;
    void desktopLyrics?.getLastPlaybackStatus?.().then((status) => {
      if (status) {
        const updatedAtMs = performance.now();
        const clock = playbackStatusToClock(status, updatedAtMs);
        logLyricsConsole('desktop.receive-clock', { source: 'playback', clock: summarizeClockForLyricsLog(clock) }, {
          dedupeKey: `desktop-receive-playback:${clockIdentity(clock) ?? 'unknown'}:${Math.floor(clock.positionMs / 5000)}`,
          dedupeMs: 500,
        });
        setForwardedClock(clock);
        setForwardedUpdatedAtMs(updatedAtMs);
      }
    }).catch(() => undefined);

    const unsubscribe = desktopLyrics?.onPlaybackStatus?.((status) => {
      const updatedAtMs = performance.now();
      const clock = playbackStatusToClock(status, updatedAtMs);
      logLyricsConsole('desktop.receive-clock', { source: 'playback', clock: summarizeClockForLyricsLog(clock) }, {
        dedupeKey: `desktop-receive-playback:${clockIdentity(clock) ?? 'unknown'}:${Math.floor(clock.positionMs / 5000)}`,
        dedupeMs: 500,
      });
      setForwardedClock(clock);
      setForwardedUpdatedAtMs(updatedAtMs);
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    void refreshPlaybackClock();
    const intervalMs = enhancedLowLoadPlaybackActive ? enhancedLowLoadClockPollIntervalMs : desktopLyricsClockPollIntervalMs;
    const timer = window.setInterval(() => {
      void refreshPlaybackClock();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enhancedLowLoadPlaybackActive, refreshPlaybackClock]);

  useEffect(() => {
    const unsubscribe = window.echo?.connect?.onStatus?.((status) => {
      const connectClock = hqPlayerConnectStatusToDesktopLyricsClock(status, performance.now());
      if (connectClock) {
        setPlaybackClock(connectClock);
        return;
      }

      void refreshPlaybackClock();
    });

    return () => unsubscribe?.();
  }, [refreshPlaybackClock]);

  useEffect(() => {
    const unsubscribe = window.echo?.lyrics?.onChanged?.((trackId) => {
      if (
        trackId === activeTrackId ||
        (activeForwardedLyricsMetadata?.trackId && trackId === activeForwardedLyricsMetadata.trackId)
      ) {
        setLyricsRefreshToken((token) => (token + 1) % 1000000);
      }
    });

    return () => unsubscribe?.();
  }, [activeForwardedLyricsMetadata?.trackId, activeTrackId]);

  useEffect(() => {
    const requestId = lyricsRequestRef.current + 1;
    lyricsRequestRef.current = requestId;

    if (!activeTrackId) {
      setLyrics(emptyLyrics());
      return;
    }

    const loadLyrics = async (): Promise<void> => {
      const lyricsApi = window.echo?.lyrics;
      const libraryApi = window.echo?.library;
      const streamingApi = window.echo?.streaming;
      let track: LibraryTrack | null = null;

      try {
        track = await libraryApi?.getTrack?.(activeTrackId) ?? null;
      } catch {
        track = null;
      }

      if (lyricsRequestRef.current !== requestId) {
        return;
      }

      const streamingTarget = isStreamingTrack(track)
        ? { provider: track.provider, providerTrackId: track.providerTrackId }
        : parseStreamingTrackId(activeTrackId) ?? parseStreamingTrackId(activeClock?.filePath ?? null);

      try {
        if (streamingTarget && streamingApi?.getLyrics) {
          const streamingLyrics = await streamingApi.getLyrics(streamingTarget);
          if (lyricsRequestRef.current === requestId) {
            const nextLyrics = streamingLyricsToState(streamingLyrics);
            logLyricsConsole('desktop.lyrics-loaded', {
              source: 'streaming',
              trackId: activeTrackId,
              kind: nextLyrics.kind,
              lineCount: nextLyrics.lines.length,
              offsetMs: nextLyrics.offsetMs,
            });
            setLyrics(nextLyrics);
          }
          return;
        }

        if (
          shouldUseDesktopLyricsSnapshot(activeTrackId, track, activeForwardedLyricsMetadata) &&
          lyricsApi?.getForSnapshot
        ) {
          const snapshotRequest = buildDesktopLyricsSnapshotRequest(activeTrackId, track, activeForwardedLyricsMetadata);
          if (snapshotRequest) {
            const snapshotLyrics = await lyricsApi.getForSnapshot(snapshotRequest);
            if (lyricsRequestRef.current === requestId) {
              const nextLyrics = trackLyricsToState(snapshotLyrics ?? null);
              logLyricsConsole('desktop.lyrics-loaded', {
                source: 'snapshot',
                trackId: activeTrackId,
                kind: nextLyrics.kind,
                lineCount: nextLyrics.lines.length,
                offsetMs: nextLyrics.offsetMs,
              });
              setLyrics(nextLyrics);
            }
            return;
          }
        }

        const trackLyrics = await lyricsApi?.getForTrack?.(activeTrackId);
        if (lyricsRequestRef.current === requestId) {
          const nextLyrics = trackLyricsToState(trackLyrics ?? null);
          logLyricsConsole('desktop.lyrics-loaded', {
            source: 'library',
            trackId: activeTrackId,
            kind: nextLyrics.kind,
            lineCount: nextLyrics.lines.length,
            offsetMs: nextLyrics.offsetMs,
          });
          setLyrics(nextLyrics);
        }
      } catch {
        if (lyricsRequestRef.current === requestId) {
          logLyricsConsole('desktop.lyrics-load-failed', {
            trackId: activeTrackId,
            clock: summarizeClockForLyricsLog(activeClock),
          }, { level: 'warn', dedupeKey: `desktop-lyrics-load-failed:${activeTrackId}`, dedupeMs: 2000 });
          setLyrics(emptyLyrics());
        }
      }
    };

    setLyrics(emptyLyrics());
    void loadLyrics();
  }, [activeClock?.filePath, activeForwardedLyricsMetadata, activeTrackId, lyricsRefreshToken]);

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!activeClock) {
      setActiveIndex(-1);
      return undefined;
    }

    const sync = (): void => {
      const nextIndex = getActiveIndex(lyrics, activeClock);
      setActiveIndex((current) => {
        if (current === nextIndex) {
          return current;
        }

        const indexJump = current >= 0 && nextIndex >= 0 ? nextIndex - current : 0;
        if (current >= 0 && nextIndex >= 0 && (indexJump < 0 || Math.abs(indexJump) > 1)) {
          logLyricsConsole(
            'desktop.line-jump',
            {
              from: current,
              to: nextIndex,
              indexJump,
              kind: lyrics.kind,
              lineCount: lyrics.lines.length,
              clock: summarizeClockForLyricsLog(activeClock),
              interpolatedPositionMs: Math.round(getInterpolatedPositionMs(activeClock)),
            },
            { level: 'warn', dedupeKey: `desktop-line-jump:${clockIdentity(activeClock) ?? 'unknown'}`, dedupeMs: 700 },
          );
        }

        return nextIndex;
      });
    };

    sync();
    if (activeClock.state !== 'playing') {
      return undefined;
    }

    if (enhancedLowLoadPlaybackActive) {
      const timer = window.setInterval(sync, enhancedLowLoadLyricSyncIntervalMs);
      return () => window.clearInterval(timer);
    }

    const tick = (): void => {
      sync();
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [activeClock, enhancedLowLoadPlaybackActive, lyrics]);

  const patchStyle = useCallback(async (patch: DesktopLyricsStylePatch): Promise<void> => {
    setSettings((current) => pickDesktopLyricsSettings({ ...current, ...patch }));
    try {
      const state = await window.echo?.desktopLyrics?.setStyle?.(patch);
      if (state) {
        setSettings(pickDesktopLyricsSettings(state.settings));
      }
    } catch {
      setSettings((current) => current);
    }
  }, []);

  const setLocked = useCallback(async (): Promise<void> => {
    try {
      const state = await window.echo?.desktopLyrics?.setLocked?.(true);
      if (state) {
        setSettings(pickDesktopLyricsSettings(state.settings));
      }
    } catch {
      setSettings((current) => current);
    }
  }, []);

  const unlockFromContextMenu = useCallback(async (event: ReactMouseEvent): Promise<void> => {
    if (!settings.desktopLyricsLocked) {
      return;
    }

    event.preventDefault();
    try {
      const state = await window.echo?.desktopLyrics?.setLocked?.(false);
      if (state) {
        setSettings(pickDesktopLyricsSettings(state.settings));
      }
    } catch {
      setSettings((current) => current);
    }
  }, [settings.desktopLyricsLocked]);

  const hideWindow = useCallback((): void => {
    void window.echo?.desktopLyrics?.hide?.();
  }, []);

  const resetBounds = useCallback((): void => {
    void window.echo?.desktopLyrics?.resetBounds?.();
  }, []);
  const handleMenuFocus = useCallback((): void => {
    setMenuVisible(true);
  }, []);
  const handleMenuBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setMenuVisible(false);
    }
  }, []);

  const currentLine = activeIndex >= 0 ? lyrics.lines[activeIndex] : lyrics.lines[0];
  const canShowRomanization = shouldShowRomanizationForLyrics(lyrics.lines);
  const primaryText =
    lyrics.kind === 'instrumental'
      ? t('desktopLyrics.primary.instrumental')
      : lineText(currentLine) || (clockHasIdentity(activeClock) ? t('desktopLyrics.primary.empty') : 'ECHO NEXT');
  const secondaryTexts =
    lyrics.kind === 'instrumental'
      ? []
      : secondaryLineTexts(
        currentLine,
        settings.desktopLyricsRomanizationEnabled && canShowRomanization,
        settings.desktopLyricsTranslationEnabled,
      );
  const visibleSecondaryTexts = lyrics.kind === 'instrumental'
    ? []
    : lineText(currentLine)
      ? secondaryTexts
      : [clockHasIdentity(activeClock) ? 'Desktop Lyrics' : t('desktopLyrics.secondary.waiting')];
  const desktopLyricsFontFamily = [
    serializeFontList(settings.desktopLyricsFontFamily),
    '"Noto Sans SC"',
    '"Microsoft YaHei"',
    '"Segoe UI"',
    'sans-serif',
  ].join(', ');
  const availableTextWidthPx = Math.max(0, viewportWidthPx - desktopLyricsStageHorizontalPaddingPx);
  const primaryTextFitScale = getDesktopLyricsTextFitScale({
    text: primaryText,
    availableWidthPx: availableTextWidthPx,
    fontSizePx: settings.desktopLyricsFontSizePx,
    fontFamily: desktopLyricsFontFamily,
    fontWeight: 700,
    scalePercent: settings.desktopLyricsScalePercent,
  });
  const visibleFittingSecondaryTexts = visibleSecondaryTexts.filter((text) =>
    shouldShowDesktopLyricsText({
      text,
      availableWidthPx: availableTextWidthPx,
      fontSizePx: settings.desktopLyricsFontSizePx * 0.56,
      fontFamily: desktopLyricsFontFamily,
      fontWeight: 600,
      scalePercent: settings.desktopLyricsScalePercent,
    }),
  );
  const desktopLyricsColor =
    settings.desktopLyricsColorMode === 'custom'
      ? settings.desktopLyricsColor
      : 'var(--desktop-lyrics-theme-color)';
  const desktopLyricsStrokeColor =
    settings.desktopLyricsColorMode === 'custom'
      ? settings.desktopLyricsStrokeColor
      : 'var(--desktop-lyrics-theme-stroke-color)';

  const style = {
    '--desktop-lyrics-font-size': `${settings.desktopLyricsFontSizePx}px`,
    '--desktop-lyrics-scale': (settings.desktopLyricsScalePercent / 100).toFixed(2),
    '--desktop-lyrics-font-family': desktopLyricsFontFamily,
    '--desktop-lyrics-color': desktopLyricsColor,
    '--desktop-lyrics-stroke-color': desktopLyricsStrokeColor,
    '--desktop-lyrics-opacity': (settings.desktopLyricsOpacityPercent / 100).toFixed(2),
  } as CSSProperties;
  const primaryTextStyle = {
    '--desktop-lyrics-text-fit-scale': primaryTextFitScale.toFixed(3),
  } as CSSProperties;

  return (
    <main
      className="desktop-lyrics-app"
      data-color-mode={settings.desktopLyricsColorMode}
      data-locked={settings.desktopLyricsLocked}
      data-menu-visible={menuVisible}
      style={style}
    >
      <section className="desktop-lyrics-stage" aria-label={t('desktopLyrics.aria.stage')}>
        <div className="desktop-lyrics-lines" onContextMenu={(event) => void unlockFromContextMenu(event)}>
          <strong style={primaryTextStyle}>{primaryText}</strong>
          {visibleFittingSecondaryTexts.map((text, index) => (
            <span key={`${index}-${text}`}>{text}</span>
          ))}
        </div>

        {!settings.desktopLyricsLocked ? (
          <div className="desktop-lyrics-menu" onBlur={handleMenuBlur} onFocus={handleMenuFocus}>
            <button
              type="button"
              title={t('desktopLyrics.control.decreaseFontSize')}
              aria-label={t('desktopLyrics.control.decreaseFontSize')}
              onClick={() => void patchStyle({ desktopLyricsFontSizePx: settings.desktopLyricsFontSizePx - 2 })}
            >
              <Minus size={14} />
            </button>
            <output>{settings.desktopLyricsFontSizePx}px</output>
            <button
              type="button"
              title={t('desktopLyrics.control.increaseFontSize')}
              aria-label={t('desktopLyrics.control.increaseFontSize')}
              onClick={() => void patchStyle({ desktopLyricsFontSizePx: settings.desktopLyricsFontSizePx + 2 })}
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              title={t('desktopLyrics.control.decreaseScale')}
              aria-label={t('desktopLyrics.control.decreaseScale')}
              onClick={() => void patchStyle({ desktopLyricsScalePercent: settings.desktopLyricsScalePercent - 5 })}
            >
              <Minus size={14} />
            </button>
            <output>{settings.desktopLyricsScalePercent}%</output>
            <button
              type="button"
              title={t('desktopLyrics.control.increaseScale')}
              aria-label={t('desktopLyrics.control.increaseScale')}
              onClick={() => void patchStyle({ desktopLyricsScalePercent: settings.desktopLyricsScalePercent + 5 })}
            >
              <Plus size={14} />
            </button>
            <Palette size={15} aria-hidden="true" />
            <div className="desktop-lyrics-swatches">
              <button
                aria-label={t('desktopLyrics.control.themeColor')}
                aria-pressed={settings.desktopLyricsColorMode === 'theme'}
                className="desktop-lyrics-theme-swatch"
                title={t('desktopLyrics.control.themeColor')}
                type="button"
                onClick={() => void patchStyle({ desktopLyricsColorMode: 'theme' })}
              />
              {colorSwatches.map((color) => (
                <button
                  aria-label={t('desktopLyrics.control.colorSwatch', { color })}
                  aria-pressed={
                    settings.desktopLyricsColorMode === 'custom' &&
                    settings.desktopLyricsColor.toUpperCase() === color
                  }
                  key={color}
                  style={{ background: color }}
                  title={color}
                  type="button"
                  onClick={() => void patchStyle({ desktopLyricsColorMode: 'custom', desktopLyricsColor: color })}
                />
              ))}
            </div>
            <input
              aria-label={t('desktopLyrics.control.customColor')}
              title={t('desktopLyrics.control.customColor')}
              type="color"
              value={settings.desktopLyricsColor}
              onChange={(event) =>
                void patchStyle({ desktopLyricsColorMode: 'custom', desktopLyricsColor: event.currentTarget.value })}
            />
            <button
              className="desktop-lyrics-menu-toggle"
              type="button"
              title={t('desktopLyrics.control.romanization')}
              aria-label={t('desktopLyrics.control.romanization')}
              aria-pressed={settings.desktopLyricsRomanizationEnabled}
              onClick={() =>
                void patchStyle({ desktopLyricsRomanizationEnabled: !settings.desktopLyricsRomanizationEnabled })}
            >
              <Languages size={14} />
              <span>R</span>
            </button>
            <button
              className="desktop-lyrics-menu-toggle"
              type="button"
              title={t('desktopLyrics.control.translation')}
              aria-label={t('desktopLyrics.control.translation')}
              aria-pressed={settings.desktopLyricsTranslationEnabled}
              onClick={() =>
                void patchStyle({ desktopLyricsTranslationEnabled: !settings.desktopLyricsTranslationEnabled })}
            >
              <Languages size={14} />
              <span>{t('desktopLyrics.control.translationShort')}</span>
            </button>
            <button type="button" title={t('desktopLyrics.control.lock')} aria-label={t('desktopLyrics.control.lock')} onClick={() => void setLocked()}>
              <Lock size={14} />
            </button>
            <button type="button" title={t('desktopLyrics.control.resetPosition')} aria-label={t('desktopLyrics.control.resetPosition')} onClick={resetBounds}>
              <RotateCcw size={14} />
            </button>
            <button type="button" title={t('desktopLyrics.control.close')} aria-label={t('desktopLyrics.control.close')} onClick={hideWindow}>
              <X size={14} />
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
};
