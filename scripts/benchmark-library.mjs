import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { pinyin } from 'pinyin-pro';

const SQLITE_RUNTIME_PRAGMA_PROFILE = 'safe-performance-v1';
const SQLITE_RUNTIME_PRAGMAS = [
  'busy_timeout = 5000',
  'journal_mode = WAL',
  'synchronous = FULL',
  'cache_size = -32768',
  'temp_store = MEMORY',
  'mmap_size = 268435456',
];

const applyRuntimePragmas = (database) => {
  for (const pragma of SQLITE_RUNTIME_PRAGMAS) {
    database.pragma(pragma);
  }
};

const schemaSql = `
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scan_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE covers (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_hash TEXT,
  mime_type TEXT,
  thumb_path TEXT,
  album_path TEXT,
  large_path TEXT,
  original_ref TEXT,
  cache_version INTEGER,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  errors_json TEXT NOT NULL DEFAULT '[]',
  cover_thumb TEXT,
  cover_large TEXT,
  cover_original TEXT,
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
  album_artist TEXT NOT NULL,
  track_no INTEGER,
  disc_no INTEGER,
  year INTEGER,
  genre TEXT,
  duration REAL NOT NULL DEFAULT 0,
  codec TEXT,
  sample_rate INTEGER,
  bit_depth INTEGER,
  bitrate INTEGER,
  search_terms TEXT NOT NULL DEFAULT '',
  cover_id TEXT,
  metadata_status TEXT NOT NULL DEFAULT 'ok',
  field_sources_json TEXT NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  album_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  album_artist TEXT NOT NULL,
  year INTEGER,
  cover_id TEXT,
  track_count INTEGER NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE album_tracks (
  album_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  disc_no INTEGER,
  track_no INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, track_id)
);

CREATE INDEX idx_tracks_path ON tracks(path);
CREATE INDEX idx_tracks_title ON tracks(title);
CREATE INDEX idx_tracks_artist ON tracks(artist);
CREATE INDEX idx_tracks_album ON tracks(album);
CREATE INDEX idx_albums_album_key ON albums(album_key);
CREATE INDEX idx_album_tracks_album_id ON album_tracks(album_id);
CREATE INDEX idx_album_tracks_track_id ON album_tracks(track_id);
CREATE INDEX idx_covers_id ON covers(id);
CREATE INDEX idx_covers_source_hash ON covers(source_hash);

CREATE VIRTUAL TABLE tracks_fts USING fts5(
  title,
  artist,
  album,
  album_artist,
  genre,
  path,
  search_terms,
  tokenize = 'unicode61'
);

CREATE TRIGGER tracks_fts_after_insert
AFTER INSERT ON tracks
BEGIN
  INSERT INTO tracks_fts(rowid, title, artist, album, album_artist, genre, path, search_terms)
  VALUES (new.rowid, new.title, new.artist, new.album, new.album_artist, COALESCE(new.genre, ''), new.path, new.search_terms);
END;
`;

const nowIso = () => new Date().toISOString();
const searchSeparatorPattern = /[\s!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~_-]+/u;
const cjkRunPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const hanRunPattern = /\p{Script=Han}+/gu;

const addSearchText = (terms, value) => {
  const normalized = String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
  if (!normalized) {
    return;
  }

  terms.add(normalized);
  const parts = normalized.split(searchSeparatorPattern).filter(Boolean);
  for (const part of parts) {
    terms.add(part);
  }
  if (parts.length > 1) {
    terms.add(parts.join(''));
  }

  for (const match of normalized.matchAll(cjkRunPattern)) {
    const chars = Array.from(match[0]);
    for (let start = 0; start < chars.length; start += 1) {
      for (let length = 1; length <= 3 && start + length <= chars.length; length += 1) {
        terms.add(chars.slice(start, start + length).join(''));
      }
    }
  }

  for (const match of normalized.matchAll(hanRunPattern)) {
    const syllables = pinyin(match[0], { toneType: 'none', type: 'array' }).map((item) => String(item).toLocaleLowerCase());
    const initials = syllables.map((syllable) => syllable[0] ?? '').join('');
    terms.add(syllables.join(''));
    terms.add(initials);
    for (let start = 0; start < syllables.length; start += 1) {
      for (let length = 1; length <= 6 && start + length <= syllables.length; length += 1) {
        terms.add(syllables.slice(start, start + length).join(''));
      }
      for (let length = 1; length <= 12 && start + length <= initials.length; length += 1) {
        terms.add(initials.slice(start, start + length));
      }
    }
  }
};

