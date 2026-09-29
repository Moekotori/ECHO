import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sanitizeLogPayload, sanitizePath } from './Logger';
import type { SafeModeStartupContext } from './StartupDiagnostics';
import type { DiagnosticConsoleEntry } from '../../shared/types/diagnostics';

export type DiagnosticExceptionSeverity = 'warn' | 'error' | 'fatal';

export type DiagnosticExceptionSource = 'main' | 'renderer' | 'audio' | 'startup' | 'console';

export type DiagnosticExceptionRecord = {
  id: number;
  timestamp: string;
  source: DiagnosticExceptionSource;
  severity: DiagnosticExceptionSeverity;
  type: string;
  message: string;
  stack?: string;
  phase?: string;
  details?: unknown;
};

const exceptionLogFileName = 'exceptions.safe.log';
const maxExceptionRecords = 500;
const duplicateWindowMs = 1500;
const hardErrorPattern = /\b(?:error|exception|failed|failure|fatal|crash|timeout|denied|rejected|unhandled|corrupt|unavailable|not found|enoent|epipe|exit_code|spawn_error|cannot|couldn'?t)\b/i;
const warningPattern = /\b(?:warn|warning|slow|fallback|retry|recover|underrun|stale|mismatch|skipped|degraded|blocked)\b/i;

let nextExceptionId = 1;
let exceptionLogPath: string | null = null;
let exceptionRecords: DiagnosticExceptionRecord[] = [];
const recentSignatures = new Map<string, number>();

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeMessage = (message: unknown): string => {
  if (typeof message === 'string') {
    return oneLine(message) || 'diagnostic_exception';
  }

  const serialized = JSON.stringify(sanitizeLogPayload(message));
  return typeof serialized === 'string' ? oneLine(serialized) || 'diagnostic_exception' : 'diagnostic_exception';
};

const formatExceptionLine = (record: DiagnosticExceptionRecord): string => {
  const phase = record.phase ? ` phase=${record.phase}` : '';
  const details = record.details === undefined ? '' : ` details=${JSON.stringify(record.details)}`;
  return `[${record.timestamp}] #${record.id} [${record.severity}] [${record.source}] ${record.type}${phase}: ${record.message}${details}`;
};

const signatureForRecord = (record: Pick<DiagnosticExceptionRecord, 'source' | 'type' | 'message' | 'phase'>): string =>
  [record.source, record.type, record.phase ?? '', record.message].join('\n').toLowerCase();

const appendExceptionLogLine = (line: string): void => {
  if (!exceptionLogPath) {
    return;
  }

  try {
    appendFileSync(exceptionLogPath, `${line}\n`, 'utf8');
  } catch {
    // Exception recording must never make an already-bad situation worse.
  }
};

export const getExceptionLogPath = (userDataPath: string): string =>
  join(userDataPath, 'crash-reports', exceptionLogFileName);

export const attachExceptionRecorderFile = (userDataPath: string, context: SafeModeStartupContext): string => {
  const logPath = getExceptionLogPath(userDataPath);
  exceptionLogPath = logPath;

  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const safeUserData = sanitizePath(context.userDataPath);
    writeFileSync(
      logPath,
      [
        'ECHO Safe mode exception recorder',
        'Only exceptions, renderer errors, audio errors, and slow startup stages are written here.',
        `version=${context.appVersion} platform=${context.platform} arch=${context.arch} userData=${safeUserData.basename}#${safeUserData.pathHash}`,
        `startedAt=${new Date().toISOString()}`,
        '',
        ...exceptionRecords.map(formatExceptionLine),
      ].join('\n') + '\n',
      'utf8',
    );
  } catch {
    // Keep in-memory records even if the log file cannot be created.
  }

  return logPath;
};

