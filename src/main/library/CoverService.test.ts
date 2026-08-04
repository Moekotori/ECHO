import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerOptions } from 'node:worker_threads';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { EchoDatabase } from '../database/createDatabase';
import { CoverService } from './CoverService';
import type { CoverServiceOptions } from './CoverService';
import type { CoverResult, ParsedTrackMetadata } from './libraryTypes';

const tempRoots: string[] = [];
const coverServices: CoverService[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-cover-service-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const makeCover = (): Promise<Buffer> =>
  sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: '#d45588',
    },
  }).jpeg().toBuffer();

const metadataWithCover = async (): Promise<ParsedTrackMetadata> => ({
  title: 'Remote Song',
  artist: 'Remote Artist',
  album: 'Remote Album',
  albumArtist: 'Remote Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 120,
  codec: 'mp3',
  sampleRate: 44100,
  bitDepth: null,
  bitrate: 320000,
  fieldSources: { cover: 'network' },
  embeddedCover: {
    data: await makeCover(),
    mimeType: 'image/jpeg',
  },
  warnings: [],
  errors: [],
  metadataStatus: 'ok',
});

const metadataWithFakeCover = (index: number, warnings: string[] = []): ParsedTrackMetadata => ({
  title: `Remote Song ${index}`,
  artist: 'Remote Artist',
  album: `Remote Album ${index}`,
  albumArtist: 'Remote Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 120,
  codec: 'mp3',
  sampleRate: 44100,
  bitDepth: null,
  bitrate: 320000,
  fieldSources: { cover: 'network' },
  embeddedCover: {
    data: Buffer.from(`fake-cover-${index}`),
    mimeType: 'image/jpeg',
  },
  warnings,
  errors: [],
  metadataStatus: 'ok',
});

type CoverStoreRow = {
  thumb_path: string;
  album_path: string;
  large_path: string;
  source_type: string;
};

