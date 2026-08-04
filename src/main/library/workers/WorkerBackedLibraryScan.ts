import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';
import { FileIdentityService, type FileIdentityObservation } from '../FileIdentityService';
import type { CoverCacheRepairOptions, CoverExtractOptions, CoverResult, MetadataResult } from '../libraryTypes';
import type { CoverExtractor } from './CoverExtractor';
import type { MetadataReader } from './MetadataReader';
import { TsCoverExtractor } from './TsCoverExtractor';
import { TsMetadataReader } from './TsMetadataReader';
import type {
  LibraryScanWorkerRequest,
  LibraryScanWorkerResponse,
  LibraryScanWorkerResult,
} from './LibraryScanWorkerProtocol';

type WorkerLike = {
  postMessage(message: unknown): void;
  terminate(): Promise<number> | number;
  on(event: 'message', listener: (message: LibraryScanWorkerResponse) => void): WorkerLike;
  on(event: 'error', listener: (error: Error) => void): WorkerLike;
  on(event: 'exit', listener: (code: number) => void): WorkerLike;
};

type ModuleWorkerOptions = WorkerOptions & { type?: 'module' | 'commonjs' };
type WorkerFactory = (source: URL, options: ModuleWorkerOptions) => WorkerLike;

type QueuedWorkerTask = {
  request: LibraryScanWorkerRequest;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
};

type WorkerSlot = {
  worker: WorkerLike;
  currentTask: QueuedWorkerTask | null;
  retired: boolean;
};

export type WorkerBackedLibraryScanOptions = {
  workerCount?: number;
  taskTimeoutMs?: number;
  workerFactory?: WorkerFactory;
  workerUrl?: URL;
};

const defaultTaskTimeoutMs = 120_000;
const defaultWorkerUrl = new URL('./libraryScanWorkerHost.js', import.meta.url);

const normalizeWorkerCount = (value: unknown): number => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(1, Math.min(8, Math.round(numeric)));
  }

  return Math.max(1, Math.min(4, Math.floor(cpus().length / 2) || 1));
};

const toError = (error: unknown): Error => error instanceof Error ? error : new Error(String(error));

class LibraryScanWorkerPool {
  private readonly workerCount: number;
  private readonly taskTimeoutMs: number;
  private readonly workerFactory: WorkerFactory;
  private readonly workerUrl: URL;
  private readonly workers: WorkerSlot[] = [];
  private readonly queue: QueuedWorkerTask[] = [];
  private nextRequestId = 1;
  private started = false;
  private closed = false;
  private startupError: Error | null = null;

  constructor(options: WorkerBackedLibraryScanOptions = {}) {
    this.workerCount = normalizeWorkerCount(options.workerCount);
    this.taskTimeoutMs = Math.max(1_000, Math.round(options.taskTimeoutMs ?? defaultTaskTimeoutMs));
    this.workerFactory = options.workerFactory ?? ((source, workerOptions) => new Worker(source, workerOptions) as WorkerLike);
    this.workerUrl = options.workerUrl ?? defaultWorkerUrl;
  }

  run(request: Omit<Extract<LibraryScanWorkerRequest, { type: 'metadata:read' }>, 'requestId'>): Promise<MetadataResult>;
  run(request: Omit<Extract<LibraryScanWorkerRequest, { type: 'cover:extract' }>, 'requestId'>): Promise<CoverResult>;
  run(request: Omit<Extract<LibraryScanWorkerRequest, { type: 'cover:repair' }>, 'requestId'>): Promise<CoverResult>;
  run(request: Omit<Extract<LibraryScanWorkerRequest, { type: 'identity:observe' }>, 'requestId'>): Promise<FileIdentityObservation>;
  run(request: Omit<LibraryScanWorkerRequest, 'requestId'>): Promise<LibraryScanWorkerResult> {
    if (this.closed) {
      return Promise.reject(new Error('Library scan worker pool is closed'));
    }
    if (this.startupError) {
      return Promise.reject(this.startupError);
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        request: {
          ...request,
          requestId: this.nextRequestId++,
        } as unknown as LibraryScanWorkerRequest,
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout: null,
      });
      this.ensureStarted();
      this.pump();
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const closeError = new Error('Library scan worker pool is closed');
    for (const task of this.queue.splice(0)) {
      task.reject(closeError);
    }

