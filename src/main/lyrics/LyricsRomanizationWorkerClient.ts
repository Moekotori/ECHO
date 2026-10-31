import { createLyricsRomanizationProcess } from './LyricsRomanizationProcessTransport';
import type { WorkerOptions } from 'node:worker_threads';
import {
  getLyricsRomanizationRequestId,
  isLyricsRomanizationWorkerResponse,
  type LyricsRomanizationResult,
  type LyricsRomanizationWorkerRequest,
} from './LyricsRomanizationWorkerProtocol';

export type LyricsRomanizationWorkerLike = {
  postMessage(message: LyricsRomanizationWorkerRequest): void;
  terminate(): Promise<number> | number;
  unref?(): void;
  on(event: 'message', listener: (message: unknown) => void): LyricsRomanizationWorkerLike;
  on(event: 'error', listener: (error: Error) => void): LyricsRomanizationWorkerLike;
  on(event: 'exit', listener: (code: number) => void): LyricsRomanizationWorkerLike;
};

type ModuleWorkerOptions = WorkerOptions & { type?: 'module' | 'commonjs' };
export type LyricsRomanizationWorkerFactory = (
  source: URL,
  options: ModuleWorkerOptions,
) => LyricsRomanizationWorkerLike;

type PendingRequest = {
  request: LyricsRomanizationWorkerRequest;
  resolve: (results: LyricsRomanizationResult[]) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
};

export type LyricsRomanizationWorkerClientOptions = {
  workerFactory?: LyricsRomanizationWorkerFactory;
  workerUrl?: URL;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  warn?: (message: string) => void;
};

