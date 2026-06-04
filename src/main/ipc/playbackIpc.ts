import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { SUPPORTED_AUDIO_DIALOG_EXTENSIONS } from '../../shared/constants/audioExtensions';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { normalizeAudioOutputModeForPlatform, normalizeAudioSharedBackendForPlatform } from '../../shared/utils/audioPlatformCapabilities';
import type { AudioLatencyProfile, AudioOutputMode, AudioOutputSettings, AudioSharedBackend, AudioStatus, PlaybackSpeedMode } from '../../shared/types/audio';
import type {
  LocalFileResolveResult,
  PlaybackMediaStartRequest,
  PlaybackPrepareLocalFileRequest,
  PlaybackProbeHint,
  PlaybackResolvedMediaSource,
  PlaybackStartRequest,
  PlaybackStatus,
  PlaybackTrackMetadataHint,
  PlaybackQueueSessionSaveOptions,
  PersistedPlaybackSessionV1,
} from '../../shared/types/playback';
import type { LibraryTrack } from '../../shared/types/library';
import type { AirPlayReceiverState, AirPlayReceiverStatus } from '../../shared/types/connect';
import type { PlayableTrack, RemoteLibraryTrack } from '../../shared/types/remoteSources';
import { defaultStreamingAudioQuality, streamingProviderNames, type StreamingAudioQuality, type StreamingProviderName } from '../../shared/types/streaming';
import type { HqPlayerPlaybackHandoffRequest } from '../../shared/types/hqplayer';
import type { ReplayGainTrackData } from '../../shared/utils/replayGain';
import type { AudioSessionAutomixRequest, AudioSessionGaplessRequest } from '../audio/audioTypes';
import { getAudioSession, type AudioErrorRecoveryHandler } from '../audio/AudioSession';
import { getPlaybackMemoryStore, type PlaybackMemory } from '../audio/PlaybackMemoryStore';
import { getPlaybackSessionStore, normalizePersistedPlaybackSession } from '../audio/PlaybackSessionStore';
import { getCrashReportService } from '../diagnostics/CrashReportService';
import { syncSmtcStatus } from '../integrations/smtc/SmtcStatusSync';
import { getRemoteSourceService } from '../library/remote/RemoteSourceService';
import { getAppSettings } from '../app/appSettings';
import { noteDataProtectionPlaybackActivity, setDataProtectionPlaybackStateProvider } from '../app/dataProtection';
import { resolveLocalAudioFiles } from '../app/localFileOpen';
import { getMainWindow } from '../app/windowManager';
import { getAirPlayReceiverSpikeService } from '../connect/AirPlayReceiverSpikeService';
import { getStreamingService } from '../streaming/StreamingService';
import { beginMainBackgroundTask, runPlaybackPerformanceStep, runPlaybackPerformanceStepSync } from '../diagnostics/PlaybackPerformanceDiagnostics';
import { enqueueAudioCommand, isAudioCommandTimeoutError } from './audioCommandQueue';
import { normalizePlaybackFilePath } from './playbackPath';

const outputModes = new Set<AudioOutputMode>(['shared', 'exclusive', 'asio', 'system']);
const sharedBackends = new Set<AudioSharedBackend>(['auto', 'windows', 'directsound', 'alsa']);
const latencyProfiles = new Set<AudioLatencyProfile>(['stable', 'balanced', 'lowLatency']);
const playbackSpeedModes = new Set<PlaybackSpeedMode>(['nightcore', 'daycore', 'speed']);
const streamingProviders = new Set<StreamingProviderName>(streamingProviderNames);
const preparedMediaTtlMs = 2 * 60 * 1000;
const maxExpiredUrlRecoveryAttempts = 1;
const postPlaybackTaskDelayMs = 1_500;

type PreparedMediaItem = PlaybackResolvedMediaSource;

type ActiveMediaPlayback = {
  key: string;
  request: PlaybackMediaStartRequest;
  recoveryAttempts: number;
  recoveryInFlight: boolean;
};

const preparedMediaCache = new Map<string, { expiresAt: number; prepared: PreparedMediaItem }>();
let activeMediaPlayback: ActiveMediaPlayback | null = null;
let audioErrorRecoveryRegistered = false;
let playbackStartGeneration = 0;
let postPlaybackTaskGeneration = 0;

const playbackCancellationErrorMessage = 'audio_session_run_cancelled';

const setRemotePlaybackActive = (active: boolean): void => {
  if (!active) {
    getRemoteSourceService().setPlaybackActive(false);
    return;
  }

  let lowLoadEnhanced = false;
  try {
    const settings = getAppSettings();
    lowLoadEnhanced = settings.lowLoadPlaybackModeEnabled === true && settings.lowLoadPlaybackEnhancementsEnabled === true;
  } catch {
    lowLoadEnhanced = false;
  }
  if (lowLoadEnhanced) {
    getRemoteSourceService().setPlaybackActive(true, { lowLoadEnhanced: true });
    return;
  }

  getRemoteSourceService().setPlaybackActive(true);
};

const beginPlaybackStartRun = (): number => {
  playbackStartGeneration += 1;
  return playbackStartGeneration;
};

const beginPlaybackSwitchDiagnostics = (): number => {
  postPlaybackTaskGeneration += 1;
  noteDataProtectionPlaybackActivity(true);
  return postPlaybackTaskGeneration;
};

