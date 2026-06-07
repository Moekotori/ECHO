import { createHash, randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import electron from 'electron';
import type { EchoDatabase } from '../database/createDatabase';
import { getLibraryDatabaseManager } from '../database/LibraryDatabaseManager';
import { defaultSettings, getAppSettings } from '../app/appSettings';
import { assertProtectedLibraryAvailable } from '../app/dataProtection';
import { getLibraryService } from '../library/LibraryService';
import type { LibraryTrack } from '../../shared/types/library';
import type { AppSettings } from '../../shared/types/appSettings';
import type {
  LyricsMatchRisk,
  LyricsEmbedToTrackRequest,
  LyricsEmbedToTrackResult,
  LyricsEmbedTextKind,
  LyricsProviderId,
  LyricsQuery,
  LyricsSearchCandidate,
  LyricsSource,
  LyricsTrackSnapshotRequest,
  TrackLyrics,
} from '../../shared/types/lyrics';
import {
  deserializeLyricLines,
  normalizeSyncedLyricAlternates,
  parsePlainLyrics,
  parseSyncedLyrics,
  serializeLyricLines,
} from './lyricsParser';
import { normalizeText, normalizeTextForIdentity } from './lyricsScoring';
import { LocalLyricsProvider } from './LocalLyricsProvider';
import { LrclibProvider, mapLrclibRecordToTrackLyrics, type LrclibRecord } from './LrclibProvider';
import { AmllTtmlLyricsProvider } from './AmllTtmlLyricsProvider';
import { KugouLyricsProvider } from './KugouLyricsProvider';
import { KuwoLyricsProvider } from './KuwoLyricsProvider';
import { NeteaseLyricsProvider } from './NeteaseLyricsProvider';
import { QQMusicLyricsProvider } from './QQMusicLyricsProvider';
import { LyricsMatchEngine, type MatchedLyricsCandidate } from './LyricsMatchEngine';
import type { LyricsProvider, LyricsProviderResult } from './LyricsProvider';
import { providerResultToTrackLyrics, StubLyricsProvider } from './LyricsProvider';
import { extractLyricsVersionFlags, serializeLyricsVersionFlags } from './lyricsVersionFlags';
import { sortLyricsCandidates } from './lyricsCandidateDedup';
import { fillMissingRomanization, hasMissingRomanization } from './lyricsRomanization';
import { hasJapaneseLyricsText, UtatenKanaProvider, type UtatenKanaProviderLike } from './UtatenKanaProvider';
import { writeEmbeddedLyricsTag } from '../library/TagWriter';

type LyricsSettings = Pick<
  AppSettings,
  | 'lyricsNetworkEnabled'
  | 'lyricsPreferredProvider'
  | 'lyricsEnabledProviders'
  | 'lyricsProviderOrder'
  | 'lyricsProviderTimeoutMs'
  | 'lyricsTotalMatchTimeoutMs'
  | 'lyricsAutoSearch'
  | 'lyricsDeepSearchEnabled'
  | 'lyricsAutoAcceptScore'
  | 'lyricsCoverAutoAcceptScore'
  | 'lyricsDefaultOffsetMs'
  | 'lyricsAutoSaveSidecarEnabled'
  | 'lyricsRomanizationEnabled'
  | 'lyricsUtatenKanaEnabled'
  | 'lyricsTranslationEnabled'
>;

export type LyricsLookupOptions = {
  enabledProviders?: LyricsProviderId[];
  networkEnabled?: boolean;
  autoSearch?: boolean;
  deepSearchEnabled?: boolean;
  providerTimeoutMs?: number;
  totalMatchTimeoutMs?: number;
  autoAcceptScore?: number;
  preferPrimaryProvider?: boolean;
  relaxedAutoAccept?: boolean;
};

type LibraryLookup = {
  getTrack: (trackId: string) => LibraryTrack | null;
};

type LocalProvider = Pick<LocalLyricsProvider, 'getLyrics' | 'searchCandidates' | 'getLyricsFromCandidate'> & Partial<LyricsProvider>;
type OnlineProvider = Pick<LrclibProvider, 'getLyrics' | 'searchCandidates'> & Partial<LyricsProvider>;

type LyricsCacheRow = {
  id: string;
  cache_key: string;
  track_id: string | null;
  provider: string;
  provider_lyrics_id: string | null;
  title: string;
  artist: string;
  album: string | null;
  duration_seconds: number | null;
  kind: string;
  plain_lyrics: string | null;
  synced_lyrics: string | null;
  lines_json: string;
  offset_ms: number;
  score: number | null;
  created_at: string;
  updated_at: string;
};

type LyricsCandidateRow = {
  id: string;
  track_id: string | null;
  provider: LyricsProviderId;
  provider_lyrics_id: string | null;
  title: string;
  artist: string;
  album: string | null;
  duration_seconds: number | null;
  instrumental: number;
  has_synced: number;
  has_plain: number;
  score: number;
  risk: LyricsMatchRisk | null;
  reasons_json: string | null;
  title_score: number | null;
  artist_score: number | null;
  album_score: number | null;
  duration_score: number | null;
  version_score: number | null;
  source_label: string;
  raw_json: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type StoredCandidate = LyricsSearchCandidate & {
  raw: unknown;
  status: string;
};

const nowIso = (): string => new Date().toISOString();
const clampOffset = (value: number): number => Math.max(-10000, Math.min(10000, Math.round(value)));

const isSqliteCorruptionError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  return code === 'SQLITE_CORRUPT' || /database disk image is malformed|database disk image malformed|SQLITE_CORRUPT/i.test(message);
};

const lyricsStorageSql = `
CREATE TABLE IF NOT EXISTS lyrics_cache (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  track_id TEXT,
  provider TEXT NOT NULL,
  provider_lyrics_id TEXT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  duration_seconds REAL,
  kind TEXT NOT NULL,
  plain_lyrics TEXT,
  synced_lyrics TEXT,
  lines_json TEXT NOT NULL,
  offset_ms INTEGER NOT NULL DEFAULT 0,
  score REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lyrics_candidates (
  id TEXT PRIMARY KEY,
  track_id TEXT,
  provider TEXT NOT NULL,
  provider_lyrics_id TEXT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  duration_seconds REAL,
  instrumental INTEGER NOT NULL DEFAULT 0,
  has_synced INTEGER NOT NULL DEFAULT 0,
  has_plain INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL,
  risk TEXT,
  reasons_json TEXT,
  title_score REAL,
  artist_score REAL,
  album_score REAL,
  duration_score REAL,
  version_score REAL,
  source_label TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lyrics_cache_track_provider ON lyrics_cache(track_id, provider);
CREATE INDEX IF NOT EXISTS idx_lyrics_cache_cache_key ON lyrics_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_lyrics_candidates_track_provider_status ON lyrics_candidates(track_id, provider, status);
`;

const resetLyricsStorage = (database: EchoDatabase): void => {
  database.exec(`
    DROP TABLE IF EXISTS lyrics_candidates;
    DROP TABLE IF EXISTS lyrics_cache;
    ${lyricsStorageSql}
  `);
};

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const numberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const hashJson = (value: unknown): string => createHash('sha1').update(JSON.stringify(value ?? {})).digest('hex');

const providerName = (value: string): LyricsSource => {
  if (
    value === 'none' ||
    value === 'local' ||
    value === 'lrclib' ||
    value === 'amll-ttml' ||
    value === 'netease' ||
    value === 'qqmusic' ||
    value === 'kugou' ||
    value === 'kuwo' ||
    value === 'musixmatch' ||
    value === 'genius' ||
    value === 'manual' ||
    value === 'cached'
  ) {
    return value;
  }

  return 'cached';
};

const isSearchableLyricsProvider = (value: unknown): value is LyricsProviderId =>
  value === 'local' ||
  value === 'lrclib' ||
  value === 'amll-ttml' ||
  value === 'netease' ||
  value === 'qqmusic' ||
  value === 'kugou' ||
  value === 'kuwo' ||
  value === 'musixmatch' ||
  value === 'genius';

const lyricsKind = (value: string): TrackLyrics['kind'] => {
  if (value === 'plain' || value === 'synced' || value === 'instrumental') {
    return value;
  }

  return 'empty';
};

const toQuery = (track: LibraryTrack): LyricsQuery => ({
  trackId: track.id,
  mediaType: track.mediaType ?? 'local',
  sourceId: track.sourceId ?? null,
  stableKey: track.stableKey ?? null,
  title: track.title || '',
  artist: track.artist || track.albumArtist || '',
  album: track.album || null,
  durationSeconds: track.duration > 0 ? track.duration : null,
  filePath: track.mediaType === 'remote' || track.mediaType === 'streaming' ? null : track.path,
});

const toManualSearchQuery = (track: LibraryTrack, searchText?: string | null): LyricsQuery => {
  const normalizedSearchText = textOrNull(searchText);
  if (!normalizedSearchText) {
    return toQuery(track);
  }

  return {
    trackId: track.id,
    title: normalizedSearchText,
    artist: '',
    album: null,
    durationSeconds: null,
    filePath: null,
  };
};

const toNetworkQuery = (query: LyricsQuery): LyricsQuery => ({
  trackId: query.trackId,
  mediaType: query.mediaType,
  sourceId: query.sourceId,
  stableKey: query.stableKey,
  title: query.title,
  artist: query.artist,
  album: query.album ?? null,
  durationSeconds: query.durationSeconds ?? null,
  filePath: null,
});

const toSnapshotQuery = (request: LyricsTrackSnapshotRequest): LyricsQuery => ({
  trackId: request.trackId,
  mediaType: request.mediaType ?? 'remote',
  sourceId: request.sourceId ?? null,
  stableKey: request.stableKey ?? request.trackId,
  title: request.title,
  artist: request.artist || request.albumArtist || 'Unknown Artist',
  album: request.album ?? null,
  durationSeconds: request.durationSeconds ?? null,
  filePath: null,
});

const toManualSnapshotSearchQuery = (request: LyricsTrackSnapshotRequest, searchText?: string | null): LyricsQuery => {
  const normalizedSearchText = textOrNull(searchText);
  if (!normalizedSearchText) {
    return toSnapshotQuery(request);
  }

  return {
    trackId: request.trackId,
    mediaType: request.mediaType ?? 'remote',
    sourceId: request.sourceId ?? null,
    stableKey: request.stableKey ?? request.trackId,
    title: normalizedSearchText,
    artist: '',
    album: null,
    durationSeconds: null,
    filePath: null,
  };
};

const cacheKeyFor = (query: LyricsQuery, provider: LyricsSource): string =>
  query.mediaType === 'remote' && query.sourceId && query.stableKey
    ? ['remote', query.sourceId, query.stableKey].join(':')
    : [
    provider,
    normalizeTextForIdentity(query.title),
    normalizeTextForIdentity(query.artist),
    normalizeTextForIdentity(query.album),
    query.durationSeconds ? String(Math.round(query.durationSeconds)) : '',
    serializeLyricsVersionFlags(extractLyricsVersionFlags(query.title, query.artist, query.album, query.filePath)),
  ].join('|');

const legacyCacheKeyFor = (query: LyricsQuery, provider: LyricsSource): string =>
  [
    provider,
    normalizeText(query.title),
    normalizeText(query.artist),
    normalizeText(query.album),
    query.durationSeconds ? String(Math.round(query.durationSeconds)) : '',
  ].join('|');

const allCacheKeysFor = (query: LyricsQuery): string[] =>
  ['local', 'lrclib', 'amll-ttml', 'manual', 'cached', 'netease', 'qqmusic', 'kugou', 'kuwo', 'musixmatch', 'genius'].flatMap((provider) => [
    cacheKeyFor(query, provider as LyricsSource),
    legacyCacheKeyFor(query, provider as LyricsSource),
  ]);

const remoteBrowserTrackIdPattern = /^remote-browser:([^:]+):(.+)$/u;

const escapeSqlLike = (value: string): string => value.replace(/[\\%_]/gu, '\\$&');

const remoteBrowserCacheKeyPrefixFor = (query: LyricsQuery): string | null => {
  if (query.mediaType !== 'remote' || !query.sourceId) {
    return null;
  }

  const candidates = [query.stableKey, query.trackId].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const trackIdMatch = candidate.match(remoteBrowserTrackIdPattern);
    if (trackIdMatch && trackIdMatch[1] === query.sourceId) {
      return `remote:${query.sourceId}:${query.sourceId}:${trackIdMatch[2]}:`;
    }

    const stableKeyPrefix = `${query.sourceId}:`;
    if (candidate.startsWith(stableKeyPrefix)) {
      const pathWithFingerprint = candidate.slice(stableKeyPrefix.length);
      const fingerprintSeparator = pathWithFingerprint.lastIndexOf(':');
      if (fingerprintSeparator > 0) {
        return `remote:${query.sourceId}:${query.sourceId}:${pathWithFingerprint.slice(0, fingerprintSeparator)}:`;
      }
    }
  }

  return null;
};

const parseRawJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
};

const lyricTimestamp = (timeMs: number): string => {
  const safeTimeMs = Math.max(0, Math.round(timeMs));
  const minutes = Math.floor(safeTimeMs / 60000);
  const seconds = Math.floor((safeTimeMs % 60000) / 1000);
  const centiseconds = Math.floor((safeTimeMs % 1000) / 10);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
};

const secondaryLinesToText = (lyrics: TrackLyrics, field: 'romanization' | 'translation'): string | null => {
  const lines = lyrics.lines
    .map((line) => {
      const text = line[field]?.trim();
      if (!text) {
        return null;
      }

      return lyrics.kind === 'synced' && line.timeMs >= 0 ? `${lyricTimestamp(line.timeMs)}${text}` : text;
    })
    .filter((line): line is string => Boolean(line));

  return lines.length ? lines.join('\n') : null;
};

const syncedLinesToText = (lyrics: TrackLyrics): string | null => {
  const lines = lyrics.lines
    .filter((line) => lyrics.kind === 'synced' && line.timeMs >= 0 && line.text.trim().length > 0)
    .map((line) => `${lyricTimestamp(line.timeMs)}${line.text.trim()}`);

  return lines.length ? lines.join('\n') : null;
};

const plainLinesToText = (lyrics: TrackLyrics): string | null => {
  const lines = lyrics.lines.map((line) => line.text.trim()).filter(Boolean);
  return lines.length ? lines.join('\n') : null;
};

const lyricsToEmbeddableText = (
  lyrics: TrackLyrics,
  preferSynced = true,
): { text: string; textKind: LyricsEmbedTextKind } | null => {
  const syncedText = lyrics.syncedText?.trim() || syncedLinesToText(lyrics);
  const plainText = lyrics.plainText?.trim() || plainLinesToText(lyrics);

  if (preferSynced && syncedText) {
    return { text: syncedText, textKind: 'synced' };
  }

  if (plainText) {
    return { text: plainText, textKind: 'plain' };
  }

  if (syncedText) {
    return { text: syncedText, textKind: 'synced' };
  }

  return null;
};

const lyricsToSidecarText = (lyrics: TrackLyrics): { text: string; extension: '.lrc' | '.ttml' | '.txt' } | null => {
  const syncedText = lyrics.syncedText?.trim() || syncedLinesToText(lyrics);
  if (syncedText) {
    return {
      text: syncedText,
      extension: /<tt(?:\s|>)/iu.test(syncedText) ? '.ttml' : '.lrc',
    };
  }

  const plainText = lyrics.plainText?.trim() || plainLinesToText(lyrics);
  return plainText ? { text: plainText, extension: '.txt' } : null;
};

const shouldAutoSaveSidecarLyrics = (query: LyricsQuery, lyrics: TrackLyrics): boolean =>
  Boolean(query.filePath) &&
  query.mediaType !== 'remote' &&
  query.mediaType !== 'streaming' &&
  lyrics.kind !== 'empty' &&
  lyrics.kind !== 'instrumental' &&
  lyrics.provider !== 'local' &&
  lyrics.provider !== 'cached' &&
  lyrics.provider !== 'none';

const sidecarLyricsExtensions = ['.lrc', '.ttml', '.txt'] as const;

const shouldDelayEmbeddedLyricsWriteForAudio = async (filePath: string): Promise<boolean> => {
  try {
    const { getAudioSession } = await import('../audio/AudioSession');
    const status = getAudioSession().getStatus();
    const currentFilePath = status.currentFilePath ? resolve(status.currentFilePath) : null;
    const targetPath = resolve(filePath);
    const audioPipelineBusy = status.state === 'loading' || status.state === 'playing';
    const currentFileHeld =
      currentFilePath === targetPath && !['idle', 'stopped', 'ended', 'error'].includes(status.state);

    return audioPipelineBusy || currentFileHeld;
  } catch {
    return false;
  }
};

const unrefTimer = (timer: ReturnType<typeof setTimeout>): void => {
  if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }
};

const trackLyricsToProviderResult = (lyrics: TrackLyrics): LyricsProviderResult => ({
  provider: lyrics.provider === 'cached' || lyrics.provider === 'none' ? 'manual' : lyrics.provider,
  providerLyricsId: lyrics.providerLyricsId ?? null,
  title: lyrics.title,
  artist: lyrics.artist,
  album: lyrics.album ?? null,
  durationSeconds: lyrics.durationSeconds ?? null,
  instrumental: lyrics.kind === 'instrumental',
  plainLyrics: lyrics.plainText ?? null,
  syncedLyrics: lyrics.syncedText ?? null,
  translationLyrics: secondaryLinesToText(lyrics, 'translation'),
  romanizationLyrics: secondaryLinesToText(lyrics, 'romanization'),
  raw: lyrics,
});

const normalizeLineIdentity = (value: string): string => value.replace(/\s+/g, ' ').trim();