export const recordDiagnosticException = (record: Omit<DiagnosticExceptionRecord, 'id' | 'timestamp'> & { timestamp?: string }): DiagnosticExceptionRecord => {
  const timestamp = record.timestamp ?? new Date().toISOString();
  const normalized = {
    source: record.source,
    type: oneLine(record.type) || 'diagnostic_exception',
    message: normalizeMessage(record.message),
    phase: typeof record.phase === 'string' && record.phase.trim() ? oneLine(record.phase).slice(0, 120) : undefined,
  };
  const timestampMs = Date.parse(timestamp);
  const nowMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const signature = signatureForRecord(normalized);
  const recentAt = recentSignatures.get(signature);
  if (recentAt !== undefined && nowMs - recentAt < duplicateWindowMs) {
    return exceptionRecords.find((item) => signatureForRecord(item) === signature) ?? {
      id: 0,
      timestamp,
      source: normalized.source,
      severity: record.severity,
      type: normalized.type,
      message: normalized.message,
      phase: normalized.phase,
    };
  }
  recentSignatures.set(signature, nowMs);
  for (const [key, value] of recentSignatures) {
    if (nowMs - value > duplicateWindowMs * 4) {
      recentSignatures.delete(key);
    }
  }

  const nextRecord: DiagnosticExceptionRecord = {
    id: nextExceptionId,
    timestamp,
    source: normalized.source,
    severity: record.severity,
    type: normalized.type,
    message: normalized.message,
    stack: typeof record.stack === 'string' && record.stack.trim() ? record.stack.trim().slice(0, 8000) : undefined,
    phase: normalized.phase,
    details: record.details === undefined ? undefined : sanitizeLogPayload(record.details),
  };

  nextExceptionId += 1;
  exceptionRecords.push(nextRecord);
  if (exceptionRecords.length > maxExceptionRecords) {
    exceptionRecords.splice(0, exceptionRecords.length - maxExceptionRecords);
  }

  appendExceptionLogLine(formatExceptionLine(nextRecord));
  if (nextRecord.stack) {
    appendExceptionLogLine(`  stack=${nextRecord.stack.replace(/\r?\n/g, '\\n')}`);
  }

  return nextRecord;
};

export const recordDiagnosticConsoleProblem = (entry: DiagnosticConsoleEntry): DiagnosticExceptionRecord | null => {
  const message = entry.message.trim();
  if (!message) {
    return null;
  }

  const rawLevel = String(entry.level);
  const level = rawLevel === 'warning' ? 'warn' : entry.level;
  const hard = level === 'error' || hardErrorPattern.test(message);
  const warning = level === 'warn' || warningPattern.test(message);
  const isRendererProblem = entry.source === 'renderer' && (level === 'error' || level === 'warn');
  const isStderrProblem = entry.source === 'stderr' && (hard || warning);
  const isOtherConsoleProblem = entry.source !== 'system' && (level === 'error' || level === 'warn') && (hard || warning);

  if (!isRendererProblem && !isStderrProblem && !isOtherConsoleProblem) {
    return null;
  }

  return recordDiagnosticException({
    source: 'console',
    severity: hard ? 'error' : 'warn',
    type: `${entry.source}-${level}-problem`,
    message,
    details: {
      consoleEntryId: entry.id,
      consoleSource: entry.source,
      consoleLevel: entry.level,
      line: entry.details?.line,
      sourceId: entry.details?.sourceId,
    },
    timestamp: entry.timestamp,
  });
};

export const getExceptionRecordsSnapshot = (): DiagnosticExceptionRecord[] =>
  exceptionRecords.map((record) => ({ ...record }));

export const getExceptionSummarySnapshot = () => {
  const bySeverity: Record<DiagnosticExceptionSeverity, number> = { warn: 0, error: 0, fatal: 0 };
  const bySource: Partial<Record<DiagnosticExceptionSource, number>> = {};
  const byType: Record<string, number> = {};

  for (const record of exceptionRecords) {
    bySeverity[record.severity] += 1;
    bySource[record.source] = (bySource[record.source] ?? 0) + 1;
    byType[record.type] = (byType[record.type] ?? 0) + 1;
  }

  return {
    total: exceptionRecords.length,
    bySeverity,
    bySource,
    byType,
    firstAt: exceptionRecords[0]?.timestamp ?? null,
    lastAt: exceptionRecords.at(-1)?.timestamp ?? null,
    latest: exceptionRecords.slice(-20).map((record) => ({ ...record })),
  };
};

export const readExceptionLogFile = (userDataPath: string): string | null => {
  const logPath = getExceptionLogPath(userDataPath);
  try {
    return existsSync(logPath) ? readFileSync(logPath, 'utf8') : null;
  } catch {
    return null;
  }
};

export const resetExceptionRecorderForTests = (): void => {
  nextExceptionId = 1;
  exceptionLogPath = null;
  exceptionRecords = [];
  recentSignatures.clear();
};