    for (const slot of [...this.workers]) {
      this.retireWorker(slot, closeError);
    }
  }

  private ensureStarted(): boolean {
    if (this.started || this.closed) {
      return this.workers.length > 0;
    }

    this.started = true;
    while (this.workers.length < this.workerCount) {
      try {
        this.createWorker();
      } catch (error) {
        const startupError = toError(error);
        if (this.workers.length === 0) {
          this.startupError = startupError;
          for (const task of this.queue.splice(0)) {
            task.reject(startupError);
          }
        }
        break;
      }
    }
    return this.workers.length > 0;
  }

  private createWorker(): void {
    if (this.closed) {
      return;
    }

    const slot: WorkerSlot = {
      worker: this.workerFactory(this.workerUrl, { type: 'module' }),
      currentTask: null,
      retired: false,
    };
    slot.worker.on('message', (message) => this.handleWorkerMessage(slot, message));
    slot.worker.on('error', (error) => this.retireWorker(slot, error));
    slot.worker.on('exit', (code) => {
      if (!this.closed && !slot.retired) {
        this.retireWorker(slot, new Error(`Library scan worker exited with code ${code}`));
      }
    });
    this.workers.push(slot);
  }

  private pump(): void {
    if (this.closed) {
      return;
    }

    for (const slot of this.workers) {
      if (slot.currentTask || slot.retired) {
        continue;
      }

      const task = this.queue.shift();
      if (!task) {
        return;
      }

      slot.currentTask = task;
      task.timeout = setTimeout(() => {
        this.retireWorker(slot, new Error(`Library scan worker task timed out after ${this.taskTimeoutMs}ms`));
      }, this.taskTimeoutMs);
      task.timeout.unref?.();
      try {
        slot.worker.postMessage(task.request);
      } catch (error) {
        this.retireWorker(slot, toError(error));
      }
    }
  }

  private handleWorkerMessage(slot: WorkerSlot, message: LibraryScanWorkerResponse): void {
    const task = slot.currentTask;
    if (!task || task.request.requestId !== message.requestId) {
      return;
    }

    if (task.timeout) {
      clearTimeout(task.timeout);
      task.timeout = null;
    }
    slot.currentTask = null;

    if (message.ok) {
      task.resolve(message.result);
    } else {
      task.reject(new Error(message.message || 'Library scan worker failed'));
    }

    this.pump();
  }

  private retireWorker(slot: WorkerSlot, error: Error): void {
    if (slot.retired) {
      return;
    }

    slot.retired = true;
    const index = this.workers.indexOf(slot);
    if (index >= 0) {
      this.workers.splice(index, 1);
    }

    const task = slot.currentTask;
    slot.currentTask = null;
    if (task) {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.reject(error);
    }

    void Promise.resolve(slot.worker.terminate()).catch(() => undefined);
    if (!this.closed) {
      this.createWorker();
      this.pump();
    }
  }
}

class FallbackOnceLogger {
  private readonly warnedKinds = new Set<string>();

  warn(kind: string, error: unknown): void {
    if (this.warnedKinds.has(kind)) {
      return;
    }

    this.warnedKinds.add(kind);
    console.warn(`[library-worker] ${kind} worker failed; falling back to main-thread implementation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export class WorkerBackedMetadataReader implements MetadataReader {
  private readonly fallback = new TsMetadataReader();

  constructor(
    private readonly pool: LibraryScanWorkerPool,
    private readonly logger: FallbackOnceLogger,
  ) {}

  async read(filePath: string): Promise<MetadataResult> {
    try {
      const result = await this.pool.run({
        type: 'metadata:read',
        filePath,
      });
      if (result.status === 'error') {
        const fallbackResult = await this.fallback.read(filePath);
        if (fallbackResult.status !== 'error') {
          this.logger.warn('metadata:read:error-result', result.errors[0] ?? 'worker returned metadata error');
          return fallbackResult;
        }
      }
      return result;
    } catch (error) {
      this.logger.warn('metadata:read', error);
      return this.fallback.read(filePath);
    }
  }
}

export class WorkerBackedCoverExtractor implements CoverExtractor {
  private readonly fallback = new TsCoverExtractor();

  constructor(
    private readonly pool: LibraryScanWorkerPool,
    private readonly logger: FallbackOnceLogger,
  ) {}

  async extract(filePath: string, options: CoverExtractOptions): Promise<CoverResult> {
    try {
      return await this.pool.run({
        type: 'cover:extract',
        filePath,
        options,
      });
    } catch (error) {
      this.logger.warn('cover:extract', error);
      return this.fallback.extract(filePath, options);
    }
  }

  async repairCachedCover(options: CoverCacheRepairOptions): Promise<CoverResult> {
    try {
      return await this.pool.run({
        type: 'cover:repair',
        options,
      });
    } catch (error) {
      this.logger.warn('cover:repair', error);
      return this.fallback.repairCachedCover(options);
    }
  }
}

export class WorkerBackedFileIdentityService {
  private readonly fallback = new FileIdentityService();

  constructor(
    private readonly pool: LibraryScanWorkerPool,
    private readonly logger: FallbackOnceLogger,
  ) {}

  async observe(filePath: string): Promise<FileIdentityObservation> {
    try {
      return await this.pool.run({
        type: 'identity:observe',
        filePath,
      });
    } catch (error) {
      this.logger.warn('identity:observe', error);
      return this.fallback.observe(filePath);
    }
  }
}

export type WorkerBackedLibraryScanWorkers = {
  metadataReader: MetadataReader;
  coverExtractor: CoverExtractor;
  fileIdentityService: { observe(filePath: string): FileIdentityObservation | Promise<FileIdentityObservation> };
  close: () => void;
};

export const createWorkerBackedLibraryScanWorkers = (
  options: WorkerBackedLibraryScanOptions = {},
): WorkerBackedLibraryScanWorkers => {
  const pool = new LibraryScanWorkerPool(options);
  const logger = new FallbackOnceLogger();
  return {
    metadataReader: new WorkerBackedMetadataReader(pool, logger),
    coverExtractor: new WorkerBackedCoverExtractor(pool, logger),
    fileIdentityService: new WorkerBackedFileIdentityService(pool, logger),
    close: () => pool.close(),
  };
};
