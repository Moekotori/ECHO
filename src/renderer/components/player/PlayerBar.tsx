import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Captions, Download, FileDown, Loader2, Monitor } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { audioExportFormats, type AudioExportFormat, type AudioStatus } from '../../../shared/types/audio';
import { isReliableBpmAnalysis } from '../../../shared/constants/audioAnalysis';
import type { AirPlayReceiverStatus, ConnectMetadata, ConnectReceiverStatus, ConnectSessionStatus } from '../../../shared/types/connect';
import type { DownloadJob, DownloadJobStatus } from '../../../shared/types/downloads';
import type { LibraryTrack } from '../../../shared/types/library';
import type { PlaybackStatus } from '../../../shared/types/playback';
import type { MiniPlayerState } from '../../../shared/types/miniPlayer';
import { streamingProviderNames, type StreamingProviderName } from '../../../shared/types/streaming';
import { likedChangedEvent, likedTracksChangedEvent } from '../../hooks/useLikedMedia';
import { translateFallback } from '../../i18n/I18nProvider';
import {
  isSpotifyTrack,
  pauseSpotifyPlayback,
  resumeSpotifyPlayback,
  seekSpotifyPlayback,
  setSpotifyVolume,
} from '../../integrations/spotify/spotifyPlayback';
import { usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { beginPlaybackSeekSnapshot, getVisualPlaybackState, refreshPlaybackStatus, setPlaybackStatusSnapshot, useSharedPlaybackStatus } from '../../stores/playbackStatusStore';
import { isActiveConnectPlaybackStatus, isHqPlayerConnectStatus, playbackStatusFromConnectStatus } from '../../utils/connectPlayback';
import { openArtistDetailByName } from '../../utils/artistNavigation';
import { logLyricsConsole } from '../../diagnostics/lyricsConsole';
import { playerCoverLayoutId } from '../../ui/motion/layoutIds';
import { miniPlayerTransition, springSoft } from '../../ui/motion/presets';
import { PlayerProgress } from './PlayerProgress';
import { AudioSignalPathControl, AudioSignalPathPopover } from './AudioSignalPathPopover';
import { PlayerSpeedControl } from './PlayerSpeedControl';
import { PlayerStatusChips } from './PlayerStatusChips';
import { PlayerTransport } from './PlayerTransport';
import { PlayerVolumeControl } from './PlayerVolumeControl';
import { SleepTimerButton } from './SleepTimerButton';
import { formatAudioHostError, shouldSuppressAudioHostError } from './audioErrorFormat';
import { applyMediaSessionSnapshot } from './mediaSession';
import { titleFromPath } from './playerFormat';

type PlayerBarProps = {
  desktopLyricsLocked?: boolean;
  desktopLyricsVisible?: boolean;
  hasDesktopLyricsBridge?: boolean;
  onOpenAudioSettings?: () => void;
  onOpenQueue?: () => void;
  showQueueButton?: boolean;
  showSignalPathControl?: boolean;
  onToggleDesktopLyrics?: () => void;
  onUnlockDesktopLyrics?: () => void;
};

const lowLoadProgressRenderIntervalMs = 1000;
const minRealtimeProgressStepSeconds = 0.004;
const bpmAnalysisStatusPollMs = 1500;
const playbackSeekedEvent = 'playback:seeked';
const lyricsViewModeMemoryKey = 'echo:lyrics:view-mode';
const maxInterpolatedStatusGapSeconds = 1.6;
const maxStaleStatusRegressionSeconds = 2.5;
const minVisibleStaleRegressionSeconds = 0.02;
const seekAnchorMaxAgeSeconds = 3;
const seekAnchorSettleToleranceSeconds = 0.25;
const playbackRateChangeDiscontinuitySeconds = 0.35;
const endedAutoAdvanceGraceSeconds = 5;
const endedAutoAdvanceRetryDelayMs = 1200;
const endedAutoAdvanceMaxAttempts = 3;
const tailAutoAdvanceToleranceSeconds = 0.35;
const tailAutoAdvanceWatchdogDelayMs = 1500;
const trackSwitchVisualIntentPositionToleranceMs = 1500;
const isStreamingProviderName = (provider: string | null | undefined): provider is StreamingProviderName =>
  streamingProviderNames.includes(provider as StreamingProviderName);
const isReceiverTrackId = (value: string | null | undefined): value is string =>
  Boolean(value?.startsWith('dlna-receiver:') || value?.startsWith('airplay-receiver:'));
const stableStreamingTrackId = (track: LibraryTrack | null | undefined): string | null => {
  if (track?.mediaType !== 'streaming') {
    return null;
  }

  const stableKey = track.stableKey?.trim();
  if (stableKey) {
    return stableKey;
  }

  const provider = track.provider?.trim();
  const providerTrackId = track.providerTrackId?.trim();
  return provider && providerTrackId ? `streaming:${provider}:${providerTrackId}` : null;
};
const trackMatchesPlaybackIdentity = (track: LibraryTrack | null | undefined, identity: string | null | undefined): boolean => {
  const normalizedIdentity = identity?.trim();
  if (!track || !normalizedIdentity) {
    return false;
  }

  return (
    track.id === normalizedIdentity ||
    track.path === normalizedIdentity ||
    track.stableKey?.trim() === normalizedIdentity ||
    stableStreamingTrackId(track) === normalizedIdentity
  );
};
const shouldLetAutomixDriveTailAdvance = (status: AudioStatus | null): boolean => {
  const automix = status?.automix;
  return Boolean(automix?.active && (automix.mode === 'armed' || automix.mode === 'transitioning'));
};
const activeDownloadStatuses = new Set<DownloadJobStatus>([
  'queued',
  'probing',
  'downloading',
  'extracting_audio',
  'importing',
  'binding_mv',
]);
const terminalDownloadStatuses = new Set<DownloadJobStatus>(['completed', 'failed', 'cancelled']);
const unsupportedPlayerDownloadProviders = new Set<StreamingProviderName>(['mock', 'spotify', 'tidal', 'bilibili']);
const unsupportedStreamingBpmAnalysisProviders = new Set<StreamingProviderName>(['spotify', 'tidal', 'soundcloud']);
const downloadStatusLabels: Record<DownloadJobStatus, string> = {
  queued: '排队中',
  probing: '解析链接',
  downloading: '下载中',
  extracting_audio: '提取音频',
  importing: '导入曲库',
  binding_mv: '绑定 MV',
  completed: '下载完成',
  failed: '下载失败',
  cancelled: '已取消',
};
const isVerifiedAudioAnalysisBpm = (track: { bpm?: number | null; bpmConfidence?: number | null; analysisStatus?: string | null; fieldSources?: Record<string, string> } | null): boolean =>
  Boolean(track?.fieldSources?.bpm === 'audio_analysis' && isReliableBpmAnalysis(track.bpm, track.bpmConfidence, track.analysisStatus));
const readAudioAnalysisEnabled = (settings: unknown): boolean => {
  if (!settings || typeof settings !== 'object') {
    return true;
  }

  return (settings as { audioAnalysisEnabled?: unknown }).audioAnalysisEnabled !== false;
};
const readAudioAnalysisEnabledPatch = (patch: unknown): boolean | null => {
  if (!patch || typeof patch !== 'object') {
    return null;
  }

  const value = (patch as { audioAnalysisEnabled?: unknown }).audioAnalysisEnabled;
  return typeof value === 'boolean' ? value : null;
};

const readLowLoadPlaybackModeEnabled = (settings: unknown): boolean => {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  return (settings as { lowLoadPlaybackModeEnabled?: unknown }).lowLoadPlaybackModeEnabled === true;
};

const readStreamingDownloadActionsEnabled = (settings: unknown): boolean => {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  return (settings as { downloadsFeatureUnlocked?: unknown }).downloadsFeatureUnlocked === true;
};

const readLowLoadPlaybackModeEnabledPatch = (patch: unknown): boolean | null => {
  if (!patch || typeof patch !== 'object') {
    return null;
  }

  const value = (patch as { lowLoadPlaybackModeEnabled?: unknown }).lowLoadPlaybackModeEnabled;
  return typeof value === 'boolean' ? value : null;
};

const readPlayerWaveformProgressEnabled = (settings: unknown): boolean => {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  return (settings as { playerWaveformProgressEnabled?: unknown }).playerWaveformProgressEnabled === true;
};

const readPlayerWaveformProgressEnabledPatch = (patch: unknown): boolean | null => {
  if (!patch || typeof patch !== 'object') {
    return null;
  }

  const value = (patch as { playerWaveformProgressEnabled?: unknown }).playerWaveformProgressEnabled;
  return typeof value === 'boolean' ? value : null;
};

const readFixedVolumeEnabled = (settings: unknown): boolean => {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  return (settings as { fixedVolumeEnabled?: unknown }).fixedVolumeEnabled === true;
};

const readFixedVolumeEnabledPatch = (patch: unknown): boolean | null => {
  if (!patch || typeof patch !== 'object') {
    return null;
  }

  const value = (patch as { fixedVolumeEnabled?: unknown }).fixedVolumeEnabled;
  return typeof value === 'boolean' ? value : null;
};

const readDsdAutoVolumeLockEnabled = (settings: unknown): boolean => {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  return (settings as { audioDsdAutoVolumeLockEnabled?: unknown }).audioDsdAutoVolumeLockEnabled === true;
};

const readDsdAutoVolumeLockEnabledPatch = (patch: unknown): boolean | null => {
  if (!patch || typeof patch !== 'object') {
    return null;
  }

  const value = (patch as { audioDsdAutoVolumeLockEnabled?: unknown }).audioDsdAutoVolumeLockEnabled;
  return typeof value === 'boolean' ? value : null;
};

const audioExportFormatSet = new Set<AudioExportFormat>(audioExportFormats);
const audioExportFormatLabels: Record<AudioExportFormat, string> = {
  mp3: 'MP3',
  wav: 'WAV',
  flac: 'FLAC',
  ogg: 'OGG',
};

const normalizeAudioExportFormat = (value: unknown): AudioExportFormat =>
  audioExportFormatSet.has(value as AudioExportFormat) ? (value as AudioExportFormat) : 'mp3';

const readAudioExportFormat = (settings: unknown): AudioExportFormat => {
  if (!settings || typeof settings !== 'object') {
    return 'mp3';
  }

  return normalizeAudioExportFormat((settings as { audioExportFormat?: unknown }).audioExportFormat);
};

const readAudioExportFormatPatch = (patch: unknown): AudioExportFormat | null => {
  if (!patch || typeof patch !== 'object' || !Object.prototype.hasOwnProperty.call(patch, 'audioExportFormat')) {
    return null;
  }

  return normalizeAudioExportFormat((patch as { audioExportFormat?: unknown }).audioExportFormat);
};

const formatPlaybackRate = (value: unknown): string => {
  const numeric = Number(value);
  const safeRate = Number.isFinite(numeric) ? Math.max(0.5, Math.min(2, numeric)) : 1;
  return `${safeRate.toFixed(2)}x`;
};

const clampPlayerVolume = (value: unknown, fallback = 1): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
};

const isDsdVolumeLockStatus = (status: AudioStatus | null): boolean => {
  if (!status || ['idle', 'stopped', 'ended', 'error'].includes(status.state)) {
    return false;
  }

  if (status.activeDsdOutputMode) {
    return true;
  }

  if (/(?:dsd|dsf|dff)/i.test(status.codec ?? '')) {
    return true;
  }

  return /\.(?:dsf|dff)$/i.test(status.currentFilePath ?? '');
};

type PlayerDownloadNotice = {
  tone: 'info' | 'success' | 'error';
  title: string;
  detail: string;
  progress: number | null;
};

type ReceiverPlaybackStatus = {
  state: ConnectReceiverStatus['state'] | AirPlayReceiverStatus['state'];
  metadata: ConnectMetadata | null;
  positionSeconds: number;
  durationSeconds: number;
};

type PlaybackVisualIntentSnapshot = {
  currentTrackId: string | null;
  filePath: string | null;
  expectedPositionMs: number;
  startedAtMs: number;
};

const audioStatusMatchesVisualIntent = (status: AudioStatus | null | undefined, intent: PlaybackVisualIntentSnapshot | null | undefined): boolean => {
  if (!status) {
    return false;
  }

  if (!intent) {
    return true;
  }

  const matchesIntent =
    Boolean(intent.currentTrackId && status.currentTrackId === intent.currentTrackId) ||
    Boolean(intent.filePath && status.currentFilePath === intent.filePath);
  if (!matchesIntent) {
    return false;
  }

  const playbackRate = Number.isFinite(status.playbackRate) ? Math.max(0.25, Math.min(4, status.playbackRate)) : 1;
  const elapsedMs = status.state === 'playing' || status.state === 'paused' ? Math.max(0, Date.now() - intent.startedAtMs) : 0;
  const expectedPositionMs = intent.expectedPositionMs + elapsedMs * playbackRate;
  return Math.round(Math.max(0, status.positionSeconds) * 1000) <= expectedPositionMs + trackSwitchVisualIntentPositionToleranceMs;
};

