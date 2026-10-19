import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryCountCache } from './LibraryCountCache';

const databases: Database.Database[] = [];
const directories: string[] = [];
const open = (path = ':memory:', readonly = false): Database.Database => {
  const database = new Database(path, { readonly });
  databases.push(database);
  return database;
};
const countSql = 'SELECT COUNT(*) AS total FROM items WHERE value = ?';
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).reverse().forEach((database) => database.close());
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

describe('LibraryCountCache', () => {
  it('reuses counts including zero, separates filters and invalidates local writes', () => {
    const database = open();
    database.exec('CREATE TABLE items(value TEXT); INSERT INTO items VALUES (\'a\')');
    const cache = new LibraryCountCache(database);
    const prepare = vi.spyOn(database, 'prepare');
    expect(cache.read(countSql, ['a'])).toBe(1);
    expect(cache.read(countSql, ['a'])).toBe(1);
    expect(cache.read(countSql, ['b'])).toBe(0);
    expect(cache.read(countSql, ['b'])).toBe(0);
    expect(prepare).toHaveBeenCalledTimes(2);
    database.exec("INSERT INTO items VALUES ('b')");
    expect(cache.read(countSql, ['b'])).toBe(1);
  });

  it('invalidates a read-only connection after writes from another connection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'echo-count-cache-'));
    directories.push(directory);
    const path = join(directory, 'library.sqlite');
    const writer = open(path);
    writer.pragma('journal_mode = WAL');
    writer.exec("CREATE TABLE items(value TEXT); INSERT INTO items VALUES ('a')");
    const reader = open(path, true);
    const cache = new LibraryCountCache(reader);
    const read = reader.transaction(() => cache.read(countSql, ['a']));
    expect(read()).toBe(1);
    writer.exec("INSERT INTO items VALUES ('a')");
    expect(read()).toBe(2);
    writer.exec("DELETE FROM items WHERE value = 'a'");
    expect(read()).toBe(0);
  });

  it('does not retain uncommitted counts after rollback', () => {
    const database = open();
    database.exec("CREATE TABLE items(value TEXT); INSERT INTO items VALUES ('a')");
    const cache = new LibraryCountCache(database);
    expect(cache.read(countSql, ['a'])).toBe(1);
    expect(() => database.transaction(() => {
      database.exec("INSERT INTO items VALUES ('a')");
      expect(cache.read(countSql, ['a'])).toBe(2);
      throw new Error('rollback');
    })()).toThrow('rollback');
    expect(cache.read(countSql, ['a'])).toBe(1);
  });

  it('bounds retained counts and separates settings that affect SQL functions', () => {
    const database = open();
    database.exec("CREATE TABLE items(value TEXT); INSERT INTO items VALUES ('a')");
    const cache = new LibraryCountCache(database);
    const prepare = vi.spyOn(database, 'prepare');
    cache.read(countSql, ['a'], 'standard');
    cache.read(countSql, ['a'], 'loose');
    expect(prepare).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 33; index++) cache.read(countSql, [String(index)]);
    prepare.mockClear();
    cache.read(countSql, ['a'], 'standard');
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
