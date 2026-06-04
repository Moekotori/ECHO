import type { LibraryScanStatus } from '../../shared/types/library';

export type ScanStatusByFolder = Record<string, LibraryScanStatus>;

let sharedScanStatuses: ScanStatusByFolder = {};
const scanStatusSubscribers = new Set<(statuses: ScanStatusByFolder) => void>();

const cloneScanStatuses = (): ScanStatusByFolder => ({ ...sharedScanStatuses });

const scanStatusErrorsEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const scanStatusesEqual = (left: LibraryScanStatus, right: LibraryScanStatus): boolean =>
  left.id === right.id &&
  left.folderId === right.folderId &&
  left.status === right.status &&
  left.phase === right.phase &&
  left.totalFiles === right.totalFiles &&
  left.processedFiles === right.processedFiles &&
  left.skippedFiles === right.skippedFiles &&
  left.addedTracks === right.addedTracks &&
  left.updatedTracks === right.updatedTracks &&
  left.removedTracks === right.removedTracks &&
  left.coverCount === right.coverCount &&
  left.errorCount === right.errorCount &&
  left.startedAt === right.startedAt &&
  left.finishedAt === right.finishedAt &&
  scanStatusErrorsEqual(left.errors, right.errors);

const emitSharedScanStatuses = (): void => {
  const snapshot = cloneScanStatuses();
  for (const subscriber of scanStatusSubscribers) {
    subscriber(snapshot);
  }
};

export const getLibraryScanStatuses = (): ScanStatusByFolder => cloneScanStatuses();

export const rememberLibraryScanStatus = (status: LibraryScanStatus): void => {
  const current = sharedScanStatuses[status.folderId];
  if (current && scanStatusesEqual(current, status)) {
    return;
  }

  sharedScanStatuses = {
    ...sharedScanStatuses,
    [status.folderId]: status,
  };
  emitSharedScanStatuses();
};

export const forgetLibraryScanStatus = (folderId: string): void => {
  const next = { ...sharedScanStatuses };
  delete next[folderId];
  sharedScanStatuses = next;
  emitSharedScanStatuses();
};

export const subscribeLibraryScanStatuses = (
  subscriber: (statuses: ScanStatusByFolder) => void,
): (() => void) => {
  scanStatusSubscribers.add(subscriber);
  subscriber(cloneScanStatuses());

  return () => {
    scanStatusSubscribers.delete(subscriber);
  };
};

export const resetLibraryScanSessionForTests = (): void => {
  sharedScanStatuses = {};
  emitSharedScanStatuses();
};
