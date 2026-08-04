import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { logLibraryScanPerf } from '../../diagnostics/LibraryScanPerfDiagnostics';
import { isReasonableAudioSampleRate } from '../../audio/SampleRateGuards';
import type { NativeMetadataReaderDiagnostics } from '../../../shared/types/library';
import type { FieldSources, MetadataFields, MetadataResult } from '../libraryTypes';
import type { MetadataReader } from './MetadataReader';
import { resolveNativeFileScannerPath } from './NativeFileScanner';
import { TsMetadataReader } from './TsMetadataReader';

type SpawnNativeMetadataReader = (command: string, args: readonly string[]) => ChildProcessWithoutNullStreams;
type NativeMetadataReaderEnabledProvider = () => boolean;
type NativeMetadataReaderEnablementSource = 'env-disable' | 'env-enable' | 'setting' | 'default';
type PendingNativeMetadataRequest = {
  path: string;
  startedAtMs: number;
  timer: NodeJS.Timeout;
  resolve: (result: MetadataResult) => void;
  reject: (error: Error) => void;
};
type NativeMetadataReaderRuntimeStats = {
  total: number;
  nativeOk: number;
  fallbackToTs: number;
  skippedUnsupportedExtension: number;
};

type NativeMetadataMessage =
  | { type: 'ready' }
  | {
      type: 'capabilities';
      protocolVersion?: unknown;
      supportedRequests?: unknown;
      features?: unknown;
      metadataFormats?: unknown;
      metadataExtensions?: unknown;
    }
  | { type: 'started'; path?: unknown; mode?: unknown }
  | { type: 'metadata'; path?: unknown; result?: unknown }
  | { type: 'unsupported'; path?: unknown; message?: unknown }
  | { type: 'error'; kind?: unknown; path?: unknown; message?: unknown };

const stderrTailLimit = 4096;
const metadataRequestTimeoutMs = 10000;
const nativeMetadataReaderSupportedFormats = ['WAV/PCM', 'AIFF/AIFC', 'Ogg Vorbis', 'Opus', 'FLAC', 'MP3', 'M4A/MP4/ALAC'];
const nativeMetadataReaderSupportedExtensions = new Set([
  '.wav',
  '.aiff',
  '.aif',
  '.ogg',
  '.opus',
  '.flac',
  '.fla',
  '.mp3',
  '.m4a',
  '.mp4',
  '.m4b',
  '.m4p',
  '.alac',
]);
const defaultNativeMetadataSummaryInterval = 500;
const defaultNativeMetadataCapabilities = {
  protocolVersion: 1,
  supportedRequests: ['scan', 'metadata'],
  features: ['batching', 'progress', 'directorySnapshots', 'persistentMetadata'],
  metadataFormats: nativeMetadataReaderSupportedFormats,
  metadataExtensions: Array.from(nativeMetadataReaderSupportedExtensions),
};
const nativeMetadataReaderRuntimeStats: NativeMetadataReaderRuntimeStats = {
  total: 0,
  nativeOk: 0,
  fallbackToTs: 0,
  skippedUnsupportedExtension: 0,
};
let lastNativeMetadataCapabilities = defaultNativeMetadataCapabilities;

const isNativeMetadataSupportedPath = (filePath: string): boolean =>
  nativeMetadataReaderSupportedExtensions.has(extname(filePath).toLowerCase());

const getNativeMetadataSummaryInterval = (): number => {
  const value = Number(process.env.ECHO_NATIVE_METADATA_SUMMARY_INTERVAL ?? defaultNativeMetadataSummaryInterval);
  return Number.isFinite(value) ? Math.max(50, Math.round(value)) : defaultNativeMetadataSummaryInterval;
};

const isNativeMetadataVerbose = (): boolean => process.env.ECHO_NATIVE_METADATA_VERBOSE === '1';
const shouldSupplementNativeMetadataFromTs = (): boolean => process.env.ECHO_DISABLE_NATIVE_METADATA_TS_SUPPLEMENT !== '1';
const shouldSupplementNativeMetadataCover = (): boolean => process.env.ECHO_DISABLE_NATIVE_METADATA_COVER_SUPPLEMENT !== '1';
const isPositiveNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const isPositiveTechnicalField = (
  field: 'duration' | 'sampleRate' | 'bitrate' | 'bitDepth',
  value: number | null | undefined,
): value is number =>
  field === 'sampleRate'
    ? isReasonableAudioSampleRate(value)
    : isPositiveNumber(value);

