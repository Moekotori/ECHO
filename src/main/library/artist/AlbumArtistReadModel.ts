import type { EchoDatabase } from '../../database/createDatabase';
import type { ArtistMergeStrategy } from '../../../shared/types/appSettings';
import type {
  ArtistImageCacheStatus,
  ArtistInsights,
  ArtistInsightsOptions,
  LibraryAlbum,
  LibraryArtist,
  LibraryPage,
  LibraryPageQuery,
  LibraryTrack,
} from '../../../shared/types/library';
import { artistMergeKeyForName, normalizeArtistMergeStrategy } from '../ArtistMerge';
import { isCurrentArtistImageCacheSourceHash } from '../artistImages/ArtistImageTypes';
import { emptyArtistOnlineInfo } from '../online/ArtistOnlineInfoService';
import { libraryTextOrderSql, libraryTextSortKey } from '../LibrarySortKey';

type DbRow = Record<string, unknown>;

export type AlbumArtistLocator =
  | { mediaType: 'local'; artistKey: string }
  | { mediaType: 'remote'; sourceId: string; artistKey: string };

type AlbumArtistSearchOptions = {
  artistMergeStrategy?: ArtistMergeStrategy | unknown;
};

const defaultPageSize = 96;
const maxPageSize = 500;
const unknownArtist = 'Unknown Artist';
const albumArtistIdPrefix = 'album-artist:';
const unknownArtistSql = `'${unknownArtist.replaceAll("'", "''")}'`;
const zeroWidthPattern = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu;

const creditSql = (table: 'tracks' | 'remote_tracks'): string =>
  `COALESCE(NULLIF(TRIM(${table}.artist), ''), NULLIF(TRIM(${table}.album_artist), ''), ${unknownArtistSql})`;

const sqlIn = (count: number): string =>
  count > 0 ? `IN (${Array.from({ length: count }, () => '?').join(', ')})` : 'IN (NULL)';

const textOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const numberOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseJsonObject = (value: unknown): Record<string, string> => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
};

const toCoverUrl = (coverId: string | null, variant: 'thumb' | 'album'): string | null =>
  coverId ? `echo-cover://${variant}/${encodeURIComponent(coverId)}` : null;

const toArtistImageUrl = (artistKey: string, variant: 'thumb' | 'medium' | 'large'): string | null =>
  artistKey ? `echo-artist-image://${variant}/${encodeURIComponent(artistKey)}` : null;

const artistImageStatusOrNull = (value: unknown): ArtistImageCacheStatus | null =>
  value === 'pending' ||
  value === 'loading' ||
  value === 'matched' ||
  value === 'not_found' ||
  value === 'error' ||
  value === 'rate_limited'
    ? value
    : null;

const emptyPage = <T>(page: number, pageSize: number): LibraryPage<T> => ({
  items: [],
  page,
  pageSize,
  total: 0,
  hasMore: false,
});

const pageFromQuery = (
  query?: LibraryPageQuery,
): { page: number; pageSize: number; search: string; sort: string; sourceId: string | null; prioritizeArtistAvatars: boolean } => ({
  page: Math.max(1, Math.floor(Number(query?.page ?? 1))),
  pageSize: Math.min(maxPageSize, Math.max(1, Math.floor(Number(query?.pageSize ?? defaultPageSize)))),
  search: typeof query?.search === 'string' ? query.search.trim() : '',
  sort: query?.sort ?? 'default',
  sourceId: typeof query?.sourceId === 'string' && query.sourceId.trim().length > 0 ? query.sourceId.trim() : null,
  prioritizeArtistAvatars: query?.prioritizeArtistAvatars === true,
});

const isRemoteQuery = (query?: LibraryPageQuery): boolean => query?.sourceProvider === 'remote';

const normalizeCreditPart = (value: unknown): string =>
  typeof value === 'string' ? value.normalize('NFKC').replace(zeroWidthPattern, '').replace(/\s+/gu, ' ').trim() : '';

// Album-artist tags are often only the primary name. Keep the full track credit.
export const albumArtistCreditForNames = (albumArtist: unknown, artist: unknown): string =>
  normalizeCreditPart(artist) || normalizeCreditPart(albumArtist) || unknownArtist;

export const encodeAlbumArtistId = (locator: AlbumArtistLocator): string => {
  const payload = locator.mediaType === 'remote'
    ? `r\u001f${locator.sourceId}\u001f${locator.artistKey}`
    : `l\u001f${locator.artistKey}`;
  return `${albumArtistIdPrefix}${Buffer.from(payload, 'utf8').toString('hex')}`;
};