const restoreWordTimingsFromSyncedText = (lines: TrackLyrics['lines'], syncedText: string | null): TrackLyrics['lines'] => {
  if (!syncedText || lines.some((line) => line.words?.length)) {
    return lines;
  }

  const reparsedLines = normalizeSyncedLyricAlternates(parseSyncedLyrics(syncedText));
  const reparsedByTime = new Map<number, TrackLyrics['lines'][number][]>();
  for (const line of reparsedLines) {
    if (!line.words?.length) {
      continue;
    }

    const bucket = reparsedByTime.get(line.timeMs) ?? [];
    bucket.push(line);
    reparsedByTime.set(line.timeMs, bucket);
  }

  let changed = false;
  const nextLines = lines.map((line) => {
    if (line.words?.length || line.timeMs < 0) {
      return line;
    }

    const candidates = reparsedByTime.get(line.timeMs) ?? [];
    const match = candidates.find((candidate) => normalizeLineIdentity(candidate.text) === normalizeLineIdentity(line.text));
    if (!match?.words?.length) {
      return line;
    }

    changed = true;
    return { ...line, words: match.words };
  });

  return changed ? nextLines : lines;
};

const shouldReplaceInvertedLocalLyricCache = (
  cachedLines: TrackLyrics['lines'],
  reparsedLines: TrackLyrics['lines'],
): boolean => {
  const reparsedByTime = new Map<number, TrackLyrics['lines'][number][]>();
  for (const line of reparsedLines) {
    if (!line.translation?.trim()) {
      continue;
    }

    const bucket = reparsedByTime.get(line.timeMs) ?? [];
    bucket.push(line);
    reparsedByTime.set(line.timeMs, bucket);
  }

  if (reparsedByTime.size === 0) {
    return false;
  }

  return cachedLines.some((line) => {
    const cachedText = normalizeLineIdentity(line.text);
    const cachedRomanization = normalizeLineIdentity(line.romanization ?? '');
    if (!cachedText || !cachedRomanization || line.translation?.trim()) {
      return false;
    }

    return (reparsedByTime.get(line.timeMs) ?? []).some(
      (candidate) =>
        normalizeLineIdentity(candidate.text) === cachedRomanization &&
        normalizeLineIdentity(candidate.translation ?? '') === cachedText,
    );
  });
};

const lrclibRecordToProviderResult = (record: LrclibRecord, fallback: LyricsQuery): LyricsProviderResult => ({
  provider: 'lrclib',
  providerLyricsId: record.id == null ? null : String(record.id),
  title: record.trackName ?? fallback.title,
  artist: record.artistName ?? fallback.artist,
  album: record.albumName ?? fallback.album ?? null,
  durationSeconds: record.duration ?? fallback.durationSeconds ?? null,
  instrumental: record.instrumental === true,
  plainLyrics: record.plainLyrics ?? null,
  syncedLyrics: record.syncedLyrics ?? null,
  raw: record,
});

const isLyricsProvider = (provider: Partial<LyricsProvider>): provider is LyricsProvider =>
  typeof provider.id === 'string' &&
  typeof provider.label === 'string' &&
  typeof provider.priority === 'number' &&
  typeof provider.search === 'function' &&
  Boolean(provider.capabilities);

const adaptLocalProvider = (provider: LocalProvider): LyricsProvider => {
  if (isLyricsProvider(provider)) {
    return provider;
  }

  return {
    id: 'local',
    label: 'Local',
    priority: 1000,
    capabilities: {
      synced: true,
      plain: true,
      translation: false,
      romanization: false,
      byDuration: false,
      byIsrc: false,
      byMusicBrainzId: false,
      needsAccount: false,
    },
    async search(request) {
      const lyrics = provider.getLyrics(request.query);
      return lyrics ? [trackLyricsToProviderResult(lyrics)] : [];
    },
  };
};

const adaptOnlineProvider = (provider: OnlineProvider): LyricsProvider => {
  if (isLyricsProvider(provider)) {
    return provider;
  }

  return {
    id: 'lrclib',
    label: 'LRCLIB',
    priority: 700,
    capabilities: {
      synced: true,
      plain: true,
      translation: false,
      romanization: false,
      byDuration: true,
      byIsrc: false,
      byMusicBrainzId: false,
      needsAccount: false,
    },
    async search(request) {
      const lyrics = await provider.getLyrics(request.query);
      if (lyrics) {
        return [trackLyricsToProviderResult(lyrics)];
      }

      const candidates = await provider.searchCandidates(request.query);
      return candidates
        .map((candidate) => {
          const raw = 'raw' in candidate ? candidate.raw : candidate;
          return raw && typeof raw === 'object' ? lrclibRecordToProviderResult(raw as LrclibRecord, request.query) : null;
        })
        .filter((result): result is LyricsProviderResult => Boolean(result));
    },
  };
};

const safeSettings = (readSettings: () => AppSettings): LyricsSettings => {
  try {
    const settings = readSettings();
    const enabledProviders = Array.isArray(settings.lyricsEnabledProviders) && settings.lyricsEnabledProviders.length
      ? settings.lyricsEnabledProviders
      : (defaultSettings.lyricsEnabledProviders ?? ['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo']);
    const providerOrder = Array.isArray(settings.lyricsProviderOrder) && settings.lyricsProviderOrder.length
      ? settings.lyricsProviderOrder
      : enabledProviders;
    const orderedEnabledProviders = [
      ...providerOrder.filter((provider) => enabledProviders.includes(provider)),
      ...enabledProviders.filter((provider) => !providerOrder.includes(provider)),
    ];

    return {
      lyricsNetworkEnabled: settings.lyricsNetworkEnabled !== false,
      lyricsPreferredProvider: 'lrclib',
      lyricsEnabledProviders: orderedEnabledProviders,
      lyricsProviderOrder: providerOrder,
      lyricsProviderTimeoutMs: Number.isFinite(settings.lyricsProviderTimeoutMs)
        ? Math.max(1000, Math.min(10000, Math.round(Number(settings.lyricsProviderTimeoutMs))))
        : (defaultSettings.lyricsProviderTimeoutMs ?? 4500),
      lyricsTotalMatchTimeoutMs: Number.isFinite(settings.lyricsTotalMatchTimeoutMs)
        ? Math.max(1500, Math.min(15000, Math.round(Number(settings.lyricsTotalMatchTimeoutMs))))
        : (defaultSettings.lyricsTotalMatchTimeoutMs ?? 6000),
      lyricsAutoSearch: settings.lyricsAutoSearch !== false,
      lyricsDeepSearchEnabled: settings.lyricsDeepSearchEnabled !== false,
      lyricsAutoAcceptScore: Number.isFinite(settings.lyricsAutoAcceptScore)
        ? Math.max(0.3, Math.min(1, settings.lyricsAutoAcceptScore))
        : defaultSettings.lyricsAutoAcceptScore,
      lyricsCoverAutoAcceptScore: Number.isFinite(settings.lyricsCoverAutoAcceptScore)
        ? Math.max(0.5, Math.min(1, Number(settings.lyricsCoverAutoAcceptScore)))
        : (defaultSettings.lyricsCoverAutoAcceptScore ?? 0.97),
      lyricsDefaultOffsetMs: clampOffset(Number(settings.lyricsDefaultOffsetMs ?? 0)),
      lyricsAutoSaveSidecarEnabled: settings.lyricsAutoSaveSidecarEnabled === true,
      lyricsRomanizationEnabled: settings.lyricsRomanizationEnabled !== false,
      lyricsUtatenKanaEnabled: settings.lyricsUtatenKanaEnabled === true,
      lyricsTranslationEnabled: settings.lyricsTranslationEnabled !== false,
    };
  } catch {
    return {
      lyricsNetworkEnabled: defaultSettings.lyricsNetworkEnabled,
      lyricsPreferredProvider: defaultSettings.lyricsPreferredProvider,
      lyricsEnabledProviders: defaultSettings.lyricsEnabledProviders ?? ['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo'],
      lyricsProviderOrder: defaultSettings.lyricsProviderOrder,
      lyricsProviderTimeoutMs: defaultSettings.lyricsProviderTimeoutMs ?? 4500,
      lyricsTotalMatchTimeoutMs: defaultSettings.lyricsTotalMatchTimeoutMs ?? 6000,
      lyricsAutoSearch: defaultSettings.lyricsAutoSearch,
      lyricsDeepSearchEnabled: defaultSettings.lyricsDeepSearchEnabled,
      lyricsAutoAcceptScore: defaultSettings.lyricsAutoAcceptScore,
      lyricsCoverAutoAcceptScore: defaultSettings.lyricsCoverAutoAcceptScore ?? 0.97,
      lyricsDefaultOffsetMs: defaultSettings.lyricsDefaultOffsetMs,
      lyricsAutoSaveSidecarEnabled: defaultSettings.lyricsAutoSaveSidecarEnabled === true,
      lyricsRomanizationEnabled: defaultSettings.lyricsRomanizationEnabled,
      lyricsUtatenKanaEnabled: defaultSettings.lyricsUtatenKanaEnabled === true,
      lyricsTranslationEnabled: defaultSettings.lyricsTranslationEnabled,
    };
  }
};

