import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToMainLoop } from 'node:timers/promises';
import type { EchoDatabase } from '../../database/createDatabase';
import type {
  DuplicateTrackCleanupMember,
  DuplicateTrackCleanupPreview,
  DuplicateTrackGroup,
  DuplicateTrackIndexSummary,
  DuplicateTrackMember,
  DuplicateTrackMode,
  LibraryTrack,
} from '../../../shared/types/library';
import {
  canStrictMergeTracks,
  createStrictDuplicateBucketKey,
  createStrictDuplicateClusterKey,
} from './DuplicateTrackIdentity';
import { scoreTrackQuality } from './DuplicateTrackQuality';
import type { TrackLikeForDuplicate } from './DuplicateTrackTypes';

type DbRow = Record<string, unknown>;

type DuplicateTrackCandidate = TrackLikeForDuplicate & {
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  embeddedMetadataStatus: LibraryTrack['embeddedMetadataStatus'];
  embeddedCoverStatus: LibraryTrack['embeddedCoverStatus'];
  networkMetadataStatus: LibraryTrack['networkMetadataStatus'];
  fieldSources: Record<string, string>;
};

type DuplicateTrackCleanupGroupBuilder = {
  id: string;
  duplicateKey: string;
  confidence: number;
  trackCount: number;
  keep: DuplicateTrackCleanupMember | null;
  remove: DuplicateTrackCleanupMember[];
};

const nowIso = (): string => new Date().toISOString();
const DUPLICATE_SCAN_TRACK_YIELD_INTERVAL = 250;
const DUPLICATE_SCAN_BUCKET_YIELD_INTERVAL = 50;
const DUPLICATE_SCAN_GROUP_YIELD_INTERVAL = 50;
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const numberOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

