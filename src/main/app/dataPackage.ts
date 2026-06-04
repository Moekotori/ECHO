import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { app } from 'electron';
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { DataPackageExportResult } from '../../shared/types/settingsBackup';
import { getAccountService } from '../accounts/AccountService';
import { checkDatabaseHealth } from '../database/health';
import { getLibraryService } from '../library/LibraryService';
import { getAppSettings } from './appSettings';
import { createDataProtectionSnapshot, getLastDataProtectionResult } from './dataProtection';

const dataPackageFormat = 'echo-next-data-package';
const dataPackageVersion = 1;
const maxPlaylistExportItems = 10000;

type ZipFiles = Record<string, Uint8Array>;

const toZipText = (value: unknown): Uint8Array =>
  strToU8(`${JSON.stringify(value, null, 2)}\n`);

const toZipMarkdown = (value: string): Uint8Array => strToU8(value);

const safeZipPath = (path: string): string =>
  path.split(sep).join('/').replace(/^\/+/u, '').replace(/(?:^|\/)\.\.(?=\/|$)/gu, '_');

const addFileToZip = (files: ZipFiles, entryPath: string, sourcePath: string): boolean => {
  try {
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      return false;
    }

    files[safeZipPath(entryPath)] = readFileSync(sourcePath);
    return true;
  } catch {
    return false;
  }
};

const addDirectoryToZip = (files: ZipFiles, zipRoot: string, sourceRoot: string): string[] => {
  const included: string[] = [];
  if (!existsSync(sourceRoot)) {
    return included;
  }

  const walk = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const sourcePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(sourcePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const relativePath = safeZipPath(relative(sourceRoot, sourcePath));
      const zipPath = safeZipPath(`${zipRoot}/${relativePath}`);
      if (addFileToZip(files, zipPath, sourcePath)) {
        included.push(zipPath);
      }
    }
  };

  walk(sourceRoot);
  return included;
};

const exportPlaylists = () => {
  const service = getLibraryService();
  const playlists = service.getPlaylists();
  return playlists.map((playlist) => ({
    playlist,
    items: service.getPlaylistItems(playlist.id, { page: 1, pageSize: maxPlaylistExportItems }).items,
  }));
};

const createRestoreReadme = (): string => `# ECHO Next data package

This package is an export-only migration bundle.

What is inside:
- app/settings.json: current ECHO Next settings.
- library/echo-library.sqlite: library index snapshot, including playlists and local library metadata.
- library/playlists.json: playlist metadata plus a readable item snapshot.
- cache/cover-cache.json: configured cover cache location and inventory summary.
- accounts/status.json: account connection status only. Raw login cookies and tokens are not exported.

Restore entry:
1. Open ECHO Next Settings.
2. Use General / Settings Backup to import app/settings.json when only settings are needed.
3. Use Danger / Database Recovery to create a fresh backup before replacing or restoring the library database.
4. Keep this zip untouched until the restored library has been opened and checked.

Music files are not copied into this package.
`;

export const exportEchoDataPackage = async (outputPath: string): Promise<DataPackageExportResult> => {
  const exportedAt = new Date().toISOString();
  const warnings: string[] = [];
  const files: ZipFiles = {};
  const userDataPath = app.getPath('userData');
  const libraryService = getLibraryService();
  const settings = getAppSettings();
  const snapshot = await createDataProtectionSnapshot('manual-library-database-snapshot', userDataPath);
  const dataProtection = getLastDataProtectionResult();
  const coverCacheDir = libraryService.getCoverCacheDir();
  const diagnostics = libraryService.getDiagnostics();
  const databasePath = join(snapshot.snapshotPath, 'echo-library.sqlite');
  const databaseHealth = existsSync(databasePath) ? checkDatabaseHealth(databasePath) : snapshot.libraryHealth;
  const includedEntries: string[] = [];
  const skippedEntries = [...snapshot.skipped];

  files['manifest.json'] = toZipText({
    format: dataPackageFormat,
    version: dataPackageVersion,
    exportedAt,
    appName: app.getName(),
    appVersion: app.getVersion(),
    userDataPath,
    restoreEntry: {
      settingsFile: 'app/settings.json',
      databaseSnapshot: 'library/echo-library.sqlite',
      instructions: 'RESTORE.md',
      settingsImport: 'Settings > General > Settings Backup > Import Settings',
      databaseRecovery: 'Settings > Danger > Recovery Assistant',
    },
    snapshot: {
      sourcePath: snapshot.snapshotPath,
      libraryHealth: snapshot.libraryHealth,
      libraryBackupMethod: snapshot.libraryBackupMethod,
      copied: snapshot.copied,
      skipped: snapshot.skipped,
    },
    dataProtection: dataProtection
      ? {
          recovery: dataProtection.recovery,
          libraryHealth: dataProtection.libraryHealth,
        }
      : null,
  });
  files['RESTORE.md'] = toZipMarkdown(createRestoreReadme());
  files['app/settings.json'] = toZipText(settings);
  files['app/settings-backup.json'] = toZipText({
    format: 'echo-next-settings-backup',
    version: 1,
    exportedAt,
    appVersion: app.getVersion(),
    settings,
  });
  files['accounts/status.json'] = toZipText({
    exportedAt,
    note: 'Only connection state is exported here. Login secrets are intentionally excluded.',
    statuses: getAccountService().getStatuses(),
    sanitizedRecords: getAccountService().getSanitizedRecords(),
  });
  files['cache/cover-cache.json'] = toZipText({
    exportedAt,
    configuredCoverCacheDir: settings.coverCacheDir,
    activeCoverCacheDir: coverCacheDir,
    diagnostics: {
      coverCachePath: diagnostics.coverCachePath,
      coverCacheSizeBytes: diagnostics.coverCacheSizeBytes,
      coverCacheVersion: diagnostics.coverCacheVersion,
    },
  });
  files['library/diagnostics.json'] = toZipText({
    exportedAt,
    diagnostics,
    databaseHealth,
  });

  try {
    files['library/playlists.json'] = toZipText({
      exportedAt,
      maxItemsPerPlaylist: maxPlaylistExportItems,
      playlists: exportPlaylists(),
    });
  } catch (error) {
    warnings.push(`Playlist export failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const name of ['echo-library.sqlite', 'echo-library.sqlite-wal', 'echo-library.sqlite-shm', 'snapshot.json']) {
    const sourcePath = join(snapshot.snapshotPath, name);
    if (addFileToZip(files, `library/${name}`, sourcePath)) {
      includedEntries.push(`library/${name}`);
    } else {
      skippedEntries.push(name);
    }
  }

  includedEntries.push(...addDirectoryToZip(files, 'app/app-wallpapers', join(snapshot.snapshotPath, 'app-wallpapers')));
  includedEntries.push(...addDirectoryToZip(files, 'app/lyrics-wallpapers', join(snapshot.snapshotPath, 'lyrics-wallpapers')));

  const zipBytes = zipSync(files as Zippable, { level: 6 });
  writeFileSync(outputPath, Buffer.from(zipBytes));

  return {
    filePath: outputPath,
    exportedAt,
    snapshotPath: snapshot.snapshotPath,
    includedEntries: Object.keys(files).sort(),
    skippedEntries: Array.from(new Set(skippedEntries)).sort(),
    warnings,
  };
};
