import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryMoveCandidateService } from './LibraryMoveCandidateService';

const tempRoots: string[] = [];
const now = '2026-05-18T00:00:00.000Z';

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-move-candidates-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const createTestDatabase = (): EchoDatabase => {
  const root = makeTempRoot();
  const database = createDatabase(join(root, 'library.sqlite'));
  database
    .prepare(
      `INSERT INTO folders (id, path, name, status, enabled, created_at, updated_at)
       VALUES ('folder-1', ?, 'Music', 'active', 1, ?, ?)`,
    )
    .run(join(root, 'Music'), now, now);
  return database;
};

type TrackInput = {
  id: string;
  path?: string;
  missing?: boolean;
  fileIdentity?: string | null;
  fileIdentitySource?: string | null;
  quickHash?: string | null;
  quickHashVersion?: number | null;
  sizeBytes?: number;
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
};

const insertTrack = (database: EchoDatabase, input: TrackInput): void => {
  database
    .prepare(
      `INSERT INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
        duration, file_identity, file_identity_source, quick_hash, quick_hash_version,
        identity_status, identity_updated_at, identity_error, search_terms, field_sources_json,
        missing, created_at, updated_at
      ) VALUES (?, ?, 'folder-1', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, NULL, '', '{}', ?, ?, ?)`,
    )
    .run(
      input.id,
      input.path ?? `C:\\Music\\${input.id}.flac`,
      input.sizeBytes ?? 100,
      input.title ?? 'Song',
      input.artist ?? 'Artist',
      input.album ?? 'Album',
      input.artist ?? 'Artist',
      input.duration ?? 180,
      input.fileIdentity ?? null,
      input.fileIdentitySource ?? null,
      input.quickHash ?? null,
      input.quickHashVersion ?? null,
      now,
      input.missing === true ? 1 : 0,
      now,
      now,
    );
};

const getCandidates = (database: EchoDatabase) => new LibraryMoveCandidateService(database).getMoveCandidates();

