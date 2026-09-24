import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

let userDataPath = process.cwd();
const getLibraryServiceMock = vi.fn();

vi.mock('electron', () => {
  const app = {
    getName: () => 'ECHO NEXT',
    getPath: (name: string) => (name === 'userData' ? userDataPath : tmpdir()),
    getVersion: () => '0.0.0-test',
  };
  return {
    app,
    default: { app },
  };
});

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

  it('remaps restored wallpaper references to the current user data directory', async () => {
    const appWallpaperDirectory = join(userDataPath, 'app-wallpapers');
    const lyricsWallpaperDirectory = join(userDataPath, 'lyrics-wallpapers');
    const landscapePath = join(appWallpaperDirectory, 'landscape.png');
    const portraitPath = join(appWallpaperDirectory, 'portrait.webm');
    const lyricsPath = join(lyricsWallpaperDirectory, 'lyrics.webp');
    mkdirSync(appWallpaperDirectory, { recursive: true });
    mkdirSync(lyricsWallpaperDirectory, { recursive: true });
    writeFileSync(landscapePath, 'landscape');
    writeFileSync(portraitPath, 'portrait');
    writeFileSync(lyricsPath, 'lyrics');

    const { remapRestoredWallpaperPaths } = await import('./dataBackup');
    const remapped = remapRestoredWallpaperPaths({
      appCustomWallpaperPath: 'C:\\Old-ECHO\\app-wallpapers\\landscape.png',
      appPortraitWallpaperPath: 'C:\\Old-ECHO\\app-wallpapers\\portrait.webm',
      lyricsCustomWallpaperPath: 'C:\\Old-ECHO\\lyrics-wallpapers\\lyrics.webp',
    });

    expect(remapped.appCustomWallpaperPath).toBe(landscapePath);
    expect(remapped.appPortraitWallpaperPath).toBe(portraitPath);
    expect(remapped.lyricsCustomWallpaperPath).toBe(lyricsPath);
  });

  it('imports through staging, preserves the current cache target, and reloads account state', async () => {
    const backupRoot = mkdtempSync(join(tmpdir(), 'echo-data-backup-output-'));
    const unrelatedDirectory = mkdtempSync(join(tmpdir(), 'echo-data-backup-unrelated-'));
    const coverCacheDirectory = join(userDataPath, 'cover-cache');
    mkdirSync(coverCacheDirectory, { recursive: true });
    writeFileSync(join(unrelatedDirectory, 'keep.txt'), 'must-stay');
    writeFileSync(join(coverCacheDirectory, 'cover.webp'), 'backup-cover');
    writeFileSync(join(userDataPath, 'echo-playback-memory.json'), '{"track":"backup"}\n');

    try {
      const { setAppSettings } = await import('./appSettings');
      const { getAccountService } = await import('../accounts/AccountService');
      const { exportEchoUserDataBackup, importEchoUserDataBackup } = await import('./dataBackup');
      setAppSettings({ coverCacheDir: unrelatedDirectory });
      getAccountService().saveCookie('netease', 'MUSIC_U=backup');
      const backupPath = join(backupRoot, 'backup.zip');
      await exportEchoUserDataBackup(backupPath);

      setAppSettings({ coverCacheDir: null });
      getAccountService().saveCookie('netease', 'MUSIC_U=current');
      writeFileSync(join(coverCacheDirectory, 'cover.webp'), 'current-cover');
      writeFileSync(join(userDataPath, 'echo-playback-memory.json'), '{"track":"current"}\n');

      const result = await importEchoUserDataBackup(backupPath);

      expect(result.settings.coverCacheDir).toBeNull();
      expect(readFileSync(join(unrelatedDirectory, 'keep.txt'), 'utf8')).toBe('must-stay');
      expect(readFileSync(join(coverCacheDirectory, 'cover.webp'), 'utf8')).toBe('backup-cover');
      expect(readFileSync(join(userDataPath, 'echo-playback-memory.json'), 'utf8')).toContain('backup');
      expect(getAccountService().getCredentials('netease').cookie).toBe('MUSIC_U=backup');
    } finally {
      rmSync(backupRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      rmSync(unrelatedDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('blocks a backup while an import is active', async () => {
    const backupRoot = mkdtempSync(join(tmpdir(), 'echo-data-backup-output-'));
    try {
      const { setAppSettings } = await import('./appSettings');
      const { importEchoUserDataBackup, runDataBackupNow } = await import('./dataBackup');
      setAppSettings({ autoDataBackupDirectory: backupRoot });

      const importPromise = importEchoUserDataBackup(join(backupRoot, 'missing.zip'));
      await expect(runDataBackupNow()).rejects.toThrow('导入正在运行');
      await expect(importPromise).rejects.toThrow();

      const backupPromise = runDataBackupNow();
      await expect(importEchoUserDataBackup(join(backupRoot, 'missing.zip'))).rejects.toThrow('备份正在运行');
      await backupPromise;
    } finally {
      rmSync(backupRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('backs off automatic retries after a failed backup', async () => {
    const backupRoot = mkdtempSync(join(tmpdir(), 'echo-data-backup-output-'));
    writeFileSync(join(userDataPath, 'echo-library.sqlite'), 'not sqlite', 'utf8');
    try {
      const { setAppSettings } = await import('./appSettings');
      const {
        disposeDataBackupScheduler,
        getDataBackupStatus,
        runDataBackupNow,
      } = await import('./dataBackup');
      setAppSettings({
        autoDataBackupDirectory: backupRoot,
        autoDataBackupEnabled: true,
        autoDataBackupLastRunAt: '2026-01-01T00:00:00.000Z',
      });

      const failedAt = Date.now();
      await expect(runDataBackupNow('automatic')).rejects.toThrow('曲库数据库未通过健康检查');
      const nextBackupAt = getDataBackupStatus().nextBackupAt;
      expect(nextBackupAt).not.toBeNull();
      expect(new Date(nextBackupAt!).getTime() - failedAt).toBeGreaterThanOrEqual(4 * 60_000);
      disposeDataBackupScheduler();
    } finally {
      rmSync(backupRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});
