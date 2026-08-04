import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkerBackedLibraryScanWorkers } from './WorkerBackedLibraryScan';
import type { LibraryScanWorkerRequest, LibraryScanWorkerResponse } from './LibraryScanWorkerProtocol';
import type { FileIdentityObservation } from '../FileIdentityService';
import type { CoverResult, MetadataResult } from '../libraryTypes';

const metadataResult = (): MetadataResult => ({
  fields: {
    title: 'Worker Title',
    artist: 'Worker Artist',
    album: 'Worker Album',
    albumArtist: 'Worker Artist',
    trackNo: 1,
    discNo: null,
    year: null,
    genre: null,
    duration: 120,
    codec: 'FLAC',
    sampleRate: 44100,
    bitDepth: 16,
    bitrate: 900000,
  },
  fieldSources: {
    title: 'embedded',
    artist: 'embedded',
    album: 'embedded',
    albumArtist: 'embedded',
    trackNo: 'embedded',
    discNo: 'unknown',
    year: 'unknown',
    genre: 'unknown',
    duration: 'technical',
    codec: 'technical',
    sampleRate: 'technical',
    bitDepth: 'technical',
    bitrate: 'technical',
    bpm: 'unknown',
  },
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  warnings: [],
  errors: [],
  status: 'ok',
});

const coverResult = (): CoverResult => ({
  source: 'embedded',
  thumbPath: 'D:\\Cache\\thumb.webp',
  albumPath: 'D:\\Cache\\album.webp',
  largePath: 'D:\\Cache\\large.webp',
  originalRef: 'D:\\Cache\\original.jpg',
  sourceHash: 'worker-cover-hash',
  mimeType: 'image/jpeg',
  warnings: [],
  errors: [],
});

const identityResult = (): FileIdentityObservation => ({
  fileIdentity: null,
  fileIdentitySource: 'unsupported',
  quickHash: 'f'.repeat(64),
  quickHashVersion: 1,
  identityStatus: 'partial',
  identityUpdatedAt: '2026-06-04T00:00:00.000Z',
  identityError: 'native file identity unsupported on this platform',
});

const writeTinyWav = (filePath: string): void => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(44100, 24);
  header.writeUInt32LE(88200, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(0, 40);
  writeFileSync(filePath, header);
};

class FakeWorker extends EventEmitter {
  readonly requests: LibraryScanWorkerRequest[] = [];
  terminated = false;

  constructor(
    private readonly respond: (request: LibraryScanWorkerRequest) => LibraryScanWorkerResponse,
    private readonly options: { throwOnPost?: boolean } = {},
  ) {
    super();
  }

  postMessage(message: LibraryScanWorkerRequest): void {
    if (this.options.throwOnPost) {
      throw new Error('postMessage failed');
    }
    this.requests.push(message);
    setImmediate(() => {
      this.emit('message', this.respond(message));
    });
  }

  terminate(): number {
    this.terminated = true;
    return 0;
  }
}

