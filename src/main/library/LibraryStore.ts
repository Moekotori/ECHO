import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { setImmediate as yieldToMainLoop } from 'node:timers/promises';
import type { EchoDatabase } from '../database/createDatabase';
import { BPM_ANALYSIS_VERSION } from '../../shared/constants/audioAnalysis';
import { REPLAY_GAIN_ANALYSIS_VERSION } from '../../shared/constants/replayGain';
import type { RemoteAlbumMergeStrategy } from '../../shared/types/appSettings';
import { chineseSearchVariants } from './ChineseSearchVariants';
import {
  buildTrackSearchTerms,
  buildTrackSearchTermsAsync,
  hasJapaneseSearchText,
  preloadSearchIndexRomanizer,
  type SearchIndexTrackFields,
} from './SearchIndexTokens';
import { normalizeAlbumTitleForLooseMerge, type AlbumKeyInput, type AlbumMergeStrategy, type AlbumService } from './AlbumService';
import {
  artistMergeKeyForName,
  artistNameMatchesMergeKey,
  chooseArtistDisplayName,
  findArtistMergeKey,
  normalizeArtistMergeStrategy,
  splitArtistCreditParts,
} from './ArtistMerge';
import { updateCoverPathsInDatabase } from './CoverCacheManager';
import { DuplicateTrackService } from './duplicates/DuplicateTrackService';
import { subsonicDirectCoverUrlFor } from './remote/remoteCoverUrls';
import {
  normalizeRemoteAlbumMergeStrategy,
  normalizeRemoteAlbumTitleForMerge,
  remoteDirectoryName,
} from './remote/RemoteAlbumGrouping';
import {
  ARTIST_IMAGE_CACHE_SOURCE_HASH_PREFIX,
  ARTIST_IMAGE_CACHE_SOURCE_VERSION,
  isCurrentArtistImageCacheSourceHash,
} from './artistImages/ArtistImageTypes';
import type {
  CoverSource,
  CoverResult,
  CoverVariant,
  LibraryAlbum,
  LibraryAlbumDetail,
  LibraryArtist,
  LibraryDiagnostics,
  LibraryFolder,
  LibraryFolderChildrenQuery,
  LibraryFolderNode,
  LibraryFolderOverview,
  LibraryFolderPathRequest,
  LibraryFolderTracksQuery,
  LibraryPage,
  LibraryPageQuery,
  LibraryQualityIssueItem,
  LibraryQualityIssueKind,
  LibraryQualityIssuePage,
  LibraryQualityIssueQuery,
  LibraryQualityIssueReason,
  LibraryQualityOverviewItem,
  LibraryInboxAlbumSummary,
  LibraryInboxBatch,
  LibraryInboxCreatePlaylistRequest,
  LibraryInboxFilterKind,
  LibraryInboxItemRef,
  LibraryInboxItemStatus,
  LibraryInboxIssueReason,
  LibraryInboxPlaylistResult,
  LibraryInboxQueueResult,
  LibraryInboxScope,
  LibraryInboxStatusFilter,
  LibraryInboxStory,
  LibraryInboxTrackPage,
  LibraryInboxTrackQuery,
  LibraryInboxUpdateStateRequest,
  LibraryInboxUpdateStateResult,
  LibraryPlaylist,
  LibraryPlaylistItem,
  DuplicateTrackCleanupPreview,
  DuplicateTrackGroup,
  DuplicateTrackIndexSummary,
  DuplicateTrackMember,
  DuplicateTrackMode,
  ArtistImageCacheStatus,
  PlaybackHistoryEntry,
  PlaybackHistoryQuery,
  PlaybackHistorySummary,
  PlaybackStatsDashboard,
  LibraryScanStatus,
  LibrarySummary,
  LibraryTrack,
  ScanDirectorySnapshot,
  ScanDirectorySnapshotEntry,
  ScanJobUpdate,
  StoredTrackCoverState,
  StoredTrackFingerprint,
  TrackWrite,
  ArtistInsights,
  ArtistInsightsOptions,
  ArtistInsightEdge,
  ArtistInsightNode,
  ArtistOnlineInfo,
} from './libraryTypes';
import { COVER_CACHE_VERSION as currentCoverCacheVersion } from './libraryTypes';

type DbRow = Record<string, unknown>;
type PlaybackHistoryValidationCandidate = {
  historyKey: string;
  trackPath: string;
};

type PlaybackHistoryPruneResult = {
  removedEntriesCount: number;
  removedStatsCount: number;
};

const emptyArtistOnlineInfo = (message?: string): ArtistOnlineInfo => ({
  status: 'empty',
  bio: null,
  imageCredits: [],
  externalLinks: [],
  relatedArtists: [],
  sourceLabels: [],
  fetchedAt: null,
  expiresAt: null,
  fromCache: false,
  errors: [],
  message,
});
type MarkTracksMissingFromFolderOptions = {
  excludeDirectories?: readonly string[];
};
type ArtistIndexStats = {
  id: string;
  key: string;
  name: string;
  trackIds: Set<string>;
  albumIds: Set<string>;
  coverId: string | null;
  coverScore: number;
};
type AlbumArtistCreditCount = {
  name: string;
  count: number;
  reliableCount: number;
};
type AlbumArtistComponentCount = {
  name: string;
  count: number;
};
type AlbumArtistCreditStats = {
  exactCredits: Map<string, AlbumArtistCreditCount>;
  componentCredits: Map<string, AlbumArtistComponentCount>;
  trackCount: number;
};
type AlbumIndexStats = {
  id: string;
  albumKey: string;
  title: string;
  albumArtist: string;
  albumArtistCredits: AlbumArtistCreditStats;
  year: number | null;
  trackCount: number;
  duration: number;
  coverId: string | null;
};
type AlbumTrackIndexLink = {
  albumId: string;
  trackId: string;
  discNo: number | null;
  trackNo: number | null;
  position: number;
};
export type PlaceholderMetadataTrackTarget = {
  folderId: string;
  path: string;
};
type StandardAlbumTrackIndexLink = Omit<AlbumTrackIndexLink, 'albumId'>;
type StandardAlbumGroup = AlbumIndexStats & {
  keyInput: AlbumKeyInput;
  coverFingerprints: Map<string, number>;
  coverSourceHashes: Map<string, number>;
  links: StandardAlbumTrackIndexLink[];
};
type LooseAlbumCluster = {
  albumKey: string;
  representativeTitle: string;
  representativeLooseTitle: string;
  coverMatchKeys: Set<string>;
};
type LibraryInboxResolvedQuery = {
  batchId: string | null;
  scope: LibraryInboxScope;
  filter: LibraryInboxFilterKind;
  status: LibraryInboxStatusFilter;
  folderId: string | null;
  album: string | null;
  artist: string | null;
  page: number;
  pageSize: number;
  search: string;
  selectedBatch: LibraryInboxBatch | null;
  hasTarget: boolean;
};
type TrackTagUpdateInput = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  bpm?: number | null;
  sizeBytes: number;
  mtimeMs: number;
  fieldSources: Record<string, string>;
  embeddedMetadataStatus?: LibraryTrack['embeddedMetadataStatus'];
  embeddedCoverStatus?: LibraryTrack['embeddedCoverStatus'];
  metadataStatus?: string;
};

const defaultPageSize = 100;
const maxPageSize = 500;
const randomWindowMaxRows = 150;
const libraryQualityPageSize = 50;
const libraryQualityMaxPageSize = 100;
const libraryInboxBatchLimit = 30;
const libraryInboxPageSize = 50;
const libraryInboxMaxPageSize = 100;
const libraryInboxAlbumWallLimit = 24;
const albumSeedTrackBatchSize = 250;
const libraryInboxPlaylistTrackLimit = 1000;
const variousArtistsDisplayName = 'Various Artists';
const variousArtistsKey = 'various artists';
const genericAlbumArtistKeys = new Set([variousArtistsKey, 'unknown artist', 'unknown album', 'unknown']);
const reliableAlbumArtistDisplaySources = new Set(['embedded', 'manual', 'network', 'sidecar']);
const likedSongsSourcePlaylistId = 'liked-tracks';
const likedAlbumsSourcePlaylistId = 'liked-albums';
const neteaseDailyRecommendSourcePlaylistId = 'daily-recommend';
const protectedSystemPlaylistIds = new Set([likedSongsSourcePlaylistId, likedAlbumsSourcePlaylistId, neteaseDailyRecommendSourcePlaylistId]);
const streamingDownloadAddedFrom = (provider: string, providerTrackId: string): string =>
  `streaming-download:${provider}:${providerTrackId}`;
const japaneseRomajiSearchTermsFlag = 'search_terms_japanese_romaji_v2';
const searchTermsBackfillBatchSize = 100;
const libraryQualityOverviewDefinitions: Array<Omit<LibraryQualityOverviewItem, 'count' | 'lastError'>> = [
  {
    kind: 'missing_cover',
    label: '缺封面',
    severity: 'warning',
    description: '没有可用封面的本地歌曲，适合先做封面补齐。',
    actionAvailable: true,
  },
  {
    kind: 'fallback_metadata',
    label: '回退元数据',
    severity: 'warning',
    description: '标题或字段来自文件名兜底，可能需要重新读取标签或网络补全。',
    actionAvailable: true,
  },
  {
    kind: 'unknown_artist_album',
    label: '未知艺人/专辑',
    severity: 'warning',
    description: '艺人、专辑或专辑艺人仍是未知/空值。',
    actionAvailable: true,
  },
  {
    kind: 'embedded_read_failed',
    label: '内嵌读取失败',
    severity: 'danger',
    description: '内嵌标签或封面读取失败，建议先确认文件健康后再重扫。',
    actionAvailable: false,
  },
  {
    kind: 'network_candidate',
    label: '可用网络候选',
    severity: 'info',
    description: '已经找到网络候选但尚未完全应用的歌曲。',
    actionAvailable: true,
  },
];
const unknownArtist = 'Unknown Artist';
const maxLibraryDisplayTextLength = 512;
const maxLibraryTechnicalTextLength = 128;
const maxLibraryJsonTextLength = 16 * 1024;
const binaryLibraryTextPattern = /(?:APIC|image\/(?:jpeg|jpg|png|webp|gif)|JFIF|Exif|\u0000)/iu;

const nowIso = (): string => new Date().toISOString();

const countLibraryControlCharacters = (text: string): number => {
  let count = 0;

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0x00 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      count += 1;
    }
  }

  return count;
};

const normalizeLibraryTextWhitespace = (text: string): string =>
  text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim();

const isUnsafeLibraryText = (text: string, maxLength: number): boolean => {
  if (!text || text.length > maxLength || binaryLibraryTextPattern.test(text)) {
    return true;
  }

  const controlCount = countLibraryControlCharacters(text);
  return controlCount >= 8 || controlCount / Math.max(1, text.length) > 0.02;
};

const stripArtistSortPrefix = (value: string): string => {
  const trimmed = value.trim();
  const stripped = trimmed
    .replace(/^\d{1,3}\s*[.)\uff0e\u3002]\s*/u, '')
    .replace(/^\d{1,3}\s*[-_]\s*(?=[^\d\s(\[\uff08])/u, '')
    .trim();

  return stripped || trimmed;
};

const isLikelyTrackNumberArtistName = (value: string): boolean => {
  const normalized = value.normalize('NFKC').trim();
  return /^\d{1,2}$/u.test(normalized) || /^0+\d*$/u.test(normalized);
};

const filenameArtistFallback = (value: string): string | null => {
  const stripped = stripArtistSortPrefix(value);
  return stripped && !isLikelyTrackNumberArtistName(stripped) ? stripped : null;
};

const filenameTrackFallback = (filePath: string): { title: string; artist: string | null } => {
  const name = basename(filePath, extname(filePath)).trim();
  const parts = name.split(' - ').map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return {
      artist: filenameArtistFallback(parts[0]),
      title: stripArtistSortPrefix(parts.slice(1).join(' - ')),
    };
  }

  return {
    artist: null,
    title: stripArtistSortPrefix(name) || 'Untitled',
  };
};

const sanitizeLibraryText = (value: unknown, fallback: string, maxLength = maxLibraryDisplayTextLength): string => {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();

  if (isUnsafeLibraryText(raw, maxLength)) {
    return fallback;
  }

  const normalized = normalizeLibraryTextWhitespace(raw);
  return isUnsafeLibraryText(normalized, maxLength) ? fallback : normalized;
};

const sanitizeNullableLibraryText = (
  value: unknown,
  maxLength = maxLibraryDisplayTextLength,
): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const sanitized = sanitizeLibraryText(value, '', maxLength);
  return sanitized || null;
};

const sanitizeErrorText = (value: unknown): string => {
  const sanitized = sanitizeLibraryText(value, '[unsafe payload removed]', maxLibraryDisplayTextLength);
  return sanitized || '[unsafe payload removed]';
};

const sanitizeErrorList = (errors: string[]): string[] =>
  errors.slice(0, 200).map((error) => sanitizeErrorText(error));

const sanitizeTrackWrite = (track: TrackWrite): TrackWrite => {
  const filenameGuess = filenameTrackFallback(track.path);
  const fieldSources = { ...track.fieldSources };
  const title = sanitizeLibraryText(track.title, filenameGuess.title);
  const artist = sanitizeLibraryText(track.artist, filenameGuess.artist ?? unknownArtist);
  const album = sanitizeLibraryText(track.album, '');
  const albumArtist = sanitizeLibraryText(track.albumArtist, artist);
  const genre = sanitizeNullableLibraryText(track.genre);
  const codec = sanitizeNullableLibraryText(track.codec, maxLibraryTechnicalTextLength);

  if (title !== track.title && title === filenameGuess.title) {
    fieldSources.title = 'filename_fallback';
  }
  if (artist !== track.artist) {
    fieldSources.artist = filenameGuess.artist ? 'filename_fallback' : 'unknown';
  }
  if (album !== track.album) {
    fieldSources.album = 'unknown';
  }
  if (albumArtist !== track.albumArtist) {
    fieldSources.albumArtist = 'artist_fallback';
  }
  if (genre !== track.genre) {
    fieldSources.genre = 'unknown';
  }
  if (codec !== track.codec) {
    fieldSources.codec = codec ? 'filename_fallback' : 'unknown';
  }

  return {
    ...track,
    title,
    artist,
    album,
    albumArtist,
    genre,
    codec,
    fieldSources,
  };
};

const uniqueTextIds = (ids: unknown[] | undefined, limit = 250): string[] => {
  if (!Array.isArray(ids)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of ids) {
    if (typeof value !== 'string') {
      continue;
    }

    const id = value.trim();
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
};

const shuffleRows = <Row,>(rows: Row[]): Row[] => {
  const next = [...rows];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
};

const randomOneBasedRowNumbers = (totalRows: number, count: number): number[] => {
  const total = Math.max(0, Math.floor(totalRows));
  const target = Math.max(0, Math.min(total, Math.floor(count)));
  if (total <= 0 || target <= 0) {
    return [];
  }

  const selected = new Set<number>();
  const maxRandomAttempts = target * 4;
  let attempts = 0;
  while (selected.size < target && attempts < maxRandomAttempts) {
    selected.add(Math.floor(Math.random() * total) + 1);
    attempts += 1;
  }

  if (selected.size < target) {
    const start = Math.floor(Math.random() * total);
    for (let index = 0; selected.size < target && index < total; index += 1) {
      selected.add(((start + index) % total) + 1);
    }
  }

  return [...selected];
};

const pageFromQuery = (
  query?: LibraryPageQuery,
): {
  page: number;
  pageSize: number;
  search: string;
  sort: string;
  sourceProvider: string | null;
  sourceId: string | null;
  excludeTrackIds: string[];
  randomWindow: boolean;
} => ({
  page: Math.max(1, Math.floor(Number(query?.page ?? 1))),
  pageSize: Math.min(maxPageSize, Math.max(1, Math.floor(Number(query?.pageSize ?? defaultPageSize)))),
  search: typeof query?.search === 'string' ? query.search.trim() : '',
  sort: query?.sort ?? 'default',
  sourceProvider:
    query?.sourceProvider === 'local' ||
    query?.sourceProvider === 'netease' ||
    query?.sourceProvider === 'qqmusic' ||
    query?.sourceProvider === 'kugou' ||
    query?.sourceProvider === 'spotify' ||
    query?.sourceProvider === 'remote'
      ? query.sourceProvider
      : null,
  sourceId: typeof query?.sourceId === 'string' && query.sourceId.trim().length > 0 ? query.sourceId.trim() : null,
  excludeTrackIds: uniqueTextIds(query?.excludeTrackIds),
  randomWindow: query?.randomWindow === true,
});

const libraryMediaTypeFromSourceProvider = (sourceProvider: string | null): 'local' | 'remote' | null =>
  sourceProvider === 'local' || sourceProvider === 'remote' ? sourceProvider : null;

const pageFromQualityQuery = (query: LibraryQualityIssueQuery): { page: number; pageSize: number; search: string } => ({
  page: Math.max(1, Math.floor(Number(query.page ?? 1))),
  pageSize: Math.min(libraryQualityMaxPageSize, Math.max(1, Math.floor(Number(query.pageSize ?? libraryQualityPageSize)))),
  search: typeof query.search === 'string' ? query.search.trim() : '',
});

const libraryInboxFilters = new Set<LibraryInboxFilterKind>([
  'all',
  'missing_cover',
  'metadata_issue',
  'unknown_artist',
  'unknown_album',
  'suspicious_file',
]);

const libraryInboxScopes = new Set<LibraryInboxScope>(['latest', 'batch', 'all']);
const libraryInboxStatuses = new Set<LibraryInboxStatusFilter>(['all', 'pending', 'processed', 'ignored']);

const pageFromInboxQuery = (
  query?: LibraryInboxTrackQuery,
): {
  batchId: string | null;
  scope: LibraryInboxScope;
  filter: LibraryInboxFilterKind;
  status: LibraryInboxStatusFilter;
  folderId: string | null;
  album: string | null;
  artist: string | null;
  page: number;
  pageSize: number;
  search: string;
} => {
  const rawScope = query?.scope;
  const scope = rawScope && libraryInboxScopes.has(rawScope) ? rawScope : query?.batchId ? 'batch' : 'latest';
  const rawFilter = query?.filter;
  const rawStatus = query?.status;

  return {
    batchId: typeof query?.batchId === 'string' && query.batchId.trim() ? query.batchId.trim() : null,
    scope,
    filter: rawFilter && libraryInboxFilters.has(rawFilter) ? rawFilter : 'all',
    status: rawStatus && libraryInboxStatuses.has(rawStatus) ? rawStatus : 'all',
    folderId: typeof query?.folderId === 'string' && query.folderId.trim() ? query.folderId.trim() : null,
    album: typeof query?.album === 'string' && query.album.trim() ? query.album.trim() : null,
    artist: typeof query?.artist === 'string' && query.artist.trim() ? query.artist.trim() : null,
    page: Math.max(1, Math.floor(Number(query?.page ?? 1))),
    pageSize: Math.min(libraryInboxMaxPageSize, Math.max(1, Math.floor(Number(query?.pageSize ?? libraryInboxPageSize)))),
    search: typeof query?.search === 'string' ? query.search.trim() : '',
  };
};

const pageFromHistoryQuery = (
  query?: PlaybackHistoryQuery,
): { page: number; pageSize: number; search: string; from: string | null; to: string | null; completedOnly: boolean; sort: 'plays' | 'recent' } => ({
  page: Math.max(1, Math.floor(Number(query?.page ?? 1))),
  pageSize: Math.min(maxPageSize, Math.max(1, Math.floor(Number(query?.pageSize ?? 50)))),
  search: typeof query?.search === 'string' ? query.search.trim() : '',
  from: typeof query?.from === 'string' && query.from.trim() ? query.from.trim() : null,
  to: typeof query?.to === 'string' && query.to.trim() ? query.to.trim() : null,
  completedOnly: query?.completedOnly === true,
  sort: query?.sort === 'recent' ? 'recent' : 'plays',
});

const playbackStatsActivityDays = 371;

const playbackStatsActivityStartIso = (): string => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (playbackStatsActivityDays - 1));
  return start.toISOString();
};

const likeSearch = (search: string): string => `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
const likePrefix = (prefix: string): string => `${prefix.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
const searchSeparatorPattern = /[\s!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~_-]+/u;
const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const pathSeparatorPattern = /[\\/]+/u;
const preferredPathSeparator = process.platform === 'win32' ? '\\' : '/';

const sqlString = (value: string): string => `'${value.replace(/'/gu, "''")}'`;

const stripTrailingPathSeparators = (value: string): string => {
  const normalized = resolve(value);
  const rootMatch = normalized.match(/^[A-Za-z]:[\\/]?$/u);

  if (rootMatch || normalized === '/' || normalized === '\\') {
    return normalized;
  }

  return normalized.replace(/[\\/]+$/u, '');
};

const pathCompareValue = (value: string): string =>
  process.platform === 'win32' ? stripTrailingPathSeparators(value).toLocaleLowerCase() : stripTrailingPathSeparators(value);

const isPathInsideOrEqual = (rootPath: string, candidatePath: string): boolean => {
  const root = pathCompareValue(rootPath);
  const candidate = pathCompareValue(candidatePath);

  return candidate === root || candidate.startsWith(`${root}\\`) || candidate.startsWith(`${root}/`);
};

const childPathFor = (parentPath: string, childName: string): string =>
  `${stripTrailingPathSeparators(parentPath)}${preferredPathSeparator}${childName}`;

const folderDepth = (rootPath: string, folderPath: string): number => {
  const root = stripTrailingPathSeparators(rootPath);
  const folder = stripTrailingPathSeparators(folderPath);

  if (pathCompareValue(root) === pathCompareValue(folder)) {
    return 0;
  }

  const prefixLength = root.endsWith('\\') || root.endsWith('/') ? root.length : root.length + 1;
  return folder.slice(prefixLength).split(pathSeparatorPattern).filter(Boolean).length;
};

type SearchPredicate = (term: string) => { sql: string; params: string[] };
type LibraryStoreSearchOptions = {
  chineseCrossScriptSearchEnabled?: boolean;
  artistMergeStrategy?: 'conservative' | 'standard';
  remoteAlbumMergeStrategy?: RemoteAlbumMergeStrategy;
};

const likePredicate =
  (expression: string): SearchPredicate =>
  (term) => ({
    sql: `${expression} LIKE ? ESCAPE '\\'`,
    params: [likeSearch(term)],
  });

const searchTerms = (search: string): string[] => {
  const normalized = search.normalize('NFKC').trim();
  const parts = normalized.split(searchSeparatorPattern).filter(Boolean);
  const terms =
    parts.length === 1 && cjkPattern.test(parts[0]) && Array.from(parts[0]).length > 2 ? Array.from(parts[0]) : parts;

  return Array.from(new Set(terms)).slice(0, 12);
};

const ftsBarewordPattern = /^[\p{L}\p{N}_]+$/u;
const ftsReservedTerms = new Set(['and', 'or', 'not']);

const ftsSearchTerms = (search: string): string[] =>
  Array.from(new Set(search.normalize('NFKC').trim().split(searchSeparatorPattern).filter(Boolean))).slice(0, 12);

const ftsTerm = (term: string): string => {
  if (ftsBarewordPattern.test(term) && !ftsReservedTerms.has(term.toLocaleLowerCase())) {
    return `${term}*`;
  }

  return `"${term.replace(/"/g, '""')}"`;
};

const searchTermVariants = (term: string, options?: LibraryStoreSearchOptions): string[] =>
  options?.chineseCrossScriptSearchEnabled === false ? [term] : chineseSearchVariants(term);

export const buildFtsSearchQuery = (search: string, options?: LibraryStoreSearchOptions): string =>
  ftsSearchTerms(search)
    .map((term) => {
      const variants = searchTermVariants(term, options).map(ftsTerm);
      return variants.length === 1 ? variants[0] : `(${variants.join(' OR ')})`;
    })
    .join(' AND ');

const buildSearchFilter = (
  search: string,
  predicates: SearchPredicate[],
  options?: LibraryStoreSearchOptions,
): { sql: string; params: string[] } => {
  const terms = searchTerms(search);

  if (terms.length === 0) {
    return { sql: '', params: [] };
  }

  const params: string[] = [];
  const sql = terms
    .map((term) => {
      const clauses = searchTermVariants(term, options).flatMap((variant) => predicates.map((predicate) => predicate(variant)));
      params.push(...clauses.flatMap((clause) => clause.params));
      return `(${clauses.map((clause) => clause.sql).join(' OR ')})`;
    })
    .join(' AND ');

  return { sql, params };
};

const parseJsonObject = (value: unknown): Record<string, string> => {
  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const parseErrors = (value: unknown): string[] => {
  if (typeof value !== 'string') {
    return [];
  }

  if (value.length > maxLibraryJsonTextLength || binaryLibraryTextPattern.test(value)) {
    return ['[unsafe scan error payload removed]'];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? sanitizeErrorList(parsed.filter((item): item is string => typeof item === 'string')) : [];
  } catch {
    return [];
  }
};

const isSafeScanDirectorySnapshotEntry = (value: unknown): value is ScanDirectorySnapshotEntry => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Partial<ScanDirectorySnapshotEntry>;
  return (
    typeof entry.name === 'string' &&
    entry.name.length > 0 &&
    !entry.name.includes('/') &&
    !entry.name.includes('\\') &&
    (entry.kind === 'directory' || entry.kind === 'file')
  );
};

const parseScanDirectorySnapshotEntries = (value: unknown): ScanDirectorySnapshotEntry[] | null => {
  if (typeof value !== 'string') {
    return null;
  }

  if (binaryLibraryTextPattern.test(value)) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every(isSafeScanDirectorySnapshotEntry) ? parsed : null;
  } catch {
    return null;
  }
};

const sanitizeScanDirectorySnapshotEntries = (entries: readonly ScanDirectorySnapshotEntry[]): ScanDirectorySnapshotEntry[] | null =>
  entries.every(isSafeScanDirectorySnapshotEntry) ? entries.map((entry) => ({ name: entry.name, kind: entry.kind })) : null;

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const mostCommonMapKey = (counts: Map<string, number>): string | null => {
  let selected: string | null = null;
  let selectedCount = 0;

  for (const [key, count] of counts) {
    if (count > selectedCount) {
      selected = key;
      selectedCount = count;
    }
  }

  return selected;
};
const normalizeAlbumTitleForSimilarity = normalizeAlbumTitleForLooseMerge;
const isKnownLooseAlbumTitle = (value: string): boolean => value.length > 0 && value !== 'unknown album';
const albumTitleSimilarity = (left: string, right: string): number => {
  const a = normalizeAlbumTitleForSimilarity(left);
  const b = normalizeAlbumTitleForSimilarity(right);

  if (!a || !b || a === 'unknown album' || b === 'unknown album') {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

  const grams = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index += 1) {
    const gram = a.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }

  let matches = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const gram = b.slice(index, index + 2);
    const count = grams.get(gram) ?? 0;
    if (count > 0) {
      matches += 1;
      grams.set(gram, count - 1);
    }
  }

  return (2 * matches) / (a.length + b.length - 2);
};
const coverFingerprint = (sourceType: string | null, sourceHash: string | null, albumPath: string | null): string | null => {
  if (sourceType === 'default') {
    return null;
  }

  if (albumPath && existsSync(albumPath)) {
    try {
      return createHash('sha1').update(readFileSync(albumPath)).digest('hex');
    } catch {
      // Fall back to the extractor hash when the cached derivative cannot be read.
    }
  }

  return sourceHash;
};
const playbackHistoryKey = (trackId: string | null, trackPath: string): string => trackId ?? trackPath;
const coverSourceOrNull = (value: unknown): CoverSource | null =>
  value === 'manual' || value === 'embedded' || value === 'folder' || value === 'network' || value === 'default' ? value : null;
const artistImageStatusOrNull = (value: unknown): ArtistImageCacheStatus | null =>
  value === 'pending' ||
  value === 'loading' ||
  value === 'matched' ||
  value === 'not_found' ||
  value === 'error' ||
  value === 'rate_limited'
    ? value
    : null;
const coverSourceRank: Record<CoverSource, number> = {
  default: 0,
  network: 1,
  folder: 2,
  embedded: 3,
  manual: 4,
};

