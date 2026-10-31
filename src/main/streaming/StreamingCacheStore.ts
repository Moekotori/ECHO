import { randomUUID } from 'node:crypto';
import type { EchoDatabase } from '../database/createDatabase';
import type { LibraryPlaylist } from '../../shared/types/library';
import type { StreamingPlaylistDetail, StreamingProviderName, StreamingTrack, StreamingTrackSourceInfo } from '../../shared/types/streaming';
import { neteaseDjRadioPlaylistPrefix, streamingProviderNames, streamingStableKey } from '../../shared/types/streaming';

type DbRow = Record<string, unknown>;
type PlaylistBackupCallback = (playlistId: string) => void;
type PreservedDownloadedPlaylistItem = {
  mediaId: string;
  sourceProvider: string;
  sourceItemId: string | null;
  titleSnapshot: string | null;
  artistSnapshot: string | null;
  albumSnapshot: string | null;
  durationSnapshot: number | null;
  coverId: string | null;
  addedAt: string;
};
type PlaylistItemPreservation = {
  bySource: Map<string, PreservedDownloadedPlaylistItem[]>;
  byMetadata: Map<string, PreservedDownloadedPlaylistItem[]>;
};

const nowIso = (): string => new Date().toISOString();
const likedSongsSourcePlaylistId = 'liked-tracks';
const streamingDownloadAddedFromPrefix = 'streaming-download:';

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const normalizedPlaylistLookupText = (value: unknown): string =>
  typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase() : '';

const durationLookupValue = (value: unknown): string => {
  const duration = numberOrNull(value);
  return duration && duration > 0 ? String(Math.round(duration)) : '';
};

const playlistMetadataKey = (input: {
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  duration?: unknown;
}): string | null => {
  const title = normalizedPlaylistLookupText(input.title);
  const artist = normalizedPlaylistLookupText(input.artist);
  if (!title || !artist) {
    return null;
  }

  return [title, artist, normalizedPlaylistLookupText(input.album), durationLookupValue(input.duration)].join('\u001f');
};

const playlistSourceKey = (provider: unknown, providerTrackId: unknown): string | null => {
  const normalizedProvider = textOrNull(provider);
  const normalizedProviderTrackId = textOrNull(providerTrackId);
  return normalizedProvider && normalizedProviderTrackId ? `${normalizedProvider}:${normalizedProviderTrackId}` : null;
};

const streamingDownloadAddedFrom = (provider: string, providerTrackId: string): string =>
  `${streamingDownloadAddedFromPrefix}${provider}:${providerTrackId}`;

const parseStreamingDownloadAddedFrom = (value: unknown): { provider: string; providerTrackId: string } | null => {
  const text = textOrNull(value);
  if (!text?.startsWith(streamingDownloadAddedFromPrefix)) {
    return null;
  }

  const rest = text.slice(streamingDownloadAddedFromPrefix.length);
  const separator = rest.indexOf(':');
  if (separator <= 0 || separator >= rest.length - 1) {
    return null;
  }

  return {
    provider: rest.slice(0, separator),
    providerTrackId: rest.slice(separator + 1),
  };
};

const addPreservedItem = (
  map: Map<string, PreservedDownloadedPlaylistItem[]>,
  key: string | null,
  item: PreservedDownloadedPlaylistItem,
): void => {
  if (!key) {
    return;
  }

  const current = map.get(key);
  if (current) {
    current.push(item);
  } else {
    map.set(key, [item]);
  }
};

const removePreservedItem = (
  map: Map<string, PreservedDownloadedPlaylistItem[]>,
  item: PreservedDownloadedPlaylistItem,
): void => {
  for (const [key, items] of map.entries()) {
    const nextItems = items.filter((candidate) => candidate !== item);
    if (nextItems.length === 0) {
      map.delete(key);
    } else if (nextItems.length !== items.length) {
      map.set(key, nextItems);
    }
  }
};

