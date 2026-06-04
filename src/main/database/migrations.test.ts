import { describe, expect, it } from 'vitest';
import type { EchoDatabase } from './createDatabase';
import { migrations, runMigrations } from './migrations';
import { librarySchemaSql } from './schema';

class FakeStatement<T = { id: number }> {
  constructor(private readonly allResult: T[] = [], private readonly onRun: (...args: unknown[]) => void = () => undefined) {}

  all(): T[] {
    return this.allResult;
  }

  run(...args: unknown[]): void {
    this.onRun(...args);
  }
}

class FakeDatabase {
  readonly executedSql: string[] = [];
  readonly insertedMigrationIds: number[] = [];

  constructor(
    private readonly appliedMigrationIds: number[],
    private readonly tableColumns: Record<string, string[]> = {},
  ) {}

  exec(sql: string): void {
    this.executedSql.push(sql);
  }

  prepare(sql: string) {
    const tableInfoMatch = sql.match(/PRAGMA table_info\(([^)]+)\)/i);
    if (tableInfoMatch) {
      const tableName = tableInfoMatch[1];
      return new FakeStatement((this.tableColumns[tableName] ?? []).map((name) => ({ name })));
    }

    if (sql.includes('SELECT id FROM schema_migrations')) {
      return new FakeStatement(this.appliedMigrationIds.map((id) => ({ id })));
    }

    if (sql.includes('INSERT INTO schema_migrations')) {
      return new FakeStatement([], (id) => {
        this.insertedMigrationIds.push(Number(id));
      });
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

describe('database migrations', () => {
  it('includes scan directory snapshots and artist online caches in the base schema for new databases', () => {
    expect(librarySchemaSql).toContain('CREATE TABLE IF NOT EXISTS scan_directory_snapshots');
    expect(librarySchemaSql).toContain('PRIMARY KEY (folder_id, path)');
    expect(librarySchemaSql).toContain('CREATE TABLE IF NOT EXISTS artist_online_info_cache');
    expect(librarySchemaSql).toContain('CREATE TABLE IF NOT EXISTS artist_event_cache');
    expect(librarySchemaSql).toContain('CREATE TABLE IF NOT EXISTS library_inbox_item_states');
    expect(librarySchemaSql).toContain('CREATE TABLE IF NOT EXISTS lyrics_backfill_jobs');
  });

  it('adds scan directory snapshots to existing databases without touching library rows', () => {
    const database = new FakeDatabase(Array.from({ length: 35 }, (_, index) => index + 1));

    runMigrations(database as unknown as EchoDatabase);

    const migrationSql = database.executedSql.join('\n');
    expect(database.insertedMigrationIds).toEqual([36, 37, 38, 39, 40, 41]);
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS scan_directory_snapshots');
    expect(migrationSql).not.toMatch(/\b(?:DELETE|UPDATE)\s+(?:FROM\s+)?(?:folders|tracks|scan_jobs)\b/iu);
  });

  it('adds artist online caches to existing databases without touching library rows', () => {
    const database = new FakeDatabase(Array.from({ length: 36 }, (_, index) => index + 1));

    runMigrations(database as unknown as EchoDatabase);

    const migrationSql = database.executedSql.join('\n');
    expect(database.insertedMigrationIds).toEqual([37, 38, 39, 40, 41]);
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS artist_online_info_cache');
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS artist_event_cache');
    expect(migrationSql).not.toMatch(/\b(?:DELETE|UPDATE)\s+(?:FROM\s+)?(?:folders|tracks|artists|artist_tracks|artist_albums)\b/iu);
  });

  it('adds inbox item states to existing databases without touching library rows', () => {
    const database = new FakeDatabase(Array.from({ length: 37 }, (_, index) => index + 1));

    runMigrations(database as unknown as EchoDatabase);

    const migrationSql = database.executedSql.join('\n');
    expect(database.insertedMigrationIds).toEqual([38, 39, 40, 41]);
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS library_inbox_item_states');
    expect(migrationSql).not.toMatch(/\b(?:DELETE|UPDATE)\s+(?:FROM\s+)?(?:folders|tracks|library_inbox_items|library_inbox_batches)\b/iu);
  });

  it('adds region columns to existing artist online caches without touching library rows', () => {
    const database = new FakeDatabase(Array.from({ length: 38 }, (_, index) => index + 1), {
      artist_online_info_cache: ['cache_key', 'artist_id', 'normalized_name', 'locale'],
      artist_event_cache: ['cache_key', 'artist_id', 'normalized_name', 'source'],
    });

    runMigrations(database as unknown as EchoDatabase);

    const migrationSql = database.executedSql.join('\n');
    expect(database.insertedMigrationIds).toEqual([39, 40, 41]);
    expect(migrationSql).toContain('ALTER TABLE artist_online_info_cache ADD COLUMN region TEXT');
    expect(migrationSql).toContain('ALTER TABLE artist_event_cache ADD COLUMN region TEXT');
    expect(migrationSql).not.toMatch(/\b(?:DELETE|UPDATE)\s+(?:FROM\s+)?(?:folders|tracks|artists|artist_tracks|artist_albums)\b/iu);
  });

  it('keeps lyrics backfill persistence as the latest additive step', () => {
    expect(migrations.at(-1)).toMatchObject({ id: 41 });
  });
});
