import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createLibraryFilterIndexes } from './libraryFilterIndexes';

describe('library filter indexes', () => {
  it('uses selective indexes for local and remote filters and can be applied twice', () => {
    const database = new Database(':memory:');
    try {
      database.exec(`
        CREATE TABLE tracks(year INTEGER, genre TEXT, sample_rate INTEGER, missing INTEGER);
        CREATE TABLE remote_tracks(year INTEGER, genre TEXT, sample_rate INTEGER, availability TEXT);
      `);
      createLibraryFilterIndexes(database);
      createLibraryFilterIndexes(database);
      for (const [table, active] of [['tracks', 'missing = 0'], ['remote_tracks', "availability != 'missing'"]] as const) {
        for (const [field, condition] of [['year', 'year = 2026'], ['genre', "genre = 'rock' COLLATE NOCASE"], ['sample_rate', 'sample_rate = 96000']]) {
          const plan = database.prepare<[], { detail: string }>(
            `EXPLAIN QUERY PLAN SELECT COUNT(*) FROM ${table} WHERE ${active} AND ${condition}`,
          ).all();
          expect(plan.some(({ detail }) => detail.includes(`idx_${table}_filter_${field}`) && detail.includes('SEARCH'))).toBe(true);
        }
      }
    } finally { database.close(); }
  });
});