const createCoverDatabase = () => {
  const coversByHash = new Map<string, { id: string; source_type: string }>();
  const coversById = new Map<string, CoverStoreRow>();

  const database = {
    prepare: (sql: string) => {
      if (sql.includes('SELECT id, source_type FROM covers WHERE source_hash = ?')) {
        return {
          get: (sourceHash: string) => coversByHash.get(sourceHash),
        };
      }
      if (sql.includes('INSERT INTO covers')) {
        return {
          run: (
            id: string,
            sourceType: string,
            sourceHash: string,
            _mimeType: string,
            thumbPath: string,
            albumPath: string,
            largePath: string,
          ) => {
            coversByHash.set(sourceHash, { id, source_type: sourceType });
            coversById.set(id, { thumb_path: thumbPath, album_path: albumPath, large_path: largePath, source_type: sourceType });
          },
        };
      }
      if (sql.includes('UPDATE covers SET')) {
        return {
          run: (
            sourceType: string,
            _mimeType: string,
            thumbPath: string,
            albumPath: string,
            largePath: string,
            _originalRef: string,
            _cacheVersion: number,
            _warningsJson: string,
            _errorsJson: string,
            _coverThumb: string,
            _coverLarge: string,
            _coverOriginal: string,
            _updatedAt: string,
            id: string,
          ) => {
            coversById.set(id, { thumb_path: thumbPath, album_path: albumPath, large_path: largePath, source_type: sourceType });
            for (const row of coversByHash.values()) {
              if (row.id === id) {
                row.source_type = sourceType;
              }
            }
          },
        };
      }
      if (sql.includes('SELECT thumb_path, album_path, large_path, source_type FROM covers WHERE id = ?')) {
        return {
          get: (id: string) => coversById.get(id),
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as EchoDatabase;

  return {
    database,
    getInsertCount: () => coversById.size,
  };
};

const createCoverService = (
  database: EchoDatabase,
  cacheRoot: string,
  options?: CoverServiceOptions,
): CoverService => {
  const service = new CoverService(database, cacheRoot, options);
  coverServices.push(service);
  return service;
};

type SimulatedWorkerStats = {
  createdWorkers: number;
  terminatedWorkers: number;
  activeTasks: number;
  maxActiveTasks: number;
};

type SimulatedWorkerBehavior = {
  delayMs?: number;
};

class SimulatedRemoteCoverWorker extends EventEmitter {
  private terminated = false;
  private exited = false;
  private active = false;

  constructor(
    private readonly stats: SimulatedWorkerStats,
    private readonly behavior: SimulatedWorkerBehavior,
  ) {
    super();
    this.stats.createdWorkers += 1;
  }

  postMessage(message: unknown): void {
    if (this.terminated) {
      return;
    }

    const task = message as {
      requestId: number;
      mimeType: string | null;
      warnings?: string[];
      errors?: string[];
    };
    const warnings = task.warnings ?? [];
    this.active = true;
    this.stats.activeTasks += 1;
    this.stats.maxActiveTasks = Math.max(this.stats.maxActiveTasks, this.stats.activeTasks);

    if (warnings.includes('hang')) {
      return;
    }

    setTimeout(() => {
      if (this.terminated) {
        return;
      }

      this.finishActiveTask();
      if (warnings.includes('crash')) {
        this.terminated = true;
        this.emit('error', new Error('simulated worker crash'));
        this.emitExit(1);
        return;
      }

      if (warnings.includes('fail')) {
        this.emit('message', {
          requestId: task.requestId,
          ok: false,
          message: 'simulated remote cover failure',
        });
        return;
      }

      const sourceHash = `simulated-hash-${task.requestId}`;
      this.emit('message', {
        requestId: task.requestId,
        ok: true,
        result: {
          source: 'embedded',
          thumbPath: `simulated/${sourceHash}/thumb.webp`,
          albumPath: `simulated/${sourceHash}/album.webp`,
          largePath: `simulated/${sourceHash}/large.webp`,
          originalRef: `simulated/${sourceHash}/original.jpg`,
          sourceHash,
          mimeType: task.mimeType,
          warnings,
          errors: task.errors ?? [],
        } satisfies CoverResult,
      });
    }, this.behavior.delayMs ?? 1);
  }

  terminate(): Promise<number> {
    if (!this.terminated) {
      this.terminated = true;
      this.stats.terminatedWorkers += 1;
      this.finishActiveTask();
      this.emitExit(0);
    }
    return Promise.resolve(0);
  }

  private finishActiveTask(): void {
    if (!this.active) {
      return;
    }

    this.active = false;
    this.stats.activeTasks -= 1;
  }

  private emitExit(code: number): void {
    if (this.exited) {
      return;
    }

    this.exited = true;
    this.emit('exit', code);
  }
}

const createSimulatedWorkerFactory =
  (stats: SimulatedWorkerStats, behavior: SimulatedWorkerBehavior = {}) =>
  (_source: string, _options: WorkerOptions): SimulatedRemoteCoverWorker =>
    new SimulatedRemoteCoverWorker(stats, behavior);

const createWorkerStats = (): SimulatedWorkerStats => ({
  createdWorkers: 0,
  terminatedWorkers: 0,
  activeTasks: 0,
  maxActiveTasks: 0,
});

afterEach(() => {
  for (const service of coverServices.splice(0)) {
    service.close();
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('CoverService', () => {
  it('generates remote cover cache variants through the worker path', async () => {
    const root = makeTempRoot();
    const { database } = createCoverDatabase();
    const service = createCoverService(database, join(root, 'covers'));

    const coverId = await service.ensureCover('remote://source-1/subsonic:song:1', await metadataWithCover());

    expect(coverId).toEqual(expect.any(String));
    const row = database
      .prepare<[string], { thumb_path: string; album_path: string; large_path: string; source_type: string }>(
        'SELECT thumb_path, album_path, large_path, source_type FROM covers WHERE id = ?',
      )
      .get(coverId ?? '');
    expect(row?.source_type).toBe('embedded');
    expect(existsSync(row?.thumb_path ?? '')).toBe(true);
    expect(existsSync(row?.album_path ?? '')).toBe(true);
    expect(existsSync(row?.large_path ?? '')).toBe(true);
  });

  it('reuses a fixed-size worker pool for a 120-cover remote burst', async () => {
    const root = makeTempRoot();
    const stats = createWorkerStats();
    const { database, getInsertCount } = createCoverDatabase();
    const service = createCoverService(database, join(root, 'covers'), {
      remoteCoverPoolSize: 4,
      remoteCoverTaskTimeoutMs: 1_000,
      remoteCoverWorkerFactory: createSimulatedWorkerFactory(stats),
    });

    const coverIds = await Promise.all(
      Array.from({ length: 120 }, (_item, index) =>
        service.ensureCover(`remote://source-1/album-${index}.mp3`, metadataWithFakeCover(index)),
      ),
    );

    expect(new Set(coverIds).size).toBe(120);
    expect(getInsertCount()).toBe(120);
    expect(stats.createdWorkers).toBe(4);
    expect(stats.maxActiveTasks).toBe(4);
  });

  it('keeps queued remote covers moving when one task fails', async () => {
    const root = makeTempRoot();
    const stats = createWorkerStats();
    const { database, getInsertCount } = createCoverDatabase();
    const service = createCoverService(database, join(root, 'covers'), {
      remoteCoverPoolSize: 3,
      remoteCoverTaskTimeoutMs: 1_000,
      remoteCoverWorkerFactory: createSimulatedWorkerFactory(stats),
    });

    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_item, index) =>
        service.ensureCover(`remote://source-1/failure-${index}.mp3`, metadataWithFakeCover(index, index === 9 ? ['fail'] : [])),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(29);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(getInsertCount()).toBe(29);
    expect(stats.createdWorkers).toBe(3);
    expect(stats.maxActiveTasks).toBe(3);
  });

  it('replaces a crashed worker without making the whole pool unavailable', async () => {
    const root = makeTempRoot();
    const stats = createWorkerStats();
    const { database, getInsertCount } = createCoverDatabase();
    const service = createCoverService(database, join(root, 'covers'), {
      remoteCoverPoolSize: 3,
      remoteCoverTaskTimeoutMs: 1_000,
      remoteCoverWorkerFactory: createSimulatedWorkerFactory(stats),
    });

    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_item, index) =>
        service.ensureCover(`remote://source-1/crash-${index}.mp3`, metadataWithFakeCover(index, index === 4 ? ['crash'] : [])),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(29);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(getInsertCount()).toBe(29);
    expect(stats.createdWorkers).toBeGreaterThan(3);
    expect(stats.maxActiveTasks).toBe(3);
  });

  it('times out one stuck worker task and continues queued work on a replacement', async () => {
    const root = makeTempRoot();
    const stats = createWorkerStats();
    const { database, getInsertCount } = createCoverDatabase();
    const service = createCoverService(database, join(root, 'covers'), {
      remoteCoverPoolSize: 2,
      remoteCoverTaskTimeoutMs: 20,
      remoteCoverWorkerFactory: createSimulatedWorkerFactory(stats),
    });

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_item, index) =>
        service.ensureCover(`remote://source-1/timeout-${index}.mp3`, metadataWithFakeCover(index, index === 1 ? ['hang'] : [])),
      ),
    );

    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(11);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toEqual(expect.objectContaining({ message: expect.stringContaining('timed out') }));
    expect(getInsertCount()).toBe(11);
    expect(stats.createdWorkers).toBeGreaterThan(2);
    expect(stats.maxActiveTasks).toBe(2);
  });

  it('rejects queued work and terminates pool workers when closed', async () => {
    const root = makeTempRoot();
    const stats = createWorkerStats();
    const { database } = createCoverDatabase();
    const service = createCoverService(database, join(root, 'covers'), {
      remoteCoverPoolSize: 2,
      remoteCoverTaskTimeoutMs: 1_000,
      remoteCoverWorkerFactory: createSimulatedWorkerFactory(stats, { delayMs: 100 }),
    });

    const pending = Array.from({ length: 10 }, (_item, index) =>
      service.ensureCover(`remote://source-1/close-${index}.mp3`, metadataWithFakeCover(index)),
    );
    service.close();

    const results = await Promise.allSettled(pending);

    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(10);
    expect(stats.createdWorkers).toBe(2);
    expect(stats.terminatedWorkers).toBe(2);
    expect(stats.activeTasks).toBe(0);
  });
});