const streamingTrackWebUrl = (provider: StreamingProviderName, providerTrackId: string): string | null => {
  switch (provider) {
    case 'netease':
      return `https://music.163.com/#/song?id=${encodeURIComponent(providerTrackId)}`;
    case 'qqmusic':
      return `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(providerTrackId)}`;
    case 'kugou':
      return `https://www.kugou.com/song/#hash=${encodeURIComponent(providerTrackId.split('.')[0] ?? providerTrackId)}`;
    case 'spotify':
      return `https://open.spotify.com/track/${encodeURIComponent(providerTrackId)}`;
    case 'tidal':
      return `https://tidal.com/track/${encodeURIComponent(providerTrackId)}`;
    case 'soundcloud':
      return providerTrackId.startsWith('http')
        ? providerTrackId
        : `https://soundcloud.com/search/sounds?q=${encodeURIComponent(providerTrackId)}`;
    case 'bilibili':
      return `https://www.bilibili.com/video/${encodeURIComponent(providerTrackId)}`;
    default:
      return null;
  }
};

const isHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value);

const shouldUseDirectAudioDownload = (source: {
  provider: StreamingProviderName;
  url: string;
  mimeType: string | null;
  codec: string | null;
}): boolean =>
  source.provider !== 'm3u8' &&
  isHttpUrl(source.url) &&
  (source.mimeType?.toLocaleLowerCase().startsWith('audio/') === true || Boolean(source.codec));

const clampDownloadProgress = (progress: number): number => Math.max(0, Math.min(100, Math.round(progress)));

const downloadNoticeFromJob = (job: DownloadJob, fallbackTitle: string | null): PlayerDownloadNotice => {
  const trackTitle = job.title ?? fallbackTitle ?? '当前流媒体';
  const progress = clampDownloadProgress(job.progress);

  if (job.status === 'completed') {
    return {
      tone: 'success',
      title: `下载完成：${trackTitle}`,
      detail: job.outputPath ?? '已保存到下载文件夹',
      progress: 100,
    };
  }

  if (job.status === 'failed') {
    return {
      tone: 'error',
      title: `下载失败：${trackTitle}`,
      detail: job.error ?? '请稍后重试',
      progress: null,
    };
  }

  if (job.status === 'cancelled') {
    return {
      tone: 'error',
      title: `下载已取消：${trackTitle}`,
      detail: '任务已停止',
      progress: null,
    };
  }

  return {
    tone: 'info',
    title: `正在下载：${trackTitle}`,
    detail: `${downloadStatusLabels[job.status]} · ${progress}%`,
    progress,
  };
};

const deferNonCriticalPlaybackTask = (callback: () => void): (() => void) => {
  let cancelled = false;
  let idleId: number | null = null;
  let timeoutId: number | null = null;
  const requestIdleCallback = window.requestIdleCallback;
  const cancelIdleCallback = window.cancelIdleCallback;

  const frameId = window.requestAnimationFrame(() => {
    if (cancelled) {
      return;
    }

    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(() => {
        if (!cancelled) {
          callback();
        }
      }, { timeout: 800 });
      return;
    }

    timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        callback();
      }
    }, 80);
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frameId);
    if (idleId !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleId);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
};

