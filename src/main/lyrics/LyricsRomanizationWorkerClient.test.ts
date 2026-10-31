import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LyricsRomanizationWorkerClient,
  type LyricsRomanizationWorkerFactory,
  type LyricsRomanizationWorkerLike,
} from './LyricsRomanizationWorkerClient';
import type {
  LyricsRomanizationWorkerRequest,
  LyricsRomanizationWorkerResponse,
} from './LyricsRomanizationWorkerProtocol';

type WorkerEvent = 'message' | 'error' | 'exit';

class FakeWorker {
  readonly posted: LyricsRomanizationWorkerRequest[] = [];
  readonly listeners: Record<WorkerEvent, Array<(value: unknown) => void>> = {
    message: [],
    error: [],
    exit: [],
  };
  terminateCalls = 0;
  unrefCalls = 0;

  postMessage(message: LyricsRomanizationWorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): Promise<number> {
    this.terminateCalls += 1;
    return Promise.resolve(0);
  }

  unref(): void {
    this.unrefCalls += 1;
  }

  on(event: WorkerEvent, listener: (value: never) => void): this {
    this.listeners[event].push(listener as (value: unknown) => void);
    return this;
  }

  emit(event: WorkerEvent, value: unknown): void {
    for (const listener of this.listeners[event]) {
      listener(value);
    }
  }

  respond(response: LyricsRomanizationWorkerResponse): void {
    this.emit('message', response);
  }
}

const clients: LyricsRomanizationWorkerClient[] = [];

const harness = (options: { requestTimeoutMs?: number; idleTimeoutMs?: number } = {}) => {
  const workers: FakeWorker[] = [];
  const warn = vi.fn();
  const workerFactory: LyricsRomanizationWorkerFactory = () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as LyricsRomanizationWorkerLike;
  };
  const client = new LyricsRomanizationWorkerClient({
    workerFactory,
    requestTimeoutMs: options.requestTimeoutMs ?? 100,
    idleTimeoutMs: options.idleTimeoutMs ?? 50,
    warn,
  });
  clients.push(client);
  return { client, workers, warn };
};

const ok = (request: LyricsRomanizationWorkerRequest, romanization = 'kimi ga suki') => ({
  requestId: request.requestId,
  ok: true as const,
  results: request.texts.map((text) => ({ text, romanization })),
});

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.dispose();
  }
  vi.useRealTimers();
});

