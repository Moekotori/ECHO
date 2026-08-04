import { existsSync } from 'node:fs';
import { join } from 'node:path';
import electron from 'electron';
import Database from 'better-sqlite3';
import {
  assertProtectedLibraryAvailable,
  getLastDataProtectionResult,
  isProtectedLibraryAvailable,
} from '../app/dataProtection';
import { getAppSettings } from '../app/appSettings';
import { createDatabase, sqliteDurabilityModeFromSettings, type EchoDatabase } from './createDatabase';
import {
  checkDatabaseHealth,
  isSqliteCorruptionMessage,
  type DatabaseHealthResult,
} from './health';
import type { LibraryDatabaseManagerStateInfo } from '../../shared/types/library';

export type LibraryDatabaseConnection = {
  id: string;
  serviceName: string;
  databasePath: string;
  database: EchoDatabase;
  close: () => void;
};

type LibraryDatabaseConnectionRecord = {
  id: string;
  serviceName: string;
  databasePath: string;
  database: EchoDatabase;
  openedAt: string;
  close: () => void;
};

type LibraryDatabaseManagerOptions = {
  assertLibraryAvailable?: () => void;
};

const nowIso = (): string => new Date().toISOString();

const ok = (databasePath: string, message?: string): DatabaseHealthResult => ({
  status: 'ok',
  databasePath,
  checkedAt: nowIso(),
  ...(message ? { message } : {}),
});

const failed = (databasePath: string, error: unknown): DatabaseHealthResult => {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: isSqliteCorruptionMessage(message) ? 'corrupt' : 'unreadable',
    databasePath,
    checkedAt: nowIso(),
    message,
  };
};

export class LibraryDatabaseManager {
  private readonly connections = new Map<string, LibraryDatabaseConnectionRecord>();
  private readonly assertLibraryAvailable: () => void;
  private connectionSequence = 0;
  private primaryConnection: LibraryDatabaseConnection | null = null;
  private maintenanceChain: Promise<unknown> = Promise.resolve();
  private activeMaintenanceReason: string | null = null;
  private lastCheckpointAt: string | null = null;
  private lastCheckpointReason: string | null = null;
  private lastCheckpointHealth: DatabaseHealthResult | null = null;
  private lastCloseReason: string | null = null;

  constructor(readonly databasePath: string, options: LibraryDatabaseManagerOptions = {}) {
    this.assertLibraryAvailable = options.assertLibraryAvailable ?? assertProtectedLibraryAvailable;
  }

  getDatabase(): EchoDatabase {
    if (!this.primaryConnection || !this.connections.has(this.primaryConnection.id)) {
      this.primaryConnection = this.openServiceConnection('library');
    }

    return this.primaryConnection.database;
  }

  openServiceConnection(serviceName: string): LibraryDatabaseConnection {
    this.assertCanOpen(serviceName);

    const database = createDatabase(this.databasePath, {
      durabilityMode: sqliteDurabilityModeFromSettings(getAppSettings()),
    });
    const id = `${serviceName}-${Date.now()}-${++this.connectionSequence}`;
    let open = true;
    const close = (): void => {
      if (!open) {
        return;
      }

      open = false;
      this.connections.delete(id);
      if (this.primaryConnection?.id === id) {
        this.primaryConnection = null;
      }

      database.close();
    };
    const record: LibraryDatabaseConnectionRecord = {
      id,
      serviceName,
      databasePath: this.databasePath,
      database,
      openedAt: nowIso(),
      close,
    };
    this.connections.set(id, record);

    return {
      id,
      serviceName,
      databasePath: this.databasePath,
      database,
      close,
    };
  }

  closeAllUsers(reason: string): void {
    this.lastCloseReason = reason;
    const records = [...this.connections.values()].reverse();

    for (const record of records) {
      try {
        record.close();
      } catch (error) {
        console.warn(`[database-manager] Failed to close ${record.serviceName} database connection for ${reason}:`, error);
      }
    }

    this.primaryConnection = null;
  }

