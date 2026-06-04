import { createHash, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import electron, { shell } from 'electron';
import type { EchoDatabase } from '../database/createDatabase';
import { getLibraryDatabaseManager } from '../database/LibraryDatabaseManager';
import { getAppSettings, setAppSettings } from '../app/appSettings';
import { assertProtectedLibraryAvailable } from '../app/dataProtection';
import { getLibraryService } from '../library/LibraryService';
import type { LibraryTrack } from '../../shared/types/library';
import type {
  MvMatchCandidate,
  MvQualityTier,
  MvQualityVariant,
  MvResolvedStreams,
  MvSettings,
  MvTrackSnapshotSearchRequest,
  NetworkMvProviderId,
  MvProviderId,
  MvSourceType,
  TrackVideo,
} from '../../shared/types/mv';
import { isBrowserPlayableVideo, isSupportedVideoExtension, mimeTypeForVideoPath } from '../../shared/constants/videoExtensions';
import { clampMvOffsetMs } from '../../shared/constants/mvOffset';
import { LocalMvProvider } from './LocalMvProvider';
import { createOnlineMvProviders, type MainMvOnlineProvider, type ResolvedMvStreamVariant } from './OnlineMvProviders';

type LibraryLookup = {
  getTrack: (trackId: string) => LibraryTrack | null;
};

type ShellOpener = Pick<typeof shell, 'openPath' | 'openExternal'>;

type TrackVideoRow = {
  id: string;
  track_id: string;
  provider: string;
  source_type: string;
  source_id: string | null;
  title: string | null;
  artist: string | null;
  url: string | null;
  provider_url: string | null;
  thumbnail_url: string | null;
  file_path: string | null;
  mime_type: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  selected_quality_id: string | null;
  quality_label: string | null;
  fps: number | null;
  offset_ms: number | null;
  raw_provider_json: string | null;
  score: number;
  selected: number;
  created_at: string;
  updated_at: string;
};

type TrackVideoStreamRow = {
  id: string;
  video_id: string;
  provider: string;
  variant_id: string;
  label: string;
  quality_tier: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  container: string | null;
  mime_type: string | null;
  protocol: string;
  url: string | null;
  headers_json: string;
  playable_in_app: number;
  requires_account: number;
  expires_at: string | null;
  raw_json: string | null;
  created_at: string;
  updated_at: string;
};

type TrackVideoFile = {
  id: string;
  provider: MvProviderId;
  filePath: string | null;
  url: string | null;
  mimeType: string | null;
  playableInApp: boolean;
};

export type StreamVariantForProtocol = {
  videoId: string;
  variantId: string;
  url: string;
  headers: Record<string, string>;
  mimeType: string | null;
};

type EphemeralMvStreamEntry = {
  token: string;
  url: string;
  headers: Record<string, string>;
  mimeType: string | null;
  expiresAtMs: number;
};

const nowIso = (): string => new Date().toISOString();
const ephemeralMvStreamTtlMs = 15 * 60 * 1000;
const createMvInAppUnavailableError = (): Error => new Error('此 MV 暂时无法在应用内播放，可外部打开。');

const fileHashId = (filePath: string): string => `local:${createHash('sha1').update(resolve(filePath)).digest('hex')}`;
const isSqliteCorruptionError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  return code === 'SQLITE_CORRUPT' || /database disk image is malformed|database disk image malformed|SQLITE_CORRUPT/i.test(message);
};

const createMvDatabaseUnavailableError = (operation: string): Error =>
  new Error(`MV database is temporarily unavailable during ${operation}. Try temporary MV playback or repair the library database.`);

const mvStreamStorageSql = `
CREATE TABLE IF NOT EXISTS track_video_streams (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  label TEXT NOT NULL,
  quality_tier TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  fps REAL,
  codec TEXT,
  container TEXT,
  mime_type TEXT,
  protocol TEXT NOT NULL,
  url TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  playable_in_app INTEGER NOT NULL DEFAULT 0,
  requires_account INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (video_id) REFERENCES track_videos(id) ON DELETE CASCADE,
  UNIQUE(video_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_track_video_streams_video_id ON track_video_streams(video_id);
CREATE INDEX IF NOT EXISTS idx_track_video_streams_provider ON track_video_streams(provider, variant_id);
`;

const resetMvStreamStorage = (database: EchoDatabase): void => {
  database.exec(`
    DROP TABLE IF EXISTS track_video_streams;
    ${mvStreamStorageSql}
  `);
};

const networkProviders: NetworkMvProviderId[] = ['bilibili', 'youtube'];
const streamingTrackIdPattern = /^streaming:([^:]+):(.+)$/;
export const MV_AUTO_MATCH_THRESHOLD = 0.7;
const normalizeAutoApplyThreshold = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0.3, Math.min(1, value)) : MV_AUTO_MATCH_THRESHOLD;
const normalizePercent = (value: unknown, fallback: number, min: number, max: number): number => {
  const percent = Number(value);
  return Number.isFinite(percent) ? Math.round(Math.max(min, Math.min(max, percent))) : fallback;
};
const qualityHeight: Record<Exclude<MvQualityTier, 'auto'>, number> = {
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '2160p': 2160,
  '4320p': 4320,
};
const bilibiliQualityOrder = [127, 126, 125, 120, 116, 112, 80, 64];
const bilibiliQualityRank = (qn: number): number => {
  const index = bilibiliQualityOrder.indexOf(qn);
  return index >= 0 ? bilibiliQualityOrder.length - index : 0;
};

const maxQualityHeight = (quality: MvSettings['maxQuality']): number => (quality === 'max' ? Number.POSITIVE_INFINITY : qualityHeight[quality]);

const maxBilibiliQnForSettings = (settings: MvSettings): number => {
  if (settings.maxQuality === 'max') {
    return 127;
  }
  if (settings.maxQuality === '2160p') {
    return 120;
  }
  if (settings.maxQuality === '1440p') {
    return 112;
  }
  if (settings.maxQuality === '1080p') {
    return settings.allow60fps === false ? 112 : 116;
  }

  return 64;
};

const parseJson = (value: string | null): unknown | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const parseHeaders = (value: string | null): Record<string, string> => {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).flatMap(([key, entry]) =>
      typeof entry === 'string' ? [[key, entry]] : [],
    ),
  );
};

const isBrowserPlayableBilibiliCodec = (codec: string | null): boolean => {
  if (!codec) {
    return true;
  }

  const codecs = codec
    .toLowerCase()
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return !codecs.some(
    (entry) => entry.startsWith('hev1') || entry.startsWith('hvc1') || entry.startsWith('dvhe') || entry.startsWith('dvh1'),
  );
};

const isBrowserPlayableStreamCodec = (variant: TrackVideoStreamRow): boolean =>
  variant.provider !== 'bilibili' || isBrowserPlayableBilibiliCodec(variant.codec);

const isPlayableStreamRow = (variant: TrackVideoStreamRow | null | undefined): variant is TrackVideoStreamRow & { url: string } => {
  if (!variant?.url || variant.playable_in_app !== 1 || variant.protocol !== 'direct') {
    return false;
  }

  if (isStaleBilibiliDashDirectStream(variant)) {
    return false;
  }

  return isBrowserPlayableStreamCodec(variant);
};

const isPlayableResolvedVariant = (variant: ResolvedMvStreamVariant): boolean =>
  Boolean(variant.url && variant.playableInApp && variant.protocol === 'direct' && !isStaleBilibiliDashDirectResolvedVariant(variant));

const isPlayableTrackVideo = (video: TrackVideo | null | undefined): video is TrackVideo =>
  Boolean(video?.playableInApp && video.mediaUrl);

const recordFromJson = (value: string | null): Record<string, unknown> | null => {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
};

const isTrustedBilibiliMutedVideoOnly = (raw: Record<string, unknown> | null): boolean =>
  raw?.provider === 'bilibili' &&
  raw.source === 'dash-video' &&
  raw.resolver === 'bilibili-dash-video-v4' &&
  raw.mutedVideoOnly === true;

const isStaleBilibiliDashDirectStream = (variant: TrackVideoStreamRow): boolean => {
  if (variant.provider !== 'bilibili' || variant.protocol !== 'direct') {
    return false;
  }

  const raw = recordFromJson(variant.raw_json);
  return !isTrustedBilibiliMutedVideoOnly(raw) && (raw?.source === 'dash-video' || raw?.resolver === 'bilibili-dash-video-v4');
};

const bilibiliQnFromRaw = (variant: TrackVideoStreamRow): number | null => {
  const raw = recordFromJson(variant.raw_json);
  const qn = Number(raw?.qn);
  return Number.isFinite(qn) && qn > 0 ? qn : null;
};

const bilibiliRankFromRaw = (variant: TrackVideoStreamRow): number => {
  const raw = recordFromJson(variant.raw_json);
  const explicitRank = Number(raw?.qualityRank);
  if (Number.isFinite(explicitRank) && explicitRank > 0) {
    return explicitRank;
  }

  const qn = bilibiliQnFromRaw(variant);
  return qn ? bilibiliQualityRank(qn) : 0;
};

const isBilibiliMutedVideoOnlyStream = (variant: TrackVideoStreamRow): boolean =>
  isTrustedBilibiliMutedVideoOnly(recordFromJson(variant.raw_json));