const getNativeMetadataReaderEnablement = (
  readSettingEnabled: NativeMetadataReaderEnabledProvider = () => false,
): { enabled: boolean; source: NativeMetadataReaderEnablementSource } => {
  if (process.env.ECHO_DISABLE_NATIVE_METADATA_READER === '1') {
    return { enabled: false, source: 'env-disable' };
  }
  if (process.env.ECHO_NATIVE_METADATA_READER === '1') {
    return { enabled: true, source: 'env-enable' };
  }
  if (readSettingEnabled()) {
    return { enabled: true, source: 'setting' };
  }
  return { enabled: false, source: 'default' };
};

export const getNativeMetadataReaderDiagnostics = (
  readSettingEnabled: NativeMetadataReaderEnabledProvider = () => false,
): NativeMetadataReaderDiagnostics => {
  const enablement = getNativeMetadataReaderEnablement(readSettingEnabled);
  const binaryPath = resolveNativeFileScannerPath();
  const binaryFound = binaryPath !== null && existsSync(binaryPath);

  return {
    enabled: enablement.enabled,
    enablementSource: enablement.source,
    binaryFound,
    binaryPath,
    willUseNative: enablement.enabled && binaryFound,
    supportedFormats: lastNativeMetadataCapabilities.metadataFormats,
    supportedExtensions: lastNativeMetadataCapabilities.metadataExtensions,
    protocolVersion: lastNativeMetadataCapabilities.protocolVersion,
    supportedRequests: lastNativeMetadataCapabilities.supportedRequests,
    workerFeatures: lastNativeMetadataCapabilities.features,
    totalReads: nativeMetadataReaderRuntimeStats.total,
    nativeOk: nativeMetadataReaderRuntimeStats.nativeOk,
    fallbackToTs: nativeMetadataReaderRuntimeStats.fallbackToTs,
    skippedUnsupportedExtension: nativeMetadataReaderRuntimeStats.skippedUnsupportedExtension,
    hitRate: nativeMetadataReaderRuntimeStats.total > 0
      ? nativeMetadataReaderRuntimeStats.nativeOk / nativeMetadataReaderRuntimeStats.total
      : undefined,
  };
};

const parseNativeMetadataLine = (line: string): NativeMetadataMessage | null => {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as NativeMetadataMessage;
  return parsed && typeof parsed === 'object' && typeof parsed.type === 'string' ? parsed : null;
};

const toStringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;

const recordNativeMetadataCapabilities = (message: NativeMetadataMessage): void => {
  if (message.type !== 'capabilities') {
    return;
  }
  const protocolVersion = typeof message.protocolVersion === 'number' && Number.isFinite(message.protocolVersion)
    ? Math.max(1, Math.round(message.protocolVersion))
    : defaultNativeMetadataCapabilities.protocolVersion;
  lastNativeMetadataCapabilities = {
    protocolVersion,
    supportedRequests: toStringArray(message.supportedRequests) ?? defaultNativeMetadataCapabilities.supportedRequests,
    features: toStringArray(message.features) ?? defaultNativeMetadataCapabilities.features,
    metadataFormats: toStringArray(message.metadataFormats) ?? defaultNativeMetadataCapabilities.metadataFormats,
    metadataExtensions: toStringArray(message.metadataExtensions) ?? defaultNativeMetadataCapabilities.metadataExtensions,
  };
};

const isMetadataFields = (value: unknown): value is MetadataFields => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const fields = value as Partial<MetadataFields>;
  return (
    typeof fields.title === 'string' &&
    typeof fields.artist === 'string' &&
    typeof fields.album === 'string' &&
    typeof fields.albumArtist === 'string' &&
    typeof fields.duration === 'number'
  );
};

const isFieldSources = (value: unknown): value is FieldSources =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isMetadataResult = (value: unknown): value is MetadataResult => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const result = value as Partial<MetadataResult>;
  return (
    isMetadataFields(result.fields) &&
    isFieldSources(result.fieldSources) &&
    (result.embeddedMetadataStatus === 'present' || result.embeddedMetadataStatus === 'missing' || result.embeddedMetadataStatus === 'error') &&
    (result.embeddedCoverStatus === 'present' || result.embeddedCoverStatus === 'missing' || result.embeddedCoverStatus === 'error') &&
    Array.isArray(result.warnings) &&
    Array.isArray(result.errors) &&
    (result.status === 'ok' || result.status === 'fallback' || result.status === 'error')
  );
};

