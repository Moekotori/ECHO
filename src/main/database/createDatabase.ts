import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations';
import { assertDatabaseOpenHealthy, DatabaseHealthError, rememberDatabaseHealthOk } from './health';
import { beginMainBackgroundTask } from '../diagnostics/PlaybackPerformanceDiagnostics';

export type EchoDatabase = Database.Database;
export type DatabaseCorruptionPolicy = 'throw' | 'quarantine-for-test-or-manual';

type CreateDatabaseOptions = {
  corruptionPolicy?: DatabaseCorruptionPolicy;
};

export const SQLITE_RUNTIME_PRAGMA_PROFILE = 'safe-performance-v1';

const SQLITE_RUNTIME_PRAGMAS = [
  'busy_timeout = 5000',
  'journal_mode = WAL',
  'synchronous = FULL',
  'cache_size = -32768',
  'temp_store = MEMORY',
  'mmap_size = 268435456',
] as const;

const applyRuntimePragmas = (database: EchoDatabase): void => {
  database.exec('PRAGMA foreign_keys = ON');

  for (const pragma of SQLITE_RUNTIME_PRAGMAS) {
    database.pragma(pragma);
  }
};

const quarantineTimestamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

const quarantinePathFor = (sourcePath: string, timestamp: string): string =>
  join(dirname(sourcePath), `${basename(sourcePath)}.corrupt-${timestamp}`);

const assertOpenedDatabaseHealthy = (database: EchoDatabase, databasePath: string): void => {
  const row = database.prepare<[], Record<string, unknown>>('PRAGMA quick_check(1)').get();
  const result = String(Object.values(row ?? {})[0] ?? '');

  if (result !== 'ok') {
    throw new Error(`Database quick_check failed after opening ${databasePath}: ${result || 'unknown error'}`);
  }
};

export const quarantineCorruptDatabase = (databasePath: string): string => {
  const timestamp = quarantineTimestamp();
  const quarantinedDatabasePath = quarantinePathFor(databasePath, timestamp);
  const candidates = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].filter((sourcePath) =>
    existsSync(sourcePath),
  );
  const renamed: Array<{ sourcePath: string; targetPath: string }> = [];

  try {
    for (const sourcePath of candidates) {
      const targetPath = quarantinePathFor(sourcePath, timestamp);
      renameSync(sourcePath, targetPath);
      renamed.push({ sourcePath, targetPath });
    }
  } catch (error) {
    for (const { sourcePath, targetPath } of [...renamed].reverse()) {
      try {
        if (existsSync(targetPath) && !existsSync(sourcePath)) {
          renameSync(targetPath, sourcePath);
        }
      } catch {
        // Leave the original failure intact; manual recovery can use the .corrupt copy.
      }
    }

    throw error;
  }

  return quarantinedDatabasePath;
};

export const createDatabase = (databasePath: string, options: CreateDatabaseOptions = {}): EchoDatabase => {
  const clearBackgroundTask = databasePath === ':memory:' ? null : beginMainBackgroundTask(`database:open:${basename(databasePath)}`);
  const corruptionPolicy = options.corruptionPolicy ?? 'throw';

  try {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
      try {
        assertDatabaseOpenHealthy(databasePath);
      } catch (error) {
        if (
          error instanceof DatabaseHealthError &&
          error.health.status === 'corrupt' &&
          corruptionPolicy === 'quarantine-for-test-or-manual'
        ) {
          const quarantinedPath = quarantineCorruptDatabase(databasePath);
          console.warn(
            `[database] Corrupt SQLite database was quarantined at ${quarantinedPath}; creating a clean database.`,
            error,
          );
        } else {
          throw error;
        }
      }
    }

    const database = new Database(databasePath);
    applyRuntimePragmas(database);
    try {
      const migrationResult = runMigrations(database);
      if (migrationResult.appliedCount > 0) {
        assertOpenedDatabaseHealthy(database, databasePath);
      }
      rememberDatabaseHealthOk(databasePath);
    } catch (error) {
      database.close();
      throw error;
    }

    return database;
  } finally {
    clearBackgroundTask?.();
  }
};
