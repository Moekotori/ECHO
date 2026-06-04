import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import {
  copyFile as copyFileAsync,
  cp as cpAsync,
  mkdir as mkdirAsync,
  readFile as readFileAsync,
  readdir as readdirAsync,
  rm as rmAsync,
  stat as statAsync,
  writeFile as writeFileAsync,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import {
  checkDatabaseHealth,
  checkpointWal,
  type DatabaseHealthResult,
} from '../database/health';
import { markStartupStage } from '../diagnostics/StartupDiagnostics';
import { beginMainBackgroundTask } from '../diagnostics/PlaybackPerformanceDiagnostics';
import type {
  LibraryDatabaseArchiveInfo,
  LibraryDatabaseDeleteResult,
  LibraryDatabaseDiscardProblemTracksResult,
  LibraryDatabaseMaintenanceEventInfo,
  LibraryDatabasePoisonReport,
  LibraryDatabaseProtectionStatus,
  LibraryDatabaseProtectionStatusOptions,
  LibraryDatabaseRepairResult,
  LibraryDatabaseRestoreResult,
  LibraryDatabaseScrubResult,
  LibraryDatabaseSnapshotInfo,
  LibraryScanStatus,
} from '../../shared/types/library';
import { buildTrackSearchTerms } from '../library/SearchIndexTokens';

type DataProtectionReason = 'startup' | 'update-install' | 'manual-library-database-snapshot' | 'scan-completed-library-snapshot';
type ProtectedEntryKind = 'file' | 'directory';

type ProtectedEntry = {
  name: string;
  kind: ProtectedEntryKind;
};

type SnapshotResult = {
  snapshotPath: string;
  copied: string[];
  skipped: string[];
  libraryHealth: DatabaseHealthResult;
  libraryBackupMethod: 'none' | 'sqlite-backup' | 'file-copy';
};

type LibraryDatabaseSnapshotSignature = {
  databaseSizeBytes: number | null;
  databaseMtimeMs: number | null;
  walSizeBytes: number | null;
  walMtimeMs: number | null;
  shmSizeBytes: number | null;
  shmMtimeMs: number | null;
};

type SnapshotManifest = {
  reason?: string;
  createdAt?: string;
  copied?: string[];
  skipped?: string[];
  libraryHealth?: DatabaseHealthResult;
  libraryBackupMethod?: string;
} & Partial<LibraryDatabaseSnapshotSignature>;

export type DeferredStartupSnapshotDecision = {
  shouldCreate: boolean;
  reason:
    | 'recent-scan-snapshot'
    | 'recent-startup-snapshot'
    | 'unchanged-database'
    | 'no-comparable-snapshot'
    | 'legacy-snapshot-missing-signature'
    | 'latest-snapshot-unhealthy'
    | 'database-changed'
    | 'recent-startup-snapshot-expired';
  snapshotCount: number;
  currentSignature: LibraryDatabaseSnapshotSignature;
  snapshotId?: string;
};

type RestoreResult = {
  restored: string[];
  skipped: string[];
};

type LibraryDatabaseMaintenanceEvent = {
  createdAt: string;
  action:
    | 'manual-repair'
    | 'manual-delete'
    | 'manual-restore'
    | 'manual-scrub-quarantined'
    | 'manual-discard-quarantined'
    | 'startup-protected'
    | 'startup-poisoned'
    | 'startup-auto-repair'
    | 'scan-health-failed'
    | 'scan-auto-restore';
  databasePath: string;
  archivePath?: string | null;
  removedDatabaseFiles?: string[];
  restoredSnapshotId?: string;
  health?: DatabaseHealthResult;
  poisonReport?: LibraryDatabasePoisonReport;
  scan?: {
    jobId: string;
    folderId: string;
    phase: string;
    totalFiles: number;
    processedFiles: number;
    skippedFiles: number;
    addedTracks: number;
    updatedTracks: number;
    removedTracks: number;
    errorCount: number;
  };
  error?: string;
};

type LegacyMigrationResult = {
  sourcePath: string | null;
  migrated: string[];
  skipped: string[];
};

type DataProtectionPhaseScope = 'startup' | 'background';

type DataProtectionPhaseContext = {
  scope: DataProtectionPhaseScope;
  beforePhase?: (phase: string) => Promise<void>;
};

export type LibraryDatabaseScanGuardSnapshot = {
  id: string;
  path: string;
  databasePath: string;
  createdAt: string;
  scanJobId: string;
  folderId: string;
  libraryHealth: DatabaseHealthResult;
};

export type LibraryDatabaseScanGuardRestoreResult = {
  databasePath: string;
  archivePath: string | null;
  restoredSnapshotId: string;
  restoredDatabaseFiles: string[];
  health: DatabaseHealthResult;
};

export type LibraryRecoveryResult = {
  action: 'none' | 'protected' | 'archivedOnly' | 'quarantined' | 'autoRestoredFromScanGuard' | 'failed';
  sourceSnapshotPath?: string;
  scanGuardSnapshotId?: string;
  archivePath?: string;
  health: DatabaseHealthResult;
  poisonReport?: LibraryDatabasePoisonReport;
};

export type DataProtectionResult = {
  userDataPath: string;
  migration: LegacyMigrationResult;
  snapshot: SnapshotResult;
  restore: RestoreResult;
  libraryHealth: DatabaseHealthResult;
  recovery: LibraryRecoveryResult;
};

export class LibraryDatabaseUnavailableError extends Error {
  constructor(readonly recovery: LibraryRecoveryResult | null = lastDataProtectionResult?.recovery ?? null) {
    super(
      recovery?.action === 'protected' ||
        recovery?.action === 'archivedOnly' ||
        recovery?.action === 'quarantined' ||
        recovery?.action === 'failed'
        ? '音乐库数据库未通过健康检查，ECHO Next 已进入保护模式。音乐文件不会被删除，请前往设置里的数据库恢复工具处理。'
        : '音乐库数据库暂时不可用。请稍后重试或前往设置里的数据库恢复工具处理。',
    );
    this.name = 'LibraryDatabaseUnavailableError';
  }
}

type UserDataScore = {
  path: string;
  score: number;
  protectedFiles: number;
  librarySize: number;
  hasSettings: boolean;
};

type ElectronPathName = Parameters<typeof app.getPath>[0];

type ElectronAppLike = {
  getName?: () => string;
  getPath: (name: ElectronPathName) => string;
  getVersion?: () => string;
  setPath?: (name: ElectronPathName, path: string) => void;
};

const protectedUserDataFolderName = 'ECHO NEXT';
const legacyUserDataFolderNames = ['echo-next', 'ECHO Next', 'ECHO'];
const dataProtectionDirectoryName = 'data-protection';
const snapshotDirectoryName = 'snapshots';
const scanGuardDirectoryName = 'scan-guards';
const corruptArchivesDirectoryName = 'corrupt-archives';
const manifestFileName = 'echo-data-protection.json';
const libraryMaintenanceFileName = 'library-database-maintenance.json';
const maxSnapshots = 5;
const maxLibraryMaintenanceEvents = 20;
const libraryFileName = 'echo-library.sqlite';
const libraryWalFileName = `${libraryFileName}-wal`;
const libraryShmFileName = `${libraryFileName}-shm`;
const libraryEntryNames = new Set([libraryFileName, libraryWalFileName, libraryShmFileName]);
const dataProtectionPhaseLogThresholdMs = 100;
const dataProtectionPhaseSlowThresholdMs = 750;
const startupBackgroundProtectionPlaybackGraceMs = 45_000;
const backgroundProtectionPlaybackStopGraceMs = 60_000;
const startupBackgroundProtectionPausePollMs = 2_500;

export const protectedDataEntries: ProtectedEntry[] = [
  { name: 'echo-settings.json', kind: 'file' },
  { name: 'echo-library.sqlite', kind: 'file' },
  { name: 'echo-library.sqlite-wal', kind: 'file' },
  { name: 'echo-library.sqlite-shm', kind: 'file' },
  { name: 'accounts.json', kind: 'file' },
  { name: 'echo-download-settings.json', kind: 'file' },
  { name: 'echo-playback-memory.json', kind: 'file' },
  { name: 'eq-presets.json', kind: 'file' },
  { name: 'app-wallpapers', kind: 'directory' },
  { name: 'lyrics-wallpapers', kind: 'directory' },
];

const timestampForPath = (date = new Date()): string => date.toISOString().replace(/[:.]/g, '-');

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const yieldToMainLoop = (): Promise<void> => new Promise((resolve) => {
  setImmediate(resolve);
});

const normalizeDataProtectionPhaseName = (phase: string): string =>
  phase
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'step';

const logDataProtectionPhaseDuration = (
  context: DataProtectionPhaseContext | undefined,
  phase: string,
  startedAtMs: number,
): void => {
  if (!context) {
    return;
  }

  const durationMs = Math.max(0, Math.round(Date.now() - startedAtMs));
  if (durationMs < dataProtectionPhaseLogThresholdMs) {
    return;
  }

  const slow = durationMs >= dataProtectionPhaseSlowThresholdMs;
  const stage = `data-protection:${context.scope}:phase:${normalizeDataProtectionPhaseName(phase)}${slow ? ':slow' : ''}`;
  const details = { phase, durationMs, slow };
  markStartupStage(stage, details);

  const message = `[data-protection] ${context.scope} ${phase} ${durationMs}ms${slow ? ' SLOW' : ''}`;
  if (slow) {
    console.warn(message);
  } else {
    console.info(message);
  }
};

const runDataProtectionPhase = async <T>(
  context: DataProtectionPhaseContext | undefined,
  phase: string,
  run: () => Promise<T>,
): Promise<T> => {
  await context?.beforePhase?.(phase);
  const clearBackgroundTask = context?.scope === 'background' ? beginMainBackgroundTask(`data-protection:${phase}`) : null;
  const startedAtMs = Date.now();
  try {
    return await run();
  } finally {
    logDataProtectionPhaseDuration(context, phase, startedAtMs);
    clearBackgroundTask?.();
  }
};

const runDataProtectionPhaseSync = <T>(
  context: DataProtectionPhaseContext | undefined,
  phase: string,
  run: () => T,
): T => {
  const startedAtMs = Date.now();
  try {
    return run();
  } finally {
    logDataProtectionPhaseDuration(context, phase, startedAtMs);
  }
};

const runDataProtectionBlockingPhase = async <T>(
  context: DataProtectionPhaseContext | undefined,
  phase: string,
  run: () => T,
): Promise<T> => {
  await context?.beforePhase?.(phase);
  const clearBackgroundTask = context?.scope === 'background' ? beginMainBackgroundTask(`data-protection:${phase}`) : null;
  try {
    return runDataProtectionPhaseSync(context, phase, run);
  } finally {
    clearBackgroundTask?.();
  }
};

let backgroundProtectionPlaybackQuietUntilMs = 0;
let backgroundProtectionPlaybackPauseLogged = false;
let backgroundProtectionPlaybackActive = false;
let backgroundProtectionPlaybackStateProvider: (() => boolean) | null = null;

export const setDataProtectionPlaybackStateProvider = (provider: (() => boolean) | null): void => {
  backgroundProtectionPlaybackStateProvider = provider;
  if (!provider) {
    backgroundProtectionPlaybackActive = false;
    backgroundProtectionPlaybackQuietUntilMs = 0;
    backgroundProtectionPlaybackPauseLogged = false;
  }
};

export const noteDataProtectionPlaybackActivity = (active: boolean, nowMs = Date.now()): void => {
  if (active) {
    backgroundProtectionPlaybackActive = true;
    backgroundProtectionPlaybackQuietUntilMs = Math.max(
      backgroundProtectionPlaybackQuietUntilMs,
      nowMs + startupBackgroundProtectionPlaybackGraceMs,
    );
    backgroundProtectionPlaybackPauseLogged = false;
    return;
  }

  backgroundProtectionPlaybackActive = false;
  backgroundProtectionPlaybackQuietUntilMs = nowMs + backgroundProtectionPlaybackStopGraceMs;
};

const isBackgroundProtectionPlaybackBlocked = (nowMs = Date.now()): boolean => {
  const realtimePlaybackActive = backgroundProtectionPlaybackStateProvider?.() === true;
  if (realtimePlaybackActive) {
    backgroundProtectionPlaybackActive = true;
    backgroundProtectionPlaybackQuietUntilMs = Math.max(
      backgroundProtectionPlaybackQuietUntilMs,
      nowMs + backgroundProtectionPlaybackStopGraceMs,
    );
    return true;
  }

  if (backgroundProtectionPlaybackStateProvider) {
    backgroundProtectionPlaybackActive = false;
    backgroundProtectionPlaybackQuietUntilMs = Math.min(
      backgroundProtectionPlaybackQuietUntilMs,
      nowMs + backgroundProtectionPlaybackStopGraceMs,
    );
  }

  return backgroundProtectionPlaybackActive || nowMs < backgroundProtectionPlaybackQuietUntilMs;
};

const waitForBackgroundProtectionSlot = async (phase: string): Promise<void> => {
  await yieldToMainLoop();

  while (isBackgroundProtectionPlaybackBlocked()) {
    const remainingMs = Math.max(0, Math.round(backgroundProtectionPlaybackQuietUntilMs - Date.now()));
    if (!backgroundProtectionPlaybackPauseLogged) {
      backgroundProtectionPlaybackPauseLogged = true;
      markStartupStage('data-protection:background:paused-for-playback', {
        phase,
        playbackActive: backgroundProtectionPlaybackActive,
        remainingMs,
      });
    }
    await delay(Math.min(startupBackgroundProtectionPausePollMs, Math.max(250, remainingMs || startupBackgroundProtectionPausePollMs)));
  }
};

export const waitForDataProtectionBackgroundSlotForTest = waitForBackgroundProtectionSlot;
export const isDataProtectionBackgroundPlaybackBlockedForTest = isBackgroundProtectionPlaybackBlocked;

const safeReadJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

const safeReadJsonAsync = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFileAsync(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

const getLibraryMaintenancePath = (userDataPath: string): string => join(getDataProtectionPath(userDataPath), libraryMaintenanceFileName);

const readLibraryDatabaseMaintenanceEvents = (userDataPath: string): LibraryDatabaseMaintenanceEvent[] => {
  const value = safeReadJson<{ events?: LibraryDatabaseMaintenanceEvent[] }>(getLibraryMaintenancePath(userDataPath));
  return Array.isArray(value?.events) ? value.events : [];
};

export const recordLibraryDatabaseMaintenanceEvent = (
  event: Omit<LibraryDatabaseMaintenanceEvent, 'createdAt'>,
  userDataPath = app.getPath('userData'),
): void => {
  try {
    const events = [
      ...readLibraryDatabaseMaintenanceEvents(userDataPath),
      { ...event, createdAt: new Date().toISOString() },
    ].slice(-maxLibraryMaintenanceEvents);
    const filePath = getLibraryMaintenancePath(userDataPath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify({ formatVersion: 1, events }, null, 2)}\n`, 'utf8');
  } catch {
    // Diagnostics breadcrumbs must never block app recovery.
  }
};

export const getLibraryDatabaseMaintenanceReport = (userDataPath = app.getPath('userData')): {
  events: LibraryDatabaseMaintenanceEvent[];
} => ({
  events: readLibraryDatabaseMaintenanceEvents(userDataPath),
});

export const getProtectedUserDataPath = (electronApp: ElectronAppLike = app): string => {
  const appDataPath = electronApp.getPath('appData');
  return join(appDataPath, protectedUserDataFolderName);
};

export const initializeProtectedUserDataPath = (electronApp: ElectronAppLike = app): string => {
  const protectedUserDataPath = getProtectedUserDataPath(electronApp);
  mkdirSync(protectedUserDataPath, { recursive: true });

  if (electronApp.setPath && electronApp.getPath('userData') !== protectedUserDataPath) {
    electronApp.setPath('userData', protectedUserDataPath);
  }

  return protectedUserDataPath;
};

const getDataProtectionPath = (userDataPath: string): string => join(userDataPath, dataProtectionDirectoryName);
const getSnapshotsPath = (userDataPath: string): string => join(getDataProtectionPath(userDataPath), snapshotDirectoryName);
const getScanGuardsPath = (userDataPath: string): string => join(getDataProtectionPath(userDataPath), scanGuardDirectoryName);
const getCorruptArchivesPath = (userDataPath: string): string => join(getDataProtectionPath(userDataPath), corruptArchivesDirectoryName);
const getLegacyUserDataPaths = (electronApp: ElectronAppLike = app): string[] => {
  const appDataPath = electronApp.getPath('appData');
  const protectedPath = getProtectedUserDataPath(electronApp).toLocaleLowerCase();

  return legacyUserDataFolderNames
    .map((folderName) => join(appDataPath, folderName))
    .filter((legacyPath, index, paths) => legacyPath.toLocaleLowerCase() !== protectedPath && paths.indexOf(legacyPath) === index);
};

const copyProtectedEntry = (sourcePath: string, targetPath: string, kind: ProtectedEntryKind): void => {
  mkdirSync(dirname(targetPath), { recursive: true });
  if (kind === 'directory') {
    cpSync(sourcePath, targetPath, { recursive: true, force: true, errorOnExist: false });
  } else {
    copyFileSync(sourcePath, targetPath);
  }
};

const copyProtectedEntryAsync = async (sourcePath: string, targetPath: string, kind: ProtectedEntryKind): Promise<void> => {
  await mkdirAsync(dirname(targetPath), { recursive: true });
  if (kind === 'directory') {
    await cpAsync(sourcePath, targetPath, { recursive: true, force: true, errorOnExist: false });
    return;
  }

  await copyFileAsync(sourcePath, targetPath);
};

const listSnapshotPaths = (userDataPath: string): string[] => {
  const snapshotsPath = getSnapshotsPath(userDataPath);
  if (!existsSync(snapshotsPath)) {
    return [];
  }

  return readdirSync(snapshotsPath)
    .map((entry) => join(snapshotsPath, entry))
    .filter((entryPath) => {
      try {
        return statSync(entryPath).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse();
};

const listSnapshotPathsAsync = async (userDataPath: string): Promise<string[]> => {
  const snapshotsPath = getSnapshotsPath(userDataPath);
  if (!existsSync(snapshotsPath)) {
    return [];
  }

  const entries = await readdirAsync(snapshotsPath);
  const paths: string[] = [];
  for (const entry of entries) {
    const entryPath = join(snapshotsPath, entry);
    try {
      if ((await statAsync(entryPath)).isDirectory()) {
        paths.push(entryPath);
      }
    } catch {
      // Ignore entries that disappear while pruning snapshots.
    }
  }

  return paths.sort().reverse();
};

const checkLibraryFastStartupHealth = (userDataPath: string): DatabaseHealthResult => {
  const databasePath = libraryPathFor(userDataPath);
  const checkedAt = new Date().toISOString();

  if (!existsSync(databasePath)) {
    if (existsSync(getSnapshotsPath(userDataPath))) {
      return {
        status: 'unreadable',
        databasePath,
        checkedAt,
        message: 'library database is missing while protected snapshots may be available',
      };
    }

    return {
      status: 'ok',
      databasePath,
      checkedAt,
      message: 'database does not exist yet',
    };
  }

  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    database.pragma('schema_version');
    const tracksTable = database
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracks' LIMIT 1")
      .get();

    if (!tracksTable) {
      return {
        status: 'unreadable',
        databasePath,
        checkedAt,
        message: 'library database is missing the tracks table',
      };
    }

    database.prepare('SELECT 1 FROM tracks LIMIT 1').get();
    return {
      status: 'ok',
      databasePath,
      checkedAt,
      message: 'fast startup deferred full data protection',
    };
  } catch (error) {
    return {
      status: 'unreadable',
      databasePath,
      checkedAt,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      database?.close();
    } catch {
      // Ignore close errors while reporting the lightweight startup result.
    }
  }
};

const pruneOldSnapshots = (userDataPath: string): void => {
  for (const snapshotPath of listSnapshotPaths(userDataPath).slice(maxSnapshots)) {
    rmSync(snapshotPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};

const pruneOldSnapshotsAsync = async (userDataPath: string): Promise<void> => {
  for (const snapshotPath of (await listSnapshotPathsAsync(userDataPath)).slice(maxSnapshots)) {
    await rmAsync(snapshotPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};

const listScanGuardPaths = (userDataPath: string): string[] => {
  const scanGuardsPath = getScanGuardsPath(userDataPath);
  if (!existsSync(scanGuardsPath)) {
    return [];
  }

  return readdirSync(scanGuardsPath)
    .map((entry) => join(scanGuardsPath, entry))
    .filter((entryPath) => {
      try {
        return statSync(entryPath).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse();
};

const pruneOldScanGuards = (userDataPath: string): void => {
  for (const snapshotPath of listScanGuardPaths(userDataPath).slice(3)) {
    rmSync(snapshotPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};

const libraryPathFor = (rootPath: string): string => join(rootPath, libraryFileName);
const libraryWalPathFor = (rootPath: string): string => join(rootPath, libraryWalFileName);
const libraryShmPathFor = (rootPath: string): string => join(rootPath, libraryShmFileName);

const skippedSnapshot = (libraryHealth: DatabaseHealthResult): SnapshotResult => ({
  snapshotPath: '',
  copied: [],
  skipped: protectedDataEntries.map((entry) => entry.name),
  libraryHealth,
  libraryBackupMethod: 'none',
});

const copyLibraryTriplet = (sourceRoot: string, targetRoot: string): string[] => {
  const copied: string[] = [];
  for (const name of [libraryFileName, libraryWalFileName, libraryShmFileName]) {
    const sourcePath = join(sourceRoot, name);
    if (!existsSync(sourcePath)) {
      continue;
    }
    try {
      copyProtectedEntry(sourcePath, join(targetRoot, name), 'file');
      copied.push(name);
    } catch {
      // A failed archive/snapshot copy should not block the rest of startup.
    }
  }
  return copied;
};

const copyLibraryTripletAsync = async (sourceRoot: string, targetRoot: string): Promise<string[]> => {
  const copied: string[] = [];
  for (const name of [libraryFileName, libraryWalFileName, libraryShmFileName]) {
    const sourcePath = join(sourceRoot, name);
    if (!existsSync(sourcePath)) {
      continue;
    }
    try {
      await copyProtectedEntryAsync(sourcePath, join(targetRoot, name), 'file');
      copied.push(name);
    } catch {
      // A failed archive/snapshot copy should not block the rest of startup.
    }
  }
  return copied;
};

type LibraryTripletRemoveResult = {
  removed: string[];
  failed: Array<{ name: string; path: string; message: string }>;
};

const tryRemoveLibraryTriplet = (rootPath: string): LibraryTripletRemoveResult => {
  const result: LibraryTripletRemoveResult = { removed: [], failed: [] };
  for (const name of [libraryFileName, libraryWalFileName, libraryShmFileName]) {
    const filePath = join(rootPath, name);
    if (!existsSync(filePath)) {
      continue;
    }
    try {
      rmSync(filePath, { force: true, maxRetries: 5, retryDelay: 100 });
      result.removed.push(name);
    } catch (error) {
      result.failed.push({
        name,
        path: filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
};

const describeRemoveLibraryTripletFailure = (result: LibraryTripletRemoveResult): string =>
  result.failed.map((item) => `${item.name}: ${item.message}`).join('; ');

const removeLibraryTriplet = (rootPath: string): void => {
  const result = tryRemoveLibraryTriplet(rootPath);
  if (result.failed.length > 0) {
    throw new Error(`Failed to remove active library database files: ${describeRemoveLibraryTripletFailure(result)}`);
  }
};

const maxProtectedDisplayTextLength = 512;
const maxProtectedSearchTextLength = 4096;
const maxProtectedDiagnosticTextLength = 128 * 1024;
const poisonBinaryMarkerPattern = /(?:APIC|image\/(?:jpeg|jpg|png|webp|gif)|JFIF|Exif|\u0000)/iu;
const textFieldsToInspect: Array<{ table: string; column: string; maxLength: number; blocksStartup?: boolean }> = [
  { table: 'tracks', column: 'title', maxLength: maxProtectedDisplayTextLength },
  { table: 'tracks', column: 'artist', maxLength: maxProtectedDisplayTextLength },
  { table: 'tracks', column: 'album', maxLength: maxProtectedDisplayTextLength },
  { table: 'tracks', column: 'album_artist', maxLength: maxProtectedDisplayTextLength },
  { table: 'tracks', column: 'genre', maxLength: maxProtectedDisplayTextLength },
  { table: 'tracks', column: 'codec', maxLength: 128 },
  { table: 'tracks', column: 'search_terms', maxLength: maxProtectedSearchTextLength },
  { table: 'albums', column: 'title', maxLength: maxProtectedDisplayTextLength },
  { table: 'albums', column: 'album_artist', maxLength: maxProtectedDisplayTextLength },
  { table: 'artists', column: 'name', maxLength: maxProtectedDisplayTextLength },
  { table: 'artists', column: 'sort_name', maxLength: maxProtectedDisplayTextLength },
  { table: 'scan_jobs', column: 'errors_json', maxLength: maxProtectedDiagnosticTextLength, blocksStartup: false },
  { table: 'covers', column: 'warnings_json', maxLength: maxProtectedDiagnosticTextLength, blocksStartup: false },
  { table: 'covers', column: 'errors_json', maxLength: maxProtectedDiagnosticTextLength, blocksStartup: false },
];

const quoteSqlIdentifier = (value: string): string => `"${value.replace(/"/gu, '""')}"`;

const safeTableColumns = (database: Database.Database, tableName: string): Set<string> => {
  try {
    const rows = database.prepare<[], { name: string }>(`PRAGMA table_info(${quoteSqlIdentifier(tableName)})`).all();
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
};

const inspectTextColumnForPoison = (
  database: Database.Database,
  tableName: string,
  columnName: string,
  maxLength: number,
): { maxLength: number; suspectCount: number; oversizedCount: number; binaryMarkerCount: number } => {
  const table = quoteSqlIdentifier(tableName);
  const column = quoteSqlIdentifier(columnName);
  const row = database
    .prepare<[], { max_length: number | null; suspect_count: number | null; oversized_count: number | null; binary_marker_count: number | null }>(
      `SELECT
         MAX(LENGTH(${column})) AS max_length,
         SUM(CASE WHEN ${column} IS NOT NULL AND (
           LENGTH(${column}) > ${maxLength}
           OR INSTR(${column}, char(0)) > 0
           OR lower(${column}) LIKE '%apic%'
           OR lower(${column}) LIKE '%image/jpeg%'
           OR lower(${column}) LIKE '%image/jpg%'
           OR lower(${column}) LIKE '%image/png%'
           OR lower(${column}) LIKE '%image/webp%'
           OR lower(${column}) LIKE '%jfif%'
           OR lower(${column}) LIKE '%exif%'
         ) THEN 1 ELSE 0 END) AS suspect_count,
         SUM(CASE WHEN ${column} IS NOT NULL AND LENGTH(${column}) > ${maxLength} THEN 1 ELSE 0 END) AS oversized_count,
         SUM(CASE WHEN ${column} IS NOT NULL AND (
           INSTR(${column}, char(0)) > 0
           OR lower(${column}) LIKE '%apic%'
           OR lower(${column}) LIKE '%image/jpeg%'
           OR lower(${column}) LIKE '%image/jpg%'
           OR lower(${column}) LIKE '%image/png%'
           OR lower(${column}) LIKE '%image/webp%'
           OR lower(${column}) LIKE '%jfif%'
           OR lower(${column}) LIKE '%exif%'
         ) THEN 1 ELSE 0 END) AS binary_marker_count
       FROM ${table}`,
    )
    .get();

  return {
    maxLength: Number(row?.max_length ?? 0),
    suspectCount: Number(row?.suspect_count ?? 0),
    oversizedCount: Number(row?.oversized_count ?? 0),
    binaryMarkerCount: Number(row?.binary_marker_count ?? 0),
  };
};

const okPoisonReport = (databasePath: string): LibraryDatabasePoisonReport => ({
  status: 'ok',
  reason: 'none',
  checkedAt: new Date().toISOString(),
  databasePath,
  suspectCounts: {},
  maxFieldLengths: {},
});

export const inspectLibraryDatabaseForPoison = (databasePath: string): LibraryDatabasePoisonReport => {
  if (!existsSync(databasePath)) {
    return okPoisonReport(databasePath);
  }

  const health = checkDatabaseHealth(databasePath);
  if (health.status !== 'ok') {
    return {
      status: health.status === 'corrupt' ? 'poisoned' : 'unreadable',
      reason: 'corrupt_database',
      checkedAt: health.checkedAt,
      databasePath,
      suspectCounts: {},
      maxFieldLengths: {},
      message: health.message,
    };
  }

  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    const columnsByTable = new Map<string, Set<string>>();
    const suspectCounts: Record<string, number> = {};
    const maxFieldLengths: Record<string, number> = {};
    let totalSuspects = 0;
    let totalOversized = 0;
    let totalBinaryMarkers = 0;

    for (const field of textFieldsToInspect) {
      let columns = columnsByTable.get(field.table);
      if (!columns) {
        columns = safeTableColumns(database, field.table);
        columnsByTable.set(field.table, columns);
      }
      if (!columns.has(field.column)) {
        continue;
      }

      const result = inspectTextColumnForPoison(database, field.table, field.column, field.maxLength);
      const key = `${field.table}.${field.column}`;
      if (result.maxLength > 0) {
        maxFieldLengths[key] = result.maxLength;
      }
      if (result.suspectCount > 0 && field.blocksStartup !== false) {
        suspectCounts[key] = result.suspectCount;
      }
      if (field.blocksStartup !== false) {
        totalSuspects += result.suspectCount;
        totalOversized += result.oversizedCount;
        totalBinaryMarkers += result.binaryMarkerCount;
      }
    }

    if (totalSuspects === 0) {
      return {
        ...okPoisonReport(databasePath),
        maxFieldLengths,
      };
    }

    return {
      status: 'poisoned',
      reason: totalBinaryMarkers > 0 ? 'poisoned_metadata' : totalOversized > 0 ? 'oversized_payload' : 'poisoned_metadata',
      checkedAt: new Date().toISOString(),
      databasePath,
      suspectCounts,
      maxFieldLengths,
      message: `Detected ${totalSuspects} unsafe library text payload(s).`,
    };
  } catch (error) {
    return {
      status: 'unreadable',
      reason: 'corrupt_database',
      checkedAt: new Date().toISOString(),
      databasePath,
      suspectCounts: {},
      maxFieldLengths: {},
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      database?.close();
    } catch {
      // Ignore close errors while reporting the original poison check result.
    }
  }
};

const normalizeProtectedTextWhitespace = (text: string): string =>
  text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim();

const countProtectedControlCharacters = (text: string): number => {
  let count = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0x00 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      count += 1;
    }
  }
  return count;
};