const preferredSecondaryFields = (settings: LyricsSettings): Array<'translation' | 'romanization'> => [
  ...(settings.lyricsTranslationEnabled ? ['translation' as const] : []),
  ...(settings.lyricsRomanizationEnabled ? ['romanization' as const] : []),
];

const manualNetworkCandidateSearchTimeoutMs = 8000;
const manualNetworkCandidateSearchTotalTimeoutMs = 9000;

const settingsForCandidateSearchProvider = (
  settings: LyricsSettings,
  providerId?: string | null,
): LyricsSettings =>
  providerId && providerId !== 'local' && isSearchableLyricsProvider(providerId)
    ? {
        ...settings,
        lyricsProviderTimeoutMs: Math.max(settings.lyricsProviderTimeoutMs ?? 0, manualNetworkCandidateSearchTimeoutMs),
        lyricsTotalMatchTimeoutMs: Math.max(settings.lyricsTotalMatchTimeoutMs ?? 0, manualNetworkCandidateSearchTotalTimeoutMs),
      }
    : settings;

const settingsWithLookupOptions = (settings: LyricsSettings, options: LyricsLookupOptions = {}): LyricsSettings => ({
  ...settings,
  lyricsEnabledProviders: options.enabledProviders?.length ? options.enabledProviders : settings.lyricsEnabledProviders,
  lyricsNetworkEnabled: options.networkEnabled ?? settings.lyricsNetworkEnabled,
  lyricsAutoSearch: options.autoSearch ?? settings.lyricsAutoSearch,
  lyricsDeepSearchEnabled: options.deepSearchEnabled ?? settings.lyricsDeepSearchEnabled,
  lyricsProviderTimeoutMs: options.providerTimeoutMs ?? settings.lyricsProviderTimeoutMs,
  lyricsTotalMatchTimeoutMs: options.totalMatchTimeoutMs ?? settings.lyricsTotalMatchTimeoutMs,
  lyricsAutoAcceptScore: options.autoAcceptScore ?? settings.lyricsAutoAcceptScore,
});

export class LyricsService {
  private readonly matchEngine: LyricsMatchEngine;
  private readonly secondaryLyricsRefreshMisses = new Set<string>();
  private readonly wordTimingRefreshMisses = new Set<string>();
  private readonly utatenKanaRefreshMisses = new Set<string>();

  constructor(
    private readonly database: EchoDatabase,
    private readonly library: LibraryLookup,
    private readonly localProvider: LocalProvider = new LocalLyricsProvider(),
    private readonly onlineProvider: OnlineProvider = new LrclibProvider(),
    private readonly readAppSettings: () => AppSettings = getAppSettings,
    private readonly closeDatabase: () => void = () => this.database.close(),
    private readonly utatenKanaProvider: UtatenKanaProviderLike = new UtatenKanaProvider(),
  ) {
    this.matchEngine = new LyricsMatchEngine([
      adaptLocalProvider(this.localProvider),
      adaptOnlineProvider(this.onlineProvider),
      new AmllTtmlLyricsProvider(),
      new NeteaseLyricsProvider(),
      new QQMusicLyricsProvider(),
      new KugouLyricsProvider(),
      new KuwoLyricsProvider(),
      new StubLyricsProvider('musixmatch', 'Musixmatch', 500),
      new StubLyricsProvider('genius', 'Genius', 450),
    ] satisfies LyricsProvider[]);
  }

  close(): void {
    this.closeDatabase();
  }

  hasCachedLyricsForTrack(trackId: string): boolean {
    const track = this.library.getTrack(trackId);
    if (!track) {
      return false;
    }

    return Boolean(this.findCachedLyricsWithRepair(toQuery(track)));
  }

  hasCachedLyricsForTrackIds(trackIds: string[]): Set<string> {
    const ids = [...new Set(trackIds.filter((trackId) => typeof trackId === 'string' && trackId.trim().length > 0))];
    if (!ids.length) {
      return new Set();
    }

    try {
      const placeholders = ids.map(() => '?').join(', ');
      const rows = this.database
        .prepare<unknown[], { track_id: string }>(
          `SELECT DISTINCT track_id
           FROM lyrics_cache
           WHERE track_id IN (${placeholders})`,
        )
        .all(...ids);
      return new Set(rows.map((row) => row.track_id));
    } catch (error) {
      if (!isSqliteCorruptionError(error)) {
        throw error;
      }

      this.repairLyricsStorage(error);
      return new Set();
    }
  }

  async getLyricsForTrack(trackId: string, options: LyricsLookupOptions = {}): Promise<TrackLyrics | null> {
    const track = this.library.getTrack(trackId);
    if (!track) {
      return null;
    }

    return this.getLyricsForQuery(toQuery(track), options);
  }

  async getLyricsForSnapshot(request: LyricsTrackSnapshotRequest): Promise<TrackLyrics | null> {
    return this.getLyricsForQuery(toSnapshotQuery(request));
  }

  private async getLyricsForQuery(query: LyricsQuery, options: LyricsLookupOptions = {}): Promise<TrackLyrics | null> {
    const trackId = query.trackId ?? cacheKeyFor(query, 'cached');
    const settings = settingsWithLookupOptions(safeSettings(this.readAppSettings), options);
    const cached = this.findCachedLyricsWithRepair(query);
    if (cached) {
      const enrichedCached = await this.fillCachedRomanization(query, cached);
      const kanaCached = await this.fillCachedUtatenKana(query, enrichedCached, settings);
      this.refreshCachedLyricsInBackground(query, kanaCached, settings);
      return kanaCached;
    }

    try {
      const result = await this.matchEngine.match(query, {
        enabledProviders: settings.lyricsEnabledProviders,
        networkEnabled: settings.lyricsNetworkEnabled && settings.lyricsAutoSearch,
        providerTimeoutMs: settings.lyricsProviderTimeoutMs,
        totalMatchTimeoutMs: settings.lyricsTotalMatchTimeoutMs,
        autoAcceptScore: settings.lyricsAutoAcceptScore,
        coverAutoAcceptScore: settings.lyricsCoverAutoAcceptScore,
        deepSearchEnabled: settings.lyricsDeepSearchEnabled,
        collectAllCandidates: false,
        preferPrimaryProvider: options.preferPrimaryProvider ?? true,
        relaxedAutoAccept: options.relaxedAutoAccept === true,
        preferredSecondaryFields: preferredSecondaryFields(settings),
        isRejected: (provider, providerLyricsId) => this.hasRejectedProviderLyrics(trackId, provider, providerLyricsId),
      });

      if (result.accepted) {
        const lyrics = providerResultToTrackLyrics(query, result.accepted.providerResult, result.accepted.score);
        if (lyrics) {
          return this.writeLyricsCacheWithRepair(query, await this.enrichLyricsForCache(query, lyrics, settings));
        }
      }

      for (const candidate of result.candidates) {
        this.upsertCandidateWithRepair(trackId, candidate, this.matchedCandidateToRaw(candidate));
      }
    } catch {
      return null;
    }

    return null;
  }

  async searchLyricsCandidates(trackId: string, searchText?: string | null, providerId?: string | null): Promise<LyricsSearchCandidate[]> {
    const track = this.library.getTrack(trackId);
    if (!track) {
      return [];
    }

    return this.searchLyricsCandidatesForQuery(trackId, toManualSearchQuery(track, searchText), providerId);
  }

  async searchLyricsCandidatesForSnapshot(
    request: LyricsTrackSnapshotRequest,
    searchText?: string | null,
    providerId?: string | null,
  ): Promise<LyricsSearchCandidate[]> {
    return this.searchLyricsCandidatesForQuery(
      request.trackId,
      toManualSnapshotSearchQuery(request, searchText),
      providerId,
    );
  }