export const albumArtistLocatorFromId = (artistId: string): AlbumArtistLocator | null => {
  if (!artistId.startsWith(albumArtistIdPrefix)) {
    return null;
  }

  const encoded = artistId.slice(albumArtistIdPrefix.length);
  if (!encoded || encoded.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(encoded)) {
    return null;
  }

  const decoded = Buffer.from(encoded, 'hex').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('hex') !== encoded.toLowerCase()) {
    return null;
  }

  const parts = decoded.split('\u001f');
  if (parts[0] === 'l' && parts.length === 2 && parts[1]) {
    return { mediaType: 'local', artistKey: parts[1] };
  }
  if (parts[0] === 'r' && parts.length === 3 && parts[1] && parts[2]) {
    return { mediaType: 'remote', sourceId: parts[1], artistKey: parts[2] };
  }

  return null;
};

export const isAlbumArtistId = (artistId: string): boolean => albumArtistLocatorFromId(artistId) !== null;

const compareNames = (left: string, right: string): number =>
  libraryTextSortKey(left).localeCompare(libraryTextSortKey(right))
  || left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });

const timestampValue = (value: unknown): number => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const mergeGroupedCredits = (rows: DbRow[], strategy: ArtistMergeStrategy, remote: boolean): DbRow[] => {
  const merged = new Map<string, DbRow>();
  for (const row of rows) {
    const displayName = String(row.display_name ?? unknownArtist);
    const artistKey = artistMergeKeyForName(displayName, strategy);
    const mergeKey = remote ? `${String(row.source_id ?? '')}\u001f${artistKey}` : artistKey;
    const trackCount = Number(row.track_count ?? 0);
    const existing = merged.get(mergeKey);
    if (!existing) {
      merged.set(mergeKey, {
        ...row,
        artist_key: artistKey,
        display_name: displayName,
        track_count: trackCount,
        album_count: Number(row.album_count ?? 0),
        play_count: Number(row.play_count ?? 0),
        name_weight: trackCount,
      });
      continue;
    }

    const existingWeight = Number(existing.name_weight ?? 0);
    const shouldReplaceName =
      trackCount > existingWeight
      || (trackCount === existingWeight && compareNames(displayName, String(existing.display_name ?? '')) < 0);
    existing.track_count = Number(existing.track_count ?? 0) + trackCount;
    existing.album_count = Number(existing.album_count ?? 0) + Number(row.album_count ?? 0);
    existing.play_count = Number(existing.play_count ?? 0) + Number(row.play_count ?? 0);
    if (timestampValue(row.last_played_at) > timestampValue(existing.last_played_at)) {
      existing.last_played_at = row.last_played_at;
    }
    if (timestampValue(row.added_at) > timestampValue(existing.added_at)) {
      existing.added_at = row.added_at;
    }
    if (!textOrNull(existing.cover_id) && textOrNull(row.cover_id)) {
      existing.cover_id = row.cover_id;
    }
    if (shouldReplaceName) {
      existing.display_name = displayName;
      existing.name_weight = trackCount;
    }
  }

  return [...merged.values()];
};

const hasMatchedAvatarRow = (row: DbRow): boolean =>
  artistImageStatusOrNull(row.avatar_status) === 'matched'
  && isCurrentArtistImageCacheSourceHash(textOrNull(row.avatar_source_hash))
  && Boolean(textOrNull(row.avatar_large_path) || textOrNull(row.avatar_medium_path) || textOrNull(row.avatar_thumb_path));

