import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryReadRequest } from './LibraryReadWorker';

const workers = vi.hoisted(() => [] as FakeWorker[]);
type FakeWorker = EventEmitter & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> };
vi.mock('node:worker_threads', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return { Worker: class extends Emitter {
    postMessage = vi.fn<(request: LibraryReadRequest) => void>();
    terminate = vi.fn(() => Promise.resolve(0));
    unref = vi.fn();
    constructor() { super(); workers.push(this); }
  } };
});
import { LibraryReadWorker } from './LibraryReadWorker';

const readers: LibraryReadWorker[] = [];
const makeReader = () => { const reader = new LibraryReadWorker('library.sqlite'); readers.push(reader); return reader; };
const page = { items: [], page: 1, pageSize: 50, total: 0, hasMore: false };
afterEach(async () => {
  await Promise.all(readers.splice(0).map((reader) => reader.close()));
  workers.length = 0;
  vi.useRealTimers();
});

describe('LibraryReadWorker', () => {
  it('coalesces concurrent identical reads, serializes pages and does not cache later reads', async () => {
    const reader = makeReader();
    const first = reader.read('tracks', { page: 1, search: 'song' }, {});
    expect(reader.read('tracks', { search: 'song', page: 1 }, {})).toBe(first);
    const albums = reader.read('albums', undefined, {});
    const worker = workers[0];
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.emit('message', { id: 1, ok: true, page });
    await expect(first).resolves.toEqual(page);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    worker.emit('message', { id: 2, ok: true, page });
    await albums;
    const fresh = reader.read('tracks', { page: 1, search: 'song' }, {});
    expect(worker.postMessage).toHaveBeenCalledTimes(3);
    worker.emit('message', { id: 3, ok: true, page });
    await fresh;
  });

  it('rejects pending reads and waits for worker termination before maintenance can continue', async () => {
    const reader = makeReader();
    const active = reader.read('tracks', undefined, {}).catch((error: Error) => error.message);
    const queued = reader.read('albums', undefined, {}).catch((error: Error) => error.message);
    let finish!: (code: number) => void;
    workers[0].terminate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let closed = false;
    const closing = reader.close().then(() => { closed = true; });
    expect(await active).toContain('closed');
    expect(await queued).toContain('closed');
    expect(closed).toBe(false);
    finish(0);
    await closing;
    await expect(reader.read('tracks', undefined, {})).rejects.toThrow('closed');
  });

  it('rejects worker failures without falling back to synchronous SQLite', async () => {
    const reader = makeReader();
    const failed = reader.read('tracks', undefined, {});
    workers[0].emit('error', new Error('worker unavailable'));
    await expect(failed).rejects.toThrow('worker unavailable');
    const retry = reader.read('tracks', undefined, {});
    expect(workers).toHaveLength(2);
    workers[1].emit('message', { id: 2, ok: true, page });
    await expect(retry).resolves.toEqual(page);
  });

  it('times out a stuck worker and rejects its queued requests', async () => {
    vi.useFakeTimers();
    const reader = makeReader();
    const active = reader.read('tracks', undefined, {}).catch((error: Error) => error.message);
    const queued = reader.read('albums', undefined, {}).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await active).toContain('timed out');
    expect(await queued).toContain('timed out');
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });
});