export class NativeMetadataReader implements MetadataReader {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: PendingNativeMetadataRequest | null = null;
  private stderrTail = '';
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      executablePath?: string | null;
      spawnProcess?: SpawnNativeMetadataReader;
    } = {},
  ) {}

  async read(filePath: string): Promise<MetadataResult> {
    const task = this.requestQueue.then(
      () => this.readQueued(filePath),
      () => this.readQueued(filePath),
    );
    this.requestQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async readQueued(filePath: string): Promise<MetadataResult> {
    const child = this.ensureProcess();
    const startedAtMs = performance.now();
    const resolvedPath = resolve(filePath);

    return new Promise<MetadataResult>((resolveResult, rejectResult) => {
      const complete = (result: MetadataResult | null, error: Error | null): void => {
        if (this.pending?.path !== resolvedPath) {
          return;
        }
        clearTimeout(this.pending.timer);
        this.pending = null;
        if (result) {
          resolveResult(result);
          return;
        }
        rejectResult(error ?? new Error('native metadata reader did not return metadata'));
      };

      const timer = setTimeout(() => {
        const message = `native metadata reader timed out after ${metadataRequestTimeoutMs}ms`;
        this.killProcess();
        logLibraryScanPerf({
          phase: 'nativeMetadataReader',
          durationMs: performance.now() - startedAtMs,
          fileCount: 1,
          detail: 'status=timeout; mode=persistent',
        });
        rejectResult(new Error(message));
      }, metadataRequestTimeoutMs);
      timer.unref?.();

      this.pending = {
        path: resolvedPath,
        startedAtMs,
        timer,
        resolve: (result) => complete(result, null),
        reject: (error) => complete(null, error),
      };

      child.stdin.write(`${JSON.stringify({
        type: 'metadata',
        path: resolvedPath,
        readCover: false,
      })}\n`, (error) => {
        if (error) {
          complete(null, error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    const executablePath = this.options.executablePath ?? resolveNativeFileScannerPath();
    if (!executablePath) {
      throw new Error('native metadata reader binary not found');
    }
    if (this.child && !this.child.killed) {
      return this.child;
    }

    const child = (this.options.spawnProcess ?? spawn)(executablePath, []);
    this.child = child;
    this.stderrTail = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-stderrTailLimit);
    });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => {
      this.handleLine(line);
    });

    const failPending = (message: string): void => {
      const pending = this.pending;
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending = null;
      pending.reject(new Error(message));
    };

    child.once('error', (error) => {
      this.child = null;
      failPending(error instanceof Error ? error.message : String(error));
    });
    child.once('exit', (code, signal) => {
      this.child = null;
      const detail = [
        `exitCode=${code ?? 'null'}`,
        `signal=${signal ?? 'null'}`,
        this.stderrTail.trim() ? `stderrTail=${JSON.stringify(this.stderrTail.trim())}` : null,
      ].filter(Boolean).join(' ');
      failPending(`native metadata reader exited before response; ${detail}`);
    });

    return child;
  }

  private handleLine(line: string): void {
    let message: NativeMetadataMessage | null = null;
    try {
      message = parseNativeMetadataLine(line);
    } catch (error) {
      this.pending?.reject(new Error(`native metadata reader returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    if (!message || message.type === 'ready' || message.type === 'started') {
      return;
    }

    if (message.type === 'capabilities') {
      recordNativeMetadataCapabilities(message);
      return;
    }

    const pending = this.pending;
    if (!pending) {
      return;
    }

    if (message.type === 'metadata') {
      if (isMetadataResult(message.result)) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error('native metadata reader returned invalid metadata result'));
      }
      return;
    }

    const detail = typeof message.message === 'string' ? message.message : 'native metadata reader error';
    pending.reject(new Error(detail));
  }

  private killProcess(): void {
    const pending = this.pending;
    if (pending) {
      clearTimeout(pending.timer);
      this.pending = null;
    }
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
  }
}

export class NativeThenTsMetadataReader implements MetadataReader {
  private readonly warnedFallbackMessages = new Set<string>();
  private readonly stats: NativeMetadataReaderRuntimeStats = {
    total: 0,
    nativeOk: 0,
    fallbackToTs: 0,
    skippedUnsupportedExtension: 0,
  };
  private lastStatsLogTotal = 0;

  constructor(
    private readonly nativeReader: MetadataReader = new NativeMetadataReader(),
    private readonly tsReader: MetadataReader = new TsMetadataReader(),
    private readonly logger: (message: string) => void = console.warn,
    private readonly readSettingEnabled: NativeMetadataReaderEnabledProvider = () => false,
  ) {}

  async read(filePath: string): Promise<MetadataResult> {
    const enablement = getNativeMetadataReaderEnablement(this.readSettingEnabled);
    if (!enablement.enabled) {
      return this.tsReader.read(filePath);
    }

    if (!isNativeMetadataSupportedPath(filePath)) {
      this.recordNativeStats(enablement.source, 'skipped_extension');
      return this.tsReader.read(filePath);
    }

    try {
      const result = await this.nativeReader.read(filePath);
      this.recordNativeStats(enablement.source, 'native_ok');
      return this.supplementNativeResult(filePath, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNativeMetadataVerbose() && !this.warnedFallbackMessages.has(message)) {
        this.warnedFallbackMessages.add(message);
        this.logger(`[library-scan] Native metadata reader failed; falling back to TS reader: ${message}`);
      }
      this.recordNativeStats(enablement.source, 'fallback_to_ts');
      return this.tsReader.read(filePath);
    }
  }

  private async supplementNativeResult(filePath: string, nativeResult: MetadataResult): Promise<MetadataResult> {
    if (!shouldSupplementNativeMetadataFromTs()) {
      return nativeResult;
    }

    const shouldReadTs =
      this.shouldSupplementCover(nativeResult) ||
      this.shouldSupplementTechnicalFields(nativeResult);
    if (!shouldReadTs) {
      return nativeResult;
    }

    try {
      const tsResult = await this.tsReader.read(filePath);
      const supplemented: MetadataResult = {
        ...nativeResult,
        fields: { ...nativeResult.fields },
        fieldSources: { ...nativeResult.fieldSources },
      };

      this.supplementTechnicalFields(supplemented, tsResult);

      if (this.shouldSupplementCover(nativeResult) && (tsResult.embeddedCover || tsResult.embeddedCoverStatus === 'error')) {
        supplemented.embeddedCover = tsResult.embeddedCover;
        supplemented.embeddedCoverStatus = tsResult.embeddedCover ? 'present' : tsResult.embeddedCoverStatus;
      }

      return supplemented;
    } catch {
      return nativeResult;
    }
  }

  private shouldSupplementCover(nativeResult: MetadataResult): boolean {
    return shouldSupplementNativeMetadataCover() && !nativeResult.embeddedCover;
  }

  private shouldSupplementTechnicalFields(nativeResult: MetadataResult): boolean {
    return (
      !isPositiveNumber(nativeResult.fields.duration) ||
      !isPositiveTechnicalField('sampleRate', nativeResult.fields.sampleRate) ||
      !isPositiveNumber(nativeResult.fields.bitrate)
    );
  }

  private supplementTechnicalFields(nativeResult: MetadataResult, tsResult: MetadataResult): void {
    const supplementPositiveNumber = (field: 'duration' | 'sampleRate' | 'bitrate' | 'bitDepth'): void => {
      if (isPositiveTechnicalField(field, nativeResult.fields[field]) || !isPositiveTechnicalField(field, tsResult.fields[field])) {
        return;
      }
      nativeResult.fields[field] = tsResult.fields[field];
      nativeResult.fieldSources[field] = tsResult.fieldSources[field] ?? 'technical';
    };

    supplementPositiveNumber('duration');
    supplementPositiveNumber('sampleRate');
    supplementPositiveNumber('bitrate');
    supplementPositiveNumber('bitDepth');
  }

  private recordNativeStats(source: NativeMetadataReaderEnablementSource, status: 'native_ok' | 'fallback_to_ts' | 'skipped_extension'): void {
    this.stats.total += 1;
    if (status === 'native_ok') {
      this.stats.nativeOk += 1;
    } else if (status === 'fallback_to_ts') {
      this.stats.fallbackToTs += 1;
    } else {
      this.stats.skippedUnsupportedExtension += 1;
    }
    nativeMetadataReaderRuntimeStats.total = this.stats.total;
    nativeMetadataReaderRuntimeStats.nativeOk = this.stats.nativeOk;
    nativeMetadataReaderRuntimeStats.fallbackToTs = this.stats.fallbackToTs;
    nativeMetadataReaderRuntimeStats.skippedUnsupportedExtension = this.stats.skippedUnsupportedExtension;

    const verbose = isNativeMetadataVerbose();
    const shouldLog =
      this.stats.total - this.lastStatsLogTotal >= getNativeMetadataSummaryInterval() ||
      (verbose && this.stats.total === 1) ||
      (verbose && this.stats.fallbackToTs <= 3 && status === 'fallback_to_ts') ||
      (verbose && this.stats.skippedUnsupportedExtension <= 3 && status === 'skipped_extension');
    if (!shouldLog) {
      return;
    }

    this.lastStatsLogTotal = this.stats.total;
    const hitRate = this.stats.total > 0 ? this.stats.nativeOk / this.stats.total : 0;
    logLibraryScanPerf({
      phase: 'nativeMetadataReader',
      fileCount: this.stats.total,
      detail: [
        'summary',
        `source=${source}`,
        `nativeOk=${this.stats.nativeOk}`,
        `fallbackToTs=${this.stats.fallbackToTs}`,
        `skippedUnsupportedExtension=${this.stats.skippedUnsupportedExtension}`,
        `hitRate=${hitRate.toFixed(3)}`,
      ].join(';'),
    });
  }
}