const buildBenchmarkSearchTerms = (track) => {
  const terms = new Set();
  addSearchText(terms, track.title);
  addSearchText(terms, track.artist);
  addSearchText(terms, track.album);
  addSearchText(terms, track.albumArtist);
  addSearchText(terms, track.genre);
  addSearchText(terms, track.path);
  return Array.from(terms).join(' ');
};

export const createFakeTrack = (index, folderId = 'folder-1', options = {}) => {
  const tracksPerAlbum = options.tracksPerAlbum ?? 10;
  const albumIndex = Math.floor((index - 1) / tracksPerAlbum) + 1;
  const artistIndex = albumIndex % 250;
  const path = resolve(`D:/FakeLibrary/Album ${albumIndex}/Track ${index}.flac`);
  const title = index === 1 ? '会魔法的老人' : `Track ${index}`;
  const artist = `Artist ${artistIndex}`;
  const album = `Album ${albumIndex}`;
  const albumArtist = `Album Artist ${artistIndex}`;
  const genre = 'Benchmark';
  const track = {
    title,
    artist,
    album,
    albumArtist,
    genre,
    path,
  };

  return {
    id: `track-${index}`,
    path,
    folderId,
    sizeBytes: 4_000_000 + index,
    mtimeMs: 1_700_000_000_000 + index,
    title,
    artist,
    album,
    albumArtist,
    trackNo: (index % 10) + 1,
    discNo: 1,
    year: 2020 + (albumIndex % 7),
    genre,
    duration: 180 + (index % 90),
    codec: index % 3 === 0 ? 'FLAC' : 'MP3',
    sampleRate: index % 4 === 0 ? 96000 : 44100,
    bitDepth: index % 3 === 0 ? 24 : 16,
    bitrate: 900000,
    coverId: options.withCoverCache === false ? null : `cover-${albumIndex}`,
    metadataStatus: 'ok',
    fieldSources: JSON.stringify({ title: 'embedded', artist: 'embedded', album: 'embedded' }),
    searchTerms: buildBenchmarkSearchTerms(track),
  };
};

export const generateFakeTracks = (count, options = {}) => Array.from({ length: count }, (_, index) => createFakeTrack(index + 1, 'folder-1', options));

