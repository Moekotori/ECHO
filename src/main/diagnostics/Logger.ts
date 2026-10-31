import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { DiagnosticLevel, DiagnosticScope } from '../../shared/types/diagnostics';

const maxLogBytes = 2 * 1024 * 1024;
const maxRotatedLogs = 5;
const sensitiveKeyPattern = /token|cookie|password|authorization|auth|secret|session|csrf/i;
const pathKeyPattern = /path|file|directory|folder/i;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const hashText = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16);

export const sanitizePath = (value: string): { basename: string; pathHash: string } => {
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return {
    basename: parts.at(-1) ?? value,
    pathHash: hashText(value),
  };
};

export const sanitizeLogPayload = (value: unknown, keyHint = ''): unknown => {
  if (sensitiveKeyPattern.test(keyHint)) {
    return '[redacted]';
  }

  if (typeof value === 'string') {
    if (/bearer\s+[a-z0-9._~+/=-]+/i.test(value)) {
      return value.replace(/bearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
    }

    if (/(token|password|authorization|cookie|session|csrf)=([^&\s]+)/i.test(value)) {
      return value.replace(/(token|password|authorization|cookie|session|csrf)=([^&\s]+)/gi, '$1=[redacted]');
    }

    if (
      (pathKeyPattern.test(keyHint) && !/hash/i.test(keyHint)) ||
      /^[a-zA-Z]:[\\/]/.test(value) ||
      value.startsWith('/') ||
      value.startsWith('\\\\')
    ) {
      return sanitizePath(value);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeLogPayload(item, keyHint));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, sanitizeLogPayload(nestedValue, key)]));
  }

  return value;
};

const scopeFileName = (scope: DiagnosticScope): string => {
  if (scope === 'renderer') {
    return 'renderer.log';
  }

  if (scope === 'library') {
    return 'library.log';
  }

  if (scope === 'audio') {
    return 'audio.log';
  }

  if (scope === 'crash') {
    return 'crash.log';
  }

  return 'main.log';
};

export class Logger {
  constructor(private sessionDir: string) {
    mkdirSync(this.sessionDir, { recursive: true });
  }

  setSessionDir(sessionDir: string): void {
    this.sessionDir = sessionDir;
    mkdirSync(this.sessionDir, { recursive: true });
  }

  log(scope: DiagnosticScope, level: DiagnosticLevel, message: string, payload?: unknown): void {
    const logPath = join(this.sessionDir, scopeFileName(scope));
    this.rotateIfNeeded(logPath);
    const entry = {
      timestamp: new Date().toISOString(),
      scope,
      level,
      message,
      payload: sanitizeLogPayload(payload),
    };

    writeFileSync(logPath, `${JSON.stringify(entry)}\n`, { flag: 'a' });
  }

  debug(scope: DiagnosticScope, message: string, payload?: unknown): void {
    this.log(scope, 'debug', message, payload);
  }

  info(scope: DiagnosticScope, message: string, payload?: unknown): void {
    this.log(scope, 'info', message, payload);
  }

  warn(scope: DiagnosticScope, message: string, payload?: unknown): void {
    this.log(scope, 'warn', message, payload);
  }

  error(scope: DiagnosticScope, message: string, payload?: unknown): void {
    this.log(scope, 'error', message, payload);
  }

  private rotateIfNeeded(logPath: string): void {
    if (!existsSync(logPath) || statSync(logPath).size < maxLogBytes) {
      return;
    }

    for (let index = maxRotatedLogs; index >= 1; index -= 1) {
      const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
      const target = `${logPath}.${index}`;

      if (existsSync(source)) {
        if (existsSync(target)) {
          rmSync(target, { force: true });
        }
        renameSync(source, target);
      }
    }
  }
}
