import type { EchoDatabase } from '../database/createDatabase';
import type { LibraryMoveCandidateService } from './LibraryMoveCandidateService';
import type { LibraryMoveCandidate, LibraryMoveRepairResult } from './libraryTypes';

type TrackStateRow = {
  id: string;
  path: string;
  missing: number;
};

type CountRow = {
  total: number;
};

const emptyResult = (candidateId: string, blockers: string[]): LibraryMoveRepairResult => ({
  candidateId,
  ok: false,
  blockers,
  warnings: [],
  oldTrackId: null,
  newTrackId: null,
  playlistItemsToRelink: 0,
  playbackHistoryEntriesToRelink: 0,
  playbackHistoryStatsToRelink: 0,
  deletedOldTrackRow: false,
  appliedAt: null,
});

export class LibraryMoveRepairService {
  constructor(
    private readonly database: EchoDatabase,
    private readonly moveCandidateService: LibraryMoveCandidateService,
  ) {}

  dryRun(candidateId: string): LibraryMoveRepairResult {
    const candidate = this.findCandidate(candidateId);
    if (!candidate) {
      return emptyResult(candidateId, ['candidate_not_found']);
    }

    const blockers = this.getCandidateBlockers(candidate);
    const counts = this.getRelinkCounts(candidate);

    return {
      candidateId,
      ok: blockers.length === 0,
      blockers,
      warnings: [],
      oldTrackId: candidate.oldTrackId,
      newTrackId: candidate.newTrackId,
      playlistItemsToRelink: counts.playlistItems,
      playbackHistoryEntriesToRelink: counts.playbackHistoryEntries,
      playbackHistoryStatsToRelink: counts.playbackHistoryStats,
      deletedOldTrackRow: false,
      appliedAt: null,
    };
  }

  apply(candidateId: string): LibraryMoveRepairResult {
    const dryRun = this.dryRun(candidateId);
    if (!dryRun.ok || !dryRun.oldTrackId || !dryRun.newTrackId) {
      return dryRun;
    }

    const appliedAt = new Date().toISOString();
    const candidate = this.findCandidate(candidateId);
    if (!candidate) {
      return emptyResult(candidateId, ['candidate_not_found']);
    }

    const result = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE playlist_items
           SET media_id = ?, source_item_id = CASE WHEN source_item_id = ? THEN ? ELSE source_item_id END, unavailable = 0
           WHERE media_type = 'track' AND media_id = ?`,
        )
        .run(candidate.newTrackId, candidate.oldTrackId, candidate.newTrackId, candidate.oldTrackId);

      this.database
        .prepare('UPDATE playback_history SET track_id = ?, track_path = ? WHERE track_id = ?')
        .run(candidate.newTrackId, candidate.newPath, candidate.oldTrackId);

      this.database
        .prepare('UPDATE playback_history_stats SET track_id = ?, track_path = ?, updated_at = ? WHERE track_id = ?')
        .run(candidate.newTrackId, candidate.newPath, appliedAt, candidate.oldTrackId);

      const deleted = this.database.prepare('DELETE FROM tracks WHERE id = ? AND missing = 1').run(candidate.oldTrackId).changes > 0;

      return {
        ...dryRun,
        deletedOldTrackRow: deleted,
        appliedAt,
      };
    })();

    return result;
  }

  private findCandidate(candidateId: string): LibraryMoveCandidate | null {
    return this.moveCandidateService.getMoveCandidates({ limit: 100 }).find((candidate) => candidate.candidateId === candidateId) ?? null;
  }

  private getCandidateBlockers(candidate: LibraryMoveCandidate): string[] {
    const blockers: string[] = [];

    if (candidate.ambiguous) {
      blockers.push('ambiguous_candidate');
    }

    if (candidate.confidence === 'low') {
      blockers.push('low_confidence');
    }

    if (candidate.oldPath === candidate.newPath) {
      blockers.push('same_path');
    }

    const oldTrack = this.getTrackState(candidate.oldTrackId);
    const newTrack = this.getTrackState(candidate.newTrackId);
    if (!oldTrack || oldTrack.missing !== 1) {
      blockers.push('old_track_not_missing');
    }
    if (!newTrack || newTrack.missing !== 0) {
      blockers.push('new_track_not_active');
    }

    return blockers;
  }

  private getRelinkCounts(candidate: LibraryMoveCandidate): {
    playlistItems: number;
    playbackHistoryEntries: number;
    playbackHistoryStats: number;
  } {
    return {
      playlistItems: this.count("SELECT COUNT(*) AS total FROM playlist_items WHERE media_type = 'track' AND media_id = ?", candidate.oldTrackId),
      playbackHistoryEntries: this.count('SELECT COUNT(*) AS total FROM playback_history WHERE track_id = ?', candidate.oldTrackId),
      playbackHistoryStats: this.count('SELECT COUNT(*) AS total FROM playback_history_stats WHERE track_id = ?', candidate.oldTrackId),
    };
  }

  private getTrackState(trackId: string): TrackStateRow | null {
    return this.database.prepare<[string], TrackStateRow>('SELECT id, path, missing FROM tracks WHERE id = ?').get(trackId) ?? null;
  }

  private count(sql: string, value: string): number {
    return Number(this.database.prepare<[string], CountRow>(sql).get(value)?.total ?? 0);
  }
}
