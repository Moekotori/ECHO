type PlaybackPerformanceContext = {
  operation: string;
  phase: string;
  startedAtMs: number;
  trackId?: string | null;
  outputMode?: string | null;
};

type PlaybackPerformanceCompletedStep = {
  operation: string;
  phase: string;
  durationMs: number;
  endedAtMs: number;
  trackId?: string | null;
  outputMode?: string | null;
};

export type PlaybackPerformanceBreadcrumb = {
  label: string;
  timestampMs: number;
  ageMs: number;
  trackId: string | null;
  outputMode: string | null;
};

export type PlaybackPerformanceSnapshot = {
  operation: string | null;
  phase: string | null;
  elapsedMs: number | null;
  trackId: string | null;
  outputMode: string | null;
  pendingBackgroundTask: string | null;
  pendingBackgroundTaskElapsedMs: number | null;
  lastBackgroundTask: string | null;
  lastBackgroundTaskDurationMs: number | null;
  lastBackgroundTaskAgeMs: number | null;
  lastCompletedPhase: string | null;
  lastCompletedOperation: string | null;
  lastCompletedDurationMs: number | null;
  breadcrumbs: PlaybackPerformanceBreadcrumb[];
};

const recentStepTtlMs = 15_000;
const maxBreadcrumbs = 20;
const breadcrumbTtlMs = 30_000;
const slowPlaybackStepWarnThresholdMs = 750;
const recentBackgroundTaskTtlMs = 30_000;
let activeContext: PlaybackPerformanceContext | null = null;
let lastCompletedStep: PlaybackPerformanceCompletedStep | null = null;
let pendingBackgroundTask: string | null = null;
let pendingBackgroundTaskStartedAtMs: number | null = null;
let lastCompletedBackgroundTask: { name: string; durationMs: number; endedAtMs: number } | null = null;
let breadcrumbs: Omit<PlaybackPerformanceBreadcrumb, 'ageMs'>[] = [];

const formatDetails = (details: Record<string, unknown>): string => {
  const entries = Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return entries.length > 0 ? ` ${JSON.stringify(Object.fromEntries(entries))}` : '';
};

const logStep = (context: PlaybackPerformanceContext, durationMs: number): void => {
  const roundedDurationMs = Math.max(0, Math.round(durationMs));
  const details = formatDetails({
    trackId: context.trackId,
    outputMode: context.outputMode,
  });
  const baseMessage = `[playback-perf] ${context.operation}:${context.phase} ${roundedDurationMs}ms${details}`;
  if (roundedDurationMs >= slowPlaybackStepWarnThresholdMs) {
    console.warn(
      `${baseMessage} SLOW probableCause=slow_playback_phase actionHint=check this phase, nearby performance stalls, and playbackBreadcrumbs`,
    );
    return;
  }

  console.info(baseMessage);
};

export const markPlaybackBreadcrumb = (
  label: string,
  details: { trackId?: string | null; outputMode?: string | null } = {},
): void => {
  breadcrumbs.push({
    label,
    timestampMs: Date.now(),
    trackId: details.trackId ?? activeContext?.trackId ?? lastCompletedStep?.trackId ?? null,
    outputMode: details.outputMode ?? activeContext?.outputMode ?? lastCompletedStep?.outputMode ?? null,
  });

  if (breadcrumbs.length > maxBreadcrumbs) {
    breadcrumbs = breadcrumbs.slice(-maxBreadcrumbs);
  }
};

export const runPlaybackPerformanceStep = async <T>(
  operation: string,
  phase: string,
  details: { trackId?: string | null; outputMode?: string | null },
  run: () => Promise<T>,
): Promise<T> => {
  const previous = activeContext;
  const context: PlaybackPerformanceContext = {
    operation,
    phase,
    startedAtMs: Date.now(),
    trackId: details.trackId,
    outputMode: details.outputMode,
  };
  activeContext = context;
  markPlaybackBreadcrumb(`${operation}:${phase}:start`, details);
  try {
    return await run();
  } finally {
    const durationMs = Date.now() - context.startedAtMs;
    lastCompletedStep = {
      operation,
      phase,
      durationMs,
      endedAtMs: Date.now(),
      trackId: details.trackId,
      outputMode: details.outputMode,
    };
    logStep(context, durationMs);
    markPlaybackBreadcrumb(`${operation}:${phase}:end:${Math.max(0, Math.round(durationMs))}ms`, details);
    activeContext = previous;
  }
};

