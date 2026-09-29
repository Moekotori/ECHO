import { watch as watchFileSystem, statSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { stat as statFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { SCANNABLE_AUDIO_EXTENSIONS } from '../../shared/constants/audioExtensions';

export type LibraryWatcherEventType = 'add' | 'change' | 'unlink' | 'rename' | 'directory' | 'unknown';

export type LibraryWatcherRecentEvent = {
  timestamp: string;
  folderId: string;
  eventType: LibraryWatcherEventType;
  path: string;
  extension: string;
  sizeBytes?: number;
  mtimeMs?: number;
  stableForMs?: number;
};

export type LibraryWatcherDiagnostics = {
  enabled: boolean;
  autoRescanEnabled: boolean;
  watchedFolderCount: number;
  totalEventCount: number;
  recentEvents: LibraryWatcherRecentEvent[];
  eventStormCount: number;
  pendingPathCount: number;
  droppedPathCount: number;
  triggeredRescanCount: number;
  skippedDeleteEventCount: number;
  skippedRenameEventCount: number;
  lastError: string | null;
  lastTriggeredRescanAt: string | null;
  lastRescanError: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
};

export type LibraryWatcherRawEvent = {
  folderId: string;
  eventType: LibraryWatcherEventType;
  path: string;
};

export type LibraryWatcherFolder = {
  id: string;
  path: string;
  enabled?: boolean;
};

export type LibraryWatcherSubscription = {
  active?: boolean;
  close: () => void;
};

export type FileSystemWatcherAdapter = {
  watch: (
    folder: LibraryWatcherFolder,
    onEvent: (event: LibraryWatcherRawEvent) => void,
    onError: (error: unknown) => void,
  ) => LibraryWatcherSubscription;
};

type FileStatSnapshot = {
  sizeBytes: number;
  mtimeMs: number;
};

type MaybePromise<T> = T | Promise<T>;

type PendingEvent = {
  folderId: string;
  path: string;
  eventTypes: Set<LibraryWatcherEventType>;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  debounceTimer: NodeJS.Timeout | null;
  stabilityTimer: NodeJS.Timeout | null;
  checks: number;
};

export type LibraryWatcherRescanCoordinator = {
  rescanPaths: (folderId: string, paths: string[]) => unknown;
  markMissingPaths?: (folderId: string, paths: string[]) => unknown;
  reconcileFolder?: (folderId: string, options: { reason: 'startup' | 'recovery' }) => unknown;
  previewRescanPaths?: (folderId: string, paths: string[]) => unknown;
  hasRunningJobs?: () => boolean;
  shouldDelayRescan?: () => boolean | Promise<boolean>;
  shouldAutoHideDeleted?: () => boolean;
};

type LibraryWatcherServiceOptions = {
  enabled?: boolean;
  autoRescanEnabled?: boolean;
  readFolders: () => LibraryWatcherFolder[];
  rescanCoordinator?: LibraryWatcherRescanCoordinator;
  adapter?: FileSystemWatcherAdapter;
  statFile?: (filePath: string) => MaybePromise<FileStatSnapshot | null>;
  now?: () => number;
  debounceMs?: number;
  rescanDebounceMs?: number;
  reconciliationDebounceMs?: number;
  startupReconciliationDelayMs?: number;
  restartDelayMs?: number;
  maxRestartDelayMs?: number;
  maxRescanDeferralMs?: number;
  stabilityPollMs?: number;
  maxStabilityChecks?: number;
  maxPendingPathCount?: number;
  maxRescanBatchSize?: number;
  stormWindowMs?: number;
  stormThreshold?: number;
};

const recentEventLimit = 100;
const defaultMaxRescanBatchSize = 4;
export const LIBRARY_WATCHER_FEATURE_FLAG = 'ECHO_LIBRARY_WATCHER';
export const LIBRARY_WATCHER_AUTO_RESCAN_FEATURE_FLAG = 'ECHO_LIBRARY_WATCHER_AUTO_RESCAN';
const temporaryExtensions = new Set(['.tmp', '.temp', '.part', '.partial', '.download', '.crdownload', '.swp']);
const ignoredDatabaseExtensions = new Set(['.db', '.sqlite', '.sqlite3', '.wal', '.shm']);
const ignoredCoverExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

export const isLibraryWatcherFeatureEnabled = (env: Record<string, string | undefined> = process.env): boolean => {
  const value = env[LIBRARY_WATCHER_FEATURE_FLAG]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
};

export const isLibraryWatcherAutoRescanEnabled = (env: Record<string, string | undefined> = process.env): boolean => {
  const value = env[LIBRARY_WATCHER_AUTO_RESCAN_FEATURE_FLAG]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
};

const createEmptyDiagnostics = (enabled: boolean, autoRescanEnabled: boolean): LibraryWatcherDiagnostics => ({
  enabled,
  autoRescanEnabled,
  watchedFolderCount: 0,
  totalEventCount: 0,
  recentEvents: [],
  eventStormCount: 0,
  pendingPathCount: 0,
  droppedPathCount: 0,
  triggeredRescanCount: 0,
  skippedDeleteEventCount: 0,
  skippedRenameEventCount: 0,
  lastError: null,
  lastTriggeredRescanAt: null,
  lastRescanError: null,
  startedAt: null,
  stoppedAt: null,
});

const toIso = (timestampMs: number): string => new Date(timestampMs).toISOString();

const coalescedEventType = (eventTypes: Set<LibraryWatcherEventType>): LibraryWatcherEventType => {
  if (eventTypes.has('add')) {
    return 'add';
  }
  if (eventTypes.has('change')) {
    return 'change';
  }
  if (eventTypes.has('rename')) {
    return 'rename';
  }
  if (eventTypes.has('unlink')) {
    return 'unlink';
  }
  return 'unknown';
};

const defaultStatFile = async (filePath: string): Promise<FileStatSnapshot | null> => {
  try {
    const stats = await statFile(filePath);
    if (!stats.isFile()) {
      return null;
    }

    return {
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    return null;
  }
};

const defaultStatFileSync = (filePath: string): FileStatSnapshot | null => {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return null;
    }

    return {
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    return null;
  }
};

const isSameSnapshot = (left: FileStatSnapshot | null, right: FileStatSnapshot | null): boolean =>
  left !== null && right !== null && left.sizeBytes === right.sizeBytes && left.mtimeMs === right.mtimeMs;

const isHiddenPath = (filePath: string): boolean =>
  filePath
    .split(/[\\/]+/u)
    .filter(Boolean)
    .some((segment) => segment.startsWith('.') && segment.length > 1);

const isClearlyTemporaryPath = (filePath: string): boolean => {
  const name = basename(filePath).toLowerCase();
  const extension = extname(name);

  return (
    name.startsWith('~$') ||
    name.startsWith('._') ||
    temporaryExtensions.has(extension) ||
    ignoredDatabaseExtensions.has(extension) ||
    ignoredCoverExtensions.has(extension) ||
    /\.(tmp|temp|part|partial|download|crdownload)$/iu.test(name)
  );
};

const shouldIgnorePath = (filePath: string): boolean => {
  if (isHiddenPath(filePath) || isClearlyTemporaryPath(filePath)) {
    return true;
  }

  return false;
};

const shouldObservePath = (filePath: string): boolean => {
  if (shouldIgnorePath(filePath)) {
    return false;
  }

  const extension = extname(filePath).toLowerCase();
  return SCANNABLE_AUDIO_EXTENSIONS.has(extension) || extension === '.cue';
};

const stripNodeExtendedLengthPathPrefix = (filePath: string): string => {
  if (filePath.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${filePath.slice(8)}`;
  }
  if (filePath.startsWith('\\\\?\\')) {
    return filePath.slice(4);
  }
  return filePath;
};

export const resolveNodeWatcherEventPath = (folderPath: string, fileName: string): string =>
  resolve(folderPath, stripNodeExtendedLengthPathPrefix(fileName));

export const isNodeWatcherRootEvent = (folderPath: string, fileName: string): boolean => {
  const rootPath = resolve(stripNodeExtendedLengthPathPrefix(folderPath));
  const eventPath = resolveNodeWatcherEventPath(rootPath, fileName);
  return process.platform === 'win32'
    ? eventPath.toLowerCase() === rootPath.toLowerCase()
    : eventPath === rootPath;
};

export const classifyNodeWatcherEvent = (eventType: string, filePath: string): LibraryWatcherEventType => {
  if (eventType === 'change') {
    return 'change';
  }

  if (eventType === 'rename') {
    try {
      const stats = statSync(filePath);
      return stats.isDirectory() ? 'directory' : stats.isFile() ? 'add' : 'unknown';
    } catch {
      if (shouldObservePath(filePath)) {
        return 'unlink';
      }
      return shouldIgnorePath(filePath) ? 'unknown' : 'directory';
    }
  }

  return 'unknown';
};

const classifyNodeWatcherEventAsync = async (eventType: string, filePath: string): Promise<LibraryWatcherEventType> => {
  if (eventType === 'change') {
    return 'change';
  }

  if (eventType === 'rename') {
    try {
      const stats = await statFile(filePath);
      if (stats.isDirectory()) {
        return 'directory';
      }
    } catch {
      if (shouldObservePath(filePath)) {
        return 'rename';
      }
      return shouldIgnorePath(filePath) ? 'unknown' : 'directory';
    }
    return 'rename';
  }

  return 'unknown';
};

export class NodeFileSystemWatcherAdapter implements FileSystemWatcherAdapter {
  watch(
    folder: LibraryWatcherFolder,
    onEvent: (event: LibraryWatcherRawEvent) => void,
    onError: (error: unknown) => void,
  ): LibraryWatcherSubscription {
    let watcher: FSWatcher | null = null;
    let active = false;
    let closed = false;
    let failureReported = false;
    let rootCheckInFlight = false;
    const rootPath = resolve(folder.path);
    const reportFailure = (error: unknown): void => {
      if (closed || failureReported) {
        return;
      }
      failureReported = true;
      onError(error);
    };
    const validateRoot = (): void => {
      if (closed || failureReported || rootCheckInFlight) {
        return;
      }
      rootCheckInFlight = true;
      void statFile(rootPath)
        .then((stats) => {
          rootCheckInFlight = false;
          if (!stats.isDirectory()) {
            reportFailure(new Error(`Library watch root is no longer a directory: ${rootPath}`));
          }
        })
        .catch((error) => {
          rootCheckInFlight = false;
          reportFailure(
            new Error(
              `Library watch root is unavailable: ${rootPath}: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        });
    };

    try {
      watcher = watchFileSystem(rootPath, { recursive: true }, (eventType, fileName) => {
        if (!fileName) {
          validateRoot();
          return;
        }

        const reportedFileName = String(fileName);
        if (isNodeWatcherRootEvent(rootPath, reportedFileName)) {
          validateRoot();
          return;
        }

        const fullPath = resolveNodeWatcherEventPath(rootPath, reportedFileName);
        void classifyNodeWatcherEventAsync(eventType, fullPath)
          .then((classifiedEventType) => {
            if (closed || failureReported) {
              return;
            }
            onEvent({
              folderId: folder.id,
              eventType: classifiedEventType,
              path: fullPath,
            });
          })
          .catch(reportFailure);
      });
      watcher.on('error', reportFailure);
      active = true;
    } catch (error) {
      reportFailure(error);
    }

    return {
      active,
      close: () => {
        closed = true;
        watcher?.close();
      },
    };
  }
}