const tableSnapshot = (database: EchoDatabase, tableName: string): unknown[] =>
  database.prepare(`SELECT * FROM ${tableName} ORDER BY id ASC`).all();

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('LibraryMoveCandidateService', () => {
  it('creates a high confidence candidate for matching trusted file_identity across missing old and active new tracks', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'old', missing: true, fileIdentity: 'dev:1:ino:2', fileIdentitySource: 'posix-dev-ino' });
    insertTrack(database, { id: 'new', fileIdentity: 'dev:1:ino:2', fileIdentitySource: 'posix-dev-ino' });

    const candidates = getCandidates(database);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      confidence: 'high',
      ambiguous: false,
      oldTrackId: 'old',
      newTrackId: 'new',
      fileIdentityMatched: true,
      quickHashMatched: false,
    });
    database.close();
  });

  it('creates a medium confidence candidate for matching quick_hash, size, close duration, and metadata', () => {
    const database = createTestDatabase();
    insertTrack(database, {
      id: 'old',
      missing: true,
      quickHash: 'hash-1',
      quickHashVersion: 1,
      sizeBytes: 123,
      duration: 200,
      title: 'Same Song',
      artist: 'Same Artist',
      album: 'Same Album',
    });
    insertTrack(database, {
      id: 'new',
      quickHash: 'hash-1',
      quickHashVersion: 1,
      sizeBytes: 123,
      duration: 200.8,
      title: 'Same Song',
      artist: 'Same Artist',
      album: 'Same Album',
    });

    const candidates = getCandidates(database);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      confidence: 'medium',
      quickHashMatched: true,
      sizeMatched: true,
      metadataMatched: true,
    });
    expect(candidates[0].durationDelta).toBeCloseTo(0.8);
    database.close();
  });

  it('does not create a quick_hash candidate when quick_hash_version differs', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'old', missing: true, quickHash: 'hash-1', quickHashVersion: 1 });
    insertTrack(database, { id: 'new', quickHash: 'hash-1', quickHashVersion: 2 });

    expect(getCandidates(database)).toEqual([]);
    database.close();
  });

  it('does not promote unsupported file_identity_source to high confidence', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'old', missing: true, fileIdentity: 'same-id', fileIdentitySource: 'unsupported' });
    insertTrack(database, { id: 'new', fileIdentity: 'same-id', fileIdentitySource: 'unsupported' });

    const candidates = getCandidates(database);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      confidence: 'low',
      fileIdentityMatched: true,
    });
    expect(candidates[0].reasonCodes).toContain('file_identity_untrusted_source');
    database.close();
  });

  it('marks many-to-one matches ambiguous and does not leave them high confidence', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'old-1', missing: true, fileIdentity: 'same-id', fileIdentitySource: 'posix-dev-ino' });
    insertTrack(database, { id: 'old-2', missing: true, fileIdentity: 'same-id', fileIdentitySource: 'posix-dev-ino' });
    insertTrack(database, { id: 'new', fileIdentity: 'same-id', fileIdentitySource: 'posix-dev-ino' });

    const candidates = getCandidates(database);

    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.ambiguous)).toBe(true);
    expect(candidates.every((candidate) => candidate.confidence !== 'high')).toBe(true);
    database.close();
  });

  it('does not create candidates between active tracks', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'first', fileIdentity: 'same-id', fileIdentitySource: 'posix-dev-ino' });
    insertTrack(database, { id: 'second', fileIdentity: 'same-id', fileIdentitySource: 'posix-dev-ino' });

    expect(getCandidates(database)).toEqual([]);
    database.close();
  });

  it('does not create candidates between missing tracks', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'old-1', missing: true, fileIdentity: 'same-id', fileIdentitySource: 'posix-dev-ino' });
    insertTrack(database, { id: 'old-2', missing: true, fileIdentity: 'same-id', fileIdentitySource: 'posix-dev-ino' });

    expect(getCandidates(database)).toEqual([]);
    database.close();
  });

  it('does not create a candidate for the same path', () => {
    const database = createTestDatabase();
    insertTrack(database, {
      id: 'old',
      path: 'C:\\Music\\same.flac',
      missing: true,
      fileIdentity: 'same-id',
      fileIdentitySource: 'posix-dev-ino',
    });
    database
      .prepare("UPDATE tracks SET missing = 0, id = 'new' WHERE id = 'old'")
      .run();

    expect(getCandidates(database)).toEqual([]);
    database.close();
  });

  it('caps candidates at 100', () => {
    const database = createTestDatabase();
    for (let index = 0; index < 120; index += 1) {
      insertTrack(database, {
        id: `old-${index}`,
        path: `C:\\Music\\old-${index}.flac`,
        missing: true,
        fileIdentity: `id-${index}`,
        fileIdentitySource: 'posix-dev-ino',
      });
      insertTrack(database, {
        id: `new-${index}`,
        path: `C:\\Music\\new-${index}.flac`,
        fileIdentity: `id-${index}`,
        fileIdentitySource: 'posix-dev-ino',
      });
    }

    expect(new LibraryMoveCandidateService(database).getMoveCandidates({ limit: 500 })).toHaveLength(100);
    database.close();
  });

  it('does not modify tracks.path or missing flags', () => {
    const database = createTestDatabase();
    insertTrack(database, {
      id: 'old',
      path: 'C:\\Music\\old.flac',
      missing: true,
      fileIdentity: 'same-id',
      fileIdentitySource: 'posix-dev-ino',
    });
    insertTrack(database, {
      id: 'new',
      path: 'C:\\Music\\new.flac',
      fileIdentity: 'same-id',
      fileIdentitySource: 'posix-dev-ino',
    });
    const before = database.prepare('SELECT id, path, missing FROM tracks ORDER BY id ASC').all();

    getCandidates(database);

    expect(database.prepare('SELECT id, path, missing FROM tracks ORDER BY id ASC').all()).toEqual(before);
    database.close();
  });

  it('does not modify playlists or playback_history', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'old', missing: true, fileIdentity: 'same-id', fileIdentitySource: 'posix-dev-ino' });
    insertTrack(database, { id: 'new', fileIdentity: 'same-id', fileIdentitySource: 'posix-dev-ino' });
    database
      .prepare(
        `INSERT INTO playlists (id, name, kind, source_provider, sort_mode, item_count, created_at, updated_at)
         VALUES ('playlist-1', 'Playlist', 'manual', 'local', 'manual', 1, ?, ?)`,
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO playlist_items (id, playlist_id, media_type, media_id, position, added_at, added_from)
         VALUES ('item-1', 'playlist-1', 'local', 'old', 0, ?, 'test')`,
      )
      .run(now);
    database
      .prepare(
        `INSERT INTO playback_history (
          id, track_id, track_path, title, artist, album, started_at, created_at
        ) VALUES ('history-1', 'old', 'C:\\Music\\old.flac', 'Song', 'Artist', 'Album', ?, ?)`,
      )
      .run(now, now);
    const playlistsBefore = tableSnapshot(database, 'playlists');
    const itemsBefore = tableSnapshot(database, 'playlist_items');
    const historyBefore = tableSnapshot(database, 'playback_history');

    getCandidates(database);

    expect(tableSnapshot(database, 'playlists')).toEqual(playlistsBefore);
    expect(tableSnapshot(database, 'playlist_items')).toEqual(itemsBefore);
    expect(tableSnapshot(database, 'playback_history')).toEqual(historyBefore);
    database.close();
  });
});