const schedulePostPlaybackTask = (name: string, generation: number, task: () => void | Promise<void>): void => {
  setTimeout(() => {
    if (generation !== postPlaybackTaskGeneration) {
      return;
    }

    const clearBackgroundTask = beginMainBackgroundTask(`playback:${name}`);
    void Promise.resolve()
      .then(task)
      .catch((error) => {
        console.warn(`[playback] ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        clearBackgroundTask();
      });
  }, postPlaybackTaskDelayMs).unref?.();
};

const assertPlaybackStartRunCurrent = (generation: number): void => {
  if (playbackStartGeneration !== generation) {
    throw new Error(playbackCancellationErrorMessage);
  }
};

const isSupersededPlaybackRun = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);

  return message.includes(playbackCancellationErrorMessage);
};

const requireText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
};

const normalizeInputHeaders = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof headerValue === 'string' && key.trim()) {
      headers[key] = headerValue;
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
};

const optionalPositiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
};

const optionalNonNegativeNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return value;
};

const normalizeOutputSettings = (value: unknown): AudioOutputSettings | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const output: AudioOutputSettings = {};

  if (typeof input.outputMode === 'string' && outputModes.has(input.outputMode as AudioOutputMode)) {
    output.outputMode = normalizeAudioOutputModeForPlatform(input.outputMode as AudioOutputMode, process.platform);
  }

  if (typeof input.sharedBackend === 'string' && sharedBackends.has(input.sharedBackend as AudioSharedBackend)) {
    output.sharedBackend = normalizeAudioSharedBackendForPlatform(input.sharedBackend as AudioSharedBackend, process.platform);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'deviceIndex') && input.deviceIndex == null) {
    output.deviceIndex = undefined;
  } else if (typeof input.deviceIndex === 'number' && Number.isInteger(input.deviceIndex)) {
    output.deviceIndex = input.deviceIndex;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'deviceName') && input.deviceName == null) {
    output.deviceName = undefined;
  } else if (typeof input.deviceName === 'string' && input.deviceName.trim()) {
    output.deviceName = input.deviceName;
  }

  const requestedOutputSampleRate = optionalPositiveNumber(input.requestedOutputSampleRate);
  if (requestedOutputSampleRate) {
    output.requestedOutputSampleRate = Math.round(requestedOutputSampleRate);
  }

  if (typeof input.latencyProfile === 'string' && latencyProfiles.has(input.latencyProfile as AudioLatencyProfile)) {
    output.latencyProfile = input.latencyProfile as AudioLatencyProfile;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'bufferSizeFrames')) {
    const bufferSizeFrames = optionalPositiveNumber(input.bufferSizeFrames);
    output.bufferSizeFrames = bufferSizeFrames ? Math.round(bufferSizeFrames) : null;
  }

  if (typeof input.useJuceOutput === 'boolean') {
    output.useJuceOutput = input.useJuceOutput;
  }

  if (typeof input.useJuceDecode === 'boolean') {
    output.useJuceDecode = input.useJuceDecode;
  }

  if (input.dsdOutputMode === 'dop' || input.dsdOutputMode === 'pcm') {
    output.dsdOutputMode = input.dsdOutputMode;
  }

  if (typeof input.asioNativeDsdExperimentalEnabled === 'boolean') {
    output.asioNativeDsdExperimentalEnabled = input.asioNativeDsdExperimentalEnabled;
  }

  if (typeof input.asioUnavailableFallbackEnabled === 'boolean') {
    output.asioUnavailableFallbackEnabled = input.asioUnavailableFallbackEnabled;
  }

  if (typeof input.exclusiveInstabilityFallbackEnabled === 'boolean') {
    output.exclusiveInstabilityFallbackEnabled = input.exclusiveInstabilityFallbackEnabled;
  }

  if (typeof input.defaultDeviceFallbackEnabled === 'boolean') {
    output.defaultDeviceFallbackEnabled = input.defaultDeviceFallbackEnabled;
  }

  if (typeof input.soxrFallbackEnabled === 'boolean') {
    output.soxrFallbackEnabled = input.soxrFallbackEnabled;
  }

  if (typeof input.volume === 'number' && Number.isFinite(input.volume)) {
    output.volume = Math.max(0, Math.min(1, input.volume));
  }

  if (typeof input.playbackRate === 'number' && Number.isFinite(input.playbackRate)) {
    output.playbackRate = Math.max(0.5, Math.min(2, input.playbackRate));
  }

  if (typeof input.playbackSpeedMode === 'string' && playbackSpeedModes.has(input.playbackSpeedMode as PlaybackSpeedMode)) {
    output.playbackSpeedMode = input.playbackSpeedMode as PlaybackSpeedMode;
  }

  return output;
};

const optionalText = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }

  return typeof value === 'string' && value.trim() ? value : undefined;
};

const isStreamingProviderName = (value: string | null): value is StreamingProviderName =>
  Boolean(value && streamingProviders.has(value as StreamingProviderName));

const optionalStreamingQuality = (value: unknown): StreamingAudioQuality | undefined =>
  value === 'standard' || value === 'high' || value === 'lossless' || value === 'hires' ? value : undefined;

const isHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value);

const isLikelyExpiredUrlError = (error: unknown): boolean => {
  if (error && typeof error === 'object') {
    const kind = (error as { ffmpegErrorKind?: unknown }).ffmpegErrorKind;
    if (typeof kind === 'string') {
      return kind === 'http_expired_or_forbidden';
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return /kind="http_expired_or_forbidden"|\b(?:401|403|404)\b|expired|forbidden|unauthorized|server returned 4\d\d|http error\s*4\d\d/iu.test(message);
};

const isQqMusicPermissionError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /QQ\s*音乐.*(?:无播放权限|104003)|QQ\s*Music.*(?:104003|permission)/iu.test(message);
};

const normalizeMatchText = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\((?:explicit|clean|remaster(?:ed)?|album version|single version)\)/giu, ' ')
    .replace(/\[(?:explicit|clean|remaster(?:ed)?|album version|single version)\]/giu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

const artistTokens = (value: string | null | undefined): Set<string> =>
  new Set(
    normalizeMatchText(value)
      .split(' ')
      .filter((token) => token.length >= 2),
  );

const hasArtistOverlap = (left: string | null | undefined, right: string | null | undefined): boolean => {
  const leftTokens = artistTokens(left);
  const rightTokens = artistTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return false;
  }

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      return true;
    }
  }

  return false;
};

const durationMatches = (left: number | null | undefined, right: number | null | undefined): boolean => {
  if (!left || !right) {
    return true;
  }

  return Math.abs(left - right) <= 8;
};

const findLocalFallbackForStreamingItem = async (item: Extract<PlayableTrack, { mediaType: 'streaming' }>): Promise<LibraryTrack | null> => {
  if (!item.title || !item.artist) {
    return null;
  }

  try {
    const { getLibraryService } = await import('../library/LibraryService');
    const localCandidates = getLibraryService().getTracks({
      page: 1,
      pageSize: 25,
      search: `${item.title} ${item.artist}`,
      sourceProvider: 'local',
    }).items;
    const targetTitle = normalizeMatchText(item.title);

    return (
      localCandidates.find((candidate) => {
        if (candidate.mediaType !== 'local') {
          return false;
        }

        const candidateTitle = normalizeMatchText(candidate.title);
        const titleMatches =
          candidateTitle === targetTitle ||
          candidateTitle.includes(targetTitle) ||
          targetTitle.includes(candidateTitle);

        return titleMatches && hasArtistOverlap(candidate.artist, item.artist) && durationMatches(candidate.duration, item.duration);
      }) ?? null
    );
  } catch (error) {
    console.warn(`[playback] QQ Music local fallback lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};

const createPreparedMediaKey = (request: PlaybackMediaStartRequest): string => {
  const item = request.item;
  if (item.mediaType === 'remote') {
    return JSON.stringify({
      mediaType: item.mediaType,
      trackId: item.trackId,
      sourceId: item.sourceId,
      stableKey: item.stableKey,
      remotePath: item.remotePath,
    });
  }

  if (item.mediaType === 'streaming') {
    return JSON.stringify({
      mediaType: item.mediaType,
      provider: item.provider,
      providerTrackId: item.providerTrackId,
      quality: item.quality,
      stableKey: item.stableKey,
    });
  }

  return JSON.stringify({ mediaType: item.mediaType, trackId: item.trackId, path: item.path });
};

const setActiveMediaPlayback = (request: PlaybackMediaStartRequest): void => {
  if (request.item.mediaType !== 'remote' && request.item.mediaType !== 'streaming') {
    activeMediaPlayback = null;
    return;
  }

  activeMediaPlayback = {
    key: createPreparedMediaKey(request),
    request,
    recoveryAttempts: 0,
    recoveryInFlight: false,
  };
};

const clearActiveMediaPlayback = (): void => {
  activeMediaPlayback = null;
};

const normalizeProbeHint = (value: unknown): PlaybackProbeHint | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const output: PlaybackProbeHint = {};
  const durationSeconds = optionalNonNegativeNumber(input.durationSeconds);
  const fileSampleRate = input.fileSampleRate === null ? null : optionalPositiveNumber(input.fileSampleRate);
  const channels = optionalPositiveNumber(input.channels);
  const bitDepth = input.bitDepth === null ? null : optionalPositiveNumber(input.bitDepth);
  const bitrate = input.bitrate === null ? null : optionalPositiveNumber(input.bitrate);
  const bpm = input.bpm === null ? null : optionalPositiveNumber(input.bpm);
  const bpmConfidence = input.bpmConfidence === null ? null : optionalNonNegativeNumber(input.bpmConfidence);
  const beatOffsetMs = input.beatOffsetMs === null ? null : optionalNonNegativeNumber(input.beatOffsetMs);
  const codec = optionalText(input.codec);

  if (durationSeconds !== undefined) {
    output.durationSeconds = durationSeconds;
  }

  if (fileSampleRate !== undefined) {
    output.fileSampleRate = fileSampleRate === null ? null : Math.round(fileSampleRate);
  }

  if (channels !== undefined) {
    output.channels = Math.max(1, Math.min(8, Math.round(channels)));
  }

  if (codec !== undefined) {
    output.codec = codec;
  }

  if (bitDepth !== undefined) {
    output.bitDepth = bitDepth === null ? null : Math.round(bitDepth);
  }

  if (bitrate !== undefined) {
    output.bitrate = bitrate === null ? null : Math.round(bitrate);
  }

  if (bpm !== undefined) {
    output.bpm = bpm === null ? null : bpm;
  }

  if (bpmConfidence !== undefined) {
    output.bpmConfidence = bpmConfidence === null ? null : Math.min(1, bpmConfidence);
  }

  if (beatOffsetMs !== undefined) {
    output.beatOffsetMs = beatOffsetMs === null ? null : Math.round(beatOffsetMs);
  }

  return Object.keys(output).length > 0 ? output : undefined;
};

const normalizeMediaTechnicalFields = (input: Record<string, unknown>) => {
  const sampleRate = input.sampleRate === null ? null : optionalPositiveNumber(input.sampleRate);
  const bitDepth = input.bitDepth === null ? null : optionalPositiveNumber(input.bitDepth);
  const bitrate = input.bitrate === null ? null : optionalPositiveNumber(input.bitrate);
  const codec = input.codec === null ? null : optionalText(input.codec);

  return {
    codec: codec === undefined ? undefined : codec,
    sampleRate: sampleRate === undefined ? undefined : sampleRate === null ? null : Math.round(sampleRate),
    bitDepth: bitDepth === undefined ? undefined : bitDepth === null ? null : Math.round(bitDepth),
    bitrate: bitrate === undefined ? undefined : bitrate === null ? null : Math.round(bitrate),
  };
};

const optionalFiniteNumberOrNull = (value: unknown): number | null | undefined => {
  if (value === null) {
    return null;
  }
  if (value === undefined || value === '') {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const normalizeReplayGainTrackData = (value: unknown): ReplayGainTrackData | null | undefined => {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const output: ReplayGainTrackData = {};
  const trackGainDb = optionalFiniteNumberOrNull(input.trackGainDb);
  const albumGainDb = optionalFiniteNumberOrNull(input.albumGainDb);
  const trackPeak = optionalFiniteNumberOrNull(input.trackPeak);
  const albumPeak = optionalFiniteNumberOrNull(input.albumPeak);
  const integratedLufs = optionalFiniteNumberOrNull(input.integratedLufs);
  if (trackGainDb !== undefined) output.trackGainDb = trackGainDb;
  if (albumGainDb !== undefined) output.albumGainDb = albumGainDb;
  if (trackPeak !== undefined) output.trackPeak = trackPeak;
  if (albumPeak !== undefined) output.albumPeak = albumPeak;
  if (integratedLufs !== undefined) output.integratedLufs = integratedLufs;
  return Object.keys(output).length > 0 ? output : null;
};

const normalizeTrackMetadataHint = (value: unknown): PlaybackTrackMetadataHint | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const output: PlaybackTrackMetadataHint = {};
  const title = optionalText(input.title);
  const artist = optionalText(input.artist);
  const album = optionalText(input.album);
  const albumArtist = optionalText(input.albumArtist);
  const coverUrl = optionalText(input.coverUrl);
  if (title !== undefined) output.title = title;
  if (artist !== undefined) output.artist = artist;
  if (album !== undefined) output.album = album;
  if (albumArtist !== undefined) output.albumArtist = albumArtist;
  if (coverUrl !== undefined) output.coverUrl = coverUrl;
  return Object.keys(output).length > 0 ? output : undefined;
};

const normalizePlayRequest = (value: unknown): PlaybackStartRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('playback request must be an object');
  }

  const input = value as Record<string, unknown>;

  return {
    filePath: normalizePlaybackFilePath(requireText(input.filePath, 'filePath')),
    trackId: typeof input.trackId === 'string' && input.trackId.trim() ? input.trackId : undefined,
    metadata: normalizeTrackMetadataHint(input.metadata),
    startSeconds: optionalNonNegativeNumber(input.startSeconds),
    output: normalizeOutputSettings(input.output),
    probe: normalizeProbeHint(input.probe),
    replayGain: normalizeReplayGainTrackData(input.replayGain),
    automix: normalizeAutomixOptions(input.automix),
    gapless: normalizeGaplessOptions(input.gapless),
    automixAnalyze: input.automixAnalyze === true,
  };
};

const normalizePrepareLocalFileRequest = (value: unknown): PlaybackPrepareLocalFileRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('prepare local file request must be an object');
  }

  const input = value as Record<string, unknown>;

  return {
    filePath: normalizePlaybackFilePath(requireText(input.filePath, 'filePath')),
    inputHeaders: normalizeInputHeaders(input.inputHeaders),
    trackId: typeof input.trackId === 'string' && input.trackId.trim() ? input.trackId : undefined,
    probe: normalizeProbeHint(input.probe),
    replayGain: normalizeReplayGainTrackData(input.replayGain),
    automixAnalyze: input.automixAnalyze === true,
  };
};

const normalizeMediaItem = (value: unknown): PlayableTrack => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('media item must be an object');
  }

  const input = value as Record<string, unknown>;
  const mediaType = input.mediaType === 'remote' || input.mediaType === 'streaming' ? input.mediaType : 'local';
  const provider = optionalText(input.provider) ?? null;
  const base = {
    trackId: requireText(input.trackId, 'trackId'),
    title: typeof input.title === 'string' ? input.title : '',
    artist: typeof input.artist === 'string' ? input.artist : '',
    album: typeof input.album === 'string' ? input.album : '',
    albumArtist: typeof input.albumArtist === 'string' ? input.albumArtist : null,
    duration: typeof input.duration === 'number' && Number.isFinite(input.duration) ? input.duration : null,
    coverThumb: optionalText(input.coverThumb) ?? null,
    replayGain: normalizeReplayGainTrackData(input.replayGain) ?? null,
  };

  if (mediaType === 'remote') {
    const technical = normalizeMediaTechnicalFields(input);
    return {
      ...base,
      mediaType,
      sourceId: optionalText(input.sourceId) ?? null,
      stableKey: optionalText(input.stableKey) ?? null,
      remotePath: optionalText(input.remotePath) ?? null,
      ...technical,
    };
  }

  if (mediaType === 'streaming') {
    if (!isStreamingProviderName(provider)) {
      throw new Error('streaming provider is required for playback');
    }

    return {
      ...base,
      mediaType,
      provider,
      providerTrackId: requireText(input.providerTrackId, 'providerTrackId'),
      quality: optionalStreamingQuality(input.quality) ?? defaultStreamingAudioQuality,
      stableKey: requireText(input.stableKey, 'stableKey'),
      playable: input.playable !== false,
      unavailableReason: optionalText(input.unavailableReason) ?? null,
    };
  }

  return {
    ...base,
    mediaType: 'local',
    path: normalizePlaybackFilePath(requireText(input.path, 'path')),
  };
};

