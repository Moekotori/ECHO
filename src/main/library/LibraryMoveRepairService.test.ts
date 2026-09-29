import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryMoveCandidateService } from './LibraryMoveCandidateService';
import { LibraryMoveRepairService } from './LibraryMoveRepairService';

const tempRoots: string[] = [];
const now = '2026-05-18T00:00:00.000Z';

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-move-repair-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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
  quickHash?: string | null;
  quickHashVersion?: number | null;
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
      ) VALUES (?, ?, 'folder-1', 100, 1, ?, ?, ?, ?, ?, ?, 'posix-dev-ino', ?, ?, 'ok', ?, NULL, '', '{}', ?, ?, ?)`,
    )
    .run(
      input.id,
      input.path ?? `C:\\Music\\${input.id}.flac`,
      input.title ?? 'Song',
      input.artist ?? 'Artist',
      input.album ?? 'Album',
      input.artist ?? 'Artist',
      input.duration ?? 180,
      input.fileIdentity ?? null,
      input.quickHash ?? null,
      input.quickHashVersion ?? null,
      now,
      input.missing === true ? 1 : 0,
      now,
      now,
    );
};

const createService = (database: EchoDatabase): LibraryMoveRepairService =>
  new LibraryMoveRepairService(database, new LibraryMoveCandidateService(database));

const firstCandidateId = (database: EchoDatabase): string => {
  const candidate = new LibraryMoveCandidateService(database).getMoveCandidates()[0];
  if (!candidate) {
    throw new Error('Expected move candidate');
  }

  return candidate.candidateId;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('LibraryMoveRepairService', () => {
  it('dry-runs without changing paths, missing flags, playlists, or playback history', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'old', missing: true, fileIdentity: 'same-file' });
    insertTrack(database, { id: 'new', fileIdentity: 'same-file' });
    database.prepare("INSERT INTO playlists (id, name, kind, source_provider, created_at, updated_at) VALUES ('playlist-1', 'List', 'manual', 'local', ?, ?)").run(now, now);
    database
      .prepare(
        `INSERT INTO playlist_items (id, playlist_id, media_type, media_id, source_item_id, position, added_at, added_from)
         VALUES ('item-1', 'playlist-1', 'track', 'old', 'old', 0, ?, 'test')`,
      )
      .run(now);
    database
      .prepare(
        `INSERT INTO playback_history (
          id, track_id, track_path, title, artist, started_at, played_seconds, duration_seconds, completed, created_at
        ) VALUES ('history-1', 'old', 'C:\\Music\\old.flac', 'Song', 'Artist', ?, 0, 180, 0, ?)`,
      )
      .run(now, now);

    const tracksBefore = database.prepare('SELECT id, path, missing FROM tracks ORDER BY id').all();
    const playlistBefore = database.prepare('SELECT * FROM playlist_items ORDER BY id').all();
    const historyBefore = database.prepare('SELECT * FROM playback_history ORDER BY id').all();

    const result = createService(database).dryRun(firstCandidateId(database));

    expect(result.ok).toBe(true);
    expect(result.playlistItemsToRelink).toBe(1);
    expect(result.playbackHistoryEntriesToRelink).toBe(1);
    expect(database.prepare('SELECT id, path, missing FROM tracks ORDER BY id').all()).toEqual(tracksBefore);
    expect(database.prepare('SELECT * FROM playlist_items ORDER BY id').all()).toEqual(playlistBefore);
    expect(database.prepare('SELECT * FROM playback_history ORDER BY id').all()).toEqual(historyBefore);
    database.close();
  });

  it('applies a selected non-ambiguous high confidence move by relinking references and deleting only the old missing row', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'old', missing: true, fileIdentity: 'same-file' });
    insertTrack(database, { id: 'new', fileIdentity: 'same-file' });
    database.prepare("INSERT INTO playlists (id, name, kind, source_provider, created_at, updated_at) VALUES ('playlist-1', 'List', 'manual', 'local', ?, ?)").run(now, now);
    database
      .prepare(
        `INSERT INTO playlist_items (id, playlist_id, media_type, media_id, source_item_id, position, added_at, added_from)
         VALUES ('item-1', 'playlist-1', 'track', 'old', 'old', 0, ?, 'test')`,
      )
      .run(now);
    database
      .prepare(
        `INSERT INTO playback_history (
          id, track_id, track_path, title, artist, started_at, played_seconds, duration_seconds, completed, created_at
        ) VALUES ('history-1', 'old', 'C:\\Music\\old.flac', 'Song', 'Artist', ?, 0, 180, 0, ?)`,
      )
      .run(now, now);

    const result = createService(database).apply(firstCandidateId(database));

    expect(result.ok).toBe(true);
    expect(result.deletedOldTrackRow).toBe(true);
    expect(database.prepare("SELECT id FROM tracks WHERE id = 'old'").get()).toBeUndefined();
    expect(database.prepare("SELECT path, missing FROM tracks WHERE id = 'new'").get()).toEqual({ path: 'C:\\Music\\new.flac', missing: 0 });
    expect(database.prepare("SELECT media_id, source_item_id, unavailable FROM playlist_items WHERE id = 'item-1'").get()).toEqual({
      media_id: 'new',
      source_item_id: 'new',
      unavailable: 0,
    });
    expect(database.prepare("SELECT track_id, track_path FROM playback_history WHERE id = 'history-1'").get()).toEqual({
      track_id: 'new',
      track_path: 'C:\\Music\\new.flac',
    });
    database.close();
  });

  it('blocks ambiguous candidates', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'old-1', missing: true, fileIdentity: 'same-file' });
    insertTrack(database, { id: 'old-2', missing: true, fileIdentity: 'same-file' });
    insertTrack(database, { id: 'new', fileIdentity: 'same-file' });

    const result = createService(database).dryRun(firstCandidateId(database));

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('ambiguous_candidate');
    database.close();
  });

  it('blocks low confidence candidates', () => {
    const database = createTestDatabase();
    insertTrack(database, { id: 'old', missing: true, quickHash: 'hash', quickHashVersion: 1, title: '', artist: '', album: '' });
    insertTrack(database, { id: 'new', quickHash: 'hash', quickHashVersion: 1, title: '', artist: '', album: '' });

    const result = createService(database).dryRun(firstCandidateId(database));

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('low_confidence');
    database.close();
  });
});
