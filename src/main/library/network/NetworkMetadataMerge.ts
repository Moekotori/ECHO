import { randomUUID } from 'node:crypto';
import type { EchoDatabase } from '../../database/createDatabase';
import type { MissingMetadataField } from '../../../shared/types/library';
import type { CoverResult, FieldSource, FieldSources } from '../libraryTypes';
import { NETWORK_AUTO_APPLY_THRESHOLD } from './matchScore';
import { NetworkMetadataStore } from './NetworkMetadataStore';
import type { AppliedNetworkFields, NetworkApplyResult, StoredNetworkMetadataCandidate } from './networkTypes';

type DbRow = Record<string, unknown>;

const writableSources = new Set<FieldSource>(['unknown', 'artist_fallback', 'filename_fallback', 'network']);
const protectedSources = new Set<FieldSource>(['manual', 'embedded', 'sidecar', 'folder_structure']);

const parseFieldSources = (value: unknown): FieldSources => {
  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as FieldSources) : {};
  } catch {
    return {};
  }
};

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

export class NetworkMetadataMerge {
  private readonly store: NetworkMetadataStore;

  constructor(private readonly database: EchoDatabase) {
    this.store = new NetworkMetadataStore(database);
  }

  applyMissingOnly(candidateId: string, force = false, fields?: MissingMetadataField[]): NetworkApplyResult {
    const candidate = this.store.getMetadataCandidate(candidateId);

    if (!candidate) {
      return { status: 'error', appliedFields: {}, reason: 'candidate_missing' };
    }

    if (!force && candidate.score < NETWORK_AUTO_APPLY_THRESHOLD) {
      return { status: 'candidate_found', appliedFields: {}, reason: 'score_below_auto_apply_threshold' };
    }

    if (this.store.hasRejectedDecision(candidate.trackId, candidate.id)) {
      return { status: 'rejected', appliedFields: {}, reason: 'candidate_rejected' };
    }

    return this.store.transaction(() => this.applyCandidateInTransaction(candidate, force, fields));
  }

  reject(candidateId: string): NetworkApplyResult {
    const candidate = this.store.getMetadataCandidate(candidateId);

    if (!candidate) {
      return { status: 'error', appliedFields: {}, reason: 'candidate_missing' };
    }

    this.store.recordDecision(candidate.trackId, candidate.id, 'rejected', {});
    this.database.prepare("UPDATE tracks SET network_metadata_status = 'rejected', updated_at = ? WHERE id = ?").run(new Date().toISOString(), candidate.trackId);
    return { status: 'rejected', appliedFields: {} };
  }

  applyCoverIfMissing(trackId: string, cover: CoverResult, score: number): NetworkApplyResult {
    if (score < NETWORK_AUTO_APPLY_THRESHOLD) {
      return { status: 'candidate_found', appliedFields: {}, reason: 'score_below_auto_apply_threshold' };
    }

    const row = this.database
      .prepare<[string], DbRow>(
        `SELECT tracks.cover_id, tracks.embedded_cover_status, covers.source_type
         FROM tracks
         LEFT JOIN covers ON covers.id = tracks.cover_id
         WHERE tracks.id = ? AND tracks.missing = 0`,
      )
      .get(trackId);

    if (!row) {
      return { status: 'error', appliedFields: {}, reason: 'track_missing' };
    }

    const embeddedCoverStatus = String(row.embedded_cover_status ?? 'pending');
    if (embeddedCoverStatus === 'pending' || embeddedCoverStatus === 'reading') {
      return { status: 'candidate_found', appliedFields: {}, reason: 'embedded_cover_not_ready' };
    }

    const sourceType = textOrNull(row.source_type) ?? 'default';
    if (sourceType !== 'default') {
      return { status: 'candidate_found', appliedFields: {}, reason: `cover_source_${sourceType}_protected` };
    }

    const coverId = this.upsertNetworkCover(cover);
    this.database.prepare('UPDATE tracks SET cover_id = ?, updated_at = ? WHERE id = ?').run(coverId, new Date().toISOString(), trackId);
    return { status: 'applied_missing_only', appliedFields: { coverId } };
  }