const originalCoverUrlFromThumb = (coverUrl: string | null): string | null =>
  coverUrl?.replace(/^echo-cover:\/\/(?:thumb|album|large)\//u, 'echo-cover://original/') ?? null;

const playerArtworkUrl = (track: { coverId: string | null; coverThumb: string | null } | null): string | null =>
  track?.coverId ? `echo-cover://original/${encodeURIComponent(track.coverId)}` : originalCoverUrlFromThumb(track?.coverThumb ?? null);

const isAudioStatusForPlayback = (audioStatus: AudioStatus, playbackStatus: PlaybackStatus | null): boolean => {
  if (!playbackStatus?.currentTrackId && !playbackStatus?.filePath) {
    return true;
  }

  return (
    Boolean(playbackStatus.currentTrackId && audioStatus.currentTrackId === playbackStatus.currentTrackId) ||
    Boolean(playbackStatus.filePath && audioStatus.currentFilePath === playbackStatus.filePath)
  );
};

const isSpotifyPlaybackStatus = (status: PlaybackStatus | null | undefined): boolean =>
  typeof status?.filePath === 'string' && status.filePath.startsWith('streaming:spotify:');

const receiverStateToPlaybackState = (status: ReceiverPlaybackStatus): AudioStatus['state'] => {
  switch (status.state) {
    case 'loading':
    case 'playing':
    case 'paused':
    case 'stopped':
    case 'error':
      return status.state;
    case 'ready':
      return 'stopped';
    default:
      return 'idle';
  }
};

const isProviderLikedStreamingProvider = (provider: string | null | undefined): provider is Extract<StreamingProviderName, 'netease' | 'qqmusic'> =>
  provider === 'netease' || provider === 'qqmusic';

const dispatchPlaybackSeeked = (positionSeconds: number, trackId: string | null): void => {
  window.dispatchEvent(new CustomEvent(playbackSeekedEvent, { detail: { positionSeconds, trackId } }));
};

const getActiveConnectPlaybackStatus = async (): Promise<ConnectSessionStatus | null> => {
  const status = await window.echo?.connect?.getStatus?.().catch(() => null);
  return isActiveConnectPlaybackStatus(status) ? status : null;
};

const rememberLyricsViewMode = (mode: 'lyrics' | 'mv'): void => {
  try {
    window.sessionStorage.setItem(lyricsViewModeMemoryKey, mode);
  } catch {
    // Best-effort navigation preference only.
  }
};

const PlayerMarqueeText = ({
  kind,
  text,
  onClick,
}: {
  kind: 'title' | 'subtitle';
  text: string;
  onClick?: () => void;
}): JSX.Element => {
  const textRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    const innerElement = innerRef.current;
    if (!element || !innerElement) {
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
        const shouldScroll = distance > 2;
        element.style.setProperty('--player-marquee-distance', `${distance + 18}px`);
        element.style.setProperty('--player-marquee-duration', `${Math.min(22, Math.max(8, distance / 18 + 6))}s`);
        setIsOverflowing(shouldScroll);
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
  }, [text]);

  const content = <span className="player-marquee-inner" ref={innerRef}>{text}</span>;
  const commonProps = {
    className: 'player-marquee',
    'data-overflow': isOverflowing ? 'true' : undefined,
    'data-clickable': onClick ? 'true' : undefined,
    ref: textRef,
    title: text,
  };

  const handleClick = (): void => {
    if (!onClick || window.getSelection()?.toString()) {
      return;
    }

    onClick();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (!onClick || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }

    event.preventDefault();
    onClick();
  };

  return kind === 'title' ? (
    <strong {...commonProps}>{content}</strong>
  ) : (
    <span
      {...commonProps}
      aria-label={onClick ? `打开艺人详情：${text}` : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {content}
    </span>
  );
};

export const PlayerBar = ({
  desktopLyricsLocked = false,
  desktopLyricsVisible = false,
  hasDesktopLyricsBridge = false,
  onOpenAudioSettings,
  onOpenQueue,
  showQueueButton = false,
  showSignalPathControl = false,
  onToggleDesktopLyrics,
  onUnlockDesktopLyrics,
}: PlayerBarProps): JSX.Element => {
  const queue = usePlaybackQueue();
  const sharedPlaybackStatus = useSharedPlaybackStatus();
  const setQueueCurrentTrackId = queue.setCurrentTrackId;
  const appendToQueue = queue.appendToQueue;
  const updateTrackSnapshot = queue.updateTrackSnapshot;
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus | null>(null);
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null);
  const [connectStatus, setConnectStatus] = useState<ConnectSessionStatus | null>(null);
  const [hqPlayerOutputRate, setHqPlayerOutputRate] = useState<number | null>(null);
  const [receiverStatus, setReceiverStatus] = useState<ConnectReceiverStatus | null>(null);
  const [airPlayReceiverStatus, setAirPlayReceiverStatus] = useState<AirPlayReceiverStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seekPreviewSeconds, setSeekPreviewSeconds] = useState<number | null>(null);
  const [openPopover, setOpenPopover] = useState<'signal' | 'volume' | 'speed' | null>(null);
  const [isCurrentTrackLiked, setIsCurrentTrackLiked] = useState(false);
  const [smtcEnabled, setSmtcEnabled] = useState(true);
  const [audioAnalysisEnabled, setAudioAnalysisEnabled] = useState<boolean | null>(null);
  const [lowLoadPlaybackModeEnabled, setLowLoadPlaybackModeEnabled] = useState(false);
  const [streamingDownloadActionsEnabled, setStreamingDownloadActionsEnabled] = useState(false);
  const [playerWaveformProgressEnabled, setPlayerWaveformProgressEnabled] = useState(false);
  const [fixedVolumeEnabled, setFixedVolumeEnabled] = useState(false);
  const [dsdAutoVolumeLockEnabled, setDsdAutoVolumeLockEnabled] = useState(false);
  const [dsdAutoVolumeLocked, setDsdAutoVolumeLocked] = useState(false);
  const [audioExportFormat, setAudioExportFormat] = useState<AudioExportFormat>('mp3');
  const [isAudioExporting, setIsAudioExporting] = useState(false);
  const [miniPlayerState, setMiniPlayerState] = useState<MiniPlayerState | null>(null);
  const [isMiniPlayerBusy, setIsMiniPlayerBusy] = useState(false);
  const [streamingDownloadJobId, setStreamingDownloadJobId] = useState<string | null>(null);
  const [streamingDownloadNotice, setStreamingDownloadNotice] = useState<PlayerDownloadNotice | null>(null);
  const [isStreamingDownloadResolving, setIsStreamingDownloadResolving] = useState(false);
  const signalPathAnchorRef = useRef<HTMLDivElement | null>(null);
  const handledEndedTrackRef = useRef<string | null>(null);
  const pendingEndedTrackRef = useRef<string | null>(null);
  const hydratedTrackIdsRef = useRef(new Set<string>());
  const bpmAnalysisJobIdsRef = useRef(new Map<string, string | 'done'>());
  const streamingBpmAnalysisTrackIdsRef = useRef(new Set<string>());
  const streamingDownloadTitleRef = useRef<string | null>(null);
  const streamingDownloadNoticeTimerRef = useRef<number | null>(null);
  const mvPreloadTrackRef = useRef<string | null>(null);
  const seekAnchorRef = useRef<{ positionSeconds: number; trackKey: string | null; updatedAtMs: number } | null>(null);
  const activeTrackIdRef = useRef<string | null>(null);
  const lastPlaybackActionStatusRef = useRef<{ state: PlaybackStatus['state']; trackId: string | null; filePath: string | null; updatedAtMs: number } | null>(null);
  const progressClockRef = useRef({
    durationSeconds: 0,
    playbackRate: 1,
    positionSeconds: 0,
    sourcePositionSeconds: 0,
    state: 'idle',
    trackKey: null as string | null,
    updatedAtMs: performance.now(),
  });
  const dsdAutoVolumeLockRestoreRef = useRef<number | null>(null);
  const dsdAutoVolumeLockRequestRef = useRef(0);

  const shouldIgnoreAudioStatus = useCallback((nextAudioStatus: AudioStatus): boolean => {
    const lastAction = lastPlaybackActionStatusRef.current;
    if (!lastAction) {
      return false;
    }

    const elapsedMs = performance.now() - lastAction.updatedAtMs;
    const samePlayback =
      Boolean(lastAction.trackId && nextAudioStatus.currentTrackId === lastAction.trackId) ||
      Boolean(lastAction.filePath && nextAudioStatus.currentFilePath === lastAction.filePath);

    if (elapsedMs < 1200 && !samePlayback && (nextAudioStatus.currentTrackId || nextAudioStatus.currentFilePath)) {
      return true;
    }

    if (elapsedMs < 1200 && samePlayback && nextAudioStatus.state !== lastAction.state) {
      return true;
    }

    if (nextAudioStatus.state === lastAction.state || elapsedMs >= 1200) {
      lastPlaybackActionStatusRef.current = null;
    }

    return false;
  }, []);

  const resolveQueueTrackIdForPlaybackIdentity = useCallback(
    (identity: string | null | undefined): string | null => {
      const normalizedIdentity = identity?.trim();
      if (!normalizedIdentity) {
        return null;
      }

      return queue.tracks.find((track) => trackMatchesPlaybackIdentity(track, normalizedIdentity))?.id ?? normalizedIdentity;
    },
    [queue.tracks],
  );

  const shouldAdoptPlaybackIdentity = useCallback(
    (identity: string | null | undefined): boolean => {
      const normalizedIdentity = identity?.trim();
      if (!normalizedIdentity) {
        return false;
      }

      const currentQueueTrackId = queue.currentTrackId;
      if (!currentQueueTrackId) {
        return true;
      }

      const currentQueueTrack = queue.tracks.find((track) => track.id === currentQueueTrackId);
      return currentQueueTrack ? trackMatchesPlaybackIdentity(currentQueueTrack, normalizedIdentity) : true;
    },
    [queue.currentTrackId, queue.tracks],
  );

  const applyAudioStatus = useCallback(
    (nextAudioStatus: AudioStatus): boolean => {
      if (shouldIgnoreAudioStatus(nextAudioStatus)) {
        return false;
      }

      setAudioStatus(nextAudioStatus);
      if (nextAudioStatus.currentTrackId && shouldAdoptPlaybackIdentity(nextAudioStatus.currentTrackId)) {
        setQueueCurrentTrackId(resolveQueueTrackIdForPlaybackIdentity(nextAudioStatus.currentTrackId));
      }
      setPlaybackStatus((current) =>
        current
          ? {
              ...current,
              state: nextAudioStatus.state,
              currentTrackId: nextAudioStatus.currentTrackId,
              filePath: nextAudioStatus.currentFilePath,
              positionMs: Math.round(nextAudioStatus.positionSeconds * 1000),
              durationMs: Math.round(nextAudioStatus.durationSeconds * 1000),
            }
          : current,
      );
      setError(formatAudioHostError(nextAudioStatus.error));
      return true;
    },
    [resolveQueueTrackIdForPlaybackIdentity, setQueueCurrentTrackId, shouldAdoptPlaybackIdentity, shouldIgnoreAudioStatus],
  );

  const applySharedPlaybackStatus = useCallback(
    (snapshot: {
      playbackStatus: PlaybackStatus | null;
      audioStatus: AudioStatus | null;
      playbackVisualIntent: PlaybackVisualIntentSnapshot | null;
      error: string | null;
    }): void => {
      if (snapshot.playbackStatus) {
        setPlaybackStatus(snapshot.playbackStatus);
      }

      const snapshotAudioStatus = snapshot.audioStatus;
      if (isSpotifyPlaybackStatus(snapshot.playbackStatus) && !snapshotAudioStatus) {
        setAudioStatus(null);
      }
      const shouldApplyAudioStatus = snapshotAudioStatus
        ? audioStatusMatchesVisualIntent(snapshotAudioStatus, snapshot.playbackVisualIntent) &&
          (isAudioStatusForPlayback(snapshotAudioStatus, snapshot.playbackStatus) ||
            Boolean(snapshotAudioStatus.currentTrackId || snapshotAudioStatus.currentFilePath))
        : false;
      let appliedAudioStatus = false;
      if (snapshotAudioStatus && shouldApplyAudioStatus) {
        appliedAudioStatus = applyAudioStatus(snapshotAudioStatus);
      } else if (snapshotAudioStatus || snapshot.playbackStatus || snapshot.error) {
        setAudioStatus(null);
      }

      const nextTrackId =
        (snapshotAudioStatus && appliedAudioStatus ? snapshotAudioStatus.currentTrackId : null) ??
        snapshot.playbackStatus?.currentTrackId ??
        null;
      if (nextTrackId && shouldAdoptPlaybackIdentity(nextTrackId)) {
        setQueueCurrentTrackId(resolveQueueTrackIdForPlaybackIdentity(nextTrackId));
      }

      setError(formatAudioHostError(snapshot.error));
    },
    [applyAudioStatus, resolveQueueTrackIdForPlaybackIdentity, setQueueCurrentTrackId, shouldAdoptPlaybackIdentity],
  );

  const refreshStatus = useCallback(async (): Promise<void> => {
    applySharedPlaybackStatus(await refreshPlaybackStatus());
  }, [applySharedPlaybackStatus]);

  const audioStatusMatchesPlaybackStatus = audioStatus ? isAudioStatusForPlayback(audioStatus, playbackStatus) : false;
  const statusTrackId = playbackStatus?.currentTrackId ?? (audioStatusMatchesPlaybackStatus ? audioStatus?.currentTrackId ?? null : null);
  const trackId = queue.currentTrackId ?? statusTrackId;
  const currentTrack = queue.currentTrack ?? queue.tracks.find((track) => trackMatchesPlaybackIdentity(track, trackId)) ?? null;
  const playbackStatusMatchesCurrentTrack =
    playbackStatus !== null &&
    (!currentTrack ||
      trackMatchesPlaybackIdentity(currentTrack, playbackStatus.currentTrackId) ||
      trackMatchesPlaybackIdentity(currentTrack, playbackStatus.filePath));
  const currentPlaybackStatus = playbackStatusMatchesCurrentTrack ? playbackStatus : null;
  const audioStatusMatchesCurrentTrack =
    audioStatus != null &&
    audioStatusMatchesVisualIntent(audioStatus, sharedPlaybackStatus.playbackVisualIntent) &&
    (currentTrack
      ? trackMatchesPlaybackIdentity(currentTrack, audioStatus.currentTrackId) ||
        trackMatchesPlaybackIdentity(currentTrack, audioStatus.currentFilePath)
      : audioStatusMatchesPlaybackStatus);
  const playbackAudioStatus = audioStatusMatchesCurrentTrack ? audioStatus : null;
  const baseState = playbackAudioStatus?.state ?? currentPlaybackStatus?.state ?? 'idle';
  const baseVisualState = getVisualPlaybackState({
    audioStatus: playbackAudioStatus,
    playbackStatus: currentPlaybackStatus,
    playbackVisualIntent: sharedPlaybackStatus.playbackVisualIntent,
  });
  const filePath = currentTrack?.path ?? playbackAudioStatus?.currentFilePath ?? currentPlaybackStatus?.filePath ?? null;
  const receiverCurrentUri = receiverStatus?.currentUri ?? null;
  const receiverHasCurrentMedia = Boolean(
    receiverCurrentUri && receiverStatus && ['ready', 'loading', 'playing', 'paused', 'stopped'].includes(receiverStatus.state),
  );
  const isReceiverPlaybackActive = Boolean(
    receiverHasCurrentMedia &&
      (playbackAudioStatus?.currentFilePath === receiverCurrentUri ||
        currentPlaybackStatus?.filePath === receiverCurrentUri ||
        !currentTrack),
  );
  const airPlayReceiverCurrentSourceId = airPlayReceiverStatus?.currentSourceId ?? null;
  const airPlayReceiverHasCurrentMedia = Boolean(
    airPlayReceiverCurrentSourceId && airPlayReceiverStatus && ['ready', 'playing', 'paused', 'stopped'].includes(airPlayReceiverStatus.state),
  );
  const isAirPlayReceiverPlaybackActive = Boolean(
    airPlayReceiverHasCurrentMedia &&
      (playbackAudioStatus?.currentFilePath === airPlayReceiverCurrentSourceId ||
        playbackAudioStatus?.currentTrackId === airPlayReceiverCurrentSourceId ||
        currentPlaybackStatus?.filePath === airPlayReceiverCurrentSourceId ||
        currentPlaybackStatus?.currentTrackId === airPlayReceiverCurrentSourceId ||
        currentTrack?.id === airPlayReceiverCurrentSourceId ||
        currentTrack?.path === airPlayReceiverCurrentSourceId ||
        !currentTrack),
  );
  const activeReceiverStatus: ReceiverPlaybackStatus | null = isAirPlayReceiverPlaybackActive
    ? airPlayReceiverStatus
    : isReceiverPlaybackActive
      ? receiverStatus
      : null;
  const receiverPlaybackState = activeReceiverStatus ? receiverStateToPlaybackState(activeReceiverStatus) : 'idle';
  const state = activeReceiverStatus ? receiverPlaybackState : baseState;
  const visualState = activeReceiverStatus ? receiverPlaybackState : baseVisualState;
  const isNativePausedVisualState =
    !activeReceiverStatus &&
    visualState === 'paused' &&
    (playbackAudioStatus?.state === 'paused' || currentPlaybackStatus?.state === 'paused');
  const isPlaying = visualState === 'playing' || visualState === 'loading';
  const isRemotePlaybackLoading =
    currentTrack?.mediaType === 'remote' &&
    !isReceiverTrackId(currentTrack.id) &&
    !isReceiverTrackId(trackId) &&
    state === 'loading';
  const isStreamingPlaybackLoading = currentTrack?.mediaType === 'streaming' && state === 'loading';
  const isNetworkPlaybackLoading = isRemotePlaybackLoading || isStreamingPlaybackLoading;
  const networkPlaybackLoadingLabel = isStreamingPlaybackLoading ? '正在加载流媒体' : '正在加载网盘音频';
  const endedStatusTrackId =
    playbackAudioStatus?.state === 'ended'
      ? playbackAudioStatus.currentTrackId
      : currentPlaybackStatus?.state === 'ended'
        ? currentPlaybackStatus.currentTrackId
        : null;
  const endedStatusFilePath =
    playbackAudioStatus?.state === 'ended'
      ? playbackAudioStatus.currentFilePath
      : currentPlaybackStatus?.state === 'ended'
        ? currentPlaybackStatus.filePath
        : null;
  const endedStatusPositionSeconds =
    playbackAudioStatus?.state === 'ended'
      ? playbackAudioStatus.positionSeconds
      : currentPlaybackStatus?.state === 'ended'
        ? currentPlaybackStatus.positionMs / 1000
        : null;
  const endedStatusDurationSeconds =
    playbackAudioStatus?.state === 'ended'
      ? playbackAudioStatus.durationSeconds
      : currentPlaybackStatus?.state === 'ended'
        ? currentPlaybackStatus.durationMs / 1000
        : null;
  const sourcePositionSeconds = activeReceiverStatus
    ? activeReceiverStatus.positionSeconds ?? playbackAudioStatus?.positionSeconds ?? (currentPlaybackStatus?.positionMs ?? 0) / 1000
    : playbackAudioStatus?.positionSeconds ?? (currentPlaybackStatus?.positionMs ?? 0) / 1000;
  const currentTrackDurationMs = Math.round(Math.max(0, currentTrack?.duration ?? 0) * 1000);
  const durationSeconds = activeReceiverStatus
    ? Math.max(activeReceiverStatus.durationSeconds ?? 0, playbackAudioStatus?.durationSeconds ?? 0, (currentPlaybackStatus?.durationMs ?? 0) / 1000)
    : playbackAudioStatus?.durationSeconds ?? (currentPlaybackStatus?.durationMs ?? currentTrackDurationMs) / 1000;
  const [realtimePositionSeconds, setRealtimePositionSeconds] = useState(sourcePositionSeconds);
  const playbackProgressKey = trackId ?? filePath ?? null;
  const realtimePositionMatchesPlayback = progressClockRef.current.trackKey === playbackProgressKey;
  const positionSeconds = seekPreviewSeconds ?? (realtimePositionMatchesPlayback ? realtimePositionSeconds : sourcePositionSeconds);
  const receiverMetadata = activeReceiverStatus ? activeReceiverStatus.metadata ?? null : null;
  const title = receiverMetadata?.title ?? currentTrack?.title ?? playbackAudioStatus?.currentTrackTitle ?? titleFromPath(filePath);
  const artist =
    receiverMetadata?.artist ??
    currentTrack?.artist ??
    currentTrack?.albumArtist ??
    playbackAudioStatus?.currentTrackArtist ??
    playbackAudioStatus?.currentTrackAlbumArtist ??
    (filePath ? (isAirPlayReceiverPlaybackActive ? 'AirPlay stream' : 'DLNA stream') : 'Ready');
  const artworkUrl = receiverMetadata?.coverHttpUrl || playerArtworkUrl(currentTrack) || playbackAudioStatus?.currentTrackCoverUrl || null;
  const isLibraryCurrentTrack = Boolean(currentTrack && !currentTrack.isTemporary && currentTrack.mediaType !== 'streaming');
  const streamingTrackId = currentTrack?.id ?? null;
  const streamingTrackMediaType = currentTrack?.mediaType ?? null;
  const streamingTrackProvider = currentTrack?.provider ?? null;
  const streamingTrackProviderTrackId = currentTrack?.providerTrackId ?? null;
  const currentStreamingDownloadProvider =
    streamingTrackMediaType === 'streaming' && isStreamingProviderName(streamingTrackProvider) ? streamingTrackProvider : null;
  const isCurrentStreamingTrack = Boolean(currentStreamingDownloadProvider && streamingTrackProviderTrackId);
  const canDownloadCurrentStreamingTrack = Boolean(
    streamingDownloadActionsEnabled &&
      currentStreamingDownloadProvider &&
      streamingTrackProviderTrackId &&
      !unsupportedPlayerDownloadProviders.has(currentStreamingDownloadProvider),
  );
  const isCurrentStreamingDownloadBusy = isStreamingDownloadResolving || Boolean(streamingDownloadJobId);
  const isProviderLikedStreamingTrack =
    streamingTrackMediaType === 'streaming' &&
    isProviderLikedStreamingProvider(streamingTrackProvider) &&
    Boolean(streamingTrackProviderTrackId);
  const streamingTrackQuality = currentTrack?.streamingQuality;
  const streamingTrackBpm = currentTrack?.bpm ?? null;
  const streamingTrackBpmConfidence = currentTrack?.bpmConfidence ?? null;
  const streamingTrackAnalysisStatus = currentTrack?.analysisStatus ?? null;
  const isSpotifyCurrentTrack = isSpotifyTrack(currentTrack);
  const shouldAutoLockDsdVolume =
    dsdAutoVolumeLockEnabled &&
    !fixedVolumeEnabled &&
    !isSpotifyCurrentTrack &&
    isDsdVolumeLockStatus(playbackAudioStatus);
  const currentLibraryArtistName = currentTrack?.artist?.trim() || currentTrack?.albumArtist?.trim() || '';
  const canOpenCurrentArtist = Boolean(currentLibraryArtistName);
  const currentExportPlaybackRate = playbackAudioStatus?.playbackRate ?? audioStatus?.playbackRate ?? 1;
  const audioExportFormatLabel = audioExportFormatLabels[audioExportFormat];
  const canExportCurrentAudio = Boolean(
    filePath &&
      !isCurrentStreamingTrack &&
      !isSpotifyCurrentTrack &&
      !isReceiverPlaybackActive &&
      !isAirPlayReceiverPlaybackActive,
  );
  const audioExportButtonTitle = !filePath
    ? '没有可导出的本地文件'
    : !canExportCurrentAudio
      ? '当前来源不支持文件导出'
      : isAudioExporting
        ? '正在导出当前文件'
        : `导出当前文件为 ${audioExportFormatLabel}（${formatPlaybackRate(currentExportPlaybackRate)}）`;
  const handleOpenCurrentArtist = useCallback((): void => {
    if (!currentLibraryArtistName) {
      return;
    }

    void openArtistDetailByName(currentLibraryArtistName).catch((error) => {
      console.warn('Failed to open artist detail from player bar', error);
    });
  }, [currentLibraryArtistName]);

  useEffect(() => {
    const audio = window.echo?.audio;
    if (!audio) {
      return;
    }

    const applyVolume = async (volume: number): Promise<void> => {
      const requestId = ++dsdAutoVolumeLockRequestRef.current;
      const nextStatus = await audio.setOutput({ volume });
      if (dsdAutoVolumeLockRequestRef.current === requestId) {
        setAudioStatus(nextStatus);
      }
    };

    if (shouldAutoLockDsdVolume) {
      if (dsdAutoVolumeLocked) {
        return;
      }

      const restoreVolume = clampPlayerVolume(playbackAudioStatus?.volume ?? audioStatus?.volume, 1);
      dsdAutoVolumeLockRestoreRef.current = restoreVolume < 0.999 ? restoreVolume : null;
      setDsdAutoVolumeLocked(true);
      void applyVolume(1).catch((volumeError) => {
        setDsdAutoVolumeLocked(false);
        dsdAutoVolumeLockRestoreRef.current = null;
        setError(volumeError instanceof Error ? volumeError.message : String(volumeError));
      });
      return;
    }

    if (!dsdAutoVolumeLocked) {
      return;
    }

    const restoreVolume = dsdAutoVolumeLockRestoreRef.current;
    dsdAutoVolumeLockRestoreRef.current = null;
    setDsdAutoVolumeLocked(false);

    if (fixedVolumeEnabled || restoreVolume === null) {
      return;
    }

    void applyVolume(restoreVolume).catch((volumeError) => {
      setError(volumeError instanceof Error ? volumeError.message : String(volumeError));
    });
  }, [
    audioStatus?.volume,
    dsdAutoVolumeLocked,
    fixedVolumeEnabled,
    playbackAudioStatus?.volume,
    shouldAutoLockDsdVolume,
  ]);

  const clearStreamingDownloadNoticeTimer = useCallback((): void => {
    if (streamingDownloadNoticeTimerRef.current !== null) {
      window.clearTimeout(streamingDownloadNoticeTimerRef.current);
      streamingDownloadNoticeTimerRef.current = null;
    }
  }, []);

  const showStreamingDownloadNotice = useCallback(
    (notice: PlayerDownloadNotice, autoHideMs?: number): void => {
      clearStreamingDownloadNoticeTimer();
      setStreamingDownloadNotice(notice);

      if (autoHideMs) {
        streamingDownloadNoticeTimerRef.current = window.setTimeout(() => {
          setStreamingDownloadNotice(null);
          streamingDownloadNoticeTimerRef.current = null;
        }, autoHideMs);
      }
    },
    [clearStreamingDownloadNoticeTimer],
  );

  useEffect(() => () => clearStreamingDownloadNoticeTimer(), [clearStreamingDownloadNoticeTimer]);

  useEffect(() => {
    const downloads = window.echo?.downloads;
    if (!downloads?.onJobsUpdated || !streamingDownloadJobId) {
      return undefined;
    }

    const applyJobsSnapshot = (jobs: DownloadJob[]): void => {
      const job = jobs.find((item) => item.id === streamingDownloadJobId);
      if (!job) {
        return;
      }

      const notice = downloadNoticeFromJob(job, streamingDownloadTitleRef.current);
      const isTerminal = terminalDownloadStatuses.has(job.status);
      const isActive = activeDownloadStatuses.has(job.status);
      showStreamingDownloadNotice(notice, isTerminal ? (job.status === 'completed' ? 4500 : 7000) : undefined);
      if (!isActive && isTerminal) {
        setStreamingDownloadJobId(null);
      }
    };

    void downloads.getJobs?.().then(applyJobsSnapshot).catch(() => undefined);
    return downloads.onJobsUpdated(applyJobsSnapshot);
  }, [showStreamingDownloadNotice, streamingDownloadJobId]);

  const handleDownloadCurrentStreamingTrack = useCallback(async (): Promise<void> => {
    if (!currentTrack || !currentStreamingDownloadProvider || !streamingTrackProviderTrackId) {
      return;
    }

    if (unsupportedPlayerDownloadProviders.has(currentStreamingDownloadProvider)) {
      const detail =
        currentStreamingDownloadProvider === 'spotify'
          ? 'Spotify 由官方播放器播放，不提供可下载音频 URL。'
          : 'Mock 流媒体用于开发预览，不写入下载任务。';
      showStreamingDownloadNotice(
        {
          tone: 'error',
          title: '当前平台不支持下载',
          detail,
          progress: null,
        },
        6500,
      );
      return;
    }

    const downloads = window.echo?.downloads;
    const streaming = window.echo?.streaming;
    if (!downloads?.createUrlJob || !streaming?.resolvePlayback) {
      showStreamingDownloadNotice(
        {
          tone: 'error',
          title: '下载服务不可用',
          detail: '请在 ECHO Next 桌面端中使用下载功能。',
          progress: null,
        },
        6500,
      );
      return;
    }

    const trackTitle = currentTrack.title || '当前流媒体';
    streamingDownloadTitleRef.current = trackTitle;
    setIsStreamingDownloadResolving(true);
    showStreamingDownloadNotice({
      tone: 'info',
      title: `准备下载：${trackTitle}`,
      detail: '正在解析流媒体地址...',
      progress: 0,
    });

    try {
      const source = await streaming.resolvePlayback({
        provider: currentStreamingDownloadProvider,
        providerTrackId: streamingTrackProviderTrackId,
        quality: currentTrack.streamingQuality,
      });
      const directAudio = shouldUseDirectAudioDownload(source);
      const webpageUrl =
        streamingTrackWebUrl(currentStreamingDownloadProvider, streamingTrackProviderTrackId) ??
        (currentStreamingDownloadProvider === 'm3u8' ? source.url : undefined);
      const job = await downloads.createUrlJob(source.url, {
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album,
        albumArtist: currentTrack.albumArtist || currentTrack.artist,
        coverUrl: currentTrack.coverThumb,
        webpageUrl,
        bindMvAfterImport: false,
        requestHeaders: source.headers,
        directAudio,
        directAudioMimeType: source.mimeType,
        directAudioExtension: source.codec,
        streamingProvider: currentStreamingDownloadProvider,
        streamingProviderTrackId: streamingTrackProviderTrackId,
        streamingStableKey: currentTrack.stableKey ?? currentTrack.id,
        downloadAuthorizationToken: source.downloadAuthorizationToken,
      });
      setStreamingDownloadJobId(job.id);
      showStreamingDownloadNotice(downloadNoticeFromJob(job, trackTitle));
    } catch (downloadError) {
      setStreamingDownloadJobId(null);
      showStreamingDownloadNotice(
        {
          tone: 'error',
          title: `下载失败：${trackTitle}`,
          detail: downloadError instanceof Error ? downloadError.message : String(downloadError),
          progress: null,
        },
        7000,
      );
    } finally {
      setIsStreamingDownloadResolving(false);
    }
  }, [currentStreamingDownloadProvider, currentTrack, showStreamingDownloadNotice, streamingTrackProviderTrackId]);

  const handleExportCurrentAudio = useCallback(async (): Promise<void> => {
    const sourcePath = filePath;
    const audio = window.echo?.audio;
    const exportTitle = currentTrack?.title?.trim() || playbackAudioStatus?.currentTrackTitle?.trim() || titleFromPath(sourcePath);
    const exportArtist = currentTrack?.artist?.trim() || playbackAudioStatus?.currentTrackArtist?.trim() || null;

    if (!sourcePath || !canExportCurrentAudio) {
      showStreamingDownloadNotice(
        {
          tone: 'error',
          title: '无法导出当前文件',
          detail: sourcePath ? '当前来源不是本地音频文件。' : '还没有正在播放的本地音频文件。',
          progress: null,
        },
        5500,
      );
      return;
    }

    if (!audio?.exportFile) {
      showStreamingDownloadNotice(
        {
          tone: 'error',
          title: '导出服务不可用',
          detail: '请在 ECHO Next 桌面端中导出音频文件。',
          progress: null,
        },
        5500,
      );
      return;
    }

    setIsAudioExporting(true);
    showStreamingDownloadNotice({
      tone: 'info',
      title: `准备导出：${exportTitle}`,
      detail: `${audioExportFormatLabel} · ${formatPlaybackRate(currentExportPlaybackRate)}`,
      progress: null,
    });

    try {
      const result = await audio.exportFile({
        filePath: sourcePath,
        format: audioExportFormat,
        playbackRate: currentExportPlaybackRate,
        title: exportTitle,
        artist: exportArtist,
        album: currentTrack?.album ?? playbackAudioStatus?.currentTrackAlbum ?? null,
        albumArtist: currentTrack?.albumArtist ?? playbackAudioStatus?.currentTrackAlbumArtist ?? null,
      });

      if (!result) {
        setStreamingDownloadNotice(null);
        return;
      }

      showStreamingDownloadNotice(
        {
          tone: 'success',
          title: `导出完成：${exportTitle}`,
          detail: result.filePath,
          progress: 100,
        },
        4500,
      );
    } catch (exportError) {
      showStreamingDownloadNotice(
        {
          tone: 'error',
          title: `导出失败：${exportTitle}`,
          detail: exportError instanceof Error ? exportError.message : String(exportError),
          progress: null,
        },
        7000,
      );
    } finally {
      setIsAudioExporting(false);
    }
  }, [
    audioExportFormat,
    audioExportFormatLabel,
    canExportCurrentAudio,
    currentExportPlaybackRate,
    currentTrack?.album,
    currentTrack?.albumArtist,
    currentTrack?.artist,
    currentTrack?.title,
    filePath,
    playbackAudioStatus?.currentTrackAlbum,
    playbackAudioStatus?.currentTrackAlbumArtist,
    playbackAudioStatus?.currentTrackArtist,
    playbackAudioStatus?.currentTrackTitle,
    showStreamingDownloadNotice,
  ]);

  useEffect(() => {
    if (!isSpotifyCurrentTrack || !currentTrack?.providerTrackId || !window.echo?.spotify?.getPlaybackState) {
      return;
    }

    let cancelled = false;
    const expectedUri = `spotify:track:${currentTrack.providerTrackId}`;
    const track = currentTrack;

    const syncSpotifyProgress = async (): Promise<void> => {
      try {
        const spotifyState = await window.echo.spotify.getPlaybackState();
        if (cancelled || spotifyState.itemUri !== expectedUri) {
          return;
        }

        const durationMs = Math.round(Math.max(0, track.duration) * 1000);
        const progressMs = spotifyState.progressMs ?? 0;
        const endedAtTrackTail =
          !spotifyState.isPlaying &&
          durationMs > 0 &&
          progressMs >= Math.max(0, durationMs - endedAutoAdvanceGraceSeconds * 1000);

        const status: PlaybackStatus = {
          state: endedAtTrackTail ? 'ended' : spotifyState.isPlaying ? 'playing' : 'paused',
          currentTrackId: track.id,
          positionMs: endedAtTrackTail ? durationMs : progressMs,
          durationMs,
          filePath: track.stableKey ?? track.path,
        };
        setPlaybackStatusSnapshot({ playbackStatus: status, audioStatus: null, error: null });
        window.echo?.desktopLyrics?.publishPlaybackStatus?.(status);
      } catch {
        // Spotify progress polling is best-effort; transport actions surface actionable errors.
      }
    };

    void syncSpotifyProgress();
    const interval = window.setInterval(() => {
      void syncSpotifyProgress();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [currentTrack, isSpotifyCurrentTrack]);

  useEffect(() => {
    activeTrackIdRef.current = currentTrack?.id ?? trackId ?? null;
  }, [currentTrack?.id, trackId]);

  useEffect(() => {
    let cancelled = false;

    const refreshPlayerAudioSettings = (): void => {
      const getSettings = window.echo?.app?.getSettings;
      if (typeof getSettings !== 'function') {
        setAudioAnalysisEnabled(true);
        setLowLoadPlaybackModeEnabled(false);
        setStreamingDownloadActionsEnabled(false);
        setPlayerWaveformProgressEnabled(false);
        setFixedVolumeEnabled(false);
        setDsdAutoVolumeLockEnabled(false);
        setAudioExportFormat('mp3');
        return;
      }

      void getSettings()
        .then((settings) => {
          if (!cancelled) {
            setAudioAnalysisEnabled(readAudioAnalysisEnabled(settings));
            setLowLoadPlaybackModeEnabled(readLowLoadPlaybackModeEnabled(settings));
            setStreamingDownloadActionsEnabled(readStreamingDownloadActionsEnabled(settings));
            setPlayerWaveformProgressEnabled(readPlayerWaveformProgressEnabled(settings));
            setFixedVolumeEnabled(readFixedVolumeEnabled(settings));
            setDsdAutoVolumeLockEnabled(readDsdAutoVolumeLockEnabled(settings));
            setAudioExportFormat(readAudioExportFormat(settings));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAudioAnalysisEnabled(true);
            setLowLoadPlaybackModeEnabled(false);
            setStreamingDownloadActionsEnabled(false);
            setPlayerWaveformProgressEnabled(false);
            setFixedVolumeEnabled(false);
            setDsdAutoVolumeLockEnabled(false);
            setAudioExportFormat('mp3');
          }
        });
    };

    const handleSettingsChanged = (event: Event): void => {
      if (event instanceof CustomEvent) {
        const audioAnalysisPatch = readAudioAnalysisEnabledPatch(event.detail);
        if (audioAnalysisPatch !== null) {
          setAudioAnalysisEnabled(audioAnalysisPatch);
        }
        const lowLoadPlaybackPatch = readLowLoadPlaybackModeEnabledPatch(event.detail);
        if (lowLoadPlaybackPatch !== null) {
          setLowLoadPlaybackModeEnabled(lowLoadPlaybackPatch);
        }
        const playerWaveformProgressPatch = readPlayerWaveformProgressEnabledPatch(event.detail);
        if (playerWaveformProgressPatch !== null) {
          setPlayerWaveformProgressEnabled(playerWaveformProgressPatch);
        }
        const fixedVolumePatch = readFixedVolumeEnabledPatch(event.detail);
        if (fixedVolumePatch !== null) {
          setFixedVolumeEnabled(fixedVolumePatch);
        }
        const dsdAutoVolumeLockPatch = readDsdAutoVolumeLockEnabledPatch(event.detail);
        if (dsdAutoVolumeLockPatch !== null) {
          setDsdAutoVolumeLockEnabled(dsdAutoVolumeLockPatch);
        }
        const audioExportFormatPatch = readAudioExportFormatPatch(event.detail);
        if (audioExportFormatPatch !== null) {
          setAudioExportFormat(audioExportFormatPatch);
        }
      }

      refreshPlayerAudioSettings();
    };

    refreshPlayerAudioSettings();
    window.addEventListener('settings:changed', handleSettingsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const miniPlayer = window.echo?.miniPlayer;

    if (!miniPlayer) {
      setMiniPlayerState(null);
      return undefined;
    }

    void miniPlayer.getState()
      .then((state) => {
        if (!cancelled) {
          setMiniPlayerState(state);
        }
      })
      .catch(() => undefined);

    const unsubscribe = miniPlayer.onStateChanged?.((state) => {
      setMiniPlayerState(state);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const handleToggleMiniPlayer = useCallback(async (): Promise<void> => {
    const miniPlayer = window.echo?.miniPlayer;
    if (!miniPlayer) {
      return;
    }

    setIsMiniPlayerBusy(true);
    try {
      const nextState = miniPlayerState?.visible ? await miniPlayer.hide() : await miniPlayer.show();
      setMiniPlayerState(nextState);
    } catch (miniPlayerError) {
      setError(miniPlayerError instanceof Error ? miniPlayerError.message : String(miniPlayerError));
    } finally {
      setIsMiniPlayerBusy(false);
    }
  }, [miniPlayerState?.visible]);

  const refreshCurrentTrackLiked = useCallback(async (): Promise<void> => {
    if (!trackId || (!isLibraryCurrentTrack && !isProviderLikedStreamingTrack) || !window.echo?.library) {
      setIsCurrentTrackLiked(false);
      return;
    }

    try {
      const result = await window.echo.library.getLikedTrackIds([trackId]);
      setIsCurrentTrackLiked(result[trackId] === true);
    } catch {
      setIsCurrentTrackLiked(false);
    }
  }, [isLibraryCurrentTrack, isProviderLikedStreamingTrack, trackId]);

  useEffect(() => {
    queue.syncPlaybackState(state);
  }, [queue, state]);

  useEffect(() => {
    const now = performance.now();
    const trackKey = trackId ?? filePath ?? null;
    const progressState = visualState === 'playing' ? 'playing' : state;
    const previous = progressClockRef.current;
    const samePlayback = previous.trackKey === trackKey;
    const stateChanged = previous.state !== progressState;
    const playbackRate = playbackAudioStatus?.playbackRate ?? 1;
    const durationLimit = durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY;
    const boundedSourcePosition = Math.min(Math.max(0, sourcePositionSeconds), durationLimit);
    let nextPositionSeconds = boundedSourcePosition;
    const seekAnchor = seekAnchorRef.current;

    if (seekAnchor) {
      if (seekAnchor.trackKey && trackKey && seekAnchor.trackKey !== trackKey) {
        seekAnchorRef.current = null;
      } else {
        const elapsedSeconds = Math.max(0, (now - seekAnchor.updatedAtMs) / 1000);
        const expectedSeekPosition = Math.min(
          seekAnchor.positionSeconds + (progressState === 'playing' ? elapsedSeconds * playbackRate : 0),
          durationLimit,
        );
        const sourceReachedSeekTarget = boundedSourcePosition >= seekAnchor.positionSeconds;
        const isStaleStatusAfterSeek =
          elapsedSeconds < seekAnchorMaxAgeSeconds &&
          (!sourceReachedSeekTarget || Math.abs(boundedSourcePosition - expectedSeekPosition) > seekAnchorSettleToleranceSeconds);

        if (isStaleStatusAfterSeek) {
          nextPositionSeconds = expectedSeekPosition;
        } else {
          seekAnchorRef.current = null;
        }
      }
    }

    if (!seekAnchorRef.current && samePlayback && !stateChanged && progressState === 'playing') {
      const wallElapsedSeconds = Math.max(0, (now - previous.updatedAtMs) / 1000);
      const mediaElapsedSeconds = wallElapsedSeconds * previous.playbackRate;
      const estimatedPositionSeconds = Math.min(previous.positionSeconds + mediaElapsedSeconds, durationLimit);
      const sourceJumpedBackward = boundedSourcePosition + 1 < previous.sourcePositionSeconds;
      const sourceCaughtUp = boundedSourcePosition + 0.35 >= estimatedPositionSeconds;
      const sourceJumpedForward = boundedSourcePosition > estimatedPositionSeconds + 0.35;
      const canBridgeSourceLag = wallElapsedSeconds <= maxInterpolatedStatusGapSeconds;
      const playbackRateChanged = Math.abs(previous.playbackRate - playbackRate) > 0.001;
      const rateChangeSourceDiscontinuity =
        playbackRateChanged && Math.abs(boundedSourcePosition - estimatedPositionSeconds) > playbackRateChangeDiscontinuitySeconds;
      const staleRegressionSeconds = previous.positionSeconds - boundedSourcePosition;
      const canIgnoreStaleRegression =
        canBridgeSourceLag &&
        staleRegressionSeconds > minVisibleStaleRegressionSeconds &&
        staleRegressionSeconds <= maxStaleStatusRegressionSeconds;
      const canIgnoreStaleForwardJump = canBridgeSourceLag && sourceJumpedForward && Math.abs(previous.playbackRate - 1) > 0.001;

      if (rateChangeSourceDiscontinuity) {
        nextPositionSeconds = estimatedPositionSeconds;
      } else if (canIgnoreStaleRegression) {
        nextPositionSeconds = estimatedPositionSeconds;
      } else if (canIgnoreStaleForwardJump) {
        nextPositionSeconds = estimatedPositionSeconds;
      } else if (canBridgeSourceLag && !sourceJumpedBackward && !sourceCaughtUp && !sourceJumpedForward && estimatedPositionSeconds > boundedSourcePosition) {
        nextPositionSeconds = estimatedPositionSeconds;
      }
    }

    progressClockRef.current = {
      durationSeconds,
      playbackRate,
      positionSeconds: nextPositionSeconds,
      sourcePositionSeconds: boundedSourcePosition,
      state: progressState,
      trackKey,
      updatedAtMs: now,
    };
    setRealtimePositionSeconds(nextPositionSeconds);
  }, [durationSeconds, filePath, playbackAudioStatus?.playbackRate, sourcePositionSeconds, state, trackId, visualState]);

  useEffect(() => {
    if (visualState !== 'playing' || state !== 'playing' || seekPreviewSeconds !== null) {
      return;
    }

    const updateRealtimePosition = (): void => {
      const clock = progressClockRef.current;
      if (clock.state !== 'playing') {
        return;
      }

      const durationLimit = clock.durationSeconds > 0 ? clock.durationSeconds : Number.POSITIVE_INFINITY;
      const elapsedSeconds = Math.max(0, (performance.now() - clock.updatedAtMs) / 1000) * clock.playbackRate;
      const nextPositionSeconds = Math.min(clock.positionSeconds + elapsedSeconds, durationLimit);
      setRealtimePositionSeconds((currentPositionSeconds) =>
        Math.abs(nextPositionSeconds - currentPositionSeconds) >= minRealtimeProgressStepSeconds
          ? nextPositionSeconds
          : currentPositionSeconds,
      );
    };

    if (lowLoadPlaybackModeEnabled) {
      const timer = window.setInterval(updateRealtimePosition, lowLoadProgressRenderIntervalMs);
      return () => window.clearInterval(timer);
    }

    let frameId: number | null = null;
    const tick = (): void => {
      updateRealtimePosition();
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [lowLoadPlaybackModeEnabled, seekPreviewSeconds, state, visualState]);

  useEffect(() => {
    if (!currentTrack || currentTrack.mediaType !== 'streaming') {
      return;
    }

    const patch = {
      ...(currentTrack.duration <= 0 && durationSeconds > 0 ? { duration: durationSeconds } : {}),
      ...(!currentTrack.codec && playbackAudioStatus?.codec ? { codec: playbackAudioStatus.codec } : {}),
      ...(!currentTrack.sampleRate && playbackAudioStatus?.fileSampleRate ? { sampleRate: playbackAudioStatus.fileSampleRate } : {}),
      ...(!currentTrack.bitDepth && playbackAudioStatus?.bitDepth ? { bitDepth: playbackAudioStatus.bitDepth } : {}),
      ...(!currentTrack.bitrate && playbackAudioStatus?.bitrate ? { bitrate: playbackAudioStatus.bitrate } : {}),
    };

    if (Object.keys(patch).length === 0) {
      return;
    }

    queue.updateCurrentTrackSnapshot(patch);
  }, [
    currentTrack,
    durationSeconds,
    playbackAudioStatus?.bitDepth,
    playbackAudioStatus?.bitrate,
    playbackAudioStatus?.codec,
    playbackAudioStatus?.fileSampleRate,
    queue,
  ]);

  useEffect(() => {
    const library = window.echo?.library;
    const analysisTrack = currentTrack;
    const existingJobId = analysisTrack ? bpmAnalysisJobIdsRef.current.get(analysisTrack.id) : undefined;
    const canAnalyzeCurrentTrack =
      analysisTrack &&
      !analysisTrack.isTemporary &&
      (analysisTrack.mediaType ?? 'local') === 'local' &&
      analysisTrack.analysisStatus !== 'analyzing' &&
      !isVerifiedAudioAnalysisBpm(analysisTrack);
    const shouldStartAnalysis = isPlaying;
    const canStartAnalysis = audioAnalysisEnabled === true && !lowLoadPlaybackModeEnabled;
    const shouldContinueAnalysis = Boolean(existingJobId && existingJobId !== 'done');

    if (
      !library?.startBpmAnalysis ||
      !library.getBpmAnalysisStatus ||
      !library.getTrack
    ) {
      return;
    }

    if (!analysisTrack) {
      return undefined;
    }

    if (existingJobId === 'done') {
      return undefined;
    }

    if ((!canAnalyzeCurrentTrack && !shouldContinueAnalysis) || ((!shouldStartAnalysis || !canStartAnalysis) && !shouldContinueAnalysis)) {
      return undefined;
    }

    let cancelled = false;
    let pollTimer: number | null = null;
    let cancelDeferredTask: (() => void) | null = null;

    const refreshAnalyzedTrack = async (): Promise<void> => {
      const refreshed = await library.getTrack(analysisTrack.id);
      if (cancelled || !refreshed || refreshed.id !== analysisTrack.id) {
        return;
      }

      updateTrackSnapshot(analysisTrack.id, {
        bpm: refreshed.bpm,
        bpmConfidence: refreshed.bpmConfidence,
        beatOffsetMs: refreshed.beatOffsetMs,
        analysisStatus: refreshed.analysisStatus,
        analysisUpdatedAt: refreshed.analysisUpdatedAt,
      });
    };

    const pollJob = (jobId: string): void => {
      pollTimer = window.setTimeout(() => {
        void (async () => {
          try {
            const status = await library.getBpmAnalysisStatus(jobId);
            if (cancelled) {
              return;
            }

            if (status.status === 'queued' || status.status === 'running') {
              pollJob(jobId);
              return;
            }

            await refreshAnalyzedTrack();
            bpmAnalysisJobIdsRef.current.set(analysisTrack.id, 'done');
          } catch {
            // Playback should not surface background BPM analysis failures.
          }
        })();
      }, bpmAnalysisStatusPollMs);
    };

    if (existingJobId) {
      pollJob(existingJobId);
    } else {
      cancelDeferredTask = deferNonCriticalPlaybackTask(() => {
        void (async () => {
          try {
            const job = await library.startBpmAnalysis({ trackIds: [analysisTrack.id] });
            if (cancelled) {
              return;
            }

            updateTrackSnapshot(analysisTrack.id, {
              analysisStatus: 'analyzing',
            });

            if (job.status === 'queued' || job.status === 'running') {
              bpmAnalysisJobIdsRef.current.set(analysisTrack.id, job.id);
              pollJob(job.id);
              return;
            }

            await refreshAnalyzedTrack();
            bpmAnalysisJobIdsRef.current.set(analysisTrack.id, 'done');
          } catch {
            // Disabled analysis or analyzer errors should never interrupt playback.
          }
        })();
      });
    }

    return () => {
      cancelled = true;
      cancelDeferredTask?.();
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [audioAnalysisEnabled, currentTrack, isPlaying, lowLoadPlaybackModeEnabled, updateTrackSnapshot]);

  useEffect(() => {
    const streaming = window.echo?.streaming;
    const canAnalyzeCurrentTrack =
      audioAnalysisEnabled === true &&
      !lowLoadPlaybackModeEnabled &&
      isPlaying &&
      streamingTrackMediaType === 'streaming' &&
      !unsupportedStreamingBpmAnalysisProviders.has(streamingTrackProvider as StreamingProviderName) &&
      !isReliableBpmAnalysis(streamingTrackBpm, streamingTrackBpmConfidence, streamingTrackAnalysisStatus) &&
      streamingTrackAnalysisStatus !== 'analyzing' &&
      (streamingTrackAnalysisStatus !== 'complete' ||
        !isReliableBpmAnalysis(streamingTrackBpm, streamingTrackBpmConfidence, streamingTrackAnalysisStatus)) &&
      isStreamingProviderName(streamingTrackProvider) &&
      Boolean(streamingTrackProviderTrackId);

    if (!streaming?.analyzeBpm || !canAnalyzeCurrentTrack || !streamingTrackProviderTrackId || !streamingTrackId) {
      return;
    }

    const provider = streamingTrackProvider;
    const providerTrackId = streamingTrackProviderTrackId;
    if (!isStreamingProviderName(provider)) {
      return;
    }

    const quality = streamingTrackQuality;
    const analysisKey = `${provider}:${providerTrackId}:${quality ?? 'standard'}`;
    const pendingAnalysisKeys = streamingBpmAnalysisTrackIdsRef.current;
    if (pendingAnalysisKeys.has(analysisKey)) {
      return;
    }

    const analyzedStreamingTrackId = streamingTrackId;
    pendingAnalysisKeys.add(analysisKey);
    let started = false;
    const cancelDeferredTask = deferNonCriticalPlaybackTask(() => {
      started = true;
      void streaming
        .analyzeBpm({
          provider,
          providerTrackId,
          quality,
        })
        .then((result) => {
          if (activeTrackIdRef.current !== analyzedStreamingTrackId) {
            return;
          }

          updateTrackSnapshot(analyzedStreamingTrackId, {
            bpm: result.bpm,
            bpmConfidence: result.confidence,
            beatOffsetMs: result.beatOffsetMs,
            analysisStatus: result.status,
            analysisUpdatedAt: result.updatedAt,
          });
        })
        .catch(() => {
          pendingAnalysisKeys.delete(analysisKey);
        });
    });

    return () => {
      cancelDeferredTask();
      if (!started) {
        pendingAnalysisKeys.delete(analysisKey);
      }
    };
  }, [
    audioAnalysisEnabled,
    isPlaying,
    lowLoadPlaybackModeEnabled,
    streamingTrackAnalysisStatus,
    streamingTrackBpm,
    streamingTrackBpmConfidence,
    streamingTrackId,
    streamingTrackMediaType,
    streamingTrackProvider,
    streamingTrackProviderTrackId,
    streamingTrackQuality,
    updateTrackSnapshot,
  ]);

  useEffect(() => {
    void refreshCurrentTrackLiked();
  }, [refreshCurrentTrackLiked]);

  useEffect(() => {
    if (!trackId || currentTrack || hydratedTrackIdsRef.current.has(trackId)) {
      return;
    }

    const getTrack = window.echo?.library?.getTrack;
    if (typeof getTrack !== 'function') {
      return;
    }

    hydratedTrackIdsRef.current.add(trackId);
    let cancelled = false;
    void getTrack(trackId)
      .then((track) => {
        if (cancelled || !track) {
          return;
        }

        appendToQueue(track, { type: 'manual', label: 'Restored playback' });
        setQueueCurrentTrackId(track.id);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [appendToQueue, currentTrack, setQueueCurrentTrackId, trackId]);

  useEffect(() => {
    const mv = window.echo?.mv;

    if (lowLoadPlaybackModeEnabled || !isPlaying || !trackId || currentTrack?.mediaType === 'streaming' || !mv || mvPreloadTrackRef.current === trackId) {
      return;
    }

    let cancelled = false;

    const cancelDeferredTask = deferNonCriticalPlaybackTask(() => {
      void (async () => {
        try {
          const settings = await mv.getSettings();
          if (cancelled || settings.enabled === false || !settings.autoPreload) {
            return;
          }

          mvPreloadTrackRef.current = trackId;
          const selected = await mv.getSelected(trackId);
          if (cancelled || selected) {
            return;
          }

          if (
            (currentTrack?.isTemporary || isReceiverTrackId(trackId)) &&
            mv.searchNetworkCandidatesForSnapshot
          ) {
            await mv.searchNetworkCandidatesForSnapshot({
              trackId: currentTrack?.id ?? trackId,
              title: currentTrack?.title?.trim() || title,
              artist: currentTrack?.artist?.trim() || currentTrack?.albumArtist?.trim() || artist || 'Unknown Artist',
              album: currentTrack?.album || null,
              albumArtist: currentTrack?.albumArtist || null,
              durationSeconds: currentTrack?.duration && currentTrack.duration > 0 ? currentTrack.duration : null,
              coverThumb: currentTrack?.coverThumb ?? artworkUrl ?? null,
              mediaType: currentTrack?.mediaType ?? 'remote',
              query: [currentTrack?.title || title, currentTrack?.artist || currentTrack?.albumArtist || artist].filter(Boolean).join(' '),
            });
          } else {
            await mv.searchNetworkCandidates(trackId);
          }
          if (!cancelled && (await mv.getSelected(trackId))) {
            window.dispatchEvent(new CustomEvent('mv:changed', { detail: { trackId } }));
          }
        } catch {
          // MV preload should never interrupt audio playback.
        }
      })();
    });

    return () => {
      cancelled = true;
      cancelDeferredTask();
    };
  }, [
    artist,
    artworkUrl,
    currentTrack?.album,
    currentTrack?.albumArtist,
    currentTrack?.artist,
    currentTrack?.coverThumb,
    currentTrack?.duration,
    currentTrack?.id,
    currentTrack?.isTemporary,
    currentTrack?.mediaType,
    currentTrack?.title,
    isPlaying,
    lowLoadPlaybackModeEnabled,
    title,
    trackId,
  ]);

  useEffect(() => {
    let cancelled = false;
    const refreshSmtcSetting = (): void => {
      void window.echo?.app
        ?.getSettings?.()
        .then((settings) => {
          if (!cancelled) {
            setSmtcEnabled(settings.smtcEnabled !== false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSmtcEnabled(true);
          }
        });
    };

    refreshSmtcSetting();
    window.addEventListener('settings:changed', refreshSmtcSetting);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', refreshSmtcSetting);
    };
  }, []);

  useEffect(() => {
    window.addEventListener(likedTracksChangedEvent, refreshCurrentTrackLiked);
    return () => window.removeEventListener(likedTracksChangedEvent, refreshCurrentTrackLiked);
  }, [refreshCurrentTrackLiked]);

  useEffect(() => {
    applySharedPlaybackStatus(sharedPlaybackStatus);
  }, [applySharedPlaybackStatus, sharedPlaybackStatus]);

  useEffect(() => {
    let disposed = false;
    const connect = window.echo?.connect;
    const connectStatusPromise = connect?.getStatus?.();
    void connectStatusPromise?.then((status) => {
      if (!disposed) {
        setConnectStatus(isActiveConnectPlaybackStatus(status) ? status : null);
      }
    }).catch(() => undefined);

    const unsubscribeConnectStatus = connect?.onStatus?.((status) => {
      setConnectStatus(isActiveConnectPlaybackStatus(status) ? status : null);
    });

    return () => {
      disposed = true;
      unsubscribeConnectStatus?.();
    };
  }, []);

  useEffect(() => {
    const hqPlayerActive =
      isHqPlayerConnectStatus(connectStatus) && ['connecting', 'ready', 'playing', 'paused'].includes(connectStatus.state);
    if (!hqPlayerActive) {
      setHqPlayerOutputRate(null);
      return undefined;
    }

    let cancelled = false;
    const refreshHqPlayerStatus = (): void => {
      void window.echo?.hqPlayer?.getStatus?.()
        .then((nextStatus) => {
          const nextRate = nextStatus.playbackStatus?.activeRate ?? null;
          if (!cancelled && typeof nextRate === 'number' && Number.isFinite(nextRate) && nextRate > 0) {
            setHqPlayerOutputRate(nextRate);
          }
        })
        .catch(() => undefined);
    };

    refreshHqPlayerStatus();
    const interval = window.setInterval(refreshHqPlayerStatus, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [connectStatus?.currentTrackId, connectStatus?.deviceId, connectStatus?.protocol, connectStatus?.state]);

  useEffect(() => {
    let disposed = false;
    const connect = window.echo?.connect;
    const receiverStatusPromise = connect?.getReceiverStatus?.();
    void receiverStatusPromise?.then((status) => {
      if (!disposed) {
        setReceiverStatus(status);
      }
    }).catch(() => undefined);

    const unsubscribe = connect?.onReceiverStatus?.((status) => {
      setReceiverStatus(status);
      if (status.currentUri && ['ready', 'loading', 'playing', 'paused'].includes(status.state)) {
        setQueueCurrentTrackId(null);
      }
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [setQueueCurrentTrackId]);

  useEffect(() => {
    let disposed = false;
    const connect = window.echo?.connect;
    const receiverStatusPromise = connect?.getAirPlayReceiverStatus?.();
    void receiverStatusPromise?.then((status) => {
      if (!disposed) {
        setAirPlayReceiverStatus(status);
      }
    }).catch(() => undefined);

    const unsubscribe = connect?.onAirPlayReceiverStatus?.((status) => {
      setAirPlayReceiverStatus(status);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const runPlaybackAction = useCallback(
    async (
      action: () => Promise<PlaybackStatus | null>,
      options: { rethrow?: boolean } = {},
    ): Promise<PlaybackStatus | null> => {
      try {
        const status = await action();
        if (status) {
          lastPlaybackActionStatusRef.current = {
            state: status.state,
            trackId: status.currentTrackId,
            filePath: status.filePath,
            updatedAtMs: performance.now(),
          };
          setPlaybackStatus(status);
          setAudioStatus((current) =>
            current
              ? {
                  ...current,
                  state: status.state,
                  currentTrackId: status.currentTrackId,
                  currentFilePath: status.filePath,
                  positionSeconds: status.positionMs / 1000,
                  durationSeconds: status.durationMs / 1000,
                }
              : current,
          );
          setQueueCurrentTrackId(status.currentTrackId);
          setPlaybackStatusSnapshot({ playbackStatus: status, error: null });
          return status;
        }
        await refreshStatus();
        return null;
      } catch (actionError) {
        const message = actionError instanceof Error ? actionError.message : String(actionError);
        setError(formatAudioHostError(message));
        setPlaybackStatusSnapshot({ error: shouldSuppressAudioHostError(message) ? null : message });
        if (options.rethrow === true) {
          throw actionError;
        }
        return null;
      }
    },
    [refreshStatus, setQueueCurrentTrackId],
  );

  const publishOptimisticPause = useCallback((): void => {
    const status: PlaybackStatus = {
      state: 'paused',
      currentTrackId: trackId,
      filePath,
      positionMs: Math.round(Math.max(0, positionSeconds) * 1000),
      durationMs: Math.round(Math.max(0, durationSeconds) * 1000),
    };
    lastPlaybackActionStatusRef.current = {
      state: status.state,
      trackId: status.currentTrackId,
      filePath: status.filePath,
      updatedAtMs: performance.now(),
    };
    setPlaybackStatus(status);
    setAudioStatus((current) =>
      current
        ? {
            ...current,
            state: 'paused',
            positionSeconds,
            durationSeconds,
          }
        : current,
    );
    setPlaybackStatusSnapshot({
      audioStatus: audioStatus
        ? {
            ...audioStatus,
            state: 'paused',
            positionSeconds,
            durationSeconds,
          }
        : null,
      playbackStatus: status,
      playbackVisualIntent: null,
      error: null,
    });
  }, [audioStatus, durationSeconds, filePath, positionSeconds, trackId]);

  const applyConnectPlaybackStatus = useCallback(
    (connectStatus: ConnectSessionStatus, fallbackPositionSeconds?: number): PlaybackStatus => {
      const nextStatus = playbackStatusFromConnectStatus(connectStatus, {
        currentTrackId: connectStatus.currentTrackId ?? trackId,
        durationMs: Math.round(Math.max(0, durationSeconds) * 1000),
        filePath,
      });
      const normalizedStatus =
        fallbackPositionSeconds === undefined
          ? nextStatus
          : {
              ...nextStatus,
              positionMs: Math.round(Math.max(0, fallbackPositionSeconds) * 1000),
            };
      lastPlaybackActionStatusRef.current = {
        state: normalizedStatus.state,
        trackId: normalizedStatus.currentTrackId,
        filePath: normalizedStatus.filePath,
        updatedAtMs: performance.now(),
      };
      setPlaybackStatus(normalizedStatus);
      setAudioStatus(null);
      setQueueCurrentTrackId(normalizedStatus.currentTrackId);
      setPlaybackStatusSnapshot({ audioStatus: null, playbackStatus: normalizedStatus, playbackVisualIntent: null, error: null });
      return normalizedStatus;
    },
    [durationSeconds, filePath, setQueueCurrentTrackId, trackId],
  );

  const handlePlayPause = useCallback(async (): Promise<void> => {
    const playback = window.echo?.playback;
    const connect = window.echo?.connect;

    const activeConnectStatus = await getActiveConnectPlaybackStatus();
    if (activeConnectStatus && connect?.play && connect.pause) {
      try {
        const nextStatus =
          visualState === 'playing' || visualState === 'loading'
            ? await connect.pause()
            : await connect.play();
        applyConnectPlaybackStatus(nextStatus);
      } catch (connectError) {
        const message = connectError instanceof Error ? connectError.message : String(connectError);
        setError(formatAudioHostError(message));
        setPlaybackStatusSnapshot({ error: shouldSuppressAudioHostError(message) ? null : message });
      }
      return;
    }

    if (queue.hqPlayerTakeoverEnabled) {
      if (visualState === 'playing' || visualState === 'loading') {
        setError('HQPlayer 接管中，ECHO 已避免抢占本机音频设备。');
        return;
      }

      await runPlaybackAction(queue.activateHqPlayerTakeover);
      return;
    }

    if (isSpotifyCurrentTrack && currentTrack) {
      await runPlaybackAction(() =>
        visualState === 'playing' || visualState === 'loading'
          ? pauseSpotifyPlayback(currentTrack)
          : resumeSpotifyPlayback(currentTrack),
      );
      return;
    }

    if (!playback) {
      setError('Desktop bridge unavailable');
      return;
    }

    await runPlaybackAction(async () => {
      if (visualState === 'playing' || visualState === 'loading') {
        publishOptimisticPause();
        return playback.pause();
      }

      if (activeReceiverStatus) {
        return playback.play();
      }

      if (isNativePausedVisualState) {
        return playback.play();
      }

      const latestStatus = await playback.getStatus();
      if (latestStatus.state === 'playing' || latestStatus.state === 'loading') {
        return playback.pause();
      }

      if (latestStatus.state === 'paused') {
        return playback.play();
      }

      if ((latestStatus.state === 'idle' || latestStatus.state === 'stopped' || latestStatus.state === 'ended') && queue.currentItem) {
        return queue.playQueueItem(queue.currentItem.queueId);
      }

      if ((latestStatus.state === 'idle' || latestStatus.state === 'stopped' || latestStatus.state === 'ended') && currentTrack) {
        return queue.playTrack(currentTrack);
      }

      return playback.play();
    });
  }, [activeReceiverStatus, applyConnectPlaybackStatus, currentTrack, isNativePausedVisualState, isSpotifyCurrentTrack, queue, runPlaybackAction, visualState]);

  const handlePrevious = useCallback((): void => {
    void runPlaybackAction(queue.playPrevious);
  }, [queue.playPrevious, runPlaybackAction]);

  useEffect(() => {
    if (openPopover !== 'signal') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && signalPathAnchorRef.current?.contains(target)) {
        return;
      }

      setOpenPopover(null);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenPopover(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openPopover]);

  const handleNext = useCallback((): void => {
    void runPlaybackAction(queue.playNext);
  }, [queue.playNext, runPlaybackAction]);

  useEffect(() => {
    applyMediaSessionSnapshot({
      enabled: smtcEnabled && Boolean(filePath || currentTrack),
      title,
      artist,
      album: currentTrack?.album ?? null,
      artworkUrl,
      state: visualState,
      positionSeconds,
      durationSeconds,
      playbackRate: playbackAudioStatus?.playbackRate ?? 1,
    });
  }, [
    artist,
    currentTrack,
    durationSeconds,
    filePath,
    artworkUrl,
    playbackAudioStatus?.playbackRate,
    positionSeconds,
    smtcEnabled,
    visualState,
    title,
  ]);

  const handleCycleRepeatMode = useCallback((): void => {
    queue.setRepeatMode(queue.repeatMode === 'one' ? 'off' : 'one');
  }, [queue]);

  const handleOpenQueue = useCallback((): void => {
    if (onOpenQueue) {
      onOpenQueue();
      return;
    }

    window.dispatchEvent(new Event('app:navigate:queue'));
  }, [onOpenQueue]);

  const handleOpenLyrics = useCallback((): void => {
    rememberLyricsViewMode('lyrics');
    window.dispatchEvent(new CustomEvent('app:navigate:lyrics', { detail: { mode: 'lyrics' } }));
  }, []);

  const handleOpenMv = useCallback((): void => {
    rememberLyricsViewMode('mv');
    window.dispatchEvent(new CustomEvent('app:navigate:lyrics', { detail: { mode: 'mv' } }));
  }, []);

  const handleToggleCurrentTrackLiked = useCallback(async (): Promise<void> => {
    if (!trackId || (!isLibraryCurrentTrack && !isProviderLikedStreamingTrack) || !window.echo?.library) {
      return;
    }

    try {
      const previous = isCurrentTrackLiked;
      setIsCurrentTrackLiked(!previous);
      const result =
        isProviderLikedStreamingTrack && streamingTrackProviderTrackId && isProviderLikedStreamingProvider(streamingTrackProvider)
          ? await window.echo.streaming.setTrackLiked({
              provider: streamingTrackProvider,
              providerTrackId: streamingTrackProviderTrackId,
              liked: !previous,
            })
          : await window.echo.library.toggleTrackLiked(trackId);
      setIsCurrentTrackLiked(result.liked);
      window.dispatchEvent(new Event(likedTracksChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : String(likeError));
      void refreshCurrentTrackLiked();
    }
  }, [
    isCurrentTrackLiked,
    isLibraryCurrentTrack,
    isProviderLikedStreamingTrack,
    refreshCurrentTrackLiked,
    streamingTrackProvider,
    streamingTrackProviderTrackId,
    trackId,
  ]);

  const currentQueueTrackForEndedPlayback = queue.currentTrack ?? null;
  const currentQueueTrackIdForEndedPlayback = currentQueueTrackForEndedPlayback?.id ?? queue.currentTrackId ?? null;
  const currentQueueFilePathForEndedPlayback = queue.currentTrack?.path ?? null;
  const currentQueueIdForEndedPlayback = queue.currentQueueId;
  const playNextFromQueue = queue.playNext;
  const runAutoAdvanceFromQueue = useCallback(
    (playbackKey: string): void => {
      pendingEndedTrackRef.current = playbackKey;
      void (async () => {
        try {
          for (let attempt = 0; attempt < endedAutoAdvanceMaxAttempts; attempt += 1) {
            try {
              const status = await runPlaybackAction(() => playNextFromQueue({ autoAdvance: true }), { rethrow: true });
              if (status || state === 'ended') {
                handledEndedTrackRef.current = playbackKey;
              }
              return;
            } catch {
              if (attempt >= endedAutoAdvanceMaxAttempts - 1 || handledEndedTrackRef.current === playbackKey) {
                return;
              }
              await new Promise((resolve) => window.setTimeout(resolve, endedAutoAdvanceRetryDelayMs));
            }
          }
        } finally {
          if (pendingEndedTrackRef.current === playbackKey) {
            pendingEndedTrackRef.current = null;
          }
        }
      })();
    },
    [playNextFromQueue, runPlaybackAction, state],
  );

  useEffect(() => {
    const endedMatchesCurrent =
      trackMatchesPlaybackIdentity(currentQueueTrackForEndedPlayback, endedStatusTrackId) ||
      trackMatchesPlaybackIdentity(currentQueueTrackForEndedPlayback, endedStatusFilePath) ||
      Boolean(endedStatusTrackId && currentQueueTrackIdForEndedPlayback && endedStatusTrackId === currentQueueTrackIdForEndedPlayback) ||
      Boolean(endedStatusFilePath && currentQueueFilePathForEndedPlayback && endedStatusFilePath === currentQueueFilePathForEndedPlayback) ||
      (!currentQueueTrackIdForEndedPlayback && !currentQueueFilePathForEndedPlayback);
    const endedPlaybackKey = endedStatusTrackId ?? endedStatusFilePath ?? currentQueueIdForEndedPlayback ?? null;
    const endedAtNaturalEnd =
      !endedStatusDurationSeconds ||
      endedStatusDurationSeconds <= 0 ||
      (endedStatusPositionSeconds !== null &&
        endedStatusPositionSeconds >= Math.max(0, endedStatusDurationSeconds - endedAutoAdvanceGraceSeconds));

    if (
      state !== 'ended' ||
      !endedPlaybackKey ||
      !endedMatchesCurrent ||
      !endedAtNaturalEnd ||
      pendingEndedTrackRef.current === endedPlaybackKey ||
      handledEndedTrackRef.current === endedPlaybackKey
    ) {
      return;
    }

    runAutoAdvanceFromQueue(endedPlaybackKey);
  }, [
    currentQueueFilePathForEndedPlayback,
    currentQueueIdForEndedPlayback,
    currentQueueTrackForEndedPlayback,
    currentQueueTrackIdForEndedPlayback,
    endedStatusDurationSeconds,
    endedStatusFilePath,
    endedStatusPositionSeconds,
    endedStatusTrackId,
    runAutoAdvanceFromQueue,
    state,
  ]);

  useEffect(() => {
    const tailPlaybackKey = trackId ?? filePath ?? currentQueueIdForEndedPlayback ?? null;
    if (
      visualState !== 'playing' ||
      state !== 'playing' ||
      seekPreviewSeconds !== null ||
      shouldLetAutomixDriveTailAdvance(playbackAudioStatus) ||
      !tailPlaybackKey ||
      durationSeconds <= 0 ||
      positionSeconds < Math.max(0, durationSeconds - tailAutoAdvanceToleranceSeconds) ||
      pendingEndedTrackRef.current === tailPlaybackKey ||
      handledEndedTrackRef.current === tailPlaybackKey
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const clock = progressClockRef.current;
      const samePlayback = clock.trackKey === tailPlaybackKey || trackId === tailPlaybackKey || filePath === tailPlaybackKey;
      const tailPositionSeconds = Math.max(clock.positionSeconds, realtimePositionSeconds, positionSeconds);
      const stillAtTail =
        clock.durationSeconds > 0 &&
        tailPositionSeconds >= Math.max(0, clock.durationSeconds - tailAutoAdvanceToleranceSeconds);

      if (
        samePlayback &&
        clock.state === 'playing' &&
        stillAtTail &&
        pendingEndedTrackRef.current !== tailPlaybackKey &&
        handledEndedTrackRef.current !== tailPlaybackKey
      ) {
        runAutoAdvanceFromQueue(tailPlaybackKey);
      }
    }, tailAutoAdvanceWatchdogDelayMs);

    return () => window.clearTimeout(timer);
  }, [
    currentQueueIdForEndedPlayback,
    durationSeconds,
    filePath,
    positionSeconds,
    playbackAudioStatus,
    realtimePositionSeconds,
    runAutoAdvanceFromQueue,
    seekPreviewSeconds,
    state,
    trackId,
    visualState,
  ]);

  useEffect(() => {
    if (state === 'playing') {
      handledEndedTrackRef.current = null;
      pendingEndedTrackRef.current = null;
    }
  }, [state, trackId]);

  const displayError = formatAudioHostError(error);

  const commitSeek = useCallback(
    async (nextPositionSeconds: number): Promise<void> => {
      const playback = window.echo?.playback;

      if (durationSeconds <= 0) {
        setSeekPreviewSeconds(null);
        return;
      }

      const safePositionSeconds = Math.min(durationSeconds, Math.max(0, nextPositionSeconds));

      logLyricsConsole('player.seek-request', {
        trackId,
        identity: trackId ?? filePath ?? null,
        targetPositionMs: Math.round(safePositionSeconds * 1000),
        durationMs: Math.round(durationSeconds * 1000),
        source: isSpotifyCurrentTrack ? 'spotify' : 'player-bar',
      });

      try {
        setSeekPreviewSeconds(safePositionSeconds);
        seekAnchorRef.current = {
          positionSeconds: safePositionSeconds,
          trackKey: trackId ?? filePath ?? null,
          updatedAtMs: performance.now(),
        };
        if (isSpotifyCurrentTrack && currentTrack) {
          const status = await seekSpotifyPlayback(currentTrack, safePositionSeconds);
          setPlaybackStatus(status);
          beginPlaybackSeekSnapshot(status);
          dispatchPlaybackSeeked(safePositionSeconds, status.currentTrackId ?? trackId ?? null);
          logLyricsConsole('player.seek-committed', {
            source: 'spotify',
            trackId: status.currentTrackId ?? trackId ?? null,
            state: status.state,
            targetPositionMs: Math.round(safePositionSeconds * 1000),
            statusPositionMs: status.positionMs,
            durationMs: status.durationMs,
          });
          return;
        }

        const activeConnectStatus = await getActiveConnectPlaybackStatus();
        if (activeConnectStatus) {
          const connect = window.echo?.connect;
          if (!connect?.seek) {
            throw new Error('Connect 投送中，远端 seek 不可用。');
          }

          const connectStatus = await connect.seek(safePositionSeconds);
          const nextStatus = applyConnectPlaybackStatus(connectStatus, safePositionSeconds);
          dispatchPlaybackSeeked(safePositionSeconds, nextStatus.currentTrackId ?? trackId ?? null);
          logLyricsConsole('player.seek-committed', {
            source: 'connect',
            trackId: nextStatus.currentTrackId ?? trackId ?? null,
            state: nextStatus.state,
            targetPositionMs: Math.round(safePositionSeconds * 1000),
            statusPositionMs: nextStatus.positionMs,
            durationMs: nextStatus.durationMs,
          });
          return;
        }

        if (!playback) {
          throw new Error('Desktop bridge unavailable');
        }

        const status = await playback.seek(safePositionSeconds);
        const nextStatus = {
          ...status,
          positionMs: Math.round(safePositionSeconds * 1000),
        };
        setPlaybackStatus(nextStatus);
        setAudioStatus((current) =>
          current
            ? {
                ...current,
                state: status.state,
                currentTrackId: status.currentTrackId,
                currentFilePath: status.filePath,
                positionSeconds: safePositionSeconds,
                durationSeconds: status.durationMs / 1000,
              }
            : current,
        );
        beginPlaybackSeekSnapshot(nextStatus);
        dispatchPlaybackSeeked(safePositionSeconds, status.currentTrackId ?? trackId ?? null);
        logLyricsConsole('player.seek-committed', {
          source: 'local',
          trackId: status.currentTrackId ?? trackId ?? null,
          state: status.state,
          targetPositionMs: Math.round(safePositionSeconds * 1000),
          statusPositionMs: nextStatus.positionMs,
          durationMs: nextStatus.durationMs,
        });
        await refreshStatus();
      } catch (seekError) {
        const message = seekError instanceof Error ? seekError.message : String(seekError);
        logLyricsConsole('player.seek-failed', {
          trackId,
          identity: trackId ?? filePath ?? null,
          targetPositionMs: Math.round(safePositionSeconds * 1000),
          error: message,
        }, { level: 'warn', dedupeKey: `player-seek-failed:${trackId ?? filePath ?? 'unknown'}`, dedupeMs: 1000 });
        setError(formatAudioHostError(message));
        setPlaybackStatusSnapshot({ error: shouldSuppressAudioHostError(message) ? null : message });
      } finally {
        setSeekPreviewSeconds(null);
      }
    },
    [applyConnectPlaybackStatus, currentTrack, durationSeconds, filePath, isSpotifyCurrentTrack, refreshStatus, trackId],
  );

  return (
    <motion.footer
      className="player-bar"
      data-low-load-playback={lowLoadPlaybackModeEnabled ? 'true' : undefined}
      data-network-loading={isNetworkPlaybackLoading ? 'true' : undefined}
      data-playback-state={visualState}
      aria-busy={isNetworkPlaybackLoading}
      aria-label="播放控制"
      layout="position"
      transition={miniPlayerTransition}
    >
      {streamingDownloadNotice ? (
        <div className={`player-download-notice player-download-notice--${streamingDownloadNotice.tone}`} role="status" aria-live="polite">
          <div className="player-download-notice-copy">
            <strong>{streamingDownloadNotice.title}</strong>
            <span>{streamingDownloadNotice.detail}</span>
          </div>
          {streamingDownloadNotice.progress !== null ? (
            <div
              className="player-download-notice-progress"
              role="progressbar"
              aria-label="流媒体下载进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={streamingDownloadNotice.progress}
            >
              <span style={{ width: `${streamingDownloadNotice.progress}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="player-now">
        <motion.button
          className="player-cover"
          data-empty={!artworkUrl}
          type="button"
          aria-label="打开歌词"
          title="打开歌词"
          data-loading={isNetworkPlaybackLoading ? 'true' : undefined}
          layoutId={playerCoverLayoutId(trackId)}
          transition={springSoft}
          onClick={handleOpenLyrics}
        >
          {artworkUrl ? (
            <img alt="" src={artworkUrl} />
          ) : (
            <div className="player-cover-placeholder">
              <span className="player-cover-disc" />
              <span className="player-cover-note" />
            </div>
          )}
          <div className="cover-sheen" />
        </motion.button>
        <div className="player-track-copy">
          <PlayerMarqueeText kind="title" text={title} />
          <PlayerMarqueeText kind="subtitle" text={artist} onClick={canOpenCurrentArtist ? handleOpenCurrentArtist : undefined} />
          <PlayerStatusChips hqPlayerActiveRate={hqPlayerOutputRate} status={audioStatus} state={state} track={currentTrack} />
          {isNetworkPlaybackLoading ? (
            <span className="player-loading-hint" role="status" aria-live="polite">
              <Loader2 className="spinning-icon" size={13} aria-hidden="true" />
              {networkPlaybackLoadingLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div className="player-center">
        <div className="player-transport-shell">
          {showSignalPathControl ? (
            <div className="signal-path-anchor" ref={signalPathAnchorRef}>
              <AudioSignalPathControl
                isOpen={openPopover === 'signal'}
                status={audioStatus}
                track={currentTrack}
                connectStatus={connectStatus}
                onClick={() => setOpenPopover((current) => current === 'signal' ? null : 'signal')}
              />
              <AudioSignalPathPopover
                isOpen={openPopover === 'signal'}
                status={audioStatus}
                track={currentTrack}
                connectStatus={connectStatus}
                onClose={() => setOpenPopover(null)}
                onOpenAudioSettings={onOpenAudioSettings}
              />
            </div>
          ) : null}
          <PlayerTransport
            canGoNext={queue.canGoNext}
            canGoPrevious={queue.canGoPrevious}
            isPlaying={isPlaying}
            isShuffleEnabled={queue.isShuffleEnabled}
            repeatMode={queue.repeatMode}
            onNext={handleNext}
            onPlayPause={() => void handlePlayPause()}
            onPrevious={handlePrevious}
            onCycleRepeatMode={handleCycleRepeatMode}
            onOpenQueue={handleOpenQueue}
            onOpenLyrics={handleOpenLyrics}
            onOpenMv={handleOpenMv}
            showQueueButton={showQueueButton}
            onToggleShuffle={queue.toggleShuffle}
            isCurrentTrackLiked={isCurrentTrackLiked}
            canLikeCurrentTrack={Boolean(trackId && (isLibraryCurrentTrack || isProviderLikedStreamingTrack))}
            onToggleCurrentTrackLiked={() => void handleToggleCurrentTrackLiked()}
          />
        </div>
        <PlayerProgress
          disabled={!filePath && !isSpotifyCurrentTrack}
          durationSeconds={durationSeconds}
          isLoading={isNetworkPlaybackLoading}
          waveformEnabled={playerWaveformProgressEnabled && !lowLoadPlaybackModeEnabled && !isNetworkPlaybackLoading}
          waveformSeed={trackId ?? filePath ?? title}
          positionSeconds={positionSeconds}
          onCommit={(nextPositionSeconds) => void commitSeek(nextPositionSeconds)}
        />
        {displayError ? <span className="player-error">{displayError}</span> : null}
      </div>

      <div className="output-status">
        <SleepTimerButton />
        {hasDesktopLyricsBridge ? (
          <button
            className={`icon-button ${desktopLyricsVisible ? 'is-soft-active' : ''}`}
            type="button"
            aria-label={desktopLyricsVisible ? '隐藏桌面歌词' : '显示桌面歌词'}
            title={desktopLyricsLocked ? '右键解除桌面歌词锁定' : desktopLyricsVisible ? '隐藏桌面歌词' : '显示桌面歌词'}
            aria-pressed={desktopLyricsVisible}
            onClick={() => onToggleDesktopLyrics?.()}
            onContextMenu={(event) => {
              if (!desktopLyricsLocked) {
                return;
              }

              event.preventDefault();
              onUnlockDesktopLyrics?.();
            }}
          >
            <Captions size={17} />
          </button>
        ) : null}
        <button
          className={`icon-button ${miniPlayerState?.visible ? 'is-soft-active' : ''}`}
          type="button"
          aria-label={miniPlayerState?.visible ? '隐藏迷你播放器' : '显示迷你播放器'}
          title={miniPlayerState?.visible ? '隐藏迷你播放器' : '显示迷你播放器'}
          disabled={!window.echo?.miniPlayer || isMiniPlayerBusy}
          onClick={() => void handleToggleMiniPlayer()}
        >
          {isMiniPlayerBusy ? <Loader2 className="spinning-icon" size={17} /> : <Monitor size={17} />}
        </button>
        <PlayerVolumeControl
          status={audioStatus}
          fixedVolumeEnabled={fixedVolumeEnabled || dsdAutoVolumeLocked}
          fixedVolumeAutoReason={dsdAutoVolumeLocked ? translateFallback('playerVolume.fixed.dsdAutoLocked') : null}
          isOpen={openPopover === 'volume'}
          onError={setError}
          onFixedVolumeChange={setFixedVolumeEnabled}
          onOpenChange={(isOpen) => setOpenPopover(isOpen ? 'volume' : null)}
          onStatusChange={setAudioStatus}
          onCommitVolume={isSpotifyCurrentTrack ? setSpotifyVolume : undefined}
        />
        {!isSpotifyCurrentTrack ? (
          <PlayerSpeedControl
            status={audioStatus}
            isOpen={openPopover === 'speed'}
            onError={setError}
            onOpenChange={(isOpen) => setOpenPopover(isOpen ? 'speed' : null)}
            onStatusChange={setAudioStatus}
          />
        ) : null}
        {isCurrentStreamingTrack && streamingDownloadActionsEnabled ? (
          <button
            className="icon-button"
            type="button"
            aria-label="下载当前流媒体"
            title={
              canDownloadCurrentStreamingTrack
                ? isCurrentStreamingDownloadBusy
                  ? '正在准备或下载'
                  : '下载当前流媒体'
                : currentStreamingDownloadProvider === 'spotify'
                  ? 'Spotify 不支持下载'
                  : '当前流媒体源不支持下载'
            }
            disabled={!canDownloadCurrentStreamingTrack || isCurrentStreamingDownloadBusy}
            onClick={() => void handleDownloadCurrentStreamingTrack()}
          >
            {isStreamingDownloadResolving || streamingDownloadJobId ? (
              <Loader2 className="spinning-icon" size={17} />
            ) : (
              <Download size={17} />
            )}
          </button>
        ) : null}
        {!isCurrentStreamingTrack ? (
          <button
            className="icon-button"
            type="button"
            aria-label="导出当前文件"
            title={audioExportButtonTitle}
            disabled={!canExportCurrentAudio || isAudioExporting}
            onClick={() => void handleExportCurrentAudio()}
          >
            {isAudioExporting ? <Loader2 className="spinning-icon" size={17} /> : <FileDown size={17} />}
          </button>
        ) : null}
      </div>
    </motion.footer>
  );
};