const isUnsafeProtectedText = (text: string, maxLength: number): boolean => {
  if (!text || text.length > maxLength || poisonBinaryMarkerPattern.test(text)) {
    return true;
  }

  const controlCount = countProtectedControlCharacters(text);
  return controlCount >= 8 || controlCount / Math.max(1, text.length) > 0.02;
};

const safeProtectedText = (value: unknown, fallback: string, maxLength = maxProtectedDisplayTextLength): string => {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (isUnsafeProtectedText(raw, maxLength)) {
    return fallback;
  }

  const normalized = normalizeProtectedTextWhitespace(raw);
  return isUnsafeProtectedText(normalized, maxLength) ? fallback : normalized;
};

const safeProtectedNullableText = (value: unknown, maxLength = maxProtectedDisplayTextLength): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const sanitized = safeProtectedText(value, '', maxLength);
  return sanitized || null;
};

const filenameFallbackFromPath = (filePath: string): { title: string; artist: string | null } => {
  const name = basename(filePath).replace(/\.[^.\\/]+$/u, '').trim();
  const parts = name.split(' - ').map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return { artist: parts[0], title: parts.slice(1).join(' - ') };
  }

  return { artist: null, title: name || 'Untitled' };
};

const compactJsonText = (value: unknown, maxLength = maxProtectedSearchTextLength): string => {
  if (typeof value !== 'string' || value.length <= maxLength && !isUnsafeProtectedText(value, maxLength)) {
    return typeof value === 'string' ? value : '[]';
  }

  const fitJsonArray = (items: string[]): string => {
    const output = [...items];
    let text = JSON.stringify(output);
    while (text.length > maxLength && output.length > 1) {
      output.pop();
      text = JSON.stringify(output);
    }
    if (text.length <= maxLength) {
      return text;
    }

    const allowance = Math.max(32, maxLength - 16);
    return JSON.stringify([output[0]?.slice(0, allowance) ?? '[unsafe payload removed]']).slice(0, maxLength);
  };

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      const items = parsed.filter((item): item is string => typeof item === 'string');
      return fitJsonArray([
        `[${items.length} diagnostic message(s) compacted]`,
        ...items
          .slice(0, 20)
          .map((item) => normalizeProtectedTextWhitespace(item).slice(0, 320) || '[empty diagnostic message]'),
      ]);
    }
  } catch {
    // Fall back to a compact placeholder below.
  }

  return JSON.stringify(['[unsafe payload removed]']);
};

