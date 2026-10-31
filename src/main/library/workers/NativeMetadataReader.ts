import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { logLibraryScanPerf } from '../../diagnostics/LibraryScanPerfDiagnostics';
import type { NativeMetadataReaderDiagnostics } from '../../../shared/types/library';
import type { FieldSources, MetadataFields, MetadataResult } from '../libraryTypes';
import type { MetadataReader, MetadataReadOptions } from './MetadataReader';
import { resolveNativeFileScannerPath } from './NativeFileScanner';
import {
  setNativeScannerProcessPriority,
  type NativeScannerProcessPriorityMode,
} from './NativeScannerProcessPriority';
import { repairMojibakeText, TsMetadataReader } from './TsMetadataReader';

type SpawnNativeMetadataReader = (command: string, args: readonly string[]) => ChildProcessWithoutNullStreams;
type NativeMetadataReaderEnabledProvider = () => boolean;
type NativeMetadataReaderEnablementSource = 'env-disable' | 'env-enable' | 'setting' | 'default';
type PendingNativeMetadataRequest = {
  requestId: string;
  path: string;
  readCover: boolean;
  generation: number;
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
  poolSize: number;
  activeProcesses: number;
  lastError: string | null;
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
  | { type: 'metadata'; requestId?: unknown; path?: unknown; result?: unknown }
  | { type: 'unsupported'; requestId?: unknown; path?: unknown; message?: unknown }
  | { type: 'error'; requestId?: unknown; kind?: unknown; path?: unknown; message?: unknown };

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
// WAV metadata is intentionally routed through the TS reader even when the Lab
// native reader is enabled. The TS path has broader RIFF/RF64/BW64, BWF/bext,
// ID3, cover, legacy-encoding, and INFO-alias compatibility.
const tsPreferredMetadataExtensions = new Set(['.wav', '.wave', '.bwf']);
const defaultNativeMetadataSummaryInterval = 500;
const defaultNativeMetadataCapabilities = {
  protocolVersion: 2,
  supportedRequests: ['scan', 'metadata'],
  features: ['batching', 'progress', 'directorySnapshots', 'persistentMetadata', 'requestIds', 'singleMetadataResponse', 'embeddedCoverBase64'],
  metadataFormats: nativeMetadataReaderSupportedFormats,
  metadataExtensions: Array.from(nativeMetadataReaderSupportedExtensions),
};
const nativeMetadataReaderRuntimeStats: NativeMetadataReaderRuntimeStats = {
  total: 0,
  nativeOk: 0,
  fallbackToTs: 0,
  skippedUnsupportedExtension: 0,
  poolSize: 0,
  activeProcesses: 0,
  lastError: null,
};
let lastNativeMetadataCapabilities = defaultNativeMetadataCapabilities;

const isNativeMetadataSupportedPath = (filePath: string): boolean =>
  nativeMetadataReaderSupportedExtensions.has(extname(filePath).toLowerCase());

const getNativeMetadataSummaryInterval = (): number => {
  const value = Number(process.env.ECHO_NATIVE_METADATA_SUMMARY_INTERVAL ?? defaultNativeMetadataSummaryInterval);
  return Number.isFinite(value) ? Math.max(50, Math.round(value)) : defaultNativeMetadataSummaryInterval;
};

const isNativeMetadataVerbose = (): boolean => process.env.ECHO_NATIVE_METADATA_VERBOSE === '1';
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
    poolSize: nativeMetadataReaderRuntimeStats.poolSize,
    activeProcesses: nativeMetadataReaderRuntimeStats.activeProcesses,
    lastError: nativeMetadataReaderRuntimeStats.lastError,
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
  const nullableFiniteNumber = (field: unknown): boolean => field === null || (typeof field === 'number' && Number.isFinite(field));
  return (
    typeof fields.title === 'string' &&
    typeof fields.artist === 'string' &&
    typeof fields.album === 'string' &&
    typeof fields.albumArtist === 'string' &&
    nullableFiniteNumber(fields.trackNo) &&
    nullableFiniteNumber(fields.discNo) &&
    nullableFiniteNumber(fields.year) &&
    (fields.genre === null || typeof fields.genre === 'string') &&
    typeof fields.duration === 'number' && Number.isFinite(fields.duration) && fields.duration >= 0 &&
    (fields.codec === null || typeof fields.codec === 'string') &&
    nullableFiniteNumber(fields.sampleRate) &&
    nullableFiniteNumber(fields.bitDepth) &&
    nullableFiniteNumber(fields.bitrate) &&
    nullableFiniteNumber(fields.bpm) &&
    nullableFiniteNumber(fields.replayGainTrackGainDb) &&
    nullableFiniteNumber(fields.replayGainAlbumGainDb) &&
    nullableFiniteNumber(fields.replayGainTrackPeak) &&
    nullableFiniteNumber(fields.replayGainAlbumPeak) &&
    nullableFiniteNumber(fields.replayGainIntegratedLufs)
  );
};

