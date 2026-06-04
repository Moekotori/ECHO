import { randomUUID } from 'node:crypto';
import type { EchoDatabase } from '../../database/createDatabase';
import type { RemoteAlbumMergeStrategy } from '../../../shared/types/appSettings';
import type { LibraryPage, LibrarySort, LibraryTrack } from '../../../shared/types/library';
import type {
  RemoteAlbumGroupingPreview,
  RemoteBackgroundJobKind,
  RemoteIndexedFolderStats,
  RemoteIndexedTracksQuery,
  RemoteLibraryTrack,
  RemoteSourceIssueItem,
  RemoteSourceIssueKind,
  RemoteSourceOverview,
  RemoteSourceOverviewItem,
  RemoteSource,
  RemoteSourceAuthType,
  RemoteSourceInput,
  RemoteSourceProvider,
  RemoteSourceStatus,
  RemoteSourceSyncMode,
  RemoteSourceUpdate,
  RemoteTrackLookupItem,
} from '../../../shared/types/remoteSources';
import type { RemoteSourceSecret, RemoteTrackWrite } from './remoteTypes';
import { RemoteSourceSecretStore } from './RemoteSourceSecretStore';
import { normalizeRemoteDirectoryPath } from './remoteIdentity';
import { buildTrackSearchTerms, buildTrackSearchTermsAsync } from '../SearchIndexTokens';
import { remoteCoverCacheKeyFor, subsonicDirectCoverUrlFor } from './remoteCoverUrls';
import { remoteAlbumGroupingKey, type RemoteAlbumGroupingTrack } from './RemoteAlbumGrouping';

type DbRow = Record<string, unknown>;

const nowIso = (): string => new Date().toISOString();
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const escapeSqlLike = (value: string): string => value.replace(/[\\%_]/gu, '\\$&');
const remoteIndexedDefaultPageSize = 100;
const remoteIndexedMaxPageSize = 500;

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const providerOrWebdav = (value: unknown): RemoteSourceProvider =>
  value === 'baidu' || value === 'jellyfin' || value === 'emby' || value === 'smb' || value === 'sshfs' || value === 'subsonic' ? value : 'webdav';

const statusOrEnabled = (value: unknown): RemoteSourceStatus =>
  value === 'disabled' || value === 'error' ? value : 'enabled';

const authTypeOrBasic = (value: unknown): RemoteSourceAuthType =>
  value === 'none' || value === 'token' || value === 'apiKey' ? value : 'basic';

const syncModeOrIndex = (value: unknown): RemoteSourceSyncMode =>
  value === 'browse' || value === 'mirror' ? value : 'index';

const remoteTrackStatusOrPending = (value: unknown) =>
  value === 'searching' || value === 'partial' || value === 'ok' || value === 'not_found' || value === 'error' ? value : 'pending';

const remoteStatusKeys = ['pending', 'searching', 'partial', 'ok', 'not_found', 'error'] as const;

const emptyTrackStatusCounts = (): Record<typeof remoteStatusKeys[number], number> => ({
  pending: 0,
  searching: 0,
  partial: 0,
  ok: 0,
  not_found: 0,
  error: 0,
});

const addTrackStatusCounts = (
  left: Record<typeof remoteStatusKeys[number], number>,
  right: Record<typeof remoteStatusKeys[number], number>,
): Record<typeof remoteStatusKeys[number], number> => {
  const next = emptyTrackStatusCounts();
  for (const key of remoteStatusKeys) {
    next[key] = left[key] + right[key];
  }
  return next;
};

export class RemoteLibraryStore {
  constructor(
    private readonly database: EchoDatabase,
    private readonly secretStore = new RemoteSourceSecretStore(),
  ) {}

  listSources(): RemoteSource[] {
    return this.database
      .prepare<[], DbRow>(
        `SELECT remote_sources.*,
          (SELECT COUNT(*) FROM remote_tracks WHERE remote_tracks.source_id = remote_sources.id AND availability != 'missing') AS indexed_track_count
         FROM remote_sources
         ORDER BY created_at DESC`,
      )
      .all()
      .map((row) => this.mapSource(row));
  }

