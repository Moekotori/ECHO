import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

let userDataPath = process.cwd();
const getLibraryServiceMock = vi.fn();

vi.mock('electron', () => ({
  app: {
    getName: () => 'ECHO NEXT',
    getPath: (name: string) => (name === 'userData' ? userDataPath : tmpdir()),
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('../library/LibraryService', () => ({
  getLibraryService: getLibraryServiceMock,
}));

describe('data backup', () => {
  beforeEach(() => {
    vi.resetModules();
    userDataPath = mkdtempSync(join(tmpdir(), 'echo-data-backup-test-'));
    getLibraryServiceMock.mockReset();
    getLibraryServiceMock.mockReturnValue({
      getCoverCacheDir: () => join(userDataPath, 'cover-cache'),
      hasRunningJobs: () => false,
    });
  });

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('exports user data and cache files into a restorable backup zip', async () => {
    const backupRoot = mkdtempSync(join(tmpdir(), 'echo-data-backup-output-'));
    mkdirSync(join(userDataPath, 'cover-cache'), { recursive: true });
    writeFileSync(join(userDataPath, 'echo-settings.json'), JSON.stringify({ locale: 'en-US', coverCacheDir: null }), 'utf8');
    writeFileSync(join(userDataPath, 'accounts.json'), '{"providers":["spotify"]}\n', 'utf8');
    writeFileSync(join(userDataPath, 'cover-cache', 'cover.webp'), 'cover-bytes');

    try {
      const { exportEchoUserDataBackup, subscribeDataBackupProgress } = await import('./dataBackup');
      const progressPhases: string[] = [];
      const progressPercents: Array<number | null> = [];
      const progressBytes: Array<{ processedBytes: number; totalBytes: number | null }> = [];
      const unsubscribe = subscribeDataBackupProgress((progress) => {
        progressPhases.push(progress.phase);
        progressPercents.push(progress.percent);
        progressBytes.push({ processedBytes: progress.processedBytes, totalBytes: progress.totalBytes });
      });
      const result = await exportEchoUserDataBackup(join(backupRoot, 'backup.zip'), {
        date: new Date('2026-05-20T00:00:00.000Z'),
      });
      unsubscribe();

      expect(result.filePath).toBe(join(backupRoot, 'backup.zip'));
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(existsSync(result.filePath)).toBe(true);
      expect(progressPhases).toContain('scanning');
      expect(progressPhases).toContain('writing');
      expect(progressPhases.at(-1)).toBe('completed');
      expect(progressPercents.at(-1)).toBe(100);
      expect(progressBytes.every((progress) => progress.totalBytes === null || progress.processedBytes <= progress.totalBytes)).toBe(true);

      const unzipped = unzipSync(new Uint8Array(readFileSync(result.filePath)));
      const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as { format: string; database: { health: { status: string } } };
      expect(manifest.format).toBe('echo-next-user-data-backup');
      expect(manifest.database.health.status).toBe('ok');
      expect(strFromU8(unzipped['RESTORE.md'])).toContain('数据备份');
      expect(strFromU8(unzipped['user-data/accounts.json'])).toContain('spotify');
      expect(strFromU8(unzipped['cache/cover-cache/cover.webp'])).toBe('cover-bytes');
    } finally {
      rmSync(backupRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('refuses to export a backup when the active library database is corrupt', async () => {
    const backupRoot = mkdtempSync(join(tmpdir(), 'echo-data-backup-output-'));
    writeFileSync(join(userDataPath, 'echo-library.sqlite'), 'not sqlite', 'utf8');

    try {
      const { exportEchoUserDataBackup } = await import('./dataBackup');

      await expect(exportEchoUserDataBackup(join(backupRoot, 'backup.zip'))).rejects.toThrow('曲库数据库未通过健康检查');
      expect(existsSync(join(backupRoot, 'backup.zip'))).toBe(false);
    } finally {
      rmSync(backupRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});
