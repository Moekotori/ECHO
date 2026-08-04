import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlbumService } from './AlbumService';
import type { LibraryStore } from './LibraryStore';
import { hasCompleteCoverCacheForScan, ScanJobQueue } from './ScanJobQueue';
import type { FileIdentityObservation } from './FileIdentityService';
import type {
  CoverExtractOptions,
  CoverResult,
  LibraryFolder,
  LibraryScanOptions,
  LibraryScanStatus,
  MetadataResult,
  ScanDirectorySnapshot,
  ScannedFile,
  ScanJobUpdate,
  StoredTrackCoverState,
  TrackWrite,
} from './libraryTypes';
import type { CoverExtractor } from './workers/CoverExtractor';
import type { FileScanner } from './workers/FileScanner';
import type { MetadataReader } from './workers/MetadataReader';

const tempRoots: string[] = [];
const previousSyncScanHealthCheckEnv = process.env.ECHO_SYNC_SCAN_HEALTH_CHECK;

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-scan-queue-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const pathCompareValue = (filePath: string): string => (process.platform === 'win32' ? resolve(filePath).toLocaleLowerCase() : resolve(filePath));

const isPathInsideOrEqual = (rootPath: string, candidatePath: string): boolean => {
  const root = pathCompareValue(rootPath);
  const candidate = pathCompareValue(candidatePath);
  const relativePath = relative(root, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

const uint32Le = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
};

const writeFlacWithCueSheet = (filePath: string, cueSheet: string): void => {
  const vendor = Buffer.from('ECHO Next', 'utf8');
  const comment = Buffer.from(`CUESHEET=${cueSheet}`, 'utf8');
  const vorbisComment = Buffer.concat([
    uint32Le(vendor.length),
    vendor,
    uint32Le(1),
    uint32Le(comment.length),
    comment,
  ]);
  const blockHeader = Buffer.alloc(4);
  blockHeader[0] = 0x80 | 4;
  blockHeader.writeUIntBE(vorbisComment.length, 1, 3);

  writeFileSync(filePath, Buffer.concat([Buffer.from('fLaC', 'ascii'), blockHeader, vorbisComment, Buffer.from('audio')]));
};

const baseFolder = (root: string): LibraryFolder => ({
  id: 'folder-1',
  path: join(root, 'music'),
  name: 'music',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const baseStatus = (folderId: string): LibraryScanStatus => ({
  id: 'job-1',
  folderId,
  status: 'queued',
  phase: 'queued',
  totalFiles: 0,
  processedFiles: 0,
  skippedFiles: 0,
  addedTracks: 0,
  updatedTracks: 0,
  removedTracks: 0,
  coverCount: 0,
  errorCount: 0,
  errors: [],
  startedAt: null,
  finishedAt: null,
});

const metadataResult = (embeddedCover?: Uint8Array): MetadataResult => ({
  fields: {
    title: 'Embedded Title',
    artist: 'Embedded Artist',
    album: 'Embedded Album',
    albumArtist: 'Embedded Artist',
    trackNo: 1,
    discNo: null,
    year: 2024,
    genre: 'Electronic',
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
    year: 'embedded',
    genre: 'embedded',
    duration: 'technical',
    codec: 'technical',
    sampleRate: 'technical',
    bitDepth: 'technical',
    bitrate: 'technical',
  },
  embeddedCover: embeddedCover ? { data: embeddedCover, mimeType: 'image/png' } : undefined,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: embeddedCover ? 'present' : 'missing',
  warnings: [],
  errors: [],
  status: 'ok',
});

class FakeStore {
  status: LibraryScanStatus | null = null;
  readonly updates: ScanJobUpdate[] = [];
  readonly upsertedTracks: TrackWrite[] = [];
  readonly identityUpdates: Array<{ trackId: string; identity: Partial<TrackWrite> }> = [];
  readonly directorySnapshots: ScanDirectorySnapshot[] = [];
  readonly missingPaths: string[] = [];
  readonly seededAlbumTrackIds: string[][] = [];
  markMissingCalls = 0;
  transactionCalls = 0;
  refreshAlbumsCalls = 0;
  refreshArtistsCalls = 0;
  finishFolderScanCalls = 0;
  getTrackCacheStatesByFolderCalls = 0;
  getTrackCacheStatesByPathsCalls = 0;
  findTrackCoverStateCalls = 0;
  cancelled = false;

  constructor(
    private readonly coverStatesByPath = new Map<string, StoredTrackCoverState>(),
    private readonly snapshotsByPath = new Map<string, ScanDirectorySnapshot>(),
  ) {}

  createScanJob(folderId: string): LibraryScanStatus {
    this.status = baseStatus(folderId);
    return this.status;
  }

  updateScanJob(_jobId: string, update: ScanJobUpdate): LibraryScanStatus {
    if (!this.status) {
      throw new Error('missing status');
    }

    this.updates.push(update);
    this.status = {
      ...this.status,
      ...update,
      errors: update.errors ?? this.status.errors,
      errorCount: update.errorCount ?? update.errors?.length ?? this.status.errorCount,
      coverCount: update.coverCount ?? this.status.coverCount,
    };
    return this.status;
  }

  getScanJob(): LibraryScanStatus | null {
    return this.status;
  }

  isScanCancelled(): boolean {
    return this.cancelled;
  }

  getTrackCacheStatesByFolder(): Map<string, StoredTrackCoverState> {
    this.getTrackCacheStatesByFolderCalls += 1;
    return new Map(this.coverStatesByPath);
  }

  getTrackCacheStatesByPaths(_folderId: string, paths: readonly string[]): Map<string, StoredTrackCoverState> {
    this.getTrackCacheStatesByPathsCalls += 1;
    const states = new Map<string, StoredTrackCoverState>();
    for (const filePath of paths) {
      const state = this.coverStatesByPath.get(filePath);
      if (state) {
        states.set(filePath, state);
      }
    }
    return states;
  }

  findTrackCoverState(filePath: string): StoredTrackCoverState | null {
    this.findTrackCoverStateCalls += 1;
    return this.coverStatesByPath.get(filePath) ?? null;
  }

  transaction<T>(work: () => T): T {
    this.transactionCalls += 1;
    return work();
  }

  markTracksMissingFromFolder(
    _folderId: string,
    discoveredPaths: string[],
    _timestamp?: string,
    options: { excludeDirectories?: readonly string[] } = {},
  ): number {
    this.markMissingCalls += 1;
    const discovered = new Set(discoveredPaths.map(pathCompareValue));
    const excludedDirectories = options.excludeDirectories ?? [];
    const missing = Array.from(this.coverStatesByPath.keys()).filter(
      (filePath) =>
        !discovered.has(pathCompareValue(filePath)) &&
        !excludedDirectories.some((directoryPath) => isPathInsideOrEqual(directoryPath, filePath)),
    );
    this.missingPaths.push(...missing);
    return missing.length;
  }

  upsertCover(): string {
    return 'cover-1';
  }

  updateTrackCover(): void {}

  updateTrackIdentity(trackId: string, identity: Partial<TrackWrite>): void {
    this.identityUpdates.push({ trackId, identity });
  }

  async prepareTrackSearchTerms(): Promise<string> {
    return '';
  }

  upsertTrack(track: TrackWrite): 'added' | 'updated' {
    this.upsertedTracks.push(track);
    return this.coverStatesByPath.has(track.path) ? 'updated' : 'added';
  }

  refreshAlbums(): void {
    this.refreshAlbumsCalls += 1;
  }

  refreshArtists(): void {
    this.refreshArtistsCalls += 1;
  }

  async refreshArtistsCooperatively(): Promise<void> {
    this.refreshArtists();
  }

  seedAlbumsForTracks(trackIds: readonly string[]): void {
    this.seededAlbumTrackIds.push([...trackIds]);
  }

  finishFolderScan(): void {
    this.finishFolderScanCalls += 1;
  }

  getScanDirectorySnapshotsByFolder(): Map<string, ScanDirectorySnapshot> {
    return new Map(this.snapshotsByPath);
  }

  upsertScanDirectorySnapshots(_folderId: string, snapshots: readonly ScanDirectorySnapshot[]): void {
    this.directorySnapshots.push(...snapshots);
  }

  recordLibraryInboxBatch(): null {
    return null;
  }
}

class FakeScanner implements FileScanner {
  calls = 0;
  lastOptions: Parameters<FileScanner['scanFolder']>[1] | undefined;
  constructor(private readonly files: ScannedFile[]) {}

  async *scanFolder(_folderPath?: string, options?: Parameters<FileScanner['scanFolder']>[1]): AsyncIterable<ScannedFile> {
    this.calls += 1;
    this.lastOptions = options;
    for (const file of this.files) {
      yield file;
    }
  }
}

class ProgressReportingScanner implements FileScanner {
  constructor(
    private readonly files: ScannedFile[],
    private readonly reportedFiles: number,
  ) {}

  async *scanFolder(_folderPath?: string, options?: Parameters<FileScanner['scanFolder']>[1]): AsyncIterable<ScannedFile> {
    options?.onScannerProgress?.({ directories: 4, files: this.reportedFiles });
    for (const file of this.files) {
      yield file;
    }
  }
}

class ThrowingScanner implements FileScanner {
  scanFolder(): AsyncIterable<ScannedFile> {
    throw new Error('scanner boom');
  }
}

class RecoverableErrorScanner implements FileScanner {
  constructor(
    private readonly files: ScannedFile[],
    private readonly errorPath: string,
    private readonly kind: 'directory' | 'file_stat' = 'directory',
  ) {}

  async *scanFolder(_folderPath?: string, options?: Parameters<FileScanner['scanFolder']>[1]): AsyncIterable<ScannedFile> {
    options?.onFileSystemError?.({
      kind: this.kind,
      path: this.errorPath,
      message: 'EACCES: permission denied',
    });

    for (const file of this.files) {
      yield file;
    }
  }
}

class FakeMetadataReader implements MetadataReader {
  readonly paths: string[] = [];

  constructor(private readonly result: MetadataResult = metadataResult()) {}

  async read(filePath: string): Promise<MetadataResult> {
    this.paths.push(filePath);
    return this.result;
  }
}

class ConcurrentMetadataReader implements MetadataReader {
  activeReads = 0;
  maxActiveReads = 0;

  async read(): Promise<MetadataResult> {
    this.activeReads += 1;
    this.maxActiveReads = Math.max(this.maxActiveReads, this.activeReads);
    await new Promise((resolve) => setImmediate(resolve));
    this.activeReads -= 1;
    return metadataResult();
  }
}

class ThrowingMetadataReader implements MetadataReader {
  readonly paths: string[] = [];

  async read(filePath: string): Promise<MetadataResult> {
    this.paths.push(filePath);
    throw new Error('metadata boom');
  }
}

class CapturingCoverExtractor implements CoverExtractor {
  readonly cacheRoots: string[] = [];
  readonly sawEmbeddedCover: boolean[] = [];
  readonly repairCalls: string[] = [];

  async extract(_filePath: string, options: CoverExtractOptions): Promise<CoverResult> {
    this.cacheRoots.push(options.cacheRoot);
    this.sawEmbeddedCover.push(Boolean(options.metadata?.embeddedCover));
    return {
      source: options.metadata?.embeddedCover ? 'embedded' : 'default',
      thumbPath: join(options.cacheRoot, 'thumb.webp'),
      albumPath: join(options.cacheRoot, 'album.webp'),
      largePath: join(options.cacheRoot, 'large.webp'),
      originalRef: join(options.cacheRoot, 'original.png'),
      sourceHash: 'cover-hash',
      mimeType: 'image/png',
      warnings: [],
      errors: [],
    };
  }

  async repairCachedCover(options: {
    cacheRoot: string;
    source: CoverResult['source'];
    sourceHash: string;
    mimeType: string | null;
    originalRef: string;
    thumbPath?: string | null;
    albumPath?: string | null;
    largePath?: string | null;
  }): Promise<CoverResult> {
    this.repairCalls.push(options.sourceHash);
    const thumbPath = options.thumbPath ?? join(options.cacheRoot, 'thumb.webp');
    const albumPath = options.albumPath ?? join(options.cacheRoot, 'album.webp');
    const largePath = options.largePath ?? join(options.cacheRoot, 'large.webp');

    writeFileSync(thumbPath, 'thumb');
    writeFileSync(albumPath, 'album');
    writeFileSync(largePath, 'large');

    return {
      source: options.source,
      thumbPath,
      albumPath,
      largePath,
      originalRef: options.originalRef,
      sourceHash: options.sourceHash,
      mimeType: options.mimeType,
      warnings: [],
      errors: [],
    };
  }
}

const makeFiles = (root: string, count: number): ScannedFile[] =>
  Array.from({ length: count }, (_, index) => ({
    path: join(root, 'music', `track-${index}.flac`),
    sizeBytes: 10,
    mtimeMs: 1,
  }));

const coverState = (file: ScannedFile, overrides: Partial<StoredTrackCoverState> = {}): StoredTrackCoverState => ({
  id: `track-${file.path}`,
  sizeBytes: file.sizeBytes,
  mtimeMs: file.mtimeMs,
  coverId: 'cover-1',
  coverSource: 'default',
  sourceHash: 'hash',
  mimeType: 'image/webp',
  thumbPath: null,
  albumPath: null,
  largePath: null,
  originalRef: null,
  cacheVersion: 1,
  ...overrides,
});

const coverStateMap = (files: ScannedFile[], stateForFile: (file: ScannedFile, index: number) => StoredTrackCoverState): Map<string, StoredTrackCoverState> =>
  new Map(files.map((file, index) => [file.path, stateForFile(file, index)]));

const runQueue = async (
  store: FakeStore,
  scanner: FileScanner,
  metadataReader: MetadataReader,
  coverExtractor: CoverExtractor,
  cacheRoot: string,
  folder: LibraryFolder,
  options: LibraryScanOptions = {},
): Promise<LibraryScanStatus> => {
  const queue = new ScanJobQueue(
    store as unknown as LibraryStore,
    scanner,
    metadataReader,
    coverExtractor,
    {} as AlbumService,
    { coverCacheDir: cacheRoot },
  );
  const job = queue.scanFolder(folder, options);
  try {
    await queue.waitForIdle(job.id);
    return store.getScanJob()!;
  } finally {
    queue.dispose();
  }
};

const statMtimeMs = (filePath: string): number => statSync(filePath).mtimeMs;

const runPathsQueue = async (
  store: FakeStore,
  scanner: FileScanner,
  metadataReader: MetadataReader,
  coverExtractor: CoverExtractor,
  cacheRoot: string,
  folder: LibraryFolder,
  paths: string[],
  options: LibraryScanOptions = {},
): Promise<LibraryScanStatus> => {
  const queue = new ScanJobQueue(
    store as unknown as LibraryStore,
    scanner,
    metadataReader,
    coverExtractor,
    {} as AlbumService,
    { coverCacheDir: cacheRoot },
  );
  const job = queue.scanPaths(folder, paths, options);
  try {
    await queue.waitForIdle(job.id);
    return store.getScanJob()!;
  } finally {
    queue.dispose();
  }
};

const runStoredQueue = async (
  store: FakeStore,
  scanner: FileScanner,
  metadataReader: MetadataReader,
  coverExtractor: CoverExtractor,
  cacheRoot: string,
  folder: LibraryFolder,
  options: LibraryScanOptions = {},
): Promise<LibraryScanStatus> => {
  const queue = new ScanJobQueue(
    store as unknown as LibraryStore,
    scanner,
    metadataReader,
    coverExtractor,
    {} as AlbumService,
    { coverCacheDir: cacheRoot },
  );
  const job = queue.scanStoredTracks(folder, options);
  try {
    await queue.waitForIdle(job.id);
    return store.getScanJob()!;
  } finally {
    queue.dispose();
  }
};

const identityObservation = (overrides: Partial<FileIdentityObservation> = {}): FileIdentityObservation => ({
  fileIdentity: 'dev:1:ino:2',
  fileIdentitySource: 'posix-dev-ino',
  quickHash: 'a'.repeat(64),
  quickHashVersion: 1,
  identityStatus: 'ok',
  identityUpdatedAt: '2026-05-18T00:00:00.000Z',
  identityError: null,
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
  if (previousSyncScanHealthCheckEnv === undefined) {
    delete process.env.ECHO_SYNC_SCAN_HEALTH_CHECK;
  } else {
    process.env.ECHO_SYNC_SCAN_HEALTH_CHECK = previousSyncScanHealthCheckEnv;
  }
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('ScanJobQueue progress and cover memory behavior', () => {
  it('memoizes complete cover cache checks for tracks sharing cover paths', () => {
    const [firstFile, secondFile] = makeFiles(makeTempRoot(), 2);
    const sharedCoverPaths = {
      thumbPath: 'cache/thumb.webp',
      albumPath: 'cache/album.webp',
      largePath: 'cache/large.webp',
      originalRef: 'cache/original.jpg',
    };
    const first = coverState(firstFile, sharedCoverPaths);
    const second = coverState(secondFile, sharedCoverPaths);
    const memo = new Map<string, boolean>();
    const exists = vi.fn(() => true);

    expect(hasCompleteCoverCacheForScan(first, memo, exists)).toBe(true);
    expect(hasCompleteCoverCacheForScan(second, memo, exists)).toBe(true);
    expect(exists).toHaveBeenCalledTimes(3);
  });

  it('throttles ordinary progress writes for large unchanged scans', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const files = makeFiles(root, 1000);
    const store = new FakeStore(
      coverStateMap(files, (file) =>
        coverState(file, {
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const status = await runQueue(
      store,
      new FakeScanner(files),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      cacheRoot,
      baseFolder(root),
    );

    expect(status.status).toBe('completed');
    expect(status.phase).toBe('finished');
    expect(status.processedFiles).toBe(1000);
    expect(status.skippedFiles).toBe(1000);
    expect(store.updates.length).toBeLessThan(100);
    expect(store.updates.map((update) => update.phase)).toEqual(
      expect.arrayContaining(['discovering', 'checking_cache', 'reading_metadata', 'extracting_covers', 'grouping_albums', 'writing_database', 'finished']),
    );
    expect(store.getTrackCacheStatesByPathsCalls).toBe(1);
    expect(store.getTrackCacheStatesByFolderCalls).toBe(0);
    expect(store.findTrackCoverStateCalls).toBe(0);
  });

  it('skips metadata parse and cover extraction for unchanged files with complete cover cache', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const files = makeFiles(root, 2);
    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore(
      coverStateMap(files, (file) =>
        coverState(file, {
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const coverExtractor = new CapturingCoverExtractor();
    const status = await runQueue(
      store,
      new FakeScanner(files),
      metadataReader,
      coverExtractor,
      cacheRoot,
      baseFolder(root),
    );

    expect(status.skippedFiles).toBe(2);
    expect(metadataReader.paths).toEqual([]);
    expect(coverExtractor.cacheRoots).toEqual([]);
    expect(store.upsertedTracks).toEqual([]);
    expect(store.getTrackCacheStatesByPathsCalls).toBe(1);
    expect(store.getTrackCacheStatesByFolderCalls).toBe(0);
    expect(store.findTrackCoverStateCalls).toBe(0);
  });

  it('applies scanner progress during discovery before buffered files are yielded', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const [file] = makeFiles(root, 1);
    const store = new FakeStore();

    const status = await runQueue(
      store,
      new ProgressReportingScanner([file], 250),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      cacheRoot,
      baseFolder(root),
    );

    expect(status.status).toBe('completed');
    expect(store.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'discovering', totalFiles: 250 }),
      expect.objectContaining({ phase: 'checking_cache', totalFiles: 1 }),
    ]));
  });

  it('does not rebuild full album and artist groupings synchronously after a small changed scan', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const files = makeFiles(root, 1);
    const store = new FakeStore();

    const status = await runQueue(
      store,
      new FakeScanner(files),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      cacheRoot,
      baseFolder(root),
    );

    expect(status.status).toBe('completed');
    expect(store.upsertedTracks).toHaveLength(1);
    expect(store.seededAlbumTrackIds.flat()).toHaveLength(1);
    expect(store.refreshAlbumsCalls).toBe(0);
    expect(store.refreshArtistsCalls).toBe(0);
  });

  it.each([
    ['thumb', 'thumbPath'],
    ['album', 'albumPath'],
    ['large', 'largePath'],
  ] as const)('repairs an unchanged track when %s derivative is missing', async (_name, missingKey) => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const files = makeFiles(root, 1);
    const thumbPath = join(cacheRoot, 'thumb.webp');
    const albumPath = join(cacheRoot, 'album.webp');
    const largePath = join(cacheRoot, 'large.webp');
    const originalRef = join(cacheRoot, 'original.png');

    for (const filePath of [thumbPath, albumPath, largePath, originalRef]) {
      writeFileSync(filePath, 'cached');
    }
    rmSync({ thumbPath, albumPath, largePath }[missingKey], { force: true });

    const metadataReader = new FakeMetadataReader();
    const coverExtractor = new CapturingCoverExtractor();
    const store = new FakeStore(
      coverStateMap(files, (file) =>
        coverState(file, {
          coverSource: 'embedded',
          sourceHash: 'repair-hash',
          thumbPath,
          albumPath,
          largePath,
          originalRef,
        }),
      ),
    );

    const status = await runQueue(store, new FakeScanner(files), metadataReader, coverExtractor, cacheRoot, baseFolder(root));

    expect(status.skippedFiles).toBe(0);
    expect(status.updatedTracks).toBe(0);
    expect(metadataReader.paths).toEqual([]);
    expect(coverExtractor.cacheRoots).toEqual([]);
    expect(coverExtractor.repairCalls).toEqual(['repair-hash']);
    expect(store.getTrackCacheStatesByPathsCalls).toBe(1);
    expect(store.getTrackCacheStatesByFolderCalls).toBe(0);
    expect(store.findTrackCoverStateCalls).toBe(0);
  });

  it('reads metadata again for changed files', async () => {
    const root = makeTempRoot();
    const [file] = makeFiles(root, 1);
    const changedFile = { ...file, sizeBytes: file.sizeBytes + 1 };
    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore(coverStateMap([file], (item) => coverState(item)));

    const status = await runQueue(
      store,
      new FakeScanner([changedFile]),
      metadataReader,
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      baseFolder(root),
    );

    expect(status.updatedTracks).toBe(1);
    expect(metadataReader.paths).toEqual([changedFile.path]);
    expect(store.upsertedTracks[0]?.id).toBe(store.getTrackCacheStatesByFolder().get(file.path)?.id);
    expect(store.findTrackCoverStateCalls).toBe(0);
  });

  it('changes-only scans read added files and mark removed paths without rereading existing paths', async () => {
    const root = makeTempRoot();
    const existingFiles = makeFiles(root, 120);
    const [existingFile, deletedFile] = existingFiles;
    const newFile = {
      path: join(root, 'music', 'new-track.flac'),
      sizeBytes: 10,
      mtimeMs: 1,
    };
    const changedExistingFile = { ...existingFile, sizeBytes: existingFile.sizeBytes + 100 };
    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore(coverStateMap(existingFiles, (item) => coverState(item)));

    const status = await runQueue(
      store,
      new FakeScanner([changedExistingFile, ...existingFiles.slice(2), newFile]),
      metadataReader,
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      baseFolder(root),
      { changesOnly: true, reduceScanPressure: true },
    );

    expect(status.status).toBe('completed');
    expect(status.addedTracks).toBe(1);
    expect(status.updatedTracks).toBe(0);
    expect(status.removedTracks).toBe(1);
    expect(status.totalFiles).toBe(1);
    expect(metadataReader.paths).toEqual([newFile.path]);
    expect(store.upsertedTracks.map((track) => track.path)).toEqual([newFile.path]);
    expect(store.missingPaths).toEqual([deletedFile.path]);
    expect(store.getTrackCacheStatesByFolderCalls).toBe(1);
    expect(store.getTrackCacheStatesByPathsCalls).toBe(0);
    expect(Math.max(...store.updates.map((update) => update.totalFiles ?? 0))).toBe(1);
  });

  it('adds newly discovered files', async () => {
    const root = makeTempRoot();
    const [file] = makeFiles(root, 1);
    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore();

    const status = await runQueue(
      store,
      new FakeScanner([file]),
      metadataReader,
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      baseFolder(root),
    );

    expect(status.addedTracks).toBe(1);
    expect(metadataReader.paths).toEqual([file.path]);
    expect(store.upsertedTracks[0]?.path).toBe(file.path);
    expect(store.findTrackCoverStateCalls).toBe(0);
  });

  it('expands embedded cue audio files into virtual library tracks during folder scans', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const audioPath = join(folder.path, 'album.flac');
    writeFlacWithCueSheet(
      audioPath,
      [
        'PERFORMER "Album Artist"',
        'TITLE "Album Title"',
        'FILE "ignored.wav" WAVE',
        '  TRACK 01 AUDIO',
        '    TITLE "First Song"',
        '    INDEX 01 00:00:00',
        '  TRACK 02 AUDIO',
        '    TITLE "Second Song"',
        '    INDEX 01 03:00:00',
      ].join('\n'),
    );
    const file = {
      path: audioPath,
      sizeBytes: statSync(audioPath).size,
      mtimeMs: Math.round(statMtimeMs(audioPath)),
    };
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore(
      coverStateMap([file], (item) =>
        coverState(item, {
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const status = await runQueue(
      store,
      new FakeScanner([file]),
      metadataReader,
      new CapturingCoverExtractor(),
      cacheRoot,
      folder,
    );

    expect(status.totalFiles).toBe(2);
    expect(status.addedTracks).toBe(2);
    expect(status.removedTracks).toBe(1);
    expect(metadataReader.paths).toEqual([
      `${resolve(audioPath)}#cueTrack=1`,
      `${resolve(audioPath)}#cueTrack=2`,
    ]);
    expect(store.upsertedTracks.map((track) => track.path)).toEqual([
      `${resolve(audioPath)}#cueTrack=1`,
      `${resolve(audioPath)}#cueTrack=2`,
    ]);
    expect(store.missingPaths).toEqual([audioPath]);
  });

  it('expands sidecar cue sheets into virtual library tracks during folder scans', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const audioPath = join(folder.path, 'long-album.flac');
    const cuePath = join(folder.path, 'long-album.cue');
    writeFileSync(audioPath, 'audio');
    writeFileSync(
      cuePath,
      [
        'PERFORMER "Album Artist"',
        'TITLE "Long Album"',
        'FILE "long-album.flac" WAVE',
        '  TRACK 01 AUDIO',
        '    TITLE "Opening"',
        '    INDEX 01 00:00:00',
        '  TRACK 02 AUDIO',
        '    TITLE "Middle"',
        '    INDEX 01 20:00:00',
        '  TRACK 03 AUDIO',
        '    TITLE "Finale"',
        '    INDEX 01 42:30:00',
      ].join('\n'),
    );

    const audioFile = { path: resolve(audioPath), sizeBytes: 5, mtimeMs: Math.round(statMtimeMs(audioPath)) };
    const cueFile = { path: resolve(cuePath), sizeBytes: statSync(cuePath).size, mtimeMs: Math.round(statMtimeMs(cuePath)) };
    const store = new FakeStore(coverStateMap([audioFile], (file) => coverState(file)));
    const scanner = new FakeScanner([audioFile, cueFile]);
    const metadataReader = new FakeMetadataReader();
    const cacheRoot = join(root, 'custom-cache');

    const status = await runQueue(
      store,
      scanner,
      metadataReader,
      new CapturingCoverExtractor(),
      cacheRoot,
      folder,
    );

    const expectedPaths = [1, 2, 3].map((trackNumber) => `${resolve(cuePath)}#cueTrack=${trackNumber}`);
    expect(scanner.lastOptions?.audioExtensions).toContain('.cue');
    expect(status.totalFiles).toBe(3);
    expect(status.addedTracks).toBe(3);
    expect(status.removedTracks).toBe(1);
    expect(metadataReader.paths).toEqual(expectedPaths);
    expect(store.upsertedTracks.map((track) => track.path)).toEqual(expectedPaths);
    expect(store.upsertedTracks.every((track) => track.sizeBytes > audioFile.sizeBytes)).toBe(true);
    expect(store.missingPaths).toEqual([audioPath]);
  });

  it('notifies when a scan job settles so renderer library views can refresh after completion', async () => {
    const root = makeTempRoot();
    const [file] = makeFiles(root, 1);
    const store = new FakeStore();
    const onScanSettled = vi.fn();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([file]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      { coverCacheDir: join(root, 'custom-cache'), onScanSettled },
    );

    const job = queue.scanFolder(baseFolder(root));
    await queue.waitForIdle(job.id);

    expect(onScanSettled).toHaveBeenCalledTimes(1);
    expect(onScanSettled).toHaveBeenCalledWith(expect.objectContaining({ id: job.id, status: 'completed' }));
  });

  it('keeps user-started folder scans at normal scanner priority', async () => {
    const root = makeTempRoot();
    const [file] = makeFiles(root, 1);
    const scanner = new FakeScanner([file]);
    const queue = new ScanJobQueue(
      new FakeStore() as unknown as LibraryStore,
      scanner,
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      { coverCacheDir: join(root, 'custom-cache') },
    );

    const job = queue.scanFolder(baseFolder(root));
    await queue.waitForIdle(job.id);

    expect(scanner.lastOptions?.backgroundPriority).toBe(false);
  });

  it('lowers even user-started scanner priority while playback pressure is active', async () => {
    const root = makeTempRoot();
    const [file] = makeFiles(root, 1);
    const scanner = new FakeScanner([file]);
    const queue = new ScanJobQueue(
      new FakeStore() as unknown as LibraryStore,
      scanner,
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        shouldReduceScanPressure: () => true,
      },
    );

    const job = queue.scanFolder(baseFolder(root));
    await queue.waitForIdle(job.id);

    expect(scanner.lastOptions?.backgroundPriority).toBe(true);
  });

  it('uses background scanner priority for changes-only scans', async () => {
    const root = makeTempRoot();
    const [file] = makeFiles(root, 1);
    const scanner = new FakeScanner([file]);
    const queue = new ScanJobQueue(
      new FakeStore() as unknown as LibraryStore,
      scanner,
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      { coverCacheDir: join(root, 'custom-cache') },
    );

    const job = queue.scanFolder(baseFolder(root), { changesOnly: true });
    await queue.waitForIdle(job.id);

    expect(scanner.lastOptions?.backgroundPriority).toBe(true);
  });

  it('reduces metadata read concurrency while scan pressure should stay low', async () => {
    const root = makeTempRoot();
    const files = makeFiles(root, 4);
    const metadataReader = new ConcurrentMetadataReader();
    const store = new FakeStore();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner(files),
      metadataReader,
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        metadataConcurrency: 4,
        shouldReduceScanPressure: () => true,
      },
    );

    const job = queue.scanFolder(baseFolder(root));
    try {
      await queue.waitForIdle(job.id);
    } finally {
      queue.dispose();
    }

    expect(store.getScanJob()).toMatchObject({ status: 'completed', processedFiles: 4 });
    expect(metadataReader.maxActiveReads).toBe(1);
  });

  it('uses tiny database write batches while scan pressure should stay low', async () => {
    const root = makeTempRoot();
    const files = makeFiles(root, 9);
    const store = new FakeStore();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner(files),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        shouldReduceScanPressure: () => true,
      },
    );

    const job = queue.scanFolder(baseFolder(root));
    await queue.waitForIdle(job.id);

    expect(store.getScanJob()).toMatchObject({ status: 'completed', processedFiles: 9 });
    expect(store.seededAlbumTrackIds).toHaveLength(3);
    expect(store.seededAlbumTrackIds.every((trackIds) => trackIds.length <= 4)).toBe(true);
  });

  it('creates a recovery snapshot after a successful scan writes library changes', async () => {
    process.env.ECHO_SYNC_SCAN_HEALTH_CHECK = '1';
    const root = makeTempRoot();
    const [file] = makeFiles(root, 1);
    const store = new FakeStore();
    const createCompletedScanSnapshot = vi.fn();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([file]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      { coverCacheDir: join(root, 'custom-cache'), createCompletedScanSnapshot },
    );

    const job = queue.scanFolder(baseFolder(root));
    await queue.waitForIdle(job.id);

    expect(createCompletedScanSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: job.id, status: 'completed', addedTracks: 1 }),
    );
  });

  it('defers completed scan maintenance while playback pressure stays low', async () => {
    vi.useFakeTimers();
    const root = makeTempRoot();
    const store = new FakeStore();
    const checkDatabaseHealth = vi.fn();
    const createCompletedScanSnapshot = vi.fn();
    let reduceScanPressure = true;
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        checkDatabaseHealth,
        createCompletedScanSnapshot,
        shouldReduceScanPressure: () => reduceScanPressure,
      },
    );
    const completedStatus: LibraryScanStatus = {
      ...baseStatus('folder-1'),
      status: 'completed',
      phase: 'finished',
      totalFiles: 1,
      processedFiles: 1,
      addedTracks: 1,
      finishedAt: '2026-05-18T00:00:00.000Z',
    };
    const maintenance = (
      queue as unknown as {
        runCompletedScanMaintenance: (
          jobId: string,
          folderId: string,
          fileCount: number,
          completedStatus: LibraryScanStatus,
          options: { deferForPlayback?: boolean },
        ) => Promise<void>;
      }
    ).runCompletedScanMaintenance(completedStatus.id, completedStatus.folderId, 1, completedStatus, {
      deferForPlayback: true,
    });

    await vi.advanceTimersByTimeAsync(4000);

    expect(checkDatabaseHealth).not.toHaveBeenCalled();
    expect(createCompletedScanSnapshot).not.toHaveBeenCalled();

    reduceScanPressure = false;
    await vi.advanceTimersByTimeAsync(2000);
    await vi.runOnlyPendingTimersAsync();
    await maintenance;

    expect(checkDatabaseHealth).toHaveBeenCalledWith(
      expect.objectContaining({ id: completedStatus.id, status: 'completed', addedTracks: 1 }),
    );
    expect(createCompletedScanSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: completedStatus.id, status: 'completed', addedTracks: 1 }),
    );
  });

  it('skips completed scan maintenance when a scan has no library changes', async () => {
    const root = makeTempRoot();
    const [file] = makeFiles(root, 1);
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const store = new FakeStore(coverStateMap([file], (item) => coverState(item, {
      coverSource: 'embedded',
      thumbPath: cachedCover,
      albumPath: cachedCover,
      largePath: cachedCover,
    })));
    const checkDatabaseHealth = vi.fn();
    const createCompletedScanSnapshot = vi.fn();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([file]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      { coverCacheDir: cacheRoot, checkDatabaseHealth, createCompletedScanSnapshot },
    );

    const job = queue.scanFolder(baseFolder(root));
    await queue.waitForIdle(job.id);

    expect(store.getScanJob()).toMatchObject({ id: job.id, status: 'completed', skippedFiles: 1 });
    expect(checkDatabaseHealth).not.toHaveBeenCalled();
    expect(createCompletedScanSnapshot).not.toHaveBeenCalled();
  });

  it('keeps a successful scan completed when the recovery snapshot cannot be written', async () => {
    process.env.ECHO_SYNC_SCAN_HEALTH_CHECK = '1';
    const root = makeTempRoot();
    const [file] = makeFiles(root, 1);
    const store = new FakeStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([file]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        createCompletedScanSnapshot: () => {
          throw new Error('snapshot locked');
        },
      },
    );

    const job = queue.scanFolder(baseFolder(root));
    await queue.waitForIdle(job.id);

    expect(store.getScanJob()).toMatchObject({ id: job.id, status: 'completed', addedTracks: 1 });
    warn.mockRestore();
  });

  it('defers grouping refresh while scan pressure should stay low, then refreshes when idle', async () => {
    vi.useFakeTimers();
    const root = makeTempRoot();
    const [file] = makeFiles(root, 1);
    const store = new FakeStore();
    const onDeferredGroupingRefresh = vi.fn();
    let deferGrouping = true;
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([file]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        shouldDeferGroupingRefresh: () => deferGrouping,
        onDeferredGroupingRefresh,
      },
    );

    const job = queue.scanFolder(baseFolder(root));
    await queue.waitForIdle(job.id);

    expect(store.seededAlbumTrackIds.flat()).toHaveLength(1);
    expect(store.refreshAlbumsCalls).toBe(0);
    expect(store.refreshArtistsCalls).toBe(0);

    deferGrouping = false;
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.refreshAlbumsCalls).toBe(0);
    expect(store.refreshArtistsCalls).toBe(1);
    expect(onDeferredGroupingRefresh).toHaveBeenCalledTimes(1);
  });

  it('chunks large first imports and defers grouping refresh', async () => {
    vi.useFakeTimers();
    const root = makeTempRoot();
    const files = makeFiles(root, 2001);
    const store = new FakeStore();
    const onDeferredGroupingRefresh = vi.fn();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner(files),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        onDeferredGroupingRefresh,
      },
    );

    const job = queue.scanFolder(baseFolder(root));
    await queue.waitForIdle(job.id);

    expect(store.upsertedTracks).toHaveLength(2001);
    expect(store.transactionCalls).toBeGreaterThan(10);
    expect(store.refreshAlbumsCalls).toBe(0);
    expect(store.refreshArtistsCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);

    expect(store.refreshAlbumsCalls).toBe(0);
    expect(store.refreshArtistsCalls).toBe(1);
    expect(onDeferredGroupingRefresh).toHaveBeenCalledTimes(1);
  });

  it('marks files missing when they disappear from a scan', async () => {
    const root = makeTempRoot();
    const [keptFile, deletedFile] = makeFiles(root, 2);
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore(
      coverStateMap([keptFile, deletedFile], (file) =>
        coverState(file, {
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const status = await runQueue(
      store,
      new FakeScanner([keptFile]),
      metadataReader,
      new CapturingCoverExtractor(),
      cacheRoot,
      baseFolder(root),
    );

    expect(status.removedTracks).toBe(1);
    expect(status.skippedFiles).toBe(1);
    expect(store.missingPaths).toEqual([deletedFile.path]);
    expect(metadataReader.paths).toEqual([]);
    expect(store.getTrackCacheStatesByPathsCalls).toBe(1);
    expect(store.getTrackCacheStatesByFolderCalls).toBe(0);
    expect(store.findTrackCoverStateCalls).toBe(0);
  });

  it('rescans stored missing-cover tracks without walking the library folder', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'custom-cache');
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const files = makeFiles(root, 2);
    for (const file of files) {
      writeFileSync(file.path, 'audio');
    }

    const metadataReader = new FakeMetadataReader();
    const coverExtractor = new CapturingCoverExtractor();
    const store = new FakeStore(
      coverStateMap(files, (file, index) => {
        if (index === 0) {
          return coverState(file, {
            coverSource: 'embedded',
            thumbPath: cachedCover,
            albumPath: cachedCover,
            largePath: cachedCover,
            originalRef: cachedCover,
          });
        }

        return coverState(file, {
          coverSource: 'default',
          thumbPath: null,
          albumPath: null,
          largePath: null,
          originalRef: null,
        });
      }),
    );

    const status = await runStoredQueue(
      store,
      new ThrowingScanner(),
      metadataReader,
      coverExtractor,
      cacheRoot,
      folder,
      { mode: 'embedded-tags-missing-cover' },
    );

    expect(status.status).toBe('completed');
    expect(status.totalFiles).toBe(1);
    expect(metadataReader.paths).toEqual([resolve(files[1].path)]);
    expect(coverExtractor.cacheRoots).toEqual([cacheRoot]);
    expect(store.markMissingCalls).toBe(0);
    expect(store.finishFolderScanCalls).toBe(0);
  });

  it('treats an incomplete stored cover cache as a missing-cover rescan target', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'custom-cache');
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    const missingCover = join(cacheRoot, 'missing.webp');
    writeFileSync(cachedCover, 'cached');
    const [file] = makeFiles(root, 1);
    writeFileSync(file.path, 'audio');

    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore(
      coverStateMap([file], (track) =>
        coverState(track, {
          coverSource: 'embedded',
          thumbPath: cachedCover,
          albumPath: missingCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const status = await runStoredQueue(
      store,
      new ThrowingScanner(),
      metadataReader,
      new CapturingCoverExtractor(),
      cacheRoot,
      folder,
      { mode: 'embedded-tags-missing-cover' },
    );

    expect(status.status).toBe('completed');
    expect(status.totalFiles).toBe(1);
    expect(metadataReader.paths).toEqual([resolve(file.path)]);
    expect(store.upsertedTracks).toHaveLength(1);
  });

  it('treats a stored track with invalid duration as an embedded metadata repair target', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'custom-cache');
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const [file] = makeFiles(root, 1);
    writeFileSync(file.path, 'audio');

    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore(
      coverStateMap([file], (track) =>
        coverState(track, {
          duration: 0,
          coverSource: 'embedded',
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const status = await runStoredQueue(
      store,
      new ThrowingScanner(),
      metadataReader,
      new CapturingCoverExtractor(),
      cacheRoot,
      folder,
      { mode: 'embedded-tags-missing-cover' },
    );

    expect(status.status).toBe('completed');
    expect(status.totalFiles).toBe(1);
    expect(metadataReader.paths).toEqual([resolve(file.path)]);
    expect(store.upsertedTracks).toHaveLength(1);
  });

  it('finishes stored missing-cover rescans without regrouping when there are no targets', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'custom-cache');
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const [file] = makeFiles(root, 1);
    writeFileSync(file.path, 'audio');

    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore(
      coverStateMap([file], (track) =>
        coverState(track, {
          coverSource: 'embedded',
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const status = await runStoredQueue(
      store,
      new ThrowingScanner(),
      metadataReader,
      new CapturingCoverExtractor(),
      cacheRoot,
      folder,
      { mode: 'embedded-tags-missing-cover' },
    );

    expect(status.status).toBe('completed');
    expect(status.totalFiles).toBe(0);
    expect(metadataReader.paths).toEqual([]);
    expect(store.upsertedTracks).toEqual([]);
    expect(store.refreshAlbumsCalls).toBe(0);
    expect(store.refreshArtistsCalls).toBe(0);
  });

  it('keeps scanning when one directory is inaccessible and does not mark tracks under it missing', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    const cacheRoot = join(root, 'custom-cache');
    const inaccessibleDirectory = join(folder.path, 'locked');
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const keptFile = { path: join(folder.path, 'kept.flac'), sizeBytes: 10, mtimeMs: 1 };
    const blockedFile = { path: join(inaccessibleDirectory, 'blocked.flac'), sizeBytes: 10, mtimeMs: 1 };
    const store = new FakeStore(
      coverStateMap([keptFile, blockedFile], (file) =>
        coverState(file, {
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const status = await runQueue(
      store,
      new RecoverableErrorScanner([keptFile], inaccessibleDirectory),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      cacheRoot,
      folder,
    );

    expect(status.status).toBe('completed');
    expect(status.errorCount).toBe(1);
    expect(status.errors[0]).toContain('scanner: directory');
    expect(status.removedTracks).toBe(0);
    expect(store.missingPaths).toEqual([]);
  });

  it('does not mark any tracks missing when the root scan directory is inaccessible', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    const existingFile = { path: join(folder.path, 'existing.flac'), sizeBytes: 10, mtimeMs: 1 };
    const store = new FakeStore(coverStateMap([existingFile], (file) => coverState(file)));

    const status = await runQueue(
      store,
      new RecoverableErrorScanner([], folder.path),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      folder,
    );

    expect(status.status).toBe('completed');
    expect(status.errorCount).toBe(1);
    expect(status.removedTracks).toBe(0);
    expect(store.missingPaths).toEqual([]);
  });

  it('does not mark a track missing when its file stat failed during discovery', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    const statFailedFile = { path: join(folder.path, 'locked.flac'), sizeBytes: 10, mtimeMs: 1 };
    const store = new FakeStore(coverStateMap([statFailedFile], (file) => coverState(file)));

    const status = await runQueue(
      store,
      new RecoverableErrorScanner([], statFailedFile.path, 'file_stat'),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      folder,
    );

    expect(status.status).toBe('completed');
    expect(status.errorCount).toBe(1);
    expect(status.errors[0]).toContain('scanner: file_stat');
    expect(status.removedTracks).toBe(0);
    expect(store.missingPaths).toEqual([]);
  });

  it('does not keep embedded cover buffers in track writes while preserving embeddedCoverStatus', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'user-selected-cache');
    const embeddedCover = new Uint8Array([1, 2, 3, 4]);
    const coverExtractor = new CapturingCoverExtractor();
    const store = new FakeStore();

    const status = await runQueue(
      store,
      new FakeScanner(makeFiles(root, 1)),
      new FakeMetadataReader(metadataResult(embeddedCover)),
      coverExtractor,
      cacheRoot,
      baseFolder(root),
    );

    expect(status.status).toBe('completed');
    expect(coverExtractor.sawEmbeddedCover).toEqual([true]);
    expect(coverExtractor.cacheRoots).toEqual([cacheRoot]);
    expect(store.upsertedTracks).toHaveLength(1);
    expect('embeddedCover' in store.upsertedTracks[0]).toBe(false);
    expect(store.upsertedTracks[0].embeddedCoverStatus).toBe('present');
  });

  it('uses an updated custom cover cache directory for later scans', async () => {
    const root = makeTempRoot();
    const initialCacheRoot = join(root, 'initial-cache');
    const updatedCacheRoot = join(root, 'updated-cache');
    const coverExtractor = new CapturingCoverExtractor();
    const store = new FakeStore();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner(makeFiles(root, 1)),
      new FakeMetadataReader(),
      coverExtractor,
      {} as AlbumService,
      { coverCacheDir: initialCacheRoot },
    );

    queue.updateCoverCacheDir(updatedCacheRoot);
    const job = queue.scanFolder(baseFolder(root));
    await queue.waitForIdle(job.id);

    expect(coverExtractor.cacheRoots).toEqual([updatedCacheRoot]);
  });

  it('keeps scan job error JSON bounded while preserving total error count', async () => {
    const root = makeTempRoot();
    const noisyMetadata = {
      ...metadataResult(),
      warnings: Array.from({ length: 250 }, (_, index) => `warning-${index}`),
    };
    const store = new FakeStore();

    const status = await runQueue(
      store,
      new FakeScanner(makeFiles(root, 1)),
      new FakeMetadataReader(noisyMetadata),
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      baseFolder(root),
    );

    expect(status.errorCount).toBe(250);
    expect(status.errors).toHaveLength(200);
    expect(status.errors[0]).toBe('[summary] metadata: 250 issue(s)');
  });

  it('keeps a fallback track row when embedded metadata parsing fails', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    const filePath = join(folder.path, 'broken-file.flac');
    const store = new FakeStore();
    const metadataReader = new ThrowingMetadataReader();

    const status = await runQueue(
      store,
      new FakeScanner([{ path: filePath, sizeBytes: 10, mtimeMs: 1 }]),
      metadataReader,
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      folder,
    );

    expect(status.status).toBe('completed');
    expect(status.addedTracks).toBe(1);
    expect(status.errorCount).toBeGreaterThanOrEqual(1);
    expect(status.errors.some((error) => error.includes('metadata boom'))).toBe(true);
    expect(store.upsertedTracks[0]).toMatchObject({
      path: filePath,
      title: 'broken file',
      artist: 'Unknown Artist',
      album: 'music',
      metadataStatus: 'fallback',
      embeddedMetadataStatus: 'error',
      embeddedCoverStatus: 'missing',
    });
    expect(store.upsertedTracks[0]?.errors).toEqual(['metadata boom']);
  });

  it('flushes a final failed state when scanning fails', async () => {
    const root = makeTempRoot();
    const store = new FakeStore();

    const status = await runQueue(
      store,
      new ThrowingScanner(),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      baseFolder(root),
    );

    expect(status.status).toBe('failed');
    expect(status.phase).toBe('failed');
    expect(status.finishedAt).toBeTruthy();
    expect(status.errors[0]).toContain('scanner boom');
  });

  it('flushes a final cancelled state when cancellation is observed', async () => {
    const root = makeTempRoot();
    const store = new FakeStore();
    store.cancelled = true;

    const status = await runQueue(
      store,
      new FakeScanner(makeFiles(root, 1)),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      baseFolder(root),
    );

    expect(status.status).toBe('cancelled');
    expect(status.phase).toBe('cancelled');
    expect(status.finishedAt).toBeTruthy();
  });
});

describe('ScanJobQueue local path rescans', () => {
  it('only processes provided paths without scanning the whole folder', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const requestedPath = join(folder.path, 'requested.flac');
    const otherPath = join(folder.path, 'other.flac');
    writeFileSync(requestedPath, 'requested');
    writeFileSync(otherPath, 'other');
    const scanner = new FakeScanner([{ path: otherPath, sizeBytes: 5, mtimeMs: 1 }]);
    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore();

    const status = await runPathsQueue(
      store,
      scanner,
      metadataReader,
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      folder,
      [requestedPath],
    );

    expect(status.status).toBe('completed');
    expect(status.totalFiles).toBe(1);
    expect(status.addedTracks).toBe(1);
    expect(scanner.calls).toBe(0);
    expect(metadataReader.paths).toEqual([requestedPath]);
    expect(store.upsertedTracks.map((track) => track.path)).toEqual([requestedPath]);
  });

  it('does not mark missing tracks during a local path rescan', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const keptPath = join(folder.path, 'kept.flac');
    const omittedPath = join(folder.path, 'omitted.flac');
    writeFileSync(keptPath, 'kept');
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const keptFile = { path: keptPath, sizeBytes: 4, mtimeMs: Math.round(statMtimeMs(keptPath)) };
    const omittedFile = { path: omittedPath, sizeBytes: 10, mtimeMs: 1 };
    const store = new FakeStore(
      coverStateMap([keptFile, omittedFile], (file) =>
        coverState(file, {
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const status = await runPathsQueue(
      store,
      new FakeScanner([]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      cacheRoot,
      folder,
      [keptPath],
    );

    expect(status.removedTracks).toBe(0);
    expect(store.markMissingCalls).toBe(0);
    expect(store.missingPaths).toEqual([]);
    expect(store.finishFolderScanCalls).toBe(0);
  });

  it('can defer grouping refresh for live local path rescans', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'live.flac');
    writeFileSync(filePath, 'live');
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const store = new FakeStore();

    await runPathsQueue(
      store,
      new FakeScanner([]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      cacheRoot,
      folder,
      [filePath],
      { deferGroupingRefresh: true },
    );

    expect(store.upsertedTracks.map((track) => track.path)).toEqual([filePath]);
    expect(store.refreshAlbumsCalls).toBe(0);
    expect(store.refreshArtistsCalls).toBe(0);
  });

  it('can skip deferred full grouping refresh for watcher local path rescans', async () => {
    vi.useFakeTimers();
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'watcher-batch.flac');
    writeFileSync(filePath, 'watcher-batch');
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const store = new FakeStore();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      { coverCacheDir: cacheRoot },
    );

    const job = queue.scanPaths(folder, [filePath], { deferGroupingRefresh: true, skipDeferredGroupingRefresh: true });
    await queue.waitForIdle(job.id);
    await vi.advanceTimersByTimeAsync(2000);

    expect(store.upsertedTracks.map((track) => track.path)).toEqual([filePath]);
    expect(store.seededAlbumTrackIds.flat()).toHaveLength(1);
    expect(store.refreshAlbumsCalls).toBe(0);
    expect(store.refreshArtistsCalls).toBe(0);
    queue.dispose();
  });

  it('skips unchanged local files with complete cover cache', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'cached.flac');
    writeFileSync(filePath, 'cached');
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const file = { path: filePath, sizeBytes: 6, mtimeMs: Math.round(statMtimeMs(filePath)) };
    const metadataReader = new FakeMetadataReader();
    const coverExtractor = new CapturingCoverExtractor();
    const store = new FakeStore(
      coverStateMap([file], (item) =>
        coverState(item, {
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const status = await runPathsQueue(store, new FakeScanner([]), metadataReader, coverExtractor, cacheRoot, folder, [filePath]);

    expect(status.skippedFiles).toBe(1);
    expect(metadataReader.paths).toEqual([]);
    expect(coverExtractor.cacheRoots).toEqual([]);
    expect(store.upsertedTracks).toEqual([]);
  });

  it('rereads unchanged placeholder tracks created by watcher preview', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'previewed.flac');
    writeFileSync(filePath, 'previewed');
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const file = { path: filePath, sizeBytes: 9, mtimeMs: Math.round(statMtimeMs(filePath)) };
    const metadataReader = new FakeMetadataReader();
    const coverExtractor = new CapturingCoverExtractor();
    const store = new FakeStore(
      coverStateMap([file], (item) =>
        coverState(item, {
          metadataStatus: 'fallback',
          embeddedMetadataStatus: 'pending',
          embeddedCoverStatus: 'pending',
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
        }),
      ),
    );

    const status = await runPathsQueue(store, new FakeScanner([]), metadataReader, coverExtractor, cacheRoot, folder, [filePath]);

    expect(status.updatedTracks).toBe(1);
    expect(metadataReader.paths).toEqual([filePath]);
    expect(store.upsertedTracks[0]).toMatchObject({
      path: filePath,
      title: 'Embedded Title',
      metadataStatus: 'ok',
      embeddedMetadataStatus: 'present',
    });
  });

  it('adds new local files through metadata and cover workers', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'new-song.wav');
    writeFileSync(filePath, 'new-song');
    const metadataReader = new FakeMetadataReader();
    const coverExtractor = new CapturingCoverExtractor();
    const store = new FakeStore();

    const status = await runPathsQueue(
      store,
      new FakeScanner([]),
      metadataReader,
      coverExtractor,
      join(root, 'custom-cache'),
      folder,
      [filePath],
    );

    expect(status.addedTracks).toBe(1);
    expect(metadataReader.paths).toEqual([filePath]);
    expect(coverExtractor.cacheRoots).toHaveLength(1);
    expect(store.upsertedTracks[0]?.path).toBe(filePath);
  });

  it('refreshes changed local files when size or mtime differs', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'changed.flac');
    writeFileSync(filePath, 'changed-now');
    const currentFile = { path: filePath, sizeBytes: 11, mtimeMs: Math.round(statMtimeMs(filePath)) };
    const previousFile = { ...currentFile, sizeBytes: 1 };
    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore(coverStateMap([previousFile], (item) => coverState(item)));

    const status = await runPathsQueue(
      store,
      new FakeScanner([]),
      metadataReader,
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      folder,
      [filePath],
    );

    expect(status.updatedTracks).toBe(1);
    expect(metadataReader.paths).toEqual([filePath]);
    expect(store.upsertedTracks[0]?.id).toBe(store.getTrackCacheStatesByFolder().get(filePath)?.id);
  });

  it('ignores non-audio, temporary, outside, and duplicate paths', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const outsideRoot = join(root, 'outside');
    mkdirSync(outsideRoot, { recursive: true });
    const validPath = join(folder.path, 'valid.mp3');
    const duplicatePath = join(folder.path, '.', 'valid.mp3');
    const textPath = join(folder.path, 'notes.txt');
    const tempPath = join(folder.path, 'song.flac.tmp');
    const hiddenPath = join(folder.path, '.hidden.flac');
    const outsidePath = join(outsideRoot, 'outside.flac');
    for (const filePath of [validPath, textPath, tempPath, hiddenPath, outsidePath]) {
      writeFileSync(filePath, 'x');
    }
    const metadataReader = new FakeMetadataReader();
    const store = new FakeStore();

    const status = await runPathsQueue(
      store,
      new FakeScanner([]),
      metadataReader,
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      folder,
      [validPath, duplicatePath, textPath, tempPath, hiddenPath, outsidePath, join(folder.path, 'missing.flac')],
    );

    expect(status.totalFiles).toBe(1);
    expect(status.addedTracks).toBe(1);
    expect(metadataReader.paths).toEqual([validPath]);
    expect(store.upsertedTracks.map((track) => track.path)).toEqual([validPath]);
  });

  it('rejects overly large local rescan batches before creating a job', () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    const store = new FakeStore();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      { coverCacheDir: join(root, 'custom-cache') },
    );

    expect(() => queue.scanPaths(folder, Array.from({ length: 1001 }, (_, index) => join(folder.path, `track-${index}.flac`)))).toThrow(
      /Too many local rescan paths/u,
    );
    expect(store.status).toBeNull();
  });

  it('keeps cancellation semantics for local path rescans', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'cancel.flac');
    writeFileSync(filePath, 'cancel');
    const store = new FakeStore();
    store.cancelled = true;

    const status = await runPathsQueue(
      store,
      new FakeScanner([]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      join(root, 'custom-cache'),
      folder,
      [filePath],
    );

    expect(status.status).toBe('cancelled');
    expect(status.phase).toBe('cancelled');
    expect(store.upsertedTracks).toEqual([]);
  });

  it('recovers from a scan guard after database health fails at the end of a scan', async () => {
    process.env.ECHO_SYNC_SCAN_HEALTH_CHECK = '1';
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'guard.flac');
    writeFileSync(filePath, 'guard');
    const store = new FakeStore();
    const guard = { id: 'scan-guard-1' };
    const recoverDatabaseFromScanGuard = vi.fn();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        createDatabaseScanGuard: () => guard,
        checkDatabaseHealth: () => {
          throw new Error('database disk image is malformed');
        },
        recoverDatabaseFromScanGuard,
      },
    );

    const job = queue.scanPaths(folder, [filePath]);
    await queue.waitForIdle(job.id);

    expect(store.getScanJob()?.status).toBe('failed');
    expect(recoverDatabaseFromScanGuard).toHaveBeenCalledWith(
      guard,
      expect.objectContaining({ id: job.id, status: 'failed' }),
      expect.objectContaining({ message: 'database disk image is malformed' }),
    );
  });

  it('writes identity observation for changed files without changing scan semantics', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'identity.flac');
    writeFileSync(filePath, 'identity');
    const store = new FakeStore();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        fileIdentityService: {
          observe: async () => {
            await new Promise((resolve) => setImmediate(resolve));
            return identityObservation({ quickHash: 'b'.repeat(64) });
          },
        },
      },
    );

    const job = queue.scanPaths(folder, [filePath]);
    await queue.waitForIdle(job.id);

    expect(store.getScanJob()?.status).toBe('completed');
    expect(store.upsertedTracks[0]).toMatchObject({
      fileIdentity: 'dev:1:ino:2',
      quickHash: 'b'.repeat(64),
      identityStatus: 'ok',
    });
  });

  it('backfills identity for unchanged files without reading metadata or cover', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'unchanged.flac');
    writeFileSync(filePath, 'cached');
    const cacheRoot = join(root, 'custom-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const cachedCover = join(cacheRoot, 'cached.webp');
    writeFileSync(cachedCover, 'cached');
    const file = { path: filePath, sizeBytes: 6, mtimeMs: Math.round(statMtimeMs(filePath)) };
    const metadataReader = new FakeMetadataReader();
    const coverExtractor = new CapturingCoverExtractor();
    const store = new FakeStore(
      coverStateMap([file], (item) =>
        coverState(item, {
          thumbPath: cachedCover,
          albumPath: cachedCover,
          largePath: cachedCover,
          originalRef: cachedCover,
          quickHash: null,
          identityStatus: null,
        }),
      ),
    );
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([]),
      metadataReader,
      coverExtractor,
      {} as AlbumService,
      {
        coverCacheDir: cacheRoot,
        fileIdentityService: { observe: () => identityObservation({ quickHash: 'c'.repeat(64) }) } as never,
      },
    );

    const job = queue.scanPaths(folder, [filePath]);
    await queue.waitForIdle(job.id);

    expect(store.getScanJob()?.skippedFiles).toBe(1);
    expect(metadataReader.paths).toEqual([]);
    expect(coverExtractor.cacheRoots).toEqual([]);
    expect(store.identityUpdates).toHaveLength(1);
    expect(store.identityUpdates[0].identity.quickHash).toBe('c'.repeat(64));
  });

  it('identity observation errors do not fail scan jobs', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'identity-error.flac');
    writeFileSync(filePath, 'identity-error');
    const store = new FakeStore();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        fileIdentityService: {
          observe: () => {
            throw new Error('identity boom');
          },
        } as never,
      },
    );

    const job = queue.scanPaths(folder, [filePath]);
    await queue.waitForIdle(job.id);

    expect(store.getScanJob()?.status).toBe('completed');
    expect(store.upsertedTracks[0]).toMatchObject({
      identityStatus: 'error',
      identityError: 'identity boom',
    });
  });

  it('unsupported identity observations do not fail scans', async () => {
    const root = makeTempRoot();
    const folder = baseFolder(root);
    mkdirSync(folder.path, { recursive: true });
    const filePath = join(folder.path, 'identity-unsupported.flac');
    writeFileSync(filePath, 'identity-unsupported');
    const store = new FakeStore();
    const queue = new ScanJobQueue(
      store as unknown as LibraryStore,
      new FakeScanner([]),
      new FakeMetadataReader(),
      new CapturingCoverExtractor(),
      {} as AlbumService,
      {
        coverCacheDir: join(root, 'custom-cache'),
        fileIdentityService: {
          observe: () =>
            identityObservation({
              fileIdentity: null,
              fileIdentitySource: 'unsupported',
              identityStatus: 'partial',
              identityError: 'unsupported',
            }),
        } as never,
      },
    );

    const job = queue.scanPaths(folder, [filePath]);
    await queue.waitForIdle(job.id);

    expect(store.getScanJob()?.status).toBe('completed');
    expect(store.upsertedTracks[0]).toMatchObject({
      fileIdentity: null,
      fileIdentitySource: 'unsupported',
      identityStatus: 'partial',
    });
  });
});
