import { watch as watchFileSystem, statSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { stat as statFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { SCANNABLE_AUDIO_EXTENSIONS } from '../../shared/constants/audioExtensions';

export type LibraryWatcherEventType = 'add' | 'change' | 'unlink' | 'rename' | 'unknown';

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
  previewRescanPaths?: (folderId: string, paths: string[]) => unknown;
  hasRunningJobs?: () => boolean;
  shouldDelayRescan?: () => boolean | Promise<boolean>;
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

const shouldObservePath = (filePath: string): boolean => {
  if (isHiddenPath(filePath) || isClearlyTemporaryPath(filePath)) {
    return false;
  }

  return SCANNABLE_AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase());
};

export const classifyNodeWatcherEvent = (eventType: string, filePath: string): LibraryWatcherEventType => {
  if (eventType === 'change') {
    return 'change';
  }

  if (eventType === 'rename') {
    return defaultStatFileSync(filePath) ? 'add' : 'unlink';
  }

  return 'unknown';
};

const classifyNodeWatcherEventAsync = async (eventType: string, filePath: string): Promise<LibraryWatcherEventType> => {
  if (eventType === 'change') {
    return 'change';
  }

  if (eventType === 'rename') {
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

    try {
      watcher = watchFileSystem(folder.path, { recursive: true }, (eventType, fileName) => {
        if (!fileName) {
          return;
        }

        const fullPath = resolve(folder.path, String(fileName));
        void classifyNodeWatcherEventAsync(eventType, fullPath)
          .then((classifiedEventType) => {
            onEvent({
              folderId: folder.id,
              eventType: classifiedEventType,
              path: fullPath,
            });
          })
          .catch(onError);
      });
      watcher.on('error', onError);
    } catch (error) {
      onError(error);
    }

    return {
      close: () => {
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
  private readonly stabilityPollMs: number;
  private readonly maxStabilityChecks: number;
  private readonly maxPendingPathCount: number;
  private readonly maxRescanBatchSize: number;
  private readonly stormWindowMs: number;
  private readonly stormThreshold: number;
  private readonly readFolders: () => LibraryWatcherFolder[];
  private diagnostics: LibraryWatcherDiagnostics;
  private subscriptions: LibraryWatcherSubscription[] = [];
  private pendingEvents = new Map<string, PendingEvent>();
  private pendingRescanPaths = new Map<string, Set<string>>();
  private previewedRescanPaths = new Map<string, Set<string>>();
  private rescanTimers = new Map<string, NodeJS.Timeout>();
  private folderRescansInFlight = new Set<string>();
  private stormWindowTimer: NodeJS.Timeout | null = null;
  private stormWindowEventCount = 0;
  private stormWindowTripped = false;

  constructor(options: LibraryWatcherServiceOptions) {
    this.adapter = options.adapter ?? new NodeFileSystemWatcherAdapter();
    this.statFile = options.statFile ?? defaultStatFile;
    this.rescanCoordinator = options.rescanCoordinator ?? null;
    this.now = options.now ?? Date.now;
    this.debounceMs = options.debounceMs ?? 500;
    this.rescanDebounceMs = options.rescanDebounceMs ?? 1000;
    this.stabilityPollMs = options.stabilityPollMs ?? 300;
    this.maxStabilityChecks = options.maxStabilityChecks ?? 3;
    this.maxPendingPathCount = options.maxPendingPathCount ?? 1000;
    this.maxRescanBatchSize = Math.max(1, Math.floor(options.maxRescanBatchSize ?? defaultMaxRescanBatchSize));
    this.stormWindowMs = options.stormWindowMs ?? 1000;
    this.stormThreshold = options.stormThreshold ?? 200;
    this.readFolders = options.readFolders;
    this.diagnostics = createEmptyDiagnostics(options.enabled === true, options.autoRescanEnabled === true);
  }

  start(): LibraryWatcherDiagnostics {
    if (!this.diagnostics.enabled) {
      return this.getDiagnostics();
    }

    if (this.subscriptions.length > 0) {
      return this.getDiagnostics();
    }

    const startedAtMs = this.now();
    this.diagnostics.startedAt = toIso(startedAtMs);
    this.diagnostics.stoppedAt = null;
    this.diagnostics.lastError = null;

    try {
      const folders = this.readFolders().filter((folder) => folder.enabled !== false);
      for (const folder of folders) {
        const subscription = this.adapter.watch(
          folder,
          (event) => this.handleRawEvent(event),
          (error) => this.recordError(error),
        );
        this.subscriptions.push(subscription);
      }
      this.diagnostics.watchedFolderCount = this.subscriptions.length;
    } catch (error) {
      this.recordError(error);
    }

    return this.getDiagnostics();
  }

  stop(): LibraryWatcherDiagnostics {
    if (this.subscriptions.length > 0) {
      for (const subscription of this.subscriptions) {
        try {
          subscription.close();
        } catch (error) {
          this.recordError(error);
        }
      }
    }

    this.subscriptions = [];
    this.diagnostics.watchedFolderCount = 0;
    this.diagnostics.stoppedAt = toIso(this.now());
    this.clearPendingEvents();
    this.clearPendingRescans();
    this.clearStormWindow();
    return this.getDiagnostics();
  }

  restart(): LibraryWatcherDiagnostics {
    this.stop();
    return this.start();
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

  isRunning(): boolean {
    return this.subscriptions.length > 0;
  }

  private handleRawEvent(event: LibraryWatcherRawEvent): void {
    if (!this.diagnostics.enabled || !shouldObservePath(event.path)) {
      return;
    }

    this.diagnostics.totalEventCount += 1;
    this.recordStormWindowEvent();

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
    if (eventType === 'unlink') {
      this.markPendingPathMissing(pending, eventType);
      this.pendingEvents.delete(key);
      return;
    }

    if (eventType === 'unknown') {
      this.recordRecentEvent(pending, eventType, null);
      this.pendingEvents.delete(key);
      return;
    }

    const firstSnapshot = await Promise.resolve(this.statFile(pending.path));
    if (!firstSnapshot) {
      pending.checks += 1;
      if (pending.checks >= this.maxStabilityChecks) {
        if (eventType === 'rename') {
          this.markPendingPathMissing(pending, 'unlink');
        } else {
          this.recordRecentEvent(pending, eventType, null);
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
          const stableEventType = eventType === 'rename' ? 'add' : eventType;
          this.recordRecentEvent(pending, stableEventType, secondSnapshot);
          this.enqueueAutoRescan(pending.folderId, pending.path, stableEventType, secondSnapshot);
          this.pendingEvents.delete(key);
          return;
        }

        if (pending.checks >= this.maxStabilityChecks) {
          this.recordRecentEvent(pending, eventType, null);
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
    if (this.diagnostics.autoRescanEnabled && this.rescanCoordinator?.markMissingPaths) {
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
      return;
    }

    folderPaths.add(normalizedPath);
    this.pendingRescanPaths.set(folderId, folderPaths);
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
      if (await Promise.resolve(this.rescanCoordinator?.shouldDelayRescan?.() ?? false)) {
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
      void Promise.resolve(result).finally(() => {
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
      this.updatePendingPathCount();
      this.folderRescansInFlight.delete(folderId);
    }
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

  private recordStormWindowEvent(): void {
    this.stormWindowEventCount += 1;
    if (this.stormWindowEventCount > this.stormThreshold && !this.stormWindowTripped) {
      this.diagnostics.eventStormCount += 1;
      this.stormWindowTripped = true;
    }

    if (!this.stormWindowTimer) {
      this.stormWindowTimer = setTimeout(() => {
        this.stormWindowTimer = null;
        this.stormWindowEventCount = 0;
        this.stormWindowTripped = false;
      }, this.stormWindowMs);
      this.stormWindowTimer.unref?.();
    }
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
    this.previewedRescanPaths.clear();
    this.folderRescansInFlight.clear();
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

  private clearStormWindow(): void {
    if (this.stormWindowTimer) {
      clearTimeout(this.stormWindowTimer);
      this.stormWindowTimer = null;
    }
    this.stormWindowEventCount = 0;
    this.stormWindowTripped = false;
  }

  private recordError(error: unknown): void {
    this.diagnostics.lastError = error instanceof Error ? error.message : String(error);
  }
}