  private async searchLyricsCandidatesForQuery(
    trackId: string,
    query: LyricsQuery,
    providerId?: string | null,
  ): Promise<LyricsSearchCandidate[]> {
    const settings = settingsForCandidateSearchProvider(safeSettings(this.readAppSettings), providerId);
    const storedCandidates: StoredCandidate[] = [];
    const enabledProviders = isSearchableLyricsProvider(providerId) ? [providerId] : settings.lyricsEnabledProviders;

    try {
      const result = await this.matchEngine.match(query, {
        enabledProviders,
        networkEnabled: settings.lyricsNetworkEnabled,
        providerTimeoutMs: settings.lyricsProviderTimeoutMs,
        totalMatchTimeoutMs: settings.lyricsTotalMatchTimeoutMs,
        autoAcceptScore: settings.lyricsAutoAcceptScore,
        coverAutoAcceptScore: settings.lyricsCoverAutoAcceptScore,
        deepSearchEnabled: settings.lyricsDeepSearchEnabled,
        collectAllCandidates: true,
        preferredSecondaryFields: preferredSecondaryFields(settings),
        isRejected: (provider, providerLyricsId) => this.hasRejectedProviderLyrics(trackId, provider, providerLyricsId),
      });

      for (const candidate of result.candidates) {
        const stored = this.upsertCandidateWithRepair(trackId, candidate, this.matchedCandidateToRaw(candidate));
        if (stored.status !== 'rejected') {
          storedCandidates.push(stored);
        }
      }
    } catch {
      // Candidate search is best-effort; failures should not affect playback.
    }

    return sortLyricsCandidates(
      query.durationSeconds,
      storedCandidates.map((candidate) => ({
        id: candidate.id,
        provider: candidate.provider,
        providerLyricsId: candidate.providerLyricsId,
        title: candidate.title,
        artist: candidate.artist,
        album: candidate.album,
        durationSeconds: candidate.durationSeconds,
        instrumental: candidate.instrumental,
        hasSynced: candidate.hasSynced,
        hasPlain: candidate.hasPlain,
        score: candidate.score,
        sourceLabel: candidate.sourceLabel,
        risk: candidate.risk,
        reasons: candidate.reasons,
        titleScore: candidate.titleScore,
        artistScore: candidate.artistScore,
        albumScore: candidate.albumScore,
        durationScore: candidate.durationScore,
        versionScore: candidate.versionScore,
      })),
    );
  }

  async applyLyricsCandidate(trackId: string, candidateId: string): Promise<TrackLyrics> {
    const track = this.library.getTrack(trackId);
    const row = this.getCandidateRow(candidateId);

    if (!track || !row || row.track_id !== trackId) {
      throw new Error(`Unknown lyrics candidate ${candidateId}`);
    }

    const query = toQuery(track);
    const lyrics = this.readLyricsCandidateForQuery(query, row, { includeLocal: true });

    if (!lyrics) {
      throw new Error('Lyrics candidate is no longer available');
    }

    const cached = this.writeLyricsCacheWithRepair(query, await this.enrichLyricsForCache(query, lyrics));
    this.database
      .prepare('UPDATE lyrics_candidates SET status = ?, updated_at = ? WHERE id = ?')
      .run('accepted', nowIso(), candidateId);
    return cached;
  }

  async applyLyricsCandidateForSnapshot(
    request: LyricsTrackSnapshotRequest,
    candidateId: string,
  ): Promise<TrackLyrics> {
    const row = this.getCandidateRow(candidateId);
    if (!row || row.track_id !== request.trackId) {
      throw new Error(`Unknown lyrics candidate ${candidateId}`);
    }

    const query = toSnapshotQuery(request);
    const lyrics = this.readLyricsCandidateForQuery(query, row, { includeLocal: false });

    if (!lyrics) {
      throw new Error('Lyrics candidate is no longer available');
    }

    const cached = this.writeLyricsCacheWithRepair(query, await this.enrichLyricsForCache(query, lyrics));
    this.database
      .prepare('UPDATE lyrics_candidates SET status = ?, updated_at = ? WHERE id = ?')
      .run('accepted', nowIso(), candidateId);
    return cached;
  }

  async previewLyricsCandidate(trackId: string, candidateId: string): Promise<TrackLyrics> {
    const track = this.library.getTrack(trackId);
    const row = this.getCandidateRow(candidateId);

    if (!track || !row || row.track_id !== trackId) {
      throw new Error(`Unknown lyrics candidate ${candidateId}`);
    }

    const lyrics = this.readLyricsCandidateForQuery(toQuery(track), row, { includeLocal: true });
    if (!lyrics) {
      throw new Error('Lyrics candidate is no longer available');
    }

    return lyrics;
  }

  async embedLyricsToTrack(trackId: string, request: LyricsEmbedToTrackRequest = {}): Promise<LyricsEmbedToTrackResult> {
    const track = this.library.getTrack(trackId);
    if (!track) {
      throw new Error(`Unknown track ${trackId}`);
    }

    if (track.mediaType === 'remote' || track.mediaType === 'streaming' || track.isTemporary) {
      throw new Error('远程、流媒体或临时曲目不能写入源文件，只能应用到歌词库。');
    }

    const filePath = track.path?.trim();
    if (!filePath || !existsSync(filePath)) {
      throw new Error('找不到本地音频文件，无法嵌入歌词。');
    }

    const lyrics = request.candidateId
      ? await this.applyLyricsCandidate(trackId, request.candidateId)
      : await this.getLyricsForTrack(trackId);

    if (!lyrics) {
      throw new Error('请先搜索并应用一条歌词，再嵌入到文件。');
    }

    if (lyrics.kind === 'empty' || lyrics.kind === 'instrumental') {
      throw new Error('当前歌词为空或纯音乐，无法嵌入到文件。');
    }

    const embeddedText = lyricsToEmbeddableText(lyrics, request.preferSynced !== false);
    if (!embeddedText) {
      throw new Error('当前歌词没有可写入的文本内容。');
    }

    this.queueEmbeddedLyricsWrite(track.id, filePath, embeddedText.text);

    return {
      trackId: track.id,
      provider: lyrics.provider,
      kind: lyrics.kind,
      textKind: embeddedText.textKind,
      queued: true,
      message: '已加入后台写入队列；如果正在播放或加载音频，会自动延后写入。',
    };
  }

  async applyCustomLrc(trackId: string, lrcText: string, fileName?: string | null): Promise<TrackLyrics> {
    const track = this.library.getTrack(trackId);
    const normalizedText = lrcText.replace(/^\uFEFF/u, '').trim();
    if (!track) {
      throw new Error(`Unknown track ${trackId}`);
    }

    if (!normalizedText) {
      throw new Error('Custom LRC file is empty');
    }

    const query = toQuery(track);
    const syncedLines = normalizeSyncedLyricAlternates(parseSyncedLyrics(normalizedText));
    const plainLines = syncedLines.length > 0 ? [] : parsePlainLyrics(normalizedText);
    if (syncedLines.length === 0 && plainLines.length === 0) {
      throw new Error('Custom LRC file does not contain readable lyrics');
    }

    const lyrics: TrackLyrics = {
      id: randomUUID(),
      trackId,
      provider: 'manual',
      providerLyricsId: `custom-lrc:${hashJson({ trackId, fileName: fileName ?? null, lrcText: normalizedText })}`,
      kind: syncedLines.length > 0 ? 'synced' : 'plain',
      title: query.title,
      artist: query.artist,
      album: query.album ?? null,
      durationSeconds: query.durationSeconds ?? null,
      lines: syncedLines.length > 0 ? syncedLines : plainLines,
      plainText: syncedLines.length > 0 ? syncedLines.map((line) => line.text).join('\n') : normalizedText,
      syncedText: syncedLines.length > 0 ? normalizedText : null,
      offsetMs: 0,
      score: 1,
      cachedAt: nowIso(),
      updatedAt: nowIso(),
    };

    return this.writeLyricsCacheWithRepair(query, await this.enrichLyricsForCache(query, lyrics));
  }

  async markTrackInstrumental(trackId: string): Promise<TrackLyrics> {
    const track = this.library.getTrack(trackId);
    if (!track) {
      throw new Error(`Unknown track ${trackId}`);
    }

    const query = toQuery(track);
    const timestamp = nowIso();
    const lyrics: TrackLyrics = {
      id: randomUUID(),
      trackId,
      provider: 'manual',
      providerLyricsId: `instrumental:${trackId}`,
      kind: 'instrumental',
      title: query.title,
      artist: query.artist,
      album: query.album ?? null,
      durationSeconds: query.durationSeconds ?? null,
      lines: [],
      plainText: null,
      syncedText: null,
      offsetMs: 0,
      score: 1,
      cachedAt: timestamp,
      updatedAt: timestamp,
    };

    const cached = this.writeLyricsCacheWithRepair(query, lyrics);
    this.database
      .prepare('UPDATE lyrics_candidates SET status = ?, updated_at = ? WHERE track_id = ?')
      .run('rejected', timestamp, trackId);
    return cached;
  }

  async rejectLyricsCandidate(candidateId: string): Promise<void> {
    this.database
      .prepare('UPDATE lyrics_candidates SET status = ?, updated_at = ? WHERE id = ?')
      .run('rejected', nowIso(), candidateId);
  }

  async setLyricsOffset(trackId: string, offsetMs: number): Promise<TrackLyrics | null> {
    const track = this.library.getTrack(trackId);
    if (!track) {
      return null;
    }

    const clampedOffset = clampOffset(offsetMs);
    const timestamp = nowIso();
    const result = this.database
      .prepare('UPDATE lyrics_cache SET offset_ms = ?, updated_at = ? WHERE track_id = ?')
      .run(clampedOffset, timestamp, trackId);

    if (result.changes === 0) {
      return null;
    }

    return this.findCachedLyricsWithRepair(toQuery(track));
  }