describe('WorkerBackedLibraryScan', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads metadata through the scan worker pool', async () => {
    const workers: FakeWorker[] = [];
    const scanWorkers = createWorkerBackedLibraryScanWorkers({
      workerCount: 1,
      workerFactory: () => {
        const worker = new FakeWorker((request) => ({
          requestId: request.requestId,
          ok: true,
          result: metadataResult(),
        }));
        workers.push(worker);
        return worker;
      },
    });

    try {
      const result = await scanWorkers.metadataReader.read('D:\\Music\\Worker.flac');

      expect(result.fields.title).toBe('Worker Title');
      expect(workers[0]?.requests).toEqual([
        expect.objectContaining({
          type: 'metadata:read',
          filePath: 'D:\\Music\\Worker.flac',
        }),
      ]);
    } finally {
      scanWorkers.close();
    }
  });

  it('falls back to the TypeScript metadata reader when a worker task fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scanWorkers = createWorkerBackedLibraryScanWorkers({
      workerCount: 1,
      workerFactory: () =>
        new FakeWorker((request) => ({
          requestId: request.requestId,
          ok: false,
          message: 'worker unavailable',
        })),
    });

    try {
      const missingPath = join(tmpdir(), 'Worker Fallback.mp3');
      const result = await scanWorkers.metadataReader.read(missingPath);

      expect(result.status).toBe('error');
      expect(result.fields.title).toBe('Worker Fallback');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('metadata:read worker failed; falling back'));
    } finally {
      scanWorkers.close();
    }
  });

  it('falls back consistently when scan workers cannot start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scanWorkers = createWorkerBackedLibraryScanWorkers({
      workerCount: 1,
      workerFactory: () => {
        throw new Error('worker bundle missing');
      },
    });

    try {
      const first = await scanWorkers.metadataReader.read(join(tmpdir(), 'Worker Startup One.mp3'));
      const second = await scanWorkers.metadataReader.read(join(tmpdir(), 'Worker Startup Two.mp3'));

      expect(first.status).toBe('error');
      expect(second.status).toBe('error');
      expect(first.fields.title).toBe('Worker Startup One');
      expect(second.fields.title).toBe('Worker Startup Two');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('metadata:read worker failed; falling back'));
    } finally {
      scanWorkers.close();
    }
  });

  it('retries metadata on the main thread when a worker returns an error result', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = mkdtempSync(join(tmpdir(), 'echo-worker-metadata-error-'));
    const filePath = join(root, 'Main Reader Success.wav');
    writeTinyWav(filePath);
    const scanWorkers = createWorkerBackedLibraryScanWorkers({
      workerCount: 1,
      workerFactory: () =>
        new FakeWorker((request) => ({
          requestId: request.requestId,
          ok: true,
          result: {
            ...metadataResult(),
            status: 'error',
            errors: ['worker metadata parse failed'],
          },
        })),
    });

    try {
      const result = await scanWorkers.metadataReader.read(filePath);

      expect(result.status).not.toBe('error');
      expect(result.fields.title).toBe('Main Reader Success');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('metadata:read:error-result worker failed; falling back'));
    } finally {
      scanWorkers.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back when posting a task to a worker fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const workers: FakeWorker[] = [];
    const scanWorkers = createWorkerBackedLibraryScanWorkers({
      workerCount: 1,
      workerFactory: () => {
        const worker = new FakeWorker(
          (request) => ({
            requestId: request.requestId,
            ok: true,
            result: metadataResult(),
          }),
          { throwOnPost: true },
        );
        workers.push(worker);
        return worker;
      },
    });

    try {
      const result = await scanWorkers.metadataReader.read(join(tmpdir(), 'Worker Post Failure.mp3'));

      expect(result.status).toBe('error');
      expect(result.fields.title).toBe('Worker Post Failure');
      expect(workers[0]?.terminated).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('metadata:read worker failed; falling back'));
    } finally {
      scanWorkers.close();
    }
  });

  it('extracts covers through the scan worker pool', async () => {
    const workers: FakeWorker[] = [];
    const scanWorkers = createWorkerBackedLibraryScanWorkers({
      workerCount: 1,
      workerFactory: () => {
        const worker = new FakeWorker((request) => ({
          requestId: request.requestId,
          ok: true,
          result: coverResult(),
        }));
        workers.push(worker);
        return worker;
      },
    });

    try {
      const result = await scanWorkers.coverExtractor.extract('D:\\Music\\Worker.flac', {
        cacheRoot: 'D:\\Cache',
        metadata: metadataResult(),
      });

      expect(result.sourceHash).toBe('worker-cover-hash');
      expect(workers[0]?.requests).toEqual([
        expect.objectContaining({
          type: 'cover:extract',
          filePath: 'D:\\Music\\Worker.flac',
          options: expect.objectContaining({ cacheRoot: 'D:\\Cache' }),
        }),
      ]);
    } finally {
      scanWorkers.close();
    }
  });

  it('observes file identity through the scan worker pool', async () => {
    const workers: FakeWorker[] = [];
    const scanWorkers = createWorkerBackedLibraryScanWorkers({
      workerCount: 1,
      workerFactory: () => {
        const worker = new FakeWorker((request) => ({
          requestId: request.requestId,
          ok: true,
          result: identityResult(),
        }));
        workers.push(worker);
        return worker;
      },
    });

    try {
      const result = await scanWorkers.fileIdentityService.observe('D:\\Music\\Worker.flac');

      expect(result.quickHash).toBe('f'.repeat(64));
      expect(workers[0]?.requests).toEqual([
        expect.objectContaining({
          type: 'identity:observe',
          filePath: 'D:\\Music\\Worker.flac',
        }),
      ]);
    } finally {
      scanWorkers.close();
    }
  });

  it('falls back to the TypeScript file identity service when a worker identity task fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scanWorkers = createWorkerBackedLibraryScanWorkers({
      workerCount: 1,
      workerFactory: () =>
        new FakeWorker((request) => ({
          requestId: request.requestId,
          ok: false,
          message: 'identity worker unavailable',
        })),
    });

    try {
      const result = await scanWorkers.fileIdentityService.observe(join(tmpdir(), 'missing-worker-identity.mp3'));

      expect(result.identityStatus).toBe('error');
      expect(result.quickHash).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('identity:observe worker failed; falling back'));
    } finally {
      scanWorkers.close();
    }
  });
});