const stableArtistAlbumScore = (artistKey: string, albumId: string): number => {
  let hash = 2166136261;
  const value = `${artistKey}:${albumId}`;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const normalizeArtistDisplayName = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const normalizeArtistComponentName = (value: string): string => {
  const normalized = normalizeArtistDisplayName(stripArtistSortPrefix(value));
  return normalized && !isLikelyTrackNumberArtistName(normalized) ? normalized : '';
};

const artistKeyForName = (name: string): string => name.normalize('NFKC').toLocaleLowerCase();
const numericArtistSlashPlaceholder = '__ECHO_NUMERIC_ARTIST_SLASH__';
const protectNumericArtistSlashes = (value: string): string =>
  value.replace(/(\p{Number})\s*\/\s*(?=\p{Number})/gu, `$1${numericArtistSlashPlaceholder}`);
const restoreNumericArtistSlashes = (value: string): string => value.replaceAll(numericArtistSlashPlaceholder, '/');

const albumArtistCreditForTrack = (albumArtist: string, fallbackArtist: string): string =>
  normalizeArtistDisplayName(albumArtist || fallbackArtist) || 'Unknown Artist';

const isGenericAlbumArtistKey = (key: string): boolean => genericAlbumArtistKeys.has(key);

const splitArtistNames = (value: unknown): string[] => {
  const normalized = normalizeArtistDisplayName(value);

  if (!normalized) {
    return [];
  }

  const names = splitArtistCreditParts(protectNumericArtistSlashes(normalized))
    .map((name) => normalizeArtistComponentName(restoreNumericArtistSlashes(name)))
    .filter(Boolean);
  const uniqueNames = new Map<string, string>();

  for (const name of names) {
    const key = artistKeyForName(name);
    if (!uniqueNames.has(key)) {
      uniqueNames.set(key, name);
    }
  }

  return Array.from(uniqueNames.values());
};

const createAlbumArtistCreditStats = (): AlbumArtistCreditStats => ({
  exactCredits: new Map(),
  componentCredits: new Map(),
  trackCount: 0,
});

const addAlbumArtistComponentCount = (counts: Map<string, AlbumArtistComponentCount>, key: string, name: string): AlbumArtistComponentCount => {
  const current = counts.get(key);

  if (current) {
    current.count += 1;
    return current;
  }

  const next = { name, count: 1 };
  counts.set(key, next);
  return next;
};

const addAlbumArtistCredit = (
  stats: AlbumArtistCreditStats,
  albumArtist: string,
  fallbackArtist: string,
  source: unknown,
): void => {
  const credit = albumArtistCreditForTrack(albumArtist, fallbackArtist);
  const creditKey = artistKeyForName(credit);
  const isReliable = typeof source === 'string' && reliableAlbumArtistDisplaySources.has(source);
  const exactCredit = stats.exactCredits.get(creditKey) ?? { name: credit, count: 0, reliableCount: 0 };
  const componentSource = isGenericAlbumArtistKey(creditKey) ? fallbackArtist : credit;

  exactCredit.count += 1;
  if (isReliable) {
    exactCredit.reliableCount += 1;
  }
  stats.exactCredits.set(creditKey, exactCredit);

  for (const component of splitArtistNames(componentSource)) {
    addAlbumArtistComponentCount(stats.componentCredits, artistKeyForName(component), component);
  }

  stats.trackCount += 1;
};

const mergeAlbumArtistCreditStats = (target: AlbumArtistCreditStats, source: AlbumArtistCreditStats): void => {
  for (const [key, credit] of source.exactCredits) {
    const current = target.exactCredits.get(key);
    if (current) {
      current.count += credit.count;
      current.reliableCount += credit.reliableCount;
    } else {
      target.exactCredits.set(key, { ...credit });
    }
  }

  for (const [key, component] of source.componentCredits) {
    const current = target.componentCredits.get(key);
    if (current) {
      current.count += component.count;
    } else {
      target.componentCredits.set(key, { ...component });
    }
  }

  target.trackCount += source.trackCount;
};

const dominantAlbumArtistComponent = (stats: AlbumArtistCreditStats): string | null => {
  if (stats.trackCount <= 1) {
    return null;
  }

  const components = Array.from(stats.componentCredits.values()).sort((left, right) => right.count - left.count);
  const top = components[0];

  if (!top) {
    return null;
  }

  if (top.count === stats.trackCount) {
    return top.name;
  }

  const nextCount = components[1]?.count ?? 0;
  const minimumCount = stats.trackCount <= 3 ? stats.trackCount : Math.ceil(stats.trackCount * 0.65);
  return top.count >= minimumCount && top.count > nextCount ? top.name : null;
};

const displayAlbumArtistForCredits = (preferredName: string, stats: AlbumArtistCreditStats): string => {
  const reliableCredits = Array.from(stats.exactCredits.values()).filter((credit) => credit.reliableCount > 0);

  if (reliableCredits.length === 1) {
    const reliableCredit = reliableCredits[0];
    if (isGenericAlbumArtistKey(artistKeyForName(reliableCredit.name))) {
      return dominantAlbumArtistComponent(stats) ?? reliableCredit.name;
    }
    return reliableCredit.name;
  }

  if (reliableCredits.length > 1) {
    return dominantAlbumArtistComponent(stats) ?? variousArtistsDisplayName;
  }

  if (stats.exactCredits.size <= 1) {
    return preferredName;
  }

  return dominantAlbumArtistComponent(stats) ?? variousArtistsDisplayName;
};

const preferredCoverSource = (current: unknown, next: CoverSource): CoverSource => {
  const currentSource = coverSourceOrNull(current);
  return currentSource && coverSourceRank[currentSource] > coverSourceRank[next] ? currentSource : next;
};

export class LibraryStore {
  private lastTracksQueryMs: number | null = null;
  private lastAlbumsQueryMs: number | null = null;

  constructor(
    private readonly database: EchoDatabase,
    private readonly readSearchOptions: () => LibraryStoreSearchOptions = () => ({ chineseCrossScriptSearchEnabled: true }),
  ) {
    this.database.function('echo_artist_merge_key', (value: unknown) => {
      const strategy = normalizeArtistMergeStrategy(this.readSearchOptions().artistMergeStrategy);
      return artistMergeKeyForName(value, strategy);
    });
    this.database.function('echo_artist_matches', (value: unknown, key: unknown) => {
      const targetKey = typeof key === 'string' ? key : '';
      if (!targetKey) {
        return 0;
      }

      const strategy = normalizeArtistMergeStrategy(this.readSearchOptions().artistMergeStrategy);
      return splitArtistNames(value).some((name) => artistNameMatchesMergeKey(name, targetKey, strategy)) ? 1 : 0;
    });
    this.database.function('echo_remote_dirname', remoteDirectoryName);
    this.database.function('echo_remote_album_merge_title', normalizeRemoteAlbumTitleForMerge);
    this.backfillSearchTerms();
  }

  private backfillSearchTerms(): void {
    const localRows = this.database
      .prepare<[], DbRow>(
        `SELECT id, path, title, artist, album, album_artist, genre
         FROM tracks
         WHERE search_terms = '' OR search_terms IS NULL`,
      )
      .all();
    const remoteRows = this.database
      .prepare<[], DbRow>(
        `SELECT id, remote_path, title, artist, album, album_artist, genre
         FROM remote_tracks
         WHERE search_terms = '' OR search_terms IS NULL`,
      )
      .all();

    if (localRows.length === 0 && remoteRows.length === 0) {
      return;
    }

    const updateLocal = this.database.prepare<[string, string]>('UPDATE tracks SET search_terms = ? WHERE id = ?');
    const updateRemote = this.database.prepare<[string, string]>('UPDATE remote_tracks SET search_terms = ? WHERE id = ?');

    this.database.transaction(() => {
      for (const row of localRows) {
        updateLocal.run(
          buildTrackSearchTerms({
            title: String(row.title ?? ''),
            artist: String(row.artist ?? ''),
            album: String(row.album ?? ''),
            albumArtist: String(row.album_artist ?? ''),
            genre: textOrNull(row.genre),
            path: textOrNull(row.path),
          }),
          String(row.id),
        );
      }

      for (const row of remoteRows) {
        updateRemote.run(
          buildTrackSearchTerms({
            title: String(row.title ?? ''),
            artist: String(row.artist ?? ''),
            album: String(row.album ?? ''),
            albumArtist: String(row.album_artist ?? ''),
            genre: textOrNull(row.genre),
            remotePath: textOrNull(row.remote_path),
          }),
          String(row.id),
        );
      }
    })();
  }

  async prepareTrackSearchTerms(track: TrackWrite): Promise<string> {
    return buildTrackSearchTermsAsync(this.searchFieldsForTrackWrite(track));
  }

  async prepareTrackTagSearchTerms(trackId: string, update: TrackTagUpdateInput): Promise<string> {
    return buildTrackSearchTermsAsync(this.searchFieldsForTrackTagUpdate(trackId, update));
  }

  async rebuildJapaneseRomanizedSearchTerms(): Promise<number> {
    if (this.hasMaintenanceFlag(japaneseRomajiSearchTermsFlag)) {
      return 0;
    }
    if (!(await preloadSearchIndexRomanizer())) {
      return 0;
    }

    const changed = (await this.rebuildLocalJapaneseSearchTerms()) + (await this.rebuildRemoteJapaneseSearchTerms());
    this.setMaintenanceFlag(japaneseRomajiSearchTermsFlag, 'complete');
    return changed;
  }

  isJapaneseRomanizedSearchReady(): boolean {
    return this.hasMaintenanceFlag(japaneseRomajiSearchTermsFlag);
  }

  private searchFieldsForTrackWrite(track: TrackWrite): SearchIndexTrackFields {
    const safeTrack = sanitizeTrackWrite(track);
    return {
      title: safeTrack.title,
      artist: safeTrack.artist,
      album: safeTrack.album,
      albumArtist: safeTrack.albumArtist,
      genre: safeTrack.genre,
      path: resolve(safeTrack.path),
    };
  }

  private searchFieldsForTrackTagUpdate(trackId: string, update: TrackTagUpdateInput): SearchIndexTrackFields {
    const current = this.getTrack(trackId);
    const filenameGuess = filenameTrackFallback(current?.path ?? update.title);
    const safeTitle = sanitizeLibraryText(update.title, filenameGuess.title);
    const safeArtist = sanitizeLibraryText(update.artist, filenameGuess.artist ?? unknownArtist);
    const safeAlbum = sanitizeLibraryText(update.album, '');
    const safeAlbumArtist = sanitizeLibraryText(update.albumArtist, safeArtist);
    const safeGenre = sanitizeNullableLibraryText(update.genre);

    return {
      title: safeTitle,
      artist: safeArtist,
      album: safeAlbum,
      albumArtist: safeAlbumArtist,
      genre: safeGenre,
      path: current?.path,
    };
  }

  private hasMaintenanceFlag(key: string): boolean {
    const row = this.database.prepare<[string], { value: string }>('SELECT value FROM library_maintenance_flags WHERE key = ?').get(key);
    return row?.value === 'complete';
  }

  private setMaintenanceFlag(key: string, value: string): void {
    this.database
      .prepare<[string, string, string]>(
        `INSERT INTO library_maintenance_flags (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, nowIso());
  }

  private async rebuildLocalJapaneseSearchTerms(): Promise<number> {
    const selectRows = this.database.prepare<[number, number], DbRow>(
      `SELECT rowid, id, path, title, artist, album, album_artist, genre, search_terms
       FROM tracks
       WHERE rowid > ?
       ORDER BY rowid
       LIMIT ?`,
    );
    const updateRow = this.database.prepare<[string, string]>('UPDATE tracks SET search_terms = ? WHERE id = ?');
    let changed = 0;
    let lastRowId = 0;

    while (true) {
      const rows = selectRows.all(lastRowId, searchTermsBackfillBatchSize);
      if (rows.length === 0) {
        break;
      }

      lastRowId = Number(rows[rows.length - 1]?.rowid ?? lastRowId);
      const updates: Array<{ id: string; searchTerms: string }> = [];

      for (const row of rows) {
        const fields = {
          title: String(row.title ?? ''),
          artist: String(row.artist ?? ''),
          album: String(row.album ?? ''),
          albumArtist: String(row.album_artist ?? ''),
          genre: textOrNull(row.genre),
          path: textOrNull(row.path),
        };

        if (!hasJapaneseSearchText(fields)) {
          continue;
        }

        const searchTerms = await buildTrackSearchTermsAsync(fields);
        if (searchTerms && searchTerms !== String(row.search_terms ?? '')) {
          updates.push({ id: String(row.id), searchTerms });
        }
      }

      if (updates.length > 0) {
        this.database.transaction(() => {
          for (const update of updates) {
            updateRow.run(update.searchTerms, update.id);
            changed += 1;
          }
        })();
      }

      await yieldToMainLoop();
    }

    return changed;
  }

  private async rebuildRemoteJapaneseSearchTerms(): Promise<number> {
    const selectRows = this.database.prepare<[number, number], DbRow>(
      `SELECT rowid, id, remote_path, title, artist, album, album_artist, genre, search_terms
       FROM remote_tracks
       WHERE rowid > ?
       ORDER BY rowid
       LIMIT ?`,
    );
    const updateRow = this.database.prepare<[string, string]>('UPDATE remote_tracks SET search_terms = ? WHERE id = ?');
    let changed = 0;
    let lastRowId = 0;

    while (true) {
      const rows = selectRows.all(lastRowId, searchTermsBackfillBatchSize);
      if (rows.length === 0) {
        break;
      }

      lastRowId = Number(rows[rows.length - 1]?.rowid ?? lastRowId);
      const updates: Array<{ id: string; searchTerms: string }> = [];

      for (const row of rows) {
        const fields = {
          title: String(row.title ?? ''),
          artist: String(row.artist ?? ''),
          album: String(row.album ?? ''),
          albumArtist: String(row.album_artist ?? ''),
          genre: textOrNull(row.genre),
          remotePath: textOrNull(row.remote_path),
        };

        if (!hasJapaneseSearchText(fields)) {
          continue;
        }

        const searchTerms = await buildTrackSearchTermsAsync(fields);
        if (searchTerms && searchTerms !== String(row.search_terms ?? '')) {
          updates.push({ id: String(row.id), searchTerms });
        }
      }

      if (updates.length > 0) {
        this.database.transaction(() => {
          for (const update of updates) {
            updateRow.run(update.searchTerms, update.id);
            changed += 1;
          }
        })();
      }

      await yieldToMainLoop();
    }

    return changed;
  }

  transaction<T>(work: () => T): T {
    if (this.database.inTransaction) {
      return work();
    }

    return this.database.transaction(work)();
  }

  addFolder(folderPath: string): LibraryFolder {
    const normalizedPath = resolve(folderPath);
    const existing = this.getRow('SELECT * FROM folders WHERE path = ?', normalizedPath);
    const timestamp = nowIso();

    if (existing) {
      this.run('UPDATE folders SET status = ?, enabled = ?, updated_at = ? WHERE id = ?', 'active', 1, timestamp, existing.id);
      return this.mapFolder({ ...existing, status: 'active', enabled: 1, updated_at: timestamp });
    }

    const id = randomUUID();
    const name = basename(normalizedPath) || normalizedPath;

    this.run(
      `INSERT INTO folders (id, path, name, status, enabled, last_scan_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      normalizedPath,
      name,
      'active',
      1,
      null,
      timestamp,
      timestamp,
    );

    return {
      id,
      path: normalizedPath,
      name,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  getFolders(): LibraryFolder[] {
    return this.allRows(
      "SELECT * FROM folders WHERE enabled = 1 AND status != 'removed' ORDER BY path COLLATE NOCASE",
    ).map((row) => this.mapFolder(row));
  }

  getFolder(folderId: string): LibraryFolder | null {
    const row = this.getRow("SELECT * FROM folders WHERE id = ? AND enabled = 1 AND status != 'removed'", folderId);
    return row ? this.mapFolder(row) : null;
  }

  getFolderOverviews(): LibraryFolderOverview[] {
    return this.allRows(
      "SELECT * FROM folders WHERE enabled = 1 AND status != 'removed' ORDER BY path COLLATE NOCASE",
    ).map((row) => {
      const folder = this.mapFolder(row);
      const activeStats = this.getRow(
        `SELECT
          COUNT(*) AS track_count,
          COALESCE(SUM(duration), 0) AS total_duration,
          COALESCE(SUM(size_bytes), 0) AS total_size_bytes,
          COALESCE(SUM(CASE WHEN UPPER(COALESCE(codec, '')) IN ('FLAC', 'ALAC', 'WAV', 'AIFF', 'APE', 'DSF', 'DFF') THEN 1 ELSE 0 END), 0) AS lossless_count,
          COALESCE(SUM(CASE WHEN (COALESCE(bit_depth, 0) >= 24 AND COALESCE(sample_rate, 0) >= 88200) OR UPPER(COALESCE(codec, '')) IN ('DSF', 'DFF', 'DSD') THEN 1 ELSE 0 END), 0) AS hires_count
         FROM tracks
         WHERE folder_id = ? AND missing = 0`,
        folder.id,
      );
      const missingStats = this.getRow(
        `SELECT COUNT(*) AS missing_count
         FROM tracks
         WHERE folder_id = ? AND missing != 0`,
        folder.id,
      );
      const albumStats = this.getRow(
        `SELECT COUNT(DISTINCT album_tracks.album_id) AS album_count
         FROM tracks
         INNER JOIN album_tracks ON album_tracks.track_id = tracks.id
         WHERE tracks.folder_id = ? AND tracks.missing = 0`,
        folder.id,
      );
      const artistStats = this.getRow(
        `SELECT COUNT(DISTINCT artist_tracks.artist_id) AS artist_count
         FROM tracks
         INNER JOIN artist_tracks ON artist_tracks.track_id = tracks.id
         WHERE tracks.folder_id = ? AND tracks.missing = 0`,
        folder.id,
      );
      const recentScanRow = this.getRow(
        'SELECT * FROM scan_jobs WHERE folder_id = ? ORDER BY created_at DESC LIMIT 1',
        folder.id,
      );

      return {
        ...folder,
        lastScanAt: textOrNull(row.last_scan_at),
        recentScan: recentScanRow ? this.mapScanJob(recentScanRow) : null,
        trackCount: Number(activeStats?.track_count ?? 0),
        albumCount: Number(albumStats?.album_count ?? 0),
        artistCount: Number(artistStats?.artist_count ?? 0),
        totalDuration: Number(activeStats?.total_duration ?? 0),
        totalSizeBytes: Number(activeStats?.total_size_bytes ?? 0),
        missingTrackCount: Number(missingStats?.missing_count ?? 0),
        losslessTrackCount: Number(activeStats?.lossless_count ?? 0),
        hiResTrackCount: Number(activeStats?.hires_count ?? 0),
        childFolderCount: this.getDirectChildFolderCount(folder.id, folder.path),
        coverThumbs: this.getFolderCoverThumbs(folder.id, folder.path, true),
      };
    });
  }

  getFolderChildren(query: LibraryFolderChildrenQuery): LibraryFolderNode[] {
    const folder = this.requireFolder(query.folderId);
    const parentPath = this.resolveFolderScopedPath(folder, query.parentPath);
    const prefix = `${stripTrailingPathSeparators(parentPath)}${preferredPathSeparator}`;
    const rows = this.allRows(
      `SELECT path, duration, size_bytes, cover_id
       FROM tracks
       WHERE folder_id = ? AND missing = 0 AND path LIKE ? ESCAPE '\\'
       ORDER BY path COLLATE NOCASE`,
      folder.id,
      likePrefix(prefix),
    );
    const children = new Map<
      string,
      LibraryFolderNode & {
        childFolderNames: Set<string>;
        coverIds: Set<string>;
      }
    >();

    for (const row of rows) {
      const trackPath = String(row.path);
      const relativePath = trackPath.slice(prefix.length);
      const parts = relativePath.split(pathSeparatorPattern).filter(Boolean);

      if (parts.length <= 1) {
        continue;
      }

      const name = parts[0];
      const childPath = childPathFor(parentPath, name);
      const existing =
        children.get(childPath) ??
        ({
          folderId: folder.id,
          path: childPath,
          parentPath,
          name,
          depth: folderDepth(folder.path, childPath),
          trackCount: 0,
          directTrackCount: 0,
          childFolderCount: 0,
          totalDuration: 0,
          totalSizeBytes: 0,
          coverThumbs: [],
          childFolderNames: new Set<string>(),
          coverIds: new Set<string>(),
        } satisfies LibraryFolderNode & { childFolderNames: Set<string>; coverIds: Set<string> });

      existing.trackCount += 1;
      existing.totalDuration += Number(row.duration ?? 0);
      existing.totalSizeBytes += Number(row.size_bytes ?? 0);

      if (parts.length === 2) {
        existing.directTrackCount += 1;
      } else if (parts[1]) {
        existing.childFolderNames.add(parts[1]);
      }

      const coverId = textOrNull(row.cover_id);
      if (coverId && existing.coverIds.size < 4) {
        existing.coverIds.add(coverId);
      }

      children.set(childPath, existing);
    }

    return Array.from(children.values())
      .map(({ childFolderNames, coverIds, ...child }) => ({
        ...child,
        childFolderCount: childFolderNames.size,
        coverThumbs: Array.from(coverIds)
          .slice(0, 4)
          .map((coverId) => this.toCoverUrl(coverId, 'thumb'))
          .filter((value): value is string => Boolean(value)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  }

  getFolderTracks(query: LibraryFolderTracksQuery): LibraryPage<LibraryTrack> {
    const startedAt = performance.now();
    const folder = this.requireFolder(query.folderId);
    const folderPath = this.resolveFolderScopedPath(folder, query.path);
    const { page, pageSize, search, sort, excludeTrackIds, randomWindow } = pageFromQuery(query);
    const searchOptions = this.readSearchOptions();
    const offset = (page - 1) * pageSize;
    const scope = this.folderTrackScope(folder.id, folderPath, query.recursive !== false);
    const searchFilter = buildSearchFilter(search, [
      likePredicate('tracks.title'),
      likePredicate('tracks.artist'),
      likePredicate('tracks.album'),
      likePredicate('tracks.album_artist'),
      likePredicate('COALESCE(tracks.genre, \'\')'),
      likePredicate('tracks.path'),
    ], searchOptions);
    const excludeTrackIdsSql = excludeTrackIds.length > 0 ? `tracks.id NOT IN (${excludeTrackIds.map(() => '?').join(', ')})` : '';
    const whereParts = [scope.sql, searchFilter.sql, excludeTrackIdsSql].filter(Boolean);
    const whereSql = `WHERE ${whereParts.join(' AND ')}`;
    const params = [...scope.params, ...searchFilter.params, ...excludeTrackIds];
    const selectSql = `SELECT
        tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
        tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
        tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
        tracks.bpm, tracks.bpm_confidence, tracks.beat_offset_ms, tracks.analysis_status, tracks.analysis_updated_at,
        tracks.replay_gain_track_gain_db, tracks.replay_gain_album_gain_db, tracks.replay_gain_track_peak,
        tracks.replay_gain_album_peak, tracks.replay_gain_integrated_lufs, tracks.replay_gain_source,
        tracks.replay_gain_status, tracks.replay_gain_updated_at,
        tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
        tracks.network_metadata_status, tracks.field_sources_json
       FROM tracks
       ${whereSql}`;
    const orderSql = this.trackOrderSql(sort);
    const totalRow = this.getRow(`SELECT COUNT(*) AS total FROM tracks ${whereSql}`, ...params);
    const total = Number(totalRow?.total ?? 0);
    const rows =
      randomWindow && sort === 'random'
        ? (() => {
            if (total <= 0) {
              return [];
            }

            const sampleSize = Math.min(total, Math.max(pageSize, Math.min(randomWindowMaxRows, pageSize * 3)));
            const rowNumbers = randomOneBasedRowNumbers(total, sampleSize);
            if (rowNumbers.length === 0) {
              return [];
            }

            return shuffleRows(
              this.allRows(
                `WITH folder_tracks AS (
                  ${selectSql}
                ),
                sampled_tracks AS (
                  SELECT *, ROW_NUMBER() OVER () AS echo_random_row_number
                  FROM folder_tracks
                )
                SELECT *
                FROM sampled_tracks
                WHERE echo_random_row_number IN (${rowNumbers.map(() => '?').join(', ')})`,
                ...params,
                ...rowNumbers,
              ),
            ).slice(0, pageSize);
          })()
        : this.allRows(
            `${selectSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
            ...params,
            pageSize,
            offset,
          );

    try {
      return {
        items: rows.map((row) => this.mapTrack(row)),
        page,
        pageSize,
        total,
        hasMore: offset + rows.length < total,
      };
    } finally {
      this.lastTracksQueryMs = performance.now() - startedAt;
    }
  }

  resolveLibraryFolderPath(request: LibraryFolderPathRequest): string {
    return this.resolveFolderScopedPath(this.requireFolder(request.folderId), request.path);
  }

  removeFolder(folderId: string): void {
    this.transaction(() => {
      const timestamp = nowIso();
      this.run('UPDATE folders SET status = ?, enabled = ?, updated_at = ? WHERE id = ?', 'removed', 0, timestamp, folderId);
      this.run('DELETE FROM tracks WHERE folder_id = ?', folderId);
      this.run('DELETE FROM scan_jobs WHERE folder_id = ?', folderId);
      this.run('DELETE FROM scan_directory_snapshots WHERE folder_id = ?', folderId);
      this.run('DELETE FROM album_tracks');
      this.run('DELETE FROM albums');
      this.refreshArtists();
    });
  }

  createScanJob(folderId: string): LibraryScanStatus {
    const id = randomUUID();
    const timestamp = nowIso();

    this.run(
      `INSERT INTO scan_jobs (
        id, folder_id, status, phase, errors_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      folderId,
      'queued',
      'queued',
      '[]',
      timestamp,
      timestamp,
    );

    const job = this.getScanJob(id);

    if (!job) {
      throw new Error(`Failed to create scan job ${id}`);
    }

    return job;
  }

  updateScanJob(jobId: string, update: ScanJobUpdate): LibraryScanStatus {
    const current = this.getScanJob(jobId);

    if (!current) {
      throw new Error(`Unknown scan job ${jobId}`);
    }

    const next = {
      ...current,
      ...update,
      errors: update.errors ?? current.errors,
    };
    const safeErrors = sanitizeErrorList(next.errors);
    const errorCount = update.errorCount ?? next.errors.length;

    this.run(
      `UPDATE scan_jobs SET
        status = ?,
        phase = ?,
        discovered_count = ?,
        parsed_count = ?,
        skipped_count = ?,
        cover_count = ?,
        total_files = ?,
        processed_files = ?,
        skipped_files = ?,
        added_tracks = ?,
        updated_tracks = ?,
        removed_tracks = ?,
        error_count = ?,
        errors_json = ?,
        cancel_requested = COALESCE(?, cancel_requested),
        started_at = ?,
        finished_at = ?,
        updated_at = ?
      WHERE id = ?`,
      next.status,
      next.phase,
      next.totalFiles,
      next.processedFiles,
      next.skippedFiles,
      update.coverCount ?? current.coverCount ?? 0,
      next.totalFiles,
      next.processedFiles,
      next.skippedFiles,
      next.addedTracks,
      next.updatedTracks,
      next.removedTracks,
      errorCount,
      JSON.stringify(safeErrors),
      typeof update.cancelRequested === 'boolean' ? (update.cancelRequested ? 1 : 0) : null,
      next.startedAt,
      next.finishedAt,
      nowIso(),
      jobId,
    );

    const updated = this.getScanJob(jobId);

    if (!updated) {
      throw new Error(`Failed to update scan job ${jobId}`);
    }

    return updated;
  }

  getScanJob(jobId: string): LibraryScanStatus | null {
    const row = this.getRow('SELECT * FROM scan_jobs WHERE id = ?', jobId);
    return row ? this.mapScanJob(row) : null;
  }

  getPlaceholderMetadataTrackCount(): number {
    return Number(
      this.getRow(
        `SELECT COUNT(*) AS total
         FROM tracks
         WHERE missing = 0
           AND (
             metadata_status = 'fallback'
             OR embedded_metadata_status IN ('pending', 'reading')
           )`,
      )?.total ?? 0,
    );
  }

  getPlaceholderMetadataTrackTargets(limit = 500): PlaceholderMetadataTrackTarget[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return this.allRows(
      `SELECT folder_id, path
       FROM tracks
       WHERE missing = 0
         AND (
           metadata_status = 'fallback'
           OR embedded_metadata_status IN ('pending', 'reading')
         )
       ORDER BY updated_at ASC, created_at ASC
       LIMIT ?`,
      safeLimit,
    ).map((row) => ({
      folderId: String(row.folder_id),
      path: String(row.path),
    }));
  }

  countPlaceholderMetadataTracksByPaths(paths: string[]): number {
    if (paths.length === 0) {
      return 0;
    }

    let count = 0;
    for (const filePath of paths) {
      count += Number(
        this.getRow(
          `SELECT COUNT(*) AS total
           FROM tracks
           WHERE missing = 0
             AND path = ?
             AND (
               metadata_status = 'fallback'
               OR embedded_metadata_status IN ('pending', 'reading')
             )`,
          resolve(filePath),
        )?.total ?? 0,
      );
    }

    return count;
  }

  getLibraryQualityOverview(): LibraryQualityOverviewItem[] {
    return libraryQualityOverviewDefinitions.map((definition) => {
      const { conditionSql } = this.libraryQualityIssueFilter(definition.kind);
      const row = this.getRow(
        `SELECT COUNT(*) AS total
         FROM tracks
         WHERE tracks.missing = 0
           AND (${conditionSql})`,
      );

      return {
        ...definition,
        count: Number(row?.total ?? 0),
        lastError: null,
      };
    });
  }

  getLibraryQualityIssues(query: LibraryQualityIssueQuery): LibraryQualityIssuePage {
    const { page, pageSize, search } = pageFromQualityQuery(query);
    const offset = (page - 1) * pageSize;
    const { conditionSql } = this.libraryQualityIssueFilter(query.kind);
    const searchQuery = buildFtsSearchQuery(search, this.readSearchOptions());
    const searchJoinSql = searchQuery ? 'INNER JOIN tracks_fts ON tracks_fts.rowid = tracks.rowid' : '';
    const searchWhereSql = searchQuery ? ' AND tracks_fts MATCH ?' : '';
    const params = searchQuery ? [searchQuery] : [];
    const whereSql = `WHERE tracks.missing = 0 AND (${conditionSql})${searchWhereSql}`;
    const totalRow = this.getRow(
      `SELECT COUNT(*) AS total
       FROM tracks
       ${searchJoinSql}
       ${whereSql}`,
      ...params,
    );
    const rows = this.allRows(
      `SELECT
        tracks.id,
        'local' AS media_type,
        tracks.path,
        tracks.size_bytes,
        NULL AS source_id,
        NULL AS provider,
        NULL AS remote_path,
        NULL AS stable_key,
        tracks.title,
        tracks.artist,
        tracks.album,
        tracks.album_artist,
        tracks.track_no,
        tracks.disc_no,
        tracks.year,
        tracks.genre,
        tracks.duration,
        tracks.codec,
        tracks.sample_rate,
        tracks.bit_depth,
        tracks.bitrate,
        tracks.bpm,
        tracks.bpm_confidence,
        tracks.beat_offset_ms,
        tracks.analysis_status,
        tracks.analysis_updated_at,
        tracks.replay_gain_track_gain_db,
        tracks.replay_gain_album_gain_db,
        tracks.replay_gain_track_peak,
        tracks.replay_gain_album_peak,
        tracks.replay_gain_integrated_lufs,
        tracks.replay_gain_source,
        tracks.replay_gain_status,
        tracks.replay_gain_updated_at,
        tracks.cover_id,
        (SELECT source_type FROM covers WHERE covers.id = tracks.cover_id) AS cover_source_type,
        tracks.metadata_status,
        tracks.embedded_metadata_status,
        tracks.embedded_cover_status,
        tracks.network_metadata_status,
        tracks.field_sources_json,
        'available' AS availability,
        (
          SELECT COUNT(*) FROM network_metadata_candidates WHERE network_metadata_candidates.track_id = tracks.id
        ) AS metadata_candidate_count,
        (
          SELECT COUNT(*) FROM network_cover_candidates WHERE network_cover_candidates.track_id = tracks.id
        ) AS cover_candidate_count
       FROM tracks
       ${searchJoinSql}
       ${whereSql}
       ORDER BY tracks.updated_at DESC, tracks.title COLLATE NOCASE
       LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);
    const items: LibraryQualityIssueItem[] = rows.map((row) => ({
      track: this.mapTrack(row),
      reasons: this.libraryQualityIssueReasons(query.kind, row),
      candidateCount: Number(row.metadata_candidate_count ?? 0) + Number(row.cover_candidate_count ?? 0),
    }));

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: offset + items.length < total,
      kind: query.kind,
    };
  }

  recordLibraryInboxBatch(input: {
    scanJobId: string;
    folder: LibraryFolder;
    trackIds: string[];
    createdAt?: string;
    finishedAt?: string;
  }): LibraryInboxBatch | null {
    const trackIds = Array.from(new Set(input.trackIds.filter((trackId) => typeof trackId === 'string' && trackId.length > 0)));

    if (trackIds.length === 0) {
      return null;
    }

    const timestamp = input.createdAt ?? nowIso();
    const finishedAt = input.finishedAt ?? timestamp;
    const batchId = randomUUID();

    this.run('DELETE FROM library_inbox_batches WHERE scan_job_id = ?', input.scanJobId);
    this.run(
      `INSERT INTO library_inbox_batches (
        id,
        scan_job_id,
        folder_id,
        folder_name,
        folder_path,
        added_count,
        missing_cover_count,
        metadata_issue_count,
        created_at,
        finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      batchId,
      input.scanJobId,
      input.folder.id,
      input.folder.name,
      input.folder.path,
      trackIds.length,
      0,
      0,
      timestamp,
      finishedAt,
    );

    const insertItem = this.database.prepare<[string, string, number, string]>(
      `INSERT INTO library_inbox_items (batch_id, track_id, position, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    trackIds.forEach((trackId, index) => insertItem.run(batchId, trackId, index, timestamp));
    const counts = this.countInboxIssueTracksForBatch(batchId);
    this.run(
      `UPDATE library_inbox_batches
       SET missing_cover_count = ?, metadata_issue_count = ?
       WHERE id = ?`,
      counts.missingCoverCount,
      counts.metadataIssueCount,
      batchId,
    );
    this.pruneLibraryInboxBatches(libraryInboxBatchLimit);

    return this.getLibraryInboxBatch(batchId);
  }

  getLibraryInboxBatches(limit = libraryInboxBatchLimit): LibraryInboxBatch[] {
    const safeLimit = Math.max(1, Math.min(libraryInboxBatchLimit, Math.floor(Number(limit) || libraryInboxBatchLimit)));

    return this.allRows(
      `SELECT *
       FROM library_inbox_batches
       ORDER BY finished_at DESC, created_at DESC
       LIMIT ?`,
      safeLimit,
    ).map((row) => this.mapLibraryInboxBatch(row));
  }

  getLibraryInboxTracks(query?: LibraryInboxTrackQuery): LibraryInboxTrackPage {
    const batches = this.getLibraryInboxBatches();
    const normalized = this.resolveLibraryInboxQuery(query, batches);
    const offset = (normalized.page - 1) * normalized.pageSize;

    if (!normalized.hasTarget) {
      return {
        items: [],
        page: normalized.page,
        pageSize: normalized.pageSize,
        total: 0,
        hasMore: false,
        batches,
        selectedBatch: normalized.selectedBatch,
        scope: normalized.scope,
        filter: normalized.filter,
        status: normalized.status,
        story: this.emptyLibraryInboxStory(),
        albums: [],
        facets: { folders: [], albums: [], artists: [] },
      };
    }

    const trackSelection = this.buildLibraryInboxTrackSelection(normalized);
    const totalRow = this.getRow(
      `SELECT COUNT(*) AS total
       ${trackSelection.fromSql}
       ${trackSelection.whereSql}`,
      ...trackSelection.params,
    );
    const rows = this.allRows(
      `SELECT
        library_inbox_items.batch_id,
        library_inbox_items.created_at AS inbox_added_at,
        COALESCE(library_inbox_item_states.status, 'pending') AS inbox_status,
        tracks.id,
        'local' AS media_type,
        tracks.path,
        NULL AS source_id,
        NULL AS provider,
        NULL AS remote_path,
        NULL AS stable_key,
        tracks.title,
        tracks.artist,
        tracks.album,
        tracks.album_artist,
        tracks.track_no,
        tracks.disc_no,
        tracks.year,
        tracks.genre,
        tracks.duration,
        tracks.codec,
        tracks.sample_rate,
        tracks.bit_depth,
        tracks.bitrate,
        tracks.bpm,
        tracks.bpm_confidence,
        tracks.beat_offset_ms,
        tracks.analysis_status,
        tracks.analysis_updated_at,
        tracks.replay_gain_track_gain_db,
        tracks.replay_gain_album_gain_db,
        tracks.replay_gain_track_peak,
        tracks.replay_gain_album_peak,
        tracks.replay_gain_integrated_lufs,
        tracks.replay_gain_source,
        tracks.replay_gain_status,
        tracks.replay_gain_updated_at,
        tracks.cover_id,
        (SELECT source_type FROM covers WHERE covers.id = tracks.cover_id) AS cover_source_type,
        tracks.metadata_status,
        tracks.embedded_metadata_status,
        tracks.embedded_cover_status,
        tracks.network_metadata_status,
        tracks.field_sources_json,
        'available' AS availability
       ${trackSelection.fromSql}
       ${trackSelection.whereSql}
       ORDER BY library_inbox_batches.finished_at DESC, library_inbox_items.position ASC
       LIMIT ? OFFSET ?`,
      ...trackSelection.params,
      normalized.pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);

    return {
      items: rows.map((row) => ({
        batchId: String(row.batch_id),
        addedAt: String(row.inbox_added_at ?? ''),
        track: this.mapTrack(row),
        reasons: this.libraryInboxIssueReasons(row),
        inboxStatus: this.mapLibraryInboxItemStatus(row.inbox_status),
      })),
      page: normalized.page,
      pageSize: normalized.pageSize,
      total,
      hasMore: offset + rows.length < total,
      batches,
      selectedBatch: normalized.selectedBatch,
      scope: normalized.scope,
      filter: normalized.filter,
      status: normalized.status,
      story: this.getLibraryInboxStory(normalized),
      albums: this.getLibraryInboxAlbumSummaries(normalized),
      facets: this.getLibraryInboxFacets(normalized),
    };
  }

  createPlaylistFromLibraryInbox(request: LibraryInboxCreatePlaylistRequest = {}): LibraryInboxPlaylistResult {
    const batches = this.getLibraryInboxBatches();
    const normalized = this.resolveLibraryInboxQuery(request, batches);

    if (!normalized.hasTarget) {
      throw new Error('No new-songs inbox batch is available.');
    }

    const matchedCount = this.countLibraryInboxTracks(normalized);
    const trackIds = this.getLibraryInboxTrackIds(normalized, libraryInboxPlaylistTrackLimit);
    const limitedTrackIds = trackIds;

    if (limitedTrackIds.length === 0) {
      throw new Error('No inbox tracks match the current filter.');
    }

    const timestamp = nowIso();
    const name = typeof request.name === 'string' && request.name.trim()
      ? request.name.trim()
      : this.defaultLibraryInboxPlaylistName(normalized);
    const playlist = this.createPlaylist(
      {
        name,
        description: `Created from ECHO new-songs inbox on ${timestamp}.`,
      },
      timestamp,
    );
    const items = this.addTracksToPlaylist(playlist.id, limitedTrackIds, timestamp);

    return {
      playlist: this.getPlaylist(playlist.id) ?? playlist,
      addedCount: items.length,
      matchedCount,
      skippedCount: Math.max(0, matchedCount - items.length),
      truncated: matchedCount > items.length,
      limit: libraryInboxPlaylistTrackLimit,
    };
  }

  getLibraryInboxQueueTracks(query: LibraryInboxTrackQuery = {}): LibraryInboxQueueResult {
    const batches = this.getLibraryInboxBatches();
    const normalized = this.resolveLibraryInboxQuery(query, batches);

    if (!normalized.hasTarget) {
      throw new Error('No new-songs inbox batch is available.');
    }

    const matchedCount = this.countLibraryInboxTracks(normalized);
    const selection = this.buildLibraryInboxTrackSelection(normalized);
    const rows = this.allRows(
      `SELECT
        tracks.id,
        'local' AS media_type,
        tracks.path,
        NULL AS source_id,
        NULL AS provider,
        NULL AS remote_path,
        NULL AS stable_key,
        tracks.title,
        tracks.artist,
        tracks.album,
        tracks.album_artist,
        tracks.track_no,
        tracks.disc_no,
        tracks.year,
        tracks.genre,
        tracks.duration,
        tracks.codec,
        tracks.sample_rate,
        tracks.bit_depth,
        tracks.bitrate,
        tracks.bpm,
        tracks.bpm_confidence,
        tracks.beat_offset_ms,
        tracks.analysis_status,
        tracks.analysis_updated_at,
        tracks.replay_gain_track_gain_db,
        tracks.replay_gain_album_gain_db,
        tracks.replay_gain_track_peak,
        tracks.replay_gain_album_peak,
        tracks.replay_gain_integrated_lufs,
        tracks.replay_gain_source,
        tracks.replay_gain_status,
        tracks.replay_gain_updated_at,
        tracks.cover_id,
        (SELECT source_type FROM covers WHERE covers.id = tracks.cover_id) AS cover_source_type,
        tracks.metadata_status,
        tracks.embedded_metadata_status,
        tracks.embedded_cover_status,
        tracks.network_metadata_status,
        tracks.field_sources_json,
        'available' AS availability
       ${selection.fromSql}
       ${selection.whereSql}
       ORDER BY library_inbox_batches.finished_at DESC, library_inbox_items.position ASC
       LIMIT ?`,
      ...selection.params,
      libraryInboxPlaylistTrackLimit,
    );
    const tracks = rows.map((row) => this.mapTrack(row));

    return {
      tracks,
      matchedCount,
      addedCount: tracks.length,
      skippedCount: Math.max(0, matchedCount - tracks.length),
      truncated: matchedCount > tracks.length,
      limit: libraryInboxPlaylistTrackLimit,
    };
  }

  updateLibraryInboxItemState(request: LibraryInboxUpdateStateRequest): LibraryInboxUpdateStateResult {
    const status = this.mapLibraryInboxItemStatus(request.status);
    const resolved = this.resolveLibraryInboxItemRefs(request);
    const limitedRefs = resolved.refs.slice(0, libraryInboxPlaylistTrackLimit);
    const timestamp = nowIso();

    this.transaction(() => {
      if (status === 'pending') {
        const deleteState = this.database.prepare<[string, string]>(
          'DELETE FROM library_inbox_item_states WHERE batch_id = ? AND track_id = ?',
        );
        limitedRefs.forEach((ref) => deleteState.run(ref.batchId, ref.trackId));
        return;
      }

      const upsertState = this.database.prepare<[string, string, string, string]>(
        `INSERT INTO library_inbox_item_states (batch_id, track_id, status, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(batch_id, track_id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at`,
      );
      limitedRefs.forEach((ref) => upsertState.run(ref.batchId, ref.trackId, status, timestamp));
    });

    return {
      updatedCount: limitedRefs.length,
      matchedCount: resolved.matchedCount,
      skippedCount: Math.max(0, resolved.matchedCount - limitedRefs.length),
      truncated: resolved.matchedCount > limitedRefs.length,
      limit: libraryInboxPlaylistTrackLimit,
    };
  }

  isScanCancelled(jobId: string): boolean {
    const row = this.getRow('SELECT cancel_requested FROM scan_jobs WHERE id = ?', jobId);
    return Number(row?.cancel_requested ?? 0) === 1;
  }

  finishFolderScan(folderId: string, timestamp = nowIso()): void {
    this.run('UPDATE folders SET last_scan_at = ?, updated_at = ? WHERE id = ?', timestamp, timestamp, folderId);
  }

  getScanDirectorySnapshotsByFolder(folderId: string): Map<string, ScanDirectorySnapshot> {
    const rows = this.allRows(
      'SELECT path, mtime_ms, entries_json FROM scan_directory_snapshots WHERE folder_id = ?',
      folderId,
    );
    const snapshots = new Map<string, ScanDirectorySnapshot>();

    for (const row of rows) {
      const entries = parseScanDirectorySnapshotEntries(row.entries_json);
      if (!entries) {
        continue;
      }

      const path = resolve(String(row.path));
      snapshots.set(pathCompareValue(path), {
        path,
        mtimeMs: Number(row.mtime_ms),
        entries,
      });
    }

    return snapshots;
  }

  upsertScanDirectorySnapshots(folderId: string, snapshots: readonly ScanDirectorySnapshot[], timestamp = nowIso()): void {
    if (snapshots.length === 0) {
      return;
    }

    const statement = this.database.prepare(
      `INSERT INTO scan_directory_snapshots (folder_id, path, mtime_ms, entries_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(folder_id, path) DO UPDATE SET
         mtime_ms = excluded.mtime_ms,
         entries_json = excluded.entries_json,
         updated_at = excluded.updated_at`,
    );

    this.transaction(() => {
      for (const snapshot of snapshots) {
        const entries = sanitizeScanDirectorySnapshotEntries(snapshot.entries);
        if (!entries || !Number.isFinite(snapshot.mtimeMs)) {
          continue;
        }

        statement.run(folderId, resolve(snapshot.path), Math.round(snapshot.mtimeMs), JSON.stringify(entries), timestamp);
      }
    });
  }

  findTrackFingerprint(filePath: string): StoredTrackFingerprint | null {
    const row = this.getRow('SELECT id, size_bytes, mtime_ms FROM tracks WHERE path = ? AND missing = 0', resolve(filePath));

    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      sizeBytes: Number(row.size_bytes),
      mtimeMs: Number(row.mtime_ms),
    };
  }

  getTrackFingerprintsByFolder(folderId: string): Map<string, StoredTrackFingerprint> {
    const rows = this.allRows(
      'SELECT id, path, size_bytes, mtime_ms FROM tracks WHERE folder_id = ? AND missing = 0',
      folderId,
    );
    const fingerprints = new Map<string, StoredTrackFingerprint>();

    for (const row of rows) {
      fingerprints.set(String(row.path), {
        id: String(row.id),
        sizeBytes: Number(row.size_bytes),
        mtimeMs: Number(row.mtime_ms),
      });
    }

    return fingerprints;
  }

  getTrackCacheStatesByFolder(folderId: string): Map<string, StoredTrackCoverState> {
    const rows = this.allRows(
      `SELECT
        tracks.path, tracks.id, tracks.size_bytes, tracks.mtime_ms,
        tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
        tracks.file_identity, tracks.file_identity_source, tracks.quick_hash, tracks.quick_hash_version,
        tracks.identity_status, tracks.identity_updated_at, tracks.identity_error,
        covers.source_type, covers.source_hash, covers.mime_type,
        covers.thumb_path, covers.album_path, covers.large_path, covers.original_ref,
        covers.cache_version
      FROM tracks
      LEFT JOIN covers ON covers.id = tracks.cover_id
      WHERE tracks.folder_id = ? AND tracks.missing = 0`,
      folderId,
    );
    const states = new Map<string, StoredTrackCoverState>();

    for (const row of rows) {
      states.set(resolve(String(row.path)), {
        id: String(row.id),
        sizeBytes: Number(row.size_bytes),
        mtimeMs: Number(row.mtime_ms),
        coverId: textOrNull(row.cover_id),
        metadataStatus: textOrNull(row.metadata_status),
        embeddedMetadataStatus: textOrNull(row.embedded_metadata_status),
        embeddedCoverStatus: textOrNull(row.embedded_cover_status),
        coverSource: coverSourceOrNull(row.source_type),
        sourceHash: textOrNull(row.source_hash),
        mimeType: textOrNull(row.mime_type),
        thumbPath: textOrNull(row.thumb_path),
        albumPath: textOrNull(row.album_path),
        largePath: textOrNull(row.large_path),
        originalRef: textOrNull(row.original_ref),
        cacheVersion: numberOrNull(row.cache_version),
        fileIdentity: textOrNull(row.file_identity),
        fileIdentitySource: textOrNull(row.file_identity_source),
        quickHash: textOrNull(row.quick_hash),
        quickHashVersion: numberOrNull(row.quick_hash_version),
        identityStatus: textOrNull(row.identity_status),
        identityUpdatedAt: textOrNull(row.identity_updated_at),
        identityError: textOrNull(row.identity_error),
      });
    }

    return states;
  }

  findTrackCoverState(filePath: string): StoredTrackCoverState | null {
    const row = this.getRow(
      `SELECT
        tracks.id, tracks.size_bytes, tracks.mtime_ms,
        tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
        tracks.file_identity, tracks.file_identity_source, tracks.quick_hash, tracks.quick_hash_version,
        tracks.identity_status, tracks.identity_updated_at, tracks.identity_error,
        covers.source_type, covers.source_hash, covers.mime_type,
        covers.thumb_path, covers.album_path, covers.large_path, covers.original_ref,
        covers.cache_version
      FROM tracks
      LEFT JOIN covers ON covers.id = tracks.cover_id
      WHERE tracks.path = ? AND tracks.missing = 0`,
      resolve(filePath),
    );

    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      sizeBytes: Number(row.size_bytes),
      mtimeMs: Number(row.mtime_ms),
      coverId: textOrNull(row.cover_id),
      metadataStatus: textOrNull(row.metadata_status),
      embeddedMetadataStatus: textOrNull(row.embedded_metadata_status),
      embeddedCoverStatus: textOrNull(row.embedded_cover_status),
      coverSource: coverSourceOrNull(row.source_type),
      sourceHash: textOrNull(row.source_hash),
      mimeType: textOrNull(row.mime_type),
      thumbPath: textOrNull(row.thumb_path),
      albumPath: textOrNull(row.album_path),
      largePath: textOrNull(row.large_path),
      originalRef: textOrNull(row.original_ref),
      cacheVersion: numberOrNull(row.cache_version),
      fileIdentity: textOrNull(row.file_identity),
      fileIdentitySource: textOrNull(row.file_identity_source),
      quickHash: textOrNull(row.quick_hash),
      quickHashVersion: numberOrNull(row.quick_hash_version),
      identityStatus: textOrNull(row.identity_status),
      identityUpdatedAt: textOrNull(row.identity_updated_at),
      identityError: textOrNull(row.identity_error),
    };
  }

  markTracksMissingFromFolder(
    folderId: string,
    discoveredPaths: string[],
    timestamp = nowIso(),
    options: MarkTracksMissingFromFolderOptions = {},
  ): number {
    const normalizedPaths = new Set(discoveredPaths.map((filePath) => pathCompareValue(filePath)));
    const excludedDirectories = (options.excludeDirectories ?? []).map((directoryPath) => resolve(directoryPath));
    const existingRows = this.allRows('SELECT id, path FROM tracks WHERE folder_id = ? AND missing = 0', folderId);
    const missingIds = existingRows
      .filter((row) => {
        const trackPath = String(row.path);
        if (normalizedPaths.has(pathCompareValue(trackPath))) {
          return false;
        }

        return !excludedDirectories.some((directoryPath) => isPathInsideOrEqual(directoryPath, trackPath));
      })
      .map((row) => String(row.id));

    let changed = 0;

    for (const id of missingIds) {
      const result = this.run('UPDATE tracks SET missing = 1, updated_at = ? WHERE id = ?', timestamp, id);
      changed += Number(result.changes ?? 0);
    }

    return changed;
  }

  markTracksMissingByPaths(folderId: string, paths: string[], timestamp = nowIso()): number {
    const normalizedPaths = Array.from(new Set(paths.map((filePath) => resolve(filePath)).filter(Boolean)));
    if (normalizedPaths.length === 0) {
      return 0;
    }

    let changed = 0;
    for (let index = 0; index < normalizedPaths.length; index += 100) {
      const batch = normalizedPaths.slice(index, index + 100);
      const placeholders = batch.map(() => '?').join(', ');
      const result = this.run(
        `UPDATE tracks
         SET missing = 1, updated_at = ?
         WHERE folder_id = ? AND missing = 0 AND path IN (${placeholders})`,
        timestamp,
        folderId,
        ...batch,
      );
      changed += Number(result.changes ?? 0);
    }

    return changed;
  }

  removeTracksMissingFromFolder(folderId: string, discoveredPaths: string[]): number {
    return this.markTracksMissingFromFolder(folderId, discoveredPaths);
  }

  upsertCover(result: CoverResult, now = nowIso()): string | null {
    const existing = this.getRow('SELECT id, source_type FROM covers WHERE source_hash = ?', result.sourceHash);
    const warningsJson = JSON.stringify(result.warnings);
    const errorsJson = JSON.stringify(result.errors);
    const source = preferredCoverSource(existing?.source_type, result.source);

    if (textOrNull(existing?.id)) {
      this.run(
        `UPDATE covers SET
          source_type = ?,
          mime_type = ?,
          thumb_path = ?,
          album_path = ?,
          large_path = ?,
          original_ref = ?,
          cache_version = ?,
          warnings_json = ?,
          errors_json = ?,
          cover_thumb = ?,
          cover_large = ?,
          cover_original = ?,
          updated_at = ?
        WHERE id = ?`,
        source,
        result.mimeType,
        result.thumbPath,
        result.albumPath,
        result.largePath,
        result.originalRef,
        currentCoverCacheVersion,
        warningsJson,
        errorsJson,
        result.thumbPath,
        result.largePath,
        result.originalRef,
        now,
        existing?.id,
      );
      return String(existing?.id);
    }

    const id = randomUUID();
    this.run(
      `INSERT INTO covers (
        id, source_type, source_hash, mime_type,
        thumb_path, album_path, large_path, original_ref,
        cache_version, warnings_json, errors_json,
        cover_thumb, cover_large, cover_original,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      source,
      result.sourceHash,
      result.mimeType,
      result.thumbPath,
      result.albumPath,
      result.largePath,
      result.originalRef,
      currentCoverCacheVersion,
      warningsJson,
      errorsJson,
      result.thumbPath,
      result.largePath,
      result.originalRef,
      now,
      now,
    );

    return id;
  }

  upsertTrack(track: TrackWrite, preparedSearchTerms?: string): 'added' | 'updated' {
    const existing = this.getRow('SELECT id, created_at FROM tracks WHERE path = ?', resolve(track.path));
    const createdAt = textOrNull(existing?.created_at) ?? track.createdAt ?? track.updatedAt;
    const id = textOrNull(existing?.id) ?? track.id;
    const normalizedPath = resolve(track.path);
    const safeTrack = sanitizeTrackWrite(track);
    const searchTerms = preparedSearchTerms ?? buildTrackSearchTerms({
      title: safeTrack.title,
      artist: safeTrack.artist,
      album: safeTrack.album,
      albumArtist: safeTrack.albumArtist,
      genre: safeTrack.genre,
      path: normalizedPath,
    });
    const hasReplayGainTag =
      safeTrack.replayGainTrackGainDb !== null && safeTrack.replayGainTrackGainDb !== undefined ||
      safeTrack.replayGainAlbumGainDb !== null && safeTrack.replayGainAlbumGainDb !== undefined;
    const replayGainSource = hasReplayGainTag ? 'tag' : 'none';
    const replayGainStatus = hasReplayGainTag ? 'tagged' : 'none';
    const replayGainUpdatedAt = hasReplayGainTag ? safeTrack.updatedAt : null;

    this.run(
      `INSERT INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
        track_no, disc_no, year, genre, duration, codec, sample_rate, bit_depth, bitrate,
        bpm, bpm_confidence, beat_offset_ms, analysis_status, analysis_version, analysis_error, analysis_updated_at,
        replay_gain_track_gain_db, replay_gain_album_gain_db, replay_gain_track_peak, replay_gain_album_peak,
        replay_gain_integrated_lufs, replay_gain_source, replay_gain_status, replay_gain_version, replay_gain_error, replay_gain_updated_at,
        file_identity, file_identity_source, quick_hash, quick_hash_version, identity_status, identity_updated_at, identity_error,
        search_terms, cover_id, metadata_status, embedded_metadata_status, embedded_cover_status, network_metadata_status,
        field_sources_json, missing, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        folder_id = excluded.folder_id,
        size_bytes = excluded.size_bytes,
        mtime_ms = excluded.mtime_ms,
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        album_artist = excluded.album_artist,
        track_no = excluded.track_no,
        disc_no = excluded.disc_no,
        year = excluded.year,
        genre = excluded.genre,
        duration = excluded.duration,
        codec = excluded.codec,
        sample_rate = excluded.sample_rate,
        bit_depth = excluded.bit_depth,
        bitrate = excluded.bitrate,
        bpm = COALESCE(excluded.bpm, tracks.bpm),
        bpm_confidence = COALESCE(excluded.bpm_confidence, tracks.bpm_confidence),
        beat_offset_ms = COALESCE(excluded.beat_offset_ms, tracks.beat_offset_ms),
        analysis_status = CASE WHEN excluded.bpm IS NOT NULL THEN excluded.analysis_status ELSE tracks.analysis_status END,
        analysis_version = CASE WHEN excluded.bpm IS NOT NULL THEN excluded.analysis_version ELSE tracks.analysis_version END,
        analysis_error = CASE WHEN excluded.bpm IS NOT NULL THEN excluded.analysis_error ELSE tracks.analysis_error END,
        analysis_updated_at = CASE WHEN excluded.bpm IS NOT NULL THEN excluded.analysis_updated_at ELSE tracks.analysis_updated_at END,
        replay_gain_track_gain_db = CASE WHEN excluded.replay_gain_source = 'tag' THEN excluded.replay_gain_track_gain_db ELSE tracks.replay_gain_track_gain_db END,
        replay_gain_album_gain_db = CASE WHEN excluded.replay_gain_source = 'tag' THEN excluded.replay_gain_album_gain_db ELSE tracks.replay_gain_album_gain_db END,
        replay_gain_track_peak = CASE WHEN excluded.replay_gain_source = 'tag' THEN excluded.replay_gain_track_peak ELSE tracks.replay_gain_track_peak END,
        replay_gain_album_peak = CASE WHEN excluded.replay_gain_source = 'tag' THEN excluded.replay_gain_album_peak ELSE tracks.replay_gain_album_peak END,
        replay_gain_integrated_lufs = CASE WHEN excluded.replay_gain_source = 'tag' THEN excluded.replay_gain_integrated_lufs ELSE tracks.replay_gain_integrated_lufs END,
        replay_gain_source = CASE WHEN excluded.replay_gain_source = 'tag' THEN excluded.replay_gain_source ELSE tracks.replay_gain_source END,
        replay_gain_status = CASE WHEN excluded.replay_gain_source = 'tag' THEN excluded.replay_gain_status ELSE tracks.replay_gain_status END,
        replay_gain_version = CASE WHEN excluded.replay_gain_source = 'tag' THEN excluded.replay_gain_version ELSE tracks.replay_gain_version END,
        replay_gain_error = CASE WHEN excluded.replay_gain_source = 'tag' THEN excluded.replay_gain_error ELSE tracks.replay_gain_error END,
        replay_gain_updated_at = CASE WHEN excluded.replay_gain_source = 'tag' THEN excluded.replay_gain_updated_at ELSE tracks.replay_gain_updated_at END,
        file_identity = CASE WHEN excluded.identity_status IS NOT NULL THEN excluded.file_identity ELSE tracks.file_identity END,
        file_identity_source = CASE WHEN excluded.identity_status IS NOT NULL THEN excluded.file_identity_source ELSE tracks.file_identity_source END,
        quick_hash = CASE WHEN excluded.identity_status IS NOT NULL THEN excluded.quick_hash ELSE tracks.quick_hash END,
        quick_hash_version = CASE WHEN excluded.identity_status IS NOT NULL THEN excluded.quick_hash_version ELSE tracks.quick_hash_version END,
        identity_status = CASE WHEN excluded.identity_status IS NOT NULL THEN excluded.identity_status ELSE tracks.identity_status END,
        identity_updated_at = CASE WHEN excluded.identity_status IS NOT NULL THEN excluded.identity_updated_at ELSE tracks.identity_updated_at END,
        identity_error = CASE WHEN excluded.identity_status IS NOT NULL THEN excluded.identity_error ELSE tracks.identity_error END,
        search_terms = excluded.search_terms,
        cover_id = excluded.cover_id,
        metadata_status = excluded.metadata_status,
        embedded_metadata_status = excluded.embedded_metadata_status,
        embedded_cover_status = excluded.embedded_cover_status,
        network_metadata_status = excluded.network_metadata_status,
        field_sources_json = excluded.field_sources_json,
        missing = 0,
        updated_at = excluded.updated_at`,
      id,
      normalizedPath,
      safeTrack.folderId,
      safeTrack.sizeBytes,
      safeTrack.mtimeMs,
      safeTrack.title,
      safeTrack.artist,
      safeTrack.album,
      safeTrack.albumArtist,
      safeTrack.trackNo,
      safeTrack.discNo,
      safeTrack.year,
      safeTrack.genre,
      safeTrack.duration,
      safeTrack.codec,
      safeTrack.sampleRate,
      safeTrack.bitDepth,
      safeTrack.bitrate,
      safeTrack.bpm,
      safeTrack.bpm ? 1 : null,
      null,
      safeTrack.bpm ? 'complete' : 'none',
      safeTrack.bpm ? 1 : 0,
      null,
      safeTrack.bpm ? safeTrack.updatedAt : null,
      safeTrack.replayGainTrackGainDb ?? null,
      safeTrack.replayGainAlbumGainDb ?? null,
      safeTrack.replayGainTrackPeak ?? null,
      safeTrack.replayGainAlbumPeak ?? null,
      safeTrack.replayGainIntegratedLufs ?? null,
      replayGainSource,
      replayGainStatus,
      hasReplayGainTag ? REPLAY_GAIN_ANALYSIS_VERSION : 0,
      null,
      replayGainUpdatedAt,
      safeTrack.fileIdentity ?? null,
      safeTrack.fileIdentitySource ?? null,
      safeTrack.quickHash ?? null,
      safeTrack.quickHashVersion ?? null,
      safeTrack.identityStatus ?? null,
      safeTrack.identityUpdatedAt ?? null,
      safeTrack.identityError ?? null,
      searchTerms,
      safeTrack.coverId,
      safeTrack.metadataStatus ?? 'ok',
      safeTrack.embeddedMetadataStatus ?? 'pending',
      safeTrack.embeddedCoverStatus ?? 'pending',
      'none',
      JSON.stringify(safeTrack.fieldSources),
      0,
      createdAt,
      safeTrack.updatedAt,
    );

    this.relinkLocalPlaylistItemsToTrack({
      id,
      path: normalizedPath,
      title: safeTrack.title,
      artist: safeTrack.artist,
      album: safeTrack.album,
      duration: safeTrack.duration,
      coverId: safeTrack.coverId,
      timestamp: safeTrack.updatedAt,
    });

    return existing ? 'updated' : 'added';
  }

  updateTrackIdentity(
    trackId: string,
    identity: Pick<
      TrackWrite,
      | 'fileIdentity'
      | 'fileIdentitySource'
      | 'quickHash'
      | 'quickHashVersion'
      | 'identityStatus'
      | 'identityUpdatedAt'
      | 'identityError'
    >,
    timestamp = nowIso(),
  ): void {
    this.run(
      `UPDATE tracks SET
        file_identity = ?,
        file_identity_source = ?,
        quick_hash = ?,
        quick_hash_version = ?,
        identity_status = ?,
        identity_updated_at = ?,
        identity_error = ?,
        updated_at = ?
       WHERE id = ?`,
      identity.fileIdentity ?? null,
      identity.fileIdentitySource ?? null,
      identity.quickHash ?? null,
      identity.quickHashVersion ?? null,
      identity.identityStatus ?? null,
      identity.identityUpdatedAt ?? timestamp,
      identity.identityError ?? null,
      timestamp,
      trackId,
    );
  }

  private relinkLocalPlaylistItemsToTrack(track: {
    id: string;
    path: string;
    title: string;
    artist: string;
    album: string;
    duration: number;
    coverId: string | null;
    timestamp: string;
  }): number {
    const result = this.run(
      `UPDATE playlist_items SET
        media_id = ?,
        source_item_id = ?,
        cover_id = COALESCE(cover_id, ?),
        unavailable = 0
       WHERE media_type = 'track'
         AND source_provider = 'local'
         AND NOT EXISTS (
           SELECT 1
           FROM tracks AS linked_tracks
           WHERE linked_tracks.id = playlist_items.media_id
             AND linked_tracks.missing = 0
         )
         AND (
           source_item_id = ?
           OR (
             source_item_id IS NULL
             AND title_snapshot = ?
             AND artist_snapshot = ?
             AND COALESCE(album_snapshot, '') = COALESCE(?, '')
             AND (
               duration_snapshot IS NULL
               OR ? IS NULL
               OR ABS(duration_snapshot - ?) < 1
             )
           )
         )`,
      track.id,
      track.path,
      track.coverId,
      track.path,
      track.title,
      track.artist,
      track.album,
      Number.isFinite(track.duration) ? track.duration : null,
      Number.isFinite(track.duration) ? track.duration : null,
    );

    const changed = Number(result.changes ?? 0);
    if (changed > 0) {
      this.run(
        `UPDATE playlists SET updated_at = ?
         WHERE id IN (
           SELECT DISTINCT playlist_id
           FROM playlist_items
           WHERE media_type = 'track'
             AND source_provider = 'local'
             AND media_id = ?
         )`,
        track.timestamp,
        track.id,
      );
    }

    return changed;
  }

  updateTrackCover(trackId: string, coverId: string | null, timestamp = nowIso()): void {
    this.run('UPDATE tracks SET cover_id = ?, updated_at = ? WHERE id = ?', coverId, timestamp, trackId);
  }

  findBpmAnalysisTargets(limit: number, trackIds?: string[], force = false): LibraryTrack[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const baseColumns = `SELECT
        tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
        tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
        tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
        tracks.bpm, tracks.bpm_confidence, tracks.beat_offset_ms, tracks.analysis_status, tracks.analysis_updated_at,
        tracks.replay_gain_track_gain_db, tracks.replay_gain_album_gain_db, tracks.replay_gain_track_peak,
        tracks.replay_gain_album_peak, tracks.replay_gain_integrated_lufs, tracks.replay_gain_source,
        tracks.replay_gain_status, tracks.replay_gain_updated_at,
        tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
        tracks.network_metadata_status, tracks.field_sources_json
      FROM tracks`;

    if (trackIds?.length) {
      const placeholders = trackIds.map(() => '?').join(', ');
      const rows = this.allRows(
        `${baseColumns}
         WHERE tracks.missing = 0 AND tracks.id IN (${placeholders})
         ORDER BY tracks.title COLLATE NOCASE
         LIMIT ?`,
        ...trackIds,
        safeLimit,
      );
      return rows.map((row) => this.mapTrack(row));
    }

    const rows = this.allRows(
      `${baseColumns}
       WHERE tracks.missing = 0
         AND (
           ? = 1
           OR tracks.bpm IS NULL
           OR tracks.analysis_status IN ('none', 'error', 'low_confidence')
           OR (
             tracks.analysis_status = 'complete'
             AND tracks.analysis_version < ?
             AND tracks.field_sources_json LIKE '%"bpm":"audio_analysis"%'
           )
         )
       ORDER BY tracks.updated_at DESC, tracks.title COLLATE NOCASE
       LIMIT ?`,
      force ? 1 : 0,
      BPM_ANALYSIS_VERSION,
      safeLimit,
    );
    return rows.map((row) => this.mapTrack(row));
  }

  markTrackAnalyzing(trackId: string, timestamp = nowIso()): void {
    this.run(
      `UPDATE tracks SET analysis_status = 'analyzing', analysis_error = NULL, analysis_updated_at = ?, updated_at = ?
       WHERE id = ? AND missing = 0`,
      timestamp,
      timestamp,
      trackId,
    );
  }

  updateTrackBpmAnalysis(
    trackId: string,
    update: {
      bpm: number | null;
      confidence: number;
      beatOffsetMs: number | null;
      status: 'complete' | 'low_confidence' | 'error';
      error?: string | null;
      fieldSources?: Record<string, string>;
    },
    timestamp = nowIso(),
  ): LibraryTrack | null {
    const current = this.getTrack(trackId);
    const fieldSources = update.fieldSources ?? {
      ...(current?.fieldSources ?? {}),
      bpm: update.bpm !== null ? 'audio_analysis' : current?.fieldSources.bpm ?? 'unknown',
      beatOffsetMs: update.beatOffsetMs !== null ? 'audio_analysis' : current?.fieldSources.beatOffsetMs ?? 'unknown',
    };

    this.run(
      `UPDATE tracks SET
        bpm = ?,
        bpm_confidence = ?,
        beat_offset_ms = ?,
        analysis_status = ?,
        analysis_version = ?,
        analysis_error = ?,
        analysis_updated_at = ?,
        field_sources_json = ?,
        updated_at = ?
      WHERE id = ? AND missing = 0`,
      update.bpm,
      update.confidence,
      update.beatOffsetMs,
      update.status,
      BPM_ANALYSIS_VERSION,
      update.error ?? null,
      timestamp,
      JSON.stringify(fieldSources),
      timestamp,
      trackId,
    );

    return this.getTrack(trackId);
  }

  findReplayGainAnalysisTargets(limit: number, trackIds?: string[], force = false): LibraryTrack[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const baseColumns = `SELECT
        tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
        tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
        tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
        tracks.bpm, tracks.bpm_confidence, tracks.beat_offset_ms, tracks.analysis_status, tracks.analysis_updated_at,
        tracks.replay_gain_track_gain_db, tracks.replay_gain_album_gain_db, tracks.replay_gain_track_peak,
        tracks.replay_gain_album_peak, tracks.replay_gain_integrated_lufs, tracks.replay_gain_source,
        tracks.replay_gain_status, tracks.replay_gain_updated_at,
        tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
        tracks.network_metadata_status, tracks.field_sources_json
      FROM tracks`;

    if (trackIds?.length) {
      const placeholders = trackIds.map(() => '?').join(', ');
      const rows = this.allRows(
        `${baseColumns}
         WHERE tracks.missing = 0
           AND tracks.id IN (${placeholders})
           AND (? = 1 OR tracks.replay_gain_source != 'tag')
         ORDER BY tracks.title COLLATE NOCASE
         LIMIT ?`,
        ...trackIds,
        force ? 1 : 0,
        safeLimit,
      );
      return rows.map((row) => this.mapTrack(row));
    }

    const rows = this.allRows(
      `${baseColumns}
       WHERE tracks.missing = 0
         AND tracks.replay_gain_source != 'tag'
         AND (
           ? = 1
           OR tracks.replay_gain_track_gain_db IS NULL
           OR tracks.replay_gain_status IN ('none', 'missing', 'error')
           OR (
             tracks.replay_gain_status = 'complete'
             AND tracks.replay_gain_version < ?
           )
         )
       ORDER BY tracks.updated_at DESC, tracks.title COLLATE NOCASE
       LIMIT ?`,
      force ? 1 : 0,
      REPLAY_GAIN_ANALYSIS_VERSION,
      safeLimit,
    );
    return rows.map((row) => this.mapTrack(row));
  }

  markTrackReplayGainAnalyzing(trackId: string, timestamp = nowIso()): void {
    this.run(
      `UPDATE tracks SET replay_gain_status = 'analyzing', replay_gain_error = NULL, replay_gain_updated_at = ?, updated_at = ?
       WHERE id = ? AND missing = 0 AND replay_gain_source != 'tag'`,
      timestamp,
      timestamp,
      trackId,
    );
  }

  updateTrackReplayGainAnalysis(
    trackId: string,
    update: {
      trackGainDb: number | null;
      trackPeak: number | null;
      integratedLufs: number | null;
      status: 'complete' | 'missing' | 'error';
      error?: string | null;
    },
    timestamp = nowIso(),
  ): LibraryTrack | null {
    const current = this.getTrack(trackId);
    if (current?.replayGainSource === 'tag') {
      return current;
    }

    this.run(
      `UPDATE tracks SET
        replay_gain_track_gain_db = ?,
        replay_gain_track_peak = ?,
        replay_gain_integrated_lufs = ?,
        replay_gain_source = ?,
        replay_gain_status = ?,
        replay_gain_version = ?,
        replay_gain_error = ?,
        replay_gain_updated_at = ?,
        updated_at = ?
      WHERE id = ? AND missing = 0 AND replay_gain_source != 'tag'`,
      update.trackGainDb,
      update.trackPeak,
      update.integratedLufs,
      update.status === 'complete' ? 'analysis' : 'none',
      update.status,
      REPLAY_GAIN_ANALYSIS_VERSION,
      update.error ?? null,
      timestamp,
      timestamp,
      trackId,
    );

    return this.getTrack(trackId);
  }

  updateCoverCachePaths(oldDir: string, newDir: string, warnings: string[] = []): number {
    return this.transaction(() => updateCoverPathsInDatabase(this.database, oldDir, newDir, warnings));
  }

  recordTrackPlayback(trackId: string, timestamp = nowIso()): void {
    this.run(
      'UPDATE tracks SET play_count = COALESCE(play_count, 0) + 1, last_played_at = ? WHERE id = ? AND missing = 0',
      timestamp,
      trackId,
    );
  }

  createPlaybackHistoryEntry(input: {
    trackId: string | null;
    trackPath: string;
    mediaType?: 'local' | 'remote' | 'streaming';
    provider?: string | null;
    providerTrackId?: string | null;
    stableKey?: string | null;
    title: string;
    artist: string;
    album: string;
    albumArtist: string;
    coverId: string | null;
    coverSnapshot?: string | null;
    durationSeconds: number;
    durationSnapshot?: number | null;
    sourceType?: string | null;
    sourceLabel?: string | null;
    queueId?: string | null;
    startedAt?: string;
  }): PlaybackHistoryEntry {
    const id = randomUUID();
    const startedAt = input.startedAt ?? nowIso();
    const durationSeconds = Math.max(0, Number(input.durationSeconds) || 0);
    const sourceType = textOrNull(input.sourceType);
    const sourceLabel = textOrNull(input.sourceLabel);
    const queueId = textOrNull(input.queueId);
    const mediaType = input.mediaType ?? 'local';
    const provider = textOrNull(input.provider);
    const providerTrackId = textOrNull(input.providerTrackId);
    const stableKey = textOrNull(input.stableKey);
    const durationSnapshot = input.durationSnapshot ?? durationSeconds;
    const coverSnapshot = textOrNull(input.coverSnapshot);
    const historyKey = stableKey ?? playbackHistoryKey(input.trackId, input.trackPath);

    return this.transaction(() => {
      this.run(
        `INSERT INTO playback_history (
          id, track_id, track_path, media_type, provider, provider_track_id, stable_key,
          title_snapshot, artist_snapshot, album_snapshot, duration_snapshot, cover_snapshot,
          title, artist, album, album_artist, cover_id,
          started_at, ended_at, played_seconds, duration_seconds, completed,
          source_type, source_label, queue_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.trackId,
        input.trackPath,
        mediaType,
        provider,
        providerTrackId,
        stableKey,
        input.title,
        input.artist,
        input.album,
        durationSnapshot,
        coverSnapshot,
        input.title,
        input.artist,
        input.album,
        input.albumArtist,
        input.coverId,
        startedAt,
        null,
        0,
        durationSeconds,
        0,
        sourceType,
        sourceLabel,
        queueId,
        startedAt,
      );

      this.run(
        `INSERT INTO playback_history_stats (
          history_key, track_id, track_path, media_type, provider, provider_track_id, stable_key,
          title_snapshot, artist_snapshot, album_snapshot, duration_snapshot, cover_snapshot,
          title, artist, album, album_artist, cover_id,
          play_count, completed_count, total_played_seconds, duration_seconds,
          last_started_at, last_ended_at, source_type, source_label, queue_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(history_key) DO UPDATE SET
          track_id = excluded.track_id,
          track_path = excluded.track_path,
          media_type = excluded.media_type,
          provider = excluded.provider,
          provider_track_id = excluded.provider_track_id,
          stable_key = excluded.stable_key,
          title_snapshot = excluded.title_snapshot,
          artist_snapshot = excluded.artist_snapshot,
          album_snapshot = excluded.album_snapshot,
          duration_snapshot = excluded.duration_snapshot,
          cover_snapshot = excluded.cover_snapshot,
          title = excluded.title,
          artist = excluded.artist,
          album = excluded.album,
          album_artist = excluded.album_artist,
          cover_id = excluded.cover_id,
          play_count = playback_history_stats.play_count + 1,
          duration_seconds = excluded.duration_seconds,
          last_started_at = excluded.last_started_at,
          source_type = excluded.source_type,
          source_label = excluded.source_label,
          queue_id = excluded.queue_id,
          updated_at = excluded.updated_at`,
        historyKey,
        input.trackId,
        input.trackPath,
        mediaType,
        provider,
        providerTrackId,
        stableKey,
        input.title,
        input.artist,
        input.album,
        durationSnapshot,
        coverSnapshot,
        input.title,
        input.artist,
        input.album,
        input.albumArtist,
        input.coverId,
        1,
        0,
        0,
        durationSeconds,
        startedAt,
        null,
        sourceType,
        sourceLabel,
        queueId,
        startedAt,
      );

      const entry = this.getPlaybackHistoryEntry(id);
      if (!entry) {
        throw new Error(`Failed to create playback history entry ${id}`);
      }

      return entry;
    });
  }

  finishPlaybackHistoryEntry(
    id: string,
    input: { playedSeconds: number; durationSeconds?: number; completed?: boolean; endedAt?: string },
  ): PlaybackHistoryEntry | null {
    return this.transaction(() => {
      const current = this.getRow('SELECT * FROM playback_history WHERE id = ?', id);
      if (!current) {
        return null;
      }

      const endedAt = input.endedAt ?? nowIso();
      const playedSeconds = Math.max(0, Number(input.playedSeconds) || 0);
      const currentDurationSeconds = Number(current.duration_seconds ?? 0);
      const durationSeconds =
        typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
          ? input.durationSeconds
          : currentDurationSeconds;
      const completed = input.completed ?? this.isPlaybackCompleted(playedSeconds, durationSeconds);
      const previousPlayedSeconds = Math.max(0, Number(current.played_seconds ?? 0) || 0);
      const wasCompleted = Number(current.completed ?? 0) === 1;
      const historyKey = textOrNull(current.stable_key) ?? playbackHistoryKey(textOrNull(current.track_id), String(current.track_path));

      this.run(
        `UPDATE playback_history SET
          ended_at = ?,
          played_seconds = ?,
          duration_seconds = ?,
          duration_snapshot = COALESCE(duration_snapshot, ?),
          completed = ?
        WHERE id = ?`,
        endedAt,
        playedSeconds,
        durationSeconds,
        durationSeconds,
        completed ? 1 : 0,
        id,
      );

      this.run(
        `UPDATE playback_history_stats SET
          total_played_seconds = MAX(0, COALESCE(total_played_seconds, 0) + ?),
          completed_count = MAX(0, COALESCE(completed_count, 0) + ?),
          duration_seconds = ?,
          duration_snapshot = COALESCE(duration_snapshot, ?),
          last_ended_at = ?,
          updated_at = ?
        WHERE history_key = ?`,
        playedSeconds - previousPlayedSeconds,
        (completed ? 1 : 0) - (wasCompleted ? 1 : 0),
        durationSeconds,
        durationSeconds,
        endedAt,
        endedAt,
        historyKey,
      );

      const trackId = textOrNull(current.track_id);
      if (completed && !wasCompleted && trackId) {
        this.recordTrackPlayback(trackId, endedAt);
      }

      return this.getPlaybackHistoryEntry(id);
    });
  }

  getPlaybackHistory(query?: PlaybackHistoryQuery): LibraryPage<PlaybackHistoryEntry> {
    const { page, pageSize, search, from, to, completedOnly, sort } = pageFromHistoryQuery(query);
    const searchOptions = this.readSearchOptions();
    const offset = (page - 1) * pageSize;
    const hasTimeRange = Boolean(from || to);

    if (hasTimeRange) {
      const searchFilter = buildSearchFilter(search, [
        likePredicate('playback_history.title'),
        likePredicate('playback_history.artist'),
        likePredicate("COALESCE(playback_history.album, '')"),
        likePredicate("COALESCE(playback_history.title_snapshot, '')"),
        likePredicate("COALESCE(playback_history.artist_snapshot, '')"),
        likePredicate('playback_history.track_path'),
      ], searchOptions);
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (searchFilter.sql) {
        clauses.push(searchFilter.sql);
        params.push(...searchFilter.params);
      }

      if (from) {
        clauses.push('playback_history.started_at >= ?');
        params.push(from);
      }

      if (to) {
        clauses.push('playback_history.started_at < ?');
        params.push(to);
      }

      if (completedOnly) {
        clauses.push('playback_history.completed > 0');
      }

      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const totalRow = this.getRow(
        `SELECT COUNT(DISTINCT COALESCE(stable_key, track_id, track_path)) AS total
         FROM playback_history
         ${whereSql}`,
        ...params,
      );
      const rows = this.allRows(
        `WITH filtered_history AS (
           SELECT playback_history.*, COALESCE(stable_key, track_id, track_path) AS history_key
           FROM playback_history
           ${whereSql}
         ),
         grouped_history AS (
           SELECT
             history_key,
             COUNT(*) AS history_play_count,
             COALESCE(SUM(played_seconds), 0) AS history_played_seconds_total,
             COALESCE(SUM(CASE WHEN completed > 0 THEN 1 ELSE 0 END), 0) AS completed_count,
             MAX(started_at) AS last_started_at,
             MAX(ended_at) AS last_ended_at
           FROM filtered_history
           GROUP BY history_key
         ),
         latest_history AS (
           SELECT filtered_history.*
           FROM filtered_history
           INNER JOIN grouped_history
             ON filtered_history.history_key = grouped_history.history_key
           WHERE filtered_history.id = (
             SELECT latest.id
             FROM filtered_history AS latest
             WHERE latest.history_key = grouped_history.history_key
             ORDER BY latest.started_at DESC, latest.created_at DESC, latest.id DESC
             LIMIT 1
           )
         )
         SELECT
           grouped_history.history_key AS id,
           latest_history.track_id,
           latest_history.track_path,
           latest_history.media_type,
           latest_history.provider,
           latest_history.provider_track_id,
           latest_history.stable_key,
           latest_history.title_snapshot,
           latest_history.artist_snapshot,
           latest_history.album_snapshot,
           latest_history.duration_snapshot,
           latest_history.cover_snapshot,
           latest_history.title,
           latest_history.artist,
           latest_history.album,
           latest_history.album_artist,
           latest_history.cover_id,
           grouped_history.last_started_at AS started_at,
           grouped_history.last_ended_at AS ended_at,
           grouped_history.history_played_seconds_total,
           latest_history.duration_seconds,
           grouped_history.history_play_count,
           grouped_history.completed_count,
           latest_history.source_type,
           latest_history.source_label,
           latest_history.queue_id
         FROM grouped_history
         INNER JOIN latest_history
           ON latest_history.history_key = grouped_history.history_key
         ORDER BY grouped_history.history_play_count DESC, grouped_history.last_started_at DESC
         LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      );
      const total = Number(totalRow?.total ?? 0);

      return {
        items: rows.map((row) => this.mapPlaybackHistoryEntry(row)),
        page,
        pageSize,
        total,
        hasMore: offset + rows.length < total,
      };
    }

    const searchFilter = buildSearchFilter(search, [
      likePredicate('playback_history_stats.title'),
      likePredicate('playback_history_stats.artist'),
      likePredicate("COALESCE(playback_history_stats.album, '')"),
      likePredicate("COALESCE(playback_history_stats.title_snapshot, '')"),
      likePredicate("COALESCE(playback_history_stats.artist_snapshot, '')"),
      likePredicate('playback_history_stats.track_path'),
    ], searchOptions);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (searchFilter.sql) {
      clauses.push(searchFilter.sql);
      params.push(...searchFilter.params);
    }

    if (from) {
      clauses.push('playback_history_stats.last_started_at >= ?');
      params.push(from);
    }

    if (to) {
      clauses.push('playback_history_stats.last_started_at < ?');
      params.push(to);
    }

    if (completedOnly) {
      clauses.push('playback_history_stats.completed_count > 0');
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const totalRow = this.getRow(
      `SELECT COUNT(*) AS total
       FROM playback_history_stats
       ${whereSql}`,
      ...params,
    );
    const rows = this.allRows(
      `SELECT
         history_key AS id,
         track_id,
         track_path,
         media_type,
         provider,
         provider_track_id,
         stable_key,
         title_snapshot,
         artist_snapshot,
         album_snapshot,
         duration_snapshot,
         cover_snapshot,
         title,
         artist,
         album,
         album_artist,
         cover_id,
         last_started_at AS started_at,
         last_ended_at AS ended_at,
         total_played_seconds AS played_seconds,
         duration_seconds,
         play_count AS history_play_count,
         completed_count,
         source_type,
         source_label,
         queue_id
       FROM playback_history_stats
       ${whereSql}
       ORDER BY ${sort === 'recent' ? 'last_started_at DESC, play_count DESC' : 'play_count DESC, last_started_at DESC'}
       LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);

    return {
      items: rows.map((row) => this.mapPlaybackHistoryEntry(row)),
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  getLocalPlaybackHistoryValidationCandidates(): PlaybackHistoryValidationCandidate[] {
    const rows = this.allRows(
      `SELECT history_key, track_path
       FROM playback_history_stats
       WHERE media_type = 'local'
         AND history_key IS NOT NULL
         AND TRIM(history_key) != ''
         AND track_path IS NOT NULL
         AND TRIM(track_path) != ''`,
    );

    return rows
      .map((row) => ({
        historyKey: String(row.history_key ?? ''),
        trackPath: String(row.track_path ?? ''),
      }))
      .filter((candidate) => candidate.historyKey.trim() !== '' && candidate.trackPath.trim() !== '');
  }

  prunePlaybackHistoryByKeys(historyKeys: string[]): PlaybackHistoryPruneResult {
    const uniqueKeys = Array.from(new Set(historyKeys.map((key) => key.trim()).filter(Boolean)));
    if (uniqueKeys.length === 0) {
      return { removedEntriesCount: 0, removedStatsCount: 0 };
    }

    return this.transaction(() => {
      let removedEntriesCount = 0;
      let removedStatsCount = 0;
      const batchSize = 500;

      for (let index = 0; index < uniqueKeys.length; index += batchSize) {
        const batch = uniqueKeys.slice(index, index + batchSize);
        const placeholders = batch.map(() => '?').join(', ');
        removedEntriesCount += Number(
          this.run(
            `DELETE FROM playback_history
             WHERE COALESCE(stable_key, track_id, track_path) IN (${placeholders})`,
            ...batch,
          ).changes ?? 0,
        );
        removedStatsCount += Number(
          this.run(
            `DELETE FROM playback_history_stats
             WHERE history_key IN (${placeholders})`,
            ...batch,
          ).changes ?? 0,
        );
      }

      return { removedEntriesCount, removedStatsCount };
    });
  }

  deletePlaybackHistoryEntry(id: string): void {
    this.transaction(() => {
      this.run('DELETE FROM playback_history WHERE COALESCE(stable_key, track_id, track_path) = ?', id);
      this.run('DELETE FROM playback_history_stats WHERE history_key = ?', id);
    });
  }

  clearPlaybackHistory(): void {
    this.transaction(() => {
      this.run('DELETE FROM playback_history');
      this.run('DELETE FROM playback_history_stats');
    });
  }

  getPlaybackHistorySummary(query?: PlaybackHistoryQuery, now = new Date()): PlaybackHistorySummary {
    const { search, from, to, completedOnly } = pageFromHistoryQuery(query);
    const searchOptions = this.readSearchOptions();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const todayRow = this.getRow(
      `SELECT COUNT(*) AS count, COALESCE(SUM(played_seconds), 0) AS played_seconds
       FROM playback_history
       WHERE started_at >= ? AND started_at < ?`,
      startOfToday.toISOString(),
      endOfToday.toISOString(),
    );

    if (!search && !from && !to && !completedOnly) {
      const statsRow = this.getRow(
        `SELECT
           COALESCE(SUM(play_count), 0) AS count,
           COALESCE(SUM(total_played_seconds), 0) AS played_seconds,
           MAX(last_started_at) AS latest
         FROM playback_history_stats`,
      );
      const totalCount = Number(statsRow?.count ?? 0);

      return {
        todayCount: Number(todayRow?.count ?? 0),
        todayPlayedSeconds: Number(todayRow?.played_seconds ?? 0),
        totalCount,
        latestPlayedAt: textOrNull(statsRow?.latest),
        rangeCount: totalCount,
        rangePlayedSeconds: Number(statsRow?.played_seconds ?? 0),
        rangeLatestPlayedAt: textOrNull(statsRow?.latest),
      };
    }

    const totalRow = this.getRow('SELECT COUNT(*) AS total, MAX(started_at) AS latest FROM playback_history');
    const searchFilter = buildSearchFilter(search, [
      likePredicate('playback_history.title'),
      likePredicate('playback_history.artist'),
      likePredicate("COALESCE(playback_history.album, '')"),
      likePredicate("COALESCE(playback_history.title_snapshot, '')"),
      likePredicate("COALESCE(playback_history.artist_snapshot, '')"),
      likePredicate('playback_history.track_path'),
    ], searchOptions);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (searchFilter.sql) {
      clauses.push(searchFilter.sql);
      params.push(...searchFilter.params);
    }

    if (from) {
      clauses.push('playback_history.started_at >= ?');
      params.push(from);
    }

    if (to) {
      clauses.push('playback_history.started_at < ?');
      params.push(to);
    }

    if (completedOnly) {
      clauses.push('playback_history.completed > 0');
    }

    const rangeWhereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rangeRow = this.getRow(
      `SELECT COUNT(*) AS count, COALESCE(SUM(played_seconds), 0) AS played_seconds, MAX(started_at) AS latest
       FROM playback_history
       ${rangeWhereSql}`,
      ...params,
    );

    return {
      todayCount: Number(todayRow?.count ?? 0),
      todayPlayedSeconds: Number(todayRow?.played_seconds ?? 0),
      totalCount: Number(totalRow?.total ?? 0),
      latestPlayedAt: textOrNull(totalRow?.latest),
      rangeCount: Number(rangeRow?.count ?? 0),
      rangePlayedSeconds: Number(rangeRow?.played_seconds ?? 0),
      rangeLatestPlayedAt: textOrNull(rangeRow?.latest),
    };
  }

  getPlaybackStatsDashboard(query?: PlaybackHistoryQuery): PlaybackStatsDashboard {
    const { search, from, to, completedOnly } = pageFromHistoryQuery(query);

    if (!search && !from && !to && !completedOnly) {
      return this.getPlaybackStatsDashboardFromHistoryStats();
    }

    const searchOptions = this.readSearchOptions();
    const searchFilter = buildSearchFilter(search, [
      likePredicate('history.title'),
      likePredicate('history.artist'),
      likePredicate("COALESCE(history.album, '')"),
      likePredicate("COALESCE(history.title_snapshot, '')"),
      likePredicate("COALESCE(history.artist_snapshot, '')"),
      likePredicate('history.track_path'),
    ], searchOptions);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (searchFilter.sql) {
      clauses.push(searchFilter.sql);
      params.push(...searchFilter.params);
    }

    if (from) {
      clauses.push('history.started_at >= ?');
      params.push(from);
    }

    if (to) {
      clauses.push('history.started_at < ?');
      params.push(to);
    }

    if (completedOnly) {
      clauses.push('history.completed > 0');
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const historyKeySql = 'COALESCE(history.stable_key, history.track_id, history.track_path)';
    const totalsRow = this.getRow(
      `SELECT
         COUNT(*) AS play_count,
         COALESCE(SUM(CASE WHEN history.completed > 0 THEN 1 ELSE 0 END), 0) AS completed_count,
         COALESCE(SUM(history.played_seconds), 0) AS played_seconds,
         COUNT(DISTINCT ${historyKeySql}) AS unique_tracks,
         COUNT(DISTINCT COALESCE(NULLIF(TRIM(COALESCE(history.artist_snapshot, history.artist, '')), ''), 'Unknown Artist')) AS unique_artists
       FROM playback_history AS history
       ${whereSql}`,
      ...params,
    );
    const topTrackRows = this.allRows(
      `WITH filtered_history AS (
         SELECT history.*, ${historyKeySql} AS history_key
         FROM playback_history AS history
         ${whereSql}
       ),
       grouped_history AS (
         SELECT
           history_key,
           COUNT(*) AS play_count,
           COALESCE(SUM(CASE WHEN completed > 0 THEN 1 ELSE 0 END), 0) AS completed_count,
           COALESCE(SUM(played_seconds), 0) AS played_seconds,
           MAX(started_at) AS last_played_at
         FROM filtered_history
         GROUP BY history_key
       ),
       latest_history AS (
         SELECT filtered_history.*
         FROM filtered_history
         INNER JOIN grouped_history ON grouped_history.history_key = filtered_history.history_key
         WHERE filtered_history.id = (
           SELECT latest.id
           FROM filtered_history AS latest
           WHERE latest.history_key = grouped_history.history_key
           ORDER BY latest.started_at DESC, latest.created_at DESC, latest.id DESC
           LIMIT 1
         )
       )
       SELECT
         grouped_history.history_key AS id,
         latest_history.track_id,
         latest_history.title_snapshot,
         latest_history.artist_snapshot,
         latest_history.album_snapshot,
         latest_history.title,
         latest_history.artist,
         latest_history.album,
         latest_history.cover_id,
         latest_history.cover_snapshot,
         latest_history.duration_seconds,
         grouped_history.play_count,
         grouped_history.completed_count,
         grouped_history.played_seconds,
         grouped_history.last_played_at
       FROM grouped_history
       INNER JOIN latest_history ON latest_history.history_key = grouped_history.history_key
       ORDER BY grouped_history.play_count DESC, grouped_history.played_seconds DESC, grouped_history.last_played_at DESC
       LIMIT 8`,
      ...params,
    );
    const topArtistRows = this.allRows(
      `SELECT
         COALESCE(NULLIF(TRIM(COALESCE(history.artist_snapshot, history.artist, '')), ''), 'Unknown Artist') AS artist,
         COUNT(*) AS play_count,
         COALESCE(SUM(CASE WHEN history.completed > 0 THEN 1 ELSE 0 END), 0) AS completed_count,
         COALESCE(SUM(history.played_seconds), 0) AS played_seconds
       FROM playback_history AS history
       ${whereSql}
       GROUP BY 1
       ORDER BY play_count DESC, played_seconds DESC, artist COLLATE NOCASE
       LIMIT 8`,
      ...params,
    );
    const topAlbumRows = this.allRows(
      `WITH filtered_history AS (
         SELECT history.*, ${historyKeySql} AS history_key
         FROM playback_history AS history
         ${whereSql}
       ),
       album_history AS (
         SELECT
           filtered_history.*,
           (
             SELECT album_tracks.album_id
             FROM album_tracks
             INNER JOIN tracks ON tracks.id = album_tracks.track_id AND tracks.missing = 0
             WHERE album_tracks.track_id = filtered_history.track_id
             ORDER BY album_tracks.position ASC
             LIMIT 1
           ) AS resolved_album_id
         FROM filtered_history
       ),
       album_rows AS (
         SELECT
           album_history.*,
           albums.id AS album_id,
           albums.album_key,
           albums.title AS album_title,
           albums.album_artist AS album_artist_name,
           albums.year AS album_year,
           albums.track_count AS album_track_count,
           albums.duration AS album_duration,
           albums.cover_id AS album_cover_id,
           COALESCE(
             albums.id,
             'history:' ||
               lower(trim(COALESCE(NULLIF(TRIM(album_history.album_artist), ''), NULLIF(TRIM(album_history.artist_snapshot), ''), NULLIF(TRIM(album_history.artist), ''), 'Unknown Artist'))) ||
               char(31) ||
               lower(trim(COALESCE(NULLIF(TRIM(album_history.album_snapshot), ''), NULLIF(TRIM(album_history.album), ''), 'Unknown Album')))
           ) AS album_group_key
         FROM album_history
         LEFT JOIN albums ON albums.id = album_history.resolved_album_id
         WHERE NULLIF(TRIM(COALESCE(albums.title, album_history.album_snapshot, album_history.album, '')), '') IS NOT NULL
       ),
       grouped_albums AS (
         SELECT
           album_group_key,
           COUNT(*) AS play_count,
           COALESCE(SUM(CASE WHEN completed > 0 THEN 1 ELSE 0 END), 0) AS completed_count,
           COALESCE(SUM(played_seconds), 0) AS played_seconds,
           MAX(started_at) AS last_played_at
         FROM album_rows
         GROUP BY album_group_key
       ),
       latest_album_history AS (
         SELECT album_rows.*
         FROM album_rows
         INNER JOIN grouped_albums ON grouped_albums.album_group_key = album_rows.album_group_key
         WHERE album_rows.id = (
           SELECT latest.id
           FROM album_rows AS latest
           WHERE latest.album_group_key = grouped_albums.album_group_key
           ORDER BY latest.started_at DESC, latest.created_at DESC, latest.id DESC
           LIMIT 1
         )
       )
       SELECT
         grouped_albums.album_group_key AS id,
         latest_album_history.album_id,
         latest_album_history.album_key,
         latest_album_history.media_type,
         COALESCE(latest_album_history.album_title, latest_album_history.album_snapshot, latest_album_history.album, 'Unknown Album') AS title,
         COALESCE(latest_album_history.album_artist_name, latest_album_history.album_artist, latest_album_history.artist_snapshot, latest_album_history.artist, 'Unknown Artist') AS album_artist,
         latest_album_history.album_year AS year,
         COALESCE(latest_album_history.album_track_count, 1) AS track_count,
         COALESCE(latest_album_history.album_duration, latest_album_history.duration_seconds, latest_album_history.duration_snapshot, 0) AS duration,
         COALESCE(latest_album_history.album_cover_id, latest_album_history.cover_id) AS cover_id,
         latest_album_history.cover_snapshot,
         grouped_albums.play_count,
         grouped_albums.completed_count,
         grouped_albums.played_seconds,
         grouped_albums.last_played_at
       FROM grouped_albums
       INNER JOIN latest_album_history ON latest_album_history.album_group_key = grouped_albums.album_group_key
       ORDER BY grouped_albums.play_count DESC, grouped_albums.played_seconds DESC, grouped_albums.last_played_at DESC
       LIMIT 8`,
      ...params,
    );
    const formatRows = this.allRows(
      `SELECT
         CASE
           WHEN history.media_type = 'streaming' THEN 'Streaming' || CASE WHEN history.provider IS NOT NULL THEN ' · ' || history.provider ELSE '' END
           WHEN history.media_type = 'remote' THEN 'Remote'
           WHEN NULLIF(TRIM(COALESCE(tracks.codec, '')), '') IS NOT NULL THEN UPPER(tracks.codec)
           WHEN history.media_type = 'local' THEN 'Local'
           ELSE 'Unknown'
         END AS label,
         COUNT(*) AS play_count,
         COALESCE(SUM(history.played_seconds), 0) AS played_seconds
       FROM playback_history AS history
       LEFT JOIN tracks ON tracks.id = history.track_id AND tracks.missing = 0
       ${whereSql}
       GROUP BY 1
       ORDER BY play_count DESC, played_seconds DESC, label COLLATE NOCASE
       LIMIT 8`,
      ...params,
    );
    const qualityRows = this.allRows(
      `SELECT
         CASE
           WHEN history.media_type = 'streaming' THEN 'Streaming'
           WHEN history.media_type = 'remote' THEN 'Remote'
           WHEN (tracks.sample_rate >= 88200 AND tracks.bit_depth >= 24) OR UPPER(COALESCE(tracks.codec, '')) IN ('DSF', 'DFF', 'DSD') THEN 'Hi-Res'
           WHEN LOWER(COALESCE(tracks.codec, '')) IN ('flac', 'wav', 'wave', 'alac', 'aiff', 'aif', 'ape', 'wv', 'tta', 'dsf', 'dff') THEN 'Lossless'
           WHEN tracks.bitrate >= 320000 THEN 'High Bitrate'
           WHEN tracks.codec IS NOT NULL OR tracks.bitrate IS NOT NULL THEN 'Lossy'
           ELSE 'Unknown'
         END AS label,
         COUNT(*) AS play_count,
         COALESCE(SUM(history.played_seconds), 0) AS played_seconds
       FROM playback_history AS history
       LEFT JOIN tracks ON tracks.id = history.track_id AND tracks.missing = 0
       ${whereSql}
       GROUP BY 1
       ORDER BY play_count DESC, played_seconds DESC, label COLLATE NOCASE
       LIMIT 8`,
      ...params,
    );
    const dayClauses = [...clauses];
    const dayParams = [...params];
    if (!from && !to) {
      dayClauses.push('history.started_at >= ?');
      dayParams.push(playbackStatsActivityStartIso());
    }
    const dayWhereSql = dayClauses.length > 0 ? `WHERE ${dayClauses.join(' AND ')}` : '';
    const dayRows = this.allRows(
      `SELECT
         substr(history.started_at, 1, 10) AS date,
         COUNT(*) AS play_count,
         COALESCE(SUM(history.played_seconds), 0) AS played_seconds
       FROM playback_history AS history
       ${dayWhereSql}
       GROUP BY 1
       ORDER BY date DESC
       LIMIT 371`,
      ...dayParams,
    );

    return this.mapPlaybackStatsDashboard(totalsRow, topTrackRows, topArtistRows, topAlbumRows, formatRows, qualityRows, dayRows);
  }

  private getPlaybackStatsDashboardFromHistoryStats(): PlaybackStatsDashboard {
    const totalsRow = this.getRow(
      `SELECT
         COALESCE(SUM(play_count), 0) AS play_count,
         COALESCE(SUM(completed_count), 0) AS completed_count,
         COALESCE(SUM(total_played_seconds), 0) AS played_seconds,
         COUNT(*) AS unique_tracks,
         COUNT(DISTINCT COALESCE(NULLIF(TRIM(COALESCE(artist_snapshot, artist, '')), ''), 'Unknown Artist')) AS unique_artists
       FROM playback_history_stats`,
    );
    const topTrackRows = this.allRows(
      `SELECT
         history_key AS id,
         track_id,
         title_snapshot,
         artist_snapshot,
         album_snapshot,
         title,
         artist,
         album,
         cover_id,
         cover_snapshot,
         duration_seconds,
         play_count,
         completed_count,
         total_played_seconds AS played_seconds,
         last_started_at AS last_played_at
       FROM playback_history_stats
       ORDER BY play_count DESC, total_played_seconds DESC, last_started_at DESC
       LIMIT 8`,
    );
    const topArtistRows = this.allRows(
      `SELECT
         COALESCE(NULLIF(TRIM(COALESCE(artist_snapshot, artist, '')), ''), 'Unknown Artist') AS artist,
         COALESCE(SUM(play_count), 0) AS play_count,
         COALESCE(SUM(completed_count), 0) AS completed_count,
         COALESCE(SUM(total_played_seconds), 0) AS played_seconds
       FROM playback_history_stats
       GROUP BY 1
       ORDER BY play_count DESC, played_seconds DESC, artist COLLATE NOCASE
       LIMIT 8`,
    );
    const topAlbumRows = this.allRows(
      `WITH album_history AS (
         SELECT
           history.*,
           (
             SELECT album_tracks.album_id
             FROM album_tracks
             INNER JOIN tracks ON tracks.id = album_tracks.track_id AND tracks.missing = 0
             WHERE album_tracks.track_id = history.track_id
             ORDER BY album_tracks.position ASC
             LIMIT 1
           ) AS resolved_album_id
         FROM playback_history_stats AS history
       ),
       album_rows AS (
         SELECT
           album_history.*,
           albums.id AS album_id,
           albums.album_key,
           albums.title AS album_title,
           albums.album_artist AS album_artist_name,
           albums.year AS album_year,
           albums.track_count AS album_track_count,
           albums.duration AS album_duration,
           albums.cover_id AS album_cover_id,
           COALESCE(
             albums.id,
             'history:' ||
               lower(trim(COALESCE(NULLIF(TRIM(album_history.album_artist), ''), NULLIF(TRIM(album_history.artist_snapshot), ''), NULLIF(TRIM(album_history.artist), ''), 'Unknown Artist'))) ||
               char(31) ||
               lower(trim(COALESCE(NULLIF(TRIM(album_history.album_snapshot), ''), NULLIF(TRIM(album_history.album), ''), 'Unknown Album')))
           ) AS album_group_key
         FROM album_history
         LEFT JOIN albums ON albums.id = album_history.resolved_album_id
         WHERE NULLIF(TRIM(COALESCE(albums.title, album_history.album_snapshot, album_history.album, '')), '') IS NOT NULL
       ),
       grouped_albums AS (
         SELECT
           album_group_key,
           COALESCE(SUM(play_count), 0) AS play_count,
           COALESCE(SUM(completed_count), 0) AS completed_count,
           COALESCE(SUM(total_played_seconds), 0) AS played_seconds,
           MAX(last_started_at) AS last_played_at
         FROM album_rows
         GROUP BY album_group_key
       ),
       latest_album_history AS (
         SELECT album_rows.*
         FROM album_rows
         INNER JOIN grouped_albums ON grouped_albums.album_group_key = album_rows.album_group_key
         WHERE album_rows.history_key = (
           SELECT latest.history_key
           FROM album_rows AS latest
           WHERE latest.album_group_key = grouped_albums.album_group_key
           ORDER BY latest.last_started_at DESC, latest.updated_at DESC, latest.history_key DESC
           LIMIT 1
         )
       )
       SELECT
         grouped_albums.album_group_key AS id,
         latest_album_history.album_id,
         latest_album_history.album_key,
         latest_album_history.media_type,
         COALESCE(latest_album_history.album_title, latest_album_history.album_snapshot, latest_album_history.album, 'Unknown Album') AS title,
         COALESCE(latest_album_history.album_artist_name, latest_album_history.album_artist, latest_album_history.artist_snapshot, latest_album_history.artist, 'Unknown Artist') AS album_artist,
         latest_album_history.album_year AS year,
         COALESCE(latest_album_history.album_track_count, 1) AS track_count,
         COALESCE(latest_album_history.album_duration, latest_album_history.duration_seconds, latest_album_history.duration_snapshot, 0) AS duration,
         COALESCE(latest_album_history.album_cover_id, latest_album_history.cover_id) AS cover_id,
         latest_album_history.cover_snapshot,
         grouped_albums.play_count,
         grouped_albums.completed_count,
         grouped_albums.played_seconds,
         grouped_albums.last_played_at
       FROM grouped_albums
       INNER JOIN latest_album_history ON latest_album_history.album_group_key = grouped_albums.album_group_key
       ORDER BY grouped_albums.play_count DESC, grouped_albums.played_seconds DESC, grouped_albums.last_played_at DESC
       LIMIT 8`,
    );
    const formatRows = this.allRows(
      `SELECT
         CASE
           WHEN history.media_type = 'streaming' THEN 'Streaming' || CASE WHEN history.provider IS NOT NULL THEN char(32) || char(183) || char(32) || history.provider ELSE '' END
           WHEN history.media_type = 'remote' THEN 'Remote'
           WHEN NULLIF(TRIM(COALESCE(tracks.codec, '')), '') IS NOT NULL THEN UPPER(tracks.codec)
           WHEN history.media_type = 'local' THEN 'Local'
           ELSE 'Unknown'
         END AS label,
         COALESCE(SUM(history.play_count), 0) AS play_count,
         COALESCE(SUM(history.total_played_seconds), 0) AS played_seconds
       FROM playback_history_stats AS history
       LEFT JOIN tracks ON tracks.id = history.track_id AND tracks.missing = 0
       GROUP BY 1
       ORDER BY play_count DESC, played_seconds DESC, label COLLATE NOCASE
       LIMIT 8`,
    );
    const qualityRows = this.allRows(
      `SELECT
         CASE
           WHEN history.media_type = 'streaming' THEN 'Streaming'
           WHEN history.media_type = 'remote' THEN 'Remote'
           WHEN (tracks.sample_rate >= 88200 AND tracks.bit_depth >= 24) OR UPPER(COALESCE(tracks.codec, '')) IN ('DSF', 'DFF', 'DSD') THEN 'Hi-Res'
           WHEN LOWER(COALESCE(tracks.codec, '')) IN ('flac', 'wav', 'wave', 'alac', 'aiff', 'aif', 'ape', 'wv', 'tta', 'dsf', 'dff') THEN 'Lossless'
           WHEN tracks.bitrate >= 320000 THEN 'High Bitrate'
           WHEN tracks.codec IS NOT NULL OR tracks.bitrate IS NOT NULL THEN 'Lossy'
           ELSE 'Unknown'
         END AS label,
         COALESCE(SUM(history.play_count), 0) AS play_count,
         COALESCE(SUM(history.total_played_seconds), 0) AS played_seconds
       FROM playback_history_stats AS history
       LEFT JOIN tracks ON tracks.id = history.track_id AND tracks.missing = 0
       GROUP BY 1
       ORDER BY play_count DESC, played_seconds DESC, label COLLATE NOCASE
       LIMIT 8`,
    );
    const dayRows = this.allRows(
      `SELECT
         substr(history.started_at, 1, 10) AS date,
         COUNT(*) AS play_count,
         COALESCE(SUM(history.played_seconds), 0) AS played_seconds
       FROM playback_history AS history
       WHERE history.started_at >= ?
       GROUP BY 1
       ORDER BY date DESC
       LIMIT 371`,
      playbackStatsActivityStartIso(),
    );

    return this.mapPlaybackStatsDashboard(totalsRow, topTrackRows, topArtistRows, topAlbumRows, formatRows, qualityRows, dayRows);
  }

  private mapPlaybackStatsDashboard(
    totalsRow: DbRow | null | undefined,
    topTrackRows: DbRow[],
    topArtistRows: DbRow[],
    topAlbumRows: DbRow[],
    formatRows: DbRow[],
    qualityRows: DbRow[],
    dayRows: DbRow[],
  ): PlaybackStatsDashboard {
    return {
      generatedAt: nowIso(),
      totals: {
        playCount: Number(totalsRow?.play_count ?? 0),
        completedCount: Number(totalsRow?.completed_count ?? 0),
        playedSeconds: Number(totalsRow?.played_seconds ?? 0),
        uniqueTracks: Number(totalsRow?.unique_tracks ?? 0),
        uniqueArtists: Number(totalsRow?.unique_artists ?? 0),
      },
      topTracks: topTrackRows.map((row) => {
        const coverId = textOrNull(row.cover_id);
        return {
          id: String(row.id),
          trackId: textOrNull(row.track_id),
          title: textOrNull(row.title_snapshot) ?? String(row.title ?? ''),
          artist: textOrNull(row.artist_snapshot) ?? String(row.artist ?? ''),
          album: textOrNull(row.album_snapshot) ?? String(row.album ?? ''),
          coverThumb: coverId ? this.toCoverUrl(coverId, 'thumb') : textOrNull(row.cover_snapshot),
          playCount: Number(row.play_count ?? 0),
          completedCount: Number(row.completed_count ?? 0),
          playedSeconds: Number(row.played_seconds ?? 0),
          durationSeconds: Number(row.duration_seconds ?? 0),
          lastPlayedAt: textOrNull(row.last_played_at),
        };
      }),
      topArtists: topArtistRows.map((row) => ({
        artist: String(row.artist ?? 'Unknown Artist'),
        playCount: Number(row.play_count ?? 0),
        completedCount: Number(row.completed_count ?? 0),
        playedSeconds: Number(row.played_seconds ?? 0),
      })),
      topAlbums: topAlbumRows.map((row) => {
        const coverId = textOrNull(row.cover_id);
        return {
          id: String(row.id),
          albumId: textOrNull(row.album_id),
          mediaType: row.media_type === 'remote' ? 'remote' : 'local',
          albumKey: textOrNull(row.album_key),
          title: String(row.title ?? 'Unknown Album'),
          albumArtist: String(row.album_artist ?? 'Unknown Artist'),
          year: numberOrNull(row.year),
          trackCount: Number(row.track_count ?? 0),
          duration: Number(row.duration ?? 0),
          coverId,
          coverThumb: coverId ? this.toCoverUrl(coverId, 'album') : textOrNull(row.cover_snapshot),
          playCount: Number(row.play_count ?? 0),
          completedCount: Number(row.completed_count ?? 0),
          playedSeconds: Number(row.played_seconds ?? 0),
          lastPlayedAt: textOrNull(row.last_played_at),
        };
      }),
      formatBreakdown: formatRows.map((row) => ({
        id: String(row.label ?? 'Unknown'),
        label: String(row.label ?? 'Unknown'),
        playCount: Number(row.play_count ?? 0),
        playedSeconds: Number(row.played_seconds ?? 0),
      })),
      qualityBreakdown: qualityRows.map((row) => ({
        id: String(row.label ?? 'Unknown'),
        label: String(row.label ?? 'Unknown'),
        playCount: Number(row.play_count ?? 0),
        playedSeconds: Number(row.played_seconds ?? 0),
      })),
      dailyActivity: dayRows
        .map((row) => ({
          date: String(row.date ?? ''),
          playCount: Number(row.play_count ?? 0),
          playedSeconds: Number(row.played_seconds ?? 0),
        }))
        .reverse(),
    };
  }

  getTrack(trackId: string): LibraryTrack | null {
    const row = this.getRow(
      `SELECT
        tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
        tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
        tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
        tracks.bpm, tracks.bpm_confidence, tracks.beat_offset_ms, tracks.analysis_status, tracks.analysis_updated_at,
        tracks.replay_gain_track_gain_db, tracks.replay_gain_album_gain_db, tracks.replay_gain_track_peak,
        tracks.replay_gain_album_peak, tracks.replay_gain_integrated_lufs, tracks.replay_gain_source,
        tracks.replay_gain_status, tracks.replay_gain_updated_at,
        tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
        tracks.network_metadata_status, tracks.field_sources_json
      FROM tracks
      WHERE tracks.id = ? AND tracks.missing = 0`,
      trackId,
    );

    return row ? this.mapTrack(row) : null;
  }

  getTrackByPath(filePath: string): LibraryTrack | null {
    const row = this.getRow(
      `SELECT
        tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
        tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
        tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
        tracks.bpm, tracks.bpm_confidence, tracks.beat_offset_ms, tracks.analysis_status, tracks.analysis_updated_at,
        tracks.replay_gain_track_gain_db, tracks.replay_gain_album_gain_db, tracks.replay_gain_track_peak,
        tracks.replay_gain_album_peak, tracks.replay_gain_integrated_lufs, tracks.replay_gain_source,
        tracks.replay_gain_status, tracks.replay_gain_updated_at,
        tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
        tracks.network_metadata_status, tracks.field_sources_json
       FROM tracks
       WHERE tracks.path = ? AND tracks.missing = 0`,
      resolve(filePath),
    );

    return row ? this.mapTrack(row) : null;
  }

  getActiveTracks(): LibraryTrack[] {
    return this.allRows(
      `SELECT
        tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
        tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
        tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
        tracks.bpm, tracks.bpm_confidence, tracks.beat_offset_ms, tracks.analysis_status, tracks.analysis_updated_at,
        tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
        tracks.network_metadata_status, tracks.field_sources_json
      FROM tracks
      WHERE tracks.missing = 0`,
    ).map((row) => this.mapTrack(row));
  }

  updateTrackTags(
    trackId: string,
    update: TrackTagUpdateInput,
    timestamp = nowIso(),
    preparedSearchTerms?: string,
  ): LibraryTrack {
    const current = this.getTrack(trackId);
    const filenameGuess = filenameTrackFallback(current?.path ?? update.title);
    const safeTitle = sanitizeLibraryText(update.title, filenameGuess.title);
    const safeArtist = sanitizeLibraryText(update.artist, filenameGuess.artist ?? unknownArtist);
    const safeAlbum = sanitizeLibraryText(update.album, '');
    const safeAlbumArtist = sanitizeLibraryText(update.albumArtist, safeArtist);
    const safeGenre = sanitizeNullableLibraryText(update.genre);
    const safeFieldSources = { ...update.fieldSources };

    if (safeTitle !== update.title && safeTitle === filenameGuess.title) {
      safeFieldSources.title = 'filename_fallback';
    }
    if (safeArtist !== update.artist) {
      safeFieldSources.artist = filenameGuess.artist ? 'filename_fallback' : 'unknown';
    }
    if (safeAlbum !== update.album) {
      safeFieldSources.album = 'unknown';
    }
    if (safeAlbumArtist !== update.albumArtist) {
      safeFieldSources.albumArtist = 'artist_fallback';
    }
    if (safeGenre !== update.genre) {
      safeFieldSources.genre = 'unknown';
    }

    const searchTerms = preparedSearchTerms ?? buildTrackSearchTerms({
      title: safeTitle,
      artist: safeArtist,
      album: safeAlbum,
      albumArtist: safeAlbumArtist,
      genre: safeGenre,
      path: current?.path,
    });

    this.run(
      `UPDATE tracks SET
        size_bytes = ?,
        mtime_ms = ?,
        title = ?,
        artist = ?,
        album = ?,
        album_artist = ?,
        track_no = ?,
        disc_no = ?,
        year = ?,
        genre = ?,
        bpm = COALESCE(?, bpm),
        search_terms = ?,
        metadata_status = ?,
        embedded_metadata_status = COALESCE(?, embedded_metadata_status),
        embedded_cover_status = COALESCE(?, embedded_cover_status),
        field_sources_json = ?,
        updated_at = ?
      WHERE id = ? AND missing = 0`,
      update.sizeBytes,
      update.mtimeMs,
      safeTitle,
      safeArtist,
      safeAlbum,
      safeAlbumArtist,
      update.trackNo,
      update.discNo,
      update.year,
      safeGenre,
      update.bpm ?? null,
      searchTerms,
      update.metadataStatus ?? 'ok',
      update.embeddedMetadataStatus ?? null,
      update.embeddedCoverStatus ?? null,
      JSON.stringify(safeFieldSources),
      timestamp,
      trackId,
    );

    const updated = this.getTrack(trackId);
    if (!updated) {
      throw new Error(`Unknown track ${trackId}`);
    }

    return updated;
  }

  deleteTrack(trackId: string): void {
    this.deleteTrackAndCompactAlbums(trackId);
  }

  deleteTracks(trackIds: string[]): number {
    const uniqueTrackIds = Array.from(new Set(trackIds.filter((trackId) => trackId.trim() !== '')));
    const affectedAlbumIds = new Set<string>();
    let changed = 0;

    for (const trackId of uniqueTrackIds) {
      const albumRows = this.allRows('SELECT album_id FROM album_tracks WHERE track_id = ?', trackId);
      for (const row of albumRows) {
        const albumId = textOrNull(row.album_id);
        if (albumId) {
          affectedAlbumIds.add(albumId);
        }
      }

      changed += Number(this.run('DELETE FROM tracks WHERE id = ?', trackId).changes ?? 0);
      this.run('DELETE FROM album_tracks WHERE track_id = ?', trackId);
    }

    for (const albumId of affectedAlbumIds) {
      this.compactAlbumAfterTrackDelete(albumId);
    }

    return changed;
  }

  deleteTrackAndCompactAlbums(trackId: string): number {
    const albumRows = this.allRows(
      `SELECT
        album_tracks.album_id AS album_id
       FROM album_tracks
       WHERE album_tracks.track_id = ?`,
      trackId,
    );
    const changed = Number(this.run('DELETE FROM tracks WHERE id = ?', trackId).changes ?? 0);

    if (changed <= 0) {
      return 0;
    }

    this.run('DELETE FROM album_tracks WHERE track_id = ?', trackId);

    for (const row of albumRows) {
      this.compactAlbumAfterTrackDelete(String(row.album_id));
    }

    return changed;
  }

  private compactAlbumAfterTrackDelete(albumId: string): void {
    const remainingRow = this.getRow(
      `SELECT COUNT(*) AS count, COALESCE(SUM(COALESCE(tracks.duration, 0)), 0) AS duration
       FROM album_tracks
       INNER JOIN tracks ON tracks.id = album_tracks.track_id
       WHERE album_tracks.album_id = ?
         AND tracks.missing = 0`,
      albumId,
    );
    const remainingCount = Number(remainingRow?.count ?? 0);

    if (remainingCount <= 0) {
      this.run('DELETE FROM artist_albums WHERE album_id = ?', albumId);
      this.run('DELETE FROM albums WHERE id = ?', albumId);
      return;
    }

    const coverRow = this.getRow(
      `SELECT tracks.cover_id AS cover_id
       FROM album_tracks
       INNER JOIN tracks ON tracks.id = album_tracks.track_id
       WHERE album_tracks.album_id = ? AND tracks.cover_id IS NOT NULL
       ORDER BY album_tracks.position ASC
       LIMIT 1`,
      albumId,
    );

    this.run(
      `UPDATE albums
       SET track_count = ?,
           duration = ?,
           cover_id = ?,
           updated_at = ?
       WHERE id = ?`,
      remainingCount,
      Number(remainingRow?.duration ?? 0),
      textOrNull(coverRow?.cover_id),
      nowIso(),
      albumId,
    );
  }

  updateAlbumSummary(albumId: string, update: {
    title: string;
    albumArtist: string;
    year: number | null;
    coverId: string | null;
  }, timestamp = nowIso()): LibraryAlbum | null {
    const safeTitle = sanitizeLibraryText(update.title, 'Unknown Album');
    const safeAlbumArtist = sanitizeLibraryText(update.albumArtist, unknownArtist);
    this.run(
      `UPDATE albums
       SET title = ?,
           album_artist = ?,
           year = ?,
           cover_id = ?,
           updated_at = ?
       WHERE id = ?`,
      safeTitle,
      safeAlbumArtist,
      update.year,
      update.coverId,
      timestamp,
      albumId,
    );

    return this.getAlbum(albumId);
  }

  deleteAllTracks(): number {
    const changed = Number(this.run('DELETE FROM tracks').changes ?? 0);
    this.run('DELETE FROM library_inbox_batches');
    this.run('DELETE FROM artist_tracks');
    this.run('DELETE FROM artist_albums');
    this.run('DELETE FROM album_tracks');
    this.run('DELETE FROM albums');
    this.run('DELETE FROM artists');
    return changed;
  }

  deleteLibraryCache(): number {
    return this.transaction(() => {
      const changed = this.deleteAllTracks();
      this.run('DELETE FROM network_metadata_decisions');
      this.run('DELETE FROM network_metadata_candidates');
      this.run('DELETE FROM network_cover_candidates');
      this.run('DELETE FROM covers');
      this.run('DELETE FROM scan_jobs');
      return changed;
    });
  }

  refreshArtists(): void {
    this.transaction(() => {
      const timestamp = nowIso();
      const artistMergeStrategy = normalizeArtistMergeStrategy(this.readSearchOptions().artistMergeStrategy);
      const stats = new Map<string, ArtistIndexStats>();
      const fuzzyStatsByBucket = new Map<string, ArtistIndexStats[]>();
      const trackLinks = new Map<string, { artistId: string; trackId: string; sourceName: string; position: number }>();
      const albumLinks = new Map<string, { artistId: string; albumId: string; sourceName: string }>();
      const fuzzyBucketsForKey = (key: string): string[] =>
        key.length >= 7 ? [`prefix:${key.slice(0, 3)}`, `suffix:${key.slice(-3)}`] : [];
      const addFuzzyStats = (artist: ArtistIndexStats): void => {
        for (const bucket of fuzzyBucketsForKey(artist.key)) {
          const items = fuzzyStatsByBucket.get(bucket);
          if (items) {
            items.push(artist);
          } else {
            fuzzyStatsByBucket.set(bucket, [artist]);
          }
        }
      };
      const fuzzyCandidatesForKey = (key: string): ArtistIndexStats[] => {
        const candidates = new Map<string, ArtistIndexStats>();
        for (const bucket of fuzzyBucketsForKey(key)) {
          for (const artist of fuzzyStatsByBucket.get(bucket) ?? []) {
            candidates.set(artist.key, artist);
          }
        }
        return Array.from(candidates.values());
      };
      const ensureArtist = (name: string, context?: { trackId?: string | null; albumId?: string | null }): ArtistIndexStats => {
        const directKey = artistMergeKeyForName(name, artistMergeStrategy);
        const direct = stats.get(directKey);
        if (direct) {
          direct.name = chooseArtistDisplayName(direct.name, name);
          return direct;
        }

        const key =
          artistMergeStrategy === 'standard'
            ? findArtistMergeKey(name, fuzzyCandidatesForKey(directKey), artistMergeStrategy, context)
            : directKey;
        const current = stats.get(key);

        if (current) {
          current.name = chooseArtistDisplayName(current.name, name);
          return current;
        }

        const next = {
          id: randomUUID(),
          key,
          name,
          trackIds: new Set<string>(),
          albumIds: new Set<string>(),
          coverId: null,
          coverScore: Number.MAX_SAFE_INTEGER,
        };
        stats.set(key, next);
        addFuzzyStats(next);

        return next;
      };
      const linkAlbum = (artist: ArtistIndexStats, albumId: string | null, sourceName: string): void => {
        if (!albumId) {
          return;
        }

        artist.albumIds.add(albumId);
        albumLinks.set(`${artist.id}:${albumId}`, {
          artistId: artist.id,
          albumId,
          sourceName,
        });
      };
      const considerCover = (artist: ArtistIndexStats, albumId: string | null, coverId: string | null, coverSource: unknown): void => {
        if (!albumId || !coverId || coverSourceOrNull(coverSource) === 'default') {
          return;
        }

        const score = stableArtistAlbumScore(artist.key, albumId);
        if (score < artist.coverScore) {
          artist.coverId = coverId;
          artist.coverScore = score;
        }
      };

      this.run('DELETE FROM artist_tracks');
      this.run('DELETE FROM artist_albums');
      this.run('DELETE FROM artists');

      const trackRows = this.allRows(
        `SELECT
          tracks.id AS track_id,
          tracks.artist AS artist,
          album_tracks.album_id AS album_id,
          albums.cover_id AS album_cover_id,
          (SELECT source_type FROM covers WHERE covers.id = albums.cover_id) AS album_cover_source
        FROM tracks
        LEFT JOIN album_tracks ON album_tracks.track_id = tracks.id
        LEFT JOIN albums ON albums.id = album_tracks.album_id
        WHERE tracks.missing = 0
          AND tracks.artist IS NOT NULL
          AND TRIM(tracks.artist) != ''
        ORDER BY tracks.created_at ASC, tracks.id ASC`,
      );

      trackRows.forEach((row, position) => {
        const trackId = String(row.track_id);
        const sourceName = normalizeArtistDisplayName(row.artist);
        const albumId = textOrNull(row.album_id);
        const coverId = textOrNull(row.album_cover_id);
        const coverSource = row.album_cover_source;

        for (const name of splitArtistNames(sourceName)) {
          const artist = ensureArtist(name, { trackId, albumId });

          artist.trackIds.add(trackId);
          trackLinks.set(`${artist.id}:${trackId}`, {
            artistId: artist.id,
            trackId,
            sourceName,
            position,
          });
          considerCover(artist, albumId, coverId, coverSource);
        }
      });

      const albumRows = this.allRows(
        `SELECT
          albums.id AS album_id,
          albums.album_artist AS album_artist,
          albums.cover_id AS cover_id,
          (SELECT source_type FROM covers WHERE covers.id = albums.cover_id) AS cover_source,
          album_tracks.track_id AS track_id,
          album_tracks.position AS track_position
         FROM albums
         LEFT JOIN album_tracks ON album_tracks.album_id = albums.id
         WHERE albums.album_artist IS NOT NULL AND TRIM(albums.album_artist) != ''
         ORDER BY albums.title COLLATE NOCASE, album_tracks.position ASC`,
      );

      for (const row of albumRows) {
        const albumId = String(row.album_id);
        const sourceName = normalizeArtistDisplayName(row.album_artist);
        const coverId = textOrNull(row.cover_id);
        const coverSource = row.cover_source;
        const trackId = textOrNull(row.track_id);
        const trackPosition = Number(row.track_position ?? trackLinks.size);

        for (const name of splitArtistNames(sourceName)) {
          const artist = ensureArtist(name, { trackId, albumId });
          linkAlbum(artist, albumId, sourceName);
          considerCover(artist, albumId, coverId, coverSource);
          if (trackId) {
            artist.trackIds.add(trackId);
            trackLinks.set(`${artist.id}:${trackId}`, {
              artistId: artist.id,
              trackId,
              sourceName,
              position: Number.isFinite(trackPosition) ? trackPosition : trackLinks.size,
            });
          }
        }
      }

      for (const artist of stats.values()) {
        this.run(
          `INSERT OR REPLACE INTO artists (
            id, artist_key, name, sort_name, role, track_count, album_count, cover_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          artist.id,
          artist.key,
          artist.name,
          artist.key,
          'track',
          artist.trackIds.size,
          artist.albumIds.size,
          artist.coverId,
          timestamp,
          timestamp,
        );
      }

      for (const link of trackLinks.values()) {
        this.run(
          `INSERT OR IGNORE INTO artist_tracks (artist_id, track_id, source_name, position)
           VALUES (?, ?, ?, ?)`,
          link.artistId,
          link.trackId,
          link.sourceName,
          link.position,
        );
      }

      for (const link of albumLinks.values()) {
        this.run(
          `INSERT OR IGNORE INTO artist_albums (artist_id, album_id, source_name)
           VALUES (?, ?, ?)`,
          link.artistId,
          link.albumId,
          link.sourceName,
        );
      }
    });
  }

  seedAlbumsForTracks(
    trackIds: readonly string[],
    albumService: AlbumService,
    now = nowIso(),
    _options: { albumMergeStrategy?: AlbumMergeStrategy } = {},
  ): void {
    const uniqueTrackIds = Array.from(
      new Set(trackIds.filter((trackId) => typeof trackId === 'string' && trackId.trim()).map((trackId) => trackId.trim())),
    );
    if (uniqueTrackIds.length === 0) {
      return;
    }

    this.transaction(() => {
      const affectedAlbumIds = new Set<string>();
      const rows: DbRow[] = [];

      for (let index = 0; index < uniqueTrackIds.length; index += albumSeedTrackBatchSize) {
        const batch = uniqueTrackIds.slice(index, index + albumSeedTrackBatchSize);
        const placeholders = batch.map(() => '?').join(', ');

        for (const row of this.allRows(`SELECT DISTINCT album_id FROM album_tracks WHERE track_id IN (${placeholders})`, ...batch)) {
          const albumId = textOrNull(row.album_id);
          if (albumId) {
            affectedAlbumIds.add(albumId);
          }
        }

        this.run(`DELETE FROM album_tracks WHERE track_id IN (${placeholders})`, ...batch);

        rows.push(
          ...this.allRows(
            `SELECT
              tracks.id, tracks.path, tracks.artist, tracks.album, tracks.album_artist,
              tracks.year, tracks.duration, tracks.cover_id, tracks.disc_no, tracks.track_no,
              tracks.field_sources_json, covers.source_type AS cover_source_type,
              covers.source_hash AS cover_source_hash, covers.album_path AS cover_album_path
             FROM tracks
             LEFT JOIN covers ON covers.id = tracks.cover_id
             WHERE tracks.missing = 0 AND tracks.id IN (${placeholders})
             ORDER BY tracks.album_artist COLLATE NOCASE, tracks.album COLLATE NOCASE, tracks.disc_no, tracks.track_no, tracks.title COLLATE NOCASE`,
            ...batch,
          ),
        );
      }

      const groups = this.buildStandardAlbumGroupsForRows(rows, albumService);

      for (const group of groups.values()) {
        const existing = this.getRow('SELECT id FROM albums WHERE album_key = ?', group.albumKey);
        const albumId = textOrNull(existing?.id) ?? group.id;
        affectedAlbumIds.add(albumId);

        if (!existing) {
          this.run(
            `INSERT INTO albums (
              id, album_key, title, album_artist, year, cover_id, track_count, duration, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            albumId,
            group.albumKey,
            group.title,
            group.albumArtist,
            group.year,
            group.coverId,
            group.trackCount,
            group.duration,
            now,
            now,
          );
        }

        for (const link of group.links) {
          this.run(
            'INSERT OR REPLACE INTO album_tracks (album_id, track_id, disc_no, track_no, position) VALUES (?, ?, ?, ?, ?)',
            albumId,
            link.trackId,
            link.discNo,
            link.trackNo,
            link.position,
          );
        }
      }

      for (const albumId of affectedAlbumIds) {
        this.refreshSeededAlbumStats(albumId, now);
      }
    });
  }

  refreshAlbums(
    albumService: AlbumService,
    now = nowIso(),
    options: { albumMergeStrategy?: AlbumMergeStrategy } = {},
  ): void {
    this.run('DELETE FROM album_tracks');
    this.run('DELETE FROM albums');

    const tracks = this.allRows(
      `SELECT
        tracks.id, tracks.path, tracks.artist, tracks.album, tracks.album_artist,
        tracks.year, tracks.duration, tracks.cover_id, tracks.disc_no, tracks.track_no,
        tracks.field_sources_json, covers.source_type AS cover_source_type,
        covers.source_hash AS cover_source_hash, covers.album_path AS cover_album_path
       FROM tracks
       LEFT JOIN covers ON covers.id = tracks.cover_id
       WHERE tracks.missing = 0
       ORDER BY tracks.album_artist COLLATE NOCASE, tracks.album COLLATE NOCASE, tracks.disc_no, tracks.track_no, tracks.title COLLATE NOCASE`,
    );

    const standardGroups = this.buildStandardAlbumGroupsForRows(tracks, albumService);

    const albumIdsByKey = new Map<string, string>();
    const albumStats = new Map<string, AlbumIndexStats>();
    const albumTrackLinks: AlbumTrackIndexLink[] = [];
    const looseAlbumKeys =
      options.albumMergeStrategy === 'sameTitleAndCover'
        ? this.makeLooseAlbumKeys(standardGroups, albumService)
        : new Map<string, string>();

    for (const standardGroup of standardGroups.values()) {
      const albumKey = looseAlbumKeys.get(standardGroup.albumKey) ?? standardGroup.albumKey;
      const albumId = albumIdsByKey.get(albumKey) ?? randomUUID();

      albumIdsByKey.set(albumKey, albumId);

      const stats =
        albumStats.get(albumKey) ??
        {
          id: albumId,
          albumKey,
          title: standardGroup.title,
          albumArtist: standardGroup.albumArtist,
          albumArtistCredits: createAlbumArtistCreditStats(),
          year: standardGroup.year,
          trackCount: 0,
          duration: 0,
          coverId: standardGroup.coverId,
        };

      mergeAlbumArtistCreditStats(stats.albumArtistCredits, standardGroup.albumArtistCredits);
      stats.albumArtist = displayAlbumArtistForCredits(stats.albumArtist, stats.albumArtistCredits);
      stats.trackCount += standardGroup.trackCount;
      stats.duration += standardGroup.duration;
      stats.coverId = stats.coverId ?? standardGroup.coverId;
      albumStats.set(albumKey, stats);

      for (const link of standardGroup.links) {
        albumTrackLinks.push({ albumId, ...link });
      }
    }

    for (const album of albumStats.values()) {
      this.run(
        `INSERT INTO albums (
          id, album_key, title, album_artist, year, cover_id, track_count, duration, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        album.id,
        album.albumKey,
        album.title,
        album.albumArtist,
        album.year,
        album.coverId,
        album.trackCount,
        album.duration,
        now,
        now,
      );
    }

    for (const link of albumTrackLinks) {
      this.run(
        'INSERT INTO album_tracks (album_id, track_id, disc_no, track_no, position) VALUES (?, ?, ?, ?, ?)',
        link.albumId,
        link.trackId,
        link.discNo,
        link.trackNo,
        link.position,
      );
    }
  }

  private buildStandardAlbumGroupsForRows(tracks: DbRow[], albumService: AlbumService): Map<string, StandardAlbumGroup> {
    const standardGroups = new Map<string, StandardAlbumGroup>();

    tracks.forEach((track, index) => {
      const trackId = String(track.id);
      const title = String(track.album || '');
      const albumArtist = String(track.album_artist || '');
      const trackAlbumArtist = albumArtistCreditForTrack(albumArtist, String(track.artist || ''));
      const year = numberOrNull(track.year);
      const fieldSources = parseJsonObject(track.field_sources_json);
      const keyInput: AlbumKeyInput = {
        albumTitle: title,
        albumArtist,
        fallbackArtist: String(track.artist || ''),
        albumArtistSource: fieldSources.albumArtist,
        year,
        filePath: String(track.path),
        trackId,
        coverId: textOrNull(track.cover_id),
        coverSourceHash: textOrNull(track.cover_source_hash),
        mergeStrategy: 'standard',
      };
      const standardAlbumKey = albumService.makeAlbumKey(keyInput);
      const standardGroup =
        standardGroups.get(standardAlbumKey) ??
        {
          id: randomUUID(),
          albumKey: standardAlbumKey,
          title: title || 'Unknown Album',
          albumArtist: trackAlbumArtist,
          albumArtistCredits: createAlbumArtistCreditStats(),
          year,
          trackCount: 0,
          duration: 0,
          coverId: textOrNull(track.cover_id),
          keyInput,
          coverFingerprints: new Map<string, number>(),
          coverSourceHashes: new Map<string, number>(),
          links: [],
        };
      const coverSourceHash = textOrNull(track.cover_source_hash);
      const coverVisualFingerprint = coverFingerprint(
        textOrNull(track.cover_source_type),
        coverSourceHash,
        textOrNull(track.cover_album_path),
      );

      addAlbumArtistCredit(standardGroup.albumArtistCredits, albumArtist, String(track.artist || ''), fieldSources.albumArtist);
      standardGroup.albumArtist = displayAlbumArtistForCredits(standardGroup.albumArtist, standardGroup.albumArtistCredits);
      standardGroup.trackCount += 1;
      standardGroup.duration += Number(track.duration ?? 0);
      standardGroup.coverId = standardGroup.coverId ?? textOrNull(track.cover_id);

      if (coverVisualFingerprint) {
        standardGroup.coverFingerprints.set(coverVisualFingerprint, (standardGroup.coverFingerprints.get(coverVisualFingerprint) ?? 0) + 1);
      }

      if (coverSourceHash) {
        standardGroup.coverSourceHashes.set(coverSourceHash, (standardGroup.coverSourceHashes.get(coverSourceHash) ?? 0) + 1);
      }

      standardGroup.links.push({
        trackId,
        discNo: numberOrNull(track.disc_no),
        trackNo: numberOrNull(track.track_no),
        position: index,
      });
      standardGroups.set(standardAlbumKey, standardGroup);
    });

    return standardGroups;
  }

  private refreshSeededAlbumStats(albumId: string, now: string): void {
    const rows = this.allRows(
      `SELECT
        tracks.id, tracks.artist, tracks.album, tracks.album_artist,
        tracks.year, tracks.duration, tracks.cover_id, tracks.field_sources_json,
        album_tracks.position
       FROM album_tracks
       INNER JOIN tracks ON tracks.id = album_tracks.track_id
       WHERE album_tracks.album_id = ? AND tracks.missing = 0
       ORDER BY album_tracks.position ASC`,
      albumId,
    );

    if (rows.length === 0) {
      this.run('DELETE FROM artist_albums WHERE album_id = ?', albumId);
      this.run('DELETE FROM album_tracks WHERE album_id = ?', albumId);
      this.run('DELETE FROM albums WHERE id = ?', albumId);
      return;
    }

    const first = rows[0]!;
    const credits = createAlbumArtistCreditStats();
    let albumArtist = albumArtistCreditForTrack(String(first.album_artist || ''), String(first.artist || ''));
    let year = numberOrNull(first.year);
    let duration = 0;
    let coverId: string | null = null;

    for (const row of rows) {
      const fieldSources = parseJsonObject(row.field_sources_json);
      addAlbumArtistCredit(credits, String(row.album_artist || ''), String(row.artist || ''), fieldSources.albumArtist);
      albumArtist = displayAlbumArtistForCredits(albumArtist, credits);
      year ??= numberOrNull(row.year);
      duration += Number(row.duration ?? 0);
      coverId ??= textOrNull(row.cover_id);
    }

    this.run(
      `UPDATE albums SET
        title = ?,
        album_artist = ?,
        year = ?,
        cover_id = ?,
        track_count = ?,
        duration = ?,
        updated_at = ?
       WHERE id = ?`,
      String(first.album || '') || 'Unknown Album',
      albumArtist,
      year,
      coverId,
      rows.length,
      duration,
      now,
      albumId,
    );
  }

  private makeLooseAlbumKeys(standardGroups: Map<string, StandardAlbumGroup>, albumService: AlbumService): Map<string, string> {
    const albumKeys = new Map<string, string>();
    const clusters: LooseAlbumCluster[] = [];

    for (const standardGroup of standardGroups.values()) {
      const coverSourceHash = mostCommonMapKey(standardGroup.coverSourceHashes);
      const coverMatchKey = mostCommonMapKey(standardGroup.coverFingerprints) ?? coverSourceHash;
      const looseTitle = normalizeAlbumTitleForLooseMerge(standardGroup.title);
      const matchingCluster = isKnownLooseAlbumTitle(looseTitle)
        ? clusters.find((cluster) => {
            if (!isKnownLooseAlbumTitle(cluster.representativeLooseTitle)) {
              return false;
            }

            if (looseTitle === cluster.representativeLooseTitle) {
              return true;
            }

            const titleScore = albumTitleSimilarity(standardGroup.title, cluster.representativeTitle);

            if (titleScore >= 0.95) {
              return true;
            }

            return Boolean(coverMatchKey && titleScore >= 0.85 && cluster.coverMatchKeys.has(coverMatchKey));
          })
        : undefined;

      if (matchingCluster) {
        albumKeys.set(standardGroup.albumKey, matchingCluster.albumKey);
        if (coverMatchKey) {
          matchingCluster.coverMatchKeys.add(coverMatchKey);
        }
        continue;
      }

      const albumKey = albumService.makeAlbumKey({
        ...standardGroup.keyInput,
        coverId: standardGroup.coverId,
        coverSourceHash,
        mergeStrategy: isKnownLooseAlbumTitle(looseTitle) ? 'sameTitleAndCover' : 'standard',
      });
      clusters.push({
        albumKey,
        representativeTitle: standardGroup.title,
        representativeLooseTitle: looseTitle,
        coverMatchKeys: new Set(coverMatchKey ? [coverMatchKey] : []),
      });
      albumKeys.set(standardGroup.albumKey, albumKey);
    }

    return albumKeys;
  }

  getTracks(query?: LibraryPageQuery): LibraryPage<LibraryTrack> {
    const startedAt = performance.now();
    const { page, pageSize, search, sort, sourceProvider, sourceId, excludeTrackIds, randomWindow } = pageFromQuery(query);
    const searchOptions = this.readSearchOptions();
    const offset = (page - 1) * pageSize;
    const mediaTypeFilter = libraryMediaTypeFromSourceProvider(sourceProvider);
    const hideDuplicates = query?.hideDuplicates === true;
    const showDuplicatesOnly = query?.showDuplicatesOnly === true;
    const duplicateMode = query?.duplicateMode === 'strict' ? query.duplicateMode : 'strict';
    const searchQuery = buildFtsSearchQuery(search, searchOptions);
    const searchJoinSql = searchQuery ? 'INNER JOIN tracks_fts ON tracks_fts.rowid = tracks.rowid' : '';
    const remoteSearchJoinSql = searchQuery && !showDuplicatesOnly ? 'INNER JOIN remote_tracks_fts ON remote_tracks_fts.rowid = remote_tracks.rowid' : '';
    const localSearchRankSql = searchQuery ? 'bm25(tracks_fts)' : '0';
    const remoteSearchRankSql = searchQuery && !showDuplicatesOnly ? 'bm25(remote_tracks_fts)' : '0';
    const useDuplicateJoin = hideDuplicates || showDuplicatesOnly;
    const duplicateJoinSql = useDuplicateJoin
      ? `LEFT JOIN duplicate_track_members AS duplicate_members
          ON duplicate_members.track_id = tracks.id
          AND duplicate_members.group_id IN (
            SELECT id FROM duplicate_track_groups WHERE mode = ?
          )`
      : '';
    const duplicateFilterSql = showDuplicatesOnly
      ? ' AND duplicate_members.track_id IS NOT NULL'
      : hideDuplicates ? ' AND COALESCE(duplicate_members.hidden, 0) = 0' : '';
    const whereSql = searchQuery
      ? `WHERE tracks.missing = 0${duplicateFilterSql} AND tracks_fts MATCH ?`
      : `WHERE tracks.missing = 0${duplicateFilterSql}`;
    const baseParams = [
      ...(useDuplicateJoin ? [duplicateMode] : []),
      ...(searchQuery ? [searchQuery] : []),
    ];
    const remoteWhereSql = showDuplicatesOnly
      ? 'WHERE 0 = 1'
      : searchQuery
      ? "WHERE remote_tracks.availability != 'missing' AND remote_sources.status = 'enabled' AND remote_tracks_fts MATCH ?"
      : "WHERE remote_tracks.availability != 'missing' AND remote_sources.status = 'enabled'";
    const allParams = [...baseParams, ...(searchQuery && !showDuplicatesOnly ? [searchQuery] : [])];
    const excludeTrackIdsSql = excludeTrackIds.length > 0 ? `id NOT IN (${excludeTrackIds.map(() => '?').join(', ')})` : '';
    const libraryWhereParts = [
      mediaTypeFilter ? 'media_type = ?' : '',
      sourceId ? 'source_id = ?' : '',
      excludeTrackIdsSql,
    ].filter(Boolean);
    const mediaTypeWhereSql = libraryWhereParts.length > 0 ? `WHERE ${libraryWhereParts.join(' AND ')}` : '';
    const pageParams = [...allParams, ...(mediaTypeFilter ? [mediaTypeFilter] : []), ...(sourceId ? [sourceId] : []), ...excludeTrackIds];
    const unifiedTracksSql = `WITH library_tracks AS (
      SELECT
        tracks.id,
        'local' AS media_type,
        tracks.path,
        NULL AS source_id,
        NULL AS source_display_name,
        NULL AS provider,
        NULL AS remote_path,
        NULL AS stable_key,
        tracks.title,
        tracks.artist,
        tracks.album,
        tracks.album_artist,
        tracks.track_no,
        tracks.disc_no,
        tracks.year,
        tracks.genre,
        tracks.duration,
        tracks.codec,
        tracks.sample_rate,
        tracks.bit_depth,
        tracks.bitrate,
        tracks.bpm,
        tracks.bpm_confidence,
        tracks.beat_offset_ms,
        tracks.analysis_status,
        tracks.analysis_updated_at,
        tracks.cover_id,
        tracks.metadata_status,
        tracks.embedded_metadata_status,
        tracks.embedded_cover_status,
        tracks.network_metadata_status,
        tracks.field_sources_json,
        'available' AS availability,
        tracks.created_at,
        tracks.updated_at,
        tracks.mtime_ms,
        tracks.size_bytes,
        tracks.play_count,
        tracks.last_played_at,
        ${localSearchRankSql} AS search_rank
      FROM tracks
      ${searchJoinSql}
      ${duplicateJoinSql}
      ${whereSql}
      UNION ALL
      SELECT
        remote_tracks.id,
        'remote' AS media_type,
        'remote://' || remote_tracks.source_id || remote_tracks.remote_path AS path,
        remote_tracks.source_id,
        remote_sources.display_name AS source_display_name,
        remote_tracks.provider,
        remote_tracks.remote_path,
        remote_tracks.stable_key,
        remote_tracks.title,
        remote_tracks.artist,
        remote_tracks.album,
        remote_tracks.album_artist,
        remote_tracks.track_no,
        remote_tracks.disc_no,
        remote_tracks.year,
        remote_tracks.genre,
        COALESCE(remote_tracks.duration, 0) AS duration,
        remote_tracks.codec,
        remote_tracks.sample_rate,
        remote_tracks.bit_depth,
        remote_tracks.bitrate,
        NULL AS bpm,
        NULL AS bpm_confidence,
        NULL AS beat_offset_ms,
        'none' AS analysis_status,
        NULL AS analysis_updated_at,
        remote_tracks.cover_id,
        remote_tracks.metadata_status,
        'present' AS embedded_metadata_status,
        CASE WHEN remote_tracks.cover_id IS NULL THEN 'missing' ELSE 'present' END AS embedded_cover_status,
        'none' AS network_metadata_status,
        remote_tracks.field_sources_json,
        remote_tracks.availability,
        remote_tracks.created_at,
        remote_tracks.updated_at,
        COALESCE(CAST(strftime('%s', remote_tracks.modified_at) AS INTEGER) * 1000, 0) AS mtime_ms,
        remote_tracks.size_bytes,
        0 AS play_count,
        NULL AS last_played_at,
        ${remoteSearchRankSql} AS search_rank
      FROM remote_tracks
      INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
      ${remoteSearchJoinSql}
      ${remoteWhereSql}
    )`;
    const orderSql = this.unifiedTrackOrderSql(sort, Boolean(searchQuery));
    const totalRow = this.getRow(`${unifiedTracksSql} SELECT COUNT(*) AS total FROM library_tracks ${mediaTypeWhereSql}`, ...pageParams);
    const total = Number(totalRow?.total ?? 0);
    const rows =
      randomWindow && sort === 'random'
        ? (() => {
            if (total <= 0) {
              return [];
            }

            const sampleSize = Math.min(total, Math.max(pageSize, Math.min(randomWindowMaxRows, pageSize * 3)));
            const rowNumbers = randomOneBasedRowNumbers(total, sampleSize);
            if (rowNumbers.length === 0) {
              return [];
            }

            return shuffleRows(
              this.allRows(
                `${unifiedTracksSql},
      sampled_tracks AS (
        SELECT *, ROW_NUMBER() OVER () AS echo_random_row_number
        FROM library_tracks
        ${mediaTypeWhereSql}
      )
      SELECT *
      FROM sampled_tracks
      WHERE echo_random_row_number IN (${rowNumbers.map(() => '?').join(', ')})`,
                ...pageParams,
                ...rowNumbers,
              ),
            ).slice(0, pageSize);
          })()
        : this.allRows(
            `${unifiedTracksSql}
      SELECT *
      FROM library_tracks
      ${mediaTypeWhereSql}
      ${orderSql}
      LIMIT ? OFFSET ?`,
            ...pageParams,
            pageSize,
            offset,
          );

    try {
      return {
        items: rows.map((row) => this.mapTrack(row)),
        page,
        pageSize,
        total,
        hasMore: offset + rows.length < total,
      };
    } finally {
      this.lastTracksQueryMs = performance.now() - startedAt;
    }
  }

  refreshDuplicateTracks(mode: DuplicateTrackMode = 'strict'): DuplicateTrackIndexSummary {
    return this.createDuplicateTrackService().rebuildDuplicateTrackIndex(mode);
  }

  refreshDuplicateTracksAsync(mode: DuplicateTrackMode = 'strict'): Promise<DuplicateTrackIndexSummary> {
    return this.createDuplicateTrackService().rebuildDuplicateTrackIndexAsync(mode);
  }

  getDuplicateTrackGroup(trackId: string): DuplicateTrackGroup | null {
    return this.createDuplicateTrackService().getDuplicateGroupForTrack(trackId);
  }

  getDuplicateTrackVersions(trackId: string): DuplicateTrackMember[] {
    return this.createDuplicateTrackService().getDuplicateMembersForTrack(trackId);
  }

  getDuplicateHiddenCounts(trackIds: string[], mode: DuplicateTrackMode = 'strict'): Record<string, number> {
    const result: Record<string, number> = {};
    const uniqueIds = Array.from(new Set(trackIds.filter((id) => typeof id === 'string' && id.length > 0)));

    for (const id of uniqueIds) {
      result[id] = 0;
    }

    if (uniqueIds.length === 0) {
      return result;
    }

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = this.allRows(
      `SELECT duplicate_track_members.track_id, duplicate_track_groups.hidden_count
       FROM duplicate_track_members
       INNER JOIN duplicate_track_groups ON duplicate_track_groups.id = duplicate_track_members.group_id
       WHERE duplicate_track_groups.mode = ?
         AND duplicate_track_members.track_id IN (${placeholders})`,
      mode,
      ...uniqueIds,
    );

    for (const row of rows) {
      const trackId = textOrNull(row.track_id);
      if (trackId && Object.prototype.hasOwnProperty.call(result, trackId)) {
        result[trackId] = Math.max(result[trackId] ?? 0, Number(row.hidden_count ?? 0));
      }
    }

    return result;
  }

  getDuplicateIndexSummary(mode: DuplicateTrackMode = 'strict'): DuplicateTrackIndexSummary {
    return this.createDuplicateTrackService().getDuplicateIndexSummary(mode);
  }

  getDuplicateTrackCleanupPreview(mode: DuplicateTrackMode = 'strict'): DuplicateTrackCleanupPreview {
    return this.createDuplicateTrackService().getCleanupPreview(mode);
  }

  scanDuplicateTrackCleanupPreview(mode: DuplicateTrackMode = 'strict'): Promise<DuplicateTrackCleanupPreview> {
    return this.createDuplicateTrackService().scanCleanupPreview(mode);
  }

  getAlbums(query?: LibraryPageQuery): LibraryPage<LibraryAlbum> {
    const startedAt = performance.now();
    const { page, pageSize, search, sort, sourceProvider, sourceId } = pageFromQuery(query);
    const searchOptions = this.readSearchOptions();
    const offset = (page - 1) * pageSize;
    const mediaTypeFilter = libraryMediaTypeFromSourceProvider(sourceProvider);
    const searchFilter = buildSearchFilter(search, [
      likePredicate('library_albums.title'),
      likePredicate('library_albums.album_artist'),
      likePredicate('COALESCE(CAST(library_albums.year AS TEXT), \'\')'),
      likePredicate('library_albums.search_blob'),
    ], searchOptions);
    const whereParts = [
      searchFilter.sql,
      mediaTypeFilter ? 'library_albums.media_type = ?' : '',
      sourceId ? 'library_albums.source_id = ?' : '',
    ].filter(Boolean);
    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const whereParams = [...searchFilter.params, ...(mediaTypeFilter ? [mediaTypeFilter] : []), ...(sourceId ? [sourceId] : [])];
    const orderSql = this.unifiedAlbumOrderSql(sort);
    const albumsSql = this.unifiedAlbumsSql();
    const totalRow = this.getRow(`${albumsSql} SELECT COUNT(*) AS total FROM library_albums ${whereSql}`, ...whereParams);
    const rows = this.allRows(
      `${albumsSql}
      SELECT
        id, media_type, source_id, source_display_name, provider, album_key, title, album_artist, year, track_count,
        duration, cover_id
      FROM library_albums
      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?`,
      ...whereParams,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);

    try {
      return {
        items: rows.map((row) => this.mapAlbum(row)),
        page,
        pageSize,
        total,
        hasMore: offset + rows.length < total,
      };
    } finally {
      this.lastAlbumsQueryMs = performance.now() - startedAt;
    }
  }

  private remoteAlbumIdentitySql(tableName: string): string {
    const mergeStrategy = normalizeRemoteAlbumMergeStrategy(this.readSearchOptions().remoteAlbumMergeStrategy);
    const conservativeAlbumIdentity = `lower(trim(CASE WHEN TRIM(COALESCE(${tableName}.album, '')) = '' THEN ${tableName}.id ELSE ${tableName}.album END))`;
    const standardAlbumIdentity = `COALESCE(
      NULLIF(NULLIF(echo_remote_album_merge_title(${tableName}.album), ''), 'unknown album'),
      ${tableName}.id
    )`;
    const albumIdentity = mergeStrategy === 'standard' ? standardAlbumIdentity : conservativeAlbumIdentity;
    const albumArtistIdentity = `lower(trim(COALESCE(NULLIF(TRIM(${tableName}.album_artist), ''), NULLIF(TRIM(${tableName}.artist), ''), 'Unknown Artist')))`;
    const yearIdentity = `COALESCE(CAST(${tableName}.year AS TEXT), '')`;
    const coverArtIdentity = `NULLIF(TRIM(COALESCE(json_extract(${tableName}.field_sources_json, '$.coverArt'), '')), '')`;
    const serverAlbumIdentity = `NULLIF(TRIM(COALESCE(json_extract(${tableName}.field_sources_json, '$.albumId'), json_extract(${tableName}.field_sources_json, '$.serverAlbumId'), '')), '')`;
    const albumArtistSource = `lower(trim(COALESCE(json_extract(${tableName}.field_sources_json, '$.albumArtist'), '')))`;
    const albumArtistLooksFallback = `(
      ${albumArtistSource} IN ('artist_fallback', 'filename_fallback', 'unknown', 'missing')
      OR lower(trim(COALESCE(${tableName}.album_artist, ''))) = lower(trim(COALESCE(${tableName}.artist, '')))
    )`;

    return `CASE
      WHEN ${tableName}.provider IN ('subsonic', 'jellyfin', 'emby') AND ${serverAlbumIdentity} IS NOT NULL
        THEN ${tableName}.source_id || char(31) || ${tableName}.provider || char(31) || 'server-album' || char(31) || ${serverAlbumIdentity}
      WHEN ${tableName}.provider IN ('subsonic', 'jellyfin', 'emby') AND TRIM(COALESCE(${tableName}.album, '')) != ''
        THEN ${tableName}.source_id || char(31) || ${tableName}.provider || char(31) || 'server-title' || char(31) ||
          ${mergeStrategy === 'standard' ? `echo_remote_dirname(${tableName}.remote_path) || char(31) ||` : ''}
          ${albumIdentity} || char(31) || ${yearIdentity}
      WHEN ${tableName}.provider NOT IN ('subsonic', 'jellyfin', 'emby') AND ${albumArtistLooksFallback}
        THEN ${tableName}.source_id || char(31) || ${tableName}.provider || char(31) || 'folder-album' || char(31) ||
          echo_remote_dirname(${tableName}.remote_path) || char(31) || ${albumIdentity} || char(31) || ${yearIdentity} ||
          ${mergeStrategy === 'standard' ? "''" : `char(31) || COALESCE(${coverArtIdentity}, '')`}
      ELSE ${tableName}.source_id || char(31) || ${tableName}.provider || char(31) || ${albumArtistIdentity} || char(31) || ${albumIdentity} || char(31) || ${yearIdentity}
    END`;
  }

  private unifiedAlbumsSql(): string {
    const remoteAlbumIdentity = this.remoteAlbumIdentitySql('remote_tracks');

    return `WITH remote_album_rows AS (
      SELECT
        remote_tracks.*,
        remote_sources.display_name AS source_display_name,
        'remote-album:' || lower(hex(${remoteAlbumIdentity})) AS album_id,
        ${this.remoteArtistIdSql('remote_tracks')} AS artist_id,
        COALESCE(NULLIF(TRIM(remote_tracks.album), ''), 'Unknown Album') AS album_title,
        COALESCE(NULLIF(TRIM(remote_tracks.album_artist), ''), NULLIF(TRIM(remote_tracks.artist), ''), 'Unknown Artist') AS album_artist_name,
        COALESCE(CAST(strftime('%s', remote_tracks.modified_at) AS INTEGER) * 1000, 0) AS sort_mtime_ms
      FROM remote_tracks
      INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
      WHERE remote_tracks.availability != 'missing'
        AND remote_sources.status = 'enabled'
    ),
    local_albums AS (
      SELECT
        albums.id,
        'local' AS media_type,
        NULL AS source_id,
        NULL AS source_display_name,
        NULL AS provider,
        albums.album_key,
        albums.title,
        albums.album_artist,
        albums.year,
        albums.track_count,
        albums.duration,
        albums.cover_id,
        albums.created_at,
        albums.updated_at,
        COALESCE((
          SELECT MAX(tracks.mtime_ms)
          FROM album_tracks
          INNER JOIN tracks ON tracks.id = album_tracks.track_id
          WHERE album_tracks.album_id = albums.id
            AND tracks.missing = 0
        ), 0) AS sort_mtime_ms,
        albums.title || ' ' || albums.album_artist || ' ' || COALESCE(CAST(albums.year AS TEXT), '') || ' ' || COALESCE((
          SELECT GROUP_CONCAT(tracks.search_terms || ' ' || tracks.title || ' ' || tracks.artist || ' ' || tracks.album_artist || ' ' || COALESCE(tracks.genre, '') || ' ' || tracks.path, ' ')
          FROM album_tracks
          INNER JOIN tracks ON tracks.id = album_tracks.track_id
          WHERE album_tracks.album_id = albums.id
            AND tracks.missing = 0
        ), '') AS search_blob
      FROM albums
      WHERE EXISTS (
        SELECT 1
        FROM album_tracks
        INNER JOIN tracks ON tracks.id = album_tracks.track_id
        WHERE album_tracks.album_id = albums.id
          AND tracks.missing = 0
      )
    ),
    remote_albums AS (
      SELECT
        album_id AS id,
        'remote' AS media_type,
        source_id,
        MIN(source_display_name) AS source_display_name,
        provider,
        album_id AS album_key,
        MIN(album_title) AS title,
        MIN(album_artist_name) AS album_artist,
        MIN(year) AS year,
        COUNT(*) AS track_count,
        COALESCE(SUM(COALESCE(duration, 0)), 0) AS duration,
        MIN(cover_id) AS cover_id,
        MIN(created_at) AS created_at,
        MAX(updated_at) AS updated_at,
        MAX(sort_mtime_ms) AS sort_mtime_ms,
        GROUP_CONCAT(COALESCE(search_terms, '') || ' ' || title || ' ' || artist || ' ' || album_artist || ' ' || COALESCE(genre, '') || ' ' || remote_path, ' ') AS search_blob
      FROM remote_album_rows
      GROUP BY album_id, source_id, provider
    ),
    remote_album_artist_counts AS (
      SELECT
        album_id,
        echo_artist_merge_key(COALESCE(NULLIF(TRIM(artist), ''), 'Unknown Artist')) AS artist_key,
        MIN(COALESCE(NULLIF(TRIM(artist), ''), 'Unknown Artist')) AS artist_name,
        COUNT(*) AS artist_track_count
      FROM remote_album_rows
      GROUP BY album_id, artist_key
    ),
    remote_album_artist_ranked AS (
      SELECT
        album_id,
        artist_name,
        artist_track_count,
        SUM(artist_track_count) OVER (PARTITION BY album_id) AS album_track_count,
        COUNT(*) OVER (PARTITION BY album_id) AS artist_group_count,
        LEAD(artist_track_count, 1, 0) OVER (PARTITION BY album_id ORDER BY artist_track_count DESC, artist_name COLLATE NOCASE) AS next_artist_track_count,
        ROW_NUMBER() OVER (PARTITION BY album_id ORDER BY artist_track_count DESC, artist_name COLLATE NOCASE) AS artist_rank
      FROM remote_album_artist_counts
    ),
    library_albums AS (
      SELECT * FROM local_albums
      UNION ALL
      SELECT
        remote_albums.id,
        remote_albums.media_type,
        remote_albums.source_id,
        remote_albums.source_display_name,
        remote_albums.provider,
        remote_albums.album_key,
        remote_albums.title,
        CASE
          WHEN remote_album_artist_ranked.artist_group_count <= 1 THEN COALESCE(remote_album_artist_ranked.artist_name, remote_albums.album_artist)
          WHEN remote_album_artist_ranked.artist_track_count >= CAST((remote_album_artist_ranked.album_track_count + 1) * 0.65 AS INTEGER)
            AND remote_album_artist_ranked.artist_track_count > remote_album_artist_ranked.next_artist_track_count
          THEN remote_album_artist_ranked.artist_name
          ELSE ${sqlString(variousArtistsDisplayName)}
        END AS album_artist,
        remote_albums.year,
        remote_albums.track_count,
        remote_albums.duration,
        remote_albums.cover_id,
        remote_albums.created_at,
        remote_albums.updated_at,
        remote_albums.sort_mtime_ms,
        remote_albums.search_blob
      FROM remote_albums
      LEFT JOIN remote_album_artist_ranked
        ON remote_album_artist_ranked.album_id = remote_albums.id
       AND remote_album_artist_ranked.artist_rank = 1
    )`;
  }

  private unifiedAlbumOrderSql(sort: string): string {
    switch (sort) {
      case 'artist':
      case 'artistAlbum':
        return 'ORDER BY album_artist COLLATE NOCASE, title COLLATE NOCASE';
      case 'recent':
      case 'createdDesc':
        return 'ORDER BY updated_at DESC, title COLLATE NOCASE';
      case 'createdAsc':
        return 'ORDER BY created_at ASC, title COLLATE NOCASE';
      case 'titleDesc':
        return 'ORDER BY title COLLATE NOCASE DESC, album_artist COLLATE NOCASE';
      case 'durationAsc':
        return 'ORDER BY duration ASC, title COLLATE NOCASE';
      case 'durationDesc':
        return 'ORDER BY duration DESC, title COLLATE NOCASE';
      case 'fileModifiedAsc':
        return 'ORDER BY sort_mtime_ms ASC, title COLLATE NOCASE';
      case 'fileModifiedDesc':
        return 'ORDER BY sort_mtime_ms DESC, title COLLATE NOCASE';
      case 'random':
        return 'ORDER BY RANDOM()';
      case 'album':
      case 'titleAsc':
      case 'default':
      case 'title':
      default:
        return 'ORDER BY title COLLATE NOCASE, album_artist COLLATE NOCASE';
    }
  }

  private remoteArtistIdSql(tableName: string): string {
    return `'remote-artist:' || lower(hex(${tableName}.source_id || char(31) || echo_artist_merge_key(COALESCE(NULLIF(TRIM(${tableName}.artist), ''), 'Unknown Artist'))))`;
  }

  private unifiedArtistsSql(): string {
    const remoteAlbumIdentity = this.remoteAlbumIdentitySql('remote_tracks');

    return `WITH remote_artist_rows AS (
      SELECT
        remote_tracks.*,
        remote_sources.display_name AS source_display_name,
        ${this.remoteArtistIdSql('remote_tracks')} AS artist_id,
        echo_artist_merge_key(COALESCE(NULLIF(TRIM(remote_tracks.artist), ''), 'Unknown Artist')) AS artist_key,
        COALESCE(NULLIF(TRIM(remote_tracks.artist), ''), 'Unknown Artist') AS artist_name,
        'remote-album:' || lower(hex(${remoteAlbumIdentity})) AS album_id
      FROM remote_tracks
      INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
      WHERE remote_tracks.availability != 'missing'
        AND remote_sources.status = 'enabled'
    ),
    local_artists AS (
      SELECT
        artists.id,
        'local' AS media_type,
        NULL AS source_id,
        NULL AS source_display_name,
        NULL AS provider,
        artists.artist_key,
        artists.name,
        artists.sort_name,
        artists.role,
        artists.track_count,
        artists.album_count,
        artists.cover_id,
        covers.source_type AS cover_source,
        artist_image_cache.status AS avatar_status,
        artist_image_cache.provider AS avatar_provider,
        artist_image_cache.source_hash AS avatar_source_hash,
        artist_image_cache.thumb_path AS avatar_thumb_path,
        artist_image_cache.medium_path AS avatar_medium_path,
        artist_image_cache.large_path AS avatar_large_path
      FROM artists
      LEFT JOIN covers ON covers.id = artists.cover_id
      LEFT JOIN artist_image_cache ON artist_image_cache.artist_key = artists.artist_key
    ),
    remote_artists AS (
      SELECT
        remote_artist_rows.artist_id AS id,
        'remote' AS media_type,
        remote_artist_rows.source_id,
        MIN(remote_artist_rows.source_display_name) AS source_display_name,
        remote_artist_rows.provider,
        remote_artist_rows.artist_key,
        MIN(remote_artist_rows.artist_name) AS name,
        remote_artist_rows.artist_key AS sort_name,
        'both' AS role,
        COUNT(*) AS track_count,
        COUNT(DISTINCT remote_artist_rows.album_id) AS album_count,
        MIN(remote_artist_rows.cover_id) AS cover_id,
        NULL AS cover_source,
        artist_image_cache.status AS avatar_status,
        artist_image_cache.provider AS avatar_provider,
        artist_image_cache.source_hash AS avatar_source_hash,
        artist_image_cache.thumb_path AS avatar_thumb_path,
        artist_image_cache.medium_path AS avatar_medium_path,
        artist_image_cache.large_path AS avatar_large_path
      FROM remote_artist_rows
      LEFT JOIN artist_image_cache ON artist_image_cache.artist_key = remote_artist_rows.artist_key
      GROUP BY remote_artist_rows.artist_id, remote_artist_rows.source_id, remote_artist_rows.provider, remote_artist_rows.artist_key
    ),
    library_artists AS (
      SELECT * FROM local_artists
      UNION ALL
      SELECT * FROM remote_artists
    )`;
  }

  private artistAvatarPriorityOrderSql(): string {
    return `CASE
      WHEN avatar_status = 'matched'
        AND (avatar_source_hash = ${sqlString(ARTIST_IMAGE_CACHE_SOURCE_VERSION)}
          OR avatar_source_hash LIKE ${sqlString(`${ARTIST_IMAGE_CACHE_SOURCE_HASH_PREFIX}%`)})
        AND COALESCE(avatar_large_path, avatar_medium_path, avatar_thumb_path) IS NOT NULL
      THEN 0
      ELSE 1
    END`;
  }

  private unifiedArtistOrderSql(sort: string, prioritizeArtistAvatars = false): string {
    const prioritySql = prioritizeArtistAvatars ? `${this.artistAvatarPriorityOrderSql()}, ` : '';

    switch (sort) {
      case 'frequent':
        return `ORDER BY ${prioritySql}track_count DESC, album_count DESC, name COLLATE NOCASE`;
      case 'createdDesc':
      case 'recent':
        return `ORDER BY ${prioritySql}name COLLATE NOCASE`;
      case 'titleDesc':
        return `ORDER BY ${prioritySql}name COLLATE NOCASE DESC`;
      case 'random':
        return `ORDER BY ${prioritySql}RANDOM()`;
      case 'artist':
      case 'artistAlbum':
      case 'titleAsc':
      case 'default':
      case 'title':
      default:
        return `ORDER BY ${prioritySql}sort_name COLLATE NOCASE, name COLLATE NOCASE`;
    }
  }

  getAlbum(albumId: string): LibraryAlbumDetail | null {
    const row = this.getRow(
      `${this.unifiedAlbumsSql()}
      SELECT
        id, media_type, source_id, source_display_name, provider, album_key, title, album_artist, year, track_count,
        duration, cover_id
      FROM library_albums
      WHERE id = ?`,
      albumId,
    );

    return row ? this.mapAlbumDetail(row) : null;
  }

  getAlbumForTrack(trackId: string): LibraryAlbum | null {
    const row = this.getRow(
      `SELECT
        albums.id, albums.album_key, albums.title, albums.album_artist, albums.year, albums.track_count,
        albums.duration, albums.cover_id
       FROM album_tracks
       INNER JOIN albums ON albums.id = album_tracks.album_id
       INNER JOIN tracks ON tracks.id = album_tracks.track_id
       WHERE album_tracks.track_id = ? AND tracks.missing = 0
       ORDER BY album_tracks.position ASC
       LIMIT 1`,
      trackId,
    );

    if (row) {
      return this.mapAlbum(row);
    }

    const remoteRow = this.getRow(
      `${this.unifiedAlbumsSql()}
       SELECT
        library_albums.id, library_albums.media_type, library_albums.source_id, library_albums.source_display_name, library_albums.provider,
        library_albums.album_key, library_albums.title, library_albums.album_artist, library_albums.year,
        library_albums.track_count, library_albums.duration, library_albums.cover_id
       FROM remote_album_rows
       INNER JOIN library_albums ON library_albums.id = remote_album_rows.album_id
       WHERE remote_album_rows.id = ?
       LIMIT 1`,
      trackId,
    );

    return remoteRow ? this.mapAlbum(remoteRow) : null;
  }

  getArtists(query?: LibraryPageQuery): LibraryPage<LibraryArtist> {
    const { page, pageSize, search, sort, sourceProvider, sourceId } = pageFromQuery(query);
    const searchOptions = this.readSearchOptions();
    const offset = (page - 1) * pageSize;
    const mediaTypeFilter = libraryMediaTypeFromSourceProvider(sourceProvider);
    const searchFilter = buildSearchFilter(search, [
      likePredicate('library_artists.name'),
      likePredicate('COALESCE(library_artists.sort_name, \'\')'),
    ], searchOptions);
    const whereParts = [
      searchFilter.sql,
      mediaTypeFilter ? 'library_artists.media_type = ?' : '',
      sourceId ? 'library_artists.source_id = ?' : '',
    ].filter(Boolean);
    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const whereParams = [...searchFilter.params, ...(mediaTypeFilter ? [mediaTypeFilter] : []), ...(sourceId ? [sourceId] : [])];
    const orderSql = this.unifiedArtistOrderSql(sort, query?.prioritizeArtistAvatars === true);
    const artistsSql = this.unifiedArtistsSql();
    const totalRow = this.getRow(`${artistsSql} SELECT COUNT(*) AS total FROM library_artists ${whereSql}`, ...whereParams);
    const rows = this.allRows(
      `${artistsSql}
      SELECT
        id, media_type, source_id, source_display_name, provider, artist_key, name, sort_name, role,
        track_count, album_count, cover_id, cover_source, avatar_status, avatar_provider,
        avatar_source_hash, avatar_thumb_path, avatar_medium_path, avatar_large_path
       FROM library_artists
       ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
      ...whereParams,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);

    return {
      items: rows.map((row) => this.mapArtist(row)),
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  getArtist(artistId: string): LibraryArtist | null {
    const row = this.getRow(
      `${this.unifiedArtistsSql()}
       SELECT
        id, media_type, source_id, source_display_name, provider, artist_key, name, sort_name, role,
        track_count, album_count, cover_id, cover_source, avatar_status, avatar_provider,
        avatar_source_hash, avatar_thumb_path, avatar_medium_path, avatar_large_path
       FROM library_artists
       WHERE id = ?`,
      artistId,
    );

    return row ? this.mapArtist(row) : null;
  }

  getArtistInsights(artistId: string, options: ArtistInsightsOptions = {}): ArtistInsights {
    const artist = this.getArtist(artistId);
    const limit = Math.max(4, Math.min(32, Math.floor(Number(options.limit ?? 12))));
    const generatedAt = new Date().toISOString();

    if (!artist) {
      return {
        artist: null,
        nodes: [],
        edges: [],
        onlineInfo: emptyArtistOnlineInfo('Artist not found.'),
        concerts: {
          status: 'not_configured',
          region: options.region ?? null,
          sources: [],
          events: [],
          fetchedAt: null,
          message: 'Configure artist event providers in Settings to load concerts.',
        },
        generatedAt,
      };
    }

    const relationRows = this.allRows(
      `WITH relation_rows AS (
        SELECT other.artist_id AS target_id, 'same_album' AS kind, COUNT(DISTINCT current.album_id) AS score
        FROM artist_albums current
        INNER JOIN artist_albums other ON other.album_id = current.album_id
        WHERE current.artist_id = ?
          AND other.artist_id != current.artist_id
        GROUP BY other.artist_id
        UNION ALL
        SELECT other.artist_id AS target_id, 'collaboration' AS kind, COUNT(DISTINCT current.track_id) AS score
        FROM artist_tracks current
        INNER JOIN artist_tracks other ON other.track_id = current.track_id
        WHERE current.artist_id = ?
          AND other.artist_id != current.artist_id
        GROUP BY other.artist_id
        UNION ALL
        SELECT artist_tracks.artist_id AS target_id, 'same_genre' AS kind, COUNT(DISTINCT tracks.id) AS score
        FROM artist_tracks
        INNER JOIN tracks ON tracks.id = artist_tracks.track_id
        WHERE artist_tracks.artist_id != ?
          AND tracks.missing = 0
          AND lower(trim(COALESCE(tracks.genre, ''))) IN (
            SELECT DISTINCT lower(trim(COALESCE(current_tracks.genre, '')))
            FROM artist_tracks current_artist_tracks
            INNER JOIN tracks current_tracks ON current_tracks.id = current_artist_tracks.track_id
            WHERE current_artist_tracks.artist_id = ?
              AND current_tracks.missing = 0
              AND trim(COALESCE(current_tracks.genre, '')) != ''
          )
        GROUP BY artist_tracks.artist_id
        UNION ALL
        SELECT artist_bpm.artist_id AS target_id, 'similar_bpm' AS kind, MAX(1, 8 - MIN(ABS(artist_bpm.avg_bpm - current_bpm.avg_bpm))) AS score
        FROM (
          SELECT artist_tracks.artist_id, AVG(tracks.bpm) AS avg_bpm
          FROM artist_tracks
          INNER JOIN tracks ON tracks.id = artist_tracks.track_id
          WHERE tracks.missing = 0
            AND tracks.bpm IS NOT NULL
          GROUP BY artist_tracks.artist_id
        ) artist_bpm
        CROSS JOIN (
          SELECT AVG(tracks.bpm) AS avg_bpm
          FROM artist_tracks
          INNER JOIN tracks ON tracks.id = artist_tracks.track_id
          WHERE artist_tracks.artist_id = ?
            AND tracks.missing = 0
            AND tracks.bpm IS NOT NULL
        ) current_bpm
        WHERE artist_bpm.artist_id != ?
          AND current_bpm.avg_bpm IS NOT NULL
          AND ABS(artist_bpm.avg_bpm - current_bpm.avg_bpm) <= 8
        GROUP BY artist_bpm.artist_id
      )
      SELECT target_id, kind, SUM(score) AS score
      FROM relation_rows
      WHERE target_id IS NOT NULL
      GROUP BY target_id, kind
      ORDER BY SUM(score) DESC, target_id
      LIMIT ?`,
      artist.id,
      artist.id,
      artist.id,
      artist.id,
      artist.id,
      artist.id,
      limit * 4,
    ) as Array<{ target_id: string; kind: ArtistInsightEdge['kind']; score: number }>;

    const nodeScores = new Map<string, number>();
    for (const row of relationRows) {
      nodeScores.set(row.target_id, (nodeScores.get(row.target_id) ?? 0) + Number(row.score ?? 0));
    }

    const targetIds = Array.from(nodeScores.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([targetId]) => targetId);
    const allowedTargets = new Set(targetIds);
    const nodes: ArtistInsightNode[] = [
      this.mapArtistInsightNode(artist, 'local'),
      ...targetIds
        .map((targetId) => this.getArtist(targetId))
        .filter((target): target is LibraryArtist => Boolean(target))
        .map((target) => this.mapArtistInsightNode(target, 'local')),
    ];
    const edges = relationRows
      .filter((row) => allowedTargets.has(row.target_id))
      .map((row): ArtistInsightEdge => ({
        id: `${artist.id}:${row.target_id}:${row.kind}`,
        sourceArtistId: artist.id,
        targetArtistId: row.target_id,
        kind: row.kind,
        weight: Math.max(1, Math.min(10, Number(row.score ?? 1))),
        evidence: this.artistInsightEvidence(row.kind, Number(row.score ?? 1)),
        source: 'local',
      }));

    return {
      artist,
      nodes,
      edges,
      onlineInfo: emptyArtistOnlineInfo(),
      concerts: {
        status: 'not_configured',
        region: options.region ?? null,
        sources: [],
        events: [],
        fetchedAt: null,
        message: 'Configure Bandsintown, Ticketmaster, or SeatGeek keys in Settings to load concerts.',
      },
      generatedAt,
    };
  }

  private mapArtistInsightNode(artist: LibraryArtist, source: ArtistInsightNode['source']): ArtistInsightNode {
    return {
      id: artist.id,
      name: artist.name,
      trackCount: artist.trackCount,
      albumCount: artist.albumCount,
      coverThumb: artist.coverThumb,
      avatarUrl: artist.avatarUrl ?? artist.avatarThumbUrl ?? null,
      source,
    };
  }

  private artistInsightEvidence(kind: ArtistInsightEdge['kind'], score: number): string {
    const count = Math.max(1, Math.round(score));
    switch (kind) {
      case 'same_album':
        return `${count} shared album signal${count === 1 ? '' : 's'}`;
      case 'collaboration':
        return `${count} shared track signal${count === 1 ? '' : 's'}`;
      case 'same_genre':
        return `${count} shared genre signal${count === 1 ? '' : 's'}`;
      case 'similar_bpm':
        return 'Similar average BPM';
      default:
        return `${count} local signal${count === 1 ? '' : 's'}`;
    }
  }

  getArtistTracks(artistId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize' | 'sort'>): LibraryPage<LibraryTrack> {
    const artist = this.getArtist(artistId);
    const { page, pageSize, sort } = pageFromQuery(query);
    const offset = (page - 1) * pageSize;

    if (!artist) {
      return {
        items: [],
        page,
        pageSize,
        total: 0,
        hasMore: false,
      };
    }

    if (artist.mediaType === 'remote') {
      const total = Number(this.getRow(`${this.unifiedArtistsSql()} SELECT COUNT(*) AS total FROM remote_artist_rows WHERE artist_id = ?`, artist.id)?.total ?? 0);
      const rows = this.allRows(
        `${this.unifiedArtistsSql()}
        SELECT
          remote_artist_rows.id,
          'remote' AS media_type,
          'remote://' || remote_artist_rows.source_id || remote_artist_rows.remote_path AS path,
          remote_artist_rows.source_id,
          remote_artist_rows.source_display_name,
          remote_artist_rows.provider,
          remote_artist_rows.remote_path,
          remote_artist_rows.stable_key,
          remote_artist_rows.title,
          remote_artist_rows.artist,
          remote_artist_rows.album,
          remote_artist_rows.album_artist,
          remote_artist_rows.track_no,
          remote_artist_rows.disc_no,
          remote_artist_rows.year,
          remote_artist_rows.genre,
          COALESCE(remote_artist_rows.duration, 0) AS duration,
          remote_artist_rows.codec,
          remote_artist_rows.sample_rate,
          remote_artist_rows.bit_depth,
          remote_artist_rows.bitrate,
          NULL AS bpm,
          NULL AS bpm_confidence,
          NULL AS beat_offset_ms,
          'none' AS analysis_status,
          NULL AS analysis_updated_at,
          remote_artist_rows.cover_id,
          remote_artist_rows.metadata_status,
          'present' AS embedded_metadata_status,
          CASE WHEN remote_artist_rows.cover_id IS NULL THEN 'missing' ELSE 'present' END AS embedded_cover_status,
          'none' AS network_metadata_status,
          remote_artist_rows.field_sources_json,
          remote_artist_rows.availability
        FROM remote_artist_rows
        WHERE remote_artist_rows.artist_id = ?
        ORDER BY remote_artist_rows.album COLLATE NOCASE, COALESCE(remote_artist_rows.disc_no, 0), COALESCE(remote_artist_rows.track_no, 0), remote_artist_rows.title COLLATE NOCASE
        LIMIT ? OFFSET ?`,
        artist.id,
        pageSize,
        offset,
      );

      return {
        items: rows.map((row) => this.mapTrack(row)),
        page,
        pageSize,
        total,
        hasMore: offset + rows.length < total,
      };
    }

    const orderSql = this.artistTrackOrderSql(sort);
    const artistMergeStrategy = normalizeArtistMergeStrategy(this.readSearchOptions().artistMergeStrategy);
    const artistKey = artist.artistKey ?? artistMergeKeyForName(artist.name, artistMergeStrategy);
    const isVariousArtistKey = artistKey === variousArtistsKey || artistKey === artistMergeKeyForName(variousArtistsDisplayName, artistMergeStrategy);
    const trackCreditValueSql = "COALESCE(NULLIF(TRIM(tracks.album_artist), ''), tracks.artist)";
    const trackCreditFilterSql =
      isVariousArtistKey
        ? ''
        : `AND (echo_artist_matches(tracks.artist, ?) OR echo_artist_matches(${trackCreditValueSql}, ?))`;
    const trackCreditParams = isVariousArtistKey ? [] : [artistKey, artistKey];
    const totalRow = this.getRow(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT tracks.id
         FROM artist_tracks
         INNER JOIN tracks ON tracks.id = artist_tracks.track_id
         WHERE artist_tracks.artist_id = ?
           AND tracks.missing = 0
           ${trackCreditFilterSql}
         UNION
         SELECT tracks.id
         FROM artist_albums
         INNER JOIN album_tracks ON album_tracks.album_id = artist_albums.album_id
         INNER JOIN tracks ON tracks.id = album_tracks.track_id
         WHERE artist_albums.artist_id = ?
           AND tracks.missing = 0
           ${trackCreditFilterSql}
       ) AS artist_track_ids`,
      artist.id,
      ...trackCreditParams,
      artist.id,
      ...trackCreditParams,
    );
    const rows = this.allRows(
      `SELECT
        tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
        tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
        tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
        tracks.bpm, tracks.bpm_confidence, tracks.beat_offset_ms, tracks.analysis_status, tracks.analysis_updated_at,
        tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
        tracks.network_metadata_status, tracks.field_sources_json
      FROM (
        SELECT tracks.id
        FROM artist_tracks
        INNER JOIN tracks ON tracks.id = artist_tracks.track_id
        WHERE artist_tracks.artist_id = ?
          AND tracks.missing = 0
          ${trackCreditFilterSql}
        UNION
        SELECT tracks.id
        FROM artist_albums
        INNER JOIN album_tracks ON album_tracks.album_id = artist_albums.album_id
        INNER JOIN tracks ON tracks.id = album_tracks.track_id
        WHERE artist_albums.artist_id = ?
          AND tracks.missing = 0
          ${trackCreditFilterSql}
      ) AS artist_track_ids
      INNER JOIN tracks ON tracks.id = artist_track_ids.id
      WHERE 1 = 1
        AND tracks.missing = 0
      ${orderSql}
      LIMIT ? OFFSET ?`,
      artist.id,
      ...trackCreditParams,
      artist.id,
      ...trackCreditParams,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);

    return {
      items: rows.map((row) => this.mapTrack(row)),
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  getArtistAlbums(artistId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize' | 'sort'>): LibraryPage<LibraryAlbum> {
    const artist = this.getArtist(artistId);
    const { page, pageSize, sort } = pageFromQuery(query);
    const offset = (page - 1) * pageSize;

    if (!artist) {
      return {
        items: [],
        page,
        pageSize,
        total: 0,
        hasMore: false,
      };
    }

    if (artist.mediaType === 'remote') {
      const albumsSql = this.unifiedAlbumsSql();
      const orderSql = this.unifiedAlbumOrderSql(sort);
      const totalRow = this.getRow(
        `${albumsSql}
         SELECT COUNT(*) AS total
         FROM library_albums
         WHERE media_type = 'remote'
           AND id IN (
             SELECT DISTINCT album_id
             FROM remote_album_rows
             WHERE artist_id = ?
           )`,
        artist.id,
      );
      const rows = this.allRows(
        `${albumsSql}
         SELECT
          id, media_type, source_id, source_display_name, provider, album_key, title, album_artist, year, track_count,
          duration, cover_id
         FROM library_albums
         WHERE media_type = 'remote'
           AND id IN (
             SELECT DISTINCT album_id
             FROM remote_album_rows
             WHERE artist_id = ?
           )
         ${orderSql}
         LIMIT ? OFFSET ?`,
        artist.id,
        pageSize,
        offset,
      );
      const total = Number(totalRow?.total ?? 0);

      return {
        items: rows.map((row) => this.mapAlbum(row)),
        page,
        pageSize,
        total,
        hasMore: offset + rows.length < total,
      };
    }

    const orderSql = this.albumOrderSql(sort);
    const artistMergeStrategy = normalizeArtistMergeStrategy(this.readSearchOptions().artistMergeStrategy);
    const artistKey = artist.artistKey ?? artistMergeKeyForName(artist.name, artistMergeStrategy);
    const isVariousArtistKey = artistKey === variousArtistsKey || artistKey === artistMergeKeyForName(variousArtistsDisplayName, artistMergeStrategy);
    const albumCreditValueSql = "COALESCE(NULLIF(TRIM(tracks.album_artist), ''), tracks.artist)";
    const albumCreditFilterSql =
      isVariousArtistKey
        ? ''
        : `AND EXISTS (
            SELECT 1
            FROM album_tracks
            INNER JOIN tracks ON tracks.id = album_tracks.track_id
            WHERE album_tracks.album_id = albums.id
              AND tracks.missing = 0
              AND echo_artist_matches(${albumCreditValueSql}, ?)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM album_tracks
            INNER JOIN tracks ON tracks.id = album_tracks.track_id
            WHERE album_tracks.album_id = albums.id
              AND tracks.missing = 0
              AND NOT echo_artist_matches(${albumCreditValueSql}, ?)
          )`;
    const albumCreditParams = isVariousArtistKey ? [] : [artistKey, artistKey];
    const totalRow = this.getRow(
      `SELECT COUNT(*) AS total
       FROM artist_albums
       INNER JOIN albums ON albums.id = artist_albums.album_id
       WHERE artist_albums.artist_id = ?
         ${albumCreditFilterSql}`,
      artist.id,
      ...albumCreditParams,
    );
    const rows = this.allRows(
      `SELECT
        albums.id, albums.album_key, albums.title, albums.album_artist, albums.year, albums.track_count,
        albums.duration, albums.cover_id
      FROM artist_albums
      INNER JOIN albums ON albums.id = artist_albums.album_id
      WHERE artist_albums.artist_id = ?
      ${albumCreditFilterSql}
      ${orderSql}
      LIMIT ? OFFSET ?`,
      artist.id,
      ...albumCreditParams,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);

    return {
      items: rows.map((row) => this.mapAlbum(row)),
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  getAlbumTracks(albumId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize'>): LibraryPage<LibraryTrack> {
    const { page, pageSize } = pageFromQuery(query);
    const offset = (page - 1) * pageSize;
    if (albumId.startsWith('remote-album:')) {
      const total = Number(this.getRow(`${this.unifiedAlbumsSql()} SELECT COUNT(*) AS total FROM remote_album_rows WHERE album_id = ?`, albumId)?.total ?? 0);
      const rows = this.allRows(
        `${this.unifiedAlbumsSql()}
        SELECT
          remote_album_rows.id,
          'remote' AS media_type,
          'remote://' || remote_album_rows.source_id || remote_album_rows.remote_path AS path,
          remote_album_rows.source_id,
          remote_album_rows.source_display_name,
          remote_album_rows.provider,
          remote_album_rows.remote_path,
          remote_album_rows.stable_key,
          remote_album_rows.title,
          remote_album_rows.artist,
          remote_album_rows.album,
          remote_album_rows.album_artist,
          remote_album_rows.track_no,
          remote_album_rows.disc_no,
          remote_album_rows.year,
          remote_album_rows.genre,
          COALESCE(remote_album_rows.duration, 0) AS duration,
          remote_album_rows.codec,
          remote_album_rows.sample_rate,
          remote_album_rows.bit_depth,
          remote_album_rows.bitrate,
          NULL AS bpm,
          NULL AS bpm_confidence,
          NULL AS beat_offset_ms,
          'none' AS analysis_status,
          NULL AS analysis_updated_at,
          remote_album_rows.cover_id,
          remote_album_rows.metadata_status,
          'present' AS embedded_metadata_status,
          CASE WHEN remote_album_rows.cover_id IS NULL THEN 'missing' ELSE 'present' END AS embedded_cover_status,
          'none' AS network_metadata_status,
          remote_album_rows.field_sources_json,
          remote_album_rows.availability
        FROM remote_album_rows
        WHERE remote_album_rows.album_id = ?
        ORDER BY
          COALESCE(remote_album_rows.disc_no, 1),
          CASE WHEN remote_album_rows.track_no IS NULL THEN 1 ELSE 0 END,
          remote_album_rows.track_no,
          remote_album_rows.title COLLATE NOCASE
        LIMIT ? OFFSET ?`,
        albumId,
        pageSize,
        offset,
      );

      return {
        items: rows.map((row) => this.mapTrack(row)),
        page,
        pageSize,
        total,
        hasMore: offset + rows.length < total,
      };
    }

    const totalRow = this.getRow(
      `SELECT COUNT(*) AS total
       FROM album_tracks
       INNER JOIN tracks ON tracks.id = album_tracks.track_id
       WHERE album_tracks.album_id = ? AND tracks.missing = 0`,
      albumId,
    );
    const rows = this.allRows(
      `SELECT
        tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
        tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
        tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
        tracks.bpm, tracks.bpm_confidence, tracks.beat_offset_ms, tracks.analysis_status, tracks.analysis_updated_at,
        tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
        tracks.network_metadata_status, tracks.field_sources_json
      FROM album_tracks
      INNER JOIN tracks ON tracks.id = album_tracks.track_id
      WHERE album_tracks.album_id = ? AND tracks.missing = 0
      ORDER BY
        COALESCE(album_tracks.disc_no, tracks.disc_no, 1),
        CASE WHEN COALESCE(album_tracks.track_no, tracks.track_no) IS NULL THEN 1 ELSE 0 END,
        COALESCE(album_tracks.track_no, tracks.track_no),
        tracks.title COLLATE NOCASE,
        album_tracks.position ASC
      LIMIT ? OFFSET ?`,
      albumId,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);

    return {
      items: rows.map((row) => this.mapTrack(row)),
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  getPlaylists(): LibraryPlaylist[] {
    return this.allRows(
      `SELECT *
       FROM playlists
       WHERE NOT (kind = 'system' AND source_provider = 'local' AND source_playlist_id IN (?, ?))
       ORDER BY updated_at DESC, name COLLATE NOCASE`,
      likedSongsSourcePlaylistId,
      likedAlbumsSourcePlaylistId,
    ).map((row) => this.mapPlaylist(row));
  }

  getLikedSongsPlaylist(): LibraryPlaylist {
    return this.ensureSystemPlaylist(likedSongsSourcePlaylistId, 'Liked Songs', 'Tracks you liked in ECHO Next.');
  }

  getLikedAlbumsPlaylist(): LibraryPlaylist {
    return this.ensureSystemPlaylist(likedAlbumsSourcePlaylistId, 'Liked Albums', 'Albums you liked in ECHO Next.');
  }

  createPlaylist(input: { name: string; description?: string | null }, timestamp = nowIso()): LibraryPlaylist {
    const id = randomUUID();
    const name = input.name.trim();
    const description = textOrNull(input.description?.trim());

    if (!name) {
      throw new Error('Playlist name is required');
    }

    this.run(
      `INSERT INTO playlists (
        id, name, description, kind, source_provider, source_playlist_id,
        cover_id, sort_mode, item_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      name,
      description,
      'manual',
      'local',
      null,
      null,
      'manual',
      0,
      timestamp,
      timestamp,
    );

    const playlist = this.getPlaylist(id);
    if (!playlist) {
      throw new Error(`Failed to create playlist ${id}`);
    }

    return playlist;
  }

  updatePlaylist(
    input: { playlistId: string; name?: string; description?: string | null; coverId?: string | null; sortMode?: string },
    timestamp = nowIso(),
  ): LibraryPlaylist {
    const current = this.getPlaylist(input.playlistId);
    if (!current) {
      throw new Error(`Unknown playlist ${input.playlistId}`);
    }

    if (this.isProtectedSystemPlaylist(current) && (input.name !== undefined || input.description !== undefined)) {
      throw new Error('System playlists cannot be renamed.');
    }

    const name = input.name === undefined ? current.name : input.name.trim();
    if (!name) {
      throw new Error('Playlist name is required');
    }

    const sortMode = input.sortMode ?? current.sortMode;
    if (!['manual', 'titleAsc', 'titleDesc', 'artistAsc', 'addedDesc'].includes(sortMode)) {
      throw new Error(`Unsupported playlist sort mode ${sortMode}`);
    }

    this.run(
      `UPDATE playlists SET
        name = ?,
        description = ?,
        cover_id = ?,
        sort_mode = ?,
        updated_at = ?
       WHERE id = ?`,
      name,
      input.description === undefined ? current.description : textOrNull(input.description?.trim()),
      input.coverId === undefined ? current.coverId : textOrNull(input.coverId),
      sortMode,
      timestamp,
      input.playlistId,
    );

    const updated = this.getPlaylist(input.playlistId);
    if (!updated) {
      throw new Error(`Unknown playlist ${input.playlistId}`);
    }

    return updated;
  }

  deletePlaylist(playlistId: string): void {
    const playlist = this.getPlaylist(playlistId);
    if (playlist && this.isProtectedSystemPlaylist(playlist)) {
      throw new Error('System playlists cannot be deleted.');
    }

    this.run('DELETE FROM playlists WHERE id = ?', playlistId);
  }

  getPlaylist(playlistId: string): LibraryPlaylist | null {
    const row = this.getRow('SELECT * FROM playlists WHERE id = ?', playlistId);
    return row ? this.mapPlaylist(row) : null;
  }

  getPlaylistItems(playlistId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize' | 'search'>): LibraryPage<LibraryPlaylistItem> {
    const { page, pageSize, search } = pageFromQuery(query);
    const searchOptions = this.readSearchOptions();
    const offset = (page - 1) * pageSize;
    const searchFilter = buildSearchFilter(search, [
      likePredicate('COALESCE(playlist_items.title_snapshot, tracks.title, \'\')'),
      likePredicate('COALESCE(playlist_items.artist_snapshot, tracks.artist, \'\')'),
      likePredicate('COALESCE(playlist_items.album_snapshot, tracks.album, \'\')'),
    ], searchOptions);
    const whereSql = searchFilter.sql ? `playlist_items.playlist_id = ? AND ${searchFilter.sql}` : 'playlist_items.playlist_id = ?';
    const params = [playlistId, ...searchFilter.params];
    const playlist = this.getPlaylist(playlistId);
    const orderSql = this.playlistItemsOrderSql(playlist?.sortMode ?? 'manual');
    const totalRow = this.getRow(
      `SELECT COUNT(*) AS total
       FROM playlist_items
       LEFT JOIN tracks ON tracks.id = playlist_items.media_id
       LEFT JOIN albums ON albums.id = playlist_items.media_id
       WHERE ${whereSql}`,
      ...params,
    );
    const rows = this.allRows(
      `SELECT
        playlist_items.*,
        playlists.source_playlist_id AS playlist_source_playlist_id,
        tracks.id AS track_id,
        tracks.path AS track_path,
        tracks.title AS track_title,
        tracks.artist AS track_artist,
        tracks.album AS track_album,
        tracks.album_artist AS track_album_artist,
        tracks.track_no AS track_track_no,
        tracks.disc_no AS track_disc_no,
        tracks.year AS track_year,
        tracks.genre AS track_genre,
        tracks.duration AS track_duration,
        tracks.codec AS track_codec,
        tracks.sample_rate AS track_sample_rate,
        tracks.bit_depth AS track_bit_depth,
        tracks.bitrate AS track_bitrate,
        tracks.bpm AS track_bpm,
        tracks.bpm_confidence AS track_bpm_confidence,
        tracks.beat_offset_ms AS track_beat_offset_ms,
        tracks.analysis_status AS track_analysis_status,
        tracks.analysis_updated_at AS track_analysis_updated_at,
        tracks.cover_id AS track_cover_id,
        tracks.metadata_status AS track_metadata_status,
        tracks.embedded_metadata_status AS track_embedded_metadata_status,
        tracks.embedded_cover_status AS track_embedded_cover_status,
        tracks.network_metadata_status AS track_network_metadata_status,
        tracks.field_sources_json AS track_field_sources_json,
        tracks.missing AS track_missing,
        streaming_tracks.cover_url AS streaming_cover_url,
        streaming_tracks.raw_json AS streaming_raw_json,
        streaming_tracks.id AS streaming_track_id,
        streaming_tracks.stable_key AS streaming_stable_key,
        streaming_tracks.title AS streaming_title,
        streaming_tracks.artist AS streaming_artist,
        streaming_tracks.album AS streaming_album,
        streaming_tracks.album_artist AS streaming_album_artist,
        streaming_tracks.duration AS streaming_duration,
        streaming_tracks.playable AS streaming_playable,
        albums.id AS album_id,
        albums.album_key AS album_key,
        albums.title AS album_title,
        albums.album_artist AS album_artist,
        albums.year AS album_year,
        albums.track_count AS album_track_count,
        albums.duration AS album_duration,
        albums.cover_id AS album_cover_id
      FROM playlist_items
      LEFT JOIN playlists ON playlists.id = playlist_items.playlist_id
      LEFT JOIN tracks ON tracks.id = playlist_items.media_id
      LEFT JOIN streaming_tracks
        ON streaming_tracks.provider = playlist_items.source_provider
       AND streaming_tracks.provider_track_id = playlist_items.source_item_id
      LEFT JOIN albums ON albums.id = playlist_items.media_id
      WHERE ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);

    return {
      items: rows.map((row) => this.mapPlaylistItem(row)),
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  getPlaylistItem(itemId: string): LibraryPlaylistItem | null {
    const row = this.getPlaylistItemRow(itemId);
    return row ? this.mapPlaylistItem(row) : null;
  }

  addTrackToPlaylist(playlistId: string, trackId: string, timestamp = nowIso()): LibraryPlaylistItem {
    const [item] = this.addTracksToPlaylist(playlistId, [trackId], timestamp);
    if (!item) {
      throw new Error(`Failed to add track ${trackId} to playlist ${playlistId}`);
    }

    return item;
  }

  addStreamingTrackToPlaylist(
    playlistId: string,
    track: Pick<LibraryTrack, 'id' | 'provider' | 'providerTrackId' | 'stableKey' | 'title' | 'artist' | 'album' | 'duration' | 'unavailable'>,
    timestamp = nowIso(),
  ): LibraryPlaylistItem {
    return this.transaction(() => {
      const playlist = this.getPlaylist(playlistId);
      if (!playlist) {
        throw new Error(`Unknown playlist ${playlistId}`);
      }

      const provider = textOrNull(track.provider);
      const providerTrackId = textOrNull(track.providerTrackId);
      if (!provider || !providerTrackId) {
        throw new Error('Streaming track provider and providerTrackId are required');
      }

      if (playlist.sourceProvider === 'local' || playlist.kind === 'manual' || playlist.sourceProvider !== provider) {
        throw new Error('Streaming tracks cannot be added to local or unrelated playlists. Manage them inside their source streaming playlist.');
      }

      const itemId = randomUUID();
      const nextPosition = Number(this.getRow('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM playlist_items WHERE playlist_id = ?', playlistId)?.next_position ?? 0);
      this.run(
        `INSERT INTO playlist_items (
          id, playlist_id, media_type, media_id, source_provider, source_item_id,
          title_snapshot, artist_snapshot, album_snapshot, duration_snapshot,
          cover_id, position, added_at, added_from, unavailable
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        itemId,
        playlistId,
        'stream_track',
        textOrNull(track.stableKey) ?? textOrNull(track.id) ?? `streaming:${provider}:${providerTrackId}`,
        provider,
        providerTrackId,
        track.title,
        track.artist,
        track.album,
        Number.isFinite(track.duration) ? track.duration : null,
        null,
        nextPosition,
        timestamp,
        'streaming',
        track.unavailable ? 1 : 0,
      );

      this.refreshPlaylistItemCount(playlistId, timestamp);
      const itemRow = this.getPlaylistItemRow(itemId);
      const item = itemRow ? this.mapPlaylistItem(itemRow) : null;
      if (!item) {
        throw new Error(`Failed to add streaming track ${providerTrackId} to playlist ${playlistId}`);
      }

      return item;
    });
  }

  linkStreamingPlaylistItemsToLocalTrack(input: {
    provider: string;
    providerTrackId: string;
    stableKey?: string | null;
    trackId: string;
  }, timestamp = nowIso()): number {
    const provider = textOrNull(input.provider);
    const providerTrackId = textOrNull(input.providerTrackId);
    const track = this.getTrack(input.trackId);
    if (!provider || !providerTrackId || !track) {
      return 0;
    }

    return this.transaction(() => {
      const rows = this.allRows(
        `SELECT id, playlist_id
         FROM playlist_items
         WHERE media_type = 'stream_track'
           AND source_provider = ?
           AND source_item_id = ?`,
        provider,
        providerTrackId,
      );

      for (const row of rows) {
        this.run(
          `UPDATE playlist_items SET
            media_type = 'track',
            media_id = ?,
            source_provider = 'local',
            source_item_id = ?,
            cover_id = COALESCE(cover_id, ?),
            unavailable = 0,
            added_from = ?
           WHERE id = ?`,
          track.id,
          track.path,
          track.coverId,
          streamingDownloadAddedFrom(provider, providerTrackId),
          row.id,
        );
        this.run('UPDATE playlists SET updated_at = ? WHERE id = ?', timestamp, row.playlist_id);
      }

      return rows.length;
    });
  }

  addTracksToPlaylist(playlistId: string, trackIds: string[], timestamp = nowIso()): LibraryPlaylistItem[] {
    return this.transaction(() => {
      const playlist = this.getPlaylist(playlistId);
      if (!playlist) {
        throw new Error(`Unknown playlist ${playlistId}`);
      }

      if (playlist.sourceProvider !== 'local') {
        throw new Error('Local tracks cannot be added to streaming playlists. Keep local and streaming playlists separate.');
      }

      const items: LibraryPlaylistItem[] = [];
      let nextPosition = Number(this.getRow('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM playlist_items WHERE playlist_id = ?', playlistId)?.next_position ?? 0);

      for (const trackId of trackIds) {
        const track = this.getTrack(trackId);
        if (!track) {
          throw new Error(`Unknown track ${trackId}`);
        }

        const itemId = randomUUID();
        this.run(
          `INSERT INTO playlist_items (
            id, playlist_id, media_type, media_id, source_provider, source_item_id,
            title_snapshot, artist_snapshot, album_snapshot, duration_snapshot,
            cover_id, position, added_at, added_from, unavailable
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          itemId,
          playlistId,
          'track',
          track.id,
          'local',
          track.path,
          track.title,
          track.artist,
          track.album,
          track.duration,
          track.coverId,
          nextPosition,
          timestamp,
          'library',
          0,
        );
        nextPosition += 1;

        const itemRow = this.getPlaylistItemRow(itemId);
        const item = itemRow ? this.mapPlaylistItem(itemRow) : null;
        if (item) {
          items.push(item);
        }
      }

      this.refreshPlaylistItemCount(playlistId, timestamp);
      return items;
    });
  }

  removePlaylistItem(itemId: string): void {
    this.transaction(() => {
      const row = this.getRow('SELECT playlist_id FROM playlist_items WHERE id = ?', itemId);
      if (!row) {
        return;
      }

      const playlistId = String(row.playlist_id);
      this.run('DELETE FROM playlist_items WHERE id = ?', itemId);
      this.resequencePlaylistItems(playlistId);
      this.refreshPlaylistItemCount(playlistId);
    });
  }

  movePlaylistItem(playlistId: string, itemId: string, targetPosition: number): void {
    this.transaction(() => {
      const rows = this.allRows('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC, added_at ASC', playlistId);
      const fromIndex = rows.findIndex((row) => row.id === itemId);
      if (fromIndex < 0) {
        throw new Error(`Unknown playlist item ${itemId}`);
      }

      const next = [...rows];
      const [moved] = next.splice(fromIndex, 1);
      const insertIndex = Math.max(0, Math.min(Math.floor(targetPosition), next.length));
      next.splice(insertIndex, 0, moved);
      next.forEach((row, index) => {
        this.run('UPDATE playlist_items SET position = ? WHERE id = ?', index, row.id);
      });
      this.run('UPDATE playlists SET updated_at = ? WHERE id = ?', nowIso(), playlistId);
    });
  }

  clearPlaylist(playlistId: string, sourceProvider?: LibraryPageQuery['sourceProvider']): void {
    this.transaction(() => {
      if (sourceProvider) {
        this.run('DELETE FROM playlist_items WHERE playlist_id = ? AND source_provider = ?', playlistId, sourceProvider);
      } else {
        this.run('DELETE FROM playlist_items WHERE playlist_id = ?', playlistId);
      }
      this.refreshPlaylistItemCount(playlistId);
    });
  }

  getLikedTracks(query?: LibraryPageQuery): LibraryPage<LibraryPlaylistItem> {
    return this.getSystemPlaylistItems(this.getLikedSongsPlaylist().id, ['track', 'stream_track'], query);
  }

  getLikedAlbums(query?: LibraryPageQuery): LibraryPage<LibraryPlaylistItem> {
    return this.getSystemPlaylistItems(this.getLikedAlbumsPlaylist().id, 'album', query);
  }

  isTrackLiked(trackId: string): boolean {
    return this.getLikedTrackIds([trackId])[trackId] === true;
  }

  isAlbumLiked(albumId: string): boolean {
    return this.getLikedAlbumIds([albumId])[albumId] === true;
  }

  getLikedTrackIds(trackIds: string[]): Record<string, boolean> {
    const playlist = this.getLikedSongsPlaylist();
    const localMatches = this.getLikedMediaIds(playlist.id, 'track', trackIds);
    const streamingMatches = this.getLikedMediaIds(playlist.id, 'stream_track', trackIds);
    return Object.fromEntries(trackIds.map((trackId) => [trackId, localMatches[trackId] === true || streamingMatches[trackId] === true]));
  }

  getLikedAlbumIds(albumIds: string[]): Record<string, boolean> {
    return this.getLikedMediaIds(this.getLikedAlbumsPlaylist().id, 'album', albumIds);
  }

  likeTrack(trackId: string, timestamp = nowIso()): LibraryPlaylistItem {
    const track = this.getTrack(trackId);
    if (!track) {
      throw new Error(`Unknown track ${trackId}`);
    }

    return this.transaction(() => {
      const playlist = this.getLikedSongsPlaylist();
      const existing = this.getLikedMediaItem(playlist.id, 'track', track.id);
      if (existing) {
        return existing;
      }

      const itemId = randomUUID();
      const nextPosition = Number(
        this.getRow('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM playlist_items WHERE playlist_id = ?', playlist.id)
          ?.next_position ?? 0,
      );

      this.run(
        `INSERT INTO playlist_items (
          id, playlist_id, media_type, media_id, source_provider, source_item_id,
          title_snapshot, artist_snapshot, album_snapshot, duration_snapshot,
          cover_id, position, added_at, added_from, unavailable
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        itemId,
        playlist.id,
        'track',
        track.id,
        'local',
        null,
        track.title,
        track.artist,
        track.album,
        track.duration,
        track.coverId,
        nextPosition,
        timestamp,
        'liked',
        0,
      );
      this.refreshPlaylistItemCount(playlist.id, timestamp);

      const item = this.getPlaylistItemRow(itemId);
      if (!item) {
        throw new Error(`Failed to like track ${trackId}`);
      }

      return this.mapPlaylistItem(item);
    });
  }

  likeRemoteTrack(track: LibraryTrack, timestamp = nowIso()): LibraryPlaylistItem {
    return this.transaction(() => {
      const playlist = this.getLikedSongsPlaylist();
      const existing = this.getLikedMediaItem(playlist.id, 'track', track.id);
      if (existing) {
        return existing;
      }

      const itemId = randomUUID();
      const nextPosition = Number(
        this.getRow('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM playlist_items WHERE playlist_id = ?', playlist.id)
          ?.next_position ?? 0,
      );

      this.run(
        `INSERT INTO playlist_items (
          id, playlist_id, media_type, media_id, source_provider, source_item_id,
          title_snapshot, artist_snapshot, album_snapshot, duration_snapshot,
          cover_id, position, added_at, added_from, unavailable
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        itemId,
        playlist.id,
        'track',
        track.id,
        'remote',
        track.stableKey ?? track.remotePath ?? track.id,
        track.title,
        track.artist,
        track.album,
        track.duration,
        track.coverId,
        nextPosition,
        timestamp,
        'liked',
        track.unavailable ? 1 : 0,
      );
      this.refreshPlaylistItemCount(playlist.id, timestamp);

      const item = this.getPlaylistItemRow(itemId);
      if (!item) {
        throw new Error(`Failed to like remote track ${track.id}`);
      }

      return this.mapPlaylistItem(item);
    });
  }

  unlikeTrack(trackId: string): void {
    const playlistId = this.getLikedSongsPlaylist().id;
    this.unlikeMedia(playlistId, 'track', trackId);
    this.unlikeMedia(playlistId, 'stream_track', trackId);
  }

  toggleTrackLiked(trackId: string): { liked: boolean; item?: LibraryPlaylistItem } {
    if (this.isTrackLiked(trackId)) {
      this.unlikeTrack(trackId);
      return { liked: false };
    }

    return { liked: true, item: this.likeTrack(trackId) };
  }

  clearLikedTracks(sourceProvider?: LibraryPageQuery['sourceProvider']): void {
    this.clearPlaylist(this.getLikedSongsPlaylist().id, sourceProvider);
  }

  likeAlbum(albumId: string, timestamp = nowIso()): LibraryPlaylistItem {
    const album = this.getAlbum(albumId);
    if (!album) {
      throw new Error(`Unknown album ${albumId}`);
    }

    return this.transaction(() => {
      const playlist = this.getLikedAlbumsPlaylist();
      const existing = this.getLikedMediaItem(playlist.id, 'album', album.id);
      if (existing) {
        return existing;
      }

      const itemId = randomUUID();
      const nextPosition = Number(
        this.getRow('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM playlist_items WHERE playlist_id = ?', playlist.id)
          ?.next_position ?? 0,
      );

      this.run(
        `INSERT INTO playlist_items (
          id, playlist_id, media_type, media_id, source_provider, source_item_id,
          title_snapshot, artist_snapshot, album_snapshot, duration_snapshot,
          cover_id, position, added_at, added_from, unavailable
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        itemId,
        playlist.id,
        'album',
        album.id,
        'local',
        null,
        album.title,
        album.albumArtist,
        album.title,
        album.duration,
        album.coverId,
        nextPosition,
        timestamp,
        'liked',
        0,
      );
      this.refreshPlaylistItemCount(playlist.id, timestamp);

      const item = this.getPlaylistItemRow(itemId);
      if (!item) {
        throw new Error(`Failed to like album ${albumId}`);
      }

      return this.mapPlaylistItem(item);
    });
  }

  unlikeAlbum(albumId: string): void {
    this.unlikeMedia(this.getLikedAlbumsPlaylist().id, 'album', albumId);
  }

  toggleAlbumLiked(albumId: string): { liked: boolean; item?: LibraryPlaylistItem } {
    if (this.isAlbumLiked(albumId)) {
      this.unlikeAlbum(albumId);
      return { liked: false };
    }

    return { liked: true, item: this.likeAlbum(albumId) };
  }

  clearLikedAlbums(sourceProvider?: LibraryPageQuery['sourceProvider']): void {
    this.clearPlaylist(this.getLikedAlbumsPlaylist().id, sourceProvider);
  }

  getSummary(): LibrarySummary {
    const songCount = Number(this.getRow('SELECT COUNT(*) AS total FROM tracks WHERE missing = 0')?.total ?? 0);
    const albumCount = Number(this.getRow('SELECT COUNT(*) AS total FROM albums')?.total ?? 0);
    const artistCount = Number(this.getRow('SELECT COUNT(*) AS total FROM artists')?.total ?? 0);
    const folderCount = Number(
      this.getRow("SELECT COUNT(*) AS total FROM folders WHERE enabled = 1 AND status != 'removed'")?.total ?? 0,
    );
    const duration = Number(this.getRow('SELECT COALESCE(SUM(duration), 0) AS total FROM tracks WHERE missing = 0')?.total ?? 0);
    const scanRow = this.getRow("SELECT finished_at FROM scan_jobs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1");

    return {
      songCount,
      albumCount,
      artistCount,
      folderCount,
      totalDuration: duration,
      lastScanAt: textOrNull(scanRow?.finished_at),
    };
  }

  getDiagnostics(paths: {
    databasePath: string | null;
    databaseSizeBytes: number | null;
    coverCachePath: string | null;
    coverCacheSizeBytes: number | null;
    cpuCount: number;
    scanPerformanceMode: LibraryDiagnostics['scanPerformanceMode'];
    metadataConcurrency: number;
    coverConcurrency: number;
    audioAnalysisEnabled?: boolean;
  }): LibraryDiagnostics {
    const lastScanRow = this.getRow(
      `SELECT status, phase, discovered_count, parsed_count, skipped_count, cover_count, error_count, started_at, finished_at
       FROM scan_jobs
       ORDER BY COALESCE(finished_at, started_at, updated_at) DESC
       LIMIT 1`,
    );

    return {
      foldersCount: Number(
        this.getRow("SELECT COUNT(*) AS total FROM folders WHERE enabled = 1 AND status != 'removed'")?.total ?? 0,
      ),
      tracksCount: Number(this.getRow('SELECT COUNT(*) AS total FROM tracks WHERE missing = 0')?.total ?? 0),
      albumsCount: Number(this.getRow('SELECT COUNT(*) AS total FROM albums')?.total ?? 0),
      artistsCount: Number(this.getRow('SELECT COUNT(*) AS total FROM artists')?.total ?? 0),
      coversCount: Number(this.getRow('SELECT COUNT(*) AS total FROM covers')?.total ?? 0),
      tracksWithFileIdentity: Number(
        this.getRow("SELECT COUNT(*) AS total FROM tracks WHERE missing = 0 AND file_identity IS NOT NULL")?.total ?? 0,
      ),
      tracksWithQuickHash: Number(
        this.getRow("SELECT COUNT(*) AS total FROM tracks WHERE missing = 0 AND quick_hash IS NOT NULL")?.total ?? 0,
      ),
      tracksIdentityUnsupported: Number(
        this.getRow("SELECT COUNT(*) AS total FROM tracks WHERE missing = 0 AND identity_status IN ('unsupported', 'partial')")?.total ?? 0,
      ),
      tracksIdentityError: Number(
        this.getRow("SELECT COUNT(*) AS total FROM tracks WHERE missing = 0 AND identity_status = 'error'")?.total ?? 0,
      ),
      lastScan: lastScanRow
        ? {
            status: this.mapScanStatus(lastScanRow.status),
            phase: this.mapScanPhase(lastScanRow.phase),
            discoveredCount: Number(lastScanRow.discovered_count ?? 0),
            parsedCount: Number(lastScanRow.parsed_count ?? 0),
            skippedCount: Number(lastScanRow.skipped_count ?? 0),
            coverCount: Number(lastScanRow.cover_count ?? 0),
            errorCount: Number(lastScanRow.error_count ?? 0),
            startedAt: textOrNull(lastScanRow.started_at),
            finishedAt: textOrNull(lastScanRow.finished_at),
          }
        : null,
      lastQueryMs: {
        getTracks: this.lastTracksQueryMs,
        getAlbums: this.lastAlbumsQueryMs,
      },
      averageAlbumPayloadBytes: this.getAverageAlbumPayloadBytes(),
      coverCacheVersion: currentCoverCacheVersion,
      ...paths,
    };
  }

  private requireFolder(folderId: string): LibraryFolder {
    const folder = this.getFolder(folderId);

    if (!folder) {
      throw new Error(`Unknown library folder ${folderId}`);
    }

    return folder;
  }

  private resolveFolderScopedPath(folder: LibraryFolder, requestedPath?: string): string {
    const rootPath = stripTrailingPathSeparators(folder.path);
    const targetPath = stripTrailingPathSeparators(requestedPath?.trim() || rootPath);

    if (!isPathInsideOrEqual(rootPath, targetPath)) {
      throw new Error(`Folder path is outside the library root: ${targetPath}`);
    }

    return targetPath;
  }

  private folderTrackScope(
    folderId: string,
    folderPath: string,
    recursive: boolean,
  ): { sql: string; params: unknown[] } {
    const prefix = `${stripTrailingPathSeparators(folderPath)}${preferredPathSeparator}`;
    const prefixLike = likePrefix(prefix);

    if (recursive) {
      return {
        sql: "tracks.folder_id = ? AND tracks.missing = 0 AND tracks.path LIKE ? ESCAPE '\\'",
        params: [folderId, prefixLike],
      };
    }

    return {
      sql: `tracks.folder_id = ?
        AND tracks.missing = 0
        AND tracks.path LIKE ? ESCAPE '\\'
        AND INSTR(SUBSTR(tracks.path, ?), ?) = 0
        AND INSTR(SUBSTR(tracks.path, ?), ?) = 0`,
      params: [folderId, prefixLike, prefix.length + 1, '\\', prefix.length + 1, '/'],
    };
  }

  private getFolderCoverThumbs(folderId: string, folderPath: string, recursive: boolean): string[] {
    const scope = this.folderTrackScope(folderId, folderPath, recursive);
    return this.allRows(
      `SELECT DISTINCT tracks.cover_id
       FROM tracks
       WHERE ${scope.sql} AND tracks.cover_id IS NOT NULL
       ORDER BY tracks.updated_at DESC
       LIMIT 4`,
      ...scope.params,
    )
      .map((row) => this.toCoverUrl(row.cover_id, 'thumb'))
      .filter((value): value is string => Boolean(value));
  }

  private getDirectChildFolderCount(folderId: string, folderPath: string): number {
    const prefix = `${stripTrailingPathSeparators(folderPath)}${preferredPathSeparator}`;
    const childNames = new Set<string>();
    const rows = this.allRows(
      `SELECT path
       FROM tracks
       WHERE folder_id = ? AND missing = 0 AND path LIKE ? ESCAPE '\\'`,
      folderId,
      likePrefix(prefix),
    );

    for (const row of rows) {
      const parts = String(row.path).slice(prefix.length).split(pathSeparatorPattern).filter(Boolean);
      if (parts.length > 1) {
        childNames.add(parts[0]);
      }
    }

    return childNames.size;
  }

  private ensureSystemPlaylist(sourcePlaylistId: string, name: string, description: string): LibraryPlaylist {
    return this.transaction(() => {
      const existing = this.getRow(
        `SELECT *
         FROM playlists
         WHERE kind = 'system' AND source_provider = 'local' AND source_playlist_id = ?`,
        sourcePlaylistId,
      );

      if (existing) {
        const playlistId = String(existing.id);
        const actualCount = Number(this.getRow('SELECT COUNT(*) AS total FROM playlist_items WHERE playlist_id = ?', playlistId)?.total ?? 0);
        if (Number(existing.item_count ?? 0) !== actualCount) {
          this.run('UPDATE playlists SET item_count = ? WHERE id = ?', actualCount, playlistId);
        }
        const playlist = this.getPlaylist(String(existing.id));
        if (!playlist) {
          throw new Error(`Failed to load system playlist ${sourcePlaylistId}`);
        }
        return playlist;
      }

      const id = randomUUID();
      const timestamp = nowIso();
      this.run(
        `INSERT INTO playlists (
          id, name, description, kind, source_provider, source_playlist_id,
          cover_id, sort_mode, item_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        name,
        description,
        'system',
        'local',
        sourcePlaylistId,
        null,
        'manual',
        0,
        timestamp,
        timestamp,
      );

      const playlist = this.getPlaylist(id);
      if (!playlist) {
        throw new Error(`Failed to create system playlist ${sourcePlaylistId}`);
      }
      return playlist;
    });
  }

  private isProtectedSystemPlaylist(playlist: LibraryPlaylist): boolean {
    return playlist.kind === 'system' && protectedSystemPlaylistIds.has(playlist.sourcePlaylistId ?? '');
  }

  private getLikedMediaIds(
    playlistId: string,
    mediaType: LibraryPlaylistItem['mediaType'],
    mediaIds: string[],
  ): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    const uniqueIds = Array.from(new Set(mediaIds.filter((id) => typeof id === 'string' && id.length > 0)));

    for (const id of uniqueIds) {
      result[id] = false;
    }

    if (uniqueIds.length === 0) {
      return result;
    }

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = this.allRows(
      `SELECT media_id
       FROM playlist_items
       WHERE playlist_id = ?
         AND media_type = ?
         AND media_id IN (${placeholders})`,
      playlistId,
      mediaType,
      ...uniqueIds,
    );

    for (const row of rows) {
      const mediaId = textOrNull(row.media_id);
      if (mediaId) {
        result[mediaId] = true;
      }
    }

    return result;
  }

  private getLikedMediaItem(
    playlistId: string,
    mediaType: LibraryPlaylistItem['mediaType'],
    mediaId: string,
  ): LibraryPlaylistItem | null {
    const row = this.getRow(
      `SELECT id
       FROM playlist_items
       WHERE playlist_id = ?
         AND media_type = ?
         AND media_id = ?
       ORDER BY position ASC, added_at ASC
       LIMIT 1`,
      playlistId,
      mediaType,
      mediaId,
    );

    const itemRow = row ? this.getPlaylistItemRow(String(row.id)) : null;
    return itemRow ? this.mapPlaylistItem(itemRow) : null;
  }

  private unlikeMedia(playlistId: string, mediaType: LibraryPlaylistItem['mediaType'], mediaId: string): void {
    this.transaction(() => {
      const result = this.run(
        `DELETE FROM playlist_items
         WHERE playlist_id = ?
           AND media_type = ?
           AND media_id = ?`,
        playlistId,
        mediaType,
        mediaId,
      );

      if (result.changes > 0) {
        this.resequencePlaylistItems(playlistId);
        this.refreshPlaylistItemCount(playlistId);
      }
    });
  }

  private getSystemPlaylistItems(
    playlistId: string,
    mediaType: LibraryPlaylistItem['mediaType'] | LibraryPlaylistItem['mediaType'][],
    query?: LibraryPageQuery,
  ): LibraryPage<LibraryPlaylistItem> {
    const { page, pageSize, search, sort, sourceProvider } = pageFromQuery(query);
    const searchOptions = this.readSearchOptions();
    const offset = (page - 1) * pageSize;
    const searchFilter = buildSearchFilter(search, [
      likePredicate('COALESCE(playlist_items.title_snapshot, tracks.title, albums.title, \'\')'),
      likePredicate('COALESCE(playlist_items.artist_snapshot, tracks.artist, albums.album_artist, \'\')'),
      likePredicate('COALESCE(playlist_items.album_snapshot, tracks.album, albums.title, \'\')'),
    ], searchOptions);
    const mediaTypes = Array.isArray(mediaType) ? mediaType : [mediaType];
    const mediaTypeSql = mediaTypes.map(() => '?').join(', ');
    const sourceProviderSql = sourceProvider ? ' AND playlist_items.source_provider = ?' : '';
    const whereSql = searchFilter.sql
      ? `playlist_items.playlist_id = ? AND playlist_items.media_type IN (${mediaTypeSql})${sourceProviderSql} AND ${searchFilter.sql}`
      : `playlist_items.playlist_id = ? AND playlist_items.media_type IN (${mediaTypeSql})${sourceProviderSql}`;
    const params = [playlistId, ...mediaTypes, ...(sourceProvider ? [sourceProvider] : []), ...searchFilter.params];
    const totalRow = this.getRow(
      `SELECT COUNT(*) AS total
       FROM playlist_items
       LEFT JOIN tracks ON tracks.id = playlist_items.media_id
       LEFT JOIN albums ON albums.id = playlist_items.media_id
       WHERE ${whereSql}`,
      ...params,
    );
    const rows = this.allRows(
      `SELECT
        playlist_items.*,
        playlists.source_playlist_id AS playlist_source_playlist_id,
        tracks.id AS track_id,
        tracks.path AS track_path,
        tracks.title AS track_title,
        tracks.artist AS track_artist,
        tracks.album AS track_album,
        tracks.album_artist AS track_album_artist,
        tracks.track_no AS track_track_no,
        tracks.disc_no AS track_disc_no,
        tracks.year AS track_year,
        tracks.genre AS track_genre,
        tracks.duration AS track_duration,
        tracks.codec AS track_codec,
        tracks.sample_rate AS track_sample_rate,
        tracks.bit_depth AS track_bit_depth,
        tracks.bitrate AS track_bitrate,
        tracks.bpm AS track_bpm,
        tracks.bpm_confidence AS track_bpm_confidence,
        tracks.beat_offset_ms AS track_beat_offset_ms,
        tracks.analysis_status AS track_analysis_status,
        tracks.analysis_updated_at AS track_analysis_updated_at,
        tracks.cover_id AS track_cover_id,
        tracks.metadata_status AS track_metadata_status,
        tracks.embedded_metadata_status AS track_embedded_metadata_status,
        tracks.embedded_cover_status AS track_embedded_cover_status,
        tracks.network_metadata_status AS track_network_metadata_status,
        tracks.field_sources_json AS track_field_sources_json,
        tracks.missing AS track_missing,
        streaming_tracks.id AS streaming_track_id,
        streaming_tracks.stable_key AS streaming_stable_key,
        streaming_tracks.title AS streaming_title,
        streaming_tracks.artist AS streaming_artist,
        streaming_tracks.album AS streaming_album,
        streaming_tracks.album_artist AS streaming_album_artist,
        streaming_tracks.duration AS streaming_duration,
        streaming_tracks.cover_url AS streaming_cover_url,
        streaming_tracks.raw_json AS streaming_raw_json,
        streaming_tracks.playable AS streaming_playable,
        albums.id AS album_id,
        albums.album_key AS album_key,
        albums.title AS album_title,
        albums.album_artist AS album_artist,
        albums.year AS album_year,
        albums.track_count AS album_track_count,
        albums.duration AS album_duration,
        albums.cover_id AS album_cover_id
       FROM playlist_items
       LEFT JOIN playlists ON playlists.id = playlist_items.playlist_id
       LEFT JOIN tracks ON tracks.id = playlist_items.media_id
       LEFT JOIN streaming_tracks
         ON streaming_tracks.provider = playlist_items.source_provider
        AND streaming_tracks.provider_track_id = playlist_items.source_item_id
       LEFT JOIN albums ON albums.id = playlist_items.media_id
       WHERE ${whereSql}
       ${this.likedItemsOrderSql(sort)}
       LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);

    return {
      items: rows.map((row) => this.mapPlaylistItem(row)),
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  private refreshPlaylistItemCount(playlistId: string, timestamp = nowIso()): void {
    this.run(
      `UPDATE playlists SET
        item_count = (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?),
        updated_at = ?
       WHERE id = ?`,
      playlistId,
      timestamp,
      playlistId,
    );
  }

  private resequencePlaylistItems(playlistId: string): void {
    const rows = this.allRows('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC, added_at ASC', playlistId);
    rows.forEach((row, index) => {
      this.run('UPDATE playlist_items SET position = ? WHERE id = ?', index, row.id);
    });
  }

  private getPlaylistItemRow(itemId: string): DbRow | null {
    return this.getRow(
      `SELECT
        playlist_items.*,
        playlists.source_playlist_id AS playlist_source_playlist_id,
        tracks.id AS track_id,
        tracks.path AS track_path,
        tracks.title AS track_title,
        tracks.artist AS track_artist,
        tracks.album AS track_album,
        tracks.album_artist AS track_album_artist,
        tracks.track_no AS track_track_no,
        tracks.disc_no AS track_disc_no,
        tracks.year AS track_year,
        tracks.genre AS track_genre,
        tracks.duration AS track_duration,
        tracks.codec AS track_codec,
        tracks.sample_rate AS track_sample_rate,
        tracks.bit_depth AS track_bit_depth,
        tracks.bitrate AS track_bitrate,
        tracks.cover_id AS track_cover_id,
        tracks.metadata_status AS track_metadata_status,
        tracks.embedded_metadata_status AS track_embedded_metadata_status,
        tracks.embedded_cover_status AS track_embedded_cover_status,
        tracks.network_metadata_status AS track_network_metadata_status,
        tracks.field_sources_json AS track_field_sources_json,
        tracks.missing AS track_missing,
        streaming_tracks.id AS streaming_track_id,
        streaming_tracks.stable_key AS streaming_stable_key,
        streaming_tracks.title AS streaming_title,
        streaming_tracks.artist AS streaming_artist,
        streaming_tracks.album AS streaming_album,
        streaming_tracks.album_artist AS streaming_album_artist,
        streaming_tracks.duration AS streaming_duration,
        streaming_tracks.cover_url AS streaming_cover_url,
        streaming_tracks.raw_json AS streaming_raw_json,
        streaming_tracks.playable AS streaming_playable,
        albums.id AS album_id,
        albums.album_key AS album_key,
        albums.title AS album_title,
        albums.album_artist AS album_artist,
        albums.year AS album_year,
        albums.track_count AS album_track_count,
        albums.duration AS album_duration,
        albums.cover_id AS album_cover_id
      FROM playlist_items
      LEFT JOIN playlists ON playlists.id = playlist_items.playlist_id
      LEFT JOIN tracks ON tracks.id = playlist_items.media_id
      LEFT JOIN streaming_tracks
        ON streaming_tracks.provider = playlist_items.source_provider
       AND streaming_tracks.provider_track_id = playlist_items.source_item_id
      LEFT JOIN albums ON albums.id = playlist_items.media_id
      WHERE playlist_items.id = ?`,
      itemId,
    );
  }

  private mapPlaylist(row: DbRow): LibraryPlaylist {
    const coverId = textOrNull(row.cover_id);
    const displayCoverId = coverId ?? this.getPlaylistFallbackCoverId(String(row.id));
    const remoteCoverUrl = textOrNull(row.cover_url) ?? this.getPlaylistFallbackRemoteCoverUrl(String(row.id));

    return {
      id: String(row.id),
      name: String(row.name),
      description: textOrNull(row.description),
      kind: this.mapPlaylistKind(row.kind),
      sourceProvider: this.mapPlaylistSourceProvider(row.source_provider),
      sourcePlaylistId: textOrNull(row.source_playlist_id),
      coverId,
      coverThumb: displayCoverId ? this.toCoverUrl(displayCoverId, 'album') : remoteCoverUrl,
      sortMode: this.mapPlaylistSortMode(row.sort_mode),
      itemCount: Number(row.item_count ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private getPlaylistFallbackCoverId(playlistId: string): string | null {
    const row = this.getRow(
      `SELECT COALESCE(playlist_items.cover_id, tracks.cover_id, albums.cover_id) AS cover_id
       FROM playlist_items
       LEFT JOIN tracks ON tracks.id = playlist_items.media_id AND tracks.missing = 0
       LEFT JOIN albums ON albums.id = playlist_items.media_id
       WHERE playlist_items.playlist_id = ?
         AND COALESCE(playlist_items.cover_id, tracks.cover_id, albums.cover_id) IS NOT NULL
       ORDER BY playlist_items.position ASC, playlist_items.added_at ASC
       LIMIT 1`,
      playlistId,
    );

    return textOrNull(row?.cover_id);
  }

  private getPlaylistFallbackRemoteCoverUrl(playlistId: string): string | null {
    const row = this.getRow(
      `SELECT streaming_tracks.cover_url AS cover_url
       FROM playlist_items
       INNER JOIN streaming_tracks
         ON streaming_tracks.provider = playlist_items.source_provider
        AND streaming_tracks.provider_track_id = playlist_items.source_item_id
       WHERE playlist_items.playlist_id = ?
         AND playlist_items.media_type = 'stream_track'
         AND streaming_tracks.cover_url IS NOT NULL
       ORDER BY playlist_items.position ASC, playlist_items.added_at ASC
       LIMIT 1`,
      playlistId,
    );

    return textOrNull(row?.cover_url);
  }

  private mapPlaylistItem(row: DbRow): LibraryPlaylistItem {
    const coverId = textOrNull(row.cover_id) ?? textOrNull(row.track_cover_id) ?? textOrNull(row.album_cover_id);
    const streamingRaw = parseJsonObject(row.streaming_raw_json);
    const streamingCoverUrl = textOrNull(streamingRaw.coverUrl) ?? textOrNull(row.streaming_cover_url);
    const streamingFieldSources: Record<string, string> = {};
    const streamingAlbumId = textOrNull(streamingRaw.albumId);
    const streamingSourcePlaylistId = textOrNull(row.playlist_source_playlist_id);
    if (streamingAlbumId) {
      streamingFieldSources.streamingAlbumId = streamingAlbumId;
    }
    if (streamingSourcePlaylistId) {
      streamingFieldSources.streamingSourcePlaylistId = streamingSourcePlaylistId;
    }
    const trackMissing = Number(row.track_missing ?? 1) !== 0;
    const hasTrack = textOrNull(row.track_id) !== null && !trackMissing;
    const hasStreamingTrack = row.media_type === 'stream_track' && textOrNull(row.streaming_track_id) !== null;
    const hasAlbum = textOrNull(row.album_id) !== null;
    const isRemoteTrackItem = row.media_type === 'track' && row.source_provider === 'remote';
    const isStreamingTrackItem = row.media_type === 'stream_track';
    const unavailable =
      (!isStreamingTrackItem && Number(row.unavailable ?? 0) !== 0) ||
      (row.media_type === 'track' && !isRemoteTrackItem && (!hasTrack || !textOrNull(row.media_id))) ||
      (row.media_type === 'album' && (!hasAlbum || !textOrNull(row.media_id)));

    return {
      id: String(row.id),
      playlistId: String(row.playlist_id),
      mediaType: this.mapPlaylistMediaType(row.media_type),
      mediaId: textOrNull(row.media_id),
      sourceProvider: this.mapPlaylistSourceProvider(row.source_provider),
      sourceItemId: textOrNull(row.source_item_id),
      titleSnapshot: textOrNull(row.title_snapshot),
      artistSnapshot: textOrNull(row.artist_snapshot),
      albumSnapshot: textOrNull(row.album_snapshot),
      durationSnapshot: numberOrNull(row.duration_snapshot),
      coverId,
      coverThumb: coverId ? this.toCoverUrl(coverId, 'thumb') : streamingCoverUrl,
      position: Number(row.position ?? 0),
      addedAt: String(row.added_at),
      addedFrom: textOrNull(row.added_from),
      unavailable,
      track: hasStreamingTrack
        ? {
            id: textOrNull(row.streaming_stable_key) ?? textOrNull(row.media_id) ?? String(row.streaming_track_id),
            mediaType: 'streaming',
            path: textOrNull(row.streaming_stable_key) ?? textOrNull(row.media_id) ?? String(row.streaming_track_id),
            provider: textOrNull(row.source_provider),
            providerTrackId: textOrNull(row.source_item_id),
            stableKey: textOrNull(row.streaming_stable_key) ?? textOrNull(row.media_id),
            title: textOrNull(row.streaming_title) ?? textOrNull(row.title_snapshot) ?? 'Untitled',
            artist: textOrNull(row.streaming_artist) ?? textOrNull(row.artist_snapshot) ?? 'Unknown Artist',
            album: textOrNull(row.streaming_album) ?? textOrNull(row.album_snapshot) ?? 'Unknown Album',
            albumArtist:
              textOrNull(row.streaming_album_artist) ?? textOrNull(row.streaming_artist) ?? textOrNull(row.artist_snapshot) ?? 'Unknown Artist',
            trackNo: null,
            discNo: null,
            year: null,
            genre: null,
            duration: numberOrNull(row.streaming_duration) ?? numberOrNull(row.duration_snapshot) ?? 0,
            codec: null,
            sampleRate: null,
            bitDepth: null,
            bitrate: null,
            coverId,
            coverThumb: streamingCoverUrl,
            fieldSources: streamingFieldSources,
            unavailable: Number(row.streaming_playable ?? 1) === 0 || Number(row.unavailable ?? 0) !== 0,
            playlistItemId: String(row.id),
          }
        : hasTrack
        ? this.mapTrack({
            id: row.track_id,
            path: row.track_path,
            title: row.track_title,
            artist: row.track_artist,
            album: row.track_album,
            album_artist: row.track_album_artist,
            track_no: row.track_track_no,
            disc_no: row.track_disc_no,
            year: row.track_year,
            genre: row.track_genre,
            duration: row.track_duration,
            codec: row.track_codec,
            sample_rate: row.track_sample_rate,
            bit_depth: row.track_bit_depth,
            bitrate: row.track_bitrate,
            bpm: row.track_bpm,
            bpm_confidence: row.track_bpm_confidence,
            beat_offset_ms: row.track_beat_offset_ms,
            analysis_status: row.track_analysis_status,
            analysis_updated_at: row.track_analysis_updated_at,
            cover_id: row.track_cover_id,
            metadata_status: row.track_metadata_status,
            embedded_metadata_status: row.track_embedded_metadata_status,
            embedded_cover_status: row.track_embedded_cover_status,
            network_metadata_status: row.track_network_metadata_status,
            field_sources_json: row.track_field_sources_json,
          })
        : null,
      album: hasAlbum
        ? this.mapAlbum({
            id: row.album_id,
            album_key: row.album_key,
            title: row.album_title,
            album_artist: row.album_artist,
            year: row.album_year,
            track_count: row.album_track_count,
            duration: row.album_duration,
            cover_id: row.album_cover_id,
          })
        : null,
    };
  }

  private mapPlaylistKind(value: unknown): LibraryPlaylist['kind'] {
    return value === 'smart' || value === 'synced' || value === 'system' ? value : 'manual';
  }

  private mapPlaylistSourceProvider(value: unknown): LibraryPlaylist['sourceProvider'] {
    return value === 'netease' || value === 'qqmusic' || value === 'kugou' || value === 'spotify' || value === 'remote' ? value : 'local';
  }

  private mapPlaylistSortMode(value: unknown): LibraryPlaylist['sortMode'] {
    return value === 'titleAsc' || value === 'titleDesc' || value === 'artistAsc' || value === 'addedDesc' ? value : 'manual';
  }

  private mapPlaylistMediaType(value: unknown): LibraryPlaylistItem['mediaType'] {
    return value === 'album' || value === 'stream_track' || value === 'remote_file' ? value : 'track';
  }

  private getAverageAlbumPayloadBytes(): number | null {
    const row = this.getRow(
      `SELECT AVG(
        160
        + LENGTH(id)
        + LENGTH(album_key)
        + LENGTH(title)
        + LENGTH(album_artist)
        + COALESCE(LENGTH(CAST(year AS TEXT)), 4)
        + LENGTH(CAST(track_count AS TEXT))
        + LENGTH(CAST(duration AS TEXT))
        + COALESCE(LENGTH(cover_id), 4)
        + CASE WHEN cover_id IS NULL THEN 4 ELSE LENGTH('echo-cover://album/') + LENGTH(cover_id) END
      ) AS average_bytes
      FROM albums`,
    );
    const value = Number(row?.average_bytes ?? 0);

    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private getPlaybackHistoryEntry(id: string): PlaybackHistoryEntry | null {
    const row = this.getRow('SELECT * FROM playback_history WHERE id = ?', id);
    return row ? this.mapPlaybackHistoryEntry(row) : null;
  }

  private isPlaybackCompleted(playedSeconds: number, durationSeconds: number): boolean {
    if (durationSeconds <= 0) {
      return playedSeconds >= 30;
    }

    return playedSeconds >= 30 || playedSeconds >= durationSeconds * 0.5;
  }

  private hasKnownTrackId(trackId: string): boolean {
    if (this.getTrack(trackId)) {
      return true;
    }

    const remoteRow = this.getRow(
      `SELECT remote_tracks.id
       FROM remote_tracks
       INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
       WHERE remote_tracks.id = ?
         AND remote_tracks.availability != 'missing'
         AND remote_sources.status = 'enabled'`,
      trackId,
    );

    return Boolean(remoteRow);
  }

  private getLibraryInboxBatch(batchId: string): LibraryInboxBatch | null {
    const row = this.getRow('SELECT * FROM library_inbox_batches WHERE id = ?', batchId);
    return row ? this.mapLibraryInboxBatch(row) : null;
  }

  private mapLibraryInboxBatch(row: DbRow): LibraryInboxBatch {
    return {
      id: String(row.id),
      scanJobId: String(row.scan_job_id),
      folderId: String(row.folder_id),
      folderName: sanitizeLibraryText(row.folder_name, 'Library Folder'),
      folderPath: String(row.folder_path ?? ''),
      addedCount: Number(row.added_count ?? 0),
      missingCoverCount: Number(row.missing_cover_count ?? 0),
      metadataIssueCount: Number(row.metadata_issue_count ?? 0),
      createdAt: String(row.created_at ?? ''),
      finishedAt: String(row.finished_at ?? ''),
    };
  }

  private mapLibraryInboxItemStatus(value: unknown): LibraryInboxItemStatus {
    return value === 'processed' || value === 'ignored' ? value : 'pending';
  }

  private pruneLibraryInboxBatches(limit: number): void {
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = this.allRows(
      `SELECT id
       FROM library_inbox_batches
       ORDER BY finished_at DESC, created_at DESC
       LIMIT -1 OFFSET ?`,
      safeLimit,
    );

    for (const row of rows) {
      const batchId = textOrNull(row.id);
      if (batchId) {
        this.run('DELETE FROM library_inbox_batches WHERE id = ?', batchId);
      }
    }
  }

  private countInboxIssueTracksForBatch(batchId: string): { missingCoverCount: number; metadataIssueCount: number } {
    const row = this.getRow(
      `SELECT
         SUM(CASE WHEN ${this.libraryInboxFilterCondition('missing_cover')} THEN 1 ELSE 0 END) AS missing_cover_count,
         SUM(CASE WHEN ${this.libraryInboxFilterCondition('metadata_issue')} THEN 1 ELSE 0 END) AS metadata_issue_count
       FROM library_inbox_items
       INNER JOIN tracks ON tracks.id = library_inbox_items.track_id
       WHERE library_inbox_items.batch_id = ?
         AND tracks.missing = 0`,
      batchId,
    );

    return {
      missingCoverCount: Number(row?.missing_cover_count ?? 0),
      metadataIssueCount: Number(row?.metadata_issue_count ?? 0),
    };
  }

  private resolveLibraryInboxQuery(
    query: LibraryInboxTrackQuery | undefined,
    batches: LibraryInboxBatch[],
  ): LibraryInboxResolvedQuery {
    const normalized = pageFromInboxQuery(query);

    if (normalized.scope === 'all') {
      return {
        ...normalized,
        selectedBatch: null,
        hasTarget: batches.length > 0,
      };
    }

    const selectedBatch =
      normalized.scope === 'batch' && normalized.batchId
        ? batches.find((batch) => batch.id === normalized.batchId) ?? this.getLibraryInboxBatch(normalized.batchId)
        : batches[0] ?? null;

    return {
      ...normalized,
      selectedBatch,
      hasTarget: Boolean(selectedBatch),
    };
  }

  private libraryInboxFilterCondition(filter: LibraryInboxFilterKind): string {
    switch (filter) {
      case 'missing_cover':
        return "NOT EXISTS (SELECT 1 FROM covers WHERE covers.id = tracks.cover_id AND covers.source_type != 'default')";
      case 'metadata_issue':
        return `(
          tracks.metadata_status = 'fallback'
          OR tracks.embedded_metadata_status = 'error'
          OR tracks.embedded_cover_status = 'error'
          OR json_extract(tracks.field_sources_json, '$.title') IN ('unknown', 'filename_fallback')
          OR json_extract(tracks.field_sources_json, '$.artist') IN ('unknown', 'filename_fallback')
          OR json_extract(tracks.field_sources_json, '$.album') IN ('unknown', 'filename_fallback')
          OR json_extract(tracks.field_sources_json, '$.albumArtist') IN ('unknown', 'artist_fallback', 'filename_fallback')
        )`;
      case 'unknown_artist':
        return "lower(trim(tracks.artist)) IN ('', 'unknown', 'unknown artist')";
      case 'unknown_album':
        return "lower(trim(tracks.album)) IN ('', 'unknown', 'unknown album')";
      case 'suspicious_file':
        return this.libraryInboxSuspiciousCondition();
      case 'all':
      default:
        return '1 = 1';
    }
  }

  private libraryInboxSuspiciousCondition(): string {
    return `(
      tracks.duration <= 0
      OR tracks.size_bytes <= 0
      OR tracks.codec IS NULL
      OR trim(tracks.codec) = ''
    )`;
  }

  private buildLibraryInboxTrackSelection(query: LibraryInboxResolvedQuery): {
    fromSql: string;
    whereSql: string;
    params: unknown[];
  } {
    const searchQuery = buildFtsSearchQuery(query.search, this.readSearchOptions());
    const searchJoinSql = searchQuery ? 'INNER JOIN tracks_fts ON tracks_fts.rowid = tracks.rowid' : '';
    const whereParts = ['tracks.missing = 0', this.libraryInboxFilterCondition(query.filter)];
    const params: unknown[] = [];

    if (query.scope !== 'all' && query.selectedBatch) {
      whereParts.push('library_inbox_items.batch_id = ?');
      params.push(query.selectedBatch.id);
    }
    if (query.folderId) {
      whereParts.push('tracks.folder_id = ?');
      params.push(query.folderId);
    }
    if (query.album) {
      whereParts.push('tracks.album = ?');
      params.push(query.album);
    }
    if (query.artist) {
      whereParts.push('tracks.artist = ?');
      params.push(query.artist);
    }
    if (query.status !== 'all') {
      whereParts.push("COALESCE(library_inbox_item_states.status, 'pending') = ?");
      params.push(query.status);
    }
    if (searchQuery) {
      whereParts.push('tracks_fts MATCH ?');
      params.push(searchQuery);
    }

    return {
      fromSql: `FROM library_inbox_items
       INNER JOIN library_inbox_batches ON library_inbox_batches.id = library_inbox_items.batch_id
       INNER JOIN tracks ON tracks.id = library_inbox_items.track_id
       LEFT JOIN library_inbox_item_states
         ON library_inbox_item_states.batch_id = library_inbox_items.batch_id
        AND library_inbox_item_states.track_id = library_inbox_items.track_id
       ${searchJoinSql}`,
      whereSql: `WHERE ${whereParts.join(' AND ')}`,
      params,
    };
  }

  private countLibraryInboxTracks(query: LibraryInboxResolvedQuery): number {
    const selection = this.buildLibraryInboxTrackSelection(query);
    const row = this.getRow(
      `SELECT COUNT(*) AS total
       ${selection.fromSql}
       ${selection.whereSql}`,
      ...selection.params,
    );

    return Number(row?.total ?? 0);
  }

  private getLibraryInboxTrackIds(query: LibraryInboxResolvedQuery, limit: number): string[] {
    const selection = this.buildLibraryInboxTrackSelection(query);
    const safeLimit = Math.max(1, Math.floor(limit));

    return this.allRows(
      `SELECT tracks.id
       ${selection.fromSql}
       ${selection.whereSql}
       ORDER BY library_inbox_batches.finished_at DESC, library_inbox_items.position ASC
       LIMIT ?`,
      ...selection.params,
      safeLimit,
    ).map((row) => String(row.id));
  }

  private getLibraryInboxItemRefs(query: LibraryInboxResolvedQuery, limit: number): LibraryInboxItemRef[] {
    const selection = this.buildLibraryInboxTrackSelection(query);
    const safeLimit = Math.max(1, Math.floor(limit));

    return this.allRows(
      `SELECT library_inbox_items.batch_id, library_inbox_items.track_id
       ${selection.fromSql}
       ${selection.whereSql}
       ORDER BY library_inbox_batches.finished_at DESC, library_inbox_items.position ASC
       LIMIT ?`,
      ...selection.params,
      safeLimit,
    ).map((row) => ({
      batchId: String(row.batch_id),
      trackId: String(row.track_id),
    }));
  }

  private resolveLibraryInboxItemRefs(request: LibraryInboxUpdateStateRequest): {
    refs: LibraryInboxItemRef[];
    matchedCount: number;
  } {
    if (Array.isArray(request.items) && request.items.length > 0) {
      const seen = new Set<string>();
      const refs: LibraryInboxItemRef[] = [];

      for (const item of request.items) {
        const batchId = typeof item.batchId === 'string' ? item.batchId.trim() : '';
        const trackId = typeof item.trackId === 'string' ? item.trackId.trim() : '';
        const key = `${batchId}\0${trackId}`;
        if (!batchId || !trackId || seen.has(key)) {
          continue;
        }
        seen.add(key);
        const row = this.getRow(
          'SELECT 1 FROM library_inbox_items WHERE batch_id = ? AND track_id = ?',
          batchId,
          trackId,
        );
        if (row) {
          refs.push({ batchId, trackId });
        }
      }

      return { refs, matchedCount: refs.length };
    }

    const batches = this.getLibraryInboxBatches();
    const normalized = this.resolveLibraryInboxQuery(request.query, batches);

    if (!normalized.hasTarget) {
      throw new Error('No new-songs inbox batch is available.');
    }

    return {
      refs: this.getLibraryInboxItemRefs(normalized, libraryInboxPlaylistTrackLimit),
      matchedCount: this.countLibraryInboxTracks(normalized),
    };
  }

  private emptyLibraryInboxStory(): LibraryInboxStory {
    return {
      trackCount: 0,
      albumCount: 0,
      artistCount: 0,
      folderCount: 0,
      missingCoverCount: 0,
      metadataIssueCount: 0,
      unknownArtistCount: 0,
      unknownAlbumCount: 0,
      suspiciousCount: 0,
      pendingCount: 0,
      processedCount: 0,
      ignoredCount: 0,
      coverCompleteness: 0,
      metadataCompleteness: 0,
      totalDuration: 0,
      topFolders: [],
      topArtists: [],
    };
  }

  private getLibraryInboxStory(query: LibraryInboxResolvedQuery): LibraryInboxStory {
    if (!query.hasTarget) {
      return this.emptyLibraryInboxStory();
    }

    const selection = this.buildLibraryInboxTrackSelection(query);
    const row = this.getRow(
      `SELECT
         COUNT(*) AS track_count,
         COUNT(DISTINCT NULLIF(trim(tracks.album), '')) AS album_count,
         COUNT(DISTINCT NULLIF(trim(tracks.artist), '')) AS artist_count,
         COUNT(DISTINCT tracks.folder_id) AS folder_count,
         SUM(CASE WHEN ${this.libraryInboxFilterCondition('missing_cover')} THEN 1 ELSE 0 END) AS missing_cover_count,
         SUM(CASE WHEN ${this.libraryInboxFilterCondition('metadata_issue')} THEN 1 ELSE 0 END) AS metadata_issue_count,
         SUM(CASE WHEN ${this.libraryInboxFilterCondition('unknown_artist')} THEN 1 ELSE 0 END) AS unknown_artist_count,
         SUM(CASE WHEN ${this.libraryInboxFilterCondition('unknown_album')} THEN 1 ELSE 0 END) AS unknown_album_count,
         SUM(CASE WHEN ${this.libraryInboxSuspiciousCondition()} THEN 1 ELSE 0 END) AS suspicious_count,
         SUM(CASE WHEN COALESCE(library_inbox_item_states.status, 'pending') = 'pending' THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN COALESCE(library_inbox_item_states.status, 'pending') = 'processed' THEN 1 ELSE 0 END) AS processed_count,
         SUM(CASE WHEN COALESCE(library_inbox_item_states.status, 'pending') = 'ignored' THEN 1 ELSE 0 END) AS ignored_count,
         SUM(tracks.duration) AS total_duration
       ${selection.fromSql}
       ${selection.whereSql}`,
      ...selection.params,
    );
    const topFolders = this.getLibraryInboxFacetOptions({ ...query, folderId: null }, 'folder').slice(0, 3);
    const topArtists = this.getLibraryInboxFacetOptions({ ...query, artist: null }, 'artist').slice(0, 3);

    const trackCount = Number(row?.track_count ?? 0);
    const missingCoverCount = Number(row?.missing_cover_count ?? 0);
    const metadataIssueCount = Number(row?.metadata_issue_count ?? 0);

    return {
      trackCount,
      albumCount: Number(row?.album_count ?? 0),
      artistCount: Number(row?.artist_count ?? 0),
      folderCount: Number(row?.folder_count ?? 0),
      missingCoverCount,
      metadataIssueCount,
      unknownArtistCount: Number(row?.unknown_artist_count ?? 0),
      unknownAlbumCount: Number(row?.unknown_album_count ?? 0),
      suspiciousCount: Number(row?.suspicious_count ?? 0),
      pendingCount: Number(row?.pending_count ?? 0),
      processedCount: Number(row?.processed_count ?? 0),
      ignoredCount: Number(row?.ignored_count ?? 0),
      coverCompleteness: trackCount > 0 ? Math.max(0, Math.min(100, Math.round(((trackCount - missingCoverCount) / trackCount) * 100))) : 0,
      metadataCompleteness: trackCount > 0 ? Math.max(0, Math.min(100, Math.round(((trackCount - metadataIssueCount) / trackCount) * 100))) : 0,
      totalDuration: Number(row?.total_duration ?? 0),
      topFolders,
      topArtists,
    };
  }

  private getLibraryInboxAlbumSummaries(query: LibraryInboxResolvedQuery): LibraryInboxAlbumSummary[] {
    if (!query.hasTarget) {
      return [];
    }

    const selection = this.buildLibraryInboxTrackSelection(query);

    return this.allRows(
      `SELECT
         COALESCE(NULLIF(trim(tracks.album), ''), 'Unknown Album') AS album,
         COALESCE(NULLIF(trim(tracks.album_artist), ''), NULLIF(trim(tracks.artist), ''), 'Unknown Artist') AS album_artist,
         MAX(tracks.cover_id) AS cover_id,
         COUNT(*) AS track_count,
         SUM(CASE WHEN ${this.libraryInboxFilterCondition('missing_cover')} THEN 1 ELSE 0 END) AS missing_cover_count,
         SUM(CASE WHEN ${this.libraryInboxFilterCondition('metadata_issue')} THEN 1 ELSE 0 END) AS metadata_issue_count,
         SUM(tracks.duration) AS duration
       ${selection.fromSql}
       ${selection.whereSql}
       GROUP BY album, album_artist
       ORDER BY track_count DESC, album COLLATE NOCASE
       LIMIT ?`,
      ...selection.params,
      libraryInboxAlbumWallLimit,
    ).map((row) => {
      const coverId = textOrNull(row.cover_id);

      return {
        album: sanitizeLibraryText(row.album, 'Unknown Album'),
        albumArtist: sanitizeLibraryText(row.album_artist, 'Unknown Artist'),
        coverId,
        coverThumb: this.toCoverUrl(coverId, 'album'),
        trackCount: Number(row.track_count ?? 0),
        missingCoverCount: Number(row.missing_cover_count ?? 0),
        metadataIssueCount: Number(row.metadata_issue_count ?? 0),
        duration: Number(row.duration ?? 0),
      };
    });
  }

  private getLibraryInboxFacets(query: LibraryInboxResolvedQuery): LibraryInboxTrackPage['facets'] {
    if (!query.hasTarget) {
      return { folders: [], albums: [], artists: [] };
    }

    return {
      folders: this.getLibraryInboxFacetOptions({ ...query, folderId: null }, 'folder'),
      albums: this.getLibraryInboxFacetOptions({ ...query, album: null }, 'album'),
      artists: this.getLibraryInboxFacetOptions({ ...query, artist: null }, 'artist'),
    };
  }

  private getLibraryInboxFacetOptions(
    query: LibraryInboxResolvedQuery,
    facet: 'folder' | 'album' | 'artist',
  ): LibraryInboxTrackPage['facets']['folders'] {
    const selection = this.buildLibraryInboxTrackSelection(query);
    const facetSql = {
      folder: {
        value: 'tracks.folder_id',
        label: 'library_inbox_batches.folder_name',
        extraWhere: '',
      },
      album: {
        value: 'tracks.album',
        label: "COALESCE(NULLIF(trim(tracks.album), ''), 'Unknown Album')",
        extraWhere: " AND trim(tracks.album) != ''",
      },
      artist: {
        value: 'tracks.artist',
        label: "COALESCE(NULLIF(trim(tracks.artist), ''), 'Unknown Artist')",
        extraWhere: " AND trim(tracks.artist) != ''",
      },
    }[facet];

    return this.allRows(
      `SELECT ${facetSql.value} AS value, ${facetSql.label} AS label, COUNT(*) AS count
       ${selection.fromSql}
       ${selection.whereSql}${facetSql.extraWhere}
       GROUP BY value, label
       ORDER BY count DESC, label COLLATE NOCASE
       LIMIT 50`,
      ...selection.params,
    ).map((row) => ({
      value: String(row.value ?? ''),
      label: sanitizeLibraryText(row.label, String(row.value ?? '')),
      count: Number(row.count ?? 0),
    }));
  }

  private libraryInboxIssueReasons(row: DbRow): LibraryInboxIssueReason[] {
    const reasons: LibraryInboxIssueReason[] = [];
    const coverId = textOrNull(row.cover_id);
    const coverSourceType = textOrNull(row.cover_source_type);
    const metadataStatus = textOrNull(row.metadata_status);
    const embeddedMetadataStatus = textOrNull(row.embedded_metadata_status);
    const embeddedCoverStatus = textOrNull(row.embedded_cover_status);
    const artist = String(row.artist ?? '').trim().toLowerCase();
    const album = String(row.album ?? '').trim().toLowerCase();
    const albumArtist = String(row.album_artist ?? '').trim().toLowerCase();
    const fieldSources = parseJsonObject(row.field_sources_json);

    if (!coverId || !coverSourceType || coverSourceType === 'default') {
      reasons.push('missing_cover');
    }
    if (metadataStatus === 'fallback') {
      reasons.push('metadata_fallback');
    }
    if (Object.values(fieldSources).includes('filename_fallback')) {
      reasons.push('filename_fallback');
    }
    if (!artist || artist === 'unknown' || artist === 'unknown artist') {
      reasons.push('unknown_artist');
    }
    if (!album) {
      reasons.push('missing_album');
    } else if (album === 'unknown' || album === 'unknown album') {
      reasons.push('unknown_album');
    }
    if (!albumArtist || albumArtist === 'unknown' || albumArtist === 'unknown artist' || albumArtist === 'unknown album') {
      reasons.push('missing_album_artist');
    }
    if (embeddedMetadataStatus === 'error') {
      reasons.push('embedded_metadata_error');
    }
    if (embeddedCoverStatus === 'error') {
      reasons.push('embedded_cover_error');
    }
    if (Number(row.duration ?? 0) <= 0 || Number(row.size_bytes ?? 1) <= 0 || !textOrNull(row.codec)) {
      reasons.push('suspicious_file');
    }

    return [...new Set(reasons)];
  }

  private defaultLibraryInboxPlaylistName(query: LibraryInboxResolvedQuery): string {
    const dateLabel = new Date().toISOString().slice(0, 10);
    const scopeLabel = query.scope === 'all' ? '最近新增' : query.selectedBatch?.folderName ?? '本次新增';
    const filterLabel: Record<LibraryInboxFilterKind, string> = {
      all: '全部',
      missing_cover: '缺封面',
      metadata_issue: '资料异常',
      unknown_artist: '未知艺人',
      unknown_album: '未知专辑',
      suspicious_file: '疑似异常',
    };

    return `新歌收件箱 ${scopeLabel} ${filterLabel[query.filter]} ${dateLabel}`;
  }

  private libraryQualityIssueFilter(kind: LibraryQualityIssueKind): { conditionSql: string } {
    switch (kind) {
      case 'missing_cover':
        return {
          conditionSql: "NOT EXISTS (SELECT 1 FROM covers WHERE covers.id = tracks.cover_id AND covers.source_type != 'default')",
        };
      case 'fallback_metadata':
        return { conditionSql: "tracks.metadata_status = 'fallback'" };
      case 'unknown_artist_album':
        return {
          conditionSql: `(
            lower(trim(tracks.artist)) IN ('', 'unknown', 'unknown artist')
            OR lower(trim(tracks.album)) IN ('', 'unknown', 'unknown album')
            OR lower(trim(tracks.album_artist)) IN ('', 'unknown', 'unknown artist', 'unknown album')
          )`,
        };
      case 'embedded_read_failed':
        return { conditionSql: "tracks.embedded_metadata_status = 'error' OR tracks.embedded_cover_status = 'error'" };
      case 'network_candidate':
        return {
          conditionSql: `(
            tracks.network_metadata_status = 'candidate_found'
            OR EXISTS (SELECT 1 FROM network_metadata_candidates WHERE network_metadata_candidates.track_id = tracks.id)
            OR EXISTS (SELECT 1 FROM network_cover_candidates WHERE network_cover_candidates.track_id = tracks.id)
          )`,
        };
      default:
        throw new Error(`Unsupported library quality issue kind: ${String(kind)}`);
    }
  }

  private libraryQualityIssueReasons(kind: LibraryQualityIssueKind, row: DbRow): LibraryQualityIssueReason[] {
    const reasons: LibraryQualityIssueReason[] = [];
    const coverId = textOrNull(row.cover_id);
    const coverSourceType = textOrNull(row.cover_source_type);
    const metadataStatus = textOrNull(row.metadata_status);
    const embeddedMetadataStatus = textOrNull(row.embedded_metadata_status);
    const embeddedCoverStatus = textOrNull(row.embedded_cover_status);
    const networkMetadataStatus = textOrNull(row.network_metadata_status);
    const artist = String(row.artist ?? '').trim().toLowerCase();
    const album = String(row.album ?? '').trim().toLowerCase();
    const albumArtist = String(row.album_artist ?? '').trim().toLowerCase();

    if (kind === 'missing_cover') {
      if (!coverId || !coverSourceType || coverSourceType === 'default') {
        reasons.push('missing_cover');
      }
    }

    if (kind === 'fallback_metadata') {
      const fieldSources = parseJsonObject(row.field_sources_json);
      if (metadataStatus === 'fallback') {
        reasons.push('metadata_fallback');
      }
      if (Object.values(fieldSources).includes('filename_fallback')) {
        reasons.push('filename_fallback');
      }
    }

    if (kind === 'unknown_artist_album') {
      if (!artist || artist === 'unknown' || artist === 'unknown artist') {
        reasons.push('unknown_artist');
      }
      if (!album) {
        reasons.push('missing_album');
      } else if (album === 'unknown' || album === 'unknown album') {
        reasons.push('unknown_album');
      }
      if (!albumArtist || albumArtist === 'unknown' || albumArtist === 'unknown artist' || albumArtist === 'unknown album') {
        reasons.push('missing_album_artist');
      }
    }

    if (kind === 'embedded_read_failed') {
      if (embeddedMetadataStatus === 'error') {
        reasons.push('embedded_metadata_error');
      }
      if (embeddedCoverStatus === 'error') {
        reasons.push('embedded_cover_error');
      }
    }

    if (kind === 'network_candidate') {
      const metadataCandidateCount = Number(row.metadata_candidate_count ?? 0);
      const coverCandidateCount = Number(row.cover_candidate_count ?? 0);
      if (networkMetadataStatus === 'candidate_found' || metadataCandidateCount > 0) {
        reasons.push('network_metadata_candidate');
      }
      if (coverCandidateCount > 0) {
        reasons.push('network_cover_candidate');
      }
    }

    return [...new Set(reasons)];
  }

  private trackOrderSql(sort: string): string {
    switch (sort) {
      case 'artist':
        return 'ORDER BY tracks.artist COLLATE NOCASE, tracks.title COLLATE NOCASE';
      case 'artistAlbum':
        return 'ORDER BY tracks.artist COLLATE NOCASE, tracks.album COLLATE NOCASE, COALESCE(tracks.disc_no, 0), COALESCE(tracks.track_no, 999999), tracks.title COLLATE NOCASE';
      case 'album':
        return 'ORDER BY tracks.album COLLATE NOCASE, tracks.title COLLATE NOCASE';
      case 'recent':
        return 'ORDER BY tracks.updated_at DESC, tracks.title COLLATE NOCASE';
      case 'createdAsc':
        return 'ORDER BY tracks.created_at ASC, tracks.title COLLATE NOCASE';
      case 'createdDesc':
        return 'ORDER BY tracks.created_at DESC, tracks.title COLLATE NOCASE';
      case 'titleDesc':
        return 'ORDER BY tracks.title COLLATE NOCASE DESC, tracks.artist COLLATE NOCASE';
      case 'durationAsc':
        return 'ORDER BY tracks.duration ASC, tracks.title COLLATE NOCASE';
      case 'durationDesc':
        return 'ORDER BY tracks.duration DESC, tracks.title COLLATE NOCASE';
      case 'fileModifiedAsc':
        return 'ORDER BY tracks.mtime_ms ASC, tracks.title COLLATE NOCASE';
      case 'fileModifiedDesc':
        return 'ORDER BY tracks.mtime_ms DESC, tracks.title COLLATE NOCASE';
      case 'qualityAsc':
        return 'ORDER BY COALESCE(tracks.bitrate, 0) ASC, tracks.size_bytes ASC, tracks.title COLLATE NOCASE';
      case 'qualityDesc':
        return 'ORDER BY COALESCE(tracks.bitrate, 0) DESC, tracks.size_bytes DESC, tracks.title COLLATE NOCASE';
      case 'frequent':
        return 'ORDER BY COALESCE(tracks.play_count, 0) DESC, tracks.last_played_at DESC, tracks.title COLLATE NOCASE';
      case 'random':
        return 'ORDER BY RANDOM()';
      case 'titleAsc':
      case 'default':
      case 'title':
      default:
        return 'ORDER BY tracks.title COLLATE NOCASE, tracks.artist COLLATE NOCASE';
    }
  }

  private unifiedTrackOrderSql(sort: string, searchActive = false): string {
    if (searchActive && (sort === 'default' || !sort)) {
      return 'ORDER BY search_rank ASC, title COLLATE NOCASE, artist COLLATE NOCASE';
    }

    return this.trackOrderSql(sort).replace(/\btracks\./g, '');
  }

  private playlistItemsOrderSql(sort: string): string {
    switch (sort) {
      case 'addedDesc':
      case 'recent':
        return 'ORDER BY playlist_items.added_at DESC, playlist_items.position ASC';
      case 'titleDesc':
        return "ORDER BY COALESCE(playlist_items.title_snapshot, tracks.title, albums.title, '') COLLATE NOCASE DESC, playlist_items.position ASC";
      case 'titleAsc':
      case 'title':
        return "ORDER BY COALESCE(playlist_items.title_snapshot, tracks.title, albums.title, '') COLLATE NOCASE ASC, playlist_items.position ASC";
      case 'artistAsc':
      case 'artist':
        return "ORDER BY COALESCE(playlist_items.artist_snapshot, tracks.artist, albums.album_artist, '') COLLATE NOCASE ASC, COALESCE(playlist_items.title_snapshot, tracks.title, albums.title, '') COLLATE NOCASE ASC, playlist_items.position ASC";
      case 'artistAlbum':
        return "ORDER BY COALESCE(playlist_items.artist_snapshot, tracks.artist, albums.album_artist, '') COLLATE NOCASE ASC, COALESCE(playlist_items.album_snapshot, tracks.album, albums.title, '') COLLATE NOCASE ASC, COALESCE(playlist_items.title_snapshot, tracks.title, albums.title, '') COLLATE NOCASE ASC, playlist_items.position ASC";
      case 'album':
        return "ORDER BY COALESCE(playlist_items.album_snapshot, tracks.album, albums.title, '') COLLATE NOCASE ASC";
      case 'manual':
      case 'default':
      default:
        return 'ORDER BY playlist_items.position ASC, playlist_items.added_at ASC';
    }
  }

  private likedItemsOrderSql(sort: string): string {
    return this.playlistItemsOrderSql(sort);
  }

  private artistTrackOrderSql(sort: string): string {
    switch (sort) {
      case 'recent':
        return 'ORDER BY COALESCE(tracks.last_played_at, tracks.updated_at) DESC, tracks.title COLLATE NOCASE';
      case 'frequent':
        return 'ORDER BY COALESCE(tracks.play_count, 0) DESC, tracks.last_played_at DESC, tracks.title COLLATE NOCASE';
      case 'titleAsc':
      case 'title':
        return 'ORDER BY tracks.title COLLATE NOCASE, tracks.album COLLATE NOCASE';
      case 'titleDesc':
        return 'ORDER BY tracks.title COLLATE NOCASE DESC, tracks.album COLLATE NOCASE';
      case 'durationAsc':
        return 'ORDER BY tracks.duration ASC, tracks.title COLLATE NOCASE';
      case 'durationDesc':
        return 'ORDER BY tracks.duration DESC, tracks.title COLLATE NOCASE';
      case 'fileModifiedAsc':
        return 'ORDER BY tracks.mtime_ms ASC, tracks.title COLLATE NOCASE';
      case 'fileModifiedDesc':
        return 'ORDER BY tracks.mtime_ms DESC, tracks.title COLLATE NOCASE';
      case 'random':
        return 'ORDER BY RANDOM()';
      case 'artistAlbum':
      case 'default':
      default:
        return 'ORDER BY tracks.album COLLATE NOCASE, COALESCE(tracks.disc_no, 0), COALESCE(tracks.track_no, 0), tracks.title COLLATE NOCASE';
    }
  }

  private albumOrderSql(sort: string): string {
    switch (sort) {
      case 'artist':
      case 'artistAlbum':
        return 'ORDER BY albums.album_artist COLLATE NOCASE, albums.title COLLATE NOCASE';
      case 'recent':
      case 'createdDesc':
        return 'ORDER BY albums.updated_at DESC, albums.title COLLATE NOCASE';
      case 'createdAsc':
        return 'ORDER BY albums.created_at ASC, albums.title COLLATE NOCASE';
      case 'titleDesc':
        return 'ORDER BY albums.title COLLATE NOCASE DESC, albums.album_artist COLLATE NOCASE';
      case 'durationAsc':
        return 'ORDER BY albums.duration ASC, albums.title COLLATE NOCASE';
      case 'durationDesc':
        return 'ORDER BY albums.duration DESC, albums.title COLLATE NOCASE';
      case 'fileModifiedAsc':
        return `ORDER BY (
          SELECT MIN(tracks.mtime_ms)
          FROM album_tracks
          INNER JOIN tracks ON tracks.id = album_tracks.track_id
          WHERE album_tracks.album_id = albums.id
            AND tracks.missing = 0
        ) ASC, albums.title COLLATE NOCASE`;
      case 'fileModifiedDesc':
        return `ORDER BY (
          SELECT MAX(tracks.mtime_ms)
          FROM album_tracks
          INNER JOIN tracks ON tracks.id = album_tracks.track_id
          WHERE album_tracks.album_id = albums.id
            AND tracks.missing = 0
        ) DESC, albums.title COLLATE NOCASE`;
      case 'random':
        return 'ORDER BY RANDOM()';
      case 'album':
      case 'titleAsc':
      case 'default':
      case 'title':
      default:
        return 'ORDER BY albums.title COLLATE NOCASE, albums.album_artist COLLATE NOCASE';
    }
  }

  private artistOrderSql(sort: string): string {
    switch (sort) {
      case 'frequent':
        return 'ORDER BY artists.track_count DESC, artists.album_count DESC, artists.name COLLATE NOCASE';
      case 'createdDesc':
      case 'recent':
        return 'ORDER BY artists.updated_at DESC, artists.name COLLATE NOCASE';
      case 'createdAsc':
        return 'ORDER BY artists.created_at ASC, artists.name COLLATE NOCASE';
      case 'titleDesc':
        return 'ORDER BY artists.name COLLATE NOCASE DESC';
      case 'random':
        return 'ORDER BY RANDOM()';
      case 'artistAlbum':
      case 'artist':
      case 'titleAsc':
      case 'default':
      case 'title':
      default:
        return 'ORDER BY artists.sort_name COLLATE NOCASE, artists.name COLLATE NOCASE';
    }
  }

  private mapFolder(row: DbRow): LibraryFolder {
    return {
      id: String(row.id),
      path: String(row.path),
      name: String(row.name),
      status: Number(row.enabled ?? 1) === 0 || row.status === 'removed' ? 'removed' : 'active',
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapPlaybackHistoryEntry(row: DbRow): PlaybackHistoryEntry {
    const coverId = textOrNull(row.cover_id);
    const mediaType =
      row.media_type === 'remote' || row.media_type === 'streaming' ? row.media_type : 'local';
    const title = textOrNull(row.title_snapshot) ?? String(row.title);
    const artist = textOrNull(row.artist_snapshot) ?? String(row.artist);
    const album = textOrNull(row.album_snapshot) ?? String(row.album ?? '');
    const durationSnapshot = numberOrNull(row.duration_snapshot);
    const coverSnapshot = textOrNull(row.cover_snapshot);

    return {
      id: String(row.id),
      trackId: textOrNull(row.track_id),
      trackPath: String(row.track_path),
      mediaType,
      provider: textOrNull(row.provider),
      providerTrackId: textOrNull(row.provider_track_id),
      stableKey: textOrNull(row.stable_key),
      title,
      artist,
      album,
      albumArtist: String(row.album_artist ?? ''),
      coverId,
      coverThumb: coverId ? this.toCoverUrl(coverId, 'thumb') : coverSnapshot,
      startedAt: String(row.started_at),
      endedAt: textOrNull(row.ended_at),
      playedSeconds: Number(row.history_played_seconds_total ?? row.played_seconds ?? 0),
      durationSeconds: Number(row.duration_seconds ?? 0),
      durationSnapshot,
      coverSnapshot,
      playCount: Number(row.history_play_count ?? 1),
      completed: Number(row.completed_count ?? row.completed ?? 0) > 0,
      sourceType: textOrNull(row.source_type),
      sourceLabel: textOrNull(row.source_label),
      queueId: textOrNull(row.queue_id),
    };
  }

  private mapScanJob(row: DbRow): LibraryScanStatus {
    return {
      id: String(row.id),
      folderId: String(row.folder_id),
      status: this.mapScanStatus(row.status),
      phase: this.mapScanPhase(row.phase),
      totalFiles: Number(row.discovered_count ?? row.total_files ?? 0),
      processedFiles: Number(row.parsed_count ?? row.processed_files ?? 0),
      skippedFiles: Number(row.skipped_count ?? row.skipped_files ?? 0),
      addedTracks: Number(row.added_tracks ?? 0),
      updatedTracks: Number(row.updated_tracks ?? 0),
      removedTracks: Number(row.removed_tracks ?? 0),
      coverCount: Number(row.cover_count ?? 0),
      errorCount: Number(row.error_count ?? 0),
      errors: parseErrors(row.errors_json),
      startedAt: textOrNull(row.started_at),
      finishedAt: textOrNull(row.finished_at),
    };
  }

  private mapScanStatus(value: unknown): LibraryScanStatus['status'] {
    if (
      value === 'queued' ||
      value === 'running' ||
      value === 'completed' ||
      value === 'cancelled' ||
      value === 'failed'
    ) {
      return value;
    }

    return 'failed';
  }

  private mapScanPhase(value: unknown): LibraryScanStatus['phase'] {
    if (
      value === 'queued' ||
      value === 'discovering' ||
      value === 'checking_cache' ||
      value === 'reading_metadata' ||
      value === 'extracting_covers' ||
      value === 'grouping_albums' ||
      value === 'writing_database' ||
      value === 'finished' ||
      value === 'failed' ||
      value === 'cancelled'
    ) {
      return value;
    }

    return 'queued';
  }

  private mapTrack(row: DbRow): LibraryTrack {
    const mediaType = row.media_type === 'remote' || row.media_type === 'streaming' ? row.media_type : 'local';
    const path = String(row.path);
    const filenameGuess = filenameTrackFallback(path);
    const title = sanitizeLibraryText(row.title, filenameGuess.title);
    const artist = sanitizeLibraryText(row.artist, filenameGuess.artist ?? unknownArtist);
    const album = sanitizeLibraryText(row.album, '');
    const albumArtist = sanitizeLibraryText(row.album_artist, artist);
    const fieldSources = parseJsonObject(row.field_sources_json);

    return {
      id: String(row.id),
      mediaType,
      path,
      sourceId: textOrNull(row.source_id),
      sourceDisplayName: textOrNull(row.source_display_name),
      provider: textOrNull(row.provider),
      remotePath: textOrNull(row.remote_path),
      stableKey: textOrNull(row.stable_key),
      title,
      artist,
      album,
      albumArtist,
      trackNo: numberOrNull(row.track_no),
      discNo: numberOrNull(row.disc_no),
      year: numberOrNull(row.year),
      genre: sanitizeNullableLibraryText(row.genre),
      duration: Number(row.duration ?? 0),
      codec: sanitizeNullableLibraryText(row.codec, maxLibraryTechnicalTextLength),
      sampleRate: numberOrNull(row.sample_rate),
      bitDepth: numberOrNull(row.bit_depth),
      bitrate: numberOrNull(row.bitrate),
      bpm: numberOrNull(row.bpm),
      bpmConfidence: numberOrNull(row.bpm_confidence),
      beatOffsetMs: numberOrNull(row.beat_offset_ms),
      analysisStatus: this.mapAnalysisStatus(row.analysis_status),
      analysisUpdatedAt: textOrNull(row.analysis_updated_at),
      replayGainTrackGainDb: numberOrNull(row.replay_gain_track_gain_db),
      replayGainAlbumGainDb: numberOrNull(row.replay_gain_album_gain_db),
      replayGainTrackPeak: numberOrNull(row.replay_gain_track_peak),
      replayGainAlbumPeak: numberOrNull(row.replay_gain_album_peak),
      replayGainIntegratedLufs: numberOrNull(row.replay_gain_integrated_lufs),
      replayGainSource: this.mapReplayGainSource(row.replay_gain_source),
      replayGainStatus: this.mapReplayGainStatus(row.replay_gain_status),
      replayGainUpdatedAt: textOrNull(row.replay_gain_updated_at),
      coverId: textOrNull(row.cover_id),
      coverThumb: this.toCoverUrl(row.cover_id, 'thumb')
        ?? subsonicDirectCoverUrlFor(row.id, row.provider, row.cover_id, fieldSources, row.remote_path, row.stable_key),
      metadataStatus: textOrNull(row.metadata_status) ?? 'ok',
      embeddedMetadataStatus: this.mapEmbeddedStatus(row.embedded_metadata_status),
      embeddedCoverStatus: this.mapEmbeddedStatus(row.embedded_cover_status),
      networkMetadataStatus: this.mapNetworkStatus(row.network_metadata_status),
      fieldSources,
      unavailable: row.availability === 'missing',
    };
  }

  private mapArtist(row: DbRow): LibraryArtist {
    const trackCount = Number(row.track_count ?? 0);
    const albumCount = Number(row.album_count ?? 0);
    const artistKey = String(row.artist_key ?? '');
    const avatarStatus = artistImageStatusOrNull(row.avatar_status);
    const avatarProvider = textOrNull(row.avatar_provider);
    const avatarSourceHash = textOrNull(row.avatar_source_hash);
    const avatarThumbPath = textOrNull(row.avatar_thumb_path);
    const avatarMediumPath = textOrNull(row.avatar_medium_path);
    const avatarLargePath = textOrNull(row.avatar_large_path);
    const hasMatchedAvatar = avatarStatus === 'matched' && isCurrentArtistImageCacheSourceHash(avatarSourceHash);

    return {
      id: String(row.id),
      mediaType: row.media_type === 'remote' ? 'remote' : 'local',
      sourceId: textOrNull(row.source_id),
      sourceDisplayName: textOrNull(row.source_display_name),
      provider: textOrNull(row.provider),
      artistKey,
      name: sanitizeLibraryText(row.name, unknownArtist),
      sortName: sanitizeLibraryText(row.sort_name ?? row.name, sanitizeLibraryText(row.name, unknownArtist)),
      role: trackCount > 0 && albumCount > 0 ? 'both' : albumCount > 0 ? 'album' : 'track',
      trackCount,
      albumCount,
      coverId: textOrNull(row.cover_id),
      coverThumb: this.toCoverUrl(row.cover_id, 'album'),
      coverSource: coverSourceOrNull(row.cover_source),
      avatarThumbUrl: hasMatchedAvatar && avatarThumbPath ? this.toArtistImageUrl(artistKey, 'thumb') : null,
      avatarUrl: hasMatchedAvatar && (avatarLargePath || avatarMediumPath || avatarThumbPath)
        ? this.toArtistImageUrl(artistKey, avatarLargePath ? 'large' : 'medium')
        : null,
      avatarStatus,
      avatarProvider,
    };
  }

  private mapEmbeddedStatus(value: unknown): LibraryTrack['embeddedMetadataStatus'] {
    if (value === 'pending' || value === 'reading' || value === 'present' || value === 'missing' || value === 'error') {
      return value;
    }

    return 'pending';
  }

  private mapNetworkStatus(value: unknown): LibraryTrack['networkMetadataStatus'] {
    if (
      value === 'none' ||
      value === 'pending' ||
      value === 'candidate_found' ||
      value === 'applied_missing_only' ||
      value === 'rejected' ||
      value === 'error'
    ) {
      return value;
    }

    return 'none';
  }

  private mapAnalysisStatus(value: unknown): LibraryTrack['analysisStatus'] {
    if (
      value === 'pending' ||
      value === 'analyzing' ||
      value === 'complete' ||
      value === 'low_confidence' ||
      value === 'error'
    ) {
      return value;
    }

    return 'none';
  }

  private mapReplayGainSource(value: unknown): LibraryTrack['replayGainSource'] {
    if (value === 'tag' || value === 'analysis') {
      return value;
    }

    return 'none';
  }

  private mapReplayGainStatus(value: unknown): LibraryTrack['replayGainStatus'] {
    if (
      value === 'tagged' ||
      value === 'analyzing' ||
      value === 'complete' ||
      value === 'missing' ||
      value === 'error'
    ) {
      return value;
    }

    return 'none';
  }

  private mapAlbum(row: DbRow): LibraryAlbum {
    const title = sanitizeLibraryText(row.title, '');
    const albumArtist = sanitizeLibraryText(row.album_artist, unknownArtist);

    return {
      id: String(row.id),
      mediaType: row.media_type === 'remote' ? 'remote' : 'local',
      sourceId: textOrNull(row.source_id),
      sourceDisplayName: textOrNull(row.source_display_name),
      provider: textOrNull(row.provider),
      albumKey: String(row.album_key),
      title,
      albumArtist,
      year: numberOrNull(row.year),
      trackCount: Number(row.track_count ?? 0),
      duration: Number(row.duration ?? 0),
      coverId: textOrNull(row.cover_id),
      coverThumb: this.toCoverUrl(row.cover_id, 'album'),
    };
  }

  private mapAlbumDetail(row: DbRow): LibraryAlbumDetail {
    const album = this.mapAlbum(row);

    return {
      ...album,
      coverLarge: this.toCoverUrl(row.cover_id, 'large'),
    };
  }

  resolveCoverAsset(coverId: string, variant: CoverVariant): { filePath: string; mimeType: string | null } | null {
    const row = this.getRow(
      `SELECT mime_type, thumb_path, album_path, large_path, original_ref
       FROM covers
       WHERE id = ?`,
      coverId,
    );

    if (!row) {
      return null;
    }

    const thumbPath = textOrNull(row.thumb_path);
    const albumPath = textOrNull(row.album_path);
    const largePath = textOrNull(row.large_path);
    const originalRef = textOrNull(row.original_ref);
    const candidates =
      variant === 'thumb'
        ? [thumbPath, albumPath, largePath]
        : variant === 'album'
          ? [albumPath, thumbPath, largePath]
          : variant === 'large'
            ? [largePath, albumPath, thumbPath]
            : [originalRef];
    const filePath = candidates.find((candidate): candidate is string => Boolean(candidate)) ?? null;

    return filePath
      ? {
          filePath,
          mimeType: this.mimeTypeForCoverPath(filePath, textOrNull(row.mime_type)),
        }
      : null;
  }

  private toCoverUrl(value: unknown, variant: CoverVariant): string | null {
    const coverId = textOrNull(value);

    return coverId ? `echo-cover://${variant}/${encodeURIComponent(coverId)}` : null;
  }

  private toArtistImageUrl(artistKey: string, variant: 'thumb' | 'medium' | 'large'): string | null {
    return artistKey ? `echo-artist-image://${variant}/${encodeURIComponent(artistKey)}` : null;
  }

  private mimeTypeForCoverPath(filePath: string, fallback: string | null): string | null {
    const lowerPath = filePath.toLocaleLowerCase();

    if (lowerPath.endsWith('.webp')) {
      return 'image/webp';
    }

    if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
      return 'image/jpeg';
    }

    if (lowerPath.endsWith('.png')) {
      return 'image/png';
    }

    if (lowerPath.endsWith('.svg')) {
      return 'image/svg+xml';
    }

    return fallback;
  }

  private getRow(sql: string, ...params: unknown[]): DbRow | null {
    return this.database.prepare<unknown[], DbRow>(sql).get(...params) ?? null;
  }

  private allRows(sql: string, ...params: unknown[]): DbRow[] {
    return this.database.prepare<unknown[], DbRow>(sql).all(...params);
  }

  private createDuplicateTrackService(): DuplicateTrackService {
    return new DuplicateTrackService(this.database, (coverId, variant) => this.toCoverUrl(coverId, variant));
  }

  private run(sql: string, ...params: unknown[]): { changes: number } {
    return this.database.prepare(sql).run(...params);
  }
}
