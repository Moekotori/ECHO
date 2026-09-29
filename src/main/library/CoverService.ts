import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';
import type { EchoDatabase } from '../database/createDatabase';
import { COVER_CACHE_VERSION } from './libraryTypes';
import type { CoverResult, CoverSource, ParsedTrackMetadata } from './libraryTypes';
import { TsCoverExtractor } from './workers/TsCoverExtractor';

const coverSourceRank: Record<CoverSource, number> = {
  default: 0,
  network: 1,
  folder: 2,
  embedded: 3,
  manual: 4,
};

const coverSourceOrNull = (value: unknown): CoverSource | null =>
  value === 'manual' || value === 'embedded' || value === 'folder' || value === 'network' || value === 'default' ? value : null;

const preferredCoverSource = (current: unknown, next: CoverSource): CoverSource => {
  const currentSource = coverSourceOrNull(current);
  return currentSource && coverSourceRank[currentSource] > coverSourceRank[next] ? currentSource : next;
};

const remoteCoverWorkerSource = String.raw`
const { createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const sharp = require('sharp');

const hashBytes = (data) => createHash('sha256').update(data).digest('hex');
const extensionForMimeType = (mimeType) => {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '.bin';
  }
};

const readMeta = async (filePath) => {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const writeIfMissing = async (filePath, data) => {
  if (!existsSync(filePath)) {
    await writeFile(filePath, data);
  }
};

const processTask = async (task) => {
  const data = Buffer.from(task.data);
  const sourceHash = hashBytes(data);
  const coverDirectory = join(task.cacheRoot, sourceHash.slice(0, 2), sourceHash);
  const thumbPath = join(coverDirectory, 'thumb.webp');
  const albumPath = join(coverDirectory, 'album.webp');
  const largePath = join(coverDirectory, 'large.webp');
  const originalRef = join(coverDirectory, 'original' + extensionForMimeType(task.mimeType));
  const metaPath = join(coverDirectory, 'meta.json');

  sharp.concurrency(Math.max(1, Math.min(2, workerData.sharpConcurrency || 1)));
  await mkdir(coverDirectory, { recursive: true });
  await writeIfMissing(originalRef, data);

  const meta = await readMeta(metaPath);
  const current = Boolean(meta && meta.version === task.cacheVersion && meta.sourceHash === sourceHash);
  const missingThumb = !current || !existsSync(thumbPath);
  const missingAlbum = !current || !existsSync(albumPath);
  const missingLarge = !current || !existsSync(largePath);

  if (missingThumb) {
    await sharp(data).rotate().resize(96, 96, { fit: 'cover', position: 'centre' }).webp({ quality: 75, effort: 4 }).toFile(thumbPath);
  }
  if (missingAlbum) {
    await sharp(data).rotate().resize(320, 320, { fit: 'cover', position: 'centre' }).webp({ quality: 82, effort: 4 }).toFile(albumPath);
  }
  if (missingLarge) {
    await sharp(data).rotate().resize(768, 768, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toFile(largePath);
  }

  if (!current || !existsSync(metaPath)) {
    await writeFile(metaPath, JSON.stringify({
      version: task.cacheVersion,
      sourceHash,
      source: 'embedded',
      mimeType: task.mimeType,
    }, null, 2) + '\n');
  }

  return {
    source: 'embedded',
    thumbPath,
    albumPath,
    largePath,
    originalRef,
    sourceHash,
    mimeType: task.mimeType,
    warnings: task.warnings || [],
    errors: task.errors || [],
  };
};

parentPort.on('message', (task) => {
  void processTask(task).then((result) => {
    parentPort.postMessage({
      requestId: task.requestId,
      ok: true,
      result,
    });
  }).catch((error) => {
    parentPort.postMessage({
      requestId: task.requestId,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
`;

type RemoteCoverWorkerMessage = {
  requestId?: number;
  ok?: boolean;
  result?: CoverResult;
  message?: string;
};

type RemoteCoverWorkerLike = {
  postMessage(message: unknown): void;
  terminate(): Promise<number> | number;
  on(event: 'message', listener: (message: RemoteCoverWorkerMessage) => void): RemoteCoverWorkerLike;
  on(event: 'error', listener: (error: Error) => void): RemoteCoverWorkerLike;
  on(event: 'exit', listener: (code: number) => void): RemoteCoverWorkerLike;
};

type RemoteCoverWorkerFactory = (source: string, options: WorkerOptions) => RemoteCoverWorkerLike;