const compareGroupedArtists = (left: DbRow, right: DbRow, sort: string): number => {
  const byName = (): number => compareNames(String(left.display_name ?? ''), String(right.display_name ?? ''));
  if (sort === 'frequent' || sort === 'trackCountDesc') {
    return Number(right.track_count ?? 0) - Number(left.track_count ?? 0)
      || Number(right.album_count ?? 0) - Number(left.album_count ?? 0)
      || byName();
  }
  if (sort === 'trackCountAsc') {
    return Number(left.track_count ?? 0) - Number(right.track_count ?? 0)
      || Number(left.album_count ?? 0) - Number(right.album_count ?? 0)
      || byName();
  }
  if (sort === 'albumCountDesc') {
    return Number(right.album_count ?? 0) - Number(left.album_count ?? 0)
      || Number(right.track_count ?? 0) - Number(left.track_count ?? 0)
      || byName();
  }
  if (sort === 'lastPlayed') {
    return timestampValue(right.last_played_at) - timestampValue(left.last_played_at) || byName();
  }
  if (sort === 'playCountDesc') {
    return Number(right.play_count ?? 0) - Number(left.play_count ?? 0) || byName();
  }
  if (sort === 'playCountAsc') {
    return Number(left.play_count ?? 0) - Number(right.play_count ?? 0) || byName();
  }
  if (sort === 'createdAsc') {
    return timestampValue(left.added_at) - timestampValue(right.added_at) || byName();
  }
  if (sort === 'createdDesc' || sort === 'recent') {
    return timestampValue(right.added_at) - timestampValue(left.added_at) || byName();
  }
  if (sort === 'titleDesc') {
    return compareNames(String(right.display_name ?? ''), String(left.display_name ?? ''));
  }
  return byName();
};

const sortGroupedArtists = (rows: DbRow[], sort: string, prioritizeAvatars: boolean): DbRow[] => {
  const next = [...rows];
  if (sort === 'random') {
    for (let index = next.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    }
    if (!prioritizeAvatars) {
      return next;
    }
  }

  next.sort((left, right) => {
    if (prioritizeAvatars) {
      const avatarDelta = Number(hasMatchedAvatarRow(right)) - Number(hasMatchedAvatarRow(left));
      if (avatarDelta !== 0) {
        return avatarDelta;
      }
    }
    return sort === 'random' ? 0 : compareGroupedArtists(left, right, sort);
  });
  return next;
};

const trackOrderSql = (sort: string, tableName = 'tracks'): string => {
  if (sort === 'titleAsc' || sort === 'title') {
    return `ORDER BY ${libraryTextOrderSql(`${tableName}.title`, 'ASC')}`;
  }
  if (sort === 'titleDesc') {
    return `ORDER BY ${libraryTextOrderSql(`${tableName}.title`, 'DESC')}`;
  }
  if (sort === 'durationDesc') {
    return `ORDER BY ${tableName}.duration DESC, ${libraryTextOrderSql(`${tableName}.title`, 'ASC')}`;
  }
  if (sort === 'durationAsc') {
    return `ORDER BY ${tableName}.duration ASC, ${libraryTextOrderSql(`${tableName}.title`, 'ASC')}`;
  }
  if (sort === 'random') {
    return 'ORDER BY RANDOM()';
  }
  return `ORDER BY ${libraryTextOrderSql(`${tableName}.album`, 'ASC')}, ${tableName}.disc_no ASC, ${tableName}.track_no ASC, ${libraryTextOrderSql(`${tableName}.title`, 'ASC')}`;
};

const albumOrderSql = (sort: string, tableName: 'albums' | 'grouped'): string => {
  const title = tableName === 'albums' ? 'albums.title' : 'title';
  const year = tableName === 'albums' ? 'albums.year' : 'year';
  const createdAt = tableName === 'albums' ? 'albums.created_at' : 'title';
  if (sort === 'titleDesc') {
    return `ORDER BY ${libraryTextOrderSql(title, 'DESC')}`;
  }
  if (sort === 'yearAsc') {
    return `ORDER BY ${year} IS NULL, ${year} ASC, ${libraryTextOrderSql(title, 'ASC')}`;
  }
  if (sort === 'yearDesc') {
    return `ORDER BY ${year} IS NULL, ${year} DESC, ${libraryTextOrderSql(title, 'ASC')}`;
  }
  if (sort === 'recent' && tableName === 'albums') {
    return `ORDER BY ${createdAt} DESC, ${libraryTextOrderSql(title, 'ASC')}`;
  }
  return `ORDER BY ${libraryTextOrderSql(title, 'ASC')}`;
};