const isLegacyCodecCollapsedBilibiliDashVariant = (variant: TrackVideoStreamRow): boolean => {
  if (variant.provider !== 'bilibili' || !/^bilibili-dash-qn-\d+(?:-\d+fps)?$/u.test(variant.variant_id)) {
    return false;
  }

  const raw = recordFromJson(variant.raw_json);
  return raw?.source === 'dash-video' && raw.resolver === 'bilibili-dash-video-v4';
};

const recordFromUnknown = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const mergeRawProviderJson = (base: unknown | null, issue: Record<string, unknown> | null): unknown | null => {
  if (!issue) {
    return base;
  }

  const baseRecord = recordFromUnknown(base);
  return baseRecord ? { ...baseRecord, ...issue } : issue;
};

const unavailableRawProviderJsonFromResolvedVariants = (
  variants: ResolvedMvStreamVariant[],
): Record<string, unknown> | null =>
  variants
    .map((variant) => recordFromUnknown(variant.rawProviderJson))
    .find((raw) => typeof raw?.unavailableReason === 'string') ?? null;

const unavailableRawProviderJsonFromStreamRows = (
  variants: TrackVideoStreamRow[],
): Record<string, unknown> | null =>
  variants
    .map((variant) => recordFromJson(variant.raw_json))
    .find((raw) => typeof raw?.unavailableReason === 'string') ?? null;

const isStaleBilibiliDashDirectResolvedVariant = (variant: ResolvedMvStreamVariant): boolean => {
  if (variant.protocol !== 'direct') {
    return false;
  }

  const raw = recordFromUnknown(variant.rawProviderJson);
  return raw?.provider === 'bilibili' && !isTrustedBilibiliMutedVideoOnly(raw) && (raw.source === 'dash-video' || raw.resolver === 'bilibili-dash-video-v4');
};

const bilibiliQnFromResolved = (variant: ResolvedMvStreamVariant): number | null => {
  const raw = recordFromUnknown(variant.rawProviderJson);
  const qn = Number(raw?.qn);
  return Number.isFinite(qn) && qn > 0 ? qn : null;
};

const bilibiliRankFromResolved = (variant: ResolvedMvStreamVariant): number => {
  const raw = recordFromUnknown(variant.rawProviderJson);
  const explicitRank = Number(raw?.qualityRank);
  if (Number.isFinite(explicitRank) && explicitRank > 0) {
    return explicitRank;
  }

  const qn = bilibiliQnFromResolved(variant);
  return qn ? bilibiliQualityRank(qn) : 0;
};

const isBilibiliMutedVideoOnlyResolved = (variant: ResolvedMvStreamVariant): boolean =>
  isTrustedBilibiliMutedVideoOnly(recordFromUnknown(variant.rawProviderJson));

const mediaUrlForLocal = (row: TrackVideoRow): string | null => {
  if (row.provider !== 'local' || !row.file_path || !isBrowserPlayableVideo(row.file_path) || !existsSync(row.file_path)) {
    return null;
  }

  return `echo-video://mv/${encodeURIComponent(row.id)}`;
};

const mediaUrlForStream = (row: TrackVideoRow, variant: TrackVideoStreamRow | null): string | null => {
  if (!isPlayableStreamRow(variant)) {
    return null;
  }

  return `echo-mv://stream/${encodeURIComponent(row.id)}/${encodeURIComponent(variant.variant_id)}`;
};

const providerName = (value: string): MvProviderId => {
  if (value === 'local' || value === 'bilibili' || value === 'youtube' || value === 'netease' || value === 'qqmusic') {
    return value;
  }

  return 'local';
};

const sourceType = (value: string): MvSourceType => {
  if (value === 'sidecar' || value === 'manual' || value === 'search_candidate' || value === 'stream') {
    return value;
  }

  return 'sidecar';
};

const qualityTier = (value: string): MvQualityTier => {
  if (value === 'auto' || value === '720p' || value === '1080p' || value === '1440p' || value === '2160p' || value === '4320p') {
    return value;
  }

  return 'auto';
};

const candidateTitle = (filePath: string): string => basename(filePath, extname(filePath));

const sourceIdForCandidate = (candidate: MvMatchCandidate): string =>
  candidate.id.startsWith(`${candidate.provider}:`) ? candidate.id.slice(candidate.provider.length + 1) : candidate.id;

const directTrackSearchQuery = (track: Pick<LibraryTrack, 'title' | 'artist' | 'albumArtist'>): string | undefined => {
  const query = [track.title, track.artist || track.albumArtist]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' ');
  return query || undefined;
};

const networkSearchQueryOverride = (
  track: Pick<LibraryTrack, 'title' | 'artist' | 'albumArtist'>,
  settings: MvSettings,
  query?: string | null,
): string | undefined => {
  const explicitQuery = query?.trim();
  if (explicitQuery) {
    return explicitQuery;
  }

  return settings.preferHighestViewCount ? directTrackSearchQuery(track) : undefined;
};

const compareNetworkCandidates = (settings: MvSettings) => (left: MvMatchCandidate, right: MvMatchCandidate): number => {
  if (settings.preferHighestViewCount) {
    const viewDelta = (right.viewCount ?? -1) - (left.viewCount ?? -1);
    if (viewDelta !== 0) {
      return viewDelta;
    }
  }

  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return (right.viewCount ?? -1) - (left.viewCount ?? -1);
};