const takePreservedItem = (
  preservation: PlaylistItemPreservation | null | undefined,
  track: StreamingTrack,
): PreservedDownloadedPlaylistItem | null => {
  if (!preservation) {
    return null;
  }

  const sourceKey = playlistSourceKey(track.provider, track.providerTrackId);
  const sourceMatch = sourceKey ? preservation.bySource.get(sourceKey) : null;
  if (sourceMatch?.length) {
    const item = sourceMatch.shift() ?? null;
    if (item) {
      removePreservedItem(preservation.byMetadata, item);
    }
    return item;
  }

  const metadataKey = playlistMetadataKey({
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
  });
  const metadataMatch = metadataKey ? preservation.byMetadata.get(metadataKey) : null;
  const item = metadataMatch?.shift() ?? null;
  if (item) {
    removePreservedItem(preservation.bySource, item);
  }
  return item;
};

const hasPreservedItems = (preservation: PlaylistItemPreservation): boolean =>
  [...preservation.bySource.values(), ...preservation.byMetadata.values()].some((items) => items.length > 0);

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const providerOrMock = (value: unknown): StreamingProviderName =>
  typeof value === 'string' && streamingProviderNames.includes(value as StreamingProviderName)
    ? (value as StreamingProviderName)
    : 'mock';

const sensitiveKeyPattern = /cookie|token|secret|authorization|headers|password|credential/iu;

const providerReferers: Partial<Record<StreamingProviderName, string>> = {
  netease: 'https://music.163.com/',
  qqmusic: 'https://y.qq.com/',
  kugou: 'https://www.kugou.com/',
  bilibili: 'https://www.bilibili.com/',
  soundcloud: 'https://soundcloud.com/',
};

const proxyableImageHosts = new Set([
  'p.music.126.net',
  'p1.music.126.net',
  'p2.music.126.net',
  'p3.music.126.net',
  'p4.music.126.net',
  'y.gtimg.cn',
  'qpic.y.qq.com',
  'imge.kugou.com',
  'imgessl.kugou.com',
  'singerimg.kugou.com',
  'imge.kugoucdn.com',
  'i0.hdslb.com',
  'i1.hdslb.com',
  'i2.hdslb.com',
  'i0.sndcdn.com',
  'i1.sndcdn.com',
  'i2.sndcdn.com',
  'i3.sndcdn.com',
  'i.ytimg.com',
  'img.youtube.com',
  'archive.biliimg.com',
]);

const normalizeRemoteImageUrl = (provider: StreamingProviderName, value: string | null): string | null => {
  if (!value || value.startsWith('echo-image://') || value.startsWith('echo-cover://') || value.startsWith('data:')) {
    return value;
  }

  const referer = providerReferers[provider];
  if (!referer) {
    return value;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !proxyableImageHosts.has(url.hostname)) {
      return value;
    }

    return `echo-image://remote/${encodeURIComponent(url.toString())}?referer=${encodeURIComponent(referer)}`;
  } catch {
    return value;
  }
};

const sanitizeForCache = (value: unknown, depth = 0): unknown => {
  if (depth > 8) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForCache(item, depth + 1));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = sensitiveKeyPattern.test(key) ? '[redacted]' : sanitizeForCache(item, depth + 1);
  }

  return output;
};

export class StreamingCacheStore {
  private readonly preservedDownloadedItemsByPlaylistId = new Map<string, PlaylistItemPreservation>();

  constructor(
    private readonly database: EchoDatabase,
    private readonly backupPlaylistBeforeReset?: PlaylistBackupCallback,
  ) {}

  getTrack(provider: StreamingProviderName, providerTrackId: string): StreamingTrack | null {
    const row =
      this.database
        .prepare<[StreamingProviderName, string], DbRow>(
          'SELECT * FROM streaming_tracks WHERE provider = ? AND provider_track_id = ?',
        )
        .get(provider, providerTrackId) ?? null;

    return row ? this.mapTrack(row) : null;
  }

