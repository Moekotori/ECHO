import type { LibraryScanStatus } from '../../shared/types/library';

export type LibraryScanStageId =
  | 'discovering'
  | 'checking_cache'
  | 'reading_metadata'
  | 'extracting_covers'
  | 'grouping_albums'
  | 'writing_database';

export type LibraryScanStageState = 'waiting' | 'active' | 'done' | 'warning';

export type LibraryScanTotals = {
  statuses: number;
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  metadataFiles: number;
  addedTracks: number;
  updatedTracks: number;
  removedTracks: number;
  changedTracks: number;
  coverCount: number;
  errorCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  isRunning: boolean;
};

export type LibraryScanStage = {
  id: LibraryScanStageId;
  value: number;
  state: LibraryScanStageState;
};

export const libraryScanStageOrder: LibraryScanStageId[] = [
  'discovering',
  'checking_cache',
  'reading_metadata',
  'extracting_covers',
  'grouping_albums',
  'writing_database',
];

const runningStatuses = new Set<LibraryScanStatus['status']>(['queued', 'running']);

const stageForPhase = (phase: LibraryScanStatus['phase']): LibraryScanStageId | null => {
  if (phase === 'queued' || phase === 'finished' || phase === 'failed' || phase === 'cancelled') {
    return null;
  }

  return phase;
};

export const summarizeLibraryScanStatuses = (statuses: LibraryScanStatus[]): LibraryScanTotals => {
  const totalFiles = statuses.reduce((total, status) => total + status.totalFiles, 0);
  const processedFiles = statuses.reduce((total, status) => total + status.processedFiles, 0);
  const skippedFiles = statuses.reduce((total, status) => total + status.skippedFiles, 0);
  const addedTracks = statuses.reduce((total, status) => total + status.addedTracks, 0);
  const updatedTracks = statuses.reduce((total, status) => total + status.updatedTracks, 0);
  const removedTracks = statuses.reduce((total, status) => total + status.removedTracks, 0);
  const coverCount = statuses.reduce((total, status) => total + (status.coverCount ?? 0), 0);
  const errorCount = statuses.reduce((total, status) => total + status.errorCount, 0);
  const runningCount = statuses.filter((status) => runningStatuses.has(status.status)).length;
  const completedCount = statuses.filter((status) => status.status === 'completed').length;
  const failedCount = statuses.filter((status) => status.status === 'failed').length;
  const cancelledCount = statuses.filter((status) => status.status === 'cancelled').length;

  return {
    statuses: statuses.length,
    totalFiles,
    processedFiles,
    skippedFiles,
    metadataFiles: Math.max(0, processedFiles - skippedFiles),
    addedTracks,
    updatedTracks,
    removedTracks,
    changedTracks: addedTracks + updatedTracks + removedTracks,
    coverCount,
    errorCount,
    runningCount,
    completedCount,
    failedCount,
    cancelledCount,
    isRunning: runningCount > 0,
  };
};

export const buildLibraryScanStages = (statuses: LibraryScanStatus[]): LibraryScanStage[] => {
  const totals = summarizeLibraryScanStatuses(statuses);
  const activeStatus = statuses.find((status) => status.status === 'running') ?? statuses.find((status) => status.status === 'queued');
  const activeStage = activeStatus ? stageForPhase(activeStatus.phase) : null;
  const activeIndex = activeStage ? libraryScanStageOrder.indexOf(activeStage) : -1;
  const terminalWithProblems = !totals.isRunning && (totals.failedCount > 0 || totals.cancelledCount > 0);

  const values: Record<LibraryScanStageId, number> = {
    discovering: totals.totalFiles,
    checking_cache: totals.skippedFiles,
    reading_metadata: totals.metadataFiles,
    extracting_covers: totals.coverCount,
    grouping_albums: totals.changedTracks,
    writing_database: totals.changedTracks,
  };

  return libraryScanStageOrder.map((id, index) => {
    let state: LibraryScanStageState = 'waiting';

    if (totals.isRunning) {
      if (activeIndex < 0) {
        state = index === 0 ? 'active' : 'waiting';
      } else if (index < activeIndex) {
        state = 'done';
      } else if (index === activeIndex) {
        state = 'active';
      }
    } else if (totals.statuses > 0) {
      state = terminalWithProblems ? 'warning' : 'done';
    }

    return {
      id,
      value: values[id],
      state,
    };
  });
};