  getOverview(sourceId?: string | null): RemoteSourceOverview {
    const sourceFilter = textOrNull(sourceId) ? 'WHERE remote_sources.id = ?' : '';
    const params = textOrNull(sourceId) ? [textOrNull(sourceId)] : [];
    const rows = this.database
      .prepare<unknown[], DbRow>(
        `SELECT
          remote_sources.id,
          remote_sources.provider,
          remote_sources.display_name,
          remote_sources.status,
          remote_sources.sync_mode,
          remote_sources.last_sync_at,
          remote_sources.last_error,
          COUNT(CASE WHEN remote_tracks.id IS NOT NULL AND remote_tracks.availability != 'missing' THEN 1 END) AS track_count,
          COUNT(DISTINCT CASE
            WHEN remote_tracks.id IS NOT NULL AND remote_tracks.availability != 'missing' THEN
              lower(trim(COALESCE(NULLIF(TRIM(remote_tracks.album_artist), ''), NULLIF(TRIM(remote_tracks.artist), ''), 'Unknown Artist'))) || char(31) ||
              lower(trim(CASE WHEN TRIM(COALESCE(remote_tracks.album, '')) = '' THEN remote_tracks.id ELSE remote_tracks.album END)) || char(31) ||
              COALESCE(CAST(remote_tracks.year AS TEXT), '')
          END) AS album_count,
          COUNT(DISTINCT CASE
            WHEN remote_tracks.id IS NOT NULL AND remote_tracks.availability != 'missing' THEN
              lower(trim(COALESCE(NULLIF(TRIM(remote_tracks.artist), ''), 'Unknown Artist')))
          END) AS artist_count,
          COALESCE(SUM(CASE WHEN remote_tracks.availability != 'missing' THEN COALESCE(remote_tracks.size_bytes, 0) ELSE 0 END), 0) AS total_size_bytes,
          COUNT(CASE WHEN remote_tracks.availability = 'missing' THEN 1 END) AS missing_track_count,
          ${this.statusCountSql('metadata_status', 'metadata')},
          ${this.statusCountSql('cover_status', 'cover')},
          ${this.statusCountSql('lyrics_status', 'lyrics')},
          ${this.statusCountSql('mv_status', 'mv')}
         FROM remote_sources
         LEFT JOIN remote_tracks ON remote_tracks.source_id = remote_sources.id
         ${sourceFilter}
         GROUP BY remote_sources.id
         ORDER BY remote_sources.created_at DESC`,
      )
      .all(...params);

    const sources = rows.map((row) => this.mapOverviewItem(row));
    const summary = sources.reduce(
      (current, source) => ({
        totalSources: current.totalSources + 1,
        enabledSources: current.enabledSources + (source.status === 'enabled' ? 1 : 0),
        disabledSources: current.disabledSources + (source.status === 'disabled' ? 1 : 0),
        errorSources: current.errorSources + (source.status === 'error' ? 1 : 0),
        trackCount: current.trackCount + source.trackCount,
        albumCount: current.albumCount + source.albumCount,
        artistCount: current.artistCount + source.artistCount,
        totalSizeBytes: current.totalSizeBytes + source.totalSizeBytes,
        missingTrackCount: current.missingTrackCount + source.missingTrackCount,
        metadata: addTrackStatusCounts(current.metadata, source.metadata),
        cover: addTrackStatusCounts(current.cover, source.cover),
        lyrics: addTrackStatusCounts(current.lyrics, source.lyrics),
        mv: addTrackStatusCounts(current.mv, source.mv),
      }),
      {
        totalSources: 0,
        enabledSources: 0,
        disabledSources: 0,
        errorSources: 0,
        trackCount: 0,
        albumCount: 0,
        artistCount: 0,
        totalSizeBytes: 0,
        missingTrackCount: 0,
        metadata: emptyTrackStatusCounts(),
        cover: emptyTrackStatusCounts(),
        lyrics: emptyTrackStatusCounts(),
        mv: emptyTrackStatusCounts(),
      },
    );

    return { ...summary, sources };
  }

  previewAlbumGrouping(
    currentStrategy: RemoteAlbumMergeStrategy,
    targetStrategy: RemoteAlbumMergeStrategy,
    sourceId?: string | null,
  ): RemoteAlbumGroupingPreview {
    const sourceFilter = sourceId ? 'AND remote_tracks.source_id = ?' : '';
    const params = sourceId ? [sourceId] : [];
    const rows = this.database
      .prepare<string[], DbRow>(
        `SELECT
           remote_tracks.id,
           remote_tracks.source_id,
           remote_tracks.provider,
           remote_tracks.remote_path,
           remote_tracks.album,
           remote_tracks.album_artist,
           remote_tracks.artist,
           remote_tracks.year,
           remote_tracks.field_sources_json
         FROM remote_tracks
         INNER JOIN remote_sources ON remote_sources.id = remote_tracks.source_id
         WHERE remote_tracks.availability != 'missing'
           AND remote_sources.status = 'enabled'
           ${sourceFilter}`,
      )
      .all(...params)
      .map((row): RemoteAlbumGroupingTrack => ({
        id: String(row.id ?? ''),
        sourceId: String(row.source_id ?? ''),
        provider: String(row.provider ?? 'webdav'),
        remotePath: String(row.remote_path ?? ''),
        album: String(row.album ?? ''),
        albumArtist: String(row.album_artist ?? ''),
        artist: String(row.artist ?? ''),
        year: numberOrNull(row.year),
        fieldSources: Object.fromEntries(
          Object.entries(parseJsonObject(row.field_sources_json)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        ),
      }));
    const currentAlbums = new Set(rows.map((row) => remoteAlbumGroupingKey(row, currentStrategy)));
    const targetAlbums = new Set(rows.map((row) => remoteAlbumGroupingKey(row, targetStrategy)));
    const sourceIds = new Set(rows.map((row) => row.sourceId).filter(Boolean));

    return {
      sourceId: sourceId ?? null,
      sourceCount: sourceIds.size,
      trackCount: rows.length,
      currentStrategy,
      targetStrategy,
      currentAlbumCount: currentAlbums.size,
      targetAlbumCount: targetAlbums.size,
    };
  }

  listIssues(sourceId: string, kind: RemoteSourceIssueKind, limit = 50): RemoteSourceIssueItem[] {
    const source = this.getSource(sourceId);
    if (!source) {
      throw new Error(`Unknown remote source ${sourceId}`);
    }

    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.round(limit))) : 50;
    const statusColumn = kind === 'metadata'
      ? 'metadata_status'
      : kind === 'cover'
        ? 'cover_status'
        : kind === 'lyrics'
          ? 'lyrics_status'
          : 'mv_status';
    const whereSql = kind === 'missing'
      ? "remote_tracks.availability = 'missing'"
      : `remote_tracks.availability != 'missing' AND remote_tracks.${statusColumn} IN ('partial', 'not_found', 'error')`;
    const statusSql = kind === 'missing' ? 'remote_tracks.availability' : `remote_tracks.${statusColumn}`;