export const runPlaybackPerformanceStepSync = <T>(
  operation: string,
  phase: string,
  details: { trackId?: string | null; outputMode?: string | null },
  run: () => T,
): T => {
  const previous = activeContext;
  const context: PlaybackPerformanceContext = {
    operation,
    phase,
    startedAtMs: Date.now(),
    trackId: details.trackId,
    outputMode: details.outputMode,
  };
  activeContext = context;
  markPlaybackBreadcrumb(`${operation}:${phase}:start`, details);
  try {
    return run();
  } finally {
    const durationMs = Date.now() - context.startedAtMs;
    lastCompletedStep = {
      operation,
      phase,
      durationMs,
      endedAtMs: Date.now(),
      trackId: details.trackId,
      outputMode: details.outputMode,
    };
    logStep(context, durationMs);
    markPlaybackBreadcrumb(`${operation}:${phase}:end:${Math.max(0, Math.round(durationMs))}ms`, details);
    activeContext = previous;
  }
};

export const beginMainBackgroundTask = (name: string): (() => void) => {
  const previous = pendingBackgroundTask;
  const previousStartedAtMs = pendingBackgroundTaskStartedAtMs;
  const startedAtMs = Date.now();
  pendingBackgroundTask = name;
  pendingBackgroundTaskStartedAtMs = startedAtMs;
  return () => {
    const endedAtMs = Date.now();
    lastCompletedBackgroundTask = {
      name,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      endedAtMs,
    };
    pendingBackgroundTask = previous;
    pendingBackgroundTaskStartedAtMs = previousStartedAtMs;
  };
};

export const getPlaybackPerformanceSnapshot = (nowMs = Date.now()): PlaybackPerformanceSnapshot => {
  const recent = lastCompletedStep && nowMs - lastCompletedStep.endedAtMs <= recentStepTtlMs ? lastCompletedStep : null;
  const recentBackgroundTask =
    lastCompletedBackgroundTask && nowMs - lastCompletedBackgroundTask.endedAtMs <= recentBackgroundTaskTtlMs
      ? lastCompletedBackgroundTask
      : null;
  const recentBreadcrumbs = breadcrumbs
    .filter((entry) => nowMs - entry.timestampMs <= breadcrumbTtlMs)
    .map((entry) => ({
      ...entry,
      ageMs: Math.max(0, nowMs - entry.timestampMs),
    }));
  return {
    operation: activeContext?.operation ?? recent?.operation ?? null,
    phase: activeContext?.phase ?? recent?.phase ?? null,
    elapsedMs: activeContext ? Math.max(0, nowMs - activeContext.startedAtMs) : null,
    trackId: activeContext?.trackId ?? recent?.trackId ?? null,
    outputMode: activeContext?.outputMode ?? recent?.outputMode ?? null,
    pendingBackgroundTask,
    pendingBackgroundTaskElapsedMs:
      pendingBackgroundTaskStartedAtMs !== null ? Math.max(0, nowMs - pendingBackgroundTaskStartedAtMs) : null,
    lastBackgroundTask: recentBackgroundTask?.name ?? null,
    lastBackgroundTaskDurationMs: recentBackgroundTask?.durationMs ?? null,
    lastBackgroundTaskAgeMs: recentBackgroundTask ? Math.max(0, nowMs - recentBackgroundTask.endedAtMs) : null,
    lastCompletedPhase: recent?.phase ?? null,
    lastCompletedOperation: recent?.operation ?? null,
    lastCompletedDurationMs: recent?.durationMs ?? null,
    breadcrumbs: recentBreadcrumbs,
  };
};