  getTrackSourceInfo(provider: StreamingProviderName, providerTrackId: string): StreamingTrackSourceInfo {
    const trackRow =
      this.database
        .prepare<[StreamingProviderName, string], DbRow>(
          'SELECT album_id FROM streaming_tracks WHERE provider = ? AND provider_track_id = ? LIMIT 1',
        )
        .get(provider, providerTrackId) ?? null;
    const albumId = textOrNull(trackRow?.album_id);
    const stableKey = streamingStableKey(provider, providerTrackId);
    const playlistRows = this.database
      .prepare<[StreamingProviderName, StreamingProviderName, string, string], DbRow>(
        `SELECT DISTINCT playlists.source_playlist_id
         FROM playlist_items
         INNER JOIN playlists ON playlists.id = playlist_items.playlist_id
         WHERE playlists.source_provider = ?
           AND playlists.source_playlist_id IS NOT NULL
           AND (
             (playlist_items.source_provider = ? AND playlist_items.source_item_id = ?)
             OR playlist_items.media_id = ?
           )
         ORDER BY playlists.source_playlist_id`,
      )
      .all(provider, provider, providerTrackId, stableKey);
    const sourcePlaylistIds = playlistRows
      .map((row) => textOrNull(row.source_playlist_id))
      .filter((value): value is string => Boolean(value));

    return {
      provider,
      providerTrackId,
      albumId,
      sourcePlaylistIds,
      isNeteaseDjRadio:
        provider === 'netease' &&
        (
          albumId?.startsWith(neteaseDjRadioPlaylistPrefix) === true ||
          sourcePlaylistIds.some((sourcePlaylistId) => sourcePlaylistId.startsWith(neteaseDjRadioPlaylistPrefix))
        ),
    };
  }

