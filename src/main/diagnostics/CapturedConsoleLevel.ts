import type { DiagnosticConsoleLevel, DiagnosticConsoleSource } from '../../shared/types/diagnostics';

/** console.warn uses stderr; a successfully completed slow call is a warning. */
export const classifyCapturedConsoleLevel = (
  source: DiagnosticConsoleSource,
  fallback: DiagnosticConsoleLevel,
  message: string,
): DiagnosticConsoleLevel => {
  if (source === 'stderr' && /^\[(?:ipc-perf|playback-perf)\].*\bSLOW\b/u.test(message.trim())) {
    return /\bfailed=true\b/u.test(message) ? 'error' : 'warn';
  }
  return fallback;
};
