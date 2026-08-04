import type { DiagnosticPerformanceStallPayload } from '../../shared/types/diagnostics';
import type { LibraryPerformanceStallDiagnostics } from '../../shared/types/library';

const maxRecentStalls = 20;
let recentStalls: LibraryPerformanceStallDiagnostics[] = [];

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export const recordRuntimePerformanceStall = (
  payload: DiagnosticPerformanceStallPayload,
  cause: Pick<LibraryPerformanceStallDiagnostics, 'probableCause' | 'confidence'>,
): void => {
  recentStalls.push({
    timestamp: payload.timestamp,
    source: payload.source,
    kind: payload.kind,
    durationMs: Math.max(0, Math.round(payload.durationMs)),
    thresholdMs: Math.max(0, Math.round(payload.thresholdMs)),
    probableCause: cause.probableCause,
    confidence: cause.confidence,
    route: stringOrNull(payload.details?.route),
    windowKind: payload.windowKind ?? null,
  });

  if (recentStalls.length > maxRecentStalls) {
    recentStalls = recentStalls.slice(-maxRecentStalls);
  }
};

export const getRecentRuntimePerformanceStalls = (limit = 6): LibraryPerformanceStallDiagnostics[] =>
  recentStalls.slice(-Math.max(0, limit)).reverse();

export const clearRuntimePerformanceDiagnosticsForTests = (): void => {
  recentStalls = [];
};