const normalizeMediaPlayRequest = (value: unknown): PlaybackMediaStartRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('playback media request must be an object');
  }

  const input = value as Record<string, unknown>;
  return {
    item: normalizeMediaItem(input.item),
    startSeconds: optionalNonNegativeNumber(input.startSeconds),
    output: normalizeOutputSettings(input.output),
    automix: normalizeAutomixOptions(input.automix),
    gapless: normalizeGaplessOptions(input.gapless),
    automixAnalyze: input.automixAnalyze === true,
    forceRefresh: input.forceRefresh === true,
  };
};

const normalizeAutomixOptions = (value: unknown): PlaybackStartRequest['automix'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const enabled = input.enabled === true;
  const maxTransitionSeconds = optionalPositiveNumber(input.maxTransitionSeconds);
  return {
    enabled,
    maxTransitionSeconds: maxTransitionSeconds === undefined ? undefined : Math.max(2, Math.min(16, maxTransitionSeconds)),
    beatAlignEnabled: input.beatAlignEnabled !== false,
    nextItem: input.nextItem ? normalizeMediaItem(input.nextItem) : null,
    nextProbe: normalizeProbeHint(input.nextProbe),
    upcomingItems: Array.isArray(input.upcomingItems) ? input.upcomingItems.slice(0, 3).map(normalizeMediaItem) : [],
    upcomingProbes: Array.isArray(input.upcomingProbes)
      ? input.upcomingProbes
          .slice(0, 3)
          .map(normalizeProbeHint)
          .filter((probe): probe is NonNullable<ReturnType<typeof normalizeProbeHint>> => Boolean(probe))
      : [],
  };
};

const normalizeGaplessOptions = (value: unknown): PlaybackStartRequest['gapless'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  return {
    enabled: input.enabled === true,
    nextItem: input.nextItem ? normalizeMediaItem(input.nextItem) : null,
    nextProbe: normalizeProbeHint(input.nextProbe),
  };
};