const scrubTrackRows = (database: Database.Database): number => {
  const columns = safeTableColumns(database, 'tracks');
  if (!columns.has('rowid') && columns.size === 0) {
    return 0;
  }

  const wantedColumns = ['rowid', 'path', 'title', 'artist', 'album', 'album_artist', 'genre', 'codec', 'search_terms']
    .filter((column) => column === 'rowid' || columns.has(column));
  if (!wantedColumns.includes('rowid')) {
    wantedColumns.unshift('rowid');
  }

  let scrubbed = 0;
  const rows = database.prepare<[], Record<string, unknown>>(`SELECT ${wantedColumns.map(quoteSqlIdentifier).join(', ')} FROM tracks`).all();

  for (const row of rows) {
    const path = typeof row.path === 'string' ? row.path : '';
    const fallback = filenameFallbackFromPath(path);
    const next: Record<string, string | null> = {};

    if (columns.has('title')) {
      next.title = safeProtectedText(row.title, fallback.title);
    }
    if (columns.has('artist')) {
      next.artist = safeProtectedText(row.artist, fallback.artist ?? 'Unknown Artist');
    }
    if (columns.has('album')) {
      next.album = safeProtectedText(row.album, '');
    }
    if (columns.has('album_artist')) {
      next.album_artist = safeProtectedText(row.album_artist, next.artist ?? fallback.artist ?? 'Unknown Artist');
    }
    if (columns.has('genre')) {
      next.genre = safeProtectedNullableText(row.genre);
    }
    if (columns.has('codec')) {
      next.codec = safeProtectedNullableText(row.codec, 128);
    }
    if (columns.has('search_terms')) {
      next.search_terms = buildTrackSearchTerms({
        title: next.title ?? safeProtectedText(row.title, fallback.title),
        artist: next.artist ?? safeProtectedText(row.artist, fallback.artist ?? 'Unknown Artist'),
        album: next.album ?? safeProtectedText(row.album, ''),
        albumArtist: next.album_artist ?? safeProtectedText(row.album_artist, next.artist ?? fallback.artist ?? 'Unknown Artist'),
        genre: next.genre ?? safeProtectedNullableText(row.genre),
        path,
      });
    }

    const changed = Object.entries(next).some(([column, value]) => (row[column] ?? null) !== (value ?? null));
    if (!changed) {
      continue;
    }

    const assignments = Object.keys(next).map((column) => `${quoteSqlIdentifier(column)} = ?`).join(', ');
    database.prepare(`UPDATE tracks SET ${assignments} WHERE rowid = ?`).run(...Object.values(next), row.rowid);
    scrubbed += 1;
  }

  return scrubbed;
};

const scrubSimpleTextTable = (
  database: Database.Database,
  tableName: string,
  fields: Array<{ column: string; fallback: string; maxLength?: number }>,
): number => {
  const columns = safeTableColumns(database, tableName);
  const activeFields = fields.filter((field) => columns.has(field.column));
  if (activeFields.length === 0) {
    return 0;
  }

  let scrubbed = 0;
  const selectedColumns = ['rowid', ...activeFields.map((field) => field.column)];
  const rows = database.prepare<[], Record<string, unknown>>(`SELECT ${selectedColumns.map(quoteSqlIdentifier).join(', ')} FROM ${quoteSqlIdentifier(tableName)}`).all();

  for (const row of rows) {
    const next = Object.fromEntries(
      activeFields.map((field) => [
        field.column,
        safeProtectedText(row[field.column], field.fallback, field.maxLength ?? maxProtectedDisplayTextLength),
      ]),
    );
    const changed = Object.entries(next).some(([column, value]) => row[column] !== value);
    if (!changed) {
      continue;
    }

    const assignments = Object.keys(next).map((column) => `${quoteSqlIdentifier(column)} = ?`).join(', ');
    database.prepare(`UPDATE ${quoteSqlIdentifier(tableName)} SET ${assignments} WHERE rowid = ?`).run(...Object.values(next), row.rowid);
    scrubbed += 1;
  }

  return scrubbed;
};

const scrubJsonTextTable = (database: Database.Database, tableName: string, columnsToScrub: string[]): number => {
  const columns = safeTableColumns(database, tableName);
  const activeColumns = columnsToScrub.filter((column) => columns.has(column));
  if (activeColumns.length === 0) {
    return 0;
  }

  let scrubbed = 0;
  const rows = database.prepare<[], Record<string, unknown>>(`SELECT ${['rowid', ...activeColumns].map(quoteSqlIdentifier).join(', ')} FROM ${quoteSqlIdentifier(tableName)}`).all();

  for (const row of rows) {
    const next = Object.fromEntries(activeColumns.map((column) => [column, compactJsonText(row[column])]));
    const changed = Object.entries(next).some(([column, value]) => row[column] !== value);
    if (!changed) {
      continue;
    }

    const assignments = Object.keys(next).map((column) => `${quoteSqlIdentifier(column)} = ?`).join(', ');
    database.prepare(`UPDATE ${quoteSqlIdentifier(tableName)} SET ${assignments} WHERE rowid = ?`).run(...Object.values(next), row.rowid);
    scrubbed += 1;
  }

  return scrubbed;
};

const scrubDiagnosticLibraryText = (databasePath: string): number => {
  if (!existsSync(databasePath)) {
    return 0;
  }

  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, { fileMustExist: true });
    let scrubbedRows = 0;
    database.transaction(() => {
      scrubbedRows += scrubJsonTextTable(database!, 'scan_jobs', ['errors_json']);
      scrubbedRows += scrubJsonTextTable(database!, 'covers', ['warnings_json', 'errors_json']);
    })();
    if (scrubbedRows > 0) {
      try {
        database.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // The next health check will report any meaningful database issue.
      }
    }
    return scrubbedRows;
  } catch {
    return 0;
  } finally {
    try {
      database?.close();
    } catch {
      // Ignore close errors after best-effort diagnostic compaction.
    }
  }
};

const scrubNonTrackLibraryTables = (database: Database.Database): number => {
  let scrubbedRows = 0;
  scrubbedRows += scrubSimpleTextTable(database, 'albums', [
    { column: 'title', fallback: '' },
    { column: 'album_artist', fallback: 'Unknown Artist' },
  ]);
  scrubbedRows += scrubSimpleTextTable(database, 'artists', [
    { column: 'name', fallback: 'Unknown Artist' },
    { column: 'sort_name', fallback: 'Unknown Artist' },
  ]);
  scrubbedRows += scrubJsonTextTable(database, 'scan_jobs', ['errors_json']);
  scrubbedRows += scrubJsonTextTable(database, 'covers', ['warnings_json', 'errors_json']);
  return scrubbedRows;
};

const unsafeTextPredicate = (columnName: string, maxLength: number): string => {
  const column = quoteSqlIdentifier(columnName);
  return `${column} IS NOT NULL AND (
    LENGTH(${column}) > ${maxLength}
    OR INSTR(${column}, char(0)) > 0
    OR lower(${column}) LIKE '%apic%'
    OR lower(${column}) LIKE '%image/jpeg%'
    OR lower(${column}) LIKE '%image/jpg%'
    OR lower(${column}) LIKE '%image/png%'
    OR lower(${column}) LIKE '%image/webp%'
    OR lower(${column}) LIKE '%jfif%'
    OR lower(${column}) LIKE '%exif%'
  )`;
};

const compactDiscardArchiveValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = normalizeProtectedTextWhitespace(value);
  if (normalized.length <= 512 && !poisonBinaryMarkerPattern.test(normalized)) {
    return normalized;
  }

  return {
    sample: normalized.slice(0, 512),
    originalLength: value.length,
    unsafe: true,
  };
};

const tableHasColumn = (database: Database.Database, tableName: string, columnName: string): boolean =>
  safeTableColumns(database, tableName).has(columnName);

