import { describe, expect, it } from 'vitest';
import { createDatabase, resolveSqliteDurabilityMode, sqliteDurabilityModeFromSettings, sqliteRuntimePragmas } from './createDatabase';
import { migrations } from './migrations';

describe('createDatabase', () => {
  it('opens an in-memory database with durable sync by default, applies runtime pragmas, and runs migrations', () => {
    const database = createDatabase(':memory:');

    try {
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(database.pragma('synchronous', { simple: true })).toBe(2);
      expect(database.pragma('temp_store', { simple: true })).toBe(2);
      expect(database.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracks'").get()).toBeTruthy();
      expect(database.prepare('SELECT MAX(id) AS id FROM schema_migrations').get()).toMatchObject({ id: migrations.at(-1)?.id });
    } finally {
      database.close();
    }
  });

  it('requires an explicit opt-in before using balanced SQLite durability', () => {
    expect(resolveSqliteDurabilityMode()).toBe('durable');
    expect(sqliteRuntimePragmas()).toContain('synchronous = FULL');

    expect(sqliteDurabilityModeFromSettings(null)).toBe('durable');
    expect(sqliteDurabilityModeFromSettings({ sqliteBalancedDurabilityEnabled: false })).toBe('durable');
    expect(sqliteDurabilityModeFromSettings({ sqliteBalancedDurabilityEnabled: true })).toBe('balanced');
    expect(sqliteRuntimePragmas(sqliteDurabilityModeFromSettings({ sqliteBalancedDurabilityEnabled: true }))).toContain('synchronous = NORMAL');
  });

  it('can open a database with balanced sync when explicitly requested', () => {
    const database = createDatabase(':memory:', { durabilityMode: 'balanced' });

    try {
      expect(database.pragma('synchronous', { simple: true })).toBe(1);
    } finally {
      database.close();
    }
  });
});