  async clearLyricsCache(trackId: string): Promise<void> {
    try {
      this.database.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(trackId);
    } catch (error) {
      if (!isSqliteCorruptionError(error)) {
        throw error;
      }

      this.repairLyricsStorage(error);
    }
  }

  private queueEmbeddedLyricsWrite(trackId: string, filePath: string, lyricsText: string): void {
    const run = async (): Promise<void> => {
      if (await shouldDelayEmbeddedLyricsWriteForAudio(filePath)) {
        const retryTimer = setTimeout(() => {
          void run();
        }, 5000);
        unrefTimer(retryTimer);
        return;
      }

      try {
        await writeEmbeddedLyricsTag(filePath, lyricsText);
      } catch (error) {
        console.warn('[lyrics] Failed to embed lyrics into track', {
          trackId,
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const startTimer = setTimeout(() => {
      void run();
    }, 250);
    unrefTimer(startTimer);
  }

  private findCachedLyricsWithRepair(query: LyricsQuery): TrackLyrics | null {
    try {
      return this.findCachedLyrics(query);
    } catch (error) {
      if (!isSqliteCorruptionError(error)) {
        throw error;
      }

      this.repairLyricsStorage(error);
      return null;
    }
  }

  private findCachedLyrics(query: LyricsQuery): TrackLyrics | null {
    if (query.trackId) {
      const row = this.database
        .prepare<[string], LyricsCacheRow>(
          `SELECT * FROM lyrics_cache
           WHERE track_id = ?
           ORDER BY CASE provider
             WHEN 'manual' THEN 0
             WHEN 'local' THEN 1
             WHEN 'lrclib' THEN 2
             ELSE 3
           END, updated_at DESC
           LIMIT 1`,
        )
        .get(query.trackId);

      if (row) {
        return this.mapCacheRow(row);
      }
    }

    const keys = allCacheKeysFor(query);
    const placeholders = keys.map(() => '?').join(', ');
    const row = this.database
      .prepare<unknown[], LyricsCacheRow>(
        `SELECT * FROM lyrics_cache
         WHERE cache_key IN (${placeholders})
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(...keys);

    if (row) {
      return this.mapCacheRow(row);
    }

    const remoteBrowserCacheKeyPrefix = remoteBrowserCacheKeyPrefixFor(query);
    if (remoteBrowserCacheKeyPrefix) {
      const remoteBrowserRow = this.database
        .prepare<[string], LyricsCacheRow>(
          `SELECT * FROM lyrics_cache
           WHERE cache_key LIKE ? ESCAPE '\\'
           ORDER BY CASE provider
             WHEN 'manual' THEN 0
             WHEN 'local' THEN 1
             WHEN 'lrclib' THEN 2
             ELSE 3
           END, updated_at DESC
           LIMIT 1`,
        )
        .get(`${escapeSqlLike(remoteBrowserCacheKeyPrefix)}%`);

      if (remoteBrowserRow) {
        return this.mapCacheRow(remoteBrowserRow);
      }
    }

    return null;
  }

  private writeLyricsCacheWithRepair(query: LyricsQuery, lyrics: TrackLyrics): TrackLyrics {
    try {
      return this.writeLyricsCache(query, lyrics);
    } catch (error) {
      if (!isSqliteCorruptionError(error)) {
        throw error;
      }

      this.repairLyricsStorage(error);
      return this.writeLyricsCache(query, lyrics);
    }
  }

  private writeLyricsCache(query: LyricsQuery, lyrics: TrackLyrics): TrackLyrics {
    const previous = query.trackId
      ? this.database
          .prepare<[string, string], { offset_ms: number }>('SELECT offset_ms FROM lyrics_cache WHERE track_id = ? AND provider = ? LIMIT 1')
          .get(query.trackId, lyrics.provider)
      : null;
    const settings = safeSettings(this.readAppSettings);
    const offsetMs = previous ? Number(previous.offset_ms) : lyrics.offsetMs === 0 ? settings.lyricsDefaultOffsetMs : lyrics.offsetMs;
    const timestamp = nowIso();
    const cacheKey = cacheKeyFor(query, lyrics.provider);
    const id = lyrics.id || randomUUID();

    this.database
      .prepare(
        `INSERT INTO lyrics_cache (
          id, cache_key, track_id, provider, provider_lyrics_id, title, artist, album,
          duration_seconds, kind, plain_lyrics, synced_lyrics, lines_json, offset_ms,
          score, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          track_id = excluded.track_id,
          provider = excluded.provider,
          provider_lyrics_id = excluded.provider_lyrics_id,
          title = excluded.title,
          artist = excluded.artist,
          album = excluded.album,
          duration_seconds = excluded.duration_seconds,
          kind = excluded.kind,
          plain_lyrics = excluded.plain_lyrics,
          synced_lyrics = excluded.synced_lyrics,
          lines_json = excluded.lines_json,
          offset_ms = excluded.offset_ms,
          score = excluded.score,
          updated_at = excluded.updated_at
        ON CONFLICT(id) DO UPDATE SET
          cache_key = excluded.cache_key,
          track_id = excluded.track_id,
          provider = excluded.provider,
          provider_lyrics_id = excluded.provider_lyrics_id,
          title = excluded.title,
          artist = excluded.artist,
          album = excluded.album,
          duration_seconds = excluded.duration_seconds,
          kind = excluded.kind,
          plain_lyrics = excluded.plain_lyrics,
          synced_lyrics = excluded.synced_lyrics,
          lines_json = excluded.lines_json,
          offset_ms = excluded.offset_ms,
          score = excluded.score,
          updated_at = excluded.updated_at`,
      )
      .run(
        id,
        cacheKey,
        query.trackId ?? lyrics.trackId,
        lyrics.provider,
        lyrics.providerLyricsId ?? null,
        lyrics.title,
        lyrics.artist,
        lyrics.album ?? null,
        lyrics.durationSeconds ?? null,
        lyrics.kind,
        lyrics.plainText ?? null,
        lyrics.syncedText ?? null,
        serializeLyricLines(lyrics.lines),
        clampOffset(offsetMs),
        lyrics.score ?? null,
        lyrics.cachedAt || timestamp,
        timestamp,
      );

    const row = this.database.prepare<[string], LyricsCacheRow>('SELECT * FROM lyrics_cache WHERE cache_key = ?').get(cacheKey);
    const cached = this.mapCacheRow(row!);
    this.autoSaveSidecarLyrics(query, cached, settings);
    return cached;
  }

  private autoSaveSidecarLyrics(query: LyricsQuery, lyrics: TrackLyrics, settings: LyricsSettings): void {
    if (!settings.lyricsAutoSaveSidecarEnabled || !shouldAutoSaveSidecarLyrics(query, lyrics) || !query.filePath) {
      return;
    }

    const sidecar = lyricsToSidecarText(lyrics);
    if (!sidecar) {
      return;
    }

    const audioFolder = dirname(query.filePath);
    const audioBaseName = basename(query.filePath, extname(query.filePath));
    const existingSidecarPath = sidecarLyricsExtensions
      .map((extension) => join(audioFolder, `${audioBaseName}${extension}`))
      .find((candidatePath) => existsSync(candidatePath));
    if (existingSidecarPath) {
      return;
    }

    const targetPath = join(audioFolder, `${audioBaseName}${sidecar.extension}`);
    try {
      writeFileSync(targetPath, `${sidecar.text.trim()}\n`, 'utf8');
    } catch (error) {
      console.warn('[lyrics] Failed to auto-save sidecar lyrics', {
        trackId: query.trackId,
        targetPath,
        provider: lyrics.provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private upsertCandidateWithRepair(trackId: string, candidate: LyricsSearchCandidate, raw: unknown): StoredCandidate {
    try {
      return this.upsertCandidate(trackId, candidate, raw);
    } catch (error) {
      if (!isSqliteCorruptionError(error)) {
        throw error;
      }

      this.repairLyricsStorage(error);
      return this.upsertCandidate(trackId, candidate, raw);
    }
  }

  private upsertCandidate(trackId: string, candidate: LyricsSearchCandidate, raw: unknown): StoredCandidate {
    const providerLyricsId = candidate.providerLyricsId ?? `${candidate.provider}:${hashJson(raw)}`;
    const existing = this.database
      .prepare<[string, string, string], { id: string; status: string }>(
        `SELECT id, status FROM lyrics_candidates
         WHERE track_id = ? AND provider = ? AND provider_lyrics_id = ?
         LIMIT 1`,
      )
      .get(trackId, candidate.provider, providerLyricsId);
    const id = existing?.id ?? randomUUID();
    const timestamp = nowIso();
    const status = existing?.status === 'rejected' ? 'rejected' : existing?.status ?? 'pending';

    this.database
      .prepare(
        `INSERT INTO lyrics_candidates (
          id, track_id, provider, provider_lyrics_id, title, artist, album, duration_seconds,
          instrumental, has_synced, has_plain, score, risk, reasons_json, title_score,
          artist_score, album_score, duration_score, version_score, source_label, raw_json,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          artist = excluded.artist,
          album = excluded.album,
          duration_seconds = excluded.duration_seconds,
          instrumental = excluded.instrumental,
          has_synced = excluded.has_synced,
          has_plain = excluded.has_plain,
          score = excluded.score,
          risk = excluded.risk,
          reasons_json = excluded.reasons_json,
          title_score = excluded.title_score,
          artist_score = excluded.artist_score,
          album_score = excluded.album_score,
          duration_score = excluded.duration_score,
          version_score = excluded.version_score,
          source_label = excluded.source_label,
          raw_json = excluded.raw_json,
          status = CASE lyrics_candidates.status WHEN 'rejected' THEN lyrics_candidates.status ELSE excluded.status END,
          updated_at = excluded.updated_at`,
      )
      .run(
        id,
        trackId,
        candidate.provider,
        providerLyricsId,
        candidate.title,
        candidate.artist,
        candidate.album ?? null,
        candidate.durationSeconds ?? null,
        candidate.instrumental ? 1 : 0,
        candidate.hasSynced ? 1 : 0,
        candidate.hasPlain ? 1 : 0,
        candidate.score,
        candidate.risk ?? null,
        JSON.stringify(candidate.reasons ?? []),
        candidate.titleScore ?? null,
        candidate.artistScore ?? null,
        candidate.albumScore ?? null,
        candidate.durationScore ?? null,
        candidate.versionScore ?? null,
        candidate.sourceLabel,
        JSON.stringify(raw ?? {}),
        status,
        timestamp,
        timestamp,
      );

    const row = this.getCandidateRow(id)!;
    return {
      ...this.mapCandidateRow(row),
      raw: parseRawJson(row.raw_json),
      status: row.status,
    };
  }

  private hasRejectedProviderLyrics(trackId: string, provider: LyricsProviderId, providerLyricsId?: string | null): boolean {
    if (!providerLyricsId) {
      return false;
    }

    let row: { id: string } | undefined;
    try {
      row = this.database
        .prepare<[string, string, string], { id: string }>(
          `SELECT id FROM lyrics_candidates
           WHERE track_id = ? AND provider = ? AND provider_lyrics_id = ? AND status = 'rejected'
           LIMIT 1`,
        )
        .get(trackId, provider, providerLyricsId);
    } catch (error) {
      if (!isSqliteCorruptionError(error)) {
        throw error;
      }

      this.repairLyricsStorage(error);
      return false;
    }

    return Boolean(row);
  }

  private repairLyricsStorage(error: unknown): void {
    console.warn('[lyrics] SQLite lyrics storage is corrupt; resetting lyrics cache tables.', error);
    resetLyricsStorage(this.database);
  }

  private matchedCandidateToRaw(candidate: MatchedLyricsCandidate): unknown {
    return {
      providerResult: candidate.providerResult,
      decision: candidate.decision,
      raw: candidate.raw ?? {},
    };
  }

  private readProviderResult(rawRecord: Record<string, unknown>): LyricsProviderResult | null {
    const value = rawRecord.providerResult;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const provider = record.provider;
    if (
      provider !== 'local' &&
      provider !== 'lrclib' &&
      provider !== 'amll-ttml' &&
      provider !== 'netease' &&
      provider !== 'qqmusic' &&
      provider !== 'kugou' &&
      provider !== 'kuwo' &&
      provider !== 'musixmatch' &&
      provider !== 'genius' &&
      provider !== 'manual'
    ) {
      return null;
    }

    return {
      provider,
      providerLyricsId: textOrNull(record.providerLyricsId),
      title: textOrNull(record.title) ?? '',
      artist: textOrNull(record.artist) ?? '',
      album: textOrNull(record.album),
      durationSeconds: numberOrNull(record.durationSeconds),
      instrumental: record.instrumental === true,
      plainLyrics: textOrNull(record.plainLyrics),
      syncedLyrics: textOrNull(record.syncedLyrics),
      karaokeLyrics: textOrNull(record.karaokeLyrics),
      translationLyrics: textOrNull(record.translationLyrics),
      romanizationLyrics: textOrNull(record.romanizationLyrics),
      sourceUrl: textOrNull(record.sourceUrl),
      raw: record.raw,
    };
  }

  private readLyricsCandidateForQuery(
    query: LyricsQuery,
    row: LyricsCandidateRow,
    options: { includeLocal: boolean },
  ): TrackLyrics | null {
    const raw = parseRawJson(row.raw_json);
    const rawRecord = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const providerResult = this.readProviderResult(rawRecord);

    if (providerResult) {
      return providerResultToTrackLyrics(query, providerResult, row.score);
    }

    if (options.includeLocal && row.provider === 'local') {
      const filePath = textOrNull(rawRecord.filePath);
      const extension = rawRecord.extension === '.txt' || rawRecord.extension === '.ttml' ? rawRecord.extension : '.lrc';
      if (filePath) {
        return this.localProvider.getLyricsFromCandidate(query, {
          ...this.mapCandidateRow(row),
          filePath,
          extension,
        });
      }
    }

    if (row.provider === 'lrclib') {
      return mapLrclibRecordToTrackLyrics(toNetworkQuery(query), raw as LrclibRecord, row.score);
    }

    return null;
  }

  private getCandidateRow(candidateId: string): LyricsCandidateRow | null {
    return this.database.prepare<[string], LyricsCandidateRow>('SELECT * FROM lyrics_candidates WHERE id = ?').get(candidateId) ?? null;
  }

  private mapCandidateRow(row: LyricsCandidateRow): LyricsSearchCandidate {
    return {
      id: row.id,
      provider: row.provider,
      providerLyricsId: row.provider_lyrics_id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      durationSeconds: numberOrNull(row.duration_seconds),
      instrumental: row.instrumental === 1,
      hasSynced: row.has_synced === 1,
      hasPlain: row.has_plain === 1,
      score: Number(row.score ?? 0),
      sourceLabel: row.source_label,
      risk: row.risk ?? undefined,
      reasons: this.parseReasons(row.reasons_json),
      titleScore: numberOrNull(row.title_score) ?? undefined,
      artistScore: numberOrNull(row.artist_score) ?? undefined,
      albumScore: numberOrNull(row.album_score) ?? undefined,
      durationScore: numberOrNull(row.duration_score) ?? undefined,
      versionScore: numberOrNull(row.version_score) ?? undefined,
    };
  }

  private parseReasons(value: string | null): string[] | undefined {
    if (!value) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
    } catch {
      return undefined;
    }
  }

  private mapCacheRow(row: LyricsCacheRow): TrackLyrics {
    const provider = providerName(row.provider);
    const kind = lyricsKind(row.kind);
    const cachedLines = kind === 'synced'
      ? normalizeSyncedLyricAlternates(deserializeLyricLines(row.lines_json))
      : deserializeLyricLines(row.lines_json);
    const hasCachedLineEnhancements = cachedLines.some((line) => line.romanization || line.translation || line.kana);
    const hasCachedWordTimings = cachedLines.some((line) => line.words?.length);
    let lines = cachedLines;
    let resolvedKind = kind;
    let plainText = row.plain_lyrics;
    let syncedText = row.synced_lyrics;

    if (kind === 'synced' && row.synced_lyrics) {
      const reparsedLines = normalizeSyncedLyricAlternates(parseSyncedLyrics(row.synced_lyrics));
      const reparsedHasWordTimings = reparsedLines.some((line) => line.words?.length);
      if (provider === 'local' && shouldReplaceInvertedLocalLyricCache(cachedLines, reparsedLines)) {
        lines = reparsedLines;
      } else if (
        !hasCachedLineEnhancements &&
        !hasCachedWordTimings &&
        (provider === 'local' || reparsedHasWordTimings)
      ) {
        lines = reparsedLines;
      } else {
        lines = restoreWordTimingsFromSyncedText(cachedLines, row.synced_lyrics);
      }
    } else if ((provider === 'local' || provider === 'manual') && kind === 'plain' && row.plain_lyrics) {
      const reparsedLines = normalizeSyncedLyricAlternates(parseSyncedLyrics(row.plain_lyrics));
      if (reparsedLines.length > 0) {
        lines = reparsedLines;
        resolvedKind = 'synced';
        syncedText = row.plain_lyrics;
        plainText = null;
      }
    }

    return {
      id: row.id,
      trackId: row.track_id,
      provider,
      providerLyricsId: row.provider_lyrics_id,
      kind: resolvedKind,
      title: row.title,
      artist: row.artist,
      album: row.album,
      durationSeconds: numberOrNull(row.duration_seconds),
      lines,
      plainText,
      syncedText,
      offsetMs: Number(row.offset_ms ?? 0),
      score: typeof row.score === 'number' ? row.score : null,
      cachedAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async fillLyricsRomanization(lyrics: TrackLyrics): Promise<TrackLyrics> {
    if (lyrics.lines.length === 0 || !hasMissingRomanization(lyrics.lines)) {
      return lyrics;
    }

    const lines = await fillMissingRomanization(lyrics.lines);
    return lines === lyrics.lines ? lyrics : { ...lyrics, lines };
  }

  private async enrichLyricsForCache(
    query: LyricsQuery,
    lyrics: TrackLyrics,
    settings: LyricsSettings = safeSettings(this.readAppSettings),
  ): Promise<TrackLyrics> {
    const romanized = await this.fillLyricsRomanization(lyrics);
    return this.fillLyricsUtatenKana(query, romanized, settings);
  }

  private async fillCachedRomanization(query: LyricsQuery, lyrics: TrackLyrics): Promise<TrackLyrics> {
    const enriched = await this.fillLyricsRomanization(lyrics);
    if (enriched === lyrics) {
      return lyrics;
    }

    return this.writeLyricsCacheWithRepair(query, enriched);
  }

  private async fillLyricsUtatenKana(
    query: LyricsQuery,
    lyrics: TrackLyrics,
    settings: LyricsSettings,
  ): Promise<TrackLyrics> {
    if (
      !settings.lyricsUtatenKanaEnabled ||
      !settings.lyricsRomanizationEnabled ||
      !settings.lyricsNetworkEnabled ||
      lyrics.lines.length === 0 ||
      !hasJapaneseLyricsText(lyrics.lines) ||
      !lyrics.lines.some((line) => !line.kana?.trim())
    ) {
      return lyrics;
    }

    const trackKey = query.trackId ?? cacheKeyFor(query, lyrics.provider);
    const lyricTextKey = hashJson(lyrics.lines.map((line) => line.text));
    const refreshKey = `${trackKey}:${lyrics.provider}:${lyrics.providerLyricsId ?? ''}:${lyricTextKey}:utaten-kana`;
    if (this.utatenKanaRefreshMisses.has(refreshKey)) {
      return lyrics;
    }

    try {
      const lines = await this.utatenKanaProvider.enrichLines(query, lyrics.lines, {
        timeoutMs: Math.min(settings.lyricsProviderTimeoutMs ?? 2500, 2500),
      });
      if (lines === lyrics.lines) {
        this.utatenKanaRefreshMisses.add(refreshKey);
        return lyrics;
      }

      return { ...lyrics, lines };
    } catch {
      this.utatenKanaRefreshMisses.add(refreshKey);
      return lyrics;
    }
  }

  private async fillCachedUtatenKana(
    query: LyricsQuery,
    lyrics: TrackLyrics,
    settings: LyricsSettings,
  ): Promise<TrackLyrics> {
    const enriched = await this.fillLyricsUtatenKana(query, lyrics, settings);
    if (enriched === lyrics) {
      return lyrics;
    }

    return this.writeLyricsCacheWithRepair(query, enriched);
  }

  private missingPreferredSecondaryFields(
    lyrics: TrackLyrics,
    settings: LyricsSettings,
  ): Array<'translation' | 'romanization'> {
    const fields = preferredSecondaryFields(settings);
    if (fields.length === 0 || lyrics.lines.length === 0) {
      return [];
    }

    return fields.filter((field) => !lyrics.lines.some((line) => Boolean(line[field]?.trim())));
  }

  private async refreshCachedLyricsForPreferredSecondary(
    query: LyricsQuery,
    cached: TrackLyrics,
    settings: LyricsSettings,
  ): Promise<TrackLyrics> {
    const fields = this.missingPreferredSecondaryFields(cached, settings);
    if (
      !query.trackId ||
      !settings.lyricsNetworkEnabled ||
      !settings.lyricsAutoSearch ||
      fields.length === 0
    ) {
      return cached;
    }

    const trackId = query.trackId;
    const refreshKey = `${cacheKeyFor(query, cached.provider)}:${fields.join(',')}`;
    if (this.secondaryLyricsRefreshMisses.has(refreshKey)) {
      return cached;
    }

    try {
      const result = await this.matchEngine.match(query, {
        enabledProviders: settings.lyricsEnabledProviders,
        networkEnabled: settings.lyricsNetworkEnabled && settings.lyricsAutoSearch,
        providerTimeoutMs: settings.lyricsProviderTimeoutMs,
        totalMatchTimeoutMs: settings.lyricsTotalMatchTimeoutMs,
        autoAcceptScore: settings.lyricsAutoAcceptScore,
        coverAutoAcceptScore: settings.lyricsCoverAutoAcceptScore,
        deepSearchEnabled: settings.lyricsDeepSearchEnabled,
        collectAllCandidates: false,
        preferredSecondaryFields: fields,
        isRejected: (provider, providerLyricsId) => this.hasRejectedProviderLyrics(trackId, provider, providerLyricsId),
      });
      if (!result.accepted) {
        this.secondaryLyricsRefreshMisses.add(refreshKey);
        return cached;
      }

      const lyrics = providerResultToTrackLyrics(query, result.accepted.providerResult, result.accepted.score);
      const hasRequestedSecondary = lyrics
        ? fields.some((field) => lyrics.lines.some((line) => Boolean(line[field]?.trim())))
        : false;
      if (!lyrics || !hasRequestedSecondary) {
        this.secondaryLyricsRefreshMisses.add(refreshKey);
        return cached;
      }

      return this.writeLyricsCacheWithRepair(query, await this.enrichLyricsForCache(query, lyrics, settings));
    } catch {
      this.secondaryLyricsRefreshMisses.add(refreshKey);
      return cached;
    }
  }

  private refreshCachedLyricsInBackground(
    query: LyricsQuery,
    cached: TrackLyrics,
    settings: LyricsSettings,
  ): void {
    if (
      !query.trackId ||
      !settings.lyricsNetworkEnabled ||
      !settings.lyricsAutoSearch
    ) {
      return;
    }

    void (async () => {
      const wordTimedCached = await this.refreshCachedNeteaseWordTimings(query, cached, settings);
      await this.refreshCachedLyricsForPreferredSecondary(query, wordTimedCached, settings);
    })().catch(() => {
      // Cached lyrics are already usable; secondary refreshes should never delay or fail playback.
    });
  }

  private async refreshCachedNeteaseWordTimings(
    query: LyricsQuery,
    cached: TrackLyrics,
    settings: LyricsSettings,
  ): Promise<TrackLyrics> {
    if (
      cached.provider !== 'netease' ||
      cached.kind !== 'synced' ||
      cached.lines.some((line) => line.words?.length) ||
      !query.trackId ||
      !settings.lyricsNetworkEnabled ||
      !settings.lyricsAutoSearch ||
      settings.lyricsEnabledProviders?.includes('netease') !== true
    ) {
      return cached;
    }

    const trackId = query.trackId;
    const refreshKey = `${cacheKeyFor(query, cached.provider)}:word-timings`;
    if (this.wordTimingRefreshMisses.has(refreshKey)) {
      return cached;
    }

    try {
      const result = await this.matchEngine.match(query, {
        enabledProviders: ['netease'],
        networkEnabled: true,
        providerTimeoutMs: settings.lyricsProviderTimeoutMs,
        totalMatchTimeoutMs: settings.lyricsTotalMatchTimeoutMs,
        autoAcceptScore: settings.lyricsAutoAcceptScore,
        coverAutoAcceptScore: settings.lyricsCoverAutoAcceptScore,
        deepSearchEnabled: settings.lyricsDeepSearchEnabled,
        collectAllCandidates: false,
        preferredSecondaryFields: preferredSecondaryFields(settings),
        isRejected: (provider, providerLyricsId) => this.hasRejectedProviderLyrics(trackId, provider, providerLyricsId),
      });
      if (!result.accepted) {
        this.wordTimingRefreshMisses.add(refreshKey);
        return cached;
      }

      const lyrics = providerResultToTrackLyrics(query, result.accepted.providerResult, result.accepted.score);
      if (!lyrics || !lyrics.lines.some((line) => line.words?.length)) {
        this.wordTimingRefreshMisses.add(refreshKey);
        return cached;
      }

      return this.writeLyricsCacheWithRepair(query, await this.enrichLyricsForCache(query, lyrics, settings));
    } catch {
      this.wordTimingRefreshMisses.add(refreshKey);
      return cached;
    }
  }
}

let defaultLyricsService: LyricsService | null = null;

export const getLyricsService = (): LyricsService => {
  assertProtectedLibraryAvailable();
  if (!defaultLyricsService) {
    const electronApp = (electron as unknown as { app?: { getPath: (name: string) => string } }).app;

    if (!electronApp) {
      throw new Error('Electron app module is unavailable outside the Electron main process');
    }

    const databaseConnection = getLibraryDatabaseManager().openServiceConnection('lyrics');
    defaultLyricsService = new LyricsService(
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

  return defaultLyricsService;
};

export const closeDefaultLyricsService = (): void => {
  if (!defaultLyricsService) {
    return;
  }

  defaultLyricsService.close();
  defaultLyricsService = null;
};