const customMvFromUrl = (value: string): { provider: NetworkMvProviderId; sourceId: string; providerUrl: string; title: string } => {
  const trimmed = value.trim();
  if (/^BV[0-9A-Za-z]+$/.test(trimmed)) {
    return {
      provider: 'bilibili',
      sourceId: trimmed,
      providerUrl: `https://www.bilibili.com/video/${trimmed}`,
      title: `Bilibili - ${trimmed}`,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Unsupported MV link. Paste a YouTube or Bilibili video URL.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname;

  if (hostname === 'youtu.be') {
    const videoId = path.split('/').filter(Boolean)[0];
    if (videoId) {
      return {
        provider: 'youtube',
        sourceId: videoId,
        providerUrl: `https://www.youtube.com/watch?v=${videoId}`,
        title: `YouTube - ${videoId}`,
      };
    }
  }

  if (hostname.endsWith('youtube.com')) {
    const videoId = url.searchParams.get('v') ?? (path.startsWith('/shorts/') ? path.split('/').filter(Boolean)[1] : null);
    if (videoId) {
      return {
        provider: 'youtube',
        sourceId: videoId,
        providerUrl: `https://www.youtube.com/watch?v=${videoId}`,
        title: `YouTube - ${videoId}`,
      };
    }
  }

  if (hostname.endsWith('bilibili.com')) {
    const bvid = path
      .split('/')
      .map((part) => part.trim())
      .find((part) => /^BV[0-9A-Za-z]+$/.test(part));
    if (bvid) {
      return {
        provider: 'bilibili',
        sourceId: bvid,
        providerUrl: `https://www.bilibili.com/video/${bvid}`,
        title: `Bilibili - ${bvid}`,
      };
    }
  }

  throw new Error('Unsupported MV link. Paste a YouTube or Bilibili video URL.');
};

const normalizeSettingsPatch = (patch: Partial<MvSettings>): Partial<MvSettings> => {
  const normalized: Partial<MvSettings> = {};

  if (typeof patch.enabled === 'boolean') {
    normalized.enabled = patch.enabled;
  }

  if (Array.isArray(patch.enabledProviders)) {
    normalized.enabledProviders = patch.enabledProviders.filter((provider): provider is NetworkMvProviderId =>
      networkProviders.includes(provider as NetworkMvProviderId),
    );
  }

  if (Array.isArray(patch.providerOrder)) {
    normalized.providerOrder = patch.providerOrder.filter((provider): provider is NetworkMvProviderId =>
      networkProviders.includes(provider as NetworkMvProviderId),
    );
  }

  if (patch.maxQuality === '720p' || patch.maxQuality === '1080p' || patch.maxQuality === '1440p' || patch.maxQuality === '2160p' || patch.maxQuality === 'max') {
    normalized.maxQuality = patch.maxQuality;
  }

  if (typeof patch.allow60fps === 'boolean') {
    normalized.allow60fps = patch.allow60fps;
  }

  if (typeof patch.autoSearch === 'boolean') {
    normalized.autoSearch = patch.autoSearch;
  }

  if (typeof patch.autoPreload === 'boolean') {
    normalized.autoPreload = patch.autoPreload;
  }

  if (typeof patch.autoApplyThreshold === 'number' && Number.isFinite(patch.autoApplyThreshold)) {
    normalized.autoApplyThreshold = normalizeAutoApplyThreshold(patch.autoApplyThreshold);
  }

  if (typeof patch.preferHighestViewCount === 'boolean') {
    normalized.preferHighestViewCount = patch.preferHighestViewCount;
  }

  if (typeof patch.immersiveBackground === 'boolean') {
    normalized.immersiveBackground = patch.immersiveBackground;
  }

  if (typeof patch.immersiveBackgroundAutoScale === 'boolean') {
    normalized.immersiveBackgroundAutoScale = patch.immersiveBackgroundAutoScale;
  }

  if (typeof patch.immersiveBackgroundScalePercent === 'number' && Number.isFinite(patch.immersiveBackgroundScalePercent)) {
    normalized.immersiveBackgroundScalePercent = normalizePercent(patch.immersiveBackgroundScalePercent, 115, 100, 220);
  }

  if (typeof patch.immersiveBackgroundOffsetXPercent === 'number' && Number.isFinite(patch.immersiveBackgroundOffsetXPercent)) {
    normalized.immersiveBackgroundOffsetXPercent = normalizePercent(patch.immersiveBackgroundOffsetXPercent, 50, 0, 100);
  }

  if (typeof patch.immersiveBackgroundOffsetYPercent === 'number' && Number.isFinite(patch.immersiveBackgroundOffsetYPercent)) {
    normalized.immersiveBackgroundOffsetYPercent = normalizePercent(patch.immersiveBackgroundOffsetYPercent, 50, 0, 100);
  }

  if (typeof patch.immersiveBackgroundBlurPx === 'number' && Number.isFinite(patch.immersiveBackgroundBlurPx)) {
    normalized.immersiveBackgroundBlurPx = normalizePercent(patch.immersiveBackgroundBlurPx, 0, 0, 32);
  }

  if (typeof patch.immersiveBackgroundBrightnessPercent === 'number' && Number.isFinite(patch.immersiveBackgroundBrightnessPercent)) {
    normalized.immersiveBackgroundBrightnessPercent = normalizePercent(patch.immersiveBackgroundBrightnessPercent, 100, 60, 140);
  }

  if (typeof patch.immersiveBackgroundOverlayOpacityPercent === 'number' && Number.isFinite(patch.immersiveBackgroundOverlayOpacityPercent)) {
    normalized.immersiveBackgroundOverlayOpacityPercent = normalizePercent(patch.immersiveBackgroundOverlayOpacityPercent, 0, 0, 100);
  }

  if (typeof patch.lyricsReadabilityEnhanced === 'boolean') {
    normalized.lyricsReadabilityEnhanced = patch.lyricsReadabilityEnhanced;
  }

  if (typeof patch.hideLyrics === 'boolean') {
    normalized.hideLyrics = patch.hideLyrics;
  }

  if (typeof patch.restartAudioOnLoad === 'boolean') {
    normalized.restartAudioOnLoad = patch.restartAudioOnLoad;
  }

  if (patch.syncMode === 'stable' || patch.syncMode === 'balanced' || patch.syncMode === 'precise') {
    normalized.syncMode = patch.syncMode;
  }

  if (typeof patch.replayAudioOnChange === 'boolean') {
    normalized.replayAudioOnChange = patch.replayAudioOnChange;
  }

  return normalized;
};

const appSettingsToMvSettings = (): MvSettings => {
  const settings = getAppSettings();
  return {
    enabled: settings.mvEnabled !== false,
    autoSearch: settings.mvAutoSearch,
    autoPreload: settings.mvAutoPreload !== false,
    autoApplyThreshold: normalizeAutoApplyThreshold(settings.mvAutoApplyThreshold),
    preferHighestViewCount: settings.mvPreferHighestViewCount === true,
    immersiveBackground: settings.mvImmersiveBackground !== false,
    immersiveBackgroundAutoScale: settings.mvImmersiveBackgroundAutoScale !== false,
    immersiveBackgroundScalePercent: normalizePercent(settings.mvImmersiveBackgroundScalePercent, 115, 100, 220),
    immersiveBackgroundOffsetXPercent: normalizePercent(settings.mvImmersiveBackgroundOffsetXPercent, 50, 0, 100),
    immersiveBackgroundOffsetYPercent: normalizePercent(settings.mvImmersiveBackgroundOffsetYPercent, 50, 0, 100),
    immersiveBackgroundBlurPx: normalizePercent(settings.mvImmersiveBackgroundBlurPx, 0, 0, 32),
    immersiveBackgroundBrightnessPercent: normalizePercent(settings.mvImmersiveBackgroundBrightnessPercent, 100, 60, 140),
    immersiveBackgroundOverlayOpacityPercent: normalizePercent(settings.mvImmersiveBackgroundOverlayOpacityPercent, 0, 0, 100),
    lyricsReadabilityEnhanced: settings.mvLyricsReadabilityEnhanced === true,
    hideLyrics: settings.mvHideLyrics === true,
    restartAudioOnLoad: settings.mvRestartAudioOnLoad === true,
    syncMode: settings.mvSyncMode ?? 'balanced',
    replayAudioOnChange: settings.mvReplayAudioOnChange !== false,
    enabledProviders: settings.mvEnabledProviders,
    providerOrder: settings.mvProviderOrder,
    maxQuality: settings.mvMaxQuality,
    allow60fps: settings.mvAllow60fps,
  };
};

const sanitizeVariant = (variant: TrackVideoStreamRow): MvQualityVariant => ({
  id: variant.variant_id,
  label: variant.label,
  qualityTier: qualityTier(variant.quality_tier),
  width: variant.width,
  height: variant.height,
  fps: variant.fps,
  codec: variant.codec,
  container: variant.container,
  mimeType: variant.mime_type,
  protocol:
    variant.protocol === 'dash' || variant.protocol === 'hls' || variant.protocol === 'external' ? variant.protocol : 'direct',
  playableInApp: variant.playable_in_app === 1,
  requiresAccount: variant.requires_account === 1,
  expiresAt: variant.expires_at,
});

export class MvService {
  private readonly onlineProviderMap: Map<NetworkMvProviderId, MainMvOnlineProvider>;
  private readonly ephemeralStreams = new Map<string, EphemeralMvStreamEntry>();
  private readonly resolveStreamsInFlight = new Map<string, Promise<MvResolvedStreams>>();
  private readonly lastResolveIssueByVideoId = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly database: EchoDatabase,
    private readonly library: LibraryLookup,
    private readonly localProvider: LocalMvProvider = new LocalMvProvider(),
    private readonly shellOpener: ShellOpener = shell,
    onlineProviders: MainMvOnlineProvider[] = createOnlineMvProviders(),
    private readonly closeDatabase: () => void = () => this.database.close(),
  ) {
    this.onlineProviderMap = new Map(onlineProviders.map((provider) => [provider.id, provider]));
    this.purgeKnownBadBilibiliStreamCache();
  }

  close(): void {
    this.closeDatabase();
  }

  getSettings(): MvSettings {
    return appSettingsToMvSettings();
  }

  setSettings(patch: Partial<MvSettings>): MvSettings {
    const normalized = normalizeSettingsPatch(patch);
    const appSettingsPatch: Parameters<typeof setAppSettings>[0] = {};

    if (typeof normalized.enabled === 'boolean') {
      appSettingsPatch.mvEnabled = normalized.enabled;
    }
    if (normalized.enabledProviders) {
      appSettingsPatch.mvEnabledProviders = normalized.enabledProviders;
    }
    if (normalized.providerOrder) {
      appSettingsPatch.mvProviderOrder = normalized.providerOrder;
    }
    if (normalized.maxQuality) {
      appSettingsPatch.mvMaxQuality = normalized.maxQuality;
    }
    if (typeof normalized.allow60fps === 'boolean') {
      appSettingsPatch.mvAllow60fps = normalized.allow60fps;
    }
    if (typeof normalized.autoSearch === 'boolean') {
      appSettingsPatch.mvAutoSearch = normalized.autoSearch;
    }
    if (typeof normalized.autoPreload === 'boolean') {
      appSettingsPatch.mvAutoPreload = normalized.autoPreload;
    }
    if (typeof normalized.autoApplyThreshold === 'number') {
      appSettingsPatch.mvAutoApplyThreshold = normalized.autoApplyThreshold;
    }
    if (typeof normalized.preferHighestViewCount === 'boolean') {
      appSettingsPatch.mvPreferHighestViewCount = normalized.preferHighestViewCount;
    }
    if (typeof normalized.immersiveBackground === 'boolean') {
      appSettingsPatch.mvImmersiveBackground = normalized.immersiveBackground;
    }
    if (typeof normalized.immersiveBackgroundAutoScale === 'boolean') {
      appSettingsPatch.mvImmersiveBackgroundAutoScale = normalized.immersiveBackgroundAutoScale;
    }
    if (typeof normalized.immersiveBackgroundScalePercent === 'number') {
      appSettingsPatch.mvImmersiveBackgroundScalePercent = normalized.immersiveBackgroundScalePercent;
    }
    if (typeof normalized.immersiveBackgroundOffsetXPercent === 'number') {
      appSettingsPatch.mvImmersiveBackgroundOffsetXPercent = normalized.immersiveBackgroundOffsetXPercent;
    }
    if (typeof normalized.immersiveBackgroundOffsetYPercent === 'number') {
      appSettingsPatch.mvImmersiveBackgroundOffsetYPercent = normalized.immersiveBackgroundOffsetYPercent;
    }
    if (typeof normalized.immersiveBackgroundBlurPx === 'number') {
      appSettingsPatch.mvImmersiveBackgroundBlurPx = normalized.immersiveBackgroundBlurPx;
    }
    if (typeof normalized.immersiveBackgroundBrightnessPercent === 'number') {
      appSettingsPatch.mvImmersiveBackgroundBrightnessPercent = normalized.immersiveBackgroundBrightnessPercent;
    }
    if (typeof normalized.immersiveBackgroundOverlayOpacityPercent === 'number') {
      appSettingsPatch.mvImmersiveBackgroundOverlayOpacityPercent = normalized.immersiveBackgroundOverlayOpacityPercent;
    }
    if (typeof normalized.lyricsReadabilityEnhanced === 'boolean') {
      appSettingsPatch.mvLyricsReadabilityEnhanced = normalized.lyricsReadabilityEnhanced;
    }
    if (typeof normalized.hideLyrics === 'boolean') {
      appSettingsPatch.mvHideLyrics = normalized.hideLyrics;
    }
    if (typeof normalized.restartAudioOnLoad === 'boolean') {
      appSettingsPatch.mvRestartAudioOnLoad = normalized.restartAudioOnLoad;
    }
    if (normalized.syncMode) {
      appSettingsPatch.mvSyncMode = normalized.syncMode;
    }
    if (typeof normalized.replayAudioOnChange === 'boolean') {
      appSettingsPatch.mvReplayAudioOnChange = normalized.replayAudioOnChange;
    }

    setAppSettings(appSettingsPatch);
    return this.getSettings();
  }

  getSelectedVideo(trackId: string): TrackVideo | null {
    try {
      const row = this.database
        .prepare<[string], TrackVideoRow>(
          `SELECT * FROM track_videos
           WHERE track_id = ? AND selected = 1
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get(trackId);

      return row ? this.mapRow(row) : null;
    } catch (error) {
      if (isSqliteCorruptionError(error)) {
        this.reportMvDatabaseUnavailable('getSelectedVideo', error);
        throw createMvDatabaseUnavailableError('getSelectedVideo');
      }

      throw error;
    }
  }

  async getSelectedOrAutoApplyVideo(trackId: string): Promise<TrackVideo | null> {
    const selected = this.getSelectedVideo(trackId);
    const settings = this.getSettings();
    if (selected || settings.enabled === false || !settings.autoSearch) {
      return selected;
    }

    await this.searchNetworkCandidates(trackId);
    return this.getSelectedVideo(trackId);
  }

  findLocalMvCandidates(trackId: string): MvMatchCandidate[] {
    const track = this.getExistingTrack(trackId);
    if (track.mediaType === 'remote') {
      return [];
    }
    const candidates = this.localProvider.searchCandidates(track);

    return this.database.transaction(() => candidates.map((candidate) => this.upsertLocalCandidate(track, candidate)))();
  }

  async searchNetworkCandidates(trackId: string, query?: string): Promise<MvMatchCandidate[]> {
    const track = this.getExistingTrack(trackId);
    const settings = this.getSettings();
    if (settings.enabled === false) {
      return [];
    }

    const queryOverride = networkSearchQueryOverride(track, settings, query);
    const enabled = new Set(settings.enabledProviders);
    const orderedProviders = settings.providerOrder.filter((provider) => enabled.has(provider));
    const providerResults = await Promise.all(
      orderedProviders.map(async (providerId) => {
        const provider = this.onlineProviderMap.get(providerId);
        if (!provider) {
          return [];
        }

        try {
          return await provider.search(track, settings, queryOverride);
        } catch {
          return [];
        }
      }),
    );
    const candidates = providerResults.flat().sort(compareNetworkCandidates(settings));
    const normalizedCandidates =
      track.mediaType === 'remote'
        ? candidates.map((candidate) => ({
        ...candidate,
        filePath: null,
        reasons: [...(candidate.reasons ?? []), `remote:${track.sourceId ?? 'unknown'}:${track.stableKey ?? track.id}`],
      }))
        : candidates;
    return this.persistNetworkCandidatesWithRepair(track, normalizedCandidates, settings);
  }

  async searchNetworkCandidatesForSnapshot(request: MvTrackSnapshotSearchRequest): Promise<MvMatchCandidate[]> {
    const settings = this.getSettings();
    if (settings.enabled === false) {
      return [];
    }

    const track = this.trackSnapshotToLibraryTrack(request);
    const queryOverride = networkSearchQueryOverride(track, settings, request.query);
    const enabled = new Set(settings.enabledProviders);
    const orderedProviders = settings.providerOrder.filter((provider) => enabled.has(provider));
    const providerResults = await Promise.all(
      orderedProviders.map(async (providerId) => {
        const provider = this.onlineProviderMap.get(providerId);
        if (!provider) {
          return [];
        }

        try {
          return await provider.search(track, settings, queryOverride);
        } catch {
          return [];
        }
      }),
    );
    const candidates = providerResults
      .flat()
      .sort(compareNetworkCandidates(settings))
      .map((candidate) => ({
        ...candidate,
        filePath: null,
        reasons: [...(candidate.reasons ?? []), `snapshot:${track.mediaType ?? 'streaming'}:${track.id}`],
      }));
    return this.persistNetworkCandidatesWithRepair(track, candidates, settings);
  }

  async getTemporaryPlayableForSnapshot(request: MvTrackSnapshotSearchRequest): Promise<TrackVideo | null> {
    const settings = this.getSettings();
    if (settings.enabled === false) {
      return null;
    }

    const track = this.trackSnapshotToLibraryTrack(request);
    const queryOverride = networkSearchQueryOverride(track, settings, request.query);
    const enabled = new Set(settings.enabledProviders);
    const orderedProviders = settings.providerOrder.filter((provider) => enabled.has(provider));
    const providerResults = await Promise.all(
      orderedProviders.map(async (providerId) => {
        const provider = this.onlineProviderMap.get(providerId);
        if (!provider) {
          return [];
        }

        try {
          return await provider.search(track, settings, queryOverride);
        } catch {
          return [];
        }
      }),
    );
    const candidates = providerResults
      .flat()
      .sort(compareNetworkCandidates(settings))
      .map((candidate) => ({
        ...candidate,
        filePath: null,
        reasons: [...(candidate.reasons ?? []), `temporary:${track.mediaType ?? 'local'}:${track.id}`],
      }));

    for (const candidate of this.rankAutoCandidates(candidates, settings)) {
      const providerId = providerName(candidate.provider);
      if (providerId !== 'bilibili' && providerId !== 'youtube') {
        continue;
      }

      const provider = this.onlineProviderMap.get(providerId);
      if (!provider) {
        continue;
      }

      try {
        const temporaryVideo = this.temporaryVideoFromCandidate(track, candidate, null, null);
        const variants = await provider.resolve(temporaryVideo, settings);
        const selected = this.chooseResolvedStreamVariant(providerId, variants, settings);
        if (!selected?.url || selected.protocol === 'external' || !selected.playableInApp) {
          continue;
        }

        const token = this.registerEphemeralStream(selected);
        const resolvedVideo = this.temporaryVideoFromCandidate(track, candidate, selected, token);
        this.reportTemporaryMvFallback('getTemporaryPlayableForSnapshot', resolvedVideo);
        return resolvedVideo;
      } catch {
        // Try the next candidate; temporary MV playback should not block audio or lyrics.
      }
    }

    return null;
  }

  getVideoCandidates(trackId: string): TrackVideo[] {
    try {
      return this.database
        .prepare<[string], TrackVideoRow>(
          `SELECT * FROM track_videos
           WHERE track_id = ?
           ORDER BY selected DESC, score DESC, updated_at DESC`,
        )
        .all(trackId)
        .map((row) => this.mapRow(row));
    } catch (error) {
      if (isSqliteCorruptionError(error)) {
        this.reportMvDatabaseUnavailable('getVideoCandidates', error);
        throw createMvDatabaseUnavailableError('getVideoCandidates');
      }

      throw error;
    }
  }

  bindLocalVideo(trackId: string, filePath: string): TrackVideo {
    const track = this.getExistingTrack(trackId);
    const normalizedPath = resolve(filePath);

    if (!existsSync(normalizedPath)) {
      throw new Error(`MV file does not exist: ${normalizedPath}`);
    }

    if (!isSupportedVideoExtension(normalizedPath)) {
      throw new Error(`Unsupported MV video type: ${normalizedPath}`);
    }

    const timestamp = nowIso();
    const id = randomUUID();
    const sourceId = fileHashId(normalizedPath);
    const mimeType = mimeTypeForVideoPath(normalizedPath);

    return this.database.transaction(() => {
      this.database.prepare('UPDATE track_videos SET selected = 0, updated_at = ? WHERE track_id = ?').run(timestamp, trackId);
      this.database
        .prepare(
          `INSERT INTO track_videos (
            id, track_id, provider, source_type, source_id, title, artist, url, provider_url, thumbnail_url, file_path,
            mime_type, duration_seconds, width, height, selected_quality_id, quality_label, fps, raw_provider_json,
            score, selected, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          track.id,
          'local',
          'manual',
          sourceId,
          candidateTitle(normalizedPath),
          track.artist || track.albumArtist || null,
          null,
          null,
          null,
          normalizedPath,
          mimeType,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          1,
          1,
          timestamp,
          timestamp,
        );

      return this.mapRow(this.getRow(id)!);
    })();
  }

  bindUrl(trackId: string, url: string): TrackVideo {
    const track = this.getExistingTrackOrStreamingPlaceholder(trackId);
    const custom = customMvFromUrl(url);
    const existing = this.database
      .prepare<[string, string, string], TrackVideoRow>(
        `SELECT * FROM track_videos
         WHERE track_id = ? AND provider = ? AND source_id = ?
         LIMIT 1`,
      )
      .get(track.id, custom.provider, custom.sourceId);
    const timestamp = nowIso();
    const id = existing?.id ?? randomUUID();

    return this.database.transaction(() => {
      this.database.prepare('UPDATE track_videos SET selected = 0, updated_at = ? WHERE track_id = ?').run(timestamp, track.id);
      this.database
        .prepare(
          `INSERT INTO track_videos (
            id, track_id, provider, source_type, source_id, title, artist, url, provider_url, thumbnail_url, file_path,
            mime_type, duration_seconds, width, height, selected_quality_id, quality_label, fps, raw_provider_json,
            score, selected, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            url = excluded.url,
            provider_url = excluded.provider_url,
            source_type = excluded.source_type,
            selected_quality_id = COALESCE(track_videos.selected_quality_id, excluded.selected_quality_id),
            selected = excluded.selected,
            score = excluded.score,
            updated_at = excluded.updated_at`,
        )
        .run(
          id,
          track.id,
          custom.provider,
          'manual',
          custom.sourceId,
          custom.title,
          track.artist || track.albumArtist || null,
          custom.providerUrl,
          custom.providerUrl,
          null,
          null,
          null,
          null,
          null,
          null,
          existing?.selected_quality_id ?? 'auto',
          null,
          null,
          JSON.stringify({ reasons: ['Custom MV link'] }),
          1,
          1,
          existing?.created_at ?? timestamp,
          timestamp,
        );

      return this.mapRow(this.getRow(id)!);
    })();
  }

  async selectVideo(trackId: string, videoId: string): Promise<TrackVideo> {
    const row = this.getRow(videoId);
    if (!row || row.track_id !== trackId) {
      throw new Error(`Unknown MV candidate ${videoId}`);
    }

    const provider = providerName(row.provider);
    if (provider !== 'local' && row.source_type === 'search_candidate') {
      const resolved = await this.resolvePlayableCandidateForSelection(videoId);
      if (!isPlayableTrackVideo(resolved.video)) {
        throw createMvInAppUnavailableError();
      }
    }

    return this.commitSelectedVideo(trackId, videoId);
  }

  clearSelectedVideo(trackId: string): void {
    this.database.prepare('UPDATE track_videos SET selected = 0, updated_at = ? WHERE track_id = ?').run(nowIso(), trackId);
  }

  async openVideoExternal(videoId: string): Promise<void> {
    const row = this.getRow(videoId);
    if (!row) {
      throw new Error(`Unknown MV video ${videoId}`);
    }

    if (row.provider === 'local' && row.file_path) {
      const result = await this.shellOpener.openPath(row.file_path);
      if (result) {
        throw new Error(result);
      }
      return;
    }

    const externalUrl = row.provider_url ?? row.url;
    if (externalUrl) {
      await this.shellOpener.openExternal(externalUrl);
      return;
    }

    throw new Error('MV video has no external target');
  }

  getVideoFileForProtocol(videoId: string): TrackVideoFile | null {
    const row = this.getRow(videoId);
    if (!row || row.provider !== 'local' || !row.file_path || !existsSync(row.file_path)) {
      return null;
    }

    return {
      id: row.id,
      provider: 'local',
      filePath: row.file_path,
      url: null,
      mimeType: row.mime_type ?? mimeTypeForVideoPath(row.file_path),
      playableInApp: isBrowserPlayableVideo(row.file_path),
    };
  }

  async resolveStreams(videoId: string): Promise<MvResolvedStreams> {
    const inFlight = this.resolveStreamsInFlight.get(videoId);
    if (inFlight) {
      return inFlight;
    }

    const task = this.resolveStreamsWithDatabaseRecovery(videoId);
    this.resolveStreamsInFlight.set(videoId, task);

    try {
      return await task;
    } finally {
      if (this.resolveStreamsInFlight.get(videoId) === task) {
        this.resolveStreamsInFlight.delete(videoId);
      }
    }
  }

  private async resolveStreamsWithDatabaseRecovery(videoId: string): Promise<MvResolvedStreams> {
    try {
      return await this.resolveStreamsUnsafe(videoId);
    } catch (error) {
      if (!isSqliteCorruptionError(error)) {
        throw error;
      }

      this.reportMvDatabaseUnavailable('resolveStreams', error);
      throw createMvDatabaseUnavailableError('resolveStreams');
    }
  }

  private async resolvePlayableCandidateForSelection(videoId: string): Promise<MvResolvedStreams> {
    const resolved = await this.resolveStreams(videoId);
    if (isPlayableTrackVideo(resolved.video)) {
      return resolved;
    }

    try {
      const refreshed = await this.resolveStreamsUnsafe(videoId, { forceRefresh: true });
      return isPlayableTrackVideo(refreshed.video) ? refreshed : resolved;
    } catch {
      return resolved;
    }
  }

  private async resolveStreamsUnsafe(videoId: string, options: { forceRefresh?: boolean } = {}): Promise<MvResolvedStreams> {
    const row = this.requireRow(videoId);
    if (row.provider === 'local') {
      return { video: this.mapRow(row), variants: [] };
    }

    const providerId = providerName(row.provider);
    if (providerId !== 'bilibili' && providerId !== 'youtube') {
      return { video: this.mapRow(row), variants: [] };
    }

    const settings = this.getSettings();
    let variants = this.getValidStreamRows(row.id);

    if (options.forceRefresh || variants.length === 0 || !variants.some(isPlayableStreamRow) || this.shouldRefreshResolvedStreams(row, variants, settings)) {
      const provider = this.onlineProviderMap.get(providerId);
      if (!provider) {
        throw new Error(`MV provider ${providerId} is unavailable`);
      }

      try {
        const resolvedVariants = await provider.resolve(this.mapRow(row), settings);
        const resolveIssue = unavailableRawProviderJsonFromResolvedVariants(resolvedVariants);
        if (resolvedVariants.some(isPlayableResolvedVariant)) {
          this.lastResolveIssueByVideoId.delete(row.id);
        } else if (resolveIssue) {
          this.lastResolveIssueByVideoId.set(row.id, resolveIssue);
        } else {
          this.lastResolveIssueByVideoId.delete(row.id);
        }
        this.cacheResolvedStreams(row, resolvedVariants);
      } catch (error) {
        if (!this.getStreamRows(row.id).some(isPlayableStreamRow)) {
          throw error;
        }
      }
      variants = this.getValidStreamRows(row.id);
    }

    this.applySelectedStreamSnapshot(row.id);
    return {
      video: this.mapRow(this.requireRow(row.id)),
      variants: this.getStreamRows(row.id).map(sanitizeVariant),
    };
  }

  async setQuality(videoId: string, qualityId: string): Promise<TrackVideo> {
    const row = this.requireRow(videoId);
    if (row.provider === 'local') {
      return this.mapRow(row);
    }

    if (qualityId !== 'auto' && !qualityId.trim()) {
      throw new Error('qualityId must be auto or a variant id');
    }

    await this.resolveStreams(videoId);
    const variants = this.getValidStreamRows(videoId);
    if (qualityId !== 'auto' && !variants.some((variant) => variant.variant_id === qualityId)) {
      throw new Error(`Unknown MV quality ${qualityId}`);
    }

    const timestamp = nowIso();
    this.database
      .prepare('UPDATE track_videos SET selected_quality_id = ?, updated_at = ? WHERE id = ?')
      .run(qualityId, timestamp, videoId);
    this.applySelectedStreamSnapshot(videoId);

    return this.mapRow(this.requireRow(videoId));
  }

  async refreshStreamVariantForProtocol(videoId: string, variantId: string): Promise<StreamVariantForProtocol | null> {
    const row = this.getRow(videoId);
    if (!row || row.provider === 'local') {
      return null;
    }

    try {
      await this.resolveStreamsUnsafe(videoId, { forceRefresh: true });
    } catch {
      return null;
    }

    const refreshedRow = this.requireRow(videoId);
    const refreshedVariant = this.getStreamRow(videoId, variantId);
    const selectedVariant = isPlayableStreamRow(refreshedVariant)
      ? refreshedVariant
      : this.chooseStreamVariant(refreshedRow, this.getPlaybackStreamRows(videoId));

    if (!isPlayableStreamRow(selectedVariant)) {
      return null;
    }

    return {
      videoId,
      variantId: selectedVariant.variant_id,
      url: selectedVariant.url,
      headers: parseHeaders(selectedVariant.headers_json),
      mimeType: selectedVariant.mime_type,
    };
  }

  setVideoOffset(trackId: string, offsetMs: number): TrackVideo | null {
    const selected = this.getSelectedVideo(trackId);
    if (!selected) {
      return null;
    }

    const timestamp = nowIso();
    this.database
      .prepare('UPDATE track_videos SET offset_ms = ?, updated_at = ? WHERE id = ? AND track_id = ?')
      .run(clampMvOffsetMs(offsetMs), timestamp, selected.id, trackId);

    return this.getSelectedVideo(trackId);
  }

  async getStreamVariantForProtocol(videoId: string, variantId: string): Promise<StreamVariantForProtocol | null> {
    const row = this.getRow(videoId);
    if (!row || row.provider === 'local') {
      return null;
    }

    let variant = this.getStreamRow(videoId, variantId);
    if (!variant) {
      await this.resolveStreams(videoId);
      variant = this.getStreamRow(videoId, variantId);
    } else if (this.isExpired(variant)) {
      try {
        await this.resolveStreams(videoId);
        variant = this.getStreamRow(videoId, variantId) ?? variant;
      } catch {
        // Keep serving the stale cached URL if the provider refresh failed.
      }
    }

    if (!isPlayableStreamRow(variant)) {
      return null;
    }

    return {
      videoId,
      variantId,
      url: variant.url,
      headers: parseHeaders(variant.headers_json),
      mimeType: variant.mime_type,
    };
  }

  getTemporaryStreamVariantForProtocol(token: string): StreamVariantForProtocol | null {
    this.pruneExpiredEphemeralStreams();
    const entry = this.ephemeralStreams.get(token);
    if (!entry || entry.expiresAtMs <= Date.now()) {
      if (entry) {
        this.ephemeralStreams.delete(token);
      }
      return null;
    }

    return {
      videoId: 'ephemeral',
      variantId: entry.token,
      url: entry.url,
      headers: entry.headers,
      mimeType: entry.mimeType,
    };
  }

  private getExistingTrack(trackId: string): LibraryTrack {
    const track = this.library.getTrack(trackId);
    if (!track) {
      throw new Error(`Unknown track ${trackId}`);
    }

    return track;
  }

  private getExistingTrackOrStreamingPlaceholder(trackId: string): LibraryTrack {
    const track = this.library.getTrack(trackId);
    if (track) {
      return track;
    }

    const streamingMatch = streamingTrackIdPattern.exec(trackId);
    if (!streamingMatch) {
      throw new Error(`Unknown track ${trackId}`);
    }

    return {
      id: trackId,
      mediaType: 'streaming',
      isTemporary: true,
      path: trackId,
      sourceId: streamingMatch[1],
      provider: streamingMatch[1],
      providerTrackId: streamingMatch[2],
      stableKey: trackId,
      title: 'Streaming track',
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      albumArtist: 'Unknown Artist',
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: 0,
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
      coverId: null,
      coverThumb: null,
      fieldSources: {
        title: 'streaming-id',
        artist: 'streaming-id',
        album: 'streaming-id',
      },
    };
  }

  private trackSnapshotToLibraryTrack(request: MvTrackSnapshotSearchRequest): LibraryTrack {
    return {
      id: request.trackId,
      mediaType: request.mediaType ?? 'streaming',
      path: request.trackId,
      stableKey: request.trackId,
      title: request.title,
      artist: request.artist,
      album: request.album ?? 'Unknown Album',
      albumArtist: request.albumArtist ?? request.artist,
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: request.durationSeconds ?? 0,
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
      coverId: null,
      coverThumb: request.coverThumb ?? null,
      fieldSources: {
        title: 'snapshot',
        artist: 'snapshot',
        album: 'snapshot',
      },
    };
  }

  private temporaryVideoFromCandidate(
    track: LibraryTrack,
    candidate: MvMatchCandidate,
    variant: ResolvedMvStreamVariant | null,
    token: string | null,
  ): TrackVideo {
    const timestamp = nowIso();
    const provider = providerName(candidate.provider);
    return {
      id: token ? `temporary:${token}` : `temporary:${provider}:${sourceIdForCandidate(candidate)}`,
      trackId: track.id,
      provider,
      sourceType: 'stream',
      sourceId: sourceIdForCandidate(candidate),
      title: candidate.title,
      artist: candidate.artist,
      url: candidate.providerUrl ?? candidate.url,
      providerUrl: candidate.providerUrl ?? candidate.url,
      thumbnailUrl: candidate.thumbnailUrl,
      filePath: null,
      mediaUrl: token ? `echo-mv://ephemeral/${encodeURIComponent(token)}` : null,
      mimeType: variant?.mimeType ?? null,
      durationSeconds: candidate.durationSeconds,
      width: variant?.width ?? null,
      height: variant?.height ?? null,
      selectedQualityId: null,
      qualityLabel: variant?.label ?? null,
      fps: variant?.fps ?? null,
      offsetMs: 0,
      score: Number(candidate.score ?? 0),
      selected: true,
      playableInApp: Boolean(token && variant?.url && variant.playableInApp && variant.protocol !== 'external'),
      temporary: true,
      rawProviderJson: {
        temporary: true,
        sourceCandidateId: candidate.id,
        reasons: candidate.reasons,
        viewCount: candidate.viewCount ?? null,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private upsertLocalCandidate(track: LibraryTrack, candidate: MvMatchCandidate): MvMatchCandidate {
    if (!candidate.filePath) {
      return { ...candidate, filePath: null };
    }

    const normalizedPath = resolve(candidate.filePath);
    const sourceId = fileHashId(normalizedPath);
    const existing = this.database
      .prepare<[string, string, string], TrackVideoRow>(
        `SELECT * FROM track_videos
         WHERE track_id = ? AND provider = ? AND source_id = ?
         LIMIT 1`,
      )
      .get(track.id, 'local', sourceId);
    const id = existing?.id ?? randomUUID();
    const timestamp = nowIso();

    this.database
      .prepare(
        `INSERT INTO track_videos (
          id, track_id, provider, source_type, source_id, title, artist, url, provider_url, thumbnail_url, file_path,
          mime_type, duration_seconds, width, height, selected_quality_id, quality_label, fps, raw_provider_json,
          score, selected, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          artist = excluded.artist,
          url = excluded.url,
          provider_url = excluded.provider_url,
          thumbnail_url = excluded.thumbnail_url,
          file_path = excluded.file_path,
          mime_type = excluded.mime_type,
          duration_seconds = excluded.duration_seconds,
          width = excluded.width,
          height = excluded.height,
          selected_quality_id = excluded.selected_quality_id,
          quality_label = excluded.quality_label,
          fps = excluded.fps,
          raw_provider_json = excluded.raw_provider_json,
          score = excluded.score,
          updated_at = excluded.updated_at`,
      )
      .run(
        id,
        track.id,
        'local',
        candidate.sourceType,
        sourceId,
        candidate.title,
        candidate.artist,
        null,
        null,
        null,
        normalizedPath,
        mimeTypeForVideoPath(normalizedPath),
        candidate.durationSeconds,
        null,
        null,
        null,
        null,
        null,
        null,
        candidate.score,
        0,
        existing?.created_at ?? timestamp,
        timestamp,
      );

    return {
      ...candidate,
      id,
      filePath: null,
      playableInApp: isBrowserPlayableVideo(normalizedPath) && existsSync(normalizedPath),
    };
  }

  private async persistNetworkCandidatesWithRepair(
    track: LibraryTrack,
    candidates: MvMatchCandidate[],
    settings: MvSettings,
  ): Promise<MvMatchCandidate[]> {
    try {
      return await this.persistNetworkCandidates(track, candidates, settings);
    } catch (error) {
      if (!isSqliteCorruptionError(error)) {
        throw error;
      }

      this.reportMvDatabaseUnavailable('persistNetworkCandidates', error);
      throw createMvDatabaseUnavailableError('persistNetworkCandidates');
    }
  }

  private async persistNetworkCandidates(track: LibraryTrack, candidates: MvMatchCandidate[], settings: MvSettings): Promise<MvMatchCandidate[]> {
    const upsertedCandidates = this.database.transaction(() => candidates.map((candidate) => this.upsertNetworkCandidate(track, candidate)))();

    if (settings.autoSearch && this.shouldAutoSelectNetworkCandidate(track.id)) {
      await this.selectFirstResolvedAutoCandidate(track.id, upsertedCandidates, settings);
    }

    return upsertedCandidates;
  }

  private reportMvDatabaseUnavailable(operation: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : null;
    console.warn('[mv] SQLite MV database unavailable; preserving MV rows and allowing temporary playback fallback.', {
      operation,
      code,
      message,
      database: this.databaseDiagnostics(),
    });
  }

  private reportTemporaryMvFallback(operation: string, video: TrackVideo): void {
    console.warn('[mv] Using temporary MV playback without writing the library database.', {
      operation,
      trackId: video.trackId,
      provider: video.provider,
      sourceId: video.sourceId,
      qualityLabel: video.qualityLabel,
      database: this.databaseDiagnostics(),
    });
  }

  private databaseDiagnostics(): { path: string | null; files: Record<string, number | null> } {
    const databasePath = (this.database as { name?: string }).name ?? null;
    if (!databasePath || databasePath === ':memory:') {
      return { path: databasePath, files: {} };
    }

    const size = (path: string): number | null => {
      try {
        return statSync(path).size;
      } catch {
        return null;
      }
    };

    return {
      path: databasePath,
      files: {
        db: size(databasePath),
        wal: size(`${databasePath}-wal`),
        shm: size(`${databasePath}-shm`),
      },
    };
  }

  private repairMvStreamStorage(error: unknown): void {
    console.warn('[mv] SQLite MV stream storage is corrupt; resetting MV stream cache table.', error);
    resetMvStreamStorage(this.database);
  }

  private purgeKnownBadBilibiliStreamCache(): void {
    try {
      const result = this.database
        .prepare(
          `DELETE FROM track_video_streams
           WHERE provider = 'bilibili'
             AND (
               protocol = 'external'
               OR (
                 protocol = 'direct'
                 AND raw_json NOT LIKE '%"mutedVideoOnly":true%'
                 AND (
                   variant_id LIKE 'bilibili-dash-qn-%'
                   OR url LIKE '%.m4s%'
                   OR raw_json LIKE '%"source":"dash-video"%'
                   OR raw_json LIKE '%"resolver":"bilibili-dash-video-v4"%'
                 )
               )
             )`,
        )
        .run();

      if (result.changes > 0) {
        console.warn('[mv] Cleared stale Bilibili MV stream cache rows.', {
          rows: result.changes,
          database: this.databaseDiagnostics(),
        });
      }
    } catch (error) {
      console.warn('[mv] Failed to clear stale Bilibili MV stream cache rows.', error);
    }
  }

  private upsertNetworkCandidate(track: LibraryTrack, candidate: MvMatchCandidate): MvMatchCandidate {
    const sourceId = sourceIdForCandidate(candidate);
    const existing = this.database
      .prepare<[string, string, string], TrackVideoRow>(
        `SELECT * FROM track_videos
         WHERE track_id = ? AND provider = ? AND source_id = ?
         LIMIT 1`,
      )
      .get(track.id, candidate.provider, sourceId);
    const id = existing?.id ?? randomUUID();
    const timestamp = nowIso();
    const providerUrl = candidate.providerUrl ?? candidate.url;

    this.database
      .prepare(
        `INSERT INTO track_videos (
          id, track_id, provider, source_type, source_id, title, artist, url, provider_url, thumbnail_url, file_path,
          mime_type, duration_seconds, width, height, selected_quality_id, quality_label, fps, raw_provider_json,
          score, selected, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          artist = excluded.artist,
          url = excluded.url,
          provider_url = excluded.provider_url,
          thumbnail_url = excluded.thumbnail_url,
          duration_seconds = excluded.duration_seconds,
          raw_provider_json = excluded.raw_provider_json,
          score = excluded.score,
          updated_at = excluded.updated_at`,
      )
      .run(
        id,
        track.id,
        candidate.provider,
        'search_candidate',
        sourceId,
        candidate.title,
        candidate.artist,
        providerUrl,
        providerUrl,
        candidate.thumbnailUrl,
        null,
        null,
        candidate.durationSeconds,
        null,
        null,
        existing?.selected_quality_id ?? 'auto',
        null,
        null,
        JSON.stringify({
          uploader: candidate.uploader,
          reasons: candidate.reasons,
          viewCount: candidate.viewCount ?? null,
        }),
        candidate.score,
        existing?.selected ?? 0,
        existing?.created_at ?? timestamp,
        timestamp,
      );

    return {
      ...candidate,
      id,
      filePath: null,
      providerUrl,
      url: providerUrl,
    };
  }

  private cacheResolvedStreams(row: TrackVideoRow, variants: ResolvedMvStreamVariant[]): void {
    if (!variants.some(isPlayableResolvedVariant) && this.getStreamRows(row.id).some(isPlayableStreamRow)) {
      return;
    }

    try {
      this.writeResolvedStreams(row, variants);
    } catch (error) {
      if (!isSqliteCorruptionError(error)) {
        throw error;
      }

      this.repairMvStreamStorage(error);
      this.writeResolvedStreams(row, variants);
    }
  }

  private writeResolvedStreams(row: TrackVideoRow, variants: ResolvedMvStreamVariant[]): void {
    const timestamp = nowIso();
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM track_video_streams WHERE video_id = ?').run(row.id);

      for (const variant of variants) {
        this.database
          .prepare(
            `INSERT INTO track_video_streams (
              id, video_id, provider, variant_id, label, quality_tier, width, height, fps, codec, container,
              mime_type, protocol, url, headers_json, playable_in_app, requires_account, expires_at, raw_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            row.id,
            row.provider,
            variant.id,
            variant.label,
            variant.qualityTier,
            variant.width,
            variant.height,
            variant.fps,
            variant.codec,
            variant.container,
            variant.mimeType,
            variant.protocol,
            variant.url,
            JSON.stringify(variant.headers ?? {}),
            variant.playableInApp ? 1 : 0,
            variant.requiresAccount ? 1 : 0,
            variant.expiresAt,
            variant.rawProviderJson ? JSON.stringify(variant.rawProviderJson) : null,
            timestamp,
            timestamp,
          );
      }
    })();
  }

  private shouldAutoSelectNetworkCandidate(trackId: string): boolean {
    const selected = this.getSelectedVideo(trackId);
    if (!selected) {
      return true;
    }

    return selected.sourceType === 'search_candidate' && (!selected.playableInApp || !selected.mediaUrl);
  }

  private async selectFirstResolvedAutoCandidate(
    trackId: string,
    candidates: MvMatchCandidate[],
    settings: MvSettings,
  ): Promise<TrackVideo | null> {
    for (const candidate of this.rankAutoCandidates(candidates, settings)) {
      try {
        const resolved = await this.resolvePlayableCandidateForSelection(candidate.id);
        if (resolved.video.playableInApp && resolved.video.mediaUrl) {
          return this.commitSelectedVideo(trackId, candidate.id);
        }
      } catch {
        // Try the next matching candidate; search results can include videos that only open externally.
      }
    }

    return null;
  }

  private commitSelectedVideo(trackId: string, videoId: string): TrackVideo {
    const timestamp = nowIso();
    return this.database.transaction(() => {
      this.database.prepare('UPDATE track_videos SET selected = 0, updated_at = ? WHERE track_id = ?').run(timestamp, trackId);
      this.database.prepare('UPDATE track_videos SET selected = 1, updated_at = ? WHERE id = ?').run(timestamp, videoId);
      return this.mapRow(this.getRow(videoId)!);
    })();
  }

  private applySelectedStreamSnapshot(videoId: string): void {
    const row = this.requireRow(videoId);
    const variants = this.getPlaybackStreamRows(videoId);
    const selected = this.chooseStreamVariant(row, variants);
    const requestedQualityId = row.selected_quality_id ?? 'auto';
    const requestedVariant = requestedQualityId !== 'auto' ? variants.find((variant) => variant.variant_id === requestedQualityId) : null;
    const nextSelectedQualityId =
      requestedQualityId !== 'auto' && !isPlayableStreamRow(requestedVariant)
        ? 'auto'
        : requestedQualityId;
    const timestamp = nowIso();

    this.database
      .prepare(
        `UPDATE track_videos
         SET width = ?, height = ?, fps = ?, mime_type = ?, quality_label = ?, selected_quality_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        selected?.width ?? null,
        selected?.height ?? null,
        selected?.fps ?? null,
        selected?.mime_type ?? null,
        selected?.label ?? null,
        nextSelectedQualityId,
        timestamp,
        videoId,
      );
  }

  private chooseStreamVariant(row: TrackVideoRow, variants: TrackVideoStreamRow[]): TrackVideoStreamRow | null {
    const selectedQualityId = row.selected_quality_id ?? 'auto';
    if (selectedQualityId !== 'auto') {
      const selected = variants.find((variant) => variant.variant_id === selectedQualityId);
      if (isPlayableStreamRow(selected)) {
        return selected;
      }
    }

    const settings = this.getSettings();
    return (
      [...variants]
        .filter(isPlayableStreamRow)
        .filter((variant) => {
          if (row.provider === 'bilibili') {
            const qn = bilibiliQnFromRaw(variant);
            return qn ? qn <= maxBilibiliQnForSettings(settings) : !variant.height || variant.height <= maxQualityHeight(settings.maxQuality);
          }

          return !variant.height || variant.height <= maxQualityHeight(settings.maxQuality);
        })
        .filter((variant) => {
          if (settings.allow60fps !== false) {
            return true;
          }

          const qn = row.provider === 'bilibili' ? bilibiliQnFromRaw(variant) : null;
          return qn !== 116 && (!variant.fps || variant.fps < 55);
        })
        .sort((left, right) => {
          if (row.provider === 'bilibili') {
            const rankDelta = bilibiliRankFromRaw(right) - bilibiliRankFromRaw(left);
            if (rankDelta !== 0) {
              return rankDelta;
            }

            const mutedVideoOnlyDelta = Number(isBilibiliMutedVideoOnlyStream(left)) - Number(isBilibiliMutedVideoOnlyStream(right));
            if (mutedVideoOnlyDelta !== 0) {
              return mutedVideoOnlyDelta;
            }
          }

          const heightDelta = (right.height ?? 0) - (left.height ?? 0);
          if (heightDelta !== 0) {
            return heightDelta;
          }
          const fpsDelta = (right.fps ?? 0) - (left.fps ?? 0);
          if (fpsDelta !== 0) {
            return fpsDelta;
          }

          return (right.codec ?? '').localeCompare(left.codec ?? '');
        })[0] ?? null
    );
  }

  private chooseResolvedStreamVariant(
    providerId: NetworkMvProviderId,
    variants: ResolvedMvStreamVariant[],
    settings: MvSettings,
  ): ResolvedMvStreamVariant | null {
    return (
      [...variants]
        .filter(isPlayableResolvedVariant)
        .filter((variant) => {
          if (providerId === 'bilibili') {
            const qn = bilibiliQnFromResolved(variant);
            return qn ? qn <= maxBilibiliQnForSettings(settings) : !variant.height || variant.height <= maxQualityHeight(settings.maxQuality);
          }

          return !variant.height || variant.height <= maxQualityHeight(settings.maxQuality);
        })
        .filter((variant) => {
          if (settings.allow60fps !== false) {
            return true;
          }

          const qn = providerId === 'bilibili' ? bilibiliQnFromResolved(variant) : null;
          return qn !== 116 && (!variant.fps || variant.fps < 55);
        })
        .sort((left, right) => {
          if (providerId === 'bilibili') {
            const rankDelta = bilibiliRankFromResolved(right) - bilibiliRankFromResolved(left);
            if (rankDelta !== 0) {
              return rankDelta;
            }

            const mutedVideoOnlyDelta = Number(isBilibiliMutedVideoOnlyResolved(left)) - Number(isBilibiliMutedVideoOnlyResolved(right));
            if (mutedVideoOnlyDelta !== 0) {
              return mutedVideoOnlyDelta;
            }
          }

          const heightDelta = (right.height ?? 0) - (left.height ?? 0);
          if (heightDelta !== 0) {
            return heightDelta;
          }
          const fpsDelta = (right.fps ?? 0) - (left.fps ?? 0);
          if (fpsDelta !== 0) {
            return fpsDelta;
          }

          return (right.codec ?? '').localeCompare(left.codec ?? '');
        })[0] ?? null
    );
  }

  private registerEphemeralStream(variant: ResolvedMvStreamVariant): string {
    this.pruneExpiredEphemeralStreams();
    const token = randomUUID();
    const providerExpiry = variant.expiresAt ? Date.parse(variant.expiresAt) : Number.NaN;
    const defaultExpiry = Date.now() + ephemeralMvStreamTtlMs;
    const expiresAtMs = Number.isFinite(providerExpiry) && providerExpiry > Date.now() ? Math.min(providerExpiry, defaultExpiry) : defaultExpiry;
    this.ephemeralStreams.set(token, {
      token,
      url: variant.url!,
      headers: variant.headers ?? {},
      mimeType: variant.mimeType,
      expiresAtMs,
    });
    return token;
  }

  private pruneExpiredEphemeralStreams(): void {
    const now = Date.now();
    for (const [token, entry] of this.ephemeralStreams) {
      if (entry.expiresAtMs <= now) {
        this.ephemeralStreams.delete(token);
      }
    }
  }

  private getRow(videoId: string): TrackVideoRow | null {
    return this.database.prepare<[string], TrackVideoRow>('SELECT * FROM track_videos WHERE id = ?').get(videoId) ?? null;
  }

  private requireRow(videoId: string): TrackVideoRow {
    const row = this.getRow(videoId);
    if (!row) {
      throw new Error(`Unknown MV video ${videoId}`);
    }

    return row;
  }

  private getStreamRows(videoId: string): TrackVideoStreamRow[] {
    try {
      return this.database
        .prepare<[string], TrackVideoStreamRow>(
          `SELECT * FROM track_video_streams
           WHERE video_id = ?
           ORDER BY playable_in_app DESC, height DESC, fps DESC, updated_at DESC`,
        )
        .all(videoId);
    } catch (error) {
      if (isSqliteCorruptionError(error)) {
        this.repairMvStreamStorage(error);
        return [];
      }

      throw error;
    }
  }

  private getValidStreamRows(videoId: string): TrackVideoStreamRow[] {
    return this.getStreamRows(videoId).filter((variant) => !this.isExpired(variant));
  }

  private getPlaybackStreamRows(videoId: string): TrackVideoStreamRow[] {
    const rows = this.getStreamRows(videoId);
    const validRows = rows.filter((variant) => !this.isExpired(variant));
    return validRows.some(isPlayableStreamRow) ? validRows : rows;
  }

  private getStreamRow(videoId: string, variantId: string): TrackVideoStreamRow | null {
    try {
      return (
        this.database
          .prepare<[string, string], TrackVideoStreamRow>(
            `SELECT * FROM track_video_streams
             WHERE video_id = ? AND variant_id = ?
             LIMIT 1`,
          )
          .get(videoId, variantId) ?? null
      );
    } catch (error) {
      if (isSqliteCorruptionError(error)) {
        this.repairMvStreamStorage(error);
        return null;
      }

      throw error;
    }
  }

  private isExpired(variant: TrackVideoStreamRow): boolean {
    return Boolean(variant.expires_at && Date.parse(variant.expires_at) <= Date.now());
  }

  private shouldRefreshResolvedStreams(row: TrackVideoRow, variants: TrackVideoStreamRow[], settings: MvSettings): boolean {
    if (row.provider !== 'bilibili' || variants.length === 0 || maxQualityHeight(settings.maxQuality) <= 720) {
      return false;
    }

    if (variants.some(isLegacyCodecCollapsedBilibiliDashVariant)) {
      return true;
    }

    const hasCurrentResolver = variants.some((variant) => {
      const raw = recordFromJson(variant.raw_json);
      return Boolean(
          raw &&
          raw.resolver === 'bilibili-dash-video-v4' &&
          Number.isFinite(Number(raw.qualityRank)),
      );
    });

    if (!hasCurrentResolver) {
      return true;
    }

    const highestRequestedQn = variants.reduce((highest, variant) => {
      const raw = recordFromJson(variant.raw_json);
      if (!raw) {
        return highest;
      }

      const requestedQn = Number(raw.requestedQn);
      return Number.isFinite(requestedQn) ? Math.max(highest, requestedQn) : highest;
    }, 0);

    return highestRequestedQn < maxBilibiliQnForSettings(settings);
  }

  private rankAutoCandidates<T extends Pick<TrackVideo | MvMatchCandidate, 'id' | 'provider' | 'playableInApp' | 'score'> & { viewCount?: number | null }>(
    candidates: T[],
    settings: MvSettings,
  ): T[] {
    const enabledProviders = new Set(settings.enabledProviders);
    const providerRank = (provider: MvProviderId): number => {
      if (provider === 'local') {
        return -1;
      }

      const index = settings.providerOrder.indexOf(provider as NetworkMvProviderId);
      return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
    };

    return [...candidates]
      .filter((candidate) => candidate.provider === 'local' || enabledProviders.has(candidate.provider as NetworkMvProviderId))
      .filter((candidate) => candidate.playableInApp)
      .filter((candidate) => settings.preferHighestViewCount || candidate.score >= normalizeAutoApplyThreshold(settings.autoApplyThreshold))
      .sort((left, right) => {
        if (settings.preferHighestViewCount) {
          const viewDelta = (right.viewCount ?? -1) - (left.viewCount ?? -1);
          if (viewDelta !== 0) {
            return viewDelta;
          }
        }

        const scoreDelta = right.score - left.score;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        const viewDelta = (right.viewCount ?? -1) - (left.viewCount ?? -1);
        if (viewDelta !== 0) {
          return viewDelta;
        }

        return providerRank(left.provider) - providerRank(right.provider);
      });
  }

  private mapRow(row: TrackVideoRow): TrackVideo {
    const fileExists = row.provider !== 'local' || !row.file_path || existsSync(row.file_path);
    const localPlayable = row.provider === 'local' && Boolean(row.file_path) && fileExists && isBrowserPlayableVideo(row.file_path ?? '');
    const streamRows = row.provider === 'local' ? [] : this.getPlaybackStreamRows(row.id);
    const selectedStream = row.provider === 'local' ? null : this.chooseStreamVariant(row, streamRows);
    const streamPlayable = isPlayableStreamRow(selectedStream);
    const provider = providerName(row.provider);
    const useRowSnapshot = provider === 'local';
    const rawProviderJson = parseJson(row.raw_provider_json);
    const resolveIssue = this.lastResolveIssueByVideoId.get(row.id) ?? unavailableRawProviderJsonFromStreamRows(streamRows);

    return {
      id: row.id,
      trackId: row.track_id,
      provider,
      sourceType: sourceType(row.source_type),
      sourceId: row.source_id,
      title: row.title,
      artist: row.artist,
      url: row.url,
      providerUrl: row.provider_url ?? row.url,
      thumbnailUrl: row.thumbnail_url,
      filePath: null,
      mediaUrl: localPlayable ? mediaUrlForLocal(row) : mediaUrlForStream(row, selectedStream),
      mimeType: selectedStream?.mime_type ?? (useRowSnapshot ? row.mime_type : null),
      durationSeconds: row.duration_seconds,
      width: selectedStream?.width ?? (useRowSnapshot ? row.width : null),
      height: selectedStream?.height ?? (useRowSnapshot ? row.height : null),
      selectedQualityId: provider === 'local' ? null : (row.selected_quality_id ?? 'auto'),
      qualityLabel: selectedStream?.label ?? (useRowSnapshot ? row.quality_label : null),
      fps: selectedStream?.fps ?? (useRowSnapshot ? row.fps : null),
      offsetMs: clampMvOffsetMs(Number(row.offset_ms ?? 0)),
      score: Number(row.score ?? 0),
      selected: row.selected === 1,
      playableInApp: localPlayable || streamPlayable,
      rawProviderJson: mergeRawProviderJson(rawProviderJson, resolveIssue),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

let defaultMvService: MvService | null = null;

export const getMvService = (): MvService => {
  assertProtectedLibraryAvailable();
  if (!defaultMvService) {
    const electronApp = (electron as unknown as { app?: { getPath: (name: string) => string } }).app;

    if (!electronApp) {
      throw new Error('Electron app module is unavailable outside the Electron main process');
    }

    const databaseConnection = getLibraryDatabaseManager().openServiceConnection('mv');
    defaultMvService = new MvService(
      databaseConnection.database,
      {
        getTrack: (trackId) => getLibraryService().getTrack(trackId),
      },
      undefined,
      undefined,
      undefined,
      databaseConnection.close,
    );
  }

  return defaultMvService;
};

export const closeDefaultMvService = (): void => {
  if (!defaultMvService) {
    return;
  }

  defaultMvService.close();
  defaultMvService = null;
};
