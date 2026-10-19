import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryStore } from './LibraryStore';
import { AlbumService } from './AlbumService';
import { LibraryMaintenanceInterrupted } from './LibraryMaintenanceWorkspace';

let database: EchoDatabase;
const albums = new AlbumService();
function fixture(count = 420) {
  database = createDatabase(':memory:');
  const store = new LibraryStore(database);
  const folder = store.addFolder(join(tmpdir(), 'echo-maintenance-fixture'));
  database.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      database.prepare(`INSERT INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
        duration, field_sources_json, created_at, updated_at
      ) VALUES (?, ?, ?, 10, 1, ?, ?, ?, ?, 180, ?, '2026-01-01', '2026-01-01')`).run(
        `track-${index}`, join(folder.path, `${index}.flac`), folder.id,
        `Song ${index}`, `Artist ${index % 4}`, `Album ${Math.floor(index / 10)}`, `Artist ${index % 4}`,
        JSON.stringify({ title: 'embedded', artist: 'embedded', album: 'embedded', albumArtist: 'embedded' }),
      );
    }
  })();
  return { store, folder, ids: Array.from({ length: count }, (_, index) => `track-${index}`) };
}

const grouping = () => ({
  albums: database.prepare('SELECT title, album_artist, track_count, duration FROM albums ORDER BY title, album_artist').all(),
  artists: database.prepare('SELECT name, track_count, album_count FROM artists ORDER BY name').all(),
  albumLinks: database.prepare('SELECT COUNT(*) AS n FROM album_tracks').get(),
  artistLinks: database.prepare('SELECT COUNT(*) AS n FROM artist_tracks').get(),
});

afterEach(() => { if (database?.open) database.close(); });

describe('cooperative library maintenance', () => {
  it.each(['standard', 'sameTitleAndCover'] as const)('preserves %s grouping while yielding and keeping old rows visible', async (albumMergeStrategy) => {
    const { store } = fixture();
    database.transaction(() => {
      store.refreshAlbums(albums, undefined, { albumMergeStrategy });
      store.refreshArtists();
    })();
    const before = grouping();
    const oldId = database.prepare('SELECT id FROM albums LIMIT 1').get();
    let responsive = false;
    let visibleId: unknown;
    const task = store.refreshGroupingCooperatively(albums, { albumMergeStrategy });
    await new Promise<void>(resolve => setImmediate(() => {
      responsive = true;
      visibleId = database.prepare('SELECT id FROM albums LIMIT 1').get();
      resolve();
    }));
    await task;
    expect(visibleId).toEqual(oldId);
    expect(responsive).toBe(true);
    expect(grouping()).toEqual(before);
    expect(database.prepare<[], { name: string }>('PRAGMA database_list').all().some(row => row.name.startsWith('echo_library_work_'))).toBe(false);
  });

  it('discards stale staging after a concurrent edit and can retry without losing the edit', async () => {
    const { store } = fixture();
    database.transaction(() => { store.refreshAlbums(albums); store.refreshArtists(); })();
    const before = grouping();
    const pending = store.refreshGroupingCooperatively(albums);
    const rejected = expect(pending).rejects.toBeInstanceOf(LibraryMaintenanceInterrupted);
    await new Promise<void>(resolve => setImmediate(() => {
      database.prepare("UPDATE tracks SET album = 'Edited Album' WHERE id = 'track-0'").run();
      resolve();
    }));
    await rejected;
    expect(grouping()).toEqual(before);
    await store.refreshGroupingCooperatively(albums);
    expect(database.prepare("SELECT title FROM albums WHERE title = 'Edited Album'").get()).toEqual({ title: 'Edited Album' });
  });

  it('marks missing paths in pages, yields, and protects inaccessible directories', async () => {
    const { store, folder, ids } = fixture(1200);
    const retained = ids.slice(0, 500).map((_id, index) => join(folder.path, `${index}.flac`));
    database.prepare('UPDATE tracks SET path = ? WHERE id = ?').run(join(folder.path, 'offline', 'song.flac'), 'track-1199');
    let ticks = 0;
    const count = await store.markTracksMissingFromFolderCooperatively(folder.id, retained, undefined,
      { excludeDirectories: [join(folder.path, 'offline')] }, () => { ticks += 1; });
    expect(count).toBe(699);
    expect(ticks).toBeGreaterThan(3);
    expect(database.prepare('SELECT missing FROM tracks WHERE id = ?').get('track-1199')).toEqual({ missing: 0 });
  });

  it('publishes inbox batches only when complete and removes a cancelled partial batch', async () => {
    const { store, folder, ids } = fixture(800);
    const job = store.createScanJob(folder.id);
    let checks = 0;
    await expect(store.recordLibraryInboxBatchCooperatively({ scanJobId: job.id, folder, trackIds: ids }, () => {
      expect(store.getLibraryInboxBatches()).toEqual([]);
      if (++checks === 4) throw new Error('cancelled');
    })).rejects.toThrow('cancelled');
    expect(database.prepare('SELECT COUNT(*) AS n FROM library_inbox_batches').get()).toEqual({ n: 0 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM library_inbox_items').get()).toEqual({ n: 0 });
    const result = await store.recordLibraryInboxBatchCooperatively({ scanJobId: job.id, folder, trackIds: ids });
    expect(result?.addedCount).toBe(800);
    expect(store.getLibraryInboxBatches()).toHaveLength(1);
    expect(database.prepare('SELECT COUNT(*) AS n FROM library_inbox_items').get()).toEqual({ n: 800 });
  });
});