const parseStringArray = (value: unknown): string[] => {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const parseJsonObject = (value: unknown): Record<string, string> => {
  if (typeof value !== 'string') {
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

const medianDuration = (tracks: TrackLikeForDuplicate[]): number => {
  const sorted = tracks.map((track) => track.duration).sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2 : sorted[midpoint]!;
};

const normalizeMode = (mode: DuplicateTrackMode = 'strict'): DuplicateTrackMode => (mode === 'strict' ? 'strict' : 'strict');

export class DuplicateTrackService {
  constructor(
    private readonly database: EchoDatabase,
    private readonly toCoverUrl: (coverId: unknown, variant: 'thumb') => string | null,
  ) {}

  rebuildDuplicateTrackIndex(mode: DuplicateTrackMode = 'strict'): DuplicateTrackIndexSummary {
    const normalizedMode = normalizeMode(mode);
    const updatedAt = nowIso();
    const tracks = this.loadActiveTracks();
    const clusters = this.buildStrictClusters(tracks);

    return this.persistDuplicateTrackIndex(normalizedMode, updatedAt, tracks.length, clusters);
  }

  async rebuildDuplicateTrackIndexAsync(mode: DuplicateTrackMode = 'strict'): Promise<DuplicateTrackIndexSummary> {
    const normalizedMode = normalizeMode(mode);
    const updatedAt = nowIso();
    const tracks = this.loadActiveTracks();
    await yieldToMainLoop();
    const clusters = await this.buildStrictClustersAsync(tracks);

    return this.persistDuplicateTrackIndex(normalizedMode, updatedAt, tracks.length, clusters);
  }

  private persistDuplicateTrackIndex(
    normalizedMode: DuplicateTrackMode,
    updatedAt: string,
    totalTracksScanned: number,
    clusters: DuplicateTrackCandidate[][],
  ): DuplicateTrackIndexSummary {
    return this.database.transaction(() => {
      this.database.prepare('DELETE FROM duplicate_track_members WHERE group_id IN (SELECT id FROM duplicate_track_groups WHERE mode = ?)').run(normalizedMode);
      this.database.prepare('DELETE FROM duplicate_track_groups WHERE mode = ?').run(normalizedMode);

      let duplicateMembers = 0;
      let hiddenTracks = 0;

      for (const cluster of clusters) {
        const median = medianDuration(cluster);
        const duplicateKey = `${normalizedMode}\u0000${createStrictDuplicateClusterKey(cluster[0]!, median)}`;
        const ranked = [...cluster]
          .map((track) => ({
            track,
            qualityScore: scoreTrackQuality(track),
          }))
          .sort((a, b) => {
            const qualityDelta = b.qualityScore - a.qualityScore;
            if (qualityDelta !== 0) {
              return qualityDelta;
            }

            const durationDelta = Math.abs(a.track.duration - median) - Math.abs(b.track.duration - median);
            if (durationDelta !== 0) {
              return durationDelta;
            }

            const sizeDelta = (b.track.sizeBytes ?? 0) - (a.track.sizeBytes ?? 0);
            if (sizeDelta !== 0) {
              return sizeDelta;
            }

            return (a.track.path ?? '').localeCompare(b.track.path ?? '');
          });
        const groupId = randomUUID();
        const representativeTrackId = ranked[0]!.track.id;
        const groupReasons = ['strict_title_artist_duration_cluster'];

        this.database
          .prepare(
            `INSERT INTO duplicate_track_groups (
              id, mode, duplicate_key, representative_track_id, track_count, hidden_count,
              confidence, reasons_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            groupId,
            normalizedMode,
            duplicateKey,
            representativeTrackId,
            ranked.length,
            ranked.length - 1,
            1,
            JSON.stringify(groupReasons),
            updatedAt,
            updatedAt,
          );

        ranked.forEach((entry, index) => {
          const rank = index + 1;
          const hidden = rank > 1 ? 1 : 0;
          const reasons = rank === 1 ? ['representative_highest_quality'] : ['hidden_lower_quality_duplicate'];
          this.database
            .prepare(
              `INSERT INTO duplicate_track_members (
                group_id, track_id, quality_score, rank, hidden, reasons_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(groupId, entry.track.id, entry.qualityScore, rank, hidden, JSON.stringify(reasons), updatedAt, updatedAt);
          duplicateMembers += 1;
          hiddenTracks += hidden;
        });
      }

      return {
        mode: normalizedMode,
        totalTracksScanned,
        duplicateGroups: clusters.length,
        duplicateMembers,
        hiddenTracks,
        updatedAt,
      };
    })();
  }

  getDuplicateGroupForTrack(trackId: string): DuplicateTrackGroup | null {
    const row = this.database
      .prepare<[string], DbRow>(
        `SELECT duplicate_track_groups.*
         FROM duplicate_track_groups
         INNER JOIN duplicate_track_members ON duplicate_track_members.group_id = duplicate_track_groups.id
         WHERE duplicate_track_members.track_id = ?
         ORDER BY duplicate_track_groups.updated_at DESC
         LIMIT 1`,
      )
      .get(trackId);

    return row ? this.mapGroup(row) : null;
  }

  getDuplicateMembersForTrack(trackId: string): DuplicateTrackMember[] {
    const group = this.getDuplicateGroupForTrack(trackId);

    if (!group) {
      return [];
    }

    const rows = this.database
      .prepare<[string], DbRow>(
        `SELECT
          duplicate_track_members.group_id, duplicate_track_members.quality_score, duplicate_track_members.rank,
          duplicate_track_members.hidden, duplicate_track_members.reasons_json AS member_reasons_json,
          tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
          tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
          tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
          tracks.cover_id, tracks.metadata_status, tracks.embedded_metadata_status, tracks.embedded_cover_status,
          tracks.network_metadata_status, tracks.field_sources_json
        FROM duplicate_track_members
        INNER JOIN tracks ON tracks.id = duplicate_track_members.track_id
        WHERE duplicate_track_members.group_id = ?
        ORDER BY duplicate_track_members.rank ASC`,
      )
      .all(group.id);

    return rows.map((row) => ({
      groupId: String(row.group_id),
      track: this.mapTrack(row),
      qualityScore: Number(row.quality_score ?? 0),
      rank: Number(row.rank ?? 0),
      hidden: Number(row.hidden ?? 0) === 1,
      reasons: parseStringArray(row.member_reasons_json),
    }));
  }

  getDuplicateIndexSummary(mode: DuplicateTrackMode = 'strict'): DuplicateTrackIndexSummary {
    const normalizedMode = normalizeMode(mode);
    const totalTracksScanned = Number(
      this.database.prepare<[], DbRow>('SELECT COUNT(*) AS total FROM tracks WHERE missing = 0').get()?.total ?? 0,
    );
    const row = this.database
      .prepare<[DuplicateTrackMode], DbRow>(
        `SELECT
          COUNT(*) AS duplicate_groups,
          COALESCE(SUM(track_count), 0) AS duplicate_members,
          COALESCE(SUM(hidden_count), 0) AS hidden_tracks,
          MAX(updated_at) AS updated_at
        FROM duplicate_track_groups
        WHERE mode = ?`,
      )
      .get(normalizedMode);

    return {
      mode: normalizedMode,
      totalTracksScanned,
      duplicateGroups: Number(row?.duplicate_groups ?? 0),
      duplicateMembers: Number(row?.duplicate_members ?? 0),
      hiddenTracks: Number(row?.hidden_tracks ?? 0),
      updatedAt: textOrNull(row?.updated_at) ?? '',
    };
  }

  getCleanupPreview(mode: DuplicateTrackMode = 'strict'): DuplicateTrackCleanupPreview {
    const normalizedMode = normalizeMode(mode);
    const rows = this.database
      .prepare<[DuplicateTrackMode], DbRow>(
        `SELECT
          duplicate_track_groups.id AS group_id,
          duplicate_track_groups.duplicate_key,
          duplicate_track_groups.track_count,
          duplicate_track_groups.confidence,
          duplicate_track_members.quality_score,
          duplicate_track_members.rank,
          duplicate_track_members.hidden,
          duplicate_track_members.reasons_json AS member_reasons_json,
          tracks.id, tracks.path, tracks.title, tracks.artist, tracks.album, tracks.album_artist,
          tracks.track_no, tracks.disc_no, tracks.year, tracks.genre,
          tracks.duration, tracks.codec, tracks.sample_rate, tracks.bit_depth, tracks.bitrate,
          tracks.cover_id, tracks.size_bytes, tracks.metadata_status, tracks.embedded_metadata_status,
          tracks.embedded_cover_status, tracks.network_metadata_status, tracks.field_sources_json
        FROM duplicate_track_groups
        INNER JOIN duplicate_track_members ON duplicate_track_members.group_id = duplicate_track_groups.id
        INNER JOIN tracks ON tracks.id = duplicate_track_members.track_id AND tracks.missing = 0
        WHERE duplicate_track_groups.mode = ?
        ORDER BY duplicate_track_groups.updated_at DESC, duplicate_track_groups.id ASC, duplicate_track_members.rank ASC`,
      )
      .all(normalizedMode);

    const builders = new Map<string, DuplicateTrackCleanupGroupBuilder>();

    for (const row of rows) {
      const groupId = String(row.group_id);
      const builder = builders.get(groupId) ?? {
        id: groupId,
        duplicateKey: String(row.duplicate_key),
        confidence: Number(row.confidence ?? 0),
        trackCount: Number(row.track_count ?? 0),
        keep: null,
        remove: [],
      };
      builders.set(groupId, builder);

      const member: DuplicateTrackCleanupMember = {
        track: this.mapTrack(row),
        qualityScore: Number(row.quality_score ?? 0),
        rank: Number(row.rank ?? 0),
        sizeBytes: numberOrNull(row.size_bytes),
        reasons: parseStringArray(row.member_reasons_json),
      };

      if (Number(row.hidden ?? 0) === 1) {
        builder.remove.push(member);
      } else if (!builder.keep || member.rank < builder.keep.rank) {
        builder.keep = member;
      }
    }

    const groups = Array.from(builders.values())
      .filter((group): group is DuplicateTrackCleanupGroupBuilder & { keep: DuplicateTrackCleanupMember } =>
        Boolean(group.keep && group.remove.length > 0),
      )
      .map((group) => ({
        id: group.id,
        duplicateKey: group.duplicateKey,
        confidence: group.confidence,
        trackCount: group.trackCount,
        keep: group.keep,
        remove: group.remove,
      }));
    const removeTrackIds = groups.flatMap((group) => group.remove.map((member) => member.track.id));
    const totalBytesToRemove = groups.reduce(
      (total, group) => total + group.remove.reduce((groupTotal, member) => groupTotal + (member.sizeBytes ?? 0), 0),
      0,
    );

    return {
      summary: this.getDuplicateIndexSummary(normalizedMode),
      groups,
      removeTrackIds,
      totalTracksToRemove: removeTrackIds.length,
      totalBytesToRemove,
      generatedAt: nowIso(),
    };
  }

  async scanCleanupPreview(mode: DuplicateTrackMode = 'strict'): Promise<DuplicateTrackCleanupPreview> {
    const normalizedMode = normalizeMode(mode);
    const updatedAt = nowIso();
    const tracks = this.loadActiveTracks();
    await yieldToMainLoop();
    const clusters = await this.buildStrictClustersAsync(tracks);
    const groups: DuplicateTrackCleanupPreview['groups'] = [];
    let duplicateMembers = 0;
    let hiddenTracks = 0;

    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index]!;
      const median = medianDuration(cluster);
      const duplicateKey = `${normalizedMode}\u0000${createStrictDuplicateClusterKey(cluster[0]!, median)}`;
      const ranked = this.rankClusterByQuality(cluster, median);
      duplicateMembers += ranked.length;
      hiddenTracks += Math.max(0, ranked.length - 1);

      groups.push({
        id: duplicateKey,
        duplicateKey,
        confidence: 1,
        trackCount: ranked.length,
        keep: this.mapCandidateCleanupMember(ranked[0]!.track, ranked[0]!.qualityScore, 1, ['representative_highest_quality']),
        remove: ranked
          .slice(1)
          .map((entry, removeIndex) =>
            this.mapCandidateCleanupMember(entry.track, entry.qualityScore, removeIndex + 2, ['hidden_lower_quality_duplicate']),
          ),
      });

      if (index % DUPLICATE_SCAN_GROUP_YIELD_INTERVAL === DUPLICATE_SCAN_GROUP_YIELD_INTERVAL - 1) {
        await yieldToMainLoop();
      }
    }

    const removeTrackIds = groups.flatMap((group) => group.remove.map((member) => member.track.id));
    const totalBytesToRemove = groups.reduce(
      (total, group) => total + group.remove.reduce((groupTotal, member) => groupTotal + (member.sizeBytes ?? 0), 0),
      0,
    );

    return {
      summary: {
        mode: normalizedMode,
        totalTracksScanned: tracks.length,
        duplicateGroups: groups.length,
        duplicateMembers,
        hiddenTracks,
        updatedAt,
      },
      groups,
      removeTrackIds,
      totalTracksToRemove: removeTrackIds.length,
      totalBytesToRemove,
      generatedAt: updatedAt,
    };
  }

  private loadActiveTracks(): DuplicateTrackCandidate[] {
    return this.database
      .prepare<[], DbRow>(
        `SELECT
          id, path, title, artist, album, album_artist, track_no, disc_no, year, genre,
          duration, codec, sample_rate, bit_depth, bitrate, cover_id, size_bytes, metadata_status,
          embedded_metadata_status, embedded_cover_status, network_metadata_status, field_sources_json
        FROM tracks
        WHERE missing = 0`,
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        path: String(row.path),
        title: String(row.title),
        artist: String(row.artist),
        album: String(row.album),
        albumArtist: String(row.album_artist),
        trackNo: numberOrNull(row.track_no),
        discNo: numberOrNull(row.disc_no),
        year: numberOrNull(row.year),
        genre: textOrNull(row.genre),
        duration: Number(row.duration ?? 0),
        codec: textOrNull(row.codec),
        sampleRate: numberOrNull(row.sample_rate),
        bitDepth: numberOrNull(row.bit_depth),
        bitrate: numberOrNull(row.bitrate),
        coverId: textOrNull(row.cover_id),
        sizeBytes: numberOrNull(row.size_bytes),
        metadataStatus: textOrNull(row.metadata_status),
        embeddedMetadataStatus: this.mapEmbeddedStatus(row.embedded_metadata_status),
        embeddedCoverStatus: this.mapEmbeddedStatus(row.embedded_cover_status),
        networkMetadataStatus: this.mapNetworkStatus(row.network_metadata_status),
        fieldSources: parseJsonObject(row.field_sources_json),
      }));
  }

  private buildStrictClusters(tracks: DuplicateTrackCandidate[]): DuplicateTrackCandidate[][] {
    const buckets = new Map<string, DuplicateTrackCandidate[]>();

    for (const track of tracks) {
      const bucketKey = createStrictDuplicateBucketKey(track);

      if (!bucketKey) {
        continue;
      }

      const bucket = buckets.get(bucketKey);
      if (bucket) {
        bucket.push(track);
      } else {
        buckets.set(bucketKey, [track]);
      }
    }

    const clusters: DuplicateTrackCandidate[][] = [];

    for (const bucket of buckets.values()) {
      const sorted = [...bucket].sort((a, b) => a.duration - b.duration);
      let current: DuplicateTrackCandidate[] = [];

      for (const track of sorted) {
        const previous = current[current.length - 1];
        const canJoinByNeighbor = previous ? Math.abs(track.duration - previous.duration) <= 2 : true;
        const canJoinCluster = current.every((candidate) => canStrictMergeTracks(candidate, track).duplicate);

        if (current.length === 0 || (canJoinByNeighbor && canJoinCluster)) {
          current.push(track);
          continue;
        }

        if (current.length >= 2) {
          clusters.push(current);
        }

        current = [track];
      }

      if (current.length >= 2) {
        clusters.push(current);
      }
    }

    return clusters;
  }

  private async buildStrictClustersAsync(tracks: DuplicateTrackCandidate[]): Promise<DuplicateTrackCandidate[][]> {
    const buckets = new Map<string, DuplicateTrackCandidate[]>();

    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index]!;
      const bucketKey = createStrictDuplicateBucketKey(track);

      if (bucketKey) {
        const bucket = buckets.get(bucketKey);
        if (bucket) {
          bucket.push(track);
        } else {
          buckets.set(bucketKey, [track]);
        }
      }

      if (index % DUPLICATE_SCAN_TRACK_YIELD_INTERVAL === DUPLICATE_SCAN_TRACK_YIELD_INTERVAL - 1) {
        await yieldToMainLoop();
      }
    }

    const clusters: DuplicateTrackCandidate[][] = [];
    let bucketIndex = 0;

    for (const bucket of buckets.values()) {
      const sorted = [...bucket].sort((a, b) => a.duration - b.duration);
      let current: DuplicateTrackCandidate[] = [];

      for (const track of sorted) {
        const previous = current[current.length - 1];
        const canJoinByNeighbor = previous ? Math.abs(track.duration - previous.duration) <= 2 : true;
        const canJoinCluster = current.every((candidate) => canStrictMergeTracks(candidate, track).duplicate);

        if (current.length === 0 || (canJoinByNeighbor && canJoinCluster)) {
          current.push(track);
          continue;
        }

        if (current.length >= 2) {
          clusters.push(current);
        }

        current = [track];
      }

      if (current.length >= 2) {
        clusters.push(current);
      }

      bucketIndex += 1;
      if (bucketIndex % DUPLICATE_SCAN_BUCKET_YIELD_INTERVAL === 0) {
        await yieldToMainLoop();
      }
    }

    return clusters;
  }

  private rankClusterByQuality(cluster: DuplicateTrackCandidate[], median: number): Array<{
    track: DuplicateTrackCandidate;
    qualityScore: number;
  }> {
    return [...cluster]
      .map((track) => ({
        track,
        qualityScore: scoreTrackQuality(track),
      }))
      .sort((a, b) => {
        const qualityDelta = b.qualityScore - a.qualityScore;
        if (qualityDelta !== 0) {
          return qualityDelta;
        }

        const durationDelta = Math.abs(a.track.duration - median) - Math.abs(b.track.duration - median);
        if (durationDelta !== 0) {
          return durationDelta;
        }

        const sizeDelta = (b.track.sizeBytes ?? 0) - (a.track.sizeBytes ?? 0);
        if (sizeDelta !== 0) {
          return sizeDelta;
        }

        return (a.track.path ?? '').localeCompare(b.track.path ?? '');
      });
  }

  private mapCandidateCleanupMember(
    track: DuplicateTrackCandidate,
    qualityScore: number,
    rank: number,
    reasons: string[],
  ): DuplicateTrackCleanupMember {
    return {
      track: {
        id: track.id,
        path: track.path ?? '',
        title: track.title,
        artist: track.artist,
        album: track.album ?? '',
        albumArtist: track.albumArtist ?? '',
        trackNo: track.trackNo,
        discNo: track.discNo,
        year: track.year,
        genre: track.genre,
        duration: track.duration,
        codec: track.codec ?? null,
        sampleRate: track.sampleRate ?? null,
        bitDepth: track.bitDepth ?? null,
        bitrate: track.bitrate ?? null,
        coverId: track.coverId ?? null,
        coverThumb: this.toCoverUrl(track.coverId, 'thumb'),
        metadataStatus: track.metadataStatus ?? 'ok',
        embeddedMetadataStatus: track.embeddedMetadataStatus,
        embeddedCoverStatus: track.embeddedCoverStatus,
        networkMetadataStatus: track.networkMetadataStatus,
        fieldSources: track.fieldSources,
      },
      qualityScore,
      rank,
      sizeBytes: track.sizeBytes ?? null,
      reasons,
    };
  }

  private mapGroup(row: DbRow): DuplicateTrackGroup {
    return {
      id: String(row.id),
      mode: normalizeMode(row.mode as DuplicateTrackMode),
      duplicateKey: String(row.duplicate_key),
      representativeTrackId: String(row.representative_track_id),
      trackCount: Number(row.track_count ?? 0),
      hiddenCount: Number(row.hidden_count ?? 0),
      confidence: Number(row.confidence ?? 0),
      reasons: parseStringArray(row.reasons_json),
    };
  }

  private mapTrack(row: DbRow): LibraryTrack {
    return {
      id: String(row.id),
      path: String(row.path),
      title: String(row.title),
      artist: String(row.artist),
      album: String(row.album),
      albumArtist: String(row.album_artist),
      trackNo: numberOrNull(row.track_no),
      discNo: numberOrNull(row.disc_no),
      year: numberOrNull(row.year),
      genre: textOrNull(row.genre),
      duration: Number(row.duration ?? 0),
      codec: textOrNull(row.codec),
      sampleRate: numberOrNull(row.sample_rate),
      bitDepth: numberOrNull(row.bit_depth),
      bitrate: numberOrNull(row.bitrate),
      coverId: textOrNull(row.cover_id),
      coverThumb: this.toCoverUrl(row.cover_id, 'thumb'),
      metadataStatus: textOrNull(row.metadata_status) ?? 'ok',
      embeddedMetadataStatus: this.mapEmbeddedStatus(row.embedded_metadata_status),
      embeddedCoverStatus: this.mapEmbeddedStatus(row.embedded_cover_status),
      networkMetadataStatus: this.mapNetworkStatus(row.network_metadata_status),
      fieldSources: parseJsonObject(row.field_sources_json),
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
}