const requiredNativeFieldSources: Array<keyof MetadataFields> = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'trackNo',
  'discNo',
  'year',
  'genre',
  'duration',
  'codec',
  'sampleRate',
  'bitDepth',
  'bitrate',
  'bpm',
  'replayGainTrackGainDb',
  'replayGainAlbumGainDb',
  'replayGainTrackPeak',
  'replayGainAlbumPeak',
  'replayGainIntegratedLufs',
];
const validNativeFieldSources = new Set([
  'manual',
  'embedded',
  'sidecar',
  'folder_structure',
  'osu',
  'network',
  'technical',
  'artist_fallback',
  'filename_fallback',
  'unknown',
]);
const isFieldSources = (value: unknown): value is FieldSources => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const sources = value as Record<string, unknown>;
  return requiredNativeFieldSources.every((field) => validNativeFieldSources.has(String(sources[field])));
};

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

type NativeMetadataWireResult = MetadataResult & {
  embeddedCoverBase64?: unknown;
  embeddedCoverMimeType?: unknown;
};

const decodeNativeMetadataResult = (value: unknown, readCover: boolean): MetadataResult | null => {
  if (!isMetadataResult(value)) {
    return null;
  }
  const wire = value as NativeMetadataWireResult;
  const { embeddedCoverBase64, embeddedCoverMimeType, ...wireResult } = wire;
  const result: MetadataResult = {
    ...wireResult,
    fields: {
      ...wireResult.fields,
      title: repairMojibakeText(wireResult.fields.title),
      artist: repairMojibakeText(wireResult.fields.artist),
      album: repairMojibakeText(wireResult.fields.album),
      albumArtist: repairMojibakeText(wireResult.fields.albumArtist),
      genre: wireResult.fields.genre ? repairMojibakeText(wireResult.fields.genre) : null,
    },
  };
  if (result.embeddedCoverStatus !== 'present' || !readCover) {
    return result;
  }
  if (
    typeof embeddedCoverBase64 !== 'string' ||
    embeddedCoverBase64.length === 0 ||
    embeddedCoverBase64.length > 6_000_000 ||
    embeddedCoverBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(embeddedCoverBase64) ||
    (embeddedCoverMimeType !== null && typeof embeddedCoverMimeType !== 'string') ||
    (typeof embeddedCoverMimeType === 'string' && embeddedCoverMimeType.length > 255)
  ) {
    return null;
  }
  const coverData = Buffer.from(embeddedCoverBase64, 'base64');
  if (coverData.byteLength === 0 || coverData.byteLength > 4 * 1024 * 1024) {
    return null;
  }
  return {
    ...result,
    embeddedCover: {
      data: coverData,
      mimeType: typeof embeddedCoverMimeType === 'string' ? embeddedCoverMimeType : null,
    },
  };
};

type NativeMetadataProcessContext = {
  child: ChildProcessWithoutNullStreams;
  generation: number;
  pending: Map<string, PendingNativeMetadataRequest>;
  lines: ReturnType<typeof createInterface>;
  stderrTail: string;
  protocolVersion: number | null;
  priorityMode: NativeScannerProcessPriorityMode | null;
  closed: boolean;
  onStderr: (chunk: string) => void;
  onLine: (line: string) => void;
  onError: (error: Error) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
};

