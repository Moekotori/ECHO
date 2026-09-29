export type SoftMemoryCleanupTaskResult = {
  task: string;
  beforeEntries?: number;
  afterEntries?: number;
  removedEntries: number;
  details?: Record<string, string | number | boolean | null>;
};

export type SoftMemoryCleanupSummary = {
  reason: string;
  ran: boolean;
  skipped: boolean;
  skippedReason?: 'cooldown' | 'empty' | 'in-progress';
  cooldownHit: boolean;
  cooldownRemainingMs: number;
  startedAtMs: number;
  finishedAtMs: number;
  taskCount: number;
  removedEntries: number;
  tasks: SoftMemoryCleanupTaskResult[];
  errors: Array<{ task: string; message: string }>;
  errorCount: number;
};

export type SoftMemoryCleanupLogFields = {
  reason: string;
  ran: boolean;
  skippedReason: SoftMemoryCleanupSummary['skippedReason'] | null;
  cooldownHit: boolean;
  cooldownRemainingMs: number;
  taskCount: number;
  removedEntries: number;
  errorCount: number;
};

type SoftMemoryCleanupTask = () => SoftMemoryCleanupTaskResult | null | undefined | Promise<SoftMemoryCleanupTaskResult | null | undefined>;

const defaultSoftMemoryCleanupCooldownMs = 5 * 60 * 1000;
const cleanupTasks = new Map<string, SoftMemoryCleanupTask>();

let lastCleanupAtMs = 0;
let cleanupInProgress = false;

const nowMs = (): number => Date.now();

const emptySummary = (
  reason: string,
  skippedReason: NonNullable<SoftMemoryCleanupSummary['skippedReason']>,
  timestampMs: number,
  cooldownRemainingMs = 0,
): SoftMemoryCleanupSummary => ({
  reason,
  ran: false,
  skipped: true,
  skippedReason,
  cooldownHit: skippedReason === 'cooldown',
  cooldownRemainingMs,
  startedAtMs: timestampMs,
  finishedAtMs: timestampMs,
  taskCount: 0,
  removedEntries: 0,
  tasks: [],
  errors: [],
  errorCount: 0,
});

export const createSoftMemoryCleanupLogFields = (
  summary: SoftMemoryCleanupSummary,
): SoftMemoryCleanupLogFields => ({
  reason: summary.reason,
  ran: summary.ran,
  skippedReason: summary.skippedReason ?? null,
  cooldownHit: summary.cooldownHit,
  cooldownRemainingMs: summary.cooldownRemainingMs,
  taskCount: summary.taskCount,
  removedEntries: summary.removedEntries,
  errorCount: summary.errorCount,
});

export const registerSoftMemoryCleanupTask = (
  name: string,
  task: SoftMemoryCleanupTask,
): (() => void) => {
  cleanupTasks.set(name, task);
  return () => {
    if (cleanupTasks.get(name) === task) {
      cleanupTasks.delete(name);
    }
  };
};

export const releaseSoftMemoryPressure = async (
  options: {
    cooldownMs?: number;
    nowMs?: number;
    reason?: string;
  } = {},
): Promise<SoftMemoryCleanupSummary> => {
  const timestampMs = options.nowMs ?? nowMs();
  const reason = options.reason ?? 'soft-memory-pressure';
  const cooldownMs = Math.max(0, options.cooldownMs ?? defaultSoftMemoryCleanupCooldownMs);

  if (cleanupInProgress) {
    return emptySummary(reason, 'in-progress', timestampMs);
  }

  if (cleanupTasks.size === 0) {
    return emptySummary(reason, 'empty', timestampMs);
  }

  if (lastCleanupAtMs > 0 && timestampMs - lastCleanupAtMs < cooldownMs) {
    const cooldownRemainingMs = Math.max(0, cooldownMs - (timestampMs - lastCleanupAtMs));
    return emptySummary(reason, 'cooldown', timestampMs, cooldownRemainingMs);
  }

  cleanupInProgress = true;
  lastCleanupAtMs = timestampMs;

  const tasks: SoftMemoryCleanupTaskResult[] = [];
  const errors: SoftMemoryCleanupSummary['errors'] = [];

  try {
    for (const [taskName, task] of cleanupTasks.entries()) {
      try {
        const result = await task();
        if (result) {
          tasks.push({
            ...result,
            task: result.task || taskName,
            removedEntries: Math.max(0, Math.trunc(result.removedEntries)),
          });
        }
      } catch (error) {
        errors.push({
          task: taskName,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    cleanupInProgress = false;
  }

  const finishedAtMs = nowMs();
  return {
    reason,
    ran: true,
    skipped: false,
    cooldownHit: false,
    cooldownRemainingMs: 0,
    startedAtMs: timestampMs,
    finishedAtMs,
    taskCount: tasks.length,
    removedEntries: tasks.reduce((total, task) => total + task.removedEntries, 0),
    tasks,
    errors,
    errorCount: errors.length,
  };
};

export const resetSoftMemoryJanitorForTests = (): void => {
  cleanupTasks.clear();
  lastCleanupAtMs = 0;
  cleanupInProgress = false;
};
