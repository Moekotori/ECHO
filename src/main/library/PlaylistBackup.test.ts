import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryStore } from './LibraryStore';
import { buildPlaylistBackupSnapshot, writePlaylistBackupSnapshot } from './PlaylistBackup';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-playlist-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

describe('playlist backups', () => {
  let database: EchoDatabase | null = null;

  afterEach(() => {
    database?.close();
    database = null;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes a JSON backup with playlist metadata and item snapshots', () => {
    database = createDatabase(':memory:');
    const store = new LibraryStore(database);
    const playlist = store.createPlaylist({ name: 'Road Trip: 2026' });
    database
      .prepare(
        `INSERT INTO playlist_items (
          id, playlist_id, media_type, media_id, source_provider, source_item_id,
          title_snapshot, artist_snapshot, album_snapshot, duration_snapshot,
          cover_id, position, added_at, added_from, unavailable
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('item-1', playlist.id, 'stream_track', 'streaming:mock:1', 'mock', '1', 'Song', 'Artist', 'Album', 180, null, 0, new Date().toISOString(), 'test', 0);

    const snapshot = buildPlaylistBackupSnapshot(database, playlist.id, 'clear', new Date('2026-05-15T00:00:00.000Z'));
    expect(snapshot?.itemCount).toBe(1);

    const filePath = writePlaylistBackupSnapshot(snapshot!, makeTempRoot(), new Date('2026-05-15T00:00:00.000Z'));
    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({
      reason: 'clear',
      playlist: { id: playlist.id, name: playlist.name },
      items: [{ id: 'item-1', title_snapshot: 'Song' }],
    });
  });
});