const deleteRowsByTrackIds = (database: Database.Database, tableName: string, columnName: string, trackIds: string[]): void => {
  if (trackIds.length === 0 || !tableHasColumn(database, tableName, columnName)) {
    return;
  }

  const placeholders = trackIds.map(() => '?').join(', ');
  database.prepare(`DELETE FROM ${quoteSqlIdentifier(tableName)} WHERE ${quoteSqlIdentifier(columnName)} IN (${placeholders})`).run(...trackIds);
};

const discardUnsafeTrackRows = (
  database: Database.Database,
): { discardedTracks: number; discardedTrackIds: string[]; archivedRows: Array<Record<string, unknown>> } => {
  const columns = safeTableColumns(database, 'tracks');
  if (columns.size === 0) {
    return { discardedTracks: 0, discardedTrackIds: [], archivedRows: [] };
  }

  const fields = textFieldsToInspect.filter((field) => field.table === 'tracks' && columns.has(field.column));
  const unsafeFieldsByRowId = new Map<number, Set<string>>();
  for (const field of fields) {
    const rows = database
      .prepare<[], { rowid: number }>(`SELECT rowid FROM tracks WHERE ${unsafeTextPredicate(field.column, field.maxLength)}`)
      .all();
    for (const row of rows) {
      const unsafeFields = unsafeFieldsByRowId.get(row.rowid) ?? new Set<string>();
      unsafeFields.add(field.column);
      unsafeFieldsByRowId.set(row.rowid, unsafeFields);
    }
  }

  const rowIds = [...unsafeFieldsByRowId.keys()];
  if (rowIds.length === 0) {
    return { discardedTracks: 0, discardedTrackIds: [], archivedRows: [] };
  }

  const selectedColumns = ['rowid', ...['id', 'path', 'title', 'artist', 'album', 'album_artist', 'genre', 'codec'].filter((column) => columns.has(column))];
  const placeholders = rowIds.map(() => '?').join(', ');
  const rows = database
    .prepare<number[], Record<string, unknown>>(
      `SELECT ${selectedColumns.map(quoteSqlIdentifier).join(', ')} FROM tracks WHERE rowid IN (${placeholders}) ORDER BY rowid ASC`,
    )
    .all(...rowIds);
  const archivedRows = rows.map((row) => ({
    unsafeFields: [...(unsafeFieldsByRowId.get(Number(row.rowid)) ?? [])],
    ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, compactDiscardArchiveValue(value)])),
  }));
  const trackIds = rows.map((row) => (typeof row.id === 'string' ? row.id : '')).filter(Boolean);

  database.exec('PRAGMA foreign_keys = ON');
  deleteRowsByTrackIds(database, 'album_tracks', 'track_id', trackIds);
  deleteRowsByTrackIds(database, 'artist_tracks', 'track_id', trackIds);
  deleteRowsByTrackIds(database, 'network_metadata_candidates', 'track_id', trackIds);
  deleteRowsByTrackIds(database, 'network_metadata_decisions', 'track_id', trackIds);
  deleteRowsByTrackIds(database, 'network_cover_candidates', 'track_id', trackIds);
  deleteRowsByTrackIds(database, 'lyrics_cache', 'track_id', trackIds);
  deleteRowsByTrackIds(database, 'lyrics_candidates', 'track_id', trackIds);
  deleteRowsByTrackIds(database, 'duplicate_track_members', 'track_id', trackIds);
  deleteRowsByTrackIds(database, 'track_videos', 'track_id', trackIds);
  deleteRowsByTrackIds(database, 'playback_history', 'track_id', trackIds);
  deleteRowsByTrackIds(database, 'duplicate_track_groups', 'representative_track_id', trackIds);

  const deleteByRowId = database.prepare('DELETE FROM tracks WHERE rowid = ?');
  for (const rowId of rowIds) {
    deleteByRowId.run(rowId);
  }

  if (tableHasColumn(database, 'albums', 'id') && tableHasColumn(database, 'album_tracks', 'album_id')) {
    database.exec('DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM album_tracks)');
  }
  if (tableHasColumn(database, 'artists', 'id') && tableHasColumn(database, 'artist_tracks', 'artist_id')) {
    database.exec('DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM artist_tracks)');
  }
  if (tableHasColumn(database, 'duplicate_track_groups', 'id') && tableHasColumn(database, 'duplicate_track_members', 'group_id')) {
    database.exec('DELETE FROM duplicate_track_groups WHERE id NOT IN (SELECT DISTINCT group_id FROM duplicate_track_members)');
  }

  return {
    discardedTracks: rowIds.length,
    discardedTrackIds: trackIds,
    archivedRows,
  };
};

const scrubLibraryDatabaseCopy = (databasePath: string): number => {
  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, { fileMustExist: true });
    let scrubbedRows = 0;
    database.transaction(() => {
      scrubbedRows += scrubTrackRows(database!);
      scrubbedRows += scrubNonTrackLibraryTables(database!);
    })();
    try {
      database.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Scrubbing a copied database should still proceed if WAL checkpoint is unavailable.
    }
    return scrubbedRows;
  } finally {
    try {
      database?.close();
    } catch {
      // Ignore close errors after best-effort scrub.
    }
  }
};

export const repairProtectedLibraryDatabase = (userDataPath = app.getPath('userData')): LibraryDatabaseRepairResult => {
  mkdirSync(userDataPath, { recursive: true });
  const removedDatabaseFiles = [libraryFileName, libraryWalFileName, libraryShmFileName].filter((name) =>
    existsSync(join(userDataPath, name)),
  );
  const archivePath = archiveLibraryTriplet(userDataPath, 'manual-library-database-repair');
  removeLibraryTriplet(userDataPath);
  const health = checkDatabaseHealth(libraryPathFor(userDataPath));
  recordLibraryDatabaseMaintenanceEvent(
    {
      action: 'manual-repair',
      databasePath: libraryPathFor(userDataPath),
      archivePath,
      removedDatabaseFiles,
      health,
    },
    userDataPath,
  );

  return {
    databasePath: libraryPathFor(userDataPath),
    archivePath,
    removedDatabaseFiles,
    readyForRescan: health.status === 'ok',
  };
};

export const deleteProtectedLibraryDatabase = (userDataPath = app.getPath('userData')): LibraryDatabaseDeleteResult => {
  mkdirSync(userDataPath, { recursive: true });
  const removedDatabaseFiles = [libraryFileName, libraryWalFileName, libraryShmFileName].filter((name) =>
    existsSync(join(userDataPath, name)),
  );
  const archivePath = archiveLibraryTriplet(userDataPath, 'manual-library-database-delete');
  removeLibraryTriplet(userDataPath);
  recordLibraryDatabaseMaintenanceEvent(
    {
      action: 'manual-delete',
      databasePath: libraryPathFor(userDataPath),
      archivePath,
      removedDatabaseFiles,
      health: checkDatabaseHealth(libraryPathFor(userDataPath)),
    },
    userDataPath,
  );

  return {
    databasePath: libraryPathFor(userDataPath),
    archivePath,
    removedDatabaseFiles,
  };
};

const sqliteBackup = async (sourcePath: string, targetPath: string): Promise<void> => {
  mkdirSync(dirname(targetPath), { recursive: true });
  rmSync(targetPath, { force: true, maxRetries: 3, retryDelay: 50 });
  const database = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await database.backup(targetPath);
  } finally {
    database.close();
  }
};

const archiveLibraryTriplet = (userDataPath: string, reason: string, date = new Date()): string | null => {
  if (!existsSync(libraryPathFor(userDataPath)) && !existsSync(libraryWalPathFor(userDataPath)) && !existsSync(libraryShmPathFor(userDataPath))) {
    return null;
  }

  const archivePath = join(getCorruptArchivesPath(userDataPath), `${timestampForPath(date)}-${reason}`);
  mkdirSync(archivePath, { recursive: true });
  const copied = copyLibraryTriplet(userDataPath, archivePath);
  writeFileSync(
    join(archivePath, 'archive.json'),
    `${JSON.stringify({ formatVersion: 1, reason, createdAt: date.toISOString(), copied }, null, 2)}\n`,
    'utf8',
  );
  return archivePath;
};

const fileSize = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

const fileSizeOrNull = (path: string): number | null => (existsSync(path) ? fileSize(path) : null);

const fileSignaturePart = (path: string): { sizeBytes: number | null; mtimeMs: number | null } => {
  try {
    const stats = statSync(path);
    return stats.isFile()
      ? { sizeBytes: stats.size, mtimeMs: Math.round(stats.mtimeMs) }
      : { sizeBytes: null, mtimeMs: null };
  } catch {
    return { sizeBytes: null, mtimeMs: null };
  }
};

const getLibraryDatabaseSnapshotSignature = (rootPath: string): LibraryDatabaseSnapshotSignature => {
  const database = fileSignaturePart(libraryPathFor(rootPath));
  const wal = fileSignaturePart(libraryWalPathFor(rootPath));
  const shm = fileSignaturePart(libraryShmPathFor(rootPath));

  return {
    databaseSizeBytes: database.sizeBytes,
    databaseMtimeMs: database.mtimeMs,
    walSizeBytes: wal.sizeBytes,
    walMtimeMs: wal.mtimeMs,
    shmSizeBytes: shm.sizeBytes,
    shmMtimeMs: shm.mtimeMs,
  };
};

const snapshotSignatureKeys = [
  'databaseSizeBytes',
  'databaseMtimeMs',
  'walSizeBytes',
  'walMtimeMs',
  'shmSizeBytes',
  'shmMtimeMs',
] as const;

const hasComparableSnapshotSignature = (value: SnapshotManifest): value is SnapshotManifest & LibraryDatabaseSnapshotSignature =>
  snapshotSignatureKeys.every((key) => typeof value[key] === 'number' || value[key] === null);

const sameSnapshotSignature = (left: LibraryDatabaseSnapshotSignature, right: LibraryDatabaseSnapshotSignature): boolean =>
  snapshotSignatureKeys.every((key) => left[key] === right[key]);

const readSnapshotManifest = (snapshotPath: string): SnapshotManifest | null =>
  safeReadJson<SnapshotManifest>(join(snapshotPath, 'snapshot.json'));

const readSnapshotManifestAsync = (snapshotPath: string): Promise<SnapshotManifest | null> =>
  safeReadJsonAsync<SnapshotManifest>(join(snapshotPath, 'snapshot.json'));

export const getLibraryDatabaseStartupMetrics = (
  userDataPath = app.getPath('userData'),
  options: { includeSnapshotCount?: boolean } = {},
): {
  databaseSizeBytes: number | null;
  walSizeBytes: number | null;
  snapshotCount: number | null;
} => {
  const signature = getLibraryDatabaseSnapshotSignature(userDataPath);
  return {
    databaseSizeBytes: signature.databaseSizeBytes,
    walSizeBytes: signature.walSizeBytes,
    snapshotCount: options.includeSnapshotCount === false ? null : listSnapshotPaths(userDataPath).length,
  };
};

export const shouldCreateDeferredStartupSnapshot = (
  userDataPath = app.getPath('userData'),
  date = new Date(),
): DeferredStartupSnapshotDecision => {
  const currentSignature = getLibraryDatabaseSnapshotSignature(userDataPath);
  const snapshotPaths = listSnapshotPaths(userDataPath);
  const snapshotCount = snapshotPaths.length;
  const manifests = snapshotPaths.map((snapshotPath) => ({
    id: basename(snapshotPath),
    manifest: readSnapshotManifest(snapshotPath),
  }));
  const latest = manifests[0] ?? null;

  if (!latest?.manifest) {
    return { shouldCreate: true, reason: 'no-comparable-snapshot', snapshotCount, currentSignature };
  }

  if (latest.manifest.libraryHealth?.status && latest.manifest.libraryHealth.status !== 'ok') {
    return { shouldCreate: true, reason: 'latest-snapshot-unhealthy', snapshotCount, currentSignature, snapshotId: latest.id };
  }

  const latestHealthy = manifests.find((snapshot) =>
    snapshot.manifest?.libraryHealth?.status === 'ok' &&
    Array.isArray(snapshot.manifest.copied) &&
    snapshot.manifest.copied.includes(libraryFileName),
  );

  if (!latestHealthy?.manifest) {
    return { shouldCreate: true, reason: 'latest-snapshot-unhealthy', snapshotCount, currentSignature, snapshotId: latest.id };
  }

  if (!hasComparableSnapshotSignature(latestHealthy.manifest)) {
    return {
      shouldCreate: true,
      reason: 'legacy-snapshot-missing-signature',
      snapshotCount,
      currentSignature,
      snapshotId: latestHealthy.id,
    };
  }

  if (!sameSnapshotSignature(currentSignature, latestHealthy.manifest)) {
    return { shouldCreate: true, reason: 'database-changed', snapshotCount, currentSignature, snapshotId: latestHealthy.id };
  }

  if (latestHealthy.manifest.reason === 'scan-completed-library-snapshot') {
    return { shouldCreate: false, reason: 'recent-scan-snapshot', snapshotCount, currentSignature, snapshotId: latestHealthy.id };
  }

  if (latestHealthy.manifest.reason === 'startup') {
    const createdAt = typeof latestHealthy.manifest.createdAt === 'string' ? Date.parse(latestHealthy.manifest.createdAt) : Number.NaN;
    if (Number.isFinite(createdAt) && date.getTime() - createdAt <= 24 * 60 * 60 * 1000) {
      return { shouldCreate: false, reason: 'recent-startup-snapshot', snapshotCount, currentSignature, snapshotId: latestHealthy.id };
    }

    return {
      shouldCreate: true,
      reason: 'recent-startup-snapshot-expired',
      snapshotCount,
      currentSignature,
      snapshotId: latestHealthy.id,
    };
  }

  return { shouldCreate: false, reason: 'unchanged-database', snapshotCount, currentSignature, snapshotId: latestHealthy.id };
};

