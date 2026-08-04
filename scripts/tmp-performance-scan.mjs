import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';

const counts = [100, 1000, 3000];
const audioExtensions = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg']);

const nowIso = () => new Date().toISOString();

const createSchema = (database) => {
  database.exec(`
    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      folder_id TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      cover_id TEXT,
      missing INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE covers (
      id TEXT PRIMARY KEY,
      source_hash TEXT NOT NULL,
      thumb_path TEXT NOT NULL,
      album_path TEXT NOT NULL,
      large_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_tracks_folder_path ON tracks(folder_id, path);
    CREATE INDEX idx_tracks_missing ON tracks(missing);
    CREATE INDEX idx_covers_source_hash ON covers(source_hash);
  `);
};

const walkAudioFiles = (root) => {
  const pending = [root];
  const files = [];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (audioExtensions.has(path.slice(path.lastIndexOf('.')).toLowerCase())) {
        const stat = statSync(path);
        files.push({
          path: resolve(path),
          sizeBytes: stat.size,
          mtimeMs: Math.round(stat.mtimeMs),
        });
      }
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
};

const createFakeLibrary = (root, count) => {
  mkdirSync(root, { recursive: true });

  for (let index = 1; index <= count; index += 1) {
    const album = Math.floor((index - 1) / 10) + 1;
    const dir = join(root, `Album ${String(album).padStart(4, '0')}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `Track ${String(index).padStart(5, '0')}.mp3`);
    writeFileSync(file, Buffer.alloc(1024 + (index % 4096), index % 255));
  }
};

const touchFirstFiles = (root, count) => {
  const files = walkAudioFiles(root).slice(0, count);
  const touchedAt = new Date(Date.now() + 120_000);

  files.forEach((file, index) => {
    writeFileSync(file.path, Buffer.alloc(file.sizeBytes + 17 + index, (index + 31) % 255));
    utimesSync(file.path, touchedAt, touchedAt);
  });
};

const deleteFirstFiles = (root, count) => {
  walkAudioFiles(root)
    .slice(0, count)
    .forEach((file) => unlinkSync(file.path));
};

const scan = (database, folderId, folderPath) => {
  const startedAt = performance.now();
  let processedFiles = 0;
  let skippedFiles = 0;
  let addedTracks = 0;
  let updatedTracks = 0;
  let removedTracks = 0;
  let coverCount = 0;
  let metadataReaderCalls = 0;
  let coverExtractorCalls = 0;
  const errors = [];
  const files = walkAudioFiles(folderPath);
  const timestamp = nowIso();
  const existingRows = database
    .prepare('SELECT id, path, size_bytes, mtime_ms FROM tracks WHERE folder_id = ? AND missing = 0')
    .all(folderId);
  const existingByPath = new Map(existingRows.map((row) => [resolve(row.path), row]));
  const seen = new Set(files.map((file) => resolve(file.path)));
  const upsertCover = database.prepare(
    `INSERT INTO covers (id, source_hash, thumb_path, album_path, large_path, created_at, updated_at)
     VALUES (@id, @sourceHash, @thumbPath, @albumPath, @largePath, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
  );
  const upsertTrack = database.prepare(
    `INSERT INTO tracks (id, path, folder_id, size_bytes, mtime_ms, title, artist, album, cover_id, missing, created_at, updated_at)
     VALUES (@id, @path, @folderId, @sizeBytes, @mtimeMs, @title, @artist, @album, @coverId, 0, @createdAt, @updatedAt)
     ON CONFLICT(path) DO UPDATE SET
       size_bytes = excluded.size_bytes,
       mtime_ms = excluded.mtime_ms,
       title = excluded.title,
       artist = excluded.artist,
       album = excluded.album,
       cover_id = excluded.cover_id,
       missing = 0,
       updated_at = excluded.updated_at`,
  );
  const markMissing = database.prepare('UPDATE tracks SET missing = 1, updated_at = ? WHERE folder_id = ? AND path = ? AND missing = 0');

  database.transaction(() => {
    for (const file of files) {
      const existing = existingByPath.get(resolve(file.path));

      if (existing && existing.size_bytes === file.sizeBytes && existing.mtime_ms === file.mtimeMs) {
        processedFiles += 1;
        skippedFiles += 1;
        continue;
      }

      metadataReaderCalls += 1;
      coverExtractorCalls += 1;
      coverCount += 1;

      const trackNumber = Number(file.path.match(/Track (\d+)/)?.[1] ?? processedFiles + 1);
      const albumNumber = Math.floor((trackNumber - 1) / 10) + 1;
      const coverId = `cover-${albumNumber}`;
      upsertCover.run({
        id: coverId,
        sourceHash: `hash-${albumNumber}`,
        thumbPath: join(folderPath, '.echo-cover-cache', coverId, 'thumb.webp'),
        albumPath: join(folderPath, '.echo-cover-cache', coverId, 'album.webp'),
        largePath: join(folderPath, '.echo-cover-cache', coverId, 'large.webp'),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      upsertTrack.run({
        id: existing?.id ?? `track-${trackNumber}`,
        path: file.path,
        folderId,
        sizeBytes: file.sizeBytes,
        mtimeMs: file.mtimeMs,
        title: `Track ${trackNumber}`,
        artist: `Artist ${albumNumber % 250}`,
        album: `Album ${albumNumber}`,
        coverId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      processedFiles += 1;
      if (existing) {
        updatedTracks += 1;
      } else {
        addedTracks += 1;
      }
    }

    for (const row of existingRows) {
      if (!seen.has(resolve(row.path))) {
        removedTracks += markMissing.run(timestamp, folderId, row.path).changes;
      }
    }
  })();

  const memory = process.memoryUsage();

  return {
    durationMs: performance.now() - startedAt,
    totalFiles: files.length,
    processedFiles,
    skippedFiles,
    addedTracks,
    updatedTracks,
    removedTracks,
    coverCount,
    errorCount: errors.length,
    metadataReaderCalls,
    coverExtractorCalls,
    memoryRss: memory.rss,
    memoryHeapUsed: memory.heapUsed,
  };
};

const runScenario = (trackCount) => {
  const root = join(tmpdir(), `echo-next-tmp-performance-scan-${trackCount}-${Date.now()}`);
  const libraryRoot = join(root, 'library');
  const databasePath = join(root, 'scan.sqlite');
  mkdirSync(root, { recursive: true });
  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  createSchema(database);

  try {
    createFakeLibrary(libraryRoot, trackCount);
    const timestamp = nowIso();
    database
      .prepare('INSERT INTO folders (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('folder-1', resolve(libraryRoot), 'library', timestamp, timestamp);

    const first = scan(database, 'folder-1', libraryRoot);
    const unchanged = scan(database, 'folder-1', libraryRoot);
    touchFirstFiles(libraryRoot, Math.min(10, trackCount));
    const changed = scan(database, 'folder-1', libraryRoot);
    deleteFirstFiles(libraryRoot, Math.min(10, trackCount));
    const deleted = scan(database, 'folder-1', libraryRoot);
    database.pragma('wal_checkpoint(TRUNCATE)');
    const databaseSizeBytes = statSync(databasePath).size;

    return {
      trackCount,
      databaseSizeBytes,
      first,
      unchanged,
      changed,
      deleted,
    };
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};

for (const count of counts) {
  console.log(JSON.stringify(runScenario(count)));
}