    return this.database
      .prepare<[string, number], DbRow>(
        `SELECT
          remote_tracks.id,
          remote_tracks.source_id,
          remote_tracks.provider,
          ${statusSql} AS status,
          remote_tracks.title,
          remote_tracks.artist,
          remote_tracks.album,
          remote_tracks.remote_path,
          remote_tracks.size_bytes,
          remote_tracks.updated_at
         FROM remote_tracks
         WHERE remote_tracks.source_id = ?
           AND ${whereSql}
         ORDER BY remote_tracks.updated_at DESC
         LIMIT ?`,
      )
      .all(sourceId, normalizedLimit)
      .map((row) => this.mapIssue(row, kind));
  }

  getSource(id: string): RemoteSource | null {
    const row = this.database
      .prepare<[string], DbRow>(
        `SELECT remote_sources.*,
          (SELECT COUNT(*) FROM remote_tracks WHERE remote_tracks.source_id = remote_sources.id AND availability != 'missing') AS indexed_track_count
         FROM remote_sources
         WHERE id = ?`,
      )
      .get(id);

    return row ? this.mapSource(row) : null;
  }

  getSourceWithSecret(id: string): RemoteSourceSecret | null {
    const row = this.database.prepare<[string], DbRow>('SELECT * FROM remote_sources WHERE id = ?').get(id);
    if (!row) {
      return null;
    }

    return {
      ...this.mapSource({ ...row, indexed_track_count: 0 }),
      secret: this.secretStore.decrypt(textOrNull(row.encrypted_secret)),
    };
  }

  createSource(input: RemoteSourceInput): RemoteSource {
    const timestamp = nowIso();
    const id = randomUUID();
    const provider = providerOrWebdav(input.provider);
    const displayName = input.displayName.trim() || provider.toUpperCase();

    this.database
      .prepare(
        `INSERT INTO remote_sources (
          id, provider, display_name, status, base_url, username, auth_type, encrypted_secret,
          config_json, sync_mode, last_test_at, last_sync_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        provider,
        displayName,
        statusOrEnabled(input.status),
        input.baseUrl?.trim() || null,
        input.username?.trim() || null,
        authTypeOrBasic(input.authType),
        this.secretStore.encrypt(input.secret),
        JSON.stringify(input.config ?? {}),
        syncModeOrIndex(input.syncMode),
        null,
        null,
        null,
        timestamp,
        timestamp,
      );

    const source = this.getSource(id);
    if (!source) {
      throw new Error(`Failed to create remote source ${id}`);
    }

    return source;
  }

  updateSource(input: RemoteSourceUpdate): RemoteSource {
    const current = this.getSourceWithSecret(input.id);
    if (!current) {
      throw new Error(`Unknown remote source ${input.id}`);
    }

    const timestamp = nowIso();
    const provider = input.provider ? providerOrWebdav(input.provider) : current.provider;
    const displayName = input.displayName !== undefined ? input.displayName.trim() || current.displayName : current.displayName;
    const secret =
      input.secret !== undefined ? this.secretStore.encrypt(input.secret) : this.getEncryptedSecret(input.id);

    this.database
      .prepare(
        `UPDATE remote_sources SET
          provider = ?,
          display_name = ?,
          status = ?,
          base_url = ?,
          username = ?,
          auth_type = ?,
          encrypted_secret = ?,
          config_json = ?,
          sync_mode = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(
        provider,
        displayName,
        input.status ? statusOrEnabled(input.status) : current.status,
        input.baseUrl !== undefined ? input.baseUrl?.trim() || null : current.baseUrl,
        input.username !== undefined ? input.username?.trim() || null : current.username,
        input.authType ? authTypeOrBasic(input.authType) : current.authType,
        secret,
        JSON.stringify(input.config ?? current.config),
        input.syncMode ? syncModeOrIndex(input.syncMode) : current.syncMode,
        timestamp,
        input.id,
      );

    const updated = this.getSource(input.id);
    if (!updated) {
      throw new Error(`Unknown remote source ${input.id}`);
    }

    return updated;
  }

  deleteSource(id: string): void {
    this.database.transaction(() => {
      this.preserveRemoteCoverAliasesForSource(id);
      this.database.prepare('DELETE FROM remote_tracks WHERE source_id = ?').run(id);
      this.database.prepare('DELETE FROM remote_sources WHERE id = ?').run(id);
    })();
  }

  disconnectSource(id: string): void {
    const timestamp = nowIso();
    this.database.transaction(() => {
      this.preserveRemoteCoverAliasesForSource(id);
      this.database.prepare('DELETE FROM remote_tracks WHERE source_id = ?').run(id);
      this.database
        .prepare(
          `UPDATE remote_sources
           SET status = 'disabled',
               last_error = NULL,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(timestamp, id);
    })();
  }

  updateSourceTestResult(id: string, ok: boolean, message: string, testedAt = nowIso()): void {
    this.database
      .prepare('UPDATE remote_sources SET status = ?, last_test_at = ?, last_error = ?, updated_at = ? WHERE id = ?')
      .run(ok ? 'enabled' : 'error', testedAt, ok ? null : message, testedAt, id);
  }

  updateSourceSyncResult(id: string, ok: boolean, message: string | null, syncedAt = nowIso()): void {
    this.database
      .prepare('UPDATE remote_sources SET status = ?, last_sync_at = ?, last_error = ?, updated_at = ? WHERE id = ?')
      .run(ok ? 'enabled' : 'error', ok ? syncedAt : null, ok ? null : message, syncedAt, id);
  }

  getTrack(id: string): RemoteLibraryTrack | null {
    const row = this.database.prepare<[string], DbRow>('SELECT * FROM remote_tracks WHERE id = ?').get(id);
    return row ? this.mapTrack(row) : null;
  }

  getTrackBySourcePath(sourceId: string, remotePath: string): RemoteLibraryTrack | null {
    const row = this.database
      .prepare<[string, string], DbRow>('SELECT * FROM remote_tracks WHERE source_id = ? AND remote_path = ?')
      .get(sourceId, remotePath);
    return row ? this.mapTrack(row) : null;
  }

  lookupTracksBySourcePaths(sourceId: string, remotePaths: string[]): RemoteTrackLookupItem[] {
    const paths = Array.from(new Set(remotePaths.filter((path) => typeof path === 'string' && path.trim().length > 0).map((path) => path.trim()))).slice(0, 200);
    if (paths.length === 0) {
      return [];
    }

    const placeholders = paths.map(() => '?').join(', ');
    return this.database
      .prepare<unknown[], DbRow>(
        `SELECT id, source_id, remote_path, stable_key, title, artist, album, duration, codec, cover_id,
          metadata_status, cover_status, lyrics_status, mv_status, availability, provider, field_sources_json
         FROM remote_tracks
         WHERE source_id = ? AND remote_path IN (${placeholders})`,
      )
      .all(sourceId, ...paths)
      .map((row) => this.mapTrackLookup(row));
  }

  getTrackIdsForBackgroundJobs(sourceId: string, kinds: RemoteBackgroundJobKind[], options: { failedOnly?: boolean; limit?: number } = {}): string[] {
    return this.queryTracksForBackgroundJobs(sourceId, kinds, options, 'id').map((row) => String(row.id));
  }

  getTracksByIds(trackIds: string[]): RemoteLibraryTrack[] {
    if (trackIds.length === 0) {
      return [];
    }

    const placeholders = trackIds.map(() => '?').join(', ');
    return this.database
      .prepare<unknown[], DbRow>(
        `SELECT * FROM remote_tracks
         WHERE id IN (${placeholders})
         ORDER BY updated_at ASC`,
      )
      .all(...trackIds)
      .map((row) => this.mapTrack(row));
  }

  getIndexedFolderStats(sourceId: string, rootPath?: string | null): RemoteIndexedFolderStats {
    const normalizedRoot = normalizeRemoteDirectoryPath(rootPath ?? '/');
    const scope = this.indexedFolderScopeSql(normalizedRoot);
    const row = this.database
      .prepare<unknown[], DbRow>(
        `SELECT
           COUNT(*) AS track_count,
           COALESCE(SUM(COALESCE(size_bytes, 0)), 0) AS total_size_bytes,
           COUNT(DISTINCT lower(trim(COALESCE(NULLIF(album, ''), 'Unknown Album')))) AS album_count,
           COUNT(DISTINCT lower(trim(COALESCE(NULLIF(artist, ''), 'Unknown Artist')))) AS artist_count
         FROM remote_tracks
         WHERE source_id = ?
           AND availability != 'missing'
           ${scope.sql}`,
      )
      .get(sourceId, ...scope.params);

    return {
      sourceId,
      rootPath: normalizedRoot,
      trackCount: Number(row?.track_count ?? 0),
      totalSizeBytes: Number(row?.total_size_bytes ?? 0),
      albumCount: Number(row?.album_count ?? 0),
      artistCount: Number(row?.artist_count ?? 0),
    };
  }

  listTracksBySourceFolder(sourceId: string, rootPath?: string | null, limit = 5000): RemoteLibraryTrack[] {
    return this.listTracksBySourceFolderPage(sourceId, {
      rootPath,
      page: 1,
      pageSize: limit,
      sort: 'album',
    }).items;
  }

  listTracksBySourceFolderPage(sourceId: string, query: RemoteIndexedTracksQuery = {}): LibraryPage<RemoteLibraryTrack> {
    const { page, pageSize, search, sort, rootPath } = this.normalizeIndexedTracksQuery(query);
    const offset = (page - 1) * pageSize;
    const scope = this.indexedFolderScopeSql(rootPath);
    const searchFilter = this.indexedFolderSearchSql(search);
    const whereSql = `WHERE source_id = ? AND availability != 'missing' ${scope.sql} ${searchFilter.sql}`;
    const params = [sourceId, ...scope.params, ...searchFilter.params];
    const total = Number(
      this.database
        .prepare<unknown[], DbRow>(`SELECT COUNT(*) AS total FROM remote_tracks ${whereSql}`)
        .get(...params)?.total ?? 0,
    );
    const items = this.database
      .prepare<unknown[], DbRow>(
        `SELECT * FROM remote_tracks
         ${whereSql}
         ${this.remoteFolderTrackOrderSql(sort)}
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset)
      .map((row) => this.mapTrack(row));

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: offset + items.length < total,
    };
  }

  private normalizeIndexedTracksQuery(query: RemoteIndexedTracksQuery): {
    page: number;
    pageSize: number;
    search: string;
    sort: LibrarySort;
    rootPath: string;
  } {
    return {
      page: Math.max(1, Math.floor(Number(query.page ?? 1))),
      pageSize: Math.min(remoteIndexedMaxPageSize, Math.max(1, Math.floor(Number(query.pageSize ?? remoteIndexedDefaultPageSize)))),
      search: typeof query.search === 'string' ? query.search.trim() : '',
      sort: query.sort ?? 'default',
      rootPath: normalizeRemoteDirectoryPath(query.rootPath ?? '/'),
    };
  }

  private indexedFolderScopeSql(rootPath: string): { sql: string; params: string[] } {
    if (rootPath === '/') {
      return { sql: '', params: [] };
    }

    return {
      sql: "AND (remote_path = ? OR remote_path LIKE ? ESCAPE '\\')",
      params: [rootPath, `${escapeSqlLike(rootPath)}%`],
    };
  }

  private indexedFolderSearchSql(search: string): { sql: string; params: string[] } {
    if (!search) {
      return { sql: '', params: [] };
    }

    const like = `%${escapeSqlLike(search.toLocaleLowerCase())}%`;
    return {
      sql: `AND (
        lower(title) LIKE ? ESCAPE '\\' OR
        lower(artist) LIKE ? ESCAPE '\\' OR
        lower(album) LIKE ? ESCAPE '\\' OR
        lower(album_artist) LIKE ? ESCAPE '\\' OR
        lower(COALESCE(genre, '')) LIKE ? ESCAPE '\\' OR
        lower(remote_path) LIKE ? ESCAPE '\\' OR
        lower(COALESCE(search_terms, '')) LIKE ? ESCAPE '\\'
      )`,
      params: [like, like, like, like, like, like, like],
    };
  }

  private remoteFolderTrackOrderSql(sort: LibrarySort): string {
    switch (sort) {
      case 'artist':
        return 'ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'artistAlbum':
        return 'ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, COALESCE(disc_no, 0), COALESCE(track_no, 999999), title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'album':
        return 'ORDER BY album COLLATE NOCASE, COALESCE(disc_no, 0), COALESCE(track_no, 999999), title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'recent':
        return 'ORDER BY updated_at DESC, title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'createdAsc':
        return 'ORDER BY created_at ASC, title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'createdDesc':
        return 'ORDER BY created_at DESC, title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'titleDesc':
        return 'ORDER BY title COLLATE NOCASE DESC, artist COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'durationAsc':
        return 'ORDER BY COALESCE(duration, 0) ASC, title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'durationDesc':
        return 'ORDER BY COALESCE(duration, 0) DESC, title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'fileModifiedAsc':
        return 'ORDER BY modified_at ASC, title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'fileModifiedDesc':
        return 'ORDER BY modified_at DESC, title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'qualityAsc':
        return 'ORDER BY COALESCE(bitrate, 0) ASC, COALESCE(size_bytes, 0) ASC, title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'qualityDesc':
        return 'ORDER BY COALESCE(bitrate, 0) DESC, COALESCE(size_bytes, 0) DESC, title COLLATE NOCASE, remote_path COLLATE NOCASE';
      case 'random':
        return 'ORDER BY RANDOM()';
      case 'titleAsc':
      case 'default':
      case 'title':
      default:
        return 'ORDER BY title COLLATE NOCASE, artist COLLATE NOCASE, remote_path COLLATE NOCASE';
    }
  }

  getTracksForBackgroundJobs(sourceId: string, kinds: RemoteBackgroundJobKind[], options: { failedOnly?: boolean; limit?: number } = {}): RemoteLibraryTrack[] {
    return this.queryTracksForBackgroundJobs(sourceId, kinds, options, '*').map((row) => this.mapTrack(row));
  }

  private queryTracksForBackgroundJobs(
    sourceId: string,
    kinds: RemoteBackgroundJobKind[],
    options: { failedOnly?: boolean; limit?: number },
    columns: 'id' | '*',
  ): DbRow[] {
    const clauses = ['source_id = ?', "availability != 'missing'"];
    const params: unknown[] = [sourceId];
    const statusClauses: string[] = [];
    const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(5000, Math.round(options.limit)))
      : 5000;

    if (kinds.includes('metadata') || kinds.includes('duration-backfill')) {
      statusClauses.push(options.failedOnly ? "metadata_status = 'error'" : "metadata_status IN ('pending', 'partial')");
    }

    if (kinds.includes('lyrics')) {
      statusClauses.push(options.failedOnly ? "lyrics_status = 'error'" : "lyrics_status IN ('pending', 'not_found')");
    }

    if (kinds.includes('mv')) {
      statusClauses.push(options.failedOnly ? "mv_status = 'error'" : "mv_status IN ('pending', 'not_found')");
    }

    if (kinds.includes('cover')) {
      statusClauses.push(
        `(
          cover_id IS NULL
          AND cover_status IN (${options.failedOnly ? "'error'" : "'pending'"})
          AND metadata_status != 'error'
          AND (
            provider NOT IN ('jellyfin', 'emby', 'subsonic')
            OR json_extract(field_sources_json, '$.coverArt') IS NOT NULL
          )
        )`,
      );
    }

    if (statusClauses.length > 0) {
      clauses.push(`(${statusClauses.join(' OR ')})`);
    }

    return this.database
      .prepare<unknown[], DbRow>(
        `SELECT ${columns} FROM remote_tracks
         WHERE ${clauses.join(' AND ')}
         ORDER BY updated_at ASC
         LIMIT ?`,
      )
      .all(...params, limit);
  }

  getComparableFingerprint(sourceId: string, remotePath: string): { etag: string | null; modifiedAt: string | null; sizeBytes: number | null; coverId: string | null } | null {
    const row = this.database
      .prepare<[string, string], DbRow>('SELECT etag, modified_at, size_bytes, cover_id FROM remote_tracks WHERE source_id = ? AND remote_path = ?')
      .get(sourceId, remotePath);

    return row
      ? {
          etag: textOrNull(row.etag),
          modifiedAt: textOrNull(row.modified_at),
          sizeBytes: numberOrNull(row.size_bytes),
          coverId: textOrNull(row.cover_id),
        }
      : null;
  }

  getComparableFingerprints(sourceId: string): Map<string, { etag: string | null; modifiedAt: string | null; sizeBytes: number | null; coverId: string | null }> {
    const rows = this.database
      .prepare<[string], DbRow>('SELECT remote_path, etag, modified_at, size_bytes, cover_id FROM remote_tracks WHERE source_id = ?')
      .all(sourceId);
    const fingerprints = new Map<string, { etag: string | null; modifiedAt: string | null; sizeBytes: number | null; coverId: string | null }>();

    for (const row of rows) {
      fingerprints.set(String(row.remote_path), {
        etag: textOrNull(row.etag),
        modifiedAt: textOrNull(row.modified_at),
        sizeBytes: numberOrNull(row.size_bytes),
        coverId: textOrNull(row.cover_id),
      });
    }

    return fingerprints;
  }

  async prepareSearchTermsForTracks(tracks: RemoteTrackWrite[]): Promise<Map<string, string>> {
    const terms = new Map<string, string>();
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      terms.set(
        track.id,
        await buildTrackSearchTermsAsync({
          title: track.title,
          artist: track.artist,
          album: track.album,
          albumArtist: track.albumArtist,
          genre: track.genre,
          remotePath: track.remotePath,
        }),
      );

      if (index > 0 && index % 12 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    return terms;
  }

  async prepareMetadataUpdateSearchTerms(
    trackId: string,
    update: {
      title: string;
      artist: string;
      album: string;
      albumArtist: string;
      genre: string | null;
    },
  ): Promise<string> {
    return buildTrackSearchTermsAsync({
      title: update.title,
      artist: update.artist,
      album: update.album,
      albumArtist: update.albumArtist,
      genre: update.genre,
      remotePath: this.getTrack(trackId)?.remotePath,
    });
  }

  upsertTracks(tracks: RemoteTrackWrite[], preparedSearchTerms: Map<string, string> = new Map()): void {
    if (tracks.length === 0) {
      return;
    }

    const statement = this.database.prepare(
      `INSERT INTO remote_tracks (
        id, source_id, provider, remote_path, remote_url_hash, stable_key,
        title, artist, album, album_artist, track_no, disc_no, year, genre, duration,
        codec, sample_rate, bit_depth, bitrate, size_bytes, modified_at, etag, cover_id,
        cover_status, metadata_status, lyrics_status, mv_status, availability, field_sources_json, search_terms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, remote_path) DO UPDATE SET
        remote_url_hash = excluded.remote_url_hash,
        stable_key = excluded.stable_key,
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
        size_bytes = excluded.size_bytes,
        modified_at = excluded.modified_at,
        etag = excluded.etag,
        cover_id = COALESCE(excluded.cover_id, remote_tracks.cover_id),
        cover_status = CASE
          WHEN excluded.cover_id IS NOT NULL OR remote_tracks.cover_id IS NOT NULL THEN 'ok'
          WHEN remote_tracks.cover_status IN ('searching', 'not_found', 'error') THEN remote_tracks.cover_status
          ELSE excluded.cover_status
        END,
        metadata_status = excluded.metadata_status,
        availability = excluded.availability,
        field_sources_json = excluded.field_sources_json,
        search_terms = excluded.search_terms,
        updated_at = excluded.updated_at`,
    );
    const timestamp = nowIso();

    this.database.transaction(() => {
      for (const track of tracks) {
        const cachedCoverId = track.coverId ?? this.getCachedRemoteCoverIdForTrack(track);
        const searchTerms = preparedSearchTerms.get(track.id) ?? buildTrackSearchTerms({
          title: track.title,
          artist: track.artist,
          album: track.album,
          albumArtist: track.albumArtist,
          genre: track.genre,
          remotePath: track.remotePath,
        });

        statement.run(
          track.id,
          track.sourceId,
          track.provider,
          track.remotePath,
          track.remoteUrlHash,
          track.stableKey,
          track.title,
          track.artist,
          track.album,
          track.albumArtist,
          track.trackNo,
          track.discNo,
          track.year,
          track.genre,
          track.duration,
          track.codec,
          track.sampleRate,
          track.bitDepth,
          track.bitrate,
          track.sizeBytes,
          track.modifiedAt,
          track.etag,
          cachedCoverId,
          cachedCoverId ? 'ok' : track.coverStatus,
          track.metadataStatus,
          track.lyricsStatus,
          track.mvStatus,
          track.availability,
          JSON.stringify(track.fieldSources),
          searchTerms,
          track.createdAt ?? timestamp,
          track.updatedAt ?? timestamp,
        );
        if (cachedCoverId) {
          this.upsertRemoteCoverCacheForTrack(track, cachedCoverId, timestamp);
        }
      }
    })();
  }

  getCachedRemoteCoverIdForTrack(track: {
    provider: unknown;
    remotePath: unknown;
    stableKey: unknown;
    fieldSources: Record<string, unknown>;
  }): string | null {
    const cacheKey = remoteCoverCacheKeyFor({
      provider: track.provider,
      fieldSources: track.fieldSources,
      remotePath: track.remotePath,
      stableKey: track.stableKey,
    });
    if (!cacheKey) {
      return null;
    }

    const row = this.database
      .prepare<[string], { cover_id: string }>(
        `SELECT remote_cover_cache.cover_id
         FROM remote_cover_cache
         INNER JOIN covers ON covers.id = remote_cover_cache.cover_id
         WHERE remote_cover_cache.cache_key = ?`,
      )
      .get(cacheKey);
    return textOrNull(row?.cover_id);
  }

  upsertRemoteCoverCacheForTrack(
    track: {
      sourceId: string;
      provider: unknown;
      remotePath: string;
      stableKey: unknown;
      fieldSources: Record<string, unknown>;
    },
    coverId: string,
    timestamp = nowIso(),
  ): void {
    const cacheKey = remoteCoverCacheKeyFor({
      provider: track.provider,
      fieldSources: track.fieldSources,
      remotePath: track.remotePath,
      stableKey: track.stableKey,
    });
    if (!cacheKey) {
      return;
    }

    this.database
      .prepare(
        `INSERT INTO remote_cover_cache (
          cache_key, provider, cover_id, source_id, cover_art, remote_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          cover_id = excluded.cover_id,
          source_id = excluded.source_id,
          cover_art = excluded.cover_art,
          remote_path = excluded.remote_path,
          updated_at = excluded.updated_at`,
      )
      .run(
        cacheKey,
        String(track.provider),
        coverId,
        track.sourceId,
        textOrNull(track.fieldSources.coverArt),
        track.remotePath,
        timestamp,
        timestamp,
      );
  }

  private preserveRemoteCoverAliasesForSource(sourceId: string): void {
    const rows = this.database
      .prepare<[string], DbRow>(
        `SELECT source_id, provider, remote_path, stable_key, cover_id, field_sources_json
         FROM remote_tracks
         WHERE source_id = ?
           AND cover_id IS NOT NULL`,
      )
      .all(sourceId);

    for (const row of rows) {
      const coverId = textOrNull(row.cover_id);
      if (!coverId) {
        continue;
      }
      const fieldSources = Object.fromEntries(
        Object.entries(parseJsonObject(row.field_sources_json)).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])),
      );
      this.upsertRemoteCoverCacheForTrack({
        sourceId: String(row.source_id ?? ''),
        provider: String(row.provider ?? ''),
        remotePath: String(row.remote_path ?? ''),
        stableKey: String(row.stable_key ?? ''),
        fieldSources,
      }, coverId);
    }
  }

  updateTrackMetadata(trackId: string, update: {
    title: string;
    artist: string;
    album: string;
    albumArtist: string;
    trackNo: number | null;
    discNo: number | null;
    year: number | null;
    genre: string | null;
    duration: number | null;
    codec: string | null;
    sampleRate: number | null;
    bitDepth: number | null;
    bitrate: number | null;
    metadataStatus: RemoteLibraryTrack['metadataStatus'];
    fieldSources: Record<string, string>;
  }, preparedSearchTerms?: string): RemoteLibraryTrack | null {
    this.database
      .prepare(
        `UPDATE remote_tracks SET
          title = ?,
          artist = ?,
          album = ?,
          album_artist = ?,
          track_no = ?,
          disc_no = ?,
          year = ?,
          genre = ?,
          duration = ?,
          codec = ?,
          sample_rate = ?,
          bit_depth = ?,
          bitrate = ?,
          metadata_status = ?,
          field_sources_json = ?,
          search_terms = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(
        update.title,
        update.artist,
        update.album,
        update.albumArtist,
        update.trackNo,
        update.discNo,
        update.year,
        update.genre,
        update.duration,
        update.codec,
        update.sampleRate,
        update.bitDepth,
        update.bitrate,
        update.metadataStatus,
        JSON.stringify(update.fieldSources),
        preparedSearchTerms ?? buildTrackSearchTerms({
          title: update.title,
          artist: update.artist,
          album: update.album,
          albumArtist: update.albumArtist,
          genre: update.genre,
          remotePath: this.getTrack(trackId)?.remotePath,
        }),
        nowIso(),
        trackId,
      );

    return this.getTrack(trackId);
  }

  updateTrackDuration(trackId: string, duration: number): void {
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    this.database
      .prepare(
        `UPDATE remote_tracks
         SET duration = ?, metadata_status = CASE metadata_status WHEN 'pending' THEN 'partial' ELSE metadata_status END, updated_at = ?
         WHERE id = ? AND (duration IS NULL OR duration <= 0)`,
      )
      .run(duration, nowIso(), trackId);
  }

  updateTrackCover(trackId: string, coverId: string | null): RemoteLibraryTrack | null {
    this.database
      .prepare('UPDATE remote_tracks SET cover_id = ?, cover_status = ?, updated_at = ? WHERE id = ?')
      .run(coverId, coverId ? 'ok' : 'pending', nowIso(), trackId);
    return this.getTrack(trackId);
  }

  updateTrackCoversByCoverArt(sourceId: string, coverArt: string, coverId: string): number {
    return this.database
      .prepare(
        `UPDATE remote_tracks
         SET cover_id = ?, cover_status = 'ok', updated_at = ?
         WHERE source_id = ?
           AND cover_id IS NULL
           AND json_extract(field_sources_json, '$.coverArt') = ?`,
      )
      .run(coverId, nowIso(), sourceId, coverArt).changes;
  }

  updateTrackJobStatus(trackId: string, kind: RemoteBackgroundJobKind, status: RemoteLibraryTrack['metadataStatus']): void {
    const column = kind === 'cover' ? 'cover_status' : kind === 'lyrics' ? 'lyrics_status' : kind === 'mv' ? 'mv_status' : 'metadata_status';
    this.database.prepare(`UPDATE remote_tracks SET ${column} = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), trackId);
  }

  markMissingExcept(sourceId: string, remotePaths: Set<string>): number {
    const rows = this.database.prepare<[string], { remote_path: string }>('SELECT remote_path FROM remote_tracks WHERE source_id = ?').all(sourceId);
    const missing = rows.map((row) => row.remote_path).filter((remotePath) => !remotePaths.has(remotePath));
    if (missing.length === 0) {
      return 0;
    }

    const statement = this.database.prepare('UPDATE remote_tracks SET availability = ?, updated_at = ? WHERE source_id = ? AND remote_path = ?');
    const timestamp = nowIso();
    this.database.transaction(() => {
      for (const remotePath of missing) {
        statement.run('missing', timestamp, sourceId, remotePath);
      }
    })();
    return missing.length;
  }

  removeMissingTracks(sourceId: string): number {
    return this.database.prepare('DELETE FROM remote_tracks WHERE source_id = ? AND availability = ?').run(sourceId, 'missing').changes;
  }

  toLibraryTrack(track: RemoteLibraryTrack): LibraryTrack {
    return {
      id: track.id,
      mediaType: 'remote',
      path: `remote://${track.sourceId}${track.remotePath}`,
      sourceId: track.sourceId,
      provider: track.provider,
      remotePath: track.remotePath,
      stableKey: track.stableKey,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist,
      trackNo: track.trackNo,
      discNo: track.discNo,
      year: track.year,
      genre: track.genre,
      duration: track.duration ?? 0,
      codec: track.codec,
      sampleRate: track.sampleRate,
      bitDepth: track.bitDepth,
      bitrate: track.bitrate,
      coverId: track.coverId,
      coverThumb: track.coverThumb,
      metadataStatus: track.metadataStatus,
      embeddedCoverStatus: track.coverStatus === 'ok' ? 'present' : track.coverStatus === 'searching' ? 'reading' : track.coverStatus === 'error' ? 'error' : track.coverStatus === 'pending' ? 'pending' : 'missing',
      fieldSources: track.fieldSources,
      unavailable: track.availability === 'missing',
    };
  }

  private getEncryptedSecret(id: string): string | null {
    const row = this.database.prepare<[string], { encrypted_secret: string | null }>('SELECT encrypted_secret FROM remote_sources WHERE id = ?').get(id);
    return row?.encrypted_secret ?? null;
  }

  private statusCountSql(column: string, prefix: string): string {
    return remoteStatusKeys
      .map((status) => `COUNT(CASE WHEN remote_tracks.availability != 'missing' AND remote_tracks.${column} = '${status}' THEN 1 END) AS ${prefix}_${status}_count`)
      .join(',\n          ');
  }

  private mapSource(row: DbRow): RemoteSource {
    return {
      id: String(row.id),
      provider: providerOrWebdav(row.provider),
      displayName: String(row.display_name),
      status: statusOrEnabled(row.status),
      baseUrl: textOrNull(row.base_url),
      username: textOrNull(row.username),
      authType: authTypeOrBasic(row.auth_type),
      config: parseJsonObject(row.config_json),
      syncMode: syncModeOrIndex(row.sync_mode),
      lastTestAt: textOrNull(row.last_test_at),
      lastSyncAt: textOrNull(row.last_sync_at),
      lastError: textOrNull(row.last_error),
      indexedTrackCount: Number(row.indexed_track_count ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapStatusCounts(row: DbRow, prefix: string): Record<typeof remoteStatusKeys[number], number> {
    const counts = emptyTrackStatusCounts();
    for (const status of remoteStatusKeys) {
      counts[status] = Number(row[`${prefix}_${status}_count`] ?? 0);
    }
    return counts;
  }

  private mapOverviewItem(row: DbRow): RemoteSourceOverviewItem {
    return {
      sourceId: String(row.id),
      provider: providerOrWebdav(row.provider),
      displayName: String(row.display_name),
      status: statusOrEnabled(row.status),
      syncMode: syncModeOrIndex(row.sync_mode),
      trackCount: Number(row.track_count ?? 0),
      albumCount: Number(row.album_count ?? 0),
      artistCount: Number(row.artist_count ?? 0),
      totalSizeBytes: Number(row.total_size_bytes ?? 0),
      missingTrackCount: Number(row.missing_track_count ?? 0),
      metadata: this.mapStatusCounts(row, 'metadata'),
      cover: this.mapStatusCounts(row, 'cover'),
      lyrics: this.mapStatusCounts(row, 'lyrics'),
      mv: this.mapStatusCounts(row, 'mv'),
      lastSyncAt: textOrNull(row.last_sync_at),
      lastError: textOrNull(row.last_error),
    };
  }

  private mapIssue(row: DbRow, kind: RemoteSourceIssueKind): RemoteSourceIssueItem {
    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      provider: providerOrWebdav(row.provider),
      kind,
      status: kind === 'missing'
        ? (row.status === 'available' || row.status === 'missing' ? row.status : 'unknown')
        : remoteTrackStatusOrPending(row.status),
      title: String(row.title),
      artist: String(row.artist),
      album: String(row.album),
      remotePath: String(row.remote_path),
      sizeBytes: numberOrNull(row.size_bytes),
      updatedAt: String(row.updated_at),
    };
  }

  private mapTrackLookup(row: DbRow): RemoteTrackLookupItem {
    const coverId = textOrNull(row.cover_id);
    const fieldSources = Object.fromEntries(
      Object.entries(parseJsonObject(row.field_sources_json)).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])),
    );

    return {
      trackId: String(row.id),
      sourceId: String(row.source_id),
      remotePath: String(row.remote_path),
      title: String(row.title),
      artist: String(row.artist),
      album: String(row.album),
      duration: numberOrNull(row.duration),
      codec: textOrNull(row.codec),
      coverThumb: coverId
        ? `echo-cover://thumb/${encodeURIComponent(coverId)}`
        : subsonicDirectCoverUrlFor(row.id, row.provider, coverId, fieldSources, row.remote_path, row.stable_key),
      metadataStatus: remoteTrackStatusOrPending(row.metadata_status),
      coverStatus: remoteTrackStatusOrPending(row.cover_status),
      lyricsStatus: remoteTrackStatusOrPending(row.lyrics_status),
      mvStatus: remoteTrackStatusOrPending(row.mv_status),
      availability: row.availability === 'available' || row.availability === 'missing' ? row.availability : 'unknown',
    };
  }

  private mapTrack(row: DbRow): RemoteLibraryTrack {
    const coverId = textOrNull(row.cover_id);
    const fieldSources = Object.fromEntries(
      Object.entries(parseJsonObject(row.field_sources_json)).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])),
    );

    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      provider: providerOrWebdav(row.provider),
      remotePath: String(row.remote_path),
      stableKey: String(row.stable_key),
      title: String(row.title),
      artist: String(row.artist),
      album: String(row.album),
      albumArtist: String(row.album_artist),
      trackNo: numberOrNull(row.track_no),
      discNo: numberOrNull(row.disc_no),
      year: numberOrNull(row.year),
      genre: textOrNull(row.genre),
      duration: numberOrNull(row.duration),
      codec: textOrNull(row.codec),
      sampleRate: numberOrNull(row.sample_rate),
      bitDepth: numberOrNull(row.bit_depth),
      bitrate: numberOrNull(row.bitrate),
      sizeBytes: numberOrNull(row.size_bytes),
      modifiedAt: textOrNull(row.modified_at),
      etag: textOrNull(row.etag),
      coverId,
      coverThumb: coverId
        ? `echo-cover://thumb/${encodeURIComponent(coverId)}`
        : subsonicDirectCoverUrlFor(row.id, row.provider, coverId, fieldSources, row.remote_path, row.stable_key),
      coverStatus: remoteTrackStatusOrPending(row.cover_status),
      metadataStatus: remoteTrackStatusOrPending(row.metadata_status),
      lyricsStatus: remoteTrackStatusOrPending(row.lyrics_status),
      mvStatus: remoteTrackStatusOrPending(row.mv_status),
      availability: row.availability === 'available' || row.availability === 'missing' ? row.availability : 'unknown',
      fieldSources,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
