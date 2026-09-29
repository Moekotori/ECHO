import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

export type DatabaseHealthStatus = 'ok' | 'corrupt' | 'unreadable';

export type DatabaseHealthResult = {
  status: DatabaseHealthStatus;
  databasePath: string;
  checkedAt: string;
  message?: string;
  detail?: string;
};

export class DatabaseHealthError extends Error {
  constructor(readonly health: DatabaseHealthResult) {
    super(health.message ?? `Database health check failed: ${health.status}`);
    this.name = 'DatabaseHealthError';
  }
}

const SQLITE_CORRUPTION_PATTERN =
  /database disk image is malformed|database disk image malformed|malformed database schema|SQLITE_CORRUPT|file is not a database/i;

const nowIso = (): string => new Date().toISOString();
const databaseHealthCache = new Map<string, DatabaseHealthResult>();
const recentActiveHealthTtlMs = 30 * 60 * 1000;
const recentActiveHealthCache = new Map<string, {
  health: DatabaseHealthResult;
  primarySignature: string;
  rememberedAtMs: number;
}>();

export const isSqliteCorruptionMessage = (message: string): boolean => SQLITE_CORRUPTION_PATTERN.test(message);

const ok = (databasePath: string, message?: string): DatabaseHealthResult => ({
  status: 'ok',
  databasePath,
  checkedAt: nowIso(),
  ...(message ? { message } : {}),
});