  private applyCandidateInTransaction(
    candidate: StoredNetworkMetadataCandidate,
    force: boolean,
    fields?: MissingMetadataField[],
  ): NetworkApplyResult {
    this.store.repairStaleReadiness(candidate.trackId);
    const row = this.database.prepare<[string], DbRow>('SELECT * FROM tracks WHERE id = ? AND missing = 0').get(candidate.trackId);

    if (!row) {
      return { status: 'error', appliedFields: {}, reason: 'track_missing' };
    }

    const embeddedMetadataStatus = String(row.embedded_metadata_status ?? 'pending');
    if (embeddedMetadataStatus === 'pending' || embeddedMetadataStatus === 'reading') {
      return { status: 'candidate_found', appliedFields: {}, reason: 'embedded_metadata_not_ready' };
    }

    if (embeddedMetadataStatus === 'present' && !force) {
      return { status: 'candidate_found', appliedFields: {}, reason: 'embedded_metadata_present' };
    }

    const fieldSources = parseFieldSources(row.field_sources_json);
    const appliedFields: AppliedNetworkFields = {};
    const shouldApplyField = (field: MissingMetadataField): boolean => !fields?.length || fields.includes(field);

    if (shouldApplyField('title')) {
      this.maybeApplyText(appliedFields, fieldSources, 'title', candidate.title, row.title);
    }
    if (shouldApplyField('artist')) {
      this.maybeApplyText(appliedFields, fieldSources, 'artist', candidate.artist, row.artist);
    }
    if (shouldApplyField('album')) {
      this.maybeApplyText(appliedFields, fieldSources, 'album', candidate.album, row.album);
    }
    if (shouldApplyField('albumArtist')) {
      this.maybeApplyText(appliedFields, fieldSources, 'albumArtist', candidate.albumArtist, row.album_artist);
    }
    if (shouldApplyField('year')) {
      this.maybeApplyNumber(appliedFields, fieldSources, 'year', candidate.year, row.year);
    }
    if (shouldApplyField('genre')) {
      this.maybeApplyText(appliedFields, fieldSources, 'genre', candidate.genre, row.genre);
    }
    if (shouldApplyField('trackNo')) {
      this.maybeApplyNumber(appliedFields, fieldSources, 'trackNo', candidate.trackNo, row.track_no);
    }
    if (shouldApplyField('discNo')) {
      this.maybeApplyNumber(appliedFields, fieldSources, 'discNo', candidate.discNo, row.disc_no);
    }

    if (Object.keys(appliedFields).length === 0) {
      if (!candidate.coverUrl || !shouldApplyField('cover')) {
        this.store.recordDecision(candidate.trackId, candidate.id, 'ignored', {});
      }
      return { status: 'candidate_found', appliedFields: {}, reason: 'no_missing_fields' };
    }

    const nextSources = { ...fieldSources };
    for (const key of Object.keys(appliedFields)) {
      nextSources[key] = 'network';
    }

    this.database
      .prepare(
        `UPDATE tracks SET
          title = ?,
          artist = ?,
          album = ?,
          album_artist = ?,
          year = ?,
          genre = ?,
          track_no = ?,
          disc_no = ?,
          field_sources_json = ?,
          network_metadata_status = 'applied_missing_only',
          updated_at = ?
        WHERE id = ?`,
      )
      .run(
        appliedFields.title ?? row.title,
        appliedFields.artist ?? row.artist,
        appliedFields.album ?? row.album,
        appliedFields.albumArtist ?? row.album_artist,
        appliedFields.year ?? row.year,
        appliedFields.genre ?? row.genre,
        appliedFields.trackNo ?? row.track_no,
        appliedFields.discNo ?? row.disc_no,
        JSON.stringify(nextSources),
        new Date().toISOString(),
        candidate.trackId,
      );

    this.store.recordDecision(candidate.trackId, candidate.id, 'accepted', appliedFields);
    return { status: 'applied_missing_only', appliedFields };
  }

  private maybeApplyText(
    appliedFields: AppliedNetworkFields,
    fieldSources: FieldSources,
    key: keyof AppliedNetworkFields,
    candidateValue: string | null,
    currentValue: unknown,
  ): void {
    if (!candidateValue || protectedSources.has(fieldSources[key] ?? 'unknown')) {
      return;
    }

    const currentText = typeof currentValue === 'string' ? currentValue.trim() : '';
    if (currentText && !writableSources.has(fieldSources[key] ?? 'unknown')) {
      return;
    }

    if (writableSources.has(fieldSources[key] ?? 'unknown')) {
      (appliedFields as Record<string, string>)[key] = candidateValue;
    }
  }

  private maybeApplyNumber(
    appliedFields: AppliedNetworkFields,
    fieldSources: FieldSources,
    key: keyof AppliedNetworkFields,
    candidateValue: number | null,
    currentValue: unknown,
  ): void {
    if (!candidateValue || protectedSources.has(fieldSources[key] ?? 'unknown')) {
      return;
    }

    const currentNumber = typeof currentValue === 'number' && Number.isFinite(currentValue) ? currentValue : null;
    if (currentNumber && !writableSources.has(fieldSources[key] ?? 'unknown')) {
      return;
    }

    if (writableSources.has(fieldSources[key] ?? 'unknown')) {
      (appliedFields as Record<string, number>)[key] = candidateValue;
    }
  }

  private upsertNetworkCover(result: CoverResult): string {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const sourceHash = result.sourceHash;
    const existing = this.database.prepare<[string], { id: string }>('SELECT id FROM covers WHERE source_hash = ?').get(sourceHash);

    if (existing?.id) {
      this.database
        .prepare(
          `UPDATE covers SET source_type = 'network', mime_type = ?, thumb_path = ?, album_path = ?, large_path = ?,
            original_ref = ?, cache_version = ?, warnings_json = ?, errors_json = ?, cover_thumb = ?, cover_large = ?,
            cover_original = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          result.mimeType,
          result.thumbPath,
          result.albumPath,
          result.largePath,
          result.originalRef,
          1,
          JSON.stringify(result.warnings),
          JSON.stringify(result.errors),
          result.thumbPath,
          result.largePath,
          result.originalRef,
          timestamp,
          existing.id,
        );
      return existing.id;
    }

    this.database
      .prepare(
        `INSERT INTO covers (
          id, source_type, source_hash, mime_type, thumb_path, album_path, large_path, original_ref,
          cache_version, warnings_json, errors_json, cover_thumb, cover_large, cover_original, created_at, updated_at
        ) VALUES (?, 'network', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sourceHash,
        result.mimeType,
        result.thumbPath,
        result.albumPath,
        result.largePath,
        result.originalRef,
        1,
        JSON.stringify(result.warnings),
        JSON.stringify(result.errors),
        result.thumbPath,
        result.largePath,
        result.originalRef,
        timestamp,
        timestamp,
      );

    return id;
  }
}
