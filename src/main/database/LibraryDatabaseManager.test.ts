import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLibraryDatabaseManager } from './LibraryDatabaseManager';
import { createDatabase } from './createDatabase';

const createHealthyLibrary = (databasePath: string): void => {
  createDatabase(databasePath).close();
};

describe('LibraryDatabaseManager', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'echo-library-db-manager-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('throws on a corrupt user database without replacing the original file', () => {
    const databasePath = join(root, 'echo-library.sqlite');
    writeFileSync(databasePath, 'not sqlite', 'utf8');
    const manager = createLibraryDatabaseManager(databasePath, { assertLibraryAvailable: () => undefined });

    expect(() => manager.openServiceConnection('library')).toThrow(/not a database|malformed|corrupt/i);
    expect(existsSync(databasePath)).toBe(true);
  });

  it('refuses to open while protected without creating a new database', () => {
    const databasePath = join(root, 'echo-library.sqlite');
    const manager = createLibraryDatabaseManager(databasePath, {
      assertLibraryAvailable: () => {
        throw new Error('protected');
      },
    });

    expect(() => manager.openServiceConnection('lyrics')).toThrow(/protected/);
    expect(existsSync(databasePath)).toBe(false);
    expect(manager.getState().openConnections).toBe(0);
  });

  it('closes registered users idempotently', () => {
    const databasePath = join(root, 'echo-library.sqlite');
    createHealthyLibrary(databasePath);
    const manager = createLibraryDatabaseManager(databasePath, { assertLibraryAvailable: () => undefined });
    const library = manager.openServiceConnection('library');
    const lyrics = manager.openServiceConnection('lyrics');

    expect(manager.getState().openConnections).toBe(2);
    manager.closeAllUsers('test-close');
    library.close();
    lyrics.close();

    expect(manager.getState()).toEqual(expect.objectContaining({ openConnections: 0, lastCloseReason: 'test-close' }));
  });

  it('closes open users before exclusive maintenance runs', async () => {
    const databasePath = join(root, 'echo-library.sqlite');
    createHealthyLibrary(databasePath);
    const manager = createLibraryDatabaseManager(databasePath, { assertLibraryAvailable: () => undefined });
    const library = manager.openServiceConnection('library');
    expect(manager.getState().openConnections).toBe(1);

    await manager.runExclusiveMaintenance('restore-test', () => {
      expect(manager.getState()).toEqual(expect.objectContaining({ openConnections: 0, maintenanceInProgress: true }));
    });
    library.close();

    expect(manager.getState()).toEqual(expect.objectContaining({ openConnections: 0, maintenanceInProgress: false }));
  });

  it('treats checkpoint on a missing database as a safe no-op', () => {
    const databasePath = join(root, 'echo-library.sqlite');
    const manager = createLibraryDatabaseManager(databasePath, { assertLibraryAvailable: () => undefined });

    const health = manager.checkpoint('missing-db');

    expect(health.status).toBe('ok');
    expect(health.message).toBe('database does not exist yet');
    expect(manager.getState()).toEqual(
      expect.objectContaining({
        lastCheckpointReason: 'missing-db',
        lastCheckpointHealth: expect.objectContaining({ status: 'ok' }),
      }),
    );
  });
});
