import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from './createDatabase';
import {
  checkDatabaseHealth,
  checkDatabaseHealthCached,
  checkDatabaseOpenHealth,
  clearDatabaseHealthCacheForTests,
  isSqliteCorruptionMessage,
  rememberDatabaseHealthOk,
} from './health';

describe('database health', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'echo-db-health-'));
    clearDatabaseHealthCacheForTests();
  });

  afterEach(() => {
    clearDatabaseHealthCacheForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it('passes quick_check for a healthy SQLite database before migrations', () => {
    const databasePath = join(root, 'library.sqlite');
    const database = new Database(databasePath);
    database.exec('CREATE TABLE sample (id TEXT PRIMARY KEY)');
    database.close();

    expect(checkDatabaseHealth(databasePath).status).toBe('ok');
    const opened = createDatabase(databasePath);
    expect(opened.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracks'").get()).toBeTruthy();
    opened.close();
  });

  it('throws on a malformed database by default without replacing user data', () => {
    const databasePath = join(root, 'library.sqlite');
    writeFileSync(databasePath, 'not sqlite', 'utf8');
    writeFileSync(`${databasePath}-wal`, 'stale wal', 'utf8');
    writeFileSync(`${databasePath}-shm`, 'stale shm', 'utf8');

    expect(checkDatabaseHealth(databasePath).status).toBe('corrupt');
    expect(() => createDatabase(databasePath)).toThrow(/not a database|malformed|corrupt/i);
    expect(readdirSync(root)).toEqual(expect.arrayContaining(['library.sqlite', 'library.sqlite-wal', 'library.sqlite-shm']));
  });

  it('quarantines a malformed database only when explicitly requested', () => {
    const databasePath = join(root, 'library.sqlite');
    writeFileSync(databasePath, 'not sqlite', 'utf8');
    writeFileSync(`${databasePath}-wal`, 'stale wal', 'utf8');
    writeFileSync(`${databasePath}-shm`, 'stale shm', 'utf8');

    const opened = createDatabase(databasePath, { corruptionPolicy: 'quarantine-for-test-or-manual' });

    expect(opened.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracks'").get()).toBeTruthy();
    opened.close();
    expect(checkDatabaseHealth(databasePath).status).toBe('ok');
    expect(readdirSync(root).some((entry) => entry.startsWith('library.sqlite.corrupt-'))).toBe(true);
    expect(readdirSync(root).some((entry) => entry.startsWith('library.sqlite-wal.corrupt-'))).toBe(true);
    expect(readdirSync(root).some((entry) => entry.startsWith('library.sqlite-shm.corrupt-'))).toBe(true);
  });

  it('treats malformed database schema errors as corruption', () => {
    expect(isSqliteCorruptionMessage('malformed database schema (6301a741-3d56-407f-a3d6-77e5a19a8416)')).toBe(true);
  });

  it('uses a lightweight open check for readable SQLite files', () => {
    const databasePath = join(root, 'library.sqlite');
    const database = new Database(databasePath);
    database.exec('CREATE TABLE sample (id TEXT PRIMARY KEY)');
    database.close();

    expect(checkDatabaseOpenHealth(databasePath)).toMatchObject({
      status: 'ok',
      message: 'database passed lightweight open check',
    });
  });

  it('reports malformed files from the lightweight open check', () => {
    const databasePath = join(root, 'library.sqlite');
    writeFileSync(databasePath, 'not sqlite', 'utf8');

    expect(checkDatabaseOpenHealth(databasePath).status).toBe('corrupt');
  });

  it('reuses a healthy quick check when the database triplet signature is unchanged', () => {
    const databasePath = join(root, 'library.sqlite');
    const database = new Database(databasePath);
    database.exec('CREATE TABLE sample (id TEXT PRIMARY KEY)');
    database.close();

    expect(checkDatabaseHealthCached(databasePath).message).toBeUndefined();
    expect(checkDatabaseHealthCached(databasePath)).toMatchObject({
      status: 'ok',
      message: 'reused cached healthy database check',
    });
  });

  it('remembers the post-open database signature when WAL side files appear', () => {
    const databasePath = join(root, 'library.sqlite');
    const database = new Database(databasePath);
    database.exec('CREATE TABLE sample (id TEXT PRIMARY KEY)');
    database.close();

    expect(checkDatabaseHealthCached(databasePath).message).toBeUndefined();
    writeFileSync(`${databasePath}-wal`, 'created after open', 'utf8');
    writeFileSync(`${databasePath}-shm`, 'created after open', 'utf8');
    rememberDatabaseHealthOk(databasePath);

    expect(checkDatabaseHealthCached(databasePath)).toMatchObject({
      status: 'ok',
      message: 'database health verified in active connection',
    });
  });

  it('reuses recent active health when WAL side files change', () => {
    const databasePath = join(root, 'library.sqlite');
    const database = new Database(databasePath);
    database.exec('CREATE TABLE sample (id TEXT PRIMARY KEY)');
    database.close();

    rememberDatabaseHealthOk(databasePath);
    writeFileSync(`${databasePath}-wal`, 'wal changed during active runtime', 'utf8');
    writeFileSync(`${databasePath}-shm`, 'shm changed during active runtime', 'utf8');

    expect(checkDatabaseHealthCached(databasePath)).toMatchObject({
      status: 'ok',
      message: 'database health verified in active connection',
    });
  });

  it('does not reuse recent active health when the primary database file changes', () => {
    const databasePath = join(root, 'library.sqlite');
    const database = new Database(databasePath);
    database.exec('CREATE TABLE sample (id TEXT PRIMARY KEY)');
    database.close();

    rememberDatabaseHealthOk(databasePath);
    writeFileSync(databasePath, 'not sqlite', 'utf8');

    expect(checkDatabaseHealthCached(databasePath).status).toBe('corrupt');
  });
});
