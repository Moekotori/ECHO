import type { LibraryFolderInsight } from '../../shared/types/library';
import { normalizedTrackCodecSql } from './trackFileFormatFilter';

export const folderInsightFilterSql = (insight: LibraryFolderInsight | undefined, table = 'tracks'): string => {
  switch (insight) {
    case 'recentlyAdded':
      return `${table}.created_at >= COALESCE((
        SELECT scan_jobs.started_at
        FROM scan_jobs
        WHERE scan_jobs.folder_id = ${table}.folder_id
          AND scan_jobs.status = 'completed'
          AND scan_jobs.started_at IS NOT NULL
        ORDER BY COALESCE(scan_jobs.finished_at, scan_jobs.updated_at, scan_jobs.created_at) DESC
        LIMIT 1
      ), '9999-12-31T23:59:59.999Z')`;
    case 'unplayed':
      return `COALESCE(${table}.play_count, 0) = 0`;
    case 'lossless':
      return `${normalizedTrackCodecSql(`${table}.codec`)} IN ('FLAC', 'ALAC', 'WAV', 'AIFF', 'APE', 'DSF', 'DFF')`;
    case 'hiRes':
      return `((COALESCE(${table}.bit_depth, 0) >= 24 AND COALESCE(${table}.sample_rate, 0) >= 88200) OR ${normalizedTrackCodecSql(`${table}.codec`)} IN ('DSF', 'DFF', 'DSD'))`;
    case 'missingCover':
      return `NOT EXISTS (
        SELECT 1 FROM covers
        WHERE covers.id = ${table}.cover_id
          AND covers.source_type != 'default'
      )`;
    case 'missingLyrics':
      return `NOT EXISTS (
        SELECT 1 FROM lyrics_cache
        WHERE lyrics_cache.track_id = ${table}.id
          AND lyrics_cache.kind IN ('plain', 'synced', 'instrumental')
      )`;
    case 'duplicates':
      return `EXISTS (
        SELECT 1
        FROM duplicate_track_members
        INNER JOIN duplicate_track_groups ON duplicate_track_groups.id = duplicate_track_members.group_id
        WHERE duplicate_track_members.track_id = ${table}.id
          AND duplicate_track_groups.mode = 'strict'
      )`;
    default:
      return '';
  }
};

export const hiddenDuplicateTrackSql = (enabled: boolean, table = 'tracks'): string => enabled
  ? `${table}.id NOT IN (
      SELECT members.track_id FROM duplicate_track_members AS members
      INNER JOIN duplicate_track_groups AS groups ON groups.id = members.group_id
      WHERE groups.mode = 'strict' AND members.hidden != 0
    )`
  : '';