  upsertTrack(track: StreamingTrack, raw: unknown = track): void {
    if (!this.database.inTransaction) {
      this.database.transaction(() => this.upsertTrack(track, raw))();
      return;
    }

    const timestamp = nowIso();
    this.database
      .prepare(
        `INSERT INTO streaming_tracks (
          id, provider, provider_track_id, stable_key, title, artist, album, album_id,
          album_artist, duration, cover_url, cover_id, qualities_json, playable,
          unavailable_reason, lyrics_status, mv_status, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, provider_track_id) DO UPDATE SET
          id = excluded.id,
          stable_key = excluded.stable_key,
          title = excluded.title,
          artist = excluded.artist,
          album = excluded.album,
          album_id = excluded.album_id,
          album_artist = excluded.album_artist,
          duration = excluded.duration,
          cover_url = excluded.cover_url,
          cover_id = excluded.cover_id,
          qualities_json = excluded.qualities_json,
          playable = excluded.playable,
          unavailable_reason = excluded.unavailable_reason,
          lyrics_status = excluded.lyrics_status,
          mv_status = excluded.mv_status,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        track.id,
        track.provider,
        track.providerTrackId,
        track.stableKey,
        track.title,
        track.artist,
        track.album,
        track.albumId,
        track.albumArtist,
        track.duration,
        track.coverUrl ?? track.coverThumb,
        null,
        JSON.stringify(track.qualities),
        track.playable ? 1 : 0,
        track.unavailableReason,
        track.lyricsStatus,
        track.mvStatus,
        JSON.stringify(sanitizeForCache(raw)),
        timestamp,
        timestamp,
      );
  }

  upsertTracks(tracks: StreamingTrack[]): void {
    if (tracks.length === 0) {
      return;
    }

    if (this.database.inTransaction) {
      for (const track of tracks) {
        this.upsertTrack(track);
      }
      return;
    }

    this.database.transaction((items: StreamingTrack[]) => {
      for (const track of items) {
        this.upsertTrack(track);
      }
    })(tracks);
  }

  getApiCache<T>(cacheKey: string, options: { allowExpired?: boolean } = {}): T | null {
    const row = options.allowExpired
      ? (this.database
          .prepare<[string], DbRow>('SELECT payload_json, expires_at FROM streaming_api_cache WHERE cache_key = ?')
          .get(cacheKey) ?? null)
      : (this.database
          .prepare<[string, string], DbRow>(
            'SELECT payload_json, expires_at FROM streaming_api_cache WHERE cache_key = ? AND expires_at > ?',
          )
          .get(cacheKey, nowIso()) ?? null);

    return row ? parseJson<T | null>(row.payload_json, null) : null;
  }

  setApiCache(provider: StreamingProviderName, kind: string, cacheKey: string, payload: unknown, expiresAt: string): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `INSERT INTO streaming_api_cache (
          cache_key, provider, kind, payload_json, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          provider = excluded.provider,
          kind = excluded.kind,
          payload_json = excluded.payload_json,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at`,
      )
      .run(cacheKey, provider, kind, JSON.stringify(sanitizeForCache(payload)), expiresAt, timestamp, timestamp);
  }

  upsertImportedPlaylist(
    playlist: StreamingPlaylistDetail,
    options: { kind?: LibraryPlaylist['kind']; addedFrom?: string | null } = {},
  ): LibraryPlaylist {
    const timestamp = nowIso();
    const existing = this.database
      .prepare<[StreamingProviderName, string], DbRow>(
        'SELECT * FROM playlists WHERE source_provider = ? AND source_playlist_id = ? LIMIT 1',
      )
      .get(playlist.provider, playlist.providerPlaylistId);
    const playlistId = existing ? String(existing.id) : randomUUID();
    const playlistKind = options.kind ?? 'synced';
    const playlistCoverUrl = playlist.coverUrl ?? playlist.coverThumb ?? playlist.tracks.find((track) => track.coverUrl || track.coverThumb)?.coverUrl ?? playlist.tracks.find((track) => track.coverUrl || track.coverThumb)?.coverThumb ?? null;

    this.database
      .prepare(
        `INSERT INTO playlists (
          id, name, description, kind, source_provider, source_playlist_id,
          cover_id, cover_url, sort_mode, item_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          kind = excluded.kind,
          source_provider = excluded.source_provider,
          source_playlist_id = excluded.source_playlist_id,
          cover_url = excluded.cover_url,
          sort_mode = excluded.sort_mode,
          updated_at = excluded.updated_at`,
      )
      .run(
        playlistId,
        playlist.title.trim() || 'Streaming Playlist',
        textOrNull(playlist.description),
        playlistKind,
        playlist.provider,
        playlist.providerPlaylistId,
        null,
        playlistCoverUrl,
        'manual',
        Number(existing?.item_count ?? 0),
        textOrNull(existing?.created_at) ?? timestamp,
        timestamp,
      );

    const row = this.database.prepare<[string], DbRow>('SELECT * FROM playlists WHERE id = ?').get(playlistId);
    if (!row) {
      throw new Error(`Failed to save streaming playlist ${playlist.providerPlaylistId}`);
    }

    return this.mapPlaylist(row);
  }

  replacePlaylistItems(playlistId: string): void {
    this.database.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId);
  }

  private appendStreamingPlaylistTracks(
    playlistId: string,
    tracks: StreamingTrack[],
    options: { startPosition: number; addedFrom?: string | null; preservation?: PlaylistItemPreservation | null },
  ): number {
    if (tracks.length === 0) {
      return options.startPosition;
    }

    const timestamp = nowIso();
    const insertItem = this.database.prepare(
      `INSERT INTO playlist_items (
        id, playlist_id, media_type, media_id, source_provider, source_item_id,
        title_snapshot, artist_snapshot, album_snapshot, duration_snapshot,
        cover_id, position, added_at, added_from, unavailable
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let nextPosition = options.startPosition;

    for (const track of tracks) {
      const preserved = takePreservedItem(options.preservation, track);
      insertItem.run(
        randomUUID(),
        playlistId,
        preserved ? 'track' : 'stream_track',
        preserved?.mediaId ?? track.stableKey ?? streamingStableKey(track.provider, track.providerTrackId),
        preserved?.sourceProvider ?? track.provider,
        preserved?.sourceItemId ?? track.providerTrackId,
        track.title,
        track.artist,
        track.album,
        track.duration,
        preserved?.coverId ?? null,
        nextPosition,
        preserved?.addedAt ?? timestamp,
        preserved ? streamingDownloadAddedFrom(track.provider, track.providerTrackId) : (options.addedFrom ?? 'streaming-playlist'),
        0,
      );
      nextPosition += 1;
    }

    this.database
      .prepare(
        `UPDATE playlists SET
          item_count = (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?),
          updated_at = ?
         WHERE id = ?`,
      )
      .run(playlistId, timestamp, playlistId);

    return nextPosition;
  }

  refreshPlaylistItemCount(playlistId: string): LibraryPlaylist {
    const timestamp = nowIso();
    this.database
      .prepare(
        `UPDATE playlists SET
          item_count = (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?),
          updated_at = ?
         WHERE id = ?`,
      )
      .run(playlistId, timestamp, playlistId);
    const row = this.database.prepare<[string], DbRow>('SELECT * FROM playlists WHERE id = ?').get(playlistId);
    if (!row) {
      throw new Error(`Unknown playlist ${playlistId}`);
    }

    return this.mapPlaylist(row);
  }

  private collectDownloadedPlaylistItemPreservation(playlistId: string): PlaylistItemPreservation | null {
    const rows = this.database
      .prepare<[string], DbRow>(
        `SELECT
          playlist_items.media_id,
          playlist_items.source_provider,
          playlist_items.source_item_id,
          playlist_items.title_snapshot,
          playlist_items.artist_snapshot,
          playlist_items.album_snapshot,
          playlist_items.duration_snapshot,
          playlist_items.cover_id,
          playlist_items.added_at,
          playlist_items.added_from,
          tracks.path AS track_path,
          tracks.title AS track_title,
          tracks.artist AS track_artist,
          tracks.album AS track_album,
          tracks.duration AS track_duration
         FROM playlist_items
         INNER JOIN tracks ON tracks.id = playlist_items.media_id AND tracks.missing = 0
         WHERE playlist_items.playlist_id = ?
           AND playlist_items.media_type = 'track'
           AND (
             playlist_items.added_from = 'streaming-download'
             OR playlist_items.added_from LIKE 'streaming-download:%'
           )`,
      )
      .all(playlistId);

    if (rows.length === 0) {
      return null;
    }

    const preservation: PlaylistItemPreservation = {
      bySource: new Map(),
      byMetadata: new Map(),
    };

    for (const row of rows) {
      const mediaId = textOrNull(row.media_id);
      if (!mediaId) {
        continue;
      }

      const item: PreservedDownloadedPlaylistItem = {
        mediaId,
        sourceProvider: textOrNull(row.source_provider) ?? 'local',
        sourceItemId: textOrNull(row.source_item_id) ?? textOrNull(row.track_path),
        titleSnapshot: textOrNull(row.title_snapshot) ?? textOrNull(row.track_title),
        artistSnapshot: textOrNull(row.artist_snapshot) ?? textOrNull(row.track_artist),
        albumSnapshot: textOrNull(row.album_snapshot) ?? textOrNull(row.track_album),
        durationSnapshot: numberOrNull(row.duration_snapshot) ?? numberOrNull(row.track_duration),
        coverId: textOrNull(row.cover_id),
        addedAt: textOrNull(row.added_at) ?? nowIso(),
      };
      const parsedSource = parseStreamingDownloadAddedFrom(row.added_from);
      addPreservedItem(preservation.bySource, playlistSourceKey(parsedSource?.provider, parsedSource?.providerTrackId), item);
      addPreservedItem(
        preservation.byMetadata,
        playlistMetadataKey({
          title: item.titleSnapshot,
          artist: item.artistSnapshot,
          album: item.albumSnapshot,
          duration: item.durationSnapshot,
        }),
        item,
      );
    }

    return hasPreservedItems(preservation) ? preservation : null;
  }

  importStreamingPlaylistPage(
    playlist: StreamingPlaylistDetail,
    options: { reset: boolean; startPosition: number; kind?: LibraryPlaylist['kind']; addedFrom?: string | null },
  ): { playlist: LibraryPlaylist; nextPosition: number } {
    return this.database.transaction(() => {
      const savedPlaylist = this.upsertImportedPlaylist(playlist, options);
      let preservation = this.preservedDownloadedItemsByPlaylistId.get(savedPlaylist.id) ?? null;
      if (options.reset) {
        const currentItemCount = Number(
          this.database.prepare<[string], DbRow>('SELECT COUNT(*) AS total FROM playlist_items WHERE playlist_id = ?').get(savedPlaylist.id)?.total ?? 0,
        );
        preservation = this.collectDownloadedPlaylistItemPreservation(savedPlaylist.id);
        if (currentItemCount > 0) {
          this.backupPlaylistBeforeReset?.(savedPlaylist.id);
        }
        this.replacePlaylistItems(savedPlaylist.id);
        if (preservation) {
          this.preservedDownloadedItemsByPlaylistId.set(savedPlaylist.id, preservation);
        } else {
          this.preservedDownloadedItemsByPlaylistId.delete(savedPlaylist.id);
        }
      }

      this.upsertTracks(playlist.tracks);
      const nextPosition = this.appendStreamingPlaylistTracks(savedPlaylist.id, playlist.tracks, {
        startPosition: options.startPosition,
        addedFrom: options.addedFrom,
        preservation,
      });
      if (preservation && !hasPreservedItems(preservation)) {
        this.preservedDownloadedItemsByPlaylistId.delete(savedPlaylist.id);
      }
      return { playlist: this.refreshPlaylistItemCount(savedPlaylist.id), nextPosition };
    })();
  }

  importLikedStreamingTracks(
    tracks: StreamingTrack[],
    options: { addedFrom: string },
  ): { playlist: LibraryPlaylist; importedCount: number; addedCount: number } {
    return this.database.transaction(() => {
      const playlist = this.getOrCreateLikedSongsPlaylist();
      this.upsertTracks(tracks);

      if (tracks.length === 0) {
        return { playlist: this.refreshPlaylistItemCount(playlist.id), importedCount: 0, addedCount: 0 };
      }

      const existingSourceIds = new Set<string>();
      for (let index = 0; index < tracks.length; index += 400) {
        const chunk = tracks.slice(index, index + 400);
        const predicates = chunk.map(() => '(source_provider = ? AND source_item_id = ?)').join(' OR ');
        const params = chunk.flatMap((track) => [track.provider, track.providerTrackId]);
        const rows = this.database
          .prepare<[string, ...string[]], DbRow>(
            `SELECT source_provider, source_item_id
             FROM playlist_items
             WHERE playlist_id = ? AND (${predicates})`,
          )
          .all(playlist.id, ...params);
        for (const row of rows) {
          const provider = textOrNull(row.source_provider);
          const sourceItemId = textOrNull(row.source_item_id);
          if (provider && sourceItemId) {
            existingSourceIds.add(`${provider}:${sourceItemId}`);
          }
        }
      }

      const timestamp = nowIso();
      const insertItem = this.database.prepare(
        `INSERT INTO playlist_items (
          id, playlist_id, media_type, media_id, source_provider, source_item_id,
          title_snapshot, artist_snapshot, album_snapshot, duration_snapshot,
          cover_id, position, added_at, added_from, unavailable
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let nextPosition = Number(
        this.database
          .prepare<[string], DbRow>('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM playlist_items WHERE playlist_id = ?')
          .get(playlist.id)?.next_position ?? 0,
      );
      let addedCount = 0;

      for (const track of tracks) {
        if (existingSourceIds.has(`${track.provider}:${track.providerTrackId}`)) {
          continue;
        }

        insertItem.run(
          randomUUID(),
          playlist.id,
          'stream_track',
          track.stableKey || streamingStableKey(track.provider, track.providerTrackId),
          track.provider,
          track.providerTrackId,
          track.title,
          track.artist,
          track.album,
          track.duration,
          null,
          nextPosition,
          timestamp,
          options.addedFrom,
          track.playable === false ? 1 : 0,
        );
        existingSourceIds.add(`${track.provider}:${track.providerTrackId}`);
        nextPosition += 1;
        addedCount += 1;
      }

      return { playlist: this.refreshPlaylistItemCount(playlist.id), importedCount: tracks.length, addedCount };
    })();
  }

  unlikeLikedStreamingTrack(provider: StreamingProviderName, providerTrackId: string): void {
    const playlist = this.getOrCreateLikedSongsPlaylist();
    this.database
      .prepare(
        `DELETE FROM playlist_items
         WHERE playlist_id = ?
           AND media_type = 'stream_track'
           AND source_provider = ?
           AND source_item_id = ?`,
      )
      .run(playlist.id, provider, providerTrackId);
    this.refreshPlaylistItemCount(playlist.id);
  }

  private mapPlaylist(row: DbRow): LibraryPlaylist {
    return {
      id: String(row.id),
      name: String(row.name),
      description: textOrNull(row.description),
      kind: row.kind === 'smart' || row.kind === 'synced' || row.kind === 'system' ? row.kind : 'manual',
      sourceProvider:
        row.source_provider === 'netease' || row.source_provider === 'qqmusic' || row.source_provider === 'kugou' || row.source_provider === 'spotify'
          ? row.source_provider
          : 'local',
      sourcePlaylistId: textOrNull(row.source_playlist_id),
      coverId: textOrNull(row.cover_id),
      coverThumb: textOrNull(row.cover_url),
      sortMode:
        row.sort_mode === 'titleAsc' || row.sort_mode === 'titleDesc' || row.sort_mode === 'artistAsc' || row.sort_mode === 'addedDesc'
          ? row.sort_mode
          : 'manual',
      itemCount: Number(row.item_count ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private getOrCreateLikedSongsPlaylist(): LibraryPlaylist {
    const timestamp = nowIso();
    const existing = this.database
      .prepare<[string, string, string], DbRow>(
        'SELECT * FROM playlists WHERE kind = ? AND source_provider = ? AND source_playlist_id = ? LIMIT 1',
      )
      .get('system', 'local', likedSongsSourcePlaylistId);

    if (existing) {
      return this.mapPlaylist(existing);
    }

    const playlistId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO playlists (
          id, name, description, kind, source_provider, source_playlist_id,
          cover_id, cover_url, sort_mode, item_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        playlistId,
        '喜欢的歌曲',
        '本地与在线平台同步的喜欢歌曲',
        'system',
        'local',
        likedSongsSourcePlaylistId,
        null,
        null,
        'manual',
        0,
        timestamp,
        timestamp,
      );

    const row = this.database.prepare<[string], DbRow>('SELECT * FROM playlists WHERE id = ?').get(playlistId);
    if (!row) {
      throw new Error('Failed to create liked songs playlist');
    }

    return this.mapPlaylist(row);
  }

  private mapTrack(row: DbRow): StreamingTrack {
    const provider = providerOrMock(row.provider);
    const providerTrackId = String(row.provider_track_id);
    const raw = parseJson<Partial<StreamingTrack>>(row.raw_json, {});
    const coverUrl = normalizeRemoteImageUrl(provider, textOrNull(row.cover_url));
    const coverThumb = normalizeRemoteImageUrl(provider, textOrNull(raw.coverThumb) ?? textOrNull(row.cover_url));

    return {
      id: String(row.id),
      provider,
      providerTrackId,
      stableKey: textOrNull(row.stable_key) ?? streamingStableKey(provider, providerTrackId),
      title: String(row.title),
      artist: String(row.artist),
      artists: Array.isArray(raw.artists) ? raw.artists : [],
      album: String(row.album),
      albumId: textOrNull(row.album_id),
      albumArtist: textOrNull(row.album_artist),
      duration: numberOrNull(row.duration),
      coverUrl,
      coverThumb,
      qualities: parseJson(row.qualities_json, []),
      explicit: raw.explicit === true,
      playable: Number(row.playable ?? 1) !== 0,
      unavailableReason: textOrNull(row.unavailable_reason),
      lyricsStatus:
        row.lyrics_status === 'available' || row.lyrics_status === 'missing' ? row.lyrics_status : 'unknown',
      mvStatus: row.mv_status === 'available' || row.mv_status === 'missing' ? row.mv_status : 'unknown',
    };
  }
}