const insertTracks = (database, tracks, options = {}) => {
  const insertFolder = database.prepare(
    `INSERT INTO folders (id, path, name, status, enabled, last_scan_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCover = database.prepare(
    `INSERT INTO covers (
      id, source_type, source_hash, mime_type, thumb_path, album_path, large_path, original_ref,
      cache_version, warnings_json, errors_json, cover_thumb, cover_large, cover_original, created_at, updated_at
    ) VALUES (
      @id, @sourceType, @sourceHash, @mimeType, @thumbPath, @albumPath, @largePath, @originalRef,
      @cacheVersion, '[]', '[]', @thumbPath, @largePath, @originalRef, @createdAt, @updatedAt
    )`,
  );
  const insertTrack = database.prepare(
    `INSERT INTO tracks (
      id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
      track_no, disc_no, year, genre, duration, codec, sample_rate, bit_depth, bitrate,
      search_terms, cover_id, metadata_status, field_sources_json, missing, created_at, updated_at
    ) VALUES (
      @id, @path, @folderId, @sizeBytes, @mtimeMs, @title, @artist, @album, @albumArtist,
      @trackNo, @discNo, @year, @genre, @duration, @codec, @sampleRate, @bitDepth, @bitrate,
      @searchTerms, @coverId, @metadataStatus, @fieldSources, 0, @createdAt, @updatedAt
    )`,
  );
  const timestamp = nowIso();

  database.transaction(() => {
    insertFolder.run('folder-1', resolve('D:/FakeLibrary'), 'FakeLibrary', 'active', 1, null, timestamp, timestamp);

    if (options.withCoverCache !== false) {
      const coverIds = new Set(tracks.map((track) => track.coverId).filter(Boolean));

      for (const coverId of coverIds) {
        const albumIndex = String(coverId).replace(/^cover-/, '');
        insertCover.run({
          id: coverId,
          sourceType: 'embedded',
          sourceHash: `hash-${albumIndex}`,
          mimeType: 'image/webp',
          thumbPath: resolve(`D:/FakeLibrary/.echo-cover-cache/${albumIndex}/thumb.webp`),
          albumPath: resolve(`D:/FakeLibrary/.echo-cover-cache/${albumIndex}/album.webp`),
          largePath: resolve(`D:/FakeLibrary/.echo-cover-cache/${albumIndex}/large.webp`),
          originalRef: resolve(`D:/FakeLibrary/.echo-cover-cache/${albumIndex}/original.jpg`),
          cacheVersion: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }

    for (const track of tracks) {
      insertTrack.run({
        ...track,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  })();
};

const refreshAlbums = (database) => {
  const tracks = database
    .prepare(
      `SELECT id, artist, album, album_artist, year, duration, cover_id, disc_no, track_no
       FROM tracks
       WHERE missing = 0
       ORDER BY album_artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no, title COLLATE NOCASE`,
    )
    .all();
  const albums = new Map();
  const links = [];

  tracks.forEach((track, index) => {
    const albumKey = `${String(track.album_artist).toLowerCase()}::${String(track.album).toLowerCase()}::${track.year ?? ''}`;
    const album =
      albums.get(albumKey) ??
      {
        id: `album-${albums.size + 1}`,
        albumKey,
        title: track.album,
        albumArtist: track.album_artist,
        year: track.year,
        coverId: track.cover_id,
        trackCount: 0,
        duration: 0,
      };

    album.trackCount += 1;
    album.duration += Number(track.duration ?? 0);
    albums.set(albumKey, album);
    links.push({
      albumId: album.id,
      trackId: track.id,
      discNo: track.disc_no,
      trackNo: track.track_no,
      position: index,
    });
  });

  const timestamp = nowIso();
  const insertAlbum = database.prepare(
    `INSERT INTO albums (id, album_key, title, album_artist, year, cover_id, track_count, duration, created_at, updated_at)
     VALUES (@id, @albumKey, @title, @albumArtist, @year, @coverId, @trackCount, @duration, @createdAt, @updatedAt)`,
  );
  const insertLink = database.prepare(
    'INSERT INTO album_tracks (album_id, track_id, disc_no, track_no, position) VALUES (@albumId, @trackId, @discNo, @trackNo, @position)',
  );

  database.transaction(() => {
    database.prepare('DELETE FROM album_tracks').run();
    database.prepare('DELETE FROM albums').run();

    for (const album of albums.values()) {
      insertAlbum.run({
        ...album,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    for (const link of links) {
      insertLink.run(link);
    }
  })();

  return albums.size;
};

const measure = (work) => {
  const startedAt = performance.now();
  const result = work();
  return {
    result,
    durationMs: performance.now() - startedAt,
  };
};

export const runBenchmark = (trackCount, options = {}) => {
  const root = options.root ?? join(tmpdir(), `echo-next-library-bench-${trackCount}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  const databasePath = join(root, 'library.sqlite');
  const database = new Database(databasePath);
  applyRuntimePragmas(database);
  database.exec(schemaSql);

  try {
    const tracks = generateFakeTracks(trackCount, {
      tracksPerAlbum: options.tracksPerAlbum,
      withCoverCache: options.withCoverCache,
    });
    const insert = measure(() => insertTracks(database, tracks, { withCoverCache: options.withCoverCache }));
    const grouping = measure(() => refreshAlbums(database));
    const getTracksPage1 = measure(() =>
      database
        .prepare(
          `SELECT id, path, title, artist, album, album_artist, duration, codec, sample_rate, bit_depth, bitrate
           FROM tracks
           WHERE missing = 0
           ORDER BY title COLLATE NOCASE, artist COLLATE NOCASE
           LIMIT 100 OFFSET 0`,
        )
        .all(),
    );
    const getAlbumsPage1 = measure(() =>
      database
        .prepare(
          `SELECT albums.id, albums.album_key, albums.title, albums.album_artist, albums.track_count, albums.duration,
             covers.album_path AS coverThumb
           FROM albums
           LEFT JOIN covers ON covers.id = albums.cover_id
           ORDER BY title COLLATE NOCASE, album_artist COLLATE NOCASE
           LIMIT 60 OFFSET 0`,
        )
        .all(),
    );
    const searchChinese = measure(() =>
      database
        .prepare(
          `SELECT tracks.id
           FROM tracks
           INNER JOIN tracks_fts ON tracks_fts.rowid = tracks.rowid
           WHERE tracks.missing = 0 AND tracks_fts MATCH ?
           LIMIT 100`,
        )
        .all('魔法*'),
    );
    const searchPinyin = measure(() =>
      database
        .prepare(
          `SELECT tracks.id
           FROM tracks
           INNER JOIN tracks_fts ON tracks_fts.rowid = tracks.rowid
           WHERE tracks.missing = 0 AND tracks_fts MATCH ?
           LIMIT 100`,
        )
        .all('mofa*'),
    );
    const getAlbumsPage10 = measure(() =>
      database
        .prepare(
          `SELECT albums.id, albums.album_key, albums.title, albums.album_artist, albums.track_count, albums.duration,
             covers.album_path AS coverThumb
           FROM albums
           LEFT JOIN covers ON covers.id = albums.cover_id
           ORDER BY title COLLATE NOCASE, album_artist COLLATE NOCASE
           LIMIT 60 OFFSET 540`,
        )
        .all(),
    );
    const albumsTotal = measure(() => database.prepare('SELECT COUNT(*) AS total FROM albums').get().total);
    const averageCoverThumbLength = getAlbumsPage1.result.length
      ? getAlbumsPage1.result.reduce((total, item) => total + String(item.coverThumb ?? '').length, 0) / getAlbumsPage1.result.length
      : 0;
    const getAlbumsPayload = JSON.stringify(getAlbumsPage1.result);
    const unchangedScanSkip = measure(() => {
      const fingerprints = new Map(tracks.map((track) => [track.path, `${track.sizeBytes}:${track.mtimeMs}`]));
      const rows = database.prepare('SELECT path, size_bytes, mtime_ms FROM tracks WHERE missing = 0').all();
      return rows.filter((row) => fingerprints.get(row.path) === `${row.size_bytes}:${row.mtime_ms}`).length;
    });
    const duplicateCoverLookup = measure(() => {
      const statement = database.prepare('SELECT id, source_type FROM covers WHERE source_hash = ?');
      let found = 0;

      for (const track of tracks) {
        const albumIndex = Math.floor((Number(track.id.replace('track-', '')) - 1) / (options.tracksPerAlbum ?? 10)) + 1;
        if (statement.get(`hash-${albumIndex}`)) {
          found += 1;
        }
      }

      return found;
    });
    const upsertCoverDuplicate = measure(() => {
      const select = database.prepare('SELECT id, source_type FROM covers WHERE source_hash = ?');
      const update = database.prepare(
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
      );
      const timestamp = nowIso();
      let updated = 0;

      database.transaction(() => {
        for (const coverId of new Set(tracks.map((track) => track.coverId).filter(Boolean))) {
          const albumIndex = String(coverId).replace(/^cover-/, '');
          const existing = select.get(`hash-${albumIndex}`);

          if (!existing) {
            continue;
          }

          const thumbPath = resolve(`D:/FakeLibrary/.echo-cover-cache/${albumIndex}/thumb.webp`);
          const albumPath = resolve(`D:/FakeLibrary/.echo-cover-cache/${albumIndex}/album.webp`);
          const largePath = resolve(`D:/FakeLibrary/.echo-cover-cache/${albumIndex}/large.webp`);
          const originalRef = resolve(`D:/FakeLibrary/.echo-cover-cache/${albumIndex}/original.jpg`);
          update.run(
            existing.source_type,
            'image/webp',
            thumbPath,
            albumPath,
            largePath,
            originalRef,
            1,
            '[]',
            '[]',
            thumbPath,
            largePath,
            originalRef,
            timestamp,
            existing.id,
          );
          updated += 1;
        }
      })();

      return updated;
    });
    const memory = process.memoryUsage();
    database.pragma('wal_checkpoint(TRUNCATE)');
    const databaseSizeBytes = statSync(databasePath).size;

    return {
      tracks: trackCount,
      scenario: options.scenario ?? 'tracks',
      sqlitePragmaProfile: SQLITE_RUNTIME_PRAGMA_PROFILE,
      sqlitePragmas: SQLITE_RUNTIME_PRAGMAS,
      albumsCount: grouping.result,
      insertDurationMs: insert.durationMs,
      groupingDurationMs: grouping.durationMs,
      getTracksPage1DurationMs: getTracksPage1.durationMs,
      getAlbumsPage1DurationMs: getAlbumsPage1.durationMs,
      getAlbumsPage10DurationMs: getAlbumsPage10.durationMs,
      searchChineseDurationMs: searchChinese.durationMs,
      searchChineseItemCount: searchChinese.result.length,
      searchPinyinDurationMs: searchPinyin.durationMs,
      searchPinyinItemCount: searchPinyin.result.length,
      albumsTotalDurationMs: albumsTotal.durationMs,
      albumsTotalCount: Number(albumsTotal.result ?? 0),
      getAlbumsPage1ItemCount: getAlbumsPage1.result.length,
      getAlbumsPage10ItemCount: getAlbumsPage10.result.length,
      averageCoverThumbLength,
      getAlbumsPage1PayloadBytes: Buffer.byteLength(getAlbumsPayload),
      getAlbumsReturnsForbiddenCoverPayload: /large|original|base64/i.test(getAlbumsPayload),
      unchangedScanSkipDurationMs: unchangedScanSkip.durationMs,
      unchangedScanSkipped: unchangedScanSkip.result,
      duplicateCoverLookupDurationMs: duplicateCoverLookup.durationMs,
      duplicateCoverLookupCount: duplicateCoverLookup.result,
      upsertCoverDuplicateDurationMs: upsertCoverDuplicate.durationMs,
      upsertCoverDuplicateCount: upsertCoverDuplicate.result,
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
      },
      databaseSizeBytes,
      databasePath,
    };
  } finally {
    database.close();

    if (options.cleanup !== false) {
      rmSync(root, { recursive: true, force: true });
    }
  }
};

