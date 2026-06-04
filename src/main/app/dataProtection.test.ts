import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createManualLibraryDatabaseSnapshot,
  createDataProtectionDisabledResult,
  createScanGuardLibraryDatabaseSnapshot,
  createDataProtectionSnapshot,
  discardQuarantinedProblemTracks,
  ensureDataProtection,
  ensureDataProtectionFastStartup,
  ensureDataProtectionStartup,
  getLibraryDatabaseProtectionStatus,
  getProtectedUserDataPath,
  inspectLibraryDatabaseForPoison,
  initializeProtectedUserDataPath,
  isDataProtectionBackgroundPlaybackBlockedForTest,
  isProtectedLibraryAvailable,
  migrateLegacyProtectedData,
  noteDataProtectionPlaybackActivity,
  recordLibraryDatabaseMaintenanceEvent,
  restoreProtectedLibraryDatabaseSnapshot,
  restoreProtectedLibraryDatabaseFromScanGuard,
  runDeferredStartupDataProtection,
  setDataProtectionPlaybackStateProvider,
  restoreMissingProtectedData,
  scrubQuarantinedLibraryDatabase,
  shouldCreateDeferredStartupSnapshot,
  writeDataProtectionManifest,
} from './dataProtection';
import type { LibraryScanStatus } from '../../shared/types/library';

