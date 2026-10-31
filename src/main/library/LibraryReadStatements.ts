import type { Statement } from 'better-sqlite3';
import type { EchoDatabase } from '../database/createDatabase';

type ReadStatement = Statement<unknown[], Record<string, unknown>>;
const maxEntries = 32;
const maxSqlLength = 64 * 1024;
const caches = new WeakMap<EchoDatabase, Map<string, ReadStatement>>();

/** Reuse compiled SQL across keystrokes/pages, never query results or row buffers. */
export const libraryReadStatement = (database: EchoDatabase, sql: string): ReadStatement => {
  let cache = caches.get(database);
  if (!cache) {
    cache = new Map();
    caches.set(database, cache);
  }
  const existing = cache.get(sql);
  if (existing) {
    cache.delete(sql);
    cache.set(sql, existing);
    return existing;
  }
  const statement = database.prepare<unknown[], Record<string, unknown>>(sql);
  // Some callers use RETURNING. Keep writes and unusually large SQL out of this cache.
  if (statement.readonly && sql.length <= maxSqlLength) {
    cache.set(sql, statement);
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
  }
  return statement;
};
