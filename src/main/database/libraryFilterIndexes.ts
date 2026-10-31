import type { EchoDatabase } from './createDatabase';

/** Partial indexes keep missing media out of the interactive filter lookup. */
export const createLibraryFilterIndexes = (database: EchoDatabase): void => {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tracks_filter_year ON tracks(year) WHERE missing = 0;
    CREATE INDEX IF NOT EXISTS idx_tracks_filter_genre ON tracks(genre COLLATE NOCASE) WHERE missing = 0;
    CREATE INDEX IF NOT EXISTS idx_tracks_filter_sample_rate ON tracks(sample_rate) WHERE missing = 0;
    CREATE INDEX IF NOT EXISTS idx_remote_tracks_filter_year ON remote_tracks(year) WHERE availability != 'missing';
    CREATE INDEX IF NOT EXISTS idx_remote_tracks_filter_genre ON remote_tracks(genre COLLATE NOCASE) WHERE availability != 'missing';
    CREATE INDEX IF NOT EXISTS idx_remote_tracks_filter_sample_rate ON remote_tracks(sample_rate) WHERE availability != 'missing';
  `);
};