export class LibraryWatcherService {
  private readonly adapter: FileSystemWatcherAdapter;
  private readonly statFile: (filePath: string) => MaybePromise<FileStatSnapshot | null>;
  private readonly rescanCoordinator: LibraryWatcherRescanCoordinator | null;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly rescanDebounceMs: number;
  private readonly reconciliationDebounceMs: number;
  private readonly startupReconciliationDelayMs: number;
  private readonly restartDelayMs: number;
  private readonly maxRestartDelayMs: number;
  private readonly maxRescanDeferralMs: number;
  private readonly stabilityPollMs: number;
  private readonly maxStabilityChecks: number;
  private readonly maxPendingPathCount: number;
  private readonly maxRescanBatchSize: number;
  private readonly stormWindowMs: number;
  private readonly stormThreshold: number;
  private readonly readFolders: () => LibraryWatcherFolder[];
  private diagnostics: LibraryWatcherDiagnostics;
  private subscriptions = new Map<string, LibraryWatcherSubscription>();
  private watchedFolderPaths = new Map<string, string>();
  private configuredFolderIds = new Set<string>();
  private folderRestartTimers = new Map<string, NodeJS.Timeout>();
  private folderRestartAttempts = new Map<string, number>();
  private watcherErrors = new Map<string, string>();
  private pendingEvents = new Map<string, PendingEvent>();
  private pendingRescanPaths = new Map<string, Set<string>>();
  private pendingRescanStartedAtMs = new Map<string, number>();
  private previewedRescanPaths = new Map<string, Set<string>>();
  private rescanTimers = new Map<string, NodeJS.Timeout>();
  private folderRescansInFlight = new Set<string>();
  private pendingReconciliationStartedAtMs = new Map<string, number>();
  private pendingReconciliationMaxDeferralMs = new Map<string, number>();
  private pendingReconciliationReasons = new Map<string, 'startup' | 'recovery'>();
  private reconciliationDueAtMs = new Map<string, number>();
  private reconciliationTimers = new Map<string, NodeJS.Timeout>();
  private folderReconciliationsInFlight = new Set<string>();
  private restartTimer: NodeJS.Timeout | null = null;
  private restartAttempt = 0;
  private shouldRun = false;
  private stormWindowTimer: NodeJS.Timeout | null = null;
  private stormWindowEventCounts = new Map<string, number>();
  private stormWindowTrippedFolders = new Set<string>();