type RemoteCoverTaskInput = {
  data: Uint8Array;
  mimeType: string | null;
  warnings: string[];
  errors: string[];
};

type QueuedRemoteCoverTask = RemoteCoverTaskInput & {
  requestId: number;
  resolve: (result: CoverResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
};

type RemoteCoverWorkerSlot = {
  worker: RemoteCoverWorkerLike;
  currentTask: QueuedRemoteCoverTask | null;
  retired: boolean;
};

export type CoverServiceOptions = {
  remoteCoverPoolSize?: number;
  remoteCoverTaskTimeoutMs?: number;
  remoteCoverWorkerFactory?: RemoteCoverWorkerFactory;
};

const defaultRemoteCoverPoolSize = 16;
const defaultRemoteCoverTaskTimeoutMs = 30_000;

const normalizeRemoteCoverPoolSize = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return defaultRemoteCoverPoolSize;
  }
  return Math.max(1, Math.min(32, Math.round(numeric)));
};

class RemoteCoverWorkerPool {
  private readonly poolSize: number;
  private readonly taskTimeoutMs: number;
  private readonly workerFactory: RemoteCoverWorkerFactory;
  private readonly workers: RemoteCoverWorkerSlot[] = [];
  private readonly queue: QueuedRemoteCoverTask[] = [];
  private nextRequestId = 1;
  private closed = false;
  private started = false;

  constructor(
    private readonly cacheRoot: string,
    options: CoverServiceOptions = {},
  ) {
    this.poolSize = normalizeRemoteCoverPoolSize(options.remoteCoverPoolSize);
    this.taskTimeoutMs = Math.max(1, Math.round(options.remoteCoverTaskTimeoutMs ?? defaultRemoteCoverTaskTimeoutMs));
    this.workerFactory =
      options.remoteCoverWorkerFactory ??
      ((source, workerOptions) => new Worker(source, workerOptions) as RemoteCoverWorkerLike);
  }