const resolveMediaItemForPlayback = async (
  request: PlaybackMediaStartRequest,
  options: { forceRefresh?: boolean } = {},
): Promise<PreparedMediaItem> => {
  const key = createPreparedMediaKey(request);
  const cached = preparedMediaCache.get(key);
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true || request.forceRefresh === true;
  if (!forceRefresh && cached && cached.expiresAt > now) {
    preparedMediaCache.delete(key);
    return cached.prepared;
  }

  if (cached && (forceRefresh || cached.expiresAt <= now)) {
    preparedMediaCache.delete(key);
  }

  const item = request.item;
  let durationSeconds = item.duration && item.duration > 0 ? item.duration : null;
  let refreshedRemoteTrack: RemoteLibraryTrack | null = null;
  if (item.mediaType === 'remote' && !durationSeconds) {
    setRemotePlaybackActive(true);
    refreshedRemoteTrack = await getRemoteSourceService().refreshTrackMetadata(item.trackId);
    durationSeconds =
      refreshedRemoteTrack?.duration && refreshedRemoteTrack.duration > 0 ? refreshedRemoteTrack.duration : null;
  }

  let filePath: string;
  let probe: PlaybackProbeHint | undefined = createProbeHintForMediaItem(
    item,
    durationSeconds ? { durationSeconds } : undefined,
  );
  if (item.mediaType === 'remote' && refreshedRemoteTrack) {
    probe = {
      ...(probe ?? {}),
      fileSampleRate: probe?.fileSampleRate ?? refreshedRemoteTrack.sampleRate,
      codec: probe?.codec ?? refreshedRemoteTrack.codec,
      bitDepth: probe?.bitDepth ?? refreshedRemoteTrack.bitDepth,
      bitrate: probe?.bitrate ?? refreshedRemoteTrack.bitrate,
    };
  }

  if (item.mediaType === 'remote') {
    filePath = (
      await getRemoteSourceService().createStreamUrl({
        trackId: item.trackId,
        sourceId: item.sourceId ?? undefined,
        remotePath: item.remotePath ?? undefined,
        stableKey: item.stableKey ?? undefined,
      })
    ).url;
  } else if (item.mediaType === 'streaming') {
    if (item.provider === 'spotify') {
      throw new Error('Spotify playback uses the official Web Playback SDK and must not enter the native audio session.');
    }

    const playbackRequest = {
      provider: item.provider,
      providerTrackId: item.providerTrackId,
      quality: item.quality,
    };

    if (forceRefresh) {
      getStreamingService().invalidatePlayback(playbackRequest);
    }

    let source;
    try {
      source = await getStreamingService().resolvePlayback(playbackRequest);
    } catch (error) {
      if (item.provider !== 'qqmusic' || !isQqMusicPermissionError(error)) {
        throw error;
      }

      const fallback = await findLocalFallbackForStreamingItem(item);
      if (!fallback || fallback.mediaType !== 'local') {
        throw error;
      }

      return {
        filePath: fallback.path,
        probe: {
          durationSeconds: fallback.duration || durationSeconds || undefined,
          fileSampleRate: fallback.sampleRate,
          channels: 2,
          codec: fallback.codec,
          bitDepth: fallback.bitDepth,
          bitrate: fallback.bitrate,
        },
        mimeType: null,
        durationSeconds: fallback.duration || durationSeconds,
      };
    }

    if (source.requiresProxy) {
      throw new Error('This streaming source requires the streaming proxy adapter, which is not enabled yet.');
    }

    filePath = source.url;
    probe =
      durationSeconds || isHttpUrl(source.url)
        ? {
            durationSeconds: durationSeconds ?? undefined,
            fileSampleRate: source.sampleRate,
            channels: 2,
            codec: source.codec,
            bitDepth: source.bitDepth,
            bitrate: source.bitrate,
          }
        : undefined;
    return { filePath, inputHeaders: source.headers, mimeType: source.mimeType ?? null, probe, durationSeconds };
  } else {
    filePath = item.path;
  }

  return { filePath, mimeType: null, probe, durationSeconds };
};