  constructor(options: LibraryWatcherServiceOptions) {
    this.adapter = options.adapter ?? new NodeFileSystemWatcherAdapter();
    this.statFile = options.statFile ?? defaultStatFile;
    this.rescanCoordinator = options.rescanCoordinator ?? null;
    this.now = options.now ?? Date.now;
    this.debounceMs = options.debounceMs ?? 500;
    this.rescanDebounceMs = options.rescanDebounceMs ?? 1000;
    this.reconciliationDebounceMs = options.reconciliationDebounceMs ?? 5000;
    this.startupReconciliationDelayMs = options.startupReconciliationDelayMs ?? 10000;
    this.restartDelayMs = options.restartDelayMs ?? 1000;
    this.maxRestartDelayMs = options.maxRestartDelayMs ?? 30000;
    this.maxRescanDeferralMs = options.maxRescanDeferralMs ?? 15000;
    this.stabilityPollMs = options.stabilityPollMs ?? 300;
    this.maxStabilityChecks = options.maxStabilityChecks ?? 3;
    this.maxPendingPathCount = options.maxPendingPathCount ?? 1000;
    this.maxRescanBatchSize = Math.max(1, Math.floor(options.maxRescanBatchSize ?? defaultMaxRescanBatchSize));
    this.stormWindowMs = options.stormWindowMs ?? 1000;
    this.stormThreshold = options.stormThreshold ?? 200;
    this.readFolders = options.readFolders;
    this.diagnostics = createEmptyDiagnostics(options.enabled === true, options.autoRescanEnabled === true);
  }

  start(reconciliationReason: 'startup' | 'recovery' = 'startup'): LibraryWatcherDiagnostics {
    if (!this.diagnostics.enabled) {
      return this.getDiagnostics();
    }

    const wasRunningRequested = this.shouldRun;
    this.shouldRun = true;
    if (!wasRunningRequested) {
      this.diagnostics.startedAt = toIso(this.now());
      this.diagnostics.stoppedAt = null;
      this.diagnostics.lastError = null;
      this.watcherErrors.clear();
    }
    return this.syncFolders(reconciliationReason);
  }

  stop(): LibraryWatcherDiagnostics {
    this.shouldRun = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.restartAttempt = 0;
    for (const timer of this.folderRestartTimers.values()) {
      clearTimeout(timer);
    }
    this.folderRestartTimers.clear();
    this.folderRestartAttempts.clear();
    for (const subscription of this.subscriptions.values()) {
      try {
        subscription.close();
      } catch (error) {
        this.recordError(error);
      }
    }

    this.subscriptions.clear();
    this.watchedFolderPaths.clear();
    this.configuredFolderIds.clear();
    this.diagnostics.watchedFolderCount = 0;
    this.diagnostics.stoppedAt = toIso(this.now());
    this.clearPendingEvents();
    this.clearPendingRescans();
    this.clearStormWindow();
    return this.getDiagnostics();
  }

  restart(): LibraryWatcherDiagnostics {
    const shouldRestart = this.diagnostics.enabled;
    this.stop();
    return shouldRestart ? this.start() : this.getDiagnostics();
  }

