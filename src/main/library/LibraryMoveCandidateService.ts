import { createHash } from 'node:crypto';
import type { EchoDatabase } from '../database/createDatabase';
import type { LibraryMoveCandidate, LibraryMoveCandidateConfidence, LibraryMoveCandidateOptions } from './libraryTypes';

type MoveCandidateRow = {
  old_track_id: string;
  old_path: string;
  old_file_identity: string | null;
  old_file_identity_source: string | null;
  old_quick_hash: string | null;
  old_quick_hash_version: number | null;
  old_size_bytes: number | null;
  old_duration: number | null;
  old_title: string | null;
  old_artist: string | null;
  old_album: string | null;
  new_track_id: string;
  new_path: string;
  new_file_identity: string | null;
  new_file_identity_source: string | null;
  new_quick_hash: string | null;
  new_quick_hash_version: number | null;
  new_size_bytes: number | null;
  new_duration: number | null;
  new_title: string | null;
  new_artist: string | null;
  new_album: string | null;
};

type CandidateDraft = Omit<LibraryMoveCandidate, 'ambiguous' | 'confidence'> & {
  confidence: LibraryMoveCandidateConfidence;
};

const defaultLimit = 100;
const maxLimit = 100;
const durationCloseSeconds = 1;
const candidateReadLimit = 2_000;
const invalidFileIdentitySources = new Set(['unsupported', 'error']);
const unknownMetadataValues = new Set(['', 'unknown', 'unknown artist', 'unknown album']);

const normalizeLimit = (value: unknown): number => {
  const limit = Number(value);
  if (!Number.isFinite(limit)) {
    return defaultLimit;
  }

  return Math.max(1, Math.min(maxLimit, Math.floor(limit)));
};

const textOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizedMetadata = (value: unknown): string | null => {
  const text = textOrNull(value)?.normalize('NFKC').toLocaleLowerCase() ?? null;
  if (!text || unknownMetadataValues.has(text)) {
    return null;
  }

  return text;
};

const numbersMatch = (left: unknown, right: unknown): boolean => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
};

const durationDeltaFor = (left: unknown, right: unknown): number | null => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return null;
  }

  return Math.abs(leftNumber - rightNumber);
};

const hasValidFileIdentitySource = (source: string | null): boolean =>
  Boolean(source && !invalidFileIdentitySources.has(source));

const stableCandidateId = (oldTrackId: string, newTrackId: string, reasonCodes: string[]): string =>
  `move-candidate:${createHash('sha256')
    .update(`${oldTrackId}\u0000${newTrackId}\u0000${reasonCodes.join('|')}`)
    .digest('hex')
    .slice(0, 24)}`;

export class LibraryMoveCandidateService {
  constructor(private readonly database: EchoDatabase) {}

  getMoveCandidates(options: LibraryMoveCandidateOptions = {}): LibraryMoveCandidate[] {
    const limit = normalizeLimit(options.limit);
    const rows = this.database
      .prepare<[], MoveCandidateRow>(
        `SELECT
          old_tracks.id AS old_track_id,
          old_tracks.path AS old_path,
          old_tracks.file_identity AS old_file_identity,
          old_tracks.file_identity_source AS old_file_identity_source,
          old_tracks.quick_hash AS old_quick_hash,
          old_tracks.quick_hash_version AS old_quick_hash_version,
          old_tracks.size_bytes AS old_size_bytes,
          old_tracks.duration AS old_duration,
          old_tracks.title AS old_title,
          old_tracks.artist AS old_artist,
          old_tracks.album AS old_album,
          new_tracks.id AS new_track_id,
          new_tracks.path AS new_path,
          new_tracks.file_identity AS new_file_identity,
          new_tracks.file_identity_source AS new_file_identity_source,
          new_tracks.quick_hash AS new_quick_hash,
          new_tracks.quick_hash_version AS new_quick_hash_version,
          new_tracks.size_bytes AS new_size_bytes,
          new_tracks.duration AS new_duration,
          new_tracks.title AS new_title,
          new_tracks.artist AS new_artist,
          new_tracks.album AS new_album
        FROM tracks AS old_tracks
        INNER JOIN tracks AS new_tracks
          ON old_tracks.missing = 1
          AND new_tracks.missing = 0
          AND old_tracks.id != new_tracks.id
          AND old_tracks.path != new_tracks.path
          AND (
            (
              old_tracks.file_identity IS NOT NULL
              AND new_tracks.file_identity IS NOT NULL
              AND old_tracks.file_identity = new_tracks.file_identity
            )
            OR (
              old_tracks.quick_hash IS NOT NULL
              AND new_tracks.quick_hash IS NOT NULL
              AND old_tracks.quick_hash = new_tracks.quick_hash
              AND old_tracks.quick_hash_version IS NOT NULL
              AND old_tracks.quick_hash_version = new_tracks.quick_hash_version
            )
          )
        ORDER BY old_tracks.updated_at DESC, new_tracks.updated_at DESC, old_tracks.id ASC, new_tracks.id ASC
        LIMIT ${candidateReadLimit}`,
      )
      .all();

    const drafts = rows.map((row) => this.createDraft(row)).filter((candidate): candidate is CandidateDraft => candidate !== null);
    const oldMatchCounts = new Map<string, number>();
    const newMatchCounts = new Map<string, number>();
    for (const candidate of drafts) {
      oldMatchCounts.set(candidate.oldTrackId, (oldMatchCounts.get(candidate.oldTrackId) ?? 0) + 1);
      newMatchCounts.set(candidate.newTrackId, (newMatchCounts.get(candidate.newTrackId) ?? 0) + 1);
    }

    return drafts
      .map((candidate) => {
        const ambiguous = (oldMatchCounts.get(candidate.oldTrackId) ?? 0) > 1 || (newMatchCounts.get(candidate.newTrackId) ?? 0) > 1;
        return {
          ...candidate,
          confidence: ambiguous && candidate.confidence === 'high' ? 'medium' : candidate.confidence,
          ambiguous,
          reasonCodes: ambiguous ? Array.from(new Set([...candidate.reasonCodes, 'ambiguous_match'])) : candidate.reasonCodes,
        };
      })
      .sort((left, right) => this.compareCandidates(left, right))
      .slice(0, limit);
  }