const mapArtist = (row: DbRow, locator: AlbumArtistLocator): LibraryArtist => {
  const trackCount = Number(row.track_count ?? 0);
  const albumCount = Number(row.album_count ?? 0);
  const artistKey = String(row.artist_key ?? locator.artistKey);
  const avatarStatus = artistImageStatusOrNull(row.avatar_status);
  const avatarSourceHash = textOrNull(row.avatar_source_hash);
  const avatarThumbPath = textOrNull(row.avatar_thumb_path);
  const avatarMediumPath = textOrNull(row.avatar_medium_path);
  const avatarLargePath = textOrNull(row.avatar_large_path);
  const hasMatchedAvatar = avatarStatus === 'matched' && isCurrentArtistImageCacheSourceHash(avatarSourceHash);
  const coverId = textOrNull(row.cover_id);
  const name = String(row.display_name ?? unknownArtist);

  return {
    id: encodeAlbumArtistId(locator),
    mediaType: locator.mediaType,
    sourceId: locator.mediaType === 'remote' ? locator.sourceId : textOrNull(row.source_id),
    sourceDisplayName: textOrNull(row.source_display_name),
    provider: textOrNull(row.provider),
    artistKey,
    name,
    sortName: name,
    role: trackCount > 0 && albumCount > 0 ? 'both' : albumCount > 0 ? 'album' : 'track',
    trackCount,
    albumCount,
    coverId,
    coverThumb: toCoverUrl(coverId, 'album'),
    avatarThumbUrl: hasMatchedAvatar && avatarThumbPath ? toArtistImageUrl(artistKey, 'thumb') : null,
    avatarUrl: hasMatchedAvatar && (avatarLargePath || avatarMediumPath || avatarThumbPath)
      ? toArtistImageUrl(artistKey, avatarLargePath ? 'large' : 'medium')
      : null,
    avatarStatus,
    avatarProvider: textOrNull(row.avatar_provider),
  };
};

const mapTrack = (row: DbRow): LibraryTrack => {
  const mediaType = row.media_type === 'remote' ? 'remote' : 'local';
  const coverId = textOrNull(row.cover_id);
  return {
    id: String(row.id),
    mediaType,
    path: String(row.path ?? ''),
    sourceId: textOrNull(row.source_id),
    sourceDisplayName: textOrNull(row.source_display_name),
    provider: textOrNull(row.provider),
    remotePath: textOrNull(row.remote_path),
    stableKey: textOrNull(row.stable_key),
    title: String(row.title ?? ''),
    artist: String(row.artist ?? unknownArtist),
    album: String(row.album ?? ''),
    albumArtist: String(row.album_artist ?? row.artist ?? unknownArtist),
    trackNo: numberOrNull(row.track_no),
    discNo: numberOrNull(row.disc_no),
    year: numberOrNull(row.year),
    genre: textOrNull(row.genre),
    duration: Number(row.duration ?? 0),
    codec: textOrNull(row.codec),
    sampleRate: numberOrNull(row.sample_rate),
    bitDepth: numberOrNull(row.bit_depth),
    bitrate: numberOrNull(row.bitrate),
    coverId,
    coverThumb: toCoverUrl(coverId, 'thumb'),
    fieldSources: parseJsonObject(row.field_sources_json),
  };
};

const mapAlbum = (row: DbRow): LibraryAlbum => {
  const coverId = textOrNull(row.cover_id);
  return {
    id: String(row.id),
    mediaType: row.media_type === 'remote' ? 'remote' : 'local',
    sourceId: textOrNull(row.source_id),
    sourceDisplayName: textOrNull(row.source_display_name),
    provider: textOrNull(row.provider),
    albumKey: String(row.album_key ?? row.id),
    title: String(row.title ?? ''),
    albumArtist: String(row.album_artist ?? unknownArtist),
    year: numberOrNull(row.year),
    trackCount: Number(row.track_count ?? 0),
    duration: Number(row.duration ?? 0),
    coverId,
    coverThumb: toCoverUrl(coverId, 'album'),
  };
};

const emptyConcerts = (region: string | null | undefined): ArtistInsights['concerts'] => ({
  status: 'not_configured',
  region: region ?? null,
  sources: [],
  events: [],
  fetchedAt: null,
  message: 'Configure artist event providers in Settings to load concerts.',
});

export class AlbumArtistReadModel {
  constructor(
    private readonly database: EchoDatabase,
    private readonly readSearchOptions: () => AlbumArtistSearchOptions = () => ({}),
  ) {
    this.ensureSqlFunction('echo_library_sort_key', libraryTextSortKey);
    this.ensureSqlFunction('echo_artist_merge_key', (value: unknown) => artistMergeKeyForName(value, this.mergeStrategy()));
  }

  private ensureSqlFunction(name: string, fn: (...args: unknown[]) => unknown): void {
    try {
      this.database.prepare(`SELECT ${name}(?)`).get(null);
    } catch {
      this.database.function(name, fn);
    }
  }