  getDiagnostics(): LibraryWatcherDiagnostics {
    return {
      ...this.diagnostics,
      recentEvents: this.diagnostics.recentEvents.map((event) => ({ ...event })),
    };
  }

  setEnabled(enabled: boolean): LibraryWatcherDiagnostics {
    this.diagnostics.enabled = enabled;
    if (!enabled) {
      return this.stop();
    }

    return this.getDiagnostics();
  }

  setAutoRescanEnabled(enabled: boolean): LibraryWatcherDiagnostics {
    this.diagnostics.autoRescanEnabled = enabled;
    if (!enabled) {
      this.clearPendingRescans();
    }

    return this.getDiagnostics();
  }

  syncFolders(reconciliationReason: 'startup' | 'recovery' = 'startup'): LibraryWatcherDiagnostics {
    if (!this.diagnostics.enabled) {
      return this.getDiagnostics();
    }
    if (!this.shouldRun) {
      return this.start(reconciliationReason);
    }

    let folders: LibraryWatcherFolder[];
    try {
      folders = this.readFolders().filter((folder) => folder.enabled !== false);
      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }
      this.watcherErrors.delete('__service__');
      this.restartAttempt = 0;
      this.refreshWatcherError();
    } catch (error) {
      this.handleWatcherServiceError(error);
      return this.getDiagnostics();
    }

    const targetFolders = new Map(folders.map((folder) => [folder.id, folder]));
    this.configuredFolderIds = new Set(targetFolders.keys());
    for (const [folderId, watchedPath] of this.watchedFolderPaths) {
      const target = targetFolders.get(folderId);
      if (!target || resolve(target.path) !== watchedPath) {
        this.removeFolderWatcher(folderId);
      }
    }
    for (const folderId of this.folderRestartTimers.keys()) {
      if (!targetFolders.has(folderId)) {
        this.removeFolderWatcher(folderId);
      }
    }
    for (const folder of folders) {
      if (!this.subscriptions.has(folder.id) && !this.folderRestartTimers.has(folder.id)) {
        this.watchFolder(folder, reconciliationReason);
      }
    }