  run(input: RemoteCoverTaskInput): Promise<CoverResult> {
    if (this.closed) {
      return Promise.reject(new Error('Remote cover worker pool is closed'));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        ...input,
        requestId: this.nextRequestId++,
        resolve,
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
    const closeError = new Error('Remote cover worker pool is closed');
    for (const task of this.queue.splice(0)) {
      task.reject(closeError);
    }

    for (const slot of [...this.workers]) {
      this.retireWorker(slot, closeError);
    }
  }

  private ensureStarted(): void {
    if (this.started || this.closed) {
      return;
    }

    this.started = true;
    while (this.workers.length < this.poolSize) {
      this.createWorker();
    }
  }

  private createWorker(): void {
    if (this.closed) {
      return;
    }

    const slot: RemoteCoverWorkerSlot = {
      worker: this.workerFactory(remoteCoverWorkerSource, {
        eval: true,
        workerData: {
          sharpConcurrency: 1,
        },
      }),
      currentTask: null,
      retired: false,
    };

    slot.worker.on('message', (message) => this.handleMessage(slot, message));
    slot.worker.on('error', (error) => this.handleWorkerFailure(slot, error));
    slot.worker.on('exit', (code) => {
      if (!slot.retired && !this.closed) {
        this.handleWorkerFailure(slot, new Error(`Remote cover worker exited with code ${code}`));
      }
    });

    this.workers.push(slot);
  }

  private pump(): void {
    if (this.closed) {
      return;
    }

    this.ensureStarted();
    for (const slot of this.workers) {
      if (!slot.currentTask && this.queue.length > 0) {
        this.dispatch(slot, this.queue.shift()!);
      }
    }
  }

  private dispatch(slot: RemoteCoverWorkerSlot, task: QueuedRemoteCoverTask): void {
    slot.currentTask = task;
    task.timeout = setTimeout(() => {
      this.handleWorkerFailure(slot, new Error(`Remote cover worker task timed out after ${this.taskTimeoutMs}ms`));
    }, this.taskTimeoutMs);
    task.timeout.unref?.();

    try {
      slot.worker.postMessage({
        requestId: task.requestId,
        cacheRoot: this.cacheRoot,
        cacheVersion: COVER_CACHE_VERSION,
        data: task.data,
        mimeType: task.mimeType,
        warnings: task.warnings,
        errors: task.errors,
      });
    } catch (error) {
      this.handleWorkerFailure(slot, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleMessage(slot: RemoteCoverWorkerSlot, message: RemoteCoverWorkerMessage): void {
    const task = slot.currentTask;
    if (!task || message.requestId !== task.requestId) {
      return;
    }

    this.clearTaskTimeout(task);
    slot.currentTask = null;

    if (message.ok && message.result) {
      task.resolve(message.result);
    } else {
      task.reject(new Error(message.message ?? 'Remote cover worker failed'));
    }

    this.pump();
  }

  private handleWorkerFailure(slot: RemoteCoverWorkerSlot, error: Error): void {
    if (slot.retired) {
      return;
    }

    this.retireWorker(slot, error);

    if (!this.closed) {
      this.createWorker();
      this.pump();
    }
  }

  private retireWorker(slot: RemoteCoverWorkerSlot, error: Error): void {
    slot.retired = true;
    const index = this.workers.indexOf(slot);
    if (index >= 0) {
      this.workers.splice(index, 1);
    }

    const task = slot.currentTask;
    slot.currentTask = null;
    if (task) {
      this.clearTaskTimeout(task);
      task.reject(error);
    }

    void Promise.resolve(slot.worker.terminate()).catch(() => undefined);
  }

  private clearTaskTimeout(task: QueuedRemoteCoverTask): void {
    if (task.timeout) {
      clearTimeout(task.timeout);
      task.timeout = null;
    }
  }
}

export class CoverService {
  private readonly extractor = new TsCoverExtractor();
  private readonly remoteCoverWorkerPool: RemoteCoverWorkerPool;

  constructor(
    private readonly database: EchoDatabase,
    private readonly cacheRoot: string,
    options: CoverServiceOptions = {},
  ) {
    this.remoteCoverWorkerPool = new RemoteCoverWorkerPool(cacheRoot, options);
  }

  async ensureCover(filePath: string, metadata: ParsedTrackMetadata, now = new Date().toISOString()): Promise<string | null> {
    const result =
      filePath.startsWith('remote://') && metadata.embeddedCover
        ? await this.extractRemoteCover(metadata)
        : await this.extractor.extract(filePath, {
            cacheRoot: this.cacheRoot,
            metadata,
            now,
          });

    return this.upsertCover(result, now);
  }

  private extractRemoteCover(metadata: ParsedTrackMetadata): Promise<CoverResult> {
    const data = metadata.embeddedCover?.data;
    if (!data) {
      return Promise.reject(new Error('Remote cover data is missing'));
    }

    return this.remoteCoverWorkerPool.run({
      data,
      mimeType: metadata.embeddedCover?.mimeType ?? null,
      warnings: metadata.warnings ?? [],
      errors: metadata.errors ?? [],
    });
  }

  close(): void {
    this.remoteCoverWorkerPool.close();
  }

  private upsertCover(result: CoverResult, now: string): string | null {
    const existing = this.database.prepare<unknown[], { id: string; source_type: string }>('SELECT id, source_type FROM covers WHERE source_hash = ?').get(result.sourceHash);
    const source = preferredCoverSource(existing?.source_type, result.source);

    if (existing?.id) {
      this.database
        .prepare(
          `UPDATE covers SET
            source_type = ?,
            mime_type = ?,
            thumb_path = ?,
            album_path = ?,
            large_path = ?,
            original_ref = ?,
            cache_version = ?,
            warnings_json = ?,
            errors_json = ?,
            cover_thumb = ?,
            cover_large = ?,
            cover_original = ?,
            updated_at = ?
          WHERE id = ?`,
        )
        .run(
          source,
          result.mimeType,
          result.thumbPath,
          result.albumPath,
          result.largePath,
          result.originalRef,
          COVER_CACHE_VERSION,
          JSON.stringify(result.warnings),
          JSON.stringify(result.errors),
          result.thumbPath,
          result.largePath,
          result.originalRef,
          now,
          existing.id,
        );
      return existing.id;
    }

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO covers (
          id, source_type, source_hash, mime_type,
          thumb_path, album_path, large_path, original_ref,
          cache_version, warnings_json, errors_json,
          cover_thumb, cover_large, cover_original,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        source,
        result.sourceHash,
        result.mimeType,
        result.thumbPath,
        result.albumPath,
        result.largePath,
        result.originalRef,
        COVER_CACHE_VERSION,
        JSON.stringify(result.warnings),
        JSON.stringify(result.errors),
        result.thumbPath,
        result.largePath,
        result.originalRef,
        now,
        now,
      );

    return id;
  }
}
