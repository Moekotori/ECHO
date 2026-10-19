import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkerBackedLibraryScanWorkers } from './WorkerBackedLibraryScan';
import type { LibraryScanWorkerRequest } from './LibraryScanWorkerProtocol';

class ControlledWorker extends EventEmitter {
  requests: LibraryScanWorkerRequest[] = [];
  terminate = vi.fn(() => 0);
  postMessage(request: LibraryScanWorkerRequest): void { this.requests.push(request); }
  complete(index = 0): void {
    this.emit('message', { requestId: this.requests[index].requestId, ok: true, result: 'prepared' });
  }
}

describe('scan worker idle lifecycle', () => {
  const pools: ReturnType<typeof createWorkerBackedLibraryScanWorkers>[] = [];
  afterEach(() => { for (const pool of pools.splice(0)) pool.close(); vi.useRealTimers(); });
  function setup(idleTimeoutMs = 100) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const workers: ControlledWorker[] = [];
    const pool = createWorkerBackedLibraryScanWorkers({ workerCount: 1, idleTimeoutMs,
      workerFactory: () => { const worker = new ControlledWorker(); workers.push(worker); return worker; } });
    pools.push(pool);
    return { pool, workers };
  }
  it('keeps active and queued work alive, then releases and recreates workers', async () => {
    const { pool, workers } = setup();
    const first = pool.searchTermsBuilder.prepare({ title: 'first' });
    const second = pool.searchTermsBuilder.prepare({ title: 'second' });
    vi.advanceTimersByTime(200);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    workers[0].complete(); await expect(first).resolves.toBe('prepared');
    vi.advanceTimersByTime(200);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    workers[0].complete(1); await expect(second).resolves.toBe('prepared');
    vi.advanceTimersByTime(100);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const third = pool.searchTermsBuilder.prepare({ title: 'third' });
    expect(workers).toHaveLength(2);
    workers[0].emit('exit', 1); workers[0].complete(1);
    expect(workers).toHaveLength(2);
    workers[1].complete(); await expect(third).resolves.toBe('prepared');
  });
  it('cancels scheduled retirement when another task arrives', async () => {
    const { pool, workers } = setup();
    const first = pool.searchTermsBuilder.prepare({ title: 'first' });
    workers[0].complete(); await first;
    vi.advanceTimersByTime(90);
    const second = pool.searchTermsBuilder.prepare({ title: 'second' });
    vi.advanceTimersByTime(100);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    workers[0].complete(1); await second;
    vi.advanceTimersByTime(100);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('cancels the idle timer on close and supports disabling idle retirement', async () => {
    const { pool, workers } = setup();
    const task = pool.searchTermsBuilder.prepare({ title: 'first' });
    workers[0].complete(); await task; pool.close();
    vi.advanceTimersByTime(200);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const disabled = setup(0);
    const other = disabled.pool.searchTermsBuilder.prepare({ title: 'first' });
    disabled.workers[0].complete(); await other;
    vi.advanceTimersByTime(1000);
    expect(disabled.workers[0].terminate).not.toHaveBeenCalled();
  });
});