const listArchivePaths = (userDataPath: string): string[] => {
  const archivesPath = getCorruptArchivesPath(userDataPath);
  if (!existsSync(archivesPath)) {
    return [];
  }

  return readdirSync(archivesPath)
    .map((entry) => join(archivesPath, entry))
    .filter((entryPath) => {
      try {
        return statSync(entryPath).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse();
};

const isLibraryBackupMethod = (value: unknown): value is LibraryDatabaseSnapshotInfo['libraryBackupMethod'] =>
  value === 'none' || value === 'sqlite-backup' || value === 'file-copy';

const getSnapshotInfo = (snapshotPath: string, options: { validateDatabase?: boolean } = {}): LibraryDatabaseSnapshotInfo => {
  const manifest = readSnapshotManifest(snapshotPath);
  const databasePath = libraryPathFor(snapshotPath);
  const databaseExists = existsSync(databasePath);
  const health =
    options.validateDatabase !== false
      ? databaseExists
        ? checkDatabaseHealth(databasePath)
        : manifest?.libraryHealth ?? checkDatabaseHealth(databasePath)
      : manifest?.libraryHealth ?? {
          status: databaseExists ? 'unreadable' : 'ok',
          databasePath,
          checkedAt: new Date().toISOString(),
          message: databaseExists
            ? 'snapshot database health check deferred'
            : 'snapshot database does not exist',
        };

  return {
    id: basename(snapshotPath),
    path: snapshotPath,
    createdAt: manifest?.createdAt ?? null,
    reason: manifest?.reason ?? null,
    copied: Array.isArray(manifest?.copied) ? manifest.copied : [],
    skipped: Array.isArray(manifest?.skipped) ? manifest.skipped : [],
    libraryHealth: health,
    libraryBackupMethod: isLibraryBackupMethod(manifest?.libraryBackupMethod) ? manifest.libraryBackupMethod : 'none',
    databasePath: databaseExists ? databasePath : null,
    databaseSizeBytes: manifest?.databaseSizeBytes ?? fileSizeOrNull(databasePath),
    databaseMtimeMs: manifest?.databaseMtimeMs ?? null,
    walSizeBytes: manifest?.walSizeBytes ?? null,
    walMtimeMs: manifest?.walMtimeMs ?? null,
    shmSizeBytes: manifest?.shmSizeBytes ?? null,
    shmMtimeMs: manifest?.shmMtimeMs ?? null,
  };
};

const getArchiveInfo = (archivePath: string): LibraryDatabaseArchiveInfo => {
  const manifest = safeReadJson<{
    reason?: string;
    createdAt?: string;
    copied?: string[];
  }>(join(archivePath, 'archive.json'));
  const databasePath = libraryPathFor(archivePath);

  return {
    id: basename(archivePath),
    path: archivePath,
    createdAt: manifest?.createdAt ?? null,
    reason: manifest?.reason ?? null,
    copied: Array.isArray(manifest?.copied) ? manifest.copied : [],
    databasePath: existsSync(databasePath) ? databasePath : null,
    databaseSizeBytes: fileSizeOrNull(databasePath),
  };
};

const getRestorableHealthySnapshot = (snapshots: LibraryDatabaseSnapshotInfo[]): LibraryDatabaseSnapshotInfo | null =>
  snapshots.find((snapshot) => snapshot.libraryHealth.status === 'ok' && snapshot.databasePath && snapshot.copied.includes(libraryFileName)) ?? null;

const getSnapshotById = (userDataPath: string, snapshotId: string): LibraryDatabaseSnapshotInfo | null =>
  listSnapshotPaths(userDataPath)
    .map((snapshotPath) => getSnapshotInfo(snapshotPath))
    .find((snapshot) => snapshot.id === snapshotId) ?? null;

const toMaintenanceEventInfo = (event: LibraryDatabaseMaintenanceEvent): LibraryDatabaseMaintenanceEventInfo => ({
  createdAt: event.createdAt,
  action: event.action,
  databasePath: event.databasePath,
  archivePath: event.archivePath,
  removedDatabaseFiles: event.removedDatabaseFiles,
  restoredSnapshotId: event.restoredSnapshotId,
  health: event.health,
  poisonReport: event.poisonReport,
  scan: event.scan,
  error: event.error,
});

const maintenanceScanInfo = (scanStatus: LibraryScanStatus): NonNullable<LibraryDatabaseMaintenanceEvent['scan']> => ({
  jobId: scanStatus.id,
  folderId: scanStatus.folderId,
  phase: scanStatus.phase,
  totalFiles: scanStatus.totalFiles,
  processedFiles: scanStatus.processedFiles,
  skippedFiles: scanStatus.skippedFiles,
  addedTracks: scanStatus.addedTracks,
  updatedTracks: scanStatus.updatedTracks,
  removedTracks: scanStatus.removedTracks,
  errorCount: scanStatus.errorCount,
});

export const getLibraryDatabaseProtectionStatus = (
  userDataPath = app.getPath('userData'),
  hasRunningScan = false,
  options: LibraryDatabaseProtectionStatusOptions = {},
): LibraryDatabaseProtectionStatus => {
  const databasePath = libraryPathFor(userDataPath);
  const deepCheck = options.deepCheck !== false;
  const snapshots = listSnapshotPaths(userDataPath).map((snapshotPath) =>
    getSnapshotInfo(snapshotPath, { validateDatabase: deepCheck }),
  );
  const latestHealthySnapshot = getRestorableHealthySnapshot(snapshots);
  const health = deepCheck ? checkDatabaseHealth(databasePath) : checkLibraryFastStartupHealth(userDataPath);
  const maintenanceEvents = readLibraryDatabaseMaintenanceEvents(userDataPath).slice(-maxLibraryMaintenanceEvents).reverse().map(toMaintenanceEventInfo);
  const latestRestoreEvent = maintenanceEvents.find((event) => event.action === 'manual-restore');
  const latestMaintenanceEvent = maintenanceEvents[0] ?? null;
  const latestArchive = listArchivePaths(userDataPath).map(getArchiveInfo)[0] ?? null;
  const latestPoisonEvent = maintenanceEvents.find((event) => event.action === 'startup-poisoned' || event.action === 'manual-scrub-quarantined') ?? null;
  const currentPoisonReport = deepCheck && health.status === 'ok' ? inspectLibraryDatabaseForPoison(databasePath) : null;
  const poisonReport =
    currentPoisonReport?.status === 'poisoned'
      ? currentPoisonReport
      : latestPoisonEvent?.poisonReport ?? currentPoisonReport ?? null;
  const latestRestoreFailed = latestRestoreEvent?.health ? latestRestoreEvent.health.status !== 'ok' : false;
  const latestArchiveIsQuarantined =
    latestArchive?.reason === 'startup-poisoned-library' ||
    latestArchive?.reason === 'manual-scrub-quarantined-database-replace' ||
    latestPoisonEvent?.action === 'startup-poisoned';
  const currentDatabasePoisoned = currentPoisonReport?.status === 'poisoned';
  const activeDatabaseExists = existsSync(databasePath);
  const isQuarantined =
    currentDatabasePoisoned ||
    (latestMaintenanceEvent?.action === 'startup-poisoned' && latestArchiveIsQuarantined && !activeDatabaseExists) ||
    lastDataProtectionResult?.recovery.action === 'quarantined';
  const protectionMode: LibraryDatabaseProtectionStatus['protectionMode'] =
    isQuarantined
      ? 'quarantined'
      : health.status === 'ok'
      ? latestMaintenanceEvent?.action === 'scan-auto-restore'
        ? 'autoRestoredFromScanGuard'
        : 'normal'
      : latestArchive
        ? 'archivedOnly'
        : 'protected';
  const status: LibraryDatabaseProtectionStatus['status'] =
    isQuarantined
      ? 'quarantined'
      : health.status === 'ok'
        ? 'ok'
        : health.status === 'corrupt'
          ? 'needs_recovery'
          : 'degraded';
  const reason: LibraryDatabaseProtectionStatus['reason'] =
    isQuarantined
      ? poisonReport?.reason === 'oversized_payload'
        ? 'oversized_payload'
        : 'poisoned_metadata'
      : health.status === 'ok'
        ? 'none'
        : 'corrupt_database';
  const recommendedAction: LibraryDatabaseProtectionStatus['recommendedAction'] =
    isQuarantined && latestArchive?.databasePath
      ? 'scrub-quarantined-database'
      : isQuarantined && latestHealthySnapshot
        ? 'restore-snapshot'
        : isQuarantined
          ? 'rebuild-empty-database'
      : health.status === 'ok'
      ? 'none'
      : !latestHealthySnapshot || latestRestoreFailed
        ? 'rebuild-empty-database'
        : 'restore-snapshot';
  const unrecoverableReason =
    recommendedAction === 'rebuild-empty-database'
      ? latestRestoreFailed
        ? '最近一次健康快照恢复后仍未通过数据库检查。'
        : '当前数据库不可用，且没有可恢复的健康快照。'
      : undefined;

  return {
    status,
    reason,
    dataProtectionPath: getDataProtectionPath(userDataPath),
    databasePath,
    databaseSizeBytes: fileSizeOrNull(databasePath),
    archivePath: isQuarantined ? latestArchive?.path ?? lastDataProtectionResult?.recovery.archivePath ?? null : null,
    poisonReport,
    health,
    snapshots,
    latestHealthySnapshot,
    latestArchive,
    maintenanceEvents,
    canRestoreSnapshot: Boolean(latestHealthySnapshot),
    canScrubQuarantinedDatabase: Boolean(isQuarantined && latestArchive?.databasePath),
    hasRunningScan,
    protectionMode,
    recommendedAction,
    unrecoverableReason,
  };
};

export const createManualLibraryDatabaseSnapshot = async (
  userDataPath = app.getPath('userData'),
): Promise<LibraryDatabaseProtectionStatus> => {
  const health = checkDatabaseHealth(libraryPathFor(userDataPath));
  if (existsSync(libraryPathFor(userDataPath)) && health.status !== 'ok') {
    throw new Error('曲库数据库当前不健康，已拒绝创建新的健康快照。');
  }

  checkpointProtectedLibrary(userDataPath);
  await createDataProtectionSnapshot('manual-library-database-snapshot', userDataPath);
  return getLibraryDatabaseProtectionStatus(userDataPath);
};

export const restoreProtectedLibraryDatabaseSnapshot = (
  snapshotId: string,
  userDataPath = app.getPath('userData'),
): LibraryDatabaseRestoreResult => {
  const snapshot = getSnapshotById(userDataPath, snapshotId);
  if (!snapshot) {
    throw new Error('找不到这个曲库数据库快照，已拒绝恢复。');
  }
  if (snapshot.libraryHealth.status !== 'ok' || !snapshot.databasePath || !snapshot.copied.includes(libraryFileName)) {
    throw new Error('这个快照不是可恢复的健康曲库数据库快照。');
  }

  mkdirSync(userDataPath, { recursive: true });
  const replacedDatabaseFiles = [libraryFileName, libraryWalFileName, libraryShmFileName].filter((name) =>
    existsSync(join(userDataPath, name)),
  );
  const archivePath = archiveLibraryTriplet(userDataPath, 'manual-library-database-restore');
  removeLibraryTriplet(userDataPath);
  const restoredDatabaseFiles = copyLibraryTriplet(snapshot.path, userDataPath);
  const health = checkDatabaseHealth(libraryPathFor(userDataPath));

  recordLibraryDatabaseMaintenanceEvent(
    {
      action: 'manual-restore',
      databasePath: libraryPathFor(userDataPath),
      archivePath,
      removedDatabaseFiles: replacedDatabaseFiles,
      restoredSnapshotId: snapshot.id,
      health,
    },
    userDataPath,
  );

  if (!restoredDatabaseFiles.includes(libraryFileName)) {
    throw new Error('快照复制失败，曲库数据库文件没有恢复。');
  }
  if (health.status !== 'ok') {
    throw new Error(`快照已复制，但恢复后的曲库数据库仍未通过检查：${health.message ?? health.status}`);
  }

  return {
    databasePath: libraryPathFor(userDataPath),
    archivePath,
    restoredSnapshot: snapshot,
    restoredDatabaseFiles,
    health,
  };
};

const getLatestQuarantinedArchive = (userDataPath: string): LibraryDatabaseArchiveInfo | null =>
  listArchivePaths(userDataPath)
    .map(getArchiveInfo)
    .find((archive) => archive.databasePath && archive.copied.includes(libraryFileName)) ?? null;

export const scrubQuarantinedLibraryDatabase = (
  userDataPath = app.getPath('userData'),
  date = new Date(),
): LibraryDatabaseScrubResult => {
  const sourceArchive = getLatestQuarantinedArchive(userDataPath);
  if (!sourceArchive?.databasePath) {
    throw new Error('找不到可修复的隔离曲库数据库。');
  }

  const poisonReportBefore = inspectLibraryDatabaseForPoison(sourceArchive.databasePath);
  const scrubRoot = join(getDataProtectionPath(userDataPath), 'scrubbed-libraries', `${timestampForPath(date)}-metadata-scrub`);
  mkdirSync(scrubRoot, { recursive: true });
  const copied = copyLibraryTriplet(sourceArchive.path, scrubRoot);
  if (!copied.includes(libraryFileName)) {
    throw new Error('隔离曲库副本复制失败，已拒绝修复。');
  }

  const scrubbedDatabasePath = libraryPathFor(scrubRoot);
  const scrubbedRows = scrubLibraryDatabaseCopy(scrubbedDatabasePath);
  const scrubbedHealth = checkDatabaseHealth(scrubbedDatabasePath);
  if (scrubbedHealth.status !== 'ok') {
    throw new Error(`修复副本没有通过数据库检查：${scrubbedHealth.message ?? scrubbedHealth.status}`);
  }

  const poisonReportAfter = inspectLibraryDatabaseForPoison(scrubbedDatabasePath);
  if (poisonReportAfter.status !== 'ok') {
    throw new Error('修复副本仍包含不安全的嵌入标签数据，已拒绝替换当前曲库。');
  }

  mkdirSync(userDataPath, { recursive: true });
  const replacedDatabaseFiles = [libraryFileName, libraryWalFileName, libraryShmFileName].filter((name) =>
    existsSync(join(userDataPath, name)),
  );
  const archivePath = archiveLibraryTriplet(userDataPath, 'manual-scrub-quarantined-database-replace');
  let restoredDatabaseFiles: string[] = [];
  let appliedScrubbedRows = scrubbedRows;
  try {
    removeLibraryTriplet(userDataPath);
    restoredDatabaseFiles = copyLibraryTriplet(scrubRoot, userDataPath);
    if (!restoredDatabaseFiles.includes(libraryFileName)) {
      throw new Error('修复后的曲库数据库复制失败，当前曲库未恢复。');
    }
  } catch (replaceError) {
    const activeDatabasePath = libraryPathFor(userDataPath);
    const activePoisonReport = existsSync(activeDatabasePath) ? inspectLibraryDatabaseForPoison(activeDatabasePath) : null;
    if (activePoisonReport?.status !== 'poisoned') {
      throw replaceError;
    }
    appliedScrubbedRows = scrubLibraryDatabaseCopy(activeDatabasePath);
    restoredDatabaseFiles = [libraryFileName];
  }

  const health = checkDatabaseHealth(libraryPathFor(userDataPath));
  const activePoisonReportAfter = inspectLibraryDatabaseForPoison(libraryPathFor(userDataPath));
  recordLibraryDatabaseMaintenanceEvent(
    {
      action: 'manual-scrub-quarantined',
      databasePath: libraryPathFor(userDataPath),
      archivePath,
      removedDatabaseFiles: replacedDatabaseFiles,
      health,
      poisonReport: poisonReportBefore,
    },
    userDataPath,
  );

  if (health.status !== 'ok') {
    throw new Error(`修复后的曲库仍未通过检查：${health.message ?? health.status}`);
  }

  if (activePoisonReportAfter.status !== 'ok') {
    throw new Error('Recovered library database still contains unsafe embedded metadata payloads.');
  }

  if (lastDataProtectionResult?.userDataPath === userDataPath) {
    lastDataProtectionResult = {
      ...lastDataProtectionResult,
      snapshot: skippedSnapshot(health),
      libraryHealth: health,
      recovery: { action: 'none', health },
    };
  }

  return {
    databasePath: libraryPathFor(userDataPath),
    sourceArchivePath: sourceArchive.path,
    scrubbedDatabasePath,
    archivePath,
    replacedDatabaseFiles,
    scrubbedRows: appliedScrubbedRows,
    health,
    poisonReportBefore,
    poisonReportAfter: activePoisonReportAfter,
  };
};

export const discardQuarantinedProblemTracks = (
  userDataPath = app.getPath('userData'),
  date = new Date(),
): LibraryDatabaseDiscardProblemTracksResult => {
  const sourceArchive = getLatestQuarantinedArchive(userDataPath);
  if (!sourceArchive?.databasePath) {
    throw new Error('找不到可处理的隔离曲库数据库。');
  }

  const poisonReportBefore = inspectLibraryDatabaseForPoison(sourceArchive.databasePath);
  const discardRoot = join(getDataProtectionPath(userDataPath), 'discarded-library-rows', `${timestampForPath(date)}-problem-tracks`);
  const scrubRoot = join(discardRoot, 'scrubbed-library');
  mkdirSync(scrubRoot, { recursive: true });
  const copied = copyLibraryTriplet(sourceArchive.path, scrubRoot);
  if (!copied.includes(libraryFileName)) {
    throw new Error('隔离曲库副本复制失败，已拒绝归档问题曲目。');
  }

  const scrubbedDatabasePath = libraryPathFor(scrubRoot);
  let discardResult: ReturnType<typeof discardUnsafeTrackRows> = {
    discardedTracks: 0,
    discardedTrackIds: [],
    archivedRows: [],
  };
  let residualScrubbedRows = 0;
  let database: Database.Database | null = null;
  try {
    database = new Database(scrubbedDatabasePath, { fileMustExist: true });
    database.transaction(() => {
      discardResult = discardUnsafeTrackRows(database!);
      residualScrubbedRows = scrubNonTrackLibraryTables(database!);
    })();
    try {
      database.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // A copied recovery database can still be validated without a successful checkpoint.
    }
  } finally {
    try {
      database?.close();
    } catch {
      // Ignore close errors after best-effort discard.
    }
  }

  if (discardResult.discardedTracks <= 0) {
    throw new Error('隔离曲库里没有找到可归档移除的问题曲目。');
  }

  const discardArchivePath = join(discardRoot, 'discarded-tracks.json');
  writeFileSync(
    discardArchivePath,
    `${JSON.stringify(
      {
        formatVersion: 1,
        createdAt: date.toISOString(),
        sourceArchivePath: sourceArchive.path,
        discardedTracks: discardResult.discardedTracks,
        discardedTrackIds: discardResult.discardedTrackIds,
        tracks: discardResult.archivedRows,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const scrubbedHealth = checkDatabaseHealth(scrubbedDatabasePath);
  if (scrubbedHealth.status !== 'ok') {
    throw new Error(`移除问题曲目后的副本没有通过数据库检查：${scrubbedHealth.message ?? scrubbedHealth.status}`);
  }

  const poisonReportAfter = inspectLibraryDatabaseForPoison(scrubbedDatabasePath);
  if (poisonReportAfter.status !== 'ok') {
    throw new Error('移除问题曲目后的副本仍包含不安全的标签数据，已拒绝替换当前曲库。');
  }

  mkdirSync(userDataPath, { recursive: true });
  const replacedDatabaseFiles = [libraryFileName, libraryWalFileName, libraryShmFileName].filter((name) =>
    existsSync(join(userDataPath, name)),
  );
  const archivePath = archiveLibraryTriplet(userDataPath, 'manual-discard-quarantined-problem-tracks');
  let restoredDatabaseFiles: string[] = [];
  let appliedDiscardResult = discardResult;
  let appliedResidualScrubbedRows = residualScrubbedRows;
  try {
    removeLibraryTriplet(userDataPath);
    restoredDatabaseFiles = copyLibraryTriplet(scrubRoot, userDataPath);
    if (!restoredDatabaseFiles.includes(libraryFileName)) {
      throw new Error('移除问题曲目后的曲库数据库复制失败，当前曲库未恢复。');
    }
  } catch (replaceError) {
    const activeDatabasePath = libraryPathFor(userDataPath);
    const activePoisonReport = existsSync(activeDatabasePath) ? inspectLibraryDatabaseForPoison(activeDatabasePath) : null;
    if (activePoisonReport?.status !== 'poisoned') {
      throw replaceError;
    }

    let activeDatabase: Database.Database | null = null;
    try {
      activeDatabase = new Database(activeDatabasePath, { fileMustExist: true });
      activeDatabase.transaction(() => {
        appliedDiscardResult = discardUnsafeTrackRows(activeDatabase!);
        appliedResidualScrubbedRows = scrubNonTrackLibraryTables(activeDatabase!);
      })();
      try {
        activeDatabase.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // The active database will still be checked below.
      }
    } finally {
      try {
        activeDatabase?.close();
      } catch {
        // Ignore close errors after best-effort in-place discard.
      }
    }

    if (appliedDiscardResult.discardedTracks <= 0) {
      throw replaceError;
    }
    restoredDatabaseFiles = [libraryFileName];
  }

  const health = checkDatabaseHealth(libraryPathFor(userDataPath));
  const activePoisonReportAfter = inspectLibraryDatabaseForPoison(libraryPathFor(userDataPath));
  recordLibraryDatabaseMaintenanceEvent(
    {
      action: 'manual-discard-quarantined',
      databasePath: libraryPathFor(userDataPath),
      archivePath,
      removedDatabaseFiles: replacedDatabaseFiles,
      health,
      poisonReport: poisonReportBefore,
    },
    userDataPath,
  );

  if (health.status !== 'ok') {
    throw new Error(`恢复后的曲库仍未通过检查：${health.message ?? health.status}`);
  }

  if (lastDataProtectionResult?.userDataPath === userDataPath) {
    lastDataProtectionResult = {
      ...lastDataProtectionResult,
      snapshot: skippedSnapshot(health),
      libraryHealth: health,
      recovery: { action: 'none', health },
    };
  }

  if (activePoisonReportAfter.status !== 'ok') {
    throw new Error('Recovered library database still contains unsafe embedded metadata payloads.');
  }

  return {
    databasePath: libraryPathFor(userDataPath),
    sourceArchivePath: sourceArchive.path,
    scrubbedDatabasePath,
    discardArchivePath,
    archivePath,
    replacedDatabaseFiles,
    discardedTracks: appliedDiscardResult.discardedTracks,
    discardedTrackIds: appliedDiscardResult.discardedTrackIds,
    residualScrubbedRows: appliedResidualScrubbedRows,
    health,
    poisonReportBefore,
    poisonReportAfter: activePoisonReportAfter,
  };
};

const directoryEntryCount = (path: string): number => {
  try {
    return statSync(path).isDirectory() ? readdirSync(path).length : 0;
  } catch {
    return 0;
  }
};

const scoreUserDataPath = (userDataPath: string): UserDataScore => {
  const librarySize = fileSize(join(userDataPath, 'echo-library.sqlite'));
  const hasSettings = existsSync(join(userDataPath, 'echo-settings.json'));
  let protectedFiles = 0;
  let score = Math.min(50, Math.floor(librarySize / (512 * 1024)));

  for (const entry of protectedDataEntries) {
    const entryPath = join(userDataPath, entry.name);
    if (!existsSync(entryPath)) {
      continue;
    }

    protectedFiles += 1;
    score += entry.kind === 'directory' ? Math.min(4, directoryEntryCount(entryPath)) : 4;
  }

  if (librarySize > 0 && librarySize < 1024 * 1024) {
    score += 3;
  }

  return { path: userDataPath, score, protectedFiles, librarySize, hasSettings };
};

const shouldMigrateLegacyUserData = (source: UserDataScore, target: UserDataScore): boolean => {
  if (source.protectedFiles === 0 || (!source.hasSettings && source.librarySize === 0)) {
    return false;
  }

  const targetLooksFresh =
    target.protectedFiles === 0 ||
    (target.librarySize > 0 && target.librarySize < 1024 * 1024 && target.score <= 16) ||
    (target.hasSettings && target.librarySize === 0 && target.score <= 8);

  if (targetLooksFresh && source.score > target.score) {
    return true;
  }

  const sourceHasMuchLargerLibrary = source.librarySize > 0 && (target.librarySize === 0 || source.librarySize > Math.max(1024 * 1024, target.librarySize * 2));
  return sourceHasMuchLargerLibrary && source.score >= target.score;
};

const findBestLegacyUserDataPath = (targetUserDataPath: string, legacyUserDataPaths = getLegacyUserDataPaths()): string | null => {
  const target = scoreUserDataPath(targetUserDataPath);
  const candidates = legacyUserDataPaths
    .filter((candidate) => existsSync(candidate))
    .map((candidate) => scoreUserDataPath(candidate))
    .filter((candidate) => candidate.protectedFiles > 0)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0] ?? null;
  if (!best || !shouldMigrateLegacyUserData(best, target)) {
    return null;
  }

  return best.path;
};

export const migrateLegacyProtectedData = async (
  targetUserDataPath = app.getPath('userData'),
  legacyUserDataPaths = getLegacyUserDataPaths(),
  phaseContext?: DataProtectionPhaseContext,
): Promise<LegacyMigrationResult> => {
  const sourcePath = await runDataProtectionBlockingPhase(phaseContext, 'migration check', () =>
    findBestLegacyUserDataPath(targetUserDataPath, legacyUserDataPaths),
  );
  const migrated: string[] = [];
  const skipped: string[] = [];

  if (!sourcePath) {
    return { sourcePath: null, migrated, skipped: protectedDataEntries.map((entry) => entry.name) };
  }

  await createDataProtectionSnapshot('startup', targetUserDataPath, new Date(), phaseContext);

  for (const entry of protectedDataEntries) {
    const sourceEntryPath = join(sourcePath, entry.name);
    if (!existsSync(sourceEntryPath)) {
      skipped.push(entry.name);
      continue;
    }

    await runDataProtectionPhase(phaseContext, `file copy/hash ${entry.name}`, async () => {
      try {
        await copyProtectedEntryAsync(sourceEntryPath, join(targetUserDataPath, entry.name), entry.kind);
        migrated.push(entry.name);
      } catch {
        skipped.push(entry.name);
      }
    });
  }

  return { sourcePath, migrated, skipped };
};

export const createDataProtectionSnapshot = async (
  reason: DataProtectionReason,
  userDataPath = app.getPath('userData'),
  date = new Date(),
  phaseContext?: DataProtectionPhaseContext,
): Promise<SnapshotResult> => {
  const snapshotsPath = getSnapshotsPath(userDataPath);
  const snapshotPath = join(snapshotsPath, `${timestampForPath(date)}-${reason}`);
  const copied: string[] = [];
  const skipped: string[] = [];
  let libraryBackupMethod: SnapshotResult['libraryBackupMethod'] = 'none';
  let libraryHealth = await runDataProtectionBlockingPhase(phaseContext, 'database integrity check', () =>
    checkDatabaseHealth(libraryPathFor(userDataPath)),
  );
  const librarySignature = await runDataProtectionBlockingPhase(phaseContext, 'database signature read', () =>
    getLibraryDatabaseSnapshotSignature(userDataPath),
  );

  await runDataProtectionPhase(phaseContext, 'file copy/hash create snapshot directory', () =>
    mkdirAsync(snapshotPath, { recursive: true }),
  );

  if (existsSync(libraryPathFor(userDataPath))) {
    const snapshotLibraryPath = libraryPathFor(snapshotPath);
    if (libraryHealth.status === 'ok') {
      try {
        await runDataProtectionPhase(phaseContext, 'file copy/hash', () =>
          sqliteBackup(libraryPathFor(userDataPath), snapshotLibraryPath),
        );
        const snapshotHealth = await runDataProtectionBlockingPhase(phaseContext, 'database integrity check', () =>
          checkDatabaseHealth(snapshotLibraryPath),
        );
        if (snapshotHealth.status === 'ok') {
          copied.push(libraryFileName);
          skipped.push(libraryWalFileName, libraryShmFileName);
          libraryBackupMethod = 'sqlite-backup';
          libraryHealth = snapshotHealth;
        } else {
          rmSync(snapshotLibraryPath, { force: true, maxRetries: 3, retryDelay: 50 });
          libraryHealth = snapshotHealth;
        }
      } catch {
        rmSync(snapshotLibraryPath, { force: true, maxRetries: 3, retryDelay: 50 });
      }

      if (libraryBackupMethod !== 'sqlite-backup') {
        const copiedLibraryEntries = await runDataProtectionPhase(phaseContext, 'file copy/hash library triplet', () =>
          copyLibraryTripletAsync(userDataPath, snapshotPath),
        );
        copied.push(...copiedLibraryEntries);
        for (const name of [libraryFileName, libraryWalFileName, libraryShmFileName]) {
          if (!copiedLibraryEntries.includes(name)) {
            skipped.push(name);
          }
        }
        libraryBackupMethod = copiedLibraryEntries.length > 0 ? 'file-copy' : 'none';
        libraryHealth = await runDataProtectionBlockingPhase(phaseContext, 'database integrity check', () =>
          checkDatabaseHealth(libraryPathFor(snapshotPath)),
        );
      }
    } else {
      skipped.push(libraryFileName, libraryWalFileName, libraryShmFileName);
    }
  } else {
    skipped.push(libraryFileName, libraryWalFileName, libraryShmFileName);
  }

  for (const entry of protectedDataEntries) {
    if (libraryEntryNames.has(entry.name)) {
      continue;
    }

    const sourcePath = join(userDataPath, entry.name);
    if (!existsSync(sourcePath)) {
      skipped.push(entry.name);
      continue;
    }

    await runDataProtectionPhase(phaseContext, `file copy/hash ${entry.name}`, async () => {
      try {
        await copyProtectedEntryAsync(sourcePath, join(snapshotPath, entry.name), entry.kind);
        copied.push(entry.name);
      } catch {
        skipped.push(entry.name);
      }
    });
  }

  await runDataProtectionPhase(phaseContext, 'backup manifest read/write', () =>
    writeFileAsync(
      join(snapshotPath, 'snapshot.json'),
      `${JSON.stringify(
        {
          formatVersion: 1,
          reason,
          createdAt: date.toISOString(),
          copied,
          skipped,
          libraryHealth,
          libraryBackupMethod,
          ...librarySignature,
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
  );
  await runDataProtectionPhase(phaseContext, 'backup cleanup', () => pruneOldSnapshotsAsync(userDataPath));

  return { snapshotPath, copied, skipped, libraryHealth, libraryBackupMethod };
};

export const createScanGuardLibraryDatabaseSnapshot = async (
  scanStatus: LibraryScanStatus,
  userDataPath = app.getPath('userData'),
  date = new Date(),
): Promise<LibraryDatabaseScanGuardSnapshot | null> => {
  const databasePath = libraryPathFor(userDataPath);
  if (!existsSync(databasePath)) {
    return null;
  }

  const currentHealth = checkDatabaseHealth(databasePath);
  if (currentHealth.status !== 'ok') {
    return null;
  }

  const id = `${timestampForPath(date)}-scan-${scanStatus.id}`;
  const snapshotPath = join(getScanGuardsPath(userDataPath), id);
  const snapshotDatabasePath = libraryPathFor(snapshotPath);
  mkdirSync(snapshotPath, { recursive: true });
  await sqliteBackup(databasePath, snapshotDatabasePath);

  const snapshotHealth = checkDatabaseHealth(snapshotDatabasePath);
  if (snapshotHealth.status !== 'ok') {
    rmSync(snapshotPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    throw new Error(`Scan guard snapshot failed health check: ${snapshotHealth.message ?? snapshotHealth.status}`);
  }

  const snapshot: LibraryDatabaseScanGuardSnapshot = {
    id,
    path: snapshotPath,
    databasePath: snapshotDatabasePath,
    createdAt: date.toISOString(),
    scanJobId: scanStatus.id,
    folderId: scanStatus.folderId,
    libraryHealth: snapshotHealth,
  };

  writeFileSync(
    join(snapshotPath, 'scan-guard.json'),
    `${JSON.stringify({ formatVersion: 1, ...snapshot }, null, 2)}\n`,
    'utf8',
  );
  pruneOldScanGuards(userDataPath);

  return snapshot;
};

export const restoreProtectedLibraryDatabaseFromScanGuard = (
  snapshot: LibraryDatabaseScanGuardSnapshot,
  scanStatus: LibraryScanStatus,
  cause: unknown,
  userDataPath = app.getPath('userData'),
): LibraryDatabaseScanGuardRestoreResult => {
  if (snapshot.libraryHealth.status !== 'ok' || !existsSync(snapshot.databasePath)) {
    throw new Error('Scan guard snapshot is not healthy enough to restore.');
  }

  mkdirSync(userDataPath, { recursive: true });
  const replacedDatabaseFiles = [libraryFileName, libraryWalFileName, libraryShmFileName].filter((name) =>
    existsSync(join(userDataPath, name)),
  );
  const archivePath = archiveLibraryTriplet(userDataPath, 'scan-corrupt-library');
  removeLibraryTriplet(userDataPath);
  const restoredDatabaseFiles = copyLibraryTriplet(snapshot.path, userDataPath);
  const health = checkDatabaseHealth(libraryPathFor(userDataPath));
  const error = cause instanceof Error ? cause.message : String(cause);

  recordLibraryDatabaseMaintenanceEvent(
    {
      action: 'scan-auto-restore',
      databasePath: libraryPathFor(userDataPath),
      archivePath,
      removedDatabaseFiles: replacedDatabaseFiles,
      restoredSnapshotId: snapshot.id,
      health,
      scan: maintenanceScanInfo(scanStatus),
      error,
    },
    userDataPath,
  );

  const recovery: LibraryRecoveryResult = {
    action: 'autoRestoredFromScanGuard',
    sourceSnapshotPath: snapshot.path,
    scanGuardSnapshotId: snapshot.id,
    archivePath: archivePath ?? undefined,
    health,
  };
  if (lastDataProtectionResult?.userDataPath === userDataPath) {
    lastDataProtectionResult = {
      ...lastDataProtectionResult,
      snapshot: skippedSnapshot(health),
      libraryHealth: health,
      recovery,
    };
  }

  if (!restoredDatabaseFiles.includes(libraryFileName)) {
    throw new Error('Scan guard snapshot restore failed: database file was not restored.');
  }
  if (health.status !== 'ok') {
    throw new Error(`Scan guard snapshot restore did not pass health check: ${health.message ?? health.status}`);
  }

  return {
    databasePath: libraryPathFor(userDataPath),
    archivePath,
    restoredSnapshotId: snapshot.id,
    restoredDatabaseFiles,
    health,
  };
};

export const restoreMissingProtectedData = (userDataPath = app.getPath('userData')): RestoreResult => {
  const restored: string[] = [];
  const skipped: string[] = [];
  const snapshotPaths = listSnapshotPaths(userDataPath);
  const healthyLibrarySnapshotPath = snapshotPaths
    .map((snapshotPath) => getSnapshotInfo(snapshotPath))
    .find((snapshot) => snapshot.libraryHealth.status === 'ok' && snapshot.databasePath && snapshot.copied.includes(libraryFileName))
    ?.path ?? null;

  for (const entry of protectedDataEntries) {
    const targetPath = join(userDataPath, entry.name);
    if (existsSync(targetPath)) {
      skipped.push(entry.name);
      continue;
    }

    const snapshotPath = libraryEntryNames.has(entry.name)
      ? healthyLibrarySnapshotPath
      : snapshotPaths.find((candidate) => existsSync(join(candidate, entry.name)));
    if (!snapshotPath) {
      skipped.push(entry.name);
      continue;
    }

    try {
      copyProtectedEntry(join(snapshotPath, entry.name), targetPath, entry.kind);
      restored.push(entry.name);
    } catch {
      skipped.push(entry.name);
    }
  }

  return { restored, skipped };
};

export const restoreMissingProtectedDataAsync = async (
  userDataPath = app.getPath('userData'),
  phaseContext?: DataProtectionPhaseContext,
): Promise<RestoreResult> => {
  const restored: string[] = [];
  const skipped: string[] = [];
  const snapshotPaths = await runDataProtectionPhase(phaseContext, 'restore check list snapshots', () =>
    listSnapshotPathsAsync(userDataPath),
  );
  let healthyLibrarySnapshotPath: string | null = null;

  for (const snapshotPath of snapshotPaths) {
    const manifest = await runDataProtectionPhase(phaseContext, 'restore check backup manifest read', () =>
      readSnapshotManifestAsync(snapshotPath),
    );
    if (
      manifest?.libraryHealth?.status === 'ok' &&
      Array.isArray(manifest.copied) &&
      manifest.copied.includes(libraryFileName) &&
      existsSync(libraryPathFor(snapshotPath))
    ) {
      healthyLibrarySnapshotPath = snapshotPath;
      break;
    }
  }

  for (const entry of protectedDataEntries) {
    const targetPath = join(userDataPath, entry.name);
    if (existsSync(targetPath)) {
      skipped.push(entry.name);
      continue;
    }

    const snapshotPath = libraryEntryNames.has(entry.name)
      ? healthyLibrarySnapshotPath
      : snapshotPaths.find((candidate) => existsSync(join(candidate, entry.name)));
    if (!snapshotPath) {
      skipped.push(entry.name);
      continue;
    }

    await runDataProtectionPhase(phaseContext, `restore check file copy/hash ${entry.name}`, async () => {
      try {
        await copyProtectedEntryAsync(join(snapshotPath, entry.name), targetPath, entry.kind);
        restored.push(entry.name);
      } catch {
        skipped.push(entry.name);
      }
    });
  }

  return { restored, skipped };
};

export const writeDataProtectionManifest = (userDataPath = app.getPath('userData')): void => {
  const protectionPath = getDataProtectionPath(userDataPath);
  const existing = safeReadJson<{ firstProtectedAt?: string }>(join(protectionPath, manifestFileName));
  const now = new Date().toISOString();

  mkdirSync(protectionPath, { recursive: true });
  writeFileSync(
    join(protectionPath, manifestFileName),
    `${JSON.stringify(
      {
        formatVersion: 1,
        appName: typeof app.getName === 'function' ? app.getName() : 'ECHO NEXT',
        appVersion: typeof app.getVersion === 'function' ? app.getVersion() : null,
        protectedUserDataPath: userDataPath,
        protectedEntries: protectedDataEntries.map((entry) => ({ ...entry, path: join(userDataPath, entry.name) })),
        firstProtectedAt: existing?.firstProtectedAt ?? now,
        lastVerifiedAt: now,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
};

const protectCorruptLibraryDatabase = (userDataPath: string, currentHealth: DatabaseHealthResult): LibraryRecoveryResult => {
  if (currentHealth.status === 'ok') {
    return { action: 'none', health: currentHealth };
  }

  if (currentHealth.status !== 'corrupt') {
    return { action: 'none', health: currentHealth };
  }

  const archivePath = archiveLibraryTriplet(userDataPath, 'startup-corrupt-library') ?? undefined;
  try {
    recordLibraryDatabaseMaintenanceEvent(
      {
        action: 'startup-protected',
        databasePath: libraryPathFor(userDataPath),
        archivePath,
        removedDatabaseFiles: [],
        health: currentHealth,
      },
      userDataPath,
    );
    return { action: archivePath ? 'archivedOnly' : 'protected', archivePath, health: currentHealth };
  } catch (error) {
    return {
      action: 'failed',
      archivePath,
      health: {
        status: 'unreadable',
        databasePath: libraryPathFor(userDataPath),
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};

const autoRepairPoisonedLibraryDatabase = (
  userDataPath: string,
  archivePath: string | undefined,
  poisonReportBefore: LibraryDatabasePoisonReport,
): { health: DatabaseHealthResult; poisonReportAfter: LibraryDatabasePoisonReport } | null => {
  const databasePath = libraryPathFor(userDataPath);
  if (!existsSync(databasePath)) {
    return null;
  }

  try {
    let database: Database.Database | null = null;
    try {
      database = new Database(databasePath, { fileMustExist: true });
      database.transaction(() => {
        scrubTrackRows(database!);
        scrubNonTrackLibraryTables(database!);
      })();
      try {
        database.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // The health check below captures whether recovery really succeeded.
      }
    } finally {
      try {
        database?.close();
      } catch {
        // Ignore close errors after best-effort startup repair.
      }
    }

    let health = checkDatabaseHealth(databasePath);
    let poisonReportAfter = health.status === 'ok' ? inspectLibraryDatabaseForPoison(databasePath) : poisonReportBefore;

    if (health.status === 'ok' && poisonReportAfter.status === 'poisoned') {
      let discardResult: ReturnType<typeof discardUnsafeTrackRows> = {
        discardedTracks: 0,
        discardedTrackIds: [],
        archivedRows: [],
      };
      database = null;
      try {
        database = new Database(databasePath, { fileMustExist: true });
        database.transaction(() => {
          discardResult = discardUnsafeTrackRows(database!);
          scrubNonTrackLibraryTables(database!);
        })();
        try {
          database.pragma('wal_checkpoint(TRUNCATE)');
        } catch {
          // The health check below captures whether recovery really succeeded.
        }
      } finally {
        try {
          database?.close();
        } catch {
          // Ignore close errors after best-effort startup discard.
        }
      }

      if (discardResult.discardedTracks <= 0) {
        return null;
      }
      health = checkDatabaseHealth(databasePath);
      poisonReportAfter = health.status === 'ok' ? inspectLibraryDatabaseForPoison(databasePath) : poisonReportAfter;
    }

    if (health.status !== 'ok' || poisonReportAfter.status !== 'ok') {
      return null;
    }

    recordLibraryDatabaseMaintenanceEvent(
      {
        action: 'startup-auto-repair',
        databasePath,
        archivePath,
        removedDatabaseFiles: [],
        health,
        poisonReport: poisonReportBefore,
      },
      userDataPath,
    );
    return { health, poisonReportAfter };
  } catch (error) {
    recordLibraryDatabaseMaintenanceEvent(
      {
        action: 'startup-auto-repair',
        databasePath,
        archivePath,
        removedDatabaseFiles: [],
        health: {
          status: 'unreadable',
          databasePath,
          checkedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error),
        },
        poisonReport: poisonReportBefore,
        error: error instanceof Error ? error.message : String(error),
      },
      userDataPath,
    );
    return null;
  }
};

const protectPoisonedLibraryDatabase = (userDataPath: string, currentHealth: DatabaseHealthResult): LibraryRecoveryResult => {
  if (currentHealth.status !== 'ok') {
    return { action: 'none', health: currentHealth };
  }

  const poisonReport = inspectLibraryDatabaseForPoison(libraryPathFor(userDataPath));
  if (poisonReport.status !== 'poisoned') {
    return { action: 'none', health: currentHealth, poisonReport };
  }

  const archivePath = archiveLibraryTriplet(userDataPath, 'startup-poisoned-library') ?? undefined;
  try {
    if (!archivePath || !existsSync(libraryPathFor(archivePath))) {
      throw new Error('Poisoned library archive was not created; active database was left untouched.');
    }
    const autoRepair = autoRepairPoisonedLibraryDatabase(userDataPath, archivePath, poisonReport);
    if (autoRepair) {
      return { action: 'none', archivePath, health: autoRepair.health, poisonReport: autoRepair.poisonReportAfter };
    }

    const removeResult = tryRemoveLibraryTriplet(userDataPath);
    const removeWarning = removeResult.failed.length > 0
      ? ` Active database files are still locked: ${describeRemoveLibraryTripletFailure(removeResult)}`
      : '';
    const protectedHealth: DatabaseHealthResult = {
      status: 'corrupt',
      databasePath: libraryPathFor(userDataPath),
      checkedAt: new Date().toISOString(),
      message: '曲库因损坏嵌入标签/超大文本已隔离，音乐文件未被删除。',
      detail: `${poisonReport.message ?? ''}${removeWarning}`,
    };
    recordLibraryDatabaseMaintenanceEvent(
      {
        action: 'startup-poisoned',
        databasePath: libraryPathFor(userDataPath),
        archivePath,
        removedDatabaseFiles: removeResult.removed,
        health: protectedHealth,
        poisonReport,
      },
      userDataPath,
    );
    return { action: 'quarantined', archivePath, health: protectedHealth, poisonReport };
  } catch (error) {
    return {
      action: 'failed',
      archivePath,
      health: {
        status: 'unreadable',
        databasePath: libraryPathFor(userDataPath),
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      },
      poisonReport,
    };
  }
};

let lastDataProtectionResult: DataProtectionResult | null = null;

export const getLastDataProtectionResult = (): DataProtectionResult | null => lastDataProtectionResult;

export const createDataProtectionDisabledResult = (userDataPath = app.getPath('userData')): DataProtectionResult => {
  const libraryHealth = checkLibraryFastStartupHealth(userDataPath);
  const recovery: LibraryRecoveryResult = { action: 'none', health: libraryHealth };

  lastDataProtectionResult = {
    userDataPath,
    migration: { sourcePath: null, migrated: [], skipped: protectedDataEntries.map((entry) => entry.name) },
    restore: { restored: [], skipped: protectedDataEntries.map((entry) => entry.name) },
    snapshot: skippedSnapshot(libraryHealth),
    libraryHealth,
    recovery,
  };

  return lastDataProtectionResult;
};

export const isProtectedLibraryAvailable = (): boolean =>
  !lastDataProtectionResult ||
  (
    lastDataProtectionResult.libraryHealth.status !== 'corrupt' &&
    lastDataProtectionResult.recovery.action !== 'quarantined' &&
    lastDataProtectionResult.recovery.action !== 'failed'
  );

export const assertProtectedLibraryAvailable = (): void => {
  if (!isProtectedLibraryAvailable()) {
    throw new LibraryDatabaseUnavailableError(lastDataProtectionResult?.recovery ?? null);
  }
};

export const ensureDataProtectionFastStartup = async (
  reason: DataProtectionReason = 'startup',
  explicitUserDataPath?: string,
): Promise<DataProtectionResult> => {
  const userDataPath = explicitUserDataPath ?? initializeProtectedUserDataPath();

  try {
    writeDataProtectionManifest(userDataPath);
    const libraryHealth = checkLibraryFastStartupHealth(userDataPath);

    if (libraryHealth.status !== 'ok') {
      return ensureDataProtection(reason, userDataPath);
    }

    const recovery: LibraryRecoveryResult = { action: 'none', health: libraryHealth };
    lastDataProtectionResult = {
      userDataPath,
      migration: { sourcePath: null, migrated: [], skipped: protectedDataEntries.map((entry) => entry.name) },
      restore: { restored: [], skipped: protectedDataEntries.map((entry) => entry.name) },
      snapshot: skippedSnapshot(libraryHealth),
      libraryHealth,
      recovery,
    };

    return lastDataProtectionResult;
  } catch {
    return ensureDataProtection(reason, userDataPath);
  }
};

export const ensureDataProtectionStartup = async (
  reason: DataProtectionReason = 'startup',
  explicitUserDataPath?: string,
): Promise<DataProtectionResult> => {
  const phaseContext: DataProtectionPhaseContext = { scope: 'startup' };
  const userDataPath = await runDataProtectionBlockingPhase(phaseContext, 'locate userData', () =>
    explicitUserDataPath ?? initializeProtectedUserDataPath(),
  );

  try {
    await runDataProtectionBlockingPhase(phaseContext, 'backup manifest read/write', () => {
      writeDataProtectionManifest(userDataPath);
    });

    const libraryHealth = await runDataProtectionBlockingPhase(phaseContext, 'database fast health check', () =>
      checkLibraryFastStartupHealth(userDataPath),
    );
    const recovery: LibraryRecoveryResult = libraryHealth.status === 'ok'
      ? { action: 'none', health: libraryHealth }
      : { action: 'failed', health: libraryHealth };

    lastDataProtectionResult = {
      userDataPath,
      migration: { sourcePath: null, migrated: [], skipped: protectedDataEntries.map((entry) => entry.name) },
      restore: { restored: [], skipped: protectedDataEntries.map((entry) => entry.name) },
      snapshot: skippedSnapshot(libraryHealth),
      libraryHealth,
      recovery,
    };

    if (recovery.action === 'failed') {
      console.warn(`[data-protection] startup full protection deferred after fast health failed: ${libraryHealth.message ?? libraryHealth.status}`);
    }

    return lastDataProtectionResult;
  } catch (error) {
    const health: DatabaseHealthResult = {
      status: 'unreadable',
      databasePath: libraryPathFor(userDataPath),
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    };
    const recovery: LibraryRecoveryResult = { action: 'failed', health };
    lastDataProtectionResult = {
      userDataPath,
      migration: { sourcePath: null, migrated: [], skipped: protectedDataEntries.map((entry) => entry.name) },
      restore: { restored: [], skipped: protectedDataEntries.map((entry) => entry.name) },
      snapshot: skippedSnapshot(health),
      libraryHealth: health,
      recovery,
    };
    console.warn(`[data-protection] startup fast protection failed: ${health.message ?? health.status}`);
    return lastDataProtectionResult;
  }
};

export const runDeferredStartupDataProtection = async (
  reason: DataProtectionReason = 'startup',
  userDataPath = app.getPath('userData'),
): Promise<DataProtectionResult> =>
  ensureDataProtection(reason, userDataPath, {
    scope: 'background',
    beforePhase: waitForBackgroundProtectionSlot,
  });

export const ensureDataProtection = async (
  reason: DataProtectionReason = 'startup',
  explicitUserDataPath?: string,
  phaseContext: DataProtectionPhaseContext | undefined = reason === 'startup' ? { scope: 'startup' } : undefined,
): Promise<DataProtectionResult> => {
  const userDataPath = await runDataProtectionBlockingPhase(phaseContext, 'locate userData', () =>
    explicitUserDataPath ?? initializeProtectedUserDataPath(),
  );
  try {
    const migration = await migrateLegacyProtectedData(userDataPath, getLegacyUserDataPaths(), phaseContext);
    const restore = await runDataProtectionPhase(phaseContext, 'restore check', () => restoreMissingProtectedDataAsync(userDataPath, phaseContext));
    await runDataProtectionBlockingPhase(phaseContext, 'backup manifest read/write', () => {
      writeDataProtectionManifest(userDataPath);
    });
    let initialHealth = await runDataProtectionBlockingPhase(phaseContext, 'database integrity check', () =>
      checkDatabaseHealth(libraryPathFor(userDataPath)),
    );
    if (initialHealth.status === 'ok') {
      const diagnosticRows = await runDataProtectionBlockingPhase(phaseContext, 'migration check', () =>
        scrubDiagnosticLibraryText(libraryPathFor(userDataPath)),
      );
      if (diagnosticRows > 0) {
        initialHealth = await runDataProtectionBlockingPhase(phaseContext, 'database integrity check', () =>
          checkDatabaseHealth(libraryPathFor(userDataPath)),
        );
        recordLibraryDatabaseMaintenanceEvent(
          {
            action: 'startup-auto-repair',
            databasePath: libraryPathFor(userDataPath),
            removedDatabaseFiles: [],
            health: initialHealth,
          },
          userDataPath,
        );
      }
    }
    const corruptRecovery = await runDataProtectionBlockingPhase(phaseContext, 'restore check', () =>
      protectCorruptLibraryDatabase(userDataPath, initialHealth),
    );
    const recovery = corruptRecovery.action === 'none'
      ? await runDataProtectionBlockingPhase(phaseContext, 'database poison check', () =>
          protectPoisonedLibraryDatabase(userDataPath, initialHealth),
        )
      : corruptRecovery;
    const libraryHealth = recovery.health.status === 'corrupt'
      ? recovery.health
      : await runDataProtectionBlockingPhase(phaseContext, 'database integrity check', () =>
          checkDatabaseHealth(libraryPathFor(userDataPath)),
        );
    const startupSnapshotDecision = libraryHealth.status === 'ok' && reason === 'startup' && phaseContext?.scope === 'background'
      ? await runDataProtectionBlockingPhase(phaseContext, 'backup manifest read', () =>
          shouldCreateDeferredStartupSnapshot(userDataPath),
        )
      : null;
    if (startupSnapshotDecision?.shouldCreate === false) {
      markStartupStage('data-protection:background:snapshot:skipped', {
        reason: startupSnapshotDecision.reason,
        snapshotCount: startupSnapshotDecision.snapshotCount,
        snapshotId: startupSnapshotDecision.snapshotId,
        databaseSizeBytes: startupSnapshotDecision.currentSignature.databaseSizeBytes,
        walSizeBytes: startupSnapshotDecision.currentSignature.walSizeBytes,
      });
    }
    const snapshot = libraryHealth.status === 'ok' && startupSnapshotDecision?.shouldCreate !== false
      ? await createDataProtectionSnapshot(reason, userDataPath, new Date(), phaseContext)
      : skippedSnapshot(libraryHealth);

    if (migration.migrated.length > 0) {
      console.info(`[data-protection] migrated protected data from ${migration.sourcePath}: ${migration.migrated.map((entry) => basename(entry)).join(', ')}`);
    }

    if (restore.restored.length > 0) {
      console.info(`[data-protection] restored protected data: ${restore.restored.map((entry) => basename(entry)).join(', ')}`);
    }

    if (recovery.action === 'protected' || recovery.action === 'archivedOnly') {
      console.warn('[data-protection] corrupt library database was archived and left in place; app is starting in protected mode');
    } else if (recovery.action === 'quarantined') {
      console.warn('[data-protection] poisoned library database was archived and removed from the active slot; app is starting in recovery mode');
    } else if (recovery.action === 'failed') {
      console.warn(`[data-protection] library database recovery failed: ${recovery.health.message ?? recovery.health.status}`);
    }

    lastDataProtectionResult = { userDataPath, migration, snapshot, restore, libraryHealth, recovery };
    return lastDataProtectionResult;
  } catch (error) {
    const health: DatabaseHealthResult = {
      status: 'unreadable',
      databasePath: libraryPathFor(userDataPath),
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    };
    const recovery: LibraryRecoveryResult = { action: 'failed', health };
    lastDataProtectionResult = {
      userDataPath,
      migration: { sourcePath: null, migrated: [], skipped: protectedDataEntries.map((entry) => entry.name) },
      restore: { restored: [], skipped: protectedDataEntries.map((entry) => entry.name) },
      snapshot: skippedSnapshot(health),
      libraryHealth: health,
      recovery,
    };
    console.warn(`[data-protection] startup protection failed: ${health.message ?? health.status}`);
    return lastDataProtectionResult;
  }
};

export const checkpointProtectedLibrary = (userDataPath = app.getPath('userData')): DatabaseHealthResult =>
  checkpointWal(libraryPathFor(userDataPath));