const defaultWorkerUrl = new URL('./lyricsRomanizationWorkerHost.js', import.meta.url);
const defaultRequestTimeoutMs = 60_000;
const defaultIdleTimeoutMs = 45_000;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export class LyricsRomanizationWorkerClient {
  private readonly workerFactory: LyricsRomanizationWorkerFactory;
  private readonly workerUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly warn: (message: string) => void;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly queue: number[] = [];
  private worker: LyricsRomanizationWorkerLike | null = null;
  private workerGeneration = 0;
  private activeRequestId: number | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private nextRequestId = 1;
  private closed = false;
  private warned = false;

  constructor(options: LyricsRomanizationWorkerClientOptions = {}) {
    this.workerFactory =
      options.workerFactory ??
      ((source) => createLyricsRomanizationProcess(source));
    this.workerUrl = options.workerUrl ?? defaultWorkerUrl;
    this.requestTimeoutMs = Math.max(
      1,
      Math.round(options.requestTimeoutMs ?? defaultRequestTimeoutMs),
    );
    this.idleTimeoutMs = Math.max(1, Math.round(options.idleTimeoutMs ?? defaultIdleTimeoutMs));
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  romanize(texts: string[]): Promise<LyricsRomanizationResult[]> {
    if (this.closed) {
      return Promise.reject(new Error('Lyrics romanization worker client is closed'));
    }

    this.cancelIdleShutdown();
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        request: { requestId, type: 'romanize', texts },
        resolve,
        reject,
        timeout: null,
      });
      this.queue.push(requestId);
      this.pump();
    });
  }

  releaseIdle(_reason = 'explicit'): boolean {
    if (
      this.closed
      || this.activeRequestId !== null
      || this.queue.length > 0
      || this.pending.size > 0
    ) {
      return false;
    }
    this.cancelIdleShutdown();
    const worker = this.detachWorker();
    if (!worker) {
      return false;
    }
    this.terminate(worker);
    return true;
  }

  dispose(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.cancelIdleShutdown();
    const worker = this.detachWorker();
    const error = new Error('Lyrics romanization worker client is closed');
    this.activeRequestId = null;
    this.queue.length = 0;
    for (const task of this.pending.values()) {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.timeout = null;
      task.reject(error);
    }
    this.pending.clear();
    this.terminate(worker);
  }

  getDiagnostics(): {
    workerActive: boolean;
    activeRequestId: number | null;
    pendingCount: number;
    queuedCount: number;
    idleTimerActive: boolean;
    generation: number;
  } {
    return {
      workerActive: this.worker !== null,
      activeRequestId: this.activeRequestId,
      pendingCount: this.pending.size,
      queuedCount: this.queue.length,
      idleTimerActive: this.idleTimer !== null,
      generation: this.workerGeneration,
    };
  }

  private ensureWorker(): LyricsRomanizationWorkerLike {
    if (this.worker) {
      return this.worker;
    }

    const generation = this.workerGeneration + 1;
    const worker = this.workerFactory(this.workerUrl, { type: 'module' });
    this.worker = worker;
    this.workerGeneration = generation;
    worker.on('message', (message) => this.handleMessage(worker, generation, message));
    worker.on('error', (error) => this.handleWorkerFailure(worker, generation, error));
    worker.on('exit', (code) => {
      this.handleWorkerFailure(
        worker,
        generation,
        new Error(`Lyrics romanization worker exited with code ${code}`),
      );
    });
    worker.unref?.();
    return worker;
  }

  private pump(): void {
    if (this.closed || this.activeRequestId !== null) {
      return;
    }

    this.cancelIdleShutdown();
    while (this.queue.length > 0) {
      const requestId = this.queue.shift()!;
      const task = this.pending.get(requestId);
      if (!task) {
        continue;
      }

      let worker: LyricsRomanizationWorkerLike;
      try {
        worker = this.ensureWorker();
      } catch (error) {
        this.failTask(task, asError(error));
        this.warnOnce(error);
        continue;
      }

      this.activeRequestId = requestId;
      const generation = this.workerGeneration;
      task.timeout = setTimeout(() => {
        this.handleWorkerFailure(
          worker,
          generation,
          new Error(`Lyrics romanization worker request timed out after ${this.requestTimeoutMs}ms`),
        );
      }, this.requestTimeoutMs);
      task.timeout.unref?.();
      try {
        worker.postMessage(task.request);
      } catch (error) {
        this.handleWorkerFailure(worker, generation, asError(error));
      }
      return;
    }

    this.scheduleIdleShutdown();
  }

  private handleMessage(
    worker: LyricsRomanizationWorkerLike,
    generation: number,
    message: unknown,
  ): void {
    if (this.worker !== worker || this.workerGeneration !== generation) {
      return;
    }

    const requestId = getLyricsRomanizationRequestId(message);
    if (requestId !== null && requestId !== this.activeRequestId) {
      return;
    }
    if (!isLyricsRomanizationWorkerResponse(message)) {
      this.handleWorkerFailure(
        worker,
        generation,
        new Error('Lyrics romanization worker returned an invalid response'),
      );
      return;
    }

    const task = this.completeActiveRequest(message.requestId);
    if (!task) {
      return;
    }

    if (message.ok) {
      task.resolve(message.results);
      this.pump();
      return;
    }

    const error = new Error(message.message || 'Lyrics romanization worker failed');
    task.reject(error);
    this.warnOnce(error);
    const retiredWorker = this.detachWorker();
    this.terminate(retiredWorker);
    this.pump();
  }

  private handleWorkerFailure(
    worker: LyricsRomanizationWorkerLike,
    generation: number,
    error: unknown,
  ): void {
    if (this.worker !== worker || this.workerGeneration !== generation) {
      return;
    }

    const failure = asError(error);
    this.cancelIdleShutdown();
    const retiredWorker = this.detachWorker();
    if (this.activeRequestId !== null) {
      const task = this.completeActiveRequest(this.activeRequestId);
      task?.reject(failure);
    }
    this.warnOnce(failure);
    this.terminate(retiredWorker);
    this.pump();
  }

  private completeActiveRequest(requestId: number): PendingRequest | null {
    if (this.activeRequestId !== requestId) {
      return null;
    }

    const task = this.pending.get(requestId) ?? null;
    this.activeRequestId = null;
    this.pending.delete(requestId);
    if (task?.timeout) {
      clearTimeout(task.timeout);
      task.timeout = null;
    }
    return task;
  }

  private failTask(task: PendingRequest, error: Error): void {
    this.pending.delete(task.request.requestId);
    if (task.timeout) {
      clearTimeout(task.timeout);
      task.timeout = null;
    }
    task.reject(error);
  }

  private detachWorker(): LyricsRomanizationWorkerLike | null {
    const worker = this.worker;
    this.worker = null;
    return worker;
  }

  private terminate(worker: LyricsRomanizationWorkerLike | null): void {
    if (worker) {
      void Promise.resolve(worker.terminate()).catch(() => undefined);
    }
  }

  private scheduleIdleShutdown(): void {
    if (
      this.closed ||
      this.activeRequestId !== null ||
      this.queue.length > 0 ||
      this.pending.size > 0 ||
      !this.worker
    ) {
      return;
    }

    this.cancelIdleShutdown();
    const worker = this.worker;
    const generation = this.workerGeneration;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (
        this.closed ||
        this.worker !== worker ||
        this.workerGeneration !== generation ||
        this.activeRequestId !== null ||
        this.queue.length > 0 ||
        this.pending.size > 0
      ) {
        return;
      }

      this.terminate(this.detachWorker());
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private cancelIdleShutdown(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = null;
  }

  private warnOnce(error: unknown): void {
    if (this.warned) {
      return;
    }

    this.warned = true;
    const message = error instanceof Error ? error.message : String(error);
    this.warn(`[lyrics-romanization] Worker unavailable; keeping original lyrics: ${message}`);
  }
}