  private createDraft(row: MoveCandidateRow): CandidateDraft | null {
    const oldPath = textOrNull(row.old_path);
    const newPath = textOrNull(row.new_path);
    const oldTrackId = textOrNull(row.old_track_id);
    const newTrackId = textOrNull(row.new_track_id);
    if (!oldPath || !newPath || !oldTrackId || !newTrackId || oldPath === newPath) {
      return null;
    }

    const oldIdentity = textOrNull(row.old_file_identity);
    const newIdentity = textOrNull(row.new_file_identity);
    const oldIdentitySource = textOrNull(row.old_file_identity_source);
    const newIdentitySource = textOrNull(row.new_file_identity_source);
    const fileIdentityMatched = Boolean(oldIdentity && newIdentity && oldIdentity === newIdentity);
    const trustedFileIdentityMatched =
      fileIdentityMatched &&
      hasValidFileIdentitySource(oldIdentitySource) &&
      hasValidFileIdentitySource(newIdentitySource);
    const quickHashMatched =
      Boolean(row.old_quick_hash && row.new_quick_hash && row.old_quick_hash === row.new_quick_hash) &&
      row.old_quick_hash_version !== null &&
      row.old_quick_hash_version === row.new_quick_hash_version;
    if (!fileIdentityMatched && !quickHashMatched) {
      return null;
    }

    const sizeMatched = numbersMatch(row.old_size_bytes, row.new_size_bytes);
    const durationDelta = durationDeltaFor(row.old_duration, row.new_duration);
    const durationMatched = durationDelta !== null && durationDelta <= durationCloseSeconds;
    const metadata = this.compareMetadata(row);
    const reasonCodes = new Set<string>();

    if (fileIdentityMatched) {
      reasonCodes.add('file_identity_match');
      if (!trustedFileIdentityMatched) {
        reasonCodes.add('file_identity_untrusted_source');
      }
    }
    if (quickHashMatched) {
      reasonCodes.add('quick_hash_match');
    }
    if (sizeMatched) {
      reasonCodes.add('size_match');
    }
    if (durationMatched) {
      reasonCodes.add('duration_close');
    }
    if (metadata.full) {
      reasonCodes.add('metadata_match');
    } else if (metadata.partial) {
      reasonCodes.add('metadata_partial_match');
    } else {
      reasonCodes.add('metadata_incomplete');
    }

    const confidence = this.resolveConfidence({
      fileIdentityMatched: trustedFileIdentityMatched,
      quickHashMatched,
      sizeMatched,
      durationMatched,
      metadataMatched: metadata.full,
    });

    return {
      candidateId: stableCandidateId(oldTrackId, newTrackId, Array.from(reasonCodes).sort()),
      confidence,
      oldTrackId,
      oldPath,
      newTrackId,
      newPath,
      reasonCodes: Array.from(reasonCodes).sort(),
      fileIdentityMatched,
      quickHashMatched,
      sizeMatched,
      durationDelta,
      metadataMatched: metadata.full,
      createdAt: new Date().toISOString(),
    };
  }

  private compareMetadata(row: MoveCandidateRow): { full: boolean; partial: boolean } {
    const fields = [
      [row.old_title, row.new_title],
      [row.old_artist, row.new_artist],
      [row.old_album, row.new_album],
    ] as const;
    const comparisons = fields.map(([oldValue, newValue]) => {
      const oldText = normalizedMetadata(oldValue);
      const newText = normalizedMetadata(newValue);
      return {
        complete: Boolean(oldText && newText),
        matched: Boolean(oldText && newText && oldText === newText),
      };
    });
    const completeComparisons = comparisons.filter((item) => item.complete);
    const matchedCount = completeComparisons.filter((item) => item.matched).length;

    return {
      full: completeComparisons.length === comparisons.length && matchedCount === comparisons.length,
      partial: matchedCount > 0,
    };
  }

  private resolveConfidence(input: {
    fileIdentityMatched: boolean;
    quickHashMatched: boolean;
    sizeMatched: boolean;
    durationMatched: boolean;
    metadataMatched: boolean;
  }): LibraryMoveCandidateConfidence {
    if (input.fileIdentityMatched) {
      return 'high';
    }

    if (input.quickHashMatched && input.sizeMatched && input.durationMatched && input.metadataMatched) {
      return 'medium';
    }

    return 'low';
  }

  private compareCandidates(left: LibraryMoveCandidate, right: LibraryMoveCandidate): number {
    const confidenceRank: Record<LibraryMoveCandidateConfidence, number> = { high: 0, medium: 1, low: 2 };
    const confidenceDelta = confidenceRank[left.confidence] - confidenceRank[right.confidence];
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    if (left.ambiguous !== right.ambiguous) {
      return left.ambiguous ? 1 : -1;
    }

    return left.oldTrackId.localeCompare(right.oldTrackId) || left.newTrackId.localeCompare(right.newTrackId);
  }
}