  checkpoint(reason: string): DatabaseHealthResult {
    const health = this.performPassiveCheckpoint();
    this.lastCheckpointAt = health.checkedAt;
    this.lastCheckpointReason = reason;
    this.lastCheckpointHealth = health;
    return health;
  }

  async runExclusiveMaintenance<T>(reason: string, action: () => T | Promise<T>): Promise<T> {
    const run = this.maintenanceChain
      .catch(() => undefined)
      .then(async () => {
        this.activeMaintenanceReason = reason;
        this.closeAllUsers(reason);
        try {
          return await action();
        } finally {
          this.activeMaintenanceReason = null;
        }
      });

    this.maintenanceChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  getState(): LibraryDatabaseManagerStateInfo {
    const recovery = getLastDataProtectionResult()?.recovery ?? null;
    return {
      databasePath: this.databasePath,
      openConnections: this.connections.size,
      connectionServiceNames: [...new Set([...this.connections.values()].map((record) => record.serviceName))],
      maintenanceInProgress: this.activeMaintenanceReason !== null,
      activeMaintenanceReason: this.activeMaintenanceReason,
      lastCloseReason: this.lastCloseReason,
      lastCheckpointAt: this.lastCheckpointAt,
      lastCheckpointReason: this.lastCheckpointReason,
      lastCheckpointHealth: this.lastCheckpointHealth,
      protected: !isProtectedLibraryAvailable(),
      protectionRecoveryAction: recovery?.action ?? null,
    };
  }

  private assertCanOpen(serviceName: string): void {
    if (this.activeMaintenanceReason) {
      throw new Error(`Library database maintenance is in progress: ${this.activeMaintenanceReason}`);
    }

    try {
      this.assertLibraryAvailable();
    } catch (error) {
      console.warn(`[database-manager] Refusing to open ${serviceName} while library database is protected.`, error);
      throw error;
    }
  }

  private performPassiveCheckpoint(): DatabaseHealthResult {
    if (this.databasePath === ':memory:') {
      return ok(this.databasePath, 'in-memory database');
    }

    if (!existsSync(this.databasePath)) {
      return ok(this.databasePath, 'database does not exist yet');
    }

    const existingConnection = this.connections.values().next().value as LibraryDatabaseConnectionRecord | undefined;
    if (existingConnection) {
      try {
        existingConnection.database.pragma('wal_checkpoint(PASSIVE)');
        return checkDatabaseHealth(this.databasePath);
      } catch (error) {
        return failed(this.databasePath, error);
      }
    }

    let database: Database.Database | null = null;
    try {
      database = new Database(this.databasePath, { fileMustExist: true });
      database.pragma('wal_checkpoint(PASSIVE)');
      return checkDatabaseHealth(this.databasePath);
    } catch (error) {
      return failed(this.databasePath, error);
    } finally {
      try {
        database?.close();
      } catch {
        // Checkpoint already captured the meaningful result.
      }
    }
  }
}

let defaultLibraryDatabaseManager: LibraryDatabaseManager | null = null;

export const createLibraryDatabaseManager = (
  databasePath: string,
  options: LibraryDatabaseManagerOptions = {},
): LibraryDatabaseManager => new LibraryDatabaseManager(databasePath, options);

export const getLibraryDatabaseManager = (): LibraryDatabaseManager => {
  if (!defaultLibraryDatabaseManager) {
    const electronApp = (electron as unknown as { app?: { getPath: (name: string) => string } }).app;

    if (!electronApp) {
      throw new Error('Electron app module is unavailable outside the Electron main process');
    }

    defaultLibraryDatabaseManager = new LibraryDatabaseManager(join(electronApp.getPath('userData'), 'echo-library.sqlite'));
  }

  return defaultLibraryDatabaseManager;
};

export const closeDefaultLibraryDatabaseManager = (): void => {
  if (!defaultLibraryDatabaseManager) {
    return;
  }

  defaultLibraryDatabaseManager.closeAllUsers('close-default-manager');
  defaultLibraryDatabaseManager = null;
};