vi.mock('electron', () => ({
  app: {
    getName: () => 'ECHO NEXT',
    getPath: (name: string) => (name === 'appData' ? tmpdir() : tmpdir()),
    getVersion: () => '26.5.16-test',
    setPath: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

const readText = (path: string): string => readFileSync(path, 'utf8');

const createHealthyLibrary = (path: string): void => {
  const database = new Database(path);
  database.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, title TEXT)');
  database.prepare('INSERT INTO tracks (id, title) VALUES (?, ?)').run('track-1', 'Song');
  database.close();
};

const createPoisonedLibrary = (path: string): void => {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT,
      artist TEXT,
      album TEXT,
      album_artist TEXT,
      genre TEXT,
      codec TEXT,
      search_terms TEXT
    )
  `);
  const badTitle = `APIC image/jpeg JFIF ${'x'.repeat(8192)}`;
  database.prepare(
    `INSERT INTO tracks (id, path, title, artist, album, album_artist, genre, codec, search_terms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('track-1', 'D:\\Music\\Safe Artist - Safe Title.mp3', badTitle, badTitle, badTitle, badTitle, badTitle, badTitle, badTitle);
  database.close();
};

const createQuarantinedLibraryArchive = (root: string, databasePath: string): string => {
  const archivePath = join(root, 'data-protection', 'corrupt-archives', '2026-05-20T00-00-00-000Z-startup-poisoned-library');
  mkdirSync(archivePath, { recursive: true });
  copyFileSync(databasePath, join(archivePath, 'echo-library.sqlite'));
  writeFileSync(
    join(archivePath, 'archive.json'),
    `${JSON.stringify(
      {
        formatVersion: 1,
        reason: 'startup-poisoned-library',
        createdAt: '2026-05-20T00:00:00.000Z',
        copied: ['echo-library.sqlite'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return archivePath;
};

const scanStatus = (patch: Partial<LibraryScanStatus> = {}): LibraryScanStatus => ({
  id: 'scan-1',
  folderId: 'folder-1',
  status: 'failed',
  phase: 'failed',
  totalFiles: 3,
  processedFiles: 3,
  skippedFiles: 0,
  addedTracks: 1,
  updatedTracks: 1,
  removedTracks: 0,
  coverCount: 1,
  errorCount: 1,
  errors: [],
  startedAt: '2026-05-18T00:00:00.000Z',
  finishedAt: '2026-05-18T00:01:00.000Z',
  ...patch,
});

describe('dataProtection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'echo-data-protection-'));
  });

  afterEach(() => {
    setDataProtectionPlaybackStateProvider(null);
    vi.useRealTimers();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('pins userData to a stable appData folder', () => {
    const calls: Array<[string, string]> = [];
    const fakeApp = {
      getPath: (name: string) => (name === 'appData' ? tempDir : join(tempDir, 'Wrong Product Name')),
      setPath: (name: string, value: string) => calls.push([name, value]),
    };

    expect(getProtectedUserDataPath(fakeApp)).toBe(join(tempDir, 'ECHO NEXT'));
    expect(initializeProtectedUserDataPath(fakeApp)).toBe(join(tempDir, 'ECHO NEXT'));
    expect(calls).toEqual([['userData', join(tempDir, 'ECHO NEXT')]]);
  });

  it('restores missing settings and library files from the latest snapshot without overwriting existing data', async () => {
    const settingsPath = join(tempDir, 'echo-settings.json');
    const libraryPath = join(tempDir, 'echo-library.sqlite');
    writeFileSync(settingsPath, '{"theme":"dark"}\n', 'utf8');
    createHealthyLibrary(libraryPath);

    const snapshot = await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-16T00:00:00.000Z'));
    expect(snapshot.copied).toEqual(expect.arrayContaining(['echo-settings.json', 'echo-library.sqlite']));

    writeFileSync(settingsPath, '{"theme":"light"}\n', 'utf8');
    rmSync(libraryPath);

    const restore = restoreMissingProtectedData(tempDir);

    expect(restore.restored).toEqual(['echo-library.sqlite']);
    expect(readText(settingsPath)).toBe('{"theme":"light"}\n');
    const restoredDatabase = new Database(libraryPath, { readonly: true });
    expect(restoredDatabase.prepare<[string], { title: string }>('SELECT title FROM tracks WHERE id = ?').get('track-1')).toMatchObject({ title: 'Song' });
    restoredDatabase.close();
  });

  it('restores a missing library database from the latest healthy database snapshot', async () => {
    const libraryPath = join(tempDir, 'echo-library.sqlite');
    createHealthyLibrary(libraryPath);
    await createDataProtectionSnapshot('scan-completed-library-snapshot', tempDir, new Date('2026-05-17T00:00:00.000Z'));
    writeFileSync(libraryPath, 'bad newer database', 'utf8');
    await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-18T00:00:00.000Z'));
    rmSync(libraryPath);

    const restore = restoreMissingProtectedData(tempDir);
    const restoredDatabase = new Database(libraryPath, { readonly: true });
    const row = restoredDatabase.prepare<[string], { title: string }>('SELECT title FROM tracks WHERE id = ?').get('track-1');
    restoredDatabase.close();

    expect(restore.restored).toContain('echo-library.sqlite');
    expect(row?.title).toBe('Song');
  });

  it('uses lightweight protection for fast startup without creating a blocking snapshot', async () => {
    const libraryPath = join(tempDir, 'echo-library.sqlite');
    createHealthyLibrary(libraryPath);

    const result = await ensureDataProtectionFastStartup('startup', tempDir);

    expect(result.libraryHealth.status).toBe('ok');
    expect(result.recovery.action).toBe('none');
    expect(result.snapshot.snapshotPath).toBe('');
    expect(result.snapshot.libraryBackupMethod).toBe('none');
    expect(existsSync(join(tempDir, 'data-protection', 'echo-data-protection.json'))).toBe(true);
    expect(existsSync(join(tempDir, 'data-protection', 'snapshots'))).toBe(false);
  });

  it('falls back to full protection when fast startup sees a missing database with snapshots available', async () => {
    const libraryPath = join(tempDir, 'echo-library.sqlite');
    createHealthyLibrary(libraryPath);
    await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-18T00:00:00.000Z'));
    rmSync(libraryPath);

    const result = await ensureDataProtectionFastStartup('startup', tempDir);

    expect(result.libraryHealth.status).toBe('ok');
    expect(result.restore.restored).toContain('echo-library.sqlite');
    expect(existsSync(libraryPath)).toBe(true);
  });

  it('keeps startup protection lightweight when a restore needs background work', async () => {
    const libraryPath = join(tempDir, 'echo-library.sqlite');
    createHealthyLibrary(libraryPath);
    await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-18T00:00:00.000Z'));
    rmSync(libraryPath);

    const result = await ensureDataProtectionStartup('startup', tempDir);

    expect(result.libraryHealth.status).toBe('unreadable');
    expect(result.recovery.action).toBe('failed');
    expect(result.restore.restored).toEqual([]);
    expect(result.snapshot.snapshotPath).toBe('');
    expect(existsSync(libraryPath)).toBe(false);
  });

  it('creates a disabled protection result without restoring or snapshotting data', () => {
    const libraryPath = join(tempDir, 'echo-library.sqlite');
    createHealthyLibrary(libraryPath);

    const result = createDataProtectionDisabledResult(tempDir);

    expect(result.libraryHealth.status).toBe('ok');
    expect(result.recovery.action).toBe('none');
    expect(result.restore.restored).toEqual([]);
    expect(result.snapshot.snapshotPath).toBe('');
    expect(existsSync(join(tempDir, 'data-protection', 'snapshots'))).toBe(false);
  });

  it('migrates stronger legacy echo-next data over a fresh protected directory', async () => {
    const targetDir = join(tempDir, 'ECHO NEXT');
    const legacyDir = join(tempDir, 'echo-next');
    const targetLibraryPath = join(targetDir, 'echo-library.sqlite');
    const legacyLibraryPath = join(legacyDir, 'echo-library.sqlite');

    mkdirSync(targetDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(targetDir, 'echo-settings.json'), '{"theme":"fresh"}\n', { encoding: 'utf8', flag: 'w' });
    writeFileSync(targetLibraryPath, Buffer.alloc(512 * 1024));
    writeFileSync(join(legacyDir, 'echo-settings.json'), '{"theme":"old"}\n', { encoding: 'utf8', flag: 'w' });
    writeFileSync(legacyLibraryPath, Buffer.alloc(2 * 1024 * 1024));

    const migration = await migrateLegacyProtectedData(targetDir, [legacyDir]);

    expect(migration.sourcePath).toBe(legacyDir);
    expect(migration.migrated).toEqual(expect.arrayContaining(['echo-settings.json', 'echo-library.sqlite']));
    expect(readText(join(targetDir, 'echo-settings.json'))).toBe('{"theme":"old"}\n');
    expect(readFileSync(targetLibraryPath).length).toBe(2 * 1024 * 1024);
    expect(existsSync(join(targetDir, 'data-protection', 'snapshots'))).toBe(true);
  });

  it('migrates legacy settings and account data even when the old library is small', async () => {
    const targetDir = join(tempDir, 'ECHO NEXT');
    const legacyDir = join(tempDir, 'echo-next');

    mkdirSync(targetDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(targetDir, 'echo-settings.json'), '{"theme":"fresh"}\n', 'utf8');
    writeFileSync(join(targetDir, 'echo-library.sqlite'), Buffer.alloc(256 * 1024));
    writeFileSync(join(legacyDir, 'echo-settings.json'), '{"theme":"custom"}\n', 'utf8');
    writeFileSync(join(legacyDir, 'echo-library.sqlite'), Buffer.alloc(320 * 1024));
    writeFileSync(join(legacyDir, 'accounts.json'), '{"providers":["spotify"]}\n', 'utf8');
    writeFileSync(join(legacyDir, 'eq-presets.json'), '{"presets":["my-eq"]}\n', 'utf8');

    const migration = await migrateLegacyProtectedData(targetDir, [legacyDir]);

    expect(migration.sourcePath).toBe(legacyDir);
    expect(migration.migrated).toEqual(expect.arrayContaining(['echo-settings.json', 'accounts.json', 'eq-presets.json']));
    expect(readText(join(targetDir, 'echo-settings.json'))).toBe('{"theme":"custom"}\n');
    expect(readText(join(targetDir, 'accounts.json'))).toContain('spotify');
  });

  it('does not replace an actively used protected directory with weaker legacy data', async () => {
    const targetDir = join(tempDir, 'ECHO NEXT');
    const legacyDir = join(tempDir, 'echo-next');

    mkdirSync(targetDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(targetDir, 'echo-settings.json'), '{"theme":"current"}\n', 'utf8');
    writeFileSync(join(targetDir, 'echo-library.sqlite'), Buffer.alloc(4 * 1024 * 1024));
    writeFileSync(join(targetDir, 'accounts.json'), '{"providers":["current"]}\n', 'utf8');
    writeFileSync(join(legacyDir, 'echo-settings.json'), '{"theme":"old"}\n', 'utf8');
    writeFileSync(join(legacyDir, 'echo-library.sqlite'), Buffer.alloc(256 * 1024));

    const migration = await migrateLegacyProtectedData(targetDir, [legacyDir]);

    expect(migration.sourcePath).toBeNull();
    expect(readText(join(targetDir, 'echo-settings.json'))).toBe('{"theme":"current"}\n');
    expect(readText(join(targetDir, 'accounts.json'))).toContain('current');
  });

  it('writes a manifest that lists protected user data entries', () => {
    writeDataProtectionManifest(tempDir);

    const manifestPath = join(tempDir, 'data-protection', 'echo-data-protection.json');
    const manifest = JSON.parse(readText(manifestPath)) as {
      protectedUserDataPath: string;
      protectedEntries: Array<{ name: string; path: string }>;
    };

    expect(existsSync(manifestPath)).toBe(true);
    expect(manifest.protectedUserDataPath).toBe(tempDir);
    expect(manifest.protectedEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'echo-settings.json', path: settingsPathFor(tempDir, 'echo-settings.json') }),
        expect.objectContaining({ name: 'echo-library.sqlite', path: settingsPathFor(tempDir, 'echo-library.sqlite') }),
      ]),
    );
  });

  it('creates a SQLite-backed healthy snapshot manifest', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));

    const snapshot = await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-17T00:00:00.000Z'));
    const manifest = JSON.parse(readText(join(snapshot.snapshotPath, 'snapshot.json'))) as {
      libraryHealth: { status: string };
      libraryBackupMethod: string;
      databaseSizeBytes: number | null;
      databaseMtimeMs: number | null;
      walSizeBytes: number | null;
      walMtimeMs: number | null;
      shmSizeBytes: number | null;
      shmMtimeMs: number | null;
    };

    expect(snapshot.libraryHealth.status).toBe('ok');
    expect(snapshot.libraryBackupMethod).toBe('sqlite-backup');
    expect(manifest.libraryHealth.status).toBe('ok');
    expect(manifest.libraryBackupMethod).toBe('sqlite-backup');
    expect(typeof manifest.databaseSizeBytes).toBe('number');
    expect(typeof manifest.databaseMtimeMs).toBe('number');
    expect(manifest.walSizeBytes).toBeNull();
    expect(manifest.walMtimeMs).toBeNull();
    expect(manifest.shmSizeBytes).toBeNull();
    expect(manifest.shmMtimeMs).toBeNull();
  });

  it('skips deferred startup snapshot when a completed scan snapshot already covers the current library', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    const snapshot = await createDataProtectionSnapshot('scan-completed-library-snapshot', tempDir, new Date('2026-05-17T00:00:00.000Z'));

    const decision = shouldCreateDeferredStartupSnapshot(tempDir, new Date('2026-05-18T00:00:00.000Z'));

    expect(decision.shouldCreate).toBe(false);
    expect(decision.reason).toBe('recent-scan-snapshot');
    expect(decision.snapshotId).toBe(snapshot.snapshotPath.split(/[\\/]/u).pop());
  });

  it('skips deferred startup snapshot when a recent startup snapshot still matches the current library', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    const snapshot = await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-17T00:00:00.000Z'));

    const decision = shouldCreateDeferredStartupSnapshot(tempDir, new Date('2026-05-17T12:00:00.000Z'));

    expect(decision.shouldCreate).toBe(false);
    expect(decision.reason).toBe('recent-startup-snapshot');
    expect(decision.snapshotId).toBe(snapshot.snapshotPath.split(/[\\/]/u).pop());
  });

  it('creates deferred startup snapshot when the database signature changed', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    await createDataProtectionSnapshot('scan-completed-library-snapshot', tempDir, new Date('2026-05-17T00:00:00.000Z'));
    writeFileSync(join(tempDir, 'echo-library.sqlite'), 'changed database', 'utf8');

    const decision = shouldCreateDeferredStartupSnapshot(tempDir, new Date('2026-05-18T00:00:00.000Z'));

    expect(decision.shouldCreate).toBe(true);
    expect(decision.reason).toBe('database-changed');
  });

  it('creates deferred startup snapshot when the WAL signature changed', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    await createDataProtectionSnapshot('scan-completed-library-snapshot', tempDir, new Date('2026-05-17T00:00:00.000Z'));
    writeFileSync(join(tempDir, 'echo-library.sqlite-wal'), 'wal changed', 'utf8');

    const decision = shouldCreateDeferredStartupSnapshot(tempDir, new Date('2026-05-18T00:00:00.000Z'));

    expect(decision.shouldCreate).toBe(true);
    expect(decision.reason).toBe('database-changed');
  });

  it('skips background startup snapshot when an existing snapshot still matches the library', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    await createDataProtectionSnapshot('scan-completed-library-snapshot', tempDir, new Date('2026-05-17T00:00:00.000Z'));

    const result = await runDeferredStartupDataProtection('startup', tempDir);

    expect(result.libraryHealth.status).toBe('ok');
    expect(result.snapshot.snapshotPath).toBe('');
    expect(readdirSync(join(tempDir, 'data-protection', 'snapshots'))).toHaveLength(1);
  });

  it('keeps deferred startup protection blocked while playback or the player is still active', () => {
    const now = Date.now();

    noteDataProtectionPlaybackActivity(true, now);
    expect(isDataProtectionBackgroundPlaybackBlockedForTest(now + 1_000)).toBe(true);

    noteDataProtectionPlaybackActivity(false, now + 1_000);
    expect(isDataProtectionBackgroundPlaybackBlockedForTest(now + 60_500)).toBe(true);
    expect(isDataProtectionBackgroundPlaybackBlockedForTest(now + 61_500)).toBe(false);
  });

  it('creates deferred startup snapshot for legacy snapshots without signature fields', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    const snapshot = await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-17T00:00:00.000Z'));
    const manifestPath = join(snapshot.snapshotPath, 'snapshot.json');
    const manifest = JSON.parse(readText(manifestPath)) as Record<string, unknown>;
    for (const key of ['databaseSizeBytes', 'databaseMtimeMs', 'walSizeBytes', 'walMtimeMs', 'shmSizeBytes', 'shmMtimeMs']) {
      delete manifest[key];
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const decision = shouldCreateDeferredStartupSnapshot(tempDir, new Date('2026-05-17T12:00:00.000Z'));

    expect(decision.shouldCreate).toBe(true);
    expect(decision.reason).toBe('legacy-snapshot-missing-signature');
  });

  it('lists the latest healthy snapshot while ignoring bad snapshots', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    const healthy = await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-17T00:00:00.000Z'));
    writeFileSync(join(tempDir, 'echo-library.sqlite'), 'bad newer snapshot', 'utf8');
    await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-18T00:00:00.000Z'));

    const status = getLibraryDatabaseProtectionStatus(tempDir);

    expect(status.snapshots).toHaveLength(2);
    expect(status.latestHealthySnapshot?.id).toBe(healthy.snapshotPath.split(/[\\/]/u).pop());
    expect(status.canRestoreSnapshot).toBe(true);
  });

  it('defers snapshot database health checks for lightweight danger status', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    const snapshot = await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-17T00:00:00.000Z'));
    writeFileSync(join(snapshot.snapshotPath, 'echo-library.sqlite'), 'snapshot became unreadable', 'utf8');

    const lightweightStatus = getLibraryDatabaseProtectionStatus(tempDir, false, { deepCheck: false });
    const deepStatus = getLibraryDatabaseProtectionStatus(tempDir, false, { deepCheck: true });

    expect(lightweightStatus.snapshots[0]?.libraryHealth.status).toBe('ok');
    expect(lightweightStatus.latestHealthySnapshot?.id).toBe(snapshot.snapshotPath.split(/[\\/]/u).pop());
    expect(deepStatus.snapshots[0]?.libraryHealth.status).toBe('corrupt');
    expect(deepStatus.latestHealthySnapshot).toBeNull();
  });

  it('recommends restoring a healthy snapshot when the current database is corrupt', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    await createManualLibraryDatabaseSnapshot(tempDir);
    writeFileSync(join(tempDir, 'echo-library.sqlite'), 'bad current database', 'utf8');

    const status = getLibraryDatabaseProtectionStatus(tempDir);

    expect(status.health.status).toBe('corrupt');
    expect(status.latestHealthySnapshot?.libraryHealth.status).toBe('ok');
    expect(status.recommendedAction).toBe('restore-snapshot');
    expect(status.unrecoverableReason).toBeUndefined();
  });

  it('recommends rebuilding an empty database when corrupt and no healthy snapshot exists', () => {
    writeFileSync(join(tempDir, 'echo-library.sqlite'), 'bad current database', 'utf8');

    const status = getLibraryDatabaseProtectionStatus(tempDir);

    expect(status.health.status).toBe('corrupt');
    expect(status.latestHealthySnapshot).toBeNull();
    expect(status.recommendedAction).toBe('rebuild-empty-database');
    expect(status.unrecoverableReason).toContain('没有可恢复的健康快照');
  });

  it('keeps recommending empty rebuild after a failed snapshot restore event', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    const statusWithSnapshot = await createManualLibraryDatabaseSnapshot(tempDir);
    const snapshotId = statusWithSnapshot.latestHealthySnapshot?.id ?? 'snapshot-id';
    writeFileSync(join(tempDir, 'echo-library.sqlite'), 'bad current database', 'utf8');
    recordLibraryDatabaseMaintenanceEvent(
      {
        action: 'manual-restore',
        databasePath: join(tempDir, 'echo-library.sqlite'),
        archivePath: null,
        removedDatabaseFiles: ['echo-library.sqlite'],
        restoredSnapshotId: snapshotId,
        health: {
          status: 'corrupt',
          databasePath: join(tempDir, 'echo-library.sqlite'),
          checkedAt: '2026-05-18T00:00:00.000Z',
          message: 'quick_check failed',
        },
      },
      tempDir,
    );

    const status = getLibraryDatabaseProtectionStatus(tempDir);

    expect(status.latestHealthySnapshot?.id).toBe(snapshotId);
    expect(status.recommendedAction).toBe('rebuild-empty-database');
    expect(status.unrecoverableReason).toContain('恢复后仍未通过数据库检查');
  });

  it('archives the current database and restores a healthy enumerated snapshot', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    const statusWithSnapshot = await createManualLibraryDatabaseSnapshot(tempDir);
    const snapshotId = statusWithSnapshot.latestHealthySnapshot?.id;
    expect(snapshotId).toBeTruthy();
    writeFileSync(join(tempDir, 'echo-library.sqlite'), 'bad current database', 'utf8');

    const result = restoreProtectedLibraryDatabaseSnapshot(snapshotId!, tempDir);
    const restoredDatabase = new Database(join(tempDir, 'echo-library.sqlite'), { readonly: true });
    const row = restoredDatabase.prepare<[string], { title: string }>('SELECT title FROM tracks WHERE id = ?').get('track-1');
    restoredDatabase.close();

    expect(result.health.status).toBe('ok');
    expect(result.archivePath).toBeTruthy();
    expect(existsSync(join(result.archivePath!, 'echo-library.sqlite'))).toBe(true);
    expect(row?.title).toBe('Song');
    expect(getLibraryDatabaseProtectionStatus(tempDir).maintenanceEvents[0]).toEqual(
      expect.objectContaining({ action: 'manual-restore', restoredSnapshotId: snapshotId }),
    );
  });

  it('restores the scan guard snapshot after scan-time corruption', async () => {
    const databasePath = join(tempDir, 'echo-library.sqlite');
    createHealthyLibrary(databasePath);
    const guard = await createScanGuardLibraryDatabaseSnapshot(scanStatus({ status: 'running', phase: 'reading_metadata' }), tempDir);
    expect(guard?.libraryHealth.status).toBe('ok');
    writeFileSync(databasePath, 'bad after scan', 'utf8');

    const result = restoreProtectedLibraryDatabaseFromScanGuard(guard!, scanStatus(), new Error('database disk image is malformed'), tempDir);
    const restoredDatabase = new Database(databasePath, { readonly: true });
    const row = restoredDatabase.prepare<[string], { title: string }>('SELECT title FROM tracks WHERE id = ?').get('track-1');
    restoredDatabase.close();

    expect(result.health.status).toBe('ok');
    expect(row?.title).toBe('Song');
    expect(getLibraryDatabaseProtectionStatus(tempDir).maintenanceEvents[0]).toEqual(
      expect.objectContaining({ action: 'scan-auto-restore', restoredSnapshotId: guard?.id }),
    );
  });

  it('does not restore a snapshot id that the main process did not enumerate', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    await createManualLibraryDatabaseSnapshot(tempDir);

    expect(() => restoreProtectedLibraryDatabaseSnapshot('..\\echo-library.sqlite', tempDir)).toThrow(/找不到这个曲库数据库快照/u);
  });

  it('archives and protects a corrupt startup library even when a healthy snapshot exists', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-17T00:00:00.000Z'));
    writeFileSync(join(tempDir, 'echo-library.sqlite'), 'not sqlite', 'utf8');

    const result = await ensureDataProtection('startup', tempDir);

    expect(result.recovery.action).toBe('archivedOnly');
    expect(result.libraryHealth.status).toBe('corrupt');
    expect(readText(join(tempDir, 'echo-library.sqlite'))).toBe('not sqlite');
    expect(existsSync(join(tempDir, 'data-protection', 'corrupt-archives'))).toBe(true);
    expect(isProtectedLibraryAvailable()).toBe(false);
  });

  it('does not restore old snapshots after a corrupt startup database is protected', async () => {
    createHealthyLibrary(join(tempDir, 'echo-library.sqlite'));
    await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-17T00:00:00.000Z'));
    writeFileSync(join(tempDir, 'echo-library.sqlite'), 'bad newer snapshot', 'utf8');
    await createDataProtectionSnapshot('startup', tempDir, new Date('2026-05-18T00:00:00.000Z'));
    writeFileSync(join(tempDir, 'echo-library.sqlite'), 'bad current database', 'utf8');

    const result = await ensureDataProtection('startup', tempDir);

    expect(result.recovery.action).toBe('archivedOnly');
    expect(result.recovery.sourceSnapshotPath).toBeUndefined();
    expect(readText(join(tempDir, 'echo-library.sqlite'))).toBe('bad current database');
  });

  it('keeps a corrupt library in place when no healthy snapshot exists', async () => {
    writeFileSync(join(tempDir, 'echo-library.sqlite'), 'bad current database', 'utf8');

    const result = await ensureDataProtection('startup', tempDir);

    expect(result.recovery.action).toBe('archivedOnly');
    expect(result.libraryHealth.status).toBe('corrupt');
    expect(readText(join(tempDir, 'echo-library.sqlite'))).toBe('bad current database');
    const archivesPath = join(tempDir, 'data-protection', 'corrupt-archives');
    const archiveNames = readdirSync(archivesPath);
    expect(archiveNames.length).toBeGreaterThan(0);
    expect(readText(join(archivesPath, archiveNames[0], 'echo-library.sqlite'))).toBe('bad current database');
  });

  it('auto-repairs a structurally healthy database with poisoned metadata before startup library access', async () => {
    const databasePath = join(tempDir, 'echo-library.sqlite');
    createPoisonedLibrary(databasePath);

    const poisonReport = inspectLibraryDatabaseForPoison(databasePath);
    expect(poisonReport.status).toBe('poisoned');
    expect(poisonReport.suspectCounts['tracks.title']).toBe(1);

    const result = await ensureDataProtection('startup', tempDir);
    const status = getLibraryDatabaseProtectionStatus(tempDir);
    const repairedDatabase = new Database(databasePath, { readonly: true });
    const row = repairedDatabase.prepare<[string], { title: string; artist: string; search_terms: string }>(
      'SELECT title, artist, search_terms FROM tracks WHERE id = ?',
    ).get('track-1');
    repairedDatabase.close();

    expect(result.recovery.action).toBe('none');
    expect(result.libraryHealth.status).toBe('ok');
    expect(existsSync(databasePath)).toBe(true);
    expect(inspectLibraryDatabaseForPoison(databasePath).status).toBe('ok');
    expect(row).toMatchObject({ title: 'Safe Title', artist: 'Safe Artist' });
    expect(row?.search_terms).toContain('safe title');
    expect(status.status).toBe('ok');
    expect(status.reason).toBe('none');
    expect(status.recommendedAction).toBe('none');
    expect(status.maintenanceEvents[0]).toEqual(expect.objectContaining({ action: 'startup-auto-repair' }));
    expect(isProtectedLibraryAvailable()).toBe(true);
  });

  it('skips deep poison inspection for lightweight protection status reads', () => {
    const databasePath = join(tempDir, 'echo-library.sqlite');
    createPoisonedLibrary(databasePath);

    const status = getLibraryDatabaseProtectionStatus(tempDir, false, { deepCheck: false });

    expect(status.health.status).toBe('ok');
    expect(status.poisonReport).toBeNull();
    expect(status.reason).toBe('none');
    expect(status.recommendedAction).toBe('none');
  });

  it('compacts oversized scan diagnostics without protecting the library', async () => {
    const databasePath = join(tempDir, 'echo-library.sqlite');
    createHealthyLibrary(databasePath);
    const database = new Database(databasePath);
    database.exec('CREATE TABLE scan_jobs (id TEXT PRIMARY KEY, errors_json TEXT)');
    database.prepare('INSERT INTO scan_jobs (id, errors_json) VALUES (?, ?)').run(
      'scan-1',
      JSON.stringify(Array.from({ length: 400 }, (_value, index) => `D:\\Music\\track-${index}.flac: metadata warning ${'x'.repeat(240)}`)),
    );
    database.close();

    const result = await ensureDataProtection('startup', tempDir);
    const restoredDatabase = new Database(databasePath, { readonly: true });
    const row = restoredDatabase.prepare<[string], { length: number }>('SELECT length(errors_json) AS length FROM scan_jobs WHERE id = ?').get('scan-1');
    restoredDatabase.close();

    expect(result.recovery.action).toBe('none');
    expect(result.libraryHealth.status).toBe('ok');
    expect(inspectLibraryDatabaseForPoison(databasePath).status).toBe('ok');
    expect(row?.length).toBeLessThanOrEqual(4096);
    expect(getLibraryDatabaseProtectionStatus(tempDir).recommendedAction).toBe('none');
    expect(isProtectedLibraryAvailable()).toBe(true);
  });

  it('scrubs a quarantined database copy before restoring it to the active slot', async () => {
    const databasePath = join(tempDir, 'echo-library.sqlite');
    createPoisonedLibrary(databasePath);
    createQuarantinedLibraryArchive(tempDir, databasePath);
    rmSync(databasePath);
    await ensureDataProtection('startup', tempDir);

    const result = scrubQuarantinedLibraryDatabase(tempDir, new Date('2026-05-20T00:00:00.000Z'));
    const restoredDatabase = new Database(databasePath, { readonly: true });
    const row = restoredDatabase.prepare<[string], { title: string; artist: string; search_terms: string }>(
      'SELECT title, artist, search_terms FROM tracks WHERE id = ?',
    ).get('track-1');
    restoredDatabase.close();

    expect(result.health.status).toBe('ok');
    expect(result.poisonReportAfter.status).toBe('ok');
    expect(result.scrubbedRows).toBeGreaterThan(0);
    expect(row).toMatchObject({ title: 'Safe Title', artist: 'Safe Artist' });
    expect(row?.search_terms).toContain('safe title');
    expect(row?.search_terms).not.toContain('APIC');
    expect(getLibraryDatabaseProtectionStatus(tempDir).recommendedAction).toBe('none');
    expect(isProtectedLibraryAvailable()).toBe(true);
  });

  it('archives and removes poisoned tracks from a quarantined database copy', async () => {
    const databasePath = join(tempDir, 'echo-library.sqlite');
    createPoisonedLibrary(databasePath);
    const database = new Database(databasePath);
    database.prepare(
      `INSERT INTO tracks (id, path, title, artist, album, album_artist, genre, codec, search_terms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('track-2', 'D:\\Music\\Good Artist - Good Title.mp3', 'Good Title', 'Good Artist', 'Good Album', 'Good Artist', null, 'MP3', 'good title good artist');
    database.close();
    createQuarantinedLibraryArchive(tempDir, databasePath);
    rmSync(databasePath);
    await ensureDataProtection('startup', tempDir);

    const result = discardQuarantinedProblemTracks(tempDir, new Date('2026-05-20T00:10:00.000Z'));
    const restoredDatabase = new Database(databasePath, { readonly: true });
    const rows = restoredDatabase.prepare<[], { id: string; title: string }>('SELECT id, title FROM tracks ORDER BY id').all();
    restoredDatabase.close();
    const discarded = JSON.parse(readText(result.discardArchivePath)) as { discardedTrackIds: string[] };

    expect(result.health.status).toBe('ok');
    expect(result.poisonReportAfter.status).toBe('ok');
    expect(result.discardedTracks).toBe(1);
    expect(result.discardedTrackIds).toEqual(['track-1']);
    expect(discarded.discardedTrackIds).toEqual(['track-1']);
    expect(rows).toEqual([{ id: 'track-2', title: 'Good Title' }]);
    expect(getLibraryDatabaseProtectionStatus(tempDir).recommendedAction).toBe('none');
    expect(isProtectedLibraryAvailable()).toBe(true);
  });

  it('does not globally block the library for unreadable health checks', async () => {
    mkdirSync(join(tempDir, 'echo-library.sqlite'), { recursive: true });

    const result = await ensureDataProtection('startup', tempDir);

    expect(result.libraryHealth.status).toBe('unreadable');
    expect(result.recovery.action).toBe('none');
    expect(isProtectedLibraryAvailable()).toBe(true);
  });
});

const settingsPathFor = (root: string, name: string): string => join(root, name);