const prepareMediaItem = async (request: PlaybackMediaStartRequest): Promise<void> => {
  const key = createPreparedMediaKey(request);
  const prepared = await resolveMediaItemForPlayback(request, { forceRefresh: true });
  preparedMediaCache.set(key, {
    prepared,
    expiresAt: Date.now() + preparedMediaTtlMs,
  });
  if (request.automixAnalyze === true) {
    const audioSession = getAudioSession() as { prepareLocalFile?: (request: PlaybackPrepareLocalFileRequest) => Promise<void> };
    void audioSession.prepareLocalFile?.({
      filePath: prepared.filePath,
      inputHeaders: prepared.inputHeaders,
      trackId: request.item.trackId,
      probe: createProbeHintForMediaItem(request.item, prepared.probe),
      replayGain: createReplayGainHintForMediaItem(request.item),
      automixAnalyze: true,
    }).catch((error) => {
      console.warn(`[playback] prepareMediaItem Automix analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
};

const createProbeHintForMediaItem = (item: PlayableTrack, hint?: PlaybackProbeHint): PlaybackProbeHint | undefined => {
  const probe: PlaybackProbeHint = {
    ...hint,
  };
  const technical = item as Partial<{
    sampleRate: number | null;
    codec: string | null;
    bitDepth: number | null;
    bitrate: number | null;
  }>;

  if (probe.durationSeconds === undefined && typeof item.duration === 'number' && Number.isFinite(item.duration)) {
    probe.durationSeconds = item.duration;
  }

  if (probe.fileSampleRate === undefined && technical.sampleRate !== undefined) {
    probe.fileSampleRate = technical.sampleRate;
  }

  if (probe.codec === undefined && technical.codec !== undefined) {
    probe.codec = technical.codec;
  }

  if (probe.bitDepth === undefined && technical.bitDepth !== undefined) {
    probe.bitDepth = technical.bitDepth;
  }

  if (probe.bitrate === undefined && technical.bitrate !== undefined) {
    probe.bitrate = technical.bitrate;
  }

  return Object.keys(probe).length > 0 ? probe : undefined;
};

const createReplayGainHintForMediaItem = (item: PlayableTrack) => {
  if (item.replayGain) {
    return item.replayGain;
  }

  const replayGain = item as Partial<{
    replayGainTrackGainDb: number | null;
    replayGainAlbumGainDb: number | null;
    replayGainTrackPeak: number | null;
    replayGainAlbumPeak: number | null;
    replayGainIntegratedLufs: number | null;
  }>;
  return {
    trackGainDb: replayGain.replayGainTrackGainDb ?? null,
    albumGainDb: replayGain.replayGainAlbumGainDb ?? null,
    trackPeak: replayGain.replayGainTrackPeak ?? null,
    albumPeak: replayGain.replayGainAlbumPeak ?? null,
    integratedLufs: replayGain.replayGainIntegratedLufs ?? null,
  };
};

const hasReplayGainHint = (item: PlayableTrack): boolean => {
  if (
    Number.isFinite(item.replayGain?.trackGainDb) ||
    Number.isFinite(item.replayGain?.albumGainDb) ||
    Number.isFinite(item.replayGain?.integratedLufs)
  ) {
    return true;
  }

  const replayGain = item as Partial<{
    replayGainTrackGainDb: number | null;
    replayGainAlbumGainDb: number | null;
    replayGainIntegratedLufs: number | null;
  }>;
  return (
    Number.isFinite(replayGain.replayGainTrackGainDb) ||
    Number.isFinite(replayGain.replayGainAlbumGainDb) ||
    Number.isFinite(replayGain.replayGainIntegratedLufs)
  );
};

const titleFromPlaybackPath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/gu, '/');
  const name = normalized.split('/').filter(Boolean).pop();
  return name || filePath || 'Unknown';
};

const runHqPlayerPlaybackPreflight = (request: HqPlayerPlaybackHandoffRequest): void => {
  void import('../integrations/hqplayer/HqPlayerService')
    .then(({ getHqPlayerService }) => getHqPlayerService().createPlaybackHandoff(request))
    .catch(() => undefined);
};

const preflightHqPlayerLocalFile = (request: PlaybackStartRequest): void => {
  runHqPlayerPlaybackPreflight({
    item: {
      mediaType: 'local',
      trackId: request.trackId ?? request.filePath,
      path: request.filePath,
      title: titleFromPlaybackPath(request.filePath),
      artist: '',
      album: '',
      duration: request.probe?.durationSeconds ?? null,
    },
    startSeconds: request.startSeconds,
    resolvedSource: {
      filePath: request.filePath,
      inputHeaders: undefined,
      mimeType: null,
      durationSeconds: request.probe?.durationSeconds ?? null,
      probe: request.probe,
    },
  });
};

const preflightHqPlayerMediaItem = (request: PlaybackMediaStartRequest, prepared: PreparedMediaItem): void => {
  runHqPlayerPlaybackPreflight({
    item: request.item,
    startSeconds: request.startSeconds,
    forceRefresh: request.forceRefresh,
    resolvedSource: {
      filePath: prepared.filePath,
      inputHeaders: prepared.inputHeaders,
      mimeType: prepared.mimeType,
      durationSeconds: prepared.durationSeconds,
      probe: prepared.probe,
    },
  });
};

const scheduleReplayGainAnalysisForPlayback = (trackId: string | null | undefined, item?: PlayableTrack): void => {
  if (!trackId || item?.mediaType === 'streaming' || item?.mediaType === 'remote' || (item && hasReplayGainHint(item))) {
    return;
  }

  try {
    const settings = getAppSettings();
    if (settings.replayGainAnalyzeOnPlay === false || settings.lowLoadPlaybackModeEnabled === true) {
      return;
    }
    void import('../library/LibraryService').then(({ getLibraryService }) => {
      getLibraryService().startReplayGainAnalysis({ trackIds: [trackId], limit: 1, force: false });
    }).catch((error) => {
      console.warn(`[playback] ReplayGain on-play analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  } catch (error) {
    console.warn(`[playback] ReplayGain on-play analysis skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const resolveAutomixRequest = async (
  automix: PlaybackStartRequest['automix'] | undefined,
): Promise<AudioSessionAutomixRequest | undefined> => {
  if (automix?.enabled !== true || !automix.nextItem) {
    return automix?.enabled === true
      ? {
          enabled: true,
          maxTransitionSeconds: automix.maxTransitionSeconds,
          beatAlignEnabled: automix.beatAlignEnabled,
          next: null,
        }
      : undefined;
  }

  if (automix.nextItem.mediaType === 'streaming' && automix.nextItem.provider === 'spotify') {
    return {
      enabled: true,
      maxTransitionSeconds: automix.maxTransitionSeconds,
      beatAlignEnabled: automix.beatAlignEnabled,
      next: null,
    };
  }

  const prepared = await resolveMediaItemForPlayback({ item: automix.nextItem });
  const nextProbe = createProbeHintForMediaItem(automix.nextItem, {
    ...automix.nextProbe,
    ...prepared.probe,
  });
  const following = await Promise.all(
    (automix.upcomingItems ?? [])
      .filter((item) => !(item.mediaType === 'streaming' && item.provider === 'spotify'))
      .slice(0, 2)
      .map(async (item, index) => {
        const preparedItem = await resolveMediaItemForPlayback({ item });
        return {
          filePath: preparedItem.filePath,
          inputHeaders: preparedItem.inputHeaders,
          trackId: item.trackId,
          replayGain: createReplayGainHintForMediaItem(item),
          probe: createProbeHintForMediaItem(item, {
            ...(automix.upcomingProbes?.[index] ?? {}),
            ...preparedItem.probe,
          }),
        };
      }),
  );
  return {
    enabled: true,
    maxTransitionSeconds: automix.maxTransitionSeconds,
    beatAlignEnabled: automix.beatAlignEnabled,
    next: {
      filePath: prepared.filePath,
      inputHeaders: prepared.inputHeaders,
      trackId: automix.nextItem.trackId,
      replayGain: createReplayGainHintForMediaItem(automix.nextItem),
      probe: nextProbe,
    },
    following,
  };
};

const resolveGaplessRequest = async (
  gapless: PlaybackStartRequest['gapless'] | undefined,
): Promise<AudioSessionGaplessRequest | undefined> => {
  if (gapless?.enabled !== true || !gapless.nextItem) {
    return gapless?.enabled === true ? { enabled: true, next: null } : undefined;
  }

  if (gapless.nextItem.mediaType === 'streaming' && gapless.nextItem.provider === 'spotify') {
    return { enabled: true, next: null };
  }

  const prepared = await resolveMediaItemForPlayback({ item: gapless.nextItem });
  return {
    enabled: true,
    next: {
      filePath: prepared.filePath,
      inputHeaders: prepared.inputHeaders,
      trackId: gapless.nextItem.trackId,
      replayGain: createReplayGainHintForMediaItem(gapless.nextItem),
      probe: createProbeHintForMediaItem(gapless.nextItem, {
        ...gapless.nextProbe,
        ...prepared.probe,
      }),
    },
    following: [],
  };
};

const normalizePathList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    throw new Error('paths must be an array');
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(normalizePlaybackFilePath);
};

const showOpenLocalAudioFiles = async (properties: Electron.OpenDialogOptions['properties']): Promise<string[] | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Open local audio file',
    properties,
    filters: [
      {
        name: 'Audio files',
        extensions: SUPPORTED_AUDIO_DIALOG_EXTENSIONS,
      },
    ],
  });

  return result.canceled ? null : result.filePaths;
};

const toPlaybackStatus = (): PlaybackStatus => {
  const status = getAudioSession().getStatus();

  return {
    state: status.state,
    currentTrackId: status.currentTrackId,
    positionMs: Math.round(status.positionSeconds * 1000),
    durationMs: Math.round(status.durationSeconds * 1000),
    filePath: status.currentFilePath,
  };
};

const receiverStateToPlaybackState = (state: AirPlayReceiverState): PlaybackStatus['state'] => {
  switch (state) {
    case 'playing':
    case 'paused':
    case 'stopped':
    case 'error':
      return state;
    case 'ready':
      return 'stopped';
    default:
      return 'idle';
  }
};

const airPlayReceiverStatusToPlaybackStatus = (status: AirPlayReceiverStatus): PlaybackStatus => ({
  state: receiverStateToPlaybackState(status.state),
  currentTrackId: status.currentSourceId,
  positionMs: Math.round(status.positionSeconds * 1000),
  durationMs: Math.round(status.durationSeconds * 1000),
  filePath: status.currentSourceId,
});

const isAirPlayReceiverSourceId = (value: string | null | undefined): boolean => Boolean(value?.startsWith('airplay-receiver:'));

const getActiveAirPlayReceiverService = (): ReturnType<typeof getAirPlayReceiverSpikeService> | null => {
  const audioStatus = getAudioSession().getStatus();
  if (!isAirPlayReceiverSourceId(audioStatus.currentFilePath) && !isAirPlayReceiverSourceId(audioStatus.currentTrackId)) {
    return null;
  }
  const service = getAirPlayReceiverSpikeService();
  return service.isCurrentSource(audioStatus.currentFilePath) || service.isCurrentSource(audioStatus.currentTrackId) ? service : null;
};

const enqueuePlaybackStatusCommand = async (fn: () => Promise<PlaybackStatus> | PlaybackStatus): Promise<PlaybackStatus> => {
  try {
    return await enqueueAudioCommand(fn);
  } catch (error) {
    if (isAudioCommandTimeoutError(error)) {
      console.warn('[playback] audio command timed out; returning current playback status');
      return toPlaybackStatus();
    }

    throw error;
  }
};

const runImmediatePlaybackStatusCommand = async (fn: () => Promise<PlaybackStatus> | PlaybackStatus): Promise<PlaybackStatus> => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise<PlaybackStatus>((resolve) => {
        timeout = setTimeout(() => {
          console.warn('[playback] immediate audio command timed out; returning current playback status');
          resolve(toPlaybackStatus());
        }, 15_000);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const reportPlaybackAudioError = (error: unknown, phase: string, details?: unknown): void => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const status = getAudioSession().getStatus();

  if (status.error === normalized.message) {
    return;
  }

  getCrashReportService().reportAudioError({
    message: normalized.message,
    stack: normalized.stack,
    phase,
    severity: 'fatal',
    details,
    audioStatus: status,
  });
};

const reportPlaybackAudioRecovery = (error: unknown, phase: string, details?: unknown): void => {
  const normalized = error instanceof Error ? error : new Error(String(error));

  getCrashReportService().reportAudioError({
    message: normalized.message,
    stack: normalized.stack,
    phase,
    severity: 'recoverable',
    recovered: true,
    details,
    audioStatus: getAudioSession().getStatus(),
  });
};

const clampRecoveryPositionSeconds = (status: AudioStatus): number => {
  const positionSeconds = Number.isFinite(status.positionSeconds) ? Math.max(0, status.positionSeconds) : 0;
  const durationSeconds = Number.isFinite(status.durationSeconds) && status.durationSeconds > 0 ? status.durationSeconds : Number.POSITIVE_INFINITY;

  return Math.min(positionSeconds, durationSeconds);
};

const recoverActiveMediaPlaybackFromExpiredUrl = async (
  active: ActiveMediaPlayback,
  error: Error,
  status: AudioStatus,
): Promise<void> => {
  const { key, request } = active;
  const postTaskGeneration = beginPlaybackSwitchDiagnostics();
  const perfDetails = { trackId: request.item.trackId, outputMode: request.output?.outputMode ?? null };
  let playbackStartAttempted = false;

  try {
    preparedMediaCache.delete(key);
    const prepared = await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'resolve target', perfDetails, () =>
      resolveMediaItemForPlayback(request, { forceRefresh: true }),
    );
    if (activeMediaPlayback !== active || activeMediaPlayback.key !== key) {
      return;
    }

    const startSeconds = clampRecoveryPositionSeconds(status);
    preflightHqPlayerMediaItem({ ...request, startSeconds, forceRefresh: true }, prepared);
    playbackStartAttempted = true;
    const gapless = await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'resolve gapless', perfDetails, () =>
      resolveGaplessRequest(request.gapless),
    );
    await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'playback.playLocalFile IPC', perfDetails, () => getAudioSession().playLocalFile({
      filePath: prepared.filePath,
      inputHeaders: prepared.inputHeaders,
      trackId: request.item.trackId,
      replayGain: createReplayGainHintForMediaItem(request.item),
      startSeconds,
      output: request.output,
      probe: prepared.probe,
      gapless,
    }));
    schedulePostPlaybackTask('ReplayGain schedule', postTaskGeneration, () => {
      scheduleReplayGainAnalysisForPlayback(request.item.trackId, request.item);
    });
    schedulePostPlaybackTask('savePlaybackMemoryNow', postTaskGeneration, () => {
      savePlaybackMemoryNow();
    });
    const recoveredStatus = toPlaybackStatus();
    setRemotePlaybackActive(true);
    if (request.item.mediaType === 'remote' && recoveredStatus.durationMs > 0) {
      schedulePostPlaybackTask('remote duration backfill', postTaskGeneration, () => {
        getRemoteSourceService().backfillDuration(request.item.trackId, recoveredStatus.durationMs / 1000);
      });
    }
    void syncSmtcStatus();
    reportPlaybackAudioRecovery(error, 'play-media-item-expired-url-retry', {
      recovered: true,
      mediaType: request.item.mediaType,
      trackId: request.item.trackId,
      provider: request.item.mediaType === 'streaming' ? request.item.provider : undefined,
      providerTrackId: request.item.mediaType === 'streaming' ? request.item.providerTrackId : undefined,
      startSeconds,
      attempt: active.recoveryAttempts,
    });
  } catch (retryError) {
    if (!playbackStartAttempted && !isSupersededPlaybackRun(retryError)) {
      clearActiveMediaPlayback();
      reportPlaybackAudioError(retryError, 'play-media-item-expired-url-refresh', {
        request,
        originalError: error.message,
      });
      getAudioSession().stop();
    }
  } finally {
    if (activeMediaPlayback === active && activeMediaPlayback.key === key) {
      activeMediaPlayback.recoveryInFlight = false;
    }
  }
};

const beginActiveMediaExpiredUrlRecovery: AudioErrorRecoveryHandler = (error, status) => {
  const active = activeMediaPlayback;
  if (!active || active.recoveryInFlight || active.recoveryAttempts >= maxExpiredUrlRecoveryAttempts) {
    return false;
  }

  if ((active.request.item.mediaType !== 'streaming' && active.request.item.mediaType !== 'remote') || !isLikelyExpiredUrlError(error)) {
    return false;
  }

  active.recoveryAttempts += 1;
  active.recoveryInFlight = true;
  void recoverActiveMediaPlaybackFromExpiredUrl(active, error, status);
  return true;
};

const registerExpiredUrlRecovery = (): void => {
  if (audioErrorRecoveryRegistered) {
    return;
  }

  audioErrorRecoveryRegistered = true;
  const session = getAudioSession() as ReturnType<typeof getAudioSession> & {
    setAudioErrorRecoveryHandler?: (handler: AudioErrorRecoveryHandler | null) => void;
  };
  session.setAudioErrorRecoveryHandler?.(beginActiveMediaExpiredUrlRecovery);
};

let playbackMemoryRegistered = false;
let lastPlaybackMemorySaveAt = 0;
const playbackMemorySaveIntervalMs = 5000;

const playbackMetadataFromTrack = (track: LibraryTrack): PlaybackTrackMetadataHint => ({
  title: track.title,
  artist: track.artist,
  album: track.album,
  albumArtist: track.albumArtist,
  coverUrl: track.coverThumb,
});

const playbackMemoryFromQueueSession = (session: PersistedPlaybackSessionV1 | null): PlaybackMemory | null => {
  const resume = session?.resume;
  if (!resume) {
    return null;
  }

  const resumeItem = session.items.find((item) =>
    (resume.queueId && item.queueId === resume.queueId) ||
    (resume.trackId && item.track.id === resume.trackId) ||
    item.track.path === resume.filePath,
  );

  if (resumeItem?.track.mediaType === 'remote' || isRemoteStreamProxyUrl(resume.filePath)) {
    return null;
  }

  return {
    filePath: resume.filePath,
    trackId: resume.trackId,
    positionSeconds: Math.max(0, resume.positionMs / 1000),
    durationSeconds: Math.max(0, resume.durationMs / 1000),
    probe: resumeItem
      ? {
          durationSeconds: Math.max(0, resumeItem.track.duration),
          fileSampleRate: resumeItem.track.sampleRate,
          channels: undefined,
          codec: resumeItem.track.codec,
          bitDepth: resumeItem.track.bitDepth,
          bitrate: resumeItem.track.bitrate,
        }
      : undefined,
    metadata: resumeItem ? playbackMetadataFromTrack(resumeItem.track) : undefined,
    updatedAt: resume.updatedAt,
  };
};

const isRemoteStreamProxyUrl = (filePath: string): boolean => {
  try {
    const url = new URL(filePath);
    const hostname = url.hostname.toLowerCase();
    const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
    return isLoopback && url.pathname.includes('/remote-stream/');
  } catch {
    return false;
  }
};

const shouldDeferQueueResumeToRenderer = (session: PersistedPlaybackSessionV1 | null): boolean => {
  const resume = session?.resume;
  if (!resume) {
    return false;
  }

  if (isRemoteStreamProxyUrl(resume.filePath)) {
    return true;
  }

  return session.items.some((item) =>
    item.track.mediaType === 'remote' &&
    ((resume.queueId && item.queueId === resume.queueId) ||
      (resume.trackId && item.track.id === resume.trackId) ||
      item.track.path === resume.filePath),
  );
};

export const savePlaybackMemoryNow = (): void => {
  const status = getAudioSession().getStatus();
  getPlaybackMemoryStore().save(status);
  try {
    getPlaybackSessionStore().saveResumeFromAudioStatus(status);
  } catch (error) {
    console.warn(`[playback] Failed to persist queue resume position: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const registerPlaybackMemoryPersistence = (): void => {
  if (playbackMemoryRegistered) {
    return;
  }

  playbackMemoryRegistered = true;
  let storedQueueSession: PersistedPlaybackSessionV1 | null = null;
  try {
    storedQueueSession = getPlaybackSessionStore().load();
  } catch (error) {
    console.warn(`[playback] Failed to load persisted queue session: ${error instanceof Error ? error.message : String(error)}`);
  }
  const storedQueueMemory = playbackMemoryFromQueueSession(storedQueueSession);
  const storedMemory = storedQueueMemory ?? (shouldDeferQueueResumeToRenderer(storedQueueSession) ? null : getPlaybackMemoryStore().load());
  if (storedMemory) {
    getAudioSession().restorePlaybackMemory(storedMemory);
  }

  getAudioSession().on('status', () => {
    const now = Date.now();
    if (now - lastPlaybackMemorySaveAt < playbackMemorySaveIntervalMs) {
      return;
    }

    lastPlaybackMemorySaveAt = now;
    savePlaybackMemoryNow();
  });
};

const mainWindowPlaybackCommands = new Set(['playLocalFile', 'playMediaItem', 'play', 'pause', 'stop', 'seek']);
const mainWindowPlaybackCommandTimeoutMs = 15_000;
let mainWindowPlaybackCommandId = 0;
const pendingMainWindowPlaybackCommands = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const relayPlaybackCommandToMainWindow = (event: IpcMainInvokeEvent, rawRequest: unknown): Promise<unknown> => {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('main_window_unavailable');
  }
  if (event.sender === mainWindow.webContents) {
    throw new Error('main_window_playback_proxy_loop');
  }
  if (!isRecord(rawRequest) || typeof rawRequest.command !== 'string' || !mainWindowPlaybackCommands.has(rawRequest.command)) {
    throw new Error('unsupported_main_window_playback_command');
  }

  const args = Array.isArray(rawRequest.args) ? rawRequest.args : [];
  const id = `playback-main-window-${Date.now()}-${++mainWindowPlaybackCommandId}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMainWindowPlaybackCommands.delete(id);
      reject(new Error('main_window_playback_command_timeout'));
    }, mainWindowPlaybackCommandTimeoutMs);

    pendingMainWindowPlaybackCommands.set(id, { resolve, reject, timer });
    mainWindow.webContents.send(IpcChannels.PlaybackMainWindowCommandRequest, {
      id,
      command: rawRequest.command,
      args,
    });
  });
};

const receiveMainWindowPlaybackCommandResult = (event: IpcMainEvent, rawResult: unknown): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return;
  }
  if (!isRecord(rawResult) || typeof rawResult.id !== 'string') {
    return;
  }

  const pending = pendingMainWindowPlaybackCommands.get(rawResult.id);
  if (!pending) {
    return;
  }

  pendingMainWindowPlaybackCommands.delete(rawResult.id);
  clearTimeout(pending.timer);

  if (rawResult.ok === true) {
    pending.resolve(rawResult.value);
    return;
  }

  pending.reject(new Error(typeof rawResult.error === 'string' ? rawResult.error : 'main_window_playback_command_failed'));
};

const broadcastPlaybackQueueSessionChanged = (
  sender: Electron.WebContents | null,
  snapshot: PersistedPlaybackSessionV1 | null,
): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents === sender) {
      continue;
    }

    window.webContents.send(IpcChannels.PlaybackQueueSessionChanged, snapshot);
  }
};

const normalizeQueueSessionSaveOptions = (value: unknown): PlaybackQueueSessionSaveOptions => {
  if (!isRecord(value)) {
    return {};
  }

  return {
    broadcastSnapshot:
      value.broadcastSnapshot === null
        ? null
        : normalizePersistedPlaybackSession(value.broadcastSnapshot),
  };
};

export const registerPlaybackIpc = (): void => {
  setDataProtectionPlaybackStateProvider(() => {
    const state = getAudioSession().getStatus().state;
    return state === 'loading' || state === 'playing' || state === 'paused';
  });
  registerPlaybackMemoryPersistence();
  registerExpiredUrlRecovery();
  ipcMain.handle(IpcChannels.PlaybackMainWindowCommand, relayPlaybackCommandToMainWindow);
  ipcMain.on(IpcChannels.PlaybackMainWindowCommandResult, receiveMainWindowPlaybackCommandResult);
  ipcMain.handle(IpcChannels.PlaybackGetStatus, (): PlaybackStatus => toPlaybackStatus());
  ipcMain.handle(IpcChannels.PlaybackGetQueueSession, (): PersistedPlaybackSessionV1 | null => getPlaybackSessionStore().load());
  ipcMain.handle(IpcChannels.PlaybackSaveQueueSession, (event, snapshot: unknown, options: unknown): PersistedPlaybackSessionV1 => {
    const status = getAudioSession().getStatus();
    const saved = runPlaybackPerformanceStepSync('PlaybackSaveQueueSession', 'saveQueueSession', {
      trackId: status.currentTrackId,
      outputMode: status.outputMode,
    }, () => getPlaybackSessionStore().saveWithAudioStatus(snapshot as PersistedPlaybackSessionV1, status));
    const saveOptions = normalizeQueueSessionSaveOptions(options);
    broadcastPlaybackQueueSessionChanged(event.sender, saveOptions.broadcastSnapshot ?? saved);
    return saved;
  });
  ipcMain.handle(IpcChannels.PlaybackClearQueueSession, (event): void => {
    getPlaybackSessionStore().clear();
    broadcastPlaybackQueueSessionChanged(event.sender, null);
  });
  ipcMain.handle(IpcChannels.PlaybackPlayLocalFile, async (_event, request: unknown): Promise<PlaybackStatus> => enqueuePlaybackStatusCommand(async () => {
    const postTaskGeneration = beginPlaybackSwitchDiagnostics();
    clearActiveMediaPlayback();
    const playbackRun = beginPlaybackStartRun();
    try {
      const normalized = runPlaybackPerformanceStepSync('PlaybackPlayLocalFile', 'resolve target', {}, () => normalizePlayRequest(request));
      const perfDetails = { trackId: normalized.trackId ?? null, outputMode: normalized.output?.outputMode ?? null };
      preflightHqPlayerLocalFile(normalized);
      const automix = await runPlaybackPerformanceStep('PlaybackPlayLocalFile', 'resolve automix', perfDetails, () =>
        resolveAutomixRequest(normalized.automix),
      );
      const gapless = await runPlaybackPerformanceStep('PlaybackPlayLocalFile', 'resolve gapless', perfDetails, () =>
        resolveGaplessRequest(normalized.gapless),
      );
      await runPlaybackPerformanceStep('PlaybackPlayLocalFile', 'playback.playLocalFile IPC', perfDetails, () => getAudioSession().playLocalFile({
        ...normalized,
        automix,
        gapless,
      }));
      assertPlaybackStartRunCurrent(playbackRun);
      schedulePostPlaybackTask('ReplayGain schedule', postTaskGeneration, () => {
        scheduleReplayGainAnalysisForPlayback(normalized.trackId);
      });
      schedulePostPlaybackTask('savePlaybackMemoryNow', postTaskGeneration, () => {
        savePlaybackMemoryNow();
      });
      setRemotePlaybackActive(true);
      void syncSmtcStatus();
      return toPlaybackStatus();
    } catch (error) {
      if (isSupersededPlaybackRun(error)) {
        return toPlaybackStatus();
      }
      reportPlaybackAudioError(error, 'play-local-file-ipc', { request });
      throw error;
    }
  }));
  ipcMain.handle(IpcChannels.PlaybackResolveMediaItem, async (_event, rawRequest: unknown): Promise<PlaybackResolvedMediaSource> => {
    try {
      return await resolveMediaItemForPlayback(normalizeMediaPlayRequest(rawRequest));
    } catch (error) {
      reportPlaybackAudioError(error, 'resolve-media-item-ipc', { request: rawRequest });
      throw error;
    }
  });
  ipcMain.handle(IpcChannels.PlaybackPrepareMediaItem, async (_event, rawRequest: unknown): Promise<void> => {
    try {
      await prepareMediaItem(normalizeMediaPlayRequest(rawRequest));
    } catch (error) {
      console.warn(`[playback] prepareMediaItem failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  ipcMain.handle(IpcChannels.PlaybackPrepareLocalFile, async (_event, rawRequest: unknown): Promise<void> => {
    try {
      await getAudioSession().prepareLocalFile(normalizePrepareLocalFileRequest(rawRequest));
    } catch (error) {
      console.warn(`[playback] prepareLocalFile failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  ipcMain.handle(IpcChannels.PlaybackPlayMediaItem, async (_event, rawRequest: unknown): Promise<PlaybackStatus> => {
    const postTaskGeneration = beginPlaybackSwitchDiagnostics();
    let request: PlaybackMediaStartRequest;
    try {
      request = runPlaybackPerformanceStepSync('PlaybackPlayMediaItem', 'resolve target', {}, () => normalizeMediaPlayRequest(rawRequest));
    } catch (error) {
      reportPlaybackAudioError(error, 'play-media-item-ipc', { request: rawRequest });
      throw error;
    }

    const item = request.item;
    clearActiveMediaPlayback();
    const playbackRun = beginPlaybackStartRun();
    if (item.mediaType === 'streaming' && item.provider === 'spotify') {
      throw new Error('Spotify playback uses the official Web Playback SDK and must not enter the native audio session.');
    }

    const perfDetails = { trackId: item.trackId, outputMode: request.output?.outputMode ?? null };
    try {
      const prepared = await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'resolve target', perfDetails, () =>
        resolveMediaItemForPlayback(request),
      );
      assertPlaybackStartRunCurrent(playbackRun);
      preflightHqPlayerMediaItem(request, prepared);

      return await enqueuePlaybackStatusCommand(async () => {
        assertPlaybackStartRunCurrent(playbackRun);
        const automix = await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'resolve automix', perfDetails, () =>
          resolveAutomixRequest(request.automix),
        );
        const gapless = await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'resolve gapless', perfDetails, () =>
          resolveGaplessRequest(request.gapless),
        );
        await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'playback.playLocalFile IPC', perfDetails, () => getAudioSession().playLocalFile({
          filePath: prepared.filePath,
          inputHeaders: prepared.inputHeaders,
          trackId: item.trackId,
          metadata: {
            title: item.title,
            artist: item.artist,
            album: item.album,
            albumArtist: item.albumArtist,
            coverUrl: item.coverThumb,
          },
          replayGain: createReplayGainHintForMediaItem(item),
          startSeconds: request.startSeconds,
          output: request.output,
          probe: prepared.probe,
          automixAnalyze: request.automixAnalyze === true,
          automix,
          gapless,
        }));
        assertPlaybackStartRunCurrent(playbackRun);
        schedulePostPlaybackTask('ReplayGain schedule', postTaskGeneration, () => {
          scheduleReplayGainAnalysisForPlayback(item.trackId, item);
        });
        schedulePostPlaybackTask('savePlaybackMemoryNow', postTaskGeneration, () => {
          savePlaybackMemoryNow();
        });
        const status = toPlaybackStatus();
        if (item.mediaType === 'remote' && status.durationMs > 0) {
          schedulePostPlaybackTask('remote duration backfill', postTaskGeneration, () => {
            getRemoteSourceService().backfillDuration(item.trackId, status.durationMs / 1000);
          });
        }
        setRemotePlaybackActive(true);
        setActiveMediaPlayback(request);
        void syncSmtcStatus();
        return status;
      });
    } catch (error) {
      if (isSupersededPlaybackRun(error)) {
        return toPlaybackStatus();
      }

      if ((item.mediaType !== 'streaming' && item.mediaType !== 'remote') || !isLikelyExpiredUrlError(error)) {
        reportPlaybackAudioError(error, 'play-media-item-ipc', { request: rawRequest });
        throw error;
      }

      preparedMediaCache.delete(createPreparedMediaKey(request));
      try {
        const prepared = await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'resolve target', perfDetails, () =>
          resolveMediaItemForPlayback(request, { forceRefresh: true }),
        );
        assertPlaybackStartRunCurrent(playbackRun);
        preflightHqPlayerMediaItem(request, prepared);
        return await enqueuePlaybackStatusCommand(async () => {
          assertPlaybackStartRunCurrent(playbackRun);
          const automix = await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'resolve automix', perfDetails, () =>
            resolveAutomixRequest(request.automix),
          );
          const gapless = await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'resolve gapless', perfDetails, () =>
            resolveGaplessRequest(request.gapless),
          );
          await runPlaybackPerformanceStep('PlaybackPlayMediaItem', 'playback.playLocalFile IPC', perfDetails, () => getAudioSession().playLocalFile({
            filePath: prepared.filePath,
            inputHeaders: prepared.inputHeaders,
            trackId: item.trackId,
            metadata: {
              title: item.title,
              artist: item.artist,
              album: item.album,
              albumArtist: item.albumArtist,
              coverUrl: item.coverThumb,
            },
            replayGain: createReplayGainHintForMediaItem(item),
            startSeconds: request.startSeconds,
            output: request.output,
            probe: prepared.probe,
            automixAnalyze: request.automixAnalyze === true,
            automix,
            gapless,
          }));
          assertPlaybackStartRunCurrent(playbackRun);
          schedulePostPlaybackTask('ReplayGain schedule', postTaskGeneration, () => {
            scheduleReplayGainAnalysisForPlayback(item.trackId, item);
          });
          schedulePostPlaybackTask('savePlaybackMemoryNow', postTaskGeneration, () => {
            savePlaybackMemoryNow();
          });
          const status = toPlaybackStatus();
          if (item.mediaType === 'remote' && status.durationMs > 0) {
            schedulePostPlaybackTask('remote duration backfill', postTaskGeneration, () => {
              getRemoteSourceService().backfillDuration(item.trackId, status.durationMs / 1000);
            });
          }
          setRemotePlaybackActive(true);
          setActiveMediaPlayback(request);
          void syncSmtcStatus();
          return status;
        });
      } catch (retryError) {
        if (isSupersededPlaybackRun(retryError)) {
          return toPlaybackStatus();
        }
        reportPlaybackAudioError(retryError, 'play-media-item-retry-ipc', { request: rawRequest });
        throw retryError;
      }
    }
  });
  ipcMain.handle(IpcChannels.PlaybackPlay, async (): Promise<PlaybackStatus> => runImmediatePlaybackStatusCommand(async () => {
    noteDataProtectionPlaybackActivity(true);
    beginPlaybackStartRun();
    try {
      const airPlayReceiver = getActiveAirPlayReceiverService();
      if (airPlayReceiver) {
        const status = await airPlayReceiver.playPlayback();
        savePlaybackMemoryNow();
        setRemotePlaybackActive(true);
        void syncSmtcStatus();
        return airPlayReceiverStatusToPlaybackStatus(status);
      }

      await getAudioSession().play();
      savePlaybackMemoryNow();
      setRemotePlaybackActive(true);
      void syncSmtcStatus();
      return toPlaybackStatus();
    } catch (error) {
      if (error instanceof Error && beginActiveMediaExpiredUrlRecovery(error, getAudioSession().getStatus())) {
        return toPlaybackStatus();
      }

      reportPlaybackAudioError(error, 'playback-resume-ipc');
      throw error;
    }
  }));
  ipcMain.handle(IpcChannels.PlaybackPause, async (): Promise<PlaybackStatus> => runImmediatePlaybackStatusCommand(async () => {
    noteDataProtectionPlaybackActivity(false);
    beginPlaybackStartRun();
    const airPlayReceiver = getActiveAirPlayReceiverService();
    if (airPlayReceiver) {
      const status = await airPlayReceiver.pausePlayback();
      savePlaybackMemoryNow();
      setRemotePlaybackActive(false);
      void syncSmtcStatus();
      return airPlayReceiverStatusToPlaybackStatus(status);
    }

    await getAudioSession().pause();
    savePlaybackMemoryNow();
    setRemotePlaybackActive(false);
    void syncSmtcStatus();
    return toPlaybackStatus();
  }));
  ipcMain.handle(IpcChannels.PlaybackStop, async (): Promise<PlaybackStatus> => runImmediatePlaybackStatusCommand(async () => {
    noteDataProtectionPlaybackActivity(false);
    clearActiveMediaPlayback();
    beginPlaybackStartRun();
    getAudioSession().stop();
    setRemotePlaybackActive(false);
    getPlaybackMemoryStore().clear();
    try {
      getPlaybackSessionStore().clearResume();
    } catch (error) {
      console.warn(`[playback] Failed to clear queue resume position: ${error instanceof Error ? error.message : String(error)}`);
    }
    void syncSmtcStatus();
    return toPlaybackStatus();
  }));
  ipcMain.handle(IpcChannels.PlaybackSeek, async (_event, positionSeconds: unknown): Promise<PlaybackStatus> => enqueuePlaybackStatusCommand(async () => {
    try {
      const seekSeconds = optionalNonNegativeNumber(positionSeconds) ?? 0;
      const airPlayReceiver = getActiveAirPlayReceiverService();
      if (airPlayReceiver) {
        const status = await airPlayReceiver.seekPlayback(seekSeconds);
        savePlaybackMemoryNow();
        void syncSmtcStatus();
        return airPlayReceiverStatusToPlaybackStatus(status);
      }

      await getAudioSession().seek(seekSeconds);
      savePlaybackMemoryNow();
      void syncSmtcStatus();
      return toPlaybackStatus();
    } catch (error) {
      reportPlaybackAudioError(error, 'playback-seek-ipc', { positionSeconds });
      throw error;
    }
  }));
  ipcMain.handle(IpcChannels.PlaybackOpenLocalAudioFile, async (): Promise<string | null> => {
    const filePaths = await showOpenLocalAudioFiles(['openFile']);

    return filePaths?.[0] ?? null;
  });
  ipcMain.handle(IpcChannels.PlaybackOpenLocalAudioFiles, async (): Promise<string[] | null> => {
    const filePaths = await showOpenLocalAudioFiles(['openFile', 'multiSelections']);

    return filePaths && filePaths.length > 0 ? filePaths : null;
  });
  ipcMain.handle(IpcChannels.PlaybackResolveLocalAudioFiles, (_event, paths: unknown): Promise<LocalFileResolveResult> => {
    return resolveLocalAudioFiles(normalizePathList(paths));
  });
};
