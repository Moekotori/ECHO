import { Worker } from 'node:worker_threads';
import type { LibraryAlbum, LibraryPage, LibraryPageQuery, LibraryTrack, PlaybackHistoryQuery, PlaybackStatsDashboard } from '../../../shared/types/library';
import type { LibraryStoreSearchOptions } from '../LibraryStore';

export type LibraryReadRequest = {
  id: number;
  searchOptions: LibraryStoreSearchOptions;
} & ({ kind: 'tracks' | 'albums'; query?: LibraryPageQuery } | { kind: 'stats'; query?: PlaybackHistoryQuery });
export type LibraryReadResult = LibraryPage<LibraryTrack> | LibraryPage<LibraryAlbum> | PlaybackStatsDashboard;
export type LibraryReadResponse =
  | { id: number; ok: true; page: LibraryReadResult }
  | { id: number; ok: false; error: string };

type Task = {
  request: LibraryReadRequest;
  resolve: (page: LibraryReadResult) => void;
  reject: (error: Error) => void;
};

/** One read-only query at a time, with no SQLite work on the main thread. */
export class LibraryReadWorker {
  private worker: Worker | null = null;
  private active: Task | null = null;
  private readonly queue: Task[] = [];
  private readonly pending = new Map<string, Promise<LibraryReadResult>>();
  private timer: NodeJS.Timeout | null = null;
  private nextId = 0;
  private closed = false;
  private closing: Promise<void> | null = null;
  private termination: Promise<void> = Promise.resolve();

  constructor(
    private readonly databasePath: string,
    private readonly workerUrl = new URL('./libraryReadWorkerHost.js', import.meta.url),
  ) {}

  read(kind: 'tracks', query: LibraryPageQuery | undefined, options: LibraryStoreSearchOptions): Promise<LibraryPage<LibraryTrack>>;
  read(kind: 'albums', query: LibraryPageQuery | undefined, options: LibraryStoreSearchOptions): Promise<LibraryPage<LibraryAlbum>>;
  read(kind: 'stats', query: PlaybackHistoryQuery | undefined, options: LibraryStoreSearchOptions): Promise<PlaybackStatsDashboard>;
  read(kind: LibraryReadRequest['kind'], query: LibraryPageQuery | PlaybackHistoryQuery | undefined, options: LibraryStoreSearchOptions): Promise<LibraryReadResult> {
    if (this.closed) return Promise.reject(new Error('Library read worker is closed'));
    const key = JSON.stringify([kind, Object.entries(query ?? {}).sort(([a], [b]) => a.localeCompare(b)), options]);
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.queue.length >= 64) return Promise.reject(new Error('Too many pending library queries'));
    const promise = new Promise<LibraryReadResult>((resolve, reject) => {
      this.queue.push({ request: { id: ++this.nextId, kind, query, searchOptions: options } as LibraryReadRequest, resolve, reject });
    });
    this.pending.set(key, promise);
    const clear = () => { if (this.pending.get(key) === promise) this.pending.delete(key); };
    void promise.then(clear, clear);
    this.pump();
    return promise;
  }

  close(): Promise<void> {
    this.closed = true;
    if (!this.closing) this.closing = this.stop(new Error('Library read worker is closed'), true);
    return this.closing;
  }

  private pump(): void {
    if (this.closed || this.active || this.queue.length === 0) return;
    try {
      if (!this.worker) {
        const worker = new Worker(this.workerUrl, { workerData: { databasePath: this.databasePath } });
        this.worker = worker;
        worker.on('message', (message: LibraryReadResponse) => {
          if (this.worker !== worker || this.active?.request.id !== message.id) return;
          const task = this.active;
          this.active = null;
          if (this.timer) clearTimeout(this.timer);
          this.timer = null;
          if (message.ok) task.resolve(message.page);
          else task.reject(new Error(message.error));
          this.pump();
        });
        worker.unref();
        worker.on('error', (error) => { if (this.worker === worker) this.fail(error); });
        worker.on('exit', (code) => {
          if (this.worker === worker) this.fail(new Error(`Library read worker exited (${code})`));
        });
      }
      this.active = this.queue.shift()!;
      this.timer = setTimeout(() => { this.fail(new Error('Library query timed out')); }, 30_000);
      this.timer.unref();
      this.worker.postMessage(this.active.request);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private fail(error: Error): void {
    void this.stop(error).catch((stopError) => console.warn('[library-read-worker] Failed to stop worker', stopError));
  }

  private closeWorkerAfterQuery(worker: Worker): Promise<void> {
    // Allow SQLite to unwind normally before the isolate is destroyed.
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { void worker.terminate().catch(reject); }, 5_000);
      const onExit = () => { clearTimeout(timer); worker.removeListener('error', onError); resolve(); };
      const onError = (error: Error) => { clearTimeout(timer); worker.removeListener('exit', onExit); reject(error); };
      worker.once('exit', onExit);
      worker.once('error', onError);
      try { worker.postMessage({ kind: 'close' }); } catch (error) { onError(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  private stop(error: Error, graceful = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active?.reject(error);
    this.active = null;
    for (const task of this.queue.splice(0)) task.reject(error);
    this.pending.clear();
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      const stopped = graceful ? this.closeWorkerAfterQuery(worker) : worker.terminate().then(() => undefined);
      this.termination = Promise.all([this.termination, stopped]).then(() => undefined);
    }
    return this.termination;
  }
}