  getArtists(query?: LibraryPageQuery): LibraryPage<LibraryArtist> {
    const { page, pageSize, search, sort, sourceId, prioritizeArtistAvatars } = pageFromQuery(query);
    const offset = (page - 1) * pageSize;
    const remote = isRemoteQuery(query);
    const rows = mergeGroupedCredits(
      this.allRows(this.groupedCreditsSql(remote, sourceId), ...this.sourceParams(remote, sourceId)),
      this.mergeStrategy(),
      remote,
    );
    this.attachAvatars(rows);
    const filtered = search
      ? rows.filter((row) => String(row.display_name ?? '').toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      : rows;
    const sorted = sortGroupedArtists(filtered, sort, prioritizeArtistAvatars);
    const pageRows = sorted.slice(offset, offset + pageSize);

    return {
      items: pageRows.map((row) => mapArtist(row, this.locatorFromRow(row, remote))),
      page,
      pageSize,
      total: sorted.length,
      hasMore: offset + pageRows.length < sorted.length,
    };
  }

  getArtist(artistId: string): LibraryArtist | null {
    const locator = albumArtistLocatorFromId(artistId);
    if (!locator) {
      return null;
    }

    const credits = this.creditsForLocator(locator);
    if (credits.length === 0) {
      return null;
    }

    const remote = locator.mediaType === 'remote';
    const row = remote ? this.getRemoteArtistRow(locator.sourceId, credits) : this.getLocalArtistRow(credits);
    if (!row) {
      return null;
    }

    row.artist_key = locator.artistKey;
    this.attachAvatars([row]);
    return mapArtist(row, locator);
  }

  getArtistInsights(artistId: string, options: ArtistInsightsOptions = {}): ArtistInsights {
    const artist = this.getArtist(artistId);
    return {
      artist,
      nodes: [],
      edges: [],
      onlineInfo: emptyArtistOnlineInfo(artist ? undefined : 'Artist not found.'),
      concerts: emptyConcerts(options.region),
      generatedAt: new Date().toISOString(),
    };
  }

  getArtistTracks(artistId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize' | 'sort'>): LibraryPage<LibraryTrack> {
    const locator = albumArtistLocatorFromId(artistId);
    const { page, pageSize, sort } = pageFromQuery(query);
    const offset = (page - 1) * pageSize;
    if (!locator) {
      return emptyPage(page, pageSize);
    }

    const credits = this.creditsForLocator(locator);
    if (credits.length === 0) {
      return emptyPage(page, pageSize);
    }

    if (locator.mediaType === 'remote') {
      const params = [...credits, locator.sourceId];
      const totalRow = this.getRow(
        `SELECT COUNT(*) AS total
         FROM remote_tracks
         INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
         WHERE remote_tracks.availability != 'missing'
           AND remote_sources.status = 'enabled'
           AND ${creditSql('remote_tracks')} ${sqlIn(credits.length)}
           AND remote_tracks.source_id = ?`,
        ...params,
      );
      const rows = this.allRows(
        `SELECT
          remote_tracks.id,
          'remote://' || remote_tracks.source_id || remote_tracks.remote_path AS path,
          remote_tracks.remote_path, remote_tracks.stable_key,
          remote_tracks.title, remote_tracks.artist, remote_tracks.album, remote_tracks.album_artist,
          remote_tracks.track_no, remote_tracks.disc_no, remote_tracks.year, remote_tracks.genre,
          remote_tracks.duration, remote_tracks.codec, remote_tracks.sample_rate, remote_tracks.bit_depth, remote_tracks.bitrate,
          remote_tracks.cover_id, remote_tracks.field_sources_json, remote_tracks.source_id, remote_tracks.provider,
          remote_tracks.created_at, remote_sources.display_name AS source_display_name, 'remote' AS media_type
         FROM remote_tracks
         INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
         WHERE remote_tracks.availability != 'missing'
           AND remote_sources.status = 'enabled'
           AND ${creditSql('remote_tracks')} ${sqlIn(credits.length)}
           AND remote_tracks.source_id = ?
         ${trackOrderSql(sort, 'remote_tracks')}
         LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      );
      const total = Number(totalRow?.total ?? 0);
      return {
        items: rows.map((row) => mapTrack(row)),
        page,
        pageSize,
        total,
        hasMore: offset + rows.length < total,
      };
    }

    const totalRow = this.getRow(
      `SELECT COUNT(*) AS total
       FROM tracks
       WHERE tracks.missing = 0
         AND ${creditSql('tracks')} ${sqlIn(credits.length)}`,
      ...credits,
    );
    const rows = this.allRows(
      `SELECT
        tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
        tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
        tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
        tracks.cover_id, tracks.field_sources_json, 'local' AS media_type
       FROM tracks
       WHERE tracks.missing = 0
         AND ${creditSql('tracks')} ${sqlIn(credits.length)}
       ${trackOrderSql(sort)}
       LIMIT ? OFFSET ?`,
      ...credits,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);
    return {
      items: rows.map((row) => mapTrack(row)),
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  getArtistAlbums(artistId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize' | 'sort'>): LibraryPage<LibraryAlbum> {
    const locator = albumArtistLocatorFromId(artistId);
    const { page, pageSize, sort } = pageFromQuery(query);
    const offset = (page - 1) * pageSize;
    if (!locator) {
      return emptyPage(page, pageSize);
    }

    const credits = this.creditsForLocator(locator);
    if (credits.length === 0) {
      return emptyPage(page, pageSize);
    }

    if (locator.mediaType === 'remote') {
      const params = [...credits, locator.sourceId];
      const totalRow = this.getRow(
        `SELECT COUNT(*) AS total FROM (
           SELECT remote_tracks.source_id, remote_tracks.album, remote_tracks.album_artist
           FROM remote_tracks
           INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
           WHERE remote_tracks.availability != 'missing'
             AND remote_sources.status = 'enabled'
             AND ${creditSql('remote_tracks')} ${sqlIn(credits.length)}
             AND remote_tracks.source_id = ?
           GROUP BY remote_tracks.source_id, remote_tracks.album, remote_tracks.album_artist
         )`,
        ...params,
      );
      const rows = this.allRows(
        `SELECT
          MIN(remote_tracks.id) AS id,
          remote_tracks.album AS title,
          ${creditSql('remote_tracks')} AS album_artist,
          MIN(remote_tracks.year) AS year,
          COUNT(*) AS track_count,
          SUM(COALESCE(remote_tracks.duration, 0)) AS duration,
          MIN(remote_tracks.cover_id) AS cover_id,
          remote_tracks.source_id AS source_id,
          remote_tracks.provider AS provider,
          remote_sources.display_name AS source_display_name,
          MIN(remote_tracks.id) AS album_key,
          'remote' AS media_type
         FROM remote_tracks
         INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
         WHERE remote_tracks.availability != 'missing'
           AND remote_sources.status = 'enabled'
           AND ${creditSql('remote_tracks')} ${sqlIn(credits.length)}
           AND remote_tracks.source_id = ?
         GROUP BY remote_tracks.source_id, remote_tracks.album, remote_tracks.album_artist, remote_tracks.provider, remote_sources.display_name
         ${albumOrderSql(sort, 'grouped')}
         LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      );
      const total = Number(totalRow?.total ?? 0);
      return {
        items: rows.map((row) => mapAlbum(row)),
        page,
        pageSize,
        total,
        hasMore: offset + rows.length < total,
      };
    }

    const totalRow = this.getRow(
      `SELECT COUNT(DISTINCT albums.id) AS total
       FROM albums
       INNER JOIN album_tracks ON album_tracks.album_id = albums.id
       INNER JOIN tracks ON tracks.id = album_tracks.track_id
       WHERE tracks.missing = 0
         AND ${creditSql('tracks')} ${sqlIn(credits.length)}`,
      ...credits,
    );
    const rows = this.allRows(
      `SELECT
        albums.id, albums.album_key, albums.title, albums.album_artist, albums.year,
        albums.track_count, albums.duration, albums.cover_id, 'local' AS media_type
       FROM albums
       WHERE albums.id IN (
         SELECT DISTINCT album_tracks.album_id
         FROM album_tracks
         INNER JOIN tracks ON tracks.id = album_tracks.track_id
         WHERE tracks.missing = 0
           AND ${creditSql('tracks')} ${sqlIn(credits.length)}
       )
       ${albumOrderSql(sort, 'albums')}
       LIMIT ? OFFSET ?`,
      ...credits,
      pageSize,
      offset,
    );
    const total = Number(totalRow?.total ?? 0);
    return {
      items: rows.map((row) => mapAlbum(row)),
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  private mergeStrategy(): ArtistMergeStrategy {
    return normalizeArtistMergeStrategy(this.readSearchOptions().artistMergeStrategy);
  }

  private groupedCreditsSql(remote: boolean, sourceId: string | null): string {
    if (remote) {
      const sourceFilterSql = sourceId ? 'AND remote_tracks.source_id = ?' : '';
      return `SELECT
          ${creditSql('remote_tracks')} AS display_name,
          COUNT(*) AS track_count,
          COUNT(DISTINCT remote_tracks.album || CHAR(31) || COALESCE(remote_tracks.album_artist, '')) AS album_count,
          MIN(NULLIF(TRIM(remote_tracks.cover_id), '')) AS cover_id,
          remote_tracks.source_id AS source_id,
          MIN(remote_tracks.provider) AS provider,
          MIN(remote_sources.display_name) AS source_display_name,
          NULL AS last_played_at,
          0 AS play_count,
          MAX(remote_tracks.created_at) AS added_at
        FROM remote_tracks
        INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
        WHERE remote_tracks.availability != 'missing'
          AND remote_sources.status = 'enabled'
          ${sourceFilterSql}
        GROUP BY ${creditSql('remote_tracks')}, remote_tracks.source_id`;
    }

    return `WITH track_credits AS (
        SELECT
          id AS track_id,
          ${creditSql('tracks')} AS display_name,
          cover_id,
          last_played_at,
          COALESCE(play_count, 0) AS play_count,
          created_at
        FROM tracks
        WHERE missing = 0
      ),
      track_grouped AS (
        SELECT
          display_name,
          COUNT(*) AS track_count,
          MAX(last_played_at) AS last_played_at,
          SUM(play_count) AS play_count,
          MAX(created_at) AS added_at,
          MIN(NULLIF(TRIM(cover_id), '')) AS cover_id
        FROM track_credits
        GROUP BY display_name
      ),
      album_grouped AS (
        SELECT
          track_credits.display_name AS display_name,
          COUNT(DISTINCT album_tracks.album_id) AS album_count,
          MIN(NULLIF(TRIM(COALESCE(albums.cover_id, track_credits.cover_id)), '')) AS cover_id
        FROM track_credits
        LEFT JOIN album_tracks ON album_tracks.track_id = track_credits.track_id
        LEFT JOIN albums ON albums.id = album_tracks.album_id
        GROUP BY track_credits.display_name
      )
      SELECT
        track_grouped.display_name AS display_name,
        track_grouped.track_count AS track_count,
        COALESCE(album_grouped.album_count, 0) AS album_count,
        COALESCE(album_grouped.cover_id, track_grouped.cover_id) AS cover_id,
        NULL AS source_id,
        NULL AS provider,
        NULL AS source_display_name,
        track_grouped.last_played_at AS last_played_at,
        track_grouped.play_count AS play_count,
        track_grouped.added_at AS added_at
      FROM track_grouped
      LEFT JOIN album_grouped ON album_grouped.display_name = track_grouped.display_name`;
  }

  private getLocalArtistRow(credits: string[]): DbRow | null {
    return this.getRow(
      `WITH matched AS (
         SELECT
           id AS track_id,
           ${creditSql('tracks')} AS display_name,
           cover_id
         FROM tracks
         WHERE missing = 0
           AND ${creditSql('tracks')} ${sqlIn(credits.length)}
       ),
       canonical AS (
         SELECT display_name
         FROM matched
         GROUP BY display_name
         ORDER BY COUNT(*) DESC, ${libraryTextOrderSql('display_name')}
         LIMIT 1
       )
       SELECT
         canonical.display_name AS display_name,
         (SELECT COUNT(*) FROM matched) AS track_count,
         (SELECT COUNT(DISTINCT album_tracks.album_id)
          FROM matched
          LEFT JOIN album_tracks ON album_tracks.track_id = matched.track_id) AS album_count,
         (SELECT MIN(NULLIF(TRIM(COALESCE(albums.cover_id, matched.cover_id)), ''))
          FROM matched
          LEFT JOIN album_tracks ON album_tracks.track_id = matched.track_id
          LEFT JOIN albums ON albums.id = album_tracks.album_id) AS cover_id
       FROM canonical`,
      ...credits,
    );
  }

  private getRemoteArtistRow(sourceId: string, credits: string[]): DbRow | null {
    return this.getRow(
      `WITH matched AS (
         SELECT
           remote_tracks.id AS track_id,
           ${creditSql('remote_tracks')} AS display_name,
           remote_tracks.cover_id AS cover_id,
           remote_tracks.source_id AS source_id,
           remote_tracks.provider AS provider,
           remote_sources.display_name AS source_display_name,
           remote_tracks.album AS album_title,
           remote_tracks.album_artist AS album_title_artist
         FROM remote_tracks
         INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
         WHERE remote_tracks.availability != 'missing'
           AND remote_sources.status = 'enabled'
           AND ${creditSql('remote_tracks')} ${sqlIn(credits.length)}
           AND remote_tracks.source_id = ?
       ),
       canonical AS (
         SELECT display_name
         FROM matched
         GROUP BY display_name
         ORDER BY COUNT(*) DESC, ${libraryTextOrderSql('display_name')}
         LIMIT 1
       )
       SELECT
         canonical.display_name AS display_name,
         (SELECT COUNT(*) FROM matched) AS track_count,
         (SELECT COUNT(DISTINCT album_title || CHAR(31) || COALESCE(album_title_artist, '')) FROM matched) AS album_count,
         (SELECT MIN(NULLIF(TRIM(cover_id), '')) FROM matched) AS cover_id,
         (SELECT source_id FROM matched LIMIT 1) AS source_id,
         (SELECT provider FROM matched LIMIT 1) AS provider,
         (SELECT source_display_name FROM matched LIMIT 1) AS source_display_name
       FROM canonical`,
      ...credits,
      sourceId,
    );
  }

  private creditsForLocator(locator: AlbumArtistLocator): string[] {
    const strategy = this.mergeStrategy();
    if (locator.mediaType === 'remote') {
      const rows = this.allRows(
        `SELECT DISTINCT ${creditSql('remote_tracks')} AS display_name
         FROM remote_tracks
         INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
         WHERE remote_tracks.availability != 'missing'
           AND remote_sources.status = 'enabled'
           AND remote_tracks.source_id = ?
           AND echo_artist_merge_key(${creditSql('remote_tracks')}) = ?`,
        locator.sourceId,
        locator.artistKey,
      );
      return rows
        .map((row) => String(row.display_name ?? ''))
        .filter((name) => name.length > 0 && artistMergeKeyForName(name, strategy) === locator.artistKey);
    }

    const rows = this.allRows(
      `SELECT DISTINCT ${creditSql('tracks')} AS display_name
       FROM tracks
       WHERE missing = 0
         AND echo_artist_merge_key(${creditSql('tracks')}) = ?`,
      locator.artistKey,
    );
    return rows
      .map((row) => String(row.display_name ?? ''))
      .filter((name) => name.length > 0 && artistMergeKeyForName(name, strategy) === locator.artistKey);
  }

  private attachAvatars(rows: DbRow[]): void {
    if (rows.length === 0) {
      return;
    }

    const cacheRows = this.allRows(
      `SELECT
         artist_key,
         status AS avatar_status,
         provider AS avatar_provider,
         source_hash AS avatar_source_hash,
         thumb_path AS avatar_thumb_path,
         medium_path AS avatar_medium_path,
         large_path AS avatar_large_path
       FROM artist_image_cache`,
    );
    const cache = new Map(cacheRows.map((row) => [String(row.artist_key ?? ''), row]));
    for (const row of rows) {
      const cached = cache.get(String(row.artist_key ?? ''));
      if (!cached) {
        continue;
      }
      row.avatar_status = cached.avatar_status;
      row.avatar_provider = cached.avatar_provider;
      row.avatar_source_hash = cached.avatar_source_hash;
      row.avatar_thumb_path = cached.avatar_thumb_path;
      row.avatar_medium_path = cached.avatar_medium_path;
      row.avatar_large_path = cached.avatar_large_path;
    }
  }

  private locatorFromRow(row: DbRow, remote: boolean): AlbumArtistLocator {
    const artistKey = String(row.artist_key ?? '');
    if (remote) {
      return { mediaType: 'remote', sourceId: String(row.source_id ?? ''), artistKey };
    }
    return { mediaType: 'local', artistKey };
  }

  private sourceParams(remote: boolean, sourceId: string | null): string[] {
    return remote && sourceId ? [sourceId] : [];
  }

  private getRow(sql: string, ...params: unknown[]): DbRow | null {
    return (this.database.prepare(sql).get(...params) as DbRow | undefined) ?? null;
  }

  private allRows(sql: string, ...params: unknown[]): DbRow[] {
    return this.database.prepare(sql).all(...params) as DbRow[];
  }
}