export type NativeMetadataReaderOptions = {
  executablePath?: string | null;
  spawnProcess?: SpawnNativeMetadataReader;
  requestTimeoutMs?: number;
  getProcessPriorityMode?: () => NativeScannerProcessPriorityMode;
};

export class NativeMetadataReader implements MetadataReader {
  private context: NativeMetadataProcessContext | null = null;
  private requestQueue: Promise<void> = Promise.resolve();
  private generation = 0;
  private nextRequestId = 1;
  private disposed = false;

  constructor(private readonly options: NativeMetadataReaderOptions = {}) {}

  async read(filePath: string, options: MetadataReadOptions = {}): Promise<MetadataResult> {
    const task = this.requestQueue.then(
      () => this.readQueued(filePath, options),
      () => this.readQueued(filePath, options),
    );
    this.requestQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  dispose(): void {
    this.disposed = true;
    this.suspend();
  }

  suspend(): void {
    if (this.context) {
      this.retireContext(this.context, new Error('native metadata reader suspended'), true);
    }
  }

  private async readQueued(filePath: string, options: MetadataReadOptions): Promise<MetadataResult> {
    if (this.disposed) {
      throw new Error('native metadata reader disposed');
    }
    const context = this.ensureProcess();
    this.applyConfiguredProcessPriority(context);
    const resolvedPath = resolve(filePath);
    const requestId = `${context.generation}:${this.nextRequestId++}`;
    const startedAtMs = performance.now();
    const readCover = options.readCover !== false;

    return new Promise<MetadataResult>((resolveResult, rejectResult) => {
      const requestTimeoutMs = Math.max(1, Math.round(this.options.requestTimeoutMs ?? metadataRequestTimeoutMs));
      const timer = setTimeout(() => {
        const error = new Error(`native metadata reader timed out after ${requestTimeoutMs}ms`);
        logLibraryScanPerf({
          phase: 'nativeMetadataReader',
          durationMs: performance.now() - startedAtMs,
          fileCount: 1,
          detail: `status=timeout;generation=${context.generation};requestId=${requestId}`,
        });
        this.retireContext(context, error, true);
      }, requestTimeoutMs);
      timer.unref?.();

      context.pending.set(requestId, {
        requestId,
        path: resolvedPath,
        readCover,
        generation: context.generation,
        startedAtMs,
        timer,
        resolve: resolveResult,
        reject: rejectResult,
      });

      context.child.stdin.write(`${JSON.stringify({
        type: 'metadata',
        requestId,
        path: resolvedPath,
        readCover,
      })}\n`, (error) => {
        if (error) {
          this.rejectPending(context, requestId, error instanceof Error ? error : new Error(String(error)));
          this.retireContext(context, error instanceof Error ? error : new Error(String(error)), true);
        }
      });
    });
  }

  private ensureProcess(): NativeMetadataProcessContext {
    if (this.context && !this.context.closed) {
      return this.context;
    }
    const executablePath = this.options.executablePath ?? resolveNativeFileScannerPath();
    if (!executablePath) {
      throw new Error('native metadata reader binary not found');
    }

    const child = (this.options.spawnProcess ?? spawn)(executablePath, []);
    const generation = ++this.generation;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const context = {} as NativeMetadataProcessContext;
    context.child = child;
    context.generation = generation;
    context.pending = new Map();
    context.lines = lines;
    context.stderrTail = '';
    context.protocolVersion = null;
    context.priorityMode = null;
    context.closed = false;
    context.onStderr = (chunk) => {
      context.stderrTail = `${context.stderrTail}${chunk}`.slice(-stderrTailLimit);
    };
    context.onLine = (line) => this.handleLine(context, line);
    context.onError = (error) => this.retireContext(context, error, false);
    context.onExit = (code, signal) => {
      const detail = [
        `exitCode=${code ?? 'null'}`,
        `signal=${signal ?? 'null'}`,
        context.stderrTail.trim() ? `stderrTail=${JSON.stringify(context.stderrTail.trim())}` : null,
      ].filter(Boolean).join(' ');
      this.retireContext(context, new Error(`native metadata reader exited before response; ${detail}`), false);
    };

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', context.onStderr);
    lines.on('line', context.onLine);
    child.once('error', context.onError);
    child.once('exit', context.onExit);
    this.context = context;
    nativeMetadataReaderRuntimeStats.activeProcesses += 1;
    this.applyConfiguredProcessPriority(context);
    return context;
  }

  private applyConfiguredProcessPriority(context: NativeMetadataProcessContext): void {
    const requestedMode = this.options.getProcessPriorityMode?.() ?? 'balanced';
    if (context.priorityMode === requestedMode) {
      return;
    }
    if (setNativeScannerProcessPriority(context.child, 'nativeMetadataReader', requestedMode)) {
      context.priorityMode = requestedMode;
    }
  }

  private handleLine(context: NativeMetadataProcessContext, line: string): void {
    if (context.closed) {
      return;
    }
    let message: NativeMetadataMessage | null = null;
    try {
      message = parseNativeMetadataLine(line);
    } catch (error) {
      this.retireContext(
        context,
        new Error(`native metadata reader returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`),
        true,
      );
      return;
    }
    if (!message || message.type === 'ready' || message.type === 'started') {
      return;
    }
    if (message.type === 'capabilities') {
      recordNativeMetadataCapabilities(message);
      context.protocolVersion = typeof message.protocolVersion === 'number' && Number.isFinite(message.protocolVersion)
        ? Math.round(message.protocolVersion)
        : null;
      if (context.protocolVersion !== 2) {
        this.retireContext(context, new Error(`native metadata reader requires protocol v2; got ${context.protocolVersion ?? 'unknown'}`), true);
      }
      return;
    }

    if (context.protocolVersion !== 2) {
      this.retireContext(context, new Error('native metadata reader responded before a protocol v2 capabilities handshake'), true);
      return;
    }

    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const pending = requestId ? context.pending.get(requestId) : null;
    if (!pending) {
      return;
    }
    if (
      pending.generation !== context.generation ||
      typeof message.path !== 'string' ||
      resolve(message.path) !== pending.path
    ) {
      this.retireContext(context, new Error(`native metadata reader response identity mismatch for request ${requestId}`), true);
      return;
    }

    if (message.type === 'metadata') {
      const result = decodeNativeMetadataResult(message.result, pending.readCover);
      if (!result) {
        this.retireContext(context, new Error('native metadata reader returned invalid metadata result'), true);
        return;
      }
      this.resolvePending(context, requestId, result);
      return;
    }

    const detail = typeof message.message === 'string' ? message.message : 'native metadata reader error';
    this.rejectPending(context, requestId, new Error(detail));
  }

  private resolvePending(context: NativeMetadataProcessContext, requestId: string, result: MetadataResult): void {
    const pending = context.pending.get(requestId);
    if (!pending) {
      return;
    }
    context.pending.delete(requestId);
    clearTimeout(pending.timer);
    logLibraryScanPerf({
      phase: 'nativeMetadataReader',
      durationMs: performance.now() - pending.startedAtMs,
      fileCount: 1,
      detail: `status=ok;generation=${context.generation}`,
    });
    pending.resolve(result);
  }

  private rejectPending(context: NativeMetadataProcessContext, requestId: string, error: Error): void {
    const pending = context.pending.get(requestId);
    if (!pending) {
      return;
    }
    context.pending.delete(requestId);
    clearTimeout(pending.timer);
    nativeMetadataReaderRuntimeStats.lastError = error.message;
    pending.reject(error);
  }

  private retireContext(context: NativeMetadataProcessContext, error: Error, kill: boolean): void {
    if (context.closed) {
      return;
    }
    context.closed = true;
    if (this.context === context) {
      this.context = null;
    }
    nativeMetadataReaderRuntimeStats.activeProcesses = Math.max(0, nativeMetadataReaderRuntimeStats.activeProcesses - 1);
    nativeMetadataReaderRuntimeStats.lastError = error.message;
    for (const pending of context.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    context.pending.clear();
    context.lines.removeListener('line', context.onLine);
    context.lines.close();
    context.child.stderr.removeListener('data', context.onStderr);
    context.child.removeListener('error', context.onError);
    context.child.removeListener('exit', context.onExit);
    if (kill && !context.child.killed) {
      context.child.kill();
    }
  }
}

export class NativeMetadataReaderPool implements MetadataReader {
  private readonly readers: NativeMetadataReader[];
  private readonly inFlight: number[];
  private disposed = false;

  constructor(options: NativeMetadataReaderOptions & { poolSize?: number } = {}) {
    const poolSize = Math.max(1, Math.min(8, Math.round(options.poolSize ?? 1)));
    this.readers = Array.from({ length: poolSize }, () => new NativeMetadataReader(options));
    this.inFlight = this.readers.map(() => 0);
    nativeMetadataReaderRuntimeStats.poolSize = poolSize;
  }

  async read(filePath: string, options: MetadataReadOptions = {}): Promise<MetadataResult> {
    if (this.disposed) {
      throw new Error('native metadata reader pool disposed');
    }
    let readerIndex = 0;
    for (let index = 1; index < this.inFlight.length; index += 1) {
      if (this.inFlight[index] < this.inFlight[readerIndex]) {
        readerIndex = index;
      }
    }
    this.inFlight[readerIndex] += 1;
    try {
      return await this.readers[readerIndex].read(filePath, options);
    } finally {
      this.inFlight[readerIndex] = Math.max(0, this.inFlight[readerIndex] - 1);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const reader of this.readers) {
      reader.dispose();
    }
  }

  suspend(): void {
    if (this.disposed) {
      return;
    }
    for (const reader of this.readers) {
      reader.suspend();
    }
  }
}

export class NativeThenTsMetadataReader implements MetadataReader {
  private readonly warnedFallbackMessages = new Set<string>();
  private readonly stats: NativeMetadataReaderRuntimeStats = {
    total: 0,
    nativeOk: 0,
    fallbackToTs: 0,
    skippedUnsupportedExtension: 0,
    poolSize: 0,
    activeProcesses: 0,
    lastError: null,
  };
  private lastStatsLogTotal = 0;
  private nativeWasEnabled = false;

  constructor(
    private readonly nativeReader: MetadataReader = new NativeMetadataReaderPool(),
    private readonly tsReader: MetadataReader = new TsMetadataReader(),
    private readonly logger: (message: string) => void = console.warn,
    private readonly readSettingEnabled: NativeMetadataReaderEnabledProvider = () => false,
  ) {}

  async read(filePath: string, options: MetadataReadOptions = {}): Promise<MetadataResult> {
    const enablement = getNativeMetadataReaderEnablement(this.readSettingEnabled);
    if (!enablement.enabled) {
      if (this.nativeWasEnabled) {
        (this.nativeReader as MetadataReader & { suspend?: () => void }).suspend?.();
      }
      this.nativeWasEnabled = false;
      return this.tsReader.read(filePath, options);
    }
    this.nativeWasEnabled = true;

    if (tsPreferredMetadataExtensions.has(extname(filePath).toLowerCase())) {
      this.recordNativeStats(enablement.source, 'skipped_extension');
      return this.tsReader.read(filePath, options);
    }

    if (!isNativeMetadataSupportedPath(filePath)) {
      this.recordNativeStats(enablement.source, 'skipped_extension');
      return this.tsReader.read(filePath, options);
    }

    try {
      const result = await this.nativeReader.read(filePath, options);
      this.recordNativeStats(enablement.source, 'native_ok');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNativeMetadataVerbose() && !this.warnedFallbackMessages.has(message)) {
        this.warnedFallbackMessages.add(message);
        this.logger(`[library-scan] Native metadata reader failed; falling back to TS reader: ${message}`);
      }
      this.recordNativeStats(enablement.source, 'fallback_to_ts');
      return this.tsReader.read(filePath, options);
    }
  }

  dispose(): void {
    (this.nativeReader as MetadataReader & { dispose?: () => void }).dispose?.();
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