    this.updateWatchedFolderCount();
    return this.getDiagnostics();
  }

  isRunning(): boolean {
    return (
      this.subscriptions.size > 0 &&
      this.folderRestartTimers.size === 0 &&
      this.restartTimer === null
    );
  }

  private handleRawEvent(event: LibraryWatcherRawEvent): void {
    if (!this.diagnostics.enabled || shouldIgnorePath(event.path)) {
      return;
    }

    const isCueFile = extname(event.path).toLowerCase() === '.cue';
    if (event.eventType === 'directory' || isCueFile) {
      this.diagnostics.totalEventCount += 1;
      if (!this.recordStormWindowEvent(event.folderId)) {
        return;
      }
      this.recordImmediateEvent(event);
      this.scheduleFolderReconciliation(event.folderId);
      return;
    }

    if (!shouldObservePath(event.path)) {
      return;
    }

    this.diagnostics.totalEventCount += 1;
    if (!this.recordStormWindowEvent(event.folderId)) {
      return;
    }

    const eventType = event.eventType;
    const key = `${event.folderId}:${resolve(event.path).toLowerCase()}`;
    const nowMs = this.now();
    const pending = this.pendingEvents.get(key);

    if (pending) {
      pending.eventTypes.add(eventType);
      pending.lastSeenAtMs = nowMs;
      if (pending.debounceTimer) {
        clearTimeout(pending.debounceTimer);
      }
      pending.debounceTimer = setTimeout(() => {
        void this.confirmPendingEvent(key);
      }, this.debounceMs);
      pending.debounceTimer.unref?.();
      return;
    }

    if (this.pendingEvents.size + this.getPendingPathCount() >= this.maxPendingPathCount) {
      this.diagnostics.droppedPathCount += 1;
      this.diagnostics.eventStormCount += 1;
      this.scheduleFolderReconciliation(event.folderId);
      return;
    }

    const debounceTimer = setTimeout(() => {
      void this.confirmPendingEvent(key);
    }, this.debounceMs);
    debounceTimer.unref?.();
    const next: PendingEvent = {
      folderId: event.folderId,
      path: event.path,
      eventTypes: new Set([eventType]),
      firstSeenAtMs: nowMs,
      lastSeenAtMs: nowMs,
      debounceTimer,
      stabilityTimer: null,
      checks: 0,
    };
    this.pendingEvents.set(key, next);
  }

  private async confirmPendingEvent(key: string): Promise<void> {
    const pending = this.pendingEvents.get(key);
    if (!pending) {
      return;
    }

    pending.debounceTimer = null;
    const eventType = coalescedEventType(pending.eventTypes);
    if (eventType === 'unknown') {
      this.recordRecentEvent(pending, eventType, null);
      this.pendingEvents.delete(key);
      return;
    }

    const firstSnapshot = await Promise.resolve(this.statFile(pending.path));
    if (!firstSnapshot) {
      pending.checks += 1;
      if (pending.checks >= this.maxStabilityChecks) {
        if (pending.eventTypes.has('unlink') || pending.eventTypes.has('rename')) {
          this.markPendingPathMissing(pending, 'unlink');
        } else {
          this.recordRecentEvent(pending, eventType, null);
          this.scheduleFolderReconciliation(pending.folderId);
        }
        this.pendingEvents.delete(key);
        return;
      }

      this.schedulePendingRecheck(key, pending);
      return;
    }

    pending.checks += 1;
    pending.stabilityTimer = setTimeout(() => {
      void (async () => {
        pending.stabilityTimer = null;
        const secondSnapshot = await Promise.resolve(this.statFile(pending.path));
        if (isSameSnapshot(firstSnapshot, secondSnapshot)) {
          const stableEventType =
            pending.eventTypes.has('add') || pending.eventTypes.has('rename') || pending.eventTypes.has('unlink')
              ? 'add'
              : eventType;
          this.recordRecentEvent(pending, stableEventType, secondSnapshot);
          this.enqueueAutoRescan(pending.folderId, pending.path, stableEventType, secondSnapshot);
          this.pendingEvents.delete(key);
          return;
        }

        if (pending.checks >= this.maxStabilityChecks) {
          this.recordRecentEvent(pending, eventType, null);
          this.scheduleFolderReconciliation(pending.folderId);
          this.pendingEvents.delete(key);
          return;
        }

        await this.confirmPendingEvent(key);
      })();
    }, this.stabilityPollMs);
    pending.stabilityTimer.unref?.();
  }

  private schedulePendingRecheck(key: string, pending: PendingEvent): void {
    pending.stabilityTimer = setTimeout(() => {
      void this.confirmPendingEvent(key);
    }, this.stabilityPollMs);
    pending.stabilityTimer.unref?.();
  }

  private markPendingPathMissing(pending: PendingEvent, eventType: LibraryWatcherEventType): void {
    this.recordRecentEvent(pending, eventType, null);
    let shouldAutoHideDeleted = true;
    try {
      shouldAutoHideDeleted = this.rescanCoordinator?.shouldAutoHideDeleted?.() ?? true;
    } catch (error) {
      shouldAutoHideDeleted = false;
      this.diagnostics.lastRescanError = error instanceof Error ? error.message : String(error);
    }

    if (this.diagnostics.autoRescanEnabled && shouldAutoHideDeleted && this.rescanCoordinator?.markMissingPaths) {
      try {
        const result = this.rescanCoordinator.markMissingPaths(pending.folderId, [pending.path]);
        this.diagnostics.triggeredRescanCount += 1;
        this.diagnostics.lastTriggeredRescanAt = toIso(this.now());
        this.diagnostics.lastRescanError = null;
        void Promise.resolve(result).catch((error) => {
          this.diagnostics.lastRescanError = error instanceof Error ? error.message : String(error);
        });
      } catch (error) {
        this.diagnostics.lastRescanError = error instanceof Error ? error.message : String(error);
      }
    } else {
      this.diagnostics.skippedDeleteEventCount += 1;
    }
  }

  private recordRecentEvent(pending: PendingEvent, eventType: LibraryWatcherEventType, snapshot: FileStatSnapshot | null): void {
    const nowMs = this.now();
    const event: LibraryWatcherRecentEvent = {
      timestamp: toIso(nowMs),
      folderId: pending.folderId,
      eventType,
      path: pending.path,
      extension: extname(pending.path).toLowerCase(),
      stableForMs: nowMs - pending.firstSeenAtMs,
    };

    if (snapshot) {
      event.sizeBytes = snapshot.sizeBytes;
      event.mtimeMs = snapshot.mtimeMs;
    }

    this.diagnostics.recentEvents.push(event);
    if (this.diagnostics.recentEvents.length > recentEventLimit) {
      this.diagnostics.recentEvents = this.diagnostics.recentEvents.slice(-recentEventLimit);
    }
  }

  private recordImmediateEvent(event: LibraryWatcherRawEvent): void {
    const nowMs = this.now();
    this.diagnostics.recentEvents.push({
      timestamp: toIso(nowMs),
      folderId: event.folderId,
      eventType: event.eventType,
      path: event.path,
      extension: extname(event.path).toLowerCase(),
      stableForMs: 0,
    });
    if (this.diagnostics.recentEvents.length > recentEventLimit) {
      this.diagnostics.recentEvents = this.diagnostics.recentEvents.slice(-recentEventLimit);
    }
  }

  private enqueueAutoRescan(
    folderId: string,
    filePath: string,
    eventType: LibraryWatcherEventType,
    snapshot: FileStatSnapshot | null,
  ): void {
    if (!this.diagnostics.autoRescanEnabled || !this.rescanCoordinator || !snapshot || (eventType !== 'add' && eventType !== 'change')) {
      return;
    }

    const normalizedPath = resolve(filePath);
    const folderPaths = this.pendingRescanPaths.get(folderId) ?? new Set<string>();
    const alreadyQueued = folderPaths.has(normalizedPath);

    if (!alreadyQueued && this.getPendingPathCount() >= this.maxPendingPathCount) {
      this.diagnostics.droppedPathCount += 1;
      this.diagnostics.eventStormCount += 1;
      this.scheduleFolderReconciliation(folderId);
      return;
    }

    folderPaths.add(normalizedPath);
    this.pendingRescanPaths.set(folderId, folderPaths);
    if (!this.pendingRescanStartedAtMs.has(folderId)) {
      this.pendingRescanStartedAtMs.set(folderId, this.now());
    }
    this.updatePendingPathCount();
    this.scheduleRescanFlush(folderId);
  }

  private scheduleRescanFlush(folderId: string): void {
    const existing = this.rescanTimers.get(folderId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      void this.flushRescanFolder(folderId);
    }, this.rescanDebounceMs);
    timer.unref?.();
    this.rescanTimers.set(folderId, timer);
  }

  private async flushRescanFolder(folderId: string): Promise<void> {
    this.rescanTimers.delete(folderId);
    const paths = this.pendingRescanPaths.get(folderId);
    if (!paths || paths.size === 0) {
      this.updatePendingPathCount();
      return;
    }

    if (this.folderRescansInFlight.has(folderId) || this.rescanCoordinator?.hasRunningJobs?.() === true) {
      this.scheduleRescanFlush(folderId);
      return;
    }

    try {
      const queuedAtMs = this.pendingRescanStartedAtMs.get(folderId) ?? this.now();
      const deferralExpired = this.now() - queuedAtMs >= this.maxRescanDeferralMs;
      if (!deferralExpired && (await Promise.resolve(this.rescanCoordinator?.shouldDelayRescan?.() ?? false))) {
        await this.previewDelayedRescanPaths(folderId, paths);
        this.scheduleRescanFlush(folderId);
        return;
      }
    } catch (error) {
      this.diagnostics.lastRescanError = error instanceof Error ? error.message : String(error);
      this.scheduleRescanFlush(folderId);
      return;
    }

    const allPaths = Array.from(paths);
    if (allPaths.length > this.maxRescanBatchSize) {
      await this.previewDelayedRescanPaths(folderId, paths);
    }

    const batch = allPaths.slice(0, this.maxRescanBatchSize);
    for (const filePath of batch) {
      paths.delete(filePath);
    }
    if (paths.size === 0) {
      this.pendingRescanPaths.delete(folderId);
    }
    const previewed = this.previewedRescanPaths.get(folderId);
    if (previewed) {
      for (const filePath of batch) {
        previewed.delete(filePath);
      }
      if (previewed.size === 0) {
        this.previewedRescanPaths.delete(folderId);
      }
    }
    this.updatePendingPathCount();
    this.folderRescansInFlight.add(folderId);

    try {
      const result = this.rescanCoordinator?.rescanPaths(folderId, batch);
      this.diagnostics.triggeredRescanCount += 1;
      this.diagnostics.lastTriggeredRescanAt = toIso(this.now());
      this.diagnostics.lastRescanError = null;
      if ((this.pendingRescanPaths.get(folderId)?.size ?? 0) === 0) {
        this.pendingRescanStartedAtMs.delete(folderId);
      }
      void Promise.resolve(result)
        .catch((error) => {
          this.diagnostics.lastRescanError = error instanceof Error ? error.message : String(error);
          if (
            !this.diagnostics.autoRescanEnabled ||
            !this.shouldRun ||
            !this.configuredFolderIds.has(folderId)
          ) {
            return;
          }
          const merged = this.pendingRescanPaths.get(folderId) ?? new Set<string>();
          for (const filePath of batch) {
            merged.add(filePath);
          }
          this.pendingRescanPaths.set(folderId, merged);
          if (!this.pendingRescanStartedAtMs.has(folderId)) {
            this.pendingRescanStartedAtMs.set(folderId, this.now());
          }
          this.updatePendingPathCount();
        })
        .finally(() => {
          this.folderRescansInFlight.delete(folderId);
          if ((this.pendingRescanPaths.get(folderId)?.size ?? 0) > 0) {
            this.scheduleRescanFlush(folderId);
          }
        });
    } catch (error) {
      this.diagnostics.lastRescanError = error instanceof Error ? error.message : String(error);
      const merged = this.pendingRescanPaths.get(folderId) ?? new Set<string>();
      for (const filePath of batch) {
        merged.add(filePath);
      }
      this.pendingRescanPaths.set(folderId, merged);
      if (!this.pendingRescanStartedAtMs.has(folderId)) {
        this.pendingRescanStartedAtMs.set(folderId, this.now());
      }
      this.updatePendingPathCount();
      this.folderRescansInFlight.delete(folderId);
      this.scheduleRescanFlush(folderId);
    }
  }

  private scheduleFolderReconciliation(
    folderId: string,
    delayMs = this.reconciliationDebounceMs,
    maxDeferralMs?: number,
    reason: 'startup' | 'recovery' = 'recovery',
  ): void {
    if (
      !this.diagnostics.autoRescanEnabled ||
      !this.subscriptions.has(folderId) ||
      !this.rescanCoordinator?.reconcileFolder
    ) {
      return;
    }

    if (!this.pendingReconciliationStartedAtMs.has(folderId)) {
      this.pendingReconciliationStartedAtMs.set(folderId, this.now());
    }
    const existingMaxDeferralMs = this.pendingReconciliationMaxDeferralMs.get(folderId);
    if (existingMaxDeferralMs === undefined) {
      this.pendingReconciliationMaxDeferralMs.set(folderId, maxDeferralMs ?? this.maxRescanDeferralMs);
    } else if (maxDeferralMs !== undefined) {
      this.pendingReconciliationMaxDeferralMs.set(folderId, Math.min(existingMaxDeferralMs, maxDeferralMs));
    }
    if (reason === 'recovery' || !this.pendingReconciliationReasons.has(folderId)) {
      this.pendingReconciliationReasons.set(folderId, reason);
    }
    const dueAtMs = this.now() + delayMs;
    const existingTimer = this.reconciliationTimers.get(folderId);
    if (existingTimer) {
      const existingDueAtMs = this.reconciliationDueAtMs.get(folderId) ?? dueAtMs;
      if (existingDueAtMs <= dueAtMs) {
        return;
      }
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      void this.flushFolderReconciliation(folderId);
    }, delayMs);
    timer.unref?.();
    this.reconciliationTimers.set(folderId, timer);
    this.reconciliationDueAtMs.set(folderId, dueAtMs);
  }

  private async flushFolderReconciliation(folderId: string): Promise<void> {
    this.reconciliationTimers.delete(folderId);
    this.reconciliationDueAtMs.delete(folderId);
    if (!this.pendingReconciliationStartedAtMs.has(folderId)) {
      return;
    }
    const reconcileFolder = this.rescanCoordinator?.reconcileFolder;
    if (!reconcileFolder) {
      this.pendingReconciliationStartedAtMs.delete(folderId);
      this.pendingReconciliationMaxDeferralMs.delete(folderId);
      this.pendingReconciliationReasons.delete(folderId);
      return;
    }

    if (this.folderReconciliationsInFlight.has(folderId) || this.rescanCoordinator?.hasRunningJobs?.() === true) {
      this.rescheduleFolderReconciliation(folderId);
      return;
    }

    try {
      const requestedAtMs = this.pendingReconciliationStartedAtMs.get(folderId) ?? this.now();
      const maxDeferralMs = this.pendingReconciliationMaxDeferralMs.get(folderId) ?? this.maxRescanDeferralMs;
      const deferralExpired = this.now() - requestedAtMs >= maxDeferralMs;
      if (!deferralExpired && (await Promise.resolve(this.rescanCoordinator?.shouldDelayRescan?.() ?? false))) {
        this.rescheduleFolderReconciliation(folderId);
        return;
      }
    } catch (error) {
      this.diagnostics.lastRescanError = error instanceof Error ? error.message : String(error);
      this.rescheduleFolderReconciliation(folderId);
      return;
    }

    this.folderReconciliationsInFlight.add(folderId);
    try {
      const result = reconcileFolder(folderId, {
        reason: this.pendingReconciliationReasons.get(folderId) ?? 'recovery',
      });
      this.diagnostics.triggeredRescanCount += 1;
      this.diagnostics.lastTriggeredRescanAt = toIso(this.now());
      this.diagnostics.lastRescanError = null;
      await Promise.resolve(result);
      this.pendingReconciliationStartedAtMs.delete(folderId);
      this.pendingReconciliationMaxDeferralMs.delete(folderId);
      this.pendingReconciliationReasons.delete(folderId);
    } catch (error) {
      this.diagnostics.lastRescanError = error instanceof Error ? error.message : String(error);
      this.rescheduleFolderReconciliation(folderId);
    } finally {
      this.folderReconciliationsInFlight.delete(folderId);
    }
  }

  private rescheduleFolderReconciliation(folderId: string): void {
    this.scheduleFolderReconciliation(
      folderId,
      this.reconciliationDebounceMs,
      undefined,
      this.pendingReconciliationReasons.get(folderId) ?? 'recovery',
    );
  }

  private async previewDelayedRescanPaths(folderId: string, paths: Set<string>): Promise<void> {
    if (!this.rescanCoordinator?.previewRescanPaths) {
      return;
    }

    const previewed = this.previewedRescanPaths.get(folderId) ?? new Set<string>();
    const batch = Array.from(paths).filter((filePath) => !previewed.has(filePath));
    if (batch.length === 0) {
      return;
    }

    try {
      await Promise.resolve(this.rescanCoordinator.previewRescanPaths(folderId, batch));
      for (const filePath of batch) {
        previewed.add(filePath);
      }
      this.previewedRescanPaths.set(folderId, previewed);
    } catch (error) {
      this.diagnostics.lastRescanError = error instanceof Error ? error.message : String(error);
    }
  }

  private recordStormWindowEvent(folderId: string): boolean {
    const eventCount = (this.stormWindowEventCounts.get(folderId) ?? 0) + 1;
    this.stormWindowEventCounts.set(folderId, eventCount);
    if (eventCount > this.stormThreshold && !this.stormWindowTrippedFolders.has(folderId)) {
      this.diagnostics.eventStormCount += 1;
      this.stormWindowTrippedFolders.add(folderId);
      this.scheduleFolderReconciliation(folderId);
    }

    if (!this.stormWindowTimer) {
      this.stormWindowTimer = setTimeout(() => {
        this.stormWindowTimer = null;
        this.stormWindowEventCounts.clear();
        this.stormWindowTrippedFolders.clear();
      }, this.stormWindowMs);
      this.stormWindowTimer.unref?.();
    }

    return eventCount <= this.stormThreshold;
  }

  private clearPendingEvents(): void {
    for (const pending of this.pendingEvents.values()) {
      if (pending.debounceTimer) {
        clearTimeout(pending.debounceTimer);
      }
      if (pending.stabilityTimer) {
        clearTimeout(pending.stabilityTimer);
      }
    }
    this.pendingEvents.clear();
  }

  private clearPendingRescans(): void {
    for (const timer of this.rescanTimers.values()) {
      clearTimeout(timer);
    }
    this.rescanTimers.clear();
    this.pendingRescanPaths.clear();
    this.pendingRescanStartedAtMs.clear();
    this.previewedRescanPaths.clear();
    this.folderRescansInFlight.clear();
    for (const timer of this.reconciliationTimers.values()) {
      clearTimeout(timer);
    }
    this.reconciliationTimers.clear();
    this.reconciliationDueAtMs.clear();
    this.pendingReconciliationStartedAtMs.clear();
    this.pendingReconciliationMaxDeferralMs.clear();
    this.pendingReconciliationReasons.clear();
    this.folderReconciliationsInFlight.clear();
    this.updatePendingPathCount();
  }

  private getPendingPathCount(): number {
    let count = 0;
    for (const paths of this.pendingRescanPaths.values()) {
      count += paths.size;
    }
    return count;
  }

  private updatePendingPathCount(): void {
    this.diagnostics.pendingPathCount = this.getPendingPathCount();
  }

  private watchFolder(folder: LibraryWatcherFolder, reconciliationReason: 'startup' | 'recovery'): void {
    let subscription: LibraryWatcherSubscription;
    try {
      subscription = this.adapter.watch(
        folder,
        (event) => this.handleRawEvent(event),
        (error) => this.handleWatcherError(folder.id, error),
      );
    } catch (error) {
      this.handleWatcherError(folder.id, error);
      return;
    }

    if (subscription.active === false) {
      if (!this.folderRestartTimers.has(folder.id)) {
        this.handleWatcherError(folder.id, new Error(`Could not watch library folder: ${folder.path}`));
      }
      return;
    }
    if (this.folderRestartTimers.has(folder.id)) {
      try {
        subscription.close();
      } catch (error) {
        this.recordError(error);
      }
      return;
    }

    this.subscriptions.set(folder.id, subscription);
    this.watchedFolderPaths.set(folder.id, resolve(folder.path));
    this.folderRestartAttempts.delete(folder.id);
    this.watcherErrors.delete(folder.id);
    this.refreshWatcherError();
    this.updateWatchedFolderCount();
    this.scheduleFolderReconciliation(
      folder.id,
      this.startupReconciliationDelayMs,
      Number.POSITIVE_INFINITY,
      reconciliationReason,
    );
  }

  private handleWatcherError(folderId: string, error: unknown): void {
    this.watcherErrors.set(folderId, error instanceof Error ? error.message : String(error));
    this.refreshWatcherError();
    if (!this.shouldRun || !this.diagnostics.enabled) {
      return;
    }

    if (!this.folderRestartTimers.has(folderId)) {
      const restartAttempt = this.folderRestartAttempts.get(folderId) ?? 0;
      const retryDelayMs = Math.min(
        this.maxRestartDelayMs,
        this.restartDelayMs * (2 ** Math.min(restartAttempt, 10)),
      );
      this.folderRestartAttempts.set(folderId, restartAttempt + 1);
      const timer = setTimeout(() => {
        this.folderRestartTimers.delete(folderId);
        if (!this.shouldRun || !this.diagnostics.enabled) {
          return;
        }

        let folder: LibraryWatcherFolder | undefined;
        try {
          folder = this.readFolders().find((candidate) => candidate.id === folderId && candidate.enabled !== false);
        } catch (readError) {
          this.handleWatcherServiceError(readError);
          return;
        }
        if (!folder) {
          this.folderRestartAttempts.delete(folderId);
          this.watcherErrors.delete(folderId);
          this.refreshWatcherError();
          return;
        }
        this.watchFolder(folder, 'recovery');
      }, retryDelayMs);
      timer.unref?.();
      this.folderRestartTimers.set(folderId, timer);
    }

    const subscription = this.subscriptions.get(folderId);
    this.subscriptions.delete(folderId);
    this.watchedFolderPaths.delete(folderId);
    this.clearPendingFolderWork(folderId);
    this.updateWatchedFolderCount();
    if (subscription) {
      try {
        subscription.close();
      } catch (closeError) {
        this.recordError(closeError);
      }
    }
  }

  private handleWatcherServiceError(error: unknown): void {
    this.watcherErrors.set('__service__', error instanceof Error ? error.message : String(error));
    this.refreshWatcherError();
    if (!this.shouldRun || !this.diagnostics.enabled || this.restartTimer) {
      return;
    }

    const retryDelayMs = Math.min(
      this.maxRestartDelayMs,
      this.restartDelayMs * (2 ** Math.min(this.restartAttempt, 10)),
    );
    this.restartAttempt += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.shouldRun || !this.diagnostics.enabled) {
        return;
      }
      this.syncFolders('recovery');
    }, retryDelayMs);
    this.restartTimer.unref?.();
  }

  private removeFolderWatcher(folderId: string): void {
    const restartTimer = this.folderRestartTimers.get(folderId);
    if (restartTimer) {
      clearTimeout(restartTimer);
      this.folderRestartTimers.delete(folderId);
    }
    this.folderRestartAttempts.delete(folderId);
    this.watcherErrors.delete(folderId);

    const subscription = this.subscriptions.get(folderId);
    this.subscriptions.delete(folderId);
    this.watchedFolderPaths.delete(folderId);
    if (subscription) {
      try {
        subscription.close();
      } catch (error) {
        this.recordError(error);
      }
    }

    this.clearPendingFolderWork(folderId);
    this.refreshWatcherError();
    this.updateWatchedFolderCount();
  }

  private clearPendingFolderWork(folderId: string): void {
    for (const [key, pending] of this.pendingEvents) {
      if (pending.folderId !== folderId) {
        continue;
      }
      if (pending.debounceTimer) {
        clearTimeout(pending.debounceTimer);
      }
      if (pending.stabilityTimer) {
        clearTimeout(pending.stabilityTimer);
      }
      this.pendingEvents.delete(key);
    }

    const rescanTimer = this.rescanTimers.get(folderId);
    if (rescanTimer) {
      clearTimeout(rescanTimer);
    }
    this.rescanTimers.delete(folderId);
    this.pendingRescanPaths.delete(folderId);
    this.pendingRescanStartedAtMs.delete(folderId);
    this.previewedRescanPaths.delete(folderId);

    const reconciliationTimer = this.reconciliationTimers.get(folderId);
    if (reconciliationTimer) {
      clearTimeout(reconciliationTimer);
    }
    this.reconciliationTimers.delete(folderId);
    this.reconciliationDueAtMs.delete(folderId);
    this.pendingReconciliationStartedAtMs.delete(folderId);
    this.pendingReconciliationMaxDeferralMs.delete(folderId);
    this.pendingReconciliationReasons.delete(folderId);
    this.updatePendingPathCount();
  }

  private updateWatchedFolderCount(): void {
    this.diagnostics.watchedFolderCount = this.subscriptions.size;
  }

  private refreshWatcherError(): void {
    this.diagnostics.lastError = Array.from(this.watcherErrors.values()).at(-1) ?? null;
  }

  private clearStormWindow(): void {
    if (this.stormWindowTimer) {
      clearTimeout(this.stormWindowTimer);
      this.stormWindowTimer = null;
    }
    this.stormWindowEventCounts.clear();
    this.stormWindowTrippedFolders.clear();
  }

  private recordError(error: unknown): void {
    this.diagnostics.lastError = error instanceof Error ? error.message : String(error);
  }
}