export const runAlbumBenchmark = (albumCount, options = {}) =>
  runBenchmark(albumCount, {
    ...options,
    scenario: 'albums',
    tracksPerAlbum: 1,
    withCoverCache: true,
  });

const printResult = (result) => {
  console.log(`scenario: ${result.scenario}`);
  console.log(`sqlite pragma profile: ${result.sqlitePragmaProfile} (${result.sqlitePragmas.join('; ')})`);
  console.log(`tracks: ${result.tracks}`);
  console.log(`albums count: ${result.albumsCount}`);
  console.log(`insert duration: ${result.insertDurationMs.toFixed(2)} ms`);
  console.log(`grouping duration: ${result.groupingDurationMs.toFixed(2)} ms`);
  console.log(`getTracks first page duration: ${result.getTracksPage1DurationMs.toFixed(2)} ms`);
  console.log(`getAlbums first page duration: ${result.getAlbumsPage1DurationMs.toFixed(2)} ms`);
  console.log(`getAlbums page10 duration: ${result.getAlbumsPage10DurationMs.toFixed(2)} ms`);
  console.log(`search 魔法 duration: ${result.searchChineseDurationMs.toFixed(2)} ms (${result.searchChineseItemCount} hits)`);
  console.log(`search mofa duration: ${result.searchPinyinDurationMs.toFixed(2)} ms (${result.searchPinyinItemCount} hits)`);
  console.log(`albums total count: ${result.albumsTotalCount} in ${result.albumsTotalDurationMs.toFixed(2)} ms`);
  console.log(`payload item count page1 / page10: ${result.getAlbumsPage1ItemCount} / ${result.getAlbumsPage10ItemCount}`);
  console.log(`average coverThumb string length: ${result.averageCoverThumbLength.toFixed(2)}`);
  console.log(`getAlbums page1 payload bytes: ${result.getAlbumsPage1PayloadBytes}`);
  console.log(`getAlbums returns large/original/base64: ${result.getAlbumsReturnsForbiddenCoverPayload}`);
  console.log(`unchanged scan checking/cache duration: ${result.unchangedScanSkipDurationMs.toFixed(2)} ms (${result.unchangedScanSkipped} skipped)`);
  console.log(`duplicate cover lookup duration: ${result.duplicateCoverLookupDurationMs.toFixed(2)} ms (${result.duplicateCoverLookupCount} hits)`);
  console.log(`upsertCover duplicate duration: ${result.upsertCoverDuplicateDurationMs.toFixed(2)} ms (${result.upsertCoverDuplicateCount} updates)`);
  console.log(`memory rss/heapUsed: ${result.memory.rss} / ${result.memory.heapUsed}`);
  console.log(`database size: ${result.databaseSizeBytes}`);
  console.log('');
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  for (const count of [3000, 10000, 50000]) {
    printResult(runBenchmark(count));
  }

  for (const count of [3000, 10000]) {
    printResult(runAlbumBenchmark(count));
  }
}
