import type { EchoDatabase } from '../database/createDatabase';
import {
  automixAnalysisVersion,
  type AutomixAnalysisV2,
} from '../../shared/types/automix';

type AutomixAnalysisRow = {
  analysis_json: string;
};

export class AutomixAnalysisStore {
  constructor(private readonly database: EchoDatabase) {}

  get(trackId: string, fingerprint: string): AutomixAnalysisV2 | null {
    const row = this.database.prepare<[string, string, number], AutomixAnalysisRow>(`
      SELECT analysis_json
      FROM audio_transition_analysis
      WHERE track_id = ? AND fingerprint = ? AND analyzer_version = ?
    `).get(trackId, fingerprint, automixAnalysisVersion);
    if (!row) {
      return null;
    }

    try {
      const parsed = JSON.parse(row.analysis_json) as AutomixAnalysisV2;
      return parsed.version === automixAnalysisVersion && parsed.fingerprint === fingerprint
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  put(trackId: string, analysis: AutomixAnalysisV2): void {
    const updatedAt = analysis.analyzedAt ?? new Date().toISOString();
    this.database.prepare(`
      INSERT INTO audio_transition_analysis (
        track_id, fingerprint, analyzer_version, status, analysis_json, error, analyzed_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM tracks WHERE id = ?)
      ON CONFLICT(track_id, fingerprint, analyzer_version) DO UPDATE SET
        status = excluded.status,
        analysis_json = excluded.analysis_json,
        error = excluded.error,
        analyzed_at = excluded.analyzed_at,
        updated_at = excluded.updated_at
    `).run(
      trackId,
      analysis.fingerprint,
      analysis.version,
      analysis.status,
      JSON.stringify(analysis),
      analysis.error,
      analysis.analyzedAt,
      updatedAt,
      trackId,
    );
  }

  deleteStale(trackId: string, fingerprint: string): void {
    this.database.prepare(`
      DELETE FROM audio_transition_analysis
      WHERE track_id = ? AND (fingerprint <> ? OR analyzer_version <> ?)
    `).run(trackId, fingerprint, automixAnalysisVersion);
  }
}