const fileSignature = (filePath: string): string => {
  try {
    const stat = statSync(filePath);
    return `${filePath}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : 'missing';
    return `${filePath}:missing:${code}`;
  }
};

const databaseTripletSignature = (databasePath: string): string => {
  const normalizedPath = resolve(databasePath);
  return [normalizedPath, `${normalizedPath}-wal`, `${normalizedPath}-shm`].map(fileSignature).join('|');
};

const databasePrimarySignature = (databasePath: string): string => fileSignature(resolve(databasePath));

const databaseHealthCacheKey = (databasePath: string, mode: 'quick' | 'integrity'): string =>
  `${mode}:${databaseTripletSignature(databasePath)}`;

const recentActiveHealthCacheKey = (databasePath: string): string => resolve(databasePath);

const failed = (databasePath: string, error: unknown): DatabaseHealthResult => {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: isSqliteCorruptionMessage(message) ? 'corrupt' : 'unreadable',
    databasePath,
    checkedAt: nowIso(),
    message,
  };
};

const readPragmaDetail = (database: Database.Database, pragma: 'quick_check' | 'integrity_check'): string => {
  const rows = database.prepare<[], { [key: string]: string }>(`PRAGMA ${pragma}`).all();
  return rows.map((row) => String(Object.values(row)[0] ?? '')).filter(Boolean).join('\n');
};

export const isDatabaseHealthy = (health: DatabaseHealthResult): boolean => health.status === 'ok';

export const checkDatabaseOpenHealth = (databasePath: string): DatabaseHealthResult => {
  if (databasePath === ':memory:') {
    return ok(databasePath, 'in-memory database');
  }

  if (!existsSync(databasePath)) {
    return ok(databasePath, 'database does not exist yet');
  }

  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    database.pragma('schema_version');
    database.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
    return ok(databasePath, 'database passed lightweight open check');
  } catch (error) {
    return failed(databasePath, error);
  } finally {
    try {
      database?.close();
    } catch {
      // Ignore close failures while reporting the lightweight open result.
    }
  }
};

export const checkDatabaseHealth = (
  databasePath: string,
  mode: 'quick' | 'integrity' = 'quick',
): DatabaseHealthResult => {
  if (databasePath === ':memory:') {
    return ok(databasePath, 'in-memory database');
  }

  if (!existsSync(databasePath)) {
    return ok(databasePath, 'database does not exist yet');
  }

  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    const pragma = mode === 'integrity' ? 'integrity_check' : 'quick_check';
    const detail = readPragmaDetail(database, pragma);

    if (detail === 'ok') {
      return ok(databasePath);
    }

    if (mode === 'quick') {
      const integrityDetail = readPragmaDetail(database, 'integrity_check');
      if (integrityDetail === 'ok') {
        return ok(databasePath, 'quick_check was not confirmed by integrity_check');
      }

      return {
        status: 'corrupt',
        databasePath,
        checkedAt: nowIso(),
        message: 'quick_check failed; integrity_check confirmed corruption',
        detail: integrityDetail || detail,
      };
    }

    return {
      status: 'corrupt',
      databasePath,
      checkedAt: nowIso(),
      message: `${pragma} failed`,
      detail,
    };
  } catch (error) {
    return failed(databasePath, error);
  } finally {
    try {
      database?.close();
    } catch {
      // Ignore close failures while reporting the original health result.
    }
  }
};

export const checkDatabaseHealthCached = (
  databasePath: string,
  mode: 'quick' | 'integrity' = 'quick',
): DatabaseHealthResult => {
  if (databasePath === ':memory:' || mode === 'integrity') {
    return checkDatabaseHealth(databasePath, mode);
  }

  const recentCacheKey = recentActiveHealthCacheKey(databasePath);
  const recentActiveHealth = recentActiveHealthCache.get(recentCacheKey);
  if (recentActiveHealth && isDatabaseHealthy(recentActiveHealth.health)) {
    const ageMs = Date.now() - recentActiveHealth.rememberedAtMs;
    if (ageMs <= recentActiveHealthTtlMs && recentActiveHealth.primarySignature === databasePrimarySignature(databasePath)) {
      return {
        ...recentActiveHealth.health,
        checkedAt: nowIso(),
        message: recentActiveHealth.health.message ?? 'reused recent active database health check',
      };
    }

    recentActiveHealthCache.delete(recentCacheKey);
  }

  const cacheKey = databaseHealthCacheKey(databasePath, mode);
  const cached = databaseHealthCache.get(cacheKey);
  if (cached && isDatabaseHealthy(cached)) {
    return {
      ...cached,
      checkedAt: nowIso(),
      message: cached.message ?? 'reused cached healthy database check',
    };
  }

  const health = checkDatabaseHealth(databasePath, mode);
  if (isDatabaseHealthy(health)) {
    databaseHealthCache.set(cacheKey, health);
  }
  return health;
};

export const rememberDatabaseHealthOk = (
  databasePath: string,
  mode: 'quick' | 'integrity' = 'quick',
): DatabaseHealthResult => {
  const health = ok(databasePath, 'database health verified in active connection');
  if (databasePath !== ':memory:' && mode === 'quick') {
    databaseHealthCache.set(databaseHealthCacheKey(databasePath, mode), health);
    recentActiveHealthCache.set(recentActiveHealthCacheKey(databasePath), {
      health,
      primarySignature: databasePrimarySignature(databasePath),
      rememberedAtMs: Date.now(),
    });
  }
  return health;
};

export const clearDatabaseHealthCacheForTests = (): void => {
  databaseHealthCache.clear();
  recentActiveHealthCache.clear();
};

export const assertDatabaseHealthy = (databasePath: string, options: { cache?: boolean } = {}): void => {
  const health =
    options.cache === true ? checkDatabaseHealthCached(databasePath, 'quick') : checkDatabaseHealth(databasePath, 'quick');
  if (!isDatabaseHealthy(health)) {
    throw new DatabaseHealthError(health);
  }
};

export const assertDatabaseOpenHealthy = (databasePath: string): void => {
  const health = checkDatabaseOpenHealth(databasePath);
  if (!isDatabaseHealthy(health)) {
    throw new DatabaseHealthError(health);
  }
};

export const checkpointWal = (databasePath: string): DatabaseHealthResult => {
  if (databasePath === ':memory:' || !existsSync(databasePath)) {
    return ok(databasePath, 'database does not exist yet');
  }

  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, { fileMustExist: true });
    database.pragma('wal_checkpoint(TRUNCATE)');
    return ok(databasePath);
  } catch (error) {
    return failed(databasePath, error);
  } finally {
    try {
      database?.close();
    } catch {
      // Ignore close failures while reporting the checkpoint result.
    }
  }
};
