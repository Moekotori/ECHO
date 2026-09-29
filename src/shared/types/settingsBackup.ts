import type { AppSettings } from './appSettings';

export type SettingsBackupPayload = {
  format: 'echo-next-settings-backup';
  version: 1;
  exportedAt: string;
  appVersion: string;
  settings: AppSettings;
};

export type SettingsImportResult = {
  settings: AppSettings;
  backupPath: string;
  importedPath: string;
  warnings: string[];
};

export type DataPackageExportResult = {
  filePath: string;
  exportedAt: string;
  snapshotPath: string;
  includedEntries: string[];
  skippedEntries: string[];
  warnings: string[];
};

export type DataBackupRunReason = 'manual' | 'automatic' | 'before-import';

export type DataBackupProgressPhase =
  | 'preparing'
  | 'snapshot'
  | 'scanning'
  | 'writing'
  | 'finalizing'
  | 'completed'
  | 'failed';

export type DataBackupProgress = {
  running: boolean;
  reason: DataBackupRunReason;
  phase: DataBackupProgressPhase;
  percent: number | null;
  processedEntries: number;
  totalEntries: number | null;
  processedBytes: number;
  totalBytes: number | null;
  currentEntry: string | null;
  outputPath: string | null;
  startedAt: string;
  updatedAt: string;
  error: string | null;
};

export type DataBackupStatus = {
  enabled: boolean;
  directory: string | null;
  intervalDays: number;
  lastBackupAt: string | null;
  lastBackupPath: string | null;
  lastError: string | null;
  nextBackupAt: string | null;
  running: boolean;
  progress: DataBackupProgress | null;
};

export type DataBackupExportResult = {
  filePath: string;
  exportedAt: string;
  reason: DataBackupRunReason;
  snapshotPath: string;
  includedEntries: string[];
  skippedEntries: string[];
  warnings: string[];
  sizeBytes: number;
};

export type DataBackupImportResult = {
  importedAt: string;
  importedPath: string;
  rollbackBackupPath: string | null;
  restoredEntries: string[];
  skippedEntries: string[];
  warnings: string[];
  settings: AppSettings;
};