describe('LyricsRomanizationWorkerClient', () => {
  it('starts lazily and matches a response to its request id', async () => {
    const { client, workers } = harness();
    expect(workers).toHaveLength(0);

    const result = client.romanize(['君が好き']);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.unrefCalls).toBe(1);
    workers[0]!.respond(ok(workers[0]!.posted[0]!));

    await expect(result).resolves.toEqual([{ text: '君が好き', romanization: 'kimi ga suki' }]);
    expect(client.getDiagnostics()).toMatchObject({
      activeRequestId: null,
      pendingCount: 0,
      queuedCount: 0,
      idleTimerActive: true,
    });
  });

  it('serializes concurrent requests and never crosses their responses', async () => {
    const { client, workers } = harness();
    const first = client.romanize(['一']);
    const second = client.romanize(['二']);
    const worker = workers[0]!;
    expect(worker.posted).toHaveLength(1);

    worker.respond({ requestId: 999, ok: true, results: [] });
    expect(worker.posted).toHaveLength(1);
    worker.respond(ok(worker.posted[0]!, 'ichi'));
    await expect(first).resolves.toEqual([{ text: '一', romanization: 'ichi' }]);
    expect(worker.posted).toHaveLength(2);

    worker.respond(ok(worker.posted[1]!, 'ni'));
    await expect(second).resolves.toEqual([{ text: '二', romanization: 'ni' }]);
  });

  it('rejects a construction failure but lets the next request rebuild', async () => {
    const workers: FakeWorker[] = [];
    let attempts = 0;
    const workerFactory: LyricsRomanizationWorkerFactory = () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('construction failed');
      }
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as LyricsRomanizationWorkerLike;
    };
    const client = new LyricsRomanizationWorkerClient({ workerFactory, warn: vi.fn() });
    clients.push(client);

    await expect(client.romanize(['一'])).rejects.toThrow('construction failed');
    const second = client.romanize(['二']);
    workers[0]!.respond(ok(workers[0]!.posted[0]!, 'ni'));
    await expect(second).resolves.toEqual([{ text: '二', romanization: 'ni' }]);
  });

  it.each([
    ['error event', (worker: FakeWorker) => worker.emit('error', new Error('worker error'))],
    ['non-zero exit', (worker: FakeWorker) => worker.emit('exit', 2)],
  ])('settles pending work on %s and rebuilds on the next call', async (_name, fail) => {
    const { client, workers, warn } = harness();
    const first = client.romanize(['一']);
    fail(workers[0]!);
    await expect(first).rejects.toThrow();
    expect(workers[0]?.terminateCalls).toBe(1);

    const second = client.romanize(['二']);
    expect(workers).toHaveLength(2);
    workers[1]!.respond(ok(workers[1]!.posted[0]!, 'ni'));
    await expect(second).resolves.toEqual([{ text: '二', romanization: 'ni' }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retires a worker that returns a protocol-invalid response', async () => {
    const { client, workers } = harness();
    const result = client.romanize(['一']);
    const requestId = workers[0]!.posted[0]!.requestId;

    workers[0]!.emit('message', {
      requestId,
      ok: true,
      results: [{ text: 1, romanization: undefined }],
    });

    await expect(result).rejects.toThrow('invalid response');
    expect(workers[0]?.terminateCalls).toBe(1);
    expect(client.getDiagnostics().pendingCount).toBe(0);
  });

  it('settles an error response, retires that worker, and continues queued work', async () => {
    const { client, workers } = harness();
    const first = client.romanize(['一']);
    const second = client.romanize(['二']);
    const requestId = workers[0]!.posted[0]!.requestId;

    workers[0]!.respond({ requestId, ok: false, message: 'dynamic import failed' });
    await expect(first).rejects.toThrow('dynamic import failed');
    expect(workers[0]?.terminateCalls).toBe(1);
    expect(workers).toHaveLength(2);

    workers[1]!.respond(ok(workers[1]!.posted[0]!, 'ni'));
    await expect(second).resolves.toEqual([{ text: '二', romanization: 'ni' }]);
  });

  it('times out only the active request and processes queued work on a new generation', async () => {
    vi.useFakeTimers();
    const { client, workers } = harness({ requestTimeoutMs: 100 });
    const first = client.romanize(['一']);
    const second = client.romanize(['二']);
    const firstRejected = expect(first).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(100);
    await firstRejected;
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminateCalls).toBe(1);

    const secondRequest = workers[1]!.posted[0]!;
    workers[0]!.respond(ok(secondRequest, 'stale'));
    expect(client.getDiagnostics().activeRequestId).toBe(secondRequest.requestId);
    workers[1]!.respond(ok(secondRequest, 'ni'));
    await expect(second).resolves.toEqual([{ text: '二', romanization: 'ni' }]);
    expect(client.getDiagnostics().generation).toBe(2);
  });

  it('cancels and restarts the idle timer, retires when idle, and rebuilds later', async () => {
    vi.useFakeTimers();
    const { client, workers } = harness({ idleTimeoutMs: 50 });
    const first = client.romanize(['一']);
    workers[0]!.respond(ok(workers[0]!.posted[0]!, 'ichi'));
    await first;

    await vi.advanceTimersByTimeAsync(40);
    const second = client.romanize(['二']);
    expect(client.getDiagnostics().idleTimerActive).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(workers[0]?.terminateCalls).toBe(0);
    workers[0]!.respond(ok(workers[0]!.posted[1]!, 'ni'));
    await second;

    await vi.advanceTimersByTimeAsync(50);
    expect(workers[0]?.terminateCalls).toBe(1);
    expect(client.getDiagnostics().workerActive).toBe(false);

    const third = client.romanize(['三']);
    expect(workers).toHaveLength(2);
    workers[1]!.respond(ok(workers[1]!.posted[0]!, 'san'));
    await expect(third).resolves.toEqual([{ text: '三', romanization: 'san' }]);
  });

  it('releases an idle worker immediately without touching in-flight romanization', async () => {
    const { client, workers } = harness();
    const first = client.romanize(['一']);
    expect(client.releaseIdle('soft-memory-pressure')).toBe(false);
    workers[0]!.respond(ok(workers[0]!.posted[0]!, 'ichi'));
    await first;

    expect(client.releaseIdle('soft-memory-pressure')).toBe(true);
    expect(workers[0]?.terminateCalls).toBe(1);
    expect(client.getDiagnostics()).toMatchObject({
      workerActive: false,
      idleTimerActive: false,
    });
    expect(client.releaseIdle('soft-memory-pressure')).toBe(false);
  });

  it('clears every timer, queued request, and pending promise on dispose', async () => {
    const { client, workers } = harness();
    const first = client.romanize(['一']);
    const second = client.romanize(['二']);
    client.dispose();

    await expect(first).rejects.toThrow('closed');
    await expect(second).rejects.toThrow('closed');
    expect(workers[0]?.terminateCalls).toBe(1);
    expect(client.getDiagnostics()).toMatchObject({
      workerActive: false,
      activeRequestId: null,
      pendingCount: 0,
      queuedCount: 0,
      idleTimerActive: false,
    });
  });
});
